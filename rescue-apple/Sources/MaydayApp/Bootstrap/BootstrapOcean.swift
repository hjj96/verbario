// BootstrapOcean — per-frame ocean uniforms (the OceanUniformsCPU snapshot the renderer draws).
// port: rescue/src/systems/ocean.js — _reset(), update() (focus → snapped grid offset, bank update,
// downwash from the heli, searchlight auto-off), _packSplashes(), _updateLook() (palette → uniforms,
// detail frames + drift, streak frame hysteresis + 6 s cross-fade), _lateUpload(), splash(),
// setSearchlight(), setDownwash().
//
// The Gerstner bank is MaydayCore's parity port (Ocean/WaveBank.swift, CJSMath, bit-exact with the
// web vectors) and the reset / focus / snap rules are MaydayCore's OceanCPU — the renderer's
// uWaveA / uWaveB / uHsEff / uJStats come straight from it.
// BOOTSTRAP: the rest (look uniforms, splashes, searchlight, downwash) moves into
// MaydayCore/Ocean/OceanSim.swift with features, water memory, glints, shoals, coast map and stamps.
import Foundation
import MaydayCore

final class BootstrapOcean {
  let bank: WaveBank
  let constants: WaveConstants
  private(set) var quality: RenderQualityConfig
  private var snapQ: Double
  private let deg = Double.pi / 180
  private let flashDay: SIMD3<Double>
  private let flashNight: SIMD3<Double>
  private let maxSplashes: Int
  private let memoryExtent: Double

  var focus = SIMD2<Double>(0, 0)
  var clearing = 0.0
  private var detOff = SIMD4<Double>(0, 0, 0, 0)
  private var streakA = 0.0
  private var streakB = 0.0
  private var streakMix = 0.0
  // splash pool (analytic rings)
  private var splX: [Double]
  private var splZ: [Double]
  private var splT0: [Double]
  private var splR: [Double]
  private var splS: [Double]
  private var splNext = 0
  // searchlight (CPU mirror of setSearchlight)
  private var searchPos = SIMD3<Double>(0, 0, 0)
  private var searchDir = SIMD3<Double>(0, -1, 0)
  private var searchCosOuter = 0.95
  private var searchI = 0.0
  private var searchFrame = -1_000_000_000
  // downwash
  private var downwash = SIMD4<Double>(0, 0, 10, 0)

  /// oceanData: MaydayCore OceanData (ocean.json, typed); ocean: the same file, untyped (look extras).
  init(oceanData: OceanData, ocean o: BootJSON, quality q: RenderQualityConfig) {
    let ms = max(1, o["ocean"]["MAX_SPLASHES"].int(or: 24))
    let zeros = [Double](repeating: 0, count: ms)
    let waveBank = WaveBank(constants: oceanData.waves)
    waveBank.setQuality(q.oceanWaves, q.oceanGridN)
    bank = waveBank
    constants = oceanData.waves
    flashDay = o["ocean"]["FLASH_DAY"].linearColor(or: SIMD3<Double>(0.7157, 0.7913, 1))
    flashNight = o["ocean"]["FLASH_NIGHT"].linearColor(or: SIMD3<Double>(0.5711, 0.6724, 1))
    maxSplashes = ms
    memoryExtent = oceanData.memoryExtent
    splX = zeros
    splZ = zeros
    splR = zeros
    splS = zeros
    splT0 = [Double](repeating: -1e9, count: ms)
    quality = q
    snapQ = OceanGrid.snapQuantum(q.oceanGridN, constants: oceanData.waves)
  }

  func setQuality(_ q: RenderQualityConfig) {
    if q == quality { return }
    quality = q
    bank.setQuality(q.oceanWaves, q.oceanGridN)
    snapQ = OceanGrid.snapQuantum(q.oceanGridN, constants: constants)
  }

  /// ocean.js _reset(def): base swell within ±20° of the wind at mission start, seeded (OceanCPU.reset).
  func reset(missionSeed: Double?, windAngle: Double) {
    OceanCPU.reset(bank, missionSeed: missionSeed, windAngle: windAngle)
    streakA = windAngle
    streakB = windAngle
    streakMix = 0
    for i in 0..<splT0.count { splT0[i] = -1e9 }
  }

