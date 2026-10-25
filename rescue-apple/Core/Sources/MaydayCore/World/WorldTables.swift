// Typed view of Resources/Data/world.json for the world simulation (systems/world.js + world/*): the
// tables the web keeps at module level — pad services and heights (world.js), lamp channels
// (materials.js CH), landforms (TERRAIN_STEP, ISLAND_LOBES / FLATS / CUTS / BOUNDS, CLEAR, PATHS, ICE,
// BOULDERS), the lighthouse constants, floater shapes / buoy kinds and lights, the windsock, the
// vegetation counts and terrain.js' gradient table — plus CONT.freeboard of survivors/craft.js.
// Literal numbers inside the web functions stay in the ported functions (with the same expression
// shape); every table is read from the data, never written out by hand.

/// materials.js CH: emissive / lamp channel indices (one shared Float32Array the world writes per frame).
public struct LampChannels: Equatable, Sendable {
  public var ALWAYS = 0, WINDOWS = 1, PERIM = 2, FLOOD = 3, NAV = 4, ANTI = 5, LANTERN = 6, FLAME = 7, WANDS = 8
  public var UNLOAD0 = 9, BUOY0 = 12, PADLIGHT = 18, BOAT = 19, BLUE = 20, CLOUD = 21, DIM = 22, BEACON = 23
  /// CH_COUNT
  public var count = 24

  public init() {}

  init(json c: JSONValue, count n: JSONValue) throws {
    func ch(_ k: String) throws -> Int { try c[k].requireInt("world/materials.CH.\(k)") }
    ALWAYS = try ch("ALWAYS"); WINDOWS = try ch("WINDOWS"); PERIM = try ch("PERIM"); FLOOD = try ch("FLOOD"); NAV = try ch("NAV")
    ANTI = try ch("ANTI"); LANTERN = try ch("LANTERN"); FLAME = try ch("FLAME"); WANDS = try ch("WANDS"); UNLOAD0 = try ch("UNLOAD0")
    BUOY0 = try ch("BUOY0"); PADLIGHT = try ch("PADLIGHT"); BOAT = try ch("BOAT"); BLUE = try ch("BLUE"); CLOUD = try ch("CLOUD")
    DIM = try ch("DIM"); BEACON = try ch("BEACON")
    count = try n.requireInt("world/materials.CH_COUNT")
  }
}

/// world.js SERVICES[type]: {fuel %/s, repair %/s, resupply}.
public struct PadServiceSpec: Equatable, Sendable {
  public var fuel: Double
  public var repair: Double
  public var resupply: Bool
}

/// A floater shape (floaters.js SHAPES[name] / the buoy shape): the numbers the simulation reads.
public struct FloaterShape: Equatable, Sendable {
  /// instance scale
  public var k: Double
  /// vertical offset of the instance (draft), × k
  public var y: Double
  /// collar radius (0 = none), × k
  public var R: Double
  /// per-instance tint choices (nil = none)
  public var tint: [String]?
  /// leeway: the share of the wind the item drifts with
  public var leeway: Double?
  /// the survivors' container model (craft material)
  public var craft: Bool
}

public struct WorldTables {
  // world.js
  public let services: [String: PadServiceSpec]
  public let height: [String: Double]
  // materials.js
  public let ch: LampChannels
  public let glows: Int
  // terrain.js: GX / GY (Float32Array values, widened)
  public let gx: [Double]
  public let gy: [Double]
  /// terrainMaterial.js GLOWS (terrain light-spill slots)
  public let terrainGlows: Int
  // landforms.js
  public let terrainStep: [String: Double]
  public let ice: Double
  public let iceR: Double
  public let islandLobes: [[Double]]
  public let islandFlats: [Footprint]
  public let islandCuts: [Footprint]
  public let islandBounds: Bounds2
  public let clear: [ClearZone]
  public let paths: [[[Double]]]
  public let boulderShare: [String: Double]
  public let boulderSeg: [String: [Int]]
  // lighthouse.js
  public let lighthouse: LighthouseTables
  // floaters.js
  public let shapes: [String: FloaterShape]
  public let buoyKinds: [String]
  public let buoyLight: [String: String]
  // rigging.js
  public let windsock: WindsockTables
  // vegetation.js
  public let vegCounts: [String: [String: Int]]
  public let prevail: V2
  // survivors/craft.js CONT.freeboard (the container awash test) and CONT_FADE (containerPaint)
  public let containerFreeboard: Double
  public let containerFade: [String: String]

