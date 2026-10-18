// core/input.js (Input, BINDINGS, REBINDABLE, PAD, bindableCode, defaultKeys, currentKeys,
// applyBindings) vs Tests/Vectors/input/input.json: scripted raw events and gamepad snapshots replayed
// through the web's own Input class (export-core.mjs), every read compared after each poll().
import XCTest
@testable import MaydayCore

final class InputTests: XCTestCase {
  /// The exporter spells NaN as the string "NaN" inside scripts (JSON has no NaN).
  private func num(_ v: JSONValue) throws -> Double { try v.requireDouble("number") }

  /// A number as text that keeps every bit (-0 and +0 differ; all NaNs are equal), for mixed rows.
  private func bitsText(_ d: Double) -> String { d.isNaN ? "NaN" : "0x" + String(d.bitPattern, radix: 16) }

  /// JS truthiness of a scripted flag (`!!e[2]`): absent / false / 0 → false.
  private func flag(_ v: JSONValue) -> Bool { v.jsTruthy }

  /// export-core.mjs mkPad: {connected?, vib?, axes?, b?: {index: [pressed, value]}}; null → no pad.
  private func pad(_ p: JSONValue) throws -> GamepadSnapshot? {
    guard case .object(let o) = p else { return nil }
    var g = GamepadSnapshot()
    g.connected = !((o["connected"] ?? .null) == .bool(false))
    if let axes = o["axes"]?.array { g.axes = try axes.map(num) }
    if let b = o["b"]?.object {
      for (k, v) in b.entries {
        guard let i = Int(k) else { throw VectorError("pad button index \(k)") }
        g.buttons[i] = GamepadSnapshot.Button(pressed: flag(v[0]), value: try num(v[1]))
      }
    }
    g.hasVibration = flag(o["vib"] ?? .null)
    return g
  }

  /// Per action: down | pressed << 1 | released << 2 | rawPressed << 3.
  private func bits(_ inp: InputState, _ a: InputAction) -> Double {
    Double((inp.down(a) ? 1 : 0) | (inp.pressed(a) ? 2 : 0) | (inp.released(a) ? 4 : 0) | (inp.rawPressed(a) ? 8 : 0))
  }