  func splash(x: Double, z: Double, radius: Double, strength: Double, t: Double) {
    let i = splNext
    splNext = (i + 1) % maxSplashes
    splX[i] = x
    splZ[i] = z
    splR[i] = min(max(radius, 0.3), 20)
    splS[i] = min(max(strength, 0), 1.5)
    splT0[i] = t
  }

  func setSearchlight(pos: SIMD3<Double>, dir: SIMD3<Double>, cosOuter: Double, intensity: Double, frame: Int) {
    searchPos = pos
    let l = (dir.x * dir.x + dir.y * dir.y + dir.z * dir.z).squareRoot()
    if l > 0 { searchDir = dir / l }
    searchCosOuter = min(max(cosOuter, -0.99), 0.99999)
    searchI = min(max(intensity, 0), 2)
    searchFrame = frame
  }

  /// ocean.js _downwashFromHeli(): strength (1 − (alt − 4)/28)² · rpm, radius 9 + 0.35·alt.
  func setDownwashFromHeli(x: Double, z: Double, altitude alt: Double, rpm: Double, enabled: Bool) {
    if !enabled {
      downwash.w = 0
      return
    }
    let s = min(max(1 - (alt - 4) / 28, 0), 1)
    downwash = SIMD4<Double>(x, z, 9 + 0.35 * max(0, alt), s * s * min(max(rpm, 0), 1))
  }

