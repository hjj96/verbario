@_exported import Foundation
@_exported import CoreGraphics
import QuartzCore
open class UIResponder: NSObject {
  open func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {}
}
open class UIView: UIResponder {
  public init(frame: CGRect) {}
  public required init?(coder: NSCoder) {}
  public convenience override init() { self.init(frame: .zero) }
  open var bounds = CGRect.zero; open var frame = CGRect.zero; open var center = CGPoint.zero
  open var isMultipleTouchEnabled = false; open var contentScaleFactor: CGFloat = 1
  open var layer = CALayer()
  open var backgroundColor: UIColor?; open var isHidden = false; open var isUserInteractionEnabled = true
  open var subviews: [UIView] { [] }; open func addSubview(_ view: UIView) {}
  open func layoutSubviews() {}
  open var safeAreaInsets: UIEdgeInsets { UIEdgeInsets() }
  open func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }
  public struct AutoresizingMask: OptionSet { public let rawValue: UInt; public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let flexibleLeftMargin = AutoresizingMask(rawValue: 1); public static let flexibleWidth = AutoresizingMask(rawValue: 2)
    public static let flexibleRightMargin = AutoresizingMask(rawValue: 4); public static let flexibleTopMargin = AutoresizingMask(rawValue: 8)
    public static let flexibleHeight = AutoresizingMask(rawValue: 16); public static let flexibleBottomMargin = AutoresizingMask(rawValue: 32) }
  open var autoresizingMask: UIView.AutoresizingMask = []
}
public struct UIEdgeInsets { public var top: CGFloat; public var left: CGFloat; public var bottom: CGFloat; public var right: CGFloat
  public init() { top = 0; left = 0; bottom = 0; right = 0 }
  public init(top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat) { self.top = top; self.left = left; self.bottom = bottom; self.right = right } }
open class UIColor: NSObject {
  public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {}
  open class var clear: UIColor { UIColor(red: 0, green: 0, blue: 0, alpha: 0) }
  open var cgColor: CGColor { CGColor() }
}
public enum NSTextAlignment: Int { case left = 0, center = 1, right = 2, justified = 3, natural = 4 }
open class UIFont: NSObject {
  public struct Weight: Hashable, Equatable, RawRepresentable { public var rawValue: CGFloat; public init(rawValue: CGFloat) { self.rawValue = rawValue }
    public static let regular = Weight(rawValue: 0); public static let medium = Weight(rawValue: 0.23); public static let semibold = Weight(rawValue: 0.3); public static let bold = Weight(rawValue: 0.4) }
  open class func monospacedSystemFont(ofSize fontSize: CGFloat, weight: UIFont.Weight) -> UIFont { UIFont() }
}
open class UILabel: UIView {
  open var text: String?; open var font: UIFont!; open var textColor: UIColor!; open var textAlignment: NSTextAlignment = .natural
}
open class UITouch: NSObject {
  public enum TouchType: Int { case direct = 0, indirect = 1, pencil = 2, indirectPointer = 3 }
  open func location(in view: UIView?) -> CGPoint { .zero }
  open var type: UITouch.TouchType { .direct }
}
open class UIEvent: NSObject {
  public struct ButtonMask: OptionSet { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }
    public static let primary = ButtonMask(rawValue: 1); public static let secondary = ButtonMask(rawValue: 2)
    public static func button(_ buttonNumber: Int) -> UIEvent.ButtonMask { ButtonMask(rawValue: 1 << (buttonNumber - 1)) } }
  open var buttonMask: UIEvent.ButtonMask { [] }
}
open class UIApplication: UIResponder {
  open class var shared: UIApplication { UIApplication() }
  public class var didBecomeActiveNotification: NSNotification.Name { NSNotification.Name("UIApplicationDidBecomeActiveNotification") }
  public class var willEnterForegroundNotification: NSNotification.Name { NSNotification.Name("UIApplicationWillEnterForegroundNotification") }
}
public enum UIAccessibility { public static var isReduceMotionEnabled: Bool { false } }
public enum UIUserInterfaceIdiom: Int { case unspecified = -1, phone = 0, pad, tv, carPlay, mac = 5, vision = 6 }
open class UIDevice: NSObject { open class var current: UIDevice { UIDevice() }; open var userInterfaceIdiom: UIUserInterfaceIdiom { .phone } }
open class UIFeedbackGenerator: NSObject { open func prepare() {} }
open class UIImpactFeedbackGenerator: UIFeedbackGenerator {
  public enum FeedbackStyle: Int { case light = 0, medium = 1, heavy = 2, soft = 3, rigid = 4 }
  public init(style: UIImpactFeedbackGenerator.FeedbackStyle) {}
  open func impactOccurred() {}
  open func impactOccurred(intensity: CGFloat) {}
}
