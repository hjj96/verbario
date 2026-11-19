import SwiftUI

/// A flat die-cut sticker: the cut-out with its white edge, a laminated sheen and,
/// for the holographic kind, a rainbow film that shifts as the phone tilts.
struct StickerView: View {
    let image: UIImage?
    var isHolographic = false

    @Environment(\.magnetLight) private var light

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image {
                    PhotoImage(image: image)
                        .scaledToFit()
                    if isHolographic {
                        HoloFilm(tilt: light.tilt)
                            .opacity(0.55)
                            .mask {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFit()
                            }
                            .blendMode(.overlay)
                        // Tints the white edge too, so the whole sticker reads as foil.
                        HoloFilm(tilt: light.tilt)
                            .opacity(0.3)
                            .mask {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFit()
                            }
                            .blendMode(.multiply)
                        GlitterStripes(tilt: light.tilt)
                            .mask {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFit()
                            }
                            .blendMode(.screen)
                    }
                    LaminateSheen(tilt: light.tilt, strength: isHolographic ? 0.45 : 0.32)
                        .mask {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                        }
                } else {
                    PhotoPlaceholder()
                        .clipShape(RoundedRectangle(cornerRadius: geo.size.width * 0.2, style: .continuous))
                }
            }
            .compositingGroup()
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// The soft diagonal reflection of a laminated sticker.
private struct LaminateSheen: View {
    let tilt: CGVector
    let strength: Double

    var body: some View {
        let shift = (tilt.dx + tilt.dy) * 0.18
        LinearGradient(stops: [
            Gradient.Stop(color: Color.white.opacity(0), location: 0),
            Gradient.Stop(color: Color.white.opacity(0), location: max(0, 0.28 + shift)),
            Gradient.Stop(color: Color.white.opacity(strength), location: min(1, 0.4 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: min(1, 0.52 + shift)),
            Gradient.Stop(color: Color.white.opacity(0), location: 1),
        ], startPoint: .topLeading, endPoint: .bottomTrailing)
        .allowsHitTesting(false)
    }
}

/// Iridescent film: a rainbow that turns with the phone.
private struct HoloFilm: View {
    let tilt: CGVector

    var body: some View {
        AngularGradient(colors: [
            Color(hex: 0xFF8FD8), Color(hex: 0xFFE27A), Color(hex: 0x8CF5C4),
            Color(hex: 0x7FD3FF), Color(hex: 0xB59BFF), Color(hex: 0xFF8FD8),
        ], center: UnitPoint(x: 0.6 + tilt.dx * 0.35, y: 0.4 + tilt.dy * 0.35),
           angle: .degrees(Double(40 + tilt.dx * 120 + tilt.dy * 60)))
        .allowsHitTesting(false)
    }
}

/// Fine diagonal glints across a holographic sticker.
private struct GlitterStripes: View {
    let tilt: CGVector

    var body: some View {
        let offset = (tilt.dx - tilt.dy) * 0.12
        var stops: [Gradient.Stop] = []
        let bands = 9
        for band in 0..<bands {
            let start = CGFloat(band) / CGFloat(bands)
            let center = (start + 0.5 / CGFloat(bands) + offset).truncatingRemainder(dividingBy: 1)
            let low = max(0, center - 0.02)
            let high = min(1, center + 0.02)
            stops.append(Gradient.Stop(color: Color.white.opacity(0), location: low))
            stops.append(Gradient.Stop(color: Color.white.opacity(band % 2 == 0 ? 0.35 : 0.18), location: center.clamped(to: 0...1)))
            stops.append(Gradient.Stop(color: Color.white.opacity(0), location: high))
        }
        stops.sort { $0.location < $1.location }
        return LinearGradient(stops: stops, startPoint: .topLeading, endPoint: .bottomTrailing)
            .allowsHitTesting(false)
    }
}
