// THREE.Vector2 (three.js r185 src/math/Vector2.js) on `V2`: the in-place API the ported code
// relies on, statement for statement. three mutates `this` and returns it for chaining; Swift
// value types cannot chain mutating calls, so a JS chain `v.sub(a).normalize()` is written as two
// statements `v.sub(a); v.normalize()` (same operations, same order, same rounding).
//
// Notes that matter for parity:
//   * divideScalar(s) is multiplyScalar(1 / s): x * (1 / s), NOT x / s;
//   * normalize() divides by (length() || 1): a zero or NaN length leaves the vector unchanged;
//   * min/max/clamp use Math.min/Math.max semantics (NaN propagates, -0 < +0).
// Vectors: Tests/Vectors/math/three_vector.json.

extension V2 {
  // ---- setters -------------------------------------------------------------------------------------
  @inline(__always) public mutating func setScalar(_ s: Double) {
    x = s
    y = s
  }

  @inline(__always) public mutating func setX(_ v: Double) { x = v }
  @inline(__always) public mutating func setY(_ v: Double) { y = v }

  /// setComponent / getComponent (index 0 = x, 1 = y; other indices are ignored / read 0 —
  /// three throws, ported code never passes them).
  public subscript(index: Int) -> Double {
    get { index == 0 ? x : (index == 1 ? y : 0) }
    set {
      if index == 0 { x = newValue } else if index == 1 { y = newValue }
    }
  }

  /// fromArray(array, offset)
  public mutating func fromArray(_ a: [Double], _ offset: Int = 0) {
    x = a[offset]
    y = a[offset + 1]
  }

  /// toArray()
  public var array: [Double] { [x, y] }

  // ---- arithmetic ---------------------------------------------------------------------------------
  @inline(__always) public mutating func add(_ v: V2) {
    x += v.x
    y += v.y
  }

  @inline(__always) public mutating func addScalar(_ s: Double) {
    x += s
    y += s
  }

  @inline(__always) public mutating func addVectors(_ a: V2, _ b: V2) {
    x = a.x + b.x
    y = a.y + b.y
  }

  /// addScaledVector(v, s): x += v.x * s   (same as `addScaled`)
  @inline(__always) public mutating func addScaledVector(_ v: V2, _ s: Double) { addScaled(v, s) }

  @inline(__always) public mutating func sub(_ v: V2) {
    x -= v.x
    y -= v.y
  }

  @inline(__always) public mutating func subScalar(_ s: Double) {
    x -= s
    y -= s
  }

  @inline(__always) public mutating func subVectors(_ a: V2, _ b: V2) {
    x = a.x - b.x
    y = a.y - b.y
  }

  @inline(__always) public mutating func multiply(_ v: V2) {
    x *= v.x
    y *= v.y
  }

  @inline(__always) public mutating func multiplyScalar(_ s: Double) {
    x *= s
    y *= s
  }

  @inline(__always) public mutating func divide(_ v: V2) {
    x /= v.x
    y /= v.y
  }

  /// divideScalar(s) = multiplyScalar(1 / s)
  @inline(__always) public mutating func divideScalar(_ s: Double) { multiplyScalar(1 / s) }

  /// applyMatrix3(m): x = e0 x + e3 y + e6; y = e1 x + e4 y + e7
  public mutating func applyMatrix3(_ m: Mat3) {
    let x = self.x, y = self.y
    self.x = m[0] * x + m[3] * y + m[6]
    self.y = m[1] * x + m[4] * y + m[7]
  }

  @inline(__always) public mutating func min(_ v: V2) {
    x = JS.min(x, v.x)
    y = JS.min(y, v.y)
  }

  @inline(__always) public mutating func max(_ v: V2) {
    x = JS.max(x, v.x)
    y = JS.max(y, v.y)
  }

  @inline(__always) public mutating func clamp(_ lo: V2, _ hi: V2) {
    x = MathUtils.clamp(x, lo.x, hi.x)
    y = MathUtils.clamp(y, lo.y, hi.y)
  }

  @inline(__always) public mutating func clampScalar(_ lo: Double, _ hi: Double) {
    x = MathUtils.clamp(x, lo, hi)
    y = MathUtils.clamp(y, lo, hi)
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
  }

  public mutating func ceil() {
    x = JS.ceil(x)
    y = JS.ceil(y)
  }

  public mutating func round() {
    x = JS.round(x)
    y = JS.round(y)
  }

  public mutating func roundToZero() {
    x = JS.trunc(x)
    y = JS.trunc(y)
  }

  @inline(__always) public mutating func negate() {
    x = -x
    y = -y
  }

  // ---- measures -----------------------------------------------------------------------------------
  /// cross(v) = x * v.y - y * v.x  (the z of the 3D cross product)
  @inline(__always) public func cross(_ v: V2) -> Double { x * v.y - y * v.x }

  @inline(__always) public var manhattanLength: Double { JS.abs(x) + JS.abs(y) }

  /// normalize() = divideScalar(length() || 1)
  @inline(__always) public mutating func normalize() {
    let l = length
    divideScalar(JSNumber.isTruthy(l) ? l : 1)
  }

  /// angle() = Math.atan2(-y, -x) + Math.PI   (0…2π, counter-clockwise from +x)
  @inline(__always) public var angle: Double { JS.atan2(-y, -x) + JS.PI }

  /// angleTo(v) = acos(clamp(dot / sqrt(lengthSq * v.lengthSq), -1, 1)); π/2 when either is zero
  public func angleTo(_ v: V2) -> Double {
    let denominator = (lengthSq * v.lengthSq).squareRoot()
    if denominator == 0 { return JS.PI / 2 }
    let theta = dot(v) / denominator
    return JS.acos(MathUtils.clamp(theta, -1, 1))
  }

  @inline(__always) public func distanceTo(_ v: V2) -> Double { distanceToSquared(v).squareRoot() }

  @inline(__always) public func distanceToSquared(_ v: V2) -> Double {
    let dx = x - v.x, dy = y - v.y
    return dx * dx + dy * dy
  }

  @inline(__always) public func manhattanDistanceTo(_ v: V2) -> Double { JS.abs(x - v.x) + JS.abs(y - v.y) }

  /// setLength(l) = normalize().multiplyScalar(l)
  public mutating func setLength(_ l: Double) {
    normalize()
    multiplyScalar(l)
  }

  /// lerp(v, alpha): x += (v.x - x) * alpha
  @inline(__always) public mutating func lerp(_ v: V2, _ alpha: Double) {
    x += (v.x - x) * alpha
    y += (v.y - y) * alpha
  }

  /// lerpVectors(v1, v2, alpha): x = v1.x + (v2.x - v1.x) * alpha
  @inline(__always) public mutating func lerpVectors(_ v1: V2, _ v2: V2, _ alpha: Double) {
    x = v1.x + (v2.x - v1.x) * alpha
    y = v1.y + (v2.y - v1.y) * alpha
  }

  /// equals(v): strict === on both components (NaN never equal, -0 equals +0)
  @inline(__always) public func equals(_ v: V2) -> Bool { v.x == x && v.y == y }

  /// rotateAround(center, angle)
  public mutating func rotateAround(_ center: V2, _ angle: Double) {
    let c = JS.cos(angle), s = JS.sin(angle)
    let x = self.x - center.x
    let y = self.y - center.y
    self.x = x * c - y * s + center.x
    self.y = x * s + y * c + center.y
  }
}
