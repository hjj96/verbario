// Linux runtime harness for the app layer (no GPU): builds the app's GameSession — MaydayCore's real
// WeatherSim, OceanSim, Helicopter, CameraRig and the free-flight stand-ins — on the real exported data,
// exactly like the app does, and checks:
//   1. session: every preset × quality flies (take off, cruise, hover) and the render snapshot packs to
//      finite uniforms (ocean, lights, FinalPass), the heli sits at NDC (0, +0.1) of the follow framing
//      (camera.js HELI_SCREEN_Y), depth inside Metal's clip range, fog focus under the screen centre, the GPU
//      projection on camera.aspect; the water-memory step the renderer encodes is the queue's (window
//      floats bitwise, the advect's feature flow from ocean.update rather than the late upload);
//   2. parity: Tests/Vectors/app/*.json, recorded from the web's own boot + frame loop over the same
//      systems (tools/export/export-app.mjs), replayed through GameSession (bitwise) and touch.js's
//      arithmetic through TouchMapping;
//   3. DrawList ordering against three's comparators on a small scene.
import Foundation
import MaydayCore
import MaydayShaderTypes

var failures = 0
func check(_ ok: Bool, _ msg: @autoclosure () -> String) { if !ok { failures += 1; print("FAIL:", msg()) } }

/// Every Float of a fully initialised C uniform struct (MD*: zero-initialised, no Swift padding lanes) is finite.
func allFinite<T>(_ v: T) -> Bool {
  var ok = true
  withUnsafeBytes(of: v) { raw in for f in raw.bindMemory(to: Float.self) where !f.isFinite { ok = false } }
  return ok
}

/// Names of the stored properties holding a non-finite Float / Double. For Swift structs (FinalInput, inputs):
/// their raw bytes include SIMD3 padding lanes and alignment gaps with arbitrary contents.
func nonFinite(_ v: Any) -> [String] {
  var out: [String] = []
  for c in Mirror(reflecting: v).children {
    let bad: Bool
    switch c.value {
    case let x as Float: bad = !x.isFinite
    case let x as Double: bad = !x.isFinite
    case let x as SIMD2<Float>: bad = !(x.x.isFinite && x.y.isFinite)
    case let x as SIMD3<Float>: bad = !(x.x.isFinite && x.y.isFinite && x.z.isFinite)
    case let x as SIMD4<Float>: bad = !(x.x.isFinite && x.y.isFinite && x.z.isFinite && x.w.isFinite)
    case let x as [SIMD4<Float>]: bad = x.contains { !($0.x.isFinite && $0.y.isFinite && $0.z.isFinite && $0.w.isFinite) }
    case let x as [Float]: bad = x.contains { !$0.isFinite }
    default: bad = false
    }
    if bad { out.append(c.label ?? "?") }
  }
  return out
}

let bundlePath = CommandLine.arguments[1]
guard let bundle = Bundle(path: bundlePath) else { fatalError("no bundle at \(bundlePath)") }
print("resourceURL:", bundle.resourceURL?.path ?? "nil")
let data = try DataBundle(bundle: bundle)
let catalog = try data.catalog()
let presets = try data.data("weather")["weather/presets"]["PRESET_NAMES"].strings ?? []
let fmt = { (x: Double) in String(format: "%.2f", x) }

