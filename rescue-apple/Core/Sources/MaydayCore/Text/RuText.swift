// Russian text & formatting helpers of the mission director (rescue/src/systems/mission/text.js; DESIGN
// §2.14 «Русская типографика», §5 templates): numbers via Intl ru-RU (RuFormat), U+00A0 between a number
// and its unit, «ёлочки», number words, collective numerals, compass words, the search-square grid,
// the crew's names for the weather presets, sea state / Beaufort, the card's conditions line, the
// logbook's wind line, survivor group words and pad names in the cases the task lines need.
// Tables: Resources/Data/text_ru.json (`mission/text`). Vectors: Tests/Vectors/text/ru_words.json
// (`mission`) and text/ru_format.json (the Intl-based helpers).

/// mission/text.js
public struct RuText: Sendable {
  public static let NBSP = "\u{00A0}"

  /// PRESETS[id] (DESIGN §2.3: wind, Hs, HUD visibility, severity).
  public struct Preset: Equatable, Sendable {
    public var title: String
    public var chapter: String
    public var wind: Double
    public var Hs: Double
    public var vis: String
    public var sev: Double
  }

  /// GROUP_WORDS[type]: nominative (radio), accusative (tasks), short (map marks).
  public struct GroupWords: Equatable, Sendable {
    public var nom: String
    public var acc: String
    public var short: String
  }

  /// The fields of a pad the task lines read (type, name).
  public struct PadNaming: Equatable, Sendable {
    public var type: String?
    public var name: String?
    public init(type: String?, name: String?) {
      self.type = type
      self.name = name
    }
  }

  public let UNITS: [String]
  public let TEENS: [String]
  public let TENS: [String]
  public let HUNDREDS: [String]
  public let COLLECTIVE: [String]
  public let UNITS_F: [String]
  public let C8: [String]
  public let FROM8: [String]
  public let TO8: [String]
  public let CLOCK_WORDS: [String]
  public let SQUARE_COLS: [String]
  public let SQUARE_ROWS: [String]
  public let DOUGLAS: [Double]
  public let BEAUFORT: [Double]
  /// PRESETS in data order
  public let presetIds: [String]
  public let presets: [String: Preset]
  public let groupWords: [String: GroupWords]

