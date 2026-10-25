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
// The sea scene of op1 (sceneMeshes below; a real World / Survivors / Effects on stub contexts):
//   world      lighthouse «Скалистый» prop mesh per quality (`lighthouse_<q>`: the structures are seated on that
//              quality's island terrain), its double beam, the lamp and collar instance quads, the rigging stick,
//              every floating-prop shape and buoy kind (`floater_*`), the island's three vegetation card meshes
//   survivors  the person (crowd + ghost + keyline materials), every craft model (`craft_*`), collar and glow quads
//   fx         the gull, the thermal heat sphere, the particle / glow / ring / rain / mote quads (their
//              materials' own uniforms), dolphin and whale
// Instanced attributes (per-frame data) are never baked; geometry ranges keep three's drawRange and the
// shadow LOD (geometry.userData.shadowRange → range `shadow`).
//
// Usage: node rescue-apple/tools/export/bake-meshes.mjs [--out <dir>] [--canvas]
//        (--canvas: also the two canvas textures, through headless Chromium — see bakeCanvases)
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

// ------------------------------------------------------------------------------------- the sea scene
// World / Survivors / Effects are constructed on stub contexts (construction + op1's mission:setup only; the
// stubs answer what the constructors ask: flat sea, no weather, no heli). Only the objects' geometry, local
// transforms, render flags and material parameters are read.
const { World } = await gameImport('systems/world.js');
const { CAMPAIGN } = await gameImport('systems/mission/campaign.js');
const { prepareDef } = await gameImport('systems/mission/prepare.js');
const { Survivors } = await gameImport('systems/survivors.js');
const { Effects } = await gameImport('systems/fx.js');
const floatersScope = (await scopeOf('systems/world/floaters.js')).scope;
const vegScope = (await scopeOf('systems/world/vegetation.js')).scope;

export const SCENE_QUALITIES = ['high', 'medium', 'low'];
// file-name prefixes the scene bake owns (stale files of an older bake are removed, verify checks them)
export const SCENE_PREFIXES = ['lighthouse_', 'world_', 'floater_', 'veg_', 'surv_', 'craft_', 'fx_'];

function stubSettings(quality) {
  const vals = { quality, difficulty: 'pilot', reduceFlashes: false };
  return { get: (k) => vals[k], set: (k, v) => { vals[k] = v; }, onChange: () => {}, detail: () => 1 };
}

function sceneCtx(quality) {
  const camera = new THREE.PerspectiveCamera(40, 1280 / 720, 2, 1200);
  camera.position.set(0, 220, 60);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8899aa, 200, 900);
  const ctx = {
    THREE, look: new Look(7), scene, camera, settings: stubSettings(quality), events: new EventBus(), mode: 'play',
    time: { t: 0, dt: 0, frame: 0 }, params: new URLSearchParams(''),
  };
  ctx.ocean = {
    heightAt: () => 0, normalAt: (x, z, out) => (out || new THREE.Vector3()).set(0, 1, 0), searchlightAt: () => 0,
    velocityAt: (x, z, out) => (out || new THREE.Vector3()).set(0, 0, 0), stamp() {}, setShoals() {}, applyTerrain() {},
  };
  return ctx;
}

// A real World after init() and op1's mission:setup (the lighthouse is built on `quality`'s island terrain).
function buildWorld(quality) {
  const ctx = sceneCtx(quality);
  const world = new World(ctx);
  ctx.world = world;
  world.init();
  ctx.events.emit('mission:setup', { def: prepareDef(CAMPAIGN[0], { index: 0 }) });
  // one bank per floating-prop shape and buoy kind (op1 uses some; the files cover them all)
  const shapes = Object.keys(floatersScope.SHAPES).filter((s) => !floatersScope.SHAPES[s].craft);
  for (const s of shapes) world.floaters._bank(s, 1);
  for (const k of floatersScope.BUOY_KINDS) world.floaters._bank(`buoy:${k}`, 1);
  ctx.scene.updateMatrixWorld(true);
  return { world, ctx, shapes };
}

