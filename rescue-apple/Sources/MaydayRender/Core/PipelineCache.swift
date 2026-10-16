// PipelineCache — PSOs keyed by (family, function constants, formats, sample count, pass) (PLAN §2.5).
// M0 compiles synchronously on first use (the ocean + two post PSOs at boot); the async TaskGroup
// prewarm with ctx.warmup states (due → compiling → render → idle) replaces this in M2 (PLAN §3.5).
// A key that failed (descriptor build or compile) is remembered with its error and rethrown without
// recompiling, so a broken PSO costs one compile, not one per frame; resetFailures() (called by
// Renderer.prewarm on boot / quality change) allows one fresh attempt.
import Foundation
import Metal

public final class PipelineCache {
  private let rd: RenderDevice
  private var renderStates: [String: MTLRenderPipelineState] = [:]
  private var computeStates: [String: MTLComputePipelineState] = [:]
  private var depthStates: [String: MTLDepthStencilState] = [:]
  private var failed: [String: Error] = [:]   // "render:<key>" / "compute:<key>" → first error

  public init(device: RenderDevice) {
    self.rd = device
  }

  /// Forgets remembered failures so the next request for those keys compiles again.
  public func resetFailures() {
    failed.removeAll()
  }

  public func render(key: String, build: () throws -> MTLRenderPipelineDescriptor) throws -> MTLRenderPipelineState {
    if let s = renderStates[key] { return s }
    let fkey = "render:" + key
    if let e = failed[fkey] { throw e }
    do {
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
    } catch {
      failed[fkey] = error
      throw error
    }
  }

  public func compute(key: String, function: () throws -> MTLFunction) throws -> MTLComputePipelineState {
    if let s = computeStates[key] { return s }
    let fkey = "compute:" + key
    if let e = failed[fkey] { throw e }
    do {
      let f = try function()
      let state: MTLComputePipelineState
      do {
        state = try rd.device.makeComputePipelineState(function: f)
      } catch {
        throw RenderError.pipeline("\(key): \(error.localizedDescription)")
      }
      computeStates[key] = state
      return state
    } catch {
      failed[fkey] = error
      throw error
    }
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
