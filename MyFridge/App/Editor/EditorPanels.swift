import SwiftUI

/// Bottom panel when nothing is selected: recent photos and ways to add things.
struct HomePanel: View {
    @Environment(FridgeStore.self) private var store

    let onAddPhoto: () -> Void
    let onAddNote: () -> Void
    let onMagnets: () -> Void
    let onCollection: () -> Void
    let onSelect: (UUID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Твои фото. Твои истории.")
                    .font(.system(size: 22, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text("Вырезай любимое и сохраняй рядом")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            recentRow
            Button(action: onAddPhoto) {
                Label("Магнитик из фото", systemImage: "plus")
            }
            .buttonStyle(PrimaryButtonStyle())
            HStack(spacing: 10) {
                SecondaryTile(title: "Записка", systemImage: "square.and.pencil", action: onAddNote)
                SecondaryTile(title: "Магниты", systemImage: "star", action: onMagnets)
                SecondaryTile(title: "Коллекция", systemImage: "square.grid.2x2", action: onCollection)
            }
        }
        .padding(.horizontal, 20)
    }

    private var recentRow: some View {
        HStack(spacing: 10) {
            Button(action: onAddPhoto) {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 22))
                    .foregroundStyle(Color.primary)
                    .frame(width: 60, height: 60)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.tileBackground))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Выбрать фото")

            let photos = Array(store.photoItems.prefix(3))
            if photos.isEmpty {
                Text("Начни с небольшого набора: одно своё фото, одна записка и любимый магнитик.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(photos) { item in
                    Button {
                        show(item)
                    } label: {
                        RecentPhotoThumb(content: store.content(for: item))
                    }
                    .buttonStyle(PressableStyle())
                }
                Spacer(minLength: 0)
            }
        }
        .frame(height: 60)
    }

    /// Selects the photo on the door, or puts it back there first.
    private func show(_ item: FridgeItem) {
        if let existing = store.placementIDs(of: item.id).last {
            onSelect(existing)
        } else if let placementID = store.place(itemID: item.id) {
            Feedback.attach()
            onSelect(placementID)
        }
    }
}

private struct RecentPhotoThumb: View {
    let content: RenderContent

    private var photo: (image: UIImage, style: PhotoStyle)? {
        if case .photo(let photo, let image) = content, let image {
            return (image, photo.style)
        }
        return nil
    }

    var body: some View {
        ZStack {
            if let photo {
                if photo.style == .cutout {
                    SteelTile(cornerRadius: 14)
                    Image(uiImage: photo.image)
                        .resizable()
                        .scaledToFit()
                        .padding(5)
                } else {
                    Image(uiImage: photo.image)
                        .resizable()
                        .scaledToFill()
                }
            } else {
                Color.tileBackground
            }
        }
        .frame(width: 80, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Bottom panel for the selected thing: fastener, layers, straighten, edit, take off.
struct SelectionPanel: View {
    @Environment(FridgeStore.self) private var store

    let placement: Placement
    let content: RenderContent
    let onDone: () -> Void
    let onEditNote: (UUID) -> Void

    private var noteItemID: UUID? {
        guard case .item(let id) = placement.source, case .note = content else { return nil }
        return id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(content.title)
                    .font(.system(size: 20, weight: .bold))
                Spacer()
                Button("Готово", action: onDone)
                    .font(.body.weight(.semibold))
            }
            .frame(height: 30)

            if content.acceptsFastener {
                fastenerPicker
            } else {
                Text("Магнитик держится сам. Перетащи его пальцем, а белым уголком измени размер и поворот — или сведи и поверни двумя пальцами.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
            }

            tools

            Text("Магнит на карточке тоже можно передвинуть.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .opacity(placement.fastener == nil || !content.acceptsFastener ? 0 : 1)
        }
        .padding(.horizontal, 20)
    }

    private var fastenerPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Крепление")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
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
                .padding(.vertical, 2)
            }
        }
        .frame(height: 84, alignment: .top)
    }

    private var tools: some View {
        HStack(spacing: 8) {
            ToolButton(title: "Выше", systemImage: "square.3.layers.3d.top.filled") {
                store.bringForward(placement.id)
            }
            ToolButton(title: "Ниже", systemImage: "square.3.layers.3d.bottom.filled") {
                store.sendBackward(placement.id)
            }
            ToolButton(title: "Ровно", systemImage: "level") {
                store.updatePlacement(placement.id) { $0.rotation = 0 }
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
                SteelTile(cornerRadius: 12)
                if let kind {
                    FastenerView(kind: kind, size: 24)
                } else {
                    Image(systemName: "nosign")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(white: 0.35))
                }
            }
            .frame(width: 52, height: 52)
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 2.5)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(kind?.title ?? "Без крепления")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
