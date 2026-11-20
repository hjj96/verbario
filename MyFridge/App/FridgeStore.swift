import SwiftUI
import WidgetKit

/// Something that can be put on a fridge from the tray, by tap or by drag and drop.
enum TrayPayload: Hashable {
    case magnet(String)
    case item(UUID)
    case letter(LetterMagnet)

    /// Text form used for drag and drop.
    var token: String {
        switch self {
        case .magnet(let id): return "magnet:\(id)"
        case .item(let id): return "item:\(id.uuidString)"
        case .letter(let letter): return "letter:\(letter.color.rawValue):\(letter.character)"
        }
    }

    init?(token: String) {
        let parts = token.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { return nil }
        switch parts[0] {
        case "magnet":
            self = .magnet(parts[1])
        case "item":
            guard let id = UUID(uuidString: parts[1]) else { return nil }
            self = .item(id)
        case "letter":
            guard parts.count == 3, let color = LetterColor(rawValue: parts[1]), !parts[2].isEmpty else { return nil }
            self = .letter(LetterMagnet(character: parts[2], color: color))
        default:
            return nil
        }
    }
}

/// How a new word is coloured.
enum WordColoring: Hashable {
    case rainbow
    case single(LetterColor)

    func color(at index: Int) -> LetterColor {
        switch self {
        case .rainbow: return LetterColor.rainbow[index % LetterColor.rainbow.count]
        case .single(let color): return color
        }
    }
}

