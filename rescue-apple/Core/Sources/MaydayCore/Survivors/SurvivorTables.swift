// Typed view of Resources/Data/survivors.json (+ the survivors part of names_ru.json): the numbers of
// systems/survivors.js and survivors/{tables,carriers,craft,crowd,heat,poses,bottle}.js and the person
// lists of survivors/people.js. Everything the survivors simulation reads comes from here — no hand-typed
// constants (PLAN §1.1 goal 5). Plus the small math helpers of survivors/tables.js, which differ from
// core/math.js in a few edge cases (wrapAngle uses JS `%`, smooth has no guard for a == b).

/// TYPES[type] (DESIGN §3.11): warmth = seconds 1 → 0 before multipliers, leeway = share of the wind the
/// group drifts with, capture = winch capture radius, size = detection size factor.
public struct SurvivorTypeSpec: Equatable, Sendable {
  public var warmth: Double
  public var leeway: Double
  public var capture: Double
  public var size: Double
  /// hull / plane: seconds of age before she goes
  public var sink: Double?
  /// container: s between tips in a big sea
  public var tipEvery: Double?
  /// wreck: seconds to flood
  public var flood: Double?
}

/// SIG (DESIGN §2.10, §3.10 signal tables).
public struct SignalTable: Equatable, Sendable {
  public var hearRotor: Double
  public var rocketGap: (Double, Double)
  public var rocketError: Double
  public var rocketSignalLife: Double
  public var smokeAt: Double
  public var smokeBurn: Double
  public var smokeSpot: Double
  public var flareAt: Double
  public var flareBurn: Double
  public var flareSpot: Double
  public var whistleAt: Double
  public var whistleGap: (Double, Double)
  public var whistleArc: Double
  public var hornHear: Double
  public var hornCalm: Double
  public var epirbRange: Double
  public var epirbGap: Double
  public var dyeHear: Double
  public var dyeSpot: Double
  public var dyeMinAlt: Double
  public var mirrorRange: Double
  public var mirrorGap: (Double, Double)
  public var mirrorFlash: Double
  public var strobePeriod: Double
  public var strobeOn: Double
  public var lampPeriod: Double

  public static func == (a: SignalTable, b: SignalTable) -> Bool {
    a.hearRotor == b.hearRotor && a.rocketGap == b.rocketGap && a.rocketError == b.rocketError && a.rocketSignalLife == b.rocketSignalLife
      && a.smokeAt == b.smokeAt && a.smokeBurn == b.smokeBurn && a.smokeSpot == b.smokeSpot && a.flareAt == b.flareAt
      && a.flareBurn == b.flareBurn && a.flareSpot == b.flareSpot && a.whistleAt == b.whistleAt && a.whistleGap == b.whistleGap
      && a.whistleArc == b.whistleArc && a.hornHear == b.hornHear && a.hornCalm == b.hornCalm && a.epirbRange == b.epirbRange
      && a.epirbGap == b.epirbGap && a.dyeHear == b.dyeHear && a.dyeSpot == b.dyeSpot && a.dyeMinAlt == b.dyeMinAlt
      && a.mirrorRange == b.mirrorRange && a.mirrorGap == b.mirrorGap && a.mirrorFlash == b.mirrorFlash
      && a.strobePeriod == b.strobePeriod && a.strobeOn == b.strobeOn && a.lampPeriod == b.lampPeriod
  }
}

/// craft.js RAFT (ПСН-6 dimensions, m).
public struct RaftDims: Equatable, Sendable {
  public var R: Double
  public var tube: Double
  public var floorY: Double
  public var doorZ: Double
  public var canopyTop: Double
}

/// craft.js CONT (20' container, m).
public struct ContainerDims: Equatable, Sendable {
  public var L: Double
  public var W: Double
  public var H: Double
  public var freeboard: Double
}

/// One logbook quote: tags, masculine text, feminine text (nil = the same for both).
public struct SurvivorQuote: Equatable, Sendable {
  public var tags: [String]
  public var m: String
  public var f: String?
}

/// One occupation of people.js JOBS: masculine, feminine (nil = men only), weight.
public struct SurvivorJob: Equatable, Sendable {
  public var m: String
  public var f: String?
  public var weight: Double
}

/// A bottle note (bottle.js NOTES).
public struct BottleNote: Equatable, Sendable {
  public var title: String
  public var text: String
}

