// heli/ops.js HeliOps: fuel & BINGO (DESIGN §3.7), boost / engine temperature (§3.3), hull (§3.8),
// pads — landing, unload, refuel, repair, resupply (§3.9), consumables (rafts, flares, loudspeaker),
// crash / ditching sequence (§3.15). Stepped at 60 Hz by Helicopter after the flight model and winch.
//
// Parity: same expression shapes and order as the JS (Tests/Vectors/heli/heli_*.json run the real
// Helicopter, whose fixed steps call this). The web keeps pads as live objects; here `h.landed` is a
// PadID and the pad view is re-read from world.pad(id) each step. Cabin records are CabinPerson values.

/// A thrown flare in flight (ops.flights[i]).
public struct FlareFlight: Equatable, Sendable {
  public var x0: Double, y0: Double, z0: Double
  public var x1: Double, z1: Double
  public var t: Double
  /// time of flight (s)
  public var T: Double
  /// current position (lerp + lob)
  public var x: Double, y: Double, z: Double
}

/// A packed raft falling to the water (ops.drops[i]).
public struct RaftDrop: Equatable, Sendable {
  public var x: Double, y: Double, z: Double
  public var vx: Double, vy: Double, vz: Double
  public var spin: Double
}

public final class HeliOps {
  /// difficulty → damage multiplier (anything else → 1)
  public static let DIFF: [String: Double] = ["cadet": 0.6, "pilot": 1, "ace": 1.3]
  /// m/s airspeed assumed for the BINGO estimate
  static let CRUISE: Double = 30
  static let UNLOAD_PERSON: Double = 1
  static let UNLOAD_STRETCHER: Double = 3
  public static let FLARES = 4
  public static let RAFTS = 2
  static let FLARE_RANGE: Double = 120
  static let HORN_COOLDOWN: Double = 6

  /// Last emitted fuel level, ranked ok < low < critical < empty.
  public enum FuelLevel: Int, Sendable {
    case ok = 0, low, critical, empty

    var name: String {
      switch self {
      case .ok: return "ok"
      case .low: return "low"
      case .critical: return "critical"
      case .empty: return "empty"
      }
    }
  }

  unowned let h: Helicopter
  let ctx: SimContext

  public var bingoT: Double = 0
  public var fuelLevel: FuelLevel = .ok
  public var bingoWarned = false
  public var unloadT: Double = 0
  public var unloaded: [CabinPerson] = []
  public var refueling = false
  public var resupplyT: Double = 0
  public var hornT: Double = 0
  public var floodT: Double = 0
  public var overheatT: Double = 0
  public var crewRocketT: Double = -1
  /// thrown flares in the air
  public var flights: [FlareFlight] = []
  /// packed rafts falling to the water
  public var drops: [RaftDrop] = []

  init(heli: Helicopter, ctx: SimContext) {
    self.h = heli
    self.ctx = ctx
  }

  public func reset() {
    bingoT = 0
    fuelLevel = .ok
    bingoWarned = false
    unloadT = 0
    unloaded = []
    refueling = false
    resupplyT = 0
    hornT = 0
    floodT = 0
    overheatT = 0
    crewRocketT = -1
    flights.removeAll()
    drops.removeAll()
    h.flares = HeliOps.FLARES
    h.rafts = HeliOps.RAFTS
  }

