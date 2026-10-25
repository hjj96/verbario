// fx/life.js — life at sea (DESIGN §2.11, §3.10 «Чайки», §4 #32 #42):
//   Gulls [SHOULD]   3–5 birds circle at ~20 m over every survivor group nobody has found yet (state
//                    'hidden', or 'drifting' = a rocket / EPIRB gave only an approximate fix) in calm /
//                    overcast / clearing — a silent hint. They leave DOWNWIND before a storm (forecast
//                    within 60 s) and come back after it, scatter from a low heli, flee hazards, keep their
//                    noses into the wind. One ambient flock wanders on the title / briefing / debrief.
//   Dolphins [NICE]  a pod porpoising across the view in calm daylight (medium / high).
//   Whale [NICE]     now and then in calm water: a dark back breaks the surface, blows a mist column,
//                    cruises leaving a slick, then dives.
// The gull gate and anchors are gameplay (the hint); the rest is cosmetic. Jellyfish (night, render-only,
// no random draws) are the renderer's. Instance data for the renderer: transforms + the gull flap.

public final class GullFlocks {
  public final class Bird {
    public internal(set) var on = false
    weak var flock: Flock?
    public internal(set) var x: Double = 0
    public internal(set) var y: Double = 20
    public internal(set) var z: Double = 0
    var vx: Double = 0
    var vy: Double = 0
    var vz: Double = 0
    public internal(set) var heading: Double = 0
    public internal(set) var bank: Double = 0
    var phase: Double
    var amp: Double = 0.1
    var burst: Double = 0
    var burstT: Double
    var ang: Double = 0
    var rad: Double = 15
    var alt: Double = 20
    var w: Double = 0.35
    var seed: Double

    init(phase: Double, burstT: Double, seed: Double) {
      self.phase = phase
      self.burstT = burstT
      self.seed = seed
    }
  }

  public final class Flock {
    /// the survivor group it marks (nil: the ambient flock)
    public let anchor: GroupID?
    public internal(set) var cx: Double
    public internal(set) var cz: Double
    /// 'circle' | 'leave' | 'flee'
    public internal(set) var state = "circle"
    var t: Double = 0
    var fleeT: Double = 0
    var birds: [Bird] = []
    var fromX: Double = 0
    var fromZ: Double = 0

    init(anchor: GroupID?, cx: Double, cz: Double) {
      self.anchor = anchor
      self.cx = cx
      self.cz = cz
    }
  }

