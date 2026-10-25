// The slice of the web's `ctx` that SURVIVORS (systems/survivors.js + survivors/*) and FX (systems/fx.js +
// fx/*) read, as narrow query protocols with value views — the same rules as Heli/SimContext.swift:
//   * `ctx.ocean?.x ? ctx.ocean.x(…) : d` → a nil query gives the default; a query that exists answers
//     every member (the real systems define them all; the protocol extensions give the web's
//     "method missing" behaviour where a stub may lack one);
//   * objects the web holds by reference are value views read when needed (the heli, hazards, decks);
//   * survivor groups / carriers / flares stay reference types inside these two systems (the web mutates
//     them through shared references: carrier.owner, riders, datum.s, a held flare's x / z).
// The real WeatherSim, OceanSim and Helicopter conform below; World, Hazards, Mission and Post conform
// when they are ported (until then the app and the tests provide small stubs). `SeaContext` is built from
// the shared SimContext + GameLoop by the host (`init(sim:loop:)`).

// ---- views -------------------------------------------------------------------------------------------------

/// The weather.state palette entries survivors / fx read (linear working-space colours); nil = missing.
public struct SeaPalette: Equatable, Sendable {
  public var ambient: Color3?
  public var ambientIntensity: Double?
  public var sun: Color3?
  public var sunIntensity: Double?
  public var sky: Color3?
  public var foam: Color3?
  public var body: Color3?

  public init(ambient: Color3? = nil, ambientIntensity: Double? = nil, sun: Color3? = nil, sunIntensity: Double? = nil, sky: Color3? = nil,
              foam: Color3? = nil, body: Color3? = nil) {
    self.ambient = ambient
    self.ambientIntensity = ambientIntensity
    self.sun = sun
    self.sunIntensity = sunIntensity
    self.sky = sky
    self.foam = foam
    self.body = body
  }
}

/// weather.state as survivors / fx read it (each member nil = `undefined`, so `st.x ?? d` keeps working).
public struct SeaWeatherState: Equatable, Sendable {
  public var preset: String?
  public var night: Double?
  public var intensity: Double?
  public var fog: Double?
  public var rain: Double?
  public var hail: Double?
  public var waveHeight: Double?
  public var windDir: V2?
  public var windSpeed: Double?
  public var flash: Double?
  public var flashColor: Color3?
  public var sunDir: V3?
  public var sunDirVisual: V3?
  /// nil = `palette` missing (`st.palette || {}`)
  public var palette: SeaPalette?

  public init(preset: String? = nil, night: Double? = nil, intensity: Double? = nil, fog: Double? = nil, rain: Double? = nil, hail: Double? = nil,
              waveHeight: Double? = nil, windDir: V2? = nil, windSpeed: Double? = nil, flash: Double? = nil, flashColor: Color3? = nil,
              sunDir: V3? = nil, sunDirVisual: V3? = nil, palette: SeaPalette? = nil) {
    self.preset = preset
    self.night = night
    self.intensity = intensity
    self.fog = fog
    self.rain = rain
    self.hail = hail
    self.waveHeight = waveHeight
    self.windDir = windDir
    self.windSpeed = windSpeed
    self.flash = flash
    self.flashColor = flashColor
    self.sunDir = sunDir
    self.sunDirVisual = sunDirVisual
    self.palette = palette
  }
}

/// One weather.forecast() entry (the gull gate reads `in` and `preset`).
public struct SeaForecast: Equatable, Sendable {
  public var inS: Double
  public var preset: String

  public init(inS: Double, preset: String) {
    self.inS = inS
    self.preset = preset
  }
}

/// The helicopter as survivors / fx see it this frame (ctx.heli; nil members = undefined).
public struct SeaHeliView: Equatable, Sendable {
  public var position: V3
  public var velocity: V3?
  /// h.altitude (nil / non-finite → position.y)
  public var altitude: Double?
  /// h.alive !== false
  public var alive: Bool
  /// !!h.landed
  public var landed: Bool
  /// h.landed.position.y (fx: no spray from a rotor turning on a high deck)
  public var landedPadY: Double?
  public var rotorRPM: Double?
  /// h.downwash {x, z, radius, strength} (nil = not published)
  public var downwash: Downwash?
  /// h.beam (fx air uniforms)
  public var beam: SearchlightBeam?
  /// h.winch: state, load, basket, height (nil winch = 'stowed', no basket)
  public var winchState: String
  public var winchLoad: GroupID?
  public var basket: V3?
  public var winchHeight: Double?
  /// h.winchCtl.basketMesh: the rendered basket (person on the cable follows it)
  public var basketMeshVisible: Bool
  public var basketMeshPosition: V3
  public var basketMeshQuaternion: Quat

