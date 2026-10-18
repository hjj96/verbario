// RenderGoldenTests — Metal frames against the web's (PLAN §5.5, §7 M2 «8 пресетов: SSIM ≥ 0.92»):
// every Tests/Goldens/scenes/<name>.json (tools/export/render-goldens.mjs --browser) is the complete render
// state of one frame of the web game in headless Chromium — camera, look / fog / lights / environment,
// all ocean uniforms, FinalPass uniforms, the probe box, the water-memory history. The test rebuilds a
// RenderFrame from that state alone (render parity in isolation from the simulation), replays the water
// memory, renders off screen at the same size and compares:
//   final.png  (FinalPass)            ↔ OffscreenFrame.final
//   post.png   (OutputPass)           ↔ OffscreenFrame.post
//   final.png of a ?stub=post scene   ↔ OffscreenFrame.post (the web tone-maps in the materials; X3)
// with SSIM ≥ 0.92 on luma (SwiftShader ≠ Apple GPU: the threshold, plus human review of the side-by-side
// files written to $TMPDIR/MaydayGoldens/<scene>-{web,metal}-{final,post}.png).
// GPU only: skips without a Metal device (CI without GPU, Linux pre-flight).
import XCTest
import Metal
import simd
import MaydayCore
import MaydayShaderTypes
@testable import MaydayApp

/// One scene golden turned into renderer inputs.
struct GoldenScene {
  let name: String
  let frame: RenderFrame
  let memoryReplay: [WaterMemoryInput]
  let probe: StandardItemSpec?
  let postStub: Bool
  let finalImage: String
  let postImage: String?
  let json: JSONValue

  struct StandardItemSpec {
    var model: simd_double4x4
    var color: SIMD3<Float>
    var emissive: SIMD3<Float>
    var roughness: Float
    var metalness: Float
    var castShadow: Bool
    var receiveShadow: Bool
    var size: SIMD3<Double>
  }

  static func f(_ j: JSONValue) throws -> Float { Float(try j.num()) }
  static func f2(_ j: JSONValue) throws -> SIMD2<Float> { let a = try j.nums(); return SIMD2<Float>(Float(a[0]), Float(a[1])) }
  static func f3(_ j: JSONValue) throws -> SIMD3<Float> { let a = try j.nums(); return SIMD3<Float>(Float(a[0]), Float(a[1]), Float(a[2])) }
  static func f4(_ j: JSONValue) throws -> SIMD4<Float> {
    let a = try j.nums()
    return SIMD4<Float>(Float(a[0]), Float(a[1]), Float(a[2]), Float(a[3]))
  }
  /// A flat float array (Float32Array uniform) as vec4s, the first `count` of them.
  static func vec4s(_ j: JSONValue, count: Int? = nil) throws -> [SIMD4<Float>] {
    let a = try j.nums()
    let n = min(count ?? a.count / 4, a.count / 4)
    return (0..<n).map { SIMD4<Float>(Float(a[$0 * 4]), Float(a[$0 * 4 + 1]), Float(a[$0 * 4 + 2]), Float(a[$0 * 4 + 3])) }
  }
  static func m4(_ j: JSONValue) throws -> simd_double4x4 {
    let e = try j.nums()
    return simd_double4x4(columns: (SIMD4<Double>(e[0], e[1], e[2], e[3]), SIMD4<Double>(e[4], e[5], e[6], e[7]),
                                    SIMD4<Double>(e[8], e[9], e[10], e[11]), SIMD4<Double>(e[12], e[13], e[14], e[15])))
  }

