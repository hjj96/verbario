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
// What is drawn, where and in which order is HeliPlanner's (pure, Linux-checked); this class adds the GPU:
// uniform blocks into the frame ring, PSOs, bindings, draws.
// PSOs resolve once per mesh variant (mesh, kind, blend, sample count, shadows, env) and are kept here, so a
// frame does no vertex-descriptor / key-string work. A PSO that cannot be built (specialisation, vertex
// layout, device) drops only the draws and shadow casters that need it: prepare never throws, the rest of
// the frame (ocean, post, present) goes on, and `lastError` names the first failure for the debug overlay
// (PLAN §10 X20: the app must not fall over because of assets). PipelineCache.resetFailures (prewarm on
// boot / mission setup / quality change) gives failed variants a fresh attempt here too.
// Use: `HeliRenderer(renderer:meshes:)`, `renderer.addFamily(_:)`, then every frame `update(HeliRenderSnapshot(
// heli:quality:))` (quality: the one the helicopter was built with) and put `snapshot.searchlightLight` /
// `snapshot.bellyLight` into LightsInput spot[0] / point[0] (CONTRACT light set).
import Foundation
import Metal
import simd
import MaydayCore
import MaydayShaderTypes

public final class HeliRenderer: RenderFamily {
  private struct Command {
    let draw: HeliPlannedDraw
    let mesh: MMesh
    let pso: MTLRenderPipelineState
    let material: Int            // ring offset of the uniform block
  }

  private struct Caster {
    let caster: HeliPlannedCaster
    let mesh: MMesh
    let pso: MTLRenderPipelineState
  }

  /// Everything a main-pass PSO of a mesh depends on.
  private struct PSOKey: Hashable {
    let mesh: ObjectIdentifier
    let kind: HeliDrawKind
    let blend: BlendMode
    let sampleCount: Int
    let shadows: Bool
    let env: Bool
  }

  private let rd: RenderDevice
  private let cache: PipelineCache
  private let shadowPass: ShadowPass
  private let look: LookResources
  public let meshes: HeliMeshes
  private let planner: HeliPlanner
  private let depthWrite: MTLDepthStencilState
  private let depthRead: MTLDepthStencilState
  private let decal: MTLTexture
  private let decalSampler: MTLSamplerState

  public private(set) var snapshot: HeliRenderSnapshot?
  public private(set) var thermalItems: [HeliThermalItem] = []
  /// The first PSO failure of the last prepare() (its draws were dropped); nil when everything compiled.
  public private(set) var lastError: String?
  private var opaque: [Command] = []
  private var transparent: [Command] = []
  private var casters: [Caster] = []
  // resolved PSOs (the meshes live as long as this renderer, so their identities are stable keys)
  private var psos: [PSOKey: MTLRenderPipelineState] = [:]
  private var depthPSOs: [ObjectIdentifier: MTLRenderPipelineState] = [:]
  private var failedPSOs: [PSOKey: String] = [:]
  private var failedDepth: [ObjectIdentifier: String] = [:]
  private var cacheGeneration: Int

  /// decal: the livery atlas (heli/decals.js drawDecals, 1024 × 512, rgba8Unorm_srgb, mipmapped, rows flipped
  /// like three's flipY) once bake-canvas produces heli_livery.png; nil = a transparent placeholder (decal
  /// patches show the paint under them, PLAN §10 X15).
  public init(renderer: Renderer, meshes: HeliMeshes, decal: MTLTexture? = nil) throws {
    rd = renderer.device
    cache = renderer.pipelineCache
    cacheGeneration = renderer.pipelineCache.generation
    shadowPass = renderer.shadow
    look = renderer.look
    self.meshes = meshes
    planner = try HeliPlanner(infos: meshes.infos)
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
  }

  /// The frame's helicopter (nil: nothing is drawn).
  public func update(_ s: HeliRenderSnapshot?) {
    snapshot = s
  }

  /// Read by the Renderer before prepare(): the hull always casts when there is a helicopter.
  public var castsShadows: Bool { snapshot != nil }

  /// Plans the frame and resolves every draw's PSO. Never throws: a draw whose PSO fails is left out.
  public func prepare(_ ctx: FrameContext) throws {
    opaque.removeAll(keepingCapacity: true)
    transparent.removeAll(keepingCapacity: true)
    casters.removeAll(keepingCapacity: true)
    thermalItems.removeAll(keepingCapacity: true)
    lastError = nil
    if cacheGeneration != cache.generation {   // prewarm: failed variants get one fresh attempt
      failedPSOs.removeAll()
      failedDepth.removeAll()
      cacheGeneration = cache.generation
    }
    guard let s = snapshot else { return }
    let plan = planner.plan(s, viewProjGL: ctx.camera.projGL * ctx.camera.view)   // three projScreenMatrix
    let shadows = ctx.shadowMap != nil, env = ctx.environment != nil
    for d in plan.opaque {
      if let c = command(d, ctx, shadows: shadows, env: env) { opaque.append(c) }
    }
    for d in plan.transparent {
      if let c = command(d, ctx, shadows: shadows, env: env) { transparent.append(c) }
    }
    for c in plan.casters {
      if let m = meshes[c.mesh], let pso = depthPipeline(m) { casters.append(Caster(caster: c, mesh: m, pso: pso)) }
    }
    thermalItems = plan.thermal
  }

