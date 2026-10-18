// THREE.PerspectiveCamera (three.js r185: Object3D → Camera → PerspectiveCamera) for the game camera
// `ctx.camera`, in Double with three's operation order, so view / projection / worldToScreen /
// screenToWater are the web's doubles (Tests/Vectors/camera/*.json). The camera has no parent in the
// web (main.js never adds it to the scene), so matrixWorld = matrix.
//
// Kept: position, quaternion (scale 1), up, fov / aspect / near / far / zoom, lookAt, rotateX/Y/Z,
// updateMatrixWorld (with Camera's r185 view rule), updateProjectionMatrix (no view offset, filmOffset 0).
// A reference type like three's: the rig places it, the heli reads its position, the host sets aspect.
// GL conventions (clip z ∈ [−1, 1]); MaydayRender's CameraMatrices converts to Metal.

public final class PerspectiveCamera {
  public var position = V3()
  public var quaternion = Quat()
  public var up = V3(0, 1, 0)
  /// vertical field of view, degrees
  public var fov: Double
  public var aspect: Double
  public var near: Double
  public var far: Double
  public var zoom: Double = 1

  public private(set) var matrixWorld = Mat4()
  public private(set) var matrixWorldInverse = Mat4()
  public private(set) var projectionMatrix = Mat4()
  public private(set) var projectionMatrixInverse = Mat4()

  /// main.js: new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 2, 1200); position (0, 220, 60); lookAt(0, 0, 0)
  public init(fov: Double = 40, aspect: Double = 1280.0 / 720.0, near: Double = 2, far: Double = 1200) {
    self.fov = fov
    self.aspect = aspect
    self.near = near
    self.far = far
    updateProjectionMatrix()
  }

  /// The main.js start pose: position (0, 220, 60), lookAt(0, 0, 0).
  public func setMainStartPose() {
    position.set(0, 220, 60)
    lookAt(V3(0, 0, 0))
  }

  /// Object3D.updateMatrix() for scale 1: matrix.compose(position, quaternion, scale).
  @inline(__always) func localMatrix() -> Mat4 {
    var m = Mat4()
    m.compose(position, quaternion, V3(1, 1, 1))
    return m
  }

  /// Object3D.lookAt(target) for a camera without parent: updateWorldMatrix(true, false) (which also
  /// refreshes matrixWorldInverse in r185's Camera), position from matrixWorld, then
  /// quaternion.setFromRotationMatrix(m1.lookAt(position, target, up)).
  public func lookAt(_ target: V3) {
    updateMatrixWorld()
    let eye = V3(matrixWorld[12], matrixWorld[13], matrixWorld[14])
    var m1 = Mat4()
    m1.lookAt(eye, target, up)
    quaternion.setFromRotationMatrix(m1)
  }

  /// rotateOnAxis(axis, angle): q1.setFromAxisAngle(axis, angle); quaternion.multiply(q1)
  public func rotateOnAxis(_ axis: V3, _ angle: Double) {
    var q1 = Quat()
    q1.setFromAxisAngle(axis, angle)
    quaternion.multiply(q1)
  }

  public func rotateX(_ angle: Double) { rotateOnAxis(V3(1, 0, 0), angle) }
  public func rotateY(_ angle: Double) { rotateOnAxis(V3(0, 1, 0), angle) }
  public func rotateZ(_ angle: Double) { rotateOnAxis(V3(0, 0, 1), angle) }

  /// Camera.updateMatrixWorld(): matrixWorld = compose(position, quaternion, 1); then r185's view rule:
  /// matrixWorld.decompose(p, q, s); s exactly (1, 1, 1) → matrixWorldInverse = inverse(matrixWorld),
  /// else inverse(compose(p, q, (1, 1, 1))).
  public func updateMatrixWorld() {
    matrixWorld = localMatrix()
    let d = matrixWorld.decompose()
    var inv = matrixWorld
    if !(d.scale.x == 1 && d.scale.y == 1 && d.scale.z == 1) {
      inv = Mat4()
      inv.compose(d.position, d.quaternion, V3(1, 1, 1))
    }
    inv.invert()
    matrixWorldInverse = inv
  }

  /// PerspectiveCamera.updateProjectionMatrix(): top = near·tan(DEG2RAD·0.5·fov)/zoom, height = 2·top,
  /// width = aspect·height, left = −0.5·width; makePerspective(left, left + width, top, top − height, near, far).
  public func updateProjectionMatrix() {
    let n = near
    let top = n * JS.tan(MathUtils.DEG2RAD * 0.5 * fov) / zoom
    let height = 2 * top
    let width = aspect * height
    let left = -0.5 * width
    var m = Mat4()
    m.makePerspective(left, left + width, top, top - height, n, far)
    projectionMatrix = m
    var inv = m
    inv.invert()
    projectionMatrixInverse = inv
  }

  /// Vector3.project(camera)
  public func project(_ v: V3) -> V3 {
    var o = v
    o.project(matrixWorldInverse: matrixWorldInverse, projectionMatrix: projectionMatrix)
    return o
  }

  /// Vector3.unproject(camera)
  public func unproject(_ v: V3) -> V3 {
    var o = v
    o.unproject(projectionMatrixInverse: projectionMatrixInverse, matrixWorld: matrixWorld)
    return o
  }
}
