// world/landforms.js: the lighthouse island «Скалистый» and the props rocks (fog pinnacles, reefs,
// «Кошки») as terrain.js landmasses — weathered Arctic granite at 69°N seen from a drone.
//
// The island is local to the lighthouse group (pad centre = origin, tower at (−9, −27)); its flats keep
// every structure seated and the jetty channel wet. A props rock is a main crag (dome or sea stack),
// buttresses, wave-cut shoulders and skerries, all drawn from rng(seed). The renderer gets the terrain
// meshes (TerrainMesh), the boulder instance matrices and the vegetation instances from here; the
// simulation gets the collision columns, the surf circles and the samplers.
// Tests/Vectors/world/landmass_first.json, terrain_first_<quality>.json, setup_first_<quality>.json.

/// A props rock as the def gives it: {x, z, radius = 10, height = 6, name}.
public struct RockSpec: Equatable, Sendable {
  public var x: Double
  public var z: Double
  /// rk.radius (nil / 0 → 10)
  public var radius: Double?
  /// rk.height (nil / 0 → 6)
  public var height: Double?
  public var name: String?

  public init(x: Double, z: Double, radius: Double? = nil, height: Double? = nil, name: String? = nil) {
    self.x = x
    self.z = z
    self.radius = radius
    self.height = height
    self.name = name
  }
}

/// rockDef(rk, seed) → {def, bounds, spire, R, H}
public struct RockDefinition: Equatable, Sendable {
  public var def: LandmassDef
  public var bounds: Bounds2
  public var spire: Double
  public var R: Double
  public var H: Double
}

/// A built landmass: terrain mesh + sampler, its definition and the inscribed shoal circles.
public struct LandmassBuild: Sendable {
  public var terrain: TerrainBuild
  public var def: LandmassDef
  public var shoals: [ShoalCircle]

  public var sampler: TerrainSampler { terrain.sampler }
  public var mesh: TerrainMesh { terrain.mesh }
}

/// One boulder InstancedMesh: placements, Float32 matrices, the full count and the drawn count.
public struct BoulderSet: Sendable {
  public var placements: [BoulderPlacement]
  public var matrices: [Float]
  /// mesh.count = round(full · BOULDERS[quality])
  public var count: Int

  public var full: Int { placements.count }

  init(_ list: [BoulderPlacement]) {
    placements = list
    matrices = TerrainFit.boulderMatrices(list)
    count = list.count
  }

  /// boulderCount(mesh, q)
  mutating func setQuality(_ q: String, _ t: WorldTables) {
    count = worldCount(JS.round(Double(full) * (t.boulderShare[q] ?? 1)))
  }
}

public enum Landforms {
  /// Shadow casters use a coarse copy of each landmass (~1.8 m cells).
  static func shadowStride(_ step: Double) -> Int { Int(JS.max(2, JS.round(1.8 / step))) }

  /// TERRAIN_STEP[quality] || TERRAIN_STEP.high
  static func terrainStep(_ t: WorldTables, _ quality: String) -> Double {
    JSNumber.or(t.terrainStep[quality], t.terrainStep["high"] ?? 0.85)
  }

  // ---- «Скалистый» ------------------------------------------------------------------------------------

  /// islandDef(): open sea to the north-west (sea cliffs there, slabs in the lee by the jetty).
  public static func islandDef(_ t: WorldTables) -> LandmassDef {
    LandmassDef(seed: 4127, lobes: t.islandLobes.map { LandmassLobe(row: $0) }, expose: V2(-0.62, -0.78), cliff: 0.68, ice: t.ice,
                ridge: 2.8, bump: 1.2, step: 1.75, terr: 0.5, joint: JointSpec(sp: [16, 22], depth: 2.6, width: 1.7, dir: 0.62),
                flats: t.islandFlats, cuts: t.islandCuts)
  }

