// core/math.js helpers + the other smoothstep signatures used by the web code
// (Tests/Vectors/math/util.json). Same expression order as the JS, NaN/-0 behaviour included.

public enum MathUtil {
  public static let TAU: Double = JS.PI * 2

  /// clamp(v, a, b) = v < a ? a : v > b ? b : v   (NaN passes through)
  @inline(__always) public static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double {
    v < a ? a : (v > b ? b : v)
  }

  /// lerp(a, b, t) = a + (b - a) * t
  @inline(__always) public static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

  /// invLerp(a, b, v) = clamp((v - a) / (b - a), 0, 1)
  @inline(__always) public static func invLerp(_ a: Double, _ b: Double, _ v: Double) -> Double { clamp((v - a) / (b - a), 0, 1) }

  /// remap(v, a, b, c, d) = lerp(c, d, invLerp(a, b, v))
  @inline(__always) public static func remap(_ v: Double, _ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
    lerp(c, d, invLerp(a, b, v))
  }

  /// core/math.js smoothstep(a, b, v): t = invLerp(a, b, v); t * t * (3 - 2 * t)
  @inline(__always) public static func smoothstep(_ a: Double, _ b: Double, _ v: Double) -> Double {
    let t = invLerp(a, b, v)
    return t * t * (3 - 2 * t)
  }

  /// ocean/waves.js smoothstep(a, b, x): t = clamp((x - a) / (b - a), 0, 1); t * t * (3 - 2 * t)
  /// (numerically identical to `smoothstep`; kept separate to mirror the call sites).
  @inline(__always) public static func smoothstepOcean(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }

  /// THREE.MathUtils.smoothstep(x, min, max): x <= min ? 0 : x >= max ? 1 : (x = (x - min) / (max - min)) * x * (3 - 2 * x)
  @inline(__always) public static func smoothstepThree(_ x: Double, _ min: Double, _ max: Double) -> Double {
    if x <= min { return 0 }
    if x >= max { return 1 }
    let t = (x - min) / (max - min)
    return t * t * (3 - 2 * t)
  }

  /// look.js smooth(a, b, x): t = Math.min(1, Math.max(0, (x - a) / (b - a))); t * t * (3 - 2 * t)
  @inline(__always) public static func smoothLook(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = JS.min(1, JS.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }

  /// damp(current, target, lambda, dt) = lerp(current, target, 1 - Math.exp(-lambda * dt))
  @inline(__always) public static func damp(_ current: Double, _ target: Double, _ lambda: Double, _ dt: Double) -> Double {
    lerp(current, target, 1 - JS.exp(-lambda * dt))
  }

  /// dampAngle(current, target, lambda, dt)
  @inline(__always) public static func dampAngle(_ current: Double, _ target: Double, _ lambda: Double, _ dt: Double) -> Double {
    let d = wrapAngle(target - current)
    return current + d * (1 - JS.exp(-lambda * dt))
  }

  /// wrapAngle(a): (-PI, PI]-ish exactly like the JS: a = (a + PI) % (2 PI); if (a < 0) a += 2 PI; a - PI
  @inline(__always) public static func wrapAngle(_ angle: Double) -> Double {
    var a = (angle + JS.PI).truncatingRemainder(dividingBy: JS.PI * 2)
    if a < 0 { a += JS.PI * 2 }
    return a - JS.PI
  }
}
