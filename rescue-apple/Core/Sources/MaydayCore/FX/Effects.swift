// systems/fx.js — Effects: FX & AIR & LIFE (CONTRACT «fx»; DESIGN §2.7.3–2.7.4, §2.11–§2.13, §2.15, §8.2),
// the simulation side: the particle API other systems use and everything that spawns into the three pools,
// the pooled lights, flares and rockets, impact stars, the gull hint flock and the marine life. The output is
// plain data for MaydayRender's FxRenderer: pool attributes (+ upload ranges), glows, rings, heat spheres,
// gull / dolphin / whale transforms, the 4 physical lights and the shared air uniforms (FxAirUniforms).
//
// Public API (CONTRACT + extras): splash(x, y, z, size), spray(x, z, dir, amount), smoke(x, y, z, color,
// amount, opts?), sparks(x, y, z, color, amount), flare(x, z, …) → FxFlare, burst(name, at, …),
// acquireLight(color, intensity, distance) → LightHandle, bolt(x, z, strength), steam(x, y, z, amount),
// clear(), seaHeight(x, z), flares, rockets, gulls, stats.
//
// Port notes: Math.random is ctx.random (shared with survivors and the heli) and every draw happens in the
// web's order — argument lists left to right, the pools' default rotation before the spin draw — so
// Tests/Vectors/fx/*.json match bit for bit. Not ported here (render-only, no random draws): rain, scud /
// fog layers / glory, gust streaks, jellyfish (the renderer's FX layers). The lightning ribbons
// (fx/lightning.js, M6) are not ported either: bolt() spawns its stars, rings, steam, spray, sparks and ground
// glow, but not the ribbon geometry (whose segments draw Math.random — after a strike the cosmetic stream
// differs from the web's until M6).

/// The heli as fx reads it (fx.heli).
public struct FxHeli: Equatable, Sendable {
  public var x: Double = 0
  public var y: Double = 40
  public var z: Double = 0
  public var alt: Double = 40
  public var alive = false
  public var rpm: Double = 1
  public var vx: Double = 0
  public var vz: Double = 0
}

/// fx/common.js createAirUniforms(): the "air lighting" every scattering medium reads.
public struct FxAirUniforms: Equatable, Sendable {
  /// ambient light on scattering media (linear)
  public var airAmb = Color3(0.2, 0.22, 0.24)
  /// sun / moon colour × intensity
  public var airSun = Color3(0, 0, 0)
  public var airSunDir = V3(0, 1, 0)
  /// flash colour × flash
  public var airFlash = Color3(0, 0, 0)
  public var airNight: Double = 0
  /// searchlight origin xyz, w = level 0..1
  public var beamPos = V4(0, 0, 0, 0)
  /// dir xyz, w = cos(outer)
  public var beamDir = V4(0, -1, 0, 0.97)
  public var beamLen: Double = 30
  /// pooled PointLights: xyz, w = intensity (cd) / rgb, w = range (m)
  public var fxLightPos = [V4](repeating: V4(), count: 4)
  public var fxLightCol = [V4](repeating: V4(), count: 4)
  /// fx clock (game seconds; frozen while paused)
  public var fxTime: Double = 0
  /// particles born before this time are dead (mission reset)
  public var killBefore: Double = -1
  /// heli xyz, w = alive
  public var heliP = V4(0, 40, 0, 0)
  /// x, z, radius, strength
  public var downwash = V4(0, 0, 9, 0)
  public var seaLevel: Double = 0
  public var hs: Double = 0.4
}

/// smoke(…, opts): { life, size: [s0, s1], rise, alpha, kind: 'signal' | 'damage' | 'generic' | 'steam' }
public struct SmokeOptions: Equatable, Sendable {
  public var life: Double?
  public var size0: Double?
  public var size1: Double?
  public var rise: Double?
  public var alpha: Double?
  public var kind: String?

  public init(life: Double? = nil, size0: Double? = nil, size1: Double? = nil, rise: Double? = nil, alpha: Double? = nil, kind: String? = nil) {
    self.life = life
    self.size0 = size0
    self.size1 = size1
    self.rise = rise
    self.alpha = alpha
    self.kind = kind
  }
}

public final class Effects: GameSystem {
  public let tables: FxTables
  public let ctx: SeaContext
  public internal(set) var t: Double = 0
  public internal(set) var quality: String
  public internal(set) var cfg: FxBudget
  public internal(set) var air = FxAirUniforms()

  // ---- pools, lights, signals, life ------------------------------------------------------------------
  public let lightPool: LightPool
  public let pools: (spray: ParticlePool, smoke: ParticlePool, glow: ParticlePool)
  public internal(set) var glows: FxGlowInstances
  public internal(set) var rings: FxRings
  public private(set) var signals: FxSignals!
  public private(set) var gulls: GullFlocks!
  public private(set) var dolphins: Dolphins!
  public private(set) var whale: Whale!

