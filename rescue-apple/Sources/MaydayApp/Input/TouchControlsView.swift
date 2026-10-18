// TouchControlsView — rescue/src/ui/flight/touch.js TouchControls on UIKit multi-touch (DESIGN §3.2 «Тач»,
// PLAN §2.8): landscape only (Info.plist), a floating left stick (R 64 pt) in the left 45 % of the screen
// below the top 20 %, the altitude slider on the right with detents 90 / 40 / 15 m, the winch button 88 pt
// (hold), 56 pt buttons ПРОЖ / ФАЛЬШ / РУПОР / ПЛОТ (hold), pause 44 pt at the top centre (ui:pause).
// Everything goes through input.setVirtualAxis / setVirtualButton, so the flight model never knows the
// difference. Geometry and the stick / slider arithmetic: TouchLayout / TouchMapping (harness-checked
// against the web class). Shown while flying with touch as the active device (TouchControls.update);
// hidden, it lets every touch through to the game view (whose touchstart makes touch the active device).
// Safe-area insets are added to the web's margins (PLAN §10 X17); a press plays a light tap (TouchHaptics, X18).
#if os(iOS)
import UIKit
import MaydayCore

final class TouchControlsView: UIView {
  private unowned let input: InputState
  private let onPause: () -> Void
  var haptics: TouchHaptics?

  private enum Target: Equatable {
    case stick, slider, hold(InputAction), pause
  }

  private var layout = TouchLayout(width: 0, height: 0)
  private var on = false
  private var targets: [ObjectIdentifier: Target] = [:]
  // stick (touch.js _id / _ox / _oy)
  private var stickTouch: UITouch?
  private var stickOrigin = CGPoint.zero
  // slider (_sid)
  private var sliderTouch: UITouch?
  // hold buttons currently down (one finger each)
  private var held: [ObjectIdentifier: InputAction] = [:]

  // visuals
  private let stickRing = UIView()
  private let knob = UIView()
  private let sliderView = UIView()
  private let thumb = UIView()
  private var detentLabels: [UILabel] = []
  private let winchView = UILabel()
  private var buttonViews: [UILabel] = []
  private let pauseView = UILabel()

  // ui/hud.css tokens
  private static let fg = UIColor(red: 232 / 255, green: 228 / 255, blue: 216 / 255, alpha: 1)          // --hud-fg #E8E4D8
  private static let dim = UIColor(red: 232 / 255, green: 228 / 255, blue: 216 / 255, alpha: 0.45)      // --hud-dim
  private static let rescue = UIColor(red: 1, green: 90 / 255, blue: 31 / 255, alpha: 1)               // --rescue #FF5A1F
  private static let btnBg = UIColor(red: 6 / 255, green: 14 / 255, blue: 20 / 255, alpha: 0.45)        // .tc-btn background
  private static let btnDown = UIColor(red: 1, green: 90 / 255, blue: 31 / 255, alpha: 0.4)             // .tc-btn.down
  private static let knobBg = UIColor(red: 232 / 255, green: 228 / 255, blue: 216 / 255, alpha: 0.25)   // .tc-knob
  private static let thumbBg = UIColor(red: 232 / 255, green: 228 / 255, blue: 216 / 255, alpha: 0.35)  // .tc-thumb

  init(input: InputState, onPause: @escaping () -> Void) {
    self.input = input
    self.onPause = onPause
    super.init(frame: .zero)
    isMultipleTouchEnabled = true
    backgroundColor = .clear
    build()
    setOn(false)
  }

  required init?(coder: NSCoder) { nil }

  private func circle(_ v: UIView, border: UIColor, width: CGFloat, fill: UIColor) {
    v.layer.borderColor = border.cgColor
    v.layer.borderWidth = width
    v.backgroundColor = fill
    v.layer.masksToBounds = true
    v.isUserInteractionEnabled = false
    addSubview(v)
  }

  private func label(_ text: String, size: CGFloat, color: UIColor, into l: UILabel = UILabel()) -> UILabel {
    l.text = text
    l.font = UIFont.monospacedSystemFont(ofSize: size, weight: .semibold)
    l.textColor = color
    l.textAlignment = .center
    l.isUserInteractionEnabled = false
    return l
  }

