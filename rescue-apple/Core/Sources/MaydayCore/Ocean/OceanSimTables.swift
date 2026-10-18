// Typed view of Resources/Data/ocean.json for OceanSim and WaterMemoryQueue: the numbers of
// systems/ocean.js (MAX_SPLASHES, MAX_GLINTS, FLASH_DAY / FLASH_NIGHT, MEMORY_EXTENT, FALLBACK_SEA) and
// ocean/memory.js (MAX_STAMPS, HALF_LIFE, SHAPE), next to the wave / quality constants of OceanData.

/// FALLBACK_SEA (ocean.js): the sea the ocean derives from waveHeight & co. when the weather has no
/// palette (stub weather). `_fallbackSea()` overwrites Hs, Q, detail, whitecaps, streaks, roughness.
public struct FallbackSea: Equatable, Sendable {
  public var Hs: Double
  public var swellAdd: Double
  public var Q: Double
  public var detail: Double
  public var whitecaps: Double
  public var streaks: Double
  public var foamLines: Double
  public var roughness: Double
}

public struct OceanSimTables {
  public let ocean: OceanData
  public let maxSplashes: Int
  public let maxGlints: Int
  /// FLASH_DAY / FLASH_NIGHT (THREE.Color, linear: the exported `lin` values).
  public let flashDay: PaletteColor
  public let flashNight: PaletteColor
  public let fallbackSea: FallbackSea
  // ocean/memory.js
  public let maxStamps: Int
  public let halfLife: [Double]
  public let stampShape: [String: Double]

  public var memoryExtent: Double { ocean.memoryExtent }
  public var waves: WaveConstants { ocean.waves }

  /// `json` = the payload of ocean.json.
  public init(json d: JSONValue) throws {
    ocean = try OceanData(json: d)
    let o = d["ocean"]
    maxSplashes = try o["MAX_SPLASHES"].requireInt("ocean.MAX_SPLASHES")
    maxGlints = try o["MAX_GLINTS"].requireInt("ocean.MAX_GLINTS")
    func lin(_ key: String) throws -> PaletteColor {
      let l = try o[key]["lin"].requireDoubles("ocean.\(key).lin")
      guard l.count == 3 else { throw JSONError("ocean.\(key).lin: expected 3 numbers") }
      return PaletteColor(l[0], l[1], l[2])
    }
    flashDay = try lin("FLASH_DAY")
    flashNight = try lin("FLASH_NIGHT")
    let f = o["FALLBACK_SEA"]
    fallbackSea = FallbackSea(
      Hs: try f["Hs"].requireDouble("FALLBACK_SEA.Hs"), swellAdd: try f["swellAdd"].requireDouble("FALLBACK_SEA.swellAdd"),
      Q: try f["Q"].requireDouble("FALLBACK_SEA.Q"), detail: try f["detail"].requireDouble("FALLBACK_SEA.detail"),
      whitecaps: try f["whitecaps"].requireDouble("FALLBACK_SEA.whitecaps"), streaks: try f["streaks"].requireDouble("FALLBACK_SEA.streaks"),
      foamLines: try f["foamLines"].requireDouble("FALLBACK_SEA.foamLines"), roughness: try f["roughness"].requireDouble("FALLBACK_SEA.roughness"))
    let m = d["ocean/memory"]
    maxStamps = try m["MAX_STAMPS"].requireInt("ocean/memory.MAX_STAMPS")
    halfLife = try m["HALF_LIFE"].requireDoubles("ocean/memory.HALF_LIFE")
    guard halfLife.count == 4 else { throw JSONError("ocean/memory.HALF_LIFE: expected 4 channels") }
    var sh = [String: Double]()
    for (k, v) in m["SHAPE"].object?.entries ?? [] { if let x = v.double { sh[k] = x } }
    stampShape = sh
  }

  public init(catalog: DataCatalog) throws { try self.init(json: try catalog.data("ocean")) }
}
