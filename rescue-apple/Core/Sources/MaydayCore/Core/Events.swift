// GENERATED ONCE from the web emit sites (rescue/src/**/*.js) and Resources/Data/events.json, then
// maintained by hand: one `GameEvent` case per event name, each carrying a payload struct with the
// JS payload keys as fields (CONTRACT.md "Event catalogue" + "Extensions in use").
//
// Payload conventions (PLAN §2.2 "Идентичность", §2.4):
//   * JS object references become stable IDs: survivor group → GroupID, hazard → HazardID,
//     helipad → PadID (index in world.pads), person record → PersonID;
//   * THREE.Vector2/3 → V2/V3 (copied values, not live references);
//   * keys a site may omit are Optionals (nil = the key was absent / undefined);
//   * record payloads owned by systems that are not ported yet (mission def, report, stats,
//     objective, call) are JSONValue — the same JSON the web passes — until their owning module
//     defines a typed struct; change the field type there.
// EventCatalogTests checks that every name in events.json has exactly one case here.

/// Event names: the canonical strings of the web (`"heli:damage"`).
public enum EventName: String, CaseIterable, Sendable {
  case cameraZoom = "camera:zoom"
  case fxGulls = "fx:gulls"
  case gameMode = "game:mode"
  case gameReady = "game:ready"
  case hazardCrest = "hazard:crest"
  case hazardEnd = "hazard:end"
  case hazardEngulf = "hazard:engulf"
  case hazardHit = "hazard:hit"
  case hazardNearMiss = "hazard:near-miss"
  case hazardPass = "hazard:pass"
  case hazardSpawn = "hazard:spawn"
  case hazardStage = "hazard:stage"
  case hazardWarning = "hazard:warning"
  case heliAutorotation = "heli:autorotation"
  case heliCabinFull = "heli:cabin-full"
  case heliCapture = "heli:capture"
  case heliCrash = "heli:crash"
  case heliDamage = "heli:damage"
  case heliFailing = "heli:failing"
  case heliFlare = "heli:flare"
  case heliFlareThrow = "heli:flare-throw"
  case heliFuelLow = "heli:fuel-low"
  case heliLand = "heli:land"
  case heliLoudspeaker = "heli:loudspeaker"
  case heliOverheat = "heli:overheat"
  case heliPickup = "heli:pickup"
  case heliRaftDrop = "heli:raft-drop"
  case heliRaftThrow = "heli:raft-throw"
  case heliRefuel = "heli:refuel"
  case heliResupply = "heli:resupply"
  case heliSearchlight = "heli:searchlight"
  case heliSlip = "heli:slip"
  case heliSnag = "heli:snag"
  case heliTakeoff = "heli:takeoff"
  case heliTension = "heli:tension"
  case heliTouchdown = "heli:touchdown"
  case heliUnload = "heli:unload"
  case heliUnloadPerson = "heli:unload-person"
  case heliWaterStrike = "heli:water-strike"
  case heliWinch = "heli:winch"
  case heliWinchDenied = "heli:winch-denied"
  case missionCall = "mission:call"
  case missionChapter = "mission:chapter"
  case missionCheckpoint = "mission:checkpoint"
  case missionComplete = "mission:complete"
  case missionFailed = "mission:failed"
  case missionHint = "mission:hint"
  case missionLocked = "mission:locked"
  case missionLogbook = "mission:logbook"
  case missionObjective = "mission:objective"
  case missionRestored = "mission:restored"
  case missionSetup = "mission:setup"
  case missionStart = "mission:start"
  case missionTask = "mission:task"
  case photoSaved = "photo:saved"
  case photoToggle = "photo:toggle"
  case postQualityHint = "post:quality-hint"
  case postThermal = "post:thermal"
  case radioLine = "radio:line"
  case scoreAdd = "score:add"
  case survivorBoarded = "survivor:boarded"
  case survivorBottle = "survivor:bottle"
  case survivorCapsize = "survivor:capsize"
  case survivorCreak = "survivor:creak"
  case survivorCritical = "survivor:critical"
  case survivorDownwash = "survivor:downwash"
  case survivorJump = "survivor:jump"
  case survivorLost = "survivor:lost"
  case survivorPet = "survivor:pet"
  case survivorRaftBoarded = "survivor:raft-boarded"
  case survivorRescued = "survivor:rescued"
  case survivorShout = "survivor:shout"
  case survivorSignal = "survivor:signal"
  case survivorSinking = "survivor:sinking"
  case survivorSpawn = "survivor:spawn"
  case survivorSpotted = "survivor:spotted"
  case survivorTip = "survivor:tip"
  case uiBack = "ui:back"
  case uiClick = "ui:click"
  case uiEndless = "ui:endless"
  case uiHover = "ui:hover"
  case uiLaunch = "ui:launch"
  case uiMenu = "ui:menu"
  case uiNext = "ui:next"
  case uiPause = "ui:pause"
  case uiResume = "ui:resume"
  case uiRetry = "ui:retry"
  case uiRetryCheckpoint = "ui:retry-checkpoint"
  case uiSelectMission = "ui:select-mission"
  case uiSettings = "ui:settings"
  case uiStamp = "ui:stamp"
  case uiStart = "ui:start"
  case uiStatic = "ui:static"
  case uiType = "ui:type"
  case weatherCharge = "weather:charge"
  case weatherGust = "weather:gust"
  case weatherLightning = "weather:lightning"
  case weatherPreset = "weather:preset"
  case weatherPressure = "weather:pressure"
  case worldFoghorn = "world:foghorn"
  case worldHorn = "world:horn"
  case worldSlam = "world:slam"
}

/// A payload struct of one event (GameEvent.HeliDamage, …).
public protocol EventPayload {
  /// The event this payload belongs to.
  static var eventName: EventName { get }
  /// The payload wrapped as a GameEvent.
  var event: GameEvent { get }
}

