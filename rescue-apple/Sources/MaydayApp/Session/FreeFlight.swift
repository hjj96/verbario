// Free flight — what the web runs when the world and mission modules are absent (rescue/src/core/stubs.js:
// "Without a real mission system: jump straight into free flight"), as the M3 stand-ins until
// MaydayCore/World and MaydayCore/Mission are ported (PLAN §2.3 «Стабы», §7 M3 → M4):
//
//   FreeFlightWorld   = stubs.js World: on mission:setup one pad per def.world.pads entry (default: a ship
//                       pad at the origin), deck 4 m above the sea, radius 12, refuel, heading 0, a grey
//                       cylinder 12 × 4 m as its object (SceneProps draws it); padAt / nearestPad.
//   FreeFlightMission = stubs.js Mission (its «Свободный полёт» def, start → briefing, launch → play) plus
//                       the run-state rules of systems/mission.js the flight needs: gameplay input only
//                       while flying (update / _setMode), Esc / Start → pause and the rAF pause poll that
//                       resumes on the next pause press (_updatePlay, pause, resume, _startPausePoll),
//                       ui:pause / ui:resume, heli:crash → 'crash' and CRASH_TO_DEBRIEF_S later a fresh
//                       start (where the web opens the debrief screen; PLAN §10 X16).
// Both are checked against the web: Tests/Vectors/app/session_*.json records the stub World's pads and the
// stub Mission's def as the web builds them (tools/export/export-app.mjs, harness `session` check).
import Foundation
import MaydayCore

/// stubs.js World.
final class FreeFlightWorld: WorldQuery, GameSystem {
  /// One pad and the stub's cylinder (object3d at (x, 2, z), CylinderGeometry(12, 12, 4, 24), #555555).
  struct Pad {
    var view: LandingPad
    var name: String
    /// object3d.position (the cylinder's centre)
    var objectPosition: V3
  }

  static let padRadius: Double = 12
  static let deckY: Double = 4
  static let objectY: Double = 2
  static let objectHeight: Double = 4
  static let objectColorHex: Double = 0x555555

  private(set) var padList: [Pad] = []
  private var subscription: EventSubscription?

  init(events: EventBus) {
    subscription = events.on(GameEvent.MissionSetup.self) { [weak self] e in self?.setup(e.def) }
  }

  deinit { subscription?.off() }

  /// _setup(def): `def.world?.pads || [{ type: 'ship', x: 0, z: 0, name: 'Судно' }]`.
  func setup(_ def: JSONValue) {
    let given = def["world"]["pads"]
    let list: [JSONValue] = given.jsTruthy ? (given.array ?? []) : [FreeFlightWorld.defaultPad]
    padList = list.enumerated().map { i, p in
      let x = p["x"].jsToNumber
      let z = p["z"].jsToNumber
      let type = p["type"].jsTruthy ? (p["type"].string ?? p["type"].jsToString) : "ship"
      let name = p["name"].jsTruthy ? (p["name"].string ?? p["name"].jsToString) : "Площадка"
      // the object3d's matrixWorld has no rotation: its column 1 (the deck's up) is +Y
      let view = LandingPad(id: PadID(i), type: type, position: V3(x, FreeFlightWorld.deckY, z), radius: FreeFlightWorld.padRadius,
                            heading: 0, tilt: 0, velocity: nil, services: nil, refuel: true, up: V3(0, 1, 0))
      return Pad(view: view, name: name, objectPosition: V3(x, FreeFlightWorld.objectY, z))
    }
  }

  static let defaultPad: JSONValue = {
    var o = JSONObject()
    o.set("type", .string("ship"))
    o.set("x", .number(0))
    o.set("z", .number(0))
    o.set("name", .string("Судно"))
    return .object(o)
  }()

  // ---- WorldQuery -------------------------------------------------------------------------------------
  var pads: [LandingPad] { padList.map(\.view) }

  func pad(_ id: PadID) -> LandingPad? { id.raw >= 0 && id.raw < padList.count ? padList[id.raw].view : nil }

  /// pads.find((p) => Math.hypot(p.position.x − x, p.position.z − z) < p.radius) || null
  func padAt(_ x: Double, _ z: Double) -> LandingPad? {
    padList.first { JS.hypot($0.view.position.x - x, $0.view.position.z - z) < $0.view.radius }?.view
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

  /// The stub's update() does nothing (pads never move).
  func update(_ dt: Double) {}
}

/// stubs.js Mission + the mission.js run-state rules of a flight.
final class FreeFlightMission: GameSystem, MissionQuery {
  /// mission.state
  enum State: String {
    case idle, briefing, play, crash
  }

  /// stubs.js Mission.start(): the «Свободный полёт» definition, verbatim.
  static let stubDef: JSONValue = {
    let src = """
    {"id":"stub","index":0,"title":"Свободный полёт","brief":"","seed":1,"area":{"radius":1500},"timeOfDay":0.4,\
    "weather":{"start":"calm","script":[]},"world":{"pads":[{"type":"ship","x":0,"z":0,"name":"Судно"}],"props":{}},\
    "heli":{"pad":0},"survivors":[],"hazards":[],"objectives":{"rescue":0,"timeLimit":0}}
    """
    // a literal of this file: a parse failure is a programming error caught by the harness
    return (try? JSONValue.parse(src)) ?? .null
  }()

