// three.js r185 math (Math/Three/*.swift) vs the vendored three run in Node 22:
// Tests/Vectors/math/three_{utils,vector,quaternion,euler,matrix,color}.json (export-core.mjs).
// Each file holds `ops: {name: {in, out, rows: [[inputs…, outputs…]]}}`; every op in a file must have a
// Swift implementation here and vice versa, and every output must match bit for bit.
import XCTest
@testable import MaydayCore

final class ThreeMathTests: XCTestCase {
  typealias Op = ([Double]) -> [Double]

  // ---- input decoding (same layout as export-core.mjs) ---------------------------------------------
  private static let orders: [EulerOrder] = [.XYZ, .YXZ, .ZXY, .ZYX, .YZX, .XZY]
  private static let spaces: [ColorSpace] = [.none, .srgb, .linearSRGB]

  private func v2(_ a: [Double], _ o: Int = 0) -> V2 { V2(a[o], a[o + 1]) }
  private func v3(_ a: [Double], _ o: Int = 0) -> V3 { V3(a[o], a[o + 1], a[o + 2]) }
  private func v4(_ a: [Double], _ o: Int = 0) -> V4 { V4(a[o], a[o + 1], a[o + 2], a[o + 3]) }
  private func q(_ a: [Double], _ o: Int = 0) -> Quat { Quat(a[o], a[o + 1], a[o + 2], a[o + 3]) }
  private func e(_ a: [Double], _ o: Int = 0) -> Euler { Euler(a[o], a[o + 1], a[o + 2], Self.orders[Int(a[o + 3])]) }
  private func ord(_ x: Double) -> EulerOrder { Self.orders[Int(x)] }
  private func space(_ x: Double) -> ColorSpace { Self.spaces[Int(x)] }
  private func c(_ a: [Double], _ o: Int = 0) -> Color3 { Color3(a[o], a[o + 1], a[o + 2]) }
  private func m4(_ a: [Double], _ o: Int = 0) -> Mat4 {
    var m = Mat4()
    m.fromArray(a, o)
    return m
  }
  private func m3(_ a: [Double], _ o: Int = 0) -> Mat3 {
    var m = Mat3()
    m.fromArray(a, o)
    return m
  }
  private func b(_ x: Bool) -> [Double] { [x ? 1 : 0] }
  private func eo(_ x: Euler) -> [Double] { [x.x, x.y, x.z, Double(Self.orders.firstIndex(of: x.order) ?? -1)] }

  /// Mutate a copy and return its components.
  private func mut2(_ v: V2, _ f: (inout V2) -> Void) -> [Double] { var v = v; f(&v); return v.array }
  private func mut3(_ v: V3, _ f: (inout V3) -> Void) -> [Double] { var v = v; f(&v); return v.array }
  private func mut4(_ v: V4, _ f: (inout V4) -> Void) -> [Double] { var v = v; f(&v); return v.array }
  private func mutQ(_ v: Quat, _ f: (inout Quat) -> Void) -> [Double] { var v = v; f(&v); return v.array }
  private func mutM4(_ v: Mat4, _ f: (inout Mat4) -> Void) -> [Double] { var v = v; f(&v); return v.elements }
  private func mutM3(_ v: Mat3, _ f: (inout Mat3) -> Void) -> [Double] { var v = v; f(&v); return v.elements }
  private func mutC(_ v: Color3, _ f: (inout Color3) -> Void) -> [Double] { var v = v; f(&v); return v.array }

