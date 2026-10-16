// The CPU-only parts of systems/ocean.js that drive the wave bank (no rendering):
// mission reset (seeded swell direction), the per-frame inputs to WaveBank.update and the snapped
// grid offset under the screen-centre focus.

public enum OceanCPU {
  public static let DEG: Double = JS.PI / 180

  /// ocean.js `_reset(def)`: bank.setSeed(seed + 101, windAngle + off) with seed = def.seed | 0
  /// (non-finite seeds → 1) and the base swell within ±20° of the wind at mission start.
  public static func reset(_ bank: WaveBank, missionSeed: Double?, windAngle: Double) {
    var raw = 1.0
    if let s = missionSeed, s.isFinite { raw = s }
    let seed = Double(JSNumber.toInt32(raw))
    let off = ((Double(JSNumber.toUint32(seed * 2654435761)) / 4294967296) * 40 - 20) * DEG
    bank.setSeed(seed + 101, windAngle + off)
    bank.snap = true
  }

  /// windAngle = wd ? Math.atan2(wd.y, wd.x) : 0   (weather.state.windDir, x = world X, y = world Z)
  public static func windAngle(_ windDir: V2?) -> Double {
    guard let wd = windDir else { return 0 }
    return JS.atan2(wd.y, wd.x)
  }

  /// clearing look: palette.sea.clearing if weather provides it, else the long-swell signature.
  public static func clearing(_ sea: SeaState) -> Double {
    MathUtil.clamp(sea.clearing ?? MathUtil.smoothstepOcean(0.8, 1.4, sea.swellAdd ?? 0), 0, 1)
  }

  /// shortScale argument of WaveBank.update: 1 - 0.75 * clearing
  public static func shortScale(_ sea: SeaState) -> Double { 1 - 0.75 * clearing(sea) }

  /// Focus under the screen centre (same formula as the fog patch) from the camera world position
  /// and world direction: k = cam.y / max(-fwd.y, 0.25); focus = (cam.x + fwd.x·k, cam.z + fwd.z·k).
  public static func focus(cameraPosition cam: V3, cameraDirection fwd: V3) -> V2 {
    let k = cam.y / JS.max(-fwd.y, 0.25)
    return V2(cam.x + fwd.x * k, cam.z + fwd.z * k)
  }

  /// Snapped grid offset: ox = Math.round(focus.x / q) * q (q = snapQuantum(grid)).
  public static func snappedOffset(_ focus: V2, quantum q: Double) -> V2 {
    V2(JSNumber.round(focus.x / q) * q, JSNumber.round(focus.y / q) * q)
  }
}
