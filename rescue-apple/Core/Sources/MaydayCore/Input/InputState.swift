// core/input.js Input: keyboard, mouse, gamepad and virtual (touch) controls mapped to named actions.
// Systems read actions only — never raw keys. Platform-free: the app's adapters (NSEvent / UIKit /
// GameController, PLAN §2.8) translate their events into the raw calls below (the web's DOM
// listeners) and set `gamepads` before each poll() (navigator.getGamepads()).
// Vectors: Tests/Vectors/input/input.json (poll sequences of the real Input class).
//
// Rules worth knowing (all as in the web):
//   * a key or mouse button pressed and released between two polls still counts as one press (`taps`);
//   * axes from keys are -1/0/+1; analog triggers (RT − LT) override lift when |RT − LT| > 0.08;
//     a virtual (touch) axis overrides when |v| > 0.02;
//   * sticks: radial dead zone 0.14, response 0.55m + 0.45m³; the stronger of stick and keys wins
//     for movement; touch, when active, owns movement; without a pad the aim axes come from touch;
//   * `anyPressedThisFrame` also blinks while the mouse is held (web quirk kept on purpose).

/// One W3C "standard" gamepad as navigator.getGamepads() reports it.
public struct GamepadSnapshot: Equatable, Sendable {
  public struct Button: Equatable, Sendable {
    public var pressed: Bool
    public var value: Double

    public init(pressed: Bool = false, value: Double = 0) {
      self.pressed = pressed
      self.value = value
    }
  }

  public var connected: Bool
  /// 17 buttons in standard order (A, B, X, Y, LB, RB, LT, RT, View, Start, L3, R3, D-pad ↑ ↓ ← →, Home).
  public var buttons: [Button]
  /// leftX, leftY (+1 = down), rightX, rightY (+1 = down).
  public var axes: [Double]
  /// The pad can rumble (vibrationActuator present).
  public var hasVibration: Bool

  public init(connected: Bool = true, buttons: [Button] = Array(repeating: Button(), count: 17),
              axes: [Double] = [0, 0, 0, 0], hasVibration: Bool = false) {
    self.connected = connected
    self.buttons = buttons
    self.axes = axes
    self.hasVibration = hasVibration
  }
}

/// A rumble request (the web's playEffect('dual-rumble', {duration, strongMagnitude, weakMagnitude})).
public struct RumbleEffect: Equatable, Sendable {
  public var duration: Double // ms
  public var strongMagnitude: Double
  public var weakMagnitude: Double
}

/// input.mouse
public struct MouseState: Equatable, Sendable {
  public var x: Double = 0
  public var y: Double = 0
  public var ndcX: Double = 0
  public var ndcY: Double = 0
  public var down = false
  public var wheel: Double = 0
  public var active = false
  /// Clock of the last move / press in ms (heli nose follows the cursor for 2 s after it moved).
  public var lastMoveT: Double = -1e9

  public init() {}
}

public final class InputState {
  public let bindings: Bindings
  public let pad: PadMapping

  /// Codes held down (KeyboardEvent.code).
  public private(set) var keys = Set<String>()
  /// "Mouse0" | "Mouse2": presses that started on the game view.
  public private(set) var mouseButtons = Set<String>()
  /// Codes / buttons that went down since the last poll.
  public private(set) var taps = Set<String>()
  public var mouse = MouseState()
  /// Set by the touch UI (setVirtualAxis / setVirtualButton).
  public private(set) var virtualAxes: [InputAxis: Double] = [:]
  public private(set) var virtualButtons: [InputAction: Bool] = [:]
  public var lastDevice: InputDevice = .keyboard
  /// false: gameplay reads (axis/down/pressed/released) return neutral values; rawPressed still works.
  public var enabled = true
  public private(set) var anyPressedThisFrame = false
  /// navigator.getGamepads(): the platform adapter refreshes it before every poll().
  public var gamepads: [GamepadSnapshot?] = []
  /// Receives rumble() requests when the active pad can vibrate.
  public var rumbleSink: ((RumbleEffect) -> Void)?

  private var axesValues: [InputAxis: Double] = [.moveX: 0, .moveY: 0, .lift: 0, .aimX: 0, .aimY: 0]
  private var buttons: [InputAction: Bool] = [:]
  private var prevButtons: [InputAction: Bool] = [:]

