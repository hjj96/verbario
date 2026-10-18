// Lightning scheduler + flash envelope (systems/weather/lightning.js; DESIGN §2.8 «Вспышка», §2.12,
// §3.12 «Молния», CONTRACT weather).
//
// * Poisson strikes at the preset rate (per minute, wind channel), only while intensity ≥ 0.6.
// * 70 % in-cloud (`cloudOnly`, harmless, immediate); 30 % sea strikes ≤ 600 m from the heli; above 70 m
//   altitude 35 % of those target the heli. Sea strikes are telegraphed: `weather:charge` 2 s before
//   (3 s on cadet difficulty) + St. Elmo's fire when the heli is inside the charge zone.
// * Tall obstacles (rig derrick, masts) attract the harmless sea strikes nearby.
// * Flash envelope: triple pulse; photosensitivity: ≤ 3 full-screen pulses per second (one strike per
//   second at most); `reduceFlashes` → one soft pulse (attack 120 ms, decay 600 ms, peak 0.3) ≤ 1 per 1.5 s.
//
// Like the JS, every method takes the owning WeatherSim (`w`): heli position / altitude, the state it
// writes (flash, flashColor, stElmo, lastStrike), the shared RNG, events, settings and obstacles.

public final class LightningSim {
  /// One telegraphed charge slot (lightning.js `charges[i]`).
  public struct Charge: Equatable, Sendable {
    public var x: Double = 0
    public var z: Double = 0
    public var eta: Double = 0
    public var total: Double = 2
    public var radius: Double = 30
    public var target = "sea" // 'sea' | 'heli'
    public var strength: Double = 1
    public var alive = false
  }

  /// charge() options (`{ eta, radius = 30, target = 'sea', strength = 1 }`; eta nil = 2 s, 3 s on cadet).
  public struct ChargeOptions: Sendable {
    public var eta: Double?
    public var radius: Double
    public var target: String
    public var strength: Double

    public init(eta: Double? = nil, radius: Double = 30, target: String = "sea", strength: Double = 1) {
      self.eta = eta
      self.radius = radius
      self.target = target
      self.strength = strength
    }
  }

  let tables: WeatherTables
  let rng: Rng
  public private(set) var charges: [Charge]
  public private(set) var flashT: Double = 99
  public private(set) var flashStrength: Double = 0
  public private(set) var flashReduced = false
  /// Weather-lightning clock of the last full flash.
  public private(set) var lastFlashAt: Double = -99
  public private(set) var timer: Double = 6
  public private(set) var clock: Double = 0
  public let dayColor: PaletteColor
  public let nightColor: PaletteColor
  /// (x, z) → lights swing; set by WeatherSim. Called only when the strike produced a new flash.
  var onStrike: ((Double, Double) -> Void)?

  init(tables: WeatherTables, rng: Rng) {
    self.tables = tables
    self.rng = rng
    charges = [Charge](repeating: Charge(), count: tables.maxCharges)
    dayColor = tables.flashDay
    nightColor = tables.flashNight
  }

  // ---- envelopes (exposed for the photosensitivity vectors) -----------------------------------------
  /// DESIGN §2.8: flash = min(1, exp(−14t) + [t>.11]·.75·exp(−10(t−.11)) + [t>.23]·.45·exp(−7(t−.23)))
  public static func envelope(_ t: Double) -> Double {
    var f = JS.exp(-t * 14)
    if t > 0.11 { f += 0.75 * JS.exp(-(t - 0.11) * 10) }
    if t > 0.23 { f += 0.45 * JS.exp(-(t - 0.23) * 7) }
    return JS.min(1, f)
  }

  /// reduceFlashes: one soft pulse, smoothstep attack over 120 ms, smoothstep decay over 600 ms.
  public static func envelopeReduced(_ t: Double) -> Double {
    if t < 0.12 {
      let k = t / 0.12
      return k * k * (3 - 2 * k)
    }
    let d = (t - 0.12) / 0.6
    if d >= 1 { return 0 }
    let k = 1 - d
    return k * k * (3 - 2 * k)
  }

