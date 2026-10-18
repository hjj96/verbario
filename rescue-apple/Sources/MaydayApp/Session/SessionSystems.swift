// The loop entries that need the host's hands (main.js `ctx[key].update(dt)` for systems whose Swift port
// takes its per-frame inputs as fields instead of reading `ctx` itself):
//   WeatherStep  ctx.heli (last frame's position / altitude: weather updates first), ctx.camera
//                (position + getWorldDirection), ctx.world.obstacles → WeatherSim, then update(dt);
//   OceanStep    ctx.camera (getWorldPosition / getWorldDirection), ctx.heli (position, altitude, alive,
//                rotorRPM), ctx.time → OceanSim, then update(dt);
//   PostSystem   systems/post.js PostFX: the event pulses and settings hooks of its constructor, and
//                update(realDt) over the frame's weather / heli / camera state (MaydayRender PostState).
// Everything else (Helicopter, CameraRig, the free-flight stand-ins) is registered with the loop as is.
import Foundation
import MaydayCore

/// three Camera.getWorldDirection(out): updateWorldMatrix, (e[8], e[9], e[10]).normalize(), negate.
func cameraWorldDirection(_ cam: PerspectiveCamera) -> V3 {
  cam.updateMatrixWorld()
  let m = cam.matrixWorld
  let d = V3(m[8], m[9], m[10]).normalized()
  return V3(-d.x, -d.y, -d.z)
}

/// Object3D.getWorldPosition(out): updateWorldMatrix, setFromMatrixPosition(matrixWorld).
func cameraWorldPosition(_ cam: PerspectiveCamera) -> V3 {
  cam.updateMatrixWorld()
  let m = cam.matrixWorld
  return V3(m[12], m[13], m[14])
}

/// ctx.weather in the loop.
final class WeatherStep: GameSystem {
  let weather: WeatherSim
  private unowned let heli: Helicopter
  private unowned let camera: PerspectiveCamera
  private unowned let world: FreeFlightWorld

  init(weather: WeatherSim, heli: Helicopter, camera: PerspectiveCamera, world: FreeFlightWorld) {
    self.weather = weather
    self.heli = heli
    self.camera = camera
    self.world = world
  }

  func update(_ dt: Double) {
    weather.heli = WeatherHeliInput(position: heli.position, altitude: heli.altitude)
    // _updateCamFocus: cam.getWorldDirection(f), then cam.position (the camera has no parent)
    let dir = cameraWorldDirection(camera)
    weather.camera = WeatherCameraInput(position: camera.position, direction: dir)
    weather.obstacles = world.obstacles.map { WeatherObstacle(x: $0.x, z: $0.z, top: $0.top) }
    weather.update(dt)
  }
}

/// ctx.ocean in the loop.
final class OceanStep: GameSystem {
  let ocean: OceanSim
  private unowned let heli: Helicopter
  private unowned let camera: PerspectiveCamera
  private unowned let loop: GameLoop

  init(ocean: OceanSim, heli: Helicopter, camera: PerspectiveCamera, loop: GameLoop) {
    self.ocean = ocean
    self.heli = heli
    self.camera = camera
    self.loop = loop
  }

  func update(_ dt: Double) {
    let pos = cameraWorldPosition(camera)
    ocean.camera = OceanCameraInput(position: pos, direction: cameraWorldDirection(camera))
    ocean.heli = OceanHeliInput(position: heli.position, altitude: heli.altitude, alive: heli.alive, rotorRPM: heli.rotorRPM)
    ocean.time = loop.time
    ocean.update(dt)
  }
}

/// ctx.post (systems/post.js) without the composer: the pulses, the grade and the exposure the frame uses.
/// Thermal view, photo mode and lens drops are not ported yet (their inputs stay at rest); dynamic
/// resolution is the renderer's (GPU time, PLAN X2).
final class PostSystem: GameSystem {
  let state: PostState
  /// Drawing-buffer height in px (post.js _size.y: the internal resolution) — the host sets it each frame.
  var bufferHeight: Double = 1080
  private unowned let loop: GameLoop
  private unowned let settings: GameSettings
  private unowned let weather: WeatherSim
  private unowned let heli: Helicopter
  private unowned let rig: CameraRig
  private unowned let camera: PerspectiveCamera
  private var subscriptions: [EventSubscription] = []
  private var settingsSub: SettingsSubscription?

  init(events: EventBus, loop: GameLoop, settings: GameSettings, weather: WeatherSim, heli: Helicopter, rig: CameraRig,
       camera: PerspectiveCamera) {
    self.loop = loop
    self.settings = settings
    self.weather = weather
    self.heli = heli
    self.rig = rig
    self.camera = camera
    state = PostState(quality: settings.quality ?? "high", reduceFlashes: settings.flag("reduceFlashes"),
                      reduceMotion: settings.flag("reduceMotion"))
    // the constructor's listeners, in post.js order
    subscriptions.append(events.on(GameEvent.HeliDamage.self) { [weak self] e in
      guard let self else { return }
      self.refreshFlags()
      self.state.onHeliDamage(source: e.source, amount: e.amount)
    })
    subscriptions.append(events.on(GameEvent.WeatherLightning.self) { [weak self] e in
      guard let self else { return }
      self.refreshFlags()
      self.state.onLightning(distance: e.distance, cloudOnly: e.cloudOnly)
    })
    subscriptions.append(events.on(GameEvent.HazardHit.self) { [weak self] e in
      guard let self else { return }
      self.refreshFlags()
      self.state.onHazardHit(type: e.type)
    })
    settingsSub = settings.onChange { [weak self] key, _ in
      guard let self else { return }
      if key == "quality" { self.state.applyQuality(self.settings.quality ?? "high") }
      if key == "reduceMotion" && self.settings.flag("reduceMotion") { self.state.setReduceMotion(true) }
    }
  }

  deinit {
    for s in subscriptions { s.off() }
    settingsSub?.off()
  }

  /// post.js reads settings.get('reduceFlashes') live in pulse() / update().
  private func refreshFlags() { state.reduceFlashes = settings.flag("reduceFlashes") }

  /// update(realDt) (RUN_WHEN_PAUSED).
  func update(_ dt: Double) {
    refreshFlags()
    var f = PostFrameInput(dt: dt)
    f.mode = loop.mode.rawValue
    let st = weather.state
    var w = PostWeatherInput(palette: st.palette)
    w.flash = st.flash
    w.night = st.night
    w.greenTint = st.greenTint
    w.flashColor = st.flashColor
    w.fog = st.fog
    w.rain = st.rain
    w.windDir = SIMD2<Double>(st.windDir.x, st.windDir.y)
    w.windSpeed = st.windSpeed
    w.waveHeight = st.waveHeight
    w.preset = st.preset
    f.weather = w
    var h = PostHeliInput()
    h.hull = heli.hull
    h.fuel = heli.fuel
    h.alive = heli.alive
    h.velocity = SIMD2<Double>(heli.velocity.x, heli.velocity.z)
    h.altitude = heli.altitude
    h.landed = heli.landed != nil
    f.heli = h
    // camera.matrixWorld e[0], e[2] (right) and e[4], e[6] (up) for _screenVec
    let m = camera.matrixWorld
    f.cameraRightXZ = SIMD2<Double>(m[0], m[2])
    f.cameraUpXZ = SIMD2<Double>(m[4], m[6])
    f.letterbox = rig.letterbox
    f.bufferHeight = bufferHeight
    state.update(f)
  }
}
