// systems/heli.js Helicopter (+ flight, winch, ops, searchlight, lights, crewman) and systems/camera.js
// CameraRig (+ shake, freecam) vs Node 22: Tests/Vectors/{heli,camera}/*.json from export-heli.mjs.
// The real web classes ran on stub systems with scripted (recorded) input; HeliScenario rebuilds the
// stubs and replays the frames through the Swift port. Every recorded row (simulation + camera every
// `every` frames, visual state every 30th), the winch cable (Float32), the reach ring, the lamp glints,
// and the event / fx / ocean-call logs must match bit for bit.
import XCTest
@testable import MaydayCore

final class HeliTraceTests: XCTestCase {
  func testHeliRescue() throws { try run("heli/heli_rescue") }
  func testHeliStormCrash() throws { try run("heli/heli_storm_crash") }
  func testHeliFuelShip() throws { try run("heli/heli_fuel_ship") }
  func testHeliWinchFailures() throws { try run("heli/heli_winch_failures") }
  func testRigModes() throws { try run("camera/rig_modes") }
  func testRigPhoto() throws { try run("camera/rig_photo") }

  // ---- the row getters (names = export-heli.mjs stateFields) ------------------------------------------
  typealias Getter = (HeliScenario) -> Double

  static func fieldTable() -> [String: Getter] {
    var F: [String: Getter] = [:]
    func b(_ x: Bool) -> Double { x ? 1 : 0 }
    func v3(_ n: String, _ g: @escaping (HeliScenario) -> V3) {
      F[n + "X"] = { g($0).x }
      F[n + "Y"] = { g($0).y }
      F[n + "Z"] = { g($0).z }
    }
    func q4(_ n: String, _ g: @escaping (HeliScenario) -> Quat) {
      F[n + "X"] = { g($0).x }
      F[n + "Y"] = { g($0).y }
      F[n + "Z"] = { g($0).z }
      F[n + "W"] = { g($0).w }
    }
    func rgb(_ n: String, _ g: @escaping (HeliScenario) -> Color3) {
      F[n + "R"] = { g($0).r }
      F[n + "G"] = { g($0).g }
      F[n + "B"] = { g($0).b }
    }
    func id(_ x: Int?) -> Double { x.map(Double.init) ?? -1 }

    // heli: contract + extras
    v3("pos") { $0.heli.position }
    v3("vel") { $0.heli.velocity }
    let H: [(String, (Helicopter) -> Double)] = [
      ("heading", { $0.heading }), ("altitude", { $0.altitude }), ("fuel", { $0.fuel }), ("hull", { $0.hull }), ("rotorRPM", { $0.rotorRPM }),
      ("load", { $0.load }), ("bank", { $0.bank }), ("pitch", { $0.pitch }), ("engineTemp", { $0.engineTemp }), ("emp", { $0.emp }),
      ("altTarget", { $0.altTarget }), ("yawRate", { $0.yawRate }), ("vy", { $0.vy }), ("speed", { $0.speed }), ("airspeed", { $0.airspeed }),
      ("seaY", { $0.seaY }), ("surfaceY", { $0.surfaceY }), ("skidClearance", { $0.skidClearance }), ("bingo", { $0.bingo }),
      ("fuelBurn", { $0.fuelBurn }), ("overheat", { $0.overheat }), ("thrustFactor", { $0.thrustFactor }), ("damageTaken", { $0.damageTaken }),
      ("uMag", { $0.uMag }), ("capacity", { Double($0.capacity) }), ("flares", { Double($0.flares) }), ("rafts", { Double($0.rafts) }),
    ]
    for (n, g) in H { F[n] = { g($0.heli) } }
    v3("aim") { $0.heli.aim }
    F["uMoveX"] = { $0.heli.uMove.x }
    F["uMoveY"] = { $0.heli.uMove.y }
    v3("hoistW") { $0.heli.hoistWorld }
    v3("hoistR") { $0.heli.hoistRender }
    F["dwX"] = { $0.heli.downwash.x }
    F["dwZ"] = { $0.heli.downwash.z }
    F["dwRadius"] = { $0.heli.downwash.radius }
    F["dwStrength"] = { $0.heli.downwash.strength }
    F["landed"] = { id($0.heli.landed?.raw) }
    F["bingoPad"] = { id($0.heli.bingoPad?.raw) }
    F["alive"] = { b($0.heli.alive) }
    F["searchlight"] = { b($0.heli.searchlight) }
    F["boost"] = { b($0.heli.boost) }
    F["boosting"] = { b($0.heli.boosting) }
    F["boostHeld"] = { b($0.heli.boostHeld) }
    F["autorotation"] = { b($0.heli.autorotation) }
    F["crashPhase"] = { s in s.heli.crash.map { $0.phase == .autorot ? 1 : 2 } ?? 0 }
    F["crashT"] = { $0.heli.crash?.t ?? -1 }
    F["crashDeck"] = { id($0.heli.crash?.deck?.raw) }
    F["ceiling"] = { b($0.heli.ceiling) }
    F["refueling"] = { b($0.heli.refueling) }
    F["cabin"] = { Double($0.heli.cabin.count) }
    F["firstHit"] = { b($0.heli.firstHit) }
    F["aimSource"] = { Double(["mouse", "stick", "touch", "nose"].firstIndex(of: $0.heli.aimSource) ?? -1) }
    F["acc"] = { $0.heli.acc }
    F["liftActive"] = { b($0.heli.liftActive) }
    F["liftAxis"] = { $0.heli.liftAxis }
    F["pitchV"] = { $0.heli.pitchV }
    F["bankV"] = { $0.heli.bankV }
    // flight model internals
    v3("fp") { $0.heli.flight.p }
    v3("fv") { $0.heli.flight.v }
    F["fHeading"] = { $0.heli.flight.heading }
    F["noseTarget"] = { $0.heli.flight.noseTarget ?? .nan }
    F["landTimer"] = { $0.heli.flight.landTimer }
    F["contactPad"] = { id($0.heli.flight.contactPad?.raw) }
    F["fSea"] = { $0.heli.flight.sea }
    F["fSurface"] = { $0.heli.flight.surface }
    F["fTurb"] = { $0.heli.flight.turb }
    F["lastVy"] = { $0.heli.flight.lastVy }
    // winch
    let W: (HeliScenario) -> Winch = { $0.heli.winch }
    F["wState"] = { Double(["stowed", "lowering", "down", "raising"].firstIndex(of: W($0).state.rawValue) ?? -1) }
    F["wLength"] = { W($0).length }
    v3("basket") { W($0).basket }
    F["steadiness"] = { W($0).steadiness }
    F["wLoad"] = { id(W($0).load?.raw) }
    F["wSpeed"] = { W($0).speed }
    F["swing"] = { W($0).swing }
    F["wTarget"] = { id(W($0).target?.raw) }
    F["capture"] = { W($0).capture }
    F["tension"] = { W($0).tension }
    F["jammed"] = { W($0).jammed }
    F["wSurfaceY"] = { W($0).surfaceY }
    F["wHeight"] = { W($0).height }
    F["inRange"] = { b(W($0).inRange) }
    F["radius"] = { W($0).radius }
    F["stretcher"] = { b(W($0).stretcher) }
    F["cabinFull"] = { b(W($0).cabinFull) }
    F["denied"] = { s in Double([nil, "high", "fast", "landed"].firstIndex(of: W(s).denied) ?? -1) }
    v3("basketVel") { W($0).basketVel }
    F["wc_buffer"] = { W($0).buffer }
    F["wc_slipT"] = { W($0).slipT }
    F["wc_tensionT"] = { W($0).tensionT }
    F["wc_snagWet"] = { W($0).snagWet }
    F["wc_snagCd"] = { W($0).snagCd }
    F["wc_grace"] = { W($0).grace }
    F["wc_spin"] = { W($0).spin }
    F["wc_spinRate"] = { W($0).spinRate }
    F["wc_ringOrange"] = { W($0).ringOrange }
    F["wc_ringOpacity"] = { W($0).view.ringFade }
    F["wc_autoRetract"] = { b(W($0).autoRetract) }
    F["wc_snagInside"] = { Double(W($0).snagInside.count) }
    F["wc_pending"] = { b(W($0).pending) }
    F["crestUnder"] = { W($0).crestUnder }
    // ops
    let O: (HeliScenario) -> HeliOps = { $0.heli.ops }
    F["ops_bingoT"] = { O($0).bingoT }
    F["ops_unloadT"] = { O($0).unloadT }
    F["ops_resupplyT"] = { O($0).resupplyT }
    F["ops_hornT"] = { O($0).hornT }
    F["ops_floodT"] = { O($0).floodT }
    F["ops_overheatT"] = { O($0).overheatT }
    F["ops_crewRocketT"] = { O($0).crewRocketT }
    F["ops_fuelLevel"] = { Double(O($0).fuelLevel.rawValue) }
    F["ops_bingoWarned"] = { b(O($0).bingoWarned) }
    F["ops_refueling"] = { b(O($0).refueling) }
    F["ops_unloaded"] = { Double(O($0).unloaded.count) }
    F["nFlights"] = { Double(O($0).flights.count) }
    F["nDrops"] = { Double(O($0).drops.count) }
    v3("flight0") { s in O(s).flights.first.map { V3($0.x, $0.y, $0.z) } ?? V3(.nan, .nan, .nan) }
    v3("drop0") { s in O(s).drops.first.map { V3($0.x, $0.y, $0.z) } ?? V3(.nan, .nan, .nan) }
    F["drop0Spin"] = { O($0).drops.first?.spin ?? .nan }

    // visual state (tier B)
    let V: (HeliScenario) -> HeliVisualState = { $0.heli.visual }
    v3("root") { V($0).rootPosition }
    for i in [0, 1, 2, 4, 5, 6, 8, 9, 10] { F["body\(i)"] = { V($0).bodyMatrix[i] } }
    F["rotor_uBlade"] = { V($0).rotor.blade }
    F["rotor_uGhost"] = { V($0).rotor.ghost }
    F["rotor_uSharp"] = { V($0).rotor.sharp }
    F["rotor_uExp"] = { V($0).rotor.exp }
    F["rotor_uElmo"] = { V($0).rotor.elmo }
    F["rotor_uArc"] = { V($0).rotor.arc }
    F["rotor_uTipFade"] = { V($0).rotor.tipFade }
    F["tail_uBlade"] = { V($0).tail.blade }
    F["tail_uGhost"] = { V($0).tail.ghost }
    F["tail_uSharp"] = { V($0).tail.sharp }
    F["tail_uExp"] = { V($0).tail.exp }
    F["tail_uArc"] = { V($0).tail.arc }
    F["tail_uTipFade"] = { V($0).tail.tipFade }
    F["hubAngle"] = { V($0).hubAngle }
    F["bladesAngle"] = { V($0).shadowBladesAngle }
    F["bladesVisible"] = { b(V($0).shadowBladesVisible) }
    rgb("rim") { V($0).hull.rim }
    rgb("fill") { V($0).hull.fill }
    F["sunScale"] = { V($0).hull.sunScale }
    F["soot"] = { V($0).hull.soot }
    rgb("instr") { V($0).hull.instr }
    rgb("veilSun") { V($0).veil.sunCol }
    rgb("veilAmb") { V($0).veil.ambCol }
    rgb("veilSky") { V($0).veil.skyCol }
    v3("veilSunDir") { V($0).veil.sunDir }
    rgb("glow") { V($0).veil.glow }
    rgb("glowB") { V($0).veil.glowB }
    rgb("glowS") { V($0).veil.glowS }
    F["floatsVisible"] = { b(V($0).floatsVisible) }
    v3("floatScale") { V($0).floatScale }
    F["heatVisible"] = { b(V($0).heatVisible) }
    // searchlight
    let SL: (HeliScenario) -> Searchlight = { $0.heli.searchlightCtl }
    F["slLevel"] = { SL($0).level }
    v3("slDir") { SL($0).dir }
    v3("slOrigin") { SL($0).origin }
    v3("slHit") { SL($0).hit }
    F["slLength"] = { SL($0).length }
    F["slAngle"] = { SL($0).angle }
    F["slFlick"] = { SL($0).flick }
    F["spotIntensity"] = { SL($0).spot.intensity }
    F["spotAngle"] = { SL($0).spot.angle }
    v3("spotTarget") { SL($0).spot.target }
    F["coneDensity"] = { SL($0).cone.density }
    F["coneIntensity"] = { SL($0).cone.intensity }
    F["coneLen"] = { SL($0).cone.len }
    F["coneTanA"] = { SL($0).cone.tanA }
    F["coneCos2"] = { SL($0).cone.cos2 }
    F["coneVisible"] = { b(SL($0).cone.visible) }
    q4("coneQ") { SL($0).cone.quaternion }
    v3("coneScale") { SL($0).cone.scale }
    F["beamOn"] = { b($0.heli.beam.on) }
    F["beamIntensity"] = { $0.heli.beam.intensity }
    F["beamCos"] = { $0.heli.beam.cosOuter }
    F["oceanSlLevel"] = { $0.ocean.lastSlLevel }
    F["oceanDwStrength"] = { $0.ocean.lastDw[3] }
    // lights
    let L: (HeliScenario) -> HeliLights = { $0.heli.lightsCtl }
    for i in 0..<10 { F["chan\(i)"] = { Double(L($0).chan[i]) } }
    F["halo"] = { L($0).halo }
    F["strobe"] = { L($0).strobe }
    F["beacon"] = { L($0).beacon }
    F["door"] = { L($0).door }
    rgb("belly") { L($0).bellyColor }
    F["bellyIntensity"] = { L($0).bellyIntensity }
    for i in 0..<8 { F["glowCol\(i)"] = { L($0).glowCol[i].r } }
    // crewman
    F["crewLean"] = { $0.heli.crewman.lean }
    F["crewVisible"] = { b($0.heli.crewman.pose.visible) }
    v3("crewPos") { $0.heli.crewman.pose.position }
    q4("crewArm") { $0.heli.crewman.pose.arm }
    q4("crewHead") { $0.heli.crewman.pose.head }
    // winch render
    F["cableVisible"] = { b(W($0).view.cableVisible) }
    F["basketVisible"] = { b(W($0).view.basketVisible) }
    F["rescuerVisible"] = { b(W($0).view.rescuerVisible) }
    F["ringVisible"] = { b(W($0).view.ringVisible) }
    v3("basketMesh") { W($0).view.basketPosition }
    q4("basketQ") { W($0).view.basketQuaternion }
    v3("rescuer") { W($0).view.rescuerPosition }
    F["cableLit"] = { W($0).view.cableLit }
    F["cableBeamCos"] = { W($0).view.beamCos }
    F["cableBeamI"] = { W($0).view.beamIntensity }
    F["ringMatOpacity"] = { W($0).view.ringOpacity }
    F["ringPhase"] = { W($0).view.ringPhase }
    rgb("ringColor") { W($0).view.ringColor }

    // camera rig + camera (tier A)
    v3("cam") { $0.ctx.camera.position }
    q4("camQ") { $0.ctx.camera.quaternion }
    F["camFov"] = { $0.ctx.camera.fov }
    F["camProj0"] = { $0.ctx.camera.projectionMatrix[0] }
    F["camProj5"] = { $0.ctx.camera.projectionMatrix[5] }
    let R: (HeliScenario) -> CameraRig = { $0.rig }
    let rigF: [(String, (CameraRig) -> Double)] = [
      ("zoom", { $0.zoom }), ("zoomIndex", { Double($0.zoomIndex) }), ("letterbox", { $0.letterbox }), ("height", { $0.height }),
      ("tiltDeg", { $0.tiltDeg }), ("fov", { $0.fov }), ("viewHeight", { $0.viewHeight }), ("trauma", { $0.trauma }), ("_hv", { $0.hv }),
      ("_tilt", { $0.tilt }), ("_tiltV", { $0.tiltV }), ("_punch", { $0.punchV }), ("_punchT", { $0.punchT }), ("_climbFov", { $0.climbFov }),
      ("_winch", { $0.winchBlend }), ("_t", { $0.t }), ("_lbPulse", { $0.lbPulse }), ("_revealHold", { $0.revealHold }), ("_slowT", { $0.slowT }),
      ("_slowScale", { $0.slowScale }), ("_focusT", { $0.focusT }), ("_focusW", { $0.focusW }), ("_crashT", { $0.crashT }),
    ]
    for (n, g) in rigF { F["rig" + n] = { g(R($0)) } }
    F["rigReveal"] = { b(R($0).reveal) }
    F["rigMode"] = { Double(["follow", "attract", "cinematic"].firstIndex(of: R($0).mode.rawValue) ?? -1) }
    F["rigPhoto"] = { b(R($0).photo) }
    F["rigPending"] = { Double(R($0).pending.count) }
    F["rigRogueUnder"] = { b(R($0).rogueUnder) }
    F["timeScale"] = { $0.ctx.timeScale }
    F["focusX"] = { R($0).focusPoint.x }
    F["focusZ"] = { R($0).focusPoint.z }
    F["rigFvX"] = { R($0).fv.x }
    F["rigFvY"] = { R($0).fv.y }
    F["hs_x"] = { R($0).heliScreen.x }
    F["hs_y"] = { R($0).heliScreen.y }
    F["hs_ndcX"] = { R($0).heliScreen.ndcX }
    F["hs_ndcY"] = { R($0).heliScreen.ndcY }
    F["hs_behind"] = { b(R($0).heliScreen.behind) }
    F["hs_onScreen"] = { b(R($0).heliScreen.onScreen) }
    F["hsvX"] = { R($0).heliScreenVelocity.x }
    F["hsvY"] = { R($0).heliScreenVelocity.y }
    v3("mPos") { R($0).motion.pos }
    v3("mRot") { R($0).motion.rot }
    F["mPushX"] = { R($0).motion.push.x }
    F["mPushY"] = { R($0).motion.push.y }
    F["mTrauma"] = { R($0).motion.trauma }
    F["mFreq"] = { R($0).motion.freq }
    F["mShakeT"] = { R($0).motion.shakeT }
    v3("fcP") { R($0).freecam.p }
    v3("fcPivot") { R($0).freecam.pivot }
    F["fcYaw"] = { R($0).freecam.yaw }
    F["fcPitch"] = { R($0).freecam.pitch }
    F["fcDist"] = { R($0).freecam.dist }
    F["fc_yaw"] = { R($0).freecam.easedYaw }
    F["fc_pitch"] = { R($0).freecam.easedPitch }
    F["fc_dist"] = { R($0).freecam.easedDist }
    return F
  }

