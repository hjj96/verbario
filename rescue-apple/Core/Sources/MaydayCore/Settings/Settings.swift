// core/settings.js Settings: persistent player settings with the web's defaults, first-run rules,
// migration, change notifications and storage format. Vectors: Tests/Vectors/settings/settings.json.
//
// Named `GameSettings`: SwiftUI's `Settings` scene type would make an unqualified `Settings`
// ambiguous in the app targets.
//
// Values are kept as loosely typed JSON exactly like the web (a saved file may hold anything); the
// typed accessors below apply the reads the game makes. Construction (web constructor order):
//   1. values = {...DEFAULTS}; Object.assign(values, JSON.parse(stored)) — garbage is ignored;
//   2. migration: saved without `assistExplicit`, with a truthy `assist` !== 'standard' → assistExplicit = true;
//   3. first run (nothing stored): prefers-reduced-motion → reduceFlashes = reduceMotion = true;
//      coarse pointer (touch) → quality = environment.touchQuality ('low' in the web; PLAN §10 X5:
//      the iOS app passes 'medium');
//   4. ?quality=low|medium|high launch override;
//   5. bindings that are not an object → {}; assist = autoAssist() unless assistExplicit;
//      Bindings.apply(values.bindings).
// set(key, value): no-op when === the current value; store JSON.stringify(values); notify listeners
// (live iteration like a JS Set: listeners added during the notification are called too); then a
// difficulty change re-derives assist while the player has not chosen one.

/// What the web reads from matchMedia / location.search at construction.
public struct SettingsEnvironment: Equatable, Sendable {
  /// matchMedia('(prefers-reduced-motion: reduce)')
  public var prefersReducedMotion: Bool
  /// matchMedia('(pointer: coarse)'): a touch device
  public var coarsePointer: Bool
  /// ?quality= launch argument (only low / medium / high are honoured)
  public var qualityOverride: String?
  /// First-run quality on a coarse-pointer device: 'low' in the web, 'medium' on iPhone (PLAN §10 X5).
  public var touchQuality: String

  public init(prefersReducedMotion: Bool = false, coarsePointer: Bool = false, qualityOverride: String? = nil, touchQuality: String = "low") {
    self.prefersReducedMotion = prefersReducedMotion
    self.coarsePointer = coarsePointer
    self.qualityOverride = qualityOverride
    self.touchQuality = touchQuality
  }
}

/// settings.json: DEFAULTS, storage keys, quality tiers. `.web` holds the same values compiled in.
public struct SettingsDefaults: Equatable, Sendable {
  public var key: String
  public var progressKey: String
  /// DEFAULTS in source order.
  public var defaults: JSONObject
  /// pixelRatioCap() / detail() per quality.
  public var tiers: [String: (pixelRatioCap: Double, detail: Double)]
  /// Fallbacks for an unknown quality: `{…}[q] || 1.5` and `{…}[q] || 1`.
  public var unknownPixelRatioCap: Double = 1.5
  public var unknownDetail: Double = 1
  /// The quality values a ?quality= override may set.
  public var qualities: [String] = ["low", "medium", "high"]

  public static func == (a: SettingsDefaults, b: SettingsDefaults) -> Bool {
    a.key == b.key && a.progressKey == b.progressKey && a.defaults == b.defaults && a.qualities == b.qualities
      && a.unknownPixelRatioCap == b.unknownPixelRatioCap && a.unknownDetail == b.unknownDetail
      && a.tiers.count == b.tiers.count
      && a.tiers.allSatisfy { k, v in b.tiers[k].map { $0.pixelRatioCap == v.pixelRatioCap && $0.detail == v.detail } ?? false }
  }

  public init(key: String, progressKey: String, defaults: JSONObject, tiers: [String: (pixelRatioCap: Double, detail: Double)]) {
    self.key = key
    self.progressKey = progressKey
    self.defaults = defaults
    self.tiers = tiers
  }

