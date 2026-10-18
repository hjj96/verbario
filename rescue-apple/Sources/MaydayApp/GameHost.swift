// GameHost — owns the game session (MaydayCore's real systems, GameSession), the renderer and the platform
// input / haptics, driven by the MTKView display link (PLAN §2.3, §2.8; web: main.js boot + frame).
//
//   frame:  nowMs = display clock → session.frame (pause poll, realDt = min(Δ, 0.1), look time,
//           gamepads + input.poll(), the systems in SYSTEMS order) → debug keys → render snapshot
//           (ocean.lateUpload, stand-in meshes) → Renderer → warm-up (PipelineCache.prewarm when the loop
//           asks for it: boot, mission:setup, quality changes; replaces core/warmup.js compileScene).
//   pixels: internal size = floor(points × pixelRatio), pixelRatio = min(screen scale, settings
//           pixelRatioCap(quality), max(1, √(1920·1080 / points²))) (main.js); the drawable stays native.
//   view:   bgra8Unorm drawable, colorspace sRGB (P3 panels must not oversaturate), no MTKView depth (the
//           renderer owns its targets), 60 fps (120 Hz is a later setting, PLAN X11).
// Launch arguments (NSArgumentDomain, PLAN §2.8): -mayday.quality, -mayday.weather, -mayday.tod,
// -mayday.persist NO (SettingsStore), -mayday.dynres NO, -mayday.debug YES|NO, -mayday.fps 60|120.
// Debug controls (outside the game's bindings, PLAN §10 X19): ` (the `debug` action) / pad View+R3 — overlay;
// [ ] / View+LB / View+RB — weather preset; F2 / View+Y — quality; F5 / View+Menu — restart the flight;
// the overlay's buttons on touch devices.
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
  var simMs: Double = 0
  var internalSize = ""
  var drawableSize = ""
  var dynScale: Double = 1
  var msaa = 1
  var quality = ""
  var preset = ""
  var weatherText = ""
  var seaText = ""
  var heliText = ""
  var heliText2 = ""
  var cameraText = ""
  var flags = ""
  var device = ""
  var error: String?
}

final class GameHost: ObservableObject {
  @Published private(set) var overlay = OverlayInfo()
  @Published var showOverlay: Bool
  @Published private(set) var fatalMessage: String? = nil
  /// ctx.mode == 'paused' (RootView shows the stand-in pause card until MaydayUI's PauseScreen, M4).
  @Published private(set) var paused = false

  let pads = GamepadAdapter()
  private(set) var session: GameSession?
  private(set) var renderer: Renderer?
  private var props: SceneProps?
  private var haptics: HapticsDriver?
  #if os(iOS)
  private(set) var touchHaptics: TouchHaptics?
  #endif
  private var dynamicResolution = true
  private var preferredFPS = 60
  private var viewportPoints = (width: 0.0, height: 0.0)
  private var fpsAccum = 0.0
  private var fpsFrames = 0
  private var simAccum = 0.0
  private var lastFrameMs = 0.0
  private var overlayT = 0.0

