// The two scene lights weather owns (systems/weather/lights.js WeatherLights; DESIGN §2.7.1, §2.7.2,
// CONTRACT light budget: exactly 2) as plain state — the sun rig numbers:
//
// * Sun/moon DirectionalLight — the only shadow caster. Shadow box 250 m following the heli (centred
//   between the heli and its shadow so the «shadow altimeter» is always in the map), texel-snapped to
//   kill shimmering, map 2048 / 1024 / 512 by quality, PCF radius and shadow.intensity per preset.
//   Uses the CHEATED direction (clamped elevation) while weather.state.sunDirVisual keeps the true sun.
// * Lightning swings the light toward the strike for ~350 ms (elevation 35–60°, flash colour, intensity
//   flash × 5, shadow strength 0.9): the heli's shadow snaps around at every strike.
// * HemisphereLight: palette ambient / ambientGround, ×4 on a flash.
//
// Double with three's operation order (Color.lerp, MathUtils.lerp, Vector3.crossVectors / normalize /
// dot / addScaledVector). The renderer turns `state` into its light uniforms and shadow camera
// (MaydayRender SunRig / ShadowCamera hold the same rules on the render side and are checked against
// the real WeatherLights by the render goldens; this is the Core copy WeatherSim drives, PLAN §2.9).

public final class WeatherLights {
  /// What the three lights hold after WeatherLights.update.
  public struct State: Equatable, Sendable {
    public var direction = V3(0, 1, 0) // st.sunDir (the swung or cheated direction)
    public var position = V3(0, 1, 0) // sun.position = target + dir · DIST (three default: DEFAULT_UP)
    public var target = V3(0, 0, 0) // sun.target.position (texel-snapped box centre)
    public var intensity: Double = 1 // sun.intensity
    public var color = PaletteColor(1, 1, 1) // sun.color
    public var shadowIntensity: Double = 1 // sun.shadow.intensity (three default)
    public var shadowRadius: Double = 1 // sun.shadow.radius (three default)
    public var hemiColor = PaletteColor(1, 1, 1)
    public var hemiGroundColor = PaletteColor(0, 0, 0)
    public var hemiIntensity: Double = 0.6
    public var mapSize = 1024
    public init() {}
  }

  public static let shadowBias: Double = -0.0004
  public static let shadowNormalBias: Double = 0.6
  public static let cameraNear: Double = 1

  let tables: WeatherTables
  public private(set) var state = State()
  public private(set) var swingT: Double = 99
  public private(set) var swingDir = V3(0, 1, 0)
  /// Rotor blades live on layer 1 (shadow only) — stroboscopic rotor shadow on high (DESIGN §2.7.2).
  public private(set) var shadowLayer1 = false
  /// shadow.camera.far = DIST + 420
  public var cameraFar: Double { tables.lightsDist + 420 }

  init(tables: WeatherTables, quality: String?) {
    self.tables = tables
    state.mapSize = 0
    applyQuality(quality)
  }

  /// applyQuality(q): map size by tier (unknown → 1024), layer 1 on high only.
  public func applyQuality(_ q: String?) {
    let size = q.flatMap { tables.mapSize[$0] } ?? 1024
    if size != state.mapSize { state.mapSize = size }
    shadowLayer1 = q == "high"
  }

  /// Lightning: snap the key light toward the strike (x, z) seen from the heli (hx, hz) for ~350 ms.
  func swing(_ x: Double, _ z: Double, _ hx: Double, _ hz: Double, _ rng: Rng) {
    var dx = x - hx
    var dz = z - hz
    let d = JS.hypot(dx, dz)
    if d < 1 {
      let a = rng.next() * JS.PI * 2
      dx = JS.cos(a)
      dz = JS.sin(a)
    } else {
      dx /= d
      dz /= d
    }
    let elev = MathUtils.degToRad(35 + 25 * rng.next())
    swingDir = V3(dx * JS.cos(elev), JS.sin(elev), dz * JS.cos(elev))
    swingT = 0
  }

  /// Swing weight 0…1 (1 while the strike owns the light).
  public var swingWeight: Double {
    let t = swingT
    if t < tables.swingHold { return 1 }
    if t < tables.swingHold + tables.swingOut { return 1 - (t - tables.swingHold) / tables.swingOut }
    return 0
  }

  /// update(dt, st, focus, alt, camFocus): st = weather state (writes st.sunDir), focus = the heli
  /// position the box follows, alt = max(0, heli altitude), camFocus = camera ground point.
  func update(_ dt: Double, _ st: inout WeatherState, focus: V3, alt: Double, camFocus: V3?) {
    let p = st.palette
    swingT += dt
    let w = swingWeight
    let flash = st.flash

    // Direction: cheated sun, or the strike while swinging (hard switch = the shadow snaps).
    var dir = st.sunDirShadow
    if w > 0.5 { dir = swingDir }
    st.sunDir = dir
    state.direction = dir

    // Intensity & colour (Color.lerp: c + (target − c)·α; MathUtils.lerp: (1 − t)·x + t·y).
    let sunI = p.sunIntensity
    state.intensity = sunI * (1 - w) + JS.max(sunI, flash * 5) * w
    state.color = p.sun.lerp(st.flashColor, w)
    state.shadowIntensity = MathUtils.lerp(p.shadowIntensity, 0.9, w)
    state.shadowRadius = MathUtils.lerp(p.shadowRadius, 1.5, w)

    state.hemiColor = p.ambient.lerp(st.flashColor, JS.min(1, flash * 0.8))
    state.hemiGroundColor = p.ambientGround
    state.hemiIntensity = p.ambientIntensity * (1 + 3 * flash)

    // Shadow box: midway between the heli and its shadow on the water; falls back to the camera
    // focus when the heli is far from the view (title drift, cinematics).
    let h = JS.max(0.05, dir.y)
    let hy = JS.hypot(dir.x, dir.z)
    let horiz = JSNumber.isTruthy(hy) ? hy : 1 // `Math.hypot(dir.x, dir.z) || 1`
    let off = JS.min(alt, 140) * (horiz / h) * 0.5
    var c = V3(focus.x - (dir.x / horiz) * off, 0, focus.z - (dir.z / horiz) * off)
    if let cf = camFocus, JS.hypot(cf.x - c.x, cf.z - c.z) > 160 { c = V3(cf.x, 0, cf.z) }

    // Texel snapping in light space (axes of the shadow camera's lookAt basis).
    var R = V3.cross(V3(0, 1, 0), dir)
    if R.lengthSq < 1e-6 { R = V3(1, 0, 0) }
    R = R.normalized()
    let U = V3.cross(dir, R).normalized()
    let texel = tables.lightsBox / Double(state.mapSize)
    let r = c.dot(R)
    let u = c.dot(U)
    c.addScaled(R, JS.round(r / texel) * texel - r)
    c.addScaled(U, JS.round(u / texel) * texel - u)

    state.target = c
    var pos = c
    pos.addScaled(dir, tables.lightsDist)
    state.position = pos
  }

  // ---- checkpoint / tests ---------------------------------------------------------------------------
  func restore(swingT t: Double, swingDir d: V3) {
    swingT = t
    swingDir = d
  }
}

extension PaletteColor {
  /// THREE.Color.lerp(color, alpha): r += (color.r − r) · alpha (per channel), as a value.
  @inline(__always) public func lerp(_ c: PaletteColor, _ alpha: Double) -> PaletteColor {
    PaletteColor(r + (c.r - r) * alpha, g + (c.g - g) * alpha, b + (c.b - b) * alpha)
  }
}
