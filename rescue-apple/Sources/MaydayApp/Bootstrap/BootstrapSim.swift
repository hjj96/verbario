// BootstrapSim — the M0 stand-in for MaydayCore's Game loop: enough simulation to show the game's
// sea and look on the first native build.
//   * weather: a preset palette (palette.json COMPILED) with a 6 s linear blend on change; wind
//     bearing as weather.js starts it (120° "towards", windDir = (sin a, −cos a)), wind integrated
//     into uWindOffset (look.setWind);
//   * a "probe" standing in for the helicopter (invisible): flown with the game's actions (move,
//     lift, altitude presets, boost), followed by the escort-drone camera (camera.js framing);
//   * ocean uniforms (ocean.js), lights (weather/lights.js sun), fog, post grade (post.js).
// Debug hotkeys (outside the game's bindings): [ / ] or pad D-pad ←/→ — previous / next preset;
//   F2 or pad View — cycle quality; searchlight (L / pad X) — probe lamp; horn (H / pad Y) — probe
//   downwash + contact patch on/off; flare (G / LMB / pad B) — splash under the probe;
//   zoom (Z / RB) — camera zoom; pause (Esc / P / Menu) — freeze game time.
//
// BOOTSTRAP: replaced piece by piece by MaydayCore (Game, WeatherSim, OceanSim, CameraRig, Heli).
import Foundation
import MaydayCore

final class BootstrapSim {
  let data: DataBundle
  let palettes: PaletteTable
  let ocean: BootstrapOcean
  let camera: BootstrapCamera
  let input: ActionInput
  private let qualityTable: [String: RenderQualityConfig]
  private let pixelRatioCaps: [String: Double]
  private let pixelBudget: Double
  let qualityOrder = ["low", "medium", "high"]
  private(set) var quality: RenderQualityConfig

  // weather
  private(set) var presetIndex: Int
  private var blendFrom: [Double]
  private var blendTo: [Double]
  private var blendT = 1.0
  private let blendSeconds = 6.0
  private var windTo: Double
  private(set) var windOffset = SIMD2<Double>(0, 0)
  // time
  private(set) var t = 0.0
  private(set) var realT = 0.0
  private(set) var frame = 0
  var paused = false
  // probe (heli stand-in)
  private(set) var probe = SIMD3<Double>(0, 40, 0)
  private var probeV = SIMD3<Double>(0, 0, 0)
  private var altTarget = 40.0
  private(set) var searchlightOn = false
  private(set) var probeEffects = false
  // post grain reseed (post.js: 24 Hz, seed = (seed + 1) % 997, + rng(911).next())
  private var grainSeed = 0
  private var grainSeedT = 0.0
  private var grainValue: Float = 0
  private var grainRng: Mulberry32
  // last camera pose (debug overlay)
  private(set) var lastPose: CameraPose?

  var presetName: String { palettes.names[presetIndex] }

