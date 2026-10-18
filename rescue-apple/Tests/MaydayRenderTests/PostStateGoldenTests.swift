// PostStateGoldenTests — the post.js ports against the real PostFX (Tests/Goldens/post/*, bit for bit):
//   * PostState.update + pulses / event handlers → every FinalPass uniform, exposure, bloom, pulses, seed;
//   * FinalUniformsCPU defaults = createFinalMaterial;
//   * DynResController windows, the composer / main.js pixel-ratio rules;
//   * BloomPass mip sizes, Gaussian coefficients (Float32 uploads) and composite constants.
// CPU only.
import XCTest
import MaydayCore
@testable import MaydayApp

final class PostStateGoldenTests: XCTestCase {
  private static let uniformNames = ["uFlow", "uDrops", "uCondense", "uSalt", "uCA", "uFlash", "uFlashTint", "uEdge", "uVortex",
                                     "uBright", "uSatMul", "uSlope", "uOffset", "uPower", "uContrast", "uSat", "uSplitShadow",
                                     "uSplitHighlight", "uSplitStrength", "uGreen", "uVignette", "uVignetteColor", "uGrain", "uNight",
                                     "uSeed", "uLetterbox", "uDayToe", "uFloor", "uDof", "uDofFocus", "uDofBand", "uDofTaps", "uLookMix",
                                     "uLookSat", "uLookContrast", "uLookFade", "uLookShadow", "uLookHigh", "uThermal", "uThermBoot",
                                     "uThermFlick", "uThermT"]

  /// FinalUniformsCPU by GLSL uniform name (vectors as arrays).
  static func uniforms(_ u: FinalUniformsCPU) -> [String: [Double]] {
    func a2(_ v: SIMD2<Double>) -> [Double] { [v.x, v.y] }
    func a3(_ v: SIMD3<Double>) -> [Double] { [v.x, v.y, v.z] }
    func a4(_ v: SIMD4<Double>) -> [Double] { [v.x, v.y, v.z, v.w] }
    return [
      "uFlow": a2(u.uFlow), "uDrops": [u.uDrops], "uCondense": [u.uCondense], "uSalt": [u.uSalt], "uCA": [u.uCA],
      "uFlash": [u.uFlash], "uFlashTint": a3(u.uFlashTint), "uEdge": a4(u.uEdge), "uVortex": [u.uVortex], "uBright": [u.uBright],
      "uSatMul": [u.uSatMul], "uSlope": a3(u.uSlope), "uOffset": a3(u.uOffset), "uPower": [u.uPower], "uContrast": [u.uContrast],
      "uSat": [u.uSat], "uSplitShadow": a3(u.uSplitShadow), "uSplitHighlight": a3(u.uSplitHighlight),
      "uSplitStrength": [u.uSplitStrength], "uGreen": [u.uGreen], "uVignette": [u.uVignette], "uVignetteColor": a3(u.uVignetteColor),
      "uGrain": [u.uGrain], "uNight": [u.uNight], "uSeed": [u.uSeed], "uLetterbox": [u.uLetterbox], "uDayToe": [u.uDayToe],
      "uFloor": [u.uFloor], "uDof": [u.uDof], "uDofFocus": [u.uDofFocus], "uDofBand": [u.uDofBand], "uDofTaps": [u.uDofTaps],
      "uLookMix": [u.uLookMix], "uLookSat": [u.uLookSat], "uLookContrast": [u.uLookContrast], "uLookFade": [u.uLookFade],
      "uLookShadow": a3(u.uLookShadow), "uLookHigh": a3(u.uLookHigh), "uThermal": [u.uThermal], "uThermBoot": [u.uThermBoot],
      "uThermFlick": [u.uThermFlick], "uThermT": [u.uThermT],
    ]
  }

  private func webUniform(_ j: JSONValue) throws -> [Double] {
    if let d = j.double { return [d] }
    return try j.nums()
  }

  private func assertUniforms(_ u: FinalUniformsCPU, _ web: JSONValue, _ at: String, file: StaticString = #filePath, line: UInt = #line) throws {
    let mine = PostStateGoldenTests.uniforms(u)
    for name in PostStateGoldenTests.uniformNames {
      guard let m = mine[name] else { XCTFail("\(name) not mapped"); continue }
      assertBits(m, try webUniform(web[name]), "\(at) \(name)", file: file, line: line)
    }
  }

  func testFinalMaterialDefaults() throws {
    let files = try Goldens.list("post/state")
    XCTAssertFalse(files.isEmpty)
    let d = try Goldens.data(files[0])
    try assertUniforms(FinalUniformsCPU(), d["defaults"], "createFinalMaterial default")
  }