  // ---------------------------------------------------------------------------------------------
  /// Per fixed step.
  public func step(_ dt: Double) {
    let play = ctx.mode == .play
    if hornT > 0 { hornT -= dt }
    if floodT > 0 { floodT -= dt }
    if h.emp > 0 { h.emp = JS.max(0, h.emp - dt) }

    // --- crash sequence -------------------------------------------------------------------------
    if h.crash != nil {
      h.crash?.t += dt
      if let c = h.crash, c.phase == .autorot, c.t > 6 { ditch(c.reason) } // safety: normally the water ends it at ~3 s
      if h.crash?.phase == .ditched && crewRocketT >= 0 {
        crewRocketT += dt
        if crewRocketT > 2.6 {
          crewRocketT = -1
          let p = h.position
          // The crew's own raft fires a red rocket: now they are the ones being rescued.
          if let fx = ctx.fx, !fx.burstRocket(V3(p.x + 4, 0, p.z + 3), color: "#FF3A22") { fx.flare(p.x + 4, p.z + 3) }
        }
      }
      h.boosting = false
      return
    }

    // --- engine temperature / boost ---------------------------------------------------------------
    let st = ctx.weatherState
    if overheatT > 0 {
      overheatT -= dt
      h.boosting = false
      if overheatT <= 0 { h.engineTemp = 60 }
    } else {
      h.boosting = play && h.boostHeld && h.fuel > 0 && h.landed == nil
      if h.boosting { h.engineTemp += 12 * dt } else { h.engineTemp -= (JSNumber.or(st.rain, 0) > 0.3 ? 14 : 10) * dt }
      if h.engineTemp >= 100 {
        h.engineTemp = 100
        overheatT = 6
        h.boosting = false
        ctx.events.emit(GameEvent.HeliOverheat())
      }
    }
    h.engineTemp = JS.max(0, JS.min(100, h.engineTemp))
    h.overheat = JS.max(0, overheatT)
    h.boost = h.boosting

    // --- thrust factor ---------------------------------------------------------------------------
    var tf: Double = 1
    if h.hull < 0.25 { tf = 0.9 }
    if overheatT > 0 { tf = JS.min(tf, 0.6) }
    if floodT > 0 { tf = JS.min(tf, 0.6) }
    if inVortexCore() { tf = JS.min(tf, 0.4) }
    h.thrustFactor = tf

    // --- fuel --------------------------------------------------------------------------------------
    if play && h.landed == nil && h.fuel > 0 {
      var burn = 0.3 + 0.25 * JSNumber.or(h.uMag, 0) + 0.6 * (h.boosting ? 1 : 0) + 0.01 * Double(h.cabin.count)
      if let r = ctx.mission?.areaRadius, JSNumber.isTruthy(r), JS.hypot(h.position.x, h.position.z) > r { burn *= 1.5 }
      h.fuelBurn = burn
      h.fuel = JS.max(0, h.fuel - (burn / 100) * dt)
      fuelLevels()
      if h.fuel <= 0 && !h.autorotation {
        h.autorotation = true
        ctx.events.emit(GameEvent.HeliAutorotation())
      }
    }
    if h.autorotation && h.fuel > 0.001 { h.autorotation = false }

    // --- BINGO: fuel to the nearest pad with headwind + 10 %, every 0.5 s --------------------------
    bingoT -= dt
    if bingoT <= 0 {
      bingoT = 0.5
      bingo()
    }

    // --- on a pad: unload, refuel, repair, resupply ------------------------------------------------
    if h.landed != nil { padServices(dt) }

    // --- thrown flares, falling rafts -------------------------------------------------------------
    stepFlares(dt)
    stepDrops(dt)
  }

  /// Inside the core of a mature waterspout / tornado (thrust ×0.4).
  func inVortexCore() -> Bool {
    guard let list = ctx.hazards?.list, !list.isEmpty else { return false }
    let p = h.position
    for z in list {
      if z.type != "waterspout" && z.type != "tornado" { continue }
      let rc = JSNumber.or(z.core, z.type == "tornado" ? 35 : 15)
      if JS.hypot(z.position.x - p.x, z.position.z - p.z) < rc && (z.stage == nil || (z.stage ?? 0) >= 4) { return true }
    }
    return false
  }

  func fuelLevels() {
    let f = h.fuel
    let level: FuelLevel = f <= 0 ? .empty : f <= 0.1 ? .critical : f <= 0.25 ? .low : .ok
    if level.rawValue > fuelLevel.rawValue { ctx.events.emit(GameEvent.HeliFuelLow(fuel: f, level: level.name)) }
    fuelLevel = level
  }

