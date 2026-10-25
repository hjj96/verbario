// survivors/poses.js — gestures (DESIGN §2.10 «Движение», §4 #18, #21, #22, #25, #26): the CPU picks a
// pose per person and writes arm angles into instance attributes; the vertex shader bends the limbs.
//
// Arm angles: θ from straight down (0) to straight up (π); ψ from sideways-out (0) to the front (π/2).
// The numbering of `SurvivorPose` is poses.js POSE (survivors.json survivors/poses.POSE; SurvivorPoseTests
// checks it), the targets are bit-exact with the web (Tests/Vectors/survivors/poses.json).

/// POSE
public enum SurvivorPose: Int, Sendable, CaseIterable {
  case idle = 0, wave1, wave2, limp, still, panic, shield, hold, cable, stretcher, deck, sit, raise, keel, flare, mirror, frozen

  /// The JS key of the pose (POSE object order).
  public var name: String {
    switch self {
    case .idle: return "idle"
    case .wave1: return "wave1"
    case .wave2: return "wave2"
    case .limp: return "limp"
    case .still: return "still"
    case .panic: return "panic"
    case .shield: return "shield"
    case .hold: return "hold"
    case .cable: return "cable"
    case .stretcher: return "stretcher"
    case .deck: return "deck"
    case .sit: return "sit"
    case .raise: return "raise"
    case .keel: return "keel"
    case .flare: return "flare"
    case .mirror: return "mirror"
    case .frozen: return "frozen"
    }
  }
}

/// Target arm angles θL, ψL, θR, ψR.
public struct ArmAngles: Equatable, Sendable {
  public var aL: Double
  public var pL: Double
  public var aR: Double
  public var pR: Double

  public init(_ aL: Double, _ pL: Double, _ aR: Double, _ pR: Double) {
    self.aL = aL
    self.pL = pL
    self.aR = aR
    self.pR = pR
  }
}

public enum SurvivorPoses {
  static let TAU = JS.PI * 2

  /// variant(p, n): a stable per-person choice 0…n−1 from the random phase.
  @inline(__always) public static func variant(_ phase: Double, _ n: Double) -> Int {
    let v = JS.floor((phase * 3.7).truncatingRemainder(dividingBy: 1) * n)
    return v.isFinite ? Int(v) : -1 // NaN phase: matches no case (the JS comparisons are all false)
  }

  /// poseTargets(pose, p, t, out, ringN): p = (phase, waveArm, legFold) of the person.
  public static func targets(_ pose: SurvivorPose, phase ph: Double, waveArm arm: Double, legFold: Double, t: Double, ringN: Double = 4) -> ArmAngles {
    // gentle sculling in the water for the arm that is not doing anything
    let scL = 0.78 + 0.12 * JS.sin(t * 0.9 + ph)
    let scR = 0.78 + 0.12 * JS.sin(t * 0.9 + ph + 1.7)
    switch pose {
    case .wave1:
      let w = 2.55 + 0.38 * JS.sin(TAU * 1.1 * t + ph)
      return arm < 0 ? ArmAngles(w, 0.25, scR, 0.55) : ArmAngles(scL, 0.55, w, 0.25)
    case .wave2:
      let a = TAU * 1.1 * t + ph
      return ArmAngles(2.72 + 0.34 * JS.sin(a), 0.18, 2.72 + 0.34 * JS.sin(a + JS.PI), 0.18)
    case .limp:
      let w = 1.95 + 0.28 * JS.sin(TAU * 0.5 * t + ph)
      return arm < 0 ? ArmAngles(w, 0.6, 0.42, 0.4) : ArmAngles(0.42, 0.4, w, 0.6)
    case .still:
      return ArmAngles(0.34, 0.3, 0.36, 0.28)
    case .panic:
      let a = TAU * 2 * t + ph
      return ArmAngles(1.7 + 0.95 * JS.sin(a), 0.7 * JS.sin(a * 1.31 + 0.6), 1.7 + 0.95 * JS.sin(a + 2.1), 0.7 * JS.sin(a * 1.17 + 2.4))
    case .shield:
      return arm < 0 ? ArmAngles(2.25, 1.8, scR, 0.55) : ArmAngles(scL, 0.55, 2.25, 1.8)
    case .hold:
      let ps = JS.PI / JS.max(2, ringN)
      let bob = 0.06 * JS.sin(t * 0.7 + ph)
      return ArmAngles(1.42 + bob, ps, 1.42 - bob, ps)
    case .cable:
      return ArmAngles(2.5 + 0.05 * JS.sin(t * 1.3 + ph), 1.25, 2.5 + 0.05 * JS.sin(t * 1.1 + ph + 1), 1.25)
    case .stretcher:
      return ArmAngles(0.22, 0.0, 0.22, 0.0)
    case .deck:
      // people on a deck are not pawns: arms round the knees when sitting, a hand on the rail, arms
      // wrapped round the body against the cold, an arm round a neighbour's back, or just hanging
      let b = 0.04 * JS.sin(t * 0.6 + ph)
      let b2 = 0.04 * JS.sin(t * 0.55 + ph + 2)
      if legFold > 0.5 { return ArmAngles(0.95 + b, 1.2, 0.9 + b2, 1.15) }
      switch variant(ph, 5) {
      case 1: return arm < 0 ? ArmAngles(1.3 + b, 0.35, 0.16 + b2, 0.15) : ArmAngles(0.16 + b, 0.15, 1.3 + b2, 0.35)
      case 2: return ArmAngles(0.78 + b, 1.45, 0.72 + b2, 1.5)
      case 3: return arm < 0 ? ArmAngles(1.6 + b, 0.08, 0.55 + b2, 0.95) : ArmAngles(0.55 + b, 0.95, 1.6 + b2, 0.08)
      default: return ArmAngles(0.14 + b, 0.15, 0.14 + b2, 0.15)
      }
    case .sit:
      return ArmAngles(0.95, 1.05, 0.95, 1.05)
    case .raise:
      let a = TAU * 0.8 * t + ph
      return ArmAngles(2.75 + 0.15 * JS.sin(a), 0.35, 2.75 + 0.15 * JS.sin(a + 1.3), 0.35)
    case .keel:
      return arm < 0 ? ArmAngles(scL, 0.5, 1.15, 1.25) : ArmAngles(1.15, 1.25, scR, 0.5)
    case .flare:
      let s = 0.06 * JS.sin(t * 2.1 + ph)
      return arm < 0 ? ArmAngles(2.65 + s, 0.45, scR, 0.55) : ArmAngles(scL, 0.55, 2.65 + s, 0.45)
    case .mirror:
      let s = 0.05 * JS.sin(t * 7 + ph)
      return arm < 0 ? ArmAngles(2.0 + s, 1.25, scR, 0.55) : ArmAngles(scL, 0.55, 2.0 + s, 1.25)
    case .idle, .frozen:
      return ArmAngles(scL, 0.55, scR, 0.55)
    }
  }

  /// applyPose(p, target, dt, λ = 11): smoothly move the current arm angles towards the targets.
  public static func apply(_ cur: inout ArmAngles, _ target: ArmAngles, _ dt: Double, _ lambda: Double = 11) {
    cur.aL = SurvivorMath.approach(cur.aL, target.aL, lambda, dt)
    cur.pL = SurvivorMath.approach(cur.pL, target.pL, lambda, dt)
    cur.aR = SurvivorMath.approach(cur.aR, target.aR, lambda, dt)
    cur.pR = SurvivorMath.approach(cur.pR, target.pR, lambda, dt)
  }
}
