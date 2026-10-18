// HeliRenderer — «Чайка-07» as a render family (PLAN §2.9 systems/heli.js row, §3.3 #28–33, M3):
//   opaque       hull + rotor hub (Hull.metal: MeshPhysical + clearcoat + weathering), hoist operator,
//                flotation bags, rescue basket, rescue swimmer, raft packs (HeliProps.metal MeshStandard),
//                flare embers (MeshBasic), winch cable (Cable.metal);
//   transparent  reach ring (renderOrder 3, Ring.metal), main + tail rotor veils (4, Rotor.metal), bulbs and
//                halos (5, Lights.metal, additive), searchlight shaft (6, Cone.metal, additive);
//   shadow       castShadow objects (hull, hub, crew, bags, basket, swimmer, rafts) and, when the sun's shadow
//                camera sees layer 1 (quality high), the shadow-only real blades (stroboscopic rotor shadow);
//   thermal      `thermalItems`: the heat sources (layer 2: crew, engine bays, exhaust plumes, flares) and the
//                airframe's thermal mass (layer 3) for the FLIR pass (post/thermal.js, PLAN §2.5 pass 3).
// Input: `update(_:)` with a HeliRenderSnapshot of MaydayCore's Helicopter after its update (nil = no heli).
// Transforms follow three.js: matrixWorld = parent.matrixWorld × compose(position, quaternion, scale), in
// Double with MaydayCore's three math; the static nodes come from the meshes' baked chains, the animated ones
// (root / body matrices, rotor pivot tilt, hub and blade angles, bag scale, crew pose, basket, swimmer, cone,
// flares, rafts) from the snapshot. Draw order inside the family is three's (RenderList: opaque by
// renderOrder, material, z, id; transparent by renderOrder, z ↓, id), object / material ids in the web's
// construction order. Frustum culling uses the baked geometry.boundingSphere, frustumCulled as in the web.
import Foundation
import Metal
import simd
import MaydayCore
import MaydayShaderTypes

/// One object of the thermal pass (systems/post/thermal.js: heat on layer 2, thermal mass on layer 3).
public struct HeliThermalItem {
  public let mesh: MMesh
  public let model: simd_double4x4
  public let heat: Float
  public let thermalMass: Float
  public let layers: RenderLayers
}

public final class HeliRenderer: RenderFamily {
  private enum Draw {
    case hull(MMesh)
    case prop(MMesh, vertexColors: Bool)
    case basic(MMesh)
    case cable
    case ring
    case rotor(MMesh)
    case lights
    case cone
  }

  private struct Command {
    var draw: Draw
    var object: MDObjectData
    var material: Int            // ring offset of the uniform block
    var culling: FaceCulling
    var depthWrite: Bool
    var blend: BlendMode
  }

  private struct Caster {
    var mesh: MMesh
    var model: Mat4
    var object: MDObjectData
    var layers: RenderLayers
    var culling: FaceCulling     // material side (ShadowPass.cullMode swaps it like WebGLShadowMap)
    var frustumCulled: Bool
  }

  // ids in the web's construction order (Object3D.id / Material.id: only their relative order matters)
  private enum ObjectID: Int {
    case hull = 1, lights, hub, rotor, tail, blades, float0, float1, cable, basket, rescuer, ring, cone
    case crewBody, crewArm, crewHead, heat0, heat1, heat2, heat3, flare0, flare1, flare2, flare3, raft0, raft1
  }
  private enum MaterialID: Int {
    case hull = 1, lights, rotor, tail, blades, float, cable, basket, rescuer, ring, cone, crew, heat, plume, flare, raft
  }

  private let rd: RenderDevice
  private let cache: PipelineCache
  private let shadowPass: ShadowPass
  private let look: LookResources
  public let meshes: HeliMeshes
  private let depthWrite: MTLDepthStencilState
  private let depthRead: MTLDepthStencilState
  private let decal: MTLTexture
  private let decalSampler: MTLSamplerState

  private let hullMaterial: HeliHullMaterial
  private let rotorMain: HeliRotorMaterial
  private let rotorMainLow: HeliRotorMaterial
  private let rotorTail: HeliRotorMaterial
  private let lightsMaterial: HeliLightsMaterial
  private let coneMaterial: HeliConeMaterial
  private let cableMaterial: HeliCableMaterial
  private let ringMaterial: HeliRingMaterial
  private let crewMaterial: HeliPropMaterialParams
  private let floatMaterial: HeliPropMaterialParams
  private let basketMaterial: HeliPropMaterialParams
  private let rescuerMaterial: HeliPropMaterialParams
  private let raftMaterial: HeliPropMaterialParams
  private let flareMaterial: HeliPropMaterialParams

