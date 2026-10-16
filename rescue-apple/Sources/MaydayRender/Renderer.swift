// Renderer — the single Metal renderer shared by iOS and macOS (PLAN D1, D10, D11, §2.5).
//
// Frame graph (fixed, M0 subset):
//   1. scene pass   MSAA rgba16Float (memoryless) + depth32Float → resolve into sceneHDR;
//                   viewport sub-rect = internal size × dynamic-resolution scale;
//                   draws: ocean (renderOrder 10). Props / heli / FX / shadows / env: M2+.
//   2. composite+output  sceneHDR → post (ACES Filmic × exposure, sRGB OETF), same sub-rect.
//   3. final        post → drawable (bgra8Unorm, layer colorspace sRGB), full drawable resolution.
//   (HUD on top of the drawable: M5; frame capture for photo mode: M8.)
//
// Frame pacing: triple buffering (FrameRing: semaphore 3, 8 MB per slot); MTKView paces the display
// link (preferredFramesPerSecond); on iOS the drawable is presented with afterMinimumDuration so a
// 120 Hz panel holds a steady 60. Dynamic resolution (PLAN D11/X2): GPU time from the command
// buffer (gpuEndTime − gpuStartTime), 1 s window, > 18 ms → −0.05, < 13 ms → +0.05, floor per tier;
// the MSAA sample count never changes on the fly.
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
  public var lastError: String?
  public init() {}
}

public final class Renderer {
  public let device: RenderDevice
  public let look: LookResources
  public let ocean: OceanRenderer
  public let post: PostChain
  public let selftest: OceanSelftest
  private let cache: PipelineCache
  private let ring: FrameRing
  private var targets: RenderTargets?
  /// Last render-target allocation that failed (size + sample count) and its error: rethrown while
  /// the request is unchanged instead of re-allocating every frame; a resize / tier change retries.
  private var failedTargets: (width: Int, height: Int, sampleCount: Int, error: Error)?

