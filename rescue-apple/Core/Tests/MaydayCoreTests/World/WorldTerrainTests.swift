// Terrain parity (world/terrain.js, world/landforms.js, world/vegetation.js) against the real web modules
// run in Node: Tests/Vectors/world/terrain_noise.json, landmass_first.json, terrain_first_<quality>.json.
import XCTest
@testable import MaydayCore

final class WorldTerrainTests: XCTestCase {
  // ---- tables ----------------------------------------------------------------------------------------

  func testGradientTableMatchesData() throws {
    let t = try WorldFixtures.tables()
    assertBitEqual(TerrainNoise.GX, t.gx, "GX (computed) vs world.json")
    assertBitEqual(TerrainNoise.GY, t.gy, "GY (computed) vs world.json")
    let v = try VectorLoader.load("world/terrain_noise")
    assertBitEqual(TerrainNoise.GX, try v.data["gx"].nums("gx"), "GX vs vector")
    assertBitEqual(TerrainNoise.GY, try v.data["gy"].nums("gy"), "GY vs vector")
  }

  // ---- noise primitives ------------------------------------------------------------------------------

  func testNoisePrimitives() throws {
    let v = try VectorLoader.load("world/terrain_noise")
    let d = v.data
    let seeds = try d["seeds"].nums("seeds"), scales = try d["scales"].nums("scales")
    let xs = try d["x"].nums("x"), ys = try d["y"].nums("y")
    XCTAssertGreaterThan(xs.count, 300, "noise sample count")
    var n2 = [Double](), fb = [Double](), rd = [Double]()
    for i in xs.indices {
      let s = seeds[i % seeds.count], sc = scales[i % scales.count]
      let x = xs[i] * sc, y = ys[i] * sc
      n2.append(TerrainNoise.noise2(x, y, s))
      fb.append(TerrainNoise.fbm2(x, y, s, 2 + i % 3))
      rd.append(TerrainNoise.ridged2(x, y, s, 3 + i % 2))
    }
    assertBitEqual(n2, try d["noise2"].nums("noise2"), "noise2")
    assertBitEqual(fb, try d["fbm2"].nums("fbm2"), "fbm2")
    assertBitEqual(rd, try d["ridged2"].nums("ridged2"), "ridged2")

    let H = d["hash"]
    let hx = try H["x"].nums("hash.x"), hy = try H["y"].nums("hash.y"), hs = try H["s"].nums("hash.s")
    let hh = try H["h"].nums("hash.h"), h01 = try H["h01"].nums("hash.h01")
    for i in hx.indices {
      XCTAssertEqual(Double(TerrainNoise.hashi(hx[i], hy[i], hs[i])), hh[i], "hashi[\(i)]")
      assertBitEqual(TerrainNoise.hash01(hx[i], hy[i], hs[i]), h01[i], "hash01[\(i)]")
    }
    for (i, row) in (d["sstep"].array ?? []).enumerated() {
      let r = try row.nums("sstep")
      assertBitEqual(TerrainNoise.sstep(r[0], r[1], r[2]), r[3], "sstep[\(i)]")
    }
    for (i, row) in (d["smax"].array ?? []).enumerated() {
      let r = try row.nums("smax")
      assertBitEqual(TerrainNoise.smax(r[0], r[1], r[2]), r[3], "smax[\(i)]")
    }
    let feet = try (d["feet"].array ?? []).map { f -> Footprint in
      var o = JSONObject()
      for (k, v) in f.object?.entries ?? [] { o.set(k, v) }
      o.set("blend", .number(1))
      return try Footprint(json: .object(o))
    }
    for (i, row) in (d["footDist"].array ?? []).enumerated() {
      let r = try row.nums("footDist")
      let fd = feet[Int(r[0])].distance(r[1], r[2])
      assertBitEqual(fd.d, r[3], "footDist[\(i)].d")
      assertBitEqual(fd.t, r[4], "footDist[\(i)].t")
    }
  }

  // ---- landmass definitions and height functions -------------------------------------------------------

