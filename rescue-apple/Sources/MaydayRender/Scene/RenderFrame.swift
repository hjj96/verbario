// RenderFrame — everything the renderer needs for one frame, produced by the simulation side
// (MaydayCore systems, or MaydayApp/Bootstrap until those land). Plain values only: the renderer
// never reads simulation objects (PLAN §1.3 «Core не знает о рендере», render reads snapshots).
//
// Units / spaces: metres, seconds; colours LINEAR (THREE.Color working space) unless noted;
// FinalInput colours are sRGB (post.js uploads display-space colours to the FinalPass).
import Foundation
import simd

/// Per-tier render configuration (ocean/waves.js QUALITY, post.js SAMPLES / MIN_SCALE).
public struct RenderQualityConfig: Equatable {
  public var name: String
  public var sampleCount: Int        // post.js SAMPLES: low 0 → 1, medium 2, high 4
  public var oceanGridN: Int         // 160 / 224 / 300
  public var oceanWaves: Int         // 4 / 6 / 8
  public var oceanQ: Int             // 0 / 1 / 2
  public var oceanGlints: Int        // 0 / 4 / 8
  public var oceanMemory: Int        // 0 / 384 / 512 (water memory size; pass not ported yet)
  public var minDynScale: Double     // post.js MIN_SCALE 0.67 / 0.75 / 0.8

  public init(name: String, sampleCount: Int, oceanGridN: Int, oceanWaves: Int, oceanQ: Int,
              oceanGlints: Int, oceanMemory: Int, minDynScale: Double) {
    self.name = name
    self.sampleCount = sampleCount
    self.oceanGridN = oceanGridN
    self.oceanWaves = oceanWaves
    self.oceanQ = oceanQ
    self.oceanGlints = oceanGlints
    self.oceanMemory = oceanMemory
    self.minDynScale = minDynScale
  }

  /// ocean/material.js oceanDefines: OCEAN_RAIN_LAYERS = q 2 → 2, q 1 → 1, else 0.
  public var oceanRainLayers: Int { oceanQ == 2 ? 2 : (oceanQ == 1 ? 1 : 0) }
}

/// core/look.js shared uniforms (weather writes them every frame).
public struct LookInput {
  public var time: Double = 0                    // uTime (game t)
  public var wind = SIMD2<Double>(0, 0)          // uWind m/s (x = world X, y = world Z)
  public var windOffset = SIMD2<Double>(0, 0)    // uWindOffset: integrated wind travel, m
  public var rain: Double = 0
  public var wet: Double = 0
  public var flash: Double = 0
  public var night: Double = 0
  /// ≤ 4 gust fronts: A = (x, z, dirX, dirZ), B = (strength m/s, width m, length m, 0).
  public var gustFrontsA = [SIMD4<Float>](repeating: SIMD4<Float>(0, 0, 1, 0), count: 4)
  public var gustFrontsB = [SIMD4<Float>](repeating: SIMD4<Float>(0, 140, 500, 0), count: 4)
  public init() {}
}

/// scene.fog (THREE.Fog, linear) patched by core/look.js.
public struct FogInput {
  public var color = SIMD3<Float>(0.7, 0.62, 0.5)
  public var near: Float = 260
  public var far: Float = 950
  public var enabled = true
  public init() {}
}

/// The CONTRACT light set; zero colour = light off.
public struct SpotLightInput {
  public var position = SIMD3<Float>(0, 0, 0)
  public var direction = SIMD3<Float>(0, -1, 0)   // from the light toward its target
  public var color = SIMD3<Float>(0, 0, 0)        // rgb × intensity
  public var distance: Float = 0
  public var decay: Float = 2
  public var coneCos: Float = 0.9
  public var penumbraCos: Float = 0.95
  public init() {}
}

public struct PointLightInput {
  public var position = SIMD3<Float>(0, 0, 0)
  public var color = SIMD3<Float>(0, 0, 0)        // rgb × intensity
  public var distance: Float = 0
  public var decay: Float = 2
  public init() {}
}

