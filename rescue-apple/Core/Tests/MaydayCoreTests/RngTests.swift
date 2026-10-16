// mulberry32 / LCG / seed formulas vs Node 22: Tests/Vectors/math/rng.json, lcg.json.
import XCTest
@testable import MaydayCore

final class RngTests: XCTestCase {
  func testMulberrySequences() throws {
    let v = try VectorLoader.load("math/rng")
    let seqs = try v.data["sequences"].requireArray("sequences")
    XCTAssertGreaterThanOrEqual(seqs.count, 20)
    for s in seqs {
      let seed = try s["seed"].doubleOrFail("seed")
      let want = try s["next"].doublesOrFail("next")
      var r = Mulberry32(seed: seed)
      let got = (0..<want.count).map { _ in r.next() }
      assertBitEqual(got, want, "createRng(\(seed)).next()")
    }
  }

  func testApiCalls() throws {
    let v = try VectorLoader.load("math/rng")
    let api = v.data["api"]
    let ops = api["ops"]
    let range = try ops["range"].doublesOrFail("ops.range")
    let intR = try ops["int"].doublesOrFail("ops.int")
    guard let pick = ops["pick"].strings else { throw VectorError("ops.pick: expected strings") }
    let chanceP = try ops["chance"].doubleOrFail("ops.chance")
    for c in try api["cases"].requireArray("cases") {
      let seed = try c["seed"].doubleOrFail("seed")
      let rng = Rng(seed: seed)
      let calls = try c["calls"].requireArray("calls")
      XCTAssertGreaterThan(calls.count, 100)
      for (i, call) in calls.enumerated() {
        let op = call[0].string ?? ""
        let want = call[1]
        let label = "seed \(seed) call \(i) \(op)"
        if op == "chance" {
          XCTAssertEqual(rng.chance(chanceP), want.bool, label)
          continue
        }
        let w = try want.doubleOrFail(label)
        switch op {
        case "next": assertBitEqual(rng.next(), w, label)
        case "range": assertBitEqual(rng.range(range[0], range[1]), w, label)
        case "int": assertBitEqual(rng.int(intR[0], intR[1]), w, label)
        case "pick":
          let p = rng.pick(pick)
          let idx = p.flatMap { pick.firstIndex(of: $0) } ?? -1
          XCTAssertEqual(Double(idx), w, label)
        case "sign": assertBitEqual(rng.sign(), w, label)
        case "gauss": assertBitEqual(rng.gauss(), w, label)
        default: XCTFail("unknown op \(op)")
        }
      }
    }
  }

  func testSeedFormulas() throws {
    let v = try VectorLoader.load("math/rng")
    let sf = v.data["seedFormulas"]
    let seeds = try sf["missionSeeds"].doublesOrFail("missionSeeds")
    var seen = Set<String>()
    for f in try sf["formulas"].requireArray("formulas") {
      let id = f["id"].string ?? ""
      seen.insert(id)
      let want = try f["values"].doublesOrFail(id)
      let got: [Double] = seeds.map { s in
        switch id {
        case "weather": return Double(SeedFormulas.weather(s))
        case "hazards": return Double(SeedFormulas.hazards(s))
        case "survivors": return Double(SeedFormulas.survivors(s))
        case "oceanSeed": return SeedFormulas.oceanSeed(s)
        case "oceanSwellOffsetRad": return SeedFormulas.oceanSwellOffset(s)
        case "peopleFallback": return SeedFormulas.peopleFallback(s, id: 3)
        default: return .nan
        }
      }
      assertBitEqual(got, want, "seed formula \(id)")
    }
    XCTAssertTrue(seen.isSuperset(of: ["weather", "hazards", "survivors", "oceanSeed", "oceanSwellOffsetRad", "peopleFallback"]))
  }

  func testLCG() throws {
    let v = try VectorLoader.load("math/lcg")
    for group in ["numerical", "ansiC"] {
      let g = v.data[group]
      let mul = try g["mul"].doubleOrFail("\(group).mul")
      let add = try g["add"].doubleOrFail("\(group).add")
      for c in try g["cases"].requireArray("\(group).cases") {
        let seed = try c["seed"].doubleOrFail("seed")
        let want = try c["states"].doublesOrFail("states")
        var lcg = JSLCG(mul: mul, add: add, seed: seed)
        let got = (0..<want.count).map { _ in Double(lcg.step()) }
        assertBitEqual(got, want, "\(group) LCG seed \(seed)")
      }
    }
  }

  func testRngIsValueTypeAndRepeatable() {
    var a = Mulberry32(seed: 4242)
    var b = a
    XCTAssertEqual(a.next(), b.next())
    XCTAssertEqual(Mulberry32(seed: -1).state, 4294967295) // -1 >>> 0
    XCTAssertEqual(Mulberry32(seed: 4294967296 + 5).state, 5)
  }
}
