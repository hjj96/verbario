// Replays the ocean runs exported by tools/export/export-sim.mjs (ocean()) on the Swift OceanSim (with
// the Swift WeatherSim in front of it when the run has weather): same stub context, per-frame time,
// scripted heli / camera, pre-update and post-update actions, lateUpload, and the same probe row and
// running FNV-1a hash (uniforms in createOceanUniforms order, then the internal state, then the pools).
import XCTest
@testable import MaydayCore

enum OceanFixtures {
  private static var cached: OceanSimTables?
  private static let lock = NSLock()

  static func tables() throws -> OceanSimTables {
    lock.lock()
    defer { lock.unlock() }
    if let t = cached { return t }
    let t = try OceanSimTables(catalog: try VectorLoader.catalog())
    cached = t
    return t
  }
}

final class OceanRun {
  let name: String
  let v: VectorFile
  let events: EventBus
  let settings: GameSettings
  let look: Look
  let weather: WeatherSim?
  let ocean: OceanSim
  private(set) var frame = -1
  private(set) var log: [JSONValue] = []
  private(set) var queries: [JSONValue] = []
  private(set) var firstFrame: (probe: [Double], extras: [[Double]])?
  private var pre: [Int: [JSONValue]] = [:]
  private var post: [Int: [JSONValue]] = [:]
  private let heliK: [String: Double]
  private let rpm: Double?
  private let deadFrom: Int?
  private let paused: (Int, Int)?
  /// renderer stub counters (export-sim.mjs makeRun): target clears, this frame's stamps
  private var clears = 0
  private var stampCount = 0
  private var stampLast: [Double] = []

  init(_ name: String) throws {
    self.name = name
    v = try VectorLoader.load("ocean/\(name)")
    let setup = v.data["setup"]
    events = EventBus()
    settings = GameSettings(storage: MemoryStorage())
    for (k, val) in setup["settings"].object?.entries ?? [] { settings.set(k, val) }
    look = try WeatherFixtures.freshLook()
    if setup["weather"].jsTruthy {
      weather = WeatherSim(tables: try WeatherFixtures.tables(), events: events, settings: settings, look: look,
                           noise: SimplexNoise2D(seed: 1337), mode: .play)
    } else {
      weather = nil
    }
    ocean = OceanSim(tables: try OceanFixtures.tables(), events: events, settings: settings, look: look)
    ocean.weather = weather
    ocean.memorySupported = setup["memory"].jsTruthy
    var k = [String: Double]()
    for (key, val) in setup["heli"].object?.entries ?? [] { k[key] = val.double }
    heliK = k
    rpm = setup["rpm"].double
    deadFrom = setup["deadFrom"].int
    if let p = setup["paused"].doubles, p.count == 2 { paused = (Int(p[0]), Int(p[1])) } else { paused = nil }
    for a in v.data["actions"].array ?? [] {
      let f = a["frame"].int ?? -2
      if a["phase"].string == "post" { post[f, default: []].append(a) } else { pre[f, default: []].append(a) }
    }
    events.onEmit = { [unowned self] e in
      if e.name.rawValue.hasPrefix("weather:") { self.log.append(.array([.number(Double(self.frame)), .string(e.name.rawValue)])) }
    }
  }

  deinit { events.onEmit = nil }

  private func place(_ f: Int) {
    let t = Double(f) / 60
    func c(_ key: String) -> Double { heliK[key] ?? .nan }
    let p = V3(c("x0") + c("ax") * JS.sin(t * c("wx")), c("y0") + c("ay") * JS.sin(t * c("wy")), c("z0") + c("az") * JS.sin(t * c("wz")))
    let alive = !(deadFrom.map { f >= $0 } ?? false)
    let cam = OceanCameraInput(position: V3(p.x + 0, p.y + 55, p.z + 35), direction: V3(0, -0.8, -0.6))
    ocean.heli = OceanHeliInput(position: p, altitude: p.y, alive: alive, rotorRPM: rpm)
    ocean.camera = cam
    weather?.heli = WeatherHeliInput(position: p, altitude: p.y)
    weather?.camera = cam
  }

