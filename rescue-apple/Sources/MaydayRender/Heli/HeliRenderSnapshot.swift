// HeliRenderSnapshot — the helicopter as the renderer sees it for one frame (PLAN §1.3: render reads
// snapshots, never simulation objects). Everything systems/heli.js and heli/* write into three.js objects
// and material uniforms each frame, copied out of MaydayCore's Helicopter after its update():
//   visual        HeliVisualState — root / body matrices, rotor disc uniforms, hub / shadow-blade angles,
//                 hull shading, rotor veil light, flotation bags, heat proxies, flares and raft packs;
//   lights        HeliLights — uChan[10] / uHalo of the bulbs, the hull's lamp-spill slots, the belly light;
//   searchlight   Searchlight — the SpotLight and the volumetric cone's uniforms / transform;
//   winch         Winch.view — cable points, basket / rescue swimmer poses, the reach ring;
//   crew          Crewman.pose — the hoist operator.
// The CONTRACT light set slots that belong to the heli (spot[0] searchlight, point[0] belly light) are
// derived here in three's WebGLLights terms, for the frame's LightsInput.
import Foundation
import MaydayCore

public struct HeliRenderSnapshot {
  public var visual: HeliVisualState
  /// lights material uChan (Float32Array(10) in the web) and uHalo
  public var lightChannels: [Float]
  public var halo: Double
  /// hull material uGlowPos (xyz airframe-local + radius) / uGlowCol
  public var glowPos: [V4]
  public var glowCol: [Color3]
  /// belly PointLight(0xffffff, intensity, 90, 2) at POINTS.belly on the body: normalised colour, intensity
  public var bellyColor: Color3
  public var bellyIntensity: Double
  public var spot: SearchlightSpot
  public var cone: SearchlightCone
  public var winch: WinchRenderState
  public var crew: CrewmanPose
  /// settings quality 'low' → the 48-segment main disc (heli/model.js discSegs), else 72
  public var lowQuality: Bool

  /// Copies the render-facing state of a Helicopter after its update(dt).
  public init(heli h: Helicopter, quality: String) {
    visual = h.visual
    let lc = h.lightsCtl
    lightChannels = lc.chan
    halo = lc.halo
    glowPos = lc.glowPos
    glowCol = lc.glowCol
    bellyColor = lc.bellyColor
    bellyIntensity = lc.bellyIntensity
    spot = h.searchlightCtl.spot
    cone = h.searchlightCtl.cone
    winch = h.winch.view
    crew = h.crewman.pose
    lowQuality = quality == "low"
  }

  // ---- the heli's slots of the CONTRACT light set (three WebGLLights.setup) ------------------------------

  /// light.matrixWorld position of the belly light: body.matrixWorld × POINTS.belly.
  public var bellyPosition: V3 {
    var p = HeliModel.Points.belly
    p.applyMatrix4(visual.bodyMatrix)
    return p
  }

  /// spot[0]: the searchlight. colour × intensity, distance 300, decay 2, cos(angle), cos(angle·(1 − penumbra));
  /// direction from the lamp toward its target (MDSpotLight convention).
  public var searchlightLight: SpotLightInput {
    var s = SpotLightInput()
    let p = spot.position, t = spot.target
    s.position = SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z))
    var d = V3(t.x - p.x, t.y - p.y, t.z - p.z)
    d.normalize()
    s.direction = SIMD3<Float>(Float(d.x), Float(d.y), Float(d.z))
    let c = SearchlightSpot.color
    s.color = SIMD3<Float>(Float(c.r * spot.intensity), Float(c.g * spot.intensity), Float(c.b * spot.intensity))
    s.distance = Float(SearchlightSpot.range)
    s.decay = Float(SearchlightSpot.decay)
    s.coneCos = Float(JS.cos(spot.angle))
    s.penumbraCos = Float(JS.cos(spot.angle * (1 - spot.penumbra)))
    return s
  }

  /// point[0]: the belly light (heli/lights.js PointLight(0xffffff, 0, 90, 2)).
  public var bellyLight: PointLightInput {
    var l = PointLightInput()
    let p = bellyPosition
    l.position = SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z))
    l.color = SIMD3<Float>(Float(bellyColor.r * bellyIntensity), Float(bellyColor.g * bellyIntensity), Float(bellyColor.b * bellyIntensity))
    l.distance = 90
    l.decay = 2
    return l
  }
}
