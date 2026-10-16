// OceanSelftest — GPU side of rescue/src/systems/ocean/selftest.js: evaluates the shader's
// oceanVertex() (Shaders/Ocean/OceanCommon.h) at local grid points with a compute kernel, so tests
// (Tests/MaydayRenderTests/OceanSelftestTests.swift) and the debug menu can compare the rendered
// surface with the CPU WaveBank (pass: p99 |Δ| < 0.05 m, the web criterion).
import Foundation
import Metal
import MaydayShaderTypes

public final class OceanSelftest {
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources

  public init(device: RenderDevice, cache: PipelineCache, look: LookResources) {
    self.rd = device
    self.cache = cache
    self.look = look
  }

  /// points: LOCAL grid coordinates gl (= lagrangian p0 − uOffset). Returns (P.x, P.y, P.z, damp) per point.
  public func evaluate(points: [SIMD2<Float>], ocean: OceanFrameInput, quality: RenderQualityConfig) throws -> [SIMD4<Float>] {
    if points.isEmpty { return [] }
    let variant = OceanVariant(quality: quality, memoryBound: false)
    let pso = try OceanPipeline.selftest(cache: cache, device: rd, variant: variant)
    let dev = rd.device
    let n = points.count
    guard let inBuf = points.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let base = raw.baseAddress else { return nil }
      return dev.makeBuffer(bytes: base, length: raw.count, options: [.storageModeShared])
    }) else { throw RenderError.resource("selftest input") }
    guard let outBuf = dev.makeBuffer(length: n * MemoryLayout<SIMD4<Float>>.stride, options: [.storageModeShared]) else {
      throw RenderError.resource("selftest output")
    }
    var uniforms = OceanRenderer.pack(ocean)
    var count = UInt32(n)
    guard let cb = rd.queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else {
      throw RenderError.resource("selftest command buffer")
    }
    cb.label = "ocean.selftest"
    enc.setComputePipelineState(pso)
    enc.setBuffer(inBuf, offset: 0, index: Int(MD_BUF_VERTICES))
    enc.setBuffer(outBuf, offset: 0, index: Int(MD_BUF_OUTPUT))
    enc.setBytes(&uniforms, length: MemoryLayout<MDOceanUniforms>.stride, index: Int(MD_BUF_MATERIAL))
    enc.setBytes(&count, length: MemoryLayout<UInt32>.stride, index: Int(MD_BUF_PASS))
    enc.setTexture(look.coastPlaceholder, index: Int(MD_TEX_COAST))
    enc.setSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    let w = max(1, min(64, pso.maxTotalThreadsPerThreadgroup))
    let groups = (n + w - 1) / w
    enc.dispatchThreadgroups(MTLSize(width: groups, height: 1, depth: 1),
                             threadsPerThreadgroup: MTLSize(width: w, height: 1, depth: 1))
    enc.endEncoding()
    cb.commit()
    cb.waitUntilCompleted()
    if let e = cb.error { throw RenderError.resource("selftest: \(e.localizedDescription)") }
    let ptr = outBuf.contents().bindMemory(to: SIMD4<Float>.self, capacity: n)
    return Array(UnsafeBufferPointer(start: ptr, count: n))
  }
}
