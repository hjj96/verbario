// MAYDAY — iOS / iPadOS entry point (PLAN §2.8): landscape only, full screen, no status bar or home
// indicator; one window scene hosting RootView (MetalView + overlays).
import SwiftUI

@main
struct MaydayIOSApp: App {
  @StateObject private var host = GameHost()

  var body: some Scene {
    WindowGroup {
      RootView(host: host)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
    }
  }
}
