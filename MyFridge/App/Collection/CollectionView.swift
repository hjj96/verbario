import SwiftUI

/// "Снял с дверцы. Оставил у себя." Everything personal is kept here, on the door or not.
struct CollectionView: View {
    /// Called with the placement to select after the sheet closes.
    let onShowOnDoor: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var target: FridgeItem?

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 12)]

    private var isShowingActions: Binding<Bool> {
        Binding(get: { target != nil }, set: { if !$0 { target = nil } })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    itemSection(title: "Фото",
                                items: store.photoItems,
                                emptyText: "Здесь будут твои фотокарточки и вырезанные фотомагниты.")
                    itemSection(title: "Записки",
                                items: store.noteItems,
                                emptyText: "Записки тоже остаются здесь, даже когда их снимают с дверцы.")
                    magnetSection
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Коллекция")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
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
                     : "Хранится в коллекции. Удаление убирает предмет совсем — сразу после него можно нажать «Отменить».")
            }
            .overlay(alignment: .bottom) { ToastHost() }
        }
    }

    private func itemSection(title: String, items: [FridgeItem], emptyText: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: title, count: items.count)
            if items.isEmpty {
                Text(emptyText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(items) { item in
                        Button {
                            target = item
                        } label: {
                            CollectionTile(content: store.content(for: item), isOnDoor: store.isOnDoor(item.id))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
        }
    }

    private var magnetSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Стартовый набор", count: MagnetCatalog.all.count)
            Text("Готовые магнитики всегда под рукой. Нажми, чтобы повесить ещё один.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 12)], spacing: 12) {
                ForEach(MagnetCatalog.all) { magnet in
                    Button {
                        if let placementID = store.placeMagnet(magnet.id) {
                            close(selecting: placementID)
                        }
                    } label: {
                        MagnetCell(magnet: magnet)
                    }
                    .buttonStyle(PressableStyle())
                }
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

private struct SectionTitle: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.weight(.bold))
            Text("\(count)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }
}

struct CollectionTile: View {
    let content: RenderContent
    let isOnDoor: Bool

    var body: some View {
        ZStack(alignment: .topTrailing) {
            SteelTile(cornerRadius: 16)
            GeometryReader { geo in
                let aspect = ItemMetrics.aspect(of: content)
                let box = geo.size.width * 0.72
                let width = aspect >= 1 ? box : box * aspect
                ItemPreview(content: content, fastener: nil, rotation: 0, width: width)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
            if isOnDoor {
                Text("на дверце")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.accentColor))
                    .padding(7)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
