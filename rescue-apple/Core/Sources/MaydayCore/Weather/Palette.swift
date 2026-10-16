// Palette packing & blending (systems/weather/palette.js).
//
// Every preset is compiled once into a flat array (colours as linear RGB triplets, angles as sin/cos
// pairs). A transition blends two such arrays slot by slot, each slot advancing with the progress of
// its own channel (colours/light, wind, rain, waves change on different schedules). The result is
// unpacked into the contract-shaped `Palette` (Palette+Fields.swift, generated from the exported
// layout). Bit-exact with Node 22: Tests/Vectors/weather/palette.json.

public enum PaletteKind: String, Sendable {
  case color // 3 floats, linear RGB
  case vec3 // 3 floats
  case angle // 2 floats: sin, cos of the angle in degrees
  case num // 1 float
}

public struct PaletteEntry: Equatable, Sendable {
  public let key: String
  public let kind: PaletteKind
  public let ch: Int // transition channel (PaletteChannel)
  public let group: String // "" = root, "post", "sea", "detect"
  public let o: Int // packed offset
  public let size: Int

  public init(key: String, kind: PaletteKind, ch: Int, group: String, o: Int, size: Int) {
    self.key = key
    self.kind = kind
    self.ch = ch
    self.group = group
    self.o = o
    self.size = size
  }

  /// OFF key: "sky", "post.slope", "sea.Hs"
  public var offKey: String { group.isEmpty ? key : group + "." + key }
}

/// Transition channels (CH_*).
public enum PaletteChannel {
  public static let color = 0 // sky, light, fog, grading
  public static let wind = 1 // wind, gusts, turbulence, hazard rates, intensity
  public static let rain = 2 // rain, lightning factor
  public static let wave = 3 // sea state
  public static let count = 4
}

/// A THREE.Color in the linear working space.
public struct PaletteColor: Equatable, Sendable {
  public var r: Double
  public var g: Double
  public var b: Double

  public init() {
    r = 1
    g = 1
    b = 1
  }

  public init(_ r: Double, _ g: Double, _ b: Double) {
    self.r = r
    self.g = g
    self.b = b
  }
}

/// three r185 ColorManagement for sRGB ↔ linear-sRGB (same primaries: transfer function only).
public enum SRGB {
  /// SRGBToLinear(c)
  @inline(__always) public static func toLinear(_ c: Double) -> Double {
    c < 0.04045 ? 0.0773993808 * c : JS.pow(0.9478672986 * c + 0.0521327014, 2.4)
  }

  /// LinearToSRGB(c)
  @inline(__always) public static func fromLinear(_ c: Double) -> Double {
    c < 0.0031308 ? 12.92 * c : 1.055 * JS.pow(c, 0.41666) - 0.055
  }

  /// THREE.Color.setHex(hex) (sRGB → linear working space).
  public static func color(hex: UInt32) -> PaletteColor {
    let r = Double((hex >> 16) & 255) / 255
    let g = Double((hex >> 8) & 255) / 255
    let b = Double(hex & 255) / 255
    return PaletteColor(toLinear(r), toLinear(g), toLinear(b))
  }

  /// THREE.Color.set("#rrggbb"). Only the 6-digit hex form (all the game's presets use it); nil otherwise.
  public static func color(_ style: String) -> PaletteColor? {
    guard style.hasPrefix("#"), style.count == 7, let v = UInt32(style.dropFirst(), radix: 16) else { return nil }
    return color(hex: v)
  }
}

extension Palette {
  /// unpack's angle: radToDeg(atan2(sin, cos)), wrapped to [0, 360).
  @inline(__always) public static func angleDegrees(_ s: Double, _ c: Double) -> Double {
    var deg = JS.atan2(s, c) * (180 / JS.PI)
    if deg < 0 { deg += 360 }
    return deg
  }

  /// The sea part as the wave bank reads it.
  public var seaState: SeaState { SeaState(Hs: sea.Hs, swellAdd: sea.swellAdd, Q: sea.Q, clearing: sea.clearing) }
}

