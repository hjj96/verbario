// EnvironmentGoldenTests — the IBL bake bookkeeping against the web (Tests/Goldens/env/*):
//   * pmrem.json: three r185 PMREMGenerator.fromScene(…, { size: 128 }) — atlas size, cube-UV defines
//     (ShaderTypes.h MD_CUBEUV_*), lod sizes, and every GGX pass three issues (roughness, mipInt, viewport)
//     = EnvironmentProbe.lods, which drives Prefilter.metal;
//   * weather_env.json: weather/env.js WeatherEnv.update — the re-bake schedule (EnvRebakePolicy), the bake
//     uniforms (EnvSkyParams, uploaded as float) and scene.environmentIntensity.
// CPU only (the GPU bake itself is checked by RenderGoldenTests against the Chromium atlas).
import XCTest
import MaydayCore
import MaydayShaderTypes
@testable import MaydayApp

final class EnvironmentGoldenTests: XCTestCase {
  func testPmremLayout() throws {
    let d = try Goldens.data("env/pmrem.json")
    XCTAssertEqual(Int(MD_CUBEUV_SIZE), try d["cubeSize"].requireInt())
    XCTAssertEqual(Int(MD_CUBEUV_MAX_MIP), try d["lodMax"].requireInt())
    XCTAssertEqual(Int(MD_CUBEUV_WIDTH), try d["width"].requireInt())
    XCTAssertEqual(Int(MD_CUBEUV_HEIGHT), try d["height"].requireInt())
    XCTAssertEqual(Int(MD_CUBEUV_LODS), try d["sizeLods"].requireArray().count)
    let defs = d["defines"]
    assertFloat(1 / Float(MD_CUBEUV_WIDTH), try defs["CUBEUV_TEXEL_WIDTH"].num(), "CUBEUV_TEXEL_WIDTH")
    assertFloat(1 / Float(MD_CUBEUV_HEIGHT), try defs["CUBEUV_TEXEL_HEIGHT"].num(), "CUBEUV_TEXEL_HEIGHT")
    XCTAssertEqual(defs["GGX_SAMPLES"].int, 256)
    let sizes = try d["sizeLods"].nums().map { Int($0) }
    let lods = EnvironmentProbe.lods
    XCTAssertEqual(lods.map { $0.size }, Array(sizes.dropFirst()))
    // pmrem_ggx_kernel maps texel k of a face to uv (k − ½)/(f − 2): the quad's uv range [−1/(f−2), 1 + 1/(f−2)]
    for (n, r) in try d["uvRange"].requireArray().enumerated() {
      let f = Double(sizes[n])
      let v = try r.nums()
      assertFloat(Float(-1 / (f - 2)), v[0], "lod \(n) uv min")
      assertFloat(Float(1 + 1 / (f - 2)), v[1], "lod \(n) uv max")
    }
    let passes = try d["passes"].requireArray()
    XCTAssertEqual(passes.count, 2 * lods.count)
    for (i, lod) in lods.enumerated() {
      let p1 = passes[2 * i], p2 = passes[2 * i + 1]
      let at = "lod \(lod.index)"
      XCTAssertEqual(try p1["lod"].requireInt(), lod.index, at)
      XCTAssertEqual(p1["source"].string, "cubeUV")
      XCTAssertEqual(p1["target"].string, "pingPong")
      XCTAssertEqual(p2["source"].string, "pingPong")
      XCTAssertEqual(p2["target"].string, "cubeUV")
      assertBits(lod.roughness, try p1["roughness"].num(), "\(at) roughness")
      assertFloat(Float(lod.roughness), try p1["roughness"].num(), "\(at) roughness uniform")
      assertBits(lod.sourceMip, try p1["mipInt"].num(), "\(at) source mipInt")
      assertBits(0, try p2["roughness"].num(), "\(at) copy roughness")
      assertBits(lod.targetMip, try p2["mipInt"].num(), "\(at) copy mipInt")
      for p in [p1, p2] {
        XCTAssertEqual(try p["viewport"].nums().map { Int($0) }, [lod.x, lod.y, 3 * lod.size, 2 * lod.size], at)
      }
    }
  }

  func testWeatherEnvSchedule() throws {
    let d = try Goldens.data("env/weather_env.json")
    var policy = EnvRebakePolicy()
    var bakes = 0
    for (i, s) in try d["steps"].requireArray().enumerated() {
      let at = "step \(i) (\(s["preset"].string ?? ""))"
      if s["markDirty"].bool == true { policy.markDirty() }
      let p = try goldenPalette(s["palette"])
      let flash = try s["flash"].num()
      let bake = policy.update(clock: try s["clock"].num(), flash: flash, transitioning: s["transitioning"].bool ?? false)
      let o = s["out"]
      XCTAssertEqual(bake, !o["baked"].isNull, at)
      assertBits(EnvRebakePolicy.environmentIntensity(envIntensity: p.envIntensity, flash: flash),
                 try o["environmentIntensity"].num(), "\(at) environmentIntensity")
      if !o["baked"].isNull {
        let b = o["baked"]
        let sky = EnvSkyParams(palette: p, sunDirVisual: try s["sunDirVisual"].v3())
        func f3(_ v: SIMD3<Float>, _ j: JSONValue, _ what: String) throws {
          let w = try j.nums()
          for k in 0..<3 { assertFloat(v[k], w[k], "\(at) \(what)[\(k)]") }
        }
        try f3(sky.sky, b["uSky"], "uSky")
        try f3(sky.fog, b["uFog"], "uFog")
        try f3(sky.deep, b["uDeep"], "uDeep")
        try f3(sky.sunDir, b["uSunDir"], "uSunDir")
        try f3(sky.sunColor, b["uSunColor"], "uSunColor")
        assertFloat(sky.sunIntensity, try b["uSunI"].num(), "\(at) uSunI")
        assertBits(EnvSkyParams.cloud(fog: p.fog, scud: p.scud), try b["uCloud"].num(), "\(at) uCloud")
        assertFloat(sky.cloud, try b["uCloud"].num(), "\(at) uCloud uniform")
        XCTAssertEqual(b["size"].int, Int(MD_CUBEUV_SIZE))
        XCTAssertEqual(b["sigma"].double, 0)
        bakes += 1
      }
    }
    XCTAssertGreaterThan(bakes, 4)
  }
}
