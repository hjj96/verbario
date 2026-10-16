// export-vectors: CPU parity vectors from the web code (Node 22 = reference engine) ->
// rescue-apple/Tests/Vectors/<domain>/<name>.json (+ little-endian .f64 sidecars for jsmath).
//
// Every file: wrapper (schema, version, source = web git HEAD, producer) + "tolerance" + "data" holding
// the exact inputs the Swift test must feed and the outputs it must reproduce. Numbers are JS shortest
// round-trip decimals (exact for doubles); specials are strings ("NaN", "Infinity", "-0").
//
// Usage: node rescue-apple/tools/export/export-vectors.mjs [--only math,look,palette,ocean,heli,mission,text] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { APPLE, num, serialize, writeWrapped, writeSidecar, relSrc, sha256 } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/export-vectors.mjs';
const results = [];

console.warn = () => {};

const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern; report index, both values and ulp distance on mismatch' };

function out(domain, name, { files, tolerance, data, extra = {} }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance, ...extra }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}

const N = (a) => Array.from(a, num);
// Deterministic input generator for the vectors themselves (mulberry32, same as createRng).
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function grid(n, lo, hi) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1));
  return a;
}

// ===================================================================================================== math
async function math() {
  const M = await gameImport('core/math.js');

  // --- rng.json -----------------------------------------------------------------------------------
  const SEEDS = [1, 77, 101, 202, 303, 404, 505, 606, 707, 808, 909, 911, 1234, 1337, 4040, 4242, 5521, 5531, 7713, 9173, 12345, 1234567, 4294967295];
  const sequences = SEEDS.map((seed) => { const r = M.createRng(seed); return { seed, next: Array.from({ length: 256 }, () => r.next()) }; });
  const PICK = ['a', 'b', 'c', 'd', 'e'];
  const OPS = ['next', 'range', 'int', 'pick', 'chance', 'sign', 'gauss'];
  const api = [1, 101, 1337, 4242, 9173, 1234567].map((seed) => {
    const r = M.createRng(seed);
    const calls = [];
    for (let i = 0; i < 140; i++) {
      const op = OPS[i % OPS.length];
      let v;
      switch (op) {
        case 'next': v = r.next(); break;
        case 'range': v = r.range(-5, 12.5); break;
        case 'int': v = r.int(0, 9); break;
        case 'pick': v = PICK.indexOf(r.pick(PICK)); break;
        case 'chance': v = r.chance(0.3); break;
        case 'sign': v = r.sign(); break;
        case 'gauss': v = r.gauss(); break;
      }
      calls.push([op, typeof v === 'number' ? num(v) : v]);
    }
    return { seed, calls };
  });
  // Seed derivations used by the systems (file:line in data.formulas[].site; see game.json derived.seedSites).
  const MS = [1, 101, 202, 303, 404, 505, 606, 707, 808, 909, 20261016, 4294967295];
  const formulas = [
    { id: 'weather', site: 'systems/weather.js: createRng(((def.seed ?? 1) * 7919 + 13) >>> 0)', f: (s) => ((s * 7919 + 13) >>> 0) },
    { id: 'hazards', site: 'systems/hazards.js: rng32(((Number(def.seed) || 1) * 2246822519 + 77) >>> 0)', f: (s) => (((s || 1) * 2246822519 + 77) >>> 0) },
    { id: 'survivors', site: 'systems/survivors.js: createRng((((def?.seed ?? 1) >>> 0) * 31 + 7) >>> 0)', f: (s) => ((((s >>> 0) * 31) + 7) >>> 0) },
    { id: 'oceanSeed', site: 'systems/ocean.js: bank.setSeed(seed + 101, …) with seed = def.seed | 0', f: (s) => ((s | 0) + 101) },
    { id: 'oceanSwellOffsetRad', site: 'systems/ocean.js: ((((seed * 2654435761) >>> 0) / 4294967296) * 40 - 20) * DEG', f: (s) => (((((s | 0) * 2654435761) >>> 0) / 4294967296) * 40 - 20) * (Math.PI / 180) },
    { id: 'peopleFallback', site: 'systems/survivors.js: makeFallbackPeople((def.seed ?? 1) * 97 + s.id, …) (here s.id = 3)', f: (s) => s * 97 + 3 },
  ];
  out('math', 'rng', {
    files: [relSrc('core/math.js')], tolerance: BITWISE,
    data: {
      algorithm: 'mulberry32: s = (s + 0x6d2b79f5) >>> 0; t = imul(s ^ s>>>15, s | 1); t ^= t + imul(t ^ t>>>7, t | 61); ((t ^ t>>>14) >>> 0) / 2^32',
      sequences,
      api: { ops: { range: [-5, 12.5], int: [0, 9], pick: PICK, chance: 0.3 }, note: 'calls cycle next,range,int,pick(index),chance,sign,gauss on one fresh generator per seed', cases: api },
      seedFormulas: { missionSeeds: MS, formulas: formulas.map((x) => ({ id: x.id, site: x.site, values: MS.map((s) => num(x.f(s))) })) },
    },
  });

  // --- lcg.json -----------------------------------------------------------------------------------
  const lcg = (mul, add, seed, n) => { let s = seed >>> 0; const o = []; for (let i = 0; i < n; i++) { s = (s * mul + add) >>> 0; o.push(s); } return o; };
  out('math', 'lcg', {
    files: ['rescue/src/core/look.js', 'rescue/src/systems/post/thermal.js', 'rescue/src/systems/ocean/selftest.js', 'rescue/src/ui/common/chart.js', 'rescue/src/ui/common/transition.js', 'rescue/src/ui/flight/radar.js', 'rescue/src/systems/world/decals.js', 'rescue/src/systems/hazards/vortexfx.js'],
    tolerance: { class: 'bitwise', note: 'UInt32 state; JS computes s*mul+add exactly in double (< 2^53) then >>> 0 = wrapping UInt32 arithmetic' },
    data: {
      numerical: { mul: 1664525, add: 1013904223, sites: ['core/look.js makeDetail', 'post/thermal.js', 'ocean/selftest.js', 'ui/common/chart.js', 'ui/common/transition.js', 'world/decals.js', 'hazards/vortexfx.js'], cases: [1, 10, 913, 1234567, 4294967295].map((seed) => ({ seed, states: lcg(1664525, 1013904223, seed, 200) })) },
      ansiC: { mul: 1103515245, add: 12345, sites: ['ui/common/transition.js', 'ui/flight/radar.js'], cases: [1, 42, 4294967295].map((seed) => ({ seed, states: lcg(1103515245, 12345, seed, 200) })) },
      float: 'rnd() = state / 4294967296 after each step',
    },
  });

  // --- noise.json ---------------------------------------------------------------------------------
  const xs = grid(32, -300, 300);
  const noiseCases = [1337, 2024, 4242, 5531, 9173].map((seed) => {
    const n = M.createNoise2D(seed);
    const v = [];
    for (const y of xs) for (const x of xs) v.push(n(x, y));
    return { seed, values: N(v) };
  });
  const n1337 = M.createNoise2D(1337);
  const fx = grid(16, -40, 40);
  const fbm = [];
  for (const y of fx) for (const x of fx) fbm.push(M.fbm2(n1337, x, y, 4, 2, 0.5));
  const fbm6 = [];
  for (const y of fx) for (const x of fx) fbm6.push(M.fbm2(n1337, x * 0.37, y * 0.37, 6, 2.13, 0.47));
  // FlightModel's turbulence lookups: noise(t·0.9, 3.7), noise(t·0.9, 41.3) for t = k/60
  const n9173 = M.createNoise2D(9173);
  const flightNoise = [];
  for (let k = 1; k <= 120; k++) { const t = k / 60; flightNoise.push(n9173(t * 0.9, 3.7), n9173(t * 0.9, 41.3)); }
  out('math', 'noise', {
    files: [relSrc('core/math.js')], tolerance: BITWISE,
    data: {
      grid: { axis: N(xs), order: 'row-major: for y in axis, for x in axis → noise(x, y)' },
      simplex: noiseCases,
      fbm2: [
        { seed: 1337, octaves: 4, lacunarity: 2, gain: 0.5, axis: N(fx), scale: 1, values: N(fbm) },
        { seed: 1337, octaves: 6, lacunarity: 2.13, gain: 0.47, axis: N(fx), scale: 0.37, values: N(fbm6) },
      ],
      flightTurbulence: { seed: 9173, note: 'pairs [noise(t*0.9, 3.7), noise(t*0.9, 41.3)] for t = k/60, k = 1…120', values: N(flightNoise) },
    },
  });

  // --- util.json ----------------------------------------------------------------------------------
  const THREE = await import('three');
  const W = await gameImport('systems/ocean/waves.js');
  const xsU = [-1e9, -10, -1, -0.5, -0, 0, 1e-12, 0.1, 0.25, 0.49999999999999994, 0.5, 0.75, 0.9999999999999999, 1, 1.5, 10, 1e9];
  const angles = [-100, -7, -Math.PI - 1e-12, -Math.PI, -3, -1, -0, 0, 1, 3, Math.PI, Math.PI + 1e-12, 2 * Math.PI, 7, 100, 12345.678];
  const util = {
    clamp: xsU.map((x) => [num(x), num(M.clamp(x, 0, 1))]),
    lerp: [[0, 10, 0.3], [-5, 5, 1.5], [1e8, 1e8 + 1, 0.5], [0.1, 0.2, 0.7]].map(([a, b, t]) => [a, b, t, num(M.lerp(a, b, t))]),
    invLerp: [[0, 10, 3], [10, 0, 3], [0, 10, -1], [0, 10, 11], [2, 2.5, 2.25]].map(([a, b, v]) => [a, b, v, num(M.invLerp(a, b, v))]),
    remap: [[3, 0, 10, 100, 200], [-3, 0, 10, 100, 200], [0.42, 0.1, 0.9, -1, 1]].map(([v, a, b, c, d]) => [v, a, b, c, d, num(M.remap(v, a, b, c, d))]),
    smoothstepCore: { signature: 'smoothstep(a, b, v) core/math.js', cases: xsU.map((v) => [0.1, 0.9, num(v), num(M.smoothstep(0.1, 0.9, v))]) },
    smoothstepOcean: { signature: 'smoothstep(a, b, x) ocean/waves.js', cases: xsU.map((v) => [3.5, 5, num(v), num(W.smoothstep(3.5, 5, v))]) },
    smoothstepThree: { signature: 'THREE.MathUtils.smoothstep(x, min, max)', cases: xsU.map((v) => [num(v), 0.05, 0.35, num(THREE.MathUtils.smoothstep(v, 0.05, 0.35))]) },
    damp: [[0, 1, 4, 1 / 60], [5, -5, 0.5, 0.1], [1, 1, 10, 1], [0, 100, 50, 0]].map(([c, t, l, dt]) => [c, t, l, dt, num(M.damp(c, t, l, dt))]),
    dampAngle: [[3, -3, 4, 1 / 60], [-3, 3, 4, 1 / 60], [0, 6, 8, 0.1], [1, 1.5, 2, 0.5]].map(([c, t, l, dt]) => [c, t, l, dt, num(M.dampAngle(c, t, l, dt))]),
    wrapAngle: angles.map((a) => [num(a), num(M.wrapAngle(a))]),
  };
  out('math', 'util', { files: [relSrc('core/math.js'), relSrc('systems/ocean/waves.js')], tolerance: BITWISE, data: util });

  // --- jsmath.json + sidecars -------------------------------------------------------------------------
  const R = mulberry(0x5eed);
  const range = (lo, hi) => lo + (hi - lo) * R();
  const mixed = () => { const k = R(); return k < 0.25 ? range(-4, 4) : k < 0.5 ? range(-450, 450) : k < 0.75 ? range(-5e4, 5e4) : range(-0.01, 0.01); };
  const SPECIAL = [0, -0, 1, -1, 0.5, -0.5, Math.PI, -Math.PI, Math.PI / 2, 1e-300, -1e-300, 5e-324, 1e300, -1e300, Infinity, -Infinity, NaN, 709.78, 710, -745.2, 1e-8];
  const fns = {
    sin: [1, () => mixed()], cos: [1, () => mixed()], tan: [1, () => mixed()],
    exp: [1, () => range(-40, 40)], log: [1, () => (R() < 0.5 ? range(0, 4) : range(0, 5e4))], atan: [1, () => mixed()],
    asin: [1, () => range(-1, 1)], acos: [1, () => range(-1, 1)], sinh: [1, () => range(-20, 20)], tanh: [1, () => range(-20, 20)],
    expm1: [1, () => range(-5, 5)], log1p: [1, () => range(-0.99, 50)],
    atan2: [2, () => [mixed(), mixed()]], pow: [2, () => (R() < 0.8 ? [range(0, 50), range(-4, 4)] : [range(-10, 10), Math.round(range(-6, 6))])],
    hypot: [2, () => [mixed(), mixed()]], hypot3: [3, () => [mixed(), mixed(), mixed()]],
  };
  const COUNT = 4096;
  const jsm = {};
  for (const [name, [arity, gen]] of Object.entries(fns)) {
    const f = name === 'hypot3' ? (a, b, c) => Math.hypot(a, b, c) : Math[name];
    const rows = new Float64Array(COUNT * (arity + 1));
    for (let i = 0; i < COUNT; i++) {
      let ins;
      if (i < SPECIAL.length * (arity === 1 ? 1 : 2)) {
        const s = SPECIAL[i % SPECIAL.length];
        ins = arity === 1 ? [s] : arity === 2 ? (i < SPECIAL.length ? [s, 2] : [2, s]) : [s, 1, 2];
      } else ins = arity === 1 ? [gen()] : gen();
      const o = f(...ins);
      for (let k = 0; k < arity; k++) rows[i * (arity + 1) + k] = ins[k];
      rows[i * (arity + 1) + arity] = o;
    }
    jsm[name] = { arity, ...writeSidecar(path.join(OUT, 'math', `jsmath_${name}.f64`), rows, [COUNT, arity + 1]) };
  }
  out('math', 'jsmath', {
    files: ['Node ' + process.version + ' Math.*'],
    tolerance: { class: 'bitwise', note: 'JS.<fn> (CJSMath: fdlibm + V8 hypot) must equal Node 22 bit for bit; pow: <= 1 ulp until the V8 ieee754::pow port lands (PLAN §5.2)', powMaxUlp: 1 },
    data: { node: process.version, layout: 'each sidecar: Float64 LE rows [in0, (in1, in2,) out], shape [count, arity+1]; hypot3 = Math.hypot(a, b, c)', functions: jsm },
  });
}

