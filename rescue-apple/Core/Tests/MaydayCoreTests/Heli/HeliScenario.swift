// The stub systems of tools/export/export-heli.mjs, rebuilt from a vector's `setup`, and the frame
// runner that replays its recorded inputs / pokes through the real Swift Helicopter + CameraRig.
// Every stub repeats the exporter's arithmetic in the same order (JS.* math) so the traces stay bitwise.
import XCTest
@testable import MaydayCore

// ---- stubs -------------------------------------------------------------------------------------------

/// world: pads (moving / turning / tilting), obstacles, floaters (moving), lighthouse.
final class ScenarioWorld: WorldQuery {
  struct Pad {
    var view: LandingPad
    var yawRate: Double
    var tiltAmp: Double
    var tiltFreq: Double
    var hasObject: Bool
  }

  var padList: [Pad] = []
  var obstacles: [FlightObstacle] = []
  var floaterList: [(item: FlotsamItem, vx: Double, vz: Double)] = []
  var lighthouse: V2?

  init(_ j: JSONValue) throws {
    for (i, p) in (j["pads"].array ?? []).enumerated() {
      var sv: PadServices?
      if p["services"].exists {
        sv = PadServices(fuel: p["services"]["fuel"].double, repair: p["services"]["repair"].double, resupply: p["services"]["resupply"].bool)
      }
      let view = LandingPad(id: PadID(i), type: try p["type"].requireString("pad.type"), position: try XCTUnwrap(p["position"].v3),
                            radius: try p["radius"].requireDouble("radius"), heading: p["heading"].double ?? 0, tilt: 0,
                            velocity: p["velocity"].v3, services: sv, refuel: p["refuel"].bool ?? false)
      padList.append(Pad(view: view, yawRate: p["yawRate"].double ?? 0, tiltAmp: p["tiltAmp"].double ?? 0, tiltFreq: p["tiltFreq"].double ?? 0,
                         hasObject: p["tiltAmp"].exists))
    }
    for o in j["obstacles"].array ?? [] {
      obstacles.append(FlightObstacle(x: try o["x"].requireDouble(), z: try o["z"].requireDouble(), radius: o["radius"].double ?? 2, top: o["top"].double))
    }
    for (i, f) in (j["floaters"].array ?? []).enumerated() {
      floaterList.append((FlotsamItem(source: .floater, id: i, shape: try f["shape"].requireString(), x: try f["x"].requireDouble(),
                                      z: try f["z"].requireDouble(), moored: f["moored"].bool ?? false),
                          f["vx"].double ?? 0, f["vz"].double ?? 0))
    }
    if let lh = j["lighthouse"].doubles { lighthouse = V2(lh[0], lh[1]) }
  }

  var pads: [LandingPad] { padList.map(\.view) }
  var floaters: [FlotsamItem] { floaterList.map(\.item) }
  func pad(_ id: PadID) -> LandingPad? { id.raw >= 0 && id.raw < padList.count ? padList[id.raw].view : nil }

  func padAt(_ x: Double, _ z: Double) -> LandingPad? {
    padList.first { JS.hypot(x - $0.view.position.x, z - $0.view.position.z) < $0.view.radius }?.view
  }

  func nearestPad(_ x: Double, _ z: Double) -> LandingPad? {
    var best: LandingPad?
    var bd = Double.infinity
    for p in padList {
      let d = JS.hypot(p.view.position.x - x, p.view.position.z - z)
      if d < bd {
        bd = d
        best = p.view
      }
    }
    return best
  }

  func advance(_ dt: Double, _ t: Double) {
    for i in padList.indices {
      var p = padList[i]
      if let v = p.view.velocity {
        p.view.position.x += v.x * dt
        p.view.position.y += v.y * dt
        p.view.position.z += v.z * dt
      }
      p.view.heading += p.yawRate * dt
      if p.hasObject {
        p.view.tilt = p.tiltAmp * JS.sin(p.tiltFreq * t)
        // makeRotationX(tilt): column 1 = (0, cos, sin)
        p.view.up = V3(0, JS.cos(p.view.tilt), JS.sin(p.view.tilt))
      }
      padList[i] = p
    }
    for i in floaterList.indices {
      floaterList[i].item.x += floaterList[i].vx * dt
      floaterList[i].item.z += floaterList[i].vz * dt
    }
  }
}