// ---- 1. session smoke run ------------------------------------------------------------------------------
for q in ["low", "medium", "high"] {
  for p in (q == "high" ? presets : ["calm", "storm"]) {
    var opt = SessionOptions()
    opt.quality = q
    opt.weather = p
    let s = try GameSession(catalog: catalog, storage: MemoryStorage(), options: opt)
    check(s.loop.mode == .play, "\(q)/\(p): mode \(s.loop.mode) after boot (free flight launches into play)")
    check(s.heli.landed != nil, "\(q)/\(p): the heli starts on the stub World's pad")
    var f: RenderFrame?
    for i in 0..<720 {
      // 40 m preset (takes off from the pad), cruise north-east for 3 s from 4 s, then hover (springs settle)
      s.input.setVirtualButton(.altPreset2, i >= 2 && i < 6)
      s.input.setVirtualAxis(.moveX, i >= 240 && i < 420 ? 0.6 : 0)
      s.input.setVirtualAxis(.moveY, i >= 240 && i < 420 ? 0.8 : 0)
      s.step(frameDelta: 1.0 / 60.0)
      f = s.renderFrame(internalWidth: 1920, internalHeight: 1080, pxScale: 2)
    }
    guard let fr = f else { continue }
    check(s.loop.disabled.isEmpty, "\(q)/\(p): disabled systems \(s.loop.disabled)")
    check(s.heli.alive && s.heli.landed == nil && s.heli.altitude > 30, "\(q)/\(p): heli alt \(s.heli.altitude) alive \(s.heli.alive)")
    check(s.quality.name == q, "\(q)/\(p): tier \(s.quality.name)")
    let u = OceanRenderer.pack(fr.ocean)
    check(allFinite(u), "\(q)/\(p): non-finite ocean uniform")
    check(nonFinite(fr.post.finalPass).isEmpty, "\(q)/\(p): non-finite final uniform \(nonFinite(fr.post.finalPass))")
    check(allFinite(LightRig.pack(fr.lights, shadowMapBound: true)), "\(q)/\(p): non-finite light uniform")
    check(u.uSplashCount >= 0 && u.uSplashCount <= 24, "splash count")
    let a = fr.ocean.waveA.prefix(s.quality.oceanWaves).map { $0.w }
    check(a.contains { $0 > 0 }, "\(q)/\(p): all wave amplitudes zero")
    check(fr.ocean.heliP.w == 1, "\(q)/\(p): ocean has no heli (downwash / contact)")
    // camera: the GPU projects with camera.aspect (CSS points), not the pixel size; the heli at NDC (0, +0.1)
    // once hovering; depth inside the clip range
    check(fr.camera.aspect.map { $0.bitPattern == s.camera.aspect.bitPattern } ?? false, "\(q)/\(p): render aspect \(fr.camera.aspect ?? .nan)")
    let cam = CameraMatrices(camera: fr.camera, aspect: fr.camera.aspect ?? 1920.0 / 1080.0)
    let hp = s.heli.position
    let clip = cam.projGL * (cam.view * SIMD4<Double>(hp.x, hp.y, hp.z, 1))
    let ndc = SIMD3<Double>(clip.x / clip.w, clip.y / clip.w, clip.z / clip.w)
    check(abs(ndc.x) < 0.06 && abs(ndc.y - CameraRig.HELI_SCREEN_Y) < 0.06, "\(q)/\(p): heli NDC \(ndc) (want 0, 0.1)")
    let metal = cam.projMetal * (cam.view * SIMD4<Double>(hp.x, hp.y, hp.z, 1))
    check(metal.z / metal.w > 0 && metal.z / metal.w < 1, "\(q)/\(p): Metal depth \(metal.z / metal.w)")
    let I = cam.viewProjMetal.inverse * cam.viewProjMetal
    var maxErr = 0.0
    for c in 0..<4 { for r in 0..<4 {
      let col = [I.columns.0, I.columns.1, I.columns.2, I.columns.3][c]
      maxErr = max(maxErr, abs(col[r] - (c == r ? 1 : 0)))
    } }
    check(maxErr < 1e-9, "inverse error \(maxErr)")
    // the stand-ins: pad cylinder at the stub World's object position, the heli box on the body matrix
    check(SceneProps.placements(s, heliStandIn: true).count == s.world.padList.count + 1, "\(q)/\(p): stand-in meshes")
    check(SceneProps.placements(s, heliStandIn: false).count == s.world.padList.count, "\(q)/\(p): pad meshes")
    // the heli's lamps in the light set come from its render snapshot (spot[0] searchlight, point[0] belly)
    if let hs = s.heliSnapshot {
      check(fr.lights.spots.count == 1 && fr.lights.points.count == 1 && fr.lights.points[0].position == hs.bellyLight.position,
            "\(q)/\(p): heli lights")
    } else {
      check(false, "\(q)/\(p): no heli snapshot")
    }
    if q == "high" {
      print("\(p): heli (\(fmt(hp.x)), \(fmt(hp.y)), \(fmt(hp.z))) alt \(fmt(s.heli.altitude)) cam H \(fmt(s.rig.height)) tilt \(fmt(s.rig.tiltDeg)) " +
            "wind \(fmt(s.weather.state.windSpeed)) Hs \(fmt(s.ocean.waveStats.Hs)) exp \(fmt(Double(fr.post.exposure))) " +
            "fog \(fr.fog.near)…\(fr.fog.far) env \(fr.environment.rebake) NDC (\(String(format: "%.3f", ndc.x)), \(String(format: "%.3f", ndc.y)))")
    }
  }
}

