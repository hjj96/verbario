// WaterMemoryPass — the render side of rescue/src/systems/ocean/memory.js (WaterMemory) (PLAN §2.5
// pass 1 «память воды», §2.9 ocean/memory.js row): two ping-pong rgba16Float targets (384 / 512 by
// quality) covering MEMORY_EXTENT = 320 m around the camera focus, re-centred by whole texels.
// update(): advect (wind drift + feature swirl, per-channel half-lives 3 / 240 / 0.8 / 600 s, dye
// diffusion) then the frame's instanced stamps (One/One additive), then swap — like WaterMemory.update.
// The CPU part of that method (texel snapping, decay factors) is WaterMemoryWindow, in Double with JS math.
// The game's queue is MaydayCore's WaterMemoryQueue (OceanSim): the app hands each new
// WaterMemoryQueue.Frame over as a WaterMemoryInput — stamps, the snapped centre as focus, wind, dt and the
// feature flow the advect reads (the ocean uniforms inside ocean.update, before the late upload). The window
// re-derived here from that centre is the queue's (applecheck harness: same advect floats); it follows what
// this texture actually holds, so a frame the renderer skipped never shifts it twice. WaterMemoryInput's own
// writers (push, stamp, splash, addWake, _autoStamps) build the render goldens' replays of the web's memory
// log; both halves are checked against the real memory.js / ocean.js (Tests/Goldens/ocean/memory.json,
// WaterMemoryGoldenTests).
import Foundation
import Metal
import MaydayCore
import MaydayShaderTypes

/// One water-memory stamp (WaterMemory.push arguments).
public struct WaterMemoryStamp: Equatable {
  public enum Shape: Float { case disc = 0, ring = 1, wake = 2 }   // memory.js SHAPE
  public var shape: Shape
  public var x: Double, z: Double, radius: Double, strength: Double
  public var foam: Double, dye: Double, disturbance: Double, oil: Double
  public var inner: Double = 0.7
  public var dirX: Double = 0, dirZ: Double = 1

  var gpu: MDMemoryStamp {
    MDMemoryStamp(aA: SIMD4<Float>(Float(x), Float(z), Float(radius), Float(strength)),
                  aB: SIMD4<Float>(Float(foam), Float(dye), Float(disturbance), Float(oil)),
                  aC: SIMD4<Float>(shape.rawValue, Float(inner), Float(dirX), Float(dirZ)))
  }
}

/// The frame's input to the memory pass (what ocean.js hands WaterMemory.update and push()).
public struct WaterMemoryInput {
  public static let MAX_STAMPS = Int(MD_MEMORY_MAX_STAMPS)
  /// World point the window follows (ocean.focus: the point under the screen centre).
  public var focus = SIMD2<Double>(0, 0)
  /// look uWind (m/s, world x / z).
  public var wind = SIMD2<Double>(0, 0)
  /// Game dt; ocean.js only advances the memory when dt > 0 (paused: texture and window stay).
  public var dt: Double = 0
  /// WaterMemory.clear() (mission setup): both targets to zero, queued stamps dropped.
  public var clear = false
  public private(set) var stamps: [WaterMemoryStamp] = []
  /// The ocean feature uniforms the advect's swirl reads (oceanFeatureFlow: uFeatCount, uFeatA, uFeatB;
  /// memory.js spreads uFeatC / uDownwash in too) with their values when the step ran: inside ocean.update
  /// (after features.update and _updateLook), so features that systems running after the ocean change
  /// (hazards) are not in yet and uDownwash is still the previous frame's late upload —
  /// WaterMemoryQueue.Frame.flow. Empty = no swirl.
  public var flowCount = 0
  public var flowA: [SIMD4<Float>] = []
  public var flowB: [SIMD4<Float>] = []
  public var flowC: [SIMD4<Float>] = []
  public var flowDownwash = SIMD4<Float>(0, 0, 10, 0)

  public init() {}

  /// The frame's ocean uniforms with the feature slots of this step's flow (the advect pass's material:
  /// memory.js `{...featureUniforms}`); everything else is the frame's own.
  public func advectOcean(_ o: OceanFrameInput) -> OceanFrameInput {
    var adv = o
    adv.featA = Array(flowA.prefix(flowCount))
    adv.featB = Array(flowB.prefix(flowCount))
    adv.featC = Array(flowC.prefix(flowCount))
    adv.downwash = flowDownwash
    return adv
  }

