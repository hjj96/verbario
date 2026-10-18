// core/settings.js (Settings, loadProgress, saveProgress) vs Tests/Vectors/settings/settings.json:
// the web's own Settings class constructed over stubbed localStorage / matchMedia / location.search
// and driven by scripted set() / onChange() calls (export-core.mjs). Stored strings are compared byte
// for byte, listener calls in order, numbers bit for bit, the live BINDINGS structurally.
import XCTest
@testable import MaydayCore

final class SettingsTests: XCTestCase {
  private let key = SettingsDefaults.web.key
  private let progressKey = SettingsDefaults.web.progressKey

  /// URLSearchParams(search).get('quality'): the first `quality=` pair, nil when absent.
  private func qualityParam(_ search: String) -> String? {
    var s = Substring(search)
    if s.hasPrefix("?") { s = s.dropFirst() }
    for pair in s.split(separator: "&", omittingEmptySubsequences: true) {
      let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      if kv[0] == "quality" { return kv.count > 1 ? String(kv[1]) : "" }
    }
    return nil
  }

  /// One probe row: ['probe', JSON.stringify(values), stored|null, pixelRatioCap(), detail(), autoAssist(), BINDINGS].
  private func probe(_ s: GameSettings, _ store: MemoryStorage, _ b: Bindings) -> [JSONValue] {
    [.string("probe"), .string(JSONValue.object(s.values).jsonStringify()), store.items[key].map(JSONValue.string) ?? .null,
     .number(s.pixelRatioCap()), .number(s.detail()), .string(s.autoAssist()), InputTests.bindingsJSON(b)]
  }

  /// Rows compared as: strings / bools / null by value, numbers by bits, objects structurally; a
  /// listener value (JSON-round-tripped in the exporter) by its JSON.stringify.
  private func assertRow(_ got: [JSONValue], _ want: JSONValue, _ at: String, file: StaticString = #filePath, line: UInt = #line) throws {
    let w = try want.requireArray(at)
    guard got.count == w.count else {
      XCTFail("\(at): \(got.map { $0.jsonStringify() }) != \(want.jsonStringify())", file: file, line: line)
      return
    }
    for (i, (g, x)) in zip(got, w).enumerated() {
      if got[0] == .string("call") && i == 3 {
        XCTAssertEqual(g.jsonStringify(), x.jsonStringify(), "\(at) [\(i)]", file: file, line: line)
      } else if case .number(let gd) = g {
        assertBitEqual(gd, try x.requireDouble(), "\(at) [\(i)]", file: file, line: line)
      } else {
        XCTAssertEqual(g, x, "\(at) [\(i)]", file: file, line: line)
      }
    }
  }

  func testCasesMatchTheWebSettings() throws {
    let v = try VectorLoader.load("settings/settings")
    let cases = try v.data["cases"].requireArray("cases")
    XCTAssertGreaterThan(cases.count, 25)
    var rows = 0
    for c in cases {
      let id = try c["id"].requireString("id")
      let store = MemoryStorage(unavailable: c["unavailable"].jsTruthy)
      if let raw = c["stored"].string { store.items[key] = raw }
      let env = SettingsEnvironment(prefersReducedMotion: c["reduced"].jsTruthy, coarsePointer: c["coarse"].jsTruthy,
                                    qualityOverride: c["search"].string.flatMap(qualityParam), touchQuality: "low")
      let bindings = Bindings()
      let s = GameSettings(storage: store, environment: env, bindings: bindings)
      var log = [[JSONValue]]()
      log.append(probe(s, store, bindings))

      var offs = [String: SettingsSubscription]()
      func listen(_ lid: String, _ behaviors: [JSONValue]) {
        offs[lid] = s.onChange { k, value in
          log.append([.string("call"), .string(lid), .string(k), value])
          for b in behaviors where b["when"] == .string(k) {
            if b["set"].exists { s.set((try? b["set"][0].requireString()) ?? "", b["set"][1]) }
            if let off = b["off"].string { offs[off]?.off() }
            if b["listen"].exists { listen((try? b["listen"][0].requireString()) ?? "", b["listen"][1].array ?? []) }
          }
        }
      }
      for a in c["actions"].array ?? [] {
        switch try a[0].requireString("action") {
        case "listen": listen(try a[1].requireString(), a[2].array ?? [])
        case "off": offs[try a[1].requireString()]?.off()
        case "set", "setNaN":
          s.set(try a[1].requireString(), a[0] == .string("setNaN") ? .number(.nan) : a[2])
          log.append([.string("stored"), store.items[key].map(JSONValue.string) ?? .null])
        case "probe": log.append(probe(s, store, bindings))
        case let other: throw VectorError("\(id): unknown action \(other)")
        }
      }
      let want = try c["log"].requireArray("log")
      XCTAssertEqual(log.count, want.count, "\(id): log length")
      for (i, (g, w)) in zip(log, want).enumerated() { try assertRow(g, w, "\(id) log[\(i)]") }
      rows += log.count
    }
    XCTAssertGreaterThan(rows, 60)
  }