public struct LightsInput {
  public var sunDirection = SIMD3<Float>(0, 1, 0) // toward the sun (weather.state.sunDir)
  public var sunColor = SIMD3<Float>(0, 0, 0)     // palette.sun × sun.intensity
  public var hemiSky = SIMD3<Float>(0, 0, 0)      // palette.ambient × hemi.intensity
  public var hemiGround = SIMD3<Float>(0, 0, 0)   // palette.ambientGround × hemi.intensity
  public var ambient = SIMD3<Float>(0, 0, 0)
  public var environmentIntensity: Float = 1
  public var spots: [SpotLightInput] = []         // ≤ 2
  public var points: [PointLightInput] = []       // ≤ 6
  public init() {}
}

/// ocean/material.js uniforms as written by ocean.js (_updateLook, _lateUpload, bank, features).
/// Defaults = createOceanUniforms() initial values.
public struct OceanFrameInput {
  public var waveA = [SIMD4<Float>](repeating: .zero, count: 8)   // WaveBank.uWaveA: Dx, Dz, k, a
  public var waveB = [SIMD4<Float>](repeating: .zero, count: 8)   // WaveBank.uWaveB: b, phase, L, align
  public var offset = SIMD2<Float>(0, 0)                         // uOffset (snapped focus)
  public var gridStep: Float = 2.0 / 300.0
  public var hsEff: Float = 1
  public var shoals: [SIMD4<Float>] = []                         // ≤ 8 (x, z, r, on)
  public var coastWin = SIMD4<Float>(0, 0, 1, 1)
  public var coastOn: Float = 0
  public var featA: [SIMD4<Float>] = []                          // ≤ 4
  public var featB: [SIMD4<Float>] = []
  public var featC: [SIMD4<Float>] = []
  public var downwash = SIMD4<Float>(0, 0, 10, 0)
  public var deep = SIMD3<Float>(0, 0, 0)
  public var body = SIMD3<Float>(0, 0, 0)
  public var crest = SIMD3<Float>(0, 0, 0)
  public var shallow = SIMD3<Float>(0, 0, 0)
  public var foam = SIMD3<Float>(0, 0, 0)
  public var sky = SIMD3<Float>(0, 0, 0)
  public var fogColor = SIMD3<Float>(0, 0, 0)
  public var sun = SIMD3<Float>(0, 0, 0)
  public var spec = SIMD3<Float>(0, 0, 0)
  public var ambient = SIMD3<Float>(0, 0, 0)
  public var shadowTint = SIMD3<Float>(0, 0, 0)
  public var flashColor = SIMD3<Float>(0, 0, 0)
  public var sunDirV = SIMD3<Float>(0, 1, 0)
  public var sunDirS = SIMD3<Float>(0, 1, 0)
  public var seaA = SIMD4<Float>(0, 0, 0, 0)
  public var seaB = SIMD4<Float>(0, 0, 0, 0)
  public var seaC = SIMD4<Float>(0, 0, 0, 0)
  public var seaD = SIMD4<Float>(600, 0, 0, 0)
  public var seaE = SIMD4<Float>(3, 0, 0, 0)
  public var jStats = SIMD4<Float>(0.1, 0.5, 0, 0)
  public var detOff = SIMD4<Float>(0, 0, 0, 0)
  public var detRot = SIMD4<Float>(1, 0, 1, 0)
  public var streakRot = SIMD4<Float>(1, 0, 1, 0)
  public var streakMix: Float = 0
  public var heliP = SIMD4<Float>(0, 0, 100, 0)
  public var searchPos = SIMD3<Float>(0, 0, 0)
  public var searchDir = SIMD4<Float>(0, -1, 0, 0.95)
  public var searchI: Float = 0
  public var glints: [SIMD4<Float>] = []                         // ≤ 8 (x, z, radius, intensity), sorted
  public var glintColors: [SIMD3<Float>] = []
  public var splashes: [SIMD4<Float>] = []                       // ≤ 24 (x, z, age, radius)
  public var splashStrengths: [Float] = []
  public var memWin = SIMD4<Float>(0, 0, 320, 0)
  public var spotWater: Float = 0.3
  public var front = SIMD4<Float>(0, 0, 1, 0)
  public var frontB = SIMD4<Float>(0, 120, 0, 0)
  public var prevDeep = SIMD3<Float>(0, 0, 0)
  public var prevBody = SIMD3<Float>(0, 0, 0)
  public var prevCrest = SIMD3<Float>(0, 0, 0)
  public var prevFoam = SIMD3<Float>(0, 0, 0)
  public var nextDeep = SIMD3<Float>(0, 0, 0)
  public var nextBody = SIMD3<Float>(0, 0, 0)
  public var nextCrest = SIMD3<Float>(0, 0, 0)
  public var nextFoam = SIMD3<Float>(0, 0, 0)
  public var prevSea = SIMD4<Float>(0, 0, 0, 0)
  public var nextSea = SIMD4<Float>(0, 0, 0, 0)
  public var lookK = SIMD4<Float>(0.5, 1, 0.9, 0)
  public init() {}
}

