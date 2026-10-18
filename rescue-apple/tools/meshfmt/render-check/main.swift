// Linux check of MaydayRender's helicopter code that needs no GPU (built with every Sources/MaydayRender
// file against the applecheck stubs by tools/meshfmt/check-render.sh):
//   1. meshes: every Resources/Meshes/heli_*.mmesh loads through DataCatalog (size + sha256 vs the
//      manifest), parses (MMeshFile) and its meta decodes (MMeshMeta); every heli material builds from it;
//   2. transforms: HeliTransforms over the baked chains reproduces three's matrixWorld of every object for
//      the poses in tools/meshfmt/vectors/heli_transforms.json — bitwise;
//   3. layouts: the slot counts / attribute / texture / sampler / function-constant numbers in
//      HeliShaderLayout (Swift) equal the ones in Shaders/Heli/HeliShaderTypes.h (MSL);
//   4. snapshot: a real MaydayCore Helicopter → HeliRenderSnapshot → HeliPose / uniform blocks / light slots:
//      right sizes, finite, the hull sits on body.matrixWorld;
//   5. planner: what HeliRenderer draws — visibility, three's sort order (opaque / transparent), frustum
//      culling of frustumCulled objects only, uniform block sizes per shader, shadow casters, thermal flags.
import Foundation
import simd
import MaydayCore

var failures = 0
var checks = 0
func check(_ ok: Bool, _ msg: @autoclosure () -> String) {
  checks += 1
  if !ok { failures += 1; if failures <= 40 { print("FAIL:", msg()) } }
}

let repo = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let catalog = try DataCatalog(root: repo)

// ---- 1. meshes and materials ------------------------------------------------------------------------------
var metas: [String: MMeshMeta] = [:]
for name in HeliMeshes.names {
  do {
    let bytes = try catalog.bytes(path: MMeshLoader.manifestPath(name), verify: true)
    let file = try MMeshFile(bytes: bytes)
    let meta = try MMeshMeta(data: file.metaJSON)
    check(meta.name == name, "\(name): meta name \(meta.name)")
    check(!meta.chains.isEmpty && meta.chains.allSatisfy { !$0.isEmpty }, "\(name): chains")
    check(file.attribute("position") != nil, "\(name): position")
    metas[name] = meta
  } catch {
    check(false, "\(name): \(error)")
  }
}
func meta(_ n: String) -> MMeshMeta { metas[n]! }
if metas.count == HeliMeshes.names.count {
  do {
    let hull = try HeliHullMaterial(meta: meta("heli_hull"))
    _ = try HeliHullMaterial(meta: meta("heli_hub"))
    check(hull.clearcoat > 0 && hull.ior > 1, "hull: clearcoat / ior from the MeshPhysicalMaterial")
    check(hull.wx.uWxB.z > 0, "hull: weathering uniforms (onBeforeCompile ran in the bake)")
    for n in ["heli_rotor_main", "heli_rotor_main_low", "heli_rotor_tail"] {
      let r = try HeliRotorMaterial(meta: meta(n))
      check(r.blades >= 4 && r.bladeW > 0, "\(n): blades / width")
    }
    check(try HeliRotorMaterial(meta: meta("heli_rotor_main")).hull.x > 0, "main disc: fuselage hole")
    check(try HeliRotorMaterial(meta: meta("heli_rotor_tail")).hull.x == 0, "tail disc: no fuselage hole")
    _ = try HeliLightsMaterial(meta: meta("heli_lights"))
    _ = try HeliConeMaterial(meta: meta("heli_searchlight_cone"))
    _ = try HeliCableMaterial(meta: meta("heli_cable"))
    check(try HeliRingMaterial(meta: meta("heli_ring")).dashes == 22, "ring: 22 dashes")
    for n in ["heli_crew_body", "heli_float", "heli_basket", "heli_rescuer", "heli_raft_pack", "heli_flare"] {
      let p = try HeliPropMaterialParams(meta: meta(n))
      check(p.opacity == 1 && p.color.x.isFinite, "\(n): material")
    }
    check(!(try HeliPropMaterialParams(meta: meta("heli_float"))).vertexColors, "float: plain colour")
    check(try HeliPropMaterialParams(meta: meta("heli_crew_body")).vertexColors, "crew: vertex colours")
    check(meta("heli_crew_body").heat == 1 && meta("heli_hull").thermalMass == 0.5 && meta("heli_lights").heat == nil,
          "thermal flags (crew heat, airframe mass, lamps none)")
    check(heliCulling(meta("heli_rotor_main")) == .none && heliCulling(meta("heli_hull")) == .back, "material sides")
  } catch {
    check(false, "materials: \(error)")
  }
}

