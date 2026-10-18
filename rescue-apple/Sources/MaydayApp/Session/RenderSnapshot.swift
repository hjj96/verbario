// RenderSnapshot — what the web's scene graph and materials hold when the frame is drawn, gathered from
// the session's systems into MaydayRender's RenderFrame (plain values; the renderer never reads Core
// objects, PLAN §1.3):
//   camera   ctx.camera as CameraRig placed it (position, look direction and roll from matrixWorld)
//   look     core/look.js uniforms (time, wind, wind travel, rain, wet, flash, night, gust fronts)
//   fog      scene.fog from WeatherSim (colour lit by lightning, near, far)
//   lights   WeatherLights.state (sun + hemisphere + shadow box; MaydayRender LightRig packs it) and the
//            heli's lamps: spot[0] = the searchlight SpotLight, point[0] = the belly PointLight
//   env      WeatherEnv's bake decision with the palette sky (weather/env.js)
//   ocean    OceanSim.uniforms after the late upload (Mesh.onBeforeRender), the coast map, water memory
//   post     PostFX: exposure, bloom, the FinalPass uniforms
// Float conversions happen here, at the GPU boundary (D3).
import Foundation
import simd
import MaydayCore

extension GameSession {
  /// The frame to draw now. Runs the ocean's late upload first (values heli / survivors wrote after update).
  func renderFrame(internalWidth: Int, internalHeight: Int, pxScale: Float) -> RenderFrame {
    lateUpload()
    var f = RenderFrame(camera: renderCamera(), quality: quality, internalWidth: internalWidth, internalHeight: internalHeight)
    f.pxScale = pxScale
    f.realTime = loop.time.realT
    f.look = lookInput()
    f.fog = fogInput()
    f.lights = lightsInput()
    f.environment = environmentInput()
    f.ocean = GameSession.oceanInput(ocean.uniforms, coast: ocean.bank.coast)
    f.waterMemory = waterMemoryInput()
    f.post = postInput()
    // post.js freezes the dynamic-resolution scale while paused (and in photo mode)
    f.dynamicResolutionFrozen = loop.mode == .paused
    return f
  }

  // ---- camera --------------------------------------------------------------------------------------------
  /// ctx.camera → CameraState: eye, eye + forward (−Z column) and the camera's own up (+Y column), so the
  /// rig's shake roll survives the renderer's lookAt rebuild.
  func renderCamera() -> CameraState {
    camera.updateMatrixWorld()
    let m = camera.matrixWorld
    let p = SIMD3<Double>(m[12], m[13], m[14])
    let fwd = SIMD3<Double>(-m[8], -m[9], -m[10])
    let up = SIMD3<Double>(m[4], m[5], m[6])
    return CameraState(position: p, target: p + fwd, up: up, fovDeg: camera.fov, near: camera.near, far: camera.far,
                       zoom: camera.zoom)
  }

  // ---- look / fog -------------------------------------------------------------------------------------------
  func lookInput() -> LookInput {
    var l = LookInput()
    l.time = look.time
    l.wind = SIMD2<Double>(look.wind.x, look.wind.y)
    l.windOffset = SIMD2<Double>(look.windOffset.x, look.windOffset.y)
    l.rain = look.rain
    l.wet = look.wet
    l.flash = look.flash
    l.night = look.night
    l.gustFrontsA = look.gustFrontsA.map { SIMD4<Float>(Float($0.x), Float($0.y), Float($0.z), Float($0.w)) }
    l.gustFrontsB = look.gustFrontsB.map { SIMD4<Float>(Float($0.x), Float($0.y), Float($0.z), Float($0.w)) }
    return l
  }

  func fogInput() -> FogInput {
    var f = FogInput()
    f.color = GameSession.f3(weather.fogColor)
    f.near = Float(weather.fogNear)
    f.far = Float(weather.fogFar)
    f.enabled = true
    return f
  }

  // ---- lights -------------------------------------------------------------------------------------------------
  func lightsInput() -> LightsInput {
    let s = weather.lights.state
    var rigState = SunRigState()
    rigState.direction = s.direction
    rigState.position = s.position
    rigState.target = s.target
    rigState.intensity = s.intensity
    rigState.color = s.color
    rigState.shadowIntensity = s.shadowIntensity
    rigState.shadowRadius = s.shadowRadius
    rigState.hemiColor = s.hemiColor
    rigState.hemiGroundColor = s.hemiGroundColor
    rigState.hemiIntensity = s.hemiIntensity
    rigState.mapSize = s.mapSize
    var l = LightsInput()
    l.apply(rig: rigState, shadowOnlyLayer: weather.lights.shadowLayer1, shadows: true)
    l.environmentIntensity = Float(weather.env.environmentIntensity)
    l.spots = [searchlightSpot()]
    l.points = [bellyLight()]
    return l
  }