  /// WaterMemory.push: ignored when full (128) or when radius / strength are not > 0 (NaN included).
  public mutating func push(_ shape: WaterMemoryStamp.Shape, x: Double, z: Double, radius: Double, strength: Double,
                            foam: Double, dye: Double, disturbance: Double, oil: Double,
                            inner: Double = 0.7, dirX: Double = 0, dirZ: Double = 1) {
    if stamps.count >= WaterMemoryInput.MAX_STAMPS || !(radius > 0) || !(strength > 0) { return }
    stamps.append(WaterMemoryStamp(shape: shape, x: x, z: z, radius: radius, strength: strength, foam: foam, dye: dye,
                                   disturbance: disturbance, oil: oil, inner: inner, dirX: dirX, dirZ: dirZ))
  }

  public mutating func removeAllStamps() { stamps.removeAll(keepingCapacity: true) }

  /// Ocean.splash(x, z, radius, strength): its two memory stamps (the analytic splash ring is OceanSim's).
  public mutating func splash(x: Double, z: Double, radius: Double = 2, strength: Double = 1) {
    push(.ring, x: x, z: z, radius: radius * 2.2, strength: 0.6 * strength, foam: 0.7, dye: 0, disturbance: 1, oil: 0, inner: 0.6)
    push(.disc, x: x, z: z, radius: radius * 1.1, strength: 0.8 * strength, foam: 0.8, dye: 0, disturbance: 0.8, oil: 0)
  }

  /// Ocean.addWake(x, z, strength, dirX, dirZ): a faint V per frame (stamps add up to a Kelvin wake), or a
  /// foam disc without a direction. `dt` = ctx.time.dt (nothing while paused).
  public mutating func addWake(x: Double, z: Double, strength: Double = 1, dirX: Double? = nil, dirZ: Double? = nil, dt: Double) {
    guard dt > 0 else { return }
    let s = MathUtil.clamp(strength, 0, 3)
    if let dx = dirX, let dz = dirZ, dx.isFinite, dz.isFinite, JSNumber.isTruthy(dx) || JSNumber.isTruthy(dz) {
      let l = JS.hypot(dx, dz)
      push(.wake, x: x, z: z, radius: 8 + 6 * s, strength: 0.35 * s * dt, foam: 1, dye: 0, disturbance: 1, oil: 0,
           inner: 0, dirX: dx / l, dirZ: dz / l)
    } else {
      push(.disc, x: x, z: z, radius: 0.8 + 1.2 * s, strength: 1.2 * s * dt, foam: 1, dye: 0, disturbance: 1, oil: 0)
    }
  }

  /// Ocean._autoStamps(dt): the rotor downwash's continuous ring + disturbance disc (features.downwash
  /// = x, z, radius, strength; only above strength 0.01).
  public mutating func autoStamps(downwash d: SIMD4<Double>, dt: Double) {
    guard d.w > 0.01 else { return }
    let s = d.w
    push(.ring, x: d.x, z: d.y, radius: d.z * 1.15, strength: 0.18 * s * dt, foam: 1, dye: 0, disturbance: 0.6, oil: 0, inner: 0.82)
    push(.disc, x: d.x, z: d.y, radius: d.z * 0.9, strength: 1.6 * s * dt, foam: 0, dye: 0, disturbance: 1, oil: 0)
  }

