// ThreeMatrix — the few three.js r185 Matrix4 / Quaternion / Object3D steps the renderer reproduces on
// the CPU in Double with three's exact operation order (transcribed from the vendored three.core.min.js):
// Matrix4.lookAt, multiplyMatrices, invert, compose, makeOrthographic, Quaternion.setFromRotationMatrix,
// and the camera Object3D.lookAt → updateMatrixWorld round trip (rotation → quaternion → matrix).
// Used by the sun's shadow camera (LightShadow.updateMatrices, Lighting/ShadowCamera.swift); a test vector
// exported from the real three (Tests/Goldens/lighting/sunrig.json) checks it bit for bit.
// TODO(Core): when MaydayCore gains three's Matrix4/Quaternion (PLAN Appendix A, Math/Matrix4.swift),
// this file becomes a thin adapter.
import Foundation
import MaydayCore

/// three Matrix4: 16 Doubles, column-major (elements[col · 4 + row]).
public struct ThreeMatrix4: Equatable {
  public var e: [Double]

  public init() { e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
  public init(elements: [Double]) {
    precondition(elements.count == 16, "ThreeMatrix4 needs 16 elements")
    e = elements
  }

  /// Matrix4.multiplyMatrices(a, b) → a · b.
  public static func multiply(_ a: ThreeMatrix4, _ b: ThreeMatrix4) -> ThreeMatrix4 {
    let s = a.e, i = b.e
    let n = s[0], a4 = s[4], o = s[8], h = s[12], l = s[1], c = s[5], u = s[9], d = s[13]
    let p = s[2], m = s[6], y = s[10], g = s[14], f = s[3], x = s[7], bb = s[11], v = s[15]
    let w = i[0], M = i[4], S = i[8], U = i[12], A = i[1], T = i[5], z = i[9], C = i[13]
    let I = i[2], B = i[6], k = i[10], O = i[14], P = i[3], R = i[7], E = i[11], N = i[15]
    var r = [Double](repeating: 0, count: 16)
    r[0] = n * w + a4 * A + o * I + h * P
    r[4] = n * M + a4 * T + o * B + h * R
    r[8] = n * S + a4 * z + o * k + h * E
    r[12] = n * U + a4 * C + o * O + h * N
    r[1] = l * w + c * A + u * I + d * P
    r[5] = l * M + c * T + u * B + d * R
    r[9] = l * S + c * z + u * k + d * E
    r[13] = l * U + c * C + u * O + d * N
    r[2] = p * w + m * A + y * I + g * P
    r[6] = p * M + m * T + y * B + g * R
    r[10] = p * S + m * z + y * k + g * E
    r[14] = p * U + m * C + y * O + g * N
    r[3] = f * w + x * A + bb * I + v * P
    r[7] = f * M + x * T + bb * B + v * R
    r[11] = f * S + x * z + bb * k + v * E
    r[15] = f * U + x * C + bb * O + v * N
    return ThreeMatrix4(elements: r)
  }

  /// Matrix4.invert() (all zeros when singular, like three).
  public func inverted() -> ThreeMatrix4 {
    let t = e
    let e0 = t[0], s = t[1], i = t[2], r = t[3], n = t[4], a = t[5], o = t[6], h = t[7]
    let l = t[8], c = t[9], u = t[10], d = t[11], p = t[12], m = t[13], y = t[14], g = t[15]
    let f = e0 * a - s * n, x = e0 * o - i * n, b = e0 * h - r * n, v = s * o - i * a, w = s * h - r * a, M = i * h - r * o
    let S = l * m - c * p, U = l * y - u * p, A = l * g - d * p, T = c * y - u * m, z = c * g - d * m, C = u * g - d * y
    let I = f * C - x * z + b * T + v * A - w * U + M * S
    if I == 0 { return ThreeMatrix4(elements: [Double](repeating: 0, count: 16)) }
    let B = 1 / I
    var o2 = [Double](repeating: 0, count: 16)
    o2[0] = (a * C - o * z + h * T) * B
    o2[1] = (i * z - s * C - r * T) * B
    o2[2] = (m * M - y * w + g * v) * B
    o2[3] = (u * w - c * M - d * v) * B
    o2[4] = (o * A - n * C - h * U) * B
    o2[5] = (e0 * C - i * A + r * U) * B
    o2[6] = (y * b - p * M - g * x) * B
    o2[7] = (l * M - u * b + d * x) * B
    o2[8] = (n * z - a * A + h * S) * B
    o2[9] = (s * A - e0 * z - r * S) * B
    o2[10] = (p * w - m * b + g * f) * B
    o2[11] = (c * b - l * w - d * f) * B
    o2[12] = (a * U - n * T - o * S) * B
    o2[13] = (e0 * T - s * U + i * S) * B
    o2[14] = (m * x - p * v - y * f) * B
    o2[15] = (l * v - c * x + u * f) * B
    return ThreeMatrix4(elements: o2)
  }

  /// Matrix4.makeOrthographic(left, right, top, bottom, near, far) — WebGLCoordinateSystem, no reversed depth.
  public static func orthographic(left t: Double, right e: Double, top s: Double, bottom i: Double,
                                  near r: Double, far n: Double) -> ThreeMatrix4 {
    let l = 2 / (e - t), c = 2 / (s - i), u = -(e + t) / (e - t), d = -(s + i) / (s - i)
    let p = -2 / (n - r), m = -(n + r) / (n - r)
    return ThreeMatrix4(elements: [l, 0, 0, 0, 0, c, 0, 0, 0, 0, p, 0, u, d, m, 1])
  }

  /// OrthographicCamera.updateProjectionMatrix() (zoom, no view offset).
  public static func orthographicCamera(left: Double, right: Double, top: Double, bottom: Double,
                                        near: Double, far: Double, zoom: Double = 1) -> ThreeMatrix4 {
    let t = (right - left) / (2 * zoom), e = (top - bottom) / (2 * zoom)
    let s = (right + left) / 2, i = (top + bottom) / 2
    return orthographic(left: s - t, right: s + t, top: i + e, bottom: i - e, near: near, far: far)
  }

  /// Matrix4.lookAt(eye, target, up): writes only the rotation part (into a copy of `self`).
  public func lookAt(eye: V3, target: V3, up: V3) -> ThreeMatrix4 {
    var z = V3(eye.x - target.x, eye.y - target.y, eye.z - target.z)
    if ThreeVec.lengthSq(z) == 0 { z.z = 1 }
    z = ThreeVec.normalize(z)
    var x = ThreeVec.cross(up, z)
    if ThreeVec.lengthSq(x) == 0 {
      if JS.abs(up.z) == 1 { z.x += 1e-4 } else { z.z += 1e-4 }
      z = ThreeVec.normalize(z)
      x = ThreeVec.cross(up, z)
    }
    x = ThreeVec.normalize(x)
    let y = ThreeVec.cross(z, x)
    var m = self
    m.e[0] = x.x; m.e[4] = y.x; m.e[8] = z.x
    m.e[1] = x.y; m.e[5] = y.y; m.e[9] = z.y
    m.e[2] = x.z; m.e[6] = y.z; m.e[10] = z.z
    return m
  }

  /// Matrix4.compose(position, quaternion, scale).
  public static func compose(position: V3, quaternion q: ThreeQuaternion, scale: V3 = V3(1, 1, 1)) -> ThreeMatrix4 {
    let r = q.x, n = q.y, a = q.z, o = q.w
    let h = r + r, l = n + n, c = a + a
    let u = r * h, d = r * l, p = r * c, m = n * l, y = n * c, g = a * c, f = o * h, x = o * l, b = o * c
    let v = scale.x, w = scale.y, M = scale.z
    return ThreeMatrix4(elements: [
      (1 - (m + g)) * v, (d + b) * v, (p - x) * v, 0,
      (d - b) * w, (1 - (u + g)) * w, (y + f) * w, 0,
      (p + x) * M, (y - f) * M, (1 - (u + m)) * M, 0,
      position.x, position.y, position.z, 1,
    ])
  }

  /// Matrix4 · (x, y, z, 1) — the homogeneous product (Vector4.applyMatrix4 order).
  public func apply(_ v: V3, w: Double = 1) -> (x: Double, y: Double, z: Double, w: Double) {
    let x = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12] * w
    let y = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13] * w
    let z = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14] * w
    let ww = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15] * w
    return (x, y, z, ww)
  }
}