/// Every game event with its typed payload.
public enum GameEvent {
  case cameraZoom(CameraZoom)
  case fxGulls(FxGulls)
  case gameMode(GameMode)
  case gameReady(GameReady)
  case hazardCrest(HazardCrest)
  case hazardEnd(HazardEnd)
  case hazardEngulf(HazardEngulf)
  case hazardHit(HazardHit)
  case hazardNearMiss(HazardNearMiss)
  case hazardPass(HazardPass)
  case hazardSpawn(HazardSpawn)
  case hazardStage(HazardStage)
  case hazardWarning(HazardWarning)
  case heliAutorotation(HeliAutorotation)
  case heliCabinFull(HeliCabinFull)
  case heliCapture(HeliCapture)
  case heliCrash(HeliCrash)
  case heliDamage(HeliDamage)
  case heliFailing(HeliFailing)
  case heliFlare(HeliFlare)
  case heliFlareThrow(HeliFlareThrow)
  case heliFuelLow(HeliFuelLow)
  case heliLand(HeliLand)
  case heliLoudspeaker(HeliLoudspeaker)
  case heliOverheat(HeliOverheat)
  case heliPickup(HeliPickup)
  case heliRaftDrop(HeliRaftDrop)
  case heliRaftThrow(HeliRaftThrow)
  case heliRefuel(HeliRefuel)
  case heliResupply(HeliResupply)
  case heliSearchlight(HeliSearchlight)
  case heliSlip(HeliSlip)
  case heliSnag(HeliSnag)
  case heliTakeoff(HeliTakeoff)
  case heliTension(HeliTension)
  case heliTouchdown(HeliTouchdown)
  case heliUnload(HeliUnload)
  case heliUnloadPerson(HeliUnloadPerson)
  case heliWaterStrike(HeliWaterStrike)
  case heliWinch(HeliWinch)
  case heliWinchDenied(HeliWinchDenied)
  case missionCall(MissionCall)
  case missionChapter(MissionChapter)
  case missionCheckpoint(MissionCheckpoint)
  case missionComplete(MissionComplete)
  case missionFailed(MissionFailed)
  case missionHint(MissionHint)
  case missionLocked(MissionLocked)
  case missionLogbook(MissionLogbook)
  case missionObjective(MissionObjective)
  case missionRestored(MissionRestored)
  case missionSetup(MissionSetup)
  case missionStart(MissionStart)
  case missionTask(MissionTask)
  case photoSaved(PhotoSaved)
  case photoToggle(PhotoToggle)
  case postQualityHint(PostQualityHint)
  case postThermal(PostThermal)
  case radioLine(RadioLine)
  case scoreAdd(ScoreAdd)
  case survivorBoarded(SurvivorBoarded)
  case survivorBottle(SurvivorBottle)
  case survivorCapsize(SurvivorCapsize)
  case survivorCreak(SurvivorCreak)
  case survivorCritical(SurvivorCritical)
  case survivorDownwash(SurvivorDownwash)
  case survivorJump(SurvivorJump)
  case survivorLost(SurvivorLost)
  case survivorPet(SurvivorPet)
  case survivorRaftBoarded(SurvivorRaftBoarded)
  case survivorRescued(SurvivorRescued)
  case survivorShout(SurvivorShout)
  case survivorSignal(SurvivorSignal)
  case survivorSinking(SurvivorSinking)
  case survivorSpawn(SurvivorSpawn)
  case survivorSpotted(SurvivorSpotted)
  case survivorTip(SurvivorTip)
  case uiBack(UiBack)
  case uiClick(UiClick)
  case uiEndless(UiEndless)
  case uiHover(UiHover)
  case uiLaunch(UiLaunch)
  case uiMenu(UiMenu)
  case uiNext(UiNext)
  case uiPause(UiPause)
  case uiResume(UiResume)
  case uiRetry(UiRetry)
  case uiRetryCheckpoint(UiRetryCheckpoint)
  case uiSelectMission(UiSelectMission)
  case uiSettings(UiSettings)
  case uiStamp(UiStamp)
  case uiStart(UiStart)
  case uiStatic(UiStatic)
  case uiType(UiType)
  case weatherCharge(WeatherCharge)
  case weatherGust(WeatherGust)
  case weatherLightning(WeatherLightning)
  case weatherPreset(WeatherPreset)
  case weatherPressure(WeatherPressure)
  case worldFoghorn(WorldFoghorn)
  case worldHorn(WorldHorn)
  case worldSlam(WorldSlam)

  /// The event's name.
  public var name: EventName { type(of: payload).eventName }

  /// The payload as an existential (EventBus's typed `on(P.self)` casts it).
  public var payload: any EventPayload {
    switch self {
    case .cameraZoom(let p): return p
    case .fxGulls(let p): return p
    case .gameMode(let p): return p
    case .gameReady(let p): return p
    case .hazardCrest(let p): return p
    case .hazardEnd(let p): return p
    case .hazardEngulf(let p): return p
    case .hazardHit(let p): return p
    case .hazardNearMiss(let p): return p
    case .hazardPass(let p): return p
    case .hazardSpawn(let p): return p
    case .hazardStage(let p): return p
    case .hazardWarning(let p): return p
    case .heliAutorotation(let p): return p
    case .heliCabinFull(let p): return p
    case .heliCapture(let p): return p
    case .heliCrash(let p): return p
    case .heliDamage(let p): return p
    case .heliFailing(let p): return p
    case .heliFlare(let p): return p
    case .heliFlareThrow(let p): return p
    case .heliFuelLow(let p): return p
    case .heliLand(let p): return p
    case .heliLoudspeaker(let p): return p
    case .heliOverheat(let p): return p
    case .heliPickup(let p): return p
    case .heliRaftDrop(let p): return p
    case .heliRaftThrow(let p): return p
    case .heliRefuel(let p): return p
    case .heliResupply(let p): return p
    case .heliSearchlight(let p): return p
    case .heliSlip(let p): return p
    case .heliSnag(let p): return p
    case .heliTakeoff(let p): return p
    case .heliTension(let p): return p
    case .heliTouchdown(let p): return p
    case .heliUnload(let p): return p
    case .heliUnloadPerson(let p): return p
    case .heliWaterStrike(let p): return p
    case .heliWinch(let p): return p
    case .heliWinchDenied(let p): return p
    case .missionCall(let p): return p
    case .missionChapter(let p): return p
    case .missionCheckpoint(let p): return p
    case .missionComplete(let p): return p
    case .missionFailed(let p): return p
    case .missionHint(let p): return p
    case .missionLocked(let p): return p
    case .missionLogbook(let p): return p
    case .missionObjective(let p): return p
    case .missionRestored(let p): return p
    case .missionSetup(let p): return p
    case .missionStart(let p): return p
    case .missionTask(let p): return p
    case .photoSaved(let p): return p
    case .photoToggle(let p): return p
    case .postQualityHint(let p): return p
    case .postThermal(let p): return p
    case .radioLine(let p): return p
    case .scoreAdd(let p): return p
    case .survivorBoarded(let p): return p
    case .survivorBottle(let p): return p
    case .survivorCapsize(let p): return p
    case .survivorCreak(let p): return p
    case .survivorCritical(let p): return p
    case .survivorDownwash(let p): return p
    case .survivorJump(let p): return p
    case .survivorLost(let p): return p
    case .survivorPet(let p): return p
    case .survivorRaftBoarded(let p): return p
    case .survivorRescued(let p): return p
    case .survivorShout(let p): return p
    case .survivorSignal(let p): return p
    case .survivorSinking(let p): return p
    case .survivorSpawn(let p): return p
    case .survivorSpotted(let p): return p
    case .survivorTip(let p): return p
    case .uiBack(let p): return p
    case .uiClick(let p): return p
    case .uiEndless(let p): return p
    case .uiHover(let p): return p
    case .uiLaunch(let p): return p
    case .uiMenu(let p): return p
    case .uiNext(let p): return p
    case .uiPause(let p): return p
    case .uiResume(let p): return p
    case .uiRetry(let p): return p
    case .uiRetryCheckpoint(let p): return p
    case .uiSelectMission(let p): return p
    case .uiSettings(let p): return p
    case .uiStamp(let p): return p
    case .uiStart(let p): return p
    case .uiStatic(let p): return p
    case .uiType(let p): return p
    case .weatherCharge(let p): return p
    case .weatherGust(let p): return p
    case .weatherLightning(let p): return p
    case .weatherPreset(let p): return p
    case .weatherPressure(let p): return p
    case .worldFoghorn(let p): return p
    case .worldHorn(let p): return p
    case .worldSlam(let p): return p
    }
  }
}

