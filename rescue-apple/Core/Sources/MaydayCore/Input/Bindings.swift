// core/input.js tables and live key bindings: BINDINGS, DEFAULT_BINDINGS, REBINDABLE, PAD,
// bindableCode, defaultKeys, currentKeys, applyBindings. Keyboard keys are KeyboardEvent.code strings
// (PLAN D16: saved bindings stay compatible with the web), mouse buttons are "Mouse0" / "Mouse2".
// `InputTables.web` holds input.json `core/input` compiled in (InputTests checks they agree).

/// Analog axes. +moveY = north / screen up, +lift = climb.
public enum InputAxis: String, CaseIterable, Sendable {
  case moveX, moveY, lift, aimX, aimY

  /// Object.keys(BINDINGS.axes): the axes that have keys, in poll order.
  public static let keyed: [InputAxis] = [.moveX, .moveY, .lift]
}

/// Buttons, in Object.keys(BINDINGS.buttons) order (poll order).
public enum InputAction: String, CaseIterable, Sendable {
  case winch, boost, searchlight, flare, raftDrop, horn, altPreset1, altPreset2, altPreset3, altUp, altDown
  case map, pause, confirm, back, zoom, debug, photo, thermal, navUp, navDown, navLeft, navRight
}

/// input.lastDevice
public enum InputDevice: String, Sendable {
  case keyboard, gamepad, touch
}

/// [negativeKeys, positiveKeys] of one keyed axis.
public struct AxisKeys: Equatable, Sendable {
  public var neg: [String]
  public var pos: [String]

  public init(neg: [String], pos: [String]) {
    self.neg = neg
    self.pos = pos
  }

  /// side 0 = negative, 1 = positive (REBINDABLE `side`)
  public subscript(side: Int) -> [String] {
    get { side == 0 ? neg : pos }
    set { if side == 0 { neg = newValue } else { pos = newValue } }
  }
}

/// One row of REBINDABLE: an entry of the УПРАВЛЕНИЕ sheet and the BINDINGS slot it owns.
public struct RebindableAction: Equatable, Sendable {
  public enum Slot: Equatable, Sendable {
    case axis(InputAxis, side: Int)
    case button(InputAction)
  }

  public let id: String
  public let label: String
  public let slot: Slot

  public init(id: String, label: String, slot: Slot) {
    self.id = id
    self.label = label
    self.slot = slot
  }
}

/// Standard gamepad mapping (W3C indices): PAD.
public struct PadMapping: Equatable, Sendable {
  /// PAD.axes: stick axis indices
  public var moveX = 0, moveY = 1, aimX = 2, aimY = 3
  /// PAD.lift: RT climbs, LT descends (analog)
  public var liftUp = 7, liftDown = 6
  /// PAD.buttons: action → button indices
  public var buttons: [InputAction: [Int]] = [:]

  public init() {}
}

/// The static input tables (BINDINGS as shipped = DEFAULT_BINDINGS, REBINDABLE, PAD).
public struct InputTables: Equatable, Sendable {
  public var axes: [InputAxis: AxisKeys]
  public var buttons: [InputAction: [String]]
  public var rebindable: [RebindableAction]
  public var pad: PadMapping

  public init(axes: [InputAxis: AxisKeys], buttons: [InputAction: [String]], rebindable: [RebindableAction], pad: PadMapping) {
    self.axes = axes
    self.buttons = buttons
    self.rebindable = rebindable
    self.pad = pad
  }

