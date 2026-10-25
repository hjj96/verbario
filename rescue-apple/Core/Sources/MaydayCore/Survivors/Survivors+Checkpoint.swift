// survivors.js checkpoint restore (mission.js, DESIGN §3.9 «каждая посадка — чекпоинт»): snapCarrier /
// snapSignals give plain data for mission._takeCheckpoint — a carrier's drift, pose and drama (with the
// survivor type that builds it again), a group's signal stocks and clocks — and restoreCheckpoint rebuilds
// the groups from it right after mission:setup + mission:start. The web keeps only the keys that are
// booleans or finite numbers (`typeof v === 'boolean' || Number.isFinite(v)`): nil members here.

/// snapCarrier(c)
public struct CarrierSnapshot: Equatable, Sendable {
  /// the survivor type that builds it again ('hull' | 'plane' | 'deck' | 'raft' | 'container' | 'wreck')
  public var type: String
  public var kind: CarrierKind
  public var dropped: Bool
  public var x: Double?
  public var z: Double?
  public var yaw: Double?
  public var age: Double?
  public var flood: Double?
  public var capsized: Bool?
  public var flip: Double?
  public var flipT: Double?
  public var sink: Double?
  public var sinking: Double?
  public var sinkAt: Double?
  public var roll: Double?
  public var pitch: Double?
  public var baseRoll: Double?
  public var inflate: Double?
  public var emptyT: Double?
  public var dissolve: Double?
  public var warned: Bool?
  public var lampDead: Bool?
  public var tipT: Double?
  public var oilN: Double?
  public var anchor: V2?
  /// c.color.getHex()
  public var color: Double?
  public var debris: [CarrierDebris]?
}

/// snapSignals(s)
public struct SignalSnapshot: Equatable, Sendable {
  public var rockets: Double?
  public var rocketT: Double?
  public var rocketHold: Bool?
  public var fired: Double?
  public var smoke: Double?
  public var smokeBurn: Double?
  public var flares: Double?
  public var flareBurn: Double?
  public var whistle: Bool?
  public var dye: Bool?
  public var dyeT: Double?
  public var dyeStampT: Double?
  public var mirror: Bool?
  public var epirb: Bool?
  public var epirbT: Double?
  public var strobe: Bool?
}

/// restoreCheckpoint(cp) input: cp.groups / cp.carriers as mission.js builds them (entries resolved).
public struct SurvivorsCheckpoint {
  public struct Group {
    /// the def.survivors object that built the group
    public var entry: SurvivorEntry
    public var type: String?
    public var x: Double
    public var z: Double
    /// the person records still out there (already resolved from the entry's manifest)
    public var people: [PersonRecord]
    public var health: Double?
    public var spotted: Bool
    public var age: Double?
    public var pet: Bool
    /// the datum {x, z, radius} while not spotted
    public var datum: (x: Double, z: Double, radius: Double)?
    /// snapCarrier() of their own craft
    public var carrier: CarrierSnapshot?
    /// index into `carriers`: the dropped raft they climbed into
    public var raft: Int?
    public var sig: SignalSnapshot?

    public init(entry: SurvivorEntry, type: String?, x: Double, z: Double, people: [PersonRecord], health: Double?, spotted: Bool, age: Double?,
                pet: Bool, datum: (x: Double, z: Double, radius: Double)?, carrier: CarrierSnapshot?, raft: Int?, sig: SignalSnapshot?) {
      self.entry = entry
      self.type = type
      self.x = x
      self.z = z
      self.people = people
      self.health = health
      self.spotted = spotted
      self.age = age
      self.pet = pet
      self.datum = datum
      self.carrier = carrier
      self.raft = raft
      self.sig = sig
    }
  }

  public struct FreeCarrier {
    public var snapshot: CarrierSnapshot
    /// the def object that built it (nil for a dropped raft)
    public var entry: SurvivorEntry?

    public init(snapshot: CarrierSnapshot, entry: SurvivorEntry?) {
      self.snapshot = snapshot
      self.entry = entry
    }
  }

