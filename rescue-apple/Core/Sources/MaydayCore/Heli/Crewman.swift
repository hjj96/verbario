// heli/crewman.js Crewman (DESIGN §4 #9 [NICE]): the hoist operator kneeling in the open starboard
// door. He leans out over the sill while the winch works, guides the cable with the forward hand and
// points the aft arm at winch.target (or the basket), the arm limited to 70° from its rest pose (out and
// down); the head follows at ~60 %. The figure is a child of the airframe body (it pitches and banks
// with it); the meshes are baked (heli_crew_*.mmesh) — this is the pose as pure data for the renderer:
// group visibility / position (body frame, scale 1.4), the arm and head quaternions (crew-local).

public struct CrewmanPose: Equatable, Sendable {
  public var visible = false
  /// group.position in the airframe body frame (scale SCALE on all axes)
  public var position = Crewman.ORIGIN
  /// pointing arm (pivot at SHOULDER_AIM, the mesh points along +x)
  public var arm = Quat()
  /// head (pivot at NECK)
  public var head = Quat()
}

public final class Crewman {
  public static let LIMIT: Double = (70 * JS.PI) / 180
  /// arm rest direction (out and down)
  public static let REST: V3 = {
    var v = V3(0.8, -0.6, 0)
    v.normalize()
    return v
  }()
  static let X = V3(1, 0, 0)
  /// Crew-local frame: origin on the cabin floor at the door sill, +x outward (starboard), +y up, +z aft.
  /// ORIGIN is in the airframe body frame.
  public static let ORIGIN = V3(1.12, -0.9, -0.9)
  /// figures are drawn ~1.4× like the rescue swimmer so they read from the drone
  public static let SCALE: Double = 1.4
  /// pointing (aft) shoulder
  public static let SHOULDER_AIM = V3(0.2, 0.92, 0.19)
  public static let NECK = V3(0.27, 1.0, 0)

  /// 0 = inside the cabin, 1 = leaning out over the sill
  public internal(set) var lean: Double = 0
  public internal(set) var pose = CrewmanPose()
  let ctx: SimContext

  init(ctx: SimContext) {
    self.ctx = ctx
    reset()
  }

  public func reset() {
    lean = 0
    pose.visible = false
    pose.arm.setFromUnitVectors(Crewman.X, Crewman.REST)
    pose.head.identity()
  }

  /// Per rendered frame, after the airframe transforms are up to date (`body` = body.matrixWorld).
  func update(_ dt: Double, _ heli: Helicopter, body: Mat4) {
    let w = heli.winch
    let target = w.target.flatMap { ctx.survivors?.group($0) }
    let working = heli.alive && !heli.ditched && (w.state != .stowed || w.length > 0.05 || w.target != nil)
    let k = 1 - JS.exp(-dt * (working ? 3.5 : 2.5))
    lean += ((working ? 1 : 0) - lean) * k
    if !working && lean < 0.02 { lean = 0 }
    pose.visible = lean > 0.02
    if !pose.visible { return }
    // slide out of the dark cabin onto the sill
    pose.position.set(Crewman.ORIGIN.x - 0.55 * (1 - lean), Crewman.ORIGIN.y, Crewman.ORIGIN.z)
    var local = Mat4()
    local.compose(pose.position, Quat(), V3(Crewman.SCALE, Crewman.SCALE, Crewman.SCALE))
    var group = Mat4()
    group.multiplyMatrices(body, local)

    // aim: the target person (or deck), else the basket / load
    var t = V3()
    if let tp = target?.position, (tp.x + tp.z).isFinite {
      t.set(tp.x, tp.y.isFinite ? tp.y : w.basket.y, tp.z)
    } else {
      t = w.basket
    }
    var inv = group
    inv.invert()
    t.applyMatrix4(inv) // crew-local (scaled frame)
    var d = t
    d.sub(Crewman.SHOULDER_AIM)
    if d.lengthSq < 1e-6 || !(d.x + d.y + d.z).isFinite { d = Crewman.REST }
    d.normalize()
    // clamp to 70° from the rest pose
    let ang = JS.acos(JS.min(1, JS.max(-1, d.dot(Crewman.REST))))
    if ang > Crewman.LIMIT {
      var axis = V3()
      axis.crossVectors(Crewman.REST, d)
      if axis.lengthSq < 1e-8 {
        d = Crewman.REST
      } else {
        axis.normalize()
        d = Crewman.REST
        d.applyAxisAngle(axis, Crewman.LIMIT)
      }
    }
    // while leaning out the arm comes up gradually from the rest pose
    if lean < 0.999 {
      d.lerp(Crewman.REST, 1 - lean)
      d.normalize()
    }
    var q = Quat()
    q.setFromUnitVectors(Crewman.X, d)
    let ka = 1 - JS.exp(-dt * 7)
    pose.arm.slerp(q, ka)
    // head follows at ~60 % (yaw about y, pitch about z), small limits
    let yaw = JS.atan2(-d.z, d.x) * 0.6
    let pitch = JS.max(-0.7, JS.min(0.25, JS.asin(JS.max(-1, JS.min(1, d.y))) * 0.6 + 0.15))
    var qh = Quat()
    qh.setFromEuler(Euler(0, yaw, pitch, .YZX))
    pose.head.slerp(qh, ka)
  }
}
