// WaterMemoryGoldenTests — the CPU half of the water memory against the real ocean/memory.js and ocean.js
// (Tests/Goldens/ocean/memory.json): the stamp queue (WaterMemoryInput: push limits, stamp kinds, splash,
// addWake, the downwash auto-stamps) must queue the same instance attributes the web uploads (Float32), and
// WaterMemoryWindow must produce the same advect uniforms (as uploaded floats) and window centre (Double).
// The GPU passes themselves are covered by RenderGoldenTests (scene frames with stamps).
import XCTest
import MaydayCore
import MaydayShaderTypes
@testable import MaydayApp

final class WaterMemoryGoldenTests: XCTestCase {
  private func floats(_ s: [WaterMemoryStamp]) -> (a: [Float], b: [Float], c: [Float]) {
    var a: [Float] = [], b: [Float] = [], c: [Float] = []
    for st in s {
      let g = st.gpu
      a += [g.aA.x, g.aA.y, g.aA.z, g.aA.w]
      b += [g.aB.x, g.aB.y, g.aB.z, g.aB.w]
      c += [g.aC.x, g.aC.y, g.aC.z, g.aC.w]
    }
    return (a, b, c)
  }

  private func assertFloats(_ mine: [Float], _ web: [Double], _ what: String) {
    XCTAssertEqual(mine.count, web.count, what)
    for i in 0..<min(mine.count, web.count) { assertFloat(mine[i], web[i], "\(what)[\(i)]") }
  }

  func testQueueAndWindow() throws {
    let d = try Goldens.data("ocean/memory.json")
    XCTAssertEqual(WaterMemoryInput.MAX_STAMPS, try d["MAX_STAMPS"].requireInt())
    assertBits(WaterMemoryPass.EXTENT, try d["EXTENT"].num(), "EXTENT")
    assertBits(WaterMemoryPass.HALF_LIFE, try d["HALF_LIFE"].nums(), "HALF_LIFE")
    var updates = 0
    for c in try d["cases"].requireArray() {
      let size = try c["size"].requireInt()
      var win = WaterMemoryWindow(size: size)
      var q = WaterMemoryInput()
      for (i, s) in try c["steps"].requireArray().enumerated() {
        let at = "size \(size) step \(i)"
        switch try s["op"].requireString() {
        case "stamp":
          let o = s["opts"]
          q.stamp(try s["kind"].requireString(), x: try s["x"].num(), z: try s["z"].num(),
                  radius: o["radius"].optionalDouble ?? 3, strength: o["strength"].optionalDouble ?? 1,
                  inner: o["inner"].optionalDouble, dirX: o["dirX"].optionalDouble, dirZ: o["dirZ"].optionalDouble)
        case "splash":
          q.splash(x: try s["x"].num(), z: try s["z"].num(), radius: try s["radius"].num(), strength: try s["strength"].num())
        case "addWake":
          q.addWake(x: try s["x"].num(), z: try s["z"].num(), strength: try s["strength"].num(),
                    dirX: s["dirX"].optionalDouble, dirZ: s["dirZ"].optionalDouble, dt: try s["dt"].num())
        case "autoStamps":
          let w = try s["downwash"].nums()
          q.autoStamps(downwash: SIMD4<Double>(w[0], w[1], w[2], w[3]), dt: try s["dt"].num())
        case "overflow":
          for k in 0..<(try s["n"].requireInt()) {
            let x = Double(k)
            q.push(.disc, x: x, z: -x, radius: 1 + x * 0.01, strength: 0.5, foam: 1, dye: 0, disturbance: 0.3, oil: 0)
          }
        case "clear":
          q.removeAllStamps()
        default:
          let st = s["stamps"]
          XCTAssertEqual(q.stamps.count, try st["count"].requireInt(), "\(at) queued stamps")
          let f = floats(q.stamps)
          assertFloats(f.a, try st["aA"].nums(), "\(at) aA")
          assertFloats(f.b, try st["aB"].nums(), "\(at) aB")
          assertFloats(f.c, try st["aC"].nums(), "\(at) aC")
          let wind = try s["wind"].simd2()
          let u = win.advance(dt: try s["dt"].num(), focus: try s["focus"].simd2(), wind: wind)
          q.removeAllStamps()   // drawn and dropped by WaterMemory.update (count = 0)
          let o = s["out"]
          let shift = try o["uShift"].nums(), center = try o["uCenter"].nums(), wv = try o["uWindV"].nums()
          let decay = try o["uDecay"].nums(), texel = try o["uTexel"].nums()
          assertFloat(u.shiftCenter.x, shift[0], "\(at) uShift.x")
          assertFloat(u.shiftCenter.y, shift[1], "\(at) uShift.y")
          assertFloat(u.shiftCenter.z, center[0], "\(at) uCenter.x")
          assertFloat(u.shiftCenter.w, center[1], "\(at) uCenter.y")
          assertFloat(u.extentDtWind.x, try o["uExtent"].num(), "\(at) uExtent")
          assertFloat(u.extentDtWind.y, try o["uDt"].num(), "\(at) uDt")
          assertFloat(u.extentDtWind.z, wv[0], "\(at) uWindV.x")
          assertFloat(u.extentDtWind.w, wv[1], "\(at) uWindV.y")
          for k in 0..<4 { assertFloat(u.uDecay[k], decay[k], "\(at) uDecay[\(k)]") }
          assertFloat(u.texelDiffuse.x, texel[0], "\(at) uTexel.x")
          assertFloat(u.texelDiffuse.y, texel[1], "\(at) uTexel.y")
          assertFloat(u.texelDiffuse.z, try o["uDiffuse"].num(), "\(at) uDiffuse")
          let wc = try o["center"].nums()
          assertBits([win.center.x, win.center.y], wc, "\(at) centre")
          XCTAssertEqual(try o["countAfter"].requireInt(), 0)
          updates += 1
        }
      }
    }
    XCTAssertGreaterThan(updates, 10)
  }
}
