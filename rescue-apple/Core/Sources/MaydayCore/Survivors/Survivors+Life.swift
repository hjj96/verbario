// survivors.js: the per-group and per-carrier simulation — drift, warmth, hazards (whirlpools, rogue
// crests, rotor downwash over rafts), the detection ladder, datums, capsizing / abandoning / jumping, and
// the carriers' own life (sea anchor, flutter, sinking hulls, tipping containers, the barge's surf, the
// flooding ferry). Same expressions and the same rng draw order as the web.

extension Survivors {
  // ----------------------------------------------------------------------------------------------
  /// Drift: current + leeway·wind + hazard surface flow + downwash + swim + rogue sweep.
  func motion(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    let c = s.carrier
    if let c, c.kind == .barge || c.kind == .wreck || c.kind == .rig { return } // structures move themselves
    if let c, c.dropped {
      // aboard a dropped raft: ride it
      s.position = V3(c.x, c.y, c.z)
      s.velocity = c.vel ?? V3(0, 0, 0)
      return
    }
    var vx = current.x
    var vz = current.y
    let lee = c?.leeway ?? tables.types[s.type]?.leeway ?? 0.02
    if let w = ctx.weather?.seaWindAt(s.position.x, s.position.z) {
      vx += lee * w.x
      vz += lee * w.y
    } else {
      vx += lee * env.windSpeed * env.windDirX
      vz += lee * env.windSpeed * env.windDirZ
    }
    if let f = ctx.hazards?.surfaceFlowAt(s.position.x, s.position.z), (f.x + f.y).isFinite {
      vx += f.x
      vz += f.y
    }
    let swimmer = c == nil && (s.type == "swimmer" || s.type == "injured")
    // rotor downwash pushes swimmers out of the ring below 12 m: (12 − alt)·0.4 m/s
    s.dwWarn = 0
    if swimmer && env.heliAlive && env.alt < tables.dwPushAlt && env.dwS > 0.02 {
      let dx = s.position.x - env.hx
      let dz = s.position.z - env.hz
      let d = JS.hypot(dx, dz)
      if d < env.dwR {
        let push = (tables.dwPushAlt - env.alt) * 0.4 * (1 - SurvivorMath.smooth(0.85, 1, d / env.dwR))
        let inv = d > 0.2 ? 1 / d : 0
        vx += (d > 0.2 ? dx * inv : env.windDirX) * push
        vz += (d > 0.2 ? dz * inv : env.windDirZ) * push
        s.dwWarn = SurvivorMath.clamp01(push / 2)
        if push > 0.6 && env.play && env.t > s.dwWarnT {
          s.dwWarnT = env.t + 6
          ctx.events.emit(GameEvent.SurvivorDownwash(s: s.id, level: "push"))
        }
      }
    }
    // swim: to the basket within 10 m, else to a dropped raft within 60 m (0.5 m/s)
    s.swimTo = nil
    if swimmer && s.type == "swimmer" && s.health > 0.15 && s.attached == nil && !(s.panic && s.calm <= 0) {
      let p = s.position
      if env.bWet && JS.hypot(env.bx - p.x, env.bz - p.z) < tables.swimToBasket {
        let dx = env.bx - p.x
        let dz = env.bz - p.z
        let d = JS.hypot(dx, dz)
        if d > 0.8 {
          vx += (dx / d) * tables.swimSpeed
          vz += (dz / d) * tables.swimSpeed
          s.swimTo = "basket"
        }
      } else if let raft = nearestDroppedRaft(p.x, p.z, tables.swimToRaft, Double(s.remaining)) {
        let dx = raft.x - p.x
        let dz = raft.z - p.z
        let d = JS.hypot(dx, dz)
        if d < tables.raft.R + 0.8 && raft.inflate > 0.95 {
          boardRaft(s, raft)
        } else if d > 0.5 {
          vx += (dx / d) * tables.swimSpeed
          vz += (dz / d) * tables.swimSpeed
          s.swimTo = "raft"
        }
      }
    }
    // a passing rogue crest carries floating things ~40 m (eased)
    if var sw = s.sweep {
      sw.t += dt
      let k = sw.t / sw.dur
      if k >= 1 {
        s.sweep = nil
      } else {
        let sp = (sw.dist / sw.dur) * 1.5 * JS.sin(JS.PI * k) * 1.05
        vx += sw.dx * sp
        vz += sw.dz * sp
        s.sweep = sw
      }
    }
    if dt > 0 {
      s.position.x += vx * dt
      s.position.z += vz * dt
    }
    s.velocity = V3(vx, 0, vz)
    if let c {
      c.x = s.position.x
      c.z = s.position.z
      s.position.y = c.y
    } else {
      s.position.y = ctx.ocean?.heightAt(s.position.x, s.position.z) ?? 0
    }
  }

  func lostDrift(_ s: SurvivorGroup, _ dt: Double) {
    if s.lostT >= 0 { s.lostT += dt }
    // the marker buoy stays; nothing else to simulate
  }

  func nearestDroppedRaft(_ x: Double, _ z: Double, _ maxD: Double, _ need: Double) -> Carrier? {
    var best: Carrier?
    var bd = maxD
    for c in carriers {
      if !c.dropped || !c.alive || c.capsized || c.dissolve > 0 { continue }
      var used = 0.0
      for r in c.riders { used += Double(r.remaining) }
      if used + need > tables.raftSeats { continue }
      let d = JS.hypot(c.x - x, c.z - z)
      if d < bd {
        bd = d
        best = c
      }
    }
    return best
  }

