import SwiftUI

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

    static let editorTop = Color.adaptive(light: 0xEEF0F6, dark: 0x15171C)
    static let editorBottom = Color.adaptive(light: 0xE1E5EE, dark: 0x0E0F12)
    static let tileBackground = Color(.secondarySystemGroupedBackground)
}

struct EditorBackground: View {
    var body: some View {
        LinearGradient(colors: [.editorTop, .editorBottom], startPoint: .top, endPoint: .bottom)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Capsule().fill(Color.accentColor))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Slight press-down for tiles.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Light brushed-steel tile used behind previews.
struct SteelTile: View {
    var cornerRadius: CGFloat = 16

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        shape
            .fill(LinearGradient(colors: [Color(hex: 0xDCDFE3), Color(hex: 0xB3B8BE)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay {
                BrushedMetalTexture()
                    .opacity(0.8)
                    .clipShape(shape)
            }
            .overlay {
                shape.strokeBorder(Color.white.opacity(0.55), lineWidth: 1)
            }
    }
}

/// One item drawn at a given width, with its shadow, for sheets and tiles.
struct ItemPreview: View {
    let content: RenderContent
    var fastener: FastenerKind?
    var rotation: Double = -2
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

struct HeaderButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .background(Circle().fill(Color.tileBackground))
                .foregroundStyle(isEnabled ? Color.primary : Color.secondary.opacity(0.4))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

struct SecondaryTile: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(Color.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.tileBackground))
        }
        .buttonStyle(PressableStyle())
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
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isDestructive ? Color.red : Color.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.tileBackground))
        }
        .buttonStyle(PressableStyle())
    }
}

struct ChoiceChip: View {
    let title: String
    var font: Font = .subheadline.weight(.semibold)
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(font)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: 38)
                .foregroundStyle(isSelected ? Color.white : Color.primary)
                .background(Capsule().fill(isSelected ? Color.accentColor : Color.tileBackground))
        }
        .buttonStyle(PressableStyle())
    }
}

struct OptionSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Shows the store's toast with an optional "Отменить" button.
struct ToastHost: View {
    @Environment(FridgeStore.self) private var store

    var body: some View {
        ZStack {
            if let toast = store.toast {
                HStack(spacing: 14) {
                    Text(toast.message)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(2)
                    if toast.undoable {
                        Button("Отменить") { store.undoFromToast() }
                            .font(.subheadline.weight(.bold))
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(Capsule().fill(.regularMaterial))
                .shadow(color: Color.black.opacity(0.15), radius: 12, y: 4)
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { store.dismissToast() }
            }
        }
        .animation(.snappy, value: store.toast)
    }
}