  /// heli/searchlight.js: SpotLight(0xfff1da, intensity, 300 m, angle, penumbra 0.6, decay 2) aimed at the
  /// beam's hit point; three's cone cosines: cos(angle), cos(angle · (1 − penumbra)).
  func searchlightSpot() -> SpotLightInput {
    let sp = heli.searchlightCtl.spot
    var s = SpotLightInput()
    s.position = GameSession.f3(sp.position)
    let d = (sp.target - sp.position).normalized()
    s.direction = GameSession.f3(d)
    let c = SearchlightSpot.color
    s.color = SIMD3<Float>(Float(c.r * sp.intensity), Float(c.g * sp.intensity), Float(c.b * sp.intensity))
    s.distance = Float(SearchlightSpot.range)
    s.decay = Float(SearchlightSpot.decay)
    s.coneCos = Float(JS.cos(sp.angle))
    s.penumbraCos = Float(JS.cos(sp.angle * (1 - sp.penumbra)))
    return s
  }

  /// heli/lights.js: the belly PointLight (90 m, decay 2) at POINTS.belly on the airframe body.
  func bellyLight() -> PointLightInput {
    let lc = heli.lightsCtl
    var p = HeliModel.Points.belly
    p.applyMatrix4(heli.visual.bodyMatrix)
    var b = PointLightInput()
    b.position = GameSession.f3(p)
    let c = lc.bellyColor
    let i = lc.bellyIntensity
    b.color = SIMD3<Float>(Float(c.r * i), Float(c.g * i), Float(c.b * i))
    b.distance = 90
    b.decay = 2
    return b
  }

  // ---- environment -------------------------------------------------------------------------------------------
  func environmentInput() -> EnvironmentInput {
    var e = EnvironmentInput()
    e.rebake = weather.env.bakeNow
    let st = weather.state
    e.sky = EnvSkyParams(palette: st.palette, sunDirVisual: st.sunDirVisual)
    return e
  }

  // ---- ocean -------------------------------------------------------------------------------------------------
  /// OceanUniformsCPU (Double / Float32 like the web's uniforms) → OceanFrameInput (the GPU's Float32).
  static func oceanInput(_ u: OceanUniformsCPU, coast: CoastMap?) -> OceanFrameInput {
    var o = OceanFrameInput()
    o.waveA = vec4s(u.uWaveA)
    o.waveB = vec4s(u.uWaveB)
    o.offset = SIMD2<Float>(Float(u.uOffset.x), Float(u.uOffset.y))
    o.gridStep = Float(u.uGridStep)
    o.hsEff = Float(u.uHsEff)
    o.shoals = Array(vec4s(u.uShoals).prefix(u.uShoalCount))
    o.coastWin = f4(u.uCoastWin)
    o.coastOn = Float(u.uCoastOn)
    o.featA = Array(vec4s(u.uFeatA).prefix(u.uFeatCount))
    o.featB = Array(vec4s(u.uFeatB).prefix(u.uFeatCount))
    o.featC = Array(vec4s(u.uFeatC).prefix(u.uFeatCount))
    o.downwash = f4(u.uDownwash)
    o.deep = f3(u.uDeep)
    o.body = f3(u.uBody)
    o.crest = f3(u.uCrest)
    o.shallow = f3(u.uShallow)
    o.foam = f3(u.uFoamCol)
    o.sky = f3(u.uSkyCol)
    o.fogColor = f3(u.uFogCol)
    o.sun = f3(u.uSunCol)
    o.spec = f3(u.uSpecCol)
    o.ambient = f3(u.uAmbCol)
    o.shadowTint = f3(u.uShadowTint)
    o.flashColor = f3(u.uFlashCol)
    o.sunDirV = f3(u.uSunDirV)
    o.sunDirS = f3(u.uSunDirS)
    o.seaA = f4(u.uSeaA)
    o.seaB = f4(u.uSeaB)
    o.seaC = f4(u.uSeaC)
    o.seaD = f4(u.uSeaD)
    o.seaE = f4(u.uSeaE)
    o.jStats = f4(u.uJStats)
    o.detOff = f4(u.uDetOff)
    o.detRot = f4(u.uDetRot)
    o.streakRot = f4(u.uStreakRot)
    o.streakMix = Float(u.uStreakMix)
    o.heliP = f4(u.uHeliP)
    o.searchPos = f3(u.uSearchPos)
    o.searchDir = f4(u.uSearchDir)
    o.searchI = Float(u.uSearchI)
    o.glints = Array(vec4s(u.uGlints).prefix(u.uGlintCount))
    o.glintColors = vec4s(u.uGlintCol).prefix(u.uGlintCount).map { SIMD3<Float>($0.x, $0.y, $0.z) }
    o.splashes = Array(vec4s(u.uSplash).prefix(u.uSplashCount))
    o.splashStrengths = Array(u.uSplashS.prefix(u.uSplashCount))
    o.memWin = f4(u.uMemWin)
    o.spotWater = Float(u.uSpotWater)
    o.front = f4(u.uFront)
    o.frontB = f4(u.uFrontB)
    o.prevDeep = f3(u.uPrevDeep)
    o.prevBody = f3(u.uPrevBody)
    o.prevCrest = f3(u.uPrevCrest)
    o.prevFoam = f3(u.uPrevFoam)
    o.nextDeep = f3(u.uNextDeep)
    o.nextBody = f3(u.uNextBody)
    o.nextCrest = f3(u.uNextCrest)
    o.nextFoam = f3(u.uNextFoam)
    o.prevSea = f4(u.uPrevSea)
    o.nextSea = f4(u.uNextSea)
    o.lookK = f4(u.uLookK)
    o.coast = coast
    return o
  }

