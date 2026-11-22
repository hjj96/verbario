import Foundation
import CoreGraphics

// MARK: - Collection

/// A personal thing that lives in the collection: a photo or a note.
///
/// Where the thing hangs on the door is stored separately (`Placement`), so taking it
/// off the door never removes it from the collection.
struct FridgeItem: Codable, Identifiable, Hashable {
    var id = UUID()
    var content: ItemContent
    var createdAt = Date()

    var isPhoto: Bool {
        if case .photo = content { return true }
        return false
    }

    var isNote: Bool {
        if case .note = content { return true }
        return false
    }
}

enum ItemContent: Codable, Hashable {
    case photo(PhotoContent)
    case note(NoteContent)
}

enum PhotoStyle: String, Codable, Hashable, CaseIterable, Identifiable {
    /// A cut-out object made into a thick magnet with a white edge.
    case cutout
    /// A cut-out object as a flat vinyl sticker with a laminated sheen.
    case sticker
    /// A cut-out object as a holographic sticker that shimmers when the phone tilts.
    case holo
    /// The whole snapshot in a paper frame, usually held by a separate magnet.
    case card
    /// A square instant photo with a wide bottom margin and a handwritten caption.
    case polaroid
    /// A round resin-dome photo magnet.
    case round
    /// A heart-shaped resin-dome photo magnet.
    case heart

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cutout: return "Фотомагнит"
        case .sticker: return "Стикер"
        case .holo: return "Голо-стикер"
        case .card: return "Фотокарточка"
        case .polaroid: return "Полароид"
        case .round: return "Круглый магнит"
        case .heart: return "Сердечко"
        }
    }

    var shortTitle: String {
        switch self {
        case .cutout: return "Магнит"
        case .sticker: return "Стикер"
        case .holo: return "Голо"
        case .card: return "Карточка"
        case .polaroid: return "Полароид"
        case .round: return "Круг"
        case .heart: return "Сердце"
        }
    }

    /// Shaped magnets and polaroids store a square crop of the photo.
    var isShaped: Bool { self == .round || self == .heart || self == .polaroid }

    /// Stickers and cut-out magnets share the same transparent image and can be turned
    /// into one another.
    var isCutoutFamily: Bool { self == .cutout || self == .sticker || self == .holo }

    static let cutoutFinishes: [PhotoStyle] = [.sticker, .holo, .cutout]
    static let wholeFinishes: [PhotoStyle] = [.polaroid, .card, .round, .heart]
}

struct PhotoContent: Codable, Hashable {
    var style: PhotoStyle
    /// File name of the prepared image inside the shared images folder.
    var file: String
    /// Width / height of the stored image.
    var aspect: Double
    /// Handwritten line under a polaroid.
    var caption = ""

    private enum CodingKeys: String, CodingKey {
        case style, file, aspect, caption
    }
}

extension PhotoContent {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(style: try container.decode(PhotoStyle.self, forKey: .style),
                  file: try container.decode(String.self, forKey: .file),
                  aspect: try container.decode(Double.self, forKey: .aspect))
        caption = try container.decodeIfPresent(String.self, forKey: .caption) ?? ""
    }
}

struct NoteContent: Codable, Hashable {
    var text: String
    var paper: PaperColor = .cream
    var shape: NoteShape = .torn
    var font: NoteFont = .caveat
    /// A to-do note shows a checkbox that can be ticked in the app and on the widget.
    var isTask = false
    var isDone = false
    /// Optional local notification time.
    var reminder: Date?

    private enum CodingKeys: String, CodingKey {
        case text, paper, shape, font, isTask, isDone, reminder
    }
}

