// HeliPlanner — what HeliRenderer draws this frame, without the GPU: for every web object of «Чайка-07»
// its visibility (as systems/heli.js and heli/* set `visible`), matrixWorld (HeliTransforms), uniform block
// (HeliMaterials), and its place in the frame:
//   * main camera — three's projectObject: layers test (camera layer 0), frustum test of the world bounding
//     sphere when frustumCulled, RenderList sort keys (renderOrder, material id, clip z, object id; object
//     and material ids in the web's construction order);
//   * shadow caster — castShadow + layers (shadow camera: main, plus 1 on high), tested per pass;
//   * thermal — heat (layer 2) / thermal mass (layer 3) flags of systems/post/thermal.js.
// Pure Swift over the baked meta (MMeshInfo): tools/meshfmt/check-render.sh runs it on Linux.
import Foundation
import simd
import MaydayCore
import MaydayShaderTypes

/// One object of the thermal pass (systems/post/thermal.js: heat on layer 2, thermal mass on layer 3).
public struct HeliThermalItem {
  public let mesh: String         // HeliMeshes name
  public let model: simd_double4x4
  public let heat: Float
  public let thermalMass: Float
  public let layers: RenderLayers
}

/// The shader family of a main-pass draw.
enum HeliDrawKind: Hashable {
  case hull, prop(vertexColors: Bool), basic, cable, ring, rotor, lights, cone
}

struct HeliPlannedDraw {
  let mesh: String
  let kind: HeliDrawKind
  let object: MDObjectData
  let uniforms: [SIMD4<Float>]
  let culling: FaceCulling
  let depthWrite: Bool
  let blend: BlendMode
  /// three's render item as RenderList sorted it (clip z included)
  var item: DrawItem
}

struct HeliPlannedCaster {
  let mesh: String
  let model: Mat4
  let object: MDObjectData
  let layers: RenderLayers
  let culling: FaceCulling        // material side (ShadowPass.cullMode swaps it like WebGLShadowMap)
  let frustumCulled: Bool
}

struct HeliPlan {
  var opaque: [HeliPlannedDraw] = []
  var transparent: [HeliPlannedDraw] = []
  var casters: [HeliPlannedCaster] = []
  var thermal: [HeliThermalItem] = []
}

final class HeliPlanner {
  // ids in the web's construction order (Object3D.id / Material.id: only their relative order matters)
  enum ObjectID: Int {
    case hull = 1, lights, hub, rotor, tail, blades, float0, float1, cable, basket, rescuer, ring, cone
    case crewBody, crewArm, crewHead, heat0, heat1, heat2, heat3, flare0, flare1, flare2, flare3, raft0, raft1
  }
  enum MaterialID: Int {
    case hull = 1, lights, rotor, tail, blades, float, cable, basket, rescuer, ring, cone, crew, heat, plume, flare, raft
  }

  let infos: [String: MMeshInfo]
  let hullMaterial: HeliHullMaterial
  let rotorMain: HeliRotorMaterial
  let rotorMainLow: HeliRotorMaterial
  let rotorTail: HeliRotorMaterial
  let lightsMaterial: HeliLightsMaterial
  let coneMaterial: HeliConeMaterial
  let cableMaterial: HeliCableMaterial
  let ringMaterial: HeliRingMaterial
  let crewMaterial: HeliPropMaterialParams
  let floatMaterial: HeliPropMaterialParams
  let basketMaterial: HeliPropMaterialParams
  let rescuerMaterial: HeliPropMaterialParams
  let raftMaterial: HeliPropMaterialParams
  let flareMaterial: HeliPropMaterialParams
  /// three's renderList, reused frame to frame (reset keeps its capacity)
  private let list = RenderList()

