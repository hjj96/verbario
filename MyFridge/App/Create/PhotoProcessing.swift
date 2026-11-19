import CoreImage
import ImageIO
import UIKit
import Vision

enum StickerBorder: String, CaseIterable, Identifiable {
    case none, thin, wide

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "Без обводки"
        case .thin: return "Тонкая"
        case .wide: return "Широкая"
        }
    }

    /// Border width as a fraction of the longer side of the cut-out.
    var fraction: CGFloat {
        switch self {
        case .none: return 0
        case .thin: return 0.016
        case .wide: return 0.03
        }
    }
}

/// Turns a picked photo into a card or a cut-out sticker and stores it for the app and the widget.
/// Everything here is safe to call off the main thread.
enum PhotoProcessing {
    enum ProcessingError: Error {
        case encoding
    }

    private static let context = CIContext()

    /// Decodes and downsizes a picked photo, with its orientation applied.
    static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return FridgeStorage.downsampledImage(from: source, maxPixel: maxPixel)
    }

    /// Lifts the main subjects off the background (Vision, iOS 17+).
    /// Returns nil when nothing was found or the device cannot do it (for example, the Simulator).
    static func liftSubject(from image: UIImage) async -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> UIImage? in
            let request = VNGenerateForegroundInstanceMaskRequest()
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            do {
                try handler.perform([request])
                guard let observation = request.results?.first, !observation.allInstances.isEmpty else { return nil }
                let buffer = try observation.generateMaskedImage(ofInstances: observation.allInstances,
                                                                 from: handler,
                                                                 croppedToInstancesExtent: true)
                let lifted = CIImage(cvPixelBuffer: buffer)
                guard let output = context.createCGImage(lifted, from: lifted.extent) else { return nil }
                // Tiny specks are not worth a magnet.
                guard output.width > 24, output.height > 24 else { return nil }
                return UIImage(cgImage: output)
            } catch {
                return nil
            }
        }.value
    }

    /// Adds a soft white sticker edge around the cut-out.
    static func sticker(from cutout: UIImage, border: StickerBorder) -> UIImage {
        let source = resized(cutout, maxPixel: 1400, opaque: false)
        guard border != .none, let cgImage = source.cgImage else { return source }

        let longSide = CGFloat(max(cgImage.width, cgImage.height))
        let radius = max(2, (longSide * border.fraction).rounded())
        let margin = radius * 1.6
        let canvas = CGRect(x: 0, y: 0,
                            width: CGFloat(cgImage.width) + margin * 2,
                            height: CGFloat(cgImage.height) + margin * 2)

        let clear = CIImage(color: CIColor.clear).cropped(to: canvas)
        let object = CIImage(cgImage: cgImage)
            .transformed(by: CGAffineTransform(translationX: margin, y: margin))
            .composited(over: clear)
        let grown = object.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: radius])
            .cropped(to: canvas)
        let paper = CIImage(color: CIColor(red: 0.99, green: 0.985, blue: 0.97)).cropped(to: canvas)
        let silhouette = paper.applyingFilter("CIBlendWithAlphaMask", parameters: [
            kCIInputBackgroundImageKey: clear,
            kCIInputMaskImageKey: grown,
        ])
        .applyingGaussianBlur(sigma: 0.8)
        .cropped(to: canvas)
        let result = object.composited(over: silhouette).cropped(to: canvas)

        guard let output = context.createCGImage(result, from: canvas) else { return source }
        return UIImage(cgImage: output)
    }

    /// Centre-crops very long or very tall photos so a card stays card-shaped.
    static func cardImage(from image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let aspect = width / height
        let target = aspect.clamped(to: 0.7...1.45)
        var rect = CGRect(x: 0, y: 0, width: width, height: height)
        if aspect > target {
            rect.size.width = height * target
            rect.origin.x = (width - rect.width) / 2
        } else if aspect < target {
            rect.size.height = width / target
            rect.origin.y = (height - rect.height) / 2
        }
        guard let cropped = cgImage.cropping(to: rect.integral) else { return image }
        return UIImage(cgImage: cropped)
    }

    /// Writes the editor copy and the small widget copy. Returns what the collection stores.
    static func store(_ image: UIImage, style: PhotoStyle) throws -> PhotoContent {
        let isCutout = style == .cutout
        let file = "\(UUID().uuidString).\(isCutout ? "png" : "jpg")"
        let full = resized(image, maxPixel: 1400, opaque: !isCutout)
        let small = resized(image, maxPixel: 520, opaque: !isCutout)
        guard let fullData = encode(full, asPNG: isCutout),
              let smallData = encode(small, asPNG: isCutout) else {
            throw ProcessingError.encoding
        }
        try fullData.write(to: FridgeStorage.imageURL(file, variant: .full), options: [.atomic])
        try smallData.write(to: FridgeStorage.imageURL(file, variant: .widget), options: [.atomic])
        let aspect = Double(full.size.width / max(full.size.height, 1))
        return PhotoContent(style: style, file: file, aspect: aspect)
    }

    static func resized(_ image: UIImage, maxPixel: CGFloat, opaque: Bool) -> UIImage {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        let longSide = max(pixelWidth, pixelHeight)
        guard longSide > maxPixel || image.scale != 1 else { return image }
        let factor = min(1, maxPixel / longSide)
        let size = CGSize(width: (pixelWidth * factor).rounded(), height: (pixelHeight * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private static func encode(_ image: UIImage, asPNG: Bool) -> Data? {
        asPNG ? image.pngData() : image.jpegData(compressionQuality: 0.88)
    }
}
