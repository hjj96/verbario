import CoreImage
import UIKit
import Vision

/// Everything Vision found in one photo: a label map of separate objects that the person
/// can pick by tapping, plus helpers to cut the chosen ones out.
/// Methods are safe to call off the main thread; Vision work is serialised by a lock.
final class CutoutSession: @unchecked Sendable {
    let image: UIImage
    /// Object labels, 1...N (0 is the background).
    let instances: [Int]

    private let handler: VNImageRequestHandler
    private let observation: VNInstanceMaskObservation
    private let labels: [UInt8]
    private let maskWidth: Int
    private let maskHeight: Int
    private let areas: [Int: Int]
    private let lock = NSLock()
    private static let context = CIContext()

    private init(image: UIImage, handler: VNImageRequestHandler, observation: VNInstanceMaskObservation,
                 labels: [UInt8], maskWidth: Int, maskHeight: Int) {
        self.image = image
        self.handler = handler
        self.observation = observation
        self.labels = labels
        self.maskWidth = maskWidth
        self.maskHeight = maskHeight
        self.instances = observation.allInstances.map { $0 }.sorted()
        var areas: [Int: Int] = [:]
        for label in labels where label > 0 {
            areas[Int(label), default: 0] += 1
        }
        self.areas = areas
    }

    /// Finds separate objects in the photo. Returns nil when there are none or the device
    /// cannot run the request (for example, the Simulator).
    static func analyze(_ image: UIImage) async -> CutoutSession? {
        guard let cgImage = image.cgImage else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> CutoutSession? in
            let request = VNGenerateForegroundInstanceMaskRequest()
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                return nil
            }
            guard let observation = request.results?.first, !observation.allInstances.isEmpty else { return nil }
            let buffer = observation.instanceMask
            CVPixelBufferLockBaseAddress(buffer, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
            let width = CVPixelBufferGetWidth(buffer)
            let height = CVPixelBufferGetHeight(buffer)
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            guard width > 0, height > 0, let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
            var labels = [UInt8](repeating: 0, count: width * height)
            labels.withUnsafeMutableBytes { destination in
                guard let target = destination.baseAddress else { return }
                for row in 0..<height {
                    memcpy(target + row * width, base + row * bytesPerRow, width)
                }
            }
            return CutoutSession(image: image, handler: handler, observation: observation,
                                 labels: labels, maskWidth: width, maskHeight: height)
        }.value
    }

    /// The object under a point given in 0...1 image coordinates (top-left origin), or nil.
    func instance(at point: CGPoint) -> Int? {
        let x = Int((point.x * CGFloat(maskWidth)).rounded(.down))
        let y = Int((point.y * CGFloat(maskHeight)).rounded(.down))
        guard x >= 0, y >= 0, x < maskWidth, y < maskHeight else { return nil }
        let label = Int(labels[y * maskWidth + x])
        return label > 0 ? label : nil
    }

    /// What to select first: the object in the middle of the photo, or the biggest one.
    func defaultSelection() -> Set<Int> {
        if let center = instance(at: CGPoint(x: 0.5, y: 0.5)) {
            return [center]
        }
        if let biggest = areas.max(by: { $0.value < $1.value })?.key {
            return [biggest]
        }
        return Set(instances.prefix(1))
    }

    /// The chosen objects on a transparent background. Cropped images are for stickers;
    /// full-size ones line up with the photo for highlighting.
    func cutout(of selection: Set<Int>, cropped: Bool) -> UIImage? {
        guard !selection.isEmpty else { return nil }
        lock.lock()
        defer { lock.unlock() }
        do {
            let buffer = try observation.generateMaskedImage(ofInstances: IndexSet(selection),
                                                             from: handler,
                                                             croppedToInstancesExtent: cropped)
            let masked = CIImage(cvPixelBuffer: buffer)
            guard let output = Self.context.createCGImage(masked, from: masked.extent) else { return nil }
            return UIImage(cgImage: output)
        } catch {
            return nil
        }
    }

    /// Cuts along a freehand outline. Points are in 0...1 image coordinates.
    static func lassoCut(_ image: UIImage, points: [CGPoint]) -> UIImage? {
        guard points.count >= 8 else { return nil }
        let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let pixels = points.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
        let path = UIBezierPath()
        func middle(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
        }
        path.move(to: middle(pixels[pixels.count - 1], pixels[0]))
        for index in 0..<pixels.count {
            let point = pixels[index]
            let next = pixels[(index + 1) % pixels.count]
            path.addQuadCurve(to: middle(point, next), controlPoint: point)
        }
        path.close()
        let bounds = path.bounds.intersection(CGRect(origin: .zero, size: size)).integral
        guard !bounds.isNull, bounds.width >= 16, bounds.height >= 16 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: bounds.size, format: format).image { context in
            context.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
            path.addClip()
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
