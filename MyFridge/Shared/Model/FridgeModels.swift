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
        case .round: return "Круг"
        case .heart: return "Сердце"
        }
    }

    /// Shaped magnets store a square crop of the photo.
    var isShaped: Bool { self == .round || self == .heart }

    /// Stickers and cut-out magnets share the same transparent image and can be turned
    /// into one another.
    var isCutoutFamily: Bool { self == .cutout || self == .sticker || self == .holo }

    static let cutoutFinishes: [PhotoStyle] = [.sticker, .holo, .cutout]
    static let wholeFinishes: [PhotoStyle] = [.card, .round, .heart]
}

struct PhotoContent: Codable, Hashable {
    var style: PhotoStyle
    /// File name of the prepared image inside the shared images folder.
    var file: String
    /// Width / height of the stored image.
    var aspect: Double
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

/// One thing hanging on the door. Order in `FridgeDoor.placements` is the layer order
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
    case steel, champagne, blueRim, graphite, cream, sky, mint, cherry

    var id: String { rawValue }

    var title: String {
        switch self {
        case .steel: return "Сталь"
        case .champagne: return "Тёплый металл"
        case .blueRim: return "Сталь в голубой раме"
        case .graphite: return "Графит"
        case .cream: return "Сливочная эмаль"
        case .sky: return "Голубая эмаль"
        case .mint: return "Мятная эмаль"
        case .cherry: return "Вишнёвая эмаль"
        }
    }
}

enum HandleStyle: String, Codable, Hashable, CaseIterable, Identifiable {
    case chromeBow, creamBow, shortBow

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chromeBow: return "Хромированная дуга"
        case .creamBow: return "Сливочная ручка"
        case .shortBow: return "Короткая скоба"
        }
    }
}

/// How the fridge itself looks.
struct DoorDesign: Codable, Hashable {
    var finish: DoorFinish = .steel
    var handle: HandleStyle = .chromeBow
    /// Chrome script plate on the top cap; empty means no plate.
    var nameplate = ""

    private enum CodingKeys: String, CodingKey {
        case finish, handle, nameplate
    }
}

extension DoorDesign {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init()
        finish = try container.decodeIfPresent(DoorFinish.self, forKey: .finish) ?? .steel
        handle = try container.decodeIfPresent(HandleStyle.self, forKey: .handle) ?? .chromeBow
        nameplate = try container.decodeIfPresent(String.self, forKey: .nameplate) ?? ""
    }
}

struct FridgeDoor: Codable, Hashable {
    var design = DoorDesign()
    var placements: [Placement] = []
}

/// Everything the app and the widget share. Stored as JSON in the App Group container.
struct FridgeState: Codable, Hashable {
    var version = 2
    var items: [FridgeItem] = []
    var door = FridgeDoor()

    func item(_ id: UUID) -> FridgeItem? {
        items.first { $0.id == id }
    }
}

extension FridgeState {
    /// The first door: a note, a few magnets and a word, so the fridge never starts empty.
    /// The person adds their own photo next.
    static var starter: FridgeState {
        let note = FridgeItem(content: .note(NoteContent(text: "Хорошо быть дома", paper: .cream, shape: .torn, font: .caveat)))
        var door = FridgeDoor()
        door.placements = [
            Placement(source: .magnet("lemon"), x: 0.22, y: 0.31, width: 0.2, rotation: -8),
            Placement(source: .item(note.id), x: 0.43, y: 0.6, width: 0.46, rotation: -4,
                      fastener: Fastener(kind: .greenMagnet, x: 0.5, y: 0.08)),
            Placement(source: .magnet("strawberry"), x: 0.62, y: 0.28, width: 0.16, rotation: 10),
            Placement(source: .magnet("heart"), x: 0.7, y: 0.84, width: 0.16, rotation: -12),
            Placement(source: .letter(LetterMagnet(character: "Д", color: .red)), x: 0.19, y: 0.85, width: 0.11, rotation: -6),
            Placement(source: .letter(LetterMagnet(character: "О", color: .yellow)), x: 0.29, y: 0.86, width: 0.11, rotation: 4),
            Placement(source: .letter(LetterMagnet(character: "М", color: .green)), x: 0.39, y: 0.85, width: 0.11, rotation: -3),
        ]
        return FridgeState(items: [note], door: door)
    }
}
