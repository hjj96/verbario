import AppIntents
import SwiftUI
import WidgetKit

struct FridgeEntry: TimelineEntry {
    let date: Date
    let fridge: Fridge
    /// Prepared content for every placement, keyed by placement id.
    let contents: [UUID: RenderContent]

    static func make(fridge: Fridge, state: FridgeState, loadImages: Bool) -> FridgeEntry {
        var contents: [UUID: RenderContent] = [:]
        let library = MagnetLibrary.shared
        for placement in fridge.placements {
            switch placement.source {
            case .magnet(let magnetID):
                if let art = library.magnet(magnetID) {
                    contents[placement.id] = .magnet(art)
                }
            case .letter(let letter):
                contents[placement.id] = .letter(letter)
            case .item(let itemID):
                guard let item = state.item(itemID) else { continue }
                switch item.content {
                case .photo(let photo):
                    let image = loadImages ? FridgeStorage.loadWidgetImage(photo.file) : nil
                    contents[placement.id] = .photo(photo, image)
                case .note(let note):
                    contents[placement.id] = .note(note, id: item.id)
                }
            }
        }
        return FridgeEntry(date: Date(), fridge: fridge, contents: contents)
    }

    /// The configured fridge (or the best one for this widget size) from the app's saved state.
    static func stored(preferred: String?, format: FridgeFormat) -> FridgeEntry? {
        guard case .loaded(let state) = FridgeStorage.loadState(backupOnFailure: false),
              let fridge = state.fridge(for: format, preferred: preferred.flatMap(UUID.init(uuidString:))) else { return nil }
        return make(fridge: fridge, state: state, loadImages: true)
    }

    static func demo(format: FridgeFormat) -> FridgeEntry {
        let starter = FridgeState.starter
        var fridge = starter.fridges[0]
        fridge.format = format
        if format == .wide {
            fridge.design = DoorDesign(finish: .mint)
            fridge.placements = [
                Placement(source: .magnet("lemon"), x: 0.14, y: 0.55, width: 0.2, rotation: -8),
                Placement(source: fridge.placements[1].source, x: 0.42, y: 0.6, width: 0.44, rotation: -3,
                          fastener: Fastener(kind: .greenMagnet, x: 0.5, y: 0.08)),
                Placement(source: .magnet("strawberry"), x: 0.7, y: 0.5, width: 0.16, rotation: 10),
                Placement(source: .magnet("heart"), x: 0.86, y: 0.7, width: 0.16, rotation: -12),
            ]
        }
        return make(fridge: fridge, state: starter, loadImages: false)
    }
}

extension WidgetFamily {
    /// The fridge format that fills this widget exactly.
    var fridgeFormat: FridgeFormat {
        switch self {
        case .systemSmall: return .square
        case .systemMedium: return .wide
        default: return .tall
        }
    }
}

/// Shows the saved fridge. The app asks WidgetKit to reload after every save,
/// and the to-do checkbox reloads it after its intent runs.
struct FridgeProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FridgeEntry {
        .demo(format: context.family.fridgeFormat)
    }

    func snapshot(for configuration: SelectFridgeIntent, in context: Context) async -> FridgeEntry {
        entry(for: configuration, family: context.family)
    }

    func timeline(for configuration: SelectFridgeIntent, in context: Context) async -> Timeline<FridgeEntry> {
        Timeline(entries: [entry(for: configuration, family: context.family)], policy: .never)
    }

    private func entry(for configuration: SelectFridgeIntent, family: WidgetFamily) -> FridgeEntry {
        let format = family.fridgeFormat
        return FridgeEntry.stored(preferred: configuration.fridge?.id, format: format) ?? .demo(format: format)
    }
}

struct FridgeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FridgeEntry

    var body: some View {
        let target = family.fridgeFormat
        let fridge = entry.fridge
        GeometryReader { geo in
            let area = fittedArea(for: fridge.format, in: geo.size, target: target)
            ZStack(alignment: .topLeading) {
                FridgeCompositionView(design: fridge.design,
                                      format: fridge.format,
                                      placements: fridge.placements,
                                      showsDoor: false) { placement in
                    entry.contents[placement.id]
                }
                .frame(width: area.width, height: area.height)
                .offset(x: area.minX, y: area.minY)
            }
        }
        .environment(\.noteInteraction, .widget)
        .containerBackground(for: .widget) {
            DoorBackgroundView(design: fridge.design, format: target)
        }
        .widgetURL(URL(string: "myfridge://fridge/\(fridge.id.uuidString)"))
    }

    /// A fridge of another shape is shown centred at its own proportions on a door of this size.
    private func fittedArea(for format: FridgeFormat, in size: CGSize, target: FridgeFormat) -> CGRect {
        guard format != target, size.width > 0, size.height > 0 else { return CGRect(origin: .zero, size: size) }
        let aspect = format.aspect
        var width = size.width
        var height = width / aspect
        if height > size.height {
            height = size.height
            width = height * aspect
        }
        return CGRect(x: (size.width - width) / 2, y: (size.height - height) / 2, width: width, height: height)
    }
}

struct FridgeWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: FridgeStorage.widgetKind, intent: SelectFridgeIntent.self, provider: FridgeProvider()) { entry in
            FridgeWidgetView(entry: entry)
        }
        .configurationDisplayName("Мой холодильник")
        .description("Твои стикеры, фото, записки и магнитики. Удержи виджет, чтобы выбрать холодильник.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
        .contentMarginsDisabled()
    }
}

@main
struct FridgeWidgetBundle: WidgetBundle {
    var body: some Widget {
        FridgeWidget()
    }
}
