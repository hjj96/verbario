// systems/world.js World — places and props (DESIGN §2.11, §3.9, §2.7.2–2.7.3, catalogue #15, #31, #43–47).
//
// Rebuilt from def.world on `mission:setup`:
//   pads    lighthouse «Скалистый» (12 m, fuel 10 %/s, repair 4 %/s, resupply); the rescue ship «Арктур»
//           and the rig «Северная-7» come in M5 through `placeFactories`
//   props   a scenery lighthouse, rocks (terrain landmasses + surf), aground-boat ledges, floating props
//           (debris mixes, containers, buoys with real light rhythms, ducks); scenery boats (M5)
// Per frame: the shared environment (env), the lamp / emissive channels (rhythms, day / night, reduceFlashes),
// the places, the floaters, wake streaks, the terrain fill / swell, the spare deck light, the 8 shoals
// nearest the camera focus for the ocean's surf.
//
// Contract API: pads, obstacles, padAt / deckAt / nearestPad (Heli/SimContext.swift WorldQuery), plus
// places, lighthouse, env, channels, events `world:foghorn`, plus port conveniences over the same data
// (groundHeight, obstacles(at:)). The render state the world animates — channels, shared material uniforms
// (`shared`), beam / flood uniforms, prop (`Lighthouse.glows`) and terrain (`terrainUniforms`) light spills,
// the two world lights, lamps, collars, rigging, floater banks, terrain meshes, boulders, vegetation — is read
// by MaydayRender's WorldRenderer from the properties below; Core sends nothing to the GPU.
//
// Inputs the host sets before update (like OceanSim / WeatherSim): `camera`, `heliPosition`, `time`;
// the systems `ocean`, `weather`, `hazards` are weak references. Settings: `settings.get('quality' |
// 'reduceFlashes')`, `detail()`; call `settingsChanged(key)` from the settings listener (or `observe`).
// Tests/Vectors/world/setup_first_<q>.json, run_first.json, run_mix.json.

/// world.pads[i]
public struct WorldPad: Equatable, Sendable {
  public var id: PadID
  public var name: String
  /// 'lighthouse' | 'ship' | 'rig' | 'coast' | …
  public var type: String
  /// = place.padPosition (live for ships)
  public var position: V3
  public var radius: Double
  /// HEIGHT[type] ?? padPosition.y
  public var height: Double
  public var tilt: Double = 0
  public var pitch: Double = 0
  public var roll: Double = 0
  public var up = V3(0, 1, 0)
  /// a zero vector for fixed pads (the web passes `new Vector3()`, which is truthy)
  public var velocity = V3()
  public var heading: Double
  public var refuel = true
  public var services: PadServiceSpec
  /// rig: lee turbulence wedge
  public var lee: Bool
  /// rig only: DESIGN §3.9 lee wedge (150 m downwind, +4 m/s noise), flare centre, lower deck
  public var leeLength: Double?
  public var leeNoise: Double?
  public var flare: V3?
  public var lowerDeck: LowerDeck?
  /// index into world.places
  public var place: Int
}

/// The beam materials' uniforms (materials.js createBeamMaterial): lighthouse beams and deck floods.
public struct BeamUniforms: Equatable, Sendable {
  public var uDensity: Double = 0.03
  public var uIntensity: Double = 0
  public var uPen: Double = 0.5
  public var uFall: Double = 1.4
  /// the beam colour (CSS hex; linear via THREE.Color)
  public var color: String

  public init(color: String) { self.color = color }
}

/// materials.js createShared(): the uniforms every world material references.
public struct WorldSharedUniforms: Equatable, Sendable {
  public var uRim = Color3(0, 0, 0)
  public var uCloudK: Double = 0
  public var uFogNear: Double = 200
  public var uFogFar: Double = 900
  /// 0…1 fog / rain scatter: halos grow, beams thicken
  public var uScatter: Double = 0
  public var uFoamCol = Color3(style: "#F1F4EE")
  /// bulb gain, halo gain, min px
  public var uLampK = V3(1, 0.35, 1)
  public var uNightK: Double = 0
}

