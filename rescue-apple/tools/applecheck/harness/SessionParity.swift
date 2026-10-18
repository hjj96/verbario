// SessionParity — replays Tests/Vectors/app/*.json (tools/export/export-app.mjs) through the app layer:
//   session_flight.json  the web's boot + frame loop over the real systems with the real Input: the same DOM
//                        events become the InputState calls the app's adapters make (MetalView / GamepadAdapter /
//                        TouchControlsView), the pokes call the same system APIs, and GameSession steps with the
//                        recorded realDt. Every probe value bitwise, every event name and rumble request equal.
//                        Also: the stub World's pads and the stub Mission's def as the web built them.
//   touch.json           touch.js TouchControls: the virtual axes bitwise, knob / thumb offsets by value (the web
//                        writes them through CSS strings, which drop −0).
import Foundation
import MaydayCore

enum SessionParity {
  static func vectorsDirectory(bundlePath: String) -> URL {
    let args = CommandLine.arguments
    if args.count > 2 { return URL(fileURLWithPath: args[2], isDirectory: true) }
    return URL(fileURLWithPath: bundlePath).appendingPathComponent("../../Tests/Vectors", isDirectory: true)
  }

  private static var failures = 0
  private static func fail(_ msg: String) {
    failures += 1
    if failures <= 40 { print("FAIL:", msg) }
  }

  /// Little-endian Float64 sidecar next to the vector.
  static func f64(_ dir: URL, _ ref: JSONValue) throws -> [Double] {
    guard let file = ref["file"].string else { throw JSONError("sidecar reference without file") }
    let data = try Data(contentsOf: dir.appendingPathComponent(file))
    var out = [Double](repeating: 0, count: data.count / 8)
    data.withUnsafeBytes { raw in
      for i in out.indices { out[i] = Double(bitPattern: UInt64(littleEndian: raw.loadUnaligned(fromByteOffset: i * 8, as: UInt64.self))) }
    }
    return out
  }

  static func same(_ a: Double, _ b: Double) -> Bool { a.bitPattern == b.bitPattern || (a.isNaN && b.isNaN) }

  /// Returns the number of failures.
  static func run(catalog: DataCatalog, vectors: URL) throws -> Int {
    failures = 0
    let dir = vectors.appendingPathComponent("app", isDirectory: true)
    try session(catalog: catalog, dir: dir)
    try touch(dir: dir)
    print("session parity: \(failures == 0 ? "ok" : "\(failures) failures")")
    return failures
  }

