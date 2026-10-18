// The cosmetic half of systems/heli.js _visuals(): everything the web writes into three.js objects and
// material uniforms each frame, as plain values for MaydayRender's HeliRenderer (PLAN §2.9
// `HeliVisualState`). Helicopter fills it; nothing in the simulation reads it back.
//
// Initial values are the materials' defaults (heli/materials.js, Resources/Data/heli.json
// `heli/materials`): a uniform the web only writes under a condition (palette present, sun dir given…)
// keeps its default or last value, exactly like the web.

/// createRotorMaterial uniforms the heli animates (main disc and tail disc).
public struct RotorDiscUniforms: Equatable, Sendable {
  public var blade: Double = 0
  public var ghost: Double = 0
  public var sharp: Double = 0
  public var exp: Double = 6
  /// main disc only (the tail disc keeps 0)
  public var elmo: Double = 0
  public var arc: Double = 0.45
  public var tipFade: Double = 1
}

/// hullMat.userData.uniforms the heli animates.
public struct HullShading: Equatable, Sendable {
  public var rim = Color3(0, 0, 0)
  /// night "moonlight on white paint" fill + the overcast readability fill
  public var fill = Color3(0, 0, 0)
  public var sunScale: Double = 1
  public var instr: Color3 = {
    var c = Color3(style: "#3AE0C8")
    c.multiplyScalar(0.4)
    return c
  }()
  public var soot: Double = 0.3
}

/// model.rotorLight: the rotor veil's light rig (shared by both discs).
public struct RotorVeilLight: Equatable, Sendable {
  public var sunDir = V3(0.3, 0.9, 0.2)
  public var sunCol = Color3(1, 1, 1)
  public var ambCol = Color3(0.5, 0.5, 0.5)
  public var skyCol = Color3(0.3, 0.35, 0.4)
  public var glow = Color3(0, 0, 0)
  public var glowB = Color3(0, 0, 0)
  public var glowS = Color3(0, 0, 0)
}

public struct HeliVisualState: Sendable {
  /// root.position (interpolated position + rotor bob) and root.rotation = (0, −heading, 0)
  public var rootPosition = V3(0, 40, 0)
  public var heading: Double = 0
  /// body.rotation = (pitch, 0, −bank); rotorPivot.rotation = (0.3·pitch, 0, −0.3·bank)
  public var pitch: Double = 0
  public var bank: Double = 0
  /// root.matrixWorld and body.matrixWorld (three's compose / multiply order): the renderer's model
  /// matrices, and what the lens, hoist, exhausts and lamps are transformed with.
  public var rootMatrix = Mat4()
  public var bodyMatrix = Mat4()
  /// hub.rotation.y (frozen blades or the ghost alias) and blades.rotation.y (shadow-only blades)
  public var hubAngle: Double = 0
  public var shadowBladesAngle: Double = 0
  /// blades.visible / castShadow (quality 'high')
  public var shadowBladesVisible = false
  public var rotor = RotorDiscUniforms()
  public var tail = RotorDiscUniforms()
  public var hull = HullShading()
  public var veil = RotorVeilLight()
  /// flotation bags (both): visible and scale
  public var floatsVisible = false
  public var floatScale = V3(1, 1, 1)
  /// thermal heat proxies (engine bays, exhaust plumes; render layer 2)
  public var heatVisible = true
  /// thrown flares in flight (pool of 4): position or nil = hidden
  public var flares: [V3?] = [nil, nil, nil, nil]
  /// packed rafts falling (pool of 2): position + rotation (spin·0.7, spin, spin·0.4) or nil = hidden
  public var rafts: [(position: V3, rotation: V3)?] = [nil, nil]
}
