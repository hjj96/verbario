// CoreHaptics surface used by the app (pad rumble through GCController.haptics) — type checking only.
// Swift names / signatures as imported on Apple platforms (iOS 13+, macOS 10.15+).
@_exported import Foundation

public let CHHapticTimeImmediate: TimeInterval = 0

public protocol CHHapticPatternPlayer: NSObjectProtocol {
  func start(atTime time: TimeInterval) throws
  func stop(atTime time: TimeInterval) throws
  func cancel() throws
  var isMuted: Bool { get set }
}

open class CHHapticEventParameter: NSObject {
  public init(parameterID: CHHapticEvent.ParameterID, value: Float) { self.parameterID = parameterID; self.value = value }
  open var parameterID: CHHapticEvent.ParameterID
  open var value: Float
}

open class CHHapticEvent: NSObject {
  public struct EventType: Hashable, Equatable, RawRepresentable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let hapticTransient = EventType(rawValue: "HapticTransient")
    public static let hapticContinuous = EventType(rawValue: "HapticContinuous")
    public static let audioContinuous = EventType(rawValue: "AudioContinuous")
    public static let audioCustom = EventType(rawValue: "AudioCustom")
  }
  public struct ParameterID: Hashable, Equatable, RawRepresentable {
    public var rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let hapticIntensity = ParameterID(rawValue: "HapticIntensity")
    public static let hapticSharpness = ParameterID(rawValue: "HapticSharpness")
    public static let attackTime = ParameterID(rawValue: "AttackTime")
    public static let decayTime = ParameterID(rawValue: "DecayTime")
    public static let releaseTime = ParameterID(rawValue: "ReleaseTime")
    public static let sustained = ParameterID(rawValue: "Sustained")
  }
  public init(eventType type: CHHapticEvent.EventType, parameters eventParams: [CHHapticEventParameter], relativeTime time: TimeInterval) {}
  public init(eventType type: CHHapticEvent.EventType, parameters eventParams: [CHHapticEventParameter], relativeTime time: TimeInterval,
              duration: TimeInterval) {}
}

open class CHHapticDynamicParameter: NSObject {}

open class CHHapticPattern: NSObject {
  public init(events: [CHHapticEvent], parameters: [CHHapticDynamicParameter]) throws {}
  open var duration: TimeInterval { 0 }
}

open class CHHapticEngine: NSObject {
  public enum StoppedReason: Int {
    case audioSessionInterrupt = 1, applicationSuspended = 2, idleTimeout = 3, notifyWhenFinished = 4, engineDestroyed = 5
    case gameControllerDisconnect = 6, systemError = -1
  }
  public typealias StoppedHandler = (CHHapticEngine.StoppedReason) -> Void
  public typealias ResetHandler = () -> Void
  public typealias CompletionHandler = (Error?) -> Void
  open var stoppedHandler: CHHapticEngine.StoppedHandler = { _ in }
  open var resetHandler: CHHapticEngine.ResetHandler = {}
  open var playsHapticsOnly = false
  open var isAutoShutdownEnabled = false
  open func start() throws {}
  open func start(completionHandler: CHHapticEngine.CompletionHandler? = nil) {}
  open func stop(completionHandler: CHHapticEngine.CompletionHandler? = nil) {}
  open func makePlayer(with pattern: CHHapticPattern) throws -> CHHapticPatternPlayer { fatalError() }
}
