// The slice of the web's `ctx` that the helicopter (systems/heli.js + heli/*) and the camera rig
// (systems/camera.js) read, as narrow query protocols with value views.
//
// Web → Swift rules used here (PLAN §2.2 «Идентичность»):
//   * `ctx.ocean?.heightAt ? ctx.ocean.heightAt(x, z) : 0` → `ctx.ocean?.heightAt(x, z) ?? 0`: a system
//     that is absent is a nil query; a query that exists answers every member (the protocol extensions
//     below give the web's "method missing" behaviour as defaults: no-ops, 0, −Infinity, nil);
//   * objects the web keeps by reference (pads, survivor groups, flotsam) are IDs plus a value view the
//     owner returns for the current frame (`world.pad(id)`, `survivors.group(id)`); identity tests
//     (`contactPad !== pad`, `snagInside.has(it)`) compare IDs;
//   * `x || d` on numbers is JSNumber.or (0 / NaN → d), `x ?? d` is Optional ?? d.
// The real systems (WeatherSim, OceanSim, World, Hazards, Survivors, Mission) conform when they are
// ported; until then the app's bootstrap and the tests provide small stubs. SimContext is a stand-in for
// the planned GameContext (PLAN §2.3) — fold it in when Core/Game.swift exists.

// ---- views ---------------------------------------------------------------------------------------------

/// A helipad as the heli sees it this frame (world.pads[i], world.padAt): moving / tilting decks
/// included. `id` is the pad's identity (index in world.pads).
public struct LandingPad: Equatable, Sendable {
  public var id: PadID
  /// 'pad' | 'ship' | 'rig' | 'deck' | 'lighthouse' …
  public var type: String
  public var position: V3
  /// pad.radius (the heli treats 0 / missing as 12 when bumping the deck side)
  public var radius: Double
  /// pad.heading || 0 (clockwise from north)
  public var heading: Double
  /// pad.tilt || 0 (rad)
  public var tilt: Double
  /// pad.velocity (nil = a static pad)
  public var velocity: V3?
  /// pad.services ({fuel %/s, repair %/s, resupply}); nil = `{}`
  public var services: PadServices?
  /// Legacy pad.refuel flag (→ 10 %/s and resupply when services are not given).
  public var refuel: Bool
  /// Deck up vector: column 1 of pad.object3d.matrixWorld (nil when the pad has no object).
  public var up: V3?

  public init(id: PadID, type: String = "pad", position: V3, radius: Double = 12, heading: Double = 0, tilt: Double = 0,
              velocity: V3? = nil, services: PadServices? = nil, refuel: Bool = false, up: V3? = nil) {
    self.id = id
    self.type = type
    self.position = position
    self.radius = radius
    self.heading = heading
    self.tilt = tilt
    self.velocity = velocity
    self.services = services
    self.refuel = refuel
    self.up = up
  }
}

/// pad.services: nil members are `undefined` in the web.
public struct PadServices: Equatable, Sendable {
  public var fuel: Double?
  public var repair: Double?
  public var resupply: Bool?

  public init(fuel: Double? = nil, repair: Double? = nil, resupply: Bool? = nil) {
    self.fuel = fuel
    self.repair = repair
    self.resupply = resupply
  }
}

/// world.obstacles[i]: a vertical cylinder the heli bounces off (rig derrick, lighthouse, masts, rocks).
public struct FlightObstacle: Equatable, Sendable {
  public var x: Double
  public var z: Double
  /// o.radius || 2
  public var radius: Double
  /// o.top ?? Infinity (skids above it pass over)
  public var top: Double?

  public init(x: Double, z: Double, radius: Double = 2, top: Double? = nil) {
    self.x = x
    self.z = z
    self.radius = radius
    self.top = top
  }
}

/// A floating prop the winch cable can snag on: a world floater (`shape`, `moored`) or a hazard debris
/// item (`kind`, `y`). Identity = (source, id).
public struct FlotsamItem: Equatable, Sendable {
  public enum Source: Int, Sendable { case floater, debris }

  public var source: Source
  public var id: Int
  /// floater.shape or the debris kind ('plank', 'barrel', 'board', 'boat', …)
  public var shape: String
  public var x: Double
  /// debris only (airborne junk passes over the cable); NaN = not finite
  public var y: Double
  public var z: Double
  /// floaters: moored buoys never snag
  public var moored: Bool

  public init(source: Source, id: Int, shape: String, x: Double, y: Double = 0, z: Double, moored: Bool = false) {
    self.source = source
    self.id = id
    self.shape = shape
    self.x = x
    self.y = y
    self.z = z
    self.moored = moored
  }

  public struct Key: Hashable, Sendable {
    public var source: Source
    public var id: Int
  }

  public var key: Key { Key(source: source, id: id) }
}

