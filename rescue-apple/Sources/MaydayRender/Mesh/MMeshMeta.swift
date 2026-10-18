// MMeshMeta — the JSON block of a baked mesh (tools/meshfmt/SPEC.md «Meta JSON»), read with MaydayCore's
// exact JSON reader so the transforms are the web's doubles. Everything here was taken from the live web
// objects by tools/export/bake-meshes.mjs: the local transform chain of every object that draws the
// geometry, three's render flags, the material parameters (and the uniforms the material owns) and the
// thermal-view flags (systems/post/thermal.js). Renderers read these instead of hand constants.
import Foundation
import MaydayCore

/// One node of a transform chain: a three Object3D's local position / quaternion / scale at construction.
public struct MMeshNode: Equatable {
  /// What the node is for the renderer (`root`, `body`, `rotorPivot`, `hub`, `crewArm` …); nil = static.
  public var role: String?
  public var name: String?
  public var position: V3
  public var quaternion: Quat
  public var scale: V3

  /// three Object3D.updateMatrix(): matrix.compose(position, quaternion, scale).
  public var matrix: Mat4 {
    var m = Mat4()
    m.compose(position, quaternion, scale)
    return m
  }
}

public struct MMeshMeta {
  public let json: JSONValue
  public let name: String
  /// One chain per web object drawn with this geometry, outermost node first.
  public let chains: [[MMeshNode]]
  public let renderOrder: Int
  /// three Layers.mask at construction (bit 0 main, 1 shadow-only, 2 heat, 3 thermal mass).
  public let layers: UInt32
  public let castShadow: Bool
  public let receiveShadow: Bool
  public let frustumCulled: Bool
  public let visible: Bool
  /// systems/post/thermal.js: heat (layer 2) or thermal mass (layer 3), nil = invisible to the FLIR.
  public let heat: Double?
  public let thermalMass: Double?

  public init(data: Data) throws {
    let j = try JSONValue.parse(data)
    json = j
    guard let name = j["name"].string else { throw MMeshError("meta: no name") }
    self.name = name
    func vec(_ v: JSONValue, _ n: Int, _ what: String) throws -> [Double] {
      guard let d = v.doubles, d.count == n else { throw MMeshError("meta \(name): \(what) is not \(n) numbers") }
      return d
    }
    var chains: [[MMeshNode]] = []
    for c in j["chains"].array ?? [] {
      var chain: [MMeshNode] = []
      for n in c.array ?? [] {
        let p = try vec(n["position"], 3, "position"), q = try vec(n["quaternion"], 4, "quaternion"), s = try vec(n["scale"], 3, "scale")
        chain.append(MMeshNode(role: n["role"].string, name: n["name"].string, position: V3(p[0], p[1], p[2]),
                               quaternion: Quat(q[0], q[1], q[2], q[3]), scale: V3(s[0], s[1], s[2])))
      }
      if chain.isEmpty { throw MMeshError("meta \(name): empty chain") }
      chains.append(chain)
    }
    if chains.isEmpty { throw MMeshError("meta \(name): no chains") }
    self.chains = chains
    let o = j["object"]
    renderOrder = o["renderOrder"].int ?? 0
    layers = UInt32(o["layers"].int ?? 1)
    castShadow = o["castShadow"].bool ?? false
    receiveShadow = o["receiveShadow"].bool ?? false
    frustumCulled = o["frustumCulled"].bool ?? true
    visible = o["visible"].bool ?? true
    heat = j["thermal"]["heat"].double
    thermalMass = j["thermal"]["mass"].double
  }

  // ---- material ---------------------------------------------------------------------------------------
  public var material: JSONValue { json["material"] }
  public var materialType: String { material["type"].string ?? "" }

  /// A material number (roughness, metalness, clearcoat, opacity …).
  public func materialNumber(_ key: String) -> Double? { material[key].double }

  /// A material colour (`color`, `emissive`): linear RGB as three stores it.
  public func materialColor(_ key: String) -> SIMD3<Float>? {
    guard let d = material[key].doubles, d.count == 3 else { return nil }
    return SIMD3<Float>(Float(d[0]), Float(d[1]), Float(d[2]))
  }

  /// A uniform the material owns: number.
  public func uniformNumber(_ key: String) -> Double? { material["uniforms"][key].double }

  /// A uniform the material owns: THREE.Color ({lin: [r, g, b]}) as linear RGB.
  public func uniformColor(_ key: String) -> SIMD3<Float>? {
    guard let d = material["uniforms"][key]["lin"].doubles, d.count == 3 else { return nil }
    return SIMD3<Float>(Float(d[0]), Float(d[1]), Float(d[2]))
  }

  /// A uniform the material owns: Vector2/3/4 (or a numeric array) as Floats.
  public func uniformVector(_ key: String) -> [Float]? {
    material["uniforms"][key].doubles.map { $0.map { Float($0) } }
  }

  /// Throwing accessors for the values a family cannot do without.
  public func requireNumber(_ key: String) throws -> Double {
    guard let v = uniformNumber(key) ?? materialNumber(key) else { throw MMeshError("meta \(name): material has no \(key)") }
    return v
  }

  public func requireColor(_ key: String) throws -> SIMD3<Float> {
    guard let v = uniformColor(key) ?? materialColor(key) else { throw MMeshError("meta \(name): material has no colour \(key)") }
    return v
  }

  public func requireVector(_ key: String, count: Int) throws -> [Float] {
    guard let v = uniformVector(key), v.count == count else { throw MMeshError("meta \(name): material has no vec\(count) \(key)") }
    return v
  }

  /// The chain node with this role in chain `i`.
  public func node(_ role: String, chain i: Int = 0) -> MMeshNode? {
    guard i < chains.count else { return nil }
    return chains[i].first { $0.role == role }
  }
}

/// What a planner needs of a baked mesh without its GPU buffers: the meta block and three's
/// geometry.boundingSphere (object space, culling and sort input).
public struct MMeshInfo {
  public let meta: MMeshMeta
  public let boundsCenter: SIMD3<Double>
  public let boundsRadius: Double
  public var name: String { meta.name }

  public init(meta: MMeshMeta, boundsCenter: SIMD3<Double>, boundsRadius: Double) {
    self.meta = meta
    self.boundsCenter = boundsCenter
    self.boundsRadius = boundsRadius
  }

  public init(file: MMeshFile) throws {
    meta = try MMeshMeta(data: file.metaJSON)
    boundsCenter = SIMD3<Double>(Double(file.sphereCenter.x), Double(file.sphereCenter.y), Double(file.sphereCenter.z))
    boundsRadius = Double(file.sphereRadius)
  }
}
