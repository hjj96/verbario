// ocean/waves.js WaveBank vs Node 22: Tests/Vectors/ocean/wavebank_<preset>.json (8 presets).
// Every number bit-exact: bank state after update, heightAt / normalAt / velocityAt on 13×13 (near)
// and 11×11 (wide) grids around two foci at t ∈ {0, 12.5, 600.25}, tOff look-ahead, forward(),
// plus (storm) the 30 s calm→storm amplitude blend and the medium-quality bank.
import XCTest
@testable import MaydayCore

final class WaveBankTests: XCTestCase {
  static let presets = ["calm", "overcast", "squall", "storm", "nightStorm", "fog", "clearing", "nightCalm"]

  struct Setup {
    let seed: Double
    let missionSeed: Double
    let windAngle: Double
    let baseAngle: Double
    let swellOffset: Double
    let sea: SeaState
    let shortScale: Double
    let waves: Int
    let gridN: Int
  }

  private func setup(_ v: VectorFile) throws -> Setup {
    let s = v.data["setup"]
    return Setup(
      seed: try s["seed"].doubleOrFail("seed"),
      missionSeed: try s["missionSeed"].doubleOrFail("missionSeed"),
      windAngle: try s["windAngle"].doubleOrFail("windAngle"),
      baseAngle: try s["baseAngle"].doubleOrFail("baseAngle"),
      swellOffset: try s["swellOffset"].doubleOrFail("swellOffset"),
      sea: SeaState(json: s["sea"]),
      shortScale: try s["shortScale"].doubleOrFail("shortScale"),
      waves: try s["quality"]["waves"].requireInt("quality.waves"),
      gridN: try s["quality"]["gridN"].requireInt("quality.gridN"))
  }

  private func makeBank(_ s: Setup, waves: Int? = nil, gridN: Int? = nil) -> WaveBank {
    let bank = WaveBank()
    bank.setQuality(waves ?? s.waves, gridN ?? s.gridN)
    bank.setSeed(s.seed, s.baseAngle)
    return bank
  }

  private func checkState(_ bank: WaveBank, _ st: JSONValue, _ label: String) throws {
    assertBitEqual(bank.a, try st["a"].doublesOrFail("a"), "\(label) a")
    assertBitEqual(bank.aTarget, try st["aTarget"].doublesOrFail("aTarget"), "\(label) aTarget")
    assertBitEqual(bank.b, try st["b"].doublesOrFail("b"), "\(label) b")
    assertBitEqual(bank.phase, try st["phase"].doublesOrFail("phase"), "\(label) phase")
    assertBitEqual(bank.phi0, try st["phi0"].doublesOrFail("phi0"), "\(label) phi0")
    assertBitEqual(bank.Dx, try st["Dx"].doublesOrFail("Dx"), "\(label) Dx")
    assertBitEqual(bank.Dz, try st["Dz"].doublesOrFail("Dz"), "\(label) Dz")
    assertBitEqual(bank.align, try st["align"].doublesOrFail("align"), "\(label) align")
    assertFloatBitEqual(bank.uWaveA, try st["uWaveA"].doublesOrFail("uWaveA"), "\(label) uWaveA")
    assertFloatBitEqual(bank.uWaveB, try st["uWaveB"].doublesOrFail("uWaveB"), "\(label) uWaveB")
    let s = st["stats"]
    assertBitEqual(bank.stats.Hs, try s["Hs"].doubleOrFail("Hs"), "\(label) stats.Hs")
    assertBitEqual(bank.stats.HsEff, try s["HsEff"].doubleOrFail("HsEff"), "\(label) stats.HsEff")
    assertBitEqual(bank.stats.Lp, try s["Lp"].doubleOrFail("Lp"), "\(label) stats.Lp")
    assertBitEqual(bank.stats.K, try s["K"].doubleOrFail("K"), "\(label) stats.K")
    assertBitEqual(bank.stats.sigma, try s["sigma"].doubleOrFail("sigma"), "\(label) stats.sigma")
    assertBitEqual(bank.stats.Q, try s["Q"].doubleOrFail("Q"), "\(label) stats.Q")
    assertBitEqual(bank.stats.crestNorm ?? .nan, try s["crestNorm"].doubleOrFail("crestNorm"), "\(label) stats.crestNorm")
  }

