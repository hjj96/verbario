// localStorage for the port: a string key-value store. The web keys and formats are kept
// (PLAN D16 / §4.5): `mayday.settings.v1` and `mayday.progress.v1` hold the same JSON strings as in the
// browser, so progress can be exported / imported between the builds.
//
// The web guards every access with try/catch ("the game must work without storage"); here a store
// signals "unavailable" by throwing, and GameSettings / ProgressStore swallow it the same way.
import Foundation

/// localStorage.getItem / setItem.
public protocol KeyValueStorage: AnyObject {
  /// The stored string, nil when the key is absent. Throws when the store is unavailable.
  func getItem(_ key: String) throws -> String?
  /// Throws when the store is unavailable or full.
  func setItem(_ key: String, _ value: String) throws
}

/// The store failed (unavailable, quota…).
public struct StorageUnavailable: Error, Sendable {
  public init() {}
}

/// In-memory store: tests, previews, and the app when persistence is off.
public final class MemoryStorage: KeyValueStorage {
  public var items: [String: String]
  /// When true every access throws (a browser with storage disabled).
  public var unavailable: Bool

  public init(_ items: [String: String] = [:], unavailable: Bool = false) {
    self.items = items
    self.unavailable = unavailable
  }

  public func getItem(_ key: String) throws -> String? {
    if unavailable { throw StorageUnavailable() }
    return items[key]
  }

  public func setItem(_ key: String, _ value: String) throws {
    if unavailable { throw StorageUnavailable() }
    items[key] = value
  }
}

/// UserDefaults-backed store used by the apps (Foundation only, so it also builds on Linux).
public final class UserDefaultsStorage: KeyValueStorage {
  public let defaults: UserDefaults

  public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

  public func getItem(_ key: String) throws -> String? { defaults.string(forKey: key) }

  public func setItem(_ key: String, _ value: String) throws { defaults.set(value, forKey: key) }
}

/// core/settings.js loadProgress / saveProgress (unlocked missions, medals, best scores).
public final class ProgressStore {
  public let storage: KeyValueStorage?
  public let key: String

  public init(storage: KeyValueStorage?, key: String = SettingsDefaults.web.progressKey) {
    self.storage = storage
    self.key = key
  }

  /// loadProgress(): JSON.parse(stored) || {} — garbage, a missing key or a falsy value give {}.
  public func load() -> JSONValue {
    guard let s = storage, let raw = try? s.getItem(key) else { return .object(JSONObject()) }
    guard let v = try? JSONValue.parse(raw), v.jsTruthy else { return .object(JSONObject()) }
    return v
  }

  /// saveProgress(data): localStorage.setItem(key, JSON.stringify(data)); failures are ignored.
  public func save(_ data: JSONValue) {
    try? storage?.setItem(key, data.jsonStringify())
  }
}
