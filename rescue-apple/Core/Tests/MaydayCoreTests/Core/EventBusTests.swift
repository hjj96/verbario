// core/events.js delivery semantics (Tests/Vectors/core/events.json: scripts replayed on the web's own
// EventBus) and the event catalogue (Resources/Data/events.json ↔ EventName / GameEvent).
import XCTest
@testable import MaydayCore

final class EventBusTests: XCTestCase {
  /// Scripts use ui:click / ui:hover / ui:back with the tag carried in `menu`.
  private func event(_ name: String, _ tag: String) -> GameEvent? {
    switch name {
    case "ui:click": return GameEvent.UiClick(menu: tag).event
    case "ui:hover": return GameEvent.UiHover(menu: tag).event
    case "ui:back": return GameEvent.UiBack(menu: tag).event
    default: return nil
    }
  }

  private func tag(_ e: GameEvent) -> String {
    switch e {
    case .uiClick(let p): return p.menu
    case .uiHover(let p): return p.menu
    case .uiBack(let p): return p.menu ?? ""
    default: return "?"
    }
  }

  /// JSON scalars of the log as strings (tags are numbers in the file).
  private func text(_ v: JSONValue) -> String {
    if let s = v.string { return s }
    if let d = v.double { return JSNumber.toString(d) }
    return "\(v)"
  }

  func testScriptsMatchTheWebBus() throws {
    let v = try VectorLoader.load("core/events")
    let scripts = try v.data["scripts"].requireArray("scripts")
    XCTAssertGreaterThan(scripts.count, 10)
    for script in scripts {
      let id = try script["id"].requireString("id")
      let bus = EventBus()
      var log = [[String]]()
      var offs = [String: EventSubscription]()
      let handlers = script["handlers"]
      var exec: ((JSONValue) throws -> Void)!
      func listener(_ hid: String) -> EventBus.Listener {
        { e in
          let t = self.tag(e)
          log.append([hid, e.name.rawValue, t])
          for a in handlers[hid].array ?? [] {
            if a["when"].exists && self.text(a["when"]) != t { continue }
            try? exec(a["do"])
          }
        }
      }
      exec = { a in
        let op = try a[0].requireString("op")
        switch op {
        case "on", "once":
          let name = try a[1].requireString("name"), hid = try a[2].requireString("hid")
          guard let en = EventName(rawValue: name) else { throw VectorError("\(id): unknown event \(name)") }
          let offId = a[3].string ?? "\(hid)|\(name)"
          offs[offId] = op == "on" ? bus.on(en, key: hid, listener(hid)) : bus.once(en, listener(hid))
        case "off":
          offs[try a[1].requireString("offId")]?.off()
        case "emit":
          let name = try a[1].requireString("name")
          guard let e = self.event(name, self.text(a[2])) else { throw VectorError("\(id): cannot build \(name)") }
          bus.emit(e)
        case "clear":
          bus.clear()
        case "mark":
          log.append(["mark", try a[1].requireString("label")])
        default:
          throw VectorError("\(id): bad op \(op)")
        }
      }
      for s in try script["steps"].requireArray("steps") { try exec(s) }
      let want = try script["log"].requireArray("log").map { row in try row.requireArray("row").map { self.text($0) } }
      XCTAssertEqual(log, want, "script \(id)")
    }
  }

  func testTypedListenersAndTrace() {
    let bus = EventBus()
    var got = [String]()
    var traced = [EventName]()
    bus.onEmit = { traced.append($0.name) }
    bus.on(GameEvent.HeliDamage.self) { p in got.append("damage \(p.amount) \(p.source) \(p.hull)") }
    bus.once(GameEvent.HazardHit.self) { p in got.append("hit \(p.type) \(p.hazard?.raw ?? -1)") }
    bus.on(.heliDamage) { e in
      if case .heliDamage(let p) = e { got.append("raw \(p.source)") }
    }
    bus.emit(GameEvent.HeliDamage(amount: 0.25, source: "rogue", hull: 0.5))
    bus.emit(GameEvent.HazardHit(type: "rogue", damage: 0.1, source: "rogue", hazard: HazardID(7)))
    bus.emit(GameEvent.HazardHit(type: "hail", damage: 0.1, source: "hail"))
    XCTAssertEqual(got, ["damage 0.25 rogue 0.5", "raw rogue", "hit rogue 7"])
    XCTAssertEqual(traced, [.heliDamage, .hazardHit, .hazardHit])
    XCTAssertEqual(bus.listenerCount(.heliDamage), 2)
    XCTAssertEqual(bus.listenerCount(.hazardHit), 0)
  }

  /// Every event the web emits or listens to (events.json) has exactly one case, and every case's
  /// payload reports its own name.
  func testCatalogueIsComplete() throws {
    let catalog = try VectorLoader.catalog()
    let events = try catalog.data("events")["events"].requireArray("events")
    let web = Set(try events.map { try $0["name"].requireString("name") })
    let swift = Set(EventName.allCases.map(\.rawValue))
    XCTAssertEqual(web.subtracting(swift).sorted(), [], "events.json names without a GameEvent case")
    XCTAssertEqual(swift.subtracting(web).sorted(), [], "GameEvent cases the web does not have")
    XCTAssertEqual(EventName.allCases.count, events.count)
    XCTAssertEqual(GameEvent.GameReady().event.name, .gameReady)
    XCTAssertEqual(GameEvent.UiRetryCheckpoint().event.name.rawValue, "ui:retry-checkpoint")
    XCTAssertEqual(GameEvent.HeliRaftDrop(x: 1, z: 2).event.name.rawValue, "heli:raft-drop")
  }
}