  // ---- runner --------------------------------------------------------------------------------------
  private func run(_ file: String, _ table: [String: Op], file f: StaticString = #filePath, line: UInt = #line) throws {
    let v = try VectorLoader.load(file)
    let ops = try v.data["ops"].requireObject("ops")
    var seen = Set<String>()
    var total = 0
    for (name, def) in ops.entries {
      seen.insert(name)
      guard let op = table[name] else {
        XCTFail("\(file): op \(name) has no Swift implementation in ThreeMathTests", file: f, line: line)
        continue
      }
      let nIn = try def["in"].requireInt("\(name).in")
      let rows = try def["rows"].requireArray("\(name).rows")
      var got = [Double](), want = [Double]()
      for (k, r) in rows.enumerated() {
        let d = try r.requireDoubles("\(name)[\(k)]")
        let out = op(Array(d[0..<nIn]))
        let exp = Array(d[nIn...])
        if out.count != exp.count {
          XCTFail("\(file) \(name)[\(k)]: \(out.count) outputs, expected \(exp.count)", file: f, line: line)
          continue
        }
        got += out
        want += exp
      }
      total += rows.count
      assertBitEqual(got, want, "\(file) \(name)", file: f, line: line)
    }
    for name in table.keys where !seen.contains(name) {
      XCTFail("\(file): Swift op \(name) is not in the vector file", file: f, line: line)
    }
    XCTAssertGreaterThan(total, 0, file: f, line: line)
  }

  // ---- MathUtils -----------------------------------------------------------------------------------
  func testMathUtils() throws {
    let M = MathUtils.self
    try run("math/three_utils", [
      "clamp": { a in [M.clamp(a[0], a[1], a[2])] },
      "euclideanModulo": { a in [M.euclideanModulo(a[0], a[1])] },
      "mapLinear": { a in [M.mapLinear(a[0], a[1], a[2], a[3], a[4])] },
      "inverseLerp": { a in [M.inverseLerp(a[0], a[1], a[2])] },
      "lerp": { a in [M.lerp(a[0], a[1], a[2])] },
      "damp": { a in [M.damp(a[0], a[1], a[2], a[3])] },
      "pingpong": { a in [M.pingpong(a[0], a[1])] },
      "smoothstep": { a in [M.smoothstep(a[0], a[1], a[2])] },
      "smootherstep": { a in [M.smootherstep(a[0], a[1], a[2])] },
      "degToRad": { a in [M.degToRad(a[0])] },
      "radToDeg": { a in [M.radToDeg(a[0])] },
      "isPowerOfTwo": { a in self.b(M.isPowerOfTwo(a[0])) },
      "ceilPowerOfTwo": { a in [M.ceilPowerOfTwo(a[0])] },
      "floorPowerOfTwo": { a in [M.floorPowerOfTwo(a[0])] },
    ])
  }

