// ocean/grid.js buildOceanGrid / snapQuantum vs Node 22 (Support/CoreReference.swift; ocean/grid.json
// from the exporter takes over when it exists) + ocean.js focus/offset helpers.
import XCTest
@testable import MaydayCore

final class OceanGridTests: XCTestCase {
  func testGridChecksums() throws {
    let ref = try JSONValue.parse(CoreReference.oceanGridJSON)
    for g in try ref.requireArray("grid") {
      let n = try g["N"].requireInt("N")
      assertBitEqual(OceanGrid.snapQuantum(n), try g["q"].doubleOrFail("q"), "snapQuantum(\(n))")
      let mesh = OceanGrid.build(n)
      XCTAssertEqual(mesh.positions.count / 3, g["verts"].int, "verts N=\(n)")
      XCTAssertEqual(mesh.indices.count, g["idx"].int, "indices N=\(n)")
      var pw = 0.0
      for (i, p) in mesh.positions.enumerated() { pw += Double(p) * Double((i % 7) + 1) }
      assertBitEqual(pw, try g["pw"].doubleOrFail("pw"), "position checksum N=\(n)")
      var isum = 0.0
      var iw: UInt32 = 0
      for i in mesh.indices {
        isum += Double(i)
        iw = iw &* 31 &+ i
      }
      assertBitEqual(isum, try g["is"].doubleOrFail("is"), "index sum N=\(n)")
      XCTAssertEqual(Double(iw), g["iw"].double, "index hash N=\(n)")
    }
  }

  func testFocusAndSnap() {
    // camera straight down at 120 m: focus under the camera
    let f = OceanCPU.focus(cameraPosition: V3(10, 120, -4), cameraDirection: V3(0, -1, 0))
    XCTAssertEqual(f, V2(10, -4))
    let q = OceanGrid.snapQuantum(300)
    let o = OceanCPU.snappedOffset(V2(10, -4), quantum: q)
    XCTAssertEqual(o.x, JSNumber.round(10 / q) * q)
    XCTAssertEqual(o.y, JSNumber.round(-4 / q) * q)
  }
}