  public var elapsed: Double
  public var groups: [Group]
  public var carriers: [FreeCarrier?]
  public var rescued: Int
  public var lost: Int
  public var lostMarkers: [(x: Double, z: Double)]
  public var bottleTaken: Bool

  public init(elapsed: Double, groups: [Group], carriers: [FreeCarrier?], rescued: Int, lost: Int, lostMarkers: [(x: Double, z: Double)],
              bottleTaken: Bool) {
    self.elapsed = elapsed
    self.groups = groups
    self.carriers = carriers
    self.rescued = rescued
    self.lost = lost
    self.lostMarkers = lostMarkers
    self.bottleTaken = bottleTaken
  }
}

extension Survivors {
  @inline(__always) static func finite(_ v: Double) -> Double? { v.isFinite ? v : nil }

  public func snapCarrier(_ c: Carrier) -> CarrierSnapshot {
    let type: String
    switch c.kind {
    case .hull: type = c.style == "plane" ? "plane" : "hull"
    case .barge, .rig: type = "deck"
    default: type = c.kind.rawValue
    }
    let f = Survivors.finite
    return CarrierSnapshot(
      type: type, kind: c.kind, dropped: c.dropped, x: f(c.x), z: f(c.z), yaw: f(c.yaw), age: f(c.age), flood: f(c.flood), capsized: c.capsized,
      flip: f(c.flip), flipT: c.flipT.flatMap(f), sink: f(c.sink), sinking: f(c.sinking), sinkAt: f(c.sinkAt), roll: f(c.roll), pitch: f(c.pitch),
      baseRoll: c.baseRoll.flatMap(f), inflate: f(c.inflate), emptyT: f(c.emptyT), dissolve: f(c.dissolve), warned: c.warned, lampDead: c.lampDead,
      tipT: f(c.tipT), oilN: f(c.oilN), anchor: V2(c.anchor.x, c.anchor.z), color: c.color.map { $0.getHex() },
      debris: c.debris.isEmpty ? nil : c.debris)
  }

  public func snapSignals(_ s: SurvivorGroup) -> SignalSnapshot {
    let g = s.sig!
    let f = Survivors.finite
    return SignalSnapshot(rockets: f(g.rockets), rocketT: f(g.rocketT), rocketHold: g.rocketHold, fired: f(g.fired), smoke: f(g.smoke),
                          smokeBurn: f(g.smokeBurn), flares: f(g.flares), flareBurn: f(g.flareBurn), whistle: g.whistle, dye: g.dye, dyeT: f(g.dyeT),
                          dyeStampT: f(g.dyeStampT), mirror: g.mirror, epirb: g.epirb, epirbT: f(g.epirbT), strobe: g.strobe)
  }

