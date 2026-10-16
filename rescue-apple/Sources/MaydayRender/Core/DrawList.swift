// DrawList — scene items and three r185 WebGLRenderList ordering (PLAN §2.5 «Представление сцены»).
//
// A system (props, heli, survivors, FX …) adds one DrawItem per visible mesh each frame; RenderList
// does what three's projectObject() + WebGLRenderList.sort() do, in the same order and with the same
// keys, so overlapping transparent layers composite exactly like the web:
//   * layer test against the camera mask (three Layers.test), then `frustumCulled == false ||
//     frustum.intersectsSphere(world bounding sphere)` (three Frustum, WebGL clip planes);
//   * z = GL clip-space z of the sphere centre (three `_vector4.applyMatrix4(projScreenMatrix).z`,
//     NOT divided by w), computed in Double like the JS;
//   * opaque:      groupOrder, renderOrder, material.id, materialVariant, z ↑, id   (three painterSortStable)
//   * transparent: groupOrder, renderOrder, z ↓, id                               (reversePainterSortStable)
// `id` is unique per item, so every comparison is total and Swift's unstable sort gives three's order.
// The GPU side of an item (pipeline, buffers, uniforms) stays with its family: `handle` indexes the
// family's own command table.
import Foundation
import simd

/// three Object3D.layers bits used by the game (PLAN §2.5 «Слои»).
public struct RenderLayers: OptionSet, Hashable {
  public let rawValue: UInt32
  public init(rawValue: UInt32) { self.rawValue = rawValue }
  /// 0 — main camera.
  public static let main = RenderLayers(rawValue: 1 << 0)
  /// 1 — shadow pass only (strobe-blade stand-ins).
  public static let shadowOnly = RenderLayers(rawValue: 1 << 1)
  /// 2 — thermal heat proxies (invisible in main and shadow passes).
  public static let heat = RenderLayers(rawValue: 1 << 2)
  /// 3 — thermal mass.
  public static let thermalMass = RenderLayers(rawValue: 1 << 3)
}

/// Blend state of a material (PLAN §2.5 pass 4): multiply = dst·src.rgb with premultiplied alpha.
public enum BlendMode: UInt8 {
  case opaque, alpha, premultipliedAlpha, additive, multiply
}

/// three material.side → cull mode (CCW = front): FrontSide → back, BackSide → front, DoubleSide → none.
public enum FaceCulling: UInt8 {
  case back, front, none
}

public struct DrawItem {
  /// three Object3D.id — unique, the last sort key.
  public var id: Int
  /// three material.id — identity of the material instance (groups draws that share a PSO + uniforms).
  public var materialID: Int
  public var materialVariant: Int = 0
  public var groupOrder: Int = 0
  public var renderOrder: Int = 0
  public var transparent = false
  public var blend: BlendMode = .opaque
  public var depthTest = true
  public var depthWrite = true
  public var culling: FaceCulling = .back
  public var layers: RenderLayers = .main
  public var castShadow = false
  public var receiveShadow = false
  public var frustumCulled = true
  /// Thermal pass inputs (PLAN §2.5: carried by every item from day one).
  public var heat: Float = 0
  public var thermMass: Float = 0
  /// World-space bounding sphere: geometry.boundingSphere centre × matrixWorld, radius × max axis scale.
  public var center = SIMD3<Double>(0, 0, 0)
  public var radius: Double = 0
  /// Opaque handle of the owning family (index into its command table).
  public var handle: Int = 0
  /// GL clip-space z of `center`, written by RenderList.add (three `renderItem.z`).
  public internal(set) var z: Double = 0

  public init(id: Int, materialID: Int, center: SIMD3<Double> = SIMD3<Double>(0, 0, 0), radius: Double = 0) {
    self.id = id
    self.materialID = materialID
    self.center = center
    self.radius = radius
  }
}

/// three Frustum.setFromProjectionMatrix(m, WebGLCoordinateSystem) + intersectsSphere, in Double.
/// planes: xyz = unit normal pointing inside, w = constant (distance = n·p + w).
public struct Frustum {
  public private(set) var planes: [SIMD4<Double>]