// ---- 2. transforms vs three's matrixWorld --------------------------------------------------------------------
func mat(_ j: JSONValue) -> Mat4? {
  guard let d = j.doubles, d.count == 16 else { return nil }
  var m = Mat4()
  m.fromArray(d)
  return m
}
func v3(_ j: JSONValue) -> V3 { let d = j.doubles ?? [0, 0, 0]; return V3(d[0], d[1], d[2]) }
func quat(_ j: JSONValue) -> Quat { let d = j.doubles ?? [0, 0, 0, 1]; return Quat(d[0], d[1], d[2], d[3]) }

let vec = try JSONValue.load(contentsOf: repo.appendingPathComponent("tools/meshfmt/vectors/heli_transforms.json"))
var compared = 0
for (k, row) in (vec["data"]["poses"].array ?? []).enumerated() {
  let j = row["pose"]
  var p = HeliPose()
  p.rootMatrix = mat(j["rootMatrix"]) ?? Mat4()
  p.bodyMatrix = mat(j["bodyMatrix"]) ?? Mat4()
  p.pitch = j["pitch"].double ?? 0
  p.bank = j["bank"].double ?? 0
  p.hubAngle = j["hubAngle"].double ?? 0
  p.shadowBladesAngle = j["shadowBladesAngle"].double ?? 0
  p.floatScale = v3(j["floatScale"])
  p.crewPosition = v3(j["crewPosition"])
  p.crewArm = quat(j["crewArm"])
  p.crewHead = quat(j["crewHead"])
  p.basketPosition = v3(j["basketPosition"])
  p.basketQuaternion = quat(j["basketQuaternion"])
  p.rescuerPosition = v3(j["rescuerPosition"])
  p.rescuerQuaternion = quat(j["rescuerQuaternion"])
  p.conePosition = v3(j["conePosition"])
  p.coneQuaternion = quat(j["coneQuaternion"])
  p.coneScale = v3(j["coneScale"])
  p.flares = (j["flares"].array ?? []).map { Optional(v3($0)) }
  p.rafts = (j["rafts"].array ?? []).map { Optional((position: v3($0["position"]), rotation: v3($0["rotation"]))) }
  for (name, objs) in row["matrixWorld"].object?.storage ?? [:] {
    guard let m = metas[name] else { check(false, "pose \(k): unknown mesh \(name)"); continue }
    for (i, o) in (objs.array ?? []).enumerated() {
      guard let web = mat(o) else { check(false, "pose \(k) \(name)[\(i)]: bad matrix"); continue }
      let mine = HeliTransforms.world(m, chain: i, pose: p)
      var same = true
      for e in 0..<16 where mine[e].bitPattern != web[e].bitPattern { same = false }
      check(same, "pose \(k) \(name)[\(i)]: matrixWorld differs: \(mine.elements) vs web \(web.elements)")
      compared += 1
    }
  }
}
check(compared >= 6 * 20, "transforms: \(compared) matrices compared")