// ===================================================================================================== look
async function look() {
  const { Look, GUST_SCALE, GUST_DRIFT, CLOUD_SCALE, CLOUD_DRIFT } = await gameImport('core/look.js');
  const L = new Look(7);
  const axis = grid(32, -2000, 2000);
  const offsets = [[0, 0], [123.4, -56.7], [-1834.25, 977.5], [50000.125, -31000.5]];
  const fields = offsets.map(([ox, oz]) => {
    L.uniforms.uWindOffset.value.set(ox, oz);
    const gust = [], cloud = [];
    for (const z of axis) for (const x of axis) { gust.push(L.gustField(x, z)); cloud.push(L.cloudAt(x, z)); }
    return { windOffset: [ox, oz], gustField: N(gust), cloudAt: N(cloud) };
  });
  const frontSets = [
    [{ x: 0, z: 0, dirX: 1, dirZ: 0, strength: 1 }],
    [{ x: 300, z: -200, dirX: 0.6, dirZ: 0.8, strength: 0.8, width: 220, length: 900 }, { x: -700, z: 400, dirX: -0.8, dirZ: 0.6, strength: 1.4, width: 90, length: 300 }],
    [{ x: 0, z: 0, dirX: 0, dirZ: 1, strength: 0.5 }, { x: 0, z: 0, dirX: 1, dirZ: 0, strength: 0 }, { x: 1500, z: 1500, dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2, strength: 2, width: 400, length: 2000 }, { x: -1900, z: -1900, dirX: 1, dirZ: 0, strength: 1 }],
  ];
  const fronts = frontSets.map((set) => {
    L.setFronts(set);
    const v = [];
    for (const z of axis) for (const x of axis) v.push(L.frontsAt(x, z));
    return { fronts: set.map((f) => serialize(f)), frontsAt: N(v) };
  });
  const R = mulberry(77);
  const samples = { atlas: [], lace: [], detail: [] };
  for (let i = 0; i < 256; i++) {
    const u = (R() - 0.5) * 8, v = (R() - 0.5) * 8, ch = Math.floor(R() * 4);
    samples.atlas.push([num(u), num(v), ch, num(L.sampleAtlas(u, v, ch))]);
    samples.lace.push([num(u), num(v), ch, num(L.sampleLace(u, v, ch))]);
    samples.detail.push([num(u), num(v), ch, num(L.sampleDetail(u, v, ch))]);
  }
  const tex = {};
  for (const k of ['atlas', 'detail', 'lace']) { const d = L[k].image.data; tex[k] = { width: L[k].image.width, sha256: sha256(Buffer.from(d.buffer, d.byteOffset, d.byteLength)), file: `Resources/Textures/${k}.rgba` }; }
  out('look', 'fields', {
    files: [relSrc('core/look.js')], tolerance: BITWISE,
    data: {
      lookSeed: 7, textures: tex, constants: { GUST_SCALE, GUST_DRIFT, CLOUD_SCALE, CLOUD_DRIFT },
      grid: { axis: N(axis), order: 'row-major: for z in axis, for x in axis' },
      setup: 'look.uniforms.uWindOffset = windOffset (set directly); setFronts(fronts) — width/length default 140/500, strength <= 0 skipped',
      wind: fields, fronts, samples: { note: '[u, v, channel, value]; sampleAtlas/Lace/Detail bilinear wrap of the RGBA8 textures', ...samples },
    },
  });
}

