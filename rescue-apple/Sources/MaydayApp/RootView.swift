// RootView — SwiftUI root shared by iOS and macOS (PLAN §2.8):
// ZStack(MetalView (+ touch controls inside it on iOS), debug overlay, pause card, FatalOverlay). Paper
// screens (MaydayUI: PauseScreen and the rest) join the stack in M4; until then the pause card is the way
// back into the flight on a touch screen (Esc / Start also resume).
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
      if host.paused && host.fatalMessage == nil {
        PauseCard(resume: { [weak host] in host?.resume() })
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

/// Stand-in for ui/screens/pause.js until MaydayUI (M4): the paused flight and «ПРОДОЛЖИТЬ» (ui:resume).
struct PauseCard: View {
  let resume: () -> Void

  var body: some View {
    VStack(spacing: 14) {
      Text("ПАУЗА")
        .font(.system(size: 26, weight: .semibold))
      Button("ПРОДОЛЖИТЬ", action: resume)
        .font(.system(size: 15, weight: .semibold, design: .monospaced))
    }
    .foregroundColor(.white)
    .padding(28)
    .background(Color.black.opacity(0.55))
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