  /// One ocean.update(dt) → the uniform snapshot. `pal` is the blended palette; windDir unit (x, z).
  func update(dt: Double, t: Double, frame: Int, camera: CameraPose, pal: PaletteSnapshot,
              windDir: SIMD2<Double>, windSpeed: Double, flash: Double, heli: SIMD4<Double>) -> OceanFrameInput {
    let night = min(max(pal.num("night"), 0), 1)
    let intensity = min(max(pal.num("intensity"), 0), 1)
    let windAngle = atan2(windDir.y, windDir.x)

    // focus point under the screen centre (same formula as the fog patch) → snapped grid offset
    let fwd = simdNormalize(camera.target - camera.position)
    let fv = OceanCPU.focus(cameraPosition: V3(camera.position.x, camera.position.y, camera.position.z),
                            cameraDirection: V3(fwd.x, fwd.y, fwd.z))
    focus = SIMD2<Double>(fv.x, fv.y)
    let off = OceanCPU.snappedOffset(fv, quantum: snapQ)
    let ox = off.x
    let oz = off.y

    // clearing look: palette.sea.clearing (weather provides it) → shortScale 1 − 0.75·clearing
    let sea = SeaState(Hs: pal.num("sea.Hs"), swellAdd: pal.num("sea.swellAdd"), Q: pal.num("sea.Q"),
                       clearing: pal.num("sea.clearing"))
    clearing = OceanCPU.clearing(sea)
    bank.update(dt, t, sea, windAngle, OceanCPU.shortScale(sea), ox, oz)
    if frame - searchFrame > 2 { searchI = 0 }      // searchlight auto-off if nobody calls

    var o = OceanFrameInput()
    o.waveA = bank.waveA4
    o.waveB = bank.waveB4
    o.offset = SIMD2<Float>(Float(ox), Float(oz))
    o.gridStep = Float(2 / Double(quality.oceanGridN))
    o.memWin = SIMD4<Float>(0, 0, Float(memoryExtent), 0)

    // ---- _packSplashes
    for i in 0..<maxSplashes {
      let age = t - splT0[i]
      let life = 1.4 + 0.3 * splR[i]
      if age < 0 || age >= life { continue }
      o.splashes.append(SIMD4<Float>(Float(splX[i]), Float(splZ[i]), Float(age), Float(splR[i])))
      o.splashStrengths.append(Float(splS[i]))
    }

    // ---- _updateLook: palette colours (linear)
    o.deep = pal.colorF("deep")
    o.body = pal.colorF("body")
    o.crest = pal.colorF("crest")
    o.shallow = pal.colorF("shallow")
    o.foam = pal.colorF("foam")
    o.sky = pal.colorF("sky")
    o.fogColor = pal.colorF("fogColor")
    o.sun = pal.colorF("sun")
    o.spec = pal.colorF("spec")
    o.ambient = pal.colorF("ambient")
    o.shadowTint = pal.colorF("shadowTint")
    let fc = flashDay + (flashNight - flashDay) * night
    o.flashColor = SIMD3<Float>(Float(fc.x), Float(fc.y), Float(fc.z))
    let sun = BootstrapOcean.sunDirections(pal)
    o.sunDirV = toF(sun.visual)
    o.sunDirS = toF(sun.shadow)

    let sunI = pal.num("sunIntensity")
    let shadowI = min(max(pal.num("shadowIntensity"), 0), 1)
    let rain = min(max(pal.num("rain"), 0), 1)
    let sunGlit = pal.num("glitter")
    // a moon path on clear nights («Лунная дорожка»): the moon is the "sun" of night presets
    let moonGlit = night * BootMath.smoothstep(0.2, 0.35, sunI) * (1 - intensity) * 0.35
    let glitter = quality.oceanQ > 0 ? max(sunGlit, moonGlit) * (1 - rain) : 0
    let cloudRefl = pal.num("sea.cloudReflect")
    let cloudShadow = abs(pal.num("cloudShadow")) * (1 - night)
    let sss = pal.num("sss")
    // layer 8 «матовое олово»: +0.3·rain, unless the palette already folded rain into roughness
    let rough = pal.seaRoughness + max(0, 0.3 - pal.num("sea.roughnessRain")) * rain
    o.seaA = SIMD4<Float>(Float(pal.num("sea.detail")), Float(pal.num("sea.whitecaps")),
                          Float(pal.num("sea.streaks")), Float(pal.num("sea.foamLines")))
    o.seaB = SIMD4<Float>(Float(rough), Float(sss), Float(clearing), Float(sunI))
    o.seaC = SIMD4<Float>(Float(cloudRefl), Float(cloudShadow), Float(shadowI), Float(glitter))
    let resid = 0.5 * clearing                        // max(features.residual = 0, 0.5·clearing)
    let bio = quality.oceanQ > 0 ? BootMath.smoothstep(0.5, 0.9, night) : 0   // bioluminescence 1 × night
    let glitExp = pal.num("glitterExp")
    let palGlitter = pal.num("glitter")
    let moonK: Double = (moonGlit > sunGlit || night > 0.5) ? 1 : 0
    let moonExp = palGlitter > 0 ? glitExp : 2400
    o.seaD = SIMD4<Float>(Float(glitExp + (moonExp - glitExp) * moonK),
                          Float(1.2 - (palGlitter > 0 ? 0.4 : 0.85) * moonK), Float(resid), Float(bio))
    // look-driven radiance: sun share of the light, exposure compensation (base exposure only)
    let lum: (SIMD3<Double>) -> Double = { c in 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z }
    let sunPart = sunI * max(sun.shadow.y, 0.05) * lum(pal.color("sun"))
    let ambPart = pal.num("ambientIntensity") * lum(pal.color("ambient"))
    let exposure = max(pal.num("exposure"), 0.05)
    let sunDisk = max(BootMath.smoothstep(0.6, 2.0, sunI) * (1 - 0.7 * rain), flash)
    o.lookK = SIMD4<Float>(Float(sunPart / max(sunPart + ambPart, 1e-4)), Float(1 / exposure), 0.9, Float(sunDisk))
    o.seaE = SIMD4<Float>(Float(max(windSpeed, 0.5)), Float(flash), Float(night), Float(pal.num("ambientIntensity")))
    o.frontB = SIMD4<Float>(0, 120, 0, 0)            // no spatial front in the bootstrap

    let stats = bank.stats
    o.hsEff = Float(stats.HsEff)
    o.jStats = SIMD4<Float>(Float(stats.K), Float(stats.sigma), Float(stats.crestNorm ?? 1), 0)

    // detail normal frames: fixed to the mission's base swell, sliding along the wind
    let ba = bank.baseAngle
    let b2 = ba + 37 * deg
    o.detRot = SIMD4<Float>(Float(cos(ba)), Float(sin(ba)), Float(cos(b2)), Float(sin(b2)))
    if dt > 0 && windSpeed > 0.05 {
      let wx = cos(windAngle), wz = sin(windAngle)
      detOff.x = (detOff.x - ((cos(ba) * wx + sin(ba) * wz) * 0.6 * dt) / 14).truncatingRemainder(dividingBy: 1)
      detOff.y = (detOff.y - ((-sin(ba) * wx + cos(ba) * wz) * 0.6 * dt) / 14).truncatingRemainder(dividingBy: 1)
      detOff.z = (detOff.z - ((cos(b2) * wx + sin(b2) * wz) * 1.1 * dt) / 5.5).truncatingRemainder(dividingBy: 1)
      detOff.w = (detOff.w - ((-sin(b2) * wx + cos(b2) * wz) * 1.1 * dt) / 5.5).truncatingRemainder(dividingBy: 1)
    }
    o.detOff = SIMD4<Float>(Float(detOff.x), Float(detOff.y), Float(detOff.z), Float(detOff.w))

    // streak frame follows the wind with hysteresis + 6 s cross-fade (patterns never slide)
    let angDiff = abs(atan2(sin(windAngle - streakA), cos(windAngle - streakA)))
    if streakMix == 0 && angDiff > 20 * deg {
      streakB = windAngle
      streakMix = 1e-4
    }
    if streakMix > 0 {
      streakMix = min(1, streakMix + dt / 6)
      if streakMix >= 1 {
        streakA = streakB
        streakMix = 0
      }
    }
    o.streakRot = SIMD4<Float>(Float(cos(streakA)), Float(sin(streakA)), Float(cos(streakB)), Float(sin(streakB)))
    o.streakMix = Float(streakMix)

    // ---- _lateUpload
    o.downwash = SIMD4<Float>(Float(downwash.x), Float(downwash.y), Float(downwash.z), Float(downwash.w))
    o.heliP = SIMD4<Float>(Float(heli.x), Float(heli.y), Float(heli.z), Float(heli.w))
    o.searchPos = toF(searchPos)
    o.searchDir = SIMD4<Float>(Float(searchDir.x), Float(searchDir.y), Float(searchDir.z), Float(searchCosOuter))
    o.searchI = Float(searchI)
    o.spotWater = 0.3
    return o
  }

