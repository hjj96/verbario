// GameSession — the native main.js: the shared `ctx` and the real MaydayCore systems, built, initialised
// and updated exactly in the web's order (PLAN §2.3; rescue/src/main.js boot() / frame()):
//
//   construct  weather (WeatherSim) → ocean (OceanSim) → world (stubs.js World) → heli (Helicopter) →
//              cameraRig (CameraRig) → mission (stubs.js Mission) → post (PostFX); absent systems
//              (hazards, survivors, fx, radio, audio, hud) are nil queries, like the web's `?.` reads
//   init       the same order: weather.start, ocean.start, heli.start, cameraRig.start, mission (free
//              flight: mission:setup → briefing → play), post — then Haptics, then `game:ready`
//   frame      GameLoop: realDt = min(Δ, 0.1); dt = paused ? 0 : realDt · timeScale; look.setTime(t);
//              input.poll() (gamepads refreshed first, like navigator.getGamepads() inside poll);
//              systems in LoopRules.systems order, RUN_WHEN_PAUSED ones with realDt;
//              then the host renders (RenderSnapshot: ocean.lateUpload() first, as Mesh.onBeforeRender).
// The settings listeners keep the web's registration order (weather, ocean, heli, post constructors,
// then main.js after init). Every constant comes from Resources/Data (game, input, settings, weather,
// ocean, look, post, mission .json). Parity: Tests/Vectors/app/session_*.json replays the web's own boot +
// frame loop over the same systems (tools/export/export-app.mjs; checked by the applecheck harness).
import Foundation
import MaydayCore

/// Launch options: the web's URL parameters and matchMedia answers (PLAN §2.8 launch args).
struct SessionOptions {
  /// ?quality= (-mayday.quality): low | medium | high (anything else is ignored, like the web)
  var quality: String?
  /// ?weather= (-mayday.weather): force a preset, scripts off
  var weather: String?
  /// ?tod= (-mayday.tod): time of day 0…1
  var timeOfDay: Double?
  /// matchMedia('(prefers-reduced-motion: reduce)') on the first run
  var prefersReducedMotion = false
  /// matchMedia('(pointer: coarse)'): a touch device
  var coarsePointer = false
  /// First-run quality of a touch device (PLAN §10 X5: medium on iPhone; the web picks low)
  var touchQuality = "medium"
  /// Math.random for cosmetic choices (SimContext.random); tests pin it to the exporter's seed
  var randomSeed: Double = 20261016
  /// window.innerWidth × innerHeight before the first layout (CSS px = points)
  var viewportWidth: Double = 1280
  var viewportHeight: Double = 720

  init() {}
}

final class GameSession {
  // ---- ctx ---------------------------------------------------------------------------------------------
  let catalog: DataCatalog
  let rules: LoopRules
  let events: EventBus
  let loop: GameLoop
  let settings: GameSettings
  let bindings: Bindings
  let input: InputState
  let look: Look
  let noise: SimplexNoise2D
  let camera: PerspectiveCamera
  let ctx: SimContext
  let tiers: QualityTiers

  // ---- systems (SYSTEMS order) ------------------------------------------------------------------------------
  let weather: WeatherSim
  let ocean: OceanSim
  let world: FreeFlightWorld
  let heli: Helicopter
  let rig: CameraRig
  let mission: FreeFlightMission
  let post: PostSystem
  /// ctx.haptics (core/haptics.js: pad rumble from game events)
  let haptics: Haptics

  /// navigator.getGamepads() for the next poll (the host's GameController adapter; tests script it).
  var gamepads: () -> [GamepadSnapshot?] = { [] }
  /// Last water-memory update handed to the renderer (WaterMemoryQueue.Frame.serial).
  var memorySerial = 0
  private var settingsSubs: [SettingsSubscription] = []

