import SwiftUI

/// Colours of one door finish.
struct DoorPalette {
    var panel: [Color]
    /// Painted enamel instead of brushed metal.
    var isEnamel: Bool
    var brushOpacity: Double
    var rim: [Color]
    /// Rim width as a fraction of the door width.
    var rimWidth: CGFloat
    var rimIsEnamel: Bool
}

extension DoorFinish {
    var palette: DoorPalette {
        let chromeRim = [Color(hex: 0xF3F4F5), Color(hex: 0xC4C8CC), Color(hex: 0x878C92)]
        let steelPanel = [Color(hex: 0xDCDFE2), Color(hex: 0xC1C5CA), Color(hex: 0xA2A7AD)]
        switch self {
        case .steel:
            return DoorPalette(panel: steelPanel, isEnamel: false, brushOpacity: 0.9,
                               rim: chromeRim, rimWidth: 0.02, rimIsEnamel: false)
        case .champagne:
            return DoorPalette(panel: [Color(hex: 0xDCD3C9), Color(hex: 0xC0B5A9), Color(hex: 0x9F9488)],
                               isEnamel: false, brushOpacity: 0.8,
                               rim: [Color(hex: 0xF0EAE3), Color(hex: 0xC3B9AE), Color(hex: 0x877C71)],
                               rimWidth: 0.02, rimIsEnamel: false)
        case .blueRim:
            return DoorPalette(panel: steelPanel, isEnamel: false, brushOpacity: 0.9,
                               rim: [Color(hex: 0xBBD5EF), Color(hex: 0x8DB4DB), Color(hex: 0x5E8BBA)],
                               rimWidth: 0.045, rimIsEnamel: true)
        case .graphite:
            return DoorPalette(panel: [Color(hex: 0x737A81), Color(hex: 0x50565C), Color(hex: 0x33383D)],
                               isEnamel: false, brushOpacity: 0.55,
                               rim: [Color(hex: 0xA3A9AF), Color(hex: 0x5B6168), Color(hex: 0x2E3236)],
                               rimWidth: 0.02, rimIsEnamel: false)
        case .cream:
            return DoorPalette(panel: [Color(hex: 0xF8F0DC), Color(hex: 0xEBDCBC), Color(hex: 0xD8C39A)],
                               isEnamel: true, brushOpacity: 0, rim: chromeRim, rimWidth: 0.016, rimIsEnamel: false)
        case .sky:
            return DoorPalette(panel: [Color(hex: 0xD3E6F5), Color(hex: 0xA9CBE8), Color(hex: 0x7FAAD3)],
                               isEnamel: true, brushOpacity: 0, rim: chromeRim, rimWidth: 0.016, rimIsEnamel: false)
        case .mint:
            return DoorPalette(panel: [Color(hex: 0xDAF0E2), Color(hex: 0xB5DDC4), Color(hex: 0x8CC4A3)],
                               isEnamel: true, brushOpacity: 0, rim: chromeRim, rimWidth: 0.016, rimIsEnamel: false)
        case .cherry:
            return DoorPalette(panel: [Color(hex: 0xF0857A), Color(hex: 0xD94B44), Color(hex: 0xA92D29)],
                               isEnamel: true, brushOpacity: 0, rim: chromeRim, rimWidth: 0.016, rimIsEnamel: false)
        }
    }

    /// Two colours for a round swatch in settings.
    var swatch: [Color] {
        let panel = palette.panel
        return [panel[0], panel[2]]
    }
}

/// Shared proportions of the door (fractions of the door size).
enum DoorGeometry {
    /// The seam between the top cap and the rest of the door.
    static let seam: CGFloat = 0.12
    static let handleX: CGFloat = 0.9
    /// Outer corner radius in the app (the widget uses the system shape).
    static let cornerRadius: CGFloat = 0.075
}

/// The door without the handle: rim, panel, top cap, seam and the optional nameplate.
/// Fills the proposed rectangle; the caller (or the widget container) clips the corners.
struct DoorBackgroundView: View {
    let design: DoorDesign

