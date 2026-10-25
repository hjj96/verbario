// The runtime records of systems/survivors.js: a group `s` (swimmer, raft crew, hull / container / deck /
// wreck people, the injured), its people `p`, its signal stocks `s.sig` (survivors/signals.js initSignals),
// the dispatcher's datum, lost-person markers and player flares. Reference types where the web shares the
// object (a datum is in `survivors.datums` and on its group; a carrier lists its riders; the winch, the HUD
// and the mission refer to groups by GroupID through Survivors.group(id)).

/// s.state
public enum SurvivorState: String, Sendable {
  case hidden, drifting, spotted, winching, rescued, lost
}

/// A def.survivors[] entry ({type, x, z, count, hidden, signals, people, height, name, …}). The web passes
/// the def object itself around (spawn, splits, checkpoints), so the entry keeps the JSON; the accessors
/// read it with the web's operators (`??`, `||`, Number.isFinite, === true / !== false).
public struct SurvivorEntry: Equatable, Sendable {
  public var raw: JSONValue

  public init(_ raw: JSONValue) { self.raw = raw.isNull ? .object(JSONObject()) : raw }

  public init(_ fields: [(String, JSONValue)]) {
    var o = JSONObject()
    for (k, v) in fields { o.set(k, v) }
    raw = .object(o)
  }

  public subscript(key: String) -> JSONValue { raw[key] }

  /// `{ ...entry, key: value, … }`
  public func with(_ fields: [(String, JSONValue)]) -> SurvivorEntry {
    var o = raw.object ?? JSONObject()
    for (k, v) in fields { o.set(k, v) }
    return SurvivorEntry(.object(o))
  }

  /// entry.x / entry.z when finite (else nil)
  public var x: Double? { raw["x"].double.flatMap { $0.isFinite ? $0 : nil } }
  public var z: Double? { raw["z"].double.flatMap { $0.isFinite ? $0 : nil } }
  public var type: String? { raw["type"].string }
  public var tag: String? { raw["tag"].string }
  public var label: String? { raw["label"].string }
  public var name: String? { raw["name"].string }
  /// (e.at || 0)
  public var at: Double {
    let v = raw["at"]
    let n = v.isNull ? 0 : v.jsToNumber
    return JSNumber.isTruthy(n) ? n : 0
  }
}

/// s.sig — signal stocks and clocks (survivors/signals.js initSignals).
public struct SurvivorSignals {
  public var rockets: Double
  public var rocketT: Double = -1
  public var rocketHold: Bool
  public var fired: Double = 0
  public var smoke: Double
  public var smokeBurn: Double = 0
  public var flares: Double
  public var flareBurn: Double = 0
  /// the handheld flare burning in the first person's hand (an fx flare slot)
  public var flareObj: FxFlare?
  public var whistle: Bool
  public var whistleT: Double
  public var dye: Bool
  public var dyeT: Double = -1
  public var dyeStampT: Double = 0
  public var mirror: Bool
  public var mirrorT: Double
  public var mirrorFlash: Double = 0
  public var epirb: Bool
  public var epirbT: Double
  public var epirbError: Double = 0
  /// nil → swimmers and the injured switch theirs on at night; true / false = equipped on / off
  public var strobe: Bool?
  public var hornT: Double = -1
}

/// s.signal — the last «СИГНАЛ» ping (the ladder's middle rung).
public struct SignalPing: Equatable, Sendable {
  public var kind: String
  public var x: Double
  public var z: Double
  public var error: Double
  public var arc: Double
  public var t: Double
  public var until: Double
}

/// s.pet (NICE: def.pet): the cat refuses the first basket, the dog barks.
public struct SurvivorPet: Equatable, Sendable {
  /// 'cat' | 'dog'
  public var kind: String
  public var far = false
  public var refused = false
  public var hopT: Double = 0
  public var barkT: Double = 0
  public var yaw: Double = 0
}

/// s.sweep — a passing rogue crest carries the group ~40 m.
public struct RogueSweep: Equatable, Sendable {
  public var dx: Double
  public var dz: Double
  public var t: Double
  public var dur: Double
  public var dist: Double
}

/// The dispatcher's search area: drifts with the water and grows 0.5 m/s.
public final class SurvivorDatum {
  public var x: Double
  public var z: Double
  public var radius: Double
  public var ids: [GroupID]
  public var tag: String?
  public var label: String
  /// d.s — the group it belongs to
  public weak var group: SurvivorGroup?

  public init(x: Double, z: Double, radius: Double, ids: [GroupID], tag: String?, label: String, group: SurvivorGroup?) {
    self.x = x
    self.z = z
    self.radius = radius
    self.ids = ids
    self.tag = tag
    self.label = label
    self.group = group
  }
}

/// A lost person's grey marker buoy («ПОТЕРЯН» is the HUD's label).
public struct LostMarker {
  public var x: Double
  public var z: Double
  public var y: Double
  public var t: Double
  public var group: GroupID?
  public var phase: Double
  public var nrm = V3(0, 1, 0)
}

/// A player flare lights 45 m around it for 40 s (heli:flare).
public struct PlayerFlare: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var until: Double
}

