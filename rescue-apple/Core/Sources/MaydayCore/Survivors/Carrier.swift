// survivors/carriers.js — the floating things survivors sit on, cling to or stand on (DESIGN §2.10, §3.11):
// a ПСН-6 raft, a capsized hull (boat / yacht / the Ан-2), a 20' container, a barge aground, the sinking
// ferry, or a virtual carrier for a world structure (the rig's lower deck). A carrier owns its pose on the
// waves (bob on heightAt, tilt from normalAt with a 0.3 s lag, yaw), its own drama (sea anchor yaw, canopy
// flutter, sinking telegraph, heel and flooding, tipping in a big sea) and how it is drawn.
//
// People ride a carrier through slots: local positions in the carrier frame (slotFor). A reference type,
// like the web's object: groups hold it (s.carrier), it holds its owner and riders.

public enum CarrierKind: String, Sendable {
  case raft, hull, container, barge, wreck, rig
}

/// One floating bit around a capsized hull (scatterDebris).
public struct CarrierDebris: Equatable, Sendable {
  public var kind: String
  public var dx: Double
  public var dz: Double
  public var x: Double
  public var z: Double
  public var y: Double
  public var yaw: Double
  public var spin: Double
  public var drift: Double
}

/// The userData of the big hull models (craft.js bargeGeometry / ferryGeometry / trawlerWreckGeometry):
/// the gathering point, the collar and the hull extents the drama reads.
public struct BigCraftSpec: Equatable, Sendable {
  /// 'barge' | 'ferry' | 'trawler'
  public var model: String
  public var deckY: Double
  public var L: Double
  public var B: Double
  /// local gathering point [x, y, z]
  public var stand: [Double]
  public var collarR: Double
  public var elong: Double

  /// The batch key of survivors._bigBatch: `${model}:${Math.round(deckY * 10)}`.
  public var key: String { "\(model):\(JSNumber.toString(JS.round(deckY * 10)))" }

  public static func make(_ model: String, deckY: Double) -> BigCraftSpec {
    switch model {
    case "ferry":
      let L = 52.0
      return BigCraftSpec(model: "ferry", deckY: deckY, L: L, B: 11.5, stand: [-2.6, deckY, L / 2 - 6.5], collarR: 6.5, elong: 4.3)
    case "trawler":
      return BigCraftSpec(model: "trawler", deckY: deckY, L: 44, B: 10, stand: [-2.2, deckY, 3.6], collarR: 5.8, elong: 3.9)
    default:
      let L = 34.0
      return BigCraftSpec(model: "barge", deckY: deckY, L: L, B: 10, stand: [0, deckY, L / 2 - 9], collarR: 5.6, elong: 3.2)
    }
  }
}

public final class Carrier {
  static let UP = V3(0, 1, 0)

  let tables: SurvivorTables
  public let id: Int
  public var kind: CarrierKind
  /// 'boat' | 'yacht' | 'plane' (hulls)
  public var style: String
  public var x: Double
  public var z: Double
  public var y: Double = 0
  /// structures: fixed deck reference
  public var baseY: Double = 0
  public var yaw: Double
  public var yawRate: Double = 0
  /// lagged wave normal (0.3 s)
  public var nrm = V3(0, 1, 0)
  /// extra roll (heel, tipping, capsize flip) / pitch (trim) / draft (m, positive = lower)
  public var roll: Double = 0
  public var pitch: Double = 0
  public var sink: Double = 0
  /// 0 upright … 1 capsized (rafts)
  public var flip: Double = 0
  public var flipT: Double?
  public var capsized = false
  public var flutter: Double = 0
  public var tapeLit: Double = 0
  /// 0..1 decaying glint of the retro tape (survivors._carrier)
  public var tapeFlash: Double = 0
  public var tapeGlintT: Double = 0
  public var lamp: Double = 0
  public var lights: Double = 0
  public var chem: Double = 0
  public var dissolve: Double = 0
  public var phase: Double
  public var lampPhase: Double
  /// the group it belongs to (nil: dropped raft, emptied craft)
  public weak var owner: SurvivorGroup?
  /// swimmer groups that climbed aboard a dropped raft
  public var riders: [SurvivorGroup] = []
  public var dropped: Bool
  public var inflate: Double
  public var alive = true
  /// seconds since nobody is aboard (fade-out of leftovers)
  public var emptyT: Double = 0
  public var color: Color3?
  public var deckY: Double
  /// local gathering point [x, y, z]
  public var stand: [Double]?
  /// hulls: seconds of age before she goes
  public var sinkAt: Double
  /// wreck 0..1
  public var flood: Double = 0
  public var floodTime: Double
  public var age: Double = 0
  /// 0 … 1 final plunge
  public var sinking: Double = 0
  public var tipT: Double = 0
  /// container tip animation 0..1..0
  public var tip: Double = 0
  public var tipDir: Double = 1
  public var tipPhase: Double = 0
  public var tipDone = false
  public var baseRoll: Double?
  public var leeway: Double
  /// barge aground, rig deck
  public var fixed: Bool
  /// raft sea anchor (drogue)
  public var anchor: V3
  /// hull: floating bits around it
  public var debris: [CarrierDebris] = []
  public var matrix = Mat4()
  public var quat = Quat()
  public var bubbleT: Double = 0
  public var creakT: Double = 0
  public var oilT: Double = 0
  public var oilN: Double = 0
  public var washT: Double?
  public var warned = false
  /// nil until something sets it (the web's `undefined`: a dropped raft's lamp is never declared dead or alive)
  public var lampDead: Bool?
  /// c.vel (set on the first _carrier frame)
  public var vel: V3?
  /// barge / wreck: the big hull model it is drawn with (c.batch.geo.userData)
  public var big: BigCraftSpec?
  /// the name decal drawn on it (hull name, Ан-2 registration, ferry name): text for the renderer
  public var decalText: String?

