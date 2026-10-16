// JS Number semantics: Math.round, ToUint32/ToInt32, Number::toString. Hand cases were produced by
// Node 22 (String(x), Math.round(x), x >>> 0, x | 0); math/jsnumber.json is used when exported.
import XCTest
@testable import MaydayCore

final class JSNumberTests: XCTestCase {
  // [input, String(x), Math.round(x), x >>> 0, x | 0]   (Node 22; nil round = NaN/±Infinity passthrough)
  private let cases: [(Double, String, Double?, UInt32, Int32)] = [
    (0, "0", 0, 0, 0),
    (-0.0, "0", -0.0, 0, 0),
    (1, "1", 1, 1, 1),
    (-1, "-1", -1, 4294967295, -1),
    (0.1, "0.1", 0, 0, 0),
    (0.5, "0.5", 1, 0, 0),
    (1.5, "1.5", 2, 1, 1),
    (-1.5, "-1.5", -1, 4294967295, -1),
    (2.5, "2.5", 3, 2, 2),
    (-2.5, "-2.5", -2, 4294967294, -2),
    (123.456, "123.456", 123, 123, 123),
    (1e21, "1e+21", 1e21, 3735027712, -559939584),
    (1e20, "100000000000000000000", 1e20, 1661992960, 1661992960),
    (123e18, "123000000000000000000", 123e18, 1829502976, 1829502976),
    (1e-7, "1e-7", 0, 0, 0),
    (1.5e-7, "1.5e-7", 0, 0, 0),
    (1e-6, "0.000001", 0, 0, 0),
    (0.000001234, "0.000001234", 0, 0, 0),
    (-1e-7, "-1e-7", -0.0, 0, 0),
    (Double.leastNonzeroMagnitude, "5e-324", 0, 0, 0),
    (1.7976931348623157e308, "1.7976931348623157e+308", 1.7976931348623157e308, 0, 0),
    (4294967295, "4294967295", 4294967295, 4294967295, -1),
    (4294967296, "4294967296", 4294967296, 0, 0),
    (-4294967297, "-4294967297", -4294967297, 4294967295, -1),
    (9007199254740992, "9007199254740992", 9007199254740992, 0, 0),
    (9007199254740994, "9007199254740994", 9007199254740994, 2, 2),
    (0.49999999999999994, "0.49999999999999994", 0, 0, 0),
    (-0.49999999999999994, "-0.49999999999999994", -0.0, 0, 0),
    (.nan, "NaN", nil, 0, 0),
    (.infinity, "Infinity", nil, 0, 0),
    (-.infinity, "-Infinity", nil, 0, 0),
    (1.0 / 3, "0.3333333333333333", 0, 0, 0),
    (-2.0 / 3, "-0.6666666666666666", -1, 0, 0),
    (100, "100", 100, 100, 100),
    (1e301, "1e+301", 1e301, 0, 0),
    (1.2345678901234567890e19, "12345678901234567000", 1.2345678901234567890e19, 3944679424, -350287872),
    (0.1 + 0.2, "0.30000000000000004", 0, 0, 0),
    (3.0e-5, "0.00003", 0, 0, 0),
    (255.5, "255.5", 256, 255, 255),
  ]

  func testHandCases() {
    for (x, str, round, u32, i32) in cases {
      XCTAssertEqual(JSNumber.toString(x), str, "String(\(x))")
      XCTAssertEqual(JSNumber.toUint32(x), u32, "\(x) >>> 0")
      XCTAssertEqual(JSNumber.toInt32(x), i32, "\(x) | 0")
      let r = JSNumber.round(x)
      if let want = round {
        assertBitEqual(r, want, "Math.round(\(x))")
      } else {
        assertBitEqual(r, x, "Math.round(\(x))")
      }
    }
  }

  func testUint8Stores() {
    XCTAssertEqual(JSNumber.toUint8(256), 0)
    XCTAssertEqual(JSNumber.toUint8(-1), 255)
    XCTAssertEqual(JSNumber.toUint8(255.9), 255)
    XCTAssertEqual(JSNumber.toUint8Clamp(255.9), 255)
    XCTAssertEqual(JSNumber.toUint8Clamp(2.5), 2)
    XCTAssertEqual(JSNumber.toUint8Clamp(3.5), 4)
    XCTAssertEqual(JSNumber.toUint8Clamp(-3), 0)
  }

  func testOrAndMod() {
    XCTAssertEqual(JSNumber.or(nil, 140), 140)
    XCTAssertEqual(JSNumber.or(0, 140), 140)
    XCTAssertEqual(JSNumber.or(.nan, 140), 140)
    XCTAssertEqual(JSNumber.or(90, 140), 90)
    assertBitEqual(JSNumber.mod(-7, 3), -1, "-7 % 3")
    assertBitEqual(JSNumber.mod(-0.0, 3), -0.0, "-0 % 3")
    assertBitEqual(JSNumber.mod(7.5, -2), 1.5, "7.5 % -2")
  }

  /// Tests/Vectors/math/jsnumber.json (planned: export-vectors 'math' group). Schema assumed:
  /// data.round [[x, out]], data.toUint32 [[x, out]], data.toInt32 [[x, out]], data.toString [[x, str]].
  func testVectorFileIfExported() throws {
    let v = try VectorLoader.load("math/jsnumber")
    for row in v.data["round"].array ?? [] {
      guard let x = row[0].double, let want = row[1].double else { continue }
      assertBitEqual(JSNumber.round(x), want, "Math.round(\(x))")
    }
    for row in v.data["toUint32"].array ?? [] {
      guard let x = row[0].double, let want = row[1].double else { continue }
      XCTAssertEqual(Double(JSNumber.toUint32(x)), want, "\(x) >>> 0")
    }
    for row in v.data["toInt32"].array ?? [] {
      guard let x = row[0].double, let want = row[1].double else { continue }
      XCTAssertEqual(Double(JSNumber.toInt32(x)), want, "\(x) | 0")
    }
    for row in v.data["toString"].array ?? [] {
      guard let x = row[0].double, let want = row[1].string else { continue }
      XCTAssertEqual(JSNumber.toString(x), want, "String(\(x))")
    }
  }
}
