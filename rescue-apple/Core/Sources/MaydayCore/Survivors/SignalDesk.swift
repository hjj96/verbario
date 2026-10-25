// survivors/signals.js — distress signals (DESIGN §2.10 signal table, §3.10 tools table, §4 #19, #20, #24):
//   red parachute rocket  — rotor heard (< 700 m), nobody has seen them: every 30–45 s, 2–3 per group;
//                           «СИГНАЛ» for 20 s with ±20 m accuracy (fx.burst('rocket'))
//   orange smoke (day)    — lit when the heli is closer than 400 m, burns 60 s, seen from 500 m (fx.smoke)
//   handheld flare (night)— 15 Hz red flicker, pooled light, smoke lit red (fx.flare follows the hand)
//   whistle               — unseen within 150 m: every 4–7 s (positional sound + HUD arc ±15°)
//   EPIRB                 — bearing ping within 2 km, error 30°·clamp(d/1500) + noise (radar)
//   dye (fluorescein)     — released when the rotor is heard; patch grows 10 → 25 m, stretched downwind
//   mirror (sunny)        — star flash (150 ms, ×10) every 3–6 s while the heli is within 300 m
//   loudspeaker answers   — unseen within 180 m answer 1–2 s later with a whistle or a shout
// Every signal is mirrored by `survivor:signal {s, kind, x, z, error, arc}` so HUD arcs and the audio play in
// sync; shouts by `survivor:shout {s, reason}`. All draws come from the survivors' seeded rng, in the JS order.

/// num(v, d): `true` → max(1, d), a finite number → itself, anything else → d.
@inline(__always) func signalCount(_ v: JSONValue, _ d: Double) -> Double {
  if v.bool == true { return JS.max(1, d) }
  if let n = v.double, n.isFinite, case .number = v { return n }
  return d
}

extension SurvivorSignals {
  /// initSignals(s, entry, rng, script): a group whose rocket is a scripted beat (DESIGN §3.16 onboarding)
  /// holds its own rockets until that beat has fired, so the staging is not pre-empted.
  static func make(type t: String, entry: SurvivorEntry, rng: Rng, script: JSONValue) -> SurvivorSignals {
    let d = entry["signals"]
    let tag = entry["tag"]
    var hold = false
    if !tag.isNull, let beats = script.array {
      hold = beats.contains { b in b.jsTruthy && b["do"].string == "rocket" && b["tag"].jsStrictEquals(tag) }
    }
    let rockets = signalCount(d["rockets"], t == "raft" ? 2 : 0)
    let smoke = d["smoke"].jsTruthy ? signalCount(d["smoke"], 1) : 0
    let fl = d["flares"].isNull ? d["flare"] : d["flares"]
    let flares = signalCount(fl, t == "raft" || t == "hull" ? 1 : 0)
    let whistle = d["whistle"].isNull ? (t == "swimmer" || t == "injured") : d["whistle"].jsTruthy
    let whistleT = 1 + rng.next() * 3
    let mirrorT = 1 + rng.next() * 2
    let epirbT = rng.next() * 3
    return SurvivorSignals(rockets: rockets, rocketHold: hold, smoke: smoke, flares: flares, whistle: whistle, whistleT: whistleT,
                           dye: d["dye"].jsTruthy, mirror: d["mirror"].jsTruthy, mirrorT: mirrorT, epirb: d["epirb"].jsTruthy, epirbT: epirbT,
                           strobe: d["strobe"].bool)
  }
}

/// Is the personal strobe on for this group right now?
@inline(__always) func strobeOn(_ s: SurvivorGroup, _ night: Double) -> Bool {
  if s.sig.strobe == false { return false }
  if s.sig.strobe == true { return true } // equipped and switched on (useless by day, but it blinks)
  return (s.type == "swimmer" || s.type == "injured") && night > 0.45
}

public final class SignalDesk {
  unowned let sys: Survivors

  init(_ sys: Survivors) { self.sys = sys }

  var SIG: SignalTable { sys.tables.sig }

