// HeliMeshes — every baked mesh of «Чайка-07» (tools/export/bake-meshes.mjs → Resources/Meshes/heli_*.mmesh):
// the airframe, hub, lamps, rotor discs, shadow-only blades, flotation bag, heat proxies, the hoist operator's
// three parts, rescue basket and swimmer, cable and reach-ring topology, searchlight cone proxy, flare ember
// and packed life raft. Loaded once; the meta blocks carry the web's transforms and material parameters.
import Foundation
import Metal
import MaydayCore

public final class HeliMeshes {
  /// File stems, in the web's construction order (heli/model.js, winch.js, searchlight.js, crewman.js, heli.js).
  public static let names = [
    "heli_hull", "heli_lights", "heli_hub", "heli_rotor_main", "heli_rotor_main_low", "heli_rotor_tail",
    "heli_blades_shadow", "heli_float", "heli_cable", "heli_basket", "heli_rescuer", "heli_ring",
    "heli_searchlight_cone", "heli_crew_body", "heli_crew_arm", "heli_crew_head", "heli_heat_bay",
    "heli_heat_plume", "heli_flare", "heli_raft_pack",
  ]

  public let hull: MMesh
  public let lights: MMesh
  public let hub: MMesh
  public let rotorMain: MMesh        // CircleGeometry(1, 72): quality medium / high
  public let rotorMainLow: MMesh     // CircleGeometry(1, 48): quality low
  public let rotorTail: MMesh
  public let blades: MMesh
  public let float: MMesh
  public let cable: MMesh
  public let basket: MMesh
  public let rescuer: MMesh
  public let ring: MMesh
  public let cone: MMesh
  public let crewBody: MMesh
  public let crewArm: MMesh
  public let crewHead: MMesh
  public let heatBay: MMesh
  public let heatPlume: MMesh
  public let flare: MMesh
  public let raftPack: MMesh

  /// From the app bundle through the data catalog (bytes and sha256 checked against the manifest).
  public convenience init(device: MTLDevice, catalog: DataCatalog) throws {
    try self.init { try MMeshLoader.load(device: device, catalog: catalog, name: $0) }
  }

  /// From a directory of .mmesh files (tools, previews; no manifest check).
  public convenience init(device: MTLDevice, directory: URL) throws {
    try self.init { try MMeshLoader.load(device: device, url: directory.appendingPathComponent("\($0).mmesh")) }
  }

  private init(load: (String) throws -> MMesh) throws {
    var m: [String: MMesh] = [:]
    for n in HeliMeshes.names { m[n] = try load(n) }
    func get(_ n: String) -> MMesh { m[n]! }   // every name was loaded above (or init threw)
    hull = get("heli_hull")
    lights = get("heli_lights")
    hub = get("heli_hub")
    rotorMain = get("heli_rotor_main")
    rotorMainLow = get("heli_rotor_main_low")
    rotorTail = get("heli_rotor_tail")
    blades = get("heli_blades_shadow")
    float = get("heli_float")
    cable = get("heli_cable")
    basket = get("heli_basket")
    rescuer = get("heli_rescuer")
    ring = get("heli_ring")
    cone = get("heli_searchlight_cone")
    crewBody = get("heli_crew_body")
    crewArm = get("heli_crew_arm")
    crewHead = get("heli_crew_head")
    heatBay = get("heli_heat_bay")
    heatPlume = get("heli_heat_plume")
    flare = get("heli_flare")
    raftPack = get("heli_raft_pack")
    // the per-frame shader inputs index these meshes' vertices directly
    guard cable.vertexCount == 2 * HeliShaderLayout.cablePoints else {
      throw RenderError.resource("heli_cable: \(cable.vertexCount) vertices, the cable shader expects \(2 * HeliShaderLayout.cablePoints)")
    }
    guard ring.vertexCount == HeliShaderLayout.ringVertices else {
      throw RenderError.resource("heli_ring: \(ring.vertexCount) vertices, the ring shader expects \(HeliShaderLayout.ringVertices)")
    }
  }
}