  func bingo() {
    let p = h.position
    guard let pad = ctx.world?.nearestPad(p.x, p.z) else {
      h.bingo = 0.1
      return
    }
    let dx = pad.position.x - p.x
    let dz = pad.position.z - p.z
    let d = JS.hypot(dx, dz)
    var along: Double = 0
    if d > 1, let weather = ctx.weather {
      let w = weather.windAt(p.x, p.z)
      let prof = JS.min(1.4, JS.max(0.6, 0.6 + 0.008 * 40))
      along = ((w.x * dx + w.y * dz) / d) * prof * 0.6
    }
    let gs = JS.max(6, HeliOps.CRUISE + along)
    var burn = 0.55 + 0.01 * Double(h.cabin.count)
    if let r = ctx.mission?.areaRadius, JSNumber.isTruthy(r), JS.hypot(p.x, p.z) > r { burn *= 1.5 }
    h.bingo = JS.min(1, ((d / gs) * burn) / 100 + 0.1)
    h.bingoPad = pad.id
    if h.landed == nil && h.fuel <= h.bingo && !bingoWarned && ctx.mode == .play {
      bingoWarned = true
      ctx.events.emit(GameEvent.HeliFuelLow(fuel: h.fuel, level: "bingo", pad: pad.id))
    }
    if h.fuel > h.bingo + 0.05 { bingoWarned = false }
  }

  // ---------------------------------------------------------------------------------------------
  public func damage(_ amount: Double, _ source: DamageSource) {
    if !(amount > 0) || !h.alive || h.crash != nil || ctx.mode != .play { return }
    let diff = ctx.settings.get("difficulty").string.flatMap { HeliOps.DIFF[$0] }
    var amt = amount * JSNumber.or(diff, 1)
    if h.firstHit {
      amt *= 0.5 // «тебя предупреждали»
      h.firstHit = false
    }
    h.hull = JS.max(0, h.hull - amt)
    h.damageTaken += amt
    if source.floodsIntake { floodT = 3 } // intake flooded: thrust ×0.6 for 3 s
    if source.isElectrical { h.emp = JS.max(h.emp, 4) }
    ctx.events.emit(GameEvent.HeliDamage(amount: amt, source: source.rawValue, hull: h.hull))
    if h.hull <= 0 { startCrash("hull") }
  }

  // ---------------------------------------------------------------------------------------------
  public func land(_ pad: LandingPad) {
    let f = h.flight
    h.landed = pad.id
    f.attachTo(pad)
    f.v.set(0, 0, 0)
    f.contactPad = pad.id
    h.altTarget = f.p.y
    unloadT = 0
    unloaded = []
    resupplyT = 0
    refueling = false
    let auto = h.autorotation
    ctx.events.emit(GameEvent.HeliLand(pad: pad.id, autorotation: auto, vy: JSNumber.or(f.lastVy, 0)))
  }

  public func takeoff() {
    guard let pad = h.landed else { return }
    finishUnload(pad)
    if refueling {
      refueling = false
      ctx.events.emit(GameEvent.HeliRefuel(pad: pad, state: "stop", fuel: h.fuel))
    }
    h.landed = nil
    ctx.events.emit(GameEvent.HeliTakeoff(pad: pad))
  }

