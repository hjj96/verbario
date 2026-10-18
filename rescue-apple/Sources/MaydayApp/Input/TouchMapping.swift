// TouchMapping — the arithmetic of rescue/src/ui/flight/touch.js TouchControls, free of UIKit so the
// applecheck harness checks it against the real web class (Tests/Vectors/app/touch.json, driven through
// synthetic touch events by tools/export/export-app.mjs):
//   stick  : floating, radius STICK_R = 64 px; d > R is clamped to R; moveX = dx / R, moveY = −dy / R
//            (screen up = north), the knob sits at (dx, dy);
//   slider : k = clamp((top + h/2 − y) / (h/2), −1, 1); lift = |k| < 0.12 ? 0 : k; thumb translateY(−k·h/2);
//   detents: 90 / 40 / 15 m at 12 % / 48 % / 82 % of the slider height → altPreset3 / 2 / 1 (hold buttons).
// Layout (ui/hud.css .hud-touch, in CSS px = points): see TouchLayout.
import Foundation
import MaydayCore

enum TouchMapping {
  /// touch.js STICK_R
  static let stickRadius: Double = 64
  /// _slide(): |k| < 0.12 → 0
  static let sliderDeadZone: Double = 0.12

  /// _move(): the knob offset and the two virtual axes for a finger at (dx, dy) from the stick origin.
  static func stick(dx dx0: Double, dy dy0: Double) -> (moveX: Double, moveY: Double, knobX: Double, knobY: Double) {
    var dx = dx0
    var dy = dy0
    let d = JS.hypot(dx, dy)
    let R = stickRadius
    if d > R {
      dx *= R / d
      dy *= R / d
    }
    return (dx / R, -dy / R, dx, dy)
  }

  /// _slide(): the lift axis and the thumb's vertical offset for a finger at `y` on a slider whose
  /// bounding rect starts at `top` and is `height` tall.
  static func slider(y: Double, top: Double, height: Double) -> (lift: Double, thumbY: Double) {
    let k = JS.max(-1, JS.min(1, (top + height / 2 - y) / (height / 2)))
    return (JS.abs(k) < sliderDeadZone ? 0 : k, (-k * height) / 2)
  }

  /// The detents: [height label, action, fraction of the slider height].
  static let detents: [(label: String, action: InputAction, frac: Double)] = [
    ("90", .altPreset3, 0.12), ("40", .altPreset2, 0.48), ("15", .altPreset1, 0.82),
  ]

  /// The hold buttons below the winch, in grid order: [label, action].
  static let buttons: [(label: String, action: InputAction)] = [
    ("ПРОЖ", .searchlight), ("ФАЛЬШ", .flare), ("РУПОР", .horn), ("ПЛОТ", .raftDrop),
  ]

  /// TouchControls.update(): the controls show in flight on a touch device.
  static func visible(mode: GameMode, lastDevice: InputDevice) -> Bool { mode == .play && lastDevice == .touch }
}

/// ui/hud.css `.hud-touch` geometry in CSS px (= points), and where it lands for a given view size.
struct TouchLayout {
  // .tc-zone { left: 0; top: 20%; bottom: 0; width: 45% }
  static let zoneTop = 0.20, zoneWidth = 0.45
  // .tc-stick 128 × 128 (border 1.5 px), .tc-knob 56 × 56
  static let stickSize = 128.0, knobSize = 56.0
  // .tc-right { right: 24px; bottom: 90px; top: 30%; display: flex; gap: 18px; align-items: flex-end }
  static let rightInset = 24.0, bottomInset = 90.0, groupGap = 18.0
  // .tc-slider 44 × 220 (radius 22), .tc-thumb 30 × 32 at left 6, top calc(50% − 16px)
  static let sliderWidth = 44.0, sliderHeight = 220.0, thumbWidth = 30.0, thumbHeight = 32.0
  // .tc-detent { left: −36px; padding: 6px; font: 600 11px mono }: a two-digit label ≈ 26 × 23 px
  static let detentLeft = -36.0, detentWidth = 26.0, detentHeight = 23.0
  // .tc-btns: grid of 2 × 56 px, gap 10; .tc-winch 88 × 88 spanning both columns
  static let buttonSize = 56.0, buttonGap = 10.0, winchSize = 88.0
  // .tc-pause 44 × 44, top 24, centred
  static let pauseSize = 44.0, pauseTop = 24.0

  var stickZone: CGRect
  var slider: CGRect
  var detents: [CGRect]
  var winch: CGRect
  var buttons: [CGRect]
  var pause: CGRect

  /// `safe`: the view's safe-area insets (top, left, bottom, right), added to the web's own margins.
  init(width w: Double, height h: Double, safeTop: Double = 0, safeLeft: Double = 0, safeBottom: Double = 0, safeRight: Double = 0) {
    let L = TouchLayout.self
    stickZone = CGRect(x: 0, y: h * L.zoneTop, width: w * L.zoneWidth, height: h * (1 - L.zoneTop))
    let gridW = 2 * L.buttonSize + L.buttonGap
    let gridH = L.winchSize + 2 * (L.buttonGap + L.buttonSize)
    let right = w - L.rightInset - safeRight
    let bottom = h - L.bottomInset - safeBottom
    let gridX = right - gridW
    let sliderX = gridX - L.groupGap - L.sliderWidth
    slider = CGRect(x: sliderX, y: bottom - L.sliderHeight, width: L.sliderWidth, height: L.sliderHeight)
    let sl = slider
    detents = TouchMapping.detents.map { d in
      CGRect(x: Double(sl.minX) + L.detentLeft, y: Double(sl.minY) + d.frac * L.sliderHeight - L.detentHeight / 2,
             width: L.detentWidth, height: L.detentHeight)
    }
    let gridY = bottom - gridH
    winch = CGRect(x: gridX + (gridW - L.winchSize) / 2, y: gridY, width: L.winchSize, height: L.winchSize)
    var b: [CGRect] = []
    for i in 0..<TouchMapping.buttons.count {
      let col = Double(i % 2), row = Double(i / 2)
      b.append(CGRect(x: gridX + col * (L.buttonSize + L.buttonGap), y: gridY + L.winchSize + L.buttonGap + row * (L.buttonSize + L.buttonGap),
                      width: L.buttonSize, height: L.buttonSize))
    }
    buttons = b
    pause = CGRect(x: w / 2 - L.pauseSize / 2, y: L.pauseTop + safeTop, width: L.pauseSize, height: L.pauseSize)
    _ = safeLeft
  }
}
