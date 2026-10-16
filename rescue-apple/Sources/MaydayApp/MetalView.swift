// MetalView — SwiftUI host of the game's MTKView (PLAN §2.8: UIViewRepresentable /
// NSViewRepresentable around MTKView, delegate = GameHost via MetalViewDelegate).
//
// GameMTKView adds the platform input that GameController does not cover:
//   macOS: keyboard through NSEvent (keyDown / keyUp / flagsChanged → KeyboardEvent.code; swallowed,
//          so no system beep), mouse buttons (Mouse0 / Mouse2), wheel, pointer NDC; blur on resign key;
//   iOS:   a floating virtual stick on the left half of the screen (touch.js: radius 64 pt) →
//          virtual axes moveX / moveY; full touch controls (lift slider, buttons) land with
//          TouchControlsView in M4.
import SwiftUI
import MetalKit
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
  private var stickTouch: UITouch?
  private var stickOrigin = CGPoint.zero
  private let stickRadius: CGFloat = 64

  override init(frame frameRect: CGRect, device: MTLDevice?) {
    super.init(frame: frameRect, device: device)
    isMultipleTouchEnabled = true
  }

  required init(coder: NSCoder) {
    super.init(coder: coder)
    isMultipleTouchEnabled = true
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches where stickTouch == nil {
      let p = t.location(in: self)
      if p.x < bounds.width * 0.5 {
        stickTouch = t
        stickOrigin = p
        host?.setVirtualStick(SIMD2<Double>(0, 0))
      }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let st = stickTouch, touches.contains(st) else { return }
    let p = st.location(in: self)
    var dx = Double((p.x - stickOrigin.x) / stickRadius)
    var dy = Double(-(p.y - stickOrigin.y) / stickRadius)   // screen up = north = +moveY
    let l = (dx * dx + dy * dy).squareRoot()
    if l > 1 {
      dx /= l
      dy /= l
    }
    host?.setVirtualStick(SIMD2<Double>(dx, dy))
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    endStick(touches)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    endStick(touches)
  }

  private func endStick(_ touches: Set<UITouch>) {
    guard let st = stickTouch, touches.contains(st) else { return }
    stickTouch = nil
    host?.setVirtualStick(nil)
  }
}

struct MetalView: UIViewRepresentable {
  let host: GameHost

  func makeCoordinator() -> MetalViewDelegate { MetalViewDelegate(host: host) }

  func makeUIView(context: Context) -> GameMTKView {
    let v = GameMTKView(frame: .zero, device: host.metalDevice)
    v.host = host
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

  override var acceptsFirstResponder: Bool { true }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    window?.makeFirstResponder(self)
    window?.acceptsMouseMovedEvents = true
    if let o = resignObserver { NotificationCenter.default.removeObserver(o) }
    resignObserver = nil
    if let w = window {
      resignObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: w, queue: .main) { [weak self] _ in
        self?.host?.devices.keyboard.blur()
      }
    }
  }

  deinit {
    if let o = resignObserver { NotificationCenter.default.removeObserver(o) }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let t = trackingArea { removeTrackingArea(t) }
    let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
    addTrackingArea(t)
    trackingArea = t
  }

  // ---- keyboard (swallowed: no beep; menu key equivalents such as ⌘Q run before keyDown) ----
  override func keyDown(with event: NSEvent) {
    guard let code = KeyCodeMap.mac[event.keyCode] else { return }
    host?.devices.keyboard.keyDown(code, isRepeat: event.isARepeat)
  }

  override func keyUp(with event: NSEvent) {
    guard let code = KeyCodeMap.mac[event.keyCode] else { return }
    host?.devices.keyboard.keyUp(code)
  }

  override func flagsChanged(with event: NSEvent) {
    guard let kb = host?.devices.keyboard else { return }
    let raw = event.modifierFlags.rawValue
    for m in KeyCodeMap.macModifierMasks {
      let isDown = raw & m.mask != 0
      let wasDown = kb.keys.contains(m.code)
      if isDown && !wasDown { kb.keyDown(m.code, isRepeat: false) }
      if !isDown && wasDown { kb.keyUp(m.code) }
    }
  }

  // ---- mouse ----
  private func updatePointer(_ event: NSEvent) {
    let p = convert(event.locationInWindow, from: nil)
    guard bounds.width > 0, bounds.height > 0 else { return }
    // NSView y grows upward (non-flipped): NDC y = 2·y/h − 1
    host?.devices.keyboard.mouseNDC = SIMD2<Double>(Double(p.x / bounds.width) * 2 - 1, Double(p.y / bounds.height) * 2 - 1)
  }

  override func mouseMoved(with event: NSEvent) { updatePointer(event) }
  override func mouseDragged(with event: NSEvent) { updatePointer(event) }
  override func rightMouseDragged(with event: NSEvent) { updatePointer(event) }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    updatePointer(event)
    host?.devices.keyboard.mouseDown("Mouse0")
  }

  override func mouseUp(with event: NSEvent) { host?.devices.keyboard.mouseUp("Mouse0") }

  override func rightMouseDown(with event: NSEvent) {
    updatePointer(event)
    host?.devices.keyboard.mouseDown("Mouse2")
  }

  override func rightMouseUp(with event: NSEvent) { host?.devices.keyboard.mouseUp("Mouse2") }

  override func scrollWheel(with event: NSEvent) {
    let d = event.scrollingDeltaY
    if d != 0 { host?.devices.keyboard.addWheel(d > 0 ? -1 : 1) }   // web: sign(deltaY), + = scroll down
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