  // ---- Vector2 / Vector3 / Vector4 -----------------------------------------------------------------
  func testVectors() throws {
    try run("math/three_vector", [
      "v2.add": { a in self.mut2(self.v2(a)) { $0.add(self.v2(a, 2)) } },
      "v2.sub": { a in self.mut2(self.v2(a)) { $0.sub(self.v2(a, 2)) } },
      "v2.multiplyScalar": { a in self.mut2(self.v2(a)) { $0.multiplyScalar(a[2]) } },
      "v2.divideScalar": { a in self.mut2(self.v2(a)) { $0.divideScalar(a[2]) } },
      "v2.normalize": { a in self.mut2(self.v2(a)) { $0.normalize() } },
      "v2.length": { a in [self.v2(a).length] },
      "v2.lengthSq": { a in [self.v2(a).lengthSq] },
      "v2.manhattanLength": { a in [self.v2(a).manhattanLength] },
      "v2.dot": { a in [self.v2(a).dot(self.v2(a, 2))] },
      "v2.cross": { a in [self.v2(a).cross(self.v2(a, 2))] },
      "v2.angle": { a in [self.v2(a).angle] },
      "v2.angleTo": { a in [self.v2(a).angleTo(self.v2(a, 2))] },
      "v2.distanceTo": { a in [self.v2(a).distanceTo(self.v2(a, 2))] },
      "v2.lerp": { a in self.mut2(self.v2(a)) { $0.lerp(self.v2(a, 2), a[4]) } },
      "v2.lerpVectors": { a in self.mut2(V2()) { $0.lerpVectors(self.v2(a), self.v2(a, 2), a[4]) } },
      "v2.rotateAround": { a in self.mut2(self.v2(a)) { $0.rotateAround(self.v2(a, 2), a[4]) } },
      "v2.clampLength": { a in self.mut2(self.v2(a)) { $0.clampLength(a[2], a[3]) } },
      "v2.setLength": { a in self.mut2(self.v2(a)) { $0.setLength(a[2]) } },
      "v2.applyMatrix3": { a in self.mut2(self.v2(a)) { $0.applyMatrix3(self.m3(a, 2)) } },
      "v2.round": { a in self.mut2(self.v2(a)) { $0.round() } },
      "v2.floor": { a in self.mut2(self.v2(a)) { $0.floor() } },
      "v2.roundToZero": { a in self.mut2(self.v2(a)) { $0.roundToZero() } },
      "v3.add": { a in self.mut3(self.v3(a)) { $0.add(self.v3(a, 3)) } },
      "v3.addScalar": { a in self.mut3(self.v3(a)) { $0.addScalar(a[3]) } },
      "v3.addScaledVector": { a in self.mut3(self.v3(a)) { $0.addScaledVector(self.v3(a, 3), a[6]) } },
      "v3.sub": { a in self.mut3(self.v3(a)) { $0.sub(self.v3(a, 3)) } },
      "v3.multiply": { a in self.mut3(self.v3(a)) { $0.multiply(self.v3(a, 3)) } },
      "v3.multiplyScalar": { a in self.mut3(self.v3(a)) { $0.multiplyScalar(a[3]) } },
      "v3.divide": { a in self.mut3(self.v3(a)) { $0.divide(self.v3(a, 3)) } },
      "v3.divideScalar": { a in self.mut3(self.v3(a)) { $0.divideScalar(a[3]) } },
      "v3.min": { a in self.mut3(self.v3(a)) { $0.min(self.v3(a, 3)) } },
      "v3.max": { a in self.mut3(self.v3(a)) { $0.max(self.v3(a, 3)) } },
      "v3.clamp": { a in self.mut3(self.v3(a)) { $0.clamp(self.v3(a, 3), self.v3(a, 6)) } },
      "v3.clampScalar": { a in self.mut3(self.v3(a)) { $0.clampScalar(a[3], a[4]) } },
      "v3.clampLength": { a in self.mut3(self.v3(a)) { $0.clampLength(a[3], a[4]) } },
      "v3.floor": { a in self.mut3(self.v3(a)) { $0.floor() } },
      "v3.ceil": { a in self.mut3(self.v3(a)) { $0.ceil() } },
      "v3.round": { a in self.mut3(self.v3(a)) { $0.round() } },
      "v3.roundToZero": { a in self.mut3(self.v3(a)) { $0.roundToZero() } },
      "v3.negate": { a in self.mut3(self.v3(a)) { $0.negate() } },
      "v3.dot": { a in [self.v3(a).dot(self.v3(a, 3))] },
      "v3.length": { a in [self.v3(a).length] },
      "v3.lengthSq": { a in [self.v3(a).lengthSq] },
      "v3.manhattanLength": { a in [self.v3(a).manhattanLength] },
      "v3.normalize": { a in self.mut3(self.v3(a)) { $0.normalize() } },
      "v3.setLength": { a in self.mut3(self.v3(a)) { $0.setLength(a[3]) } },
      "v3.lerp": { a in self.mut3(self.v3(a)) { $0.lerp(self.v3(a, 3), a[6]) } },
      "v3.lerpVectors": { a in self.mut3(V3()) { $0.lerpVectors(self.v3(a), self.v3(a, 3), a[6]) } },
      "v3.cross": { a in self.mut3(self.v3(a)) { $0.cross(self.v3(a, 3)) } },
      "v3.crossVectors": { a in self.mut3(V3()) { $0.crossVectors(self.v3(a), self.v3(a, 3)) } },
      "v3.projectOnVector": { a in self.mut3(self.v3(a)) { $0.projectOnVector(self.v3(a, 3)) } },
      "v3.projectOnPlane": { a in self.mut3(self.v3(a)) { $0.projectOnPlane(self.v3(a, 3)) } },
      "v3.reflect": { a in self.mut3(self.v3(a)) { $0.reflect(self.v3(a, 3)) } },
      "v3.angleTo": { a in [self.v3(a).angleTo(self.v3(a, 3))] },
      "v3.distanceTo": { a in [self.v3(a).distanceTo(self.v3(a, 3))] },
      "v3.distanceToSquared": { a in [self.v3(a).distanceToSquared(self.v3(a, 3))] },
      "v3.manhattanDistanceTo": { a in [self.v3(a).manhattanDistanceTo(self.v3(a, 3))] },
      "v3.equals": { a in self.b(self.v3(a).equals(self.v3(a, 3))) },
      "v3.applyQuaternion": { a in self.mut3(self.v3(a)) { $0.applyQuaternion(self.q(a, 3)) } },
      "v3.applyAxisAngle": { a in self.mut3(self.v3(a)) { $0.applyAxisAngle(self.v3(a, 3), a[6]) } },
      "v3.applyEuler": { a in self.mut3(self.v3(a)) { $0.applyEuler(self.e(a, 3)) } },
      "v3.applyMatrix3": { a in self.mut3(self.v3(a)) { $0.applyMatrix3(self.m3(a, 3)) } },
      "v3.applyNormalMatrix": { a in self.mut3(self.v3(a)) { $0.applyNormalMatrix(self.m3(a, 3)) } },
      "v3.applyMatrix4": { a in self.mut3(self.v3(a)) { $0.applyMatrix4(self.m4(a, 3)) } },
      "v3.transformDirection": { a in self.mut3(self.v3(a)) { $0.transformDirection(self.m4(a, 3)) } },
      "v3.setFromSphericalCoords": { a in self.mut3(V3()) { $0.setFromSphericalCoords(a[0], a[1], a[2]) } },
      "v3.setFromCylindricalCoords": { a in self.mut3(V3()) { $0.setFromCylindricalCoords(a[0], a[1], a[2]) } },
      "v3.setFromMatrixScale": { a in self.mut3(V3()) { $0.setFromMatrixScale(self.m4(a)) } },
      "v3.setFromMatrixPosition": { a in self.mut3(V3()) { $0.setFromMatrixPosition(self.m4(a)) } },
      "v3.setFromMatrixColumn": { a in self.mut3(V3()) { $0.setFromMatrixColumn(self.m4(a), Int(a[16])) } },
      "v4.applyMatrix4": { a in self.mut4(self.v4(a)) { $0.applyMatrix4(self.m4(a, 4)) } },
      "v4.normalize": { a in self.mut4(self.v4(a)) { $0.normalize() } },
      "v4.length": { a in [self.v4(a).length] },
      "v4.dot": { a in [self.v4(a).dot(self.v4(a, 4))] },
      "v4.lerp": { a in self.mut4(self.v4(a)) { $0.lerp(self.v4(a, 4), a[8]) } },
      "v4.divideScalar": { a in self.mut4(self.v4(a)) { $0.divideScalar(a[4]) } },
      "v4.addScaledVector": { a in self.mut4(self.v4(a)) { $0.addScaledVector(self.v4(a, 4), a[8]) } },
    ])
  }

