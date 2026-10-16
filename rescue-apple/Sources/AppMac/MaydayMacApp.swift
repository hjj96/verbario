// MAYDAY — macOS entry point (PLAN §2.8): a single game window (Apple silicon, native AppKit +
// SwiftUI, not Catalyst); closing it quits the app. ⌘Q / ⌘W / ⌃⌘F stay system shortcuts.
import SwiftUI
import AppKit

final class MaydayAppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct MaydayMacApp: App {
  @NSApplicationDelegateAdaptor(MaydayAppDelegate.self) private var appDelegate
  @StateObject private var host = GameHost()

  var body: some Scene {
    Window("MAYDAY", id: "main") {
      RootView(host: host)
        .frame(minWidth: 960, minHeight: 540)
        .preferredColorScheme(.dark)
    }
    .defaultSize(width: 1600, height: 900)
    .commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}
