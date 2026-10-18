// SunRigGoldenTests — SunRig (weather/lights.js WeatherLights) and ShadowCamera (three r185
// LightShadow.updateMatrices) against Tests/Goldens/lighting/sunrig.json, bit for bit (PLAN §5.1 class
// "deterministic Double pipelines"); plus the GPU packing of the rig (LightRig / ShadowPass matrices).
// CPU only: runs anywhere MaydayApp builds.
import XCTest
import simd
import MaydayCore
import MaydayShaderTypes
@testable import MaydayApp

final class SunRigGoldenTests: XCTestCase {
  private func m16(_ m: Mat4) -> [Double] { m.elements }

  func testWeatherLightsAndShadowCamera() throws {
    let d = try Goldens.data("lighting/sunrig.json")
    let k = d["constants"]
    assertBits(SunRig.BOX, try k["BOX"].num(), "BOX")
    assertBits(SunRig.DIST, try k["DIST"].num(), "DIST")
    assertBits(SunRig.SHADOW_BIAS, try k["bias"].num(), "bias")
    assertBits(SunRig.SHADOW_NORMAL_BIAS, try k["normalBias"].num(), "normalBias")
    assertBits(SunRig.CAMERA_NEAR, try k["near"].num(), "near")
    assertBits(SunRig.CAMERA_FAR, try k["far"].num(), "far")
    let cases = try d["cases"].requireArray()
    XCTAssertGreaterThan(cases.count, 8)
    var updates = 0
    for c in cases {
      let name = try c["name"].requireString()
      let rig = SunRig(quality: try c["quality"].requireString())
      var rng = Mulberry32(seed: try c["rngSeed"].num())
      let palette = try goldenPalette(c["palette"])
      for (si, s) in try c["steps"].requireArray().enumerated() {
        let at = "\(name) step \(si)"
        switch try s["op"].requireString() {
        case "quality":
          rig.applyQuality(try s["quality"].requireString())
        case "swing":
          rig.swing(x: try s["x"].num(), z: try s["z"].num(), hx: try s["hx"].num(), hz: try s["hz"].num(),
                    next: { rng.next() })
          assertBits(rig.swingDir, s["swingDir"], "\(at) swingDir")
        default:
          let i = s["input"]
          let input = SunRigInput(palette: palette, sunDirShadow: try i["sunDirShadow"].v3(), flash: try i["flash"].num(),
                                  flashColor: try i["flashColor"].color())
          let cam: V3? = i["camFocus"].isNull ? nil : try i["camFocus"].v3()
          let st = rig.update(dt: try s["dt"].num(), input: input, focus: try i["focus"].v3(), alt: try i["alt"].num(), camFocus: cam)
          let o = s["out"]
          assertBits(st.direction, o["sunDir"], "\(at) sunDir")
          assertBits(rig.swingWeight, try o["swingWeight"].num(), "\(at) swingWeight")
          assertBits(st.position, o["position"], "\(at) position")
          assertBits(st.target, o["target"], "\(at) target")
          assertBits(st.intensity, try o["intensity"].num(), "\(at) intensity")
          assertBits(st.color, o["color"], "\(at) color")
          assertBits(st.shadowIntensity, try o["shadowIntensity"].num(), "\(at) shadow.intensity")
          assertBits(st.shadowRadius, try o["shadowRadius"].num(), "\(at) shadow.radius")
          assertBits(st.hemiColor, o["hemiColor"], "\(at) hemi.color")
          assertBits(st.hemiGroundColor, o["hemiGround"], "\(at) hemi.groundColor")
          assertBits(st.hemiIntensity, try o["hemiIntensity"].num(), "\(at) hemi.intensity")
          XCTAssertEqual(st.mapSize, try o["mapSize"].requireInt(), "\(at) mapSize")
          XCTAssertEqual(rig.shadowLayer1, o["shadowLayer1"].bool, "\(at) layer 1")
          let sc = ShadowCamera(st)
          let oc = o["camera"]
          assertBits(m16(sc.projection), try oc["projection"].nums(), "\(at) projectionMatrix")
          assertBits([sc.quaternion.x, sc.quaternion.y, sc.quaternion.z, sc.quaternion.w], try oc["quaternion"].nums(), "\(at) quaternion")
          assertBits(m16(sc.matrixWorld), try oc["matrixWorld"].nums(), "\(at) matrixWorld")
          assertBits(m16(sc.matrixWorldInverse), try oc["matrixWorldInverse"].nums(), "\(at) matrixWorldInverse")
          assertBits(m16(sc.shadowMatrix), try oc["shadowMatrix"].nums(), "\(at) shadow.matrix")
          updates += 1
        }
      }
    }
    XCTAssertGreaterThan(updates, 50)
  }

  /// The GPU side of the rig: the depth pass (glToMetal) and the receivers (Metal-uv shadow matrix) map a
  /// world point to the same texel / depth three computes with shadow.matrix.
  func testShadowMatricesForMetal() throws {
    let rig = SunRig(quality: "medium")
    var input = SunRigInput()
    input.sunDirShadow = V3(-0.42, 0.81, -0.41).normalized()
    let st = rig.update(dt: 1.0 / 60.0, input: input, focus: V3(37, 40, -12), alt: 40, camFocus: V3(30, 0, -40))
    let cam = ShadowCamera(st)
    let recv = ShadowPass.receiverMatrix(cam)
    let depth = ShadowPass.metalViewProjection(cam)
    for p in [V3(37, 0, -12), V3(-20, 3, 40), V3(90, -2, -80)] {
      var w = p
      w.applyMatrix4(cam.shadowMatrix)                    // three: (u, v, z) in [0, 1], v up
      let wp = SIMD4<Float>(Float(p.x), Float(p.y), Float(p.z), 1)
      let r = recv * wp
      XCTAssertEqual(Double(r.x / r.w), w.x, accuracy: 1e-5)
      XCTAssertEqual(Double(r.y / r.w), 1 - w.y, accuracy: 1e-5)   // Metal rows: v down
      XCTAssertEqual(Double(r.z / r.w), w.z, accuracy: 1e-5)
      let c = depth * wp                                  // Metal clip: z ∈ [0, 1] = three's 0.5·z + 0.5
      XCTAssertEqual(Double(c.z / c.w), w.z, accuracy: 1e-5)
      XCTAssertEqual(Double(c.x / c.w) * 0.5 + 0.5, w.x, accuracy: 1e-5)
    }
    var lights = LightsInput()
    lights.apply(rig: st, shadowOnlyLayer: rig.shadowLayer1)
    let u = LightRig.pack(lights, shadowMapBound: true)
    XCTAssertEqual(u.shadowParams, SIMD4<Float>(Float(SunRig.SHADOW_BIAS), Float(SunRig.SHADOW_NORMAL_BIAS),
                                                Float(st.shadowRadius), Float(st.shadowIntensity)))
    XCTAssertEqual(u.shadowMapSize, SIMD4<Float>(1024, 1024, 1, 0))
    let dir = (st.position - st.target).normalized()
    XCTAssertEqual(u.dir.direction, SIMD4<Float>(Float(dir.x), Float(dir.y), Float(dir.z), 0))
    let off = LightRig.pack(lights, shadowMapBound: false)
    XCTAssertEqual(off.shadowMapSize.z, 0)                // receivers skip getShadow()
  }
}
