// world/terrain.js buildTerrain: a landmass height function sampled on a regular grid → the indexed mesh
// (smooth normals, deep cells culled, a seabed skirt sloping to −10 m round every shore, per-vertex
// aTerr = (cover, cavity, shelter, bird), an optional coarse shadow-only copy) and the CPU sampler that
// places vegetation and boulders on the rendered surface. The grids are Float32Arrays in the web: every
// store rounds to Float exactly where the JS writes into a typed array, reads widen back to Double.
// Tests/Vectors/world/terrain_first_<quality>.json.

/// buildTerrain options (terrain.js defaults).
public struct TerrainBuildOptions {
  public var bounds: Bounds2
  public var step: Double = 1
  public var cut: Double = -2.2
  /// cover(x, z, h, ny, cavity, shelter) → 0…1 ground cover (nil = 0)
  public var cover: ((Double, Double, Double, Double, Double, Double) -> Double)?
  /// bird(x, z, h, hmax) → 0…1 guano (nil = 0)
  public var bird: ((Double, Double, Double, Double) -> Double)?
  /// rescale the land part so the summit is exactly this high (0 = keep)
  public var scaleTo: Double = 0
  public var skirt: Double = 0
  public var skirtDepth: Double = -10
  public var shadowStride: Int = 0

  public init(bounds: Bounds2, step: Double = 1, cut: Double = -2.2, cover: ((Double, Double, Double, Double, Double, Double) -> Double)? = nil,
              bird: ((Double, Double, Double, Double) -> Double)? = nil, scaleTo: Double = 0, skirt: Double = 0, skirtDepth: Double = -10,
              shadowStride: Int = 0) {
    self.bounds = bounds
    self.step = step
    self.cut = cut
    self.cover = cover
    self.bird = bird
    self.scaleTo = scaleTo
    self.skirt = skirt
    self.skirtDepth = skirtDepth
    self.shadowStride = shadowStride
  }
}

/// The sampled grid (sampler.grid): Float32 arrays row-major, j·nx + i.
public struct TerrainGrid: Sendable {
  public var x0: Double
  public var z0: Double
  public var nx: Int
  public var nz: Int
  public var step: Double
  public var H: [Float]
  public var NY: [Float]
  public var COV: [Float]
  public var SHL: [Float]
  public var CAV: [Float]
}

/// The terrain mesh exactly as the web's BufferGeometry: positions / normals (xyz), aTerr (cover, cavity,
/// shelter, bird), indices (Uint16 in the web below 65 536 vertices — the values are the same),
/// drawRange 0…drawCount (fine triangles), shadowRange = the coarse shadow-only copy.
public struct TerrainMesh: Sendable {
  public var positions: [Float]
  public var normals: [Float]
  public var aTerr: [Float]
  public var indices: [UInt32]
  public var drawCount: Int
  public var shadowRange: (start: Int, count: Int)?

  public var vertexCount: Int { positions.count / 3 }
}

/// Bilinear CPU sampler of the rendered surface (makeSampler).
public struct TerrainSampler: Sendable {
  public let grid: TerrainGrid
  /// the summit (after scaleTo)
  public var hmax: Double

  @inline(__always) func lerp(_ A: [Float], _ x: Double, _ z: Double) -> Double {
    let G = grid
    let fx = JS.min(Double(G.nx) - 1.001, JS.max(0, (x - G.x0) / G.step))
    let fz = JS.min(Double(G.nz) - 1.001, JS.max(0, (z - G.z0) / G.step))
    if fx.isNaN || fz.isNaN { return .nan } // the web indexes with NaN → undefined → NaN
    let i = fx.rounded(.down), j = fz.rounded(.down)
    let tx = fx - i, tz = fz - j
    let ii = Int(i), jj = Int(j), nx = G.nx
    let a = Double(A[jj * nx + ii]), b = Double(A[jj * nx + ii + 1]), c = Double(A[(jj + 1) * nx + ii]), d = Double(A[(jj + 1) * nx + ii + 1])
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  }

  public func inside(_ x: Double, _ z: Double) -> Bool {
    let G = grid
    return x >= G.x0 && z >= G.z0 && x <= G.x0 + Double(G.nx - 1) * G.step && z <= G.z0 + Double(G.nz - 1) * G.step
  }