/// terrainMaterial.js terrainUniforms (shared by every terrain material).
public struct TerrainUniforms: Equatable, Sendable {
  public var uSwell: Double = 0.5
  /// flat-light sky fill (from the weather palette)
  public var uTFill = Color3(0, 0, 0)
  /// light spills on the rock (world position, radius; colour × intensity)
  public var glows: [WorldGlow]

  init(count: Int) { glows = Array(repeating: WorldGlow(), count: count) }
}

/// The world's two lights (CONTRACT budget, created once, intensity only): the lighthouse SpotLight
/// (#FFF4DC, distance 950, angle 0.085, penumbra 0.65, decay 1.35) and the deck PointLight (#FFE6B0,
/// distance 60, decay 2).
public struct WorldLights: Equatable, Sendable {
  /// three.js SpotLight starts at Object3D.DEFAULT_UP (0, 1, 0)
  public var spotPosition = V3(0, 1, 0)
  public var spotTarget = V3()
  public var spotIntensity: Double = 0
  public var pointPosition = V3(0, -50, 0)
  public var pointIntensity: Double = 0
  public static let spotColor = "#FFF4DC", spotDistance = 950.0, spotAngle = 0.085, spotPenumbra = 0.65, spotDecay = 1.35
  public static let pointColor = "#FFE6B0", pointDistance = 60.0, pointDecay = 2.0
}

public final class World: GameSystem {
  public typealias PlaceFactory = (_ world: World, _ def: JSONValue, _ index: Int) -> WorldPlace?

  public let tables: WorldTables
  public let events: EventBus
  public var settings: SettingsQuery
  /// ctx.params (launch flags; 'ducks' forces the duck spill)
  public var params: Set<String> = []
  /// Pad types the world builds a place for; 'lighthouse' is built in. Ship / rig register here (M5).
  /// Unknown types fall back to a lighthouse-style fixed pad with services ('coast'), as in the web;
  /// 'ship' / 'rig' without a factory are skipped (logged) until they are ported.
  public var placeFactories: [String: PlaceFactory] = [:]
  public var log: ((String) -> Void)?

  // ---- inputs ---------------------------------------------------------------------------------------
  public weak var ocean: WorldOcean?
  public weak var weather: WorldWeather?
  public weak var hazards: WorldHazards?
  public var camera = WorldCameraInput(position: V3(0, 220, 60), direction: V3(0, -0.9647638212377322, -0.2631174057921088))
  /// ctx.heli?.position (nil = no heli: the spot aims at the focus)
  public var heliPosition: V3?
  public var time = GameTime()
  /// ctx.mission?.def at init()
  public var missionDef: JSONValue?

  // ---- state ----------------------------------------------------------------------------------------
  public private(set) var pads: [WorldPad] = []
  public private(set) var obstacles: [WorldObstacle] = []
  public private(set) var places: [WorldPlace] = []
  /// the first lighthouse place (pad or scenery)
  public private(set) var lighthouse: Lighthouse?
  public private(set) var rockField: RockField?
  public let lamps = LampRegistry()
  public let rigging = RiggingList()
  public let collars = CollarList()
  public let floaterField: Floaters
  /// lamp / emissive channels (materials.js uChan: one Float32Array)
  public private(set) var channels: [Float]
  public private(set) var shared = WorldSharedUniforms()
  public internal(set) var beam = BeamUniforms(color: "#FFF4DC")
  public internal(set) var flood = BeamUniforms(color: "#FFE6B0")
  public private(set) var terrainUniforms: TerrainUniforms
  public internal(set) var lights = WorldLights()
  public private(set) var env = WorldEnv()
  /// def.current (kept across missions until the next setup assigns it, like the web)
  public private(set) var current: V2?
  public private(set) var quality: String?
  public private(set) var haloBase: Double?
  /// every shoal of the mission and the ≤ 8 sent to the ocean last
  public private(set) var shoals: [ShoalCircle] = []
  public private(set) var shoalSelection: [ShoalCircle] = []
  public private(set) var shoalT: Double = 0
  var shoalKey: Double?
  /// the pad being unloaded (blue offload lights) and the remaining blink time
  public private(set) var unloadPad: PadID?
  public private(set) var unloadT: Double = 0
  var spotOwner: ObjectIdentifier?
  var pointOwner: ObjectIdentifier?
  /// terrain meshes in the scene (the island and the rocks) and their key (changes per setup)
  public private(set) var terrainKey = ""
  var setups = 0
  private var subscriptions: [EventSubscription] = []
  private var settingsSub: SettingsSubscription?
  /// ctx.world for the heli / camera (SimContext.world)
  public private(set) lazy var query = WorldQueryAdapter(world: self)

