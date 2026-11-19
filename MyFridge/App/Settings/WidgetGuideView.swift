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
         "Чтобы что-то поменять, коснись дверцы — откроется редактор. Галочки на делах отмечаются прямо на виджете."),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(alignment: .bottom, spacing: 16) {
                    preview(width: 156, square: false)
                    preview(width: 78, square: true)
                    Spacer(minLength: 0)
                }
                .padding(.top, 8)

                Text("Один раз добавь виджет — дальше дверца сама будет на домашнем экране.")
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
        .navigationTitle("Виджет")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func preview(width: CGFloat, square: Bool) -> some View {
        FridgeCompositionView(design: store.design, placements: store.state.door.placements) { placement in
            store.content(for: placement)
        }
        .frame(width: width, height: square ? width : width / ItemMetrics.doorAspect)
        .clipShape(RoundedRectangle(cornerRadius: width * 0.14, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 8, y: 4)
    }
}
