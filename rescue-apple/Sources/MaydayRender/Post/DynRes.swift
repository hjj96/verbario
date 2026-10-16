// DynRes — dynamic resolution and the internal pixel-ratio rule of rescue/src/systems/post.js
// (_dynamicResolution, resize) and main.js (pixelRatio) (PLAN §2.5 «Динамическое разрешение», D11, X1/X2;
// DESIGN §8.2):
//   * 1 s windows of frame time; mean > 18 ms → scale −0.05, < 13 ms → +0.05, within MIN_SCALE
//     (low 0.67, medium 0.75, high 0.8) … 1; frozen while paused or in photo mode; `?dynres=0` /
//     `-mayday.dynres NO` disables it;
//   * quality hint: > 22 ms for 10 consecutive windows at the minimum scale → suggest one tier lower, once;
//   * deviations: the frame time is the GPU time of the command buffers (X2: rAF time is meaningless at
//     60/120 Hz); high never drops MSAA 4 → 2 on the fly (X1: sample count is part of the PSO).
// The renderer applies the scale as a viewport sub-rectangle of targets allocated at full size.
// TODO(Core): PLAN places DynResController in MaydayCore/Post/DynRes.swift (pure logic; moves verbatim).
import Foundation
import MaydayCore

public struct QualityHint: Equatable {
  public let quality: String
  public let suggest: String
  public let frameMs: Double
}

public struct DynResController {
  public static let MIN_SCALE: [String: Double] = ["low": 0.67, "medium": 0.75, "high": 0.8]
  public static let MAX_PIXELS: Double = 1920 * 1080

  public var enabled: Bool
  public private(set) var quality: String
  public private(set) var scale: Double = 1
  public private(set) var frameMs: Double = 16
  public private(set) var atMinScale = false
  private var acc: Double = 0
  private var n = 0
  private var gpuSum: Double = 0
  private var gpuN = 0
  private var slowSeconds = 0
  private var hinted = false

  public init(quality: String, enabled: Bool = true) {
    self.quality = quality
    self.enabled = enabled
  }

  /// _applyQuality: the scale restarts at 1.
  public mutating func applyQuality(_ q: String) {
    quality = q
    scale = 1
  }

  /// Adds one GPU frame time (ms) to the current window (from MTLCommandBuffer gpuStart/EndTime).
  public mutating func addGPUSample(ms: Double) {
    guard ms > 0, ms < 1000 else { return }
    gpuSum += ms
    gpuN += 1
  }

  /// One frame (realDt seconds). Returns a quality hint the first time one is due.
  @discardableResult
  public mutating func update(dt: Double, paused: Bool = false, photo: Bool = false) -> QualityHint? {
    acc += dt
    n += 1
    if acc < 1 { return nil }
    // X2: the GPU mean of the window when the device reported any, else the web's frame-time mean
    let ms = gpuN > 0 ? gpuSum / Double(gpuN) : (acc / Double(n)) * 1000
    acc = 0
    n = 0
    gpuSum = 0
    gpuN = 0
    frameMs = ms
    if !enabled || paused || photo { return nil }
    let minScale = DynResController.MIN_SCALE[quality] ?? 0.8
    var next = scale
    if ms > 18 { next = JS.max(minScale, scale - 0.05) } else if ms < 13 { next = JS.min(1, scale + 0.05) }
    let atMin = next <= minScale + 1e-3
    atMinScale = atMin
    if JS.abs(next - scale) > 1e-3 { scale = next }
    // quality hint (§7.6): > 22 ms for 10 s at the minimum scale → suggest a lower preset once
    slowSeconds = atMin && ms > 22 ? slowSeconds + 1 : 0
    if !hinted && slowSeconds >= 10 && quality != "low" {
      hinted = true
      return QualityHint(quality: quality, suggest: quality == "high" ? "medium" : "low", frameMs: ms)
    }
    return nil
  }

  /// main.js pixelRatio(): min(devicePixelRatio, settings.pixelRatioCap(), max(1, √(1920·1080 / (w·h)))).
  public static func basePixelRatio(devicePixelRatio: Double, pixelRatioCap: Double, width w: Double, height h: Double) -> Double {
    JS.min(JS.min(devicePixelRatio, pixelRatioCap), JS.max(1, JS.sqrt((1920 * 1080) / (w * h))))
  }

  /// post.js resize(): composer pixel ratio = max(0.25, min(prBase, max(cap, 0.5)) · scale),
  /// cap = √(MAX_PIXELS / max(1, w·h)) (w, h in points / CSS px).
  public static func composerPixelRatio(base prBase: Double, width w: Double, height h: Double, scale: Double) -> Double {
    let cap = JS.sqrt(MAX_PIXELS / JS.max(1, w * h))
    return JS.max(0.25, JS.min(prBase, JS.max(cap, 0.5)) * scale)
  }
}
