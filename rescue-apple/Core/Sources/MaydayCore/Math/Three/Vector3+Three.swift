// THREE.Vector3 (three.js r185 src/math/Vector3.js) on `V3`: the in-place API, statement for
// statement. See Vector2+Three.swift for the conventions (no chaining; divideScalar = * (1 / s);
// normalize by (length || 1); Math.min/max semantics). Vectors: Tests/Vectors/math/three_vector.json.

extension V3 {
  // ---- setters -------------------------------------------------------------------------------------
  @inline(__always) public mutating func setScalar(_ s: Double) {
    x = s
    y = s
    z = s
  }

  @inline(__always) public mutating func setX(_ v: Double) { x = v }
  @inline(__always) public mutating func setY(_ v: Double) { y = v }
  @inline(__always) public mutating func setZ(_ v: Double) { z = v }

  /// setComponent / getComponent (0 = x, 1 = y, 2 = z; other indices are ignored / read 0).
  public subscript(index: Int) -> Double {
    get { index == 0 ? x : (index == 1 ? y : (index == 2 ? z : 0)) }
    set {
      switch index {
      case 0: x = newValue
      case 1: y = newValue
      case 2: z = newValue
      default: break
      }
    }
  }

  /// fromArray(array, offset)
  public mutating func fromArray(_ a: [Double], _ offset: Int = 0) {
    x = a[offset]
    y = a[offset + 1]
    z = a[offset + 2]
  }

  /// toArray()
  public var array: [Double] { [x, y, z] }

  // ---- arithmetic ---------------------------------------------------------------------------------
  @inline(__always) public mutating func add(_ v: V3) {
    x += v.x
    y += v.y
    z += v.z
  }

  @inline(__always) public mutating func addScalar(_ s: Double) {
    x += s
    y += s
    z += s
  }

  @inline(__always) public mutating func addVectors(_ a: V3, _ b: V3) {
    x = a.x + b.x
    y = a.y + b.y
    z = a.z + b.z
  }

  /// addScaledVector(v, s): x += v.x * s   (same as `addScaled`)
  @inline(__always) public mutating func addScaledVector(_ v: V3, _ s: Double) { addScaled(v, s) }

  @inline(__always) public mutating func sub(_ v: V3) {
    x -= v.x
    y -= v.y
    z -= v.z
  }

  @inline(__always) public mutating func subScalar(_ s: Double) {
    x -= s
    y -= s
    z -= s
  }

  @inline(__always) public mutating func subVectors(_ a: V3, _ b: V3) {
    x = a.x - b.x
    y = a.y - b.y
    z = a.z - b.z
  }

  @inline(__always) public mutating func multiply(_ v: V3) {
    x *= v.x
    y *= v.y
    z *= v.z
  }

  @inline(__always) public mutating func multiplyScalar(_ s: Double) {
    x *= s
    y *= s
    z *= s
  }

  @inline(__always) public mutating func multiplyVectors(_ a: V3, _ b: V3) {
    x = a.x * b.x
    y = a.y * b.y
    z = a.z * b.z
  }

  @inline(__always) public mutating func divide(_ v: V3) {
    x /= v.x
    y /= v.y
    z /= v.z
  }

  /// divideScalar(s) = multiplyScalar(1 / s)
  @inline(__always) public mutating func divideScalar(_ s: Double) { multiplyScalar(1 / s) }

  @inline(__always) public mutating func min(_ v: V3) {
    x = JS.min(x, v.x)
    y = JS.min(y, v.y)
    z = JS.min(z, v.z)
  }

  @inline(__always) public mutating func max(_ v: V3) {
    x = JS.max(x, v.x)
    y = JS.max(y, v.y)
    z = JS.max(z, v.z)
  }

  @inline(__always) public mutating func clamp(_ lo: V3, _ hi: V3) {
    x = MathUtils.clamp(x, lo.x, hi.x)
    y = MathUtils.clamp(y, lo.y, hi.y)
    z = MathUtils.clamp(z, lo.z, hi.z)
  }

  @inline(__always) public mutating func clampScalar(_ lo: Double, _ hi: Double) {
    x = MathUtils.clamp(x, lo, hi)
    y = MathUtils.clamp(y, lo, hi)
    z = MathUtils.clamp(z, lo, hi)
  }

  /// clampLength(min, max) = divideScalar(length || 1).multiplyScalar(clamp(length, min, max))
  public mutating func clampLength(_ lo: Double, _ hi: Double) {
    let l = length
    divideScalar(JSNumber.isTruthy(l) ? l : 1)
    multiplyScalar(MathUtils.clamp(l, lo, hi))
  }

