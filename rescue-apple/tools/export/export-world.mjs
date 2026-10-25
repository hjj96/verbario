// export-world: parity vectors of the REAL web world (systems/world.js + world/*) run in Node 22 on stub
// systems -> Tests/Vectors/world/*.json (+ sidecars).
//
//   world/terrain_noise.json        terrain.js primitives: hashi / hash01, noise2, fbm2, ridged2, sstep, smax, footDist
//   world/landmass_first.json       islandDef() and the op1 rocks' rockDef() (seeds drawn as createRockField does),
//                                   makeHeightFn(def)(x, z) samples for every landmass
//   world/terrain_first_<q>.json    buildIslandTerrain(q) / buildRockTerrain(rk, s0, q) per quality: grid, sampler
//                                   arrays (sidecar on high, sha256 everywhere), mesh attributes / indices (sha256),
//                                   sampler queries, fitShoals, terrainColumns, scatterBoulders (+ instance
//                                   matrices), the island's Vegetation placement (f32 sidecar)
//   world/setup_first_<q>.json      a real World after `mission:setup` with the prepared op1 def: pads, obstacles,
//                                   places, shoals, lamps, floaters, banks, boulder / vegetation counts, the terrain
//                                   vertices the ocean bakes its coast map from and that coast map (coast.js)
//   world/run_first.json            the real World.update per frame (2700 frames, jittered dt, pauses) on scripted
//                                   weather / camera / heli / ocean / hazard stubs and heli events: env, channels,
//                                   shared uniforms, lighthouse beam / glows / lights, collars, windsock, floaters,
//                                   buoy lamps; events and ocean calls; a running FNV-1a of every frame
//   world/run_mix.json              the same runner on a synthetic def (all debris mixes, containers, every buoy
//                                   kind, ducks, a scenery lighthouse off the origin, quality low, detail 0.6)
//   world/rhythms.json              buoyRhythm(kind, t, reduce) on a time grid
//   world/boulders.json             boulderGeometry(7, …BOULDER_SEG[q]): the boulder mesh (fine + shadow LOD)
//
// The scripted inputs of the runs are RECORDED per frame (inputs sidecar), so the Swift test replays them;
// the analytic ocean / wind / hazard-flow stubs are described in `setup` and rebuilt identically in Swift.
// Same wrapper / number / determinism rules as export-vectors.mjs (tools/README.md).
// Usage: node rescue-apple/tools/export/export-world.mjs [--only noise,landmass,terrain,setup,run,rhythms] [--out <dir>]
import { gameImport, scopeOf } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, writeWrapped, writeSidecar, relSrc, sha256 } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/export-world.mjs';
const results = [];
console.warn = () => {};

const THREE = await import('three');
const { Look } = await gameImport('core/look.js');
const { EventBus } = await gameImport('core/events.js');
const { World } = await gameImport('systems/world.js');
const { CAMPAIGN } = await gameImport('systems/mission/campaign.js');
const { prepareDef } = await gameImport('systems/mission/prepare.js');
const { bakeCoast, coastDistance } = await gameImport('systems/ocean/coast.js');
const { rng } = await gameImport('systems/world/geo.js');
const { createShared } = await gameImport('systems/world/materials.js');
const { Vegetation } = await gameImport('systems/world/vegetation.js');
const { buoyRhythm, BUOY_KINDS } = await gameImport('systems/world/floaters.js');
const TER = await scopeOf('systems/world/terrain.js');
const LF = await scopeOf('systems/world/landforms.js');
const T = TER.scope;
const L = LF.scope;

const FILES = ['systems/world.js', 'systems/world/terrain.js', 'systems/world/landforms.js', 'systems/world/vegetation.js', 'systems/world/lighthouse.js',
  'systems/world/floaters.js', 'systems/world/lamps.js', 'systems/world/contact.js', 'systems/world/rigging.js', 'systems/world/geo.js',
  'systems/world/materials.js', 'systems/world/terrainMaterial.js', 'systems/ocean/coast.js', 'systems/mission/campaign.js', 'systems/mission/prepare.js'].map(relSrc);
const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern (Float32 arrays: Float.bitPattern); report index, both values and ulp distance on mismatch' };
const CHAOS = { class: 'chaos', note: 'every frame bitwise (running FNV-1a of the frame row + the bulky arrays); rows locate the first divergent field' };

