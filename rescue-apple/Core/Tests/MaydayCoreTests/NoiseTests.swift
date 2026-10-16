// createNoise2D / fbm2 vs Node 22: Tests/Vectors/math/noise.json.
import XCTest
@testable import MaydayCore

final class NoiseTests: XCTestCase {
  func testSimplexGrid() throws {
    let v = try VectorLoader.load("math/noise")
    let axis = try v.data["grid"]["axis"].doublesOrFail("grid.axis")
    let cases = try v.data["simplex"].requireArray("simplex")
    XCTAssertEqual(cases.count, 5)
    for c in cases {
      let seed = try c["seed"].doubleOrFail("seed")
      let want = try c["values"].doublesOrFail("values")
      let n = SimplexNoise2D(seed: seed)
      var got = [Double]()
      for y in axis { for x in axis { got.append(n(x, y)) } } // row-major: for y, for x
      assertBitEqual(got, want, "createNoise2D(\(seed))")
    }
  }

  func testFbm2() throws {
    let v = try VectorLoader.load("math/noise")
    for c in try v.data["fbm2"].requireArray("fbm2") {
      let seed = try c["seed"].doubleOrFail("seed")
      let octaves = try c["octaves"].requireInt("octaves")
      let lac = try c["lacunarity"].doubleOrFail("lacunarity")
      let gain = try c["gain"].doubleOrFail("gain")
      let scale = try c["scale"].doubleOrFail("scale")
      let axis = try c["axis"].doublesOrFail("axis")
      let want = try c["values"].doublesOrFail("values")
      let n = SimplexNoise2D(seed: seed)
      var got = [Double]()
      for y in axis {
        for x in axis {
          // exporter: fbm2(n, x, y, …) for scale 1, fbm2(n, x * 0.37, y * 0.37, …) otherwise
          let px = scale == 1 ? x : x * scale
          let py = scale == 1 ? y : y * scale
          got.append(fbm2(n, px, py, octaves: octaves, lacunarity: lac, gain: gain))
        }
      }
      assertBitEqual(got, want, "fbm2 seed \(seed) octaves \(octaves)")
    }
  }

  func testFlightTurbulenceLookups() throws {
    let v = try VectorLoader.load("math/noise")
    let ft = v.data["flightTurbulence"]
    let n = SimplexNoise2D(seed: try ft["seed"].doubleOrFail("seed"))
    let want = try ft["values"].doublesOrFail("values")
    var got = [Double]()
    for k in 1...120 {
      let t = Double(k) / 60
      got.append(n(t * 0.9, 3.7))
      got.append(n(t * 0.9, 41.3))
    }
    assertBitEqual(got, want, "noise(t*0.9, 3.7 | 41.3)")
  }
}
