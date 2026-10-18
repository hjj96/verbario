// OceanSim — the ocean system facade (systems/ocean.js; DESIGN §1.1 «Море — холст», §2.6, §2.7.2) without
// the GPU: bit-exact with the web (Tests/Vectors/ocean/run_*.json, tools/export/export-sim.mjs).
//
// Owns the Gerstner bank (WaveBank) and the surface features (FeatureSet), the focus under the screen
// centre and the snapped grid offset, the analytic splash rings (24), the glints of the frame (top 8 by
// intensity), the searchlight mirror, the rotor downwash, the water-memory stamp queue (WaterMemoryQueue),
// shoals and the coastline map, and every ocean-owned uniform (OceanUniformsCPU).
//
// How the web's `ctx` maps here:
//   ctx.weather.state → `weather` (the Core WeatherSim; nil = a stub weather: every `??` fallback applies);
//   ctx.camera (getWorldPosition / getWorldDirection) → `camera`; ctx.heli → `heli`; ctx.time → `time`;
//   ctx.look → `look` (uWindOffset / uWind / uFlash); ctx.mission.def at init → `missionDef`;
//   renderer.toneMappingExposure (exposure fallback of a stub palette) → `rendererExposure`;
//   EXT_color_buffer_float / half_float (water memory possible) → `memorySupported`;
//   the scene's terrain meshes (coast bake) → setTerrain(key:vertices:).
// Frame protocol (as in the web): the host sets the inputs, calls update(dt) right after the weather,
// the other systems call the writers (splash, stamp, addWake, setDownwash, setSearchlight, addGlint,
// setFeature …), and lateUpload() runs just before the ocean draws (Mesh.onBeforeRender in the web).
// Events: listens to mission:setup, weather:preset (over 0 → snap the waves), weather:lightning (sea
// strike → splash + scar stamp); settings `quality` rebuilds the grid / memory.
// Float32 storage exactly where the web keeps Float32Arrays (splash pool, glints, shoals, features).

/// Per-frame heli input (ctx.heli: position, altitude, alive, rotorRPM).
public struct OceanHeliInput: Equatable, Sendable {
  public var position: V3
  /// heli.altitude (nil / non-finite → position.y)
  public var altitude: Double?
  /// `h.alive === false` hides the downwash and the heli uniform
  public var alive: Bool
  /// heli.rotorRPM (nil → 1)
  public var rotorRPM: Double?

  public init(position: V3, altitude: Double? = nil, alive: Bool = true, rotorRPM: Double? = nil) {
    self.position = position
    self.altitude = altitude
    self.alive = alive
    self.rotorRPM = rotorRPM
  }
}

/// Camera input: world position and the unit world direction it looks along (same as the weather's).
public typealias OceanCameraInput = WeatherCameraInput

/// One entry of setShoals(list): {x, z, radius | r}.
public struct ShoalSpec: Equatable, Sendable {
  public var x: Double?
  public var z: Double?
  public var radius: Double?
  public var r: Double?

  public init(x: Double?, z: Double?, radius: Double? = nil, r: Double? = nil) {
    self.x = x
    self.z = z
    self.radius = radius
    self.r = r
  }
}

public final class OceanSim {
  /// Art-direction multipliers (ocean.tune; 1 = DESIGN values).
  public struct Tune: Equatable, Sendable {
    public var detail: Double = 1
    public var whitecaps: Double = 1
    public var cloudShadow: Double = 1
    public var sss: Double = 1
    public var look: Double = 1
    public var glitter: Double = 1
    public init() {}
  }

  /// The searchlight mirror (ocean._search).
  public struct Search: Equatable, Sendable {
    public var pos = V3()
    public var dir = V3(0, -1, 0)
    public var cosOuter: Double = 0.95
    public var i: Double = 0
    public var lastFrame: Int = -1_000_000_000
  }

  // ---- context ---------------------------------------------------------------------------------------
  public let tables: OceanSimTables
  public let events: EventBus
  public private(set) weak var settings: GameSettings?
  public let look: Look
  public let bank: WaveBank
  public let features: FeatureSet

  // ---- per-frame inputs ------------------------------------------------------------------------------
  public weak var weather: WeatherSim?
  public var camera = OceanCameraInput(position: V3(0, 60, 0), direction: V3(0, -1, 0))
  public var heli: OceanHeliInput?
  public var time = GameTime()
  public var missionDef: JSONValue?
  public var rendererExposure: Double? = 1
  public var memorySupported = true

