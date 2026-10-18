// SunRig — port of rescue/src/systems/weather/lights.js (WeatherLights) in Double with three's operation
// order (PLAN §2.9 weather/lights.js row: SunRig + LightRig/ShadowPass; DESIGN §2.7.1–2.7.2):
//   * the sun/moon DirectionalLight — the only shadow caster: shadow box 250 m centred between the heli
//     and its shadow (the «shadow altimeter» stays in the map), texel-snapped in light space, map
//     512 / 1024 / 2048 by quality, PCF radius and shadow.intensity per preset, bias −0.0004,
//     normalBias 0.6, cheated (clamped) elevation st.sunDirShadow;
//   * the lightning swing: the key light snaps toward the strike for 0.3 s (+0.12 s fade);
//   * the HemisphereLight: palette ambient / ambientGround, ×(1 + 3·flash).
// Output is the light state three would render with; ShadowCamera turns it into the shadow matrices.
// Three's vector / matrix steps come from MaydayCore (Math/Three: V3, Mat4, Quat — three r185 operation
// order, vector-tested). Bit-exact against the real WeatherLights and LightShadow.updateMatrices
// (Tests/Goldens/lighting/sunrig.json, MaydayRenderTests/SunRigGoldenTests).
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
    var R = V3.cross(V3(0, 1, 0), dir)
    if R.lengthSq < 1e-6 { R = V3(1, 0, 0) }
    R = R.normalized()
    let U = V3.cross(dir, R).normalized()
    let texel = SunRig.BOX / Double(state.mapSize)
    let r = c.dot(R)
    let u = c.dot(U)
    c.addScaled(R, JS.round(r / texel) * texel - r)
    c.addScaled(U, JS.round(u / texel) * texel - u)

    state.target = c
    var p = c
    p.addScaled(dir, SunRig.DIST)
    state.position = p
    return state
  }

  /// THREE.Color.lerp: r += (target.r − r) · alpha (per channel).
  @inline(__always) static func lerp(_ a: PaletteColor, _ b: PaletteColor, _ t: Double) -> PaletteColor {
    PaletteColor(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
  }
}

/// three LightShadow.updateMatrices(light) for the sun's OrthographicCamera(−125, 125, 125, −125, 1, 940):
/// the camera moves to the light's world position, lookAt(target) (Object3D.lookAt for cameras: rotation
/// basis → quaternion), updateMatrixWorld (compose; matrixWorldInverse by r185's decompose rule), and
/// shadow.matrix = bias × projection × matrixWorldInverse (WebGL coordinate system, no reversed depth).
public struct ShadowCamera: Equatable {
  public var projection: Mat4          // shadow.camera.projectionMatrix (WebGL clip)
  public var quaternion: Quat          // shadow.camera.quaternion
  public var matrixWorld: Mat4         // shadow.camera.matrixWorld
  public var matrixWorldInverse: Mat4  // shadow.camera.matrixWorldInverse
  public var viewProjection: Mat4      // _projScreenMatrix = projection · matrixWorldInverse
  public var shadowMatrix: Mat4        // shadow.matrix = bias(0.5 …) · _projScreenMatrix (three, GL uv)

  public init(position: V3, target: V3) {
    projection = ShadowCamera.projection(left: -SunRig.BOX / 2, right: SunRig.BOX / 2, top: SunRig.BOX / 2,
                                         bottom: -SunRig.BOX / 2, near: SunRig.CAMERA_NEAR, far: SunRig.CAMERA_FAR)
    var rot = Mat4()
    rot.lookAt(position, target, V3(0, 1, 0))     // isCamera: _m1.lookAt(_position, _target, up)
    var q = Quat()
    q.setFromRotationMatrix(rot)
    quaternion = q
    var world = Mat4()
    world.compose(position, q, V3(1, 1, 1))
    matrixWorld = world
    matrixWorldInverse = ShadowCamera.viewMatrix(world: world)
    var vp = Mat4()
    vp.multiplyMatrices(projection, matrixWorldInverse)
    viewProjection = vp
    var sm = Mat4(0.5, 0, 0, 0.5,
                  0, 0.5, 0, 0.5,
                  0, 0, 0.5, 0.5,
                  0, 0, 0, 1)
    sm.multiply(vp)
    shadowMatrix = sm
  }

  public init(_ s: SunRigState) { self.init(position: s.position, target: s.target) }

  /// r185 Camera.updateMatrixWorld: matrixWorld.decompose(p, q, s); s exactly (1, 1, 1) → inverse of
  /// matrixWorld, else the inverse of compose(p, q, (1, 1, 1)) — a camera's view never carries scale. A
  /// matrix composed from a unit quaternion usually decomposes to a scale a few ulp off 1 (second path).
  static func viewMatrix(world: Mat4) -> Mat4 {
    let d = world.decompose()
    var m = world
    if !(d.scale.x == 1 && d.scale.y == 1 && d.scale.z == 1) {
      m = Mat4()
      m.compose(d.position, d.quaternion, V3(1, 1, 1))
    }
    m.invert()
    return m
  }

  /// OrthographicCamera.updateProjectionMatrix() (zoom 1, no view offset).
  static func projection(left: Double, right: Double, top: Double, bottom: Double, near: Double, far: Double) -> Mat4 {
    let zoom = 1.0
    let dx = (right - left) / (2 * zoom)
    let dy = (top - bottom) / (2 * zoom)
    let cx = (right + left) / 2
    let cy = (top + bottom) / 2
    var m = Mat4()
    m.makeOrthographic(cx - dx, cx + dx, cy + dy, cy - dy, near, far)
    return m
  }
}
