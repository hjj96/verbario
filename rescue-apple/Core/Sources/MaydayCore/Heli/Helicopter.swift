// systems/heli.js Helicopter «Чайка-07» (CONTRACT: heli; DESIGN §2.9, §3.2–3.9, §3.15).
//
// Owns the fixed-60 Hz flight model with render interpolation (FlightModel), the winch (Winch), the
// searchlight, lights + water glints, the hoist operator's pose and operations — fuel, hull, pads,
// consumables, crash (HeliOps). The procedural model is baked for MaydayRender; what the web writes into
// its scene graph and materials every frame lands in `visual` (HeliVisualState).
//
// Public state is plain fields (read by camera, HUD, audio, survivors…); position / heading are the
// INTERPOLATED render state, so everyone sees the same smooth helicopter. Beyond the CONTRACT fields:
// pitch, yawRate, vy, speed (ground m/s), airspeed, seaY, surfaceY, skidClearance, bingo, bingoPad,
// fuelBurn (%/s), overheat (s), thrustFactor, autorotation, crash, ditched, damageTaken, refueling,
// seatsUsed, ceiling, aimSource, hoistWorld, downwash, beam, setSearchlight(on), winch.*.
//
// Parity (Tests/Vectors/heli/heli_*.json run the real web class on stub systems): the update order,
// every expression and every Math.random call (ctx.random) follow the JS. Pads are PadIDs + world.pad()
// views, survivors GroupIDs (SimContext rules).

/// mission def.heli: where the heli starts ({ pad } or { x, z, altitude | y, heading }).
public struct HeliSpawn: Equatable, Sendable {
  /// index into world.pads
  public var pad: Int?
  public var heading: Double?
  public var altitude: Double?
  public var y: Double?
  public var x: Double?
  public var z: Double?

  public init(pad: Int? = nil, heading: Double? = nil, altitude: Double? = nil, y: Double? = nil, x: Double? = nil, z: Double? = nil) {
    self.pad = pad
    self.heading = heading
    self.altitude = altitude
    self.y = y
    self.x = x
    self.z = z
  }

  /// (def && def.heli) || { pad: 0 }
  public init(def: JSONValue) {
    let h = def["heli"]
    guard h.jsTruthy else {
      self.init(pad: 0)
      return
    }
    self.init(pad: h["pad"].double.map { Int($0) }, heading: h["heading"].double, altitude: h["altitude"].double,
              y: h["y"].double, x: h["x"].double, z: h["z"].double)
  }
}

/// heli.downwash = { x, z, radius, strength }
public struct Downwash: Equatable, Sendable {
  public var x: Double = 0
  public var z: Double = 0
  public var radius: Double = 9
  public var strength: Double = 0
}

public final class Helicopter: FlightHost, GameSystem {
  static let SKID: Double = -HeliModel.SKID_Y
  public static let PRESETS: [Double] = [15, 40, 90]
  public static let ALT_MIN: Double = 4
  public static let ALT_MAX: Double = 120
  static let IDLE_RPM: Double = 0.55
  static let MAX_TILT: Double = 0.38
  static let WHITE = Color3(1, 1, 1)

  /// Key smoothing (DESIGN §3.2): k = 9 press / 14 release / 18 reversal.
  static func smoothAxis(_ cur: Double, _ target: Double, _ dt: Double) -> Double {
    var k: Double = 9
    if target * cur < 0 { k = 18 } else if JS.abs(target) < JS.abs(cur) { k = 14 }
    return cur + (target - cur) * (1 - JS.exp(-k * dt))
  }

  public let ctx: SimContext

  // ---- CONTRACT fields -----------------------------------------------------------------------------
  public internal(set) var position = V3(0, 40, 0)
  public internal(set) var velocity = V3()
  public internal(set) var heading: Double = 0
  public internal(set) var altitude: Double = 40
  public internal(set) var fuel: Double = 1
  public internal(set) var hull: Double = 1
  public internal(set) var cabin: [CabinPerson] = []
  public var capacity = 6
  /// the pad it sits on
  public var landed: PadID?
  public internal(set) var alive = true
  public internal(set) var searchlight = false
  public internal(set) var rotorRPM: Double = 1
  public internal(set) var load: Double = 0
  public internal(set) var bank: Double = 0
  public internal(set) var boost = false
  public internal(set) var engineTemp: Double = 0
  public internal(set) var flares = 4
  public internal(set) var rafts = 2
  public internal(set) var emp: Double = 0
  public internal(set) var aim = V3()
  public var altTarget: Double = 40

