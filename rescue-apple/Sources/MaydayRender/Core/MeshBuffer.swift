// MeshBuffer — one static GPU mesh (PLAN §2.5, §3.4): every vertex attribute interleaved into ONE
// buffer bound at MD_BUF_VERTICES (the other buffer slots are reserved: instances, frame, look, lights,
// material, object, pass), uint32 indices, and named index ranges:
//   main    — what the colour passes draw;
//   shadow  — what the shadow pass draws (terrain LOD, shadow-only stand-ins); nil = same as main.
// Sources: runtime-procedural geometry from MaydayCore (MeshKit, terrain, primitives) and, later, the
// baked .mmesh files (MMeshLoader fills the same streams). The bounding sphere is three's
// BufferGeometry.computeBoundingSphere() (box centre, max distance), the input of DrawItem culling.
import Foundation
import Metal
import MaydayShaderTypes

/// Attribute slots ([[attribute(n)]] in the shaders, ShaderTypes.h MD_ATTR_*).
public enum VertexAttribute: Int, CaseIterable {
  case position, normal, uv, color, surf, uv2

  public var index: Int {
    switch self {
    case .position: return Int(MD_ATTR_POSITION)
    case .normal: return Int(MD_ATTR_NORMAL)
    case .uv: return Int(MD_ATTR_UV)
    case .color: return Int(MD_ATTR_COLOR)
    case .surf: return Int(MD_ATTR_SURF)
    case .uv2: return Int(MD_ATTR_UV2)
    }
  }
}

/// One non-interleaved CPU stream (three BufferAttribute with itemSize = components, Float32).
public struct VertexStream {
  public var attribute: VertexAttribute
  public var components: Int
  public var data: [Float]

  public init(_ attribute: VertexAttribute, components: Int, data: [Float]) {
    self.attribute = attribute
    self.components = components
    self.data = data
  }
}

public struct MeshRange: Equatable {
  public var start: Int     // first index (indexed) or vertex (non-indexed)
  public var count: Int

  public init(start: Int, count: Int) {
    self.start = start
    self.count = count
  }
}

public final class MeshBuffer {
  public struct Element {
    public let attribute: VertexAttribute
    public let components: Int
    public let offset: Int    // bytes inside one vertex
  }

  public let label: String
  public let vertexBuffer: MTLBuffer
  public let vertexCount: Int
  public let stride: Int
  public let elements: [Element]
  public let indexBuffer: MTLBuffer?
  public let indexCount: Int
  public let main: MeshRange
  public let shadow: MeshRange?
  public let boundsCenter: SIMD3<Double>
  public let boundsRadius: Double

