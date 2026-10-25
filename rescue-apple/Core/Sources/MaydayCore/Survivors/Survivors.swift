// systems/survivors.js — the people we save (CONTRACT: survivors; DESIGN §2.10, §3.5, §3.10, §3.11, §4 #17–27).
//
// Gameplay: groups (swimmer, raft, hull, container, injured, deck, wreck, plane) drift with current +
// leeway·wind + hazard flows + rotor downwash + rogue sweeps, lose warmth (with water temperature, night and
// difficulty multipliers), climb the detection ladder hidden → signal → spotted (crew eyes by weather,
// searchlight 0.4 s, strobes ×3, smoke, flares, dye, mirror, player flares, loudspeaker answers), fire their
// own signals (SignalDesk), swim to the basket and to dropped rafts, capsize, sink, jump, and are lifted one
// by one through the pickup protocol the winch uses (nearestFor → attachToBasket → boardOne; SurvivorQuery).
//
// Port notes:
//   * the simulation runs in Double with the web's operation order; the seeded `rng` (createRng(seed·31+7)
//     on mission:setup) is consumed in the JS order, including the draws inside the draw pass (strokes);
//   * Math.random is `ctx.random` (shared with fx and the heli). three.js spends 4 draws on every object
//     uuid it creates at runtime (the group's Object3D, decals, big hull batches); `ThreeObjectCosts` spends
//     the same number so the cosmetic stream stays aligned with the web (Tests/Vectors/survivors/*);
//   * groups / people / carriers are reference types like the web's objects; events carry GroupIDs, the
//     boarded person a PersonID (a serial over the system's lifetime; BoardedRecord via `boardedRecord(_:)`);
//   * the draw (_draw) is ported in Survivors+Draw.swift: it writes the same instance data the web uploads
//     (crowd, craft batches, heat proxies, collars, glows, lines) into `render`, without the frustum culling
//     (InstanceBounds is the renderer's: MaydayRender/Scene/InstanceCulling).
// Public API beyond the CONTRACT: types, fireSignal(s, kind), spot(s, by), byTag(tag), deckAt(x, z),
// carriers, lostMarkers, elapsed, rescuedTotal, lostTotal, restoreCheckpoint / snapCarrier / snapSignals.

/// Math.random draws three.js spends on object uuids where survivors.js builds three objects at runtime
/// (MathUtils.generateUUID: 4 per Object3D / BufferGeometry / Material / Texture / Source). Measured from the
/// web by tools/export/export-survivors.mjs (survivors/three_costs.json); SurvivorsTraceTests checks them.
public struct ThreeObjectCosts: Equatable, Sendable {
  /// spawn(): the group's `object3d: new THREE.Object3D()`
  public var groupObject: Int = 4
  /// _hullDecal(): nameDecal (texture + source + material + plane) + the decal Mesh
  public var hullDecal: Int = 20
  /// _hullDecal(): hullNameGeometry(style), built once per style and Survivors instance
  public var hullNameGeometry: Int = 20
  /// _planeDecal(): nameDecal + Mesh
  public var planeDecal: Int = 20
  /// _wreckDecal(): nameDecal + BufferGeometry + 2 planes (+ toNonIndexed) + Mesh
  public var wreckDecal: Int = 40
  /// _bigBatch(model, deckY): the hull geometry (all its parts), material and InstancedMesh, once per key
  public var bigBatch: [String: Int] = ["barge": 1796, "ferry": 3564, "trawler": 1596]

  public init() {}
}

public final class Survivors: GameSystem {
  public let tables: SurvivorTables
  public let ctx: SeaContext

  // ---- CONTRACT ------------------------------------------------------------------------------------
  public internal(set) var list: [SurvivorGroup] = []
  public internal(set) var datums: [SurvivorDatum] = []

