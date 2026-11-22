import SwiftUI

/// Surface finish of a magnet: how strong its bevel and gloss are.
enum MagnetMaterial: String, Decodable, Hashable {
    case glossy, ceramic, metal, matte

    var title: String {
        switch self {
        case .glossy: return "Glossy enamel"
        case .ceramic: return "Ceramic"
        case .metal: return "Metal"
        case .matte: return "Matte ceramic"
        }
    }
}

struct MaterialLook: Equatable {
    var bevelHighlight: Double
    var bevelShade: Double
    var gloss: Double
    var specular: Double
}

struct MagnetSet: Identifiable, Hashable {
    let id: String
    let title: String
    let caption: String
}

/// A colour fill in the magnet's own unit space (gradients use the magnet's box).
struct MagnetFill: Equatable {
    enum Kind: String {
        case solid, linear, radial
    }

    struct Stop: Equatable {
        var location: CGFloat
        var color: Color
    }

    var kind: Kind
    var stops: [Stop]
    var from: CGPoint = .zero
    var to: CGPoint = .zero
    var center: CGPoint = .zero
    var radius: CGFloat = 0

    func style(unitSize: CGSize, scale: CGFloat) -> AnyShapeStyle {
        let gradient = Gradient(stops: stops.map { Gradient.Stop(color: $0.color, location: $0.location) })
        switch kind {
        case .solid:
            return AnyShapeStyle(stops.first?.color ?? Color.clear)
        case .linear:
            return AnyShapeStyle(LinearGradient(gradient: gradient,
                                                startPoint: unitPoint(from, in: unitSize),
                                                endPoint: unitPoint(to, in: unitSize)))
        case .radial:
            return AnyShapeStyle(RadialGradient(gradient: gradient,
                                                center: unitPoint(center, in: unitSize),
                                                startRadius: 0,
                                                endRadius: max(radius * scale, 1)))
        }
    }

    private func unitPoint(_ point: CGPoint, in size: CGSize) -> UnitPoint {
        UnitPoint(x: point.x / max(size.width, 1), y: point.y / max(size.height, 1))
    }
}

struct MagnetSide {
    var path: Path
    var color: Color
}

struct MagnetLayer {
    var path: Path
    var fill: MagnetFill
}

/// A soft highlight on the surface, in unit space.
struct GlossSpot: Equatable {
    var center: CGPoint
    var radii: CGSize
    var rotation: Double
}

/// One designed magnet from `Magnets.json`: a flat object with a silhouette, a side,
/// painted layers and gloss. Coordinates are in the magnet's own box (`unitSize`).
struct MagnetArt: Identifiable, Hashable {
    let id: String
    let title: String
    let setID: String
    let note: String
    let material: MagnetMaterial
    let thickness: CGFloat
    let unitSize: CGSize
    /// Default width on the door as a fraction of the door width.
    let doorWidth: CGFloat
    let outline: Path
    let sides: [MagnetSide]
    let layers: [MagnetLayer]
    let gloss: [GlossSpot]

    var aspect: CGFloat { unitSize.width / max(unitSize.height, 1) }

    static func == (lhs: MagnetArt, rhs: MagnetArt) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Loads the designed magnet collection once. Shared by the app and the widget
/// (the JSON file is bundled into both).
final class MagnetLibrary {
    static let shared = MagnetLibrary()

    let sets: [MagnetSet]
    let magnets: [MagnetArt]
    /// Extrusion direction per unit of thickness (x, y).
    let extrusion: CGVector
    let steps: Int
    let bevelWidth: CGFloat
    private let looks: [MagnetMaterial: MaterialLook]
    private let byID: [String: MagnetArt]