  /// input.json `core/input`, compiled in.
  public static let web: InputTables = {
    var pad = PadMapping()
    pad.buttons = [
      .winch: [0], .confirm: [0], .flare: [1], .back: [1], .searchlight: [2], .horn: [3], .boost: [4], .zoom: [5],
      .map: [8], .pause: [9], .photo: [10], .thermal: [11], .altUp: [12], .altDown: [13], .raftDrop: [15],
      .navUp: [12], .navDown: [13], .navLeft: [14], .navRight: [15],
    ]
    return InputTables(
      axes: [
        .moveX: AxisKeys(neg: ["KeyA", "ArrowLeft"], pos: ["KeyD", "ArrowRight"]),
        .moveY: AxisKeys(neg: ["KeyS", "ArrowDown"], pos: ["KeyW", "ArrowUp"]),
        .lift: AxisKeys(neg: ["KeyQ", "KeyF", "PageDown"], pos: ["KeyE", "KeyR", "PageUp"]),
      ],
      buttons: [
        .winch: ["Space"], .boost: ["ShiftLeft", "ShiftRight"], .searchlight: ["KeyL"], .flare: ["KeyG", "Mouse0"],
        .raftDrop: ["KeyC", "Mouse2"], .horn: ["KeyH"], .altPreset1: ["Digit1", "Numpad1"], .altPreset2: ["Digit2", "Numpad2"],
        .altPreset3: ["Digit3", "Numpad3"], .altUp: [], .altDown: [], .map: ["KeyM", "Tab"], .pause: ["Escape", "KeyP"],
        .confirm: ["Enter", "NumpadEnter"], .back: ["Escape", "Backspace"], .zoom: ["KeyZ"], .debug: ["Backquote"],
        .photo: ["KeyV"], .thermal: ["KeyT"], .navUp: ["ArrowUp", "KeyW"], .navDown: ["ArrowDown", "KeyS"],
        .navLeft: ["ArrowLeft", "KeyA"], .navRight: ["ArrowRight", "KeyD"],
      ],
      rebindable: [
        RebindableAction(id: "up", label: "Полёт вверх по экрану (север)", slot: .axis(.moveY, side: 1)),
        RebindableAction(id: "down", label: "Полёт вниз по экрану", slot: .axis(.moveY, side: 0)),
        RebindableAction(id: "left", label: "Полёт влево", slot: .axis(.moveX, side: 0)),
        RebindableAction(id: "right", label: "Полёт вправо", slot: .axis(.moveX, side: 1)),
        RebindableAction(id: "climb", label: "Набор высоты (держать)", slot: .axis(.lift, side: 1)),
        RebindableAction(id: "descend", label: "Снижение (держать)", slot: .axis(.lift, side: 0)),
        RebindableAction(id: "altPreset1", label: "Высота 15 м", slot: .button(.altPreset1)),
        RebindableAction(id: "altPreset2", label: "Высота 40 м", slot: .button(.altPreset2)),
        RebindableAction(id: "altPreset3", label: "Высота 90 м", slot: .button(.altPreset3)),
        RebindableAction(id: "winch", label: "Лебёдка (держать)", slot: .button(.winch)),
        RebindableAction(id: "boost", label: "Форсаж (держать)", slot: .button(.boost)),
        RebindableAction(id: "searchlight", label: "Прожектор", slot: .button(.searchlight)),
        RebindableAction(id: "flare", label: "Фальшфейер к курсору", slot: .button(.flare)),
        RebindableAction(id: "raftDrop", label: "Сбросить плот", slot: .button(.raftDrop)),
        RebindableAction(id: "horn", label: "Громкоговоритель", slot: .button(.horn)),
        RebindableAction(id: "map", label: "Карта (держать)", slot: .button(.map)),
        RebindableAction(id: "zoom", label: "Зум камеры", slot: .button(.zoom)),
        RebindableAction(id: "thermal", label: "Тепловизор", slot: .button(.thermal)),
        RebindableAction(id: "photo", label: "Фоторежим", slot: .button(.photo)),
      ],
      pad: pad
    )
  }()

  /// From the `data` payload of Resources/Data/input.json (module `core/input`). The shipped
  /// bindings are DEFAULT_BINDINGS (BINDINGS is the live copy).
  public init(json: JSONValue) throws {
    let m = json["core/input"]
    let b = m["DEFAULT_BINDINGS"]
    var axes = [InputAxis: AxisKeys]()
    for axis in InputAxis.keyed {
      let pair = b["axes"][axis.rawValue]
      axes[axis] = AxisKeys(neg: try pair[0].requireStrings("DEFAULT_BINDINGS.axes.\(axis).0"),
                            pos: try pair[1].requireStrings("DEFAULT_BINDINGS.axes.\(axis).1"))
    }
    let bo = try b["buttons"].requireObject("DEFAULT_BINDINGS.buttons")
    var buttons = [InputAction: [String]]()
    for (name, keys) in bo.entries {
      guard let a = InputAction(rawValue: name) else { throw JSONError("DEFAULT_BINDINGS.buttons: unknown action \(name)") }
      buttons[a] = try keys.requireStrings("DEFAULT_BINDINGS.buttons.\(name)")
    }
    var rebindable = [RebindableAction]()
    for (i, r) in try m["REBINDABLE"].requireArray("REBINDABLE").enumerated() {
      let id = try r["id"].requireString("REBINDABLE[\(i)].id")
      let label = try r["label"].requireString("REBINDABLE[\(i)].label")
      if let ax = r["axis"].string {
        guard let axis = InputAxis(rawValue: ax) else { throw JSONError("REBINDABLE[\(i)]: unknown axis \(ax)") }
        rebindable.append(RebindableAction(id: id, label: label, slot: .axis(axis, side: try r["side"].requireInt("REBINDABLE[\(i)].side"))))
      } else {
        let bt = try r["button"].requireString("REBINDABLE[\(i)].button")
        guard let a = InputAction(rawValue: bt) else { throw JSONError("REBINDABLE[\(i)]: unknown button \(bt)") }
        rebindable.append(RebindableAction(id: id, label: label, slot: .button(a)))
      }
    }
    let p = m["PAD"]
    var pad = PadMapping()
    pad.moveX = try p["axes"]["moveX"].requireInt("PAD.axes.moveX")
    pad.moveY = try p["axes"]["moveY"].requireInt("PAD.axes.moveY")
    pad.aimX = try p["axes"]["aimX"].requireInt("PAD.axes.aimX")
    pad.aimY = try p["axes"]["aimY"].requireInt("PAD.axes.aimY")
    pad.liftUp = try p["lift"]["up"].requireInt("PAD.lift.up")
    pad.liftDown = try p["lift"]["down"].requireInt("PAD.lift.down")
    for (name, idx) in try p["buttons"].requireObject("PAD.buttons").entries {
      guard let a = InputAction(rawValue: name) else { throw JSONError("PAD.buttons: unknown action \(name)") }
      pad.buttons[a] = try idx.requireArray("PAD.buttons.\(name)").map { try $0.requireInt("PAD.buttons.\(name)[]") }
    }
    self.init(axes: axes, buttons: buttons, rebindable: rebindable, pad: pad)
  }

