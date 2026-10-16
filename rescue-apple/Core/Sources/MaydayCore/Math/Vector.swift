// Double-precision vectors with three.js operation order (THREE.Vector2/3). No SIMD sums, no
// `simd` module: every dot/length is written out so the rounding matches the JS exactly.

public struct V2: Equatable, Sendable {
  public var x: Double
  public var y: Double

  @inline(__always) public init(_ x: Double = 0, _ y: Double = 0) {
    self.x = x
    self.y = y
  }

  public static let zero = V2(0, 0)

  @inline(__always) public mutating func set(_ x: Double, _ y: Double) {
    self.x = x
    self.y = y
  }

  /// addScaledVector(v, s): x += v.x * s
  @inline(__always) public mutating func addScaled(_ v: V2, _ s: Double) {
    x += v.x * s
    y += v.y * s
  }

  @inline(__always) public static func + (a: V2, b: V2) -> V2 { V2(a.x + b.x, a.y + b.y) }
  @inline(__always) public static func - (a: V2, b: V2) -> V2 { V2(a.x - b.x, a.y - b.y) }
  @inline(__always) public static func * (a: V2, s: Double) -> V2 { V2(a.x * s, a.y * s) }

  /// three: x * v.x + y * v.y
  @inline(__always) public func dot(_ v: V2) -> Double { x * v.x + y * v.y }
  /// three: Math.sqrt(x * x + y * y)
  @inline(__always) public var length: Double { (x * x + y * y).squareRoot() }
  @inline(__always) public var lengthSq: Double { x * x + y * y }
}

public struct V3: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double

  @inline(__always) public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0) {
    self.x = x
    self.y = y
    self.z = z
  }

  public static let zero = V3(0, 0, 0)

  @inline(__always) public mutating func set(_ x: Double, _ y: Double, _ z: Double) {
    self.x = x
    self.y = y
    self.z = z
  }

  @inline(__always) public mutating func addScaled(_ v: V3, _ s: Double) {
    x += v.x * s
    y += v.y * s
    z += v.z * s
  }

  @inline(__always) public static func + (a: V3, b: V3) -> V3 { V3(a.x + b.x, a.y + b.y, a.z + b.z) }
  @inline(__always) public static func - (a: V3, b: V3) -> V3 { V3(a.x - b.x, a.y - b.y, a.z - b.z) }
  @inline(__always) public static func * (a: V3, s: Double) -> V3 { V3(a.x * s, a.y * s, a.z * s) }

  /// three: x * v.x + y * v.y + z * v.z
  @inline(__always) public func dot(_ v: V3) -> Double { x * v.x + y * v.y + z * v.z }
  /// three: Math.sqrt(x * x + y * y + z * z)
  @inline(__always) public var length: Double { (x * x + y * y + z * z).squareRoot() }
  @inline(__always) public var lengthSq: Double { x * x + y * y + z * z }

  /// three crossVectors(a, b)
  @inline(__always) public static func cross(_ a: V3, _ b: V3) -> V3 {
    V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
  }

  /// three normalize(): divideScalar(length() || 1) = multiplyScalar(1 / (length || 1))
  @inline(__always) public func normalized() -> V3 {
    let l = length
    let d = (l == 0 || l.isNaN) ? 1 : l
    return self * (1 / d)
  }
}