  init(data d: DataBundle, qualityName: String, presetName: String?) throws {
    data = d
    let oceanJSON = try d.data("ocean")
    let postJSON = try d.data("post")
    let settingsJSON = try d.data("settings")
    let gameJSON = try d.data("game")
    let weatherJSON = try d.data("weather")
    let cameraJSON = try d.data("camera")
    let inputJSON = try d.data("input")
    let paletteJSON = try d.data("palette")
    let lookJSON = try d.data("look")

    // quality tiers (ocean/waves.js QUALITY + post.js SAMPLES / MIN_SCALE + settings pixelRatioCap)
    var table: [String: RenderQualityConfig] = [:]
    var caps: [String: Double] = [:]
    for name in ["low", "medium", "high"] {
      let q = oceanJSON["ocean/waves"]["QUALITY"][name]
      table[name] = RenderQualityConfig(
        name: name,
        sampleCount: max(1, postJSON["post"]["SAMPLES"][name].int(or: 1)),
        oceanGridN: q["grid"].int(or: 224),
        oceanWaves: q["waves"].int(or: 6),
        oceanQ: q["q"].int(or: 1),
        oceanGlints: q["glints"].int(or: 4),
        oceanMemory: q["memory"].int(or: 0),
        minDynScale: postJSON["post"]["MIN_SCALE"][name].double(or: 0.75))
      caps[name] = settingsJSON["derived"]["qualityTiers"][name]["pixelRatioCap"].double(or: 1.5)
    }
    qualityTable = table
    pixelRatioCaps = caps
    let pr = gameJSON["derived"]["pixelRatio"]
    pixelBudget = pr["budgetW"].double(or: 1920) * pr["budgetH"].double(or: 1080)
    let q = table[qualityName] ?? table["high"]!
    quality = q

    // look scales baked into Shaders/Common/Look.h must match look.json (web source of truth)
    let lk = lookJSON["core/look"]
    assert(lk["GUST_SCALE"].double(or: 0.006) == 0.006 && lk["GUST_DRIFT"].double(or: 0.9) == 0.9 &&
           lk["CLOUD_SCALE"].double(or: 0.0025) == 0.0025 && lk["CLOUD_DRIFT"].double(or: 1.5) == 1.5,
           "look.json scales changed: update Shaders/Common/Look.h")

    let names = weatherJSON["weather/presets"]["PRESET_NAMES"].strings
    let table2 = try PaletteTable(palette: paletteJSON["weather/palette"], presetNames: names)
    palettes = table2
    let startName = presetName ?? weatherJSON["weather"]["ATTRACT_CYCLE"][2].string ?? "calm"
    let idx = table2.names.firstIndex(of: startName) ?? 0
    let startPacked = table2.packed(table2.names[idx])
    presetIndex = idx
    blendFrom = startPacked
    blendTo = startPacked

    let oceanData = try OceanData(catalog: d.catalog())   // MaydayCore: typed ocean.json (wave constants)
    let oceanSim = BootstrapOcean(oceanData: oceanData, ocean: oceanJSON, quality: q)
    let windAngle0 = 120 * Double.pi / 180              // weather.js: this._windTo = 120°
    let wd = BootstrapSim.windDir(windAngle0)
    oceanSim.reset(missionSeed: nil, windAngle: atan2(wd.y, wd.x))   // mission def absent → seed 1
    ocean = oceanSim
    windTo = windAngle0
    camera = BootstrapCamera(camera: cameraJSON["camera"], game: gameJSON["derived"]["camera"])
    input = ActionInput(json: inputJSON["core/input"])
    grainRng = Mulberry32(seed: 911)                    // post.js createRng(911)
  }

  /// weather.js: windDir = (sin a, −cos a) for a bearing "towards" a (north = −Z).
  static func windDir(_ a: Double) -> SIMD2<Double> { SIMD2<Double>(sin(a), -cos(a)) }

  func qualityConfig(_ name: String) -> RenderQualityConfig? { qualityTable[name] }

  func setQuality(_ name: String) {
    guard let q = qualityTable[name] else { return }
    quality = q
    ocean.setQuality(q)
  }

  func cycleQuality() {
    let i = qualityOrder.firstIndex(of: quality.name) ?? 2
    setQuality(qualityOrder[(i + 1) % qualityOrder.count])
  }

  func setPreset(index: Int) {
    let n = palettes.names.count
    let i = ((index % n) + n) % n
    blendFrom = currentPacked()
    blendTo = palettes.packed(palettes.names[i])
    blendT = 0
    presetIndex = i
  }

  private func currentPacked() -> [Double] {
    let s = blendT >= 1 ? 1 : BootMath.smoothstep(0, 1, blendT)
    return PaletteTable.blend(blendFrom, blendTo, s)
  }

  /// Web pixel-ratio rule (main.js): min(devicePixelRatio, pixelRatioCap(quality), max(1, √(1920·1080 / (w·h)))),
  /// w·h in CSS px (points). Returns the internal render size in pixels.
  func internalSize(pointsWidth w: Double, pointsHeight h: Double, screenScale: Double) -> (Int, Int) {
    let cap = pixelRatioCaps[quality.name] ?? 1.5
    let budget = max(1, (pixelBudget / max(1, w * h)).squareRoot())
    let ratio = min(screenScale, cap, budget)
    return (max(1, Int((w * ratio).rounded())), max(1, Int((h * ratio).rounded())))
  }