  // ---- extras -------------------------------------------------------------------------------------
  /// supported group types (mission/prepare.js reads it)
  public let types: [String]
  public internal(set) var carriers: [Carrier] = []
  public internal(set) var lostMarkers: [LostMarker] = []
  public internal(set) var pending: [SurvivorEntry] = []
  public internal(set) var playerFlares: [PlayerFlare] = []
  public internal(set) var rescuedTotal = 0
  public internal(set) var lostTotal = 0
  public internal(set) var elapsed: Double = 0
  /// the mission def of the last mission:setup (nil = none)
  public internal(set) var def: JSONValue?
  public internal(set) var theme: String?
  public internal(set) var waterTemp: Double = 8
  /// surface current (x, z)
  public internal(set) var current = V2()
  public internal(set) var env = SurvivorsEnv()
  public internal(set) var quality: String?
  /// crowd.extras: underwater bodies + keylines from medium up (DESIGN §8.2)
  public internal(set) var crowdExtras = true
  /// the seeded simulation rng (createRng(4242) until the first mission:setup)
  public internal(set) var rng: Rng
  public var threeCosts = ThreeObjectCosts()
  /// Everything the draw pass wrote this frame (SurvivorsRenderer reads it).
  public internal(set) var render: SurvivorsRenderState
  public internal(set) var bottle: SurvivorBottle!

  lazy var desk = SignalDesk(self)
  var idCounter = 0
  var carrierIds = 0
  var quoteUsed = Set<String>()
  var hullNameBuilt = Set<String>()
  var bigBatchKeys = Set<String>()
  /// PersonID of the last boarded person: a serial over the Survivors' lifetime (not reset on mission:setup,
  /// so a record the mission ledger kept from before a checkpoint retry never shares an id with a new one)
  var personSerial = 0
  /// survivor:boarded records of this mission by PersonID
  public internal(set) var boarded: [PersonID: BoardedRecord] = [:]
  private var subs: [EventSubscription] = []

  public init(tables: SurvivorTables, ctx: SeaContext) {
    self.tables = tables
    self.ctx = ctx
    types = tables.supportedTypes
    rng = Rng(seed: 4242)
    render = SurvivorsRenderState()
    bottle = SurvivorBottle(self)
    let ev = ctx.events
    subs.append(ev.on(GameEvent.MissionSetup.self) { [unowned self] p in self.setup(p.def) })
    subs.append(ev.on(GameEvent.HeliFlare.self) { [unowned self] p in
      if p.x.isFinite && p.z.isFinite { self.playerFlares.append(PlayerFlare(x: p.x, z: p.z, until: self.ctx.time() + self.tables.flareSpotLife)) }
    })
    subs.append(ev.on(GameEvent.HeliLoudspeaker.self) { [unowned self] p in self.onHorn(p.x, p.z) })
    subs.append(ev.on(GameEvent.HeliRaftDrop.self) { [unowned self] p in self.onRaftDrop(p.x, p.z) })
    applyQuality()
  }

  deinit {
    for s in subs { s.off() }
  }

  /// settings.onChange('quality') → _applyQuality (the host wires the listener, like the heli's).
  public func applyQuality() {
    let q = ctx.settings.get("quality")
    quality = q.string
    crowdExtras = !(q.string == "low")
  }

  // ==================================================================================================
  // CONTRACT API
  public func clear() {
    for s in list {
      if let fo = s.sig?.flareObj { fo.t = fo.life } // let fx retire a handheld flare we were holding
    }
    // break the group ↔ carrier references of the discarded mission (the web lets the GC take them)
    for s in list { s.carrier = nil }
    for c in carriers { c.riders.removeAll() }
    list.removeAll()
    datums.removeAll()
    pending.removeAll()
    playerFlares.removeAll()
    carriers.removeAll()
    lostMarkers.removeAll()
    rescuedTotal = 0
    lostTotal = 0
    elapsed = 0
    quoteUsed.removeAll()
    bottle.clear()
  }

