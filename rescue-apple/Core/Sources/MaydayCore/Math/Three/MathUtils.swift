// THREE.MathUtils (three.js r185 src/math/MathUtils.js) — the functions the game calls, with the
// exact expressions of the JS. Not to be confused with `MathUtil` (rescue/src/core/math.js): the two
// libraries differ on purpose, e.g. three's lerp is `(1 - t) * x + t * y` and three's clamp
// propagates NaN through Math.max/Math.min. Vectors: Tests/Vectors/math/three_utils.json.
//
// Not ported (no game call site or not deterministic): generateUUID, randInt, randFloat,
// randFloatSpread, seededRandom, setQuaternionFromProperEuler, normalize/denormalize (typed arrays).

public enum MathUtils {
  /// Math.PI / 180
  public static let DEG2RAD: Double = JS.PI / 180
  /// 180 / Math.PI
  public static let RAD2DEG: Double = 180 / JS.PI

  /// clamp(value, min, max) = Math.max(min, Math.min(max, value))  (NaN in, NaN out)
  @inline(__always) public static func clamp(_ value: Double, _ min: Double, _ max: Double) -> Double {
    JS.max(min, JS.min(max, value))
  }

  /// euclideanModulo(n, m) = ((n % m) + m) % m
  @inline(__always) public static func euclideanModulo(_ n: Double, _ m: Double) -> Double {
    JSNumber.mod(JSNumber.mod(n, m) + m, m)
  }

  /// mapLinear(x, a1, a2, b1, b2) = b1 + (x - a1) * (b2 - b1) / (a2 - a1)
  @inline(__always) public static func mapLinear(_ x: Double, _ a1: Double, _ a2: Double, _ b1: Double, _ b2: Double) -> Double {
    b1 + (x - a1) * (b2 - b1) / (a2 - a1)
  }

  /// inverseLerp(x, y, value) = x !== y ? (value - x) / (y - x) : 0
  @inline(__always) public static func inverseLerp(_ x: Double, _ y: Double, _ value: Double) -> Double {
    x != y ? (value - x) / (y - x) : 0
  }

  /// lerp(x, y, t) = (1 - t) * x + t * y
  @inline(__always) public static func lerp(_ x: Double, _ y: Double, _ t: Double) -> Double {
    (1 - t) * x + t * y
  }

  /// damp(x, y, lambda, dt) = lerp(x, y, 1 - Math.exp(-lambda * dt))
  @inline(__always) public static func damp(_ x: Double, _ y: Double, _ lambda: Double, _ dt: Double) -> Double {
    lerp(x, y, 1 - JS.exp(-lambda * dt))
  }

  /// pingpong(x, length = 1) = length - Math.abs(euclideanModulo(x, length * 2) - length)
  @inline(__always) public static func pingpong(_ x: Double, _ length: Double = 1) -> Double {
    length - JS.abs(euclideanModulo(x, length * 2) - length)
  }

  /// smoothstep(x, min, max): 0 below min, 1 above max, else t * t * (3 - 2 * t)
  @inline(__always) public static func smoothstep(_ x: Double, _ min: Double, _ max: Double) -> Double {
    if x <= min { return 0 }
    if x >= max { return 1 }
    let t = (x - min) / (max - min)
    return t * t * (3 - 2 * t)
  }

  /// smootherstep(x, min, max): t * t * t * (t * (t * 6 - 15) + 10)
  @inline(__always) public static func smootherstep(_ x: Double, _ min: Double, _ max: Double) -> Double {
    if x <= min { return 0 }
    if x >= max { return 1 }
    let t = (x - min) / (max - min)
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  /// degToRad(degrees) = degrees * DEG2RAD
  @inline(__always) public static func degToRad(_ degrees: Double) -> Double { degrees * DEG2RAD }

  /// radToDeg(radians) = radians * RAD2DEG
  @inline(__always) public static func radToDeg(_ radians: Double) -> Double { radians * RAD2DEG }

  /// isPowerOfTwo(value) = (value & (value - 1)) === 0 && value !== 0   (ToInt32 bitwise and)
  public static func isPowerOfTwo(_ value: Double) -> Bool {
    (JSNumber.toInt32(value) & JSNumber.toInt32(value - 1)) == 0 && value != 0
  }

  /// ceilPowerOfTwo(value) = Math.pow(2, Math.ceil(Math.log(value) / Math.LN2))
  public static func ceilPowerOfTwo(_ value: Double) -> Double {
    JS.pow(2, JS.ceil(JS.log(value) / JS.LN2))
  }

  /// floorPowerOfTwo(value) = Math.pow(2, Math.floor(Math.log(value) / Math.LN2))
  public static func floorPowerOfTwo(_ value: Double) -> Double {
    JS.pow(2, JS.floor(JS.log(value) / JS.LN2))
  }
}
