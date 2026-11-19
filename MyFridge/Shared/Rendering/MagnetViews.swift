import SwiftUI

// MARK: - Light

/// Where the light and the viewer are relative to the screen. Tilting the phone changes it:
/// highlights slide and each magnet shows a little more of one side.
struct MagnetLight: Equatable {
    /// -1...1 in both directions.
    var tilt: CGVector = .zero
    /// How strongly the tilt changes the visible side (1 on the door, more in the showcase).
    var depth: CGFloat = 1

    /// Offset of the back face per unit of thickness.
    func extrusion(base: CGVector) -> CGVector {
        CGVector(dx: base.dx - 0.6 * depth * tilt.dx, dy: base.dy - 0.5 * depth * tilt.dy)
    }

    /// Gloss offset in magnet units.
    var glossShift: CGVector {
        CGVector(dx: tilt.dx * 6 * depth, dy: tilt.dy * 6 * depth)
    }
}

private struct MagnetLightKey: EnvironmentKey {
    static let defaultValue = MagnetLight()
}

extension EnvironmentValues {
    var magnetLight: MagnetLight {
        get { self[MagnetLightKey.self] }
        set { self[MagnetLightKey.self] = newValue }
    }
}

// MARK: - Shapes

/// A path from a magnet's unit box, scaled to the frame.
struct ArtShape: Shape {
    let path: Path
    let unitSize: CGSize
    var offset: CGVector = .zero

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / max(unitSize.width, 1)
        let sy = rect.height / max(unitSize.height, 1)
        let transform = CGAffineTransform(a: sx, b: 0, c: 0, d: sy,
                                          tx: rect.minX + offset.dx * sx,
                                          ty: rect.minY + offset.dy * sy)
        return path.applying(transform)
    }
}

/// The side of a flat object: the silhouette repeated along the depth vector.
struct ExtrusionShape: Shape {
    let path: Path
    let unitSize: CGSize
    /// Offset of the back face, in unit space.
    var vector: CGVector
    let steps: Int

    /// Lets the side swing smoothly when a magnet springs back after being turned.
    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(vector.dx, vector.dy) }
        set { vector = CGVector(dx: newValue.first, dy: newValue.second) }
    }

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / max(unitSize.width, 1)
        let sy = rect.height / max(unitSize.height, 1)
        var result = Path()
        let count = max(steps, 1)
        for step in 1...count {
            let fraction = CGFloat(step) / CGFloat(count)
            let transform = CGAffineTransform(a: sx, b: 0, c: 0, d: sy,
                                              tx: rect.minX + vector.dx * fraction * sx,
                                              ty: rect.minY + vector.dy * fraction * sy)
            result.addPath(path, transform: transform)
        }
        return result
    }
}

// MARK: - Extruded surface

/// A flat object with thickness: side, face, crisp edge, bevel and gloss.
/// The caller sets the frame (matching `unitSize` aspect) and the shadow.
struct ExtrudedSurface<Face: View>: View {
    let outline: Path
    let unitSize: CGSize
    /// Thickness in unit space.
    let thickness: CGFloat
    let sides: [MagnetSide]
    let material: MagnetMaterial
    let gloss: [GlossSpot]
    let face: Face

    @Environment(\.magnetLight) private var light

    init(outline: Path, unitSize: CGSize, thickness: CGFloat, sides: [MagnetSide],
         material: MagnetMaterial, gloss: [GlossSpot], @ViewBuilder face: () -> Face) {
        self.outline = outline
        self.unitSize = unitSize
        self.thickness = thickness
        self.sides = sides
        self.material = material
        self.gloss = gloss
        self.face = face()
    }

    var body: some View {
        let library = MagnetLibrary.shared
        let look = library.look(for: material)
        let direction = light.extrusion(base: library.extrusion)
        let vector = CGVector(dx: direction.dx * thickness, dy: direction.dy * thickness)
        let edge = ArtShape(path: outline, unitSize: unitSize)
        let bevel = LinearGradient(stops: [
            Gradient.Stop(color: Color.white.opacity(look.bevelHighlight), location: 0),
            Gradient.Stop(color: Color.white.opacity(0), location: 0.45),
            Gradient.Stop(color: Color.black.opacity(0), location: 0.55),
            Gradient.Stop(color: Color.black.opacity(look.bevelShade), location: 1),
        ], startPoint: .topLeading, endPoint: .bottomTrailing)

        GeometryReader { geo in
            let scale = geo.size.width / max(unitSize.width, 1)
            ZStack {
                ForEach(sides.indices, id: \.self) { index in
                    ExtrusionShape(path: sides[index].path, unitSize: unitSize, vector: vector, steps: library.steps)
                        .fill(sides[index].color)
                }
                face
                edge.stroke(Color.black.opacity(0.22), lineWidth: max(0.4, 0.7 * scale))
                edge.stroke(bevel, lineWidth: library.bevelWidth * scale)
                    .clipShape(edge)
                GlossLayer(spots: gloss, unitSize: unitSize, look: look, shift: light.glossShift)
                    .clipShape(edge)
            }
        }
    }
}

