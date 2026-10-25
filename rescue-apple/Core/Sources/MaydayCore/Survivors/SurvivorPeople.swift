// survivors/people.js — person records for the cabin, the radio and the logbook (DESIGN §3.5 pickup,
// §7.7 «Манифест»). Names come from the mission's own manifest (def.people) when it has one, so the
// logbook and the cabin agree; otherwise a seeded fallback with grammatically correct surnames
// (Иванов / Иванова). Every rng draw happens in the JS order (Tests/Vectors/survivors/people.json).

/// A manifest record (def.survivors[i].people[k] or makeFallbackPeople): { name, first, surname, gender,
/// age, child, occupation }. Missing members are nil (JS `undefined`).
public struct PersonRecord: Equatable, Sendable {
  public var name: String?
  public var first: String?
  public var surname: String?
  /// 'm' | 'f'
  public var gender: String?
  /// nil = `null` / missing
  public var age: Double?
  public var child: Bool
  public var occupation: String?

  public init(name: String?, first: String? = nil, surname: String? = nil, gender: String? = nil, age: Double? = nil, child: Bool = false,
              occupation: String? = nil) {
    self.name = name
    self.first = first
    self.surname = surname
    self.gender = gender
    self.age = age
    self.child = child
    self.occupation = occupation
  }

  /// A record from the mission def (JSON object); nil for a non-object (`recs[i] || recs[0]`).
  public init?(json v: JSONValue) {
    guard case .object = v else { return nil }
    name = v["name"].string
    first = v["first"].string
    surname = v["surname"].string
    gender = v["gender"].string
    age = v["age"].double
    child = v["child"].jsTruthy
    occupation = v["occupation"].string
  }

  /// The record as the def carries it (checkpoints, split groups).
  public var json: JSONValue {
    var o = JSONObject()
    if let name { o.set("name", .string(name)) }
    if let first { o.set("first", .string(first)) }
    if let surname { o.set("surname", .string(surname)) }
    if let gender { o.set("gender", .string(gender)) }
    o.set("age", age.map { .number($0) } ?? .null)
    o.set("child", .bool(child))
    if let occupation { o.set("occupation", .string(occupation)) }
    return .object(o)
  }
}

/// The person record survivors.boardOne() hands to the cabin, the radio and the mission ledger
/// (people.js header): `survivor:boarded {s, person}` carries its PersonID.
public struct BoardedRecord: Equatable, Sendable {
  public var id: PersonID
  public var name: String
  public var first: String
  public var surname: String
  public var gender: String
  public var age: Double?
  public var child: Bool
  public var occupation: String
  public var condition: String
  public var warmth: Double
  public var warmthAtLift: Double
  public var minutesInWater: Double
  public var tags: [String]
  public var quote: String
  public var injured: Bool
  public var type: String
  public var tag: String?
  public var label: String?
  /// 'cat' | 'dog' when the pet leaves with this (the last) person
  public var pet: String?
  /// the group the person was lifted from
  public var survivor: GroupID?
}

public enum SurvivorPeople {
  /// feminize(surname): -ов/-ев/-ёв/-ин/-ын + а, -ский → -ская, -цкий → -цкая, -ской → -ская; else unchanged.
  public static func feminize(_ s: String) -> String {
    for suf in ["ов", "ев", "ёв", "ин", "ын"] where s.hasSuffix(suf) { return s + "а" }
    if s.hasSuffix("ский") { return String(s.dropLast(4)) + "ская" }
    if s.hasSuffix("цкий") { return String(s.dropLast(4)) + "цкая" }
    if s.hasSuffix("ской") { return String(s.dropLast(4)) + "ская" }
    return s // Белых, Седых, Шевчук — unchanged
  }

  /// pickJob(rng, list, gender): weighted pick among the jobs open to the gender (nil when none are).
  static func pickJob(_ rng: inout Mulberry32, _ list: [SurvivorJob], _ gender: String) -> SurvivorJob? {
    let ok = list.filter { gender == "m" ? !$0.m.isEmpty : ($0.f.map { !$0.isEmpty } ?? false) }
    var sum = 0.0
    for j in ok { sum += j.weight }
    var r = rng.next() * sum
    for j in ok {
      r -= j.weight
      if r <= 0 { return j }
    }
    return ok.last
  }

