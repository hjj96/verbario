import SwiftUI
import WidgetKit

/// The single source of truth for the app: the collection, the door and its undo history.
/// Every change is saved to the App Group container and the widget is asked to reload.
@MainActor
@Observable
final class FridgeStore {
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let undoable: Bool
    }

    enum SaveStatus: Equatable {
        case saved
        case saving
        case failed
    }

    private(set) var state: FridgeState
    private(set) var saveStatus: SaveStatus = .saved
    private(set) var toast: Toast?
    private var undoStack: [FridgeState] = []
    private var redoStack: [FridgeState] = []

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    private let imageCache = NSCache<NSString, UIImage>()

    init() {
        switch FridgeStorage.loadState(backupOnFailure: true) {
        case .loaded(let loaded):
            state = loaded
            FridgeStorage.removeUnusedImages(keeping: loaded)
        case .missing, .corrupted:
            state = .starter
            persist()
        }
    }

    // MARK: Reading

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var isDoorFull: Bool { state.door.placements.count >= ItemMetrics.maxPlacements }

    var photoItems: [FridgeItem] {
        state.items.filter(\.isPhoto).sorted { $0.createdAt > $1.createdAt }
    }

    var noteItems: [FridgeItem] {
        state.items.filter(\.isNote).sorted { $0.createdAt > $1.createdAt }
    }

    func placement(_ id: UUID) -> Placement? {
        state.door.placements.first { $0.id == id }
    }

    func placementIDs(of itemID: UUID) -> [UUID] {
        state.door.placements.filter { $0.source == .item(itemID) }.map(\.id)
    }

    func isOnDoor(_ itemID: UUID) -> Bool {
        state.door.placements.contains { $0.source == .item(itemID) }
    }

    func content(for placement: Placement) -> RenderContent? {
        switch placement.source {
        case .item(let id):
            guard let item = state.item(id) else { return nil }
            return content(for: item)
        case .magnet(let id):
            guard let magnet = MagnetCatalog.magnet(id) else { return nil }
            return .magnet(magnet)
        }
    }

    func content(for item: FridgeItem) -> RenderContent {
        switch item.content {
        case .photo(let photo):
            return .photo(photo, image(for: photo))
        case .note(let note):
            return .note(note, seed: item.id.seed)
        }
    }

    func image(for photo: PhotoContent) -> UIImage? {
        let key = photo.file as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard let image = FridgeStorage.loadImage(photo.file, variant: .full) else { return nil }
        imageCache.setObject(image, forKey: key)
        return image
    }

    // MARK: Changing

    /// Applies a change as one undoable step.
    func apply(_ change: (inout FridgeState) -> Void) {
        var next = state
        change(&next)
        guard next != state else { return }
        undoStack.append(state)
        if undoStack.count > 80 {
            undoStack.removeFirst(undoStack.count - 80)
        }
        redoStack.removeAll()
        state = next
        scheduleSave()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(state)
        state = previous
        toast = nil
        scheduleSave()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(state)
        state = next
        scheduleSave()
    }

    /// Adds a new photo to the collection and hangs it on the door. Returns the placement id.
    @discardableResult
    func addPhoto(_ photo: PhotoContent) -> UUID? {
        add(FridgeItem(content: .photo(photo)))
    }

    @discardableResult
    func addNote(_ note: NoteContent, id: UUID = UUID()) -> UUID? {
        add(FridgeItem(id: id, content: .note(note)))
    }

    func updateNote(itemID: UUID, note: NoteContent) {
        apply { state in
            guard let index = state.items.firstIndex(where: { $0.id == itemID }) else { return }
            state.items[index].content = .note(note)
        }
    }

    /// Hangs a magnet from the starter set. Returns the placement id.
    @discardableResult
    func placeMagnet(_ magnetID: String) -> UUID? {
        guard let magnet = MagnetCatalog.magnet(magnetID) else { return nil }
        guard !isDoorFull else {
            showToast("На дверце уже много предметов")
            return nil
        }
        let placement = newPlacement(source: .magnet(magnetID), content: .magnet(magnet))
        apply { $0.door.placements.append(placement) }
        return placement.id
    }

    /// Puts an item from the collection back on the door. Returns the placement id.
    @discardableResult
    func place(itemID: UUID) -> UUID? {
        guard let item = state.item(itemID) else { return nil }
        guard !isDoorFull else {
            showToast("На дверце уже много предметов")
            return nil
        }
        let placement = newPlacement(source: .item(item.id), content: content(for: item))
        apply { $0.door.placements.append(placement) }
        return placement.id
    }

    func updatePlacement(_ id: UUID, _ change: (inout Placement) -> Void) {
        apply { state in
            guard let index = state.door.placements.firstIndex(where: { $0.id == id }) else { return }
            change(&state.door.placements[index])
        }
    }

    /// Takes one thing off the door. Photos and notes stay in the collection.
    func removePlacement(_ id: UUID) {
        let wasItem: Bool
        if let existing = placement(id), case .item = existing.source {
            wasItem = true
        } else {
            wasItem = false
        }
        apply { state in
            state.door.placements.removeAll { $0.id == id }
        }
        showToast(wasItem ? "Снято с дверцы и осталось в коллекции" : "Магнит снят", undoable: true)
    }

    func removeFromDoor(itemID: UUID) {
        apply { state in
            state.door.placements.removeAll { $0.source == .item(itemID) }
        }
        showToast("Снято с дверцы и осталось в коллекции", undoable: true)
    }

    /// Removes the item from the collection and from the door. Can be undone.
    func deleteItem(_ itemID: UUID) {
        apply { state in
            state.items.removeAll { $0.id == itemID }
            state.door.placements.removeAll { $0.source == .item(itemID) }
        }
        showToast("Удалено из коллекции", undoable: true)
    }

    func bringForward(_ id: UUID) {
        apply { state in
            guard let index = state.door.placements.firstIndex(where: { $0.id == id }),
                  index < state.door.placements.count - 1 else { return }
            state.door.placements.swapAt(index, index + 1)
        }
    }

    func sendBackward(_ id: UUID) {
        apply { state in
            guard let index = state.door.placements.firstIndex(where: { $0.id == id }), index > 0 else { return }
            state.door.placements.swapAt(index, index - 1)
        }
    }

    func setDoorStyle(_ style: DoorStyle) {
        apply { $0.door.style = style }
    }

    func clearDoor() {
        guard !state.door.placements.isEmpty else { return }
        apply { $0.door.placements.removeAll() }
        showToast("Дверца очищена", undoable: true)
    }

    // MARK: Toast

    func showToast(_ message: String, undoable: Bool = false) {
        let newToast = Toast(message: message, undoable: undoable)
        withAnimation(.snappy) { toast = newToast }
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled, let self, self.toast?.id == newToast.id else { return }
            withAnimation(.snappy) { self.toast = nil }
        }
    }

    func undoFromToast() {
        withAnimation(.snappy) { undo() }
    }

    func dismissToast() {
        withAnimation(.snappy) { toast = nil }
    }

    // MARK: Saving

    /// Writes immediately, e.g. when the app goes to the background.
    func flushPendingSave() {
        if saveStatus == .saving {
            persist()
        }
    }

    private func scheduleSave() {
        saveStatus = .saving
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            self?.persist()
        }
    }

    private func persist() {
        saveTask?.cancel()
        saveTask = nil
        do {
            try FridgeStorage.save(state)
            saveStatus = .saved
            WidgetCenter.shared.reloadTimelines(ofKind: FridgeStorage.widgetKind)
        } catch {
            saveStatus = .failed
        }
    }

    // MARK: Helpers

    private func add(_ item: FridgeItem) -> UUID? {
        let placement = isDoorFull ? nil : newPlacement(source: .item(item.id), content: content(for: item))
        apply { state in
            state.items.append(item)
            if let placement {
                state.door.placements.append(placement)
            }
        }
        if placement == nil {
            showToast("Дверца заполнена — сохранено в коллекции")
        }
        return placement?.id
    }

    private func newPlacement(source: PlacementSource, content: RenderContent) -> Placement {
        let spot = freeSpot()
        var placement = Placement(source: source, x: spot.x, y: spot.y,
                                  width: ItemMetrics.defaultWidth(for: content),
                                  rotation: Double.random(in: -5...5))
        switch content {
        case .photo(let photo, _):
            if photo.style == .card {
                placement.fastener = .standard(.redMagnet)
            }
        case .note(let note, _):
            if let kind = note.shape.defaultFastener {
                placement.fastener = .standard(kind)
            }
        case .magnet:
            break
        }
        return placement
    }

    /// The candidate spot farthest from everything already on the door.
    /// The strip near the handle stays free.
    private func freeSpot() -> CGPoint {
        let existing = state.door.placements
        let columns: [CGFloat] = [0.26, 0.46, 0.64]
        let rows: [CGFloat] = [0.34, 0.52, 0.7, 0.84]
        var best = CGPoint(x: 0.45, y: 0.5)
        var bestDistance: CGFloat = -1
        for y in rows {
            for x in columns {
                let distance = existing.map { hypot($0.x - x, $0.y - y) }.min() ?? 1
                if distance > bestDistance {
                    bestDistance = distance
                    best = CGPoint(x: x, y: y)
                }
            }
        }
        return best
    }
}