    private init() {
        var sets: [MagnetSet] = []
        var magnets: [MagnetArt] = []
        var extrusion = CGVector(dx: 0.28, dy: 1)
        var steps = 10
        var bevel: CGFloat = 4
        var looks: [MagnetMaterial: MaterialLook] = [:]

        if let url = Bundle.main.url(forResource: "Magnets", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let raw = try? JSONDecoder().decode(RawLibrary.self, from: data) {
            sets = raw.sets.map { MagnetSet(id: $0.id, title: $0.title, caption: $0.caption) }
            magnets = raw.magnets.map { $0.art() }
            if raw.render.extrusion.count == 2 {
                extrusion = CGVector(dx: raw.render.extrusion[0], dy: raw.render.extrusion[1])
            }
            steps = max(2, raw.render.steps)
            bevel = raw.render.bevel
            for (name, look) in raw.render.materials {
                if let material = MagnetMaterial(rawValue: name) {
                    looks[material] = MaterialLook(bevelHighlight: look.bevelHi, bevelShade: look.bevelLo,
                                                   gloss: look.gloss, specular: look.specular)
                }
            }
        }

        self.sets = sets
        self.magnets = magnets
        self.extrusion = extrusion
        self.steps = steps
        self.bevelWidth = bevel
        self.looks = looks
        self.byID = Dictionary(magnets.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    func magnet(_ id: String) -> MagnetArt? {
        byID[id]
    }

    func magnets(in set: MagnetSet) -> [MagnetArt] {
        magnets.filter { $0.setID == set.id }
    }

    func look(for material: MagnetMaterial) -> MaterialLook {
        looks[material] ?? MaterialLook(bevelHighlight: 0.6, bevelShade: 0.3, gloss: 0.5, specular: 0.7)
    }
}

// MARK: - Decoding

private struct RawLibrary: Decodable {
    struct Render: Decodable {
        struct Look: Decodable {
            var bevelHi: Double
            var bevelLo: Double
            var gloss: Double
            var specular: Double
        }

        var extrusion: [CGFloat]
        var steps: Int
        var bevel: CGFloat
        var materials: [String: Look]
    }

    struct RawSet: Decodable {
        var id: String
        var title: String
        var caption: String
    }

    var render: Render
    var sets: [RawSet]
    var magnets: [RawMagnet]
}

private struct RawFill: Decodable {
    var type: String
    var stops: [RawStop]
    var from: [CGFloat]?
    var to: [CGFloat]?
    var center: [CGFloat]?
    var radius: CGFloat?

    var fill: MagnetFill {
        MagnetFill(kind: MagnetFill.Kind(rawValue: type) ?? .solid,
                   stops: stops.map { MagnetFill.Stop(location: $0.location, color: Color(hexString: $0.color).opacity($0.alpha)) },
                   from: point(from),
                   to: point(to),
                   center: point(center),
                   radius: radius ?? 0)
    }

    private func point(_ values: [CGFloat]?) -> CGPoint {
        guard let values, values.count == 2 else { return .zero }
        return CGPoint(x: values[0], y: values[1])
    }
}

/// A gradient stop stored as `[location, "#RRGGBB", alpha]`.
private struct RawStop: Decodable {
    var location: CGFloat
    var color: String
    var alpha: Double

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        location = try container.decode(CGFloat.self)
        color = try container.decode(String.self)
        alpha = try container.decode(Double.self)
    }
}

private struct RawMagnet: Decodable {
    struct RawSide: Decodable {
        var d: String
        var color: String
    }

    struct RawLayer: Decodable {
        var d: String
        var fill: RawFill
    }

    var id: String
    var title: String
    var set: String
    var note: String
    var material: String
    var thickness: CGFloat
    var w: CGFloat
    var h: CGFloat
    var doorWidth: CGFloat
    var outline: String
    var sides: [RawSide]
    var layers: [RawLayer]
    var gloss: [[Double]]

    func art() -> MagnetArt {
        MagnetArt(id: id,
                  title: title,
                  setID: set,
                  note: note,
                  material: MagnetMaterial(rawValue: material) ?? .glossy,
                  thickness: thickness,
                  unitSize: CGSize(width: w, height: h),
                  doorWidth: doorWidth,
                  outline: SVGPath.parse(outline),
                  sides: sides.map { MagnetSide(path: SVGPath.parse($0.d), color: Color(hexString: $0.color)) },
                  layers: layers.map { MagnetLayer(path: SVGPath.parse($0.d), fill: $0.fill.fill) },
                  gloss: gloss.compactMap { values in
                      guard values.count == 5 else { return nil }
                      return GlossSpot(center: CGPoint(x: values[0], y: values[1]),
                                       radii: CGSize(width: values[2], height: values[3]),
                                       rotation: values[4])
                  })
    }
}

/// Reads the small path dialect written by the design tool: `M x y L x y x y … Z`.
enum SVGPath {
    static func parse(_ text: String) -> Path {
        var path = Path()
        var command: Character = "M"
        var pendingX: CGFloat?
        for token in text.split(separator: " ") {
            guard let first = token.first else { continue }
            if first.isLetter {
                command = first
                pendingX = nil
                if first == "Z" || first == "z" {
                    path.closeSubpath()
                }
                continue
            }
            guard let value = Double(token) else { continue }
            if let x = pendingX {
                let point = CGPoint(x: x, y: CGFloat(value))
                if command == "M" {
                    path.move(to: point)
                    command = "L"
                } else {
                    path.addLine(to: point)
                }
                pendingX = nil
            } else {
                pendingX = CGFloat(value)
            }
        }
        return path
    }
}

extension Color {
    /// `#RRGGBB` colour.
    init(hexString: String) {
        let digits = hexString.hasPrefix("#") ? String(hexString.dropFirst()) : hexString
        self.init(hex: UInt32(digits, radix: 16) ?? 0x888888)
    }
}
