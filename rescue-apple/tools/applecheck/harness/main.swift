// Linux runtime harness for the M0 bootstrap (no GPU): loads the real exported data like the app,
// runs BootstrapSim for every preset × quality, packs the uniforms the renderer would upload and checks
// them (finite, sane), plus camera framing through CameraMatrices (heli at NDC y ≈ +0.1).
import Foundation
import MaydayCore
import MaydayShaderTypes

var failures = 0
func check(_ ok: Bool, _ msg: @autoclosure () -> String) { if !ok { failures += 1; print("FAIL:", msg()) } }

func allFinite<T>(_ v: T) -> Bool {
  var ok = true
  withUnsafeBytes(of: v) { raw in for f in raw.bindMemory(to: Float.self) where !f.isFinite { ok = false } }
  return ok
}

let bundlePath = CommandLine.arguments[1]
guard let bundle = Bundle(path: bundlePath) else { fatalError("no bundle at \(bundlePath)") }
print("resourceURL:", bundle.resourceURL?.path ?? "nil")
let data = try DataBundle(bundle: bundle)
let presets = try data.data("weather")["weather/presets"]["PRESET_NAMES"].strings
let fmt = { (x: Float) in String(format: "%.3f", x) }
let fmt4 = { (v: SIMD4<Float>) in "(\(fmt(v.x)), \(fmt(v.y)), \(fmt(v.z)), \(fmt(v.w)))" }
let fmt3 = { (v: SIMD3<Float>) in "(\(fmt(v.x)), \(fmt(v.y)), \(fmt(v.z)))" }