  public struct Options {
    public var style: String?
    public var yaw: Double?
    public var phase: Double?
    public var dropped = false
    public var color: String?
    public var deckY: Double?
    public var stand: [Double]?
    public var sinkAt: Double?
    public var floodTime: Double?
    public var leeway: Double?
    public var fixed = false

    public init(style: String? = nil, yaw: Double? = nil, phase: Double? = nil, dropped: Bool = false, color: String? = nil, deckY: Double? = nil,
                stand: [Double]? = nil, sinkAt: Double? = nil, floodTime: Double? = nil, leeway: Double? = nil, fixed: Bool = false) {
      self.style = style
      self.yaw = yaw
      self.phase = phase
      self.dropped = dropped
      self.color = color
      self.deckY = deckY
      self.stand = stand
      self.sinkAt = sinkAt
      self.floodTime = floodTime
      self.leeway = leeway
      self.fixed = fixed
    }
  }

  /// new Carrier(kind, x, z, opts). `random` = Math.random (phase when opts has none, lampPhase always);
  /// `id` = carriers.js NEXT_ID++ (the owning Survivors keeps the counter: one per session, never reset).
  public init(_ kind: CarrierKind, _ x: Double, _ z: Double, _ opts: Options, id: Int, tables: SurvivorTables, random: () -> Double) {
    self.tables = tables
    self.id = id
    self.kind = kind
    style = opts.style.flatMap { $0.isEmpty ? nil : $0 } ?? "boat"
    self.x = x
    self.z = z
    yaw = opts.yaw ?? 0
    phase = opts.phase ?? random() * 100
    lampPhase = random()
    dropped = opts.dropped
    inflate = opts.dropped ? 0 : 1
    color = opts.color.map { Color3(style: $0) }
    deckY = opts.deckY ?? 0
    stand = opts.stand
    sinkAt = opts.sinkAt ?? .infinity
    floodTime = opts.floodTime ?? 300
    leeway = opts.leeway ?? tables.types[kind.rawValue]?.leeway ?? 0.03
    fixed = opts.fixed
    anchor = V3(x, 0, z)
  }

  /// radius (collar / pick-up extent of the craft)
  public var radius: Double {
    switch kind {
    case .raft: return tables.raft.R + tables.raft.tube
    case .hull: return style == "plane" ? 6.5 : style == "yacht" ? 5.4 : 4.8
    case .container: return 3.3
    case .barge: return 17
    case .wreck: return 26
    case .rig: return 2
    }
  }

  /// Collar elongation (length / beam) for elongated hulls.
  public var elong: Double {
    switch kind {
    case .hull: return style == "plane" ? 1.4 : style == "yacht" ? 3.0 : 2.9
    case .container: return 2.4
    case .barge: return 3.2
    case .wreck: return 4.2
    default: return 1
    }
  }

