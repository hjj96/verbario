import SwiftUI

@main
struct MyFridgeApp: App {
    @State private var store = FridgeStore()
    @State private var motion = MotionLight()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            EditorView()
                .environment(store)
                .environment(motion)
                .tint(Color.ink)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                store.reloadIfChangedOutside()
            case .inactive, .background:
                store.flushPendingSave()
            @unknown default:
                break
            }
        }
    }
}