// Real Survivors + Effects (construction only).
function buildSea() {
  const ctx = sceneCtx('high');
  const survivors = new Survivors(ctx);
  ctx.survivors = survivors;
  const fx = new Effects(ctx);
  ctx.scene.updateMatrixWorld(true);
  return { survivors, fx, ctx };
}

// The geometry's own (non-instanced) attributes, optionally a subset, with three's drawRange and shadow LOD.
function sceneGeometry(g, keep = null) {
  const src = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.isInstancedBufferAttribute) continue;
    if (keep && !keep.includes(name)) continue;
    src.setAttribute(name, a);
  }
  if (g.index) src.setIndex(g.index);
  src.drawRange = g.drawRange;
  src.boundingSphere = g.boundingSphere;
  src.boundingBox = g.boundingBox;
  const out = geometryArrays(src);
  const sr = g.userData?.shadowRange;
  if (sr) out.ranges.push({ name: 'shadow', start: sr[0], count: sr[1] });
  out.geometry = src;
  return out;
}

// The material's parameters for the scene families: materialMeta + what the families branch on — the
// material's own `defines`, alphaTest, map presence, three's program cache key (onBeforeCompile options such
// as the craft lamp lift / debris / fouling show up there), and the uniforms its onBeforeCompile adds
// (weathering presets) when it is run on three's standard program text.
const SKIP_UNIFORM = /^fog|^uWxAtlas$|^uWxWet$/;
function sceneMaterialMeta(mat, shared) {
  const m = materialMeta(mat, shared);
  if (mat.defines && Object.keys(mat.defines).length) m.defines = { ...mat.defines };
  if (mat.alphaTest) m.alphaTest = mat.alphaTest;
  if (mat.map) m.map = true;
  if (typeof mat.customProgramCacheKey === 'function' && mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) {
    m.programKey = mat.customProgramCacheKey();
  }
  if (mat.polygonOffset) m.polygonOffset = [mat.polygonOffsetFactor, mat.polygonOffsetUnits];
  if (typeof mat.onBeforeCompile === 'function' && mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    const lib = mat.type === 'MeshDepthMaterial' ? ShaderLib.depth : ShaderLib.standard;
    const sh = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: {} };
    mat.onBeforeCompile(sh, null);
    const patched = {};
    for (const [name, u] of Object.entries(sh.uniforms)) {
      if (shared.has(u) || SKIP_UNIFORM.test(name) || (m.uniforms && name in m.uniforms)) continue;
      const v = uniformValue(u?.value);
      if (v !== undefined) patched[name] = v;
    }
    if (Object.keys(patched).length) m.uniforms = { ...(m.uniforms || {}), ...patched };
    if (Object.keys(sh.defines).length) m.defines = { ...(m.defines || {}), ...sh.defines };
  }
  for (const k of Object.keys(m.uniforms || {})) if (SKIP_UNIFORM.test(k)) delete m.uniforms[k];
  return m;
}

// One scene mesh: geometry of objects[0] (the objects share it), meta like the heli's plus `extra`.
function sceneEntry(name, objects, { shared, module, keep = null, material = null, extra = null, geometry = null }) {
  const o0 = objects[0];
  const geo = sceneGeometry(geometry || o0.geometry, keep);
  const roles = new Map();
  const mat = material || o0.material;
  const meta = {
    name,
    source: { web: GIT.rev, dirty: GIT.dirty, module, object: o0.name || null },
    chains: objects.map((o) => chainOf(o, roles)),
    object: {
      renderOrder: o0.renderOrder, layers: o0.layers.mask, castShadow: o0.castShadow, receiveShadow: o0.receiveShadow,
      frustumCulled: o0.frustumCulled, visible: o0.visible,
    },
    material: sceneMaterialMeta(mat, shared),
    thermal: o0.layers.isEnabled(thermalScope.HEAT) ? { heat: Number.isFinite(o0.userData?.heat) ? o0.userData.heat : 1 } : null,
    web: geo.web,
  };
  if (o0.customDepthMaterial) meta.depthMaterial = sceneMaterialMeta(o0.customDepthMaterial, shared);
  if (extra) meta.extra = extra;
  // `geometry`: what was baked (the object's geometry without its instanced attributes) — verify --web compares it
  return { name, objects, geometry: geo.geometry, mesh: { attributes: geo.attributes, index: geo.index, ranges: geo.ranges, bounds: geo.bounds, meta } };
}
const GIT = gitInfo();

