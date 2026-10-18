// heli/searchlight.js Searchlight (DESIGN §2.7.1, §2.9, §3.10): a gimballed SpotLight #FFF1DA aimed at
// the cursor on the water (≤ 60° from nadir), wide straight down, narrow when slanted, soft penumbra
// (.6); a single-scattering light shaft to the water hit point (Cone pass: analytic cone, front faces
// only, mist noise) with density by weather. Drives ocean.setSearchlight every frame and publishes the
// beam as heli.beam (fx rain sparkle, survivors, the cable shader).
//
// Pure state here: `beam` (CONTRACT heli.beam), the spot light parameters and the cone uniforms /
// transform for MaydayRender's spot[0] and Cone pass. Same expression order as the JS.

/// heli.beam: { on, intensity, origin, dir, hit, cosOuter, angle, length }
public struct SearchlightBeam: Equatable, Sendable {
  public var on = false
  public var intensity: Double = 0
  public var origin = V3()
  public var dir = V3(0, -1, 0)
  public var hit = V3()
  public var cosOuter: Double = JS.cos(0.26)
  public var angle: Double = 0.26
  public var length: Double = 30

  public init() {}
}

/// The THREE.SpotLight(0xfff1da, 0, 300, 0.26, 0.6, 2) as the searchlight drives it.
public struct SearchlightSpot: Equatable, Sendable {
  public static let color = Color3(hex: 0xfff1da)
  public static let range: Double = 300
  public static let decay: Double = 2
  public var intensity: Double = 0
  public var angle: Double = 0.26
  public var penumbra: Double = 0.6
  public var position = V3()
  public var target = V3()
}

/// createConeMaterial uniforms + the cone mesh transform (apex at the lens, unit cone scaled to the beam).
public struct SearchlightCone: Equatable, Sendable {
  public var visible = false
  public var density: Double = 0.02
  public var intensity: Double = 0
  public var len: Double = 40
  public var apex = V3()
  public var axis = V3(0, -1, 0)
  public var cos2: Double = 0.9
  public var tanA: Double = 0.27
  public var position = V3()
  public var quaternion = Quat()
  public var scale = V3(1, 1, 1)
}

public final class Searchlight {
  static let MAX_NADIR = MathUtils.degToRad(60)
  static let D10 = MathUtils.degToRad(10)
  static let D40 = MathUtils.degToRad(40)
  static let RANGE: Double = 300
  static let DOWN = V3(0, -1, 0)

  let ctx: SimContext
  /// 0..1 smoothed on/off (relay warm-up)
  public internal(set) var level: Double = 0
  /// current (slewed) beam direction
  public internal(set) var dir = V3(0, -1, 0)
  public internal(set) var origin = V3()
  public internal(set) var hit = V3()
  public internal(set) var length: Double = 30
  public internal(set) var angle: Double = 0.26
  var flick: Double = 0

  public internal(set) var beam = SearchlightBeam()
  public internal(set) var spot = SearchlightSpot()
  public internal(set) var cone = SearchlightCone()

  init(ctx: SimContext) {
    self.ctx = ctx
  }

  public func reset() {
    level = 0
    dir.set(0, -1, 0)
    beam.dir = dir // heli.beam.dir is the same Vector3 in the web
  }

  /// on = heli.searchlight, aim = heli.aim (world point on the water); `body` = the airframe body's
  /// matrixWorld this frame (the lens rides the visual pitch / bank).
  func update(_ dt: Double, _ h: Helicopter, _ aim: V3, body: Mat4) {
    let st = ctx.weatherState
    let on = h.searchlight && h.alive
    // Relay "ka-chunk": quick ramp with a short ignition flicker.
    let target: Double = on ? 1 : 0
    if on && level < 0.02 { flick = 0.18 }
    level += (target - level) * (1 - JS.exp(-dt * (on ? 9 : 14)))
    flick = JS.max(0, flick - dt)
    let flicker = flick > 0 ? 0.55 + 0.45 * JS.sin(flick * 160) : 1
    let lvl = level * flicker

    // Lens world position.
    var o = HeliModel.Points.lens
    o.applyMatrix4(body)
    origin = o

    // Desired direction to the aim point, clamped to ≤ 60° from nadir.
    let sea = JSNumber.or(h.seaY, 0)
    var w = V3(aim.x - o.x, 0, aim.z - o.z)
    let drop = JS.max(1, o.y - sea)
    let horiz = JS.hypot(w.x, w.z)
    let maxH = drop * JS.tan(Searchlight.MAX_NADIR)
    if horiz > maxH { w.multiplyScalar(maxH / horiz) }
    w.y = -drop
    w.normalize()
    // Gimbal slew (≈ 6 rad/s responsiveness, never snaps).
    let k = 1 - JS.exp(-dt * 7)
    dir.lerp(w, k)
    dir.normalize()
    if dir.y > -0.2 { dir.y = -0.2 }
    dir.normalize()

    // Hit point on the water plane under the beam.
    let s = (o.y - sea) / JS.max(0.05, -dir.y)
    length = JS.min(Searchlight.RANGE, s)
    hit = o
    hit.addScaledVector(dir, length)

    let nadir = JS.acos(JS.min(1, -dir.y))
    angle = MathUtils.lerp(0.26, 0.12, MathUtil.smoothLook(Searchlight.D10, Searchlight.D40, nadir))

    // Spot: keep the pool brightness roughly constant with distance (pool 0.75–0.9 after tonemap).
    spot.angle = angle
    spot.penumbra = 0.6 // soft falloff over the outer ~40 % of the pool — no stage-spot edge
    spot.position = o
    spot.target = hit
    let night = JSNumber.or(st.night, 0)
    let dayDim = 0.55 + 0.45 * night // by day the pool still shows but never fights the sun
    // The pool on the water is the ocean's look-driven layer 11 (it only takes a share of this light):
    // the SpotLight is sized for what floats in it — a raft canopy stays orange (≈0.6 on screen),
    // not a blown pink-white disc under the night bloom.
    spot.intensity = lvl * dayDim * 0.6 * JS.max(150, length * length)

    // Volumetric cone: density by weather (clear .02, rain .18, storm .25, fog .35).
    let rain = JSNumber.or(st.rain, 0)
    let fog = JSNumber.or(st.fog, 0)
    let inten = JSNumber.or(st.intensity, 0)
    var density = 0.02 + 0.2 * MathUtil.smoothLook(0, 0.8, rain) + 0.07 * MathUtil.smoothLook(0.6, 0.95, inten) + 0.33 * fog
    density = JS.min(0.42, density)
    cone.density = density
    cone.intensity = lvl * (0.3 + 0.7 * night) * 0.55
    cone.len = length
    let tanA = JS.tan(angle * 1.05)
    let rEnd = length * tanA
    cone.apex = o
    cone.axis = dir
    cone.tanA = tanA
    cone.cos2 = 1 / (1 + tanA * tanA)
    cone.visible = lvl > 0.01
    if cone.visible {
      cone.position = o
      var q = Quat()
      q.setFromUnitVectors(Searchlight.DOWN, dir)
      cone.quaternion = q
      cone.scale.set(rEnd, length, rEnd)
    }

    // Publish.
    beam.on = on
    beam.intensity = lvl
    beam.origin = origin
    beam.dir = dir
    beam.hit = hit
    beam.cosOuter = JS.cos(angle)
    beam.angle = angle
    beam.length = length
    ctx.ocean?.setSearchlight(origin: o, dir: dir, cosOuter: beam.cosOuter, level: lvl)
  }
}