  // ---- Quaternion ----------------------------------------------------------------------------------
  func testQuaternion() throws {
    try run("math/three_quaternion", [
      "setFromEuler": { a in self.mutQ(Quat()) { $0.setFromEuler(self.e(a)) } },
      "setFromAxisAngle": { a in self.mutQ(Quat()) { $0.setFromAxisAngle(self.v3(a), a[3]) } },
      "setFromRotationMatrix": { a in self.mutQ(Quat()) { $0.setFromRotationMatrix(self.m4(a)) } },
      "setFromUnitVectors": { a in self.mutQ(Quat()) { $0.setFromUnitVectors(self.v3(a), self.v3(a, 3)) } },
      "angleTo": { a in [self.q(a).angleTo(self.q(a, 4))] },
      "rotateTowards": { a in self.mutQ(self.q(a)) { $0.rotateTowards(self.q(a, 4), a[8]) } },
      "invert": { a in self.mutQ(self.q(a)) { $0.invert() } },
      "dot": { a in [self.q(a).dot(self.q(a, 4))] },
      "length": { a in [self.q(a).length] },
      "lengthSq": { a in [self.q(a).lengthSq] },
      "normalize": { a in self.mutQ(self.q(a)) { $0.normalize() } },
      "multiply": { a in self.mutQ(self.q(a)) { $0.multiply(self.q(a, 4)) } },
      "premultiply": { a in self.mutQ(self.q(a)) { $0.premultiply(self.q(a, 4)) } },
      "slerp": { a in self.mutQ(self.q(a)) { $0.slerp(self.q(a, 4), a[8]) } },
      "slerpQuaternions": { a in self.mutQ(Quat()) { $0.slerpQuaternions(self.q(a), self.q(a, 4), a[8]) } },
    ])
  }

