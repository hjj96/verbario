// Renderer — the single Metal renderer shared by iOS and macOS (PLAN D1, D10, D11, §2.5).
//
// Frame graph (FrameGraph.swift; fixed order, a pass is encoded or skipped):
//   1. envRebake       PMREM cube-UV atlas of the weather/env.js sky (EnvironmentProbe; on request and
//                      once before first use)
//   2. waterMemory     ocean/memory.js ping-pong advect + stamps (quality.oceanMemory > 0, dt > 0)
//   4. shadow          the sun's depth map (SunRig / ShadowCamera) when a family casts shadows
//   6. scene           MSAA rgba16Float (memoryless) + depth32Float → resolve into sceneHDR; viewport
//                      sub-rect = internal size × dynamic-resolution scale; draws: opaque families,
//                      the ocean (renderOrder 10), transparent families
//   7. bloom           UnrealBloomPass (BloomPass) when the tier enables it and strength > 0
//   8. composite+output sceneHDR + bloom → post (ACES Filmic × exposure, sRGB OETF), same sub-rect
//   9. final           post → drawable (bgra8Unorm, layer colorspace sRGB), full drawable resolution
//   (thermal heat pass: M6; HUD on top of the drawable: M5; photo capture: M8.)
//
// Frame pacing: triple buffering (FrameRing: semaphore 3, 8 MB per slot); MTKView paces the display
// link (preferredFramesPerSecond); on iOS the drawable is presented with afterMinimumDuration so a
// 120 Hz panel holds a steady 60. Dynamic resolution: DynResController (post.js rules on GPU time, X2);
// the MSAA sample count never changes on the fly (X1).
import Foundation
import Metal
import QuartzCore
import simd
import MaydayCore
import MaydayShaderTypes

public struct RenderStats {
  public var gpuMs: Double = 0             // mean GPU time over the last window
  public var cpuEncodeMs: Double = 0       // last frame's CPU encode time
  public var dynScale: Double = 1
  public var internalWidth = 0
  public var internalHeight = 0
  public var viewportWidth = 0
  public var viewportHeight = 0
  public var drawableWidth = 0
  public var drawableHeight = 0
  public var sampleCount = 1
  public var frames: Int = 0
  public var envBakes: Int = 0
  public var shadowPass = false
  public var bloomPass = false
  public var qualityHint: QualityHint?
  public var lastError: String?
  public init() {}
}

/// RGBA8 readback of an offscreen frame (tests, goldens).
public struct OffscreenFrame {
  public let width: Int
  public let height: Int
  /// FinalPass output (display sRGB), RGBA8, row 0 = top.
  public let final: [UInt8]
  /// Composite+Output result before the FinalPass (ACES + sRGB, bloom included), RGBA8 (rounded from
  /// half float), row 0 = top, cropped to the dynamic-resolution viewport (= full size at scale 1).
  public let post: [UInt8]
}

public final class Renderer {
  public let device: RenderDevice
  public let look: LookResources
  public let ocean: OceanRenderer
  public let post: PostChain
  public let selftest: OceanSelftest
  public let environment: EnvironmentProbe
  public let shadow: ShadowPass
  public let bloom: BloomPass
  private let cache: PipelineCache
  private let ring: FrameRing
  private var targets: RenderTargets?
  private var memory: WaterMemoryPass?
  private var families: [RenderFamily] = []
  /// Last render-target allocation that failed (size + sample count) and its error: rethrown while
  /// the request is unchanged instead of re-allocating every frame; a resize / tier change retries.
  private var failedTargets: (width: Int, height: Int, sampleCount: Int, error: Error)?

  // dynamic resolution (written on the main thread; GPU samples arrive on Metal's completion thread)
  public private(set) var dynRes = DynResController(quality: "high")
  private let gpuLock = NSLock()
  private var gpuPending: [Double] = []
  private var lastFrameTime: CFTimeInterval = 0
  private var statsStore = RenderStats()
  private let statsLock = NSLock()