  func testLandmassDefinitions() throws {
    let t = try WorldFixtures.tables()
    let v = try VectorLoader.load("world/landmass_first")
    let d = v.data
    // «Скалистый»
    let isl = Landforms.islandDef(t)
    try assertDef(isl, d["island"]["def"], "islandDef")
    let fn = HeightFunction(isl)
    let xs = try d["island"]["x"].nums("x"), zs = try d["island"]["z"].nums("z")
    XCTAssertEqual(xs.count, 600, "island height samples")
    XCTAssertEqual(d["rocks"].array?.count, 3, "op1 rocks")
    assertBitEqual(xs.indices.map { fn(xs[$0], zs[$0]) }, try d["island"]["h"].nums("h"), "island height")
    // the op1 rocks, seeds drawn as createRockField does
    var r = Mulberry32(seed: try d["seed"].num("seed") * 31 + 5)
    for (i, rk) in (d["rocks"].array ?? []).enumerated() {
      let s0 = (r.next() * 1000).rounded(.down) + 1
      XCTAssertEqual(s0, try rk["s0"].num("s0"), "rock \(i) seed")
      let spec = RockSpec(x: try rk["rock"]["x"].num("x"), z: try rk["rock"]["z"].num("z"), radius: rk["rock"]["radius"].double,
                          height: rk["rock"]["height"].double, name: rk["rock"]["name"].string)
      let D = Landforms.rockDef(t, spec, seed: s0)
      try assertDef(D.def, rk["def"], "rock \(i) def")
      let b = rk["bounds"]
      assertBitEqual([D.bounds.x0, D.bounds.z0, D.bounds.x1, D.bounds.z1], [try b["x0"].num(""), try b["z0"].num(""), try b["x1"].num(""), try b["z1"].num("")],
                     "rock \(i) bounds")
      assertBitEqual(D.spire, try rk["spire"].num("spire"), "rock \(i) spire")
      let f = HeightFunction(D.def)
      let x = try rk["x"].nums("x"), z = try rk["z"].nums("z")
      assertBitEqual(x.indices.map { f(x[$0], z[$0]) }, try rk["h"].nums("h"), "rock \(i) height")
    }
  }

  func assertDef(_ a: LandmassDef, _ e: JSONValue, _ label: String) throws {
    assertBitEqual(a.seed, try e["seed"].num("seed"), "\(label).seed")
    let lobes = e["lobes"].array ?? []
    XCTAssertEqual(a.lobes.count, lobes.count, "\(label) lobes")
    for (i, (L, j)) in zip(a.lobes, lobes).enumerated() {
      let got = [L.x, L.z, L.rx, L.rz, L.rot ?? .nan, L.h, L.w ?? .nan, L.k ?? .nan, L.peak ?? .nan, L.rag ?? .nan]
      let want = try ["x", "z", "rx", "rz", "rot", "h", "w", "k", "peak", "rag"].map { j[$0].double ?? .nan }
      assertBitEqual(got, want, "\(label).lobes[\(i)]")
    }
    func opt(_ x: Double?, _ k: String) { assertBitEqual(x ?? .nan, e[k].double ?? .nan, "\(label).\(k)") }
    opt(a.cliff, "cliff"); opt(a.ice, "ice"); opt(a.ridge, "ridge"); opt(a.bump, "bump"); opt(a.step, "step"); opt(a.terr, "terr"); opt(a.floor, "floor")
    assertBitEqual([a.expose?.x ?? .nan, a.expose?.y ?? .nan], e["expose"].doubles ?? [.nan, .nan], "\(label).expose")
    assertBitEqual([a.tilt?.x ?? .nan, a.tilt?.y ?? .nan], e["tilt"].doubles ?? [.nan, .nan], "\(label).tilt")
    if let j = a.joint {
      let je = e["joint"]
      assertBitEqual(j.sp + [j.depth, j.width, j.dir], (je["sp"].doubles ?? []) + [je["depth"].double ?? .nan, je["width"].double ?? .nan, je["dir"].double ?? .nan],
                     "\(label).joint")
    } else {
      XCTAssertTrue(e["joint"].isNull, "\(label).joint")
    }
    XCTAssertEqual(a.flats.count, e["flats"].array?.count ?? 0, "\(label).flats")
    XCTAssertEqual(a.cuts.count, e["cuts"].array?.count ?? 0, "\(label).cuts")
    for (i, (F, j)) in zip(a.flats + a.cuts, (e["flats"].array ?? []) + (e["cuts"].array ?? [])).enumerated() {
      XCTAssertEqual(F, try Footprint(json: j), "\(label) footprint \(i)")
    }
  }