  /// Spawn one group from a def entry ({type, x, z, count, hidden, signals, people, height, name, …}).
  @discardableResult
  public func spawn(_ entry: SurvivorEntry) -> SurvivorGroup {
    var type = entry.type.flatMap { tables.types[$0] != nil ? $0 : nil } ?? "swimmer"
    if !types.contains(type) {
      let fb = entry["fallbackType"].string
      type = fb.flatMap { tables.types[$0] != nil && types.contains($0) ? $0 : nil } ?? "raft"
    }
    let cv = entry["count"]
    let countD = cv.isNull ? (type == "raft" ? 3 : type == "deck" ? 4 : type == "hull" ? 2 : 1) : cv.jsToNumber
    let countR = JS.max(1, JS.round(countD))
    let count = countR.isFinite ? Int(countR) : 1
    // structures in distress are known from the start (the dispatcher sends you there); people in the
    // water are hidden unless the def says otherwise
    let structure = type == "deck" || type == "wreck"
    let hb = entry["hidden"].bool
    let hidden = structure ? hb == true : hb != false
    let x = entry.x ?? 0
    let z = entry.z ?? 0
    idCounter += 1
    let id = GroupID(idCounter)
    spendRandom(threeCosts.groupObject) // object3d: new THREE.Object3D() (uuid)
    let s = SurvivorGroup(id: id, type: type, entry: entry, x: x, z: z, count: count, hidden: hidden, ringSpin: ctx.random() * JS.PI * 2)
    // people (the mission's manifest when it has one, so cabin and logbook agree)
    var recs: [PersonRecord?]
    if let arr = entry["people"].array, arr.count >= count {
      recs = arr.map { PersonRecord(json: $0) }
    } else {
      let seed = def.map { $0["seed"].isNull ? 1 : $0["seed"].jsToNumber } ?? 1
      recs = SurvivorPeople.makeFallbackPeople(tables, seed: seed * 97 + Double(id.raw), type: type, count: count).map { Optional($0) }
    }
    for i in 0..<count {
      let r = (i < recs.count ? recs[i] : nil) ?? (recs.first ?? nil)
      s.people.append(makePerson(r, s))
    }
    s.sig = SurvivorSignals.make(type: type, entry: entry, rng: rng, script: def?["script"] ?? .null)
    makeCarrier(s, entry)
    s.position.y = s.deckY ?? ctx.ocean?.heightAt(s.position.x, s.position.z) ?? 0
    s.height = s.deckY ?? 0
    // the dispatcher's search area (datum): drifts with the water and grows 0.5 m/s
    if hidden {
      let rv = entry["datumRadius"]
      let R = rv.isNull ? 200 : rv.jsToNumber
      var dx = entry["datum"]["x"].double ?? .nan
      var dz = entry["datum"]["z"].double ?? .nan
      if !(dx.isFinite && dz.isFinite) {
        let a = rng.next() * JS.PI * 2
        let r = rng.next() * 0.35 * R
        dx = x + JS.cos(a) * r
        dz = z + JS.sin(a) * r
      }
      let d = SurvivorDatum(x: dx, z: dz, radius: R, ids: [s.id], tag: s.tag, label: s.label ?? "", group: s)
      s.datum = d
      datums.append(d)
    }
    list.append(s)
    ctx.events.emit(GameEvent.SurvivorSpawn(s: s.id))
    return s
  }

  /// Closest pick-up-able group to (x, z) within maxDist, ranked by distance / capture radius of its type.
  /// People standing on a structure are only reachable from deck level: a basket hanging in the water
  /// below the rig's lower deck (or beside the ferry) does not get them.
  public func nearestGroup(_ x: Double, _ z: Double, _ maxDist: Double = 4.5) -> SurvivorGroup? {
    var best: SurvivorGroup?
    var bk = Double.infinity
    let by = ctx.heli?.seaView.basket?.y
    for s in list {
      if !pickable(s) { continue }
      let d = JS.hypot(s.position.x - x, s.position.z - z)
      if d > maxDist { continue }
      if let dy = s.deckY, dy > 1.5, let b = by, b.isFinite, b < dy - 2.5 { continue }
      let r = tables.types[s.type]?.capture ?? 3
      let k = d / r
      if k < bk {
        bk = k
        best = s
      }
    }
    return best
  }