  private func build() {
    circle(stickRing, border: TouchControlsView.dim, width: 1.5, fill: .clear)
    stickRing.addSubview(knob)
    knob.layer.borderColor = TouchControlsView.fg.cgColor
    knob.layer.borderWidth = 1.5
    knob.backgroundColor = TouchControlsView.knobBg
    knob.isUserInteractionEnabled = false
    circle(sliderView, border: TouchControlsView.dim, width: 1, fill: .clear)
    sliderView.addSubview(thumb)
    thumb.backgroundColor = TouchControlsView.thumbBg
    thumb.isUserInteractionEnabled = false
    for d in TouchMapping.detents {
      let l = label(d.label, size: 11, color: TouchControlsView.fg)
      addSubview(l)
      detentLabels.append(l)
    }
    circle(label("ЛЕБЁДКА", size: 10, color: TouchControlsView.rescue, into: winchView), border: TouchControlsView.rescue, width: 1.5,
           fill: TouchControlsView.btnBg)
    for b in TouchMapping.buttons {
      let l = label(b.label, size: 9, color: TouchControlsView.fg)
      circle(l, border: TouchControlsView.dim, width: 1.5, fill: TouchControlsView.btnBg)
      buttonViews.append(l)
    }
    circle(label("II", size: 9, color: TouchControlsView.fg, into: pauseView), border: TouchControlsView.dim, width: 1.5,
           fill: TouchControlsView.btnBg)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let s = safeAreaInsets
    layout = TouchLayout(width: Double(bounds.width), height: Double(bounds.height), safeTop: Double(s.top), safeBottom: Double(s.bottom),
                         safeRight: Double(s.right))
    let L = TouchLayout.self
    stickRing.bounds = CGRect(x: 0, y: 0, width: L.stickSize, height: L.stickSize)
    stickRing.layer.cornerRadius = CGFloat(L.stickSize / 2)
    knob.bounds = CGRect(x: 0, y: 0, width: L.knobSize, height: L.knobSize)
    knob.layer.cornerRadius = CGFloat(L.knobSize / 2)
    knob.center = CGPoint(x: L.stickSize / 2, y: L.stickSize / 2)
    sliderView.frame = layout.slider
    sliderView.layer.cornerRadius = CGFloat(L.sliderWidth / 2)
    thumb.bounds = CGRect(x: 0, y: 0, width: L.thumbWidth, height: L.thumbHeight)
    thumb.layer.cornerRadius = CGFloat(L.thumbHeight / 2)
    if sliderTouch == nil { thumb.center = CGPoint(x: L.sliderWidth / 2, y: L.sliderHeight / 2) }
    for (l, r) in zip(detentLabels, layout.detents) { l.frame = r }
    winchView.frame = layout.winch
    winchView.layer.cornerRadius = CGFloat(L.winchSize / 2)
    for (v, r) in zip(buttonViews, layout.buttons) {
      v.frame = r
      v.layer.cornerRadius = CGFloat(L.buttonSize / 2)
    }
    pauseView.frame = layout.pause
    pauseView.layer.cornerRadius = CGFloat(L.pauseSize / 2)
  }

  // ---- visibility (TouchControls.update) ---------------------------------------------------------------
  func setOn(_ show: Bool) {
    if show == on { return }
    on = show
    for v in subviews { v.isHidden = !show }
    stickRing.isHidden = !show || stickTouch == nil
    if !show { releaseAll() }
  }

  /// Hidden mid-gesture (pause, mode change): nothing may stay pressed.
  private func releaseAll() {
    if stickTouch != nil {
      stickTouch = nil
      input.setVirtualAxis(.moveX, 0)
      input.setVirtualAxis(.moveY, 0)
    }
    if sliderTouch != nil {
      sliderTouch = nil
      input.setVirtualAxis(.lift, 0)
    }
    for (_, a) in held { input.setVirtualButton(a, false) }
    held.removeAll()
    targets.removeAll()
    refreshButtons()
  }

