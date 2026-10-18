// The constants the Swift heli / camera port hard-codes vs the web's own tables
// (Resources/Data/heli.json and camera.json, exported from the live modules by export-data.mjs).
import XCTest
@testable import MaydayCore

final class HeliDataTests: XCTestCase {
  private func eq(_ got: Double, _ json: JSONValue, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
    guard let want = json.double else { return XCTFail("\(what): missing in data", file: file, line: line) }
    assertBitEqual(got, want, what, file: file, line: line)
  }

  func testHeliTables() throws {
    let d = try VectorLoader.catalog().data("heli")
    // heli/model
    let model = d["heli/model"]
    eq(HeliModel.ROTOR_R, model["ROTOR_R"], "ROTOR_R")
    eq(HeliModel.TAIL_R, model["TAIL_R"], "TAIL_R")
    eq(HeliModel.SKID_Y, model["SKID_Y"], "SKID_Y")
    for (name, p) in HeliModel.Points.all {
      assertBitEqual([p.x, p.y, p.z], try model["POINTS"][name].requireDoubles(), "POINTS.\(name)")
    }
    for ch in HeliModel.Channel.allCases {
      XCTAssertEqual(model["CH"]["\(ch)"].int, ch.rawValue, "CH.\(ch)")
    }
    // heli
    let heli = d["heli"]
    XCTAssertEqual(try heli["PRESETS"].requireDoubles(), Helicopter.PRESETS)
    eq(Helicopter.ALT_MIN, heli["ALT_MIN"], "ALT_MIN")
    eq(Helicopter.ALT_MAX, heli["ALT_MAX"], "ALT_MAX")
    eq(Helicopter.IDLE_RPM, heli["IDLE_RPM"], "IDLE_RPM")
    eq(Helicopter.MAX_TILT, heli["MAX_TILT"], "MAX_TILT")
    // heli/flight
    let flight = d["heli/flight"]
    eq(FlightModel.STEP, flight["STEP"], "STEP")
    eq(FlightModel.K, flight["K"], "K")
    eq(FlightModel.C_WIND, flight["C_WIND"], "C_WIND")
    eq(FlightModel.A_BASE, flight["A_BASE"], "A_BASE")
    eq(FlightModel.OBSTACLE_MARGIN, flight["OBSTACLE_MARGIN"], "OBSTACLE_MARGIN")
    eq(FlightModel.D12, flight["D12"], "D12")
    eq(FlightModel.D5, flight["D5"], "D5")
    // heli/ops
    let ops = d["heli/ops"]
    for (k, v) in HeliOps.DIFF { eq(v, ops["DIFF"][k], "DIFF.\(k)") }
    XCTAssertEqual(ops["DIFF"].count, HeliOps.DIFF.count)
    eq(HeliOps.CRUISE, ops["CRUISE"], "CRUISE")
    eq(HeliOps.UNLOAD_PERSON, ops["UNLOAD_PERSON"], "UNLOAD_PERSON")
    eq(HeliOps.UNLOAD_STRETCHER, ops["UNLOAD_STRETCHER"], "UNLOAD_STRETCHER")
    XCTAssertEqual(ops["FLARES"].int, HeliOps.FLARES)
    XCTAssertEqual(ops["RAFTS"].int, HeliOps.RAFTS)
    eq(HeliOps.FLARE_RANGE, ops["FLARE_RANGE"], "FLARE_RANGE")
    eq(HeliOps.HORN_COOLDOWN, ops["HORN_COOLDOWN"], "HORN_COOLDOWN")
    // heli/winch
    let w = d["heli/winch"]
    XCTAssertEqual(w["SEGS"].int, Winch.SEGS)
    XCTAssertEqual(w["N"].int, Winch.N)
    eq(Winch.G, w["G"], "G")
    eq(Winch.MAX_LEN, w["MAX_LEN"], "MAX_LEN")
    eq(Winch.SLACK, w["SLACK"], "SLACK")
    eq(Winch.PAY, w["PAY"], "PAY")
    eq(Winch.LIFT_PERSON, w["LIFT_PERSON"], "LIFT_PERSON")
    eq(Winch.LIFT_STRETCHER, w["LIFT_STRETCHER"], "LIFT_STRETCHER")
    eq(Winch.BUFFER, w["BUFFER"], "BUFFER")
    eq(Winch.DAMP, w["DAMP"], "DAMP")
    eq(Winch.WINDOW_SPEED, w["WINDOW_SPEED"], "WINDOW_SPEED")
    eq(Winch.WINDOW_HEIGHT, w["WINDOW_HEIGHT"], "WINDOW_HEIGHT")
    eq(Winch.BASKET_FLOAT, w["BASKET_FLOAT"], "BASKET_FLOAT")
    eq(Winch.HOOK, w["HOOK"], "HOOK")
    XCTAssertEqual(w["RING_SEGS"].int, Winch.RING_SEGS)
    XCTAssertEqual(w["CAPTURE"].count, Winch.CAPTURE.count)
    for (k, v) in Winch.CAPTURE { assertBitEqual([v.r, v.t], try w["CAPTURE"][k].requireDoubles(), "CAPTURE.\(k)") }
    eq(Winch.MAX_CAPTURE_R, w["MAX_CAPTURE_R"], "MAX_CAPTURE_R")
    XCTAssertEqual(w["SNAG_R_FLOAT"].count, Winch.SNAG_R_FLOAT.count)
    for (k, v) in Winch.SNAG_R_FLOAT { eq(v, w["SNAG_R_FLOAT"][k], "SNAG_R_FLOAT.\(k)") }
    XCTAssertEqual(w["SNAG_R_DEBRIS"].count, Winch.SNAG_R_DEBRIS.count)
    for (k, v) in Winch.SNAG_R_DEBRIS { eq(v, w["SNAG_R_DEBRIS"][k], "SNAG_R_DEBRIS.\(k)") }
    eq(Winch.SNAG_CABLE, w["SNAG_CABLE"], "SNAG_CABLE")
    eq(Winch.SNAG_SETTLE, w["SNAG_SETTLE"], "SNAG_SETTLE")
    eq(Winch.SNAG_COOLDOWN, w["SNAG_COOLDOWN"], "SNAG_COOLDOWN")
    // heli/crewman
    let cr = d["heli/crewman"]
    eq(Crewman.LIMIT, cr["LIMIT"], "LIMIT")
    eq(Crewman.SCALE, cr["SCALE"], "SCALE")
    for (name, p) in [("REST", Crewman.REST), ("ORIGIN", Crewman.ORIGIN), ("SHOULDER_AIM", Crewman.SHOULDER_AIM), ("NECK", Crewman.NECK)] {
      assertBitEqual([p.x, p.y, p.z], try cr[name].requireDoubles(), name)
    }
    // heli/searchlight
    let sl = d["heli/searchlight"]
    eq(Searchlight.MAX_NADIR, sl["MAX_NADIR"], "MAX_NADIR")
    eq(Searchlight.D10, sl["D10"], "D10")
    eq(Searchlight.D40, sl["D40"], "D40")
    eq(Searchlight.RANGE, sl["RANGE"], "RANGE")
    // heli/lights
    let li = d["heli/lights"]
    eq(HeliLights.STROBE_PERIOD, li["STROBE_PERIOD"], "STROBE_PERIOD")
    eq(HeliLights.BEACON_HZ, li["BEACON_HZ"], "BEACON_HZ")
    let gains: [(String, Double)] = [("nav", HeliLights.GAIN.nav), ("navWhite", HeliLights.GAIN.navWhite), ("beacon", HeliLights.GAIN.beacon),
                                      ("strobe", HeliLights.GAIN.strobe), ("door", HeliLights.GAIN.door), ("elmo", HeliLights.GAIN.elmo),
                                      ("lens", HeliLights.GAIN.lens), ("flir", HeliLights.GAIN.flir)]
    for (k, v) in gains { eq(v, li["GAIN"][k], "GAIN.\(k)") }
    eq(HeliLights.BELLY.strobe, li["BELLY"]["strobe"], "BELLY.strobe")
    eq(HeliLights.BELLY.beacon, li["BELLY"]["beacon"], "BELLY.beacon")
    eq(HeliLights.BELLY.door, li["BELLY"]["door"], "BELLY.door")
    let cols: [(String, Color3)] = [("red", HeliLights.COL.red), ("green", HeliLights.COL.green), ("white", HeliLights.COL.white),
                                     ("beacon", HeliLights.COL.beacon), ("door", HeliLights.COL.door), ("lens", HeliLights.COL.lens)]
    for (k, c) in cols { assertBitEqual([c.r, c.g, c.b], try li["COL"][k]["lin"].requireDoubles(), "COL.\(k)") }
    let pointName = Dictionary(uniqueKeysWithValues: HeliModel.Points.all.map { ("\($0.value.x),\($0.value.y),\($0.value.z)", $0.key) })
    func name(_ p: V3) -> String { pointName["\(p.x),\(p.y),\(p.z)"] ?? "?" }
    let glints = try XCTUnwrap(li["GLINTS"].array)
    XCTAssertEqual(glints.count, HeliLights.GLINTS.count)
    for (g, j) in zip(HeliLights.GLINTS, glints) {
      XCTAssertEqual(name(g.point), j[0].string)
      assertBitEqual([g.color.r, g.color.g, g.color.b], try j[1]["lin"].requireDoubles(), "GLINTS colour")
      XCTAssertEqual(j[2].int, g.ch.rawValue)
      eq(g.base, j[3], "GLINTS base")
    }
    let spill = try XCTUnwrap(li["SPILL"].array)
    XCTAssertEqual(spill.count, HeliLights.SPILL.count)
    for (s, j) in zip(HeliLights.SPILL, spill) {
      XCTAssertEqual(name(s.point), j[0].string)
      assertBitEqual([s.color.r, s.color.g, s.color.b], try j[1]["lin"].requireDoubles(), "SPILL colour")
      XCTAssertEqual(j[2].int, s.ch.rawValue)
      eq(s.radius, j[3], "SPILL radius")
      eq(s.gain, j[4], "SPILL gain")
    }
    let mats = d["heli/materials"]
    XCTAssertEqual(mats["HULL_GLOWS"].int, HeliLights.HULL_GLOWS)
    XCTAssertEqual(mats["LIGHT_CHANNELS"].int, HeliLights.LIGHT_CHANNELS)
  }