  func testPollSequencesMatchTheWebInput() throws {
    let v = try VectorLoader.load("input/input")
    let d = v.data
    XCTAssertEqual(try d["actions"].requireArray("actions").map { try $0.requireString() }, InputAction.allCases.map(\.rawValue),
                   "InputAction order = Object.keys(BINDINGS.buttons)")
    let axes = try d["axes"].requireArray("axes").map { try $0.requireString() }
    XCTAssertEqual(axes, InputAxis.allCases.map(\.rawValue))
    let view = try d["view"].requireDoubles("view")
    let scripts = try d["scripts"].requireArray("scripts")
    XCTAssertEqual(scripts.count, 6)
    var frames = 0
    // Like the exporter's stubs, the clock (performance.now) and the pad list (navigator.getGamepads)
    // carry over from one script to the next; each script gets a fresh Input with default bindings.
    var clock = 0.0
    var pads = [GamepadSnapshot?]()
    for script in scripts {
      let id = try script["id"].requireString("id")
      let inp = InputState(bindings: Bindings())
      var rumbles = [RumbleEffect]()
      inp.rumbleSink = { rumbles.append($0) }
      for (fi, f) in try script["frames"].requireArray("frames").enumerated() {
        let at = "\(id) frame \(fi)"
        if f["pads"].exists { pads = try f["pads"].requireArray("pads").map(pad) }
        inp.gamepads = pads
        var reads = [String]()
        for e in try f["events"].requireArray("events") {
          switch try e[0].requireString("event") {
          case "time": clock = try num(e[1])
          case "keydown": inp.keyDown(try e[1].requireString(), isRepeat: flag(e[2]), inTextField: flag(e[3]))
          case "keyup": inp.keyUp(try e[1].requireString())
          case "blur": inp.blur()
          case "mousemove": inp.mouseMove(x: try num(e[1]), y: try num(e[2]), viewWidth: view[0], viewHeight: view[1], nowMs: clock)
          case "mousedown": inp.mouseDown(button: try e[1].requireInt(), onGameView: flag(e[2]), nowMs: clock)
          case "mouseup": inp.mouseUp(button: try e[1].requireInt())
          case "wheel": inp.wheel(deltaY: try num(e[1]))
          case "touchstart": inp.touchStart()
          case "vaxis":
            guard let a = InputAxis(rawValue: try e[1].requireString()) else { throw VectorError("\(at): axis \(e[1])") }
            inp.setVirtualAxis(a, try num(e[2]))
          case "vbutton":
            guard let a = InputAction(rawValue: try e[1].requireString()) else { throw VectorError("\(at): button \(e[1])") }
            inp.setVirtualButton(a, flag(e[2]))
          case "enabled": inp.enabled = flag(e[1])
          case "bindings": inp.bindings.apply(e[1])
          case "rumble":
            rumbles.removeAll()
            inp.rumble(strength: try num(e[1]), duration: try num(e[2]))
            reads.append((["rumble"] + rumbles.flatMap { ["dual-rumble", bitsText($0.duration), bitsText($0.strongMagnitude), bitsText($0.weakMagnitude)] })
                          .joined(separator: " "))
          case "consumeWheel": reads.append("consumeWheel " + bitsText(inp.consumeWheel()))
          case let other: throw VectorError("\(at): unknown event \(other)")
          }
        }
        if f["poll"] != .bool(false) { inp.poll() }
        frames += 1

        let wantReads = try f["reads"].requireArray("reads").map { row in
          try row.requireArray().map { x in try x.double.map(bitsText) ?? x.requireString() }.joined(separator: " ")
        }
        XCTAssertEqual(reads, wantReads, "\(at) reads")
        assertBitEqual(InputAxis.allCases.map { inp.axesValues[$0] ?? 0 }, try f["axesValues"].requireDoubles(), "\(at) axesValues")
        assertBitEqual(InputAxis.allCases.map { inp.axis($0) }, try f["axis"].requireDoubles(), "\(at) axis()")
        let mv = inp.move()
        assertBitEqual([mv.x, mv.y], try f["move"].requireDoubles(), "\(at) move()")
        assertBitEqual(InputAction.allCases.map { bits(inp, $0) }, try f["buttons"].requireDoubles(), "\(at) buttons")
        XCTAssertEqual(inp.anyPressedThisFrame, f["any"].bool, "\(at) anyPressedThisFrame")
        XCTAssertEqual(inp.lastDevice.rawValue, try f["lastDevice"].requireString(), "\(at) lastDevice")
        let m = inp.mouse
        let wm = f["mouse"]
        assertBitEqual([m.x, m.y, m.ndcX, m.ndcY, m.wheel, m.lastMoveT],
                       [try num(wm[0]), try num(wm[1]), try num(wm[2]), try num(wm[3]), try num(wm[5]), try num(wm[7])], "\(at) mouse")
        XCTAssertEqual([m.down, m.active], [wm[4].bool ?? false, wm[6].bool ?? false], "\(at) mouse down / active")
      }
    }
    XCTAssertGreaterThan(frames, 60)
  }

  /// BINDINGS in the web's JSON layout ({axes: {name: [neg, pos]}, buttons: {name: keys}}), in the
  /// web's key order, so `==` on JSONValue also checks the order.
  static func bindingsJSON(_ b: Bindings) -> JSONValue {
    var axes = JSONObject()
    for a in InputAxis.keyed {
      let k = b.keys(a)
      axes.set(a.rawValue, .array([.array(k.neg.map(JSONValue.string)), .array(k.pos.map(JSONValue.string))]))
    }
    var buttons = JSONObject()
    for a in InputAction.allCases { buttons.set(a.rawValue, .array(b.keys(a).map(JSONValue.string))) }
    var o = JSONObject()
    o.set("axes", .object(axes))
    o.set("buttons", .object(buttons))
    return .object(o)
  }

