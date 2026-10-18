// bake-meshes: the web's hand-built procedural meshes → Resources/Meshes/*.mmesh (PLAN D6, §6;
// format: tools/meshfmt/SPEC.md).
//
// The geometry is never re-implemented: the REAL web objects are constructed in Node 22 (shims/loader.mjs:
// three → rescue/vendor/three, browser stubs) and their BufferGeometry arrays are written as they are.
// Helicopter «Чайка-07» (systems/heli.js + heli/model.js, shapes.js, crewman.js, winch.js, searchlight.js):
//   hull, rotor hub, lights (bulbs + halo quads), main rotor disc (72 segments; `_low` 48 for quality low),
//   tail rotor disc, shadow-only blades, flotation bag, thermal heat proxies (engine bay, exhaust plume),
//   hoist operator (body, pointing arm, head), rescue basket, rescue swimmer, cable ribbon and reach ring
//   topology (positions are per-frame), searchlight cone proxy, thrown flare ember, packed life raft.
// Each file's meta block carries the object's local transform chain, render flags, material parameters
// (incl. the hull's weathering uniforms, produced by running the material's own onBeforeCompile) and the
// thermal-view flags (systems/post/thermal.js _promoteHeat run on the built model).
//
// Usage: node rescue-apple/tools/export/bake-meshes.mjs [--out <dir>]
//        (verify: node rescue-apple/tools/meshfmt/verify.mjs --web)
import { gameImport, scopeOf } from './shims/loader.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { APPLE, REPO, gitInfo, writeManifest, writeWrapped, relSrc } from './lib/common.mjs';
import { writeMMesh } from '../meshfmt/write.mjs';

export const PRODUCER = 'tools/export/bake-meshes.mjs';
export const MESH_DIR = path.join(APPLE, 'Resources/Meshes');

const THREE = await import('three');
const { Look } = await gameImport('core/look.js');
const { EventBus } = await gameImport('core/events.js');
const { Helicopter } = await gameImport('systems/heli.js');
const { ThermalView } = await gameImport('systems/post/thermal.js');
const thermalScope = (await scopeOf('systems/post/thermal.js')).scope;
const mathModule = await gameImport('core/math.js');
// three's MeshPhysicalMaterial program text (only its #include tokens matter to the web's patches)
const ShaderLib = (await import(pathToFileURL(path.join(REPO, 'rescue/vendor/three/three.module.min.js')).href)).ShaderLib;

const SIDES = { [THREE.FrontSide]: 'front', [THREE.BackSide]: 'back', [THREE.DoubleSide]: 'double' };
const BLENDING = { [THREE.NoBlending]: 'none', [THREE.NormalBlending]: 'normal', [THREE.AdditiveBlending]: 'additive', [THREE.SubtractiveBlending]: 'subtractive', [THREE.MultiplyBlending]: 'multiply', [THREE.CustomBlending]: 'custom' };

// ------------------------------------------------------------------------------------------ helpers
const f = (x) => x; // numbers go to JSON as JS numbers (shortest round-trip form)
const vec = (v) => (v.isVector2 ? [v.x, v.y] : v.isVector4 || v.isQuaternion ? [v.x, v.y, v.z, v.w] : [v.x, v.y, v.z]);

function uniformValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v?.isColor) return { lin: [f(v.r), f(v.g), f(v.b)] };
  if (v?.isVector2 || v?.isVector3 || v?.isVector4 || v?.isQuaternion) return vec(v);
  if (v instanceof Float32Array || Array.isArray(v)) return Array.from(v, (x) => (typeof x === 'number' ? x : uniformValue(x)));
  return undefined; // textures, matrices: not data
}