// ================================================================================================= palette
async function palette() {
  const P = await gameImport('systems/weather/palette.js');
  const { PRESETS, PRESET_NAMES } = await gameImport('systems/weather/presets.js');
  const THREE = await import('three');
  const c = new THREE.Color();
  const hexes = new Set();
  const walk = (v) => { if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) hexes.add(v.toLowerCase()); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(PRESETS);
  const srgb = [...hexes].sort().map((h) => { c.set(h); return [h, num(c.r), num(c.g), num(c.b)]; });
  const T = [[0, 0, 0, 0], [0.25, 0.25, 0.25, 0.25], [1, 0.5, 0.25, 0], [0.7, 1, 0.1, 0.9], [1, 1, 1, 1]];
  const pairs = [['calm', 'storm'], ['fog', 'nightStorm'], ['clearing', 'squall']];
  const blends = pairs.map(([a, b]) => ({ a, b, cases: T.map((t) => ({ t, out: N(P.blendPacked(new Float64Array(P.SLOTS), P.COMPILED[a], P.COMPILED[b], t)) })) }));
  const green = [0.35, 1].map((g) => ({ preset: 'storm', g, out: N(P.applyGreen(Float64Array.from(P.COMPILED.storm), g)) }));
  const pal = P.createPalette();
  P.unpack(pal, P.blendPacked(new Float64Array(P.SLOTS), P.COMPILED.calm, P.COMPILED.nightStorm, [0.5, 0.5, 0.5, 0.5]));
  out('weather', 'palette', {
    files: [relSrc('systems/weather/palette.js'), relSrc('systems/weather/presets.js')], tolerance: BITWISE,
    data: {
      srgbToLinear: { note: '[hex, r, g, b] — THREE.Color.set(hex) with ColorManagement (sRGB → linear working space)', values: srgb },
      compiled: Object.fromEntries(PRESET_NAMES.map((n) => [n, N(P.COMPILED[n])])),
      blendPacked: blends,
      applyGreen: green,
      unpack: { from: 'blendPacked(calm, nightStorm, [0.5,0.5,0.5,0.5])', palette: serialize(pal) },
    },
  });
}

