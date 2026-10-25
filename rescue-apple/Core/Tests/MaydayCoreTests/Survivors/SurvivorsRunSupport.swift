// Replays a survivors / fx trace of tools/export/export-survivors.mjs (Tests/Vectors/survivors/run_<id>.json)
// on the Swift systems: the same stubs (ocean = WaveBank + searchlight mirror + call recorder, scripted
// weather, recorded heli rows, look closures, a camera above the heli), the same per-frame order (heli row →
// pokes → winch contract calls → wave bank → look wind → camera → Survivors.update → Effects.update), and the
// same state parts, cut into the same Float64 lists and digested the same way (SvDigest = the exporter's
// 64-bit digest() of the Float64 values, NaN canonical). The part builders below mirror partEnv / partGroups /
// … / rWhale of the exporter field by field; keep them in sync.
import Foundation
import XCTest
@testable import MaydayCore

// ---- enums of the exporter (index lists) ----------------------------------------------------------------
enum SvEnums {
  static let types = ["swimmer", "raft", "hull", "container", "injured", "deck", "wreck", "plane"]
  static let states = ["hidden", "drifting", "spotted", "winching", "rescued", "lost"]
  static let kinds = ["raft", "hull", "container", "barge", "wreck", "rig"]
  static let styles = ["boat", "yacht", "plane"]
  static let wstates = ["stowed", "lowering", "down", "raising"]
  static let presets = ["calm", "overcast", "squall", "storm", "nightStorm", "fog", "clearing", "nightCalm"]
  static let flock = ["circle", "leave", "flee"]
  static let stamps = ["foam", "oil", "dye", "ring", "disturb", "scar", "splash", "wake"]

  /// arr.indexOf(v ?? null)
  static func idx(_ arr: [String], _ v: String?) -> Double {
    guard let v else { return -1 }
    return Double(arr.firstIndex(of: v) ?? -1)
  }

  /// [null, 'basket', 'raft'].indexOf(v ?? null)
  static func swim(_ v: String?) -> Double {
    switch v {
    case nil: return 0
    case "basket": return 1
    case "raft": return 2
    default: return -1
    }
  }
}

@inline(__always) private func b(_ x: Bool) -> Double { x ? 1 : 0 }
@inline(__always) private func n(_ x: Double?) -> Double { x ?? .nan }

// ---- stubs ---------------------------------------------------------------------------------------------------

/// The exporter's ocean: the real WaveBank, ocean.js searchlightAt over the beam of the heli row, and a call
/// recorder ([1 splash x z r s], [2 stamp kind x z radius strength], [3 glint x z r i rgb], [4 wake x z s dx dz]).
final class SvOcean: SeaOceanQuery {
  let bank: WaveBank
  var searchPos = V3()
  var searchDir = V3(0, -1, 0)
  var searchCos = 0.95
  var searchI = 0.0
  var calls: [Double] = []

  init(bank: WaveBank) { self.bank = bank }

  func heightAt(_ x: Double, _ z: Double) -> Double { bank.heightAt(x, z) }
  func seaNormalAt(_ x: Double, _ z: Double) -> V3 { bank.normalAt(x, z) }

  private func ss(_ a: Double, _ bb: Double, _ x: Double) -> Double {
    let t = JS.min(1, JS.max(0, (x - a) / (bb - a)))
    return t * t * (3 - 2 * t)
  }

  func searchlightAt(_ x: Double, _ z: Double, _ y: Double) -> Double {
    if searchI <= 0 { return 0 }
    let dx = x - searchPos.x, dy = y - searchPos.y, dz = z - searchPos.z
    let h = JS.hypot(dx, dy, dz)
    let d = JSNumber.isTruthy(h) ? h : 1e-3
    let cs = (dx * searchDir.x + dy * searchDir.y + dz * searchDir.z) / d
    let rho = JS.acos(JS.min(1, JS.max(-1, cs))) / JS.max(JS.acos(searchCos), 1e-3)
    return JS.min(1, JS.max(0, searchI * (1 - ss(220, 320, d)) * (1 - ss(0.72, 1, rho))))
  }

  func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) { calls += [1, x, z, radius, strength] }

  func seaStamp(_ kind: String, _ x: Double, _ z: Double, radius: Double, strength: Double) {
    calls += [2, SvEnums.idx(SvEnums.stamps, kind), x, z, radius, strength]
  }

  func addSeaGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: Color3) {
    calls += [3, x, z, radius, intensity, color.r, color.g, color.b]
  }

  func seaWake(_ x: Double, _ z: Double, _ strength: Double, _ dirX: Double, _ dirZ: Double) { calls += [4, x, z, strength, dirX, dirZ] }

  var seaBioluminescence: Double? { 1 }
}

/// The exporter's scripted weather: a state set by pokes, windAt = base + amp·(sin(0.3t + 0.002x),
/// cos(0.21t + 0.002z)), detectBase from `detect`, forecast from `forecast` (or []).
final class SvWeather: SeaWeatherQuery {
  var st = SeaWeatherState()
  var base = V2(0, 0)
  var amp = 0.0
  var detect: [Double]?
  var forecast: [SeaForecast]?
  let clock: () -> Double

  init(_ w0: JSONValue, clock: @escaping () -> Double) {
    self.clock = clock
    apply(w0)
  }

  private func color(_ v: JSONValue) -> Color3? {
    guard let a = v.doubles, a.count >= 3 else { return nil }
    return Color3(a[0], a[1], a[2])
  }

