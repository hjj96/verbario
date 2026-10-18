// Typed view of Resources/Data/weather.json: the numbers of systems/weather.js and weather/{presets,
// gusts,lightning,lights,endless}.js (palette packing lives in PaletteTables). Everything WeatherSim and
// its helpers read comes from here — no hand-typed constants in the simulation (PLAN §1.1 goal 5).

/// LABELS[name]: `label` = card / briefing name, `short` = HUD / forecast word.
public struct WeatherLabel: Equatable, Sendable {
  public var label: String
  public var short: String
}

public struct WeatherTables {
  // ---- weather.js -------------------------------------------------------------------------------------
  /// Title-screen showcase cycle (every 45 s, DESIGN §7.2).
  public let attractCycle: [String]
  public let frontSpeed: Double // FRONT_SPEED, m/s
  public let frontWidth: Double // FRONT_WIDTH, m
  public let frontMinOver: Double // FRONT_MIN_OVER: shorter transitions are plain time blends

  // ---- weather/presets.js -----------------------------------------------------------------------------
  public let presetNames: [String]
  public let severity: [String: Double]
  public let labels: [String: WeatherLabel]
  /// Beaufort lower bounds for forces 1…12 (m/s) and Douglas sea-state lower bounds (Hs, m).
  public let beaufort: [Double]
  public let douglas: [Double]
  /// PRESETS[name].intensity / .wind / .gustStrength (the raw preset numbers weather.js reads directly).
  public let intensity: [String: Double]
  public let wind: [String: Double]
  public let gustStrength: [String: Double]
  /// FLASH_DAY / FLASH_NIGHT (THREE.Color, linear working space).
  public let flashDay: PaletteColor
  public let flashNight: PaletteColor
  /// Compiled preset palettes + channel / green tables (weather/palette.js).
  public let palette: PaletteTables

  // ---- weather/gusts.js -------------------------------------------------------------------------------
  public let gustMax: Int // MAX pooled fronts
  public let gustWidth: Double // WIDTH: sin² band, m
  public let gustLength: Double // LENGTH: gaussian taper, m
  public let gustFadeIn: Double // FADE_IN, s
  public let gustFadeOutDist: Double // FADE_OUT_DIST, m past the heli

  // ---- weather/lightning.js ---------------------------------------------------------------------------
  public let maxCharges: Int
  public let minGap: Double // s between full flashes
  public let minGapReduced: Double

  // ---- weather/lights.js ------------------------------------------------------------------------------
  public let lightsBox: Double // shadow box, m
  public let lightsDist: Double // light distance from its target
  public let swingHold: Double
  public let swingOut: Double
  public let mapSize: [String: Int]

  // ---- weather/endless.js -----------------------------------------------------------------------------
  public let clockRate: Double
  public let endlessDay: [String]
  public let endlessNight: [String]
  public let sunset: Double // time of day
  public let nightfall: Double

