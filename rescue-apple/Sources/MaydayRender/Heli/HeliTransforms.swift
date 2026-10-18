// HeliTransforms — matrixWorld of every heli mesh, three.js r185 style (Object3D.updateMatrixWorld:
// matrixWorld = parent.matrixWorld × compose(position, quaternion, scale), Double, MaydayCore's three math).
// The node chains are the web's own (baked into each mesh's meta by bake-meshes.mjs); HeliPose carries
// what the web animates per frame, by node role:
//   root / body   → visual.rootMatrix / bodyMatrix (systems/heli.js _visuals: root heading + bob, body
//                   pitch / bank springs), taken as they are;
//   rotorPivot    rotation (pitch·0.3, 0, −bank·0.3);   hub  rotation.y = hubAngle;   blades rotation.y
//   float         scale (flotation bags inflating);     crewman position, crewArm / crewHead quaternion
//   basket / rescuer position + quaternion (winch.js render);  cone position, quaternion, scale (searchlight)
//   flare         position of chain i (flare pool);     raftPack position + rotation (spin·0.7, spin, spin·0.4)
// Every other node keeps the transform it was built with. Pure Swift: tools/meshfmt/check-render.sh runs
// it on Linux against three's matrixWorld (tools/meshfmt/vectors/heli_transforms.json).
import Foundation
import MaydayCore

public struct HeliPose {
  public var rootMatrix = Mat4()
  public var bodyMatrix = Mat4()
  public var pitch: Double = 0
  public var bank: Double = 0
  public var hubAngle: Double = 0
  public var shadowBladesAngle: Double = 0
  public var floatScale = V3(1, 1, 1)
  public var crewPosition = Crewman.ORIGIN
  public var crewArm = Quat()
  public var crewHead = Quat()
  public var basketPosition = V3()
  public var basketQuaternion = Quat()
  public var rescuerPosition = V3()
  public var rescuerQuaternion = Quat()
  public var conePosition = V3()
  public var coneQuaternion = Quat()
  public var coneScale = V3(1, 1, 1)
  public var flares: [V3?] = [nil, nil, nil, nil]
  public var rafts: [(position: V3, rotation: V3)?] = [nil, nil]

  public init() {}

  public init(_ s: HeliRenderSnapshot) {
    let v = s.visual
    rootMatrix = v.rootMatrix
    bodyMatrix = v.bodyMatrix
    pitch = v.pitch
    bank = v.bank
    hubAngle = v.hubAngle
    shadowBladesAngle = v.shadowBladesAngle
    floatScale = v.floatScale
    crewPosition = s.crew.position
    crewArm = s.crew.arm
    crewHead = s.crew.head
    basketPosition = s.winch.basketPosition
    basketQuaternion = s.winch.basketQuaternion
    rescuerPosition = s.winch.rescuerPosition
    rescuerQuaternion = s.winch.rescuerQuaternion
    conePosition = s.cone.position
    coneQuaternion = s.cone.quaternion
    coneScale = s.cone.scale
    flares = v.flares
    rafts = v.rafts
  }
}

public enum HeliTransforms {
  /// three `rotation.set(x, y, z)` (order XYZ) → the node's quaternion.
  public static func quaternion(_ x: Double, _ y: Double, _ z: Double) -> Quat {
    var q = Quat()
    q.setFromEuler(Euler(x, y, z))
    return q
  }

  /// The animated local transform of one node (by role; chain index for the pooled flares / rafts).
  static func animate(_ n: inout MMeshNode, chain i: Int, _ p: HeliPose) {
    switch n.role {
    case "rotorPivot": n.quaternion = quaternion(p.pitch * 0.3, 0, -p.bank * 0.3)
    case "hub": n.quaternion = quaternion(0, p.hubAngle, 0)
    case "blades": n.quaternion = quaternion(0, p.shadowBladesAngle, 0)
    case "float": n.scale = p.floatScale
    case "crewman": n.position = p.crewPosition
    case "crewArm": n.quaternion = p.crewArm
    case "crewHead": n.quaternion = p.crewHead
    case "basket":
      n.position = p.basketPosition
      n.quaternion = p.basketQuaternion
    case "rescuer":
      n.position = p.rescuerPosition
      n.quaternion = p.rescuerQuaternion
    case "cone":
      n.position = p.conePosition
      n.quaternion = p.coneQuaternion
      n.scale = p.coneScale
    case "flare":
      if i < p.flares.count, let f = p.flares[i] { n.position = f }
    case "raftPack":
      if i < p.rafts.count, let r = p.rafts[i] {
        n.position = r.position
        n.quaternion = quaternion(r.rotation.x, r.rotation.y, r.rotation.z)
      }
    default: break
    }
  }

  /// matrixWorld of chain `i` of a mesh under `pose`.
  public static func world(_ meta: MMeshMeta, chain i: Int = 0, pose p: HeliPose) -> Mat4 {
    var m = Mat4()
    for var node in meta.chains[max(0, min(i, meta.chains.count - 1))] {
      switch node.role {
      case "root": m = p.rootMatrix
      case "body": m = p.bodyMatrix
      default:
        animate(&node, chain: i, p)
        var w = Mat4()
        w.multiplyMatrices(m, node.matrix)
        m = w
      }
    }
    return m
  }
}
