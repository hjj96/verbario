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

    /// The most interesting point of the photo (top-left origin, 0...1), from Vision saliency.
    static func focusPoint(of image: UIImage) async -> CGPoint {
        let fallback = CGPoint(x: 0.5, y: 0.45)
        guard let cgImage = image.cgImage else { return fallback }
        return await Task.detached(priority: .userInitiated) { () -> CGPoint in
            let request = VNGenerateAttentionBasedSaliencyImageRequest()
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                return fallback
            }
            guard let objects = request.results?.first?.salientObjects, let first = objects.first else { return fallback }
            let box = objects.dropFirst().reduce(first.boundingBox) { $0.union($1.boundingBox) }
            // Vision uses a bottom-left origin.
            return CGPoint(x: box.midX, y: 1 - box.midY)
        }.value
    }

    /// Crops to the given aspect around the focus point.
    static func crop(_ image: UIImage, aspect: CGFloat, focus: CGPoint) -> UIImage {
        guard let cgImage = image.cgImage, aspect > 0 else { return image }
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        var cropWidth = width
        var cropHeight = width / aspect
        if cropHeight > height {
            cropHeight = height
            cropWidth = height * aspect
        }
        let x = (focus.x * width - cropWidth / 2).clamped(to: 0...max(0, width - cropWidth))
        let y = (focus.y * height - cropHeight / 2).clamped(to: 0...max(0, height - cropHeight))
        guard let cropped = cgImage.cropping(to: CGRect(x: x, y: y, width: cropWidth, height: cropHeight).integral) else { return image }
        return UIImage(cgImage: cropped)
    }

    /// A card keeps the photo's own shape unless it is very long or very tall.
    static func cardImage(from image: UIImage, focus: CGPoint) -> UIImage {
        let aspect = image.size.width / max(image.size.height, 1)
        let target = aspect.clamped(to: 0.7...1.45)
        guard abs(target - aspect) > 0.01 else { return image }
        return crop(image, aspect: target, focus: focus)
    }

    /// Writes the editor copy and the small widget copy. Returns what the collection stores.
    static func store(_ image: UIImage, style: PhotoStyle) throws -> PhotoContent {
        let isCutout = style.isCutoutFamily
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