// ---- payloads ----------------------------------------------------------------------------------------
extension GameEvent {
  /// `camera:zoom` — camera.js: zoom step changed
  public struct CameraZoom: EventPayload {
    public static let eventName = EventName.cameraZoom
    public var zoom: Double
    public var index: Int

    public init(zoom: Double, index: Int) {
      self.zoom = zoom
      self.index = index
    }

    public var event: GameEvent { .cameraZoom(self) }
  }

  /// `fx:gulls` — fx/life.js: the hint gull flock left
  public struct FxGulls: EventPayload {
    public static let eventName = EventName.fxGulls
    public var state: String // 'leave'

    public init(state: String) {
      self.state = state
    }

    public var event: GameEvent { .fxGulls(self) }
  }

  /// `game:mode` — main.js setMode
  public struct GameMode: EventPayload {
    public static let eventName = EventName.gameMode
    public var from: MaydayCore.GameMode // module-qualified: inside GameEvent, `GameMode` is this struct
    public var to: MaydayCore.GameMode

    public init(from: MaydayCore.GameMode, to: MaydayCore.GameMode) {
      self.from = from
      self.to = to
    }

    public var event: GameEvent { .gameMode(self) }
  }

  /// `game:ready` — main.js after every system init()
  public struct GameReady: EventPayload {
    public static let eventName = EventName.gameReady

    public init() {}

    public var event: GameEvent { .gameReady(self) }
  }

  /// `hazard:crest` — hazards/rogue.js: a rogue crest passes a survivor group
  public struct HazardCrest: EventPayload {
    public static let eventName = EventName.hazardCrest
    public var hazard: HazardID
    public var type: String
    public var survivor: GroupID
    public var x: Double
    public var z: Double
    public var height: Double

    public init(hazard: HazardID, type: String, survivor: GroupID, x: Double, z: Double, height: Double) {
      self.hazard = hazard
      self.type = type
      self.survivor = survivor
      self.x = x
      self.z = z
      self.height = height
    }

    public var event: GameEvent { .hazardCrest(self) }
  }

  /// `hazard:end` — hazards.js
  public struct HazardEnd: EventPayload {
    public static let eventName = EventName.hazardEnd
    public var hazard: HazardID
    public var type: String

    public init(hazard: HazardID, type: String) {
      self.hazard = hazard
      self.type = type
    }

    public var event: GameEvent { .hazardEnd(self) }
  }

  /// `hazard:engulf` — hazards/whirlpool.js: a group reaches the core
  public struct HazardEngulf: EventPayload {
    public static let eventName = EventName.hazardEngulf
    public var hazard: HazardID
    public var type: String
    public var survivor: GroupID

    public init(hazard: HazardID, type: String, survivor: GroupID) {
      self.hazard = hazard
      self.type = type
      self.survivor = survivor
    }

    public var event: GameEvent { .hazardEngulf(self) }
  }

  /// `hazard:hit` — hazards.js hitHeli: {...info, type, damage, source}
  public struct HazardHit: EventPayload {
    public static let eventName = EventName.hazardHit
    public var type: String
    public var damage: Double
    public var source: String
    public var hazard: HazardID?
    public var x: Double?
    public var z: Double?
    public var distance: Double?
    public var overlap: Double?
    public var core: Bool?

    public init(type: String, damage: Double, source: String, hazard: HazardID? = nil, x: Double? = nil, z: Double? = nil, distance: Double? = nil, overlap: Double? = nil, core: Bool? = nil) {
      self.type = type
      self.damage = damage
      self.source = source
      self.hazard = hazard
      self.x = x
      self.z = z
      self.distance = distance
      self.overlap = overlap
      self.core = core
    }

    public var event: GameEvent { .hazardHit(self) }
  }

  /// `hazard:near-miss` — hazards.js / hazards/charges.js (style bonus)
  public struct HazardNearMiss: EventPayload {
    public static let eventName = EventName.hazardNearMiss
    public var type: String
    public var distance: Double
    public var hazard: HazardID?
    public var x: Double?
    public var z: Double?
    public var text: String?

    public init(type: String, distance: Double, hazard: HazardID? = nil, x: Double? = nil, z: Double? = nil, text: String? = nil) {
      self.type = type
      self.distance = distance
      self.hazard = hazard
      self.x = x
      self.z = z
      self.text = text
    }

    public var event: GameEvent { .hazardNearMiss(self) }
  }

  /// `hazard:pass` — hazards/rogue.js: the heli cleared a crest
  public struct HazardPass: EventPayload {
    public static let eventName = EventName.hazardPass
    public var hazard: HazardID
    public var type: String
    public var clearance: Double

    public init(hazard: HazardID, type: String, clearance: Double) {
      self.hazard = hazard
      self.type = type
      self.clearance = clearance
    }

    public var event: GameEvent { .hazardPass(self) }
  }

  /// `hazard:spawn` — hazards.js
  public struct HazardSpawn: EventPayload {
    public static let eventName = EventName.hazardSpawn
    public var hazard: HazardID
    public var type: String

    public init(hazard: HazardID, type: String) {
      self.hazard = hazard
      self.type = type
    }

    public var event: GameEvent { .hazardSpawn(self) }
  }

  /// `hazard:stage` — hazards.js: spout stage change
  public struct HazardStage: EventPayload {
    public static let eventName = EventName.hazardStage
    public var hazard: HazardID
    public var type: String
    public var stage: Int
    public var name: String

    public init(hazard: HazardID, type: String, stage: Int, name: String) {
      self.hazard = hazard
      self.type = type
      self.stage = stage
      self.name = name
    }

    public var event: GameEvent { .hazardStage(self) }
  }