  public init(tables: WorldTables, events: EventBus, settings: SettingsQuery) {
    self.tables = tables
    self.events = events
    self.settings = settings
    floaterField = Floaters(tables: tables)
    channels = [Float](repeating: 0, count: tables.ch.count)
    terrainUniforms = TerrainUniforms(count: tables.terrainGlows)
    flood.uFall = 0.9
    flood.uPen = 0.7
    subscriptions.append(events.on(.missionSetup) { [unowned self] e in
      if case .missionSetup(let p) = e { self.setup(p.def) }
    })
    subscriptions.append(events.on(.heliLand) { [unowned self] e in
      if case .heliLand(let p) = e { self.unloadPad = p.pad }
    })
    subscriptions.append(events.on(.heliTakeoff) { [unowned self] _ in
      self.unloadPad = nil
      self.unloadT = 0
    })
    subscriptions.append(events.on(.heliUnloadPerson) { [unowned self] e in
      if case .heliUnloadPerson(let p) = e {
        self.unloadPad = p.pad ?? self.unloadPad
        self.unloadT = 1.6
      }
    })
    subscriptions.append(events.on(.heliUnload) { [unowned self] e in
      if case .heliUnload(let p) = e {
        self.unloadPad = p.pad ?? self.unloadPad
        self.unloadT = JS.max(self.unloadT, 1.2)
      }
    })
  }

  deinit {
    for s in subscriptions { s.off() }
    settingsSub?.off()
  }

  /// ctx.settings.onChange((key) => …) on the real settings.
  public func observe(_ s: GameSettings) {
    settingsSub?.off()
    settingsSub = s.onChange { [unowned self] key, _ in self.settingsChanged(key) }
  }

  /// The settings listener: a quality change re-applies counts and lamp halos.
  public func settingsChanged(_ key: String) {
    if key == "quality" { applyQuality() }
  }

  /// init(): the environment, then the mission's def when it was set up before us.
  public func start() {
    refreshEnv(0)
    if places.isEmpty, let d = missionDef, d.jsTruthy { setup(d) }
  }

  var settingsQuality: String? { settings.get("quality").string }

  // ---- contract API ---------------------------------------------------------------------------------

  /// padAt(x, z): the pad whose deck radius covers this point (nearest of the overlapping ones).
  public func padAt(_ x: Double, _ z: Double) -> WorldPad? {
    var best: WorldPad? = nil, bd = Double.infinity
    for p in pads {
      let d = JS.hypot(p.position.x - x, p.position.z - z)
      if d < p.radius && d < bd {
        bd = d
        best = p
      }
    }
    return best
  }

  /// deckAt(x, z): the height of a walkable structure deck that is not a pad (the rig's lower deck), or −∞.
  public func deckAt(_ x: Double, _ z: Double) -> Double {
    var y = -Double.infinity
    for pl in places {
      guard let d = pl.lowerDeck else { continue }
      if x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1 && d.y > y { y = d.y }
    }
    return y
  }

  public func nearestPad(_ x: Double, _ z: Double) -> WorldPad? {
    var best: WorldPad? = nil, bd = Double.infinity
    for p in pads {
      let d = JS.hypot(p.position.x - x, p.position.z - z)
      if d < bd {
        bd = d
        best = p
      }
    }
    return best
  }

  /// The ground under (x, z): the highest terrain sample (island or rock) or −∞ off the land (heli /
  /// survivors / mission placement queries; the web reads the samplers directly).
  public func groundHeight(_ x: Double, _ z: Double) -> Double {
    var h = -Double.infinity
    if let lh = lighthouse {
      let S = lh.land.sampler, lx = x - lh.x, lz = z - lh.z
      if S.inside(lx, lz) { h = JS.max(h, S.heightAt(lx, lz)) }
    }
    for rk in rockField?.rocks ?? [] where rk.land.sampler.inside(x, z) { h = JS.max(h, rk.land.sampler.heightAt(x, z)) }
    return h
  }