  /// `world` = the payload of world.json, `survivors` = the payload of survivors.json.
  public init(world d: JSONValue, survivors sv: JSONValue) throws {
    let w = d["world"]
    var sv0 = [String: PadServiceSpec]()
    for (k, v) in w["SERVICES"].object?.entries ?? [] {
      sv0[k] = PadServiceSpec(fuel: try v["fuel"].requireDouble("SERVICES.\(k).fuel"), repair: try v["repair"].requireDouble("SERVICES.\(k).repair"),
                              resupply: v["resupply"].bool ?? false)
    }
    services = sv0
    var h = [String: Double]()
    for (k, v) in w["HEIGHT"].object?.entries ?? [] { h[k] = v.double }
    height = h
    let m = d["world/materials"]
    ch = try LampChannels(json: m["CH"], count: m["CH_COUNT"])
    glows = try m["GLOWS"].requireInt("world/materials.GLOWS")
    let t = d["world/terrain"]
    gx = try t["GX"].requireDoubles("world/terrain.GX")
    gy = try t["GY"].requireDoubles("world/terrain.GY")
    guard gx.count == 16, gy.count == 16 else { throw JSONError("world/terrain.GX/GY: expected 16 entries") }
    terrainGlows = try d["world/terrainMaterial"]["GLOWS"].requireInt("world/terrainMaterial.GLOWS")
    let l = d["world/landforms"]
    var ts = [String: Double]()
    for (k, v) in l["TERRAIN_STEP"].object?.entries ?? [] { ts[k] = v.double }
    terrainStep = ts
    ice = try l["ICE"].requireDouble("ICE")
    iceR = try l["ICE_R"].requireDouble("ICE_R")
    islandLobes = try l["ISLAND_LOBES"].requireArray("ISLAND_LOBES").map { try $0.requireDoubles("ISLAND_LOBES[]") }
    islandFlats = try l["ISLAND_FLATS"].requireArray("ISLAND_FLATS").map { try Footprint(json: $0) }
    islandCuts = try l["ISLAND_CUTS"].requireArray("ISLAND_CUTS").map { try Footprint(json: $0) }
    let b = l["ISLAND_BOUNDS"]
    islandBounds = Bounds2(x0: try b["x0"].requireDouble("x0"), z0: try b["z0"].requireDouble("z0"), x1: try b["x1"].requireDouble("x1"),
                           z1: try b["z1"].requireDouble("z1"))
    clear = try l["CLEAR"].requireArray("CLEAR").map { try ClearZone(json: $0) }
    paths = try l["PATHS"].requireArray("PATHS").map { try $0.requireArray("PATHS[]").map { try $0.requireDoubles("PATHS[][]") } }
    var bs = [String: Double]()
    for (k, v) in l["BOULDERS"].object?.entries ?? [] { bs[k] = v.double }
    boulderShare = bs
    var bg = [String: [Int]]()
    for (k, v) in l["BOULDER_SEG"].object?.entries ?? [] { bg[k] = (v.doubles ?? []).map { Int($0) } }
    boulderSeg = bg
    lighthouse = try LighthouseTables(json: d["world/lighthouse"])
    let f = d["world/floaters"]
    var sh = [String: FloaterShape]()
    for (k, v) in f["SHAPES"].object?.entries ?? [] {
      sh[k] = FloaterShape(k: v["k"].double ?? 1, y: v["y"].double ?? 0, R: v["R"].double ?? 0, tint: v["tint"].strings, leeway: v["leeway"].double,
                           craft: v["craft"].bool ?? false)
    }
    shapes = sh
    buoyKinds = try f["BUOY_KINDS"].requireArray("BUOY_KINDS").map { try $0.requireString("BUOY_KINDS[]") }
    var bl = [String: String]()
    for (k, v) in f["BUOY_LIGHT"].object?.entries ?? [] { bl[k] = v.string }
    buoyLight = bl
    windsock = try WindsockTables(json: d["world/rigging"])
    let v = d["world/vegetation"]
    var vc = [String: [String: Int]]()
    for (q, o) in v["VEG_COUNTS"].object?.entries ?? [] {
      var c = [String: Int]()
      for (k, n) in o.object?.entries ?? [] { c[k] = n.int }
      vc[q] = c
    }
    vegCounts = vc
    let pv = try v["PREVAIL"].requireDoubles("PREVAIL")
    prevail = V2(pv[0], pv[1])
    containerFreeboard = try sv["survivors/craft"]["CONT"]["freeboard"].requireDouble("survivors/craft.CONT.freeboard")
    var cf = [String: String]()
    for (k, v) in sv["survivors/craft"]["CONT_FADE"].object?.entries ?? [] { cf[k] = v.string }
    containerFade = cf
  }