  /// The web's FeatureSet.set(id, f) argument as FeatureSpec: rogue origin = f.origin || f.position ||
  /// {x: f.x ?? 0, y: f.z ?? 0} with z = o.z ?? o.y ?? 0 (plain objects); others x = f.x ?? f.position?.x;
  /// dir = f.dir (plain {x, y}: dirZ = y).
  static func featureSpec(_ f: JSONValue) -> FeatureSpec {
    let type = f["type"].string ?? ""
    var x = f["x"].double, z = f["z"].double
    if type == "rogue" {
      let o: JSONValue? = f["origin"].jsTruthy ? f["origin"] : f["position"].jsTruthy ? f["position"] : nil
      if let o {
        x = o["x"].double
        z = o["z"].double ?? o["y"].double ?? 0
      }
    } else {
      x = x ?? f["position"]["x"].double
      z = z ?? f["position"]["z"].double
    }
    return FeatureSpec(type: type, x: x, z: z, dirX: f["dir"]["x"].double, dirZ: f["dir"]["y"].double, width: f["width"].double,
                       length: f["length"].double, speed: f["speed"].double, height: f["height"].double, strength: f["strength"].double,
                       radius: f["radius"].double, spin: f["spin"].double)
  }

  private static func v3(_ a: JSONValue) -> V3? {
    guard let d = a.doubles, d.count == 3 else { return nil }
    return V3(d[0], d[1], d[2])
  }

  private func act(_ a: JSONValue) throws {
    let op = a["op"].string ?? ""
    let d = { (k: String) in a[k].double }
    switch op {
    case "mode":
      let from = weather?.mode ?? .play
      let to = MaydayCore.GameMode(rawValue: a["to"].string ?? "") ?? .play
      weather?.mode = to
      events.emit(GameEvent.GameMode(from: from, to: to))
    case "setup": events.emit(GameEvent.MissionSetup(def: a["def"]))
    case "start": events.emit(GameEvent.MissionStart(def: .null))
    case "strike":
      let o = a["opts"]
      weather?.strikeLightning(d("x") ?? .nan, d("z") ?? .nan, WeatherSim.StrikeOptions(cloudOnly: o["cloudOnly"].jsTruthy))
    case "setting": settings.set(a["key"].string ?? "", a["value"])
    case "splash": ocean.splash(d("x") ?? .nan, d("z") ?? .nan, d("radius") ?? 2, d("strength") ?? 1)
    case "stamp":
      let o = a["opts"]
      ocean.stamp(a["kind"].string ?? "", d("x") ?? .nan, d("z") ?? .nan, radius: o["radius"].double, strength: o["strength"].double,
                  inner: o["inner"].double, dirX: o["dirX"].double, dirZ: o["dirZ"].double)
    case "wake": ocean.addWake(d("x") ?? .nan, d("z") ?? .nan, d("strength") ?? 1, d("dirX"), d("dirZ"))
    case "downwash": ocean.setDownwash(d("x") ?? .nan, d("z") ?? .nan, d("radius") ?? .nan, d("strength") ?? .nan)
    case "searchlight": ocean.setSearchlight(OceanRun.v3(a["pos"]), OceanRun.v3(a["dir"]), d("cosOuter"), d("intensity"))
    case "glint":
      let c = a["color"].doubles.map { PaletteColor($0[0], $0[1], $0[2]) }
      ocean.addGlint(d("x") ?? .nan, d("z") ?? .nan, d("radius") ?? .nan, d("intensity") ?? .nan, c)
    case "feature":
      ocean.setFeature(a["id"].string ?? "", OceanRun.featureSpec(a["f"]))
    case "unfeature": ocean.removeFeature(a["id"].string ?? "")
    case "shoals":
      ocean.setShoals((a["list"].array ?? []).map {
        ShoalSpec(x: $0["x"].double, z: $0["z"].double, radius: $0["radius"].double, r: $0["r"].double)
      })
    case "terrain":
      let p = try a["_vertices"].doublesOrFail("terrain vertices")
      var verts = [V3]()
      for i in stride(from: 0, to: p.count - 2, by: 3) { verts.append(V3(p[i], p[i + 1], p[i + 2])) }
      ocean.setTerrain(key: "terrain@\(frame)", vertices: verts)
    case "snapWaves": ocean.snapWaves()
    case "bio": ocean.bioluminescence = d("v") ?? .nan
    case "query":
      let pts = (a["points"].array ?? []).map { (x: $0[0].double ?? .nan, z: $0[1].double ?? .nan) }
      let tOff = d("tOff") ?? 0
      var o = JSONObject()
      o.set("height", .array(pts.map { jsNum(ocean.heightAt($0.x, $0.z, tOffset: tOff)) }))
      o.set("normal", .array(pts.map { let n = ocean.normalAt($0.x, $0.z, tOffset: tOff); return .array([jsNum(n.x), jsNum(n.y), jsNum(n.z)]) }))
      o.set("velocity", .array(pts.map { let w = ocean.velocityAt($0.x, $0.z, tOffset: tOff); return .array([jsNum(w.x), jsNum(w.y), jsNum(w.z)]) }))
      o.set("featureHeight", .array(pts.map { jsNum(ocean.featureHeightAt($0.x, $0.z, tOffset: tOff)) }))
      o.set("featureFlow", .array(pts.map { let f = ocean.featureFlowAt($0.x, $0.z); return .array([jsNum(f.x), jsNum(f.y)]) }))
      o.set("searchlight", .array(pts.map { jsNum(ocean.searchlightAt($0.x, $0.z, 0.5)) }))
      queries.append(.array([.number(Double(frame)), .string("query"), .object(o)]))
    default:
      throw VectorError("\(name): unknown ocean action \(op)")
    }
  }