  public private(set) var snapshot: HeliRenderSnapshot?
  public private(set) var thermalItems: [HeliThermalItem] = []
  private var opaque: [Command] = []
  private var transparent: [Command] = []
  private var casters: [Caster] = []
  private let list = RenderList()

  /// decal: the livery atlas (heli/decals.js drawDecals, 1024 × 512, rgba8Unorm_srgb, mipmapped) once
  /// bake-canvas produces heli_livery.png; nil = a transparent placeholder (decal patches show the paint).
  public init(renderer: Renderer, meshes: HeliMeshes, decal: MTLTexture? = nil) throws {
    rd = renderer.device
    cache = renderer.pipelineCache
    shadowPass = renderer.shadow
    look = renderer.look
    self.meshes = meshes
    guard let dw = cache.depth(compare: .lessEqual, write: true), let dr = cache.depth(compare: .lessEqual, write: false) else {
      throw RenderError.resource("heli depth states")
    }
    depthWrite = dw
    depthRead = dr
    if let d = decal {
      self.decal = d
    } else {
      let up = TextureUploader(device: rd)
      self.decal = try up.texture(bytes: [UInt8](repeating: 0, count: 64), width: 4, height: 4, format: .rgba8Unorm,
                                  bytesPerPixel: 4, mipmapped: false, label: "heli.decalNone")
      try up.finish()
    }
    // look.canvasTexture: CanvasTexture defaults (clamp, linear, mipmap linear) + anisotropy 4
    let sd = MTLSamplerDescriptor()
    sd.sAddressMode = .clampToEdge
    sd.tAddressMode = .clampToEdge
    sd.minFilter = .linear
    sd.magFilter = .linear
    sd.mipFilter = .linear
    sd.maxAnisotropy = 4
    sd.label = "heli.decal"
    guard let s = rd.device.makeSamplerState(descriptor: sd) else { throw RenderError.resource("heli decal sampler") }
    decalSampler = s

    hullMaterial = try HeliHullMaterial(meta: meshes.hull.meta)
    rotorMain = try HeliRotorMaterial(meta: meshes.rotorMain.meta)
    rotorMainLow = try HeliRotorMaterial(meta: meshes.rotorMainLow.meta)
    rotorTail = try HeliRotorMaterial(meta: meshes.rotorTail.meta)
    lightsMaterial = try HeliLightsMaterial(meta: meshes.lights.meta)
    coneMaterial = try HeliConeMaterial(meta: meshes.cone.meta)
    cableMaterial = try HeliCableMaterial(meta: meshes.cable.meta)
    ringMaterial = try HeliRingMaterial(meta: meshes.ring.meta)
    crewMaterial = try HeliPropMaterialParams(meta: meshes.crewBody.meta)
    floatMaterial = try HeliPropMaterialParams(meta: meshes.float.meta)
    basketMaterial = try HeliPropMaterialParams(meta: meshes.basket.meta)
    rescuerMaterial = try HeliPropMaterialParams(meta: meshes.rescuer.meta)
    raftMaterial = try HeliPropMaterialParams(meta: meshes.raftPack.meta)
    flareMaterial = try HeliPropMaterialParams(meta: meshes.flare.meta)
  }

  /// The frame's helicopter (nil: nothing is drawn).
  public func update(_ s: HeliRenderSnapshot?) {
    snapshot = s
  }

  /// Read by the Renderer before prepare(): the hull always casts when there is a helicopter.
  public var castsShadows: Bool { snapshot != nil }

  // ---- transforms ---------------------------------------------------------------------------------------

  /// matrixWorld of chain `i` of a mesh: root / body from the snapshot, then every node below
  /// (static from the baked chain unless `animate` replaces the node by role).
  private func world(_ mesh: MMesh, chain i: Int = 0, _ s: HeliRenderSnapshot,
                     animate: (inout MMeshNode) -> Void = { _ in }) -> Mat4 {
    var m = Mat4()
    for var node in mesh.meta.chains[min(i, mesh.meta.chains.count - 1)] {
      switch node.role {
      case "root": m = s.visual.rootMatrix
      case "body": m = s.visual.bodyMatrix
      default:
        animate(&node)
        var w = Mat4()
        w.multiplyMatrices(m, node.matrix)
        m = w
      }
    }
    return m
  }

