// BootstrapPalette — the packed weather palettes (palette.json `weather/palette`: COMPILED[preset],
// OFF, SLOTS) and a linear blend between presets.
//
// BOOTSTRAP: port of the parts of rescue/src/systems/weather/palette.js the M0 sea needs (unpack
// semantics: colours linear, angle slots = (sin, cos), sea.roughness folds in roughnessRain·rain).
// The real WeatherSim (channel timings, greenTint, fronts, schedules) is MaydayCore/Weather.
import Foundation

final class PaletteTable {
  let names: [String]
  let offsets: [String: Int]
  let compiled: [String: [Double]]
  let slots: Int

  init(palette p: BootJSON, presetNames: [String]) throws {
    var off: [String: Int] = [:]
    for k in p["OFF"].keys { if let o = p["OFF"][k].int { off[k] = o } }
    var comp: [String: [Double]] = [:]
    for k in p["COMPILED"].keys { comp[k] = p["COMPILED"][k].doubles }
    let n = p["SLOTS"].int(or: 0)
    guard n > 0, !off.isEmpty, !comp.isEmpty else { throw DataBundleError.malformed("palette.json weather/palette") }
    for (k, v) in comp where v.count != n { throw DataBundleError.malformed("palette \(k): \(v.count) slots, expected \(n)") }
    offsets = off
    compiled = comp
    slots = n
    let ordered = presetNames.filter { comp[$0] != nil }
    names = ordered.isEmpty ? comp.keys.sorted() : ordered
  }

  func packed(_ name: String) -> [Double] {
    compiled[name] ?? compiled[names.first ?? ""] ?? [Double](repeating: 0, count: slots)
  }

  /// out = a + (b − a)·t (palette.js blendPacked with one t for every channel).
  static func blend(_ a: [Double], _ b: [Double], _ t: Double) -> [Double] {
    var out = a
    for i in 0..<min(a.count, b.count) { out[i] = a[i] + (b[i] - a[i]) * t }
    return out
  }
}

struct PaletteSnapshot {
  var packed: [Double]
  let offsets: [String: Int]

  func num(_ key: String) -> Double {
    guard let o = offsets[key], o < packed.count else { return 0 }
    return packed[o]
  }

  func color(_ key: String) -> SIMD3<Double> {
    guard let o = offsets[key], o + 2 < packed.count else { return SIMD3<Double>(0, 0, 0) }
    return SIMD3<Double>(packed[o], packed[o + 1], packed[o + 2])
  }

  func colorF(_ key: String) -> SIMD3<Float> {
    let c = color(key)
    return SIMD3<Float>(Float(c.x), Float(c.y), Float(c.z))
  }

  func vec3(_ key: String) -> SIMD3<Double> { color(key) }

  /// Angle slots store (sin, cos); palette.js unpack → degrees via atan2(sin, cos). Returns radians.
  func angle(_ key: String) -> Double {
    guard let o = offsets[key], o + 1 < packed.count else { return 0 }
    return atan2(packed[o], packed[o + 1])
  }

  /// unpack(): p.sea.roughness = sea.roughness + sea.roughnessRain · rain.
  var seaRoughness: Double { num("sea.roughness") + num("sea.roughnessRain") * num("rain") }
}
