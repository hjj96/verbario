// JavaScript value semantics over JSONValue, for code that stores loosely typed JSON the way the web
// does (settings, progress): truthiness, `===`, own-property order and JSON.stringify — so the strings
// written to storage are byte-identical to the web's localStorage (PLAN D16, §4.5).

extension JSONValue {
  /// JS truthiness: false, 0, -0, NaN, "" and null are falsy; objects and arrays are truthy.
  public var jsTruthy: Bool {
    switch self {
    case .null: return false
    case .bool(let b): return b
    case .number(let d): return JSNumber.isTruthy(d)
    case .string(let s): return !s.isEmpty
    case .array, .object: return true
    }
  }

  /// ToString(value) — what a property lookup `table[value]` or a template literal sees
  /// (arrays join with ",", null / undefined elements as "", objects as "[object Object]").
  public var jsToString: String {
    switch self {
    case .null: return "null"
    case .bool(let b): return b ? "true" : "false"
    case .number(let d): return JSNumber.toString(d)
    case .string(let s): return s
    case .array(let a): return a.map { $0.isNull ? "" : $0.jsToString }.joined(separator: ",")
    case .object: return "[object Object]"
    }
  }

  /// `a === b` for a value just handed over by a caller: primitives by value (NaN !== NaN, +0 === -0,
  /// strings by UTF-16 code units); an object or array is a fresh reference, never === anything.
  public func jsStrictEquals(_ other: JSONValue) -> Bool {
    switch (self, other) {
    case (.null, .null): return true
    case (.bool(let a), .bool(let b)): return a == b
    case (.number(let a), .number(let b)): return a == b
    case (.string(let a), .string(let b)): return a.utf16.elementsEqual(b.utf16)
    default: return false
    }
  }

  /// JSON.stringify(value) (no indentation). NaN / ±Infinity become null, -0 becomes 0, object keys
  /// follow JS own-property order (array indices ascending first, then insertion order).
  public func jsonStringify() -> String {
    var out = ""
    JSONValue.stringify(self, into: &out)
    return out
  }

  private static func stringify(_ v: JSONValue, into out: inout String) {
    switch v {
    case .null: out += "null"
    case .bool(let b): out += b ? "true" : "false"
    case .number(let d): out += d.isFinite ? JSNumber.toString(d) : "null"
    case .string(let s): quote(s, into: &out)
    case .array(let a):
      out += "["
      for (i, x) in a.enumerated() {
        if i > 0 { out += "," }
        stringify(x, into: &out)
      }
      out += "]"
    case .object(let o):
      out += "{"
      for (i, k) in o.jsKeyOrder.enumerated() {
        if i > 0 { out += "," }
        quote(k, into: &out)
        out += ":"
        stringify(o[k] ?? .null, into: &out)
      }
      out += "}"
    }
  }

  /// QuoteJSONString: \" \\ \b \f \n \r \t, other C0 controls as \u00xx (lowercase hex).
  private static func quote(_ s: String, into out: inout String) {
    out += "\""
    for u in s.unicodeScalars {
      switch u.value {
      case 0x22: out += "\\\""
      case 0x5C: out += "\\\\"
      case 0x08: out += "\\b"
      case 0x0C: out += "\\f"
      case 0x0A: out += "\\n"
      case 0x0D: out += "\\r"
      case 0x09: out += "\\t"
      case 0x00..<0x20:
        let h = String(u.value, radix: 16)
        out += "\\u" + String(repeating: "0", count: 4 - h.count) + h
      default: out.unicodeScalars.append(u)
      }
    }
    out += "\""
  }
}

extension JSONObject {
  /// JS OrdinaryOwnPropertyKeys order: array-index keys ("0" … "4294967294", canonical) ascending,
  /// then the other keys in insertion order.
  public var jsKeyOrder: [String] {
    var indices = [(UInt32, String)]()
    var others = [String]()
    for k in keys {
      if let i = JSONObject.arrayIndex(k) { indices.append((i, k)) } else { others.append(k) }
    }
    if indices.isEmpty { return others }
    indices.sort { $0.0 < $1.0 }
    return indices.map { $0.1 } + others
  }

  /// The array index a property key denotes (canonical decimal < 2^32 - 1), or nil.
  static func arrayIndex(_ k: String) -> UInt32? {
    let u = Array(k.utf8)
    guard !u.isEmpty, u.count <= 10, u.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
    if u.count > 1 && u[0] == 0x30 { return nil } // leading zero: not canonical
    guard let v = UInt64(k), v < 4_294_967_295 else { return nil }
    return UInt32(v)
  }
}