  // ----------------------------------------------------------------------------------------------
  /// Pose on the waves. `ocean` = ctx.ocean (callers only pose with an ocean).
  public func pose(_ ocean: SeaOceanQuery, _ dt: Double) {
    if kind == .rig {
      y = baseY
      quat.identity()
      matrix.makeTranslation(x, y, z)
      return
    }
    let sea = ocean.heightAt(x, z)
    // big things are not tossed like corks: smaller tilt response
    let tiltK: Double = kind == .raft ? 1 : kind == .hull || kind == .container ? 0.75 : 0.25
    var n = ocean.seaNormalAt(x, z)
    n.set(n.x * tiltK, 1, n.z * tiltK)
    n.normalize()
    // 0.3 s lag on the tilt (DESIGN §2.10)
    let k = dt > 0 ? 1 - JS.exp(-dt / 0.3) : 0
    nrm.lerp(n, k)
    nrm.normalize()
    if fixed {
      y = baseY
      nrm.set(0, 1, 0)
    } else if kind == .barge || kind == .wreck {
      y = sea * 0.35 - sink // heavy: barely bobs
    } else {
      y = sea - sink
    }
    // quaternion: wave tilt × yaw × extra roll/pitch (heel, tip, capsize flip)
    var q = Quat()
    q.setFromUnitVectors(Carrier.UP, nrm)
    var q2 = Quat()
    q2.setFromAxisAngle(Carrier.UP, yaw)
    q.multiply(q2)
    let flipRoll = flip * JS.PI
    if JSNumber.isTruthy(roll) || JSNumber.isTruthy(pitch) || JSNumber.isTruthy(flipRoll) {
      q2.setFromEuler(Euler(pitch, 0, roll + flipRoll, .XYZ))
      q.multiply(q2)
    }
    quat = q
    let inf = inflate
    // a capsized raft floats on its tubes: lift it so the upside-down tubes sit in the water
    matrix.compose(V3(x, y + flip * tables.raft.tube * 3.2, z), quat, V3(inf, 0.25 + 0.75 * inf, inf))
  }

  /// World position of a local point (carrier frame).
  @inline(__always) public func toWorld(_ lx: Double, _ ly: Double, _ lz: Double) -> V3 {
    var v = V3(lx, ly, lz)
    v.applyMatrix4(matrix)
    return v
  }

  /// Structures (barge, ferry, rig lower deck): world height of the deck under (x, z), or −Infinity when
  /// the point is off the deck. Heel and trim are included (the deck plane through the matrix).
  public func deckHeightAt(_ px: Double, _ pz: Double) -> Double {
    let hx: Double, hz: Double
    switch kind {
    case .rig: hx = 7; hz = 7 // the world draws the rig; people stand inside ~7 m of the point
    case .barge: hx = 5; hz = 17
    case .wreck: hx = 5.4; hz = 25
    default: return -.infinity
    }
    let st = stand ?? [0, deckY, 0]
    let dx = px - x
    let dz = pz - z
    let cs = JS.cos(yaw)
    let sn = JS.sin(yaw)
    // world → carrier frame (inverse of the yaw rotation used by pose())
    var lx = dx * cs - dz * sn
    var lz = dx * sn + dz * cs
    if kind == .rig {
      lx -= st[0]
      lz -= st[2]
    }
    if JS.abs(lx) > hx || JS.abs(lz) > hz { return -.infinity }
    if kind == .rig { return y + st[1] }
    return toWorld(lx, deckY, lz).y
  }

  // ----------------------------------------------------------------------------------------------
  /// A local slot (person origin) for the i-th person of n aboard: [x, y, z, legFold, sitYaw]. People
  /// origins are "floating reference points" (crowd.js): standing → feet = origin + FEET_Y.
  public func slotFor(_ i: Int, _ n: Int) -> [Double] {
    let S = tables.personScale
    switch kind {
    case .raft:
      // two in the doorway (+Z), a third behind them when the basket arrives
      let R = tables.raft.R
      let sitY = tables.raft.floorY + 0.55 * S + 0.5 * S
      if i == 0 { return [-0.24 * R, sitY, 0.72 * R, 0.85, 0] }
      if i == 1 { return [0.26 * R, sitY + 0.04, 0.7 * R, 0.85, 0] }
      return [0.02 * R, sitY + 0.1, 0.38 * R, 0.6, 0]
    case .hull:
      if style == "plane" {
        // on the upper wing: some standing, some sitting with their legs over the leading edge
        let q = tables.planeSeats[i % tables.planeSeats.count]
        return [q[0], JSNumber.isTruthy(q[2]) ? tables.planeWingTop + 0.5 * S + 0.05 : tables.planeWingTop - tables.feetY, tables.planeWingZ + q[1], q[2], 0]
      }
      let keelY = style == "yacht" ? 0.55 : 0.68
      let zs: [Double] = style == "yacht" ? [1.6, -0.6, 2.9, -1.9] : [-1.2, 0.6, 2.2, -2.7]
      let lz = zs[i % zs.count]
      let lx: Double = style == "yacht" ? (i % 2 != 0 ? 0.55 : -0.55) : 0
      return [lx, keelY + 0.5 * S + 0.05, lz, 1, 0]
    case .container:
      let top = tables.cont.freeboard
      let zs: [Double] = [0.6, -1.3, 2.0]
      let xs: [Double] = [-0.3, 0.45, 0.1]
      return [xs[i % 3], top + 1.37, zs[i % 3], 0.6, 0]
    case .barge, .wreck, .rig:
      // a loose, uneven huddle: staggered ranks, spacing noise, every fourth one sitting/crouching
      let st = stand ?? [0, deckY, 0]
      let cols = 4
      let r = i / cols
      let c = i % cols
      let jx = (Double((i * 37) % 11) / 11 - 0.5) * 0.9
      let jz = (Double((i * 53) % 7) / 7 - 0.5) * 0.8
      let sit = i % 4 == 3
      return [st[0] + (Double(c) - Double(min(n, cols) - 1) / 2) * 1.55 + jx + Double(r % 2) * 0.6,
              sit ? st[1] + 0.5 * S + 0.05 : st[1] - tables.feetY, st[2] + Double(r) * 1.7 + jz, sit ? 1 : 0, 0]
    }
  }