  unowned let fx: Effects
  public let max: Int
  public internal(set) var limit: Int
  public internal(set) var birds: [Bird]
  public internal(set) var flocks: [Flock] = []
  public internal(set) var allowed = true
  var scanT: Double = 0
  var gateT: Double = 0
  var leftAnnounced = false
  var returning = false
  /// instance data: matrices (Float, 16 each) and iFlap for the birds that are on
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]
  public internal(set) var flap: [Float]

  init(_ fx: Effects, maxBirds: Int) {
    self.fx = fx
    max = maxBirds
    limit = maxBirds
    let random = fx.ctx.random
    var list = [Bird]()
    for _ in 0..<maxBirds {
      // object literal order: phase, …, burstT, …, seed
      let phase = random() * 6.28
      let burstT = 2 + random() * 4
      let seed = random()
      list.append(Bird(phase: phase, burstT: burstT, seed: seed))
    }
    birds = list
    matrices = [Float](repeating: 0, count: maxBirds * 16)
    flap = [Float](repeating: 0, count: maxBirds)
  }

  func setLimit(_ n: Int) { limit = Swift.max(0, Swift.min(max, n)) }

  func clear() {
    for b in birds {
      b.on = false
      b.flock = nil
    }
    flocks.removeAll()
    count = 0
    leftAnnounced = false
  }

  /// scatter flocks near (x, z) (hazard warnings)
  func scare(_ x: Double, _ z: Double, _ radius: Double = 500) {
    for f in flocks where JS.hypot(f.cx - x, f.cz - z) < radius { leave(f, x, z) }
  }

  func leave(_ f: Flock, _ fromX: Double, _ fromZ: Double) {
    if f.state == "leave" { return }
    f.state = "leave"
    f.t = 0
    f.fromX = fromX
    f.fromZ = fromZ
  }

  func freeBird() -> Bird? {
    var used = 0
    for b in birds where b.on { used += 1 }
    if used >= limit { return nil }
    return birds.first { !$0.on }
  }

  @discardableResult
  func spawnFlock(_ anchor: GroupID?, _ cx: Double, _ cz: Double, _ n: Int, _ wind: V2, _ farStart: Bool) -> Flock {
    let random = fx.ctx.random
    let f = Flock(anchor: anchor, cx: cx, cz: cz)
    let wlr = JS.hypot(wind.x, wind.y)
    let wl = JSNumber.isTruthy(wlr) ? wlr : 1
    for _ in 0..<n {
      guard let b = freeBird() else { break }
      b.on = true
      b.flock = f
      b.rad = 7 + random() * 10
      b.alt = 17 + random() * 7
      b.ang = random() * JS.PI * 2
      let w0 = 0.28 + random() * 0.22
      b.w = w0 * (random() < 0.5 ? -1 : 1)
      if farStart {
        // come back from downwind, spread out
        let d = 380 + random() * 160
        b.x = cx + (wind.x / wl) * d + (random() - 0.5) * 120
        b.z = cz + (wind.y / wl) * d + (random() - 0.5) * 120
        b.y = 40 + random() * 15
      } else {
        b.x = cx + JS.cos(b.ang) * b.rad
        b.z = cz + JS.sin(b.ang) * b.rad
        b.y = b.alt
      }
      b.vx = -JS.sin(b.ang) * 9 * JS.sign(b.w)
      b.vz = JS.cos(b.ang) * 9 * JS.sign(b.w)
      b.vy = 0
      f.birds.append(b)
    }
    flocks.append(f)
    return f
  }

  /// Is the weather gull weather now and for the next minute?
  func gate(_ st: SeaWeatherState) -> Bool {
    if !(st.preset.map { fx.tables.gullPresets.contains($0) } ?? false) || (st.night ?? 0) > 0.6 || (st.intensity ?? 0) > 0.45 { return false }
    if let fc = fx.ctx.weather?.seaForecast() {
      for e in fc where e.inS <= 60 && !fx.tables.gullPresets.contains(e.preset) { return false }
    }
    return true
  }

  static func unseen(_ s: SurvivorGroup) -> Bool { s.state == .hidden || (s.state == .drifting && !s.spotted) }

  func update(_ dt: Double, _ st: SeaWeatherState, _ wind: V2, _ focus: V2, _ heli: FxHeli) {
    if !(dt > 0) {
      write()
      return
    }
    let random = fx.ctx.random
    // weather gate (2 Hz)
    gateT -= dt
    if gateT <= 0 {
      gateT = 0.5
      let was = allowed
      allowed = gate(st)
      if was && !allowed {
        var seen = false
        for f in flocks {
          if f.state != "leave" { leave(f, f.cx - wind.x, f.cz - wind.y) }
          if JS.hypot(f.cx - focus.x, f.cz - focus.y) < 450 { seen = true }
        }
        if seen && !leftAnnounced {
          leftAnnounced = true
          fx.ctx.events.emit(GameEvent.FxGulls(state: "leave"))
        }
      } else if !was && allowed {
        leftAnnounced = false
        returning = true
      }
    }

    // anchors: hidden survivors (1 Hz)
    scanT -= dt
    if scanT <= 0 {
      scanT = 1
      scan(wind)
    }

    // flocks: follow anchors, scatter from the heli
    var i = flocks.count - 1
    while i >= 0 {
      let f = flocks[i]
      f.t += dt
      if let a = f.anchor {
        if let s = fx.ctx.survivors?.group(id: a) {
          f.cx = s.position.x
          f.cz = s.position.z
        }
      } else if f.state == "circle" {
        // ambient flock wanders slowly near the camera focus
        f.cx += (focus.x + 40 * JS.sin(f.t * 0.05) - f.cx) * JS.min(1, dt * 0.05)
        f.cz += (focus.y - 30 + 30 * JS.cos(f.t * 0.04) - f.cz) * JS.min(1, dt * 0.05)
      }
      if f.state == "circle" && heli.alive {
        let d = JS.hypot(heli.x - f.cx, heli.z - f.cz)
        if d < 34 && heli.alt < 50 {
          f.state = "flee"
          f.fleeT = 6 + random() * 3
        }
      } else if f.state == "flee" {
        f.fleeT -= dt
        let d = JS.hypot(heli.x - f.cx, heli.z - f.cz)
        if f.fleeT <= 0 && (d > 45 || heli.alt > 55) { f.state = "circle" }
      }
      // drop finished flocks
      var alive = 0
      for b in f.birds where b.on { alive += 1 }
      if alive == 0 { flocks.remove(at: i) }
      i -= 1
    }

    for b in birds where b.on { fly(b, dt, wind, focus, heli) }
    write()
  }

  func scan(_ wind: V2) {
    var ids = Set<GroupID>()
    var ambient = false
    let list = fx.ctx.survivors?.list
    let mode = fx.ctx.mode()
    let ambientMode = mode == .title || mode == .debrief || mode == .briefing
    // existing flocks whose anchor is no longer hidden → leave
    for f in flocks {
      if f.state == "leave" { continue }
      if let a = f.anchor {
        if let s = list?.first(where: { $0.id == a }), GullFlocks.unseen(s) {
          ids.insert(a)
        } else {
          leave(f, f.cx, f.cz)
        }
      } else if !ambientMode || !allowed {
        leave(f, f.cx - wind.x, f.cz - wind.y)
      } else {
        ambient = true
      }
    }
    if !allowed { return }
    let far = returning
    returning = false
    for s in list ?? [] {
      if !GullFlocks.unseen(s) || ids.contains(s.id) { continue }
      let n = 3 + ((s.id.raw * 7 + 3) % 3)
      if spawnFlock(s.id, s.position.x, s.position.z, n, wind, far).birds.isEmpty {
        flocks.removeLast()
        break
      }
    }
    if ambientMode && !ambient {
      let foc = fx.focus
      let f = spawnFlock(nil, foc.x + 30, foc.y - 40, 4, wind, false)
      if f.birds.isEmpty { flocks.removeLast() }
    }
  }

  func fly(_ b: Bird, _ dt: Double, _ wind: V2, _ focus: V2, _ heli: FxHeli) {
    let f = b.flock
    var dvx: Double, dvy: Double, dvz: Double
    if f == nil || f?.state == "leave" {
      // downwind and up, away from where the trouble is
      let wl = JS.hypot(wind.x, wind.y)
      var ax = wl > 0.5 ? wind.x / wl : b.x - (f?.fromX ?? focus.x)
      var az = wl > 0.5 ? wind.y / wl : b.z - (f?.fromZ ?? focus.y)
      let alr = JS.hypot(ax, az)
      let al = JSNumber.isTruthy(alr) ? alr : 1
      ax /= al
      az /= al
      dvx = ax * 12 + wind.x * 0.4
      dvz = az * 12 + wind.y * 0.4
      dvy = b.y < 48 ? 2.6 : 0
      if JS.hypot(b.x - focus.x, b.z - focus.y) > 560 {
        b.on = false
        b.flock = nil
        return
      }
    } else if let f, f.state == "flee" {
      var ax = b.x - heli.x
      var az = b.z - heli.z
      let alr = JS.hypot(ax, az)
      let al = JSNumber.isTruthy(alr) ? alr : 1
      ax /= al
      az /= al
      dvx = ax * 14 - az * 3 * JS.sign(b.w)
      dvz = az * 14 + ax * 3 * JS.sign(b.w)
      dvy = b.y < 32 ? 3 : 0
    } else {
      let f = f!
      // circle the anchor
      b.ang += b.w * dt
      let tx = f.cx + JS.cos(b.ang) * b.rad
      let tz = f.cz + JS.sin(b.ang) * b.rad
      let s = JS.sign(b.w)
      let sp = JS.abs(b.w) * b.rad
      dvx = -JS.sin(b.ang) * sp * s + (tx - b.x) * 0.6
      dvz = JS.cos(b.ang) * sp * s + (tz - b.z) * 0.6
      let alt = b.alt + 2.5 * JS.sin(b.ang * 0.5 + b.seed * 6)
      dvy = JS.max(-3, JS.min(3, (alt - b.y) * 0.6))
      // limit far approach speed (returning birds)
      let dl = JS.hypot(dvx, dvz)
      if dl > 14 {
        dvx *= 14 / dl
        dvz *= 14 / dl
      }
    }
    // steer (ground frame)
    let maxA = 7 * dt
    let ax = JS.max(-maxA, JS.min(maxA, dvx - b.vx))
    let ay = JS.max(-maxA, JS.min(maxA, dvy - b.vy))
    let az = JS.max(-maxA, JS.min(maxA, dvz - b.vz))
    b.vx += ax
    b.vy += ay
    b.vz += az
    b.x += b.vx * dt
    b.y = JS.max(4, b.y + b.vy * dt)
    b.z += b.vz * dt
    // nose into the relative wind: heading from the AIR velocity (ground velocity − wind)
    let avx = b.vx - wind.x * 0.85
    let avz = b.vz - wind.y * 0.85
    if avx * avx + avz * avz > 0.25 {
      let h = JS.atan2(avx, -avz)
      var d = h - b.heading
      d = JS.atan2(JS.sin(d), JS.cos(d))
      b.heading += d * JS.min(1, dt * 5)
      let turn = d / JS.max(dt, 1e-3)
      b.bank += (JS.max(-0.65, JS.min(0.65, -turn * 0.12)) - b.bank) * JS.min(1, dt * 4)
    }
    // flapping: climb / accelerate → flap 3.2 Hz; otherwise glide with bursts
    b.burstT -= dt
    if b.burstT <= 0 {
      let random = fx.ctx.random
      b.burst = 0.8 + random() * 0.8
      b.burstT = 3 + random() * 5
    }
    b.burst = JS.max(0, b.burst - dt)
    let need = b.vy > 0.6 || (ax * ax + az * az) / (dt * dt + 1e-6) > 9 || b.burst > 0 || (f != nil && f?.state != "circle")
    let target = need ? 0.62 : 0.06
    b.amp += (target - b.amp) * JS.min(1, dt * 3)
    b.phase += dt * (need ? 3.3 : 2.4) * JS.PI * 2
  }

  func write() {
    var n = 0
    for b in birds where b.on {
      var q = Quat()
      q.setFromEuler(Euler(0, -b.heading, b.bank, .YXZ))
      var m = Mat4()
      m.compose(V3(b.x, b.y, b.z), q, V3(0.72, 0.72, 0.72)) // ≈ 1.6 m span: a real herring gull
      writeMatrix(m, &matrices, n)
      flap[n] = Float(0.12 + b.amp * JS.sin(b.phase))
      n += 1
    }
    count = n
  }
}