// ---- 1b. debug controls: quality / preset cycling and the restart keep the session sane ---------------------
do {
  let s = try GameSession(catalog: catalog, storage: MemoryStorage())
  var tiers: [String] = []
  for i in 0..<900 {
    if i % 150 == 10 { s.cycleQuality(); tiers.append(s.quality.name) }
    if i % 200 == 20 { s.cyclePreset(i % 400 == 20 ? 1 : -1) }
    if i == 600 { s.mission.restart() }
    s.input.setVirtualButton(.altPreset2, i % 300 >= 2 && i % 300 < 6)
    s.step(frameDelta: 1.0 / 60.0)
    let f = s.renderFrame(internalWidth: 1280, internalHeight: 720, pxScale: 2)
    if !allFinite(OceanRenderer.pack(f.ocean)) || !nonFinite(f.post.finalPass).isEmpty {
      var bad: [String] = []
      withUnsafeBytes(of: OceanRenderer.pack(f.ocean)) { raw in
        let fl = raw.bindMemory(to: Float.self)
        for (k, x) in fl.enumerated() where !x.isFinite { bad.append("@\(k * 4)=\(String(x.bitPattern, radix: 16))") }
      }
      check(false, "debug cycling: non-finite frame \(i): ocean \(nonFinite(f.ocean)) packed \(bad.prefix(8)) final \(nonFinite(f.post.finalPass)) " +
            "heli \(s.heli.position) quality \(s.quality.name) preset \(s.weather.state.preset) shoals \(f.ocean.shoals.count) feat \(f.ocean.featA.count) glints \(f.ocean.glints.count) splashes \(f.ocean.splashes.count)")
      break
    }
  }
  check(tiers == ["low", "medium", "high", "low", "medium", "high"], "quality cycle \(tiers)")
  check(s.mission.runs == 2 && s.loop.disabled.isEmpty, "restart: runs \(s.mission.runs), disabled \(s.loop.disabled)")
  check(s.ocean.cfg.grid == s.quality.oceanGridN, "ocean grid \(s.ocean.cfg.grid) vs tier \(s.quality.oceanGridN)")
  print("debug cycling: tiers \(tiers), preset \(s.weather.state.preset), runs \(s.mission.runs)")
}

// ---- 1c. water memory: the renderer's window and advect flow are the queue's (WaterMemoryQueue.Frame) ---------
do {
  var opt = SessionOptions()
  opt.quality = "high"
  opt.weather = "calm"
  let s = try GameSession(catalog: catalog, storage: MemoryStorage(), options: opt)
  var win: WaterMemoryWindow?
  var steps = 0
  let addAt = 120
  for i in 0..<240 {
    s.input.setVirtualButton(.altPreset2, i >= 2 && i < 6)
    s.step(frameDelta: 1.0 / 60.0)
    // a system that runs after the ocean (hazards) adds a vortex: the late upload has it this frame, the
    // advect that ran inside ocean.update does not (web: the advect renders inside ocean.update)
    if i == addAt {
      let hp = s.heli.position
      check(s.ocean.setFeature("harness-vortex", FeatureSpec(type: "vortex", x: hp.x + 40, z: hp.z, radius: 25)), "memory: vortex accepted")
    }
    let f = s.renderFrame(internalWidth: 1280, internalHeight: 720, pxScale: 2)
    let wm = f.waterMemory
    guard wm.dt > 0, let q = s.ocean.memory, let mf = q.frame else { continue }
    steps += 1
    if win?.size != q.size { win = WaterMemoryWindow(size: q.size, extent: q.extent) }
    let u = win!.advance(dt: wm.dt, focus: wm.focus, wind: wm.wind)
    let a = mf.advect
    var e = MDMemoryAdvectUniforms()
    e.shiftCenter = SIMD4<Float>(Float(a.shift.x), Float(a.shift.y), Float(a.center.x), Float(a.center.y))
    e.extentDtWind = SIMD4<Float>(Float(a.extent), Float(a.dt), Float(a.windV.x), Float(a.windV.y))
    e.uDecay = SIMD4<Float>(Float(a.decay.x), Float(a.decay.y), Float(a.decay.z), Float(a.decay.w))
    e.texelDiffuse = SIMD4<Float>(Float(a.texel.x), Float(a.texel.y), Float(a.diffuse), 0)
    let same = withUnsafeBytes(of: u) { ub in withUnsafeBytes(of: e) { eb in ub.elementsEqual(eb) } }
    check(same, "memory step \(i): renderer advect \(u) vs queue \(e)")
    let adv = OceanRenderer.pack(wm.advectOcean(f.ocean))
    check(Int(adv.uFeatCount) == min(mf.flow.count, Int(MD_MAX_FEATURES)) && wm.stamps.count == mf.count,
          "memory step \(i): advect features \(adv.uFeatCount), flow \(mf.flow.count), stamps \(wm.stamps.count) / \(mf.count)")
    if i == addAt {
      check(f.ocean.featA.count == 1 && adv.uFeatCount == 0, "memory: late-upload features \(f.ocean.featA.count), advect \(adv.uFeatCount) (want 1, 0)")
    }
    if i == addAt + 1 {
      check(adv.uFeatCount == 1 && withUnsafeBytes(of: adv.uFeatA) { Array($0.prefix(16)) } == withUnsafeBytes(of: OceanRenderer.pack(f.ocean).uFeatA) { Array($0.prefix(16)) },
            "memory: the next step's advect swirls with the vortex (\(adv.uFeatCount))")
    }
  }
  check(steps == 240, "memory: \(steps) steps of 240 handed over")
  print("water memory: \(steps) steps, window + flow = queue")
}

// ---- 2. parity with the web's session ----------------------------------------------------------------------
failures += try SessionParity.run(catalog: catalog, vectors: SessionParity.vectorsDirectory(bundlePath: bundlePath))

// ---- 3. DrawList ordering against three's comparators on a small scene ---------------------------------------
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
print(failures == 0 ? "HARNESS OK" : "HARNESS FAILURES: \(failures)")
exit(failures == 0 ? 0 : 1)
