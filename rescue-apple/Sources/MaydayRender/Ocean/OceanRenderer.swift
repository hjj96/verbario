// OceanRenderer — draws the sea (PLAN §2.9 systems/ocean.js row; R/Ocean/OceanRenderer.swift).
// Owns the per-quality grid meshes, the coastline map texture (coast.js bake → r8Unorm, uploaded when
// the map changes) and packs OceanFrameInput (the OceanUniformsCPU snapshot) into MDOceanUniforms.
// Mesh: renderOrder 10 (after props, for early-z), receiveShadow, never culled. The water memory
// (WaterMemoryPass) and the sun's shadow map are bound when present (function constants OCEAN_MEMORY /
// MD_FC_SHADOWS select the variant, like oceanDefines + USE_SHADOWMAP).
import Foundation
import Metal
import MaydayCore
import MaydayShaderTypes

public final class OceanRenderer {
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources
  private let constants: WaveConstants
  private var meshes: [Int: OceanGridBuffers] = [:]
  private let depthState: MTLDepthStencilState
  /// The uploaded coast map and the map it came from (nil = placeholder "far from any coast").
  private var coastTexture: MTLTexture?
  private var coastSource: CoastMap?

  public init(device: RenderDevice, cache: PipelineCache, look: LookResources, constants: WaveConstants) throws {
    self.rd = device
    self.cache = cache
    self.look = look
    self.constants = constants
    guard let ds = cache.depth(compare: .lessEqual, write: true) else { throw RenderError.resource("ocean depth state") }
    depthState = ds
  }

  public func mesh(n: Int) throws -> OceanGridBuffers {
    if let m = meshes[n] { return m }
    let m = try OceanGridBuffers(device: rd.device, n: n, constants: constants)
    meshes[n] = m
    return m
  }

  public func pipeline(quality: RenderQualityConfig, sampleCount: Int, memory: Bool = false,
                       shadows: Bool = false) throws -> MTLRenderPipelineState {
    try OceanPipeline.render(cache: cache, device: rd, variant: OceanVariant(quality: quality, memoryBound: memory, shadows: shadows),
                             sampleCount: sampleCount)
  }

  /// The coast texture to bind: uploads `map` (blit in `cb`) when it differs from the last upload.
  /// coast.js: R8 DataTexture, linear, clamp, no mips; row j = z0 + (j + .5)·cell (= GL row order).
  public func coastTexture(for map: CoastMap?, cb: MTLCommandBuffer) throws -> MTLTexture {
    guard let m = map else {
      coastSource = nil
      coastTexture = nil
      return look.coastPlaceholder
    }
    if let t = coastTexture, coastSource == m { return t }
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: m.w, height: m.h, mipmapped: false)
    d.usage = [.shaderRead]
    d.storageMode = .private
    guard let tex = rd.device.makeTexture(descriptor: d) else { throw RenderError.resource("ocean coast \(m.w)×\(m.h)") }
    tex.label = "ocean.coast"
    // rows padded to 4 bytes: the strictest buffer → texture copy alignment of the Apple GPU families
    let pitch = (m.w + 3) & ~3
    guard let staging = rd.device.makeBuffer(length: pitch * m.h, options: [.storageModeShared]) else {
      throw RenderError.resource("ocean coast staging")
    }
    let dst = staging.contents().bindMemory(to: UInt8.self, capacity: pitch * m.h)
    m.data.withUnsafeBufferPointer { src in
      for j in 0..<m.h {
        for i in 0..<m.w { dst[j * pitch + i] = src[j * m.w + i] }
      }
    }
    guard let blit = cb.makeBlitCommandEncoder() else { throw RenderError.resource("ocean coast blit") }
    blit.label = "ocean.coast.upload"
    blit.copy(from: staging, sourceOffset: 0, sourceBytesPerRow: pitch, sourceBytesPerImage: pitch * m.h,
              sourceSize: MTLSize(width: m.w, height: m.h, depth: 1), to: tex, destinationSlice: 0, destinationLevel: 0,
              destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.endEncoding()
    coastTexture = tex
    coastSource = m
    return tex
  }

  /// coast.js window for the shader: (x0, z0, 1 / (w·cell), 1 / (h·cell)); coastOn = 1.
  public static func coastWindow(_ m: CoastMap) -> SIMD4<Float> {
    SIMD4<Float>(Float(m.x0), Float(m.z0), Float(1 / (Double(m.w) * m.cell)), Float(1 / (Double(m.h) * m.cell)))
  }

