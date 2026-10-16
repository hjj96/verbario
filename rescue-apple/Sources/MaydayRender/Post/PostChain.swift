// PostChain — Composite+Output (sceneHDR → post) and FinalPass (post → drawable)
// (PLAN §2.5 passes 6–7, D10, X3/X4). Bloom (pass 5) lands in M2; its strength is carried already.
import Foundation
import Metal
import MaydayShaderTypes

public final class PostChain {
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources
  public let drawableFormat: MTLPixelFormat

  public init(device: RenderDevice, cache: PipelineCache, look: LookResources, drawableFormat: MTLPixelFormat) {
    self.rd = device
    self.cache = cache
    self.look = look
    self.drawableFormat = drawableFormat
  }

  public func compositePipeline() throws -> MTLRenderPipelineState {
    try cache.render(key: "composite_output") {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction("fullscreen_vs")
      d.fragmentFunction = try rd.makeFunction("composite_output_fs")
      d.colorAttachments[0].pixelFormat = RenderTargets.postFormat
      d.rasterSampleCount = 1
      return d
    }
  }

  public func finalPipeline() throws -> MTLRenderPipelineState {
    let format = drawableFormat
    return try cache.render(key: "final[\(format.rawValue)]") {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction("fullscreen_vs")
      d.fragmentFunction = try rd.makeFunction("final_fs")
      d.colorAttachments[0].pixelFormat = format
      d.rasterSampleCount = 1
      return d
    }
  }

  /// post = sRGB_OETF(ACES(exposure · sceneHDR)) over the scene's viewport sub-rectangle.
  public func encodeComposite(_ cb: MTLCommandBuffer, pipeline pso: MTLRenderPipelineState, targets: RenderTargets,
                              viewport: MTLViewport, ring: FrameRing, exposure: Float, bloomStrength: Float) {
    var u = MDOutputUniforms()
    u.params = SIMD4<Float>(exposure, bloomStrength,
                            Float(viewport.width) / Float(targets.width), Float(viewport.height) / Float(targets.height))
    let off = ring.push(u)
    guard let enc = cb.makeRenderCommandEncoder(descriptor: targets.postPassDescriptor()) else { return }
    enc.label = FramePass.compositeOutput.label
    enc.setViewport(viewport)
    enc.setRenderPipelineState(pso)
    enc.setFragmentTexture(targets.sceneHDR, index: Int(MD_TEX_SOURCE))
    enc.setFragmentBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    enc.endEncoding()
  }

  /// FinalPass into `target` (the drawable), full target viewport.
  public func encodeFinal(_ cb: MTLCommandBuffer, pipeline pso: MTLRenderPipelineState, target: MTLTexture,
                          source: RenderTargets, sourceViewport: MTLViewport, ring: FrameRing,
                          input f: FinalInput, pxScale: Float) {
    let w = Float(target.width)
    let h = Float(target.height)
    let sx = Float(sourceViewport.width) / Float(source.width)
    let sy = Float(sourceViewport.height) / Float(source.height)
    var u = MDFinalUniforms()
    u.resPxSeed = SIMD4<Float>(w, h, pxScale, f.seed)
    u.gridFlow = SIMD4<Float>(f.grid.x, f.grid.y, f.flow.x, f.flow.y)
    u.lens = SIMD4<Float>(f.drops, f.refr, f.condense, f.salt)
    // uCA is in pixels of the web's drawing buffer (= our internal size); the native FinalPass runs at
    // drawable resolution, so convert to drawable pixels to keep the same fringe width on screen.
    let caPx = f.ca * h / Float(max(1, source.height))
    u.caFlashVortexBright = SIMD4<Float>(caPx, f.flash, f.vortex, f.bright)
    u.flashTintSatMul = SIMD4<Float>(f.flashTint.x, f.flashTint.y, f.flashTint.z, f.satMul)
    u.edge = f.edge
    u.slopePower = SIMD4<Float>(f.slope.x, f.slope.y, f.slope.z, f.power)
    u.offsetContrast = SIMD4<Float>(f.offset.x, f.offset.y, f.offset.z, f.contrast)
    u.splitShadowSat = SIMD4<Float>(f.splitShadow.x, f.splitShadow.y, f.splitShadow.z, f.sat)
    u.splitHighStrength = SIMD4<Float>(f.splitHighlight.x, f.splitHighlight.y, f.splitHighlight.z, f.splitStrength)
    u.vignetteColorAmount = SIMD4<Float>(f.vignetteColor.x, f.vignetteColor.y, f.vignetteColor.z, f.vignette)
    u.greenGrainNightLb = SIMD4<Float>(f.green, f.grain, f.night, f.letterbox)
    u.toeFloorLookMixSat = SIMD4<Float>(f.dayToe, f.blackFloor, f.lookMix, f.lookSat)
    u.dof = SIMD4<Float>(f.dof, f.dofFocus, f.dofBand, f.dofTaps)
    u.lookThermal = SIMD4<Float>(f.lookContrast, f.lookFade, f.thermal, f.thermBoot)
    u.lookShadowFlick = SIMD4<Float>(f.lookShadow.x, f.lookShadow.y, f.lookShadow.z, f.thermFlick)
    u.lookHighThermT = SIMD4<Float>(f.lookHigh.x, f.lookHigh.y, f.lookHigh.z, f.thermT)
    // bilinear taps stay inside the rendered sub-rect: max uv = (size − ½ texel) / texture size
    u.source = SIMD4<Float>(sx, sy,
                            (Float(sourceViewport.width) - 0.5) / Float(source.width),
                            (Float(sourceViewport.height) - 0.5) / Float(source.height))
    let off = ring.push(u)

    let rp = MTLRenderPassDescriptor()
    rp.colorAttachments[0].texture = target
    rp.colorAttachments[0].loadAction = .dontCare
    rp.colorAttachments[0].storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
    enc.label = FramePass.final.label
    enc.setViewport(MTLViewport(originX: 0, originY: 0, width: Double(target.width), height: Double(target.height), znear: 0, zfar: 1))
    enc.setRenderPipelineState(pso)
    enc.setFragmentBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
    enc.setFragmentTexture(source.post, index: Int(MD_TEX_SOURCE))
    enc.setFragmentTexture(look.blackRGBA16F, index: Int(MD_TEX_DROPS))   // LensDrops grid: M2
    enc.setFragmentTexture(look.blackRGBA16F, index: Int(MD_TEX_HEAT))    // thermal heat pass: M3
    enc.setFragmentSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    enc.endEncoding()
  }
}