  /// Where a pet sits on this craft (local [x, y, z, yaw]); `far` = the other end (the cat that refused
  /// the first basket). Pets' origin is at the paws.
  public func petSlot(_ far: Bool) -> [Double] {
    let f: Double = far ? -1 : 1
    switch kind {
    case .raft: return [0.02 * tables.raft.R, tables.raft.floorY + 0.03, (far ? 0.2 : 0.9) * tables.raft.R, 0, 0]
    case .hull: return [0, (style == "yacht" ? 0.55 : 0.68) + 0.02, -3.1 * f, far ? JS.PI : 0, 0]
    case .container: return [0.7 * f, tables.cont.freeboard + 0.03, -2.7 * f, far ? JS.PI : 0, 0]
    case .barge, .wreck, .rig:
      let st = stand ?? [0, deckY, 0]
      return [st[0] + 1.6 * f, st[1], st[2] - 1.2, 0, 0]
    }
  }

  /// Seats the craft can show in its slots (rafts show the doorway only).
  public func visibleSeats(_ raise: Bool) -> Int {
    switch kind {
    case .raft: return raise ? 3 : 2
    case .hull: return style == "plane" ? 5 : 4
    case .container: return 3
    default: return 12
    }
  }

  // ----------------------------------------------------------------------------------------------
  /// Raft: sea anchor upwind, yawing (DESIGN §2.10, §4 #23). Local +Z (the door) maps to (sin yaw, cos yaw):
  /// door downwind, the drogue line streams upwind, and the raft yaws slowly around it.
  public func raftYaw(_ env: SurvivorsEnv, _ dt: Double) {
    let down = JS.atan2(env.windDirX, env.windDirZ)
    let target = down + 0.32 * JS.sin(env.t * 0.27 + phase) + 0.12 * JS.sin(env.t * 0.71 + phase * 2)
    yaw += SurvivorMath.wrapAngle(target - yaw) * (1 - JS.exp(-dt * 0.6))
    // drogue ~9 m upwind, swinging a little
    let d = 8 + 1.5 * JS.sin(env.t * 0.19 + phase)
    let lat = 1.6 * JS.sin(env.t * 0.23 + phase * 3)
    anchor.x = x - env.windDirX * d - env.windDirZ * lat
    anchor.z = z - env.windDirZ * d + env.windDirX * lat
  }
}

/// Debris ring around a capsized hull: rings, floats, cans, planks, a cooler (DESIGN §2.10).
func scatterDebris(_ carrier: Carrier, _ rng: Rng) {
  let kinds = ["ring", "float", "can", "plank", "tank", "rope", "cooler", "float", "can", "plank", "float", "tank", "ring", "rope"]
  let n = 11 + Int(JS.floor(rng.next() * 4))
  for i in 0..<n {
    let a = rng.next() * JS.PI * 2
    let r = 4.5 + JS.pow(rng.next(), 0.8) * 10
    let dx = JS.cos(a) * r
    let dz = JS.sin(a) * r
    let yaw = rng.next() * JS.PI * 2
    let spin = (rng.next() - 0.5) * 0.3
    let drift = 0.85 + rng.next() * 0.3
    carrier.debris.append(CarrierDebris(kind: kinds[i % kinds.count], dx: dx, dz: dz, x: carrier.x + JS.cos(a) * r, z: carrier.z + JS.sin(a) * r,
                                        y: 0, yaw: yaw, spin: spin, drift: drift))
  }
}
