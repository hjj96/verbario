import SwiftUI

/// Everything a view needs to draw one thing on the door.
enum RenderContent {
    case photo(PhotoContent, UIImage?)
    case note(NoteContent, seed: UInt64)
    case magnet(MagnetDefinition)

    /// How far the thing stands off the metal: paper is flat, ceramic is thick.
    var depth: CGFloat {
        switch self {
        case .photo(let photo, _):
            return photo.style == .cutout ? 1.0 : 0.8
        case .note:
            return 0.6
        case .magnet(let magnet):
            if case .star = magnet.art { return 1.1 }
            return 1.5
        }
    }

    /// Ready magnets hold themselves; photos and notes can get a separate fastener.
    var acceptsFastener: Bool {
        if case .magnet = self { return false }
        return true
    }

    var title: String {
        switch self {
        case .photo(let photo, _): return photo.style.title
        case .note: return "Записка"
        case .magnet(let magnet): return magnet.title
        }
    }
}

/// Shared proportions of the door (fractions of the door size).
enum DoorGeometry {
    /// The seam between the top cap and the rest of the door.
    static let seam: CGFloat = 0.12
    static let handleX: CGFloat = 0.9
    static let handleTop: CGFloat = 0.3
    static let handleBottom: CGFloat = 0.72
    /// Outer corner radius in the app (the widget uses the system shape).
    static let cornerRadius: CGFloat = 0.075
}

enum ItemMetrics {
    /// Width / height of the door. Matches the large widget on iPhone, so the editor shows
    /// exactly what the Home Screen will show.
    static let doorAspect: CGFloat = 338.0 / 354.0
    static let minWidth: CGFloat = 0.07
    static let maxWidth: CGFloat = 0.9
    /// Keeps the widget well inside its memory budget.
    static let maxPlacements = 20

    static func aspect(of content: RenderContent) -> CGFloat {
        switch content {
        case .photo(let photo, _):
            let imageAspect = CGFloat(photo.aspect)
            if photo.style == .card {
                return PhotoCardLayout.outerAspect(imageAspect: imageAspect)
            }
            return max(imageAspect, 0.2)
        case .note(let note, _):
            return note.shape.aspect
        case .magnet:
            return 1
        }
    }

    static func size(of content: RenderContent, width: CGFloat, in door: CGSize) -> CGSize {
        let w = width * door.width
        return CGSize(width: w, height: w / aspect(of: content))
    }

    static func fastenerSize(in door: CGSize) -> CGFloat {
        door.width * 0.075
    }

    static func defaultWidth(for content: RenderContent) -> CGFloat {
        let base: CGFloat
        switch content {
        case .photo(let photo, _):
            if photo.style == .card {
                base = photo.aspect > 1.1 ? 0.46 : 0.36
            } else {
                base = 0.42
            }
        case .note(let note, _):
            base = note.shape.defaultWidth
        case .magnet(let magnet):
            if case .star = magnet.art {
                base = 0.11
            } else {
                base = 0.15
            }
        }
        // Tall things should not cover more than half of the door.
        let limit = 0.5 * aspect(of: content) / doorAspect
        return min(base, limit)
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