    var body: some View {
        GeometryReader { geo in
            let palette = design.finish.palette
            let rim = geo.size.width * palette.rimWidth
            ZStack {
                LinearGradient(colors: palette.rim, startPoint: .top, endPoint: .bottom)
                if palette.rimIsEnamel {
                    LinearGradient(stops: [
                        Gradient.Stop(color: Color.white.opacity(0.55), location: 0),
                        Gradient.Stop(color: Color.white.opacity(0), location: 0.3),
                        Gradient.Stop(color: Color.black.opacity(0), location: 0.75),
                        Gradient.Stop(color: Color.black.opacity(0.18), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
                DoorPanelView(palette: palette, cornerRadius: max(geo.size.width * 0.045, 6))
                    .padding(rim)
                if !design.nameplate.isEmpty {
                    NameplateView(text: design.nameplate, finish: design.finish)
                        .frame(height: geo.size.height * DoorGeometry.seam * 0.62)
                        .frame(maxWidth: geo.size.width * 0.62, alignment: .leading)
                        .position(x: geo.size.width * 0.07 + geo.size.width * 0.31,
                                  y: rim + (geo.size.height - rim * 2) * DoorGeometry.seam * 0.52)
                }
            }
        }
    }
}

/// Brushed metal or enamel panel with soft reflections, the top cap and the seam under it.
struct DoorPanelView: View {
    let palette: DoorPalette
    let cornerRadius: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        GeometryReader { geo in
            let height = geo.size.height
            let seamY = height * DoorGeometry.seam
            let edge = max(1, geo.size.width * 0.006)
            ZStack(alignment: .top) {
                LinearGradient(colors: palette.panel, startPoint: .topLeading, endPoint: .bottomTrailing)
                if !palette.isEnamel {
                    BrushedMetalTexture()
                        .opacity(palette.brushOpacity)
                }
                DoorSheen(isEnamel: palette.isEnamel)
                LinearGradient(colors: [Color.white.opacity(palette.isEnamel ? 0.3 : 0.4), Color.white.opacity(0.04)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: seamY)
                VStack(spacing: 0) {
                    Color.black.opacity(0.3).frame(height: 1.2)
                    Color.white.opacity(0.6).frame(height: 1)
                    LinearGradient(colors: [Color.black.opacity(0.1), Color.black.opacity(0)],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: height * 0.03)
                }
                .offset(y: seamY)
            }
            .clipShape(shape)
            .overlay {
                shape.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.85), Color.white.opacity(0.15), Color.black.opacity(0.35)],
                                                  startPoint: .top, endPoint: .bottom),
                                   lineWidth: edge)
            }
            .overlay {
                shape.inset(by: edge)
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
            }
        }
    }
}

/// Broad reflections that slide across the door when the phone tilts.
private struct DoorSheen: View {
    let isEnamel: Bool

    @Environment(\.magnetLight) private var light

