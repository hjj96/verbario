// Warped camera-following ocean grid (systems/ocean/grid.js; DESIGN §2.6.1).
// N×N cells on [−1, 1], x' = sign(x)·|x|^1.6·380 (760 m across, dense under the focus), plus two
// flat "skirt" rows on every side out to 3 km. Vertices store LOCAL grid coordinates; the vertex
// shader adds the snapped world offset. Positions are Float32 like the web BufferAttribute.

public struct OceanGridMesh {
  /// Axis coordinates (M = N + 1 + 4 values), metres, as doubles before the Float32 store.
  public let coords: [Double]
  /// xyz per vertex (y = 0), row-major j (z) then i (x).
  public let positions: [Float]
  /// 0,1,0 per vertex (real normals come from the vertex shader).
  public let normals: [Float]
  /// Triangle list; diagonals mirror per quadrant (diamond pattern).
  public let indices: [UInt32]
  public var side: Int { coords.count }
}

public enum OceanGrid {
  /// buildOceanGrid(N)
  public static func build(_ N: Int, constants: WaveConstants = .web) -> OceanGridMesh {
    var coords = [Double]()
    coords.append(-constants.skirtRows[1])
    coords.append(-constants.skirtRows[0])
    for i in 0...N {
      let x = -1 + Double(2 * i) / Double(N)
      coords.append(JS.sign(x) * JS.pow(JS.abs(x), constants.gridPow) * constants.gridExtent)
    }
    coords.append(constants.skirtRows[0])
    coords.append(constants.skirtRows[1])
    let M = coords.count
    let mid = Double(M - 1) / 2

    var pos = [Float](repeating: 0, count: M * M * 3)
    var nrm = [Float](repeating: 0, count: M * M * 3)
    for j in 0..<M {
      for i in 0..<M {
        let v = (j * M + i) * 3
        pos[v] = Float(coords[i])
        pos[v + 2] = Float(coords[j])
        nrm[v + 1] = 1
      }
    }

    var idx = [UInt32](repeating: 0, count: (M - 1) * (M - 1) * 6)
    var k = 0
    for j in 0..<(M - 1) {
      for i in 0..<(M - 1) {
        let a = UInt32(j * M + i)
        let b = a + 1
        let c = a + UInt32(M)
        let d = c + 1
        let flip = (Double(i) < mid) != (Double(j) < mid)
        if flip {
          idx[k] = a; idx[k + 1] = c; idx[k + 2] = b
          idx[k + 3] = b; idx[k + 4] = c; idx[k + 5] = d
        } else {
          idx[k] = a; idx[k + 1] = c; idx[k + 2] = d
          idx[k + 3] = a; idx[k + 4] = d; idx[k + 5] = b
        }
        k += 6
      }
    }
    return OceanGridMesh(coords: coords, positions: pos, normals: nrm, indices: idx)
  }

  /// snapQuantum(N): grid-offset snap step ≈ the cell size 20 m from the focus (≈1.3 m on high).
  public static func snapQuantum(_ N: Int, constants: WaveConstants = .web) -> Double {
    608 * (2 / Double(N)) * JS.pow(20 / constants.gridExtent, 0.375)
  }
}