/// An active hazard as heli/camera read it (hazards.list[i]).
public struct HazardReadout: Equatable, Sendable {
  public var id: HazardID
  /// 'waterspout' | 'tornado' | 'rogue' | 'whirlpool' | …
  public var type: String
  public var position: V3
  /// z.coreRadius || z.rc || z.core (nil when none is set)
  public var core: Double?
  /// z.stage (nil = undefined)
  public var stage: Double?

  public init(id: HazardID, type: String, position: V3, core: Double? = nil, stage: Double? = nil) {
    self.id = id
    self.type = type
    self.position = position
    self.core = core
    self.stage = stage
  }
}

/// hazards.imminent: the hazard the camera should reveal.
public struct ImminentHazard: Equatable, Sendable {
  public var type: String
  public var position: V3?
  public var eta: Double?

  public init(type: String, position: V3?, eta: Double? = nil) {
    self.type = type
    self.position = position
    self.eta = eta
  }
}

/// A survivor group as the winch / touch aim see it (survivors.list[i]).
public struct SurvivorView: Equatable, Sendable {
  public var id: GroupID
  /// 'swimmer' | 'raft' | 'injured' | 'deck' | 'wreck' | 'hull' | 'container' | 'plane'
  public var type: String
  public var position: V3
  /// s.velocity: a Vector2 (x, z) reads as (x, 0, y), a Vector3 as is; nil = none
  public var velocity: V3?
  /// s.height (deck / wreck targets: the deck top)
  public var height: Double?
  public var remaining: Double
  /// 'drifting' | 'spotted' | 'winching' | 'rescued' | 'lost' | 'hidden' …
  public var state: String
  public var spotted: Bool

  public init(id: GroupID, type: String, position: V3, velocity: V3? = nil, height: Double? = nil, remaining: Double = 1,
              state: String = "drifting", spotted: Bool = false) {
    self.id = id
    self.type = type
    self.position = position
    self.velocity = velocity
    self.height = height
    self.remaining = remaining
    self.state = state
    self.spotted = spotted
  }
}

/// survivors.boardOne(s): the person record that enters the cabin (nil members use the winch defaults).
public struct BoardedPerson: Equatable, Sendable {
  public var person: PersonID?
  public var name: String?
  public var age: Double?
  public var condition: String?

  public init(person: PersonID? = nil, name: String? = nil, age: Double? = nil, condition: String? = nil) {
    self.person = person
    self.name = name
    self.age = age
    self.condition = condition
  }
}

/// survivors.detachFromBasket(s, opts): opts of a slip.
public struct BasketSlip: Equatable, Sendable {
  public var heatLoss: Double
  public var reason: String

  public init(heatLoss: Double, reason: String) {
    self.heatLoss = heatLoss
    self.reason = reason
  }
}

/// weather.state fields heli and camera read (each `st.x || 0`).
public struct WeatherReadout: Equatable, Sendable {
  public var turbulence: Double = 0
  public var rain: Double = 0
  public var fog: Double = 0
  public var intensity: Double = 0
  public var night: Double = 0
  public var flash: Double = 0
  public var stElmo: Double = 0
  /// st.sunDir / st.sunDirShadow (nil = undefined)
  public var sunDir: V3?
  public var sunDirShadow: V3?
  /// st.palette (hull / rotor-veil shading); nil = undefined
  public var palette: HeliPaletteReadout?

  public init(turbulence: Double = 0, rain: Double = 0, fog: Double = 0, intensity: Double = 0, night: Double = 0, flash: Double = 0,
              stElmo: Double = 0, sunDir: V3? = nil, sunDirShadow: V3? = nil, palette: HeliPaletteReadout? = nil) {
    self.turbulence = turbulence
    self.rain = rain
    self.fog = fog
    self.intensity = intensity
    self.night = night
    self.flash = flash
    self.stElmo = stElmo
    self.sunDir = sunDir
    self.sunDirShadow = sunDirShadow
    self.palette = palette
  }
}

/// The palette entries the airframe shading reads (linear working-space colours).
public struct HeliPaletteReadout: Equatable, Sendable {
  public var ambient: Color3?
  public var sun: Color3?
  public var sky: Color3?
  public var sunIntensity: Double?
  public var ambientIntensity: Double?

  public init(ambient: Color3? = nil, sun: Color3? = nil, sky: Color3? = nil, sunIntensity: Double? = nil, ambientIntensity: Double? = nil) {
    self.ambient = ambient
    self.sun = sun
    self.sky = sky
    self.sunIntensity = sunIntensity
    self.ambientIntensity = ambientIntensity
  }
}

// ---- queries --------------------------------------------------------------------------------------------

