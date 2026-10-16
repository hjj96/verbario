// StandardFamily — plain MeshStandardMaterial meshes (PLAN §3.3 #20, Shaders/Common/Standard.metal): the
// family for debris, raft packs, dolphins … and the lighting probe of the render goldens (the web's
// Helicopter stub box, BoxGeometry(3, 2, 10) #FF5A2A). Items are drawn in three's opaque order
// (RenderList: renderOrder, material, z, id); castShadow items also go into the sun's depth pass.
// Also: ThreeBoxGeometry — three r185 BoxGeometry (buildPlane order: +x, −x, +y, −y, +z, −z), so a box
// has the web's vertices, normals, uvs and triangle winding.
import Foundation
import Metal
import simd
import MaydayCore
import MaydayShaderTypes

/// three r185 BoxGeometry(width, height, depth, 1, 1, 1): positions, normals, uvs, indices.
public enum ThreeBoxGeometry {
  public static func make(width: Double, height: Double, depth: Double) -> (positions: [Float], normals: [Float], uvs: [Float], indices: [UInt32]) {
    var positions: [Float] = [], normals: [Float] = [], uvs: [Float] = [], indices: [UInt32] = []
    var vertexCounter: UInt32 = 0
    // buildPlane(u, v, w, udir, vdir, width, height, depth, gridX = 1, gridY = 1)
    func plane(_ u: Int, _ v: Int, _ w: Int, _ udir: Double, _ vdir: Double, _ pw: Double, _ ph: Double, _ pd: Double) {
      let gridX = 1, gridY = 1
      let segmentWidth = pw / Double(gridX), segmentHeight = ph / Double(gridY)
      let widthHalf = pw / 2, heightHalf = ph / 2, depthHalf = pd / 2
      let gridX1 = gridX + 1, gridY1 = gridY + 1
      for iy in 0..<gridY1 {
        let y = Double(iy) * segmentHeight - heightHalf
        for ix in 0..<gridX1 {
          let x = Double(ix) * segmentWidth - widthHalf
          var p = [0.0, 0.0, 0.0]
          p[u] = x * udir
          p[v] = y * vdir
          p[w] = depthHalf
          positions += p.map { Float($0) }
          var n = [0.0, 0.0, 0.0]
          n[w] = pd > 0 ? 1 : -1
          normals += n.map { Float($0) }
          uvs += [Float(Double(ix) / Double(gridX)), Float(1 - Double(iy) / Double(gridY))]
        }
      }
      for iy in 0..<gridY {
        for ix in 0..<gridX {
          let a = vertexCounter + UInt32(ix + gridX1 * iy)
          let b = vertexCounter + UInt32(ix + gridX1 * (iy + 1))
          let c = vertexCounter + UInt32((ix + 1) + gridX1 * (iy + 1))
          let d = vertexCounter + UInt32((ix + 1) + gridX1 * iy)
          indices += [a, b, d, b, c, d]
        }
      }
      vertexCounter += UInt32(gridX1 * gridY1)
    }
    let x = 0, y = 1, z = 2
    plane(z, y, x, -1, -1, depth, height, width)    // px
    plane(z, y, x, 1, -1, depth, height, -width)    // nx
    plane(x, z, y, 1, 1, width, depth, height)      // py
    plane(x, z, y, 1, -1, width, depth, -height)    // ny
    plane(x, y, z, 1, -1, width, height, depth)     // pz
    plane(x, y, z, -1, -1, width, height, -depth)   // nz
    return (positions, normals, uvs, indices)
  }

  public static func mesh(device: MTLDevice, width: Double, height: Double, depth: Double, label: String = "box") throws -> MeshBuffer {
    let g = make(width: width, height: height, depth: depth)
    return try MeshBuffer(device: device, label: label,
                          streams: [VertexStream(.position, components: 3, data: g.positions),
                                    VertexStream(.normal, components: 3, data: g.normals),
                                    VertexStream(.uv, components: 2, data: g.uvs)],
                          indices: g.indices)
  }
}