  public init(bindings: Bindings = Bindings(), pad: PadMapping? = nil) {
    self.bindings = bindings
    self.pad = pad ?? bindings.defaults.pad
  }

  // ---- raw events (the web's DOM listeners) --------------------------------------------------------
  /// keydown. `inTextField`: the event targets a text input (the web ignores those).
  public func keyDown(_ code: String, isRepeat: Bool = false, inTextField: Bool = false) {
    if inTextField { return }
    keys.insert(code)
    if !isRepeat { taps.insert(code) }
    lastDevice = .keyboard
  }

  /// keyup
  public func keyUp(_ code: String) { keys.remove(code) }

  /// window blur: forget everything held (a keyup lost behind Cmd-Tab must not stick).
  public func blur() {
    keys.removeAll()
    taps.removeAll()
    mouseButtons.removeAll()
  }

  /// mousemove in view points; `nowMs` is the clock the heli compares lastMoveT with.
  public func mouseMove(x: Double, y: Double, viewWidth: Double, viewHeight: Double, nowMs: Double) {
    mouse.x = x
    mouse.y = y
    mouse.ndcX = (x / viewWidth) * 2 - 1
    mouse.ndcY = -(y / viewHeight) * 2 + 1
    mouse.active = true
    mouse.lastMoveT = nowMs
  }

  /// mousedown; only presses on the game view (not on HUD / menus) become Mouse<n> buttons.
  public func mouseDown(button: Int, onGameView: Bool, nowMs: Double) {
    mouse.down = true
    mouse.lastMoveT = nowMs
    if onGameView {
      mouseButtons.insert("Mouse\(button)")
      taps.insert("Mouse\(button)")
    }
  }

  /// mouseup
  public func mouseUp(button: Int) {
    mouse.down = false
    mouseButtons.remove("Mouse\(button)")
  }

  /// wheel: accumulates sign(deltaY) until consumeWheel()
  public func wheel(deltaY: Double) { mouse.wheel += JS.sign(deltaY) }

  /// touchstart
  public func touchStart() { lastDevice = .touch }

  // ---- per frame ------------------------------------------------------------------------------------
  /// Called once per frame by the loop before systems update.
  public func poll() {
    let pad = activePad()
    let prevAny = anyPressedThisFrame
    anyPressedThisFrame = false

    for name in InputAxis.keyed {
      let k = bindings.keys(name)
      var v = 0.0
      if k.neg.contains(where: { keys.contains($0) || taps.contains($0) }) { v -= 1 }
      if k.pos.contains(where: { keys.contains($0) || taps.contains($0) }) { v += 1 }
      if let p = pad, name == .lift {
        let up = buttonValue(p, self.pad.liftUp)
        let down = buttonValue(p, self.pad.liftDown)
        if JS.abs(up - down) > 0.08 { v = up - down }
      }
      if let va = virtualAxes[name], JS.abs(va) > 0.02 { v = va }
      axesValues[name] = MathUtil.clamp(v, -1, 1)
    }
    // Gamepad sticks: radial dead zone 0.14, response curve 0.55m + 0.45m³ (DESIGN §3.2).
    if let p = pad {
      // Stick and movement keys combine: the stronger one wins, so a stray held key never freezes the
      // stick. Touch controls, when active, own movement.
      let vm = JSNumber.isTruthy(virtualAxes[.moveX] ?? 0) || JSNumber.isTruthy(virtualAxes[.moveY] ?? 0)
      if !vm, let mv = stick(p, self.pad.moveX, self.pad.moveY) {
        if JS.hypot(mv.x, mv.y) > JS.hypot(axesValues[.moveX] ?? 0, axesValues[.moveY] ?? 0) {
          axesValues[.moveX] = mv.x
          axesValues[.moveY] = mv.y
        }
      }
      let aim = stick(p, self.pad.aimX, self.pad.aimY)
      axesValues[.aimX] = aim?.x ?? 0
      axesValues[.aimY] = aim?.y ?? 0
    } else {
      axesValues[.aimX] = JSNumber.or(virtualAxes[.aimX], 0)
      axesValues[.aimY] = JSNumber.or(virtualAxes[.aimY], 0)
    }

    for name in InputAction.allCases {
      var down = bindings.keys(name).contains { keys.contains($0) || mouseButtons.contains($0) || taps.contains($0) }
      if let p = pad, let idx = self.pad.buttons[name] {
        down = down || idx.contains { i in i >= 0 && i < p.buttons.count && p.buttons[i].pressed }
      }
      if virtualButtons[name] == true { down = true }
      let prev = buttons[name] ?? false
      prevButtons[name] = prev
      buttons[name] = down
      if down && !prev { anyPressedThisFrame = true }
    }
    if mouse.down { anyPressedThisFrame = anyPressedThisFrame || !prevAny }
    if !taps.isEmpty { anyPressedThisFrame = true }
    taps.removeAll()
  }

