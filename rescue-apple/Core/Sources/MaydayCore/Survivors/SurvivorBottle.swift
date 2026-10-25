// survivors/bottle.js — bottle with a note (DESIGN §4 #46, op 9★ «Лунная дорожка» props.bottle; very rarely
// in other ops). A small green glass bottle, corked and wax-sealed, bobbing half-awash and drifting with
// the current. Pick-up: lower the basket onto it (~0.6 s in the basket's wash, like a survivor capture) or
// hover ≤ 6 m right over it (the crew fishes it out with the boat hook). Emits `survivor:bottle {title,
// text, x, z, by}` (the HUD shows the paper card) and books a small style bonus through the mission scorer
// (`score:add` when there is none). The mesh is the renderer's (baked); here: its transform, collar and glint.

public final class SurvivorBottle {
  unowned let sv: Survivors
  public internal(set) var active = false
  public internal(set) var taken = false
  public internal(set) var x: Double = 0
  public internal(set) var z: Double = 0
  public internal(set) var y: Double = 0
  public internal(set) var yaw: Double = 0
  public internal(set) var phase: Double = 0
  public internal(set) var capT: Double = 0
  public internal(set) var nrm = V3(0, 1, 0)
  /// the pick-up animation {t, from, to}
  struct Lift {
    var t: Double
    var x: Double, y: Double, z: Double
    var tx: Double, ty: Double, tz: Double
  }
  var lift: Lift?
  /// bottle.js module `noteCursor` (replays in one session read the next note)
  var noteCursor = -1
  /// ?bottle (force one into every mission)
  public var force = false

  init(_ sv: Survivors) { self.sv = sv }

  var tables: SurvivorTables { sv.tables }

  public func clear() {
    active = false
    taken = false
    lift = nil
    capT = 0
    sv.render.bottleVisible = false
  }

  /// def.world.props.bottle places it (op 9★); otherwise a small chance near a survivor group.
  func setup(_ def: JSONValue) {
    clear()
    if def.isNull { return }
    let seed = Double(JSNumber.toUint32(def["seed"].isNull ? 1 : def["seed"].jsToNumber))
    var rng = Mulberry32(seed: Double(JSNumber.toUint32(seed * 97 + 13)))
    let p = def["world"]["props"]["bottle"]
    var pos: (x: Double, z: Double)?
    if let px = p["x"].double, let pz = p["z"].double, px.isFinite, pz.isFinite, p.jsTruthy { pos = (px, pz) }
    if pos == nil && (force || sv.ctx.random() < tables.bottleRareChance) { pos = scatter(def, &rng) }
    guard let pos else { return }
    active = true
    x = pos.x
    z = pos.z
    yaw = rng.range(0, JS.PI * 2)
    phase = rng.range(0, 100)
    y = sv.ctx.ocean?.heightAt(x, z) ?? 0
    nrm.set(0, 1, 0)
    if noteCursor < 0 { noteCursor = Int(JS.floor(rng.next() * Double(tables.bottleNotes.count))) }
    sv.render.bottleVisible = true
  }

  /// 40–90 m off a survivor group (they are in open water), clear of pads and obstacles.
  func scatter(_ def: JSONValue, _ rng: inout Mulberry32) -> (x: Double, z: Double)? {
    let groups = (def["survivors"].array ?? []).compactMap { e -> (x: Double, z: Double)? in
      guard e.jsTruthy, let x = e["x"].double, let z = e["z"].double, x.isFinite, z.isFinite else { return nil }
      return (x, z)
    }
    if groups.isEmpty { return nil }
    let blocked = sv.ctx.world?.blockers ?? []
    for _ in 0..<8 {
      let g = groups[Int(JS.floor(rng.next() * Double(groups.count)))]
      let a = rng.range(0, JS.PI * 2)
      let r = rng.range(40, 90)
      let bx = g.x + JS.cos(a) * r
      let bz = g.z + JS.sin(a) * r
      let clear = blocked.allSatisfy { o in
        guard let ox = o.x, ox.isFinite else { return true }
        return JS.hypot(ox - bx, (o.z ?? .nan) - bz) > JSNumber.or(o.radius, 20) + 12
      }
      if clear { return (bx, bz) }
    }
    return nil
  }

