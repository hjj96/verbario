// Stable identities for the objects the web passes around by reference (PLAN §2.2 "Идентичность"):
// event payloads, WeakMap/Set keys and checkpoint links use these IDs, and the owning system keeps a
// dictionary by ID (reset on `mission:setup`). The raw value is the web's own id where one exists
// (`s.id`, `hazard.id`, the index into `world.pads`), so traces from both builds line up.

/// A typed integer ID; `Tag` only keeps the kinds apart at compile time.
public struct EntityID<Tag>: Hashable, Comparable, Sendable, CustomStringConvertible {
  public let raw: Int

  @inline(__always) public init(_ raw: Int) { self.raw = raw }

  public static func < (a: EntityID, b: EntityID) -> Bool { a.raw < b.raw }

  public var description: String { String(raw) }
}

public enum SurvivorGroupTag {}
public enum PersonTag {}
public enum HazardTag {}
public enum PadTag {}

/// A survivor group (`survivors.list[i]`, the web's `s` / `survivor` payload field), by `s.id`.
public typealias GroupID = EntityID<SurvivorGroupTag>
/// A person record (manifest / cabin entry), by its index in the mission manifest.
public typealias PersonID = EntityID<PersonTag>
/// An active hazard (`hazards.list[i]`), by `hazard.id`.
public typealias HazardID = EntityID<HazardTag>
/// A helipad, by its index in `world.pads` (the pad's `id`).
public typealias PadID = EntityID<PadTag>
