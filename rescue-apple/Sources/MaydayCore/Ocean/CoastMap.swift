// Coastline distance map (systems/ocean/coast.js): a world-space R8 grid of the distance to the
// waterline (0 … COAST_MAX m), read bilinearly by the GPU and by the CPU wave bank.
// coastDistance is bit-exact with the web (Tests/Vectors/ocean/coast_<mission>.json).

public struct CoastMap: Equatable, Sendable {
  public static let COAST_MAX: Double = 48 // metres encoded; "far from any coast" beyond

  public let w: Int
  public let h: Int
  public let x0: Double
  public let z0: Double
  public let cell: Double
  /// u8 row-major, row j at z0 + (j + .5)·cell; value / 255 · COAST_MAX metres.
  public let data: [UInt8]

  public init(w: Int, h: Int, x0: Double, z0: Double, cell: Double, data: [UInt8]) {
    precondition(w > 0 && h > 0 && data.count == w * h, "CoastMap: data must be w*h bytes")
    self.w = w
    self.h = h
    self.x0 = x0
    self.z0 = z0
    self.cell = cell
    self.data = data
  }

  /// coastDistance(c, x, z): CPU mirror of the GPU's bilinear R8 lookup (texel centres at (i + .5)·cell), metres.
  public func distance(_ x: Double, _ z: Double) -> Double {
    let fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5
    if fx < 0 || fz < 0 || fx > Double(w - 1) || fz > Double(h - 1) { return CoastMap.COAST_MAX }
    // JS: NaN passes the range test and the typed-array reads give undefined → NaN.
    if fx.isNaN || fz.isNaN { return .nan }
    let i = fx.rounded(.down), j = fz.rounded(.down)
    let tx = fx - i, tz = fz - j
    let ii = Int(i), jj = Int(j)
    let i1 = Swift.min(ii + 1, w - 1), j1 = Swift.min(jj + 1, h - 1)
    let d00 = Double(data[jj * w + ii]), d01 = Double(data[jj * w + i1])
    let d10 = Double(data[j1 * w + ii]), d11 = Double(data[j1 * w + i1])
    let a = d00 + (d01 - d00) * tx
    let b = d10 + (d11 - d10) * tx
    return ((a + (b - a) * tz) / 255) * CoastMap.COAST_MAX
  }

  /// coastDamp(d): wave amplitude near a coast, ≈ 20 % at the waterline, full beyond ~16 m (same in GLSL).
  @inline(__always) public static func damp(_ d: Double) -> Double {
    let t = JS.min(JS.max((d - 1) / 15, 0), 1)
    return 0.2 + 0.8 * t * t * (3 - 2 * t)
  }

  /// bakeCoast(scene) from the world-space positions of every terrain vertex (meshes with `aTerr`,
  /// already transformed by their matrixWorld exactly like three's Vector3.applyMatrix4). Returns nil
  /// when there is no land above the waterline. Mirrors coast.js line by line (Float32 grids included).
  public static func bake(worldVertices: [V3], maxCells: Double = 1024, minCell: Double = 0.7) -> CoastMap? {
    if worldVertices.isEmpty { return nil }
    var x0 = Double.infinity, z0 = Double.infinity, x1 = -Double.infinity, z1 = -Double.infinity
    for v in worldVertices {
      if v.y <= 0 { continue }
      if v.x < x0 { x0 = v.x }
      if v.x > x1 { x1 = v.x }
      if v.z < z0 { z0 = v.z }
      if v.z > z1 { z1 = v.z }
    }
    if !(x1 > x0 && z1 > z0) { return nil }
    let pad = COAST_MAX + 6
    x0 -= pad
    z0 -= pad
    x1 += pad
    z1 += pad
    let cell = JS.max(minCell, (x1 - x0) / maxCells, (z1 - z0) / maxCells)
    let w = Int(((x1 - x0) / cell).rounded(.up)), h = Int(((z1 - z0) / cell).rounded(.up))
    let N = w * h
    // max vertex height per cell (−1e9 = no sample)
    var H = [Float](repeating: -1e9, count: N)
    for v in worldVertices {
      let ci = ((v.x - x0) / cell).rounded(.down), cj = ((v.z - z0) / cell).rounded(.down)
      if ci < 0 || cj < 0 || ci >= Double(w) || cj >= Double(h) { continue }
      if ci.isNaN || cj.isNaN { continue }
      let id = Int(cj) * w + Int(ci)
      if v.y > Double(H[id]) { H[id] = Float(v.y) }
    }
    // land: a sampled cell above the waterline, or an unsampled cell surrounded by land
    var D = [Float](repeating: 0, count: N)
    for j in 0..<h {
      for i in 0..<w {
        let id = j * w + i
        var land = Double(H[id]) > 0
        if !land && Double(H[id]) < -1e8 && i > 0 && j > 0 && i < w - 1 && j < h - 1 {
          var up = 0, any = 0
          for dj in -1...1 {
            for di in -1...1 {
              let hv = Double(H[id + dj * w + di])
              if hv > -1e8 {
                any += 1
                if hv > 0 { up += 1 }
              }
            }
          }
          land = any > 0 && up * 2 > any
        }
        D[id] = land ? 0 : 1e9
      }
    }
    // two-pass chamfer distance (Float32 storage between steps, like the JS Float32Array)
    let S = JS.SQRT2
    for j in 0..<h {
      for i in 0..<w {
        let id = j * w + i
        var d = Double(D[id])
        if d == 0 { continue }
        if i > 0 { d = JS.min(d, Double(D[id - 1]) + 1) }
        if j > 0 {
          d = JS.min(d, Double(D[id - w]) + 1)
          if i > 0 { d = JS.min(d, Double(D[id - w - 1]) + S) }
          if i < w - 1 { d = JS.min(d, Double(D[id - w + 1]) + S) }
        }
        D[id] = Float(d)
      }
    }
    for row in stride(from: h - 1, through: 0, by: -1) {
      for col in stride(from: w - 1, through: 0, by: -1) {
        let id = row * w + col
        var d = Double(D[id])
        if d == 0 { continue }
        if col < w - 1 { d = JS.min(d, Double(D[id + 1]) + 1) }
        if row < h - 1 {
          d = JS.min(d, Double(D[id + w]) + 1)
          if col < w - 1 { d = JS.min(d, Double(D[id + w + 1]) + S) }
          if col > 0 { d = JS.min(d, Double(D[id + w - 1]) + S) }
        }
        D[id] = Float(d)
      }
    }
    var data = [UInt8](repeating: 0, count: N)
    for k in 0..<N {
      // the waterline lies half a cell outside the last land cell
      let m = D[k] == 0 ? 0 : (Double(D[k]) - 0.5) * cell
      data[k] = JSNumber.toUint8(JSNumber.round(JS.min(JS.max(m, 0) / COAST_MAX, 1) * 255))
    }
    return CoastMap(w: w, h: h, x0: x0, z0: z0, cell: cell, data: data)
  }
}
