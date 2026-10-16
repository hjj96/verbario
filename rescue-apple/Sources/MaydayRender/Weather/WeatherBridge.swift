// WeatherBridge — what systems/weather.js writes into the three scene every frame, as RenderFrame inputs
// (PLAN §2.9 systems/weather.js row: WeatherBridge — fog, clear colour, exposure, lights):
//   * scene.fog: colour = palette.fogColor + flashColor · (flash · 0.025) (the fog bubble is lit by
//     lightning too), near = palette.fogNear, far = max(near + 1, palette.fogFar); scene.background =
//     the fog colour (the scene pass clears to it);
//   * lights: SunRig (weather/lights.js) → LightsInput (sun, hemisphere, shadow);
//   * scene.environmentIntensity = palette.envIntensity · (1 + 3·flash); the env bake inputs (env.js);
//   * renderer.toneMappingExposure baseline = palette.exposure · (1 + 2.4·flash) (post.js refines it:
//     PostState.exposure is what the frame uses when post runs).
// Inputs are MaydayCore data (Palette from the packed preset tables) plus the weather state scalars, so
// the same code serves the bootstrap simulation now and WeatherSim once it is ported to Core.
import Foundation
import MaydayCore

public enum WeatherBridge {
  /// weather.js update(): scene.fog (THREE.Fog, linear colour).
  public static func fog(palette p: Palette, flash: Double, flashColor: PaletteColor) -> FogInput {
    let k = flash * 0.025
    var f = FogInput()
    f.color = SIMD3<Float>(Float(p.fogColor.r + flashColor.r * k), Float(p.fogColor.g + flashColor.g * k),
                           Float(p.fogColor.b + flashColor.b * k))
    f.near = Float(p.fogNear)
    f.far = Float(JS.max(p.fogNear + 1, p.fogFar))
    f.enabled = true
    return f
  }

  /// weather.js: renderer.toneMappingExposure when post is a stub (PostState overrides it).
  public static func baseExposure(palette p: Palette, flash: Double) -> Double {
    p.exposure * (1 + 2.4 * flash)
  }

  /// The light set weather owns (sun + hemisphere + shadow) after WeatherLights.update, plus
  /// scene.environmentIntensity. Spot / point lights (heli, ship, fx pools) are added by their owners.
  public static func lights(rig: SunRig, palette p: Palette, flash: Double, shadows: Bool = true) -> LightsInput {
    var l = LightsInput()
    l.apply(rig: rig.state, shadowOnlyLayer: rig.shadowLayer1, shadows: shadows)
    l.environmentIntensity = Float(EnvRebakePolicy.environmentIntensity(envIntensity: p.envIntensity, flash: flash))
    return l
  }

  /// One weather frame's environment input: bake when the policy says so (WeatherEnv.update).
  public static func environment(policy: inout EnvRebakePolicy, palette p: Palette, sunDirVisual: V3,
                                 clock: Double, flash: Double, transitioning: Bool) -> EnvironmentInput {
    var e = EnvironmentInput()
    e.rebake = policy.update(clock: clock, flash: flash, transitioning: transitioning)
    if e.rebake { e.sky = EnvSkyParams(palette: p, sunDirVisual: sunDirVisual) }
    return e
  }
}
