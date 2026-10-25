// The instance data the survivors' draw pass writes each frame, laid out exactly like the web's GPU buffers
// (Float32 InstancedBufferAttributes, instance matrices column-major): survivors/crowd.js Crowd (iArms,
// iPose, iLook, iFx), craft.js CraftBatch (iCraft, iCraft2, instanceColor), heat.js HeatProxy, water.js
// Collars (iData) / Glows (iP, iC, iH) / Lines, the name decals, the bottle, and the material uniforms of
// ghostUniforms(). MaydayRender's SurvivorsRenderer uploads [0, count) of each list; frustum culling of
// the instances (survivors/geo.js InstanceBounds) is the renderer's.

/// A list of instance matrices (Float, 16 per instance, column-major).
@inline(__always) func writeMatrix(_ m: Mat4, _ out: inout [Float], _ i: Int) {
  let o = i * 16
  for k in 0..<16 { out[o + k] = Float(m[k]) }
}

/// Crowd: one instanced person mesh for everybody (+ the underwater ghost and the night keylines, which
/// share its instance matrix).
public struct CrowdInstances {
  public let max: Int
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]
  /// iArms: θL, ψL, θR, ψR
  public internal(set) var arms: [Float]
  /// iPose: legFold, 1, 0, dissolve
  public internal(set) var pose: [Float]
  /// iLook: skin, hood, jacket, pants (palette indices)
  public internal(set) var look: [Float]
  /// iFx: tape, strobe, waterY, ghostLight
  public internal(set) var fx: [Float]
  /// mesh.visible = n > 0; ghost (underwater bodies) = n > 0 && extras; keyline = ghost && keylineOn
  public internal(set) var visible = false
  public internal(set) var ghostVisible = false
  public internal(set) var keylineVisible = false
  /// survivors sets it from the night factor (keylines only at night)
  public internal(set) var keylineOn = false

  init(max: Int) {
    self.max = max
    matrices = [Float](repeating: 0, count: max * 16)
    arms = [Float](repeating: 0, count: max * 4)
    pose = [Float](repeating: 0, count: max * 4)
    look = [Float](repeating: 0, count: max * 4)
    fx = [Float](repeating: 0, count: max * 4)
  }

  mutating func begin() { count = 0 }

  /// push(m, aL, pL, aR, pR, legFold, dissolve, skin, hood, jacket, pants, tape, strobe, waterY, ghostLight)
  mutating func push(_ m: Mat4, _ a: ArmAngles, _ legFold: Double, _ dissolve: Double, _ skin: Double, _ hood: Double, _ jacket: Double,
                     _ pants: Double, _ tape: Double, _ strobe: Double, _ waterY: Double, _ ghostLight: Double) {
    if count >= max { return }
    let i = count
    count += 1
    writeMatrix(m, &matrices, i)
    let j = i * 4
    arms[j] = Float(a.aL); arms[j + 1] = Float(a.pL); arms[j + 2] = Float(a.aR); arms[j + 3] = Float(a.pR)
    pose[j] = Float(legFold); pose[j + 1] = 1; pose[j + 2] = 0; pose[j + 3] = Float(dissolve)
    look[j] = Float(skin); look[j + 1] = Float(hood); look[j + 2] = Float(jacket); look[j + 3] = Float(pants)
    fx[j] = Float(tape); fx[j + 1] = Float(strobe); fx[j + 2] = Float(waterY); fx[j + 3] = Float(ghostLight)
  }

  mutating func end(extras: Bool) {
    visible = count > 0
    ghostVisible = count > 0 && extras
    keylineVisible = ghostVisible && keylineOn
  }
}

/// craft.js CraftBatch: one instanced mesh per craft model in use.
public struct CraftInstances {
  public let name: String
  public let max: Int
  public let castShadow: Bool
  public let hasColor: Bool
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]
  /// iCraft: tape, lamp, flutter, lights
  public internal(set) var a1: [Float]
  /// iCraft2: dissolve, chem, phase, w
  public internal(set) var a2: [Float]
  /// instanceColor (rgb, starts white)
  public internal(set) var colors: [Float]

  init(name: String, max: Int, castShadow: Bool, instanceColor: Bool = false) {
    self.name = name
    self.max = max
    self.castShadow = castShadow
    hasColor = instanceColor
    matrices = [Float](repeating: 0, count: max * 16)
    a1 = [Float](repeating: 0, count: max * 4)
    a2 = [Float](repeating: 0, count: max * 4)
    colors = instanceColor ? [Float](repeating: 1, count: max * 3) : []
  }

  mutating func begin() { count = 0 }

  /// push(m, tape, lamp, flutter, lights, dissolve, chem, phase, w, color)
  mutating func push(_ m: Mat4, _ tape: Double = 0, _ lamp: Double = 0, _ flutter: Double = 0, _ lights: Double = 0, _ dissolve: Double = 0,
                     _ chem: Double = 0, _ phase: Double = 0, _ w: Double = 0, _ color: Color3? = nil) {
    if count >= max { return }
    let i = count
    count += 1
    writeMatrix(m, &matrices, i)
    let j = i * 4
    a1[j] = Float(tape); a1[j + 1] = Float(lamp); a1[j + 2] = Float(flutter); a1[j + 3] = Float(lights)
    a2[j] = Float(dissolve); a2[j + 1] = Float(chem); a2[j + 2] = Float(phase); a2[j + 3] = Float(w)
    if let c = color, hasColor {
      colors[i * 3] = Float(c.r); colors[i * 3 + 1] = Float(c.g); colors[i * 3 + 2] = Float(c.b)
    }
  }
}

