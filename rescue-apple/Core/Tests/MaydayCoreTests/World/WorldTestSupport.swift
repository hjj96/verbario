// Shared helpers for the world parity tests (Tests/Vectors/world/*, tools/export/export-world.mjs):
// the exported tables, sha256 over Float32 / Uint32 / Float64 little-endian bytes, JSON readers, and the
// stub ocean / weather / hazards the exporter runs the real web World on (same formulas, same order).
import Foundation
import XCTest
@testable import MaydayCore

enum WorldFixtures {
  private static var cached: WorldTables?
  private static let lock = NSLock()

  static func tables() throws -> WorldTables {
    lock.lock()
    defer { lock.unlock() }
    if let t = cached { return t }
    let t = try WorldTables(catalog: try VectorLoader.catalog())
    cached = t
    return t
  }
}

enum Bytes {
  static func f32(_ a: [Float]) -> [UInt8] {
    var out = [UInt8]()
    out.reserveCapacity(a.count * 4)
    for v in a {
      let b = v.bitPattern
      for k in 0..<4 { out.append(UInt8(truncatingIfNeeded: b >> UInt32(8 * k))) }
    }
    return out
  }

  static func u32(_ a: [UInt32]) -> [UInt8] {
    var out = [UInt8]()
    out.reserveCapacity(a.count * 4)
    for b in a { for k in 0..<4 { out.append(UInt8(truncatingIfNeeded: b >> UInt32(8 * k))) } }
    return out
  }

  static func f64(_ a: [Double]) -> [UInt8] {
    var out = [UInt8]()
    out.reserveCapacity(a.count * 8)
    for v in a {
      let b = v.bitPattern
      for k in 0..<8 { out.append(UInt8(truncatingIfNeeded: b >> UInt64(8 * k))) }
    }
    return out
  }

  static func sha(_ a: [Float]) -> String { SHA256.hex(f32(a)) }
  static func sha(_ a: [UInt32]) -> String { SHA256.hex(u32(a)) }
  static func sha(_ a: [Double]) -> String { SHA256.hex(f64(a)) }
}

extension VectorFile {
  /// UInt32 little-endian sidecar.
  func sidecarU32(_ ref: JSONValue) throws -> [UInt32] {
    guard ref["dtype"].string == "u32" else { throw VectorError("\(name): sidecar dtype \(ref["dtype"].string ?? "?"), expected u32") }
    let b = try sidecarBytes(ref)
    var out = [UInt32](repeating: 0, count: b.count / 4)
    for i in 0..<out.count {
      var u: UInt32 = 0
      for k in 0..<4 { u |= UInt32(b[i * 4 + k]) << UInt32(8 * k) }
      out[i] = u
    }
    return out
  }
}

extension JSONValue {
  /// A number array that may hold "NaN" / "-0" strings (JSNumberBox) — `doubles` already decodes them.
  func nums(_ what: String) throws -> [Double] {
    guard let d = doubles else { throw VectorError("\(what): not a number array") }
    return d
  }

  func num(_ what: String) throws -> Double {
    guard let d = double else { throw VectorError("\(what): not a number") }
    return d
  }
}

/// Compares a Float32 array with exported numbers (Float32 values widened to double).
func assertFloats(_ actual: [Float], _ expected: [Double], _ label: String, file: StaticString = #filePath, line: UInt = #line) {
  assertBitEqual(actual.map { Double($0) }, expected, label, file: file, line: line)
}

// ---- stub systems (export-world.mjs makeOcean / windAt / surfaceFlow) ------------------------------------

/// The analytic ocean: heights / normals of (x, z, t), the searchlight disc under the heli, logged stamps
/// and shoal selections.
final class StubWorldOcean: WorldOcean {
  var t: () -> Double
  var heli: () -> V3?
  var frame: () -> Int
  var stamps: [(frame: Int, kind: String, x: Double, z: Double, radius: Double, strength: Double)] = []
  var shoalCalls: [(frame: Int, list: [ShoalCircle])] = []
  var terrainKey = ""
  var terrainVertices: [V3] = []
  /// setup.oceanAmp (the mix run swells 4× so its containers awash)
  var amp: Double = 1

  init(t: @escaping () -> Double, heli: @escaping () -> V3?, frame: @escaping () -> Int) {
    self.t = t
    self.heli = heli
    self.frame = frame
  }

  func heightAt(_ x: Double, _ z: Double) -> Double {
    let t = self.t()
    return amp * (0.35 * JS.sin(0.11 * x + 0.9 * t) + 0.22 * JS.cos(0.07 * z - 0.6 * t + 0.3 * JS.sin(0.02 * x)))
  }

  func worldNormalAt(_ x: Double, _ z: Double) -> V3 {
    let e = 0.5
    let hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e)
    let hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
    return V3(-hx, 1, -hz).normalized()
  }

  func searchlightLevel(_ x: Double, _ z: Double) -> Double? {
    guard let hp = heli() else { return 0 }
    let d = JS.hypot(x - hp.x, z - hp.z)
    return d < 30 ? 1 - d / 30 : 0
  }

  func stampFoam(_ x: Double, _ z: Double, radius: Double, strength: Double) {
    stamps.append((frame(), "foam", x, z, radius, strength))
  }

  func applyShoals(_ list: [ShoalCircle]) { shoalCalls.append((frame(), list)) }

  func applyTerrain(key: String, vertices: [V3]) {
    terrainKey = key
    terrainVertices = vertices
  }
}

/// weather.state from the recorded inputs; windAt: the mean wind modulated in space and time.
final class StubWorldWeather: WorldWeather {
  var state: WorldWeatherState?
  var t: () -> Double

  init(t: @escaping () -> Double) { self.t = t }

  var worldState: WorldWeatherState? { state }

  func windAt(_ x: Double, _ z: Double) -> V2 {
    let st = state ?? WorldWeatherState()
    let t = self.t()
    let dir = st.windDir ?? V2(1, 0), sp = st.windSpeed ?? 0
    let k = 1 + 0.15 * JS.sin(0.013 * x + 0.017 * z + 0.7 * t)
    let a = 0.2 * JS.sin(0.009 * x - 0.011 * z + 0.3 * t)
    let c = JS.cos(a), s = JS.sin(a)
    let wx = dir.x * sp * k, wz = dir.y * sp * k
    return V2(wx * c - wz * s, wx * s + wz * c)
  }
}

/// A tangential, decaying vortex flow round (cx, cz).
final class StubWorldHazards: WorldHazards {
  let cx: Double, cz: Double

  init(cx: Double, cz: Double) {
    self.cx = cx
    self.cz = cz
  }

  func surfaceFlowAt(_ x: Double, _ z: Double) -> V2 {
    let dx = x - cx, dz = z - cz
    let d2 = dx * dx + dz * dz
    let k = 0.6 * JS.exp(-d2 / 3600) / (d2.squareRoot() + 1)
    return V2(-dz * k, dx * k)
  }
}

/// The settings the exporter's stub ctx answers (quality, reduceFlashes; detail()).
final class StubWorldSettings: SettingsQuery {
  var values: [String: JSONValue]
  var detailValue: Double

  init(quality: String, detail: Double = 1, reduceFlashes: Bool = false) {
    values = ["quality": .string(quality), "reduceFlashes": .bool(reduceFlashes)]
    detailValue = detail
  }

  func get(_ key: String) -> JSONValue { values[key] ?? .null }
  func detail() -> Double { detailValue }
}
