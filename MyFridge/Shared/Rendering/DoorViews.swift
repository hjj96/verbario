import ImageIO
import SwiftUI

// MARK: - Surface textures

/// Photographs of the doors, path-traced in Blender by `Design/doors/render_blender.py` and
/// bundled with the app and the widget. A retro door is shot per format, its deep rounded edges
/// matching the widget's corners; a modern door is a flat panel cropped edge to edge. Each comes
/// as the surface and, separately, the reflection of the tall softbox, which is screen-blended on
/// top and can slide with tilt.
enum DoorTexture {
    enum Layer {
        case surface, gloss

        /// The bundled resolution: the reflection is soft, so it ships at half size.
        var maxPixel: CGFloat { self == .surface ? 1080 : 540 }

        /// `door-<finish>[-<format>][-gloss]`
        func resource(for finish: DoorFinish, shape: FridgeFormat?) -> String {
            var name = "door-\(finish.rawValue)"
            if let shape {
                name += "-\(shape.rawValue)"
            }
            return self == .surface ? name : name + "-gloss"
        }
    }

    private static let cache = NSCache<NSString, UIImage>()

    /// A layer decoded no larger than `maxPixel` (the widget has little memory).
    /// `shape` picks the rounded retro door made for that format; nil is the flat panel.
    static func image(for finish: DoorFinish, shape: FridgeFormat? = nil, layer: Layer, maxPixel: CGFloat) -> UIImage? {
        bundled(layer.resource(for: finish, shape: shape), ext: "jpg", maxPixel: maxPixel, limit: layer.maxPixel)
    }

    /// Any bundled door image (handles, badges), decoded no larger than `maxPixel` and never
    /// larger than the file (`limit`).
    static func bundled(_ name: String, ext: String, maxPixel: CGFloat, limit: CGFloat) -> UIImage? {
        let bucket = Int((min(max(maxPixel, 64), limit) / 128).rounded(.up)) * 128
        let key = "\(name)-\(bucket)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: ext),
              let image = FridgeStorage.downsampledImage(at: url, maxPixel: CGFloat(bucket)) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    /// The rounded door photographed for a door of this size, if one fits its proportions.
    /// A door of another shape (the extra large widget) shows the flat panel instead, so its
    /// rounded edges are never stretched.
    static func roundedShape(for format: FridgeFormat, size: CGSize) -> FridgeFormat? {
        guard size.width > 0, size.height > 0 else { return format }
        let ratio = size.width / size.height
        return abs(ratio - format.aspect) / format.aspect < 0.08 ? format : nil
    }
}

extension DoorFinish {
    /// Average colour of the surface: shown before the texture loads.
    var baseColor: Color {
        switch self {
        case .steel: return Color(hex: 0xC1C2C5)
        case .graphite: return Color(hex: 0x3D4045)
        case .champagne: return Color(hex: 0xC8BAA5)
        case .cream: return Color(hex: 0xF0E6C9)
        case .mint: return Color(hex: 0xBAE3C9)
        case .sky: return Color(hex: 0xA6CCE6)
        case .cherry: return Color(hex: 0xCB3637)
        case .lemon: return Color(hex: 0xF2D55C)
        case .powder: return Color(hex: 0xF1C4CC)
        case .black: return Color(hex: 0x313131)
        }
    }

    var isDark: Bool { self == .graphite || self == .black || self == .cherry }
}

/// The door surface filling its frame. The reflection of the softbox slides a little as the
/// phone tilts, like on a real glossy door; in the widget it stays put.
struct DoorSurfaceView: View {
    let finish: DoorFinish
    /// A rounded retro door made for this format, or nil for a flat panel.
    var rounded: FridgeFormat?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let maxPixel = max(size.width, size.height) * displayScale
            let shape = rounded.flatMap { DoorTexture.roundedShape(for: $0, size: size) }
            ZStack {
                finish.baseColor
                if let surface = DoorTexture.image(for: finish, shape: shape, layer: .surface, maxPixel: maxPixel) {
                    if shape == nil {
                        Image(uiImage: surface)
                            .resizable()
                            .scaledToFill()
                            .frame(width: size.width, height: size.height)
                    } else {
                        // made for exactly this shape: its edges line up with the corners
                        Image(uiImage: surface)
                            .resizable()
                            .frame(width: size.width, height: size.height)
                    }
                }
                if let gloss = DoorTexture.image(for: finish, shape: shape, layer: .gloss, maxPixel: maxPixel) {
                    DoorReflection(image: gloss, size: size, isSquare: shape == nil)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipped()
            .compositingGroup()
        }
    }
}

/// The reflection layer. Slightly larger than the door so that sliding never shows its edge.
private struct DoorReflection: View {
    let image: UIImage
    let size: CGSize
    /// The flat panel's reflection is square and fills the door like its surface.
    let isSquare: Bool