  /// core/settings.js, compiled in.
  public static let web: SettingsDefaults = {
    var d = JSONObject()
    let rows: [(String, JSONValue)] = [
      ("quality", .string("high")), ("masterVolume", .number(0.8)), ("musicVolume", .number(0.6)),
      ("sfxVolume", .number(0.9)), ("radioVolume", .number(0.9)), ("envVolume", .number(0.9)), ("uiVolume", .number(0.8)),
      ("alarms", .bool(true)), ("reduceFlashes", .bool(false)), ("reduceMotion", .bool(false)), ("textScale", .number(1)),
      ("hudScale", .number(1)), ("vibration", .number(1)), ("assist", .string("standard")), ("assistExplicit", .bool(false)),
      ("difficulty", .string("pilot")), ("seenFlashWarning", .bool(false)), ("screenShake", .number(1)),
      ("colorblindMarkers", .bool(false)), ("subtitles", .bool(true)), ("invertLift", .bool(false)), ("showFps", .bool(false)),
      ("bindings", .object(JSONObject())),
    ]
    for (k, v) in rows { d.set(k, v) }
    return SettingsDefaults(key: "mayday.settings.v1", progressKey: "mayday.progress.v1", defaults: d,
                            tiers: ["low": (1, 0.35), "medium": (1.25, 0.65), "high": (2, 1)])
  }()

  /// From the `data` payload of Resources/Data/settings.json.
  public init(json: JSONValue) throws {
    let m = json["core/settings"]
    var tiers = [String: (pixelRatioCap: Double, detail: Double)]()
    for (q, t) in try json["derived"]["qualityTiers"].requireObject("derived.qualityTiers").entries {
      tiers[q] = (try t["pixelRatioCap"].requireDouble("qualityTiers.\(q).pixelRatioCap"), try t["detail"].requireDouble("qualityTiers.\(q).detail"))
    }
    self.init(key: try m["KEY"].requireString("KEY"), progressKey: try m["PROGRESS_KEY"].requireString("PROGRESS_KEY"),
              defaults: try m["DEFAULTS"].requireObject("DEFAULTS"), tiers: tiers)
  }
}

/// A settings listener handle (the web's `onChange` return value).
public struct SettingsSubscription {
  weak var owner: GameSettings?
  let id: AnyHashable

  /// Removes the listener (no-op when already removed).
  public func off() { owner?.removeListener(id) }
}

public final class GameSettings {
  public typealias Listener = (_ key: String, _ value: JSONValue) -> Void

  public let defaultsTable: SettingsDefaults
  public let storage: KeyValueStorage?
  public let environment: SettingsEnvironment
  /// The live key bindings `values.bindings` is applied to (shared with InputState).
  public let bindings: Bindings?
  /// The current values (DEFAULTS order, then keys a saved file added).
  public private(set) var values: JSONObject

  // Listeners with JS Set iteration semantics: removal leaves a tombstone while an iteration is
  // running, additions are appended and reached by the running iteration.
  private struct Entry {
    let id: AnyHashable
    let fn: Listener
    var alive: Bool
  }

  private struct UniqueID: Hashable {
    let n: UInt64
  }

  private var listeners: [Entry] = []
  private var iterating = 0
  private var nextID: UInt64 = 0

  public init(storage: KeyValueStorage?, environment: SettingsEnvironment = SettingsEnvironment(),
              defaults: SettingsDefaults = .web, bindings: Bindings? = nil) {
    defaultsTable = defaults
    self.storage = storage
    self.environment = environment
    self.bindings = bindings
    values = defaults.defaults

    // stored values (garbage → defaults)
    if let raw = try? storage?.getItem(defaults.key), let saved = try? JSONValue.parse(raw) {
      GameSettings.assign(&values, saved)
      // saved before `assistExplicit` existed: anything but the old default was the player's own choice
      if saved.jsTruthy, case .object(let o) = saved, o["assistExplicit"] == nil,
         let assist = o["assist"], assist.jsTruthy, !assist.jsStrictEquals(.string("standard")) {
        values.set("assistExplicit", .bool(true))
      }
    }
    if !storageHas(defaults.key) && environment.prefersReducedMotion {
      values.set("reduceFlashes", .bool(true))
      values.set("reduceMotion", .bool(true))
    }
    if !storageHas(defaults.key) && environment.coarsePointer { values.set("quality", .string(environment.touchQuality)) }
    if let q = environment.qualityOverride, !q.isEmpty, defaults.qualities.contains(q) { values.set("quality", .string(q)) }
    let b = values["bindings"] ?? .null
    switch b {
    case .object, .array: break
    default: values.set("bindings", .object(JSONObject()))
    }
    if !(values["assistExplicit"] ?? .null).jsTruthy { values.set("assist", .string(autoAssist())) }
    bindings?.apply(values["bindings"])
  }