  func boardRaft(_ s: SurvivorGroup, _ raft: Carrier) {
    s.carrier = raft
    raft.riders.append(s)
    raft.emptyT = 0
    s.position = V3(raft.x, raft.y, raft.z)
    ctx.ocean?.splash(raft.x, raft.z, 1.5, 0.4)
    ctx.events.emit(GameEvent.SurvivorRaftBoarded(s: s.id))
  }

  /// Warmth (DESIGN §3.11): health 1 → 0 over base × mT × night × difficulty seconds.
  func duration(_ s: SurvivorGroup, _ env: SurvivorsEnv) -> Double {
    let raftRider = s.carrier?.kind == .raft && s.type == "swimmer"
    let base = raftRider ? tables.types["raft"]?.warmth ?? 180 : tables.types[s.type]?.warmth ?? 180
    let T = waterTemp
    let mT = SurvivorMath.clamp(0.35 + T / 20, 0.4, 1.6)
    let night = SurvivorMath.lerp(1, 0.9, env.night)
    let dk = ctx.settings.get("difficulty")
    let diff = (dk.isNull ? nil : tables.difficultyWarmth[dk.jsToString]) ?? 1
    return JS.max(10, base * mT * night * diff)
  }

  func warmthTick(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    if s.state == .lost || s.state == .rescued || !(dt > 0) { return }
    s.health = JS.max(0, s.health - dt / duration(s, env))
    s.warmth = s.health
    if !s.critical && s.health <= tables.critical {
      s.critical = true
      ctx.events.emit(GameEvent.SurvivorCritical(s: s.id))
    }
    if s.health <= 0 {
      if s.attached != nil { s.lostPending = true } else { lose(s) } // the one on the cable still makes it
    }
  }

  func lose(_ s: SurvivorGroup) {
    if s.state == .lost { return }
    if s.people.isEmpty && s.remaining <= 0 {
      s.state = .rescued
      return
    }
    s.state = .lost
    s.lostPending = false
    s.lostT = 0
    s.health = 0
    s.warmth = 0
    lostTotal += s.remaining
    if let fo = s.sig.flareObj { fo.t = JS.max(fo.t, fo.life - 2.5) }
    s.sig.flareBurn = JS.min(s.sig.flareBurn, 2.5)
    s.sig.smokeBurn = JS.min(s.sig.smokeBurn, 4)
    dropDatum(s)
    lostMarkers.append(LostMarker(x: s.position.x, z: s.position.z, y: s.position.y, t: ctx.time(), group: s.id, phase: rng.next() * 10))
    if let c = s.carrier, c.kind == .raft {
      // the raft drifts on, closed and dark; nobody in the doorway
      c.lampDead = true
    }
    ctx.events.emit(GameEvent.SurvivorLost(s: s.id))
  }

  /// Hazards per group: whirlpools (panic, core = lost after 5 s), rogue crests (sweep, capsize), rafts
  /// under a low rotor.
  func hazards(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    // --- whirlpools ----------------------------------------------------------------------------------
    s.panic = false
    if let wp = whirlpoolAt(s.position.x, s.position.z), s.type != "deck" && s.type != "wreck" {
      s.panic = s.calm <= 0
      if wp.d < 8 {
        s.coreT += dt
        if s.coreT >= 5 && s.attached == nil {
          s.health = 0
          lose(s)
          return
        }
      } else {
        s.coreT = JS.max(0, s.coreT - dt)
      }
    } else {
      s.coreT = 0
    }
    // --- rogue wave crest passing (DESIGN §3.12: people carried ~40 m, rafts capsize by chance) -------
    if s.rogueCd > 0 { s.rogueCd -= dt }
    let floating = s.type != "deck" && s.type != "wreck"
    if floating && s.rogueCd <= 0, let liftV = ctx.hazards?.seaWaveLiftAt(s.position.x, s.position.z) {
      let lift = JSNumber.or(liftV, 0)
      if lift > 3.5 {
        s.rogueCd = 10
        let dir = rogueDir(s.position.x, s.position.z)
        s.sweep = RogueSweep(dx: dir.x, dz: dir.y, t: 0, dur: tables.rogueSweepT, dist: tables.rogueSweep)
        if let c = s.carrier, c.kind == .raft, !c.capsized, c.owner === s {
          let chance = s.remaining > 4 ? 0.6 : 0.4
          if rng.next() < chance { capsize(s, "rogue") }
        }
      }
    }
    // --- raft under a low rotor: capsizes after 2 s below 8 m within 6 m -------------------------------
    if let c = s.carrier, c.kind == .raft, c.owner === s, !c.capsized, env.heliAlive {
      let d = JS.hypot(c.x - env.hx, c.z - env.hz)
      if env.alt < tables.dwCapsizeAlt && d < tables.dwCapsizeR && env.dwS > 0.3 {
        s.dwT += dt
        s.dwWarn = SurvivorMath.clamp01(s.dwT / tables.dwCapsizeT)
        if s.dwT > 0.5 && env.t > s.dwWarnT {
          s.dwWarnT = env.t + 5
          ctx.events.emit(GameEvent.SurvivorDownwash(s: s.id, level: "capsize"))
        }
        if s.dwT >= tables.dwCapsizeT { capsize(s, "downwash") }
      } else {
        s.dwT = JS.max(0, s.dwT - dt * 0.5)
        s.dwWarn = SurvivorMath.clamp01(s.dwT / tables.dwCapsizeT)
      }
    }
  }

