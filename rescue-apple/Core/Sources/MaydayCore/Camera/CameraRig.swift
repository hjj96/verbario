// systems/camera.js CameraRig — the "documentary escort drone" (CONTRACT: cameraRig; DESIGN §2.2, §2.15,
// §7.2, §7.7).
//
// follow    : H = clamp(110 + alt + 1.2·speed, 105, 230) + 15·intensity, winch 95 m, hazard reveal +50 m
//             (≤ 280), zoom ×1 / ×0.8 / ×1.25 (Z); tilt 14° calm → 18° storm, 26° reveal, 10° winch;
//             focus spring ω 4 with look-ahead velocity·0.7 s ≤ 25 m (→ 0 while winching), the heli held
//             at ~55 % screen height; tilt spring ζ 0.75. Every driver goes through a spring.
// attract   : title — slow drift at 300 m around the parked heli, thin letterbox.
// cinematic : debrief — rise to 400 m, full letterbox.
// + handheld drift, trauma shake (event-driven), FOV punches, ≤ 1-per-mission slow-mo moments (ctx.timeScale),
//   letterbox 0..1 animated over 0.8 s (post / HUD draw the bars). Never shows the horizon.
// photo     : while ctx.photoActive() a free camera (FreeCam) starts from the current framing; follow
//             springs, timers and slow-mo are frozen and the rig snaps back to the follow framing on exit.
//
// Runs on realDt (RUN_WHEN_PAUSED). Places ctx.camera (PerspectiveCamera, GL conventions); same
// expression order as the JS (Tests/Vectors/camera/rig_*.json).

public final class CameraRig: GameSystem {
  public enum Mode: String, Sendable {
    case follow, attract, cinematic
  }

  static let DEG: Double = JS.PI / 180
  public static let BASE_FOV: Double = 40
  public static let ZOOMS: [Double] = [1, 0.8, 1.25]
  /// NDC: heli at ~55 % of the screen height (from the bottom)
  public static let HELI_SCREEN_Y: Double = 0.1
  /// ≈ 6vh bars on the title screen
  public static let ATTRACT_LB: Double = 0.47

  /// Exact critically damped spring step (stable for any dt).
  @inline(__always) static func crit(_ x: Double, _ v: Double, _ target: Double, _ omega: Double, _ dt: Double) -> (x: Double, v: Double) {
    let y = x - target
    let e = JS.exp(-omega * dt)
    let k = v + omega * y
    return (target + (y + k * dt) * e, (v - omega * k * dt) * e)
  }

  /// A delayed / held shake (thunder, gust fronts, shake(…, duration)).
  struct Pending {
    var t: Double
    var trauma: Double
    var freq: Double
    var push: (x: Double, z: Double, deg: Double)?
    var hold: Double?
  }

  let ctx: SimContext
  public var mode: Mode
  public internal(set) var zoom: Double = 1
  public internal(set) var zoomIndex = 0
  public internal(set) var letterbox: Double = 0
  public internal(set) var focusPoint = V3()
  public internal(set) var height: Double = 150
  public internal(set) var tiltDeg: Double = 14
  public internal(set) var fov: Double = BASE_FOV
  public internal(set) var viewHeight: Double = 100
  public internal(set) var reveal = false
  public internal(set) var heliScreen = ScreenPoint()
  /// NDC units / s (post: lens rivulets)
  public internal(set) var heliScreenVelocity = V2()
  public internal(set) var trauma: Double = 0

  public let motion = CameraMotion(seed: 4242)
  public let freecam = FreeCam()
  var photo = false
  var fv = V2()
  var hv: Double = 0
  var tilt: Double = 14 * DEG
  var tiltV: Double = 0
  var punchV: Double = 0
  var punchT: Double = 0
  var punchHold: Double = 0
  var climbFov: Double = 0
  var winchBlend: Double = 0
  var snap = true
  var t: Double = 0
  var lbPulse: Double = 0
  var revealHold: Double = 0
  var slowT: Double = 0
  var slowScale: Double = 1
  var used = Set<String>()
  var pending: [Pending] = []
  var focusPos = V3()
  var focusT: Double = 0
  var focusDur: Double = 0
  var focusW: Double = 0
  var crashT: Double = -1
  var rogueUnder = false
  var firstHazard = true
  var autoStarted = false
  var look = V3()
  var subscriptions: [EventSubscription] = []