  private func weatherInput(_ w: JSONValue, palettes: JSONValue) throws -> PostWeatherInput? {
    if w.isNull { return nil }
    let preset = try w["preset"].requireString()
    var st = PostWeatherInput(palette: try goldenPalette(palettes[preset]))
    st.preset = preset
    st.flash = try w["flash"].num()
    st.night = try w["night"].num()
    st.greenTint = try w["greenTint"].num()
    st.flashColor = w["flashColor"].isNull ? nil : try w["flashColor"].color()
    st.fog = try w["fog"].num()
    st.rain = w["rain"].optionalDouble
    st.windDir = w["windDir"].isNull ? nil : try w["windDir"].simd2()
    st.windSpeed = try w["windSpeed"].num()
    st.waveHeight = try w["waveHeight"].num()
    return st
  }

  private func heliInput(_ h: JSONValue) throws -> PostHeliInput? {
    if h.isNull { return nil }
    var o = PostHeliInput()
    o.hull = try h["hull"].num()
    o.fuel = try h["fuel"].num()
    o.alive = h["alive"].bool ?? true
    o.velocity = try h["velocity"].simd2()
    o.altitude = try h["altitude"].num()
    o.landed = h["landed"].bool ?? false
    return o
  }

  private func apply(event e: JSONValue, to post: PostState) throws {
    switch try e["type"].requireString() {
    case "pulse": post.pulse(try e["name"].requireString(), e["strength"].optionalDouble ?? 1)
    case "heli:damage": post.onHeliDamage(source: e["source"].string ?? "", amount: e["amount"].optionalDouble)
    case "weather:lightning": post.onLightning(distance: e["distance"].optionalDouble, cloudOnly: e["cloudOnly"].bool ?? false)
    case "hazard:hit": post.onHazardHit(type: try e["kind"].requireString())
    case let t: XCTFail("unknown event \(t)")
    }
  }

  func testPostFXUpdate() throws {
    var frames = 0
    for file in try Goldens.list("post/state") {
      let d = try Goldens.data(file)
      let c = d["case"]
      let name = try c["name"].requireString()
      let post = PostState(quality: try c["quality"].requireString(), reduceFlashes: c["reduceFlashes"].bool ?? false,
                           reduceMotion: c["reduceMotion"].bool ?? false)
      let bufferHeight = try c["bufferHeight"].num()
      for (fi, f) in try c["frames"].requireArray().enumerated() {
        let at = "\(name) frame \(fi)"
        for e in try f["events"].requireArray() { try apply(event: e, to: post) }
        var input = PostFrameInput(dt: try f["dt"].num())
        input.mode = try f["mode"].requireString()
        input.weather = try weatherInput(f["weather"], palettes: d["palettes"])
        input.heli = try heliInput(f["heli"])
        input.cameraRightXZ = try f["cameraRightXZ"].simd2()
        input.cameraUpXZ = try f["cameraUpXZ"].simd2()
        input.letterbox = try f["letterbox"].num()
        input.thermal.mix = try f["thermal"]["mix"].num()
        input.thermal.boot = try f["thermal"]["boot"].num()
        input.thermal.flick = try f["thermal"]["flick"].num()
        input.bufferHeight = bufferHeight
        post.update(input)
        let o = f["out"]
        try assertUniforms(post.uniforms, o["uniforms"], at)
        assertBits(post.exposure, try o["exposure"].num(), "\(at) exposure")
        assertBits([post.bloomStrength, post.bloomRadius, post.bloomThreshold], try o["bloom"].nums(), "\(at) bloom")
        let p = post.pulses
        let wp = o["pulses"]
        assertBits([p.damage, p.caKick, p.caHold, p.vortex, p.flash, p.after, p.pause, p.salt, p.sprayCd],
                   try ["damage", "caKick", "caHold", "vortex", "flash", "after", "pause", "salt", "sprayCd"].map { try wp[$0].num() },
                   "\(at) pulses")
        assertBits([post.realT, post.seedT, post.seed], [try o["realT"].num(), try o["seedT"].num(), try o["seed"].num()], "\(at) clocks")
        frames += 1
      }
    }
    XCTAssertGreaterThan(frames, 300)
  }