/// ctx.ocean
public protocol OceanQuery: AnyObject {
  func heightAt(_ x: Double, _ z: Double) -> Double
  /// nil when the ocean has no normalAt (the ditched list then holds its last pose)
  func normalAt(_ x: Double, _ z: Double) -> V3?
  func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double)
  func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double)
  func setSearchlight(origin: V3, dir: V3, cosOuter: Double, level: Double)
}

extension OceanQuery {
  public func normalAt(_ x: Double, _ z: Double) -> V3? { nil }
  public func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) {}
  public func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) {}
  public func setSearchlight(origin: V3, dir: V3, cosOuter: Double, level: Double) {}
}

/// ctx.weather
public protocol WeatherQuery: AnyObject {
  /// windAt(x, z, out): surface wind (x east, y = z south), m/s
  func windAt(_ x: Double, _ z: Double) -> V2
  /// weather.state (nil = `{}`)
  var readout: WeatherReadout? { get }
}

/// ctx.world
public protocol WorldQuery: AnyObject {
  /// world.pads (index = PadID.raw)
  var pads: [LandingPad] { get }
  /// The pad with this identity, as it is now (moving decks).
  func pad(_ id: PadID) -> LandingPad?
  /// padAt(x, z): the pad whose deck covers this point
  func padAt(_ x: Double, _ z: Double) -> LandingPad?
  func nearestPad(_ x: Double, _ z: Double) -> LandingPad?
  var obstacles: [FlightObstacle] { get }
  /// deckAt(x, z): the rig's open lower deck (−Infinity elsewhere)
  func deckAt(_ x: Double, _ z: Double) -> Double
  /// world.floaters.items (cable snags), in array order
  var floaters: [FlotsamItem] { get }
  /// world.lighthouse {x, z} (title-screen framing); nil when the mission has none
  var lighthouse: V2? { get }
}

extension WorldQuery {
  public func pad(_ id: PadID) -> LandingPad? { pads.first { $0.id == id } }
  public func padAt(_ x: Double, _ z: Double) -> LandingPad? { nil }
  public func nearestPad(_ x: Double, _ z: Double) -> LandingPad? { nil }
  public var obstacles: [FlightObstacle] { [] }
  public func deckAt(_ x: Double, _ z: Double) -> Double { -.infinity }
  public var floaters: [FlotsamItem] { [] }
  public var lighthouse: V2? { nil }
}

/// ctx.hazards
public protocol HazardQuery: AnyObject {
  /// forceAt(x, z, alt, out): horizontal + vertical air force on the heli (m/s²)
  func forceAt(_ x: Double, _ z: Double, _ alt: Double) -> V3
  /// waveLiftAt(x, z) || 0
  func waveLiftAt(_ x: Double, _ z: Double) -> Double
  var list: [HazardReadout] { get }
  /// hazards.debris.items, kinds in insertion order, each list in order
  var debris: [FlotsamItem] { get }
  /// hazards.imminent (a getter in the web; nil = none)
  var imminent: ImminentHazard? { get }
}

extension HazardQuery {
  public func forceAt(_ x: Double, _ z: Double, _ alt: Double) -> V3 { V3() }
  public func waveLiftAt(_ x: Double, _ z: Double) -> Double { 0 }
  public var list: [HazardReadout] { [] }
  public var debris: [FlotsamItem] { [] }
  public var imminent: ImminentHazard? { nil }
}

/// ctx.survivors
public protocol SurvivorQuery: AnyObject {
  /// survivors.list (touch auto-aim)
  var groups: [SurvivorView] { get }
  func group(_ id: GroupID) -> SurvivorView?
  /// nearestFor(x, z, r): the capturable group nearest the basket within r
  func nearestFor(_ x: Double, _ z: Double, _ r: Double) -> SurvivorView?
  func attachToBasket(_ id: GroupID)
  /// detachFromBasket(s, opts): slip = nil for a plain release (winch reset)
  func detachFromBasket(_ id: GroupID, slip: BasketSlip?)
  func boardOne(_ id: GroupID) -> BoardedPerson?
  /// deckAt(x, z): decks people stand on (barge, ferry, rig lower deck), −Infinity elsewhere
  func deckAt(_ x: Double, _ z: Double) -> Double
}

extension SurvivorQuery {
  public func group(_ id: GroupID) -> SurvivorView? { groups.first { $0.id == id } }
  public func deckAt(_ x: Double, _ z: Double) -> Double { -.infinity }
}

/// ctx.mission
public protocol MissionQuery: AnyObject {
  /// mission.def.area.radius (nil = undefined)
  var areaRadius: Double? { get }
  /// mission.elapsed
  var elapsed: Double { get }
}