  // ---- session ---------------------------------------------------------------------------------------------
  static func session(catalog: DataCatalog, dir: URL) throws {
    let v = try JSONValue.load(contentsOf: dir.appendingPathComponent("session_flight.json"))["data"]
    let setup = v["setup"]
    let frames = try v["frames"].requireInt("frames")
    let fields = v["probeFields"].strings ?? []
    let probe = try f64(dir, v["probe"])
    let realDt = try f64(dir, v["realDt"])
    let padRows = try f64(dir, v["pad"])
    guard probe.count == frames * fields.count, realDt.count == frames else { fail("session: sidecar sizes"); return }

    // the stub Mission's def and the stub World's pads, as the web built them
    if FreeFlightMission.stubDef != setup["def"] { fail("session: FreeFlightMission.stubDef differs from stubs.js Mission.start()") }

    var log: [(Int, String)] = []
    var opt = SessionOptions()
    opt.randomSeed = try setup["seed"].requireDouble("seed")
    let vp = try setup["viewport"].requireDoubles("viewport")
    opt.viewportWidth = vp[0]
    opt.viewportHeight = vp[1]
    var sessionRef: GameSession?
    opt.eventTap = { e in log.append((sessionRef?.loop.time.frame ?? 0, e.name.rawValue)) }
    let s = try GameSession(catalog: catalog, storage: MemoryStorage(), options: opt)
    sessionRef = s

    let pads = setup["pads"].array ?? []
    if pads.count != s.world.padList.count { fail("session: \(s.world.padList.count) pads, web \(pads.count)") }
    for (p, w) in zip(s.world.padList, pads) {
      let pos = w["position"].doubles ?? [], obj = w["object"].doubles ?? []
      let ok = p.view.id.raw == w["id"].int && p.name == w["name"].string && p.view.type == w["type"].string
        && [p.view.position.x, p.view.position.y, p.view.position.z] == pos && p.view.radius == w["radius"].double
        && p.view.refuel == w["refuel"].bool && p.view.heading == w["heading"].double
        && [p.objectPosition.x, p.objectPosition.y, p.objectPosition.z] == obj
      if !ok { fail("session: pad \(p.view.id.raw) \(p.view) vs web \(w)") }
    }
    for (k, val) in setup["settings"].object?.entries ?? [] where s.settings.get(k) != val {
      fail("session: setting \(k) = \(s.settings.get(k)), web \(val)")
    }

    // pads by frame (W3C snapshot: 17 values, 17 pressed, 4 axes)
    var padAt: [Int: GamepadSnapshot] = [:]
    let stride = 1 + 17 + 17 + 4
    for r in Swift.stride(from: 0, to: padRows.count - stride + 1, by: stride) {
      var p = GamepadSnapshot(connected: true, hasVibration: true)
      for i in 0..<17 { p.buttons[i] = GamepadSnapshot.Button(pressed: padRows[r + 18 + i] != 0, value: padRows[r + 1 + i]) }
      p.axes = Array(padRows[(r + 35)..<(r + 39)])
      padAt[Int(padRows[r])] = p
    }
    var pad: GamepadSnapshot?
    s.gamepads = { pad.map { [$0] } ?? [] }
    var rumbles: [[Double]] = []
    s.input.rumbleSink = { e in rumbles.append([Double(s.loop.time.frame), e.duration, e.strongMagnitude, e.weakMagnitude]) }

    var actions: [Int: [JSONValue]] = [:]
    for a in v["actions"].array ?? [] { actions[a[0].int ?? -1, default: []].append(a) }
    let presets = s.weather.presets
    let n = fields.count
    var firstBad: Int?
    for f in 1...frames {
      for a in actions[f] ?? [] { try apply(a, s) }
      pad = padAt[f]
      s.step(frameDelta: realDt[f - 1])
      s.lateUpload()
      let row = probeRow(s, presets: presets)
      if row.count != n { fail("session: probe has \(row.count) fields, web \(n)"); return }
      for i in 0..<n where !same(row[i], probe[(f - 1) * n + i]) {
        if firstBad == nil { firstBad = f }
        fail("session frame \(f): \(fields[i]) = \(row[i]), web \(probe[(f - 1) * n + i])")
        break
      }
      if firstBad != nil && f > firstBad! + 2 { break }
    }

    // events and rumbles
    let webEvents = (v["events"].array ?? []).map { ($0[0].int ?? -1, $0[1].string ?? "") }
    if firstBad == nil {
      if webEvents.count != log.count || !zip(webEvents, log).allSatisfy({ $0.0 == $1.0 && $0.1 == $1.1 }) {
        let i = (0..<min(webEvents.count, log.count)).first { webEvents[$0].0 != log[$0].0 || webEvents[$0].1 != log[$0].1 } ?? min(webEvents.count, log.count)
        fail("session events: \(log.count) vs web \(webEvents.count), first difference at \(i): " +
             "\(i < log.count ? "\(log[i])" : "—") vs \(i < webEvents.count ? "\(webEvents[i])" : "—")")
      }
      let webRumbles = (v["rumbles"].array ?? []).map { r in [r[0].double ?? .nan, r[2].double ?? .nan, r[3].double ?? .nan, r[4].double ?? .nan] }
      if webRumbles.count != rumbles.count || !zip(webRumbles, rumbles).allSatisfy({ zip($0, $1).allSatisfy { same($0, $1) } }) {
        fail("session rumbles \(rumbles) vs web \(webRumbles)")
      }
      print("session_flight: \(frames) frames × \(n) fields bitwise, \(log.count) events, \(rumbles.count) rumbles")
    }
  }

  /// One recorded DOM event / poke, as the app's adapters and the debug tools deliver it.
  static func apply(_ a: JSONValue, _ s: GameSession) throws {
    let kind = a[1].string ?? ""
    let input = s.input
    switch kind {
    case "key":
      let code = a[2].string ?? ""
      if a[3].int == 1 { input.keyDown(code, isRepeat: a[4].int == 1) } else { input.keyUp(code) }
    case "mouse":
      input.mouseMove(x: a[2].double ?? .nan, y: a[3].double ?? .nan, viewWidth: s.ctx.viewportWidth, viewHeight: s.ctx.viewportHeight,
                      nowMs: s.clockMs)
    case "button":
      let b = a[2].int ?? 0
      if a[3].int == 1 { input.mouseDown(button: b, onGameView: true, nowMs: s.clockMs) } else { input.mouseUp(button: b) }
    case "wheel": input.wheel(deltaY: a[2].double ?? .nan)
    case "blur": input.blur()
    case "touch": input.touchStart()
    case "vaxis":
      guard let ax = InputAxis(rawValue: a[2].string ?? "") else { throw JSONError("vaxis \(a)") }
      input.setVirtualAxis(ax, a[3].double ?? .nan)
    case "vbutton":
      guard let b = InputAction(rawValue: a[2].string ?? "") else { throw JSONError("vbutton \(a)") }
      input.setVirtualButton(b, a[3].int == 1)
    case "uiPause": s.events.emit(GameEvent.UiPause())
    case "preset": s.weather.setPreset(a[2].string ?? "", over: a[3].double ?? .nan)
    case "gust": s.weather.spawnGust(GustFronts.SpawnOptions(strength: a[2].double ?? .nan, eta: a[3].double ?? .nan))
    case "strike": s.weather.strikeLightning(a[2].double ?? .nan, a[3].double ?? .nan)
    case "damage": s.heli.damage(a[2].double ?? .nan, DamageSource(a[3].string ?? ""))
    default: throw JSONError("unknown session action \(kind)")
    }
  }