  // dynamic resolution (written on the main thread; GPU samples arrive on Metal's completion thread)
  private var dynScale: Double = 1
  private let gpuLock = NSLock()
  private var gpuAccum: Double = 0
  private var gpuSamples: Int = 0
  private var gpuWindowStart: CFTimeInterval = 0
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
  }

  /// Compiles the PSOs of a quality tier ahead of the first frame (boot / quality change).
  public func prewarm(quality: RenderQualityConfig) throws {
    // boot / quality change: give previously failed PSOs and render targets one fresh attempt
    cache.resetFailures()
    failedTargets = nil
    let sc = device.sampleCount(atMost: quality.sampleCount)
    _ = try ocean.pipeline(quality: quality, sampleCount: sc)
    _ = try ocean.mesh(n: quality.oceanGridN)
    _ = try post.compositePipeline()
    _ = try post.finalPipeline()
  }

  public var stats: RenderStats {
    statsLock.lock(); defer { statsLock.unlock() }
    return statsStore
  }

  private func updateStats(_ body: (inout RenderStats) -> Void) {
    statsLock.lock(); body(&statsStore); statsLock.unlock()
  }

  // ---- frame --------------------------------------------------------------------------------------

  /// Encodes and commits one frame. `drawable` is called as late as possible (after the off-screen
  /// passes are encoded); a nil drawable still commits the off-screen work to keep the ring balanced.
  public func render(_ frame: RenderFrame, drawable: () -> CAMetalDrawable?) {
    let t0 = CACurrentMediaTime()
    ring.beginFrame()
    guard let cb = device.queue.makeCommandBuffer() else {
      ring.abandonFrame()
      return
    }
    cb.label = "MAYDAY.frame"
    var failure: String?
    var drawableSize = (0, 0)
    do {
      // everything that can throw happens before the first encoder is opened
      let sc = device.sampleCount(atMost: frame.quality.sampleCount)
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
      let oceanPSO = try ocean.pipeline(quality: frame.quality, sampleCount: sc)
      let oceanMesh = try ocean.mesh(n: frame.quality.oceanGridN)
      let compositePSO = try post.compositePipeline()
      let finalPSO = try post.finalPipeline()

      updateDynamicResolution(enabled: frame.dynamicResolution, minScale: frame.quality.minDynScale)
      let vpW = max(1, Int((Double(w) * dynScale).rounded()))
      let vpH = max(1, Int((Double(h) * dynScale).rounded()))
      let viewport = MTLViewport(originX: 0, originY: 0, width: Double(vpW), height: Double(vpH), znear: 0, zfar: 1)

      // ---- per-frame uniforms (aspect of the full internal size: dynres never changes framing)
      let cam = CameraMatrices(camera: frame.camera, aspect: Double(w) / Double(h))
      let frameOffset = ring.push(makeFrameUniforms(frame, cam: cam, vpW: vpW, vpH: vpH))
      let lookOffset = ring.push(makeLookUniforms(frame, vpW: vpW, vpH: vpH))
      let lightsOffset = ring.push(makeLightsUniforms(frame))

      // ---- 1. scene
      if let enc = cb.makeRenderCommandEncoder(descriptor: rt.scenePassDescriptor(clear: frame.fog.color)) {
        enc.label = FramePass.scene.label
        enc.setViewport(viewport)
        ocean.encode(enc, pipeline: oceanPSO, mesh: oceanMesh, ring: ring, frameOffset: frameOffset,
                     lookOffset: lookOffset, lightsOffset: lightsOffset, input: frame.ocean)
        enc.endEncoding()
      }
      // ---- 2. composite + output
      post.encodeComposite(cb, pipeline: compositePSO, targets: rt, viewport: viewport, ring: ring,
                           exposure: frame.post.exposure, bloomStrength: frame.post.bloomStrength)
      // ---- 3. final → drawable
      if let d = drawable() {
        drawableSize = (d.texture.width, d.texture.height)
        post.encodeFinal(cb, pipeline: finalPSO, target: d.texture, source: rt, sourceViewport: viewport,
                         ring: ring, input: frame.post.finalPass, pxScale: frame.pxScale)
        #if os(iOS)
        cb.present(d, afterMinimumDuration: 1.0 / Double(max(1, frame.framesPerSecond)))
        #else
        cb.present(d)
        #endif
      }
      let scale = dynScale
      updateStats { s in
        s.internalWidth = w
        s.internalHeight = h
        s.viewportWidth = vpW
        s.viewportHeight = vpH
        s.sampleCount = sc
        s.dynScale = scale
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

  private func makeLightsUniforms(_ f: RenderFrame) -> MDLightsUniforms {
    let L = f.lights
    var u = MDLightsUniforms()
    u.dir.direction = SIMD4<Float>(L.sunDirection.x, L.sunDirection.y, L.sunDirection.z, 0)
    u.dir.color = SIMD4<Float>(L.sunColor.x, L.sunColor.y, L.sunColor.z, 0)
    u.hemi.skyColor = SIMD4<Float>(L.hemiSky.x, L.hemiSky.y, L.hemiSky.z, 0)
    u.hemi.groundColor = SIMD4<Float>(L.hemiGround.x, L.hemiGround.y, L.hemiGround.z, 0)
    u.hemi.direction = SIMD4<Float>(0, 1, 0, 0)
    withUnsafeMutableBytes(of: &u.spot) { raw in
      let p = raw.bindMemory(to: MDSpotLight.self)
      for i in 0..<min(p.count, L.spots.count) {
        let s = L.spots[i]
        var m = MDSpotLight()
        m.position = SIMD4<Float>(s.position.x, s.position.y, s.position.z, 1)
        m.direction = SIMD4<Float>(s.direction.x, s.direction.y, s.direction.z, 0)
        m.color = SIMD4<Float>(s.color.x, s.color.y, s.color.z, 0)
        m.params = SIMD4<Float>(s.distance, s.decay, s.coneCos, s.penumbraCos)
        p[i] = m
      }
    }
    withUnsafeMutableBytes(of: &u.point) { raw in
      let p = raw.bindMemory(to: MDPointLight.self)
      for i in 0..<min(p.count, L.points.count) {
        let s = L.points[i]
        var m = MDPointLight()
        m.position = SIMD4<Float>(s.position.x, s.position.y, s.position.z, 1)
        m.color = SIMD4<Float>(s.color.x, s.color.y, s.color.z, 0)
        m.params = SIMD4<Float>(s.distance, s.decay, 0, 0)
        p[i] = m
      }
    }
    u.ambientEnv = SIMD4<Float>(L.ambient.x, L.ambient.y, L.ambient.z, L.environmentIntensity)
    return u
  }

  // ---- dynamic resolution ------------------------------------------------------------------------------

  private func recordGPUTime(_ cb: MTLCommandBuffer) {
    let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
    guard ms > 0, ms < 1000 else { return }
    gpuLock.lock()
    gpuAccum += ms
    gpuSamples += 1
    gpuLock.unlock()
  }

  private func updateDynamicResolution(enabled: Bool, minScale: Double) {
    let now = CACurrentMediaTime()
    if gpuWindowStart == 0 { gpuWindowStart = now }
    guard now - gpuWindowStart >= 1 else { return }
    gpuLock.lock()
    let mean = gpuSamples > 0 ? gpuAccum / Double(gpuSamples) : 0
    gpuAccum = 0
    gpuSamples = 0
    gpuLock.unlock()
    gpuWindowStart = now
    if !enabled {
      dynScale = 1
    } else if mean > 18 {
      dynScale = max(minScale, dynScale - 0.05)
    } else if mean > 0 && mean < 13 {
      dynScale = min(1, dynScale + 0.05)
    }
    dynScale = min(1, max(minScale, dynScale))
    let m = mean
    updateStats { s in s.gpuMs = m }
  }
}