  public func attach(_ s: SurvivorGroup) {
    if s.attached != nil { return }
    let basket = ctx.heli?.seaView.basket
    // the person closest to the basket goes in (rafts: whoever is in the doorway)
    var bi = 0
    if let b = basket, s.people.count > 1, s.carrier == nil {
      var bd = Double.infinity
      for (i, p) in s.people.enumerated() {
        let d = JS.hypot(p.x - b.x, p.z - b.z)
        if d < bd {
          bd = d
          bi = i
        }
      }
    }
    guard bi < s.people.count else { return }
    let p = s.people.remove(at: bi)
    p.liftWarmth = s.health
    p.attachT = ctx.time()
    p.spin = ctx.random() * JS.PI * 2
    s.attached = p
    if var pet = s.pet, pet.kind == "cat", !pet.refused {
      // «кот отказывается от первой корзины»: it bolts to the far end of whatever they are on
      pet.refused = true
      pet.far = true
      pet.hopT = 0.8
      s.pet = pet
      ctx.events.emit(GameEvent.SurvivorPet(s: s.id, pet: "cat", action: "refuse"))
    }
    s.stateBefore = s.state == .winching ? .spotted : s.state
    s.state = .winching
    if !s.spotted { spot(s, "basket") }
  }

  /// Heli calls it on «Сорвался!», tension, crash, reset; `slip` nil = a plain release.
  public func detach(_ s: SurvivorGroup, slip: BasketSlip?) {
    guard let p = s.attached else { return }
    s.attached = nil
    if s.state == .winching { s.state = s.remaining > 0 ? .spotted : s.state }
    if let opts = slip {
      // fell back into the water: −10 s of warmth, back where the basket was
      let loss = opts.heatLoss.isFinite ? opts.heatLoss : 10
      s.health = JS.max(0.01, s.health - loss / duration(s, env))
      let b = ctx.heli?.seaView.basket
      let bx = b?.x ?? s.position.x
      let bz = b?.z ?? s.position.z
      let onStructure = (s.type == "deck" || s.type == "wreck") && b != nil && (b?.y ?? 0) > (s.deckY ?? 0) - 1
        && JS.hypot(bx - s.position.x, bz - s.position.z) < 10
      if let c = s.carrier, !onStructure, c.kind != .raft {
        splitPerson(s, p, bx, bz, "slip")
        return
      }
      if s.carrier == nil && (s.type == "swimmer" || s.type == "injured") {
        s.position.x = bx
        s.position.z = bz
        ctx.ocean?.splash(bx, bz, 1.2, 0.5)
      }
    }
    s.people.insert(p, at: 0)
    if s.lostPending { lose(s) }
  }

