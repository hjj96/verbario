// RenderTargets — off-screen targets of the fixed frame graph (PLAN §2.5 «Проходы кадра», D10/D11):
//   sceneColorMSAA  rgba16Float × sampleCount, memoryless on TBDR (absent when sampleCount == 1)
//   sceneDepth      depth32Float (× sampleCount), memoryless on TBDR
//   sceneHDR        rgba16Float resolve target (input of Composite+Output)
//   post            rgba16Float display-referred frame (ACES + sRGB applied; input of FinalPass)
// Allocated at the full internal resolution of the quality tier; dynamic resolution renders into
// a viewport sub-rectangle (Renderer.viewport) so nothing is reallocated while it moves.
import Metal

public final class RenderTargets {
  public let width: Int
  public let height: Int
  public let sampleCount: Int
  public let sceneColorMSAA: MTLTexture?
  public let sceneDepth: MTLTexture
  public let sceneHDR: MTLTexture
  public let post: MTLTexture

  public static let hdrFormat: MTLPixelFormat = .rgba16Float
  public static let depthFormat: MTLPixelFormat = .depth32Float
  public static let postFormat: MTLPixelFormat = .rgba16Float

  public init(device rd: RenderDevice, width w: Int, height h: Int, sampleCount: Int) throws {
    let width = max(1, w)
    let height = max(1, h)
    self.width = width
    self.height = height
    self.sampleCount = sampleCount
    let dev = rd.device
    let transientStorage: MTLStorageMode = rd.supportsMemoryless ? .memoryless : .private

    func make(_ format: MTLPixelFormat, samples: Int, usage: MTLTextureUsage, storage: MTLStorageMode, label: String) throws -> MTLTexture {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: width, height: height, mipmapped: false)
      if samples > 1 {
        d.textureType = .type2DMultisample
        d.sampleCount = samples
      }
      d.usage = usage
      d.storageMode = storage
      guard let t = dev.makeTexture(descriptor: d) else { throw RenderError.resource(label) }
      t.label = label
      return t
    }

    if sampleCount > 1 {
      sceneColorMSAA = try make(RenderTargets.hdrFormat, samples: sampleCount, usage: [.renderTarget], storage: transientStorage, label: "MAYDAY.sceneMSAA")
    } else {
      sceneColorMSAA = nil
    }
    sceneDepth = try make(RenderTargets.depthFormat, samples: sampleCount, usage: [.renderTarget], storage: transientStorage, label: "MAYDAY.sceneDepth")
    sceneHDR = try make(RenderTargets.hdrFormat, samples: 1, usage: [.renderTarget, .shaderRead], storage: .private, label: "MAYDAY.sceneHDR")
    post = try make(RenderTargets.postFormat, samples: 1, usage: [.renderTarget, .shaderRead], storage: .private, label: "MAYDAY.post")
  }

  public func matches(width w: Int, height h: Int, sampleCount n: Int) -> Bool {
    width == max(1, w) && height == max(1, h) && sampleCount == n
  }

  /// Scene pass: MSAA colour resolved into sceneHDR (or sceneHDR directly), cleared to the fog
  /// colour (three: scene.background = fog colour, linear working space), depth cleared to 1.
  public func scenePassDescriptor(clear: SIMD3<Float>) -> MTLRenderPassDescriptor {
    let rp = MTLRenderPassDescriptor()
    let c = rp.colorAttachments[0]!
    if let msaa = sceneColorMSAA {
      c.texture = msaa
      c.resolveTexture = sceneHDR
      c.storeAction = .multisampleResolve
    } else {
      c.texture = sceneHDR
      c.storeAction = .store
    }
    c.loadAction = .clear
    c.clearColor = MTLClearColor(red: Double(clear.x), green: Double(clear.y), blue: Double(clear.z), alpha: 1)
    let d = rp.depthAttachment!
    d.texture = sceneDepth
    d.loadAction = .clear
    d.clearDepth = 1
    d.storeAction = .dontCare
    return rp
  }

  /// Composite+Output pass into `post` (only the dynres sub-rect is drawn; no clear needed).
  public func postPassDescriptor() -> MTLRenderPassDescriptor {
    let rp = MTLRenderPassDescriptor()
    let c = rp.colorAttachments[0]!
    c.texture = post
    c.loadAction = .dontCare
    c.storeAction = .store
    return rp
  }
}
