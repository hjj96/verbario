// systems/camera.js worldToScreen / screenToWater and camera/shake.js CameraMotion vs Node 22
// (Tests/Vectors/camera/projection.json, shake.json from export-heli.mjs); the full rig runs are in
// HeliTraceTests (camera/rig_*.json).
import XCTest
@testable import MaydayCore

final class CameraTests: XCTestCase {
  func testProjection() throws {
    let v = try VectorLoader.load("camera/projection")
    for (ci, c) in (v.data["cases"].array ?? []).enumerated() {
      let pose = c["pose"]
      let p = try pose["position"].requireDoubles()
      let look = try pose["look"].requireDoubles()
      let rot = try pose["rot"].requireDoubles()
      let cam = PerspectiveCamera(fov: try pose["fov"].requireDouble(), aspect: try pose["aspect"].requireDouble(), near: 2, far: 1200)
      cam.position.set(p[0], p[1], p[2])
      cam.up.set(0, 1, 0)
      cam.lookAt(V3(look[0], look[1], look[2]))
      cam.rotateX(rot[0])
      cam.rotateY(rot[1])
      cam.rotateZ(rot[2])
      cam.updateMatrixWorld()
      assertBitEqual(cam.matrixWorld.elements, try c["matrixWorld"].requireDoubles(), "case \(ci) matrixWorld")
      assertBitEqual(cam.projectionMatrix.elements, try c["projectionMatrix"].requireDoubles(), "case \(ci) projectionMatrix")
      for (i, row) in (c["worldToScreen"].array ?? []).enumerated() {
        let r = try row.requireDoubles()
        let s = Projection.worldToScreen(V3(r[0], r[1], r[2]), camera: cam, width: 1280, height: 720)
        assertRowBitEqual([s.x, s.y, s.ndcX, s.ndcY, s.behind ? 1 : 0, s.onScreen ? 1 : 0], Array(r[3...]),
                          fields: ["px", "py", "ndcX", "ndcY", "behind", "onScreen"], "case \(ci) worldToScreen \(i)")
      }
      for (i, row) in (c["screenToWater"].array ?? []).enumerated() {
        let r = try row.requireDoubles()
        let w = Projection.screenToWater(r[0], r[1], camera: cam)
        assertRowBitEqual([w.x, w.y, w.z], Array(r[2...]), fields: ["x", "y", "z"], "case \(ci) screenToWater \(i)")
      }
    }
  }

  func testShake() throws {
    let v = try VectorLoader.load("camera/shake")
    let fields = try XCTUnwrap(v.data["fields"].strings)
    for run in v.data["runs"].array ?? [] {
      let seed = try run["seed"].requireDouble()
      let rows = try v.sidecarF64(run["rows"])
      let m = CameraMotion(seed: seed)
      let n = fields.count
      for k in 1...(rows.count / n) {
        let want = Array(rows[((k - 1) * n)..<(k * n)])
        // script (export-heli.mjs camera(): the same calls on the same frames)
        if k == 30 { m.addTrauma(0.6, 9) }
        if k == 60 { m.addTrauma(0.3) }
        if k == 200 { m.addTrauma(1.4, 13) }
        if k > 300 && k < 400 { m.floor(0.25) }
        if k == 450 { m.gustPush(3, -4, 0.8) }
        if k == 520 { m.gustPush(0, 0, 0.5) }
        let dt = want[0], storm = want[1], shake = want[2], motion = want[3]
        m.update(dt, storm, shake, motion)
        let got = [dt, storm, shake, motion, m.pos.x, m.pos.y, m.pos.z, m.rot.x, m.rot.y, m.rot.z, m.trauma, m.freq, m.shakeT,
                   m.push.x, m.push.y, m.pushV.x, m.pushV.y, m.pushT]
        if !assertRowBitEqual(got, want, fields: fields, "shake seed \(seed) frame \(k)") { break }
      }
    }
  }
}
