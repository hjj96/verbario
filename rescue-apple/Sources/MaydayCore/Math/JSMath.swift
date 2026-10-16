// JavaScript's Math.* with the reference engine's exact results (Node 22 / V8).
//
// Every transcendental goes through CJSMath (fdlibm + V8 hypot/pow, compiled without FP
// contraction), never through Foundation/Darwin/Glibc: those differ from V8 by an ulp on a few
// percent of inputs, which is enough to make a chaotic simulation diverge. Everything that IEEE-754
// defines exactly (sqrt, floor, abs, +, *, …) is plain Swift.
//
// Ported call sites keep the JS expression shape and evaluation order; Swift never fuses a*b+c,
// so `a * b + c` here rounds exactly like JS.
import CJSMath

public enum JS {
  public static let PI: Double = 3.141592653589793 // Math.PI (== Double.pi, bit-identical)
  public static let SQRT2: Double = 1.4142135623730951 // Math.SQRT2
  public static let SQRT1_2: Double = 0.7071067811865476 // Math.SQRT1_2
  public static let E: Double = 2.718281828459045 // Math.E
  public static let LN2: Double = 0.6931471805599453 // Math.LN2

  // ---- transcendental (CJSMath) ----------------------------------------------------------------
  @inline(__always) public static func sin(_ x: Double) -> Double { jsm_sin(x) }
  @inline(__always) public static func cos(_ x: Double) -> Double { jsm_cos(x) }
  @inline(__always) public static func tan(_ x: Double) -> Double { jsm_tan(x) }
  @inline(__always) public static func asin(_ x: Double) -> Double { jsm_asin(x) }
  @inline(__always) public static func acos(_ x: Double) -> Double { jsm_acos(x) }
  @inline(__always) public static func atan(_ x: Double) -> Double { jsm_atan(x) }
  @inline(__always) public static func atan2(_ y: Double, _ x: Double) -> Double { jsm_atan2(y, x) }
  @inline(__always) public static func exp(_ x: Double) -> Double { jsm_exp(x) }
  @inline(__always) public static func log(_ x: Double) -> Double { jsm_log(x) }
  @inline(__always) public static func log10(_ x: Double) -> Double { jsm_log10(x) }
  @inline(__always) public static func expm1(_ x: Double) -> Double { jsm_expm1(x) }
  @inline(__always) public static func log1p(_ x: Double) -> Double { jsm_log1p(x) }
  @inline(__always) public static func sinh(_ x: Double) -> Double { jsm_sinh(x) }
  @inline(__always) public static func tanh(_ x: Double) -> Double { jsm_tanh(x) }

  /// Math.pow(x, y) and the `**` operator (identical in V8).
  @inline(__always) public static func pow(_ x: Double, _ y: Double) -> Double { jsm_pow(x, y) }

  /// Math.hypot(a, b)
  @inline(__always) public static func hypot(_ a: Double, _ b: Double) -> Double { jsm_hypot2(a, b) }
  /// Math.hypot(a, b, c)
  @inline(__always) public static func hypot(_ a: Double, _ b: Double, _ c: Double) -> Double { jsm_hypot3(a, b, c) }
  /// Math.hypot(...values)
  public static func hypot(_ values: [Double]) -> Double {
    if values.isEmpty { return 0 }
    return values.withUnsafeBufferPointer { buf in jsm_hypotn(buf.baseAddress, Int32(buf.count)) }
  }

  /// True when CJSMath's pow is the exact V8 algorithm (parity tests use it).
  public static var powIsExact: Bool { jsm_pow_is_exact() != 0 }

  // ---- exact operations (IEEE-754 defines the result) ------------------------------------------
  @inline(__always) public static func sqrt(_ x: Double) -> Double { x.squareRoot() }
  /// Math.abs (abs(-0) = +0, abs(NaN) = NaN).
  @inline(__always) public static func abs(_ x: Double) -> Double { x.magnitude }
  /// Math.floor (keeps -0).
  @inline(__always) public static func floor(_ x: Double) -> Double { x.rounded(.down) }
  /// Math.ceil (ceil(-0.5) = -0).
  @inline(__always) public static func ceil(_ x: Double) -> Double { x.rounded(.up) }
  /// Math.trunc
  @inline(__always) public static func trunc(_ x: Double) -> Double { x.rounded(.towardZero) }
  /// Math.round: nearest integer, ties toward +Infinity; -0 for x in [-0.5, -0].
  @inline(__always) public static func round(_ x: Double) -> Double { JSNumber.round(x) }
  /// Math.fround
  @inline(__always) public static func fround(_ x: Double) -> Double { Double(Float(x)) }

  /// Math.sign
  public static func sign(_ x: Double) -> Double {
    if x.isNaN { return .nan }
    if x > 0 { return 1 }
    if x < 0 { return -1 }
    return x // ±0
  }

  /// Math.max(a, b): NaN if either is NaN; max(+0, -0) = +0.
  @inline(__always) public static func max(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a > b { return a }
    if b > a { return b }
    // equal (or ±0): prefer +0
    return a.sign == .minus ? b : a
  }

  /// Math.min(a, b): NaN if either is NaN; min(+0, -0) = -0.
  @inline(__always) public static func min(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a < b { return a }
    if b < a { return b }
    return a.sign == .minus ? a : b
  }

  /// Math.max(a, b, c)
  @inline(__always) public static func max(_ a: Double, _ b: Double, _ c: Double) -> Double { max(max(a, b), c) }
  /// Math.min(a, b, c)
  @inline(__always) public static func min(_ a: Double, _ b: Double, _ c: Double) -> Double { min(min(a, b), c) }

  /// Math.imul on 32-bit patterns (ToInt32 of both operands, wrapping product).
  @inline(__always) public static func imul(_ a: UInt32, _ b: UInt32) -> UInt32 { a &* b }
  /// Math.imul(a, b) for JS numbers.
  @inline(__always) public static func imul(_ a: Double, _ b: Double) -> Int32 {
    Int32(bitPattern: JSNumber.toUint32(a) &* JSNumber.toUint32(b))
  }
}
