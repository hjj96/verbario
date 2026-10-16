// SunRig — port of rescue/src/systems/weather/lights.js (WeatherLights) in Double with three's operation
// order (PLAN §2.9 weather/lights.js row: SunRig + LightRig/ShadowPass; DESIGN §2.7.1–2.7.2):
//   * the sun/moon DirectionalLight — the only shadow caster: shadow box 250 m centred between the heli
//     and its shadow (the «shadow altimeter» stays in the map), texel-snapped in light space, map
//     512 / 1024 / 2048 by quality, PCF radius and shadow.intensity per preset, bias −0.0004,
//     normalBias 0.6, cheated (clamped) elevation st.sunDirShadow;
//   * the lightning swing: the key light snaps toward the strike for 0.3 s (+0.12 s fade);
//   * the HemisphereLight: palette ambient / ambientGround, ×(1 + 3·flash).
// Output is the light state three would render with; ShadowCamera turns it into the shadow matrices.
// Bit-exact against the real WeatherLights (Tests/Goldens/lighting/sunrig.json, MaydayRenderTests).
// TODO(Core): PLAN places SunRig in MaydayCore/Weather; it lives here until WeatherSim is ported (it
// only needs MaydayCore math), then moves verbatim.
import Foundation
import MaydayCore

public struct SunRigInput {
  public var sunDirShadow = V3(0, 1, 0)      // weather.state.sunDirShadow (unit)
  public var flash: Double = 0               // weather.state.flash
  public var flashColor = PaletteColor(1, 1, 1)  // weather.state.flashColor (linear)
  public var sunColor = PaletteColor(1, 1, 1)    // palette.sun
  public var sunIntensity: Double = 1        // palette.sunIntensity
  public var shadowIntensity: Double = 0.5   // palette.shadowIntensity
  public var shadowRadius: Double = 1        // palette.shadowRadius
  public var ambient = PaletteColor(1, 1, 1)     // palette.ambient
  public var ambientGround = PaletteColor(0, 0, 0) // palette.ambientGround
  public var ambientIntensity: Double = 0.6  // palette.ambientIntensity
  public init() {}

  public init(palette p: Palette, sunDirShadow: V3, flash: Double, flashColor: PaletteColor) {
    self.sunDirShadow = sunDirShadow
    self.flash = flash
    self.flashColor = flashColor
    sunColor = p.sun
    sunIntensity = p.sunIntensity
    shadowIntensity = p.shadowIntensity
    shadowRadius = p.shadowRadius
    ambient = p.ambient
    ambientGround = p.ambientGround
    ambientIntensity = p.ambientIntensity
  }
}

/// What the scene lights hold after WeatherLights.update (three objects' fields).
public struct SunRigState: Equatable {
  public var direction = V3(0, 1, 0)        // st.sunDir (the swung or cheated direction)
  public var position = V3(0, 520, 0)       // sun.position = target + dir · DIST
  public var target = V3(0, 0, 0)           // sun.target.position (texel-snapped box centre)
  public var intensity: Double = 1          // sun.intensity
  public var color = PaletteColor(1, 1, 1)  // sun.color
  public var shadowIntensity: Double = 0.5  // sun.shadow.intensity
  public var shadowRadius: Double = 1       // sun.shadow.radius
  public var hemiColor = PaletteColor(1, 1, 1)
  public var hemiGroundColor = PaletteColor(0, 0, 0)
  public var hemiIntensity: Double = 0.6
  public var mapSize = 1024
  public init() {}
}

public final class SunRig {
  public static let BOX: Double = 250          // shadow box, m
  public static let DIST: Double = 520         // light distance from its target along the light direction
  public static let SWING_HOLD: Double = 0.3
  public static let SWING_OUT: Double = 0.12
  public static let SHADOW_BIAS: Double = -0.0004
  public static let SHADOW_NORMAL_BIAS: Double = 0.6
  public static let CAMERA_NEAR: Double = 1
  public static let CAMERA_FAR: Double = 520 + 420
  public static let MAP_SIZE: [String: Int] = ["low": 512, "medium": 1024, "high": 2048]

  public private(set) var state = SunRigState()
  public private(set) var swingT: Double = 99
  public private(set) var swingDir = V3(0, 1, 0)
  /// Rotor blades live on layer 1 (shadow only) on high (applyQuality).
  public private(set) var shadowLayer1 = false

  public init(quality: String) {
    applyQuality(quality)
  }

  /// WeatherLights.applyQuality(q): map size by tier (unknown → 1024), layer 1 on high only.
  public func applyQuality(_ q: String) {
    state.mapSize = SunRig.MAP_SIZE[q] ?? 1024
    shadowLayer1 = q == "high"
  }

  /// Lightning: snap the key light toward the strike (x, z) seen from the heli (hx, hz) for ~350 ms.
  /// `next` is the weather's mulberry32 (three calls at most, in this order).
  public func swing(x: Double, z: Double, hx: Double, hz: Double, next: () -> Double) {
    var dx = x - hx
    var dz = z - hz
    let d = JS.hypot(dx, dz)
    if d < 1 {
      let a = next() * JS.PI * 2
      dx = JS.cos(a)
      dz = JS.sin(a)
    } else {
      dx /= d
      dz /= d
    }
    let elev = (35 + 25 * next()) * (JS.PI / 180)   // THREE.MathUtils.degToRad: degrees · DEG2RAD
    swingDir = V3(dx * JS.cos(elev), JS.sin(elev), dz * JS.cos(elev))
    swingT = 0
  }

