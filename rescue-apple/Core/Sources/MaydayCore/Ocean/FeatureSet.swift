// Ocean surface features (systems/ocean/features.js): rogue waves, spout vortices, whirlpools and
// the rotor downwash dimple — vertical displacement that WaveBank.heightAt() includes, plus the
// horizontal swirl flow. Slot packing (uA/uB/uC, Float32) feeds the ocean shader.

public enum FeatureType: Int, Sendable {
  case rogue = 1
  case vortex = 2
  case whirlpool = 3

  /// FEATURE_TYPE[name]
  public init?(name: String) {
    switch name {
    case "rogue": self = .rogue
    case "vortex": self = .vortex
    case "whirlpool": self = .whirlpool
    default: return nil
    }
  }
}

/// The `f` argument of FeatureSet.set(id, f). Optional fields are JS `undefined` (defaults applied in set()).
public struct FeatureSpec: Sendable {
  public var type: String // "rogue" | "vortex" | "whirlpool"
  // rogue: origin (x, z) — f.origin || f.position || {x: f.x ?? 0, y: f.z ?? 0}
  public var x: Double?
  public var z: Double?
  /// rogue: direction (x, z) — f.dir || {x: 1, y: 0}
  public var dirX: Double?
  public var dirZ: Double?
  public var width: Double? // rogue W, default 22
  public var length: Double? // rogue crest length, default 500
  public var speed: Double? // rogue, default 15
  public var height: Double? // rogue, default 14
  public var strength: Double? // default 1 (clamped 0…1 for vortex/whirlpool)
  public var radius: Double? // vortex 25 / whirlpool 45
  public var spin: Double? // vortex -1 / whirlpool 1

  public init(type: String, x: Double? = nil, z: Double? = nil, dirX: Double? = nil, dirZ: Double? = nil,
              width: Double? = nil, length: Double? = nil, speed: Double? = nil, height: Double? = nil,
              strength: Double? = nil, radius: Double? = nil, spin: Double? = nil) {
    self.type = type
    self.x = x
    self.z = z
    self.dirX = dirX
    self.dirZ = dirZ
    self.width = width
    self.length = length
    self.speed = speed
    self.height = height
    self.strength = strength
    self.radius = radius
    self.spin = spin
  }
}

/// Anything the wave bank can add to its height (FeatureSet in the game).
public protocol WaveFeatureField: AnyObject {
  var active: Bool { get }
  func heightAt(_ px: Double, _ pz: Double, _ tOff: Double) -> Double
}

public final class FeatureSet: WaveFeatureField {
  public static let MAX_FEATURES = 4
  public static let ROGUE_SCAR_LIFE: Double = 40 // s of lace scar after a rogue wave is removed
  public static let FADE_OUT: Double = 1.6 // s for a removed feature's height to settle

  public struct Slot {
    public var id: String
    public var type: FeatureType
    public var A: [Double] // type, x, z, height|strength (incl. fades)
    public var B: [Double] // rogue: dirX, dirZ, width W, crest length | others: radius, spin, 0, 0
    public var C: [Double] // rogue: carpet, age, speed, removed | others: age, 0, 0, 0
    public var speed: Double = 0
    public var height: Double = 0
    public var strength: Double = 1
    public var age: Double = 0
    public var removed = false
    public var removeAge: Double = 0
    public var fade: Double = 1
    public var fadeIn: Double = 0
  }

  public private(set) var slots: [Slot] = []
  public private(set) var uA = [Float](repeating: 0, count: 4 * FeatureSet.MAX_FEATURES)
  public private(set) var uB = [Float](repeating: 0, count: 4 * FeatureSet.MAX_FEATURES)
  public private(set) var uC = [Float](repeating: 0, count: 4 * FeatureSet.MAX_FEATURES)
  public private(set) var count = 0
  /// x, z, radius, strength (Float32Array in the web: values are rounded to Float on write)
  public private(set) var downwash = [Float](repeating: 0, count: 4)
  /// 0…1 lace residual after rogue waves (decays over 40 s)
  public private(set) var residual: Double = 0
  public private(set) var active = false

  public init() {}

  public func clear() {
    slots.removeAll()
    count = 0
    residual = 0
    downwash[3] = 0
    pack()
  }

  public func get(_ id: String) -> Slot? {
    for s in slots where s.id == id && !s.removed { return s }
    return nil
  }

