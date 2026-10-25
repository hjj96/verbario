// Static parity vectors of the survivors' helpers (tools/export/export-survivors.mjs):
//   survivors/people.json  makeFallbackPeople / feminize / guessGender / conditionFor / quoteFor sequences
//   survivors/poses.json   poseTargets on a grid, variant, applyPose along a ragged schedule
// All bit-exact (strings byte-exact).
import XCTest
@testable import MaydayCore

final class SurvivorStaticTests: XCTestCase {
  static func tables() throws -> SurvivorTables { try SurvivorTables(catalog: try VectorLoader.catalog()) }

  // ---- people.js ------------------------------------------------------------------------------------------
  func testFallbackPeople() throws {
    let tables = try Self.tables()
    let d = try VectorLoader.load("survivors/people").data
    let cases = try d["fallback"].requireArray("fallback")
    XCTAssertGreaterThan(cases.count, 60)
    for c in cases {
      let seed = try c["seed"].requireDouble("seed")
      let type = try c["type"].requireString("type")
      let count = try c["count"].requireInt("count")
      let got = SurvivorPeople.makeFallbackPeople(tables, seed: seed, type: type, count: count)
      let want = try c["people"].requireArray("people").map { try XCTUnwrap(PersonRecord(json: $0)) }
      XCTAssertEqual(got, want, "makeFallbackPeople(\(seed), \(type), \(count))")
    }
  }

  func testFeminizeGenderCondition() throws {
    let d = try VectorLoader.load("survivors/people").data
    for p in try d["feminize"].requireArray() {
      XCTAssertEqual(SurvivorPeople.feminize(try p[0].requireString()), try p[1].requireString(), "feminize(\(p[0]))")
    }
    for p in try d["guessGender"].requireArray() {
      XCTAssertEqual(SurvivorPeople.guessGender(p[0].string), try p[1].requireString(), "guessGender(\(p[0]))")
    }
    for p in try d["conditionFor"].requireArray() {
      let w = try p[0].requireDouble()
      let inj = p[1].bool ?? false
      XCTAssertEqual(SurvivorPeople.conditionFor(w, inj), try p[2].requireString(), "conditionFor(\(w), \(inj))")
    }
  }

  func testQuoteSequences() throws {
    let tables = try Self.tables()
    let d = try VectorLoader.load("survivors/people").data
    for q in try d["quotes"].requireArray() {
      let rng = Rng(seed: try q["seed"].requireDouble())
      var used = Set<String>()
      for (k, step) in try q["seq"].requireArray().enumerated() {
        let g = try step[0].requireString()
        let tags = try XCTUnwrap(step[1].strings)
        let got = SurvivorPeople.quoteFor(tables, rng, g, tags, &used)
        XCTAssertEqual(got, try step[2].requireString(), "quote seed \(q["seed"]) #\(k) \(tags)")
      }
    }
  }

  // ---- three.js uuid draws -----------------------------------------------------------------------------------
  /// ThreeObjectCosts (the Math.random draws three.js spends on the uuids of objects survivors.js builds at
  /// runtime) against the counts measured on the web code.
  func testThreeObjectCosts() throws {
    let d = try VectorLoader.load("survivors/three_costs").data
    let c = ThreeObjectCosts()
    XCTAssertEqual(c.groupObject, try d["groupObject"].requireInt())
    for style in ["boat", "yacht"] {
      XCTAssertEqual(c.hullDecal, try d["hullNext"][style].requireInt(), "hull decal \(style)")
      XCTAssertEqual(c.hullDecal + c.hullNameGeometry, try d["hullFirst"][style].requireInt(), "first hull decal \(style)")
    }
    XCTAssertEqual(c.planeDecal, try d["planeDecal"].requireInt())
    for model in ["ferry", "trawler"] { XCTAssertEqual(c.wreckDecal, try d["wreckDecal"][model].requireInt(), "wreck decal \(model)") }
    for model in ["barge", "ferry", "trawler"] {
      XCTAssertEqual(c.bigBatch[model], try d["bigBatch"][model].requireInt(), "big batch \(model)")
      XCTAssertEqual(c.bigBatch[model], try d["bigBatchOtherDeck"][model].requireInt(), "big batch \(model) (another deck height)")
      XCTAssertEqual(0, try d["bigBatchAgain"][model].requireInt(), "a cached big batch \(model) draws nothing")
    }
  }

  // ---- poses.js -------------------------------------------------------------------------------------------
  func testPoseNumbering() throws {
    let d = try VectorLoader.load("survivors/poses").data
    let pose = try d["POSE"].requireObject("POSE")
    XCTAssertEqual(pose.count, SurvivorPose.allCases.count)
    for p in SurvivorPose.allCases { XCTAssertEqual(pose[p.name]?.int, p.rawValue, p.name) }
  }

  func testPoseTargetsGrid() throws {
    let v = try VectorLoader.load("survivors/poses")
    let rows = try v.sidecarF64(v.data["grid"])
    let w = 10
    XCTAssertEqual(rows.count % w, 0)
    var got = [Double](), want = [Double]()
    for r in stride(from: 0, to: rows.count, by: w) {
      let pose = try XCTUnwrap(SurvivorPose(rawValue: Int(rows[r])))
      let a = SurvivorPoses.targets(pose, phase: rows[r + 1], waveArm: rows[r + 2], legFold: rows[r + 3], t: rows[r + 4], ringN: rows[r + 5])
      got += [a.aL, a.pL, a.aR, a.pR]
      want += Array(rows[(r + 6)..<(r + 10)])
    }
    assertBitEqual(got, want, "poseTargets grid")
  }

  func testVariantAndApply() throws {
    let v = try VectorLoader.load("survivors/poses")
    for row in try v.data["variants"].requireArray() {
      let r = try row.requireDoubles()
      XCTAssertEqual(SurvivorPoses.variant(r[0], 5), Int(r[1]), "variant(\(r[0]), 5)")
      XCTAssertEqual(SurvivorPoses.variant(r[0], 3), Int(r[2]), "variant(\(r[0]), 3)")
    }
    let rows = try v.sidecarF64(v.data["apply"])
    var cur = ArmAngles(0.8, 0.5, 0.8, 0.5)
    var t = 0.0
    var got = [Double](), want = [Double]()
    for r in stride(from: 0, to: rows.count, by: 6) {
      let dt = rows[r]
      t += dt
      let pose = try XCTUnwrap(SurvivorPose(rawValue: Int(rows[r + 1])))
      SurvivorPoses.apply(&cur, SurvivorPoses.targets(pose, phase: 1.234, waveArm: -1, legFold: 0, t: t, ringN: 4), dt)
      got += [cur.aL, cur.pL, cur.aR, cur.pR]
      want += Array(rows[(r + 2)..<(r + 6)])
    }
    assertBitEqual(got, want, "applyPose schedule")
  }
}
