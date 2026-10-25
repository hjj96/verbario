// Static parity vectors of the FX helpers (tools/export/export-survivors.mjs):
//   fx/common.json     strokeEnvelope / softEnvelope, isOrange / lum, QUALITY budgets, qualityOf
//   fx/lightpool.json  a scripted crowd of virtual light handles over many LightPool.update calls
// The time-stepped Effects traces are in Survivors/SurvivorsRunTests (they run with Survivors).
import XCTest
@testable import MaydayCore

final class FxStaticTests: XCTestCase {
  static func tables() throws -> FxTables { try FxTables(catalog: try VectorLoader.catalog()) }

  func testEnvelopes() throws {
    let v = try VectorLoader.load("fx/common")
    let rows = try v.sidecarF64(v.data["envelopes"])
    var got = [Double](), want = [Double]()
    for r in stride(from: 0, to: rows.count, by: 3) {
      got += [FxMath.strokeEnvelope(rows[r]), FxMath.softEnvelope(rows[r])]
      want += [rows[r + 1], rows[r + 2]]
    }
    XCTAssertGreaterThan(got.count, 1000)
    assertBitEqual(got, want, "lightning envelopes")
  }

  func testOrangeAndLuminance() throws {
    let d = try VectorLoader.load("fx/common").data
    for c in try d["colors"].requireArray() {
      let hex = try c[0].requireString()
      let col = Color3(try c[1].requireDouble(), try c[2].requireDouble(), try c[3].requireDouble())
      let parsed = Color3(style: hex)
      assertBitEqual([parsed.r, parsed.g, parsed.b], [col.r, col.g, col.b], "Color(\(hex))")
      XCTAssertEqual(FxMath.isOrange(col), c[4].bool, "isOrange(\(hex))")
      assertBitEqual(FxMath.lum(col), try c[5].requireDouble(), "lum(\(hex))")
    }
  }

  func testQualityBudgets() throws {
    let tables = try Self.tables()
    let d = try VectorLoader.load("fx/common").data
    let q = try d["QUALITY"].requireObject("QUALITY")
    XCTAssertEqual(Set(q.keys), Set(tables.quality.keys))
    for (name, b) in q.entries {
      let s = try XCTUnwrap(tables.quality[name], name)
      let want = FxBudget(rain: try b["rain"].requireInt(), motes: try b["motes"].requireInt(), downwash: try b["downwash"].requireInt(),
                          crest: try b["crest"].requireInt(), crestProbes: try b["crestProbes"].requireInt(), splash: try b["splash"].requireInt(),
                          smoke: try b["smoke"].requireInt(), glow: try b["glow"].requireInt(), scud: try b["scud"].requireInt(),
                          fogLayers: try b["fogLayers"].requireInt(), gulls: try b["gulls"].requireInt(), seaSmoke: b["seaSmoke"].bool ?? false,
                          dolphins: try b["dolphins"].requireInt(), jelly: try b["jelly"].requireInt())
      XCTAssertEqual(s, want, "QUALITY.\(name)")
    }
    for p in try d["qualityOf"].requireArray() {
      XCTAssertEqual(tables.qualityName(p[0].string), try p[1].requireString(), "qualityOf(\(p[0]))")
    }
  }

  /// The pool capacities Effects derives from the budgets (spray = downwash + crest + splash).
  func testPoolCapacities() throws {
    let tables = try Self.tables()
    for name in ["low", "medium", "high"] {
      let settings = StaticSettings(["quality": .string(name)])
      let ctx = SeaContext(events: EventBus(), settings: settings, random: { 0.5 })
      let fx = Effects(tables: tables, ctx: ctx)
      let b = try XCTUnwrap(tables.quality[name])
      XCTAssertEqual(fx.quality, name)
      XCTAssertEqual(fx.pools.spray.capacity, b.downwash + b.crest + b.splash, name)
      XCTAssertEqual(fx.pools.smoke.capacity, b.smoke, name)
      XCTAssertEqual(fx.pools.glow.capacity, b.glow, name)
      XCTAssertEqual(fx.gulls.limit, b.gulls, name)
      XCTAssertEqual(fx.dolphins.limit, b.dolphins, name)
      XCTAssertEqual(fx.whale.allowed, b.dolphins > 0, name)
    }
  }

  func testLightPoolScript() throws {
    let tables = try Self.tables()
    let d = try VectorLoader.load("fx/lightpool").data
    let lp = LightPool(physical: tables.physicalLights, hysteresis: tables.hysteresis)
    var air = FxAirUniforms()
    var live: [LightHandle] = []
    for (k, step) in try d["steps"].requireArray().enumerated() {
      for op in try step[0].requireArray() {
        switch try op[0].requireString() {
        case "acquire":
          live.append(lp.acquire(Color3(style: try op[1].requireString()), try op[2].requireDouble(), try op[3].requireDouble()))
        case "release":
          let i = try op[1].requireInt()
          live[i].release()
          if k % 5 == 0 { live[i].release() }
          live.remove(at: i)
        case "pos": live[try op[1].requireInt()].position = V3(try op[2].requireDouble(), try op[3].requireDouble(), try op[4].requireDouble())
        case "set": live[try op[1].requireInt()].set(try op[2].requireDouble())
        case "color": live[try op[1].requireInt()].setColor(Color3(style: try op[2].requireString()))
        case "distance": live[try op[1].requireInt()].setDistance(try op[2].requireDouble())
        case "update": lp.update(try op[1].requireDouble(), try op[2].requireDouble(), &air)
        case let o: XCTFail("unknown op \(o)")
        }
      }
      var st: [Double] = [Double(lp.handles.count), Double(lp.spare.count)]
      for h in live {
        st += [Double(lp.handles.firstIndex { $0 === h } ?? -1), Double(h.slot), h.score, h.intensity, h.distance, h.active ? 1 : 0]
      }
      for i in 0..<4 {
        let l = lp.lights[i]
        st += [l.intensity, l.distance, l.decay, l.position.x, l.position.y, l.position.z, l.color.r, l.color.g, l.color.b,
               lp.owner[i].map { o in Double(live.firstIndex { $0 === o } ?? -1) } ?? -1]
        let p = air.fxLightPos[i], c = air.fxLightCol[i]
        st += [p.x, p.y, p.z, p.w, c.x, c.y, c.z, c.w]
      }
      if assertBitEqual(st, try step[1].requireDoubles(), "lightpool step \(k)") > 0 { return }
    }
    lp.releaseAll()
    XCTAssertEqual([lp.handles.count, lp.spare.count], try d["afterReleaseAll"].requireDoubles().map { Int($0) })
  }
}