/// survivors: groups drifting linearly; nearestFor = nearest pickable group with d ≤ r.
final class ScenarioSurvivors: SurvivorQuery {
  var list: [SurvivorView] = []
  var boarded: [Int] = []

  init(_ j: JSONValue) throws {
    for g in j.array ?? [] {
      list.append(SurvivorView(id: GroupID(try g["id"].requireInt()), type: try g["type"].requireString(), position: try XCTUnwrap(g["position"].v3),
                               velocity: g["velocity"].v3, height: g["height"].double, remaining: try g["remaining"].requireDouble(),
                               state: g["state"].string ?? "drifting", spotted: g["spotted"].bool ?? false))
      boarded.append(0)
    }
  }

  var groups: [SurvivorView] { list }
  func index(_ id: GroupID) -> Int? { list.firstIndex { $0.id == id } }

  func nearestFor(_ x: Double, _ z: Double, _ r: Double) -> SurvivorView? {
    var best: SurvivorView?
    var bd = Double.infinity
    for s in list {
      if !(s.remaining > 0) || s.state == "rescued" || s.state == "winching" || s.state == "hidden" { continue }
      let d = JS.hypot(s.position.x - x, s.position.z - z)
      if d <= r && d < bd {
        bd = d
        best = s
      }
    }
    return best
  }

  func attachToBasket(_ id: GroupID) { if let i = index(id) { list[i].state = "winching" } }
  func detachFromBasket(_ id: GroupID, slip: BasketSlip?) { if let i = index(id) { list[i].state = "drifting" } }

  func boardOne(_ id: GroupID) -> BoardedPerson? {
    guard let i = index(id) else { return nil }
    list[i].remaining -= 1
    boarded[i] += 1
    list[i].state = list[i].remaining > 0 ? "drifting" : "rescued"
    let n = boarded[i]
    return BoardedPerson(person: PersonID(100 * id.raw + n), name: "Person \(id.raw)-\(n)", age: Double(30 + n),
                         condition: list[i].type == "injured" ? "тяжёлое" : "стабильное")
  }

  func advance(_ dt: Double) {
    for i in list.indices {
      let s = list[i]
      guard s.state != "winching" && s.state != "rescued", let v = s.velocity else { continue }
      list[i].position.x += v.x * dt
      list[i].position.z += v.z * dt
    }
  }
}

/// hazards: downdraft disc, vortices, a rogue lift (time window or poked on / off), debris, imminent window.
final class ScenarioHazards: HazardQuery {
  let def: JSONValue
  var t: Double = 0
  var rogueOn = false
  var vortices: [HazardReadout] = []
  var debrisItems: [(item: FlotsamItem, vx: Double, vz: Double)] = []

  init(_ j: JSONValue) throws {
    def = j
    for (i, v) in (j["vortices"].array ?? []).enumerated() {
      vortices.append(HazardReadout(id: HazardID(i), type: try v["type"].requireString(), position: try XCTUnwrap(v["position"].v3),
                                    core: v["core"].double, stage: v["stage"].double))
    }
    var n = 0
    for (kind, arr) in j["debris"].object?.entries ?? [] {
      for d in arr.array ?? [] {
        debrisItems.append((FlotsamItem(source: .debris, id: n, shape: kind, x: try d["x"].requireDouble(), y: try d["y"].requireDouble(),
                                        z: try d["z"].requireDouble()), d["vx"].double ?? 0, d["vz"].double ?? 0))
        n += 1
      }
    }
  }

  var list: [HazardReadout] { vortices }
  var debris: [FlotsamItem] { debrisItems.map(\.item) }

