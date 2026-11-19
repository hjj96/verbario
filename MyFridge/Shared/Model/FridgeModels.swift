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

enum PhotoStyle: String, Codable, Hashable, CaseIterable {
    /// The object is cut out of the photo and gets a thin sticker edge.
    case cutout
    /// The whole snapshot in a paper frame, usually held by a separate magnet.
    case card

    var title: String {
        switch self {
        case .cutout: return "Фотомагнит"
        case .card: return "Фотокарточка"
        }
    }
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

// MARK: - Door

/// What a placement shows: an item from the collection or a magnet from the starter set.
enum PlacementSource: Codable, Hashable {
    case item(UUID)
    case magnet(String)
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

enum DoorStyle: String, Codable, Hashable, CaseIterable, Identifiable {
    case steel, warm, enamel

    var id: String { rawValue }

    var title: String {
        switch self {
        case .steel: return "Стальной ретро"
        case .warm: return "Тёплый металл"
        case .enamel: return "Голубая эмаль"
        }
    }

    var subtitle: String {
        switch self {
        case .steel: return "Холодная сталь и хромированная ручка"
        case .warm: return "Тёплый оттенок металла и светлая ручка"
        case .enamel: return "Сталь в голубой эмалевой рамке"
        }
    }
}

struct FridgeDoor: Codable, Hashable {
    var style: DoorStyle = .steel
    var placements: [Placement] = []
}

/// Everything the app and the widget share. Stored as JSON in the App Group container.
struct FridgeState: Codable, Hashable {
    var version = 1
    var items: [FridgeItem] = []
    var door = FridgeDoor()

    func item(_ id: UUID) -> FridgeItem? {
        items.first { $0.id == id }
    }
}
