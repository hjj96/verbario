// main.js frame(): the per-frame contract every system relies on, as a pure-Swift loop the app
// drives from its display link (Tests/Vectors/core/loop.json runs the web's own frame() source).
//
//   realDt = min((now - last) / 1000, 0.1)      (frame(nowMs:); step(frameDelta:) for fixed-dt replays)
//   dt     = mode == paused ? 0 : realDt * timeScale
//   time.realDt = realDt; time.realT += realDt; time.dt = dt; time.t += dt; time.frame += 1
//   look.setTime(time.t)                         (setTime hook)
//   input.poll()                                 (pollInput hook)
//   systems in SYSTEMS order: skipped when disabled or (paused && not RUN_WHEN_PAUSED);
//     RUN_WHEN_PAUSED systems get realDt (always, not only while paused), the others dt
//   warm-up: 'render' → the host draws one frame with hidden objects first (state 'idle');
//   the host renders the frame (realDt); afterRender(): 'due' → start an async compile ('compiling').
//
// The web disables a system whose update throws ("report each failing system once"); Swift systems do
// not throw, so a system (or a debug NaN guard) reports itself with `disable(_:reason:)` instead.

/// A system the loop updates (CONTRACT "Lifecycle": update(dt) every frame; never divide by dt
/// without guarding against 0).
public protocol GameSystem: AnyObject {
  func update(_ dt: Double)
}

/// What the host does with the frame it is about to draw.
public struct FramePlan: Equatable, Sendable {
  /// dt for the renderer / post (main.js render(realDt)).
  public var realDt: Double
  /// Draw one extra frame first with every hidden object shown and dt 0 (warm-up 'render' step).
  public var renderWarmupFrame: Bool
}

public final class GameLoop {
  public let rules: LoopRules
  public let events: EventBus
  /// ctx.time
  public private(set) var time = GameTime()
  /// ctx.mode (switch with setMode)
  public private(set) var mode: GameMode
  /// ctx.timeScale: slow-mo hook (mission / camera / photo mode set it)
  public var timeScale: Double = 1
  /// ctx.warmup
  public private(set) var warmup: WarmupState = .due
  /// Systems taken out of the loop (the web's `failed` set).
  public private(set) var disabled: Set<SystemKey> = []

  /// main.js `look.setTime(ctx.time.t)`, before input and systems.
  public var setTime: ((Double) -> Void)?
  /// main.js `ctx.input.poll()`, before the systems.
  public var pollInput: (() -> Void)?
  /// console.error replacement (disable messages).
  public var log: ((String) -> Void)?

  private var systems: [SystemKey: GameSystem] = [:]
  private var lastMs: Double
  private var subscriptions: [EventSubscription] = []

  /// `startMs`: the clock reading the first frame's delta is measured from (main.js `last`).
  public init(events: EventBus, rules: LoopRules = .web, mode: GameMode = .title, startMs: Double = 0) {
    self.events = events
    self.rules = rules
    self.mode = mode
    self.lastMs = startMs
  }

  // ---- systems --------------------------------------------------------------------------------------
  /// ctx[key] = system. A key without a system behaves like a stub without update().
  public func register(_ key: SystemKey, _ system: GameSystem?) { systems[key] = system }

  public func system(_ key: SystemKey) -> GameSystem? { systems[key] }

  /// Take a system out of the loop (web: an update that threw → `failed.add(key)`, reported once).
  public func disable(_ key: SystemKey, reason: String = "") {
    if disabled.contains(key) { return }
    disabled.insert(key)
    log?("[loop] \(key.rawValue).update failed — system disabled" + (reason.isEmpty ? "" : ": " + reason))
  }

  // ---- mode -----------------------------------------------------------------------------------------
  /// ctx.setMode(mode): no-op when unchanged, else switch and emit `game:mode {from, to}`.
  public func setMode(_ m: GameMode) {
    if mode == m { return }
    let from = mode
    mode = m
    events.emit(GameEvent.GameMode(from: from, to: m))
  }

  // ---- frames ---------------------------------------------------------------------------------------
  /// One display frame at clock reading `nowMs` (performance.now() milliseconds).
  @discardableResult
  public func frame(nowMs: Double) -> FramePlan {
    let realDt = JS.min((nowMs - lastMs) / 1000, rules.dtCap)
    lastMs = nowMs
    return advance(realDt)
  }

  /// One frame of a known length (fixed-dt replays, tests: the web's `?fixeddt`, PLAN W2).
  @discardableResult
  public func step(frameDelta: Double) -> FramePlan {
    advance(JS.min(frameDelta, rules.dtCap))
  }

  private func advance(_ realDt: Double) -> FramePlan {
    let paused = mode == .paused
    let dt = paused ? 0 : realDt * timeScale
    time.realDt = realDt
    time.realT += realDt
    time.dt = dt
    time.t += dt
    time.frame += 1
    setTime?(time.t)

    pollInput?()
    for key in rules.systems {
      guard let sys = systems[key], !disabled.contains(key) else { continue }
      let always = rules.runWhenPaused.contains(key)
      if paused && !always { continue }
      sys.update(always ? realDt : dt)
    }

    // The warm-up frame is drawn before the real one, so only the real frame reaches the screen.
    var plan = FramePlan(realDt: realDt, renderWarmupFrame: false)
    if warmup == .render {
      warmup = .idle
      plan.renderWarmupFrame = true
    }
    return plan
  }

  // ---- shader warm-up ---------------------------------------------------------------------------------
  /// Call after the frame was rendered. True: start the async pipeline warm-up now and call
  /// `warmupCompiled()` when it finishes (successfully or not).
  public func afterRender() -> Bool {
    if warmup == .due {
      warmup = .compiling
      return true
    }
    return false
  }

  /// The async compile started by afterRender() settled (web: the compileScene promise chain).
  /// A warm-up requested meanwhile ('due') wins: it compiles again after the next frame.
  public func warmupCompiled() {
    if warmup == .compiling { warmup = .render }
  }

  /// New objects or shader variants are coming (mission:setup, quality change).
  public func requestWarmup() { warmup = .due }

  /// main.js after every system's init(): warm-up again on `mission:setup` and on settings changes
  /// (`onSettingsChanged` is the host's resize, called for every key like main.js onResize), then
  /// emit `game:ready`.
  public func ready(settings: GameSettings? = nil, onSettingsChanged: ((String) -> Void)? = nil) {
    subscriptions.append(events.on(.missionSetup) { [weak self] _ in self?.requestWarmup() })
    if let s = settings {
      _ = s.onChange { [weak self] key, _ in
        onSettingsChanged?(key)
        if key == "quality" { self?.requestWarmup() }
      }
    }
    events.emit(GameEvent.GameReady())
  }
}
