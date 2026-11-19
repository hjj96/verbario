import SwiftUI

/// "Снял с дверцы. Оставил у себя." The whole collection: designed magnets in sets,
/// the person's own photo magnets and notes, and magnetic letters.
struct MagnetCollectionView: View {
    /// Called with the placement to select after the sheet closes.
    let onShowOnDoor: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var target: FridgeItem?

    private let library = MagnetLibrary.shared

    private var isShowingActions: Binding<Bool> {
        Binding(get: { target != nil }, set: { if !$0 { target = nil } })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    header
                    ownPhotos
                    ForEach(library.sets) { set in
                        SetShelf(set: set, magnets: library.magnets(in: set), countOnDoor: { store.count(ofMagnet: $0) })
                    }
                    letters
                    notes
                }
                .padding(.vertical, 20)
            }
            .background(Color.paper)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .navigationDestination(for: UUID.self) { itemID in
                OwnItemDetailView(itemID: itemID) { placementID in
                    close(selecting: placementID)
                }
            }
            .navigationDestination(for: String.self) { magnetID in
                if let art = library.magnet(magnetID) {
                    MagnetDetailView(art: art) {
                        if let placementID = store.place(.magnet(art.id)) {
                            close(selecting: placementID)
                        }
                    }
                }
            }
            .confirmationDialog(target.map { store.content(for: $0).title } ?? "",
                                isPresented: isShowingActions,
                                titleVisibility: .visible,
                                presenting: target) { item in
                actions(for: item)
            } message: { item in
                Text(store.isOnDoor(item.id)
                     ? "Сейчас висит на дверце."
                     : "Хранится в коллекции. После удаления его ещё можно вернуть кнопкой «Отменить».")
            }
            .overlay(alignment: .bottom) { ToastHost() }
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: "Коллекция")
            Text("Магниты\nи воспоминания")
                .font(.serif(34))
                .foregroundStyle(Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(library.magnets.count) магнитов в \(library.sets.count) наборах · своих: \(store.photoItems.count)")
                .font(.subheadline)
                .foregroundStyle(Color.inkSoft)
        }
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private var ownPhotos: some View {
        let photos = store.photoItems
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: "Свои")
                    Text("Мои стикеры и магниты")
                        .font(.serif(22))
                        .foregroundStyle(Color.ink)
                }
                .padding(.horizontal, 20)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .bottom, spacing: 14) {
                        ForEach(photos) { item in
                            NavigationLink(value: item.id) {
                                ShelfItem(content: store.content(for: item),
                                          caption: store.isOnDoor(item.id) ? "на дверце" : "в коллекции")
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                }
                .background(SteelTile(cornerRadius: 26).padding(.horizontal, 14))
            }
        }
    }

    private var letters: some View {
        let word = "ПРИВЕТ".map(String.init)
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                SectionLabel(text: "Буквы")
                Text("Магнитный алфавит")
                    .font(.serif(22))
                    .foregroundStyle(Color.ink)
                Text("Все буквы и цифры — в лотке под дверцей. Нажми на букву, чтобы повесить.")
                    .font(.footnote)
                    .foregroundStyle(Color.inkSoft)
            }
            .padding(.horizontal, 20)
            HStack(spacing: 2) {
                ForEach(Array(word.enumerated()), id: \.offset) { index, character in
                    let letter = LetterMagnet(character: character, color: LetterColor.rainbow[index % LetterColor.rainbow.count])
                    Button {
                        if let placementID = store.place(.letter(letter)) {
                            close(selecting: placementID)
                        }
                    } label: {
                        LetterMagnetView(letter: letter)
                            .frame(width: 44, height: 44 / ItemMetrics.letterAspect)
                            .rotationEffect(.degrees(Double((index * 37) % 11) - 5))
                            .modifier(ItemShadow(depth: 1.3, unit: 300))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.vertical, 18)
            .padding(.horizontal, 10)
            .background(SteelTile(cornerRadius: 26))
            .padding(.horizontal, 14)
        }
    }

    @ViewBuilder
    private var notes: some View {
        let items = store.noteItems
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    SectionLabel(text: "Записки")
                    Text("Всё, что было написано")
                        .font(.serif(22))
                        .foregroundStyle(Color.ink)
                }
                .padding(.horizontal, 20)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 12)], spacing: 12) {
                    ForEach(items) { item in
                        Button {
                            target = item
                        } label: {
                            ZStack(alignment: .topTrailing) {
                                SteelTile(cornerRadius: 18)
                                ItemThumb(content: store.content(for: item), box: 80)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                if store.isOnDoor(item.id) {
                                    Circle()
                                        .fill(Color(hex: 0x3FA66B))
                                        .frame(width: 9, height: 9)
                                        .padding(9)
                                }
                            }
                            .aspectRatio(1, contentMode: .fit)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private func actions(for item: FridgeItem) -> some View {
        if store.isOnDoor(item.id) {
            Button("Показать на дверце") {
                if let placementID = store.placementIDs(of: item.id).last {
                    close(selecting: placementID)
                }
            }
            Button("Снять с холодильника") {
                store.removeFromDoor(itemID: item.id)
            }
        } else {
            Button("Вернуть на дверцу") {
                if let placementID = store.place(itemID: item.id) {
                    close(selecting: placementID)
                }
            }
        }
        Button("Удалить из коллекции", role: .destructive) {
            store.deleteItem(item.id)
        }
        Button("Отмена", role: .cancel) {}
    }

    private func close(selecting placementID: UUID) {
        onShowOnDoor(placementID)
        Feedback.attach()
        // Give a confirmation dialog a moment to go away before closing the sheet.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 120_000_000)
            dismiss()
        }
    }
}

/// One themed set on a steel shelf.
private struct SetShelf: View {
    let set: MagnetSet
    let magnets: [MagnetArt]
    let countOnDoor: (String) -> Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                SectionLabel(text: set.title)
                Text(set.caption)
                    .font(.serif(22))
                    .foregroundStyle(Color.ink)
            }
            .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 14) {
                    ForEach(magnets) { art in
                        NavigationLink(value: art.id) {
                            ShelfItem(content: .magnet(art),
                                      caption: art.title,
                                      badge: countOnDoor(art.id))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
            }
            .background(SteelTile(cornerRadius: 26).padding(.horizontal, 14))
        }
    }
}

