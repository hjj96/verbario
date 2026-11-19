import SwiftUI

/// A short note on paper: text, shape, paper colour and handwriting.
struct NoteEditorView: View {
    /// nil creates a new note.
    let editingItemID: UUID?
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var note = NoteContent(text: "")
    @State private var newItemID = UUID()
    @State private var didLoad = false
    @FocusState private var isTextFocused: Bool

    private static let maxLength = 80

    private var trimmedText: String {
        note.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    preview
                    TextField("Например: Купить цветы", text: $note.text, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($isTextFocused)
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.tileBackground))
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
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
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
            .onAppear(perform: load)
        }
    }

    private var preview: some View {
        let seed = (editingItemID ?? newItemID).seed
        var shown = note
        if shown.text.isEmpty {
            shown.text = "Купить цветы"
        }
        return ZStack {
            DoorPanelView(palette: store.state.door.style.palette, cornerRadius: 22)
            ItemPreview(content: .note(shown, seed: seed),
                        fastener: note.shape.defaultFastener,
                        rotation: -2,
                        width: note.shape == .ticket ? 210 : 170)
                .opacity(note.text.isEmpty ? 0.55 : 1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 220)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .animation(.snappy, value: note)
    }

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        if let editingItemID,
           let item = store.state.item(editingItemID),
           case .note(let existing) = item.content {
            note = existing
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
                    Circle().strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 2.5)
                }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(paper.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
