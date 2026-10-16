// OceanPipeline — ocean PSO variants (PLAN §3.3 #2): function constants replace ocean/material.js
// oceanDefines (OCEAN_WAVES 4/6/8, OCEAN_Q 0/1/2, OCEAN_RAIN_LAYERS, OCEAN_GLINTS 0/4/8, OCEAN_MEMORY)
// plus USE_SHADOWMAP (the sun's shadow map bound: MD_FC_SHADOWS).
import Foundation
import Metal
import MaydayShaderTypes

public struct OceanVariant: Hashable, CustomStringConvertible {
  public var waves: Int
  public var q: Int
  public var rainLayers: Int
  public var glints: Int
  public var memory: Bool
  public var shadows: Bool

  public init(quality: RenderQualityConfig, memoryBound: Bool, shadows: Bool = false) {
    waves = quality.oceanWaves
    q = quality.oceanQ
    rainLayers = quality.oceanRainLayers
    glints = quality.oceanGlints
    memory = memoryBound
    self.shadows = shadows
  }

  public var description: String { "w\(waves)q\(q)r\(rainLayers)g\(glints)m\(memory ? 1 : 0)s\(shadows ? 1 : 0)" }

  public func functionConstants() -> MTLFunctionConstantValues {
    let fc = MTLFunctionConstantValues()
    var w = Int32(waves)
    var qq = Int32(q)
    var r = Int32(rainLayers)
    var g = Int32(glints)
    var m = memory
    var sh = shadows
    fc.setConstantValue(&w, type: .int, index: Int(MD_FC_OCEAN_WAVES))
    fc.setConstantValue(&qq, type: .int, index: Int(MD_FC_OCEAN_Q))
    fc.setConstantValue(&r, type: .int, index: Int(MD_FC_OCEAN_RAIN))
    fc.setConstantValue(&g, type: .int, index: Int(MD_FC_OCEAN_GLINTS))
    fc.setConstantValue(&m, type: .bool, index: Int(MD_FC_OCEAN_MEMORY))
    fc.setConstantValue(&sh, type: .bool, index: Int(MD_FC_SHADOWS))
    return fc
  }
}

enum OceanPipeline {
  static func render(cache: PipelineCache, device: RenderDevice, variant: OceanVariant, sampleCount: Int) throws -> MTLRenderPipelineState {
    let key = "ocean[\(variant)]x\(sampleCount)"
    return try cache.render(key: key) {
      let fc = variant.functionConstants()
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try device.makeFunction("ocean_vs", constants: fc)
      d.fragmentFunction = try device.makeFunction("ocean_fs", constants: fc)
      d.colorAttachments[0].pixelFormat = RenderTargets.hdrFormat
      d.depthAttachmentPixelFormat = RenderTargets.depthFormat
      d.rasterSampleCount = sampleCount
      return d
    }
  }

  static func selftest(cache: PipelineCache, device: RenderDevice, variant: OceanVariant) throws -> MTLComputePipelineState {
    let key = "ocean_selftest[\(variant)]"
    return try cache.compute(key: key) {
      try device.makeFunction("ocean_selftest_kernel", constants: variant.functionConstants())
    }
  }
}