  public func heightAt(_ x: Double, _ z: Double) -> Double { lerp(grid.H, x, z) }
  public func upAt(_ x: Double, _ z: Double) -> Double { lerp(grid.NY, x, z) }
  public func coverAt(_ x: Double, _ z: Double) -> Double { lerp(grid.COV, x, z) }
  public func shelterAt(_ x: Double, _ z: Double) -> Double { lerp(grid.SHL, x, z) }
  public func cavityAt(_ x: Double, _ z: Double) -> Double { lerp(grid.CAV, x, z) }

  /// normalAt(x, z): normalize(−∂h, 2e, −∂h) with e = one grid step (three normalize).
  public func normalAt(_ x: Double, _ z: Double) -> V3 {
    let e = grid.step
    let hx = lerp(grid.H, x + e, z) - lerp(grid.H, x - e, z)
    let hz = lerp(grid.H, x, z + e) - lerp(grid.H, x, z - e)
    return V3(-hx, 2 * e, -hz).normalized()
  }
}

/// buildTerrain(def, opts) → { geometry, sampler, triangles }
public struct TerrainBuild: Sendable {
  public var mesh: TerrainMesh
  public var sampler: TerrainSampler
  /// fine triangles
  public var triangles: Int
}

public enum TerrainBuilder {
  /// buildTerrain with the height function of `def`.
  public static func build(_ def: LandmassDef, _ o: TerrainBuildOptions) -> TerrainBuild {
    let fn = HeightFunction(def)
    return build(height: { fn.height($0, $1) }, o)
  }