// =================================================================================================== ocean
async function ocean() {
  const Wv = await gameImport('systems/ocean/waves.js');
  const { PRESETS, PRESET_NAMES } = await gameImport('systems/weather/presets.js');
  const THREE = await import('three');
  const DEG = Math.PI / 180;
  const seed = 101;
  const windAngle = 0.6;
  const off = ((((seed * 2654435761) >>> 0) / 4294967296) * 40 - 20) * DEG;
  const foci = [[0, 0], [412.5, -233.25]];
  const near = grid(13, -60, 60);
  const wide = grid(11, -1300, 1300);
  const times = [0, 12.5, 600.25];
  const nrm = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const sample = (bank, ox, oz, axis, tOff = 0, withVel = true) => {
    const h = [], n = [], v = [];
    for (const dz of axis) for (const dx of axis) {
      const x = ox + dx, z = oz + dz;
      h.push(bank.heightAt(x, z, tOff));
      bank.normalAt(x, z, nrm, tOff); n.push(nrm.x, nrm.y, nrm.z);
      if (withVel) { bank.velocityAt(x, z, vel, tOff); v.push(vel.x, vel.y, vel.z); }
    }
    return withVel ? { height: N(h), normal: N(n), velocity: N(v) } : { height: N(h), normal: N(n) };
  };
  const state = (b) => ({
    a: N(b.a), aTarget: N(b.aTarget), b: N(b.b), phase: N(b.phase), phi0: N(b.phi0), Dx: N(b.Dx), Dz: N(b.Dz), align: N(b.align),
    uWaveA: N(b.uWaveA), uWaveB: N(b.uWaveB), stats: serialize(b.stats),
  });
  const shortScaleOf = (sea) => 1 - 0.75 * Math.min(Math.max(sea.clearing ?? Wv.smoothstep(0.8, 1.4, sea.swellAdd ?? 0), 0), 1);
  for (const name of PRESET_NAMES) {
    const sea = PRESETS[name].sea;
    const seaIn = { Hs: sea.Hs, swellAdd: sea.swellAdd, Q: sea.Q, clearing: sea.clearing };
    const shortScale = shortScaleOf(sea);
    const bank = new Wv.WaveBank();
    bank.setQuality(8, 300);
    bank.setSeed(seed + 101, windAngle + off);
    const cases = [];
    for (const [ox, oz] of foci) for (const t of times) {
      bank.update(0, t, seaIn, windAngle, shortScale, ox, oz);
      cases.push({ focus: [ox, oz], t, state: state(bank), near: sample(bank, ox, oz, near), wide: sample(bank, ox, oz, wide, 0, false) });
    }
    // tOff prediction (used by buoyancy look-ahead): t = 12.5, focus 0, tOff = 0.5 on the near grid
    bank.update(0, 12.5, seaIn, windAngle, shortScale, 0, 0);
    const tOff = { focus: [0, 0], t: 12.5, tOff: 0.5, near: sample(bank, 0, 0, near, 0.5) };
    const extra = {};
    if (name === 'storm') {
      // amplitude smoothing: snap to calm, then 30 s of storm sea at dt = 1/60 (grow τ 8 s, decay τ 20 s)
      const b2 = new Wv.WaveBank();
      b2.setQuality(8, 300);
      b2.setSeed(seed + 101, windAngle + off);
      const calm = PRESETS.calm.sea;
      b2.update(1 / 60, 0, { Hs: calm.Hs, swellAdd: calm.swellAdd, Q: calm.Q, clearing: calm.clearing }, windAngle, shortScaleOf(calm), 0, 0);
      const trace = [];
      for (let i = 1; i <= 1800; i++) {
        b2.update(1 / 60, i / 60, seaIn, windAngle, shortScale, 0, 0);
        if (i % 60 === 0) trace.push({ step: i, a: N(b2.a), HsEff: num(b2.stats.HsEff) });
      }
      extra.blend = { from: 'calm (snap at t=0, dt=1/60)', to: 'storm', dt: 1 / 60, steps: 1800, trace, final: { state: state(b2), near: sample(b2, 0, 0, near) } };
      // medium quality (6 waves, grid 224)
      const b3 = new Wv.WaveBank();
      b3.setQuality(6, 224);
      b3.setSeed(seed + 101, windAngle + off);
      b3.update(0, 12.5, seaIn, windAngle, shortScale, 0, 0);
      extra.medium = { waves: 6, gridN: 224, t: 12.5, focus: [0, 0], state: state(b3), near: sample(b3, 0, 0, near) };
    }
    const forward = [];
    bank.update(0, 12.5, seaIn, windAngle, shortScale, 0, 0);
    const o = { x: 0, y: 0, z: 0 };
    for (const [px, pz] of [[0, 0], [10.5, -3.25], [-40, 22], [150, 150], [-900, 300]]) { bank.forward(px, pz, 0, o); forward.push([px, pz, num(o.x), num(o.y), num(o.z)]); }
    out('ocean', `wavebank_${name}`, {
      files: [relSrc('systems/ocean/waves.js'), relSrc('systems/ocean.js'), relSrc('systems/weather/presets.js')],
      tolerance: BITWISE,
      data: {
        setup: {
          preset: name, quality: { waves: 8, gridN: 300 }, seed: seed + 101, missionSeed: seed, windAngle, swellOffset: num(off), baseAngle: num(windAngle + off), sea: seaIn, shortScale: num(shortScale),
          calls: 'bank = WaveBank(); setQuality(8, 300); setSeed(seed, baseAngle); per case: update(0, t, sea, windAngle, shortScale, focus.x, focus.z) [first update snaps]; then heightAt/normalAt/velocityAt(x, z, tOff=0) at focus + (dx, dz); the wide grid has no velocity',
        },
        grids: { near: N(near), wide: N(wide), order: 'for dz in axis, for dx in axis; normal/velocity as flat xyz triples' },
        cases, tOff, forward: { note: '[px, pz, x, y, z] = forward(px, pz, 0) at t=12.5 focus 0', values: forward }, ...extra,
      },
    });
  }
}