  public mutating func floor() {
    x = JS.floor(x)
    y = JS.floor(y)
    z = JS.floor(z)
  }

  public mutating func ceil() {
    x = JS.ceil(x)
    y = JS.ceil(y)
    z = JS.ceil(z)
  }

  public mutating func round() {
    x = JS.round(x)
    y = JS.round(y)
    z = JS.round(z)
  }

  public mutating func roundToZero() {
    x = JS.trunc(x)
    y = JS.trunc(y)
    z = JS.trunc(z)
  }

  @inline(__always) public mutating func negate() {
    x = -x
    y = -y
    z = -z
  }

  // ---- transforms ---------------------------------------------------------------------------------
  /// applyEuler(e) = applyQuaternion(q.setFromEuler(e))
  public mutating func applyEuler(_ e: Euler) {
    var q = Quat()
    q.setFromEuler(e)
    applyQuaternion(q)
  }

  /// applyAxisAngle(axis, angle) = applyQuaternion(q.setFromAxisAngle(axis, angle))
  public mutating func applyAxisAngle(_ axis: V3, _ angle: Double) {
    var q = Quat()
    q.setFromAxisAngle(axis, angle)
    applyQuaternion(q)
  }

  public mutating func applyMatrix3(_ m: Mat3) {
    let x = self.x, y = self.y, z = self.z
    self.x = m[0] * x + m[3] * y + m[6] * z
    self.y = m[1] * x + m[4] * y + m[7] * z
    self.z = m[2] * x + m[5] * y + m[8] * z
  }

  /// applyNormalMatrix(m) = applyMatrix3(m).normalize()
  public mutating func applyNormalMatrix(_ m: Mat3) {
    applyMatrix3(m)
    normalize()
  }

