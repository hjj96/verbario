// HeliMaterials — the static half of the heli materials (rescue/src/systems/heli/materials.js and the plain
// three materials of crewman.js / winch.js / heli.js), read from the baked meshes' meta blocks, plus the
// per-frame uniform packers that combine them with a HeliRenderSnapshot into the blocks of
// Shaders/Heli/HeliShaderTypes.h. No hand constants: every value below comes from the web objects.
import Foundation
import MaydayCore

/// three material.side → main-pass culling (FrontSide culls back faces).
func heliCulling(_ meta: MMeshMeta) -> FaceCulling {
  switch meta.material["side"].string {
  case "double": return .none
  case "back": return .front
  default: return .back
  }
}

/// createHullMaterial: MeshPhysicalMaterial({ vertexColors, roughness .45, metalness 0, clearcoat .3,
/// clearcoatRoughness .22 }) + patchWeathering(…) — shared by heli.hull and heli.rotorHub.
struct HeliHullMaterial {
  var color: SIMD3<Float>
  var opacity: Float
  var roughness: Float
  var metalness: Float
  var clearcoat: Float
  var clearcoatRoughness: Float
  var specularColor: SIMD3<Float>
  var specularIntensity: Float
  var ior: Float
  var wx: HeliWxParams

  init(meta: MMeshMeta) throws {
    guard meta.materialType == "MeshPhysicalMaterial" else { throw RenderError.resource("\(meta.name): not the hull's MeshPhysicalMaterial") }
    color = try meta.requireColor("color")
    opacity = Float(try meta.requireNumber("opacity"))
    roughness = Float(try meta.requireNumber("roughness"))
    metalness = Float(try meta.requireNumber("metalness"))
    clearcoat = Float(try meta.requireNumber("clearcoat"))
    clearcoatRoughness = Float(try meta.requireNumber("clearcoatRoughness"))
    specularColor = try meta.requireColor("specularColor")
    specularIntensity = Float(try meta.requireNumber("specularIntensity"))
    ior = Float(try meta.requireNumber("ior"))
    wx = try HeliWxParams(meta: meta)
  }

  /// MDHullUniforms for one object (receiveShadow is per object: hull yes, hub no).
  func uniforms(_ s: HeliRenderSnapshot, receiveShadow: Bool) -> [SIMD4<Float>] {
    let h = s.visual.hull
    var b = HeliUniformBlock(capacity: HeliShaderLayout.hullSlots)
    b.add(color, opacity)                                       // diffuseOpacity
    b.add(roughness, metalness, clearcoat, clearcoatRoughness)  // physical
    b.add(specularColor, specularIntensity)                     // specular
    b.add(ior, receiveShadow ? 1 : 0, 0, 0)                     // iorShadow
    b.add(h.rim, h.sunScale)                                    // uRim, uSunScale
    b.add(h.fill, h.soot)                                       // uFill, uSoot
    b.add(h.instr, 0)                                           // uInstr
    for i in 0..<HeliShaderLayout.hullGlows {                   // uGlowPos[8]
      let p = i < s.glowPos.count ? s.glowPos[i] : V4(0, -100, 0, 1)
      b.add(Float(p.x), Float(p.y), Float(p.z), Float(p.w))
    }
    for i in 0..<HeliShaderLayout.hullGlows {                   // uGlowCol[8]
      b.add(i < s.glowCol.count ? s.glowCol[i] : Color3(0, 0, 0), 0)
    }
    wx.append(to: &b)                                           // wx
    return b.finished(HeliShaderLayout.hullSlots, "MDHullUniforms")
  }
}

/// createRotorMaterial(look, { blades, bladeHalfWidth, hull, inner, glowB, glowS }) — the constants of one disc.
struct HeliRotorMaterial {
  var blades: Float
  var bladeW: Float
  var hull: SIMD4<Float>
  var inner: Float
  var glowBAt: SIMD3<Float>
  var glowSAt: SIMD3<Float>
  var discColor: SIMD3<Float>
  var tipColor: SIMD3<Float>
  var elmoColor: SIMD3<Float>
  var opacity: Float
  var lit: Float

  init(meta: MMeshMeta) throws {
    blades = Float(try meta.requireNumber("uBlades"))
    bladeW = Float(try meta.requireNumber("uBladeW"))
    let h = try meta.requireVector("uHull", count: 4)
    hull = SIMD4<Float>(h[0], h[1], h[2], h[3])
    inner = Float(try meta.requireNumber("uInner"))
    let gb = try meta.requireVector("uGlowBAt", count: 3), gs = try meta.requireVector("uGlowSAt", count: 3)
    glowBAt = SIMD3<Float>(gb[0], gb[1], gb[2])
    glowSAt = SIMD3<Float>(gs[0], gs[1], gs[2])
    discColor = try meta.requireColor("uDiscColor")
    tipColor = try meta.requireColor("uTipColor")
    elmoColor = try meta.requireColor("uElmoColor")
    opacity = Float(try meta.requireNumber("uOpacity"))
    lit = Float(try meta.requireNumber("uLit"))
  }

