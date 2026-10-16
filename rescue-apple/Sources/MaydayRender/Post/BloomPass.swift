// BloomPass — three r185 UnrealBloomPass as post.js's ScaledBloomPass sets it up (PLAN §2.5 pass 5):
//   size      composer size × BLOOM_SCALE (high 1, medium/low 0.5; ≥ 4 px), then the pass halves again:
//             res_0 = round(size / 2), res_{i+1} = round(res_i / 2), 5 mips (Math.round = floor(x + ½));
//   high pass LuminosityHighPassShader, threshold per palette (× (1 + 5·flash)), smoothWidth 0.3;
//   blur      per mip H then V, KERNEL_RADIUS 6/10/14/18/22, coefficients 0.39894·exp(−½i²/σ²)/σ, σ = K/3,
//             invSize = 1 / res_i (the first blur of a mip reads the 2× larger previous mip bilinearly);
//   composite into horizontal[0]: 3·strength·Σ mix(f, 1.2 − f, radius)·tint·blur_i, f = 1, .8, .6, .4, .2.
// The final additive blend onto the scene happens inside the Composite+Output pass (Output.metal, X4).
// Targets are exact-size rgba16Float textures (three: HalfFloatType, LinearFilter, clamp), re-allocated
// when the dynamic-resolution viewport changes the composer size (≤ once per second).
import Foundation
import Metal
import MaydayCore
import MaydayShaderTypes

public final class BloomPass {
  public static let nMips = Int(MD_BLOOM_MIPS)
  public static let kernelSizeArray = [6, 10, 14, 18, 22]
  public static let bloomFactors: [Float] = [1.0, 0.8, 0.6, 0.4, 0.2]
  public static let smoothWidth: Float = 0.3            // ScaledBloomPass: soft knee instead of 0.01
  public static let format: MTLPixelFormat = .rgba16Float

  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources
  private var bright: MTLTexture?
  private var horizontal: [MTLTexture] = []
  private var vertical: [MTLTexture] = []
  public private(set) var sizes: [(width: Int, height: Int)] = []
  /// Precomputed Gaussian coefficients per mip (JS doubles → Float32 like the uniform upload).
  public static let coefficients: [[Float]] = kernelSizeArray.map { BloomPass.gaussianCoefficients(kernelRadius: $0) }

  public init(device rd: RenderDevice, cache: PipelineCache, look: LookResources) {
    self.rd = rd
    self.cache = cache
    self.look = look
  }

  /// UnrealBloomPass._getSeparableBlurMaterial coefficients (in JS double precision, then Float32).
  public static func gaussianCoefficients(kernelRadius: Int) -> [Float] {
    let sigma = Double(kernelRadius) / 3
    return (0..<kernelRadius).map { i in
      let x = Double(i)
      return Float(0.39894 * JS.exp(-0.5 * x * x / (sigma * sigma)) / sigma)
    }
  }

  /// Mip sizes for a composer (scene) size: ScaledBloomPass.setSize → UnrealBloomPass.setSize.
  public static func mipSizes(width: Int, height: Int, scale: Double) -> [(width: Int, height: Int)] {
    let w = JS.max(4, JS.round(Double(width) * scale))
    let h = JS.max(4, JS.round(Double(height) * scale))
    var resx = JS.round(w / 2)
    var resy = JS.round(h / 2)
    var out: [(width: Int, height: Int)] = []
    for _ in 0..<nMips {
      out.append((max(1, Int(resx)), max(1, Int(resy))))
      resx = JS.round(resx / 2)
      resy = JS.round(resy / 2)
    }
    return out
  }