  /// Object.assign(target, source) for a JSON.parse result: objects copy their own properties in JS
  /// order; arrays and strings copy their indices; numbers, booleans and null copy nothing.
  static func assign(_ target: inout JSONObject, _ source: JSONValue) {
    switch source {
    case .object(let o):
      for k in o.jsKeyOrder { target.set(k, o[k] ?? .null) }
    case .array(let a):
      for (i, v) in a.enumerated() { target.set(String(i), v) }
    case .string(let s):
      for (i, u) in s.utf16.enumerated() {
        let ch = Unicode.Scalar(u).map { String(Character($0)) } ?? "\u{FFFD}"
        target.set(String(i), .string(ch))
      }
    default:
      break
    }
  }

  /// localStorage.getItem(KEY) !== null (false when storage is unavailable).
  private func storageHas(_ key: String) -> Bool {
    guard let s = storage else { return false }
    return (try? s.getItem(key)) != nil
  }

  /// Stabilisation the game picks while the player has not chosen one: «Полная» for Cadet
  /// (DESIGN §3.17) and on touch devices (§3.2), «Стандарт» otherwise.
  public func autoAssist() -> String {
    ((values["difficulty"] ?? .null).jsStrictEquals(.string("cadet")) || environment.coarsePointer) ? "full" : "standard"
  }

  /// get(key): the raw value (.null when absent — the web's undefined).
  public func get(_ key: String) -> JSONValue { values[key] ?? .null }

  /// set(key, value)
  public func set(_ key: String, _ value: JSONValue) {
    if let cur = values[key], cur.jsStrictEquals(value) { return }
    values.set(key, value)
    if key == "bindings" { bindings?.apply(value) } // live: Input and the HUD read BINDINGS every frame
    try? storage?.setItem(defaultsTable.key, JSONValue.object(values).jsonStringify())
    notify(key, value)
    if key == "difficulty" && !(values["assistExplicit"] ?? .null).jsTruthy { set("assist", .string(autoAssist())) }
  }

  public func set(_ key: String, _ value: Double) { set(key, .number(value)) }
  public func set(_ key: String, _ value: Bool) { set(key, .bool(value)) }
  public func set(_ key: String, _ value: String) { set(key, .string(value)) }

  /// onChange(fn) → off. `key` gives the listener an identity (registering it again is a no-op).
  @discardableResult
  public func onChange(key: AnyHashable? = nil, _ fn: @escaping Listener) -> SettingsSubscription {
    let id: AnyHashable
    if let k = key {
      id = k
    } else {
      nextID &+= 1
      id = AnyHashable(UniqueID(n: nextID))
    }
    if !listeners.contains(where: { $0.alive && $0.id == id }) { listeners.append(Entry(id: id, fn: fn, alive: true)) }
    return SettingsSubscription(owner: self, id: id)
  }

  func removeListener(_ id: AnyHashable) {
    guard let i = listeners.firstIndex(where: { $0.alive && $0.id == id }) else { return }
    if iterating > 0 { listeners[i].alive = false } else { listeners.remove(at: i) }
  }

  private func notify(_ key: String, _ value: JSONValue) {
    iterating += 1
    var i = 0
    while i < listeners.count {
      let e = listeners[i]
      if e.alive { e.fn(key, value) }
      i += 1
    }
    iterating -= 1
    if iterating == 0 { listeners.removeAll { !$0.alive } }
  }

  /// pixelRatioCap(): {low: 1, medium: 1.25, high: 2}[quality] || 1.5   (quality used as a property key)
  public func pixelRatioCap() -> Double {
    guard let t = defaultsTable.tiers[get("quality").jsToString], JSNumber.isTruthy(t.pixelRatioCap) else {
      return defaultsTable.unknownPixelRatioCap
    }
    return t.pixelRatioCap
  }

  /// detail(): {low: 0.35, medium: 0.65, high: 1}[quality] || 1 — particle counts / shader detail.
  public func detail() -> Double {
    guard let t = defaultsTable.tiers[get("quality").jsToString], JSNumber.isTruthy(t.detail) else {
      return defaultsTable.unknownDetail
    }
    return t.detail
  }

  // ---- typed reads (how the game uses the keys) ------------------------------------------------------
  /// get(key) as a JS number, nil when the stored value is not a number.
  public func number(_ key: String) -> Double? {
    if case .number(let d) = get(key) { return d }
    return nil
  }

  /// get(key) as a JS condition (`if (settings.get('reduceFlashes'))`).
  public func flag(_ key: String) -> Bool { get(key).jsTruthy }

  /// get(key) as a string, nil when the stored value is not a string.
  public func string(_ key: String) -> String? {
    if case .string(let s) = get(key) { return s }
    return nil
  }

  /// settings.get('quality')
  public var quality: String? { string("quality") }
}
