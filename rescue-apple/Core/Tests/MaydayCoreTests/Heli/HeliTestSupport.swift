// Stub systems for the heli / camera parity tests: the same stand-ins the exporters build around the
// real web classes (tools/export/export-vectors.mjs heli(), tools/export/export-heli.mjs).
import XCTest
@testable import MaydayCore

/// ctx.ocean backed by a real WaveBank (heightAt(x, z) with tOff 0), optionally a constant sea level.
final class WaveOcean: OceanQuery {
  let bank: WaveBank?
  var level: Double
  var normal: V3?
  private(set) var splashes: [[Double]] = []
  private(set) var downwash: [Double] = []
  private(set) var searchlight: (origin: V3, dir: V3, cosOuter: Double, level: Double)?

  init(bank: WaveBank? = nil, level: Double = 0, normal: V3? = nil) {
    self.bank = bank
    self.level = level
    self.normal = normal
  }

  func heightAt(_ x: Double, _ z: Double) -> Double { bank?.heightAt(x, z) ?? level }
  func normalAt(_ x: Double, _ z: Double) -> V3? { bank?.normalAt(x, z) ?? normal }
  func splash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) { splashes.append([x, z, radius, strength]) }
  func setDownwash(_ x: Double, _ z: Double, _ radius: Double, _ strength: Double) { downwash = [x, z, radius, strength] }
  func setSearchlight(origin: V3, dir: V3, cosOuter: Double, level: Double) { searchlight = (origin, dir, cosOuter, level) }
}

/// ctx.weather: a constant wind and a fixed state.
final class ConstWeather: WeatherQuery {
  var wind: V2
  var readout: WeatherReadout?

  init(wind: V2, readout: WeatherReadout? = WeatherReadout()) {
    self.wind = wind
    self.readout = readout
  }

  func windAt(_ x: Double, _ z: Double) -> V2 { wind }
}

/// ctx.world: pads hit-tested by hypot(x − pad.x, z − pad.z) < radius, fixed obstacles / floaters.
final class StubWorld: WorldQuery {
  var pads: [LandingPad]
  var obstacles: [FlightObstacle]
  var floaters: [FlotsamItem]
  var deckY: Double = -.infinity
  var lighthouse: V2?

  init(pads: [LandingPad] = [], obstacles: [FlightObstacle] = [], floaters: [FlotsamItem] = []) {
    self.pads = pads
    self.obstacles = obstacles
    self.floaters = floaters
  }

  func padAt(_ x: Double, _ z: Double) -> LandingPad? {
    pads.first { JS.hypot(x - $0.position.x, z - $0.position.z) < $0.radius }
  }

  func nearestPad(_ x: Double, _ z: Double) -> LandingPad? {
    var best: LandingPad?
    var bd = Double.infinity
    for p in pads {
      let d = JS.hypot(p.position.x - x, p.position.z - z)
      if d < bd {
        bd = d
        best = p
      }
    }
    return best
  }

  func deckAt(_ x: Double, _ z: Double) -> Double { deckY }
}

extension JSONValue {
  /// [x, y, z] → V3
  var v3: V3? {
    guard let d = doubles, d.count >= 3 else { return nil }
    return V3(d[0], d[1], d[2])
  }
}

/// Compares one row of numbers (a trace state) and reports the first differing field by name.
@discardableResult
func assertRowBitEqual(_ got: [Double], _ want: [Double], fields: [String], _ label: @autoclosure () -> String,
                       file: StaticString = #filePath, line: UInt = #line) -> Bool {
  if got.count != want.count {
    XCTFail("\(label()): \(got.count) fields, expected \(want.count)", file: file, line: line)
    return false
  }
  for i in 0..<got.count where !Bits.equal(got[i], want[i]) {
    let name = i < fields.count ? fields[i] : "#\(i)"
    XCTFail("\(label()) \(name): \(Bits.describe(got[i], want[i]))", file: file, line: line)
    return false
  }
  return true
}
