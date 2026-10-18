// DataBundle — where the exported web data lives in the app bundle (Resources/Data/*.json,
// Resources/Textures/*) and MaydayCore's typed, sha256-verified view of it (DataCatalog).
//
// The bundle carries the whole Resources/ folder (project.yml folder reference), so DataCatalog finds
// Resources/Data/manifest.json under Bundle.main.resourceURL. Every number the game uses comes from these
// files (PLAN §1.1 rule 5); the schemas in MaydayCore/Data read them.
import Foundation
import MaydayCore

enum DataBundleError: Error, CustomStringConvertible {
  case missing(String)
  case malformed(String)

  var description: String {
    switch self {
    case .missing(let s): return "Нет данных: \(s)"
    case .malformed(let s): return "Повреждены данные: \(s)"
    }
  }
}

final class DataBundle {
  /// Directory that contains `Resources/` (the bundle's resource directory): the root MaydayCore's
  /// DataCatalog expects (manifest paths are "Resources/Data/…", "Resources/Textures/…").
  let root: URL
  let dataDirectory: URL
  let texturesDirectory: URL
  private var catalogStore: DataCatalog?

  init(bundle: Bundle = .main) throws {
    guard let base = bundle.resourceURL else { throw DataBundleError.missing("bundle resources") }
    let data = base.appendingPathComponent("Resources/Data", isDirectory: true)
    let tex = base.appendingPathComponent("Resources/Textures", isDirectory: true)
    let fm = FileManager.default
    guard fm.fileExists(atPath: data.appendingPathComponent("manifest.json").path) else {
      throw DataBundleError.missing("Resources/Data/manifest.json")
    }
    guard fm.fileExists(atPath: tex.path) else { throw DataBundleError.missing("Resources/Textures/") }
    root = base
    dataDirectory = data
    texturesDirectory = tex
  }

  /// MaydayCore's typed view of the files (manifest size / sha256 / schema / version checked, parsed
  /// once, cached).
  func catalog() throws -> DataCatalog {
    if let c = catalogStore { return c }
    let c = try DataCatalog(root: root)
    catalogStore = c
    return c
  }

  /// The `data` payload of Resources/Data/<name>.json ({schema, version, source, producer, data}).
  func data(_ name: String) throws -> JSONValue {
    let payload = try catalog().data(name)
    if payload.isNull { throw DataBundleError.malformed("\(name).json: no data") }
    return payload
  }
}
