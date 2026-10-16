// The clock and mode vocabulary of main.js (ctx.time, ctx.mode, SYSTEMS, RUN_WHEN_PAUSED) with the
// loop rules from Resources/Data/game.json (`main` + `derived.loop`). `LoopRules.web` holds the same
// values compiled in; GameLoopTests checks they agree with the data.

/// ctx.mode. Only the mission system switches it (GameLoop.setMode emits `game:mode`).
public enum GameMode: String, CaseIterable, Sendable {
  case title, briefing, play, paused, debrief
}

/// ctx.time = { t, dt, realT, realDt, frame }: `t`/`dt` freeze while paused, `realDt` never does.
public struct GameTime: Equatable, Sendable {
  /// Game seconds (sum of dt).
  public var t: Double = 0
  /// This frame's game seconds: 0 while paused, realDt · timeScale otherwise.
  public var dt: Double = 0
  /// Real seconds (sum of realDt).
  public var realT: Double = 0
  /// This frame's real seconds, capped at LoopRules.dtCap.
  public var realDt: Double = 0
  /// Frames since boot.
  public var frame: Int = 0

  public init() {}
}

/// The thirteen systems, in the web's ctx keys (main.js SYSTEMS).
public enum SystemKey: String, CaseIterable, Sendable {
  case weather, ocean, world, hazards, heli, survivors, fx, cameraRig, radio, mission, audio, hud, post
}

/// main.js shader warm-up state machine (ctx.warmup): 'due' → 'compiling' (async) → 'render' (one
/// frame with hidden objects shown) → 'idle'; back to 'due' on `mission:setup` and quality changes.
public enum WarmupState: String, Sendable {
  case due, compiling, render, idle
}

/// Update order and the paused rule.
public struct LoopRules: Equatable, Sendable {
  /// Update order: producers of state before consumers (SYSTEMS).
  public var systems: [SystemKey]
  /// Systems that keep running while paused and always receive realDt (RUN_WHEN_PAUSED).
  public var runWhenPaused: Set<SystemKey>
  /// realDt = min(frame delta, dtCap).
  public var dtCap: Double
  /// pixelRatio budget: never more than ~budgetW × budgetH worth of pixels.
  public var pixelBudgetW: Double
  public var pixelBudgetH: Double

  public init(systems: [SystemKey], runWhenPaused: Set<SystemKey>, dtCap: Double, pixelBudgetW: Double, pixelBudgetH: Double) {
    self.systems = systems
    self.runWhenPaused = runWhenPaused
    self.dtCap = dtCap
    self.pixelBudgetW = pixelBudgetW
    self.pixelBudgetH = pixelBudgetH
  }

  /// The web's values (main.js), compiled in.
  public static let web = LoopRules(
    systems: [.weather, .ocean, .world, .hazards, .heli, .survivors, .fx, .cameraRig, .radio, .mission, .audio, .hud, .post],
    runWhenPaused: [.cameraRig, .audio, .hud, .post, .radio],
    dtCap: 0.1,
    pixelBudgetW: 1920,
    pixelBudgetH: 1080
  )

  /// From the `data` payload of Resources/Data/game.json.
  public init(game json: JSONValue) throws {
    let main = json["main"]
    var systems = [SystemKey]()
    for (i, row) in try main["SYSTEMS"].requireArray("main.SYSTEMS").enumerated() {
      let key = try row[0].requireString("main.SYSTEMS[\(i)][0]")
      guard let k = SystemKey(rawValue: key) else { throw JSONError("main.SYSTEMS: unknown system \(key)") }
      systems.append(k)
    }
    var paused = Set<SystemKey>()
    for key in try main["RUN_WHEN_PAUSED"].requireArray("main.RUN_WHEN_PAUSED") {
      let s = try key.requireString("main.RUN_WHEN_PAUSED[]")
      guard let k = SystemKey(rawValue: s) else { throw JSONError("main.RUN_WHEN_PAUSED: unknown system \(s)") }
      paused.insert(k)
    }
    let derived = json["derived"]
    self.init(
      systems: systems,
      runWhenPaused: paused,
      dtCap: try derived["loop"]["dtCap"].requireDouble("derived.loop.dtCap"),
      pixelBudgetW: try derived["pixelRatio"]["budgetW"].requireDouble("derived.pixelRatio.budgetW"),
      pixelBudgetH: try derived["pixelRatio"]["budgetH"].requireDouble("derived.pixelRatio.budgetH")
    )
  }

  /// main.js pixelRatio(): min(devicePixelRatio || 1, settings.pixelRatioCap(),
  /// max(1, sqrt(budgetW · budgetH / (innerWidth · innerHeight)))) — PLAN §1.4 internal resolution.
  public func pixelRatio(devicePixelRatio: Double, width: Double, height: Double, cap: Double) -> Double {
    let dpr = JSNumber.isTruthy(devicePixelRatio) ? devicePixelRatio : 1
    return JS.min(dpr, cap, JS.max(1, ((pixelBudgetW * pixelBudgetH) / (width * height)).squareRoot()))
  }
}
