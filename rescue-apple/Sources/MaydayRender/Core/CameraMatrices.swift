// CameraMatrices — three.js camera conventions → Metal (PLAN §2.5 «Конвенции координат»).
//
// The CPU keeps the GL projection of three (makePerspective, z ∈ [−1, 1]) in Double — the same matrix
// Core will use for worldToScreen / screenToWater / HUD — and only the GPU copy is multiplied by
// glToMetal (z' = 0.5·z + 0.5·w). No reverse-Z (near 2, far 1200, depth32Float).
// World: Y up, north = −Z, east = +X. Faces: CCW = front.
// Parity: tan comes from MaydayCore.JS (fdlibm, = V8's Math.tan) and the vector steps of lookAt are
// written out in three's operation order (Vector3.crossVectors, length = √(x²+y²+z²) summed left to
// right, normalize = multiplyScalar(1 / (length || 1))) instead of simd_cross / simd_normalize, which
// may fuse or use rsqrt on Apple. TODO(before Core uses it): move this file into MaydayCore with a
// test vector exported from three's PerspectiveCamera (lookAt + updateProjectionMatrix; three also
// round-trips the rotation through a quaternion, which this direct basis does not reproduce).
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

  public init(position: SIMD3<Double>, target: SIMD3<Double>, up: SIMD3<Double> = SIMD3(0, 1, 0),
              fovDeg: Double = 40, near: Double = 2, far: Double = 1200, zoom: Double = 1) {
    self.position = position
    self.target = target
    self.up = up
    self.fovDeg = fovDeg
    self.near = near
    self.far = far
    self.zoom = zoom
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
    cameraWorld = CameraMatrices.lookAtWorld(eye: c.position, target: c.target, up: c.up)
    view = CameraMatrices.viewFromLookAt(world: cameraWorld, eye: c.position)
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

  /// three Matrix4.lookAt(eye, target, up) as used by Object3D.lookAt for cameras, with the
  /// camera position as translation (camera.matrixWorld for an unparented camera, scale 1).
  public static func lookAtWorld(eye: SIMD3<Double>, target: SIMD3<Double>, up: SIMD3<Double>) -> simd_double4x4 {
    var z = SIMD3<Double>(eye.x - target.x, eye.y - target.y, eye.z - target.z)
    if lengthSq3(z) == 0 { z.z = 1 }
    z = normalize3(z)
    var x = cross3(up, z)
    if lengthSq3(x) == 0 {
      if Swift.abs(up.z) == 1 { z.x += 0.0001 } else { z.z += 0.0001 }
      z = normalize3(z)
      x = cross3(up, z)
    }
    x = normalize3(x)
    let y = cross3(z, x)
    return simd_double4x4(columns: (
      SIMD4<Double>(x.x, x.y, x.z, 0),
      SIMD4<Double>(y.x, y.y, y.z, 0),
      SIMD4<Double>(z.x, z.y, z.z, 0),
      SIMD4<Double>(eye.x, eye.y, eye.z, 1)))
  }

  /// three Vector3.lengthSq: x·x + y·y + z·z, left to right, no fused multiply-add.
  @inline(__always) static func lengthSq3(_ v: SIMD3<Double>) -> Double {
    let xx = v.x * v.x, yy = v.y * v.y, zz = v.z * v.z
    return xx + yy + zz
  }

  /// three Vector3.normalize: divideScalar(length() || 1) = multiplyScalar(1 / (length || 1)).
  @inline(__always) static func normalize3(_ v: SIMD3<Double>) -> SIMD3<Double> {
    let len = JS.sqrt(lengthSq3(v))
    let s = 1 / (len == 0 || len.isNaN ? 1 : len)
    return SIMD3<Double>(v.x * s, v.y * s, v.z * s)
  }

  /// three Vector3.crossVectors(a, b), component by component.
  @inline(__always) static func cross3(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> SIMD3<Double> {
    let ayb = a.y * b.z, azb = a.z * b.y
    let azx = a.z * b.x, axz = a.x * b.z
    let axy = a.x * b.y, ayx = a.y * b.x
    return SIMD3<Double>(ayb - azb, azx - axz, axy - ayx)
  }

  /// Inverse of a rigid camera matrix [R | eye]: [Rᵀ | −Rᵀ·eye].
  public static func viewFromLookAt(world m: simd_double4x4, eye: SIMD3<Double>) -> simd_double4x4 {
    let x = SIMD3<Double>(m.columns.0.x, m.columns.0.y, m.columns.0.z)
    let y = SIMD3<Double>(m.columns.1.x, m.columns.1.y, m.columns.1.z)
    let z = SIMD3<Double>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
    return simd_double4x4(columns: (
      SIMD4<Double>(x.x, y.x, z.x, 0),
      SIMD4<Double>(x.y, y.y, z.y, 0),
      SIMD4<Double>(x.z, y.z, z.z, 0),
      SIMD4<Double>(-simd_dot(x, eye), -simd_dot(y, eye), -simd_dot(z, eye), 1)))
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