  /// Ocean.stamp(kind, x, z, opts) with the memory present: 'foam' | 'dye' | 'disturb' | 'oil' | 'scar' |
  /// 'ring' | 'wake' | 'splash' (unknown kinds are ignored). radius default 3, strength 1, inner 0.75.
  public mutating func stamp(_ kind: String, x: Double, z: Double, radius r: Double = 3, strength s: Double = 1,
                             inner: Double? = nil, dirX: Double? = nil, dirZ: Double? = nil) {
    switch kind {
    case "foam": push(.disc, x: x, z: z, radius: r, strength: s, foam: 1, dye: 0, disturbance: 0.3, oil: 0)
    case "dye": push(.disc, x: x, z: z, radius: r, strength: s, foam: 0, dye: 1, disturbance: 0, oil: 0)
    case "disturb": push(.disc, x: x, z: z, radius: r, strength: s, foam: 0, dye: 0, disturbance: 1, oil: 0)
    case "oil": push(.disc, x: x, z: z, radius: r, strength: s, foam: 0, dye: 0, disturbance: 0, oil: 1)
    case "ring": push(.ring, x: x, z: z, radius: r, strength: s, foam: 1, dye: 0, disturbance: 0.7, oil: 0, inner: inner ?? 0.75)
    case "scar":
      push(.ring, x: x, z: z, radius: r, strength: 1.2 * s, foam: 1, dye: 0, disturbance: 1, oil: 0, inner: 0.7)
      push(.disc, x: x, z: z, radius: r * 0.6, strength: s, foam: 1, dye: 0, disturbance: 1, oil: 0)
    case "splash":
      push(.ring, x: x, z: z, radius: r, strength: s, foam: 0.8, dye: 0, disturbance: 1, oil: 0, inner: 0.6)
      push(.disc, x: x, z: z, radius: r * 0.5, strength: s, foam: 0.9, dye: 0, disturbance: 1, oil: 0)
    case "wake":
      let dx = dirX ?? 0, dz = dirZ ?? 0
      let l = JS.hypot(dx, dz)
      if l > 1e-4 {
        push(.wake, x: x, z: z, radius: r, strength: s, foam: 1, dye: 0, disturbance: 0.8, oil: 0, inner: 0, dirX: dx / l, dirZ: dz / l)
      } else {
        push(.disc, x: x, z: z, radius: r * 0.4, strength: s, foam: 1, dye: 0, disturbance: 0.8, oil: 0)
      }
    default: break
    }
  }
}

/// The CPU half of WaterMemory.update (memory.js): the window re-centred by whole texels on the focus, and
/// the advect uniforms of one step (shift, per-channel decay, dye diffusion). Double with JS math.
public struct WaterMemoryWindow: Equatable {
  public let size: Int
  public let extent: Double
  public let texel: Double
  public private(set) var centerInit = false
  /// Window centre (snapped), world x / z — ocean uMemWin.xy.
  public private(set) var center = SIMD2<Double>(0, 0)

  public init(size: Int, extent: Double = WaterMemoryPass.EXTENT) {
    self.size = size
    self.extent = extent
    texel = extent / Double(size)
  }

  /// One update(dt, focusX, focusZ, windX, windZ) step: the advect uniforms; the centre moves to the focus.
  public mutating func advance(dt: Double, focus: SIMD2<Double>, wind: SIMD2<Double>) -> MDMemoryAdvectUniforms {
    let nx = JS.round(focus.x / texel) * texel
    let nz = JS.round(focus.y / texel) * texel
    if !centerInit {
      center = SIMD2<Double>(nx, nz)
      centerInit = true
    }
    var u = MDMemoryAdvectUniforms()
    u.shiftCenter = SIMD4<Float>(Float((nx - center.x) / extent), Float((nz - center.y) / extent), Float(nx), Float(nz))
    u.extentDtWind = SIMD4<Float>(Float(extent), Float(dt), Float(wind.x), Float(wind.y))
    let h = WaterMemoryPass.HALF_LIFE
    u.uDecay = SIMD4<Float>(Float(JS.pow(0.5, dt / h[0])), Float(JS.pow(0.5, dt / h[1])),
                            Float(JS.pow(0.5, dt / h[2])), Float(JS.pow(0.5, dt / h[3])))
    u.texelDiffuse = SIMD4<Float>(Float(1 / Double(size)), Float(1 / Double(size)), Float(JS.min(1, dt * 0.6)), 0)
    center = SIMD2<Double>(nx, nz)
    return u
  }
}

public final class WaterMemoryPass {
  public static let EXTENT: Double = 320                       // ocean.js MEMORY_EXTENT
  public static let HALF_LIFE: [Double] = [3, 240, 0.8, 600]   // memory.js HALF_LIFE (R, G, B, A)
  public static let format: MTLPixelFormat = .rgba16Float

  public let size: Int
  public var texel: Double { win.texel }
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let look: LookResources
  private var read: MTLTexture
  private var write: MTLTexture
  private var needsClear = true
  private var win: WaterMemoryWindow
  /// Window centre (snapped), world x / z — ocean uMemWin.xy.
  public var center: SIMD2<Double> { win.center }

  /// The texture the ocean samples (the last written target).
  public var texture: MTLTexture { read }

