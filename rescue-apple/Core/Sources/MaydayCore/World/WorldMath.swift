// Float32 matrix storage shared by the world ports: InstancedMesh.setMatrixAt writes the 16
// column-major elements of a Matrix4 into a Float32Array (boulders, vegetation, floaters, collars,
// rigging all hand the renderer exactly those floats).

extension Mat4 {
  /// setMatrixAt(i, m): the column-major elements rounded to Float, written at `offset`.
  @inline(__always) public func storeFloat32(into a: inout [Float], at offset: Int) {
    for k in 0..<16 { a[offset + k] = Float(self[k]) }
  }
}

/// A JS number used as a loop bound or array size → Int without trapping: non-finite or absurd values
/// become 0 (a JS `for (i < NaN)` loop runs zero times; a `new Float32Array(NaN)` would throw and the web
/// would disable the system — Core must not trap instead).
@inline(__always) func worldCount(_ x: Double) -> Int {
  x.isFinite && x > -1e12 && x < 1e12 ? Int(x) : 0
}