  // ---- Euler -----------------------------------------------------------------------------------------
  func testEuler() throws {
    try run("math/three_euler", [
      "setFromRotationMatrix": { a in
        var x = Euler()
        x.setFromRotationMatrix(self.m4(a), self.ord(a[16]))
        return self.eo(x)
      },
      "setFromQuaternion": { a in
        var x = Euler()
        x.setFromQuaternion(self.q(a), self.ord(a[4]))
        return self.eo(x)
      },
      "reorder": { a in
        var x = self.e(a)
        x.reorder(self.ord(a[4]))
        return self.eo(x)
      },
      "makeRotationFromEuler": { a in self.mutM4(Mat4()) { $0.makeRotationFromEuler(self.e(a)) } },
    ])
  }

  // ---- Matrix3 / Matrix4 ---------------------------------------------------------------------------
  func testMatrices() throws {
    try run("math/three_matrix", [
      "m4.multiply": { a in self.mutM4(self.m4(a)) { $0.multiply(self.m4(a, 16)) } },
      "m4.premultiply": { a in self.mutM4(self.m4(a)) { $0.premultiply(self.m4(a, 16)) } },
      "m4.multiplyScalar": { a in self.mutM4(self.m4(a)) { $0.multiplyScalar(a[16]) } },
      "m4.determinant": { a in [self.m4(a).determinant()] },
      "m4.determinantAffine": { a in [self.m4(a).determinantAffine()] },
      "m4.transpose": { a in self.mutM4(self.m4(a)) { $0.transpose() } },
      "m4.invert": { a in self.mutM4(self.m4(a)) { $0.invert() } },
      "m4.scale": { a in self.mutM4(self.m4(a)) { $0.scale(self.v3(a, 16)) } },
      "m4.getMaxScaleOnAxis": { a in [self.m4(a).getMaxScaleOnAxis()] },
      "m4.makeTranslation": { a in self.mutM4(Mat4()) { $0.makeTranslation(a[0], a[1], a[2]) } },
      "m4.makeRotationX": { a in self.mutM4(Mat4()) { $0.makeRotationX(a[0]) } },
      "m4.makeRotationY": { a in self.mutM4(Mat4()) { $0.makeRotationY(a[0]) } },
      "m4.makeRotationZ": { a in self.mutM4(Mat4()) { $0.makeRotationZ(a[0]) } },
      "m4.makeRotationAxis": { a in self.mutM4(Mat4()) { $0.makeRotationAxis(self.v3(a), a[3]) } },
      "m4.makeScale": { a in self.mutM4(Mat4()) { $0.makeScale(a[0], a[1], a[2]) } },
      "m4.makeShear": { a in self.mutM4(Mat4()) { $0.makeShear(a[0], a[1], a[2], a[3], a[4], a[5]) } },
      "m4.makeBasis": { a in self.mutM4(Mat4()) { $0.makeBasis(self.v3(a), self.v3(a, 3), self.v3(a, 6)) } },
      "m4.extractBasis": { a in
        let b = self.m4(a).extractBasis()
        return b.x.array + b.y.array + b.z.array
      },
      "m4.extractRotation": { a in self.mutM4(Mat4()) { $0.extractRotation(self.m4(a)) } },
      "m4.setPosition": { a in self.mutM4(self.m4(a)) { $0.setPosition(a[16], a[17], a[18]) } },
      "m4.copyPosition": { a in self.mutM4(self.m4(a)) { $0.copyPosition(self.m4(a, 16)) } },
      "m4.setFromMatrix3": { a in self.mutM4(Mat4()) { $0.setFromMatrix3(self.m3(a)) } },
      "m4.compose": { a in self.mutM4(Mat4()) { $0.compose(self.v3(a), self.q(a, 3), self.v3(a, 7)) } },
      "m4.decompose": { a in
        let d = self.m4(a).decompose()
        return d.position.array + d.quaternion.array + d.scale.array
      },
      "m4.makeRotationFromQuaternion": { a in self.mutM4(Mat4()) { $0.makeRotationFromQuaternion(self.q(a)) } },
      "m4.lookAt": { a in self.mutM4(self.m4(a)) { $0.lookAt(self.v3(a, 16), self.v3(a, 19), self.v3(a, 22)) } },
      "m4.makePerspective": { a in
        self.mutM4(Mat4()) {
          $0.makePerspective(a[0], a[1], a[2], a[3], a[4], a[5], a[6] != 0 ? .webGPU : .webGL, reversedDepth: a[7] != 0)
        }
      },
      "m4.makeOrthographic": { a in
        self.mutM4(Mat4()) {
          $0.makeOrthographic(a[0], a[1], a[2], a[3], a[4], a[5], a[6] != 0 ? .webGPU : .webGL, reversedDepth: a[7] != 0)
        }
      },
      "m3.multiply": { a in self.mutM3(self.m3(a)) { $0.multiply(self.m3(a, 9)) } },
      "m3.premultiply": { a in self.mutM3(self.m3(a)) { $0.premultiply(self.m3(a, 9)) } },
      "m3.determinant": { a in [self.m3(a).determinant()] },
      "m3.invert": { a in self.mutM3(self.m3(a)) { $0.invert() } },
      "m3.transpose": { a in self.mutM3(self.m3(a)) { $0.transpose() } },
      "m3.getNormalMatrix": { a in self.mutM3(Mat3()) { $0.getNormalMatrix(self.m4(a)) } },
      "m3.setFromMatrix4": { a in self.mutM3(Mat3()) { $0.setFromMatrix4(self.m4(a)) } },
      "m3.setUvTransform": { a in self.mutM3(Mat3()) { $0.setUvTransform(a[0], a[1], a[2], a[3], a[4], a[5], a[6]) } },
      "m3.makeRotation": { a in self.mutM3(Mat3()) { $0.makeRotation(a[0]) } },
      "m3.multiplyScalar": { a in self.mutM3(self.m3(a)) { $0.multiplyScalar(a[9]) } },
    ])
  }