  static func ocean(_ u: JSONValue) throws -> OceanFrameInput {
    var o = OceanFrameInput()
    o.waveA = try vec4s(u["uWaveA"])
    o.waveB = try vec4s(u["uWaveB"])
    o.offset = try f2(u["uOffset"])
    o.gridStep = try f(u["uGridStep"])
    o.hsEff = try f(u["uHsEff"])
    o.shoals = try vec4s(u["uShoals"], count: try u["uShoalCount"].requireInt())
    o.coastWin = try f4(u["uCoastWin"])
    o.coastOn = try f(u["uCoastOn"])
    let nf = try u["uFeatCount"].requireInt()
    o.featA = try vec4s(u["uFeatA"], count: nf)
    o.featB = try vec4s(u["uFeatB"], count: nf)
    o.featC = try vec4s(u["uFeatC"], count: nf)
    o.downwash = try f4(u["uDownwash"])
    o.deep = try f3(u["uDeep"])
    o.body = try f3(u["uBody"])
    o.crest = try f3(u["uCrest"])
    o.shallow = try f3(u["uShallow"])
    o.foam = try f3(u["uFoamCol"])
    o.sky = try f3(u["uSkyCol"])
    o.fogColor = try f3(u["uFogCol"])
    o.sun = try f3(u["uSunCol"])
    o.spec = try f3(u["uSpecCol"])
    o.ambient = try f3(u["uAmbCol"])
    o.shadowTint = try f3(u["uShadowTint"])
    o.flashColor = try f3(u["uFlashCol"])
    o.sunDirV = try f3(u["uSunDirV"])
    o.sunDirS = try f3(u["uSunDirS"])
    o.seaA = try f4(u["uSeaA"])
    o.seaB = try f4(u["uSeaB"])
    o.seaC = try f4(u["uSeaC"])
    o.seaD = try f4(u["uSeaD"])
    o.seaE = try f4(u["uSeaE"])
    o.jStats = try f4(u["uJStats"])
    o.detOff = try f4(u["uDetOff"])
    o.detRot = try f4(u["uDetRot"])
    o.streakRot = try f4(u["uStreakRot"])
    o.streakMix = try f(u["uStreakMix"])
    o.heliP = try f4(u["uHeliP"])
    o.searchPos = try f3(u["uSearchPos"])
    o.searchDir = try f4(u["uSearchDir"])
    o.searchI = try f(u["uSearchI"])
    let ng = try u["uGlintCount"].requireInt()
    o.glints = try vec4s(u["uGlints"], count: ng)
    o.glintColors = try vec4s(u["uGlintCol"], count: ng).map { SIMD3<Float>($0.x, $0.y, $0.z) }
    let ns = try u["uSplashCount"].requireInt()
    o.splashes = try vec4s(u["uSplash"], count: ns)
    o.splashStrengths = Array(try u["uSplashS"].nums().prefix(ns).map { Float($0) })
    o.memWin = try f4(u["uMemWin"])
    o.spotWater = try f(u["uSpotWater"])
    o.front = try f4(u["uFront"])
    o.frontB = try f4(u["uFrontB"])
    o.prevDeep = try f3(u["uPrevDeep"])
    o.prevBody = try f3(u["uPrevBody"])
    o.prevCrest = try f3(u["uPrevCrest"])
    o.prevFoam = try f3(u["uPrevFoam"])
    o.nextDeep = try f3(u["uNextDeep"])
    o.nextBody = try f3(u["uNextBody"])
    o.nextCrest = try f3(u["uNextCrest"])
    o.nextFoam = try f3(u["uNextFoam"])
    o.prevSea = try f4(u["uPrevSea"])
    o.nextSea = try f4(u["uNextSea"])
    o.lookK = try f4(u["uLookK"])
    return o
  }

  static func finalPass(_ u: JSONValue) throws -> FinalInput {
    var g = FinalInput()
    g.grid = try f2(u["uGrid"])
    g.flow = try f2(u["uFlow"])
    g.drops = try f(u["uDrops"])
    g.refr = try f(u["uRefr"])
    g.condense = try f(u["uCondense"])
    g.salt = try f(u["uSalt"])
    g.ca = try f(u["uCA"])
    g.flash = try f(u["uFlash"])
    g.flashTint = try f3(u["uFlashTint"])
    g.edge = try f4(u["uEdge"])
    g.vortex = try f(u["uVortex"])
    g.bright = try f(u["uBright"])
    g.satMul = try f(u["uSatMul"])
    g.slope = try f3(u["uSlope"])
    g.offset = try f3(u["uOffset"])
    g.power = try f(u["uPower"])
    g.contrast = try f(u["uContrast"])
    g.sat = try f(u["uSat"])
    g.splitShadow = try f3(u["uSplitShadow"])
    g.splitHighlight = try f3(u["uSplitHighlight"])
    g.splitStrength = try f(u["uSplitStrength"])
    g.green = try f(u["uGreen"])
    g.vignette = try f(u["uVignette"])
    g.vignetteColor = try f3(u["uVignetteColor"])
    g.grain = try f(u["uGrain"])
    g.night = try f(u["uNight"])
    g.seed = try f(u["uSeed"])
    g.letterbox = try f(u["uLetterbox"])
    g.dayToe = try f(u["uDayToe"])
    g.blackFloor = try f(u["uFloor"])
    g.dof = try f(u["uDof"])
    g.dofFocus = try f(u["uDofFocus"])
    g.dofBand = try f(u["uDofBand"])
    g.dofTaps = try f(u["uDofTaps"])
    g.lookMix = try f(u["uLookMix"])
    g.lookSat = try f(u["uLookSat"])
    g.lookContrast = try f(u["uLookContrast"])
    g.lookFade = try f(u["uLookFade"])
    g.lookShadow = try f3(u["uLookShadow"])
    g.lookHigh = try f3(u["uLookHigh"])
    g.thermal = try f(u["uThermal"])
    g.thermBoot = try f(u["uThermBoot"])
    g.thermFlick = try f(u["uThermFlick"])
    g.thermT = try f(u["uThermT"])
    return g
  }