// ---- 3. header ⇄ Swift layout numbers ----------------------------------------------------------------------------
let header = try String(contentsOf: repo.appendingPathComponent("Sources/MaydayRender/Shaders/Heli/HeliShaderTypes.h"), encoding: .utf8)
func headerSize(_ t: String) -> Int? {
  guard let r = header.range(of: "sizeof(\(t)) == ") else { return nil }
  return Int(header[r.upperBound...].prefix { $0.isNumber })
}
func headerDefine(_ d: String) -> Int? {
  guard let r = header.range(of: "#define \(d) ") else { return nil }
  return Int(header[r.upperBound...].drop { $0 == " " }.prefix { $0.isNumber })
}
let L = HeliShaderLayout.self
for (t, slots) in [("MDWxParams", L.wxSlots), ("MDHullUniforms", L.hullSlots), ("MDRotorUniforms", L.rotorSlots),
                   ("MDHeliLightsUniforms", L.lightsSlots), ("MDConeUniforms", L.coneSlots), ("MDCableUniforms", L.cableSlots),
                   ("MDRingUniforms", L.ringSlots), ("MDHeliPropMaterial", L.propSlots)] {
  check(headerSize(t) == slots * 16, "\(t): header \(headerSize(t) ?? -1) B, Swift \(slots) slots")
}
for (d, v) in [("MD_HULL_GLOWS", L.hullGlows), ("MD_LIGHT_CHANNELS", L.lightChannels), ("MD_CABLE_POINTS", L.cablePoints),
               ("MD_RING_VERTICES", L.ringVertices), ("MD_HELI_ATTR_CORNER", L.attrCorner), ("MD_HELI_ATTR_CHAN", L.attrChan),
               ("MD_HELI_ATTR_SIZE", L.attrSize), ("MD_HELI_ATTR_SIDE", L.attrSide), ("MD_HELI_ATTR_DIR", L.attrDir),
               ("MD_HELI_ATTR_V", L.attrV), ("MD_HELI_ATTR_ANG", L.attrAng), ("MD_HELI_ATTR_EDGE", L.attrEdge),
               ("MD_TEX_HELI_DECAL", L.texDecal), ("MD_SMP_HELI_DECAL", L.samplerDecal), ("MD_FC_HELI_VCOLOR", L.fcVertexColor)] {
  check(headerDefine(d) == v, "\(d): header \(headerDefine(d) ?? -1), Swift \(v)")
}

// ---- 4. a real Helicopter → snapshot → GPU inputs -------------------------------------------------------------
let ctx = SimContext(events: EventBus())
let heli = Helicopter(ctx: ctx)
heli.start()
for _ in 0..<90 { heli.update(1.0 / 60) }
for q in ["low", "high"] {
  let s = HeliRenderSnapshot(heli: heli, quality: q)
  let pose = HeliPose(s)
  if let hm = metas["heli_hull"] {
    let w = HeliTransforms.world(hm, pose: pose)
    var same = true
    for e in 0..<16 where w[e].bitPattern != s.visual.bodyMatrix[e].bitPattern { same = false }
    check(same, "\(q): hull matrixWorld = body.matrixWorld")
  }
  check(s.lowQuality == (q == "low"), "\(q): disc variant")
  check(s.lightChannels.count == L.lightChannels && s.glowPos.count == L.hullGlows, "\(q): light arrays")
  if metas.count == HeliMeshes.names.count {
    do {
      let blocks: [(String, [SIMD4<Float>])] = [
        ("hull", try HeliHullMaterial(meta: meta("heli_hull")).uniforms(s, receiveShadow: true)),
        ("rotor", try HeliRotorMaterial(meta: meta("heli_rotor_main")).uniforms(s.visual.rotor, s.visual.veil)),
        ("tail", try HeliRotorMaterial(meta: meta("heli_rotor_tail")).uniforms(s.visual.tail, s.visual.veil)),
        ("lights", try HeliLightsMaterial(meta: meta("heli_lights")).uniforms(s)),
        ("cone", try HeliConeMaterial(meta: meta("heli_searchlight_cone")).uniforms(s.cone)),
        ("cable", try HeliCableMaterial(meta: meta("heli_cable")).uniforms(s.winch)),
        ("ring", try HeliRingMaterial(meta: meta("heli_ring")).uniforms(s.winch)),
        ("prop", try HeliPropMaterialParams(meta: meta("heli_basket")).uniforms(receiveShadow: false)),
      ]
      for (n, b) in blocks { check(b.allSatisfy { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite && $0.w.isFinite }, "\(q) \(n): finite uniforms") }
      let hull = blocks[0].1
      check(hull[4] == SIMD4<Float>(Float(s.visual.hull.rim.r), Float(s.visual.hull.rim.g), Float(s.visual.hull.rim.b), Float(s.visual.hull.sunScale)),
            "\(q): hull slot 4 = uRim, uSunScale")
      check(blocks[1].1[0].x == Float(s.visual.rotor.blade), "\(q): rotor slot 0.x = uBlade")
    } catch {
      check(false, "\(q): uniforms: \(error)")
    }
  }
  let spot = s.searchlightLight, belly = s.bellyLight
  check(spot.coneCos.isFinite && spot.coneCos < 1 && spot.penumbraCos > spot.coneCos && spot.distance == 300, "\(q): searchlight spot[0]")
  check(belly.distance == 90 && belly.position.y.isFinite, "\(q): belly point[0]")
}

