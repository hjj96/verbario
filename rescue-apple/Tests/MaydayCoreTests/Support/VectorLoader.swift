// Finds and reads the parity vectors exported from the web game (rescue-apple/Tests/Vectors) and the
// exported data (rescue-apple/Resources). Located through #filePath, so no SwiftPM resources are
// needed: works the same with `swift test` on Linux/macOS and in Xcode.
import Foundation
import XCTest
@testable import MaydayCore

struct VectorFile {
  let name: String // "ocean/wavebank_calm"
  let url: URL
  let root: JSONValue

  var data: JSONValue { root["data"] }
  var schema: String { root["schema"].string ?? "" }
  var tolerance: JSONValue { root["tolerance"] }
  var directory: URL { url.deletingLastPathComponent() }

  /// Raw bytes of a sidecar referenced as {file, dtype, shape, sha256}; checks size and sha256.
  func sidecarBytes(_ ref: JSONValue) throws -> [UInt8] {
    guard let file = ref["file"].string else { throw VectorError("\(name): sidecar reference without 'file'") }
    let u = directory.appendingPathComponent(file)
    let bytes = [UInt8](try Data(contentsOf: u))
    if let sha = ref["sha256"].string {
      let got = SHA256.hex(bytes)
      if got != sha.lowercased() { throw VectorError("\(file): sha256 \(got) != \(sha)") }
    }
    if let shape = ref["shape"].doubles {
      let n = shape.reduce(1.0, *)
      let size: Double
      switch ref["dtype"].string ?? "" {
      case "f64": size = 8
      case "f32", "i32", "u32": size = 4
      case "u8": size = 1
      default: size = 0
      }
      if size > 0 && Double(bytes.count) != n * size {
        throw VectorError("\(file): \(bytes.count) bytes, shape \(shape) × \(Int(size))")
      }
    }
    return bytes
  }

  /// Float64 little-endian sidecar.
  func sidecarF64(_ ref: JSONValue) throws -> [Double] {
    guard ref["dtype"].string == "f64" else { throw VectorError("\(name): sidecar dtype \(ref["dtype"].string ?? "?"), expected f64") }
    let b = try sidecarBytes(ref)
    var out = [Double](repeating: 0, count: b.count / 8)
    for i in 0..<out.count {
      var u: UInt64 = 0
      for k in 0..<8 { u |= UInt64(b[i * 8 + k]) << UInt64(8 * k) }
      out[i] = Double(bitPattern: u)
    }
    return out
  }

  /// Float32 little-endian sidecar.
  func sidecarF32(_ ref: JSONValue) throws -> [Float] {
    guard ref["dtype"].string == "f32" else { throw VectorError("\(name): sidecar dtype \(ref["dtype"].string ?? "?"), expected f32") }
    let b = try sidecarBytes(ref)
    var out = [Float](repeating: 0, count: b.count / 4)
    for i in 0..<out.count {
      var u: UInt32 = 0
      for k in 0..<4 { u |= UInt32(b[i * 4 + k]) << UInt32(8 * k) }
      out[i] = Float(bitPattern: u)
    }
    return out
  }

  /// UInt8 sidecar.
  func sidecarU8(_ ref: JSONValue) throws -> [UInt8] {
    guard ref["dtype"].string == "u8" else { throw VectorError("\(name): sidecar dtype \(ref["dtype"].string ?? "?"), expected u8") }
    return try sidecarBytes(ref)
  }
}

struct VectorError: Error, CustomStringConvertible {
  let description: String
  init(_ d: String) { description = d }
}

enum VectorLoader {
  /// rescue-apple/
  static let appleRoot: URL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // Support
    .deletingLastPathComponent() // MaydayCoreTests
    .deletingLastPathComponent() // Tests
    .deletingLastPathComponent() // rescue-apple

  /// rescue-apple/Tests/Vectors
  static let vectorsRoot: URL = appleRoot.appendingPathComponent("Tests").appendingPathComponent("Vectors")

  static func url(_ name: String) -> URL { vectorsRoot.appendingPathComponent(name + ".json") }

  static func exists(_ name: String) -> Bool { FileManager.default.fileExists(atPath: url(name).path) }

  private static var cache: [String: VectorFile] = [:]
  private static let lock = NSLock()

  /// Loads "domain/name" (without .json). Skips the test when the exporter has not produced it yet.
  static func load(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> VectorFile {
    lock.lock()
    if let v = cache[name] {
      lock.unlock()
      return v
    }
    lock.unlock()
    let u = url(name)
    guard FileManager.default.fileExists(atPath: u.path) else {
      throw XCTSkip("vector file Tests/Vectors/\(name).json not exported yet (tools/export/run-all.mjs)", file: file, line: line)
    }
    let root = try JSONValue.load(contentsOf: u)
    let v = VectorFile(name: name, url: u, root: root)
    if v.schema != "mayday.vectors." + name.replacingOccurrences(of: "/", with: ".") {
      throw VectorError("\(name): unexpected schema \(v.schema)")
    }
    lock.lock()
    cache[name] = v
    lock.unlock()
    return v
  }

  /// The exported data catalog (rescue-apple/Resources/Data/manifest.json).
  static func catalog() throws -> DataCatalog {
    let manifest = appleRoot.appendingPathComponent(DataCatalog.manifestPath)
    guard FileManager.default.fileExists(atPath: manifest.path) else {
      throw XCTSkip("Resources/Data/manifest.json not exported yet")
    }
    return try DataCatalog(root: appleRoot)
  }
}