    var body: some View {
        let shiftX = light.tilt.dx * 0.25
        let shiftY = light.tilt.dy * 0.25
        let strong = isEnamel ? 0.34 : 0.24
        LinearGradient(stops: [
            Gradient.Stop(color: Color.white.opacity(0), location: 0),
            Gradient.Stop(color: Color.white.opacity(strong), location: 0.3),
            Gradient.Stop(color: Color.white.opacity(0), location: isEnamel ? 0.4 : 0.46),
            Gradient.Stop(color: Color.white.opacity(strong * 0.5), location: 0.64),
            Gradient.Stop(color: Color.white.opacity(0), location: 0.8),
        ], startPoint: UnitPoint(x: -shiftX, y: -shiftY), endPoint: UnitPoint(x: 1 - shiftX, y: 1 - shiftY))
        .allowsHitTesting(false)
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
                    .foregroundStyle(Color.black.opacity(finish == .graphite ? 0.55 : 0.35))
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

// MARK: - Handle

/// The handle with two mounts. Drawn above the magnets.
struct DoorHandleView: View {
    let design: DoorDesign

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let isShort = design.handle == .shortBow
            let x = w * DoorGeometry.handleX
            let top = h * (isShort ? 0.4 : 0.3)
            let bottom = h * (isShort ? 0.62 : 0.72)
            let barWidth = w * (isShort ? 0.05 : 0.042)
            let bow = w * (isShort ? 0.04 : 0.036)
            let mountSize: CGSize = isShort ? CGSize(width: w * 0.085, height: w * 0.085) : CGSize(width: w * 0.07, height: w * 0.095)
            let curveSize = CGSize(width: bow, height: bottom - top)
            let curveCenter = CGPoint(x: x + bow / 2, y: (top + bottom) / 2)
            let bar: [Color] = design.handle == .creamBow
                ? [Color(hex: 0xB09B74), Color(hex: 0xEADFC4), Color(hex: 0xFFFBF0)]
                : [Color(hex: 0x5F656C), Color(hex: 0xC9CDD2), Color(hex: 0xFFFFFF)]
            let mount: [Color] = [Color(hex: 0xF7F8F9), Color(hex: 0xB3B8BE), Color(hex: 0x737980)]

            ZStack {
                HandleCurve()
                    .stroke(Color.black.opacity(0.3), style: StrokeStyle(lineWidth: barWidth, lineCap: .round))
                    .frame(width: curveSize.width, height: curveSize.height)
                    .blur(radius: w * 0.01)
                    .position(x: curveCenter.x + w * 0.016, y: curveCenter.y + w * 0.024)
                HandleMount(colors: mount, size: mountSize)
                    .position(x: x, y: top)
                HandleMount(colors: mount, size: mountSize)
                    .position(x: x, y: bottom)
                HandleBar(colors: bar, width: barWidth)
                    .frame(width: curveSize.width, height: curveSize.height)
                    .position(curveCenter)
            }
        }
        .allowsHitTesting(false)
    }
}

/// Centre line of the handle: leaves the top mount, bows outwards, returns to the bottom mount.
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

/// A round bar shaded like a cylinder lit from the top left.
private struct HandleBar: View {
    let colors: [Color]
    let width: CGFloat

    var body: some View {
        ZStack {
            HandleCurve()
                .stroke(colors[0], style: StrokeStyle(lineWidth: width, lineCap: .round))
            HandleCurve()
                .stroke(colors[1], style: StrokeStyle(lineWidth: width * 0.62, lineCap: .round))
                .offset(x: -width * 0.1)
            HandleCurve()
                .stroke(colors[2], style: StrokeStyle(lineWidth: width * 0.2, lineCap: .round))
                .offset(x: -width * 0.2)
                .opacity(0.9)
        }
    }
}

private struct HandleMount: View {
    let colors: [Color]
    let size: CGSize

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: min(size.width, size.height) * 0.48, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.9), Color.black.opacity(0.35)],
                                              startPoint: .top, endPoint: .bottom),
                               lineWidth: max(0.6, size.width * 0.05))
            VStack(spacing: size.height * 0.4) {
                Screw(size: size.width * 0.17)
                Screw(size: size.width * 0.17)
            }
        }
        .frame(width: size.width, height: size.height)
        .shadow(color: Color.black.opacity(0.3), radius: size.width * 0.08, x: size.width * 0.06, y: size.width * 0.1)
    }
}

private struct Screw: View {
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [Color.white, Color(white: 0.55)],
                                 center: UnitPoint(x: 0.35, y: 0.3),
                                 startRadius: 0, endRadius: size * 0.7))
            .overlay {
                Circle().strokeBorder(Color.black.opacity(0.35), lineWidth: max(0.4, size * 0.12))
            }
            .frame(width: size, height: size)
    }
}

/// Seam line for tinted and clear Home Screen modes, where the system removes the door background.
struct DoorOutlineView: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let y = geo.size.height * DoorGeometry.seam
            Path { path in
                path.move(to: CGPoint(x: w * 0.06, y: y))
                path.addLine(to: CGPoint(x: w * 0.94, y: y))
            }
            .stroke(Color.white.opacity(0.35), lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}