  // ---- built terrain, fits and vegetation per quality -----------------------------------------------------

  func testTerrainHigh() throws { try checkTerrain("high") }
  func testTerrainMedium() throws { try checkTerrain("medium") }
  func testTerrainLow() throws { try checkTerrain("low") }

  func checkTerrain(_ q: String) throws {
    let t = try WorldFixtures.tables()
    let v = try VectorLoader.load("world/terrain_first_\(q)")
    let d = v.data
    XCTAssertEqual(d["quality"].string, q)
    // «Скалистый» (createIsland: terrain, boulders rng(def.seed) avoiding islandClear(·, 1.5), vegetation, columns)
    let island = IslandLand(tables: t, quality: q)
    let E = d["island"]
    try checkLandmass(island.land, E, island.obstacles, island.boulders, t.islandBounds, v, "island \(q)")
    XCTAssertEqual(island.boulders.count, E["boulderCount"].int, "island \(q) boulder count")
    // vegetation
    let VE = E["vegetation"]
    let all = try v.sidecarF32(VE["data"])
    for k in VegetationScatter.Kind.allCases {
      let e = VE["kinds"][k.rawValue]
      let got = island.vegetation.instances(k)
      XCTAssertEqual(got.full, e["full"].int, "\(q) veg \(k) full")
      XCTAssertEqual(got.count, e["count"].int, "\(q) veg \(k) count")
      let off = e["offset"].int ?? 0, n = got.full
      guard all.count >= off + n * 21 else {
        XCTFail("\(q) veg \(k): sidecar too short")
        continue
      }
      assertFloats(Array(got.matrices.prefix(n * 16)), all[off..<(off + n * 16)].map { Double($0) }, "\(q) veg \(k) matrices")
      assertFloats(Array(got.colors.prefix(n * 3)), all[(off + n * 16)..<(off + n * 19)].map { Double($0) }, "\(q) veg \(k) colours")
      assertFloats(Array(got.inst.prefix(n * 2)), all[(off + n * 19)..<(off + n * 21)].map { Double($0) }, "\(q) veg \(k) aInst")
    }
    XCTAssertGreaterThan(island.vegetation.spruce.full + island.vegetation.shrub.full, 100, "\(q) vegetation placed")
    XCTAssertGreaterThan(island.boulders.full, 20, "\(q) island boulders")
    // the op1 rocks
    let rocks = d["rocks"].array ?? []
    XCTAssertEqual(rocks.count, 3, "\(q) op1 rocks")
    let s0 = try d["s0"].nums("s0")
    for (i, (rk, R)) in zip(rocks, d["rockLand"].array ?? []).enumerated() {
      let spec = RockSpec(x: try rk["x"].num("x"), z: try rk["z"].num("z"), radius: rk["radius"].double, height: rk["height"].double, name: rk["name"].string)
      let (T, D) = Landforms.buildRockTerrain(t, spec, seed: s0[i], quality: q)
      let cols = TerrainFit.columns(T.sampler, D.bounds, cell: JS.max(5, JS.min(9, D.R * 0.4)), min: 2.5)
      var br = Mulberry32(seed: s0[i] + 77)
      let bl = TerrainFit.boulders(T.sampler, &br, count: Int(JS.round(4 + D.R * 0.25)), erratics: D.H / D.R < 0.8 ? 2 : 0, bounds: D.bounds)
      var set = BoulderSet(bl)
      set.setQuality(q, t)
      try checkLandmass(T, R, cols, set, D.bounds, v, "rock \(i) \(q)")
      XCTAssertEqual(set.count, R["boulderCount"].int, "rock \(i) \(q) boulder count")
    }
  }

