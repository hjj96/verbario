// OceanGridBuffers — GPU copy of the warped camera-following ocean grid for one quality tier
// (PLAN §2.9 ocean/grid.js row: OceanGrid in Core, static buffers per quality level in Render).
// Geometry: MaydayCore OceanGrid.build(N) — port of rescue/src/systems/ocean/grid.js (N×N cells,
// x' = sign(x)·|x|^1.6·380, two skirt rows to 3 km, diamond diagonals, CCW seen from +Y). The vertex
// shader only reads position.xz (local grid coordinates), so the upload keeps float2 (x, z).
import Foundation
import Metal
import MaydayCore

public final class OceanGridBuffers {
  public let n: Int
  public let vertexCount: Int
  public let indexCount: Int
  public let positions: MTLBuffer   // float2 (x, z) per vertex
  public let indices: MTLBuffer     // uint32 triangle list

  public init(device: MTLDevice, n: Int, constants: WaveConstants) throws {
    self.n = n
    let grid = OceanGrid.build(n, constants: constants)
    let count = grid.positions.count / 3
    var xz = [SIMD2<Float>](repeating: .zero, count: count)
    for v in 0..<count {
      xz[v] = SIMD2<Float>(grid.positions[v * 3], grid.positions[v * 3 + 2])
    }
    vertexCount = count
    indexCount = grid.indices.count
    guard let pb = xz.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let base = raw.baseAddress else { return nil }
      return device.makeBuffer(bytes: base, length: raw.count, options: [.storageModeShared])
    }) else { throw RenderError.resource("ocean grid positions") }
    guard let ib = grid.indices.withUnsafeBytes({ raw -> MTLBuffer? in
      guard let base = raw.baseAddress else { return nil }
      return device.makeBuffer(bytes: base, length: raw.count, options: [.storageModeShared])
    }) else { throw RenderError.resource("ocean grid indices") }
    pb.label = "ocean.grid\(n).positions"
    ib.label = "ocean.grid\(n).indices"
    positions = pb
    indices = ib
  }
}