  /// texturesDirectory: the bundle's Resources/Textures folder; oceanConstants: MaydayCore WaveConstants
  /// (ocean.json `ocean/waves`: grid extent / power / skirt rows used to build the grid meshes).
  public init(device: MTLDevice? = nil, texturesDirectory: URL, oceanConstants: WaveConstants,
              drawableFormat: MTLPixelFormat = .bgra8Unorm) throws {
    let rd = try RenderDevice(device: device)
    let cache = PipelineCache(device: rd)
    let ring = try FrameRing(device: rd.device)
    let look = try LookResources(device: rd, texturesDirectory: texturesDirectory)
    let ocean = try OceanRenderer(device: rd, cache: cache, look: look, constants: oceanConstants)
    self.device = rd
    self.cache = cache
    self.ring = ring
    self.look = look
    self.ocean = ocean
    self.post = PostChain(device: rd, cache: cache, look: look, drawableFormat: drawableFormat)
    self.selftest = OceanSelftest(device: rd, cache: cache, look: look)
    self.environment = try EnvironmentProbe(device: rd, cache: cache, look: look)
    self.shadow = try ShadowPass(device: rd, cache: cache)
    self.bloom = BloomPass(device: rd, cache: cache, look: look)
  }

  /// The PSO cache shared by every family (keys: PipelineCache).
  public var pipelineCache: PipelineCache { cache }

  /// Registers a mesh family (drawn in registration order; see RenderFamily).
  public func addFamily(_ f: RenderFamily) {
    if !families.contains(where: { $0 === f }) { families.append(f) }
  }

  public func removeFamily(_ f: RenderFamily) {
    families.removeAll { $0 === f }
  }

  /// Compiles the PSOs of a quality tier ahead of the first frame (boot / quality change).
  public func prewarm(quality: RenderQualityConfig) throws {
    // boot / quality change: give previously failed PSOs and render targets one fresh attempt
    cache.resetFailures()
    failedTargets = nil
    dynRes.applyQuality(quality.name)
    let sc = device.sampleCount(atMost: quality.sampleCount)
    for shadows in [false, true] {
      _ = try ocean.pipeline(quality: quality, sampleCount: sc, memory: quality.oceanMemory > 0, shadows: shadows)
    }
    _ = try ocean.mesh(n: quality.oceanGridN)
    _ = try post.compositePipeline()
    _ = try post.finalPipeline()
    _ = try environment.pipelines()
    if quality.bloomEnabled { _ = try bloom.pipelines() }
    if quality.oceanMemory > 0 { _ = try waterMemory(size: quality.oceanMemory).pipelines() }
  }

  public var stats: RenderStats {
    statsLock.lock(); defer { statsLock.unlock() }
    return statsStore
  }

  private func updateStats(_ body: (inout RenderStats) -> Void) {
    statsLock.lock(); body(&statsStore); statsLock.unlock()
  }

  private func waterMemory(size: Int) throws -> WaterMemoryPass {
    if let m = memory, m.size == size { return m }
    let m = try WaterMemoryPass(device: device, cache: cache, look: look, size: size)
    memory = m
    return m
  }

  // ---- frame --------------------------------------------------------------------------------------

