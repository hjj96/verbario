import SwiftUI

// MARK: - Hardware geometry

/// Where the chrome hardware of each retro model sits on a door. The images are rendered by
/// `Design/doors/render_blender.py` over a shadow-catching door, so each includes its own
/// shadow; the piece itself is a known rectangle inside the image.
enum DoorHardware {
    struct Piece {
        let resource: String
        /// The piece without its shadow, as fractions of the image.
        let frame: CGRect
        /// Image width / height.
        let imageAspect: CGFloat
        /// Pixel height of the bundled image.
        let pixelHeight: CGFloat

        /// The whole image (piece plus shadow) for a piece drawn in `piece`.
        func imageRect(around piece: CGRect) -> CGRect {
            let height = piece.height / frame.height
            let width = height * imageAspect
            return CGRect(x: piece.minX - frame.minX * width, y: piece.minY - frame.minY * height,
                          width: width, height: height)
        }

        /// Piece width / height.
        var aspect: CGFloat { frame.width / frame.height * imageAspect }
    }

    static func handle(_ model: DoorModel) -> Piece? {
        switch model {
        case .modern:
            return nil
        case .fifties:
            return Piece(resource: "handle-fifties", frame: CGRect(x: 0.0794, y: 0.0294, width: 0.5079, height: 0.7353),
                         imageAspect: 378.0 / 816.0, pixelHeight: 816)
        case .riviera:
            return Piece(resource: "handle-riviera", frame: CGRect(x: 0.0704, y: 0.0294, width: 0.5634, height: 0.7353),
                         imageAspect: 426.0 / 816.0, pixelHeight: 816)
        case .thaw:
            return Piece(resource: "handle-thaw", frame: CGRect(x: 0.0746, y: 0.0294, width: 0.5373, height: 0.7353),
                         imageAspect: 402.0 / 816.0, pixelHeight: 816)
        }
    }

    /// The Soviet badge: a red enamel field in a chrome rim, with three chrome wings each side.
    static let badge = Piece(resource: "badge-thaw", frame: CGRect(x: 0.0106, y: 0.0323, width: 0.9574, height: 0.8065),
                             imageAspect: 752.0 / 248.0, pixelHeight: 248)

    /// Length (share of the door height) and centre (share of the height) of a handle.
    private static func handlePlacement(_ model: DoorModel, format: FridgeFormat) -> (length: CGFloat, centerY: CGFloat) {
        switch (model, format) {
        case (.riviera, .wide): return (0.56, 0.42)
        case (.riviera, .square): return (0.4, 0.32)
        case (.riviera, _): return (0.36, 0.3)
        case (_, .wide): return (0.62, 0.5)
        case (.thaw, .square): return (0.46, 0.48)
        case (.thaw, _): return (0.42, 0.46)
        case (_, .square): return (0.46, 0.46)
        default: return (0.42, 0.43)
        }
    }

    /// Distance from the right edge of the door to the handle's centre, in item units.
    private static func handleInset(_ model: DoorModel) -> CGFloat {
        switch model {
        case .riviera: return 0.092
        case .thaw: return 0.09
        default: return 0.088
        }
    }

    /// The handle itself (without its shadow) on a door of the given size.
    static func handleRect(_ model: DoorModel, format: FridgeFormat, door: CGSize) -> CGRect {
        guard let piece = handle(model) else { return .zero }
        let placement = handlePlacement(model, format: format)
        let length = door.height * placement.length
        let width = length * piece.aspect
        let centerX = door.width - handleInset(model) * ItemMetrics.unit(in: door)
        let centerY = door.height * placement.centerY
        return CGRect(x: centerX - width / 2, y: centerY - length / 2, width: width, height: length)
    }

    /// The left edge of the strip the handle takes, as a share of the door width.
    /// New things are placed to the left of it.
    static func handleZoneStart(_ model: DoorModel, format: FridgeFormat) -> CGFloat {
        let door = CGSize(width: 1000 * format.aspect, height: 1000)
        let rect = handleRect(model, format: format, door: door)
        return max(0.5, (rect.minX - door.width * 0.03) / door.width)
    }
}