extension NoteContent {
    /// Tolerant decoding: fields added later get their defaults.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(text: try container.decode(String.self, forKey: .text))
        paper = try container.decodeIfPresent(PaperColor.self, forKey: .paper) ?? .cream
        shape = try container.decodeIfPresent(NoteShape.self, forKey: .shape) ?? .torn
        font = try container.decodeIfPresent(NoteFont.self, forKey: .font) ?? .caveat
        isTask = try container.decodeIfPresent(Bool.self, forKey: .isTask) ?? false
        isDone = try container.decodeIfPresent(Bool.self, forKey: .isDone) ?? false
        reminder = try container.decodeIfPresent(Date.self, forKey: .reminder)
    }
}

enum PaperColor: String, Codable, Hashable, CaseIterable, Identifiable {
    case cream, butter, blush, sky, mint, kraft

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cream: return "Сливочная"
        case .butter: return "Жёлтая"
        case .blush: return "Розовая"
        case .sky: return "Голубая"
        case .mint: return "Мятная"
        case .kraft: return "Крафт"
        }
    }
}

enum NoteShape: String, Codable, Hashable, CaseIterable, Identifiable {
    case torn, sticky, card, ticket

    var id: String { rawValue }

    var title: String {
        switch self {
        case .torn: return "Листок"
        case .sticky: return "Стикер"
        case .card: return "Карточка"
        case .ticket: return "Билет"
        }
    }

    /// Width / height of the paper.
    var aspect: CGFloat {
        switch self {
        case .torn: return 1.45
        case .sticky: return 1.0
        case .card: return 1.45
        case .ticket: return 2.1
        }
    }

    /// Default width as a fraction of the door width.
    var defaultWidth: CGFloat {
        switch self {
        case .torn: return 0.36
        case .sticky: return 0.29
        case .card: return 0.36
        case .ticket: return 0.44
        }
    }

    var defaultFastener: FastenerKind? {
        switch self {
        case .torn: return .greenMagnet
        case .sticky: return .blueMagnet
        case .card: return .clip
        case .ticket: return .greenMagnet
        }
    }

    var supportsTasks: Bool { self != .ticket }
}

enum NoteFont: String, Codable, Hashable, CaseIterable, Identifiable {
    case caveat, marck, serif

    var id: String { rawValue }

    var title: String {
        switch self {
        case .caveat: return "Лёгкий"
        case .marck: return "Каллиграфия"
        case .serif: return "Печатный"
        }
    }
}

// MARK: - Letters

/// A plastic magnetic letter.
struct LetterMagnet: Codable, Hashable {
    var character: String
    var color: LetterColor
}

enum LetterColor: String, Codable, Hashable, CaseIterable, Identifiable {
    case red, orange, yellow, green, blue, purple, pink, white

    var id: String { rawValue }

    /// Colours used one after another for a word in "rainbow" mode.
    static let rainbow: [LetterColor] = [.red, .orange, .yellow, .green, .blue, .purple, .pink]

    var next: LetterColor {
        let all = LetterColor.allCases
        let index = all.firstIndex(of: self) ?? 0
        return all[(index + 1) % all.count]
    }
}

// MARK: - Door

/// What a placement shows: an item from the collection, a magnet from the set, or a letter.
enum PlacementSource: Codable, Hashable {
    case item(UUID)
    case magnet(String)
    case letter(LetterMagnet)
}

/// One thing hanging on the door. Order in `Fridge.placements` is the layer order
/// (the last one is on top).
struct Placement: Codable, Identifiable, Hashable {
    var id = UUID()
    var source: PlacementSource
    /// Centre, as a fraction of the door width.
    var x: CGFloat
    /// Centre, as a fraction of the door height.
    var y: CGFloat
    /// Width, as a fraction of the door width. Height follows from the item's aspect.
    var width: CGFloat
    /// Degrees, clockwise.
    var rotation: Double = 0
    /// A separate magnet or clip that holds the item. It moves together with the item.
    var fastener: Fastener?
}

struct Fastener: Codable, Hashable {
    var kind: FastenerKind
    /// Centre inside the item, in item units (0...1, may go slightly over the edge).
    var x: CGFloat = 0.5
    var y: CGFloat = 0.06
    var rotation: Double = 0