for q in ["low", "medium", "high"] {
  for p in presets {
    let sim = try BootstrapSim(data: data, qualityName: q, presetName: p)
    var raw = RawInputFrame()
    var f: RenderFrame?
    for i in 0..<420 {
      // fly north-east for 3 s, then hover (the camera springs settle on the hovering probe)
      raw.virtualAxes = i < 180 ? ["moveX": 0.6, "moveY": 0.8] : [:]
      sim.step(realDt: 1.0 / 60.0, raw: raw)
      f = sim.renderFrame(internalWidth: 1920, internalHeight: 1080, pxScale: 2, dt: 1.0 / 60.0)
    }
    guard let fr = f else { continue }
    let u = OceanRenderer.pack(fr.ocean)
    check(allFinite(u), "\(q)/\(p): non-finite ocean uniform")
    check(allFinite(fr.post.finalPass), "\(q)/\(p): non-finite final uniform")
    check(u.uSplashCount >= 0 && u.uSplashCount <= 24, "splash count")
    // waves present (amplitudes) and the bank count follows the tier
    let a = fr.ocean.waveA.prefix(sim.quality.oceanWaves).map { $0.w }
    check(a.contains { $0 > 0 }, "\(q)/\(p): all wave amplitudes zero")
    // camera: heli (probe) at NDC (0, +0.1) once hovering; projection depth inside the clip range
    let cam = CameraMatrices(camera: fr.camera, aspect: 1920.0 / 1080.0)
    let hp = sim.probe
    let clip = cam.projGL * (cam.view * SIMD4<Double>(hp.x, hp.y, hp.z, 1))
    let ndc = SIMD3<Double>(clip.x / clip.w, clip.y / clip.w, clip.z / clip.w)
    check(abs(ndc.x) < 0.01 && abs(ndc.y - 0.1) < 0.01, "\(q)/\(p): heli NDC \(ndc) (want 0, 0.1)")
    let metal = cam.projMetal * (cam.view * SIMD4<Double>(hp.x, hp.y, hp.z, 1))
    check(metal.z / metal.w > 0 && metal.z / metal.w < 1, "\(q)/\(p): Metal depth \(metal.z / metal.w)")
    // inverse sanity: invViewProj · viewProj = I
    let I = cam.viewProjMetal.inverse * cam.viewProjMetal
    var maxErr = 0.0
    for c in 0..<4 { for r in 0..<4 {
      let col = [I.columns.0, I.columns.1, I.columns.2, I.columns.3][c]
      maxErr = max(maxErr, abs(col[r] - (c == r ? 1 : 0)))
    } }
    check(maxErr < 1e-9, "inverse error \(maxErr)")
    // fog focus lies under the screen centre: the camera's look-at target (y = 0)
    let ff = cam.fogFocus(cameraY: fr.camera.position.y)
    let tgt = fr.camera.target - fr.camera.position
    check(abs(ff.x - tgt.x) < 1e-6 && abs(ff.y - tgt.z) < 1e-6, "\(q)/\(p): fog focus \(ff) vs target offset \(tgt)")
    if q == "high" {
      print("\(p): H \(String(format: "%.1f", sim.lastPose?.heightM ?? 0)) tilt \(String(format: "%.2f", sim.lastPose?.tiltDeg ?? 0)) Hs \(String(format: "%.3f", sim.ocean.bank.stats.Hs)) HsEff \(fmt(u.grid.w)) exp \(fmt(fr.post.exposure)) fog \(fmt3(fr.fog.color)) \(fr.fog.near)…\(fr.fog.far)")
      print("   seaA \(fmt4(u.uSeaA)) seaB \(fmt4(u.uSeaB)) seaC \(fmt4(u.uSeaC))")
      print("   seaD \(fmt4(u.uSeaD)) seaE \(fmt4(u.uSeaE)) lookK \(fmt4(u.uLookK)) jStats \(fmt4(u.uJStats))")
      print("   deep \(fmt4(u.uDeep)) body \(fmt4(u.uBody)) crest \(fmt4(u.uCrest)) foam \(fmt4(u.uFoamCol))")
      print("   final slope \(fmt3(fr.post.finalPass.slope)) power \(fmt(fr.post.finalPass.power)) contrast \(fmt(fr.post.finalPass.contrast)) sat \(fmt(fr.post.finalPass.sat)) vignette \(fmt(fr.post.finalPass.vignette)) grain \(fmt(fr.post.finalPass.grain)) ca(px@1080) \(fmt(fr.post.finalPass.ca))")
    }
  }
}
// DrawList ordering against three's comparators on a small scene
let list = RenderList()
let cam = CameraMatrices(camera: CameraState(position: SIMD3<Double>(0, 150, 40), target: SIMD3<Double>(0, 0, 0)), aspect: 16.0 / 9.0)
let vp = cam.projGL * cam.view
let fr = Frustum(viewProjGL: vp)
var items: [DrawItem] = []
for i in 0..<12 {
  var it = DrawItem(id: 100 - i, materialID: i % 3, center: SIMD3<Double>(Double(i) * 7 - 40, Double(i % 4), Double(i) * -9 + 30), radius: 2)
  it.transparent = i % 2 == 0
  it.renderOrder = i % 5 == 0 ? 10 : 0
  items.append(it)
}
var far = DrawItem(id: 7, materialID: 0, center: SIMD3<Double>(5000, 0, 0), radius: 3)
far.transparent = false
items.append(far)
var hidden = DrawItem(id: 8, materialID: 0, center: SIMD3<Double>(0, 0, 0), radius: 3)
hidden.layers = .heat
items.append(hidden)
var added = 0
for it in items {
  let ok = list.add(it, viewProjGL: vp, frustum: fr)
  if ok { added += 1 }
  // independent expectation: camera layer test + centre NDC inside the screen (items here are small)
  let c = vp * SIMD4<Double>(it.center.x, it.center.y, it.center.z, 1)
  let n = SIMD2<Double>(c.x / c.w, c.y / c.w)
  let m = max(abs(n.x), abs(n.y))
  if m > 0.95 && m < 1.05 { continue }            // too close to an edge for a centre test
  let expect = it.layers.contains(.main) && c.w > 0 && m <= 1
  check(ok == expect, "item \(it.id): added \(ok), NDC \(n)")
}
list.sort()
print("draw list: added \(added) of \(items.count)")
for (a, b) in zip(list.opaque, list.opaque.dropFirst()) { check(RenderList.opaqueOrder(a, b), "opaque order") }
for (a, b) in zip(list.transparent, list.transparent.dropFirst()) {
  check(a.renderOrder < b.renderOrder || (a.renderOrder == b.renderOrder && a.z >= b.z), "transparent back-to-front")
}
print("opaque:", list.opaque.map { "\($0.id)/r\($0.renderOrder)/m\($0.materialID)" }.joined(separator: " "))
print("transparent:", list.transparent.map { "\($0.id)/r\($0.renderOrder)/z\(String(format: "%.3f", $0.z))" }.joined(separator: " "))
print(failures == 0 ? "HARNESS OK" : "HARNESS FAILURES: \(failures)")
exit(failures == 0 ? 0 : 1)