  // ---- state ---------------------------------------------------------------------------------------------
  /// the world point under the screen centre (x, z)
  public internal(set) var focus = V2()
  public internal(set) var heli = FxHeli()
  /// downwash: x, z, radius, strength
  public internal(set) var dw = Downwash()
  /// the mean wind (look.uWind)
  public internal(set) var wind = V2()
  public internal(set) var camPos = V3()
  /// timed impact stars {x, y, z, t, life, I}
  struct Star {
    var x: Double, y: Double, z: Double
    var t: Double
    var life: Double
    var I: Double
    var reduced: Bool
  }
  var stars: [Star] = []
  struct TimedLight {
    let handle: LightHandle
    var t: Double
    var life: Double
    var peak: Double
    var reduced: Bool
  }
  var timedLights: [TimedLight] = []
  /// smoke emitter coalescing slots
  struct Emitter {
    var x: Double = 0
    var z: Double = 0
    var kind: Int = 0
    var lastT: Double = -99
    var budget: Double = 0
    var acc: Double = 0
  }
  var emitters = [Emitter](repeating: Emitter(), count: 24)
  public internal(set) var emittedTotal = 0
  struct Acc {
    var dw: Double = 0
    var dwHaze: Double = 0
    var bio: Double = 0
    var crest: Double = 0
    var hail: Double = 0
    var hailShake: Double = 0
  }
  var acc = Acc()
  var ringH = [Float](repeating: 0, count: 8)
  let colors = FxColorCache()
  let sprayCol: Color3
  let bioCol: Color3
  let steamCol: Color3
  let starCol = Color3(style: "#FFFFFF")
  let haloCol: Color3
  let orange: Color3
  let orangeEnd: Color3
  /// weather.state when there is no weather
  let fallbackSt = SeaWeatherState(night: 0, intensity: 0, rain: 0, waveHeight: 0.5, windDir: V2(1, 0), windSpeed: 3, flash: 0, palette: SeaPalette())
  private var subs: [EventSubscription] = []

  public init(tables: FxTables, ctx: SeaContext) {
    self.tables = tables
    self.ctx = ctx
    quality = tables.qualityName(ctx.settings.get("quality").string)
    cfg = tables.quality[quality] ?? tables.high
    let high = tables.high
    lightPool = LightPool(physical: tables.physicalLights, hysteresis: tables.hysteresis)
    pools = (ParticlePool(name: "spray", kind: "spray", maxCapacity: high.downwash + high.crest + high.splash, random: ctx.random),
             ParticlePool(name: "smoke", kind: "smoke", maxCapacity: high.smoke, random: ctx.random),
             ParticlePool(name: "glow", kind: "glow", maxCapacity: high.glow, random: ctx.random))
    glows = FxGlowInstances(max: tables.maxGlows)
    rings = FxRings(max: tables.maxRings)
    sprayCol = tables.color("spray")
    var b = tables.color("bio")
    b.multiplyScalar(4)
    bioCol = b
    steamCol = tables.color("steam")
    haloCol = tables.color("boltHalo")
    orange = tables.color("smokeOrange")
    orangeEnd = tables.color("smokeOrangeEnd")
    // construction order of the web: signals, gulls (3 draws per bird), dolphins (timer), jellies, whale (timer)
    signals = FxSignals(self)
    gulls = GullFlocks(self, maxBirds: high.gulls)
    dolphins = Dolphins(self, max: high.dolphins)
    whale = Whale(self, allowed: true)
    applyQuality(quality)

    let ev = ctx.events
    subs.append(ev.on(GameEvent.WeatherLightning.self) { [unowned self] e in self.onLightning(e) })
    subs.append(ev.on(GameEvent.MissionSetup.self) { [unowned self] _ in self.clear() })
    subs.append(ev.on(GameEvent.HazardWarning.self) { [unowned self] e in
      self.scare(type: e.type, position: e.hazard.flatMap { self.ctx.hazards?.hazardPosition($0) } ?? e.position)
    })
    subs.append(ev.on(GameEvent.HazardSpawn.self) { [unowned self] e in
      self.scare(type: e.type, position: self.ctx.hazards?.hazardPosition(e.hazard))
    })
  }

  deinit {
    for s in subs { s.off() }
  }

  func scare(type t: String, position p: V3?) {
    if let p, t == "waterspout" || t == "tornado" || t == "downburst" || t == "hail" { gulls.scare(p.x, p.z, 520) }
  }

  // ---------------------------------------------------------------------------------------------
  /// Quality (DESIGN §8.2); the host calls it on settings.onChange('quality') with qualityOf(settings).
  public func applyQuality(_ q: String) {
    quality = q
    let c = tables.quality[q] ?? tables.high
    cfg = c
    pools.spray.setCapacity(c.downwash + c.crest + c.splash)
    pools.smoke.setCapacity(c.smoke)
    pools.glow.setCapacity(c.glow)
    gulls.setLimit(c.gulls)
    dolphins.setLimit(c.dolphins)
    whale.setAllowed(c.dolphins > 0)
  }

  /// qualityOf(settings) after a settings change.
  public func settingsChanged() { applyQuality(tables.qualityName(ctx.settings.get("quality").string)) }

  // ---------------------------------------------------------------------------------------------
  // Public API (CONTRACT)

  /// Droplet burst (boat slams, water strikes, raft drops, dolphins). y nil / non-finite → the sea height.
  public func splash(_ x: Double, _ y: Double?, _ z: Double, _ size: Double = 2) {
    if !(x + z).isFinite { return }
    let s = JS.max(0.3, JS.min(14, JSNumber.isTruthy(size) ? size : 2))
    let sea = (y.map { $0.isFinite } ?? false) ? y ?? 0 : seaHeight(x, z)
    let sp = pools.spray
    let random = ctx.random
    let n = Int(JS.min(64, JS.round(8 + s * 5)))
    let k = JS.sqrt(s / 2)
    let P = tables.preset("droplet")
    for _ in 0..<max(0, n) {
      let a = random() * JS.PI * 2
      let rad = (0.6 + 2.2 * random()) * k
      let up = (3 + 5 * random()) * JS.min(2.2, k)
      let sz = (0.35 + 0.5 * random()) * JS.min(2.2, k)
      sp.emit(t, x + JS.cos(a) * 0.3 * s, sea + 0.2, z + JS.sin(a) * 0.3 * s, JS.cos(a) * rad, up, JS.sin(a) * rad,
              0.6 + 0.8 * random(), sz, sz * 2.6, sprayCol, 0.55, sprayCol, P)
    }
    let mists = Int(JS.min(6, 1 + JS.round(s * 0.5)))
    let M = tables.preset("mist")
    for _ in 0..<max(0, mists) {
      let a = random() * JS.PI * 2
      sp.emit(t, x + JS.cos(a) * s * 0.4, sea + 0.4, z + JS.sin(a) * s * 0.4, JS.cos(a) * 1.5, 1.2 + random(), JS.sin(a) * 1.5,
              1.2 + random(), 0.8 * s, 2.6 * s, sprayCol, 0.22, sprayCol, M)
    }
    bioBurst(x, sea, z, Double(n) * 0.4, 3 * k)
  }