  /// The obstacles whose cylinder contains (x, z) (optionally only those reaching above `y`).
  public func obstacles(at x: Double, _ z: Double, above y: Double = -.infinity) -> [WorldObstacle] {
    obstacles.filter { JS.hypot($0.x - x, $0.z - z) < $0.radius && $0.top > y }
  }

  /// env.windAt(x, z): the weather's wind field, or the mean wind without a weather.
  public func windAt(_ x: Double, _ z: Double) -> V2 { weather?.windAt(x, z) ?? env.wind }

  /// uChan[i] (a Float32Array: out-of-range reads are undefined → NaN, writes are dropped)
  @inline(__always) func channel(_ i: Int) -> Double { i >= 0 && i < channels.count ? Double(channels[i]) : .nan }
  @inline(__always) func setChannel(_ i: Int, _ v: Double) { if i >= 0 && i < channels.count { channels[i] = Float(v) } }

  /// setTerrainGlow(i, x, y, z, radius, color, intensity)
  func setTerrainGlow(_ i: Int, _ x: Double, _ y: Double, _ z: Double, _ radius: Double, _ color: Color3, _ intensity: Double) {
    if i >= terrainUniforms.glows.count { return }
    var c = color
    c.multiplyScalar(intensity)
    terrainUniforms.glows[i] = WorldGlow(position: V4(x, y, z, JS.max(0.1, radius)), color: c)
  }

  // ---- setup ----------------------------------------------------------------------------------------

  func clear() {
    for pl in places { pl.dispose() }
    places.removeAll()
    pads = []
    obstacles = []
    lighthouse = nil
    lamps.clear()
    floaterField.clear()
    rockField = nil
    shoals.removeAll()
    unloadPad = nil
    unloadT = 0
  }

  /// _setup(def): rebuild everything from def.world.
  public func setup(_ def: JSONValue) {
    if !def.jsTruthy { return }
    clear()
    refreshEnv(0)
    let world = def["world"].jsTruthy ? def["world"] : .object(JSONObject())
    let props = world["props"].jsTruthy ? world["props"] : .object(JSONObject())
    let padDefs = world["pads"].array ?? []
    let CH = tables.ch

    for (i, pd) in padDefs.enumerated() {
      if !pd.jsTruthy { continue }
      let type = pd["type"].string.flatMap { $0.isEmpty ? nil : $0 } ?? "ship"
      var place: WorldPlace? = nil
      if type == "lighthouse" {
        place = makeLighthouse(pd)
      } else if let f = placeFactories[type] {
        place = f(self, pd, i)
      } else if type == "ship" || type == "rig" {
        log?("[world] place type '\(type)' is not ported yet (M5): pad \(i) skipped")
        continue
      }
      // 'coast' and unknown types: a fixed pad with services
      let pl = place ?? makeLighthouse(pd)
      places.append(pl)
      if let lh = pl as? Lighthouse, lighthouse == nil { lighthouse = lh }
      pl.setUnloadChannel(CH.UNLOAD0 + Swift.min(i, 2))
      let motion = pl.deckMotion
      var pad = WorldPad(id: PadID(i), name: pd["name"].string.flatMap { $0.isEmpty ? nil : $0 } ?? (pl.name.isEmpty ? "Площадка" : pl.name),
                         type: type, position: pl.padPosition, radius: pl.padRadius, height: tables.height[type] ?? pl.padPosition.y,
                         heading: motion?.heading ?? JSNumber.or(pd["heading"].double, 0), services: tables.servicesFor(type),
                         lee: type == "rig", place: places.count - 1)
      if let m = motion {
        pad.up = m.up
        pad.velocity = m.velocity
      }
      if type == "rig" {
        pad.leeLength = 150 // DESIGN §3.9: lee wedge 150 m downwind, +4 m/s noise
        pad.leeNoise = 4
        pad.lowerDeck = pl.lowerDeck
      }
      pads.append(pad)
      obstacles.append(contentsOf: pl.obstacles)
      if let s = pl.shoals { shoals.append(contentsOf: s) }
    }

    // a scenery lighthouse requested by props without a matching pad
    let plh = props["lighthouse"]
    if plh.jsTruthy && lighthouse == nil {
      let lh = Lighthouse(world: self, x: JSNumber.or(plh["x"].double, 0), z: JSNumber.or(plh["z"].double, 0), name: "Скалистый")
      places.append(lh)
      lighthouse = lh
      obstacles.append(contentsOf: lh.obstacles)
      shoals.append(contentsOf: lh.shoals ?? [])
    }
    // props.rig (a scenery rig): M5
    if props["rig"].object != nil && placeFactories["rig"] == nil { log?("[world] props.rig is not ported yet (M5): skipped") }

    // rocks (fog pinnacles, reefs): one landmass per rock; a boat aground gets a low drying ledge under
    // its bow (heading convention: forward = (sin h, −cos h))
    var rocks = (props["rocks"].array ?? []).map(rockSpec)
    for b in props["boats"].array ?? [] where b["aground"].jsTruthy {
      let h = JSNumber.or(b["heading"].double, 0)
      let bx = b["x"].double ?? .nan, bz = b["z"].double ?? .nan
      rocks.append(RockSpec(x: bx + JS.sin(h) * 12, z: bz - JS.cos(h) * 12, radius: 12, height: 2.2, name: b["name"].jsTruthy ? "камни" : "риф"))
    }
    buildRocks(rocks, seed: JSNumber.or(def["seed"].double, 1))
    // scenery boats: M5
    if let boats = props["boats"].array, !boats.isEmpty { log?("[world] props.boats (\(boats.count)) are not ported yet (M5): skipped") }

    // floating props
    floaterField.setup(props: props, seed: JSNumber.or(def["seed"].double, 1), detail: settings.detail(), ducksParam: params.contains("ducks"),
                       lamps: lamps, ocean: ocean)
    let cur = def["current"]
    current = cur.jsTruthy ? V2(JSNumber.or(cur["x"].double, 0), JSNumber.or(cur["z"].double, 0)) : nil
    applyQuality()
    // the ocean bakes its coast map from the terrain now in the scene (ocean.js _syncCoast in setShoals)
    setups += 1
    publishTerrain()
    shoalT = 0
    updateShoals(force: true)
  }

