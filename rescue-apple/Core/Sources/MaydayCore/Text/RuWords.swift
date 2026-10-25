// Russian words for the radio templates (rescue/src/systems/radio/words.js; DESIGN §5): {square}, {clock},
// {dist}, {dir}, {heading}, {count}, {gust}, {side}, {wind}, {pitch}, {n}. Pure functions over the tables
// of Resources/Data/text_ru.json (`radio/words`).
//
// The square grid is the same 500 m grid the mission director uses (phonetic columns × number rows,
// «Анна-три»), so a square named on the radio matches the HUD and the briefing. The radio's collective
// numerals start with «никого» (mission/text.js has '' there) and its people count says «один / два» —
// both variants are kept, each in its own type (RuWords, RuText). Numbers follow the JS expressions
// operator for operator (Math.round, `%`, NaN propagation), so odd inputs give the web's odd strings.
// Vectors: Tests/Vectors/text/ru_words.json (`radio`).

/// radio/words.js
public struct RuWords: Sendable {
  public static let NBSP = "\u{00A0}"

  public let UNITS: [String]
  public let TEENS: [String]
  public let TENS: [String]
  public let HUNDREDS: [String]
  public let G_UNITS: [String]
  public let G_TEENS: [String]
  public let G_TENS: [String]
  public let G_HUNDREDS: [String]
  public let COLLECTIVE: [String]
  public let FROM8: [String]
  public let TO8: [String]
  public let CLOCK: [String]
  public let DIGIT: [String]
  public let SQUARE_COLS: [String]
  public let SQUARE_ROWS: [String]
  public let COUNT: [String]

