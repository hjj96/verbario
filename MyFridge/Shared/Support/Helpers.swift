import SwiftUI

/// Small deterministic generator (SplitMix64). Paper edges and metal brushing must look the
/// same in the editor and in the widget, so they never use system randomness.
struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// Uniform value in 0..<1.
    mutating func unit() -> CGFloat {
        CGFloat(Double(next() >> 11) / Double(UInt64(1) << 53))
    }

    mutating func range(_ limits: ClosedRange<CGFloat>) -> CGFloat {
        limits.lowerBound + (limits.upperBound - limits.lowerBound) * unit()
    }

    mutating func chance(_ probability: CGFloat) -> Bool {
        unit() < probability
    }
}

extension UUID {
    /// Stable 64-bit seed derived from the UUID bytes (FNV-1a).
    var seed: UInt64 {
        let b = uuid
        let bytes: [UInt8] = [b.0, b.1, b.2, b.3, b.4, b.5, b.6, b.7,
                              b.8, b.9, b.10, b.11, b.12, b.13, b.14, b.15]
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in bytes {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return hash
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}

extension CGPoint {
    /// Rotates the point around the origin (screen coordinates, positive = clockwise).
    func rotated(by angle: Angle) -> CGPoint {
        let c = CGFloat(cos(angle.radians))
        let s = CGFloat(sin(angle.radians))
        return CGPoint(x: x * c - y * s, y: x * s + y * c)
    }
}
