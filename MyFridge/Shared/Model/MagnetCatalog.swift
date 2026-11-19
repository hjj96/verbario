import Foundation

/// A ready-made magnet from the starter set. It is not stored in the collection: the set is
/// always available, and the same magnet can hang on the door several times.
struct MagnetDefinition: Identifiable, Hashable {
    enum Art: Hashable {
        /// Glossy ceramic-like object drawn from an emoji glyph.
        case emoji(String)
        /// Faceted metal star drawn in code.
        case star
    }

    let id: String
    let title: String
    let art: Art
}

enum MagnetCatalog {
    static let all: [MagnetDefinition] = [
        MagnetDefinition(id: "strawberry", title: "Клубника", art: .emoji("🍓")),
        MagnetDefinition(id: "orange", title: "Апельсин", art: .emoji("🍊")),
        MagnetDefinition(id: "lemon", title: "Лимон", art: .emoji("🍋")),
        MagnetDefinition(id: "cherries", title: "Вишня", art: .emoji("🍒")),
        MagnetDefinition(id: "star", title: "Звёздочка", art: .star),
        MagnetDefinition(id: "daisy", title: "Ромашка", art: .emoji("🌼")),
        MagnetDefinition(id: "tulip", title: "Тюльпан", art: .emoji("🌷")),
        MagnetDefinition(id: "sunflower", title: "Подсолнух", art: .emoji("🌻")),
        MagnetDefinition(id: "heart", title: "Сердечко", art: .emoji("🩷")),
        MagnetDefinition(id: "coffee", title: "Кофе", art: .emoji("☕️")),
        MagnetDefinition(id: "croissant", title: "Круассан", art: .emoji("🥐")),
        MagnetDefinition(id: "watermelon", title: "Арбуз", art: .emoji("🍉")),
        MagnetDefinition(id: "shell", title: "Ракушка", art: .emoji("🐚")),
        MagnetDefinition(id: "cloud", title: "Облако", art: .emoji("☁️")),
    ]

    static func magnet(_ id: String) -> MagnetDefinition? {
        all.first { $0.id == id }
    }
}

extension FridgeState {
    /// The first door: one note and a couple of magnets, so the fridge never starts empty.
    /// The person adds their own photo next.
    static var starter: FridgeState {
        let note = FridgeItem(content: .note(NoteContent(text: "Хорошо быть дома", paper: .cream, shape: .torn, font: .caveat)))
        var door = FridgeDoor()
        door.placements = [
            Placement(source: .magnet("daisy"), x: 0.24, y: 0.3, width: 0.15, rotation: -10),
            Placement(source: .item(note.id), x: 0.4, y: 0.6, width: 0.44, rotation: -4,
                      fastener: Fastener(kind: .greenMagnet, x: 0.5, y: 0.08)),
            Placement(source: .magnet("strawberry"), x: 0.64, y: 0.3, width: 0.16, rotation: 8),
            Placement(source: .magnet("star"), x: 0.66, y: 0.84, width: 0.1, rotation: 12),
        ]
        return FridgeState(items: [note], door: door)
    }
}