  // ---- state -----------------------------------------------------------------------------------------
  public private(set) var uniforms: OceanUniformsCPU
  /// World point under the screen centre.
  public private(set) var focus = V2()
  public private(set) var clearing: Double = 0
  /// 0…1 multiplier (× night); missions may lower it.
  public var bioluminescence: Double = 1
  public var tune = Tune()
  public private(set) var memory: WaterMemoryQueue?
  public private(set) var quality = ""
  public private(set) var cfg = OceanQuality(grid: 300, waves: 8, q: 2, memory: 512, glints: 8)
  public private(set) var search = Search()
  var snapQ: Double = 0
  var dwCalled = false
  var streakA: Double = 0
  var streakB: Double = 0
  var streakMix: Double = 0
  var detOff = V4(0, 0, 0, 0)
  var windOffSeen = V2(.nan, .nan)
  var coastT: Double? = nil
  var coastKey: String? = nil
  var shoalList: [ShoalSpec]? = nil
  var terrainKey = ""
  var terrainVertices: [V3] = []
  var built = false
  // splash pool (analytic rings; Float32Arrays in the web)
  var splX: [Float]
  var splZ: [Float]
  var splT0: [Float]
  var splR: [Float]
  var splS: [Float]
  public private(set) var splNext = 0
  // glints collected during the frame (Float32Arrays), uploaded at lateUpload
  var glX: [Float]
  var glZ: [Float]
  var glR: [Float]
  var glI: [Float]
  var glC: [Float]
  public private(set) var glN = 0

  private var subscriptions: [EventSubscription] = []
  private var settingsSub: SettingsSubscription?

  public init(tables: OceanSimTables, events: EventBus, settings: GameSettings?, look: Look) {
    self.tables = tables
    self.events = events
    self.settings = settings
    self.look = look
    bank = WaveBank(constants: tables.waves)
    features = FeatureSet()
    bank.features = features
    uniforms = OceanUniformsCPU(maxWaves: tables.waves.maxWaves, maxFeatures: FeatureSet.MAX_FEATURES, maxGlints: tables.maxGlints,
                                maxSplashes: tables.maxSplashes)
    let ns = tables.maxSplashes, ng = tables.maxGlints
    splX = [Float](repeating: 0, count: ns)
    splZ = splX
    splR = splX
    splS = splX
    splT0 = [Float](repeating: -1e9, count: ns)
    glX = [Float](repeating: 0, count: ng)
    glZ = glX
    glR = glX
    glI = glX
    glC = [Float](repeating: 0, count: ng * 3)

    buildMesh(settings?.quality)

    subscriptions.append(events.on(.missionSetup) { [unowned self] e in
      if case .missionSetup(let p) = e { self.reset(p.def.isNull ? nil : p.def) }
    })
    subscriptions.append(events.on(.weatherPreset) { [unowned self] e in
      if case .weatherPreset(let p) = e, p.over == 0 { self.bank.snap = true }
    })
    subscriptions.append(events.on(.weatherLightning) { [unowned self] e in
      guard case .weatherLightning(let p) = e, !p.cloudOnly, p.x.isFinite else { return }
      self.splash(p.x, p.z, 5, 1)
      self.stamp("scar", p.x, p.z, radius: 9, strength: 1)
    })
    settingsSub = settings?.onChange { [unowned self] key, _ in
      if key == "quality" { self.buildMesh(self.settings?.quality) }
    }
  }

  deinit {
    for s in subscriptions { s.off() }
    settingsSub?.off()
  }

  /// init(): the water memory, the reset for the current mission (ctx.mission?.def), one update(0).
  public func start() {
    ensureMemory()
    reset(missionDef)
    update(0)
  }

  // ==================================================================================================
  // construction / quality

  /// _buildMesh(quality): QUALITY[q] (unknown → high); the grid geometry itself is the renderer's.
  func buildMesh(_ qIn: String?) {
    let q = qIn.flatMap { tables.waves.quality[$0] != nil ? $0 : nil } ?? "high"
    if built && q == quality { return }
    quality = q
    cfg = tables.waves.quality[q] ?? cfg
    bank.setQuality(cfg.waves, cfg.grid)
    uniforms.uGridStep = 2 / Double(cfg.grid)
    snapQ = OceanGrid.snapQuantum(cfg.grid, constants: tables.waves)
    if !built {
      built = true // the material / mesh are created once; ensureMemory runs from start()
    } else {
      ensureMemory()
    }
  }

  /// _ensureMemory(): a memory target of QUALITY[q].memory texels when supported (0 = none).
  func ensureMemory() {
    let want = cfg.memory
    let ok = want > 0 && memorySupported
    if let m = memory, !ok || m.size != want { memory = nil }
    if ok && memory == nil { memory = WaterMemoryQueue(size: want, extent: tables.memoryExtent, tables: tables) }
    uniforms.memOn = memory != nil
    uniforms.uMemWin.w = memory != nil ? 1 : 0
  }

  /// _reset(def): seeded base swell within ±20° of the wind, streak frame, features, splashes, memory.
  func reset(_ def: JSONValue?) {
    let windAngle = OceanCPU.windAngle(weather?.state.windDir)
    var seed: Double? = nil
    if let d = def, d.jsTruthy, let s = d["seed"].double, s.isFinite { seed = s } // Number.isFinite(def.seed)
    OceanCPU.reset(bank, missionSeed: seed, windAngle: windAngle)
    streakA = windAngle
    streakB = windAngle
    streakMix = 0
    features.clear()
    for i in splT0.indices { splT0[i] = -1e9 }
    memory?.clear()
    bank.snap = true
  }

