import SwiftUI

/// The designer of the current fridge plus a few app preferences.
struct SettingsView: View {
    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @AppStorage(Feedback.hapticsKey) private var hapticsEnabled = true
    @AppStorage(Feedback.soundKey) private var clickSoundEnabled = false
    @State private var name = ""
    @State private var nameplate = ""
    @State private var confirmsClear = false

    private static let nameplateLimit = 16

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    private var designBinding: Binding<DoorDesign> {
        Binding(get: { store.design }, set: { newValue in
            store.updateDesign { $0 = newValue }
        })
    }

    private var formatBinding: Binding<FridgeFormat> {
        Binding(get: { store.format }, set: { store.setFormat($0) })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    preview
                    OptionSection(title: "Название") {
                        TextField("Например, Кухня", text: $name)
                            .font(.serif(22))
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.card))
                            .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1) }
                            .submitLabel(.done)
                            .onSubmit { commitName() }
                    }
                    FormatPicker(format: formatBinding)
                    FinishPicker(design: designBinding, format: store.format)
                    plate
                    feelings
                    widget
                    door
                    about
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.paper)
            .navigationTitle("Холодильник")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") {
                        commitName()
                        commitNameplate()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .confirmationDialog("Снять всё с дверцы?", isPresented: $confirmsClear, titleVisibility: .visible) {
                Button("Снять всё", role: .destructive) {
                    store.clearDoor()
                }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Дверца станет пустой. Стикеры, фото и записки останутся в коллекции, а действие можно отменить.")
            }
            .onAppear {
                name = store.fridge.name
                nameplate = store.design.nameplate
            }
            .onDisappear {
                commitName()
                commitNameplate()
            }
        }
    }

    // MARK: Sections

    private var preview: some View {
        FridgeCompositionView(fridge: store.fridge) { placement in
            store.content(for: placement)
        }
        .aspectRatio(store.format.aspect, contentMode: .fit)
        .frame(maxWidth: store.format == .wide ? CGFloat.infinity : 240)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: Color.black.opacity(0.24), radius: 16, y: 10)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .animation(.snappy, value: store.design)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: store.format)
    }

    private var plate: some View {
        OptionSection(title: "Табличка") {
            TextField("Например: Дом, Семья, Дача", text: $nameplate)
                .font(.custom("MarckScript-Regular", size: 22))
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.card))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1)
                }
                .submitLabel(.done)
                .onChange(of: nameplate) { _, newValue in
                    if newValue.count > Self.nameplateLimit {
                        nameplate = String(newValue.prefix(Self.nameplateLimit))
                    }
                }
                .onSubmit { commitNameplate() }
            Text("Хромированная надпись наверху дверцы, как у старых холодильников. Оставь пустым, чтобы убрать.")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }

    private var feelings: some View {
        OptionSection(title: "Ощущения") {
            PaperCard {
                Toggle("Вибрация при креплении", isOn: $hapticsEnabled)
                Divider()
                Toggle("Тихий щелчок", isOn: $clickSoundEnabled)
            }
            .tint(Color(hex: 0x2F55D4))
        }
    }

    private var widget: some View {
        OptionSection(title: "Виджет") {
            NavigationLink {
                WidgetGuideView()
            } label: {
                PaperCard {
                    HStack {
                        Label("Как добавить на домашний экран", systemImage: "apps.iphone.badge.plus")
                            .foregroundStyle(Color.ink)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.inkSoft)
                    }
                }
            }
            .buttonStyle(.plain)
            Text("Виджет бывает маленьким, средним и большим. Удержи его на домашнем экране и нажми «Изменить виджет», чтобы выбрать, какой холодильник он показывает.")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }

    private var door: some View {
        OptionSection(title: "Дверца") {
            Button {
                confirmsClear = true
            } label: {
                PaperCard {
                    Label("Снять всё с дверцы", systemImage: "tray.and.arrow.down")
                        .foregroundStyle(Color(hex: 0xC8372D))
                }
            }
            .buttonStyle(.plain)
            .disabled(store.placements.isEmpty)
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "О приложении")
            Text("Мой холодильник \(appVersion)")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
            Text("Шрифты записок: Caveat и Marck Script, SIL Open Font License.")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }

    private func commitName() {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value != store.fridge.name else { return }
        store.renameFridge(store.fridge.id, to: value)
    }

    private func commitNameplate() {
        let value = nameplate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value != store.design.nameplate else { return }
        store.updateDesign { $0.nameplate = value }
    }
}
