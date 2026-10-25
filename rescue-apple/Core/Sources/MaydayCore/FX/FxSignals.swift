// fx/signals.js — human light in a cold sea (DESIGN §1.1 «Свет — это жизнь», §2.10 signals, §2.7.1):
//   * Glows   — instanced additive sprites (HDR core + halo, round or 4-point star) for flare cores, rocket
//               stars and lightning impact stars; always with their own halo (read on low without bloom);
//   * Rings   — additive light on the water (lightning impact: an uneven flash front with radial spatter);
//   * Signals — flares burning 40 s on the water or in a survivor's hand (12–18 Hz flicker of a pooled red
//               PointLight, smoke lit red, sparks, glint) and red parachute rockets (up to 80 m in 2.5 s,
//               2 m/s down for 25 s swaying at 0.5 Hz, a pooled light tinting sea and clouds within 120 m),
//               with the occasional «ракета у объектива» (the star tops out just in front of the lens).
// Flares and rockets are pooled slot objects (8 / 4); survivors hold their flare slot and move it with the
// hand. Every Math.random draw is the web's, in order. Plus the FLIR heat spheres on render layer 2.

/// A flare slot (signals.flares[i]).
public final class FxFlare {
  public internal(set) var alive = false
  public var x: Double = 0
  public internal(set) var y: Double = 0
  public var z: Double = 0
  /// burn time so far; survivors set it to `life` (retire) or life − 2.5 (sputter out)
  public var t: Double = 0
  public internal(set) var life: Double
  public internal(set) var seed: Double = 0
  public internal(set) var light: LightHandle?
  var smokeAcc: Double = 0
  var sparkAcc: Double = 0
  /// this frame's intensity (ignition × end × flicker)
  public internal(set) var flick: Double = 1
  /// in a survivor's hand (opts.held, or detected when somebody else moves x / z)
  public internal(set) var held = false
  public internal(set) var lift: Double = 1.3
  var lx: Double = 0
  var lz: Double = 0

  init(life: Double) { self.life = life }
}

/// A rocket slot (signals.rockets[i]).
public final class FxRocket {
  public internal(set) var alive = false
  public internal(set) var x: Double = 0
  public internal(set) var y: Double = 0
  public internal(set) var z: Double = 0
  public internal(set) var x0: Double = 0
  public internal(set) var y0: Double = 0
  public internal(set) var z0: Double = 0
  /// last drawn position (trail interpolation)
  public internal(set) var px: Double = 0
  public internal(set) var py: Double = 0
  public internal(set) var pz: Double = 0
  /// parachute sway offset
  public internal(set) var sx: Double = 0
  public internal(set) var sz: Double = 0
  public internal(set) var t: Double = 0
  public internal(set) var light: LightHandle?
  var trailAcc: Double = 0
  public internal(set) var seed: Double = 0
  public internal(set) var color: Color3
  /// the «rocket at the lens» aim point
  public internal(set) var lens = false
  public internal(set) var ax: Double = 0
  public internal(set) var ay: Double = 0
  public internal(set) var az: Double = 0
  public internal(set) var top: Double = 80

  init(color: Color3) { self.color = color }
}

/// fx/signals.js Glows: additive sprites (iP xyz + core size, iC rgb + intensity, iH halo size, halo
/// intensity, kind, rotation, iHc halo colour).
public struct FxGlowInstances {
  public let max: Int
  public internal(set) var count = 0
  public internal(set) var P: [Float]
  public internal(set) var C: [Float]
  public internal(set) var H: [Float]
  public internal(set) var Hc: [Float]

  init(max: Int) {
    self.max = max
    P = [Float](repeating: 0, count: max * 4)
    C = [Float](repeating: 0, count: max * 4)
    H = [Float](repeating: 0, count: max * 4)
    Hc = [Float](repeating: 0, count: max * 3)
  }

  mutating func begin() { count = 0 }

