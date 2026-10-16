// 2D simplex noise + fbm (core/math.js createNoise2D / fbm2), bit-exact with Node 22
// (Tests/Vectors/math/noise.json).

/// `createNoise2D(seed)`: Stefan Gustavson's 2D simplex noise with a mulberry32-shuffled permutation.
public struct SimplexNoise2D {
  public let seed: Double
  private let perm: [UInt8] // 512 entries
  // grad table [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]] as doubles
  private static let gx: [Double] = [1, -1, 1, -1, 1, -1, 0, 0]
  private static let gy: [Double] = [1, 1, -1, -1, 0, 0, 1, -1]
  private static let F2: Double = 0.5 * (JS.sqrt(3) - 1)
  private static let G2: Double = (3 - JS.sqrt(3)) / 6

  public init(seed: Double = 1) {
    self.seed = seed
    var rng = Mulberry32(seed: seed)
    var p = [UInt8](repeating: 0, count: 256)
    for i in 0..<256 { p[i] = UInt8(i) }
    var i = 255
    while i > 0 {
      // const j = Math.floor(rng.next() * (i + 1));
      let j = Int((rng.next() * Double(i + 1)).rounded(.down))
      let t = p[i]
      p[i] = p[j]
      p[j] = t
      i -= 1
    }
    var perm = [UInt8](repeating: 0, count: 512)
    for k in 0..<512 { perm[k] = p[k & 255] }
    self.perm = perm
  }

  /// noise(x, y) ≈ [-1, 1]
  public func callAsFunction(_ x: Double, _ y: Double) -> Double { noise(x, y) }

  public func noise(_ x: Double, _ y: Double) -> Double {
    let F2 = SimplexNoise2D.F2
    let G2 = SimplexNoise2D.G2
    let s = (x + y) * F2
    let i = (x + s).rounded(.down)
    let j = (y + s).rounded(.down)
    let t = (i + j) * G2
    let x0 = x - (i - t)
    let y0 = y - (j - t)
    let i1: Double = x0 > y0 ? 1 : 0
    let j1: Double = x0 > y0 ? 0 : 1
    let x1 = x0 - i1 + G2
    let y1 = y0 - j1 + G2
    let x2 = x0 - 1 + 2 * G2
    let y2 = y0 - 1 + 2 * G2
    let ii = Int(JSNumber.toInt32(i) & 255)
    let jj = Int(JSNumber.toInt32(j) & 255)
    let i1i = Int(i1), j1i = Int(j1)
    var n0 = 0.0, n1 = 0.0, n2 = 0.0
    var t0 = 0.5 - x0 * x0 - y0 * y0
    if t0 > 0 {
      let g = Int(perm[ii + Int(perm[jj])] & 7)
      t0 *= t0
      n0 = t0 * t0 * (SimplexNoise2D.gx[g] * x0 + SimplexNoise2D.gy[g] * y0)
    }
    var t1 = 0.5 - x1 * x1 - y1 * y1
    if t1 > 0 {
      let g = Int(perm[ii + i1i + Int(perm[jj + j1i])] & 7)
      t1 *= t1
      n1 = t1 * t1 * (SimplexNoise2D.gx[g] * x1 + SimplexNoise2D.gy[g] * y1)
    }
    var t2 = 0.5 - x2 * x2 - y2 * y2
    if t2 > 0 {
      let g = Int(perm[ii + 1 + Int(perm[jj + 1])] & 7)
      t2 *= t2
      n2 = t2 * t2 * (SimplexNoise2D.gx[g] * x2 + SimplexNoise2D.gy[g] * y2)
    }
    return 70 * (n0 + n1 + n2)
  }
}

/// `fbm2(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5)`
public func fbm2(_ noise: SimplexNoise2D, _ x: Double, _ y: Double, octaves: Int = 4, lacunarity: Double = 2, gain: Double = 0.5) -> Double {
  var sum = 0.0, amp = 1.0, freq = 1.0, norm = 0.0
  for _ in 0..<max(octaves, 0) {
    sum += amp * noise.noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}