  /// Pushes the frame's MDOceanUniforms (the memory window and coast state resolved) into the ring.
  public func pushUniforms(_ input: OceanFrameInput, ring: FrameRing, memoryWindow: SIMD4<Float>?) -> Int {
    var o = input
    if let w = memoryWindow { o.memWin = w } else { o.memWin.w = 0 }
    if let c = o.coast {
      o.coastWin = OceanRenderer.coastWindow(c)
      o.coastOn = 1
    }
    return ring.push(OceanRenderer.pack(o))
  }

  /// Textures and samplers the ocean draw binds besides the look set.
  public struct Bindings {
    public var coast: MTLTexture
    public var memory: MTLTexture?
    public var shadowMap: MTLTexture?
    public var shadowSampler: MTLSamplerState?
    public init(coast: MTLTexture, memory: MTLTexture?, shadowMap: MTLTexture?, shadowSampler: MTLSamplerState?) {
      self.coast = coast
      self.memory = memory
      self.shadowMap = shadowMap
      self.shadowSampler = shadowSampler
    }
  }

  /// Encodes the ocean draw. Frame / look / lights / ocean uniforms are already in the ring.
  public func encode(_ enc: MTLRenderCommandEncoder, pipeline pso: MTLRenderPipelineState, mesh: OceanGridBuffers,
                     ring: FrameRing, frameOffset: Int, lookOffset: Int, lightsOffset: Int, oceanOffset: Int,
                     bindings b: Bindings) {
    let buf = ring.buffer
    enc.pushDebugGroup("ocean")
    enc.setRenderPipelineState(pso)
    enc.setDepthStencilState(depthState)
    enc.setFrontFacing(.counterClockwise)
    enc.setCullMode(.back)                     // material side: FrontSide
    enc.setVertexBuffer(mesh.positions, offset: 0, index: Int(MD_BUF_VERTICES))
    enc.setVertexBuffer(buf, offset: frameOffset, index: Int(MD_BUF_FRAME))
    enc.setVertexBuffer(buf, offset: oceanOffset, index: Int(MD_BUF_MATERIAL))
    enc.setVertexBuffer(buf, offset: lightsOffset, index: Int(MD_BUF_LIGHTS))
    enc.setVertexTexture(b.coast, index: Int(MD_TEX_COAST))
    enc.setVertexSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    enc.setFragmentBuffer(buf, offset: frameOffset, index: Int(MD_BUF_FRAME))
    enc.setFragmentBuffer(buf, offset: lookOffset, index: Int(MD_BUF_LOOK))
    enc.setFragmentBuffer(buf, offset: lightsOffset, index: Int(MD_BUF_LIGHTS))
    enc.setFragmentBuffer(buf, offset: oceanOffset, index: Int(MD_BUF_MATERIAL))
    enc.setFragmentTexture(look.atlas, index: Int(MD_TEX_ATLAS))
    enc.setFragmentTexture(look.detail, index: Int(MD_TEX_DETAIL))
    enc.setFragmentTexture(look.lace, index: Int(MD_TEX_LACE))
    enc.setFragmentTexture(look.dfgLUT, index: Int(MD_TEX_DFG))
    enc.setFragmentTexture(b.coast, index: Int(MD_TEX_COAST))
    enc.setFragmentTexture(b.memory ?? look.blackRGBA16F, index: Int(MD_TEX_MEMORY))
    if let sm = b.shadowMap { enc.setFragmentTexture(sm, index: Int(MD_TEX_SHADOW)) }
    enc.setFragmentSamplerState(look.samplerLook, index: Int(MD_SMP_LOOK))
    enc.setFragmentSamplerState(look.samplerOcean, index: Int(MD_SMP_OCEAN))
    enc.setFragmentSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    if let ss = b.shadowSampler { enc.setFragmentSamplerState(ss, index: Int(MD_SMP_SHADOW)) }
    enc.drawIndexedPrimitives(type: .triangle, indexCount: mesh.indexCount, indexType: .uint32,
                              indexBuffer: mesh.indices, indexBufferOffset: 0)
    enc.popDebugGroup()
  }

  // ---- packing --------------------------------------------------------------------------------------

