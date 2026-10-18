// CameraMatrices — three.js camera conventions → Metal (PLAN §2.5 «Конвенции координат»).
//
// The CPU keeps the GL projection of three (makePerspective, z ∈ [−1, 1]) in Double — the same matrix
// Core will use for worldToScreen / screenToWater / HUD — and only the GPU copy is multiplied by
// glToMetal (z' = 0.5·z + 0.5·w). No reverse-Z (near 2, far 1200, depth32Float).
// World: Y up, north = −Z, east = +X. Faces: CCW = front.
// Parity: the camera follows three r185 step by step with MaydayCore's three math (V3 / Mat4 / Quat,
// vector-tested): Object3D.lookAt (rotation basis → quaternion), updateMatrixWorld (compose) and
// Camera.updateMatrixWorld's view rule (ShadowCamera.viewMatrix), PerspectiveCamera.updateProjectionMatrix
// with fdlibm tan — so view / projection are the web's doubles (SunRigGoldenTests checks the same path on
// the shadow camera). TODO(Core): move into MaydayCore with a PerspectiveCamera vector once Core needs it.
import Foundation
import simd
import MaydayCore

public struct CameraState {
  public var position: SIMD3<Double>
  public var target: SIMD3<Double>
  public var up: SIMD3<Double>
  public var fovDeg: Double        // vertical FOV (three PerspectiveCamera.fov)
  public var near: Double
  public var far: Double
  public var zoom: Double          // three PerspectiveCamera.zoom (always 1 in the game)
  /// three PerspectiveCamera.aspect: CSS width / height in points (main.js onResize), the projection the
  /// web draws with and Core's PerspectiveCamera picks / projects the HUD with. It differs slightly from
  /// the internal pixel size, floor(points × pixelRatio), at fractional ratios. nil = that pixel size's
  /// ratio (offscreen renders, goldens).
  public var aspect: Double?

  public init(position: SIMD3<Double>, target: SIMD3<Double>, up: SIMD3<Double> = SIMD3(0, 1, 0),
              fovDeg: Double = 40, near: Double = 2, far: Double = 1200, zoom: Double = 1, aspect: Double? = nil) {
    self.position = position
    self.target = target
    self.up = up
    self.fovDeg = fovDeg
    self.near = near
    self.far = far
    self.zoom = zoom
    self.aspect = aspect
  }
}

public struct CameraMatrices {
  public var view: simd_double4x4          // camera.matrixWorldInverse
  public var projGL: simd_double4x4        // camera.projectionMatrix (WebGL clip space)
  public var projMetal: simd_double4x4     // glToMetal × projGL
  public var viewProjMetal: simd_double4x4
  public var cameraWorld: simd_double4x4   // camera.matrixWorld

  /// Metal clip z from GL clip z: z' = 0.5·z + 0.5·w (column-major; row 2 = [0, 0, 0.5, 0.5]).
  public static let glToMetal = simd_double4x4(columns: (
    SIMD4<Double>(1, 0, 0, 0),
    SIMD4<Double>(0, 1, 0, 0),
    SIMD4<Double>(0, 0, 0.5, 0),
    SIMD4<Double>(0, 0, 0.5, 1)))

  public init(camera c: CameraState, aspect: Double) {
    let eye = V3(c.position.x, c.position.y, c.position.z)
    let world = CameraMatrices.lookAtWorld(eye: eye, target: V3(c.target.x, c.target.y, c.target.z), up: V3(c.up.x, c.up.y, c.up.z))
    cameraWorld = CameraMatrices.toDouble(world)
    view = CameraMatrices.toDouble(ShadowCamera.viewMatrix(world: world))
    projGL = CameraMatrices.perspectiveGL(fovDeg: c.fovDeg, aspect: aspect, near: c.near, far: c.far, zoom: c.zoom)
    projMetal = CameraMatrices.glToMetal * projGL
    viewProjMetal = projMetal * view
  }

  /// three PerspectiveCamera.updateProjectionMatrix() + Matrix4.makePerspective (WebGL coordinate system).
  public static func perspectiveGL(fovDeg: Double, aspect: Double, near: Double, far: Double, zoom: Double = 1) -> simd_double4x4 {
    // three: near * Math.tan(DEG2RAD * 0.5 * fov) / zoom, DEG2RAD = Math.PI / 180
    let top = near * JS.tan((JS.PI / 180) * 0.5 * fovDeg) / zoom
    let height = 2 * top
    let width = aspect * height
    let left = -0.5 * width
    let right = left + width
    let bottom = top - height
    let x = 2 * near / (right - left)
    let y = 2 * near / (top - bottom)
    let a = (right + left) / (right - left)
    let b = (top + bottom) / (top - bottom)
    let c = -(far + near) / (far - near)
    let d = -2 * far * near / (far - near)
    return simd_double4x4(columns: (
      SIMD4<Double>(x, 0, 0, 0),
      SIMD4<Double>(0, y, 0, 0),
      SIMD4<Double>(a, b, c, -1),
      SIMD4<Double>(0, 0, d, 0)))
  }

  /// camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld() for an unparented camera:
  /// Matrix4.lookAt(position, target, up) → quaternion.setFromRotationMatrix → matrix.compose(position, q, 1).
  public static func lookAtWorld(eye: V3, target: V3, up: V3) -> Mat4 {
    var rot = Mat4()
    rot.lookAt(eye, target, up)
    var q = Quat()
    q.setFromRotationMatrix(rot)
    var m = Mat4()
    m.compose(eye, q, V3(1, 1, 1))
    return m
  }

  /// Mat4 (three elements, column-major) → simd_double4x4.
  public static func toDouble(_ m: Mat4) -> simd_double4x4 {
    simd_double4x4(columns: (SIMD4<Double>(m[0], m[1], m[2], m[3]), SIMD4<Double>(m[4], m[5], m[6], m[7]),
                             SIMD4<Double>(m[8], m[9], m[10], m[11]), SIMD4<Double>(m[12], m[13], m[14], m[15])))
  }

  /// Camera forward (world) = −third row of the view rotation = −(V[0][2], V[1][2], V[2][2]).
  public var forward: SIMD3<Double> {
    SIMD3<Double>(-view.columns.0.z, -view.columns.1.z, -view.columns.2.z)
  }

  /// core/look.js fog patch: lookFocus = lookFwd.xz · camY / max(−lookFwd.y, 0.25) (offset from the camera).
  public func fogFocus(cameraY: Double) -> SIMD2<Double> {
    let f = forward
    let k = cameraY / max(-f.y, 0.25)
    return SIMD2<Double>(f.x * k, f.z * k)
  }

  public static func toFloat(_ m: simd_double4x4) -> simd_float4x4 {
    simd_float4x4(columns: (
      SIMD4<Float>(Float(m.columns.0.x), Float(m.columns.0.y), Float(m.columns.0.z), Float(m.columns.0.w)),
      SIMD4<Float>(Float(m.columns.1.x), Float(m.columns.1.y), Float(m.columns.1.z), Float(m.columns.1.w)),
      SIMD4<Float>(Float(m.columns.2.x), Float(m.columns.2.y), Float(m.columns.2.z), Float(m.columns.2.w)),
      SIMD4<Float>(Float(m.columns.3.x), Float(m.columns.3.y), Float(m.columns.3.z), Float(m.columns.3.w))))
  }
}
