// DebugOverlay — the developer HUD (the web's `?debug` / showFps panel): frame timing, resolution, tier,
// weather, sea, the helicopter's state, camera, mode / input device. Toggle: ` (the game's `debug`
// action), pad View+R3, -mayday.debug. Plain SwiftUI text over the Metal view; the flight HUD proper is
// HudKit in Metal (M4). On touch devices it carries the debug buttons a keyboard would give.
import SwiftUI

struct DebugOverlay: View {
  let info: OverlayInfo
  /// Debug buttons (touch devices); nil = text only.
  var command: ((DebugCommand) -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      VStack(alignment: .leading, spacing: 2) {
        Text(String(format: "%.0f к/с · CPU %.1f мс (сим. %.1f) · GPU %.1f мс", info.fps, info.cpuMs, info.simMs, info.gpuMs))
        Text("кадр \(info.internalSize) → \(info.drawableSize) · MSAA ×\(info.msaa) · масштаб \(String(format: "%.2f", info.dynScale))")
        Text("качество \(info.quality) · погода \(info.preset)")
        Text(info.weatherText)
        Text(info.seaText)
        Text(info.heliText)
        Text(info.heliText2)
        Text(info.cameraText)
        if !info.flags.isEmpty { Text(info.flags) }
        Text(info.device).foregroundColor(.white.opacity(0.6))
        if let e = info.error { Text(e).foregroundColor(.red) }
        if command == nil {
          Text("` отладка · [ ] погода · F2 качество · F5 заново · геймпад: View + LB/RB, Y, R3, Menu")
            .foregroundColor(.white.opacity(0.6))
        }
      }
      .allowsHitTesting(false)   // touches under the text reach the game (the stick zone starts at 20 %)
      if let command {
        HStack(spacing: 8) {
          Button("◀ погода") { command(.previousPreset) }
          Button("погода ▶") { command(.nextPreset) }
          Button("качество") { command(.cycleQuality) }
          Button("заново") { command(.restart) }
        }
      }
    }
    .font(.system(size: 11, design: .monospaced))
    .foregroundColor(.white)
    .padding(8)
    .background(Color.black.opacity(0.45).allowsHitTesting(false))
    .clipShape(RoundedRectangle(cornerRadius: 4))
  }
}