  /// weather.apply(w): each key as the exporter's makeWeather sets it.
  func apply(_ w: JSONValue) {
    for (k, v) in w.object?.entries ?? [] {
      switch k {
      case "wind":
        if let bb = v["base"].doubles { base = V2(bb[0], bb[1]) }
        if let a = v["amp"].double { amp = a }
      case "windDir": st.windDir = v.doubles.map { V2($0[0], $0[1]) }
      case "sunDir": st.sunDir = v.doubles.map { V3($0[0], $0[1], $0[2]) }
      case "sunDirVisual": st.sunDirVisual = v.doubles.map { V3($0[0], $0[1], $0[2]) }
      case "flashColor": st.flashColor = color(v)
      case "palette":
        var p = SeaPalette()
        p.ambient = color(v["ambient"])
        p.ambientIntensity = v["ambientIntensity"].double
        p.sun = color(v["sun"])
        p.sunIntensity = v["sunIntensity"].double
        p.sky = color(v["sky"])
        p.foam = color(v["foam"])
        p.body = color(v["body"])
        st.palette = p
      case "detect": detect = v.doubles
      case "forecast": forecast = v.array?.map { SeaForecast(inS: $0["in"].double ?? .nan, preset: $0["preset"].string ?? "") }
      case "preset": st.preset = v.string
      case "night": st.night = v.double
      case "intensity": st.intensity = v.double
      case "fog": st.fog = v.double
      case "rain": st.rain = v.double
      case "hail": st.hail = v.double
      case "waveHeight": st.waveHeight = v.double
      case "windSpeed": st.windSpeed = v.double
      case "flash": st.flash = v.double
      default: XCTFail("weather stub: unknown key \(k)")
      }
    }
  }

  var seaState: SeaWeatherState { st }

  func seaWindAt(_ x: Double, _ z: Double) -> V2? {
    let t = clock()
    return V2(base.x + amp * JS.sin(0.3 * t + 0.002 * x), base.y + amp * JS.cos(0.21 * t + 0.002 * z))
  }

  func seaDetectBase() -> (base: Double, altBonus: Double)? { detect.map { ($0[0], $0[1]) } }

  func seaForecast() -> [SeaForecast]? { forecast ?? [] }
}

/// The heli of the recorded rows.
final class SvHeli: SeaHeliSource {
  var seaView = SeaHeliView(position: V3(), velocity: V3(), altitude: 40, alive: true, rotorRPM: 1, beam: SearchlightBeam(), winchState: "stowed",
                            basket: V3(), winchHeight: 99)
}

/// The exporter's makeHazards: fixed whirlpools, rogue crests (a straight crest line moving along `dir` from
/// `from` at `speed` m/s between t0 and t1; lift = peak · max(0, 1 − |x·dx + z·dz − crest| / width)) and a
/// uniform surface flow (the web stub always has surfaceFlowAt: (0, 0) without a flow).
final class SvHazards: SeaHazardQuery {
  struct Rogue {
    var dir: V2
    var from, speed, t0, t1, peak, width: Double
  }
  let list: [SeaHazard]
  let rogues: [Rogue]
  let flow: V2
  let clock: () -> Double

  init(_ h: JSONValue, clock: @escaping () -> Double) throws {
    self.clock = clock
    var l = [SeaHazard]()
    for w in h["whirlpools"].array ?? [] {
      l.append(SeaHazard(type: "whirlpool", position: V3(try w["x"].requireDouble(), 0, try w["z"].requireDouble()), radius: w["radius"].double))
    }
    var r = [Rogue]()
    for g in h["rogues"].array ?? [] {
      let d = try g["dir"].requireDoubles()
      l.append(SeaHazard(type: "rogue", dir: V2(d[0], d[1])))
      r.append(Rogue(dir: V2(d[0], d[1]), from: try g["from"].requireDouble(), speed: try g["speed"].requireDouble(), t0: try g["t0"].requireDouble(),
                     t1: try g["t1"].requireDouble(), peak: try g["peak"].requireDouble(), width: try g["width"].requireDouble()))
    }
    list = l
    rogues = r
    flow = h["flow"].doubles.map { V2($0[0], $0[1]) } ?? V2(0, 0)
  }

  var seaHazards: [SeaHazard]? { list }

  func surfaceFlowAt(_ x: Double, _ z: Double) -> V2? { flow }

  func seaWaveLiftAt(_ x: Double, _ z: Double) -> Double? {
    let t = clock()
    var lift = 0.0
    for r in rogues {
      if t < r.t0 || t > r.t1 { continue }
      let crest = r.from + r.speed * (t - r.t0)
      lift = JS.max(lift, r.peak * JS.max(0, 1 - JS.abs(x * r.dir.x + z * r.dir.y - crest) / r.width))
    }
    return lift
  }
}

/// The exporter's makeWorld: pads (with an optional lowerDeck) and obstacles.
final class SvWorld: SeaWorldQuery {
  let lowerDecks: [SeaLowerDeck]
  let blockers: [SeaBlocker]

  init(_ w: JSONValue) {
    let pads = w["pads"].array ?? []
    let obstacles = w["obstacles"].array ?? []
    lowerDecks = pads.compactMap { p in
      let ld = p["lowerDeck"]
      guard let x = ld["x"].double, let z = ld["z"].double else { return nil }
      return SeaLowerDeck(x: x, y: ld["y"].double, z: z)
    }
    blockers = (obstacles + pads).map { SeaBlocker(x: $0["x"].double, z: $0["z"].double, radius: $0["radius"].double) }
  }
}

/// The exporter's makeMission: style(name, pos) → a fixed number (or no style()), state.
final class SvMission: SeaMissionHooks {
  let styleValue: Double?
  let state: String

  init(_ m: JSONValue) {
    styleValue = m["style"].double
    state = m["state"].string ?? "play"
  }

  func style(_ name: String, _ pos: V3) -> Double? { styleValue }
  var hasScorer: Bool { false }
  func scorerAdd(_ kind: String, _ points: Double, _ reason: String, _ pos: V3) -> Double? { nil }
  var isPlaying: Bool { state == "play" }
}

// ---- digests -------------------------------------------------------------------------------------------------
/// The exporter's digest(): two 32-bit lanes over the little-endian halves of every Float64 (NaN canonical
/// 0x7FF8000000000000) — lane A the murmur3_32 body (seed 0x9E3779B9), lane B FNV-1a over the words — then
/// the word count mixed in and fmix32 on both; 8 bytes = A (LE) ‖ B (LE).
enum SvDigest {
  @inline(__always) static func fmix32(_ x: UInt32) -> UInt32 {
    var h = x
    h ^= h >> 16
    h = h &* 0x85eb_ca6b
    h ^= h >> 13
    h = h &* 0xc2b2_ae35
    return h ^ (h >> 16)
  }