function out(domain, name, { files = FILES, tolerance = BITWISE, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}
const sidecar = (name, typed, shape) => {
  const ref = writeSidecar(path.join(OUT, 'world', name), typed, shape);
  results.push({ path: path.join('Tests/Vectors/world', name), bytes: typed.byteLength });
  return ref;
};
const want = (k) => !ONLY || ONLY.has(k);
const f32sha = (a) => sha256(Buffer.from(new Float32Array(a).buffer));
const u32sha = (a) => sha256(Buffer.from(new Uint32Array(a).buffer));
const f64sha = (a) => sha256(Buffer.from(new Float64Array(a).buffer));
const nums = (a) => Array.from(a, num);
const QUALITIES = ['high', 'medium', 'low'];

// FNV-1a 32 over the little-endian bytes of doubles (NaN canonical) — export-sim.mjs fnv(), Swift FNV.mix.
const _hb = new DataView(new ArrayBuffer(8));
function fnv(h, values) {
  for (let i = 0; i < values.length; i++) {
    _hb.setFloat64(0, Number.isNaN(values[i]) ? NaN : values[i], true);
    for (let k = 0; k < 8; k++) {
      h ^= _hb.getUint8(k);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}
const FNV0 = 2166136261;

// Deterministic sample points (mulberry32 from world/geo.js rng).
function points(seed, n, x0, z0, x1, z1) {
  const r = rng(seed);
  const xs = [], zs = [];
  for (let i = 0; i < n; i++) {
    xs.push(x0 + r() * (x1 - x0));
    zs.push(z0 + r() * (z1 - z0));
  }
  return { x: xs, z: zs };
}

// The prepared op1 def (mission/prepare.js) and the slice of it the world reads.
const DEF1 = prepareDef(CAMPAIGN[0], { index: 0 });
const worldDef = (def) => ({ id: def.id, seed: def.seed, current: def.current, world: def.world });

// The op1 rocks and their per-rock seeds, drawn exactly as createRockField does: rng(seed·31 + 5), s0 = ⌊r()·1000⌋ + 1.
function rockSeeds(list, seed) {
  const r = rng(seed * 31 + 5);
  return list.map(() => Math.floor(r() * 1000) + 1);
}
const ROCKS1 = DEF1.world.props.rocks;
const SEEDS1 = rockSeeds(ROCKS1, DEF1.seed || 1);

// ===================================================================================== terrain_noise
if (want('noise')) {
  const P = points(9001, 384, -260, -260, 260, 260);
  const seeds = [0, 1, 7, 4127, 4130, 4150, 7003, -3, 2147483647];
  const noise2 = [], fbm = [], ridged = [];
  P.x.forEach((x, i) => {
    const y = P.z[i];
    const s = seeds[i % seeds.length];
    const sc = [0.019, 0.045, 0.12, 0.35, 0.9, 1, 3.7][i % 7];
    noise2.push(num(T.noise2(x * sc, y * sc, s)));
    fbm.push(num(T.fbm2(x * sc, y * sc, s, 2 + (i % 3))));
    ridged.push(num(T.ridged2(x * sc, y * sc, s, 3 + (i % 2))));
  });
  const H = { x: [], y: [], s: [], h: [], h01: [] };
  const r = rng(77);
  for (let i = 0; i < 256; i++) {
    const x = Math.floor((r() - 0.5) * 4000), y = Math.floor((r() - 0.5) * 4000), s = [0, 23, 4150, -7, 999999][i % 5];
    H.x.push(x); H.y.push(y); H.s.push(s);
    H.h.push(T.hashi(x, y, s));
    H.h01.push(num(T.hash01(x, y, s)));
  }
  const ss = [];
  for (const [a, b] of [[0, 1], [-0.6, 2.4], [3, 6.5], [0.62, 0.86], [1.9, 4.2], [0.6, 0.95], [650, 250], [0.5, 1.6]]) {
    for (let k = 0; k <= 12; k++) {
      const x = a + (b - a) * (k / 10 - 0.1);
      ss.push([num(a), num(b), num(x), num(T.sstep(a, b, x))]);
    }
  }
  const sm = [];
  for (let i = 0; i < 64; i++) {
    const a = (r() - 0.5) * 20, b = (r() - 0.5) * 20, k = [1.5, 1.6, 0.5, 4][i % 4];
    sm.push([num(a), num(b), num(k), num(T.smax(a, b, k))]);
  }
  const feet = [
    { x: 0, z: 0, r: 13.2 }, { box: [13, -27, 6.3, 4.4] }, { box: [4, -2, 3, 1.5], rot: 0.7 },
    { seg: [[-3.2, -11.2], [-7.9, -22.6]], hw: 2.4 }, { seg: [[24.6, 11.6], [37, 31]], hw: 3.4 },
  ];
  const fd = [];
  for (let i = 0; i < 160; i++) {
    const F = feet[i % feet.length];
    const x = (r() - 0.5) * 80, z = (r() - 0.5) * 80;
    const d = T.footDist(F, x, z);
    fd.push([i % feet.length, num(x), num(z), num(d[0]), num(d[1])]);
  }
  out('world', 'terrain_noise', {
    files: [relSrc('systems/world/terrain.js'), relSrc('systems/world/geo.js')],
    data: {
      setup: 'points: rng(9001) (world/geo.js mulberry32) → x = −260 + 520·r(), z likewise, 384 pairs; sample i uses seed seeds[i % 9] and scale scales[i % 7]; fbm octaves 2 + i % 3, ridged octaves 3 + i % 2',
      seeds, scales: [0.019, 0.045, 0.12, 0.35, 0.9, 1, 3.7],
      x: nums(P.x), y: nums(P.z), noise2, fbm2: fbm, ridged2: ridged,
      hash: H, sstep: ss, smax: sm, feet, footDist: fd,
      gx: nums(T.GX), gy: nums(T.GY),
    },
  });
}

// ===================================================================================== landmass_first
if (want('landmass')) {
  const isl = L.islandDef();
  const fnI = T.makeHeightFn(isl);
  const b = L.ISLAND_BOUNDS;
  const PI = points(4127, 600, b.x0 - 10, b.z0 - 10, b.x1 + 10, b.z1 + 10);
  const rocks = ROCKS1.map((rk, i) => {
    const D = L.rockDef(rk, SEEDS1[i]);
    const fn = T.makeHeightFn(D.def);
    const P = points(500 + i, 300, D.bounds.x0, D.bounds.z0, D.bounds.x1, D.bounds.z1);
    return { rock: rk, s0: SEEDS1[i], def: D.def, bounds: D.bounds, spire: num(D.spire), R: D.R, H: D.H, x: nums(P.x), z: nums(P.z), h: P.x.map((x, k) => num(fn(x, P.z[k]))) };
  });
  out('world', 'landmass_first', {
    data: {
      setup: 'islandDef() and the op1 rocks: s0 = ⌊r()·1000⌋ + 1 with r = rng(def.seed·31 + 5) (createRockField), rockDef(rock, s0); h = makeHeightFn(def)(x, z) at rng(4127) points over ISLAND_BOUNDS ± 10 (600) and rng(500 + i) points over each rock\'s bounds (300)',
      seed: DEF1.seed,
      island: { def: isl, bounds: b, x: nums(PI.x), z: nums(PI.z), h: PI.x.map((x, k) => num(fnI(x, PI.z[k]))) },
      rocks,
    },
  });
}

// ===================================================================================== terrain_first_<q>
// One landmass build: grid, arrays, mesh, sampler queries, fits.
function landmassRecord(Tr, bounds, { columns, shoalsOf, boulders, full, tag }) {
  const G = Tr.sampler.grid;
  const g = Tr.geometry;
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array, ter = g.attributes.aTerr.array;
  const idx = Array.from(g.index.array);
  const rec = {
    grid: { x0: G.x0, z0: G.z0, nx: G.nx, nz: G.nz, step: num(G.step) },
    hmax: num(Tr.sampler.hmax), triangles: Tr.triangles,
    sha: { H: f32sha(G.H), NY: f32sha(G.NY), COV: f32sha(G.COV), SHL: f32sha(G.SHL), CAV: f32sha(G.CAV) },
    mesh: {
      vertices: g.attributes.position.count, indices: idx.length, drawCount: g.drawRange.count, shadowRange: g.userData.shadowRange || null,
      sha: { position: f32sha(pos), normal: f32sha(nrm), aTerr: f32sha(ter), index: u32sha(idx) },
    },
  };
  if (full) {
    const N = G.nx * G.nz;
    const all = new Float32Array(5 * N);
    [G.H, G.NY, G.COV, G.SHL, G.CAV].forEach((a, k) => all.set(a, k * N));
    rec.arrays = sidecar(`${tag}_grid.f32`, all, [5, N]);
    rec.arraysOrder = ['H', 'NY', 'COV', 'SHL', 'CAV'];
  }
  // sampler queries (inside, edges, outside: lerp clamps to the grid)
  const S = Tr.sampler;
  const P = points(31 + G.nx, 240, bounds.x0 - 6, bounds.z0 - 6, bounds.x1 + 6, bounds.z1 + 6);
  P.x.push(bounds.x0, bounds.x1, bounds.x0, (bounds.x0 + bounds.x1) / 2);
  P.z.push(bounds.z0, bounds.z1, bounds.z1, (bounds.z0 + bounds.z1) / 2);
  const v = new THREE.Vector3();
  rec.queries = {
    x: nums(P.x), z: nums(P.z),
    inside: P.x.map((x, k) => S.inside(x, P.z[k])),
    height: P.x.map((x, k) => num(S.heightAt(x, P.z[k]))),
    up: P.x.map((x, k) => num(S.upAt(x, P.z[k]))),
    cover: P.x.map((x, k) => num(S.coverAt(x, P.z[k]))),
    shelter: P.x.map((x, k) => num(S.shelterAt(x, P.z[k]))),
    cavity: P.x.map((x, k) => num(S.cavityAt(x, P.z[k]))),
    normal: P.x.map((x, k) => (S.normalAt(x, P.z[k], v), [num(v.x), num(v.y), num(v.z)])),
  };
  rec.shoals = shoalsOf.map((s) => ({ x: num(s.x), z: num(s.z), radius: num(s.radius) }));
  rec.columns = columns.map((o) => ({ x: num(o.x), z: num(o.z), radius: num(o.radius), top: num(o.top) }));
  rec.boulders = boulders.map((o) => ({ x: num(o.x), y: num(o.y), z: num(o.z), s: num(o.s), sy: num(o.sy), ry: num(o.ry) }));
  // the boulder InstancedMesh matrices (landforms.js boulderMesh)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const mats = new Float32Array(Math.max(1, boulders.length) * 16);
  boulders.forEach((b, i) => {
    e.set(0, b.ry, (b.ry % 0.3) - 0.15);
    q.setFromEuler(e);
    p.set(b.x, b.y, b.z);
    sc.set(b.s, b.s * b.sy, b.s * (0.75 + 0.25 * Math.sin(b.ry * 7)));
    m.compose(p, q, sc).toArray(mats, i * 16);
  });
  rec.boulderMatrices = nums(mats.subarray(0, boulders.length * 16));
  return rec;
}

let LOOK = null;
const look = () => (LOOK ||= new Look(7));

if (want('terrain')) {
  for (const q of QUALITIES) {
    const full = q === 'high';
    // «Скалистый»
    const Ti = L.buildIslandTerrain(q);
    const B = L.ISLAND_BOUNDS;
    const bl = T.scatterBoulders(Ti.sampler, rng(Ti.def.seed), { ...B, count: 46, erratics: 6, avoid: (x, z) => L.islandClear(x, z, 1.5) });
    const island = landmassRecord(Ti, B, {
      columns: T.terrainColumns(Ti.sampler, B, { cell: 7, min: 2.5 }), shoalsOf: Ti.shoals, boulders: bl, full, tag: `terrain_first_${q}_island`,
    });
    island.boulderCount = Math.round(bl.length * (L.BOULDERS[q] ?? 1));
    // vegetation on the island (vegetation.js): instance matrices, colours, aInst per kind
    const veg = new Vegetation(look(), createShared(), Ti.sampler, { quality: q, seed: Ti.def.seed + 1, bounds: B, clear: L.islandClear, pathDist: L.pathDist });
    const kinds = ['spruce', 'shrub', 'tuft'];
    const parts = [];
    const vrec = {};
    let off = 0;
    for (const k of kinds) {
      const mesh = veg.meshes[k];
      const n = mesh.userData.full;
      const mat = mesh.instanceMatrix.array.subarray(0, n * 16);
      const col = mesh.instanceColor ? mesh.instanceColor.array.subarray(0, n * 3) : new Float32Array(n * 3);
      const inst = mesh.geometry.attributes.aInst.array.subarray(0, n * 2);
      vrec[k] = { full: n, count: mesh.count, offset: off };
      parts.push(mat, col, inst);
      off += n * 21;
    }
    const vall = new Float32Array(off);
    let o = 0;
    for (const a of parts) { vall.set(a, o); o += a.length; }
    island.vegetation = { layout: 'per kind (spruce, shrub, tuft): full·16 matrix floats, full·3 colour floats, full·2 aInst floats', kinds: vrec, data: sidecar(`terrain_first_${q}_veg.f32`, vall) };
    // rocks
    const rocks = ROCKS1.map((rk, i) => {
      const s0 = SEEDS1[i];
      const Tr = L.buildRockTerrain(rk, s0, q);
      const R = Tr.rock.R, H = Tr.rock.H;
      const b = Tr.rock.bounds;
      const cols = T.terrainColumns(Tr.sampler, b, { cell: Math.max(5, Math.min(9, R * 0.4)), min: 2.5 });
      const bo = T.scatterBoulders(Tr.sampler, rng(s0 + 77), { ...b, count: Math.round(4 + R * 0.25), erratics: H / R < 0.8 ? 2 : 0 });
      const rec = landmassRecord(Tr, b, { columns: cols, shoalsOf: Tr.shoals, boulders: bo, full, tag: `terrain_first_${q}_rock${i}` });
      rec.s0 = s0;
      rec.bounds = b;
      rec.boulderCount = Math.round(bo.length * (L.BOULDERS[q] ?? 1));
      return rec;
    });
    out('world', `terrain_first_${q}`, {
      data: {
        setup: `quality ${q}: island = buildIslandTerrain(q) (+ terrainColumns cell 7 min 2.5, scatterBoulders(rng(def.seed), count 46, erratics 6, avoid islandClear(·, 1.5)), Vegetation(seed def.seed + 1)); rock i = buildRockTerrain(rocks[i], s0[i], q) (+ terrainColumns cell clamp(R·0.4, 5, 9) min 2.5, scatterBoulders(rng(s0 + 77), round(4 + R·0.25), H/R < 0.8 ? 2 : 0)). sha256 over Float32 LE (index: Uint32 LE). Queries at rng(31 + nx) points over bounds ± 6 plus 4 fixed points.`,
        quality: q, rocks: ROCKS1, s0: SEEDS1, island, rockLand: rocks,
      },
    });
  }
}

// ===================================================================================== boulders
// boulderGeometry(7, wSeg, hSeg) per BOULDER_SEG quality (the one boulder shape every rock and the island
// instance): the displaced SphereGeometry with its fine + coarse shadow LOD, all attributes and indices.
if (want('terrain')) {
  const out1 = {};
  for (const q of QUALITIES) {
    const [ws, hs] = L.BOULDER_SEG[q];
    const g = T.boulderGeometry(7, ws, hs);
    out1[q] = {
      seg: [ws, hs], attributes: Object.keys(g.attributes),
      position: nums(g.attributes.position.array), normal: nums(g.attributes.normal.array), aTerr: nums(g.attributes.aTerr.array),
      index: Array.from(g.index.array), drawCount: g.drawRange.count, shadowRange: g.userData.shadowRange || null,
    };
  }
  out('world', 'boulders', {
    files: [relSrc('systems/world/terrain.js'), relSrc('systems/world/landforms.js')],
    data: { setup: 'boulderGeometry(7, ...BOULDER_SEG[q]) (terrain.js; three r185 SphereGeometry underneath): Float32 attributes, Uint32 indices', ...out1 },
  });
}

// ===================================================================================== stub systems
// Analytic ocean: heights / normals from a closed formula of (x, z, t); searchlight disc under the heli;
// stamp / setShoals logged. The Swift test rebuilds exactly this (JS.sin / JS.cos in the same order).
function makeOcean(ctx, log, amp = 1) {
  const o = {
    heightAt(x, z) {
      const t = ctx.time.t;
      return amp * (0.35 * Math.sin(0.11 * x + 0.9 * t) + 0.22 * Math.cos(0.07 * z - 0.6 * t + 0.3 * Math.sin(0.02 * x)));
    },
    normalAt(x, z, out) {
      const e = 0.5;
      const hx = (o.heightAt(x + e, z) - o.heightAt(x - e, z)) / (2 * e);
      const hz = (o.heightAt(x, z + e) - o.heightAt(x, z - e)) / (2 * e);
      return out.set(-hx, 1, -hz).normalize();
    },
    searchlightAt(x, z) {
      const hp = ctx.heli?.position;
      if (!hp) return 0;
      const d = Math.hypot(x - hp.x, z - hp.z);
      return d < 30 ? 1 - d / 30 : 0;
    },
    stamp(kind, x, z, opts = {}) { log.push(['stamp', ctx.time.frame, kind, num(x), num(z), num(opts.radius ?? -1), num(opts.strength ?? -1)]); },
    setShoals(list) { log.push(['shoals', ctx.time.frame, list.map((s) => [num(s.x), num(s.z), num(s.radius)])]); },
  };
  return o;
}
// Wind field: the scripted mean wind (state.windDir · windSpeed) modulated in space and time.
function windAt(st, t, x, z, out) {
  const k = 1 + 0.15 * Math.sin(0.013 * x + 0.017 * z + 0.7 * t);
  const a = 0.2 * Math.sin(0.009 * x - 0.011 * z + 0.3 * t);
  const c = Math.cos(a), s = Math.sin(a);
  const wx = st.windDir.x * st.windSpeed * k, wz = st.windDir.y * st.windSpeed * k;
  return out.set(wx * c - wz * s, wx * s + wz * c);
}
// Hazard surface flow: a vortex around (cx, cz) (tangential, decaying), on only while hazardsOn.
function surfaceFlow(cx, cz, x, z, out) {
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  const k = 0.6 * Math.exp(-d2 / 3600) / (Math.sqrt(d2) + 1);
  return out.set(-dz * k, dx * k);
}

// Stub ctx around a real World. `inputs` is the per-frame scripted state.
function makeCtx({ quality, detail = 1, params = '', reduceFlashes = false }) {
  const vals = { quality, reduceFlashes };
  const listeners = [];
  const settings = { get: (k) => vals[k], set(k, v) { vals[k] = v; for (const f of listeners) f(k, v); }, onChange(f) { listeners.push(f); }, detail: () => detail };
  const camState = { pos: new THREE.Vector3(0, 220, 60), dir: new THREE.Vector3(0, -0.965, -0.26).normalize() };
  const camera = { getWorldPosition: (o) => o.copy(camState.pos), getWorldDirection: (o) => o.copy(camState.dir) };
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8899aa, 200, 900);
  const ctx = { THREE, look: look(), scene, camera, settings, events: new EventBus(), time: { t: 0, dt: 0, frame: 0 }, params: new URLSearchParams(params), camState };
  return ctx;
}

// Per-frame weather script (numbers only; colours come from fixed palettes blended by `night`).
const C_DAY = { ambient: new THREE.Color('#9FB4C4'), sun: new THREE.Color('#FFF1DA'), foam: new THREE.Color('#F1F4EE') };
const C_NIGHT = { ambient: new THREE.Color('#1C2836'), sun: new THREE.Color('#7E8FB0'), foam: new THREE.Color('#9AA6B0') };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function scriptWeather(t, sc) {
  const night = sc.night(t);
  const fog = sc.fog(t);
  const rain = sc.rain(t);
  const intensity = Math.min(1, 0.2 + 0.5 * rain + 0.2 * Math.sin(t * 0.05));
  const visibility = 20000 - 19400 * fog - 6000 * rain;
  const windSpeed = 2 + 10 * sm(4, 30, t) + 1.5 * Math.sin(t * 0.4);
  const wa = 0.4 + 0.9 * Math.sin(t * 0.03) + 0.1 * t / 10;
  const flash = t > 20.5 && t < 20.9 ? 0.8 : 0;
  const Hs = 0.4 + 1.6 * sm(5, 40, t);
  const shadowIntensity = 0.55 - 0.3 * rain;
  const ai = 0.9 - 0.7 * rain, si = 1.1 - 0.9 * rain;
  return { night, fog, rain, intensity, visibility, windSpeed, windDirX: Math.cos(wa), windDirZ: Math.sin(wa), flash, Hs, waveHeight: Hs * 0.9, shadowIntensity, ambientIntensity: ai, sunIntensity: si,
    fogNear: 200 - 150 * fog, fogFar: 900 - 650 * fog };
}
const WEATHER_FIELDS = ['night', 'fog', 'rain', 'intensity', 'visibility', 'windSpeed', 'windDirX', 'windDirZ', 'flash', 'Hs', 'waveHeight', 'shadowIntensity', 'ambientIntensity', 'sunIntensity', 'fogNear', 'fogFar'];

// The runner: a real World on the stub ctx; returns the vector payload.
// sc: { id, def, quality, detail, params, frames, every, bulkEvery, dt(frame), weather fns, camera(t), heli(t) (null = none),
//       hazards: {from, to, x, z}, palette: bool (false = palette without colours), actions: {frame: [[op, ...]]} }
function runWorld(sc) {
  const ctx = makeCtx(sc);
  const log = [];
  ctx.ocean = makeOcean(ctx, log, sc.oceanAmp ?? 1);
  const events = [];
  for (const name of ['world:foghorn']) ctx.events.on(name, (p) => events.push([ctx.time.frame, name, num(p.x), num(p.z)]));
  const st = { windDir: new THREE.Vector2(1, 0), windSpeed: 0, palette: {} };
  const wtmp = new THREE.Vector2();
  ctx.weather = { state: st, windAt: (x, z, o) => windAt(st, ctx.time.t, x, z, o || wtmp) };
  const heliState = { position: new THREE.Vector3() };
  const hzFlow = { surfaceFlowAt: (x, z, o) => surfaceFlow(sc.hazards.x, sc.hazards.z, x, z, o) };
  const world = new World(ctx);
  ctx.world = world;
  const applyInputs = (frame, t) => {
    const w = scriptWeather(t, sc);
    Object.assign(st, w);
    st.windDir.set(w.windDirX, w.windDirZ);
    const n = w.night;
    const pal = { sea: { Hs: w.Hs }, shadowIntensity: w.shadowIntensity, ambientIntensity: w.ambientIntensity, sunIntensity: w.sunIntensity };
    if (sc.palette(frame)) {
      pal.ambient = C_DAY.ambient.clone().lerp(C_NIGHT.ambient, n);
      pal.sun = C_DAY.sun.clone().lerp(C_NIGHT.sun, n);
      pal.foam = C_DAY.foam.clone().lerp(C_NIGHT.foam, n);
    }
    st.palette = pal;
    ctx.scene.fog.near = w.fogNear;
    ctx.scene.fog.far = w.fogFar;
    const cam = sc.camera(t);
    ctx.camState.pos.set(cam[0], cam[1], cam[2]);
    ctx.camState.dir.set(cam[3], cam[4], cam[5]).normalize();
    const hp = sc.heli(t);
    if (hp) {
      heliState.position.set(hp[0], hp[1], hp[2]);
      ctx.heli = heliState;
    } else ctx.heli = null;
    ctx.hazards = sc.hazards && t >= sc.hazards.from && t < sc.hazards.to ? hzFlow : undefined;
    return { w, pal, cam, hp };
  };
  // setup (frame 0: the same inputs row with dt 0 and no actions)
  const i0 = applyInputs(0, 0);
  const inputs0 = [0, ...WEATHER_FIELDS.map((k) => i0.w[k]), sc.palette(0) ? 1 : 0, ...i0.cam, i0.hp ? 1 : 0, ...(i0.hp || [0, 0, 0]), ctx.hazards ? 1 : 0, 0, 0, 0];
  world.init();
  ctx.events.emit('mission:setup', { def: sc.def });
  const setup = setupRecord(world, ctx, log);

  const lh = world.lighthouse;
  const inputs = [];
  const rows = [];
  const bulk = [];
  const bulkF32 = [];
  const hashes = [];
  let h = FNV0;
  let t = 0;
  const lamps = world.floaters.buoys.map((b) => b.light);
  for (let frame = 1; frame <= sc.frames; frame++) {
    const dt = sc.dt(frame);
    t += dt;
    ctx.time.t = t;
    ctx.time.dt = dt;
    ctx.time.frame = frame;
    const { w, pal, cam, hp } = applyInputs(frame, t);
    const acts = sc.actions[frame] || [];
    const actCodes = [0, 0, 0];
    for (const a of acts) {
      if (a[0] === 'reduceFlashes') { ctx.settings.set('reduceFlashes', a[1]); actCodes[0] = a[1] ? 2 : 1; }
      if (a[0] === 'quality') { ctx.settings.set('quality', a[1]); actCodes[1] = QUALITIES.indexOf(a[1]) + 1; }
      if (a[0] === 'event') {
        const pad = a[2] >= 0 ? world.pads[a[2]] : undefined;
        ctx.events.emit(a[1], pad ? { pad } : {});
        actCodes[2] = ['heli:land', 'heli:takeoff', 'heli:unload-person', 'heli:unload'].indexOf(a[1]) + 1 + 10 * (a[2] + 1);
      }
    }
    const ws = WEATHER_FIELDS.map((k) => w[k]);
    const palOn = sc.palette(frame) ? 1 : 0;
    inputs.push(dt, ...ws, palOn, ...cam, hp ? 1 : 0, ...(hp || [0, 0, 0]), ctx.hazards ? 1 : 0, ...actCodes);
    world.update(dt);
    const row = frameRow(world, ctx);
    const bk = bulkRow(world, lamps);
    h = fnv(fnv(fnv(h, row), bk.f64), bk.f32);
    hashes.push(h);
    if (frame % sc.every === 0) rows.push(...row);
    if (frame % sc.bulkEvery === 0) { bulk.push(bk.f64); bulkF32.push(bk.f32); }
  }
  const INPUT_LEN = 1 + WEATHER_FIELDS.length + 1 + 6 + 4 + 1 + 3;
  const f64cat = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Float64Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  const f32cat = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Float32Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  return {
    setupRecord: setup,
    frames: sc.frames, every: sc.every, bulkEvery: sc.bulkEvery,
    inputFields: ['dt', ...WEATHER_FIELDS, 'paletteColours', 'camX', 'camY', 'camZ', 'dirX', 'dirY', 'dirZ', 'heli', 'heliX', 'heliY', 'heliZ', 'hazards', 'reduceFlashes(1 off, 2 on)', 'quality(1 high, 2 medium, 3 low)', 'event(1 land, 2 takeoff, 3 unload-person, 4 unload; + 10·(pad + 1))'],
    inputLength: INPUT_LEN,
    inputs0: nums(inputs0),
    inputs: sidecar(`${sc.id}_inputs.f64`, new Float64Array(inputs), [sc.frames, INPUT_LEN]),
    rowFields: ROW_FIELDS, rowLength: ROW_FIELDS.length,
    rows: sidecar(`${sc.id}_rows.f64`, new Float64Array(rows), [rows.length / ROW_FIELDS.length, ROW_FIELDS.length]),
    bulkNote: 'f64 per bulk row: floater items [x, z, yaw, h, nx, ny, nz, washT] × items; f32 per bulk row: collars n, rigging n, then collars (16 matrix + 4 data) × n, rigging (16 matrix + 3 colour) × n, floater instance matrices 16 × items, buoy lamp positions 3 × buoys',
    bulkLengths: bulk.map((a) => a.length), bulkF32Lengths: bulkF32.map((a) => a.length),
    bulk: sidecar(`${sc.id}_bulk.f64`, f64cat(bulk)),
    bulkF32: sidecar(`${sc.id}_bulk.f32`, f32cat(bulkF32)),
    hashes: sidecar(`${sc.id}_hash.u32`, new Uint32Array(hashes)),
    hashNote: 'h0 = 2166136261; per frame h = fnv1a32(fnv1a32(fnv1a32(h, frame row), bulk f64), bulk f32 widened to f64); hashes[i] = h after frame i + 1',
    events, oceanLog: log.filter((e) => e[1] > 0),
  };
}

const ROW_FIELDS = [
  'env.t', 'env.dt', 'env.night', 'env.fogK', 'env.haze', 'env.rain', 'env.intensity', 'env.visibility', 'env.Hs', 'env.flash', 'env.lightsOn', 'env.reduceFlashes',
  'env.wind.x', 'env.wind.y', 'env.windDir.x', 'env.windDir.y', 'env.current.x', 'env.current.y', 'env.focus.x', 'env.focus.y',
  'env.camPos.x', 'env.camPos.y', 'env.camPos.z', 'env.heliPos.x', 'env.heliPos.y', 'env.heliPos.z',
  ...Array.from({ length: 24 }, (_, i) => `ch${i}`),
  'uRim.r', 'uRim.g', 'uRim.b', 'uCloudK', 'uFoamCol.r', 'uFoamCol.g', 'uFoamCol.b', 'uScatter', 'uNightK', 'uFogNear', 'uFogFar', 'uLampK.x', 'uLampK.y', 'uLampK.z',
  'lh.angle', 'lh.on', 'lh.fogT', 'beam.uIntensity', 'beam.uDensity', 'beam.uPen', 'beam.uFall', 'flood.uIntensity', 'flood.uFall', 'flood.uPen',
  ...Array.from({ length: 6 }, (_, i) => [`glow${i}.x`, `glow${i}.y`, `glow${i}.z`, `glow${i}.w`, `glow${i}.r`, `glow${i}.g`, `glow${i}.b`]).flat(),
  'uSwell', 'uTFill.r', 'uTFill.g', 'uTFill.b',
  ...Array.from({ length: 4 }, (_, i) => [`tglow${i}.x`, `tglow${i}.y`, `tglow${i}.z`, `tglow${i}.w`, `tglow${i}.r`, `tglow${i}.g`, `tglow${i}.b`]).flat(),
  'spot.x', 'spot.y', 'spot.z', 'spotTarget.x', 'spotTarget.y', 'spotTarget.z', 'spot.intensity', 'point.x', 'point.y', 'point.z', 'point.intensity',
  'unload.pad', 'unload.t', 'collars.n', 'rigging.n', 'windsock.ext', 'windsock.dir.x', 'windsock.dir.y', 'shoalT',
  'boulders.island', 'veg.spruce', 'veg.shrub', 'veg.tuft', 'boulders.rocks', 'floaters.frame',
];

// terrainMaterial.js terrainUniforms: the module singleton every terrain material shares.
const TERU = (await scopeOf('systems/world/terrainMaterial.js')).scope.terrainUniforms;

function frameRow(world, ctx) {
  const env = world.env;
  const S = world.shared;
  const lh = world.lighthouse;
  const r = [env.t, env.dt, env.night, env.fogK, env.haze, env.rain, env.intensity, env.visibility, env.Hs, env.flash, env.lightsOn, env.reduceFlashes ? 1 : 0,
    env.wind.x, env.wind.y, env.windDir.x, env.windDir.y, env.current.x, env.current.y, env.focus.x, env.focus.y,
    env.camPos.x, env.camPos.y, env.camPos.z, env.heliPos.x, env.heliPos.y, env.heliPos.z,
    ...world.channels,
    S.uRim.value.r, S.uRim.value.g, S.uRim.value.b, S.uCloudK.value, S.uFoamCol.value.r, S.uFoamCol.value.g, S.uFoamCol.value.b, S.uScatter.value, S.uNightK.value,
    S.uFogNear.value, S.uFogFar.value, S.uLampK.value.x, S.uLampK.value.y, S.uLampK.value.z];
  const bm = world.mats.beam.uniforms, fm = world.mats.flood.uniforms;
  r.push(lh ? lh.angle : 0, lh ? lh.on ?? 0 : 0, lh ? lh.fogT : 0, bm.uIntensity.value, bm.uDensity.value, bm.uPen.value, bm.uFall.value, fm.uIntensity.value, fm.uFall.value, fm.uPen.value);
  for (let i = 0; i < 6; i++) r.push(...lhGlow(lh, i));
  const TU = TERU;
  r.push(TU.uSwell.value, TU.uTFill.value.r, TU.uTFill.value.g, TU.uTFill.value.b);
  for (let i = 0; i < 4; i++) {
    const p = TU.uTGlow.value[i], c = TU.uTGlowCol.value[i];
    r.push(p.x, p.y, p.z, p.w, c.r, c.g, c.b);
  }
  const L = world.lights;
  r.push(L.spot.position.x, L.spot.position.y, L.spot.position.z, L.spotTarget.position.x, L.spotTarget.position.y, L.spotTarget.position.z, L.spot.intensity,
    L.point.position.x, L.point.position.y, L.point.position.z, L.point.intensity);
  r.push(world._unload.pad ? world._unload.pad.id : -1, world._unload.t, world.collars.n, world.rigging.n,
    lh ? lh.windsock.ext : 0, lh ? lh.windsock.dir.x : 0, lh ? lh.windsock.dir.y : 0, world._shoalT);
  const land = lh?.land;
  r.push(land ? land.boulders.count : -1, land ? land.veg.meshes.spruce.count : -1, land ? land.veg.meshes.shrub.count : -1, land ? land.veg.meshes.tuft.count : -1,
    world.rockField ? world.rockField.rocks.reduce((s, rk) => s + (rk.boulders ? rk.boulders.count : 0), 0) : -1, world.floaters.frame);
  if (r.length !== ROW_FIELDS.length) throw new Error(`row ${r.length} != ${ROW_FIELDS.length}`);
  return r;
}
// Lighthouse prop material glow slot i: [x, y, z, radius, r, g, b] (materials.js setGlow → userData.uniforms uGlowPos / uGlowCol).
function lhGlow(lh, i) {
  if (!lh) return [0, 0, 0, 0, 0, 0, 0];
  const U = lh.material.userData.uniforms;
  const p = U.uGlowPos.value[i], c = U.uGlowCol.value[i];
  return [p.x, p.y, p.z, p.w, c.r, c.g, c.b];
}

function bulkRow(world, lamps) {
  const f64 = [];
  const items = world.floaters.items;
  for (const it of items) f64.push(it.x, it.z, it.yaw, it.h, it.nx, it.ny, it.nz, it.washT ?? -1);
  const C = world.collars, Rg = world.rigging;
  const f32 = [C.n, Rg.n];
  const cm = C.mesh.instanceMatrix.array, cd = C.data.array;
  for (let i = 0; i < C.n; i++) {
    for (let k = 0; k < 16; k++) f32.push(cm[i * 16 + k]);
    for (let k = 0; k < 4; k++) f32.push(cd[i * 4 + k]);
  }
  const rm = Rg.mesh.instanceMatrix.array, rc = Rg.mesh.instanceColor.array;
  for (let i = 0; i < Rg.n; i++) {
    for (let k = 0; k < 16; k++) f32.push(rm[i * 16 + k]);
    for (let k = 0; k < 3; k++) f32.push(rc[i * 3 + k]);
  }
  for (const it of items) {
    const a = world.floaters.banks.get(it.shape).mesh.instanceMatrix.array;
    for (let k = 0; k < 16; k++) f32.push(a[it.idx * 16 + k]);
  }
  const P = world.lamps.iPos.array;
  for (const i of lamps) for (let k = 0; k < 3; k++) f32.push(i >= 0 ? P[i * 3 + k] : 0);
  return { f64, f32: Float32Array.from(f32) };
}

// After mission:setup: everything static the world built.
function setupRecord(world, ctx, log) {
  const v3 = (v) => (v ? [num(v.x), num(v.y), num(v.z)] : null);
  const pads = world.pads.map((p) => ({
    id: p.id, name: p.name, type: p.type, position: v3(p.position), radius: num(p.radius), height: num(p.height), tilt: p.tilt, pitch: p.pitch, roll: p.roll,
    up: v3(p.up), velocity: v3(p.velocity), heading: num(p.heading), refuel: p.refuel, services: p.services, lee: p.lee, place: world.places.indexOf(p.place),
  }));
  const obstacles = world.obstacles.map((o) => ({ x: num(o.x), z: num(o.z), radius: num(o.radius), top: num(o.top), kind: o.kind, name: o.name }));
  const places = world.places.map((pl) => ({
    type: pl.constructor.name, x: num(pl.x), z: num(pl.z), name: pl.name,
    padPosition: v3(pl.padPosition), padRadius: num(pl.padRadius), lantern: v3(pl.lantern), hoop: v3(pl.hoop),
    island: { x: num(pl.island.x), z: num(pl.island.z), radius: pl.island.radius, top: pl.island.top },
    doorLamp: nums(pl.doorLamp), porchLamp: nums(pl.porchLamp), walkLamps: pl.walkLamps.map(nums), jettyHead: nums(pl.jettyHead), piles: pl.piles.map(nums),
    shoals: pl.shoals.map((s) => [num(s.x), num(s.z), num(s.radius)]), angle: num(pl.angle), fogT: num(pl.fogT),
    unloadLamps: pl.unloadLamps, lanternLamp: pl.lanternLamp,
    buildQuality: ctx.settings.get('quality'),
    boulders: pl.land.boulders.userData.full, boulderMatrices: nums(pl.land.boulders.instanceMatrix.array.subarray(0, pl.land.boulders.userData.full * 16)),
    veg: Object.fromEntries(Object.entries(pl.land.veg.meshes).map(([k, m]) => [k, { full: m.userData.full, count: m.count, visible: m.visible }])),
    landObstacles: pl.land.obstacles.length,
  }));
  const L = world.lamps;
  const lamps = { count: L.count, iPos: nums(L.iPos.array.subarray(0, L.count * 3)), iCol: nums(L.iCol.array.subarray(0, L.count * 4)), iSz: nums(L.iSz.array.subarray(0, L.count * 4)) };
  const fl = world.floaters;
  const items = fl.items.map((it) => ({
    shape: it.shape, x: num(it.x), z: num(it.z), yaw: num(it.yaw), yawRate: num(it.yawRate), roll: num(it.roll), pitch: num(it.pitch), tilt: num(it.tilt),
    h: num(it.h), nx: num(it.nx), ny: num(it.ny), nz: num(it.nz), phase: num(it.phase), color: it.color, idx: it.idx, moored: it.moored ? [num(it.moored.x), num(it.moored.z)] : null,
    light: it.light, every: it.every, R: num(it.R), leeway: num(it.leeway), kind: it.kind ?? null, sink: it.sink !== undefined ? num(it.sink) : null, long: it.long ?? null, chain: it.chain ?? null,
  }));
  const banks = {};
  for (const [shape, b] of fl.banks) banks[shape] = { n: b.n, max: b.max, visible: b.mesh.visible, colors: b.mesh.instanceColor ? nums(b.mesh.instanceColor.array.subarray(0, b.n * 3)) : null };
  const rf = world.rockField;
  const rocks = rf ? rf.rocks.map((rk) => ({ boulders: rk.boulders ? rk.boulders.userData.full : 0, count: rk.boulders ? rk.boulders.count : 0,
    matrices: rk.boulders ? nums(rk.boulders.instanceMatrix.array.subarray(0, rk.boulders.userData.full * 16)) : [] })) : [];
  // the terrain meshes the ocean bakes its coast map from (ocean.js _syncCoast: non-instanced meshes with aTerr)
  const verts = [];
  let key = 0;
  const _v = new THREE.Vector3();
  ctx.scene.updateMatrixWorld(true);
  ctx.scene.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.aTerr) {
      key++;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        verts.push(_v.x, _v.y, _v.z);
      }
    }
  });
  const coast = bakeCoast(ctx.scene);
  const cp = points(4242, 300, -140, -140, 140, 140);
  const coastRec = coast ? { w: coast.w, h: coast.h, x0: num(coast.x0), z0: num(coast.z0), cell: num(coast.cell), sha: sha256(Buffer.from(coast.data)),
    x: nums(cp.x), z: nums(cp.z), d: cp.x.map((x, k) => num(coastDistance(coast, x, cp.z[k]))) } : null;
  return {
    pads, obstacles, places, shoals: world._shoals.map((s) => [num(s.x), num(s.z), num(s.radius)]),
    lighthouse: world.lighthouse ? world.places.indexOf(world.lighthouse) : -1,
    lamps, items, banks, buoys: fl.buoys.map((b) => fl.items.indexOf(b)), duckSource: fl.duckSource ? [num(fl.duckSource.x), num(fl.duckSource.z)] : null,
    rocks, haloBase: num(world._haloBase), quality: world.quality, current: world.current,
    terrain: { meshes: key, vertices: verts.length / 3, sha: f64sha(verts) },
    coast: coastRec,
    setupLog: log.filter((e) => e[1] === 0),
  };
}

