import SwiftUI

// MARK: - Materials

extension DoorFinish {
    /// Brushed metal: panel (top-leading → bottom-trailing) and the door edge.
    var metalPanel: [Color] {
        switch self {
        case .graphite: return [Color(hex: 0x7A8188), Color(hex: 0x555B61), Color(hex: 0x34393E)]
        case .champagne: return [Color(hex: 0xE3DACF), Color(hex: 0xC6BBAF), Color(hex: 0xA2978B)]
        default: return [Color(hex: 0xDFE2E5), Color(hex: 0xC4C8CD), Color(hex: 0xA3A8AE)]
        }
    }

    /// Enamel paint: light, base, shade and the darker door edge.
    var paint: [Color] {
        switch self {
        case .cream: return [Color(hex: 0xFBF4E4), Color(hex: 0xEEE1C4), Color(hex: 0xD6C59F), Color(hex: 0xB9A57C)]
        case .mint: return [Color(hex: 0xE3F5EA), Color(hex: 0xBDE2CC), Color(hex: 0x93C6A9), Color(hex: 0x6FA387)]
        case .sky: return [Color(hex: 0xDCEDF9), Color(hex: 0xA8CDEA), Color(hex: 0x7FAED4), Color(hex: 0x5D8DB7)]
        case .cherry: return [Color(hex: 0xF47E73), Color(hex: 0xD63C35), Color(hex: 0xA9241F), Color(hex: 0x7E1714)]
        case .lemon: return [Color(hex: 0xFCF0B0), Color(hex: 0xF3D667), Color(hex: 0xD8B43D), Color(hex: 0xAD8B22)]
        case .powder: return [Color(hex: 0xFCE6EA), Color(hex: 0xF1C3CB), Color(hex: 0xD89FA9), Color(hex: 0xB97A86)]
        case .black: return [Color(hex: 0x53585E), Color(hex: 0x2B2E32), Color(hex: 0x18191C), Color(hex: 0x0C0D0E)]
        default: return [Color(hex: 0xFBF4E4), Color(hex: 0xEEE1C4), Color(hex: 0xD6C59F), Color(hex: 0xB9A57C)]
        }
    }

    var edge: [Color] {
        switch self {
        case .steel: return [Color(hex: 0xF4F5F6), Color(hex: 0xC5C9CD), Color(hex: 0x80858B)]
        case .graphite: return [Color(hex: 0xA9AFB5), Color(hex: 0x5E646A), Color(hex: 0x2C3034)]
        case .champagne: return [Color(hex: 0xF2ECE5), Color(hex: 0xC6BCB1), Color(hex: 0x857A6F)]
        default: return [paint[2], paint[3]]
        }
    }

    var brushOpacity: Double {
        switch self {
        case .graphite: return 0.55
        case .champagne: return 0.8
        default: return 0.9
        }
    }

    /// Two colours for a round swatch in pickers.
    var swatch: [Color] {
        isMetal ? [metalPanel[0], metalPanel[2]] : [paint[0], paint[2]]
    }
}

/// Polished chrome across a round bar: dark rim, bright highlight, reflected room.
let chromeStops: [Gradient.Stop] = [
    Gradient.Stop(color: Color(hex: 0x4F5459), location: 0),
    Gradient.Stop(color: Color(hex: 0xD9DDE1), location: 0.16),
    Gradient.Stop(color: Color(hex: 0xFFFFFF), location: 0.3),
    Gradient.Stop(color: Color(hex: 0x9CA2A8), location: 0.48),
    Gradient.Stop(color: Color(hex: 0x3F4449), location: 0.6),
    Gradient.Stop(color: Color(hex: 0xCDD2D7), location: 0.82),
    Gradient.Stop(color: Color(hex: 0x6B7076), location: 1),
]

private let creamStops: [Gradient.Stop] = [
    Gradient.Stop(color: Color(hex: 0xA8946C), location: 0),
    Gradient.Stop(color: Color(hex: 0xEADFC4), location: 0.2),
    Gradient.Stop(color: Color(hex: 0xFFFBF0), location: 0.34),
    Gradient.Stop(color: Color(hex: 0xE2D4B4), location: 0.55),
    Gradient.Stop(color: Color(hex: 0xB9A47C), location: 0.75),
    Gradient.Stop(color: Color(hex: 0x8F7B57), location: 1),
]

