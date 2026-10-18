// GamepadAdapter — GameController → the web's navigator.getGamepads() (PLAN §2.8 «Ввод»):
//   * every extended gamepad, in connection order, as a W3C "standard" GamepadSnapshot: buttons 0 A, 1 B,
//     2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT (analog), 8 View, 9 Menu, 10 L3, 11 R3, 12–15 D-pad ↑ ↓ ← →,
//     16 Home; axes leftX, leftY (+1 = down), rightX, rightY (+1 = down); hasVibration = the pad has
//     haptics. InputState picks the first connected one (core/input.js _pad) and maps it with input.json PAD;
//   * the hardware keyboard on iOS / iPadOS: GCKeyboard keyChangedHandler (HID usage → KeyboardEvent.code).
//     macOS reads the keyboard through NSEvent in GameMTKView instead (GCKeyboard on the Mac reads HID
//     directly and triggers the "Input Monitoring" permission prompt);
//   * the debug chord (outside the game's bindings): hold View and press LB / RB (previous / next weather),
//     Y (quality), R3 (debug overlay), Menu (restart the flight). The chord's buttons are hidden from the
//     game while View is held, so the chord never also boosts, zooms, honks or pauses.
// All handlers run on the main queue (GCController.handlerQueue default), where the game loop lives.
import Foundation
import GameController
import MaydayCore

/// A debug command from a keyboard key, a pad chord or a debug-overlay button.
enum DebugCommand {
  case previousPreset, nextPreset, cycleQuality, toggleOverlay, restart
}

final class GamepadAdapter {
  /// Extended gamepads in connection order (the web keeps navigator.getGamepads() index order).
  private(set) var controllers: [GCController] = []
  /// Called for keyboard keys on iOS (GCKeyboard): (code, down).
  var onKey: ((String, Bool) -> Void)?
  var onDebug: ((DebugCommand) -> Void)?
  private var observers: [NSObjectProtocol] = []
  private var chordPrev = Set<Int>()
  /// The W3C buttons of the debug chord: LB, RB, Y, R3, Menu (View = 8 holds it).
  static let chordButtons: [Int: DebugCommand] = [4: .previousPreset, 5: .nextPreset, 3: .cycleQuality, 11: .toggleOverlay, 9: .restart]
  static let chordHold = 8

  init() {
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
      guard let self, let c = note.object as? GCController, c.extendedGamepad != nil else { return }
      if !self.controllers.contains(where: { $0 === c }) { self.controllers.append(c) }
    })
    observers.append(nc.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] note in
      guard let self, let c = note.object as? GCController else { return }
      self.controllers.removeAll { $0 === c }
    })
    #if os(iOS)
    observers.append(nc.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] note in
      if let kb = note.object as? GCKeyboard { self?.attachKeyboard(kb) }
    })
    if let kb = GCKeyboard.coalesced { attachKeyboard(kb) }
    #endif
    controllers = GCController.controllers().filter { $0.extendedGamepad != nil }
  }

  deinit {
    for o in observers { NotificationCenter.default.removeObserver(o) }
  }

  #if os(iOS)
  private func attachKeyboard(_ kb: GCKeyboard) {
    kb.keyboardInput?.keyChangedHandler = { [weak self] _, _, keyCode, pressed in
      guard let code = KeyCodeMap.hid[keyCode.rawValue] else { return }
      self?.onKey?(code, pressed)
    }
  }
  #endif

  /// The pad the game reads first (and rumbles): the first connected extended gamepad.
  var activeController: GCController? { controllers.first }

  /// The vendor name of the active pad (debug overlay).
  var padName: String? { activeController?.vendorName }

  /// navigator.getGamepads() for this frame (debug chord handled and filtered).
  func snapshots() -> [GamepadSnapshot?] {
    var out: [GamepadSnapshot?] = []
    for (i, c) in controllers.enumerated() {
      guard var p = GamepadAdapter.snapshot(c) else { continue }
      if i == 0 { filterChord(&p) }
      out.append(p)
    }
    return out
  }

  /// The debug chord on the active pad: rising edges while View is held fire commands; the chord's buttons
  /// (and their edges) never reach the game.
  private func filterChord(_ p: inout GamepadSnapshot) {
    let holding = p.buttons[GamepadAdapter.chordHold].pressed
    var now = Set<Int>()
    for (b, cmd) in GamepadAdapter.chordButtons where p.buttons[b].pressed {
      now.insert(b)
      if holding && !chordPrev.contains(b) { onDebug?(cmd) }
    }
    if holding {
      for b in GamepadAdapter.chordButtons.keys { p.buttons[b] = GamepadSnapshot.Button() }
    }
    chordPrev = now
  }

  /// One extended gamepad as a W3C standard-mapping snapshot.
  static func snapshot(_ c: GCController) -> GamepadSnapshot? {
    guard let g = c.extendedGamepad else { return nil }
    var p = GamepadSnapshot(connected: true, hasVibration: c.haptics != nil)
    func set(_ i: Int, _ b: GCControllerButtonInput?) {
      guard let b else { return }
      p.buttons[i] = GamepadSnapshot.Button(pressed: b.isPressed, value: Double(b.value))
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
    p.axes = [Double(g.leftThumbstick.xAxis.value), -Double(g.leftThumbstick.yAxis.value),
              Double(g.rightThumbstick.xAxis.value), -Double(g.rightThumbstick.yAxis.value)]
    return p
  }
}