    static func standard(_ kind: FastenerKind) -> Fastener {
        Fastener(kind: kind, y: kind == .clip ? 0.02 : 0.06)
    }
}

enum FastenerKind: String, Codable, Hashable, CaseIterable, Identifiable {
    case redMagnet, blueMagnet, greenMagnet, yellowMagnet, whiteMagnet
    case metalDisc, clip, star, strawberry, daisy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .redMagnet: return "Красный магнит"
        case .blueMagnet: return "Синий магнит"
        case .greenMagnet: return "Зелёный магнит"
        case .yellowMagnet: return "Жёлтый магнит"
        case .whiteMagnet: return "Белый магнит"
        case .metalDisc: return "Металлический диск"
        case .clip: return "Зажим"
        case .star: return "Звёздочка"
        case .strawberry: return "Клубничка"
        case .daisy: return "Ромашка"
        }
    }
}

enum DoorFinish: String, Codable, Hashable, CaseIterable, Identifiable {
    case steel, graphite, champagne
    case cream, mint, sky, cherry, lemon, powder, black

    var id: String { rawValue }

    var title: String {
        switch self {
        case .steel: return "Сталь"
        case .graphite: return "Графит"
        case .champagne: return "Шампань"
        case .cream: return "Сливочный"
        case .mint: return "Мятный"
        case .sky: return "Небесный"
        case .cherry: return "Вишнёвый"
        case .lemon: return "Лимонный"
        case .powder: return "Пудровый"
        case .black: return "Чёрный глянец"
        }
    }

    var isMetal: Bool { self == .steel || self == .graphite || self == .champagne }

    static let metals: [DoorFinish] = [.steel, .graphite, .champagne]
    static let enamels: [DoorFinish] = [.cream, .mint, .sky, .cherry, .lemon, .powder, .black]
}

/// The kind of fridge: the shape of its door and its chrome hardware. The retro models
/// follow real fridges of their era: a cushioned door with deep rounded edges, a chunky
/// chrome handle and a chrome name.
enum DoorModel: String, Codable, Hashable, CaseIterable, Identifiable {
    /// A flat modern door without a handle.
    case modern
    /// American 1950s: a long bar handle with a push button, a chrome script name on top.
    case fifties
    /// Italian revival of the 50s look: a chunky grip and a wide-spaced name at the bottom.
    case riviera
    /// Soviet 1960s: a lever with a lock and a chrome badge with wings.
    case thaw

    var id: String { rawValue }

    var title: String {
        switch self {
        case .modern: return "Современный"
        case .fifties: return "Пятидесятые"
        case .riviera: return "Ривьера"
        case .thaw: return "Оттепель"
        }
    }

    var subtitle: String {
        switch self {
        case .modern: return "Плоская дверца без ручки"
        case .fifties: return "Американская классика: ручка с кнопкой и надпись хромированным почерком"
        case .riviera: return "Итальянский ретро: массивная ручка и имя внизу дверцы"
        case .thaw: return "Советские шестидесятые: рычаг с замком и шильдик с крылышками"
        }
    }

    /// A cushioned door with deep rounded edges and chrome hardware.
    var isRetro: Bool { self != .modern }

    /// What the name on the door is called in settings.
    var nameplateTitle: String {
        switch self {
        case .modern, .fifties: return "Надпись"
        case .riviera: return "Имя на дверце"
        case .thaw: return "Шильдик"
        }
    }

    var nameplateHint: String {
        switch self {
        case .modern, .fifties: return "Хромированный почерк наверху дверцы. Оставь пустым, чтобы убрать."
        case .riviera: return "Хромированные строчные буквы внизу дверцы, широко, как у итальянских холодильников."
        case .thaw: return "Слово на красной эмали в хромированной рамке с крылышками. Лучше коротко: «Дом», «Дача»."
        }
    }
}