  /// viewProjGL: camera.projectionMatrix × camera.matrixWorldInverse (GL clip, z ∈ [−1, 1]).
  public init(viewProjGL m: simd_double4x4) {
    let c0 = m.columns.0, c1 = m.columns.1, c2 = m.columns.2, c3 = m.columns.3
    // me[i] = column (i / 4), row (i % 4): row r of the matrix is (c0[r], c1[r], c2[r], c3[r])
    func plane(_ x: Double, _ y: Double, _ z: Double, _ w: Double) -> SIMD4<Double> {
      let inv = 1.0 / (x * x + y * y + z * z).squareRoot()     // three Plane.normalize()
      return SIMD4<Double>(x * inv, y * inv, z * inv, w * inv)
    }
    planes = [
      plane(c0.w - c0.x, c1.w - c1.x, c2.w - c2.x, c3.w - c3.x),   // right
      plane(c0.w + c0.x, c1.w + c1.x, c2.w + c2.x, c3.w + c3.x),   // left
      plane(c0.w + c0.y, c1.w + c1.y, c2.w + c2.y, c3.w + c3.y),   // bottom
      plane(c0.w - c0.y, c1.w - c1.y, c2.w - c2.y, c3.w - c3.y),   // top
      plane(c0.w - c0.z, c1.w - c1.z, c2.w - c2.z, c3.w - c3.z),   // far
      plane(c0.w + c0.z, c1.w + c1.z, c2.w + c2.z, c3.w + c3.z),   // near (WebGL clip z ≥ −w)
    ]
  }

  /// three Frustum.intersectsSphere: outside when any plane distance < −radius.
  public func intersects(center p: SIMD3<Double>, radius: Double) -> Bool {
    let negRadius = -radius
    for n in planes {
      let distance = n.x * p.x + n.y * p.y + n.z * p.z + n.w
      if distance < negRadius { return false }
    }
    return true
  }
}

public final class RenderList {
  public private(set) var opaque: [DrawItem] = []
  public private(set) var transparent: [DrawItem] = []

  public init() {}

  /// three renderList.init(): keeps the capacity for the next frame.
  public func reset() {
    opaque.removeAll(keepingCapacity: true)
    transparent.removeAll(keepingCapacity: true)
  }

  /// three projectObject() for one mesh: returns false when the item was rejected (layers / frustum).
  @discardableResult
  public func add(_ item: DrawItem, viewProjGL m: simd_double4x4, frustum: Frustum,
                  cameraLayers: RenderLayers = .main) -> Bool {
    if item.layers.intersection(cameraLayers).isEmpty { return false }
    if item.frustumCulled && !frustum.intersects(center: item.center, radius: item.radius) { return false }
    var it = item
    // Vector4(center, 1).applyMatrix4(projScreenMatrix).z — written out (three's operation order)
    let p = item.center
    it.z = m.columns.0.z * p.x + m.columns.1.z * p.y + m.columns.2.z * p.z + m.columns.3.z
    if it.transparent { transparent.append(it) } else { opaque.append(it) }
    return true
  }

  /// three renderList.sort(customOpaqueSort = null, customTransparentSort = null).
  public func sort() {
    if opaque.count > 1 { opaque.sort(by: RenderList.opaqueOrder) }
    if transparent.count > 1 { transparent.sort(by: RenderList.transparentOrder) }
  }

  /// three painterSortStable(a, b) < 0.
  public static func opaqueOrder(_ a: DrawItem, _ b: DrawItem) -> Bool {
    if a.groupOrder != b.groupOrder { return a.groupOrder < b.groupOrder }
    if a.renderOrder != b.renderOrder { return a.renderOrder < b.renderOrder }
    if a.materialID != b.materialID { return a.materialID < b.materialID }
    if a.materialVariant != b.materialVariant { return a.materialVariant < b.materialVariant }
    if a.z != b.z { return a.z < b.z }
    return a.id < b.id
  }

  /// three reversePainterSortStable(a, b) < 0.
  public static func transparentOrder(_ a: DrawItem, _ b: DrawItem) -> Bool {
    if a.groupOrder != b.groupOrder { return a.groupOrder < b.groupOrder }
    if a.renderOrder != b.renderOrder { return a.renderOrder < b.renderOrder }
    if a.z != b.z { return a.z > b.z }
    return a.id < b.id
  }
}
