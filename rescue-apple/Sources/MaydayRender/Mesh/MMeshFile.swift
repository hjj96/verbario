// MMeshFile — parser for baked `.mmesh` v1 files (tools/meshfmt/SPEC.md; written by
// tools/export/bake-meshes.mjs from the live web geometry, PLAN D6 / §6).
//
// Pure Foundation (no Metal, no MaydayCore): tools/meshfmt/check-loader.sh compiles this file alone on
// Linux and compares every parsed field with the JS decoder (tools/meshfmt/read.mjs). MMeshLoader turns a
// parsed file into GPU buffers; MMeshMeta decodes the JSON block.
//
// Validation follows read.mjs rule for rule: a file that the JS verifier rejects is rejected here too.
import Foundation

public struct MMeshError: Error, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { "MMeshError: " + message }
}

public struct MMeshFile {
  public static let magic: [UInt8] = Array("MMSH".utf8)
  public static let version: UInt16 = 1
  public static let headerBytes = 80
  public static let attributeBytes = 32
  public static let rangeBytes = 24
  public static let nameBytes = 16

  /// Element formats (SPEC «Attribute table»).
  public enum Format: UInt8 {
    case f32 = 1, f16 = 2, snorm16 = 3, unorm8 = 4

    /// Bytes per component.
    public var size: Int {
      switch self {
      case .f32: return 4
      case .f16, .snorm16: return 2
      case .unorm8: return 1
      }
    }
  }

  public struct Attribute: Equatable {
    public let name: String            // three attribute name (position, normal, aSurf …)
    public let format: Format
    public let components: Int         // three itemSize, 1 … 4
    public let offset: Int             // stream start in the file
    public let stride: Int             // components × format.size (streams are tightly packed)
    public let byteLength: Int         // vertexCount × stride
  }

  public struct Range: Equatable {
    public let name: String            // "main", "shadow"
    public let start: Int              // first index (indexed) or vertex
    public let count: Int
  }

  public let vertexCount: Int
  public let indexCount: Int
  public let indexed: Bool
  public let attributes: [Attribute]
  public let ranges: [Range]
  /// three geometry.boundingSphere (centre, radius) and boundingBox, as float32.
  public let sphereCenter: SIMD3<Float>
  public let sphereRadius: Float
  public let boxMin: SIMD3<Float>
  public let boxMax: SIMD3<Float>
  /// The UTF-8 JSON block (SPEC «Meta JSON»), unparsed.
  public let metaJSON: Data
  public let indexOffset: Int
  /// The whole file (streams are read from it by offset).
  public let bytes: [UInt8]

  public init(data: Data) throws {
    try self.init(bytes: [UInt8](data))
  }

