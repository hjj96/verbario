// CJSMath vs Node 22: Tests/Vectors/math/jsmath.json + jsmath_<fn>.f64 (rows [in0, (in1, in2,) out]).
import XCTest
@testable import MaydayCore

final class JSMathTests: XCTestCase {
  private func check(_ name: String, _ f: ([Double]) -> Double, file: StaticString = #filePath, line: UInt = #line) throws {
    let v = try VectorLoader.load("math/jsmath")
    let ref = v.data["functions"][name]
    XCTAssertTrue(ref.exists, "jsmath.json has no \(name)", file: file, line: line)
    let arity = try ref["arity"].requireInt("\(name).arity")
    let rows = try v.sidecarF64(ref)
    let width = arity + 1
    XCTAssertEqual(rows.count % width, 0, file: file, line: line)
    var got = [Double](), want = [Double]()
    var i = 0
    while i + width <= rows.count {
      got.append(f(Array(rows[i..<(i + arity)])))
      want.append(rows[i + arity])
      i += width
    }
    XCTAssertGreaterThan(got.count, 1000, "\(name): too few rows", file: file, line: line)
    if name == "pow" && !JS.powIsExact {
      let maxUlp = UInt64(v.root["tolerance"]["powMaxUlp"].int ?? 1)
      for k in 0..<got.count { assertULP(got[k], want[k], max: maxUlp, "pow row \(k)", file: file, line: line) }
    } else {
      assertBitEqual(got, want, "Math.\(name)", file: file, line: line)
    }
  }

  func testSin() throws { try check("sin") { JS.sin($0[0]) } }
  func testCos() throws { try check("cos") { JS.cos($0[0]) } }
  func testTan() throws { try check("tan") { JS.tan($0[0]) } }
  func testExp() throws { try check("exp") { JS.exp($0[0]) } }
  func testLog() throws { try check("log") { JS.log($0[0]) } }
  func testAtan() throws { try check("atan") { JS.atan($0[0]) } }
  func testAsin() throws { try check("asin") { JS.asin($0[0]) } }
  func testAcos() throws { try check("acos") { JS.acos($0[0]) } }
  func testSinh() throws { try check("sinh") { JS.sinh($0[0]) } }
  func testTanh() throws { try check("tanh") { JS.tanh($0[0]) } }
  func testExpm1() throws { try check("expm1") { JS.expm1($0[0]) } }
  func testLog1p() throws { try check("log1p") { JS.log1p($0[0]) } }
  func testAtan2() throws { try check("atan2") { JS.atan2($0[0], $0[1]) } }
  func testPow() throws { try check("pow") { JS.pow($0[0], $0[1]) } }
  func testHypot() throws { try check("hypot") { JS.hypot($0[0], $0[1]) } }
  func testHypot3() throws { try check("hypot3") { JS.hypot($0[0], $0[1], $0[2]) } }

  func testHypotVariadicMatchesFixedArity() throws {
    let v = try VectorLoader.load("math/jsmath")
    let rows = try v.sidecarF64(v.data["functions"]["hypot3"])
    var i = 0
    while i + 4 <= rows.count {
      assertBitEqual(JS.hypot([rows[i], rows[i + 1], rows[i + 2]]), rows[i + 3], "hypot(...[3]) row \(i / 4)")
      i += 4 * 97 // a sample is enough
    }
    XCTAssertEqual(JS.hypot([]), 0)
  }

  func testBuiltWithoutFPContraction() {
    XCTAssertTrue(JS.fpContractionOff, "CJSMath compiled with FMA contraction (-ffp-contract=fast / -ffast-math)")
    // Swift itself never contracts: the same probe in Swift must give exactly 0.
    let a = 1.0 + 0x1p-30, c = 1.0 + 0x1p-29
    var r = a
    r = r * a - c
    XCTAssertEqual(r, 0)
  }

  func testPowIsExactV8Port() {
    XCTAssertTrue(JS.powIsExact, "CJSMath pow should be the V8 ieee754::pow port")
    // V8 special cases (ECMAScript): NaN exponent, (±1)**±Infinity, x**±0
    XCTAssertTrue(JS.pow(1, .nan).isNaN)
    XCTAssertTrue(JS.pow(1, .infinity).isNaN)
    XCTAssertTrue(JS.pow(-1, -.infinity).isNaN)
    XCTAssertEqual(JS.pow(.nan, 0), 1)
    XCTAssertEqual(JS.pow(3, 2), 9)
    XCTAssertEqual(JS.pow(2, 0.5), JS.sqrt(2))
  }

  func testMinMaxSignedZeroAndNaN() {
    XCTAssertEqual(JS.max(0, -0.0).sign, .plus)
    XCTAssertEqual(JS.max(-0.0, 0).sign, .plus)
    XCTAssertEqual(JS.min(0, -0.0).sign, .minus)
    XCTAssertEqual(JS.min(-0.0, 0).sign, .minus)
    XCTAssertTrue(JS.max(1, .nan).isNaN)
    XCTAssertTrue(JS.min(.nan, 1).isNaN)
    XCTAssertEqual(JS.max(1, 2, 3), 3)
    XCTAssertEqual(JS.min(1, -2, 3), -2)
    XCTAssertEqual(JS.sign(-0.0).sign, .minus)
    XCTAssertTrue(JS.sign(.nan).isNaN)
    XCTAssertEqual(JS.sign(-3), -1)
    XCTAssertEqual(JS.floor(-0.0).sign, .minus)
    XCTAssertEqual(JS.ceil(-0.5).sign, .minus)
    XCTAssertEqual(JS.abs(-0.0).sign, .plus)
  }

  func testImul() {
    // Math.imul(0xffffffff, 5) = -5; Math.imul(0x7fffffff, 2) = -2; Math.imul(3, 4) = 12
    XCTAssertEqual(JS.imul(Double(4294967295), Double(5)), Int32(-5))
    XCTAssertEqual(JS.imul(Double(2147483647), Double(2)), Int32(-2))
    XCTAssertEqual(JS.imul(Double(3), Double(4)), Int32(12))
    XCTAssertEqual(JS.imul(UInt32(0xffff_ffff), 5), UInt32(bitPattern: -5))
  }
}
