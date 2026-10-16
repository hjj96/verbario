// main.js frame() contract (Tests/Vectors/core/loop.json: the web's own frame(), startWarmup and
// setMode sources run over recording stubs) and the loop rules in game.json.
import XCTest
@testable import MaydayCore

final class GameLoopTests: XCTestCase {
  /// A system that records update(dt) into the shared log and can be told to fail.
  private final class Recorder: GameSystem {
    let key: SystemKey
    let log: (_ row: [String]) -> Void
    var failing = false
    weak var loop: GameLoop?

    init(_ key: SystemKey, _ log: @escaping ([String]) -> Void) {
      self.key = key
      self.log = log
    }

    func update(_ dt: Double) {
      log(["update", key.rawValue, JSNumber.toString(dt)])
      // the web's update throws after logging; the loop then disables the system
      if failing { loop?.disable(key, reason: "\(key.rawValue) broke") }
    }
  }

  private func text(_ v: JSONValue) -> String {
    if let s = v.string, v.double == nil { return s }
    if let d = v.double { return JSNumber.toString(d) }
    if let b = v.bool { return b ? "true" : "false" }
    return "\(v)"
  }

  func testFramesMatchTheWebLoop() throws {
    let v = try VectorLoader.load("core/loop")
    let scripts = try v.data["scripts"].requireArray("scripts")
    XCTAssertEqual(scripts.count, 4)
    for script in scripts {
      let id = try script["id"].requireString("id")
      XCTAssertEqual(try script["order"].requireArray("order").map { try $0.requireString() }, LoopRules.web.systems.map(\.rawValue), id)
      XCTAssertEqual(Set(try script["runWhenPaused"].requireArray("rwp").map { try $0.requireString() }),
                     Set(LoopRules.web.runWhenPaused.map(\.rawValue)), id)
      let mode = GameMode(rawValue: try script["mode"].requireString("mode")) ?? .title
      let bus = EventBus()
      var log = [[String]]()
      let record: ([String]) -> Void = { log.append($0) }
      let loop = GameLoop(events: bus, mode: mode, startMs: try script["start"].requireDouble("start"))
      loop.setTime = { t in record(["setTime", JSNumber.toString(t)]) }
      loop.pollInput = { record(["poll"]) }
      loop.log = { msg in record(["error", msg.components(separatedBy: ": ").first ?? msg]) }
      bus.on(.gameMode) { e in
        if case .gameMode(let p) = e { record(["game:mode", p.from.rawValue, p.to.rawValue]) }
      }
      let noUpdate = Set((script["noUpdate"].array ?? []).compactMap { $0.string })
      var recorders = [SystemKey: Recorder]()
      for key in SystemKey.allCases where !noUpdate.contains(key.rawValue) {
        let r = Recorder(key, record)
        r.loop = loop
        recorders[key] = r
        loop.register(key, r)
      }
      var compilePending = false
      for (i, f) in try script["frames"].requireArray("frames").enumerated() {
        let at = "\(id) frame \(i)"
        for a in f["before"].array ?? [] {
          switch try a[0].requireString() {
          case "setMode": loop.setMode(GameMode(rawValue: try a[1].requireString())!)
          case "timeScale": loop.timeScale = try a[1].requireDouble()
          case "throw": recorders[SystemKey(rawValue: try a[1].requireString())!]?.failing = true
          case "warmupDue": loop.requestWarmup()
          case "compileDone":
            if compilePending {
              compilePending = false
              loop.warmupCompiled()
            }
          default: XCTFail("\(at): unknown action \(a)")
          }
        }
        XCTAssertEqual(log, try f["beforeLog"].requireArray().map { try $0.requireArray().map(text) }, "\(at) beforeLog")
        log.removeAll()
        // the frame: main.js frame() = loop + render(s)
        let plan = loop.frame(nowMs: try f["now"].requireDouble("now"))
        if plan.renderWarmupFrame {
          record(["renderHidden"])
          record(["render", "0"])
        }
        record(["render", JSNumber.toString(plan.realDt)])
        let startCompile = loop.afterRender()
        XCTAssertEqual(log, try f["log"].requireArray().map { try $0.requireArray().map(text) }, "\(at) log")
        log.removeAll()
        // after the frame: the web calls compileScene in a microtask
        if startCompile {
          compilePending = true
          record(["compile"])
        }
        XCTAssertEqual(log, try f["after"].requireArray().map { try $0.requireArray().map(text) }, "\(at) after")
        log.removeAll()
        let t = loop.time
        assertBitEqual([t.t, t.dt, t.realT, t.realDt, Double(t.frame)], try f["time"].requireDoubles("time"), "\(at) time")
        XCTAssertEqual(loop.warmup.rawValue, try f["warm"].requireString("warm"), "\(at) warm")
        XCTAssertEqual(loop.disabled.map(\.rawValue).sorted(), try f["failed"].requireArray().map { try $0.requireString() }.sorted(), "\(at) failed")
      }
    }
  }

  func testPixelRatio() throws {
    let v = try VectorLoader.load("core/loop")
    let rows = try v.data["pixelRatio"]["rows"].requireArray("rows")
    XCTAssertGreaterThan(rows.count, 100)
    for r in rows {
      let d = try r.requireDoubles("row")
      assertBitEqual(LoopRules.web.pixelRatio(devicePixelRatio: d[2], width: d[0], height: d[1], cap: d[3]), d[4], "pixelRatio \(d)")
    }
  }

  func testRulesMatchGameData() throws {
    let catalog = try VectorLoader.catalog()
    XCTAssertEqual(try LoopRules(game: catalog.data("game")), LoopRules.web)
  }

  func testStepAndReady() {
    let bus = EventBus()
    let loop = GameLoop(events: bus, mode: .play)
    var ready = 0
    bus.on(.gameReady) { _ in ready += 1 }
    let settings = GameSettings(storage: MemoryStorage())
    var changed = [String]()
    loop.ready(settings: settings) { changed.append($0) }
    XCTAssertEqual(ready, 1)
    XCTAssertEqual(loop.warmup, .due)
    XCTAssertTrue(loop.afterRender())
    loop.warmupCompiled()
    XCTAssertTrue(loop.step(frameDelta: 1.0 / 60).renderWarmupFrame)
    XCTAssertEqual(loop.warmup, .idle)
    bus.emit(GameEvent.MissionSetup(def: .null))
    XCTAssertEqual(loop.warmup, .due, "mission:setup re-queues the warm-up")
    XCTAssertTrue(loop.afterRender())
    settings.set("textScale", 1.25)
    XCTAssertEqual(loop.warmup, .compiling, "non-quality keys only resize")
    settings.set("quality", "low")
    XCTAssertEqual(loop.warmup, .due)
    XCTAssertEqual(changed, ["textScale", "quality"])
    let p = loop.step(frameDelta: 0.5)
    XCTAssertEqual(p.realDt, 0.1, "dt cap")
    XCTAssertEqual(loop.time.frame, 2)
  }
}