// ===================================================================================== setup_first_<q>
if (want('setup')) {
  for (const q of QUALITIES) {
    const sc = { id: `setup_first_${q}`, def: DEF1, quality: q, frames: 0, every: 1, bulkEvery: 1, dt: () => 1 / 60, ...SCRIPT_FIRST(), actions: {} };
    const ctx = makeCtx(sc);
    const log = [];
    ctx.ocean = makeOcean(ctx, log);
    const st = { windDir: new THREE.Vector2(1, 0), windSpeed: 0, palette: {} };
    ctx.weather = { state: st, windAt: (x, z, o) => windAt(st, ctx.time.t, x, z, o) };
    const world = new World(ctx);
    world.init();
    ctx.events.emit('mission:setup', { def: DEF1 });
    out('world', `setup_first_${q}`, {
      data: {
        setup: `a real World (systems/world.js) on a stub ctx (quality ${q}, detail 1, empty weather state, camera at (0, 220, 60) looking along normalize(0, −0.965, −0.26), no heli, analytic ocean at t = 0 — see run_first.setup.ocean) after init() and mission:setup with the prepared op1 def`,
        def: worldDef(DEF1),
        ...setupRecord(world, ctx, log),
      },
    });
  }
}

// ===================================================================================== run_first / run_mix
function SCRIPT_FIRST() {
  return {
    night: (t) => 0.85 * sm(18, 34, t),
    // thick from 2–6 s; a short clearing at 11.0–11.6 s (the horn timer clamps to 26 s); gone after 46–48 s
    fog: (t) => 0.92 * sm(2, 6, t) * (1 - sm(46, 48, t)) * (t > 11 && t < 11.6 ? 0.3 : 1),
    rain: (t) => 0.6 * sm(24, 30, t) * (1 - sm(38, 42, t)),
    camera: (t) => {
      const a = t * 0.12;
      const px = 140 * Math.sin(a), pz = 60 + 120 * Math.cos(a);
      const dx = -0.25 * Math.sin(a + 0.4), dz = -0.27 * Math.cos(a), dy = -0.93;
      return [px, 200 + 30 * Math.sin(t * 0.21), pz, dx, dy, dz];
    },
    heli: (t) => (t > 14 && t < 15.5 ? null : [30 * Math.sin(t * 0.3), 25 + 10 * Math.sin(t * 0.17), -40 + 60 * Math.cos(t * 0.23)]),
    palette: (frame) => !(frame >= 900 && frame < 960),
  };
}

