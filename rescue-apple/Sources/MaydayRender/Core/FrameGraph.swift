// FrameGraph — the FIXED list of passes of one frame, in execution order (PLAN §2.5 «Проходы кадра»).
// Not a general graph: the order never changes, a pass is either encoded or skipped. Renderer uses the
// labels for encoders / GPU captures; `isPorted` documents which passes the current milestone encodes.
//
//   1  envRebake      compute: EnvSky → cube 128² rgba16Float + GGX prefilter (EnvRebakePolicy)   M2
//   2  waterMemory    ping-pong rgba16Float 512/384: advect + instanced stamps (additive)          M2
//   3  waterRings     ring-buffer resample of WaterRings vertices                                  M3
//   4  shadow         depth32Float 512/1024/2048, light ortho camera snapped to texels             M2
//   5  thermal        rg8Unorm heat/mass + depth at 0.3/0.4/0.5 (only while the FLIR is visible)    M3
//   6  scene          MSAA rgba16Float (memoryless) + depth32Float → resolve into sceneHDR         M0 (ocean)
//   7  bloom          high-pass + 5 mips × H/V blur (kernels 6/10/14/18/22)                         M2
//   8  compositeOutput  sRGB_OETF(ACES(exposure · (sceneHDR + bloom))) → post (rgba16Float)        M0
//   9  final          FinalPass → drawable (bgra8Unorm, layer colorspace sRGB)                       M0
//   10 photoCapture   FinalPass copy → offscreen → CGImage (photo mode, on request)                M8
//   11 hud            HudKit over the drawable (gamma-space blending), then present                M5
public enum FramePass: Int, CaseIterable, CustomStringConvertible {
  case envRebake = 1
  case waterMemory
  case waterRings
  case shadow
  case thermal
  case scene
  case bloom
  case compositeOutput
  case final
  case photoCapture
  case hud

  /// Encoder / debug-group label (also what a GPU capture shows).
  public var label: String {
    switch self {
    case .envRebake: return "envRebake"
    case .waterMemory: return "waterMemory"
    case .waterRings: return "waterRings"
    case .shadow: return "shadow"
    case .thermal: return "thermal"
    case .scene: return "scene"
    case .bloom: return "bloom"
    case .compositeOutput: return "composite+output"
    case .final: return "final"
    case .photoCapture: return "photoCapture"
    case .hud: return "hud"
    }
  }

  /// Encoded by the current renderer (M0: the sea, its grade and the FinalPass).
  public var isPorted: Bool {
    switch self {
    case .scene, .compositeOutput, .final: return true
    default: return false
    }
  }

  public var description: String { "\(rawValue). \(label)" }
}
