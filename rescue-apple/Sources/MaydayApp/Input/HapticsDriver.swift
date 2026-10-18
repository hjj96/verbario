// HapticsDriver — the platform half of rescue/src/core/haptics.js (PLAN §2.8 «Хаптика», §2.9 core/haptics.js
// row). MaydayCore's Haptics owns the rules (event → strength / duration, ×settings.vibration, only in play)
// and the device gate; this file plays the result:
//
//   pad   InputState.rumbleSink (input.rumble → the active pad's vibrationActuator.playEffect('dual-rumble',
//         {duration, strongMagnitude, weakMagnitude})) → GCController.haptics → CHHapticEngine:
//         two continuous events — strong on the left handle (the heavy, low-frequency motor), weak on the
//         right one — or both on the default locality when the pad has no per-handle actuators. A new
//         effect replaces the running one (Chromium's playEffect does too). Engines are made per pad,
//         restarted after a reset / stop and when the app returns to the foreground, dropped on disconnect.
//   touch iPhone (PLAN §10 X9 / X18 — the web has no touch haptics): UIImpactFeedbackGenerator for the same rules
//         when the touch screen is the active device (strength ≥ 0.3: lighter rules are below what a
//         phone's taptic engine conveys), intensity = strength × vibration, heavy for ≥ 300 ms effects; plus
//         a light tap on every touch-control press.
// Only the active device ever vibrates: the pad rules are gated on lastDevice == gamepad by Core, the
// touch ones here on lastDevice == touch.
import Foundation
import GameController
import CoreHaptics
import MaydayCore
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

final class HapticsDriver {
  /// One pad's engines: per handle, or a single default-locality engine.
  private final class PadEngines {
    let left: CHHapticEngine?
    let right: CHHapticEngine?
    let both: CHHapticEngine?
    var players: [CHHapticPatternPlayer] = []
    var needsStart = true

    init(_ h: GCDeviceHaptics) {
      let loc = h.supportedLocalities
      if loc.contains(.leftHandle) && loc.contains(.rightHandle) {
        left = h.createEngine(withLocality: .leftHandle)
        right = h.createEngine(withLocality: .rightHandle)
        both = nil
      } else {
        left = nil
        right = nil
        both = h.createEngine(withLocality: .default)
      }
      for e in [left, right, both].compactMap({ $0 }) {
        e.isAutoShutdownEnabled = true
        e.playsHapticsOnly = true
      }
    }

    var engines: [CHHapticEngine] { [left, right, both].compactMap { $0 } }
  }

  private unowned let pads: GamepadAdapter
  private var engines: [ObjectIdentifier: PadEngines] = [:]
  private var observers: [NSObjectProtocol] = []

  init(pads: GamepadAdapter) {
    self.pads = pads
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] note in
      guard let c = note.object as? GCController else { return }
      self?.engines[ObjectIdentifier(c)] = nil
    })
    #if os(iOS)
    let foreground = UIApplication.didBecomeActiveNotification
    #else
    let foreground = NSApplication.didBecomeActiveNotification
    #endif
    observers.append(nc.addObserver(forName: foreground, object: nil, queue: .main) { [weak self] _ in
      for (_, e) in self?.engines ?? [:] { e.needsStart = true }
    })
  }

  deinit {
    for o in observers { NotificationCenter.default.removeObserver(o) }
  }

  /// InputState.rumbleSink: play `e` on the active pad (the one input.rumble checked).
  func rumble(_ e: RumbleEffect) {
    guard let c = pads.activeController, let h = c.haptics else { return }
    let key = ObjectIdentifier(c)
    let pe = engines[key] ?? PadEngines(h)
    engines[key] = pe
    if pe.needsStart {
      for engine in pe.engines {
        engine.resetHandler = { [weak pe] in pe?.needsStart = true }
        engine.stoppedHandler = { [weak pe] _ in pe?.needsStart = true }
        try? engine.start()
      }
      pe.needsStart = false
    }
    for p in pe.players { try? p.stop(atTime: CHHapticTimeImmediate) }
    pe.players.removeAll()
    let seconds = max(0, e.duration / 1000)
    func play(_ engine: CHHapticEngine?, _ events: [(intensity: Double, sharpness: Double)]) {
      guard let engine else { return }
      let evs = events.filter { $0.intensity > 0 }.map {
        CHHapticEvent(eventType: .hapticContinuous,
                      parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(min(1, $0.intensity))),
                                   CHHapticEventParameter(parameterID: .hapticSharpness, value: Float($0.sharpness))],
                      relativeTime: 0, duration: seconds)
      }
      guard !evs.isEmpty, let pattern = try? CHHapticPattern(events: evs, parameters: []),
            let player = try? engine.makePlayer(with: pattern) else { return }
      do {
        try player.start(atTime: CHHapticTimeImmediate)
        pe.players.append(player)
      } catch {
        pe.needsStart = true
      }
    }
    // dual-rumble: strongMagnitude → the low-frequency motor, weakMagnitude → the high-frequency one
    play(pe.left, [(e.strongMagnitude, 0.2)])
    play(pe.right, [(e.weakMagnitude, 0.8)])
    play(pe.both, [(e.strongMagnitude, 0.2), (e.weakMagnitude, 0.8)])
  }
}

#if os(iOS)
/// iPhone touch haptics (PLAN §10 X9 / X18): HapticRules played through UIImpactFeedbackGenerator.
final class TouchHaptics {
  /// Rules below this strength are not played on the phone.
  static let minStrength = 0.3
  /// Effects at least this long (ms) use the heavy generator.
  static let heavyFrom = 300.0

  private unowned let input: InputState
  private unowned let settings: GameSettings
  private let mode: () -> GameMode
  private let light = UIImpactFeedbackGenerator(style: .light)
  private let medium = UIImpactFeedbackGenerator(style: .medium)
  private let heavy = UIImpactFeedbackGenerator(style: .heavy)
  private var subscriptions: [EventSubscription] = []

  init(events: EventBus, input: InputState, settings: GameSettings, mode: @escaping () -> GameMode) {
    self.input = input
    self.settings = settings
    self.mode = mode
    for name in HapticRules.events {
      subscriptions.append(events.on(name) { [weak self] e in self?.fire(HapticRules.spec(e)) })
    }
    light.prepare()
  }

  deinit { for s in subscriptions { s.off() } }

  /// settings.get('vibration') ?? 1 (ToNumber, like core/haptics.js).
  private var scale: Double {
    let v = settings.get("vibration")
    return v.isNull ? 1 : v.jsToNumber
  }

  private func fire(_ spec: (strength: Double, duration: Double)?) {
    guard let s = spec, mode() == .play, input.lastDevice == .touch, s.strength >= TouchHaptics.minStrength else { return }
    let k = scale
    if !(k > 0) { return }
    let g = s.duration >= TouchHaptics.heavyFrom ? heavy : medium
    g.impactOccurred(intensity: CGFloat(min(1, s.strength * k)))
  }

  /// A touch-control press.
  func tap() {
    let k = scale
    if !(k > 0) { return }
    light.impactOccurred(intensity: CGFloat(min(1, 0.5 * k)))
  }
}
#endif