  func testProgressStore() throws {
    let v = try VectorLoader.load("settings/settings")
    let p = v.data["progress"]
    let inputs = try p["saveInputs"].requireArray("saveInputs")
    var saveIndex = 0
    for r in try p["rows"].requireArray("rows") {
      switch try r[0].requireString() {
      case "load":
        let store = MemoryStorage()
        if let raw = r[1].string { store.items[progressKey] = raw }
        XCTAssertEqual(ProgressStore(storage: store).load().jsonStringify(), try r[2].requireString(), "load \(r[1].jsonStringify())")
      case "load-unavailable":
        XCTAssertEqual(ProgressStore(storage: MemoryStorage(unavailable: true)).load().jsonStringify(), try r[2].requireString())
        XCTAssertEqual(ProgressStore(storage: nil).load().jsonStringify(), "{}")
      case "save":
        // the exact inputs: JSON texts, and one object JSON cannot spell (NaN / -Infinity / -0)
        let data: JSONValue
        if let text = inputs[saveIndex].string, let parsed = try? JSONValue.parse(text) {
          data = parsed
        } else {
          var o = JSONObject()
          o.set("nan", .number(.nan))
          o.set("inf", .number(-.infinity))
          o.set("nz", .number(-0.0))
          data = .object(o)
        }
        saveIndex += 1
        let store = MemoryStorage()
        ProgressStore(storage: store).save(data)
        XCTAssertEqual(store.items[progressKey], try r[2].requireString(), "save #\(saveIndex)")
        ProgressStore(storage: MemoryStorage(unavailable: true)).save(data) // failures are swallowed
      case let other: XCTFail("unknown progress row \(other)")
      }
    }
    XCTAssertEqual(saveIndex, inputs.count)
  }

  /// settings.json (the data the app ships) agrees with the compiled-in defaults and tiers.
  func testDefaultsMatchSettingsData() throws {
    let json = try VectorLoader.catalog().data("settings")
    XCTAssertEqual(try SettingsDefaults(json: json), SettingsDefaults.web)
  }

  /// The port's own environment hooks (PLAN §10 X5): touch devices start on the quality the app
  /// passes; an explicit launch quality and saved settings win.
  func testTouchQualityAndChangeNotifications() {
    let store = MemoryStorage()
    let s = GameSettings(storage: store, environment: SettingsEnvironment(coarsePointer: true, touchQuality: "medium"))
    XCTAssertEqual(s.quality, "medium")
    XCTAssertEqual(s.pixelRatioCap(), 1.25)
    XCTAssertEqual(s.string("assist"), "full", "touch: stabilisation «Полная» while not chosen")
    var calls = [String]()
    let sub = s.onChange { k, _ in calls.append(k) }
    s.set("difficulty", "ace")
    XCTAssertEqual(calls, ["difficulty"], "assist stays full on touch: no second notification")
    s.set("assistExplicit", true)
    s.set("assist", "off")
    sub.off()
    s.set("masterVolume", 0.5)
    XCTAssertEqual(calls, ["difficulty", "assistExplicit", "assist"])
    XCTAssertEqual(s.number("masterVolume"), 0.5)
    XCTAssertFalse(s.flag("reduceMotion"))
    // a second launch reads the saved file: no first-run rules any more
    let again = GameSettings(storage: store, environment: SettingsEnvironment(prefersReducedMotion: true, coarsePointer: true, touchQuality: "low"))
    XCTAssertEqual(again.quality, "medium")
    XCTAssertEqual(again.string("assist"), "off")
    XCTAssertFalse(again.flag("reduceMotion"))
    let launched = GameSettings(storage: store, environment: SettingsEnvironment(qualityOverride: "low"))
    XCTAssertEqual(launched.quality, "low")
    XCTAssertEqual(launched.detail(), 0.35)
  }
}