/// One MeshStandardMaterial mesh instance.
public struct StandardItem {
  public var mesh: MeshBuffer
  public var model: simd_double4x4                   // matrixWorld
  public var color = SIMD3<Float>(1, 1, 1)           // linear (THREE.Color working space)
  public var opacity: Float = 1
  public var emissive = SIMD3<Float>(0, 0, 0)        // × emissiveIntensity
  public var roughness: Float = 1                    // MeshStandardMaterial defaults
  public var metalness: Float = 0
  public var side: FaceCulling = .back               // FrontSide
  public var castShadow = false
  public var receiveShadow = false
  public var renderOrder = 0
  public var id: Int

  public init(id: Int, mesh: MeshBuffer, model: simd_double4x4) {
    self.id = id
    self.mesh = mesh
    self.model = model
  }
}

public final class StandardFamily: RenderFamily {
  private let rd: RenderDevice
  private let cache: PipelineCache
  private let shadowPass: ShadowPass
  private let depthState: MTLDepthStencilState
  public var items: [StandardItem] = []

  public init(renderer: Renderer) throws {
    rd = renderer.device
    cache = renderer.pipelineCache
    shadowPass = renderer.shadow
    guard let ds = cache.depth(compare: .lessEqual, write: true) else { throw RenderError.resource("standard depth state") }
    depthState = ds
  }

  public var castsShadows: Bool { items.contains { $0.castShadow } }

  static func layoutKey(_ mesh: MeshBuffer) -> String {
    mesh.elements.map { "\($0.attribute.index):\($0.components)@\($0.offset)" }.joined(separator: ",") + "/\(mesh.stride)"
  }

  private func pipeline(_ mesh: MeshBuffer, sampleCount: Int, shadows: Bool, env: Bool, doubleSided: Bool) throws -> MTLRenderPipelineState {
    let key = "standard[\(StandardFamily.layoutKey(mesh))]s\(shadows ? 1 : 0)e\(env ? 1 : 0)d\(doubleSided ? 1 : 0)x\(sampleCount)"
    return try cache.render(key: key) {
      let fc = MTLFunctionConstantValues()
      var inst = false, sh = shadows, en = env, ds = doubleSided
      fc.setConstantValue(&inst, type: .bool, index: Int(MD_FC_STD_INSTANCED))
      fc.setConstantValue(&sh, type: .bool, index: Int(MD_FC_SHADOWS))
      fc.setConstantValue(&en, type: .bool, index: Int(MD_FC_STD_ENV))
      fc.setConstantValue(&ds, type: .bool, index: Int(MD_FC_STD_DOUBLE_SIDED))
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try rd.makeFunction("standard_vs", constants: fc)
      d.fragmentFunction = try rd.makeFunction("standard_fs", constants: fc)
      d.vertexDescriptor = mesh.vertexDescriptor()
      d.colorAttachments[0].pixelFormat = RenderTargets.hdrFormat
      d.depthAttachmentPixelFormat = RenderTargets.depthFormat
      d.rasterSampleCount = sampleCount
      return d
    }
  }

  static func objectData(_ m: simd_double4x4) -> MDObjectData {
    var o = MDObjectData()
    o.model = CameraMatrices.toFloat(m)
    // normalMatrix (world): inverse-transpose of the upper 3×3 (three Matrix3.getNormalMatrix)
    let inv = m.inverse
    let it = simd_double4x4(columns: (SIMD4<Double>(inv.columns.0.x, inv.columns.1.x, inv.columns.2.x, 0),
                                      SIMD4<Double>(inv.columns.0.y, inv.columns.1.y, inv.columns.2.y, 0),
                                      SIMD4<Double>(inv.columns.0.z, inv.columns.1.z, inv.columns.2.z, 0),
                                      SIMD4<Double>(0, 0, 0, 1)))
    o.normalMatrix = CameraMatrices.toFloat(it)
    o.heatMassLayer = SIMD4<Float>(0, 0, 1, 0)
    return o
  }

  private var sorted: [StandardItem] {
    items.sorted { a, b in
      if a.renderOrder != b.renderOrder { return a.renderOrder < b.renderOrder }
      return a.id < b.id
    }
  }