  // ---- extras ----------------------------------------------------------------------------------------
  public internal(set) var pitch: Double = 0
  public internal(set) var yawRate: Double = 0
  public internal(set) var vy: Double = 0
  /// ground speed m/s
  public internal(set) var speed: Double = 0
  public internal(set) var airspeed: Double = 0
  /// water height under the heli
  public internal(set) var seaY: Double = 0
  /// local surface (water or deck)
  public internal(set) var surfaceY: Double = 0
  public internal(set) var skidClearance: Double = 0
  /// fuel fraction needed to reach the nearest pad (+10 %)
  public internal(set) var bingo: Double = 0.1
  public internal(set) var bingoPad: PadID?
  /// %/s
  public internal(set) var fuelBurn: Double = 0
  /// seconds of overheat lock left
  public internal(set) var overheat: Double = 0
  public internal(set) var boosting = false
  public internal(set) var boostHeld = false
  public internal(set) var thrustFactor: Double = 1
  public internal(set) var autorotation = false
  public internal(set) var crash: HeliCrashState?
  public internal(set) var firstHit = true
  public internal(set) var damageTaken: Double = 0
  public internal(set) var refueling = false
  /// smoothed stick (x east, y north)
  public internal(set) var uMove = V2()
  public var uMag: Double = 0
  /// 'mouse' | 'stick' | 'touch' | 'nose'
  public internal(set) var aimSource = "nose"
  /// cable top (physics) and as rendered
  public internal(set) var hoistWorld = V3()
  public internal(set) var hoistRender = V3()
  public internal(set) var downwash = Downwash()
  public internal(set) var windEff = V2()
  /// altTarget at the 120 m ceiling
  public internal(set) var ceiling = false

  // ---- subsystems --------------------------------------------------------------------------------------
  public private(set) lazy var flight = FlightModel(host: self, ctx: ctx)
  /// heli.winch (the public winch object) and its controller in one
  public private(set) lazy var winch = Winch(heli: self, ctx: ctx)
  public private(set) lazy var searchlightCtl = Searchlight(ctx: ctx)
  public private(set) lazy var lightsCtl = HeliLights(ctx: ctx)
  public private(set) lazy var ops = HeliOps(heli: self, ctx: ctx)
  /// hoist operator in the door (DESIGN §4 #9)
  public private(set) lazy var crewman = Crewman(ctx: ctx)
  public internal(set) var visual = HeliVisualState()

  // ---- internal ----------------------------------------------------------------------------------------
  var acc: Double = 0
  var liftActive = false
  var liftRelease: Double = 0
  var pitchV: Double = 0
  var bankV: Double = 0
  var bladeAngle: Double = 0
  var ghostAngle: Double = 0
  var tailBlade: Double = 0
  var tailGhost: Double = 0
  var shadowAngle: Double = 0
  var sprayAcc: Double = 0
  var smokeT: Double = 0
  var sparkT: Double = 0
  var t: Double = 0
  var liftAxis: Double = 0
  let noise = SimplexNoise2D(seed: 5531)
  var didReset = false

  /// A remembered distress signal (touch auto-aim).
  struct Signal {
    var serial: Int
    var x: Double
    var z: Double
    var t: Double
    var s: GroupID?
  }

  /// What the touch auto-aim is locked on (the web compares object identity).
  enum TouchTarget: Equatable {
    case group(GroupID)
    case signal(Int)
  }

  var signals: [Signal] = []
  var signalSerial = 0
  var touchTgt: TouchTarget?
  var subscriptions: [EventSubscription] = []

  /// heli.beam (the searchlight's published beam)
  public var beam: SearchlightBeam { searchlightCtl.beam }

  public init(ctx: SimContext) {
    self.ctx = ctx
    // Construction order of the web: flight, winch, searchlight, lights (draws Math.random), ops, crewman.
    _ = flight
    _ = winch
    _ = searchlightCtl
    _ = lightsCtl
    _ = ops
    _ = crewman

    subscriptions.append(ctx.events.on(GameEvent.MissionSetup.self) { [weak self] e in self?.reset(HeliSpawn(def: e.def)) })
    // Touch auto-aim (DESIGN §3.2): remember recent distress signals (rocket, smoke, strobe…).
    subscriptions.append(ctx.events.on(GameEvent.SurvivorSignal.self) { [weak self] p in
      guard let self, (p.x + p.z).isFinite else { return }
      if self.signals.count >= 12 { self.signals.removeFirst() }
      self.signalSerial += 1
      self.signals.append(Signal(serial: self.signalSerial, x: p.x, z: p.z, t: self.t, s: p.s))
    })
    subscriptions.append(ctx.events.on(GameEvent.MissionSetup.self) { [weak self] _ in
      self?.signals.removeAll()
      self?.touchTgt = nil
    })
    flight.reset(0, 40, 0, 0)
    winch.reset()
    syncRender(0)
  }

  deinit {
    for s in subscriptions { s.off() }
  }

  /// init(): quality, and — if a mission was already set up before we existed (unlikely) — sit on the first pad.
  public func start() {
    applyQuality()
    if let pads = ctx.world?.pads, !pads.isEmpty, !didReset { reset(HeliSpawn(pad: 0)) }
  }

