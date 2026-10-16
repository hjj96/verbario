// THREE.Matrix4 (three.js r185 src/math/Matrix4.js) as a value type. Elements are COLUMN-MAJOR
// like three (translation in 12, 13, 14); `set(...)` takes ROW-MAJOR arguments, as in three.
// Projection matrices use three's WebGL conventions (clip z in [-1, 1]); the Metal conversion lives
// in MaydayRender's CameraMatrices. Storage is an inline SIMD16 with scalar access only (no SIMD
// arithmetic), so every expression rounds exactly like the JS. Vectors: math/three_matrix.json.

/// three's `coordinateSystem` argument of makePerspective / makeOrthographic.
public enum CoordinateSystem: Sendable {
  /// WebGLCoordinateSystem (2000): clip z in [-1, 1] — what the web game uses.
  case webGL
  /// WebGPUCoordinateSystem (2001): clip z in [0, 1].
  case webGPU
}

public struct Mat4: Sendable {
  @usableFromInline var e: SIMD16<Double>

  /// new Matrix4() = identity
  @inline(__always) public init() {
    e = SIMD16<Double>(repeating: 0)
    e[0] = 1
    e[5] = 1
    e[10] = 1
    e[15] = 1
  }

  /// new Matrix4(n11, n12, …, n44)  (row-major arguments)
  public init(_ n11: Double, _ n12: Double, _ n13: Double, _ n14: Double,
              _ n21: Double, _ n22: Double, _ n23: Double, _ n24: Double,
              _ n31: Double, _ n32: Double, _ n33: Double, _ n34: Double,
              _ n41: Double, _ n42: Double, _ n43: Double, _ n44: Double) {
    e = SIMD16<Double>(repeating: 0)
    set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44)
  }

  public static let identity = Mat4()

  /// elements[i] (column-major, 0…15)
  @inline(__always) public subscript(i: Int) -> Double {
    get { e[i] }
    set { e[i] = newValue }
  }

  /// elements as an array (column-major), e.g. for upload or serialisation.
  public var elements: [Double] { (0..<16).map { e[$0] } }

  /// set(n11, n12, n13, n14, n21, …): row-major arguments → column-major elements
  public mutating func set(_ n11: Double, _ n12: Double, _ n13: Double, _ n14: Double,
                           _ n21: Double, _ n22: Double, _ n23: Double, _ n24: Double,
                           _ n31: Double, _ n32: Double, _ n33: Double, _ n34: Double,
                           _ n41: Double, _ n42: Double, _ n43: Double, _ n44: Double) {
    e[0] = n11; e[4] = n12; e[8] = n13; e[12] = n14
    e[1] = n21; e[5] = n22; e[9] = n23; e[13] = n24
    e[2] = n31; e[6] = n32; e[10] = n33; e[14] = n34
    e[3] = n41; e[7] = n42; e[11] = n43; e[15] = n44
  }

  public mutating func identity() { self = Mat4() }

  /// fromArray(array, offset)
  public mutating func fromArray(_ a: [Double], _ offset: Int = 0) {
    for i in 0..<16 { e[i] = a[i + offset] }
  }

  /// copyPosition(m): elements 12…14
  public mutating func copyPosition(_ m: Mat4) {
    e[12] = m[12]
    e[13] = m[13]
    e[14] = m[14]
  }

  /// setFromMatrix3(m)
  public mutating func setFromMatrix3(_ m: Mat3) {
    set(m[0], m[3], m[6], 0,
        m[1], m[4], m[7], 0,
        m[2], m[5], m[8], 0,
        0, 0, 0, 1)
  }

  /// extractBasis(): the three basis columns (unit axes when the upper 3×3 is singular)
  public func extractBasis() -> (x: V3, y: V3, z: V3) {
    if determinantAffine() == 0 { return (V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)) }
    var x = V3(), y = V3(), z = V3()
    x.setFromMatrixColumn(self, 0)
    y.setFromMatrixColumn(self, 1)
    z.setFromMatrixColumn(self, 2)
    return (x, y, z)
  }

  /// makeBasis(xAxis, yAxis, zAxis)
  public mutating func makeBasis(_ xAxis: V3, _ yAxis: V3, _ zAxis: V3) {
    set(xAxis.x, yAxis.x, zAxis.x, 0,
        xAxis.y, yAxis.y, zAxis.y, 0,
        xAxis.z, yAxis.z, zAxis.z, 0,
        0, 0, 0, 1)
  }

  /// extractRotation(m): m's upper 3×3 with the column scales divided out (identity if singular)
  public mutating func extractRotation(_ m: Mat4) {
    if m.determinantAffine() == 0 {
      identity()
      return
    }
    var v = V3()
    v.setFromMatrixColumn(m, 0)
    let scaleX = 1 / v.length
    v.setFromMatrixColumn(m, 1)
    let scaleY = 1 / v.length
    v.setFromMatrixColumn(m, 2)
    let scaleZ = 1 / v.length
    e[0] = m[0] * scaleX
    e[1] = m[1] * scaleX
    e[2] = m[2] * scaleX
    e[3] = 0
    e[4] = m[4] * scaleY
    e[5] = m[5] * scaleY
    e[6] = m[6] * scaleY
    e[7] = 0
    e[8] = m[8] * scaleZ
    e[9] = m[9] * scaleZ
    e[10] = m[10] * scaleZ
    e[11] = 0
    e[12] = 0
    e[13] = 0
    e[14] = 0
    e[15] = 1
  }

  /// makeRotationFromEuler(euler): rotation part per order; translation cleared, e15 = 1
  public mutating func makeRotationFromEuler(_ euler: Euler) {
    let x = euler.x, y = euler.y, z = euler.z
    let a = JS.cos(x), b = JS.sin(x)
    let c = JS.cos(y), d = JS.sin(y)
    let ee = JS.cos(z), f = JS.sin(z)
    switch euler.order {
    case .XYZ:
      let ae = a * ee, af = a * f, be = b * ee, bf = b * f
      e[0] = c * ee
      e[4] = -c * f
      e[8] = d
      e[1] = af + be * d
      e[5] = ae - bf * d
      e[9] = -b * c
      e[2] = bf - ae * d
      e[6] = be + af * d
      e[10] = a * c
    case .YXZ:
      let ce = c * ee, cf = c * f, de = d * ee, df = d * f
      e[0] = ce + df * b
      e[4] = de * b - cf
      e[8] = a * d
      e[1] = a * f
      e[5] = a * ee
      e[9] = -b
      e[2] = cf * b - de
      e[6] = df + ce * b
      e[10] = a * c
    case .ZXY:
      let ce = c * ee, cf = c * f, de = d * ee, df = d * f
      e[0] = ce - df * b
      e[4] = -a * f
      e[8] = de + cf * b
      e[1] = cf + de * b
      e[5] = a * ee
      e[9] = df - ce * b
      e[2] = -a * d
      e[6] = b
      e[10] = a * c
    case .ZYX:
      let ae = a * ee, af = a * f, be = b * ee, bf = b * f
      e[0] = c * ee
      e[4] = be * d - af
      e[8] = ae * d + bf
      e[1] = c * f
      e[5] = bf * d + ae
      e[9] = af * d - be
      e[2] = -d
      e[6] = b * c
      e[10] = a * c
    case .YZX:
      let ac = a * c, ad = a * d, bc = b * c, bd = b * d
      e[0] = c * ee
      e[4] = bd - ac * f
      e[8] = bc * f + ad
      e[1] = f
      e[5] = a * ee
      e[9] = -b * ee
      e[2] = -d * ee
      e[6] = ad * f + bc
      e[10] = ac - bd * f
    case .XZY:
      let ac = a * c, ad = a * d, bc = b * c, bd = b * d
      e[0] = c * ee
      e[4] = -f
      e[8] = d * ee
      e[1] = ac * f + bd
      e[5] = a * ee
      e[9] = ad * f - bc
      e[2] = bc * f - ad
      e[6] = b * ee
      e[10] = bd * f + ac
    }
    e[3] = 0
    e[7] = 0
    e[11] = 0
    e[12] = 0
    e[13] = 0
    e[14] = 0
    e[15] = 1
  }

  /// makeRotationFromQuaternion(q) = compose(zero, q, one)
  public mutating func makeRotationFromQuaternion(_ q: Quat) {
    compose(V3(0, 0, 0), q, V3(1, 1, 1))
  }

  /// lookAt(eye, target, up): rotation only (translation untouched), three's degenerate fallbacks
  public mutating func lookAt(_ eye: V3, _ target: V3, _ up: V3) {
    var zv = V3()
    zv.subVectors(eye, target)
    if zv.lengthSq == 0 {
      zv.z = 1 // eye and target are in the same position
    }
    zv.normalize()
    var xv = V3()
    xv.crossVectors(up, zv)
    if xv.lengthSq == 0 {
      // up and z are parallel
      if JS.abs(up.z) == 1 {
        zv.x += 0.0001
      } else {
        zv.z += 0.0001
      }
      zv.normalize()
      xv.crossVectors(up, zv)
    }
    xv.normalize()
    var yv = V3()
    yv.crossVectors(zv, xv)
    e[0] = xv.x; e[4] = yv.x; e[8] = zv.x
    e[1] = xv.y; e[5] = yv.y; e[9] = zv.y
    e[2] = xv.z; e[6] = yv.z; e[10] = zv.z
  }

  /// multiply(m) = this × m
  @inline(__always) public mutating func multiply(_ m: Mat4) { multiplyMatrices(self, m) }

  /// premultiply(m) = m × this
  @inline(__always) public mutating func premultiply(_ m: Mat4) { multiplyMatrices(m, self) }

  public mutating func multiplyMatrices(_ a: Mat4, _ b: Mat4) {
    let a11 = a[0], a12 = a[4], a13 = a[8], a14 = a[12]
    let a21 = a[1], a22 = a[5], a23 = a[9], a24 = a[13]
    let a31 = a[2], a32 = a[6], a33 = a[10], a34 = a[14]
    let a41 = a[3], a42 = a[7], a43 = a[11], a44 = a[15]
    let b11 = b[0], b12 = b[4], b13 = b[8], b14 = b[12]
    let b21 = b[1], b22 = b[5], b23 = b[9], b24 = b[13]
    let b31 = b[2], b32 = b[6], b33 = b[10], b34 = b[14]
    let b41 = b[3], b42 = b[7], b43 = b[11], b44 = b[15]
    e[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41
    e[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
    e[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43
    e[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
    e[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41
    e[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
    e[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43
    e[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
    e[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41
    e[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
    e[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43
    e[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
    e[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41
    e[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
    e[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43
    e[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44
  }

  public mutating func multiplyScalar(_ s: Double) {
    for i in 0..<16 { e[i] *= s }
  }

  /// determinant() (cofactor expansion along the first row, three's term order)
  public func determinant() -> Double {
    let n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12]
    let n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13]
    let n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14]
    let n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15]
    let t11 = n23 * n34 - n24 * n33
    let t12 = n22 * n34 - n24 * n32
    let t13 = n22 * n33 - n23 * n32
    let t21 = n21 * n34 - n24 * n31
    let t22 = n21 * n33 - n23 * n31
    let t23 = n21 * n32 - n22 * n31
    let p1 = n11 * (n42 * t11 - n43 * t12 + n44 * t13)
    let p2 = n12 * (n41 * t11 - n43 * t21 + n44 * t22)
    let p3 = n13 * (n41 * t12 - n42 * t21 + n44 * t23)
    let p4 = n14 * (n41 * t13 - n42 * t22 + n43 * t23)
    return p1 - p2 + p3 - p4
  }

  /// determinantAffine(): determinant of the upper 3×3
  public func determinantAffine() -> Double {
    let n11 = e[0], n12 = e[4], n13 = e[8]
    let n21 = e[1], n22 = e[5], n23 = e[9]
    let n31 = e[2], n32 = e[6], n33 = e[10]
    return n11 * (n22 * n33 - n23 * n32) -
      n12 * (n21 * n33 - n23 * n31) +
      n13 * (n21 * n32 - n22 * n31)
  }

  public mutating func transpose() {
    var tmp = e[1]; e[1] = e[4]; e[4] = tmp
    tmp = e[2]; e[2] = e[8]; e[8] = tmp
    tmp = e[6]; e[6] = e[9]; e[9] = tmp
    tmp = e[3]; e[3] = e[12]; e[12] = tmp
    tmp = e[7]; e[7] = e[13]; e[13] = tmp
    tmp = e[11]; e[11] = e[14]; e[14] = tmp
  }

  /// setPosition(x, y, z)
  public mutating func setPosition(_ x: Double, _ y: Double, _ z: Double) {
    e[12] = x
    e[13] = y
    e[14] = z
  }

  /// setPosition(v)
  public mutating func setPosition(_ v: V3) { setPosition(v.x, v.y, v.z) }

  /// invert(): zero matrix when the determinant is 0
  public mutating func invert() {
    let n11 = e[0], n21 = e[1], n31 = e[2], n41 = e[3],
        n12 = e[4], n22 = e[5], n32 = e[6], n42 = e[7],
        n13 = e[8], n23 = e[9], n33 = e[10], n43 = e[11],
        n14 = e[12], n24 = e[13], n34 = e[14], n44 = e[15]
    let t1 = n11 * n22 - n21 * n12,
        t2 = n11 * n32 - n31 * n12,
        t3 = n11 * n42 - n41 * n12,
        t4 = n21 * n32 - n31 * n22,
        t5 = n21 * n42 - n41 * n22,
        t6 = n31 * n42 - n41 * n32,
        t7 = n13 * n24 - n23 * n14,
        t8 = n13 * n34 - n33 * n14,
        t9 = n13 * n44 - n43 * n14,
        t10 = n23 * n34 - n33 * n24,
        t11 = n23 * n44 - n43 * n24,
        t12 = n33 * n44 - n43 * n34
    let det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7
    if det == 0 {
      e = SIMD16<Double>(repeating: 0)
      return
    }
    let detInv = 1 / det
    e[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv
    e[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv
    e[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv
    e[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv
    e[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv
    e[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv
    e[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv
    e[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv
    e[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv
    e[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv
    e[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv
    e[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv
    e[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv
    e[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv
    e[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv
    e[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv
  }

  /// scale(v): columns 0…2 multiplied by v.x, v.y, v.z
  public mutating func scale(_ v: V3) {
    let x = v.x, y = v.y, z = v.z
    e[0] *= x; e[4] *= y; e[8] *= z
    e[1] *= x; e[5] *= y; e[9] *= z
    e[2] *= x; e[6] *= y; e[10] *= z
    e[3] *= x; e[7] *= y; e[11] *= z
  }

  /// getMaxScaleOnAxis() = sqrt(max(|col0|², |col1|², |col2|²))
  public func getMaxScaleOnAxis() -> Double {
    let scaleXSq = e[0] * e[0] + e[1] * e[1] + e[2] * e[2]
    let scaleYSq = e[4] * e[4] + e[5] * e[5] + e[6] * e[6]
    let scaleZSq = e[8] * e[8] + e[9] * e[9] + e[10] * e[10]
    return JS.max(scaleXSq, scaleYSq, scaleZSq).squareRoot()
  }

  public mutating func makeTranslation(_ x: Double, _ y: Double, _ z: Double) {
    set(1, 0, 0, x,
        0, 1, 0, y,
        0, 0, 1, z,
        0, 0, 0, 1)
  }

  public mutating func makeTranslation(_ v: V3) { makeTranslation(v.x, v.y, v.z) }

  public mutating func makeRotationX(_ theta: Double) {
    let c = JS.cos(theta), s = JS.sin(theta)
    set(1, 0, 0, 0,
        0, c, -s, 0,
        0, s, c, 0,
        0, 0, 0, 1)
  }

  public mutating func makeRotationY(_ theta: Double) {
    let c = JS.cos(theta), s = JS.sin(theta)
    set(c, 0, s, 0,
        0, 1, 0, 0,
        -s, 0, c, 0,
        0, 0, 0, 1)
  }

  public mutating func makeRotationZ(_ theta: Double) {
    let c = JS.cos(theta), s = JS.sin(theta)
    set(c, -s, 0, 0,
        s, c, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1)
  }

  /// makeRotationAxis(axis, angle): axis must be normalized
  public mutating func makeRotationAxis(_ axis: V3, _ angle: Double) {
    let c = JS.cos(angle)
    let s = JS.sin(angle)
    let t = 1 - c
    let x = axis.x, y = axis.y, z = axis.z
    let tx = t * x, ty = t * y
    set(tx * x + c, tx * y - s * z, tx * z + s * y, 0,
        tx * y + s * z, ty * y + c, ty * z - s * x, 0,
        tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
        0, 0, 0, 1)
  }

  public mutating func makeScale(_ x: Double, _ y: Double, _ z: Double) {
    set(x, 0, 0, 0,
        0, y, 0, 0,
        0, 0, z, 0,
        0, 0, 0, 1)
  }

  public mutating func makeShear(_ xy: Double, _ xz: Double, _ yx: Double, _ yz: Double, _ zx: Double, _ zy: Double) {
    set(1, yx, zx, 0,
        xy, 1, zy, 0,
        xz, yz, 1, 0,
        0, 0, 0, 1)
  }

  /// compose(position, quaternion, scale)
  public mutating func compose(_ position: V3, _ quaternion: Quat, _ scale: V3) {
    let x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w
    let x2 = x + x, y2 = y + y, z2 = z + z
    let xx = x * x2, xy = x * y2, xz = x * z2
    let yy = y * y2, yz = y * z2, zz = z * z2
    let wx = w * x2, wy = w * y2, wz = w * z2
    let sx = scale.x, sy = scale.y, sz = scale.z
    e[0] = (1 - (yy + zz)) * sx
    e[1] = (xy + wz) * sx
    e[2] = (xz - wy) * sx
    e[3] = 0
    e[4] = (xy - wz) * sy
    e[5] = (1 - (xx + zz)) * sy
    e[6] = (yz + wx) * sy
    e[7] = 0
    e[8] = (xz + wy) * sz
    e[9] = (yz - wx) * sz
    e[10] = (1 - (xx + yy)) * sz
    e[11] = 0
    e[12] = position.x
    e[13] = position.y
    e[14] = position.z
    e[15] = 1
  }

  /// decompose() → (position, quaternion, scale); a singular upper 3×3 gives scale 1 and identity
  public func decompose() -> (position: V3, quaternion: Quat, scale: V3) {
    let position = V3(e[12], e[13], e[14])
    let det = determinantAffine()
    if det == 0 { return (position, Quat(), V3(1, 1, 1)) }
    var sx = V3(e[0], e[1], e[2]).length
    let sy = V3(e[4], e[5], e[6]).length
    let sz = V3(e[8], e[9], e[10]).length
    if det < 0 { sx = -sx } // if determinant is negative, we need to invert one scale
    var m1 = self
    let invSX = 1 / sx
    let invSY = 1 / sy
    let invSZ = 1 / sz
    m1[0] *= invSX
    m1[1] *= invSX
    m1[2] *= invSX
    m1[4] *= invSY
    m1[5] *= invSY
    m1[6] *= invSY
    m1[8] *= invSZ
    m1[9] *= invSZ
    m1[10] *= invSZ
    var q = Quat()
    q.setFromRotationMatrix(m1)
    return (position, q, V3(sx, sy, sz))
  }

  /// makePerspective(left, right, top, bottom, near, far, coordinateSystem = WebGL, reversedDepth = false)
  public mutating func makePerspective(_ left: Double, _ right: Double, _ top: Double, _ bottom: Double,
                                       _ near: Double, _ far: Double,
                                       _ coordinateSystem: CoordinateSystem = .webGL, reversedDepth: Bool = false) {
    let x = 2 * near / (right - left)
    let y = 2 * near / (top - bottom)
    let a = (right + left) / (right - left)
    let b = (top + bottom) / (top - bottom)
    let c: Double, d: Double
    if reversedDepth {
      c = near / (far - near)
      d = (far * near) / (far - near)
    } else if coordinateSystem == .webGL {
      c = -(far + near) / (far - near)
      d = (-2 * far * near) / (far - near)
    } else {
      c = -far / (far - near)
      d = (-far * near) / (far - near)
    }
    e[0] = x; e[4] = 0; e[8] = a; e[12] = 0
    e[1] = 0; e[5] = y; e[9] = b; e[13] = 0
    e[2] = 0; e[6] = 0; e[10] = c; e[14] = d
    e[3] = 0; e[7] = 0; e[11] = -1; e[15] = 0
  }

  /// makeOrthographic(left, right, top, bottom, near, far, coordinateSystem = WebGL, reversedDepth = false)
  public mutating func makeOrthographic(_ left: Double, _ right: Double, _ top: Double, _ bottom: Double,
                                        _ near: Double, _ far: Double,
                                        _ coordinateSystem: CoordinateSystem = .webGL, reversedDepth: Bool = false) {
    let x = 2 / (right - left)
    let y = 2 / (top - bottom)
    let a = -(right + left) / (right - left)
    let b = -(top + bottom) / (top - bottom)
    let c: Double, d: Double
    if reversedDepth {
      c = 1 / (far - near)
      d = far / (far - near)
    } else if coordinateSystem == .webGL {
      c = -2 / (far - near)
      d = -(far + near) / (far - near)
    } else {
      c = -1 / (far - near)
      d = -near / (far - near)
    }
    e[0] = x; e[4] = 0; e[8] = 0; e[12] = a
    e[1] = 0; e[5] = y; e[9] = 0; e[13] = b
    e[2] = 0; e[6] = 0; e[10] = c; e[14] = d
    e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1
  }

  /// equals(m): strict === per element
  public func equals(_ m: Mat4) -> Bool {
    for i in 0..<16 where e[i] != m[i] { return false }
    return true
  }
}

extension Mat4: Equatable {
  /// Element-wise strict equality (same as `equals`).
  public static func == (a: Mat4, b: Mat4) -> Bool { a.equals(b) }
}
