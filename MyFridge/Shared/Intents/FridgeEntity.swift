import AppIntents
import Foundation

/// A fridge as the widget's settings see it.
struct FridgeEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Fridge"
    static let defaultQuery = FridgeEntityQuery()

    let id: String
    let name: String
    let format: FridgeFormat

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(format.title), \(format.widgetHint)")
    }

    init(_ fridge: Fridge) {
        id = fridge.id.uuidString
        name = fridge.name
        format = fridge.format
    }
}

struct FridgeEntityQuery: EntityQuery {
    func entities(for identifiers: [FridgeEntity.ID]) async throws -> [FridgeEntity] {
        Self.all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [FridgeEntity] {
        Self.all()
    }

    private static func all() -> [FridgeEntity] {
        guard case .loaded(let state) = FridgeStorage.loadState(backupOnFailure: false) else { return [] }
        return state.fridges.map(FridgeEntity.init)
    }
}

/// Lets each widget show its own fridge. Left empty, the widget picks one that fits its size.
struct SelectFridgeIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose Fridge"
    static let description: IntentDescription? = IntentDescription("Which fridge to show on the Home Screen.")

    @Parameter(title: "Fridge")
    var fridge: FridgeEntity?

    init() {}
}