  public init(bytes b: [UInt8]) throws {
    func fail(_ m: String) -> MMeshError { MMeshError(m) }
    func u16(_ o: Int) -> Int { Int(b[o]) | Int(b[o + 1]) << 8 }
    func u32(_ o: Int) -> Int { Int(b[o]) | Int(b[o + 1]) << 8 | Int(b[o + 2]) << 16 | Int(b[o + 3]) << 24 }
    func f32(_ o: Int) -> Float { Float(bitPattern: UInt32(u32(o))) }
    func zeros(_ from: Int, _ to: Int) -> Bool {
      var i = from
      while i < to { if b[i] != 0 { return false }; i += 1 }
      return true
    }
    func name(_ o: Int, _ what: String) throws -> String {
      let raw = b[o..<(o + MMeshFile.nameBytes)]
      guard let end = raw.firstIndex(of: 0), end > o else { throw fail("\(what): bad name") }
      let chars = b[o..<end]
      guard chars.allSatisfy({ $0 >= 0x21 && $0 <= 0x7e }), zeros(end, o + MMeshFile.nameBytes) else {
        throw fail("\(what): bad name")
      }
      return String(decoding: chars, as: UTF8.self)
    }

    guard b.count >= MMeshFile.headerBytes else { throw fail("file is \(b.count) bytes (< header)") }
    guard Array(b[0..<4]) == MMeshFile.magic else { throw fail("bad magic") }
    let version = u16(4)
    guard version == Int(MMeshFile.version) else { throw fail("version \(version) (this reader knows \(MMeshFile.version))") }
    let flags = u16(6)
    guard flags & ~1 == 0 else { throw fail("unknown flags \(flags)") }
    let indexed = flags & 1 == 1
    let vertexCount = u32(8)
    let indexCount = u32(12)
    let attrCount = u16(16)
    let rangeCount = u16(18)
    let metaLength = u32(20)
    let dataOffset = u32(24)
    let fileLength = u32(28)
    let bf = (0..<10).map { f32(32 + $0 * 4) }
    let indexOffset = u32(72)
    guard u32(76) == 0 else { throw fail("reserved header word is not 0") }
    guard fileLength == b.count else { throw fail("fileLength \(fileLength) != \(b.count) bytes") }
    guard fileLength % 16 == 0 else { throw fail("fileLength is not a multiple of 16") }
    guard vertexCount > 0 else { throw fail("vertexCount is 0") }
    guard (1...16).contains(attrCount) else { throw fail("attrCount \(attrCount)") }
    guard rangeCount >= 1 else { throw fail("no ranges") }
    if !indexed && (indexCount != 0 || indexOffset != 0) { throw fail("index fields set on a non-indexed mesh") }
    if indexed && indexCount % 3 != 0 { throw fail("indexCount \(indexCount) is not a multiple of 3") }
    guard bf.allSatisfy({ $0.isFinite }) else { throw fail("bounds are not finite") }
    guard dataOffset % 16 == 0 else { throw fail("dataOffset is not 16-aligned") }
    let tables = MMeshFile.headerBytes + MMeshFile.attributeBytes * attrCount + MMeshFile.rangeBytes * rangeCount
    guard tables + metaLength <= dataOffset, dataOffset <= b.count else { throw fail("tables + meta overlap the data") }
    guard zeros(tables + metaLength, dataOffset) else { throw fail("non-zero padding before the data") }

    var attrs: [Attribute] = []
    var t = MMeshFile.headerBytes
    var end = dataOffset
    for a in 0..<attrCount {
      let n = try name(t, "attribute \(a)")
      guard !attrs.contains(where: { $0.name == n }) else { throw fail("duplicate attribute \(n)") }
      guard let format = Format(rawValue: b[t + 16]) else { throw fail("\(n): unknown format \(b[t + 16])") }
      let components = Int(b[t + 17])
      let offset = u32(t + 20), stride = u32(t + 24), byteLength = u32(t + 28)
      guard (1...4).contains(components) else { throw fail("\(n): components \(components)") }
      guard format == .f32 || components >= 2 else { throw fail("\(n): \(format) with 1 component") }
      guard u16(t + 18) == 0 else { throw fail("\(n): reserved field is not 0") }
      guard stride == components * format.size else { throw fail("\(n): stride \(stride)") }
      guard byteLength == vertexCount * stride else { throw fail("\(n): byteLength \(byteLength)") }
      guard offset % 16 == 0 else { throw fail("\(n): offset not 16-aligned") }
      guard offset >= end else { throw fail("\(n): stream overlaps the previous part") }
      guard offset + byteLength <= b.count else { throw fail("\(n): stream runs past the end") }
      guard zeros(end, offset) else { throw fail("\(n): non-zero padding") }
      end = offset + byteLength
      attrs.append(Attribute(name: n, format: format, components: components, offset: offset, stride: stride, byteLength: byteLength))
      t += MMeshFile.attributeBytes
    }
    guard let pos = attrs.first(where: { $0.name == "position" }), pos.format == .f32, pos.components == 3 else {
      throw fail("position must be f32 × 3")
    }

    var rngs: [Range] = []
    let total = indexed ? indexCount : vertexCount
    for r in 0..<rangeCount {
      let n = try name(t, "range \(r)")
      let start = u32(t + 16), count = u32(t + 20)
      guard start + count <= total, count % 3 == 0, start % 3 == 0 else { throw fail("range \(n) \(start)+\(count) outside 0..\(total)") }
      guard !rngs.contains(where: { $0.name == n }) else { throw fail("duplicate range names") }
      rngs.append(Range(name: n, start: start, count: count))
      t += MMeshFile.rangeBytes
    }
    guard rngs[0].name == "main" else { throw fail("first range is not \"main\"") }
    let meta = Data(b[tables..<(tables + metaLength)])
    guard (try? JSONSerialization.jsonObject(with: meta)) != nil else { throw fail("meta JSON does not parse") }

    if indexed {
      guard indexOffset % 16 == 0 else { throw fail("indexOffset not 16-aligned") }
      guard indexOffset >= end else { throw fail("index stream overlaps an attribute stream") }
      guard zeros(end, indexOffset) else { throw fail("non-zero padding before the index") }
      guard indexOffset + indexCount * 4 <= b.count else { throw fail("index stream runs past the end") }
      var o = indexOffset
      for _ in 0..<indexCount {
        guard u32(o) < vertexCount else { throw fail("index \(u32(o)) ≥ vertexCount \(vertexCount)") }
        o += 4
      }
      end = indexOffset + indexCount * 4
    }
    guard zeros(end, b.count) else { throw fail("non-zero trailing padding") }
    guard b.count == (end + 15) & ~15 else { throw fail("trailing bytes after the last stream") }

    self.vertexCount = vertexCount
    self.indexCount = indexCount
    self.indexed = indexed
    attributes = attrs
    ranges = rngs
    sphereCenter = SIMD3<Float>(bf[0], bf[1], bf[2])
    sphereRadius = bf[3]
    boxMin = SIMD3<Float>(bf[4], bf[5], bf[6])
    boxMax = SIMD3<Float>(bf[7], bf[8], bf[9])
    metaJSON = meta
    self.indexOffset = indexOffset
    bytes = b
  }