  // ---- Color -----------------------------------------------------------------------------------------
  func testColor() throws {
    try run("math/three_color", [
      "setHex": { a in self.mutC(Color3()) { $0.setHex(a[0], self.space(a[1])) } },
      "setRGB": { a in self.mutC(Color3()) { $0.setRGB(a[0], a[1], a[2], self.space(a[3])) } },
      "setHSL": { a in self.mutC(Color3()) { $0.setHSL(a[0], a[1], a[2], self.space(a[3])) } },
      "getHex": { a in [self.c(a).getHex(self.space(a[3]))] },
      "getHSL": { a in
        let h = self.c(a).getHSL(self.space(a[3]))
        return [h.h, h.s, h.l]
      },
      "getRGB": { a in self.c(a).getRGB(self.space(a[3])).array },
      "offsetHSL": { a in self.mutC(self.c(a)) { $0.offsetHSL(a[3], a[4], a[5]) } },
      "add": { a in self.mutC(self.c(a)) { $0.add(self.c(a, 3)) } },
      "addScalar": { a in self.mutC(self.c(a)) { $0.addScalar(a[3]) } },
      "sub": { a in self.mutC(self.c(a)) { $0.sub(self.c(a, 3)) } },
      "multiply": { a in self.mutC(self.c(a)) { $0.multiply(self.c(a, 3)) } },
      "multiplyScalar": { a in self.mutC(self.c(a)) { $0.multiplyScalar(a[3]) } },
      "lerp": { a in self.mutC(self.c(a)) { $0.lerp(self.c(a, 3), a[6]) } },
      "lerpColors": { a in self.mutC(Color3()) { $0.lerpColors(self.c(a), self.c(a, 3), a[6]) } },
      "lerpHSL": { a in self.mutC(self.c(a)) { $0.lerpHSL(self.c(a, 3), a[6]) } },
      "convertSRGBToLinear": { a in self.mutC(self.c(a)) { $0.convertSRGBToLinear() } },
      "convertLinearToSRGB": { a in self.mutC(self.c(a)) { $0.convertLinearToSRGB() } },
      "applyMatrix3": { a in self.mutC(self.c(a)) { $0.applyMatrix3(self.m3(a, 3)) } },
    ])
  }

