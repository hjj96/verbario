// ShadowPass — the sun's shadow map (PLAN §2.5 pass 2 «Тени», D8): one depth32Float map of
// 512 / 1024 / 2048 texels (weather/lights.js MAP_SIZE by quality), rendered from the orthographic shadow
// camera of SunRig / ShadowCamera (box 250 m, texel-snapped), cleared to depth 1 every frame like
// WebGLShadowMap (setRenderTarget + clear), sampled by receivers through Common/Shadow.h with the
// compare sampler below (LessEqual, linear = 2×2 hardware PCF like WebGL, clamp to edge).
// Casters: render families implement RenderFamily.encodeShadow and draw their castShadow items
// (layers main, plus shadowOnly on high) with depthPipeline(…) or their own depth functions.
import Foundation
import Metal
import simd
import MaydayCore
import MaydayShaderTypes

/// What a family needs to encode its shadow casters.
public struct ShadowPassContext {
  public let ring: FrameRing
  /// MDShadowPassUniforms in the ring: bind at MD_BUF_PASS (vertex) — already bound by the pass.
  public let passOffset: Int
  /// three shadow.camera.layers: main, plus shadowOnly (rotor blades) on high.
  public let layers: RenderLayers
  /// Shadow camera frustum (WebGL clip planes) for three's per-object culling in the shadow pass.
  public let frustum: Frustum
  public let mapSize: Int
}

public final class ShadowPass {
  public static let depthFormat: MTLPixelFormat = .depth32Float
  private let rd: RenderDevice
  private let cache: PipelineCache
  public private(set) var map: MTLTexture?
  public let compareSampler: MTLSamplerState
  private let depthState: MTLDepthStencilState

  public init(device rd: RenderDevice, cache: PipelineCache) throws {
    self.rd = rd
    self.cache = cache
    let d = MTLSamplerDescriptor()
    d.sAddressMode = .clampToEdge
    d.tAddressMode = .clampToEdge
    d.minFilter = .linear
    d.magFilter = .linear
    d.mipFilter = .notMipmapped
    d.compareFunction = .lessEqual
    d.label = "shadowCompare"
    guard let s = rd.device.makeSamplerState(descriptor: d) else { throw RenderError.resource("shadow sampler") }
    compareSampler = s
    guard let ds = cache.depth(compare: .lessEqual, write: true) else { throw RenderError.resource("shadow depth state") }
    depthState = ds
  }

