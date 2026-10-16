// DebugOverlay — minimal developer HUD (the web's `?debug` / showFps panel). Toggle: ` (debug action)
// or pad R3. Plain SwiftUI text over the Metal view; the real flight HUD is HudKit in Metal (M5).
import SwiftUI

struct DebugOverlay: View {
  let info: OverlayInfo

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(String(format: "%.0f к/с · CPU %.1f мс · GPU %.1f мс", info.fps, info.cpuMs, info.gpuMs))
      Text("кадр \(info.internalSize) → \(info.drawableSize) · MSAA ×\(info.msaa) · масштаб \(String(format: "%.2f", info.dynScale))")
      Text("качество \(info.quality) · погода \(info.preset)")
      Text(info.windText)
      Text(info.seaText)
      if !info.cameraText.isEmpty { Text(info.cameraText) }
      Text(info.probeText)
      if !info.flags.isEmpty { Text(info.flags) }
      Text(info.device).foregroundColor(.white.opacity(0.6))
      if let e = info.error { Text(e).foregroundColor(.red) }
      Text("[ ] погода · F2 качество · WASD/стик полёт · Q/E высота · 1/2/3 · L прожектор · H винт · G всплеск · Z зум · Esc пауза")
        .foregroundColor(.white.opacity(0.6))
    }
    .font(.system(size: 11, design: .monospaced))
    .foregroundColor(.white)
    .padding(8)
    .background(Color.black.opacity(0.45))
    .clipShape(RoundedRectangle(cornerRadius: 4))
  }
}