const ROWS_EVERY = 4, BULK_EVERY = 20;
if (want('run')) {
  const actions = {};
  const at = (f, ...a) => (actions[f] ||= []).push(a);
  at(300, 'event', 'heli:land', 0);
  at(420, 'event', 'heli:unload-person', 0);
  at(470, 'event', 'heli:unload', 0);
  at(560, 'event', 'heli:takeoff', -1);
  at(640, 'event', 'heli:unload-person', 0);
  at(700, 'reduceFlashes', true);
  at(1150, 'reduceFlashes', false);
  at(1300, 'quality', 'medium');
  at(1800, 'quality', 'low');
  at(2100, 'quality', 'high');
  at(1500, 'event', 'heli:unload', -1);
  const dt = (f) => (f >= 200 && f < 230 ? 0 : f % 97 === 0 ? 1 / 30 : f % 41 === 0 ? 0.1 : f % 13 === 0 ? 1 / 120 : 1 / 60);
  const sc = { id: 'run_first', def: DEF1, quality: 'high', detail: 1, frames: 2700, every: ROWS_EVERY, bulkEvery: BULK_EVERY, dt,
    ...SCRIPT_FIRST(), hazards: { from: 30, to: 36, x: 228, z: -236 }, actions };
  const data = runWorld(sc);
  out('world', 'run_first', {
    tolerance: CHAOS,
    data: {
      setup: {
        note: 'a real World on stub systems (see setup_first_high for the ctx); per frame: t += dt, the inputs row is applied (weather state, palette, scene.fog near / far, camera pose, heli, hazards, actions), then world.update(dt)',
        def: worldDef(DEF1), quality: 'high', detail: 1, params: '', oceanAmp: 1,
        ocean: 'heightAt(x, z) = amp·(0.35·sin(0.11x + 0.9t) + 0.22·cos(0.07z − 0.6t + 0.3·sin(0.02x))) (amp = setup.oceanAmp); normalAt = normalize(−(h(x+.5,z) − h(x−.5,z))/1, 1, −(h(x,z+.5) − h(x,z−.5))/1); searchlightAt = d < 30 ? 1 − d/30 : 0 (d = hypot to the heli, 0 without heli); t = ctx.time.t',
        wind: 'windAt(x, z): k = 1 + 0.15·sin(0.013x + 0.017z + 0.7t), a = 0.2·sin(0.009x − 0.011z + 0.3t); w = windDir·windSpeed·k rotated by a: (wx·cos a − wz·sin a, wx·sin a + wz·cos a)',
        hazards: 'surfaceFlowAt(x, z) around (cx, cz): d2 = dx² + dz², k = 0.6·exp(−d2/3600)/(sqrt(d2) + 1), flow = (−dz·k, dx·k); present when the inputs say so',
        hazardCentre: [228, -236],
        palette: 'when paletteColours: ambient = #9FB4C4.lerp(#1C2836, night), sun = #FFF1DA.lerp(#7E8FB0, night), foam = #F1F4EE.lerp(#9AA6B0, night) (THREE.Color linear); sea.Hs, shadowIntensity, ambientIntensity, sunIntensity always',
        state: 'weather.state = {night, rain, intensity, visibility, fog, windDir (Vector2), windSpeed, flash, waveHeight, palette}',
      },
      ...data,
    },
  });
}

