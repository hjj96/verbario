// InputDevices — GameController adapters (PLAN §2.8 «Ввод»):
//   * gamepad: GCController.extendedGamepad polled once per frame → W3C standard mapping
//     (the indices of input.json PAD: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu,
//     10 L3, 11 R3, 12–15 D-pad up/down/left/right, 16 Home; axes leftX, leftY (+down), rightX, rightY);
//   * keyboard on iOS/iPadOS: GCKeyboard keyChangedHandler (HID usage → KeyboardEvent.code).
//     macOS uses NSEvent in GameMTKView instead: GCKeyboard on the Mac reads HID directly and can
//     trigger the system "Input Monitoring" permission prompt — not acceptable for a game window.
import Foundation
import GameController

final class InputDevices {
  let keyboard = KeyboardMouseState()
  private var observers: [NSObjectProtocol] = []
  private(set) var padName: String?

  init() {
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
      if let c = note.object as? GCController { self?.padName = c.vendorName }
    })
    observers.append(nc.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in
      self?.padName = GCController.current?.vendorName
    })
    #if os(iOS)
    observers.append(nc.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] note in
      if let kb = note.object as? GCKeyboard { self?.attachKeyboard(kb) }
    })
    if let kb = GCKeyboard.coalesced { attachKeyboard(kb) }
    #endif
    padName = GCController.current?.vendorName
  }

  deinit {
    for o in observers { NotificationCenter.default.removeObserver(o) }
  }

  #if os(iOS)
  private func attachKeyboard(_ kb: GCKeyboard) {
    let state = keyboard
    kb.keyboardInput?.keyChangedHandler = { _, _, keyCode, pressed in
      guard let code = KeyCodeMap.hid[keyCode.rawValue] else { return }
      if pressed { state.keyDown(code, isRepeat: false) } else { state.keyUp(code) }
    }
  }
  #endif

  /// The current extended gamepad as a W3C standard-mapping snapshot (nil = no pad).
  func pollPad() -> PadState? {
    guard let c = GCController.current ?? GCController.controllers().first, let g = c.extendedGamepad else { return nil }
    var p = PadState()
    func set(_ i: Int, _ b: GCControllerButtonInput?) {
      guard let b = b else { return }
      p.buttonValues[i] = Double(b.value)
      p.buttonPressed[i] = b.isPressed
    }
    set(0, g.buttonA)
    set(1, g.buttonB)
    set(2, g.buttonX)
    set(3, g.buttonY)
    set(4, g.leftShoulder)
    set(5, g.rightShoulder)
    set(6, g.leftTrigger)
    set(7, g.rightTrigger)
    set(8, g.buttonOptions)
    set(9, g.buttonMenu)
    set(10, g.leftThumbstickButton)
    set(11, g.rightThumbstickButton)
    set(12, g.dpad.up)
    set(13, g.dpad.down)
    set(14, g.dpad.left)
    set(15, g.dpad.right)
    set(16, g.buttonHome)
    // W3C: +1 = down / right; GameController: yAxis +1 = up
    p.axes[0] = Double(g.leftThumbstick.xAxis.value)
    p.axes[1] = -Double(g.leftThumbstick.yAxis.value)
    p.axes[2] = Double(g.rightThumbstick.xAxis.value)
    p.axes[3] = -Double(g.rightThumbstick.yAxis.value)
    return p
  }

  /// Collects everything for this frame (keyboard taps consumed).
  func frame(virtualAxes: [String: Double], virtualButtons: [String: Bool]) -> RawInputFrame {
    var f = RawInputFrame()
    keyboard.consume(into: &f)
    f.pad = pollPad()
    f.virtualAxes = virtualAxes
    f.virtualButtons = virtualButtons
    f.lastDevice = keyboard.lastDevice
    if let p = f.pad, p.buttonPressed.contains(true) || p.axes.contains(where: { abs($0) > 0.3 }) {
      f.lastDevice = "gamepad"
      keyboard.lastDevice = "gamepad"
    }
    return f
  }
}
