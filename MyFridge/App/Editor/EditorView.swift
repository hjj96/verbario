import PhotosUI
import SwiftUI

/// The main screen: the door takes most of the space, tools appear for the selected thing.
struct EditorView: View {
    enum Sheet: Identifiable {
        case note(UUID?)
        case magnets
        case collection
        case settings
        case widgetGuide

        var id: String {
            switch self {
            case .note(let itemID): return "note-\(itemID?.uuidString ?? "new")"
            case .magnets: return "magnets"
            case .collection: return "collection"
            case .settings: return "settings"
            case .widgetGuide: return "widgetGuide"
            }
        }
    }

    struct PendingPhoto: Identifiable {
        let id = UUID()
        let image: UIImage
    }

    @Environment(FridgeStore.self) private var store
    @AppStorage("didShowWidgetGuide") private var didShowWidgetGuide = false

    @State private var selection: UUID?
    @State private var sheet: Sheet?
    @State private var showsPhotoPicker = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var pendingPhoto: PendingPhoto?
    @State private var isLoadingPhoto = false

    private let panelHeight: CGFloat = 268

    var body: some View {
        VStack(spacing: 0) {
            header
            DoorCanvas(selection: $selection)
                .aspectRatio(ItemMetrics.doorAspect, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            panel
                .frame(height: panelHeight, alignment: .top)
        }
        .background { EditorBackground().ignoresSafeArea() }
        .overlay {
            if isLoadingPhoto {
                ProgressView()
                    .controlSize(.large)
                    .padding(24)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.regularMaterial))
            }
        }
        .overlay(alignment: .bottom) { ToastHost() }
        .photosPicker(isPresented: $showsPhotoPicker, selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) { _, item in
            loadPicked(item)
        }
        .sheet(item: $pendingPhoto) { pending in
            PhotoCreatorView(source: pending.image) { placementID in
                placed(placementID, isFirstPhoto: store.photoItems.count == 1)
            }
            .environment(store)
        }
        .sheet(item: $sheet) { sheet in
            sheetContent(sheet)
                .environment(store)
        }
        .onOpenURL { _ in
            // The widget opens the editor for its door.
            sheet = nil
            pendingPhoto = nil
            selection = nil
        }
        .animation(.snappy(duration: 0.25), value: selection)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text("Мой холодильник")
                    .font(.system(size: 28, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 8)
                HeaderButton(systemImage: "arrow.uturn.backward", label: "Отменить") {
                    store.undo()
                }
                .disabled(!store.canUndo)
                HeaderButton(systemImage: "arrow.uturn.forward", label: "Повторить") {
                    store.redo()
                }
                .disabled(!store.canRedo)
                HeaderButton(systemImage: "gearshape", label: "Настройки") {
                    sheet = .settings
                }
            }
            SaveStatusView(status: store.saveStatus)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    // MARK: Panel

    @ViewBuilder
    private var panel: some View {
        if let id = selection, let placement = store.placement(id), let content = store.content(for: placement) {
            SelectionPanel(placement: placement,
                           content: content,
                           onDone: { selection = nil },
                           onEditNote: { itemID in sheet = .note(itemID) })
                .transition(.opacity)
        } else {
            HomePanel(onAddPhoto: { showsPhotoPicker = true },
                      onAddNote: { sheet = .note(nil) },
                      onMagnets: { sheet = .magnets },
                      onCollection: { sheet = .collection },
                      onSelect: { selection = $0 })
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: Sheet) -> some View {
        switch sheet {
        case .note(let itemID):
            NoteEditorView(editingItemID: itemID) { placementID in
                placed(placementID, isFirstPhoto: false)
            }
        case .magnets:
            MagnetPickerView { placementID in
                placed(placementID, isFirstPhoto: false)
            }
        case .collection:
            CollectionView { placementID in
                selection = placementID
            }
        case .settings:
            SettingsView()
        case .widgetGuide:
            NavigationStack {
                WidgetGuideView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Понятно") { self.sheet = nil }
                        }
                    }
            }
        }
    }

    // MARK: Actions

    private func placed(_ placementID: UUID, isFirstPhoto: Bool) {
        selection = placementID
        Feedback.attach()
        if isFirstPhoto && !didShowWidgetGuide {
            didShowWidgetGuide = true
            // Let the creation sheet finish closing first.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 800_000_000)
                sheet = .widgetGuide
            }
        }
    }

    private func loadPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        isLoadingPhoto = true
        Task { @MainActor in
            defer {
                isLoadingPhoto = false
                pickerItem = nil
            }
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                store.showToast("Не получилось открыть фото")
                return
            }
            let image = await Task.detached(priority: .userInitiated) {
                PhotoProcessing.downsample(data, maxPixel: 2048)
            }.value
            guard let image else {
                store.showToast("Не получилось открыть фото")
                return
            }
            pendingPhoto = PendingPhoto(image: image)
        }
    }
}

private struct SaveStatusView: View {
    let status: FridgeStore.SaveStatus

    var body: some View {
        HStack(spacing: 5) {
            switch status {
            case .saved:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.green)
                Text("Сохранено · виджет обновится сам")
            case .saving:
                ProgressView()
                    .controlSize(.mini)
                Text("Сохраняю…")
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.orange)
                Text("Не удалось сохранить")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(height: 18)
    }
}