  public static func build(height fn: (Double, Double) -> Double, _ o: TerrainBuildOptions) -> TerrainBuild {
    let x0 = o.bounds.x0, z0 = o.bounds.z0, x1 = o.bounds.x1, z1 = o.bounds.z1, step = o.step
    // (non-finite bounds: the web throws a RangeError allocating the grid; here a degenerate 2 × 2 grid)
    let nx = Swift.max(2, worldCount(JS.max(2, JS.ceil((x1 - x0) / step) + 1)))
    let nz = Swift.max(2, worldCount(JS.max(2, JS.ceil((z1 - z0) / step) + 1)))
    let N = nx * nz
    var H = [Float](repeating: 0, count: N)
    var hmax = -Double.infinity
    for j in 0..<nz {
      let z = z0 + Double(j) * step
      for i in 0..<nx {
        let v = fn(x0 + Double(i) * step, z)
        H[j * nx + i] = Float(v)
        if v > hmax { hmax = v }
      }
    }
    if o.scaleTo > 0 && hmax > 0.5 {
      let k = o.scaleTo / hmax
      for i in 0..<N where H[i] > 0 { H[i] = Float(Double(H[i]) * k) }
      hmax = o.scaleTo
    }
    // seabed skirt: cells within `skirt` metres of the shore are kept and the seabed slopes down to
    // skirtDepth at the skirt's outer edge (two-pass chamfer distance in grid cells)
    var SD: [Float]? = nil
    if o.skirt > 0 {
      var sd = [Float](repeating: 0, count: N)
      for i in 0..<N { sd[i] = Double(H[i]) >= o.cut ? 0 : 1e9 }
      let D1 = 1.0, D2 = JS.SQRT2
      for j in 0..<nz {
        for i in 0..<nx {
          let id = j * nx + i
          var d = Double(sd[id])
          if i > 0 { d = JS.min(d, Double(sd[id - 1]) + D1) }
          if j > 0 {
            d = JS.min(d, Double(sd[id - nx]) + D1)
            if i > 0 { d = JS.min(d, Double(sd[id - nx - 1]) + D2) }
            if i < nx - 1 { d = JS.min(d, Double(sd[id - nx + 1]) + D2) }
          }
          sd[id] = Float(d)
        }
      }
      for j in stride(from: nz - 1, through: 0, by: -1) {
        for i in stride(from: nx - 1, through: 0, by: -1) {
          let id = j * nx + i
          var d = Double(sd[id])
          if i < nx - 1 { d = JS.min(d, Double(sd[id + 1]) + D1) }
          if j < nz - 1 {
            d = JS.min(d, Double(sd[id + nx]) + D1)
            if i < nx - 1 { d = JS.min(d, Double(sd[id + nx + 1]) + D2) }
            if i > 0 { d = JS.min(d, Double(sd[id + nx - 1]) + D2) }
          }
          sd[id] = Float(d)
        }
      }
      let R = o.skirt / step
      for i in 0..<N {
        let d = Double(sd[i])
        if d <= 0 || d > R + 1.5 { continue }
        let t = TerrainNoise.sstep(0.3 * R, R, d)
        let h = Double(H[i])
        H[i] = Float(JS.min(h, h + (o.skirtDepth - h) * t))
      }
      SD = sd
    }
    // normals (central differences)
    var NXa = [Float](repeating: 0, count: N), NYa = NXa, NZa = NXa
    for j in 0..<nz {
      for i in 0..<nx {
        let id = j * nx + i
        let hl = Double(H[j * nx + Swift.max(0, i - 1)]), hr = Double(H[j * nx + Swift.min(nx - 1, i + 1)])
        let hd = Double(H[Swift.max(0, j - 1) * nx + i]), hu = Double(H[Swift.min(nz - 1, j + 1) * nx + i])
        let sx = (hr - hl) / (step * ((i > 0 && i < nx - 1) ? 2 : 1))
        let sz = (hu - hd) / (step * ((j > 0 && j < nz - 1) ? 2 : 1))
        let il = 1 / (sx * sx + 1 + sz * sz).squareRoot()
        NXa[id] = Float(-sx * il)
        NYa[id] = Float(il)
        NZa[id] = Float(-sz * il)
      }
    }
    // neighbourhood means (cavity ≈ 3 m, shelter ≈ 10 m)
    let B1 = boxBlur(H, nx, nz, Swift.max(1, Int(JS.round(1.6 / step))))
    let B2 = boxBlur(H, nx, nz, Swift.max(2, Int(JS.round(9 / step))))
    var CAV = [Float](repeating: 0, count: N), SHL = CAV, COV = CAV, BRD = CAV
    for j in 0..<nz {
      for i in 0..<nx {
        let id = j * nx + i
        let x = x0 + Double(i) * step, z = z0 + Double(j) * step, h = Double(H[id])
        let cav = JS.min(1, JS.max(0, 0.5 + (Double(B1[id]) - h) * 0.55))
        let shel = JS.min(1, JS.max(0, 0.5 + (Double(B2[id]) - h) * 0.22))
        CAV[id] = Float(cav)
        SHL[id] = Float(shel)
        COV[id] = Float(o.cover.map { $0(x, z, h, Double(NYa[id]), cav, shel) } ?? 0)
        BRD[id] = Float(o.bird.map { $0(x, z, h, hmax) } ?? 0)
      }
    }
    // indices: keep cells with any corner above the cut; compact the used vertices
    var remap = [Int32](repeating: -1, count: N)
    var idx = [UInt32]()
    idx.reserveCapacity(N * 6)
    var used: Int32 = 0
    func use(_ id: Int) -> UInt32 {
      if remap[id] < 0 {
        remap[id] = used
        used += 1
      }
      return UInt32(remap[id])
    }
    for j in 0..<(nz - 1) {
      for i in 0..<(nx - 1) {
        let a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
        let ha = Double(H[a]), hb = Double(H[b]), hc = Double(H[c]), hd = Double(H[d])
        if JS.max(JS.max(ha, hb), JS.max(hc, hd)) < o.cut {
          if let sd = SD {
            let m = JS.min(JS.min(Double(sd[a]), Double(sd[b])), JS.min(Double(sd[c]), Double(sd[d])))
            if m * step > o.skirt { continue }
          } else {
            continue
          }
        }
        let A = use(a), Bv = use(b), C = use(c), D = use(d)
        // split along the shorter height diagonal (follows ridges and gullies)
        if JS.abs(ha - hd) < JS.abs(hb - hc) {
          idx.append(contentsOf: [A, C, D, A, D, Bv])
        } else {
          idx.append(contentsOf: [A, C, Bv, Bv, C, D])
        }
      }
    }
    let fineCount = idx.count
    let usedN = Int(used)
    // shadow LOD: cells of `shadowStride` grid steps over the land above the waterline; corner heights
    // min-pooled over the neighbouring fine vertices (the proxy stays under the rendered surface)
    var cpos = [Double]()
    if o.shadowStride > 1 {
      let s = o.shadowStride, rp = (s + 1) / 2
      let cx = (nx - 1 + s - 1) / s + 1, cz = (nz - 1 + s - 1) / s + 1
      var cmap = [Int](repeating: -1, count: cx * cz)
      func gi(_ I: Int) -> Int { Swift.min(I * s, nx - 1) }
      func gj(_ J: Int) -> Int { Swift.min(J * s, nz - 1) }
      func cv(_ I: Int, _ J: Int) -> Int {
        let k = J * cx + I
        if cmap[k] < 0 {
          let i = gi(I), j = gj(J)
          var h = Double.infinity
          for jj in Swift.max(0, j - rp)...Swift.min(nz - 1, j + rp) {
            for ii in Swift.max(0, i - rp)...Swift.min(nx - 1, i + rp) { h = JS.min(h, Double(H[jj * nx + ii])) }
          }
          cmap[k] = usedN + cpos.count / 3
          cpos.append(x0 + Double(i) * step)
          cpos.append(h)
          cpos.append(z0 + Double(j) * step)
        }
        return cmap[k]
      }
      for J in 0..<(cz - 1) {
        for I in 0..<(cx - 1) {
          var hm = -Double.infinity
          for j in gj(J)...gj(J + 1) {
            for i in gi(I)...gi(I + 1) { hm = JS.max(hm, Double(H[j * nx + i])) }
          }
          if hm < -0.5 { continue } // under the sea surface: nothing to shade
          let A = cv(I, J), Bv = cv(I + 1, J), C = cv(I, J + 1), D = cv(I + 1, J + 1)
          let ha = cpos[(A - usedN) * 3 + 1], hb = cpos[(Bv - usedN) * 3 + 1], hc = cpos[(C - usedN) * 3 + 1], hd = cpos[(D - usedN) * 3 + 1]
          let a = UInt32(A), b = UInt32(Bv), c = UInt32(C), d = UInt32(D)
          if JS.abs(ha - hd) < JS.abs(hb - hc) {
            idx.append(contentsOf: [a, c, d, a, d, b])
          } else {
            idx.append(contentsOf: [a, c, b, b, c, d])
          }
        }
      }
    }
    let nv = usedN + cpos.count / 3
    var pos = [Float](repeating: 0, count: nv * 3), nrm = [Float](repeating: 0, count: nv * 3), ter = [Float](repeating: 0, count: nv * 4)
    for k in 0..<cpos.count { pos[usedN * 3 + k] = Float(cpos[k]) }
    for k in usedN..<nv { nrm[k * 3 + 1] = 1 }
    for id in 0..<N {
      let k = Int(remap[id])
      if k < 0 { continue }
      let i = id % nx, j = id / nx
      pos[k * 3] = Float(x0 + Double(i) * step)
      pos[k * 3 + 1] = H[id]
      pos[k * 3 + 2] = Float(z0 + Double(j) * step)
      nrm[k * 3] = NXa[id]
      nrm[k * 3 + 1] = NYa[id]
      nrm[k * 3 + 2] = NZa[id]
      ter[k * 4] = COV[id]
      ter[k * 4 + 1] = CAV[id]
      ter[k * 4 + 2] = SHL[id]
      ter[k * 4 + 3] = BRD[id]
    }
    let mesh = TerrainMesh(positions: pos, normals: nrm, aTerr: ter, indices: idx, drawCount: fineCount,
                           shadowRange: idx.count > fineCount ? (fineCount, idx.count - fineCount) : nil)
    let grid = TerrainGrid(x0: x0, z0: z0, nx: nx, nz: nz, step: step, H: H, NY: NYa, COV: COV, SHL: SHL, CAV: CAV)
    return TerrainBuild(mesh: mesh, sampler: TerrainSampler(grid: grid, hmax: hmax), triangles: fineCount / 3)
  }

  /// boxBlur(src, nx, nz, r): separable running-sum box filter (edge-clamped), Float32 in and out.
  static func boxBlur(_ src: [Float], _ nx: Int, _ nz: Int, _ r: Int) -> [Float] {
    var tmp = [Float](repeating: 0, count: src.count), out = tmp
    let w = Double(2 * r + 1)
    for j in 0..<nz {
      let row = j * nx
      var acc = 0.0
      for i in -r...r { acc += Double(src[row + Swift.min(nx - 1, Swift.max(0, i))]) }
      for i in 0..<nx {
        tmp[row + i] = Float(acc / w)
        acc += Double(src[row + Swift.min(nx - 1, i + r + 1)]) - Double(src[row + Swift.max(0, i - r)])
      }
    }
    for i in 0..<nx {
      var acc = 0.0
      for j in -r...r { acc += Double(tmp[Swift.min(nz - 1, Swift.max(0, j)) * nx + i]) }
      for j in 0..<nz {
        out[j * nx + i] = Float(acc / w)
        acc += Double(tmp[Swift.min(nz - 1, j + r + 1) * nx + i]) - Double(tmp[Swift.max(0, j - r) * nx + i])
      }
    }
    return out
  }
}