function sharedUniforms(...looks) {
  const s = new Set();
  for (const l of looks) for (const u of Object.values(l.uniforms)) s.add(u);
  return s;
}

/**
 * Every scene mesh (world, survivors, fx) as { name, objects, mesh } — tools/meshfmt/verify.mjs --web compares
 * the files with this live geometry like heliMeshes().
 */
export function sceneMeshes() {
  const out = [];
  // ---- world (lighthouse per quality; the rest from the high build, identical on every quality)
  const builds = Object.fromEntries(SCENE_QUALITIES.map((q) => [q, buildWorld(q)]));
  const W = builds.high.world;
  const WM = 'systems/world/';
  for (const q of SCENE_QUALITIES) {
    const w = builds[q].world;
    const lh = w.lighthouse;
    const shared = sharedUniforms(w.look);
    for (const u of Object.values(w.shared)) shared.add(u);
    out.push(sceneEntry(`lighthouse_${q}`, [lh.mesh], {
      shared, module: WM + 'lighthouse.js',
      extra: { decal: { width: 512, height: 512, file: 'lighthouse_deck.rgba' }, quality: q },
    }));
  }
  {
    const lh = W.lighthouse;
    const shared = sharedUniforms(W.look);
    for (const u of Object.values(W.shared)) shared.add(u);
    out.push(sceneEntry('lighthouse_beam', [lh.beam], { shared, module: WM + 'lighthouse.js' }));
    out.push(sceneEntry('world_lamp', [W.lamps.mesh], { shared, module: WM + 'lamps.js', extra: { max: W.lamps.max } }));
    out.push(sceneEntry('world_collar', [W.collars.mesh], { shared, module: WM + 'contact.js', extra: { max: W.collars.max } }));
    out.push(sceneEntry('world_rigging', [W.rigging.mesh], { shared, module: WM + 'rigging.js', extra: { max: W.rigging.max } }));
    const banks = W.floaters.banks;
    for (const s of builds.high.shapes) {
      const b = banks.get(s);
      out.push(sceneEntry(`floater_${s}`, [b.mesh], { shared, module: WM + 'floaters.js', extra: { shape: s, y: b.def.y, R: b.def.R, k: b.def.k } }));
    }
    for (const k of floatersScope.BUOY_KINDS) {
      const b = banks.get(`buoy:${k}`);
      out.push(sceneEntry(`floater_buoy_${k}`, [b.mesh], { shared, module: WM + 'floaters.js', extra: { shape: `buoy:${k}`, y: b.def.y, R: b.def.R, k: b.def.k } }));
    }
    const veg = lh.land.veg.meshes;
    for (const kind of ['spruce', 'shrub', 'tuft']) {
      out.push(sceneEntry(`veg_${kind}`, [veg[kind]], {
        shared, module: WM + 'vegetation.js',
        extra: { atlas: { width: 512, height: 512, file: 'veg_atlas.rgba' }, prevail: [vegScope.PREVAIL.x, vegScope.PREVAIL.y] },
      }));
    }
  }
  // ---- survivors + fx
  const { survivors: sv, fx, ctx: seaCtx } = buildSea();
  const shared = sharedUniforms(seaCtx.look);
  for (const u of Object.values(fx.air)) shared.add(u);
  for (const u of [sv.rim, sv.nightAmb, sv.skyFill, sv.steelFill]) shared.add(u);
  const SM = 'systems/survivors/';
  const cr = sv.crowd;
  out.push(sceneEntry('surv_person', [cr.mesh], {
    shared, module: SM + 'crowd.js',
    extra: {
      max: cr.max, ghost: { material: sceneMaterialMeta(cr.ghostMaterial, shared), renderOrder: cr.ghost.renderOrder, heat: cr.ghost.userData.heat ?? null },
      keyline: { material: sceneMaterialMeta(cr.keylineMaterial, shared), renderOrder: cr.keyline.renderOrder },
      lines: { material: sceneMaterialMeta(sv.lines.material, shared), renderOrder: sv.lines.mesh.renderOrder, max: sv.lines.max },
    },
  }));
  const CRAFT = { raft: 'raft', boat: 'boat', yacht: 'yacht', container: 'container', plane: 'plane', stretcher: 'stretcher', buoy: 'lostbuoy', debris: 'debris' };
  for (const [key, file] of Object.entries(CRAFT)) {
    const b = sv.batches[key];
    const heat = sv.heat[key];
    out.push(sceneEntry(`craft_${file}`, [b.mesh], {
      shared, module: SM + 'craft.js',
      extra: { batch: b.mesh.name, max: b.max, instanceColor: !!b.mesh.instanceColor, heat: heat ? heat.mesh.userData.heat : null },
    }));
  }
  out.push(sceneEntry('surv_collar', [sv.collars.mesh], { shared, module: SM + 'water.js', extra: { max: sv.collars.max } }));
  out.push(sceneEntry('surv_glow', [sv.glows.mesh], { shared, module: SM + 'water.js', extra: { max: sv.glows.max } }));
  const FM = 'systems/fx/';
  out.push(sceneEntry('fx_gull', [fx.gulls.mesh], { shared, module: FM + 'life.js', extra: { max: fx.gulls.max, scale: fx.gulls._s.x } }));
  out.push(sceneEntry('fx_heat', [fx.signals.heat], { shared, module: FM + 'signals.js', extra: { max: fx.signals.heat.count === undefined ? null : fx.signals.flares.length + fx.signals.rockets.length } }));
  for (const p of fx._poolList) out.push(sceneEntry(`fx_particles_${p.kind}`, [p.mesh], { shared, module: FM + 'particles.js', extra: { kind: p.kind, max: p.max } }));
  out.push(sceneEntry('fx_glows', [fx.glows.mesh], { shared, module: FM + 'signals.js' }));
  out.push(sceneEntry('fx_rings', [fx.rings.mesh], { shared, module: FM + 'signals.js' }));
  out.push(sceneEntry('fx_rain', [fx.rain.mesh], {
    shared, module: FM + 'rain.js',
    extra: { local: { renderOrder: fx.rain.local.renderOrder }, localLight: { renderOrder: fx.rain.localLight.renderOrder }, R: fx.rain.R },
  }));
  out.push(sceneEntry('fx_motes', [fx.rain.motes], { shared, module: FM + 'rain.js' }));
  out.push(sceneEntry('fx_dolphin', [fx.dolphins.mesh], { shared, module: FM + 'life.js', extra: { max: fx.dolphins.max } }));
  out.push(sceneEntry('fx_whale', [fx.whale.mesh], { shared, module: FM + 'life.js' }));
  out.push(sceneEntry('fx_whale_shade', [fx.whale.shade], { shared, module: FM + 'life.js' }));
  return out;
}