  static func digest(_ values: [Double]) -> [UInt8] {
    var a: UInt32 = 0x9e37_79b9
    var b: UInt32 = 0x811c_9dc5
    @inline(__always) func mix(_ w: UInt32) {
      var k = w &* 0xcc9e_2d51
      k = (k << 15) | (k >> 17)
      k = k &* 0x1b87_3593
      a ^= k
      a = (a << 13) | (a >> 19)
      a = a &* 5 &+ 0xe654_6b64
      b = (b ^ w) &* 0x0100_0193
    }
    values.withUnsafeBufferPointer { buf in
      for v in buf {
        let u: UInt64 = v.isNaN ? 0x7FF8_0000_0000_0000 : v.bitPattern
        mix(UInt32(truncatingIfNeeded: u))
        mix(UInt32(truncatingIfNeeded: u >> 32))
      }
    }
    let nw = UInt32(truncatingIfNeeded: values.count * 2)
    let ha = fmix32(a ^ nw), hb = fmix32(b ^ nw)
    return [0, 8, 16, 24].map { UInt8(truncatingIfNeeded: ha >> UInt32($0)) } + [0, 8, 16, 24].map { UInt8(truncatingIfNeeded: hb >> UInt32($0)) }
  }

  static func hex(_ values: [Double]) -> String { digest(values).map { String(format: "%02x", $0) }.joined() }
}

// ---- the runner ------------------------------------------------------------------------------------------------
final class SurvivorsRun {
  static let parts = ["env", "groups", "people", "carriers", "misc", "fx", "life", "air", "ocean"]
  static let rparts = ["crowd", "craft", "heat", "collars", "glows", "lines", "uniforms", "pools", "fxGlows", "rings", "fxHeat", "gulls", "dolphins", "whale"]

  let vec: VectorFile
  let setup: JSONValue
  let frames: Int
  let events = EventBus()
  let settings: StaticSettings
  let rng: Rng
  let ctx: SeaContext
  let bank = WaveBank()
  let sea: SeaState
  let ocean: SvOcean
  let weather: SvWeather
  let heli = SvHeli()
  let hazards: SvHazards?
  let world: SvWorld?
  let mission: SvMission?
  let camera = PerspectiveCamera(fov: 40, aspect: 1280.0 / 720.0, near: 2, far: 1200)
  let sv: Survivors
  let fx: Effects
  var frame = 0
  var t = 0.0
  var mode = GameMode.play
  var thermal = false
  var uWind = V2()
  var eventLog: [JSONValue] = []
  var shakes: [JSONValue] = []
  var nearest: [JSONValue] = []

  // recorded inputs
  let heliFields: [String: Int]
  let heliSame: [String: String]
  let heliConst: JSONObject
  let heliRows: [Float]
  let heliWidth: Int
  var pokes: [Int: [JSONValue]] = [:]
  var calls: [Int: [JSONValue]] = [:]
  /// expected digests [frame][part] (8 bytes)
  let digests: [UInt8]
  let renderDigests: [Int: [String]]
  /// full dumps: (frame, part) → values
  var dumps: [String: [Double]] = [:]
  /// the boarded records the web's boardOne returned ({name, age, condition} per board call)
  var boardChecks: [(frame: Int, want: JSONValue, got: JSONValue)] = []

  /// The boarded record with the web person's keys (people.js / survivors.boardOne).
  static func recordJSON(_ r: BoardedRecord) -> JSONValue {
    var o = JSONObject()
    func str(_ s: String?) -> JSONValue { s.map { .string($0) } ?? .null }
    o.set("name", .string(r.name))
    o.set("first", .string(r.first))
    o.set("surname", .string(r.surname))
    o.set("gender", .string(r.gender))
    o.set("age", r.age.map { .number($0) } ?? .null)
    o.set("child", .bool(r.child))
    o.set("occupation", .string(r.occupation))
    o.set("condition", .string(r.condition))
    o.set("warmth", .number(r.warmth))
    o.set("warmthAtLift", .number(r.warmthAtLift))
    o.set("minutesInWater", .number(r.minutesInWater))
    o.set("tags", .array(r.tags.map { .string($0) }))
    o.set("quote", .string(r.quote))
    o.set("injured", .bool(r.injured))
    o.set("type", .string(r.type))
    o.set("tag", str(r.tag))
    o.set("label", str(r.label))
    o.set("pet", str(r.pet))
    return .object(o)
  }

  init(_ name: String) throws {
    vec = try VectorLoader.load(name)
    let d = vec.data
    setup = d["setup"]
    frames = try setup["frames"].requireInt("frames")
    sea = SeaState(json: setup["sea"])
    bank.setQuality(8, 300)
    bank.setSeed(303, 0.6)
    var sv0: [String: JSONValue] = [:]
    for (k, v) in setup["settings"].object?.entries ?? [] { sv0[k] = v }
    settings = StaticSettings(sv0)
    rng = Rng(seed: try setup["seed"].requireDouble("seed"))
    camera.setMainStartPose()
    let rng = self.rng
    ctx = SeaContext(events: events, settings: settings, random: { rng.next() })
    ocean = SvOcean(bank: bank)
    var clockRef: (() -> Double)!
    weather = SvWeather(setup["weather"], clock: { clockRef() })
    hazards = setup["hazards"].isNull ? nil : try SvHazards(setup["hazards"], clock: { clockRef() })
    world = setup["world"].isNull ? nil : SvWorld(setup["world"])
    mission = setup["mission"].isNull ? nil : SvMission(setup["mission"])

    let fields = try XCTUnwrap(d["heliFields"].strings)
    heliFields = Dictionary(uniqueKeysWithValues: fields.enumerated().map { ($1, $0) })
    heliWidth = fields.count
    heliSame = Dictionary(uniqueKeysWithValues: (d["heliSame"].object?.entries ?? []).compactMap { k, v in v.string.map { (k, $0) } })
    heliConst = d["heliConst"].object ?? JSONObject()
    heliRows = try vec.sidecarF32(d["heli"])
    for p in d["pokes"].array ?? [] { pokes[try p[0].requireInt("poke frame"), default: []].append(p[1]) }
    for c in d["calls"].array ?? [] { calls[try c[0].requireInt("call frame"), default: []].append(c[1]) }
    digests = try vec.sidecarU8(d["digests"])
    var rd: [Int: [String]] = [:]
    let flat = d["renderDigests"].array ?? []
    var i = 0
    while i < flat.count {
      let f = try flat[i].requireInt("render digest frame")
      rd[f] = try (1...SurvivorsRun.rparts.count).map { try flat[i + $0].requireString("render digest") }
      i += 1 + SurvivorsRun.rparts.count
    }
    renderDigests = rd
    let dv = try vec.sidecarF64(d["dumpValues"])
    for e in d["dumps"].array ?? [] {
      let r = try e.requireDoubles("dump")
      let o = Int(r[2]), c = Int(r[3])
      dumps["\(Int(r[0])):\(Int(r[1]))"] = Array(dv[o..<(o + c)])
    }

    let catalog = try VectorLoader.catalog()
    sv = Survivors(tables: try SurvivorTables(catalog: catalog), ctx: ctx)
    fx = Effects(tables: try FxTables(catalog: catalog), ctx: ctx)

    // wiring (after the constructors, like the exporter's ctx)
    clockRef = { [unowned self] in self.t }
    ctx.mode = { [unowned self] in self.mode }
    ctx.time = { [unowned self] in self.t }
    ctx.ocean = ocean
    ctx.weather = weather
    ctx.heli = heli
    ctx.hazards = hazards
    ctx.world = world
    ctx.mission = mission
    ctx.fx = fx
    ctx.survivors = sv
    ctx.camera = camera
    ctx.meanWind = { [unowned self] in self.uWind }
    ctx.gustField = { [unowned self] x, z in 0.5 + 0.3 * JS.sin(0.011 * x + 0.3 * self.t) * JS.cos(0.013 * z) }
    ctx.thermalActive = { [unowned self] in self.thermal }
    ctx.cameraCinematic = { false }
    ctx.cameraShake = { [unowned self] s, dd in self.shakes.append(.array([.number(Double(self.frame)), .number(s), .number(dd)])) }
    events.onEmit = { [unowned self] e in self.record(e) }
  }