  /// add(x, y, z, coreSize, core, intensity, haloSize, halo, haloI, kind = 0, rot = 0)
  mutating func add(_ x: Double, _ y: Double, _ z: Double, _ coreSize: Double, _ core: Color3, _ intensity: Double, _ haloSize: Double,
                    _ halo: Color3, _ haloI: Double, _ kind: Double = 0, _ rot: Double = 0) {
    if count >= max { return }
    let i = count
    count += 1
    P[i * 4] = Float(x); P[i * 4 + 1] = Float(y); P[i * 4 + 2] = Float(z); P[i * 4 + 3] = Float(coreSize)
    C[i * 4] = Float(core.r); C[i * 4 + 1] = Float(core.g); C[i * 4 + 2] = Float(core.b); C[i * 4 + 3] = Float(intensity)
    H[i * 4] = Float(haloSize); H[i * 4 + 1] = Float(haloI); H[i * 4 + 2] = Float(kind); H[i * 4 + 3] = Float(rot)
    Hc[i * 3] = Float(halo.r); Hc[i * 3 + 1] = Float(halo.g); Hc[i * 3 + 2] = Float(halo.b)
  }
}

/// fx/signals.js Rings: additive light on the water (lightning impacts).
public struct FxRings {
  public struct Ring {
    public var alive = false
    public var x: Double = 0
    public var z: Double = 0
    public var t: Double = 0
    public var life: Double = 0.7
    public var r1: Double = 30
    public var col = Color3()
    public var I: Double = 1
  }

  public internal(set) var list: [Ring]
  /// iR: x, z, radius, width · iRc: rgb, intensity (Float, [0, count))
  public internal(set) var count = 0
  public internal(set) var R: [Float]
  public internal(set) var Rc: [Float]

  init(max: Int) {
    list = [Ring](repeating: Ring(), count: max)
    R = [Float](repeating: 0, count: max * 4)
    Rc = [Float](repeating: 0, count: max * 4)
  }

  mutating func spawn(_ x: Double, _ z: Double, _ r1: Double, _ life: Double, _ color: Color3, _ intensity: Double) {
    var idx = list.firstIndex { !$0.alive }
    if idx == nil {
      // reduce((a, b) => (a.t > b.t ? a : b)): the oldest, the first of equals
      var best = 0
      for i in 1..<list.count where !(list[best].t > list[i].t) { best = i }
      idx = best
    }
    guard let i = idx else { return }
    list[i].alive = true
    list[i].x = x
    list[i].z = z
    list[i].t = 0
    list[i].life = life
    list[i].r1 = r1
    list[i].I = intensity
    list[i].col = color
  }

  mutating func clear() {
    for i in list.indices { list[i].alive = false }
  }

  mutating func update(_ dt: Double) {
    var n = 0
    for i in list.indices where list[i].alive {
      list[i].t += dt
      let r = list[i]
      if r.t >= r.life {
        list[i].alive = false
        continue
      }
      let k = r.t / r.life
      let e = 1 - JS.pow(1 - k, 2.2)
      let rad = 1.5 + (r.r1 - 1.5) * e
      R[n * 4] = Float(r.x)
      R[n * 4 + 1] = Float(r.z)
      R[n * 4 + 2] = Float(rad)
      R[n * 4 + 3] = Float(1 + rad * 0.12)
      Rc[n * 4] = Float(r.col.r)
      Rc[n * 4 + 1] = Float(r.col.g)
      Rc[n * 4 + 2] = Float(r.col.b)
      Rc[n * 4 + 3] = Float(r.I * (1 - k) * (1 - k))
      n += 1
    }
    count = n
  }
}

public final class FxSignals {
  unowned let fx: Effects
  let tables: FxTables
  public internal(set) var flares: [FxFlare]
  public internal(set) var rockets: [FxRocket]
  /// «Ракета у объектива»: not in the first minutes of a sortie
  public internal(set) var lensCd: Double
  /// read-only stat
  public internal(set) var lensCount = 0
  var night: Double = 0
  /// FLIR heat spheres (layer 2): one per burning flare / rocket star, matrices (Float, 16 each)
  public internal(set) var heatCount = 0
  public internal(set) var heatMatrices: [Float]
  let heatMax: Int

