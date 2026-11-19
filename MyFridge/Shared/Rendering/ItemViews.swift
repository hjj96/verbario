import SwiftUI
import WidgetKit

/// Draws one thing at the given size, without shadow, rotation or fastener.
struct ItemContentView: View {
    let content: RenderContent
    let size: CGSize

    var body: some View {
        switch content {
        case .photo(let photo, let image):
            switch photo.style {
            case .card:
                PhotoCardView(image: image, size: size)
            case .cutout:
                CutoutMagnetView(image: image)
                    .frame(width: size.width, height: size.height)
            case .round, .heart:
                ShapedPhotoMagnetView(image: image, style: photo.style)
                    .frame(width: size.width, height: size.height)
            }
        case .note(let note, let id):
            NoteView(note: note, size: size, itemID: id)
        case .magnet(let art):
            CatalogMagnetView(art: art)
                .frame(width: size.width, height: size.height)
        case .letter(let letter):
            LetterMagnetView(letter: letter)
                .frame(width: size.width, height: size.height)
        }
    }
}

/// A photo with tinted / clear Home Screen support: there it is shown desaturated
/// with the system tint instead of disappearing.
struct PhotoImage: View {
    let image: UIImage

    var body: some View {
        if #available(iOS 18.0, *) {
            Image(uiImage: image)
                .resizable()
                .widgetAccentedRenderingMode(.accentedDesaturated)
        } else {
            Image(uiImage: image)
                .resizable()
        }
    }
}

struct PhotoCardView: View {
    let image: UIImage?
    let size: CGSize

    var body: some View {
        let border = size.width * PhotoCardLayout.border
        let extra = size.width * PhotoCardLayout.bottomExtra
        let imageSize = CGSize(width: max(1, size.width - border * 2),
                               height: max(1, size.height - border * 2 - extra))
        ZStack(alignment: .top) {
            Rectangle()
                .fill(LinearGradient(colors: [Color(hex: 0xFDFBF6), Color(hex: 0xEFEBE2)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
            Group {
                if let image {
                    PhotoImage(image: image)
                        .scaledToFill()
                } else {
                    PhotoPlaceholder()
                }
            }
            .frame(width: imageSize.width, height: imageSize.height)
            .clipped()
            .overlay {
                Rectangle().strokeBorder(Color.black.opacity(0.1), lineWidth: 0.5)
            }
            .padding(.top, border)
        }
        .frame(width: size.width, height: size.height)
    }
}

struct PhotoPlaceholder: View {
    var body: some View {
        LinearGradient(colors: [Color(hex: 0xBFCAD4), Color(hex: 0x8E9CA9)],
                       startPoint: .top, endPoint: .bottom)
            .overlay {
                Image(systemName: "photo")
                    .foregroundStyle(Color.white.opacity(0.8))
            }
    }
}

/// One thing as it hangs on the door: content, its fastener, rotation and shadow.
/// The caller positions it (`.position`) in door coordinates.
struct PlacedItemView: View {
    let content: RenderContent
    let placement: Placement
    let doorSize: CGSize
    var lifted = false
    var showsFastener = true
    /// Extra tilt while the item swings in the hand.
    var sway: Double = 0

    var body: some View {
        let itemSize = ItemMetrics.size(of: content, width: placement.width, in: doorSize)
        ItemContentView(content: content, size: itemSize)
            .frame(width: itemSize.width, height: itemSize.height)
            .overlay(alignment: .topLeading) {
                if showsFastener, let fastener = placement.fastener, content.acceptsFastener {
                    FastenerView(kind: fastener.kind, size: ItemMetrics.fastenerSize(in: doorSize))
                        .rotationEffect(.degrees(fastener.rotation))
                        .position(x: fastener.x * itemSize.width, y: fastener.y * itemSize.height)
                }
            }
            .rotationEffect(.degrees(placement.rotation + sway))
            .modifier(ItemShadow(depth: content.depth, unit: doorSize.width, lifted: lifted))
            .scaleEffect(lifted ? 1.06 : 1)
    }
}

/// A tight contact shadow plus a soft one. Lifting an item makes the soft shadow larger.
struct ItemShadow: ViewModifier {
    let depth: CGFloat
    let unit: CGFloat
    var lifted = false

    func body(content: Content) -> some View {
        let k: CGFloat = lifted ? 3 : 1
        content
            .compositingGroup()
            .shadow(color: Color.black.opacity(lifted ? 0.18 : 0.3),
                    radius: unit * 0.004 * depth,
                    x: unit * 0.002 * depth,
                    y: unit * 0.004 * depth)
            .shadow(color: Color.black.opacity(lifted ? 0.26 : 0.2),
                    radius: unit * 0.012 * depth * k,
                    x: unit * 0.008 * depth * k,
                    y: unit * 0.014 * depth * k)
    }
}

/// A finished, non-interactive door: used by the widget and by previews in the app.
struct FridgeCompositionView: View {
    let design: DoorDesign
    let placements: [Placement]
    var showsDoor = true
    var showsOutline = false
    let resolve: (Placement) -> RenderContent?

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                if showsDoor {
                    DoorBackgroundView(design: design)
                }
                if showsOutline {
                    DoorOutlineView()
                }
                ForEach(placements) { placement in
                    if let content = resolve(placement) {
                        PlacedItemView(content: content, placement: placement, doorSize: size)
                            .position(x: placement.x * size.width, y: placement.y * size.height)
                    }
                }
                DoorHandleView(design: design)
            }
        }
    }
}