  private static func quat(_ x: Double, _ y: Double, _ z: Double) -> Quat {
    var q = Quat()
    q.setFromEuler(Euler(x, y, z))
    return q
  }

  /// heli.js _visuals: the rotor pivot tilts 0.3 × the body, the hub / shadow blades turn about y.
  private func rotorPivot(_ s: HeliRenderSnapshot) -> (inout MMeshNode) -> Void {
    let v = s.visual
    return { n in
      switch n.role {
      case "rotorPivot": n.quaternion = HeliRenderer.quat(v.pitch * 0.3, 0, -v.bank * 0.3)
      case "hub": n.quaternion = HeliRenderer.quat(0, v.hubAngle, 0)
      case "blades": n.quaternion = HeliRenderer.quat(0, v.shadowBladesAngle, 0)
      default: break
      }
    }
  }

  private static func objectData(_ m: Mat4, heat: Double?, mass: Double?, layers: UInt32) -> MDObjectData {
    var o = StandardFamily.objectData(CameraMatrices.toDouble(m))
    o.heatMassLayer = SIMD4<Float>(Float(heat ?? 0), Float(mass ?? 0), Float(layers), 0)
    return o
  }

  // ---- per-frame lists ------------------------------------------------------------------------------------

  public func prepare(_ ctx: FrameContext) throws {
    opaque.removeAll(keepingCapacity: true)
    transparent.removeAll(keepingCapacity: true)
    casters.removeAll(keepingCapacity: true)
    thermalItems.removeAll(keepingCapacity: true)
    list.reset()
    guard let s = snapshot else { return }
    let ring = ctx.ring
    let viewProjGL = ctx.camera.projGL * ctx.camera.view   // three projScreenMatrix
    let frustum = Frustum(viewProjGL: viewProjGL)
    var commands: [Command] = []

    // adds one object: main-pass draw item (layers / frustum test, three's sort keys), shadow caster,
    // thermal item; `uniforms` nil = the object is not drawn by the main camera (shadow / thermal only)
    func add(_ id: ObjectID, _ mat: MaterialID, _ mesh: MMesh, _ model: Mat4, draw: Draw?, uniforms: [SIMD4<Float>]?,
             castShadow: Bool? = nil) {
      let meta = mesh.meta
      let object = HeliRenderer.objectData(model, heat: meta.heat, mass: meta.thermalMass, layers: meta.layers)
      let md = CameraMatrices.toDouble(model)
      if let draw, let uniforms {
        var item = DrawItem(id: id.rawValue, materialID: mat.rawValue)
        item.renderOrder = meta.renderOrder
        item.transparent = meta.material["transparent"].bool ?? false
        item.layers = RenderLayers(rawValue: meta.layers)
        item.frustumCulled = meta.frustumCulled
        // world bounding sphere: centre × matrixWorld, radius × max axis scale (three Sphere.applyMatrix4)
        var c = V3(mesh.boundsCenter.x, mesh.boundsCenter.y, mesh.boundsCenter.z)
        c.applyMatrix4(model)
        item.center = SIMD3<Double>(c.x, c.y, c.z)
        item.radius = mesh.boundsRadius * model.getMaxScaleOnAxis()
        item.handle = commands.count
        let blend: BlendMode = meta.material["blending"].string == "additive" ? .additive : (item.transparent ? .alpha : .opaque)
        commands.append(Command(draw: draw, object: object, material: ring.push(array: uniforms), culling: heliCulling(meta),
                                depthWrite: meta.material["depthWrite"].bool ?? true, blend: blend))
        list.add(item, viewProjGL: viewProjGL, frustum: frustum)
      }
      if castShadow ?? meta.castShadow {
        casters.append(Caster(mesh: mesh, model: model, object: object, layers: RenderLayers(rawValue: meta.layers),
                              culling: heliCulling(meta), frustumCulled: meta.frustumCulled))
      }
      if meta.heat != nil || meta.thermalMass != nil {
        thermalItems.append(HeliThermalItem(mesh: mesh, model: md, heat: Float(meta.heat ?? 0), thermalMass: Float(meta.thermalMass ?? 0),
                                            layers: RenderLayers(rawValue: meta.layers)))
      }
    }

    let v = s.visual
    let m = meshes
    let pivot = rotorPivot(s)
    // heli/model.js: hull, lights, hub, rotors, shadow blades, flotation bags
    add(.hull, .hull, m.hull, world(m.hull, s), draw: .hull(m.hull), uniforms: hullMaterial.uniforms(s, receiveShadow: m.hull.meta.receiveShadow))
    add(.lights, .lights, m.lights, world(m.lights, s), draw: .lights, uniforms: lightsMaterial.uniforms(s))
    add(.hub, .hull, m.hub, world(m.hub, s, animate: pivot), draw: .hull(m.hub), uniforms: hullMaterial.uniforms(s, receiveShadow: m.hub.meta.receiveShadow))
    let disc = s.lowQuality ? m.rotorMainLow : m.rotorMain
    let discMat = s.lowQuality ? rotorMainLow : rotorMain
    add(.rotor, .rotor, disc, world(disc, s, animate: pivot), draw: .rotor(disc), uniforms: discMat.uniforms(v.rotor, v.veil))
    add(.tail, .tail, m.rotorTail, world(m.rotorTail, s), draw: .rotor(m.rotorTail), uniforms: rotorTail.uniforms(v.tail, v.veil))
    if v.shadowBladesVisible {   // layer 1 only: never drawn by the main camera; castShadow on high
      add(.blades, .blades, m.blades, world(m.blades, s, animate: pivot), draw: nil, uniforms: nil, castShadow: true)
    }
    if v.floatsVisible {
      for i in 0..<min(2, m.float.meta.chains.count) {
        let model = world(m.float, chain: i, s) { n in if n.role == "float" { n.scale = v.floatScale } }
        add(i == 0 ? .float0 : .float1, .float, m.float, model, draw: .prop(m.float, vertexColors: floatMaterial.vertexColors),
            uniforms: floatMaterial.uniforms(receiveShadow: m.float.meta.receiveShadow))
      }
    }
    // heli/winch.js: cable, basket, rescue swimmer, reach ring (world space)
    let w = s.winch
    if w.cableVisible {
      add(.cable, .cable, m.cable, Mat4(), draw: .cable, uniforms: cableMaterial.uniforms(w))
    }
    if w.basketVisible {
      let model = world(m.basket, s) { n in n.position = w.basketPosition; n.quaternion = w.basketQuaternion }
      add(.basket, .basket, m.basket, model, draw: .prop(m.basket, vertexColors: basketMaterial.vertexColors),
          uniforms: basketMaterial.uniforms(receiveShadow: m.basket.meta.receiveShadow))
    }
    if w.rescuerVisible {
      let model = world(m.rescuer, s) { n in n.position = w.rescuerPosition; n.quaternion = w.rescuerQuaternion }
      add(.rescuer, .rescuer, m.rescuer, model, draw: .prop(m.rescuer, vertexColors: rescuerMaterial.vertexColors),
          uniforms: rescuerMaterial.uniforms(receiveShadow: m.rescuer.meta.receiveShadow))
    }
    if w.ringVisible {
      add(.ring, .ring, m.ring, Mat4(), draw: .ring, uniforms: ringMaterial.uniforms(w))
    }
    // heli/searchlight.js: the shaft proxy
    let c = s.cone
    if c.visible {
      let model = world(m.cone, s) { n in n.position = c.position; n.quaternion = c.quaternion; n.scale = c.scale }
      add(.cone, .cone, m.cone, model, draw: .cone, uniforms: coneMaterial.uniforms(c))
    }
    // heli/crewman.js: the hoist operator (child of the body)
    let crew = s.crew
    if crew.visible {
      let pose: (inout MMeshNode) -> Void = { n in
        switch n.role {
        case "crewman": n.position = crew.position
        case "crewArm": n.quaternion = crew.arm
        case "crewHead": n.quaternion = crew.head
        default: break
        }
      }
      for (id, mesh) in [(ObjectID.crewBody, m.crewBody), (.crewArm, m.crewArm), (.crewHead, m.crewHead)] {
        add(id, .crew, mesh, world(mesh, s, animate: pose), draw: .prop(mesh, vertexColors: crewMaterial.vertexColors),
            uniforms: crewMaterial.uniforms(receiveShadow: mesh.meta.receiveShadow))
      }
    }
    // systems/heli.js: thermal heat proxies (layer 2 only), flares in flight, packed rafts in free fall
    if v.heatVisible {
      for i in 0..<min(2, m.heatBay.meta.chains.count) {
        add(i == 0 ? .heat0 : .heat2, .heat, m.heatBay, world(m.heatBay, chain: i, s), draw: nil, uniforms: nil)
      }
      for i in 0..<min(2, m.heatPlume.meta.chains.count) {
        add(i == 0 ? .heat1 : .heat3, .plume, m.heatPlume, world(m.heatPlume, chain: i, s), draw: nil, uniforms: nil)
      }
    }
    let flareIDs: [ObjectID] = [.flare0, .flare1, .flare2, .flare3]
    for (i, p) in v.flares.enumerated() where i < flareIDs.count {
      guard let p else { continue }
      let model = world(m.flare, chain: i, s) { n in n.position = p }
      add(flareIDs[i], .flare, m.flare, model, draw: .basic(m.flare), uniforms: flareMaterial.uniforms(receiveShadow: false))
    }
    for (i, r) in v.rafts.enumerated() where i < 2 {
      guard let r else { continue }
      let model = world(m.raftPack, chain: i, s) { n in
        n.position = r.position
        n.quaternion = HeliRenderer.quat(r.rotation.x, r.rotation.y, r.rotation.z)
      }
      add(i == 0 ? .raft0 : .raft1, .raft, m.raftPack, model, draw: .prop(m.raftPack, vertexColors: raftMaterial.vertexColors),
          uniforms: raftMaterial.uniforms(receiveShadow: m.raftPack.meta.receiveShadow))
    }

    list.sort()
    opaque = list.opaque.map { commands[$0.handle] }
    transparent = list.transparent.map { commands[$0.handle] }

    // compile what this frame draws (PipelineCache remembers failures)
    let shadows = ctx.shadowMap != nil, env = ctx.environment != nil
    for cmd in opaque + transparent { _ = try pipeline(cmd, sampleCount: ctx.sampleCount, shadows: shadows, env: env) }
    for c in casters { _ = try depthPipeline(c.mesh) }
  }

