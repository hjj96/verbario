// Gust fronts (systems/weather/gusts.js; DESIGN §3.12 «Порыв», §3.13 frequencies).
//
// A front is a 140 m sin² band × 500 m gaussian taper of extra wind that travels at W + G along a
// direction within ±20° of the wind. It is spawned upwind so that it reaches the heli in `eta` s (6 s by
// default, +1 s on cadet) and is announced with `weather:gust` — the same records feed look.setFronts (the
// "cat's paws" drawn by the ocean) and WeatherSim.windAt (what pushes the heli).
//
// The web pools MAX record objects and keeps `active`, a list of references into the pool, in spawn
// order. Here the pool is an array of structs and `activeSlots` holds pool indices in the same order, so
// the recycling rule (oldest by age, later one on a tie) and the per-frame splice order are identical.
// RNG draws (the weather's shared mulberry32) happen in the same order as the JS.

public final class GustFronts {
  /// One pooled front record (gusts.js `pool[i]`).
  public struct Front: Equatable, Sendable {
    public var x: Double = 0
    public var z: Double = 0
    public var dirX: Double = 1
    public var dirZ: Double = 0
    public var strength: Double = 0 // baseStrength × fade
    public var baseStrength: Double = 0
    public var width: Double
    public var length: Double
    public var eta: Double = 0 // s until the band's centre reaches the heli (0 once past)
    public var speed: Double = 0
    public var harmless = false
    public var age: Double = 0
    public var fade: Double = 0
    public var alive = false
  }

  /// spawn() options (`{ strength = 8, dir, eta = 6, harmless = false }`).
  public struct SpawnOptions: Sendable {
    public var strength: Double
    public var dir: V2?
    public var eta: Double
    public var harmless: Bool

    public init(strength: Double = 8, dir: V2? = nil, eta: Double = 6, harmless: Bool = false) {
      self.strength = strength
      self.dir = dir
      self.eta = eta
      self.harmless = harmless
    }
  }

  let tables: WeatherTables
  let rng: Rng
  /// ctx.settings (cadet difficulty adds 1 s to every telegraph).
  weak var settings: GameSettings?

  public private(set) var pool: [Front]
  /// `active`: pool indices of the live fronts, in spawn order (weather.state.gustFronts).
  public private(set) var activeSlots: [Int] = []
  /// Seconds until the next random front.
  public private(set) var timer: Double = 8

  init(tables: WeatherTables, rng: Rng, settings: GameSettings?) {
    self.tables = tables
    self.rng = rng
    self.settings = settings
    pool = [Front](repeating: Front(width: tables.gustWidth, length: tables.gustLength), count: tables.gustMax)
  }

  /// The live fronts in `active` order (copies).
  public var active: [Front] { activeSlots.map { pool[$0] } }

  /// The live fronts as look.setFronts / the ocean read them.
  public var lookFronts: [GustFront] {
    activeSlots.map { i in
      let f = pool[i]
      return GustFront(x: f.x, z: f.z, dirX: f.dirX, dirZ: f.dirZ, strength: f.strength, width: f.width, length: f.length)
    }
  }

  public func reset() {
    for i in pool.indices { pool[i].alive = false }
    activeSlots.removeAll()
    timer = 8 + rng.next() * 6
  }