  /// settings 'quality' changed (the web subscribes to settings.onChange): real shadow blades on high only.
  public func applyQuality() {
    visual.shadowBladesVisible = ctx.settings.get("quality").string == "high"
  }

  // ----------------------------------------------------------------------------------------------
  // CONTRACT API
  public func reset(_ spawn: HeliSpawn = HeliSpawn()) {
    didReset = true
    let pads = ctx.world?.pads ?? []
    let pad = spawn.pad.flatMap { $0 >= 0 && $0 < pads.count ? pads[$0] : nil }
    hull = 1
    fuel = 1
    cabin.removeAll()
    emp = 0
    engineTemp = 0
    overheat = 0
    boost = false
    boosting = false
    autorotation = false
    crash = nil
    alive = true
    firstHit = true
    damageTaken = 0
    thrustFactor = 1
    uMove.set(0, 0)
    liftActive = false
    acc = 0
    if let pad {
      let hd = spawn.heading ?? JSNumber.or(pad.heading, 0)
      flight.reset(pad.position.x, pad.position.y + Helicopter.SKID, pad.position.z, hd)
      landed = pad.id
      flight.attachTo(pad)
      flight.contactPad = pad.id
      altTarget = flight.p.y
      rotorRPM = Helicopter.IDLE_RPM
    } else {
      let y = spawn.altitude ?? spawn.y ?? 40
      flight.reset(JSNumber.or(spawn.x, 0), y, JSNumber.or(spawn.z, 0), JSNumber.or(spawn.heading, 0))
      landed = nil
      altTarget = MathUtil.clamp(y, Helicopter.ALT_MIN, Helicopter.ALT_MAX)
      rotorRPM = 1
    }
    ops.reset()
    searchlightCtl.reset()
    hoistWorld = Helicopter.computeHoist(flight.p, flight.heading)
    winch.reset()
    crewman.reset()
    visual.flares = [nil, nil, nil, nil]
    visual.rafts = [nil, nil]
    syncRender(0)
  }

  public func applyImpulse(_ v: V3) {
    flight.v.add(v)
    if landed != nil && JS.hypot(v.x, v.z) > 3 { ops.takeoff() }
  }

  public func damage(_ amount: Double, _ source: DamageSource = .unknown) {
    ops.damage(amount, source)
  }

  public func addFuel(_ amount: Double) {
    fuel = MathUtil.clamp(fuel + amount, 0, 1)
  }

  public func autoTakeoff(_ altitude: Double = 40) {
    let y = flight.p.y
    altTarget = MathUtil.clamp(JS.max(altitude, y + 2), Helicopter.ALT_MIN, Helicopter.ALT_MAX)
    liftActive = false
  }

  public func setSearchlight(_ on: Bool) {
    let on = on && alive
    if on == searchlight { return }
    searchlight = on
    ctx.events.emit(GameEvent.HeliSearchlight(on: on))
  }

  public var onPad: PadID? { landed }
  public var ditched: Bool { crash?.phase == .ditched }
  public var seatsUsed: Int { winch.seatsUsed() }

  // ---- FlightHost --------------------------------------------------------------------------------
  public var winchState: WinchState { winch.state }
  public var passengers: Int { cabin.count }
  public func land(_ pad: LandingPad) { ops.land(pad) }
  public func ditch(_ reason: String, _ deck: LandingPad?) { ops.ditch(reason, deck) }
  public func takeoff() { ops.takeoff() }

  // ----------------------------------------------------------------------------------------------
  public func update(_ dt: Double) {
    t += dt
    input(dt)
    aimAndNose()

    // Fixed 60 Hz physics with an accumulator; render interpolates (DESIGN §3.1).
    acc += dt
    var n = 0
    while acc >= FlightModel.STEP && n < 8 {
      step(FlightModel.STEP)
      acc -= FlightModel.STEP
      n += 1
    }
    if n >= 8 { acc = 0 }
    let alpha = MathUtil.clamp(acc / FlightModel.STEP, 0, 1)

    syncRender(alpha)
    visuals(dt, alpha)
    if ctx.mode == .play { buttons() }
  }

  func step(_ dt: Double) {
    let f = flight
    f.step(dt)
    hoistWorld = Helicopter.computeHoist(f.p, f.heading)
    winch.step(dt, hoistWorld)
    ops.step(dt)
    f.lastVy = f.v.y
  }

  /// Cable top from the physics pose (yaw only; the visual tilt is cosmetic).
  static func computeHoist(_ p: V3, _ heading: Double) -> V3 {
    let c = JS.cos(heading)
    let s = JS.sin(heading)
    let hx = HeliModel.Points.hoist.x
    let hz = HeliModel.Points.hoist.z
    // local (x right, z tail) → world with clockwise heading
    return V3(p.x + hx * c - hz * s, p.y + HeliModel.Points.hoist.y, p.z + hx * s + hz * c)
  }

