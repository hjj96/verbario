import SwiftUI

/// A separate magnet, disc or clip that holds a photo card or a note.
struct FastenerView: View {
    let kind: FastenerKind
    /// Diameter of a round magnet; other kinds are sized around it.
    let size: CGFloat

    var body: some View {
        switch kind {
        case .redMagnet:
            RoundMagnetView(tones: [0xF0576A, 0xC8102E, 0x6E0716], size: size)
        case .blueMagnet:
            RoundMagnetView(tones: [0x6F8CF5, 0x1537C4, 0x0A1A66], size: size)
        case .greenMagnet:
            RoundMagnetView(tones: [0x8DB07D, 0x3F6B3A, 0x1D3A1C], size: size)
        case .yellowMagnet:
            RoundMagnetView(tones: [0xFFE48A, 0xE9B526, 0x9A6E06], size: size)
        case .whiteMagnet:
            RoundMagnetView(tones: [0xFFFFFF, 0xEDEBE6, 0xA9A49A], size: size)
        case .metalDisc:
            MetalDiscView(size: size)
        case .clip:
            BinderClipView(size: size)
        case .star:
            MiniMagnet(id: "star", size: size * 1.25)
        case .strawberry:
            MiniMagnet(id: "strawberry", size: size * 1.3)
        case .daisy:
            MiniMagnet(id: "daisy", size: size * 1.3)
        }
    }
}

/// A small magnet from the collection used as a fastener.
private struct MiniMagnet: View {
    let id: String
    let size: CGFloat

    var body: some View {
        if let art = MagnetLibrary.shared.magnet(id) {
            CatalogMagnetView(art: art)
                .frame(width: size, height: size)
                .compositingGroup()
                .shadow(color: Color.black.opacity(0.35), radius: size * 0.03, x: size * 0.02, y: size * 0.05)
                .shadow(color: Color.black.opacity(0.18), radius: size * 0.1, x: size * 0.05, y: size * 0.1)
        } else {
            RoundMagnetView(tones: [0xF0576A, 0xC8102E, 0x6E0716], size: size * 0.8)
        }
    }
}

/// Glossy round magnet: a dome on a short puck, lit from the top left.
struct RoundMagnetView: View {
    /// Light, base and dark tone.
    let tones: [UInt32]
    let size: CGFloat

    @Environment(\.magnetLight) private var light

    var body: some View {
        let direction = light.extrusion(base: MagnetLibrary.shared.extrusion)
        let depth = size * 0.1
        ZStack {
            ForEach(1...5, id: \.self) { step in
                Circle()
                    .fill(Color(hex: tones[2]))
                    .offset(x: direction.dx * depth * CGFloat(step) / 5, y: direction.dy * depth * CGFloat(step) / 5)
            }
            Circle()
                .fill(RadialGradient(colors: tones.map { Color(hex: $0) },
                                     center: UnitPoint(x: 0.36 - light.tilt.dx * 0.08, y: 0.3 - light.tilt.dy * 0.08),
                                     startRadius: 0, endRadius: size * 0.65))
            Circle()
                .strokeBorder(LinearGradient(colors: [Color.white.opacity(0.35), Color.black.opacity(0.35)],
                                             startPoint: .top, endPoint: .bottom),
                              lineWidth: max(0.5, size * 0.05))
            Ellipse()
                .fill(LinearGradient(colors: [Color.white.opacity(0.9), Color.white.opacity(0)],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: size * 0.5, height: size * 0.3)
                .rotationEffect(.degrees(-25))
                .offset(x: -size * (0.12 - light.tilt.dx * 0.06), y: -size * (0.17 - light.tilt.dy * 0.06))
        }
        .frame(width: size, height: size)
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.35), radius: size * 0.05, x: size * 0.05, y: size * 0.08)
        .shadow(color: Color.black.opacity(0.18), radius: size * 0.16, x: size * 0.08, y: size * 0.16)
    }
}

struct MetalDiscView: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(white: 0.42))
                .offset(x: size * 0.02, y: size * 0.06)
            Circle()
                .fill(AngularGradient(colors: [Color(white: 0.95), Color(white: 0.6), Color(white: 0.88),
                                               Color(white: 0.55), Color(white: 0.95)],
                                      center: .center))
            Circle()
                .strokeBorder(LinearGradient(colors: [Color.white, Color.black.opacity(0.45)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing),
                              lineWidth: max(0.6, size * 0.08))
            Circle()
                .fill(RadialGradient(colors: [Color.white.opacity(0.9), Color.white.opacity(0)],
                                     center: UnitPoint(x: 0.35, y: 0.3),
                                     startRadius: 0, endRadius: size * 0.35))
        }
        .frame(width: size, height: size)
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.35), radius: size * 0.05, x: size * 0.05, y: size * 0.08)
    }
}

/// A small binder clip: a metal body and a folded wire handle.
struct BinderClipView: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            ClipWire()
                .stroke(LinearGradient(colors: [Color(white: 0.97), Color(white: 0.5)],
                                       startPoint: .leading, endPoint: .trailing),
                        style: StrokeStyle(lineWidth: max(1, size * 0.08), lineCap: .round, lineJoin: .round))
                .frame(width: size * 0.82, height: size * 0.62)
                .offset(y: -size * 0.24)
            RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                .fill(Color(white: 0.4))
                .frame(width: size * 1.1, height: size * 0.5)
                .offset(x: size * 0.02, y: size * 0.18)
            RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                .fill(LinearGradient(colors: [Color(white: 0.95), Color(white: 0.62), Color(white: 0.82)],
                                     startPoint: .top, endPoint: .bottom))
                .overlay {
                    RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                        .strokeBorder(Color.black.opacity(0.35), lineWidth: max(0.5, size * 0.03))
                }
                .frame(width: size * 1.1, height: size * 0.5)
                .offset(y: size * 0.14)
        }
        .frame(width: size * 1.2, height: size * 1.2)
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.35), radius: size * 0.05, x: size * 0.04, y: size * 0.08)
    }
}

private struct ClipWire: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let left = rect.minX + rect.width * 0.12
        let right = rect.maxX - rect.width * 0.12
        path.move(to: CGPoint(x: left, y: rect.maxY))
        path.addLine(to: CGPoint(x: left, y: rect.minY + rect.height * 0.35))
        path.addQuadCurve(to: CGPoint(x: right, y: rect.minY + rect.height * 0.35),
                          control: CGPoint(x: rect.midX, y: rect.minY - rect.height * 0.25))
        path.addLine(to: CGPoint(x: right, y: rect.maxY))
        return path
    }
}
