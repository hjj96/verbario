// Landforms (DESIGN §2.11): the lighthouse island «Скалистый» and the props rocks (fog pinnacles,
// reefs, «Кошки») as terrain.js landmasses — weathered Arctic granite at 69°N seen from a drone.
//
// Island layout is local to the lighthouse group (pad centre = origin, tower at (−9, −27)); the
// flats below keep every structure seated: pad plinth, tower plinth, keeper's house, shed, fuel
// station, radio mast + guy anchors, walkway steps, jetty root, and the jetty channel stays wet.
import * as THREE from 'three';
import { buildTerrain, coverRule, fitShoals, sstep, hash01, boulderGeometry, scatterBoulders, terrainColumns, shadowLod } from './terrain.js';
import { createTerrainMaterial, terrainUniforms } from './terrainMaterial.js';
import { Vegetation } from './vegetation.js';
import { rng } from './geo.js';

// Grid spacing per quality tier (m): crisp at 100 m, cheap on low. High stays at 0.8: the island and
// its three rocks share the 400k-triangle frame with the sea round the home base.
export const TERRAIN_STEP = { high: 0.8, medium: 0.85, low: 1.3 };
// Shadow casters use a coarse copy of each landmass (~1.8 m cells; terrain.js shadowLod): the cast
// shadow on the sea and the crags' self-shadowing read the same at a fraction of the triangles.
const shadowStride = (step) => Math.max(2, Math.round(1.8 / step));

// ------------------------------------------------------------------------------------------------
// «Скалистый»
// lobe: [x, z, rx, rz, rot, h, w, k, peak, rag]
const ICE = 1.2; // glacier flow NNW → SSE (whalebacks and skerries are elongated along it)
const ISLAND_LOBES = [
  [-6, -16, 33, 22, -0.95, 10.4, 0.62, 1.8, 0, 1], // main whaleback (tower → pad)
  [-13, -31, 12, 9, -0.6, 11.0, 0.3, 2.4, 0.15, 1], // tower crag
  [14, -31, 15, 10, 0.3, 9.2, 0.38, 2.2, 0, 1], // keeper's house knoll
  [27, -36, 8, 6, -ICE, 7.4, 0.4, 2.2, 0, 1], // mast knoll
  [2, -1, 15, 13, 0, 8.6, 0.5, 2, 0, 1], // pad knoll
  [16, -10, 9, 7, 0, 7.6, 0.5, 2, 0, 1], // fuel shelf
  [-32, -6, 13, 8, -ICE, 6.0, 0.35, 2.4, 0, 1], // west shoulder
  [-30, -38, 10, 7, -1.0, 6.2, 0.22, 2.8, 0.3, 1], // north-west crag
  [22, 4, 12, 8, -0.8, 4.4, 0.65, 1.7, 0, 1], // east slabs (jetty)
  [30, -16, 10, 8, -ICE, 6.2, 0.42, 2, 0, 1], // east knoll
  [2, 16, 11, 7, -1.0, 3.8, 0.65, 1.8, 0, 1], // south slabs
  [-17, 12, 9, 6, -1.3, 4.0, 0.5, 2, 0, 1], // south-west
  // coves (negative = carved)
  [1, -47, 9, 7, 0.3, -3, 0.5, 2, 0, 1],
  [-31, 9, 7, 6, 0.5, -3, 0.5, 2, 0, 1],
  [38, -4, 6, 5, 0.6, -3, 0.5, 2, 0, 1],
  [-6, 25, 6, 4, 1.0, -3, 0.5, 2, 0, 1],
  // skerries and drying reefs: low, ragged, elongated along the ice flow
  [-47, -25, 6, 3.2, -ICE, 0.96, 0.7, 1.6, 0, 0.9],
  [42, 1, 5, 2.6, -ICE, 0.66, 0.75, 1.6, 0, 0.9],
  [-50, 4, 5, 2.4, -ICE, 0.54, 0.75, 1.6, 0, 0.9],
  [-10, 32, 4.5, 2.4, -ICE, 0.48, 0.8, 1.6, 0, 0.9],
  [35, -47, 5, 3, -ICE, 0.84, 0.7, 1.6, 0, 0.9],
  [-42, -51, 4, 2.2, -ICE, 0.54, 0.75, 1.6, 0, 0.9],
  [48, -24, 3.5, 2, -ICE, 0.42, 0.8, 1.6, 0, 0.9],
  [17, 31, 3.2, 1.8, -ICE, 0.36, 0.8, 1.6, 0, 0.9],
  [-56, -12, 3, 1.6, -ICE, 0.3, 0.8, 1.6, 0, 0.9],
  [8, -55, 3.5, 2, -ICE, 0.48, 0.8, 1.6, 0, 0.9],
];
const ISLAND_FLATS = [
  { x: 0, z: 0, r: 13.2, blend: 8, y: 8.4, keep: 0.22 }, // helipad plinth (concrete wall 2.8 → 12 m)
  { x: 0, z: 0, r: 15.5, blend: 2, max: 10.6 }, // nothing pokes through the safety net
  { x: -9, z: -27, r: 6.0, blend: 4.5, y: 9.6, keep: 0.1 }, // tower plinth (top 10.5)
  { box: [13, -27, 6.3, 4.4], blend: 4.5, y: 9.2, keep: 0.08 }, // keeper's house foundation (5 → 10)
  { box: [4.8, -24.5, 2.3, 2.1], blend: 3, y: 9.5, keep: 0.05 }, // shed (floor 9.4)
  { box: [14.5, -8, 4.6, 3.2], blend: 3.5, y: 9.4, keep: 0.08 }, // fuel station plinth (8.9 → 10.3)
  { x: 22, z: -31, r: 2.2, blend: 3.5, y: 8.8, keep: 0.1 }, // radio mast foot
  { x: 30, z: -38, r: 1.2, blend: 3, y: 7.8, keep: 0.2 }, // guy anchors
  { x: 16, z: -40, r: 1.2, blend: 3, y: 7.8, keep: 0.2 },
  { x: 26, z: -20, r: 1.2, blend: 3, y: 6.8, keep: 0.2 },
  { seg: [[-3.2, -11.2], [-7.9, -22.6]], hw: 2.4, blend: 3.2, y0: 11.1, y1: 9.9, keep: 0.06 }, // walkway steps
  { x: 22.4, z: 8.2, r: 3.4, blend: 5, y: 1.9, keep: 0.15 }, // jetty root (deck top 2.1)
];
const ISLAND_CUTS = [{ seg: [[24.6, 11.6], [37, 31]], hw: 3.4, blend: 3, y: -2.2 }]; // jetty over water