  func testRebinding() throws {
    let d = try VectorLoader.load("input/input").data
    for r in try d["bindableCode"].requireArray("bindableCode") {
      let code = try r[0].requireString()
      XCTAssertEqual(Bindings.bindableCode(code), r[1].bool, "bindableCode(\(code.debugDescription))")
    }
    let b = Bindings()
    for r in try d["defaultKeys"].requireArray("defaultKeys") {
      let id = try r[0].requireString()
      XCTAssertEqual(b.defaultKeys(id), r[1].strings, "defaultKeys(\(id))")
    }
    let ids = b.rebindable.map(\.id) + ["nope"]
    let rows = try d["applyBindings"].requireArray("applyBindings")
    XCTAssertGreaterThanOrEqual(rows.count, 10)
    for r in rows {
      b.apply(r["overrides"])
      let label = "applyBindings(\(r["overrides"].jsonStringify()))"
      XCTAssertEqual(Self.bindingsJSON(b), r["bindings"], label)
      XCTAssertEqual(ids.map { b.currentKeys($0) }, try r["currentKeys"].requireArray().map { try $0.requireStrings("keys") }, label)
    }
    // the defaults are restored by every apply
    b.apply(.object(JSONObject()))
    XCTAssertEqual(b.axes, b.defaults.axes)
    XCTAssertEqual(b.buttons, b.defaults.buttons)
  }

  /// input.json `core/input` (the data the app ships) agrees with the compiled-in tables.
  func testTablesMatchInputData() throws {
    let json = try VectorLoader.catalog().data("input")
    let tables = try InputTables(json: json)
    XCTAssertEqual(tables, InputTables.web)
    XCTAssertEqual(InputTables.buttonOrder(json: json), InputAction.allCases.map(\.rawValue))
    // BINDINGS as exported (the live table at export time) is the default table
    XCTAssertEqual(json["core/input"]["BINDINGS"], json["core/input"]["DEFAULT_BINDINGS"])
  }

  /// Settings and Input share one live Bindings (the web's module-level BINDINGS): a rebinding made in
  /// the settings sheet reaches the next poll() without rebuilding anything.
  func testSettingsRebindingIsLive() {
    let bindings = Bindings()
    let inp = InputState(bindings: bindings)
    let settings = GameSettings(storage: MemoryStorage(), bindings: bindings)
    inp.keyDown("KeyI")
    inp.poll()
    XCTAssertEqual(inp.axis(.moveY), 0)
    var o = JSONObject()
    o.set("up", .array([.string("KeyI")]))
    settings.set("bindings", .object(o))
    inp.poll()
    XCTAssertEqual(inp.axis(.moveY), 1)
    XCTAssertEqual(bindings.currentKeys("up"), ["KeyI"])
    // a pad without vibration ignores rumble; one with it gets the web's dual-rumble magnitudes
    var got = [RumbleEffect]()
    inp.rumbleSink = { got.append($0) }
    inp.gamepads = [GamepadSnapshot()]
    inp.rumble()
    XCTAssertEqual(got, [])
    inp.gamepads = [GamepadSnapshot(hasVibration: true)]
    inp.rumble(strength: 1, duration: 50)
    XCTAssertEqual(got, [RumbleEffect(duration: 50, strongMagnitude: 1, weakMagnitude: 0.6)])
    // keydown reports the web's preventDefault keys; text fields are ignored entirely
    XCTAssertTrue(inp.keyDown("Space"))
    XCTAssertFalse(inp.keyDown("KeyW"))
    XCTAssertFalse(inp.keyDown("Tab", inTextField: true))
    XCTAssertFalse(inp.keys.contains("Tab"))
  }
}
