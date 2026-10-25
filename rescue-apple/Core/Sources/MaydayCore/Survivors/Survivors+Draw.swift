// survivors.js _draw: per-frame instance data for the renderer — craft batches, people aboard and in the
// water, the person on the cable, strobes, signal visuals, pets, lost-person buoys, the bottle — and the
// materials' uniforms (ghostUniforms). The draw also advances small bits of state exactly like the web
// (people's yaw / arm pose / ring positions, swimmer strokes with their rng draws and splashes, the lagged
// normals of groups and buoys, debris heights, a held flare following the hand, container roof wash), so
// it runs in update() in the web's order. Output: `render` (SurvivorsRenderState), unculled.

extension Survivors {
  static let UPV = V3(0, 1, 0)

  func draw(_ env: SurvivorsEnv, _ dt: Double) {
    let ocean = ctx.ocean
    render.begin()
    let night = env.night
    let rf = env.reduceFlashes
    let RAFT = tables.raft

    // --- carriers ----------------------------------------------------------------------------------
    for c in carriers {
      let occupants = occupantsAboard(c)
      let lit = c.tapeLit
      let tape = lit + 3 * c.tapeFlash
      switch c.kind {
      case .raft:
        // canopy lamp 60/min; dead when the raft is capsized or its people are lost
        let lampOn = c.lampDead != true && !c.capsized && (env.t + c.lampPhase).truncatingRemainder(dividingBy: tables.sig.lampPeriod) < 0.13
        let lamp: Double = lampOn ? (rf ? 0.4 : 1) : 0
        let chem: Double = !c.capsized && night > 0.45 && !c.dropped ? 1 : 0
        render.raft.push(c.matrix, tape, lamp, c.flutter, 0, c.dissolve, chem, c.phase)
        if occupants && !c.capsized { render.heatRaft.push(c.matrix) }
        if lamp > 0 {
          let v = c.toWorld(0, RAFT.canopyTop + 0.25, 0)
          render.glows.add(v.x, v.y, v.z, 0.35, tables.cLamp, (2 + 6 * night) * lamp, 3.5, (0.3 + 1.6 * night) * lamp, 1, env.t * 0.2)
          if night > 0.2 { ocean?.addSeaGlint(c.x, c.z, 2.5, 0.9 * lamp * night, tables.cLamp) }
        }
        if chem > 0 {
          let v = c.toWorld(RAFT.R * 0.5, RAFT.canopyTop - 0.2, RAFT.R * 0.35)
          render.glows.add(v.x, v.y, v.z, 0.18, tables.cChem, 1.6, 1.4, 0.45, 0)
        }
        if lit > 0.25 && quality == "low" {
          let v = c.toWorld(0, RAFT.canopyTop, 0)
          render.glows.add(v.x, v.y, v.z, 0.3, tables.cTape, 2.5 * lit, 2.2, 0.6 * lit, 1, 0.6)
        }
        render.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, RAFT.R + RAFT.tube * 0.8, 0.85 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase)
        // sea anchor line streaming upwind to the drogue
        if !c.capsized && c.inflate > 0.9 && !c.dropped, let ocean { anchorLine(c, ocean) }
      case .hull:
        let plane = c.style == "plane"
        if plane {
          render.plane.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase)
        } else if c.style == "yacht" {
          render.yacht.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase)
        } else {
          render.boat.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase)
        }
        if occupants && c.dissolve < 0.5 {
          if plane { render.heatPlane.push(c.matrix) } else if c.style == "yacht" { render.heatYacht.push(c.matrix) } else { render.heatBoat.push(c.matrix) }
        }
        if let text = c.decalText {
          render.decals.append(CarrierDecal(kind: plane ? "plane" : "hull", style: c.style, text: text, matrix: c.matrix, visible: c.dissolve < 0.4,
                                            opacity: 0.9 * (1 - c.dissolve * 2.5)))
        }
        let yaw = c.yaw
        if plane {
          // fuselage + the awash lower wing
          render.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.05, 0.8 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, yaw, 3.6)
          let v = c.toWorld(0, 0, tables.planeWingZ)
          render.collars.push(v.x, c.y, v.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.0, 0.7 * (1 - c.dissolve), 0.6 * (1 - c.dissolve), lit, c.phase + 2,
                              yaw + JS.PI / 2, 4.6)
        } else {
          render.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, c.style == "yacht" ? 1.95 : 1.75, 0.8 * (1 - c.dissolve), 1 - c.dissolve, lit,
                              c.phase, yaw, c.elong)
        }
        for i in c.debris.indices {
          let d = c.debris[i]
          let y = ocean?.heightAt(d.x, d.z) ?? .nan
          c.debris[i].y = y
          var q = Quat()
          q.setFromAxisAngle(Survivors.UPV, d.yaw)
          var m = Mat4()
          m.compose(V3(d.x, y + 0.02, d.z), q, V3(1, 1, 1))
          render.debris.push(m, 0, 0, 0, 0, c.dissolve * 0.7, 0, 0, Double(debrisIndex(d.kind) + 1))
        }
      case .container:
        render.container.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase, 0, c.color)
        // swell washing over the roof: foam where the sea stands above the roof at either end
        if env.play && dt > 0, let ocean {
          c.washT = (c.washT ?? 0) - dt
          if (c.washT ?? 0) <= 0 {
            c.washT = 0.45
            var e = -1.0
            while e <= 1 {
              let v = c.toWorld(0, tables.cont.freeboard, e * tables.cont.L * 0.42)
              if ocean.heightAt(v.x, v.z) > v.y - 0.12 {
                ocean.seaStamp("foam", v.x, v.z, radius: 1.5, strength: 0.55)
                c.washT = 1.1
              }
              e += 2
            }
          }
        }
        render.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.4, 0.9 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, c.yaw, 2.4)
      case .barge, .wreck:
        if let spec = c.big {
          render.ensureBig(spec)
          render.big[spec.key]?.push(c.matrix, tape, 0, 0, c.kind == .wreck ? c.lights : JS.max(night, env.sunny ? 0 : 0.25), c.dissolve, 0, c.phase)
        }
        render.collars.push(c.x, c.y + (c.kind == .wreck ? 0.3 : 0), c.z, 0, 1, 0, JSNumber.or(c.big?.collarR, 5.6), c.kind == .wreck ? 1 : 0.7, 1, lit,
                            c.phase, c.yaw, JSNumber.or(c.big?.elong, 3.2))
        if let text = c.decalText {
          render.decals.append(CarrierDecal(kind: "wreck", style: c.big?.model ?? "", text: text, matrix: c.matrix, visible: c.dissolve < 0.5,
                                            opacity: 0.92 * (1 - c.dissolve * 2)))
        }
      case .rig:
        break
      }
      // people aboard (owner + riders), as many as the craft shows
      if occupants { drawAboard(c, env, dt) }
      if let o = c.owner, o.pet != nil { drawPet(o, c, env, o.state == .lost ? SurvivorMath.clamp01(o.lostT / tables.lostFade) : 0) }
    }

    // --- groups without a carrier (swimmers, the injured, flower rings) ---------------------------
    var k = 0
    while k < list.count {
      let s = list[k]
      k += 1
      if s.attached != nil { drawAttached(s, env, dt) }
      if s.carrier != nil { continue }
      if s.state == .rescued { continue }
      if s.state == .lost && s.lostT > tables.lostFade + 0.2 { continue }
      drawSwimmers(s, env, dt)
      if let pet = s.pet, pet.kind == "dog" { drawPet(s, nil, env, s.state == .lost ? SurvivorMath.clamp01(s.lostT / tables.lostFade) : 0) }
    }

    // --- lost-person markers: grey buoy («ПОТЕРЯН» is the HUD's label) ------------------------------
    for i in lostMarkers.indices {
      var m = lostMarkers[i]
      m.y = ocean?.heightAt(m.x, m.z) ?? 0
      if let ocean {
        let n = ocean.seaNormalAt(m.x, m.z)
        m.nrm.lerp(n, dt > 0 ? 1 - JS.exp(-dt / 0.3) : 0)
        m.nrm.normalize()
      }
      var q = Quat()
      q.setFromUnitVectors(Survivors.UPV, m.nrm)
      let rise = SurvivorMath.smooth(0, 2.5, env.t - m.t)
      var mat = Mat4()
      mat.compose(V3(m.x, m.y - 1.6 * (1 - rise), m.z), q, V3(1, 1, 1))
      render.buoy.push(mat, 0, 0, 0, 0.5, 0, 0, m.phase)
      render.collars.push(m.x, m.y, m.z, m.nrm.x, m.nrm.y, m.nrm.z, 0.32, 0.7 * rise, 0.8, 0, m.phase)
      lostMarkers[i] = m
    }

    bottle.frame(env, dt)
    render.crowd.end(extras: crowdExtras)
    ghostUniforms()
  }

  func debrisIndex(_ kind: String) -> Int { tables.debrisKinds.firstIndex(of: kind) ?? -1 }

  /// ghostUniforms(): the ghost / collar / craft material uniforms of this frame.
  func ghostUniforms() {
    let e = env
    let pal = ctx.weather?.seaState.palette
    var u = render.uniforms
    u.ghostLight = e.ghostLight
    if let b = pal?.body { u.water = b }
    u.foam = e.foam
    // day rim (DESIGN §2.7.3: hemiSky·pow(1 − N·V, 3)·.35) and the vest's own read in dim daylight
    let day = 1 - e.night
    if let sky = pal?.sky {
      u.rim = sky
      u.rim.multiplyScalar(0.35 * day)
    } else {
      u.rim.setRGB(0.1, 0.12, 0.14)
      u.rim.multiplyScalar(day)
    }
    // night: craft keep a faint moonlit-hemisphere floor so they never fall below the sea's luminance
    u.nightAmb.setRGB(0.009, 0.012, 0.016)
    u.nightAmb.multiplyScalar(e.night)
    render.crowd.keylineOn = e.night > 0.45
    let lightLevel = (pal?.sunIntensity ?? 2) * 0.4 + (pal?.ambientIntensity ?? 0.6) * 0.5
    // under a heavy overcast the whole sky dome lights the decks (storms only: in fog the ferry must melt
    // into the white); real night and real fog switch the fill off
    let dome = SurvivorMath.smooth(0.9, 0.4, e.night) * SurvivorMath.smooth(1.25, 0.5, lightLevel) * SurvivorMath.clamp01(e.intensity * 1.5)
      * (1 - 0.8 * SurvivorMath.smooth(0.5, 0.9, e.fog)) * (pal?.ambientIntensity ?? 0.6) * 2.0
    if let amb = pal?.ambient {
      u.skyFill = amb
      u.skyFill.multiplyScalar(dome)
    } else {
      u.skyFill.setRGB(0.12, 0.14, 0.15)
      u.skyFill.multiplyScalar(dome)
    }
    // big dark-steel hulls take ~2.6× the small-craft fill under a storm sky
    u.steelFill = u.skyFill
    u.steelFill.multiplyScalar(1 + 1.6 * SurvivorMath.smooth(0.95, 0.55, lightLevel))
    // ≥ 0.05: the vest keeps its #FF5A00 hue under the warm sunset / storm hemisphere instead of going red
    u.vestGlow = 0.05 + day * (0.16 * SurvivorMath.clamp01(1 - lightLevel) + 0.32 * SurvivorMath.clamp01(JSNumber.or(e.intensity, 0)))
    render.uniforms = u
  }

  func occupantsAboard(_ c: Carrier) -> Bool {
    if let o = c.owner, o.state != .rescued { return true }
    for r in c.riders where !r.people.isEmpty || r.state == .lost { return true }
    return false
  }

  func anchorLine(_ c: Carrier, _ ocean: SeaOceanQuery) {
    let RAFT = tables.raft
    let v = c.toWorld(0, RAFT.tube, -RAFT.R - RAFT.tube)
    let ax = c.anchor.x
    let az = c.anchor.z
    let n = 6
    var px = v.x, py = v.y, pz = v.z
    for i in 1...n {
      let k = Double(i) / Double(n)
      let x = v.x + (ax - v.x) * k
      let z = v.z + (az - v.z) * k
      // a wet line sagging into the sea between the raft's patch and the drogue
      let y = ocean.heightAt(x, z) + 0.3 * (1 - k) * (1 - k) - 0.22 * JS.sin(JS.PI * k) - 0.12 * k * k
      render.lines.seg(px, py, pz, x, y, z)
      px = x
      py = y
      pz = z
    }
    // the drogue itself: a small dark-orange fabric cone, mostly submerged (rim awash)
    var q = Quat()
    q.setFromAxisAngle(Survivors.UPV, JS.atan2(v.x - ax, v.z - az))
    var m = Mat4()
    m.compose(V3(ax, py - 0.02, az), q, V3(1, 1, 1))
    render.debris.push(m, 0, 0, 0, 0, 0, 0, 0, Double(debrisIndex("drogue") + 1))
  }

  /// People aboard a carrier (raft doorway, keel, container roof, decks).
  func drawAboard(_ c: Carrier, _ env: SurvivorsEnv, _ dt: Double) {
    let raise = c.kind == .raft && env.bWet && JS.hypot(env.bx - c.x, env.bz - c.z) < 15
    let seats = c.visibleSeats(raise)
    var i = 0
    // the owner first, then riders
    let owner = c.owner
    var total = owner?.people.count ?? 0
    for g in c.riders { total += g.people.count }
    var groups = [SurvivorGroup]()
    if let owner { groups.append(owner) }
    groups.append(contentsOf: c.riders)
    for s in groups {
      if s.state == .rescued && s.people.isEmpty { continue }
      let fade = s.state == .lost ? SurvivorMath.clamp01(s.lostT / tables.lostFade) : 0
      if s.state == .lost && s.lostT > tables.lostFade + 0.2 { continue }
      for p in s.people {
        if i >= seats { break }
        let slot = c.slotFor(i, min(total, seats))
        let v = c.toWorld(slot[0], slot[1], slot[2])
        p.x = v.x
        p.y = v.y
        p.z = v.z
        p.waterY = -50 // people aboard have nothing under the surface (no ghost, no keyline clip)
        p.legFold = slot[3] // seated (poses: arms round the knees)
        // face the heli when it is around, else look along the craft
        let jit = Double(JSNumber.toUint32(Double(i) * 2654435761) % 1000) / 1000 - 0.5 // per-seat facing noise (no pawn grid)
        let target = s.dHeli < 400 ? JS.atan2(env.hx - p.x, env.hz - p.z) + jit * 0.7
          : c.yaw + (c.kind == .hull ? (i % 2 != 0 ? JS.PI / 2 : -JS.PI / 2) : jit * 2.2)
        p.yaw += SurvivorMath.wrapAngle(target - p.yaw) * (1 - JS.exp(-dt * 1.4))
        let pose = poseFor(s, p, env, onCarrier: true)
        if pose != .frozen {
          SurvivorPoses.apply(&p.arms, SurvivorPoses.targets(pose, phase: p.phase, waveArm: p.waveArm, legFold: p.legFold, t: env.t, ringN: 4), dt)
        }
        // tilt with the craft (structures: people stand upright, a little lean with the heel)
        let tilt: Double = c.kind == .wreck || c.kind == .barge || c.kind == .rig ? 0.25 : 0.8
        var n = c.nrm
        n.lerp(Survivors.UPV, 1 - tilt)
        n.normalize()
        var q = Quat()
        q.setFromUnitVectors(Survivors.UPV, n)
        var q2 = Quat()
        if c.kind == .wreck && JSNumber.isTruthy(tilt) {
          q2.setFromEuler(Euler(c.pitch * 0.3, 0, c.roll * 0.3, .XYZ))
          q.multiply(q2)
        }
        q2.setFromAxisAngle(Survivors.UPV, p.yaw)
        q.multiply(q2)
        var m = Mat4()
        m.compose(V3(p.x, p.y - fade * 0.6, p.z), q, V3(p.scale, p.scale, p.scale))
        let tape = ctx.ocean?.searchlightAt(p.x, p.z, p.y) ?? 0
        let strobe = strobeVisual(s, p, env)
        render.crowd.push(m, p.arms, slot[3], fade, p.skin, p.hood, p.jacket, p.pants, tape, strobe, p.waterY, tape * 0.6)
        signalVisuals(s, p, env, tape)
        i += 1
      }
    }
  }

  /// Swimmers: a single person, or the «цветок» ring of 2+ holding hands (shrinks as they cool).
  func drawSwimmers(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    let ocean = ctx.ocean
    let n = s.people.count
    if n == 0 { return }
    let S = tables.personScale
    let fade = s.state == .lost ? SurvivorMath.clamp01(s.lostT / tables.lostFade) : 0
    // group tilt with a 0.3 s lag
    if let ocean {
      let nn = ocean.seaNormalAt(s.position.x, s.position.z)
      s.nrm.lerp(nn, dt > 0 ? 1 - JS.exp(-dt / 0.3) : 0)
      s.nrm.normalize()
    }
    let supine = s.type == "injured"
    var r = 0.0
    if n > 1 {
      r = (0.8 + 0.4 * s.health) * S * (0.55 + 0.11 * Double(n))
      if dt > 0 && s.state != .lost { s.ringSpin += dt * 0.025 }
    }
    for i in 0..<n {
      let p = s.people[i]
      let a = s.ringSpin + (Double(i) / Double(n)) * JS.PI * 2
      let px = s.position.x + JS.cos(a) * r
      let pz = s.position.z + JS.sin(a) * r
      let wy = ocean?.heightAt(px, pz) ?? 0
      p.x = px
      p.z = pz
      p.waterY = wy
      // bob: the vest rides the surface, a little lag up and down
      let bob = 0.05 * JS.sin(env.t * 1.3 + p.phase)
      p.y = wy + bob + (supine ? 0.1 : 0) - fade * 0.7
      let pose = poseFor(s, p, env, onCarrier: false)
      // face the heli (turn slowly); ring people face the centre while holding hands
      let target: Double
      if pose == .hold {
        target = JS.atan2(s.position.x - px, s.position.z - pz)
      } else if s.dHeli < 450 {
        target = JS.atan2(env.hx - px, env.hz - pz)
      } else {
        target = p.yaw
      }
      if pose != .frozen {
        p.yaw += SurvivorMath.wrapAngle(target - p.yaw) * (1 - JS.exp(-dt * (pose == .panic ? 2.5 : 1.2)))
        SurvivorPoses.apply(&p.arms, SurvivorPoses.targets(pose, phase: p.phase, waveArm: p.waveArm, legFold: p.legFold, t: env.t, ringN: Double(n)), dt)
      }
      var q = Quat()
      q.setFromUnitVectors(Survivors.UPV, s.nrm)
      var q2 = Quat()
      q2.setFromAxisAngle(Survivors.UPV, p.yaw + (pose == .panic ? 0.25 * JS.sin(env.t * 5 + p.phase) : 0))
      q.multiply(q2)
      if supine {
        q.multiply(tables.supine)
      } else {
        // floating in a vest: leaned back a little, more as they tire
        var q3 = Quat()
        q3.setFromAxisAngle(V3(1, 0, 0), -0.18 - 0.25 * (1 - s.health))
        q.multiply(q3)
      }
      var m = Mat4()
      m.compose(V3(p.x, p.y, p.z), q, V3(p.scale, p.scale, p.scale))
      let tape = ocean?.searchlightAt(p.x, p.z, p.y + 0.3) ?? 0
      let strobe = strobeVisual(s, p, env)
      render.crowd.push(m, p.arms, 0, fade, p.skin, p.hood, p.jacket, p.pants, tape, strobe, wy, tape * 0.6)
      // collar & contact disc per person; splashier when swimming or flailing
      let busy = s.swimTo != nil || pose == .panic || pose == .wave2 ? 0.85 : 0.5
      render.collars.push(p.x, wy, p.z, s.nrm.x, s.nrm.y, s.nrm.z, supine ? 0.62 * S : 0.42 * S, busy * (1 - fade), 1 - fade, tape, p.phase,
                          supine ? p.yaw : 0, supine ? 1.8 : 1)
      if s.swimTo != nil && dt > 0, let ocean { ocean.seaWake(p.x, p.z, 0.4, s.velocity.x, s.velocity.z) }
      // strokes / flailing break the surface: a small splash at the hand and a ripple ring per stroke
      if env.play && dt > 0 && !supine && fade < 0.5 && (s.swimTo != nil || pose == .panic || pose == .wave2) {
        p.strokeT = (p.strokeT ?? p.phase.truncatingRemainder(dividingBy: 0.8)) - dt
        if (p.strokeT ?? 0) <= 0 {
          p.strokeT = 0.65 + 0.35 * rng.next()
          p.strokeSide = -JSNumber.or(p.strokeSide, 1)
          let side = p.strokeSide ?? 1
          let cy = JS.cos(p.yaw), sy = JS.sin(p.yaw)
          let hx = p.x + (cy * side * 0.32 + sy * 0.3) * S
          let hz = p.z + (-sy * side * 0.32 + cy * 0.3) * S
          ctx.fx?.splash(hx, wy, hz, 0.3)
          if s.dHeli < 160 { ocean?.seaStamp("ring", hx, hz, radius: 0.9, strength: 0.3) }
        }
      }
      signalVisuals(s, p, env, tape)
    }
  }

  /// The person on the cable: in the basket (crouched, hands on the strop) or on the stretcher.
  func drawAttached(_ s: SurvivorGroup, _ env: SurvivorsEnv, _ dt: Double) {
    guard let p = s.attached, let h = ctx.heli?.seaView else { return }
    var v: V3
    var q = Quat()
    if h.basketMeshVisible {
      v = h.basketMeshPosition
      q = h.basketMeshQuaternion
    } else if let b = h.basket {
      v = b
      p.spin += dt * 0.35
      q.setFromAxisAngle(Survivors.UPV, p.spin)
    } else {
      return
    }
    var up = V3(0, 1, 0)
    up.applyQuaternion(q)
    if s.type == "injured" {
      // Stokes litter hanging under the hook, casualty strapped in face up
      var m = Mat4()
      var at = v
      at.addScaledVector(up, -0.25)
      m.compose(at, q, V3(1, 1, 1))
      render.stretcher.push(m, 0, 0, 0, 0, 0, 0, 0)
      var q2 = q
      var q3 = Quat()
      q3.setFromAxisAngle(V3(1, 0, 0), -JS.PI / 2)
      q2.multiply(q3)
      // the body runs head (−z) to feet (+z) from its origin: centre it on the litter
      var along = V3(0, 0, 1)
      along.applyQuaternion(q)
      var b = v
      b.addScaledVector(up, 0.02)
      b.addScaledVector(along, -0.67 * p.scale)
      m.compose(b, q2, V3(p.scale, p.scale, p.scale))
      SurvivorPoses.apply(&p.arms, SurvivorPoses.targets(.stretcher, phase: p.phase, waveArm: p.waveArm, legFold: p.legFold, t: env.t), dt)
      render.crowd.push(m, p.arms, 0, 0, p.skin, p.hood, p.jacket, p.pants, 0, 0, -50, 0)
      return
    }
    // slow spin on the cable (the basket's own spin), crouched in the basket, hands on the strop
    var m = Mat4()
    var at = v
    at.addScaledVector(up, 0.92)
    m.compose(at, q, V3(p.scale, p.scale, p.scale))
    SurvivorPoses.apply(&p.arms, SurvivorPoses.targets(.cable, phase: p.phase, waveArm: p.waveArm, legFold: p.legFold, t: env.t), dt)
    let tape = ctx.ocean?.searchlightAt(v.x, v.z, v.y) ?? 0
    let wy = ctx.ocean?.heightAt(v.x, v.z) ?? 0
    render.crowd.push(m, p.arms, 1, 0, p.skin, p.hood, p.jacket, p.pants, tape, 0, wy, 0)
  }

  /// Personal strobe: 60 ms every 1.5 s in a random phase (reduce flashes: 40 %, still ≤ 1 Hz). Lights the
  /// water and a star you can find the person by; returns the strobe level for the instance.
  func strobeVisual(_ s: SurvivorGroup, _ p: SurvivorPerson, _ env: SurvivorsEnv) -> Double {
    if s.state == .lost || !strobeOn(s, env.night) { return 0 }
    let SIG = tables.sig
    let ph = (env.t + p.strobePhase).truncatingRemainder(dividingBy: SIG.strobePeriod)
    // never miss a flash at a low frame rate: the frame that crosses the start shows it
    let on = ph < SIG.strobeOn || (env.dt > SIG.strobeOn && ph < env.dt + 0.001)
    if !on { return 0 }
    let k = env.reduceFlashes ? 0.4 : 1
    ctx.ocean?.addSeaGlint(p.x, p.z, 3.2, 1.6 * k, tables.cStrobe)
    let haze = SurvivorMath.clamp01(JS.max(env.fog, env.intensity))
    render.glows.add(p.x, p.y + 0.4 * tables.personScale, p.z, 0.25, tables.cStrobe, 9 * k, 0.8 + 3.7 * haze, (0.6 + 0.8 * haze) * k, 1, env.t * 0.37)
    return k
  }

  /// Signal visuals attached to a person: the handheld flare follows the hand, mirror star, tape glints.
  func signalVisuals(_ s: SurvivorGroup, _ p: SurvivorPerson, _ env: SurvivorsEnv, _ tape: Double) {
    let S = tables.personScale
    if p !== s.people.first {
      if tape > 0.35 && quality == "low" { render.glows.add(p.x, p.y + 0.25 * S, p.z, 0.2, tables.cTape, 2.5 * tape, 1.6, 0.5 * tape, 1, 0.3) }
      return
    }
    // hand position for the raised arm (approximate: above the shoulder on the waving side)
    let side = p.waveArm
    let cy = JS.cos(p.yaw)
    let sy = JS.sin(p.yaw)
    let hx = p.x + cy * side * 0.35
    let hz = p.z - sy * side * 0.35
    let hy = p.y + 1.2 * S
    if s.sig.flareBurn > 0, let f = s.sig.flareObj, f.alive {
      f.x = hx
      f.z = hz
    }
    if s.sig.mirrorFlash > 0 {
      let k = JS.sin(JS.PI * SurvivorMath.clamp01(s.sig.mirrorFlash / tables.sig.mirrorFlash))
      render.glows.add(hx, hy, hz, 0.3, tables.cMirror, 10 * k * (env.reduceFlashes ? 0.4 : 1), 6, 1.6 * k, 1, 0.785)
    }
    if tape > 0.35 && quality == "low" { render.glows.add(p.x, p.y + 0.25 * S, p.z, 0.2, tables.cTape, 2.5 * tape, 1.6, 0.5 * tape, 1, 0.3) }
  }

  /// Draw the pet on the craft (or paddling next to its owner in the water). It leaves with the last person.
  func drawPet(_ s: SurvivorGroup, _ c: Carrier?, _ env: SurvivorsEnv, _ fade: Double) {
    guard var pet = s.pet else { return }
    if s.remaining <= 0 || s.state == .rescued || (s.attached != nil && s.remaining <= 1) { return }
    let kind = Double(debrisIndex(pet.kind) + 1)
    let cat = pet.kind == "cat"
    let hop = pet.hopT > 0 ? JS.sin(JS.PI * JS.min(1, pet.hopT / (cat ? 0.8 : 0.18))) * (cat ? 0.45 : 0.1) : 0
    var v: V3
    var q = Quat()
    if let c {
      let slot = c.petSlot(pet.far)
      v = c.toWorld(slot[0], slot[1], slot[2])
      // look at the heli when it is near, else along the craft; a lazy idle sway
      let target = s.dHeli < 200 ? JS.atan2(env.hx - v.x, env.hz - v.z) - c.yaw : slot[3]
      pet.yaw += SurvivorMath.wrapAngle(target - pet.yaw) * (1 - JS.exp(-JSNumber.or(env.dt, 0) * 2))
      q = c.quat
      var q2 = Quat()
      q2.setFromAxisAngle(Survivors.UPV, pet.yaw + 0.15 * JS.sin(env.t * 0.9 + Double(s.id.raw)))
      q.multiply(q2)
      v.y += hop - fade * 0.4
      s.pet = pet
    } else {
      // swimming dog: only the head and back above the water, beside the first person
      guard let p = s.people.first else { return }
      let a = p.yaw + JS.PI / 2
      v = V3(p.x + JS.sin(a) * 0.9, p.waterY - 0.24 * tables.personScale - fade * 0.4, p.z + JS.cos(a) * 0.9)
      q.setFromUnitVectors(Survivors.UPV, s.nrm)
      var q2 = Quat()
      q2.setFromAxisAngle(Survivors.UPV, p.yaw + 0.3 * JS.sin(env.t * 1.3))
      q.multiply(q2)
    }
    var m = Mat4()
    m.compose(v, q, V3(1, 1, 1))
    render.debris.push(m, 0, 0, 0, 0, fade, 0, 0, kind)
  }
}
