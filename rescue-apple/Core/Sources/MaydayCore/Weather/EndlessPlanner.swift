// «Смена» weather escalation (systems/weather/endless.js; DESIGN §3.13 [MUST]).
//
// * Intensity I(t) = min(1, t/900) + 0.08·sin(t/90), t = shift time in play.
// * Every 90–180 s the next preset is drawn with weight exp(−(sev − 4·I)²/1.5), current excluded.
//   Day (before 13:30): calm, overcast, fog, squall, storm, clearing. 13:30 → forced clearing (sunset),
//   15:00 → night; afterwards only nightStorm / nightCalm.
// * Relief: after ≥ 120 s at severity ≥ 3, 35 % chance of a lull (clearing by day, nightCalm by night).
// * Forecast is 80 % accurate: a planned front may «intensify en route» by one severity step.
// * The shift clock runs CLOCK_RATE× faster than real time.
// Draws from the weather's shared RNG in the same order as the JS.

public final class EndlessPlanner {
  public enum Phase: String, Sendable { case day, sunset, night }

  /// The planned change (`next`): announced preset, start time (shift seconds), duration, lull flag.
  public struct Plan: Equatable, Sendable {
    public var at: Double
    public var preset: String
    public var over: Double
    public var lull = false
  }

  let tables: WeatherTables
  let rng: Rng
  public private(set) var active = false
  /// Shift time in play, s.
  public private(set) var t: Double = 0
  public private(set) var next: Plan? = nil
  public private(set) var inPreset: Double = 0
  public private(set) var lullRolled = false
  public private(set) var phase: Phase = .day
  public private(set) var nightPick: String? = nil

  init(tables: WeatherTables, rng: Rng) {
    self.tables = tables
    self.rng = rng
  }

  public func start(_ tod: Double) {
    active = true
    t = 0
    inPreset = 0
    lullRolled = false
    phase = tod >= tables.nightfall || tod < 0.2 ? .night : tod >= tables.sunset ? .sunset : .day
    next = nil
    nightPick = pick(tables.endlessNight, exclude: nil)
  }

  public func stop() {
    active = false
    next = nil
  }

  public func intensity() -> Double {
    JS.min(1, t / 900) + 0.08 * JS.sin(t / 90)
  }

  func pick(_ set: [String], exclude: String?) -> String {
    let I = intensity()
    var total = 0.0
    var w = [Double]()
    w.reserveCapacity(set.count)
    for name in set {
      let v = name == exclude ? 0 : JS.exp(-JS.pow(tables.severityOf(name) - 4 * I, 2) / 1.5)
      w.append(v)
      total += v
    }
    var r = rng.next() * total
    for i in 0..<set.count {
      r -= w[i]
      if r <= 0 && w[i] > 0 { return set[i] }
    }
    return set.first(where: { $0 != exclude }) ?? set[0]
  }

  func plan(_ current: String, _ delay: Double) {
    let set = phase == .night ? tables.endlessNight : tables.endlessDay
    let at = t + delay
    let preset = pick(set, exclude: current)
    next = Plan(at: at, preset: preset, over: 30 + rng.next() * 25)
  }

  /// Seconds of shift time until the shift clock reaches `tod`.
  func until(_ clockTod: Double, _ tod: Double) -> Double {
    ((tod - clockTod) * 86400) / tables.clockRate
  }