  /// Order of Object.keys(BINDINGS.buttons) in the data (InputAction.allCases must match it).
  public static func buttonOrder(json: JSONValue) -> [String] {
    json["core/input"]["DEFAULT_BINDINGS"]["buttons"].object?.keys ?? []
  }
}

extension JSONValue {
  func requireStrings(_ what: @autoclosure () -> String) throws -> [String] {
    guard let s = strings else { throw JSONError("\(what()): expected an array of strings, got \(kindName)") }
    return s
  }
}

/// The live BINDINGS: rebuilt in place by `apply(_:)` from the defaults plus the player's overrides
/// (settings key `bindings`); InputState, the HUD key hints and the controls sheet all hold this one
/// instance and see a change immediately.
public final class Bindings {
  public let defaults: InputTables
  public private(set) var axes: [InputAxis: AxisKeys]
  public private(set) var buttons: [InputAction: [String]]

  public init(tables: InputTables = .web) {
    defaults = tables
    axes = tables.axes
    buttons = tables.buttons
  }

  public var rebindable: [RebindableAction] { defaults.rebindable }

  /// The keys of a keyed axis: [neg, pos].
  public func keys(_ axis: InputAxis) -> AxisKeys { axes[axis] ?? AxisKeys(neg: [], pos: []) }

  /// The keys of a button.
  public func keys(_ action: InputAction) -> [String] { buttons[action] ?? [] }

  /// bindableCode(code): modifiers (Control/Meta/Alt/OS/Fn…), F-keys and the menu / pause / debug
  /// keys can never be bound.
  public static func bindableCode(_ code: String) -> Bool {
    if code.isEmpty { return false }
    for p in ["Control", "Meta", "Alt", "OS", "Fn"] where code.hasPrefix(p) { return false }
    // /^F\d+$/
    let u = Array(code.unicodeScalars)
    if u.count > 1 && u[0] == "F" && u[1...].allSatisfy({ $0.value >= 0x30 && $0.value <= 0x39 }) { return false }
    return !["Escape", "Backspace", "Backquote", "Enter", "NumpadEnter", "CapsLock", "ContextMenu", "PrintScreen"].contains(code)
  }

  private func rebindable(_ id: String) -> RebindableAction? { defaults.rebindable.first { $0.id == id } }

  /// defaultKeys(id): the shipped key list of a rebindable action (a copy; [] for unknown ids).
  public func defaultKeys(_ id: String) -> [String] {
    guard let r = rebindable(id) else { return [] }
    switch r.slot {
    case .axis(let a, let side): return (defaults.axes[a] ?? AxisKeys(neg: [], pos: []))[side]
    case .button(let b): return defaults.buttons[b] ?? []
    }
  }

  /// currentKeys(id): the live key list of a rebindable action ([] for unknown ids).
  public func currentKeys(_ id: String) -> [String] {
    guard let r = rebindable(id) else { return [] }
    switch r.slot {
    case .axis(let a, let side): return keys(a)[side]
    case .button(let b): return keys(b)
    }
  }

  /// applyBindings(overrides): reset to the defaults, then for every REBINDABLE id whose override is
  /// an array keep its bindable codes (plus Mouse0 / Mouse2), de-duplicated, at most two. Anything that
  /// is not an object (or array) leaves the defaults.
  public func apply(_ overrides: JSONValue?) {
    axes = defaults.axes
    buttons = defaults.buttons
    guard let o = overrides else { return }
    let table: JSONObject
    switch o {
    case .object(let obj): table = obj
    case .array: return // an array is an object in JS, but has no REBINDABLE ids as keys
    default: return
    }
    for r in defaults.rebindable {
      guard case .array(let list)? = table[r.id] else { continue }
      var keys = [String]()
      for v in list {
        guard case .string(let c) = v, Bindings.bindableCode(c) || c == "Mouse0" || c == "Mouse2" else { continue }
        if !keys.contains(where: { $0.utf8.elementsEqual(c.utf8) }) { keys.append(c) }
      }
      if keys.count > 2 { keys = Array(keys[0..<2]) }
      switch r.slot {
      case .axis(let a, let side):
        var k = axes[a] ?? AxisKeys(neg: [], pos: [])
        k[side] = keys
        axes[a] = k
      case .button(let b):
        buttons[b] = keys
      }
    }
  }
}
