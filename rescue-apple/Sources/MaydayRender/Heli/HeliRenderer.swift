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
// Use: `HeliRenderer(renderer:meshes:)`, `renderer.addFamily(_:)`, then every frame `update(HeliRenderSnapshot(
// heli:quality:))` and put `snapshot.searchlightLight` / `snapshot.bellyLight` into LightsInput spot[0] /
// point[0] (CONTRACT light set).
import Foundation
import Metal
import simd
import MaydayCore
import MaydayShaderTypes

public final class HeliRenderer: RenderFamily {
  private struct Command {
    let draw: HeliPlannedDraw
    let mesh: MMesh
    let material: Int            // ring offset of the uniform block
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
  private var opaque: [Command] = []
  private var transparent: [Command] = []
  private var casters: [HeliPlannedCaster] = []

  /// decal: the livery atlas (heli/decals.js drawDecals, 1024 × 512, rgba8Unorm_srgb, mipmapped, rows flipped
  /// like three's flipY) once bake-canvas produces heli_livery.png; nil = a transparent placeholder (decal
  /// patches show the paint under them, PLAN §10 X15).
  public init(renderer: Renderer, meshes: HeliMeshes, decal: MTLTexture? = nil) throws {
    rd = renderer.device
    cache = renderer.pipelineCache
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

  public func prepare(_ ctx: FrameContext) throws {
    opaque.removeAll(keepingCapacity: true)
    transparent.removeAll(keepingCapacity: true)
    casters.removeAll(keepingCapacity: true)
    thermalItems.removeAll(keepingCapacity: true)
    guard let s = snapshot else { return }
    let plan = planner.plan(s, viewProjGL: ctx.camera.projGL * ctx.camera.view)   // three projScreenMatrix
    func command(_ d: HeliPlannedDraw) -> Command? {
      guard let mesh = meshes[d.mesh] else { return nil }
      return Command(draw: d, mesh: mesh, material: ctx.ring.push(array: d.uniforms))
    }
    opaque = plan.opaque.compactMap(command)
    transparent = plan.transparent.compactMap(command)
    casters = plan.casters
    thermalItems = plan.thermal
    // compile what this frame draws (PipelineCache remembers failures)
    let shadows = ctx.shadowMap != nil, env = ctx.environment != nil
    for c in opaque + transparent { _ = try pipeline(c, sampleCount: ctx.sampleCount, shadows: shadows, env: env) }
    for c in casters { if let m = meshes[c.mesh] { _ = try depthPipeline(m) } }
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
    let blend = c.draw.blend
    let sb = "s\(shadows ? 1 : 0)e\(env ? 1 : 0)"
    switch c.draw.kind {
    case .hull:
      return try build("heli.hull.\(sb)", vs: "hull_vs", fs: "hull_fs", mesh: c.mesh, attributes: HeliRenderer.hullAttributes,
                       sampleCount: sampleCount, blend: blend, constants: HeliRenderer.constants(shadows: shadows, env: env))
    case .prop(let vc):
      return try build("heli.prop.\(sb)c\(vc ? 1 : 0)", vs: "heli_prop_vs", fs: "heli_prop_fs", mesh: c.mesh,
                       attributes: HeliRenderer.propAttributes(vc), sampleCount: sampleCount, blend: blend,
                       constants: HeliRenderer.constants(shadows: shadows, env: env, vertexColors: vc))
    case .basic:
      return try build("heli.basic", vs: "heli_basic_vs", fs: "heli_basic_fs", mesh: c.mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
    case .cable:
      return try build("heli.cable", vs: "cable_vs", fs: "cable_fs", mesh: c.mesh,
                       attributes: HeliRenderer.cableAttributes, sampleCount: sampleCount, blend: blend)
    case .ring:
      return try build("heli.ring", vs: "ring_vs", fs: "ring_fs", mesh: c.mesh,
                       attributes: HeliRenderer.ringAttributes, sampleCount: sampleCount, blend: blend)
    case .rotor:
      return try build("heli.rotor", vs: "rotor_vs", fs: "rotor_fs", mesh: c.mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
    case .lights:
      return try build("heli.lights", vs: "heli_lights_vs", fs: "heli_lights_fs", mesh: c.mesh,
                       attributes: HeliRenderer.lightsAttributes, sampleCount: sampleCount, blend: blend)
    case .cone:
      return try build("heli.cone", vs: "cone_vs", fs: "cone_fs", mesh: c.mesh,
                       attributes: HeliRenderer.positionOnly, sampleCount: sampleCount, blend: blend)
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
      guard let mesh = meshes[c.mesh] else { continue }
      // WebGLShadowMap: layers.test(shadow camera), visible (already filtered), frustum test when frustumCulled
      if c.layers.intersection(pass.layers).isEmpty { continue }
      if c.frustumCulled {
        var p = V3(mesh.boundsCenter.x, mesh.boundsCenter.y, mesh.boundsCenter.z)
        p.applyMatrix4(c.model)
        if !pass.frustum.intersects(center: SIMD3<Double>(p.x, p.y, p.z), radius: mesh.boundsRadius * c.model.getMaxScaleOnAxis()) { continue }
      }
      guard let pso = try? depthPipeline(mesh) else { continue }
      enc.setRenderPipelineState(pso)
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
    let shadows = ctx.shadowMap != nil, env = ctx.environment != nil
    for c in cmds {
      guard let pso = try? pipeline(c, sampleCount: ctx.sampleCount, shadows: shadows, env: env) else { continue }
      enc.setRenderPipelineState(pso)
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