private struct ShelfItem: View {
    let content: RenderContent
    let caption: String
    var badge = 0

    var body: some View {
        VStack(spacing: 8) {
            ItemThumb(content: content, box: 84)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Color.white)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Circle().fill(Color(hex: 0x18262F)))
                            .offset(x: 6, y: -6)
                    }
                }
            Text(caption)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color(hex: 0x2A3540))
                .lineLimit(1)
        }
        .frame(width: 96)
    }
}

/// A single magnet up close. Drag it to turn it and see its side and gloss.
struct MagnetDetailView: View {
    let art: MagnetArt
    let onPlace: () -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(MotionLight.self) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var drag: CGSize = .zero

    private var tilt: CGVector {
        let base = reduceMotion ? CGVector.zero : motion.light.tilt
        return CGVector(dx: (base.dx - drag.width / 110).clamped(to: -1.3...1.3),
                        dy: (base.dy - drag.height / 110).clamped(to: -1.3...1.3))
    }

    private var setTitle: String {
        MagnetLibrary.shared.sets.first { $0.id == art.setID }?.title ?? ""
    }

    var body: some View {
        let box: CGFloat = 220
        let width = art.aspect >= 1 ? box : box * art.aspect
        ScrollView {
            VStack(spacing: 22) {
                ZStack {
                    SteelTile(cornerRadius: 32)
                    CatalogMagnetView(art: art)
                        .frame(width: width, height: width / art.aspect)
                        .modifier(ItemShadow(depth: 0.8 + art.thickness / 10, unit: 900))
                        .scaleEffect(x: 1 - abs(tilt.dx) * 0.06, y: 1 - abs(tilt.dy) * 0.06)
                        .offset(x: drag.width * 0.08, y: drag.height * 0.08)
                        .environment(\.magnetLight, MagnetLight(tilt: tilt, depth: 2.2))
                }
                .frame(height: 340)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { value in drag = value.translation }
                        .onEnded { _ in
                            withAnimation(.spring(response: 0.6, dampingFraction: 0.38)) { drag = .zero }
                            Feedback.attach()
                        }
                )
                .padding(.horizontal, 16)

                VStack(spacing: 6) {
                    SectionLabel(text: setTitle)
                    Text(art.title)
                        .font(.serif(34))
                        .foregroundStyle(Color.ink)
                    Text(art.note)
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSoft)
                    let onDoor = store.count(ofMagnet: art.id)
                    if onDoor > 0 {
                        Text(onDoor == 1 ? "Уже висит на дверце" : "На дверце: \(onDoor)")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color(hex: 0x3FA66B))
                            .padding(.top, 4)
                    }
                }

                Button(action: onPlace) {
                    Label("Повесить на дверцу", systemImage: "plus")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 20)

                Text("Потяни магнит пальцем или наклони телефон, чтобы рассмотреть его со всех сторон.")
                    .font(.footnote)
                    .foregroundStyle(Color.inkSoft)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
            }
            .padding(.vertical, 20)
        }
        .background(Color.paper)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if !reduceMotion { motion.start() } }
        .onDisappear { if !reduceMotion { motion.stop() } }
    }
}