  static func segDist(_ px: Double, _ pz: Double, _ ax: Double, _ az: Double, _ bx: Double, _ bz: Double) -> Double {
    let ex = bx - ax, ez = bz - az
    let t = JS.min(1, JS.max(0, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)))
    return JS.hypot(px - ax - ex * t, pz - az - ez * t)
  }

  /// pathDist(x, z): distance to the footpaths worn through the heather (jetty → fuel → house → tower).
  public static func pathDist(_ t: WorldTables, _ x: Double, _ z: Double) -> Double {
    var d = 1e9
    for P in t.paths where P.count > 1 {
      for i in 0..<(P.count - 1) { d = JS.min(d, segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])) }
    }
    return d
  }

  /// islandClear(x, z, pad): places that must stay clear of trees / boulders (structures, walkways, paths).
  public static func islandClear(_ t: WorldTables, _ x: Double, _ z: Double, _ pad: Double = 0) -> Bool {
    for c in t.clear {
      switch c {
      case .seg(let ax, let az, let bx, let bz, let hw):
        if segDist(x, z, ax, az, bx, bz) < hw + pad { return true }
      case .box(let cx, let cz, let hx, let hz):
        if JS.abs(x - cx) < hx + pad && JS.abs(z - cz) < hz + pad { return true }
      case .circle(let cx, let cz, let r):
        if JS.hypot(x - cx, z - cz) < r + pad { return true }
      }
    }
    return pathDist(t, x, z) < 1.4 + pad
  }

  /// buildIslandTerrain(quality): geometry + sampler + 4 shoals.
  public static func buildIslandTerrain(_ t: WorldTables, quality: String) -> LandmassBuild {
    let def = islandDef(t)
    let base = TerrainFit.coverRule(def.seed, 1.05)
    let cover: (Double, Double, Double, Double, Double, Double) -> Double = { x, z, h, ny, cav, shel in
      var c = base(x, z, h, ny, cav, shel)
      // trampled ground: bare along footpaths, grass right round the buildings
      let pd = pathDist(t, x, z)
      c *= TerrainNoise.sstep(0.5, 1.6, pd + 0.4 * TerrainNoise.hash01((x * 2).rounded(.down), (z * 2).rounded(.down), 7))
      return c
    }
    let step = terrainStep(t, quality)
    let T = TerrainBuilder.build(def, TerrainBuildOptions(bounds: t.islandBounds, step: step, cut: -1.4, cover: cover, skirt: 9, skirtDepth: -10,
                                                          shadowStride: shadowStride(step)))
    return LandmassBuild(terrain: T, def: def, shoals: TerrainFit.shoals(T.sampler, 4, minR: 6, margin: 2))
  }

  // ---- props rocks ------------------------------------------------------------------------------------

  /// rockDef(rk, seed): the props rocks share one glacier-flow bearing (ICE_R); crags are never a single dome.
  public static func rockDef(_ t: WorldTables, _ rk: RockSpec, seed: Double) -> RockDefinition {
    let R = JSNumber.or(rk.radius, 10)
    let H = JSNumber.or(rk.height, 6)
    let spire = JS.min(1, JS.max(0, (H / R - 0.7) / 1.3))
    var r = Mulberry32(seed: seed)
    let ICE_R = t.iceR
    var lobes = [LandmassLobe]()
    let jx = (r.next() - 0.5) * R * 0.2, jz = (r.next() - 0.5) * R * 0.2
    do {
      let rz = R * (0.38 + 0.08 * r.next())
      let rot = -ICE_R + (r.next() - 0.5) * 1.2
      lobes.append(LandmassLobe(x: rk.x + jx, z: rk.z + jz, rx: R * 0.56, rz: rz, rot: rot, h: H, w: 0.5 - 0.36 * spire, k: 2 + 1.2 * spire,
                                peak: 0.15 + 0.6 * spire, rag: 1.3))
    }
    // secondary summits / buttresses
    let cr = 2 + Int((r.next() * 2).rounded(.down))
    let a0 = r.next() * JS.PI * 2
    for k in 0..<cr {
      let a = a0 + (Double(k) / Double(cr)) * JS.PI * 2 + (r.next() - 0.5) * 1.2, d = R * (0.3 + 0.25 * r.next())
      let rx = R * (0.28 + 0.12 * r.next())
      let rz = R * (0.16 + 0.1 * r.next())
      let rot = -a + (r.next() - 0.5) * 0.6
      let h = H * (0.4 + 0.45 * r.next())
      lobes.append(LandmassLobe(x: rk.x + jx + JS.cos(a) * d, z: rk.z + jz + JS.sin(a) * d, rx: rx, rz: rz, rot: rot, h: h, w: 0.42 - 0.25 * spire,
                                k: 2 + spire, peak: 0.2 + 0.5 * spire, rag: 1.1))
    }
    // shoulders: low wave-cut platforms and fallen blocks round the foot of the crag
    let sh = 2 + Int((r.next() * 3).rounded(.down))
    for k in 0..<sh {
      let a = (Double(k) / Double(sh)) * JS.PI * 2 + r.next() * 0.8, d = R * (0.4 + 0.3 * r.next())
      let rr = R * (0.24 + 0.16 * r.next())
      let rz = rr * (0.45 + 0.3 * r.next())
      let rot = -ICE_R + (r.next() - 0.5) * 0.9
      let h = JS.min(6, H * (0.08 + 0.18 * r.next()))
      lobes.append(LandmassLobe(x: rk.x + JS.cos(a) * d, z: rk.z + JS.sin(a) * d, rx: rr, rz: rz, rot: rot, h: h, w: 0.6, k: 1.7, peak: 0, rag: 0.9))
    }
    // skerries
    let sk = 2 + Int((r.next() * 3).rounded(.down))
    for _ in 0..<sk {
      let a = r.next() * JS.PI * 2, d = R * (0.85 + 0.45 * r.next())
      let rr = 1.6 + R * 0.08 * r.next()
      let rot = -ICE_R + (r.next() - 0.5) * 0.8
      let h = 0.6 + r.next() * 0.9
      lobes.append(LandmassLobe(x: rk.x + JS.cos(a) * d, z: rk.z + JS.sin(a) * d, rx: rr, rz: rr * 0.6, rot: rot, h: h, w: 0.75, k: 1.6, peak: 0, rag: 0.9))
    }
    let ext = R * 1.55 + 6
    let def = LandmassDef(
      seed: seed * 7 + 3, lobes: lobes, expose: V2(JS.cos(seed), JS.sin(seed)), cliff: 0.55 + 0.3 * spire, ice: ICE_R,
      ridge: JS.min(4.5, 0.8 + H * 0.11), bump: JS.min(1.1, 0.4 + R * 0.025), step: 1.5 + H * 0.035, terr: 0.42 + 0.25 * spire,
      joint: JointSpec(sp: [7 + R * 0.25, 10 + R * 0.3], depth: JS.min(5, 1 + H * 0.12), width: 1.3 + R * 0.04, dir: seed * 0.37),
      tilt: V2(0.09 * JS.cos(seed * 1.7), 0.09 * JS.sin(seed * 1.7)))
    return RockDefinition(def: def, bounds: Bounds2(x0: rk.x - ext, z0: rk.z - ext, x1: rk.x + ext, z1: rk.z + ext), spire: spire, R: R, H: H)
  }

  /// buildRockTerrain(rk, seed, quality): grid step min(1.6, max(TERRAIN_STEP, R/30)); moss on the domes,
  /// guano-whitened crowns on the stacks; summit rescaled to exactly H.
  public static func buildRockTerrain(_ t: WorldTables, _ rk: RockSpec, seed: Double, quality: String) -> (LandmassBuild, RockDefinition) {
    let D = rockDef(t, rk, seed: seed)
    let base = terrainStep(t, quality)
    let step = JS.min(1.6, JS.max(base, D.R / 30))
    let moss = D.spire > 0.3 ? 0.12 : 0.9
    let cover = TerrainFit.coverRule(D.def.seed, moss)
    let birdK = 0.85 * D.spire // only the stacks hold seabird colonies
    let bird: (Double, Double, Double, Double) -> Double = { _, _, h, hmax in birdK * TerrainNoise.sstep(0.45, 0.9, h / JS.max(1, hmax)) }
    let T = TerrainBuilder.build(D.def, TerrainBuildOptions(bounds: D.bounds, step: step, cut: -1.4, cover: cover, bird: bird, scaleTo: D.H,
                                                            skirt: 7, skirtDepth: -10, shadowStride: shadowStride(step)))
    return (LandmassBuild(terrain: T, def: D.def, shoals: TerrainFit.shoals(T.sampler, 1, minR: 2, margin: 1.5)), D)
  }
}

