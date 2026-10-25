// world/terrain.js fits on a built landmass: collision columns (world.obstacles are vertical cylinders),
// inscribed shoal circles (ocean.setShoals surf rings), boulder placement and the shared ground-cover
// rule. Float32Array scratch where the web uses one (columns' top / radius, the chamfer field).

/// terrainColumns → {x, z, radius, top}
public struct TerrainColumn: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var radius: Double
  public var top: Double
}

/// fitShoals → {x, z, radius}
public struct ShoalCircle: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var radius: Double

  public init(x: Double, z: Double, radius: Double) {
    self.x = x
    self.z = z
    self.radius = radius
  }
}

/// scatterBoulders → {x, y, z, s, sy, ry}
public struct BoulderPlacement: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var s: Double
  public var sy: Double
  public var ry: Double
}

public enum TerrainFit {
  /// terrainColumns(sampler, bounds, {cell = 7, min = 2.5}): one column per square cell whose rock rises
  /// above `min`, fitted round the grid vertices above it (centroid + farthest vertex).
  public static func columns(_ sampler: TerrainSampler, _ b: Bounds2, cell: Double = 7, min: Double = 2.5) -> [TerrainColumn] {
    let G = sampler.grid
    let ncx = Swift.max(0, worldCount(JS.ceil((b.x1 - b.x0) / cell))), ncz = Swift.max(0, worldCount(JS.ceil((b.z1 - b.z0) / cell)))
    let N = Swift.max(0, ncx * ncz)
    var n = [Int](repeating: 0, count: N), sx = [Double](repeating: 0, count: N), sz = sx
    var top = [Float](repeating: -1e9, count: N)
    func cellOf(_ x: Double, _ z: Double) -> Int {
      let ci = ((x - b.x0) / cell).rounded(.down), cj = ((z - b.z0) / cell).rounded(.down)
      // (written positively so a NaN coordinate is out of range too)
      return ci >= 0 && cj >= 0 && ci < Double(ncx) && cj < Double(ncz) ? Int(cj) * ncx + Int(ci) : -1
    }
    func each(_ fn: (Int, Double, Double, Float) -> Void) {
      for j in 0..<G.nz {
        let z = G.z0 + Double(j) * G.step
        for i in 0..<G.nx {
          let h = G.H[j * G.nx + i]
          if Double(h) < min { continue }
          let x = G.x0 + Double(i) * G.step
          let c = cellOf(x, z)
          if c >= 0 { fn(c, x, z, h) }
        }
      }
    }
    each { c, x, z, h in
      n[c] += 1
      sx[c] += x
      sz[c] += z
      if h > top[c] { top[c] = h }
    }
    var rad = [Float](repeating: 0, count: N)
    each { c, x, z, _ in
      rad[c] = Float(JS.max(Double(rad[c]), JS.hypot(x - sx[c] / Double(n[c]), z - sz[c] / Double(n[c]))))
    }
    var out = [TerrainColumn]()
    for c in 0..<N where n[c] > 0 {
      out.append(TerrainColumn(x: sx[c] / Double(n[c]), z: sz[c] / Double(n[c]), radius: Double(rad[c]) + G.step * 0.5, top: Double(top[c]) + 0.3))
    }
    return out
  }

  /// fitShoals(sampler, count, {minR = 4, margin = 1.5, level = 0.15}): greedy maxima of a chamfer
  /// distance transform; each circle is the largest one fitting the coast where nothing is covered yet.
  public static func shoals(_ sampler: TerrainSampler, _ count: Int, minR: Double = 4, margin: Double = 1.5, level: Double = 0.15) -> [ShoalCircle] {
    let G = sampler.grid
    let nx = G.nx, nz = G.nz, step = G.step
    let N = nx * nz
    let BIG = 1e9
    var D = [Float](repeating: 0, count: N)
    for i in 0..<N { D[i] = Double(G.H[i]) > level ? Float(BIG) : 0 }
    let a = step, b = step * JS.SQRT2
    for j in 0..<nz {
      for i in 0..<nx {
        let id = j * nx + i
        if D[id] == 0 { continue }
        var v = Double(D[id])
        if i > 0 { v = JS.min(v, Double(D[id - 1]) + a) }
        if j > 0 {
          v = JS.min(v, Double(D[id - nx]) + a)
          if i > 0 { v = JS.min(v, Double(D[id - nx - 1]) + b) }
          if i < nx - 1 { v = JS.min(v, Double(D[id - nx + 1]) + b) }
        }
        D[id] = Float(v)
      }
    }
    for j in stride(from: nz - 1, through: 0, by: -1) {
      for i in stride(from: nx - 1, through: 0, by: -1) {
        let id = j * nx + i
        if D[id] == 0 { continue }
        var v = Double(D[id])
        if i < nx - 1 { v = JS.min(v, Double(D[id + 1]) + a) }
        if j < nz - 1 {
          v = JS.min(v, Double(D[id + nx]) + a)
          if i < nx - 1 { v = JS.min(v, Double(D[id + nx + 1]) + b) }
          if i > 0 { v = JS.min(v, Double(D[id + nx - 1]) + b) }
        }
        D[id] = Float(v)
      }
    }
    var out = [ShoalCircle]()
    for _ in 0..<count {
      var best = -1, bv = minR
      for id in 0..<N {
        let v = Double(D[id])
        if v <= bv || v >= BIG { continue }
        let x = G.x0 + Double(id % nx) * step, z = G.z0 + Double(id / nx) * step
        var free = true
        for c in out where JS.hypot(x - c.x, z - c.z) < c.radius - margin + v * 0.35 {
          free = false
          break
        }
        if free {
          bv = v
          best = id
        }
      }
      if best < 0 { break }
      out.append(ShoalCircle(x: G.x0 + Double(best % nx) * step, z: G.z0 + Double(best / nx) * step, radius: Double(D[best]) + margin))
    }
    return out
  }