  /// Writes `values` into a C fixed array (imported as a homogeneous tuple of SIMD4<Float>).
  static func fill<Tuple>(_ tuple: inout Tuple, _ values: [SIMD4<Float>]) {
    withUnsafeMutableBytes(of: &tuple) { raw in
      let p = raw.bindMemory(to: SIMD4<Float>.self)
      let n = min(p.count, values.count)
      for i in 0..<n { p[i] = values[i] }
    }
  }

  static func v4(_ v: SIMD3<Float>, _ w: Float = 0) -> SIMD4<Float> { SIMD4<Float>(v.x, v.y, v.z, w) }

  public static func pack(_ o: OceanFrameInput) -> MDOceanUniforms {
    var u = MDOceanUniforms()
    fill(&u.uWaveA, o.waveA)
    fill(&u.uWaveB, o.waveB)
    let shoals = Array(o.shoals.prefix(Int(MD_MAX_SHOALS)))
    fill(&u.uShoals, shoals)
    let nf = min(o.featA.count, o.featB.count, o.featC.count, Int(MD_MAX_FEATURES))
    fill(&u.uFeatA, Array(o.featA.prefix(nf)))
    fill(&u.uFeatB, Array(o.featB.prefix(nf)))
    fill(&u.uFeatC, Array(o.featC.prefix(nf)))
    u.uDownwash = o.downwash
    u.uCoastWin = o.coastWin
    u.grid = SIMD4<Float>(o.offset.x, o.offset.y, o.gridStep, o.hsEff)
    u.uShoalCount = Int32(shoals.count)
    u.uFeatCount = Int32(nf)
    u.misc = SIMD4<Float>(o.coastOn, o.spotWater, o.searchI, o.streakMix)
    u.uDeep = v4(o.deep)
    u.uBody = v4(o.body)
    u.uCrest = v4(o.crest)
    u.uShallow = v4(o.shallow)
    u.uFoamCol = v4(o.foam)
    u.uSkyCol = v4(o.sky)
    u.uFogCol = v4(o.fogColor)
    u.uSunCol = v4(o.sun)
    u.uSpecCol = v4(o.spec)
    u.uAmbCol = v4(o.ambient)
    u.uShadowTint = v4(o.shadowTint)
    u.uFlashCol = v4(o.flashColor)
    u.uSunDirV = v4(o.sunDirV)
    u.uSunDirS = v4(o.sunDirS)
    u.uSeaA = o.seaA
    u.uSeaB = o.seaB
    u.uSeaC = o.seaC
    u.uSeaD = o.seaD
    u.uSeaE = o.seaE
    u.uJStats = o.jStats
    u.uDetOff = o.detOff
    u.uDetRot = o.detRot
    u.uStreakRot = o.streakRot
    u.uHeliP = o.heliP
    u.uSearchPos = v4(o.searchPos)
    u.uSearchDir = o.searchDir
    // glints: already sorted by intensity; the per-quality cap is the OCEAN_GLINTS constant
    let ng = min(o.glints.count, o.glintColors.count, Int(MD_MAX_GLINTS))
    fill(&u.uGlints, Array(o.glints.prefix(ng)))
    fill(&u.uGlintCol, o.glintColors.prefix(ng).map { v4($0) })
    u.uGlintCount = Int32(ng)
    let ns = min(o.splashes.count, o.splashStrengths.count, Int(MD_MAX_SPLASHES))
    fill(&u.uSplash, Array(o.splashes.prefix(ns)))
    var packed = [SIMD4<Float>](repeating: .zero, count: Int(MD_SPLASH_S_VEC4))
    for i in 0..<ns { packed[i >> 2][i & 3] = o.splashStrengths[i] }
    fill(&u.uSplashS, packed)
    u.uSplashCount = Int32(ns)
    u.uMemWin = o.memWin
    u.uFront = o.front
    u.uFrontB = o.frontB
    u.uPrevDeep = v4(o.prevDeep)
    u.uPrevBody = v4(o.prevBody)
    u.uPrevCrest = v4(o.prevCrest)
    u.uPrevFoam = v4(o.prevFoam)
    u.uNextDeep = v4(o.nextDeep)
    u.uNextBody = v4(o.nextBody)
    u.uNextCrest = v4(o.nextCrest)
    u.uNextFoam = v4(o.nextFoam)
    u.uPrevSea = o.prevSea
    u.uNextSea = o.nextSea
    u.uLookK = o.lookK
    return u
  }
}
