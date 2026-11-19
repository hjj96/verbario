import SwiftUI
import WidgetKit

struct FridgeEntry: TimelineEntry {
    let date: Date
    let design: DoorDesign
    let placements: [Placement]
    /// Prepared content for every placement, keyed by placement id.
    let contents: [UUID: RenderContent]

    static func make(from state: FridgeState, loadImages: Bool) -> FridgeEntry {
        var contents: [UUID: RenderContent] = [:]
        let library = MagnetLibrary.shared
        for placement in state.door.placements {
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
        return FridgeEntry(date: Date(), design: state.door.design, placements: state.door.placements, contents: contents)
    }

    /// The door saved by the app, or nil before the first launch.
    static func stored() -> FridgeEntry? {
        guard case .loaded(let state) = FridgeStorage.loadState(backupOnFailure: false) else { return nil }
        return make(from: state, loadImages: true)
    }

    static var demo: FridgeEntry {
        make(from: .starter, loadImages: false)
    }
}

/// The widget only shows the saved door. The app asks WidgetKit to reload after every save,
/// and the to-do checkbox reloads it after its intent runs.
struct FridgeProvider: TimelineProvider {
    func placeholder(in context: Context) -> FridgeEntry {
        .demo
    }

    func getSnapshot(in context: Context, completion: @escaping (FridgeEntry) -> Void) {
        completion(FridgeEntry.stored() ?? .demo)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FridgeEntry>) -> Void) {
        let entry = FridgeEntry.stored() ?? .demo
        completion(Timeline(entries: [entry], policy: .never))
    }
}

struct FridgeWidgetView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: FridgeEntry

    var body: some View {
        FridgeCompositionView(design: entry.design,
                              placements: entry.placements,
                              showsDoor: false,
                              showsOutline: renderingMode != .fullColor) { placement in
            entry.contents[placement.id]
        }
        .environment(\.noteInteraction, .widget)
        .containerBackground(for: .widget) {
            DoorBackgroundView(design: entry.design)
        }
        .widgetURL(URL(string: "myfridge://door"))
    }
}

struct FridgeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: FridgeStorage.widgetKind, provider: FridgeProvider()) { entry in
            FridgeWidgetView(entry: entry)
        }
        .configurationDisplayName("Мой холодильник")
        .description("Твои фото, записки и магнитики на домашнем экране. Дела можно отмечать прямо здесь.")
        .supportedFamilies([.systemSmall, .systemLarge])
        .contentMarginsDisabled()
    }
}

@main
struct FridgeWidgetBundle: WidgetBundle {
    var body: some Widget {
        FridgeWidget()
    }
}