/// heat.js HeatProxy: the occupied craft again on render layer 2 only (heat-only proxies).
public struct HeatInstances {
  public let name: String
  /// userData.heat (the proxy's grey level)
  public let heat: Double
  public let max: Int
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]

  init(name: String, heat: Double, max: Int) {
    self.name = name
    self.heat = heat
    self.max = max
    matrices = [Float](repeating: 0, count: max * 16)
  }

  mutating func begin() { count = 0 }

  mutating func push(_ m: Mat4) {
    if count < max {
      writeMatrix(m, &matrices, count)
      count += 1
    }
  }
}

/// water.js Collars: foam collar + contact disc per floating thing (instance matrix + foam, dark, lit, phase).
public struct CollarInstances {
  public let max: Int
  public internal(set) var count = 0
  public internal(set) var matrices: [Float]
  public internal(set) var data: [Float]

  init(max: Int) {
    self.max = max
    matrices = [Float](repeating: 0, count: max * 16)
    data = [Float](repeating: 0, count: max * 4)
  }

  mutating func begin() { count = 0 }

  /// push(x, y, z, nx, ny, nz, R, foam, dark, lit, phase, yaw = 0, elong = 1): (x, y, z) waterline centre,
  /// n normal, R object radius
  mutating func push(_ x: Double, _ y: Double, _ z: Double, _ nx: Double, _ ny: Double, _ nz: Double, _ R: Double, _ foam: Double, _ dark: Double,
                     _ lit: Double, _ phase: Double, _ yaw: Double = 0, _ elong: Double = 1) {
    if count >= max { return }
    var n = V3(nx, ny, nz)
    n.normalize()
    var q = Quat()
    q.setFromUnitVectors(V3(0, 1, 0), n)
    if JSNumber.isTruthy(yaw) {
      var qy = Quat()
      qy.setFromAxisAngle(V3(0, 1, 0), yaw)
      q.multiply(qy)
    }
    let r = 1.6 * R
    var m = Mat4()
    m.compose(V3(x, y + 0.05, z), q, V3(r, 1, r * elong))
    writeMatrix(m, &matrices, count)
    let j = count * 4
    data[j] = Float(foam); data[j + 1] = Float(dark); data[j + 2] = Float(lit); data[j + 3] = Float(phase)
    count += 1
  }
}

/// water.js Glows: additive light sprites (lamps, strobes, chem lights, the mirror star, tape glints).
public struct GlowInstances {
  public let max: Int
  public internal(set) var count = 0
  /// iP: xyz, core size (m)
  public internal(set) var P: [Float]
  /// iC: rgb, intensity
  public internal(set) var C: [Float]
  /// iH: halo size (m), halo intensity, kind (0 round, 1 star), rotation
  public internal(set) var H: [Float]

  init(max: Int) {
    self.max = max
    P = [Float](repeating: 0, count: max * 4)
    C = [Float](repeating: 0, count: max * 4)
    H = [Float](repeating: 0, count: max * 4)
  }

  mutating func begin() { count = 0 }

  /// add(x, y, z, coreSize, color, intensity, haloSize, haloI, kind = 0, rot = 0)
  mutating func add(_ x: Double, _ y: Double, _ z: Double, _ coreSize: Double, _ color: Color3, _ intensity: Double, _ haloSize: Double,
                    _ haloI: Double, _ kind: Double = 0, _ rot: Double = 0) {
    if count >= max || !(intensity > 0.001 || haloI > 0.001) { return }
    let j = count * 4
    count += 1
    P[j] = Float(x); P[j + 1] = Float(y); P[j + 2] = Float(z); P[j + 3] = Float(coreSize)
    C[j] = Float(color.r); C[j + 1] = Float(color.g); C[j + 2] = Float(color.b); C[j + 3] = Float(intensity)
    H[j] = Float(haloSize); H[j + 1] = Float(haloI); H[j + 2] = Float(kind); H[j + 3] = Float(rot)
  }
}

