// SyntheticGoldenTests — the post passes and the env bake on fixed inputs against the web's own pass
// objects (Tests/Goldens/synthetic/passes.json, render-goldens.mjs --browser; PLAN §5.5):
//   output   Composite+Output (bloom off) ↔ three OutputPass (ACES Filmic × exposure, sRGB) of an HDR ramp
//   bloom    BloomPass + Composite+Output ↔ post.js ScaledBloomPass added onto the scene target, then OutputPass
//   final    FinalPass ↔ post/finalShader.js (post.final) on an LDR image, the eight presets' grades + pulses
//   pmrem    EnvironmentProbe bake ↔ weather/env.js PMREM cube-UV atlas (half floats, GL row order)
// Tolerances: PLAN §5.1 «GPU-кадры, синтетические входы» (see passes.json). GPU only: skips without Metal.
import XCTest
import Metal
import MaydayCore
import MaydayShaderTypes
@testable import MaydayApp

/// The input formulas of render-goldens.mjs SYNTH (x right, y = GL row from the bottom), all exact in half.
enum SyntheticInputs {
  static func hdrRamp(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> SIMD3<Float> {
    SIMD3<Float>(Float(x) / 128, Float(y) / 64, Float((x * y) % 97) / 64)
  }

  static func spots(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> SIMD3<Float> {
    let s: [(Int, Int, SIMD3<Float>)] = [(40, 30, SIMD3(6, 3, 1.5)), (128, 72, SIMD3(2, 4, 8)), (200, 110, SIMD3(5, 5, 5))]
    for (cx, cy, c) in s where (x - cx) * (x - cx) + (y - cy) * (y - cy) <= 36 { return c }
    return SIMD3<Float>(0.0625, 0.125, 0.1875)
  }

  static func ldr(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> SIMD3<Float> {
    SIMD3<Float>(Float((x * 255) / (w - 1)) / 256, Float((y * 255) / (h - 1)) / 256, Float((x * y + 7 * x) % 256) / 256)
  }

  /// IEEE binary16 bits of a Float (round to nearest even; the inputs above are exact anyway).
  static func halfBits(_ v: Float) -> UInt16 {
    let b = v.bitPattern
    let sign = UInt16((b >> 16) & 0x8000)
    let exp = Int((b >> 23) & 0xFF) - 127 + 15
    var man = b & 0x7F_FFFF
    if exp >= 31 { return sign | 0x7C00 }
    if exp <= 0 {
      if exp < -10 { return sign }
      man |= 0x80_0000
      let shift = UInt32(14 - exp)
      var h = man >> shift
      let rem = man & ((1 << shift) - 1), half = UInt32(1) << (shift - 1)
      if rem > half || (rem == half && (h & 1) == 1) { h += 1 }
      return sign | UInt16(h)
    }
    var h = UInt32(exp) << 10 | (man >> 13)
    let rem = man & 0x1FFF
    if rem > 0x1000 || (rem == 0x1000 && (h & 1) == 1) { h += 1 }
    return sign | UInt16(h)
  }

  /// RGBA half texels, Metal row 0 = top (= GL row h − 1), alpha 1.
  static func texels(_ w: Int, _ h: Int, _ f: (Int, Int, Int, Int) -> SIMD3<Float>) -> [UInt16] {
    var out = [UInt16](repeating: 0, count: w * h * 4)
    for row in 0..<h {
      for x in 0..<w {
        let c = f(x, h - 1 - row, w, h)
        let i = (row * w + x) * 4
        out[i] = halfBits(c.x); out[i + 1] = halfBits(c.y); out[i + 2] = halfBits(c.z); out[i + 3] = halfBits(1)
      }
    }
    return out
  }
}

final class SyntheticGoldenTests: XCTestCase {
  private struct GPU {
    let device: MTLDevice
    let renderer: Renderer
    let ring: FrameRing
  }

  private func gpu() throws -> GPU {
    let device = try requireMetalDevice()
    let data = try DataBundle()
    let renderer = try Renderer(device: device, texturesDirectory: data.texturesDirectory, oceanConstants: .web)
    return GPU(device: device, renderer: renderer, ring: try FrameRing(device: device))
  }

  private func upload(_ halfs: [UInt16], to tex: MTLTexture, _ g: GPU, _ cb: MTLCommandBuffer) throws {
    let len = halfs.count * 2
    guard let buf = halfs.withUnsafeBytes({ g.device.makeBuffer(bytes: $0.baseAddress!, length: len, options: [.storageModeShared]) }),
          let blit = cb.makeBlitCommandEncoder() else { throw RenderError.resource("test upload") }
    blit.copy(from: buf, sourceOffset: 0, sourceBytesPerRow: tex.width * 8, sourceBytesPerImage: len,
              sourceSize: MTLSize(width: tex.width, height: tex.height, depth: 1), to: tex, destinationSlice: 0, destinationLevel: 0,
              destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.endEncoding()
  }

  /// Blit of a whole texture into a shared buffer (bytesPerPixel 8 = rgba16Float, 4 = bgra8 / rgba8).
  private func readback(_ tex: MTLTexture, bytesPerPixel: Int, _ g: GPU, _ cb: MTLCommandBuffer) throws -> MTLBuffer {
    let len = tex.width * tex.height * bytesPerPixel
    guard let buf = g.device.makeBuffer(length: len, options: [.storageModeShared]), let blit = cb.makeBlitCommandEncoder() else {
      throw RenderError.resource("test readback")
    }
    blit.copy(from: tex, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
              sourceSize: MTLSize(width: tex.width, height: tex.height, depth: 1), to: buf, destinationOffset: 0,
              destinationBytesPerRow: tex.width * bytesPerPixel, destinationBytesPerImage: len)
    blit.endEncoding()
    return buf
  }

  private func run(_ g: GPU, _ body: (MTLCommandBuffer) throws -> Void) throws {
    g.ring.beginFrame()
    guard let cb = g.renderer.device.queue.makeCommandBuffer() else {
      g.ring.abandonFrame()
      throw RenderError.resource("test command buffer")
    }
    do { try body(cb) } catch {
      g.ring.signal(on: cb)
      cb.commit()
      throw error
    }
    g.ring.signal(on: cb)
    cb.commit()
    cb.waitUntilCompleted()
    if let e = cb.error { throw RenderError.resource("GPU: \(e.localizedDescription)") }
  }

  /// rgba16Float buffer → RGBA8 like the web readback (round(v·255), clamped).
  private func image8(_ buf: MTLBuffer, _ w: Int, _ h: Int) -> RGBAImage {
    let p = buf.contents().bindMemory(to: UInt16.self, capacity: w * h * 4)
    let px = (0..<(w * h * 4)).map { UInt8(max(0, min(255, (Renderer.halfToFloat(p[$0]) * 255).rounded()))) }
    return RGBAImage(width: w, height: h, rgba8: px)
  }

  private func check(_ mine: RGBAImage, _ webFile: String, _ what: String, strict: Bool) throws {
    let web = try PNG.read(try Goldens.url(webFile))
    let d = ImageMetrics.compare(mine, web)
    let review = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("MaydayGoldens/synthetic", isDirectory: true)
    try PNG.write(mine, to: review.appendingPathComponent("\(what)-metal.png"))
    try PNG.write(web, to: review.appendingPathComponent("\(what)-web.png"))
    XCTAssertLessThanOrEqual(d.meanAbs, 0.5, "\(what): \(d)")
    if strict {
      XCTAssertLessThanOrEqual(d.maxAbs, 3, "\(what): \(d)")
    } else {
      let a = mine.rgba8, b = web.rgba8
      var over = 0
      for i in 0..<a.count where i % 4 != 3 && abs(Int(a[i]) - Int(b[i])) > 3 { over += 1 }
      XCTAssertLessThanOrEqual(Double(over), 0.01 * Double(a.count / 4 * 3), "\(what): \(over) samples over 3/255; \(d)")
    }
  }

  /// CPU checks (no GPU): the inputs are exact in half float, and a Float transcription of Output.metal
  /// (three's ACESFilmicToneMapping + sRGBTransferOETF) over SyntheticInputs reproduces the web's OutputPass
  /// images — so the input formulas, their row order and the tone-mapping constants agree with the web.
  func testInputsAndOutputFormulas() throws {
    let d = try Goldens.data("synthetic/passes.json")
    let size = try d["size"].nums()
    let w = Int(size[0]), h = Int(size[1])
    for f in [SyntheticInputs.hdrRamp, SyntheticInputs.spots, SyntheticInputs.ldr] {
      for y in 0..<h {
        for x in 0..<w {
          let c = f(x, y, w, h)
          for k in 0..<3 { XCTAssertEqual(Renderer.halfToFloat(SyntheticInputs.halfBits(c[k])), c[k]) }
        }
      }
    }
    func aces(_ c0: SIMD3<Float>, _ exposure: Float) -> SIMD3<Float> {
      var c = c0 * (exposure / 0.6)
      c = SIMD3<Float>(0.59719 * c.x + 0.35458 * c.y + 0.04823 * c.z,
                       0.07600 * c.x + 0.90834 * c.y + 0.01566 * c.z,
                       0.02840 * c.x + 0.13383 * c.y + 0.83777 * c.z)
      let a = c * (c + 0.0245786) - 0.000090537
      let b = c * (0.983729 * c + 0.4329510) + 0.238081
      c = a / b
      c = SIMD3<Float>(1.60475 * c.x - 0.53108 * c.y - 0.07367 * c.z,
                       -0.10208 * c.x + 1.10813 * c.y - 0.00605 * c.z,
                       -0.00327 * c.x - 0.07276 * c.y + 1.07602 * c.z)
      return SIMD3<Float>(min(max(c.x, 0), 1), min(max(c.y, 0), 1), min(max(c.z, 0), 1))
    }
    func oetf(_ v: Float) -> Float { v <= 0.0031308 ? v * 12.92 : pow(v, 0.41666) * 1.055 - 0.055 }
    for o in try d["output"].requireArray() {
      let e = Float(try o["exposure"].num())
      let web = try PNG.read(try Goldens.url("synthetic/" + URL(fileURLWithPath: try o["image"].requireString()).lastPathComponent))
      var px = [UInt8](repeating: 255, count: w * h * 4)
      for row in 0..<h {
        for x in 0..<w {
          let c = aces(SyntheticInputs.hdrRamp(x, h - 1 - row, w, h), e)
          for k in 0..<3 {
            let v = Float(Renderer.halfToFloat(SyntheticInputs.halfBits(oetf(c[k]))))   // the half-float target
            px[(row * w + x) * 4 + k] = UInt8(max(0, min(255, (v * 255).rounded())))
          }
        }
      }
      let diff = ImageMetrics.compare(RGBAImage(width: w, height: h, rgba8: px), web)
      XCTAssertLessThanOrEqual(diff.maxAbs, 2, "CPU ACES vs web OutputPass @\(e): \(diff)")
      XCTAssertLessThanOrEqual(diff.meanAbs, 0.1, "CPU ACES vs web OutputPass @\(e): \(diff)")
    }
  }

  func testOutputAndBloom() throws {
    let g = try gpu()
    let d = try Goldens.data("synthetic/passes.json")
    let size = try d["size"].nums()
    let w = Int(size[0]), h = Int(size[1])
    let rt = try RenderTargets(device: g.renderer.device, width: w, height: h, sampleCount: 1)
    let vp = MTLViewport(originX: 0, originY: 0, width: Double(w), height: Double(h), znear: 0, zfar: 1)
    let pso = try g.renderer.post.compositePipeline()
    for o in try d["output"].requireArray() {
      let e = try o["exposure"].num()
      var post: MTLBuffer?
      try run(g) { cb in
        try upload(SyntheticInputs.texels(w, h, SyntheticInputs.hdrRamp), to: rt.sceneHDR, g, cb)
        g.renderer.post.encodeComposite(cb, pipeline: pso, targets: rt, viewport: vp, ring: g.ring, exposure: Float(e), bloom: nil)
        post = try readback(rt.post, bytesPerPixel: 8, g, cb)
      }
      try check(image8(post!, w, h), "synthetic/" + URL(fileURLWithPath: try o["image"].requireString()).lastPathComponent,
                "output_\(e)", strict: true)
    }
    for b in try d["bloom"].requireArray() {
      var post: MTLBuffer?
      try run(g) { cb in
        try upload(SyntheticInputs.texels(w, h, SyntheticInputs.spots), to: rt.sceneHDR, g, cb)
        let tex = try g.renderer.bloom.encode(cb, ring: g.ring, scene: rt.sceneHDR, viewportWidth: w, viewportHeight: h,
                                              scale: try b["scale"].num(), strength: Float(try b["strength"].num()),
                                              radius: Float(try b["radius"].num()), threshold: Float(try b["threshold"].num()))
        g.renderer.post.encodeComposite(cb, pipeline: pso, targets: rt, viewport: vp, ring: g.ring, exposure: 1, bloom: tex)
        post = try readback(rt.post, bytesPerPixel: 8, g, cb)
      }
      try check(image8(post!, w, h), "synthetic/" + URL(fileURLWithPath: try b["image"].requireString()).lastPathComponent,
                "bloom_\(b["name"].string ?? "")", strict: true)
    }
  }

  func testFinalPass() throws {
    let g = try gpu()
    let d = try Goldens.data("synthetic/passes.json")
    let size = try d["size"].nums()
    let w = Int(size[0]), h = Int(size[1])
    let rt = try RenderTargets(device: g.renderer.device, width: w, height: h, sampleCount: 1)
    let vp = MTLViewport(originX: 0, originY: 0, width: Double(w), height: Double(h), znear: 0, zfar: 1)
    let fmt = g.renderer.post.drawableFormat
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: fmt, width: w, height: h, mipmapped: false)
    desc.usage = [.renderTarget, .shaderRead]
    desc.storageMode = .private
    guard let target = g.device.makeTexture(descriptor: desc) else { throw RenderError.resource("final target") }
    let pso = try g.renderer.post.finalPipeline()
    for c in try d["final"].requireArray() {
      let input = try GoldenScene.finalPass(c["uniforms"])
      var out: MTLBuffer?
      try run(g) { cb in
        try upload(SyntheticInputs.texels(w, h, SyntheticInputs.ldr), to: rt.post, g, cb)
        g.renderer.post.encodeFinal(cb, pipeline: pso, target: target, source: rt, sourceViewport: vp, ring: g.ring, input: input, pxScale: 1)
        out = try readback(target, bytesPerPixel: 4, g, cb)
      }
      let p = out!.contents().bindMemory(to: UInt8.self, capacity: w * h * 4)
      let bgra = fmt == .bgra8Unorm
      var px = [UInt8](repeating: 0, count: w * h * 4)
      for i in 0..<(w * h) {
        px[i * 4] = p[i * 4 + (bgra ? 2 : 0)]
        px[i * 4 + 1] = p[i * 4 + 1]
        px[i * 4 + 2] = p[i * 4 + (bgra ? 0 : 2)]
        px[i * 4 + 3] = p[i * 4 + 3]
      }
      try check(RGBAImage(width: w, height: h, rgba8: px), "synthetic/" + URL(fileURLWithPath: try c["image"].requireString()).lastPathComponent,
                "final_\(c["name"].string ?? "")", strict: false)
    }
  }

  func testPmremAtlas() throws {
    let g = try gpu()
    let d = try Goldens.data("synthetic/passes.json")
    // texels the bake writes: lod 0 (3·128 × 2·128 at the origin) and every GGX lod's 3f × 2f block
    var regions: [(x: Int, y: Int, w: Int, h: Int)] = [(0, 0, 3 * Int(MD_CUBEUV_SIZE), 2 * Int(MD_CUBEUV_SIZE))]
    for l in EnvironmentProbe.lods { regions.append((l.x, l.y, 3 * l.size, 2 * l.size)) }
    for p in try d["pmrem"].requireArray() {
      let u = p["uniforms"]
      let params = EnvSkyParams(sky: try GoldenScene.f3(u["uSky"]), fog: try GoldenScene.f3(u["uFog"]), deep: try GoldenScene.f3(u["uDeep"]),
                                sunDir: try GoldenScene.f3(u["uSunDir"]), sunColor: try GoldenScene.f3(u["uSunColor"]),
                                sunIntensity: try GoldenScene.f(u["uSunI"]), cloud: try GoldenScene.f(u["uCloud"]))
      var out: MTLBuffer?
      try run(g) { cb in
        try g.renderer.environment.encodeBake(cb, params: params)
        out = try readback(g.renderer.environment.atlas, bytesPerPixel: 8, g, cb)
      }
      let web = try PNG.read(try Goldens.url("synthetic/" + URL(fileURLWithPath: try p["image"].requireString()).lastPathComponent))
      let w = web.width
      XCTAssertEqual(w, Int(MD_CUBEUV_WIDTH))
      XCTAssertEqual(web.height, Int(MD_CUBEUV_HEIGHT))
      let mine = out!.contents().bindMemory(to: UInt16.self, capacity: w * web.height * 4)
      var total = 0, bad = 0, sumRel = 0.0, worst = 0.0
      for r in regions {
        for y in r.y..<(r.y + r.h) {
          for x in r.x..<(r.x + r.w) {
            for c in 0..<3 {
              let i = (y * w + x) * 4 + c        // both atlases keep GL row order (row 0 = v 0)
              let a = Double(Renderer.halfToFloat(mine[i])), b = Double(Renderer.halfToFloat(web.samples[i]))
              let rel = abs(a - b) / max(1, abs(b))
              total += 1
              sumRel += rel
              worst = max(worst, rel)
              if rel > 0.02 { bad += 1 }
            }
          }
        }
      }
      let preset = p["preset"].string ?? ""
      XCTAssertLessThanOrEqual(Double(bad), 0.01 * Double(total), "pmrem \(preset): \(bad)/\(total) texels off by > 2 %, worst \(worst)")
      XCTAssertLessThan(sumRel / Double(total), 0.005, "pmrem \(preset): mean relative error")
    }
  }
}
