import AppIntents
import Foundation
import UserNotifications
import WidgetKit

/// Ticks a to-do note. Runs from the widget's checkbox without opening the app;
/// the app picks the change up when it becomes active.
struct ToggleTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Отметить дело"
    static let description: IntentDescription? = IntentDescription("Отмечает записку-дело на холодильнике как сделанную или возвращает её.")

    @Parameter(title: "Записка")
    var itemID: String

    init() {}

    init(itemID: UUID) {
        self.itemID = itemID.uuidString
    }

    func perform() async throws -> some IntentResult {
        if let id = UUID(uuidString: itemID), let isDone = FridgeStorage.toggleTask(itemID: id), isDone {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [ReminderIDs.identifier(for: id)])
        }
        WidgetCenter.shared.reloadTimelines(ofKind: FridgeStorage.widgetKind)
        return .result()
    }
}

/// Notification identifiers shared by the app and the widget.
enum ReminderIDs {
    static let prefix = "note-"

    static func identifier(for itemID: UUID) -> String {
        prefix + itemID.uuidString
    }
}