/// How a fridge looks.
struct DoorDesign: Codable, Hashable {
    var finish: DoorFinish = .steel
    /// Chrome name on the door; empty means none.
    var nameplate = ""
    var model: DoorModel = .modern
    /// Retro models can hide their handle.
    var showsHandle = true

    /// The handle on the door, if any.
    var handle: DoorModel? {
        model.isRetro && showsHandle ? model : nil
    }

    private enum CodingKeys: String, CodingKey {
        case finish, nameplate, model, showsHandle
    }
}

extension DoorDesign {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init()
        finish = (try? container.decodeIfPresent(DoorFinish.self, forKey: .finish)) ?? .steel
        nameplate = try container.decodeIfPresent(String.self, forKey: .nameplate) ?? ""
        model = (try? container.decodeIfPresent(DoorModel.self, forKey: .model)) ?? .modern
        showsHandle = (try? container.decodeIfPresent(Bool.self, forKey: .showsHandle)) ?? true
    }
}

/// The shape of a fridge door. Each matches a Home Screen widget size.
enum FridgeFormat: String, Codable, Hashable, CaseIterable, Identifiable {
    /// Small widget.
    case square
    /// Medium widget: a wide, low door.
    case wide
    /// Large widget (and the extra large one on iPad).
    case tall

    var id: String { rawValue }

    var title: String {
        switch self {
        case .square: return "Маленький"
        case .wide: return "Широкий"
        case .tall: return "Большой"
        }
    }

    var widgetHint: String {
        switch self {
        case .square: return "для маленького виджета"
        case .wide: return "для среднего виджета"
        case .tall: return "для большого виджета"
        }
    }

    /// Width / height of the door.
    var aspect: CGFloat {
        switch self {
        case .square: return 1
        case .wide: return 2.14
        case .tall: return 338.0 / 354.0
        }
    }

    /// Items are sized against the width a tall door of the same height would have,
    /// so a magnet looks the same on every format. This is that size per door width.
    var unitPerWidth: CGFloat {
        min(1, FridgeFormat.tall.aspect / aspect)
    }
}

/// One fridge (a board): its own look and its own composition. The collection is shared.
struct Fridge: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var format: FridgeFormat = .tall
    var design = DoorDesign()
    var placements: [Placement] = []

    private enum CodingKeys: String, CodingKey {
        case id, name, format, design, placements
    }
}

extension Fridge {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(name: try container.decodeIfPresent(String.self, forKey: .name) ?? "Холодильник")
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        format = (try? container.decodeIfPresent(FridgeFormat.self, forKey: .format)) ?? .tall
        design = (try? container.decodeIfPresent(DoorDesign.self, forKey: .design)) ?? DoorDesign()
        placements = (try? container.decodeIfPresent([Placement].self, forKey: .placements)) ?? []
    }
}

/// A ready combination for a new fridge.
struct FridgePreset: Identifiable, Hashable {
    let name: String
    let design: DoorDesign

    var id: String { "\(design.model.rawValue)-\(design.finish.rawValue)" }

    static let all: [FridgePreset] = [
        FridgePreset(name: "Кухня", design: DoorDesign(finish: .mint, nameplate: "Кухня", model: .fifties)),
        FridgePreset(name: "Дача", design: DoorDesign(finish: .cherry, nameplate: "дача", model: .riviera)),
        FridgePreset(name: "Дом", design: DoorDesign(finish: .cream, nameplate: "Дом", model: .thaw)),
        FridgePreset(name: "Детская", design: DoorDesign(finish: .sky, model: .fifties)),
        FridgePreset(name: "Студия", design: DoorDesign(finish: .steel, model: .modern)),
    ]

    /// A name to suggest for a new fridge of this look.
    static func suggestedName(for design: DoorDesign) -> String {
        if let preset = all.first(where: { $0.design.model == design.model && $0.design.finish == design.finish }) {
            return preset.name
        }
        return design.model.isRetro ? design.model.title : design.finish.title
    }
}