  func whirlpoolAt(_ x: Double, _ z: Double) -> (d: Double, r: Double)? {
    if let hl = ctx.hazards?.seaHazards {
      for h in hl {
        guard h.type == "whirlpool", let p = h.position else { continue }
        let r = JSNumber.or(h.radius, 45)
        let d = JS.hypot(p.x - x, p.z - z)
        if d < r { return (d, r) }
      }
    }
    return ctx.ocean?.featureWhirlpool(x, z)
  }

  func rogueDir(_ x: Double, _ z: Double) -> V2 {
    if let hl = ctx.hazards?.seaHazards {
      for h in hl where h.type == "rogue" {
        if let d = h.dir {
          let l = JS.hypot(d.x, d.y)
          let ll = JSNumber.isTruthy(l) ? l : 1
          return V2(d.x / ll, d.y / ll)
        }
      }
    }
    if let r = ctx.ocean?.featureRogueDir() { return r }
    return V2(env.windDirX, env.windDirZ)
  }

  /// A raft flips: the canopy goes under, the people become a ring of swimmers around it.
  func capsize(_ s: SurvivorGroup, _ cause: String) {
    guard let c = s.carrier, !c.capsized else { return }
    c.capsized = true
    c.owner = nil
    c.flipT = 0
    c.lampDead = true
    s.carrier = nil
    s.type = "swimmer"
    s.flower = s.people.count >= 2
    s.dwT = 0
    // they come up a few metres away (within 6 m)
    let a = rng.next() * JS.PI * 2
    s.position.x = c.x + JS.cos(a) * 3.5
    s.position.z = c.z + JS.sin(a) * 3.5
    ctx.ocean?.splash(c.x, c.z, 4, 1)
    ctx.fx?.splash(c.x, c.y, c.z, 2.5)
    if !s.spotted && s.dHeli < 120 { spot(s, "capsize") }
    ctx.events.emit(GameEvent.SurvivorCapsize(s: s.id, cause: cause))
  }

  /// Everyone left on a sinking hull / ferry goes into the water as one ring of swimmers.
  func abandon(_ s: SurvivorGroup, _ cause: String) {
    guard let c = s.carrier else { return }
    c.owner = nil
    s.carrier = nil
    s.type = "swimmer"
    s.flower = s.people.count >= 2
    s.deckY = nil
    s.height = 0
    s.position.y = 0
    let a = rng.next() * JS.PI * 2
    let off: Double = c.kind == .wreck ? 14 : 4
    s.position.x = c.x + JS.cos(a) * off
    s.position.z = c.z + JS.sin(a) * off
    ctx.ocean?.splash(s.position.x, s.position.z, 3, 0.8)
    ctx.events.emit(GameEvent.SurvivorSinking(s: s.id, phase: "sunk", cause: cause))
  }

  /// One person leaves a group as a separate swimmer (wreck jumpers, container tip, slip from height). If
  /// they were the last one, the group itself becomes that swimmer.
  @discardableResult
  func splitPerson(_ s: SurvivorGroup, _ person: SurvivorPerson, _ x: Double, _ z: Double, _ cause: String) -> SurvivorGroup {
    if s.people.isEmpty && s.attached == nil && s.remaining <= 1 {
      // the last one: convert in place
      s.carrier?.owner = nil
      s.carrier = nil
      s.type = "swimmer"
      s.flower = false
      s.deckY = nil
      s.height = 0
      s.people.append(person)
      s.position = V3(x, 0, z)
      s.sig.whistle = true
      ctx.events.emit(GameEvent.SurvivorJump(s: s.id, from: cause))
      return s
    }
    s.remaining = max(0, s.remaining - 1)
    var sigs = JSONObject()
    sigs.set("whistle", .bool(true))
    let st = s.def["signals"]["strobe"]
    if !st.isNull { sigs.set("strobe", st) }
    let entry = s.def.with([("type", .string("swimmer")), ("x", .number(x)), ("z", .number(z)), ("count", .number(1)), ("at", .number(0)),
                            ("hidden", .bool(false)), ("people", .array([person.rec?.json ?? .null])), ("signals", .object(sigs)),
                            ("datum", .null)])
    let g = spawn(entry)
    g.tag = s.tag
    g.def = s.def
    g.health = s.health
    g.spotted = s.spotted || s.dHeli < 150
    g.state = g.spotted ? .spotted : .hidden
    g.spawnT = elapsed
    if g.people.isEmpty { g.people.append(person) } else { g.people[0] = person }
    g.parent = s
    g.label = s.label
    if !g.spotted {
      if let d0 = s.datum {
        let d = SurvivorDatum(x: d0.x, z: d0.z, radius: d0.radius, ids: [g.id], tag: d0.tag, label: d0.label, group: g)
        g.datum = d
        datums.append(d)
      } else {
        g.datum = nil
      }
    }
    ctx.ocean?.splash(x, z, 1.4, 0.6)
    ctx.fx?.splash(x, 0, z, 1.2)
    ctx.events.emit(GameEvent.SurvivorJump(s: g.id, from: cause, parent: s.id))
    if s.remaining <= 0 && s.people.isEmpty && s.attached == nil {
      s.state = .rescued // nobody left on it (they are all in other groups now)
      s.empty = true
      releaseCarrier(s)
    }
    return g
  }