  deinit { events.onEmit = nil }

  // ---- events as the exporter logs them -------------------------------------------------------------------
  func record(_ e: GameEvent) {
    if case .survivorSpawn(let p) = e, let g = sv.group(id: p.s), let c = g.carrier { craftOf.append((c, g, nil)) }
    eventLog.append(HeliScenario.eventJSON(e, frame: frame))
  }

  // ---- checkpoints (the exporter's takeCheckpoint = mission._takeCheckpoint's survivors part) -------------------
  /// carrier → the group it was built for, or the entry a restored free carrier came from (latest wins)
  var craftOf: [(carrier: Carrier, group: SurvivorGroup?, entry: SurvivorEntry?)] = []
  /// (frame, Swift snapshot, web snapshot)
  var checkpointChecks: [(frame: Int, got: JSONValue, want: JSONValue)] = []

  func checkpointJSON() -> JSONValue {
    var carriers = [JSONValue]()
    var freeIdx: [(Carrier, Int)] = []
    for c in sv.carriers where c.alive && c.owner == nil {
      freeIdx.append((c, carriers.count))
      var o = sv.snapCarrier(c).json.object!
      let src = craftOf.last { $0.carrier === c }
      o.set("entry", src.map { $0.group?.def.raw ?? $0.entry?.raw ?? .null } ?? .null)
      carriers.append(.object(o))
    }
    var groups = [JSONValue]()
    for s in sv.list {
      if s.state == .rescued || s.state == .lost || s.attached != nil || s.people.isEmpty { continue }
      var o = JSONObject()
      o.set("entry", s.def.raw)
      o.set("type", .string(s.type))
      o.set("x", .number(s.position.x))
      o.set("z", .number(s.position.z))
      o.set("people", .array(s.people.map { $0.rec?.json ?? .null }))
      o.set("health", .number(s.health))
      o.set("spotted", .bool(s.spotted))
      o.set("age", .number(JSNumber.or(s.age, 0)))
      o.set("pet", .bool(s.pet != nil))
      if let d = s.datum, !s.spotted {
        var dj = JSONObject()
        dj.set("x", .number(d.x))
        dj.set("z", .number(d.z))
        dj.set("radius", .number(d.radius))
        o.set("datum", .object(dj))
      } else {
        o.set("datum", .null)
      }
      let c = s.carrier
      o.set("carrier", c.flatMap { $0.owner === s ? sv.snapCarrier($0).json : nil } ?? .null)
      o.set("raft", c.flatMap { cc in freeIdx.first { $0.0 === cc }.map { .number(Double($0.1)) } } ?? .null)
      o.set("sig", sv.snapSignals(s).json)
      groups.append(.object(o))
    }
    var o = JSONObject()
    o.set("elapsed", .number(sv.elapsed))
    o.set("groups", .array(groups))
    o.set("carriers", .array(carriers))
    o.set("rescued", .number(Double(sv.rescuedTotal)))
    o.set("lost", .number(Double(sv.lostTotal)))
    o.set("lostMarkers", .array(sv.lostMarkers.map { m in
      var mo = JSONObject()
      mo.set("x", .number(m.x))
      mo.set("z", .number(m.z))
      return .object(mo)
    }))
    o.set("bottleTaken", .bool(sv.bottle.taken))
    return .object(o)
  }

  // ---- the recorded heli row ------------------------------------------------------------------------------
  /// One field of this frame's heli row: a recorded column, a column equal to another one (heliSame), or a
  /// constant of the run (heliConst).
  func hv(_ k: String) -> Double {
    if let i = heliFields[k] { return Double(heliRows[(frame - 1) * heliWidth + i]) }
    if let o = heliSame[k] { return hv(o) }
    return heliConst[k]?.double ?? .nan
  }