  /// Spray sheet from the water surface along dir (zero / nil → radial).
  public func spray(_ x: Double, _ z: Double, _ dir: V2?, _ amount: Double = 10) {
    if !(x + z).isFinite { return }
    let nd = JS.min(70, JS.max(0, JS.round(JSNumber.isTruthy(amount) ? amount : 0)))
    let n = nd.isFinite ? Int(nd) : 0
    if n == 0 { return }
    // fx owns the downwash ring itself (DESIGN §2.13): small spray calls ON the active ring are absorbed
    if dw.strength > 0.02 && n <= 4 {
      let d = JS.hypot(x - dw.x, z - dw.z)
      if d > dw.radius * 0.55 && d < dw.radius * 1.5 { return }
    }
    let sea = seaHeight(x, z)
    var dx = dir?.x ?? 0
    var dz = dir?.y ?? 0
    let dl = JS.hypot(dx, dz)
    let radial = dl < 1e-3
    if !radial {
      dx /= dl
      dz /= dl
    }
    let sp = pools.spray
    let random = ctx.random
    let P = tables.preset("dwSpray")
    for _ in 0..<n {
      var vx: Double, vz: Double
      if radial {
        let a = random() * JS.PI * 2
        let v = 4 + 8 * random()
        vx = JS.cos(a) * v
        vz = JS.sin(a) * v
      } else {
        let v = 6 + 7 * random()
        let sd = (random() - 0.5) * 0.7
        vx = (dx - dz * sd) * v
        vz = (dz + dx * sd) * v
      }
      let sz = 0.5 + 0.5 * random()
      sp.emit(t, x + (random() - 0.5), sea + 0.3, z + (random() - 0.5), vx, 1.5 + 3 * random(), vz,
              0.8 + 0.7 * random(), sz, 2.5 + random(), sprayCol, 0.42, sprayCol, P)
    }
    bioBurst(x, sea, z, Double(n) * 0.3, 6)
  }

