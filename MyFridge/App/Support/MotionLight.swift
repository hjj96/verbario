import CoreMotion
import SwiftUI

/// Turns the phone's tilt into a `MagnetLight`: highlights slide over the metal and the
/// magnets show a little more of their sides, as if you were turning a real door.
@MainActor
@Observable
final class MotionLight {
    private(set) var light = MagnetLight()

    @ObservationIgnored private let manager = CMMotionManager()
    @ObservationIgnored private var reference: CMAcceleration?
    @ObservationIgnored private var smoothed = CGVector.zero
    @ObservationIgnored private var users = 0

    func start() {
        users += 1
        guard users == 1, manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let gravity = motion?.gravity else { return }
            MainActor.assumeIsolated {
                self?.update(gravity)
            }
        }
    }

    func stop() {
        users = max(0, users - 1)
        guard users == 0 else { return }
        manager.stopDeviceMotionUpdates()
        reference = nil
        smoothed = .zero
        light = MagnetLight()
    }

    private func update(_ gravity: CMAcceleration) {
        var base = reference ?? gravity
        let raw = CGVector(dx: CGFloat((gravity.x - base.x) * 2.4).clamped(to: -1...1),
                           dy: CGFloat((gravity.y - base.y) * 2.4).clamped(to: -1...1))
        smoothed = CGVector(dx: smoothed.dx * 0.8 + raw.dx * 0.2, dy: smoothed.dy * 0.8 + raw.dy * 0.2)
        // Slowly re-centre on however the phone is being held.
        base.x += (gravity.x - base.x) * 0.004
        base.y += (gravity.y - base.y) * 0.004
        base.z += (gravity.z - base.z) * 0.004
        reference = base
        if abs(smoothed.dx - light.tilt.dx) > 0.004 || abs(smoothed.dy - light.tilt.dy) > 0.004 {
            light = MagnetLight(tilt: smoothed)
        }
    }
}