  /// Spawn a front so it reaches (hx, hz) after `eta` seconds. windDir: unit (towards), windSpeed: m/s
  /// mean. Returns the pool slot of the front (the web returns the record; it is never null).
  @discardableResult
  public func spawn(_ hx: Double, _ hz: Double, _ windDir: V2, _ windSpeed: Double, _ opts: SpawnOptions = SpawnOptions()) -> Int {
    var eta = opts.eta
    // cadet difficulty: every telegraph gets +1 s (DESIGN §3.17) — the front starts further upwind
    if settings?.string("difficulty") == "cadet" { eta += 1 }
    var slot = -1
    for i in pool.indices where !pool[i].alive {
      slot = i
      break
    }
    if slot < 0 {
      // Recycle the oldest front (it is far past the heli by now): reduce((a, b) => a.age > b.age ? a : b).
      var best = activeSlots[0]
      for k in 1..<activeSlots.count {
        let b = activeSlots[k]
        best = pool[best].age > pool[b].age ? best : b
      }
      if let at = activeSlots.firstIndex(of: best) { activeSlots.remove(at: at) }
      slot = best
    }
    var dir: V2
    if let d = opts.dir, d.lengthSq > 1e-6 {
      dir = d
      dir.normalize()
    } else {
      let a = (rng.next() * 2 - 1) * MathUtils.degToRad(20)
      let c = JS.cos(a), s = JS.sin(a)
      dir = V2(windDir.x * c - windDir.y * s, windDir.x * s + windDir.y * c)
    }
    let speed = JS.max(4, windSpeed + opts.strength)
    let dist = speed * eta
    let lat = (rng.next() * 2 - 1) * 60 // not always dead centre — still well inside the 500 m taper
    var f = pool[slot]
    f.dirX = dir.x
    f.dirZ = dir.y
    f.x = hx - f.dirX * dist - f.dirZ * lat
    f.z = hz - f.dirZ * dist + f.dirX * lat
    f.baseStrength = opts.strength
    f.strength = 0
    f.speed = speed
    f.eta = eta
    f.harmless = opts.harmless
    f.age = 0
    f.fade = 0
    f.alive = true
    pool[slot] = f
    activeSlots.append(slot)
    return slot
  }

  /// Advance fronts; schedule random ones from the preset gust rate. Returns the pool slot of a newly
  /// spawned front (so weather can emit the event) or nil.
  public func update(_ dt: Double, _ hx: Double, _ hz: Double, _ windDir: V2, _ windSpeed: Double, _ gustStrength: Double,
                     _ gustRate: Double, _ allowRandom: Bool) -> Int? {
    var spawned: Int? = nil
    if allowRandom && gustRate > 1e-4 && gustStrength > 0.5 {
      timer -= dt
      if timer <= 0 {
        timer = (1 / gustRate) * (0.7 + 0.6 * rng.next())
        spawned = spawn(hx, hz, windDir, windSpeed, SpawnOptions(strength: gustStrength * (0.8 + 0.4 * rng.next())))
      }
    } else {
      timer = JS.max(timer, 6)
    }

    var i = activeSlots.count - 1
    while i >= 0 {
      let k = activeSlots[i]
      var f = pool[k]
      f.age += dt
      f.x += f.dirX * f.speed * dt
      f.z += f.dirZ * f.speed * dt
      let along = (hx - f.x) * f.dirX + (hz - f.z) * f.dirZ // > 0 while the front is still upwind
      f.eta = JS.max(0, along / f.speed)
      let fadeIn = JS.min(1, f.age / tables.gustFadeIn)
      let fadeOut = 1 - MathUtil.smoothstepThree(-along, tables.gustFadeOutDist * 0.6, tables.gustFadeOutDist)
      f.fade = fadeIn * fadeOut
      f.strength = f.baseStrength * f.fade
      if -along > tables.gustFadeOutDist || f.age > 60 {
        f.alive = false
        activeSlots.remove(at: i)
      }
      pool[k] = f
      i -= 1
    }
    return spawned
  }

  /// Adds the gust-front wind vector at (x, z) to `out` (same profile as look.frontsAt / lookFront()).
  public func addWindAt(_ x: Double, _ z: Double, _ out: inout V2) {
    for k in activeSlots {
      let f = pool[k]
      if f.strength <= 0 { continue }
      let rx = x - f.x
      let rz = z - f.z
      let along = rx * f.dirX + rz * f.dirZ
      if JS.abs(along) >= 0.5 * f.width { continue }
      let lat = -rx * f.dirZ + rz * f.dirX
      let band = JS.pow(JS.sin(JS.PI * (along / f.width + 0.5)), 2)
      let taper = JS.exp(-2 * JS.pow(lat / (0.5 * f.length), 2))
      let s = band * taper * f.strength
      out.x += f.dirX * s
      out.y += f.dirZ * s
    }
  }

  // ---- checkpoint / tests ---------------------------------------------------------------------------
  /// Overwrite the pool and schedule (WeatherSim.restore).
  func restore(pool p: [Front], activeSlots a: [Int], timer t: Double) {
    if p.count == pool.count { pool = p }
    activeSlots = a.filter { $0 >= 0 && $0 < pool.count }
    timer = t
  }
}