  func makeLighthouse(_ pd: JSONValue) -> Lighthouse {
    Lighthouse(world: self, x: JSNumber.or(pd["x"].double, 0), z: JSNumber.or(pd["z"].double, 0), name: pd["name"].string)
  }

  func rockSpec(_ v: JSONValue) -> RockSpec {
    RockSpec(x: v["x"].double ?? .nan, z: v["z"].double ?? .nan, radius: v["radius"].double, height: v["height"].double, name: v["name"].string)
  }

  /// _buildRocks(list, seed): one granite landmass + boulders per rock; obstacles keep the fitted columns.
  func buildRocks(_ list: [RockSpec], seed: Double) {
    if list.isEmpty { return }
    let rf = RockField(tables: tables, list: list, seed: seed, quality: settingsQuality ?? "")
    rockField = rf
    obstacles.append(contentsOf: rf.obstacles)
    shoals.append(contentsOf: rf.shoals)
  }

  /// Every terrain mesh in the scene with its world offset (the renderer draws them; the coast bakes from them).
  public var terrainMeshes: [PlacedTerrain] {
    var out = [PlacedTerrain]()
    for pl in places { out.append(contentsOf: pl.terrain) }
    for rk in rockField?.rocks ?? [] { out.append(PlacedTerrain(mesh: rk.land.mesh, offset: V3())) }
    return out
  }

  /// The world-space vertices of every terrain mesh (positions + the place offset, three's applyMatrix4
  /// of a translation), handed to ocean.applyTerrain with a key that changes per setup.
  public func terrainVertices() -> [V3] {
    var out = [V3]()
    for t in terrainMeshes {
      var m = Mat4()
      m.makeTranslation(t.offset.x, t.offset.y, t.offset.z)
      let p = t.mesh.positions
      out.reserveCapacity(out.count + p.count / 3)
      for i in stride(from: 0, to: p.count, by: 3) {
        var v = V3(Double(p[i]), Double(p[i + 1]), Double(p[i + 2]))
        v.applyMatrix4(m)
        out.append(v)
      }
    }
    return out
  }

  func publishTerrain() {
    let meshes = terrainMeshes
    terrainKey = meshes.isEmpty ? "" : "world-\(setups)-\(meshes.count)"
    ocean?.applyTerrain(key: terrainKey, vertices: meshes.isEmpty ? [] : terrainVertices())
  }

