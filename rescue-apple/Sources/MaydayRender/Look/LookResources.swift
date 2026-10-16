// LookResources — GPU copies of the look textures and the shared samplers (PLAN §2.9 core/look.js row).
//
//   atlas.rgba  256² RGBA8 (seed 7)   R fbm (histogram-matched gradient noise), G worley F1, B F2−F1, A hash
//   detail.rgba 256² RGBA8 (seed 10)  RG slopes (0.5 = flat), B height
//   lace.rgba   512² RGBA8 (seed 18)  R lace, G blotches, B fine lace
//   dfg_lut.rg16f 16² RG16F           three r185 DFG LUT (tools/export/export-render.mjs)
// Raw files exported from the web (Resources/Textures, row 0 = v 0 like three's DataTexture with
// flipY = false, which is also Metal's row 0 = t 0). Mips: full chain generated on the GPU (WebGL
// generateMipmap box filter equivalent), LinearMipmapLinear, repeat.
//
// Samplers (ShaderTypes.h MD_SMP_*): look.* textures use anisotropy 2 (look.js dataTex); the ocean's
// copies of uAtlas / uLace use anisotropy 1, its uDetail copy anisotropy 2 (ocean/material.js).
import Foundation
import Metal

public final class LookResources {
  public let atlas: MTLTexture
  public let detail: MTLTexture
  public let lace: MTLTexture
  public let dfgLUT: MTLTexture
  /// 1×1 R8 = 255: "far from any coast" (ocean/material.js coastPlaceholder).
  public let coastPlaceholder: MTLTexture
  /// 1×1 RGBA16F zero: water memory / drops / heat stand-in until those passes exist.
  public let blackRGBA16F: MTLTexture

  public let samplerLook: MTLSamplerState
  public let samplerOcean: MTLSamplerState
  public let samplerClamp: MTLSamplerState
  public let samplerNearest: MTLSamplerState

  /// Directory with atlas.rgba, detail.rgba, lace.rgba, dfg_lut.rg16f (bundle Resources/Textures).
  public init(device rd: RenderDevice, texturesDirectory dir: URL) throws {
    let dev = rd.device
    let uploader = TextureUploader(device: rd)
    atlas = try uploader.texture(file: dir.appendingPathComponent("atlas.rgba"), width: 256, height: 256,
                                 format: .rgba8Unorm, bytesPerPixel: 4, mipmapped: true, label: "look.atlas")
    detail = try uploader.texture(file: dir.appendingPathComponent("detail.rgba"), width: 256, height: 256,
                                  format: .rgba8Unorm, bytesPerPixel: 4, mipmapped: true, label: "look.detail")
    lace = try uploader.texture(file: dir.appendingPathComponent("lace.rgba"), width: 512, height: 512,
                                format: .rgba8Unorm, bytesPerPixel: 4, mipmapped: true, label: "look.lace")
    dfgLUT = try uploader.texture(file: dir.appendingPathComponent("dfg_lut.rg16f"), width: 16, height: 16,
                                  format: .rg16Float, bytesPerPixel: 4, mipmapped: false, label: "three.dfgLUT")
    coastPlaceholder = try uploader.texture(bytes: [255], width: 1, height: 1, format: .r8Unorm, bytesPerPixel: 1,
                                            mipmapped: false, label: "ocean.coastNone")
    blackRGBA16F = try uploader.texture(bytes: [UInt8](repeating: 0, count: 8), width: 1, height: 1, format: .rgba16Float,
                                        bytesPerPixel: 8, mipmapped: false, label: "black16F")
    try uploader.finish()

    func sampler(_ label: String, address: MTLSamplerAddressMode, filter: MTLSamplerMinMagFilter,
                 mip: MTLSamplerMipFilter, anisotropy: Int) throws -> MTLSamplerState {
      let d = MTLSamplerDescriptor()
      d.sAddressMode = address
      d.tAddressMode = address
      d.minFilter = filter
      d.magFilter = filter
      d.mipFilter = mip
      d.maxAnisotropy = anisotropy
      d.label = label
      guard let s = dev.makeSamplerState(descriptor: d) else { throw RenderError.resource("sampler \(label)") }
      return s
    }
    samplerLook = try sampler("look", address: .repeat, filter: .linear, mip: .linear, anisotropy: 2)
    samplerOcean = try sampler("ocean", address: .repeat, filter: .linear, mip: .linear, anisotropy: 1)
    samplerClamp = try sampler("clamp", address: .clampToEdge, filter: .linear, mip: .notMipmapped, anisotropy: 1)
    samplerNearest = try sampler("nearest", address: .clampToEdge, filter: .nearest, mip: .notMipmapped, anisotropy: 1)
  }
}

/// Uploads CPU bytes into .private textures through one staging blit (works on every Apple GPU,
/// including Macs where shared textures are not allowed), generating mips where requested.
final class TextureUploader {
  private let rd: RenderDevice
  private let commandBuffer: MTLCommandBuffer
  private let blit: MTLBlitCommandEncoder
  private var staging: [MTLBuffer] = []

  init(device rd: RenderDevice) {
    self.rd = rd
    // makeCommandBuffer / makeBlitCommandEncoder only fail when the device is lost.
    commandBuffer = rd.queue.makeCommandBuffer()!
    commandBuffer.label = "MAYDAY.upload"
    blit = commandBuffer.makeBlitCommandEncoder()!
  }

  func texture(file: URL, width: Int, height: Int, format: MTLPixelFormat, bytesPerPixel: Int,
               mipmapped: Bool, label: String) throws -> MTLTexture {
    let data: Data
    do { data = try Data(contentsOf: file) } catch { throw RenderError.resource("\(label): \(file.lastPathComponent) missing") }
    guard data.count == width * height * bytesPerPixel else {
      throw RenderError.resource("\(label): \(data.count) bytes, expected \(width * height * bytesPerPixel)")
    }
    return try texture(bytes: [UInt8](data), width: width, height: height, format: format,
                       bytesPerPixel: bytesPerPixel, mipmapped: mipmapped, label: label)
  }

  func texture(bytes: [UInt8], width: Int, height: Int, format: MTLPixelFormat, bytesPerPixel: Int,
               mipmapped: Bool, label: String) throws -> MTLTexture {
    let dev = rd.device
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: width, height: height, mipmapped: mipmapped)
    d.usage = [.shaderRead]
    d.storageMode = .private
    guard let tex = dev.makeTexture(descriptor: d) else { throw RenderError.resource(label) }
    tex.label = label
    let length = bytes.count
    guard let buf = bytes.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let base = raw.baseAddress else { return nil }
      return dev.makeBuffer(bytes: base, length: length, options: [.storageModeShared])
    }) else { throw RenderError.resource("\(label) staging") }
    staging.append(buf)
    blit.copy(from: buf, sourceOffset: 0, sourceBytesPerRow: width * bytesPerPixel,
              sourceBytesPerImage: width * height * bytesPerPixel,
              sourceSize: MTLSize(width: width, height: height, depth: 1),
              to: tex, destinationSlice: 0, destinationLevel: 0,
              destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    if mipmapped { blit.generateMipmaps(for: tex) }
    return tex
  }

  /// Submits the uploads and waits (boot time only).
  func finish() throws {
    blit.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    if let e = commandBuffer.error { throw RenderError.resource("upload: \(e.localizedDescription)") }
    staging.removeAll()
  }
}