  /// `data` = the payload of weather.json.
  public init(json d: JSONValue) throws {
    let w = d["weather"]
    attractCycle = try WeatherTables.strings(w["ATTRACT_CYCLE"], "weather.ATTRACT_CYCLE")
    frontSpeed = try w["FRONT_SPEED"].requireDouble("weather.FRONT_SPEED")
    frontWidth = try w["FRONT_WIDTH"].requireDouble("weather.FRONT_WIDTH")
    frontMinOver = try w["FRONT_MIN_OVER"].requireDouble("weather.FRONT_MIN_OVER")

    let p = d["weather/presets"]
    presetNames = try WeatherTables.strings(p["PRESET_NAMES"], "weather/presets.PRESET_NAMES")
    var sev = [String: Double](), lab = [String: WeatherLabel](), inten = [String: Double]()
    var wnd = [String: Double](), gst = [String: Double]()
    for name in presetNames {
      sev[name] = try p["SEVERITY"][name].requireDouble("SEVERITY.\(name)")
      lab[name] = WeatherLabel(label: try p["LABELS"][name]["label"].requireString("LABELS.\(name).label"),
                               short: try p["LABELS"][name]["short"].requireString("LABELS.\(name).short"))
      let def = p["PRESETS"][name]
      inten[name] = try def["intensity"].requireDouble("PRESETS.\(name).intensity")
      wnd[name] = try def["wind"].requireDouble("PRESETS.\(name).wind")
      gst[name] = try def["gustStrength"].requireDouble("PRESETS.\(name).gustStrength")
    }
    severity = sev
    labels = lab
    intensity = inten
    wind = wnd
    gustStrength = gst
    beaufort = try p["BEAUFORT"].requireDoubles("weather/presets.BEAUFORT")
    douglas = try p["DOUGLAS"].requireDoubles("weather/presets.DOUGLAS")
    guard let fd = SRGB.color(try p["FLASH_DAY"].requireString("FLASH_DAY")),
          let fn = SRGB.color(try p["FLASH_NIGHT"].requireString("FLASH_NIGHT")) else {
      throw JSONError("weather/presets: FLASH_DAY / FLASH_NIGHT are not #rrggbb")
    }
    flashDay = fd
    flashNight = fn
    palette = try PaletteTables(presets: p)

    let g = d["weather/gusts"]
    gustMax = try g["MAX"].requireInt("weather/gusts.MAX")
    gustWidth = try g["WIDTH"].requireDouble("weather/gusts.WIDTH")
    gustLength = try g["LENGTH"].requireDouble("weather/gusts.LENGTH")
    gustFadeIn = try g["FADE_IN"].requireDouble("weather/gusts.FADE_IN")
    gustFadeOutDist = try g["FADE_OUT_DIST"].requireDouble("weather/gusts.FADE_OUT_DIST")

    let l = d["weather/lightning"]
    maxCharges = try l["MAX_CHARGES"].requireInt("weather/lightning.MAX_CHARGES")
    minGap = try l["MIN_GAP"].requireDouble("weather/lightning.MIN_GAP")
    minGapReduced = try l["MIN_GAP_REDUCED"].requireDouble("weather/lightning.MIN_GAP_REDUCED")

    let s = d["weather/lights"]
    lightsBox = try s["BOX"].requireDouble("weather/lights.BOX")
    lightsDist = try s["DIST"].requireDouble("weather/lights.DIST")
    swingHold = try s["SWING_HOLD"].requireDouble("weather/lights.SWING_HOLD")
    swingOut = try s["SWING_OUT"].requireDouble("weather/lights.SWING_OUT")
    var ms = [String: Int]()
    for (k, v) in s["MAP_SIZE"].object?.entries ?? [] { if let i = v.int { ms[k] = i } }
    mapSize = ms

    let e = d["weather/endless"]
    clockRate = try e["CLOCK_RATE"].requireDouble("weather/endless.CLOCK_RATE")
    endlessDay = try WeatherTables.strings(e["DAY"], "weather/endless.DAY")
    endlessNight = try WeatherTables.strings(e["NIGHT"], "weather/endless.NIGHT")
    sunset = try e["SUNSET"].requireDouble("weather/endless.SUNSET")
    nightfall = try e["NIGHTFALL"].requireDouble("weather/endless.NIGHTFALL")
  }

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("weather"))
  }

  /// PRESETS[name] is defined (the web's `PRESETS[name] ?` guards).
  @inline(__always) public func has(_ name: String) -> Bool { intensity[name] != nil }

  /// SEVERITY[name] (undefined → NaN, like a missing key in arithmetic / comparisons).
  @inline(__always) public func severityOf(_ name: String) -> Double { severity[name] ?? .nan }

  private static func strings(_ v: JSONValue, _ what: String) throws -> [String] {
    guard let s = v.strings else { throw JSONError("\(what): expected an array of strings") }
    return s
  }
}
