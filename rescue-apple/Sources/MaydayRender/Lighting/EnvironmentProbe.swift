// EnvironmentProbe — scene.environment of the web (PLAN §2.5 «IBL», D9; §2.9 weather/env.js row):
// weather/env.js bakes a tiny analytic sky (gradient sphere, sun disc, three soft clouds) with
// three r185 PMREMGenerator.fromScene(scene, 0, 0.1, 50, { size: 128 }) into a HalfFloat cube-UV atlas
// that every MeshStandardMaterial without its own envMap samples through textureCubeUV (Common/IBL.h).
// Here the same atlas (384 × 512 rgba16Float, GL row order) is produced by compute kernels:
//   1. env_sky_kernel   — lod 0: the six 128² cube-camera faces (_sceneToCubeUV);
//   2. pmrem_ggx_kernel — lods 1 … 9 (64, 32, 16, then six 16² extra lods), two dispatches each
//      (GGX filter into the ping-pong atlas, then the roughness-0 copy back), _applyGGXFilter.
// The bake is cheap (≈ 41 k texels × 256 GGX taps) but the web only re-bakes on demand; EnvRebakePolicy
// is its schedule (WeatherEnv.update). The ocean never samples it (envMapIntensity 0, analytic sky).
import Foundation
import Metal
import MaydayCore
import MaydayShaderTypes

/// weather/env.js uniforms of one bake (WeatherEnv.bake): palette colours LINEAR.
public struct EnvSkyParams: Equatable {
  public var sky = SIMD3<Float>(0, 0, 0)          // palette.sky
  public var fog = SIMD3<Float>(0, 0, 0)          // palette.fogColor
  public var deep = SIMD3<Float>(0, 0, 0)         // palette.deep
  public var sunDir = SIMD3<Float>(0, 1, 0)       // weather.state.sunDirVisual (normalised by the shader)
  public var sunColor = SIMD3<Float>(0, 0, 0)     // palette.sun
  public var sunIntensity: Float = 1              // palette.sunIntensity
  public var cloud: Float = 0.5                   // clamp(0.25 + 0.6·fog + 0.4·scud, 0, 1)

  public init() {}

  public init(sky: SIMD3<Float>, fog: SIMD3<Float>, deep: SIMD3<Float>, sunDir: SIMD3<Float>,
              sunColor: SIMD3<Float>, sunIntensity: Float, cloud: Float) {
    self.sky = sky
    self.fog = fog
    self.deep = deep
    self.sunDir = sunDir
    self.sunColor = sunColor
    self.sunIntensity = sunIntensity
    self.cloud = cloud
  }

  /// WeatherEnv.bake: uCloud = THREE.MathUtils.clamp(0.25 + 0.6 · p.fog + 0.4 · p.scud, 0, 1).
  public static func cloud(fog: Double, scud: Double) -> Double {
    let v = 0.25 + 0.6 * fog + 0.4 * scud
    return JS.max(0, JS.min(1, v))
  }

  /// The bake inputs of a MaydayCore palette (WeatherEnv.bake copies them straight from st.palette).
  public init(palette p: Palette, sunDirVisual: V3) {
    func f(_ c: PaletteColor) -> SIMD3<Float> { SIMD3<Float>(Float(c.r), Float(c.g), Float(c.b)) }
    self.init(sky: f(p.sky), fog: f(p.fogColor), deep: f(p.deep),
              sunDir: SIMD3<Float>(Float(sunDirVisual.x), Float(sunDirVisual.y), Float(sunDirVisual.z)),
              sunColor: f(p.sun), sunIntensity: Float(p.sunIntensity),
              cloud: Float(EnvSkyParams.cloud(fog: p.fog, scud: p.scud)))
  }

  var uniforms: MDEnvSkyUniforms {
    var u = MDEnvSkyUniforms()
    u.uSky = SIMD4<Float>(sky.x, sky.y, sky.z, 0)
    u.uFog = SIMD4<Float>(fog.x, fog.y, fog.z, 0)
    u.uDeep = SIMD4<Float>(deep.x, deep.y, deep.z, 0)
    u.uSunDir = SIMD4<Float>(sunDir.x, sunDir.y, sunDir.z, sunIntensity)
    u.uSunColor = SIMD4<Float>(sunColor.x, sunColor.y, sunColor.z, cloud)
    return u
  }
}

