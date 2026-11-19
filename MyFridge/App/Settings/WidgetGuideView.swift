import SwiftUI

/// The one-time system flow for adding the widget. After that the person just taps the
/// fridge on the Home Screen to come back to the editor.
struct WidgetGuideView: View {
    @Environment(FridgeStore.self) private var store

    private let steps: [(title: String, text: String)] = [
        ("Удерживай экран",
         "Нажми и подержи палец на свободном месте домашнего экрана, пока иконки не начнут покачиваться."),
        ("Добавь виджет",
         "Нажми «Изменить» в левом верхнем углу и выбери «Добавить виджет» (в старых версиях iOS — кнопка «+»)."),
        ("Найди холодильник",
         "Введи в поиске «Холодильник» и выбери размер: маленький или большой."),
        ("Возвращайся касанием",
         "Нажми «Добавить виджет». Чтобы что-то поменять, просто коснись дверцы — откроется редактор."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(alignment: .bottom, spacing: 14) {
                    preview(width: 150)
                    preview(width: 72)
                    Spacer(minLength: 0)
                }
                .padding(.top, 8)

                Text("Один раз добавь виджет — дальше дверца сама будет на домашнем экране.")
                    .font(.title3.weight(.semibold))

                VStack(alignment: .leading, spacing: 20) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            Text(String(format: "%02d", index + 1))
                                .font(.system(size: 30, weight: .regular, design: .serif))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 44, alignment: .leading)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(step.title)
                                    .font(.headline)
                                Text(step.text)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Виджет")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func preview(width: CGFloat) -> some View {
        FridgeCompositionView(style: store.state.door.style, placements: store.state.door.placements) { placement in
            store.content(for: placement)
        }
        .frame(width: width, height: width / ItemMetrics.doorAspect)
        .clipShape(RoundedRectangle(cornerRadius: width * 0.14, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 8, y: 4)
    }
}