  /// The groups spawned from the def make way for the snapshot's. Entries due later stay pending. Returns
  /// the live carriers made from cp.carriers (same order, nil where none could be made) so the mission can
  /// re-point what follows a craft. The op 9★ bottle stays afloat unless it had already been fished out.
  @discardableResult
  public func restoreCheckpoint(_ cp: SurvivorsCheckpoint) -> [Carrier?] {
    let t = JSNumber.or(cp.elapsed, 0)
    let later = (def?["survivors"].array ?? []).filter { $0.jsTruthy && SurvivorEntry($0).at > t }.map { SurvivorEntry($0) }
    let b = bottle!
    let keep = b.active && !b.taken && !cp.bottleTaken ? (b.x, b.z, b.y, b.yaw, b.phase) : nil
    clear()
    if let k = keep {
      b.x = k.0
      b.z = k.1
      b.y = k.2
      b.yaw = k.3
      b.phase = k.4
      b.active = true
      render.bottleVisible = true
    }
    elapsed = t
    pending = stableSorted(later) { $0.at < $1.at }
    let free = cp.carriers.map { $0.flatMap { cpCarrier($0) } }
    for g in cp.groups {
      let e = g.entry
      let people = g.people
      if people.isEmpty { continue }
      var fields: [(String, JSONValue)] = [
        ("type", .string(g.type ?? e.type ?? "")), ("x", .number(g.x)), ("z", .number(g.z)), ("count", .number(Double(people.count))),
        ("people", .array(people.map { $0.json })), ("at", .number(0)), ("hidden", .bool(!g.spotted)), ("pet", g.pet ? e["pet"] : .null),
      ]
      if let d = g.datum {
        var o = JSONObject()
        o.set("x", .number(d.x))
        o.set("z", .number(d.z))
        fields.append(("datum", .object(o)))
        fields.append(("datumRadius", .number(d.radius)))
      } else {
        fields.append(("datum", .null))
        fields.append(("datumRadius", e["datumRadius"]))
      }
      let s = spawn(e.with(fields))
      s.tag = e.tag ?? s.tag
      s.def = e
      s.health = SurvivorMath.clamp01(g.health ?? 1)
      s.warmth = s.health
      s.critical = s.health <= tables.critical
      s.age = JSNumber.or(g.age, 0)
      if g.spotted && !s.spotted {
        s.spotted = true
        s.state = .spotted
      }
      let raft = g.raft.flatMap { $0 >= 0 && $0 < free.count ? free[$0] : nil }
      if let raft, raft.dropped, s.carrier == nil {
        // back aboard the raft the crew dropped them (quietly: no splash, no «на плоту» call)
        s.carrier = raft
        raft.riders.append(s)
        raft.emptyT = 0
        s.position = V3(raft.x, raft.y, raft.z)
      } else if let c = s.carrier, let k = g.carrier {
        cpPose(c, k)
      }
      if let k = g.sig {
        // spent rockets, smoke and flares stay spent; a scripted rocket already fired no longer holds the rest
        if let v = k.rockets { s.sig.rockets = v }
        if let v = k.rocketT { s.sig.rocketT = v }
        if let v = k.rocketHold { s.sig.rocketHold = v }
        if let v = k.fired { s.sig.fired = v }
        if let v = k.smoke { s.sig.smoke = v }
        if let v = k.smokeBurn { s.sig.smokeBurn = v }
        if let v = k.flares { s.sig.flares = v }
        if let v = k.flareBurn { s.sig.flareBurn = v }
        if let v = k.whistle { s.sig.whistle = v }
        if let v = k.dye { s.sig.dye = v }
        if let v = k.dyeT { s.sig.dyeT = v }
        if let v = k.dyeStampT { s.sig.dyeStampT = v }
        if let v = k.mirror { s.sig.mirror = v }
        if let v = k.epirb { s.sig.epirb = v }
        if let v = k.epirbT { s.sig.epirbT = v }
        if let v = k.strobe { s.sig.strobe = v }
        s.sig.flareObj = s.sig.flareBurn > 0 ? ctx.fx?.flare(s.position.x, s.position.z, life: s.sig.flareBurn, held: true) : nil
        if s.sig.flareObj == nil { s.sig.flareBurn = 0 }
      }
    }
    rescuedTotal = cp.rescued
    lostTotal = cp.lost
    for m in cp.lostMarkers {
      lostMarkers.append(LostMarker(x: m.x, z: m.z, y: 0, t: ctx.time() - 10, group: nil, phase: rng.next() * 10))
    }
    return free
  }

  /// A free carrier from its snapshot: a dropped raft, or a craft built from its def entry like the group's
  /// own (hull name, wreck model, container paint) and then let go.
  func cpCarrier(_ f: SurvivorsCheckpoint.FreeCarrier) -> Carrier? {
    let k = f.snapshot
    let c: Carrier
    if k.dropped {
      c = newCarrier(.raft, k.x ?? .nan, k.z ?? .nan, Carrier.Options(phase: rng.next() * 100, dropped: true))
      carriers.append(c)
    } else {
      let entry = f.entry ?? SurvivorEntry(.object(JSONObject()))
      let ghost = SurvivorGroup(id: GroupID(0), type: k.type, entry: entry, x: k.x ?? .nan, z: k.z ?? .nan, count: 1, hidden: false, ringSpin: 0)
      makeCarrier(ghost, entry)
      guard let made = ghost.carrier else { return nil }
      made.owner = nil
      c = made
    }
    cpPose(c, k)
    return c
  }