private struct GlossLayer: View {
    let spots: [GlossSpot]
    let unitSize: CGSize
    let look: MaterialLook
    let shift: CGVector

    var body: some View {
        GeometryReader { geo in
            let scale = geo.size.width / max(unitSize.width, 1)
            ZStack(alignment: .topLeading) {
                ForEach(spots.indices, id: \.self) { index in
                    let spot = spots[index]
                    let cx = (spot.center.x + shift.dx) * scale
                    let cy = (spot.center.y + shift.dy) * scale
                    Ellipse()
                        .fill(EllipticalGradient(colors: [Color.white.opacity(look.gloss), Color.white.opacity(0)],
                                                 center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5))
                        .frame(width: spot.radii.width * 2 * scale, height: spot.radii.height * 2 * scale)
                        .rotationEffect(.degrees(spot.rotation))
                        .position(x: cx, y: cy)
                    if look.specular > 0 {
                        Ellipse()
                            .fill(EllipticalGradient(stops: [
                                Gradient.Stop(color: Color.white.opacity(look.specular), location: 0),
                                Gradient.Stop(color: Color.white.opacity(look.specular * 0.6), location: 0.7),
                                Gradient.Stop(color: Color.white.opacity(0), location: 1),
                            ], center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5))
                            .frame(width: spot.radii.width * 0.84 * scale, height: spot.radii.height * 0.6 * scale)
                            .rotationEffect(.degrees(spot.rotation))
                            .position(x: cx - spot.radii.width * 0.25 * scale, y: cy - spot.radii.height * 0.25 * scale)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Designed magnets

struct CatalogMagnetView: View {
    let art: MagnetArt

    var body: some View {
        ExtrudedSurface(outline: art.outline, unitSize: art.unitSize, thickness: art.thickness,
                        sides: art.sides, material: art.material, gloss: art.gloss) {
            MagnetFace(art: art)
        }
        .aspectRatio(art.aspect, contentMode: .fit)
    }
}

/// The painted layers. Kept separate so tilting the phone does not redraw them.
private struct MagnetFace: View {
    let art: MagnetArt

    var body: some View {
        GeometryReader { geo in
            let scale = geo.size.width / max(art.unitSize.width, 1)
            ZStack {
                ForEach(art.layers.indices, id: \.self) { index in
                    ArtShape(path: art.layers[index].path, unitSize: art.unitSize)
                        .fill(art.layers[index].fill.style(unitSize: art.unitSize, scale: scale))
                }
            }
        }
    }
}

// MARK: - Letters

extension LetterColor {
    /// Light, base, dark face tones and the side colour.
    var tones: [Color] {
        switch self {
        case .red: return [Color(hex: 0xFF6A5E), Color(hex: 0xE5322D), Color(hex: 0xB21F1B), Color(hex: 0x8A1512)]
        case .orange: return [Color(hex: 0xFFB45C), Color(hex: 0xF28C1B), Color(hex: 0xC96A06), Color(hex: 0x9A4F04)]
        case .yellow: return [Color(hex: 0xFFE680), Color(hex: 0xF7C81C), Color(hex: 0xD9A300), Color(hex: 0xA67C00)]
        case .green: return [Color(hex: 0x7BE095), Color(hex: 0x2FAE55), Color(hex: 0x1F8540), Color(hex: 0x16602E)]
        case .blue: return [Color(hex: 0x7DB2FF), Color(hex: 0x2F6FE4), Color(hex: 0x1F4FB0), Color(hex: 0x163A80)]
        case .purple: return [Color(hex: 0xC09CFF), Color(hex: 0x8C55DC), Color(hex: 0x6A35B5), Color(hex: 0x4D2484)]
        case .pink: return [Color(hex: 0xFFAED0), Color(hex: 0xF06AA0), Color(hex: 0xCC4A80), Color(hex: 0x9C3360)]
        case .white: return [Color(hex: 0xFFFFFF), Color(hex: 0xF1EFEA), Color(hex: 0xD8D4CB), Color(hex: 0xAFA99D)]
        }
    }
}

/// A thick plastic letter in a rounded heavy font.
struct LetterMagnetView: View {
    let letter: LetterMagnet

    @Environment(\.magnetLight) private var light

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let font = Font.system(size: height * 0.92, weight: .black, design: .rounded)
            let direction = light.extrusion(base: MagnetLibrary.shared.extrusion)
            let depth = height * 0.075
            let tones = letter.color.tones
            ZStack {
                ForEach(1...8, id: \.self) { step in
                    glyph(font)
                        .foregroundStyle(tones[3])
                        .offset(x: direction.dx * depth * CGFloat(step) / 8,
                                y: direction.dy * depth * CGFloat(step) / 8)
                }
                glyph(font)
                    .foregroundStyle(LinearGradient(colors: [tones[0], tones[1], tones[2]],
                                                    startPoint: .topLeading, endPoint: .bottomTrailing))
                glyph(font)
                    .foregroundStyle(LinearGradient(colors: [Color.white.opacity(0.55), Color.white.opacity(0)],
                                                    startPoint: UnitPoint(x: 0.3 + light.tilt.dx * 0.2, y: 0),
                                                    endPoint: UnitPoint(x: 0.5, y: 0.5)))
            }
            .frame(width: geo.size.width, height: height)
        }
    }

    private func glyph(_ font: Font) -> some View {
        Text(letter.character)
            .font(font)
            .fixedSize()
    }
}

// MARK: - Photo magnets

/// A cut-out photo sticker with a white edge and real thickness.
struct CutoutMagnetView: View {
    let image: UIImage?

    @Environment(\.magnetLight) private var light

    var body: some View {
        GeometryReader { geo in
            let direction = light.extrusion(base: MagnetLibrary.shared.extrusion)
            let depth = geo.size.width * 0.028
            ZStack {
                if let image {
                    ForEach(1...6, id: \.self) { step in
                        Image(uiImage: image)
                            .resizable()
                            .renderingMode(.template)
                            .scaledToFit()
                            .foregroundStyle(Color(hex: step == 6 ? 0xB9B2A5 : 0xD3CCBF))
                            .offset(x: direction.dx * depth * CGFloat(step) / 6,
                                    y: direction.dy * depth * CGFloat(step) / 6)
                    }
                    PhotoImage(image: image)
                        .scaledToFit()
                    LinearGradient(colors: [Color.white.opacity(0.35), Color.white.opacity(0), Color.black.opacity(0.1)],
                                   startPoint: UnitPoint(x: light.tilt.dx * 0.3, y: light.tilt.dy * 0.3),
                                   endPoint: .bottomTrailing)
                        .mask {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                        }
                        .allowsHitTesting(false)
                } else {
                    PhotoPlaceholder()
                        .clipShape(RoundedRectangle(cornerRadius: geo.size.width * 0.2, style: .continuous))
                }
            }
        }
    }
}

/// Unit-space outlines for round and heart photo magnets.
enum PhotoShapes {
    /// Leaves room below the face for the side.
    static let unitSize = CGSize(width: 100, height: 106)
    static let faceRect = CGRect(x: 2, y: 2, width: 96, height: 96)

    static let round = Path(ellipseIn: faceRect)

    static let heart: Path = {
        var raw = Path()
        for step in 0...240 {
            let t = Double(step) / 240 * 2 * Double.pi
            let x = 16 * pow(sin(t), 3)
            let y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)
            let point = CGPoint(x: x, y: -y)
            if step == 0 {
                raw.move(to: point)
            } else {
                raw.addLine(to: point)
            }
        }
        raw.closeSubpath()
        let bounds = raw.boundingRect
        let scale = min(faceRect.width / bounds.width, faceRect.height / bounds.height)
        let dx = faceRect.midX - bounds.midX * scale
        let dy = faceRect.midY - bounds.midY * scale
        return raw.applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: dx, ty: dy))
    }()

    static let gloss = [
        GlossSpot(center: CGPoint(x: 32, y: 26), radii: CGSize(width: 22, height: 12), rotation: -35),
        GlossSpot(center: CGPoint(x: 74, y: 78), radii: CGSize(width: 8, height: 4), rotation: -35),
    ]

    static func outline(for style: PhotoStyle) -> Path {
        style == .heart ? heart : round
    }
}

/// A photo under a glossy resin dome, round or heart-shaped.
struct ShapedPhotoMagnetView: View {
    let image: UIImage?
    let style: PhotoStyle

    var body: some View {
        let outline = PhotoShapes.outline(for: style)
        ExtrudedSurface(outline: outline, unitSize: PhotoShapes.unitSize, thickness: 6,
                        sides: [MagnetSide(path: outline, color: Color(hex: 0xC9C3B8))],
                        material: .glossy, gloss: PhotoShapes.gloss) {
            GeometryReader { geo in
                let scale = geo.size.width / PhotoShapes.unitSize.width
                let rect = CGRect(x: PhotoShapes.faceRect.minX * scale, y: PhotoShapes.faceRect.minY * scale,
                                  width: PhotoShapes.faceRect.width * scale, height: PhotoShapes.faceRect.height * scale)
                Group {
                    if let image {
                        PhotoImage(image: image)
                            .scaledToFill()
                    } else {
                        PhotoPlaceholder()
                    }
                }
                .frame(width: rect.width, height: rect.height)
                .clipped()
                .position(x: rect.midX, y: rect.midY)
                .clipShape(ArtShape(path: outline, unitSize: PhotoShapes.unitSize))
            }
        }
        .aspectRatio(PhotoShapes.unitSize.width / PhotoShapes.unitSize.height, contentMode: .fit)
    }
}