  // ---- frame ----------------------------------------------------------------------------------------

  func step(realDt: Double, raw: RawInputFrame) {
    frame += 1
    realT += realDt
    input.poll(raw)
    handleHotkeys()
    let dt = paused ? 0 : realDt
    t += dt
    if blendT < 1 { blendT = min(1, blendT + realDt / blendSeconds) }
    let pal = PaletteSnapshot(packed: currentPacked(), offsets: palettes.offsets)

    // wind (weather.js): speed = palette.wind, integrated into uWindOffset (look.setWind)
    let wd = BootstrapSim.windDir(windTo)
    let windSpeed = pal.num("wind")
    windOffset += wd * windSpeed * dt

    // probe flight: the game's actions, a simple kinematic stand-in for heli/flight.js
    if dt > 0 {
      let mv = input.move()
      let boost = input.down("boost") ? 1.5 : 1.0
      let target = SIMD3<Double>(mv.x * 22 * boost, 0, -mv.y * 22 * boost)   // +moveY = north = −Z
      let k = 1 - exp(-dt * 1.6)
      probeV.x += (target.x - probeV.x) * k
      probeV.z += (target.z - probeV.z) * k
      if input.pressed("altPreset1") { altTarget = 15 }
      if input.pressed("altPreset2") { altTarget = 40 }
      if input.pressed("altPreset3") { altTarget = 90 }
      let lift = input.axis("lift")
      if abs(lift) > 0.05 { altTarget = min(max(altTarget + lift * 9 * dt, 4), 150) }
      let vy = (altTarget - probe.y) * (1 - exp(-dt * 1.2)) / dt
      probeV.y = min(max(vy, -6), 6.8)
      probe += probeV * dt
    }
  }

  private func handleHotkeys() {
    if input.rawKeyPressed("BracketRight") || input.rawPadPressed(15) { setPreset(index: presetIndex + 1) }
    if input.rawKeyPressed("BracketLeft") || input.rawPadPressed(14) { setPreset(index: presetIndex - 1) }
    if input.rawKeyPressed("F2") || input.rawPadPressed(8) { cycleQuality() }
    if input.pressed("zoom") { camera.cycleZoom() }
    if input.pressed("searchlight") { searchlightOn.toggle() }
    if input.pressed("horn") { probeEffects.toggle() }
    if input.pressed("pause") { paused.toggle() }
    if input.pressed("flare") {
      ocean.splash(x: probe.x, z: probe.z - 12, radius: 2.5, strength: 1, t: t)
    }
  }