  let cFlare: Color3
  let cFlareCore: Color3
  let cFlareLight: Color3
  let cSmoke = Color3(style: "#D2CAC6")
  let cSmokeEnd = Color3(style: "#9C9692")
  /// by day the flare's red shows in its own smoke
  let cSmokeDay = Color3(style: "#DDBDB4")
  let cEmber: Color3
  let cRocketCore = Color3(style: "#FFE6DA")
  let cTrail = Color3(style: "#E8E4E0")

  init(_ fx: Effects) {
    self.fx = fx
    tables = fx.tables
    let t = fx.tables
    flares = (0..<t.maxFlares).map { _ in FxFlare(life: t.flareLife) }
    rockets = (0..<t.maxRockets).map { _ in FxRocket(color: t.color("rocket")) }
    lensCd = 45
    heatMax = t.maxFlares + t.maxRockets
    heatMatrices = [Float](repeating: 0, count: heatMax * 16)
    cFlare = t.color("flare")
    cFlareCore = t.color("flareCore")
    cFlareLight = t.color("flareLight")
    var e = Color3(style: "#FF7A3A")
    e.multiplyScalar(7)
    cEmber = e
  }

  /// The oldest slot when every one burns (reduce((a, b) => (a.t > b.t ? a : b))).
  static func oldest<T: AnyObject>(_ list: [T], _ t: (T) -> Double) -> T {
    var best = list[0]
    for x in list.dropFirst() where !(t(best) > t(x)) { best = x }
    return best
  }

  func flare(_ x: Double, _ z: Double, life: Double?, held: Bool, lift: Double? = nil) -> FxFlare {
    let f = flares.first { !$0.alive } ?? FxSignals.oldest(flares) { $0.t }
    f.light?.release()
    f.alive = true
    f.x = x
    f.z = z
    f.y = fx.seaHeight(x, z)
    f.held = held
    f.lift = lift.flatMap { $0.isFinite ? $0 : nil } ?? 1.3
    f.lx = x
    f.lz = z
    f.t = 0
    f.life = life ?? tables.flareLife
    f.seed = fx.ctx.random() * 100
    f.smokeAcc = 0
    f.sparkAcc = 0
    f.light = fx.acquireLight(cFlareLight, 0, 62)
    // ignition pop
    fx.sparks(x, f.y + 0.3, z, "#FF9A60", 14)
    return f
  }

  /// rocket(x, y, z, {color, lens}): lens nil = maybe (a chance per launch), true = force, false = never.
  func rocket(_ x: Double, _ y: Double, _ z: Double, color: String?, lens: Bool? = nil) -> FxRocket {
    let r = rockets.first { !$0.alive } ?? FxSignals.oldest(rockets) { $0.t }
    r.light?.release()
    r.alive = true
    r.x0 = x
    r.z0 = z
    r.y0 = y.isFinite && y > 0.5 ? y : fx.seaHeight(x, z) + 0.5
    r.x = x
    r.y = r.y0
    r.z = z
    r.t = 0
    r.px = r.x
    r.py = r.y
    r.pz = r.z
    r.seed = fx.ctx.random() * 100
    r.trailAcc = 0
    r.color = fx.colors.color(color ?? tables.colorHex["rocket"] ?? "#FF3A22")
    r.top = r.y0 + 80
    r.lens = false
    if lens != false { lensAim(r, force: lens == true) }
    r.light = fx.acquireLight(r.color, 0, 210)
    fx.sparks(x, r.y0 + 0.5, z, "#FFB070", 10)
    return r
  }

