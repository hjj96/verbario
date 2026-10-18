// MMeshLoader — baked `.mmesh` files → GPU meshes (PLAN §2.5, §6; format: tools/meshfmt/SPEC.md).
//
// The file's tightly packed per-attribute streams are interleaved into ONE vertex buffer bound at
// MD_BUF_VERTICES (the other slots stay reserved: instances, frame, look, lights, material, object, pass),
// each element 4-byte aligned in the vertex (Metal's attribute rule), formats as stored (f32 → floatN,
// f16 → halfN, snorm16 → shortNNormalized, unorm8 → ucharNNormalized: the GPU decodes them like
// MMeshFile.floats does). Attribute names stay the web's names; a family maps the names it reads to its
// [[attribute(n)]] slots with `vertexDescriptor(_:)`, so one mesh serves the colour, depth and heat
// pipelines with different subsets. Indices are u32, ranges are named (`main`, `shadow`).
// Loading through DataCatalog checks bytes and sha256 against Resources/Data/manifest.json first.
import Foundation
import Metal
import MaydayCore
import MaydayShaderTypes

public final class MMesh {
  public struct Element: Equatable {
    public let name: String
    public let format: MMeshFile.Format
    public let components: Int
    public let offset: Int           // bytes inside one interleaved vertex

    /// The Metal vertex format reading this element.
    public var vertexFormat: MTLVertexFormat {
      switch (format, components) {
      case (.f32, 1): return .float
      case (.f32, 2): return .float2
      case (.f32, 3): return .float3
      case (.f32, _): return .float4
      case (.f16, 2): return .half2
      case (.f16, 3): return .half3
      case (.f16, _): return .half4
      case (.snorm16, 2): return .short2Normalized
      case (.snorm16, 3): return .short3Normalized
      case (.snorm16, _): return .short4Normalized
      case (.unorm8, 2): return .uchar2Normalized
      case (.unorm8, 3): return .uchar3Normalized
      case (.unorm8, _): return .uchar4Normalized
      }
    }
  }

  public let label: String
  public let info: MMeshInfo
  public var meta: MMeshMeta { info.meta }
  public let vertexBuffer: MTLBuffer
  public let vertexCount: Int
  public let stride: Int
  public let elements: [Element]
  public let indexBuffer: MTLBuffer?
  public let indexCount: Int
  public let ranges: [String: MeshRange]
  /// three geometry.boundingSphere (object space) — DrawItem culling input.
  public var boundsCenter: SIMD3<Double> { info.boundsCenter }
  public var boundsRadius: Double { info.boundsRadius }

  public init(device: MTLDevice, file: MMeshFile, label: String) throws {
    info = try MMeshInfo(file: file)
    var elems: [Element] = []
    var off = 0
    for a in file.attributes {
      elems.append(Element(name: a.name, format: a.format, components: a.components, offset: off))
      off += (a.stride + 3) & ~3
    }
    let strideBytes = off
    let n = file.vertexCount
    var inter = [UInt8](repeating: 0, count: n * strideBytes)
    for (e, a) in zip(elems, file.attributes) {
      for v in 0..<n {
        let src = a.offset + v * a.stride
        let dst = v * strideBytes + e.offset
        for k in 0..<a.stride { inter[dst + k] = file.bytes[src + k] }
      }
    }
    guard let vb = inter.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let p = raw.baseAddress else { return nil }
      return device.makeBuffer(bytes: p, length: raw.count, options: [.storageModeShared])
    }) else { throw RenderError.resource("\(label) vertices") }
    vb.label = "\(label).vertices"
    var ib: MTLBuffer?
    if file.indexed {
      let start = file.indexOffset
      guard let b = file.bytes[start..<(start + file.indexCount * 4)].withUnsafeBytes({ raw -> MTLBuffer? in
        guard let p = raw.baseAddress else { return nil }
        return device.makeBuffer(bytes: p, length: raw.count, options: [.storageModeShared])
      }) else { throw RenderError.resource("\(label) indices") }
      b.label = "\(label).indices"
      ib = b
    }
    var rs: [String: MeshRange] = [:]
    for r in file.ranges { rs[r.name] = MeshRange(start: r.start, count: r.count) }

    self.label = label
    vertexBuffer = vb
    vertexCount = n
    stride = strideBytes
    elements = elems
    indexBuffer = ib
    indexCount = file.indexCount
    ranges = rs
  }

  public func element(_ name: String) -> Element? { elements.first { $0.name == name } }
  public var main: MeshRange { ranges["main"] ?? MeshRange(start: 0, count: indexBuffer == nil ? vertexCount : indexCount) }

  /// MTLVertexDescriptor reading `map` (web attribute name → [[attribute(n)]]) from buffer MD_BUF_VERTICES.
  /// Every mapped attribute must exist: a shader input without data would read garbage.
  public func vertexDescriptor(_ map: [String: Int]) throws -> MTLVertexDescriptor {
    let d = MTLVertexDescriptor()
    for (name, slot) in map.sorted(by: { $0.value < $1.value }) {
      guard let e = element(name) else { throw RenderError.resource("\(label): no attribute \(name)") }
      let a = d.attributes[slot]!
      a.format = e.vertexFormat
      a.offset = e.offset
      a.bufferIndex = Int(MD_BUF_VERTICES)
    }
    let l = d.layouts[Int(MD_BUF_VERTICES)]!
    l.stride = stride
    l.stepFunction = .perVertex
    l.stepRate = 1
    return d
  }

  /// PipelineCache key part for `vertexDescriptor(map)`.
  public func layoutKey(_ map: [String: Int]) -> String {
    map.sorted(by: { $0.value < $1.value }).map { name, slot in
      let e = element(name)
      return "\(slot)=\(e.map { "\($0.vertexFormat.rawValue)@\($0.offset)" } ?? "-")"
    }.joined(separator: ",") + "/\(stride)"
  }

  /// Binds the vertex stream and draws the named range as triangles.
  public func draw(_ enc: MTLRenderCommandEncoder, range name: String = "main", instanceCount: Int = 1) {
    let r = ranges[name] ?? main
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

public enum MMeshLoader {
  /// Manifest path of a baked mesh: "Resources/Meshes/<name>.mmesh".
  public static func manifestPath(_ name: String) -> String { "Resources/Meshes/\(name).mmesh" }

  /// Loads `<name>.mmesh` through the catalog (size + sha256 checked against the manifest).
  public static func load(device: MTLDevice, catalog: DataCatalog, name: String) throws -> MMesh {
    let bytes = try catalog.bytes(path: manifestPath(name), verify: true)
    return try load(device: device, bytes: bytes, name: name)
  }

  /// Loads a file directly (tools, previews): no manifest check.
  public static func load(device: MTLDevice, url: URL) throws -> MMesh {
    let data = try Data(contentsOf: url)
    return try load(device: device, bytes: [UInt8](data), name: url.deletingPathExtension().lastPathComponent)
  }

  static func load(device: MTLDevice, bytes: [UInt8], name: String) throws -> MMesh {
    let file: MMeshFile
    do { file = try MMeshFile(bytes: bytes) } catch { throw RenderError.resource("\(name).mmesh: \(error)") }
    let mesh = try MMesh(device: device, file: file, label: name)
    guard mesh.meta.name == name else { throw RenderError.resource("\(name).mmesh: meta names \(mesh.meta.name)") }
    return mesh
  }
}