  // ---- the probe (export-sim.mjs ocean FIELDS: uniforms in createOceanUniforms order, then internals) --
  func probe() -> [Double] {
    let o = ocean
    let u = o.uniforms
    @inline(__always) func b(_ x: Bool) -> Double { x ? 1 : 0 }
    func f(_ a: [Float]) -> [Double] { a.map { Double($0) } }
    func c(_ x: PaletteColor) -> [Double] { [x.r, x.g, x.b] }
    func v4(_ x: V4) -> [Double] { [x.x, x.y, x.z, x.w] }
    func v3(_ x: V3) -> [Double] { [x.x, x.y, x.z] }
    var r = [Double]()
    r.reserveCapacity(640)
    func add(_ a: [Double]) { r.append(contentsOf: a) }
    func add(_ a: [Float]) { r.append(contentsOf: f(a)) }
    add(u.uWaveA)
    add(u.uWaveB)
    add([u.uOffset.x, u.uOffset.y, u.uGridStep, u.uHsEff, Double(u.uShoalCount)])
    add(u.uShoals)
    add(v4(u.uCoastWin))
    add([u.uCoastOn, Double(u.uFeatCount)])
    add(u.uFeatA)
    add(u.uFeatB)
    add(u.uFeatC)
    add(v4(u.uDownwash))
    let colors: [PaletteColor] = [u.uDeep, u.uBody, u.uCrest, u.uShallow, u.uFoamCol, u.uSkyCol, u.uFogCol, u.uSunCol, u.uSpecCol, u.uAmbCol,
                                  u.uShadowTint, u.uFlashCol]
    for col in colors { add(c(col)) }
    add(v3(u.uSunDirV))
    let vecs: [V4] = [u.uSeaA, u.uSeaB, u.uSeaC, u.uSeaD, u.uSeaE, u.uJStats, u.uDetOff, u.uDetRot, u.uStreakRot]
    for x in vecs { add(v4(x)) }
    add([u.uStreakMix])
    add(v4(u.uHeliP))
    add(v3(u.uSearchPos))
    add(v4(u.uSearchDir))
    add([u.uSearchI, Double(u.uGlintCount)])
    add(u.uGlints)
    add(u.uGlintCol)
    add([Double(u.uSplashCount)])
    add(u.uSplash)
    add(u.uSplashS)
    add([b(u.memOn)])
    add(v4(u.uMemWin))
    add(v3(u.uSunDirS))
    add([u.uSpotWater])
    add(v4(u.uFront))
    add(v4(u.uFrontB))
    let fronts: [PaletteColor] = [u.uPrevDeep, u.uPrevBody, u.uPrevCrest, u.uPrevFoam, u.uNextDeep, u.uNextBody, u.uNextCrest, u.uNextFoam]
    for col in fronts { add(c(col)) }
    add(v4(u.uPrevSea))
    add(v4(u.uNextSea))
    add(v4(u.uLookK))
    // internals
    let qn = ["high", "medium", "low"]
    add([o.time.t, Double(o.time.frame), o.focus.x, o.focus.y, o.clearing, Double(qn.firstIndex(of: o.quality) ?? -1)])
    add(v4(o.detOff))
    add([o.streakA, o.streakB, o.streakMix])
    add(v3(o.search.pos))
    add(v3(o.search.dir))
    add([o.search.cosOuter, o.search.i, Double(o.search.lastFrame)])
    add([Double(o.splNext), Double(o.glN), o.coastT ?? .nan, b(o.dwCalled), o.windOffSeen.x, o.windOffSeen.y])
    let fs = o.features
    add([Double(fs.count), fs.residual, b(fs.active)])
    add(fs.downwash)
    add([Double(fs.slots.count)])
    let bk = o.bank
    add([b(bk.snap), Double(bk.count), bk.gridStep, bk.baseAngle, bk.offsetX, bk.offsetZ, bk.time])
    let s = bk.stats
    add([s.Hs, s.HsEff, s.Lp, s.K, s.sigma, s.Q, s.crestNorm ?? .nan])
    let bankArrays: [[Double]] = [bk.a, bk.aTarget, bk.b, bk.phase, bk.align, bk.Dx, bk.Dz, bk.phi0]
    for x in bankArrays { add(x) }
    add([Double(bk.shoals.count), b(bk.coast != nil)])
    if let m = o.memory {
      let ad = m.advect
      add([1, Double(m.size), m.center.x, m.center.y, b(m.centerInit), Double(m.count), b(m.needsClear)])
      add([ad.shift.x, ad.shift.y, ad.center.x, ad.center.y, ad.extent, ad.dt, ad.windV.x, ad.windV.y])
      add(v4(ad.decay))
      add([ad.texel.x, ad.texel.y, ad.diffuse])
    } else {
      add([Double](repeating: 0, count: 7 + 15))
    }
    add([Double(stampCount), Double(clears)])
    r += [look.windOffset.x, look.windOffset.y, look.wind.x, look.wind.y]
    return r
  }

