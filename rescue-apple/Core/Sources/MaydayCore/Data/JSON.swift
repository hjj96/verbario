// Minimal, exact JSON reader for the exported data and vector files.
//
// Why not JSONDecoder/JSONSerialization: the exports are JS shortest round-trip decimals and parity
// is bit-exact, so every number must be parsed with a correctly rounded decimal→double conversion
// on every platform. Here numbers go through Swift's `Double(String)` (strtod, correctly rounded on
// Darwin and Glibc); objects keep their key order (JS iteration order matters for some tables).
//
// The exporters write NaN/±Infinity/-0 as the strings "NaN", "Infinity", "-Infinity", "-0";
// `JSONValue.double` maps those back.
import Foundation

public struct JSONError: Error, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { "JSONError: " + message }
}

/// An object with its keys in document order.
public struct JSONObject: Equatable, Sendable {
  public private(set) var keys: [String] = []
  public private(set) var storage: [String: JSONValue] = [:]

  public init() {}

  public subscript(key: String) -> JSONValue? { storage[key] }

  public mutating func set(_ key: String, _ value: JSONValue) {
    if storage.updateValue(value, forKey: key) == nil { keys.append(key) }
  }

  public var count: Int { keys.count }

  /// (key, value) pairs in document order.
  public var entries: [(key: String, value: JSONValue)] { keys.map { (key: $0, value: storage[$0] ?? .null) } }
}

public indirect enum JSONValue: Equatable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object(JSONObject)

  // ---- parsing -----------------------------------------------------------------------------------
  public static func parse(_ data: Data) throws -> JSONValue {
    var p = JSONParser(bytes: [UInt8](data))
    return try p.parseDocument()
  }

  public static func parse(_ text: String) throws -> JSONValue {
    var p = JSONParser(bytes: Array(text.utf8))
    return try p.parseDocument()
  }

  public static func load(contentsOf url: URL) throws -> JSONValue {
    try parse(try Data(contentsOf: url))
  }

  // ---- navigation (missing keys / indices give .null, so chains never trap) ----------------------
  public subscript(key: String) -> JSONValue {
    if case .object(let o) = self { return o[key] ?? .null }
    return .null
  }

  public subscript(index: Int) -> JSONValue {
    if case .array(let a) = self, index >= 0, index < a.count { return a[index] }
    return .null
  }

  /// Dotted path lookup: "data.ocean/waves.WAVE_L" (keys may contain '/').
  public func at(_ path: String) -> JSONValue {
    var v = self
    for part in path.split(separator: ".", omittingEmptySubsequences: false) {
      if let i = Int(part), case .array = v { v = v[i] } else { v = v[String(part)] }
    }
    return v
  }

  // ---- typed views ---------------------------------------------------------------------------------
  public var isNull: Bool { if case .null = self { return true } else { return false } }
  public var exists: Bool { !isNull }

  /// A JS number: JSON numbers plus the exporter's "NaN" / "Infinity" / "-Infinity" / "-0" strings.
  public var double: Double? {
    switch self {
    case .number(let d): return d
    case .string(let s):
      switch s {
      case "NaN": return .nan
      case "Infinity": return .infinity
      case "-Infinity": return -.infinity
      case "-0": return -0.0
      default: return nil
      }
    default: return nil
    }
  }

  /// Integral number as Int (nil when not integral or out of range).
  public var int: Int? {
    guard let d = double, d.isFinite, d == d.rounded(.towardZero), d.magnitude < 9.0e15 else { return nil }
    return Int(d)
  }

  public var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
  public var string: String? { if case .string(let s) = self { return s } else { return nil } }
  public var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
  public var object: JSONObject? { if case .object(let o) = self { return o } else { return nil } }

  /// Array of JS numbers (nil if any element is not a number).
  public var doubles: [Double]? {
    guard case .array(let a) = self else { return nil }
    var out = [Double]()
    out.reserveCapacity(a.count)
    for v in a {
      guard let d = v.double else { return nil }
      out.append(d)
    }
    return out
  }

  public var strings: [String]? {
    guard case .array(let a) = self else { return nil }
    var out = [String]()
    out.reserveCapacity(a.count)
    for v in a {
      guard let s = v.string else { return nil }
      out.append(s)
    }
    return out
  }

  public var count: Int {
    switch self {
    case .array(let a): return a.count
    case .object(let o): return o.count
    default: return 0
    }
  }

  // ---- throwing accessors (data loading) -------------------------------------------------------------
  public func requireDouble(_ what: @autoclosure () -> String = "value") throws -> Double {
    guard let d = double else { throw JSONError("\(what()): expected a number, got \(kindName)") }
    return d
  }

  public func requireInt(_ what: @autoclosure () -> String = "value") throws -> Int {
    guard let i = int else { throw JSONError("\(what()): expected an integer, got \(kindName)") }
    return i
  }

  public func requireString(_ what: @autoclosure () -> String = "value") throws -> String {
    guard let s = string else { throw JSONError("\(what()): expected a string, got \(kindName)") }
    return s
  }

  public func requireDoubles(_ what: @autoclosure () -> String = "value") throws -> [Double] {
    guard let d = doubles else { throw JSONError("\(what()): expected an array of numbers, got \(kindName)") }
    return d
  }

  public func requireArray(_ what: @autoclosure () -> String = "value") throws -> [JSONValue] {
    guard let a = array else { throw JSONError("\(what()): expected an array, got \(kindName)") }
    return a
  }

  public func requireObject(_ what: @autoclosure () -> String = "value") throws -> JSONObject {
    guard let o = object else { throw JSONError("\(what()): expected an object, got \(kindName)") }
    return o
  }

  public var kindName: String {
    switch self {
    case .null: return "null"
    case .bool: return "bool"
    case .number: return "number"
    case .string: return "string"
    case .array: return "array"
    case .object: return "object"
    }
  }

  // Equatable: numbers compare by bit pattern (NaN == NaN, -0 != +0), which is what parity wants.
  public static func == (a: JSONValue, b: JSONValue) -> Bool {
    switch (a, b) {
    case (.null, .null): return true
    case (.bool(let x), .bool(let y)): return x == y
    case (.number(let x), .number(let y)): return x.bitPattern == y.bitPattern || (x.isNaN && y.isNaN)
    case (.string(let x), .string(let y)): return x == y
    case (.array(let x), .array(let y)): return x == y
    case (.object(let x), .object(let y)): return x == y
    default: return false
    }
  }
}