export const ISLAND_BOUNDS = { x0: -60, z0: -60, x1: 54, z1: 40 };

export function islandDef() {
  return {
    seed: 4127,
    lobes: ISLAND_LOBES.map(([x, z, rx, rz, rot, h, w, k, peak, rag]) => ({ x, z, rx, rz, rot, h, w, k, peak, rag })),
    expose: [-0.62, -0.78], // open sea to the north-west: sea cliffs there, slabs in the lee (jetty)
    cliff: 0.68,
    ice: ICE,
    ridge: 2.8,
    bump: 1.2,
    step: 1.75,
    terr: 0.5,
    joint: { sp: [16, 22], depth: 2.6, width: 1.7, dir: 0.62 },
    flats: ISLAND_FLATS,
    cuts: ISLAND_CUTS,
  };
}

// Places that must stay clear of trees / boulders (island-local): structures + walkways + paths.
const CLEAR = [
  { x: 0, z: 0, r: 19 },
  { x: -9, z: -27, r: 9 },
  { box: [13, -27, 9, 7] },
  { box: [4.8, -24.5, 4, 4] },
  { box: [14.5, -8, 7, 6] },
  { x: 22, z: -31, r: 4 },
  { seg: [[-3.2, -11.2], [-7.9, -22.6]], hw: 4 },
  { seg: [[23, 9], [37, 31]], hw: 4.5 },
  { x: 10.4, z: 7.6, r: 3 },
];
// Footpaths worn through the heather: jetty → fuel → house → tower.
const PATHS = [
  [[22.4, 8.2], [18.5, 1.5], [15.5, -4.5]],
  [[13.5, -11.5], [12.8, -17], [12.6, -22.4]],
  [[7.5, -25.5], [1.5, -27.5], [-3.6, -27.4]],
];
function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(px - ax - ex * t, pz - az - ez * t);
}
export function pathDist(x, z) {
  let d = 1e9;
  for (const P of PATHS) for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]));
  return d;
}
export function islandClear(x, z, pad = 0) {
  for (const c of CLEAR) {
    if (c.seg) {
      if (segDist(x, z, c.seg[0][0], c.seg[0][1], c.seg[1][0], c.seg[1][1]) < c.hw + pad) return true;
    } else if (c.box) {
      if (Math.abs(x - c.box[0]) < c.box[2] + pad && Math.abs(z - c.box[1]) < c.box[3] + pad) return true;
    } else if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
  }
  return pathDist(x, z) < 1.4 + pad;
}

