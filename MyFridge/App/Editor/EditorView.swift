import PhotosUI
import SwiftUI

/// The main screen: the door takes most of the space, the tray below holds everything
/// that can go on it, and tools appear for the selected thing.
struct EditorView: View {
    enum Sheet: Identifiable {
        case note(UUID?)
        case word
        case collection
        case settings
        case fridges
        case widgetGuide

        var id: String {
            switch self {
            case .note(let itemID): return "note-\(itemID?.uuidString ?? "new")"
            case .word: return "word"
            case .collection: return "collection"
            case .settings: return "settings"
            case .fridges: return "fridges"
            case .widgetGuide: return "widgetGuide"
            }
        }
    }

    struct PendingPhoto: Identifiable {
        let id = UUID()
        let image: UIImage
    }

    @Environment(FridgeStore.self) private var store
    @Environment(MotionLight.self) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("didShowWidgetGuide") private var didShowWidgetGuide = false

    @State private var selection: UUID?
    @State private var sheet: Sheet?
    @State private var tab: TrayTab = .magnets
    @State private var showsPhotoPicker = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var pendingPhoto: PendingPhoto?
    @State private var isLoadingPhoto = false

    private let panelHeight: CGFloat = 230

    var body: some View {
        VStack(spacing: 0) {
            header
            DoorCanvas(selection: $selection)
                .environment(\.magnetLight, reduceMotion ? MagnetLight() : motion.light)
                .aspectRatio(store.format.aspect, contentMode: .fit)
                .id(store.fridge.id)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                        removal: .opacity))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 16)
            panel
                .frame(height: panelHeight, alignment: .top)
        }
        .background { Color.paper.ignoresSafeArea() }
        .overlay {
            if isLoadingPhoto {
                ProgressView()
                    .controlSize(.large)
                    .padding(26)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.regularMaterial))
            }
        }
        .overlay(alignment: .bottom) { ToastHost() }
        .photosPicker(isPresented: $showsPhotoPicker, selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) { _, item in
            loadPicked(item)
        }
        .sheet(item: $pendingPhoto) { pending in
            PhotoStudioView(source: pending.image) { placementID in
                placed(placementID, isFirstPhoto: true)
            }
            .environment(store)
            .environment(motion)
        }
        .sheet(item: $sheet) { sheet in
            sheetContent(sheet)
                .environment(store)
                .environment(motion)
        }
        .onOpenURL { url in
            // The widget opens the editor for its fridge: myfridge://fridge/<id>
            sheet = nil
            pendingPhoto = nil
            selection = nil
            if url.host == "fridge", let id = UUID(uuidString: url.lastPathComponent) {
                withAnimation(.snappy) { store.selectFridge(id) }
            }
        }
        .onChange(of: store.fridge.id) { _, _ in
            selection = nil
        }
        .onAppear { if !reduceMotion { motion.start() } }
        .onDisappear { motion.stop() }
        .animation(.snappy(duration: 0.25), value: selection)
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                SaveStatusLabel(status: store.saveStatus)
                Button {
                    sheet = .fridges
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(store.fridge.name)
                            .font(.serif(30))
                            .foregroundStyle(Color.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.inkSoft)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fridge \(store.fridge.name). Choose another")
            }
            Spacer(minLength: 8)
            RoundIconButton(systemImage: "arrow.uturn.backward", label: "Undo") {
                store.undo()
            }
            .disabled(!store.canUndo)
            RoundIconButton(systemImage: "arrow.uturn.forward", label: "Redo") {
                store.redo()
            }
            .disabled(!store.canRedo)
            RoundIconButton(systemImage: "slider.horizontal.3", label: "Fridge look and settings") {
                sheet = .settings
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
    }

    // MARK: Panel

    @ViewBuilder
    private var panel: some View {
        if let id = selection, let placement = store.placement(id), let content = store.content(for: placement) {
            SelectionPanel(placement: placement,
                           content: content,
                           onDone: { selection = nil },
                           onSelect: { selection = $0 },
                           onEditNote: { itemID in sheet = .note(itemID) })
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        } else {
            TrayView(tab: $tab,
                     onPlaced: { selection = $0 },
                     onAddPhoto: { showsPhotoPicker = true },
                     onAddNote: { sheet = .note(nil) },
                     onWord: { sheet = .word },
                     onCollection: { sheet = .collection })
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: Sheet) -> some View {
        switch sheet {
        case .note(let itemID):
            NoteEditorView(editingItemID: itemID) { placementID in
                placed(placementID, isFirstPhoto: false)
            }
        case .word:
            WordComposerView { placementID in
                placed(placementID, isFirstPhoto: false)
            }
        case .collection:
            MagnetCollectionView { placementID in
                selection = placementID
            }
        case .settings:
            SettingsView()
        case .fridges:
            FridgesView()
        case .widgetGuide:
            NavigationStack {
                WidgetGuideView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Got it") { self.sheet = nil }
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
                store.showToast("Couldn’t open the photo")
                return
            }
            let image = await Task.detached(priority: .userInitiated) {
                PhotoProcessing.downsample(data, maxPixel: 2048)
            }.value
            guard let image else {
                store.showToast("Couldn’t open the photo")
                return
            }
            pendingPhoto = PendingPhoto(image: image)
        }
    }
}

private struct SaveStatusLabel: View {
    let status: FridgeStore.SaveStatus

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)
            SectionLabel(text: text)
        }
        .frame(height: 14)
        .animation(.easeOut(duration: 0.2), value: status)
    }

    private var text: String {
        switch status {
        case .saved: return "Saved"
        case .saving: return "Saving"
        case .failed: return "Couldn’t save"
        }
    }

    private var dotColor: Color {
        switch status {
        case .saved: return Color(hex: 0x3FA66B)
        case .saving: return Color(hex: 0xE0A43A)
        case .failed: return Color(hex: 0xC8372D)
        }
    }
}