  func applyHeliRow() {
    var v = heli.seaView
    v.position = V3(hv("x"), hv("y"), hv("z"))
    v.velocity = V3(hv("vx"), hv("vy"), hv("vz"))
    v.altitude = hv("alt")
    v.alive = hv("alive") != 0
    v.landed = JSNumber.isTruthy(hv("landed"))
    v.landedPadY = v.landed ? hv("padY") : nil
    v.rotorRPM = hv("rpm")
    v.downwash = JSNumber.isTruthy(hv("dwHas")) ? Downwash(x: hv("dwX"), z: hv("dwZ"), radius: hv("dwR"), strength: hv("dwS")) : nil
    var bm = v.beam ?? SearchlightBeam()
    bm.on = hv("beamOn") != 0
    bm.intensity = hv("beamI")
    bm.origin = V3(hv("beamOx"), hv("beamOy"), hv("beamOz"))
    bm.dir = V3(hv("beamDx"), hv("beamDy"), hv("beamDz"))
    bm.cosOuter = hv("beamCos")
    bm.length = hv("beamLen")
    v.beam = bm
    v.winchState = SvEnums.wstates[Int(hv("wState"))]
    if JSNumber.isTruthy(hv("basketHas")) { v.basket = V3(hv("bx"), hv("by"), hv("bz")) }
    v.winchHeight = hv("wHeight")
    v.basketMeshVisible = hv("bmVisible") != 0
    v.basketMeshPosition = V3(hv("bmPx"), hv("bmPy"), hv("bmPz"))
    v.basketMeshQuaternion = Quat(hv("bmQx"), hv("bmQy"), hv("bmQz"), hv("bmQw"))
    heli.seaView = v
    // heli.update → ocean.setSearchlight(origin, dir, cosOuter, level)
    ocean.searchPos = bm.origin
    ocean.searchDir = bm.dir
    ocean.searchCos = bm.cosOuter
    ocean.searchI = bm.on ? bm.intensity : 0
  }

  // ---- pokes and contract calls -----------------------------------------------------------------------------
  func applyPoke(_ pk: JSONValue) throws {
    switch try pk["op"].requireString("op") {
    case "setup": events.emit(GameEvent.MissionSetup(def: vec.data["def"]))
    case "mode":
      let to = try XCTUnwrap(GameMode(rawValue: try pk["to"].requireString()))
      let from = mode
      mode = to
      events.emit(GameEvent.GameMode(from: from, to: to))
    case "emit":
      let p = pk["payload"]
      switch try pk["name"].requireString() {
      case "heli:loudspeaker": events.emit(GameEvent.HeliLoudspeaker(x: try p["x"].requireDouble(), z: try p["z"].requireDouble()))
      case "heli:flare": events.emit(GameEvent.HeliFlare(x: try p["x"].requireDouble(), z: try p["z"].requireDouble()))
      case "heli:raft-drop": events.emit(GameEvent.HeliRaftDrop(x: try p["x"].requireDouble(), z: try p["z"].requireDouble()))
      case "weather:lightning":
        events.emit(GameEvent.WeatherLightning(x: try p["x"].requireDouble(), z: try p["z"].requireDouble(), distance: p["distance"].double ?? 0,
                                               strength: p["strength"].double ?? 1, cloudOnly: p["cloudOnly"].bool ?? false))
      case let nm: XCTFail("unknown poke event \(nm)")
      }
    case "signal":
      if let s = sv.byTag(try pk["tag"].requireString()).first { _ = sv.fireSignal(s, try pk["kind"].requireString()) }
    case "weather": weather.apply(pk["set"])
    case "thermal": thermal = pk["on"].jsTruthy
    case "spot":
      if let s = sv.group(id: GroupID(try pk["s"].requireInt())) { sv.spot(s, pk["by"].string ?? "crew") }
    case "settings":
      for (k, v) in pk["set"].object?.entries ?? [] { settings.values[k] = v }
    case "checkpoint":
      // mission._takeCheckpoint → (retry) mission:setup → survivors.restoreCheckpoint, at once
      checkpointChecks.append((frame, checkpointJSON(), pk["cp"]))
      events.emit(GameEvent.MissionSetup(def: vec.data["def"]))
      let cp = SurvivorsCheckpoint(json: pk["cp"])
      for (i, c) in sv.restoreCheckpoint(cp).enumerated() {
        if let c { craftOf.append((c, nil, cp.carriers[i]?.entry)) }
      }
    case "warning":
      let p = try pk["position"].requireDoubles()
      events.emit(GameEvent.HazardWarning(type: try pk["type"].requireString(), text: pk["text"].string ?? "", position: V3(p[0], p[1], p[2])))
    case let op: XCTFail("unknown poke \(op)")
    }
  }

  func applyCall(_ c: JSONValue) throws {
    let id = GroupID(try c["s"].requireInt("call s"))
    var v = heli.seaView
    switch try c["op"].requireString("op") {
    case "attach":
      sv.attachToBasket(id)
      v.winchLoad = sv.group(id: id) != nil ? id : nil
    case "board":
      let p = sv.boardOne(id)
      v.winchLoad = nil
      boardChecks.append((frame, c["person"], p?.person.flatMap { sv.boardedRecord($0) }.map(SurvivorsRun.recordJSON) ?? .null))
    case "detach":
      sv.detachFromBasket(id, slip: c["slip"].jsTruthy ? BasketSlip(heatLoss: 10, reason: "unsteady") : nil)
      v.winchLoad = nil
    case let op: XCTFail("unknown call \(op)")
    }
    heli.seaView = v
  }

  // ---- one frame exactly like the exporter's loop ------------------------------------------------------------
  func step() throws {
    frame += 1
    let dt = 1.0 / 60
    t += dt
    applyHeliRow()
    for pk in pokes[frame] ?? [] { try applyPoke(pk) }
    for c in calls[frame] ?? [] { try applyCall(c) }
    bank.update(dt, t, sea, 0.6, 1, 0, 0)
    let st = weather.st
    let wd = st.windDir ?? V2()
    let ws = st.windSpeed ?? .nan
    uWind = V2(wd.x * ws, wd.y * ws)
    let hp = heli.seaView.position
    camera.position = V3(hp.x, hp.y + 160, hp.z + 70)
    camera.lookAt(V3(hp.x, 0, hp.z))
    ocean.calls.removeAll(keepingCapacity: true)
    sv.update(dt)
    fx.update(dt)
    if heli.seaView.winchState != "stowed", let bk = heli.seaView.basket {
      let s = sv.nearestFor(bk.x, bk.z, 4.5)
      nearest.append(.array([.number(Double(frame)), .number(s.map { Double($0.id.raw) } ?? -1)]))
    }
  }

  // ---- state parts (exporter partEnv … partAir + the ocean calls) -----------------------------------------------
  func statePart(_ k: Int) -> [Double] {
    switch k {
    case 0: return partEnv()
    case 1: return partGroups()
    case 2: return partPeople()
    case 3: return partCarriers()
    case 4: return partMisc()
    case 5: return partFx()
    case 6: return partLife()
    case 7: return partAir()
    default: return ocean.calls
    }
  }