/// Dolphins [NICE]: a pod porpoising across the view in calm daylight.
public final class Dolphins {
  public struct Member {
    var ox: Double = 0
    var oz: Double = 0
    var ph: Double = 0
    var was = false
  }

  unowned let fx: Effects
  public let max: Int
  public internal(set) var limit: Int
  public internal(set) var active = false
  var t: Double = 0
  var life: Double = 40
  var x: Double = 0
  var z: Double = 0
  var dx: Double = 1
  var dz: Double = 0
  var n = 0
  var members: [Member]
  var timer: Double
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]
  public internal(set) var visible = false

  init(_ fx: Effects, max m: Int) {
    self.fx = fx
    max = Swift.max(1, m)
    limit = m
    members = [Member](repeating: Member(), count: Swift.max(1, m))
    timer = 20 + fx.ctx.random() * 20
    matrices = [Float](repeating: 0, count: Swift.max(1, m) * 16)
  }

  func setLimit(_ k: Int) { limit = Swift.max(0, Swift.min(max, k)) }

  func clear() {
    active = false
    count = 0
    visible = false
  }

  func update(_ dt: Double, _ st: SeaWeatherState, _ focus: V2, _ heli: FxHeli) {
    let random = fx.ctx.random
    let ok = limit > 0 && (st.night ?? 0) < 0.3 && (st.waveHeight ?? 1) < 1.6 && (st.intensity ?? 0) < 0.25 && (st.rain ?? 0) < 0.05
    if !active {
      visible = false
      if !ok || !(dt > 0) { return }
      timer -= dt
      if timer > 0 { return }
      timer = 45 + random() * 40
      // start off one side of the view, cross it, avoid the heli
      let a = random() * JS.PI * 2
      dx = JS.cos(a)
      dz = JS.sin(a)
      let lat = (random() - 0.5) * 70
      x = focus.x - dx * 110 - dz * lat
      z = focus.y - dz * 110 + dx * lat
      if JS.hypot(x - heli.x, z - heli.z) < 40 { x += 60 }
      t = 0
      life = 38
      n = Swift.min(limit, 3 + Int(JS.floor(random() * 3)))
      for i in 0..<n {
        members[i].ox = (random() - 0.5) * 9
        members[i].oz = (random() - 0.5) * 12
        members[i].ph = random() * 6.28
        members[i].was = false
      }
      active = true
    }
    if dt > 0 {
      t += dt
      x += dx * 6.5 * dt
      z += dz * 6.5 * dt
    }
    if t > life || (!ok && t > 4) {
      active = false
      count = 0
      return
    }
    let heading = JS.atan2(dx, -dz)
    var k = 0
    for i in 0..<n {
      let m = members[i]
      let ph = t * (2 * JS.PI / 2.3) + m.ph
      let s = JS.sin(ph)
      let mx = x + dx * m.oz - dz * m.ox
      let mz = z + dz * m.oz + dx * m.ox
      let sea = fx.seaHeight(mx, mz)
      let y = sea - 0.75 + 1.25 * s
      let above = y > sea - 0.2
      if above != m.was && dt > 0 {
        fx.splash(mx, sea, mz, 0.6)
        members[i].was = above
      }
      if y < sea - 0.9 { continue }
      let pitch = JS.cos(ph) * 0.55
      var q = Quat()
      q.setFromEuler(Euler(pitch, -heading, 0, .YXZ))
      var mat = Mat4()
      mat.compose(V3(mx, y, mz), q, V3(1, 1, 1))
      writeMatrix(mat, &matrices, k)
      k += 1
    }
    count = k
    visible = k > 0
  }
}