  // ---- pipelines -------------------------------------------------------------------------------------------

  private static let hullAttributes = ["position": HeliShaderLayout.attrPosition, "normal": HeliShaderLayout.attrNormal,
                                       "uv": HeliShaderLayout.attrUV, "color": HeliShaderLayout.attrColor, "aSurf": HeliShaderLayout.attrSurf]
  private static let lightsAttributes = ["position": HeliShaderLayout.attrPosition, "aCorner": HeliShaderLayout.attrCorner,
                                         "aChan": HeliShaderLayout.attrChan, "aSize": HeliShaderLayout.attrSize, "aColor": HeliShaderLayout.attrColor]
  private static let positionOnly = ["position": HeliShaderLayout.attrPosition]
  private static let cableAttributes = ["aSide": HeliShaderLayout.attrSide, "aDir": HeliShaderLayout.attrDir, "aV": HeliShaderLayout.attrV]
  private static let ringAttributes = ["aAng": HeliShaderLayout.attrAng, "aEdge": HeliShaderLayout.attrEdge]

  private static func propAttributes(_ vertexColors: Bool) -> [String: Int] {
    var a = ["position": HeliShaderLayout.attrPosition, "normal": HeliShaderLayout.attrNormal]
    if vertexColors { a["color"] = HeliShaderLayout.attrColor }
    return a
  }

