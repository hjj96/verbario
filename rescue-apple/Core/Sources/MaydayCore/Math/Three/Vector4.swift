// THREE.Vector4 (three.js r185 src/math/Vector4.js): the subset the game uses (uniform packing,
// applyMatrix4 for clip-space positions). Vectors: Tests/Vectors/math/three_vector.json.

public struct V4: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var w: Double

  /// new Vector4(x = 0, y = 0, z = 0, w = 1)
  @inline(__always) public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0, _ w: Double = 1) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  @inline(__always) public mutating func set(_ x: Double, _ y: Double, _ z: Double, _ w: Double) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  @inline(__always) public mutating func setScalar(_ s: Double) {
    x = s
    y = s
    z = s
    w = s
  }

  /// setComponent / getComponent (0…3; other indices are ignored / read 0).
  public subscript(index: Int) -> Double {
    get {
      switch index {
      case 0: return x
      case 1: return y
      case 2: return z
      case 3: return w
      default: return 0
      }
    }
    set {
      switch index {
      case 0: x = newValue
      case 1: y = newValue
      case 2: z = newValue
      case 3: w = newValue
      default: break
      }
    }
  }

  public var array: [Double] { [x, y, z, w] }

  @inline(__always) public mutating func add(_ v: V4) {
    x += v.x
    y += v.y
    z += v.z
    w += v.w
  }

  @inline(__always) public mutating func addScaledVector(_ v: V4, _ s: Double) {
    x += v.x * s
    y += v.y * s
    z += v.z * s
    w += v.w * s
  }

  @inline(__always) public mutating func sub(_ v: V4) {
    x -= v.x
    y -= v.y
    z -= v.z
    w -= v.w
  }

  @inline(__always) public mutating func multiplyScalar(_ s: Double) {
    x *= s
    y *= s
    z *= s
    w *= s
  }

  /// divideScalar(s) = multiplyScalar(1 / s)
  @inline(__always) public mutating func divideScalar(_ s: Double) { multiplyScalar(1 / s) }

  /// applyMatrix4(m): full 4×4 product (no perspective divide)
  public mutating func applyMatrix4(_ m: Mat4) {
    let x = self.x, y = self.y, z = self.z, w = self.w
    self.x = m[0] * x + m[4] * y + m[8] * z + m[12] * w
    self.y = m[1] * x + m[5] * y + m[9] * z + m[13] * w
    self.z = m[2] * x + m[6] * y + m[10] * z + m[14] * w
    self.w = m[3] * x + m[7] * y + m[11] * z + m[15] * w
  }

  @inline(__always) public func dot(_ v: V4) -> Double { x * v.x + y * v.y + z * v.z + w * v.w }
  @inline(__always) public var lengthSq: Double { x * x + y * y + z * z + w * w }
  @inline(__always) public var length: Double { (x * x + y * y + z * z + w * w).squareRoot() }

  /// normalize() = divideScalar(length() || 1)
  @inline(__always) public mutating func normalize() {
    let l = length
    divideScalar(JSNumber.isTruthy(l) ? l : 1)
  }

  /// lerp(v, alpha): x += (v.x - x) * alpha
  @inline(__always) public mutating func lerp(_ v: V4, _ alpha: Double) {
    x += (v.x - x) * alpha
    y += (v.y - y) * alpha
    z += (v.z - z) * alpha
    w += (v.w - w) * alpha
  }

  @inline(__always) public func equals(_ v: V4) -> Bool { v.x == x && v.y == y && v.z == z && v.w == w }
}