  // ---- the runner ----------------------------------------------------------------------------------------
  private func rows(_ v: VectorFile, _ ref: JSONValue, _ width: Int) throws -> [Int: [Double]] {
    let flat = try v.sidecarF64(ref)
    var out: [Int: [Double]] = [:]
    for i in stride(from: 0, to: flat.count, by: width) { out[Int(flat[i])] = Array(flat[(i + 1)..<(i + width)]) }
    return out
  }

  private func run(_ name: String) throws {
    let sc = try HeliScenario(name)
    let d = sc.vec.data
    let table = HeliTraceTests.fieldTable()
    let stateFields = Array(try XCTUnwrap(d["stateFields"].strings).dropFirst())
    let visualFields = Array(try XCTUnwrap(d["visualFields"].strings).dropFirst())
    let missing = (stateFields + visualFields).filter { table[$0] == nil }
    XCTAssertEqual(missing, [], "\(name): fields without a Swift getter")
    if !missing.isEmpty { return }
    let states = try rows(sc.vec, d["states"], stateFields.count + 1)
    let visuals = try rows(sc.vec, d["visuals"], visualFields.count + 1)
    let cable = try sc.vec.sidecarF32(d["cable"])
    let ring = try sc.vec.sidecarF32(d["ring"])
    let glintFlat = try sc.vec.sidecarF64(d["glints"])
    var glints: [Int: [[Double]]] = [:]
    for i in stride(from: 0, to: glintFlat.count, by: 6) { glints[Int(glintFlat[i]), default: []].append(Array(glintFlat[(i + 2)..<(i + 6)])) }
    XCTAssertEqual(sc.inputRows.count, sc.frames, "\(name): input rows")

    var stateRow = 0
    var ringRow = 0
    let stateGetters = stateFields.map { table[$0]! }
    let visualGetters = visualFields.map { table[$0]! }
    func check(_ want: [Double], _ getters: [Getter], _ fields: [String], _ label: String) -> Bool {
      assertRowBitEqual(getters.map { $0(sc) }, want, fields: fields, label)
    }
    for f in 1...sc.frames {
      try sc.step()
      if let want = glints[f] {
        let got = sc.ocean.glints
        XCTAssertEqual(got.count, want.count, "\(name) frame \(f): glint count")
        for (i, g) in zip(got, want).enumerated() where !assertRowBitEqual(g.0, g.1, fields: ["gx", "gz", "radius", "intensity"], "\(name) frame \(f) glint \(i)") {
          return
        }
      }
      if f % sc.every == 0 {
        guard let want = states[f] else { return XCTFail("\(name): no state row for frame \(f)") }
        if !check(want, stateGetters, stateFields, "\(name) frame \(f)") { return }
        let w = sc.heli.winch
        let gotCable = w.cable.cur + w.view.rend
        let base = stateRow * 90
        for i in 0..<90 where gotCable[i].bitPattern != cable[base + i].bitPattern {
          return XCTFail("\(name) frame \(f) cable[\(i)] \(gotCable[i]) vs \(cable[base + i])")
        }
        stateRow += 1
      }
      if f % 30 == 0 {
        guard let want = visuals[f] else { return XCTFail("\(name): no visual row for frame \(f)") }
        if !check(want, visualGetters, visualFields, "\(name) frame \(f) visual") { return }
        let gotRing = sc.heli.winch.view.ringPositions
        let base = ringRow * 294
        for i in 0..<294 where gotRing[i].bitPattern != ring[base + i].bitPattern {
          return XCTFail("\(name) frame \(f) ring[\(i)] \(gotRing[i]) vs \(ring[base + i])")
        }
        ringRow += 1
      }
    }
    XCTAssertEqual(stateRow, states.count, "\(name): state rows replayed")
    compareLog(sc.eventLog, d["events"].array ?? [], "\(name) events")
    compareLog(sc.fx.log, d["fx"].array ?? [], "\(name) fx")
    compareLog(sc.ocean.log, d["ocean"].array ?? [], "\(name) ocean")
  }

  private func compareLog(_ got: [JSONValue], _ want: [JSONValue], _ label: String) {
    for (i, (g, w)) in zip(got, want).enumerated() where !jsonEqualBitwise(g, w) {
      return XCTFail("\(label)[\(i)]: \(g) vs \(w)")
    }
    XCTAssertEqual(got.count, want.count, "\(label): count")
  }
}