  private func ensureTargets(_ s: [(width: Int, height: Int)]) throws {
    if sizes.count == s.count && zip(sizes, s).allSatisfy({ $0.0 == $1.0 && $0.1 == $1.1 }) { return }
    func make(_ w: Int, _ h: Int, _ label: String) throws -> MTLTexture {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: BloomPass.format, width: w, height: h, mipmapped: false)
      d.usage = [.renderTarget, .shaderRead]
      d.storageMode = .private
      guard let t = rd.device.makeTexture(descriptor: d) else { throw RenderError.resource(label) }
      t.label = label
      return t
    }
    bright = try make(s[0].width, s[0].height, "UnrealBloomPass.bright")
    horizontal = try s.enumerated().map { try make($0.element.width, $0.element.height, "UnrealBloomPass.h\($0.offset)") }
    vertical = try s.enumerated().map { try make($0.element.width, $0.element.height, "UnrealBloomPass.v\($0.offset)") }
    sizes = s
  }

  func pipelines() throws -> (high: MTLRenderPipelineState, blur: MTLRenderPipelineState, composite: MTLRenderPipelineState) {
    func make(_ fs: String) throws -> MTLRenderPipelineState {
      try cache.render(key: fs) {
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = try rd.makeFunction("fullscreen_vs")
        d.fragmentFunction = try rd.makeFunction(fs)
        d.colorAttachments[0].pixelFormat = BloomPass.format
        d.rasterSampleCount = 1
        return d
      }
    }
    return (try make("bloom_highpass_fs"), try make("bloom_blur_fs"), try make("bloom_composite_fs"))
  }

  private func pass(_ cb: MTLCommandBuffer, target: MTLTexture, label: String,
                    _ body: (MTLRenderCommandEncoder) -> Void) {
    let rp = MTLRenderPassDescriptor()
    rp.colorAttachments[0].texture = target
    rp.colorAttachments[0].loadAction = .dontCare   // every pass covers its whole target
    rp.colorAttachments[0].storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
    enc.label = label
    enc.setViewport(MTLViewport(originX: 0, originY: 0, width: Double(target.width), height: Double(target.height), znear: 0, zfar: 1))
    enc.setFragmentSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    body(enc)
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    enc.endEncoding()
  }

  /// Encodes the bloom chain for the scene drawn into the viewport sub-rect (vpW × vpH) of `scene`.
  /// Returns the composite (horizontal[0]) for Composite+Output.
  public func encode(_ cb: MTLCommandBuffer, ring: FrameRing, scene: MTLTexture, viewportWidth vpW: Int, viewportHeight vpH: Int,
                     scale: Double, strength: Float, radius: Float, threshold: Float) throws -> MTLTexture {
    let pso = try pipelines()
    try ensureTargets(BloomPass.mipSizes(width: vpW, height: vpH, scale: scale))
    guard let bright = bright else { throw RenderError.resource("bloom targets") }

    // 1. extract bright areas (reads the dynres sub-rect of the scene, clamped to its texel centres)
    var hp = MDBloomUniforms()
    hp.params = SIMD4<Float>(threshold, BloomPass.smoothWidth, 0, 0)
    hp.source = SIMD4<Float>(Float(vpW) / Float(scene.width), Float(vpH) / Float(scene.height),
                             (Float(vpW) - 0.5) / Float(scene.width), (Float(vpH) - 0.5) / Float(scene.height))
    let hpOff = ring.push(hp)
    pass(cb, target: bright, label: "bloom.highPass") { enc in
      enc.setRenderPipelineState(pso.high)
      enc.setFragmentBuffer(ring.buffer, offset: hpOff, index: Int(MD_BUF_PASS))
      enc.setFragmentTexture(scene, index: Int(MD_TEX_SOURCE))
    }

    // 2. blur all the mips progressively
    var input = bright
    for i in 0..<BloomPass.nMips {
      let s = sizes[i]
      let inv = SIMD2<Float>(Float(1 / Double(s.width)), Float(1 / Double(s.height)))
      for (dir, target, source) in [(SIMD2<Float>(1, 0), horizontal[i], input), (SIMD2<Float>(0, 1), vertical[i], horizontal[i])] {
        var u = MDBloomUniforms()
        u.invSizeDirection = SIMD4<Float>(inv.x, inv.y, dir.x, dir.y)
        u.params = SIMD4<Float>(0, 0, Float(BloomPass.kernelSizeArray[i]), 0)
        var packed = [SIMD4<Float>](repeating: .zero, count: Int(MD_BLOOM_MAX_KERNEL) / 4)
        for (k, c) in BloomPass.coefficients[i].enumerated() { packed[k >> 2][k & 3] = c }
        OceanRenderer.fill(&u.gaussianCoefficients, packed)
        let off = ring.push(u)
        pass(cb, target: target, label: "bloom.blur\(i)\(dir.x > 0 ? "H" : "V")") { enc in
          enc.setRenderPipelineState(pso.blur)
          enc.setFragmentBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
          enc.setFragmentTexture(source, index: Int(MD_TEX_SOURCE))
        }
      }
      input = vertical[i]
    }

    // 3. composite all the mips into horizontal[0]
    var c = MDBloomCompositeUniforms()
    c.strengthRadius = SIMD4<Float>(strength, radius, 0, 0)
    let f = BloomPass.bloomFactors
    c.bloomFactors0 = SIMD4<Float>(f[0], f[1], f[2], f[3])
    c.bloomFactors1 = SIMD4<Float>(f[4], 0, 0, 0)
    OceanRenderer.fill(&c.bloomTintColors, [SIMD4<Float>](repeating: SIMD4<Float>(1, 1, 1, 0), count: BloomPass.nMips))
    let cOff = ring.push(c)
    let composite = horizontal[0]
    let verticals = vertical
    pass(cb, target: composite, label: "bloom.composite") { enc in
      enc.setRenderPipelineState(pso.composite)
      enc.setFragmentBuffer(ring.buffer, offset: cOff, index: Int(MD_BUF_PASS))
      for (k, t) in verticals.enumerated() { enc.setFragmentTexture(t, index: Int(MD_TEX_BLUR0) + k) }
    }
    return composite
  }
}
