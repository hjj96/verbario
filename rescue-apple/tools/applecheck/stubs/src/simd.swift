// Linux stand-in for Apple's simd overlay: the API the app uses, with REAL arithmetic (the runtime
// harness evaluates CameraMatrices with it). Not a parity reference for Apple's simd rounding.
@_exported import simd
extension simd_float4x4 {
  public init(columns: (SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>)) { self.init(); self.columns = columns }
  public var inverse: simd_float4x4 {
    let d = simd_double4x4(columns: (SIMD4<Double>(columns.0), SIMD4<Double>(columns.1), SIMD4<Double>(columns.2), SIMD4<Double>(columns.3))).inverse
    return simd_float4x4(columns: (SIMD4<Float>(d.columns.0), SIMD4<Float>(d.columns.1), SIMD4<Float>(d.columns.2), SIMD4<Float>(d.columns.3)))
  }
  public static func * (a: simd_float4x4, b: SIMD4<Float>) -> SIMD4<Float> { a.columns.0 * b.x + a.columns.1 * b.y + a.columns.2 * b.z + a.columns.3 * b.w }
  public static func * (a: simd_float4x4, b: simd_float4x4) -> simd_float4x4 { simd_float4x4(columns: (a * b.columns.0, a * b.columns.1, a * b.columns.2, a * b.columns.3)) }
}
extension simd_double4x4 {
  public init(columns: (SIMD4<Double>, SIMD4<Double>, SIMD4<Double>, SIMD4<Double>)) { self.init(); self.columns = columns }
  public static func * (a: simd_double4x4, b: SIMD4<Double>) -> SIMD4<Double> { a.columns.0 * b.x + a.columns.1 * b.y + a.columns.2 * b.z + a.columns.3 * b.w }
  public static func * (a: simd_double4x4, b: simd_double4x4) -> simd_double4x4 { simd_double4x4(columns: (a * b.columns.0, a * b.columns.1, a * b.columns.2, a * b.columns.3)) }
  /// Gauss–Jordan inverse with partial pivoting (row-major work copy).
  public var inverse: simd_double4x4 {
    let c = [columns.0, columns.1, columns.2, columns.3]
    var m = [[Double]](repeating: [Double](repeating: 0, count: 8), count: 4)
    for r in 0..<4 { for k in 0..<4 { m[r][k] = c[k][r] }; m[r][4 + r] = 1 }
    for col in 0..<4 {
      var p = col
      for r in col..<4 where abs(m[r][col]) > abs(m[p][col]) { p = r }
      m.swapAt(col, p)
      let inv = 1 / m[col][col]
      for k in 0..<8 { m[col][k] *= inv }
      for r in 0..<4 where r != col { let f = m[r][col]; if f != 0 { for k in 0..<8 { m[r][k] -= f * m[col][k] } } }
    }
    func colv(_ k: Int) -> SIMD4<Double> { SIMD4<Double>(m[0][4 + k], m[1][4 + k], m[2][4 + k], m[3][4 + k]) }
    return simd_double4x4(columns: (colv(0), colv(1), colv(2), colv(3)))
  }
}
public func simd_dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
public func simd_dot(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float { a.x * b.x + a.y * b.y + a.z * b.z }
public func simd_dot(_ a: SIMD4<Double>, _ b: SIMD4<Double>) -> Double { a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w }
public func simd_length_squared(_ v: SIMD3<Double>) -> Double { simd_dot(v, v) }
public func simd_length_squared(_ v: SIMD3<Float>) -> Float { simd_dot(v, v) }
public func simd_length(_ v: SIMD3<Double>) -> Double { simd_dot(v, v).squareRoot() }
public func simd_length(_ v: SIMD3<Float>) -> Float { simd_dot(v, v).squareRoot() }
public func simd_normalize(_ v: SIMD3<Double>) -> SIMD3<Double> { v / simd_length(v) }
public func simd_normalize(_ v: SIMD3<Float>) -> SIMD3<Float> { v / simd_length(v) }
public func simd_cross(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> SIMD3<Double> { SIMD3<Double>(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x) }
public func simd_cross(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> { SIMD3<Float>(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x) }
public func simd_mix(_ a: SIMD3<Double>, _ b: SIMD3<Double>, _ t: SIMD3<Double>) -> SIMD3<Double> { a + (b - a) * t }
