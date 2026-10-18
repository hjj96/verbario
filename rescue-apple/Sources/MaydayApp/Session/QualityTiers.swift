// QualityTiers — the renderer's per-tier configuration, assembled from the web's own tables:
//   ocean/waves.js QUALITY  (grid N, waves, OCEAN_Q, water-memory size, glints)  → OceanSimTables.waves.quality
//   post.js SAMPLES / MIN_SCALE (MSAA samples: 0 = none → 1; dynamic-resolution floor)  → post.json `post`
// Settings own the tier name (`quality`); an unknown name falls back to 'high' like ocean._buildMesh.
import Foundation
import MaydayCore

struct QualityTiers {
  static let order = ["low", "medium", "high"]
  let configs: [String: RenderQualityConfig]

  /// `ocean`: OceanSimTables (ocean.json); `post`: the payload of post.json.
  init(ocean: OceanSimTables, post: JSONValue) throws {
    var c: [String: RenderQualityConfig] = [:]
    let p = post["post"]
    for name in QualityTiers.order {
      guard let q = ocean.waves.quality[name] else { throw DataBundleError.malformed("ocean.json QUALITY.\(name)") }
      c[name] = RenderQualityConfig(
        name: name,
        sampleCount: max(1, try p["SAMPLES"][name].requireInt("post.SAMPLES.\(name)")),
        oceanGridN: q.grid,
        oceanWaves: q.waves,
        oceanQ: q.q,
        oceanGlints: q.glints,
        oceanMemory: q.memory,
        minDynScale: try p["MIN_SCALE"][name].requireDouble("post.MIN_SCALE.\(name)"))
    }
    configs = c
  }

  /// The tier for a settings value (QUALITY[q] || high).
  func config(_ name: String?) -> RenderQualityConfig {
    if let n = name, let c = configs[n] { return c }
    return configs["high"]!   // init guarantees all three tiers
  }

  /// The tier after `name` in low → medium → high → low (debug hotkey).
  static func next(after name: String?) -> String {
    let i = name.flatMap { order.firstIndex(of: $0) } ?? (order.count - 1)
    return order[(i + 1) % order.count]
  }
}