  /// Detection ladder (DESIGN §3.10).
  func detect(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    if s.spotted || !env.heliAlive { return }
    let p = s.position
    let d = s.dHeli
    // crew eyes: detectR = base·(0.85 + 0.003·alt·altBonus), × type size; strobes ×3 at night
    let size = tables.types[s.type]?.size ?? 1
    let R = env.base * (0.85 + 0.003 * JS.max(0, env.alt) * env.altBonus) * size
    if !env.fogBlind && d < R { return spot(s, "crew") }
    // FLIR at night / in fog: ×1.6 and sees through the murk (heat.js thermalBoost)
    if env.thermal > 1 && d < R * env.thermal { return spot(s, "thermal") }
    let lit = s.strobe || (s.carrier?.kind == .raft && !(s.carrier?.lampDead ?? false))
    if lit && env.night > 0.45 && d < R * (s.strobe ? tables.strobeMult : 2) { return spot(s, s.strobe ? "strobe" : "lamp") }
    // burning / flashing signals
    if let by = desk.seen(s, env, d) { return spot(s, by) }
    // searchlight: 0.4 s in the pool, slant range ≤ 250 m
    if let o = ctx.ocean {
      let y = s.deckY ?? p.y
      let slant = JS.hypot(d, env.hy - y)
      let k = slant < tables.beamRange ? o.searchlightAt(p.x, p.z, y) : 0
      if k > 0.3 {
        s.beamT += dt
        if s.beamT >= tables.beamSpotTime { return spot(s, "searchlight") }
      } else {
        s.beamT = JS.max(0, s.beamT - dt * 0.5)
      }
    }
    // player flares light 45 m around them for 40 s
    for f in playerFlares where JS.hypot(f.x - p.x, f.z - p.z) < tables.flareSpotR { return spot(s, "flare") }
  }

  /// Close-range reactions: «Сюда! Мы здесь!» once within 60 m.
  func near(_ s: SurvivorGroup) {
    if !s.shoutNear && s.dHeli < tables.nearWave && s.health > 0.2 {
      s.shoutNear = true
      ctx.events.emit(GameEvent.SurvivorShout(s: s.id, reason: "near"))
    }
  }

  /// Datums drift with the water and grow 0.5 m/s (DESIGN §3.10 SHOULD).
  func datumsTick(_ env: SurvivorsEnv, _ dt: Double) {
    if !(dt > 0) || !env.play { return }
    for d in datums {
      let lee = d.group.flatMap { tables.types[$0.type]?.leeway } ?? 0.02
      d.x += (current.x + lee * env.windSpeed * env.windDirX) * dt
      d.z += (current.y + lee * env.windSpeed * env.windDirZ) * dt
      d.radius += 0.5 * dt
    }
  }

  func dropDatum(_ s: SurvivorGroup) {
    guard let d = s.datum else { return }
    if let i = datums.firstIndex(where: { $0 === d }) { datums.remove(at: i) }
    s.datum = nil
  }

  // ==============================================================================================
  // People: which gesture now (DESIGN §2.10 «Движение»).
  func poseFor(_ s: SurvivorGroup, _ p: SurvivorPerson, _ env: SurvivorsEnv, onCarrier: Bool) -> SurvivorPose {
    if s.state == .lost { return .frozen }
    let w = s.health
    let d = s.dHeli
    if s.type == "injured" { return w < 0.15 ? .still : d < tables.seenRange ? .limp : .still }
    if w < 0.15 { return .still }
    if s.panic && s.calm <= 0 { return .panic }
    if s.sig.flareBurn > 0 && p === flareHolder(s) { return .flare }
    if s.sig.mirror && env.sunny && d < tables.sig.mirrorRange && d > tables.nearWave && p === flareHolder(s) { return .mirror }
    let kind = s.carrier?.kind
    if kind == .raft && env.bWet && JS.hypot(env.bx - s.position.x, env.bz - s.position.z) < 15 { return .raise }
    // in a raft only the one in the doorway waves; the others sit up and watch
    if kind == .raft && p !== s.people.first { return .sit }
    // forearm over the face in strong downwash
    if env.dwS > 0.35 && JS.hypot(p.x - env.hx, p.z - env.hz) < env.dwR * 0.85 && env.alt < 20 && w >= 0.4 { return .shield }
    let excited = s.excite > 0
    let keel = kind == .hull && s.carrier?.style != "plane"
    if w < 0.4 { return d < tables.seenRange || excited ? .limp : onCarrier ? (keel ? .keel : .deck) : .idle }
    // a group on a deck reacts unevenly: most wave, the one holding up a neighbour or sitting exhausted
    // keeps still, a few wave with both arms early
    let crew = onCarrier && !keel && kind != .raft ? SurvivorPoses.variant(p.phase, 5) : 0
    if d < tables.nearWave || excited { return crew == 3 ? .wave1 : .wave2 }
    if d < tables.seenRange { return crew == 3 || (crew == 2 && p.legFold > 0.5) ? .deck : crew == 4 ? .wave2 : .wave1 }
    if s.flower { return .hold }
    if kind == .raft { return .sit }
    if keel { return .keel }
    if kind == .hull || kind == .container || kind == .barge || kind == .wreck || kind == .rig { return .deck }
    return .idle
  }

  /// Pets (NICE, DESIGN §4 #27): the dog barks in time with the basket's approach (faster as it nears).
  func petLife(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    guard var pet = s.pet else { return }
    defer { s.pet = pet }
    if pet.hopT > 0 { pet.hopT = JS.max(0, pet.hopT - dt) }
    if pet.kind != "dog" || !env.play || s.remaining <= 0 || s.state == .lost { return }
    let lowering = env.wState == "lowering" || env.wState == "down"
    let d = JS.hypot(env.bx - s.position.x, env.bz - s.position.z)
    if !lowering || d > 25 {
      pet.barkT = 0
      return
    }
    pet.barkT -= dt
    if pet.barkT <= 0 {
      pet.barkT = 0.45 + 0.08 * d
      pet.hopT = JS.max(pet.hopT, 0.18)
      s.pet = pet
      ctx.events.emit(GameEvent.SurvivorPet(s: s.id, pet: "dog", action: "bark", distance: d))
    }
  }