/// three Quaternion (x, y, z, w).
public struct ThreeQuaternion: Equatable {
  public var x: Double = 0, y: Double = 0, z: Double = 0, w: Double = 1

  public init() {}
  public init(x: Double, y: Double, z: Double, w: Double) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  /// Quaternion.setFromRotationMatrix(m) (upper 3×3 of a pure rotation).
  public static func fromRotationMatrix(_ m: ThreeMatrix4) -> ThreeQuaternion {
    let t = m.e
    let s = t[0], i = t[4], r = t[8], n = t[1], a = t[5], o = t[9], h = t[2], l = t[6], c = t[10]
    let u = s + a + c
    var q = ThreeQuaternion()
    if u > 0 {
      let k = 0.5 / JS.sqrt(u + 1)
      q.w = 0.25 / k
      q.x = (l - o) * k
      q.y = (r - h) * k
      q.z = (n - i) * k
    } else if s > a && s > c {
      let k = 2 * JS.sqrt(1 + s - a - c)
      q.w = (l - o) / k
      q.x = 0.25 * k
      q.y = (i + n) / k
      q.z = (r + h) / k
    } else if a > c {
      let k = 2 * JS.sqrt(1 + a - s - c)
      q.w = (r - h) / k
      q.x = (i + n) / k
      q.y = 0.25 * k
      q.z = (o + l) / k
    } else {
      let k = 2 * JS.sqrt(1 + c - s - a)
      q.w = (n - i) / k
      q.x = (r + h) / k
      q.y = (o + l) / k
      q.z = 0.25 * k
    }
    return q
  }
}

