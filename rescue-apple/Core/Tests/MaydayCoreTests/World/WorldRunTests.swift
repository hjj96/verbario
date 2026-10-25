// World system parity (systems/world.js + lighthouse / floaters / lamps / contact / rigging) against the real
// web World run in Node on stub systems (tools/export/export-world.mjs):
//   world/setup_first_<q>.json  everything static after `mission:setup` with the prepared op1 def
//   world/run_first.json        2700 frames of World.update on recorded inputs: a running FNV-1a of every frame
//                               (env, channels, uniforms, lights, collars, windsock, floaters, buoy lamps),
//                               rows every 4 frames to locate a divergence, events and ocean calls
//   world/run_mix.json          the same on a synthetic def (all debris mixes, containers, buoys, ducks)
//   world/rhythms.json          buoyRhythm
import XCTest
@testable import MaydayCore

final class WorldRunTests: XCTestCase {
  // ---- harness ---------------------------------------------------------------------------------------

  /// A real World on the exporter's stub ctx.
  final class Harness {
    let world: World
    let ocean: StubWorldOcean
    let weather: StubWorldWeather
    let hazards: StubWorldHazards?
    let settings: StubWorldSettings
    let events = EventBus()
    var frame = 0
    var foghorns: [(Int, Double, Double)] = []

    init(quality: String, detail: Double = 1, params: Set<String> = [], hazardCentre: [Double]? = nil) throws {
      let t = try WorldFixtures.tables()
      settings = StubWorldSettings(quality: quality, detail: detail)
      world = World(tables: t, events: events, settings: settings)
      world.params = params
      let w = world
      weather = StubWorldWeather(t: { [unowned w] in w.time.t })
      ocean = StubWorldOcean(t: { [unowned w] in w.time.t }, heli: { [unowned w] in w.heliPosition }, frame: { [unowned w] in w.time.frame })
      hazards = hazardCentre.map { StubWorldHazards(cx: $0[0], cz: $0[1]) }
      world.ocean = ocean
      world.weather = weather
      events.on(.worldFoghorn) { [unowned self] e in
        if case .worldFoghorn(let p) = e { self.foghorns.append((self.frame, p.x, p.z)) }
      }
    }

    static let C_DAY = (ambient: Color3(style: "#9FB4C4"), sun: Color3(style: "#FFF1DA"), foam: Color3(style: "#F1F4EE"))
    static let C_NIGHT = (ambient: Color3(style: "#1C2836"), sun: Color3(style: "#7E8FB0"), foam: Color3(style: "#9AA6B0"))

    /// One inputs row (export-world.mjs inputFields).
    func apply(_ r: ArraySlice<Double>) {
      let a = Array(r)
      // dt, 16 weather fields, paletteColours, cam (6), heli flag + xyz, hazards, 3 action codes
      let night = a[1], fog = a[2], rain = a[3], intensity = a[4], visibility = a[5], windSpeed = a[6], wdx = a[7], wdz = a[8]
      let flash = a[9], Hs = a[10], waveHeight = a[11], shadowIntensity = a[12], ambientIntensity = a[13], sunIntensity = a[14]
      let fogNear = a[15], fogFar = a[16]
      var pal = WorldPaletteReadout(seaHs: Hs, shadowIntensity: shadowIntensity, ambientIntensity: ambientIntensity, sunIntensity: sunIntensity)
      if a[17] != 0 {
        var am = Harness.C_DAY.ambient, su = Harness.C_DAY.sun, fo = Harness.C_DAY.foam
        am.lerp(Harness.C_NIGHT.ambient, night)
        su.lerp(Harness.C_NIGHT.sun, night)
        fo.lerp(Harness.C_NIGHT.foam, night)
        pal.ambient = am
        pal.sun = su
        pal.foam = fo
      }
      weather.state = WorldWeatherState(night: night, rain: rain, intensity: intensity, visibility: visibility, fog: fog, windDir: V2(wdx, wdz),
                                        windSpeed: windSpeed, flash: flash, waveHeight: waveHeight, palette: pal, fogNear: fogNear, fogFar: fogFar)
      world.camera = WorldCameraInput(position: V3(a[18], a[19], a[20]), direction: V3(a[21], a[22], a[23]).normalized())
      world.heliPosition = a[24] != 0 ? V3(a[25], a[26], a[27]) : nil
      world.hazards = a[28] != 0 ? hazards : nil
      // actions
      if a[29] != 0 { settings.values["reduceFlashes"] = .bool(a[29] == 2) }
      if a[30] != 0 {
        settings.values["quality"] = .string(["high", "medium", "low"][Int(a[30]) - 1])
        world.settingsChanged("quality")
      }
      if a[31] != 0 {
        let code = Int(a[31])
        let kind = code % 10, padRaw = code / 10 - 1
        let pad: PadID? = padRaw >= 0 ? PadID(padRaw) : nil
        switch kind {
        case 1: events.emit(GameEvent.HeliLand(pad: pad, autorotation: false, vy: 0))
        case 2: events.emit(GameEvent.HeliTakeoff(pad: pad))
        case 3: events.emit(GameEvent.HeliUnloadPerson(pad: pad, person: PersonID(0), left: 0))
        case 4: events.emit(GameEvent.HeliUnload(pad: pad, count: 0, people: []))
        default: break
        }
      }
    }