  init(infos: [String: MMeshInfo]) throws {
    for n in HeliMeshes.names where infos[n] == nil { throw RenderError.resource("heli: mesh \(n) missing") }
    self.infos = infos
    func meta(_ n: String) -> MMeshMeta { infos[n]!.meta }   // checked above
    hullMaterial = try HeliHullMaterial(meta: meta("heli_hull"))
    rotorMain = try HeliRotorMaterial(meta: meta("heli_rotor_main"))
    rotorMainLow = try HeliRotorMaterial(meta: meta("heli_rotor_main_low"))
    rotorTail = try HeliRotorMaterial(meta: meta("heli_rotor_tail"))
    lightsMaterial = try HeliLightsMaterial(meta: meta("heli_lights"))
    coneMaterial = try HeliConeMaterial(meta: meta("heli_searchlight_cone"))
    cableMaterial = try HeliCableMaterial(meta: meta("heli_cable"))
    ringMaterial = try HeliRingMaterial(meta: meta("heli_ring"))
    crewMaterial = try HeliPropMaterialParams(meta: meta("heli_crew_body"))
    floatMaterial = try HeliPropMaterialParams(meta: meta("heli_float"))
    basketMaterial = try HeliPropMaterialParams(meta: meta("heli_basket"))
    rescuerMaterial = try HeliPropMaterialParams(meta: meta("heli_rescuer"))
    raftMaterial = try HeliPropMaterialParams(meta: meta("heli_raft_pack"))
    flareMaterial = try HeliPropMaterialParams(meta: meta("heli_flare"))
  }

  static func objectData(_ m: Mat4, heat: Double?, mass: Double?, layers: UInt32) -> MDObjectData {
    var o = StandardFamily.objectData(CameraMatrices.toDouble(m))
    o.heatMassLayer = SIMD4<Float>(Float(heat ?? 0), Float(mass ?? 0), Float(layers), 0)
    return o
  }