  public init(position: V3, velocity: V3? = nil, altitude: Double? = nil, alive: Bool = true, landed: Bool = false, landedPadY: Double? = nil,
              rotorRPM: Double? = nil, downwash: Downwash? = nil, beam: SearchlightBeam? = nil, winchState: String = "stowed",
              winchLoad: GroupID? = nil, basket: V3? = nil, winchHeight: Double? = nil, basketMeshVisible: Bool = false,
              basketMeshPosition: V3 = V3(), basketMeshQuaternion: Quat = Quat()) {
    self.position = position
    self.velocity = velocity
    self.altitude = altitude
    self.alive = alive
    self.landed = landed
    self.landedPadY = landedPadY
    self.rotorRPM = rotorRPM
    self.downwash = downwash
    self.beam = beam
    self.winchState = winchState
    self.winchLoad = winchLoad
    self.basket = basket
    self.winchHeight = winchHeight
    self.basketMeshVisible = basketMeshVisible
    self.basketMeshPosition = basketMeshPosition
    self.basketMeshQuaternion = basketMeshQuaternion
  }
}

/// An active hazard as survivors read it (hazards.list[i]).
public struct SeaHazard: Equatable, Sendable {
  /// 'whirlpool' | 'rogue' | 'waterspout' | …
  public var type: String
  public var position: V3?
  /// h.radius (whirlpools; nil / 0 → 45)
  public var radius: Double?
  /// h.dir || h.direction as (x, z) (rogue crests)
  public var dir: V2?

  public init(type: String, position: V3? = nil, radius: Double? = nil, dir: V2? = nil) {
    self.type = type
    self.position = position
    self.radius = radius
    self.dir = dir
  }
}

/// A structure deck the world draws (pad.lowerDeck: the rig's open lower deck).
public struct SeaLowerDeck: Equatable, Sendable {
  public var x: Double
  public var y: Double?
  public var z: Double

  public init(x: Double, y: Double? = nil, z: Double) {
    self.x = x
    self.y = y
    self.z = z
  }
}

/// Something the bottle must not float into (world.obstacles + world.pads: o.x, o.z, o.radius).
public struct SeaBlocker: Equatable, Sendable {
  public var x: Double?
  public var z: Double?
  public var radius: Double?

  public init(x: Double?, z: Double?, radius: Double?) {
    self.x = x
    self.z = z
    self.radius = radius
  }
}

// ---- queries ---------------------------------------------------------------------------------------------

/// ctx.ocean (the real OceanSim conforms below)
public protocol SeaOceanQuery: AnyObject {
  func heightAt(_ x: Double, _ z: Double) -> Double
  /// normalAt(x, z, out)
  func seaNormalAt(_ x: Double, _ z: Double) -> V3
  /// searchlightAt(x, z, y): 0…1 inside the searchlight pool
  func searchlightAt(_ x: Double, _ z: Double, _ y: Double) -> Double
  /// splash(x, z, radius, strength)
  func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double)
  /// stamp(kind, x, z, {radius, strength}): water memory (foam, oil, dye, ring)
  func seaStamp(_ kind: String, _ x: Double, _ z: Double, radius: Double, strength: Double)
  /// addGlint(x, z, radius, intensity, color)
  func addSeaGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: Color3)
  /// addWake(x, z, strength, dirX, dirZ)
  func seaWake(_ x: Double, _ z: Double, _ strength: Double, _ dirX: Double, _ dirZ: Double)
  /// The first live whirlpool feature slot covering (x, z): (distance, radius) — survivors._whirlpoolAt's
  /// second loop over ocean.features.slots (type 3, not removed, r = B[0] || 45).
  func featureWhirlpool(_ x: Double, _ z: Double) -> (d: Double, r: Double)?
  /// The first live rogue feature slot's (B[0], B[1]) — survivors._rogueDir's slot loop (type 1).
  func featureRogueDir() -> V2?
  /// ocean.bioluminescence (nil = undefined)
  var seaBioluminescence: Double? { get }
}

extension SeaOceanQuery {
  public func featureWhirlpool(_ x: Double, _ z: Double) -> (d: Double, r: Double)? { nil }
  public func featureRogueDir() -> V2? { nil }
  public var seaBioluminescence: Double? { nil }
}