  func extras() -> [[Double]] {
    let sp = ocean.splashPool, gl = ocean.glintPool
    func f(_ a: [Float]) -> [Double] { a.map { Double($0) } }
    let m = ocean.memory
    return [f(sp.x), f(sp.z), f(sp.t0), f(sp.r), f(sp.s), f(gl.x), f(gl.z), f(gl.r), f(gl.i), f(gl.c),
            m.map { f($0.aA) } ?? [], m.map { f($0.aB) } ?? [], m.map { f($0.aC) } ?? [], stampLast]
  }

  func run() throws -> (rows: [[Double]], hashes: [UInt32]) {
    let setup = v.data["setup"]
    let frames = try setup["frames"].int.orThrow("frames")
    let every = try v.data["every"].int.orThrow("every")
    let hashEvery = try v.data["hashEvery"].int.orThrow("hashEvery")
    let dt0 = try setup["dt"].doubleOrFail("dt")
    frame = -1
    place(0)
    for a in pre[-1] ?? [] { try act(a) }
    weather?.start()
    ocean.start()
    var rows = [[Double]]()
    var hashes = [UInt32]()
    var h = FNV.offset
    var time = GameTime()
    for f in 0..<frames {
      let dt = paused.map { f >= $0.0 && f < $0.1 } == true ? 0 : dt0
      time.realDt = dt
      time.realT += dt
      time.dt = dt
      time.t += dt
      time.frame += 1
      ocean.time = time
      frame = f
      stampCount = 0
      stampLast = []
      place(f)
      for a in pre[f] ?? [] { try act(a) }
      weather?.update(dt)
      ocean.update(dt)
      // the renderer stub: memory.update ran (dt > 0 with a memory) → clears and drawn stamps
      if dt > 0, let fr = ocean.memory?.frame {
        if fr.clear { clears += 2 }
        if fr.count > 0 {
          stampCount = fr.count
          stampLast = (fr.aA + fr.aB + fr.aC).map { Double($0) }
        }
      }
      for a in post[f] ?? [] { try act(a) }
      ocean.lateUpload()
      let row = probe()
      h = FNV.mix(h, row)
      let ex = extras()
      for e in ex { h = FNV.mix(h, e) }
      if f == 0 { firstFrame = (row, ex) }
      if (f + 1) % hashEvery == 0 { hashes.append(h) }
      if f % every == every - 1 { rows.append(row) }
    }
    return (rows, hashes)
  }
}
