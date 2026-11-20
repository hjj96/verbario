import SwiftUI

/// Everything a view needs to draw one thing on the door.
enum RenderContent {
    case photo(PhotoContent, UIImage?)
    case note(NoteContent, id: UUID)
    case magnet(MagnetArt)
    case letter(LetterMagnet)

    /// How far the thing stands off the metal: paper is flat, ceramic is thick.
    var depth: CGFloat {
        switch self {
        case .photo(let photo, _):
            switch photo.style {
            case .card, .polaroid: return 0.8
            case .cutout: return 1.1
            case .sticker, .holo: return 0.42
            case .round, .heart: return 1.25
            }
        case .note:
            return 0.6
        case .magnet(let art):
            return 0.8 + art.thickness / 10
        case .letter:
            return 1.3
        }
    }

    /// Photo cards and notes can get a separate fastener; magnets hold themselves.
    var acceptsFastener: Bool {
        switch self {
        case .photo(let photo, _): return photo.style == .card || photo.style == .polaroid
        case .note: return true
        case .magnet, .letter: return false
        }
    }

    var title: String {
        switch self {
        case .photo(let photo, _): return photo.style.title
        case .note(let note, _): return note.isTask ? "Дело" : "Записка"
        case .magnet(let art): return art.title
        case .letter(let letter): return "Буква «\(letter.character)»"
        }
    }
}

enum ItemMetrics {
    /// Width / height of the door. Matches the large widget on iPhone, so the editor shows
    /// exactly what the Home Screen will show.
    static let doorAspect: CGFloat = 338.0 / 354.0
    static let minWidth: CGFloat = 0.06
    static let maxWidth: CGFloat = 0.9
    /// Keeps the widget well inside its memory budget.
    static let maxPlacements = 30
    /// Width / height of a letter's box.
    static let letterAspect: CGFloat = 0.86

    static func aspect(of content: RenderContent) -> CGFloat {
        switch content {
        case .photo(let photo, _):
            switch photo.style {
            case .card: return PhotoCardLayout.outerAspect(imageAspect: CGFloat(photo.aspect))
            case .polaroid: return PolaroidLayout.outerAspect
            case .cutout, .sticker, .holo: return max(CGFloat(photo.aspect), 0.2)
            case .round, .heart: return PhotoShapes.unitSize.width / PhotoShapes.unitSize.height
            }
        case .note(let note, _):
            return note.shape.aspect
        case .magnet(let art):
            return art.aspect
        case .letter:
            return letterAspect
        }
    }

    /// The length item widths are measured against: the width of a tall door of the same
    /// height. A magnet keeps its size on square, wide and tall fridges alike.
    static func unit(in door: CGSize) -> CGFloat {
        min(door.width, door.height * FridgeFormat.tall.aspect)
    }

    static func size(of content: RenderContent, width: CGFloat, in door: CGSize) -> CGSize {
        let w = width * unit(in: door)
        return CGSize(width: w, height: w / aspect(of: content))
    }

    static func fastenerSize(in door: CGSize) -> CGFloat {
        unit(in: door) * 0.075
    }

    static func defaultWidth(for content: RenderContent) -> CGFloat {
        let base: CGFloat
        switch content {
        case .photo(let photo, _):
            switch photo.style {
            case .card: base = photo.aspect > 1.1 ? 0.46 : 0.36
            case .polaroid: base = 0.34
            case .cutout: base = 0.42
            case .sticker, .holo: base = 0.4
            case .round: base = 0.3
            case .heart: base = 0.32
            }
        case .note(let note, _):
            base = note.shape.defaultWidth
        case .magnet(let art):
            base = art.doorWidth
        case .letter:
            base = 0.11
        }
        // Tall things should not cover more than half of the door.
        let limit = 0.5 * aspect(of: content) / doorAspect
        return min(base, limit)
    }
}

/// An instant photo: a square picture with narrow sides and a wide bottom for a caption.
enum PolaroidLayout {
    static let side: CGFloat = 0.06
    static let bottom: CGFloat = 0.26

    static var outerAspect: CGFloat {
        1 / ((1 - 2 * side) + side + bottom)
    }
}

/// A photo card is the photo plus a paper border, a little wider at the bottom.
enum PhotoCardLayout {
    static let border: CGFloat = 0.05
    static let bottomExtra: CGFloat = 0.05

    static func outerAspect(imageAspect: CGFloat) -> CGFloat {
        1 / ((1 - 2 * border) / max(imageAspect, 0.1) + 2 * border + bottomExtra)
    }
}