// The material's own parameters plus the uniforms it owns (shared look uniforms are global state, skipped).
function materialMeta(mat, shared) {
  const m = { type: mat.type };
  for (const k of ['color', 'emissive']) if (mat[k]?.isColor) m[k] = [mat[k].r, mat[k].g, mat[k].b];
  for (const k of ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'ior', 'specularIntensity', 'emissiveIntensity', 'envMapIntensity']) {
    if (typeof mat[k] === 'number') m[k] = mat[k];
  }
  if (mat.specularColor?.isColor) m.specularColor = [mat.specularColor.r, mat.specularColor.g, mat.specularColor.b];
  m.vertexColors = !!mat.vertexColors;
  m.transparent = !!mat.transparent;
  m.opacity = mat.opacity;
  m.depthWrite = mat.depthWrite;
  m.depthTest = mat.depthTest;
  m.side = SIDES[mat.side];
  m.blending = BLENDING[mat.blending];
  m.fog = mat.fog !== false;
  const owned = {};
  const add = (name, u) => {
    if (shared.has(u)) return;
    const v = uniformValue(u.value);
    if (v !== undefined) owned[name] = v;
  };
  for (const [name, u] of Object.entries(mat.uniforms || {})) add(name, u);
  for (const [name, u] of Object.entries(mat.userData?.uniforms || {})) add(name, u);
  for (const [name, u] of Object.entries(mat.userData?.weathering || {})) add(name, u);
  if (Object.keys(owned).length) m.uniforms = owned;
  return m;
}

// Local transforms from the model root (child of the scene) down to the mesh, with a role per node.
function chainOf(obj, roles) {
  const chain = [];
  for (let o = obj; o && !o.isScene; o = o.parent) {
    chain.unshift({
      role: roles.get(o) || null,
      name: o.name || null,
      position: vec(o.position),
      quaternion: vec(o.quaternion),
      scale: vec(o.scale),
    });
  }
  return chain;
}

function geometryArrays(g) {
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  const attributes = Object.entries(g.attributes).map(([name, a]) => {
    if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array)) throw new Error(`bake: ${name}: only plain Float32 attributes`);
    return { name, array: a.array, components: a.itemSize };
  });
  const index = g.index ? Uint32Array.from(g.index.array) : null;
  const total = index ? index.length : g.attributes.position.count;
  const start = Math.min(g.drawRange.start, total);
  const count = Math.min(g.drawRange.count, total - start);
  const s = g.boundingSphere;
  const b = g.boundingBox;
  return {
    attributes,
    index,
    ranges: [{ name: 'main', start, count }],
    bounds: { sphere: [s.center.x, s.center.y, s.center.z, s.radius], box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] },
    web: { vertexCount: g.attributes.position.count, indexed: !!g.index, triangles: total / 3 },
  };
}

function sameGeometry(a, b) {
  const ka = Object.keys(a.attributes), kb = Object.keys(b.attributes);
  if (ka.join() !== kb.join()) return false;
  for (const k of ka) {
    const x = a.attributes[k].array, y = b.attributes[k].array;
    if (x.length !== y.length || !Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength))) return false;
  }
  if (!!a.index !== !!b.index) return false;
  return !a.index || a.index.array.join() === b.index.array.join();
}

// ------------------------------------------------------------------------------------------ the heli
// Construct the web Helicopter on a minimal stub context (no world, no weather: construction only).
function buildHeli(quality) {
  const look = new Look(7);
  const settings = { quality };
  const ctx = {
    scene: new THREE.Scene(), look, events: new EventBus(), mode: 'title', params: new URLSearchParams(''),
    settings: { get: (k) => settings[k], onChange: () => {}, detail: () => 1 },
    input: { mouse: {} }, camera: new THREE.PerspectiveCamera(40, 16 / 9, 2, 1200),
    renderer: { domElement: { clientWidth: 1280, clientHeight: 720 } },
  };
  const h = new Helicopter(ctx);
  h._applyQuality();
  // the hull material's onBeforeCompile (shared weathering + hull patches) — run on three's physical
  // program text so mat.userData.weathering holds the web's weathering uniforms
  const hm = h.model.hullMat;
  hm.onBeforeCompile({ uniforms: {}, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, defines: {} });
  ctx.scene.updateMatrixWorld(true);
  // thermal view sweep (userData.heat → layer 2, solid airframe → layer 3), the web's own rule
  ThermalView.prototype._promoteHeat.call({ ctx: { scene: ctx.scene, world: null, heli: h } });
  return { h, ctx, look };
}