  func partEnv() -> [Double] {
    let e = sv.env
    return [e.t, e.dt, b(e.play), e.night, SvEnums.idx(SvEnums.presets, e.preset), e.intensity, b(e.fogBlind), e.fog, e.windSpeed, e.windDirX, e.windDirZ,
            e.windAngle, e.Hs, b(e.sunny), e.base, e.altBonus, b(e.reduceFlashes), e.thermal, b(e.heliAlive), b(e.rotorHeard), e.hx, e.hy, e.hz, e.alt,
            e.dwR, e.dwS, SvEnums.idx(SvEnums.wstates, e.wState), e.bx, e.by, e.bz, e.bH, b(e.bWet), e.wLoad.map { Double($0.raw) } ?? -1,
            e.ghostLight.r, e.ghostLight.g, e.ghostLight.b, e.foam.r, e.foam.g, e.foam.b, Double(sv.list.count), Double(sv.datums.count),
            Double(sv.carriers.count), Double(sv.lostMarkers.count), Double(sv.pending.count), Double(sv.playerFlares.count),
            Double(sv.rescuedTotal), Double(sv.lostTotal), sv.elapsed, sv.waterTemp, sv.current.x, sv.current.y]
  }

  func partGroups() -> [Double] {
    var v = [Double]()
    for s in sv.list {
      let g = s.sig!
      let st: Double = g.strobe == true ? 1 : g.strobe == false ? 0 : -1
      v += [Double(s.id.raw), SvEnums.idx(SvEnums.types, s.type), SvEnums.idx(SvEnums.states, s.state.rawValue), s.position.x, s.position.y, s.position.z,
            s.velocity.x, s.velocity.y, s.velocity.z, Double(s.count), Double(s.remaining), s.health, s.warmth, b(s.spotted), b(s.critical), b(s.panic),
            b(s.strobe), s.calm, s.excite, s.beamT, s.coreT, s.lostT]
      v += [s.rogueCd, s.dwT, s.dwWarn, s.dwWarnT, b(s.shoutNear), b(s.flower), s.ringSpin, s.nrm.x, s.nrm.y, s.nrm.z, s.dHeli, SvEnums.swim(s.swimTo),
            s.jumpT, s.since, s.age, n(s.deckY), s.height, b(s.attached != nil), b(s.lostPending),
            s.carrier.map { c in Double(sv.carriers.firstIndex { $0 === c } ?? -1) } ?? -1]
      if let d = s.datum { v += [d.x, d.z, d.radius] } else { v += [.nan, .nan, .nan] }
      if let p = s.signal { v += [p.until, p.x, p.z, p.error, p.arc, p.t] } else { v += [.nan, .nan, .nan, .nan, .nan, .nan] }
      v += [Double(s.people.count), g.rockets, g.rocketT, b(g.rocketHold), g.fired, g.smoke, g.smokeBurn, g.flares, g.flareBurn, b(g.flareObj != nil),
            b(g.whistle), g.whistleT, b(g.dye), g.dyeT, g.dyeStampT, b(g.mirror), g.mirrorT, g.mirrorFlash, b(g.epirb), g.epirbT, g.epirbError, st, g.hornT]
      if let p = s.pet { v += [1, b(p.far), b(p.refused), p.hopT, p.barkT, p.yaw] } else { v += [0, 0, 0, 0, 0, 0] }
    }
    return v
  }

  func partPeople() -> [Double] {
    var v = [Double]()
    func one(_ s: SurvivorGroup, _ p: SurvivorPerson) {
      v += [Double(s.id.raw), p.skin, p.hood, p.jacket, p.pants, p.scale, p.phase, p.waveArm, p.strobePhase, p.yaw, p.arms.aL, p.arms.pL, p.arms.aR,
            p.arms.pR, p.x, p.y, p.z, p.waterY, p.legFold, p.liftWarmth, p.spin, n(p.strokeT), n(p.strokeSide), n(p.attachT)]
    }
    for s in sv.list {
      for p in s.people { one(s, p) }
      if let a = s.attached { one(s, a) }
    }
    return v
  }

  func partCarriers() -> [Double] {
    var v = [Double]()
    for c in sv.carriers {
      v += [SvEnums.idx(SvEnums.kinds, c.kind.rawValue), SvEnums.idx(SvEnums.styles, c.style), c.x, c.y, c.z, c.yaw, c.nrm.x, c.nrm.y, c.nrm.z, c.roll,
            c.pitch, c.sink, c.flip, n(c.flipT), b(c.capsized), c.flutter, c.tapeLit, c.tapeFlash, c.tapeGlintT, c.dissolve, c.phase, c.lampPhase]
      v += [c.owner.map { Double($0.id.raw) } ?? -1, Double(c.riders.count), b(c.dropped), c.inflate, b(c.alive), c.emptyT, c.deckY, c.sinkAt,
            c.flood, c.age, c.sinking, c.tipT, c.tip, c.tipDir, c.tipPhase, n(c.baseRoll), c.anchor.x, c.anchor.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w]
      if let vel = c.vel { v += [vel.x, vel.z] } else { v += [.nan, .nan] }
      v += [b(c.lampDead == true), c.oilT, c.oilN, c.bubbleT, c.creakT, n(c.washT), b(c.warned), c.lights]
      if let col = c.color { v += [col.r, col.g, col.b] } else { v += [.nan, .nan, .nan] }
      v.append(Double(c.debris.count))
      for d in c.debris { v += [d.dx, d.dz, d.x, d.z, d.y, d.yaw, d.spin] }
      for k in 0..<16 { v.append(c.matrix[k]) }
    }
    return v
  }

  func partMisc() -> [Double] {
    var v = [Double]()
    for d in sv.datums { v += [d.x, d.z, d.radius, d.ids.first.map { Double($0.raw) } ?? .nan, d.group.map { Double($0.id.raw) } ?? -1] }
    for m in sv.lostMarkers { v += [m.x, m.z, m.y, m.t, m.group.map { Double($0.raw) } ?? -1, m.phase, m.nrm.x, m.nrm.y, m.nrm.z] }
    for f in sv.playerFlares { v += [f.x, f.z, f.until] }
    let bo = sv.bottle!
    v += [b(bo.active), b(bo.taken), bo.x, bo.z, bo.y, bo.yaw, bo.phase, bo.capT, b(bo.lift != nil), bo.nrm.x, bo.nrm.y, bo.nrm.z, Double(sv.quoteUsed.count)]
    return v
  }