  /// (Re)allocates the map when the quality's size changes (WeatherLights.applyQuality disposes it).
  @discardableResult
  public func ensureMap(size: Int) throws -> MTLTexture {
    if let m = map, m.width == size { return m }
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: ShadowPass.depthFormat, width: size, height: size, mipmapped: false)
    d.usage = [.renderTarget, .shaderRead]
    d.storageMode = .private
    guard let t = rd.device.makeTexture(descriptor: d) else { throw RenderError.resource("shadow map \(size)") }
    t.label = "weather.sun.shadowMap"
    map = t
    return t
  }

  /// Depth-only PSO for plain (MDObjectData) or instanced meshes with the given vertex layout.
  public func depthPipeline(vertexDescriptor: MTLVertexDescriptor, layoutKey: String, instanced: Bool) throws -> MTLRenderPipelineState {
    let key = "shadow_depth[\(layoutKey)\(instanced ? ",inst" : "")]"
    return try cache.render(key: key) {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction(instanced ? "shadow_depth_instanced_vs" : "shadow_depth_vs")
      d.fragmentFunction = nil
      d.vertexDescriptor = vertexDescriptor
      d.depthAttachmentPixelFormat = ShadowPass.depthFormat
      d.rasterSampleCount = 1
      return d
    }
  }

  /// WebGLShadowMap material side swap for PCF maps: FrontSide → BackSide, BackSide → FrontSide.
  public static func cullMode(for side: FaceCulling) -> MTLCullMode {
    switch side {
    case .back: return .front    // FrontSide material: its back faces go into the map
    case .front: return .back    // BackSide material
    case .none: return .none     // DoubleSide
    }
  }

  /// Shadow camera viewProj for the casters: glToMetal × projection × matrixWorldInverse (Float).
  public static func passUniforms(_ cam: ShadowCamera) -> MDShadowPassUniforms {
    var u = MDShadowPassUniforms()
    u.viewProj = ShadowPass.metalViewProjection(cam)
    return u
  }

  static func metalViewProjection(_ cam: ShadowCamera) -> simd_float4x4 {
    var m = cam.viewProjection
    m.premultiply(Mat4(1, 0, 0, 0,
                       0, 1, 0, 0,
                       0, 0, 0.5, 0.5,
                       0, 0, 0, 1))                      // glToMetal: z' = 0.5·z + 0.5·w
    return ShadowPass.toFloat(m)
  }

  /// Receiver matrix (MDLightsUniforms.shadowMatrix): three's shadow.matrix with v flipped to Metal
  /// texture rows (u, w − v, z, w): the same texel under the same world point (Common/Shadow.h).
  public static func receiverMatrix(_ cam: ShadowCamera) -> simd_float4x4 {
    var m = cam.shadowMatrix
    m.premultiply(Mat4(1, 0, 0, 0,
                       0, -1, 0, 1,
                       0, 0, 1, 0,
                       0, 0, 0, 1))
    return ShadowPass.toFloat(m)
  }

  static func toFloat(_ m: Mat4) -> simd_float4x4 {
    simd_float4x4(columns: (SIMD4<Float>(Float(m[0]), Float(m[1]), Float(m[2]), Float(m[3])),
                            SIMD4<Float>(Float(m[4]), Float(m[5]), Float(m[6]), Float(m[7])),
                            SIMD4<Float>(Float(m[8]), Float(m[9]), Float(m[10]), Float(m[11])),
                            SIMD4<Float>(Float(m[12]), Float(m[13]), Float(m[14]), Float(m[15]))))
  }

  /// Encodes the depth pass: clear to 1, then every caster family. Returns false when nothing was encoded.
  @discardableResult
  public func encode(_ cb: MTLCommandBuffer, camera: ShadowCamera, mapSize: Int, layers: RenderLayers, ring: FrameRing,
                     casters: [(MTLRenderCommandEncoder, ShadowPassContext) -> Void]) throws -> Bool {
    let map = try ensureMap(size: mapSize)
    let rp = MTLRenderPassDescriptor()
    let d = rp.depthAttachment!
    d.texture = map
    d.loadAction = .clear
    d.clearDepth = 1
    d.storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return false }
    enc.label = FramePass.shadow.label
    enc.setViewport(MTLViewport(originX: 0, originY: 0, width: Double(mapSize), height: Double(mapSize), znear: 0, zfar: 1))
    enc.setDepthStencilState(depthState)
    enc.setFrontFacing(.counterClockwise)
    let off = ring.push(ShadowPass.passUniforms(camera))
    enc.setVertexBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
    // three Frustum from the shadow camera's projScreenMatrix (WebGL clip), in Double
    let vp = camera.viewProjection
    let frustum = Frustum(viewProjGL: simd_double4x4(columns: (SIMD4<Double>(vp[0], vp[1], vp[2], vp[3]),
                                                               SIMD4<Double>(vp[4], vp[5], vp[6], vp[7]),
                                                               SIMD4<Double>(vp[8], vp[9], vp[10], vp[11]),
                                                               SIMD4<Double>(vp[12], vp[13], vp[14], vp[15]))))
    let ctx = ShadowPassContext(ring: ring, passOffset: off, layers: layers, frustum: frustum, mapSize: mapSize)
    for c in casters { c(enc, ctx) }
    enc.endEncoding()
    return true
  }
}
