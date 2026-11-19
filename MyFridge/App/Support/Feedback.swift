import AudioToolbox
import UIKit

/// Haptics and the optional click for "lift" and "attach" moments in the editor.
enum Feedback {
    static let hapticsKey = "hapticsEnabled"
    static let soundKey = "clickSoundEnabled"

    private static var hapticsEnabled: Bool {
        UserDefaults.standard.object(forKey: hapticsKey) as? Bool ?? true
    }

    private static var soundEnabled: Bool {
        UserDefaults.standard.bool(forKey: soundKey)
    }

    /// The item is picked up from the door.
    @MainActor
    static func lift() {
        guard hapticsEnabled else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.6)
    }

    /// The item snaps back onto the metal.
    @MainActor
    static func attach() {
        if hapticsEnabled {
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.85)
        }
        if soundEnabled {
            AudioServicesPlaySystemSound(1104)
        }
    }

    @MainActor
    static func select() {
        guard hapticsEnabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
