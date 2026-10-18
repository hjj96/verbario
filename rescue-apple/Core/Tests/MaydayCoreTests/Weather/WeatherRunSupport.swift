// Replays the weather runs exported by tools/export/export-sim.mjs (weather()) on the Swift WeatherSim:
// the same stub context (EventBus, settings, Look(7) from the exported textures, createNoise2D(1337),
// the scripted heli and camera), the same per-frame actions, and the same probe row / running FNV-1a
// hash, so a run is compared frame by frame (PLAN §5.1 chaos class: every frame bitwise).
import XCTest
@testable import MaydayCore

/// Shared, read-only test resources (loaded once).
enum WeatherFixtures {
  private static var cachedTables: WeatherTables?
  private static var cachedLook: Look?
  private static let lock = NSLock()

  static func tables() throws -> WeatherTables {
    lock.lock()
    defer { lock.unlock() }
    if let t = cachedTables { return t }
    let t = try WeatherTables(catalog: try VectorLoader.catalog())
    cachedTables = t
    return t
  }

  /// A fresh Look(7) (uniforms zeroed) over the exported textures.
  static func freshLook() throws -> Look {
    lock.lock()
    defer { lock.unlock() }
    let base: Look
    if let l = cachedLook {
      base = l
    } else {
      let catalog = try VectorLoader.catalog()
      base = try Look.load(catalog: catalog, look: try LookData(catalog: catalog))
      cachedLook = base
    }
    return Look(atlas: base.atlas, detail: base.detail, lace: base.lace, detailMaxSlope: base.detailMaxSlope, seed: base.seed,
                constants: base.constants)
  }
}

/// FNV-1a 32 over little-endian doubles, NaN canonicalised (export-sim.mjs fnv()).
enum FNV {
  static let offset: UInt32 = 2_166_136_261

  @inline(__always) static func mix(_ h0: UInt32, _ values: [Double]) -> UInt32 {
    var h = h0
    for v in values {
      let bits = v.isNaN ? Double.nan.bitPattern : v.bitPattern
      for k in 0..<8 {
        h ^= UInt32(truncatingIfNeeded: (bits >> UInt64(8 * k)) & 0xff)
        h = h &* 16_777_619
      }
    }
    return h
  }
}

/// Exported scalar ↔ Swift value comparison (numbers bitwise, strings / bools / null exactly).
func jsonEqual(_ a: JSONValue, _ b: JSONValue) -> Bool {
  if let x = a.double, let y = b.double { return Bits.equal(x, y) }
  switch (a, b) {
  case (.array(let x), .array(let y)):
    return x.count == y.count && zip(x, y).allSatisfy { jsonEqual($0, $1) }
  case (.object(let x), .object(let y)):
    let kx = x.jsKeyOrder, ky = y.jsKeyOrder
    return Set(kx) == Set(ky) && kx.allSatisfy { jsonEqual(x[$0] ?? .null, y[$0] ?? .null) }
  default:
    return a == b
  }
}

/// JSONValue of a number the way the exporter writes it (num(): specials as strings).
func jsNum(_ d: Double) -> JSONValue {
  if d.isNaN { return .string("NaN") }
  if d == .infinity { return .string("Infinity") }
  if d == -.infinity { return .string("-Infinity") }
  if d == 0 && d.sign == .minus { return .string("-0") }
  return .number(d)
}

final class WeatherRun {
  let name: String
  let v: VectorFile
  let sim: WeatherSim
  let events: EventBus
  let settings: GameSettings
  let look: Look
  let names: [String]
  private(set) var frame = -1
  private(set) var log: [JSONValue] = []
  private(set) var bakes: [JSONValue] = []
  private(set) var queries: [JSONValue] = []
  /// State after frame 0 (diagnostics for a hash mismatch).
  private(set) var firstFrame: (probe: [Double], from: [Double], cur: [Double], out: [Double])?
  private let actions: [Int: [JSONValue]]
  private let heliK: [String: Double]?