  public init(ctx: SimContext) {
    self.ctx = ctx
    mode = ctx.mode == .title || ctx.mode == .briefing ? .attract : .follow
    let ev = ctx.events
    subscriptions.append(ev.on(GameEvent.GameMode.self) { [weak self] e in
      guard let self else { return }
      if e.to == .title || e.to == .briefing { self.mode = .attract } else if e.to == .play { self.mode = .follow } else if e.to == .debrief { self.mode = .cinematic }
    })
    subscriptions.append(ev.on(GameEvent.MissionSetup.self) { [weak self] _ in
      guard let self else { return }
      self.used.removeAll()
      self.firstHazard = true
      self.crashT = -1
      self.snap = true
      self.pending.removeAll()
      self.motion.trauma = 0
      self.endSlowMo()
    })
    // Letterbox moments (DESIGN §2.8 item 7): mission start ≈ 2.4 s, chapter titles, the first hazard
    // reveal; debrief = cinematic mode. Nothing else may hold the bars during play. ?autostart (tests,
    // dev) skips the opening bars — there is no title/briefing to transition from.
    subscriptions.append(ev.on(GameEvent.MissionStart.self) { [weak self] _ in
      guard let self else { return }
      let auto = !self.autoStarted && self.ctx.autostart
      self.autoStarted = true
      if !auto { self.cinematicBars(2.4) }
    })
    subscriptions.append(ev.on(GameEvent.MissionChapter.self) { [weak self] _ in
      guard let self else { return }
      // the opening chapter coincides with the mission-start bars
      if (self.ctx.mission?.elapsed ?? 0) > 1.5 { self.cinematicBars(3) }
    })
    subscriptions.append(ev.on(GameEvent.HazardWarning.self) { [weak self] _ in
      guard let self else { return }
      if self.firstHazard {
        self.firstHazard = false
        self.cinematicBars(3)
      }
    })
    subscriptions.append(ev.on(GameEvent.WeatherLightning.self) { [weak self] e in self?.onLightning(e) })
    subscriptions.append(ev.on(GameEvent.WeatherGust.self) { [weak self] e in
      guard let self else { return }
      let s = MathUtil.clamp(JSNumber.or(e.strength, 6) / 12, 0, 1)
      let dir = e.dir
      self.pending.append(Pending(t: JS.max(0, e.eta), trauma: 0.15, freq: 6, push: (dir.x, dir.y, 0.3 + 0.5 * s)))
    })
    subscriptions.append(ev.on(GameEvent.HeliDamage.self) { [weak self] e in
      guard let self else { return }
      if e.source == "water" {
        self.motion.addTrauma(0.5, 12)
      } else if JSNumber.or(e.amount, 0) >= 0.03 {
        self.motion.addTrauma(0.8, 13)
      } else {
        self.motion.addTrauma(0.3 + JSNumber.or(e.amount, 0) * 10, 13)
      }
    })
    subscriptions.append(ev.on(GameEvent.HeliCrash.self) { [weak self] _ in
      guard let self else { return }
      self.motion.addTrauma(0.8, 10)
      self.slowMo(0.3, 1.2, nil)
      self.crashT = 0
    })
  }

  deinit {
    for s in subscriptions { s.off() }
  }

  public func start() {
    snap = true
  }

  // ----------------------------------------------------------------------------------------------
  // CONTRACT API
  public func setMode(_ m: Mode) { mode = m }

