// ECMAScript number <-> text conversions the HUD, scoring and data code use (PLAN §2.2):
//   Number.prototype.toFixed   → JSNumber.toFixed(x, digits)     (exact: ES2023 §21.1.3.3, like V8)
//   parseFloat(s)              → JSNumber.parseFloat(s)
//   parseInt(s, radix)         → JSNumber.parseInt(s, radix)
//   Number(s) / +s             → JSNumber.fromString(s)           (StringToNumber, §7.1.4.1.1)
// String(n) is JSNumber.toString (JSNumber.swift). Vectors: Tests/Vectors/math/jsnumber.json.
//
// toFixed is exact: x·10^f is computed as a big integer from the double's binary value and rounded
// half up ("if there are two such n, pick the larger n"), so (1.005).toFixed(2) = "1.00" and
// (0.5).toFixed(0) = "1", exactly like V8. Decimal → double conversions go through Swift's
// correctly rounded `Double(String)` after the ECMAScript grammar has been checked here (Swift would
// otherwise accept "inf", "nan", "0x1p3"…). Non-decimal digit strings are converted exactly
// (BigDigits) and rounded to nearest-even once.

extension JSNumber {
  // ---- toFixed --------------------------------------------------------------------------------------
  /// Number.prototype.toFixed(fractionDigits), fractionDigits in 0…100 (clamped; JS throws outside).
  public static func toFixed(_ x: Double, _ fractionDigits: Int) -> String {
    let f = Swift.max(0, Swift.min(100, fractionDigits))
    if !x.isFinite { return toString(x) }
    var s = ""
    var v = x
    if v < 0 {
      s = "-"
      v = -v
    }
    if v >= 1e21 { return s + toString(v) }
    // n = round-half-up(v · 10^f), exactly
    var n = BigDigits(v.integerSignificand)
    n.multiply(byPowerOf10: f)
    let e = v.integerSignificandExponent
    if e >= 0 {
      n.shiftLeft(e)
    } else {
      let roundUp = n.bit(-e - 1)
      n.shiftRight(-e)
      if roundUp { n.addSmall(1) }
    }
    var m = n.isZero ? "0" : n.decimalString()
    if f != 0 {
      var k = m.count
      if k <= f {
        m = String(repeating: "0", count: f + 1 - k) + m
        k = f + 1
      }
      let idx = m.index(m.startIndex, offsetBy: k - f)
      m = String(m[..<idx]) + "." + String(m[idx...])
    }
    return s + m
  }