  /// set(id, f): add or update a feature. Returns false for an unknown type.
  @discardableResult
  public func set(_ id: String, _ f: FeatureSpec) -> Bool {
    guard let type = FeatureType(name: f.type) else { return false }
    var index: Int? = nil
    for (i, x) in slots.enumerated() where x.id == id { index = i } // last match, like the JS loop
    if index == nil {
      if slots.count >= FeatureSet.MAX_FEATURES {
        // evict a removed (fading) slot first, else the oldest
        let victim = slots.firstIndex(where: { $0.removed }) ?? 0
        slots.remove(at: victim)
      }
      slots.append(Slot(id: id, type: type, A: [Double(type.rawValue), 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0]))
      index = slots.count - 1
    }
    guard let k = index else { return false }
    var s = slots[k]
    s.type = type
    s.removed = false
    s.fade = 1
    s.A[0] = Double(type.rawValue)
    if type == .rogue {
      s.A[1] = f.x ?? 0
      s.A[2] = f.z ?? 0
      let dx = f.dirX ?? 1
      let dz = f.dirZ ?? 0
      let h = JS.hypot(dx, dz)
      let l = JSNumber.isTruthy(h) ? h : 1
      s.B[0] = dx / l
      s.B[1] = dz / l
      s.B[2] = f.width ?? 22
      s.B[3] = f.length ?? 500
      s.speed = f.speed ?? 15
      s.height = f.height ?? 14
      s.strength = f.strength ?? 1
    } else {
      s.A[1] = f.x ?? 0
      s.A[2] = f.z ?? 0
      s.B[0] = f.radius ?? (type == .vortex ? 25 : 45)
      s.B[1] = f.spin ?? (type == .vortex ? -1 : 1) // spout base turns opposite to the whirlpool
      s.strength = MathUtil.clamp(f.strength ?? 1, 0, 1)
    }
    slots[k] = s
    pack()
    return true
  }

  public func remove(_ id: String) {
    for i in slots.indices where slots[i].id == id && !slots[i].removed {
      slots[i].removed = true
      slots[i].removeAge = 0
      if slots[i].type == .rogue { residual = 1 }
    }
    pack()
  }

