// OceanUniformsCPU — every ocean-owned uniform of systems/ocean/material.js createOceanUniforms(), in its
// order and with its initial values, as OceanSim writes them (update → _updateLook / _packSplashes, and
// lateUpload → _lateUpload just before the ocean draws). Double where the web holds numbers / Vector /
// Color, Float where it holds Float32Arrays (wave bank, features, shoals, glints, splashes). Textures
// (uAtlas / uDetail / uLace from the look, uCoast, uMem) are the renderer's; `memOn` / `coastOn` tell it
// whether they are bound. The look's own uniforms (uTime, uWind, uRain …) live in Look.

public struct OceanUniformsCPU: Equatable, Sendable {
  // ---- waves & grid
  /// bank.uWaveA / uWaveB (Dx, Dz, k, a | b, phase, L, align per wave), copied at lateUpload.
  public var uWaveA: [Float]
  public var uWaveB: [Float]
  public var uOffset = V2()
  public var uGridStep: Double = 2.0 / 300
  public var uHsEff: Double = 1
  public var uShoalCount: Int = 0
  /// ≤ 8 × (x, z, radius, on)
  public var uShoals = [Float](repeating: 0, count: 32)
  // ---- coastline distance map (ocean/coast.js)
  public var uCoastWin = V4(0, 0, 1, 1)
  public var uCoastOn: Double = 0
  // ---- features + downwash
  public var uFeatCount: Int = 0
  public var uFeatA: [Float]
  public var uFeatB: [Float]
  public var uFeatC: [Float]
  public var uDownwash = V4(0, 0, 10, 0)
  // ---- palette (new THREE.Color() = white)
  public var uDeep = PaletteColor()
  public var uBody = PaletteColor()
  public var uCrest = PaletteColor()
  public var uShallow = PaletteColor()
  public var uFoamCol = PaletteColor()
  public var uSkyCol = PaletteColor()
  public var uFogCol = PaletteColor()
  public var uSunCol = PaletteColor()
  public var uSpecCol = PaletteColor()
  public var uAmbCol = PaletteColor()
  public var uShadowTint = PaletteColor()
  public var uFlashCol = PaletteColor()
  public var uSunDirV = V3(0, 1, 0)
  public var uSeaA = V4(0, 0, 0, 0)
  public var uSeaB = V4(0, 0, 0, 0)
  public var uSeaC = V4(0, 0, 0, 0)
  public var uSeaD = V4(600, 0, 0, 0)
  public var uSeaE = V4(3, 0, 0, 0)
  public var uJStats = V4(0.1, 0.5, 0, 0)
  public var uDetOff = V4(0, 0, 0, 0)
  public var uDetRot = V4(1, 0, 1, 0)
  public var uStreakRot = V4(1, 0, 1, 0)
  public var uStreakMix: Double = 0
  public var uHeliP = V4(0, 0, 100, 0)
  // ---- searchlight / glints / splashes
  public var uSearchPos = V3()
  public var uSearchDir = V4(0, -1, 0, 0.95)
  public var uSearchI: Double = 0
  public var uGlintCount: Int = 0
  /// ≤ MAX_GLINTS × (x, z, radius, intensity) / (r, g, b, ·); entries past the count keep stale values
  public var uGlints: [Float]
  public var uGlintCol: [Float]
  public var uSplashCount: Int = 0
  /// ≤ MAX_SPLASHES × (x, z, age, radius) / strength; entries past the count keep stale values
  public var uSplash: [Float]
  public var uSplashS: [Float]
  // ---- water memory
  /// uMem bound (a memory target exists)
  public var memOn = false
  public var uMemWin = V4(0, 0, 320, 0)
  public var uSunDirS = V3(0, 1, 0)
  /// share of the physical SpotLights on the water (layer 11 is look-driven)
  public var uSpotWater: Double = 0.3
  // ---- spatial weather front
  public var uFront = V4(0, 0, 1, 0)
  public var uFrontB = V4(0, 120, 0, 0)
  public var uPrevDeep = PaletteColor()
  public var uPrevBody = PaletteColor()
  public var uPrevCrest = PaletteColor()
  public var uPrevFoam = PaletteColor()
  public var uNextDeep = PaletteColor()
  public var uNextBody = PaletteColor()
  public var uNextCrest = PaletteColor()
  public var uNextFoam = PaletteColor()
  public var uPrevSea = V4(0, 0, 0, 0)
  public var uNextSea = V4(0, 0, 0, 0)
  public var uLookK = V4(0.5, 1, 0.9, 0)

  public init(maxWaves: Int, maxFeatures: Int, maxGlints: Int, maxSplashes: Int) {
    uWaveA = [Float](repeating: 0, count: maxWaves * 4)
    uWaveB = uWaveA
    uFeatA = [Float](repeating: 0, count: maxFeatures * 4)
    uFeatB = uFeatA
    uFeatC = uFeatA
    uGlints = [Float](repeating: 0, count: maxGlints * 4)
    uGlintCol = uGlints
    uSplash = [Float](repeating: 0, count: maxSplashes * 4)
    uSplashS = [Float](repeating: 0, count: maxSplashes)
  }
}
