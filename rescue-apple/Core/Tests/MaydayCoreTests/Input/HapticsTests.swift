// core/haptics.js vs Tests/Vectors/input/haptics.json: the web's Haptics on a stub ctx, driven by a
// script of events (every rule, edge payloads) and gate changes (mode, active device, vibration).
import XCTest
@testable import MaydayCore

final class HapticsTests: XCTestCase {
  /// The typed payload of a scripted event (complete, as the game emits them).
  private func event(_ name: String, _ p: JSONValue) throws -> GameEvent {
    func d(_ k: String) throws -> Double { try p[k].requireDouble(k) }
    func s(_ k: String) throws -> String { try p[k].requireString(k) }
    func b(_ k: String) -> Bool { p[k].jsTruthy }
    switch name {
    case "heli:damage": return GameEvent.HeliDamage(amount: try d("amount"), source: try s("source"), hull: try d("hull")).event
    case "heli:water-strike": return GameEvent.HeliWaterStrike(x: try d("x"), z: try d("z"), strength: try d("strength")).event
    case "heli:touchdown": return GameEvent.HeliTouchdown(vy: try d("vy")).event
    case "heli:land": return GameEvent.HeliLand(autorotation: b("autorotation"), vy: try d("vy")).event
    case "heli:crash": return GameEvent.HeliCrash(reason: try s("reason"), x: try d("x"), z: try d("z"), onDeck: b("onDeck")).event
    case "heli:capture": return GameEvent.HeliCapture(survivor: GroupID(try p["survivor"].requireInt())).event
    case "heli:pickup":
      return GameEvent.HeliPickup(survivor: GroupID(try p["survivor"].requireInt()), person: PersonID(try p["person"].requireInt())).event
    case "heli:slip": return GameEvent.HeliSlip(survivor: GroupID(try p["survivor"].requireInt()), reason: try s("reason")).event
    case "heli:snag": return GameEvent.HeliSnag(x: try d("x"), z: try d("z"), reason: try s("reason")).event
    case "hazard:hit": return GameEvent.HazardHit(type: try s("type"), damage: try d("damage"), source: try s("source")).event
    case "weather:gust":
      let dir = try p["dir"].requireDoubles("dir")
      return GameEvent.WeatherGust(dir: V2(dir[0], dir[1]), strength: try d("strength"), eta: try d("eta"), x: try d("x"), z: try d("z"),
                                   harmless: b("harmless")).event
    case "weather:lightning":
      return GameEvent.WeatherLightning(x: try d("x"), z: try d("z"), distance: try d("distance"), strength: try d("strength"),
                                        cloudOnly: b("cloudOnly")).event
    case "ui:click": return GameEvent.UiClick(menu: try s("menu")).event
    default: throw VectorError("haptics: no payload builder for \(name)")
    }
  }

  func testRulesAndGatesMatchTheWeb() throws {
    let rows = try VectorLoader.load("input/haptics").data["rows"].requireArray("rows")
    XCTAssertGreaterThan(rows.count, 50)
    let bus = EventBus()
    let input = InputState()
    input.lastDevice = .gamepad
    input.gamepads = [GamepadSnapshot(hasVibration: true)] // rumble() needs an active pad that can vibrate
    var got = [RumbleEffect]()
    input.rumbleSink = { got.append($0) }
    let settings = GameSettings(storage: MemoryStorage())
    settings.set("vibration", 1)
    var mode = GameMode.play
    let haptics = Haptics(events: bus, input: input, settings: settings, mode: { mode })
    var fired = 0
    for (i, r) in rows.enumerated() {
      let step = r["step"]
      let at = "row \(i) \(step.jsonStringify())"
      switch try step[0].requireString() {
      case "emit": bus.emit(try event(try step[1].requireString(), step[2]))
      case "mode": mode = GameMode(rawValue: try step[1].requireString()) ?? .title
      case "device": input.lastDevice = InputDevice(rawValue: try step[1].requireString()) ?? .keyboard
      case "vibration": settings.set("vibration", step[1])
      case let other: throw VectorError("\(at): unknown step \(other)")
      }
      let want = try r["rumble"].requireArray("rumble").map { try $0.requireDoubles("rumble") }
      XCTAssertEqual(got.count, want.count, at)
      for (g, w) in zip(got, want) { assertBitEqual([g.strongMagnitude, g.duration], w, at) }
      // the web's dual-rumble: weak = strong * 0.6 (Input.rumble)
      for g in got { assertBitEqual(g.weakMagnitude, g.strongMagnitude * 0.6, at) }
      fired += got.count
      got.removeAll()
    }
    XCTAssertGreaterThan(fired, 30)
    haptics.detach()
    bus.emit(GameEvent.HeliCrash(reason: "water", x: 0, z: 0, onDeck: false))
    XCTAssertEqual(got, [], "detached")
  }

  /// Every rule's event exists in the catalogue and no other event has a rule.
  func testRuleTable() {
    XCTAssertEqual(Set(HapticRules.events).count, HapticRules.events.count)
    XCTAssertNil(HapticRules.spec(GameEvent.UiClick(menu: "x").event))
    XCTAssertNotNil(HapticRules.spec(GameEvent.HeliCrash(reason: "water", x: 0, z: 0, onDeck: false).event))
  }

  func testToNumber() {
    XCTAssertEqual(JSONValue.null.jsToNumber, 0)
    XCTAssertEqual(JSONValue.bool(true).jsToNumber, 1)
    XCTAssertEqual(JSONValue.string(" 0.5 ").jsToNumber, 0.5)
    XCTAssertEqual(JSONValue.string("").jsToNumber, 0)
    XCTAssertTrue(JSONValue.string("loud").jsToNumber.isNaN)
    XCTAssertEqual(JSONValue.array([]).jsToNumber, 0)
    XCTAssertEqual(JSONValue.array([.number(0.25)]).jsToNumber, 0.25)
    XCTAssertTrue(JSONValue.array([.number(1), .number(2)]).jsToNumber.isNaN)
    XCTAssertTrue(JSONValue.object(JSONObject()).jsToNumber.isNaN)
  }
}
