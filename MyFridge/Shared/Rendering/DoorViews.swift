import SwiftUI

/// Colours of one door finish.
struct DoorPalette {
    var panel: [Color]
    var rim: [Color]
    /// Rim width as a fraction of the door width.
    var rimWidth: CGFloat
    var rimIsEnamel: Bool
    var brushOpacity: Double
    /// Handle bar: shade, body, highlight.
    var bar: [Color]
    /// Handle mounts, top to bottom.
    var mount: [Color]
}

extension DoorStyle {
    var palette: DoorPalette {
        let chromeBar = [Color(hex: 0x5F656C), Color(hex: 0xC9CDD2), Color(hex: 0xFFFFFF)]
        let chromeMount = [Color(hex: 0xF7F8F9), Color(hex: 0xB3B8BE), Color(hex: 0x737980)]
        let steelPanel = [Color(hex: 0xDCDFE2), Color(hex: 0xC1C5CA), Color(hex: 0xA2A7AD)]
        switch self {
        case .steel:
            return DoorPalette(panel: steelPanel,
                               rim: [Color(hex: 0xF3F4F5), Color(hex: 0xC4C8CC), Color(hex: 0x878C92)],
                               rimWidth: 0.02, rimIsEnamel: false, brushOpacity: 0.9,
                               bar: chromeBar, mount: chromeMount)
        case .warm:
            return DoorPalette(panel: [Color(hex: 0xDCD3C9), Color(hex: 0xC0B5A9), Color(hex: 0x9F9488)],
                               rim: [Color(hex: 0xF0EAE3), Color(hex: 0xC3B9AE), Color(hex: 0x877C71)],
                               rimWidth: 0.02, rimIsEnamel: false, brushOpacity: 0.8,
                               bar: [Color(hex: 0xB09B74), Color(hex: 0xEADFC4), Color(hex: 0xFFFBF0)],
                               mount: chromeMount)
        case .enamel:
            return DoorPalette(panel: steelPanel,
                               rim: [Color(hex: 0xBBD5EF), Color(hex: 0x8DB4DB), Color(hex: 0x5E8BBA)],
                               rimWidth: 0.045, rimIsEnamel: true, brushOpacity: 0.9,
                               bar: chromeBar, mount: chromeMount)
        }
    }
}

/// The door without the handle: rim, brushed panel, top cap and seam.
/// Fills the proposed rectangle; the caller (or the widget container) clips the corners.
struct DoorBackgroundView: View {
    let style: DoorStyle

    var body: some View {
        GeometryReader { geo in
            let palette = style.palette
            let rim = geo.size.width * palette.rimWidth
            ZStack {
                LinearGradient(colors: palette.rim, startPoint: .top, endPoint: .bottom)
                if palette.rimIsEnamel {
                    LinearGradient(stops: [
                        .init(color: Color.white.opacity(0.55), location: 0),
                        .init(color: Color.white.opacity(0), location: 0.3),
                        .init(color: Color.black.opacity(0), location: 0.75),
                        .init(color: Color.black.opacity(0.18), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
                DoorPanelView(palette: palette, cornerRadius: max(geo.size.width * 0.045, 6))
                    .padding(rim)
            }
        }
    }
}

/// Brushed metal panel with soft reflections, the top cap and the seam under it.
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
                BrushedMetalTexture()
                    .opacity(palette.brushOpacity)
                LinearGradient(stops: [
                    .init(color: Color.white.opacity(0), location: 0),
                    .init(color: Color.white.opacity(0.24), location: 0.3),
                    .init(color: Color.white.opacity(0), location: 0.46),
                    .init(color: Color.white.opacity(0.12), location: 0.64),
                    .init(color: Color.white.opacity(0), location: 0.8),
                ], startPoint: .topLeading, endPoint: .bottomTrailing)
                LinearGradient(colors: [Color.white.opacity(0.4), Color.white.opacity(0.05)],
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

/// The chrome (or cream) handle with two mounts. Drawn above the magnets.
struct DoorHandleView: View {
    let style: DoorStyle

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let palette = style.palette
            let x = w * DoorGeometry.handleX
            let top = h * DoorGeometry.handleTop
            let bottom = h * DoorGeometry.handleBottom
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
                HandleMount(colors: palette.mount, size: mountSize)
                    .position(x: x, y: top)
                HandleMount(colors: palette.mount, size: mountSize)
                    .position(x: x, y: bottom)
                HandleBar(colors: palette.bar, width: barWidth)
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
        let shape = RoundedRectangle(cornerRadius: size.width * 0.45, style: .continuous)
        ZStack {
            shape.fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
            shape.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.9), Color.black.opacity(0.35)],
                                              startPoint: .top, endPoint: .bottom),
                               lineWidth: max(0.6, size.width * 0.05))
            VStack(spacing: size.height * 0.42) {
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