  /// One main-pass draw with its PSO and uniform block (nil: no mesh, or its PSO failed).
  private func command(_ d: HeliPlannedDraw, _ ctx: FrameContext, shadows: Bool, env: Bool) -> Command? {
    guard let mesh = meshes[d.mesh] else { return nil }
    let key = PSOKey(mesh: ObjectIdentifier(mesh), kind: d.kind, blend: d.blend, sampleCount: ctx.sampleCount,
                     shadows: shadows, env: env)
    let pso: MTLRenderPipelineState
    if let p = psos[key] {
      pso = p
    } else if let e = failedPSOs[key] {
      note(e)
      return nil
    } else {
      do {
        pso = try pipeline(kind: d.kind, blend: d.blend, mesh: mesh, sampleCount: ctx.sampleCount, shadows: shadows, env: env)
        psos[key] = pso
      } catch {
        let e = "\(d.mesh): \(error)"
        failedPSOs[key] = e
        note(e)
        return nil
      }
    }
    return Command(draw: d, mesh: mesh, pso: pso, material: ctx.ring.push(array: d.uniforms))
  }

  private func note(_ e: String) {
    if lastError == nil { lastError = e }
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

  /// Builds (through PipelineCache) the main-pass PSO of one mesh variant; only on a memo miss.
  private func pipeline(kind: HeliDrawKind, blend: BlendMode, mesh: MMesh, sampleCount: Int, shadows: Bool,
                        env: Bool) throws -> MTLRenderPipelineState {
    let sb = "s\(shadows ? 1 : 0)e\(env ? 1 : 0)"
    switch kind {
    case .hull:
      return try build("heli.hull.\(sb)", vs: "hull_vs", fs: "hull_fs", mesh: mesh, attributes: HeliRenderer.hullAttributes,
                       sampleCount: sampleCount, blend: blend, constants: HeliRenderer.constants(shadows: shadows, env: env))
    case .prop(let vc):
      return try build("heli.prop.\(sb)c\(vc ? 1 : 0)", vs: "heli_prop_vs", fs: "heli_prop_fs", mesh: mesh,
                       attributes: HeliRenderer.propAttributes(vc), sampleCount: sampleCount, blend: blend,
                       constants: HeliRenderer.constants(shadows: shadows, env: env, vertexColors: vc))
    case .basic:
      return try build("heli.basic", vs: "heli_basic_vs", fs: "heli_basic_fs", mesh: mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
    case .cable:
      return try build("heli.cable", vs: "cable_vs", fs: "cable_fs", mesh: mesh,
                       attributes: HeliRenderer.cableAttributes, sampleCount: sampleCount, blend: blend)
    case .ring:
      return try build("heli.ring", vs: "ring_vs", fs: "ring_fs", mesh: mesh,
                       attributes: HeliRenderer.ringAttributes, sampleCount: sampleCount, blend: blend)
    case .rotor:
      return try build("heli.rotor", vs: "rotor_vs", fs: "rotor_fs", mesh: mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
    case .lights:
      return try build("heli.lights", vs: "heli_lights_vs", fs: "heli_lights_fs", mesh: mesh,
                       attributes: HeliRenderer.lightsAttributes, sampleCount: sampleCount, blend: blend)
    case .cone:
      return try build("heli.cone", vs: "cone_vs", fs: "cone_fs", mesh: mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
    }
  }

  /// The shadow-depth PSO of a caster mesh, resolved once per mesh (nil: it failed; noted in lastError).
  private func depthPipeline(_ mesh: MMesh) -> MTLRenderPipelineState? {
    let key = ObjectIdentifier(mesh)
    if let p = depthPSOs[key] { return p }
    if let e = failedDepth[key] {
      note(e)
      return nil
    }
    do {
      let p = try shadowPass.depthPipeline(vertexDescriptor: try mesh.vertexDescriptor(HeliRenderer.positionOnly),
                                           layoutKey: "mmesh:" + mesh.layoutKey(HeliRenderer.positionOnly), instanced: false)
      depthPSOs[key] = p
      return p
    } catch {
      let e = "\(mesh.label) (тень): \(error)"
      failedDepth[key] = e
      note(e)
      return nil
    }
  }

  // ---- encoding --------------------------------------------------------------------------------------------

  public func encodeShadow(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext, pass: ShadowPassContext) {
    guard snapshot != nil else { return }
    enc.pushDebugGroup("heli.shadow")
    for cs in casters {
      let c = cs.caster, mesh = cs.mesh
      // WebGLShadowMap: layers.test(shadow camera), visible (already filtered), frustum test when frustumCulled
      if c.layers.intersection(pass.layers).isEmpty { continue }
      if c.frustumCulled {
        var p = V3(mesh.boundsCenter.x, mesh.boundsCenter.y, mesh.boundsCenter.z)
        p.applyMatrix4(c.model)
        if !pass.frustum.intersects(center: SIMD3<Double>(p.x, p.y, p.z), radius: mesh.boundsRadius * c.model.getMaxScaleOnAxis()) { continue }
      }
      enc.setRenderPipelineState(cs.pso)
      enc.setCullMode(ShadowPass.cullMode(for: c.culling))
      var o = c.object
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      mesh.draw(enc)
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
    for c in cmds {
      enc.setRenderPipelineState(c.pso)
      enc.setDepthStencilState(c.draw.depthWrite ? depthWrite : depthRead)
      switch c.draw.culling {
      case .back: enc.setCullMode(.back)
      case .front: enc.setCullMode(.front)
      case .none: enc.setCullMode(.none)
      }
      var o = c.draw.object
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      enc.setVertexBuffer(ctx.ring.buffer, offset: c.material, index: Int(MD_BUF_MATERIAL))
      enc.setFragmentBuffer(ctx.ring.buffer, offset: c.material, index: Int(MD_BUF_MATERIAL))
      c.mesh.draw(enc)
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