  func partFx() -> [Double] {
    var v = [fx.t, b(fx.heli.alive), fx.heli.x, fx.heli.y, fx.heli.z, fx.heli.alt, fx.heli.rpm, fx.heli.vx, fx.heli.vz, fx.dw.x, fx.dw.z, fx.dw.radius,
             fx.dw.strength, fx.focus.x, fx.focus.y, fx.wind.x, fx.wind.y, fx.camPos.x, fx.camPos.y, fx.camPos.z]
    for p in [fx.pools.spray, fx.pools.smoke, fx.pools.glow] { v += [Double(p.head), Double(p.capacity), Double(p.emitted)] }
    let S = fx.signals!
    v += [S.lensCd, Double(S.lensCount), S.night]
    let lp = fx.lightPool
    func L(_ h: LightHandle?) -> [Double] {
      guard let h else { return [-9, -9, .nan, .nan] }
      return [Double(lp.handles.firstIndex { $0 === h } ?? -1), Double(h.slot), h.intensity, h.distance]
    }
    for f in S.flares {
      v += [b(f.alive), f.x, f.y, f.z, f.t, f.life, f.seed, b(f.held), f.lift, f.lx, f.lz, f.flick, f.smokeAcc, f.sparkAcc] + L(f.light)
    }
    for r in S.rockets {
      v += [b(r.alive), r.x, r.y, r.z, r.x0, r.y0, r.z0, r.px, r.py, r.pz, r.sx, r.sz, r.t, r.trailAcc, r.seed, r.color.r, r.color.g, r.color.b, b(r.lens),
            r.ax, r.ay, r.az, r.top] + L(r.light)
    }
    v += [Double(lp.handles.count), Double(lp.spare.count)]
    for h in lp.handles {
      v += [h.position.x, h.position.y, h.position.z, h.intensity, h.distance, Double(h.slot), h.score, h.color.r, h.color.g, h.color.b]
    }
    for i in 0..<lp.lights.count {
      let l = lp.lights[i]
      v += [l.intensity, l.distance, l.position.x, l.position.y, l.position.z, l.color.r, l.color.g, l.color.b,
            lp.owner[i].map { o in Double(lp.handles.firstIndex { $0 === o } ?? -1) } ?? -1]
    }
    v += [Double(fx.stars.count), Double(fx.timedLights.count)]
    let a = fx.acc
    v += [a.dw, a.dwHaze, a.bio, a.crest, a.hail, a.hailShake]
    for e in fx.emitters { v += [e.x, e.z, Double(e.kind), e.lastT, e.budget, e.acc] }
    for r in fx.rings.list { v += [b(r.alive), r.x, r.z, r.t, r.life, r.r1, r.I] }
    return v
  }

  func partLife() -> [Double] {
    let g = fx.gulls!
    var v = [b(g.allowed), g.gateT, g.scanT, b(g.leftAnnounced), b(g.returning), Double(g.limit), Double(g.flocks.count)]
    for f in g.flocks {
      v += [f.anchor.map { Double($0.raw) } ?? -1, f.cx, f.cz, SvEnums.idx(SvEnums.flock, f.state), f.t, f.fleeT, f.fromX, f.fromZ, Double(f.birds.count)]
    }
    for bd in g.birds {
      v += [b(bd.on), bd.x, bd.y, bd.z, bd.vx, bd.vy, bd.vz, bd.heading, bd.bank, bd.phase, bd.amp, bd.burst, bd.burstT, bd.ang, bd.rad, bd.alt, bd.w, bd.seed]
    }
    let d = fx.dolphins!
    v += [b(d.active), d.timer, d.t, d.life, d.x, d.z, d.dx, d.dz, Double(d.n), Double(d.limit)]
    for m in d.members { v += [m.ox, m.oz, m.ph, b(m.was)] }
    let w = fx.whale!
    v += [b(w.active), w.timer, w.t, w.x, w.z, w.dx, w.dz, b(w.blown), b(w.allowed)]
    return v
  }

  func partAir() -> [Double] {
    let a = fx.air
    var v = [a.airAmb.r, a.airAmb.g, a.airAmb.b, a.airSun.r, a.airSun.g, a.airSun.b, a.airSunDir.x, a.airSunDir.y, a.airSunDir.z, a.airFlash.r, a.airFlash.g,
             a.airFlash.b, a.airNight, a.beamPos.x, a.beamPos.y, a.beamPos.z, a.beamPos.w, a.beamDir.x, a.beamDir.y, a.beamDir.z, a.beamDir.w, a.beamLen]
    for p in a.fxLightPos { v += [p.x, p.y, p.z, p.w] }
    for c in a.fxLightCol { v += [c.x, c.y, c.z, c.w] }
    v += [a.fxTime, a.killBefore, a.heliP.x, a.heliP.y, a.heliP.z, a.heliP.w, a.downwash.x, a.downwash.y, a.downwash.z, a.downwash.w, a.seaLevel, a.hs]
    return v
  }

  // ---- render parts (Float32 buffers widened; [0, count)) ------------------------------------------------------
  private func f32(_ a: [Float], _ count: Int, _ size: Int) -> [Double] { a[0..<(count * size)].map(Double.init) }

  private func m16(_ m: Mat4) -> [Double] { (0..<16).map { m[$0] } }

