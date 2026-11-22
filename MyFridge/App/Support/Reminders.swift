import Foundation
import UserNotifications

/// Local notifications for notes with a reminder. The set of pending notifications is
/// rebuilt from the saved state, so undo, delete and "done" never leave stale reminders.
enum Reminders {
    static func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        default:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        }
    }

    static func sync(with state: FridgeState) {
        var wanted: [String: (text: String, date: Date)] = [:]
        let now = Date()
        for item in state.items {
            guard case .note(let note) = item.content, let date = note.reminder, !note.isDone, date > now else { continue }
            wanted[ReminderIDs.identifier(for: item.id)] = (note.text, date)
        }
        Task {
            let center = UNUserNotificationCenter.current()
            let pending = await center.pendingNotificationRequests()
            let stale = pending.map(\.identifier).filter { $0.hasPrefix(ReminderIDs.prefix) && wanted[$0] == nil }
            if !stale.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: stale)
            }
            for (identifier, reminder) in wanted {
                let content = UNMutableNotificationContent()
                content.title = "Note on the fridge"
                content.body = reminder.text
                content.sound = .default
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.date)
                let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
                try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
            }
        }
    }
}