  // ----------------------------------------------------------------------------------------------
  func input(_ dt: Double) {
    let input = ctx.input
    let play = ctx.mode == .play && alive && crash == nil
    let m = play ? input?.move() : nil
    uMove.x = Helicopter.smoothAxis(uMove.x, m?.x ?? 0, dt)
    uMove.y = Helicopter.smoothAxis(uMove.y, m?.y ?? 0, dt)

    // Vertical: lift axis moves the target at 12 m/s; 0.25 s after release the target = current height.
    var lift = play ? (input?.axis(.lift) ?? 0) : 0
    if ctx.settings.get("invertLift").jsTruthy { lift = -lift }
    liftAxis = lift
    if JS.abs(lift) > 0.05 {
      altTarget += lift * 12 * dt
      liftActive = true
      liftRelease = 0.25
    } else if liftActive {
      liftRelease -= dt
      if liftRelease <= 0 {
        liftActive = false
        altTarget = flight.p.y
      }
    }
    if play, let input {
      if input.pressed(.altPreset1) { preset(15) }
      if input.pressed(.altPreset2) { preset(40) }
      if input.pressed(.altPreset3) { preset(90) }
      if input.pressed(.altUp) { preset(Helicopter.PRESETS.first { $0 > altTarget + 1 } ?? Helicopter.ALT_MAX) }
      if input.pressed(.altDown) { preset(Helicopter.PRESETS.reversed().first { $0 < altTarget - 1 } ?? Helicopter.ALT_MIN) }
      let wheel = input.consumeWheel()
      if JSNumber.isTruthy(wheel) {
        altTarget -= 5 * JS.sign(wheel) * JS.min(3, JS.abs(wheel))
        liftActive = false
      }
    }
    if landed != nil && altTarget < flight.p.y { altTarget = flight.p.y }
    altTarget = MathUtil.clamp(altTarget, Helicopter.ALT_MIN, Helicopter.ALT_MAX)
    ceiling = altTarget >= Helicopter.ALT_MAX - 0.01

    boostHeld = play && (input?.down(.boost) ?? false)
    winch.input(play && (input?.down(.winch) ?? false), play && (input?.pressed(.winch) ?? false))
  }

  func preset(_ alt: Double) {
    altTarget = alt
    liftActive = false
  }

  func buttons() {
    guard let input = ctx.input else { return }
    if !alive || crash != nil { return }
    if input.pressed(.searchlight) { setSearchlight(!searchlight) }
    if input.pressed(.flare) { ops.flare() }
    if input.pressed(.raftDrop) { ops.raftDrop() }
    if input.pressed(.horn) { ops.horn() }
  }

  /// Aim point (cursor on the water / right stick / ahead of the nose) and the nose target.
  func aimAndNose() {
    let input = ctx.input
    let f = flight
    let p = f.p
    let play = ctx.mode == .play && alive && crash == nil
    let ax = play ? (input?.axis(.aimX) ?? 0) : 0
    let ay = play ? (input?.axis(.aimY) ?? 0) : 0
    let am = JS.hypot(ax, ay)
    let fx = JS.sin(f.heading)
    let fz = -JS.cos(f.heading)
    let device = input?.lastDevice ?? .keyboard
    if am > 0.12 {
      let r = 12 + 90 * am
      aim.set(p.x + (ax / am) * r, 0, p.z - (ay / am) * r)
      aimSource = "stick"
    } else if play && device == .touch, let a = touchAim() {
      // touch: the searchlight and flares lock onto the nearest spotted survivor / fresh signal
      aim = a
      aimSource = "touch"
    } else if device != .gamepad && device != .touch, let input, input.mouse.active, let rig = ctx.cameraRig {
      aim = rig.screenToWater(input.mouse.ndcX, input.mouse.ndcY)
      aimSource = "mouse"
    } else {
      // gamepad with the stick centred: under the heli, a little ahead (flare "под себя")
      aim.set(p.x + fx * 12, 0, p.z + fz * 12)
      aimSource = "nose"
    }
    if !(aim.x + aim.z).isFinite { aim.set(p.x, 0, p.z) }

    // Nose: cursor if the mouse moved within 2 s or the searchlight is on; else airspeed > 5 m/s.
    var target: Double?
    if play && landed == nil {
      let dx = aim.x - p.x
      let dz = aim.z - p.z
      let far = dx * dx + dz * dz > 36
      let mouseRecent = aimSource == "mouse" && ctx.nowMs() - (input?.mouse.lastMoveT ?? -1e9) < 2000
      if far && (aimSource == "stick" || mouseRecent || (searchlight && aimSource == "mouse")) {
        target = JS.atan2(dx, -dz)
      } else {
        let vx = f.v.x - f.windEff.x
        let vz = f.v.z - f.windEff.y
        if vx * vx + vz * vz > 25 { target = JS.atan2(vx, -vz) }
      }
    }
    f.noseTarget = target
  }