  // ==================================================================================================
  // frame update

  /// What the ocean reads of weather.state (all nil for a stub weather).
  struct WeatherView {
    var palette: Palette?
    var night: Double?
    var intensity: Double?
    var windDir: V2?
    var windSpeed: Double?
    var rain: Double?
    var flash: Double?
    var flashColor: PaletteColor?
    var sunDirVisual: V3?
    var sunDir: V3?
    var sunDirShadow: V3?
    var front: WeatherState.Front?
    var palettePrev: Palette?
    var paletteNext: Palette?
    var waveHeight: Double?
    var waveChoppiness: Double?

    init(_ st: WeatherState?) {
      guard let st else { return }
      palette = st.palette
      night = st.night
      intensity = st.intensity
      windDir = st.windDir
      windSpeed = st.windSpeed
      rain = st.rain
      flash = st.flash
      flashColor = st.flashColor
      sunDirVisual = st.sunDirVisual
      sunDir = st.sunDir
      sunDirShadow = st.sunDirShadow
      front = st.front
      palettePrev = st.palettePrev
      paletteNext = st.paletteNext
      waveHeight = st.waveHeight
      waveChoppiness = st.waveChoppiness
    }
  }

  /// palette.sea, or the fallback derived from the contract fields (_fallbackSea).
  struct SeaView {
    var Hs: Double
    var swellAdd: Double
    var Q: Double
    var detail: Double
    var whitecaps: Double
    var streaks: Double
    var foamLines: Double
    var roughness: Double
    var roughnessRain: Double?
    var clearing: Double?
    var cloudReflect: Double?
  }

  func fallbackSea(_ st: WeatherView) -> SeaView {
    let s = tables.fallbackSea
    let i = MathUtil.clamp(st.intensity ?? 0, 0, 1)
    return SeaView(Hs: st.waveHeight ?? 0.6, swellAdd: s.swellAdd, Q: 0.25 + 0.6 * MathUtil.clamp(st.waveChoppiness ?? 0.3, 0, 1),
                   detail: 0.25 + 0.75 * i, whitecaps: 0.55 * MathUtil.smoothstepOcean(0.2, 0.9, i),
                   streaks: MathUtil.smoothstepOcean(0.5, 0.9, i), foamLines: s.foamLines, roughness: 0.04 + 0.18 * i,
                   roughnessRain: nil, clearing: nil, cloudReflect: nil)
  }

  public func update(_ dt: Double) {
    let st = WeatherView(weather?.state)
    let sea: SeaView
    if let p = st.palette {
      let s = p.sea
      sea = SeaView(Hs: s.Hs, swellAdd: s.swellAdd, Q: s.Q, detail: s.detail, whitecaps: s.whitecaps, streaks: s.streaks,
                    foamLines: s.foamLines, roughness: s.roughness, roughnessRain: s.roughnessRain, clearing: s.clearing,
                    cloudReflect: s.cloudReflect)
    } else {
      sea = fallbackSea(st)
    }
    let t = time.t
    let night = MathUtil.clamp(st.night ?? 0, 0, 1)
    let intensity = MathUtil.clamp(st.intensity ?? 0, 0, 1)

    // wind (weather writes look.setWind; integrate ourselves only if nobody else does)
    let windSpeed = st.windSpeed ?? 0
    let windAngle = OceanCPU.windAngle(st.windDir)
    let lookWindOff = look.windOffset
    if dt > 0, let wd = st.windDir, windSpeed > 0.1, lookWindOff.x == windOffSeen.x && lookWindOff.y == windOffSeen.y {
      look.setWind(V2(wd.x * windSpeed, wd.y * windSpeed), dt)
    }
    windOffSeen = look.windOffset

    // focus point under the screen centre (same formula as the fog patch) → snapped grid offset
    focus = OceanCPU.focus(cameraPosition: camera.position, cameraDirection: camera.direction)
    let off = OceanCPU.snappedOffset(focus, quantum: snapQ)
    uniforms.uOffset = off

    // clearing look: palette.sea.clearing if weather provides it, else the long-swell signature
    let seaState = SeaState(Hs: sea.Hs, swellAdd: sea.swellAdd, Q: sea.Q, clearing: sea.clearing)
    clearing = OceanCPU.clearing(seaState)
    bank.update(dt, t, seaState, windAngle, 1 - 0.75 * clearing, off.x, off.y)
    features.update(dt)

    // rotor downwash: heli calls setDownwash every frame; otherwise derive it from the heli state
    if !dwCalled { downwashFromHeli() }
    dwCalled = false
    // searchlight auto-off if the heli stopped calling (frames, not seconds: robust to hitches)
    if time.frame - search.lastFrame > 2 { search.i = 0 }

    // terrain may join the scene after the world pushed its shoals: re-check the coast map now and then
    coastT = (coastT ?? 0) - dt
    if let c = coastT, c <= 0 {
      coastT = 2
      if syncCoast() { applyShoals() }
    }

    packSplashes(t)
    updateLook(st, sea, night, intensity, windAngle, windSpeed, dt)

    // glints collected last frame were uploaded at render time — start a fresh collection
    glN = 0

    if let m = memory, dt > 0 {
      autoStamps(dt)
      m.update(dt, focus.x, focus.y, look.wind.x, look.wind.y)
      uniforms.uMemWin = V4(m.center.x, m.center.y, tables.memoryExtent, 1)
    }
  }