  /// Simulation + drawing; called inside the survivors' draw (collars / glows are open).
  func frame(_ env: SurvivorsEnv, _ dt: Double) {
    if !active { return }
    let ocean = sv.ctx.ocean
    let t = env.t
    if lift != nil { return liftTick(env, dt) }
    // drift: surface current + a little windage (it rides low)
    if env.play && dt > 0 {
      x += (sv.current.x + 0.02 * env.windSpeed * env.windDirX) * dt
      z += (sv.current.y + 0.02 * env.windSpeed * env.windDirZ) * dt
      yaw += dt * 0.08 * JS.sin(t * 0.21 + phase)
    }
    y = ocean?.heightAt(x, z) ?? 0
    if let ocean {
      let n = ocean.seaNormalAt(x, z)
      nrm.lerp(n, dt > 0 ? 1 - JS.exp(-dt / 0.25) : 1)
      nrm.normalize()
    }
    // half-awash, neck up a little, rolling and pitching with the chop
    var q = Quat()
    q.setFromUnitVectors(V3(0, 1, 0), nrm)
    var q2 = Quat()
    q2.setFromAxisAngle(V3(0, 1, 0), yaw)
    q.multiply(q2)
    q2.setFromAxisAngle(V3(0, 0, 1), 0.13 + 0.07 * JS.sin(t * 1.7 + phase))
    q.multiply(q2)
    q2.setFromAxisAngle(V3(1, 0, 0), 0.25 * JS.sin(t * 1.1 + phase * 1.3))
    q.multiply(q2)
    let bob = 0.012 * JS.sin(t * 2.3 + phase)
    place(x, y - 0.025 + bob, z, q, tables.bottleScale)
    // thin wet collar along the glass (collar elongates along its Z; the bottle lies along X)
    sv.render.collars.push(x, y, z, nrm.x, nrm.y, nrm.z, 0.11, 0.3, 0.5, 0, phase, yaw + JS.PI / 2, 2.2)
    glint(env)
    if env.play && env.rotorHeard { pickup(env, dt) } // flying (not sitting on a pad)
  }

  func place(_ px: Double, _ py: Double, _ pz: Double, _ q: Quat, _ scale: Double) {
    var m = Mat4()
    m.compose(V3(px, py, pz), q, V3(scale, scale, scale))
    sv.render.bottleMatrix = m
  }

  /// glass catches the light: sun sparkle (day, clear) and the searchlight beam (night)
  func glint(_ env: SurvivorsEnv) {
    let ocean = sv.ctx.ocean
    let flick = JS.pow(JS.max(0, JS.sin(env.t * 2.9 + phase)), 10)
    var k = 0.0
    if env.sunny { k = 0.9 * flick }
    let beam = ocean?.searchlightAt(x, z, y) ?? 0
    if beam > 0.05 { k = JS.max(k, beam * (0.55 + 0.45 * flick)) }
    if k <= 0.02 { return }
    if env.reduceFlashes { k *= 0.5 }
    sv.render.glows.add(x, y + 0.08, z, 0.07, tables.bottleGlint, 2.4 * k, 0.55, 0.35 * k, 0)
    ocean?.addSeaGlint(x, z, 0.8, 0.5 * k, tables.bottleGlint)
  }

  func pickup(_ env: SurvivorsEnv, _ dt: Double) {
    let dB = env.bWet ? JS.hypot(env.bx - x, env.bz - z) : .infinity
    let dH = JS.hypot(env.hx - x, env.hz - z)
    let basket = dB < tables.bottleBasketR
    let hover = env.alt <= tables.bottleHoverAlt && dH <= tables.bottleHoverR
    if basket || hover { capT += dt } else { capT = JS.max(0, capT - dt * 2) }
    if capT < tables.bottleCaptureT { return }
    take(env, basket ? "basket" : "hover")
  }

  func take(_ env: SurvivorsEnv, _ by: String) {
    taken = true
    let to = by == "basket" ? (env.bx, env.by + 0.3, env.bz) : (env.hx, env.hy - 1, env.hz)
    lift = Lift(t: 0, x: x, y: y, z: z, tx: to.0, ty: to.1, tz: to.2)
    noteCursor = (noteCursor + 1) % tables.bottleNotes.count
    let note = tables.bottleNotes[noteCursor]
    let pos = V3(x, y, z)
    sv.ctx.events.emit(GameEvent.SurvivorBottle(title: note.title, text: note.text, x: x, z: z, by: by))
    // small style bonus through the existing score event: the mission's own style (if it knows 'bottle'),
    // else a plain style line in the scorer, else the bare event for the HUD popup
    let m = sv.ctx.mission
    var pts = JSNumber.or(m?.style("bottle", pos), 0)
    if !JSNumber.isTruthy(pts), let m, m.isPlaying, let added = m.scorerAdd("style", tables.bottlePoints, "Бутылка с запиской", pos) {
      pts = added
    }
    if !JSNumber.isTruthy(pts) && !(m?.hasScorer ?? false) {
      sv.ctx.events.emit(GameEvent.ScoreAdd(points: tables.bottlePoints, reason: "Бутылка с запиской", position: pos, kind: "style", style: "bottle"))
    }
  }

  /// up into the basket / the door, shrinking out of sight
  func liftTick(_ env: SurvivorsEnv, _ dt: Double) {
    guard var L = lift else { return }
    L.t += dt
    lift = L
    let k = SurvivorMath.clamp01(L.t / 0.8)
    let e = k * k * (3 - 2 * k)
    var q = Quat()
    q.setFromAxisAngle(V3(0, 1, 0), yaw)
    var q2 = Quat()
    q2.setFromAxisAngle(V3(0, 0, 1), 0.4 * e)
    q.multiply(q2)
    place(L.x + (L.tx - L.x) * e, L.y + (L.ty - L.y) * e, L.z + (L.tz - L.z) * e, q, tables.bottleScale * (1 - 0.85 * e))
    if k >= 1 {
      active = false
      lift = nil
      sv.render.bottleVisible = false
    }
  }
}
