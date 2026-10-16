// ECMAScript Number semantics that Swift does not have built in (PLAN §2.2):
//   ToInt32 / ToUint32 (`x | 0`, `x >>> 0`, typed-array stores), Math.round, `%`, Number::toString.
//
// Rules for ported code:
//   * `a >>> 0`            → JSNumber.toUint32(a)            (a is a JS number = Double)
//   * `a | 0`              → JSNumber.toInt32(a)
//   * integer hashes        → UInt32 with &+ &* and explicit parentheses (Swift's `^`/`|` bind like `+`)
//   * `Math.imul(a, b)`     → JS.imul
//   * `a % b`               → JSNumber.mod(a, b) (= truncatingRemainder, sign of the dividend, exact)
//   * `Uint8Array[i] = v`   → JSNumber.toUint8(v)  (modulo 256, NOT clamped)
//   * `Float32Array[i] = v` → Float(v)
public enum JSNumber {
  private static let two32: Double = 4294967296.0

  /// ToUint32(x): NaN/±Infinity → 0, truncate toward zero, modulo 2^32. Exact for every Double
  /// (products above 2^53 included: the modulo is taken of the already-rounded double, like JS).
  @inline(__always) public static func toUint32(_ x: Double) -> UInt32 {
    if x >= 0 && x < two32 { return UInt32(x) } // fast path (truncates toward zero)
    if !x.isFinite { return 0 }
    var m = x.rounded(.towardZero).truncatingRemainder(dividingBy: two32)
    if m < 0 { m += two32 }
    return UInt32(m)
  }

  /// ToInt32(x)
  @inline(__always) public static func toInt32(_ x: Double) -> Int32 {
    if x > -2147483649.0 && x < 2147483648.0 { return Int32(x) } // fast path (truncates toward zero)
    return Int32(bitPattern: toUint32(x))
  }

  /// ToUint16(x)
  @inline(__always) public static func toUint16(_ x: Double) -> UInt16 { UInt16(truncatingIfNeeded: toUint32(x)) }

  /// ToUint8(x): what `Uint8Array[i] = x` stores (modulo 256).
  @inline(__always) public static func toUint8(_ x: Double) -> UInt8 { UInt8(truncatingIfNeeded: toUint32(x)) }

  /// ToUint8Clamp(x): what `Uint8ClampedArray[i] = x` stores (round half to even, clamp 0…255).
  public static func toUint8Clamp(_ x: Double) -> UInt8 {
    if x.isNaN || x <= 0 { return 0 }
    if x >= 255 { return 255 }
    return UInt8(x.rounded(.toNearestOrEven))
  }

  /// Math.round(x): the closest integer, ties toward +Infinity; returns -0 for x in [-0.5, -0].
  @inline(__always) public static func round(_ x: Double) -> Double {
    let f = x.rounded(.down)
    let r = (x - f >= 0.5) ? f + 1 : f
    if r == 0 && (x < 0 || (x == 0 && x.sign == .minus)) { return -0.0 }
    return r
  }

  /// `a % b` (fmod: result has the sign of `a`; exact).
  @inline(__always) public static func mod(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }

  /// JS truthiness of a number (`x || fallback`): 0, -0 and NaN are falsy.
  @inline(__always) public static func isTruthy(_ x: Double) -> Bool { !(x == 0 || x.isNaN) }

  /// `x || fallback` for numbers.
  @inline(__always) public static func or(_ x: Double?, _ fallback: Double) -> Double {
    guard let v = x, isTruthy(v) else { return fallback }
    return v
  }

  /// Number.isFinite
  @inline(__always) public static func isFinite(_ x: Double?) -> Bool { x?.isFinite ?? false }

  /// Number::toString(10) — ECMAScript 2023 §6.1.6.1.20: shortest round-trip digits, plain notation
  /// for 1e-7 < |x| < 1e21, exponential otherwise ("1e+21", "1.5e-7").
  /// The digits come from Swift's shortest round-trip `description`, which (like V8) picks the
  /// shortest digit string closest to the exact binary value.
  public static func toString(_ x: Double) -> String {
    if x.isNaN { return "NaN" }
    if x == 0 { return "0" } // both zeros
    if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
    let negative = x < 0
    let (digits, n) = shortestDigits(x.magnitude)
    let k = digits.count
    var out = negative ? "-" : ""
    if k <= n && n <= 21 {
      out += digits + String(repeating: "0", count: n - k)
    } else if 0 < n && n <= 21 {
      let idx = digits.index(digits.startIndex, offsetBy: n)
      out += String(digits[..<idx])
      out += "."
      out += String(digits[idx...])
    } else if -6 < n && n <= 0 {
      out += "0."
      out += String(repeating: "0", count: -n)
      out += digits
    } else {
      let e = n - 1
      out.append(digits[digits.startIndex])
      if k > 1 {
        out += "."
        out += String(digits.dropFirst())
      }
      out += e >= 0 ? "e+" : "e-"
      out += String(e >= 0 ? e : -e)
    }
    return out
  }

  /// Shortest round-trip decimal digits of a finite positive double: (digits without leading or
  /// trailing zeros, n) with value = 0.d1d2…dk × 10^n.
  static func shortestDigits(_ x: Double) -> (String, Int) {
    let s = x.description // e.g. "123.456", "1e-07", "5e-324", "1.2345e+20", "100.0"
    var mantissa = Substring(s)
    var exp10 = 0
    if let e = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      mantissa = s[..<e]
      exp10 = Int(s[s.index(after: e)...]) ?? 0
    }
    var intPart = mantissa
    var fracPart: Substring = ""
    if let dot = mantissa.firstIndex(of: ".") {
      intPart = mantissa[..<dot]
      fracPart = mantissa[mantissa.index(after: dot)...]
    }
    var all = String(intPart) + String(fracPart)
    var n = intPart.count + exp10 // position of the decimal point relative to `all`
    // strip leading zeros (each one moves the point left)
    while all.count > 1 && all.first == "0" {
      all.removeFirst()
      n -= 1
    }
    // strip trailing zeros
    while all.count > 1 && all.last == "0" { all.removeLast() }
    return (all, n)
  }
}