/// Whale [NICE]: a dark back breaks the surface, blows a mist column, cruises, dives (every few minutes).
public final class Whale {
  unowned let fx: Effects
  public internal(set) var allowed: Bool
  public internal(set) var active = false
  var timer: Double
  var t: Double = 0
  var x: Double = 0
  var z: Double = 0
  var dx: Double = 1
  var dz: Double = 0
  var blown = false
  let mist = Color3(1.1, 1.15, 1.2)
  /// the whale mesh (Euler YXZ) and its submerged shade on the water (multiply, uK)
  public internal(set) var visible = false
  public internal(set) var matrix = Mat4()
  public internal(set) var shadeVisible = false
  /// the shade's transform; before the first surfacing its constructor pose (scale 5.6 × 1 × 21 at the origin)
  public internal(set) var shadeMatrix: Mat4 = {
    var m = Mat4()
    m.compose(V3(), Quat(), V3(5.6, 1, 21))
    return m
  }()
  public internal(set) var shadeK: Double = 0

  init(_ fx: Effects, allowed: Bool) {
    self.fx = fx
    self.allowed = allowed
    timer = 50 + fx.ctx.random() * 60
  }

  func setAllowed(_ v: Bool) { allowed = v }

  func clear() {
    active = false
    visible = false
    shadeVisible = false
  }