  /// viewProjGL: camera.projectionMatrix × matrixWorldInverse (three projScreenMatrix, WebGL clip).
  func plan(_ s: HeliRenderSnapshot, viewProjGL: simd_double4x4) -> HeliPlan {
    var out = HeliPlan()
    let frustum = Frustum(viewProjGL: viewProjGL)
    list.reset()
    var draws: [HeliPlannedDraw] = []   // indexed by DrawItem.handle
    let pose = HeliPose(s)

    // one object: main-pass draw (kind nil = shadow / thermal only), shadow caster, thermal item
    func add(_ id: ObjectID, _ mat: MaterialID, _ name: String, chain i: Int = 0, kind: HeliDrawKind?,
             uniforms: @autoclosure () -> [SIMD4<Float>], castShadow: Bool? = nil) {
      guard let info = infos[name] else { return }
      let meta = info.meta
      let model = HeliTransforms.world(meta, chain: i, pose: pose)
      let object = HeliPlanner.objectData(model, heat: meta.heat, mass: meta.thermalMass, layers: meta.layers)
      if let kind {
        var item = DrawItem(id: id.rawValue, materialID: mat.rawValue)
        item.renderOrder = meta.renderOrder
        item.transparent = meta.material["transparent"].bool ?? false
        item.layers = RenderLayers(rawValue: meta.layers)
        item.frustumCulled = meta.frustumCulled
        // world bounding sphere: centre × matrixWorld, radius × max axis scale (three Sphere.applyMatrix4)
        var c = V3(info.boundsCenter.x, info.boundsCenter.y, info.boundsCenter.z)
        c.applyMatrix4(model)
        item.center = SIMD3<Double>(c.x, c.y, c.z)
        item.radius = info.boundsRadius * model.getMaxScaleOnAxis()
        item.handle = draws.count
        let blend: BlendMode = meta.material["blending"].string == "additive" ? .additive : (item.transparent ? .alpha : .opaque)
        if list.add(item, viewProjGL: viewProjGL, frustum: frustum) {
          draws.append(HeliPlannedDraw(mesh: name, kind: kind, object: object, uniforms: uniforms(), culling: heliCulling(meta),
                                       depthWrite: meta.material["depthWrite"].bool ?? true, blend: blend, item: item))
        }
      }
      if castShadow ?? meta.castShadow {
        out.casters.append(HeliPlannedCaster(mesh: name, model: model, object: object, layers: RenderLayers(rawValue: meta.layers),
                                             culling: heliCulling(meta), frustumCulled: meta.frustumCulled))
      }
      if meta.heat != nil || meta.thermalMass != nil {
        out.thermal.append(HeliThermalItem(mesh: name, model: CameraMatrices.toDouble(model), heat: Float(meta.heat ?? 0),
                                           thermalMass: Float(meta.thermalMass ?? 0), layers: RenderLayers(rawValue: meta.layers)))
      }
    }

    let v = s.visual
    // heli/model.js: hull, lights, hub, rotors, shadow-only blades, flotation bags
    add(.hull, .hull, "heli_hull", kind: .hull, uniforms: hullMaterial.uniforms(s, receiveShadow: infos["heli_hull"]!.meta.receiveShadow))
    add(.lights, .lights, "heli_lights", kind: .lights, uniforms: lightsMaterial.uniforms(s))
    add(.hub, .hull, "heli_hub", kind: .hull, uniforms: hullMaterial.uniforms(s, receiveShadow: infos["heli_hub"]!.meta.receiveShadow))
    add(.rotor, .rotor, s.lowQuality ? "heli_rotor_main_low" : "heli_rotor_main", kind: .rotor,
        uniforms: (s.lowQuality ? rotorMainLow : rotorMain).uniforms(v.rotor, v.veil))
    add(.tail, .tail, "heli_rotor_tail", kind: .rotor, uniforms: rotorTail.uniforms(v.tail, v.veil))
    if v.shadowBladesVisible {   // layer 1 only (never the main camera); castShadow on high
      add(.blades, .blades, "heli_blades_shadow", kind: nil, uniforms: [], castShadow: true)
    }
    if v.floatsVisible {
      for i in 0..<2 {
        add(i == 0 ? .float0 : .float1, .float, "heli_float", chain: i, kind: .prop(vertexColors: floatMaterial.vertexColors),
            uniforms: floatMaterial.uniforms(receiveShadow: infos["heli_float"]!.meta.receiveShadow))
      }
    }
    // heli/winch.js render(): cable, basket, rescue swimmer, reach ring
    let w = s.winch
    if w.cableVisible { add(.cable, .cable, "heli_cable", kind: .cable, uniforms: cableMaterial.uniforms(w)) }
    if w.basketVisible {
      add(.basket, .basket, "heli_basket", kind: .prop(vertexColors: basketMaterial.vertexColors),
          uniforms: basketMaterial.uniforms(receiveShadow: infos["heli_basket"]!.meta.receiveShadow))
    }
    if w.rescuerVisible {
      add(.rescuer, .rescuer, "heli_rescuer", kind: .prop(vertexColors: rescuerMaterial.vertexColors),
          uniforms: rescuerMaterial.uniforms(receiveShadow: infos["heli_rescuer"]!.meta.receiveShadow))
    }
    if w.ringVisible { add(.ring, .ring, "heli_ring", kind: .ring, uniforms: ringMaterial.uniforms(w)) }
    // heli/searchlight.js: the shaft proxy
    if s.cone.visible { add(.cone, .cone, "heli_searchlight_cone", kind: .cone, uniforms: coneMaterial.uniforms(s.cone)) }
    // heli/crewman.js: the hoist operator
    if s.crew.visible {
      for (id, name) in [(ObjectID.crewBody, "heli_crew_body"), (.crewArm, "heli_crew_arm"), (.crewHead, "heli_crew_head")] {
        add(id, .crew, name, kind: .prop(vertexColors: crewMaterial.vertexColors),
            uniforms: crewMaterial.uniforms(receiveShadow: infos[name]!.meta.receiveShadow))
      }
    }
    // systems/heli.js: heat proxies (layer 2 only), flares in flight, packed rafts in free fall
    if v.heatVisible {
      add(.heat0, .heat, "heli_heat_bay", chain: 0, kind: nil, uniforms: [])
      add(.heat1, .plume, "heli_heat_plume", chain: 0, kind: nil, uniforms: [])
      add(.heat2, .heat, "heli_heat_bay", chain: 1, kind: nil, uniforms: [])
      add(.heat3, .plume, "heli_heat_plume", chain: 1, kind: nil, uniforms: [])
    }
    let flareIDs: [ObjectID] = [.flare0, .flare1, .flare2, .flare3]
    for (i, p) in v.flares.enumerated() where i < flareIDs.count && p != nil {
      add(flareIDs[i], .flare, "heli_flare", chain: i, kind: .basic, uniforms: flareMaterial.uniforms(receiveShadow: infos["heli_flare"]!.meta.receiveShadow))
    }
    for (i, r) in v.rafts.enumerated() where i < 2 && r != nil {
      add(i == 0 ? .raft0 : .raft1, .raft, "heli_raft_pack", chain: i, kind: .prop(vertexColors: raftMaterial.vertexColors),
          uniforms: raftMaterial.uniforms(receiveShadow: infos["heli_raft_pack"]!.meta.receiveShadow))
    }

    list.sort()
    // back to the planned draws through the handle (= the draw's index: set before list.add, appended after)
    func sorted(_ it: DrawItem) -> HeliPlannedDraw {
      var d = draws[it.handle]
      d.item = it
      return d
    }
    out.opaque = list.opaque.map(sorted)
    out.transparent = list.transparent.map(sorted)
    return out
  }
}