  /// three blending (premultipliedAlpha false): Normal = (SRC_ALPHA, 1 − SRC_ALPHA | ONE, 1 − SRC_ALPHA),
  /// Additive = (SRC_ALPHA, ONE) for colour and alpha.
  private static func setBlend(_ a: MTLRenderPipelineColorAttachmentDescriptor, _ mode: BlendMode) {
    switch mode {
    case .alpha:
      a.isBlendingEnabled = true
      a.sourceRGBBlendFactor = .sourceAlpha
      a.destinationRGBBlendFactor = .oneMinusSourceAlpha
      a.sourceAlphaBlendFactor = .one
      a.destinationAlphaBlendFactor = .oneMinusSourceAlpha
    case .additive:
      a.isBlendingEnabled = true
      a.sourceRGBBlendFactor = .sourceAlpha
      a.destinationRGBBlendFactor = .one
      a.sourceAlphaBlendFactor = .sourceAlpha
      a.destinationAlphaBlendFactor = .one
    default:
      a.isBlendingEnabled = false
    }
  }

  private func build(_ key: String, vs: String, fs: String, mesh: MMesh, attributes: [String: Int], sampleCount: Int,
                     blend: BlendMode, constants: MTLFunctionConstantValues? = nil) throws -> MTLRenderPipelineState {
    try cache.render(key: "\(key)[\(mesh.layoutKey(attributes))]b\(blend.rawValue)x\(sampleCount)") {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction(vs, constants: constants)
      d.fragmentFunction = try rd.makeFunction(fs, constants: constants)
      d.vertexDescriptor = try mesh.vertexDescriptor(attributes)
      d.colorAttachments[0].pixelFormat = RenderTargets.hdrFormat
      HeliRenderer.setBlend(d.colorAttachments[0], blend)
      d.depthAttachmentPixelFormat = RenderTargets.depthFormat
      d.rasterSampleCount = sampleCount
      return d
    }
  }