  /// streams: must contain .position (3 components); all streams describe the same vertex count.
  public init(device: MTLDevice, label: String, streams: [VertexStream], indices: [UInt32]? = nil,
              main mainRange: MeshRange? = nil, shadow shadowRange: MeshRange? = nil) throws {
    guard let pos = streams.first(where: { $0.attribute == .position }), pos.components == 3 else {
      throw RenderError.resource("\(label): no float3 position stream")
    }
    let n = pos.data.count / 3
    guard n > 0 else { throw RenderError.resource("\(label): empty mesh") }
    var elems: [Element] = []
    var offset = 0
    for s in streams.sorted(by: { $0.attribute.index < $1.attribute.index }) {
      guard (1...4).contains(s.components), s.data.count == n * s.components else {
        throw RenderError.resource("\(label): stream \(s.attribute) has \(s.data.count) floats for \(n) vertices")
      }
      if elems.contains(where: { $0.attribute == s.attribute }) {
        throw RenderError.resource("\(label): duplicate stream \(s.attribute)")
      }
      elems.append(Element(attribute: s.attribute, components: s.components, offset: offset))
      offset += 4 * s.components
    }
    let strideBytes = offset
    // interleave
    let floatsPerVertex = strideBytes / 4
    var interleaved = [Float](repeating: 0, count: n * floatsPerVertex)
    let ordered = streams.sorted(by: { $0.attribute.index < $1.attribute.index })
    for (e, s) in zip(elems, ordered) {
      let base = e.offset / 4
      for v in 0..<n {
        let dst = v * floatsPerVertex + base
        let src = v * e.components
        for c in 0..<e.components { interleaved[dst + c] = s.data[src + c] }
      }
    }
    guard let vb = interleaved.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let p = raw.baseAddress else { return nil }
      return device.makeBuffer(bytes: p, length: raw.count, options: [.storageModeShared])
    }) else { throw RenderError.resource("\(label) vertices") }
    vb.label = "\(label).vertices"

    var ib: MTLBuffer?
    var count = n
    if let idx = indices {
      if let bad = idx.first(where: { Int($0) >= n }) {
        throw RenderError.resource("\(label): index \(bad) ≥ vertex count \(n)")
      }
      guard !idx.isEmpty, let b = idx.withUnsafeBytes({ raw -> MTLBuffer? in
        guard let p = raw.baseAddress else { return nil }
        return device.makeBuffer(bytes: p, length: raw.count, options: [.storageModeShared])
      }) else { throw RenderError.resource("\(label) indices") }
      b.label = "\(label).indices"
      ib = b
      count = idx.count
    }
    let full = MeshRange(start: 0, count: count)
    for r in [mainRange, shadowRange].compactMap({ $0 }) where r.start < 0 || r.count < 0 || r.start + r.count > count {
      throw RenderError.resource("\(label): range \(r.start)+\(r.count) outside 0..<\(count)")
    }

    // three BufferGeometry.computeBoundingSphere(): centre of the bounding box, max distance to it
    var lo = SIMD3<Double>(repeating: .infinity)
    var hi = SIMD3<Double>(repeating: -.infinity)
    for v in 0..<n {
      let x = Double(pos.data[v * 3]), y = Double(pos.data[v * 3 + 1]), z = Double(pos.data[v * 3 + 2])
      lo = SIMD3<Double>(min(lo.x, x), min(lo.y, y), min(lo.z, z))
      hi = SIMD3<Double>(max(hi.x, x), max(hi.y, y), max(hi.z, z))
    }
    let c = SIMD3<Double>((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, (lo.z + hi.z) * 0.5)
    var maxSq = 0.0
    for v in 0..<n {
      let dx = c.x - Double(pos.data[v * 3])
      let dy = c.y - Double(pos.data[v * 3 + 1])
      let dz = c.z - Double(pos.data[v * 3 + 2])
      maxSq = max(maxSq, dx * dx + dy * dy + dz * dz)
    }
    guard maxSq.isFinite else { throw RenderError.resource("\(label): NaN in positions") }

    self.label = label
    vertexBuffer = vb
    vertexCount = n
    stride = strideBytes
    elements = elems
    indexBuffer = ib
    indexCount = ib == nil ? 0 : count
    main = mainRange ?? full
    shadow = shadowRange
    boundsCenter = c
    boundsRadius = maxSq.squareRoot()
  }

  public func has(_ a: VertexAttribute) -> Bool { elements.contains { $0.attribute == a } }

  /// MTLVertexDescriptor for this layout (buffer MD_BUF_VERTICES, per vertex). Pipelines whose shader
  /// reads fewer attributes may still use it: unused descriptor entries are ignored by Metal.
  public func vertexDescriptor() -> MTLVertexDescriptor {
    let d = MTLVertexDescriptor()
    for e in elements {
      let a = d.attributes[e.attribute.index]!
      switch e.components {
      case 1: a.format = .float
      case 2: a.format = .float2
      case 3: a.format = .float3
      default: a.format = .float4
      }
      a.offset = e.offset
      a.bufferIndex = Int(MD_BUF_VERTICES)
    }
    let l = d.layouts[Int(MD_BUF_VERTICES)]!
    l.stride = stride
    l.stepFunction = .perVertex
    l.stepRate = 1
    return d
  }

  /// Binds the vertex stream and draws `range` (default: main) as triangles.
  public func draw(_ enc: MTLRenderCommandEncoder, range: MeshRange? = nil, instanceCount: Int = 1) {
    let r = range ?? main
    if r.count <= 0 || instanceCount <= 0 { return }
    enc.setVertexBuffer(vertexBuffer, offset: 0, index: Int(MD_BUF_VERTICES))
    if let ib = indexBuffer {
      enc.drawIndexedPrimitives(type: .triangle, indexCount: r.count, indexType: .uint32, indexBuffer: ib,
                                indexBufferOffset: r.start * MemoryLayout<UInt32>.stride, instanceCount: instanceCount)
    } else {
      enc.drawPrimitives(type: .triangle, vertexStart: r.start, vertexCount: r.count, instanceCount: instanceCount)
    }
  }
}
