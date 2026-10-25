// world/terrain.js boulderGeometry: a smooth displaced sphere (seam-free normals from the gradient of the
// implicit surface), unit size ~1, flattened, the bottom tucked under; aTerr = (0, cavity, 0, 0). Above
// 8 × 5 segments a coarse copy (8 × 5, inscribed in the fine one) follows as the shadow LOD
// (shadowRange). One shape (seed 7) for every boulder of the island and the rocks, instanced with the
// BoulderSet matrices. The sphere is three r185's SphereGeometry, vertex for vertex (its rows use
// sqrt(r² − (r cos θ)²), not r sin θ). Tests/Vectors/world/boulders.json.

public enum BoulderGeometry {
  /// boulderGeometry(seed = 1, wSeg = 14, hSeg = 10, lod = true)
  public static func make(seed: Double = 1, wSeg: Int = 14, hSeg: Int = 10, lod: Bool = true) -> TerrainMesh {
    if lod && (wSeg > 8 || hSeg > 5) {
      let fine = make(seed: seed, wSeg: wSeg, hSeg: hSeg, lod: false)
      let coarse = make(seed: seed, wSeg: Swift.min(8, wSeg), hSeg: Swift.min(5, hSeg), lod: false)
      let nv = UInt32(fine.vertexCount), ni = fine.indices.count
      return TerrainMesh(positions: fine.positions + coarse.positions, normals: fine.normals + coarse.normals, aTerr: fine.aTerr + coarse.aTerr,
                         indices: fine.indices + coarse.indices.map { $0 + nv }, drawCount: ni, shadowRange: (ni, coarse.indices.count))
    }
    let (sphere, index) = sphereGeometry(radius: 1, widthSegments: wSeg, heightSegments: hSeg)
    var pos = sphere
    let count = pos.count / 3
    let sy = 0.62
    func radius(_ dx: Double, _ dy: Double, _ dz: Double) -> Double {
      let r = 1 + 0.24 * TerrainNoise.fbm2(dx * 1.3 + dz * 0.7 + seed, dy * 1.3 - dz * 0.9, seed + 3, 3)
        + 0.07 * TerrainNoise.noise2(dx * 4.1 + dy * 2.3, dz * 4.1 - dy * 1.7, seed + 9)
      // flattened facets of jointing: two soft planar cuts
      return JS.min(JS.min(r, 0.86 + 0.25 * JS.abs(dx * 0.8 + dz * 0.6)), 0.9 + 0.3 * JS.abs(dz * 0.9 - dx * 0.4))
    }
    func F(_ x: Double, _ y: Double, _ z: Double) -> Double {
      let qy = y / sy
      let l = JSNumber.or((x * x + qy * qy + z * z).squareRoot(), 1e-6)
      return l / radius(x / l, qy / l, z / l) - 1
    }
    var nrm = [Float](repeating: 0, count: count * 3)
    var ter = [Float](repeating: 0, count: count * 4)
    let e = 0.01
    for i in 0..<count {
      let dx = Double(pos[i * 3]), dy = Double(pos[i * 3 + 1]), dz = Double(pos[i * 3 + 2])
      let r = radius(dx, dy, dz)
      let x = dx * r, z = dz * r
      var y = dy * r * sy
      if y < -0.18 { y = -0.18 + (y + 0.18) * 0.35 } // tucked bottom (sits in the sand / on the rock)
      pos[i * 3] = Float(x)
      pos[i * 3 + 1] = Float(y)
      pos[i * 3 + 2] = Float(z)
      let gx = F(x + e, y, z) - F(x - e, y, z)
      let gy = F(x, y + e, z) - F(x, y - e, z)
      let gz = F(x, y, z + e) - F(x, y, z - e)
      let gl = JSNumber.or(JS.hypot(gx, gy, gz), 1)
      nrm[i * 3] = Float(gx / gl)
      nrm[i * 3 + 1] = Float(gy / gl)
      nrm[i * 3 + 2] = Float(gz / gl)
      ter[i * 4 + 1] = Float(0.5 + 0.5 * JS.max(0, 0.9 - r)) // dents read as cavities
    }
    return TerrainMesh(positions: pos, normals: nrm, aTerr: ter, indices: index, drawCount: index.count, shadowRange: nil)
  }

  /// THREE.SphereGeometry(radius, widthSegments, heightSegments) with the full φ / θ ranges (r185):
  /// Float32 positions and indices (normals / uvs are not used: the boulder recomputes its normals).
  static func sphereGeometry(radius: Double, widthSegments w0: Int, heightSegments h0: Int) -> ([Float], [UInt32]) {
    let w = Swift.max(3, w0), h = Swift.max(2, h0)
    let phiStart = 0.0, phiLength = 2 * JS.PI, thetaStart = 0.0, thetaLength = JS.PI
    var index: UInt32 = 0
    var grid = [[UInt32]]()
    var vertices = [Float]()
    for iy in 0...h {
      var row = [UInt32]()
      let v = Double(iy) / Double(h)
      let theta = thetaStart + v * thetaLength
      let b = radius * JS.cos(theta)
      let vv = (radius * radius - b * b).squareRoot()
      for ix in 0...w {
        let u = Double(ix) / Double(w)
        let phi = phiStart + u * phiLength
        vertices.append(Float(-vv * JS.cos(phi)))
        vertices.append(Float(b))
        vertices.append(Float(vv * JS.sin(phi)))
        row.append(index)
        index += 1
      }
      grid.append(row)
    }
    let thetaEnd = JS.min(thetaStart + thetaLength, JS.PI)
    var indices = [UInt32]()
    for iy in 0..<h {
      for ix in 0..<w {
        let a = grid[iy][ix + 1], bb = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1]
        if iy != 0 || thetaStart > 0 { indices.append(contentsOf: [a, bb, d]) }
        if iy != h - 1 || thetaEnd < JS.PI { indices.append(contentsOf: [bb, c, d]) }
      }
    }
    return (vertices, indices)
  }

  /// The boulder mesh of a quality (BOULDER_SEG[q], seed 7; unknown → high).
  public static func forQuality(_ q: String, tables t: WorldTables) -> TerrainMesh {
    let seg = t.boulderSeg[q] ?? t.boulderSeg["high"] ?? [10, 7]
    return make(seed: 7, wSeg: seg[0], hSeg: seg[1])
  }
}
