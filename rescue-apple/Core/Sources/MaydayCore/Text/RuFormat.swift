// Russian number and time formatting for the HUD, menus and the mission director (rescue/src/ui/common/fmt.js,
// the Intl parts of rescue/src/systems/mission/text.js; DESIGN §2.14 «Русская типографика»): decimal comma,
// U+00A0 between a number and its unit and as the thousands separator, «ёлочки».
//
// Intl.NumberFormat('ru-RU') is done by hand (PLAN §2.9 `RuFormat`): ICU formats a double from its shortest
// round-trip decimal digits (the digits of String(x)), rounds them half away from zero ('halfExpand') at the
// last allowed fraction digit, groups the integer part by three with NBSP from 1 000 up (ru: minimum
// grouping digits 1), writes '-' for every negative value including −0 and values that round to zero
// («-0», «-0,0»), «не число» (with NBSP) for NaN and «∞» for ±Infinity. Checked byte-exactly against Intl in Node 22
// (ICU 77, the same ICU as Chromium 141): Tests/Vectors/text/ru_format.json (tools/export/export-mission.mjs).
//
// Every table comes from Resources/Data/text_ru.json (`ui/common/fmt`). The per-frame string caches of
// fmt.js (distU / distL / deg3) are a JS allocation optimisation and are not ported; the one thing they
// change is the label of a "−0 m" key (a distance in (−5, 0)): the Map treats −0 and 0 as one key, so the
// web shows the «0 М» it cached for a real zero first — distU / distL format that key as +0.

/// ui/common/fmt.js: number / time / distance / bearing formatting.
public struct RuFormat: Sendable {
  public static let NBSP = "\u{00A0}"
  public static let THIN = "\u{202F}"

  public let C8: [String]
  public let FROM8: [String]
  public let TO8: [String]
  public let BEAUFORT: [Double]
  public let DOUGLAS: [Double]
  /// PRESET_SHORT / PRESET_LABEL / PRESET_SEVERITY by weather preset id
  public let presetShort: [String: String]
  public let presetLabel: [String: String]
  public let presetSeverity: [String: Double]
  /// GROUP[type]: {flir, toast, short}
  public let group: [String: GroupLabels]

  /// GROUP[type] of fmt.js (marker, toast and short labels of a survivor group type).
  public struct GroupLabels: Equatable, Sendable {
    public var flir: String
    public var toast: String
    public var short: String
  }