  func downwashFromHeli() {
    let d = features.downwash
    guard let h = heli, h.alive else {
      features.setDownwash(Double(d[0]), Double(d[1]), Double(d[2]), 0)
      return
    }
    let alt = h.altitude.flatMap { $0.isFinite ? $0 : nil } ?? h.position.y
    let s = MathUtil.clamp(1 - (alt - 4) / 28, 0, 1)
    features.setDownwash(h.position.x, h.position.z, 9 + 0.35 * JS.max(0, alt), s * s * MathUtil.clamp(h.rotorRPM ?? 1, 0, 1))
  }

  /// _autoStamps(dt): the downwash ring and the disturbance under the rotor.
  func autoStamps(_ dt: Double) {
    guard let m = memory else { return }
    let d = features.downwash.map { Double($0) }
    if d[3] > 0.01 {
      let s = d[3]
      m.push(.ring, d[0], d[1], d[2] * 1.15, 0.18 * s * dt, 1, 0, 0.6, 0, inner: 0.82)
      m.push(.disc, d[0], d[1], d[2] * 0.9, 1.6 * s * dt, 0, 0, 1, 0)
    }
  }

  func packSplashes(_ t: Double) {
    var n = 0
    for i in 0..<tables.maxSplashes {
      let r = Double(splR[i])
      let age = t - Double(splT0[i])
      let life = 1.4 + 0.3 * r
      if age < 0 || age >= life { continue }
      uniforms.uSplash[n * 4] = splX[i]
      uniforms.uSplash[n * 4 + 1] = splZ[i]
      uniforms.uSplash[n * 4 + 2] = Float(age)
      uniforms.uSplash[n * 4 + 3] = splR[i]
      uniforms.uSplashS[n] = splS[i]
      n += 1
    }
    uniforms.uSplashCount = n
  }

  /// lum(c) = 0.2126 r + 0.7152 g + 0.0722 b (0.5 without a colour)
  @inline(__always) static func lum(_ c: PaletteColor?) -> Double {
    guard let c else { return 0.5 }
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  }

  /// angDiff(x, y) = |atan2(sin(x − y), cos(x − y))|
  @inline(__always) static func angDiff(_ x: Double, _ y: Double) -> Double { JS.abs(JS.atan2(JS.sin(x - y), JS.cos(x - y))) }

  /// setC fallbacks of _updateLook / _updateFront (ocean.js literals for a stub weather).
  enum Fallback {
    static let deep = SRGB.color(hex: 0x0B3B4E)
    static let body = SRGB.color(hex: 0x17586A)
    static let crest = SRGB.color(hex: 0x4FB3AC)
    static let shallow = SRGB.color(hex: 0x3FA79E)
    static let foam = SRGB.color(hex: 0xF1F4EE)
    static let sky = SRGB.color(hex: 0x8FB3C9)
    static let fog = SRGB.color(hex: 0xD9CDBB)
    static let sun = SRGB.color(hex: 0xFFD9A8)
    static let spec = SRGB.color(hex: 0xFFE9C6)
    static let ambient = SRGB.color(hex: 0xA9C3D3)
    static let shadowTint = SRGB.color(hex: 0x12313D)
  }