  // ---- CPU mirrors for the GPU self-test (OceanSelftestTests), in plain SIMD types ----------------
  /// WaveBank.forward(p0): displaced position of the lagrangian point p0 = (px, pz).
  func forwardCPU(_ px: Double, _ pz: Double) -> SIMD3<Double> {
    let p = bank.forward(px, pz, 0)
    return SIMD3<Double>(p.x, p.y, p.z)
  }

  /// waves.js edgeFade(lx, lz) at LOCAL grid coordinates.
  func edgeFadeCPU(_ lx: Double, _ lz: Double) -> Double { bank.edgeFade(lx, lz) }

  /// ocean/grid.js snapQuantum(N) for the current quality.
  var snapQuantum: Double { snapQ }

  /// weather.js _updateSun(): north = −Z, east = +X, azimuth clockwise from north.
  static func sunDirections(_ pal: PaletteSnapshot) -> (visual: SIMD3<Double>, shadow: SIMD3<Double>) {
    let az = pal.angle("sunAz")
    let ev = pal.num("sunElev") * Double.pi / 180
    let es = pal.num("shadowElev") * Double.pi / 180
    let visual = SIMD3<Double>(sin(az) * cos(ev), sin(ev), -cos(az) * cos(ev))
    let shadow = SIMD3<Double>(sin(az) * cos(es), sin(es), -cos(az) * cos(es))
    return (simdNormalize(visual), simdNormalize(shadow))
  }
}

// ---- small helpers (bootstrap only) ---------------------------------------------------------------
enum BootMath {
  /// GLSL / three smoothstep(a, b, x) with the clamp (any edge order).
  static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
  }
}

func simdNormalize(_ v: SIMD3<Double>) -> SIMD3<Double> {
  let l = (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
  return l > 0 ? v / l : v
}

func toF(_ v: SIMD3<Double>) -> SIMD3<Float> { SIMD3<Float>(Float(v.x), Float(v.y), Float(v.z)) }