  /// makeFallbackPeople(seed, type, count): createRng((seed >>> 0) · 2654435761 + 977).
  public static func makeFallbackPeople(_ tables: SurvivorTables, seed: Double, type: String, count: Int) -> [PersonRecord] {
    var rng = Mulberry32(seed: Double(JSNumber.toUint32(seed)) * 2654435761 + 977)
    let jobs = tables.jobs[type] ?? tables.jobs["swimmer"] ?? []
    var out = [PersonRecord]()
    for _ in 0..<max(0, count) {
      var gender = rng.next() < 0.3 ? "f" : "m"
      var job = pickJob(&rng, jobs, gender)
      if job == nil {
        gender = gender == "m" ? "f" : "m"
        job = pickJob(&rng, jobs, gender)
      }
      let child = type == "wreck" && rng.next() < 0.12
      let age = child ? rng.int(7, 12) : rng.int(19, 66)
      let first = (child ? rng.pick(gender == "f" ? tables.childF : tables.childM) : rng.pick(gender == "f" ? tables.firstF : tables.firstM)) ?? ""
      let base = rng.pick(tables.surnames) ?? ""
      let surname = gender == "f" ? feminize(base) : base
      let occupation: String? = child ? (gender == "f" ? "школьница" : "школьник") : gender == "f" ? job?.f : job?.m
      out.append(PersonRecord(name: "\(first) \(surname)", first: first, surname: surname, gender: gender, age: age, child: child,
                              occupation: occupation))
    }
    return out
  }

  /// Names read as male although they end in -а / -я.
  static let maleExceptions: Set<String> = ["Илья", "Никита", "Савва", "Лука", "Фома", "Кузьма", "Миша", "Ваня", "Тёма", "Сёма", "Лёва",
                                            "Костя", "Петя", "Саша"]

  /// guessGender(name): 'f' when the first name ends in а / я (not one of the male exceptions).
  public static func guessGender(_ name: String?) -> String {
    let first = jsWords(name ?? "").first ?? ""
    if (first.hasSuffix("а") || first.hasSuffix("я")) && !maleExceptions.contains(first) { return "f" }
    return "m"
  }

  /// conditionFor(warmth, injured): the cabin's condition line at lift.
  public static func conditionFor(_ warmth: Double, _ injured: Bool) -> String {
    if injured { return warmth < 0.35 ? "травма, переохлаждение" : "травма" }
    if warmth < 0.15 { return "сильное переохлаждение, без сознания" }
    if warmth < 0.3 { return "сильное переохлаждение" }
    if warmth < 0.6 { return "переохлаждение" }
    return "стабильное"
  }

  /// quoteFor(rng, gender, tags, used): the most specific unused quote (70 % per tag, 'any' always).
  public static func quoteFor(_ tables: SurvivorTables, _ rng: Rng, _ gender: String, _ tags: [String], _ used: inout Set<String>) -> String {
    let f = gender == "f"
    for tag in tags {
      let pool = tables.quotes.filter { $0.tags.contains(tag) && !used.contains($0.m) }
      if !pool.isEmpty && (tag == "any" || rng.next() < 0.7) {
        guard let q = rng.pick(pool) else { break }
        used.insert(q.m)
        return f && q.f != nil ? q.f ?? q.m : q.m
      }
    }
    guard let q = rng.pick(tables.quotes.filter { $0.tags.contains("any") }) else { return "" }
    return f && q.f != nil ? q.f ?? q.m : q.m
  }

  /// String(s).trim().split(/\s+/) — the words of a name (JS whitespace: spaces, tabs, NBSP, newlines…).
  static func jsWords(_ s: String) -> [String] {
    s.unicodeScalars.split(whereSeparator: { isJSWhitespace($0) }).map { String(String.UnicodeScalarView($0)) }
  }

  /// String(s).split(/\s+/) without the trim: a leading separator gives an empty first word.
  static func jsSplitWhitespace(_ s: String) -> [String] {
    var out = [String]()
    var cur = String.UnicodeScalarView()
    var inSep = false
    for u in s.unicodeScalars {
      if isJSWhitespace(u) {
        if !inSep {
          out.append(String(cur))
          cur = String.UnicodeScalarView()
          inSep = true
        }
      } else {
        cur.append(u)
        inSep = false
      }
    }
    out.append(String(cur))
    return out
  }

  static func isJSWhitespace(_ u: Unicode.Scalar) -> Bool {
    switch u.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
    default: return false
    }
  }
}