  /// _applyQuality(): lamp halos (no bloom on low: lamps carry their own halos), boulder / vegetation counts.
  public func applyQuality() {
    let q = settingsQuality
    haloBase = q == "low" ? 0.5 : 0.28
    shared.uLampK = V3(1, haloBase ?? 0.28, 1)
    quality = q
    for pl in places { pl.setQuality(q ?? "") }
    rockField?.setQuality(q ?? "", tables)
  }

  /// _updateShoals(force): keep the 8 shoals nearest the camera focus in the ocean's surf uniforms.
  func updateShoals(force: Bool = false) {
    guard let oc = ocean else { return }
    let f = env.focus
    let d = shoals.map { JS.hypot($0.x - f.x, $0.z - f.y) - $0.radius }
    // Array.prototype.sort is stable: equal distances keep their order
    var order = Array(shoals.indices)
    order.sort { d[$0] != d[$1] ? d[$0] < d[$1] : $0 < $1 }
    var sel = order.map { shoals[$0] }
    if sel.count > 8 { sel.removeLast(sel.count - 8) }
    var key = Double(sel.count)
    for (i, s) in sel.enumerated() { key += (s.x * 31.7 + s.z * 17.3) * Double(i + 1) }
    if force || shoalKey.map({ $0 != key }) ?? true {
      shoalKey = key
      shoalSelection = sel
      oc.applyShoals(sel)
    }
  }

  // ---- per frame ------------------------------------------------------------------------------------

  /// _refreshEnv(dt): the shared environment and the shared material uniforms.
  func refreshEnv(_ dt: Double) {
    let st = weather?.worldState ?? WorldWeatherState()
    let pal = st.palette ?? WorldPaletteReadout()
    let C = MathUtil.self
    env.dt = dt
    env.t = time.t
    env.night = C.clamp(st.night ?? 0, 0, 1)
    env.rain = C.clamp(st.rain ?? 0, 0, 1)
    env.intensity = C.clamp(st.intensity ?? 0, 0, 1)
    env.visibility = st.visibility ?? 20000
    // real fog only (the storm presets carry a 0.45–0.55 haze in state.fog — that is not «туман»)
    env.haze = C.clamp(st.fog ?? 0, 0, 1)
    env.fogK = C.clamp(JS.max(C.smoothstep(0.6, 0.95, env.haze), C.smoothstep(650, 250, env.visibility)), 0, 1)
    env.Hs = pal.seaHs ?? st.waveHeight ?? 0.5
    env.flash = st.flash ?? 0
    env.reduceFlashes = settings.get("reduceFlashes").jsTruthy
    if let wd = st.windDir { env.windDir = wd }
    env.wind = env.windDir * (st.windSpeed ?? 0)
    if let c = current { env.current = c } else { env.current = V2(0, 0) }
    env.lightsOn = C.smoothstep(0.2, 0.65, JS.max(JS.max(env.night, env.fogK * 0.85), JS.max(env.rain * 0.55, env.intensity * 0.5)))
    // camera + the focus point under the screen centre (same formula as the fog patch)
    env.camPos = camera.position
    let fwd = camera.direction
    let k = env.camPos.y / JS.max(-fwd.y, 0.25)
    env.focus = V2(env.camPos.x + fwd.x * k, env.camPos.z + fwd.z * k)
    env.heliPos = heliPosition ?? V3(env.focus.x, 40, env.focus.y)

    // day rim (DESIGN §2.7.3); at night a faint moonlit rim keeps silhouettes off pure black
    if let a = pal.ambient {
      shared.uRim = a
      shared.uRim.multiplyScalar(1 - env.night)
    }
    if let s = pal.sun {
      var c = s
      c.multiplyScalar(0.55 * env.night)
      shared.uRim.add(c)
    }
    shared.uCloudK = C.clamp(pal.shadowIntensity ?? 0.5, 0, 1) * (1 - env.night)
    if let f = pal.foam { shared.uFoamCol = f }
    shared.uScatter = C.clamp(env.fogK + 0.5 * env.rain + 0.25 * env.haze, 0, 1)
    shared.uNightK = env.night
    if let n = st.fogNear, let f = st.fogFar {
      shared.uFogNear = n
      shared.uFogFar = f
    }
  }