  public func prepare(_ ctx: FrameContext) throws {
    for it in items {
      _ = try pipeline(it.mesh, sampleCount: ctx.sampleCount, shadows: ctx.shadowMap != nil, env: ctx.environment != nil,
                       doubleSided: it.side == .none)
      if it.castShadow {
        _ = try shadowPass.depthPipeline(vertexDescriptor: it.mesh.vertexDescriptor(), layoutKey: StandardFamily.layoutKey(it.mesh), instanced: false)
      }
    }
  }

  public func encodeShadow(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext, pass: ShadowPassContext) {
    for it in sorted where it.castShadow {
      guard let pso = try? shadowPass.depthPipeline(vertexDescriptor: it.mesh.vertexDescriptor(), layoutKey: StandardFamily.layoutKey(it.mesh),
                                                     instanced: false) else { continue }
      enc.setRenderPipelineState(pso)
      enc.setCullMode(ShadowPass.cullMode(for: it.side))
      var o = StandardFamily.objectData(it.model)
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      it.mesh.draw(enc)
    }
  }

  public func encodeOpaque(_ enc: MTLRenderCommandEncoder, _ ctx: FrameContext) {
    let shadows = ctx.shadowMap != nil
    let env = ctx.environment != nil
    enc.pushDebugGroup("standard")
    enc.setDepthStencilState(depthState)
    enc.setFrontFacing(.counterClockwise)
    enc.setVertexBuffer(ctx.ring.buffer, offset: ctx.frameOffset, index: Int(MD_BUF_FRAME))
    enc.setVertexBuffer(ctx.ring.buffer, offset: ctx.lightsOffset, index: Int(MD_BUF_LIGHTS))
    enc.setFragmentBuffer(ctx.ring.buffer, offset: ctx.frameOffset, index: Int(MD_BUF_FRAME))
    enc.setFragmentBuffer(ctx.ring.buffer, offset: ctx.lightsOffset, index: Int(MD_BUF_LIGHTS))
    enc.setFragmentTexture(ctx.look.dfgLUT, index: Int(MD_TEX_DFG))
    if let e = ctx.environment { enc.setFragmentTexture(e, index: Int(MD_TEX_ENV)) }
    if let s = ctx.shadowMap { enc.setFragmentTexture(s, index: Int(MD_TEX_SHADOW)) }
    enc.setFragmentSamplerState(ctx.look.samplerClamp, index: Int(MD_SMP_CLAMP))
    enc.setFragmentSamplerState(ctx.shadowSampler, index: Int(MD_SMP_SHADOW))
    for it in sorted where it.opacity >= 1 {
      guard let pso = try? pipeline(it.mesh, sampleCount: ctx.sampleCount, shadows: shadows, env: env,
                                    doubleSided: it.side == .none) else { continue }
      enc.setRenderPipelineState(pso)
      switch it.side {
      case .back: enc.setCullMode(.back)
      case .front: enc.setCullMode(.front)
      case .none: enc.setCullMode(.none)
      }
      var o = StandardFamily.objectData(it.model)
      var m = MDStandardMaterial(color: SIMD4<Float>(it.color.x, it.color.y, it.color.z, it.opacity),
                                 emissive: SIMD4<Float>(it.emissive.x, it.emissive.y, it.emissive.z, 0),
                                 params: SIMD4<Float>(it.roughness, it.metalness, it.receiveShadow ? 1 : 0,
                                                      it.side == .front ? 1 : 0))
      enc.setVertexBytes(&o, length: MemoryLayout<MDObjectData>.stride, index: Int(MD_BUF_OBJECT))
      enc.setVertexBytes(&m, length: MemoryLayout<MDStandardMaterial>.stride, index: Int(MD_BUF_MATERIAL))
      enc.setFragmentBytes(&m, length: MemoryLayout<MDStandardMaterial>.stride, index: Int(MD_BUF_MATERIAL))
      it.mesh.draw(enc)
    }
    enc.popDebugGroup()
  }
}