  func testCameraTables() throws {
    let d = try VectorLoader.catalog().data("camera")
    let c = d["camera"]
    eq(CameraRig.BASE_FOV, c["BASE_FOV"], "BASE_FOV")
    XCTAssertEqual(try c["ZOOMS"].requireDoubles(), CameraRig.ZOOMS)
    eq(CameraRig.HELI_SCREEN_Y, c["HELI_SCREEN_Y"], "HELI_SCREEN_Y")
    eq(CameraRig.ATTRACT_LB, c["ATTRACT_LB"], "ATTRACT_LB")
    eq(CameraRig.DEG, c["DEG"], "DEG")
    let f = d["camera/freecam"]
    eq(FreeCam.PITCH_MAX, f["PITCH_MAX"], "PITCH_MAX")
    eq(FreeCam.DIST_MIN, f["DIST_MIN"], "DIST_MIN")
    eq(FreeCam.DIST_MAX, f["DIST_MAX"], "DIST_MAX")
    eq(FreeCam.SEA_REACH, f["SEA_REACH"], "SEA_REACH")
    let s = d["camera/shake"]
    eq(CameraMotion.NORM, s["NORM"], "NORM")
    let oct = try XCTUnwrap(s["OCT"].array)
    XCTAssertEqual(oct.count, CameraMotion.OCT.count)
    for (o, j) in zip(CameraMotion.OCT, oct) { assertBitEqual([o.f, o.a], try j.requireDoubles(), "OCT") }
  }

  /// HeliSpawn reads def.heli like `(def && def.heli) || { pad: 0 }`.
  func testSpawnParsing() throws {
    XCTAssertEqual(HeliSpawn(def: .null), HeliSpawn(pad: 0))
    XCTAssertEqual(HeliSpawn(def: try JSONValue.parse("{}")), HeliSpawn(pad: 0))
    XCTAssertEqual(HeliSpawn(def: try JSONValue.parse(#"{"heli":{"pad":1,"heading":0.5}}"#)), HeliSpawn(pad: 1, heading: 0.5))
    XCTAssertEqual(HeliSpawn(def: try JSONValue.parse(#"{"heli":{"x":3,"z":-4,"altitude":25}}"#)), HeliSpawn(altitude: 25, x: 3, z: -4))
  }
}