  /// MDRotorUniforms: this disc's animated uniforms (heli.js _visuals) + the shared veil light.
  func uniforms(_ d: RotorDiscUniforms, _ veil: RotorVeilLight) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.rotorSlots)
    b.add(Float(d.blade), Float(d.ghost), Float(d.sharp), Float(d.exp))   // bladeGhostSharpExp
    b.add(Float(d.elmo), blades, bladeW, opacity)                          // elmoBladesWidthOpacity
    b.add(lit, Float(d.arc), Float(d.tipFade), inner)                      // litArcTipInner
    b.add(veil.sunDir)                                                     // uSunDir
    b.add(veil.sunCol)
    b.add(veil.ambCol)
    b.add(veil.skyCol)
    b.add(veil.glow)
    b.add(veil.glowB)
    b.add(veil.glowS)
    b.add(glowBAt, 0)
    b.add(glowSAt, 0)
    b.add(hull)
    b.add(discColor, 0)
    b.add(tipColor, 0)
    b.add(elmoColor, 0)
    return b.finished(HeliShaderLayout.rotorSlots, "MDRotorUniforms")
  }
}

/// MeshStandardMaterial / MeshBasicMaterial of a heli prop.
struct HeliPropMaterialParams {
  var color: SIMD3<Float>
  var opacity: Float
  var emissive: SIMD3<Float>
  var roughness: Float
  var metalness: Float
  var fog: Bool
  var vertexColors: Bool

  init(meta: MMeshMeta) throws {
    color = try meta.requireColor("color")
    opacity = Float(try meta.requireNumber("opacity"))
    let e = meta.materialColor("emissive") ?? SIMD3<Float>(0, 0, 0)
    emissive = e * Float(meta.materialNumber("emissiveIntensity") ?? 1)
    roughness = Float(meta.materialNumber("roughness") ?? 1)
    metalness = Float(meta.materialNumber("metalness") ?? 0)
    fog = meta.material["fog"].bool ?? true
    vertexColors = meta.material["vertexColors"].bool ?? false
  }

  /// MDHeliPropMaterial.
  func uniforms(receiveShadow: Bool) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.propSlots)
    b.add(color, opacity)
    b.add(emissive, 0)
    b.add(roughness, metalness, receiveShadow ? 1 : 0, fog ? 1 : 0)
    return b.finished(HeliShaderLayout.propSlots, "MDHeliPropMaterial")
  }
}

/// createLightsMaterial: uBulb (uChan / uHalo are per frame).
struct HeliLightsMaterial {
  var bulb: Float
  init(meta: MMeshMeta) throws { bulb = Float(try meta.requireNumber("uBulb")) }

  func uniforms(_ s: HeliRenderSnapshot) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.lightsSlots)
    var c = [Float](repeating: 0, count: 12)
    for i in 0..<min(HeliShaderLayout.lightChannels, s.lightChannels.count) { c[i] = s.lightChannels[i] }
    b.add(c[0], c[1], c[2], c[3])
    b.add(c[4], c[5], c[6], c[7])
    b.add(c[8], c[9], 0, 0)
    b.add(Float(s.halo), bulb, 0, 0)
    return b.finished(HeliShaderLayout.lightsSlots, "MDHeliLightsUniforms")
  }
}

/// createConeMaterial: uColor (the rest is MaydayCore Searchlight.cone).
struct HeliConeMaterial {
  var color: SIMD3<Float>
  init(meta: MMeshMeta) throws { color = try meta.requireColor("uColor") }

  func uniforms(_ c: SearchlightCone) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.coneSlots)
    b.add(color, Float(c.density))
    b.add(c.apex, c.intensity)
    b.add(c.axis, c.len)
    b.add(Float(c.cos2), Float(c.tanA), 0, 0)
    return b.finished(HeliShaderLayout.coneSlots, "MDConeUniforms")
  }
}

/// createCableMaterial: uPx, uBase, uBeamColor (uLit and the beam are per frame).
struct HeliCableMaterial {
  var px: Float
  var base: SIMD3<Float>
  var beamColor: SIMD3<Float>
  init(meta: MMeshMeta) throws {
    px = Float(try meta.requireNumber("uPx"))
    base = try meta.requireColor("uBase")
    beamColor = try meta.requireColor("uBeamColor")
  }

  func uniforms(_ w: WinchRenderState) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.cableSlots)
    for i in 0..<HeliShaderLayout.cablePoints {             // points[15]: winch.rend (Float32 xyz)
      let k = i * 3
      if k + 2 < w.rend.count { b.add(w.rend[k], w.rend[k + 1], w.rend[k + 2], 0) } else { b.add(0, 0, 0, 0) }
    }
    b.add(base, Float(w.cableLit))
    b.add(w.beamPos, w.beamCos)
    b.add(w.beamDir, w.beamIntensity)
    b.add(beamColor, px)
    return b.finished(HeliShaderLayout.cableSlots, "MDCableUniforms")
  }
}

/// createRingMaterial: uDashes (uColor / uOpacity / uPhase are per frame).
struct HeliRingMaterial {
  var dashes: Float
  init(meta: MMeshMeta) throws { dashes = Float(try meta.requireNumber("uDashes")) }

  func uniforms(_ w: WinchRenderState) -> [SIMD4<Float>] {
    var b = HeliUniformBlock(capacity: HeliShaderLayout.ringSlots)
    for i in 0..<HeliShaderLayout.ringVertices {            // positions[98]: winch ringPos (Float32 xyz)
      let k = i * 3
      if k + 2 < w.ringPositions.count { b.add(w.ringPositions[k], w.ringPositions[k + 1], w.ringPositions[k + 2], 0) } else { b.add(0, 0, 0, 0) }
    }
    b.add(w.ringColor, w.ringOpacity)
    b.add(Float(w.ringPhase), dashes, 0, 0)
    return b.finished(HeliShaderLayout.ringSlots, "MDRingUniforms")
  }
}