  func forceAt(_ x: Double, _ z: Double, _ alt: Double) -> V3 {
    let dd = def["downdraft"]
    guard dd.exists, let cx = dd["x"].double, let cz = dd["z"].double, let r = dd["r"].double, let s = dd["s"].double,
          let push = dd["push"].doubles else { return V3() }
    let d = JS.hypot(x - cx, z - cz)
    if d < r {
      let k = 1 - d / r
      return V3(push[0] * k, -s * k, push[1] * k)
    }
    return V3()
  }

  func waveLiftAt(_ x: Double, _ z: Double) -> Double {
    let rg = def["rogue"]
    guard rg.exists, let rx = rg["x"].double, let rz = rg["z"].double, let r = rg["r"].double, let h = rg["h"].double else { return 0 }
    if let t0 = rg["t0"].double, let t1 = rg["t1"].double {
      if t < t0 || t > t1 { return 0 }
    } else if !rogueOn {
      return 0
    }
    let d = JS.hypot(x - rx, z - rz)
    return d < r ? h * (1 - d / r) : 0
  }

  var imminent: ImminentHazard? {
    let im = def["imminent"]
    guard im.exists, let t0 = im["t0"].double, let t1 = im["t1"].double, t >= t0, t <= t1 else { return nil }
    return ImminentHazard(type: im["type"].string ?? "", position: im["position"].v3, eta: im["eta"].double)
  }

  func setDebris(kind: String, i: Int, x: Double, z: Double, vx: Double, vz: Double) {
    var k = 0
    for j in debrisItems.indices where debrisItems[j].item.shape == kind {
      if k == i {
        debrisItems[j].item.x = x
        debrisItems[j].item.z = z
        debrisItems[j].vx = vx
        debrisItems[j].vz = vz
      }
      k += 1
    }
  }

  func advance(_ dt: Double) {
    for j in debrisItems.indices {
      debrisItems[j].item.x += debrisItems[j].vx * dt
      debrisItems[j].item.z += debrisItems[j].vz * dt
    }
  }
}

/// weather: wind = base + amp·(sin(0.3t + 0.002x), cos(0.21t + 0.002z)); state from the inputs.
final class ScenarioWeather: WeatherQuery {
  var base = V2()
  var amp: Double = 0
  var t: Double = 0
  var readout: WeatherReadout?

  init(_ j: JSONValue) {
    if let b = j["wind"]["base"].doubles { base = V2(b[0], b[1]) }
    amp = j["wind"]["amp"].double ?? 0
    var r = WeatherReadout()
    let env = j["env"]
    r.sunDir = env["sunDir"].v3
    r.sunDirShadow = env["sunDirShadow"].v3
    if env["palette"].exists {
      let p = env["palette"]
      func col(_ k: String) -> Color3? { p[k].doubles.map { Color3($0[0], $0[1], $0[2]) } }
      r.palette = HeliPaletteReadout(ambient: col("ambient"), sun: col("sun"), sky: col("sky"), sunIntensity: p["sunIntensity"].double,
                                     ambientIntensity: p["ambientIntensity"].double)
    }
    readout = r
  }

  func windAt(_ x: Double, _ z: Double) -> V2 {
    V2(base.x + amp * JS.sin(0.3 * t + 0.002 * x), base.y + amp * JS.cos(0.21 * t + 0.002 * z))
  }
}

/// ocean = real WaveBank + call recorder (splashes, last downwash / searchlight, glints).
final class ScenarioOcean: OceanQuery {
  let bank: WaveBank
  var frame = 0
  var log: [JSONValue] = []
  var lastDw = [Double](repeating: 0, count: 4)
  var lastSlLevel: Double = 0
  var glints: [[Double]] = []

  init(bank: WaveBank) { self.bank = bank }

  func heightAt(_ x: Double, _ z: Double) -> Double { bank.heightAt(x, z) }
  func normalAt(_ x: Double, _ z: Double) -> V3? { bank.normalAt(x, z) }
  func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) {
    log.append(.array([.number(Double(frame)), .string("splash"), .number(x), .number(z), .number(radius), .number(strength)]))
  }
  func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) { lastDw = [x, z, radius, strength] }
  func setSearchlight(origin: V3, dir: V3, cosOuter: Double, level: Double) { lastSlLevel = level }
  func addGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: Color3) { glints.append([x, z, radius, intensity]) }
  var acceptsGlints: Bool { true }
}