// -------------------------------------------------------------------------------- canvas textures
// Two scene textures are drawn by the web with the 2D canvas, which only a browser renders: the island's
// vegetation card atlas (world/vegetation.js vegTexture, 512²) and the lighthouse helideck decal
// (world/decals.js paintHelideck through look.canvasTexture, 512², repainted once the web fonts — Oswald —
// arrive). `--canvas` opens op1 in headless Chromium (lib/browser.mjs; machine-wide lock), waits for the
// fonts and the repaint, and reads both canvases back: raw RGBA8 (sRGB, straight alpha — what three uploads
// with premultiplyAlpha false), rows flipped like three's CanvasTexture flipY so row 0 = v 0 (the Metal
// upload takes the rows as they are). Written next to the meshes (Resources/Meshes/*.rgba).
export const CANVAS_TEXTURES = ['veg_atlas.rgba', 'lighthouse_deck.rgba'];

async function bakeCanvases(outDir) {
  const { withBrowser } = await import('./lib/browser.mjs');
  return withBrowser(async ({ page, open, errors }) => {
    await open('mission=0&autostart&quality=high&nohud&stub=audio', { frames: 10 });
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load("600 32px 'Oswald'");
      await new Promise((r) => setTimeout(r, 300)); // decalTexture repaints in the fonts.ready continuation
      return document.fonts.check("600 32px 'Oswald'");
    });
    const res = await page.evaluate(() => {
      const read = (c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const w = c.width, h = c.height, row = w * 4;
        const flipped = new Uint8Array(d.length);
        for (let y = 0; y < h; y++) flipped.set(d.subarray((h - 1 - y) * row, (h - y) * row), y * row);
        let bin = '';
        for (let i = 0; i < flipped.length; i += 0x8000) bin += String.fromCharCode.apply(null, flipped.subarray(i, i + 0x8000));
        return { w, h, b64: btoa(bin) };
      };
      const lh = window.__game.world.lighthouse;
      return { veg: read(lh.land.veg.meshes.spruce.material.map.image), deck: read(lh.decal.image) };
    });
    if (errors.length) throw new Error('canvas bake: page errors: ' + errors.slice(0, 5).join(' | '));
    if (!fonts) console.log('note: Oswald did not load (offline?) — the deck decal text uses the fallback font');
    const files = [];
    for (const [file, r] of [['veg_atlas.rgba', res.veg], ['lighthouse_deck.rgba', res.deck]]) {
      if (r.w !== 512 || r.h !== 512) throw new Error(`canvas bake: ${file} is ${r.w}×${r.h}`);
      const buf = Buffer.from(r.b64, 'base64');
      fs.writeFileSync(path.join(outDir, file), buf);
      files.push(file);
      console.log(`${file.padEnd(24)} ${r.w}×${r.h} RGBA8 ${String(buf.length).padStart(7)} B  fonts ${fonts ? 'Oswald' : 'fallback'}`);
    }
    return files;
  });
}

// ------------------------------------------------------------------------------------------ main
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.warn = () => {};
  const argv = process.argv.slice(2);
  const outDir = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : MESH_DIR;
  const meshes = [...heliMeshes(), ...sceneMeshes()];
  fs.mkdirSync(outDir, { recursive: true });
  const written = new Set();
  for (const { name, mesh } of meshes) {
    const r = writeMMesh(path.join(outDir, `${name}.mmesh`), mesh);
    written.add(`${name}.mmesh`);
    console.log(`${name.padEnd(24)} ${String(r.vertexCount).padStart(5)} v ${String(r.indexCount / 3).padStart(5)} tris ${String(r.bytes).padStart(7)} B  ${r.sha256.slice(0, 12)}`);
  }
  if (argv.includes('--canvas')) await bakeCanvases(outDir);
  // a stale file from an older bake would ship unchecked: heli_* and the scene prefixes hold exactly what was baked
  const owned = (f) => f.endsWith('.mmesh') && (f.startsWith('heli_') || SCENE_PREFIXES.some((p) => f.startsWith(p)));
  for (const f of fs.readdirSync(outDir)) if (owned(f) && !written.has(f)) fs.rmSync(path.join(outDir, f));
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
