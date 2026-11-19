import SwiftUI

enum TrayTab: String, CaseIterable, Identifiable {
    case magnets, photos, notes, letters

    var id: String { rawValue }

    var title: String {
        switch self {
        case .magnets: return "Магниты"
        case .photos: return "Фото"
        case .notes: return "Записки"
        case .letters: return "Буквы"
        }
    }
}

/// The bottom tray: a steel shelf with everything that can go on the door.
/// Tap to hang a thing, or press and hold to drag it to the right spot.
struct TrayView: View {
    @Environment(FridgeStore.self) private var store
    @Binding var tab: TrayTab

    let onPlaced: (UUID) -> Void
    let onAddPhoto: () -> Void
    let onAddNote: () -> Void
    let onWord: () -> Void
    let onCollection: () -> Void

    private static let alphabet = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789!?".map(String.init)

    var body: some View {
        VStack(spacing: 12) {
            tabs
            shelf
            HStack(spacing: 10) {
                Button(action: onAddPhoto) {
                    Label("Магнитик из фото", systemImage: "plus")
                }
                .buttonStyle(PrimaryButtonStyle())
                RoundIconButton(systemImage: "square.and.pencil", label: "Новая записка", size: 52, action: onAddNote)
                RoundIconButton(systemImage: "square.grid.2x2", label: "Коллекция", size: 52, action: onCollection)
            }
            .padding(.horizontal, 18)
        }
    }

    private var tabs: some View {
        HStack(spacing: 22) {
            ForEach(TrayTab.allCases) { item in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { tab = item }
                    Feedback.select()
                } label: {
                    VStack(spacing: 5) {
                        Text(item.title)
                            .font(.system(size: 15, weight: tab == item ? .semibold : .regular))
                            .foregroundStyle(tab == item ? Color.ink : Color.inkSoft)
                        Capsule()
                            .fill(tab == item ? Color.ink : Color.clear)
                            .frame(width: 18, height: 3)
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            if tab == .magnets {
                Button("Все", action: onCollection)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.ink)
            }
        }
        .padding(.horizontal, 24)
    }

    private var shelf: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 2) {
                switch tab {
                case .magnets:
                    ForEach(MagnetLibrary.shared.magnets) { art in
                        TrayTile(content: .magnet(art), payload: .magnet(art.id)) { place(.magnet(art.id)) }
                    }
                case .photos:
                    AddTile(title: "Фото", systemImage: "photo.badge.plus", action: onAddPhoto)
                    ForEach(store.photoItems) { item in
                        TrayTile(content: store.content(for: item), payload: .item(item.id)) { place(.item(item.id)) }
                    }
                case .notes:
                    AddTile(title: "Записка", systemImage: "square.and.pencil", action: onAddNote)
                    ForEach(store.noteItems) { item in
                        TrayTile(content: store.content(for: item), payload: .item(item.id)) { place(.item(item.id)) }
                    }
                case .letters:
                    AddTile(title: "Слово", systemImage: "textformat", action: onWord)
                    ForEach(Array(Self.alphabet.enumerated()), id: \.offset) { index, character in
                        let letter = LetterMagnet(character: character, color: LetterColor.rainbow[index % LetterColor.rainbow.count])
                        TrayTile(content: .letter(letter), payload: .letter(letter), box: 46) { place(.letter(letter)) }
                    }
                }
            }
            .padding(.horizontal, 10)
        }
        .frame(height: 98)
        .background(SteelTile(cornerRadius: 24))
        .padding(.horizontal, 18)
        .animation(.snappy(duration: 0.25), value: tab)
    }

    private func place(_ payload: TrayPayload) {
        guard let placementID = store.place(payload) else { return }
        Feedback.attach()
        onPlaced(placementID)
    }
}

/// One thing on the shelf.
private struct TrayTile: View {
    let content: RenderContent
    let payload: TrayPayload
    var box: CGFloat = 60
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ItemThumb(content: content, box: box)
                .frame(width: max(box + 16, 62), height: 92)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .draggable(payload.token) {
            ItemThumb(content: content, box: box * 1.5)
        }
        .accessibilityLabel(content.title)
        .accessibilityHint("Нажмите, чтобы повесить на дверцу, или перетащите")
    }
}

private struct AddTile: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.white.opacity(0.75)))
                    .overlay { Circle().strokeBorder(Color.white, lineWidth: 1) }
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(Color(hex: 0x18262F))
            .frame(width: 72, height: 92)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}