    /// The frame row (export-world.mjs frameRow).
    func row() -> [Double] {
      let w = world, e = w.env, S = w.shared
      var r: [Double] = [e.t, e.dt, e.night, e.fogK, e.haze, e.rain, e.intensity, e.visibility, e.Hs, e.flash, e.lightsOn, e.reduceFlashes ? 1 : 0,
                         e.wind.x, e.wind.y, e.windDir.x, e.windDir.y, e.current.x, e.current.y, e.focus.x, e.focus.y,
                         e.camPos.x, e.camPos.y, e.camPos.z, e.heliPos.x, e.heliPos.y, e.heliPos.z]
      r += w.channels.map { Double($0) }
      r += [S.uRim.r, S.uRim.g, S.uRim.b, S.uCloudK, S.uFoamCol.r, S.uFoamCol.g, S.uFoamCol.b, S.uScatter, S.uNightK, S.uFogNear, S.uFogFar,
            S.uLampK.x, S.uLampK.y, S.uLampK.z]
      let lh = w.lighthouse
      r += [lh?.angle ?? 0, lh.map { $0.on ?? 0 } ?? 0, lh?.fogT ?? 0, w.beam.uIntensity, w.beam.uDensity, w.beam.uPen, w.beam.uFall,
            w.flood.uIntensity, w.flood.uFall, w.flood.uPen]
      for i in 0..<6 {
        if let g = lh?.glows[i] { r += [g.position.x, g.position.y, g.position.z, g.position.w, g.color.r, g.color.g, g.color.b] } else { r += [0, 0, 0, 0, 0, 0, 0] }
      }
      let TU = w.terrainUniforms
      r += [TU.uSwell, TU.uTFill.r, TU.uTFill.g, TU.uTFill.b]
      for g in TU.glows { r += [g.position.x, g.position.y, g.position.z, g.position.w, g.color.r, g.color.g, g.color.b] }
      let L = w.lights
      r += [L.spotPosition.x, L.spotPosition.y, L.spotPosition.z, L.spotTarget.x, L.spotTarget.y, L.spotTarget.z, L.spotIntensity,
            L.pointPosition.x, L.pointPosition.y, L.pointPosition.z, L.pointIntensity]
      let unloadPad: Double = w.unloadPad.map { Double($0.raw) } ?? -1
      let sock: Windsock? = lh?.windsock
      r += [unloadPad, w.unloadT, Double(w.collars.n), Double(w.rigging.n)]
      r += [sock?.ext ?? 0, sock?.dir.x ?? 0, sock?.dir.y ?? 0, w.shoalT]
      if let lh = lh {
        let veg = lh.land.vegetation
        r += [Double(lh.land.boulders.count), Double(veg.spruce.count), Double(veg.shrub.count), Double(veg.tuft.count)]
      } else {
        r += [-1, -1, -1, -1]
      }
      var rockBoulders: Double = -1
      if let rf = w.rockField {
        var n = 0
        for rk in rf.rocks { n += rk.boulders?.count ?? 0 }
        rockBoulders = Double(n)
      }
      r += [rockBoulders, Double(w.floaterField.frame)]
      return r
    }

