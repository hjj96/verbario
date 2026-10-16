// core/math.js helpers + other smoothstep signatures vs Node 22: Tests/Vectors/math/util.json.
import XCTest
@testable import MaydayCore

final class MathUtilTests: XCTestCase {
  private func rows(_ v: VectorFile, _ key: String) throws -> [[Double]] {
    try v.data.at(key).requireArray(key).map { try $0.doublesOrFail(key) }
  }

  func testClampLerpInvLerpRemap() throws {
    let v = try VectorLoader.load("math/util")
    for r in try rows(v, "clamp") { assertBitEqual(MathUtil.clamp(r[0], 0, 1), r[1], "clamp(\(r[0]), 0, 1)") }
    for r in try rows(v, "lerp") { assertBitEqual(MathUtil.lerp(r[0], r[1], r[2]), r[3], "lerp\(r)") }
    for r in try rows(v, "invLerp") { assertBitEqual(MathUtil.invLerp(r[0], r[1], r[2]), r[3], "invLerp\(r)") }
    for r in try rows(v, "remap") { assertBitEqual(MathUtil.remap(r[0], r[1], r[2], r[3], r[4]), r[5], "remap\(r)") }
  }

  func testSmoothsteps() throws {
    let v = try VectorLoader.load("math/util")
    for r in try rows(v, "smoothstepCore.cases") {
      assertBitEqual(MathUtil.smoothstep(r[0], r[1], r[2]), r[3], "smoothstep core \(r)")
    }
    for r in try rows(v, "smoothstepOcean.cases") {
      assertBitEqual(MathUtil.smoothstepOcean(r[0], r[1], r[2]), r[3], "smoothstep ocean \(r)")
    }
    for r in try rows(v, "smoothstepThree.cases") {
      assertBitEqual(MathUtil.smoothstepThree(r[0], r[1], r[2]), r[3], "THREE smoothstep \(r)")
    }
  }

  func testDampAndAngles() throws {
    let v = try VectorLoader.load("math/util")
    for r in try rows(v, "damp") { assertBitEqual(MathUtil.damp(r[0], r[1], r[2], r[3]), r[4], "damp\(r)") }
    for r in try rows(v, "dampAngle") { assertBitEqual(MathUtil.dampAngle(r[0], r[1], r[2], r[3]), r[4], "dampAngle\(r)") }
    for r in try rows(v, "wrapAngle") { assertBitEqual(MathUtil.wrapAngle(r[0]), r[1], "wrapAngle(\(r[0]))") }
  }
}