// ==================================================================================================== heli
async function heli() {
  const THREE = await import('three');
  const { FlightModel, STEP } = await gameImport('systems/heli/flight.js');
  const Wv = await gameImport('systems/ocean/waves.js');
  const { PRESETS } = await gameImport('systems/weather/presets.js');

  // Real WaveBank under the heli (storm sea, high quality, seed 202, wind angle 0.6), advanced every step.
  const sea = PRESETS.storm.sea;
  const seaIn = { Hs: sea.Hs, swellAdd: sea.swellAdd, Q: sea.Q, clearing: sea.clearing };
  const windAngle = 0.6;

  const scenarios = [
    { id: 'hover_standard', assist: 'standard', wind: [9, -4], turbulence: 0.35, start: [0, 30, 0, 0], altTarget: (t) => (t < 5 ? 30 : 15),
      input: (t) => ({ x: 0, y: 0, boost: false }), nose: () => null, winch: () => 'stowed' },
    { id: 'cruise_assist_off_obstacle', assist: 'off', wind: [-6, 3], turbulence: 0.2, start: [0, 40, 0, 0.3], altTarget: () => 40,
      input: (t) => ({ x: t < 3 ? 0.7 : t < 6 ? 0 : -0.4, y: t < 7 ? 1 : 0.2, boost: t >= 1.5 && t < 4 }), nose: (t) => (t < 4 ? 0.8 : -1.2), winch: () => 'stowed',
      obstacles: [{ x: 48, z: -70, radius: 4, top: 80 }] },
    { id: 'assist_full_winch_water', assist: 'full', wind: [14, 6], turbulence: 0.6, start: [20, 12, -15, 1.0], altTarget: (t) => (t < 5 ? 3 : 4),
      input: (t) => ({ x: t > 6 ? 0.3 : 0, y: 0, boost: false }), nose: () => null, winch: (t) => (t < 1 || t >= 5 ? 'stowed' : 'lowering') },
    { id: 'land_pad', assist: 'standard', wind: [3, 2], turbulence: 0.1, start: [-6, 30, 4, 0], altTarget: (t) => (t < 1 ? 30 : 8),
      input: (t) => ({ x: 0, y: 0, boost: false }), nose: () => null, winch: () => 'stowed',
      pad: { type: 'deck', position: [0, 8, 0], radius: 14, heading: 0.25, tilt: 0, velocity: [0, 0, 0] } },
  ];

  for (const sc of scenarios) {
    const bank = new Wv.WaveBank();
    bank.setQuality(8, 300);
    bank.setSeed(202 + 101, windAngle);
    const events = [];
    let step = 0;
    const pad = sc.pad ? { type: sc.pad.type, position: new THREE.Vector3(...sc.pad.position), radius: sc.pad.radius, heading: sc.pad.heading, tilt: sc.pad.tilt, velocity: new THREE.Vector3(...sc.pad.velocity) } : null;
    const ctx = {
      mode: 'play',
      ocean: { heightAt: (x, z) => bank.heightAt(x, z) },
      weather: { state: { turbulence: sc.turbulence }, windAt: (x, z, out) => out.set(sc.wind[0], sc.wind[1]) },
      settings: { get: (k) => (k === 'assist' ? sc.assist : undefined) },
      world: {
        obstacles: sc.obstacles || [],
        padAt: (x, z) => (pad && Math.hypot(x - pad.position.x, z - pad.position.z) < pad.radius ? pad : null),
      },
    };
    const h = {
      ctx, uMove: { x: 0, y: 0 }, uMag: 0, winch: { state: 'stowed' }, autorotation: false, crash: null, hull: 1, emp: 0,
      thrustFactor: 1, boosting: false, cabin: [], rotorRPM: 1, altTarget: sc.start[1], landed: null, alive: true,
      damage: (amount, source) => events.push({ step, event: 'damage', amount: num(amount), source }),
      onWaterStrike: (x, z, s) => events.push({ step, event: 'waterStrike', x: num(x), z: num(z), speed: num(s) }),
      onTouch: (p, relVy) => events.push({ step, event: 'touch', relVy: num(relVy) }),
      ops: {
        land: (p) => { events.push({ step, event: 'land' }); h.landed = p; f.attachTo(p); f.v.set(0, 0, 0); f.contactPad = p; h.altTarget = f.p.y; },
        ditch: (reason) => { events.push({ step, event: 'ditch', reason }); h.crash = { phase: 'ditched', t: 0, reason, deck: null }; h.alive = false; h.landed = null; },
        takeoff: () => { events.push({ step, event: 'takeoff' }); h.landed = null; },
      },
    };
    const f = new FlightModel(h);
    f.reset(sc.start[0], sc.start[1], sc.start[2], sc.start[3]);
    const inputs = [], states = [];
    for (step = 1; step <= 600; step++) {
      const t = step * STEP;
      bank.update(STEP, t, seaIn, windAngle, 1, 0, 0);
      const u = sc.input(t);
      h.uMove.x = u.x; h.uMove.y = u.y; h.boosting = u.boost;
      if (!h.landed) h.altTarget = sc.altTarget(t);
      f.noseTarget = sc.nose(t);
      h.winch.state = sc.winch(t);
      inputs.push([num(u.x), num(u.y), u.boost ? 1 : 0, num(h.altTarget), f.noseTarget === null ? null : num(f.noseTarget), h.winch.state]);
      f.step(STEP);
      states.push([f.p.x, f.p.y, f.p.z, f.v.x, f.v.y, f.v.z, f.heading, f.yawRate, f.thrust.x, f.thrust.y, f.windEff.x, f.windEff.y, f.windSmooth.x, f.windSmooth.y, f.sea, f.surface, f.turb, h.uMag, f.landTimer].map(num));
    }
    out('heli', `flight_${sc.id}`, {
      files: [relSrc('systems/heli/flight.js'), relSrc('systems/ocean/waves.js'), relSrc('core/math.js')],
      tolerance: { class: 'chaos', bitwiseSteps: 600, note: 'all 600 steps bitwise (PLAN §5.1); on divergence report first step/field' },
      data: {
        setup: {
          dt: STEP, steps: 600,
          ocean: { wavebank: 'setQuality(8, 300); setSeed(303, 0.6); every step BEFORE flight: update(1/60, step/60, sea, 0.6, 1, 0, 0)', sea: seaIn },
          weather: { windAt: sc.wind, turbulence: sc.turbulence, note: 'stub: windAt(x, z) returns the constant wind; state.turbulence constant' },
          settings: { assist: sc.assist }, hazards: 'none (force 0)',
          world: { obstacles: sc.obstacles || [], pad: sc.pad || null, padAt: 'pad if hypot(x - pad.x, z - pad.z) < radius' },
          heli: { start: { x: sc.start[0], y: sc.start[1], z: sc.start[2], heading: sc.start[3] }, hull: 1, emp: 0, thrustFactor: 1, cabin: 0, rotorRPM: 1, autorotation: false },
          stubs: 'damage/onWaterStrike/onTouch only record (hull stays 1); ops.land = landed=pad, attachTo(pad), v=0, contactPad=pad, altTarget=p.y; ops.ditch = crash {phase:ditched}; ops.takeoff = landed=null',
          perStep: 'set uMove, boosting, altTarget (unless landed), noseTarget, winch.state from inputs[i], then flight.step(1/60)',
        },
        inputFields: ['uMoveX', 'uMoveY', 'boost', 'altTarget', 'noseTarget', 'winchState'],
        inputs,
        stateFields: ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'heading', 'yawRate', 'thrustX', 'thrustZ', 'windEffX', 'windEffZ', 'windSmoothX', 'windSmoothZ', 'sea', 'surface', 'turb', 'uMag', 'landTimer'],
        states,
        events,
      },
    });
  }
}