// ---------------------------------------------------------------------------------------------------
struct JSONParser {
  let bytes: [UInt8]
  var pos = 0
  var depth = 0

  init(bytes: [UInt8]) { self.bytes = bytes }

  mutating func parseDocument() throws -> JSONValue {
    // optional UTF-8 BOM
    if bytes.count >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF { pos = 3 }
    let v = try parseValue()
    skipWhitespace()
    if pos != bytes.count { throw error("trailing characters") }
    return v
  }

  func error(_ what: String) -> JSONError { JSONError("\(what) at byte \(pos)") }

  mutating func skipWhitespace() {
    while pos < bytes.count {
      let c = bytes[pos]
      if c == 0x20 || c == 0x0A || c == 0x0D || c == 0x09 { pos += 1 } else { break }
    }
  }

  mutating func parseValue() throws -> JSONValue {
    skipWhitespace()
    guard pos < bytes.count else { throw error("unexpected end of input") }
    switch bytes[pos] {
    case UInt8(ascii: "{"): return try parseObject()
    case UInt8(ascii: "["): return try parseArray()
    case UInt8(ascii: "\""): return .string(try parseString())
    case UInt8(ascii: "t"): try expectLiteral("true"); return .bool(true)
    case UInt8(ascii: "f"): try expectLiteral("false"); return .bool(false)
    case UInt8(ascii: "n"): try expectLiteral("null"); return .null
    default: return .number(try parseNumber())
    }
  }

  mutating func expectLiteral(_ word: String) throws {
    let w = Array(word.utf8)
    guard pos + w.count <= bytes.count, Array(bytes[pos..<(pos + w.count)]) == w else { throw error("invalid literal") }
    pos += w.count
  }

  mutating func parseObject() throws -> JSONValue {
    depth += 1
    if depth > 512 { throw error("nesting too deep") }
    defer { depth -= 1 }
    pos += 1 // {
    var obj = JSONObject()
    skipWhitespace()
    if pos < bytes.count && bytes[pos] == UInt8(ascii: "}") {
      pos += 1
      return .object(obj)
    }
    while true {
      skipWhitespace()
      guard pos < bytes.count, bytes[pos] == UInt8(ascii: "\"") else { throw error("expected object key") }
      let key = try parseString()
      skipWhitespace()
      guard pos < bytes.count, bytes[pos] == UInt8(ascii: ":") else { throw error("expected ':'") }
      pos += 1
      let value = try parseValue()
      obj.set(key, value)
      skipWhitespace()
      guard pos < bytes.count else { throw error("unterminated object") }
      if bytes[pos] == UInt8(ascii: ",") {
        pos += 1
        continue
      }
      if bytes[pos] == UInt8(ascii: "}") {
        pos += 1
        return .object(obj)
      }
      throw error("expected ',' or '}'")
    }
  }