  // ---- whitespace -----------------------------------------------------------------------------------
  /// ECMAScript StrWhiteSpaceChar: WhiteSpace (TAB, VT, FF, ZWNBSP, any Zs) or LineTerminator.
  public static func isJSWhitespace(_ c: Unicode.Scalar) -> Bool {
    switch c.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
      return true
    case 0x2000...0x200A:
      return true
    default:
      return false
    }
  }

  // ---- parseFloat -----------------------------------------------------------------------------------
  /// parseFloat(string): the longest prefix (after leading whitespace) that is a StrDecimalLiteral;
  /// NaN when there is none. Hex is not recognised ("0x10" → 0).
  public static func parseFloat(_ string: String) -> Double {
    let u = Array(string.unicodeScalars)
    var i = 0
    while i < u.count && isJSWhitespace(u[i]) { i += 1 }
    guard let (value, _) = scanDecimalLiteral(u, from: i) else { return .nan }
    return value
  }

  // ---- parseInt -------------------------------------------------------------------------------------
  /// parseInt(string, radix): radix 0 = undefined (10, or 16 after a 0x prefix); NaN when no digit.
  public static func parseInt(_ string: String, _ radix: Double = 0) -> Double {
    let u = Array(string.unicodeScalars)
    var i = 0
    while i < u.count && isJSWhitespace(u[i]) { i += 1 }
    var sign = 1.0
    if i < u.count && u[i] == "-" { sign = -1 }
    if i < u.count && (u[i] == "-" || u[i] == "+") { i += 1 }
    var r = Int(toInt32(radix))
    var stripPrefix = true
    if r != 0 {
      if r < 2 || r > 36 { return .nan }
      if r != 16 { stripPrefix = false }
    } else {
      r = 10
    }
    if stripPrefix && i + 1 < u.count && u[i] == "0" && (u[i + 1] == "x" || u[i + 1] == "X") {
      i += 2
      r = 16
    }
    let start = i
    while i < u.count, let d = digitValue(u[i]), d < r { i += 1 }
    if i == start { return .nan }
    let digits = u[start..<i]
    let mathInt: Double
    if r == 10 {
      mathInt = Double(String(String.UnicodeScalarView(digits))) ?? .nan
    } else {
      mathInt = BigDigits(digits: digits, radix: r).toDouble()
    }
    if mathInt == 0 { return sign < 0 ? -0.0 : 0 }
    return sign * mathInt
  }

  // ---- Number(string) -------------------------------------------------------------------------------
  /// Number(string) / unary plus: whitespace-trimmed StrNumericLiteral; "" → 0; anything else → NaN.
  /// Accepts decimal (with sign, fraction, exponent, "Infinity") and unsigned 0x / 0o / 0b integers.
  public static func fromString(_ string: String) -> Double {
    let u = Array(string.unicodeScalars)
    var lo = 0, hi = u.count
    while lo < hi && isJSWhitespace(u[lo]) { lo += 1 }
    while hi > lo && isJSWhitespace(u[hi - 1]) { hi -= 1 }
    if lo == hi { return 0 }
    let t = Array(u[lo..<hi])
    if t.count > 2 && t[0] == "0" {
      let radix: Int?
      switch t[1] {
      case "x", "X": radix = 16
      case "o", "O": radix = 8
      case "b", "B": radix = 2
      default: radix = nil
      }
      if let r = radix {
        let digits = t[2...]
        for c in digits {
          guard let d = digitValue(c), d < r else { return .nan }
        }
        return BigDigits(digits: digits, radix: r).toDouble()
      }
    }
    guard let (value, end) = scanDecimalLiteral(t, from: 0), end == t.count else { return .nan }
    return value
  }

  // ---- helpers --------------------------------------------------------------------------------------
  /// Digit value in radix 36 (0-9, a-z, A-Z), nil otherwise.
  static func digitValue(_ c: Unicode.Scalar) -> Int? {
    switch c.value {
    case 0x30...0x39: return Int(c.value - 0x30)
    case 0x61...0x7A: return Int(c.value - 0x61 + 10)
    case 0x41...0x5A: return Int(c.value - 0x41 + 10)
    default: return nil
    }
  }

  /// Longest StrDecimalLiteral starting at `from`: [+-]? (Infinity | digits [. digits] [exp] | . digits [exp]).
  /// Returns its value and the end index, or nil when no prefix qualifies.
  static func scanDecimalLiteral(_ u: [Unicode.Scalar], from: Int) -> (Double, Int)? {
    var i = from
    var negative = false
    if i < u.count && (u[i] == "+" || u[i] == "-") {
      negative = u[i] == "-"
      i += 1
    }
    let inf: [Unicode.Scalar] = ["I", "n", "f", "i", "n", "i", "t", "y"]
    if i + inf.count <= u.count && Array(u[i..<(i + inf.count)]) == inf {
      return (negative ? -.infinity : .infinity, i + inf.count)
    }
    let intStart = i
    while i < u.count && u[i].value >= 0x30 && u[i].value <= 0x39 { i += 1 }
    let intDigits = String(String.UnicodeScalarView(u[intStart..<i]))
    var fracDigits = ""
    if i < u.count && u[i] == "." {
      let fs = i + 1
      var j = fs
      while j < u.count && u[j].value >= 0x30 && u[j].value <= 0x39 { j += 1 }
      if !intDigits.isEmpty || j > fs {
        fracDigits = String(String.UnicodeScalarView(u[fs..<j]))
        i = j
      }
    }
    if intDigits.isEmpty && fracDigits.isEmpty { return nil }
    var exponent = ""
    if i < u.count && (u[i] == "e" || u[i] == "E") {
      var j = i + 1
      var expSign = ""
      if j < u.count && (u[j] == "+" || u[j] == "-") {
        expSign = u[j] == "-" ? "-" : ""
        j += 1
      }
      let es = j
      while j < u.count && u[j].value >= 0x30 && u[j].value <= 0x39 { j += 1 }
      if j > es {
        exponent = "e" + expSign + String(String.UnicodeScalarView(u[es..<j]))
        i = j
      }
    }
    let text = (intDigits.isEmpty ? "0" : intDigits) + (fracDigits.isEmpty ? "" : "." + fracDigits) + exponent
    guard let magnitude = Double(text) else { return nil }
    return (negative ? -magnitude : magnitude, i)
  }
}

extension Double {
  /// The integer significand m with self = m · 2^e (finite, non-negative values).
  var integerSignificand: UInt64 {
    if self == 0 { return 0 }
    let frac = significandBitPattern
    return exponentBitPattern == 0 ? frac : frac | (UInt64(1) << 52)
  }

  /// The exponent e with self = integerSignificand · 2^e.
  var integerSignificandExponent: Int {
    if self == 0 { return 0 }
    let b = Int(exponentBitPattern)
    return b == 0 ? -1074 : b - 1075
  }
}

/// Minimal unsigned big integer (little-endian UInt32 limbs) for exact decimal/binary conversions.
struct BigDigits {
  private(set) var limbs: [UInt32] = []

  init(_ v: UInt64) {
    if v != 0 { limbs = [UInt32(truncatingIfNeeded: v), UInt32(truncatingIfNeeded: v >> 32)] }
    normalize()
  }