  /// Advance; returns (to, over) when a transition must start now, else nil.
  /// `preset` / `timeOfDay` = weather.state.preset / .timeOfDay.
  public func update(_ dt: Double, preset cur: String, timeOfDay tod: Double) -> (to: String, over: Double)? {
    if !active { return nil }
    t += dt
    inPreset += dt

    // Clock-driven phases.
    if phase == .day && tod >= tables.sunset {
      phase = .sunset
      next = nil
      nightPick = pick(tables.endlessNight, exclude: nil)
      return go("clearing", 60)
    }
    if phase == .sunset && tod >= tables.nightfall {
      phase = .night
      next = nil
      return go(nightPick ?? "nightCalm", 60)
    }
    if phase == .sunset { return nil }

    // Relief roll once per heavy spell.
    if !lullRolled && tables.severityOf(cur) >= 3 && inPreset >= 120 {
      lullRolled = true
      if rng.next() < 0.35 {
        next = Plan(at: t + 15, preset: phase == .night ? "nightCalm" : "clearing", over: 40, lull: true)
      }
    }

    if next == nil { plan(cur, 90 + rng.next() * 90) }
    guard let n = next, t >= n.at else { return nil }

    // 80 % accurate forecast: 20 % the front intensifies by one step on the way.
    var to = n.preset
    if !n.lull && rng.next() < 0.2 {
      let set = phase == .night ? tables.endlessNight : tables.endlessDay
      let worse = set.filter { tables.severityOf($0) == tables.severityOf(to) + 1 && $0 != cur }
      if !worse.isEmpty { to = worse[Int((rng.next() * Double(worse.count)).rounded(.down))] }
    }
    let over = n.over
    next = nil
    return go(to, over)
  }

  func go(_ to: String, _ over: Double) -> (to: String, over: Double) {
    inPreset = 0
    lullRolled = false
    return (to, over)
  }

  /// Forecast for the HUD / radio: calls fn(inSeconds, preset) for each announced change, soonest first
  /// (announced = possibly inaccurate).
  public func forEachUpcoming(timeOfDay tod: Double, _ fn: (Double, String) -> Void) {
    if !active { return }
    let nextIn = next.map { JS.max(0, $0.at - t) } ?? .infinity
    var clockIn = Double.infinity
    var clockPreset: String? = nil
    if phase == .day {
      clockIn = JS.max(0, until(tod, tables.sunset))
      clockPreset = "clearing"
    } else if phase == .sunset {
      clockIn = JS.max(0, until(tod, tables.nightfall))
      clockPreset = nightPick ?? "nightCalm"
    }
    if nextIn <= clockIn {
      if let n = next { fn(nextIn, n.preset) }
      if let cp = clockPreset, clockIn < .infinity { fn(clockIn, cp) }
    } else if let cp = clockPreset {
      // the planned change is cancelled by the clock (sunset / nightfall resets the plan)
      fn(clockIn, cp)
    }
  }

  /// Next planned change: (in, preset), nil if none. (The barometer starts falling 15 s before it.)
  public func upcoming(timeOfDay tod: Double) -> (in: Double, preset: String)? {
    if !active { return nil }
    var best = Double.infinity
    var preset: String? = nil
    if let n = next {
      best = n.at - t
      preset = n.preset
    }
    if phase == .day {
      let s = until(tod, tables.sunset)
      if s < best {
        best = s
        preset = "clearing"
      }
    } else if phase == .sunset {
      let s = until(tod, tables.nightfall)
      if s < best {
        best = s
        preset = nightPick ?? "nightCalm"
      }
    }
    guard best < .infinity, let p = preset else { return nil }
    return (JS.max(0, best), p)
  }

  // ---- checkpoint / tests ---------------------------------------------------------------------------
  /// Full planner state (WeatherSim.snapshot()).
  public struct Snapshot: Equatable, Sendable {
    public var active: Bool
    public var t: Double
    public var next: Plan?
    public var inPreset: Double
    public var lullRolled: Bool
    public var phase: Phase
    public var nightPick: String?
  }

  var snapshot: Snapshot {
    Snapshot(active: active, t: t, next: next, inPreset: inPreset, lullRolled: lullRolled, phase: phase, nightPick: nightPick)
  }

  func restore(_ s: Snapshot) {
    active = s.active
    t = s.t
    next = s.next
    inPreset = s.inPreset
    lullRolled = s.lullRolled
    phase = s.phase
    nightPick = s.nightPick
  }
}
