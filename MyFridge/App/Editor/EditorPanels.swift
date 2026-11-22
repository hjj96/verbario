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

    /// The collection item behind a sticker or cut-out magnet, with its current finish.
    private var cutoutItem: (id: UUID, style: PhotoStyle)? {
        guard case .item(let id) = placement.source, case .photo(let photo, _) = content, photo.style.isCutoutFamily else { return nil }
        return (id, photo.style)
    }

    /// The polaroid behind this placement, if it is one.
    private var polaroidItem: (id: UUID, caption: String)? {
        guard case .item(let id) = placement.source, case .photo(let photo, _) = content, photo.style == .polaroid else { return nil }
        return (id, photo.caption)
    }

    @State private var editsCaption = false
    @State private var captionDraft = ""

    private var letter: LetterMagnet? {
        if case .letter(let letter) = placement.source { return letter }
        return nil
    }

    private var subtitle: String {
        switch content {
        case .magnet(let art):
            return art.note
        case .letter:
            return "Plastic letter"
        case .photo(let photo, _):
            switch photo.style {
            case .card: return "Held by a separate magnet"
            case .polaroid: return photo.caption.isEmpty ? "Add a handwritten caption" : "“\(photo.caption)”"
            case .cutout: return "A cut-out with real thickness"
            case .sticker: return "A flat vinyl sticker"
            case .holo: return "Shimmers when you tilt your phone"
            case .round, .heart: return "A photo under a glossy dome"
            }
        case .note(let note, _):
            return note.isTask ? "Tick it off when it’s done" : "A handwritten note"
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
                Button("Done", action: onDone)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.ink)
            }
            .padding(.horizontal, 20)

            if content.acceptsFastener {
                fastenerPicker
            } else if let cutoutItem {
                finishPicker(itemID: cutoutItem.id, current: cutoutItem.style)
            } else if let letter {
                letterColors(letter)
            } else {
                Text("Drag to move. Use the white corner to resize and rotate, or pinch and twist with two fingers.")
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSoft)
                    .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
                    .padding(.horizontal, 20)
            }

            tools
                .padding(.horizontal, 20)
        }
        .alert("Caption", isPresented: $editsCaption) {
            TextField("For example, Summer 2026", text: $captionDraft)
            Button("Done") {
                if let polaroidItem {
                    store.setCaption(itemID: polaroidItem.id, caption: captionDraft)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A handwritten line under the photo.")
        }
    }

    private var fastenerPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Holder")
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

    private func finishPicker(itemID: UUID, current: PhotoStyle) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Make")
                .padding(.horizontal, 20)
            HStack(spacing: 8) {
                ForEach(PhotoStyle.cutoutFinishes) { style in
                    ChoiceChip(title: style.title, isSelected: current == style) {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
                            store.setPhotoStyle(itemID: itemID, style: style)
                        }
                        Feedback.attach()
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .frame(height: 82, alignment: .top)
    }

    private func letterColors(_ letter: LetterMagnet) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Color")
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
            ToolButton(title: "Forward", systemImage: "square.3.layers.3d.top.filled") {
                store.bringForward(placement.id)
            }
            ToolButton(title: "Backward", systemImage: "square.3.layers.3d.bottom.filled") {
                store.sendBackward(placement.id)
            }
            ToolButton(title: "Copy", systemImage: "plus.square.on.square") {
                if let copy = store.duplicate(placement.id) {
                    Feedback.attach()
                    onSelect(copy)
                }
            }
            ToolButton(title: "Straighten", systemImage: "level") {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) {
                    store.updatePlacement(placement.id) { $0.rotation = 0 }
                }
            }
            if let noteItemID {
                ToolButton(title: "Text", systemImage: "pencil") {
                    onEditNote(noteItemID)
                }
            }
            if let polaroidItem {
                ToolButton(title: "Caption", systemImage: "signature") {
                    captionDraft = polaroidItem.caption
                    editsCaption = true
                }
            }
            ToolButton(title: "Take off", systemImage: "tray.and.arrow.down", isDestructive: true) {
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
        .accessibilityLabel(kind?.title ?? "No holder")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