function roleMap(h) {
  const m = h.model;
  const roles = new Map([
    [m.root, 'root'], [m.body, 'body'], [m.hull, 'hull'], [m.lights, 'lights'], [m.rotorPivot, 'rotorPivot'],
    [m.hub, 'hub'], [m.rotor, 'rotor'], [m.tail, 'tailRotor'], [m.blades, 'blades'],
    [h.crewman.group, 'crewman'], [h.crewman.body, 'crewBody'], [h.crewman.arm, 'crewArm'], [h.crewman.head, 'crewHead'],
    [h.winchCtl.basketMesh, 'basket'], [h.winchCtl.rescuer, 'rescuer'], [h.winchCtl.cable, 'cable'], [h.winchCtl.ring, 'ring'],
    [h.searchlightCtl.cone, 'cone'],
  ]);
  for (const f of m.floats) roles.set(f, 'float');
  for (const f of h.flareMeshes) roles.set(f, 'flare');
  for (const r of h.raftMeshes) roles.set(r, 'raftPack');
  h.heatProxies.forEach((p, i) => roles.set(p, i % 2 ? 'heatPlume' : 'heatBay'));
  return roles;
}

// The baked meshes and the web objects drawn with each (one file per geometry), construction order.
function meshList(h, low) {
  const m = h.model;
  return [
    ['heli_hull', [m.hull]],
    ['heli_hub', [m.hub]],
    ['heli_lights', [m.lights]],
    ['heli_rotor_main', [m.rotor]],
    ['heli_rotor_main_low', [low.model.rotor], low],
    ['heli_rotor_tail', [m.tail]],
    ['heli_blades_shadow', [m.blades]],
    ['heli_float', m.floats],
    ['heli_heat_bay', h.heatProxies.filter((_, i) => i % 2 === 0)],
    ['heli_heat_plume', h.heatProxies.filter((_, i) => i % 2 === 1)],
    ['heli_crew_body', [h.crewman.body]],
    ['heli_crew_arm', [h.crewman.arm]],
    ['heli_crew_head', [h.crewman.head]],
    ['heli_basket', [h.winchCtl.basketMesh]],
    ['heli_rescuer', [h.winchCtl.rescuer]],
    ['heli_cable', [h.winchCtl.cable]],
    ['heli_ring', [h.winchCtl.ring]],
    ['heli_searchlight_cone', [h.searchlightCtl.cone]],
    ['heli_flare', h.flareMeshes],
    ['heli_raft_pack', h.raftMeshes],
  ].map(([name, objects, owner = h]) => ({ name, objects, owner }));
}

/**
 * Every heli mesh as { name, objects, mesh (encodeMMesh input) } — also used by tools/meshfmt/verify.mjs
 * --web to compare the files with the live geometry.
 */
export function heliMeshes() {
  const hi = buildHeli('high');
  const lo = buildHeli('low');
  const { h } = hi;
  const shared = new Set([...Object.values(hi.look.uniforms), ...Object.values(lo.look.uniforms)]);
  const list = meshList(h, lo.h);
  const g = gitInfo();
  const out = [];
  for (const { name, objects, owner } of list) {
    const roles = roleMap(owner);
    const o0 = objects[0];
    for (const o of objects.slice(1)) {
      if (!sameGeometry(o0.geometry, o.geometry)) throw new Error(`bake: ${name}: the objects do not share one geometry`);
      if (o.material !== o0.material && JSON.stringify(materialMeta(o.material, shared)) !== JSON.stringify(materialMeta(o0.material, shared))) {
        throw new Error(`bake: ${name}: the objects have different materials`);
      }
    }
    const geo = geometryArrays(o0.geometry);
    const layers = o0.layers.mask;
    const heat = thermalScope.HEAT, mass = thermalScope.MASS;
    const ud = o0.userData || {};
    const thermal = o0.layers.isEnabled(heat)
      ? { heat: Number.isFinite(ud.heat) ? ud.heat : 1 }
      : o0.layers.isEnabled(mass) ? { mass: Number.isFinite(ud.thermMass) ? ud.thermMass : thermalScope.MASS_DEFAULT } : null;
    const meta = {
      name,
      source: { web: g.rev, dirty: g.dirty, module: moduleOf(name), object: o0.name || roles.get(o0) },
      chains: objects.map((o) => chainOf(o, roles)),
      object: {
        renderOrder: o0.renderOrder, layers, castShadow: o0.castShadow, receiveShadow: o0.receiveShadow,
        frustumCulled: o0.frustumCulled, visible: o0.visible,
      },
      material: materialMeta(o0.material, shared),
      thermal,
      web: geo.web,
    };
    out.push({ name, objects, mesh: { attributes: geo.attributes, index: geo.index, ranges: geo.ranges, bounds: geo.bounds, meta } });
  }
  return out;
}

