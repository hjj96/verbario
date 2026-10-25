// Typed view of Resources/Data/fx.json: the numbers of systems/fx.js and fx/{common,particles,signals,
// lightpool,life}.js the FX simulation reads — quality budgets, fixed source colours, particle presets,
// signal / light-pool / gull constants, and the per-kind particle material defaults the renderer uses.
// Plus fx/common.js's helpers (clamp01, smooth, lum, isOrange, the lightning envelopes, toColor).

/// QUALITY[q] (DESIGN §8.2 budgets).
public struct FxBudget: Equatable, Sendable {
  public var rain: Int
  public var motes: Int
  public var downwash: Int
  public var crest: Int
  public var crestProbes: Int
  public var splash: Int
  public var smoke: Int
  public var glow: Int
  public var scud: Int
  public var fogLayers: Int
  public var gulls: Int
  public var seaSmoke: Bool
  public var dolphins: Int
  public var jelly: Int
}

/// A particle behaviour preset { drag, accY, wind, flags, emissive, spin } (constant per effect type).
public struct ParticlePreset: Equatable, Sendable {
  public var drag: Double
  public var accY: Double
  public var wind: Double
  public var flags: Double
  public var emissive: Double
  public var spin: Double

  public init(drag: Double, accY: Double, wind: Double, flags: Double, emissive: Double, spin: Double) {
    self.drag = drag
    self.accY = accY
    self.wind = wind
    self.flags = flags
    self.emissive = emissive
    self.spin = spin
  }

  init(json v: JSONValue, _ what: String) throws {
    drag = try v["drag"].requireDouble("\(what).drag")
    accY = try v["accY"].requireDouble("\(what).accY")
    wind = try v["wind"].requireDouble("\(what).wind")
    flags = v["flags"].double ?? 0
    emissive = v["emissive"].double ?? 0
    spin = v["spin"].double ?? 0
  }
}

/// particles.js KIND[kind]: the material defaults of a pool (the renderer's uniforms).
public struct ParticleKindSpec: Equatable, Sendable {
  /// THREE blending: 1 = normal (alpha), 2 = additive
  public var blending: Int
  public var maxStretch: Double
  public var stretch: Double
  public var fadeIn: Double
  public var fadeOut: Double
  public var growth: Double
  public var push: Double
  public var beam: Double
  public var light: Double
  public var sun: Double
}

public struct FxTables {
  // ---- fx/common.js ---------------------------------------------------------------------------------
  public let quality: [String: FxBudget]
  /// COLORS (hex as in the web)
  public let colorHex: [String: String]

  // ---- fx.js ------------------------------------------------------------------------------------------
  public let maxSpray: Int
  /// P[name]
  public let presets: [String: ParticlePreset]

  // ---- fx/particles.js ----------------------------------------------------------------------------------
  public let fSwirl: Double
  public let fStretch: Double
  public let fTwinkle: Double
  public let fFloat: Double
  public let fBio: Double
  public let fTurb: Double
  public let kinds: [String: ParticleKindSpec]

  // ---- fx/signals.js ---------------------------------------------------------------------------------------
  public let maxGlows: Int
  public let maxRings: Int
  public let pFlareSmoke: ParticlePreset
  public let pEmber: ParticlePreset
  public let pTrail: ParticlePreset
  public let maxFlares: Int
  public let maxRockets: Int
  public let flareLife: Double
  public let rocketRise: Double
  public let rocketDescent: Double
  public let lensCooldown: Double
  public let lensRange: Double
  public let lensDist: Double

  // ---- fx/lightpool.js ---------------------------------------------------------------------------------------
  public let physicalLights: Int
  public let hysteresis: Double