/// ctx.fx: cosmetic effects (never feed back into the simulation).
public protocol FxSink: AnyObject {
  func spray(_ x: Double, _ z: Double, _ dir: V2, _ count: Double)
  func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ size: Double)
  func sparks(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ count: Double)
  func splash(_ x: Double, _ y: Double, _ z: Double, _ size: Double)
  /// fx.flare(x, z): a burning flare on the water
  func flare(_ x: Double, _ z: Double)
  /// fx.burst('rocket', at, {color}); false = no burst support (the web then falls back to fx.flare)
  func burstRocket(_ at: V3, color: String) -> Bool
}

extension FxSink {
  public func spray(_ x: Double, _ z: Double, _ dir: V2, _ count: Double) {}
  public func smoke(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ size: Double) {}
  public func sparks(_ x: Double, _ y: Double, _ z: Double, _ color: String, _ count: Double) {}
  public func splash(_ x: Double, _ y: Double, _ z: Double, _ size: Double) {}
  public func flare(_ x: Double, _ z: Double) {}
  public func burstRocket(_ at: V3, color: String) -> Bool { false }
}

/// ctx.settings.get(key) / detail() (GameSettings conforms; tests use a dictionary).
public protocol SettingsQuery: AnyObject {
  func get(_ key: String) -> JSONValue
  func detail() -> Double
}

extension GameSettings: SettingsQuery {}

/// A settings source answering every key with `undefined` (the web's stub settings).
public final class StaticSettings: SettingsQuery {
  public var values: [String: JSONValue]
  public var detailValue: Double

  public init(_ values: [String: JSONValue] = [:], detail: Double = 1) {
    self.values = values
    self.detailValue = detail
  }

  public func get(_ key: String) -> JSONValue { values[key] ?? .null }
  public func detail() -> Double { detailValue }
}

/// ctx.input as the heli reads it (InputState conforms; replays use a scripted source).
public protocol HeliInput: AnyObject {
  func move() -> (x: Double, y: Double)
  func axis(_ name: InputAxis) -> Double
  func down(_ name: InputAction) -> Bool
  func pressed(_ name: InputAction) -> Bool
  func consumeWheel() -> Double
  var lastDevice: InputDevice { get }
  var mouse: MouseState { get }
}

extension InputState: HeliInput {}

/// ctx.timeScale owner (GameLoop).
public protocol TimeScaleControl: AnyObject {
  var timeScale: Double { get set }
}

extension GameLoop: TimeScaleControl {}

// ---- the context ------------------------------------------------------------------------------------------

/// `ctx` for Helicopter and CameraRig.
public final class SimContext {
  public let events: EventBus
  public var settings: SettingsQuery
  public var input: HeliInput?
  public var ocean: OceanQuery?
  public var weather: WeatherQuery?
  public var world: WorldQuery?
  public var hazards: HazardQuery?
  public var survivors: SurvivorQuery?
  public var mission: MissionQuery?
  public var fx: FxSink?
  /// look.cloudAt(x, z) (hull cloud shadow); nil = look without clouds
  public var cloudAt: ((Double, Double) -> Double)?
  /// ctx.camera (shared: the rig places it, the heli reads its distance, the host sets aspect)
  public let camera: PerspectiveCamera
  /// The loop that owns mode / timeScale (nil in tests: `fallbackMode` / `fallbackTimeScale`).
  public weak var loop: GameLoop?
  public var fallbackMode: GameMode = .play
  public var fallbackTimeScale: Double = 1
  /// performance.now() in ms (mouse "moved within 2 s" test). Host: its clock; tests: scripted.
  public var nowMs: () -> Double = { 0 }
  /// Math.random for cosmetic choices (spray angles, smoke side, spark timing); never simulation state.
  public var random: () -> Double
  /// ctx.params.has('autostart')
  public var autostart = false
  /// ctx.photo?.active
  public var photoActive: () -> Bool = { false }
  /// ctx.cameraRig (heli aim: screenToWater); ctx.heli (camera subject)
  // TEMP public weak var cameraRig: CameraRig?
  // TEMP public weak var heli: Helicopter?

  public init(events: EventBus, settings: SettingsQuery = StaticSettings(), camera: PerspectiveCamera = PerspectiveCamera(),
              randomSeed: Double = 20261016) {
    self.events = events
    self.settings = settings
    self.camera = camera
    var rng = Mulberry32(seed: randomSeed)
    self.random = { rng.next() }
  }

  /// ctx.mode
  public var mode: GameMode { loop?.mode ?? fallbackMode }

  /// ctx.timeScale (read by the loop: dt = realDt · timeScale)
  public var timeScale: Double {
    get { loop?.timeScale ?? fallbackTimeScale }
    set {
      if let l = loop { l.timeScale = newValue } else { fallbackTimeScale = newValue }
    }
  }

  /// weather.state || {}
  public var weatherState: WeatherReadout { weather?.readout ?? WeatherReadout() }
}
