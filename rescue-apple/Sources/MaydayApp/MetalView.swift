// MetalView — SwiftUI host of the game's MTKView (PLAN §2.8: UIViewRepresentable / NSViewRepresentable
// around MTKView, delegate = GameHost via MetalViewDelegate), and the platform input core/input.js gets
// from DOM listeners, fed into MaydayCore's InputState:
//   macOS  keyboard through NSEvent: keyDown / keyUp / flagsChanged → KeyboardEvent.code (KeyCodeMap,
//          positional, ЙЦУКЕН works; swallowed, so no system beep; menu key equivalents such as ⌘Q run
//          before keyDown), mouse: move / drag → mouseMove (CSS-px points from the top-left), left / right
//          buttons → Mouse0 / Mouse2 on the game view, wheel → wheel(deltaY) (the browser's deltaY sign,
//          natural scrolling included); window blur → input.blur();
//   iOS    a touch on the game view makes touch the active device (window touchstart); pointer clicks
//          (iPad trackpad / mouse, indirect touches) are mouse buttons + position, and the hovering pointer
//          (UIHoverGestureRecognizer) is mousemove, so the nose follows the cursor without a click like on
//          the web / Mac; TouchControlsView sits on top (stick, slider, buttons); the hardware keyboard
//          arrives through GCKeyboard (GamepadAdapter).
import SwiftUI
import MetalKit
import MaydayCore
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// MTKViewDelegate lives in its own small class so the (possibly @MainActor-annotated) delegate
/// protocol never imposes actor isolation on GameHost.
final class MetalViewDelegate: NSObject, MTKViewDelegate {
  let host: GameHost
  init(host: GameHost) { self.host = host }
  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { host.drawableSizeWillChange(size) }
  func draw(in view: MTKView) { host.frame(view) }
}

#if os(iOS)
final class GameMTKView: MTKView {
  weak var host: GameHost?
  private(set) var touchControls: TouchControlsView?

  override init(frame frameRect: CGRect, device: MTLDevice?) {
    super.init(frame: frameRect, device: device)
    isMultipleTouchEnabled = true
    addHoverRecognizer()
  }

  required init(coder: NSCoder) {
    super.init(coder: coder)
    isMultipleTouchEnabled = true
    addHoverRecognizer()
  }