  /// _wakes(env): trailing wake streaks from motion RELATIVE to the water only — the current running past a
  /// moored buoy (a free floater drifts with the current and makes none).
  func wakes() {
    let items = floaterField.items
    if items.isEmpty { return }
    let cur = env.current, f = env.focus
    if cur.x * cur.x + cur.y * cur.y < 0.0225 { return }
    let foam = 0.8 * MathUtil.smoothstep(3, 1.2, JSNumber.or(env.Hs, 0)) // a flat streak would cut into big swells
    if foam <= 0 { return }
    for it in items {
      if it.moored == nil || !(it.R > 0) || !it.h.isFinite { continue }
      if JS.abs(it.x - f.x) + JS.abs(it.z - f.y) > 360 { continue }
      collars.pushWake(it.x, it.h, it.z, it.R, cur.x, cur.y, foam: foam, phase: JSNumber.or(it.phase, 0))
    }
  }

  /// _channels(dt): rhythms and day / night levels (DESIGN §2.4, §2.8 photosensitivity).
  func updateChannels(_ dt: Double) {
    let CH = tables.ch
    let t = env.t
    let on = env.lightsOn
    let red = env.reduceFlashes
    let S = MathUtil.self
    setChannel(CH.ALWAYS, 1)
    setChannel(CH.WINDOWS, 0.04 + 0.96 * S.smoothstep(0.15, 0.7, JS.max(JS.max(env.night, env.fogK * 0.6), env.intensity * 0.55)))
    // daylight: deck LEDs barely register in the sun and no lamp shows a halo
    setChannel(CH.PERIM, 0.15 + 0.85 * on)
    shared.uLampK.y = (haloBase ?? 0.28) * S.smoothstep(0.05, 0.5, on)
    setChannel(CH.FLOOD, on)
    setChannel(CH.NAV, 0.45 + 0.55 * on)
    setChannel(CH.PADLIGHT, on)
    setChannel(CH.DIM, 0.25 + 0.75 * on)
    setChannel(CH.WANDS, 0.7 + 0.3 * on)
    setChannel(CH.BOAT, 0.3 + 0.7 * on)
    // red obstruction flashers: 1 Hz, soft edges; reduceFlashes → 40 %, smooth
    setChannel(CH.ANTI, red ? 0.4 * (0.6 + 0.4 * JS.sin(t * JS.PI)) : (0.5 + 0.5 * on) * S.smoothstep(-0.2, 0.2, JS.sin(t * JS.PI * 2)))
    // ship masthead beacon: 0.12 s flash every 2 s
    setChannel(CH.BEACON, red ? 0.4 * (0.5 + 0.5 * JS.sin(t * JS.PI)) : (JSNumber.mod(t, 2) < 0.12 ? 1 : 0) * (0.5 + 0.5 * on))
    // patrol blue flasher: double flash every 1.5 s
    let pb = JSNumber.mod(t, 1.5)
    setChannel(CH.BLUE, red ? 0.4 * (0.5 + 0.5 * JS.sin(t * JS.PI)) : pb < 0.08 || (pb > 0.2 && pb < 0.28) ? 1 : 0)
    for (k, kind) in tables.buoyKinds.enumerated() {
      setChannel(CH.BUOY0 + k, buoyRhythm(kind, t + Double(k) * 1.7, red) * (0.45 + 0.55 * on))
    }
    // blue offload lights: blink on the pad while people are carried off
    if dt > 0 { unloadT = JS.max(0, unloadT - dt) }
    for i in 0..<3 { setChannel(CH.UNLOAD0 + i, 0) }
    if let p = unloadPad, unloadT > 0 {
      let ch = CH.UNLOAD0 + Swift.min(p.raw, 2)
      setChannel(ch, red ? 0.7 : JS.sin(t * JS.PI * 4) > -0.2 ? 1 : 0.12)
    }
    // set by the places this frame
    setChannel(CH.LANTERN, 0)
    setChannel(CH.FLAME, 0)
    setChannel(CH.CLOUD, 0)
  }