  // ==============================================================================================
  // Carriers
  func makeCarrier(_ s: SurvivorGroup, _ e: SurvivorEntry) {
    let t = s.type
    let x = s.position.x
    let z = s.position.z
    let rng = self.rng
    var c: Carrier?
    switch t {
    case "raft":
      let cr = newCarrier(.raft, x, z, Carrier.Options(phase: rng.next() * 100))
      cr.yaw = rng.next() * JS.PI * 2
      c = cr
    case "hull":
      let label = e.label ?? ""
      let style = e["style"].string.flatMap { $0.isEmpty ? nil : $0 } ?? (theme == "regatta" || label.lowercased().contains("яхт") ? "yacht" : "boat")
      let sinkV = e["sinkTime"]
      let ch = newCarrier(.hull, x, z, Carrier.Options(style: style, phase: rng.next() * 100,
                                                        sinkAt: sinkV.isNull ? tables.types["hull"]?.sink : sinkV.jsToNumber))
      ch.yaw = JS.atan2(env.windDirX, env.windDirZ) + JS.PI / 2 + (rng.next() - 0.5) * 0.6
      scatterDebris(ch, rng)
      if let name = e.name, !name.isEmpty { hullDecal(ch, name) }
      c = ch
    case "plane":
      // the Ан-2 floats like a capsized hull (sinks on the same clock), nose down, lower wing awash
      let sinkV = e["sinkTime"]
      let cp = newCarrier(.hull, x, z, Carrier.Options(style: "plane", phase: rng.next() * 100,
                                                        sinkAt: sinkV.isNull ? tables.types["plane"]?.sink : sinkV.jsToNumber,
                                                        leeway: tables.types["plane"]?.leeway))
      cp.yaw = JS.atan2(env.windDirX, env.windDirZ) + (rng.next() - 0.5) * 0.8
      cp.pitch = -0.1
      cp.roll = (rng.next() - 0.5) * 0.08
      scatterDebris(cp, rng)
      planeDecal(cp, e["reg"].jsTruthy ? e["reg"].jsToString : "RA-40217")
      c = cp
    case "container":
      let hex: String
      if e["color"].jsTruthy {
        hex = e["color"].jsToString
      } else {
        hex = tables.containerColors[Int(JS.floor(rng.next() * Double(tables.containerColors.count)))]
      }
      let col = containerPaint(hex)
      let cc = newCarrier(.container, x, z, Carrier.Options(phase: rng.next() * 100, color: col))
      cc.yaw = rng.next() * JS.PI * 2
      // awash and listing 5–10° on her flooded end/side
      cc.roll = (rng.next() < 0.5 ? -1 : 1) * (0.09 + rng.next() * 0.08)
      cc.pitch = (rng.next() - 0.5) * 0.1
      c = cc
    case "deck", "wreck":
      let deckY = e["height"].double.flatMap { $0.isFinite ? $0 : nil } ?? 6
      let yaw = -(e["heading"].double ?? 0)
      if t == "deck", worldDeckNear(x, z, deckY) {
        let cr = newCarrier(.rig, x, z, Carrier.Options(deckY: deckY, stand: [0, deckY, 0], fixed: true))
        cr.baseY = 0
        c = cr
      } else {
        let kind: CarrierKind = t == "wreck" ? .wreck : .barge
        // «Вайгач» is a trawler, «Северянка» a ferry: pick the wreck model from the def
        let words = "\(e.name ?? "") \(e.label ?? "") \(e["model"].string ?? "")".lowercased()
        let trawler = theme == "trawler" || words.contains("траул") || words.contains("trawl") || words.contains("вайгач")
        let spec = bigBatch(kind == .barge ? "barge" : trawler ? "trawler" : "ferry", deckY)
        let stand = spec.stand
        // place the hull so that its gathering point is where the def says the people are
        let cs = JS.cos(yaw)
        let sn = JS.sin(yaw)
        let cx = x - (stand[0] * cs + stand[2] * sn)
        let cz = z - (-stand[0] * sn + stand[2] * cs)
        let fv = e["sinkTime"]
        let cw = newCarrier(kind, cx, cz, Carrier.Options(yaw: yaw, deckY: deckY, stand: stand,
                                                           floodTime: fv.isNull ? tables.types["wreck"]?.flood : fv.jsToNumber,
                                                           leeway: kind == .wreck ? tables.types["wreck"]?.leeway : 0, fixed: kind == .barge))
        cw.big = spec
        if kind == .barge { cw.roll = 0.13 } // aground: a fixed ~7.5° heel
        if kind == .wreck { wreckDecal(cw, e.name.flatMap { $0.isEmpty ? nil : $0 } ?? "Северянка") }
        c = cw
      }
      s.deckY = deckY
    default:
      break
    }
    guard let c else { return }
    c.owner = s
    s.carrier = c
    carriers.append(c)
    // settle the pose right away (no pop on the first frame)
    if let ocean = ctx.ocean {
      c.nrm.set(0, 1, 0)
      c.pose(ocean, 0)
    }
    if t == "deck" || t == "wreck" { structureAnchor(s) }
  }

