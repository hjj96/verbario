// GameHost — owns the simulation and the renderer, driven by the MTKView display link
// (PLAN §2.3 «Игровой цикл», §2.8; web: main.js loop + pixel-ratio rule).
//
//   frame: realDt = min(frameDelta, dtCap 0.1) → input.poll() → simulation → render snapshot → Renderer
//   pixel ratio: min(screen scale, pixelRatioCap(quality), max(1, √(1920·1080 / points²))) (main.js)
//   view: bgra8Unorm drawable, colorspace sRGB (P3 panels must not oversaturate), no MTKView depth
//         (the renderer owns its targets), 60 fps (120 Hz is a later setting, PLAN X11).
// Launch arguments (NSArgumentDomain, PLAN §2.8): -mayday.quality low|medium|high,
//   -mayday.weather <preset>, -mayday.dynres NO, -mayday.debug YES|NO, -mayday.fps 60|120.
//
// No actor annotations on purpose: everything here runs on the main thread (MTKView draw, SwiftUI,
// GameController handlers on the main queue); Metal completion handlers only touch the renderer's
// locked stats.
import Foundation
import Combine
import MetalKit
import QuartzCore
import MaydayCore
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct OverlayInfo {
  var fps: Double = 0
  var cpuMs: Double = 0
  var gpuMs: Double = 0
  var internalSize = ""
  var drawableSize = ""
  var dynScale: Double = 1
  var msaa = 1
  var quality = ""
  var preset = ""
  var windText = ""
  var seaText = ""
  var cameraText = ""
  var probeText = ""
  var flags = ""
  var device = ""
  var error: String?
}

final class GameHost: ObservableObject {
  @Published private(set) var overlay = OverlayInfo()
  @Published var showOverlay: Bool
  @Published private(set) var fatalMessage: String? = nil

  let devices = InputDevices()
  private(set) var renderer: Renderer?
  private(set) var sim: BootstrapSim?
  private var lastTime: CFTimeInterval = 0
  private var dtCap = 0.1
  private var dynamicResolution = true
  private var preferredFPS = 60
  private var virtualAxes: [String: Double] = [:]
  private var prewarmedQuality: RenderQualityConfig?
  private var fpsAccum = 0.0
  private var fpsFrames = 0
  private var overlayT = 0.0

  var metalDevice: MTLDevice? { renderer?.device.device }

  init() {
    let defaults = UserDefaults.standard
    #if DEBUG
    showOverlay = defaults.object(forKey: "mayday.debug") == nil ? true : defaults.bool(forKey: "mayday.debug")
    #else
    showOverlay = defaults.bool(forKey: "mayday.debug")
    #endif
    if defaults.object(forKey: "mayday.dynres") != nil { dynamicResolution = defaults.bool(forKey: "mayday.dynres") }
    let fps = defaults.integer(forKey: "mayday.fps")
    if fps == 60 || fps == 120 { preferredFPS = fps }
    do {
      let data = try DataBundle()
      if let cap = try? data.data("game")["derived"]["loop"]["dtCap"].double { dtCap = cap }
      let quality = defaults.string(forKey: "mayday.quality") ?? GameHost.defaultQuality()
      let weather = defaults.string(forKey: "mayday.weather")
      let s = try BootstrapSim(data: data, qualityName: quality, presetName: weather)
      let r = try Renderer(texturesDirectory: data.texturesDirectory, oceanConstants: s.ocean.constants)
      try r.prewarm(quality: s.quality)
      prewarmedQuality = s.quality
      sim = s
      renderer = r
    } catch let e as RenderError {
      fatalMessage = e.description
    } catch let e as DataBundleError {
      fatalMessage = e.description
    } catch let e {
      fatalMessage = "\(e)"
    }
  }

  /// Default tier per device (PLAN §1.4, X5): Mac → high; iPhone 15 Pro+ (apple9) / iPad M1+ → high;
  /// A15/A16 (apple8) → medium; older → low.
  static func defaultQuality() -> String {
    #if os(macOS)
    return "high"
    #else
    guard let dev = MTLCreateSystemDefaultDevice() else { return "low" }
    if dev.supportsFamily(.apple9) { return "high" }
    if UIDevice.current.userInterfaceIdiom == .pad && dev.supportsFamily(.apple7) { return "high" }
    if dev.supportsFamily(.apple8) { return "medium" }
    return "low"
    #endif
  }