  /// `data["radio/words"]` of text_ru.json.
  public init(json t: JSONValue) throws {
    func list(_ k: String) throws -> [String] { try t[k].requireArray("words.\(k)").map { try $0.requireString("words.\(k)[]") } }
    UNITS = try list("UNITS")
    TEENS = try list("TEENS")
    TENS = try list("TENS")
    HUNDREDS = try list("HUNDREDS")
    G_UNITS = try list("G_UNITS")
    G_TEENS = try list("G_TEENS")
    G_TENS = try list("G_TENS")
    G_HUNDREDS = try list("G_HUNDREDS")
    COLLECTIVE = try list("COLLECTIVE")
    FROM8 = try list("FROM8")
    TO8 = try list("TO8")
    CLOCK = try list("CLOCK")
    DIGIT = try list("DIGIT")
    SQUARE_COLS = try list("SQUARE_COLS")
    SQUARE_ROWS = try list("SQUARE_ROWS")
    COUNT = try list("COUNT")
  }

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("text_ru")["radio/words"])
  }

  /// Russian plural: plural(5, 'метр', 'метра', 'метров').
  public static func plural(_ n: Double, _ one: String, _ few: String, _ many: String) -> String { RuFormat.plural(n, one, few, many) }

  @inline(__always) static func at(_ arr: [String], _ i: Double) -> String { RuFormat.at(arr, i) }

  // ---- numbers ---------------------------------------------------------------------------------------
  /// Number words, masculine nominative, 0…9999 («четыреста пятьдесят»).
  public func numberWords(_ value: Double) -> String {
    RuWords.numberWords(value, units: UNITS, teens: TEENS, tens: TENS, hundreds: HUNDREDS)
  }

  /// The shared numberWords algorithm of radio/words.js and mission/text.js (identical tables).
  static func numberWords(_ value: Double, units: [String], teens: [String], tens: [String], hundreds: [String]) -> String {
    let n = JS.max(0, JS.min(9999, JS.round(value)))
    if n == 0 { return at(units, 0) }
    var out = [String]()
    let th = JS.floor(n / 1000)
    if JSNumber.isTruthy(th) {
      out.append(th == 1 ? "тысяча" : th == 2 ? "две тысячи" : "\(at(units, th)) \(plural(th, "тысяча", "тысячи", "тысяч"))")
    }
    let r = n.truncatingRemainder(dividingBy: 1000)
    if r >= 100 { out.append(at(hundreds, JS.floor(r / 100))) }
    let t = r.truncatingRemainder(dividingBy: 100)
    if t >= 10 && t < 20 {
      out.append(at(teens, t - 10))
    } else {
      if t >= 20 { out.append(at(tens, JS.floor(t / 10))) }
      let u = t.truncatingRemainder(dividingBy: 10)
      if JSNumber.isTruthy(u) { out.append(at(units, u)) }
    }
    return out.joined(separator: " ")
  }

  /// Genitive («до двадцати пяти метров»), 0…999.
  public func numberGenitive(_ value: Double) -> String {
    let n = JS.max(0, JS.min(999, JS.round(value)))
    if n == 0 { return RuWords.at(G_UNITS, 0) }
    var out = [String]()
    if n >= 100 { out.append(RuWords.at(G_HUNDREDS, JS.floor(n / 100))) }
    let t = n.truncatingRemainder(dividingBy: 100)
    if t >= 10 && t < 20 {
      out.append(RuWords.at(G_TEENS, t - 10))
    } else {
      if t >= 20 { out.append(RuWords.at(G_TENS, JS.floor(t / 10))) }
      let u = t.truncatingRemainder(dividingBy: 10)
      if JSNumber.isTruthy(u) { out.append(RuWords.at(G_UNITS, u)) }
    }
    return out.joined(separator: " ")
  }

  /// {dist}: rounded to 50 m, in words («четыреста пятьдесят»).
  public func distWords(_ m: Double) -> String { numberWords(JS.max(50, JS.round(JSNumber.or(m, 0) / 50) * 50)) }

  /// {count}: collective numeral for people (2 → «двое», 5 → «пятеро»).
  public func countWords(_ value: Double) -> String {
    let n = JS.max(0, JS.round(JSNumber.or(value, 0)))
    return n <= 10 ? RuWords.at(COLLECTIVE, n) : "\(numberWords(n)) \(RuWords.plural(n, "человек", "человека", "человек"))"
  }

  /// «один человек», «три человека», «пять человек»
  public func peopleWords(_ value: Double) -> String {
    let n = JS.max(1, JS.round(JSNumber.or(value, 1)))
    let w = n == 1 ? "один" : n == 2 ? "два" : numberWords(n)
    return "\(w) \(RuWords.plural(n, "человек", "человека", "человек"))"
  }

  /// «восемь метров», «один метр»
  public func metresWords(_ n: Double) -> String { "\(numberWords(n)) \(RuWords.plural(n, "метр", "метра", "метров"))" }
  /// «четыре градуса»
  public func degreesWords(_ n: Double) -> String { "\(numberWords(n)) \(RuWords.plural(n, "градус", "градуса", "градусов"))" }
  /// «двадцати пяти метров» — genitive after «до».
  public func metresGenitive(_ n: Double) -> String {
    let r = JS.round(n)
    return "\(numberGenitive(n)) \(r.truncatingRemainder(dividingBy: 10) == 1 && r.truncatingRemainder(dividingBy: 100) != 11 ? "метра" : "метров")"
  }

  // ---- bearings ----------------------------------------------------------------------------------------
  public static func bearingDeg(_ dx: Double, _ dz: Double) -> Double { RuFormat.bearingDeg(dx, dz) }
  public func fromWords(_ deg: Double) -> String { RuWords.at(FROM8, RuFormat.sector8(deg)) }
  public func toWords(_ deg: Double) -> String { RuWords.at(TO8, RuFormat.sector8(deg)) }

  /// {clock}: o'clock relative to the nose, round(relBearing / 30), 0 → 12 («на два часа»).
  public func clockWords(_ heading: Double, _ dx: Double, _ dz: Double) -> String {
    var rel = JS.atan2(dx, -dz) - JSNumber.or(heading, 0)
    rel = (rel.truncatingRemainder(dividingBy: JS.PI * 2) + JS.PI * 2).truncatingRemainder(dividingBy: JS.PI * 2)
    return RuWords.at(CLOCK, JS.round(rel / (JS.PI / 6)).truncatingRemainder(dividingBy: 12))
  }

  /// {side}: «слева» / «справа» / «прямо по курсу» / «сзади», relative to the nose.
  public static func sideWords(_ heading: Double, _ dx: Double, _ dz: Double) -> String {
    var rel = JS.atan2(dx, -dz) - JSNumber.or(heading, 0)
    rel = JS.atan2(JS.sin(rel), JS.cos(rel))
    let a = JS.abs(rel)
    if a < 0.45 { return "прямо по курсу" }
    if a > 2.6 { return "сзади" }
    return rel > 0 ? "справа" : "слева"
  }

  /// {heading}: digit by digit, «два-семь-ноль».
  public func headingWords(_ deg: Double) -> String {
    let v = JS.round((deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)).truncatingRemainder(dividingBy: 360)
    var s = JSNumber.toString(v)
    let len = s.utf16.count
    if len < 3 { s = String(repeating: "0", count: 3 - len) + s }
    // [...d].map((c) => DIGIT[c.charCodeAt(0) - 48]).join('-'): undefined joins as ''
    return s.unicodeScalars.map { c -> String in
      let i = Int(c.value) - 48
      return i >= 0 && i < DIGIT.count ? DIGIT[i] : ""
    }.joined(separator: "-")
  }

  /// {square}: 500 m grid, phonetic columns, number-word rows («Анна-три»).
  public func squareOf(_ x: Double, _ z: Double) -> String {
    RuWords.squareOf(x, z, cols: SQUARE_COLS, rows: SQUARE_ROWS)
  }

  static func squareOf(_ x: Double, _ z: Double, cols: [String], rows: [String]) -> String {
    let c = JS.max(0, JS.min(Double(cols.count - 1), JS.floor((x + 3000) / 500)))
    let r = JS.max(0, JS.min(Double(rows.count - 1), JS.floor((z + 3000) / 500)))
    return "\(at(cols, c))-\(at(rows, r))"
  }

  /// «Вспышка — гром»: the crew counts seconds («Раз… два… три»).
  public func countSeconds(_ value: Double) -> String {
    let n = JS.max(1, JS.min(Double(COUNT.count), JS.round(value)))
    guard n.isFinite else { return "" } // slice(0, NaN) is empty
    return COUNT.prefix(Int(n)).joined(separator: "… ")
  }

  /// «полкилометра», «километр», «полтора километра», «два с половиной километра», «три километра»
  public func kmWords(_ m: Double) -> String {
    let h = JS.round(m / 500) / 2
    if h <= 0.5 { return "полкилометра" }
    if h == 1 { return "километр" }
    if h == 1.5 { return "полтора километра" }
    if JSNumber.isTruthy(h.truncatingRemainder(dividingBy: 1)) {
      let f = JS.floor(h)
      return "\(numberWords(f)) с половиной \(RuWords.plural(f, "километр", "километра", "километров"))"
    }
    return "\(numberWords(h)) \(RuWords.plural(h, "километр", "километра", "километров"))"
  }

  /// Fill «{key}» placeholders from vars; unknown keys stay readable («…»). `\w` = [A-Za-z0-9_].
  public static func fill(_ template: String, _ vars: [String: String]) -> String {
    var out = ""
    let u = Array(template.unicodeScalars)
    var i = 0
    while i < u.count {
      if u[i] == "{" {
        var j = i + 1
        while j < u.count, isWordChar(u[j]) { j += 1 }
        if j > i + 1, j < u.count, u[j] == "}" {
          var key = ""
          key.unicodeScalars.append(contentsOf: u[(i + 1)..<j])
          out += vars[key] ?? "…"
          i = j + 1
          continue
        }
      }
      out.unicodeScalars.append(u[i])
      i += 1
    }
    return out
  }

  @inline(__always) static func isWordChar(_ c: Unicode.Scalar) -> Bool {
    switch c.value {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x5F: return true
    default: return false
    }
  }
}