// Build the island terrain (geometry + sampler + shoals).
export function buildIslandTerrain(quality = 'high') {
  const def = islandDef();
  const base = coverRule(def.seed, 1.05);
  const cover = (x, z, h, ny, cav, shel) => {
    let c = base(x, z, h, ny, cav, shel);
    // trampled ground: bare along footpaths, grass right round the buildings
    const pd = pathDist(x, z);
    c *= sstep(0.5, 1.6, pd + 0.4 * hash01(Math.floor(x * 2), Math.floor(z * 2), 7));
    return c;
  };
  const step = TERRAIN_STEP[quality] || TERRAIN_STEP.high;
  const t0 = performance.now();
  const T = buildTerrain(def, { ...ISLAND_BOUNDS, step, cover, cut: -1.4, skirt: 9, skirtDepth: -10, shadowStride: shadowStride(step) });
  T.ms = performance.now() - t0;
  T.def = def;
  T.shoals = fitShoals(T.sampler, 4, { minR: 6, margin: 2 });
  return T;
}

// ------------------------------------------------------------------------------------------------
// Props rocks: a main crag (dome or sea stack), lower shoulders and skerries — one landmass each.
// Returns the definition and its grid bounds (world coordinates).
// Props rocks share one glacier-flow bearing: whalebacks, shoulders and skerries elongate along it.
const ICE_R = 0.45;
export function rockDef(rk, seed) {
  const R = rk.radius || 10;
  const H = rk.height || 6;
  const spire = Math.min(1, Math.max(0, (H / R - 0.7) / 1.3));
  const r = rng(seed);
  const lobes = [];
  const jx = (r() - 0.5) * R * 0.2, jz = (r() - 0.5) * R * 0.2;
  lobes.push({ x: rk.x + jx, z: rk.z + jz, rx: R * 0.56, rz: R * (0.38 + 0.08 * r()), rot: -ICE_R + (r() - 0.5) * 1.2, h: H, w: 0.5 - 0.36 * spire, k: 2 + 1.2 * spire, peak: 0.15 + 0.6 * spire, rag: 1.3 });
  // secondary summits / buttresses: crags are never a single dome
  const cr = 2 + Math.floor(r() * 2);
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < cr; k++) {
    const a = a0 + (k / cr) * Math.PI * 2 + (r() - 0.5) * 1.2, d = R * (0.3 + 0.25 * r());
    lobes.push({ x: rk.x + jx + Math.cos(a) * d, z: rk.z + jz + Math.sin(a) * d, rx: R * (0.28 + 0.12 * r()), rz: R * (0.16 + 0.1 * r()), rot: -a + (r() - 0.5) * 0.6, h: H * (0.4 + 0.45 * r()), w: 0.42 - 0.25 * spire, k: 2 + spire, peak: 0.2 + 0.5 * spire, rag: 1.1 });
  }
  // shoulders: low wave-cut platforms and fallen blocks round the foot of the crag
  const sh = 2 + Math.floor(r() * 3);
  for (let k = 0; k < sh; k++) {
    const a = (k / sh) * Math.PI * 2 + r() * 0.8, d = R * (0.4 + 0.3 * r());
    const rr = R * (0.24 + 0.16 * r());
    lobes.push({ x: rk.x + Math.cos(a) * d, z: rk.z + Math.sin(a) * d, rx: rr, rz: rr * (0.45 + 0.3 * r()), rot: -ICE_R + (r() - 0.5) * 0.9, h: Math.min(6, H * (0.08 + 0.18 * r())), w: 0.6, k: 1.7, peak: 0, rag: 0.9 });
  }
  const sk = 2 + Math.floor(r() * 3);
  for (let k = 0; k < sk; k++) {
    const a = r() * Math.PI * 2, d = R * (0.85 + 0.45 * r());
    const rr = 1.6 + R * 0.08 * r();
    lobes.push({ x: rk.x + Math.cos(a) * d, z: rk.z + Math.sin(a) * d, rx: rr, rz: rr * 0.6, rot: -ICE_R + (r() - 0.5) * 0.8, h: 0.6 + r() * 0.9, w: 0.75, k: 1.6, peak: 0, rag: 0.9 });
  }
  const ext = R * 1.55 + 6;
  return {
    def: {
      seed: seed * 7 + 3,
      lobes,
      expose: [Math.cos(seed), Math.sin(seed)],
      tilt: [0.09 * Math.cos(seed * 1.7), 0.09 * Math.sin(seed * 1.7)],
      cliff: 0.55 + 0.3 * spire,
      ice: ICE_R,
      ridge: Math.min(4.5, 0.8 + H * 0.11),
      bump: Math.min(1.1, 0.4 + R * 0.025),
      step: 1.5 + H * 0.035,
      terr: 0.42 + 0.25 * spire,
      joint: { sp: [7 + R * 0.25, 10 + R * 0.3], depth: Math.min(5, 1 + H * 0.12), width: 1.3 + R * 0.04, dir: seed * 0.37 },
    },
    bounds: { x0: rk.x - ext, z0: rk.z - ext, x1: rk.x + ext, z1: rk.z + ext },
    spire,
    R,
    H,
  };
}