  func renderPart(_ k: Int) -> [Double] {
    let r = sv.render
    switch k {
    case 0:
      let c = r.crowd
      return [Double(c.count), b(c.visible), b(c.ghostVisible), b(c.keylineVisible), b(c.keylineOn)] + f32(c.matrices, c.count, 16)
        + f32(c.arms, c.count, 4) + f32(c.pose, c.count, 4) + f32(c.look, c.count, 4) + f32(c.fx, c.count, 4)
    case 1:
      var v = [Double]()
      func one(_ bt: CraftInstances) {
        v += [Double(bt.count)] + f32(bt.matrices, bt.count, 16) + f32(bt.a1, bt.count, 4) + f32(bt.a2, bt.count, 4)
        if bt.hasColor { v += f32(bt.colors, bt.count, 3) }
      }
      for bt in [r.raft, r.boat, r.yacht, r.container, r.plane, r.stretcher, r.buoy, r.debris] { one(bt) }
      for spec in r.bigSpecs { one(r.big[spec.key]!) }
      for d in r.decals { v += [b(d.visible), d.opacity] + m16(d.matrix) }
      v += [b(r.bottleVisible)] + m16(r.bottleMatrix)
      return v
    case 2:
      var v = [Double]()
      for h in [r.heatRaft, r.heatBoat, r.heatYacht, r.heatPlane] { v += [Double(h.count)] + f32(h.matrices, h.count, 16) }
      return v
    case 3: return [Double(r.collars.count)] + f32(r.collars.matrices, r.collars.count, 16) + f32(r.collars.data, r.collars.count, 4)
    case 4: let g = r.glows; return [Double(g.count)] + f32(g.P, g.count, 4) + f32(g.C, g.count, 4) + f32(g.H, g.count, 4)
    case 5: return [Double(r.lines.count)] + f32(r.lines.positions, r.lines.count, 6)
    case 6:
      let u = r.uniforms
      let water = u.water ?? Color3(style: "#17586A")
      func c(_ x: Color3) -> [Double] { [x.r, x.g, x.b] }
      return c(u.ghostLight) + c(water) + c(u.foam) + c(u.rim) + c(u.nightAmb) + c(u.skyFill) + c(u.steelFill) + [u.vestGlow]
    case 7:
      if frame % 60 != 0 { return [] }
      var v = [Double]()
      for p in [fx.pools.spray, fx.pools.smoke, fx.pools.glow] {
        for a in [p.iA, p.iB, p.iC, p.iD, p.iE, p.iF] { v += a.map(Double.init) }
      }
      return v
    case 8: let g = fx.glows; return [Double(g.count)] + f32(g.P, g.count, 4) + f32(g.C, g.count, 4) + f32(g.H, g.count, 4) + f32(g.Hc, g.count, 3)
    case 9: let rr = fx.rings; return [Double(rr.count)] + f32(rr.R, rr.count, 4) + f32(rr.Rc, rr.count, 4)
    case 10: let s = fx.signals!; return [Double(s.heatCount)] + f32(s.heatMatrices, s.heatCount, 16)
    case 11: let g = fx.gulls!; return [Double(g.count)] + f32(g.matrices, g.count, 16) + f32(g.flap, g.count, 1)
    case 12: let d = fx.dolphins!; return [Double(d.count), b(d.visible)] + f32(d.matrices, d.count, 16)
    default:
      let w = fx.whale!
      return [b(w.visible)] + m16(w.matrix) + [b(w.shadeVisible)] + m16(w.shadeMatrix) + [w.shadeK]
    }
  }

  // ---- comparison ----------------------------------------------------------------------------------------------
  /// The first path where two JSON values differ the exporter's way (nil: equal).
  static func jsonDiff(_ a: JSONValue, _ b: JSONValue, _ path: String = "$") -> String? {
    switch (a, b) {
    case (.array(let x), .array(let y)):
      if x.count != y.count { return "\(path): \(x.count) items, expected \(y.count)" }
      for (i, (p, q)) in zip(x, y).enumerated() { if let d = jsonDiff(p, q, "\(path)[\(i)]") { return d } }
      return nil
    case (.object(let x), .object(let y)):
      for k in Set(x.keys).union(y.keys).sorted() { if let d = jsonDiff(x[k] ?? .null, y[k] ?? .null, "\(path).\(k)") { return d } }
      return nil
    default:
      return jsonEqualBitwise(a, b) ? nil : "\(path): \(a), expected \(b)"
    }
  }

  /// The first field that differs from the nearest full dump of `part` at this frame (nil: no dump here).
  func diagnose(_ key: String, _ got: [Double]) -> String {
    guard let want = dumps[key] else { return "no dump at \(key)" }
    if got.count != want.count { return "\(got.count) values, dump has \(want.count)" }
    var out = [String]()
    for i in 0..<got.count where !Bits.equal(got[i], want[i]) {
      out.append("[\(i)] \(Bits.describe(got[i], want[i]))")
      if out.count >= 6 { break }
    }
    return out.isEmpty ? "dump equal (digest differs?)" : out.joined(separator: "; ")
  }

  struct Mismatch {
    var frame: Int
    var part: String
    var detail: String
  }

  /// Runs every frame; returns the first mismatch of each part (state parts every frame, render parts every
  /// 10th). A part that diverged between two full dumps is diffed field by field at its next dump frame.
  func run(stopAfter limit: Int = 12) throws -> [Mismatch] {
    var bad: [Mismatch] = []
    /// part name → (index into `bad`, dump key suffix) still waiting for a dump to diff against
    var waiting: [String: (Int, Int)] = [:]
    var failed = Set<String>()
    let np = SurvivorsRun.parts.count
    func check(_ name: String, _ key: Int, _ vals: () -> [Double], _ equal: ([Double]) -> Bool) {
      if let (i, k) = waiting[name], dumps["\(frame):\(k)"] != nil {
        bad[i].detail += "; at the next dump (frame \(frame)): " + diagnose("\(frame):\(k)", vals())
        waiting[name] = nil
        return
      }
      if failed.contains(name) { return }
      let v = vals()
      if equal(v) { return }
      failed.insert(name)
      let dk = "\(frame):\(key)"
      if dumps[dk] != nil {
        bad.append(Mismatch(frame: frame, part: name, detail: diagnose(dk, v)))
      } else {
        bad.append(Mismatch(frame: frame, part: name, detail: "digest differs (no dump at this frame)"))
        waiting[name] = (bad.count - 1, key)
      }
    }
    for _ in 0..<frames {
      try step()
      for k in 0..<np {
        let o = ((frame - 1) * np + k) * 8
        check(SurvivorsRun.parts[k], k, { statePart(k) }) { SvDigest.digest($0) == Array(digests[o..<(o + 8)]) }
      }
      if let want = renderDigests[frame] {
        for k in 0..<SurvivorsRun.rparts.count {
          check("r:" + SurvivorsRun.rparts[k], 100 + k, { renderPart(k) }) { SvDigest.hex($0) == want[k] }
        }
      }
      if bad.count >= limit && waiting.isEmpty { break }
    }
    return bad
  }
}
