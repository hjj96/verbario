// WeatherSim — the mood engine's state machine (systems/weather.js; DESIGN §2.3, §2.5, §2.7, §3.13;
// CONTRACT «weather»), bit-exact with the web (Tests/Vectors/weather/run_*.json).
//
// Owns: the blended palette (+ palettePrev / paletteNext for the spatial front), staged transitions,
// wind field (mean + wander + cat's-paw gust field + gust fronts), lightning scheduling and the flash
// envelope, the barometer, time of day, the two scene lights (WeatherLights), the environment re-bake
// schedule (WeatherEnv), the shared look uniforms (uRain / uWet / uFlash / uNight, wind, gust fronts) and
// the «Смена» escalation (EndlessPlanner).
//
// How the web's `ctx` maps here:
//   ctx.mode / ctx.heli / ctx.camera / ctx.world.obstacles → the per-frame inputs `mode`, `heli`, `camera`,
//     `obstacles` (set by the host before update; the `game:mode` event also sets `mode`);
//   ctx.look → `look` (gustField / setWind / setFronts / uniforms), ctx.noise → `noise` (createNoise2D(1337));
//   ctx.params ?weather= / ?tod= → `Options.forcedPreset` / `forcedTimeOfDay`;
//   scene.fog / scene.background / renderer.toneMappingExposure / scene.environment → the outputs `fog`,
//     `background`, `exposure`, `env` and `lights.state` (the renderer applies them; WeatherBridge).
// Events (same names, payloads and order as the web): weather:preset, weather:gust, weather:charge,
// weather:lightning, weather:pressure; listens to mission:setup, mission:start, game:mode.
// RNG: one mulberry32 (4242, reseeded on mission:setup with SeedFormulas.weather) shared by the gusts,
// lightning, lights swing and endless planner — draws happen in the web's order.

/// weather.state (CONTRACT + the extras listed in weather.js).
public struct WeatherState: Equatable, Sendable {
  /// state.front: the spatial weather front (DESIGN §2.5); blend per pixel mix(paletteNext, palettePrev, f).
  public struct Front: Equatable, Sendable {
    public var origin = V2(0, 0)
    public var dir = V2(1, 0)
    public var speed: Double
    public var width: Double
    public var active = false
    public var t: Double = 0
  }

  /// state.transition
  public struct Transition: Equatable, Sendable {
    public var active = false
    public var from = "calm"
    public var to = "calm"
    public var t: Double = 0
    public var over: Double = 0
    public var progress: Double = 1
  }

  /// state.lastStrike {x, z, distance, cloudOnly, t}
  public struct Strike: Equatable, Sendable {
    public var x: Double = 0
    public var z: Double = 0
    public var distance: Double = .infinity
    public var cloudOnly = true
    public var t: Double = -99
  }

  /// state.rates: hazards' random spawn rates, per minute.
  public struct Rates: Equatable, Sendable {
    public var lightning: Double = 0
    public var spouts: Double = 0
    public var rogues: Double = 0
  }

  public var preset = "calm"
  public var presetLabel: String
  public var intensity: Double = 0
  public var windDir = V2(0, 1)
  public var windSpeed: Double = 3
  /// Meteorological «from» bearing, degrees (HUD «ВЕТЕР 250°»).
  public var windFrom: Double = 0
  public var gust: Double = 0
  public var gustMax: Double = 3
  public var rain: Double = 0
  public var fog: Double = 0
  public var hail: Double = 0
  public var lightning: Double = 0
  public var waveHeight: Double = 0.4
  public var waveChoppiness: Double = 0.25
  public var night: Double = 0
  public var timeOfDay: Double = 0.4
  public var flash: Double = 0
  public var flashColor: PaletteColor
  public var visibility: Double = 20000
  public var palette: Palette
  public var palettePrev: Palette
  public var paletteNext: Palette
  /// Light direction actually used (cheated sun, or the strike during a swing).
  public var sunDir = V3(0, 1, 0)
  /// Cheated sun of the preset (clamped elevation).
  public var sunDirShadow = V3(0, 1, 0)
  /// True sun (glitter, sky warmth).
  public var sunDirVisual = V3(0, 1, 0)
  public var front: Front
  public var greenTint: Double = 0
  public var stElmo: Double = 0
  public var pressure: Double = 1016
  /// −1 falling, 0 steady, +1 rising
  public var pressureTrend: Double = 0
  /// The live gust fronts (gusts.active), refreshed whenever the gust list changes.
  public var gustFronts: [GustFronts.Front] = []
  public var turbulence: Double = 0.3
  public var beaufort: Double = 2
  public var seaState: Double = 2
  public var wet: Double = 0
  public var rates = Rates()
  public var transition = Transition()
  public var lastStrike = Strike()
  public var severity: Double = 0
}

/// One mission weather script entry {at, to, over?, windFrom?, windShift?, eye?}.
public struct WeatherScriptEntry: Equatable, Sendable, Codable {
  public var at: Double
  public var to: String
  public var over: Double?
  public var windFrom: Double?
  public var windShift: Double?
  public var eye: Bool

