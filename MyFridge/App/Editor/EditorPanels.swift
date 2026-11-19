import SwiftUI

/// Bottom panel for the selected thing: fastener, layers, copy, straighten, edit, take off.
struct SelectionPanel: View {
    @Environment(FridgeStore.self) private var store

    let placement: Placement
    let content: RenderContent
    let onDone: () -> Void
    let onSelect: (UUID) -> Void
    let onEditNote: (UUID) -> Void

    private var noteItemID: UUID? {
        guard case .item(let id) = placement.source, case .note = content else { return nil }
        return id
    }

    private var letter: LetterMagnet? {
        if case .letter(let letter) = placement.source { return letter }
        return nil
    }

    private var subtitle: String {
        switch content {
        case .magnet(let art):
            return art.note
        case .letter:
            return "Пластиковая буква"
        case .photo(let photo, _):
            switch photo.style {
            case .card: return "Держится на отдельном креплении"
            case .cutout: return "Вырезанный объект с толщиной"
            case .round, .heart: return "Фото под глянцевой линзой"
            }
        case .note(let note, _):
            return note.isTask ? "Отметь галочкой, когда сделаешь" : "Записка от руки"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(content.title)
                        .font(.serif(24))
                        .foregroundStyle(Color.ink)
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(Color.inkSoft)
                }
                Spacer()
                Button("Готово", action: onDone)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.ink)
            }
            .padding(.horizontal, 20)

            if content.acceptsFastener {
                fastenerPicker
            } else if let letter {
                letterColors(letter)
            } else {
                Text("Перетащи пальцем, а белым уголком измени размер и поворот — или сведи и поверни двумя пальцами.")
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSoft)
                    .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
                    .padding(.horizontal, 20)
            }

            tools
                .padding(.horizontal, 20)
        }
    }

    private var fastenerPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Крепление")
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FastenerChip(kind: nil, isSelected: placement.fastener == nil) {
                        setFastener(nil)
                    }
                    ForEach(FastenerKind.allCases) { kind in
                        FastenerChip(kind: kind, isSelected: placement.fastener?.kind == kind) {
                            setFastener(kind)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 2)
            }
        }
        .frame(height: 82, alignment: .top)
    }

    private func letterColors(_ letter: LetterMagnet) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Цвет")
                .padding(.horizontal, 20)
            HStack(spacing: 10) {
                ForEach(LetterColor.allCases) { color in
                    Button {
                        store.updatePlacement(placement.id) { stored in
                            stored.source = .letter(LetterMagnet(character: letter.character, color: color))
                        }
                        Feedback.select()
                    } label: {
                        Circle()
                            .fill(LinearGradient(colors: [color.tones[0], color.tones[2]], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 32, height: 32)
                            .overlay { Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 1) }
                            .padding(3)
                            .overlay {
                                Circle().strokeBorder(letter.color == color ? Color.ink : Color.clear, lineWidth: 2)
                            }
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 20)
        }
        .frame(height: 82, alignment: .top)
    }

    private var tools: some View {
        HStack(spacing: 7) {
            ToolButton(title: "Выше", systemImage: "square.3.layers.3d.top.filled") {
                store.bringForward(placement.id)
            }
            ToolButton(title: "Ниже", systemImage: "square.3.layers.3d.bottom.filled") {
                store.sendBackward(placement.id)
            }
            ToolButton(title: "Копия", systemImage: "plus.square.on.square") {
                if let copy = store.duplicate(placement.id) {
                    Feedback.attach()
                    onSelect(copy)
                }
            }
            ToolButton(title: "Ровно", systemImage: "level") {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) {
                    store.updatePlacement(placement.id) { $0.rotation = 0 }
                }
            }
            if let noteItemID {
                ToolButton(title: "Текст", systemImage: "pencil") {
                    onEditNote(noteItemID)
                }
            }
            ToolButton(title: "Снять", systemImage: "tray.and.arrow.down", isDestructive: true) {
                store.removePlacement(placement.id)
                onDone()
            }
        }
    }

    /// Swapping a fastener keeps its place on the card.
    private func setFastener(_ kind: FastenerKind?) {
        store.updatePlacement(placement.id) { stored in
            if let kind {
                if stored.fastener != nil {
                    stored.fastener?.kind = kind
                } else {
                    stored.fastener = .standard(kind)
                }
            } else {
                stored.fastener = nil
            }
        }
        Feedback.attach()
    }
}

private struct FastenerChip: View {
    let kind: FastenerKind?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                SteelTile(cornerRadius: 14)
                if let kind {
                    FastenerView(kind: kind, size: 24)
                } else {
                    Image(systemName: "nosign")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(white: 0.35))
                }
            }
            .frame(width: 54, height: 54)
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isSelected ? Color.ink : Color.clear, lineWidth: 2.5)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(kind?.title ?? "Без крепления")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