  func testDynamicResolution() throws {
    let d = try Goldens.data("post/dynres.json")
    for (q, v) in try d["MIN_SCALE"].requireObject().entries {
      assertBits(DynResController.MIN_SCALE[q] ?? .nan, try v.num(), "MIN_SCALE \(q)")
    }
    for c in try d["cases"].requireArray() {
      let name = try c["name"].requireString()
      var ctl = DynResController(quality: try c["quality"].requireString())
      let windows = try c["windows"].requireArray()
      var w = 0
      for (i, f) in try c["frames"].requireArray().enumerated() {
        let hint = ctl.update(dt: try f["dt"].num(), paused: f["paused"].bool ?? false, photo: f["photo"].bool ?? false)
        if w < windows.count, try windows[w]["frame"].requireInt() == i {
          let win = windows[w]
          let at = "\(name) window \(w) (frame \(i))"
          assertBits(ctl.frameMs, try win["frameMs"].num(), "\(at) frameMs")
          assertBits(ctl.scale, try win["scale"].num(), "\(at) scale")
          XCTAssertEqual(ctl.atMinScale, win["atMinScale"].bool, at)
          if win["hint"].isNull {
            XCTAssertNil(hint, "\(at): unexpected quality hint")
          } else {
            XCTAssertEqual(hint?.quality, win["hint"]["quality"].string, at)
            XCTAssertEqual(hint?.suggest, win["hint"]["suggest"].string, at)
            assertBits(hint?.frameMs ?? .nan, try win["hint"]["frameMs"].num(), "\(at) hint frameMs")
          }
          w += 1
        } else {
          XCTAssertNil(hint, "\(name) frame \(i): hint outside a window")
        }
      }
      XCTAssertEqual(w, windows.count, "\(name): windows")
    }
    for r in try d["resize"].requireArray() {
      let pr = DynResController.composerPixelRatio(base: try r["prBase"].num(), width: try r["w"].num(), height: try r["h"].num(),
                                                   scale: try r["scale"].num())
      assertBits(pr, try r["pixelRatio"].num(), "resize \(r["w"].int ?? 0)×\(r["h"].int ?? 0)")
    }
    for r in try d["basePixelRatio"].requireArray() {
      let pr = DynResController.basePixelRatio(devicePixelRatio: try r["dpr"].num(), pixelRatioCap: try r["pixelRatioCap"].num(),
                                               width: try r["w"].num(), height: try r["h"].num())
      assertBits(pr, try r["pixelRatio"].num(), "pixelRatio \(r["quality"].string ?? "") \(r["w"].int ?? 0)×\(r["h"].int ?? 0)")
    }
  }

  func testBloomTables() throws {
    let d = try Goldens.data("post/bloom.json")
    XCTAssertEqual(BloomPass.nMips, try d["nMips"].requireInt())
    assertFloat(BloomPass.smoothWidth, try d["smoothWidth"].num(), "smoothWidth")
    let factors = try d["bloomFactors"].nums()
    for (i, f) in BloomPass.bloomFactors.enumerated() { assertFloat(f, factors[i], "bloomFactors[\(i)]") }
    for t in try d["bloomTintColors"].requireArray() { XCTAssertEqual(try t.nums(), [1, 1, 1]) }
    let scale = d["BLOOM_SCALE"]
    for q in ["low", "medium", "high"] {
      let cfg = RenderQualityConfig(name: q, sampleCount: 1, oceanGridN: 160, oceanWaves: 4, oceanQ: 0, oceanGlints: 0, oceanMemory: 0, minDynScale: 1)
      assertBits(cfg.bloomScale, try scale[q].num(), "BLOOM_SCALE \(q)")
    }
    for (i, k) in try d["kernels"].requireArray().enumerated() {
      XCTAssertEqual(BloomPass.kernelSizeArray[i], try k["KERNEL_RADIUS"].requireInt())
      let web = try k["coefficients"].nums()
      XCTAssertEqual(BloomPass.coefficients[i].count, web.count)
      for (j, c) in BloomPass.coefficients[i].enumerated() { assertFloat(c, web[j], "kernel \(i) coefficient \(j)") }
    }
    for s in try d["sizes"].requireArray() {
      let w = try s["width"].requireInt(), h = try s["height"].requireInt(), sc = try s["scale"].num()
      let mips = BloomPass.mipSizes(width: w, height: h, scale: sc)
      let web = try s["mips"].requireArray().map { try $0.nums().map { Int($0) } }
      XCTAssertEqual(mips.map { [$0.width, $0.height] }, web, "\(w)×\(h) @\(sc)")
      XCTAssertEqual([mips[0].width, mips[0].height], try s["bright"].nums().map { Int($0) })
      for (i, inv) in try s["invSize"].requireArray().enumerated() {
        let v = try inv.nums()
        assertFloat(Float(1 / Double(mips[i].width)), v[0], "invSize.x \(w)×\(h) mip \(i)")
        assertFloat(Float(1 / Double(mips[i].height)), v[1], "invSize.y \(w)×\(h) mip \(i)")
      }
    }
  }
}
