import SwiftUI

/// The one-time system flow for adding the widget. After that the person just taps the
/// fridge on the Home Screen to come back to the editor.
struct WidgetGuideView: View {
    @Environment(FridgeStore.self) private var store

    private let steps: [(title: String, text: String)] = [
        ("Touch and hold",
         "Touch and hold an empty spot on your Home Screen until the apps jiggle."),
        ("Add a widget",
         "Tap “Edit” in the top-left corner and choose “Add Widget” (on older iOS, tap “+”)."),
        ("Find My Fridge",
         "Search for “My Fridge” and pick a size: small, medium or large."),
        ("Choose a fridge",
         "Touch and hold the widget and tap “Edit Widget” to choose which fridge it shows. You can add several."),
        ("Tap to come back",
         "To change something, tap the door to open the editor. To-dos can be ticked right on the widget."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(alignment: .bottom, spacing: 16) {
                    preview(height: 150)
                    preview(height: store.format == .wide ? 40 : 76)
                    Spacer(minLength: 0)
                }
                .padding(.top, 8)

                Text("Add the widget once, and your door will live on your Home Screen.")
                    .font(.serif(24))
                    .foregroundStyle(Color.ink)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 22) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            Text(String(format: "%02d", index + 1))
                                .font(.serif(30))
                                .foregroundStyle(Color(hex: 0x2F55D4))
                                .frame(width: 44, alignment: .leading)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(step.title)
                                    .font(.headline)
                                    .foregroundStyle(Color.ink)
                                Text(step.text)
                                    .font(.subheadline)
                                    .foregroundStyle(Color.inkSoft)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color.paper)
        .navigationTitle("Widget")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func preview(height: CGFloat) -> some View {
        let fridge = store.fridge
        let width = height * fridge.format.aspect
        return FridgeCompositionView(fridge: fridge) { placement in
            store.content(for: placement)
        }
        .frame(width: min(width, 230), height: min(width, 230) / fridge.format.aspect)
        .clipShape(RoundedRectangle(cornerRadius: min(height, 150) * 0.14, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 8, y: 4)
    }
}