  /// The rig's lower deck (world) when the def puts deck survivors on it.
  func worldDeckNear(_ x: Double, _ z: Double, _ y: Double) -> Bool {
    for ld in ctx.world?.lowerDecks ?? [] where JS.hypot(ld.x - x, ld.z - z) < 40 && JS.abs((ld.y ?? y) - y) < 4 { return true }
    return false
  }

  /// _bigBatch(model, deckY): the batch (and its userData) of a big hull model; three.js builds it once
  /// per key — the Math.random its object uuids take is spent the first time only.
  func bigBatch(_ model: String, _ deckY: Double) -> BigCraftSpec {
    let spec = BigCraftSpec.make(model, deckY: deckY)
    if !bigBatchKeys.contains(spec.key) {
      bigBatchKeys.insert(spec.key)
      spendRandom(threeCosts.bigBatch[model] ?? 0)
      render.ensureBig(spec)
    }
    return spec
  }

  /// containerPaint(hex): the faded container colours (CONT_FADE), else a desaturated, darker paint.
  func containerPaint(_ hex: String) -> String {
    let k = hex.lowercased()
    if let f = tables.contFade[k] { return f }
    var c = Color3(style: hex.isEmpty ? "#9E4636" : hex)
    let l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15
    c.lerp(Color3(l, l, l), 0.3)
    c.multiplyScalar(0.92)
    return "#" + c.getHexString()
  }

  /// «МАРИЯ» on the capsized hull's bottom flanks (the decal is the renderer's: text + style).
  func hullDecal(_ c: Carrier, _ name: String) {
    spendRandom(threeCosts.hullDecal)
    let key = c.style == "yacht" ? "yacht" : "boat"
    if !hullNameBuilt.contains(key) {
      hullNameBuilt.insert(key)
      spendRandom(threeCosts.hullNameGeometry)
    }
    c.decalText = name
  }

  /// Registration across the Ан-2's left upper wing.
  func planeDecal(_ c: Carrier, _ text: String) {
    spendRandom(threeCosts.planeDecal)
    c.decalText = text
  }

  /// The ferry's name on both bow flanks.
  func wreckDecal(_ c: Carrier, _ name: String) {
    spendRandom(threeCosts.wreckDecal)
    c.decalText = name
  }

  /// Deck / wreck: the people stand at the carrier's gathering point (moves as the ferry heels).
  func structureAnchor(_ s: SurvivorGroup) {
    guard let c = s.carrier else { return }
    let st = c.stand ?? [0, c.deckY, 0]
    let v = c.toWorld(st[0], st[1], st[2])
    s.position = v
    s.deckY = v.y
    s.height = v.y
    s.velocity = V3(c.vel?.x ?? 0, 0, c.vel?.z ?? 0)
  }

  /// The group is gone from this carrier (rescued / converted): it drifts on and fades away later.
  func releaseCarrier(_ s: SurvivorGroup) {
    guard let c = s.carrier else { return }
    if c.owner === s { c.owner = nil }
    if let i = c.riders.firstIndex(where: { $0 === s }) { c.riders.remove(at: i) }
    if c.kind == .raft && !c.dropped { c.lampDead = false }
    s.carrier = nil
  }

  /// Per-frame carrier life: drift (orphans), pose on the waves, drama (sinking, flooding, tipping).
  func carrierTick(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    guard let ocean = ctx.ocean else { return }
    if env.play { c.age += dt }
    if c.vel == nil { c.vel = V3() }
    // drift for carriers nobody steers (dropped rafts, emptied craft) and slow structures
    let free = c.owner == nil || c.kind == .wreck
    if free && !c.fixed && dt > 0 {
      var vx = current.x
      var vz = current.y
      if let w = ctx.weather?.seaWindAt(c.x, c.z) {
        vx += c.leeway * w.x
        vz += c.leeway * w.y
      }
      if c.kind != .wreck, let f = ctx.hazards?.surfaceFlowAt(c.x, c.z), (f.x + f.y).isFinite {
        vx += f.x
        vz += f.y
      }
      c.x += vx * dt
      c.z += vz * dt
      c.vel = V3(vx, 0, vz)
    } else if let o = c.owner {
      c.vel = o.velocity
    }

    // --- per kind ----------------------------------------------------------------------------------
    switch c.kind {
    case .raft:
      if c.dropped && c.inflate < 1 { c.inflate = JS.min(1, c.inflate + dt / 1.8) }
      if c.capsized {
        c.flipT = (c.flipT ?? 0) + dt
        c.flip = SurvivorMath.smooth(0, 1.2, c.flipT ?? 0)
      }
      c.raftYaw(env, dt)
      // canopy flutter: downwash (strong near the rotor axis) + a little wind
      var fl = 0.04 * SurvivorMath.smooth(6, 20, env.windSpeed)
      if env.heliAlive && env.dwS > 0.01 {
        let d = JS.hypot(c.x - env.hx, c.z - env.hz)
        if d < env.dwR * 1.2 { fl += env.dwS * (1 - SurvivorMath.smooth(0.2, 1.2, d / env.dwR)) * 1.6 }
      }
      c.flutter = SurvivorMath.approach(c.flutter, JS.min(1.8, fl), 6, dt)
    case .hull:
      hullLife(c, env, dt)
    case .container:
      containerLife(c, env, dt)
      c.yaw += dt * 0.015 * JS.sin(c.phase)
    case .wreck:
      wreckLife(c, env, dt)
    case .barge:
      bargeLife(c, env, dt)
    case .rig:
      break
    }
    c.pose(ocean, dt)
    c.tapeLit = ocean.searchlightAt(c.x, c.z, c.y + 1.2)
    // retro tape FLASHES the instant the beam touches (DESIGN §2.10), then glints again every 1.4–3.4 s
    // while the swell rocks the craft in the beam (craft.js: tape only; the canopy lift stays ≤ 1)
    c.tapeFlash *= JS.exp(-dt / 0.3)
    c.tapeGlintT -= dt
    if c.tapeLit < 0.15 {
      c.tapeGlintT = 0
    } else if c.tapeLit > 0.5 && c.tapeGlintT <= 0 {
      c.tapeFlash = 1
      c.tapeGlintT = 1.4 + 2 * JS.abs(JS.sin(c.phase * 7.3 + env.t * 1.7)) // no rng draw: spawns stay seeded
    }
    // leftovers (empty rafts, capsized rafts, abandoned containers) fade out after a while
    let occupied = c.owner != nil || !c.riders.isEmpty
    if !occupied && c.kind != .wreck && c.kind != .barge && c.kind != .rig {
      c.emptyT += dt
      if c.emptyT > (c.dropped ? 240 : 60) { c.dissolve = JS.min(1, c.dissolve + dt / 4) }
      if c.dissolve >= 1 { c.alive = false }
    } else {
      c.emptyT = 0
    }
  }