  private static func constants(shadows: Bool, env: Bool, vertexColors: Bool? = nil) -> MTLFunctionConstantValues {
    let fc = MTLFunctionConstantValues()
    var sh = shadows, en = env
    fc.setConstantValue(&sh, type: .bool, index: Int(MD_FC_SHADOWS))
    fc.setConstantValue(&en, type: .bool, index: Int(MD_FC_STD_ENV))
    if var vc = vertexColors { fc.setConstantValue(&vc, type: .bool, index: HeliShaderLayout.fcVertexColor) }
    return fc
  }

  private func pipeline(_ c: Command, sampleCount: Int, shadows: Bool, env: Bool) throws -> MTLRenderPipelineState {
    let m = meshes
    switch c.draw {
    case .hull(let mesh):
      return try build("heli.hull.s\(shadows ? 1 : 0)e\(env ? 1 : 0)", vs: "hull_vs", fs: "hull_fs", mesh: mesh,
                       attributes: HeliRenderer.hullAttributes, sampleCount: sampleCount, blend: c.blend,
                       constants: HeliRenderer.constants(shadows: shadows, env: env))
    case .prop(let mesh, let vc):
      return try build("heli.prop.s\(shadows ? 1 : 0)e\(env ? 1 : 0)c\(vc ? 1 : 0)", vs: "heli_prop_vs", fs: "heli_prop_fs", mesh: mesh,
                       attributes: HeliRenderer.propAttributes(vc), sampleCount: sampleCount, blend: c.blend,
                       constants: HeliRenderer.constants(shadows: shadows, env: env, vertexColors: vc))
    case .basic(let mesh):
      return try build("heli.basic", vs: "heli_basic_vs", fs: "heli_basic_fs", mesh: mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: c.blend)
    case .cable:
      return try build("heli.cable", vs: "cable_vs", fs: "cable_fs", mesh: m.cable,
                       attributes: HeliRenderer.cableAttributes, sampleCount: sampleCount, blend: c.blend)
    case .ring:
      return try build("heli.ring", vs: "ring_vs", fs: "ring_fs", mesh: m.ring,
                       attributes: HeliRenderer.ringAttributes, sampleCount: sampleCount, blend: c.blend)
    case .rotor(let mesh):
      return try build("heli.rotor", vs: "rotor_vs", fs: "rotor_fs", mesh: mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: c.blend)
    case .lights:
      return try build("heli.lights", vs: "heli_lights_vs", fs: "heli_lights_fs", mesh: m.lights,
                       attributes: HeliRenderer.lightsAttributes, sampleCount: sampleCount, blend: c.blend)
    case .cone:
      return try build("heli.cone", vs: "cone_vs", fs: "cone_fs", mesh: m.cone,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: c.blend)
    }
  }

  private func depthPipeline(_ mesh: MMesh) throws -> MTLRenderPipelineState {
    try shadowPass.depthPipeline(vertexDescriptor: try mesh.vertexDescriptor(HeliRenderer.positionOnly),
                                 layoutKey: "mmesh:" + mesh.layoutKey(HeliRenderer.positionOnly), instanced: false)
  }