  var metalDevice: MTLDevice? { renderer?.device.device }
  var input: InputState? { session?.input }

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
      var options = SettingsStore.launchOptions()
      options.startMs = CACurrentMediaTime() * 1000
      let s = try GameSession(catalog: try data.catalog(), storage: SettingsStore.storage(), options: options)
      let r = try Renderer(texturesDirectory: data.texturesDirectory, oceanConstants: s.ocean.tables.waves)
      try r.prewarm(quality: s.quality)
      props = try SceneProps(renderer: r)
      session = s
      renderer = r
      wire(s)
    } catch let e as RenderError {
      fatalMessage = e.description
    } catch let e as DataBundleError {
      fatalMessage = e.description
    } catch let e {
      fatalMessage = "\(e)"
    }
  }

  /// Input and haptics adapters → the session.
  private func wire(_ s: GameSession) {
    let pads = self.pads
    s.gamepads = { pads.snapshots() }
    let driver = HapticsDriver(pads: pads)
    haptics = driver
    s.input.rumbleSink = { [weak driver] e in driver?.rumble(e) }
    pads.onDebug = { [weak self] cmd in self?.debug(cmd) }
    pads.onKey = { [weak self] code, down in
      if down { self?.keyDown(code, isRepeat: false) } else { self?.keyUp(code) }
    }
    #if os(iOS)
    let loop = s.loop
    touchHaptics = TouchHaptics(events: s.events, input: s.input, settings: s.settings, mode: { loop.mode })
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

  // ---- keyboard / debug -------------------------------------------------------------------------------------

  /// keydown (KeyboardEvent.code): the game's Input, then the debug keys outside its bindings.
  func keyDown(_ code: String, isRepeat: Bool) {
    guard let s = session else { return }
    s.input.keyDown(code, isRepeat: isRepeat)
    if isRepeat { return }
    switch code {
    case "BracketLeft": debug(.previousPreset)
    case "BracketRight": debug(.nextPreset)
    case "F2": debug(.cycleQuality)
    case "F5": debug(.restart)
    default: break
    }
  }

  func keyUp(_ code: String) { session?.input.keyUp(code) }

  func debug(_ cmd: DebugCommand) {
    guard let s = session else { return }
    switch cmd {
    case .previousPreset: s.cyclePreset(-1)
    case .nextPreset: s.cyclePreset(1)
    case .cycleQuality: s.cycleQuality()
    case .toggleOverlay: showOverlay.toggle()
    case .restart: s.mission.restart()
    }
  }

  /// The touch pause button (touch.js: hud.emit('ui:pause')).
  func touchPause() { session?.events.emit(GameEvent.UiPause()) }

  /// The pause card's «ПРОДОЛЖИТЬ» (ui/screens/pause.js: emit('ui:resume')).
  func resume() { session?.events.emit(GameEvent.UiResume()) }

  private func screenScale(_ view: MTKView) -> Double {
    #if os(macOS)
    return Double(view.window?.backingScaleFactor ?? 2)
    #else
    return Double(view.contentScaleFactor)
    #endif
  }

  // ---- frame ----------------------------------------------------------------------------------------------

  /// One display-link tick (MTKViewDelegate.draw).
  func frame(_ view: MTKView) {
    guard let renderer, let s = session else { return }
    let nowMs = CACurrentMediaTime() * 1000
    let pts = view.bounds.size
    let w = Double(max(pts.width, 1)), h = Double(max(pts.height, 1))
    if w != viewportPoints.width || h != viewportPoints.height {
      viewportPoints = (w, h)
      s.resize(width: w, height: h)
    }

    // internal size first: post.js reads the drawing-buffer height during its update (uCA)
    let ratio = s.pixelRatio(devicePixelRatio: screenScale(view), width: w, height: h)
    let iw = max(1, Int((w * ratio).rounded(.down)))
    let ih = max(1, Int((h * ratio).rounded(.down)))
    s.post.bufferHeight = Double(ih)

    let t0 = CACurrentMediaTime()
    s.frame(nowMs: nowMs)
    if s.input.rawPressed(.debug) { showOverlay.toggle() }
    let isPaused = s.loop.mode == .paused
    if isPaused != paused { paused = isPaused }
    #if os(iOS)
    (view as? GameMTKView)?.touchControls?.setOn(TouchMapping.visible(mode: s.loop.mode, lastDevice: s.input.lastDevice))
    #endif

    let pxScale = pts.width > 0 ? Float(view.drawableSize.width / pts.width) : Float(screenScale(view))
    var f = s.renderFrame(internalWidth: iw, internalHeight: ih, pxScale: pxScale)
    f.dynamicResolution = dynamicResolution
    f.framesPerSecond = view.preferredFramesPerSecond
    props?.update(s)
    simAccum += (CACurrentMediaTime() - t0) * 1000
    renderer.render(f) { view.currentDrawable }
    if s.loop.afterRender() {
      // core/warmup.js compileScene → every PSO of the current tier, synchronously (PipelineCache)
      do { try renderer.prewarm(quality: s.quality) } catch { fatalMessage = "\(error)" }
      s.loop.warmupCompiled()
    }

    let frameDelta = lastFrameMs > 0 ? (nowMs - lastFrameMs) / 1000 : 0
    lastFrameMs = nowMs
    fpsAccum += frameDelta
    fpsFrames += 1
    overlayT += frameDelta
    if overlayT >= 0.25 {
      overlayT = 0
      publishOverlay(renderer: renderer, session: s)
    }
  }

  private func publishOverlay(renderer: Renderer, session s: GameSession) {
    let st = renderer.stats
    var o = OverlayInfo()
    o.fps = fpsAccum > 0 ? Double(fpsFrames) / fpsAccum : 0
    o.simMs = fpsFrames > 0 ? simAccum / Double(fpsFrames) : 0
    fpsAccum = 0
    fpsFrames = 0
    simAccum = 0
    o.cpuMs = st.cpuEncodeMs
    o.gpuMs = st.gpuMs
    o.internalSize = "\(st.viewportWidth)×\(st.viewportHeight) из \(st.internalWidth)×\(st.internalHeight)"
    o.drawableSize = "\(st.drawableWidth)×\(st.drawableHeight)"
    o.dynScale = st.dynScale
    o.msaa = st.sampleCount
    o.quality = s.quality.name
    let w = s.weather.state
    o.preset = w.transition.active ? "\(w.transition.from) → \(w.preset) \(Int(w.transition.progress * 100)) %" : w.preset
    o.weatherText = String(format: "ветер %.1f м/с с %03.0f°, порыв %.1f, дождь %.2f, ночь %.2f, турб. %.2f",
                           w.windSpeed, w.windFrom, w.gust, w.rain, w.night, w.turbulence)
    let ws = s.ocean.waveStats
    o.seaText = String(format: "Hs %.2f м (эфф. %.2f), Q %.2f", ws.Hs, ws.HsEff, ws.Q)
    let h = s.heli
    let pad = h.landed.map { "площадка \($0.raw)" } ?? "в воздухе"
    o.heliText = String(format: "вертолёт H %.1f м (цель %.0f), %.1f м/с, курс %03.0f°, %@", h.altitude, h.altTarget, h.speed,
                        (h.heading * 180 / Double.pi + 360).truncatingRemainder(dividingBy: 360), pad)
    o.heliText2 = String(format: "топливо %.0f %%, корпус %.0f %%, ротор %.2f, лебёдка %@ %.1f м%@%@",
                         h.fuel * 100, h.hull * 100, h.rotorRPM, h.winch.state.rawValue, h.winch.length,
                         h.searchlight ? ", прожектор" : "", h.alive ? "" : ", АВАРИЯ")
    o.cameraText = String(format: "камера %@ H %.0f м, наклон %.1f°, зум %.2f", s.rig.mode.rawValue, s.rig.height, s.rig.tiltDeg, s.rig.zoom)
    var flags: [String] = [s.loop.mode.rawValue, "ввод: \(s.input.lastDevice.rawValue)"]
    if let pad = pads.padName { flags.append("геймпад: \(pad)") }
    if s.loop.disabled.count > 0 { flags.append("отключены: " + s.loop.disabled.map(\.rawValue).sorted().joined(separator: ", ")) }
    o.flags = flags.joined(separator: " · ")
    o.device = renderer.device.device.name
    o.error = st.lastError
    overlay = o
  }
}