  public func attribute(_ name: String) -> Attribute? { attributes.first { $0.name == name } }
  public func range(_ name: String) -> Range? { ranges.first { $0.name == name } }

  /// The raw bytes of one stream (as stored: f32 / f16 / snorm16 / unorm8).
  public func raw(_ a: Attribute) -> ArraySlice<UInt8> { bytes[a.offset..<(a.offset + a.byteLength)] }

  /// One stream decoded to Float (Metal's normalisation rules: snorm16 → max(v / 32767, −1), unorm8 → v / 255).
  public func floats(_ a: Attribute) -> [Float] {
    let n = vertexCount * a.components
    var out = [Float](repeating: 0, count: n)
    let o = a.offset
    switch a.format {
    case .f32:
      for i in 0..<n {
        let k = o + i * 4
        out[i] = Float(bitPattern: UInt32(bytes[k]) | UInt32(bytes[k + 1]) << 8 | UInt32(bytes[k + 2]) << 16 | UInt32(bytes[k + 3]) << 24)
      }
    case .f16:
      for i in 0..<n { out[i] = MMeshFile.halfToFloat(UInt16(bytes[o + i * 2]) | UInt16(bytes[o + i * 2 + 1]) << 8) }
    case .snorm16:
      for i in 0..<n {
        let v = Int16(bitPattern: UInt16(bytes[o + i * 2]) | UInt16(bytes[o + i * 2 + 1]) << 8)
        out[i] = max(Float(v) / 32767, -1)
      }
    case .unorm8:
      for i in 0..<n { out[i] = Float(bytes[o + i]) / 255 }
    }
    return out
  }

  public func floats(_ name: String) -> [Float]? { attribute(name).map { floats($0) } }

  /// The u32 index stream (empty when not indexed).
  public func indices() -> [UInt32] {
    guard indexed else { return [] }
    var out = [UInt32](repeating: 0, count: indexCount)
    for i in 0..<indexCount {
      let k = indexOffset + i * 4
      out[i] = UInt32(bytes[k]) | UInt32(bytes[k + 1]) << 8 | UInt32(bytes[k + 2]) << 16 | UInt32(bytes[k + 3]) << 24
    }
    return out
  }

  /// IEEE 754 binary16 → Float (no Float16: unavailable on some hosts of the Linux check).
  public static func halfToFloat(_ h: UInt16) -> Float {
    let sign: Float = h & 0x8000 != 0 ? -1 : 1
    let e = Int((h >> 10) & 0x1f)
    let m = Float(h & 0x3ff)
    if e == 0 { return sign * m * 0x1p-24 }
    if e == 0x1f { return m != 0 ? .nan : sign * .infinity }
    return sign * (1 + m / 1024) * Float(sign: .plus, exponent: e - 15, significand: 1)
  }
}
