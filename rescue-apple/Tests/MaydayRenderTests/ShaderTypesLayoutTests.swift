// ShaderTypesLayoutTests — the C/MSL/Swift views of ShaderTypes.h agree (PLAN §3.4). The same sizes
// are static_assert'ed in the header for both the C (Swift importer) and the Metal compilers.
import XCTest
import MaydayShaderTypes
@testable import MaydayApp

final class ShaderTypesLayoutTests: XCTestCase {
  func testSizes() {
    XCTAssertEqual(MemoryLayout<MDFrameUniforms>.size, 320)
    XCTAssertEqual(MemoryLayout<MDLookUniforms>.size, 176)
    XCTAssertEqual(MemoryLayout<MDDirLight>.size, 32)
    XCTAssertEqual(MemoryLayout<MDHemiLight>.size, 48)
    XCTAssertEqual(MemoryLayout<MDSpotLight>.size, 64)
    XCTAssertEqual(MemoryLayout<MDPointLight>.size, 48)
    XCTAssertEqual(MemoryLayout<MDLightsUniforms>.size, 608)
    XCTAssertEqual(MemoryLayout<MDObjectData>.size, 144)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.size, 2032)
    XCTAssertEqual(MemoryLayout<MDOutputUniforms>.size, 32)
    XCTAssertEqual(MemoryLayout<MDFinalUniforms>.size, 288)
  }

  func testOceanOffsets() {
    // spot checks against the MSL struct (16-byte float4 rows, ints packed after `grid`)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.uWaveB), 128)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.grid), 608)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.uShoalCount), 624)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.misc), 640)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.uDeep), 656)
    XCTAssertEqual(MemoryLayout<MDOceanUniforms>.offset(of: \MDOceanUniforms.uLookK), 2016)
  }

  func testPackSplashStrengths() {
    var o = OceanFrameInput()
    o.splashes = (0..<6).map { SIMD4<Float>(Float($0), 0, 0.1, 2) }
    o.splashStrengths = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    let u = OceanRenderer.pack(o)
    XCTAssertEqual(u.uSplashCount, 6)
    XCTAssertEqual(u.uSplashS.0, SIMD4<Float>(0.1, 0.2, 0.3, 0.4))
    XCTAssertEqual(u.uSplashS.1, SIMD4<Float>(0.5, 0.6, 0, 0))
    XCTAssertEqual(u.uSplash.5.x, 5)
  }
}