  func updateLook(_ st: WeatherView, _ sea: SeaView, _ night: Double, _ intensity: Double, _ windAngle: Double, _ windSpeed: Double,
                  _ dt: Double) {
    let pal = st.palette
    var u = uniforms
    u.uDeep = pal?.deep ?? Fallback.deep
    u.uBody = pal?.body ?? Fallback.body
    u.uCrest = pal?.crest ?? Fallback.crest
    u.uShallow = pal?.shallow ?? Fallback.shallow
    u.uFoamCol = pal?.foam ?? Fallback.foam
    u.uSkyCol = pal?.sky ?? Fallback.sky
    u.uFogCol = pal?.fogColor ?? Fallback.fog
    u.uSunCol = pal?.sun ?? Fallback.sun
    u.uSpecCol = pal?.spec ?? Fallback.spec
    u.uAmbCol = pal?.ambient ?? Fallback.ambient
    u.uShadowTint = pal?.shadowTint ?? Fallback.shadowTint
    u.uFlashCol = st.flashColor ?? tables.flashDay.lerp(tables.flashNight, night)
    let sv = st.sunDirVisual ?? st.sunDir
    if let v = sv { u.uSunDirV = v.normalized() }
    // stable (cheated) shadow sun for N·L shading; weather.state.sunDir also swings to lightning
    if let d = st.sunDirShadow ?? st.sunDir ?? sv { u.uSunDirS = d.normalized() }

    // Weather supplies most look parameters in the palette (extras beyond the contract); every one
    // has a fallback derived from the contract fields so the sea also works with a stub weather.
    let sunI = pal?.sunIntensity ?? 1
    let shadowI = MathUtil.clamp(pal?.shadowIntensity ?? 0.5, 0, 1)
    let rain = MathUtil.clamp(st.rain ?? 0, 0, 1)
    let flash = JS.max(MathUtil.clamp(st.flash ?? 0, 0, 1), JSNumber.isTruthy(look.flash) ? look.flash : 0)
    let sunGlit = pal?.glitter ?? MathUtil.smoothstepOcean(1.2, 2.2, sunI) * (1 - night)
    // a moon path on clear nights («Лунная дорожка»): the moon is the "sun" of night presets
    let moonGlit = night * MathUtil.smoothstepOcean(0.2, 0.35, sunI) * (1 - intensity) * 0.35
    let glitter = cfg.q > 0 ? JS.max(sunGlit, moonGlit) * (1 - rain) : 0
    let cloudRefl = sea.cloudReflect ?? sunGlit * (1 - rain) * (0.35 * (1 - clearing) + 0.1 * clearing)
    let cloudShadow = (pal.map { JS.abs($0.cloudShadow) } ?? shadowI) * (1 - night)
    let sss = pal?.sss ?? 0.5 + 0.3 * intensity
    // layer 8 «матовое олово»: +0.3·rain, unless the palette already folded rain into roughness
    let rough = sea.roughness + JS.max(0, 0.3 - (sea.roughnessRain ?? 0)) * rain

    let tn = tune
    u.uSeaA = V4(sea.detail * tn.detail, sea.whitecaps * tn.whitecaps, sea.streaks, sea.foamLines)
    u.uSeaB = V4(rough, sss * tn.sss, clearing, sunI)
    u.uSeaC = V4(cloudRefl, cloudShadow * tn.cloudShadow, shadowI, glitter * tn.glitter)
    let resid = JS.max(features.residual, 0.5 * clearing)
    let bio = cfg.q > 0 ? MathUtil.clamp(bioluminescence, 0, 1) * MathUtil.smoothstepOcean(0.5, 0.9, night) : 0
    let glitExp = pal?.glitterExp ?? 600 + (120 - 600) * clearing
    // the sun's glitter is lifted (+1.2) into the top-down frame (DESIGN layer 13); a night palette that
    // declares its own glitter gets a broad moon path (+0.8), otherwise the moon keeps a tight 2400 lobe
    let moonK: Double = moonGlit > sunGlit || night > 0.5 ? 1 : 0
    let palGlitter = pal?.glitter ?? 0
    let moonExp = palGlitter > 0 ? glitExp : 2400
    u.uSeaD = V4(glitExp + (moonExp - glitExp) * moonK, 1.2 - (palGlitter > 0 ? 0.4 : 0.85) * moonK, resid, bio)
    // look-driven radiance: share of the sun in the total light, exposure compensation (base
    // exposure only, so the weather's lightning exposure boost still brightens the water)
    let sunPart = sunI * JS.max(u.uSunDirS.y, 0.05) * OceanSim.lum(pal?.sun)
    let ambPart = (pal?.ambientIntensity ?? 0.6) * OceanSim.lum(pal?.ambient)
    let exposure = JS.max(pal?.exposure ?? rendererExposure ?? 1, 0.05)
    // sun-disk specular: full in calm/clearing, faint under overcast; lightning always glints
    let sunDisk = JS.max(MathUtil.smoothstepOcean(0.6, 2.0, sunI) * (1 - 0.7 * rain), flash)
    u.uLookK = V4(sunPart / JS.max(sunPart + ambPart, 1e-4), tn.look / exposure, 0.9, sunDisk)
    u.uSeaE = V4(JS.max(windSpeed, 0.5), flash, night, pal?.ambientIntensity ?? 0.6)

    updateFront(&u, st, tn)

    let bs = bank.stats
    u.uHsEff = bs.HsEff
    u.uJStats = V4(bs.K, bs.sigma, bs.crestNorm ?? 1, 0)
    u.uFeatCount = features.count

    // detail normal frames: fixed to the mission's base swell, sliding along the wind
    let ba = bank.baseAngle
    let b2 = ba + 37 * OceanCPU.DEG
    u.uDetRot = V4(JS.cos(ba), JS.sin(ba), JS.cos(b2), JS.sin(b2))
    if dt > 0 && windSpeed > 0.05 {
      let wx = JS.cos(windAngle), wz = JS.sin(windAngle)
      // uv offset = −(frame-space wind direction) · speed · dt / tile
      detOff.x = (detOff.x - ((JS.cos(ba) * wx + JS.sin(ba) * wz) * 0.6 * dt) / 14).truncatingRemainder(dividingBy: 1)
      detOff.y = (detOff.y - ((-JS.sin(ba) * wx + JS.cos(ba) * wz) * 0.6 * dt) / 14).truncatingRemainder(dividingBy: 1)
      detOff.z = (detOff.z - ((JS.cos(b2) * wx + JS.sin(b2) * wz) * 1.1 * dt) / 5.5).truncatingRemainder(dividingBy: 1)
      detOff.w = (detOff.w - ((-JS.sin(b2) * wx + JS.cos(b2) * wz) * 1.1 * dt) / 5.5).truncatingRemainder(dividingBy: 1)
      u.uDetOff = detOff
    }

    // streak frame follows the wind with hysteresis + 6 s cross-fade (patterns never slide)
    if streakMix == 0 && OceanSim.angDiff(windAngle, streakA) > 20 * OceanCPU.DEG {
      streakB = windAngle
      streakMix = 1e-4
    }
    if streakMix > 0 {
      streakMix = JS.min(1, streakMix + dt / 6)
      if streakMix >= 1 {
        streakA = streakB
        streakMix = 0
      }
    }
    u.uStreakRot = V4(JS.cos(streakA), JS.sin(streakA), JS.cos(streakB), JS.sin(streakB))
    u.uStreakMix = streakMix
    uniforms = u
  }