  /// Nearest spotted survivor group or recent distress signal (≤ 260 m, signals ≤ 25 s old); nil when
  /// there is none. A little hysteresis keeps the lock from flickering between two equally close targets.
  func touchAim() -> V3? {
    let p = flight.p
    let R2: Double = 260 * 260
    var best: TouchTarget?
    var bestPos = V2()
    var bd = R2
    var cur = Double.infinity
    let list = ctx.survivors?.groups ?? []
    for s in list {
      if !(s.remaining > 0) { continue }
      if s.state == "rescued" || s.state == "lost" || s.state == "hidden" { continue }
      if !s.spotted && s.state != "spotted" && s.state != "winching" { continue }
      let d2 = JS.pow(s.position.x - p.x, 2) + JS.pow(s.position.z - p.z, 2)
      if touchTgt == .group(s.id) { cur = d2 }
      if d2 < bd {
        bd = d2
        best = .group(s.id)
        bestPos.set(s.position.x, s.position.z)
      }
    }
    for g in signals {
      if t - g.t > 25 { continue }
      if let gs = g.s, let s = list.first(where: { $0.id == gs }), s.spotted || s.state == "spotted" { continue } // already have it exactly
      let d2 = JS.pow(g.x - p.x, 2) + JS.pow(g.z - p.z, 2)
      if touchTgt == .signal(g.serial) { cur = d2 }
      if d2 < bd {
        bd = d2
        best = .signal(g.serial)
        bestPos.set(g.x, g.z)
      }
    }
    guard var chosen = best else {
      touchTgt = nil
      return nil
    }
    if let held = touchTgt, chosen != held, cur < R2, bd > cur * 0.7 {
      // keep the current lock: re-read its position
      chosen = held
      switch held {
      case .group(let id):
        if let s = list.first(where: { $0.id == id }) { bestPos.set(s.position.x, s.position.z) }
      case .signal(let serial):
        if let g = signals.first(where: { $0.serial == serial }) { bestPos.set(g.x, g.z) }
      }
    }
    touchTgt = chosen
    let x = bestPos.x
    let z = bestPos.y
    if !(x + z).isFinite { return nil }
    return V3(x, 0, z)
  }

  // ----------------------------------------------------------------------------------------------
  func syncRender(_ alpha: Double) {
    let f = flight
    position.lerpVectors(f.prevP, f.p, alpha)
    heading = MathUtil.wrapAngle(f.prevHeading + MathUtil.wrapAngle(f.heading - f.prevHeading) * alpha)
    velocity = f.v
    vy = f.v.y
    yawRate = f.yawRate
    windEff = f.windEff
    seaY = f.sea
    surfaceY = f.surface
    let deck = landed.flatMap { ctx.world?.pad($0)?.position.y } ?? f.surface
    altitude = position.y - JS.max(f.sea, deck)
    skidClearance = altitude - Helicopter.SKID
    speed = JS.hypot(f.v.x, f.v.z)
    airspeed = JS.hypot(f.v.x - f.windEff.x, f.v.z - f.windEff.y)
  }