  /// Per frame for every active group. env: the survivors' frame snapshot; d: horizontal distance to the heli.
  func update(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double, _ d: Double) {
    let rng = sys.rng
    let heli = env.heliAlive
    let unseen = !s.spotted
    let play = env.play
    let SIG = self.SIG

    // --- burning things tick down regardless of who is looking -----------------------------------
    if s.sig.smokeBurn > 0 {
      s.sig.smokeBurn -= dt
      smokeTick(s, env, dt)
    }
    if s.sig.flareBurn > 0 {
      s.sig.flareBurn -= dt
      if s.sig.flareBurn <= 0 { s.sig.flareObj = nil }
    }
    if s.sig.mirrorFlash > 0 { s.sig.mirrorFlash -= dt }
    if s.sig.dyeT >= 0 {
      s.sig.dyeT += dt
      dyeTick(s, env, dt)
    }
    if !play || !heli { return }

    // --- red parachute rockets ---------------------------------------------------------------------
    let heard = env.rotorHeard && d < SIG.hearRotor
    if unseen && s.sig.rockets > 0 && heard && !s.sig.rocketHold {
      if s.sig.rocketT < 0 { s.sig.rocketT = 2 + rng.next() * 3 } // reaction time after the first rotor sound
      s.sig.rocketT -= dt
      if s.sig.rocketT <= 0 { _ = fire(s, "rocket", env) }
    } else if !heard && s.sig.fired == 0 {
      s.sig.rocketT = -1
    }

    // --- orange smoke by day --------------------------------------------------------------------------
    if unseen && s.sig.smoke > 0 && s.sig.smokeBurn <= 0 && env.night < 0.45 && d < SIG.smokeAt { _ = fire(s, "smoke", env) }

    // --- handheld flare at night ------------------------------------------------------------------------
    if unseen && s.sig.flares > 0 && s.sig.flareBurn <= 0 && env.night >= 0.45 && d < SIG.flareAt { _ = fire(s, "flare", env) }

    // --- whistle ------------------------------------------------------------------------------------------
    if unseen && s.sig.whistle && d < SIG.whistleAt && s.health > 0.1 {
      s.sig.whistleT -= dt
      if s.sig.whistleT <= 0 {
        _ = fire(s, "whistle", env)
        s.sig.whistleT = SIG.whistleGap.0 + rng.next() * (SIG.whistleGap.1 - SIG.whistleGap.0)
      }
    }

    // --- EPIRB bearing ping ---------------------------------------------------------------------------------
    if s.sig.epirb && unseen && d < SIG.epirbRange {
      s.sig.epirbT -= dt
      if s.sig.epirbT <= 0 {
        s.sig.epirbT = SIG.epirbGap
        s.sig.epirbError = 30 * SurvivorMath.clamp01(d / 1500) + (rng.next() - 0.5) * 6
        let p = s.position
        // the ping carries a bearing from the heli with an error, not a position
        let a = JS.atan2(p.x - env.hx, -(p.z - env.hz)) + (s.sig.epirbError * JS.PI) / 180
        sys.emitSignal(s, "epirb", env.hx + JS.sin(a) * d, env.hz - JS.cos(a) * d, d * JS.tan((JS.abs(s.sig.epirbError) * JS.PI) / 180),
                       JS.abs(s.sig.epirbError), ping: false)
      }
    }

    // --- dye: released when they hear the rotor -------------------------------------------------------------
    if s.sig.dye && s.sig.dyeT < 0 && env.rotorHeard && d < SIG.dyeHear { _ = fire(s, "dye", env) }

    // --- mirror flashes (sunny presets) ------------------------------------------------------------------------
    if s.sig.mirror && env.sunny && d < SIG.mirrorRange && d > 30 && s.health > 0.15 {
      s.sig.mirrorT -= dt
      if s.sig.mirrorT <= 0 {
        _ = fire(s, "mirror", env)
        s.sig.mirrorT = SIG.mirrorGap.0 + rng.next() * (SIG.mirrorGap.1 - SIG.mirrorGap.0)
      }
    }

    // --- loudspeaker answer -----------------------------------------------------------------------------------
    if s.sig.hornT >= 0 {
      s.sig.hornT -= dt
      if s.sig.hornT < 0 {
        sys.ctx.events.emit(GameEvent.SurvivorShout(s: s.id, reason: "loudspeaker"))
        if s.sig.whistle {
          _ = fire(s, "whistle", env)
        } else {
          sys.emitSignal(s, "whistle", s.position.x, s.position.z, 15, SIG.whistleArc, ping: true, as: "shout")
        }
      }
    }
  }