/// fx = call recorder in the exporter's array format.
final class ScenarioFx: FxSink {
  var frame = 0
  var log: [JSONValue] = []

  private func rec(_ name: String, _ items: [JSONValue]) {
    log.append(.array([.number(Double(frame)), .string(name)] + items))
  }

  func spray(_ x: Double, _ z: Double, _ dir: V2, _ count: Double) { rec("spray", [.number(x), .number(z), .number(dir.x), .number(dir.y), .number(count)]) }
  func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ size: Double) { rec("smoke", [.number(x), .number(y), .number(z), .string(color), .number(size)]) }
  func sparks(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ count: Double) { rec("sparks", [.number(x), .number(y), .number(z), .string(color), .number(count)]) }
  func splash(_ x: Double, _ y: Double, _ z: Double, _ size: Double) { rec("splash", [.number(x), .number(y), .number(z), .number(size)]) }
  func flare(_ x: Double, _ z: Double) { rec("flare", [.number(x), .number(z)]) }
  func burstRocket(_ at: V3, color: String) -> Bool {
    rec("burst", [.string("rocket"), .number(at.x), .number(at.y), .number(at.z), .string(color)])
    return true
  }
}

/// mission: def.area.radius, elapsed = game time.
final class ScenarioMission: MissionQuery {
  var areaRadius: Double?
  var elapsed: Double = 0
  init(radius: Double?) { areaRadius = radius }
}

/// input: the recorded frame (move / axes / buttons / wheel / device / mouse / photo-mode controls).
final class ScriptedInput: HeliInput {
  var moveV = (x: 0.0, y: 0.0)
  var axes: [InputAxis: Double] = [:]
  var downSet = Set<InputAction>()
  var pressedSet = Set<InputAction>()
  var wheel: Double = 0
  var lastDevice: InputDevice = .keyboard
  var mouse = MouseState()
  var axesValues: [InputAxis: Double] = [.moveX: 0, .moveY: 0, .lift: 0, .aimX: 0, .aimY: 0]
  var mouseButtons = Set<String>()
  var keys = Set<String>()
  var pad = GamepadSnapshot()
  var gamepads: [GamepadSnapshot?] { [pad] }

  func move() -> (x: Double, y: Double) { moveV }
  func axis(_ name: InputAxis) -> Double { axes[name] ?? 0 }
  func down(_ name: InputAction) -> Bool { downSet.contains(name) }
  func pressed(_ name: InputAction) -> Bool { pressedSet.contains(name) }
  func consumeWheel() -> Double {
    let w = wheel
    wheel = 0
    return w
  }
}

// ---- the runner --------------------------------------------------------------------------------------

/// One heli / camera trace file and the Swift systems replaying it.
final class HeliScenario {
  static let modes: [GameMode] = [.title, .briefing, .play, .paused, .debrief]
  static let devices: [InputDevice] = [.keyboard, .gamepad, .touch]
  static let actions: [InputAction] = [.winch, .boost, .searchlight, .flare, .raftDrop, .horn, .altPreset1, .altPreset2, .altPreset3, .altUp, .altDown, .zoom]

  let vec: VectorFile
  let setup: JSONValue
  let frames: Int
  let every: Int
  let events = EventBus()
  let ctx: SimContext
  let bank = WaveBank()
  let sea: SeaState
  let ocean: ScenarioOcean
  let weather: ScenarioWeather
  let world: ScenarioWorld
  let survivors: ScenarioSurvivors
  let hazards: ScenarioHazards?
  let mission: ScenarioMission?
  let fx = ScenarioFx()
  let input = ScriptedInput()
  let heli: Helicopter
  let rig: CameraRig
  var t: Double = 0
  var realT: Double = 0
  var frame = 0
  var photo = false
  var eventLog: [JSONValue] = []
  /// recorded inputs: [frame][field]
  let inputRows: [[Double]]
  let inputIndex: [String: Int]
  let inputConst: JSONObject
  let realDt: [Double]
  /// pokes by frame
  var pokes: [Int: [JSONValue]] = [:]

