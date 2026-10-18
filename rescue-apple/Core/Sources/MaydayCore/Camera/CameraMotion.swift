// camera/shake.js CameraMotion (DESIGN §2.2): documentary "drone" handheld drift + trauma shake + gust push.
//
// * Drift: 3 octaves of smooth noise at 0.21 / 0.57 / 1.3 Hz; position 0.25 m (calm) → 1.2 m (storm),
//   roll & pitch 0.15° → 0.8°.
// * Trauma: shake = trauma², decays 1.2/s, × settings.screenShake; frequency per source (thunder 8 Hz).
// * Gust push: 0.3–0.8° nudge toward the gust direction over 250 ms, springs back.
// Same expression order as the JS (Tests/Vectors/camera/shake.json).

public final class CameraMotion {
  static let DEG: Double = JS.PI / 180
  static let OCT: [(f: Double, a: Double)] = [(0.21, 1.0), (0.57, 0.55), (1.3, 0.3)]
  static let NORM: Double = 1 / (1 + 0.55 + 0.3)

  let noise: SimplexNoise2D
  public internal(set) var t: Double = 0
  var shakeT: Double = 0
  public var trauma: Double = 0
  public internal(set) var freq: Double = 11
  /// metres, world-aligned (x east, y up, z south)
  public internal(set) var pos = V3()
  /// radians: x pitch, y yaw, z roll (camera-local)
  public internal(set) var rot = V3()
  /// gust push spring (2D: x = east, y = south in world terms)
  public internal(set) var push = V2()
  var pushV = V2()
  var pushTarget = V2()
  var pushT: Double = 0

  public init(seed: Double = 2024) {
    noise = SimplexNoise2D(seed: seed)
  }

  public func addTrauma(_ amount: Double, _ freq: Double? = nil) {
    if amount > trauma {
      trauma = JS.min(1, amount)
      if let f = freq, JSNumber.isTruthy(f) { self.freq = f }
    }
  }

  /// Raise trauma to at least `v` (continuous sources such as a nearby waterspout).
  public func floor(_ v: Double) {
    if v > trauma { trauma = JS.min(1, v) }
  }

  public func gustPush(_ dirX: Double, _ dirZ: Double, _ deg: Double) {
    let l = JSNumber.or(JS.hypot(dirX, dirZ), 1)
    pushTarget.set((dirX / l) * deg * CameraMotion.DEG, (dirZ / l) * deg * CameraMotion.DEG)
    pushT = 0.25
  }

  func oct(_ ch: Double, _ t: Double) -> Double {
    var s: Double = 0
    for i in 0..<3 {
      let o = CameraMotion.OCT[i]
      s += noise.noise(t * o.f, ch * 13.37 + Double(i) * 3.1) * o.a
    }
    return s * CameraMotion.NORM
  }

  /// storm 0..1, shakeScale = settings.screenShake (0..1), motionScale = reduceMotion factor
  public func update(_ dt: Double, _ storm: Double, _ shakeScale: Double, _ motionScale: Double = 1) {
    let DEG = CameraMotion.DEG
    t += dt
    let t = self.t
    // handheld drift
    let pa = (0.25 + (1.2 - 0.25) * storm) * motionScale
    let ra = (0.15 + (0.8 - 0.15) * storm) * DEG * motionScale
    pos.set(oct(0, t) * pa, oct(1, t) * pa * 0.5, oct(2, t) * pa)
    rot.set(oct(3, t) * ra, 0, oct(4, t) * ra)

    // trauma shake
    trauma = JS.max(0, trauma - 1.2 * dt)
    let shake = trauma * trauma * shakeScale
    if shake > 1e-4 {
      shakeT += dt * freq
      let st = shakeT
      pos.x += noise.noise(st, 101.1) * 2.0 * shake
      pos.y += noise.noise(st, 202.2) * 1.0 * shake
      pos.z += noise.noise(st, 303.3) * 2.0 * shake
      rot.x += noise.noise(st, 404.4) * 1.2 * DEG * shake
      rot.y += noise.noise(st, 505.5) * 0.6 * DEG * shake
      rot.z += noise.noise(st, 606.6) * 1.2 * DEG * shake
    }

    // gust push (spring ω 9, ζ 0.7)
    if pushT > 0 { pushT -= dt } else { pushTarget.set(0, 0) }
    let w: Double = 9
    let z = 0.7
    let s = JS.min(dt, 0.05)
    pushV.x += (w * w * (pushTarget.x - push.x) - 2 * z * w * pushV.x) * s
    pushV.y += (w * w * (pushTarget.y - push.y) - 2 * z * w * pushV.y) * s
    push.x += pushV.x * s
    push.y += pushV.y * s
    // world east push → yaw the view east; world south push → pitch the view south (down-screen)
    rot.y += -push.x * shakeScale
    rot.x += -push.y * shakeScale
  }
}