    /// The bulk rows (export-world.mjs bulkRow).
    func bulk(lamps: [Int]) -> (f64: [Double], f32: [Float]) {
      let w = world
      var f64 = [Double]()
      for it in w.floaterField.items { f64 += [it.x, it.z, it.yaw, it.h, it.nx, it.ny, it.nz, it.washT ?? -1] }
      let C = w.collars, R = w.rigging
      var f32: [Float] = [Float(C.n), Float(R.n)]
      for i in 0..<C.n {
        f32 += C.matrices[(i * 16)..<(i * 16 + 16)]
        f32 += C.data[(i * 4)..<(i * 4 + 4)]
      }
      for i in 0..<R.n {
        f32 += R.matrices[(i * 16)..<(i * 16 + 16)]
        f32 += R.colors[(i * 3)..<(i * 3 + 3)]
      }
      for it in w.floaterField.items {
        guard let b = w.floaterField.banks.first(where: { $0.shape == it.shape }) else { continue }
        f32 += b.matrices[(it.idx * 16)..<(it.idx * 16 + 16)]
      }
      for i in lamps {
        if i >= 0 { f32 += w.lamps.iPos[(i * 3)..<(i * 3 + 3)] } else { f32 += [0, 0, 0] }
      }
      return (f64, f32)
    }
  }

  // ---- setup ---------------------------------------------------------------------------------------------

  func testSetupHigh() throws { try checkSetup("high") }
  func testSetupMedium() throws { try checkSetup("medium") }
  func testSetupLow() throws { try checkSetup("low") }

  func checkSetup(_ q: String) throws {
    let v = try VectorLoader.load("world/setup_first_\(q)")
    let d = v.data
    let H = try Harness(quality: q)
    // the exporter's setup ctx: empty weather state (windDir (1, 0), speed 0, palette {}), scene.fog (200, 900),
    // camera (0, 220, 60) looking along normalize(0, −0.965, −0.26), no heli
    H.weather.state = WorldWeatherState(windDir: V2(1, 0), windSpeed: 0, palette: WorldPaletteReadout(), fogNear: 200, fogFar: 900)
    H.world.camera = WorldCameraInput(position: V3(0, 220, 60), direction: V3(0, -0.965, -0.26).normalized())
    H.world.start()
    H.events.emit(GameEvent.MissionSetup(def: d["def"]))
    try compareSetup(H, d, v, "setup \(q)")
  }