  /// updateLandforms(env, palette): the swell for the terrain's surf band and the flat-light sky fill (in a
  /// storm the weak sky light would leave wet granite darker than the foam-streaked sea).
  func updateLandforms() {
    terrainUniforms.uSwell = env.Hs
    let pal = weather?.worldState?.palette
    guard let a = pal?.ambient, let s = pal?.sun else {
      terrainUniforms.uTFill = Color3(0, 0, 0)
      return
    }
    func lum(_ c: Color3) -> Double { 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }
    let sky = lum(a) * (pal?.ambientIntensity ?? 1) + 0.5 * lum(s) * (pal?.sunIntensity ?? 1)
    let k = 1.1 * MathUtil.smoothstep(0.45, 0.15, sky) * (1 - env.night)
    var f = a
    f.multiplyScalar(k / JS.max(0.02, lum(a)))
    terrainUniforms.uTFill = f
  }

  public func update(_ dt: Double) {
    refreshEnv(dt)
    updateChannels(dt)
    spotOwner = nil
    pointOwner = nil
    rigging.begin()
    collars.begin()

    for pl in places { pl.update(dt, env) }
    // scenery boats: M5
    floaterField.update(dt, env: env, ocean: ocean, hazards: hazards, collars: collars, lamps: lamps)
    wakes()
    updateLandforms()

    // moving pads: live tilt / heading (ships, M5)
    for i in pads.indices {
      guard let m = places[pads[i].place].deckMotion else { continue }
      pads[i].position = places[pads[i].place].padPosition
      pads[i].tilt = m.tilt
      pads[i].pitch = m.pitch
      pads[i].roll = m.roll
      pads[i].heading = m.heading
      pads[i].up = m.up
      pads[i].velocity = m.velocity
    }

    // spare deck light: with no ship, the PointLight floods the lighthouse (or rig) pad at night
    if pointOwner == nil {
      if let pl = lighthouse {
        lights.pointPosition = V3(pl.padPosition.x, pl.padPosition.y + 7, pl.padPosition.z)
        lights.pointIntensity = 70 * channel(tables.ch.PADLIGHT)
      } else {
        lights.pointIntensity = 0
      }
    }
    if spotOwner == nil { lights.spotIntensity = 0 }

    rigging.end()
    collars.end()
    // flood cones are a luxury: off on low
    if quality == "low" { flood.uIntensity = 0 }

    shoalT -= dt
    if shoalT <= 0 {
      shoalT = 0.5
      updateShoals()
    }
  }
}

// ---- the heli / camera / winch view (Heli/SimContext.swift WorldQuery) -----------------------------------

/// ctx.world as Helicopter, Winch, HeliOps and CameraRig read it: pads as LandingPad values (fixed pads carry
/// the web's zero velocity and (0, 1, 0) up), obstacles as cylinders (the heli applies `o.radius || 2`), the floaters, the
/// lighthouse position. `world.query` keeps one per world.
public final class WorldQueryAdapter: WorldQuery {
  unowned let world: World

  init(world: World) { self.world = world }

  static func landingPad(_ p: WorldPad) -> LandingPad {
    LandingPad(id: p.id, type: p.type, position: p.position, radius: p.radius, heading: p.heading, tilt: p.tilt, velocity: p.velocity,
               services: PadServices(fuel: p.services.fuel, repair: p.services.repair, resupply: p.services.resupply), refuel: p.refuel, up: p.up)
  }

  public var pads: [LandingPad] { world.pads.map(Self.landingPad) }
  public func pad(_ id: PadID) -> LandingPad? { world.pads.first { $0.id == id }.map(Self.landingPad) }
  public func padAt(_ x: Double, _ z: Double) -> LandingPad? { world.padAt(x, z).map(Self.landingPad) }
  public func nearestPad(_ x: Double, _ z: Double) -> LandingPad? { world.nearestPad(x, z).map(Self.landingPad) }
  public var obstacles: [FlightObstacle] { world.obstacles.map { FlightObstacle(x: $0.x, z: $0.z, radius: $0.radius, top: $0.top) } }
  public func deckAt(_ x: Double, _ z: Double) -> Double { world.deckAt(x, z) }
  public var floaters: [FlotsamItem] { world.floaterField.flotsam }
  public var lighthouse: V2? { world.lighthouse.map { V2($0.x, $0.z) } }
}
