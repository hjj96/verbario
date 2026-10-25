// world/vegetation.js Vegetation: the placement half — where the northern vegetation of a landmass
// grows and the per-instance data the renderer draws it with (Shaders/World/Vegetation.metal; the card
// geometries and the atlas are baked). Sparse and wind-shaped:
//   spruce   krummholz groves in sheltered hollows + solitary wind-pruned mats
//   shrub    dwarf birch / juniper / crowberry clumps wherever the tundra is thick
//   tuft     sedge / grass tufts on path verges, round the buildings, in wet hollows
// One mulberry32 stream (seed) drives groves → trees → shrubs → tufts → the per-instance fills, in that
// order. The fills share one THREE.Euler: spruce sets order 'YXZ' and the shrub / tuft `e.set(x, y, z)`
// keep it (set() without an order keeps the current one) — mirrored here. Instance data are Float32
// like InstancedMesh: matrix (16), colour (3, linear), aInst = (exposure, seed) (2).
// Tests/Vectors/world/terrain_first_<quality>.json island.vegetation.

public struct VegetationScatter: Sendable {
  public enum Kind: String, CaseIterable, Sendable { case spruce, shrub, tuft }

  public struct Tree: Equatable, Sendable {
    public var x, z, y, h, r: Double
    public var solo: Bool
    public var exp: Double
  }

  public struct Shrub: Equatable, Sendable {
    public var x, z, y, s, hs: Double
  }

  public struct Tuft: Equatable, Sendable {
    public var x, z, y, s: Double
  }

  /// One InstancedMesh: `full` instances placed, `count` drawn at the current quality.
  public struct Instances: Sendable {
    public var matrices: [Float]
    public var colors: [Float]
    public var inst: [Float]
    public var full: Int
    public var count: Int
    public var visible: Bool { count > 0 }
  }

  public private(set) var trees: [Tree] = []
  public private(set) var shrubs: [Shrub] = []
  public private(set) var tufts: [Tuft] = []
  public private(set) var spruce: Instances
  public private(set) var shrub: Instances
  public private(set) var tuft: Instances
  let counts: [String: [String: Int]]

