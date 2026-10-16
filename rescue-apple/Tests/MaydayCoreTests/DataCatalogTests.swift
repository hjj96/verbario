// Resources/Data loader: manifest integrity, wrapper fields, typed schemas vs compiled-in constants,
// and the exact JSON reader.
import XCTest
@testable import MaydayCore

final class DataCatalogTests: XCTestCase {
  func testManifestFilesAllVerify() throws {
    let catalog = try VectorLoader.catalog()
    XCTAssertEqual(catalog.formatVersion, 1)
    XCTAssertFalse(catalog.entries.isEmpty)
    XCTAssertEqual(catalog.verifyAll(), [], "size/sha256 mismatches against manifest.json")
    for name in ["look", "ocean", "game"] { XCTAssertNotNil(catalog.entry(named: name), "manifest lacks \(name).json") }
  }

  func testEveryDataDocumentParsesWithItsSchema() throws {
    let catalog = try VectorLoader.catalog()
    XCTAssertGreaterThanOrEqual(catalog.dataNames.count, 20)
    for name in catalog.dataNames {
      let doc = try catalog.document(name)
      XCTAssertEqual(doc.schema, "mayday." + name, "\(name).json schema")
      XCTAssertEqual(doc.version, 1)
      XCTAssertEqual(doc.source, catalog.webRevision, "\(name).json exported from another web revision")
      XCTAssertTrue(doc.data.exists, "\(name).json has no data")
    }
  }

  func testLookDataMatchesCompiledConstants() throws {
    let look = try LookData(catalog: try VectorLoader.catalog())
    XCTAssertEqual(look.constants, LookConstants.web)
    XCTAssertEqual(Set(look.textures.keys), ["atlas", "detail", "lace"])
    XCTAssertEqual(look.textures["lace"]?.width, 512)
  }

  func testOceanDataMatchesCompiledConstants() throws {
    let ocean = try OceanData(catalog: try VectorLoader.catalog())
    XCTAssertEqual(ocean.waves, WaveConstants.web)
    XCTAssertEqual(ocean.coastMax, CoastMap.COAST_MAX)
    XCTAssertEqual(ocean.maxFeatures, FeatureSet.MAX_FEATURES)
    XCTAssertEqual(ocean.rogueScarLife, FeatureSet.ROGUE_SCAR_LIFE)
    XCTAssertEqual(ocean.featureFadeOut, FeatureSet.FADE_OUT)
    XCTAssertEqual(ocean.featureType, ["rogue": 1, "vortex": 2, "whirlpool": 3])
    XCTAssertEqual(ocean.waves.quality["high"]?.grid, 300)
  }

  func testGameSeeds() throws {
    let game = try VectorLoader.catalog().data("game")
    XCTAssertEqual(game["derived"]["ctx"]["rngSeed"].double, 1337)
    XCTAssertEqual(game["derived"]["loop"]["dtCap"].double, 0.1)
  }

  // ---- JSON reader --------------------------------------------------------------------------------
  func testJSONNumbersAreCorrectlyRounded() throws {
    let v = try JSONValue.parse(#"[0.1, 0.30000000000000004, 5e-324, 1.7976931348623157e308, -0, "-0", "NaN", "Infinity", "-Infinity", 9007199254740993, 2.2250738585072011e-308, 0.8550496697425842]"#)
    let d = try XCTUnwrap(v.doubles)
    assertBitEqual(d[0], 0.1, "0.1")
    assertBitEqual(d[1], 0.1 + 0.2, "0.30000000000000004")
    assertBitEqual(d[2], Double.leastNonzeroMagnitude, "5e-324")
    assertBitEqual(d[3], Double.greatestFiniteMagnitude, "max")
    assertBitEqual(d[4], -0.0, "-0 literal")
    assertBitEqual(d[5], -0.0, "\"-0\"")
    XCTAssertTrue(d[6].isNaN)
    XCTAssertEqual(d[7], .infinity)
    XCTAssertEqual(d[8], -.infinity)
    assertBitEqual(d[9], 9007199254740992, "2^53 + 1 rounds to even")
    assertBitEqual(d[10], Double(bitPattern: 0x000F_FFFF_FFFF_FFFF), "largest subnormal")
    assertBitEqual(d[11], Double(Float(0.8550496988830434)), "a Float32 value written as double")
  }

  func testJSONStringsAndOrder() throws {
    let v = try JSONValue.parse(#"{"b": "a b\n\"q\" 🚀 Шквал", "a": [true, false, null], "c": {}}"#)
    XCTAssertEqual(v.object?.keys, ["b", "a", "c"])
    XCTAssertEqual(v["b"].string, "a\u{00A0}b\n\"q\" \u{1F680} Шквал")
    XCTAssertEqual(v["a"][0].bool, true)
    XCTAssertTrue(v["a"][2].isNull)
    XCTAssertTrue(v["missing"]["deeper"][3].isNull)
    XCTAssertEqual(v.at("a.1").bool, false)
    XCTAssertThrowsError(try JSONValue.parse("[1, 2"))
    XCTAssertThrowsError(try JSONValue.parse("{\"a\" 1}"))
    XCTAssertThrowsError(try JSONValue.parse("01x"))
  }

  func testSHA256KnownAnswers() {
    XCTAssertEqual(SHA256.hex([UInt8]()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    XCTAssertEqual(SHA256.hex(Array("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    XCTAssertEqual(SHA256.hex(Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)),
                   "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
  }
}
