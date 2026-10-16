// RawInput — device state collected by the platform adapters, consumed once per frame by
// ActionInput.poll() (the web's Input: keys / _taps / mouseButtons / navigator.getGamepads()).
// RawInputFrame is the replay boundary (PLAN §2.8: recorded RawInputFrames drive replay_op1).
import Foundation

/// One W3C "standard" gamepad snapshot: 17 buttons (value 0..1, pressed), 4 axes
/// (leftX, leftY +down, rightX, rightY +down) — the indices input.json PAD refers to.
struct PadState {
  var buttonValues = [Double](repeating: 0, count: 17)
  var buttonPressed = [Bool](repeating: false, count: 17)
  var axes = [Double](repeating: 0, count: 4)
}

struct RawInputFrame {
  var keys: Set<String> = []          // KeyboardEvent.code held
  var taps: Set<String> = []          // went down since the last poll (taps shorter than a frame count)
  var mouseButtons: Set<String> = []  // "Mouse0" | "Mouse2" (presses that started on the game view)
  var pad: PadState?
  var virtualAxes: [String: Double] = [:]
  var virtualButtons: [String: Bool] = [:]
  var mouseNDC = SIMD2<Double>(0, 0)
  var wheel: Double = 0
  var lastDevice = "keyboard"
}

/// Keyboard + mouse state fed by platform events on the main thread (web Input listeners).
final class KeyboardMouseState {
  private(set) var keys: Set<String> = []
  private var taps: Set<String> = []
  private(set) var mouseButtons: Set<String> = []
  private var wheel: Double = 0
  var mouseNDC = SIMD2<Double>(0, 0)
  var lastDevice = "keyboard"

  func keyDown(_ code: String, isRepeat: Bool) {
    keys.insert(code)
    if !isRepeat { taps.insert(code) }
    lastDevice = "keyboard"
  }

  func keyUp(_ code: String) {
    keys.remove(code)
  }

  func mouseDown(_ name: String) {
    mouseButtons.insert(name)
    taps.insert(name)
  }

  func mouseUp(_ name: String) {
    mouseButtons.remove(name)
  }

  func addWheel(_ steps: Double) { wheel += steps }

  /// window blur: forget everything held (a keyup lost behind Cmd-Tab must not stick).
  func blur() {
    keys.removeAll()
    taps.removeAll()
    mouseButtons.removeAll()
  }

  /// Snapshot for this frame; taps and wheel are consumed.
  func consume(into frame: inout RawInputFrame) {
    frame.keys = keys
    frame.taps = taps
    frame.mouseButtons = mouseButtons
    frame.mouseNDC = mouseNDC
    frame.wheel = wheel
    taps.removeAll()
    wheel = 0
  }
}