  /// Maybe turn this launch into the «rocket at the lens» moment: aim the motor at a point ~30 m in front
  /// of the camera (slightly upwind, so the parachute drifts the star across the frame).
  func lensAim(_ r: FxRocket, force: Bool) {
    let ctx = fx.ctx
    guard let cam = ctx.camera else { return }
    if !force {
      if lensCd > 0 || ctx.mode() != .play || ctx.cameraCinematic() { return }
      if ctx.random() > 0.2 + 0.4 * night { return }
    }
    cam.updateMatrixWorld()
    let mw = cam.matrixWorld
    let C = V3(mw[12], mw[13], mw[14])
    if !force && JS.hypot(C.x - r.x0, C.z - r.z0) > tables.lensRange { return }
    var f = V3(-mw[8], -mw[9], -mw[10])
    f.normalize()
    let w = fx.wind
    let wlr = JS.hypot(w.x, w.y)
    let wl = JSNumber.isTruthy(wlr) ? wlr : 1
    let side = (ctx.random() - 0.5) * 10
    r.ax = C.x + f.x * tables.lensDist - (w.x / wl) * 9 - (w.y / wl) * side
    r.az = C.z + f.z * tables.lensDist - (w.y / wl) * 9 + (w.x / wl) * side
    r.ay = C.y + f.y * tables.lensDist
    if !(r.ay - r.y0 > 40) || !(r.ax + r.ay + r.az).isFinite { return }
    r.lens = true
    r.top = r.ay
    lensCd = tables.lensCooldown
    lensCount += 1
  }

  func clear() {
    for f in flares {
      f.alive = false
      f.light?.release()
      f.light = nil
    }
    for r in rockets {
      r.alive = false
      r.light?.release()
      r.light = nil
    }
  }

  var activeFlares: [FxFlare] { flares.filter { $0.alive } }