  mutating func parseArray() throws -> JSONValue {
    depth += 1
    if depth > 512 { throw error("nesting too deep") }
    defer { depth -= 1 }
    pos += 1 // [
    var arr = [JSONValue]()
    skipWhitespace()
    if pos < bytes.count && bytes[pos] == UInt8(ascii: "]") {
      pos += 1
      return .array(arr)
    }
    while true {
      arr.append(try parseValue())
      skipWhitespace()
      guard pos < bytes.count else { throw error("unterminated array") }
      if bytes[pos] == UInt8(ascii: ",") {
        pos += 1
        continue
      }
      if bytes[pos] == UInt8(ascii: "]") {
        pos += 1
        return .array(arr)
      }
      throw error("expected ',' or ']'")
    }
  }

  mutating func parseString() throws -> String {
    pos += 1 // opening quote
    let start = pos
    // fast path: no escapes
    while pos < bytes.count {
      let c = bytes[pos]
      if c == UInt8(ascii: "\"") {
        let s = String(decoding: bytes[start..<pos], as: UTF8.self)
        pos += 1
        return s
      }
      if c == UInt8(ascii: "\\") { break }
      if c < 0x20 { throw error("control character in string") }
      pos += 1
    }
    // slow path with escapes
    var out = [UInt8](bytes[start..<pos])
    while pos < bytes.count {
      let c = bytes[pos]
      if c == UInt8(ascii: "\"") {
        pos += 1
        return String(decoding: out, as: UTF8.self)
      }
      if c < 0x20 { throw error("control character in string") }
      if c != UInt8(ascii: "\\") {
        out.append(c)
        pos += 1
        continue
      }
      pos += 1
      guard pos < bytes.count else { break }
      let e = bytes[pos]
      pos += 1
      switch e {
      case UInt8(ascii: "\""): out.append(0x22)
      case UInt8(ascii: "\\"): out.append(0x5C)
      case UInt8(ascii: "/"): out.append(0x2F)
      case UInt8(ascii: "b"): out.append(0x08)
      case UInt8(ascii: "f"): out.append(0x0C)
      case UInt8(ascii: "n"): out.append(0x0A)
      case UInt8(ascii: "r"): out.append(0x0D)
      case UInt8(ascii: "t"): out.append(0x09)
      case UInt8(ascii: "u"):
        var scalar = try parseHex4()
        if scalar >= 0xD800 && scalar <= 0xDBFF {
          // surrogate pair
          if pos + 1 < bytes.count && bytes[pos] == UInt8(ascii: "\\") && bytes[pos + 1] == UInt8(ascii: "u") {
            pos += 2
            let low = try parseHex4()
            if low >= 0xDC00 && low <= 0xDFFF {
              scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
            } else {
              scalar = 0xFFFD
            }
          } else {
            scalar = 0xFFFD
          }
        } else if scalar >= 0xDC00 && scalar <= 0xDFFF {
          scalar = 0xFFFD
        }
        let u = Unicode.Scalar(scalar) ?? "\u{FFFD}"
        out.append(contentsOf: Array(String(Character(u)).utf8))
      default:
        throw error("invalid escape")
      }
    }
    throw error("unterminated string")
  }

  mutating func parseHex4() throws -> UInt32 {
    guard pos + 4 <= bytes.count else { throw error("short \\u escape") }
    var v: UInt32 = 0
    for _ in 0..<4 {
      let c = bytes[pos]
      let d: UInt32
      switch c {
      case 0x30...0x39: d = UInt32(c - 0x30)
      case 0x41...0x46: d = UInt32(c - 0x41 + 10)
      case 0x61...0x66: d = UInt32(c - 0x61 + 10)
      default: throw error("bad hex digit")
      }
      v = v * 16 + d
      pos += 1
    }
    return v
  }

  mutating func parseNumber() throws -> Double {
    let start = pos
    if pos < bytes.count && bytes[pos] == UInt8(ascii: "-") { pos += 1 }
    var digits = 0
    while pos < bytes.count, bytes[pos] >= 0x30, bytes[pos] <= 0x39 {
      pos += 1
      digits += 1
    }
    if digits == 0 { throw error("invalid number") }
    if pos < bytes.count && bytes[pos] == UInt8(ascii: ".") {
      pos += 1
      var frac = 0
      while pos < bytes.count, bytes[pos] >= 0x30, bytes[pos] <= 0x39 {
        pos += 1
        frac += 1
      }
      if frac == 0 { throw error("invalid number") }
    }
    if pos < bytes.count && (bytes[pos] == UInt8(ascii: "e") || bytes[pos] == UInt8(ascii: "E")) {
      pos += 1
      if pos < bytes.count && (bytes[pos] == UInt8(ascii: "+") || bytes[pos] == UInt8(ascii: "-")) { pos += 1 }
      var exp = 0
      while pos < bytes.count, bytes[pos] >= 0x30, bytes[pos] <= 0x39 {
        pos += 1
        exp += 1
      }
      if exp == 0 { throw error("invalid number") }
    }
    let text = String(decoding: bytes[start..<pos], as: UTF8.self)
    guard let d = Double(text) else { throw error("unparsable number \(text)") }
    return d
  }
}
