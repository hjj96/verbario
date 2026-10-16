// Typed view of Resources/Data/look.json (core/look.js constants + texture table).
// `LookConstants.web` holds the same numbers compiled in (DataCatalogTests checks they agree).

public struct LookConstants: Equatable, Sendable {
  public var atlasSize: Int = 256 // ATLAS
  public var laceSize: Int = 512 // LACE
  public var detailSize: Int = 256 // DETAIL
  public var gustScale: Double = 0.006 // GUST_SCALE: 1 atlas tile ≈ 167 m
  public var gustDrift: Double = 0.9 // GUST_DRIFT: gust pattern moves at 0.9 × wind
  public var cloudScale: Double = 0.0025 // CLOUD_SCALE: 1 tile = 400 m
  public var cloudDrift: Double = 1.5 // CLOUD_DRIFT
  public var frontWidth: Double = 140 // setFronts default width
  public var frontLength: Double = 500 // setFronts default length
  public var lookSeed: Double = 7 // new Look(7)

  public init() {}

  public static let web = LookConstants()
}

public struct LookTextureInfo: Equatable, Sendable {
  public let name: String
  public let file: String // relative to the catalog root, e.g. "Resources/Textures/atlas.rgba"
  public let width: Int
  public let height: Int
  public let channels: Int
  public let sha256: String
}

public struct LookData {
  public let constants: LookConstants
  public let textures: [String: LookTextureInfo]

  /// `json` = the `data` payload of look.json.
  public init(json: JSONValue) throws {
    let L = json["core/look"]
    var c = LookConstants()
    c.atlasSize = try L["ATLAS"].requireInt("core/look.ATLAS")
    c.laceSize = try L["LACE"].requireInt("core/look.LACE")
    c.detailSize = try L["DETAIL"].requireInt("core/look.DETAIL")
    c.gustScale = try L["GUST_SCALE"].requireDouble("core/look.GUST_SCALE")
    c.gustDrift = try L["GUST_DRIFT"].requireDouble("core/look.GUST_DRIFT")
    c.cloudScale = try L["CLOUD_SCALE"].requireDouble("core/look.CLOUD_SCALE")
    c.cloudDrift = try L["CLOUD_DRIFT"].requireDouble("core/look.CLOUD_DRIFT")
    let derived = json["derived"]
    if let seed = derived["lookSeed"].double { c.lookSeed = seed }
    // uGustFrontsB defaults: [strength 0, width, length, 0]
    let fb = derived["uniformDefaults"]["uGustFrontsB"][0]
    if let w = fb[1].double { c.frontWidth = w }
    if let l = fb[2].double { c.frontLength = l }
    constants = c
    var tex = [String: LookTextureInfo]()
    if let t = derived["textures"].object {
      for (name, v) in t.entries {
        let file = try v["file"].requireString("textures.\(name).file")
        let width = try v["width"].requireInt("textures.\(name).width")
        tex[name] = LookTextureInfo(
          name: name,
          file: file,
          width: width,
          height: v["height"].int ?? width,
          channels: v["channels"].int ?? 4,
          sha256: (v["sha256"].string ?? "").lowercased()
        )
      }
    }
    textures = tex
  }

  public init(catalog: DataCatalog) throws { try self.init(json: try catalog.data("look")) }
}