  func cpPose(_ c: Carrier, _ k: CarrierSnapshot) {
    if let v = k.x { c.x = v }
    if let v = k.z { c.z = v }
    if let v = k.yaw { c.yaw = v }
    if let v = k.age { c.age = v }
    if let v = k.flood { c.flood = v }
    if let v = k.capsized { c.capsized = v }
    if let v = k.flip { c.flip = v }
    if let v = k.flipT { c.flipT = v }
    if let v = k.sink { c.sink = v }
    if let v = k.sinking { c.sinking = v }
    if let v = k.sinkAt { c.sinkAt = v }
    if let v = k.roll { c.roll = v }
    if let v = k.pitch { c.pitch = v }
    if let v = k.baseRoll { c.baseRoll = v }
    if let v = k.inflate { c.inflate = v }
    if let v = k.emptyT { c.emptyT = v }
    if let v = k.dissolve { c.dissolve = v }
    if let v = k.warned { c.warned = v }
    if let v = k.lampDead { c.lampDead = v }
    if let v = k.tipT { c.tipT = v }
    if let v = k.oilN { c.oilN = v }
    if let a = k.anchor { c.anchor.set(a.x, 0, a.y) }
    if let hex = k.color, c.color != nil { c.color = Color3(hex: hex) }
    if let d = k.debris { c.debris = d }
    if let ocean = ctx.ocean { c.pose(ocean, 0) }
  }
}

// ---- JSON (the web's plain-data checkpoint objects; mission saves and the parity tests use it) -------------

extension CarrierDebris {
  /// { kind, dx, dz, x, z, y, yaw, spin, drift }
  public var json: JSONValue {
    var o = JSONObject()
    o.set("kind", .string(kind))
    for (k, v) in [("dx", dx), ("dz", dz), ("x", x), ("z", z), ("y", y), ("yaw", yaw), ("spin", spin), ("drift", drift)] { o.set(k, .number(v)) }
    return .object(o)
  }

  public init?(json v: JSONValue) {
    guard let kind = v["kind"].string else { return nil }
    let d = { (k: String) in v[k].double ?? .nan }
    self.init(kind: kind, dx: d("dx"), dz: d("dz"), x: d("x"), z: d("z"), y: d("y"), yaw: d("yaw"), spin: d("spin"), drift: d("drift"))
  }
}

extension CarrierSnapshot {
  static let numberKeys: [String] = ["x", "z", "yaw", "age", "flood", "flip", "flipT", "sink", "sinking", "sinkAt", "roll", "pitch", "baseRoll", "inflate",
                                     "emptyT", "dissolve", "tipT", "oilN"]

  private var numbers: [Double?] {
    [x, z, yaw, age, flood, flip, flipT, sink, sinking, sinkAt, roll, pitch, baseRoll, inflate, emptyT, dissolve, tipT, oilN]
  }

  /// snapCarrier(c) as the web object (members that are nil are absent).
  public var json: JSONValue {
    var o = JSONObject()
    o.set("type", .string(type))
    o.set("kind", .string(kind.rawValue))
    o.set("dropped", .bool(dropped))
    for (k, v) in zip(Self.numberKeys, numbers) { if let v { o.set(k, .number(v)) } }
    if let capsized { o.set("capsized", .bool(capsized)) }
    if let warned { o.set("warned", .bool(warned)) }
    if let lampDead { o.set("lampDead", .bool(lampDead)) }
    if let a = anchor {
      var ao = JSONObject()
      ao.set("x", .number(a.x))
      ao.set("z", .number(a.y))
      o.set("anchor", .object(ao))
    }
    if let color { o.set("color", .number(color)) }
    if let debris { o.set("debris", .array(debris.map(\.json))) }
    return .object(o)
  }