  /// `data["mission/text"]` of text_ru.json.
  public init(json t: JSONValue) throws {
    func list(_ k: String) throws -> [String] { try t[k].requireArray("text.\(k)").map { try $0.requireString("text.\(k)[]") } }
    UNITS = try list("UNITS")
    TEENS = try list("TEENS")
    TENS = try list("TENS")
    HUNDREDS = try list("HUNDREDS")
    COLLECTIVE = try list("COLLECTIVE")
    UNITS_F = try list("UNITS_F")
    C8 = try list("C8")
    FROM8 = try list("FROM8")
    TO8 = try list("TO8")
    CLOCK_WORDS = try list("CLOCK_WORDS")
    SQUARE_COLS = try list("SQUARE_COLS")
    SQUARE_ROWS = try list("SQUARE_ROWS")
    DOUGLAS = try t["DOUGLAS"].requireDoubles("text.DOUGLAS")
    BEAUFORT = try t["BEAUFORT"].requireDoubles("text.BEAUFORT")
    var ids = [String]()
    var ps = [String: Preset]()
    for (k, v) in try t["PRESETS"].requireObject("text.PRESETS").entries {
      ids.append(k)
      ps[k] = Preset(title: try v["title"].requireString("PRESETS.title"), chapter: try v["chapter"].requireString("PRESETS.chapter"),
                     wind: try v["wind"].requireDouble("PRESETS.wind"), Hs: try v["Hs"].requireDouble("PRESETS.Hs"),
                     vis: try v["vis"].requireString("PRESETS.vis"), sev: try v["sev"].requireDouble("PRESETS.sev"))
    }
    presetIds = ids
    presets = ps
    var gw = [String: GroupWords]()
    for (k, v) in try t["GROUP_WORDS"].requireObject("text.GROUP_WORDS").entries {
      gw[k] = GroupWords(nom: try v["nom"].requireString("GROUP_WORDS.nom"), acc: try v["acc"].requireString("GROUP_WORDS.acc"),
                         short: try v["short"].requireString("GROUP_WORDS.short"))
    }
    groupWords = gw
  }

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("text_ru")["mission/text"])
  }

  // ---- numbers (Intl ru-RU) ------------------------------------------------------------------------
  /// fmtNum(n, digits): NF0 / NF1 (up to one decimal).
  public static func fmtNum(_ n: Double, _ digits: Double = 0) -> String {
    JSNumber.isTruthy(digits) ? RuFormat.nf1o(n) : RuFormat.nf0(n)
  }

  public static func plural(_ n: Double, _ one: String, _ few: String, _ many: String) -> String { RuFormat.plural(n, one, few, many) }

  /// 754 → «12:34»; ≥ 1 h → «1:02:34». Negative is clamped to 0.
  public static func fmtTime(_ sec: Double) -> String { RuFormat.mmss(sec) }
  /// «6:00» style for par times (minutes without a leading zero).
  public static func fmtPar(_ sec: Double) -> String { RuFormat.mss(sec) }
  /// «85 %»
  public static func fmtPct(_ v01: Double) -> String { "\(RuFormat.nf0(JS.round(v01 * 100)))\(NBSP)%" }
  /// «740 м» / «1,4 км»
  public static func fmtKm(_ m: Double) -> String {
    m < 1000 ? "\(RuFormat.nf0(JS.round(m / 10) * 10))\(NBSP)м" : "\(RuFormat.nf1o(m / 1000))\(NBSP)км"
  }

  // ---- number words --------------------------------------------------------------------------------
  /// Number words (masculine), 0…9999 («четыреста пятьдесят»).
  public func numberWords(_ n: Double) -> String {
    RuWords.numberWords(n, units: UNITS, teens: TEENS, tens: TENS, hundreds: HUNDREDS)
  }

  /// «четыреста пятьдесят» — distance rounded to 50 m (DESIGN §5 {dist}).
  public func distWords(_ m: Double) -> String { numberWords(JS.max(50, JS.round(m / 50) * 50)) }

  /// Collective numerals for people: 2 → «двое», 5 → «пятеро»; > 10 → «12 человек».
  public func peopleCollective(_ n: Double) -> String {
    n >= 1 && n <= 10 ? RuFormat.at(COLLECTIVE, n) : "\(JSNumber.toString(n))\(RuText.NBSP)\(RuText.plural(n, "человек", "человека", "человек"))"
  }

  /// «три человека», «пять человек» (nominative).
  public func peopleWords(_ n: Double) -> String {
    let w = n < 5 ? RuFormat.at(UNITS_F, n) : numberWords(n)
    return "\(w) \(RuText.plural(n, "человек", "человека", "человек"))"
  }

  // ---- directions (0 = north (−Z), 90 = east (+X), clockwise) ---------------------------------------
  public static func bearingDeg(_ dx: Double, _ dz: Double) -> Double { RuFormat.bearingDeg(dx, dz) }
  public func compass8(_ deg: Double) -> String { RuFormat.at(C8, RuFormat.sector8(deg)) }
  public func fromWords(_ deg: Double) -> String { RuFormat.at(FROM8, RuFormat.sector8(deg)) }
  public func toWords(_ deg: Double) -> String { RuFormat.at(TO8, RuFormat.sector8(deg)) }
  /// Wind "from" bearing given the direction the wind blows TOWARDS (weather.state.windDir, x = X, y = Z).
  public static func windFromDeg(_ dirX: Double, _ dirZ: Double) -> Double { RuFormat.bearingDeg(-dirX, -dirZ) }

  /// {clock}: o'clock relative to the nose (DESIGN §5): round(relBearing / 30), 0 → 12.
  public static func clockOf(_ heading: Double, _ dx: Double, _ dz: Double) -> Double {
    let b = JS.atan2(dx, -dz)
    var rel = b - JSNumber.or(heading, 0)
    rel = (rel.truncatingRemainder(dividingBy: JS.PI * 2) + JS.PI * 2).truncatingRemainder(dividingBy: JS.PI * 2)
    let c = JS.round(rel / (JS.PI / 6)).truncatingRemainder(dividingBy: 12)
    return c == 0 ? 12 : c
  }

  /// CLOCK_WORDS[c] || 'двенадцать часов'
  public func clockWords(_ c: Double) -> String {
    let w = RuFormat.at(CLOCK_WORDS, c)
    return w == "undefined" || w.isEmpty ? "двенадцать часов" : w
  }

  /// Search squares: 500 m grid, columns by phonetic names, rows by number words («Анна-три»).
  public func squareOf(_ x: Double, _ z: Double) -> String { RuWords.squareOf(x, z, cols: SQUARE_COLS, rows: SQUARE_ROWS) }

  // ---- weather words -------------------------------------------------------------------------------
  /// PRESETS[id] || PRESETS.calm
  public func preset(_ id: String?) -> Preset {
    if let id, let p = presets[id] { return p }
    return presets["calm"] ?? Preset(title: "", chapter: "", wind: 0, Hs: 0, vis: "", sev: 0)
  }

  /// Douglas sea state of Hs (1…9).
  public func seaState(_ Hs: Double) -> Double {
    var s = 0.0
    for b in DOUGLAS where Hs > b { s += 1 }
    return JS.min(9, s + 1)
  }

  /// Beaufort number of a wind speed (m/s).
  public func beaufort(_ ms: Double) -> Double {
    var b = 0.0
    for v in BEAUFORT where ms >= v { b += 1 }
    return b
  }

  /// «ветер СЗ 9 м/с, волнение 4, видимость 8 км» (DESIGN §3.14 operation card).
  public func conditionsLine(_ presetId: String?, _ windFromDegrees: Double) -> String {
    let p = preset(presetId)
    return "ветер \(compass8(windFromDegrees)) \(JSNumber.toString(p.wind))\(RuText.NBSP)м/с, волнение \(JSNumber.toString(seaState(p.Hs))), видимость \(p.vis)"
  }

  /// «ветер СЗ 18 м/с, 8 баллов» for the logbook (live numbers).
  public func windLine(_ speed: Double, _ fromDeg: Double) -> String {
    let b = beaufort(speed)
    return "ветер \(compass8(fromDeg)) \(RuFormat.nf0(JS.round(speed)))\(RuText.NBSP)м/с, \(JSNumber.toString(b))\(RuText.NBSP)\(RuText.plural(b, "балл", "балла", "баллов"))"
  }

  /// «15:20» → 0…1 day fraction (/^(\d{1,2}):(\d{2})$/, else 0.4).
  public static func clockToDay(_ clock: String?) -> Double {
    let u = Array((clock ?? "").unicodeScalars)
    func digit(_ c: Unicode.Scalar) -> Double? { c.value >= 0x30 && c.value <= 0x39 ? Double(c.value - 0x30) : nil }
    guard let colon = u.firstIndex(of: ":"), colon >= 1, colon <= 2, u.count == colon + 3 else { return 0.4 }
    var h = 0.0
    for c in u[0..<colon] {
      guard let d = digit(c) else { return 0.4 }
      h = h * 10 + d
    }
    guard let m1 = digit(u[colon + 1]), let m2 = digit(u[colon + 2]) else { return 0.4 }
    return (h * 60 + (m1 * 10 + m2)) / 1440
  }

  // ---- survivors and pads ---------------------------------------------------------------------------
  /// GROUP_WORDS[type] || GROUP_WORDS.swimmer
  public func groupWordsFor(_ type: String?) -> GroupWords {
    if let type, let g = groupWords[type] { return g }
    return groupWords["swimmer"] ?? GroupWords(nom: "", acc: "", short: "")
  }

  /// `name.replace(/[«»"]/g, '')`
  static func stripQuotes(_ s: String) -> String {
    var out = ""
    for c in s.unicodeScalars where c != "«" && c != "»" && c != "\"" { out.unicodeScalars.append(c) }
    return out
  }

  /// Pad names in the genitive for «к северу от маяка».
  public static func padGenitive(_ pad: PadNaming?) -> String {
    guard let pad else { return "базы" }
    let t = pad.type
    if t == "lighthouse" { return "маяка" }
    if t == "rig" { return "буровой" }
    let raw = pad.name.flatMap { $0.isEmpty ? nil : $0 } ?? (t == "ship" ? "Арктур" : "")
    let n = stripQuotes(raw)
    if n == "Арктур" { return "«Арктура»" }
    return n.isEmpty ? "площадки" : "«\(n)»"
  }

  /// «маяк «Скалистый»», «буровую «Северная-7»», «"Арктур"», «площадку» (accusative after «на»).
  public static func padName(_ pad: PadNaming?) -> String {
    guard let pad else { return "площадку" }
    let n = stripQuotes(pad.name ?? "")
    if pad.type == "lighthouse" { return "маяк «\(n.isEmpty ? "Скалистый" : n)»" }
    if pad.type == "rig" { return "буровую «\(n.isEmpty ? "Северная-7" : n)»" }
    if pad.type == "ship" { return "«\(n.isEmpty ? "Арктур" : n)»" }
    return n.isEmpty ? "площадку" : "«\(n)»"
  }
}