  func padServices(_ dt: Double) {
    guard let id = h.landed else { return }
    if ctx.mode != .play { return }
    // Unload: 1 s per person, 3 s per stretcher → heli:unload {pad, count, people}.
    if !h.cabin.isEmpty {
      unloadT += dt
      let first = h.cabin[0]
      let need = first.stretcher ? HeliOps.UNLOAD_STRETCHER : HeliOps.UNLOAD_PERSON
      if unloadT >= need {
        unloadT = 0
        h.cabin.removeFirst()
        unloaded.append(first)
        ctx.events.emit(GameEvent.HeliUnloadPerson(pad: id, person: first.id, left: h.cabin.count))
        if h.cabin.isEmpty { finishUnload(id) }
      }
    }
    // The web reads services off the live pad object; a pad the world no longer reports offers none.
    guard let pad = ctx.world?.pad(id) else { return }
    let sv = pad.services ?? PadServices()
    // Refuel (%/s from pad.services.fuel; legacy pad.refuel → 10 %/s).
    let rate = sv.fuel ?? (pad.refuel ? 10 : 0)
    if rate > 0 && h.fuel < 1 {
      if !refueling {
        refueling = true
        ctx.events.emit(GameEvent.HeliRefuel(pad: id, state: "start", fuel: h.fuel))
      }
      h.fuel = JS.min(1, h.fuel + (rate / 100) * dt)
      if h.fuel >= 1 {
        refueling = false
        fuelLevel = .ok
        ctx.events.emit(GameEvent.HeliRefuel(pad: id, state: "done", fuel: 1))
      }
    }
    h.refueling = refueling
    // Repair (lighthouse only, 4 %/s).
    if let repair = sv.repair, repair > 0, h.hull < 1 { h.hull = JS.min(1, h.hull + (repair / 100) * dt) }
    // Resupply: flares and rafts back to full after a moment on the deck.
    if sv.resupply == true || (sv.resupply == nil && pad.refuel && pad.type != "rig") {
      resupplyT += dt
      if resupplyT > 1.5 && (h.flares < HeliOps.FLARES || h.rafts < HeliOps.RAFTS) {
        h.flares = HeliOps.FLARES
        h.rafts = HeliOps.RAFTS
        ctx.events.emit(GameEvent.HeliResupply(pad: id))
      }
    }
  }

  func finishUnload(_ pad: PadID) {
    if unloaded.isEmpty { return }
    let people = unloaded
    unloaded = []
    ctx.events.emit(GameEvent.HeliUnload(pad: pad, count: people.count, people: people.map(\.id)))
  }

  // ---------------------------------------------------------------------------------------------
  // Consumables (called on button presses in 'play').
  @discardableResult
  public func flare() -> Bool {
    if h.flares <= 0 || h.crash != nil { return false }
    let p = h.position
    let a = h.aim
    var dx = a.x - p.x
    var dz = a.z - p.z
    let d = JS.hypot(dx, dz)
    if d > HeliOps.FLARE_RANGE {
      dx *= HeliOps.FLARE_RANGE / d
      dz *= HeliOps.FLARE_RANGE / d
    }
    h.flares -= 1
    let T = 0.7 + (JS.min(d, HeliOps.FLARE_RANGE) / HeliOps.FLARE_RANGE) * 0.9
    let ox = p.x + JS.sin(h.heading) * 0.5
    let oz = p.z - JS.cos(h.heading) * 0.5
    flights.append(FlareFlight(x0: ox, y0: p.y - 1, z0: oz, x1: p.x + dx, z1: p.z + dz, t: 0, T: T, x: ox, y: p.y - 1, z: oz))
    ctx.events.emit(GameEvent.HeliFlareThrow(x: p.x + dx, z: p.z + dz, eta: T))
    return true
  }

  func stepFlares(_ dt: Double) {
    var i = flights.count - 1
    while i >= 0 {
      var f = flights[i]
      f.t += dt
      let k = JS.min(1, f.t / f.T)
      let sea = ctx.ocean?.heightAt(f.x1, f.z1) ?? 0
      f.x = f.x0 + (f.x1 - f.x0) * k
      f.z = f.z0 + (f.z1 - f.z0) * k
      // ballistic-looking arc: small lob, then falls
      f.y = f.y0 + (sea - f.y0) * k * k + 6 * k * (1 - k)
      flights[i] = f
      if k >= 1 {
        flights.remove(at: i)
        ctx.fx?.flare(f.x1, f.z1)
        ctx.ocean?.splash(f.x1, f.z1, 1.2, 0.4)
        ctx.events.emit(GameEvent.HeliFlare(x: f.x1, z: f.z1))
      }
      i -= 1
    }
  }