  func checkLandmass(_ L: LandmassBuild, _ E: JSONValue, _ cols: [TerrainColumn], _ boulders: BoulderSet, _ b: Bounds2, _ v: VectorFile,
                     _ label: String) throws {
    let S = L.sampler, G = S.grid
    let g = E["grid"]
    XCTAssertEqual(G.nx, g["nx"].int, "\(label) nx")
    XCTAssertEqual(G.nz, g["nz"].int, "\(label) nz")
    assertBitEqual([G.x0, G.z0, G.step], [try g["x0"].num(""), try g["z0"].num(""), try g["step"].num("")], "\(label) grid origin / step")
    assertBitEqual(S.hmax, try E["hmax"].num("hmax"), "\(label) hmax")
    XCTAssertEqual(L.terrain.triangles, E["triangles"].int, "\(label) triangles")
    // sampler arrays: full on high (first mismatch reported), sha256 everywhere
    if E["arrays"].exists {
      let all = try v.sidecarF32(E["arrays"])
      let N = G.nx * G.nz
      for (k, (name, arr)) in [("H", G.H), ("NY", G.NY), ("COV", G.COV), ("SHL", G.SHL), ("CAV", G.CAV)].enumerated() {
        assertFloats(arr, all[(k * N)..<((k + 1) * N)].map { Double($0) }, "\(label) \(name)")
      }
    }
    let sha = E["sha"]
    XCTAssertEqual(Bytes.sha(G.H), sha["H"].string, "\(label) sha H")
    XCTAssertEqual(Bytes.sha(G.NY), sha["NY"].string, "\(label) sha NY")
    XCTAssertEqual(Bytes.sha(G.COV), sha["COV"].string, "\(label) sha COV")
    XCTAssertEqual(Bytes.sha(G.SHL), sha["SHL"].string, "\(label) sha SHL")
    XCTAssertEqual(Bytes.sha(G.CAV), sha["CAV"].string, "\(label) sha CAV")
    // mesh
    let M = L.mesh, me = E["mesh"]
    XCTAssertEqual(M.vertexCount, me["vertices"].int, "\(label) vertices")
    XCTAssertEqual(M.indices.count, me["indices"].int, "\(label) indices")
    XCTAssertEqual(M.drawCount, me["drawCount"].int, "\(label) drawCount")
    if let sr = me["shadowRange"].doubles {
      XCTAssertEqual(M.shadowRange.map { [Double($0.start), Double($0.count)] }, sr, "\(label) shadowRange")
    } else {
      XCTAssertNil(M.shadowRange, "\(label) shadowRange")
    }
    XCTAssertEqual(Bytes.sha(M.positions), me["sha"]["position"].string, "\(label) mesh positions")
    XCTAssertEqual(Bytes.sha(M.normals), me["sha"]["normal"].string, "\(label) mesh normals")
    XCTAssertEqual(Bytes.sha(M.aTerr), me["sha"]["aTerr"].string, "\(label) mesh aTerr")
    XCTAssertEqual(Bytes.sha(M.indices), me["sha"]["index"].string, "\(label) mesh indices")
    // sampler queries
    let Q = E["queries"]
    let xs = try Q["x"].nums("x"), zs = try Q["z"].nums("z")
    XCTAssertGreaterThan(xs.count, 200, "\(label) query count")
    XCTAssertEqual(xs.indices.map { S.inside(xs[$0], zs[$0]) }, (Q["inside"].array ?? []).map { $0.bool ?? false }, "\(label) inside")
    assertBitEqual(xs.indices.map { S.heightAt(xs[$0], zs[$0]) }, try Q["height"].nums(""), "\(label) heightAt")
    assertBitEqual(xs.indices.map { S.upAt(xs[$0], zs[$0]) }, try Q["up"].nums(""), "\(label) upAt")
    assertBitEqual(xs.indices.map { S.coverAt(xs[$0], zs[$0]) }, try Q["cover"].nums(""), "\(label) coverAt")
    assertBitEqual(xs.indices.map { S.shelterAt(xs[$0], zs[$0]) }, try Q["shelter"].nums(""), "\(label) shelterAt")
    assertBitEqual(xs.indices.map { S.cavityAt(xs[$0], zs[$0]) }, try Q["cavity"].nums(""), "\(label) cavityAt")
    let nrm = try (Q["normal"].array ?? []).flatMap { try $0.nums("normal") }
    assertBitEqual(xs.indices.flatMap { i -> [Double] in let n = S.normalAt(xs[i], zs[i]); return [n.x, n.y, n.z] }, nrm, "\(label) normalAt")
    // fits
    let sh = E["shoals"].array ?? []
    XCTAssertEqual(L.shoals.count, sh.count, "\(label) shoals")
    assertBitEqual(L.shoals.flatMap { [$0.x, $0.z, $0.radius] }, try sh.flatMap { [try $0["x"].num(""), try $0["z"].num(""), try $0["radius"].num("")] },
                   "\(label) shoals")
    let ce = E["columns"].array ?? []
    XCTAssertEqual(cols.count, ce.count, "\(label) columns")
    assertBitEqual(cols.flatMap { [$0.x, $0.z, $0.radius, $0.top] },
                   try ce.flatMap { [try $0["x"].num(""), try $0["z"].num(""), try $0["radius"].num(""), try $0["top"].num("")] }, "\(label) columns")
    let be = E["boulders"].array ?? []
    XCTAssertEqual(boulders.full, be.count, "\(label) boulders")
    assertBitEqual(boulders.placements.flatMap { [$0.x, $0.y, $0.z, $0.s, $0.sy, $0.ry] },
                   try be.flatMap { b in try ["x", "y", "z", "s", "sy", "ry"].map { try b[$0].num($0) } }, "\(label) boulders")
    assertFloats(boulders.matrices, try E["boulderMatrices"].nums(""), "\(label) boulder matrices")
  }