  func testColorStrings() throws {
    let v = try VectorLoader.load("math/three_color")
    for r in try v.data["setStyle"]["rows"].requireArray("setStyle") {
      let style = try r[0].requireString("style")
      var col = Color3(0.25, 0.5, 0.75)
      col.setStyle(style)
      let want = [try r[1].requireDouble(), try r[2].requireDouble(), try r[3].requireDouble()]
      assertBitEqual(col.array, want, "setStyle(\(style.debugDescription))")
    }
    for r in try v.data["getHexString"]["rows"].requireArray("getHexString") {
      let col = Color3(try r[0].requireDouble(), try r[1].requireDouble(), try r[2].requireDouble())
      XCTAssertEqual(col.getHexString(space(try r[3].requireDouble())), try r[4].requireString(), "getHexString \(col)")
    }
    for r in try v.data["getStyle"]["rows"].requireArray("getStyle") {
      let col = Color3(try r[0].requireDouble(), try r[1].requireDouble(), try r[2].requireDouble())
      let s = space(try r[3].requireDouble())
      XCTAssertEqual(col.getStyle(s == .none ? .srgb : s), try r[4].requireString(), "getStyle \(col)")
    }
    XCTAssertEqual(Color3.names.count, try v.data["names"].requireInt("names"), "Color.NAMES size")
  }

  /// Hand cases for API shapes the vectors do not reach.
  func testValueSemanticsAndDefaults() {
    XCTAssertEqual(Quat(), Quat(0, 0, 0, 1))
    XCTAssertEqual(Euler().order, .XYZ)
    XCTAssertEqual(Mat4().elements, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    XCTAssertEqual(Mat3().elements, [1, 0, 0, 0, 1, 0, 0, 0, 1])
    let m = Mat4(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
    XCTAssertEqual(m[12], 4, "set() takes row-major arguments, storage is column-major")
    XCTAssertEqual(Color3(), Color3(1, 1, 1))
    var a = V3(1, 2, 3)
    let b = a
    a.multiplyScalar(2)
    XCTAssertEqual(b, V3(1, 2, 3), "value semantics: copies do not alias")
  }
}
