// RootView — SwiftUI root shared by iOS and macOS (PLAN §2.8):
// ZStack(MetalView (+ touch controls inside it on iOS), FatalOverlay, debug overlay). Paper screens
// (MaydayUI) join the stack in M4.
import SwiftUI

struct RootView: View {
  @ObservedObject var host: GameHost

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.black.ignoresSafeArea()
      if host.fatalMessage == nil {
        MetalView(host: host)
          .ignoresSafeArea()
      }
      if host.showOverlay && host.fatalMessage == nil {
        #if os(iOS)
        DebugOverlay(info: host.overlay, command: { [weak host] c in host?.debug(c) })
          .padding(12)
        #else
        DebugOverlay(info: host.overlay)
          .padding(12)
          .allowsHitTesting(false)
        #endif
      }
      if let message = host.fatalMessage {
        FatalOverlay(message: message)
      }
    }
  }
}

/// Unrecoverable start-up failure (no Metal, missing data, shader library) — shown instead of a crash.
struct FatalOverlay: View {
  let message: String

  var body: some View {
    VStack(spacing: 12) {
      Text("MAYDAY не может запуститься")
        .font(.system(size: 22, weight: .semibold))
      Text(message)
        .font(.system(size: 14, design: .monospaced))
        .multilineTextAlignment(.center)
    }
    .foregroundColor(.white)
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