  public func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) {
    downwash[0] = Float(x)
    downwash[1] = Float(z)
    downwash[2] = Float(JS.max(1, radius))
    downwash[3] = Float(MathUtil.clamp(strength, 0, 1))
    active = count > 0 || downwash[3] > 0
  }

  public func update(_ dt: Double) {
    var i = slots.count - 1
    while i >= 0 {
      var s = slots[i]
      s.age += dt
      s.fadeIn = JS.min(1, s.fadeIn + dt / 0.6)
      if s.type == .rogue {
        s.A[1] += s.B[0] * s.speed * dt
        s.A[2] += s.B[1] * s.speed * dt
      }
      var drop = false
      if s.removed {
        s.removeAge += dt
        s.fade = JS.max(0, 1 - s.removeAge / FeatureSet.FADE_OUT)
        let life = s.type == .rogue ? FeatureSet.ROGUE_SCAR_LIFE : FeatureSet.FADE_OUT
        if s.removeAge >= life { drop = true }
      }
      if drop { slots.remove(at: i) } else { slots[i] = s }
      i -= 1
    }
    if residual > 0 { residual = JS.max(0, residual - dt / FeatureSet.ROGUE_SCAR_LIFE) }
    pack()
  }

  func pack() {
    var n = 0
    for k in slots.indices {
      if n >= FeatureSet.MAX_FEATURES { break }
      let j = n * 4
      var s = slots[k]
      let ease = s.fadeIn * s.fadeIn * (3 - 2 * s.fadeIn)
      if s.type == .rogue {
        s.A[3] = s.height * s.strength * s.fade * ease
        s.C[0] = s.removed ? JS.max(0, 1 - s.removeAge / FeatureSet.ROGUE_SCAR_LIFE) : 1 // carpet/scar strength
        s.C[1] = s.age
        s.C[2] = s.speed
        s.C[3] = s.removed ? 1 : 0
      } else {
        s.A[3] = s.strength * s.fade * ease
        s.C[0] = s.age
        s.C[1] = 0
        s.C[2] = 0
        s.C[3] = 0
      }
      for c in 0..<4 {
        uA[j + c] = Float(s.A[c])
        uB[j + c] = Float(s.B[c])
        uC[j + c] = Float(s.C[c])
      }
      slots[k] = s
      n += 1
    }
    count = n
    active = n > 0 || downwash[3] > 0
  }

  // ---- field evaluation ---------------------------------------------------------------------------
  @inline(__always) static func sech2(_ q0: Double) -> Double {
    let q = JS.min(12, JS.abs(q0))
    let e = JS.exp(-2 * q)
    let s = (2 * JS.sqrt(e)) / (1 + e)
    return s * s
  }

  static func rogueHeight(_ px: Double, _ pz: Double, _ A: [Double], _ B: [Double], _ tOff: Double, _ speed: Double) -> Double {
    let cx = A[1] + B[0] * speed * tOff
    let cz = A[2] + B[1] * speed * tOff
    let rx = px - cx, rz = pz - cz
    let u = rx * B[0] + rz * B[1]
    let v = -rx * B[1] + rz * B[0]
    let ue = u + 0.0015 * v * v // crest bowed forward
    let lc = JS.max(B[3], 1)
    let e = JS.max(JS.abs(v) - 0.3 * lc, 0) / (0.12 * lc)
    let env = JS.exp(-e * e)
    let W = JS.max(B[2], 1)
    let prof = sech2(ue / (ue > 0 ? 0.55 * W : 1.3 * W)) // steep front, long back
    let sk = (ue - 1.6 * W) / (0.9 * W) // suction trough ahead of the wall
    return A[3] * env * (prof - 0.35 * JS.exp(-sk * sk))
  }

  static func vortexHeight(_ px: Double, _ pz: Double, _ A: [Double], _ B: [Double]) -> Double {
    let r = JS.hypot(px - A[1], pz - A[2])
    let q = r / (0.45 * JS.max(B[0], 1))
    let t = MathUtil.clamp((A[3] - 0.4) / 0.6, 0, 1)
    return -0.8 * t * t * (3 - 2 * t) * JS.exp(-q * q)
  }

  static func whirlHeight(_ px: Double, _ pz: Double, _ A: [Double], _ B: [Double]) -> Double {
    let R = JS.max(B[0], 1)
    let r = JS.hypot(px - A[1], pz - A[2])
    let q = r / (0.25 * R)
    let m = (r - R) / (0.22 * R)
    return A[3] * (-5 / (1 + q * q) + 0.4 * JS.exp(-m * m))
  }

  /// Sum of feature heights at lagrangian point (px, pz). tOff moves rogue crests forward in time.
  public func heightAt(_ px: Double, _ pz: Double, _ tOff: Double = 0) -> Double {
    var h = 0.0
    for i in 0..<Swift.min(count, slots.count) {
      let s = slots[i]
      switch s.type {
      case .rogue: h += FeatureSet.rogueHeight(px, pz, s.A, s.B, tOff, s.speed)
      case .vortex: h += FeatureSet.vortexHeight(px, pz, s.A, s.B)
      case .whirlpool: h += FeatureSet.whirlHeight(px, pz, s.A, s.B)
      }
    }
    let d3 = Double(downwash[3])
    if d3 > 0 {
      let q = JS.hypot(px - Double(downwash[0]), pz - Double(downwash[1])) / (0.6 * Double(downwash[2]))
      h -= 0.25 * d3 * JS.exp(-q * q)
    }
    return h
  }

  /// Horizontal swirl flow (m/s) at world (x, z) — mirrors oceanFeatureFlow().
  public func flowAt(_ x: Double, _ z: Double) -> V2 {
    var fx = 0.0, fz = 0.0
    for i in 0..<Swift.min(count, slots.count) {
      let s = slots[i]
      if s.type == .rogue { continue }
      let dx = x - s.A[1], dz = z - s.A[2]
      let r = JS.max(JS.hypot(dx, dz), 0.5)
      let R = JS.max(s.B[0], 1)
      let prof = (r / R) * JS.exp(0.5 * (1 - (r * r) / (R * R)))
      let vt = s.type == .vortex ? 6 * s.A[3] : 2 * s.A[3]
      let vin = s.type == .vortex ? 0.35 * vt : 0.4 * s.A[3]
      fx += ((-dz / r) * s.B[1] * vt - (dx / r) * vin) * prof
      fz += ((dx / r) * s.B[1] * vt - (dz / r) * vin) * prof
    }
    return V2(fx, fz)
  }
}
