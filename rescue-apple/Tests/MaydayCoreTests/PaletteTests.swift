// weather/palette.js vs Node 22: Tests/Vectors/weather/palette.json (+ Resources/Data palette/weather).
import XCTest
@testable import MaydayCore

final class PaletteTests: XCTestCase {
  private func tables() throws -> PaletteTables { try PaletteTables(catalog: try VectorLoader.catalog()) }

  func testGeneratedLayoutMatchesExport() throws {
    let pal = try VectorLoader.catalog().data("palette")["weather/palette"]
    let layout = try pal["LAYOUT"].requireArray("LAYOUT")
    XCTAssertEqual(layout.count, Palette.layout.count, "re-run tools/codegen/palette-swift.mjs")
    for (i, e) in layout.enumerated() where i < Palette.layout.count {
      let s = Palette.layout[i]
      XCTAssertEqual(e["key"].string, s.key)
      XCTAssertEqual(e["kind"].string, s.kind.rawValue)
      XCTAssertEqual(e["ch"].int, s.ch)
      XCTAssertEqual(e["group"].string, s.group)
      XCTAssertEqual(e["o"].int, s.o)
      XCTAssertEqual(e["size"].int, s.size)
    }
    XCTAssertEqual(pal["SLOTS"].int, Palette.slots)
    let t = try tables()
    XCTAssertEqual(t.slotChannel.map { Double($0) }, try pal["SLOT_CHANNEL"].doublesOrFail("SLOT_CHANNEL"))
    for (k, v) in pal["OFF"].object?.entries ?? [] { XCTAssertEqual(t.off[k], v.int, "OFF[\(k)]") }
    assertBitEqual(t.greenTarget, try pal["GREEN_TARGET"].doublesOrFail("GREEN_TARGET"), "GREEN_TARGET")
    let gm = try pal["GREEN_MUL"].requireArray("GREEN_MUL")
    XCTAssertEqual(gm.count, t.greenMul.count)
    for (i, p) in gm.enumerated() where i < t.greenMul.count {
      XCTAssertEqual(p[0].int, t.greenMul[i].0)
      XCTAssertEqual(p[1].double, t.greenMul[i].1)
    }
    // the exported COMPILED arrays equal what we compile from weather.json PRESETS
    for name in t.presetNames {
      assertBitEqual(t.compiled[name] ?? [], try pal["COMPILED"][name].doublesOrFail(name), "palette.json COMPILED.\(name)")
    }
  }

  func testSRGBToLinear() throws {
    let v = try VectorLoader.load("weather/palette")
    let rows = try v.data["srgbToLinear"]["values"].requireArray("srgbToLinear")
    XCTAssertGreaterThan(rows.count, 50)
    var got = [Double](), want = [Double]()
    for r in rows {
      let hex = try r[0].requireString("hex")
      guard let c = SRGB.color(hex) else {
        XCTFail("cannot parse \(hex)")
        continue
      }
      got.append(contentsOf: [c.r, c.g, c.b])
      want.append(contentsOf: [try r[1].doubleOrFail("r"), try r[2].doubleOrFail("g"), try r[3].doubleOrFail("b")])
    }
    assertBitEqual(got, want, "THREE.Color.set(hex)")
  }

  func testCompiledPresets() throws {
    let v = try VectorLoader.load("weather/palette")
    let t = try tables()
    for (name, arr) in v.data["compiled"].object?.entries ?? [] {
      assertBitEqual(t.compiled[name] ?? [], try arr.doublesOrFail(name), "compilePreset(\(name))")
    }
  }

  func testBlendGreenUnpack() throws {
    let v = try VectorLoader.load("weather/palette")
    let t = try tables()
    for b in try v.data["blendPacked"].requireArray("blendPacked") {
      let a = try b["a"].requireString("a"), bb = try b["b"].requireString("b")
      for c in try b["cases"].requireArray("cases") {
        let tt = try c["t"].doublesOrFail("t")
        var out = [Double](repeating: 0, count: t.slots)
        t.blendPacked(&out, t.compiled[a] ?? [], t.compiled[bb] ?? [], tt)
        assertBitEqual(out, try c["out"].doublesOrFail("out"), "blendPacked(\(a), \(bb), \(tt))")
      }
    }
    for g in try v.data["applyGreen"].requireArray("applyGreen") {
      let preset = try g["preset"].requireString("preset")
      let amount = try g["g"].doubleOrFail("g")
      var out = t.compiled[preset] ?? []
      t.applyGreen(&out, amount)
      assertBitEqual(out, try g["out"].doublesOrFail("out"), "applyGreen(\(preset), \(amount))")
    }
    // unpack(blendPacked(calm, nightStorm, [0.5, 0.5, 0.5, 0.5]))
    var packed = [Double](repeating: 0, count: t.slots)
    t.blendPacked(&packed, t.compiled["calm"] ?? [], t.compiled["nightStorm"] ?? [], [0.5, 0.5, 0.5, 0.5])
    var p = Palette()
    p.unpack(packed)
    let ref = v.data["unpack"]["palette"]
    var checked = 0
    for e in Palette.layout {
      let node = e.group.isEmpty ? ref[e.key] : ref[e.group][e.key]
      let want: [Double]
      switch e.kind {
      case .color: want = try node["lin"].doublesOrFail("\(e.offKey).lin")
      case .vec3: want = try node.doublesOrFail(e.offKey)
      case .angle, .num: want = [try node.doubleOrFail(e.offKey)]
      }
      assertBitEqual(p.components(group: e.group, key: e.key) ?? [], want, "unpack \(e.offKey)")
      checked += 1
    }
    XCTAssertEqual(checked, 72)
    XCTAssertEqual(p.seaState.Hs, p.sea.Hs)
  }
}