  /// Fire a signal now (also used by mission scripts via survivors.fireSignal). Returns true if fired.
  /// `env` nil = the web's `env?.hx ?? p.x` (no heli reference: the whistle error is its 4 m floor).
  func fire(_ s: SurvivorGroup, _ kind: String, _ env: SurvivorsEnv?, scripted: Bool = false) -> Bool {
    let rng = sys.rng
    let p = s.position
    let SIG = self.SIG
    switch kind {
    case "rocket":
      if s.sig.rockets <= 0 && !scripted { return false }
      s.sig.rockets = JS.max(0, s.sig.rockets - 1)
      s.sig.fired += 1
      if scripted { s.sig.rocketHold = false }
      // the next one no sooner than 30–45 s, scripted or not
      s.sig.rocketT = SIG.rocketGap.0 + rng.next() * (SIG.rocketGap.1 - SIG.rocketGap.0)
      sys.ctx.fx?.rocketBurst(V3(p.x, (s.deckY ?? p.y) + 1.2, p.z), color: "#FF3A22")
      let e = SIG.rocketError
      let ex = p.x + (rng.next() - 0.5) * 2 * e
      let ez = p.z + (rng.next() - 0.5) * 2 * e
      sys.emitSignal(s, "rocket", ex, ez, e, 0, ping: true)
      return true
    case "smoke":
      if s.sig.smoke <= 0 && !scripted { return false }
      s.sig.smoke = JS.max(0, s.sig.smoke - 1)
      s.sig.smokeBurn = SIG.smokeBurn
      let ex = p.x + (rng.next() - 0.5) * 16
      let ez = p.z + (rng.next() - 0.5) * 16
      sys.emitSignal(s, "smoke", ex, ez, 10, 0, ping: true)
      return true
    case "flare":
      if s.sig.flares <= 0 && !scripted { return false }
      s.sig.flares = JS.max(0, s.sig.flares - 1)
      s.sig.flareBurn = SIG.flareBurn
      s.sig.flareObj = sys.ctx.fx?.flare(p.x, p.z, life: SIG.flareBurn, held: true)
      let ex = p.x + (rng.next() - 0.5) * 20
      let ez = p.z + (rng.next() - 0.5) * 20
      sys.emitSignal(s, "flare", ex, ez, 12, 0, ping: true)
      return true
    case "whistle":
      let d = JS.hypot(p.x - (env?.hx ?? p.x), p.z - (env?.hz ?? p.z))
      let err = JS.max(4, d * JS.tan((SIG.whistleArc * JS.PI) / 180))
      sys.emitSignal(s, "whistle", p.x, p.z, err, SIG.whistleArc, ping: true)
      return true
    case "dye":
      s.sig.dye = true
      s.sig.dyeT = 0
      s.sig.dyeStampT = 0
      sys.emitSignal(s, "dye", p.x, p.z, 25, 0, ping: false)
      return true
    case "mirror":
      s.sig.mirrorFlash = SIG.mirrorFlash
      sys.emitSignal(s, "mirror", p.x, p.z, 8, 0, ping: false)
      return true
    case "strobe":
      s.sig.strobe = true
      return true
    case "epirb":
      s.sig.epirb = true
      s.sig.epirbT = 0
      return true
    default:
      return false
    }
  }

  func smokeTick(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    guard let fx = sys.ctx.fx, dt > 0 else { return }
    let p = s.position
    let y = (s.deckY ?? p.y) + (s.type == "swimmer" || s.type == "injured" ? 0.5 : 1.2)
    // the canister fades in its last seconds
    let k = JS.min(1, s.sig.smokeBurn / 6)
    fx.smoke(p.x, y, p.z, "#FF7B2E", dt * 7 * k)
  }

  /// Fluorescein: a patch growing 10 → 25 m over ~90 s, stretched downwind (ocean water memory, G).
  func dyeTick(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    guard let ocean = sys.ctx.ocean, dt > 0, !(s.sig.dyeT > 240) else { return }
    s.sig.dyeStampT -= dt
    if s.sig.dyeStampT > 0 { return }
    s.sig.dyeStampT = 1.2
    let r = 5 + 7.5 * SurvivorMath.clamp01(s.sig.dyeT / 90) // radius → diameter 10 → 25 m
    let p = s.position
    let k = 0.35 * (1 - SurvivorMath.clamp01((s.sig.dyeT - 180) / 60))
    ocean.seaStamp("dye", p.x, p.z, radius: r * 0.8, strength: k)
    ocean.seaStamp("dye", p.x + env.windDirX * r * 0.7, p.z + env.windDirZ * r * 0.7, radius: r * 0.75, strength: k * 0.8)
    ocean.seaStamp("dye", p.x + env.windDirX * r * 1.5, p.z + env.windDirZ * r * 1.5, radius: r * 0.6, strength: k * 0.55)
  }

  /// Detection helper (DESIGN §3.10): is a burning signal visible from the heli at distance d?
  func seen(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ d: Double) -> String? {
    let SIG = self.SIG
    if s.sig.smokeBurn > 0 && d < SIG.smokeSpot && env.night < 0.6 { return "smoke" }
    if s.sig.flareBurn > 0 && d < SIG.flareSpot { return "flare" }
    if s.sig.dyeT > 4 && env.night < 0.5 && env.alt > SIG.dyeMinAlt && d < SIG.dyeSpot { return "dye" }
    if s.sig.mirrorFlash > 0 && d < SIG.mirrorRange { return "mirror" }
    return nil
  }
}