/// The single source of truth for the app: the shared collection, the fridges and the undo
/// history. Every change is saved to the App Group container and the widget is asked to reload.
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

    // MARK: Fridges

    /// The fridge being edited.
    var fridge: Fridge {
        state.fridges[state.currentIndex]
    }

    var design: DoorDesign { fridge.design }
    var format: FridgeFormat { fridge.format }
    var placements: [Placement] { fridge.placements }

    func selectFridge(_ id: UUID) {
        guard state.fridges.contains(where: { $0.id == id }), state.currentFridgeID != id else { return }
        // Switching fridges is navigation, not an edit: it does not go into the undo history.
        state.currentFridgeID = id
        scheduleSave()
    }

    /// Creates a fridge and makes it current. Returns its id.
    @discardableResult
    func addFridge(name: String, format: FridgeFormat, design: DoorDesign) -> UUID {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = FridgePreset.all.first { $0.finish == design.finish }?.name ?? "Холодильник"
        let fridge = Fridge(name: String((trimmed.isEmpty ? fallback : trimmed).prefix(24)), format: format, design: design)
        apply { state in
            state.fridges.append(fridge)
            state.currentFridgeID = fridge.id
        }
        return fridge.id
    }

    func renameFridge(_ id: UUID, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        apply { state in
            guard let index = state.fridges.firstIndex(where: { $0.id == id }) else { return }
            state.fridges[index].name = String(trimmed.prefix(24))
        }
    }

    @discardableResult
    func duplicateFridge(_ id: UUID) -> UUID? {
        guard let original = state.fridge(id) else { return nil }
        var copy = original
        copy.id = UUID()
        copy.name = "\(original.name) — копия"
        copy.placements = original.placements.map { placement in
            var moved = placement
            moved.id = UUID()
            return moved
        }
        apply { state in
            state.fridges.append(copy)
            state.currentFridgeID = copy.id
        }
        return copy.id
    }

    /// Removes a fridge; its things stay in the collection. The last fridge cannot be removed.
    func deleteFridge(_ id: UUID) {
        guard state.fridges.count > 1, let fridge = state.fridge(id) else { return }
        apply { state in
            state.fridges.removeAll { $0.id == id }
            if state.currentFridgeID == id {
                state.currentFridgeID = state.fridges.first?.id
            }
        }
        showToast("«\(fridge.name)» удалён, предметы остались в коллекции", undoable: true)
    }

    func updateDesign(_ change: (inout DoorDesign) -> Void) {
        updateCurrent { change(&$0.design) }
    }

    func setFormat(_ format: FridgeFormat) {
        updateCurrent { $0.format = format }
    }

    func clearDoor() {
        guard !placements.isEmpty else { return }
        updateCurrent { $0.placements.removeAll() }
        showToast("Дверца очищена", undoable: true)
    }

    // MARK: Reading

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var isDoorFull: Bool { placements.count >= ItemMetrics.maxPlacements }

    var photoItems: [FridgeItem] {
        state.items.filter(\.isPhoto).sorted { $0.createdAt > $1.createdAt }
    }

    var noteItems: [FridgeItem] {
        state.items.filter(\.isNote).sorted { $0.createdAt > $1.createdAt }
    }

    func placement(_ id: UUID) -> Placement? {
        placements.first { $0.id == id }
    }

    /// Placements of an item on the current fridge.
    func placementIDs(of itemID: UUID) -> [UUID] {
        placements.filter { $0.source == .item(itemID) }.map(\.id)
    }

    /// Whether the item hangs on the current fridge.
    func isOnDoor(_ itemID: UUID) -> Bool {
        placements.contains { $0.source == .item(itemID) }
    }

    /// Every fridge the item hangs on.
    func fridges(showing itemID: UUID) -> [Fridge] {
        state.fridges.filter { fridge in fridge.placements.contains { $0.source == .item(itemID) } }
    }

    func count(ofMagnet id: String) -> Int {
        placements.filter { $0.source == .magnet(id) }.count
    }

    func content(for placement: Placement) -> RenderContent? {
        switch placement.source {
        case .item(let id):
            guard let item = state.item(id) else { return nil }
            return content(for: item)
        case .magnet(let id):
            guard let art = MagnetLibrary.shared.magnet(id) else { return nil }
            return .magnet(art)
        case .letter(let letter):
            return .letter(letter)
        }
    }

    func content(for item: FridgeItem) -> RenderContent {
        switch item.content {
        case .photo(let photo):
            return .photo(photo, image(for: photo))
        case .note(let note):
            return .note(note, id: item.id)
        }
    }

    func content(for payload: TrayPayload) -> RenderContent? {
        switch payload {
        case .magnet(let id):
            return MagnetLibrary.shared.magnet(id).map { RenderContent.magnet($0) }
        case .item(let id):
            return state.item(id).map { content(for: $0) }
        case .letter(let letter):
            return .letter(letter)
        }
    }

    func image(for photo: PhotoContent) -> UIImage? {
        let key = photo.file as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard let image = FridgeStorage.loadImage(photo.file, variant: .full) else { return nil }
        imageCache.setObject(image, forKey: key)
        return image
    }

    // MARK: Undo

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

    /// Changes the current fridge as one undoable step.
    func updateCurrent(_ change: (inout Fridge) -> Void) {
        apply { state in
            let index = state.currentIndex
            guard state.fridges.indices.contains(index) else { return }
            change(&state.fridges[index])
        }
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

    // MARK: Adding

    /// Adds a new photo to the collection and hangs it on the current fridge. Returns the placement id.
    @discardableResult
    func addPhoto(_ photo: PhotoContent) -> UUID? {
        addPhotos([photo], hang: true)
    }

    /// Adds several photos at once, e.g. one sticker per object cut from the same photo.
    /// With `hang`, each gets its own free spot on the current fridge. Returns the last placement id.
    @discardableResult
    func addPhotos(_ photos: [PhotoContent], hang: Bool) -> UUID? {
        guard !photos.isEmpty else { return nil }
        var items: [FridgeItem] = []
        var newPlacements: [Placement] = []
        var occupied = placements
        for photo in photos {
            let item = FridgeItem(content: .photo(photo))
            items.append(item)
            if hang, occupied.count < ItemMetrics.maxPlacements {
                let placement = newPlacement(source: .item(item.id), content: content(for: item), avoiding: occupied)
                newPlacements.append(placement)
                occupied.append(placement)
            }
        }
        apply { state in
            state.items.append(contentsOf: items)
            let index = state.currentIndex
            state.fridges[index].placements.append(contentsOf: newPlacements)
        }
        if !hang {
            showToast(items.count == 1 ? "Сохранено в коллекцию" : "Сохранено в коллекцию: \(items.count)")
        } else if newPlacements.count < items.count {
            showToast("Не всё поместилось на дверцу — остальное в коллекции")
        }
        return newPlacements.last?.id
    }

    /// Turns a cut-out into a sticker, a holographic sticker or a magnet. Everywhere it hangs.
    func setPhotoStyle(itemID: UUID, style: PhotoStyle) {
        apply { state in
            guard style.isCutoutFamily,
                  let index = state.items.firstIndex(where: { $0.id == itemID }),
                  case .photo(var photo) = state.items[index].content,
                  photo.style.isCutoutFamily else { return }
            photo.style = style
            state.items[index].content = .photo(photo)
            for fridgeIndex in state.fridges.indices {
                for placementIndex in state.fridges[fridgeIndex].placements.indices
                where state.fridges[fridgeIndex].placements[placementIndex].source == .item(itemID) {
                    state.fridges[fridgeIndex].placements[placementIndex].fastener = nil
                }
            }
        }
    }

    func setCaption(itemID: UUID, caption: String) {
        apply { state in
            guard let index = state.items.firstIndex(where: { $0.id == itemID }),
                  case .photo(var photo) = state.items[index].content else { return }
            photo.caption = String(caption.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
            state.items[index].content = .photo(photo)
        }
    }

    @discardableResult
    func addNote(_ note: NoteContent, id: UUID = UUID()) -> UUID? {
        let item = FridgeItem(id: id, content: .note(note))
        let placement = isDoorFull ? nil : newPlacement(source: .item(item.id), content: content(for: item))
        apply { state in
            state.items.append(item)
            if let placement {
                let index = state.currentIndex
                state.fridges[index].placements.append(placement)
            }
        }
        if placement == nil {
            showToast("Дверца заполнена — сохранено в коллекции")
        }
        return placement?.id
    }

    func updateNote(itemID: UUID, note: NoteContent) {
        apply { state in
            guard let index = state.items.firstIndex(where: { $0.id == itemID }) else { return }
            state.items[index].content = .note(note)
        }
    }

    func toggleTask(itemID: UUID) {
        apply { state in
            guard let index = state.items.firstIndex(where: { $0.id == itemID }),
                  case .note(var note) = state.items[index].content else { return }
            note.isDone.toggle()
            state.items[index].content = .note(note)
        }
        Feedback.attach()
    }

    /// Puts something from the tray on the current fridge, at `point` (door fractions) or in a
    /// free spot. An item that already hangs there is moved instead of copied. Returns the placement id.
    @discardableResult
    func place(_ payload: TrayPayload, at point: CGPoint? = nil) -> UUID? {
        if case .item(let itemID) = payload, let existing = placementIDs(of: itemID).last {
            if let point {
                updatePlacement(existing) { placement in
                    placement.x = point.x.clamped(to: 0.03...0.97)
                    placement.y = point.y.clamped(to: 0.03...0.97)
                }
            }
            return existing
        }
        guard let content = content(for: payload) else { return nil }
        guard !isDoorFull else {
            showToast("На дверце уже много всего — сними что-нибудь")
            return nil
        }
        let source: PlacementSource
        switch payload {
        case .magnet(let id): source = .magnet(id)
        case .item(let id): source = .item(id)
        case .letter(let letter): source = .letter(letter)
        }
        var placement = newPlacement(source: source, content: content)
        if let point {
            placement.x = point.x.clamped(to: 0.03...0.97)
            placement.y = point.y.clamped(to: 0.03...0.97)
        }
        updateCurrent { $0.placements.append(placement) }
        return placement.id
    }

    /// Puts an item from the collection on the current fridge. Returns the placement id.
    @discardableResult
    func place(itemID: UUID) -> UUID? {
        place(.item(itemID))
    }

    /// Lays a word out as separate magnetic letters. Returns the id of the last letter.
    @discardableResult
    func placeWord(_ text: String, coloring: WordColoring) -> UUID? {
        let characters = text.uppercased().map(String.init)
        let letters = characters.filter { $0 != " " }
        guard !letters.isEmpty else { return nil }
        guard placements.count + letters.count <= ItemMetrics.maxPlacements else {
            showToast("Для такого слова на дверце мало места")
            return nil
        }
        let format = self.format
        let width: CGFloat = 0.11
        let step: CGFloat = 0.097 * format.unitPerWidth
        let perRow = format == .wide ? 12 : 8
        var rows: [[String]] = [[]]
        for character in characters {
            if character == " " {
                if !(rows[rows.count - 1].isEmpty) { rows[rows.count - 1].append(" ") }
            } else {
                if rows[rows.count - 1].count >= perRow { rows.append([]) }
                rows[rows.count - 1].append(character)
            }
        }
        let center = freeSpot(preferLow: true)
        let rowHeight = width / ItemMetrics.letterAspect * min(format.aspect, FridgeFormat.tall.aspect) * 1.05
        var newPlacements: [Placement] = []
        var colorIndex = 0
        for (rowIndex, row) in rows.enumerated() {
            let trimmed = row.last == " " ? Array(row.dropLast()) : row
            let rowWidth = CGFloat(max(trimmed.count - 1, 0)) * step
            let startX = (center.x - rowWidth / 2).clamped(to: 0.08...max(0.08, 0.84 - rowWidth))
            let y = (center.y + (CGFloat(rowIndex) - CGFloat(rows.count - 1) / 2) * rowHeight).clamped(to: 0.16...0.94)
            for (index, character) in trimmed.enumerated() where character != " " {
                let letter = LetterMagnet(character: character, color: coloring.color(at: colorIndex))
                colorIndex += 1
                newPlacements.append(Placement(source: .letter(letter),
                                               x: startX + CGFloat(index) * step,
                                               y: y + CGFloat.random(in: -0.008...0.008),
                                               width: width,
                                               rotation: Double.random(in: -7...7)))
            }
        }
        updateCurrent { $0.placements.append(contentsOf: newPlacements) }
        return newPlacements.last?.id
    }

    @discardableResult
    func duplicate(_ placementID: UUID) -> UUID? {
        guard let original = placement(placementID) else { return nil }
        guard !isDoorFull else {
            showToast("На дверце уже много всего — сними что-нибудь")
            return nil
        }
        var copy = original
        copy.id = UUID()
        copy.x = (original.x + 0.05).clamped(to: 0.03...0.97)
        copy.y = (original.y + 0.04).clamped(to: 0.03...0.97)
        copy.rotation = original.rotation + Double.random(in: -6...6)
        updateCurrent { $0.placements.append(copy) }
        return copy.id
    }

    // MARK: Changing placements

    func updatePlacement(_ id: UUID, _ change: (inout Placement) -> Void) {
        updateCurrent { fridge in
            guard let index = fridge.placements.firstIndex(where: { $0.id == id }) else { return }
            change(&fridge.placements[index])
        }
    }

    /// Takes one thing off the current fridge. Photos and notes stay in the collection.
    func removePlacement(_ id: UUID) {
        let wasItem: Bool
        if let existing = placement(id), case .item = existing.source {
            wasItem = true
        } else {
            wasItem = false
        }
        updateCurrent { fridge in
            fridge.placements.removeAll { $0.id == id }
        }
        showToast(wasItem ? "Снято с дверцы и осталось в коллекции" : "Снято с дверцы", undoable: true)
    }

    func removeFromDoor(itemID: UUID) {
        updateCurrent { fridge in
            fridge.placements.removeAll { $0.source == .item(itemID) }
        }
        showToast("Снято с дверцы и осталось в коллекции", undoable: true)
    }

    /// Removes the item from the collection and from every fridge. Can be undone.
    func deleteItem(_ itemID: UUID) {
        apply { state in
            state.items.removeAll { $0.id == itemID }
            for index in state.fridges.indices {
                state.fridges[index].placements.removeAll { $0.source == .item(itemID) }
            }
        }
        showToast("Удалено из коллекции", undoable: true)
    }

    func bringForward(_ id: UUID) {
        updateCurrent { fridge in
            guard let index = fridge.placements.firstIndex(where: { $0.id == id }),
                  index < fridge.placements.count - 1 else { return }
            fridge.placements.swapAt(index, index + 1)
        }
    }

    func sendBackward(_ id: UUID) {
        updateCurrent { fridge in
            guard let index = fridge.placements.firstIndex(where: { $0.id == id }), index > 0 else { return }
            fridge.placements.swapAt(index, index - 1)
        }
    }

    // MARK: Outside changes

    /// The widget can tick a to-do note while the app is in the background.
    /// Picks such changes up when the app becomes active.
    func reloadIfChangedOutside() {
        guard saveStatus != .saving,
              case .loaded(let onDisk) = FridgeStorage.loadState(backupOnFailure: false),
              onDisk != state else { return }
        state = onDisk
        undoStack.removeAll()
        redoStack.removeAll()
        Reminders.sync(with: onDisk)
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
            Reminders.sync(with: state)
        } catch {
            saveStatus = .failed
        }
    }

    // MARK: Helpers

    private func newPlacement(source: PlacementSource, content: RenderContent, avoiding: [Placement]? = nil) -> Placement {
        let spot = freeSpot(preferLow: false, avoiding: avoiding)
        var placement = Placement(source: source, x: spot.x, y: spot.y,
                                  width: ItemMetrics.defaultWidth(for: content),
                                  rotation: Double.random(in: -6...6))
        switch content {
        case .photo(let photo, _):
            if photo.style == .card {
                placement.fastener = .standard(.redMagnet)
            } else if photo.style == .polaroid {
                placement.fastener = .standard(.whiteMagnet)
            }
        case .note(let note, _):
            if let kind = note.shape.defaultFastener {
                placement.fastener = .standard(kind)
            }
        case .magnet, .letter:
            break
        }
        return placement
    }

    /// The candidate spot farthest from everything already on the door.
    /// The strip near the handle stays free.
    private func freeSpot(preferLow: Bool, avoiding: [Placement]? = nil) -> CGPoint {
        let existing = avoiding ?? placements
        let columns: [CGFloat]
        var rows: [CGFloat]
        switch format {
        case .wide:
            columns = [0.14, 0.3, 0.46, 0.62, 0.78]
            rows = [0.5, 0.76]
        case .square, .tall:
            columns = [0.26, 0.46, 0.64]
            rows = [0.34, 0.52, 0.7, 0.84]
        }
        if preferLow {
            rows.reverse()
        }
        var best = CGPoint(x: 0.45, y: 0.55)
        var bestDistance: CGFloat = -1
        for y in rows {
            for x in columns {
                let distance = existing.map { hypot(($0.x - x) * format.aspect, $0.y - y) }.min() ?? 1
                if distance > bestDistance + 0.01 {
                    bestDistance = distance
                    best = CGPoint(x: x, y: y)
                }
            }
        }
        return best
    }
}
