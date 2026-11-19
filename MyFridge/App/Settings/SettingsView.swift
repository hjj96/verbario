import SwiftUI

/// The door designer plus a few preferences.
struct SettingsView: View {
    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @AppStorage(Feedback.hapticsKey) private var hapticsEnabled = true
    @AppStorage(Feedback.soundKey) private var clickSoundEnabled = false
    @State private var nameplate = ""
    @State private var confirmsClear = false

    private static let nameplateLimit = 16

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    preview
                    finishes
                    handles
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
            .navigationTitle("Дверца")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .confirmationDialog("Снять всё с дверцы?", isPresented: $confirmsClear, titleVisibility: .visible) {
                Button("Снять всё", role: .destructive) {
                    store.clearDoor()
                }
                Button("Отмена", role: .cancel) {}
            } message: {
                Text("Дверца станет пустой. Фото и записки останутся в коллекции, а действие можно отменить.")
            }
            .onAppear { nameplate = store.design.nameplate }
        }
    }

    // MARK: Sections

    private var preview: some View {
        FridgeCompositionView(design: store.design, placements: store.state.door.placements) { placement in
            store.content(for: placement)
        }
        .aspectRatio(ItemMetrics.doorAspect, contentMode: .fit)
        .frame(maxWidth: 230)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: Color.black.opacity(0.22), radius: 16, y: 10)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .animation(.snappy, value: store.design)
    }

    private var finishes: some View {
        OptionSection(title: "Отделка") {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 14) {
                ForEach(DoorFinish.allCases) { finish in
                    Button {
                        store.updateDesign { $0.finish = finish }
                        Feedback.select()
                    } label: {
                        VStack(spacing: 6) {
                            Circle()
                                .fill(LinearGradient(colors: finish.swatch, startPoint: .topLeading, endPoint: .bottomTrailing))
                                .overlay {
                                    if !finish.palette.isEnamel {
                                        BrushedMetalTexture().clipShape(Circle()).opacity(0.7)
                                    }
                                }
                                .overlay { Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 1) }
                                .frame(width: 46, height: 46)
                                .padding(3)
                                .overlay {
                                    Circle().strokeBorder(store.design.finish == finish ? Color.ink : Color.clear, lineWidth: 2)
                                }
                            Text(finish.title)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.ink)
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                                .frame(height: 28, alignment: .top)
                        }
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityAddTraits(store.design.finish == finish ? .isSelected : [])
                }
            }
        }
    }

    private var handles: some View {
        OptionSection(title: "Ручка") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(HandleStyle.allCases) { handle in
                        ChoiceChip(title: handle.title, isSelected: store.design.handle == handle) {
                            store.updateDesign { $0.handle = handle }
                            Feedback.select()
                        }
                    }
                }
            }
        }
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
            Text("Хромированная надпись на крышке, как у старых холодильников. Оставь пустым, чтобы убрать.")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
        .onDisappear { commitNameplate() }
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
            Text("Дверца сохраняется после каждого изменения, и iOS обновляет виджет — обычно за несколько секунд. Дела на виджете отмечаются касанием галочки.")
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
            .disabled(store.state.door.placements.isEmpty)
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

    private func commitNameplate() {
        let value = nameplate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value != store.design.nameplate else { return }
        store.updateDesign { $0.nameplate = value }
    }
}