  /// boardOne(s): the person on the cable (or the next one) enters the cabin.
  @discardableResult
  public func board(_ s: SurvivorGroup) -> BoardedRecord {
    var p = s.attached
    if p == nil, !s.people.isEmpty { p = s.people.removeFirst() }
    s.attached = nil
    let warmth = p?.liftWarmth ?? s.health
    let rec = p?.rec ?? PersonRecord(name: "Неизвестный", first: "Неизвестный", surname: "", gender: "m", age: nil, occupation: "")
    let name = rec.name ?? "undefined"
    let gender = (rec.gender.flatMap { $0.isEmpty ? nil : $0 }) ?? SurvivorPeople.guessGender(rec.name)
    let injured = s.type == "injured"
    let minutes = JS.round(JSNumber.or(s.since, 0) + JSNumber.or(s.age, 0) / 60)
    var tags = [String]()
    if rec.child { tags.append("child") }
    if injured { tags.append("injured") }
    if s.flower { tags.append("flower") }
    if s.def["pet"].jsTruthy { tags.append("pet") }
    tags.append(s.carrier?.kind == .raft || s.type == "raft" ? "raft" : s.type)
    if env.night > 0.5 { tags.append("night") }
    if env.intensity > 0.6 { tags.append("storm") }
    if env.preset == "fog" { tags.append("fog") }
    if minutes > 45 || warmth < 0.35 {
      tags.append("long")
      tags.append("cold")
    }
    tags.append("any")
    personSerial += 1
    let pid = PersonID(personSerial)
    let first = rec.first.flatMap { $0.isEmpty ? nil : $0 } ?? SurvivorPeople.jsSplitWhitespace(name).first ?? ""
    let surname = rec.surname ?? SurvivorPeople.jsSplitWhitespace(name).dropFirst().joined(separator: " ")
    let quote = SurvivorPeople.quoteFor(tables, rng, gender, tags, &quoteUsed)
    let petLeaves: String? = s.def["pet"].jsTruthy && s.remaining <= 1 ? s.def["pet"].string : nil
    let person = BoardedRecord(
      id: pid, name: name, first: first, surname: surname, gender: gender, age: rec.age, child: rec.child, occupation: rec.occupation ?? "",
      condition: SurvivorPeople.conditionFor(warmth, injured), warmth: warmth, warmthAtLift: warmth, minutesInWater: JS.max(1, minutes),
      tags: tags, quote: quote, injured: injured, type: s.type, tag: s.tag, label: s.label, pet: petLeaves, survivor: s.id)
    boarded[pid] = person
    if s.remaining > 0 { s.remaining -= 1 }
    rescuedTotal += 1
    if s.state == .winching { s.state = .spotted }
    ctx.events.emit(GameEvent.SurvivorBoarded(s: s.id, person: pid))
    if s.remaining <= 0 {
      if s.state != .lost {
        s.state = .rescued
        releaseCarrier(s)
        dropDatum(s)
        ctx.events.emit(GameEvent.SurvivorRescued(s: s.id))
      }
    } else if s.lostPending {
      lose(s) // the others did not make it while this one was lifted
    }
    return person
  }

  /// The person record of a `survivor:boarded` event.
  public func boardedRecord(_ id: PersonID) -> BoardedRecord? { boarded[id] }

  public func remainingCount() -> Int {
    var n = 0
    for s in list where s.state != .rescued && s.state != .lost { n += s.remaining }
    return n
  }

  public func rescuedCount() -> Int { rescuedTotal }

  public func lostCount() -> Int { lostTotal }

  public func group(id: GroupID) -> SurvivorGroup? { list.first { $0.id == id } }

  // ---- extras ------------------------------------------------------------------------------------
  /// Scripted signals: 'rocket' | 'smoke' | 'flare' | 'whistle' | 'dye' | 'mirror' | 'strobe' | 'epirb'.
  @discardableResult
  public func fireSignal(_ s: SurvivorGroup, _ kind: String = "rocket") -> Bool {
    if s.sig == nil { return false }
    return desk.fire(s, kind, env, scripted: true)
  }

  /// Force "spotted" (tests, scripts).
  public func spot(_ s: SurvivorGroup, _ by: String = "crew") {
    if s.spotted || s.state == .lost || s.state == .rescued { return }
    s.spotted = true
    if s.state == .hidden || s.state == .drifting { s.state = .spotted }
    s.excite = 6 // «Нашли»: both arms for a few seconds
    s.beamT = 0
    dropDatum(s)
    ctx.events.emit(GameEvent.SurvivorSpotted(s: s.id, by: by))
  }

  /// Every group carrying a def tag (splits keep the tag).
  public func byTag(_ tag: String) -> [SurvivorGroup] { list.filter { $0.tag == tag } }

  /// Deck height under (x, z) of the structures people stand on (barge, sinking ferry, the rig's lower
  /// deck), or −Infinity. The winch treats it as the surface (DESIGN §3.5 «на конструкции»).
  public func deckAt(_ x: Double, _ z: Double) -> Double {
    var best = -Double.infinity
    for c in carriers {
      if (c.kind != .barge && c.kind != .wreck && c.kind != .rig) || !c.alive || c.dissolve > 0.3 { continue }
      let y = c.deckHeightAt(x, z)
      if y > best { best = y }
    }
    return best
  }