  init(_ name: String) throws {
    vec = try VectorLoader.load(name)
    let d = vec.data
    setup = d["setup"]
    frames = try setup["frames"].requireInt("frames")
    every = try setup["every"].requireInt("every")
    sea = SeaState(json: setup["ocean"]["sea"])
    bank.setQuality(8, 300)
    bank.setSeed(303, 0.6)

    var sv: [String: JSONValue] = [:]
    for (k, v) in setup["settings"].object?.entries ?? [] { sv[k] = v }
    let camera = PerspectiveCamera(fov: 40, aspect: 1280.0 / 720.0, near: 2, far: 1200)
    camera.setMainStartPose()
    ctx = SimContext(events: events, settings: StaticSettings(sv, detail: setup["detail"].double ?? 1), camera: camera,
                     randomSeed: try setup["seed"].requireDouble("seed"))
    ctx.fallbackMode = GameMode(rawValue: setup["mode0"].string ?? "play") ?? .play
    ctx.autostart = setup["autostart"].bool ?? false
    ctx.cloudAt = { x, z in 0.5 + 0.5 * JS.sin(x * 0.01) * JS.cos(z * 0.013) }
    ctx.viewportWidth = 1280
    ctx.viewportHeight = 720
    ocean = ScenarioOcean(bank: bank)
    weather = ScenarioWeather(setup["weather"])
    world = try ScenarioWorld(setup["world"])
    survivors = try ScenarioSurvivors(setup["survivors"])
    hazards = setup["hazards"].exists ? try ScenarioHazards(setup["hazards"]) : nil
    mission = setup["mission"].exists ? ScenarioMission(radius: setup["mission"]["radius"].double) : nil
    ctx.ocean = ocean
    ctx.weather = weather
    ctx.world = world
    ctx.survivors = survivors
    ctx.hazards = hazards
    ctx.mission = mission
    ctx.fx = fx
    ctx.input = input

    // recorded inputs
    let fields = try XCTUnwrap(d["inputFields"].strings)
    inputIndex = Dictionary(uniqueKeysWithValues: fields.enumerated().map { ($1, $0) })
    inputConst = d["inputConst"].object ?? JSONObject()
    let flat = try vec.sidecarF32(d["inputs"]).map(Double.init)
    inputRows = stride(from: 0, to: flat.count, by: max(1, fields.count)).map { Array(flat[$0..<min(flat.count, $0 + fields.count)]) }
    realDt = try vec.sidecarF64(d["realDt"])
    for p in d["pokes"].array ?? [] {
      let f = try p[0].requireInt("poke frame")
      pokes[f, default: []].append(p[1])
    }

    heli = Helicopter(ctx: ctx)
    ctx.heli = heli
    rig = CameraRig(ctx: ctx)
    ctx.cameraRig = rig
    ctx.photoActive = { [unowned self] in self.photo }
    ctx.nowMs = { [unowned self] in self.realT * 1000 }
    events.onEmit = { [unowned self] e in self.eventLog.append(HeliScenario.eventJSON(e, frame: self.frame)) }
  }

  /// One recorded input field of the current frame (constants come from inputConst).
  func inp(_ name: String) -> Double {
    if let i = inputIndex[name] { return inputRows[frame - 1][i] }
    return inputConst[name]?.double ?? 0
  }