  public init?(json v: JSONValue) {
    guard let type = v["type"].string, let kind = v["kind"].string.flatMap(CarrierKind.init(rawValue:)) else { return nil }
    let n = { (k: String) in v[k].double }
    self.init(type: type, kind: kind, dropped: v["dropped"].bool ?? false, x: n("x"), z: n("z"), yaw: n("yaw"), age: n("age"), flood: n("flood"),
              capsized: v["capsized"].bool, flip: n("flip"), flipT: n("flipT"), sink: n("sink"), sinking: n("sinking"), sinkAt: n("sinkAt"),
              roll: n("roll"), pitch: n("pitch"), baseRoll: n("baseRoll"), inflate: n("inflate"), emptyT: n("emptyT"), dissolve: n("dissolve"),
              warned: v["warned"].bool, lampDead: v["lampDead"].bool, tipT: n("tipT"), oilN: n("oilN"),
              anchor: v["anchor"]["x"].double.flatMap { ax in v["anchor"]["z"].double.map { V2(ax, $0) } }, color: n("color"),
              debris: v["debris"].array?.compactMap(CarrierDebris.init(json:)))
  }
}

extension SignalSnapshot {
  /// snapSignals(s) as the web object (members that are nil are absent).
  public var json: JSONValue {
    var o = JSONObject()
    let nums: [(String, Double?)] = [("rockets", rockets), ("rocketT", rocketT), ("fired", fired), ("smoke", smoke), ("smokeBurn", smokeBurn),
                                     ("flares", flares), ("flareBurn", flareBurn), ("dyeT", dyeT), ("dyeStampT", dyeStampT), ("epirbT", epirbT)]
    let bools: [(String, Bool?)] = [("rocketHold", rocketHold), ("whistle", whistle), ("dye", dye), ("mirror", mirror), ("epirb", epirb), ("strobe", strobe)]
    for (k, v) in nums { if let v { o.set(k, .number(v)) } }
    for (k, v) in bools { if let v { o.set(k, .bool(v)) } }
    return .object(o)
  }

  public init(json v: JSONValue) {
    let n = { (k: String) in v[k].double }
    self.init(rockets: n("rockets"), rocketT: n("rocketT"), rocketHold: v["rocketHold"].bool, fired: n("fired"), smoke: n("smoke"),
              smokeBurn: n("smokeBurn"), flares: n("flares"), flareBurn: n("flareBurn"), whistle: v["whistle"].bool, dye: v["dye"].bool, dyeT: n("dyeT"),
              dyeStampT: n("dyeStampT"), mirror: v["mirror"].bool, epirb: v["epirb"].bool, epirbT: n("epirbT"), strobe: v["strobe"].bool)
  }
}

extension SurvivorsCheckpoint {
  /// The restoreCheckpoint(cp) argument as the web builds it ({elapsed, groups: [{entry, type, x, z, people,
  /// health, spotted, age, pet, datum, carrier, raft, sig}], carriers: [{...snapCarrier, entry}], rescued, lost,
  /// lostMarkers: [{x, z}], bottleTaken}).
  public init(json v: JSONValue) {
    var groups = [Group]()
    for g in v["groups"].array ?? [] {
      let d = g["datum"]
      let datum = d["x"].double.flatMap { dx in d["z"].double.flatMap { dz in d["radius"].double.map { (dx, dz, $0) } } }
      groups.append(Group(entry: SurvivorEntry(g["entry"]), type: g["type"].string, x: g["x"].double ?? 0, z: g["z"].double ?? 0,
                          people: (g["people"].array ?? []).compactMap(PersonRecord.init(json:)), health: g["health"].double,
                          spotted: g["spotted"].jsTruthy, age: g["age"].double, pet: g["pet"].jsTruthy, datum: datum,
                          carrier: CarrierSnapshot(json: g["carrier"]), raft: g["raft"].int, sig: g["sig"].isNull ? nil : SignalSnapshot(json: g["sig"])))
    }
    let carriers: [FreeCarrier?] = (v["carriers"].array ?? []).map { k in
      CarrierSnapshot(json: k).map { FreeCarrier(snapshot: $0, entry: k["entry"].isNull ? nil : SurvivorEntry(k["entry"])) }
    }
    self.init(elapsed: v["elapsed"].double ?? 0, groups: groups, carriers: carriers, rescued: v["rescued"].int ?? 0, lost: v["lost"].int ?? 0,
              lostMarkers: (v["lostMarkers"].array ?? []).map { ($0["x"].double ?? .nan, $0["z"].double ?? .nan) }, bottleTaken: v["bottleTaken"].jsTruthy)
  }
}