// ================================================================================================= mission
async function mission() {
  const S = await gameImport('systems/mission/scoring.js');
  const sc = S.__scope();
  const scripts = [];
  for (const diff of ['cadet', 'pilot', 'ace', 'bogus']) {
    const emitted = [];
    const scorer = new S.Scorer({ emit: (name, p) => emitted.push({ name, payload: serialize(p) }) });
    scorer.reset(diff);
    const ops = [];
    const rec = (op, args, ret) => ops.push({ op, args, ret: num(ret), raw: num(scorer.score), chain: scorer.chain, final: num(scorer.final) });
    rec('add', ['delivered', 250, 'Доставлен', { x: 10, y: 0, z: -4 }, 1, true], scorer.add('delivered', 250, 'Доставлен', { x: 10, y: 0, z: -4 }, 1, true));
    rec('add', ['warmth', 37.5, 'Тепло', null, 1, true], scorer.add('warmth', 37.5, 'Тепло', null, 1, true));
    let t = 30;
    for (const id of Object.keys(sc.STYLES)) {
      rec('style', [id, t, { x: 1, z: 2 }, true, true], scorer.style(id, t, { x: 1, z: 2 }, true, true));
      t += id.length % 3 === 0 ? 25 : 7.5;
    }
    rec('style', ['jewel', t, null, true, true], scorer.style('jewel', t, null, true, true));
    rec('style', ['unknownStyle', t, null, true, true], scorer.style('unknownStyle', t, null, true, true));
    rec('style', ['jewel', t + 100, null, false, false], scorer.style('jewel', t + 100, null, false, false));
    rec('add', ['lost', -120, 'Потерян', { x: 0, z: 0 }, 1, true], scorer.add('lost', -120, 'Потерян', { x: 0, z: 0 }, 1, true));
    rec('add', ['damage', -33.4, '', null, 1, false], scorer.add('damage', -33.4, '', null, 1, false));
    rec('add', ['time', 0, '', null, 0, true], scorer.add('time', 0, '', null, 0, true));
    scripts.push({ difficulty: diff, ops, emitted, styleCount: scorer.styleCount(), breakdown: serialize(scorer.breakdown()) });
  }
  const medals = [];
  for (const success of [true, false]) for (const ratio of [0.5, 0.6 - 1e-10, 0.6, 0.85, 0.9, 1 - 1e-10, 1]) for (const [time, par] of [[100, 0], [500, 600], [700, 600], [781, 600], [779, 600]]) for (const styles of [1, 2]) for (const damage of [0, 1e-7, 0.2]) {
    const m = S.medalsFor({ success, ratio, time, par, styles, damage });
    medals.push([success, num(ratio), time, par, styles, num(damage), m.bronze, m.silver, m.gold, m.cross, m.rings]);
  }
  out('mission', 'scoring', {
    files: [relSrc('systems/mission/scoring.js')],
    tolerance: { class: 'bitwise', note: 'points/ints exact; emitted score:add payloads compared field by field; strings byte-exact' },
    data: {
      scorer: { note: 'new Scorer(events); reset(difficulty); then ops in order (args as passed); ret = return value; raw/chain/final after the op. STYLES iterated in data order of mission.json STYLES', scripts },
      medalsFor: { fields: ['success', 'ratio', 'time', 'par', 'styles', 'damage', 'bronze', 'silver', 'gold', 'cross', 'rings'], cases: medals },
    },
  });

  // --- prepare.json: prepareDef for every campaign op, endless (seed 20261016) and title, clock frozen ---
  const RealDate = Date;
  const FIXED = new RealDate('2026-10-16T12:00:00Z').getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
  try {
    const { prepareDef, MUST_TYPES } = await gameImport('systems/mission/prepare.js');
    const { CAMPAIGN, ENDLESS, TITLE } = await gameImport('systems/mission/campaign.js');
    const defs = [];
    CAMPAIGN.forEach((raw, index) => defs.push({ id: raw.id, opts: { index, survivorTypes: MUST_TYPES }, def: serialize(prepareDef(raw, { index, survivorTypes: MUST_TYPES })) }));
    defs.push({ id: 'endless', opts: { index: -1, seed: 20261016, survivorTypes: MUST_TYPES }, def: serialize(prepareDef(ENDLESS, { index: -1, seed: 20261016, survivorTypes: MUST_TYPES })) });
    defs.push({ id: 'title', opts: { index: 0, survivorTypes: MUST_TYPES }, def: serialize(prepareDef(TITLE, { index: 0, survivorTypes: MUST_TYPES })) });
    out('mission', 'prepare', {
      files: [relSrc('systems/mission/prepare.js'), relSrc('systems/mission/campaign.js'), relSrc('systems/mission/manifest.js')],
      tolerance: { class: 'bitwise', note: 'whole def tree equal (numbers bitwise, strings byte-exact); "today" frozen to 2026-10-16 (local time of the exporter, TZ=UTC in CI)' },
      data: { today: '2026-10-16', survivorTypes: MUST_TYPES, defs },
    });
  } finally {
    globalThis.Date = RealDate;
  }
}

