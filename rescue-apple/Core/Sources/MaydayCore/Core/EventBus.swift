// core/events.js EventBus: tiny synchronous bus shared by every system (ctx.events).
//
// Delivery semantics, identical to the web (Tests/Vectors/core/events.json replays its scripts):
//   * emit is synchronous; listeners run in registration order;
//   * emit iterates a SNAPSHOT of the listener list: a listener removed during the emit still runs in
//     that emit, one added during the emit first runs on the next emit;
//   * on() with a listener that is already registered for that name is a no-op (JS Set semantics) —
//     in Swift a listener's identity is its `key` (closures are not comparable; no key = always new);
//   * off then on again moves the listener to the end; any `off` for the same (name, key) removes it,
//     even one returned by an earlier registration (the same Set.delete(fn) in JS);
//   * once() unsubscribes BEFORE calling the listener (a re-entrant emit does not reach it again);
//   * re-entrancy: a listener may emit; the nested emit completes before the outer one continues;
//   * clear() drops every list; subscriptions made before clear() no longer affect anything.
// Swift listeners do not throw, so the web's per-listener try/catch has no counterpart.
//
// Snapshots cost nothing in the common case: the listener array is copy-on-write and only copied
// when a listener changes the list while an emit is iterating it.

/// What `on` / `once` return: the web's `off` function.
public struct EventSubscription {
  weak var list: EventBus.ListenerList?
  let key: AnyHashable

  /// Removes this listener (no-op when already removed or after `clear()`).
  public func off() { list?.remove(key) }
}

public final class EventBus {
  public typealias Listener = (GameEvent) -> Void

  /// One event name's listeners in registration order (the web's `Set` for that name).
  final class ListenerList {
    var keys: [AnyHashable] = []
    var fns: [Listener] = []

    func add(_ key: AnyHashable, _ fn: @escaping Listener) {
      if keys.contains(key) { return }
      keys.append(key)
      fns.append(fn)
    }

    func remove(_ key: AnyHashable) {
      guard let i = keys.firstIndex(of: key) else { return }
      keys.remove(at: i)
      fns.remove(at: i)
    }
  }

  /// A key nobody else can hold: listeners registered without a key, and `once` wrappers.
  private struct UniqueKey: Hashable {
    let n: UInt64
  }

  private var lists: [EventName: ListenerList] = [:]
  private var nextUnique: UInt64 = 0

  /// Debug tap called for every emit before the listeners (EventTrace / replay recorder, PLAN §2.4).
  public var onEmit: ((GameEvent) -> Void)?

  public init() {}

  private func uniqueKey() -> AnyHashable {
    nextUnique &+= 1
    return AnyHashable(UniqueKey(n: nextUnique))
  }

  /// on(name, fn) → off. `key` is the listener's identity: registering the same key again for the
  /// same name is a no-op (pass e.g. `ObjectIdentifier(self)` or a string for listeners that may be
  /// registered twice); nil means a fresh identity.
  @discardableResult
  public func on(_ name: EventName, key: AnyHashable? = nil, _ fn: @escaping Listener) -> EventSubscription {
    let list: ListenerList
    if let l = lists[name] {
      list = l
    } else {
      list = ListenerList()
      lists[name] = list
    }
    let k = key ?? uniqueKey()
    list.add(k, fn)
    return EventSubscription(list: list, key: k)
  }

  /// once(name, fn) → off: the wrapper unsubscribes itself, then calls `fn`.
  @discardableResult
  public func once(_ name: EventName, _ fn: @escaping Listener) -> EventSubscription {
    let k = uniqueKey()
    var sub: EventSubscription?
    let s = on(name, key: k) { e in
      sub?.off()
      fn(e)
    }
    sub = s
    return s
  }

  /// Typed listener: `bus.on(GameEvent.HeliDamage.self) { p in … }`.
  @discardableResult
  public func on<P: EventPayload>(_ type: P.Type, key: AnyHashable? = nil, _ fn: @escaping (P) -> Void) -> EventSubscription {
    on(P.eventName, key: key) { e in
      if let p = e.payload as? P { fn(p) }
    }
  }

  /// Typed once-listener.
  @discardableResult
  public func once<P: EventPayload>(_ type: P.Type, _ fn: @escaping (P) -> Void) -> EventSubscription {
    once(P.eventName) { e in
      if let p = e.payload as? P { fn(p) }
    }
  }

  /// emit(name, payload): synchronous, over a snapshot of the current listeners.
  public func emit(_ event: GameEvent) {
    onEmit?(event)
    guard let list = lists[event.name] else { return }
    let snapshot = list.fns // copy-on-write: copied only if a listener mutates the list
    for fn in snapshot { fn(event) }
  }

  /// emit with a payload struct: `bus.emit(GameEvent.HeliDamage(amount: 0.1, source: "rogue", hull: 0.9))`.
  @inline(__always) public func emit<P: EventPayload>(_ payload: P) { emit(payload.event) }

  /// clear(): forget every listener.
  public func clear() { lists.removeAll() }

  /// Number of listeners currently registered for `name` (tests / debug overlay).
  public func listenerCount(_ name: EventName) -> Int { lists[name]?.keys.count ?? 0 }
}