/// Shared proportions of a door.
enum DoorGeometry {
    /// The seam (metal) or chrome trim (enamel) under the top section, as a fraction of the face.
    static let seam: CGFloat = 0.12

    /// Outer corner radius in the app. The widget uses the system shape, which this matches.
    static func cornerRadius(format: FridgeFormat, size: CGSize) -> CGFloat {
        switch format {
        case .tall: return size.width * 0.062
        case .square: return size.width * 0.13
        case .wide: return size.height * 0.13
        }
    }

    static func edgeWidth(finish: DoorFinish, size: CGSize) -> CGFloat {
        min(size.width, size.height) * (finish.isMetal ? 0.022 : 0.03)
    }
}

// MARK: - Door

/// The door without the handle: edge, face, top section, gasket and nameplate.
/// Fills the proposed rectangle; the caller (or the widget container) clips the outer corners.
struct DoorBackgroundView: View {
    let design: DoorDesign
    let format: FridgeFormat

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let shortSide = min(size.width, size.height)
            let edge = DoorGeometry.edgeWidth(finish: design.finish, size: size)
            let radius = DoorGeometry.cornerRadius(format: format, size: size)
            let face = RoundedRectangle(cornerRadius: max(radius - edge * 0.9, 3), style: .continuous)
            ZStack {
                LinearGradient(colors: design.finish.edge, startPoint: .top, endPoint: .bottom)
                DoorFace(finish: design.finish, format: format)
                    .clipShape(face)
                    .overlay {
                        // The door face rolls off towards its edges.
                        face
                            .stroke(Color.black.opacity(design.finish.isMetal ? 0.2 : 0.28), lineWidth: shortSide * 0.018)
                            .blur(radius: shortSide * 0.01)
                            .clipShape(face)
                    }
                    .overlay {
                        face.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.9), Color.white.opacity(0.15), Color.black.opacity(0.3)],
                                                         startPoint: .top, endPoint: .bottom),
                                          lineWidth: 1.2)
                    }
                    .padding(edge)
                RoundedRectangle(cornerRadius: max(radius - edge * 0.4, 2), style: .continuous)
                    .strokeBorder(Color.black.opacity(0.18), lineWidth: 0.8)
                    .padding(edge * 0.45)
                if !design.nameplate.isEmpty && format != .wide {
                    let faceHeight = size.height - edge * 2
                    NameplateView(text: design.nameplate, finish: design.finish)
                        .frame(width: size.width * 0.62, height: faceHeight * DoorGeometry.seam * 0.78)
                        .position(x: size.width * 0.08 + size.width * 0.31,
                                  y: edge + faceHeight * DoorGeometry.seam * 0.5)
                }
            }
        }
    }
}

/// The face of the door: brushed metal or glossy enamel, with its reflections.
private struct DoorFace: View {
    let finish: DoorFinish
    let format: FridgeFormat

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let seamY = height * DoorGeometry.seam
            ZStack(alignment: .top) {
                if finish.isMetal {
                    LinearGradient(colors: finish.metalPanel, startPoint: .topLeading, endPoint: .bottomTrailing)
                    BrushedMetalTexture()
                        .opacity(finish.brushOpacity)
                    MetalSheen()
                    LinearGradient(stops: [
                        Gradient.Stop(color: Color.black.opacity(0.16), location: 0),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.1),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.88),
                        Gradient.Stop(color: Color.black.opacity(0.2), location: 1),
                    ], startPoint: .leading, endPoint: .trailing)
                } else {
                    LinearGradient(stops: [
                        Gradient.Stop(color: finish.paint[0], location: 0),
                        Gradient.Stop(color: finish.paint[1], location: 0.35),
                        Gradient.Stop(color: finish.paint[2], location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                    LinearGradient(stops: [
                        Gradient.Stop(color: Color.black.opacity(0.14), location: 0),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.1),
                        Gradient.Stop(color: Color.white.opacity(0.12), location: 0.3),
                        Gradient.Stop(color: Color.white.opacity(0), location: 0.55),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.86),
                        Gradient.Stop(color: Color.black.opacity(0.18), location: 1),
                    ], startPoint: .leading, endPoint: .trailing)
                    EnamelReflections(isWide: format == .wide)
                    LinearGradient(stops: [
                        Gradient.Stop(color: Color.white.opacity(0.35), location: 0),
                        Gradient.Stop(color: Color.white.opacity(0), location: 0.22),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.8),
                        Gradient.Stop(color: Color.black.opacity(0.12), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
                if format != .wide {
                    if finish.isMetal {
                        LinearGradient(colors: [Color.white.opacity(0.42), Color.white.opacity(0.04)],
                                       startPoint: .top, endPoint: .bottom)
                            .frame(height: seamY)
                        VStack(spacing: 0) {
                            Color.black.opacity(0.32).frame(height: 1.2)
                            Color.white.opacity(0.6).frame(height: 1)
                            LinearGradient(colors: [Color.black.opacity(0.1), Color.black.opacity(0)],
                                           startPoint: .top, endPoint: .bottom)
                                .frame(height: height * 0.03)
                        }
                        .offset(y: seamY)
                    } else {
                        ChromeTrim(thickness: max(3, height * 0.014))
                            .offset(y: seamY)
                    }
                }
            }
        }
    }
}