  // ---- fx/life.js --------------------------------------------------------------------------------------------
  public let gullPresets: Set<String>
  public let surfaceT: Double
  public let blow: ParticlePreset

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("fx"))
  }

  /// `json` = the payload of fx.json.
  public init(json d: JSONValue) throws {
    let c = d["fx/common"]
    var q = [String: FxBudget]()
    for (k, v) in try c["QUALITY"].requireObject("fx/common.QUALITY").entries {
      func i(_ key: String) throws -> Int { try v[key].requireInt("QUALITY.\(k).\(key)") }
      q[k] = FxBudget(rain: try i("rain"), motes: try i("motes"), downwash: try i("downwash"), crest: try i("crest"), crestProbes: try i("crestProbes"),
                      splash: try i("splash"), smoke: try i("smoke"), glow: try i("glow"), scud: try i("scud"), fogLayers: try i("fogLayers"),
                      gulls: try i("gulls"), seaSmoke: v["seaSmoke"].bool ?? false, dolphins: try i("dolphins"), jelly: try i("jelly"))
    }
    guard q["high"] != nil else { throw JSONError("fx/common.QUALITY.high missing") }
    quality = q
    var col = [String: String]()
    for (k, v) in try c["COLORS"].requireObject("fx/common.COLORS").entries { col[k] = try v.requireString("COLORS.\(k)") }
    colorHex = col

    let f = d["fx"]
    maxSpray = try f["MAX_SPRAY"].requireInt("fx.MAX_SPRAY")
    var ps = [String: ParticlePreset]()
    for (k, v) in try f["P"].requireObject("fx.P").entries { ps[k] = try ParticlePreset(json: v, "fx.P.\(k)") }
    presets = ps

    let p = d["fx/particles"]
    fSwirl = try p["F_SWIRL"].requireDouble("F_SWIRL")
    fStretch = try p["F_STRETCH"].requireDouble("F_STRETCH")
    fTwinkle = try p["F_TWINKLE"].requireDouble("F_TWINKLE")
    fFloat = try p["F_FLOAT"].requireDouble("F_FLOAT")
    fBio = try p["F_BIO"].requireDouble("F_BIO")
    fTurb = try p["F_TURB"].requireDouble("F_TURB")
    var ks = [String: ParticleKindSpec]()
    for (k, v) in try p["KIND"].requireObject("fx/particles.KIND").entries {
      func dd(_ key: String) throws -> Double { try v[key].requireDouble("KIND.\(k).\(key)") }
      ks[k] = ParticleKindSpec(blending: try v["blending"].requireInt("KIND.\(k).blending"), maxStretch: try dd("maxStretch"), stretch: try dd("stretch"),
                               fadeIn: try dd("fadeIn"), fadeOut: try dd("fadeOut"), growth: try dd("growth"), push: try dd("push"), beam: try dd("beam"),
                               light: try dd("light"), sun: try dd("sun"))
    }
    kinds = ks

    let s = d["fx/signals"]
    maxGlows = try s["MAX_GLOWS"].requireInt("fx/signals.MAX_GLOWS")
    maxRings = try s["MAX_RINGS"].requireInt("fx/signals.MAX_RINGS")
    pFlareSmoke = try ParticlePreset(json: s["P_FLARE_SMOKE"], "fx/signals.P_FLARE_SMOKE")
    pEmber = try ParticlePreset(json: s["P_EMBER"], "fx/signals.P_EMBER")
    pTrail = try ParticlePreset(json: s["P_TRAIL"], "fx/signals.P_TRAIL")
    maxFlares = try s["MAX_FLARES"].requireInt("fx/signals.MAX_FLARES")
    maxRockets = try s["MAX_ROCKETS"].requireInt("fx/signals.MAX_ROCKETS")
    flareLife = try s["FLARE_LIFE"].requireDouble("fx/signals.FLARE_LIFE")
    rocketRise = try s["ROCKET_RISE"].requireDouble("fx/signals.ROCKET_RISE")
    rocketDescent = try s["ROCKET_DESCENT"].requireDouble("fx/signals.ROCKET_DESCENT")
    lensCooldown = try s["LENS_COOLDOWN"].requireDouble("fx/signals.LENS_COOLDOWN")
    lensRange = try s["LENS_RANGE"].requireDouble("fx/signals.LENS_RANGE")
    lensDist = try s["LENS_DIST"].requireDouble("fx/signals.LENS_DIST")

    let l = d["fx/lightpool"]
    physicalLights = try l["PHYSICAL"].requireInt("fx/lightpool.PHYSICAL")
    hysteresis = try l["HYSTERESIS"].requireDouble("fx/lightpool.HYSTERESIS")

    let lf = d["fx/life"]
    gullPresets = Set(try lf["GULL_PRESETS"].requireArray("fx/life.GULL_PRESETS").map { try $0.requireString("GULL_PRESETS[]") })
    surfaceT = try lf["SURFACE_T"].requireDouble("fx/life.SURFACE_T")
    blow = try ParticlePreset(json: lf["BLOW"], "fx/life.BLOW")
  }

  /// QUALITY[q] ? q : 'high' (qualityOf)
  public func qualityName(_ q: String?) -> String { q.flatMap { quality[$0] != nil ? $0 : nil } ?? "high" }

  public var high: FxBudget { quality["high"]! }

  /// P[name] (a missing preset is a data error: a zero preset keeps the particle inert)
  public func preset(_ name: String) -> ParticlePreset {
    presets[name] ?? ParticlePreset(drag: 1, accY: 0, wind: 0, flags: 0, emissive: 0, spin: 0)
  }

  /// COLORS[name] in the linear working space (new THREE.Color(hex))
  public func color(_ name: String) -> Color3 { Color3(style: colorHex[name] ?? "#FFFFFF") }
}

// ---- fx/common.js helpers --------------------------------------------------------------------------------

public enum FxMath {
  @inline(__always) public static func clamp01(_ x: Double) -> Double { x < 0 ? 0 : x > 1 ? 1 : x }

  @inline(__always) public static func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
  }

  /// Rec.709 luminance of a linear colour
  @inline(__always) public static func lum(_ c: Color3) -> Double { 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

  /// Hue/saturation test for "this smoke colour is a signal orange" (survivor day smoke).
  public static func isOrange(_ c: Color3) -> Bool {
    let mx = JS.max(c.r, c.g, c.b)
    let mn = JS.min(c.r, c.g, c.b)
    if mx < 0.05 || (mx - mn) / mx < 0.55 { return false }
    return c.r >= mx - 1e-6 && c.b < 0.5 * c.r && c.g > 0.08 * c.r && c.g < 0.75 * c.r
  }

  /// Lightning stroke envelope (DESIGN §2.8 flash): three return strokes.
  public static func strokeEnvelope(_ t: Double) -> Double {
    var f = JS.exp(-t * 14)
    if t > 0.11 { f += 0.75 * JS.exp(-(t - 0.11) * 10) }
    if t > 0.23 { f += 0.45 * JS.exp(-(t - 0.23) * 7) }
    return JS.min(1, f)
  }

  /// reduceFlashes: one soft pulse (attack 120 ms, decay 600 ms).
  public static func softEnvelope(_ t: Double) -> Double {
    if t < 0 { return 0 }
    if t < 0.12 {
      let k = t / 0.12
      return k * k * (3 - 2 * k)
    }
    let d = (t - 0.12) / 0.6
    if d >= 1 { return 0 }
    let k = 1 - d
    return k * k * (3 - 2 * k)
  }
}

/// toColor(c): a colour string → linear working space, with the web's small string cache.
final class FxColorCache {
  private var cache: [String: Color3] = [:]

  func color(_ s: String) -> Color3 {
    if let c = cache[s] { return c }
    let c = Color3(style: s)
    if cache.count < 256 { cache[s] = c }
    return c
  }
}