/// three Vector3 steps in three's operation order (no fused multiply-add, length = √(x²+y²+z²)).
public enum ThreeVec {
  @inline(__always) public static func lengthSq(_ v: V3) -> Double { v.x * v.x + v.y * v.y + v.z * v.z }
  @inline(__always) public static func length(_ v: V3) -> Double { JS.sqrt(lengthSq(v)) }
  /// Vector3.normalize(): divideScalar(length() || 1) = multiplyScalar(1 / (length || 1)).
  @inline(__always) public static func normalize(_ v: V3) -> V3 {
    let len = length(v)
    let s = 1 / ((len == 0 || len.isNaN) ? 1 : len)
    return V3(v.x * s, v.y * s, v.z * s)
  }
  /// Vector3.crossVectors(a, b).
  @inline(__always) public static func cross(_ a: V3, _ b: V3) -> V3 {
    V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
  }
  @inline(__always) public static func dot(_ a: V3, _ b: V3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
}

/// An unparented three camera (PerspectiveCamera / OrthographicCamera / LightShadow.camera) after
/// position.copy(p); lookAt(target); updateMatrixWorld(): rotation → quaternion → compose, then
/// matrixWorldInverse = matrixWorld.invert() (Camera.updateMatrixWorld).
public struct ThreeCameraPose: Equatable {
  public var quaternion: ThreeQuaternion
  public var matrixWorld: ThreeMatrix4
  public var matrixWorldInverse: ThreeMatrix4

  public init(position: V3, target: V3, up: V3 = V3(0, 1, 0)) {
    // Object3D.lookAt: _position = matrixWorld translation = position (no parent); isCamera → lookAt(position, target, up)
    let rot = ThreeMatrix4().lookAt(eye: position, target: target, up: up)
    quaternion = ThreeQuaternion.fromRotationMatrix(rot)
    matrixWorld = ThreeMatrix4.compose(position: position, quaternion: quaternion)
    matrixWorldInverse = matrixWorld.inverted()
  }
}