  /// heightAt / normalAt (/ velocityAt) on focus + (dx, dz), "for dz in axis, for dx in axis".
  private func checkGrid(_ bank: WaveBank, focus: [Double], axis: [Double], tOff: Double, expected g: JSONValue,
                         velocity: Bool, _ label: String) throws {
    var h = [Double](), n = [Double](), vel = [Double]()
    for dz in axis {
      for dx in axis {
        let x = focus[0] + dx, z = focus[1] + dz
        h.append(bank.heightAt(x, z, tOff))
        let nn = bank.normalAt(x, z, tOff)
        n.append(contentsOf: [nn.x, nn.y, nn.z])
        if velocity {
          let vv = bank.velocityAt(x, z, tOff)
          vel.append(contentsOf: [vv.x, vv.y, vv.z])
        }
      }
    }
    assertBitEqual(h, try g["height"].doublesOrFail("height"), "\(label) heightAt")
    assertBitEqual(n, try g["normal"].doublesOrFail("normal"), "\(label) normalAt")
    if velocity { assertBitEqual(vel, try g["velocity"].doublesOrFail("velocity"), "\(label) velocityAt") }
  }

  private func runPreset(_ name: String) throws {
    let v = try VectorLoader.load("ocean/wavebank_\(name)")
    let s = try setup(v)
    XCTAssertEqual(v.data["setup"]["preset"].string, name)

    // seed + swell-direction derivation (ocean.js _reset) and the clearing → shortScale rule (ocean.js update)
    assertBitEqual(SeedFormulas.oceanSwellOffset(s.missionSeed), s.swellOffset, "\(name) swellOffset")
    assertBitEqual(s.windAngle + s.swellOffset, s.baseAngle, "\(name) baseAngle")
    assertBitEqual(SeedFormulas.oceanSeed(s.missionSeed), s.seed, "\(name) bank seed")
    assertBitEqual(OceanCPU.shortScale(s.sea), s.shortScale, "\(name) shortScale")

    let near = try v.data["grids"]["near"].doublesOrFail("grids.near")
    let wide = try v.data["grids"]["wide"].doublesOrFail("grids.wide")
    let bank = makeBank(s)
    let cases = try v.data["cases"].requireArray("cases")
    XCTAssertEqual(cases.count, 6)
    for (ci, c) in cases.enumerated() {
      let focus = try c["focus"].doublesOrFail("focus")
      let t = try c["t"].doubleOrFail("t")
      bank.update(0, t, s.sea, s.windAngle, s.shortScale, focus[0], focus[1])
      let label = "\(name) case \(ci) focus \(focus) t \(t)"
      try checkState(bank, c["state"], label)
      try checkGrid(bank, focus: focus, axis: near, tOff: 0, expected: c["near"], velocity: true, label + " near")
      try checkGrid(bank, focus: focus, axis: wide, tOff: 0, expected: c["wide"], velocity: false, label + " wide")
    }

    // tOff look-ahead (buoyancy): t = 12.5, focus 0, tOff 0.5
    let to = v.data["tOff"]
    let toFocus = try to["focus"].doublesOrFail("tOff.focus")
    bank.update(0, try to["t"].doubleOrFail("tOff.t"), s.sea, s.windAngle, s.shortScale, toFocus[0], toFocus[1])
    try checkGrid(bank, focus: toFocus, axis: near, tOff: try to["tOff"].doubleOrFail("tOff.tOff"), expected: to["near"],
                  velocity: true, "\(name) tOff")

    // storm extras: amplitude blend calm → storm (dt 1/60, 1800 steps) and the medium-quality bank
    let blend = v.data["blend"]
    if blend.exists {
      let calm = try setup(try VectorLoader.load("ocean/wavebank_calm"))
      let dt = try blend["dt"].doubleOrFail("blend.dt")
      let steps = try blend["steps"].requireInt("blend.steps")
      let b2 = makeBank(s)
      b2.update(dt, 0, calm.sea, s.windAngle, calm.shortScale, 0, 0)
      var trace = [Int: JSONValue]()
      for tr in blend["trace"].array ?? [] { if let k = tr["step"].int { trace[k] = tr } }
      XCTAssertEqual(trace.count, steps / 60)
      for i in 1...steps {
        b2.update(dt, Double(i) / 60, s.sea, s.windAngle, s.shortScale, 0, 0)
        if let tr = trace[i] {
          assertBitEqual(b2.a, try tr["a"].doublesOrFail("trace.a"), "\(name) blend step \(i) a")
          assertBitEqual(b2.stats.HsEff, try tr["HsEff"].doubleOrFail("trace.HsEff"), "\(name) blend step \(i) HsEff")
        }
      }
      try checkState(b2, blend["final"]["state"], "\(name) blend final")
      try checkGrid(b2, focus: [0, 0], axis: near, tOff: 0, expected: blend["final"]["near"], velocity: true, "\(name) blend final")
    }
    let medium = v.data["medium"]
    if medium.exists {
      let b3 = makeBank(s, waves: try medium["waves"].requireInt("medium.waves"), gridN: try medium["gridN"].requireInt("medium.gridN"))
      let mf = try medium["focus"].doublesOrFail("medium.focus")
      b3.update(0, try medium["t"].doubleOrFail("medium.t"), s.sea, s.windAngle, s.shortScale, mf[0], mf[1])
      try checkState(b3, medium["state"], "\(name) medium")
      try checkGrid(b3, focus: mf, axis: near, tOff: 0, expected: medium["near"], velocity: true, "\(name) medium")
    }

    // forward(px, pz, 0) at t = 12.5, focus 0
    bank.update(0, 12.5, s.sea, s.windAngle, s.shortScale, 0, 0)
    for row in try v.data["forward"]["values"].requireArray("forward.values") {
      let r = try row.doublesOrFail("forward row")
      let o = bank.forward(r[0], r[1], 0)
      assertBitEqual(o.x, r[2], "\(name) forward(\(r[0]), \(r[1])).x")
      assertBitEqual(o.y, r[3], "\(name) forward(\(r[0]), \(r[1])).y")
      assertBitEqual(o.z, r[4], "\(name) forward(\(r[0]), \(r[1])).z")
    }
  }