// ---- createIsland / createRockField ---------------------------------------------------------------------

/// createIsland(W, quality): «Скалистый» terrain + boulders + vegetation, in the lighthouse's local space.
public struct IslandLand: Sendable {
  public var land: LandmassBuild
  public var boulders: BoulderSet
  public var vegetation: VegetationScatter
  /// collision columns hugging the rock above 2.5 m (island-local)
  public var obstacles: [TerrainColumn]
  /// the quality the terrain was built at (later quality changes only change counts)
  public let buildQuality: String

  public var sampler: TerrainSampler { land.sampler }
  public var shoals: [ShoalCircle] { land.shoals }

  public init(tables t: WorldTables, quality: String) {
    let T = Landforms.buildIslandTerrain(t, quality: quality)
    land = T
    buildQuality = quality
    var r = Mulberry32(seed: T.def.seed)
    let bl = TerrainFit.boulders(T.sampler, &r, count: 46, erratics: 6, avoid: { Landforms.islandClear(t, $0, $1, 1.5) }, bounds: t.islandBounds)
    boulders = BoulderSet(bl)
    vegetation = VegetationScatter(tables: t, sampler: T.sampler, quality: quality, seed: T.def.seed + 1, bounds: t.islandBounds,
                                   clear: { Landforms.islandClear(t, $0, $1, $2) }, pathDist: { Landforms.pathDist(t, $0, $1) })
    obstacles = TerrainFit.columns(T.sampler, t.islandBounds, cell: 7, min: 2.5)
    setQuality(quality, t)
  }

