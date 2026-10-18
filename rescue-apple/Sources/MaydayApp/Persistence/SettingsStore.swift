// SettingsStore — the app's localStorage and the boot-time answers the web reads from the browser
// (PLAN §2.8 «Хранение», «Окружение», launch args; D16):
//   * storage: UserDefaults, the web's keys and JSON blobs (`mayday.settings.v1`, `mayday.progress.v1`)
//     through MaydayCore's KeyValueStorage — settings and key bindings persist exactly like the browser's;
//     `-mayday.persist NO` uses an in-memory store (clean runs, screenshots);
//   * matchMedia: prefers-reduced-motion ← UIAccessibility.isReduceMotionEnabled /
//     NSWorkspace.accessibilityDisplayShouldReduceMotion; pointer: coarse ← iPhone / iPad idiom;
//   * the first-run quality of a touch device is the device tier (PLAN §1.4, X5: A17 Pro+ / iPad M1+ high,
//     A15 / A16 medium, older low; the web's coarse-pointer rule says low); the Mac keeps DEFAULTS (high);
//   * URL parameters ← NSArgumentDomain: -mayday.quality low|medium|high, -mayday.weather <preset>,
//     -mayday.tod 0…1 (also -mayday.debug, -mayday.dynres, -mayday.fps: GameHost).
import Foundation
import Metal
import MaydayCore
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

enum SettingsStore {
  /// localStorage for the session.
  static func storage(_ defaults: UserDefaults = .standard) -> KeyValueStorage {
    if defaults.object(forKey: "mayday.persist") != nil && !defaults.bool(forKey: "mayday.persist") {
      return MemoryStorage()
    }
    return UserDefaultsStorage(defaults)
  }

  /// SessionOptions from the launch arguments and the platform (window size: set by the host).
  static func launchOptions(_ defaults: UserDefaults = .standard) -> SessionOptions {
    var o = SessionOptions()
    o.quality = defaults.string(forKey: "mayday.quality")
    o.weather = defaults.string(forKey: "mayday.weather")
    if defaults.object(forKey: "mayday.tod") != nil { o.timeOfDay = defaults.double(forKey: "mayday.tod") }
    #if os(iOS)
    o.prefersReducedMotion = UIAccessibility.isReduceMotionEnabled
    o.coarsePointer = true
    o.touchQuality = deviceQuality()
    #elseif os(macOS)
    o.prefersReducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    o.coarsePointer = false
    #endif
    return o
  }

  /// PLAN §1.4: apple9 (A17 Pro+) → high; iPad with apple7+ (M1+) → high; apple8 (A15 / A16) → medium;
  /// older → low. The Mac is always high.
  static func deviceQuality() -> String {
    #if os(macOS)
    return "high"
    #else
    guard let dev = MTLCreateSystemDefaultDevice() else { return "low" }
    if dev.supportsFamily(.apple9) { return "high" }
    if UIDevice.current.userInterfaceIdiom == .pad && dev.supportsFamily(.apple7) { return "high" }
    if dev.supportsFamily(.apple8) { return "medium" }
    return "low"
    #endif
  }
}