  /// Smoke emitter tick. `amount` = puffs this call (fractions accumulate); repeated calls from the same spot
  /// are rate-limited, so per-frame callers are safe. Colour picks the behaviour: signal orange → survivor
  /// day smoke, dark grey / black → damage smoke swirled by the downwash, anything else → generic smoke.
  public func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ amount: Double, options opts: SmokeOptions?) {
    if !(x + y + z).isFinite { return }
    let c = colors.color(color)
    let kind = opts?.kind ?? (FxMath.isOrange(c) ? "signal" : FxMath.lum(c) < 0.05 ? "damage" : "generic")
    let kindId = kind == "signal" ? 1 : kind == "damage" ? 2 : kind == "steam" ? 3 : 4
    let maxRate: Double = kind == "signal" ? 12 : kind == "damage" ? 16 : 12
    let si = emitter(x, z, kindId)
    emitters[si].budget = JS.min(3, emitters[si].budget + (t - emitters[si].lastT) * maxRate)
    emitters[si].lastT = t
    // signal smoke: fewer, bigger puffs read as billows instead of a smooth tube
    emitters[si].acc += JS.max(0, JSNumber.isTruthy(amount) ? amount : 0) * (kind == "signal" ? 0.6 : 1)
    var guardN = 8
    while emitters[si].acc >= 1 && emitters[si].budget >= 1 && guardN > 0 {
      guardN -= 1
      emitters[si].acc -= 1
      emitters[si].budget -= 1
      smokePuff(pools.smoke, kind, x, y, z, c, opts)
    }
    if emitters[si].acc > 4 { emitters[si].acc = 4 }
  }

  func emitter(_ x: Double, _ z: Double, _ kind: Int) -> Int {
    var oldest = -1
    for (i, e) in emitters.enumerated() {
      if e.kind == kind && t - e.lastT < 0.8 && JS.abs(e.x - x) < 4 && JS.abs(e.z - z) < 4 {
        emitters[i].x = x
        emitters[i].z = z
        return i
      }
      if oldest < 0 || e.lastT < emitters[oldest].lastT { oldest = i }
    }
    emitters[oldest].kind = kind
    emitters[oldest].x = x
    emitters[oldest].z = z
    emitters[oldest].lastT = t - 0.12
    emitters[oldest].budget = 1
    emitters[oldest].acc = 0
    return oldest
  }

  func smokePuff(_ pool: ParticlePool, _ kind: String, _ x: Double, _ y: Double, _ z: Double, _ c: Color3, _ opts: SmokeOptions?) {
    let random = ctx.random
    let j = { random() - 0.5 }
    switch kind {
    case "signal":
      // survivor's orange day smoke: dense saturated orange at the canister, billowing out into a wide pale
      // plume downwind; per-puff random size (and rotation): a billowing plume, not a string of equal balls
      let s0 = (opts?.size0 ?? 0.9) * (0.6 + 0.8 * random())
      let s1 = opts?.size1 ?? 10
      let v = 0.9 + 0.2 * random()
      let px = x + j() * 0.4
      let pz = z + j() * 0.4
      let vx = j() * 1.3
      let vy = opts?.rise ?? 1.5
      let vz = j() * 1.3
      let life = opts?.life ?? 9 + 4 * random()
      let sz1 = s1 * (0.8 + 0.5 * random())
      var col = orange
      col.lerp(c, 0.5)
      col.multiplyScalar(v)
      pool.emit(t, px, y + 0.3, pz, vx, vy, vz, life, s0, sz1, col, opts?.alpha ?? 0.42, orangeEnd, tables.preset("signalSmoke"))
    case "damage":
      // exhaust smoke: inherits a little of the heli's motion, then the downwash takes it
      let h = heli
      let near = JS.hypot(x - h.x, z - h.z) < 8
      let black = FxMath.lum(c) < 0.01
      let px = x + j() * 0.3
      let pz = z + j() * 0.3
      let vx = (near ? h.vx * 0.3 : 0) + j()
      let vy = 0.4 + random() * 0.6
      let vz = (near ? h.vz * 0.3 : 0) + j()
      let life = opts?.life ?? 3 + 1.2 * random()
      let s0 = opts?.size0 ?? 0.9
      let s1 = opts?.size1 ?? 5.5 + 2 * random()
      var col = c
      col.multiplyScalar(black ? 1 : 1.2)
      var col2 = c
      col2.lerp(steamCol, 0.25)
      pool.emit(t, px, y, pz, vx, vy, vz, life, s0, s1, col, opts?.alpha ?? (black ? 0.72 : 0.55), col2, tables.preset("damageSmoke"))
    case "steam":
      let px = x + j() * 2
      let pz = z + j() * 2
      let vx = j()
      let vy = 2 + random()
      let vz = j()
      let life = opts?.life ?? 3 + 1.5 * random()
      let s0 = opts?.size0 ?? 2
      let s1 = opts?.size1 ?? 8 + 3 * random()
      pool.emit(t, px, y + 0.5, pz, vx, vy, vz, life, s0, s1, steamCol, opts?.alpha ?? 0.34, steamCol, tables.preset("steam"))
    default:
      let px = x + j() * 0.5
      let pz = z + j() * 0.5
      let vx = j() * 0.6
      let vy = opts?.rise ?? 1 + random() * 0.6
      let vz = j() * 0.6
      let life = opts?.life ?? 5 + 2 * random()
      let s0 = opts?.size0 ?? 1.2
      let s1 = opts?.size1 ?? 7 + 3 * random()
      var col2 = c
      col2.lerp(steamCol, 0.35)
      pool.emit(t, px, y + 0.2, pz, vx, vy, vz, life, s0, s1, c, opts?.alpha ?? 0.45, col2, tables.preset("smoke"))
    }
  }

  /// Additive sparks (embers, damage sparks, rig flare, impact).
  public func sparks(_ x: Double, _ y: Double, _ z: Double, _ color: String = "#FFB050", _ amount: Double = 6) {
    if !(x + y + z).isFinite { return }
    let nd = JS.min(48, JS.max(0, JS.round(JSNumber.isTruthy(amount) ? amount : 0)))
    let n = nd.isFinite ? Int(nd) : 0
    var c = colors.color(color)
    c.multiplyScalar(7)
    let g = pools.glow
    let random = ctx.random
    let P = tables.preset("spark")
    for _ in 0..<n {
      let a = random() * JS.PI * 2
      let e = random() * 0.9 + 0.1
      let v = 3 + 7 * random()
      g.emit(t, x, y, z, JS.cos(a) * v * (1 - e * 0.5), v * e + 1.5, JS.sin(a) * v * (1 - e * 0.5), 0.3 + 0.6 * random(), 0.1, 0.06, c, 1, c, P)
    }
  }

  /// Marker flare on the water (or in a hand): burns ~40 s (pooled red light, flicker, smoke, sparks).
  @discardableResult
  public func flare(_ x: Double, _ z: Double, life: Double?, held: Bool, lift: Double?) -> FxFlare? {
    if !(x + z).isFinite { return nil }
    return signals.flare(x, z, life: life, held: held, lift: lift)
  }

  /// burst('rocket' | 'flare' | 'splash' | 'spray' | 'sparks' | 'smoke' | 'steam' | 'strike' | 'bolt' |
  /// 'lightning' | 'spider' | 'crash', at, opts). `at` nil = under the heli; y nil / non-finite = sea height.
  @discardableResult
  public func burst(_ name: String, _ at: V3?, color: String? = nil, size: Double? = nil, amount: Double? = nil, dir: V2? = nil,
                    strength: Double? = nil, lens: Bool? = nil, smoke: SmokeOptions? = nil) -> AnyObject? {
    let p = at ?? V3(heli.x, 0, heli.z)
    let x = p.x
    let z = p.z
    let y = p.y.isFinite ? p.y : seaHeight(x, z)
    switch name {
    case "rocket":
      return signals.rocket(x, y, z, color: color, lens: lens)
    case "flare":
      return flare(x, z, life: nil, held: false, lift: nil)
    case "splash":
      splash(x, y, z, size ?? 2)
    case "spray":
      spray(x, z, dir, amount ?? 20)
    case "sparks":
      sparks(x, y, z, color ?? "#FFB050", amount ?? 12)
    case "smoke":
      let c = colors.color(color ?? "#9A9A9A")
      let n = amount ?? 6
      var i = 0.0
      while i < n {
        smokePuff(pools.smoke, smoke?.kind ?? "generic", x, y, z, c, smoke)
        i += 1
      }
    case "steam":
      steam(x, y, z, amount ?? 8)
    case "strike", "bolt", "lightning":
      bolt(x, z, strength ?? 1)
    case "spider":
      break // in-cloud spiders are ribbons only (fx/lightning.js, M6)
    case "crash":
      splash(x, y, z, size ?? 8)
      spray(x, z, nil, 60)
    default:
      splash(x, y, z, size ?? 1.5)
    }
    return nil
  }

  public func steam(_ x: Double, _ y: Double, _ z: Double, _ amount: Double = 8) {
    let n = JS.min(24, JS.round(amount))
    var i = 0.0
    while i < n {
      smokePuff(pools.smoke, "steam", x, y, z, steamCol, nil)
      i += 1
    }
  }

  public func acquireLight(_ color: Color3, _ intensity: Double = 0, _ distance: Double = 60) -> LightHandle {
    lightPool.acquire(color, intensity, distance)
  }

  /// Sea strike impact: star, steam, light ring, spray, a 0.3 s ground glow from a pooled light (the
  /// ribbon itself is fx/lightning.js — M6).
  public func bolt(_ x: Double, _ z: Double, _ strength: Double = 1) {
    if !(x + z).isFinite { return }
    let random = ctx.random
    let reduced = ctx.flag("reduceFlashes")
    let sea = seaHeight(x, z)
    camera()
    let k = reduced ? 0.3 : 1
    stars.append(Star(x: x, y: sea + 1.0, z: z, t: 0, life: reduced ? 0.6 : 0.32, I: k * JS.min(1.3, strength), reduced: reduced))
    if stars.count > 6 { stars.removeFirst() }
    rings.spawn(x, z, 14 + 6 * random(), 0.5, haloCol, 0.5 * k)
    // a short, irregular steam burst: a few noise puffs scattered at random, rising and drifting downwind
    let sm = pools.smoke
    let n = 4 + Int(JS.floor(random() * 4))
    let BS = tables.preset("boltSteam")
    for _ in 0..<n {
      let s0 = 1 + 2.5 * random()
      // born just after the return stroke (a negative age hides it), so the flash never lights a white ball
      sm.emit(t + 0.12 + 0.25 * random(), x + (random() - 0.5) * 5, sea + 0.5 + 1.5 * random(), z + (random() - 0.5) * 5,
              (random() - 0.5) * 1.5, 2.5 + 4 * random(), (random() - 0.5) * 1.5,
              1 + 0.9 * random(), s0, s0 * (1.8 + 1.8 * random()), steamCol, 0.12 + 0.16 * random(), steamCol, BS)
    }
    // water thrown up by the strike
    let sp = pools.spray
    let D = tables.preset("droplet")
    for _ in 0..<26 {
      let a = random() * JS.PI * 2
      let v = 2 + 5 * random()
      sp.emit(t, x, sea + 0.3, z, JS.cos(a) * v, 7 + 9 * random(), JS.sin(a) * v, 0.9 + 0.8 * random(), 0.5, 2.2, sprayCol, 0.5, sprayCol, D)
    }
    sparks(x, sea + 0.5, z, "#DCE6FF", 16)
    // 0.3 s ground glow from the pool: lights the water around the impact without burning it white
    let h = acquireLight(haloCol, 0, 90)
    h.position = V3(x, sea + 8, z)
    timedLights.append(TimedLight(handle: h, t: 0, life: reduced ? 0.75 : 0.36, peak: 2200 * k * JS.min(1.3, strength), reduced: reduced))
  }

  /// Reset everything (mission setup).
  public func clear() {
    air.killBefore = t + 1e-4
    signals.clear()
    for l in timedLights { l.handle.release() }
    timedLights.removeAll()
    stars.removeAll()
    rings.clear()
    gulls.clear()
    dolphins.clear()
    whale.clear()
  }

  public func seaHeight(_ x: Double, _ z: Double) -> Double {
    guard let o = ctx.ocean else { return 0 }
    let h = o.heightAt(x, z)
    return h.isFinite ? h : 0
  }

  public var flares: [FxFlare] { signals.flares }
  public var rockets: [FxRocket] { signals.rockets }

  // ---------------------------------------------------------------------------------------------
  func onLightning(_ e: GameEvent.WeatherLightning) {
    if !(e.x.isFinite && e.z.isFinite) { return }
    if !e.cloudOnly { bolt(e.x, e.z, e.strength) } // cloudOnly → spider (ribbons only, M6)
  }

  func camera() {
    guard let cam = ctx.camera else { return }
    cam.updateMatrixWorld()
    let m = cam.matrixWorld
    camPos = V3(m[12], m[13], m[14])
    var fwd = V3(-m[8], -m[9], -m[10])
    fwd.normalize()
    let k = camPos.y / JS.max(-fwd.y, 0.25)
    focus.x = camPos.x + fwd.x * k
    focus.y = camPos.z + fwd.z * k
  }

  func readState() {
    camera()
    var hs = heli
    if let h = ctx.heli?.seaView {
      hs.x = h.position.x
      hs.y = h.position.y
      hs.z = h.position.z
      hs.alt = (h.altitude.map { $0.isFinite } ?? false) ? h.altitude ?? h.position.y : h.position.y
      hs.alive = h.alive
      hs.rpm = h.rotorRPM.flatMap { $0.isFinite ? $0 : nil } ?? 1
      hs.vx = h.velocity?.x ?? 0
      hs.vz = h.velocity?.z ?? 0
      heli = hs
      // downwash: published by the heli, else derived (R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²)
      if let hd = h.downwash, hd.strength.isFinite {
        dw = hd
      } else if hs.alive {
        let s = FxMath.clamp01(1 - (hs.alt - 4) / 28)
        dw.x = hs.x
        dw.z = hs.z
        dw.radius = 9 + 0.35 * JS.max(0, hs.alt)
        dw.strength = s * s * FxMath.clamp01(hs.rpm)
      } else {
        dw.strength = 0
      }
      // no spray from a rotor turning on a high deck
      if h.landed, let py = h.landedPadY, py - seaHeight(hs.x, hs.z) > 4 { dw.strength = 0 }
    } else {
      hs.alive = false
      heli = hs
      dw.strength = 0
    }
  }

  func updateAir(_ st: SeaWeatherState) {
    var a = air
    let p = st.palette ?? SeaPalette()
    let night = FxMath.clamp01(st.night ?? 0)
    a.fxTime = t
    a.airNight = night
    // scattering media are brighter than a Lambert surface under the same light: ambient ×2.2, sun ×1.1
    if let amb = p.ambient {
      a.airAmb = amb
      a.airAmb.multiplyScalar((p.ambientIntensity ?? 0.6) * 2.2)
    } else {
      a.airAmb.setRGB(0.5, 0.54, 0.56)
    }
    let sd = st.sunDirVisual ?? st.sunDir
    let sunY = sd.map { JS.max(0, $0.y) } ?? 0.6
    if let sun = p.sun {
      a.airSun = sun
      a.airSun.multiplyScalar((p.sunIntensity ?? 1) * (0.25 + 0.75 * sunY) * 1.1)
    } else {
      a.airSun.setRGB(0.6, 0.58, 0.55)
    }
    if let sd { a.airSunDir = sd }
    a.airFlash = st.flashColor ?? haloCol
    a.airFlash.multiplyScalar(FxMath.clamp01(st.flash ?? 0))
    // searchlight beam (heli.beam): stronger sparkle at night
    if let beam = ctx.heli?.seaView.beam, beam.on, beam.intensity > 0.01 {
      a.beamPos = V4(beam.origin.x, beam.origin.y, beam.origin.z, beam.intensity * (0.3 + 0.7 * night))
      a.beamDir = V4(beam.dir.x, beam.dir.y, beam.dir.z, beam.cosOuter.isFinite ? beam.cosOuter : 0.97)
      a.beamLen = JSNumber.isTruthy(beam.length) ? beam.length : 30
    } else {
      a.beamPos.w = 0
    }
    a.heliP = V4(heli.x, heli.y, heli.z, heli.alive ? 1 : 0)
    a.downwash = V4(dw.x, dw.z, dw.radius, dw.strength)
    a.hs = st.waveHeight ?? 0.5
    air = a
  }

  // ---------------------------------------------------------------------------------------------
  public func update(_ dt: Double) {
    t += dt
    let st = ctx.weather?.seaState ?? fallbackSt
    readState()
    updateAir(st)

    // mean wind: look.uWind (weather writes it) is what the particle shaders use too
    if let lw = ctx.meanWind?() {
      wind = lw
    } else if let wd = st.windDir {
      wind = V2(wd.x * (st.windSpeed ?? 0), wd.y * (st.windSpeed ?? 0))
    }
    let reduce = ctx.flag("reduceFlashes")
    let night = FxMath.clamp01(st.night ?? 0)

    // emitters, signals, lightning → then the light pool picks its 4 lights for this frame
    glows.begin()
    if dt > 0 {
      downwashSpray(dt, night)
      crestSpray(dt, st)
      hail(dt, st)
    }
    signals.update(dt, wind, reduce, night)
    impacts(dt)
    lightPool.update(focus.x, focus.y, &air)
    rings.update(dt)

    // life
    gulls.update(dt, st, wind, focus, heli)
    dolphins.update(dt, st, focus, heli)
    whale.update(dt, st, focus, heli)

    pools.spray.flush()
    pools.smoke.flush()
    pools.glow.flush()
    emittedTotal = pools.spray.emitted + pools.smoke.emitted + pools.glow.emitted
  }

  /// Downwash spray (DESIGN §2.13 [MUST], signature moment #3): an irregular, roughened disc with mist
  /// blown downwind, flickering with gusts and blade passes — never an evenly spaced crown of petals.
  /// Angles are rejection-sampled from a downwind bias × slowly wandering lobes; most of it is soft round
  /// mist, a minority short droplet streaks, a few large low haze puffs drift downwind. Teal sparks in
  /// bioluminescent water.
  func downwashSpray(_ dt: Double, _ night: Double) {
    if dw.strength < 0.02 || !heli.alive {
      acc.dw = 0
      acc.dwHaze = 0
      return
    }
    let random = ctx.random
    let s = dw.strength
    let t = self.t
    let R = dw.radius
    // blade passes alias into a ragged 3–5 Hz pulse; gust patches thicken the sheet
    let gust = ctx.gustField?(dw.x, dw.z) ?? 0.5
    let pulse = 0.55 + 0.45 * JS.abs(JS.sin(t * 12.7 + JS.sin(t * 3.1))) * (0.7 + 0.3 * JS.sin(t * 2.3))
    acc.dw += (Double(cfg.downwash) / 1.1) * s * pulse * (0.7 + 0.6 * gust) * dt
    acc.dwHaze = JSNumber.or(acc.dwHaze, 0) + (4 + 0.2 * R) * s * (Double(cfg.downwash) / 350) * dt
    let sp = pools.spray
    let bio = night > 0.45 ? FxMath.clamp01(ctx.ocean?.seaBioluminescence ?? 1) * FxMath.smooth(0.45, 0.9, night) : 0
    let wl = JS.hypot(wind.x, wind.y)
    let wx = wl > 0.1 ? wind.x / wl : 0
    let wz = wl > 0.1 ? wind.y / wl : 0
    let skew = FxMath.smooth(1.5, 12, wl) // how hard the cloud leans downwind
    let ph1 = t * 0.35 + 2.5 * JS.sin(t * 0.21) + 3 * gust
    let ph2 = 1.7 - t * 0.5 + JS.sin(t * 0.43)
    var guardN = 64
    // sample the sea on a few ring points once per frame (Float32Array, like the web)
    for i in 0..<8 {
      let a = (Double(i) / 8) * JS.PI * 2
      ringH[i] = Float(seaHeight(dw.x + JS.cos(a) * R, dw.z + JS.sin(a) * R))
    }
    let PM = tables.preset("dwMist")
    let PS = tables.preset("dwSpray")
    let PB = tables.preset("bio")
    while acc.dw >= 1 && guardN > 0 {
      guardN -= 1
      acc.dw -= 1
      var a = 0.0
      var cx = 1.0
      var cz = 0.0
      for _ in 0..<4 {
        a = random() * JS.PI * 2
        cx = JS.cos(a)
        cz = JS.sin(a)
        let down = 0.5 + 0.5 * (cx * wx + cz * wz)
        let lobe = 0.5 + 0.25 * JS.sin(3 * a + ph1) + 0.25 * JS.sin(5 * a + ph2)
        if random() < (1 - 0.65 * skew + 0.65 * skew * down) * (0.12 + 0.88 * lobe * lobe) { break }
      }
      let r = R * (0.75 + 0.5 * random())
      let ri = Int(JS.floor((a / (JS.PI * 2)) * 8 + 0.5)) % 8
      let sea = Double(ringH[ri])
      let px = dw.x + cx * r
      let pz = dw.z + cz * r
      // upwind spray is beaten back by the wind, downwind spray carried further
      let lean = 1 + 0.35 * skew * (cx * wx + cz * wz)
      if random() < 0.85 {
        let v = (2 + 6 * random()) * (0.55 + 0.45 * s) * lean
        let s0 = 0.8 + 1.6 * random() * random()
        sp.emit(t, px, sea + 0.3, pz, cx * v, 0.4 + 2 * random() * s, cz * v,
                0.8 + 1.6 * random(), s0, JS.min(4, s0 * (1.8 + 1.2 * random()) + 0.6), sprayCol,
                (0.035 + 0.1 * random()) * (0.45 + 0.55 * s), sprayCol, PM)
      } else {
        let v = (7 + 6 * random()) * (0.55 + 0.45 * s) * lean
        let s0 = 0.25 + 0.3 * random()
        sp.emit(t, px, sea + 0.25, pz, cx * v, 1.2 + 2.8 * random() * s, cz * v,
                0.35 + 0.4 * random(), s0, s0 * (2 + random()), sprayCol,
                (0.1 + 0.12 * random()) * (0.4 + 0.6 * s), sprayCol, PS)
      }
      if bio > 0.01 {
        acc.bio += 0.75 * bio
        if acc.bio >= 1 {
          acc.bio -= 1
          let vb = (5 + 5 * random()) * (0.55 + 0.45 * s)
          pools.glow.emit(t, px, sea + 0.2, pz, cx * vb, 0.6 + 2 * random(), cz * vb, 0.5 + 0.6 * random(), 0.42, 0.2, bioCol, 0.9, bioCol, PB)
        }
      }
    }
    if acc.dw > 8 { acc.dw = 8 }
    // the misty annulus: big soft puffs low over the water, offset downwind, size ∝ wash radius
    var hg = 4
    let PH = tables.preset("dwHaze")
    while acc.dwHaze >= 1 && hg > 0 {
      hg -= 1
      acc.dwHaze -= 1
      let a = random() * JS.PI * 2
      let r = R * (0.55 + 0.85 * random())
      let px = dw.x + JS.cos(a) * r + wx * R * 0.35 * skew
      let pz = dw.z + JS.sin(a) * r + wz * R * 0.35 * skew
      let v = 1.5 + 2.5 * random()
      let s0 = R * (0.25 + 0.25 * random())
      pools.smoke.emit(t, px, seaHeight(px, pz) + 0.8, pz, JS.cos(a) * v, 0.3 + 0.6 * random(), JS.sin(a) * v,
                       2.2 + 1.8 * random(), s0, s0 * (1.8 + 0.6 * random()), sprayCol, (0.07 + 0.1 * random()) * s, sprayCol, PH)
    }
    if acc.dwHaze > 3 { acc.dwHaze = 3 }
  }

  /// Bioluminescent sparks for any splash at night.
  func bioBurst(_ x: Double, _ y: Double, _ z: Double, _ n: Double, _ v: Double) {
    let night = air.airNight
    if night < 0.45 { return }
    let random = ctx.random
    let bio = FxMath.clamp01(ctx.ocean?.seaBioluminescence ?? 1) * FxMath.smooth(0.45, 0.9, night)
    let m = JS.min(24, JS.round(n * bio))
    let PB = tables.preset("bio")
    var i = 0.0
    while i < m {
      let a = random() * JS.PI * 2
      let s = v * (0.3 + 0.7 * random())
      pools.glow.emit(t, x, y + 0.2, z, JS.cos(a) * s, 0.5 + 2 * random(), JS.sin(a) * s, 0.5 + 0.7 * random(), 0.42, 0.2, bioCol, 0.9, bioCol, PB)
      i += 1
    }
  }

  /// Crest spray (DESIGN §2.13 [SHOULD]): in strong wind, N height probes per frame inside the view; crests
  /// higher than ≈ 0.35·Hs above the mean tear spray sheets downwind.
  func crestSpray(_ dt: Double, _ st: SeaWeatherState) {
    let probes = cfg.crestProbes
    let Hs = st.waveHeight ?? 0
    let ws = st.windSpeed ?? 0
    guard probes > 0, Hs >= 2.2, ws >= 12, let ocean = ctx.ocean else { return }
    let random = ctx.random
    let strength = FxMath.smooth(12, 22, ws) * FxMath.smooth(2.2, 5, Hs)
    acc.crest = JS.min(40, acc.crest + (Double(cfg.crest) / 1.6) * strength * dt)
    if acc.crest < 4 { return }
    let camY = JS.max(40, camPos.y)
    let halfH = camY * JS.tan(20 * (JS.PI / 180)) * 1.05
    let halfW = halfH * (JSNumber.or(ctx.camera?.aspect, 1.78))
    let thr = 0.35 * Hs
    let wlr = JS.hypot(wind.x, wind.y)
    let wl = JSNumber.isTruthy(wlr) ? wlr : 1
    let wx = wind.x / wl
    let wz = wind.y / wl
    let sp = pools.spray
    let P = tables.preset("crest")
    var i = 0
    while i < probes && acc.crest >= 4 {
      i += 1
      let x = focus.x + (random() * 2 - 1) * halfW
      let z = focus.y + (random() * 2 - 1) * halfH
      let h = ocean.heightAt(x, z)
      if !(h > thr) { continue }
      let n = 5 + Int(JS.floor(random() * 5))
      for _ in 0..<n {
        let lat = (random() - 0.5) * 9
        let v = ws * (0.45 + 0.4 * random())
        let sz = 0.8 + 0.6 * random()
        sp.emit(t, x - wz * lat, h + 0.2, z + wx * lat, wx * v, 1.5 + 2.5 * random(), wz * v,
                1.1 + 0.9 * random(), sz, 3.5 + 2 * random(), sprayCol, 0.28 + 0.15 * random(), sprayCol, P)
      }
      acc.crest -= Double(n)
    }
  }

  /// Hail [NICE]: bounces off the water around the focus and a light ticking micro-shake.
  func hail(_ dt: Double, _ st: SeaWeatherState) {
    let hail = FxMath.clamp01(st.hail ?? 0)
    if hail < 0.02 { return }
    let random = ctx.random
    acc.hail += 70 * hail * dt
    let sp = pools.spray
    let c = Color3(1.6, 1.65, 1.7)
    let camY = JS.max(40, camPos.y)
    let half = camY * 0.45
    let P = tables.preset("hail")
    while acc.hail >= 1 {
      acc.hail -= 1
      let x = focus.x + (random() * 2 - 1) * half
      let z = focus.y + (random() * 2 - 1) * half
      let sea = seaHeight(x, z)
      let a = random() * JS.PI * 2
      sp.emit(t, x, sea + 0.15, z, JS.cos(a) * 1.5, 2.5 + 2 * random(), JS.sin(a) * 1.5, 0.45, 0.14, 0.12, c, 0.9, c, P)
    }
    acc.hailShake -= dt
    if acc.hailShake <= 0 && hail > 0.25 {
      acc.hailShake = 0.22 + random() * 0.2
      ctx.cameraShake?(0.05 * hail, 0.12)
    }
  }

  /// Lightning impact stars + short ground glows.
  func impacts(_ dt: Double) {
    var i = stars.count - 1
    while i >= 0 {
      stars[i].t += dt
      let s = stars[i]
      if s.t >= s.life {
        stars.remove(at: i)
        i -= 1
        continue
      }
      let e = s.reduced ? FxMath.softEnvelope(s.t) : FxMath.strokeEnvelope(s.t)
      // a small, very hot core (no orb, no star rays): bloom does the glow
      glows.add(s.x, s.y, s.z, 1.0, starCol, 3.5 * e * s.I, 2.4, haloCol, 0.08 * e * s.I, 0, 0)
      i -= 1
    }
    var j = timedLights.count - 1
    while j >= 0 {
      timedLights[j].t += dt
      let l = timedLights[j]
      if l.t >= l.life {
        l.handle.release()
        timedLights.remove(at: j)
        j -= 1
        continue
      }
      let e = l.reduced ? FxMath.softEnvelope(l.t) : FxMath.strokeEnvelope(l.t) * (1 - FxMath.smooth(l.life * 0.6, l.life, l.t))
      l.handle.set(l.peak * e)
      j -= 1
    }
  }
}

// ---- the sinks other systems call -----------------------------------------------------------------------

extension Effects: SeaFxSink {
  public func splash(_ x: Double, _ y: Double, _ z: Double, _ size: Double) { splash(x, Optional(y), z, size) }

  public func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ amount: Double) { smoke(x, y, z, color, amount, options: nil) }

  public func flare(_ x: Double, _ z: Double, life: Double?, held: Bool) -> FxFlare? { flare(x, z, life: life, held: held, lift: nil) }

  public func rocketBurst(_ at: V3, color: String) { burst("rocket", at, color: color) }
}

extension Effects: FxSink {
  public func spray(_ x: Double, _ z: Double, _ dir: V2, _ count: Double) { spray(x, z, Optional(dir), count) }

  public func flare(_ x: Double, _ z: Double) { _ = flare(x, z, life: nil, held: false, lift: nil) }

  public func burstRocket(_ at: V3, color: String) -> Bool {
    burst("rocket", at, color: color)
    return true
  }
}