  func configure(_ view: MTKView) {
    view.colorPixelFormat = .bgra8Unorm
    view.depthStencilPixelFormat = .invalid
    view.sampleCount = 1
    view.framebufferOnly = true
    view.preferredFramesPerSecond = preferredFPS
    view.isPaused = false
    view.enableSetNeedsDisplay = false
    view.autoResizeDrawable = true
    view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    #if os(macOS)
    view.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    #else
    (view.layer as? CAMetalLayer)?.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    #endif
  }

  func drawableSizeWillChange(_ size: CGSize) {
    // render targets follow RenderFrame.internalWidth/Height on the next frame
  }

  func setVirtualStick(_ v: SIMD2<Double>?) {
    if let v = v {
      virtualAxes["moveX"] = v.x
      virtualAxes["moveY"] = v.y
    } else {
      virtualAxes["moveX"] = 0
      virtualAxes["moveY"] = 0
    }
  }

  private func screenScale(_ view: MTKView) -> Double {
    #if os(macOS)
    return Double(view.window?.backingScaleFactor ?? 2)
    #else
    return Double(view.contentScaleFactor)
    #endif
  }

  /// One display-link tick (MTKViewDelegate.draw).
  func frame(_ view: MTKView) {
    guard let renderer = renderer, let sim = sim else { return }
    let now = CACurrentMediaTime()
    let frameDelta = lastTime > 0 ? now - lastTime : 1.0 / Double(preferredFPS)
    lastTime = now
    let realDt = min(max(frameDelta, 0), dtCap)

    let raw = devices.frame(virtualAxes: virtualAxes, virtualButtons: [:])
    sim.step(realDt: realDt, raw: raw)
    if sim.input.rawPressed("debug") || sim.input.rawPadPressed(11) { showOverlay.toggle() }
    if prewarmedQuality != sim.quality {
      do { try renderer.prewarm(quality: sim.quality) } catch { fatalMessage = "\(error)" }
      prewarmedQuality = sim.quality
    }

    let pts = view.bounds.size
    let scale = screenScale(view)
    let size = sim.internalSize(pointsWidth: Double(max(pts.width, 1)), pointsHeight: Double(max(pts.height, 1)), screenScale: scale)
    let pxScale = pts.width > 0 ? Float(view.drawableSize.width / pts.width) : Float(scale)
    var f = sim.renderFrame(internalWidth: size.0, internalHeight: size.1, pxScale: pxScale, dt: realDt)
    f.dynamicResolution = dynamicResolution
    f.framesPerSecond = view.preferredFramesPerSecond
    renderer.render(f) { view.currentDrawable }

    fpsAccum += frameDelta
    fpsFrames += 1
    overlayT += realDt
    if overlayT >= 0.25 {
      overlayT = 0
      publishOverlay(renderer: renderer, sim: sim)
    }
  }

  private func publishOverlay(renderer: Renderer, sim: BootstrapSim) {
    let st = renderer.stats
    var o = OverlayInfo()
    o.fps = fpsAccum > 0 ? Double(fpsFrames) / fpsAccum : 0
    fpsAccum = 0
    fpsFrames = 0
    o.cpuMs = st.cpuEncodeMs
    o.gpuMs = st.gpuMs
    o.internalSize = "\(st.viewportWidth)×\(st.viewportHeight) из \(st.internalWidth)×\(st.internalHeight)"
    o.drawableSize = "\(st.drawableWidth)×\(st.drawableHeight)"
    o.dynScale = st.dynScale
    o.msaa = st.sampleCount
    o.quality = sim.quality.name
    o.preset = sim.presetName
    let pal = PaletteSnapshot(packed: sim.palettes.packed(sim.presetName), offsets: sim.palettes.offsets)
    o.windText = String(format: "ветер %.0f м/с, курс 120°", pal.num("wind"))
    let ws = sim.ocean.bank.stats
    o.seaText = String(format: "Hs %.2f м (эфф. %.2f), Q %.2f", ws.Hs, ws.HsEff, ws.Q)
    if let p = sim.lastPose {
      o.cameraText = String(format: "камера H %.0f м, наклон %.1f°", p.heightM, p.tiltDeg)
    }
    o.probeText = String(format: "зонд x %.0f z %.0f, высота %.0f м", sim.probe.x, sim.probe.z, sim.probe.y)
    var flags: [String] = []
    if sim.paused { flags.append("ПАУЗА") }
    if sim.searchlightOn { flags.append("прожектор") }
    if sim.probeEffects { flags.append("винт") }
    if let pad = devices.padName { flags.append("геймпад: \(pad)") }
    o.flags = flags.joined(separator: " · ")
    o.device = renderer.device.device.name
    o.error = st.lastError
    overlay = o
  }
}