// ==================================================================================================== text
async function text() {
  const Wd = await gameImport('systems/radio/words.js');
  const Tx = await gameImport('systems/mission/text.js');
  const ns = [];
  for (let n = 0; n <= 1100; n++) ns.push(n);
  for (let n = 1101; n <= 9999; n += 97) ns.push(n);
  ns.push(9999, 10000, 12345, -1, -17, 2.5);
  const safe = (f) => { try { const v = f(); return v === undefined ? null : v; } catch (e) { return { error: String(e.message || e) }; } };
  const angles = [];
  for (let d = 0; d < 360; d += 7.5) angles.push(d);
  angles.push(359.99, 360, -10, 22.5, 22.4999, 67.5);
  const pts = [[0, 0], [10, -500], [-1234, 777], [3000, 3000], [-4400, -2], [149.9, 150], [150, 149.9]];
  out('text', 'ru_words', {
    files: [relSrc('systems/radio/words.js'), relSrc('systems/mission/text.js')],
    tolerance: { class: 'bytes', note: 'UTF-8 byte-exact (NBSP U+00A0 escaped as \\u00a0 in JSON)' },
    data: {
      radio: {
        numberWords: ns.map((n) => [n, safe(() => Wd.numberWords(n))]),
        numberGenitive: ns.map((n) => [n, safe(() => Wd.numberGenitive(n))]),
        plural: Array.from({ length: 201 }, (_, n) => [n, Wd.plural(n, 'метр', 'метра', 'метров')]),
        countWords: Array.from({ length: 13 }, (_, n) => [n, safe(() => Wd.countWords(n))]),
        peopleWords: Array.from({ length: 13 }, (_, n) => [n, safe(() => Wd.peopleWords(n))]),
        distWords: [0, 24, 25, 74, 75, 1234, 1999, 2025, 5000].map((m) => [m, safe(() => Wd.distWords(m))]),
        metresWords: [1, 2, 5, 11, 21, 22, 25, 101, 111].map((n) => [n, Wd.metresWords(n)]),
        metresGenitive: [1, 2, 5, 11, 21, 22, 25, 101, 111].map((n) => [n, safe(() => Wd.metresGenitive(n))]),
        degreesWords: [0, 1, 2, 5, 21, 90, 180, 271, 359].map((n) => [n, Wd.degreesWords(n)]),
        fromWords: angles.map((d) => [d, Wd.fromWords(d)]),
        toWords: angles.map((d) => [d, Wd.toWords(d)]),
        headingWords: angles.map((d) => [d, safe(() => Wd.headingWords(d))]),
        squareOf: pts.map(([x, z]) => [x, z, safe(() => Wd.squareOf(x, z))]),
        bearingDeg: pts.map(([x, z]) => [x, z, num(Wd.bearingDeg(x, z))]),
        clockWords: [[0, 0, -100], [0, 100, 0], [1.2, -50, -50], [-2.5, 30, 400], [3.1, 0, 10]].map(([hd, dx, dz]) => [hd, dx, dz, safe(() => Wd.clockWords(hd, dx, dz))]),
        sideWords: [[0, 0, -100], [0, 100, 0], [1.2, -50, -50], [-2.5, 30, 400]].map(([hd, dx, dz]) => [hd, dx, dz, safe(() => Wd.sideWords(hd, dx, dz))]),
        countSeconds: [0, 1, 2, 5, 10, 21, 30, 60].map((n) => [n, safe(() => Wd.countSeconds(n))]),
        kmWords: [0, 49, 50, 950, 999, 1000, 1049, 1050, 1500, 2000, 2500, 12345].map((m) => [m, safe(() => Wd.kmWords(m))]),
        fill: [['квадрат {square}, {count}', { square: 'Б-7', count: 'двое' }], ['{a}{a} {missing}', { a: 'x' }]].map(([tpl, v]) => [tpl, v, Wd.fill(tpl, v)]),
      },
      mission: {
        numberWords: ns.map((n) => [n, safe(() => Tx.numberWords(n))]),
        plural: Array.from({ length: 201 }, (_, n) => [n, Tx.plural(n, 'человек', 'человека', 'человек')]),
        peopleCollective: Array.from({ length: 16 }, (_, n) => [n, safe(() => Tx.peopleCollective(n))]),
        peopleWords: Array.from({ length: 16 }, (_, n) => [n, safe(() => Tx.peopleWords(n))]),
        compass8: angles.map((d) => [d, Tx.compass8(d)]),
        fromWords: angles.map((d) => [d, Tx.fromWords(d)]),
        squareOf: pts.map(([x, z]) => [x, z, safe(() => Tx.squareOf(x, z))]),
        windFromDeg: [[1, 0], [0, 1], [-0.6, 0.8], [0.3, -0.95]].map(([x, z]) => [x, z, num(Tx.windFromDeg(x, z))]),
        clockOf: [[0, 0, -100], [0, 100, 0], [1.2, -50, -50], [-2.5, 30, 400]].map(([hd, dx, dz]) => [hd, dx, dz, safe(() => Tx.clockOf(hd, dx, dz))]),
        seaState: [0, 0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14].map((h) => [h, safe(() => serialize(Tx.seaState(h)))]),
        beaufort: [0, 0.2, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6, 40].map((v) => [v, safe(() => serialize(Tx.beaufort(v)))]),
        clockToDay: ['00:00', '06:30', '12:00', '18:45', '23:59', null].map((c) => [c, safe(() => num(Tx.clockToDay(c)))]),
      },
      browserOnly: 'fmtNum/fmtTime/fmtPct/fmtKm and ui/common/fmt.js use Intl ru-RU → text/ru_format.json (export-browser)',
    },
  });
}

// ===================================================================================================== run
const GROUPS = { math, look, palette, ocean, heli, mission, text };
for (const [k, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.has(k)) continue;
  const t0 = Date.now();
  await fn();
  console.log(`[${k}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const r of results) console.log(`${r.path}\t${r.bytes}`);