// MARK: - Handle

/// The chrome handle of a retro model. It stands off the door, so it is drawn above
/// everything hanging there and its shadow falls on them too.
struct DoorHandleView: View {
    let design: DoorDesign
    let format: FridgeFormat

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GeometryReader { geo in
            if let model = design.handle, let piece = DoorHardware.handle(model) {
                let rect = piece.imageRect(around: DoorHardware.handleRect(model, format: format, door: geo.size))
                if let image = DoorTexture.bundled(piece.resource, ext: "png",
                                                   maxPixel: rect.height * displayScale, limit: piece.pixelHeight) {
                    PhotoImage(image: image)
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Names

/// The chrome name of a door, in the style of its model.
struct DoorEmblemView: View {
    let design: DoorDesign
    let format: FridgeFormat
    let size: CGSize

    var body: some View {
        let text = design.nameplate
        if !text.isEmpty {
            switch design.model {
            case .modern, .fifties:
                let height = format == .wide ? size.height * 0.12 : size.height * 0.075
                ScriptNameplate(text: text, finish: design.finish)
                    .frame(width: size.width * 0.6, height: height)
                    .position(x: size.width * 0.37, y: size.height * (format == .wide ? 0.13 : 0.075))
            case .riviera:
                let height = size.height * (format == .wide ? 0.13 : format == .square ? 0.085 : 0.075)
                RivieraName(text: text, finish: design.finish)
                    .frame(width: size.width * (format == .wide ? 0.5 : 0.72), height: height)
                    .position(x: size.width * (format == .wide ? 0.45 : 0.5),
                              y: size.height * (format == .wide ? 0.85 : format == .square ? 0.88 : 0.9))
            case .thaw:
                let width = size.width * (format == .wide ? 0.42 : format == .square ? 0.68 : 0.62)
                ThawBadge(text: text)
                    .frame(width: width, height: width / 3.6)
                    .position(x: size.width * (format == .wide ? 0.45 : 0.5),
                              y: size.height * (format == .wide ? 0.16 : format == .square ? 0.1 : 0.085))
            }
        }
    }
}

/// Wide-spaced lowercase chrome letters near the bottom, as on Italian retro fridges.
private struct RivieraName: View {
    let text: String
    let finish: DoorFinish

    var body: some View {
        GeometryReader { geo in
            let size = geo.size.height * 0.82
            ChromeLettering(text: text.lowercased(),
                            font: .system(size: size, weight: .heavy),
                            size: size,
                            tracking: size * 0.32,
                            isDark: finish.isDark,
                            alignment: .center)
                .frame(width: geo.size.width, height: geo.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A chrome badge with wings and a red enamel field carrying the name in chrome capitals.
/// The proposed frame is the badge itself; its shadow spills outside.
private struct ThawBadge: View {
    let text: String

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GeometryReader { geo in
            let piece = CGRect(origin: .zero, size: geo.size)
            let rect = DoorHardware.badge.imageRect(around: piece)
            // the enamel field is 1.06 x 0.54 of the badge's 3.6 x 1
            let field = CGSize(width: geo.size.width * 1.06 / 3.6, height: geo.size.height * 0.54)
            let size = field.height * 0.72
            ZStack {
                if let image = DoorTexture.bundled(DoorHardware.badge.resource, ext: "png",
                                                   maxPixel: rect.width * displayScale, limit: 752) {
                    PhotoImage(image: image)
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                }
                ChromeLettering(text: text.uppercased(),
                                font: .system(size: size, weight: .bold, design: .serif),
                                size: size,
                                tracking: size * 0.12,
                                edgeColor: Color(hex: 0x3A0B0D),
                                isDark: true,
                                alignment: .center)
                    .frame(width: field.width * 0.86, height: field.height)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
