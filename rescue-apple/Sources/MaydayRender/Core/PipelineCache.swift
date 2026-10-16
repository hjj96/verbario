// PipelineCache — PSOs keyed by (family, function constants, formats, sample count, pass) (PLAN §2.5).
// M0 compiles synchronously on first use (the ocean + two post PSOs at boot); the async TaskGroup
// prewarm with ctx.warmup states (due → compiling → render → idle) replaces this in M2 (PLAN §3.5).
import Foundation
import Metal

public final class PipelineCache {
  private let rd: RenderDevice
  private var renderStates: [String: MTLRenderPipelineState] = [:]
  private var computeStates: [String: MTLComputePipelineState] = [:]
  private var depthStates: [String: MTLDepthStencilState] = [:]

  public init(device: RenderDevice) {
    self.rd = device
  }

  public func render(key: String, build: () throws -> MTLRenderPipelineDescriptor) throws -> MTLRenderPipelineState {
    if let s = renderStates[key] { return s }
    let desc = try build()
    desc.label = key
    let state: MTLRenderPipelineState
    do {
      state = try rd.device.makeRenderPipelineState(descriptor: desc)
    } catch {
      throw RenderError.pipeline("\(key): \(error.localizedDescription)")
    }
    renderStates[key] = state
    return state
  }

  public func compute(key: String, function: () throws -> MTLFunction) throws -> MTLComputePipelineState {
    if let s = computeStates[key] { return s }
    let f = try function()
    let state: MTLComputePipelineState
    do {
      state = try rd.device.makeComputePipelineState(function: f)
    } catch {
      throw RenderError.pipeline("\(key): \(error.localizedDescription)")
    }
    computeStates[key] = state
    return state
  }

  /// three defaults: depthTest LessEqual, depthWrite per material.
  public func depth(compare: MTLCompareFunction, write: Bool) -> MTLDepthStencilState? {
    let key = "\(compare.rawValue)/\(write)"
    if let s = depthStates[key] { return s }
    let d = MTLDepthStencilDescriptor()
    d.depthCompareFunction = compare
    d.isDepthWriteEnabled = write
    d.label = "depth \(key)"
    guard let s = rd.device.makeDepthStencilState(descriptor: d) else { return nil }
    depthStates[key] = s
    return s
  }
}