  public init(device rd: RenderDevice, cache: PipelineCache, look: LookResources, size: Int) throws {
    self.rd = rd
    self.cache = cache
    self.look = look
    self.size = size
    win = WaterMemoryWindow(size: size)
    func make(_ label: String) throws -> MTLTexture {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: WaterMemoryPass.format, width: size, height: size, mipmapped: false)
      d.usage = [.renderTarget, .shaderRead]
      d.storageMode = .private
      guard let t = rd.device.makeTexture(descriptor: d) else { throw RenderError.resource(label) }
      t.label = label
      return t
    }
    read = try make("ocean.memory.a")
    write = try make("ocean.memory.b")
  }

  func pipelines() throws -> (advect: MTLRenderPipelineState, stamp: MTLRenderPipelineState) {
    let advect = try cache.render(key: "memory_advect") {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction("memory_advect_vs")
      d.fragmentFunction = try rd.makeFunction("memory_advect_fs")
      d.colorAttachments[0].pixelFormat = WaterMemoryPass.format
      return d
    }
    let stamp = try cache.render(key: "memory_stamp") {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction("memory_stamp_vs")
      d.fragmentFunction = try rd.makeFunction("memory_stamp_fs")
      let c = d.colorAttachments[0]!
      c.pixelFormat = WaterMemoryPass.format
      // CustomBlending: Add, One, One (colour and alpha)
      c.isBlendingEnabled = true
      c.rgbBlendOperation = .add
      c.alphaBlendOperation = .add
      c.sourceRGBBlendFactor = .one
      c.destinationRGBBlendFactor = .one
      c.sourceAlphaBlendFactor = .one
      c.destinationAlphaBlendFactor = .one
      return d
    }
    return (advect, stamp)
  }

  /// Encodes this frame's memory update. `oceanOffset`: the frame's MDOceanUniforms in the ring (feature
  /// flow for the advection). No-op while dt ≤ 0 (ocean.js: `if (this.memory && dt > 0)`), except a clear.
  public func encode(_ cb: MTLCommandBuffer, input: WaterMemoryInput, ring: FrameRing, oceanOffset: Int) throws {
    if input.clear {
      needsClear = true
    }
    let pso = try pipelines()
    if needsClear {
      for t in [read, write] {
        let rp = MTLRenderPassDescriptor()
        rp.colorAttachments[0].texture = t
        rp.colorAttachments[0].loadAction = .clear
        rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        rp.colorAttachments[0].storeAction = .store
        cb.makeRenderCommandEncoder(descriptor: rp)?.endEncoding()
      }
      needsClear = false
    }
    guard input.dt > 0 else { return }
    let off = ring.push(win.advance(dt: input.dt, focus: input.focus, wind: input.wind))
    let rp = MTLRenderPassDescriptor()
    rp.colorAttachments[0].texture = write
    rp.colorAttachments[0].loadAction = .dontCare        // the advect triangle covers every texel
    rp.colorAttachments[0].storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
    enc.label = FramePass.waterMemory.label
    enc.setViewport(MTLViewport(originX: 0, originY: 0, width: Double(size), height: Double(size), znear: 0, zfar: 1))
    enc.setCullMode(.none)
    enc.setRenderPipelineState(pso.advect)
    enc.setFragmentBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
    enc.setFragmentBuffer(ring.buffer, offset: oceanOffset, index: Int(MD_BUF_MATERIAL))
    enc.setFragmentTexture(read, index: Int(MD_TEX_SOURCE))
    enc.setFragmentSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    if !input.stamps.isEmpty {
      let gpu = input.stamps.map { $0.gpu }
      let soff = ring.push(array: gpu)
      enc.setRenderPipelineState(pso.stamp)
      enc.setVertexBuffer(ring.buffer, offset: soff, index: Int(MD_BUF_INSTANCES))
      enc.setVertexBuffer(ring.buffer, offset: off, index: Int(MD_BUF_PASS))
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: gpu.count)
    }
    enc.endEncoding()
    let t = read
    read = write
    write = t
  }

  /// ocean uMemWin = (centre x, z, MEMORY_EXTENT, 1).
  public var window: SIMD4<Float> {
    SIMD4<Float>(Float(center.x), Float(center.y), Float(WaterMemoryPass.EXTENT), 1)
  }
}
