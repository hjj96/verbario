// Time-stepped parity of Survivors + Effects against the web (Tests/Vectors/survivors/run_*.json, made by
// tools/export/export-survivors.mjs): every state part digest of every frame, the render buffers every 10th
// frame, the event log, the winch read-back (nearestFor), the boarded records and the camera shakes.
import XCTest
@testable import MaydayCore

final class SurvivorsRunTests: XCTestCase {
  func replay(_ id: String, file: StaticString = #filePath, line: UInt = #line) throws {
    let run = try SurvivorsRun("survivors/run_\(id)")
    let bad = try run.run()
    for m in bad { XCTFail("\(id) frame \(m.frame) part \(m.part): \(m.detail)", file: file, line: line) }
    if !bad.isEmpty { return }
    let d = run.vec.data
    // events (ids instead of objects)
    let want = d["events"].array ?? []
    XCTAssertEqual(run.eventLog.count, want.count, "\(id): event count", file: file, line: line)
    for (k, (g, w)) in zip(run.eventLog, want).enumerated() {
      if let diff = SurvivorsRun.jsonDiff(g, w) {
        XCTFail("\(id): event #\(k) \(diff)", file: file, line: line)
        break
      }
    }
    // the winch read-back
    let near = d["nearest"].array ?? []
    XCTAssertEqual(run.nearest.count, near.count, "\(id): nearestFor samples", file: file, line: line)
    for (g, w) in zip(run.nearest, near) where !jsonEqualBitwise(g, w) {
      XCTFail("\(id): nearestFor got \(g), expected \(w)", file: file, line: line)
      break
    }
    // boardOne() records
    XCTAssertEqual(run.boardChecks.count, (d["calls"].array ?? []).filter { $0[1]["op"].string == "board" }.count, file: file, line: line)
    for c in run.boardChecks {
      if let diff = SurvivorsRun.jsonDiff(c.got, c.want) { XCTFail("\(id) frame \(c.frame): boarded record \(diff)", file: file, line: line) }
    }
    // checkpoints: the Swift snapshot (snapCarrier / snapSignals / groups) equals the web's
    for c in run.checkpointChecks {
      if let diff = SurvivorsRun.jsonDiff(c.got, c.want) { XCTFail("\(id) frame \(c.frame): checkpoint \(diff)", file: file, line: line) }
    }
    // camera shakes (hail)
    let sh = d["shakes"].array ?? []
    XCTAssertTrue(jsonEqualBitwise(.array(run.shakes), .array(sh)), "\(id): camera shakes", file: file, line: line)
  }

  /// op1 «Первый вылет»: the prepared campaign def, a pilot lifting both kayakers and the raft crew of three,
  /// the scripted rockets, the loudspeaker and a player flare, a landing.
  func testOp1() throws { try replay("op1") }

  /// night: strobes, a handheld flare, searchlight / FLIR / flare spotting, a raft capsized by the downwash, a
  /// dropped life raft, a stretcher case, two lost to the cold, a pending group, fog, lightning, a pause.
  func testNight() throws { try replay("night") }

  /// core: every carrier in a rough sea, whirlpool / rogue crest / surface flow, the bottle, smoke / dye / mirror,
  /// hail, a waterspout warning, a slip off the cable, a pause.
  func testCore() throws { try replay("core") }
}