/// Soft vertical bands of light across horizontally brushed metal. They slide with tilt.
private struct MetalSheen: View {
    @Environment(\.magnetLight) private var light

    var body: some View {
        let shift = light.tilt.dx * 0.15
        LinearGradient(stops: [
            Gradient.Stop(color: Color.white.opacity(0), location: 0),
            Gradient.Stop(color: Color.white.opacity(0), location: max(0, 0.22 + shift)),
            Gradient.Stop(color: Color.white.opacity(0.3), location: min(1, 0.32 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: min(1, 0.42 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: min(1, 0.6 + shift)),
            Gradient.Stop(color: Color.white.opacity(0.14), location: min(1, 0.68 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: min(1, 0.76 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: 1),
        ], startPoint: .leading, endPoint: .trailing)
        .allowsHitTesting(false)
    }
}

/// A window reflected in glossy paint: two soft panes on the left. They slide with tilt.
private struct EnamelReflections: View {
    let isWide: Bool

    @Environment(\.magnetLight) private var light

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let top = h * (isWide ? 0.12 : 0.05)
            let length = h * (isWide ? 0.7 : 0.82)
            let shift = light.tilt.dx * w * 0.06
            let pane = LinearGradient(stops: [
                Gradient.Stop(color: Color.white.opacity(0.55), location: 0),
                Gradient.Stop(color: Color.white.opacity(0.22), location: 0.45),
                Gradient.Stop(color: Color.white.opacity(0), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: w * 0.02, style: .continuous)
                    .fill(pane)
                    .frame(width: w * 0.085, height: length)
                    .offset(x: w * 0.11 + shift, y: top + light.tilt.dy * h * 0.03)
                RoundedRectangle(cornerRadius: w * 0.01, style: .continuous)
                    .fill(pane)
                    .frame(width: w * 0.025, height: length * 0.9)
                    .offset(x: w * 0.215 + shift * 1.2, y: top + light.tilt.dy * h * 0.03)
            }
            .blur(radius: min(w, h) * 0.012)
        }
        .allowsHitTesting(false)
    }
}

/// The polished strip that separates the top section of an enamel door.
private struct ChromeTrim: View {
    let thickness: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(stops: [
                Gradient.Stop(color: Color.white, location: 0),
                Gradient.Stop(color: Color(hex: 0xC3C8CD), location: 0.35),
                Gradient.Stop(color: Color(hex: 0x6E747B), location: 0.6),
                Gradient.Stop(color: Color(hex: 0xE6E9EC), location: 1),
            ], startPoint: .top, endPoint: .bottom)
                .frame(height: thickness)
            LinearGradient(colors: [Color.black.opacity(0.22), Color.black.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: thickness * 1.6)
        }
    }
}

/// Fine horizontal brushing, drawn with a fixed seed so it never flickers between renders.
struct BrushedMetalTexture: View {
    var seed: UInt64 = 0xF1D6E

    var body: some View {
        Canvas { context, size in
            var random = SeededRandom(seed: seed)
            let count = Int(size.height * 1.6)
            for _ in 0..<count {
                let y = random.range(0...size.height)
                let x = random.range(-size.width * 0.1...size.width)
                let length = random.range(size.width * 0.1...size.width * 0.8)
                var path = Path()
                path.move(to: CGPoint(x: x, y: y))
                path.addLine(to: CGPoint(x: x + length, y: y))
                let isLight = random.chance(0.5)
                let alpha = Double(isLight ? random.range(0.05...0.16) : random.range(0.03...0.09))
                let color = isLight ? Color.white.opacity(alpha) : Color.black.opacity(alpha)
                context.stroke(path, with: .color(color), lineWidth: random.range(0.35...0.9))
            }
        }
        .allowsHitTesting(false)
    }
}

/// A plain swatch of a finish, e.g. as the backdrop of a preview.
struct DoorPanelView: View {
    let finish: DoorFinish
    let cornerRadius: CGFloat

    var body: some View {
        DoorFace(finish: finish, format: .wide)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// A retro chrome script plate.
private struct NameplateView: View {
    let text: String
    let finish: DoorFinish

    var body: some View {
        GeometryReader { geo in
            let size = geo.size.height * 0.95
            let font = Font.custom("MarckScript-Regular", fixedSize: size)
            ZStack(alignment: .leading) {
                Text(text)
                    .font(font)
                    .foregroundStyle(Color.black.opacity(finish == .graphite || finish == .black ? 0.55 : 0.35))
                    .offset(x: size * 0.03, y: size * 0.06)
                    .blur(radius: size * 0.02)
                Text(text)
                    .font(font)
                    .foregroundStyle(LinearGradient(colors: [Color.white, Color(hex: 0xB9BEC4), Color(hex: 0x6E747B), Color(hex: 0xE6E9EC)],
                                                    startPoint: .top, endPoint: .bottom))
                Text(text)
                    .font(font)
                    .foregroundStyle(Color.white.opacity(0.7))
                    .mask {
                        LinearGradient(colors: [Color.white, Color.clear], startPoint: .top, endPoint: .center)
                    }
                    .offset(y: -size * 0.02)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .leading)
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Handles

/// The handle. Drawn above the magnets.
struct DoorHandleView: View {
    let design: DoorDesign
    let format: FridgeFormat

    var body: some View {
        GeometryReader { geo in
            if format == .wide {
                HorizontalBarHandle(size: geo.size, stops: design.handle == .cream ? creamStops : chromeStops)
            } else if design.handle == .bow {
                BowHandle(size: geo.size)
            } else {
                StraightBarHandle(size: geo.size, stops: design.handle == .cream ? creamStops : chromeStops)
            }
        }
        .allowsHitTesting(false)
    }
}

/// A straight round bar on two stand-offs, like on retro fridges.
private struct StraightBarHandle: View {
    let size: CGSize
    let stops: [Gradient.Stop]

    var body: some View {
        let w = size.width
        let h = size.height
        let x = w * 0.9
        let top = h * 0.3
        let bottom = h * 0.7
        let bar = min(w, h / FridgeFormat.tall.aspect) * 0.046
        let mount = CGSize(width: bar * 1.25, height: bar * 1.6)
        ZStack {
            Capsule()
                .fill(Color.black.opacity(0.34))
                .frame(width: bar, height: bottom - top)
                .blur(radius: bar * 0.35)
                .position(x: x + bar * 0.5, y: (top + bottom) / 2 + bar * 0.65)
            MountPlate(size: mount)
                .position(x: x, y: top + bar * 0.7)
            MountPlate(size: mount)
                .position(x: x, y: bottom - bar * 0.7)
            Capsule()
                .fill(LinearGradient(stops: stops, startPoint: .leading, endPoint: .trailing))
                .overlay { Capsule().strokeBorder(Color.black.opacity(0.18), lineWidth: 0.6) }
                .frame(width: bar, height: bottom - top)
                .position(x: x, y: (top + bottom) / 2)
        }
    }
}

/// A horizontal bar along the top of a wide door.
private struct HorizontalBarHandle: View {
    let size: CGSize
    let stops: [Gradient.Stop]

    var body: some View {
        let w = size.width
        let h = size.height
        let left = w * 0.32
        let right = w * 0.68
        let y = h * 0.16
        let bar = max(5, h * 0.075)
        let mount = CGSize(width: bar * 1.1, height: bar * 1.6)
        ZStack {
            Capsule()
                .fill(Color.black.opacity(0.35))
                .frame(width: right - left, height: bar)
                .blur(radius: bar * 0.35)
                .position(x: (left + right) / 2 + bar * 0.4, y: y + bar * 1.3)
            MountPlate(size: mount)
                .position(x: left + bar * 0.6, y: y + bar * 0.6)
            MountPlate(size: mount)
                .position(x: right - bar * 0.6, y: y + bar * 0.6)
            Capsule()
                .fill(LinearGradient(stops: stops, startPoint: .top, endPoint: .bottom))
                .overlay { Capsule().strokeBorder(Color.black.opacity(0.18), lineWidth: 0.6) }
                .frame(width: right - left, height: bar)
                .position(x: (left + right) / 2, y: y + bar / 2)
        }
    }
}

/// The bowed chrome handle of a steel door.
private struct BowHandle: View {
    let size: CGSize

    var body: some View {
        let w = min(size.width, size.height / FridgeFormat.tall.aspect)
        let h = size.height
        let x = size.width * 0.9
        let top = h * 0.3
        let bottom = h * 0.72
        let barWidth = w * 0.042
        let bow = w * 0.036
        let mountSize = CGSize(width: w * 0.07, height: w * 0.095)
        let curveSize = CGSize(width: bow, height: bottom - top)
        let curveCenter = CGPoint(x: x + bow / 2, y: (top + bottom) / 2)
        ZStack {
            HandleCurve()
                .stroke(Color.black.opacity(0.3), style: StrokeStyle(lineWidth: barWidth, lineCap: .round))
                .frame(width: curveSize.width, height: curveSize.height)
                .blur(radius: w * 0.01)
                .position(x: curveCenter.x + w * 0.016, y: curveCenter.y + w * 0.024)
            MountPlate(size: mountSize)
                .position(x: x, y: top)
            MountPlate(size: mountSize)
                .position(x: x, y: bottom)
            ZStack {
                HandleCurve()
                    .stroke(Color(hex: 0x5F656C), style: StrokeStyle(lineWidth: barWidth, lineCap: .round))
                HandleCurve()
                    .stroke(Color(hex: 0xD9DDE1), style: StrokeStyle(lineWidth: barWidth * 0.62, lineCap: .round))
                    .offset(x: -barWidth * 0.1)
                HandleCurve()
                    .stroke(Color.white, style: StrokeStyle(lineWidth: barWidth * 0.2, lineCap: .round))
                    .offset(x: -barWidth * 0.2)
                    .opacity(0.9)
            }
            .frame(width: curveSize.width, height: curveSize.height)
            .position(curveCenter)
        }
    }
}

/// Centre line of the bow handle: leaves the top mount, bows outwards, returns to the bottom.
struct HandleCurve: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addCurve(to: CGPoint(x: rect.minX, y: rect.maxY),
                      control1: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.12),
                      control2: CGPoint(x: rect.maxX, y: rect.maxY - rect.height * 0.12))
        return path
    }
}

/// A chrome stand-off plate with a screw.
private struct MountPlate: View {
    let size: CGSize

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: min(size.width, size.height) * 0.42, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: [Color(hex: 0xF7F8F9), Color(hex: 0xB3B8BE), Color(hex: 0x737980)],
                                      startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.9), Color.black.opacity(0.35)],
                                              startPoint: .top, endPoint: .bottom),
                               lineWidth: max(0.6, size.width * 0.05))
            Circle()
                .fill(RadialGradient(colors: [Color.white, Color(white: 0.55)],
                                     center: UnitPoint(x: 0.35, y: 0.3),
                                     startRadius: 0, endRadius: size.width * 0.12))
                .overlay { Circle().strokeBorder(Color.black.opacity(0.35), lineWidth: max(0.4, size.width * 0.02)) }
                .frame(width: size.width * 0.18, height: size.width * 0.18)
                .offset(y: -size.height * 0.28)
        }
        .frame(width: size.width, height: size.height)
        .shadow(color: Color.black.opacity(0.3), radius: size.width * 0.08, x: size.width * 0.06, y: size.width * 0.1)
    }
}

/// Seam line for tinted and clear Home Screen modes, where the system removes the door background.
struct DoorOutlineView: View {
    let format: FridgeFormat

    var body: some View {
        GeometryReader { geo in
            if format != .wide {
                let w = geo.size.width
                let y = geo.size.height * DoorGeometry.seam
                Path { path in
                    path.move(to: CGPoint(x: w * 0.06, y: y))
                    path.addLine(to: CGPoint(x: w * 0.94, y: y))
                }
                .stroke(Color.white.opacity(0.35), lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}