  /// Builds and boots the session (main.js boot()). `storage`: localStorage (UserDefaults in the app).
  init(catalog: DataCatalog, storage: KeyValueStorage?, options: SessionOptions = SessionOptions()) throws {
    self.catalog = catalog
    let game = try catalog.data("game")
    rules = try LoopRules(game: game)
    events = EventBus()
    let derived = game["derived"]
    let initialMode = GameMode(rawValue: derived["ctx"]["initialMode"].string ?? "title") ?? .title
    loop = GameLoop(events: events, rules: rules, mode: initialMode)

    // settings + live bindings (core/settings.js reads localStorage, applyBindings on construction)
    let inputTables = try InputTables(json: try catalog.data("input"))
    bindings = Bindings(tables: inputTables)
    let env = SettingsEnvironment(prefersReducedMotion: options.prefersReducedMotion, coarsePointer: options.coarsePointer,
                                  qualityOverride: options.quality, touchQuality: options.touchQuality)
    settings = GameSettings(storage: storage, environment: env, defaults: try SettingsDefaults(json: try catalog.data("settings")),
                            bindings: bindings)
    input = InputState(bindings: bindings, pad: inputTables.pad)

    // look (shared noise atlas + uniforms), ctx.noise, the camera of main.js
    look = try Look.load(catalog: catalog, look: try LookData(catalog: catalog))
    noise = SimplexNoise2D(seed: try derived["ctx"]["noiseSeed"].requireDouble("game.derived.ctx.noiseSeed"))
    let cam = derived["camera"]
    camera = PerspectiveCamera(fov: try cam["fovDeg"].requireDouble("camera.fovDeg"),
                               aspect: options.viewportWidth / options.viewportHeight,
                               near: try cam["near"].requireDouble("camera.near"), far: try cam["far"].requireDouble("camera.far"))
    let p0 = try cam["position"].requireDoubles("camera.position")
    let l0 = try cam["lookAt"].requireDoubles("camera.lookAt")
    guard p0.count == 3, l0.count == 3 else { throw DataBundleError.malformed("game.json derived.camera") }
    camera.position.set(p0[0], p0[1], p0[2])
    camera.lookAt(V3(l0[0], l0[1], l0[2]))

    ctx = SimContext(events: events, settings: settings, camera: camera, randomSeed: options.randomSeed)
    ctx.loop = loop
    ctx.input = input
    ctx.viewportWidth = options.viewportWidth
    ctx.viewportHeight = options.viewportHeight
    let oceanTables = try OceanSimTables(catalog: catalog)
    tiers = try QualityTiers(ocean: oceanTables, post: try catalog.data("post"))

    // ---- construct (constructors never touch other systems) ----------------------------------------------
    weather = WeatherSim(tables: try WeatherTables(catalog: catalog), events: events, settings: settings, look: look, noise: noise,
                         mode: loop.mode, options: WeatherSim.Options(forcedPreset: options.weather, forcedTimeOfDay: options.timeOfDay))
    ocean = OceanSim(tables: oceanTables, events: events, settings: settings, look: look)
    ocean.weather = weather
    ocean.memorySupported = true                       // float render targets: always on Apple GPUs
    world = FreeFlightWorld(events: events)
    heli = Helicopter(ctx: ctx)
    let heliRef = heli
    settingsSubs.append(settings.onChange { key, _ in if key == "quality" { heliRef.applyQuality() } })
    rig = CameraRig(ctx: ctx)
    let crashDelay = try catalog.data("mission")["mission"]["CRASH_TO_DEBRIEF_S"].requireDouble("mission.CRASH_TO_DEBRIEF_S")
    mission = FreeFlightMission(loop: loop, input: input, events: events, crashToRestart: crashDelay)
    post = PostSystem(events: events, loop: loop, settings: settings, weather: weather, heli: heli, rig: rig, camera: camera)

    ctx.ocean = ocean
    ctx.weather = weather
    ctx.world = world
    ctx.mission = mission
    ctx.heli = heli
    ctx.cameraRig = rig
    let lookRef = look
    ctx.cloudAt = { x, z in lookRef.cloudAt(x, z) }
    let loopRef = loop
    ctx.nowMs = { loopRef.time.realT * 1000 }
    mission.attach(rig: rig)

    loop.register(.weather, WeatherStep(weather: weather, heli: heli, camera: camera, world: world))
    loop.register(.ocean, OceanStep(ocean: ocean, heli: heli, camera: camera, loop: loop))
    loop.register(.world, world)
    loop.register(.heli, heli)
    loop.register(.cameraRig, rig)
    loop.register(.mission, mission)
    loop.register(.post, post)
    loop.setTime = { t in lookRef.setTime(t) }

    // ---- init (main.js: every init() in SYSTEMS order) -------------------------------------------------------
    weather.start()
    ocean.start()
    heli.start()
    rig.start()
    mission.boot()

    // ---- after init: haptics, warm-up hooks, game:ready ----------------------------------------------------------
    haptics = Haptics(events: events, input: input, settings: settings, mode: { loopRef.mode })
    let inputRef = input
    loop.pollInput = { [unowned self] in
      inputRef.gamepads = self.gamepads()
      inputRef.poll()
    }
    loop.ready(settings: settings, onSettingsChanged: nil)
  }

  deinit {
    for s in settingsSubs { s.off() }
    haptics.detach()
  }

  // ---- per frame ------------------------------------------------------------------------------------------

  /// One display frame at clock `nowMs` (performance.now()). The free-flight pause poll runs first, like
  /// the mission's rAF tick that was registered during the previous frame.
  @discardableResult
  func frame(nowMs: Double) -> FramePlan {
    mission.pollWhilePaused()
    return loop.frame(nowMs: nowMs)
  }

  /// One frame of a known length (replays, tests: the web's ?fixeddt).
  @discardableResult
  func step(frameDelta: Double) -> FramePlan {
    mission.pollWhilePaused()
    return loop.step(frameDelta: frameDelta)
  }

  /// ctx.time.realT in ms: the clock InputState's mouse events and the heli's "moved within 2 s" use.
  var clockMs: Double { loop.time.realT * 1000 }

  /// The renderer's tier for the current `quality` setting.
  var quality: RenderQualityConfig { tiers.config(settings.quality) }

  /// main.js onResize(): camera aspect + the CSS-px viewport the rig and the heli project with.
  func resize(width: Double, height: Double) {
    guard width > 0, height > 0 else { return }
    ctx.viewportWidth = width
    ctx.viewportHeight = height
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  /// main.js pixelRatio(): min(devicePixelRatio, settings.pixelRatioCap(), max(1, √(budget / (w·h)))).
  func pixelRatio(devicePixelRatio: Double, width: Double, height: Double) -> Double {
    rules.pixelRatio(devicePixelRatio: devicePixelRatio, width: width, height: height, cap: settings.pixelRatioCap())
  }

  // ---- debug controls (outside the game's bindings) ---------------------------------------------------------

  /// The next / previous weather preset over 6 s (weather.setPreset; the forced preset of ?weather= is
  /// replaced, scripts keep running).
  func cyclePreset(_ step: Int) {
    let names = weather.presets
    guard !names.isEmpty else { return }
    let i = names.firstIndex(of: weather.state.preset) ?? 0
    let n = names.count
    weather.setPreset(names[((i + step) % n + n) % n], over: 6)
  }

  /// low → medium → high → low (settings.set('quality'): ocean grid, shadow map, PSOs follow).
  func cycleQuality() {
    settings.set("quality", QualityTiers.next(after: settings.quality))
  }
}
