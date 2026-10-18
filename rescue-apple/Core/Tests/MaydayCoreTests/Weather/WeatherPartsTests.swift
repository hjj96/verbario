// The weather helpers on their own vs Node 22 (tools/export/export-sim.mjs): lightning envelopes
// (photosensitivity rules), gust fronts (spawn / recycle / schedule / addWindAt), the sun rig
// (WeatherLights: swing, shadow box, texel snap, quality tiers) and the «Смена» planner.
import XCTest
@testable import MaydayCore

final class WeatherPartsTests: XCTestCase {
  // ---- weather/lightning.js envelope / envelopeReduced ----------------------------------------------
  func testLightningEnvelopes() throws {
    let v = try VectorLoader.load("weather/lightning")
    let t = try WeatherFixtures.tables()
    let c = v.data["constants"]
    XCTAssertEqual(c["MAX_CHARGES"].int, t.maxCharges)
    XCTAssertEqual(c["MIN_GAP"].double, t.minGap)
    XCTAssertEqual(c["MIN_GAP_REDUCED"].double, t.minGapReduced)
    var got = [Double](), want = [Double]()
    for row in try v.data["envelope"].requireArray("envelope") {
      let x = try row[0].doubleOrFail("t")
      got += [LightningSim.envelope(x), LightningSim.envelopeReduced(x)]
      want += [try row[1].doubleOrFail("envelope"), try row[2].doubleOrFail("envelopeReduced")]
    }
    XCTAssertGreaterThan(got.count, 900)
    assertBitEqual(got, want, "envelope / envelopeReduced")
    // the reduced pulse never exceeds its 0.3 peak scale input (DESIGN §2.12) and ends by 0.72 s
    XCTAssertEqual(LightningSim.envelopeReduced(0.72), 0)
  }

  // ---- weather/gusts.js -------------------------------------------------------------------------------
  private func snap(_ g: GustFronts) -> JSONValue {
    .array(g.activeSlots.map { s in
      let f = g.pool[s]
      return .array([.number(Double(s))] + [f.x, f.z, f.dirX, f.dirZ, f.strength, f.baseStrength, f.eta, f.speed, f.age, f.fade].map(jsNum)
        + [.bool(f.harmless)])
    })
  }

  func testGustFronts() throws {
    let v = try VectorLoader.load("weather/gusts")
    let t = try WeatherFixtures.tables()
    let rng = Rng(seed: 77)
    let settings = GameSettings(storage: MemoryStorage())
    settings.set("difficulty", "pilot")
    let g = GustFronts(tables: t, rng: rng, settings: settings)
    let wd = V2(0.6, -0.8)
    let ops = try v.data["ops"].requireArray("ops")
    var k = 0
    func expect(_ got: JSONValue, _ what: String) {
      guard k < ops.count else { return XCTFail("ops: missing \(what)") }
      XCTAssertTrue(jsonEqual(got, ops[k]), "\(what):\n  got  \(got)\n  want \(ops[k])")
      k += 1
    }
    g.reset()
    expect(.array([.string("reset"), jsNum(g.timer)]), "reset")
    for i in 0..<4 {
      let op = ops[k]
      let (x, z) = (op[1].double ?? .nan, op[2].double ?? .nan)
      let o = op[3]
      var so = GustFronts.SpawnOptions()
      if let s = o["strength"].double { so.strength = s }
      if let e = o["eta"].double { so.eta = e }
      if let d = o["dir"].doubles { so.dir = V2(d[0], d[1]) }
      so.harmless = o["harmless"].jsTruthy
      let slot = g.spawn(x, z, wd, 7, so)
      expect(.array([.string("spawn"), op[1], op[2], o, .number(Double(slot)), snap(g)]), "spawn \(i)")
    }
    settings.set("difficulty", "cadet")
    for _ in 0..<30 { _ = g.update(0.1, 5, 5, wd, 7, 0, 0, false) }
    let s5 = g.spawn(1, 2, wd, 7, GustFronts.SpawnOptions(strength: 3)) // pool full → recycles the oldest
    var o5 = JSONObject()
    o5.set("strength", .number(3))
    expect(.array([.string("spawn"), .number(1), .number(2), .object(o5), .number(Double(s5)), snap(g), .string("cadet")]), "recycle")
    settings.set("difficulty", "pilot")

    let grid = try v.data["grid"].requireArray("grid").map { (x: $0[0].double ?? .nan, z: $0[1].double ?? .nan) }
    let trace = try v.data["trace"].requireArray("trace")
    XCTAssertEqual(trace.count, 900)
    for step in 0..<900 {
      let spawned = g.update(1.0 / 30, 5 + Double(step) * 0.1, 5, wd, 9, 6, 0.05, step < 700)
      let want = trace[step]
      var row: [JSONValue] = [.number(Double(step)), .number(Double(spawned ?? -1)), jsNum(g.timer),
                              spawned != nil || step % 5 == 0 ? snap(g) : .null]
      if step % 100 == 0 {
        row.append(.array(grid.map { p in
          var w = V2(0.5, -1)
          g.addWindAt(p.x, p.z, &w)
          return .array([jsNum(w.x), jsNum(w.y)])
        }))
      }
      if !jsonEqual(.array(row), want) {
        return XCTFail("gust trace step \(step):\n  got  \(JSONValue.array(row))\n  want \(want)")
      }
    }
  }