  init(file: String) throws {
    let d = try Goldens.data(file)
    json = d
    let spec = d["spec"]
    name = try spec["name"].requireString()
    postStub = spec["post"].bool == false
    finalImage = "scenes/" + (try d["images"]["final"].requireString())
    postImage = d["images"]["post"].isNull ? nil : "scenes/" + (try d["images"]["post"].requireString())

    // quality tier as the web ran it (ocean QUALITY cfg, post.js MSAA samples, bloom on/off)
    let cfg = d["ocean"]["cfg"]
    let qname = try spec["quality"].requireString()
    let samples = postStub ? 1 : max(1, d["post"]["samples"].int ?? 1)
    let q = RenderQualityConfig(name: qname, sampleCount: samples, oceanGridN: try cfg["grid"].requireInt(),
                                oceanWaves: try cfg["waves"].requireInt(), oceanQ: try cfg["q"].requireInt(),
                                oceanGlints: try cfg["glints"].requireInt(), oceanMemory: d["ocean"]["memory"].int ?? 0,
                                minDynScale: 1)
    let db = try d["drawingBuffer"].nums()
    let c = d["camera"]
    let cam = CameraState(position: try c["position"].simd3(), target: try c["target"].simd3(), up: try c["up"].simd3(),
                          fovDeg: try c["fov"].num(), near: try c["near"].num(), far: try c["far"].num(), zoom: try c["zoom"].num())
    var fr = RenderFrame(camera: cam, quality: q, internalWidth: Int(db[0]), internalHeight: Int(db[1]))
    fr.pxScale = 1                                        // post.js uPxScale = max(1, devicePixelRatio) at DPR 1
    fr.dynamicResolution = false                          // ?dynres=0
    fr.realTime = try d["realT"].num()

    // look uniforms (core/look.js)
    let l = d["look"]
    fr.look.time = try l["uTime"].num()
    fr.look.wind = try l["uWind"].simd2()
    fr.look.windOffset = try l["uWindOffset"].simd2()
    fr.look.rain = try l["uRain"].num()
    fr.look.wet = try l["uWet"].num()
    fr.look.flash = try l["uFlash"].num()
    fr.look.night = try l["uNight"].num()
    fr.look.gustFrontsA = try l["uGustFronts"].requireArray().map { try GoldenScene.f4($0) }
    fr.look.gustFrontsB = try l["uGustFrontsB"].requireArray().map { try GoldenScene.f4($0) }

    // scene.fog / background
    fr.fog.color = try GoldenScene.f3(d["fog"]["color"])
    fr.fog.near = try GoldenScene.f(d["fog"]["near"])
    fr.fog.far = try GoldenScene.f(d["fog"]["far"])

    // lights (weather/lights.js state after the frame's update)
    let sun = d["lights"]["sun"], hemi = d["lights"]["hemi"]
    let sp = try sun["position"].v3(), st = try sun["target"].v3()
    let dir = (sp - st).normalized()
    fr.lights.sunDirection = SIMD3<Float>(Float(dir.x), Float(dir.y), Float(dir.z))
    let si = try sun["intensity"].num()
    let sc = try sun["color"].nums()
    fr.lights.sunColor = SIMD3<Float>(Float(sc[0] * si), Float(sc[1] * si), Float(sc[2] * si))
    let hi = try hemi["intensity"].num()
    let hc = try hemi["color"].nums(), hg = try hemi["groundColor"].nums()
    fr.lights.hemiSky = SIMD3<Float>(Float(hc[0] * hi), Float(hc[1] * hi), Float(hc[2] * hi))
    fr.lights.hemiGround = SIMD3<Float>(Float(hg[0] * hi), Float(hg[1] * hi), Float(hg[2] * hi))
    fr.lights.environmentIntensity = try GoldenScene.f(d["lights"]["environmentIntensity"])
    let sh = sun["shadow"]
    fr.lights.shadow = SunShadowInput(camera: ShadowCamera(position: sp, target: st), mapSize: try sh["mapSize"].requireInt(),
                                      intensity: try GoldenScene.f(sh["intensity"]), radius: try GoldenScene.f(sh["radius"]),
                                      shadowOnlyLayer: sh["layer1"].bool ?? false)

    // scene.environment: the env bake of weather/env.js with the uniforms of its last bake
    let e = d["environment"]
    let sky = EnvSkyParams(sky: try GoldenScene.f3(e["uSky"]), fog: try GoldenScene.f3(e["uFog"]), deep: try GoldenScene.f3(e["uDeep"]),
                           sunDir: try GoldenScene.f3(e["uSunDir"]), sunColor: try GoldenScene.f3(e["uSunColor"]),
                           sunIntensity: try GoldenScene.f(e["uSunI"]), cloud: try GoldenScene.f(e["uCloud"]))
    fr.environment.sky = sky
    fr.environment.rebake = true

    fr.ocean = try GoldenScene.ocean(d["ocean"]["uniforms"])

    // post
    let p = d["post"]
    fr.post.exposure = try GoldenScene.f(p["exposure"])
    if postStub {
      fr.post.bloomStrength = 0
    } else {
      let b = p["bloom"]
      fr.post.bloomStrength = (b["enabled"].bool ?? false) ? try GoldenScene.f(b["strength"]) : 0
      fr.post.bloomRadius = try GoldenScene.f(b["radius"])
      fr.post.bloomThreshold = try GoldenScene.f(b["threshold"])
      fr.post.finalPass = try GoldenScene.finalPass(p["final"])
    }

    // the water memory history (one WaterMemory.update per entry); the last entry is the captured frame's
    var replay: [WaterMemoryInput] = []
    for m in try d["memoryLog"].requireArray() {
      var w = WaterMemoryInput()
      w.dt = try m["dt"].num()
      w.focus = try m["focus"].simd2()
      w.wind = try m["wind"].simd2()
      let a = try m["aA"].nums(), b = try m["aB"].nums(), cc = try m["aC"].nums()
      for i in 0..<(a.count / 4) {
        let shape = WaterMemoryStamp.Shape(rawValue: Float(cc[i * 4])) ?? .disc
        w.push(shape, x: a[i * 4], z: a[i * 4 + 1], radius: a[i * 4 + 2], strength: a[i * 4 + 3], foam: b[i * 4], dye: b[i * 4 + 1],
               disturbance: b[i * 4 + 2], oil: b[i * 4 + 3], inner: cc[i * 4 + 1], dirX: cc[i * 4 + 2], dirZ: cc[i * 4 + 3])
      }
      replay.append(w)
    }
    if let last = replay.last { fr.waterMemory = last }
    memoryReplay = replay
    frame = fr

    let pb = d["probe"]
    let size = try pb["geometry"].nums()
    probe = StandardItemSpec(model: try GoldenScene.m4(pb["matrixWorld"]), color: try GoldenScene.f3(pb["color"]),
                             emissive: try GoldenScene.f3(pb["emissive"]), roughness: try GoldenScene.f(pb["roughness"]),
                             metalness: try GoldenScene.f(pb["metalness"]), castShadow: pb["castShadow"].bool ?? false,
                             receiveShadow: pb["receiveShadow"].bool ?? false, size: SIMD3<Double>(size[0], size[1], size[2]))
  }
}