  // ---- hit testing: only the controls catch touches, and only while shown ------------------------------
  private func target(at p: CGPoint) -> Target? {
    guard on else { return nil }
    func inCircle(_ r: CGRect) -> Bool {
      let dx = p.x - r.midX, dy = p.y - r.midY
      return dx * dx + dy * dy <= (r.width / 2) * (r.width / 2)
    }
    if inCircle(layout.pause) { return .pause }
    if inCircle(layout.winch) { return .hold(.winch) }
    for (r, b) in zip(layout.buttons, TouchMapping.buttons) where inCircle(r) { return .hold(b.action) }
    for (r, d) in zip(layout.detents, TouchMapping.detents) where r.contains(p) { return .hold(d.action) }
    if layout.slider.contains(p) { return .slider }
    if layout.stickZone.contains(p) { return .stick }
    return nil
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { target(at: point) != nil }

  // ---- touches ---------------------------------------------------------------------------------------------
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    input.touchStart()
    var stickStarted = false, sliderStarted = false
    for t in touches {
      guard let tg = target(at: t.location(in: self)) else { continue }
      targets[ObjectIdentifier(t)] = tg
      switch tg {
      case .stick:
        // _start(e): changedTouches[0] becomes the stick finger (a second finger in the zone re-anchors it)
        if stickStarted { continue }
        stickStarted = true
        stickTouch = t
        stickOrigin = t.location(in: self)
        stickRing.center = stickOrigin
        stickRing.isHidden = false
        knob.center = CGPoint(x: TouchLayout.stickSize / 2, y: TouchLayout.stickSize / 2)
      case .slider:
        if sliderStarted { continue }
        sliderStarted = true
        sliderTouch = t
        slide(t)
      case .hold(let a):
        held[ObjectIdentifier(t)] = a
        input.setVirtualButton(a, true)
        haptics?.tap()
      case .pause:
        onPause()
        haptics?.tap()
      }
    }
    refreshButtons()
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      if t === stickTouch {
        let p = t.location(in: self)
        let m = TouchMapping.stick(dx: Double(p.x - stickOrigin.x), dy: Double(p.y - stickOrigin.y))
        knob.center = CGPoint(x: TouchLayout.stickSize / 2 + m.knobX, y: TouchLayout.stickSize / 2 + m.knobY)
        input.setVirtualAxis(.moveX, m.moveX)
        input.setVirtualAxis(.moveY, m.moveY)
      } else if t === sliderTouch {
        slide(t)
      }
    }
  }

  private func slide(_ t: UITouch) {
    let y = Double(t.location(in: self).y)
    let r = layout.slider
    let s = TouchMapping.slider(y: y, top: Double(r.minY), height: Double(r.height))
    input.setVirtualAxis(.lift, s.lift)
    thumb.center = CGPoint(x: TouchLayout.sliderWidth / 2, y: TouchLayout.sliderHeight / 2 + s.thumbY)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { end(touches) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { end(touches) }

  private func end(_ touches: Set<UITouch>) {
    for t in touches {
      let id = ObjectIdentifier(t)
      let tg = targets.removeValue(forKey: id)
      if t === stickTouch {
        stickTouch = nil
        stickRing.isHidden = true
        input.setVirtualAxis(.moveX, 0)
        input.setVirtualAxis(.moveY, 0)
      }
      if tg == .slider {
        // the slider's touchend clears the lift whichever finger lifted (touch.js sEnd)
        sliderTouch = nil
        input.setVirtualAxis(.lift, 0)
        thumb.center = CGPoint(x: TouchLayout.sliderWidth / 2, y: TouchLayout.sliderHeight / 2)
      }
      if let a = held.removeValue(forKey: id) {
        // another finger may still hold the same button
        if !held.values.contains(a) { input.setVirtualButton(a, false) }
      }
    }
    refreshButtons()
  }

  /// .tc-btn.down
  private func refreshButtons() {
    let down = Set(held.values.map(\.rawValue))
    winchView.backgroundColor = down.contains(InputAction.winch.rawValue) ? TouchControlsView.btnDown : TouchControlsView.btnBg
    for (v, b) in zip(buttonViews, TouchMapping.buttons) {
      let d = down.contains(b.action.rawValue)
      v.backgroundColor = d ? TouchControlsView.btnDown : TouchControlsView.btnBg
      v.layer.borderColor = (d ? TouchControlsView.rescue : TouchControlsView.dim).cgColor
    }
  }
}
#endif
