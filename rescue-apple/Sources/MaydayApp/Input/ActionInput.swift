// ActionInput — named game actions from raw devices.
// port: rescue/src/core/input.js Input.poll()/axis()/move()/down()/pressed()/released()/rawPressed()
// with BINDINGS + PAD from input.json `core/input` (keyboard by KeyboardEvent.code, W3C pad indices):
//   * axes moveX / moveY / lift from keys (−1 / +1); lift from the analog triggers RT − LT when
//     |RT − LT| > 0.08; virtual (touch) axes override when |v| > 0.02;
//   * sticks: radial dead zone 0.14, response 0.55m + 0.45m³ (DESIGN §3.2), stick vs keys: the
//     stronger one wins; touch owns movement when active;
//   * buttons: any bound key / mouse button / tap, or any mapped pad button, or a virtual button.
//
// BOOTSTRAP: MaydayCore/Input/InputState.swift + Bindings.swift are the parity port (settings
// rebinding, haptics, menus); this mirror drives the M0 probe and camera.
import Foundation

final class ActionInput {
  private var axisBindings: [(name: String, neg: [String], pos: [String])] = []
  private var buttonBindings: [(name: String, keys: [String])] = []
  private var padAxes: [String: Int] = [:]
  private var padLiftUp = 7
  private var padLiftDown = 6
  private var padButtons: [String: [Int]] = [:]

  private(set) var axes: [String: Double] = ["moveX": 0, "moveY": 0, "lift": 0, "aimX": 0, "aimY": 0]
  private var buttons: [String: Bool] = [:]
  private var prevButtons: [String: Bool] = [:]
  private(set) var anyPressedThisFrame = false
  private(set) var lastRaw = RawInputFrame()
  private var prevPadPressed = [Bool](repeating: false, count: 17)
  private var prevKeys: Set<String> = []
  var enabled = true

  /// json: input.json data["core/input"].
  init(json: BootJSON) {
    let b = json["BINDINGS"]
    for name in ["moveX", "moveY", "lift"] {            // Object.keys(BINDINGS.axes) order
      let pair = b["axes"][name]
      axisBindings.append((name, pair[0].strings, pair[1].strings))
    }
    for name in b["buttons"].keys.sorted() {
      buttonBindings.append((name, b["buttons"][name].strings))
    }
    let pad = json["PAD"]
    for name in pad["axes"].keys { if let i = pad["axes"][name].int { padAxes[name] = i } }
    padLiftUp = pad["lift"]["up"].int(or: 7)
    padLiftDown = pad["lift"]["down"].int(or: 6)
    for name in pad["buttons"].keys { padButtons[name] = pad["buttons"][name].array.compactMap { $0.int } }
  }

  private func stick(_ pad: PadState, _ ix: Int, _ iy: Int) -> SIMD2<Double>? {
    guard ix >= 0, iy >= 0, ix < pad.axes.count, iy < pad.axes.count else { return nil }
    let x = pad.axes[ix]
    let y = -pad.axes[iy]                                 // pad Y is +1 down; ours is +1 = north / screen up
    let m = (x * x + y * y).squareRoot()
    if m < 0.14 { return nil }
    let mm = min(1, (m - 0.14) / 0.86)
    let k = (0.55 * mm + 0.45 * mm * mm * mm) / m
    return SIMD2<Double>(min(max(x * k, -1), 1), min(max(y * k, -1), 1))
  }