  // ==================================================================================================
  // Mission setup / events
  func setup(_ def: JSONValue) {
    clear()
    self.def = def.isNull ? nil : def
    boarded.removeAll()
    let seed = def["seed"].isNull ? 1 : def["seed"].jsToNumber
    rng = Rng(seed: Double(SeedFormulas.survivors(seed)))
    waterTemp = def["waterTemp"].double.flatMap { $0.isFinite ? $0 : nil } ?? 8
    current.set(def["current"]["x"].double ?? 0, def["current"]["z"].double ?? 0)
    theme = def["theme"].jsTruthy ? def["theme"].string : nil
    refreshEnv(0)
    var later = [SurvivorEntry]()
    for e in def["survivors"].array ?? [] {
      if !e.jsTruthy { continue }
      let entry = SurvivorEntry(e)
      if entry.at > 0 { later.append(entry) } else { spawn(entry) }
    }
    pending = stableSorted(later) { $0.at < $1.at }
    bottle.setup(def)
  }

  func onHorn(_ x: Double, _ z: Double) {
    for s in list {
      if s.state == .lost || s.state == .rescued { continue }
      let d = JS.hypot(s.position.x - x, s.position.z - z)
      if !s.spotted && d < tables.sig.hornHear && s.health > 0.08 { s.sig.hornT = 1 + rng.next() }
      if s.spotted && d < tables.sig.hornCalm { s.calm = 40 } // «Мы вас видим!» — they stop panicking
    }
  }

  func onRaftDrop(_ x: Double, _ z: Double) {
    if !(x.isFinite && z.isFinite) { return }
    let c = newCarrier(.raft, x, z, Carrier.Options(phase: rng.next() * 100, dropped: true))
    c.yaw = rng.next() * JS.PI * 2
    carriers.append(c)
    ctx.ocean?.splash(x, z, 3, 0.9)
  }

  func newCarrier(_ kind: CarrierKind, _ x: Double, _ z: Double, _ opts: Carrier.Options) -> Carrier {
    carrierIds += 1
    return Carrier(kind, x, z, opts, id: carrierIds, tables: tables, random: ctx.random)
  }

  /// `n` Math.random draws three.js would spend on object uuids here.
  func spendRandom(_ n: Int) {
    if n <= 0 { return }
    for _ in 0..<n { _ = ctx.random() }
  }

  // ==================================================================================================
  // Per-frame
  public func update(_ dt: Double) {
    let env = refreshEnv(dt)
    if env.play {
      elapsed += dt
      while let first = pending.first, first.at <= elapsed { spawn(pending.removeFirst()) }
    }
    var i = playerFlares.count - 1
    while i >= 0 {
      if playerFlares[i].until < env.t { playerFlares.remove(at: i) }
      i -= 1
    }

    // --- simulation ------------------------------------------------------------------------------
    var k = 0
    while k < list.count { // spawns during the loop (splits) are simulated in the same frame, like JS
      let s = list[k]
      k += 1
      if s.state == .rescued && s.attached == nil { continue }
      s.age += env.play ? dt : 0
      s.dHeli = env.heliAlive ? JS.hypot(s.position.x - env.hx, s.position.z - env.hz) : 1e9
      if s.state == .lost {
        lostDrift(s, dt)
        continue
      }
      s.strobe = strobeOn(s, env.night)
      motion(s, env, dt)
      if env.play {
        warmthTick(s, env, dt)
        hazards(s, env, dt)
        if s.state != .lost && s.state != .rescued {
          desk.update(s, self.env, dt, s.dHeli)
          detect(s, self.env, dt)
          near(s)
        }
      }
      if s.pet != nil { petLife(s, env, dt) }
      if s.excite > 0 { s.excite -= dt }
      if s.calm > 0 { s.calm -= dt }
      // «СИГНАЛ» is a moment, not a marker: 20 s after the last ping the group is «нет данных» again
      if s.state == .drifting && !s.spotted && (s.signal == nil || env.t > (s.signal?.until ?? 0)) { s.state = .hidden }
    }
    var ci = 0
    while ci < carriers.count {
      carrierTick(carriers[ci], self.env, dt)
      ci += 1
    }
    var j = carriers.count - 1
    while j >= 0 {
      if !carriers[j].alive { carriers.remove(at: j) }
      j -= 1
    }
    // structures place their people after the carrier pose
    for s in list where s.carrier != nil && (s.type == "deck" || s.type == "wreck") && s.state != .rescued { structureAnchor(s) }
    datumsTick(self.env, dt)

    // --- drawing ---------------------------------------------------------------------------------
    draw(self.env, dt)
  }

