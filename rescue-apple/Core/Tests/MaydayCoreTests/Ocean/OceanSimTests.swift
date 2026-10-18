// systems/ocean.js (+ ocean/{waves,features,memory,coast,grid}.js) vs Node 22: the time-stepped runs of
// Tests/Vectors/ocean/run_*.json (tools/export/export-sim.mjs): every ocean uniform, the internal state
// (focus, streak / detail frames, searchlight, splash and glint pools, features, wave bank, water-memory
// window, queue and drawn stamps) compared frame by frame, plus the CPU mirror queries; and the
// FeatureSet lifecycle of ocean/features.json.
import XCTest
@testable import MaydayCore

final class OceanSimTests: XCTestCase {
  private func check(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws {
    let r = try OceanRun(name)
    let fields = try r.v.data["fields"].strings.orThrow("fields")
    let got = try r.run()
    if let n = got.rows.first?.count { XCTAssertEqual(n, fields.count, "\(name): probe has \(n) fields, export \(fields.count)", file: file, line: line) }

    let want = try r.v.sidecarF64(r.v.data["rows"])
    let every = try r.v.data["every"].int.orThrow("every")
    let width = fields.count
    XCTAssertEqual(got.rows.count * width, want.count, "\(name): row count", file: file, line: line)
    var rowFail: String?
    rows: for (i, row) in got.rows.enumerated() where (i + 1) * width <= want.count {
      for k in 0..<min(width, row.count) where !Bits.equal(row[k], want[i * width + k]) {
        rowFail = "frame \((i + 1) * every - 1) field \(fields[k]): \(Bits.describe(row[k], want[i * width + k]))"
        break rows
      }
    }
    if let m = rowFail { XCTFail("\(name): first divergent row — \(m)", file: file, line: line) }

    let wantHash = try r.v.sidecarBytes(r.v.data["hashes"])
    let hashEvery = try r.v.data["hashEvery"].int.orThrow("hashEvery")
    var hashes = [UInt32]()
    for i in stride(from: 0, to: wantHash.count, by: 4) {
      hashes.append(UInt32(wantHash[i]) | UInt32(wantHash[i + 1]) << 8 | UInt32(wantHash[i + 2]) << 16 | UInt32(wantHash[i + 3]) << 24)
    }
    XCTAssertEqual(got.hashes.count, hashes.count, "\(name): hash count", file: file, line: line)
    if let i = zip(got.hashes, hashes).enumerated().first(where: { $0.element.0 != $0.element.1 })?.offset {
      XCTFail("\(name): state diverges at frame \((i + 1) * hashEvery - 1)", file: file, line: line)
      if let ff = r.firstFrame {
        let first = r.v.data["firstFrame"]
        if let p = first["probe"].doubles {
          for k in 0..<min(p.count, ff.probe.count) where !Bits.equal(ff.probe[k], p[k]) {
            XCTFail("\(name) frame 0 field \(fields[k]): \(Bits.describe(ff.probe[k], p[k]))", file: file, line: line)
            break
          }
        }
        let ex = first["extras"].array ?? []
        for (k, e) in ex.enumerated() where k < ff.extras.count {
          if let d = e.doubles { assertBitEqual(ff.extras[k], d, "\(name) frame 0 extras[\(k)]", file: file, line: line) }
        }
      }
    }

    let ev = try r.v.data["events"].array.orThrow("events")
    XCTAssertEqual(r.log.count, ev.count, "\(name): event count", file: file, line: line)
    for (i, (a, b)) in zip(r.log, ev).enumerated() where !jsonEqual(a, b) {
      XCTFail("\(name): events[\(i)]: got \(a), want \(b)", file: file, line: line)
      break
    }
    let q = try r.v.data["queries"].array.orThrow("queries")
    XCTAssertEqual(r.queries.count, q.count, "\(name): query count", file: file, line: line)
    for (i, (a, b)) in zip(r.queries, q).enumerated() where !jsonEqual(a, b) {
      XCTFail("\(name): queries[\(i)]:\n  got  \(a)\n  want \(b)", file: file, line: line)
      break
    }
  }

  /// Real weather (squall → storm → clearing, sea strikes → splash + scar stamps) driving the ocean at
  /// high quality: shoals, rogue / vortex / whirlpool lifecycle with eviction, splash-pool wrap, glint
  /// top-8, searchlight on / auto-off, explicit and derived downwash, wakes, every stamp kind, a terrain
  /// coast bake, a pause, quality medium (memory 384) then low (no memory: analytic fallbacks), heli loss.
  func testStormRun() throws { try check("run_storm") }

  /// Stub weather (every `??` fallback of _updateLook / _fallbackSea), no water-memory support.
  func testStubWeatherRun() throws { try check("run_stub") }

  // ---- ocean/features.js lifecycle --------------------------------------------------------------------
  func testFeatureLifecycle() throws {
    let v = try VectorLoader.load("ocean/features")
    let pts = try v.data["points"].requireArray("points").map { try $0.doublesOrFail("pt") }
    let ops = try v.data["ops"].requireArray("ops")
    let steps = try v.data["steps"].requireArray("steps")
    XCTAssertEqual(ops.count, steps.count)
    let fs = FeatureSet()
    for (i, op) in ops.enumerated() where i < steps.count {
      let kind = op[0].string ?? ""
      switch kind {
      case "set":
        fs.set(op[1].string ?? "", OceanRun.featureSpec(op[2]))
      case "remove": fs.remove(op[1].string ?? "")
      case "update": for _ in 0..<(op[1].int ?? 0) { fs.update(1.0 / 60) }
      case "downwash": fs.setDownwash(op[1].double ?? .nan, op[2].double ?? .nan, op[3].double ?? .nan, op[4].double ?? .nan)
      case "clear": fs.clear()
      default: XCTFail("unknown op \(kind)")
      }
      let s = steps[i]
      let label = s["label"].string ?? "#\(i)"
      XCTAssertEqual(fs.count, s["count"].int, "\(label) count")
      XCTAssertEqual(fs.active, s["active"].bool, "\(label) active")
      XCTAssertEqual(fs.slots.map { $0.id }, s["slots"].strings ?? [], "\(label) slots")
      assertBitEqual(fs.residual, try s["residual"].doubleOrFail("residual"), "\(label) residual")
      assertFloatBitEqual(fs.uA, try s["uA"].doublesOrFail("uA"), "\(label) uA")
      assertFloatBitEqual(fs.uB, try s["uB"].doublesOrFail("uB"), "\(label) uB")
      assertFloatBitEqual(fs.uC, try s["uC"].doublesOrFail("uC"), "\(label) uC")
      assertFloatBitEqual(fs.downwash, try s["downwash"].doublesOrFail("downwash"), "\(label) downwash")
      assertBitEqual(pts.map { fs.heightAt($0[0], $0[1], $0[2]) }, try s["h"].doublesOrFail("h"), "\(label) heightAt")
      var flow = [Double]()
      for p in pts {
        let f = fs.flowAt(p[0], p[1])
        flow += [f.x, f.y]
      }
      let wantFlow = try s["f"].requireArray("f").flatMap { try $0.doublesOrFail("f") }
      assertBitEqual(flow, wantFlow, "\(label) flowAt")
    }
  }
}

final class SimQueryConformanceTests: XCTestCase {
  /// The ported systems plug into the heli / camera context as its query protocols.
  func testWeatherAndOceanAsQueries() throws {
    let events = EventBus()
    let settings = GameSettings(storage: MemoryStorage())
    let look = try WeatherFixtures.freshLook()
    let w = WeatherSim(tables: try WeatherFixtures.tables(), events: events, settings: settings, look: look, noise: SimplexNoise2D(seed: 1337),
                       mode: .play)
    let o = OceanSim(tables: try OceanFixtures.tables(), events: events, settings: settings, look: look)
    o.weather = w
    w.start()
    o.start()
    w.update(1.0 / 60)
    o.update(1.0 / 60)
    let wq: WeatherQuery = w
    let oq: OceanQuery = o
    let r = try XCTUnwrap(wq.readout)
    XCTAssertEqual(r.turbulence, w.state.turbulence)
    XCTAssertEqual(r.sunDirShadow, w.state.sunDirShadow)
    XCTAssertEqual(r.palette?.sunIntensity, w.state.palette.sunIntensity)
    let v = wq.windAt(12, -7)
    XCTAssertEqual(v, w.windAt(12, -7))
    XCTAssertEqual(oq.heightAt(3, 4), o.heightAt(3, 4, tOffset: 0))
    XCTAssertEqual(oq.normalAt(3, 4), o.normalAt(3, 4, tOffset: 0))
    XCTAssertTrue(oq.acceptsGlints)
    oq.addGlint(1, 2, 3, 0.5, Color3(0.25, 0.5, 1))
    o.lateUpload()
    XCTAssertEqual(o.uniforms.uGlintCount, 1)
    XCTAssertEqual(o.uniforms.uGlintCol[0], 0.25)
    oq.setSearchlight(origin: V3(0, 30, 0), dir: V3(0, -2, 0), cosOuter: 0.9, level: 1.5)
    XCTAssertEqual(o.search.dir, V3(0, -1, 0))
    XCTAssertEqual(o.search.i, 1.5)
  }
}