  /// boulderGeometry(7, …BOULDER_SEG[q]): the one boulder shape (fine + coarse shadow LOD).
  func testBoulderGeometry() throws {
    let t = try WorldFixtures.tables()
    let v = try VectorLoader.load("world/boulders")
    for q in ["high", "medium", "low"] {
      let e = v.data[q]
      let m = BoulderGeometry.forQuality(q, tables: t)
      XCTAssertEqual(e["seg"].doubles, (t.boulderSeg[q] ?? []).map { Double($0) }, "\(q) seg")
      assertFloats(m.positions, try e["position"].nums(""), "\(q) boulder positions")
      assertFloats(m.normals, try e["normal"].nums(""), "\(q) boulder normals")
      assertFloats(m.aTerr, try e["aTerr"].nums(""), "\(q) boulder aTerr")
      XCTAssertEqual(m.indices.map { Double($0) }, try e["index"].nums(""), "\(q) boulder indices")
      XCTAssertEqual(m.drawCount, e["drawCount"].int, "\(q) drawCount")
      XCTAssertEqual(m.shadowRange.map { [Double($0.start), Double($0.count)] }, e["shadowRange"].doubles, "\(q) shadowRange")
    }
  }

  /// groundHeight composes the island / rock samplers (a port convenience over the web's own samplers).
  func testGroundHeightUsesSamplers() throws {
    let t = try WorldFixtures.tables()
    let w = World(tables: t, events: EventBus(), settings: StubWorldSettings(quality: "low"))
    let v = try VectorLoader.load("world/setup_first_low")
    w.setup(.object({ var o = JSONObject(); for (k, x) in v.data["def"].object?.entries ?? [] { o.set(k, x) }; return o }()))
    guard let lh = w.lighthouse else { return XCTFail("no lighthouse") }
    assertBitEqual(w.groundHeight(lh.x + 3, lh.z - 20), lh.land.sampler.heightAt(3, -20), "island ground")
    XCTAssertEqual(w.groundHeight(900, 900), -.infinity, "open sea")
    XCTAssertFalse(w.obstacles(at: lh.lantern.x, lh.lantern.z).isEmpty, "the tower is an obstacle")
    XCTAssertEqual(w.padAt(lh.x + 1, lh.z)?.id, PadID(0))
    XCTAssertEqual(w.nearestPad(500, 500)?.name, "Скалистый")
  }
}
