// Keycap labels of KeyboardEvent.code values (rescue/src/ui/common/keys.js keyLabel): the onboarding glyphs,
// the controls sheet and the key bar show «Пробел», «Shift», «W», «Num 2», «ЛКМ»… Tables NAMES / NUM come
// from Resources/Data/input.json (`ui/common/keys`).

/// ui/common/keys.js keyLabel
public struct KeyLabels: Sendable {
  public let names: [String: String]
  public let num: [String: String]

  /// `data["ui/common/keys"]` of input.json.
  public init(json t: JSONValue) throws {
    names = try RuFormat.stringMap(t["NAMES"], "keys.NAMES")
    num = try RuFormat.stringMap(t["NUM"], "keys.NUM")
  }

  public init(catalog: DataCatalog) throws {
    try self.init(json: try catalog.data("input")["ui/common/keys"])
  }

  /// keyLabel(code): '—' for no key, NAMES[code], KeyA → «A», Digit1 → «1», Numpad1 → «Num1»,
  /// NumpadAdd → «Num +», else the code without `<>&"`.
  public func label(_ code: String?) -> String {
    guard let code, !code.isEmpty else { return "—" }
    if let n = names[code] { return n }
    let u = Array(code.unicodeScalars)
    func tail(_ prefix: String) -> [Unicode.Scalar]? {
      let p = Array(prefix.unicodeScalars)
      return u.count > p.count && Array(u[0..<p.count]) == p ? Array(u[p.count...]) : nil
    }
    func str(_ s: [Unicode.Scalar]) -> String {
      var o = ""
      o.unicodeScalars.append(contentsOf: s)
      return o
    }
    let isDigit = { (c: Unicode.Scalar) in c.value >= 0x30 && c.value <= 0x39 }
    if let t = tail("Key"), t.count == 1, t[0].value >= 0x41, t[0].value <= 0x5A { return str(t) }
    if let t = tail("Digit"), t.count == 1, isDigit(t[0]) { return str(t) }
    if let t = tail("Numpad"), t.count == 1, isDigit(t[0]) { return "Num" + str(t) }
    if let t = tail("Numpad") { return "Num " + (num[str(t)] ?? str(t)) }
    var o = ""
    for c in u where c != "<" && c != ">" && c != "&" && c != "\"" { o.unicodeScalars.append(c) }
    return o
  }
}
