// DataBundle — read access to the exported web data in the app bundle (Resources/Data/*.json,
// Resources/Textures/*), for the M0 bootstrap simulation.
//
// BOOTSTRAP: MaydayCore/Data (DataCatalog + typed schemas) is the real loader (PLAN Appendix A);
// this untyped reader only exists so the first build shows the sea before Core's systems land.
// Every number still comes from the exported JSON (PLAN §1.1 rule 5): nothing here is hand-tuned.
// The bundle carries the whole Resources/ folder (project.yml folder reference), so MaydayCore's
// DataCatalog finds Resources/Data/manifest.json under Bundle.main.resourceURL.
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

/// Minimal JSON navigator over JSONSerialization output.
struct BootJSON {
  let raw: Any?

  init(_ raw: Any?) { self.raw = raw }

  subscript(_ key: String) -> BootJSON { BootJSON((raw as? [String: Any])?[key]) }
  subscript(_ index: Int) -> BootJSON {
    guard let a = raw as? [Any], index >= 0, index < a.count else { return BootJSON(nil) }
    return BootJSON(a[index])
  }

  var isNull: Bool { raw == nil || raw is NSNull }
  var double: Double? { (raw as? NSNumber)?.doubleValue }
  var int: Int? { (raw as? NSNumber)?.intValue }
  var bool: Bool? { (raw as? NSNumber)?.boolValue }
  var string: String? { raw as? String }
  var array: [BootJSON] { (raw as? [Any])?.map { BootJSON($0) } ?? [] }
  var doubles: [Double] { array.compactMap { $0.double } }
  var strings: [String] { array.compactMap { $0.string } }
  var keys: [String] { (raw as? [String: Any]).map { Array($0.keys) } ?? [] }

  func double(or fallback: Double) -> Double { double ?? fallback }
  func int(or fallback: Int) -> Int { int ?? fallback }

  /// Exported colour {hex, lin: [r, g, b]} → linear rgb.
  var linearColor: SIMD3<Double>? {
    let l = self["lin"].doubles
    return l.count == 3 ? SIMD3<Double>(l[0], l[1], l[2]) : nil
  }
}

final class DataBundle {
  /// Directory that contains `Resources/` (the bundle's resource directory): the root MaydayCore's
  /// DataCatalog expects (manifest paths are "Resources/Data/…", "Resources/Textures/…").
  let root: URL
  let dataDirectory: URL
  let texturesDirectory: URL
  private var cache: [String: BootJSON] = [:]
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

  /// MaydayCore's typed, sha256-verified view of the same files (DataCatalog / Data/Schemas).
  func catalog() throws -> DataCatalog {
    if let c = catalogStore { return c }
    let c = try DataCatalog(root: root)
    catalogStore = c
    return c
  }

  /// The `data` payload of Resources/Data/<name>.json ({schema, version, source, producer, data}).
  func data(_ name: String) throws -> BootJSON {
    if let v = cache[name] { return v }
    let url = dataDirectory.appendingPathComponent("\(name).json")
    let bytes: Data
    do { bytes = try Data(contentsOf: url) } catch { throw DataBundleError.missing("\(name).json") }
    let obj: Any
    do { obj = try JSONSerialization.jsonObject(with: bytes, options: []) } catch {
      throw DataBundleError.malformed("\(name).json: \(error.localizedDescription)")
    }
    let wrapper = BootJSON(obj)
    let payload = wrapper["data"]
    if payload.isNull { throw DataBundleError.malformed("\(name).json: no data") }
    cache[name] = payload
    return payload
  }
}