if (want('run')) {
  // synthetic def: every debris mix, containers, all buoy kinds, a scenery lighthouse off the origin, rocks
  const def = {
    id: 'mix', seed: 202, current: { x: -0.3, z: 0.2 },
    world: {
      pads: [],
      props: {
        lighthouse: { x: 400, z: -300 },
        rocks: [{ x: 150, z: 120, radius: 18, height: 14 }, { x: -120, z: 60, radius: 9, height: 3, name: 'Кошки' }],
        buoys: BUOY_KINDS.map((kind, i) => ({ x: -200 + 70 * i, z: -120 + 25 * i, kind })).concat([{ x: 60, z: 260, kind: 'bogus' }]),
        debris: ['kayak', 'paddle', 'luggage', 'planks', 'sail', 'nets', 'barrels', 'whatever'].map((kind, i) => ({ x: -150 + 60 * i, z: 200 - 30 * i, radius: 20 + i, count: 4 + (i % 3), kind })),
        containers: [{ x: 300, z: 100 }, { x: 330, z: 130, color: '#1F5E8C' }, { x: 360, z: 90 }],
      },
    },
  };
  const actions = {};
  (actions[200] ||= []).push(['reduceFlashes', true]);
  (actions[420] ||= []).push(['quality', 'high']);
  const S = SCRIPT_FIRST();
  const sc = { id: 'run_mix', def, quality: 'low', detail: 0.6, params: 'ducks', oceanAmp: 4, frames: 600, every: ROWS_EVERY, bulkEvery: BULK_EVERY * 2, dt: (f) => (f % 7 === 0 ? 1 / 30 : 1 / 60),
    ...S, night: (t) => 0.2 + 0.6 * sm(0, 8, t), fog: (t) => 0.5 * sm(0, 5, t), rain: (t) => 0.3, palette: () => true,
    camera: (t) => [300 + 40 * Math.sin(t * 0.2), 180, 60 + 40 * Math.cos(t * 0.2), 0.1, -0.95, -0.28],
    heli: (t) => [320 + 10 * Math.sin(t), 20, 110], hazards: { from: 4, to: 8, x: 330, z: 110 }, actions };
  const data = runWorld(sc);
  out('world', 'run_mix', {
    tolerance: CHAOS,
    data: { setup: { note: 'run_first runner (same ocean / wind / hazard / palette stubs; a 4× swell so the containers awash) on a synthetic def; params has "ducks"', def: worldDef(def), quality: 'low', detail: 0.6, params: 'ducks', oceanAmp: 4, hazardCentre: [330, 110] }, ...data },
  });
}

// ===================================================================================== rhythms
if (want('rhythms')) {
  const t = [];
  for (let i = 0; i <= 640; i++) t.push(num(i * 0.0371 + (i % 5) * 0.001));
  const kinds = [...BUOY_KINDS, 'other'];
  out('world', 'rhythms', {
    files: [relSrc('systems/world/floaters.js')],
    data: {
      setup: 'buoyRhythm(kind, t, reduce) for every kind (and an unknown one → the Fl Y default) on t_i = 0.0371·i + 0.001·(i % 5)',
      t, kinds,
      normal: kinds.map((k) => t.map((x) => num(buoyRhythm(k, x, false)))),
      reduced: kinds.map((k) => t.map((x) => num(buoyRhythm(k, x, true)))),
    },
  });
}

for (const r of results) console.log(`${r.path}\t${r.bytes}`);
