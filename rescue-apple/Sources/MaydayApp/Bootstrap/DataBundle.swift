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

/// Navigator over MaydayCore's exact JSONValue, as served by DataCatalog: every boot file is checked
/// against the manifest (size + sha256), numbers are bit-exact, and the exporter's "NaN" /
/// "Infinity" / "-Infinity" / "-0" strings read back as numbers. Missing keys / indices give a null
/// node, so chains never trap; `path` names the node for error messages.
/// DEBUG builds stop at a typed read with a fallback (`double(or:)`, `int(or:)`, `linearColor(or:)`)
/// whose path the data does not have or holds the wrong kind: a renamed key or a wrong path is a bug,
/// not a default. Release builds use the fallback.
struct BootJSON {
  let value: JSONValue
  let path: String

  init(_ value: JSONValue, path: String = "$") {
    self.value = value
    self.path = path
  }

  subscript(_ key: String) -> BootJSON { BootJSON(value[key], path: path + "." + key) }
  subscript(_ index: Int) -> BootJSON { BootJSON(value[index], path: path + "[\(index)]") }

  var isNull: Bool { value.isNull }
  var double: Double? { value.double }
  /// Integral number only (JSONValue.int: nil for 2.5, never truncated).
  var int: Int? { value.int }
  var bool: Bool? { value.bool }
  var string: String? { value.string }
  var array: [BootJSON] {
    (value.array ?? []).enumerated().map { BootJSON($0.element, path: path + "[\($0.offset)]") }
  }
  /// All elements as JS numbers; [] when this is not an array of numbers (no silent skipping).
  var doubles: [Double] { value.doubles ?? [] }
  /// All elements as strings; [] when this is not an array of strings.
  var strings: [String] { value.strings ?? [] }
  /// Object keys in document order (JS Object.keys order for these exports).
  var keys: [String] { value.object?.keys ?? [] }

  func double(or fallback: Double) -> Double {
    if let d = double { return d }
    missing("a number")
    return fallback
  }

  func int(or fallback: Int) -> Int {
    if let i = int { return i }
    missing("an integer")
    return fallback
  }

  /// Exported colour {hex, lin: [r, g, b]} → linear rgb.
  var linearColor: SIMD3<Double>? {
    let l = self["lin"].doubles
    return l.count == 3 ? SIMD3<Double>(l[0], l[1], l[2]) : nil
  }

  func linearColor(or fallback: SIMD3<Double>) -> SIMD3<Double> {
    if let c = linearColor { return c }
    missing("a colour {lin: [r, g, b]}")
    return fallback
  }

  private func missing(_ expected: String) {
    #if DEBUG
    preconditionFailure("data \(path): expected \(expected), got \(value.kindName)")
    #endif
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

  /// MaydayCore's typed, sha256-verified view of the same files (DataCatalog / Data/Schemas).
  func catalog() throws -> DataCatalog {
    if let c = catalogStore { return c }
    let c = try DataCatalog(root: root)
    catalogStore = c
    return c
  }

  /// The `data` payload of Resources/Data/<name>.json ({schema, version, source, producer, data}),
  /// read through DataCatalog (manifest size / sha256 / schema / version checked, parsed once, cached).
  func data(_ name: String) throws -> BootJSON {
    let payload = try catalog().data(name)
    if payload.isNull { throw DataBundleError.malformed("\(name).json: no data") }
    return BootJSON(payload, path: "\(name).json:data")
  }
}
