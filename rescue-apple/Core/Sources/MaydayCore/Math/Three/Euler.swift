// THREE.Euler (three.js r185 src/math/Euler.js) as a value type. The game uses the orders XYZ
// (default), YXZ (camera / heli yaw-pitch), YZX and ZXY; all six Tait–Bryan orders are ported.
// Vectors: Tests/Vectors/math/three_euler.json.

/// Euler.order. Raw values are three's strings (serialised Euler = [x, y, z, order]).
public enum EulerOrder: String, CaseIterable, Sendable {
  case XYZ, YXZ, ZXY, ZYX, YZX, XZY

  /// Euler.DEFAULT_ORDER
  public static let defaultOrder: EulerOrder = .XYZ
}

public struct Euler: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var order: EulerOrder

  /// new Euler(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER)
  @inline(__always) public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0, _ order: EulerOrder = .defaultOrder) {
    self.x = x
    self.y = y
    self.z = z
    self.order = order
  }

  /// set(x, y, z, order = this.order)
  @inline(__always) public mutating func set(_ x: Double, _ y: Double, _ z: Double, _ order: EulerOrder? = nil) {
    self.x = x
    self.y = y
    self.z = z
    if let o = order { self.order = o }
  }

  /// setFromRotationMatrix(m, order = this.order): upper 3×3 must be unscaled. Near gimbal lock
  /// (|sin| >= 0.9999999) the third angle is set to 0, exactly like three.
  public mutating func setFromRotationMatrix(_ m: Mat4, _ order: EulerOrder? = nil) {
    let order = order ?? self.order
    let m11 = m[0], m12 = m[4], m13 = m[8]
    let m21 = m[1], m22 = m[5], m23 = m[9]
    let m31 = m[2], m32 = m[6], m33 = m[10]
    switch order {
    case .XYZ:
      y = JS.asin(MathUtils.clamp(m13, -1, 1))
      if JS.abs(m13) < 0.9999999 {
        x = JS.atan2(-m23, m33)
        z = JS.atan2(-m12, m11)
      } else {
        x = JS.atan2(m32, m22)
        z = 0
      }
    case .YXZ:
      x = JS.asin(-MathUtils.clamp(m23, -1, 1))
      if JS.abs(m23) < 0.9999999 {
        y = JS.atan2(m13, m33)
        z = JS.atan2(m21, m22)
      } else {
        y = JS.atan2(-m31, m11)
        z = 0
      }
    case .ZXY:
      x = JS.asin(MathUtils.clamp(m32, -1, 1))
      if JS.abs(m32) < 0.9999999 {
        y = JS.atan2(-m31, m33)
        z = JS.atan2(-m12, m22)
      } else {
        y = 0
        z = JS.atan2(m21, m11)
      }
    case .ZYX:
      y = JS.asin(-MathUtils.clamp(m31, -1, 1))
      if JS.abs(m31) < 0.9999999 {
        x = JS.atan2(m32, m33)
        z = JS.atan2(m21, m11)
      } else {
        x = 0
        z = JS.atan2(-m12, m22)
      }
    case .YZX:
      z = JS.asin(MathUtils.clamp(m21, -1, 1))
      if JS.abs(m21) < 0.9999999 {
        x = JS.atan2(-m23, m22)
        y = JS.atan2(-m31, m11)
      } else {
        x = 0
        y = JS.atan2(m13, m33)
      }
    case .XZY:
      z = JS.asin(-MathUtils.clamp(m12, -1, 1))
      if JS.abs(m12) < 0.9999999 {
        x = JS.atan2(m32, m22)
        y = JS.atan2(m13, m11)
      } else {
        x = JS.atan2(-m23, m33)
        y = 0
      }
    }
    self.order = order
  }

  /// setFromQuaternion(q, order) = setFromRotationMatrix(makeRotationFromQuaternion(q), order)
  public mutating func setFromQuaternion(_ q: Quat, _ order: EulerOrder? = nil) {
    var m = Mat4()
    m.makeRotationFromQuaternion(q)
    setFromRotationMatrix(m, order)
  }

  /// setFromVector3(v, order = this.order)
  public mutating func setFromVector3(_ v: V3, _ order: EulerOrder? = nil) { set(v.x, v.y, v.z, order) }

  /// reorder(newOrder) = setFromQuaternion(q.setFromEuler(this), newOrder)
  public mutating func reorder(_ newOrder: EulerOrder) {
    var q = Quat()
    q.setFromEuler(self)
    setFromQuaternion(q, newOrder)
  }

  /// equals(e): strict === on the angles and the same order
  @inline(__always) public func equals(_ e: Euler) -> Bool { e.x == x && e.y == y && e.z == z && e.order == order }
}