public struct SurvivorTables {
  // ---- tables.js ------------------------------------------------------------------------------------
  public let personScale: Double // PERSON_SCALE (S)
  public let types: [String: SurvivorTypeSpec]
  public let supportedTypes: [String]
  public let difficultyWarmth: [String: Double]
  public let critical: Double
  public let lostFade: Double
  /// DETECT[preset] = [base, altBonus] (fallback when weather.detectBase() is missing)
  public let detect: [String: (base: Double, altBonus: Double)]
  public let beamSpotTime: Double
  public let beamRange: Double
  public let flareSpotR: Double
  public let flareSpotLife: Double
  public let strobeMult: Double
  public let sig: SignalTable
  public let nearWave: Double
  public let seenRange: Double
  public let swimToBasket: Double
  public let swimSpeed: Double
  public let swimToRaft: Double
  public let raftSeats: Double
  public let dwPushAlt: Double
  public let dwCapsizeAlt: Double
  public let dwCapsizeR: Double
  public let dwCapsizeT: Double
  public let rogueSweep: Double
  public let rogueSweepT: Double
  /// palette sizes (SKIN / HOOD / JACKET / PANTS lengths; the colours themselves are the renderer's)
  public let skinCount: Int
  public let hoodCount: Int // HOOD.length
  public let hoodHoods: Int // HOOD_COUNT: the first entries are hoods, the rest hair
  public let jacketCount: Int
  public let pantsCount: Int
  public let containerColors: [String]

  // ---- survivors.js colours (THREE.Color, linear working space: the exported `lin`) ---------------------
  public let cWhite: Color3
  public let cStrobe: Color3
  public let cLamp: Color3
  public let cChem: Color3
  public let cMirror: Color3
  public let cTape: Color3
  public let cFlare: Color3
  /// SUPINE = setFromAxisAngle((1, 0, 0), −1.38) (the injured float face up)
  public let supine: Quat

  // ---- craft.js / crowd.js / carriers.js / heat.js / poses.js ---------------------------------------------
  public let raft: RaftDims
  public let cont: ContainerDims
  /// CONT_FADE: container paint after sun and salt (lowercase hex → hex)
  public let contFade: [String: String]
  public let planeWingTop: Double
  public let planeWingZ: Double
  public let debrisKinds: [String]
  /// crowd.js FEET_Y: standing people: origin = deck height − FEET_Y
  public let feetY: Double
  /// carriers.js PLANE_SEATS: [x, z offset from the wing's centre line, legFold]
  public let planeSeats: [[Double]]
  public let thermalDetect: Double
  /// poses.js POSE ids (name → index)
  public let poseIds: [String: Int]

  // ---- bottle.js ------------------------------------------------------------------------------------------
  public let bottlePoints: Double
  public let bottleScale: Double
  public let bottleCaptureT: Double
  public let bottleBasketR: Double
  public let bottleHoverAlt: Double
  public let bottleHoverR: Double
  public let bottleRareChance: Double
  public let bottleGlint: Color3
  public let bottleNotes: [BottleNote]

