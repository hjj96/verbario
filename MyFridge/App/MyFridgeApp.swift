import SwiftUI

@main
struct MyFridgeApp: App {
    @State private var store = FridgeStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            EditorView()
                .environment(store)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                store.flushPendingSave()
            }
        }
    }
}