  func compareSetup(_ H: Harness, _ d: JSONValue, _ v: VectorFile, _ label: String) throws {
    let w = H.world
    func v3(_ x: JSONValue) -> [Double] { x.doubles ?? [] }
    // pads
    let pads = d["pads"].array ?? []
    XCTAssertEqual(w.pads.count, pads.count, "\(label) pads")
    for (p, e) in zip(w.pads, pads) {
      XCTAssertEqual(p.id.raw, e["id"].int, "\(label) pad id")
      XCTAssertEqual(p.name, e["name"].string, "\(label) pad name")
      XCTAssertEqual(p.type, e["type"].string, "\(label) pad type")
      let padNums: [Double] = [p.position.x, p.position.y, p.position.z, p.radius, p.height, p.tilt, p.pitch, p.roll, p.heading]
      var wantNums: [Double] = v3(e["position"])
      for k in ["radius", "height", "tilt", "pitch", "roll", "heading"] { wantNums.append(e[k].double ?? .nan) }
      assertBitEqual(padNums, wantNums, "\(label) pad numbers")
      assertBitEqual([p.up.x, p.up.y, p.up.z, p.velocity.x, p.velocity.y, p.velocity.z], v3(e["up"]) + v3(e["velocity"]), "\(label) pad up / velocity")
      XCTAssertEqual(p.refuel, e["refuel"].bool, "\(label) pad refuel")
      XCTAssertEqual(p.lee, e["lee"].bool, "\(label) pad lee")
      XCTAssertEqual(p.place, e["place"].int, "\(label) pad place")
      let s = e["services"]
      XCTAssertEqual([p.services.fuel, p.services.repair], [s["fuel"].double ?? .nan, s["repair"].double ?? .nan], "\(label) services")
      XCTAssertEqual(p.services.resupply, s["resupply"].bool, "\(label) resupply")
    }
    // obstacles
    let obs = d["obstacles"].array ?? []
    XCTAssertEqual(w.obstacles.count, obs.count, "\(label) obstacles")
    assertBitEqual(w.obstacles.flatMap { [$0.x, $0.z, $0.radius, $0.top] },
                   try obs.flatMap { o in try ["x", "z", "radius", "top"].map { try o[$0].num($0) } }, "\(label) obstacle cylinders")
    XCTAssertEqual(w.obstacles.map { $0.kind + "/" + $0.name }, obs.map { ($0["kind"].string ?? "") + "/" + ($0["name"].string ?? "") }, "\(label) obstacle kinds")
    // places
    let places = d["places"].array ?? []
    XCTAssertEqual(w.places.count, places.count, "\(label) places")
    if let lh = w.lighthouse, let e = places.first {
      XCTAssertEqual(lh.name, e["name"].string)
      assertBitEqual([lh.x, lh.z, lh.padRadius, lh.angle, lh.fogT], [try e["x"].num(""), try e["z"].num(""), try e["padRadius"].num(""), try e["angle"].num(""),
                                                                     try e["fogT"].num("")], "\(label) lighthouse")
      assertBitEqual([lh.padPosition.x, lh.padPosition.y, lh.padPosition.z, lh.lantern.x, lh.lantern.y, lh.lantern.z, lh.hoop.x, lh.hoop.y, lh.hoop.z],
                     v3(e["padPosition"]) + v3(e["lantern"]) + v3(e["hoop"]), "\(label) pad / lantern / hoop")
      assertBitEqual([lh.island.x, lh.island.z, lh.island.radius, lh.island.top], try ["x", "z", "radius", "top"].map { try e["island"][$0].num($0) },
                     "\(label) island disc")
      assertBitEqual([lh.doorLamp.x, lh.doorLamp.y, lh.doorLamp.z, lh.porchLamp.x, lh.porchLamp.y, lh.porchLamp.z], v3(e["doorLamp"]) + v3(e["porchLamp"]),
                     "\(label) door / porch lamps")
      assertBitEqual(lh.walkLamps.flatMap { [$0.x, $0.y, $0.z] }, (e["walkLamps"].array ?? []).flatMap { v3($0) }, "\(label) walkway lamps")
      assertBitEqual([lh.jettyHead.x, lh.jettyHead.y], v3(e["jettyHead"]), "\(label) jetty head")
      assertBitEqual(lh.piles.flatMap { [$0.x, $0.y] }, (e["piles"].array ?? []).flatMap { v3($0) }, "\(label) piles")
      assertBitEqual((lh.shoals ?? []).flatMap { [$0.x, $0.z, $0.radius] }, (e["shoals"].array ?? []).flatMap { v3($0) }, "\(label) island shoals")
      XCTAssertEqual(lh.unloadLamps, (e["unloadLamps"].array ?? []).compactMap { $0.int }, "\(label) unload lamps")
      XCTAssertEqual(lh.lanternLamp, e["lanternLamp"].int, "\(label) lantern lamp")
      XCTAssertEqual(lh.land.buildQuality, e["buildQuality"].string, "\(label) build quality")
      XCTAssertEqual(lh.land.boulders.full, e["boulders"].int, "\(label) island boulders")
      assertFloats(lh.land.boulders.matrices, try e["boulderMatrices"].nums(""), "\(label) island boulder matrices")
      for k in VegetationScatter.Kind.allCases {
        let ve = e["veg"][k.rawValue], got = lh.land.vegetation.instances(k)
        XCTAssertEqual([got.full, got.count], [ve["full"].int ?? -1, ve["count"].int ?? -1], "\(label) veg \(k)")
        XCTAssertEqual(got.visible, ve["visible"].bool, "\(label) veg \(k) visible")
      }
      XCTAssertEqual(lh.land.obstacles.count, e["landObstacles"].int, "\(label) land columns")
    } else {
      XCTAssertTrue(places.isEmpty, "\(label): no lighthouse built")
    }
    XCTAssertEqual(w.lighthouse.flatMap { lh in w.places.firstIndex { $0 === lh } } ?? -1, d["lighthouse"].int, "\(label) lighthouse index")
    // all shoals
    assertBitEqual(w.shoals.flatMap { [$0.x, $0.z, $0.radius] }, (d["shoals"].array ?? []).flatMap { v3($0) }, "\(label) world shoals")
    // lamps
    let L = d["lamps"], n = w.lamps.count
    XCTAssertEqual(n, L["count"].int, "\(label) lamp count")
    assertFloats(Array(w.lamps.iPos.prefix(n * 3)), try L["iPos"].nums(""), "\(label) lamp iPos")
    assertFloats(Array(w.lamps.iCol.prefix(n * 4)), try L["iCol"].nums(""), "\(label) lamp iCol")
    assertFloats(Array(w.lamps.iSz.prefix(n * 4)), try L["iSz"].nums(""), "\(label) lamp iSz")
    // floaters
    let items = d["items"].array ?? []
    let F = w.floaterField
    XCTAssertEqual(F.items.count, items.count, "\(label) floater items")
    for (i, (it, e)) in zip(F.items, items).enumerated() {
      XCTAssertEqual(it.shape, e["shape"].string, "\(label) item \(i) shape")
      assertBitEqual([it.x, it.z, it.yaw, it.yawRate, it.roll, it.pitch, it.tilt, it.h, it.nx, it.ny, it.nz, it.phase, it.R, it.leeway],
                     try ["x", "z", "yaw", "yawRate", "roll", "pitch", "tilt", "h", "nx", "ny", "nz", "phase", "R", "leeway"].map { try e[$0].num($0) },
                     "\(label) item \(i) numbers")
      XCTAssertEqual(it.color, e["color"].string, "\(label) item \(i) color")
      XCTAssertEqual([it.idx, it.light, it.every], [e["idx"].int ?? -9, e["light"].int ?? -9, e["every"].int ?? -9], "\(label) item \(i) idx / light / every")
      XCTAssertEqual(it.moored.map { [$0.x, $0.y] }, e["moored"].doubles, "\(label) item \(i) moored")
      XCTAssertEqual(it.kind, e["kind"].string, "\(label) item \(i) kind")
      XCTAssertEqual(it.sink, e["sink"].double, "\(label) item \(i) sink")
      XCTAssertEqual(it.long, e["long"].double, "\(label) item \(i) long")
      XCTAssertEqual(it.chain, e["chain"].bool ?? false, "\(label) item \(i) chain")
    }
    let banks = d["banks"].object?.entries ?? []
    XCTAssertEqual(F.banks.map { $0.shape }, banks.map { $0.key }, "\(label) bank order")
    for (b, (k, e)) in zip(F.banks, banks) {
      XCTAssertEqual([b.n, b.max], [e["n"].int ?? -1, e["max"].int ?? -1], "\(label) bank \(k)")
      XCTAssertEqual(b.visible, e["visible"].bool, "\(label) bank \(k) visible")
      if let c = e["colors"].doubles { assertFloats(Array(b.colors.prefix(b.n * 3)), c, "\(label) bank \(k) colours") }
    }
    XCTAssertEqual(F.buoys, (d["buoys"].array ?? []).compactMap { $0.int }, "\(label) buoys")
    XCTAssertEqual(F.duckSource.map { [$0.x, $0.y] }, d["duckSource"].doubles, "\(label) duck source")
    // rocks
    let rocks = d["rocks"].array ?? []
    XCTAssertEqual(w.rockField?.rocks.count ?? 0, rocks.count, "\(label) rocks")
    for (i, (rk, e)) in zip(w.rockField?.rocks ?? [], rocks).enumerated() {
      XCTAssertEqual([rk.boulders?.full ?? 0, rk.boulders?.count ?? 0], [e["boulders"].int ?? -1, e["count"].int ?? -1], "\(label) rock \(i) boulders")
      assertFloats(rk.boulders?.matrices ?? [], try e["matrices"].nums(""), "\(label) rock \(i) boulder matrices")
    }
    assertBitEqual(w.haloBase ?? .nan, d["haloBase"].double ?? .nan, "\(label) haloBase")
    XCTAssertEqual(w.quality, d["quality"].string, "\(label) quality")
    if let c = d["current"].object {
      XCTAssertEqual(w.current.map { [$0.x, $0.y] }, [c["x"]?.double ?? 0, c["z"]?.double ?? 0], "\(label) current")
    }
    // terrain for the coast map, and the coast map the ocean bakes from it (ocean/coast.js on the web side)
    let T = d["terrain"]
    let verts = w.terrainVertices()
    XCTAssertEqual(w.terrainMeshes.count, T["meshes"].int, "\(label) terrain meshes")
    XCTAssertEqual(verts.count, T["vertices"].int, "\(label) terrain vertices")
    XCTAssertEqual(Bytes.sha(verts.flatMap { [$0.x, $0.y, $0.z] }), T["sha"].string, "\(label) terrain vertex sha")
    XCTAssertEqual(H.ocean.terrainVertices.count, verts.count, "\(label) vertices handed to the ocean")
    if d["coast"].exists {
      let C = d["coast"]
      guard let coast = CoastMap.bake(worldVertices: verts) else { return XCTFail("\(label): no coast map") }
      XCTAssertEqual([coast.w, coast.h], [C["w"].int ?? -1, C["h"].int ?? -1], "\(label) coast size")
      assertBitEqual([coast.x0, coast.z0, coast.cell], [try C["x0"].num(""), try C["z0"].num(""), try C["cell"].num("")], "\(label) coast window")
      XCTAssertEqual(SHA256.hex(coast.data), C["sha"].string, "\(label) coast data")
      let xs = try C["x"].nums(""), zs = try C["z"].nums("")
      assertBitEqual(xs.indices.map { coast.distance(xs[$0], zs[$0]) }, try C["d"].nums(""), "\(label) coastDistance")
    }
    // the setShoals call made by the setup (frame 0)
    let logged = (d["setupLog"].array ?? []).filter { $0[0].string == "shoals" }
    let calls = H.ocean.shoalCalls.filter { $0.frame == 0 }
    XCTAssertEqual(calls.count, logged.count, "\(label) setShoals calls")
    for (c, e) in zip(calls, logged) {
      assertBitEqual(c.list.flatMap { [$0.x, $0.z, $0.radius] }, (e[2].array ?? []).flatMap { v3($0) }, "\(label) shoal selection")
    }
  }