/// ctx.weather (the real WeatherSim conforms below)
public protocol SeaWeatherQuery: AnyObject {
  /// weather.state
  var seaState: SeaWeatherState { get }
  /// windAt(x, z, out); nil = the weather has no windAt
  func seaWindAt(_ x: Double, _ z: Double) -> V2?
  /// detectBase(): {base, altBonus}; nil = missing (or the call threw)
  func seaDetectBase() -> (base: Double, altBonus: Double)?
  /// forecast(); nil = missing
  func seaForecast() -> [SeaForecast]?
}

/// ctx.heli (Helicopter conforms below)
public protocol SeaHeliSource: AnyObject {
  var seaView: SeaHeliView { get }
}

/// ctx.hazards
public protocol SeaHazardQuery: AnyObject {
  /// the live hazard's position (fx: gulls flee a spawning / warned hazard); nil = unknown
  func hazardPosition(_ id: HazardID) -> V3?
  /// surfaceFlowAt(x, z, out); nil = missing
  func surfaceFlowAt(_ x: Double, _ z: Double) -> V2?
  /// waveLiftAt(x, z) || 0; nil = missing
  func seaWaveLiftAt(_ x: Double, _ z: Double) -> Double?
  /// hazards.list (nil = not an array)
  var seaHazards: [SeaHazard]? { get }
}

extension SeaHazardQuery {
  public func hazardPosition(_ id: HazardID) -> V3? { nil }
  public func surfaceFlowAt(_ x: Double, _ z: Double) -> V2? { nil }
  public func seaWaveLiftAt(_ x: Double, _ z: Double) -> Double? { nil }
  public var seaHazards: [SeaHazard]? { nil }
}

/// ctx.world
public protocol SeaWorldQuery: AnyObject {
  /// world.pads[i].lowerDeck (in pad order; pads without one are skipped)
  var lowerDecks: [SeaLowerDeck] { get }
  /// [...world.obstacles, ...world.pads] for the bottle's placement
  var blockers: [SeaBlocker] { get }
}

extension SeaWorldQuery {
  public var lowerDecks: [SeaLowerDeck] { [] }
  public var blockers: [SeaBlocker] { [] }
}

/// ctx.mission as the bottle books its style bonus (`m.style('bottle', pos)`, `m.scorer.add(…)`, `m.state`).
public protocol SeaMissionHooks: AnyObject {
  /// m.style?.(name, pos) — nil = no style()
  func style(_ name: String, _ pos: V3) -> Double?
  /// !!m.scorer
  var hasScorer: Bool { get }
  /// m.scorer.add(kind, points, reason, pos) — nil = no add()
  func scorerAdd(_ kind: String, _ points: Double, _ reason: String, _ pos: V3) -> Double?
  /// m.state === 'play'
  var isPlaying: Bool { get }
}

/// ctx.fx as survivors call it (Effects conforms; tests may record calls instead).
public protocol SeaFxSink: AnyObject {
  /// fx.splash(x, y, z, size)
  func splash(_ x: Double, _ y: Double, _ z: Double, _ size: Double)
  /// fx.smoke(x, y, z, color, amount)
  func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ amount: Double)
  /// fx.flare(x, z, {life, held}) → the flare (survivors move a held one with the hand)
  func flare(_ x: Double, _ z: Double, life: Double?, held: Bool) -> FxFlare?
  /// fx.burst('rocket', at, {color})
  func rocketBurst(_ at: V3, color: String)
}

// ---- the context --------------------------------------------------------------------------------------------

/// `ctx` for Survivors and Effects.
public final class SeaContext {
  public let events: EventBus
  public var settings: SettingsQuery
  /// Math.random (shared with every other cosmetic draw of the session: SimContext.random)
  public var random: () -> Double
  /// ctx.mode
  public var mode: () -> GameMode
  /// ctx.time.t
  public var time: () -> Double
  public var ocean: SeaOceanQuery?
  public var weather: SeaWeatherQuery?
  public weak var heli: SeaHeliSource?
  public var hazards: SeaHazardQuery?
  public var world: SeaWorldQuery?
  public weak var mission: SeaMissionHooks?
  /// ctx.fx as survivors see it (weak: the host owns Effects)
  public weak var fx: SeaFxSink?
  /// ctx.survivors (fx gulls read the groups)
  public weak var survivors: Survivors?
  /// ctx.camera (fx focus, the «rocket at the lens»)
  public var camera: PerspectiveCamera?
  /// ctx.look.uniforms.uWind.value (the mean wind the weather writes; nil = no look)
  public var meanWind: (() -> V2)?
  /// ctx.look.gustField(x, z) (nil = no look: 0.5)
  public var gustField: ((Double, Double) -> Double)?
  /// ctx.post?.thermal?.active
  public var thermalActive: () -> Bool = { false }
  /// ctx.cameraRig?.mode === 'cinematic'
  public var cameraCinematic: () -> Bool = { false }
  /// ctx.cameraRig?.shake?.(strength, duration) (hail micro-shake)
  public var cameraShake: ((Double, Double) -> Void)?

