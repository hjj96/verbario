// Parity assertions (PLAN §5.4): bit-exact comparison of doubles with a useful first-mismatch report.
import Foundation
import XCTest
@testable import MaydayCore

enum Bits {
  /// Doubles are "bit-equal" when their IEEE patterns match; any NaN equals any NaN (V8 canonicalises
  /// NaN payloads, C code may produce a different NaN — JS cannot observe the difference).
  @inline(__always) static func equal(_ a: Double, _ b: Double) -> Bool {
    a.bitPattern == b.bitPattern || (a.isNaN && b.isNaN)
  }

  /// Monotonic integer image of a double (for ulp distances).
  static func ordered(_ x: Double) -> Int64 {
    let b = Int64(bitPattern: x.bitPattern)
    return b >= 0 ? b : Int64.min &- b
  }

  static func ulps(_ a: Double, _ b: Double) -> UInt64 {
    if a.isNaN || b.isNaN { return a.isNaN && b.isNaN ? 0 : UInt64.max }
    let x = ordered(a), y = ordered(b)
    return x >= y ? UInt64(bitPattern: x &- y) : UInt64(bitPattern: y &- x)
  }

  static func hex(_ x: Double) -> String {
    let s = String(x.bitPattern, radix: 16)
    return "0x" + String(repeating: "0", count: max(0, 16 - s.count)) + s
  }

  static func describe(_ actual: Double, _ expected: Double) -> String {
    "got \(actual) (\(hex(actual))), expected \(expected) (\(hex(expected))), \(ulps(actual, expected)) ulp"
  }
}

/// Exact double comparison (NaN == NaN; -0 != +0).
func assertBitEqual(_ actual: Double, _ expected: Double, _ message: @autoclosure () -> String = "",
                    file: StaticString = #filePath, line: UInt = #line) {
  if !Bits.equal(actual, expected) {
    XCTFail("\(message()): \(Bits.describe(actual, expected))", file: file, line: line)
  }
}

/// Exact comparison of two sequences; reports the count and the first few mismatches (index, values, ulp).
@discardableResult
func assertBitEqual(_ actual: [Double], _ expected: [Double], _ label: @autoclosure () -> String,
                    maxReports: Int = 3, file: StaticString = #filePath, line: UInt = #line) -> Int {
  if actual.count != expected.count {
    XCTFail("\(label()): \(actual.count) values, expected \(expected.count)", file: file, line: line)
    return max(actual.count, expected.count)
  }
  var bad = 0
  var report = [String]()
  var worst: UInt64 = 0
  for i in 0..<actual.count where !Bits.equal(actual[i], expected[i]) {
    bad += 1
    worst = max(worst, Bits.ulps(actual[i], expected[i]))
    if report.count < maxReports { report.append("[\(i)] \(Bits.describe(actual[i], expected[i]))") }
  }
  if bad > 0 {
    XCTFail("\(label()): \(bad)/\(actual.count) differ (worst \(worst) ulp); first: " + report.joined(separator: "; "),
            file: file, line: line)
  }
  return bad
}

/// |actual - expected| ≤ maxUlps ulp.
func assertULP(_ actual: Double, _ expected: Double, max maxUlps: UInt64, _ message: @autoclosure () -> String = "",
               file: StaticString = #filePath, line: UInt = #line) {
  if Bits.ulps(actual, expected) > maxUlps {
    XCTFail("\(message()): \(Bits.describe(actual, expected)) > \(maxUlps) ulp", file: file, line: line)
  }
}

/// Float32 value against the exporter's double (a Float32Array element widened to double).
func assertFloatBitEqual(_ actual: [Float], _ expected: [Double], _ label: @autoclosure () -> String,
                         file: StaticString = #filePath, line: UInt = #line) {
  assertBitEqual(actual.map { Double($0) }, expected, label(), file: file, line: line)
}

extension JSONValue {
  /// `doubles` or a test failure with context.
  func doublesOrFail(_ what: String, file: StaticString = #filePath, line: UInt = #line) throws -> [Double] {
    guard let d = doubles else {
      XCTFail("\(what): expected an array of numbers, got \(kindName)", file: file, line: line)
      throw VectorError("\(what): not a number array")
    }
    return d
  }

  func doubleOrFail(_ what: String, file: StaticString = #filePath, line: UInt = #line) throws -> Double {
    guard let d = double else {
      XCTFail("\(what): expected a number, got \(kindName)", file: file, line: line)
      throw VectorError("\(what): not a number")
    }
    return d
  }
}
