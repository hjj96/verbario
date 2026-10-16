// THREE.Quaternion (three.js r185 src/math/Quaternion.js) as a value type, statement for statement.
// The `_onChangeCallback` hook three uses to keep Object3D.rotation in sync is not part of the math;
// whoever owns an Euler/Quat pair syncs it explicitly (Euler.setFromQuaternion / Quat.setFromEuler).
// Vectors: Tests/Vectors/math/three_quaternion.json.

public struct Quat: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var w: Double

  /// new Quaternion(x = 0, y = 0, z = 0, w = 1)
  @inline(__always) public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0, _ w: Double = 1) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  public static let identity = Quat()

  @inline(__always) public mutating func set(_ x: Double, _ y: Double, _ z: Double, _ w: Double) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  public var array: [Double] { [x, y, z, w] }

  /// fromArray(array, offset)
  public mutating func fromArray(_ a: [Double], _ offset: Int = 0) {
    set(a[offset], a[offset + 1], a[offset + 2], a[offset + 3])
  }

  // ---- setFrom* -----------------------------------------------------------------------------------
  /// setFromEuler(euler): half-angle products per rotation order (unknown orders cannot occur:
  /// EulerOrder is closed).
  public mutating func setFromEuler(_ euler: Euler) {
    let x = euler.x, y = euler.y, z = euler.z
    let c1 = JS.cos(x / 2)
    let c2 = JS.cos(y / 2)
    let c3 = JS.cos(z / 2)
    let s1 = JS.sin(x / 2)
    let s2 = JS.sin(y / 2)
    let s3 = JS.sin(z / 2)
    switch euler.order {
    case .XYZ:
      self.x = s1 * c2 * c3 + c1 * s2 * s3
      self.y = c1 * s2 * c3 - s1 * c2 * s3
      self.z = c1 * c2 * s3 + s1 * s2 * c3
      self.w = c1 * c2 * c3 - s1 * s2 * s3
    case .YXZ:
      self.x = s1 * c2 * c3 + c1 * s2 * s3
      self.y = c1 * s2 * c3 - s1 * c2 * s3
      self.z = c1 * c2 * s3 - s1 * s2 * c3
      self.w = c1 * c2 * c3 + s1 * s2 * s3
    case .ZXY:
      self.x = s1 * c2 * c3 - c1 * s2 * s3
      self.y = c1 * s2 * c3 + s1 * c2 * s3
      self.z = c1 * c2 * s3 + s1 * s2 * c3
      self.w = c1 * c2 * c3 - s1 * s2 * s3
    case .ZYX:
      self.x = s1 * c2 * c3 - c1 * s2 * s3
      self.y = c1 * s2 * c3 + s1 * c2 * s3
      self.z = c1 * c2 * s3 - s1 * s2 * c3
      self.w = c1 * c2 * c3 + s1 * s2 * s3
    case .YZX:
      self.x = s1 * c2 * c3 + c1 * s2 * s3
      self.y = c1 * s2 * c3 + s1 * c2 * s3
      self.z = c1 * c2 * s3 - s1 * s2 * c3
      self.w = c1 * c2 * c3 - s1 * s2 * s3
    case .XZY:
      self.x = s1 * c2 * c3 - c1 * s2 * s3
      self.y = c1 * s2 * c3 - s1 * c2 * s3
      self.z = c1 * c2 * s3 + s1 * s2 * c3
      self.w = c1 * c2 * c3 + s1 * s2 * s3
    }
  }

  /// setFromAxisAngle(axis, angle): axis must be normalized
  public mutating func setFromAxisAngle(_ axis: V3, _ angle: Double) {
    let halfAngle = angle / 2, s = JS.sin(halfAngle)
    x = axis.x * s
    y = axis.y * s
    z = axis.z * s
    w = JS.cos(halfAngle)
  }

  /// setFromRotationMatrix(m): upper 3×3 of m must be a pure (unscaled) rotation
  public mutating func setFromRotationMatrix(_ m: Mat4) {
    let m11 = m[0], m12 = m[4], m13 = m[8]
    let m21 = m[1], m22 = m[5], m23 = m[9]
    let m31 = m[2], m32 = m[6], m33 = m[10]
    let trace = m11 + m22 + m33
    if trace > 0 {
      let s = 0.5 / (trace + 1.0).squareRoot()
      w = 0.25 / s
      x = (m32 - m23) * s
      y = (m13 - m31) * s
      z = (m21 - m12) * s
    } else if m11 > m22 && m11 > m33 {
      let s = 2.0 * (1.0 + m11 - m22 - m33).squareRoot()
      w = (m32 - m23) / s
      x = 0.25 * s
      y = (m12 + m21) / s
      z = (m13 + m31) / s
    } else if m22 > m33 {
      let s = 2.0 * (1.0 + m22 - m11 - m33).squareRoot()
      w = (m13 - m31) / s
      x = (m12 + m21) / s
      y = 0.25 * s
      z = (m23 + m32) / s
    } else {
      let s = 2.0 * (1.0 + m33 - m11 - m22).squareRoot()
      w = (m21 - m12) / s
      x = (m13 + m31) / s
      y = (m23 + m32) / s
      z = 0.25 * s
    }
  }

  /// setFromUnitVectors(vFrom, vTo): both normalized; opposite vectors pick a perpendicular axis
  public mutating func setFromUnitVectors(_ vFrom: V3, _ vTo: V3) {
    var r = vFrom.dot(vTo) + 1
    if r < 1e-8 { // the epsilon value has been discussed in three.js #31286
      r = 0
      if JS.abs(vFrom.x) > JS.abs(vFrom.z) {
        x = -vFrom.y
        y = vFrom.x
        z = 0
        w = r
      } else {
        x = 0
        y = -vFrom.z
        z = vFrom.y
        w = r
      }
    } else {
      x = vFrom.y * vTo.z - vFrom.z * vTo.y
      y = vFrom.z * vTo.x - vFrom.x * vTo.z
      z = vFrom.x * vTo.y - vFrom.y * vTo.x
      w = r
    }
    normalize()
  }

  // ---- measures -----------------------------------------------------------------------------------
  /// angleTo(q) = 2 * acos(|clamp(dot, -1, 1)|)
  public func angleTo(_ q: Quat) -> Double {
    2 * JS.acos(JS.abs(MathUtils.clamp(dot(q), -1, 1)))
  }

  /// rotateTowards(q, step): slerp by min(1, step / angle)
  public mutating func rotateTowards(_ q: Quat, _ step: Double) {
    let angle = angleTo(q)
    if angle == 0 { return }
    let t = JS.min(1, step / angle)
    slerp(q, t)
  }

  @inline(__always) public mutating func identity() { set(0, 0, 0, 1) }

  /// invert() = conjugate()   (assumes a unit quaternion)
  @inline(__always) public mutating func invert() { conjugate() }

  /// conjugate(): x *= -1, y *= -1, z *= -1
  @inline(__always) public mutating func conjugate() {
    x *= -1
    y *= -1
    z *= -1
  }

  @inline(__always) public func dot(_ v: Quat) -> Double { x * v.x + y * v.y + z * v.z + w * v.w }
  @inline(__always) public var lengthSq: Double { x * x + y * y + z * z + w * w }
  @inline(__always) public var length: Double { (x * x + y * y + z * z + w * w).squareRoot() }

  /// normalize(): identity when the length is 0, else multiply by 1 / length
  public mutating func normalize() {
    var l = length
    if l == 0 {
      set(0, 0, 0, 1)
    } else {
      l = 1 / l
      x = x * l
      y = y * l
      z = z * l
      w = w * l
    }
  }

  // ---- products -----------------------------------------------------------------------------------
  /// multiply(q) = multiplyQuaternions(this, q)
  @inline(__always) public mutating func multiply(_ q: Quat) { multiplyQuaternions(self, q) }

  /// premultiply(q) = multiplyQuaternions(q, this)
  @inline(__always) public mutating func premultiply(_ q: Quat) { multiplyQuaternions(q, self) }

  /// multiplyQuaternions(a, b) = a × b
  public mutating func multiplyQuaternions(_ a: Quat, _ b: Quat) {
    let qax = a.x, qay = a.y, qaz = a.z, qaw = a.w
    let qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w
    x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby
    y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz
    z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx
    w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz
  }

  /// slerp(qb, t): shortest arc; near-parallel (dot >= 0.9995) falls back to normalized lerp
  public mutating func slerp(_ qb: Quat, _ t: Double) {
    var t = t
    var x = qb.x, y = qb.y, z = qb.z, w = qb.w
    var dot = self.dot(qb)
    if dot < 0 {
      x = -x
      y = -y
      z = -z
      w = -w
      dot = -dot
    }
    var s = 1 - t
    if dot < 0.9995 {
      let theta = JS.acos(dot)
      let sin = JS.sin(theta)
      s = JS.sin(s * theta) / sin
      t = JS.sin(t * theta) / sin
      self.x = self.x * s + x * t
      self.y = self.y * s + y * t
      self.z = self.z * s + z * t
      self.w = self.w * s + w * t
    } else {
      self.x = self.x * s + x * t
      self.y = self.y * s + y * t
      self.z = self.z * s + z * t
      self.w = self.w * s + w * t
      normalize()
    }
  }

  /// slerpQuaternions(qa, qb, t) = copy(qa).slerp(qb, t)
  public mutating func slerpQuaternions(_ qa: Quat, _ qb: Quat, _ t: Double) {
    self = qa
    slerp(qb, t)
  }

  /// equals(q): strict === per component
  @inline(__always) public func equals(_ q: Quat) -> Bool { q.x == x && q.y == y && q.z == z && q.w == w }
}
