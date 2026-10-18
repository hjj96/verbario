@_exported import Foundation
@_exported import CoreGraphics
import QuartzCore
public typealias NSRect = CGRect
public typealias NSPoint = CGPoint
public typealias NSSize = CGSize
open class NSEvent: NSObject {
  public struct ModifierFlags: OptionSet { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let shift = ModifierFlags(rawValue: 1 << 17); public static let control = ModifierFlags(rawValue: 1 << 18); public static let option = ModifierFlags(rawValue: 1 << 19); public static let command = ModifierFlags(rawValue: 1 << 20) }
  open var keyCode: UInt16 { 0 }; open var isARepeat: Bool { false }; open var modifierFlags: ModifierFlags { [] }
  open var locationInWindow: NSPoint { .zero }; open var scrollingDeltaY: CGFloat { 0 }; open var characters: String? { nil }
}
open class NSResponder: NSObject {
  open var acceptsFirstResponder: Bool { false }
  open func keyDown(with event: NSEvent) {}; open func keyUp(with event: NSEvent) {}; open func flagsChanged(with event: NSEvent) {}
  open func mouseMoved(with event: NSEvent) {}; open func mouseDragged(with event: NSEvent) {}; open func rightMouseDragged(with event: NSEvent) {}
  open func mouseDown(with event: NSEvent) {}; open func mouseUp(with event: NSEvent) {}; open func rightMouseDown(with event: NSEvent) {}
  open func rightMouseUp(with event: NSEvent) {}; open func scrollWheel(with event: NSEvent) {}
}
open class NSTrackingArea: NSObject {
  public struct Options: OptionSet { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let mouseEnteredAndExited = Options(rawValue: 1); public static let mouseMoved = Options(rawValue: 2); public static let activeInKeyWindow = Options(rawValue: 0x20); public static let inVisibleRect = Options(rawValue: 0x200) }
  public init(rect: NSRect, options: NSTrackingArea.Options = [], owner: Any?, userInfo: [AnyHashable: Any]? = nil) {}
}
open class NSView: NSResponder {
  public init(frame frameRect: NSRect) {}
  public required init?(coder: NSCoder) {}
  open var bounds = NSRect.zero; open var frame = NSRect.zero; open var window: NSWindow? { nil }; open var layer: CALayer?
  open func viewDidMoveToWindow() {}; open func updateTrackingAreas() {}
  open func addTrackingArea(_ trackingArea: NSTrackingArea) {}; open func removeTrackingArea(_ trackingArea: NSTrackingArea) {}
  open func convert(_ point: NSPoint, from view: NSView?) -> NSPoint { point }
}
open class NSWindow: NSResponder {
  @discardableResult open func makeFirstResponder(_ responder: NSResponder?) -> Bool { true }
  open var acceptsMouseMovedEvents = false; open var backingScaleFactor: CGFloat { 2 }
  public static let didResignKeyNotification = Notification.Name("NSWindowDidResignKeyNotification")
  public static let didBecomeKeyNotification = Notification.Name("NSWindowDidBecomeKeyNotification")
}
open class NSApplication: NSResponder { open class var shared: NSApplication { NSApplication() }
  public class var didBecomeActiveNotification: NSNotification.Name { NSNotification.Name("NSApplicationDidBecomeActiveNotification") } }
public protocol NSApplicationDelegate: NSObjectProtocol {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool
}
extension NSApplicationDelegate { public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false } }
open class NSWorkspace: NSObject { open class var shared: NSWorkspace { NSWorkspace() }; open var accessibilityDisplayShouldReduceMotion: Bool { false } }
