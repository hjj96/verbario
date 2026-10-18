@_exported import Foundation
import CoreHaptics
open class GCControllerElement: NSObject {}
open class GCControllerButtonInput: GCControllerElement { open var value: Float { 0 }; open var isPressed: Bool { false } }
open class GCControllerAxisInput: GCControllerElement { open var value: Float { 0 } }
open class GCControllerDirectionPad: GCControllerElement {
  open var xAxis = GCControllerAxisInput(); open var yAxis = GCControllerAxisInput()
  open var up = GCControllerButtonInput(); open var down = GCControllerButtonInput(); open var left = GCControllerButtonInput(); open var right = GCControllerButtonInput()
}
open class GCPhysicalInputProfile: NSObject {}
open class GCExtendedGamepad: GCPhysicalInputProfile {
  open var dpad = GCControllerDirectionPad(); open var leftThumbstick = GCControllerDirectionPad(); open var rightThumbstick = GCControllerDirectionPad()
  open var buttonA = GCControllerButtonInput(); open var buttonB = GCControllerButtonInput(); open var buttonX = GCControllerButtonInput(); open var buttonY = GCControllerButtonInput()
  open var leftShoulder = GCControllerButtonInput(); open var rightShoulder = GCControllerButtonInput(); open var leftTrigger = GCControllerButtonInput(); open var rightTrigger = GCControllerButtonInput()
  open var buttonMenu = GCControllerButtonInput(); open var buttonOptions: GCControllerButtonInput?; open var buttonHome: GCControllerButtonInput?
  open var leftThumbstickButton: GCControllerButtonInput?; open var rightThumbstickButton: GCControllerButtonInput?
}
open class GCController: NSObject {
  open class var current: GCController? { nil }
  open class func controllers() -> [GCController] { [] }
  open var vendorName: String?; open var extendedGamepad: GCExtendedGamepad?
  open var haptics: GCDeviceHaptics? { nil }
}
public struct GCHapticsLocality: Hashable, Equatable, RawRepresentable {
  public var rawValue: String; public init(rawValue: String) { self.rawValue = rawValue }
  public static let `default` = GCHapticsLocality(rawValue: "Default"); public static let all = GCHapticsLocality(rawValue: "All")
  public static let handles = GCHapticsLocality(rawValue: "Handles"); public static let leftHandle = GCHapticsLocality(rawValue: "Left Handle")
  public static let rightHandle = GCHapticsLocality(rawValue: "Right Handle"); public static let triggers = GCHapticsLocality(rawValue: "Triggers")
  public static let leftTrigger = GCHapticsLocality(rawValue: "Left Trigger"); public static let rightTrigger = GCHapticsLocality(rawValue: "Right Trigger")
}
open class GCDeviceHaptics: NSObject {
  open var supportedLocalities: Set<GCHapticsLocality> { [] }
  open func createEngine(withLocality locality: GCHapticsLocality) -> CHHapticEngine? { nil }
}
public struct GCKeyCode: RawRepresentable, Hashable { public var rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue } }
public typealias GCKeyboardValueChangedHandler = (GCKeyboardInput, GCControllerButtonInput, GCKeyCode, Bool) -> Void
open class GCKeyboardInput: GCPhysicalInputProfile { open var keyChangedHandler: GCKeyboardValueChangedHandler? }
open class GCKeyboard: NSObject { open class var coalesced: GCKeyboard? { nil }; open var keyboardInput: GCKeyboardInput? }
extension Notification.Name {
  public static let GCControllerDidConnect = Notification.Name("GCControllerDidConnectNotification")
  public static let GCControllerDidDisconnect = Notification.Name("GCControllerDidDisconnectNotification")
  public static let GCKeyboardDidConnect = Notification.Name("GCKeyboardDidConnectNotification")
}