/// post/finalShader.js uniforms (defaults = createFinalMaterial). Colours in sRGB.
public struct FinalInput {
  public var grid = SIMD2<Float>(28, 16)
  public var flow = SIMD2<Float>(0, -1)
  public var drops: Float = 0
  public var refr: Float = 0.018
  public var condense: Float = 0
  public var salt: Float = 0
  /// uCA in INTERNAL-resolution pixels (post.js: (P.ca + caKick) × drawingBufferHeight / 1080);
  /// PostChain rescales it to the drawable.
  public var ca: Float = 0.4
  public var flash: Float = 0
  public var flashTint = SIMD3<Float>(0.86, 0.9, 1)
  public var edge = SIMD4<Float>(0, 0, 0, 0)
  public var vortex: Float = 0
  public var bright: Float = 1
  public var satMul: Float = 1
  public var slope = SIMD3<Float>(1, 1, 1)
  public var offset = SIMD3<Float>(0, 0, 0)
  public var power: Float = 1
  public var contrast: Float = 1
  public var sat: Float = 1
  public var splitShadow = SIMD3<Float>(0.5, 0.5, 0.5)
  public var splitHighlight = SIMD3<Float>(0.5, 0.5, 0.5)
  public var splitStrength: Float = 0
  public var green: Float = 0
  public var vignette: Float = 0.2
  public var vignetteColor = SIMD3<Float>(0, 0, 0)
  public var grain: Float = 0.03
  public var night: Float = 0
  public var seed: Float = 0
  public var letterbox: Float = 0
  public var dayToe: Float = 0
  public var blackFloor: Float = 0.008           // uFloor
  public var dof: Float = 0
  public var dofFocus: Float = 0.5
  public var dofBand: Float = 0.08
  public var dofTaps: Float = 24
  public var lookMix: Float = 0
  public var lookSat: Float = 1
  public var lookContrast: Float = 1
  public var lookFade: Float = 0
  public var lookShadow = SIMD3<Float>(1, 1, 1)
  public var lookHigh = SIMD3<Float>(1, 1, 1)
  public var thermal: Float = 0
  public var thermBoot: Float = 0
  public var thermFlick: Float = 1
  public var thermT: Float = 0
  public init() {}
}

public struct PostInput {
  public var exposure: Float = 1                 // renderer.toneMappingExposure (post.js)
  public var bloomStrength: Float = 0            // M2
  public var finalPass = FinalInput()
  public init() {}
}

public struct RenderFrame {
  public var camera: CameraState
  public var look = LookInput()
  public var fog = FogInput()
  public var lights = LightsInput()
  public var ocean = OceanFrameInput()
  public var post = PostInput()
  public var quality: RenderQualityConfig
  /// Internal (scene) resolution in pixels — web pixel-ratio rule, computed by the host.
  public var internalWidth: Int
  public var internalHeight: Int
  /// Device pixels per point of the drawable (FinalPass uPxScale: grain / condensation cell size).
  public var pxScale: Float = 2
  public var realTime: Double = 0
  /// Dynamic resolution on/off (`-mayday.dynres NO` → off).
  public var dynamicResolution = true
  /// iOS present pacing (MTKView.preferredFramesPerSecond).
  public var framesPerSecond: Int = 60

  public init(camera: CameraState, quality: RenderQualityConfig, internalWidth: Int, internalHeight: Int) {
    self.camera = camera
    self.quality = quality
    self.internalWidth = internalWidth
    self.internalHeight = internalHeight
  }
}
