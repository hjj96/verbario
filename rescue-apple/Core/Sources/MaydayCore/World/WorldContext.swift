// The slice of the web's `ctx` the world reads (systems/world.js + world/*), as narrow query protocols,
// and the per-frame environment `world.env` it shares with the places (WorldEnv).
//
//   ctx.ocean     heightAt / normalAt (bobbing, pile collars), searchlightAt (collar glow), stamp('foam')
//                 (container wash), setShoals (surf rings), the terrain meshes for the coast map
//   ctx.weather   weather.state (night, rain, intensity, visibility, fog, windDir, windSpeed, flash,
//                 waveHeight, palette) and windAt(x, z); scene.fog near / far (the weather sets them)
//   ctx.hazards   surfaceFlowAt(x, z) (floaters drift in whirlpools / downbursts)
//   ctx.camera    position + world direction (the focus under the screen centre, the lantern flash)
//   ctx.heli      position (the lighthouse spot sweeps toward it)
// OceanSim and WeatherSim conform below; tests use small stubs.

/// ctx.ocean as the world uses it.
public protocol WorldOcean: AnyObject {
  func heightAt(_ x: Double, _ z: Double) -> Double
  /// normalAt(x, z, out)
  func worldNormalAt(_ x: Double, _ z: Double) -> V3
  /// searchlightAt(x, z) (nil = the ocean has no searchlightAt → 0)
  func searchlightLevel(_ x: Double, _ z: Double) -> Double?
  /// stamp('foam', x, z, {radius, strength})
  func stampFoam(_ x: Double, _ z: Double, radius: Double, strength: Double)
  /// setShoals(list): the ≤ 8 surf rings nearest the camera focus
  func applyShoals(_ list: [ShoalCircle])
  /// The terrain meshes (non-instanced, carrying aTerr) the ocean bakes its coastline map from: `key`
  /// changes with the set of meshes, `vertices` are their world-space positions (ocean.js _syncCoast).
  func applyTerrain(key: String, vertices: [V3])
}

/// ctx.hazards: the surface flow floaters drift with.
public protocol WorldHazards: AnyObject {
  func surfaceFlowAt(_ x: Double, _ z: Double) -> V2
}

/// weather.state.palette entries the world reads (nil = absent / not a THREE.Color).
public struct WorldPaletteReadout: Equatable, Sendable {
  public var seaHs: Double?
  public var ambient: Color3?
  public var sun: Color3?
  public var foam: Color3?
  public var shadowIntensity: Double?
  public var ambientIntensity: Double?
  public var sunIntensity: Double?

  public init(seaHs: Double? = nil, ambient: Color3? = nil, sun: Color3? = nil, foam: Color3? = nil, shadowIntensity: Double? = nil,
              ambientIntensity: Double? = nil, sunIntensity: Double? = nil) {
    self.seaHs = seaHs
    self.ambient = ambient
    self.sun = sun
    self.foam = foam
    self.shadowIntensity = shadowIntensity
    self.ambientIntensity = ambientIntensity
    self.sunIntensity = sunIntensity
  }
}

/// weather.state as the world reads it (`st.x ?? default`; nil = undefined), plus scene.fog.
public struct WorldWeatherState: Equatable, Sendable {
  public var night: Double?
  public var rain: Double?
  public var intensity: Double?
  public var visibility: Double?
  public var fog: Double?
  public var windDir: V2?
  public var windSpeed: Double?
  public var flash: Double?
  public var waveHeight: Double?
  /// nil = `{}`
  public var palette: WorldPaletteReadout?
  /// scene.fog (a THREE.Fog the weather keeps): near / far; nil = no fog object
  public var fogNear: Double?
  public var fogFar: Double?

  public init(night: Double? = nil, rain: Double? = nil, intensity: Double? = nil, visibility: Double? = nil, fog: Double? = nil,
              windDir: V2? = nil, windSpeed: Double? = nil, flash: Double? = nil, waveHeight: Double? = nil, palette: WorldPaletteReadout? = nil,
              fogNear: Double? = nil, fogFar: Double? = nil) {
    self.night = night
    self.rain = rain
    self.intensity = intensity
    self.visibility = visibility
    self.fog = fog
    self.windDir = windDir
    self.windSpeed = windSpeed
    self.flash = flash
    self.waveHeight = waveHeight
    self.palette = palette
    self.fogNear = fogNear
    self.fogFar = fogFar
  }
}

/// ctx.weather as the world uses it.
public protocol WorldWeather: AnyObject {
  /// weather.state (nil = `{}`)
  var worldState: WorldWeatherState? { get }
  /// windAt(x, z, out): surface wind (x east, y = z), m/s
  func windAt(_ x: Double, _ z: Double) -> V2
}

/// ctx.camera for the world: position and getWorldDirection() (unit).
public typealias WorldCameraInput = WeatherCameraInput

/// world.env: the per-frame environment shared with the places (world.js _refreshEnv).
public struct WorldEnv: Equatable, Sendable {
  public var t: Double = 0
  public var dt: Double = 0
  public var night: Double = 0
  public var fogK: Double = 0
  public var haze: Double = 0
  public var rain: Double = 0
  public var intensity: Double = 0
  public var visibility: Double = 20000
  public var Hs: Double = 0.5
  public var flash: Double = 0
  public var lightsOn: Double = 0
  public var reduceFlashes = false
  public var wind = V2()
  public var windDir = V2(1, 0)
  public var current = V2()
  /// the point under the screen centre (the fog patch's formula)
  public var focus = V2()
  public var camPos = V3()
  public var heliPos = V3()

  public init() {}
}

// ---- the real systems ---------------------------------------------------------------------------------

extension OceanSim: WorldOcean {
  public func worldNormalAt(_ x: Double, _ z: Double) -> V3 { normalAt(x, z, tOffset: 0) }
  public func searchlightLevel(_ x: Double, _ z: Double) -> Double? { searchlightAt(x, z) }
  public func stampFoam(_ x: Double, _ z: Double, radius: Double, strength: Double) { stamp("foam", x, z, radius: radius, strength: strength) }
  public func applyShoals(_ list: [ShoalCircle]) { setShoals(list.map { ShoalSpec(x: $0.x, z: $0.z, radius: $0.radius) }) }
  public func applyTerrain(key: String, vertices: [V3]) { setTerrain(key: key, vertices: vertices) }
}

extension WeatherSim: WorldWeather {
  public var worldState: WorldWeatherState? {
    let st = state
    let p = st.palette
    func c(_ x: PaletteColor) -> Color3 { Color3(x.r, x.g, x.b) }
    return WorldWeatherState(
      night: st.night, rain: st.rain, intensity: st.intensity, visibility: st.visibility, fog: st.fog, windDir: st.windDir, windSpeed: st.windSpeed,
      flash: st.flash, waveHeight: st.waveHeight,
      palette: WorldPaletteReadout(seaHs: p.sea.Hs, ambient: c(p.ambient), sun: c(p.sun), foam: c(p.foam), shadowIntensity: p.shadowIntensity,
                                   ambientIntensity: p.ambientIntensity, sunIntensity: p.sunIntensity),
      fogNear: fogNear, fogFar: fogFar)
  }
}