  func update(_ dt: Double, _ st: SeaWeatherState, _ focus: V2, _ heli: FxHeli) {
    let random = fx.ctx.random
    let calm = (st.intensity ?? 0) < 0.2 && (st.waveHeight ?? 1) < 1.2 && (st.rain ?? 0) < 0.05
    if !active {
      visible = false
      shadeVisible = false
      if !allowed || !calm || !(dt > 0) { return }
      timer -= dt
      if timer > 0 { return }
      timer = 80 + random() * 90
      // somewhere in view, away from the heli
      for _ in 0..<6 {
        let a = random() * JS.PI * 2
        let r = 30 + random() * 45
        x = focus.x + JS.cos(a) * r
        z = focus.y + JS.sin(a) * r * 0.6
        if JS.hypot(x - heli.x, z - heli.z) > 45 { break }
      }
      let h = random() * JS.PI * 2
      dx = JS.sin(h)
      dz = -JS.cos(h)
      t = 0
      blown = false
      active = true
    }
    if dt > 0 {
      t += dt
      x += dx * 1.8 * dt
      z += dz * 1.8 * dt
    }
    let k = t / fx.tables.surfaceT
    if k >= 1 {
      active = false
      visible = false
      shadeVisible = false
      return
    }
    let sea = fx.seaHeight(x, z)
    // rise (0–.18), cruise with a gentle roll (.18–.7), dive: pitch down, flukes up (.7–1)
    var y: Double, pitch: Double
    if k < 0.18 {
      let u = k / 0.18
      y = sea - 3.2 + 2.75 * u * u * (3 - 2 * u)
      pitch = 0.12 * (1 - u)
    } else if k < 0.7 {
      y = sea - 0.45 + 0.12 * JS.sin(t * 0.9)
      pitch = 0.02 * JS.sin(t * 0.7)
    } else {
      let u = (k - 0.7) / 0.3
      pitch = -0.75 * JS.sin(JS.min(1, u * 1.3) * JS.PI * 0.5)
      y = sea - 0.45 - 4.5 * u * u
    }
    let e = Euler(pitch, -JS.atan2(dx, -dz), 0.04 * JS.sin(t * 0.6), .YXZ)
    var q = Quat()
    q.setFromEuler(e)
    matrix.compose(V3(x, y, z), q, V3(1, 1, 1))
    visible = true
    // the submerged body read through the water: strongest just under the surface
    shadeVisible = true
    var qs = Quat()
    qs.setFromEuler(Euler(0, e.y, 0, .XYZ))
    shadeMatrix.compose(V3(x, sea + 0.15, z), qs, V3(5.6, 1, 21))
    shadeK = FxMath.smooth(-4.5, -1.2, y - sea) * (1 - FxMath.smooth(0.82, 1, k)) * 0.8
    if dt > 0 {
      // the blow: a translucent, ragged mist column drifting downwind (not a white ball), no splash ring
      if !blown && k > 0.22 {
        blown = true
        let sm = fx.pools.smoke
        let hx = x + dx * 4.0
        let hz = z + dz * 4.0
        for _ in 0..<14 {
          let s0 = 0.6 + 1.2 * random()
          sm.emit(fx.t, hx + (random() - 0.5) * 0.8, sea + 1 + random() * 2, hz + (random() - 0.5) * 0.8,
                  (random() - 0.5) * 1.4, 4 + 5 * random(), (random() - 0.5) * 1.4,
                  2.2 + 1.6 * random(), s0, s0 * (3 + 2.5 * random()), mist, 0.07 + 0.08 * random(), mist, fx.tables.blow)
        }
      }
      if k > 0.15 && k < 0.85 { fx.ctx.ocean?.seaWake(x, z, 0.8, dx, dz) }
    }
  }
}