  /// land.setQuality(q): boulder and vegetation counts.
  public mutating func setQuality(_ q: String, _ t: WorldTables) {
    boulders.setQuality(q, t)
    vegetation.setQuality(q)
  }
}

/// createRockField(W, list, seed, quality): one terrain + one boulder set per rock (culled per rock).
public struct RockField: Sendable {
  public struct Rock: Sendable {
    public var spec: RockSpec
    /// the per-rock seed s0 = ⌊r()·1000⌋ + 1
    public var seed: Double
    public var land: LandmassBuild
    public var definition: RockDefinition
    /// nil when no boulder found a place (the web then builds no mesh)
    public var boulders: BoulderSet?
  }

  public var rocks: [Rock]
  public var obstacles: [WorldObstacle]
  public var shoals: [ShoalCircle]

  public init(tables t: WorldTables, list: [RockSpec], seed: Double, quality: String) {
    var r = Mulberry32(seed: seed * 31 + 5)
    var rocks = [Rock](), obstacles = [WorldObstacle](), shoals = [ShoalCircle]()
    for rk in list {
      let s0 = (r.next() * 1000).rounded(.down) + 1
      let (T, D) = Landforms.buildRockTerrain(t, rk, seed: s0, quality: quality)
      let R = D.R, H = D.H
      // collision: columns fitted to the rendered rock (crag, buttresses, shoulders above 2.5 m)
      let name = rk.name.flatMap { $0.isEmpty ? nil : $0 } ?? "скала" // rk.name || 'скала'
      for o in TerrainFit.columns(T.sampler, D.bounds, cell: JS.max(5, JS.min(9, R * 0.4)), min: 2.5) {
        obstacles.append(WorldObstacle(x: o.x, z: o.z, radius: o.radius, top: o.top, kind: "rock", name: name))
      }
      shoals.append(contentsOf: T.shoals)
      var br = Mulberry32(seed: s0 + 77)
      let bl = TerrainFit.boulders(T.sampler, &br, count: worldCount(JS.round(4 + R * 0.25)), erratics: H / R < 0.8 ? 2 : 0, bounds: D.bounds)
      rocks.append(Rock(spec: rk, seed: s0, land: T, definition: D, boulders: bl.isEmpty ? nil : BoulderSet(bl)))
    }
    self.rocks = rocks
    self.obstacles = obstacles
    self.shoals = shoals
    setQuality(quality, t)
  }

  public mutating func setQuality(_ q: String, _ t: WorldTables) {
    for i in rocks.indices { rocks[i].boulders?.setQuality(q, t) }
  }
}
