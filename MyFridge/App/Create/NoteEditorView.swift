import SwiftUI

/// A short note on paper: text, shape, paper colour and handwriting.
/// It can be a to-do with a checkbox and can remind about itself at a set time.
struct NoteEditorView: View {
    /// nil creates a new note.
    let editingItemID: UUID?
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var note = NoteContent(text: "")
    @State private var newItemID = UUID()
    @State private var didLoad = false
    @State private var hasReminder = false
    @State private var reminderDate = Date().addingTimeInterval(3600)
    @State private var notificationsDenied = false
    @FocusState private var isTextFocused: Bool

    private static let maxLength = 80

    private var trimmedText: String {
        note.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    preview
                    TextField("Например: Купить цветы", text: $note.text, axis: .vertical)
                        .font(.system(size: 18))
                        .lineLimit(1...4)
                        .focused($isTextFocused)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.card))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1)
                        }
                        .onChange(of: note.text) { _, newValue in
                            if newValue.count > Self.maxLength {
                                note.text = String(newValue.prefix(Self.maxLength))
                            }
                        }
                    OptionSection(title: "Форма") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(NoteShape.allCases) { shape in
                                    ChoiceChip(title: shape.title, isSelected: note.shape == shape) {
                                        note.shape = shape
                                    }
                                }
                            }
                        }
                    }
                    OptionSection(title: "Бумага") {
                        HStack(spacing: 12) {
                            ForEach(PaperColor.allCases) { paper in
                                PaperSwatch(paper: paper, isSelected: note.paper == paper) {
                                    note.paper = paper
                                }
                            }
                        }
                    }
                    if note.shape != .ticket {
                        OptionSection(title: "Почерк") {
                            HStack(spacing: 8) {
                                ForEach(NoteFont.allCases) { font in
                                    ChoiceChip(title: font.title,
                                               font: font.font(size: 17 * font.sizeFactor),
                                               isSelected: note.font == font) {
                                        note.font = font
                                    }
                                }
                            }
                        }
                        extras
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.paper)
            .navigationTitle(editingItemID == nil ? "Новая записка" : "Записка")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editingItemID == nil ? "Прикрепить" : "Сохранить") { save() }
                        .fontWeight(.semibold)
                        .disabled(trimmedText.isEmpty)
                }
            }
            .onAppear { load() }
        }
    }

    private var preview: some View {
        let itemID = editingItemID ?? newItemID
        var shown = note
        if shown.text.isEmpty {
            shown.text = "Купить цветы"
        }
        shown.reminder = hasReminder ? reminderDate : nil
        return ZStack {
            DoorPanelView(finish: store.design.finish, cornerRadius: 24)
            ItemPreview(content: .note(shown, id: itemID),
                        fastener: note.shape.defaultFastener,
                        rotation: -2,
                        width: note.shape == .ticket ? 220 : 180)
                .opacity(note.text.isEmpty ? 0.55 : 1)
        }
        .environment(\.noteInteraction, .app({ _ in note.isDone.toggle() }))
        .frame(maxWidth: .infinity)
        .frame(height: 230)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.snappy, value: note)
    }

    private var extras: some View {
        PaperCard {
            Toggle(isOn: $note.isTask.animation(.snappy)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Дело с галочкой")
                        .font(.body.weight(.medium))
                    Text("Отмечается прямо на виджете")
                        .font(.footnote)
                        .foregroundStyle(Color.inkSoft)
                }
            }
            Divider()
            Toggle(isOn: $hasReminder.animation(.snappy)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Напомнить")
                        .font(.body.weight(.medium))
                    Text("Придёт уведомление с текстом записки")
                        .font(.footnote)
                        .foregroundStyle(Color.inkSoft)
                }
            }
            .onChange(of: hasReminder) { _, isOn in
                guard isOn else { return }
                Task { @MainActor in
                    let allowed = await Reminders.requestPermission()
                    notificationsDenied = !allowed
                    if !allowed {
                        hasReminder = false
                    }
                }
            }
            if hasReminder {
                DatePicker("Когда", selection: $reminderDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
            }
            if notificationsDenied {
                Text("Уведомления выключены. Их можно включить в Настройках iPhone → Холодильник.")
                    .font(.footnote)
                    .foregroundStyle(Color(hex: 0xC8372D))
            }
        }
        .tint(Color(hex: 0x2F55D4))
    }

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        if let editingItemID,
           let item = store.state.item(editingItemID),
           case .note(let existing) = item.content {
            note = existing
            if let reminder = existing.reminder {
                hasReminder = true
                reminderDate = reminder
            }
        } else {
            note = NoteContent(text: "", paper: .cream, shape: .torn, font: .caveat)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 450_000_000)
                isTextFocused = true
            }
        }
    }

    private func save() {
        var finished = note
        finished.text = trimmedText
        finished.reminder = hasReminder && note.shape != .ticket ? reminderDate : nil
        if note.shape == .ticket {
            finished.isTask = false
        }
        guard !finished.text.isEmpty else { return }
        if let editingItemID {
            store.updateNote(itemID: editingItemID, note: finished)
        } else if let placementID = store.addNote(finished, id: newItemID) {
            onPlaced(placementID)
        }
        dismiss()
    }
}

private struct PaperSwatch: View {
    let paper: PaperColor
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(LinearGradient(colors: [paper.base, paper.shade], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 38, height: 38)
                .overlay {
                    Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 1)
                }
                .padding(3)
                .overlay {
                    Circle().strokeBorder(isSelected ? Color.ink : Color.clear, lineWidth: 2)
                }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(paper.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