  /// applyMatrix4(m): projective (divides by w = 1 / (e3 x + e7 y + e11 z + e15))
  public mutating func applyMatrix4(_ m: Mat4) {
    let x = self.x, y = self.y, z = self.z
    let w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15])
    self.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w
    self.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w
    self.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w
  }

  /// applyQuaternion(q): v + 2w (q × v) + 2 q × (q × v), three's expanded form
  public mutating func applyQuaternion(_ q: Quat) {
    let vx = x, vy = y, vz = z
    let qx = q.x, qy = q.y, qz = q.z, qw = q.w
    let tx = 2 * (qy * vz - qz * vy)
    let ty = 2 * (qz * vx - qx * vz)
    let tz = 2 * (qx * vy - qy * vx)
    x = vx + qw * tx + qy * tz - qz * ty
    y = vy + qw * ty + qz * tx - qx * tz
    z = vz + qw * tz + qx * ty - qy * tx
  }

  /// project(camera) = applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  public mutating func project(matrixWorldInverse: Mat4, projectionMatrix: Mat4) {
    applyMatrix4(matrixWorldInverse)
    applyMatrix4(projectionMatrix)
  }

  /// unproject(camera) = applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld)
  public mutating func unproject(projectionMatrixInverse: Mat4, matrixWorld: Mat4) {
    applyMatrix4(projectionMatrixInverse)
    applyMatrix4(matrixWorld)
  }

  /// transformDirection(m): upper 3×3 of m, then normalize()
  public mutating func transformDirection(_ m: Mat4) {
    let x = self.x, y = self.y, z = self.z
    self.x = m[0] * x + m[4] * y + m[8] * z
    self.y = m[1] * x + m[5] * y + m[9] * z
    self.z = m[2] * x + m[6] * y + m[10] * z
    normalize()
  }

  // ---- products & measures ------------------------------------------------------------------------
  /// cross(v) = crossVectors(this, v)
  @inline(__always) public mutating func cross(_ v: V3) { crossVectors(self, v) }

  /// crossVectors(a, b)
  @inline(__always) public mutating func crossVectors(_ a: V3, _ b: V3) {
    let ax = a.x, ay = a.y, az = a.z
    let bx = b.x, by = b.y, bz = b.z
    x = ay * bz - az * by
    y = az * bx - ax * bz
    z = ax * by - ay * bx
  }

  @inline(__always) public var manhattanLength: Double { JS.abs(x) + JS.abs(y) + JS.abs(z) }

  /// normalize() = divideScalar(length() || 1)
  @inline(__always) public mutating func normalize() {
    let l = length
    divideScalar(JSNumber.isTruthy(l) ? l : 1)
  }

  /// setLength(l) = normalize().multiplyScalar(l)
  public mutating func setLength(_ l: Double) {
    normalize()
    multiplyScalar(l)
  }

  /// lerp(v, alpha): x += (v.x - x) * alpha
  @inline(__always) public mutating func lerp(_ v: V3, _ alpha: Double) {
    x += (v.x - x) * alpha
    y += (v.y - y) * alpha
    z += (v.z - z) * alpha
  }

  /// lerpVectors(v1, v2, alpha): x = v1.x + (v2.x - v1.x) * alpha
  @inline(__always) public mutating func lerpVectors(_ v1: V3, _ v2: V3, _ alpha: Double) {
    x = v1.x + (v2.x - v1.x) * alpha
    y = v1.y + (v2.y - v1.y) * alpha
    z = v1.z + (v2.z - v1.z) * alpha
  }

  /// projectOnVector(v): (v · this / |v|²) v; zero when v is zero
  public mutating func projectOnVector(_ v: V3) {
    let denominator = v.lengthSq
    if denominator == 0 {
      set(0, 0, 0)
      return
    }
    let scalar = v.dot(self) / denominator
    self = v
    multiplyScalar(scalar)
  }

  /// projectOnPlane(n) = this - projectOnVector(this, n)
  public mutating func projectOnPlane(_ planeNormal: V3) {
    var p = self
    p.projectOnVector(planeNormal)
    sub(p)
  }

  /// reflect(normal) = this - normal * (2 * this · normal)
  public mutating func reflect(_ normal: V3) {
    var n = normal
    n.multiplyScalar(2 * dot(normal))
    sub(n)
  }

  /// angleTo(v) = acos(clamp(dot / sqrt(lengthSq * v.lengthSq), -1, 1)); π/2 when either is zero
  public func angleTo(_ v: V3) -> Double {
    let denominator = (lengthSq * v.lengthSq).squareRoot()
    if denominator == 0 { return JS.PI / 2 }
    let theta = dot(v) / denominator
    return JS.acos(MathUtils.clamp(theta, -1, 1))
  }

  @inline(__always) public func distanceTo(_ v: V3) -> Double { distanceToSquared(v).squareRoot() }

  @inline(__always) public func distanceToSquared(_ v: V3) -> Double {
    let dx = x - v.x, dy = y - v.y, dz = z - v.z
    return dx * dx + dy * dy + dz * dz
  }

  @inline(__always) public func manhattanDistanceTo(_ v: V3) -> Double {
    JS.abs(x - v.x) + JS.abs(y - v.y) + JS.abs(z - v.z)
  }

  /// equals(v): strict === per component
  @inline(__always) public func equals(_ v: V3) -> Bool { v.x == x && v.y == y && v.z == z }

  // ---- setFrom* -----------------------------------------------------------------------------------
  /// setFromSphericalCoords(radius, phi, theta)
  public mutating func setFromSphericalCoords(_ radius: Double, _ phi: Double, _ theta: Double) {
    let sinPhiRadius = JS.sin(phi) * radius
    x = sinPhiRadius * JS.sin(theta)
    y = JS.cos(phi) * radius
    z = sinPhiRadius * JS.cos(theta)
  }

  /// setFromCylindricalCoords(radius, theta, y)
  public mutating func setFromCylindricalCoords(_ radius: Double, _ theta: Double, _ y: Double) {
    x = radius * JS.sin(theta)
    self.y = y
    z = radius * JS.cos(theta)
  }

  /// setFromMatrixPosition(m) = (e12, e13, e14)
  public mutating func setFromMatrixPosition(_ m: Mat4) {
    x = m[12]
    y = m[13]
    z = m[14]
  }

  /// setFromMatrixColumn(m, index) = fromArray(m.elements, index * 4)
  public mutating func setFromMatrixColumn(_ m: Mat4, _ index: Int) {
    x = m[index * 4]
    y = m[index * 4 + 1]
    z = m[index * 4 + 2]
  }

  /// setFromMatrix3Column(m, index) = fromArray(m.elements, index * 3)
  public mutating func setFromMatrix3Column(_ m: Mat3, _ index: Int) {
    x = m[index * 3]
    y = m[index * 3 + 1]
    z = m[index * 3 + 2]
  }

  /// setFromMatrixScale(m): lengths of the three basis columns
  public mutating func setFromMatrixScale(_ m: Mat4) {
    var c = V3()
    c.setFromMatrixColumn(m, 0)
    let sx = c.length
    c.setFromMatrixColumn(m, 1)
    let sy = c.length
    c.setFromMatrixColumn(m, 2)
    let sz = c.length
    set(sx, sy, sz)
  }

  /// setFromEuler(e) = (e.x, e.y, e.z)
  public mutating func setFromEuler(_ e: Euler) { set(e.x, e.y, e.z) }

  /// setFromColor(c) = (c.r, c.g, c.b)
  public mutating func setFromColor(_ c: Color3) { set(c.r, c.g, c.b) }
}
