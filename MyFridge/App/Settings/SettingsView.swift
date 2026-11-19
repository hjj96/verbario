import SwiftUI

struct SettingsView: View {
    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @AppStorage(Feedback.hapticsKey) private var hapticsEnabled = true
    @AppStorage(Feedback.soundKey) private var clickSoundEnabled = false
    @State private var confirmsClear = false

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(DoorStyle.allCases) { style in
                        Button {
                            store.setDoorStyle(style)
                            Feedback.select()
                        } label: {
                            StyleRow(style: style, isSelected: store.state.door.style == style)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Корпус")
                } footer: {
                    Text("Отделка меняется для всей дверцы, предметы остаются на своих местах.")
                }

                Section("Ощущения") {
                    Toggle("Вибрация при креплении", isOn: $hapticsEnabled)
                    Toggle("Тихий щелчок", isOn: $clickSoundEnabled)
                }

                Section {
                    NavigationLink {
                        WidgetGuideView()
                    } label: {
                        Label("Как добавить на домашний экран", systemImage: "apps.iphone.badge.plus")
                    }
                } header: {
                    Text("Виджет")
                } footer: {
                    Text("Дверца сохраняется после каждого изменения, и iOS обновляет виджет — обычно в течение нескольких секунд.")
                }

                Section {
                    Button("Снять всё с дверцы", role: .destructive) {
                        confirmsClear = true
                    }
                    .disabled(store.state.door.placements.isEmpty)
                } footer: {
                    Text("Фото и записки останутся в коллекции.")
                }

                Section("О приложении") {
                    LabeledContent("Версия", value: appVersion)
                    LabeledContent("Шрифты записок", value: "Caveat, Marck Script")
                }
            }
            .navigationTitle("Настройки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .confirmationDialog("Снять всё с дверцы?", isPresented: $confirmsClear, titleVisibility: .visible) {
                Button("Снять всё", role: .destructive) {
                    store.clearDoor()
                }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Дверца станет пустой. Предметы останутся в коллекции, а действие можно отменить.")
            }
        }
    }
}

private struct StyleRow: View {
    @Environment(FridgeStore.self) private var store

    let style: DoorStyle
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            FridgeCompositionView(style: style, placements: store.state.door.placements) { placement in
                store.content(for: placement)
            }
            .frame(width: 58, height: 58 / ItemMetrics.doorAspect)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .shadow(color: Color.black.opacity(0.15), radius: 3, y: 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(style.title)
                    .font(.body.weight(.semibold))
                Text(style.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.4))
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
