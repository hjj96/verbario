import SwiftUI

/// One of the person's own stickers or photo magnets, up close: turn it by hand,
/// change what it is (sticker, holo, magnet), share it, hang it or remove it.
struct OwnItemDetailView: View {
    let itemID: UUID
    /// Called with the placement to select when the person wants to see it on the door.
    let onShowOnDoor: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(MotionLight.self) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

    @State private var drag: CGSize = .zero
    @State private var shareURL: URL?
    @State private var confirmsDelete = false
    @State private var editsCaption = false
    @State private var captionDraft = ""

    /// Where the item hangs, in words.
    private var placesText: String {
        let names = store.fridges(showing: itemID).map(\.name)
        if names.isEmpty {
            return "Хранится в коллекции"
        }
        return "Висит: " + names.joined(separator: ", ")
    }

    private var photo: PhotoContent? {
        guard let item = store.state.item(itemID), case .photo(let photo) = item.content else { return nil }
        return photo
    }

    private var tilt: CGVector {
        let base = reduceMotion ? CGVector.zero : motion.light.tilt
        return CGVector(dx: (base.dx - drag.width / 110).clamped(to: -1.3...1.3),
                        dy: (base.dy - drag.height / 110).clamped(to: -1.3...1.3))
    }

    var body: some View {
        ScrollView {
            if let photo {
                VStack(spacing: 22) {
                    showcase(photo)
                    VStack(spacing: 6) {
                        SectionLabel(text: "Своё")
                        Text(photo.style.title)
                            .font(.serif(32))
                            .foregroundStyle(Color.ink)
                        Text(placesText)
                            .font(.subheadline)
                            .foregroundStyle(Color.inkSoft)
                            .multilineTextAlignment(.center)
                        if photo.style == .polaroid {
                            Button {
                                captionDraft = photo.caption
                                editsCaption = true
                            } label: {
                                Label(photo.caption.isEmpty ? "Подписать" : "«\(photo.caption)»", systemImage: "signature")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.ink)
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 4)
                        }
                    }
                    if photo.style.isCutoutFamily {
                        HStack(spacing: 8) {
                            ForEach(PhotoStyle.cutoutFinishes) { style in
                                ChoiceChip(title: style.title, isSelected: photo.style == style) {
                                    withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
                                        store.setPhotoStyle(itemID: itemID, style: style)
                                    }
                                    Feedback.attach()
                                }
                            }
                        }
                    }
                    actions(photo)
                }
                .padding(.vertical, 20)
            }
        }
        .background(Color.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let shareURL {
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Поделиться")
                }
            }
        }
        .confirmationDialog("Удалить из коллекции?", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                store.deleteItem(itemID)
                dismiss()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Предмет исчезнет из коллекции и с дверцы. Сразу после удаления его можно вернуть кнопкой «Отменить».")
        }
        .alert("Подпись", isPresented: $editsCaption) {
            TextField("Например, Лето, 2026", text: $captionDraft)
            Button("Готово") {
                store.setCaption(itemID: itemID, caption: captionDraft)
            }
            Button("Отмена", role: .cancel) {}
        }
        .task(id: photo?.file) { await prepareShare() }
        .onAppear { if !reduceMotion { motion.start() } }
        .onDisappear { if !reduceMotion { motion.stop() } }
    }

    private func showcase(_ photo: PhotoContent) -> some View {
        let content = RenderContent.photo(photo, store.image(for: photo))
        let aspect = ItemMetrics.aspect(of: content)
        let box: CGFloat = 230
        let width = aspect >= 1 ? box : box * aspect
        return ZStack {
            SteelTile(cornerRadius: 32)
            ItemPreview(content: content, rotation: 0, width: width)
                .scaleEffect(x: 1 - abs(tilt.dx) * 0.05, y: 1 - abs(tilt.dy) * 0.05)
                .offset(x: drag.width * 0.08, y: drag.height * 0.08)
        }
        .environment(\.magnetLight, MagnetLight(tilt: tilt, depth: 2.2))
        .frame(height: 340)
        .contentShape(Rectangle())
        .gesture(
            DragGesture()
                .onChanged { value in drag = value.translation }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.6, dampingFraction: 0.38)) { drag = .zero }
                }
        )
        .padding(.horizontal, 16)
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: photo.style)
    }

    private func actions(_ photo: PhotoContent) -> some View {
        VStack(spacing: 10) {
            if store.isOnDoor(itemID) {
                Button {
                    if let placementID = store.placementIDs(of: itemID).last {
                        onShowOnDoor(placementID)
                    }
                } label: {
                    Label("Показать на дверце", systemImage: "eye")
                }
                .buttonStyle(PrimaryButtonStyle())
                HStack(spacing: 10) {
                    ToolButton(title: "Снять", systemImage: "tray.and.arrow.down") {
                        store.removeFromDoor(itemID: itemID)
                    }
                    ToolButton(title: "Удалить", systemImage: "trash", isDestructive: true) {
                        confirmsDelete = true
                    }
                }
            } else {
                Button {
                    if let placementID = store.place(itemID: itemID) {
                        onShowOnDoor(placementID)
                    }
                } label: {
                    Label("Повесить на дверцу", systemImage: "plus")
                }
                .buttonStyle(PrimaryButtonStyle())
                ToolButton(title: "Удалить из коллекции", systemImage: "trash", isDestructive: true) {
                    confirmsDelete = true
                }
            }
        }
        .padding(.horizontal, 20)
    }

    /// Copies the stored image under a friendly name so it can be sent as a sticker.
    private func prepareShare() async {
        guard let photo else { return }
        let source = FridgeStorage.imageURL(photo.file, variant: .full)
        let name: String
        switch photo.style {
        case .sticker, .holo: name = "Стикер"
        case .cutout, .round, .heart: name = "Магнит"
        case .card: name = "Фото"
        case .polaroid: name = "Полароид"
        }
        let ext = (photo.file as NSString).pathExtension
        shareURL = await Task.detached(priority: .utility) { () -> URL? in
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Share", isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let target = folder.appendingPathComponent("\(name).\(ext)")
            try? FileManager.default.removeItem(at: target)
            do {
                try FileManager.default.copyItem(at: source, to: target)
                return target
            } catch {
                return nil
            }
        }.value
    }
}
