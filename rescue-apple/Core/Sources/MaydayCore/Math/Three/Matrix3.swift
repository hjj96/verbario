// THREE.Matrix3 (three.js r185 src/math/Matrix3.js) as a value type. Elements are COLUMN-MAJOR
// like three (`m[0], m[1], m[2]` = first column); `set(...)` takes ROW-MAJOR arguments, as in three.
// Storage is an inline SIMD16 (lanes 9…15 stay 0): no heap allocation, scalar access only — no
// SIMD arithmetic, so every product rounds exactly like the JS. Vectors: math/three_matrix.json.

public struct Mat3: Sendable {
  @usableFromInline var e: SIMD16<Double>

  /// new Matrix3() = identity
  @inline(__always) public init() {
    e = SIMD16<Double>(repeating: 0)
    e[0] = 1
    e[4] = 1
    e[8] = 1
  }

  /// new Matrix3(n11, n12, …, n33)  (row-major arguments)
  public init(_ n11: Double, _ n12: Double, _ n13: Double,
              _ n21: Double, _ n22: Double, _ n23: Double,
              _ n31: Double, _ n32: Double, _ n33: Double) {
    e = SIMD16<Double>(repeating: 0)
    set(n11, n12, n13, n21, n22, n23, n31, n32, n33)
  }

  /// elements[i] (column-major, 0…8)
  @inline(__always) public subscript(i: Int) -> Double {
    get { e[i] }
    set { e[i] = newValue }
  }

  /// elements as an array (column-major).
  public var elements: [Double] { (0..<9).map { e[$0] } }

  /// set(n11, n12, n13, n21, …): row-major arguments → column-major elements
  public mutating func set(_ n11: Double, _ n12: Double, _ n13: Double,
                           _ n21: Double, _ n22: Double, _ n23: Double,
                           _ n31: Double, _ n32: Double, _ n33: Double) {
    e[0] = n11; e[1] = n21; e[2] = n31
    e[3] = n12; e[4] = n22; e[5] = n32
    e[6] = n13; e[7] = n23; e[8] = n33
  }

  public mutating func identity() { set(1, 0, 0, 0, 1, 0, 0, 0, 1) }

  /// fromArray(array, offset)
  public mutating func fromArray(_ a: [Double], _ offset: Int = 0) {
    for i in 0..<9 { e[i] = a[i + offset] }
  }

  /// setFromMatrix4(m): upper-left 3×3
  public mutating func setFromMatrix4(_ m: Mat4) {
    set(m[0], m[4], m[8],
        m[1], m[5], m[9],
        m[2], m[6], m[10])
  }

  /// multiply(m) = this × m
  @inline(__always) public mutating func multiply(_ m: Mat3) { multiplyMatrices(self, m) }

  /// premultiply(m) = m × this
  @inline(__always) public mutating func premultiply(_ m: Mat3) { multiplyMatrices(m, self) }

  public mutating func multiplyMatrices(_ a: Mat3, _ b: Mat3) {
    let a11 = a[0], a12 = a[3], a13 = a[6]
    let a21 = a[1], a22 = a[4], a23 = a[7]
    let a31 = a[2], a32 = a[5], a33 = a[8]
    let b11 = b[0], b12 = b[3], b13 = b[6]
    let b21 = b[1], b22 = b[4], b23 = b[7]
    let b31 = b[2], b32 = b[5], b33 = b[8]
    e[0] = a11 * b11 + a12 * b21 + a13 * b31
    e[3] = a11 * b12 + a12 * b22 + a13 * b32
    e[6] = a11 * b13 + a12 * b23 + a13 * b33
    e[1] = a21 * b11 + a22 * b21 + a23 * b31
    e[4] = a21 * b12 + a22 * b22 + a23 * b32
    e[7] = a21 * b13 + a22 * b23 + a23 * b33
    e[2] = a31 * b11 + a32 * b21 + a33 * b31
    e[5] = a31 * b12 + a32 * b22 + a33 * b32
    e[8] = a31 * b13 + a32 * b23 + a33 * b33
  }

  public mutating func multiplyScalar(_ s: Double) {
    for i in 0..<9 { e[i] *= s }
  }

  /// determinant() = a e i - a f h - b d i + b f g + c d h - c e g   (elements a…i in storage order)
  public func determinant() -> Double {
    let a = e[0], b = e[1], c = e[2],
        d = e[3], ee = e[4], f = e[5],
        g = e[6], h = e[7], i = e[8]
    return a * ee * i - a * f * h - b * d * i + b * f * g + c * d * h - c * ee * g
  }

  /// invert(): zero matrix when the determinant is 0
  public mutating func invert() {
    let n11 = e[0], n21 = e[1], n31 = e[2],
        n12 = e[3], n22 = e[4], n32 = e[5],
        n13 = e[6], n23 = e[7], n33 = e[8],
        t11 = n33 * n22 - n32 * n23,
        t12 = n32 * n13 - n33 * n12,
        t13 = n23 * n12 - n22 * n13,
        det = n11 * t11 + n21 * t12 + n31 * t13
    if det == 0 {
      set(0, 0, 0, 0, 0, 0, 0, 0, 0)
      return
    }
    let detInv = 1 / det
    e[0] = t11 * detInv
    e[1] = (n31 * n23 - n33 * n21) * detInv
    e[2] = (n32 * n21 - n31 * n22) * detInv
    e[3] = t12 * detInv
    e[4] = (n33 * n11 - n31 * n13) * detInv
    e[5] = (n31 * n12 - n32 * n11) * detInv
    e[6] = t13 * detInv
    e[7] = (n21 * n13 - n23 * n11) * detInv
    e[8] = (n22 * n11 - n21 * n12) * detInv
  }

  public mutating func transpose() {
    var tmp = e[1]; e[1] = e[3]; e[3] = tmp
    tmp = e[2]; e[2] = e[6]; e[6] = tmp
    tmp = e[5]; e[5] = e[7]; e[7] = tmp
  }

  /// getNormalMatrix(m4) = setFromMatrix4(m4).invert().transpose()
  public mutating func getNormalMatrix(_ m: Mat4) {
    setFromMatrix4(m)
    invert()
    transpose()
  }

  /// setUvTransform(tx, ty, sx, sy, rotation, cx, cy)
  public mutating func setUvTransform(_ tx: Double, _ ty: Double, _ sx: Double, _ sy: Double,
                                      _ rotation: Double, _ cx: Double, _ cy: Double) {
    let c = JS.cos(rotation)
    let s = JS.sin(rotation)
    set(sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx,
        -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty,
        0, 0, 1)
  }

  public mutating func makeTranslation(_ x: Double, _ y: Double) { set(1, 0, x, 0, 1, y, 0, 0, 1) }

  public mutating func makeRotation(_ theta: Double) {
    let c = JS.cos(theta)
    let s = JS.sin(theta)
    set(c, -s, 0, s, c, 0, 0, 0, 1)
  }

  public mutating func makeScale(_ x: Double, _ y: Double) { set(x, 0, 0, 0, y, 0, 0, 0, 1) }

  /// equals(m): strict === per element
  public func equals(_ m: Mat3) -> Bool {
    for i in 0..<9 where e[i] != m[i] { return false }
    return true
  }
}

extension Mat3: Equatable {
  /// Element-wise strict equality (same as `equals`; the unused storage lanes are always 0).
  public static func == (a: Mat3, b: Mat3) -> Bool { a.equals(b) }
}
