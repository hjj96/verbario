// OceanSelftestTests — GPU oceanVertex() (Shaders/Ocean/OceanCommon.h, compute kernel) against the
// CPU wave bank forward evaluation, the native counterpart of rescue/src/systems/ocean/selftest.js
// (pass: p99 error < 0.05 m). Runs on the Mac test host (Apple GPU or any Metal device).
import XCTest
import Metal
@testable import MaydayApp

final class OceanSelftestTests: XCTestCase {
  private func warped(_ i: Int, _ n: Int) -> Double {
    let x = -1 + (2 * Double(i)) / Double(n)
    let s: Double = x > 0 ? 1 : (x < 0 ? -1 : 0)
    return s * pow(abs(x), 1.6) * 380
  }

  private func run(preset: String, quality: String) throws -> (p99: Double, max: Double, dampErr: Double) {
    let data = try DataBundle()
    let sim = try BootstrapSim(data: data, qualityName: quality, presetName: preset)
    let renderer = try Renderer(texturesDirectory: data.texturesDirectory, oceanConstants: sim.ocean.constants)
    var raw = RawInputFrame()
    raw.virtualAxes = ["moveX": 0.6, "moveY": 0.8]          // move the probe so the grid offset is non-zero
    var frame: RenderFrame?
    for _ in 0..<240 {
      sim.step(realDt: 1.0 / 60.0, raw: raw)
      frame = sim.renderFrame(internalWidth: 1280, internalHeight: 720, pxScale: 2, dt: 1.0 / 60.0)
    }
    guard let f = frame else { throw XCTSkip("no frame") }
    let ocean = sim.ocean
    let n = sim.quality.oceanGridN
    var pts: [SIMD2<Float>] = []
    for j in stride(from: 0, through: n, by: 5) {
      for i in stride(from: 0, through: n, by: 5) {
        pts.append(SIMD2<Float>(Float(warped(i, n)), Float(warped(j, n))))
      }
    }
    let gpu = try renderer.selftest.evaluate(points: pts, ocean: f.ocean, quality: sim.quality)
    XCTAssertEqual(gpu.count, pts.count)
    var errs: [Double] = []
    var dampErr = 0.0
    let ox = Double(f.ocean.offset.x)
    let oz = Double(f.ocean.offset.y)
    for (i, p) in pts.enumerated() {
      let cpu = ocean.forwardCPU(Double(p.x) + ox, Double(p.y) + oz)
      let g = gpu[i]
      errs.append(max(abs(Double(g.x) - cpu.x), abs(Double(g.y) - cpu.y), abs(Double(g.z) - cpu.z)))
      dampErr = max(dampErr, abs(Double(g.w) - ocean.edgeFadeCPU(Double(p.x), Double(p.y))))
    }
    errs.sort()
    let p99 = errs[Int(Double(errs.count - 1) * 0.99)]
    return (p99, errs.last ?? 0, dampErr)
  }

  func testStormHighMatchesCPU() throws {
    let r = try run(preset: "storm", quality: "high")
    XCTAssertLessThan(r.p99, 0.05, "p99 \(r.p99) m, max \(r.max) m")
    XCTAssertLessThan(r.dampErr, 1e-4)
  }

  func testCalmLowMatchesCPU() throws {
    let r = try run(preset: "calm", quality: "low")
    XCTAssertLessThan(r.p99, 0.05, "p99 \(r.p99) m, max \(r.max) m")
  }

  func testGridBuffersAndSnapQuantum() throws {
    let data = try DataBundle()
    let sim = try BootstrapSim(data: data, qualityName: "high", presetName: "calm")
    let renderer = try Renderer(texturesDirectory: data.texturesDirectory, oceanConstants: sim.ocean.constants)
    let grid = try renderer.ocean.mesh(n: 300)
    XCTAssertEqual(grid.vertexCount, 305 * 305)            // N + 1 + 2·2 skirt rows per axis
    XCTAssertEqual(grid.indexCount, 304 * 304 * 6)
    // ocean/grid.js snapQuantum(300) = 608·(2/300)·(20/380)^0.375
    XCTAssertEqual(sim.ocean.snapQuantum, 608 * (2.0 / 300.0) * pow(20.0 / 380.0, 0.375), accuracy: 1e-9)
  }
}