  func update(_ dt: Double, _ wind: V2, _ reduceFlashes: Bool, _ nightIn: Double) {
    let random = fx.ctx.random
    let t = fx.t
    let flickAmp = reduceFlashes ? 0.08 : 0.24
    let ocean = fx.ctx.ocean
    // daylight: every light pool / halo is scaled by (1 − .85·daylight) (DESIGN §2.10 by day)
    let day = 1 - JS.min(1, JS.max(0, nightIn))
    let dayK = 1 - 0.85 * day
    let night = nightIn
    self.night = JS.min(1, JS.max(0, nightIn))
    if dt > 0 { lensCd = JS.max(0, lensCd - dt) }
    var nh = 0

    for f in flares where f.alive {
      f.t += dt
      if f.t >= f.life {
        f.alive = false
        f.light?.release()
        f.light = nil
        continue
      }
      // floating: drift slowly with the wind (leeway) and bob on the surface; held: follow the hand
      if JS.abs(f.x - f.lx) > 1e-4 || JS.abs(f.z - f.lz) > 1e-4 { f.held = true }
      if !f.held {
        f.x += wind.x * 0.03 * dt
        f.z += wind.y * 0.03 * dt
      }
      f.y = fx.seaHeight(f.x, f.z) + (f.held ? f.lift : 0)
      f.lx = f.x
      f.lz = f.z
      // 12–18 Hz flicker (two incommensurate tones + a little noise), sputter at the end
      let ph = t + f.seed
      var flick = 1 - flickAmp + flickAmp * (0.55 * JS.sin(ph * 2 * JS.PI * 12.7) + 0.45 * JS.sin(ph * 2 * JS.PI * 17.3 + 1.3))
        + (random() - 0.5) * flickAmp * 0.4
      let ign = FxMath.smooth(0, 0.6, f.t)
      let end = 1 - FxMath.smooth(f.life - 3, f.life, f.t)
      if f.life - f.t < 3 && !reduceFlashes { flick *= 0.6 + 0.4 * (random() < 0.75 ? 1 : 0.2) }
      let I = ign * end * JS.max(0, flick)
      f.flick = I
      if let l = f.light {
        l.position = V3(f.x, f.y + 1.3, f.z)
        // firelight on wet stone, not red paint: a lower peak and the flicker breathing in the reach too
        l.set(700 * I * dayK)
        l.setDistance(62 * (0.82 + 0.18 * JS.min(1.2, flick)))
      }
      // core + halo: by day a small hot core and red-tinted smoke, not a haloed orb on a sunlit sea
      fx.glows.add(f.x, f.y + 0.35, f.z, 0.5, cFlareCore, 7 * I * (0.45 + 0.55 * night), 6.5 * (1 - 0.75 * day), cFlare,
                   1.2 * I * (0.6 + 0.4 * night) * dayK, 0)
      ocean?.addSeaGlint(f.x, f.z, 6, 1.8 * I * dayK, cFlare)
      if nh < heatMax && I > 0.05 {
        heatMatrix(nh, 0.8, f.x, f.y + 0.4, f.z)
        nh += 1
      }
      if dt > 0 {
        // smoke lit red by its own light, trailing with the wind
        f.smokeAcc += dt * 7 * end
        var sc = cSmoke
        sc.lerp(cSmokeDay, day)
        while f.smokeAcc >= 1 {
          f.smokeAcc -= 1
          let s0 = 0.5 + 0.6 * random()
          fx.pools.smoke.emit(t, f.x + (random() - 0.5) * 0.4, f.y + 0.6, f.z + (random() - 0.5) * 0.4,
                              (random() - 0.5) * 0.4, 0.9 + random() * 0.5, (random() - 0.5) * 0.4,
                              5 + random() * 2.5, s0, 4.5 + random() * 4, sc, 0.3 + 0.15 * random(), cSmokeEnd, tables.pFlareSmoke)
        }
        f.sparkAcc += dt * 5 * I * (0.4 + 0.6 * night)
        while f.sparkAcc >= 1 {
          f.sparkAcc -= 1
          fx.pools.glow.emit(t, f.x, f.y + 0.4, f.z, (random() - 0.5) * 2.4, 2 + random() * 3, (random() - 0.5) * 2.4,
                             0.35 + random() * 0.5, 0.12, 0.08, cEmber, 1, cEmber, tables.pEmber)
        }
      }
    }

    let rise = tables.rocketRise
    let descent = tables.rocketDescent
    for r in rockets where r.alive {
      r.t += dt
      let total = rise + descent
      if r.t >= total {
        r.alive = false
        r.light?.release()
        r.light = nil
        continue
      }
      var I: Double
      if r.t < rise {
        let k = r.t / rise
        let e = 1 - (1 - k) * (1 - k)
        if r.lens {
          // a long slanted climb towards the lens
          r.y = r.y0 + (r.ay - r.y0) * e
          r.x = r.x0 + (r.ax - r.x0) * e
          r.z = r.z0 + (r.az - r.z0) * e
        } else {
          r.y = r.y0 + 80 * e
          r.x = r.x0 + wind.x * 0.15 * r.t
          r.z = r.z0 + wind.y * 0.15 * r.t
        }
        I = 0.35 + 0.25 * k
        // the motor's trail: a thin continuous wisp, puffs spread along the path travelled this frame
        if dt > 0 {
          r.trailAcc += 1.3 * JS.hypot(r.x - r.px, r.y - r.py, r.z - r.pz)
          var g = 40
          while r.trailAcc >= 1 && g > 0 {
            g -= 1
            r.trailAcc -= 1
            let u = random()
            let s0 = 1.3 + 0.8 * random()
            // born when the motor passed that point
            fx.pools.smoke.emit(t - dt * u, r.x + (r.px - r.x) * u, r.y + (r.py - r.y) * u, r.z + (r.pz - r.z) * u,
                                (random() - 0.5) * 0.5, -0.4, (random() - 0.5) * 0.5,
                                1.8 + random() * 1.6, s0, s0 * (1.5 + 0.9 * random()), cTrail, 0.06 + 0.05 * random(), cSmokeEnd, tables.pTrail)
          }
          if r.trailAcc > 2 { r.trailAcc = 2 }
        }
      } else {
        let td = r.t - rise
        // parachute: 2 m/s down, drifting with the wind, swaying at 0.5 Hz
        r.y = r.top - 2 * td
        r.x += wind.x * 0.9 * dt
        r.z += wind.y * 0.9 * dt
        let wlr = JS.hypot(wind.x, wind.y)
        let wl = JSNumber.isTruthy(wlr) ? wlr : 1
        let sway = JS.sin(2 * JS.PI * 0.5 * td + r.seed) * 1.6
        let sx = (-wind.y / wl) * sway
        let sz = (wind.x / wl) * sway
        let pop = td < 0.3 ? 1.6 - 2 * td : 1
        let end = 1 - FxMath.smooth(descent - 2.5, descent, td)
        let flick = reduceFlashes ? 1 : 0.93 + 0.07 * JS.sin(t * 2 * JS.PI * 9.1 + r.seed) * JS.sin(t * 2 * JS.PI * 3.3)
        I = pop * end * flick
        r.sx = sx
        r.sz = sz
        if dt > 0 && end > 0.05 {
          // a thin continuous wisp under the parachute (dense enough not to read as a dotted line in a gale)
          let wl2 = JS.hypot(wind.x, wind.y)
          r.trailAcc += dt * (4 + 0.6 * wl2)
          var g = 16
          while r.trailAcc >= 1 && g > 0 {
            g -= 1
            r.trailAcc -= 1
            let u = random()
            let s0 = 0.5 + 0.6 * random()
            fx.pools.smoke.emit(t - dt * u, r.x + sx + (r.px - r.x - sx) * u, r.y - 0.6 + (r.py - r.y) * u, r.z + sz + (r.pz - r.z - sz) * u, 0, -0.3, 0,
                                3.5 + random() * 2, s0, 3 + 2.5 * random(), cTrail, 0.1 + 0.06 * random(), cSmokeEnd, tables.pTrail)
          }
          if r.trailAcc > 4 { r.trailAcc = 4 }
        }
      }
      let px = r.x + (JSNumber.isTruthy(r.sx) ? r.sx : 0)
      let pz = r.z + (JSNumber.isTruthy(r.sz) ? r.sz : 0)
      r.px = px
      r.py = r.y
      r.pz = pz
      // the parachute star only colours the sea / cloud at night or dusk; by day it is a bright point
      let seaK = 0.03 + 0.97 * FxMath.smooth(0.15, 0.6, night)
      // at the lens the star breathes slowly, so the scud it lights pulses red; its halo is kept small
      let lensUp = r.lens && r.t >= rise
      let pulse = lensUp ? 0.62 + 0.38 * JS.sin(2 * JS.PI * 0.75 * (r.t - rise) + 1.2) : 1
      if let l = r.light {
        l.position = V3(px, r.y, pz)
        l.set((r.t < rise ? 500 : 4200) * I * pulse * seaK)
      }
      let core = (r.t < rise ? 4 : 9) * (0.5 + 0.5 * night)
      // close to the lens the burning star reads as what it is — a red flare, not a white sun
      let haloS: Double = lensUp ? 8 : r.t < rise ? 5 : 16
      let haloI = lensUp ? 1.8 * (0.7 + 0.3 * pulse) : r.t < rise ? 1 : 3
      var coreC = cRocketCore
      if lensUp { coreC.lerp(r.color, 0.6) }
      fx.glows.add(px, r.y, pz, r.t < rise ? 0.5 : lensUp ? 0.7 : 1.0, coreC, core * I * (lensUp ? 0.4 : 1), haloS * (1 - (lensUp ? 0.6 : 0.75) * day),
                   r.color, haloI * I * JS.max(dayK, lensUp ? 0.5 : 0), r.t < rise || day > 0.5 ? 0 : 1, t * 0.3)
      if nh < heatMax {
        heatMatrix(nh, 0.6, px, r.y, pz)
        nh += 1
      }
      if r.t >= rise { ocean?.addSeaGlint(px, pz, 20, 1.1 * I * seaK, r.color) }
    }
    heatCount = nh
  }

  /// makeScale(s, s, s).setPosition(x, y, z) into the heat instance list
  func heatMatrix(_ i: Int, _ s: Double, _ x: Double, _ y: Double, _ z: Double) {
    var m = Mat4()
    m.makeScale(s, s, s)
    m.setPosition(x, y, z)
    writeMatrix(m, &heatMatrices, i)
  }
}