  /// Spatial weather front (DESIGN §2.5 SHOULD): weather.state.front + palettePrev / paletteNext.
  func updateFront(_ u: inout OceanUniformsCPU, _ st: WeatherView, _ tn: Tune) {
    guard let fr = st.front, fr.active, let A = st.palettePrev, let B = st.paletteNext else {
      u.uFrontB.z = 0
      return
    }
    u.uFront = V4(fr.origin.x, fr.origin.y, fr.dir.x, fr.dir.y)
    u.uFrontB = V4(fr.speed * fr.t, JS.max(10, fr.width), 1, 0)
    u.uPrevDeep = A.deep
    u.uPrevBody = A.body
    u.uPrevCrest = A.crest
    u.uPrevFoam = A.foam
    u.uNextDeep = B.deep
    u.uNextBody = B.body
    u.uNextCrest = B.crest
    u.uNextFoam = B.foam
    let sa = A.sea, sb = B.sea
    u.uPrevSea = V4(sa.detail * tn.detail, sa.whitecaps * tn.whitecaps, sa.streaks, sa.foamLines)
    u.uNextSea = V4(sb.detail * tn.detail, sb.whitecaps * tn.whitecaps, sb.streaks, sb.foamLines)
  }

  /// _lateUpload(): values other systems write after update() (heli, survivors, hazards) — call just
  /// before the ocean draws so the water never lags a frame behind the heli or the strobes.
  public func lateUpload() {
    var u = uniforms
    let d = features.downwash
    u.uDownwash = V4(Double(d[0]), Double(d[1]), Double(d[2]), Double(d[3]))
    u.uFeatCount = features.count
    u.uFeatA = features.uA
    u.uFeatB = features.uB
    u.uFeatC = features.uC
    u.uWaveA = bank.uWaveA
    u.uWaveB = bank.uWaveB
    if let h = heli, h.alive {
      let alt = h.altitude.flatMap { $0.isFinite ? $0 : nil } ?? h.position.y
      u.uHeliP = V4(h.position.x, h.position.z, alt, 1)
    } else {
      u.uHeliP.w = 0
    }
    u.uSearchPos = search.pos
    u.uSearchDir = V4(search.dir.x, search.dir.y, search.dir.z, search.cosOuter)
    u.uSearchI = search.i
    // glints: already sorted by intensity, cap per quality
    let n = Swift.min(glN, cfg.glints)
    for i in 0..<n {
      u.uGlints[i * 4] = glX[i]
      u.uGlints[i * 4 + 1] = glZ[i]
      u.uGlints[i * 4 + 2] = glR[i]
      u.uGlints[i * 4 + 3] = glI[i]
      u.uGlintCol[i * 4] = glC[i * 3]
      u.uGlintCol[i * 4 + 1] = glC[i * 3 + 1]
      u.uGlintCol[i * 4 + 2] = glC[i * 3 + 2]
    }
    u.uGlintCount = n
    uniforms = u
  }

  // ==================================================================================================
  // CPU mirror (contract)

  public func heightAt(_ x: Double, _ z: Double, _ tOffset: Double = 0) -> Double { bank.heightAt(x, z, tOffset) }

  public func normalAt(_ x: Double, _ z: Double, _ tOffset: Double = 0) -> V3 { bank.normalAt(x, z, tOffset) }

  /// Orbital surface velocity (x, vertical, z). Hazard flows are separate (hazards.surfaceFlowAt).
  public func velocityAt(_ x: Double, _ z: Double, _ tOffset: Double = 0) -> V3 { bank.velocityAt(x, z, tOffset) }

  /// Feature part of the sea height (rogue crest, vortex / whirlpool dip); heightAt() already includes it.
  public func featureHeightAt(_ x: Double, _ z: Double, _ tOffset: Double = 0) -> Double { bank.featureLiftAt(x, z, tOffset) }

  public func featureFlowAt(_ x: Double, _ z: Double) -> V2 { features.flowAt(x, z) }

  // ==================================================================================================
  // writers