function moduleOf(name) {
  if (/crew/.test(name)) return 'systems/heli/crewman.js';
  if (/basket|rescuer|cable|ring/.test(name)) return 'systems/heli/winch.js';
  if (/cone/.test(name)) return 'systems/heli/searchlight.js';
  if (/heat|flare|raft/.test(name)) return 'systems/heli.js';
  return 'systems/heli/model.js';
}

// --------------------------------------------------------------------------------- transform vectors
// Parity vector for MaydayRender's HeliTransforms: deterministic poses applied to the REAL web model the
// way systems/heli.js _visuals, crewman.js, winch.js render(), searchlight.js and heli.js (flares, rafts)
// write them, then three's scene.updateMatrixWorld(true); every baked object's matrixWorld is recorded.
// The Swift check rebuilds each matrix from the baked chains + the recorded pose and compares bitwise.
export const TRANSFORMS_VECTOR = path.join(APPLE, 'tools/meshfmt/vectors/heli_transforms.json');

export function heliTransformVectors(poseCount = 6) {
  const M = mathModule;
  const rng = M.createRng(424242);
  const r = (a, b) => a + (b - a) * rng.next();
  const unitQuat = () => new THREE.Quaternion(r(-1, 1), r(-1, 1), r(-1, 1), r(-1, 1)).normalize();
  const v3 = (s) => new THREE.Vector3(r(-s, s), r(0, s), r(-s, s));
  const builds = { high: buildHeli('high'), low: buildHeli('low') };
  const poses = [];
  for (let k = 0; k < poseCount; k++) {
    const P = {
      position: v3(400), heading: r(-Math.PI, Math.PI), pitch: r(-0.4, 0.4), bank: r(-0.4, 0.4),
      hubAngle: r(0, 200), shadowAngle: r(0, 300), floatScale: [r(0.3, 1), r(0.3, 1), r(0.6, 1)],
      crewPosition: [1.12 - 0.55 * r(0, 1), -0.9, -0.9], crewArm: unitQuat(), crewHead: unitQuat(),
      basketPosition: v3(300), basketQuaternion: unitQuat(), rescuerPosition: v3(300), rescuerQuaternion: unitQuat(),
      conePosition: v3(300), coneQuaternion: unitQuat(), coneScale: [r(1, 20), r(5, 120), r(1, 20)],
      flares: [v3(300), v3(300), v3(300), v3(300)],
      rafts: [0, 1].map(() => ({ position: v3(300), spin: r(-20, 20) })),
    };
    const objects = {};
    let rootMatrix = null, bodyMatrix = null;
    for (const [q, { h, ctx }] of Object.entries(builds)) {
      const m = h.model;
      m.root.position.copy(P.position);
      m.root.rotation.set(0, -P.heading, 0);
      m.body.rotation.set(P.pitch, 0, -P.bank);
      m.rotorPivot.rotation.set(P.pitch * 0.3, 0, -P.bank * 0.3);
      m.hub.rotation.y = P.hubAngle;
      m.blades.rotation.y = -P.shadowAngle;
      for (const f of m.floats) f.scale.set(...P.floatScale);
      h.crewman.group.position.set(...P.crewPosition);
      h.crewman.arm.quaternion.copy(P.crewArm);
      h.crewman.head.quaternion.copy(P.crewHead);
      h.winchCtl.basketMesh.position.copy(P.basketPosition);
      h.winchCtl.basketMesh.quaternion.copy(P.basketQuaternion);
      h.winchCtl.rescuer.position.copy(P.rescuerPosition);
      h.winchCtl.rescuer.quaternion.copy(P.rescuerQuaternion);
      const cone = h.searchlightCtl.cone;
      cone.position.copy(P.conePosition);
      cone.quaternion.copy(P.coneQuaternion);
      cone.scale.set(...P.coneScale);
      h.flareMeshes.forEach((f, i) => f.position.copy(P.flares[i]));
      h.raftMeshes.forEach((f, i) => {
        const d = P.rafts[i];
        f.position.copy(d.position);
        f.rotation.set(d.spin * 0.7, d.spin, d.spin * 0.4);
      });
      ctx.scene.updateMatrixWorld(true);
      if (q === 'high') {
        rootMatrix = m.root.matrixWorld.elements.slice();
        bodyMatrix = m.body.matrixWorld.elements.slice();
      }
      for (const { name, objects: objs } of meshList(h, builds.low.h)) {
        if ((name === 'heli_rotor_main_low') !== (q === 'low')) continue;
        objects[name] = objs.map((o) => o.matrixWorld.elements.slice());
      }
    }
    poses.push({
      pose: {
        rootMatrix, bodyMatrix, pitch: P.pitch, bank: P.bank, hubAngle: P.hubAngle, shadowBladesAngle: -P.shadowAngle,
        floatScale: P.floatScale, crewPosition: P.crewPosition, crewArm: vec(P.crewArm), crewHead: vec(P.crewHead),
        basketPosition: vec(P.basketPosition), basketQuaternion: vec(P.basketQuaternion),
        rescuerPosition: vec(P.rescuerPosition), rescuerQuaternion: vec(P.rescuerQuaternion),
        conePosition: vec(P.conePosition), coneQuaternion: vec(P.coneQuaternion), coneScale: P.coneScale,
        flares: P.flares.map(vec), rafts: P.rafts.map((d) => ({ position: vec(d.position), rotation: [d.spin * 0.7, d.spin, d.spin * 0.4] })),
      },
      matrixWorld: objects,
    });
  }
  return {
    setup: 'bake-meshes buildHeli(high | low); per pose: root.position / rotation (0, −heading, 0), body.rotation (pitch, 0, −bank), ' +
      'rotorPivot.rotation (0.3·pitch, 0, −0.3·bank), hub.rotation.y, blades.rotation.y, floats.scale, crewman group position / arm / head ' +
      'quaternion, basket / rescuer position + quaternion, cone position / quaternion / scale, flare positions, raft position + rotation ' +
      '(0.7·spin, spin, 0.4·spin); scene.updateMatrixWorld(true). matrixWorld[mesh][object] = Matrix4.elements (column-major)',
    poses,
  };
}

