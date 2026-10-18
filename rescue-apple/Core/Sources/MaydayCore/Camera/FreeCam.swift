// camera/freecam.js FreeCam: the photo-mode free camera (CONTRACT «Depth pass additions»).
// Orbit / pan / zoom / height around a pivot, starting from the exact follow framing.
//   mouse: LMB drag orbit, RMB (or Shift+LMB) drag pan, wheel zoom
//   keys:  WASD / arrows pan, Q/E (R/F, PgUp/PgDn) height  (through input.axesValues)
//   pad:   left stick pan, right stick orbit, LT/RT height, LB/RB zoom
// Every control drives a target that the camera eases toward (no snaps). The horizon stays out of
// frame: the top edge of the view must meet the sea within ~700 m.
//
// The web steals wheel events with a capture listener while the photo mode is up (so the heli never
// sees them); the host calls `wheel(deltaY:)` instead while ctx.photoActive(). Touch gestures (PLAN X9)
// drive the same targets from MaydayApp's PhotoGestures.

public final class FreeCam {
  static let DEG: Double = JS.PI / 180
  public static let PITCH_MAX: Double = 89.5 * DEG
  public static let DIST_MIN: Double = 8
  public static let DIST_MAX: Double = 700
  /// m — the top-of-frame ray must hit the sea within this
  public static let SEA_REACH: Double = 700

  @inline(__always) static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double { JS.min(b, JS.max(a, v)) }

  /// target pivot / yaw / pitch (angle of the view axis below the horizon) / distance
  public var pivot = V3()
  public var yaw: Double = 0
  public var pitch: Double = 60 * DEG
  public var dist: Double = 150
  /// eased pivot (the camera looks at it) and eased yaw / pitch / distance
  public internal(set) var p = V3()
  public internal(set) var easedYaw: Double = 0
  public internal(set) var easedPitch: Double = 60 * DEG
  public internal(set) var easedDist: Double = 150
  /// camera position (the last update's result)
  public internal(set) var position = V3()
  var mx: Double = 0
  var my: Double = 0
  var wheelAcc: Double = 0

  public init() {}

  /// A wheel event while the photo mode is up: sign(deltaY) accumulates until the next update.
  public func wheel(deltaY: Double) {
    wheelAcc += JS.sign(deltaY)
  }

  /// Start from the current camera pose looking at `look`.
  public func begin(_ cam: PerspectiveCamera, _ look: V3, _ mouse: MouseState?) {
    pivot = look
    let dx = cam.position.x - look.x
    let dy = cam.position.y - look.y
    let dz = cam.position.z - look.z
    dist = FreeCam.clamp(JS.hypot(dx, dy, dz), FreeCam.DIST_MIN, FreeCam.DIST_MAX)
    yaw = JS.atan2(dx, dz)
    pitch = FreeCam.clamp(JS.asin(FreeCam.clamp(dy / JS.max(1e-3, JS.hypot(dx, dy, dz)), -1, 1)), 5 * FreeCam.DEG, FreeCam.PITCH_MAX)
    p = pivot
    easedYaw = yaw
    easedPitch = pitch
    easedDist = dist
    mx = mouse?.x ?? 0
    my = mouse?.y ?? 0
    wheelAcc = 0
  }

