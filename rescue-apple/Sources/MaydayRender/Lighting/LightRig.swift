// LightRig — the CONTRACT light set as the GPU sees it (PLAN D7, §3.4 «Свет», buffer 4): packs
// LightsInput (+ the sun's shadow) into MDLightsUniforms, exactly what three's WebGLLights uploads:
//   * directional: direction = normalize(light world position − target world position) (three subtracts
//     the matrixWorld positions), colour = color × intensity (physically correct lights, no π);
//   * hemisphere: sky / ground colour × intensity, up = +Y;
//   * spot[2] / point[6]: colour × intensity, distance (0 = no cutoff), decay, cone cosines; an unused slot
//     has zero colour (the shaders skip it);
//   * shadow: receiver matrix (Common/Shadow.h convention), bias, normalBias, radius, intensity, map size.
// SunRigState (SunRig.swift) fills the sun / hemisphere / shadow part from weather/lights.js.
import Foundation
import simd
import MaydayCore
import MaydayShaderTypes

/// The sun's shadow for one frame (weather/lights.js sun.shadow + LightShadow.updateMatrices).
public struct SunShadowInput {
  public var camera: ShadowCamera
  public var mapSize: Int
  public var intensity: Float                 // sun.shadow.intensity
  public var radius: Float                    // sun.shadow.radius (PCF Vogel radius, texels)
  public var bias = Float(SunRig.SHADOW_BIAS)
  public var normalBias = Float(SunRig.SHADOW_NORMAL_BIAS)
  /// shadow.camera.layers.enable(1) on high: shadow-only rotor blades join the depth pass.
  public var shadowOnlyLayer = false

  public init(camera: ShadowCamera, mapSize: Int, intensity: Float, radius: Float, shadowOnlyLayer: Bool) {
    self.camera = camera
    self.mapSize = mapSize
    self.intensity = intensity
    self.radius = radius
    self.shadowOnlyLayer = shadowOnlyLayer
  }

  public init(rig s: SunRigState, shadowOnlyLayer: Bool) {
    self.init(camera: ShadowCamera(s), mapSize: s.mapSize, intensity: Float(s.shadowIntensity),
              radius: Float(s.shadowRadius), shadowOnlyLayer: shadowOnlyLayer)
  }
}

extension LightsInput {
  /// Sun, hemisphere and shadow from the rig (what WeatherLights leaves in the three lights).
  public mutating func apply(rig s: SunRigState, shadowOnlyLayer: Bool, shadows: Bool = true) {
    let d = ThreeVec.normalize(V3(s.position.x - s.target.x, s.position.y - s.target.y, s.position.z - s.target.z))
    sunDirection = SIMD3<Float>(Float(d.x), Float(d.y), Float(d.z))
    sunColor = LightRig.scaled(s.color, s.intensity)
    hemiSky = LightRig.scaled(s.hemiColor, s.hemiIntensity)
    hemiGround = LightRig.scaled(s.hemiGroundColor, s.hemiIntensity)
    shadow = shadows ? SunShadowInput(rig: s, shadowOnlyLayer: shadowOnlyLayer) : nil
  }
}

public enum LightRig {
  static func scaled(_ c: PaletteColor, _ k: Double) -> SIMD3<Float> {
    SIMD3<Float>(Float(c.r * k), Float(c.g * k), Float(c.b * k))
  }

  /// MDLightsUniforms for the frame. `shadowMapBound`: a depth map with the shadow camera's casters is
  /// bound at MD_TEX_SHADOW (an empty map shades exactly like no map, so the pass may be skipped).
  public static func pack(_ L: LightsInput, shadowMapBound: Bool) -> MDLightsUniforms {
    var u = MDLightsUniforms()
    u.dir.direction = SIMD4<Float>(L.sunDirection.x, L.sunDirection.y, L.sunDirection.z, 0)
    u.dir.color = SIMD4<Float>(L.sunColor.x, L.sunColor.y, L.sunColor.z, 0)
    u.hemi.skyColor = SIMD4<Float>(L.hemiSky.x, L.hemiSky.y, L.hemiSky.z, 0)
    u.hemi.groundColor = SIMD4<Float>(L.hemiGround.x, L.hemiGround.y, L.hemiGround.z, 0)
    u.hemi.direction = SIMD4<Float>(0, 1, 0, 0)
    withUnsafeMutableBytes(of: &u.spot) { raw in
      let p = raw.bindMemory(to: MDSpotLight.self)
      for i in 0..<min(p.count, L.spots.count) {
        let s = L.spots[i]
        var m = MDSpotLight()
        m.position = SIMD4<Float>(s.position.x, s.position.y, s.position.z, 1)
        m.direction = SIMD4<Float>(s.direction.x, s.direction.y, s.direction.z, 0)
        m.color = SIMD4<Float>(s.color.x, s.color.y, s.color.z, 0)
        m.params = SIMD4<Float>(s.distance, s.decay, s.coneCos, s.penumbraCos)
        p[i] = m
      }
    }
    withUnsafeMutableBytes(of: &u.point) { raw in
      let p = raw.bindMemory(to: MDPointLight.self)
      for i in 0..<min(p.count, L.points.count) {
        let s = L.points[i]
        var m = MDPointLight()
        m.position = SIMD4<Float>(s.position.x, s.position.y, s.position.z, 1)
        m.color = SIMD4<Float>(s.color.x, s.color.y, s.color.z, 0)
        m.params = SIMD4<Float>(s.distance, s.decay, 0, 0)
        p[i] = m
      }
    }
    u.ambientEnv = SIMD4<Float>(L.ambient.x, L.ambient.y, L.ambient.z, L.environmentIntensity)
    if let s = L.shadow, shadowMapBound {
      u.shadowMatrix = ShadowPass.receiverMatrix(s.camera)
      u.shadowParams = SIMD4<Float>(s.bias, s.normalBias, s.radius, s.intensity)
      u.shadowMapSize = SIMD4<Float>(Float(s.mapSize), Float(s.mapSize), 1, 0)
    } else {
      u.shadowMatrix = simd_float4x4(columns: (SIMD4<Float>(1, 0, 0, 0), SIMD4<Float>(0, 1, 0, 0),
                                               SIMD4<Float>(0, 0, 1, 0), SIMD4<Float>(0, 0, 0, 1)))
      u.shadowParams = SIMD4<Float>(Float(SunRig.SHADOW_BIAS), Float(SunRig.SHADOW_NORMAL_BIAS), 1, 0)
      u.shadowMapSize = SIMD4<Float>(1, 1, 0, 0)
    }
    return u
  }
}