  /// `data["ui/common/fmt"]` of text_ru.json.
  public init(json t: JSONValue) throws {
    C8 = try t["C8"].requireArray("fmt.C8").map { try $0.requireString("fmt.C8[]") }
    FROM8 = try t["FROM8"].requireArray("fmt.FROM8").map { try $0.requireString("fmt.FROM8[]") }
    TO8 = try t["TO8"].requireArray("fmt.TO8").map { try $0.requireString("fmt.TO8[]") }
    BEAUFORT = try t["BEAUFORT"].requireDoubles("fmt.BEAUFORT")
    DOUGLAS = try t["DOUGLAS"].requireDoubles("fmt.DOUGLAS")
    presetShort = try RuFormat.stringMap(t["PRESET_SHORT"], "fmt.PRESET_SHORT")
    presetLabel = try RuFormat.stringMap(t["PRESET_LABEL"], "fmt.PRESET_LABEL")
    var sev = [String: Double]()
    for (k, v) in try t["PRESET_SEVERITY"].requireObject("fmt.PRESET_SEVERITY").entries { sev[k] = try v.requireDouble("PRESET_SEVERITY.\(k)") }
    presetSeverity = sev
    var g = [String: GroupLabels]()
    for (k, v) in try t["GROUP"].requireObject("fmt.GROUP").entries {
      g[k] = GroupLabels(flir: try v["flir"].requireString("GROUP.flir"), toast: try v["toast"].requireString("GROUP.toast"),
                         short: try v["short"].requireString("GROUP.short"))
    }
    group = g
  }

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("text_ru")["ui/common/fmt"])
  }

  static func stringMap(_ v: JSONValue, _ what: String) throws -> [String: String] {
    var out = [String: String]()
    for (k, x) in try v.requireObject(what).entries { out[k] = try x.requireString("\(what).\(k)") }
    return out
  }

  // ==============================================================================================
  // Intl.NumberFormat('ru-RU')

  /// `new Intl.NumberFormat('ru-RU', { minimumFractionDigits, maximumFractionDigits }).format(x)`.
  public static func intl(_ x: Double, minFraction: Int = 0, maxFraction: Int) -> String {
    if x.isNaN { return "не\u{00A0}число" }
    let negative = x.sign == .minus
    if x.isInfinite { return negative ? "-∞" : "∞" }
    let maxF = Swift.max(0, maxFraction)
    let minF = Swift.min(Swift.max(0, minFraction), maxF)
    // R = |x| · 10^maxF rounded half away from zero, as decimal digits (most significant first)
    var r: [UInt8]
    if x == 0 {
      r = [0]
    } else {
      let (s, n) = JSNumber.shortestDigits(x.magnitude) // |x| = 0.d1…dk × 10^n
      let d = s.utf8.map { $0 &- 48 }
      let point = n + maxF // digits before the point of |x|·10^maxF
      if point >= d.count {
        r = d + [UInt8](repeating: 0, count: point - d.count)
      } else if point < 0 {
        r = [0]
      } else if point == 0 {
        r = [d[0] >= 5 ? 1 : 0]
      } else {
        r = Array(d[0..<point])
        if d[point] >= 5 {
          var i = r.count - 1
          while i >= 0 {
            if r[i] == 9 {
              r[i] = 0
              i -= 1
            } else {
              r[i] += 1
              break
            }
          }
          if i < 0 { r.insert(1, at: 0) }
        }
      }
    }
    // split into integer and fraction digits
    if r.count <= maxF { r = [UInt8](repeating: 0, count: maxF + 1 - r.count) + r }
    let intDigits = r[0..<(r.count - maxF)]
    var frac = Array(r[(r.count - maxF)...])
    while frac.count > minF && frac.last == 0 { frac.removeLast() }
    var out = negative ? "-" : ""
    let ni = intDigits.count
    for (i, dgt) in intDigits.enumerated() {
      if i > 0 && (ni - i) % 3 == 0 { out += NBSP }
      out.unicodeScalars.append(Unicode.Scalar(dgt + 48))
    }
    if !frac.isEmpty {
      out += ","
      for dgt in frac { out.unicodeScalars.append(Unicode.Scalar(dgt + 48)) }
    }
    return out
  }

  /// NF0.format(x): no fraction digits.
  @inline(__always) public static func nf0(_ x: Double) -> String { intl(x, maxFraction: 0) }
  /// NF1o / mission text NF1: up to one fraction digit («4», «4,5»).
  @inline(__always) public static func nf1o(_ x: Double) -> String { intl(x, maxFraction: 1) }
  /// fmt.js NF1: always one fraction digit («4,0»).
  @inline(__always) public static func nf1(_ x: Double) -> String { intl(x, minFraction: 1, maxFraction: 1) }

  // ---- fmt.js number helpers ---------------------------------------------------------------------
  /// num0(n) = NF0.format(Math.round(n || 0))
  public static func num0(_ n: Double) -> String { nf0(JS.round(JSNumber.or(n, 0))) }
  /// num1(n) = NF1.format(n || 0) — always one decimal
  public static func num1(_ n: Double) -> String { nf1(JSNumber.or(n, 0)) }
  /// num1o(n) = NF1o.format(n || 0) — optional decimal
  public static func num1o(_ n: Double) -> String { nf1o(JSNumber.or(n, 0)) }

  /// Russian plural: plural(5, 'человек', 'человека', 'человек').
  public static func plural(_ n: Double, _ one: String, _ few: String, _ many: String) -> String {
    let a = JS.abs(JS.round(n)).truncatingRemainder(dividingBy: 100)
    let b = a.truncatingRemainder(dividingBy: 10)
    if a > 10 && a < 20 { return many }
    if b == 1 { return one }
    if b >= 2 && b <= 4 { return few }
    return many
  }

  /// String(n).padStart(width, '0')
  static func pad(_ n: Double, _ width: Int) -> String {
    let s = JSNumber.toString(n)
    let len = s.utf16.count
    return len >= width ? s : String(repeating: "0", count: width - len) + s
  }

  // ==============================================================================================
  // Time

  /// mmss(sec): «12:34»; ≥ 1 h «1:02:34»; negative → 0 (same as mission/text.js fmtTime).
  public static func mmss(_ sec: Double) -> String {
    let s = JS.max(0, JS.floor(JSNumber.or(sec, 0)))
    let h = JS.floor(s / 3600)
    let m = JS.floor(s.truncatingRemainder(dividingBy: 3600) / 60)
    let ss = pad(s.truncatingRemainder(dividingBy: 60), 2)
    return JSNumber.isTruthy(h) ? "\(JSNumber.toString(h)):\(pad(m, 2)):\(ss)" : "\(pad(m, 2)):\(ss)"
  }

  /// mss(sec): «6:20» — minutes without a leading zero (same as mission/text.js fmtPar).
  public static func mss(_ sec: Double) -> String {
    let s = JS.max(0, JS.round(JSNumber.or(sec, 0)))
    return "\(JSNumber.toString(JS.floor(s / 60))):\(pad(s.truncatingRemainder(dividingBy: 60), 2))"
  }

  /// Documentary timecode HH:MM:SS:FF at 25 fps («00:14:32:07»).
  public static func timecode(_ sec: Double) -> String {
    let t = JS.max(0, JSNumber.or(sec, 0))
    let f = JS.floor(t.truncatingRemainder(dividingBy: 1) * 25)
    let s = JS.floor(t)
    return "\(pad(JS.floor(s / 3600), 2)):\(pad(JS.floor(s / 60).truncatingRemainder(dividingBy: 60), 2)):\(pad(s.truncatingRemainder(dividingBy: 60), 2)):\(pad(f, 2))"
  }

  /// fmt.js clockOf(dayFraction): 0…1 of a day → «05:42».
  public static func clockOfDay(_ dayFraction: Double) -> String {
    let d = JSNumber.or(dayFraction, 0)
    let m = JS.round(((d.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)) * 1440).truncatingRemainder(dividingBy: 1440)
    return "\(pad(JS.floor(m / 60), 2)):\(pad(m.truncatingRemainder(dividingBy: 60), 2))"
  }

  // ==============================================================================================
  // Distances

  /// «740 М» / «1,4 КМ» (HUD instruments).
  public static func distU(_ m: Double) -> String {
    m < 1000 ? "\(nf0(JS.round(m / 10) * 10 + 0))\(NBSP)М" : "\(nf1(JS.round(m / 100) / 10))\(NBSP)КМ"
  }

  /// «740 м» / «1,4 км» / «2 км» (paper register).
  public static func distL(_ m: Double) -> String {
    m < 1000 ? "\(nf0(JS.round(m / 10) * 10 + 0))\(NBSP)м" : "\(nf1o(JS.round(m / 100) / 10))\(NBSP)км"
  }

  /// Visibility «1,2 КМ» / «200 М»; «—» when not finite.
  public static func visU(_ m: Double) -> String {
    if !m.isFinite { return "—" }
    if m >= 1000 { return "\(nf1o(JS.round(m / 100) / 10))\(NBSP)КМ" }
    return "\(nf0(JS.round(m / 10) * 10))\(NBSP)М"
  }

  // ==============================================================================================
  // Directions (0 = north (−Z), 90 = east (+X), clockwise)

  public static func bearingDeg(_ dx: Double, _ dz: Double) -> Double {
    ((JS.atan2(dx, -dz) * 180) / JS.PI + 360).truncatingRemainder(dividingBy: 360)
  }

  public static func bearingRad(_ dx: Double, _ dz: Double) -> Double { JS.atan2(dx, -dz) }

  /// «045°»
  public static func deg3(_ d: Double) -> String {
    let k = (JS.round(d).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    return "\(pad(k, 3))°"
  }

  /// Math.round((((deg % 360) + 360) % 360) / 45) % 8
  static func sector8(_ deg: Double) -> Double {
    JS.round((deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 45).truncatingRemainder(dividingBy: 8)
  }

  public func compass8(_ deg: Double) -> String { RuFormat.at(C8, RuFormat.sector8(deg)) }
  public func fromWords(_ deg: Double) -> String { RuFormat.at(FROM8, RuFormat.sector8(deg)) }
  public func toWords(_ deg: Double) -> String { RuFormat.at(TO8, RuFormat.sector8(deg)) }

  /// Wind «from» bearing from the direction the wind blows TOWARDS (x = X, y = Z).
  public static func windFromDeg(_ dirX: Double, _ dirZ: Double) -> Double { bearingDeg(-dirX, -dirZ) }

  /// Beaufort number of a wind speed (m/s).
  public func beaufortOf(_ ms: Double) -> Double {
    var b = 0.0
    for v in BEAUFORT where ms >= v { b += 1 }
    return b
  }

  /// Douglas sea state of a significant wave height (m).
  public func douglasOf(_ Hs: Double) -> Double {
    var s = 0.0
    for b in DOUGLAS where Hs > b { s += 1 }
    return JS.min(9, s + 1)
  }

  /// «8 БАЛЛОВ»
  public static func ballsU(_ n: Double) -> String { "\(JSNumber.toString(n))\(NBSP)\(plural(n, "БАЛЛ", "БАЛЛА", "БАЛЛОВ"))" }

  /// Straight double quotes → «ёлочки», alternating open / close.
  public static func guillemets(_ s: String) -> String {
    var open = true
    var out = ""
    for c in s.unicodeScalars {
      if c == "\"" {
        out += open ? "«" : "»"
        open.toggle()
      } else {
        out.unicodeScalars.append(c)
      }
    }
    return out
  }

  /// GROUP[type] || GROUP.swimmer
  public func groupOf(_ type: String?) -> GroupLabels { type.flatMap { group[$0] } ?? group["swimmer"] ?? GroupLabels(flir: "", toast: "", short: "") }

  /// `arr[i]` as a template literal sees it: "undefined" outside the array (or for a non-integer index).
  static func at(_ arr: [String], _ i: Double) -> String {
    guard i.isFinite, i >= 0, i == i.rounded(.towardZero), i < Double(arr.count) else { return "undefined" }
    return arr[Int(i)]
  }
}