  @discardableResult
  public func raftDrop() -> Bool {
    if h.rafts <= 0 || h.landed != nil || h.crash != nil { return false }
    h.rafts -= 1
    // Pushed out of the starboard door: the packed raft falls (drifting with the heli's speed) and
    // the event fires at the splash, where survivors inflate it.
    let o = h.hoistWorld
    let v = h.velocity
    drops.append(RaftDrop(x: o.x, y: o.y - 0.4, z: o.z, vx: v.x + JS.cos(h.heading) * 2.5, vy: 0,
                          vz: v.z + JS.sin(h.heading) * 2.5, spin: 0))
    ctx.events.emit(GameEvent.HeliRaftThrow(x: o.x, z: o.z))
    return true
  }

  func stepDrops(_ dt: Double) {
    var i = drops.count - 1
    while i >= 0 {
      var d = drops[i]
      d.vy -= 9.81 * dt
      d.vx *= JS.exp(-0.6 * dt)
      d.vz *= JS.exp(-0.6 * dt)
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.z += d.vz * dt
      d.spin += dt * 3
      drops[i] = d
      let sea = ctx.ocean?.heightAt(d.x, d.z) ?? 0
      if d.y <= sea {
        drops.remove(at: i)
        ctx.ocean?.splash(d.x, d.z, 2.5, 0.8)
        ctx.fx?.splash(d.x, sea, d.z, 1.5)
        ctx.events.emit(GameEvent.HeliRaftDrop(x: d.x, z: d.z))
      }
      i -= 1
    }
  }

  @discardableResult
  public func horn() -> Bool {
    if hornT > 0 || h.crash != nil { return false }
    hornT = HeliOps.HORN_COOLDOWN
    ctx.events.emit(GameEvent.HeliLoudspeaker(x: h.position.x, z: h.position.z))
    return true
  }

  public var hornCooldown: Double { JS.max(0, hornT) }

  // ---------------------------------------------------------------------------------------------
  /// Crash: 3 s of controlled autorotation → ditching → heli:crash (camera does the slow-mo & rise).
  public func startCrash(_ reason: String) {
    if h.crash != nil { return }
    if h.winch.load != nil { h.winch.slip("crash") }
    h.crash = HeliCrashState(phase: .autorot, t: 0, reason: reason)
    h.landed = nil
    ctx.events.emit(GameEvent.HeliFailing(reason: reason))
  }

  /// deck: the pad the failing heli came down on (it stays there, wrecked) — otherwise the sea.
  public func ditch(_ reason: String = "hull", _ deck: LandingPad? = nil) {
    if h.crash?.phase == .ditched { return }
    var crash = h.crash ?? HeliCrashState(phase: .ditched, t: 0, reason: reason)
    crash.phase = .ditched
    crash.reason = reason
    crash.t = 0
    crash.deck = deck?.id
    h.crash = crash
    h.alive = false
    h.landed = nil
    h.setSearchlight(false)
    let f = h.flight
    f.v.multiplyScalar(0.25)
    f.v.y = 0
    let p = f.p
    if let deck {
      f.attachTo(deck)
      ctx.fx?.sparks(p.x, p.y - 1.4, p.z, "#FFB050", 30)
    } else {
      ctx.ocean?.splash(p.x, p.z, 9, 1)
      ctx.fx?.splash(p.x, f.sea, p.z, 4)
      ctx.fx?.spray(p.x, p.z, V2(0, 0), 60)
      crewRocketT = 0
    }
    ctx.events.emit(GameEvent.HeliCrash(reason: reason, x: p.x, z: p.z, onDeck: deck != nil, pad: deck?.id))
  }
}