  /// Frame snapshot of everything read from other systems (stubs give sensible defaults).
  @discardableResult
  func refreshEnv(_ dt: Double) -> SurvivorsEnv {
    var e = env
    let st = ctx.weather?.seaState ?? SeaWeatherState()
    e.t = ctx.time()
    e.dt = dt
    e.play = ctx.mode() == .play
    e.night = SurvivorMath.clamp01(st.night ?? 0)
    e.preset = st.preset.flatMap { $0.isEmpty ? nil : $0 } ?? "calm"
    e.intensity = SurvivorMath.clamp01(st.intensity ?? 0)
    e.fog = SurvivorMath.clamp01(st.fog ?? 0)
    e.Hs = st.waveHeight ?? 0.5
    e.windSpeed = st.windSpeed ?? 0
    e.windDirX = st.windDir?.x ?? 1
    e.windDirZ = st.windDir?.y ?? 0
    e.windAngle = JS.atan2(e.windDirZ, e.windDirX)
    let pal = st.palette ?? SeaPalette()
    e.sunny = (e.preset == "calm" || e.preset == "clearing" || (pal.sunIntensity ?? 0) > 1.8) && e.night < 0.3
    e.reduceFlashes = ctx.flag("reduceFlashes")
    let det = ctx.weather?.seaDetectBase()
    let fb = tables.detect[e.preset] ?? tables.detect["calm"] ?? (260, 1)
    e.base = det.flatMap { $0.base.isFinite ? $0.base : nil } ?? fb.base
    e.altBonus = det.flatMap { $0.altBonus.isFinite ? $0.altBonus : nil } ?? fb.altBonus
    // heli
    let h = ctx.heli?.seaView
    e.heliAlive = h?.alive ?? false
    // survivors only take a flying heli for a search: an aircraft sitting on its pad (or a dead rotor)
    // does not trigger rockets or dye, otherwise every group within 700 m of the base fires at 0:03
    e.rotorHeard = e.heliAlive && !(h?.landed ?? false) && (h?.rotorRPM ?? 1) > 0.8
    if let h {
      e.hx = h.position.x
      e.hy = h.position.y
      e.hz = h.position.z
      e.alt = (h.altitude.map { $0.isFinite } ?? false) ? h.altitude ?? h.position.y : h.position.y
    }
    e.fogBlind = (e.preset == "fog" || e.fog > 0.55) && e.alt > 35
    e.thermal = thermalBoost(e) // FLIR detection multiplier (1 = off / by day)
    // rotor downwash (DESIGN §2.6.5 layer 9): R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²
    let dw = h?.downwash
    e.dwR = dw.flatMap { $0.radius.isFinite ? $0.radius : nil } ?? 9 + 0.35 * JS.max(0, e.alt)
    if let s = dw?.strength, s.isFinite {
      e.dwS = s
    } else {
      let k = SurvivorMath.clamp01(1 - (e.alt - 4) / 28)
      e.dwS = e.heliAlive ? k * k * SurvivorMath.clamp01(h?.rotorRPM ?? 1) : 0
    }
    if h?.landed ?? false { e.dwS *= 0.3 }
    e.wState = h.map { $0.winchState.isEmpty ? "stowed" : $0.winchState } ?? "stowed"
    e.wLoad = h?.winchLoad
    if let b = h?.basket {
      e.bx = b.x
      e.by = b.y
      e.bz = b.z
    }
    e.bH = h?.winchHeight.flatMap { $0.isFinite ? $0 : nil } ?? 99
    e.bWet = (e.wState == "lowering" || e.wState == "down") && e.bH < 1.6 && e.wLoad == nil
    // light under the surface / on foam (for unlit custom shaders)
    let ai = pal.ambientIntensity ?? 0.6
    let si = pal.sunIntensity ?? 1
    var gl = Color3()
    if let amb = pal.ambient {
      gl = amb
      gl.multiplyScalar(0.45 * ai)
    } else {
      gl.setRGB(0.3, 0.33, 0.36)
    }
    if let sun = pal.sun {
      var c = sun
      c.multiplyScalar(0.12 * si * (1 - e.night))
      gl.add(c)
    }
    var w = tables.cWhite
    w.multiplyScalar(0.6 * JSNumber.or(st.flash, 0))
    gl.add(w)
    e.ghostLight = gl
    if let foam = pal.foam {
      e.foam = foam
      e.foam.multiplyScalar(0.62 + 0.25 * (1 - e.night))
    } else {
      e.foam.setRGB(0.8, 0.84, 0.83)
    }
    env = e
    return e
  }

