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
            MetalStarView()
                .frame(width: size * 1.2, height: size * 1.2)
                .shadow(color: Color.black.opacity(0.35), radius: size * 0.06, x: size * 0.05, y: size * 0.08)
        case .strawberry:
            EmojiFastener(emoji: "🍓", size: size)
        case .daisy:
            EmojiFastener(emoji: "🌼", size: size)
        }
    }
}

/// Glossy round magnet lit from the top left.
struct RoundMagnetView: View {
    /// Light, base and dark tone.
    let tones: [UInt32]
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: tones.map { Color(hex: $0) },
                                     center: UnitPoint(x: 0.36, y: 0.3),
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
                .offset(x: -size * 0.12, y: -size * 0.17)
        }
        .frame(width: size, height: size)
        .shadow(color: Color.black.opacity(0.35), radius: size * 0.05, x: size * 0.05, y: size * 0.08)
        .shadow(color: Color.black.opacity(0.18), radius: size * 0.16, x: size * 0.08, y: size * 0.16)
    }
}

struct MetalDiscView: View {
    let size: CGFloat

    var body: some View {
        ZStack {
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

private struct EmojiFastener: View {
    let emoji: String
    let size: CGFloat

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 1.05))
            .frame(width: size * 1.3, height: size * 1.3)
            .shadow(color: Color.black.opacity(0.4), radius: size * 0.03, x: size * 0.03, y: size * 0.05)
            .shadow(color: Color.black.opacity(0.2), radius: size * 0.12, x: size * 0.06, y: size * 0.12)
    }
}

/// Faceted metal star. Every ray has a lit and a shaded side.
struct MetalStarView: View {
    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height * 0.53)
            let outer = min(size.width, size.height) * 0.5
            let inner = outer * 0.46
            var tips: [CGPoint] = []
            var valleys: [CGPoint] = []
            for index in 0..<5 {
                let angle = -Double.pi / 2 + Double(index) * 2 * Double.pi / 5
                tips.append(CGPoint(x: center.x + outer * CGFloat(cos(angle)),
                                    y: center.y + outer * CGFloat(sin(angle))))
                let valleyAngle = angle + Double.pi / 5
                valleys.append(CGPoint(x: center.x + inner * CGFloat(cos(valleyAngle)),
                                       y: center.y + inner * CGFloat(sin(valleyAngle))))
            }

            let light = -3 * Double.pi / 4
            for index in 0..<5 {
                let tip = tips[index]
                let sides = [valleys[(index + 4) % 5], valleys[index]]
                for (sideIndex, valley) in sides.enumerated() {
                    var facet = Path()
                    facet.move(to: center)
                    facet.addLine(to: tip)
                    facet.addLine(to: valley)
                    facet.closeSubpath()
                    let mid = CGPoint(x: (tip.x + valley.x) / 2 - center.x, y: (tip.y + valley.y) / 2 - center.y)
                    let facing = atan2(Double(mid.y), Double(mid.x))
                    let shade = 0.5 + 0.5 * cos(facing - light)
                    let tone = 0.36 + 0.56 * shade + (sideIndex == 0 ? 0.05 : -0.05)
                    context.fill(facet, with: .color(Color(white: min(1, max(0, tone)))))
                }
            }

            var outline = Path()
            for index in 0..<5 {
                if index == 0 {
                    outline.move(to: tips[index])
                } else {
                    outline.addLine(to: tips[index])
                }
                outline.addLine(to: valleys[index])
            }
            outline.closeSubpath()
            context.stroke(outline, with: .color(Color.white.opacity(0.55)), lineWidth: max(0.5, outer * 0.03))
        }
    }
}