  // ---- people.js (names_ru.json) ---------------------------------------------------------------------------
  public let firstM: [String]
  public let firstF: [String]
  public let childM: [String]
  public let childF: [String]
  public let surnames: [String]
  /// JOBS[type] in table order (types keep their JS key order)
  public let jobs: [String: [SurvivorJob]]
  public let quotes: [SurvivorQuote]

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("survivors"), names: try catalog.data("names_ru"))
  }

  /// `json` = the payload of survivors.json, `names` = the payload of names_ru.json.
  public init(json d: JSONValue, names n: JSONValue) throws {
    let t = d["survivors/tables"]
    personScale = try t["PERSON_SCALE"].requireDouble("tables.PERSON_SCALE")
    var ty = [String: SurvivorTypeSpec]()
    for (k, v) in try t["TYPES"].requireObject("tables.TYPES").entries {
      ty[k] = SurvivorTypeSpec(warmth: try v["warmth"].requireDouble("TYPES.\(k).warmth"), leeway: try v["leeway"].requireDouble("TYPES.\(k).leeway"),
                               capture: try v["capture"].requireDouble("TYPES.\(k).capture"), size: try v["size"].requireDouble("TYPES.\(k).size"),
                               sink: v["sink"].double, tipEvery: v["tipEvery"].double, flood: v["flood"].double)
    }
    types = ty
    supportedTypes = try t["SUPPORTED_TYPES"].requireArray("tables.SUPPORTED_TYPES").map { try $0.requireString("SUPPORTED_TYPES[]") }
    var dw = [String: Double]()
    for (k, v) in try t["DIFFICULTY_WARMTH"].requireObject("tables.DIFFICULTY_WARMTH").entries { dw[k] = try v.requireDouble("DIFFICULTY_WARMTH.\(k)") }
    difficultyWarmth = dw
    critical = try t["CRITICAL"].requireDouble("tables.CRITICAL")
    lostFade = try t["LOST_FADE"].requireDouble("tables.LOST_FADE")
    var det = [String: (base: Double, altBonus: Double)]()
    for (k, v) in try t["DETECT"].requireObject("tables.DETECT").entries {
      let p = try v.requireDoubles("DETECT.\(k)")
      guard p.count == 2 else { throw JSONError("DETECT.\(k): expected [base, altBonus]") }
      det[k] = (p[0], p[1])
    }
    detect = det
    beamSpotTime = try t["BEAM_SPOT_TIME"].requireDouble("tables.BEAM_SPOT_TIME")
    beamRange = try t["BEAM_RANGE"].requireDouble("tables.BEAM_RANGE")
    flareSpotR = try t["FLARE_SPOT_R"].requireDouble("tables.FLARE_SPOT_R")
    flareSpotLife = try t["FLARE_SPOT_LIFE"].requireDouble("tables.FLARE_SPOT_LIFE")
    strobeMult = try t["STROBE_MULT"].requireDouble("tables.STROBE_MULT")
    let s = t["SIG"]
    func sd(_ k: String) throws -> Double { try s[k].requireDouble("SIG.\(k)") }
    func pair(_ k: String) throws -> (Double, Double) {
      let p = try s[k].requireDoubles("SIG.\(k)")
      guard p.count == 2 else { throw JSONError("SIG.\(k): expected [lo, hi]") }
      return (p[0], p[1])
    }
    sig = SignalTable(
      hearRotor: try sd("hearRotor"), rocketGap: try pair("rocketGap"), rocketError: try sd("rocketError"), rocketSignalLife: try sd("rocketSignalLife"),
      smokeAt: try sd("smokeAt"), smokeBurn: try sd("smokeBurn"), smokeSpot: try sd("smokeSpot"), flareAt: try sd("flareAt"), flareBurn: try sd("flareBurn"),
      flareSpot: try sd("flareSpot"), whistleAt: try sd("whistleAt"), whistleGap: try pair("whistleGap"), whistleArc: try sd("whistleArc"),
      hornHear: try sd("hornHear"), hornCalm: try sd("hornCalm"), epirbRange: try sd("epirbRange"), epirbGap: try sd("epirbGap"), dyeHear: try sd("dyeHear"),
      dyeSpot: try sd("dyeSpot"), dyeMinAlt: try sd("dyeMinAlt"), mirrorRange: try sd("mirrorRange"), mirrorGap: try pair("mirrorGap"),
      mirrorFlash: try sd("mirrorFlash"), strobePeriod: try sd("strobePeriod"), strobeOn: try sd("strobeOn"), lampPeriod: try sd("lampPeriod"))
    func td(_ k: String) throws -> Double { try t[k].requireDouble("tables.\(k)") }
    nearWave = try td("NEAR_WAVE")
    seenRange = try td("SEEN_RANGE")
    swimToBasket = try td("SWIM_TO_BASKET")
    swimSpeed = try td("SWIM_SPEED")
    swimToRaft = try td("SWIM_TO_RAFT")
    raftSeats = try td("RAFT_SEATS")
    dwPushAlt = try td("DW_PUSH_ALT")
    dwCapsizeAlt = try td("DW_CAPSIZE_ALT")
    dwCapsizeR = try td("DW_CAPSIZE_R")
    dwCapsizeT = try td("DW_CAPSIZE_T")
    rogueSweep = try td("ROGUE_SWEEP")
    rogueSweepT = try td("ROGUE_SWEEP_T")
    skinCount = t["SKIN"].count
    hoodCount = t["HOOD"].count
    hoodHoods = try t["HOOD_COUNT"].requireInt("tables.HOOD_COUNT")
    jacketCount = t["JACKET"].count
    pantsCount = t["PANTS"].count
    containerColors = try t["CONTAINER_COLORS"].requireArray("tables.CONTAINER_COLORS").map { try $0.requireString("CONTAINER_COLORS[]") }
    guard skinCount > 0, hoodCount > hoodHoods, jacketCount > 0, pantsCount > 0 else { throw JSONError("survivors palettes are empty") }

    let sv = d["survivors"]
    func lin(_ v: JSONValue, _ what: String) throws -> Color3 {
      let l = try v["lin"].requireDoubles("\(what).lin")
      guard l.count == 3 else { throw JSONError("\(what).lin: expected 3 numbers") }
      return Color3(l[0], l[1], l[2])
    }
    cWhite = try lin(sv["C_WHITE"], "survivors.C_WHITE")
    cStrobe = try lin(sv["C_STROBE"], "survivors.C_STROBE")
    cLamp = try lin(sv["C_LAMP"], "survivors.C_LAMP")
    cChem = try lin(sv["C_CHEM"], "survivors.C_CHEM")
    cMirror = try lin(sv["C_MIRROR"], "survivors.C_MIRROR")
    cTape = try lin(sv["C_TAPE"], "survivors.C_TAPE")
    cFlare = try lin(sv["C_FLARE"], "survivors.C_FLARE")
    let sq = try sv["SUPINE"].requireDoubles("survivors.SUPINE")
    guard sq.count == 4 else { throw JSONError("survivors.SUPINE: expected a quaternion") }
    supine = Quat(sq[0], sq[1], sq[2], sq[3])

    let cr = d["survivors/craft"]
    let r = cr["RAFT"]
    raft = RaftDims(R: try r["R"].requireDouble("RAFT.R"), tube: try r["tube"].requireDouble("RAFT.tube"), floorY: try r["floorY"].requireDouble("RAFT.floorY"),
                    doorZ: try r["doorZ"].requireDouble("RAFT.doorZ"), canopyTop: try r["canopyTop"].requireDouble("RAFT.canopyTop"))
    let c = cr["CONT"]
    cont = ContainerDims(L: try c["L"].requireDouble("CONT.L"), W: try c["W"].requireDouble("CONT.W"), H: try c["H"].requireDouble("CONT.H"),
                         freeboard: try c["freeboard"].requireDouble("CONT.freeboard"))
    var fade = [String: String]()
    for (k, v) in cr["CONT_FADE"].object?.entries ?? [] { fade[k] = try v.requireString("CONT_FADE.\(k)") }
    contFade = fade
    planeWingTop = try cr["PLANE"]["wingTop"].requireDouble("PLANE.wingTop")
    planeWingZ = try cr["PLANE"]["wingZ"].requireDouble("PLANE.wingZ")
    debrisKinds = try cr["DEBRIS_KINDS"].requireArray("craft.DEBRIS_KINDS").map { try $0.requireString("DEBRIS_KINDS[]") }
    feetY = try d["survivors/crowd"]["FEET_Y"].requireDouble("crowd.FEET_Y")
    planeSeats = try d["survivors/carriers"]["PLANE_SEATS"].requireArray("carriers.PLANE_SEATS").map { try $0.requireDoubles("PLANE_SEATS[]") }
    guard !planeSeats.isEmpty, planeSeats.allSatisfy({ $0.count == 3 }) else { throw JSONError("carriers.PLANE_SEATS: expected [x, z, legFold] rows") }
    thermalDetect = try d["survivors/heat"]["THERMAL_DETECT"].requireDouble("heat.THERMAL_DETECT")
    var poses = [String: Int]()
    for (k, v) in try d["survivors/poses"]["POSE"].requireObject("poses.POSE").entries { poses[k] = try v.requireInt("POSE.\(k)") }
    poseIds = poses

    let b = d["survivors/bottle"]
    bottlePoints = try b["BOTTLE_POINTS"].requireDouble("bottle.BOTTLE_POINTS")
    bottleScale = try b["SCALE"].requireDouble("bottle.SCALE")
    bottleCaptureT = try b["CAPTURE_T"].requireDouble("bottle.CAPTURE_T")
    bottleBasketR = try b["BASKET_R"].requireDouble("bottle.BASKET_R")
    bottleHoverAlt = try b["HOVER_ALT"].requireDouble("bottle.HOVER_ALT")
    bottleHoverR = try b["HOVER_R"].requireDouble("bottle.HOVER_R")
    bottleRareChance = try b["RARE_CHANCE"].requireDouble("bottle.RARE_CHANCE")
    bottleGlint = try lin(b["C_GLINT"], "bottle.C_GLINT")
    bottleNotes = try n["survivors/bottle"]["NOTES"].requireArray("names_ru.survivors/bottle.NOTES").map {
      BottleNote(title: try $0["title"].requireString("NOTES[].title"), text: try $0["text"].requireString("NOTES[].text"))
    }
    guard !bottleNotes.isEmpty else { throw JSONError("names_ru: no bottle notes") }

    let p = n["survivors/people"]
    func strs(_ k: String) throws -> [String] {
      let a = try p[k].requireArray("people.\(k)").map { try $0.requireString("people.\(k)[]") }
      guard !a.isEmpty else { throw JSONError("people.\(k) is empty") }
      return a
    }
    firstM = try strs("FIRST_M")
    firstF = try strs("FIRST_F")
    childM = try strs("CHILD_M")
    childF = try strs("CHILD_F")
    surnames = try strs("SURNAMES")
    var jb = [String: [SurvivorJob]]()
    for (k, v) in try p["JOBS"].requireObject("people.JOBS").entries {
      jb[k] = try v.requireArray("JOBS.\(k)").map {
        SurvivorJob(m: try $0[0].requireString("JOBS.\(k)[][0]"), f: $0[1].string, weight: try $0[2].requireDouble("JOBS.\(k)[][2]"))
      }
    }
    jobs = jb
    quotes = try p["QUOTES"].requireArray("people.QUOTES").map {
      SurvivorQuote(tags: try $0[0].requireArray("QUOTES[][0]").map { try $0.requireString("QUOTES tag") }, m: try $0[1].requireString("QUOTES[][1]"),
                    f: $0[2].string)
    }
  }

  /// TYPES[type]
  @inline(__always) public func type(_ name: String) -> SurvivorTypeSpec? { types[name] }

  /// POSE[name]
  public func pose(_ name: String) -> Int { poseIds[name] ?? 0 }
}