  public init(at: Double, to: String, over: Double? = nil, windFrom: Double? = nil, windShift: Double? = nil, eye: Bool = false) {
    self.at = at
    self.to = to
    self.over = over
    self.windFrom = windFrom
    self.windShift = windShift
    self.eye = eye
  }

  /// From a JSON entry (missing / non-number `at` reads as NaN, like `undefined` in the comparisons).
  public init?(json s: JSONValue) {
    guard s.jsTruthy, let to = s["to"].string else { return nil }
    self.init(at: s["at"].double ?? .nan, to: to, over: s["over"].double, windFrom: s["windFrom"].double,
              windShift: s["windShift"].double, eye: s["eye"].jsTruthy)
  }
}

/// checkpointState(): the transition in flight at a landing (its clock, rain onset and the front's track)
/// and the barometer, for restoreCheckpoint() to resume the blend exactly where it was.
public struct WeatherCheckpoint: Equatable, Sendable, Codable {
  public struct Tr: Equatable, Sendable, Codable {
    public var active: Bool
    public var t: Double
    public var over: Double
    public var wavesDown: Bool
    public var rainUp: Bool
    public var rainStart: Double
    public var frontEnd: Double
  }

  public struct Front: Equatable, Sendable, Codable {
    public var t: Double
    public var ox: Double
    public var oz: Double
    public var dx: Double
    public var dz: Double
  }

  public var preset: String
  public var scriptIdx: Int
  public var tr: Tr
  public var front: Front?
  public var pressure: Double
  public var wet: Double
}

/// forecast() entry {in, preset, label, short, severity, worse, windFrom}.
public struct WeatherForecast: Equatable, Sendable {
  public var `in`: Double
  public var preset: String
  public var label: String
  public var short: String
  public var severity: Double
  public var worse: Bool
  public var windFrom: Double
}

/// Per-frame heli input (ctx.heli: position, altitude).
public struct WeatherHeliInput: Equatable, Sendable {
  public var position: V3
  /// heli.altitude (non-finite / nil → position.y)
  public var altitude: Double?

  public init(position: V3, altitude: Double? = nil) {
    self.position = position
    self.altitude = altitude
  }
}

/// Per-frame camera input (ctx.camera: position and getWorldDirection()).
public struct WeatherCameraInput: Equatable, Sendable {
  public var position: V3
  /// Unit world direction the camera looks along.
  public var direction: V3

  public init(position: V3, direction: V3) {
    self.position = position
    self.direction = direction
  }
}

public final class WeatherSim {
  /// URL overrides (DESIGN §8.4): ?weather=<preset> forces the preset and disables scripts; ?tod=.
  public struct Options: Sendable {
    public var forcedPreset: String?
    public var forcedTimeOfDay: Double?
    public init(forcedPreset: String? = nil, forcedTimeOfDay: Double? = nil) {
      self.forcedPreset = forcedPreset
      self.forcedTimeOfDay = forcedTimeOfDay
    }
  }

  // ---- context ---------------------------------------------------------------------------------------
  public let tables: WeatherTables
  public let events: EventBus
  public private(set) weak var settings: GameSettings?
  /// ctx.look (nil: gust field reads 0.5 and nothing is written).
  public let look: Look?
  /// ctx.noise (createNoise2D(1337)); nil: no wander.
  public let noise: SimplexNoise2D?

  // ---- per-frame inputs ------------------------------------------------------------------------------
  public var mode: GameMode
  public var heli: WeatherHeliInput?
  public var camera: WeatherCameraInput?
  public var obstacles: [WeatherObstacle] = []

  // ---- outputs ---------------------------------------------------------------------------------------
  public private(set) var state: WeatherState
  public let gusts: GustFronts
  public let lightning: LightningSim
  public let endless: EndlessPlanner
  public let lights: WeatherLights
  public private(set) var env = WeatherEnv()
  /// scene.fog (THREE.Fog, linear colour; lit by lightning) and scene.background (= the fog colour).
  public private(set) var fogColor: PaletteColor
  public private(set) var fogNear: Double
  public private(set) var fogFar: Double
  public var background: PaletteColor { fogColor }
  /// renderer.toneMappingExposure baseline (post refines it every frame).
  public private(set) var exposure: Double = 1

  // ---- internals (names as in weather.js) ------------------------------------------------------------
  let rng: Rng
  var from: [Double]
  var to: [Double]
  var cur: [Double]
  var out: [Double]
  var tCh: [Double]
  var tr = WeatherCheckpoint.Tr(active: false, t: 0, over: 0, wavesDown: false, rainUp: false, rainStart: -1, frontEnd: 0)
  var windTo: Double
  var windA0: Double
  var windA1: Double
  var windAngle: Double
  var meanWind = V2()
  public private(set) var greenTarget: Double = 0
  /// Weather time (s, game time).
  public private(set) var clock: Double = 0
  public private(set) var script: [WeatherScriptEntry] = []
  public private(set) var scriptIdx = 0
  public private(set) var scriptT: Double = 0
  public private(set) var attract = false
  var attractT: Double = 0
  var attractIdx = 0
  var attractBolt: Double? = nil
  var eye = false
  var pTrendRate: Double = 0
  var pEmitted: Double = 1016
  var pEmittedTrend: Double = 0
  var greenApplied: Double = -1
  public let forced: String?
  public let forcedTod: Double?
  /// The last mission definition (mission:setup), nil before the first setup.
  public private(set) var def: JSONValue? = nil
  /// Heli position / altitude as last read (weather updates first: last frame's heli).
  public private(set) var heliPos = V3()
  public private(set) var heliAlt: Double = 40
  public private(set) var camFocus = V3()