  // ---- time-stepped runs -------------------------------------------------------------------------------

  func testRunFirst() throws { try checkRun("world/run_first") }
  func testRunMix() throws { try checkRun("world/run_mix") }

  func checkRun(_ name: String) throws {
    let v = try VectorLoader.load(name)
    let d = v.data
    let S = d["setup"]
    let params = Set((S["params"].string ?? "").split(separator: "&").map(String.init).filter { !$0.isEmpty })
    let H = try Harness(quality: S["quality"].string ?? "high", detail: S["detail"].double ?? 1, params: params, hazardCentre: S["hazardCentre"].doubles)
    H.ocean.amp = S["oceanAmp"].double ?? 1
    let inputs = try v.sidecarF64(d["inputs"])
    let IL = d["inputLength"].int ?? 0
    let frames = d["frames"].int ?? 0
    XCTAssertEqual(inputs.count, frames * IL, "\(name) inputs")
    // frame 0: the setup
    H.apply(try d["inputs0"].nums("inputs0")[0...])
    H.world.start()
    H.events.emit(GameEvent.MissionSetup(def: S["def"]))
    try compareSetup(H, d["setupRecord"], v, "\(name) setup")
    let lamps = H.world.floaterField.buoys.map { H.world.floaterField.items[$0].light }
    let hashes = try v.sidecarU32(d["hashes"])
    let rows = try v.sidecarF64(d["rows"])
    let RL = d["rowLength"].int ?? 0
    let every = d["every"].int ?? 1
    let fields = d["rowFields"].strings ?? []
    var h = FNV.offset
    var t = 0.0
    for frame in 1...frames {
      let r = inputs[((frame - 1) * IL)..<(frame * IL)]
      let dt = r[r.startIndex]
      t += dt
      H.frame = frame
      H.world.time.t = t
      H.world.time.dt = dt
      H.world.time.frame = frame
      H.apply(r)
      H.world.update(dt)
      let row = H.row()
      let bk = H.bulk(lamps: lamps)
      XCTAssertEqual(row.count, RL, "\(name) row length")
      h = FNV.mix(FNV.mix(FNV.mix(h, row), bk.f64), bk.f32.map { Double($0) })
      if h != hashes[frame - 1] {
        // locate: the first stored row at or after this frame
        let k = (frame + every - 1) / every
        var report = "frame \(frame): hash differs"
        if k * every <= frames, k >= 1 {
          // advance to the stored frame first when it lies ahead
          var f = frame
          var rr = row
          while f < k * every {
            f += 1
            let ri = inputs[((f - 1) * IL)..<(f * IL)]
            t += ri[ri.startIndex]
            H.world.time.t = t
            H.world.time.dt = ri[ri.startIndex]
            H.world.time.frame = f
            H.frame = f
            H.apply(ri)
            H.world.update(ri[ri.startIndex])
            rr = H.row()
          }
          let want = Array(rows[((k - 1) * RL)..<(k * RL)])
          let bad = rr.indices.filter { !Bits.equal(rr[$0], want[$0]) }.prefix(6)
          report += "; at stored frame \(k * every) fields " + bad.map { "\(fields[$0]) got \(rr[$0]) want \(want[$0])" }.joined(separator: ", ")
          if bad.isEmpty { report += "; the row matches → the bulk arrays (collars / rigging / floaters / lamps) differ" }
        }
        XCTFail("\(name): \(report)")
        return
      }
      if frame % every == 0 {
        let k = frame / every
        let want = Array(rows[((k - 1) * RL)..<(k * RL)])
        if zip(row, want).contains(where: { !Bits.equal($0, $1) }) { XCTFail("\(name): row \(frame) differs while the hash matches") }
      }
    }
    // events and ocean calls
    let ev = d["events"].array ?? []
    XCTAssertEqual(H.foghorns.count, ev.count, "\(name) foghorns")
    for (a, e) in zip(H.foghorns, ev) {
      XCTAssertEqual(a.0, e[0].int, "\(name) foghorn frame")
      assertBitEqual([a.1, a.2], [e[2].double ?? .nan, e[3].double ?? .nan], "\(name) foghorn position")
    }
    let log = d["oceanLog"].array ?? []
    let stamps = log.filter { $0[0].string == "stamp" }
    XCTAssertEqual(H.ocean.stamps.count, stamps.count, "\(name) stamps")
    for (a, e) in zip(H.ocean.stamps, stamps) {
      XCTAssertEqual(a.frame, e[1].int, "\(name) stamp frame")
      assertBitEqual([a.x, a.z, a.radius, a.strength], [e[3].double ?? .nan, e[4].double ?? .nan, e[5].double ?? .nan, e[6].double ?? .nan], "\(name) stamp")
    }
    let shoals = log.filter { $0[0].string == "shoals" }
    let calls = H.ocean.shoalCalls.filter { $0.frame > 0 }
    XCTAssertEqual(calls.count, shoals.count, "\(name) setShoals calls")
    for (a, e) in zip(calls, shoals) {
      XCTAssertEqual(a.frame, e[1].int, "\(name) setShoals frame")
      assertBitEqual(a.list.flatMap { [$0.x, $0.z, $0.radius] }, (e[2].array ?? []).flatMap { $0.doubles ?? [] }, "\(name) setShoals list")
    }
    XCTAssertGreaterThan(frames, 500, "\(name) frames")
  }