export function buildRockTerrain(rk, seed, quality = 'high') {
  const D = rockDef(rk, seed);
  const base = TERRAIN_STEP[quality] || TERRAIN_STEP.high;
  const step = Math.min(1.6, Math.max(base, D.R / 30));
  const moss = D.spire > 0.3 ? 0.12 : 0.9;
  const cover = coverRule(D.def.seed, moss);
  // bird rocks: guano-whitened crowns and ledges on the stacks
  const birdK = 0.85 * D.spire; // only the stacks hold seabird colonies
  const bird = (x, z, h, hmax) => birdK * sstep(0.45, 0.9, h / Math.max(1, hmax));
  const T = buildTerrain(D.def, { ...D.bounds, step, cover, bird, cut: -1.4, scaleTo: D.H, skirt: 7, skirtDepth: -10, shadowStride: shadowStride(step) });
  T.shoals = fitShoals(T.sampler, 1, { minR: 2, margin: 1.5 });
  T.rock = D;
  T.def = D.def;
  return T;
}

// ------------------------------------------------------------------------------------------------
// Meshes. One terrain material per world (TERRAIN_LQ define on low), shared by island and rocks.
export function terrainMaterial(W, quality) {
  if (!W.mats.terrain) W.mats.terrain = createTerrainMaterial(W.look, W.shared, { lq: quality === 'low' });
  return W.mats.terrain;
}
const BOULDER_SEG = { high: [12, 9], medium: [10, 7], low: [8, 6] };
const BOULDERS = { high: 1, medium: 0.75, low: 0.45 };
function boulderMesh(W, list, quality, name, shared = null) {
  const [ws, hs] = BOULDER_SEG[quality] || BOULDER_SEG.high;
  const geo = shared || boulderGeometry(7, ws, hs);
  const mesh = new THREE.InstancedMesh(geo, terrainMaterial(W, quality), Math.max(1, list.length));
  mesh.name = name;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  list.forEach((b, i) => {
    e.set(0, b.ry, (b.ry % 0.3) - 0.15);
    q.setFromEuler(e);
    p.set(b.x, b.y, b.z);
    sc.set(b.s, b.s * b.sy, b.s * (0.75 + 0.25 * Math.sin(b.ry * 7)));
    mesh.setMatrixAt(i, m.compose(p, q, sc));
  });
  mesh.count = list.length;
  mesh.userData.full = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function boulderCount(mesh, q) {
  if (mesh) mesh.count = Math.round(mesh.userData.full * (BOULDERS[q] ?? 1));
}
function tris(mesh) {
  if (!mesh || !mesh.visible) return 0;
  const g = mesh.geometry;
  const n = Math.min(g.index ? g.index.count : g.attributes.position.count, g.drawRange.count) / 3;
  return mesh.isInstancedMesh ? n * mesh.count : n;
}

// «Скалистый»: terrain + boulders + vegetation, in the lighthouse group's local space.
export function createIsland(W, quality = 'high') {
  const T = buildIslandTerrain(quality);
  const group = new THREE.Group();
  group.name = 'island';
  const mat = terrainMaterial(W, quality);
  const terrain = new THREE.Mesh(T.geometry, mat);
  terrain.name = 'island-terrain';
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  group.add(shadowLod(terrain));
  const r = rng(T.def.seed);
  const bl = scatterBoulders(T.sampler, r, { ...ISLAND_BOUNDS, count: 46, erratics: 6, avoid: (x, z) => islandClear(x, z, 1.5) });
  const boulders = boulderMesh(W, bl, quality, 'island-boulders');
  group.add(boulders);
  const veg = new Vegetation(W.look, W.shared, T.sampler, { quality, seed: T.def.seed + 1, bounds: ISLAND_BOUNDS, clear: islandClear, pathDist });
  group.add(veg.group);
  const land = {
    group,
    terrain,
    boulders,
    veg,
    sampler: T.sampler,
    shoals: T.shoals,
    // collision columns hugging the rock above 2.5 m (island-local)
    obstacles: terrainColumns(T.sampler, ISLAND_BOUNDS, { cell: 7, min: 2.5 }),
    buildMs: T.ms,
    setQuality(q) {
      boulderCount(boulders, q);
      veg.setQuality(q);
    },
    stats() {
      const n = {};
      for (const [k, m] of Object.entries(veg.meshes)) n[k] = m.count;
      return { terrain: tris(terrain), boulders: tris(boulders), veg: veg.triangles, n, draws: 2 + Object.values(veg.meshes).filter((m) => m.visible).length };
    },
    dispose() {
      group.removeFromParent();
      T.geometry.dispose();
      boulders.geometry.dispose();
      boulders.dispose?.();
      veg.dispose();
    },
  };
  land.setQuality(quality);
  return land;
}

// Props rocks: one terrain mesh + one boulder mesh per rock (shared material), so the main and
// shadow passes cull every rock on its own — the field spans the whole mission area.
export function createRockField(W, list, seed, quality = 'high') {
  const r = rng(seed * 31 + 5);
  const group = new THREE.Group();
  group.name = 'rocks';
  const obstacles = [];
  const shoals = [];
  const rocks = [];
  const mat = terrainMaterial(W, quality);
  const [ws, hs] = BOULDER_SEG[quality] || BOULDER_SEG.high;
  const bgeo = boulderGeometry(7, ws, hs); // one shape for every rock's boulders
  for (const rk of list) {
    const s0 = Math.floor(r() * 1000) + 1;
    const T = buildRockTerrain(rk, s0, quality);
    const R = T.rock.R, H = T.rock.H;
    // collision: columns fitted to the rendered rock (crag, buttresses, shoulders above 2.5 m)
    for (const o of terrainColumns(T.sampler, T.rock.bounds, { cell: Math.max(5, Math.min(9, R * 0.4)), min: 2.5 })) {
      obstacles.push({ x: o.x, z: o.z, radius: o.radius, top: o.top, kind: 'rock', name: rk.name || 'скала' });
    }
    for (const sh of T.shoals) shoals.push(sh);
    const br = rng(s0 + 77);
    const b = T.rock.bounds;
    const bl = scatterBoulders(T.sampler, br, { ...b, count: Math.round(4 + R * 0.25), erratics: H / R < 0.8 ? 2 : 0 });
    const terrain = new THREE.Mesh(T.geometry, mat);
    terrain.name = 'rock-terrain';
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    group.add(shadowLod(terrain));
    const boulders = bl.length ? boulderMesh(W, bl, quality, 'rock-boulders', bgeo) : null;
    if (boulders) group.add(boulders);
    rocks.push({ terrain, boulders });
  }
  const field = {
    group,
    rocks,
    obstacles,
    shoals,
    setQuality(q) {
      for (const rk of rocks) boulderCount(rk.boulders, q);
    },
    stats() {
      let terrain = 0, boulders = 0, draws = 0;
      for (const rk of rocks) {
        terrain += tris(rk.terrain);
        boulders += tris(rk.boulders);
        draws += rk.boulders ? 2 : 1;
      }
      return { terrain, boulders, draws };
    },
    dispose() {
      group.removeFromParent();
      for (const rk of rocks) {
        rk.terrain.geometry.dispose();
        rk.boulders?.dispose?.();
      }
      bgeo.dispose();
    },
  };
  field.setQuality(quality);
  return field;
}

// Per-frame / settings hooks for the world.
export function updateLandforms(env) {
  terrainUniforms.uSwell.value = env.Hs ?? 0.5;
}
export function landformsQuality(W, q) {
  const m = W.mats.terrain;
  if (m) {
    const lq = q === 'low';
    const has = !!(m.defines && m.defines.TERRAIN_LQ !== undefined);
    if (lq !== has) {
      m.defines = lq ? { TERRAIN_LQ: '' } : {};
      m.needsUpdate = true;
    }
  }
  for (const pl of W.places) pl.land?.setQuality(q);
  W.rockField?.setQuality(q);
}