// ------------------------------------------------------------------------------------------ main
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.warn = () => {};
  const argv = process.argv.slice(2);
  const outDir = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : MESH_DIR;
  const meshes = heliMeshes();
  fs.mkdirSync(outDir, { recursive: true });
  const written = new Set();
  for (const { name, mesh } of meshes) {
    const r = writeMMesh(path.join(outDir, `${name}.mmesh`), mesh);
    written.add(`${name}.mmesh`);
    console.log(`${name.padEnd(24)} ${String(r.vertexCount).padStart(5)} v ${String(r.indexCount / 3).padStart(5)} tris ${String(r.bytes).padStart(7)} B  ${r.sha256.slice(0, 12)}`);
  }
  // a stale heli file from an older bake would ship unchecked: heli_* holds exactly what was baked
  for (const f of fs.readdirSync(outDir)) if (/^heli_.*\.mmesh$/.test(f) && !written.has(f)) fs.rmSync(path.join(outDir, f));
  if (outDir === MESH_DIR) writeManifest({ keepRevision: true }); // mesh entries only; the data's revision stamp stays
  if (outDir === MESH_DIR) {
    const v = writeWrapped(TRANSFORMS_VECTOR, {
      schema: 'mayday.vectors.render.heli_transforms', version: 1, producer: PRODUCER,
      files: ['systems/heli.js', 'systems/heli/model.js', 'systems/heli/crewman.js', 'systems/heli/winch.js', 'systems/heli/searchlight.js'].map(relSrc),
      extra: { tolerance: { class: 'bitwise', note: 'every matrix element: Double.bitPattern equal (three Matrix4.compose / multiplyMatrices)' } },
      data: heliTransformVectors(),
    });
    console.log(`vector ${v.path} ${v.bytes} B`);
  }
  if (gitInfo().dirty) console.log('note: rescue/ is dirty — do not commit this bake (sourceDirty)');
}