/// WeatherEnv.update's bake schedule (weather/env.js): bake when marked dirty (start / end of a
/// transition), otherwise at most once every 4 s while a transition runs — and never in a flash frame
/// (flashes light props through scene.environmentIntensity instead). Clock = weather time (game s).
public struct EnvRebakePolicy: Equatable {
  public private(set) var lastBake: Double = -99
  public private(set) var dirty = true

  public init() {}

  /// markDirty(): force a bake on the next eligible frame.
  public mutating func markDirty() { dirty = true }

  /// One WeatherEnv.update(clock, st, transitioning) decision: true = bake this frame.
  public mutating func update(clock: Double, flash: Double, transitioning: Bool) -> Bool {
    if flash > 0.01 { return false }
    let due = dirty || (transitioning && clock - lastBake >= 4)
    if !due { return false }
    lastBake = clock
    dirty = false
    return true
  }

  /// scene.environmentIntensity = palette.envIntensity · (1 + 3 · flash), set every frame.
  public static func environmentIntensity(envIntensity: Double, flash: Double) -> Double {
    envIntensity * (1 + 3 * flash)
  }
}

/// One filtered lod of PMREMGenerator._applyGGXFilter(cubeUV, n − 1, n).
public struct PmremLod: Equatable {
  public let index: Int          // n (1 … 9)
  public let size: Int           // sizeLods[n] (face size f)
  public let x: Int              // viewport x (atlas texels)
  public let y: Int              // viewport y (GL rows from the bottom)
  public let roughness: Double   // √(l² − c²) · (0 + 1.25 · l), l = n / 9, c = (n − 1) / 9
  public let sourceMip: Double   // mipInt of pass 1 (lodMax − (n − 1))
  public let targetMip: Double   // mipInt of pass 2 (lodMax − n)
}

public final class EnvironmentProbe {
  /// The cube-UV atlas sampled at MD_TEX_ENV (valid once `baked`).
  public let atlas: MTLTexture
  private let pingPong: MTLTexture
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources
  public private(set) var baked = false
  public private(set) var bakeCount = 0
  public private(set) var lastParams: EnvSkyParams?

  public static let lods: [PmremLod] = EnvironmentProbe.makeLods(cubeSize: Int(MD_CUBEUV_SIZE))