  /// stick(ix, iy): nil inside the dead zone, else the curved, clamped vector (y up).
  private func stick(_ p: GamepadSnapshot, _ ix: Int, _ iy: Int) -> (x: Double, y: Double)? {
    let x = JSNumber.or(axisValue(p, ix), 0)
    let y = -JSNumber.or(axisValue(p, iy), 0) // pad Y is +1 down; ours is +1 = north/screen up
    let m = JS.hypot(x, y)
    if m < 0.14 { return nil }
    let mm = JS.min(1, (m - 0.14) / 0.86)
    let k = (0.55 * mm + 0.45 * mm * mm * mm) / m
    return (MathUtil.clamp(x * k, -1, 1), MathUtil.clamp(y * k, -1, 1))
  }

  private func axisValue(_ p: GamepadSnapshot, _ i: Int) -> Double? {
    i >= 0 && i < p.axes.count ? p.axes[i] : nil
  }

  /// pad.buttons[i]?.value || 0
  private func buttonValue(_ p: GamepadSnapshot, _ i: Int) -> Double {
    JSNumber.or(i >= 0 && i < p.buttons.count ? p.buttons[i].value : nil, 0)
  }

  /// _pad(): the first connected pad; any pressed button or |axis| > 0.3 makes it the last device.
  private func activePad() -> GamepadSnapshot? {
    for case let p? in gamepads where p.connected {
      if p.buttons.contains(where: { $0.pressed }) || p.axes.contains(where: { JS.abs($0) > 0.3 }) { lastDevice = .gamepad }
      return p
    }
    return nil
  }

  // ---- reads -----------------------------------------------------------------------------------------
  /// Wheel steps accumulated since the last call (consumed).
  public func consumeWheel() -> Double {
    let w = mouse.wheel
    mouse.wheel = 0
    return w
  }

  /// axis(name): -1…1, 0 while disabled
  public func axis(_ name: InputAxis) -> Double {
    enabled ? JSNumber.or(axesValues[name], 0) : 0
  }

  /// Movement vector with length <= 1 (x = east/right, y = north/up on screen).
  public func move() -> (x: Double, y: Double) {
    var x = axis(.moveX)
    var y = axis(.moveY)
    let len = JS.hypot(x, y)
    if len > 1 {
      x /= len
      y /= len
    }
    return (x, y)
  }

  /// Held this frame.
  public func down(_ name: InputAction) -> Bool { enabled && (buttons[name] ?? false) }

  /// True only on the frame the button went down.
  public func pressed(_ name: InputAction) -> Bool {
    enabled && (buttons[name] ?? false) && !(prevButtons[name] ?? false)
  }

  /// True only on the frame the button went up.
  public func released(_ name: InputAction) -> Bool {
    enabled && !(buttons[name] ?? false) && (prevButtons[name] ?? false)
  }

  /// pressed() ignoring `enabled` (menus use it while gameplay input is disabled).
  public func rawPressed(_ name: InputAction) -> Bool {
    (buttons[name] ?? false) && !(prevButtons[name] ?? false)
  }

  // ---- touch UI ------------------------------------------------------------------------------------------
  public func setVirtualAxis(_ name: InputAxis, _ value: Double) {
    virtualAxes[name] = value
    lastDevice = .touch
  }

  public func setVirtualButton(_ name: InputAction, _ down: Bool) {
    virtualButtons[name] = down
    lastDevice = .touch
  }

  // ---- output ------------------------------------------------------------------------------------------
  /// Gamepad rumble if the active pad supports it. strength 0…1, duration ms.
  public func rumble(strength: Double = 0.5, duration: Double = 200) {
    guard let p = activePad(), p.hasVibration else { return }
    rumbleSink?(RumbleEffect(duration: duration, strongMagnitude: strength, weakMagnitude: strength * 0.6))
  }
}