  public init(events: EventBus, settings: SettingsQuery = StaticSettings(), random: @escaping () -> Double,
              mode: @escaping () -> GameMode = { .play }, time: @escaping () -> Double = { 0 }) {
    self.events = events
    self.settings = settings
    self.random = random
    self.mode = mode
    self.time = time
  }

  /// The host's wiring: the bus, settings, Math.random and camera of the shared SimContext, mode and time
  /// of the loop, the look's wind and gust field (ocean / weather / heli are wired by the host: OceanSim,
  /// WeatherSim, Helicopter conform).
  public convenience init(sim: SimContext, loop: GameLoop, look: Look?) {
    self.init(events: sim.events, settings: sim.settings, random: sim.random, mode: { [weak loop] in loop?.mode ?? .play },
              time: { [weak loop] in loop?.time.t ?? 0 })
    camera = sim.camera
    if let look {
      meanWind = { [weak look] in look?.wind ?? V2() }
      gustField = { [weak look] x, z in look?.gustField(x, z) ?? 0.5 }
    }
  }

  /// settings.get(key) as JS truthiness
  @inline(__always) func flag(_ key: String) -> Bool { settings.get(key).jsTruthy }
}

// ---- the real systems -----------------------------------------------------------------------------------------

extension OceanSim: SeaOceanQuery {
  public func seaNormalAt(_ x: Double, _ z: Double) -> V3 { normalAt(x, z, tOffset: 0) }

  public func seaStamp(_ kind: String, _ x: Double, _ z: Double, radius: Double, strength: Double) {
    stamp(kind, x, z, radius: radius, strength: strength)
  }

  public func addSeaGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: Color3) {
    addGlint(x, z, radius, intensity, PaletteColor(color.r, color.g, color.b))
  }

  public func seaWake(_ x: Double, _ z: Double, _ strength: Double, _ dirX: Double, _ dirZ: Double) {
    addWake(x, z, strength, dirX, dirZ)
  }

  public func featureWhirlpool(_ x: Double, _ z: Double) -> (d: Double, r: Double)? {
    for f in features.slots where f.type == .whirlpool && !f.removed {
      let r = JSNumber.or(f.B.first, 45)
      let d = JS.hypot(f.A[1] - x, f.A[2] - z)
      if d < r { return (d, r) }
    }
    return nil
  }

  public func featureRogueDir() -> V2? {
    for f in features.slots where f.type == .rogue && !f.removed { return V2(f.B[0], f.B[1]) }
    return nil
  }

  public var seaBioluminescence: Double? { bioluminescence }
}

extension WeatherSim: SeaWeatherQuery {
  public var seaState: SeaWeatherState {
    let st = state
    let p = st.palette
    func c(_ x: PaletteColor) -> Color3 { Color3(x.r, x.g, x.b) }
    return SeaWeatherState(
      preset: st.preset, night: st.night, intensity: st.intensity, fog: st.fog, rain: st.rain, hail: st.hail, waveHeight: st.waveHeight,
      windDir: st.windDir, windSpeed: st.windSpeed, flash: st.flash, flashColor: c(st.flashColor), sunDir: st.sunDir, sunDirVisual: st.sunDirVisual,
      palette: SeaPalette(ambient: c(p.ambient), ambientIntensity: p.ambientIntensity, sun: c(p.sun), sunIntensity: p.sunIntensity, sky: c(p.sky),
                          foam: c(p.foam), body: c(p.body)))
  }

  public func seaWindAt(_ x: Double, _ z: Double) -> V2? { windAt(x, z) }

  public func seaDetectBase() -> (base: Double, altBonus: Double)? { detectBase() }

  public func seaForecast() -> [SeaForecast]? { forecast().map { SeaForecast(inS: $0.in, preset: $0.preset) } }
}

extension Helicopter: SeaHeliSource {
  public var seaView: SeaHeliView {
    let w = winch
    let v = w.view
    return SeaHeliView(
      position: position, velocity: velocity, altitude: altitude, alive: alive, landed: landed != nil,
      landedPadY: landed.flatMap { ctx.world?.pad($0)?.position.y }, rotorRPM: rotorRPM, downwash: downwash, beam: beam,
      winchState: w.state.rawValue, winchLoad: w.load, basket: w.basket, winchHeight: w.height, basketMeshVisible: v.basketVisible,
      basketMeshPosition: v.basketPosition, basketMeshQuaternion: v.basketQuaternion)
  }
}
