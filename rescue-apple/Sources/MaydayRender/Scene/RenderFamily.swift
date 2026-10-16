// RenderFamily — the hook through which the scene's mesh families (props, the helicopter, survivors, FX …)
// join the fixed frame graph (PLAN §2.5 «Проходы кадра», §3.3): Renderer calls every registered family
// once per frame, in registration order, at three points:
//   prepare            before any encoder opens (upload per-frame data, compile PSOs — may throw);
//   encodeShadow       inside the sun's depth pass (castShadow items; ShadowPassContext.layers);
//   encodeOpaque /     inside the scene pass: opaque families, then the ocean (renderOrder 10, after props
//   encodeTransparent  for early-z), then transparent families (three's WebGLRenderList order inside a
//                      family is the family's job: DrawList.swift sorts like three).
// FrameContext carries the frame's uniform offsets in the ring (frame 2, look 3, lights 4 — bind them at
// MD_BUF_*), the camera, the sample count and the shared lighting resources (PMREM atlas once baked,
// the shadow map when bound, the compare sampler) so families can use ThreePBR.h / IBL.h / Shadow.h.
import Foundation
import Metal

public struct FrameContext {
  public let frame: RenderFrame
  public let ring: FrameRing
  public let frameOffset: Int
  public let lookOffset: Int
  public let lightsOffset: Int
  public let camera: CameraMatrices
  public let sampleCount: Int
  public let look: LookResources
  /// PMREM cube-UV atlas for MD_TEX_ENV (nil until the first bake).
  public let environment: MTLTexture?
  /// The sun's shadow map for MD_TEX_SHADOW (nil = no casters this frame: receivers use 1).
  public let shadowMap: MTLTexture?
  public let shadowSampler: MTLSamplerState
}

public protocol RenderFamily: AnyObject {
  /// True when the family has shadow casters this frame (the depth pass is skipped when none has).
  var castsShadows: Bool { get }
  func prepare(_ ctx: FrameContext) throws
  func encodeShadow(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext, pass: ShadowPassContext)
  func encodeOpaque(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext)
  func encodeTransparent(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext)
}

extension RenderFamily {
  public var castsShadows: Bool { false }
  public func prepare(_ ctx: FrameContext) throws {}
  public func encodeShadow(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext, pass: ShadowPassContext) {}
  public func encodeOpaque(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {}
  public func encodeTransparent(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {}
}