  func applyPoke(_ pk: JSONValue) throws {
    switch try pk["op"].requireString("op") {
    case "emit":
      let p = pk["payload"]
      switch try pk["name"].requireString() {
      case "mission:setup": events.emit(GameEvent.MissionSetup(def: p["def"]))
      case "mission:start": events.emit(GameEvent.MissionStart(def: p["def"]))
      case "mission:chapter": events.emit(GameEvent.MissionChapter(n: try p["n"].requireInt(), text: p["text"].string ?? "", title: p["title"].string ?? ""))
      case "survivor:signal":
        events.emit(GameEvent.SurvivorSignal(s: GroupID(try p["s"].requireInt()), kind: p["kind"].string ?? "", x: try p["x"].requireDouble(),
                                             z: try p["z"].requireDouble(), error: p["error"].double ?? 0))
      case "weather:gust":
        let dir = try p["dir"].requireDoubles()
        events.emit(GameEvent.WeatherGust(dir: V2(dir[0], dir[1]), strength: try p["strength"].requireDouble(), eta: try p["eta"].requireDouble(),
                                          x: try p["x"].requireDouble(), z: try p["z"].requireDouble(), harmless: p["harmless"].bool ?? false))
      case "weather:lightning":
        events.emit(GameEvent.WeatherLightning(x: try p["x"].requireDouble(), z: try p["z"].requireDouble(), distance: try p["distance"].requireDouble(),
                                               strength: try p["strength"].requireDouble(), cloudOnly: p["cloudOnly"].bool ?? false))
      case "hazard:warning": events.emit(GameEvent.HazardWarning(type: try p["type"].requireString(), text: p["text"].string ?? ""))
      case let n: XCTFail("unknown poke event \(n)")
      }
    case "mode":
      let to = try XCTUnwrap(GameMode(rawValue: try pk["to"].requireString()))
      let from = ctx.mode
      ctx.fallbackMode = to
      events.emit(GameEvent.GameMode(from: from, to: to))
    case "damage": heli.damage(try pk["amount"].requireDouble(), DamageSource(try pk["source"].requireString()))
    case "fuel": heli.fuel = try pk["value"].requireDouble()
    case "impulse":
      let v = try pk["v"].requireDoubles()
      heli.applyImpulse(V3(v[0], v[1], v[2]))
    case "autoTakeoff": heli.autoTakeoff(try pk["alt"].requireDouble())
    case "capacity": heli.capacity = try pk["value"].requireInt()
    case "shake": rig.shake(try pk["strength"].requireDouble(), try pk["duration"].requireDouble())
    case "punch": rig.punch(try pk["delta"].requireDouble(), try pk["duration"].requireDouble())
    case "focus":
      let p = try pk["position"].requireDoubles()
      rig.focus(V3(p[0], p[1], p[2]), try pk["duration"].requireDouble())
    case "slowMo": rig.slowMo(try pk["scale"].requireDouble(), try pk["duration"].requireDouble(), pk["key"].string)
    case "rigMode": rig.setMode(try XCTUnwrap(CameraRig.Mode(rawValue: try pk["mode"].requireString())))
    case "rogue": hazards?.rogueOn = pk["on"].bool ?? false
    case "debris":
      hazards?.setDebris(kind: try pk["kind"].requireString(), i: try pk["i"].requireInt(), x: try pk["x"].requireDouble(), z: try pk["z"].requireDouble(),
                         vx: try pk["vx"].requireDouble(), vz: try pk["vz"].requireDouble())
    case let op: XCTFail("unknown poke \(op)")
    }
  }