  /// Capsized hull: sinks after 200 s (telegraph from 30 s before: draft rises, bubbles, creaks).
  func hullLife(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    let left = c.sinkAt - c.age
    // a thin oil sheen leaking from her (water memory A, 600 s half-life — faint and few)
    if env.play && dt > 0 && c.oilN < 40 {
      c.oilT -= dt
      if c.oilT <= 0 && c.sinking < 1 {
        c.oilT = 5 + 2 * rng.next()
        c.oilN += 1
        let r = rng.next() * 5
        let sx = c.x - env.windDirX * r + (rng.next() - 0.5) * 4
        let sz = c.z - env.windDirZ * r + (rng.next() - 0.5) * 4
        let rad = 3.5 + 3 * rng.next()
        ctx.ocean?.seaStamp("oil", sx, sz, radius: rad, strength: 0.07)
      }
    }
    if left < 30 && c.sinking < 1 {
      let k = SurvivorMath.clamp01(1 - left / 30)
      c.sink = 0.55 * k * k
      if !c.warned, let o = c.owner {
        c.warned = true
        ctx.events.emit(GameEvent.SurvivorSinking(s: o.id, phase: "warn"))
      }
      if env.play && dt > 0 {
        c.bubbleT -= dt
        if c.bubbleT <= 0 {
          c.bubbleT = 0.25 + 0.4 * (1 - k)
          let a = rng.next() * JS.PI * 2
          let bx = c.x + JS.cos(a) * 2.5
          let bz = c.z + JS.sin(a) * 2.5
          ctx.ocean?.seaStamp("foam", bx, bz, radius: 1.2 + 1.5 * k, strength: 0.6)
          if rng.next() < 0.35 { ctx.fx?.splash(bx, 0, bz, 0.4 + 0.5 * k) }
        }
        c.creakT -= dt
        if c.creakT <= 0, let o = c.owner {
          c.creakT = 3 + rng.next() * 3
          ctx.events.emit(GameEvent.SurvivorCreak(s: o.id, x: c.x, z: c.z))
        }
      }
    }
    if left <= 0 {
      if let o = c.owner { abandon(o, "sunk") }
      c.sinking = JS.min(1, c.sinking + dt / 8)
      c.sink = 0.55 + 3.2 * c.sinking * c.sinking
      c.roll = 0.25 * c.sinking
      if c.sinking > 0.4 { c.dissolve = JS.min(1, (c.sinking - 0.4) / 0.6) }
      if c.sinking >= 1 { c.alive = false }
    }
    // debris drifts with the hull and spreads slowly
    for i in c.debris.indices {
      if dt > 0 {
        c.debris[i].dx *= 1 + 0.004 * dt
        c.debris[i].dz *= 1 + 0.004 * dt
        c.debris[i].yaw += c.debris[i].spin * dt
      }
      c.debris[i].x = c.x + c.debris[i].dx
      c.debris[i].z = c.z + c.debris[i].dz
    }
  }

  /// Container: in a big sea (Hs ≥ 4 m) it heels every ~40 s and somebody goes into the water.
  func containerLife(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    if c.tip > 0 || c.tipPhase > 0 {
      c.tipPhase += dt
      let t = c.tipPhase
      c.tip = t < 1.2 ? SurvivorMath.smooth(0, 1.2, t) : 1 - SurvivorMath.smooth(1.2, 4.2, t)
      if t > 1.0 && !c.tipDone {
        c.tipDone = true
        if let s = c.owner, !s.people.isEmpty {
          let p = s.people.removeLast()
          let side = c.tipDir
          let cs = JS.cos(c.yaw)
          let sn = JS.sin(c.yaw)
          ctx.events.emit(GameEvent.SurvivorTip(s: s.id))
          // +roll lifts the +X side: people slide off the other side
          splitPerson(s, p, c.x - cs * side * 3.4, c.z + sn * side * 3.4, "tip")
        }
      }
      if t > 4.2 {
        c.tipPhase = 0
        c.tip = 0
      }
      c.roll = (c.baseRoll ?? .nan) + c.tipDir * 0.42 * c.tip
      return
    }
    if c.baseRoll == nil { c.baseRoll = c.roll }
    if env.play && env.Hs >= 4, let o = c.owner, !o.people.isEmpty {
      c.tipT += dt
      if c.tipT >= (tables.types["container"]?.tipEvery ?? .nan) {
        c.tipT = 0
        c.tipPhase = 1e-4
        c.tipDone = false
        c.tipDir = rng.next() < 0.5 ? -1 : 1
      }
    }
  }