  public func reset() {
    for i in charges.indices { charges[i].alive = false }
    flashT = 99
    flashStrength = 0
    timer = 4 + rng.next() * 6
  }

  /// `!!settings.get('reduceFlashes')`
  func reduce(_ w: WeatherSim) -> Bool { w.settings?.flag("reduceFlashes") ?? false }

  /// Telegraphed sea strike at (x, z). Returns the charge slot.
  @discardableResult
  public func charge(_ w: WeatherSim, _ x: Double, _ z: Double, _ opts: ChargeOptions = ChargeOptions()) -> Int {
    let cadet = w.settings?.string("difficulty") == "cadet"
    let e = opts.eta ?? (cadet ? 3 : 2)
    var slot = -1
    for i in charges.indices where !charges[i].alive {
      slot = i
      break
    }
    if slot < 0 {
      // all slots busy: strike the most imminent one now and reuse it (reduce((a, b) => a.eta < b.eta ? a : b))
      var best = 0
      for i in 1..<charges.count { best = charges[best].eta < charges[i].eta ? best : i }
      let c = charges[best]
      strike(w, c.x, c.z, strength: c.strength)
      slot = best
    }
    charges[slot] = Charge(x: x, z: z, eta: e, total: e, radius: opts.radius, target: opts.target, strength: opts.strength, alive: true)
    let hp = w.heliPos
    let inside = JS.hypot(hp.x - x, hp.z - z) < opts.radius * 1.5
    w.events.emit(GameEvent.WeatherCharge(x: x, z: z, radius: opts.radius, eta: e, target: opts.target, heli: inside))
    return slot
  }

  /// Immediate strike (in-cloud or at sea).
  public func strike(_ w: WeatherSim, _ x: Double, _ z: Double, cloudOnly: Bool = false, strength: Double = 1) {
    let hp = w.heliPos
    let distance = JS.hypot(hp.x - x, hp.z - z)
    w.state.lastStrike = WeatherState.Strike(x: x, z: z, distance: distance, cloudOnly: cloudOnly, t: clock)
    w.events.emit(GameEvent.WeatherLightning(x: x, z: z, distance: distance, strength: strength, cloudOnly: cloudOnly))
    // Flash: weaker in-cloud and far away; lightning reads stronger in the dark.
    let f = strength * (cloudOnly ? 0.75 : 1) * (1 - 0.4 * MathUtils.clamp(distance / 700, 0, 1)) * (0.62 + 0.38 * w.state.night)
    if flash(w, f), let cb = onStrike { cb(x, z) }
  }

  func flash(_ w: WeatherSim, _ f: Double) -> Bool {
    let reduce = reduce(w)
    let gap = reduce ? tables.minGapReduced : tables.minGap
    if clock - lastFlashAt < gap {
      // inside the photosensitivity window: never re-trigger, only let a stronger strike lift the tail
      if !reduce && flashT > 0.3 { flashStrength = JS.max(flashStrength * 0.5, JS.min(1, f) * 0.35) }
      return false
    }
    lastFlashAt = clock
    flashT = 0
    flashStrength = JS.min(1, f)
    flashReduced = reduce
    return true
  }