  // ---- rhythms --------------------------------------------------------------------------------------------

  func testBuoyRhythms() throws {
    let v = try VectorLoader.load("world/rhythms")
    let t = try v.data["t"].nums("t")
    let kinds = v.data["kinds"].strings ?? []
    XCTAssertEqual(kinds.count, 7)
    for (k, kind) in kinds.enumerated() {
      assertBitEqual(t.map { buoyRhythm(kind, $0, false) }, try v.data["normal"][k].nums("normal"), "\(kind) normal")
      assertBitEqual(t.map { buoyRhythm(kind, $0, true) }, try v.data["reduced"][k].nums("reduced"), "\(kind) reduced")
    }
  }

  /// The heli / camera view of the world (SimContext.world).
  func testQueryAdapter() throws {
    let v = try VectorLoader.load("world/setup_first_medium")
    let H = try Harness(quality: "medium")
    H.events.emit(GameEvent.MissionSetup(def: v.data["def"]))
    let q: WorldQuery = H.world.query
    XCTAssertEqual(q.pads.count, 1)
    let p = try XCTUnwrap(q.padAt(1, 1))
    XCTAssertEqual(p.type, "lighthouse")
    XCTAssertEqual(p.position, V3(0, 12, 0))
    XCTAssertEqual(p.velocity, V3(0, 0, 0))
    XCTAssertEqual(p.up, V3(0, 1, 0))
    XCTAssertEqual(p.services, PadServices(fuel: 10, repair: 4, resupply: true))
    XCTAssertNil(q.padAt(40, 40))
    XCTAssertEqual(q.nearestPad(300, -300)?.id, PadID(0))
    XCTAssertEqual(q.obstacles.count, H.world.obstacles.count)
    XCTAssertEqual(q.deckAt(0, 0), -.infinity)
    XCTAssertEqual(q.floaters.count, H.world.floaterField.items.count)
    XCTAssertEqual(q.floaters.filter { $0.moored }.count, 2, "the two op1 buoys never snag")
    XCTAssertEqual(q.lighthouse, V2(0, 0))
  }
}
