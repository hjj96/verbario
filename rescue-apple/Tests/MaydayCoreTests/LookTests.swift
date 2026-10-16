// core/look.js CPU mirrors vs Node 22: Tests/Vectors/look/fields.json (+ Resources/Textures/*.rgba).
import XCTest
@testable import MaydayCore

final class LookTests: XCTestCase {
  /// Loaded once: the exported textures (sha-verified by the catalog).
  private static var cachedLook: Look?

  private func exportedLook() throws -> Look {
    if let l = LookTests.cachedLook { return l }
    let catalog = try VectorLoader.catalog()
    let data = try LookData(catalog: catalog)
    let l = try Look.load(catalog: catalog, look: data)
    LookTests.cachedLook = l
    return l
  }

  func testExportedTexturesMatchVectorShas() throws {
    let v = try VectorLoader.load("look/fields")
    let look = try exportedLook()
    let tex = v.data["textures"]
    XCTAssertEqual(look.atlas.sha256, tex["atlas"]["sha256"].string)
    XCTAssertEqual(look.detail.sha256, tex["detail"]["sha256"].string)
    XCTAssertEqual(look.lace.sha256, tex["lace"]["sha256"].string)
    XCTAssertEqual(look.atlas.size, tex["atlas"]["width"].int)
    XCTAssertEqual(look.lace.size, tex["lace"]["width"].int)
  }

  /// The ported generators rebuild the exact bytes (slow in debug builds: ~65k + 262k texels of noise).
  func testGeneratorsReproduceTextures() throws {
    let v = try VectorLoader.load("look/fields")
    let seed = try v.data["lookSeed"].requireInt("lookSeed")
    let tex = v.data["textures"]
    let atlas = LookTextures.makeAtlas(seed: seed)
    XCTAssertEqual(atlas.sha256, tex["atlas"]["sha256"].string, "makeAtlas(\(seed))")
    let det = LookTextures.makeDetail(seed: Double(seed + 3))
    XCTAssertEqual(det.texture.sha256, tex["detail"]["sha256"].string, "makeDetail(\(seed + 3))")
    assertBitEqual(det.maxSlope, 38.6270549618508, "detailMaxSlope (Node: new Look(7).detailMaxSlope)")
    let lace = LookTextures.makeLace(seed: seed + 11)
    XCTAssertEqual(lace.sha256, tex["lace"]["sha256"].string, "makeLace(\(seed + 11))")
  }

  func testSamplers() throws {
    let v = try VectorLoader.load("look/fields")
    let look = try exportedLook()
    let s = v.data["samples"]
    for (key, f) in [("atlas", look.sampleAtlas), ("lace", look.sampleLace), ("detail", look.sampleDetail)] as [(String, (Double, Double, Int) -> Double)] {
      let rows = try s[key].requireArray(key)
      XCTAssertEqual(rows.count, 256)
      var got = [Double](), want = [Double]()
      for r in rows {
        let u = try r[0].doubleOrFail("u"), w = try r[1].doubleOrFail("v")
        let ch = try r[2].requireInt("ch")
        got.append(f(u, w, ch))
        want.append(try r[3].doubleOrFail("value"))
      }
      assertBitEqual(got, want, "sample\(key)")
    }
  }

  func testGustFieldAndCloudAt() throws {
    let v = try VectorLoader.load("look/fields")
    let look = try exportedLook()
    let axis = try v.data["grid"]["axis"].doublesOrFail("grid.axis")
    let c = v.data["constants"]
    XCTAssertEqual(c["GUST_SCALE"].double, look.constants.gustScale)
    XCTAssertEqual(c["GUST_DRIFT"].double, look.constants.gustDrift)
    XCTAssertEqual(c["CLOUD_SCALE"].double, look.constants.cloudScale)
    XCTAssertEqual(c["CLOUD_DRIFT"].double, look.constants.cloudDrift)
    let saved = look.windOffset
    defer { look.windOffset = saved }
    for w in try v.data["wind"].requireArray("wind") {
      let off = try w["windOffset"].doublesOrFail("windOffset")
      look.windOffset = V2(off[0], off[1])
      var gust = [Double](), cloud = [Double]()
      for z in axis {
        for x in axis {
          gust.append(look.gustField(x, z))
          cloud.append(look.cloudAt(x, z))
        }
      }
      assertBitEqual(gust, try w["gustField"].doublesOrFail("gustField"), "gustField windOffset \(off)")
      assertBitEqual(cloud, try w["cloudAt"].doublesOrFail("cloudAt"), "cloudAt windOffset \(off)")
    }
  }

  func testFrontsAt() throws {
    let v = try VectorLoader.load("look/fields")
    let look = try exportedLook()
    let axis = try v.data["grid"]["axis"].doublesOrFail("grid.axis")
    defer { look.setFronts([]) }
    for set in try v.data["fronts"].requireArray("fronts") {
      var fronts = [GustFront]()
      for f in try set["fronts"].requireArray("fronts") {
        fronts.append(GustFront(
          x: try f["x"].doubleOrFail("x"), z: try f["z"].doubleOrFail("z"),
          dirX: try f["dirX"].doubleOrFail("dirX"), dirZ: try f["dirZ"].doubleOrFail("dirZ"),
          strength: try f["strength"].doubleOrFail("strength"),
          width: f["width"].double, length: f["length"].double))
      }
      look.setFronts(fronts)
      XCTAssertEqual(look.fronts.count, fronts.filter { $0.strength > 0 }.count)
      var got = [Double]()
      for z in axis { for x in axis { got.append(look.frontsAt(x, z)) } }
      assertBitEqual(got, try set["frontsAt"].doublesOrFail("frontsAt"), "frontsAt \(fronts.count) fronts")
    }
  }

  func testSetFrontsUniformMirror() throws {
    let look = Look(atlas: LookTexture(size: 1, data: [0, 0, 0, 0]), detail: LookTexture(size: 1, data: [0, 0, 0, 0]),
                    lace: LookTexture(size: 1, data: [0, 0, 0, 0]))
    look.setFronts([GustFront(x: 1, z: 2, dirX: 0, dirZ: 1, strength: 3), GustFront(x: 5, z: 6, dirX: 1, dirZ: 0, strength: 0, width: 50)])
    XCTAssertEqual(look.gustFrontsA[0], SIMD4<Double>(1, 2, 0, 1))
    XCTAssertEqual(look.gustFrontsB[0], SIMD4<Double>(3, 140, 500, 0))
    XCTAssertEqual(look.gustFrontsB[1].x, 0)
    XCTAssertEqual(look.gustFrontsB[1].y, 140) // inactive slot keeps the previous width/length
    look.setWind(V2(2, -1), 0.5)
    look.setWind(V2(2, -1), 0.5)
    XCTAssertEqual(look.windOffset, V2(2, -1))
  }
}