  /// duration > 0 keeps the trauma topped up (continuous rumble); otherwise a single kick.
  public func shake(_ strength: Double = 0.5, _ duration: Double = 0) {
    motion.addTrauma(MathUtil.clamp(strength, 0, 1))
    if duration > 0 { pending.append(Pending(t: 0, trauma: strength, freq: 11, push: nil, hold: duration)) }
  }

  public func punch(_ fovDelta: Double, _ duration: Double = 0.08) {
    punchV = fovDelta
    punchHold = duration
    punchT = duration + 0.25
  }

  public func focus(_ position: V3?, _ duration: Double = 3) {
    guard let position else { return }
    focusPos.set(position.x, 0, position.z)
    focusDur = JS.max(0.5, duration)
    focusT = focusDur
  }

  /// Letterbox pulse (cinematic bars for `duration` seconds, eased in/out over 0.8 s).
  public func cinematicBars(_ duration: Double = 3) {
    lbPulse = JS.max(lbPulse, duration)
  }

  /// Slow-motion moment; `key` limits it to once per mission (nil = unlimited, e.g. the crash).
  @discardableResult
  public func slowMo(_ scale: Double, _ duration: Double, _ key: String?) -> Bool {
    if let key {
      if used.contains(key) { return false }
      used.insert(key)
    }
    slowScale = scale
    slowT = duration
    ctx.timeScale = scale
    return true
  }

  func endSlowMo() {
    if slowT > 0 || ctx.timeScale == slowScale {
      if ctx.timeScale == slowScale { ctx.timeScale = 1 }
    }
    slowT = 0
  }

  public func worldToScreen(_ v: V3) -> ScreenPoint {
    Projection.worldToScreen(v, camera: ctx.camera, width: ctx.viewportWidth, height: ctx.viewportHeight)
  }

  /// Ray through the screen point → hit on the sea plane y = 0 (cursor aim).
  public func screenToWater(_ ndcX: Double, _ ndcY: Double) -> V3 {
    Projection.screenToWater(ndcX, ndcY, camera: ctx.camera)
  }

  // ----------------------------------------------------------------------------------------------
  func onLightning(_ e: GameEvent.WeatherLightning) {
    var d = e.distance
    if !(d >= 0), let h = ctx.heli { d = JS.hypot(e.x - h.position.x, e.z - h.position.z) }
    if !(d >= 0) { d = 1000 }
    if !e.cloudOnly {
      if d < 150 { punch(-1.5, 0.08) }
      if d < 40 { slowMo(0.4, 0.5, "lightning") }
    }
    if d < 600 {
      // Thunder rumble arrives d/343 s later (8 Hz).
      pending.append(Pending(t: d < 120 ? 0 : d / 343, trauma: e.cloudOnly ? 0.22 : 0.35, freq: 8, push: nil, hold: nil))
    }
  }

  func hazards(_ dt: Double, _ hp: V3) {
    guard let hz = ctx.hazards else { return }
    // Continuous rumble near a waterspout / tornado: 0.2·(1 − d/150).
    for z in hz.list {
      if z.type != "waterspout" && z.type != "tornado" { continue }
      let reach: Double = z.type == "tornado" ? 300 : 150
      let d = JS.hypot(z.position.x - hp.x, z.position.z - hp.z)
      if d < reach { motion.floor(0.2 * (1 - d / reach)) }
    }
    // Rogue crest passing under the heli: trauma 0.6, slow-mo 0.35 × 1 s if the heli is below 15 m.
    let lift = JSNumber.or(hz.waveLiftAt(hp.x, hp.z), 0)
    if lift > 5 && !rogueUnder {
      rogueUnder = true
      motion.addTrauma(0.6, 9)
      let clearance = hp.y - lift
      if clearance < 15 { slowMo(0.35, 1.0, "rogue") }
    } else if lift < 2 {
      rogueUnder = false
    }
    // Hazard reveal (+50 m, 26°): rogue at T−4, waterspout / tornado close by.
    if let imm = hz.imminent, let ip = imm.position {
      let d = JS.hypot(ip.x - hp.x, ip.z - hp.z)
      let eta = imm.eta ?? 0
      if (imm.type == "rogue" && eta < 4.5) || ((imm.type == "waterspout" || imm.type == "tornado") && d < 320) { revealHold = 2.5 }
    }
    if revealHold > 0 { revealHold -= dt }
    reveal = revealHold > 0
  }