  /// Barge aground: surf breaks along her low (−X) side and around the raked ends.
  func bargeLife(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    if !env.play || !(dt > 0) { return }
    c.washT = (c.washT ?? 0) - dt
    if (c.washT ?? 0) > 0 { return }
    let L = c.big?.L ?? 34
    let B = c.big?.B ?? 10
    c.washT = (0.9 + 0.9 * rng.next()) / (0.6 + 0.25 * JS.min(4, env.Hs))
    let end = rng.next() < 0.25
    let lz = end ? (rng.next() < 0.5 ? -1 : 1) * L * 0.5 : (rng.next() - 0.5) * L * 0.9
    let lx = end ? (rng.next() - 0.5) * B : -B * 0.5 - 0.3
    let v = c.toWorld(lx, 0, lz)
    let rad = 1.2 + 1.4 * rng.next()
    ctx.ocean?.seaStamp("foam", v.x, v.z, radius: rad, strength: 0.18 + 0.06 * JS.min(4, env.Hs))
    if rng.next() < 0.18 + 0.1 * JS.min(4, env.Hs) { ctx.fx?.splash(v.x, 0, v.z, 0.5 + 0.25 * JS.min(4, env.Hs)) }
  }

  /// Sinking ferry: heel grows, bow goes down, lights flicker and die; jumpers from 70 %, then she goes.
  func wreckLife(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    c.flood = SurvivorMath.clamp01(c.age / JS.max(30, c.floodTime))
    let f = c.flood
    // a visible list from the first look (≥ 8°), growing to ~30° before she goes
    c.roll = -(0.15 + 0.36 * JS.pow(f, 1.3)) - 0.3 * c.sinking
    c.pitch = -(0.04 + 0.12 * f) - 0.5 * c.sinking * c.sinking
    c.sink = 0.6 + 2.2 * f + 22 * c.sinking * c.sinking
    // lights: cabins glow at night / under heavy overcast only; they flicker more as she floods, gone by 88 %
    let flick: Double = f > 0.35 ? (JS.sin(env.t * 31 + c.phase) * JS.sin(env.t * 7.3) > 0.55 - 0.9 * (f - 0.35) ? 0.15 : 1) : 1
    let dim = JS.max(env.night, env.sunny ? 0 : 0.3)
    c.lights = (1 - SurvivorMath.smooth(0.78, 0.88, f)) * flick * dim
    // the low (starboard, +X) side: sea washing over the deck edge, foam along the waterline, and her oil
    // sheen trailing downwind (stamps fade over minutes; keep them few)
    if env.play && dt > 0 && c.sinking < 1 {
      c.washT = (c.washT ?? 0) - dt
      if (c.washT ?? 0) <= 0 {
        let L = JSNumber.or(c.big?.L, 50)
        c.washT = 1.1 + 0.9 * rng.next()
        let lz = (rng.next() - 0.5) * L * 0.8
        let bx = c.big.map { $0.B * 0.5 }
        let v = c.toWorld(JSNumber.or(bx, 5), 0, lz)
        let rad = 1.4 + 1.6 * rng.next()
        ctx.ocean?.seaStamp("foam", v.x, v.z, radius: rad, strength: 0.2 + 0.25 * f)
        // once the deck edge is near the water, green water pours across it
        let e = c.toWorld(5.5, c.deckY, lz)
        if e.y < 1.6 && rng.next() < 0.5 { ctx.fx?.splash(e.x, JS.max(0, e.y), e.z, 0.5 + 0.6 * f) }
      }
      c.oilT -= dt
      if c.oilT <= 0 && c.oilN < 36 {
        c.oilT = 6 + 3 * rng.next()
        c.oilN += 1
        let r = 8 + rng.next() * 22
        let sx = c.x + env.windDirX * r + (rng.next() - 0.5) * 8
        let sz = c.z + env.windDirZ * r + (rng.next() - 0.5) * 8
        let rad = 6 + 6 * rng.next()
        ctx.ocean?.seaStamp("oil", sx, sz, radius: rad, strength: 0.06)
      }
    }
    let s = c.owner
    if let s, env.play && f >= 0.7 && !s.people.isEmpty && !JSNumber.isTruthy(c.sinking) {
      s.jumpT -= dt
      if s.jumpT <= 0 {
        s.jumpT = 5
        let p = s.people.removeLast()
        // jumps off the low side, a little aft of the gathering point
        let st = c.stand ?? [0, c.deckY, 0]
        let v = c.toWorld(st[0] + 8, 0, st[2] + 2)
        let jx = v.x + (rng.next() - 0.5) * 3
        let jz = v.z + (rng.next() - 0.5) * 3
        splitPerson(s, p, jx, jz, "jump")
      }
    }
    if f >= 1 {
      if let s, s.carrier === c { abandon(s, "sunk") }
      c.sinking = JS.min(1, c.sinking + dt / 14)
      if env.play && dt > 0 && rng.next() < dt * 6 {
        let a = rng.next() * JS.PI * 2
        ctx.ocean?.seaStamp("foam", c.x + JS.cos(a) * 12, c.z + JS.sin(a) * 12, radius: 4, strength: 0.8)
      }
      if c.sinking > 0.55 { c.dissolve = JS.min(1, (c.sinking - 0.55) / 0.45) }
      if c.sinking >= 1 { c.alive = false }
    }
  }
}