/// One person of a group (survivors._makePerson): palette indices, body scale, random phases, the arm pose,
/// and where the draw placed them this frame.
public final class SurvivorPerson {
  public var rec: PersonRecord?
  public var skin: Double
  public var hood: Double
  public var jacket: Double
  public var pants: Double
  public var scale: Double
  public var phase: Double
  /// −1 left / +1 right: the arm that waves alone
  public var waveArm: Double
  public var strobePhase: Double
  public var yaw: Double
  /// aL, pL, aR, pR
  public var arms = ArmAngles(0.8, 0.5, 0.8, 0.5)
  public var x: Double
  public var y: Double = 0
  public var z: Double
  public var waterY: Double = 0
  public var legFold: Double = 0
  public var liftWarmth: Double = 1
  public var spin: Double = 0
  public var lastPose: Double = 0
  public var attachT: Double?
  public var strokeT: Double?
  public var strokeSide: Double?

  init(rec: PersonRecord?, skin: Double, hood: Double, jacket: Double, pants: Double, scale: Double, phase: Double, waveArm: Double,
       strobePhase: Double, yaw: Double, x: Double, z: Double) {
    self.rec = rec
    self.skin = skin
    self.hood = hood
    self.jacket = jacket
    self.pants = pants
    self.scale = scale
    self.phase = phase
    self.waveArm = waveArm
    self.strobePhase = strobePhase
    self.yaw = yaw
    self.x = x
    self.z = z
  }
}

/// A survivor group (CONTRACT `survivors.list[i]` + the extras of survivors.js).
public final class SurvivorGroup {
  public let id: GroupID
  public var type: String
  public var tag: String?
  /// the def entry that built it (splits keep the parent's)
  public var def: SurvivorEntry
  public var label: String?
  public var name: String?
  public var position: V3
  public var velocity = V3()
  public var count: Int
  public var remaining: Int
  public var health: Double = 1
  public var state: SurvivorState
  public var spotted: Bool
  public var priority: Bool
  public var height: Double = 0
  public var deckY: Double?
  public var warmth: Double = 1
  public var critical = false
  public var people: [SurvivorPerson] = []
  /// the person on the cable
  public var attached: SurvivorPerson?
  public var carrier: Carrier?
  public var since: Double
  public var age: Double = 0
  public var hiddenAtStart: Bool
  public var signal: SignalPing?
  /// flashing now
  public var strobe = false
  public var panic = false
  public var calm: Double = 0
  public var excite: Double = 0
  public var beamT: Double = 0
  public var coreT: Double = 0
  public var lostT: Double = -1
  public var rogueCd: Double = 0
  public var sweep: RogueSweep?
  public var dwT: Double = 0
  /// 0..1 downwash danger (HUD)
  public var dwWarn: Double = 0
  public var dwWarnT: Double = 0
  public var shoutNear = false
  /// the «цветок» ring of 2+
  public var flower: Bool
  public var ringSpin: Double
  public var nrm = V3(0, 1, 0)
  public var dHeli: Double = 1e9
  /// 'basket' | 'raft' | nil
  public var swimTo: String?
  public var jumpT: Double = 0
  public var pet: SurvivorPet?
  public var sig: SurvivorSignals!
  public var datum: SurvivorDatum?
  public var lostPending = false
  public var stateBefore: SurvivorState?
  /// nobody left on it (they are all in other groups now)
  public var empty = false
  public var spawnT: Double?
  public weak var parent: SurvivorGroup?

  init(id: GroupID, type: String, entry: SurvivorEntry, x: Double, z: Double, count: Int, hidden: Bool, ringSpin: Double) {
    self.id = id
    self.type = type
    tag = entry.tag
    def = entry
    label = entry.label
    name = entry.name
    position = V3(x, 0, z)
    self.count = count
    remaining = count
    state = hidden ? .hidden : .spotted
    spotted = !hidden
    priority = type == "injured"
    let sinceV = entry["since"]
    since = sinceV.isNull ? 0 : sinceV.jsToNumber
    hiddenAtStart = hidden
    flower = count >= 2 && type == "swimmer"
    self.ringSpin = ringSpin
    if entry["pet"].jsTruthy { pet = SurvivorPet(kind: entry["pet"].string == "cat" ? "cat" : "dog") }
  }

  /// s.inBasket: the record of the person on the cable
  public var inBasket: PersonRecord? { attached?.rec }

  /// The group as the winch / touch aim read it.
  public var view: SurvivorView {
    SurvivorView(id: id, type: type, position: position, velocity: velocity, height: height, remaining: Double(remaining), state: state.rawValue,
                 spotted: spotted)
  }
}

/// Survivors' per-frame snapshot of everything read from other systems (survivors._refreshEnv). Stubs
/// give the same defaults as the web's.
public struct SurvivorsEnv {
  public var t: Double = 0
  public var dt: Double = 0
  public var play = false
  public var night: Double = 0
  public var preset = "calm"
  public var intensity: Double = 0
  public var fogBlind = false
  public var fog: Double = 0
  public var windX: Double = 0
  public var windZ: Double = 0
  public var windSpeed: Double = 0
  public var windDirX: Double = 1
  public var windDirZ: Double = 0
  public var windAngle: Double = 0
  public var Hs: Double = 0.5
  public var sunny = false
  public var base: Double = 260
  public var altBonus: Double = 1
  public var reduceFlashes = false
  public var thermal: Double = 1
  public var heliAlive = false
  public var rotorHeard = false
  public var hx: Double = 0
  public var hy: Double = 40
  public var hz: Double = 0
  public var alt: Double = 40
  public var dwR: Double = 9
  public var dwS: Double = 0
  public var wState = "stowed"
  public var bx: Double = 0
  public var by: Double = 0
  public var bz: Double = 0
  public var bH: Double = 99
  public var bWet = false
  public var wLoad: GroupID?
  /// light under the surface / on foam (for the unlit custom shaders)
  public var ghostLight = Color3(0.4, 0.45, 0.5)
  public var foam = Color3(style: "#E8EEEC")
}