  /// Encodes and commits one frame. `drawable` is called as late as possible (after the off-screen
  /// passes are encoded); a nil drawable still commits the off-screen work to keep the ring balanced.
  public func render(_ frame: RenderFrame, drawable: () -> CAMetalDrawable?) {
    let t0 = CACurrentMediaTime()
    let realDt = lastFrameTime > 0 ? min(t0 - lastFrameTime, 0.1) : 0
    lastFrameTime = t0
    updateDynamicResolution(frame: frame, realDt: realDt)
    ring.beginFrame()
    guard let cb = device.queue.makeCommandBuffer() else {
      ring.abandonFrame()
      return
    }
    cb.label = "MAYDAY.frame"
    var failure: String?
    var drawableSize = (0, 0)
    do {
      let encoded = try encodeFrame(frame, cb: cb, scale: dynRes.scale)
      if let d = drawable() {
        drawableSize = (d.texture.width, d.texture.height)
        post.encodeFinal(cb, pipeline: encoded.finalPSO, target: d.texture, source: encoded.targets,
                         sourceViewport: encoded.viewport, ring: ring, input: frame.post.finalPass, pxScale: frame.pxScale)
        #if os(iOS)
        cb.present(d, afterMinimumDuration: 1.0 / Double(max(1, frame.framesPerSecond)))
        #else
        cb.present(d)
        #endif
      }
    } catch let e as RenderError {
      failure = e.description
    } catch let e {
      failure = "\(e)"
    }
    ring.signal(on: cb)
    cb.addCompletedHandler { [weak self] buffer in
      self?.recordGPUTime(buffer)
    }
    cb.commit()
    let cpuMs = (CACurrentMediaTime() - t0) * 1000
    updateStats { s in
      s.cpuEncodeMs = cpuMs
      s.frames += 1
      if drawableSize.0 > 0 {
        s.drawableWidth = drawableSize.0
        s.drawableHeight = drawableSize.1
      }
      s.lastError = failure   // nil again after the first good frame: a transient error does not stick
    }
  }