  /// `hazard:warning` — hazards.js warn(p): telegraphs; hazards fills position/id/bearing/distance/from from the hazard
  public struct HazardWarning: EventPayload {
    public static let eventName = EventName.hazardWarning
    public var type: String
    public var text: String
    public var hazard: HazardID?
    public var id: Int?
    public var position: V3?
    public var eta: Double?
    public var stage: String?
    public var level: String? // 'caution' | 'danger'
    public var detail: String?
    public var distance: Double?
    public var bearing: Double?
    public var from: String?
    public var edge: Bool?
    public var scripted: Bool?
    public var name: String?
    public var height: Double?
    public var dir: V2?
    public var radius: Double?

    public init(type: String, text: String, hazard: HazardID? = nil, id: Int? = nil, position: V3? = nil, eta: Double? = nil, stage: String? = nil, level: String? = nil, detail: String? = nil, distance: Double? = nil, bearing: Double? = nil, from: String? = nil, edge: Bool? = nil, scripted: Bool? = nil, name: String? = nil, height: Double? = nil, dir: V2? = nil, radius: Double? = nil) {
      self.type = type
      self.text = text
      self.hazard = hazard
      self.id = id
      self.position = position
      self.eta = eta
      self.stage = stage
      self.level = level
      self.detail = detail
      self.distance = distance
      self.bearing = bearing
      self.from = from
      self.edge = edge
      self.scripted = scripted
      self.name = name
      self.height = height
      self.dir = dir
      self.radius = radius
    }

    public var event: GameEvent { .hazardWarning(self) }
  }

  /// `heli:autorotation` — heli/ops.js: engine out, autorotation begins
  public struct HeliAutorotation: EventPayload {
    public static let eventName = EventName.heliAutorotation

    public init() {}

    public var event: GameEvent { .heliAutorotation(self) }
  }

  /// `heli:cabin-full` — heli/winch.js
  public struct HeliCabinFull: EventPayload {
    public static let eventName = EventName.heliCabinFull
    public var survivor: GroupID
    public var seats: Int

    public init(survivor: GroupID, seats: Int) {
      self.survivor = survivor
      self.seats = seats
    }

    public var event: GameEvent { .heliCabinFull(self) }
  }

  /// `heli:capture` — heli/winch.js: the basket closes on a person
  public struct HeliCapture: EventPayload {
    public static let eventName = EventName.heliCapture
    public var survivor: GroupID

    public init(survivor: GroupID) {
      self.survivor = survivor
    }

    public var event: GameEvent { .heliCapture(self) }
  }

  /// `heli:crash` — heli/ops.js
  public struct HeliCrash: EventPayload {
    public static let eventName = EventName.heliCrash
    public var reason: String
    public var x: Double
    public var z: Double
    public var onDeck: Bool
    public var pad: PadID?

    public init(reason: String, x: Double, z: Double, onDeck: Bool, pad: PadID? = nil) {
      self.reason = reason
      self.x = x
      self.z = z
      self.onDeck = onDeck
      self.pad = pad
    }

    public var event: GameEvent { .heliCrash(self) }
  }

  /// `heli:damage` — heli/ops.js
  public struct HeliDamage: EventPayload {
    public static let eventName = EventName.heliDamage
    public var amount: Double
    public var source: String
    public var hull: Double

    public init(amount: Double, source: String, hull: Double) {
      self.amount = amount
      self.source = source
      self.hull = hull
    }

    public var event: GameEvent { .heliDamage(self) }
  }

  /// `heli:failing` — heli/ops.js
  public struct HeliFailing: EventPayload {
    public static let eventName = EventName.heliFailing
    public var reason: String

    public init(reason: String) {
      self.reason = reason
    }

    public var event: GameEvent { .heliFailing(self) }
  }