  // ---- encoding --------------------------------------------------------------------------------------------

  public func encodeShadow(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext, pass: ShadowPassContext) {
    guard snapshot != nil else { return }
    enc.pushDebugGroup("heli.shadow")
    for c in casters {
      // WebGLShadowMap: layers.test(shadow camera), visible (already filtered), frustum test when frustumCulled
      if c.layers.intersection(pass.layers).isEmpty { continue }
      if c.frustumCulled {
        var p = V3(c.mesh.boundsCenter.x, c.mesh.boundsCenter.y, c.mesh.boundsCenter.z)
        p.applyMatrix4(c.model)
        if !pass.frustum.intersects(center: SIMD3<Double>(p.x, p.y, p.z), radius: c.mesh.boundsRadius * c.model.getMaxScaleOnAxis()) { continue }
      }
      guard let pso = try? depthPipeline(c.mesh) else { continue }
      enc.setRenderPipelineState(pso)
      enc.setCullMode(ShadowPass.cullMode(for: c.culling))
      var o = c.object
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      c.mesh.draw(enc)
    }
    enc.popDebugGroup()
  }

  private func bindShared(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {
    let buf = ctx.ring.buffer
    for (offset, index) in [(ctx.frameOffset, MD_BUF_FRAME), (ctx.lookOffset, MD_BUF_LOOK), (ctx.lightsOffset, MD_BUF_LIGHTS)] {
      enc.setVertexBuffer(buf, offset: offset, index: Int(index))
      enc.setFragmentBuffer(buf, offset: offset, index: Int(index))
    }
    enc.setFrontFacing(.counterClockwise)
    enc.setFragmentTexture(look.atlas, index: Int(MD_TEX_ATLAS))
    enc.setFragmentTexture(look.dfgLUT, index: Int(MD_TEX_DFG))
    enc.setFragmentTexture(decal, index: HeliShaderLayout.texDecal)
    if let e = ctx.environment { enc.setFragmentTexture(e, index: Int(MD_TEX_ENV)) }
    if let s = ctx.shadowMap { enc.setFragmentTexture(s, index: Int(MD_TEX_SHADOW)) }
    enc.setFragmentSamplerState(look.samplerLook, index: Int(MD_SMP_LOOK))
    enc.setFragmentSamplerState(look.samplerClamp, index: Int(MD_SMP_CLAMP))
    enc.setFragmentSamplerState(ctx.shadowSampler, index: Int(MD_SMP_SHADOW))
    enc.setFragmentSamplerState(decalSampler, index: HeliShaderLayout.samplerDecal)
  }

  private func encode(_ cmds: [Command], _ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {
    let shadows = ctx.shadowMap != nil, env = ctx.environment != nil
    for c in cmds {
      guard let pso = try? pipeline(c, sampleCount: ctx.sampleCount, shadows: shadows, env: env) else { continue }
      enc.setRenderPipelineState(pso)
      enc.setDepthStencilState(c.depthWrite ? depthWrite : depthRead)
      switch c.culling {
      case .back: enc.setCullMode(.back)
      case .front: enc.setCullMode(.front)
      case .none: enc.setCullMode(.none)
      }
      var o = c.object
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      enc.setVertexBuffer(ctx.ring.buffer, offset: c.material, index: Int(MD_BUF_MATERIAL))
      enc.setFragmentBuffer(ctx.ring.buffer, offset: c.material, index: Int(MD_BUF_MATERIAL))
      switch c.draw {
      case .hull(let mesh), .prop(let mesh, _), .basic(let mesh), .rotor(let mesh): mesh.draw(enc)
      case .cable: meshes.cable.draw(enc)
      case .ring: meshes.ring.draw(enc)
      case .lights: meshes.lights.draw(enc)
      case .cone: meshes.cone.draw(enc)
      }
    }
  }

  public func encodeOpaque(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {
    guard !opaque.isEmpty else { return }
    enc.pushDebugGroup("heli.opaque")
    bindShared(enc, ctx)
    encode(opaque, enc, ctx)
    enc.popDebugGroup()
  }

  public func encodeTransparent(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {
    guard !transparent.isEmpty else { return }
    enc.pushDebugGroup("heli.transparent")
    bindShared(enc, ctx)
    encode(transparent, enc, ctx)
    enc.popDebugGroup()
  }
}