/// water.js Lines: line segments (the rafts' sea-anchor lines).
public struct LineSegments {
  public let max: Int
  public internal(set) var count = 0
  /// 2 points × xyz per segment
  public internal(set) var positions: [Float]

  init(max: Int) {
    self.max = max
    positions = [Float](repeating: 0, count: max * 6)
  }

  mutating func begin() { count = 0 }

  mutating func seg(_ x0: Double, _ y0: Double, _ z0: Double, _ x1: Double, _ y1: Double, _ z1: Double) {
    if count >= max { return }
    let j = count * 6
    positions[j] = Float(x0); positions[j + 1] = Float(y0); positions[j + 2] = Float(z0)
    positions[j + 3] = Float(x1); positions[j + 4] = Float(y1); positions[j + 5] = Float(z1)
    count += 1
  }
}

/// A name decal drawn on a carrier this frame (hull name, the Ан-2 registration, the ferry's name).
public struct CarrierDecal: Equatable, Sendable {
  /// 'hull' | 'plane' | 'wreck'
  public var kind: String
  /// 'boat' | 'yacht' | 'plane' | the big hull model
  public var style: String
  public var text: String
  public var matrix: Mat4
  public var visible: Bool
  public var opacity: Double
}

/// The materials' per-frame uniforms (survivors.ghostUniforms).
public struct SurvivorsUniforms: Equatable, Sendable {
  /// ghost: uLight (light under the surface), uWater (palette body)
  public var ghostLight = Color3()
  public var water: Color3?
  /// collars: uFoam
  public var foam = Color3()
  /// shared day rim light (people + craft)
  public var rim = Color3()
  /// moonlit hemi floor (craft at night)
  public var nightAmb = Color3()
  /// overcast sky-dome fill (albedo ×)
  public var skyFill = Color3()
  /// dark rusty steel structures (barge, trawler wreck) get the full dome under dark skies
  public var steelFill = Color3()
  /// people material uVestGlow
  public var vestGlow: Double = 0
}

public struct SurvivorsRenderState {
  public internal(set) var crowd = CrowdInstances(max: 192)
  public internal(set) var raft = CraftInstances(name: "rafts", max: 16, castShadow: true)
  public internal(set) var boat = CraftInstances(name: "hulls", max: 6, castShadow: true)
  public internal(set) var yacht = CraftInstances(name: "yachts", max: 6, castShadow: true)
  public internal(set) var container = CraftInstances(name: "containers", max: 8, castShadow: true, instanceColor: true)
  public internal(set) var plane = CraftInstances(name: "planes", max: 2, castShadow: true)
  public internal(set) var stretcher = CraftInstances(name: "stretcher", max: 2, castShadow: true)
  public internal(set) var buoy = CraftInstances(name: "lostBuoys", max: 48, castShadow: false)
  public internal(set) var debris = CraftInstances(name: "debris", max: 128, castShadow: false)
  /// barge / ferry / trawler batches by BigCraftSpec.key, created on demand (max 2 each)
  public internal(set) var big: [String: CraftInstances] = [:]
  /// their specs (model, deck height), in creation order
  public internal(set) var bigSpecs: [BigCraftSpec] = []
  public internal(set) var heatRaft = HeatInstances(name: "rafts", heat: 0.7, max: 16)
  public internal(set) var heatBoat = HeatInstances(name: "hulls", heat: 0.3, max: 6)
  public internal(set) var heatYacht = HeatInstances(name: "yachts", heat: 0.3, max: 6)
  public internal(set) var heatPlane = HeatInstances(name: "planes", heat: 0.3, max: 2)
  public internal(set) var collars = CollarInstances(max: 192)
  public internal(set) var glows = GlowInstances(max: 160)
  public internal(set) var lines = LineSegments(max: 192)
  public internal(set) var decals: [CarrierDecal] = []
  public internal(set) var uniforms = SurvivorsUniforms()
  /// the bottle with a note (visible, transform)
  public internal(set) var bottleVisible = false
  public internal(set) var bottleMatrix = Mat4()

  public init() {}

  mutating func begin() {
    crowd.begin()
    raft.begin()
    boat.begin()
    yacht.begin()
    container.begin()
    plane.begin()
    stretcher.begin()
    buoy.begin()
    debris.begin()
    for k in big.keys { big[k]?.begin() }
    heatRaft.begin()
    heatBoat.begin()
    heatYacht.begin()
    heatPlane.begin()
    collars.begin()
    glows.begin()
    lines.begin()
    decals.removeAll(keepingCapacity: true)
  }

  mutating func ensureBig(_ spec: BigCraftSpec) {
    if big[spec.key] == nil {
      big[spec.key] = CraftInstances(name: spec.model, max: 2, castShadow: true)
      bigSpecs.append(spec)
    }
  }
}