  /// Photo mode: free camera; keep the fields other systems read (focusPoint, height, heliScreen) live.
  func photoUpdate(_ dt: Double) {
    let cam = ctx.camera
    let fc = freecam
    if !photo {
      photo = true
      fc.begin(cam, look, ctx.input?.mouse)
    }
    let o = fc.update(dt, ctx, CameraRig.BASE_FOV, JSNumber.or(ctx.mission?.areaRadius, 1500))
    cam.position = o
    cam.up.set(0, 1, 0)
    cam.lookAt(fc.p)
    if JS.abs(cam.fov - CameraRig.BASE_FOV) > 1e-3 {
      cam.fov = CameraRig.BASE_FOV
      cam.updateProjectionMatrix()
    }
    cam.updateMatrixWorld()
    fov = CameraRig.BASE_FOV
    focusPoint.set(fc.p.x, 0, fc.p.z)
    height = o.y
    tiltDeg = 90 - fc.easedPitch / CameraRig.DEG
    viewHeight = 2 * fc.easedDist * JS.tan((CameraRig.BASE_FOV / 2) * CameraRig.DEG)
    trauma = 0
    if let h = ctx.heli {
      heliScreen = worldToScreen(h.position)
      heliScreenVelocity.set(0, 0)
    }
  }

  // ----------------------------------------------------------------------------------------------
  public func update(_ dtIn: Double) {
    let DEG = CameraRig.DEG
    let dt = dtIn > 0 ? dtIn : 0
    if ctx.photoActive() {
      photoUpdate(dt)
      return
    }
    if photo {
      photo = false
      snap = true // cut straight back to the follow framing
    }
    t += dt
    let cam = ctx.camera
    let h = ctx.heli
    let st = ctx.weatherState
    let storm = MathUtil.clamp(JSNumber.or(st.intensity, 0), 0, 1)
    let hp = h?.position ?? V3(0, 40, 0)
    let hvel = h?.velocity

    // Zoom cycle (Z): Auto ×1 → closer ×0.8 → farther ×1.25.
    if ctx.mode == .play && (ctx.input?.pressed(.zoom) ?? false) {
      zoomIndex = (zoomIndex + 1) % CameraRig.ZOOMS.count
      ctx.events.emit(GameEvent.CameraZoom(zoom: CameraRig.ZOOMS[zoomIndex], index: zoomIndex))
    }
    zoom += (CameraRig.ZOOMS[zoomIndex] - zoom) * (1 - JS.exp(-dt * 3))

    // Timers: delayed shakes, slow-mo, focus envelope, letterbox pulse.
    var i = pending.count - 1
    while i >= 0 {
      var p = pending[i]
      p.t -= dt
      if var hold = p.hold {
        motion.floor(p.trauma)
        hold -= dt
        p.hold = hold
        pending[i] = p
        if hold <= 0 { pending.remove(at: i) }
        i -= 1
        continue
      }
      pending[i] = p
      if p.t <= 0 {
        motion.addTrauma(p.trauma, p.freq)
        if let push = p.push { motion.gustPush(push.x, push.z, push.deg) }
        pending.remove(at: i)
      }
      i -= 1
    }
    if slowT > 0 {
      slowT -= dt
      if slowT <= 0 { endSlowMo() }
    }
    if lbPulse > 0 { lbPulse -= dt }
    if focusT > 0 { focusT -= dt }
    if crashT >= 0 { crashT += dt }
    if ctx.mode == .play || ctx.mode == .debrief { hazards(dt, hp) } else { reveal = false }

    // --- targets per mode ------------------------------------------------------------------------
    let winchOut: Double = (h.map { $0.winch.state != .stowed } ?? false) ? 1 : 0
    winchBlend += (winchOut - winchBlend) * (1 - JS.exp(-dt * 1.2))
    let wb = winchBlend
    var Ht: Double
    var tiltT: Double
    var wFocus: Double = 4
    var wH = 2.2
    var lb: Double = 0
    var tgt = V3(hp.x, 0, hp.z)

    switch mode {
    case .attract:
      Ht = 300
      tiltT = 16
      wFocus = 0.7
      wH = 1.6
      lb = CameraRig.ATTRACT_LB
      let t = self.t
      // keep a lit human anchor in frame: drift between the parked heli and the lighthouse
      if let lh = ctx.world?.lighthouse, lh.x.isFinite, JS.hypot(lh.x - hp.x, lh.y - hp.z) < 450 {
        tgt.x += (lh.x - hp.x) * 0.45
        tgt.z += (lh.y - hp.z) * 0.45
      }
      tgt.x += 40 * JS.sin(t * 0.047) + 14 * JS.sin(t * 0.11)
      tgt.z += 28 * JS.sin(t * 0.033 + 1.3) - 15
    case .cinematic:
      Ht = 400
      tiltT = 18
      wFocus = 1.2
      wH = 0.75
      lb = 1
    case .follow:
      let alt = JS.max(0, h?.altitude ?? hp.y)
      let speed = hvel.map { JS.hypot($0.x, $0.z) } ?? 0
      Ht = MathUtil.clamp(110 + alt + 1.2 * speed, 105, 230) + 15 * storm
      Ht += (95 - Ht) * wb
      Ht *= zoom
      tiltT = 14 + 4 * storm
      tiltT += (10 - tiltT) * wb
      if reveal {
        Ht = JS.min(Ht + 50, 280)
        tiltT = 26
      }
      // Crash: the camera slowly lifts away from the floating wreck.
      if crashT >= 0 {
        Ht = JS.max(Ht, 150 + JS.min(crashT, 8) * 14)
        wH = 0.9
      }
      // Look-ahead (velocity × 0.7 s, ≤ 25 m, → 0 while winching).
      if let hv = hvel, crashT < 0 {
        var lx = hv.x * 0.7
        var lz = hv.z * 0.7
        let l = JS.hypot(lx, lz)
        if l > 25 {
          lx *= 25 / l
          lz *= 25 / l
        }
        tgt.x += lx * (1 - wb)
        tgt.z += lz * (1 - wb)
      }
    }
    if lbPulse > 0 { lb = JS.max(lb, 1) }
    // letterbox 0..1 at a constant rate (full travel in 0.8 s)
    let lstep = dt / 0.8
    letterbox += MathUtil.clamp(lb - letterbox, -lstep, lstep)

    // Never show the horizon: tilt + FOV/2 ≤ 55° (with margin for drift/shake).
    tiltT = JS.min(tiltT, 55 - (fov / 2) - 2)

    // --- springs: tilt (ζ 0.75), height (critical), focus (critical, ω 4) ---------------------------
    if snap {
      tilt = tiltT * DEG
      tiltV = 0
      height = Ht
      hv = 0
    } else {
      let w = 2.6
      let z = 0.75
      var rem = dt
      while rem > 0 {
        let s = JS.min(rem, 1.0 / 60)
        tiltV += (w * w * (tiltT * DEG - tilt) - 2 * z * w * tiltV) * s
        tilt += tiltV * s
        rem -= s
      }
      let r = CameraRig.crit(height, hv, Ht, wH, dt)
      height = r.x
      hv = r.v
    }
    let T = tilt
    tiltDeg = T / DEG
    let H = JS.max(20, height)

    // Keep the heli at ~55 % screen height: shift the focus so its projection lands at NDC y = +0.1
    // (accounts for the heli's altitude parallax under the tilted camera).
    if mode == .follow {
      let delta = JS.atan(CameraRig.HELI_SCREEN_Y * JS.tan((fov / 2) * DEG))
      let hy = MathUtil.clamp(hp.y, 0, H - 10)
      tgt.z += (H - hy) * JS.tan(T + delta) - H * JS.tan(T)
    }
    // focus(): pull toward a point of interest, but keep the heli inside the frame.
    if focusT > 0 {
      let k = JS.min(1, (focusDur - focusT) / 0.6, focusT / 0.8)
      focusW = MathUtil.smoothLook(0, 1, k)
    } else {
      focusW = 0
    }
    if focusW > 0 {
      var fx = (focusPos.x - tgt.x) * 0.65
      var fz = (focusPos.z - tgt.z) * 0.65
      let lim = 0.32 * 2 * H * JS.tan((CameraRig.BASE_FOV / 2) * DEG)
      let l = JS.hypot(fx, fz)
      if l > lim {
        fx *= lim / l
        fz *= lim / l
      }
      tgt.x += fx * focusW
      tgt.z += fz * focusW
    }

    if snap || JS.hypot(tgt.x - focusPoint.x, tgt.z - focusPoint.z) > 450 {
      focusPoint.set(tgt.x, 0, tgt.z)
      fv.set(0, 0)
      snap = false
    } else {
      var r = CameraRig.crit(focusPoint.x, fv.x, tgt.x, wFocus, dt)
      focusPoint.x = r.x
      fv.x = r.v
      r = CameraRig.crit(focusPoint.z, fv.y, tgt.z, wFocus, dt)
      focusPoint.z = r.x
      fv.y = r.v
    }

    // --- FOV: punches + "+2° at max climb" -----------------------------------------------------------
    if punchT > 0 { punchT -= dt }
    let punch = punchT > 0.25 ? punchV : punchT > 0 ? punchV * (punchT / 0.25) : 0
    let climb = MathUtil.smoothLook(5, 6.8, h?.vy ?? 0) * (mode == .follow ? 1 : 0)
    climbFov += (2 * climb - climbFov) * (1 - JS.exp(-dt * 2))
    let fovNow = CameraRig.BASE_FOV + punch + climbFov
    if JS.abs(fovNow - cam.fov) > 1e-3 {
      cam.fov = fovNow
      cam.updateProjectionMatrix()
    }
    fov = fovNow

    // --- motion layers ---------------------------------------------------------------------------------
    let reduce = ctx.settings.get("reduceMotion").jsTruthy ? 0.4 : 1
    let ss = ctx.settings.get("screenShake")
    let shakeScale = MathUtil.clamp(ss.isNull ? 1 : ss.jsToNumber, 0, 1)
    motion.update(dt, storm, shakeScale, reduce * (mode == .attract ? 0.6 : 1))
    trauma = motion.trauma

    // --- place the camera --------------------------------------------------------------------------------
    let m = motion
    cam.position.set(focusPoint.x + m.pos.x, H + m.pos.y, focusPoint.z + H * JS.tan(T) + m.pos.z)
    look.set(focusPoint.x + m.pos.x, 0, focusPoint.z + m.pos.z)
    cam.up.set(0, 1, 0)
    cam.lookAt(look)
    cam.rotateX(m.rot.x)
    cam.rotateY(m.rot.y)
    cam.rotateZ(m.rot.z)
    cam.updateMatrixWorld()
    height = H
    viewHeight = (2 * H * JS.tan((fovNow / 2) * DEG)) / JS.cos(T)

    // --- heli screen position + its ground velocity in screen units (NDC/s, +y = up-screen) — post's
    //     lens rivulets run along −heliScreenVelocity -------------------------------------------------
    if h != nil {
      heliScreen = worldToScreen(hp)
      let halfH = JS.max(1, viewHeight / 2)
      let halfW = halfH * JSNumber.or(cam.aspect, 16.0 / 9)
      heliScreenVelocity.set(hvel.map { $0.x / halfW } ?? 0, hvel.map { -$0.z / halfH } ?? 0)
    }
  }
}