  /// heat.js thermalBoost: while the thermal view is on at night or in fog, the crew's detection radius
  /// grows ×1.6 and fog no longer blinds it. By day the sea is as warm-looking as a swimmer's hood.
  func thermalBoost(_ e: SurvivorsEnv) -> Double {
    if !ctx.thermalActive() { return 1 }
    return e.night > 0.45 || e.fog > 0.4 || e.preset == "fog" ? tables.thermalDetect : 1
  }

  func pickable(_ s: SurvivorGroup) -> Bool {
    s.state != .rescued && s.state != .lost && s.state != .winching && s.attached == nil && !s.people.isEmpty
  }

  /// «СИГНАЛ»: the ladder's middle rung + the event HUD and audio sync on.
  func emitSignal(_ s: SurvivorGroup, _ kind: String, _ x: Double, _ z: Double, _ error: Double, _ arc: Double, ping: Bool, as: String? = nil) {
    let t = ctx.time()
    if ping {
      s.signal = SignalPing(kind: kind, x: x, z: z, error: error, arc: arc, t: t, until: t + tables.sig.rocketSignalLife)
      if s.state == .hidden { s.state = .drifting }
    }
    ctx.events.emit(GameEvent.SurvivorSignal(s: s.id, kind: `as` ?? kind, x: x, z: z, error: error, arc: arc))
  }

  // ==================================================================================================
  // People
  func makePerson(_ rec: PersonRecord?, _ s: SurvivorGroup) -> SurvivorPerson {
    let child = rec?.child ?? false
    let skin = JS.floor(rng.next() * Double(tables.skinCount))
    let hood = rng.next() < 0.6 ? JS.floor(rng.next() * Double(tables.hoodHoods))
      : Double(tables.hoodHoods) + JS.floor(rng.next() * Double(tables.hoodCount - tables.hoodHoods))
    let jacket = JS.floor(rng.next() * Double(tables.jacketCount))
    let pants = JS.floor(rng.next() * Double(tables.pantsCount))
    let scale = child ? 0.74 : 0.95 + rng.next() * 0.1
    let phase = rng.next() * JS.PI * 2
    let waveArm: Double = rng.next() < 0.7 ? 1 : -1
    let strobePhase = rng.next() * tables.sig.strobePeriod
    let yaw = rng.next() * JS.PI * 2
    return SurvivorPerson(rec: rec, skin: skin, hood: hood, jacket: jacket, pants: pants, scale: scale, phase: phase, waveArm: waveArm,
                          strobePhase: strobePhase, yaw: yaw, x: s.position.x, z: s.position.z)
  }

  func flareHolder(_ s: SurvivorGroup) -> SurvivorPerson? { s.people.first }
}