  /// `heli:flare` — heli/ops.js: a thrown flare lands
  public struct HeliFlare: EventPayload {
    public static let eventName = EventName.heliFlare
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .heliFlare(self) }
  }

  /// `heli:flare-throw` — heli/ops.js
  public struct HeliFlareThrow: EventPayload {
    public static let eventName = EventName.heliFlareThrow
    public var x: Double
    public var z: Double
    public var eta: Double

    public init(x: Double, z: Double, eta: Double) {
      self.x = x
      self.z = z
      self.eta = eta
    }

    public var event: GameEvent { .heliFlareThrow(self) }
  }

  /// `heli:fuel-low` — heli/ops.js
  public struct HeliFuelLow: EventPayload {
    public static let eventName = EventName.heliFuelLow
    public var fuel: Double
    public var level: String // 'low' | 'critical' | 'empty' | 'bingo'
    public var pad: PadID? // bingo: the pad to make for

    public init(fuel: Double, level: String, pad: PadID? = nil) {
      self.fuel = fuel
      self.level = level
      self.pad = pad
    }

    public var event: GameEvent { .heliFuelLow(self) }
  }

  /// `heli:land` — heli/ops.js
  public struct HeliLand: EventPayload {
    public static let eventName = EventName.heliLand
    public var pad: PadID?
    public var autorotation: Bool
    public var vy: Double

    public init(pad: PadID? = nil, autorotation: Bool, vy: Double) {
      self.pad = pad
      self.autorotation = autorotation
      self.vy = vy
    }

    public var event: GameEvent { .heliLand(self) }
  }

  /// `heli:loudspeaker` — heli/ops.js
  public struct HeliLoudspeaker: EventPayload {
    public static let eventName = EventName.heliLoudspeaker
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .heliLoudspeaker(self) }
  }

  /// `heli:overheat` — heli/ops.js
  public struct HeliOverheat: EventPayload {
    public static let eventName = EventName.heliOverheat

    public init() {}

    public var event: GameEvent { .heliOverheat(self) }
  }

  /// `heli:pickup` — heli/winch.js: a person reaches the cabin
  public struct HeliPickup: EventPayload {
    public static let eventName = EventName.heliPickup
    public var survivor: GroupID?
    public var person: PersonID

    public init(survivor: GroupID? = nil, person: PersonID) {
      self.survivor = survivor
      self.person = person
    }

    public var event: GameEvent { .heliPickup(self) }
  }

  /// `heli:raft-drop` — heli/ops.js: a dropped raft lands
  public struct HeliRaftDrop: EventPayload {
    public static let eventName = EventName.heliRaftDrop
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .heliRaftDrop(self) }
  }

  /// `heli:raft-throw` — heli/ops.js
  public struct HeliRaftThrow: EventPayload {
    public static let eventName = EventName.heliRaftThrow
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .heliRaftThrow(self) }
  }

  /// `heli:refuel` — heli/ops.js
  public struct HeliRefuel: EventPayload {
    public static let eventName = EventName.heliRefuel
    public var pad: PadID?
    public var state: String // 'start' | 'done' | 'stop'
    public var fuel: Double

    public init(pad: PadID? = nil, state: String, fuel: Double) {
      self.pad = pad
      self.state = state
      self.fuel = fuel
    }

    public var event: GameEvent { .heliRefuel(self) }
  }

  /// `heli:resupply` — heli/ops.js
  public struct HeliResupply: EventPayload {
    public static let eventName = EventName.heliResupply
    public var pad: PadID?

    public init(pad: PadID? = nil) {
      self.pad = pad
    }

    public var event: GameEvent { .heliResupply(self) }
  }

  /// `heli:searchlight` — heli.js
  public struct HeliSearchlight: EventPayload {
    public static let eventName = EventName.heliSearchlight
    public var on: Bool

    public init(on: Bool) {
      self.on = on
    }

    public var event: GameEvent { .heliSearchlight(self) }
  }

  /// `heli:slip` — heli/winch.js
  public struct HeliSlip: EventPayload {
    public static let eventName = EventName.heliSlip
    public var survivor: GroupID?
    public var reason: String

    public init(survivor: GroupID? = nil, reason: String) {
      self.survivor = survivor
      self.reason = reason
    }

    public var event: GameEvent { .heliSlip(self) }
  }

  /// `heli:snag` — heli/winch.js
  public struct HeliSnag: EventPayload {
    public static let eventName = EventName.heliSnag
    public var x: Double
    public var z: Double
    public var reason: String // 'wave' | 'debris'
    public var kind: String?

    public init(x: Double, z: Double, reason: String, kind: String? = nil) {
      self.x = x
      self.z = z
      self.reason = reason
      self.kind = kind
    }

    public var event: GameEvent { .heliSnag(self) }
  }

  /// `heli:takeoff` — heli/ops.js
  public struct HeliTakeoff: EventPayload {
    public static let eventName = EventName.heliTakeoff
    public var pad: PadID?

    public init(pad: PadID? = nil) {
      self.pad = pad
    }

    public var event: GameEvent { .heliTakeoff(self) }
  }

  /// `heli:tension` — heli/winch.js
  public struct HeliTension: EventPayload {
    public static let eventName = EventName.heliTension
    public var level: Double
    public var phase: String // 'warn' | 'release' | 'clear'

    public init(level: Double, phase: String) {
      self.level = level
      self.phase = phase
    }

    public var event: GameEvent { .heliTension(self) }
  }

  /// `heli:touchdown` — heli.js onTouch
  public struct HeliTouchdown: EventPayload {
    public static let eventName = EventName.heliTouchdown
    public var pad: PadID?
    public var vy: Double

    public init(pad: PadID? = nil, vy: Double) {
      self.pad = pad
      self.vy = vy
    }

    public var event: GameEvent { .heliTouchdown(self) }
  }

  /// `heli:unload` — heli/ops.js: delivery finished at a pad
  public struct HeliUnload: EventPayload {
    public static let eventName = EventName.heliUnload
    public var pad: PadID?
    public var count: Int
    public var people: [PersonID]

    public init(pad: PadID? = nil, count: Int, people: [PersonID]) {
      self.pad = pad
      self.count = count
      self.people = people
    }

    public var event: GameEvent { .heliUnload(self) }
  }

  /// `heli:unload-person` — heli/ops.js
  public struct HeliUnloadPerson: EventPayload {
    public static let eventName = EventName.heliUnloadPerson
    public var pad: PadID?
    public var person: PersonID
    public var left: Int

    public init(pad: PadID? = nil, person: PersonID, left: Int) {
      self.pad = pad
      self.person = person
      self.left = left
    }

    public var event: GameEvent { .heliUnloadPerson(self) }
  }

  /// `heli:water-strike` — heli.js
  public struct HeliWaterStrike: EventPayload {
    public static let eventName = EventName.heliWaterStrike
    public var x: Double
    public var z: Double
    public var strength: Double

    public init(x: Double, z: Double, strength: Double) {
      self.x = x
      self.z = z
      self.strength = strength
    }

    public var event: GameEvent { .heliWaterStrike(self) }
  }

  /// `heli:winch` — heli/winch.js _setState
  public struct HeliWinch: EventPayload {
    public static let eventName = EventName.heliWinch
    public var state: String // 'stowed' | 'lowering' | 'down' | 'raising'
    public var load: GroupID?

    public init(state: String, load: GroupID? = nil) {
      self.state = state
      self.load = load
    }

    public var event: GameEvent { .heliWinch(self) }
  }

  /// `heli:winch-denied` — heli/winch.js
  public struct HeliWinchDenied: EventPayload {
    public static let eventName = EventName.heliWinchDenied
    public var reason: String // 'high' | 'fast' | 'landed'

    public init(reason: String) {
      self.reason = reason
    }

    public var event: GameEvent { .heliWinchDenied(self) }
  }

  /// `mission:call` — mission/endless.js («Смена» call)
  public struct MissionCall: EventPayload {
    public static let eventName = EventName.missionCall
    public var call: JSONValue // call record (typed when mission/endless is ported)

    public init(call: JSONValue) {
      self.call = call
    }

    public var event: GameEvent { .missionCall(self) }
  }

  /// `mission:chapter` — mission.js
  public struct MissionChapter: EventPayload {
    public static let eventName = EventName.missionChapter
    public var n: Int
    public var text: String
    public var title: String

    public init(n: Int, text: String, title: String) {
      self.n = n
      self.text = text
      self.title = title
    }

    public var event: GameEvent { .missionChapter(self) }
  }

  /// `mission:checkpoint` — mission.js
  public struct MissionCheckpoint: EventPayload {
    public static let eventName = EventName.missionCheckpoint
    public var t: Double
    public var pad: Int
    public var padName: String

    public init(t: Double, pad: Int, padName: String) {
      self.t = t
      self.pad = pad
      self.padName = padName
    }

    public var event: GameEvent { .missionCheckpoint(self) }
  }

  /// `mission:complete` — mission.js _finish
  public struct MissionComplete: EventPayload {
    public static let eventName = EventName.missionComplete
    public var stats: JSONValue
    public var score: Double
    public var medals: JSONValue
    public var report: JSONValue
    public var reason: String?
    public var cinematic: Double

    public init(stats: JSONValue, score: Double, medals: JSONValue, report: JSONValue, reason: String? = nil, cinematic: Double) {
      self.stats = stats
      self.score = score
      self.medals = medals
      self.report = report
      self.reason = reason
      self.cinematic = cinematic
    }

    public var event: GameEvent { .missionComplete(self) }
  }

  /// `mission:failed` — mission.js _finish
  public struct MissionFailed: EventPayload {
    public static let eventName = EventName.missionFailed
    public var stats: JSONValue
    public var score: Double
    public var medals: JSONValue
    public var report: JSONValue
    public var reason: String?
    public var cinematic: Double

    public init(stats: JSONValue, score: Double, medals: JSONValue, report: JSONValue, reason: String? = nil, cinematic: Double) {
      self.stats = stats
      self.score = score
      self.medals = medals
      self.report = report
      self.reason = reason
      self.cinematic = cinematic
    }

    public var event: GameEvent { .missionFailed(self) }
  }

  /// `mission:hint` — mission/onboarding.js (hide = {key, text: null, show: false, learned})
  public struct MissionHint: EventPayload {
    public static let eventName = EventName.missionHint
    public var key: String
    public var text: String?
    public var label: String?
    public var keys: [String]?
    public var anchor: String?
    public var pulse: Bool?
    public var priority: Double?
    public var show: Bool
    public var learned: Bool?

    public init(key: String, text: String? = nil, label: String? = nil, keys: [String]? = nil, anchor: String? = nil, pulse: Bool? = nil, priority: Double? = nil, show: Bool, learned: Bool? = nil) {
      self.key = key
      self.text = text
      self.label = label
      self.keys = keys
      self.anchor = anchor
      self.pulse = pulse
      self.priority = priority
      self.show = show
      self.learned = learned
    }

    public var event: GameEvent { .missionHint(self) }
  }

  /// `mission:locked` — mission.js
  public struct MissionLocked: EventPayload {
    public static let eventName = EventName.missionLocked
    public var index: Int
    public var text: String

    public init(index: Int, text: String) {
      self.index = index
      self.text = text
    }

    public var event: GameEvent { .missionLocked(self) }
  }

  /// `mission:logbook` — mission.js
  public struct MissionLogbook: EventPayload {
    public static let eventName = EventName.missionLogbook
    public var report: JSONValue

    public init(report: JSONValue) {
      self.report = report
    }

    public var event: GameEvent { .missionLogbook(self) }
  }

  /// `mission:objective` — mission/objectives.js
  public struct MissionObjective: EventPayload {
    public static let eventName = EventName.missionObjective
    public var objective: JSONValue // objective record {id, text, kind, progress, target, done, failed}

    public init(objective: JSONValue) {
      self.objective = objective
    }

    public var event: GameEvent { .missionObjective(self) }
  }

  /// `mission:restored` — mission.js after a checkpoint retry
  public struct MissionRestored: EventPayload {
    public static let eventName = EventName.missionRestored
    public var t: Double
    public var padName: String

    public init(t: Double, padName: String) {
      self.t = t
      self.padName = padName
    }

    public var event: GameEvent { .missionRestored(self) }
  }

  /// `mission:setup` — mission.js: every system resets from def (listener order = system order)
  public struct MissionSetup: EventPayload {
    public static let eventName = EventName.missionSetup
    public var def: JSONValue // prepared mission definition (typed when mission/prepare is ported)

    public init(def: JSONValue) {
      self.def = def
    }

    public var event: GameEvent { .missionSetup(self) }
  }

  /// `mission:start` — mission.js launch
  public struct MissionStart: EventPayload {
    public static let eventName = EventName.missionStart
    public var def: JSONValue
    public var checkpoint: JSONValue?

    public init(def: JSONValue, checkpoint: JSONValue? = nil) {
      self.def = def
      self.checkpoint = checkpoint
    }

    public var event: GameEvent { .missionStart(self) }
  }

  /// `mission:task` — mission/objectives.js
  public struct MissionTask: EventPayload {
    public static let eventName = EventName.missionTask
    public var text: String?

    public init(text: String? = nil) {
      self.text = text
    }

    public var event: GameEvent { .missionTask(self) }
  }

  /// `photo:saved` — post/photo.js
  public struct PhotoSaved: EventPayload {
    public static let eventName = EventName.photoSaved
    public var name: String
    public var size: Double
    public var w: Int
    public var h: Int

    public init(name: String, size: Double, w: Int, h: Int) {
      self.name = name
      self.size = size
      self.w = w
      self.h = h
    }

    public var event: GameEvent { .photoSaved(self) }
  }

  /// `photo:toggle` — post/photo.js
  public struct PhotoToggle: EventPayload {
    public static let eventName = EventName.photoToggle
    public var active: Bool

    public init(active: Bool) {
      self.active = active
    }

    public var event: GameEvent { .photoToggle(self) }
  }

  /// `post:quality-hint` — post.js
  public struct PostQualityHint: EventPayload {
    public static let eventName = EventName.postQualityHint
    public var quality: String
    public var suggest: String
    public var frameMs: Double

    public init(quality: String, suggest: String, frameMs: Double) {
      self.quality = quality
      self.suggest = suggest
      self.frameMs = frameMs
    }

    public var event: GameEvent { .postQualityHint(self) }
  }

  /// `post:thermal` — post/thermal.js
  public struct PostThermal: EventPayload {
    public static let eventName = EventName.postThermal
    public var active: Bool

    public init(active: Bool) {
      self.active = active
    }

    public var event: GameEvent { .postThermal(self) }
  }

  /// `radio:line` — radio.js
  public struct RadioLine: EventPayload {
    public static let eventName = EventName.radioLine
    public var speaker: String
    public var name: String
    public var channel: String
    public var text: String
    public var duration: Double
    public var priority: Double
    public var id: String?

    public init(speaker: String, name: String, channel: String, text: String, duration: Double, priority: Double, id: String? = nil) {
      self.speaker = speaker
      self.name = name
      self.channel = channel
      self.text = text
      self.duration = duration
      self.priority = priority
      self.id = id
    }

    public var event: GameEvent { .radioLine(self) }
  }

  /// `score:add` — mission/scoring.js, mission/ledger.js, survivors/bottle.js
  public struct ScoreAdd: EventPayload {
    public static let eventName = EventName.scoreAdd
    public var points: Double
    public var reason: String
    public var position: V3?
    public var kind: String
    public var style: String?
    public var chain: Double?
    public var count: Int?

    public init(points: Double, reason: String, position: V3? = nil, kind: String, style: String? = nil, chain: Double? = nil, count: Int? = nil) {
      self.points = points
      self.reason = reason
      self.position = position
      self.kind = kind
      self.style = style
      self.chain = chain
      self.count = count
    }

    public var event: GameEvent { .scoreAdd(self) }
  }

  /// `survivor:boarded` — survivors.js boardOne
  public struct SurvivorBoarded: EventPayload {
    public static let eventName = EventName.survivorBoarded
    public var s: GroupID
    public var person: PersonID

    public init(s: GroupID, person: PersonID) {
      self.s = s
      self.person = person
    }

    public var event: GameEvent { .survivorBoarded(self) }
  }

  /// `survivor:bottle` — survivors/bottle.js
  public struct SurvivorBottle: EventPayload {
    public static let eventName = EventName.survivorBottle
    public var title: String
    public var text: String
    public var x: Double
    public var z: Double
    public var by: String?

    public init(title: String, text: String, x: Double, z: Double, by: String? = nil) {
      self.title = title
      self.text = text
      self.x = x
      self.z = z
      self.by = by
    }

    public var event: GameEvent { .survivorBottle(self) }
  }

  /// `survivor:capsize` — survivors.js
  public struct SurvivorCapsize: EventPayload {
    public static let eventName = EventName.survivorCapsize
    public var s: GroupID
    public var cause: String

    public init(s: GroupID, cause: String) {
      self.s = s
      self.cause = cause
    }

    public var event: GameEvent { .survivorCapsize(self) }
  }

  /// `survivor:creak` — survivors.js
  public struct SurvivorCreak: EventPayload {
    public static let eventName = EventName.survivorCreak
    public var s: GroupID
    public var x: Double
    public var z: Double

    public init(s: GroupID, x: Double, z: Double) {
      self.s = s
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .survivorCreak(self) }
  }

  /// `survivor:critical` — survivors.js
  public struct SurvivorCritical: EventPayload {
    public static let eventName = EventName.survivorCritical
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorCritical(self) }
  }

  /// `survivor:downwash` — survivors.js
  public struct SurvivorDownwash: EventPayload {
    public static let eventName = EventName.survivorDownwash
    public var s: GroupID
    public var level: String // 'push' | 'capsize'

    public init(s: GroupID, level: String) {
      self.s = s
      self.level = level
    }

    public var event: GameEvent { .survivorDownwash(self) }
  }

  /// `survivor:jump` — survivors.js
  public struct SurvivorJump: EventPayload {
    public static let eventName = EventName.survivorJump
    public var s: GroupID
    public var from: String
    public var parent: GroupID?

    public init(s: GroupID, from: String, parent: GroupID? = nil) {
      self.s = s
      self.from = from
      self.parent = parent
    }

    public var event: GameEvent { .survivorJump(self) }
  }

  /// `survivor:lost` — survivors.js
  public struct SurvivorLost: EventPayload {
    public static let eventName = EventName.survivorLost
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorLost(self) }
  }

  /// `survivor:pet` — survivors.js
  public struct SurvivorPet: EventPayload {
    public static let eventName = EventName.survivorPet
    public var s: GroupID
    public var pet: String
    public var action: String
    public var distance: Double?

    public init(s: GroupID, pet: String, action: String, distance: Double? = nil) {
      self.s = s
      self.pet = pet
      self.action = action
      self.distance = distance
    }

    public var event: GameEvent { .survivorPet(self) }
  }

  /// `survivor:raft-boarded` — survivors.js
  public struct SurvivorRaftBoarded: EventPayload {
    public static let eventName = EventName.survivorRaftBoarded
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorRaftBoarded(self) }
  }

  /// `survivor:rescued` — survivors.js: the group is fully lifted
  public struct SurvivorRescued: EventPayload {
    public static let eventName = EventName.survivorRescued
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorRescued(self) }
  }

  /// `survivor:shout` — survivors.js, survivors/signals.js
  public struct SurvivorShout: EventPayload {
    public static let eventName = EventName.survivorShout
    public var s: GroupID
    public var reason: String // 'near' | 'loudspeaker'

    public init(s: GroupID, reason: String) {
      self.s = s
      self.reason = reason
    }

    public var event: GameEvent { .survivorShout(self) }
  }

  /// `survivor:signal` — survivors.js
  public struct SurvivorSignal: EventPayload {
    public static let eventName = EventName.survivorSignal
    public var s: GroupID
    public var kind: String
    public var x: Double
    public var z: Double
    public var error: Double
    public var arc: Double?

    public init(s: GroupID, kind: String, x: Double, z: Double, error: Double, arc: Double? = nil) {
      self.s = s
      self.kind = kind
      self.x = x
      self.z = z
      self.error = error
      self.arc = arc
    }

    public var event: GameEvent { .survivorSignal(self) }
  }

  /// `survivor:sinking` — survivors.js
  public struct SurvivorSinking: EventPayload {
    public static let eventName = EventName.survivorSinking
    public var s: GroupID
    public var phase: String // 'warn' | 'sunk'
    public var cause: String?

    public init(s: GroupID, phase: String, cause: String? = nil) {
      self.s = s
      self.phase = phase
      self.cause = cause
    }

    public var event: GameEvent { .survivorSinking(self) }
  }

  /// `survivor:spawn` — survivors.js
  public struct SurvivorSpawn: EventPayload {
    public static let eventName = EventName.survivorSpawn
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorSpawn(self) }
  }

  /// `survivor:spotted` — survivors.js
  public struct SurvivorSpotted: EventPayload {
    public static let eventName = EventName.survivorSpotted
    public var s: GroupID
    public var by: String

    public init(s: GroupID, by: String) {
      self.s = s
      self.by = by
    }

    public var event: GameEvent { .survivorSpotted(self) }
  }

  /// `survivor:tip` — survivors.js
  public struct SurvivorTip: EventPayload {
    public static let eventName = EventName.survivorTip
    public var s: GroupID

    public init(s: GroupID) {
      self.s = s
    }

    public var event: GameEvent { .survivorTip(self) }
  }

  /// `ui:back` — ui/common/nav.js, ui/screens/operations.js
  public struct UiBack: EventPayload {
    public static let eventName = EventName.uiBack
    public var menu: String?
    public var locked: Bool?

    public init(menu: String? = nil, locked: Bool? = nil) {
      self.menu = menu
      self.locked = locked
    }

    public var event: GameEvent { .uiBack(self) }
  }

  /// `ui:click` — ui/*
  public struct UiClick: EventPayload {
    public static let eventName = EventName.uiClick
    public var menu: String
    public var index: Int?

    public init(menu: String, index: Int? = nil) {
      self.menu = menu
      self.index = index
    }

    public var event: GameEvent { .uiClick(self) }
  }

  /// `ui:endless` — ui/screens/title.js
  public struct UiEndless: EventPayload {
    public static let eventName = EventName.uiEndless

    public init() {}

    public var event: GameEvent { .uiEndless(self) }
  }

  /// `ui:hover` — ui/common/nav.js, ui/screens/settings.js
  public struct UiHover: EventPayload {
    public static let eventName = EventName.uiHover
    public var menu: String
    public var index: Int?
    public var adjust: Int?

    public init(menu: String, index: Int? = nil, adjust: Int? = nil) {
      self.menu = menu
      self.index = index
      self.adjust = adjust
    }

    public var event: GameEvent { .uiHover(self) }
  }

  /// `ui:launch` — ui/screens/briefing.js
  public struct UiLaunch: EventPayload {
    public static let eventName = EventName.uiLaunch

    public init() {}

    public var event: GameEvent { .uiLaunch(self) }
  }

  /// `ui:menu` — ui/screens/briefing.js, debrief.js
  public struct UiMenu: EventPayload {
    public static let eventName = EventName.uiMenu

    public init() {}

    public var event: GameEvent { .uiMenu(self) }
  }

  /// `ui:next` — ui/screens/debrief.js
  public struct UiNext: EventPayload {
    public static let eventName = EventName.uiNext

    public init() {}

    public var event: GameEvent { .uiNext(self) }
  }

  /// `ui:pause` — hud.js, ui/flight/touch.js
  public struct UiPause: EventPayload {
    public static let eventName = EventName.uiPause

    public init() {}

    public var event: GameEvent { .uiPause(self) }
  }

  /// `ui:resume` — ui/screens/pause.js, hud.js
  public struct UiResume: EventPayload {
    public static let eventName = EventName.uiResume

    public init() {}

    public var event: GameEvent { .uiResume(self) }
  }

  /// `ui:retry` — ui/screens/pause.js, debrief.js
  public struct UiRetry: EventPayload {
    public static let eventName = EventName.uiRetry

    public init() {}

    public var event: GameEvent { .uiRetry(self) }
  }

  /// `ui:retry-checkpoint` — ui/screens/pause.js, debrief.js
  public struct UiRetryCheckpoint: EventPayload {
    public static let eventName = EventName.uiRetryCheckpoint

    public init() {}

    public var event: GameEvent { .uiRetryCheckpoint(self) }
  }

  /// `ui:select-mission` — ui/screens/operations.js
  public struct UiSelectMission: EventPayload {
    public static let eventName = EventName.uiSelectMission
    public var index: Int

    public init(index: Int) {
      self.index = index
    }

    public var event: GameEvent { .uiSelectMission(self) }
  }

  /// `ui:settings` — CONTRACT (no emitter in the web build)
  public struct UiSettings: EventPayload {
    public static let eventName = EventName.uiSettings

    public init() {}

    public var event: GameEvent { .uiSettings(self) }
  }

  /// `ui:stamp` — ui/screens/debrief.js
  public struct UiStamp: EventPayload {
    public static let eventName = EventName.uiStamp
    public var success: Bool?
    public var soft: Bool?

    public init(success: Bool? = nil, soft: Bool? = nil) {
      self.success = success
      self.soft = soft
    }

    public var event: GameEvent { .uiStamp(self) }
  }

  /// `ui:start` — ui/screens/title.js _start
  public struct UiStart: EventPayload {
    public static let eventName = EventName.uiStart
    public var index: Int?

    public init(index: Int? = nil) {
      self.index = index
    }

    public var event: GameEvent { .uiStart(self) }
  }

  /// `ui:static` — hud.js
  public struct UiStatic: EventPayload {
    public static let eventName = EventName.uiStatic

    public init() {}

    public var event: GameEvent { .uiStatic(self) }
  }

  /// `ui:type` — ui/screens/briefing.js, debrief.js (typewriter)
  public struct UiType: EventPayload {
    public static let eventName = EventName.uiType
    public var ch: String
    public var i: Int?
    public var voice: String

    public init(ch: String, i: Int? = nil, voice: String) {
      self.ch = ch
      self.i = i
      self.voice = voice
    }

    public var event: GameEvent { .uiType(self) }
  }

  /// `weather:charge` — weather/lightning.js: sea strike telegraph
  public struct WeatherCharge: EventPayload {
    public static let eventName = EventName.weatherCharge
    public var x: Double
    public var z: Double
    public var radius: Double
    public var eta: Double
    public var target: String // 'sea' | 'heli'
    public var heli: Bool

    public init(x: Double, z: Double, radius: Double, eta: Double, target: String, heli: Bool) {
      self.x = x
      self.z = z
      self.radius = radius
      self.eta = eta
      self.target = target
      self.heli = heli
    }

    public var event: GameEvent { .weatherCharge(self) }
  }

  /// `weather:gust` — weather.js: gust front telegraph
  public struct WeatherGust: EventPayload {
    public static let eventName = EventName.weatherGust
    public var dir: V2
    public var strength: Double
    public var eta: Double
    public var x: Double
    public var z: Double
    public var harmless: Bool

    public init(dir: V2, strength: Double, eta: Double, x: Double, z: Double, harmless: Bool) {
      self.dir = dir
      self.strength = strength
      self.eta = eta
      self.x = x
      self.z = z
      self.harmless = harmless
    }

    public var event: GameEvent { .weatherGust(self) }
  }

  /// `weather:lightning` — weather/lightning.js
  public struct WeatherLightning: EventPayload {
    public static let eventName = EventName.weatherLightning
    public var x: Double
    public var z: Double
    public var distance: Double
    public var strength: Double
    public var cloudOnly: Bool

    public init(x: Double, z: Double, distance: Double, strength: Double, cloudOnly: Bool) {
      self.x = x
      self.z = z
      self.distance = distance
      self.strength = strength
      self.cloudOnly = cloudOnly
    }

    public var event: GameEvent { .weatherLightning(self) }
  }

  /// `weather:preset` — weather.js setPreset
  public struct WeatherPreset: EventPayload {
    public static let eventName = EventName.weatherPreset
    public var from: String
    public var to: String
    public var over: Double
    public var worse: Bool
    public var label: String
    public var windFrom: Double
    public var gust: Double

    public init(from: String, to: String, over: Double, worse: Bool, label: String, windFrom: Double, gust: Double) {
      self.from = from
      self.to = to
      self.over = over
      self.worse = worse
      self.label = label
      self.windFrom = windFrom
      self.gust = gust
    }

    public var event: GameEvent { .weatherPreset(self) }
  }

  /// `weather:pressure` — weather.js
  public struct WeatherPressure: EventPayload {
    public static let eventName = EventName.weatherPressure
    public var pressure: Double
    public var trend: Double // -1 | 0 | 1

    public init(pressure: Double, trend: Double) {
      self.pressure = pressure
      self.trend = trend
    }

    public var event: GameEvent { .weatherPressure(self) }
  }

  /// `world:foghorn` — world/lighthouse.js
  public struct WorldFoghorn: EventPayload {
    public static let eventName = EventName.worldFoghorn
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
      self.x = x
      self.z = z
    }

    public var event: GameEvent { .worldFoghorn(self) }
  }

  /// `world:horn` — world/ship.js
  public struct WorldHorn: EventPayload {
    public static let eventName = EventName.worldHorn
    public var x: Double
    public var z: Double
    public var distance: Double
    public var name: String

    public init(x: Double, z: Double, distance: Double, name: String) {
      self.x = x
      self.z = z
      self.distance = distance
      self.name = name
    }

    public var event: GameEvent { .worldHorn(self) }
  }

  /// `world:slam` — world/ship.js: bow slam (the web also passes the ship object; only x/z/strength are read)
  public struct WorldSlam: EventPayload {
    public static let eventName = EventName.worldSlam
    public var x: Double
    public var z: Double
    public var strength: Double
    public var ship: String? // ship name

    public init(x: Double, z: Double, strength: Double, ship: String? = nil) {
      self.x = x
      self.z = z
      self.strength = strength
      self.ship = ship
    }

    public var event: GameEvent { .worldSlam(self) }
  }
}