  public init(tables t: WorldTables, sampler S: TerrainSampler, quality: String, seed: Double, bounds b: Bounds2,
              clear: ((Double, Double, Double) -> Bool)?, pathDist: ((Double, Double) -> Double)?) {
    counts = t.vegCounts
    var r = Mulberry32(seed: seed)
    let maxSpruce = t.vegCounts["high"]?["spruce"] ?? 0, maxShrub = t.vegCounts["high"]?["shrub"] ?? 0, maxTuft = t.vegCounts["high"]?["tuft"] ?? 0
    let x0 = b.x0, z0 = b.z0, x1 = b.x1, z1 = b.z1
    func free(_ x: Double, _ z: Double, _ pad: Double) -> Bool { !(clear?(x, z, pad) ?? false) }
    func grow(_ x: Double, _ z: Double) -> Double {
      let h = S.heightAt(x, z)
      if h < 2.6 { return 0 }
      return S.coverAt(x, z) * S.upAt(x, z)
    }

    // --- spruce groves in the sheltered hollows + solitary wind-pruned mats
    var trees = [Tree]()
    var groves = [(x: Double, z: Double, sc: Double)]()
    var tt = 0
    while tt < 1200 && groves.count < 5 {
      defer { tt += 1 }
      let x = x0 + r.next() * (x1 - x0), z = z0 + r.next() * (z1 - z0)
      let sc = grow(x, z) * S.shelterAt(x, z)
      if sc < 0.12 || !free(x, z, 6) { continue }
      if groves.contains(where: { JS.hypot($0.x - x, $0.z - z) < 15 }) { continue }
      groves.append((x, z, sc))
    }
    tt = 0
    while tt < 4000 && trees.count < maxSpruce {
      defer { tt += 1 }
      let solo = Double(trees.count) > Double(maxSpruce) * 0.85
      var x: Double, z: Double
      if !solo && !groves.isEmpty {
        let g = groves[tt % groves.count]
        let a = r.next() * JS.PI * 2, d = JS.abs(r.next() + r.next() - 1) * 11
        x = g.x + JS.cos(a) * d
        z = g.z + JS.sin(a) * d
      } else {
        x = x0 + r.next() * (x1 - x0)
        z = z0 + r.next() * (z1 - z0)
      }
      if !S.inside(x, z) || !free(x, z, 2) { continue }
      let gr = grow(x, z), shel = S.shelterAt(x, z)
      if gr < 0.2 || S.upAt(x, z) < 0.8 { continue }
      let hgt = solo ? 1.1 + 1.0 * r.next() : (3 + 4.5 * r.next()) * (0.65 + 0.5 * JS.min(1, shel * 1.4))
      let rad = hgt * 0.3
      if trees.contains(where: { JS.hypot($0.x - x, $0.z - z) < ($0.r + rad) * 0.62 }) { continue }
      trees.append(Tree(x: x, z: z, y: S.heightAt(x, z) - 0.15, h: hgt, r: rad, solo: solo, exp: solo ? 1 : JS.max(0, 0.9 - shel)))
    }
    // --- shrubs: anywhere the tundra is thick
    var shrubs = [Shrub]()
    tt = 0
    while tt < 16000 && shrubs.count < maxShrub {
      defer { tt += 1 }
      let x = x0 + r.next() * (x1 - x0), z = z0 + r.next() * (z1 - z0)
      if !S.inside(x, z) || !free(x, z, 0.5) { continue }
      let gr = grow(x, z) * (0.7 + 0.9 * JS.max(0, TerrainNoise.fbm2(x * 0.09, z * 0.09, seed + 61, 2) + 0.2))
      if gr < 0.2 + 0.4 * r.next() { continue }
      let s = 0.45 + 0.9 * r.next() * r.next()
      if trees.contains(where: { JS.hypot($0.x - x, $0.z - z) < $0.r * 0.8 }) { continue }
      shrubs.append(Shrub(x: x, z: z, y: S.heightAt(x, z) - 0.05, s: s, hs: 0.45 + 0.4 * r.next()))
    }
    // --- tufts: path verges, round the buildings, wet hollows
    var tufts = [Tuft]()
    tt = 0
    while tt < 9000 && tufts.count < maxTuft {
      defer { tt += 1 }
      let x = x0 + r.next() * (x1 - x0), z = z0 + r.next() * (z1 - z0)
      if !S.inside(x, z) || !free(x, z, 0) { continue }
      let pd = pathDist?(x, z) ?? 9
      let gr = grow(x, z) + (pd < 3.5 ? 0.35 : 0) + S.cavityAt(x, z) * 0.3 - 0.15
      if gr < 0.25 + 0.3 * r.next() { continue }
      tufts.append(Tuft(x: x, z: z, y: S.heightAt(x, z) - 0.03, s: 0.28 + 0.3 * r.next()))
    }

    // --- per-instance data (make(kind, geo, list, fill)); one Euler shared by the three fills
    var e = Euler()
    func make(_ n: Int, _ exp: (Int) -> Double, _ fill: (Int, inout Euler, inout Mulberry32) -> (p: V3, sc: V3, col: Color3)) -> Instances {
      let cap = Swift.max(1, n)
      var mats = [Float](repeating: 0, count: cap * 16), cols = [Float](repeating: 0, count: cap * 3), inst = [Float](repeating: 0, count: cap * 2)
      for i in 0..<n {
        let f = fill(i, &e, &r)
        var q = Quat()
        q.setFromEuler(e)
        var m = Mat4()
        m.compose(f.p, q, f.sc)
        m.storeFloat32(into: &mats, at: i * 16)
        cols[i * 3] = Float(f.col.r)
        cols[i * 3 + 1] = Float(f.col.g)
        cols[i * 3 + 2] = Float(f.col.b)
        inst[i * 2] = Float(JSNumber.or(exp(i), 0))
        inst[i * 2 + 1] = Float(r.next())
      }
      return Instances(matrices: mats, colors: cols, inst: inst, full: n, count: n)
    }
    let PREVAIL = t.prevail
    spruce = make(trees.count, { trees[$0].exp }) { i, e, r in
      // lean away from the prevailing gales; mats are squat and wide
      let it = trees[i]
      let lean = (it.solo ? 0.12 : 0.05) * (0.4 + it.exp)
      e.set(PREVAIL.y * lean, r.next() * JS.PI * 2, -PREVAIL.x * lean, .YXZ)
      let wide = it.solo ? 1.9 : 1
      let k = 0.78 + 0.4 * r.next()
      let cr = k * (0.92 + 0.16 * r.next()), cg = k * (0.95 + 0.12 * r.next()), cb = k * (0.88 + 0.2 * r.next())
      return (V3(it.x, it.y, it.z), V3(it.h * wide, it.h, it.h * wide), Color3(cr, cg, cb))
    }
    shrub = make(shrubs.count, { _ in 0 }) { i, e, r in
      let it = shrubs[i]
      let ex = (r.next() - 0.5) * 0.25, ey = r.next() * JS.PI * 2, ez = (r.next() - 0.5) * 0.25
      e.set(ex, ey, ez)
      let cr = 0.8 + 0.35 * r.next(), cg = 0.8 + 0.3 * r.next(), cb = 0.8 + 0.25 * r.next()
      return (V3(it.x, it.y, it.z), V3(it.s, it.s * it.hs, it.s), Color3(cr, cg, cb))
    }
    tuft = make(tufts.count, { _ in 0 }) { i, e, r in
      let it = tufts[i]
      let ex = (r.next() - 0.5) * 0.2, ey = r.next() * JS.PI * 2, ez = (r.next() - 0.5) * 0.2
      e.set(ex, ey, ez)
      let sy = it.s * (0.8 + 0.6 * r.next())
      let cr = 0.85 + 0.3 * r.next(), cg = 0.85 + 0.25 * r.next(), cb = 0.8 + 0.2 * r.next()
      return (V3(it.x, it.y, it.z), V3(it.s, sy, it.s), Color3(cr, cg, cb))
    }
    self.trees = trees
    self.shrubs = shrubs
    self.tufts = tufts
    setQuality(quality)
  }

  /// setQuality(q): count = min(full, VEG_COUNTS[q][kind] ?? 0) (unknown quality → high).
  public mutating func setQuality(_ q: String) {
    let c = counts[q] ?? counts["high"] ?? [:]
    spruce.count = Swift.min(spruce.full, c["spruce"] ?? 0)
    shrub.count = Swift.min(shrub.full, c["shrub"] ?? 0)
    tuft.count = Swift.min(tuft.full, c["tuft"] ?? 0)
  }

  public func instances(_ k: Kind) -> Instances {
    switch k {
    case .spruce: return spruce
    case .shrub: return shrub
    case .tuft: return tuft
    }
  }
}