  /// Builds the render snapshot for the current state.
  func renderFrame(internalWidth: Int, internalHeight: Int, pxScale: Float, dt: Double) -> RenderFrame {
    let pal = PaletteSnapshot(packed: currentPacked(), offsets: palettes.offsets)
    let storm = min(max(pal.num("intensity"), 0), 1)
    let pose = camera.update(dt: dt, heli: probe, velocity: probeV, storm: storm)
    lastPose = pose
    let cam = CameraState(position: pose.position, target: pose.target, fovDeg: pose.fovDeg, near: pose.near, far: pose.far)
    var f = RenderFrame(camera: cam, quality: quality, internalWidth: internalWidth, internalHeight: internalHeight)
    f.pxScale = pxScale
    f.realTime = realT

    let wd = BootstrapSim.windDir(windTo)
    let windSpeed = pal.num("wind")
    let night = min(max(pal.num("night"), 0), 1)
    let rain = min(max(pal.num("rain"), 0), 1)

    // look uniforms (weather.js writes uRain / uWet / uFlash / uNight; look.setWind)
    f.look.time = t
    f.look.wind = wd * windSpeed
    f.look.windOffset = windOffset
    f.look.rain = rain
    f.look.wet = rain
    f.look.flash = 0
    f.look.night = night

    // fog (weather.js: fog.near = p.fogNear, fog.far = max(near + 1, far); background = fog colour)
    let fogNear = pal.num("fogNear")
    f.fog.color = pal.colorF("fogColor")
    f.fog.near = Float(fogNear)
    f.fog.far = Float(max(fogNear + 1, pal.num("fogFar")))

    // lights (weather/lights.js): sun = palette.sun × sunIntensity along the cheated (shadow) direction
    let sun = BootstrapOcean.sunDirections(pal)
    let sunI = pal.num("sunIntensity")
    f.lights.sunDirection = toF(sun.shadow)
    f.lights.sunColor = toF(pal.color("sun") * sunI)
    let ambI = pal.num("ambientIntensity")
    f.lights.hemiSky = toF(pal.color("ambient") * ambI)
    f.lights.hemiGround = toF(pal.color("ambientGround") * ambI)
    f.lights.environmentIntensity = Float(pal.num("envIntensity"))

    // ocean: probe effects (downwash, contact patch) and the searchlight on demand
    ocean.setDownwashFromHeli(x: probe.x, z: probe.z, altitude: probe.y, rpm: 1, enabled: probeEffects)
    if searchlightOn {
      let dir = SIMD3<Double>(0, -probe.y, -18)          // a little ahead (north) of the probe
      ocean.setSearchlight(pos: probe, dir: dir, cosOuter: cos(20 * Double.pi / 180), intensity: 1, frame: frame)
    }
    let heliP = SIMD4<Double>(probe.x, probe.z, probe.y, probeEffects ? 1 : 0)
    f.ocean = ocean.update(dt: paused ? 0 : dt, t: t, frame: frame, camera: pose, pal: pal,
                           windDir: wd, windSpeed: windSpeed, flash: 0, heli: heliP)

    // post (post.js): exposure, grade from palette.post (colours linear → sRGB for the FinalPass)
    f.post.exposure = Float(pal.num("exposure"))
    f.post.bloomStrength = 0
    var g = FinalInput()
    g.slope = toF(pal.vec3("post.slope"))
    g.offset = toF(pal.vec3("post.offset"))
    g.power = Float(pal.num("post.power"))
    g.contrast = Float(pal.num("post.contrast"))
    g.sat = Float(pal.num("post.saturation"))          // × (1 − 0.45·greenTint), greenTint = 0
    g.green = 0
    g.splitShadow = BootstrapSim.linearToSRGB(pal.color("post.splitShadow"))
    g.splitHighlight = BootstrapSim.linearToSRGB(pal.color("post.splitHighlight"))
    g.splitStrength = Float(pal.num("post.splitStrength"))
    g.vignette = Float(pal.num("post.vignette"))
    g.vignetteColor = BootstrapSim.linearToSRGB(pal.color("post.vignetteColor"))
    g.grain = Float(pal.num("post.grain"))
    g.ca = Float(pal.num("post.ca") * Double(internalHeight) / 1080)
    g.night = Float(night)
    g.blackFloor = Float(0.006 + 0.006 * night)
    g.dayToe = Float(0.05 * (1 - BootMath.smoothstep(0.4, 0.75, night)))
    g.letterbox = Float(min(max(pose.letterbox, 0), 1))
    g.bright = paused ? 0.65 : 1                         // post.js pause pulse (target value)
    g.satMul = paused ? 0.4 : 1
    // grain reseeded at 24 Hz
    grainSeedT += dt
    if grainSeedT >= 1.0 / 24.0 {
      grainSeedT = grainSeedT.truncatingRemainder(dividingBy: 1.0 / 24.0)
      grainSeed = (grainSeed + 1) % 997
      grainValue = Float(Double(grainSeed) + grainRng.next())
    }
    g.seed = grainValue
    f.post.finalPass = g
    return f
  }

  /// THREE.Color.convertLinearToSRGB per channel (post.js setSRGB).
  static func linearToSRGB(_ c: SIMD3<Double>) -> SIMD3<Float> {
    func ch(_ x: Double) -> Float {
      Float(x < 0.0031308 ? x * 12.92 : 1.055 * pow(x, 0.41666) - 0.055)
    }
    return SIMD3<Float>(ch(c.x), ch(c.y), ch(c.z))
  }
}