  /// The water memory step OceanSim queued this frame (WaterMemoryQueue.Frame): the renderer re-derives
  /// the same window from the focus / wind / dt and draws the stamps. A frame without a new update
  /// (paused, dt 0) hands over dt 0: texture and window stay.
  func waterMemoryInput() -> WaterMemoryInput {
    var w = WaterMemoryInput()
    w.focus = SIMD2<Double>(ocean.focus.x, ocean.focus.y)
    w.wind = SIMD2<Double>(look.wind.x, look.wind.y)
    guard let fr = ocean.memory?.frame, fr.serial != memorySerial else { return w }
    memorySerial = fr.serial
    w.dt = fr.advect.dt
    w.clear = fr.clear
    w.focus = SIMD2<Double>(fr.advect.center.x, fr.advect.center.y)
    w.wind = SIMD2<Double>(fr.advect.windV.x, fr.advect.windV.y)
    for i in 0..<fr.count {
      let j = i * 4
      guard j + 3 < fr.aA.count, j + 3 < fr.aB.count, j + 3 < fr.aC.count,
            let shape = WaterMemoryStamp.Shape(rawValue: fr.aC[j]) else { continue }
      w.push(shape, x: Double(fr.aA[j]), z: Double(fr.aA[j + 1]), radius: Double(fr.aA[j + 2]), strength: Double(fr.aA[j + 3]),
             foam: Double(fr.aB[j]), dye: Double(fr.aB[j + 1]), disturbance: Double(fr.aB[j + 2]), oil: Double(fr.aB[j + 3]),
             inner: Double(fr.aC[j + 1]), dirX: Double(fr.aC[j + 2]), dirZ: Double(fr.aC[j + 3]))
    }
    return w
  }

  // ---- post ------------------------------------------------------------------------------------------------
  func postInput() -> PostInput {
    let s = post.state
    var p = PostInput()
    p.exposure = Float(s.exposure)
    p.bloomStrength = Float(s.bloomStrength)
    p.bloomRadius = Float(s.bloomRadius)
    p.bloomThreshold = Float(s.bloomThreshold)
    p.finalPass = s.uniforms.finalInput
    return p
  }

  // ---- conversions -----------------------------------------------------------------------------------------
  static func f3(_ c: PaletteColor) -> SIMD3<Float> { SIMD3<Float>(Float(c.r), Float(c.g), Float(c.b)) }
  static func f3(_ v: V3) -> SIMD3<Float> { SIMD3<Float>(Float(v.x), Float(v.y), Float(v.z)) }
  static func f4(_ v: V4) -> SIMD4<Float> { SIMD4<Float>(Float(v.x), Float(v.y), Float(v.z), Float(v.w)) }

  /// A Float32Array of vec4s → SIMD4 values (a trailing partial vec4 is dropped).
  static func vec4s(_ a: [Float]) -> [SIMD4<Float>] {
    stride(from: 0, to: a.count - 3, by: 4).map { SIMD4<Float>(a[$0], a[$0 + 1], a[$0 + 2], a[$0 + 3]) }
  }
}