  // ---- weather/lights.js (sun rig) --------------------------------------------------------------------
  func testSunRig() throws {
    let v = try VectorLoader.load("weather/sunrig")
    let t = try WeatherFixtures.tables()
    let rng = Rng(seed: 4242)
    var pal = Palette()
    pal.sunIntensity = 2.4
    pal.sun = PaletteColor(1, 0.8, 0.6)
    pal.shadowIntensity = 0.7
    pal.shadowRadius = 3
    pal.ambient = PaletteColor(0.4, 0.5, 0.6)
    pal.ambientGround = PaletteColor(0.1, 0.12, 0.1)
    pal.ambientIntensity = 0.8
    var st = WeatherState(presetLabel: "", flashColor: PaletteColor(0.7, 0.8, 1), palette: pal, palettePrev: pal, paletteNext: pal,
                          front: WeatherState.Front(speed: t.frontSpeed, width: t.frontWidth))
    st.sunDir = V3()
    for c in try v.data["cases"].requireArray("cases") {
      let q = c["quality"].string
      let L = WeatherLights(tables: t, quality: q)
      st.sunDirShadow = V3(0.3, 0.8, -0.52).normalized()
      let steps = try c["steps"].requireArray("steps")
      let trace = try c["trace"].requireArray("trace")
      XCTAssertEqual(steps.count, trace.count)
      for (i, s) in steps.enumerated() where i < trace.count {
        if let d = s["sunDirShadow"].doubles { st.sunDirShadow = V3(d[0], d[1], d[2]) }
        if let w = s["swing"].doubles { L.swing(w[0], w[1], w[2], w[3], rng) }
        st.flash = s["flash"].double ?? 0
        let f = try s["focus"].doublesOrFail("focus"), cam = try s["cam"].doublesOrFail("cam")
        L.update(try s["dt"].doubleOrFail("dt"), &st, focus: V3(f[0], f[1], f[2]), alt: try s["alt"].doubleOrFail("alt"),
                 camFocus: V3(cam[0], cam[1], cam[2]))
        let o = L.state
        let got = [L.swingT, L.swingDir.x, L.swingDir.y, L.swingDir.z, st.sunDir.x, st.sunDir.y, st.sunDir.z, o.intensity,
                   o.color.r, o.color.g, o.color.b, o.shadowIntensity, o.shadowRadius, o.hemiColor.r, o.hemiColor.g, o.hemiColor.b,
                   o.hemiGroundColor.r, o.hemiGroundColor.g, o.hemiGroundColor.b, o.hemiIntensity, o.target.x, o.target.y, o.target.z,
                   o.position.x, o.position.y, o.position.z, Double(o.mapSize), L.shadowLayer1 ? 1 : 0]
        assertBitEqual(got, try trace[i].doublesOrFail("trace"), "sunrig \(q ?? "nil") step \(i)")
      }
    }
  }

  // ---- weather/endless.js -----------------------------------------------------------------------------
  func testEndlessPlanner() throws {
    let v = try VectorLoader.load("weather/endless")
    let t = try WeatherFixtures.tables()
    let en = EndlessPlanner(tables: t, rng: Rng(seed: 20261016))
    var preset = "calm"
    en.start(9.0 / 24)
    let trace = try v.data["trace"].requireArray("trace")
    XCTAssertEqual(trace.count, 1200)
    for s in 1...1200 {
      let tod = (9.0 / 24 + (Double(s) * 30) / 86400).truncatingRemainder(dividingBy: 1)
      let go = en.update(1, preset: preset, timeOfDay: tod)
      if let g = go { preset = g.to }
      var list = [JSONValue]()
      en.forEachUpcoming(timeOfDay: tod) { list.append(.array([jsNum($0), .string($1)])) }
      let up = en.upcoming(timeOfDay: tod)
      let next: JSONValue = en.next.map { .array([jsNum($0.at), .string($0.preset), jsNum($0.over), .bool($0.lull)]) } ?? .null
      let row: JSONValue = .array([
        .number(Double(s)), go.map { .string($0.to) } ?? .null, go.map { jsNum($0.over) } ?? .null, .string(en.phase.rawValue), next,
        en.nightPick.map { .string($0) } ?? .null, jsNum(en.intensity()), .array(list),
        up.map { .array([jsNum($0.in), .string($0.preset)]) } ?? .null,
      ])
      if !jsonEqual(row, trace[s - 1]) {
        return XCTFail("endless second \(s):\n  got  \(row)\n  want \(trace[s - 1])")
      }
    }
  }
}