  init(_ name: String) throws {
    self.name = name
    v = try VectorLoader.load("weather/\(name)")
    let setup = v.data["setup"]
    let tables = try WeatherFixtures.tables()
    names = tables.presetNames
    events = EventBus()
    settings = GameSettings(storage: MemoryStorage())
    for (k, val) in setup["settings"].object?.entries ?? [] { settings.set(k, val) }
    look = try WeatherFixtures.freshLook()
    // ?weather= / ?tod= (URLSearchParams + parseFloat)
    var opts = WeatherSim.Options()
    for pair in (setup["params"].string ?? "").split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
      guard kv.count == 2 else { continue }
      if kv[0] == "weather" { opts.forcedPreset = kv[1] }
      if kv[0] == "tod" { opts.forcedTimeOfDay = JSNumber.parseFloat(kv[1]) }
    }
    let mode = MaydayCore.GameMode(rawValue: setup["mode"].string ?? "play") ?? .play
    sim = WeatherSim(tables: tables, events: events, settings: settings, look: look, noise: SimplexNoise2D(seed: 1337), mode: mode,
                     options: opts)
    sim.obstacles = (setup["obstacles"].array ?? []).map {
      WeatherObstacle(x: $0["x"].double ?? .nan, z: $0["z"].double ?? .nan, top: $0["top"].double)
    }
    var byFrame = [Int: [JSONValue]]()
    for a in v.data["actions"].array ?? [] { byFrame[a["frame"].int ?? -2, default: []].append(a) }
    actions = byFrame
    if let o = setup["heli"].object {
      var k = [String: Double]()
      for (key, val) in o.entries { k[key] = val.double }
      heliK = k
    } else {
      heliK = nil
    }
    events.onEmit = { [unowned self] e in self.record(e) }
  }

  deinit { events.onEmit = nil }

  private func pidx(_ n: String?) -> Double {
    guard let n, let i = names.firstIndex(of: n) else { return -1 }
    return Double(i)
  }

  // ---- events (export-sim.mjs eventRow) ---------------------------------------------------------------
  private func record(_ e: GameEvent) {
    let f = JSONValue.number(Double(frame))
    switch e {
    case .weatherPreset(let p):
      log.append(.array([f, .string("weather:preset"), .string(p.from), .string(p.to), jsNum(p.over), .bool(p.worse), .string(p.label),
                         jsNum(p.windFrom), jsNum(p.gust)]))
    case .weatherGust(let p):
      log.append(.array([f, .string("weather:gust"), jsNum(p.dir.x), jsNum(p.dir.y), jsNum(p.strength), jsNum(p.eta), jsNum(p.x), jsNum(p.z),
                         .bool(p.harmless)]))
    case .weatherCharge(let p):
      log.append(.array([f, .string("weather:charge"), jsNum(p.x), jsNum(p.z), jsNum(p.radius), jsNum(p.eta), .string(p.target), .bool(p.heli)]))
    case .weatherLightning(let p):
      log.append(.array([f, .string("weather:lightning"), jsNum(p.x), jsNum(p.z), jsNum(p.distance), jsNum(p.strength), .bool(p.cloudOnly)]))
    case .weatherPressure(let p):
      log.append(.array([f, .string("weather:pressure"), jsNum(p.pressure), jsNum(p.trend)]))
    default:
      break
    }
  }

  // ---- actions (export-sim.mjs act) -------------------------------------------------------------------
  private func act(_ a: JSONValue) throws {
    let op = a["op"].string ?? ""
    var result: JSONValue?
    switch op {
    case "mode":
      let from = sim.mode
      let to = MaydayCore.GameMode(rawValue: a["to"].string ?? "") ?? .play
      sim.mode = to
      events.emit(GameEvent.GameMode(from: from, to: to))
    case "setup":
      events.emit(GameEvent.MissionSetup(def: a["def"]))
    case "start":
      events.emit(GameEvent.MissionStart(def: .null))
    case "spawnGust":
      let o = a["opts"]
      var so = GustFronts.SpawnOptions()
      if let s = o["strength"].double { so.strength = s }
      if let e = o["eta"].double { so.eta = e }
      if let d = o["dir"].doubles, d.count == 2 { so.dir = V2(d[0], d[1]) }
      so.harmless = o["harmless"].jsTruthy
      sim.spawnGust(so)
    case "strike":
      let o = a["opts"]
      var so = WeatherSim.StrikeOptions()
      so.cloudOnly = o["cloudOnly"].jsTruthy
      if let s = o["strength"].double { so.strength = s }
      so.charge = o["charge"].jsTruthy
      so.eta = o["eta"].double
      if let r = o["radius"].double { so.radius = r }
      if let t = o["target"].string { so.target = t }
      let r = sim.strikeLightning(try a["x"].doubleOrFail("x"), try a["z"].doubleOrFail("z"), so)
      result = r == nil ? .null : .string("charge")
    case "green":
      sim.setGreenTint(try a["v"].doubleOrFail("v"))
    case "hail":
      sim.setHail(try a["v"].doubleOrFail("v"))
    case "preset":
      result = .bool(sim.setPreset(a["name"].string ?? "", over: a["over"].double ?? 30, windFrom: a["windFrom"].double))
    case "endless":
      sim.runEndless()
    case "setting":
      settings.set(a["key"].string ?? "", a["value"])
    case "restore":
      sim.restoreCheckpoint(try a["t"].doubleOrFail("t"), WeatherCheckpoint(json: a["snap"]))
    case "forecast":
      result = .array(sim.forecast().map {
        .array([jsNum($0.in), .string($0.preset), .string($0.label), .string($0.short), jsNum($0.severity), .bool($0.worse), jsNum($0.windFrom)])
      })
    case "checkpoint":
      var o = JSONObject()
      o.set("scriptT", jsNum(sim.scriptT))
      o.set("snap", sim.checkpointState().json)
      result = .object(o)
    case "windAt":
      result = .array((a["points"].array ?? []).map { p in
        let w = sim.windAt(p[0].double ?? .nan, p[1].double ?? .nan)
        return .array([jsNum(w.x), jsNum(w.y)])
      })
    case "cloudShadowAt":
      result = .array((a["points"].array ?? []).map { p in jsNum(sim.cloudShadowAt(p[0].double ?? .nan, p[1].double ?? .nan)) })
    case "detectBase":
      let d = sim.detectBase()
      result = .array([jsNum(d.base), jsNum(d.altBonus)])
    default:
      throw VectorError("\(name): unknown action \(op)")
    }
    if let r = result { queries.append(.array([.number(Double(frame)), .string(op), r])) }
  }

  private func heliInputs(_ f: Int) {
    guard let k = heliK else { return }
    let t = Double(f) / 60
    func c(_ key: String) -> Double { k[key] ?? .nan }
    let p = V3(c("x0") + c("ax") * JS.sin(t * c("wx")), c("y0") + c("ay") * JS.sin(t * c("wy")), c("z0") + c("az") * JS.sin(t * c("wz")))
    sim.heli = WeatherHeliInput(position: p, altitude: p.y)
    let off = v.data["setup"]["camera"]["offset"].doubles ?? [0, 55, 35]
    let dir = v.data["setup"]["camera"]["direction"].doubles ?? [0, -0.8, -0.6]
    sim.camera = WeatherCameraInput(position: V3(p.x + off[0], p.y + off[1], p.z + off[2]), direction: V3(dir[0], dir[1], dir[2]))
  }

  // ---- the probe (export-sim.mjs FIELDS, same order) --------------------------------------------------
  func probe() -> [Double] {
    let w = sim
    let st = w.state
    @inline(__always) func b(_ x: Bool) -> Double { x ? 1 : 0 }
    var r = [Double]()
    r.reserveCapacity(240)
    r += [w.clock, w.scriptT, Double(w.scriptIdx), pidx(st.preset), st.severity, st.intensity]
    r += [b(w.tr.active), w.tr.t, w.tr.over, b(w.tr.wavesDown), b(w.tr.rainUp), w.tr.rainStart, w.tr.frontEnd]
    r += w.tCh
    r += [b(st.transition.active), pidx(st.transition.from), pidx(st.transition.to), st.transition.t, st.transition.over, st.transition.progress]
    r += [w.windTo, w.windA0, w.windA1, w.windAngle]
    r += [st.windDir.x, st.windDir.y, st.windSpeed, st.windFrom, st.gust, st.gustMax, w.meanWind.x, w.meanWind.y]
    r += [st.rain, st.fog, st.hail, st.lightning, st.waveHeight, st.waveChoppiness, st.night, st.timeOfDay, st.visibility, st.turbulence,
          st.beaufort, st.seaState, st.wet, st.flash]
    r += [st.flashColor.r, st.flashColor.g, st.flashColor.b]
    for d in [st.sunDir, st.sunDirShadow, st.sunDirVisual] { r += [d.x, d.y, d.z] }
    r += [b(st.front.active), st.front.t, st.front.origin.x, st.front.origin.y, st.front.dir.x, st.front.dir.y]
    r += [st.greenTint, w.greenTarget, w.greenApplied, st.stElmo]
    r += [st.pressure, st.pressureTrend, w.pTrendRate, w.pEmitted, w.pEmittedTrend, b(w.eye)]
    r += [st.rates.lightning, st.rates.spouts, st.rates.rogues]
    r += [st.lastStrike.x, st.lastStrike.z, st.lastStrike.distance, b(st.lastStrike.cloudOnly), st.lastStrike.t]
    r += [w.heliPos.x, w.heliPos.y, w.heliPos.z, w.heliAlt, w.camFocus.x, w.camFocus.y, w.camFocus.z]
    r += [b(w.attract), w.attractT, Double(w.attractIdx), w.attractBolt ?? .nan]
    let g = w.gusts
    r += [g.timer, Double(g.activeSlots.count)]
    for i in 0..<4 {
      if i < g.activeSlots.count {
        let s = g.activeSlots[i]
        let f = g.pool[s]
        r += [Double(s), f.x, f.z, f.dirX, f.dirZ, f.strength, f.baseStrength, f.eta, f.speed, b(f.harmless), f.age, f.fade]
      } else {
        r += [-1] + [Double](repeating: 0, count: 11)
      }
    }
    let l = w.lightning
    r += [l.flashT, l.flashStrength, b(l.flashReduced), l.lastFlashAt, l.timer, l.clock]
    for i in 0..<4 {
      let c = l.charges[i]
      r += [c.x, c.z, c.eta, c.total, c.radius, c.target == "heli" ? 1 : 0, c.strength, b(c.alive)]
    }
    let li = w.lights
    let ls = li.state
    r += [li.swingT, li.swingDir.x, li.swingDir.y, li.swingDir.z, ls.intensity, ls.color.r, ls.color.g, ls.color.b, ls.shadowIntensity,
          ls.shadowRadius, ls.hemiColor.r, ls.hemiColor.g, ls.hemiColor.b, ls.hemiGroundColor.r, ls.hemiGroundColor.g, ls.hemiGroundColor.b,
          ls.hemiIntensity, ls.target.x, ls.target.y, ls.target.z, ls.position.x, ls.position.y, ls.position.z, Double(ls.mapSize)]
    r += [w.fogColor.r, w.fogColor.g, w.fogColor.b, w.fogNear, w.fogFar, w.exposure, w.env.environmentIntensity, w.env.lastBake, b(w.env.dirty)]
    r += [look.wind.x, look.wind.y, look.windOffset.x, look.windOffset.y, look.rain, look.wet, look.flash, look.night]
    let e = w.endless
    let phases: [EndlessPlanner.Phase] = [.day, .sunset, .night]
    r += [b(e.active), e.t, e.inPreset, b(e.lullRolled), Double(phases.firstIndex(of: e.phase) ?? -1), e.next?.at ?? .nan, pidx(e.next?.preset),
          e.next?.over ?? .nan, b(e.next?.lull ?? false), pidx(e.nightPick)]
    return r
  }

  func frameHash(_ h: UInt32) -> UInt32 {
    FNV.mix(FNV.mix(FNV.mix(FNV.mix(h, probe()), sim.from), sim.cur), sim.out)
  }

  /// Runs the scenario; returns the rows (every `every` frames) and the hash sequence.
  func run() throws -> (rows: [[Double]], hashes: [UInt32]) {
    let setup = v.data["setup"]
    let frames = try setup["frames"].int.orThrow("frames")
    let every = try v.data["every"].int.orThrow("every")
    let hashEvery = try v.data["hashEvery"].int.orThrow("hashEvery")
    let dt = try setup["dt"].doubleOrFail("dt")
    frame = -1
    for a in actions[-1] ?? [] { try act(a) }
    sim.start()
    afterUpdate()
    var rows = [[Double]]()
    var hashes = [UInt32]()
    var h = FNV.offset
    for f in 0..<frames {
      frame = f
      heliInputs(f)
      for a in actions[f] ?? [] { try act(a) }
      sim.update(dt)
      afterUpdate()
      // hashEvery 1: every frame folds into the chain; otherwise only the sampled frames (long runs)
      if hashEvery == 1 || (f + 1) % hashEvery == 0 { h = frameHash(h) }
      if f == 0 { firstFrame = (probe(), sim.from, sim.cur, sim.out) }
      if (f + 1) % hashEvery == 0 { hashes.append(h) }
      if f % every == every - 1 { rows.append(probe()) }
    }
    return (rows, hashes)
  }

  /// The bake recorder (WeatherEnv.bake's uniforms when the policy fires this frame).
  private func afterUpdate() {
    guard sim.env.bakeNow else { return }
    let p = sim.state.palette
    let s = sim.state.sunDirVisual
    let vals = [p.sky.r, p.sky.g, p.sky.b, p.fogColor.r, p.fogColor.g, p.fogColor.b, p.deep.r, p.deep.g, p.deep.b, p.sun.r, p.sun.g, p.sun.b,
                s.x, s.y, s.z, p.sunIntensity, WeatherEnv.cloud(fog: p.fog, scud: p.scud)]
    bakes.append(.array([.number(Double(frame))] + vals.map(jsNum)))
  }
}

extension Optional {
  func orThrow(_ what: String) throws -> Wrapped {
    guard let v = self else { throw VectorError("missing \(what)") }
    return v
  }
}