// ---- 5. planner ------------------------------------------------------------------------------------------------
var infos: [String: MMeshInfo] = [:]
for name in HeliMeshes.names {
  if let b = try? catalog.bytes(path: MMeshLoader.manifestPath(name), verify: true), let f = try? MMeshFile(bytes: b) {
    infos[name] = try? MMeshInfo(file: f)
  }
}
do {
  let planner = try HeliPlanner(infos: infos)
  let hp = heli.position
  func viewProj(_ eye: SIMD3<Double>, _ target: SIMD3<Double>) -> simd_double4x4 {
    let cm = CameraMatrices(camera: CameraState(position: eye, target: target), aspect: 16.0 / 9.0)
    return cm.projGL * cm.view
  }
  let onHeli = viewProj(SIMD3<Double>(hp.x, hp.y + 200, hp.z + 60), SIMD3<Double>(hp.x, hp.y, hp.z))
  var s = HeliRenderSnapshot(heli: heli, quality: "high")
  // everything out: winch, crew, searchlight, bags, a flare, a raft
  s.winch.cableVisible = true
  s.winch.basketVisible = true
  s.winch.rescuerVisible = true
  s.winch.ringVisible = true
  s.crew.visible = true
  s.cone.visible = true
  s.cone.position = hp
  s.visual.floatsVisible = true
  s.visual.shadowBladesVisible = true
  s.visual.heatVisible = true
  s.visual.flares[1] = V3(hp.x + 5, hp.y - 10, hp.z)
  s.visual.rafts[0] = (position: V3(hp.x, hp.y - 5, hp.z), rotation: V3(0.1, 0.2, 0.3))
  s.winch.basketPosition = V3(hp.x + 2, hp.y - 10, hp.z)
  s.winch.rescuerPosition = V3(hp.x + 2, hp.y - 9, hp.z)
  let plan = planner.plan(s, viewProjGL: onHeli)
  let opaqueNames = plan.opaque.map(\.mesh)
  for n in ["heli_hull", "heli_hub", "heli_cable", "heli_basket", "heli_rescuer", "heli_crew_body", "heli_crew_arm", "heli_crew_head",
            "heli_flare", "heli_raft_pack"] {
    check(opaqueNames.contains(n), "plan: opaque has \(n) (\(opaqueNames))")
  }
  check(opaqueNames.filter { $0 == "heli_float" }.count == 2, "plan: two flotation bags")
  check(!opaqueNames.contains("heli_blades_shadow") && !opaqueNames.contains("heli_heat_bay"), "plan: layer 1 / 2 objects stay out of the main pass")
  let tr = plan.transparent.map(\.mesh)
  check(tr == ["heli_ring", "heli_rotor_main", "heli_rotor_tail", "heli_lights", "heli_searchlight_cone"] ||
        tr == ["heli_ring", "heli_rotor_tail", "heli_rotor_main", "heli_lights", "heli_searchlight_cone"],
        "plan: transparent order by renderOrder 3 · 4 · 4 · 5 · 6: \(tr)")
  for i in 1..<max(1, plan.opaque.count) { check(RenderList.opaqueOrder(plan.opaque[i - 1].item, plan.opaque[i].item), "plan: opaque sorted at \(i)") }
  for i in 1..<max(1, plan.transparent.count) { check(RenderList.transparentOrder(plan.transparent[i - 1].item, plan.transparent[i].item), "plan: transparent sorted at \(i)") }
  let expected: [HeliDrawKind: Int] = [.hull: L.hullSlots, .rotor: L.rotorSlots, .lights: L.lightsSlots, .cone: L.coneSlots, .cable: L.cableSlots,
                                       .ring: L.ringSlots, .basic: L.propSlots, .prop(vertexColors: true): L.propSlots, .prop(vertexColors: false): L.propSlots]
  for d in plan.opaque + plan.transparent {
    check(d.uniforms.count == expected[d.kind], "plan: \(d.mesh) uniform block \(d.uniforms.count) slots")
  }
  check(plan.transparent.first { $0.mesh == "heli_lights" }?.blend == .additive && plan.transparent.first { $0.mesh == "heli_rotor_main" }?.blend == .alpha,
        "plan: lamps additive, rotor alpha")
  check(plan.opaque.first { $0.mesh == "heli_cable" }?.culling == FaceCulling.none, "plan: cable double-sided")
  let casterNames = Set(plan.casters.map(\.mesh))
  check(casterNames.isSuperset(of: ["heli_hull", "heli_hub", "heli_blades_shadow", "heli_float", "heli_basket", "heli_crew_body"]), "plan: casters \(casterNames)")
  check(!casterNames.contains("heli_lights") && !casterNames.contains("heli_heat_bay"), "plan: lamps / heat proxies cast no shadow")
  let bl = plan.casters.first { $0.mesh == "heli_blades_shadow" }?.layers ?? []
  check(bl.contains(.shadowOnly) && !bl.contains(.main), "plan: blades on the shadow-only layer (not main)")
  let heat = plan.thermal.filter { $0.heat > 0 }.map(\.mesh), mass = plan.thermal.filter { $0.thermalMass > 0 }.map(\.mesh)
  check(heat.filter { $0 == "heli_heat_bay" }.count == 2 && heat.filter { $0 == "heli_heat_plume" }.count == 2 && heat.contains("heli_crew_head") && heat.contains("heli_flare"),
        "plan: heat sources \(heat)")
  check(mass.contains("heli_hull") && mass.contains("heli_hub") && mass.contains("heli_float"), "plan: thermal mass \(mass)")
  // the camera looking away: frustum-culled objects drop out, the frustumCulled = false ones stay
  let away = viewProj(SIMD3<Double>(hp.x, hp.y + 200, hp.z + 60), SIMD3<Double>(hp.x + 5000, hp.y + 200, hp.z + 5000))
  let p2 = planner.plan(s, viewProjGL: away)
  check(!p2.opaque.contains { $0.mesh == "heli_hull" } && !p2.transparent.contains { $0.mesh == "heli_rotor_main" }, "plan: culled when out of view")
  check(p2.transparent.contains { $0.mesh == "heli_lights" } && p2.transparent.contains { $0.mesh == "heli_ring" } && p2.opaque.contains { $0.mesh == "heli_cable" },
        "plan: lamps, ring, cable are never frustum-culled (frustumCulled false in the web)")
  check(p2.casters.count == plan.casters.count, "plan: casters are culled by the shadow pass, not the main camera")
  // low quality: the 48-segment disc
  let low = planner.plan(HeliRenderSnapshot(heli: heli, quality: "low"), viewProjGL: onHeli)
  check(low.transparent.contains { $0.mesh == "heli_rotor_main_low" } && !low.transparent.contains { $0.mesh == "heli_rotor_main" }, "plan: low quality disc")
} catch {
  check(false, "planner: \(error)")
}

print("render-check: \(checks - failures)/\(checks) checks ok, \(compared) matrices compared with three's matrixWorld")
if failures > 0 {
  print("render-check: \(failures) FAILED")
  exit(1)
}