  func visuals(_ dt: Double, _ alpha: Double) {
    let st = ctx.weatherState
    let night = JSNumber.or(st.night, 0)
    let flash = JSNumber.or(st.flash, 0)
    let f = flight
    let ditched = self.ditched
    let smooth = MathUtil.smoothLook

    // --- rotor RPM (idle on the pad in title/briefing; spool τ 2.2 s; stops after ditching) -------
    var rpmT: Double = 1
    if (ctx.mode == .title || ctx.mode == .briefing) && landed != nil { rpmT = Helicopter.IDLE_RPM }
    if autorotation { rpmT = 0.9 }
    if ditched { rpmT = 0 }
    let tau = rpmT > rotorRPM ? 2.2 : ditched ? 0.6 : 1.2
    rotorRPM += (rpmT - rotorRPM) * (1 - JS.exp(-dt / tau))
    let rpm = rotorRPM

    // --- visual pitch / bank springs (ω 5.5, ζ 0.9) + turbulence jitter -----------------------------
    let hd = heading
    let cx = JS.cos(hd)
    let sx = JS.sin(hd)
    let th = f.thrust
    let aF = th.x * sx - th.y * cx
    let aR = th.x * cx + th.y * sx
    var pitchT = MathUtil.clamp(-0.03 * aF, -Helicopter.MAX_TILT, Helicopter.MAX_TILT)
    var bankT = MathUtil.clamp(0.03 * aR, -Helicopter.MAX_TILT, Helicopter.MAX_TILT)
    let T = JSNumber.or(st.turbulence, 0)
    if landed == nil && !ditched {
      pitchT += 0.02 * (T / 5) * noise.noise(t * 2.3, 1.7) * 3
      bankT += 0.02 * (T / 5) * noise.noise(t * 2.3, 9.1) * 3
    }
    // The swinging basket tugs the airframe (heavier with a person aboard).
    let wn = winch
    if wn.state != .stowed && landed == nil && wn.length > 1 {
      let dx = wn.basket.x - hoistWorld.x
      let dz = wn.basket.z - hoistWorld.z
      let k = wn.load != nil ? 0.012 : 0.006
      bankT += MathUtil.clamp((dx * cx + dz * sx) * k, -0.06, 0.06)
      pitchT += MathUtil.clamp(-(dx * sx - dz * cx) * k * 0.7, -0.04, 0.04)
    }
    if let id = landed {
      // sit level with the (possibly tilting) deck
      pitchT = 0
      bankT = 0
      if let up0 = ctx.world?.pad(id)?.up {
        var up = up0
        up.normalize()
        pitchT = -(up.x * sx - up.z * cx) * 0.9
        bankT = (up.x * cx + up.z * sx) * 0.9
      }
    }
    let onDeckWreck = ditched && crash?.deck != nil
    if onDeckWreck {
      pitchT = 0.05
      bankT = 0.14 // skid collapsed — lists on the deck
    } else if ditched, let up = ctx.ocean?.normalAt(position.x, position.z) {
      pitchT = -(up.x * sx - up.z * cx) * 1.2
      bankT = (up.x * cx + up.z * sx) * 1.2 + 0.18 // lists to starboard
    }
    let w = 5.5
    let z = 0.9
    pitchV += (w * w * (pitchT - pitch) - 2 * z * w * pitchV) * dt
    bankV += (w * w * (bankT - bank) - 2 * z * w * bankV) * dt
    pitch += pitchV * dt
    bank += bankV * dt
    if !(pitch + bank).isFinite {
      pitch = 0
      bank = 0
      pitchV = 0
      bankV = 0
    }

    // --- transforms -------------------------------------------------------------------------------------
    var rootPos = position
    if landed == nil && !ditched { rootPos.y += 0.07 * JS.sin(t * 1.9) * rpm }
    visual.rootPosition = rootPos
    visual.heading = hd
    visual.pitch = pitch
    visual.bank = bank
    var rq = Quat()
    rq.setFromEuler(Euler(0, -hd, 0))
    var rootLocal = Mat4()
    rootLocal.compose(rootPos, rq, V3(1, 1, 1))
    var rootWorld = Mat4()
    rootWorld.multiplyMatrices(Mat4.identity, rootLocal) // scene.matrixWorld × root.matrix
    var bq = Quat()
    bq.setFromEuler(Euler(pitch, 0, -bank))
    var bodyLocal = Mat4()
    bodyLocal.compose(V3(), bq, V3(1, 1, 1))
    var body = Mat4()
    body.multiplyMatrices(rootWorld, bodyLocal)
    visual.rootMatrix = rootWorld
    visual.bodyMatrix = body
    var hr = HeliModel.Points.hoist
    hr.applyMatrix4(body)
    hoistRender = hr

    // --- rotor discs (ghost blades, stagecoach, freeze in the flash) ----------------------------------
    let freeze = smooth(0.45, 0.55, flash)
    if freeze < 0.5 {
      bladeAngle += rpm * JS.PI * 2 * 4.6 * dt
      tailBlade += rpm * JS.PI * 2 * 22 * dt
    }
    ghostAngle += (0.7 + 3.0 * (rpm - 1)) * dt
    tailGhost += (1.3 + 4.0 * (rpm - 1)) * dt
    let slow = 1 - smooth(0.18, 0.5, rpm)
    let sharp = JS.max(freeze, slow)
    visual.rotor.blade = JSNumber.mod(bladeAngle, JS.PI * 2)
    visual.rotor.ghost = JSNumber.mod(ghostAngle, JS.PI * 2)
    visual.rotor.sharp = sharp
    visual.rotor.exp = 6 + 34 * (1 - smooth(0.4, 0.95, rpm))
    visual.rotor.elmo = JSNumber.or(st.stElmo, 0)
    // per-frame blade sweep of a 1/60 s "shutter" (rad), the tip smears' length
    visual.rotor.arc = MathUtil.clamp(rpm * JS.PI * 2 * 4.6 / 60, 0.04, 0.9)
    // tip smears are a close-range cue only: gone by 180 m of camera distance
    visual.rotor.tipFade = 1 - smooth(90, 180, ctx.camera.position.distanceTo(position))
    visual.tail.blade = JSNumber.mod(tailBlade, JS.PI * 2)
    visual.tail.ghost = JSNumber.mod(tailGhost, JS.PI * 2)
    visual.tail.sharp = sharp
    visual.tail.exp = 4 + 20 * (1 - smooth(0.4, 0.95, rpm))
    visual.tail.arc = MathUtil.clamp(rpm * JS.PI * 2 * 22 / 60, 0.04, 1.2)
    visual.tail.tipFade = visual.rotor.tipFade
    // the hub and blade roots turn with what the disc shows (ghost alias, or the frozen blades)
    visual.hubAngle = sharp > 0.5 ? bladeAngle : ghostAngle
    // shadow blades alias at 0.7–1 rev/s (stroboscopic rotor shadow)
    let aliasRate = rpm > 0.6 ? (0.7 + 0.3 * JS.sin(t * 0.37)) * JS.PI * 2 * rpm : rpm * JS.PI * 2 * 4.6
    if freeze < 0.5 { shadowAngle += aliasRate * dt }
    visual.shadowBladesAngle = -shadowAngle

    // --- hull shading: rim by day, cloud shadow on the sun, instruments, soot -------------------------
    let pal = st.palette
    if let pal, let ambient = pal.ambient {
      // Day: hemisphere-sky rim (DESIGN §2.7.3). Night: a faint moonlit rim so the silhouette still
      // reads against black water ("readable in the worst frame", pillar 8).
      visual.hull.rim = ambient
      visual.hull.rim.multiplyScalar(1 - night)
      if night > 0, let sun = pal.sun {
        var c = sun
        c.multiplyScalar(0.9 * night)
        visual.hull.rim.add(c)
      }
      if let sun = pal.sun {
        visual.hull.fill = sun
        visual.hull.fill.multiplyScalar(0.2 * night * night)
      }
      // Day under heavy cloud (squall/storm): the white airframe sank to ≈0.3 on screen, darker
      // than the foam around it. A soft "overcast sky on white paint" fill keeps it the most
      // readable object of the frame (DESIGN §2.1 pillar 8, hull ≤ 0.85); zero in calm sun.
      let sy = JS.max(0.2, st.sunDirShadow?.y ?? st.sunDir?.y ?? 0.7)
      func lumOf(_ c: Color3) -> Double { 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }
      let light = (pal.sunIntensity ?? 1) * sy * lumOf(pal.sun ?? ambient) + (pal.ambientIntensity ?? 0.6) * lumOf(ambient)
      let dull = MathUtil.clamp(1 - light / 1.1, 0, 1) * (1 - smooth(0.3, 0.8, night))
      if dull > 0 {
        var c = ambient
        c.multiplyScalar(0.5 / JS.max(0.05, lumOf(ambient)))
        c.lerp(Helicopter.WHITE, 0.5)
        c.multiplyScalar(0.42 * dull)
        visual.hull.fill.add(c)
      }
    }
    let cloud = ctx.cloudAt?(position.x, position.z) ?? 0
    visual.hull.sunScale = 1 - 0.2 * cloud * (1 - night)
    var instr = Color3(style: "#3AE0C8")
    instr.multiplyScalar(0.4 * (0.04 + 0.96 * night * night) * (alive ? 1 : 0.2))
    visual.hull.instr = instr
    visual.hull.soot = 0.3 + 0.7 * smooth(0.55, 0.12, hull) // engines always leave some soot

    // --- rotor veil light: the hull's light rig (sun · N·L + hemisphere), lightning, own lamps ----------
    if let pal, let ambient = pal.ambient {
      visual.veil.sunCol = pal.sun ?? ambient
      visual.veil.sunCol.multiplyScalar((pal.sunIntensity ?? 1) * visual.hull.sunScale)
      visual.veil.ambCol = ambient
      visual.veil.ambCol.multiplyScalar((pal.ambientIntensity ?? 0.6) * (1 + 3 * flash))
      visual.veil.skyCol = pal.sky ?? ambient
      visual.veil.skyCol.multiplyScalar(0.5 * (pal.ambientIntensity ?? 0.6) * (1 + 3 * flash))
    }
    if let sd = st.sunDir { visual.veil.sunDir = sd }
    let lc = lightsCtl
    let glowK = 0.1 + 1.1 * night // irradiance-scale: a strobe flash catches the veil at night
    // broad: the searchlight pool bouncing up; local (falls off from the lamp over the veil): beacon, strobes
    visual.veil.glow.setRGB(1, 1, 1)
    visual.veil.glow.multiplyScalar(JSNumber.or(beam.intensity, 0) * glowK * 0.12)
    visual.veil.glowB.setRGB(1, 0.08, 0.06)
    visual.veil.glowB.multiplyScalar(lc.beacon * glowK * 0.9)
    visual.veil.glowS.setRGB(1, 1, 1)
    visual.veil.glowS.multiplyScalar(lc.strobe * glowK * 1.4)

    // --- flotation bags pop when ditched ---------------------------------------------------------------
    let fl = ditched && crash?.deck == nil ? MathUtil.clamp((crash?.t ?? 0) / 0.6, 0, 1) : 0
    visual.floatsVisible = fl > 0.01
    if visual.floatsVisible { visual.floatScale.set(0.3 + 0.7 * fl, 0.3 + 0.7 * fl, 0.6 + 0.4 * fl) }

    // --- searchlight, lights, glints ---------------------------------------------------------------------
    searchlightCtl.update(dt, self, aim, body: body)
    lightsCtl.update(dt, self, body: body)

    // --- winch visuals -------------------------------------------------------------------------------------
    winch.render(dt, alpha, beam)
    crewman.update(dt, self, body: body)
    // engines are hot while turning (thermal proxies, layer 2 only)
    visual.heatVisible = !ditched && rpm > 0.2

    // --- downwash on the water (R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²) + spray ------------------
    let altW = JS.max(0, position.y - seaY)
    let R = 9 + 0.35 * altW
    let s0 = MathUtil.clamp(1 - (altW - 4) / 28, 0, 1)
    let sDw = s0 * s0 * smooth(0.3, 0.9, rpm) * (ditched ? 0 : 1)
    downwash.x = position.x
    downwash.z = position.z
    downwash.radius = R
    downwash.strength = sDw
    ctx.ocean?.setDownwash(downwash.x, downwash.z, R, sDw)
    let deckHigh = landed.flatMap { ctx.world?.pad($0) }.map { $0.position.y - seaY > 4 } ?? false
    if sDw > 0.02, let fx = ctx.fx, !deckHigh {
      sprayAcc += sDw * 260 * ctx.settings.detail() * dt
      while sprayAcc >= 3 {
        sprayAcc -= 3
        let a = ctx.random() * JS.PI * 2
        let rr = R * (0.75 + ctx.random() * 0.35)
        let dir = V2(JS.cos(a), JS.sin(a))
        fx.spray(downwash.x + dir.x * rr, downwash.z + dir.y * rr, dir, 3)
      }
    } else {
      sprayAcc = 0
    }

    // --- damage smoke (<50 % grey, <25 % black + sparks), swirled by the downwash in fx ---------------
    if hull < 0.5 || crash != nil, let fx = ctx.fx {
      smokeT -= dt
      if smokeT <= 0 {
        smokeT = 0.07
        let black = hull < 0.25 || crash != nil
        var ex = ctx.random() < 0.5 ? HeliModel.Points.exhaustL : HeliModel.Points.exhaustR
        ex.applyMatrix4(body)
        fx.smoke(ex.x, ex.y, ex.z, black ? "#0A0A0A" : "#2A2A2A", black ? 1.4 : 0.8)
        if black {
          sparkT -= 0.07
          if sparkT <= 0 {
            sparkT = 0.2 + ctx.random() * 0.5
            fx.sparks(ex.x, ex.y, ex.z, "#FFB050", 6)
          }
        }
      }
    }

    // --- flares in flight -----------------------------------------------------------------------------------
    let flights = ops.flights
    for i in 0..<visual.flares.count {
      if i < flights.count {
        let fi = flights[i]
        visual.flares[i] = V3(fi.x, fi.y, fi.z)
        if let fx = ctx.fx, ctx.random() < 0.5 { fx.sparks(fi.x, fi.y, fi.z, "#FF6A2A", 1) }
      } else {
        visual.flares[i] = nil
      }
    }

    let drops = ops.drops
    for i in 0..<visual.rafts.count {
      if i < drops.count {
        let d = drops[i]
        visual.rafts[i] = (V3(d.x, d.y, d.z), V3(d.spin * 0.7, d.spin, d.spin * 0.4))
      } else {
        visual.rafts[i] = nil
      }
    }

    // --- rotor load (audio): .35|lift| + .4|bank|/max + .5·max(0,−vy)/6 + .3·turb, τ .15 -----------------
    let loadT = MathUtil.clamp(0.35 * JS.abs(liftAxis) + (0.4 * JS.abs(bank)) / Helicopter.MAX_TILT + (0.5 * JS.max(0, -vy)) / 6
      + 0.3 * MathUtil.clamp(f.turb / 4, 0, 1), 0, 1)
    load += (loadT - load) * (1 - JS.exp(-dt / 0.15))
  }

  // ---- hooks from the flight model ---------------------------------------------------------------------
  public func onWaterStrike(_ x: Double, _ z: Double, _ strength: Double) {
    ctx.ocean?.splash(x, z, 6, 0.8)
    ctx.fx?.splash(x, seaY, z, 2.5)
    ctx.events.emit(GameEvent.HeliWaterStrike(x: x, z: z, strength: strength))
  }

  public func onTouch(_ pad: LandingPad, _ relVy: Double) {
    ctx.events.emit(GameEvent.HeliTouchdown(pad: pad.id, vy: relVy))
  }
}