  /// dt = real seconds. Returns the camera position (`position`); look at `p`.
  public func update(_ dt: Double, _ ctx: SimContext, _ fovDeg: Double, _ areaRadius: Double = 1500) -> V3 {
    let input = ctx.input
    let A = input?.axesValues ?? [:]
    let mouse = input?.mouse
    let pad = input?.gamepads.first { $0?.connected == true } ?? nil
    let screenH = JS.max(1, JSNumber.or(ctx.viewportHeight, 720))
    let fovR = fovDeg * FreeCam.DEG

    // --- mouse drag: orbit (LMB) / pan (RMB, Shift+LMB) ---------------------------------------------
    let mxNow = mouse?.x ?? mx
    let myNow = mouse?.y ?? my
    let dxm = mxNow - mx
    let dym = myNow - my
    mx = mxNow
    my = myNow
    let lmb = input?.mouseButtons.contains("Mouse0") ?? false
    let rmb = input?.mouseButtons.contains("Mouse2") ?? false
    let shift = (input?.keys.contains("ShiftLeft") ?? false) || (input?.keys.contains("ShiftRight") ?? false)
    let sy = JS.sin(yaw)
    let cy = JS.cos(yaw)
    // screen-right and screen-up (forward) directions on the sea plane
    let rx = cy, rz = -sy, fx = -sy, fz = -cy
    let upp = (2 * dist * JS.tan(fovR / 2)) / screenH // metres per CSS px at the pivot
    if lmb && !shift {
      yaw -= dxm * 0.005
      pitch += dym * 0.004
    } else if rmb || (lmb && shift) {
      pivot.x -= (rx * dxm - fx * dym) * upp
      pivot.z -= (rz * dxm - fz * dym) * upp
    }

    // --- sticks / keys -----------------------------------------------------------------------------
    let panS = JS.max(12, dist * 0.9) * dt
    let mvx = JSNumber.or(A[.moveX], 0)
    let mvy = JSNumber.or(A[.moveY], 0)
    pivot.x += (rx * mvx + fx * mvy) * panS
    pivot.z += (rz * mvx + fz * mvy) * panS
    yaw -= JSNumber.or(A[.aimX], 0) * 1.6 * dt
    pitch -= JSNumber.or(A[.aimY], 0) * 0.9 * dt
    pivot.y = FreeCam.clamp(pivot.y + JSNumber.or(A[.lift], 0) * JS.max(10, dist * 0.5) * dt, 0, 300)

    // --- zoom: wheel, pad LB/RB ----------------------------------------------------------------------
    let wheel = wheelAcc
    wheelAcc = 0
    if JSNumber.isTruthy(wheel) { dist *= JS.pow(1.12, FreeCam.clamp(wheel, -4, 4)) }
    let zIn: Double = (pad?.buttons.count ?? 0) > 5 && (pad?.buttons[5].pressed ?? false) ? 1 : 0
    let zOut: Double = (pad?.buttons.count ?? 0) > 4 && (pad?.buttons[4].pressed ?? false) ? 1 : 0
    if zIn != 0 || zOut != 0 { dist *= JS.exp((zOut - zIn) * 1.2 * dt) }
    dist = FreeCam.clamp(dist, FreeCam.DIST_MIN, FreeCam.DIST_MAX)

    // keep the pivot over the play area
    let pr = JS.hypot(pivot.x, pivot.z)
    let lim = areaRadius + 400
    if pr > lim {
      pivot.x *= lim / pr
      pivot.z *= lim / pr
    }
    // no horizon: tan(pitch − fov/2) ≥ camY / SEA_REACH
    let camY = pivot.y + dist * JS.sin(pitch)
    let minPitch = fovR / 2 + JS.atan(JS.max(0, camY) / FreeCam.SEA_REACH) + 2 * FreeCam.DEG
    pitch = FreeCam.clamp(pitch, JS.min(minPitch, FreeCam.PITCH_MAX - 0.01), FreeCam.PITCH_MAX)

    // --- ease toward the targets -----------------------------------------------------------------------
    let k = 1 - JS.exp(-dt * 9)
    p.lerp(pivot, k)
    easedYaw += (yaw - easedYaw) * k
    easedPitch += (pitch - easedPitch) * k
    easedDist += (dist - easedDist) * k

    let cp = JS.cos(easedPitch)
    var o = V3(p.x + easedDist * cp * JS.sin(easedYaw), p.y + easedDist * JS.sin(easedPitch), p.z + easedDist * cp * JS.cos(easedYaw))
    // never under the waves
    let sea = JSNumber.or(ctx.ocean?.heightAt(o.x, o.z), 0)
    if o.y < sea + 2.5 { o.y = sea + 2.5 }
    position = o
    return o
  }
}