  /// export-app.mjs PROBE, same order.
  static func probeRow(_ s: GameSession, presets: [String]) -> [Double] {
    let h = s.heli, c = s.camera, rig = s.rig, w = s.weather.state, u = s.ocean.uniforms, inp = s.input
    func b(_ x: Bool) -> Double { x ? 1 : 0 }
    var r: [Double] = []
    r += [Double(GameMode.allCases.firstIndex(of: s.loop.mode) ?? -1), s.loop.time.t, s.loop.time.realT, s.loop.timeScale]
    r += [h.position.x, h.position.y, h.position.z, h.velocity.x, h.velocity.y, h.velocity.z]
    r += [h.heading, h.altitude, h.altTarget, h.fuel, h.hull, h.rotorRPM, h.bank, h.pitch]
    r += [Double(h.landed?.raw ?? -1), b(h.alive), b(h.searchlight), b(h.boosting), Double(h.flares), Double(h.rafts)]
    let winch: [WinchState] = [.stowed, .lowering, .down, .raising]
    r += [Double(winch.firstIndex(of: h.winch.state) ?? -1), h.winch.length, h.aim.x, h.aim.y, h.aim.z]
    r += [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov]
    let modes: [CameraRig.Mode] = [.follow, .attract, .cinematic]
    r += [rig.height, rig.tiltDeg, rig.letterbox, rig.zoom, Double(modes.firstIndex(of: rig.mode) ?? -1)]
    r += [w.windSpeed, w.windDir.x, w.windDir.y, s.weather.clock, w.flash, Double(presets.firstIndex(of: w.preset) ?? -1),
          w.sunDir.x, w.sunDir.y, w.sunDir.z]
    r += [u.uOffset.x, u.uOffset.y, u.uHsEff, s.ocean.focus.x, s.ocean.focus.y]
    r += [u.uHeliP.x, u.uHeliP.y, u.uHeliP.z, u.uHeliP.w, u.uDownwash.x, u.uDownwash.y, u.uDownwash.z, u.uDownwash.w, u.uSearchI,
          Double(u.uSplashCount)]
    r += [s.look.windOffset.x, s.look.windOffset.y, s.look.time]
    let ax = inp.axesValues
    r += [ax[.moveX] ?? 0, ax[.moveY] ?? 0, ax[.lift] ?? 0, ax[.aimX] ?? 0, ax[.aimY] ?? 0]
    let devices: [InputDevice] = [.keyboard, .gamepad, .touch]
    let states: [FreeFlightMission.State] = [.idle, .briefing, .play, .crash]
    r += [Double(devices.firstIndex(of: inp.lastDevice) ?? -1), b(inp.enabled), Double(states.firstIndex(of: s.mission.state) ?? -1),
          s.mission.elapsed]
    return r
  }

  // ---- touch ------------------------------------------------------------------------------------------------
  static func touch(dir: URL) throws {
    let v = try JSONValue.load(contentsOf: dir.appendingPathComponent("touch.json"))["data"]
    if v["stickRadius"].double != TouchMapping.stickRadius { fail("touch: STICK_R \(v["stickRadius"])") }
    let top = try v["slider"]["top"].requireDouble("slider.top"), height = try v["slider"]["height"].requireDouble("slider.height")
    var origin = (0.0, 0.0)
    var axes = (moveX: 0.0, moveY: 0.0, lift: 0.0)
    var stickID = -1, sliderID = -1
    var checked = 0
    for step in v["steps"].array ?? [] {
      let what = step[0].string ?? ""
      let t = step[1][0]
      let id = t[0].int ?? -1, x = t[1].double ?? .nan, y = t[2].double ?? .nan
      var knob: [Double] = [], thumb: [Double]? = nil
      switch what {
      case "stickStart":
        stickID = id
        origin = (x, y)
      case "stickMove" where id == stickID:
        let m = TouchMapping.stick(dx: x - origin.0, dy: y - origin.1)
        axes.moveX = m.moveX
        axes.moveY = m.moveY
        knob = [m.knobX, m.knobY]
      case "stickEnd" where id == stickID:
        stickID = -1
        axes.moveX = 0
        axes.moveY = 0
      case "sliderStart", "sliderMove":
        if what == "sliderStart" { sliderID = id }
        if id == sliderID {
          let m = TouchMapping.slider(y: y, top: top, height: height)
          axes.lift = m.lift
          thumb = [m.thumbY]
        }
      case "sliderEnd":
        sliderID = -1
        axes.lift = 0
        thumb = []
      default:
        break
      }
      let wa = step[2].doubles ?? []
      if wa.count != 3 || !same(wa[0], axes.moveX) || !same(wa[1], axes.moveY) || !same(wa[2], axes.lift) {
        fail("touch \(what) \(t): axes (\(axes.moveX), \(axes.moveY), \(axes.lift)), web \(wa)")
      }
      let wk = step[3].doubles ?? []
      if !knob.isEmpty && wk != knob { fail("touch \(what): knob \(knob), web \(wk)") }
      if let th = thumb, (step[4].doubles ?? []) != th { fail("touch \(what): thumb \(th), web \(step[4])") }
      checked += 1
    }
    print("touch: \(checked) steps")
  }
}