final class RenderGoldenTests: XCTestCase {
  /// CPU checks of the scene goldens that need no GPU: the camera and shadow matrices the port rebuilds from
  /// position / target are the web's, bit for bit (three r185 Object3D.lookAt + Camera.updateMatrixWorld).
  func testSceneMatricesRebuildExactly() throws {
    let files = try Goldens.list("scenes")
    if files.isEmpty { throw XCTSkip("no scene goldens (render-goldens.mjs --browser)") }
    for file in files {
      let s = try GoldenScene(file: file)
      let c = s.json["camera"]
      let aspect = Double(s.frame.internalWidth) / Double(s.frame.internalHeight)
      assertBits(aspect, try c["aspect"].num(), "\(s.name) aspect")
      let cm = CameraMatrices(camera: s.frame.camera, aspect: aspect)
      func flat(_ m: simd_double4x4) -> [Double] {
        [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
      }
      assertBits(flat(cm.cameraWorld), try c["matrixWorld"].nums(), "\(s.name) camera.matrixWorld")
      assertBits(flat(cm.view), try c["matrixWorldInverse"].nums(), "\(s.name) camera.matrixWorldInverse")
      assertBits(flat(cm.projGL), try c["projectionMatrix"].nums(), "\(s.name) camera.projectionMatrix")
      if let sh = s.frame.lights.shadow {
        assertBits(sh.camera.shadowMatrix.elements, try s.json["lights"]["sun"]["shadow"]["matrix"].nums(), "\(s.name) sun.shadow.matrix")
      }
    }
  }

  private func reviewDirectory() -> URL {
    URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("MaydayGoldens", isDirectory: true)
  }

  func testScenesMatchTheWeb() throws {
    let device = try requireMetalDevice()
    let files = try Goldens.list("scenes")
    if files.isEmpty { throw XCTSkip("no scene goldens (render-goldens.mjs --browser)") }
    let data = try DataBundle()
    let review = reviewDirectory()
    var report: [String] = []
    for file in files {
      let s = try GoldenScene(file: file)
      // a fresh renderer per scene: env bake, water memory and targets start empty, like a page load
      let renderer = try Renderer(device: device, texturesDirectory: data.texturesDirectory, oceanConstants: .web)
      try renderer.prewarm(quality: s.frame.quality)
      if let p = s.probe {
        let fam = try StandardFamily(renderer: renderer)
        var item = StandardItem(id: 1, mesh: try ThreeBoxGeometry.mesh(device: device, width: p.size.x, height: p.size.y, depth: p.size.z,
                                                                        label: "probe"), model: p.model)
        item.color = p.color
        item.emissive = p.emissive
        item.roughness = p.roughness
        item.metalness = p.metalness
        item.castShadow = p.castShadow
        item.receiveShadow = p.receiveShadow
        fam.items = [item]
        renderer.addFamily(fam)
      }
      // replay the water memory up to the captured frame (each entry = one web WaterMemory.update); the env
      // atlas is baked by the first frame (a renderer always bakes before first use) and kept after that
      var f = s.frame
      f.environment.rebake = false
      if s.frame.quality.oceanMemory > 0 {
        for m in s.memoryReplay.dropLast() {
          f.waterMemory = m
          _ = try renderer.renderOffscreen(f)
        }
      }
      f.waterMemory = s.frame.waterMemory
      let out = try renderer.renderOffscreen(f)
      let w = out.width, h = out.height
      let metalFinal = RGBAImage(width: w, height: h, rgba8: out.final)
      let metalPost = RGBAImage(width: w, height: h, rgba8: out.post)
      let webFinal = try PNG.read(try Goldens.url(s.finalImage))
      XCTAssertEqual(webFinal.width, w, s.name)
      XCTAssertEqual(webFinal.height, h, s.name)
      try PNG.write(webFinal, to: review.appendingPathComponent("\(s.name)-web-final.png"))
      if s.postStub {
        // ?stub=post: the canvas is ACES + sRGB straight from the materials = our Composite+Output (no bloom)
        let d = ImageMetrics.compare(metalPost, webFinal)
        try PNG.write(metalPost, to: review.appendingPathComponent("\(s.name)-metal-post.png"))
        report.append("\(s.name) post-off: \(d)")
        XCTAssertGreaterThanOrEqual(d.ssim, 0.92, "\(s.name) (post stubbed): \(d)")
      } else {
        let d = ImageMetrics.compare(metalFinal, webFinal)
        try PNG.write(metalFinal, to: review.appendingPathComponent("\(s.name)-metal-final.png"))
        report.append("\(s.name) final: \(d)")
        XCTAssertGreaterThanOrEqual(d.ssim, 0.92, "\(s.name) final: \(d)")
        if let pi = s.postImage {
          let webPost = try PNG.read(try Goldens.url(pi))
          let dp = ImageMetrics.compare(metalPost, webPost)
          try PNG.write(webPost, to: review.appendingPathComponent("\(s.name)-web-post.png"))
          try PNG.write(metalPost, to: review.appendingPathComponent("\(s.name)-metal-post.png"))
          report.append("\(s.name) post:  \(dp)")
          XCTAssertGreaterThanOrEqual(dp.ssim, 0.92, "\(s.name) post: \(dp)")
        }
      }
    }
    print("RenderGoldenTests (side-by-side files in \(review.path)):\n  " + report.joined(separator: "\n  "))
  }
}