  /// Value of `digits` in `radix` (every digit already validated < radix).
  init<S: Sequence>(digits: S, radix: Int) where S.Element == Unicode.Scalar {
    for c in digits {
      multiplySmall(UInt32(radix))
      addSmall(UInt32(JSNumber.digitValue(c) ?? 0))
    }
  }

  var isZero: Bool { limbs.isEmpty }

  private mutating func normalize() { while let l = limbs.last, l == 0 { limbs.removeLast() } }

  mutating func multiplySmall(_ m: UInt32) {
    var carry: UInt64 = 0
    for k in 0..<limbs.count {
      let p = UInt64(limbs[k]) * UInt64(m) + carry
      limbs[k] = UInt32(truncatingIfNeeded: p)
      carry = p >> 32
    }
    if carry != 0 { limbs.append(UInt32(carry)) }
    normalize()
  }

  mutating func addSmall(_ a: UInt32) {
    var carry = UInt64(a)
    var k = 0
    while carry != 0 {
      if k == limbs.count { limbs.append(0) }
      let s = UInt64(limbs[k]) + carry
      limbs[k] = UInt32(truncatingIfNeeded: s)
      carry = s >> 32
      k += 1
    }
  }

  mutating func multiply(byPowerOf10 n: Int) {
    var n = n
    while n >= 9 {
      multiplySmall(1_000_000_000)
      n -= 9
    }
    var p: UInt32 = 1
    for _ in 0..<n { p *= 10 }
    if p != 1 { multiplySmall(p) }
  }

  mutating func shiftLeft(_ bits: Int) {
    if isZero || bits == 0 { return }
    let words = bits / 32, rest = bits % 32
    var out = [UInt32](repeating: 0, count: words)
    var carry: UInt32 = 0
    for l in limbs {
      out.append(rest == 0 ? l : (l << UInt32(rest)) | carry)
      carry = rest == 0 ? 0 : l >> UInt32(32 - rest)
    }
    if carry != 0 { out.append(carry) }
    limbs = out
    normalize()
  }

  mutating func shiftRight(_ bits: Int) {
    let words = bits / 32, rest = bits % 32
    if words >= limbs.count {
      limbs = []
      return
    }
    var out = [UInt32]()
    out.reserveCapacity(limbs.count - words)
    for k in words..<limbs.count {
      let lo = limbs[k] >> UInt32(rest)
      let hi: UInt32 = (rest != 0 && k + 1 < limbs.count) ? limbs[k + 1] << UInt32(32 - rest) : 0
      out.append(lo | hi)
    }
    limbs = out
    normalize()
  }

  /// Bit `index` (0 = least significant).
  func bit(_ index: Int) -> Bool {
    if index < 0 { return false }
    let w = index / 32
    if w >= limbs.count { return false }
    return (limbs[w] >> UInt32(index % 32)) & 1 == 1
  }

  var bitWidth: Int {
    guard let top = limbs.last else { return 0 }
    return (limbs.count - 1) * 32 + (32 - top.leadingZeroBitCount)
  }

  /// Decimal digits (no sign, no leading zeros; "0" for zero).
  func decimalString() -> String {
    if isZero { return "0" }
    var v = limbs
    var chunks = [UInt32]()
    while !v.isEmpty {
      var rem: UInt64 = 0
      for k in stride(from: v.count - 1, through: 0, by: -1) {
        let cur = (rem << 32) | UInt64(v[k])
        v[k] = UInt32(cur / 1_000_000_000)
        rem = cur % 1_000_000_000
      }
      chunks.append(UInt32(rem))
      while let l = v.last, l == 0 { v.removeLast() }
    }
    var s = String(chunks.removeLast())
    for c in chunks.reversed() {
      let d = String(c)
      s += String(repeating: "0", count: 9 - d.count) + d
    }
    return s
  }

  /// Nearest double (ties to even), +Infinity beyond Double.greatestFiniteMagnitude.
  func toDouble() -> Double {
    let w = bitWidth
    if w == 0 { return 0 }
    if w <= 53 {
      var v: UInt64 = 0
      for (k, l) in limbs.enumerated() { v |= UInt64(l) << UInt64(32 * k) }
      return Double(v)
    }
    // top 53 bits, the next (round) bit and a sticky bit for everything below
    let shift = w - 53
    var top = self
    top.shiftRight(shift)
    var m: UInt64 = 0
    for (k, l) in top.limbs.enumerated() { m |= UInt64(l) << UInt64(32 * k) }
    let roundBit = bit(shift - 1)
    var sticky = false
    if shift >= 2 {
      for b in 0..<(shift - 1) where bit(b) {
        sticky = true
        break
      }
    }
    if roundBit && (sticky || m & 1 == 1) { m += 1 }
    var e = shift
    if m == (UInt64(1) << 53) {
      m >>= 1
      e += 1
    }
    if e > 1023 - 52 { return .infinity }
    return Double(sign: .plus, exponent: e, significand: Double(m))
  }
}