    @Environment(\.magnetLight) private var light

    var body: some View {
        let side = max(size.width, size.height) * 1.06
        let width = isSquare ? side : size.width * 1.06
        let height = isSquare ? side : size.height * 1.06
        let dx = light.tilt.dx.clamped(to: -1...1)
        let dy = light.tilt.dy.clamped(to: -1...1)
        Image(uiImage: image)
            .resizable()
            .frame(width: width, height: height)
            .offset(x: dx * size.width * 0.03, y: dy * size.height * 0.02)
            .frame(width: size.width, height: size.height)
            .blendMode(.screen)
            .allowsHitTesting(false)
    }
}

/// Shared proportions of a door.
enum DoorGeometry {
    /// Outer corner radius in the app. The widget uses the system shape, which this matches.
    static func cornerRadius(format: FridgeFormat, size: CGSize) -> CGFloat {
        switch format {
        case .tall: return size.width * 0.062
        case .square: return size.width * 0.13
        case .wide: return size.height * 0.13
        }
    }
}

// MARK: - Door

/// The door: its photographed surface (rounded for a retro model) and its chrome name.
/// Fills the proposed rectangle; the caller (or the widget container) clips the corners.
/// The handle is drawn separately, above the things on the door (`DoorHandleView`).
struct DoorBackgroundView: View {
    let design: DoorDesign
    let format: FridgeFormat

    var body: some View {
        GeometryReader { geo in
            ZStack {
                DoorSurfaceView(finish: design.finish, rounded: design.model.isRetro ? format : nil)
                DoorEmblemView(design: design, format: format, size: geo.size)
            }
            .compositingGroup()
        }
    }
}

/// A plain piece of a finish, e.g. as the backdrop of a preview.
struct DoorPanelView: View {
    let finish: DoorFinish
    let cornerRadius: CGFloat

    var body: some View {
        DoorSurfaceView(finish: finish)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// The chrome script name used by the modern and fifties doors.
struct ScriptNameplate: View {
    let text: String
    let finish: DoorFinish

    var body: some View {
        GeometryReader { geo in
            let size = geo.size.height * 0.95
            ChromeLettering(text: text,
                            font: .custom("MarckScript-Regular", fixedSize: size),
                            size: size,
                            isDark: finish.isDark)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .leading)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Raised mirror-polished letters: they reflect a bright sky above a dark horizon, have a
/// dark bevelled edge and cast a small shadow on what they are mounted on.
struct ChromeLettering: View {
    let text: String
    let font: Font
    /// The point size, which sets the bevel and the shadow.
    let size: CGFloat
    var tracking: CGFloat = 0
    var edgeColor: Color = Color(hex: 0x2E3339)
    var isDark = false
    var alignment: Alignment = .leading

    private static let chrome = LinearGradient(stops: [
        Gradient.Stop(color: Color(hex: 0xFFFFFF), location: 0),
        Gradient.Stop(color: Color(hex: 0xE4E9EF), location: 0.34),
        Gradient.Stop(color: Color(hex: 0x9AA3AD), location: 0.47),
        Gradient.Stop(color: Color(hex: 0x3F454D), location: 0.53),
        Gradient.Stop(color: Color(hex: 0x737B85), location: 0.68),
        Gradient.Stop(color: Color(hex: 0xD5DAE0), location: 0.88),
        Gradient.Stop(color: Color(hex: 0xF7F8FA), location: 1),
    ], startPoint: .top, endPoint: .bottom)

    var body: some View {
        let edge = max(size * 0.022, 0.5)
        ZStack(alignment: alignment) {
            // shadow on the door
            letters
                .foregroundStyle(Color.black.opacity(isDark ? 0.6 : 0.38))
                .offset(x: size * 0.035, y: size * 0.07)
                .blur(radius: size * 0.035)
            // the bevelled edge, seen all round the letters
            ForEach(0..<8, id: \.self) { index in
                let angle = CGFloat(index) * .pi / 4
                letters
                    .foregroundStyle(edgeColor)
                    .offset(x: cos(angle) * edge, y: sin(angle) * edge + edge * 0.4)
            }
            // polished face
            letters
                .foregroundStyle(Self.chrome)
            // a hairline of light along the top of each stroke
            letters
                .foregroundStyle(Color.white.opacity(0.75))
                .overlay {
                    letters
                        .foregroundStyle(Color.black)
                        .offset(y: edge * 1.2)
                        .blendMode(.destinationOut)
                }
                .compositingGroup()
        }
        // tracking adds space after the last letter too; keep the word visually centred
        .offset(x: alignment == .center ? tracking / 2 : 0)
        .lineLimit(1)
        .minimumScaleFactor(0.4)
    }

    private var letters: Text {
        Text(text).font(font).tracking(tracking)
    }
}