// ---- survivors/tables.js helpers -------------------------------------------------------------------------

/// The small math helpers of survivors/tables.js (and survivors/carriers.js re-exports), JS semantics.
public enum SurvivorMath {
  /// clamp(v, a, b) = v < a ? a : v > b ? b : v  (NaN passes through)
  @inline(__always) public static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double { v < a ? a : v > b ? b : v }

  /// clamp01(v)
  @inline(__always) public static func clamp01(_ v: Double) -> Double { v < 0 ? 0 : v > 1 ? 1 : v }

  /// smooth(a, b, x): t = clamp01((x − a) / (b − a)); t²(3 − 2t)
  @inline(__always) public static func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
  }

  /// lerp(a, b, t) = a + (b − a)·t
  @inline(__always) public static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

  /// wrapAngle(a): (a + π) % 2π (JS remainder, sign of the dividend), + 2π when negative, − π
  @inline(__always) public static func wrapAngle(_ a0: Double) -> Double {
    var a = (a0 + JS.PI).truncatingRemainder(dividingBy: JS.PI * 2)
    if a < 0 { a += JS.PI * 2 }
    return a - JS.PI
  }

  /// approach(cur, target, λ, dt) = cur + (target − cur)·(1 − e^(−λ·dt))
  @inline(__always) public static func approach(_ cur: Double, _ target: Double, _ lambda: Double, _ dt: Double) -> Double {
    cur + (target - cur) * (1 - JS.exp(-lambda * dt))
  }
}

/// A stable sort (JS Array.prototype.sort is stable in V8; Swift's sort is not guaranteed to be).
func stableSorted<T>(_ a: [T], by less: (T, T) -> Bool) -> [T] {
  var out = a
  // insertion sort: the lists sorted here are tiny (pending spawns, light candidates)
  if out.count < 2 { return out }
  for i in 1..<out.count {
    let x = out[i]
    var j = i - 1
    while j >= 0 && less(x, out[j]) {
      out[j + 1] = out[j]
      j -= 1
    }
    out[j + 1] = x
  }
  return out
}
