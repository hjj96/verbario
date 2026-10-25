// A world place (world.js `places`): a structure with a helipad — the lighthouse «Скалистый» (M4), the
// rescue ship «Арктур» and the rig «Северная-7» (M5) — or a scenery place without a pad. The world
// builds them on `mission:setup` from def.world.pads / props, takes their pad, obstacles and surf
// shoals, and calls update(dt, env) every frame. Places that are not ported yet are created through
// `World.placeFactories` (type → factory) once they exist; until then the world skips their pads.

/// world.obstacles[i]: a vertical cylinder the heli bounces off (tower, mast, rock columns, rig derrick).
public struct WorldObstacle: Equatable, Sendable {
  public var x: Double
  public var z: Double
  public var radius: Double
  public var top: Double
  /// 'tower' | 'mast' | 'rock' | 'derrick' | …
  public var kind: String
  public var name: String

  public init(x: Double, z: Double, radius: Double, top: Double, kind: String, name: String) {
    self.x = x
    self.z = z
    self.radius = radius
    self.top = top
    self.kind = kind
    self.name = name
  }
}

/// A walkable structure deck that is not a pad (the rig's open lower deck at 22 m; world.deckAt).
public struct LowerDeck: Equatable, Sendable {
  public var x0: Double
  public var x1: Double
  public var z0: Double
  public var z1: Double
  public var y: Double
  /// centre (survivors match their deck targets against it)
  public var x: Double
  public var z: Double

  public init(x0: Double, x1: Double, z0: Double, z1: Double, y: Double, x: Double, z: Double) {
    self.x0 = x0
    self.x1 = x1
    self.z0 = z0
    self.z1 = z1
    self.y = y
    self.x = x
    self.z = z
  }
}

public enum PlaceKind: String, Sendable {
  case lighthouse, ship, rig
}

/// A terrain mesh the place contributes to the scene (the renderer draws it, the ocean bakes its coast
/// map from it): `offset` = the place group's world position (the mesh is local to it).
public struct PlacedTerrain: Sendable {
  public var mesh: TerrainMesh
  public var offset: V3
}

public protocol WorldPlace: AnyObject {
  var kind: PlaceKind { get }
  var name: String { get }
  /// place.x / place.z: the group's world position
  var x: Double { get }
  var z: Double { get }
  /// pad centre (deck height in y) and the landing radius
  var padPosition: V3 { get }
  var padRadius: Double { get }
  var obstacles: [WorldObstacle] { get }
  /// surf circles (world coordinates); nil = the place declares none
  var shoals: [ShoalCircle]? { get }
  var lowerDeck: LowerDeck? { get }
  /// ship pads: deck up vector, deck velocity, heading, tilt / pitch / roll (nil = a fixed pad)
  var deckMotion: PadMotion? { get }
  /// terrain meshes in the place (the island)
  var terrain: [PlacedTerrain] { get }
  /// setUnloadChannel(ch): the blue offload lamps of this pad blink on channel `ch`
  func setUnloadChannel(_ ch: Int)
  func update(_ dt: Double, _ env: WorldEnv)
  /// landformsQuality: boulder / vegetation counts
  func setQuality(_ q: String)
  /// dispose(): release what the place set in shared state (terrain glows)
  func dispose()
}

/// The live motion of a moving pad (ship.js; M5).
public struct PadMotion: Equatable, Sendable {
  public var up: V3
  public var velocity: V3
  public var heading: Double
  public var tilt: Double
  public var pitch: Double
  public var roll: Double

  public init(up: V3, velocity: V3, heading: Double, tilt: Double, pitch: Double, roll: Double) {
    self.up = up
    self.velocity = velocity
    self.heading = heading
    self.tilt = tilt
    self.pitch = pitch
    self.roll = roll
  }
}
