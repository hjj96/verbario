// CameraRig.worldToScreen / screenToWater (systems/camera.js) as free functions of the game camera and
// the viewport, in three.js GL conventions: NDC x right, y up, z ∈ [−1, 1] (behind the camera z > 1);
// screen px from the top-left. MaydayRender's CameraMatrices converts the matrices to Metal's clip
// space; these stay GL so they match the web's doubles (Tests/Vectors/camera/projection.json).

/// worldToScreen(v, out): { x, y, ndcX, ndcY, behind, onScreen }
public struct ScreenPoint: Equatable, Sendable {
  public var x: Double = 0
  public var y: Double = 0
  public var ndcX: Double = 0
  public var ndcY: Double = 0
  public var behind = false
  public var onScreen = false

  public init() {}
}

public enum Projection {
  /// worldToScreen: v.project(camera); px = (ndc·0.5 + 0.5)·size with y flipped.
  public static func worldToScreen(_ v: V3, camera: PerspectiveCamera, width: Double, height: Double) -> ScreenPoint {
    let p = camera.project(v)
    var out = ScreenPoint()
    out.x = (p.x * 0.5 + 0.5) * width
    out.y = (-p.y * 0.5 + 0.5) * height
    out.ndcX = p.x
    out.ndcY = p.y
    out.behind = p.z > 1
    out.onScreen = !out.behind && JS.abs(p.x) <= 1 && JS.abs(p.y) <= 1
    return out
  }

  /// Ray through the screen point → hit on the sea plane y = 0 (cursor aim); a ray at or above the
  /// horizon returns the point 400 m along it (on y = 0).
  public static func screenToWater(_ ndcX: Double, _ ndcY: Double, camera: PerspectiveCamera) -> V3 {
    var o = V3()
    o.setFromMatrixPosition(camera.matrixWorld)
    var d = camera.unproject(V3(ndcX, ndcY, 0.5))
    d.sub(o)
    d.normalize()
    if d.y > -1e-4 { return V3(o.x + d.x * 400, 0, o.z + d.z * 400) }
    let t = -o.y / d.y
    return V3(o.x + d.x * t, 0, o.z + d.z * t)
  }
}