/// Compiled presets + blend/green tables (palette.js COMPILED, SLOT_CHANNEL, OFF, GREEN_TARGET, GREEN_MUL).
public struct PaletteTables {
  public let layout: [PaletteEntry]
  public let slots: Int
  public let slotChannel: [Int]
  public let off: [String: Int]
  public let presetNames: [String]
  public let compiled: [String: [Double]]
  /// greenTint targets, packed: NaN = slot not affected.
  public let greenTarget: [Double]
  /// [(offset, multiplier)] in GREEN_TINT.mul order.
  public let greenMul: [(Int, Double)]

  /// From weather.json's `weather/presets` (PRESET_NAMES, PRESETS, GREEN_TINT) and the palette layout.
  public init(presets: JSONValue, layout: [PaletteEntry] = Palette.layout) throws {
    self.layout = layout
    var n = 0
    for e in layout { n = Swift.max(n, e.o + e.size) }
    slots = n
    var sc = [Int](repeating: 0, count: n)
    var off = [String: Int]()
    for e in layout {
      for i in 0..<e.size { sc[e.o + i] = e.ch }
      off[e.offKey] = e.o
    }
    slotChannel = sc
    self.off = off
    guard let names = presets["PRESET_NAMES"].strings else { throw JSONError("weather/presets.PRESET_NAMES missing") }
    presetNames = names
    var comp = [String: [Double]]()
    for name in names {
      let def = presets["PRESETS"][name]
      if !def.exists { throw JSONError("weather/presets.PRESETS.\(name) missing") }
      comp[name] = PaletteTables.compilePreset(def, layout: layout, slots: n)
    }
    compiled = comp
    var gt = [Double](repeating: .nan, count: n)
    let tint = presets["GREEN_TINT"]
    for e in layout where e.group.isEmpty && e.kind == .color {
      guard let hex = tint["colors"][e.key].string, let c = SRGB.color(hex) else { continue }
      gt[e.o] = c.r
      gt[e.o + 1] = c.g
      gt[e.o + 2] = c.b
    }
    greenTarget = gt
    var gm = [(Int, Double)]()
    for (k, v) in tint["mul"].object?.entries ?? [] {
      if let o = off[k], let m = v.double { gm.append((o, m)) }
    }
    greenMul = gm
  }

  public init(catalog: DataCatalog) throws {
    try self.init(presets: try catalog.data("weather")["weather/presets"])
  }

  /// compilePreset(def): one preset definition (weather.json PRESETS[name]) → packed array.
  public static func compilePreset(_ def: JSONValue, layout: [PaletteEntry] = Palette.layout, slots: Int = Palette.slots) -> [Double] {
    var a = [Double](repeating: 0, count: slots)
    for e in layout {
      let v = e.group.isEmpty ? def[e.key] : def[e.group][e.key]
      switch e.kind {
      case .color:
        // _c.set(v): "#rrggbb" string or a hex number
        let c: PaletteColor?
        if let s = v.string { c = SRGB.color(s) } else if let h = v.double { c = SRGB.color(hex: JSNumber.toUint32(h.rounded(.down))) } else { c = nil }
        a[e.o] = c?.r ?? .nan
        a[e.o + 1] = c?.g ?? .nan
        a[e.o + 2] = c?.b ?? .nan
      case .vec3:
        a[e.o] = v[0].double ?? .nan
        a[e.o + 1] = v[1].double ?? .nan
        a[e.o + 2] = v[2].double ?? .nan
      case .angle:
        let r = (v.double ?? .nan) * (JS.PI / 180) // THREE.MathUtils.degToRad
        a[e.o] = JS.sin(r)
        a[e.o + 1] = JS.cos(r)
      case .num:
        a[e.o] = v.double ?? .nan // undefined → NaN in a Float64Array
      }
    }
    return a
  }

  /// blendPacked(out, a, b, t): out = a + (b − a)·t[channel(slot)]
  public func blendPacked(_ out: inout [Double], _ a: [Double], _ b: [Double], _ t: [Double]) {
    for i in 0..<slots { out[i] = a[i] + (b[i] - a[i]) * t[slotChannel[i]] }
  }

  /// applyGreen(out, g): pull a packed palette towards the greenTint column (in place).
  public func applyGreen(_ out: inout [Double], _ g: Double) {
    if g <= 0 { return }
    for i in 0..<slots {
      let v = greenTarget[i]
      if v == v { out[i] += (v - out[i]) * g } // skip NaN
    }
    for (o, m) in greenMul { out[o] *= 1 + (m - 1) * g }
  }
}
