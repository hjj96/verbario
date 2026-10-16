// ocean/coast.js coastDistance / coastDamp vs the web: Tests/Vectors/ocean/coast_<missionId>.json
// (map bytes baked by Chromium after mission:setup, 500 samples evaluated by Node).
import XCTest
@testable import MaydayCore

final class CoastTests: XCTestCase {
  private func run(_ mission: String) throws {
    let v = try VectorLoader.load("ocean/coast_\(mission)")
    XCTAssertEqual(v.data["COAST_MAX"].double, CoastMap.COAST_MAX)
    let m = v.data["map"]
    let w = try m["w"].requireInt("w"), h = try m["h"].requireInt("h")
    let shape = try m["shape"].doublesOrFail("shape")
    XCTAssertEqual(shape, [Double(h), Double(w)])
    let bytes = try v.sidecarU8(m)
    let map = CoastMap(w: w, h: h, x0: try m["x0"].doubleOrFail("x0"), z0: try m["z0"].doubleOrFail("z0"),
                       cell: try m["cell"].doubleOrFail("cell"), data: bytes)
    let rows = try v.data["samples"]["values"].requireArray("samples")
    XCTAssertEqual(rows.count, 500)
    var got = [Double](), want = [Double]()
    for r in rows {
      let x = try r[0].doubleOrFail("x"), z = try r[1].doubleOrFail("z")
      got.append(map.distance(x, z))
      want.append(try r[2].doubleOrFail("coastDistance"))
    }
    assertBitEqual(got, want, "coastDistance \(mission)")
  }

  func testFirst() throws { try run("first") }
  func testFog() throws { try run("fog") }

  func testAllExportedCoastFiles() throws {
    let dir = VectorLoader.vectorsRoot.appendingPathComponent("ocean")
    let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
    let missions = files.filter { $0.hasPrefix("coast_") && $0.hasSuffix(".json") }
      .map { String($0.dropFirst("coast_".count).dropLast(".json".count)) }
    if missions.isEmpty { throw XCTSkip("no coast_<mission>.json exported") }
    for id in missions where id != "first" && id != "fog" { try run(id) }
  }

  func testDampCurve() {
    assertBitEqual(CoastMap.damp(0), 0.2, "coastDamp(0)")
    assertBitEqual(CoastMap.damp(1), 0.2, "coastDamp(1)")
    assertBitEqual(CoastMap.damp(16), 1, "coastDamp(16)")
    assertBitEqual(CoastMap.damp(48), 1, "coastDamp(48)")
    // t = 0.5 → 0.2 + 0.8 * 0.5 * 0.5 * 2 = 0.6
    assertBitEqual(CoastMap.damp(8.5), 0.2 + 0.8 * 0.5 * 0.5 * (3 - 2 * 0.5), "coastDamp(8.5)")
  }

  func testOutsideAndNaN() {
    let map = CoastMap(w: 2, h: 2, x0: 0, z0: 0, cell: 1, data: [0, 255, 255, 255])
    XCTAssertEqual(map.distance(-10, 0.5), CoastMap.COAST_MAX)
    XCTAssertEqual(map.distance(0.5, 0.5), 0)
    XCTAssertEqual(map.distance(1.5, 0.5), CoastMap.COAST_MAX)
    XCTAssertTrue(map.distance(.nan, 0.5).isNaN)
  }

  func testBakeSquareIsland() {
    // a 20 m square of land at y = 5 on a 1 m vertex grid: distances grow away from the shore
    var verts = [V3]()
    for j in -10...10 { for i in -10...10 { verts.append(V3(Double(i), 5, Double(j))) } }
    guard let map = CoastMap.bake(worldVertices: verts) else { return XCTFail("bake returned nil") }
    XCTAssertEqual(map.distance(0, 0), 0)
    XCTAssertGreaterThan(map.distance(30, 0), map.distance(15, 0))
    XCTAssertEqual(map.distance(500, 0), CoastMap.COAST_MAX)
    XCTAssertNil(CoastMap.bake(worldVertices: [V3(0, -1, 0)]))
  }
}
