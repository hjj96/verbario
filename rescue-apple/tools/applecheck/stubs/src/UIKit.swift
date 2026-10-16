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
  open var bounds = CGRect.zero; open var frame = CGRect.zero
  open var isMultipleTouchEnabled = false; open var contentScaleFactor: CGFloat = 1
  open var layer = CALayer()
}
open class UITouch: NSObject { open func location(in view: UIView?) -> CGPoint { .zero } }
open class UIEvent: NSObject {}
public enum UIUserInterfaceIdiom: Int { case unspecified = -1, phone = 0, pad, tv, carPlay, mac = 5, vision = 6 }
open class UIDevice: NSObject { open class var current: UIDevice { UIDevice() }; open var userInterfaceIdiom: UIUserInterfaceIdiom { .phone } }
open class UIImpactFeedbackGenerator: NSObject {}