  /// Called once per frame before the simulation updates (main.js).
  func poll(_ raw: RawInputFrame) {
    prevPadPressed = lastRaw.pad?.buttonPressed ?? [Bool](repeating: false, count: 17)
    prevKeys = lastRaw.keys.union(lastRaw.taps)
    lastRaw = raw
    let prevAny = anyPressedThisFrame
    anyPressedThisFrame = false
    let held: (String) -> Bool = { raw.keys.contains($0) || raw.taps.contains($0) }

    for ab in axisBindings {
      var v = 0.0
      if ab.neg.contains(where: held) { v -= 1 }
      if ab.pos.contains(where: held) { v += 1 }
      if let pad = raw.pad, ab.name == "lift", padLiftUp < pad.buttonValues.count, padLiftDown < pad.buttonValues.count {
        let up = pad.buttonValues[padLiftUp]
        let down = pad.buttonValues[padLiftDown]
        if abs(up - down) > 0.08 { v = up - down }
      }
      if let va = raw.virtualAxes[ab.name], abs(va) > 0.02 { v = va }
      axes[ab.name] = min(max(v, -1), 1)
    }
    if let pad = raw.pad {
      let vm = (raw.virtualAxes["moveX"] ?? 0) != 0 || (raw.virtualAxes["moveY"] ?? 0) != 0
      let mv = vm ? nil : stick(pad, padAxes["moveX"] ?? 0, padAxes["moveY"] ?? 1)
      let ax = axes["moveX"] ?? 0
      let ay = axes["moveY"] ?? 0
      if let mv = mv, (mv.x * mv.x + mv.y * mv.y).squareRoot() > (ax * ax + ay * ay).squareRoot() {
        axes["moveX"] = mv.x
        axes["moveY"] = mv.y
      }
      let aim = stick(pad, padAxes["aimX"] ?? 2, padAxes["aimY"] ?? 3)
      axes["aimX"] = aim?.x ?? 0
      axes["aimY"] = aim?.y ?? 0
    } else {
      axes["aimX"] = raw.virtualAxes["aimX"] ?? 0
      axes["aimY"] = raw.virtualAxes["aimY"] ?? 0
    }

    for bb in buttonBindings {
      var down = bb.keys.contains { raw.keys.contains($0) || raw.mouseButtons.contains($0) || raw.taps.contains($0) }
      if let pad = raw.pad, let idx = padButtons[bb.name] {
        down = down || idx.contains { $0 >= 0 && $0 < pad.buttonPressed.count && pad.buttonPressed[$0] }
      }
      if raw.virtualButtons[bb.name] == true { down = true }
      let was = buttons[bb.name] ?? false
      prevButtons[bb.name] = was
      buttons[bb.name] = down
      if down && !was { anyPressedThisFrame = true }
    }
    if !raw.mouseButtons.isEmpty { anyPressedThisFrame = anyPressedThisFrame || !prevAny }
    if !raw.taps.isEmpty { anyPressedThisFrame = true }
  }

  func axis(_ name: String) -> Double { enabled ? (axes[name] ?? 0) : 0 }

  /// Movement vector with length ≤ 1 (x = east / right, y = north / up on screen).
  func move() -> SIMD2<Double> {
    var x = axis("moveX")
    var y = axis("moveY")
    let len = (x * x + y * y).squareRoot()
    if len > 1 {
      x /= len
      y /= len
    }
    return SIMD2<Double>(x, y)
  }

  func down(_ name: String) -> Bool { enabled && (buttons[name] ?? false) }
  /// True only on the frame the button went down.
  func pressed(_ name: String) -> Bool { enabled && (buttons[name] ?? false) && !(prevButtons[name] ?? false) }
  func released(_ name: String) -> Bool { enabled && !(buttons[name] ?? false) && (prevButtons[name] ?? false) }
  /// Ignores `enabled` (menus use it while gameplay input is disabled).
  func rawPressed(_ name: String) -> Bool { (buttons[name] ?? false) && !(prevButtons[name] ?? false) }

  // ---- debug-only raw edges (bootstrap hotkeys outside the game's bindings) ----------------------
  func rawKeyPressed(_ code: String) -> Bool {
    (lastRaw.keys.contains(code) || lastRaw.taps.contains(code)) && !prevKeys.contains(code)
  }

  func rawPadPressed(_ index: Int) -> Bool {
    guard let p = lastRaw.pad, index >= 0, index < p.buttonPressed.count, index < prevPadPressed.count else { return false }
    return p.buttonPressed[index] && !prevPadPressed[index]
  }
}