  let def: JSONValue
  private(set) var state: State = .idle
  /// mission.elapsed (game seconds of flight)
  private(set) var elapsed: Double = 0
  /// Seconds since heli:crash (mission._crashT, real time).
  private(set) var crashT: Double = 0
  /// mission.json CRASH_TO_DEBRIEF_S: crash → (debrief in the web) restart here.
  let crashToRestart: Double
  /// The pause poll is armed (mission._pollRAF).
  private(set) var pausePolling = false
  /// Starts so far (1 after boot; +1 per restart).
  private(set) var runs = 0

  private unowned let loop: GameLoop
  private unowned let input: InputState
  private unowned let events: EventBus
  private weak var rig: CameraRig?
  private var pausedFrame = -1
  private var subscriptions: [EventSubscription] = []

  init(def: JSONValue = FreeFlightMission.stubDef, loop: GameLoop, input: InputState, events: EventBus, crashToRestart: Double) {
    self.def = def
    self.loop = loop
    self.input = input
    self.events = events
    self.crashToRestart = crashToRestart
    // mission.js _wire(): the HUD's pause / resume, the crash (only while flying)
    subscriptions.append(events.on(GameEvent.UiPause.self) { [weak self] _ in self?.pause() })
    subscriptions.append(events.on(GameEvent.UiResume.self) { [weak self] _ in self?.resume() })
    subscriptions.append(events.on(GameEvent.HeliCrash.self) { [weak self] _ in
      guard let self, self.state == .play else { return }
      self.state = .crash
      self.crashT = 0
      self.input.enabled = false
    })
  }

  deinit { for s in subscriptions { s.off() } }

  /// ctx.cameraRig (mission._setMode points the rig at the mode's framing).
  func attach(rig: CameraRig) { self.rig = rig }

  // ---- MissionQuery -------------------------------------------------------------------------------------
  /// def.area.radius
  var areaRadius: Double? { def["area"]["radius"].double }

  // ---- flow -----------------------------------------------------------------------------------------------
  /// stubs.js Mission.init(): start(0), launch().
  func boot() {
    begin()
    launch()
  }

  /// start(): mission:setup with the def, briefing.
  func begin() {
    stopPausePoll()
    state = .briefing
    elapsed = 0
    crashT = 0
    runs += 1
    events.emit(GameEvent.MissionSetup(def: def))
    setMode(.briefing)
  }

  /// launch(): briefing → play (the stub emits no mission:start: free flight has no opening bars or script).
  func launch() {
    if state != .briefing { return }
    elapsed = 0
    state = .play
    setMode(.play)
  }

  /// _setMode(mode): ctx.setMode, gameplay input only while flying, the rig framing of the mode.
  private func setMode(_ mode: GameMode) {
    loop.setMode(mode)
    input.enabled = mode == .play && state == .play
    let cam: CameraRig.Mode? = mode == .play ? .follow : mode == .debrief ? .cinematic : mode == .paused ? nil : .attract
    if let cam, let rig, rig.mode != cam { rig.setMode(cam) }
  }

  /// pause(): only from flight.
  func pause() {
    guard loop.mode == .play, state == .play else { return }
    pausedFrame = loop.time.frame
    setMode(.paused)
    pausePolling = true
  }

  /// resume(): not in the frame whose key press paused (Esc is also 'back').
  func resume() {
    guard loop.mode == .paused else { return }
    if loop.time.frame == pausedFrame { return }
    stopPausePoll()
    setMode(.play)
  }

  private func stopPausePoll() { pausePolling = false }

  /// The pause poll's rAF tick: the host calls it once per display frame BEFORE the loop's frame (a rAF
  /// callback registered during frame N runs ahead of the main loop's own callback in frame N + 1).
  /// input.rawPressed still reflects the previous poll and works while input.enabled is false.
  func pollWhilePaused() {
    guard pausePolling else { return }
    pausePolling = false
    if loop.mode != .paused { return }
    if input.rawPressed(.pause) { resume() }
    if loop.mode == .paused { pausePolling = true }
  }

  // ---- GameSystem -------------------------------------------------------------------------------------
  /// update(dt): the play / crash branches of mission.js update, then `input.enabled = flying`.
  func update(_ dt: Double) {
    let realDt = loop.time.realDt
    if loop.mode == .play {
      if state == .play {
        updatePlay(dt)
      } else if state == .crash {
        crashT += realDt
        if crashT >= crashToRestart {
          begin()
          launch()
        }
      }
    }
    let want = loop.mode == .play && state == .play
    if input.enabled != want { input.enabled = want }
  }

  /// _updatePlay(dt): Esc / Start → pause; the flight clock.
  private func updatePlay(_ dt: Double) {
    if input.rawPressed(.pause) {
      pause()
      return
    }
    if !(dt > 0) { return }
    elapsed += dt
  }

  /// A new run of the same flight (debug «заново», or after the crash delay).
  func restart() {
    begin()
    launch()
  }
}