  func testCalm() throws { try runPreset("calm") }
  func testOvercast() throws { try runPreset("overcast") }
  func testSquall() throws { try runPreset("squall") }
  func testStorm() throws { try runPreset("storm") }
  func testNightStorm() throws { try runPreset("nightStorm") }
  func testFog() throws { try runPreset("fog") }
  func testClearing() throws { try runPreset("clearing") }
  func testNightCalm() throws { try runPreset("nightCalm") }

  func testConstructorMatchesWebDefaults() {
    let bank = WaveBank()
    XCTAssertEqual(bank.count, 8)
    XCTAssertEqual(bank.L, [120, 78, 52, 34, 22, 14.5, 9.5, 6.2])
    // setSeed(1, 0) in the constructor: phases from mulberry32(1)
    var r = Mulberry32(seed: 1)
    for i in 0..<8 { assertBitEqual(bank.phi0[i], r.next() * (JS.PI * 2), "phi0[\(i)]") }
    XCTAssertTrue(bank.snap)
    XCTAssertNil(bank.stats.crestNorm)
    bank.update(0, 1, SeaState(Hs: 2), 0.3, 1, 0, 0)
    XCTAssertEqual(bank.waveA4.count, 8)
    XCTAssertEqual(bank.waveA4[5], SIMD4<Float>(bank.uWaveA[20], bank.uWaveA[21], bank.uWaveA[22], bank.uWaveA[23]))
    XCTAssertEqual(bank.waveB4[7].z, Float(6.2))
  }

  func testFeaturesAddToHeight() {
    let bank = WaveBank()
    bank.update(0, 3, SeaState(Hs: 1.2, swellAdd: 0.3, Q: 0.4), 0.2, 1, 0, 0)
    let h0 = bank.heightAt(5, -7)
    let fs = FeatureSet()
    fs.setDownwash(5, -7, 10, 1)
    bank.features = fs
    let p = bank.invert(5, -7)
    assertBitEqual(bank.heightAt(5, -7), bank.eval(p.px, p.pz, 0, false).y + fs.heightAt(p.px, p.pz, 0), "height with features")
    XCTAssertLessThan(bank.heightAt(5, -7), h0)
    XCTAssertEqual(bank.featureLiftAt(5, -7), fs.heightAt(p.px, p.pz, 0))
  }
}