  /// iPad trackpad / mouse: the touches only carry the pointer while a button is held; hover is a gesture.
  private func addHoverRecognizer() {
    #if canImport(ObjectiveC)   // target–action needs the Objective-C runtime (absent in the Linux pre-flight)
    addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(hoverChanged(_:))))
    #endif
  }

  #if canImport(ObjectiveC)
  @objc private func hoverChanged(_ r: UIHoverGestureRecognizer) { hover(r) }
  #endif

  /// mousemove without a button: .began / .changed move the pointer (like pointer(_:) for a pressed one).
  private func hover(_ r: UIHoverGestureRecognizer) {
    switch r.state {
    case .began, .changed: pointerMoved(to: r.location(in: self))
    default: break
    }
  }

  /// Adds the touch controls (once the host's input exists).
  func attach(host: GameHost) {
    self.host = host
    guard touchControls == nil, let input = host.input else { return }
    let tc = TouchControlsView(input: input, onPause: { [weak host] in host?.touchPause() })
    tc.haptics = host.touchHaptics
    tc.frame = bounds
    tc.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(tc)
    touchControls = tc
  }

  private func pointer(_ t: UITouch) { pointerMoved(to: t.location(in: self)) }

  /// mousemove at `p` (points from the top-left, the DOM's clientX / clientY).
  private func pointerMoved(to p: CGPoint) {
    guard let s = host?.session, bounds.width > 0, bounds.height > 0 else { return }
    s.input.mouseMove(x: Double(p.x), y: Double(p.y), viewWidth: Double(bounds.width), viewHeight: Double(bounds.height), nowMs: s.clockMs)
  }

  private static func button(_ event: UIEvent?) -> Int {
    (event?.buttonMask.contains(.secondary) ?? false) ? 2 : 0
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let s = host?.session else { return }
    for t in touches {
      if t.type == .indirectPointer {
        pointer(t)
        s.input.mouseDown(button: GameMTKView.button(event), onGameView: true, nowMs: s.clockMs)
      } else {
        s.input.touchStart()
      }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches where t.type == .indirectPointer { pointer(t) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { endPointer(touches, event) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { endPointer(touches, event) }

  private func endPointer(_ touches: Set<UITouch>, _ event: UIEvent?) {
    guard let s = host?.session else { return }
    for t in touches where t.type == .indirectPointer {
      s.input.mouseUp(button: 0)
      s.input.mouseUp(button: 2)
    }
  }
}

struct MetalView: UIViewRepresentable {
  let host: GameHost

  func makeCoordinator() -> MetalViewDelegate { MetalViewDelegate(host: host) }

  func makeUIView(context: Context) -> GameMTKView {
    let v = GameMTKView(frame: .zero, device: host.metalDevice)
    v.attach(host: host)
    host.configure(v)
    v.delegate = context.coordinator
    return v
  }

  func updateUIView(_ uiView: GameMTKView, context: Context) {}
}

#elseif os(macOS)
final class GameMTKView: MTKView {
  weak var host: GameHost?
  private var resignObserver: NSObjectProtocol?
  private var trackingArea: NSTrackingArea?
  /// Physical modifiers currently down (flagsChanged reports the whole mask).
  private var modifiers = Set<String>()

  override var acceptsFirstResponder: Bool { true }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    window?.makeFirstResponder(self)
    window?.acceptsMouseMovedEvents = true
    if let o = resignObserver { NotificationCenter.default.removeObserver(o) }
    resignObserver = nil
    if let w = window {
      // queue: .main → the (@Sendable) block runs on the main thread, where the view lives
      resignObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: w, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { () -> Void in self?.blur() }
      }
    }
  }

  deinit {
    if let o = resignObserver { NotificationCenter.default.removeObserver(o) }
  }

  /// window blur: InputState forgets every key (a keyup lost behind ⌘-Tab must not stick).
  private func blur() {
    modifiers.removeAll()
    host?.session?.input.blur()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let t = trackingArea { removeTrackingArea(t) }
    let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
    addTrackingArea(t)
    trackingArea = t
  }

  // ---- keyboard (swallowed: no beep) ----
  override func keyDown(with event: NSEvent) {
    guard let code = KeyCodeMap.mac[event.keyCode] else { return }
    host?.keyDown(code, isRepeat: event.isARepeat)
  }

  override func keyUp(with event: NSEvent) {
    guard let code = KeyCodeMap.mac[event.keyCode] else { return }
    host?.keyUp(code)
  }

  override func flagsChanged(with event: NSEvent) {
    guard let host else { return }
    let raw = event.modifierFlags.rawValue
    for m in KeyCodeMap.macModifierMasks {
      let isDown = raw & m.mask != 0
      let wasDown = modifiers.contains(m.code)
      if isDown && !wasDown {
        modifiers.insert(m.code)
        host.keyDown(m.code, isRepeat: false)
      }
      if !isDown && wasDown {
        modifiers.remove(m.code)
        host.keyUp(m.code)
      }
    }
  }

  // ---- mouse ----
  private func updatePointer(_ event: NSEvent) {
    guard let s = host?.session, bounds.width > 0, bounds.height > 0 else { return }
    let p = convert(event.locationInWindow, from: nil)
    // NSView y grows upward (non-flipped): the DOM's clientY = height − y
    s.input.mouseMove(x: Double(p.x), y: Double(bounds.height - p.y), viewWidth: Double(bounds.width), viewHeight: Double(bounds.height),
                      nowMs: s.clockMs)
  }

  override func mouseMoved(with event: NSEvent) { updatePointer(event) }
  override func mouseDragged(with event: NSEvent) { updatePointer(event) }
  override func rightMouseDragged(with event: NSEvent) { updatePointer(event) }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    updatePointer(event)
    guard let s = host?.session else { return }
    s.input.mouseDown(button: 0, onGameView: true, nowMs: s.clockMs)
  }

  override func mouseUp(with event: NSEvent) { host?.session?.input.mouseUp(button: 0) }

  override func rightMouseDown(with event: NSEvent) {
    updatePointer(event)
    guard let s = host?.session else { return }
    s.input.mouseDown(button: 2, onGameView: true, nowMs: s.clockMs)
  }

  override func rightMouseUp(with event: NSEvent) { host?.session?.input.mouseUp(button: 2) }

  override func scrollWheel(with event: NSEvent) {
    // WheelEvent.deltaY > 0 = scroll down (towards the user); NSEvent's scrollingDeltaY has the opposite sign
    let d = Double(event.scrollingDeltaY)
    if d != 0 { host?.session?.input.wheel(deltaY: -d) }
  }
}

struct MetalView: NSViewRepresentable {
  let host: GameHost

  func makeCoordinator() -> MetalViewDelegate { MetalViewDelegate(host: host) }

  func makeNSView(context: Context) -> GameMTKView {
    let v = GameMTKView(frame: .zero, device: host.metalDevice)
    v.host = host
    host.configure(v)
    v.delegate = context.coordinator
    return v
  }

  func updateNSView(_ nsView: GameMTKView, context: Context) {}
}
#endif