  public init(device rd: RenderDevice, cache: PipelineCache, look: LookResources) throws {
    self.rd = rd
    self.cache = cache
    self.look = look
    func make(_ label: String) throws -> MTLTexture {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: Int(MD_CUBEUV_WIDTH),
                                                       height: Int(MD_CUBEUV_HEIGHT), mipmapped: false)
      d.usage = [.shaderRead, .shaderWrite]
      d.storageMode = .private
      guard let t = rd.device.makeTexture(descriptor: d) else { throw RenderError.resource(label) }
      t.label = label
      return t
    }
    atlas = try make("PMREM.cubeUv")
    pingPong = try make("PMREM.pingPong")
  }

  /// PMREMGenerator._setSize / _createPlanes / _applyGGXFilter geometry for fromScene(…, { size }).
  public static func makeLods(cubeSize size: Int) -> [PmremLod] {
    var lodMax = 0                                                       // Math.floor(Math.log2(size))
    while (1 << (lodMax + 1)) <= size { lodMax += 1 }
    let cubeSize = 1 << lodMax                                           // Math.pow(2, lodMax)
    let lodMin = 4
    let extra = 6                                                        // EXTRA_LOD_SIGMA.length
    let total = lodMax - lodMin + 1 + extra
    var sizeLods: [Int] = []
    var lod = lodMax
    for _ in 0..<total {
      sizeLods.append(1 << lod)
      if lod > lodMin { lod -= 1 }
    }
    var out: [PmremLod] = []
    let last = Double(total - 1)
    for n in 1..<total {
      let l = Double(n) / last
      let c = Double(n - 1) / last
      let d = JS.sqrt(l * l - c * c) * (0 + 1.25 * l)
      let f = sizeLods[n]
      let x = 3 * f * (n > lodMax - lodMin ? n - lodMax + lodMin : 0)
      let y = 4 * (cubeSize - f)
      out.append(PmremLod(index: n, size: f, x: x, y: y, roughness: d,
                          sourceMip: Double(lodMax - (n - 1)), targetMip: Double(lodMax - n)))
    }
    return out
  }

  func pipelines() throws -> (sky: MTLComputePipelineState, ggx: MTLComputePipelineState) {
    let sky = try cache.compute(key: "env_sky") { try rd.makeFunction("env_sky_kernel") }
    let ggx = try cache.compute(key: "pmrem_ggx") { try rd.makeFunction("pmrem_ggx_kernel") }
    return (sky, ggx)
  }

  private static func dispatch(_ enc: MTLComputeCommandEncoder, _ pso: MTLComputePipelineState, width: Int, height: Int) {
    let tw = max(1, min(8, pso.threadExecutionWidth))
    let th = max(1, min(8, pso.maxTotalThreadsPerThreadgroup / tw))
    enc.dispatchThreadgroups(MTLSize(width: (width + tw - 1) / tw, height: (height + th - 1) / th, depth: 1),
                             threadsPerThreadgroup: MTLSize(width: tw, height: th, depth: 1))
  }

  /// Encodes one full bake (lod 0 sky + 9 GGX lods). Pipelines are compiled before the encoder opens.
  public func encodeBake(_ cb: MTLCommandBuffer, params: EnvSkyParams) throws {
    let pso = try pipelines()
    guard let enc = cb.makeComputeCommandEncoder() else { throw RenderError.resource("env bake encoder") }
    enc.label = FramePass.envRebake.label
    var sky = params.uniforms
    enc.setComputePipelineState(pso.sky)
    enc.setTexture(atlas, index: Int(MD_TEX_OUTPUT))
    enc.setBytes(&sky, length: MemoryLayout<MDEnvSkyUniforms>.stride, index: Int(MD_BUF_PASS))
    let size = Int(MD_CUBEUV_SIZE)
    EnvironmentProbe.dispatch(enc, pso.sky, width: 3 * size, height: 2 * size)
    enc.setComputePipelineState(pso.ggx)
    enc.setSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    for lod in EnvironmentProbe.lods {
      let region = SIMD4<Float>(Float(lod.x), Float(lod.y), Float(lod.size), 0)
      // 1. GGX filter of lod n − 1 → ping-pong
      var u1 = MDPmremUniforms(region: region, params: SIMD4<Float>(Float(lod.roughness), Float(lod.sourceMip), 0, 0))
      enc.setTexture(atlas, index: Int(MD_TEX_SOURCE))
      enc.setTexture(pingPong, index: Int(MD_TEX_OUTPUT))
      enc.setBytes(&u1, length: MemoryLayout<MDPmremUniforms>.stride, index: Int(MD_BUF_PASS))
      EnvironmentProbe.dispatch(enc, pso.ggx, width: 3 * lod.size, height: 2 * lod.size)
      // 2. roughness 0: bilinear copy back into the atlas (border texels re-read across face seams)
      var u2 = MDPmremUniforms(region: region, params: SIMD4<Float>(0, Float(lod.targetMip), 0, 0))
      enc.setTexture(pingPong, index: Int(MD_TEX_SOURCE))
      enc.setTexture(atlas, index: Int(MD_TEX_OUTPUT))
      enc.setBytes(&u2, length: MemoryLayout<MDPmremUniforms>.stride, index: Int(MD_BUF_PASS))
      EnvironmentProbe.dispatch(enc, pso.ggx, width: 3 * lod.size, height: 2 * lod.size)
    }
    enc.endEncoding()
    baked = true
    bakeCount += 1
    lastParams = params
  }
}