  /// Renders one frame off screen at `frame.internalWidth × internalHeight` (FinalPass at the same size),
  /// waits for the GPU and reads both the FinalPass result and the post target back (golden tests).
  /// `dynamicScale` is applied as in a live frame (1 = full size, like the web's `?dynres=0`).
  public func renderOffscreen(_ frame: RenderFrame, dynamicScale: Double = 1) throws -> OffscreenFrame {
    let w = max(1, frame.internalWidth)
    let h = max(1, frame.internalHeight)
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: post.drawableFormat, width: w, height: h, mipmapped: false)
    d.usage = [.renderTarget, .shaderRead]
    d.storageMode = .private
    guard let target = device.device.makeTexture(descriptor: d) else { throw RenderError.resource("offscreen target") }
    target.label = "MAYDAY.offscreen"
    ring.beginFrame()
    guard let cb = device.queue.makeCommandBuffer() else {
      ring.abandonFrame()
      throw RenderError.resource("offscreen command buffer")
    }
    cb.label = "MAYDAY.offscreen"
    let encoded: EncodedFrame
    do {
      encoded = try encodeFrame(frame, cb: cb, scale: dynamicScale)
    } catch {
      ring.signal(on: cb)
      cb.commit()
      throw error
    }
    post.encodeFinal(cb, pipeline: encoded.finalPSO, target: target, source: encoded.targets,
                     sourceViewport: encoded.viewport, ring: ring, input: frame.post.finalPass, pxScale: frame.pxScale)
    let vpW = Int(encoded.viewport.width), vpH = Int(encoded.viewport.height)
    guard let finalBuf = device.device.makeBuffer(length: w * h * 4, options: [.storageModeShared]),
          let postBuf = device.device.makeBuffer(length: vpW * vpH * 8, options: [.storageModeShared]),
          let blit = cb.makeBlitCommandEncoder() else {
      ring.signal(on: cb)
      cb.commit()
      throw RenderError.resource("offscreen readback")
    }
    blit.copy(from: target, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
              sourceSize: MTLSize(width: w, height: h, depth: 1), to: finalBuf, destinationOffset: 0,
              destinationBytesPerRow: w * 4, destinationBytesPerImage: w * h * 4)
    blit.copy(from: encoded.targets.post, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
              sourceSize: MTLSize(width: vpW, height: vpH, depth: 1), to: postBuf, destinationOffset: 0,
              destinationBytesPerRow: vpW * 8, destinationBytesPerImage: vpW * vpH * 8)
    blit.endEncoding()
    ring.signal(on: cb)
    cb.commit()
    cb.waitUntilCompleted()
    if let e = cb.error { throw RenderError.resource("offscreen: \(e.localizedDescription)") }
    // final: drawable format bgra8Unorm → RGBA
    let fp = finalBuf.contents().bindMemory(to: UInt8.self, capacity: w * h * 4)
    var final = [UInt8](repeating: 0, count: w * h * 4)
    let bgra = post.drawableFormat == .bgra8Unorm
    for i in 0..<(w * h) {
      final[i * 4] = fp[i * 4 + (bgra ? 2 : 0)]
      final[i * 4 + 1] = fp[i * 4 + 1]
      final[i * 4 + 2] = fp[i * 4 + (bgra ? 0 : 2)]
      final[i * 4 + 3] = fp[i * 4 + 3]
    }
    // post: rgba16Float → RGBA8 (round half to nearest like a canvas readback of a [0, 1] value)
    let pp = postBuf.contents().bindMemory(to: UInt16.self, capacity: vpW * vpH * 4)
    var postBytes = [UInt8](repeating: 0, count: vpW * vpH * 4)
    for i in 0..<(vpW * vpH * 4) {
      let v = Renderer.halfToFloat(pp[i])
      postBytes[i] = UInt8(max(0, min(255, (v * 255).rounded())))
    }
    return OffscreenFrame(width: w, height: h, final: final, post: postBytes)
  }

  /// IEEE 754 binary16 → Float (portable: no Float16 dependency).
  static func halfToFloat(_ h: UInt16) -> Float {
    let sign: Float = (h & 0x8000) != 0 ? -1 : 1
    let exp = Int((h >> 10) & 0x1F)
    let man = Float(h & 0x3FF)
    if exp == 0 { return sign * man * pow(2, -24) }
    if exp == 31 { return man == 0 ? sign * Float.infinity : Float.nan }
    return sign * (1 + man / 1024) * pow(2, Float(exp - 15))
  }

  private struct EncodedFrame {
    let targets: RenderTargets
    let viewport: MTLViewport
    let finalPSO: MTLRenderPipelineState
  }

  /// Passes 1–8 (everything before the FinalPass). Throws before opening any encoder when a PSO or a
  /// render target is unavailable.
  private func encodeFrame(_ frame: RenderFrame, cb: MTLCommandBuffer, scale: Double) throws -> EncodedFrame {
    let q = frame.quality
    let sc = device.sampleCount(atMost: q.sampleCount)
    let w = max(1, frame.internalWidth)
    let h = max(1, frame.internalHeight)
    if targets == nil || !(targets!.matches(width: w, height: h, sampleCount: sc)) {
      if let f = failedTargets, f.width == w, f.height == h, f.sampleCount == sc { throw f.error }
      do {
        targets = try RenderTargets(device: device, width: w, height: h, sampleCount: sc)
        failedTargets = nil
      } catch {
        failedTargets = (w, h, sc, error)
        throw error
      }
    }
    guard let rt = targets else { throw RenderError.resource("render targets") }
    let casters = families.filter { $0.castsShadows }
    let shadowOn = frame.lights.shadow != nil && !casters.isEmpty
    let memoryOn = q.oceanMemory > 0
    let oceanPSO = try ocean.pipeline(quality: q, sampleCount: sc, memory: memoryOn, shadows: shadowOn)
    let oceanMesh = try ocean.mesh(n: q.oceanGridN)
    let compositePSO = try post.compositePipeline()
    let finalPSO = try post.finalPipeline()
    let mem = memoryOn ? try waterMemory(size: q.oceanMemory) : nil
    if mem == nil { memory = nil }

    let vpW = max(1, Int((Double(w) * scale).rounded()))
    let vpH = max(1, Int((Double(h) * scale).rounded()))
    let viewport = MTLViewport(originX: 0, originY: 0, width: Double(vpW), height: Double(vpH), znear: 0, zfar: 1)

    // ---- per-frame uniforms (aspect of the full internal size: dynres never changes framing)
    let cam = CameraMatrices(camera: frame.camera, aspect: Double(w) / Double(h))
    let frameOffset = ring.push(makeFrameUniforms(frame, cam: cam, vpW: vpW, vpH: vpH))
    let lookOffset = ring.push(makeLookUniforms(frame, vpW: vpW, vpH: vpH))
    let lightsOffset = ring.push(LightRig.pack(frame.lights, shadowMapBound: shadowOn))

    // ---- 1. environment (PMREM) — on request, and before first use
    if frame.environment.rebake || !environment.baked {
      try environment.encodeBake(cb, params: frame.environment.sky ?? Renderer.envSky(from: frame.ocean))
    }

    // ---- coast map upload (blit) and 2. water memory
    let coast = try ocean.coastTexture(for: frame.ocean.coast, cb: cb)
    if let m = mem {
      let featureOffset = ocean.pushUniforms(frame.ocean, ring: ring, memoryWindow: m.window)
      try m.encode(cb, input: frame.waterMemory, ring: ring, oceanOffset: featureOffset)
    }
    let oceanOffset = ocean.pushUniforms(frame.ocean, ring: ring, memoryWindow: mem?.window)

    let shadowMap: MTLTexture? = shadowOn ? try shadow.ensureMap(size: frame.lights.shadow?.mapSize ?? 1024) : nil
    let ctx = FrameContext(frame: frame, ring: ring, frameOffset: frameOffset, lookOffset: lookOffset,
                           lightsOffset: lightsOffset, camera: cam, sampleCount: sc, look: look,
                           environment: environment.baked ? environment.atlas : nil,
                           shadowMap: shadowMap, shadowSampler: shadow.compareSampler)
    for f in families { try f.prepare(ctx) }

    // ---- 4. the sun's shadow map
    if shadowOn, let s = frame.lights.shadow {
      let layers: RenderLayers = s.shadowOnlyLayer ? [.main, .shadowOnly] : .main
      try shadow.encode(cb, camera: s.camera, mapSize: s.mapSize, layers: layers, ring: ring,
                        casters: casters.map { f in { enc, pass in f.encodeShadow(enc, ctx, pass: pass) } })
    }

    // ---- 6. scene
    if let enc = cb.makeRenderCommandEncoder(descriptor: rt.scenePassDescriptor(clear: frame.fog.color)) {
      enc.label = FramePass.scene.label
      enc.setViewport(viewport)
      for f in families { f.encodeOpaque(enc, ctx) }
      enc.setViewport(viewport)
      ocean.encode(enc, pipeline: oceanPSO, mesh: oceanMesh, ring: ring, frameOffset: frameOffset,
                   lookOffset: lookOffset, lightsOffset: lightsOffset, oceanOffset: oceanOffset,
                   bindings: OceanRenderer.Bindings(coast: coast, memory: mem?.texture,
                                                    shadowMap: shadowMap,
                                                    shadowSampler: shadowOn ? shadow.compareSampler : nil))
      for f in families { f.encodeTransparent(enc, ctx) }
      enc.endEncoding()
    }

    // ---- 7. bloom
    var bloomTexture: MTLTexture?
    if q.bloomEnabled && frame.post.bloomStrength > 0 {
      bloomTexture = try bloom.encode(cb, ring: ring, scene: rt.sceneHDR, viewportWidth: vpW, viewportHeight: vpH,
                                      scale: q.bloomScale, strength: frame.post.bloomStrength,
                                      radius: frame.post.bloomRadius, threshold: frame.post.bloomThreshold)
    }
    // ---- 8. composite + output
    post.encodeComposite(cb, pipeline: compositePSO, targets: rt, viewport: viewport, ring: ring,
                         exposure: frame.post.exposure, bloom: bloomTexture)

    let s = dynRes.scale
    let bakes = environment.bakeCount
    updateStats { st in
      st.internalWidth = w
      st.internalHeight = h
      st.viewportWidth = vpW
      st.viewportHeight = vpH
      st.sampleCount = sc
      st.dynScale = s
      st.envBakes = bakes
      st.shadowPass = shadowOn
      st.bloomPass = bloomTexture != nil
    }
    return EncodedFrame(targets: rt, viewport: viewport, finalPSO: finalPSO)
  }

  /// The env bake inputs implied by the ocean palette of the frame when the sim supplies none
  /// (weather/env.js reads the same palette: sky, fogColor, deep, sunDirVisual, sun, sunIntensity).
  static func envSky(from o: OceanFrameInput) -> EnvSkyParams {
    EnvSkyParams(sky: o.sky, fog: o.fogColor, deep: o.deep, sunDir: o.sunDirV, sunColor: o.sun,
                 sunIntensity: o.seaB.w, cloud: 0.5)
  }

  // ---- uniforms -------------------------------------------------------------------------------------

  private func makeFrameUniforms(_ f: RenderFrame, cam: CameraMatrices, vpW: Int, vpH: Int) -> MDFrameUniforms {
    var u = MDFrameUniforms()
    u.viewMatrix = CameraMatrices.toFloat(cam.view)
    u.projMatrix = CameraMatrices.toFloat(cam.projMetal)
    u.viewProjMatrix = CameraMatrices.toFloat(cam.viewProjMetal)
    u.invViewProjMatrix = CameraMatrices.toFloat(cam.viewProjMetal.inverse)
    let p = f.camera.position
    u.cameraPosition = SIMD4<Float>(Float(p.x), Float(p.y), Float(p.z), Float(f.camera.near))
    let focus = cam.fogFocus(cameraY: p.y)
    u.fogColorNear = SIMD4<Float>(f.fog.color.x, f.fog.color.y, f.fog.color.z, f.fog.near)
    u.fogFarFocus = SIMD4<Float>(f.fog.far, Float(focus.x), Float(focus.y), f.fog.enabled ? 1 : 0)
    u.timeRes = SIMD4<Float>(Float(f.look.time), Float(f.realTime), Float(vpW), Float(vpH))
    return u
  }

  private func makeLookUniforms(_ f: RenderFrame, vpW: Int, vpH: Int) -> MDLookUniforms {
    let l = f.look
    var u = MDLookUniforms()
    u.timeWindRain = SIMD4<Float>(Float(l.time), Float(l.wind.x), Float(l.wind.y), Float(l.rain))
    u.windOffsetWetFlash = SIMD4<Float>(Float(l.windOffset.x), Float(l.windOffset.y), Float(l.wet), Float(l.flash))
    u.nightResolution = SIMD4<Float>(Float(l.night), 0, Float(vpW), Float(vpH))
    var a = l.gustFrontsA
    var b = l.gustFrontsB
    while a.count < 4 { a.append(SIMD4<Float>(0, 0, 1, 0)) }
    while b.count < 4 { b.append(SIMD4<Float>(0, 140, 500, 0)) }
    OceanRenderer.fill(&u.uGustFronts, Array(a.prefix(4)))
    OceanRenderer.fill(&u.uGustFrontsB, Array(b.prefix(4)))
    return u
  }

  // ---- dynamic resolution ------------------------------------------------------------------------------

  private func recordGPUTime(_ cb: MTLCommandBuffer) {
    let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
    guard ms > 0, ms < 1000 else { return }
    gpuLock.lock()
    gpuPending.append(ms)
    gpuLock.unlock()
  }

  private func updateDynamicResolution(frame: RenderFrame, realDt: Double) {
    gpuLock.lock()
    let samples = gpuPending
    gpuPending.removeAll(keepingCapacity: true)
    gpuLock.unlock()
    if dynRes.quality != frame.quality.name { dynRes.applyQuality(frame.quality.name) }
    dynRes.enabled = frame.dynamicResolution
    for ms in samples { dynRes.addGPUSample(ms: ms) }
    let hint = dynRes.update(dt: realDt, paused: frame.dynamicResolutionFrozen)
    if !frame.dynamicResolution { dynRes.applyQuality(frame.quality.name) }   // off: always full size
    let ms = dynRes.frameMs
    updateStats { s in
      s.gpuMs = ms
      if let h = hint { s.qualityHint = h }
    }
  }
}