  private var subscriptions: [EventSubscription] = []
  private var settingsSub: SettingsSubscription?

  public init(tables: WeatherTables, events: EventBus, settings: GameSettings?, look: Look?, noise: SimplexNoise2D?,
              mode: GameMode = .title, options: Options = Options()) {
    self.tables = tables
    self.events = events
    self.settings = settings
    self.look = look
    self.noise = noise
    self.mode = mode
    // Own deterministic RNG (reseeded from the mission seed); sub-modules hold the same object.
    rng = Rng(seed: 4242)

    let pt = tables.palette
    let calm = pt.compiled["calm"] ?? [Double](repeating: 0, count: pt.slots)
    to = calm
    from = calm
    cur = calm
    out = [Double](repeating: 0, count: pt.slots)
    tCh = [Double](repeating: 1, count: PaletteChannel.count)

    gusts = GustFronts(tables: tables, rng: rng, settings: settings)
    lightning = LightningSim(tables: tables, rng: rng)
    endless = EndlessPlanner(tables: tables, rng: rng)

    var palette = Palette()
    palette.unpack(cur)
    state = WeatherState(presetLabel: tables.labels["calm"]?.label ?? "", flashColor: tables.flashDay, palette: palette,
                         palettePrev: palette, paletteNext: palette,
                         front: WeatherState.Front(speed: tables.frontSpeed, width: tables.frontWidth))

    windTo = 120 * MathUtils.DEG2RAD
    windA0 = windTo
    windA1 = windTo
    windAngle = windTo

    if let wp = options.forcedPreset, tables.has(wp) { forced = wp } else { forced = nil }
    if let tod = options.forcedTimeOfDay, tod.isFinite {
      forcedTod = (tod.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
    } else {
      forcedTod = nil
    }

    lights = WeatherLights(tables: tables, quality: settings?.quality)
    fogColor = palette.fogColor
    fogNear = palette.fogNear
    fogFar = palette.fogFar

    lightning.onStrike = { [unowned self] x, z in
      let hp = self.heliPos
      self.lights.swing(x, z, hp.x, hp.z, self.rng)
    }

    subscriptions.append(events.on(.missionSetup) { [unowned self] e in
      if case .missionSetup(let p) = e { self.onSetup(p.def) }
    })
    subscriptions.append(events.on(.missionStart) { [unowned self] _ in self.scriptT = 0 })
    subscriptions.append(events.on(.gameMode) { [unowned self] e in
      if case .gameMode(let p) = e {
        self.mode = p.to
        if p.to == .title { self.startAttract(3) }
      }
    })
    settingsSub = settings?.onChange { [unowned self] key, _ in
      if key == "quality" { self.lights.applyQuality(self.settings?.quality) }
    }
  }

  deinit {
    for s in subscriptions { s.off() }
    settingsSub?.off()
  }

  /// init(): wind from 300° before any mission, the title showcase or the forced / current preset
  /// (instant), the forced time of day, then one update(0).
  public func start() {
    if def == nil { setWindFrom(300, instant: true) }
    if mode == .title && def == nil {
      startAttract(0)
    } else {
      setPreset(forced ?? state.preset, over: 0)
    }
    if let t = forcedTod { state.timeOfDay = t }
    update(0)
  }

  // ==================================================================================================
  // Public API (CONTRACT)

  /// Staged transition to a preset (DESIGN §2.5). windFrom (deg, «from» bearing) rotates the wind with
  /// the wind channel (mission 8's 180° reversal). Returns false for an unknown preset.
  @discardableResult
  public func setPreset(_ name: String, over overIn: Double = 30, windFrom: Double? = nil) -> Bool {
    guard tables.has(name), let target = tables.palette.compiled[name] else { return false }
    let fromName = state.preset
    let over = JS.max(0, overIn.isNaN ? 0 : overIn) // Math.max(0, Number(over) || 0)
    eye = false

    from = cur
    to = target
    windA0 = windAngle
    windA1 = windFrom.map { ($0 + 180) * MathUtils.DEG2RAD } ?? windAngle
    if windFrom != nil { windTo = windA1 }

    let off = tables.palette.off
    let hs = off["sea.Hs"] ?? 0, rn = off["rain"] ?? 0
    tr.t = 0
    tr.over = over
    tr.wavesDown = to[hs] < cur[hs]
    tr.rainUp = to[rn] > cur[rn] + 1e-3
    tr.rainStart = -1
    tr.active = over > 0

    state.front.active = false
    if tr.active && over >= tables.frontMinOver {
      // The front comes from upwind along the NEW wind and passes over the heli mid-transition.
      let a = windA1
      state.front.dir = V2(JS.sin(a), -JS.cos(a))
      let d = tables.frontSpeed * over * 0.5
      state.front.origin = V2(heliPos.x - state.front.dir.x * d, heliPos.z - state.front.dir.y * d)
      state.front.t = 0
      state.front.active = true
      tr.frontEnd = over * 0.5 + 30 // front ≈ 600 m past the heli
    } else {
      tr.frontEnd = 0
    }

    if !tr.active {
      cur = to
      windAngle = windA1
      for i in tCh.indices { tCh[i] = 1 }
    }
    state.preset = name
    state.presetLabel = tables.labels[name]?.label ?? ""
    state.severity = tables.severityOf(name)
    state.transition = WeatherState.Transition(active: tr.active, from: fromName, to: name, t: 0, over: over,
                                               progress: tr.active ? 0 : 1)
    refreshPrevNext(force: true)
    env.markDirty()

    let wf = ((windA1 / MathUtils.DEG2RAD + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    events.emit(GameEvent.WeatherPreset(
      from: fromName, to: name, over: over,
      worse: tables.severityOf(name) > tables.severityOf(fromName),
      label: tables.labels[name]?.label ?? "",
      windFrom: JS.round(wf),
      gust: JS.round((tables.wind[name] ?? .nan) + (tables.gustStrength[name] ?? .nan))))
    return true
  }

  /// Wind at a point (m/s; x = world X, y = world Z): mean · (0.85 + 0.3·gustField) + gust fronts.
  public func windAt(_ x: Double, _ z: Double) -> V2 {
    let g = look?.gustField(x, z) ?? 0.5
    let s = state.windSpeed * (0.85 + 0.3 * g)
    var o = V2(state.windDir.x * s, state.windDir.y * s)
    gusts.addWindAt(x, z, &o)
    return o
  }

  /// Upcoming changes, soonest first. Campaign scripts are exact; «Смена» forecasts are 80 % accurate.
  public func forecast() -> [WeatherForecast] {
    var out = [WeatherForecast]()
    if forced != nil { return out }
    var i = scriptIdx
    while i < script.count {
      let s = script[i]
      var e = fcEntry(JS.max(0, s.at - scriptT), s.to)
      if let wf = s.windFrom {
        e.windFrom = wf
      } else if let ws = s.windShift, JSNumber.isTruthy(ws) {
        e.windFrom = ((e.windFrom + ws).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
      }
      out.append(e)
      i += 1
    }
    if endless.active { endless.forEachUpcoming(timeOfDay: state.timeOfDay) { out.append(fcEntry($0, $1)) } }
    return out
  }

  func fcEntry(_ inS: Double, _ preset: String) -> WeatherForecast {
    let l = tables.labels[preset]
    return WeatherForecast(in: inS, preset: preset, label: l?.label ?? "", short: l?.short ?? "",
                           severity: tables.severityOf(preset),
                           worse: tables.severityOf(preset) > tables.severityOf(state.preset), windFrom: state.windFrom)
  }

  /// strikeLightning() options: { cloudOnly, strength, charge: true → telegraphed sea strike, eta, radius, target }.
  public struct StrikeOptions: Sendable {
    public var cloudOnly: Bool
    public var strength: Double
    public var charge: Bool
    public var eta: Double?
    public var radius: Double
    public var target: String

    public init(cloudOnly: Bool = false, strength: Double = 1, charge: Bool = false, eta: Double? = nil,
                radius: Double = 30, target: String = "sea") {
      self.cloudOnly = cloudOnly
      self.strength = strength
      self.charge = charge
      self.eta = eta
      self.radius = radius
      self.target = target
    }
  }

  /// Forced lightning (hazards: tornado internal lightning, scripted strikes). Returns the charge slot
  /// for a telegraphed strike, else nil.
  @discardableResult
  public func strikeLightning(_ x: Double, _ z: Double, _ opts: StrikeOptions = StrikeOptions()) -> Int? {
    if opts.charge && !opts.cloudOnly {
      return lightning.charge(self, x, z, LightningSim.ChargeOptions(eta: opts.eta, radius: opts.radius, target: opts.target,
                                                                     strength: opts.strength))
    }
    lightning.strike(self, x, z, cloudOnly: opts.cloudOnly, strength: opts.strength)
    return nil
  }

  public func setGreenTint(_ v: Double) {
    greenTarget = MathUtil.clamp(JSNumber.isTruthy(v) ? v : 0, 0, 1)
  }

  /// Hail level 0…1 at the heli (hazards' hail cells drive it; fx rain pellets / bounces read state.hail).
  public func setHail(_ v: Double) {
    state.hail = MathUtil.clamp(JSNumber.isTruthy(v) ? v : 0, 0, 1)
  }

  /// Scripted gust front (onboarding: harmless, labelled «ПОРЫВ»). Reaches the heli in `eta` s.
  @discardableResult
  public func spawnGust(_ opts: GustFronts.SpawnOptions = GustFronts.SpawnOptions()) -> GustFronts.Front {
    let slot = gusts.spawn(heliPos.x, heliPos.z, state.windDir, state.windSpeed, opts)
    state.gustFronts = gusts.active
    emitGust(slot)
    return gusts.pool[slot]
  }

  /// «Смена» escalation (mission calls this in endless mode; also started by def.endless).
  public func runEndless() {
    // `!this.def || !(this.def.timeOfDay > 0)` (relational comparison: ToNumber; missing → NaN → false)
    if def == nil || !((def?["timeOfDay"] ?? .null).jsToNumber > 0) {
      if forcedTod == nil { state.timeOfDay = 9.0 / 24 }
    }
    script = []
    scriptIdx = 0
    endless.start(state.timeOfDay)
  }

  /// DESIGN §3.10 detection table for the current blend.
  public func detectBase() -> (base: Double, altBonus: Double) {
    (state.palette.detect.base, state.palette.detect.altBonus)
  }

  /// Run a mission weather definition {start, script: [{at, to, over, windFrom?, windShift?}], windFrom?}.
  public func runScript(_ w: JSONValue) {
    endless.stop()
    attract = false
    let start: String
    if let f = forced {
      start = f
    } else if let s = w["start"].string, tables.has(s) {
      start = s
    } else {
      start = "calm"
    }
    if forced != nil {
      script = []
    } else {
      let entries = (w["script"].array ?? []).compactMap { WeatherScriptEntry(json: $0) }.filter { tables.has($0.to) }
      script = WeatherSim.sortByAt(entries)
    }
    scriptIdx = 0
    scriptT = 0
    eye = false
    let windFrom = w["windFrom"].double ?? (220 + rng.next() * 110)
    setWindFrom(windFrom, instant: true)
    setPreset(start, over: 0)
    state.pressure = 1016 - 38 * (tables.intensity[start] ?? .nan)
    pEmitted = state.pressure
  }

  /// Array.prototype.sort((a, b) => a.at - b.at): stable (V8 TimSort), "a before b" only when a.at − b.at < 0.
  static func sortByAt(_ a: [WeatherScriptEntry]) -> [WeatherScriptEntry] {
    var r = a
    if r.count < 2 { return r }
    for i in 1..<r.count {
      let x = r[i]
      var j = i - 1
      while j >= 0 && (x.at - r[j].at) < 0 {
        r[j + 1] = r[j]
        j -= 1
      }
      r[j + 1] = x
    }
    return r
  }

  /// Sun multiplier from cloud shadows at a point (same field as the ocean's layer 6): ~0.72…1.2.
  public func cloudShadowAt(_ x: Double, _ z: Double) -> Double {
    let p = state.palette
    let k = p.cloudShadow * (1 - p.night)
    guard JS.abs(k) >= 1e-3, let look else { return 1 }
    let c = look.cloudAt(x, z)
    return k > 0 ? 1 - 0.28 * c * k : 1 + 0.2 * c * -k
  }

  public var labels: [String: WeatherLabel] { tables.labels }
  public var presets: [String] { tables.presetNames }

  // ==================================================================================================
  // Mission integration

  func onSetup(_ d: JSONValue) {
    let def: JSONValue = d.isNull ? .object(JSONObject()) : d
    self.def = def
    let seed = def["seed"].isNull ? 1 : def["seed"].jsToNumber // (def.seed ?? 1)
    rng.core = Mulberry32(state: SeedFormulas.weather(seed))
    gusts.reset()
    state.gustFronts = []
    lightning.reset()
    greenTarget = 0
    state.greenTint = 0
    state.hail = 0
    state.wet = 0
    runScript(def["weather"].jsTruthy ? def["weather"] : .object(JSONObject()))
    if let t = forcedTod {
      state.timeOfDay = t
    } else if let t = def["timeOfDay"].double, t.isFinite {
      state.timeOfDay = t
    } else {
      state.timeOfDay = 0.4
    }
    if def["endless"].jsTruthy { runEndless() }
    // Title scene: weather runs the 45 s showcase cycle itself (mission checks weather.attract).
    if def["attract"].jsTruthy && forced == nil {
      attract = true
      attractT = 0
      attractIdx = tables.attractCycle.firstIndex(of: state.preset) ?? 0 // Math.max(0, indexOf(preset))
    }
  }

  func startAttract(_ over: Double) {
    if forced != nil || attract { return }
    guard let first = tables.attractCycle.first else { return }
    attract = true
    attractT = 0
    attractIdx = 0
    setPreset(first, over: over)
  }

  func setWindFrom(_ deg: Double, instant: Bool) {
    let a = (deg + 180) * MathUtils.DEG2RAD
    windTo = a
    if instant {
      windA0 = a
      windA1 = a
      windAngle = a
    }
  }

  func emitGust(_ slot: Int?) {
    guard let s = slot else { return }
    let f = gusts.pool[s]
    events.emit(GameEvent.WeatherGust(dir: V2(f.dirX, f.dirZ), strength: f.baseStrength, eta: f.eta, x: f.x, z: f.z,
                                      harmless: f.harmless))
  }

  // ==================================================================================================
  // Frame update

  public func update(_ dt: Double) {
    let playing = mode == .play
    clock += dt

    // Heli / camera focus (read from last frame; weather updates first).
    if let h = heli {
      heliPos = h.position
      if let a = h.altitude, a.isFinite { heliAlt = a } else { heliAlt = h.position.y }
    }
    updateCamFocus()

    // Clocks & schedulers.
    if playing {
      scriptT += dt
      state.timeOfDay = (state.timeOfDay + (dt * (endless.active ? tables.clockRate : 1)) / 86400).truncatingRemainder(dividingBy: 1)
    }
    runSchedulers(dt, playing)

    // Transition progress → blended palette.
    progress(dt)
    let pt = tables.palette
    pt.blendPacked(&cur, from, to, tCh)
    state.greenTint = MathUtil.damp(state.greenTint, greenTarget, 0.5, dt)
    out = cur
    pt.applyGreen(&out, state.greenTint)
    state.palette.unpack(out)
    refreshPrevNext(force: false)

    let p = state.palette
    // Scalars for everyone else.
    state.intensity = p.intensity
    state.rain = p.rain
    state.lightning = p.lightning
    state.night = p.night
    state.fog = p.fog
    state.visibility = p.visibility
    state.waveHeight = p.sea.Hs
    state.waveChoppiness = p.sea.Q
    state.turbulence = p.turbulence
    state.rates.lightning = p.lightningPerMin * (state.intensity >= 0.6 - 1e-3 ? 1 : 0)
    state.rates.spouts = p.spoutsPerMin
    state.rates.rogues = p.roguesPerMin
    updateSun(p)

    // Wind: base bearing (rotating with the wind channel) + ±15°/min wander.
    let tw = tCh[PaletteChannel.wind]
    windAngle = windA0 + WeatherSim.wrapPi(windA1 - windA0) * tw
    let wander = (noise?.noise(clock / 55, 7.31) ?? 0) * 15 * MathUtils.DEG2RAD
    let a = windAngle + wander
    state.windDir = V2(JS.sin(a), -JS.cos(a))
    state.windSpeed = p.wind
    state.windFrom = JS.round(((a / MathUtils.DEG2RAD + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360))
    state.gustMax = p.wind + p.gustStrength
    meanWind = V2(state.windDir.x * state.windSpeed, state.windDir.y * state.windSpeed)

    // Gust fronts (random per preset; scripted via spawnGust).
    let spawned = gusts.update(dt, heliPos.x, heliPos.z, state.windDir, state.windSpeed, p.gustStrength, p.gustRate,
                               dt > 0 && mode != .briefing)
    state.gustFronts = gusts.active
    emitGust(spawned)

    // Shared look layer.
    if let look {
      look.setWind(meanWind, dt)
      look.setFronts(gusts.lookFronts)
    }

    // Lightning, flash, St. Elmo.
    lightning.update(dt, self, allowRandom: dt > 0 && mode != .briefing && mode != .debrief, playing: playing)

    // Wetness: follows rain up quickly, dries over 30 s.
    state.wet = state.rain > state.wet ? MathUtil.damp(state.wet, state.rain, 0.8, dt) : JS.max(state.rain, state.wet - dt / 30)

    if let look {
      look.rain = state.rain
      look.wet = state.wet
      look.flash = state.flash
      look.night = state.night
    }

    updatePressure(dt)

    // At the heli: gust magnitude, HUD numbers.
    let v = windAt(heliPos.x, heliPos.z)
    state.gust = JS.max(0, v.length - state.windSpeed)
    state.beaufort = WeatherSim.countBelow(tables.beaufort, state.windSpeed)
    state.seaState = state.waveHeight <= 0.02 ? 0 : 1 + WeatherSim.countBelow(tables.douglas, state.waveHeight)

    // Scene: lights, fog, background, environment.
    lights.update(dt, &state, focus: heliPos, alt: JS.max(0, heliAlt), camFocus: camFocus)
    // The fog bubble is lit by lightning too (silver-blue scatter).
    let k = state.flash * 0.025
    let fc = state.flashColor
    fogColor = PaletteColor(p.fogColor.r + fc.r * k, p.fogColor.g + fc.g * k, p.fogColor.b + fc.b * k)
    fogNear = p.fogNear
    fogFar = JS.max(p.fogNear + 1, p.fogFar)
    env.update(clock: clock, envIntensity: p.envIntensity, flash: state.flash, transitioning: tr.active)
    // Exposure baseline (post refines it every frame with the flash / afterimage).
    exposure = p.exposure * (1 + 2.4 * state.flash)
  }

  func runSchedulers(_ dt: Double, _ playing: Bool) {
    // Title screen: cycle the showcase presets.
    if attract {
      if mode != .title {
        attract = false
      } else {
        attractT += dt
        if attractT >= 45 && !tables.attractCycle.isEmpty {
          attractT = 0
          attractIdx = (attractIdx + 1) % tables.attractCycle.count
          setPreset(tables.attractCycle[attractIdx], over: 8)
        }
        // night storm on the title: a sea strike or an in-cloud flash every 8–12 s lights the scene
        // (the lightning module still applies reduceFlashes)
        let pal = state.palette
        if pal.night > 0.6 && pal.lightning > 0.5 {
          attractBolt = (attractBolt ?? 2) - dt
          if let b = attractBolt, b <= 0 {
            attractBolt = 8 + 4 * rng.next()
            let a = rng.next() * JS.PI * 2
            let d = 120 + 180 * rng.next()
            let x = heliPos.x + JS.cos(a) * d
            let z = heliPos.z + JS.sin(a) * d
            strikeLightning(x, z, StrikeOptions(cloudOnly: rng.next() < 0.45, strength: 0.85))
          }
        }
      }
    }
    if forced != nil { return }
    // Mission script.
    while scriptIdx < script.count && script[scriptIdx].at <= scriptT {
      let s = script[scriptIdx]
      scriptIdx += 1
      setPreset(s.to, over: s.over ?? 30, windFrom: windFrom(of: s))
      eye = s.eye // eye of the storm: calm air, but the barometer stays at its lowest
    }
    // Endless escalation.
    if playing && endless.active {
      if let go = endless.update(dt, preset: state.preset, timeOfDay: state.timeOfDay) { setPreset(go.to, over: go.over) }
    }
  }

  /// opts.windFrom of a script entry: its own bearing, or the current base wind shifted by windShift.
  func windFrom(of s: WeatherScriptEntry) -> Double? {
    if let wf = s.windFrom { return wf }
    if let ws = s.windShift, JSNumber.isTruthy(ws) { return windTo / MathUtils.DEG2RAD - 180 + ws }
    return nil
  }

  /// Channel progress for the current transition (DESIGN §2.5).
  func progress(_ dt: Double) {
    if !tr.active {
      for i in tCh.indices { tCh[i] = 1 }
      if state.front.active {
        state.front.t += dt
        if state.front.t > tr.frontEnd { state.front.active = false }
      }
      return
    }
    tr.t += dt
    let o = tr.over
    let tt = tr.t

    // Colours & light: smootherstep in time, or — with a spatial front — switch as the front passes
    // over the heli (time fallback completes by 1.3·over if the heli outruns it).
    var col = WeatherSim.smootherstep(tt / o)
    var lead = 0.0
    if state.front.active {
      state.front.t += dt
      let f0 = state.front
      let along = (heliPos.x - f0.origin.x) * f0.dir.x + (heliPos.z - f0.origin.y) * f0.dir.y - f0.speed * f0.t
      let f = WeatherSim.smooth01((along + f0.width) / (2 * f0.width)) // 1 = old weather still at the heli
      lead = 1 - WeatherSim.smooth01((along - f0.width) / f0.width) // leading edge (W ahead) reached
      col = JS.max(1 - f, WeatherSim.smootherstep((tt - o) / (0.3 * o)))
    }
    // Wind, gusts, cat's paws: lead by 15 %.
    let wind = JS.max(WeatherSim.smootherstep(tt / (0.85 * o)), col)
    // Rain: from +10 % (or the front's leading edge), sparse → pow(t, 2.5) over 8 s.
    let rain: Double
    if tr.rainUp {
      if tr.rainStart < 0 && (state.front.active ? lead > 0.02 || tt >= o : tt >= 0.1 * o) { tr.rainStart = tt }
      let ramp = JS.min(8, JS.max(0.5, 0.9 * o))
      rain = tr.rainStart < 0 ? 0 : JS.pow(MathUtil.clamp((tt - tr.rainStart) / ramp, 0, 1), 2.5)
    } else {
      rain = col
    }
    // Waves lag: from +25 % to 140 %; calming takes twice as long (swell outlives the wind).
    let span = 1.15 * o * (tr.wavesDown ? 2 : 1)
    let wave = WeatherSim.smooth01((tt - 0.25 * o) / span)

    tCh[PaletteChannel.color] = col
    tCh[PaletteChannel.wind] = wind
    tCh[PaletteChannel.rain] = rain
    tCh[PaletteChannel.wave] = wave
    state.transition.t = tt
    state.transition.progress = col

    if col >= 1 && wind >= 1 && rain >= 1 && wave >= 1 {
      tr.active = false
      state.transition.active = false
      state.transition.progress = 1
      windAngle = windA1
      windA0 = windA1
      env.markDirty()
      if state.front.active && state.front.t > tr.frontEnd { state.front.active = false }
    }
  }

  func refreshPrevNext(force: Bool) {
    if !force && !tr.active && !state.front.active && JS.abs(state.greenTint - greenApplied) < 1e-3 { return }
    greenApplied = state.greenTint
    let pt = tables.palette
    var tmp = from
    pt.applyGreen(&tmp, state.greenTint)
    state.palettePrev.unpack(tmp)
    tmp = to
    pt.applyGreen(&tmp, state.greenTint)
    state.paletteNext.unpack(tmp)
  }

  func updateSun(_ p: Palette) {
    let az = p.sunAz * MathUtils.DEG2RAD
    let ev = p.sunElev * MathUtils.DEG2RAD
    let es = p.shadowElev * MathUtils.DEG2RAD
    // north = −Z, east = +X; azimuth clockwise from north
    state.sunDirVisual = V3(JS.sin(az) * JS.cos(ev), JS.sin(ev), -JS.cos(az) * JS.cos(ev))
    state.sunDirShadow = V3(JS.sin(az) * JS.cos(es), JS.sin(es), -JS.cos(az) * JS.cos(es))
  }

  func updatePressure(_ dt: Double) {
    // Target: current preset's storminess, or the upcoming one if it is worse and ≤ 15 s away.
    var I = tables.intensity[state.preset] ?? .nan
    if forced == nil {
      if scriptIdx < script.count {
        let s = script[scriptIdx]
        if s.at - scriptT <= 15 { I = JS.max(I, tables.intensity[s.to] ?? .nan) }
      }
      if endless.active, let u = endless.upcoming(timeOfDay: state.timeOfDay), u.in <= 15 {
        I = JS.max(I, tables.intensity[u.preset] ?? .nan)
      }
    }
    let target = eye ? 1016 - 38 - 6 : 1016 - 38 * I
    let prev = state.pressure
    state.pressure = MathUtil.damp(state.pressure, target, 1.0 / 7, dt)
    if dt > 0 { pTrendRate = MathUtil.damp(pTrendRate, (state.pressure - prev) / dt, 0.6, dt) }
    let trend: Double = pTrendRate < -0.03 ? -1 : pTrendRate > 0.03 ? 1 : 0
    state.pressureTrend = trend
    if trend != pEmittedTrend || JS.abs(state.pressure - pEmitted) >= 1 {
      pEmittedTrend = trend
      pEmitted = state.pressure
      events.emit(GameEvent.WeatherPressure(pressure: state.pressure, trend: trend))
    }
  }

  func updateCamFocus() {
    guard let cam = camera else { return }
    let f = cam.direction
    if f.y < -0.05 {
      let k = cam.position.y / -f.y
      camFocus = V3(cam.position.x + f.x * k, 0, cam.position.z + f.z * k)
    } else {
      camFocus = V3(heliPos.x, 0, heliPos.z)
    }
  }

  // ==================================================================================================
  // Checkpoint restore (mission.js, DESIGN §3.9)

  public func checkpointState() -> WeatherCheckpoint {
    let f = state.front
    return WeatherCheckpoint(
      preset: state.preset, scriptIdx: scriptIdx, tr: tr,
      front: f.active ? WeatherCheckpoint.Front(t: f.t, ox: f.origin.x, oz: f.origin.y, dx: f.dir.x, dz: f.dir.y) : nil,
      pressure: state.pressure, wet: state.wet)
  }

  /// Jump the mission weather script to `t` s of play (called right after mission:start). Every entry
  /// already due is applied with its wind shift; the earlier ones land instantly, the latest keeps its full
  /// duration and resumes at the progress it had: from `snap` (checkpointState() at the landing) when it
  /// describes that same transition, else advanced by the t − at already elapsed. A blend is never
  /// restarted from 0 %.
  public func restoreCheckpoint(_ t: Double, _ snap: WeatherCheckpoint? = nil) {
    if forced != nil || !(t > 0) { return }
    scriptT = t
    var due = [WeatherScriptEntry]()
    while scriptIdx < script.count && script[scriptIdx].at <= t {
      due.append(script[scriptIdx])
      scriptIdx += 1
    }
    let same = snap.flatMap { !$0.preset.isEmpty && $0.scriptIdx == scriptIdx ? $0 : nil }
    for (i, s) in due.enumerated() {
      let wf = windFrom(of: s)
      let last = i == due.count - 1
      let run = last && !(same.map { $0.preset == s.to && !$0.tr.active } ?? false)
      setPreset(s.to, over: run ? s.over ?? 30 : 0, windFrom: wf)
      eye = s.eye
      if run { resumeTransition(t - s.at, same.flatMap { $0.preset == s.to ? $0 : nil }) }
    }
    if let s = same {
      if s.pressure.isFinite { state.pressure = s.pressure }
      if s.wet.isFinite { state.wet = s.wet }
    }
  }

  func resumeTransition(_ elapsed: Double, _ snap: WeatherCheckpoint?) {
    if !tr.active { return }
    if let s = snap, s.tr.active {
      tr = s.tr
      state.front.active = s.front != nil
      if let f = s.front {
        state.front.t = f.t
        state.front.origin = V2(f.ox, f.oz)
        state.front.dir = V2(f.dx, f.dz)
      }
    } else {
      let e = JS.max(0, elapsed)
      tr.t = e
      if state.front.active { state.front.t = e }
      if tr.rainUp && !state.front.active && e >= 0.1 * tr.over { tr.rainStart = 0.1 * tr.over }
    }
    state.transition.t = tr.t
  }

  // ==================================================================================================
  // helpers

  /// smootherstep(x) = x ≤ 0 ? 0 : x ≥ 1 ? 1 : x³(x(6x − 15) + 10)
  @inline(__always) static func smootherstep(_ x: Double) -> Double {
    x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10)
  }

  /// smooth01(x) = x ≤ 0 ? 0 : x ≥ 1 ? 1 : x²(3 − 2x)
  @inline(__always) static func smooth01(_ x: Double) -> Double {
    x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)
  }

  /// wrapPi(a): a = (a + π) % 2π; if (a < 0) a += 2π; a − π
  @inline(__always) static func wrapPi(_ a0: Double) -> Double {
    var a = (a0 + JS.PI).truncatingRemainder(dividingBy: JS.PI * 2)
    if a < 0 { a += JS.PI * 2 }
    return a - JS.PI
  }

  static func countBelow(_ arr: [Double], _ v: Double) -> Double {
    var n = 0.0
    for x in arr where v >= x { n += 1 }
    return n
  }
}
