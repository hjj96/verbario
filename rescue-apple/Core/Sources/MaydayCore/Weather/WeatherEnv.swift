// Environment re-bake policy (systems/weather/env.js WeatherEnv.update; DESIGN §2.7.3).
// The PMREM environment for props is re-baked at the start and end of a transition (markDirty), in
// between at most once every 4 s while a transition runs, and never in a flash frame — flashes light
// props through scene.environmentIntensity = envIntensity · (1 + 3·flash) instead. The bake itself (the
// analytic sky → cube-UV atlas) is the renderer's EnvironmentProbe; WeatherSim only decides when.

public struct WeatherEnv: Equatable, Sendable {
  public private(set) var lastBake: Double = -99
  public private(set) var dirty = true
  /// The decision of the last update(): bake this frame (with the palette / sunDirVisual of this frame).
  public private(set) var bakeNow = false
  /// scene.environmentIntensity of the last update().
  public private(set) var environmentIntensity: Double = 1

  public init() {}

  /// markDirty(): force a bake on the next eligible frame (transition start / end).
  public mutating func markDirty() { dirty = true }

  /// update(clock, st, transitioning). `available` = a PMREM generator exists (the web skips the
  /// schedule entirely without one; the renderer always has its probe).
  public mutating func update(clock: Double, envIntensity: Double, flash: Double, transitioning: Bool, available: Bool = true) {
    environmentIntensity = envIntensity * (1 + 3 * flash)
    bakeNow = false
    if !available { return }
    if flash > 0.01 { return } // never bake in a flash frame
    let due = dirty || (transitioning && clock - lastBake >= 4)
    if !due { return }
    bakeNow = true
    lastBake = clock
    dirty = false
  }

  /// WeatherEnv.bake's cloud uniform: clamp(0.25 + 0.6 · fog + 0.4 · scud, 0, 1) (THREE.MathUtils.clamp).
  public static func cloud(fog: Double, scud: Double) -> Double {
    MathUtils.clamp(0.25 + 0.6 * fog + 0.4 * scud, 0, 1)
  }

  mutating func restore(lastBake l: Double, dirty d: Bool) {
    lastBake = l
    dirty = d
  }
}
