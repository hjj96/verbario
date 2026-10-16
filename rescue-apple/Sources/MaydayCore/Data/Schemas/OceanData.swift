// Typed view of Resources/Data/ocean.json (systems/ocean.js + ocean/*.js constants).
// `WaveConstants.web` holds the same numbers compiled in (DataCatalogTests checks they agree).

public struct OceanQuality: Equatable, Sendable {
  public var grid: Int
  public var waves: Int
  public var q: Int
  public var memory: Int
  public var glints: Int

  public init(grid: Int, waves: Int, q: Int, memory: Int, glints: Int) {
    self.grid = grid
    self.waves = waves
    self.q = q
    self.memory = memory
    self.glints = glints
  }
}

/// ocean/waves.js module constants.
public struct WaveConstants: Equatable, Sendable {
  public var gridExtent: Double = 380 // GRID_EXTENT
  public var gridPow: Double = 1.6 // GRID_POW
  public var skirtRows: [Double] = [1200, 3000] // SKIRT_ROWS
  public var edgeFade: [Double] = [380, 1200] // EDGE_FADE
  public var waveL: [Double] = [120, 78, 52, 34, 22, 14.5, 9.5, 6.2] // WAVE_L
  public var waveDirDeg: [Double] = [0, 18, -27, 41, -55, 66, -12, 33] // WAVE_DIR_DEG
  public var maxWaves: Int = 8 // MAX_WAVES
  public var grav: Double = 9.81 // GRAV
  public var fd: Double = 0.5 // FD (finite-difference step for feature gradients)
  public var quality: [String: OceanQuality] = [
    "high": OceanQuality(grid: 300, waves: 8, q: 2, memory: 512, glints: 8),
    "medium": OceanQuality(grid: 224, waves: 6, q: 1, memory: 384, glints: 4),
    "low": OceanQuality(grid: 160, waves: 4, q: 0, memory: 0, glints: 0),
  ]

  public init() {}

  public static let web = WaveConstants()
}

/// The sea part of a weather palette that the wave bank reads (palette.sea / FALLBACK_SEA).
/// Optional fields mirror JS `undefined` (the bank applies `|| 0`, `?? 0.3`, … itself).
public struct SeaState: Equatable, Sendable {
  public var Hs: Double
  public var swellAdd: Double?
  public var Q: Double?
  public var clearing: Double?

  public init(Hs: Double, swellAdd: Double? = nil, Q: Double? = nil, clearing: Double? = nil) {
    self.Hs = Hs
    self.swellAdd = swellAdd
    self.Q = Q
    self.clearing = clearing
  }

  /// From a JSON object {Hs, swellAdd?, Q?, clearing?}; missing Hs reads as NaN (JS `undefined` in arithmetic).
  public init(json: JSONValue) {
    Hs = json["Hs"].double ?? .nan
    swellAdd = json["swellAdd"].double
    Q = json["Q"].double
    clearing = json["clearing"].double
  }
}

public struct OceanData {
  public let waves: WaveConstants
  public let coastMax: Double // ocean/coast COAST_MAX
  public let featureType: [String: Int] // ocean/features FEATURE_TYPE
  public let maxFeatures: Int
  public let rogueScarLife: Double
  public let featureFadeOut: Double
  public let fallbackSea: SeaState // ocean FALLBACK_SEA
  public let memoryExtent: Double // ocean MEMORY_EXTENT

  /// `json` = the `data` payload of ocean.json.
  public init(json: JSONValue) throws {
    let w = json["ocean/waves"]
    var c = WaveConstants()
    c.gridExtent = try w["GRID_EXTENT"].requireDouble("ocean/waves.GRID_EXTENT")
    c.gridPow = try w["GRID_POW"].requireDouble("ocean/waves.GRID_POW")
    c.skirtRows = try w["SKIRT_ROWS"].requireDoubles("ocean/waves.SKIRT_ROWS")
    c.edgeFade = try w["EDGE_FADE"].requireDoubles("ocean/waves.EDGE_FADE")
    c.waveL = try w["WAVE_L"].requireDoubles("ocean/waves.WAVE_L")
    c.waveDirDeg = try w["WAVE_DIR_DEG"].requireDoubles("ocean/waves.WAVE_DIR_DEG")
    c.maxWaves = try w["MAX_WAVES"].requireInt("ocean/waves.MAX_WAVES")
    c.grav = try w["GRAV"].requireDouble("ocean/waves.GRAV")
    c.fd = try w["FD"].requireDouble("ocean/waves.FD")
    if c.waveL.count != c.maxWaves || c.waveDirDeg.count != c.maxWaves {
      throw JSONError("ocean/waves: WAVE_L/WAVE_DIR_DEG must have MAX_WAVES entries")
    }
    if c.skirtRows.count != 2 || c.edgeFade.count != 2 {
      throw JSONError("ocean/waves: SKIRT_ROWS/EDGE_FADE must have 2 entries")
    }
    var q = [String: OceanQuality]()
    if let qo = w["QUALITY"].object {
      for (name, v) in qo.entries {
        let grid = try v["grid"].requireInt("QUALITY.\(name).grid")
        let count = try v["waves"].requireInt("QUALITY.\(name).waves")
        q[name] = OceanQuality(
          grid: grid,
          waves: count,
          q: v["q"].int ?? 0,
          memory: v["memory"].int ?? 0,
          glints: v["glints"].int ?? 0
        )
      }
    }
    c.quality = q
    waves = c
    coastMax = json["ocean/coast"]["COAST_MAX"].double ?? 48
    let f = json["ocean/features"]
    var ft = [String: Int]()
    if let o = f["FEATURE_TYPE"].object {
      for (k, v) in o.entries { if let i = v.int { ft[k] = i } }
    }
    featureType = ft
    maxFeatures = f["MAX_FEATURES"].int ?? 4
    rogueScarLife = f["ROGUE_SCAR_LIFE"].double ?? 40
    featureFadeOut = f["FADE_OUT"].double ?? 1.6
    let o = json["ocean"]
    fallbackSea = SeaState(json: o["FALLBACK_SEA"])
    memoryExtent = o["MEMORY_EXTENT"].double ?? 320
  }

  public init(catalog: DataCatalog) throws { try self.init(json: try catalog.data("ocean")) }
}