  public func splash(_ x: Double, _ z: Double, _ radius: Double = 2, _ strength: Double = 1) {
    let i = splNext
    splNext = (i + 1) % tables.maxSplashes
    splX[i] = Float(x)
    splZ[i] = Float(z)
    splR[i] = Float(MathUtil.clamp(radius, 0.3, 20))
    splS[i] = Float(MathUtil.clamp(strength, 0, 1.5))
    splT0[i] = Float(time.t)
    memory?.push(.ring, x, z, radius * 2.2, 0.6 * strength, 0.7, 0, 1, 0, inner: 0.6)
    memory?.push(.disc, x, z, radius * 1.1, 0.8 * strength, 0.8, 0, 0.8, 0)
  }

  public func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) {
    dwCalled = true
    features.setDownwash(x, z, radius, strength)
  }

  /// setSearchlight(pos, dir, cosOuter, intensity = 1); nil arguments keep the previous pos / dir / cone.
  public func setSearchlight(_ pos: V3?, _ dir: V3?, _ cosOuter: Double?, _ intensity: Double? = 1) {
    if let p = pos { search.pos = p }
    if let d = dir { search.dir = d.normalized() }
    if let c = cosOuter, c.isFinite { search.cosOuter = MathUtil.clamp(c, -0.99, 0.99999) }
    search.i = MathUtil.clamp(intensity ?? 1, 0, 2)
    search.lastFrame = time.frame
  }

  /// How lit a point at the surface is by the heli searchlight, 0…1 (reflective tape, detection).
  public func searchlightAt(_ x: Double, _ z: Double, _ y: Double = 0) -> Double {
    let s = search
    if s.i <= 0 { return 0 }
    let dx = x - s.pos.x, dy = y - s.pos.y, dz = z - s.pos.z
    let h = JS.hypot(dx, dy, dz)
    let d = JSNumber.isTruthy(h) ? h : 1e-3
    let cs = (dx * s.dir.x + dy * s.dir.y + dz * s.dir.z) / d
    let rho = JS.acos(MathUtil.clamp(cs, -1, 1)) / JS.max(JS.acos(s.cosOuter), 1e-3)
    return MathUtil.clamp(s.i * (1 - MathUtil.smoothstepOcean(220, 320, d)) * (1 - MathUtil.smoothstepOcean(0.72, 1, rho)), 0, 1)
  }

  /// Call every frame per light reflection; the ocean keeps the most intense ones (descending insertion
  /// into Float32 slots: comparisons see the stored, rounded intensities, like the web). nil colour = white.
  public func addGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: PaletteColor? = nil) {
    if !(intensity > 0) { return }
    let max = tables.maxGlints
    var slot: Int
    if glN < max {
      slot = glN
      glN += 1
    } else {
      if intensity <= Double(glI[max - 1]) { return }
      slot = max - 1
    }
    // insertion sort, descending intensity
    while slot > 0 && Double(glI[slot - 1]) < intensity {
      glX[slot] = glX[slot - 1]
      glZ[slot] = glZ[slot - 1]
      glR[slot] = glR[slot - 1]
      glI[slot] = glI[slot - 1]
      glC[slot * 3] = glC[slot * 3 - 3]
      glC[slot * 3 + 1] = glC[slot * 3 - 2]
      glC[slot * 3 + 2] = glC[slot * 3 - 1]
      slot -= 1
    }
    let c = color ?? PaletteColor(1, 1, 1)
    glX[slot] = Float(x)
    glZ[slot] = Float(z)
    glR[slot] = Float(JS.max(0.2, JSNumber.isTruthy(radius) ? radius : 1))
    glI[slot] = Float(intensity)
    glC[slot * 3] = Float(c.r)
    glC[slot * 3 + 1] = Float(c.g)
    glC[slot * 3 + 2] = Float(c.b)
  }

  /// Water-memory stamps: 'foam' | 'dye' | 'disturb' | 'oil' | 'scar' | 'ring' | 'wake' | 'splash'
  /// (radius default 3, strength 1; dirX / dirZ: wake direction of motion). Without the memory (low
  /// quality) the foam-like stamps fall back to analytic rings.
  public func stamp(_ kind: String, _ x: Double, _ z: Double, radius: Double? = nil, strength: Double? = nil, inner: Double? = nil,
                    dirX: Double? = nil, dirZ: Double? = nil) {
    let r = radius ?? 3
    let s = strength ?? 1
    guard let m = memory else {
      if kind == "scar" || kind == "splash" || kind == "ring" { splash(x, z, r * 0.5, s) }
      return
    }
    switch kind {
    case "foam": m.push(.disc, x, z, r, s, 1, 0, 0.3, 0)
    case "dye": m.push(.disc, x, z, r, s, 0, 1, 0, 0)
    case "disturb": m.push(.disc, x, z, r, s, 0, 0, 1, 0)
    case "oil": m.push(.disc, x, z, r, s, 0, 0, 0, 1)
    case "ring": m.push(.ring, x, z, r, s, 1, 0, 0.7, 0, inner: inner ?? 0.75)
    case "scar":
      m.push(.ring, x, z, r, 1.2 * s, 1, 0, 1, 0, inner: 0.7)
      m.push(.disc, x, z, r * 0.6, s, 1, 0, 1, 0)
    case "splash":
      m.push(.ring, x, z, r, s, 0.8, 0, 1, 0, inner: 0.6)
      m.push(.disc, x, z, r * 0.5, s, 0.9, 0, 1, 0)
    case "wake":
      let l = JS.hypot(dirX ?? 0, dirZ ?? 0)
      if l > 1e-4 {
        // `opts.dirX / l` reads undefined as NaN
        m.push(.wake, x, z, r, s, 1, 0, 0.8, 0, inner: 0, dirX: (dirX ?? .nan) / l, dirZ: (dirZ ?? .nan) / l)
      } else {
        m.push(.disc, x, z, r * 0.4, s, 1, 0, 0.8, 0)
      }
    default: break
    }
  }

  /// Foam trail point for something moving through the water (boats, swimmers). Call per frame.
  public func addWake(_ x: Double, _ z: Double, _ strength: Double = 1, _ dirX: Double? = nil, _ dirZ: Double? = nil) {
    let dt = time.dt
    guard let m = memory, dt > 0 else { return }
    let s = MathUtil.clamp(strength, 0, 3)
    if let dx = dirX, let dz = dirZ, dx.isFinite, dz.isFinite, JSNumber.isTruthy(dx) || JSNumber.isTruthy(dz) {
      let l = JS.hypot(dx, dz)
      // a faint V per frame: as the boat moves the stamps add up to a Kelvin wake (19.47°)
      m.push(.wake, x, z, 8 + 6 * s, 0.35 * s * dt, 1, 0, 1, 0, inner: 0, dirX: dx / l, dirZ: dz / l)
    } else {
      m.push(.disc, x, z, 0.8 + 1.2 * s, 1.2 * s * dt, 1, 0, 1, 0)
    }
  }

  @discardableResult
  public func setFeature(_ id: String, _ f: FeatureSpec) -> Bool { features.set(id, f) }

  public func removeFeature(_ id: String) { features.remove(id) }

  /// ≤ 8 rocks / shallows (world calls). Terrain coasts are taken over by the coastline distance map;
  /// a shoal whose centre lies on that land only keeps its slot, circles serve the rest.
  public func setShoals(_ list: [ShoalSpec]?) {
    shoalList = list
    _ = syncCoast()
    applyShoals()
  }

  func applyShoals() {
    let coast = bank.coast
    var arr = [Float](repeating: 0, count: uniforms.uShoals.count)
    var shoals = [Shoal]()
    for s in shoalList ?? [] {
      if shoals.count >= 8 { break }
      guard let x = s.x, let z = s.z, x.isFinite, z.isFinite else { continue }
      let r = JS.max(0.5, s.radius ?? s.r ?? 5)
      let on = coast.map { $0.distance(x, z) > 0.5 } ?? true
      let j = shoals.count * 4
      arr[j] = Float(x)
      arr[j + 1] = Float(z)
      arr[j + 2] = Float(r)
      arr[j + 3] = on ? 1 : 0
      shoals.append(Shoal(x: x, z: z, r: r, on: on))
    }
    bank.shoals = shoals
    uniforms.uShoals = arr
    uniforms.uShoalCount = shoals.count
  }

  /// The scene's terrain (world/terrain.js meshes carrying `aTerr`): `key` changes when the set of terrain
  /// meshes changes (the web concatenates geometry uuids), `vertices` = their world-space positions.
  /// The map is (re)baked on the next coast check (≤ 2 s, or setShoals).
  public func setTerrain(key: String, vertices: [V3]) {
    terrainKey = key
    terrainVertices = vertices
  }

  /// _syncCoast(): (re)bake the coastline map when the set of terrain meshes changed.
  func syncCoast() -> Bool {
    let key = terrainKey
    if key == coastKey { return false }
    coastKey = key
    let c = key.isEmpty ? nil : CoastMap.bake(worldVertices: terrainVertices)
    bank.coast = c
    if let c { uniforms.uCoastWin = V4(c.x0, c.z0, 1 / (Double(c.w) * c.cell), 1 / (Double(c.h) * c.cell)) }
    uniforms.uCoastOn = c != nil ? 1 : 0
    return true
  }

  /// Jump wave amplitudes to the current targets (tests, instant preset switches).
  public func snapWaves() { bank.snap = true }

  public var waveStats: WaveStats { bank.stats }

  // ---- inspection (tests, debug overlay) -------------------------------------------------------------
  /// The splash pool (x, z, t0, r, s per slot; Float32 like the web).
  public var splashPool: (x: [Float], z: [Float], t0: [Float], r: [Float], s: [Float]) { (splX, splZ, splT0, splR, splS) }
  /// The glint collection (x, z, r, i, c per slot; Float32).
  public var glintPool: (x: [Float], z: [Float], r: [Float], i: [Float], c: [Float]) { (glX, glZ, glR, glI, glC) }
}
