import SwiftUI

// MARK: - Palette and type

/// The look of the concept book: warm paper, deep ink, a calm blue and serif headings.
extension Color {
    /// A colour that switches between light and dark appearance.
    static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255,
                           alpha: 1)
        })
    }

    static let paper = Color.adaptive(light: 0xF3F0E8, dark: 0x10171C)
    static let card = Color.adaptive(light: 0xFCFBF7, dark: 0x1A242B)
    static let ink = Color.adaptive(light: 0x18262F, dark: 0xEEF0EF)
    static let inkSoft = Color.adaptive(light: 0x6A757C, dark: 0x9AA6AD)
    static let hairline = Color.adaptive(light: 0xE2DDD1, dark: 0x2A353D)
    /// Text on an ink-coloured button.
    static let onInk = Color.adaptive(light: 0xF6F3EC, dark: 0x10171C)
}

extension Font {
    /// New York, like the headings of the concept book.
    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

/// Small spaced capitals, as in the book's running heads.
struct SectionLabel: View {
    let text: String
    var color: Color = .inkSoft

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.6)
            .foregroundStyle(color)
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.onInk)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Capsule().fill(Color.ink))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Slight press-down for tiles.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

struct RoundIconButton: View {
    let systemImage: String
    let label: String
    var size: CGFloat = 42
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.38, weight: .semibold))
                .frame(width: size, height: size)
                .background(Circle().fill(Color.card))
                .overlay { Circle().strokeBorder(Color.hairline, lineWidth: 1) }
                .foregroundStyle(isEnabled ? Color.ink : Color.inkSoft.opacity(0.4))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

struct ToolButton: View {
    let title: String
    let systemImage: String
    var isDestructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(isDestructive ? Color(hex: 0xC8372D) : Color.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.card))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1)
            }
        }
        .buttonStyle(PressableStyle())
    }
}

struct ChoiceChip: View {
    let title: String
    var font: Font = .system(size: 15, weight: .semibold)
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(font)
                .lineLimit(1)
                .padding(.horizontal, 15)
                .frame(height: 38)
                .foregroundStyle(isSelected ? Color.onInk : Color.ink)
                .background(Capsule().fill(isSelected ? Color.ink : Color.card))
                .overlay { Capsule().strokeBorder(isSelected ? Color.clear : Color.hairline, lineWidth: 1) }
        }
        .buttonStyle(PressableStyle())
    }
}

struct OptionSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: title)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A rounded card on the paper background.
struct PaperCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.card))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1)
        }
    }
}

// MARK: - Steel and previews

/// Light brushed-steel surface used for shelves and previews.
struct SteelTile: View {
    var cornerRadius: CGFloat = 16

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        DoorSurfaceView(finish: .steel)
            .clipShape(shape)
            .overlay {
                shape.strokeBorder(Color.black.opacity(0.06), lineWidth: 0.5)
            }
    }
}

/// One item drawn at a given width, with its shadow, for sheets and tiles.
struct ItemPreview: View {
    let content: RenderContent
    var fastener: FastenerKind?
    var rotation: Double = 0
    /// Width of the item in points.
    let width: CGFloat

    var body: some View {
        let relativeWidth = ItemMetrics.defaultWidth(for: content)
        let door = CGSize(width: width / relativeWidth, height: width / relativeWidth / ItemMetrics.doorAspect)
        let placement = Placement(source: .magnet("preview"), x: 0.5, y: 0.5, width: relativeWidth,
                                  rotation: rotation, fastener: fastener.map { Fastener.standard($0) })
        PlacedItemView(content: content, placement: placement, doorSize: door)
    }
}

/// Fits an item into a square box, keeping its proportions.
struct ItemThumb: View {
    let content: RenderContent
    let box: CGFloat

    var body: some View {
        let aspect = ItemMetrics.aspect(of: content)
        let width = aspect >= 1 ? box : box * aspect
        ItemPreview(content: content, width: width)
            .frame(width: box, height: box)
    }
}

// MARK: - Toast

/// Shows the store's toast with an optional "Undo" button.
struct ToastHost: View {
    @Environment(FridgeStore.self) private var store

    var body: some View {
        ZStack {
            if let toast = store.toast {
                HStack(spacing: 14) {
                    Text(toast.message)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.onInk)
                        .lineLimit(2)
                    if toast.undoable {
                        Button("Undo") { store.undoFromToast() }
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(Color(hex: 0x9DB4FF))
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 13)
                .background(Capsule().fill(Color.ink))
                .shadow(color: Color.black.opacity(0.2), radius: 14, y: 6)
                .padding(.horizontal, 20)
                .padding(.bottom, 10)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { store.dismissToast() }
            }
        }
        .animation(.snappy, value: store.toast)
    }
}