  /// scatterBoulders(sampler, rnd, {count = 30, erratics = 4, avoid, bounds}): tide-washed boulders
  /// along the shore + a few glacial erratics on the flat rock above 3 m.
  public static func boulders(_ sampler: TerrainSampler, _ rnd: inout Mulberry32, count: Int = 30, erratics: Int = 4,
                              avoid: ((Double, Double) -> Bool)? = nil, bounds b: Bounds2) -> [BoulderPlacement] {
    var out = [BoulderPlacement]()
    var tries = 0
    while out.count < count {
      let t = tries
      tries += 1
      if !(t < count * 60) { break }
      let x = b.x0 + rnd.next() * (b.x1 - b.x0), z = b.z0 + rnd.next() * (b.z1 - b.z0)
      let h = sampler.heightAt(x, z)
      if h < -0.9 || h > 2.3 { continue }
      if let av = avoid, av(x, z) { continue }
      let up = sampler.upAt(x, z)
      if up < 0.55 { continue }
      let big = rnd.next()
      let s = 0.55 + 2.1 * big * big * (h < 0.6 ? 1 : 0.6)
      if out.contains(where: { JS.hypot($0.x - x, $0.z - z) < ($0.s + s) * 0.9 }) { continue }
      let sy = 0.8 + 0.5 * rnd.next()
      let ry = rnd.next() * JS.PI * 2
      out.append(BoulderPlacement(x: x, y: h - 0.22 * s, z: z, s: s, sy: sy, ry: ry))
    }
    tries = 0
    var placed = 0
    while placed < erratics {
      let t = tries
      tries += 1
      if !(t < erratics * 80) { break }
      let x = b.x0 + rnd.next() * (b.x1 - b.x0), z = b.z0 + rnd.next() * (b.z1 - b.z0)
      let h = sampler.heightAt(x, z)
      if h < 3 || sampler.upAt(x, z) < 0.88 || sampler.cavityAt(x, z) > 0.6 { continue }
      if let av = avoid, av(x, z) { continue }
      let s = 1.3 + 1.4 * rnd.next()
      if out.contains(where: { JS.hypot($0.x - x, $0.z - z) < ($0.s + s) * 1.2 }) { continue }
      let sy = 0.85 + 0.3 * rnd.next()
      let ry = rnd.next() * JS.PI * 2
      out.append(BoulderPlacement(x: x, y: h - 0.18 * s, z: z, s: s, sy: sy, ry: ry))
      placed += 1
    }
    return out
  }

  /// The boulder InstancedMesh matrices (landforms.js boulderMesh): Euler(0, ry, ry % 0.3 − 0.15) XYZ,
  /// scale (s, s·sy, s·(0.75 + 0.25·sin 7ry)); 16 column-major Float32 per boulder.
  public static func boulderMatrices(_ list: [BoulderPlacement]) -> [Float] {
    var out = [Float](repeating: 0, count: list.count * 16)
    for (i, b) in list.enumerated() {
      var q = Quat()
      q.setFromEuler(Euler(0, b.ry, JSNumber.mod(b.ry, 0.3) - 0.15))
      var m = Mat4()
      m.compose(V3(b.x, b.y, b.z), q, V3(b.s, b.s * b.sy, b.s * (0.75 + 0.25 * JS.sin(b.ry * 7))))
      m.storeFloat32(into: &out, at: i * 16)
    }
    return out
  }

  /// coverRule(seed, k): ground cover — bare in the salt-spray zone, soil in concave sites, patchy.
  public static func coverRule(_ seed: Double, _ k: Double = 1) -> (Double, Double, Double, Double, Double, Double) -> Double {
    return { x, z, h, ny, cav, shel in
      let spray = TerrainNoise.sstep(1.9, 4.2, h) // salt spray zone stays bare
      let flat = TerrainNoise.sstep(0.62, 0.86, ny)
      let hollow = TerrainNoise.sstep(0.36, 0.62, cav * 0.7 + shel * 0.5) // soil gathers in concave sites
      let patch = 0.5 + 0.5 * TerrainNoise.fbm2(x * 0.07, z * 0.07, seed + 41, 3)
      let v = spray * flat * (0.2 + 0.8 * hollow) * (0.5 + 0.8 * patch) * k
      return JS.min(1, JS.max(0, v * 1.25))
    }
  }
}
