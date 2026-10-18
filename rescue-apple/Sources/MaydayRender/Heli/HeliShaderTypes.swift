// Swift side of Shaders/Heli/HeliShaderTypes.h. The clang module MaydayShaderTypes only exports
// ShaderTypes.h, so the heli uniform blocks are written here as what they are in memory: every member of
// every heli struct is a float4 (PLAN §3.4 layout rule), so a block is a sequence of SIMD4<Float> slots in
// declaration order. Each packer below appends the slots in the header's member order; `slots` is checked
// against sizeof(…) / 16 of the header (the same numbers as its MD_STATIC_ASSERTs) before anything reaches
// the GPU.
import Foundation
import MaydayCore

/// Slot counts = sizeof(struct) / 16, asserted on the MSL side by HeliShaderTypes.h.
public enum HeliShaderLayout {
  public static let hullGlows = 8          // MD_HULL_GLOWS
  public static let lightChannels = 10     // MD_LIGHT_CHANNELS
  public static let cablePoints = 15       // MD_CABLE_POINTS
  public static let ringVertices = 98      // MD_RING_VERTICES
  public static let wxSlots = 6            // MDWxParams 96
  public static let hullSlots = 29         // MDHullUniforms 464
  public static let rotorSlots = 16        // MDRotorUniforms 256
  public static let lightsSlots = 4        // MDHeliLightsUniforms 64
  public static let coneSlots = 4          // MDConeUniforms 64
  public static let cableSlots = 19        // MDCableUniforms 304
  public static let ringSlots = 100        // MDRingUniforms 1600
  public static let propSlots = 3          // MDHeliPropMaterial 48

  // vertex attribute slots (HeliShaderTypes.h MD_HELI_ATTR_*; shared ones from ShaderTypes.h MD_ATTR_*)
  public static let attrPosition = 0, attrNormal = 1, attrUV = 2, attrColor = 3, attrSurf = 4
  public static let attrCorner = 6, attrChan = 7, attrSize = 8, attrSide = 9, attrDir = 10, attrV = 11
  public static let attrAng = 12, attrEdge = 13
  public static let texDecal = 8           // MD_TEX_HELI_DECAL
  public static let samplerDecal = 5       // MD_SMP_HELI_DECAL
  public static let fcVertexColor = 20     // MD_FC_HELI_VCOLOR
}

/// A uniform block under construction: float4 slots in member order.
public struct HeliUniformBlock {
  public private(set) var slots: [SIMD4<Float>] = []
  public init(capacity: Int) { slots.reserveCapacity(capacity) }

  public mutating func add(_ x: Float, _ y: Float, _ z: Float, _ w: Float) { slots.append(SIMD4<Float>(x, y, z, w)) }
  public mutating func add(_ v: SIMD3<Float>, _ w: Float) { slots.append(SIMD4<Float>(v.x, v.y, v.z, w)) }
  public mutating func add(_ v: SIMD4<Float>) { slots.append(v) }
  public mutating func add(_ c: Color3, _ w: Double = 0) { slots.append(SIMD4<Float>(Float(c.r), Float(c.g), Float(c.b), Float(w))) }
  public mutating func add(_ v: V3, _ w: Double = 0) { slots.append(SIMD4<Float>(Float(v.x), Float(v.y), Float(v.z), Float(w))) }

  /// The finished block; traps when the member count does not match the header's struct.
  public func finished(_ expected: Int, _ name: String) -> [SIMD4<Float>] {
    precondition(slots.count == expected, "\(name): \(slots.count) float4 slots, HeliShaderTypes.h has \(expected)")
    return slots
  }
}

/// core/weathering.js patchWeathering uniforms (MDWxParams), as the hull material compiled them in the
/// web (bake-meshes.mjs runs the material's onBeforeCompile; heli_hull.mmesh meta `material.uniforms`).
public struct HeliWxParams: Equatable {
  public var uWxA = SIMD4<Float>(0, 0, 0, 0)    // breakup, streaks, grime, waterline
  public var uWxB = SIMD4<Float>(0, 0, 1, 0)    // roughBreakup, deckWear, scale, seaLevel
  public var uWxStreak = SIMD3<Float>(0, 0, 0)
  public var uWxGrime = SIMD3<Float>(0, 0, 0)
  public var uWxAlgae = SIMD3<Float>(0, 0, 0)
  public var uWxSalt = SIMD3<Float>(0, 0, 0)

  public init() {}

  public init(meta: MMeshMeta) throws {
    let a = try meta.requireVector("uWxA", count: 4), b = try meta.requireVector("uWxB", count: 4)
    uWxA = SIMD4<Float>(a[0], a[1], a[2], a[3])
    uWxB = SIMD4<Float>(b[0], b[1], b[2], b[3])
    uWxStreak = try meta.requireColor("uWxStreak")
    uWxGrime = try meta.requireColor("uWxGrime")
    uWxAlgae = try meta.requireColor("uWxAlgae")
    uWxSalt = try meta.requireColor("uWxSalt")
  }

  func append(to b: inout HeliUniformBlock) {
    b.add(uWxA)
    b.add(uWxB)
    b.add(uWxStreak, 0)
    b.add(uWxGrime, 0)
    b.add(uWxAlgae, 0)
    b.add(uWxSalt, 0)
  }
}
