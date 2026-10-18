// core/haptics.js: gamepad rumble driven by game events (DESIGN §7.6 «Вибрация»). Scaled by the
// `vibration` setting and silent unless a pad is the active device and the game is in play, so
// keyboard and touch players never get stray vibration calls. The rumble itself goes through
// InputState.rumble → rumbleSink (the app's HapticsDriver, PLAN §2.9).
// Vectors: Tests/Vectors/input/haptics.json (the web's Haptics class on a stub ctx).

/// RULES: event → [strength 0…1, duration ms], nil = no rumble for this payload.
public enum HapticRules {
  /// The events that have a rule, in RULES order (the order Haptics subscribes in).
  public static let events: [EventName] = [
    .heliDamage, .heliWaterStrike, .heliTouchdown, .heliLand, .heliCrash, .heliCapture, .heliPickup,
    .heliSlip, .heliSnag, .hazardHit, .weatherGust, .weatherLightning,
  ]

  /// rule(payload): the rumble an event asks for (nil for events without a rule).
  public static func spec(_ event: GameEvent) -> (strength: Double, duration: Double)? {
    switch event {
    case .heliDamage(let p): return (JS.min(1, 0.35 + JSNumber.or(p.amount, 0) * 3), 220)
    case .heliWaterStrike: return (0.45, 160)
    case .heliTouchdown: return (0.25, 90)
    case .heliLand(let p): return (p.autorotation ? 0.7 : 0.2, 120)
    case .heliCrash: return (1, 700)
    case .heliCapture: return (0.2, 80)
    case .heliPickup: return (0.3, 110)
    case .heliSlip: return (0.5, 200)
    case .heliSnag: return (0.6, 260)
    case .hazardHit(let p): return (JS.min(1, 0.5 + JSNumber.or(p.damage, 0) * 2), 320)
    // p.harmless ? null : [Math.min(0.5, (p.strength || 8) / 30), 260]
    case .weatherGust(let p): return p.harmless ? nil : (JS.min(0.5, JSNumber.or(p.strength, 8) / 30), 260)
    // p.cloudOnly || p.distance > 600 ? null : [Math.max(0.15, 0.7 - p.distance / 900), 240]
    case .weatherLightning(let p): return p.cloudOnly || p.distance > 600 ? nil : (JS.max(0.15, 0.7 - p.distance / 900), 240)
    default: return nil
    }
  }
}

/// ctx.haptics: subscribes every rule on construction (main.js builds it after the systems' init).
public final class Haptics {
  public let input: InputState
  public let settings: GameSettings?
  private let mode: () -> GameMode
  private var subscriptions: [EventSubscription] = []

  /// `mode` reads ctx.mode (GameLoop.mode). Listeners hold the instance, like the web's closures.
  public init(events: EventBus, input: InputState, settings: GameSettings?, mode: @escaping () -> GameMode) {
    self.input = input
    self.settings = settings
    self.mode = mode
    for name in HapticRules.events {
      subscriptions.append(events.on(name) { e in self.fire(HapticRules.spec(e)) })
    }
  }

  /// Unsubscribes every rule (the web never does; tests and app teardown).
  public func detach() {
    for s in subscriptions { s.off() }
    subscriptions.removeAll()
  }

  /// _fire(spec): play mode, pad active, scale = settings.get('vibration') ?? 1, silent when <= 0.
  func fire(_ spec: (strength: Double, duration: Double)?) {
    guard let s = spec, mode() == .play, input.lastDevice == .gamepad else { return }
    let v = settings?.get("vibration") ?? .null
    let scale = v.isNull ? 1 : v.jsToNumber // `<=` and `*` both apply ToNumber to the stored value
    if scale <= 0 { return }
    input.rumble(strength: JS.min(1, s.strength * scale), duration: s.duration)
  }
}
