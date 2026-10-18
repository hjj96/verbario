// systems/weather.js (+ weather/{gusts,lightning,lights,env,endless}.js) vs Node 22: the time-stepped runs
// of Tests/Vectors/weather/run_*.json and endless_20min.json (tools/export/export-sim.mjs). Every frame
// is compared through the running hash; the rows name the first divergent field; events, env bakes and
// API query results are compared exactly.
import XCTest
@testable import MaydayCore

final class WeatherSimTests: XCTestCase {
  /// Replays one run and reports the first divergence (frame and field) instead of thousands of failures.
  private func check(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws {
    let r = try WeatherRun(name)
    let fields = try r.v.data["fields"].strings.orThrow("fields")
    let got = try r.run()
    let probeCount = r.probe().count
    XCTAssertEqual(probeCount, fields.count, "\(name): probe has \(probeCount) fields, export \(fields.count)", file: file, line: line)

    // rows: first divergent row / field
    let rowsRef = r.v.data["rows"]
    let want = try r.v.sidecarF64(rowsRef)
    let every = try r.v.data["every"].int.orThrow("every")
    let width = fields.count
    XCTAssertEqual(got.rows.count * width, want.count, "\(name): row count", file: file, line: line)
    var rowFail: String?
    rows: for (i, row) in got.rows.enumerated() where (i + 1) * width <= want.count {
      for k in 0..<min(width, row.count) where !Bits.equal(row[k], want[i * width + k]) {
        rowFail = "frame \((i + 1) * every - 1) field \(fields[k]): \(Bits.describe(row[k], want[i * width + k]))"
        break rows
      }
    }
    if let m = rowFail { XCTFail("\(name): first divergent row — \(m)", file: file, line: line) }

    // hashes: first divergent frame (localises a difference between rows)
    let wantHash = try r.v.sidecarBytes(r.v.data["hashes"])
    let hashEvery = try r.v.data["hashEvery"].int.orThrow("hashEvery")
    var hashes = [UInt32]()
    for i in stride(from: 0, to: wantHash.count, by: 4) {
      hashes.append(UInt32(wantHash[i]) | UInt32(wantHash[i + 1]) << 8 | UInt32(wantHash[i + 2]) << 16 | UInt32(wantHash[i + 3]) << 24)
    }
    XCTAssertEqual(got.hashes.count, hashes.count, "\(name): hash count", file: file, line: line)
    if let i = zip(got.hashes, hashes).enumerated().first(where: { $0.element.0 != $0.element.1 })?.offset {
      XCTFail("\(name): state diverges at frame \((i + 1) * hashEvery - 1) (hash \(got.hashes[i]) vs \(hashes[i]))", file: file, line: line)
      // frame-0 diagnostics: which part of the hashed state differs
      if let ff = r.firstFrame {
        let first = r.v.data["firstFrame"]
        for (k, a) in [("probe", ff.probe), ("from", ff.from), ("cur", ff.cur), ("out", ff.out)] {
          if let b = first[k].doubles { assertBitEqual(a, b, "\(name) frame 0 \(k)", file: file, line: line) }
        }
      }
    }

    // events, bakes, queries
    try compareList(name, "events", r.log, r.v.data["events"], file: file, line: line)
    try compareList(name, "bakes", r.bakes, r.v.data["bakes"], file: file, line: line)
    try compareList(name, "queries", r.queries, r.v.data["queries"], file: file, line: line)
  }

  private func compareList(_ name: String, _ what: String, _ got: [JSONValue], _ want: JSONValue,
                           file: StaticString, line: UInt) throws {
    let w = try want.array.orThrow(what)
    XCTAssertEqual(got.count, w.count, "\(name): \(what) count", file: file, line: line)
    for (i, (a, b)) in zip(got, w).enumerated() where !jsonEqual(a, b) {
      XCTFail("\(name): \(what)[\(i)] differs:\n  got  \(a)\n  want \(b)", file: file, line: line)
      return
    }
  }

  /// calm → overcast → storm script with a wind shift and a spatial front; scripted gusts, a charge,
  /// green tint, hail, obstacles attracting sea strikes, forecasts and checkpoints.
  func testCalmToStorm() throws { try check("run_calm_to_storm") }

  /// Checkpoint restores (restoreCheckpoint with the snap taken mid-transition by the run above).
  func testRestoreFromCheckpoints() throws {
    var n = 0
    while VectorLoader.exists("weather/run_restore_\(n)") {
      try check("run_restore_\(n)")
      n += 1
    }
    XCTAssertGreaterThan(n, 0, "no run_restore_* vectors")
  }

  /// Night storm with reduceFlashes (soft envelope, 1.5 s gap) toggled live, cadet telegraphs, heli above
  /// 70 m (heli-targeted charges), the eye of the storm, a quality change mid-run.
  func testNightStormReducedFlashes() throws { try check("run_night_storm") }

  /// ?weather=fog&tod=1.3: forced preset and time of day (scripts disabled), green tint, setPreset.
  func testForcedFog() throws { try check("run_fog") }

  /// Title showcase cycle (attract) with its night-storm bolts, then leaving the title.
  func testAttractCycle() throws { try check("run_attract") }

  /// «Смена»: 20 min of endless escalation (day → sunset → night), forecasts every 30 s.
  func testEndless20Minutes() throws { try check("endless_20min") }
}

final class WeatherHashTests: XCTestCase {
  /// The run hash is the exporter's FNV-1a 32 (fnv(2166136261, [1, 2, NaN, -0, 0.1, 1e300]) in Node 22).
  func testFNVMatchesExporter() {
    XCTAssertEqual(FNV.mix(FNV.offset, [1, 2, .nan, -0.0, 0.1, 1e300]), 2_741_836_170)
  }
}