  /// One frame exactly like the exporter's loop.
  func step() throws {
    frame += 1
    ocean.frame = frame
    fx.frame = frame
    let rdt = realDt[frame - 1]
    for pk in pokes[frame] ?? [] { try applyPoke(pk) }
    let dt = ctx.mode == .paused ? 0 : rdt * ctx.timeScale
    t += dt
    realT += rdt
    mission?.elapsed = t
    world.advance(dt, t)
    survivors.advance(dt)
    hazards?.t = t
    hazards?.advance(dt)
    weather.t = t
    weather.readout?.turbulence = inp("turbulence")
    weather.readout?.rain = inp("rain")
    weather.readout?.fog = inp("fog")
    weather.readout?.intensity = inp("intensity")
    weather.readout?.night = inp("night")
    weather.readout?.flash = inp("flash")
    weather.readout?.stElmo = inp("stElmo")
    bank.update(dt, t, sea, 0.6, 1, 0, 0)

    // input
    input.moveV = (inp("moveX"), inp("moveY"))
    input.axes = [.lift: inp("lift"), .aimX: inp("aimX"), .aimY: inp("aimY")]
    let down = Int(inp("down")), pressed = Int(inp("pressed"))
    input.downSet = Set(HeliScenario.actions.enumerated().filter { down & (1 << $0.offset) != 0 }.map(\.element))
    input.pressedSet = Set(HeliScenario.actions.enumerated().filter { pressed & (1 << $0.offset) != 0 }.map(\.element))
    input.wheel = inp("wheel")
    input.lastDevice = HeliScenario.devices[Int(inp("device"))]
    if inp("mouseActive") != 0 {
      input.mouse.active = true
      input.mouse.ndcX = inp("mouseNdcX")
      input.mouse.ndcY = inp("mouseNdcY")
      input.mouse.x = (input.mouse.ndcX + 1) * 640
      input.mouse.y = (1 - input.mouse.ndcY) * 360
      if inp("mouseMoved") != 0 { input.mouse.lastMoveT = realT * 1000 }
    }
    photo = inp("photo") != 0
    let pw = inp("photoWheel")
    if pw != 0 { rig.freecam.wheel(deltaY: pw) }
    let mb = Int(inp("mouseButtons"))
    input.mouseButtons = Set((mb & 1 != 0 ? ["Mouse0"] : []) + (mb & 2 != 0 ? ["Mouse2"] : []))
    input.keys = inp("shift") != 0 ? ["ShiftLeft"] : []
    input.pad.buttons[4].pressed = inp("padLB") != 0
    input.pad.buttons[5].pressed = inp("padRB") != 0
    input.axesValues = [.moveX: inp("axMoveX"), .moveY: inp("axMoveY"), .lift: inp("axLift"), .aimX: inp("axAimX"), .aimY: inp("axAimY")]

    ocean.glints.removeAll()
    heli.update(dt)
    rig.update(rdt)
  }

  // ---- event payloads as the exporter logs them -----------------------------------------------------
  static func value(_ any: Any) -> JSONValue {
    switch any {
    case let d as Double: return .number(d)
    case let i as Int: return .number(Double(i))
    case let b as Bool: return .bool(b)
    case let s as String: return .string(s)
    case let v as V2: return .array([.number(v.x), .number(v.y)])
    case let v as V3: return .array([.number(v.x), .number(v.y), .number(v.z)])
    case let id as GroupID: return .number(Double(id.raw))
    case let id as PadID: return .number(Double(id.raw))
    case let id as PersonID: return .number(Double(id.raw))
    case let id as HazardID: return .number(Double(id.raw))
    case let m as MaydayCore.GameMode: return .string(m.rawValue)
    case let a as [PersonID]: return .array(a.map { .number(Double($0.raw)) })
    case is JSONValue: return .string("<def>")
    default:
      let m = Mirror(reflecting: any)
      if m.displayStyle == .optional { return m.children.first.map { value($0.value) } ?? .null }
      return .string("<\(type(of: any))>")
    }
  }

  static func eventJSON(_ e: GameEvent, frame: Int) -> JSONValue {
    var o = JSONObject()
    for c in Mirror(reflecting: e.payload).children {
      guard let label = c.label else { continue }
      let v = value(c.value)
      if case .null = v { continue }
      o.set(label, v)
    }
    return .array([.number(Double(frame)), .string(e.name.rawValue), .object(o)])
  }
}

// ---- comparison helpers --------------------------------------------------------------------------------

/// Two JSON values equal the exporter's way: numbers bitwise ("NaN" strings included), objects by key
/// (a missing key equals null), arrays element-wise.
func jsonEqualBitwise(_ a: JSONValue, _ b: JSONValue) -> Bool {
  switch (a, b) {
  case (.string(let x), .string(let y)):
    return x == y
  case (.array(let x), .array(let y)):
    return x.count == y.count && zip(x, y).allSatisfy { jsonEqualBitwise($0, $1) }
  case (.object(let x), .object(let y)):
    let keys = Set(x.keys).union(y.keys)
    return keys.allSatisfy { jsonEqualBitwise(x[$0] ?? .null, y[$0] ?? .null) }
  default:
    if let x = a.double, let y = b.double { return Bits.equal(x, y) }
    return a == b
  }
}