  /// Swing weight 0..1 (1 while the strike owns the light).
  public var swingWeight: Double {
    let t = swingT
    if t < SunRig.SWING_HOLD { return 1 }
    if t < SunRig.SWING_HOLD + SunRig.SWING_OUT { return 1 - (t - SunRig.SWING_HOLD) / SunRig.SWING_OUT }
    return 0
  }

  /// WeatherLights.update(dt, st, focus, alt, camFocus). focus = the heli position (the box follows it),
  /// alt = max(0, heli altitude), camFocus = the camera ground point (nil: no fallback).
  @discardableResult
  public func update(dt: Double, input st: SunRigInput, focus: V3, alt: Double, camFocus: V3?) -> SunRigState {
    swingT += dt
    let w = swingWeight
    let flash = st.flash

    // direction: cheated sun, or the strike while swinging (hard switch = the shadow snaps)
    var dir = st.sunDirShadow
    if w > 0.5 { dir = swingDir }
    state.direction = dir

    // intensity & colour (Color.lerp: c + (target − c)·α; MathUtils.lerp: (1 − t)·x + t·y)
    let sunI = st.sunIntensity
    state.intensity = sunI * (1 - w) + JS.max(sunI, flash * 5) * w
    state.color = SunRig.lerp(st.sunColor, st.flashColor, w)
    state.shadowIntensity = (1 - w) * st.shadowIntensity + w * 0.9
    state.shadowRadius = (1 - w) * st.shadowRadius + w * 1.5

    state.hemiColor = SunRig.lerp(st.ambient, st.flashColor, JS.min(1, flash * 0.8))
    state.hemiGroundColor = st.ambientGround
    state.hemiIntensity = st.ambientIntensity * (1 + 3 * flash)

    // shadow box: midway between the heli and its shadow on the water; camera focus fallback
    let h = JS.max(0.05, dir.y)
    let hz = JS.hypot(dir.x, dir.z)
    let horiz = hz == 0 || hz.isNaN ? 1 : hz             // `Math.hypot(...) || 1`
    let off = JS.min(alt, 140) * (horiz / h) * 0.5
    var c = V3(focus.x - (dir.x / horiz) * off, 0, focus.z - (dir.z / horiz) * off)
    if let cf = camFocus, JS.hypot(cf.x - c.x, cf.z - c.z) > 160 { c = V3(cf.x, 0, cf.z) }

    // texel snapping in light space (axes of the shadow camera's lookAt basis)
    var R = ThreeVec.cross(V3(0, 1, 0), dir)
    if ThreeVec.lengthSq(R) < 1e-6 { R = V3(1, 0, 0) }
    R = ThreeVec.normalize(R)
    let U = ThreeVec.normalize(ThreeVec.cross(dir, R))
    let texel = SunRig.BOX / Double(state.mapSize)
    let r = ThreeVec.dot(c, R)
    let u = ThreeVec.dot(c, U)
    c = SunRig.addScaled(c, R, JS.round(r / texel) * texel - r)
    c = SunRig.addScaled(c, U, JS.round(u / texel) * texel - u)

    state.target = c
    state.position = SunRig.addScaled(c, dir, SunRig.DIST)
    return state
  }

  @inline(__always) static func addScaled(_ a: V3, _ v: V3, _ s: Double) -> V3 {
    V3(a.x + v.x * s, a.y + v.y * s, a.z + v.z * s)
  }

  /// THREE.Color.lerp: r += (target.r − r) · alpha (per channel).
  @inline(__always) static func lerp(_ a: PaletteColor, _ b: PaletteColor, _ t: Double) -> PaletteColor {
    PaletteColor(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
  }
}

/// three LightShadow.updateMatrices(light) for the sun's OrthographicCamera(−125, 125, 125, −125, 1, 940).
public struct ShadowCamera: Equatable {
  public var projection: ThreeMatrix4         // shadow.camera.projectionMatrix (WebGL clip)
  public var pose: ThreeCameraPose            // shadow.camera matrixWorld / matrixWorldInverse
  public var viewProjection: ThreeMatrix4     // _projScreenMatrix = projection · matrixWorldInverse
  public var shadowMatrix: ThreeMatrix4       // shadow.matrix = bias(0.5…) · _projScreenMatrix (three, GL uv)

  public init(position: V3, target: V3) {
    let half = SunRig.BOX / 2
    projection = ThreeMatrix4.orthographicCamera(left: -half, right: half, top: half, bottom: -half,
                                                 near: SunRig.CAMERA_NEAR, far: SunRig.CAMERA_FAR)
    pose = ThreeCameraPose(position: position, target: target)
    viewProjection = ThreeMatrix4.multiply(projection, pose.matrixWorldInverse)
    let bias = ThreeMatrix4(elements: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1])
    shadowMatrix = ThreeMatrix4.multiply(bias, viewProjection)
  }

  public init(_ s: SunRigState) { self.init(position: s.position, target: s.target) }
}
