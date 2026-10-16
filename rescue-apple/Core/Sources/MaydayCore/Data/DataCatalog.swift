// Loader for the data exported from the web game (Resources/Data/*.json, Resources/Textures/*.rgba).
//
// Layout (PLAN §4.2/4.3): `<root>/Resources/Data/manifest.json` lists every exported file as
// {path (relative to <root>), schema, version, producer, bytes, sha256}. Every JSON file has the
// wrapper {schema, version, source, sourceDirty, sourceFiles, producer, …, data}.
//
// <root> is the rescue-apple checkout in tests/tools and the app bundle's resource directory in the
// apps (the Xcode project copies `Resources` as a folder reference).
import Foundation

public struct DataCatalogError: Error, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { "DataCatalogError: " + message }
}

public struct ManifestEntry: Equatable, Sendable {
  public let path: String
  public let schema: String
  public let version: Int
  public let producer: String
  public let bytes: Int
  public let sha256: String

  /// "Resources/Data/ocean.json" → "ocean"
  public var name: String {
    let file = path.split(separator: "/").last.map(String.init) ?? path
    if let dot = file.lastIndex(of: ".") { return String(file[..<dot]) }
    return file
  }
}

/// One exported JSON file with its wrapper fields.
public struct DataDocument {
  public let path: String
  public let root: JSONValue

  public var schema: String { root["schema"].string ?? "" }
  public var version: Int { root["version"].int ?? 0 }
  /// Web git revision the file was exported from.
  public var source: String { root["source"].string ?? "" }
  public var sourceDirty: Bool { root["sourceDirty"].bool ?? false }
  public var sourceFiles: [String] { root["sourceFiles"].strings ?? [] }
  public var producer: String { root["producer"].string ?? "" }
  /// The payload.
  public var data: JSONValue { root["data"] }
}

public final class DataCatalog {
  public static let manifestPath = "Resources/Data/manifest.json"
  public static let supportedFormatVersion = 1

  public let root: URL
  public let formatVersion: Int
  public let webRevision: String
  public let webDirty: Bool
  public let entries: [ManifestEntry]
  private var byPath: [String: ManifestEntry] = [:]
  private var byName: [String: ManifestEntry] = [:]
  private var cache: [String: DataDocument] = [:]
  private let lock = NSLock()

  /// Reads `<root>/Resources/Data/manifest.json`.
  public init(root: URL) throws {
    self.root = root
    let url = root.appendingPathComponent(DataCatalog.manifestPath)
    let m: JSONValue
    do {
      m = try JSONValue.load(contentsOf: url)
    } catch {
      throw DataCatalogError("cannot read \(url.path): \(error)")
    }
    guard m["schema"].string == "mayday.manifest" else { throw DataCatalogError("\(url.path): not a mayday.manifest") }
    let fv = m["formatVersion"].int ?? 0
    guard fv == DataCatalog.supportedFormatVersion else {
      throw DataCatalogError("manifest formatVersion \(fv), expected \(DataCatalog.supportedFormatVersion)")
    }
    formatVersion = fv
    webRevision = m["webRevision"].string ?? "unknown"
    webDirty = m["webDirty"].bool ?? false
    var list = [ManifestEntry]()
    for (i, f) in (m["files"].array ?? []).enumerated() {
      guard let path = f["path"].string, let sha = f["sha256"].string else {
        throw DataCatalogError("manifest files[\(i)]: missing path/sha256")
      }
      list.append(ManifestEntry(
        path: path,
        schema: f["schema"].string ?? "",
        version: f["version"].int ?? 0,
        producer: f["producer"].string ?? "",
        bytes: f["bytes"].int ?? -1,
        sha256: sha.lowercased()
      ))
    }
    entries = list
    for e in list {
      byPath[e.path] = e
      if e.path.hasPrefix("Resources/Data/") && e.path.hasSuffix(".json") { byName[e.name] = e }
    }
  }

  /// Walks up from `start` (a file or directory) to the first directory holding Resources/Data/manifest.json.
  public static func locateRoot(from start: URL) -> URL? {
    var dir = start
    let fm = FileManager.default
    for _ in 0..<12 {
      if fm.fileExists(atPath: dir.appendingPathComponent(manifestPath).path) { return dir }
      let parent = dir.deletingLastPathComponent()
      if parent.path == dir.path { break }
      dir = parent
    }
    return nil
  }

  public func url(for relativePath: String) -> URL { root.appendingPathComponent(relativePath) }

  public func entry(path: String) -> ManifestEntry? { byPath[path] }
  public func entry(named name: String) -> ManifestEntry? { byName[name] }

  /// Names of the JSON data files ("ocean", "look", …).
  public var dataNames: [String] { entries.filter { byName[$0.name] == $0 }.map { $0.name } }

  /// Raw bytes of a manifest file; verifies size and sha256 when `verify` is true.
  public func bytes(path: String, verify: Bool = true) throws -> [UInt8] {
    guard let e = byPath[path] else { throw DataCatalogError("\(path) is not in the manifest") }
    let url = self.url(for: path)
    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch {
      throw DataCatalogError("cannot read \(url.path): \(error)")
    }
    let b = [UInt8](data)
    if verify {
      if e.bytes >= 0 && b.count != e.bytes { throw DataCatalogError("\(path): \(b.count) bytes, manifest says \(e.bytes)") }
      let sha = SHA256.hex(b)
      if sha != e.sha256 { throw DataCatalogError("\(path): sha256 \(sha) != manifest \(e.sha256)") }
    }
    return b
  }

  /// A data document by name ("ocean" → Resources/Data/ocean.json); parsed once, cached.
  public func document(_ name: String, verify: Bool = true) throws -> DataDocument {
    lock.lock()
    if let d = cache[name] {
      lock.unlock()
      return d
    }
    lock.unlock()
    guard let e = byName[name] else { throw DataCatalogError("no data file named \(name) in the manifest") }
    let b = try bytes(path: e.path, verify: verify)
    let root: JSONValue
    do {
      root = try JSONValue.parse(Data(b))
    } catch {
      throw DataCatalogError("\(e.path): \(error)")
    }
    let doc = DataDocument(path: e.path, root: root)
    if !e.schema.isEmpty && doc.schema != e.schema {
      throw DataCatalogError("\(e.path): schema \(doc.schema), manifest says \(e.schema)")
    }
    if e.version != 0 && doc.version != e.version {
      throw DataCatalogError("\(e.path): version \(doc.version), manifest says \(e.version)")
    }
    lock.lock()
    cache[name] = doc
    lock.unlock()
    return doc
  }

  /// The payload (`data`) of a data document.
  public func data(_ name: String) throws -> JSONValue { try document(name).data }

  /// Checks size + sha256 of every manifest file. Returns one message per problem (empty = all good).
  public func verifyAll() -> [String] {
    var problems = [String]()
    for e in entries {
      do {
        _ = try bytes(path: e.path, verify: true)
      } catch {
        problems.append(String(describing: error))
      }
    }
    return problems
  }
}