  public init(catalog: DataCatalog) throws {
    try self.init(world: try catalog.data("world"), survivors: try catalog.data("survivors"))
  }

  /// SERVICES[type] || SERVICES.coast
  public func servicesFor(_ type: String) -> PadServiceSpec {
    services[type] ?? services["coast"] ?? PadServiceSpec(fuel: 10, repair: 4, resupply: true)
  }
}

/// An axis-aligned area {x0, z0, x1, z1} (metres).
public struct Bounds2: Equatable, Sendable {
  public var x0: Double
  public var z0: Double
  public var x1: Double
  public var z1: Double

  public init(x0: Double, z0: Double, x1: Double, z1: Double) {
    self.x0 = x0
    self.z0 = z0
    self.x1 = x1
    self.z1 = z1
  }
}

/// landforms.js CLEAR entries: circle {x, z, r}, box {box: [cx, cz, hx, hz]}, segment {seg, hw}.
public enum ClearZone: Equatable, Sendable {
  case circle(x: Double, z: Double, r: Double)
  case box(cx: Double, cz: Double, hx: Double, hz: Double)
  case seg(ax: Double, az: Double, bx: Double, bz: Double, hw: Double)

  init(json v: JSONValue) throws {
    if let s = v["seg"].array {
      let a = try s[0].requireDoubles("CLEAR.seg"), b = try s[1].requireDoubles("CLEAR.seg")
      self = .seg(ax: a[0], az: a[1], bx: b[0], bz: b[1], hw: try v["hw"].requireDouble("CLEAR.hw"))
    } else if let b = v["box"].doubles {
      self = .box(cx: b[0], cz: b[1], hx: b[2], hz: b[3])
    } else {
      self = .circle(x: try v["x"].requireDouble("CLEAR.x"), z: try v["z"].requireDouble("CLEAR.z"), r: try v["r"].requireDouble("CLEAR.r"))
    }
  }
}

/// lighthouse.js module constants.
public struct LighthouseTables: Equatable, Sendable {
  public var deckY: Double
  public var padR: Double
  public var tower: V2
  public var lanternY: Double
  public var beamLen: Double
  public var period: Double
  public var perimR: Double
  /// GLOW.{lamp, flood, window, nav} (THREE.Color linear)
  public var glowLamp: Color3
  public var glowFlood: Color3
  public var glowWindow: Color3
  public var glowNav: Color3

  init(json l: JSONValue) throws {
    deckY = try l["DECK_Y"].requireDouble("DECK_Y")
    padR = try l["PAD_R"].requireDouble("PAD_R")
    tower = V2(try l["TOWER"]["x"].requireDouble("TOWER.x"), try l["TOWER"]["z"].requireDouble("TOWER.z"))
    lanternY = try l["LANTERN_Y"].requireDouble("LANTERN_Y")
    beamLen = try l["BEAM_LEN"].requireDouble("BEAM_LEN")
    period = try l["PERIOD"].requireDouble("PERIOD")
    perimR = try l["PERIM_R"].requireDouble("PERIM_R")
    func lin(_ k: String) throws -> Color3 {
      let c = try l["GLOW"][k]["lin"].requireDoubles("GLOW.\(k).lin")
      return Color3(c[0], c[1], c[2])
    }
    glowLamp = try lin("lamp")
    glowFlood = try lin("flood")
    glowWindow = try lin("window")
    glowNav = try lin("nav")
  }
}

/// rigging.js Windsock constants.
public struct WindsockTables: Equatable, Sendable {
  public var orange: Color3
  public var white: Color3
  public var segs: Int
  public var sockLen: Double
  public var r0: Double

  init(json r: JSONValue) throws {
    let o = try r["ORANGE"]["lin"].requireDoubles("ORANGE.lin"), w = try r["WHITE"]["lin"].requireDoubles("WHITE.lin")
    orange = Color3(o[0], o[1], o[2])
    white = Color3(w[0], w[1], w[2])
    segs = try r["SEGS"].requireInt("SEGS")
    sockLen = try r["SOCK_LEN"].requireDouble("SOCK_LEN")
    r0 = try r["R0"].requireDouble("R0")
  }
}
