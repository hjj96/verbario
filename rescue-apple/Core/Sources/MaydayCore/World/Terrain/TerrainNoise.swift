// world/terrain.js noise: a hash-based 2D gradient noise with a quintic fade (any seed works without
// tables), its fbm / ridged multifractal sums, the smoothstep `sstep` and the soft maximum `smax` the
// landmass height functions are built from. Bit-exact with Node 22 (Tests/Vectors/world/terrain_noise.json):
// the hash is 32-bit integer arithmetic (`Math.imul`, `>>>`), every float expression keeps the JS order.

public enum TerrainNoise {
  /// GX / GY: the 16 gradient directions, Float32Array values (cos / sin of (i + 0.5)/16 · 2π rounded to
  /// float, read back as doubles). Computed by the web's own formula; world.json carries the same table
  /// (WorldTablesTests checks both).
  public static let GX: [Double] = (0..<16).map { i in Double(Float(JS.cos(((Double(i) + 0.5) / 16) * JS.PI * 2))) }
  public static let GY: [Double] = (0..<16).map { i in Double(Float(JS.sin(((Double(i) + 0.5) / 16) * JS.PI * 2))) }

  /// hashi(x, y, s): `Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)`,
  /// two xor-shift-multiply rounds, `>>> 0`. (ToUint32 of `x | 0` is ToUint32(x): one conversion.)
  @inline(__always) public static func hashi(_ x: Double, _ y: Double, _ s: Double) -> UInt32 {
    var h = (JSNumber.toUint32(x) &* 0x27d4_eb2d) ^ (JSNumber.toUint32(y) &* 0x1656_67b1) ^ (JSNumber.toUint32(s) &* 0x9e37_79b1)
    h = (h ^ (h >> 15)) &* 0x85eb_ca6b
    h = (h ^ (h >> 13)) &* 0xc2b2_ae35
    return h ^ (h >> 16)
  }

  /// hash01(x, y, s) = hashi / 2^32 ∈ [0, 1)
  @inline(__always) public static func hash01(_ x: Double, _ y: Double, _ s: Double) -> Double {
    Double(hashi(x, y, s)) / 4294967296
  }

  /// noise2(x, y, s = 0) ≈ −1…1
  public static func noise2(_ x: Double, _ y: Double, _ s: Double = 0) -> Double {
    let xi = x.rounded(.down), yi = y.rounded(.down)
    let fx = x - xi, fy = y - yi
    let u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    let v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    var g = Int(hashi(xi, yi, s) & 15)
    let n00 = GX[g] * fx + GY[g] * fy
    g = Int(hashi(xi + 1, yi, s) & 15)
    let n10 = GX[g] * (fx - 1) + GY[g] * fy
    g = Int(hashi(xi, yi + 1, s) & 15)
    let n01 = GX[g] * fx + GY[g] * (fy - 1)
    g = Int(hashi(xi + 1, yi + 1, s) & 15)
    let n11 = GX[g] * (fx - 1) + GY[g] * (fy - 1)
    let a = n00 + (n10 - n00) * u
    let b = n01 + (n11 - n01) * u
    return (a + (b - a) * v) * 1.41
  }

  /// fbm2(x, y, s, oct = 4) ≈ −1…1
  public static func fbm2(_ x0: Double, _ y0: Double, _ s: Double, _ oct: Int = 4) -> Double {
    var x = x0, y = y0
    var sum = 0.0, amp = 0.5, norm = 0.0
    for o in 0..<max(0, oct) {
      sum += amp * noise2(x, y, s + Double(o) * 31)
      norm += amp
      x = x * 2.03 + 1.7
      y = y * 2.03 - 0.9
      amp *= 0.5
    }
    return sum / norm
  }

  /// ridged2(x, y, s, oct = 4) ≈ 0…1 (sharp crests, rounded valleys)
  public static func ridged2(_ x0: Double, _ y0: Double, _ s: Double, _ oct: Int = 4) -> Double {
    var x = x0, y = y0
    var sum = 0.0, amp = 0.5, w = 1.0, norm = 0.0
    for o in 0..<max(0, oct) {
      var n = 1 - JS.abs(noise2(x, y, s + Double(o) * 47))
      n *= n
      n *= w
      w = JS.min(1, JS.max(0, n * 1.8))
      sum += n * amp
      norm += amp
      x = x * 2.1 - 3.1
      y = y * 2.1 + 0.7
      amp *= 0.5
    }
    return sum / norm
  }

  /// sstep(a, b, x): t = Math.min(1, Math.max(0, (x − a)/(b − a))); t²(3 − 2t)
  @inline(__always) public static func sstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = JS.min(1, JS.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }

  /// smax(a, b, k): polynomial soft maximum over the width k.
  @inline(__always) public static func smax(_ a: Double, _ b: Double, _ k: Double) -> Double {
    let d = JS.abs(a - b)
    let m = a > b ? a : b
    return d >= k ? m : m + ((k - d) * (k - d)) / (4 * k)
  }
}
