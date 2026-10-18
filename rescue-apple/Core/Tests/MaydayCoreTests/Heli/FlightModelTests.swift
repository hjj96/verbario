// heli/flight.js FlightModel vs Node 22: Tests/Vectors/heli/flight_<scenario>.json (export-vectors.mjs
// heli()). 600 fixed steps of 1/60 s over a real WaveBank (storm sea), constant wind, the stub heli of
// the exporter; every one of the 19 state fields bit-exact on every step, events identical.
import XCTest
@testable import MaydayCore

/// The exporter's stub heli `h`: damage / onWaterStrike / onTouch only record (hull stays 1); ops.land =
/// landed = pad, attachTo, v = 0, contactPad = pad, altTarget = p.y; ops.ditch = crash ditched;
/// ops.takeoff = landed = nil.
final class RecordingFlightHost: FlightHost {
  var uMove = V2()
  var uMag: Double = 0
  var winchState: WinchState = .stowed
  var autorotation = false
  var crash: HeliCrashState?
  var hull: Double = 1
  var emp: Double = 0
  var thrustFactor: Double = 1
  var boosting = false
  var passengers = 0
  var rotorRPM: Double = 1
  var altTarget: Double = 0
  var landed: PadID?
  var alive = true
  weak var flight: FlightModel?
  var step = 0
  var events: [JSONValue] = []

  private func record(_ name: String, _ fields: [(String, JSONValue)]) {
    var o = JSONObject()
    o.set("step", .number(Double(step)))
    o.set("event", .string(name))
    for (k, v) in fields { o.set(k, v) }
    events.append(.object(o))
  }

  func damage(_ amount: Double, _ source: DamageSource) {
    record("damage", [("amount", .number(amount)), ("source", .string(source.rawValue))])
  }

  func onWaterStrike(_ x: Double, _ z: Double, _ strength: Double) {
    record("waterStrike", [("x", .number(x)), ("z", .number(z)), ("speed", .number(strength))])
  }

  func onTouch(_ pad: LandingPad, _ relVy: Double) { record("touch", [("relVy", .number(relVy))]) }

  func land(_ pad: LandingPad) {
    record("land", [])
    guard let f = flight else { return }
    landed = pad.id
    f.attachTo(pad)
    f.v.set(0, 0, 0)
    f.contactPad = pad.id
    altTarget = f.p.y
  }

  func ditch(_ reason: String, _ deck: LandingPad?) {
    record("ditch", [("reason", .string(reason))])
    crash = HeliCrashState(phase: .ditched, t: 0, reason: reason, deck: nil)
    alive = false
    landed = nil
  }

  func takeoff() {
    record("takeoff", [])
    landed = nil
  }
}

final class FlightModelTests: XCTestCase {
  static let scenarios = ["hover_standard", "cruise_assist_off_obstacle", "assist_full_winch_water", "land_pad"]

  func testFlightHoverStandard() throws { try run("hover_standard") }
  func testFlightCruiseAssistOffObstacle() throws { try run("cruise_assist_off_obstacle") }
  func testFlightAssistFullWinchWater() throws { try run("assist_full_winch_water") }
  func testFlightLandPad() throws { try run("land_pad") }

  private func run(_ id: String) throws {
    let v = try VectorLoader.load("heli/flight_\(id)")
    let d = v.data
    let s = d["setup"]
    let dt = try s["dt"].doubleOrFail("dt")
    XCTAssertTrue(Bits.equal(dt, FlightModel.STEP), "STEP")
    let steps = try s["steps"].requireInt("steps")

    // Ocean: real WaveBank, storm sea, seed 303, wind angle 0.6, advanced before every flight step.
    let bank = WaveBank()
    bank.setQuality(8, 300)
    bank.setSeed(303, 0.6)
    let sea = SeaState(json: s["ocean"]["sea"])

    let events = EventBus()
    let assist = try s["settings"]["assist"].requireString("assist")
    let ctx = SimContext(events: events, settings: StaticSettings(["assist": .string(assist)]))
    ctx.ocean = WaveOcean(bank: bank)
    let wind = try s["weather"]["windAt"].doublesOrFail("windAt")
    ctx.weather = ConstWeather(wind: V2(wind[0], wind[1]),
                               readout: WeatherReadout(turbulence: try s["weather"]["turbulence"].doubleOrFail("turbulence")))
    var obstacles = [FlightObstacle]()
    for o in s["world"]["obstacles"].array ?? [] {
      obstacles.append(FlightObstacle(x: try o["x"].doubleOrFail("o.x"), z: try o["z"].doubleOrFail("o.z"),
                                      radius: try o["radius"].doubleOrFail("o.radius"), top: o["top"].double))
    }
    var pads = [LandingPad]()
    let pj = s["world"]["pad"]
    if pj.exists {
      pads.append(LandingPad(id: PadID(0), type: try pj["type"].requireString("pad.type"), position: try XCTUnwrap(pj["position"].v3),
                             radius: try pj["radius"].doubleOrFail("pad.radius"), heading: try pj["heading"].doubleOrFail("pad.heading"),
                             tilt: try pj["tilt"].doubleOrFail("pad.tilt"), velocity: pj["velocity"].v3))
    }
    ctx.world = StubWorld(pads: pads, obstacles: obstacles)

    let host = RecordingFlightHost()
    let start = s["heli"]["start"]
    let f = FlightModel(host: host, ctx: ctx)
    host.flight = f
    host.altTarget = try start["y"].doubleOrFail("start.y")
    f.reset(try start["x"].doubleOrFail("x"), try start["y"].doubleOrFail("y"), try start["z"].doubleOrFail("z"),
            try start["heading"].doubleOrFail("heading"))

    let inputs = try XCTUnwrap(d["inputs"].array)
    let states = try XCTUnwrap(d["states"].array)
    let fields = try XCTUnwrap(d["stateFields"].strings)
    XCTAssertEqual(inputs.count, steps)
    XCTAssertEqual(states.count, steps)
    for i in 0..<steps {
      let step = i + 1
      host.step = step
      let t = Double(step) * FlightModel.STEP
      bank.update(FlightModel.STEP, t, sea, 0.6, 1, 0, 0)
      let inp = inputs[i]
      host.uMove.set(try inp[0].doubleOrFail("uMoveX"), try inp[1].doubleOrFail("uMoveY"))
      host.boosting = try inp[2].doubleOrFail("boost") != 0
      if host.landed == nil { host.altTarget = try inp[3].doubleOrFail("altTarget") }
      f.noseTarget = inp[4].double
      host.winchState = try XCTUnwrap(WinchState(rawValue: try inp[5].requireString("winch")))
      f.step(FlightModel.STEP)
      let got = [f.p.x, f.p.y, f.p.z, f.v.x, f.v.y, f.v.z, f.heading, f.yawRate, f.thrust.x, f.thrust.y, f.windEff.x, f.windEff.y,
                 f.windSmooth.x, f.windSmooth.y, f.sea, f.surface, f.turb, host.uMag, f.landTimer]
      let want = try states[i].doublesOrFail("states[\(i)]")
      if !assertRowBitEqual(got, want, fields: fields, "\(id) step \(step)") { break }
    }
    XCTAssertEqual(host.events, d["events"].array ?? [], "\(id) events")
  }
}