/// Everything the app and the widget share. Stored as JSON in the App Group container.
struct FridgeState: Codable, Hashable {
    var version = 3
    var items: [FridgeItem] = []
    var fridges: [Fridge] = []
    var currentFridgeID: UUID?

    private enum CodingKeys: String, CodingKey {
        case version, items, fridges, currentFridgeID, door
    }

    /// The single door of earlier versions, read once and turned into a fridge.
    private struct LegacyDoor: Decodable {
        var design: DoorDesign?
        var placements: [Placement]?
    }

    init(items: [FridgeItem] = [], fridges: [Fridge] = [], currentFridgeID: UUID? = nil) {
        self.items = items
        self.fridges = fridges
        self.currentFridgeID = currentFridgeID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([FridgeItem].self, forKey: .items) ?? []
        fridges = try container.decodeIfPresent([Fridge].self, forKey: .fridges) ?? []
        currentFridgeID = try container.decodeIfPresent(UUID.self, forKey: .currentFridgeID)
        if fridges.isEmpty, let legacy = try? container.decodeIfPresent(LegacyDoor.self, forKey: .door) {
            fridges = [Fridge(name: "Кухня", format: .tall, design: legacy.design ?? DoorDesign(),
                              placements: legacy.placements ?? [])]
        }
        if fridges.isEmpty {
            fridges = [Fridge(name: "Кухня")]
        }
        version = 3
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(items, forKey: .items)
        try container.encode(fridges, forKey: .fridges)
        try container.encodeIfPresent(currentFridgeID, forKey: .currentFridgeID)
    }

    func item(_ id: UUID) -> FridgeItem? {
        items.first { $0.id == id }
    }

    func fridge(_ id: UUID?) -> Fridge? {
        guard let id else { return nil }
        return fridges.first { $0.id == id }
    }

    /// Index of the fridge being edited; always valid while there is at least one fridge.
    var currentIndex: Int {
        if let id = currentFridgeID, let index = fridges.firstIndex(where: { $0.id == id }) {
            return index
        }
        return 0
    }

    /// The fridge that best fits a widget: the chosen one, else the first of the right format.
    func fridge(for format: FridgeFormat, preferred: UUID?) -> Fridge? {
        if let chosen = fridge(preferred) { return chosen }
        return fridges.first { $0.format == format } ?? fridges.first
    }
}

extension FridgeState {
    /// The first fridge: a note, a few magnets and a word, so it never starts empty.
    /// The person adds their own photos next.
    static var starter: FridgeState {
        let note = FridgeItem(content: .note(NoteContent(text: "Хорошо быть дома", paper: .cream, shape: .torn, font: .caveat)))
        var fridge = Fridge(name: "Кухня", format: .tall,
                            design: DoorDesign(finish: .mint, nameplate: "Кухня", model: .fifties))
        fridge.placements = [
            Placement(source: .magnet("lemon"), x: 0.22, y: 0.31, width: 0.2, rotation: -8),
            Placement(source: .item(note.id), x: 0.43, y: 0.6, width: 0.46, rotation: -4,
                      fastener: Fastener(kind: .greenMagnet, x: 0.5, y: 0.08)),
            Placement(source: .magnet("strawberry"), x: 0.62, y: 0.28, width: 0.16, rotation: 10),
            Placement(source: .magnet("heart"), x: 0.7, y: 0.84, width: 0.16, rotation: -12),
            Placement(source: .letter(LetterMagnet(character: "Д", color: .red)), x: 0.19, y: 0.85, width: 0.11, rotation: -6),
            Placement(source: .letter(LetterMagnet(character: "О", color: .yellow)), x: 0.29, y: 0.86, width: 0.11, rotation: 4),
            Placement(source: .letter(LetterMagnet(character: "М", color: .green)), x: 0.39, y: 0.85, width: 0.11, rotation: -3),
        ]
        return FridgeState(items: [note], fridges: [fridge], currentFridgeID: fridge.id)
    }
}