  public func update(_ dt: Double, _ w: WeatherSim, allowRandom: Bool, playing: Bool) {
    clock += dt

    // --- flash envelope -------------------------------------------------------------------------------
    flashT += dt
    var flash = 0.0
    if flashReduced {
      flash = LightningSim.envelopeReduced(flashT) * 0.3 * JS.min(1, 0.5 + flashStrength)
    } else if flashT < 1.5 {
      flash = LightningSim.envelope(flashT) * flashStrength
    }
    w.state.flash = flash < 1e-3 ? 0 : flash
    w.state.flashColor = dayColor.lerp(nightColor, w.state.night)

    // --- telegraphed charges --------------------------------------------------------------------------
    let hp = w.heliPos
    var elmo = 0.0
    for i in charges.indices {
      if !charges[i].alive { continue }
      charges[i].eta -= dt
      let c = charges[i]
      if JS.hypot(hp.x - c.x, hp.z - c.z) < c.radius * 1.5 { elmo = JS.max(elmo, 1 - JS.max(0, c.eta) / c.total) }
      if c.eta <= 0 {
        charges[i].alive = false
        strike(w, c.x, c.z, strength: c.strength)
      }
    }
    w.state.stElmo = elmo > w.state.stElmo ? elmo : JS.max(elmo, w.state.stElmo - dt * 1.5)

    // --- random strikes -------------------------------------------------------------------------------
    let rate = w.state.palette.lightningPerMin
    if !allowRandom || rate < 0.01 || w.state.intensity < 0.6 - 1e-3 {
      timer = JS.max(timer, 3)
      return
    }
    timer -= dt
    if timer > 0 { return }
    timer = JS.max(1.2, (-JS.log(1 - rng.next() * 0.999) * 60) / rate)

    if rng.next() < 0.7 {
      // in-cloud «spider» somewhere around the heli
      let a = rng.next() * JS.PI * 2
      let r = 80 + rng.next() * 620
      // argument order of the JS call: x, z, then the options object literal (strength draws last)
      let x = hp.x + JS.cos(a) * r
      let z = hp.z + JS.sin(a) * r
      strike(w, x, z, cloudOnly: true, strength: 0.45 + 0.35 * rng.next())
      return
    }
    // sea strike
    let alt = w.heliAlt
    if playing && alt > 70 && rng.next() < 0.35 {
      let a = rng.next() * JS.PI * 2
      let r = rng.next() * 6
      charge(w, hp.x + JS.cos(a) * r, hp.z + JS.sin(a) * r, ChargeOptions(target: "heli"))
      return
    }
    let a = rng.next() * JS.PI * 2
    let r = 40 + 560 * JS.sqrt(rng.next())
    var x = hp.x + JS.cos(a) * r
    var z = hp.z + JS.sin(a) * r
    // Masts and the rig's lightning rod attract harmless strikes nearby.
    let obstacles = w.obstacles
    if !obstacles.isEmpty {
      var best: WeatherObstacle? = nil
      var bd = 140.0
      for o in obstacles {
        if (o.top ?? 0) < 20 { continue }
        let d = JS.hypot(o.x - x, o.z - z)
        if d < bd {
          bd = d
          best = o
        }
      }
      if let b = best, rng.next() < 0.6 {
        x = b.x
        z = b.z
      }
    }
    charge(w, x, z, ChargeOptions(target: "sea"))
  }

  // ---- checkpoint / tests ---------------------------------------------------------------------------
  func restore(_ s: Snapshot) {
    if s.charges.count == charges.count { charges = s.charges }
    flashT = s.flashT
    flashStrength = s.flashStrength
    flashReduced = s.flashReduced
    lastFlashAt = s.lastFlashAt
    timer = s.timer
    clock = s.clock
  }

  /// Full scheduler state (WeatherSim.snapshot()).
  public struct Snapshot: Equatable, Sendable {
    public var charges: [Charge]
    public var flashT: Double
    public var flashStrength: Double
    public var flashReduced: Bool
    public var lastFlashAt: Double
    public var timer: Double
    public var clock: Double
  }

  var snapshot: Snapshot {
    Snapshot(charges: charges, flashT: flashT, flashStrength: flashStrength, flashReduced: flashReduced,
             lastFlashAt: lastFlashAt, timer: timer, clock: clock)
  }
}

/// A tall obstacle that attracts sea strikes (world.obstacles: {x, z, top}).
public struct WeatherObstacle: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var top: Double?

  public init(x: Double, z: Double, top: Double?) {
    self.x = x
    self.z = z
    self.top = top
  }
}
