// Seeded generators of the web game (core/math.js createRng + the LCGs used by texture/UI code).
// All bit-exact with Node 22: Tests/Vectors/math/rng.json, lcg.json.

/// Mulberry32 — `createRng(seed)` in core/math.js (also inlined in ocean/waves.js setSeed).
public struct Mulberry32 {
  public private(set) var state: UInt32

  /// `createRng(seed)`: `let s = seed >>> 0`.
  public init(seed: Double = 1) { state = JSNumber.toUint32(seed) }
  public init(state: UInt32) { self.state = state }

  /// The raw 32-bit output of one step (before the division by 2^32).
  @inline(__always) public mutating func nextUInt32() -> UInt32 {
    // s = (s + 0x6d2b79f5) >>> 0
    state = state &+ 0x6d2b_79f5
    var t = state
    // t = Math.imul(t ^ (t >>> 15), t | 1)
    t = (t ^ (t >> 15)) &* (t | 1)
    // t ^= t + Math.imul(t ^ (t >>> 7), t | 61)   (int32 + int32 in double, then ToInt32 = wrapping add)
    t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
    // (t ^ (t >>> 14)) >>> 0
    return t ^ (t >> 14)
  }

  /// next(): [0, 1)
  @inline(__always) public mutating func next() -> Double { Double(nextUInt32()) / 4294967296.0 }

  /// range(a, b) = a + (b - a) * next()
  @inline(__always) public mutating func range(_ a: Double, _ b: Double) -> Double { a + (b - a) * next() }

  /// int(a, b) = Math.floor(a + (b - a + 1) * next())  (a JS number; see intValue for an Int)
  @inline(__always) public mutating func int(_ a: Double, _ b: Double) -> Double { (a + (b - a + 1) * next()).rounded(.down) }

  /// int(a, b) as a Swift Int (a, b small integers).
  @inline(__always) public mutating func intValue(_ a: Int, _ b: Int) -> Int { Int(int(Double(a), Double(b))) }

  /// pick(arr) = arr[Math.floor(next() * arr.length)]
  public mutating func pick<T>(_ arr: [T]) -> T? {
    let i = (next() * Double(arr.count)).rounded(.down)
    // JS returns undefined for an empty array (i = NaN or 0 out of range)
    guard i >= 0, i < Double(arr.count) else { return nil }
    return arr[Int(i)]
  }

  /// pick index: Math.floor(next() * length)
  @inline(__always) public mutating func pickIndex(_ count: Int) -> Int { Int((next() * Double(count)).rounded(.down)) }

  /// chance(p) = next() < p
  @inline(__always) public mutating func chance(_ p: Double) -> Bool { next() < p }

  /// sign() = next() < 0.5 ? -1 : 1
  @inline(__always) public mutating func sign() -> Double { next() < 0.5 ? -1 : 1 }

  /// gauss(): Box–Muller, rejecting exact zeros.
  public mutating func gauss() -> Double {
    var u = 0.0, v = 0.0
    while u == 0 { u = next() }
    while v == 0 { v = next() }
    return JS.sqrt(-2 * JS.log(u)) * JS.cos(2 * JS.PI * v)
  }
}

/// Reference-type wrapper for code that shares one generator (`ctx.rng` in main.js).
public final class Rng {
  public var core: Mulberry32
  public init(seed: Double = 1) { core = Mulberry32(seed: seed) }
  @inline(__always) public func next() -> Double { core.next() }
  @inline(__always) public func range(_ a: Double, _ b: Double) -> Double { core.range(a, b) }
  @inline(__always) public func int(_ a: Double, _ b: Double) -> Double { core.int(a, b) }
  public func pick<T>(_ arr: [T]) -> T? { core.pick(arr) }
  @inline(__always) public func chance(_ p: Double) -> Bool { core.chance(p) }
  @inline(__always) public func sign() -> Double { core.sign() }
  public func gauss() -> Double { core.gauss() }
}

/// `s = (s * mul + add) >>> 0` computed like JS: the product is a double (exact below 2^53, ROUNDED
/// above — the 1103515245 generator exceeds 2^53, so it is not plain UInt32 wrapping arithmetic).
public struct JSLCG {
  public let mul: Double
  public let add: Double
  public private(set) var state: UInt32

  public init(mul: Double, add: Double, seed: Double) {
    self.mul = mul
    self.add = add
    state = JSNumber.toUint32(seed)
  }

  /// Numerical Recipes (1664525, 1013904223): look.js makeDetail, thermal, ocean selftest, chart…
  public static func numerical(seed: Double) -> JSLCG { JSLCG(mul: 1664525, add: 1013904223, seed: seed) }
  /// ANSI C (1103515245, 12345): ui transition, radar.
  public static func ansiC(seed: Double) -> JSLCG { JSLCG(mul: 1103515245, add: 12345, seed: seed) }

  /// One step; returns the new state.
  @inline(__always) public mutating func step() -> UInt32 {
    state = JSNumber.toUint32(Double(state) * mul + add)
    return state
  }

  /// rnd() = (s = …) / 4294967296
  @inline(__always) public mutating func next() -> Double { Double(step()) / 4294967296.0 }
}

/// Seed derivations used by the systems (Tests/Vectors/math/rng.json data.seedFormulas; the
/// call sites are listed in Resources/Data/game.json derived.seedSites). `seed` is the mission's
/// `def.seed` (a JS number).
public enum SeedFormulas {
  /// systems/weather.js: createRng(((def.seed ?? 1) * 7919 + 13) >>> 0)
  public static func weather(_ seed: Double) -> UInt32 { JSNumber.toUint32(seed * 7919 + 13) }
  /// systems/hazards.js: rng32(((Number(def.seed) || 1) * 2246822519 + 77) >>> 0)
  public static func hazards(_ seed: Double) -> UInt32 { JSNumber.toUint32(JSNumber.or(seed, 1) * 2246822519 + 77) }
  /// systems/survivors.js: createRng((((def?.seed ?? 1) >>> 0) * 31 + 7) >>> 0)
  public static func survivors(_ seed: Double) -> UInt32 { JSNumber.toUint32(Double(JSNumber.toUint32(seed)) * 31 + 7) }
  /// systems/ocean.js: bank.setSeed(seed + 101, …) with seed = def.seed | 0
  public static func oceanSeed(_ seed: Double) -> Double { Double(JSNumber.toInt32(seed)) + 101 }
  /// systems/ocean.js: base swell offset ((((seed * 2654435761) >>> 0) / 4294967296) * 40 - 20) * DEG, seed = def.seed | 0
  public static func oceanSwellOffset(_ seed: Double) -> Double {
    let s = Double(JSNumber.toInt32(seed))
    return ((Double(JSNumber.toUint32(s * 2654435761)) / 4294967296) * 40 - 20) * (JS.PI / 180)
  }
  /// systems/survivors.js: makeFallbackPeople((def.seed ?? 1) * 97 + s.id, …)
  public static func peopleFallback(_ seed: Double, id: Double) -> Double { seed * 97 + id }
}
