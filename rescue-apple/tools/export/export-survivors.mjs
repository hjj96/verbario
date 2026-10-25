// export-survivors: parity vectors of the REAL web Survivors (systems/survivors.js + survivors/*) and Effects
// (systems/fx.js + fx/*) run in Node 22 on stub systems -> Tests/Vectors/{survivors,fx}/*.json.
//
//   survivors/people.json       makeFallbackPeople / feminize / guessGender / conditionFor / quoteFor
//   survivors/poses.json        poseTargets on a grid (every pose × phases × arms × legFold × t), variant, applyPose
//   survivors/three_costs.json  Math.random draws three.js spends on object uuids where survivors.js builds three
//                               objects at runtime (ThreeObjectCosts in Survivors.swift)
//   fx/common.json              strokeEnvelope / softEnvelope, isOrange / lum, QUALITY → pool capacities
//   fx/lightpool.json           scripted handles over many updates: slot assignment with hysteresis, air uniforms
//   survivors/run_<scenario>.json (+ .f32 heli rows, .u8 digests, .f64 dumps)
//                               time-stepped traces: mission:setup with a prepared def, then the per-frame order of
//                               main.js (pilot → heli stub → pokes → winch contract calls → wave bank → survivors.update
//                               → fx.update). Every frame the state is cut into parts (env, groups, people, carriers,
//                               misc, fx, life, air, ocean calls) and each part's Float64 values are digested (64-bit
//                               digest(), NaN canonical); render buffers (crowd, craft, collars, glows, lines,
//                               uniforms, particle pools, fx glows, gulls, …) every 10th frame. Full part values are
//                               dumped at a few frames (f64 sidecar) so a mismatch can be read field by field. Events
//                               are logged with ids, boardOne() records and checkpoint snapshots (takeCheckpoint →
//                               mission:setup → restoreCheckpoint) kept whole. The Swift test (Core/Tests/
//                               MaydayCoreTests/Survivors) replays the recorded heli rows (packed: constant / duplicate
//                               columns in heliConst / heliSame) / pokes / contract calls on the Swift systems and
//                               rebuilds the same parts in the same order.
//   scenarios: op1 (the campaign's first sortie), night (strobes, flares, beam / FLIR / flare spotting, downwash
//              capsize, a dropped raft, a stretcher, lost to the cold, lightning, a checkpoint), core (every carrier
//              in a rough sea, whirlpool / rogue / flow, the bottle, smoke / dye / mirror, hail, a slip, a checkpoint).
//
// The stubs are deliberately simple and fully described in each file's `setup` (the Swift test builds the same):
// ocean = real WaveBank + a searchlight mirror (ocean.js searchlightAt) + a call recorder; weather = scripted state
// (pokes) + analytic windAt; look = analytic gust field + the weather's mean wind; heli = recorded rows from a
// closed-loop pilot (position, rotor, downwash, beam, winch state, basket); hazards / world / mission / post = small
// scripted objects. Instance culling (InstanceBounds) is switched off: it is the renderer's in the port. The
// lightning ribbons (fx/lightning.js strike / spider) are stubbed: render geometry not in the port yet (PLAN §10).
// Math.random is re-seeded (createRng) right after Survivors and Effects are built, and the cosmetic values their
// constructors drew (gull phases, dolphin / whale timers) are re-drawn from it in constructor order — exactly what
// the Swift constructors draw from ctx.random.
//
// Same wrapper / number / determinism rules as export-vectors.mjs (tools/README.md).
// Usage: node rescue-apple/tools/export/export-survivors.mjs [--only people,poses,costs,fx,lightpool,op1,night,core] [--out <dir>]
// (each trace runs in a child process of its own; MAYDAY_SV_DEBUG=1 prints the pilot's progress)
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPLE, num, writeWrapped, writeSidecar, relSrc, serialize } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const PRODUCER = 'tools/export/export-survivors.mjs';
const results = [];
console.warn = () => {};

const THREE = await import('three');
const M = await gameImport('core/math.js');
const { Look } = await gameImport('core/look.js');
const { EventBus } = await gameImport('core/events.js');
const { Survivors } = await gameImport('systems/survivors.js');
const { Effects } = await gameImport('systems/fx.js');
const Wv = await gameImport('systems/ocean/waves.js');
const { InstanceBounds } = await gameImport('systems/survivors/geo.js');
const { CAMPAIGN } = await gameImport('systems/mission/campaign.js');
const { prepareDef } = await gameImport('systems/mission/prepare.js');
const People = await gameImport('systems/survivors/people.js');
const Poses = await gameImport('systems/survivors/poses.js');
const FxCommon = await gameImport('systems/fx/common.js');
const { LightPool } = await gameImport('systems/fx/lightpool.js');

const SV_FILES = ['systems/survivors.js', 'systems/survivors/tables.js', 'systems/survivors/carriers.js', 'systems/survivors/signals.js',
  'systems/survivors/people.js', 'systems/survivors/poses.js', 'systems/survivors/heat.js', 'systems/survivors/bottle.js',
  'systems/survivors/crowd.js', 'systems/survivors/craft.js', 'systems/survivors/water.js', 'systems/survivors/geo.js'].map(relSrc);
const FX_FILES = ['systems/fx.js', 'systems/fx/common.js', 'systems/fx/particles.js', 'systems/fx/signals.js', 'systems/fx/lightpool.js',
  'systems/fx/life.js'].map(relSrc);
const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern; strings byte-exact' };
const TRACE = { class: 'bitwise', note: 'every part digest of every frame equal (64-bit digest of the Float64 values, NaN canonical: see digest()); events identical; on a digest mismatch compare the nearest full dump field by field' };

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}
const sidecar = (domain, name, typed, shape) => writeSidecar(path.join(OUT, domain, name), typed, shape);

// ------------------------------------------------------------------------------------------ enums
const TYPES = ['swimmer', 'raft', 'hull', 'container', 'injured', 'deck', 'wreck', 'plane'];
const STATES = ['hidden', 'drifting', 'spotted', 'winching', 'rescued', 'lost'];
const KINDS = ['raft', 'hull', 'container', 'barge', 'wreck', 'rig'];
const STYLES = ['boat', 'yacht', 'plane'];
const WSTATES = ['stowed', 'lowering', 'down', 'raising'];
const SWIM = [null, 'basket', 'raft'];
const PRESETS = ['calm', 'overcast', 'squall', 'storm', 'nightStorm', 'fog', 'clearing', 'nightCalm'];
const FLOCK = ['circle', 'leave', 'flee'];
const STAMPS = ['foam', 'oil', 'dye', 'ring', 'disturb', 'scar', 'splash', 'wake'];
const b = (x) => (x ? 1 : 0);
const n = (x) => (x === undefined || x === null ? NaN : Number(x));
const idx = (arr, v) => arr.indexOf(v ?? null);

// ------------------------------------------------------------------------------------------ digests
// A fast 64-bit digest of a part's values as Float64 (NaN canonical 0x7FF8000000000000): two 32-bit lanes over
// the little-endian 32-bit halves of every value — lane A the murmur3_32 body (seed 0x9E3779B9), lane B FNV-1a
// over the words — then the word count mixed in and murmur3's fmix32 on both; 8 bytes = A (LE) ‖ B (LE).
// (SHA-256 of ~200 MB per trace is far too slow for an unoptimised Swift test build; equality is all we need.)
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const fmix32 = (h) => {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
function digest(values) {
  let a = 0x9e3779b9 | 0;
  let bb = 0x811c9dc5 | 0;
  for (let i = 0; i < values.length; i++) {
    F64[0] = values[i]; // ToNumber like Float64Array.from (true → 1, undefined → NaN, null → 0)
    if (F64[0] !== F64[0]) { U32[0] = 0; U32[1] = 0x7ff80000; }
    for (let h = 0; h < 2; h++) {
      const w = U32[h];
      let k = Math.imul(w, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      a ^= k;
      a = (a << 13) | (a >>> 19);
      a = (Math.imul(a, 5) + 0xe6546b64) | 0;
      bb = Math.imul(bb ^ w, 0x01000193);
    }
  }
  const nw = values.length * 2;
  const out = Buffer.alloc(8);
  out.writeUInt32LE(fmix32(a ^ nw), 0);
  out.writeUInt32LE(fmix32(bb ^ nw), 4);
  return out;
}

// ============================================================================================ static vectors
if (want('people')) {
  const S = People.__scope();
  const cases = [];
  for (const type of ['swimmer', 'raft', 'hull', 'container', 'injured', 'deck', 'wreck', 'plane', 'unknown']) {
    for (const seed of [1, 101 * 97 + 1, 101 * 97 + 3, 202 * 97 + 5, 4242, 9799, 123456789, 4294967295]) {
      cases.push({ seed, type, count: type === 'wreck' ? 12 : 4, people: People.makeFallbackPeople(seed, type, type === 'wreck' ? 12 : 4) });
    }
  }
  const surnames = [...S.SURNAMES, 'Корельский', 'Двинской', 'Белых', 'Шевчук', 'Ильин', 'Бобров', 'Грецкий', 'Толстой', 'Ковальчук'];
  const fem = surnames.map((s) => [s, People.feminize(s)]);
  const names = ['Мария Иванова', 'Илья Муромец', 'Никита', 'Саша Белых', 'Анна', 'Олег Петров', '  Ольга  Ковальчук', '', 'Тёма', 'Лука Ильин', 'Зоя Ершова'];
  const genders = names.map((nm) => [nm, People.guessGender(nm)]);
  const conds = [];
  for (const w of [0, 0.1, 0.15, 0.2, 0.3, 0.34, 0.35, 0.5, 0.6, 0.9, 1]) for (const inj of [false, true]) conds.push([w, inj, People.conditionFor(w, inj)]);
  // quoteFor sequences: a seeded rng, growing used sets, every tag mix the logbook produces
  const tagSets = [['any'], ['night', 'any'], ['raft', 'storm', 'any'], ['child', 'injured', 'raft', 'night', 'storm', 'fog', 'long', 'cold', 'any'],
    ['flower', 'swimmer', 'any'], ['pet', 'hull', 'any'], ['deck', 'any'], ['wreck', 'night', 'any'], ['container', 'any'], ['injured', 'long', 'cold', 'any']];
  const quotes = [];
  for (const seed of [7, 101 * 31 + 7, 4242]) {
    const rng = M.createRng(seed);
    const used = new Set();
    const seq = [];
    for (let k = 0; k < 40; k++) {
      const tags = tagSets[k % tagSets.length];
      const g = k % 3 === 0 ? 'f' : 'm';
      seq.push([g, tags, People.quoteFor(rng, g, tags, used)]);
    }
    quotes.push({ seed, seq });
  }
  out('survivors', 'people', { files: [relSrc('systems/survivors/people.js')], tolerance: BITWISE, data: { fallback: serialize(cases), feminize: fem, guessGender: genders, conditionFor: conds, quotes } });
}

if (want('poses')) {
  const POSE = Poses.POSE;
  const rows = [];
  for (const [name, id] of Object.entries(POSE)) {
    for (const phase of [0, 0.37, 1.9, 4.4, 6.1]) for (const arm of [-1, 1]) for (const legFold of [0, 0.85]) for (const t of [0, 0.25, 3.7, 41.13, 600.5]) for (const ringN of [1, 3, 4, 7]) {
      const p = { phase, waveArm: arm, legFold };
      const o = Poses.poseTargets(id, p, t, [0, 0, 0, 0], ringN);
      rows.push(id, phase, arm, legFold, t, ringN, ...o);
    }
  }
  const variants = [];
  for (let k = 0; k < 200; k++) {
    const phase = (k * 0.0731) % (Math.PI * 2);
    variants.push([phase, Poses.variant({ phase }, 5), Poses.variant({ phase }, 3)]);
  }
  // applyPose: a person walked through a pose schedule at a ragged dt
  const p = { aL: 0.8, pL: 0.5, aR: 0.8, pR: 0.5, phase: 1.234, waveArm: -1, legFold: 0 };
  const apply = [];
  let t = 0;
  for (let k = 0; k < 400; k++) {
    const dt = [1 / 60, 1 / 30, 0.1, 1 / 120][k % 4];
    t += dt;
    const pose = Object.values(POSE)[((k / 25) | 0) % 17];
    Poses.applyPose(p, Poses.poseTargets(pose, p, t, [0, 0, 0, 0], 4), dt);
    apply.push(dt, pose, p.aL, p.pL, p.aR, p.pR);
  }
  out('survivors', 'poses', { files: [relSrc('systems/survivors/poses.js')], tolerance: BITWISE, data: {
    POSE, fields: ['pose', 'phase', 'waveArm', 'legFold', 't', 'ringN', 'aL', 'pL', 'aR', 'pR'], grid: sidecar('survivors', 'poses_grid.f64', Float64Array.from(rows)),
    variants, apply: sidecar('survivors', 'poses_apply.f64', Float64Array.from(apply)),
  } });
}

// three.js spends 4 Math.random draws on the uuid of every Object3D / BufferGeometry / Material / Texture /
// Source; the survivors build some at runtime, and those draws come out of the shared cosmetic stream
// (ThreeObjectCosts in Survivors.swift spends them). Measured here on fresh objects.
if (want('costs')) {
  const { Carrier } = await gameImport('systems/survivors/carriers.js');
  const ctx = {
    scene: new THREE.Scene(), look: new Look(7), events: new EventBus(), camera: new THREE.PerspectiveCamera(40, 1280 / 720, 2, 1200), mode: 'play',
    time: { t: 0, dt: 0 }, settings: { get: (k) => ({ quality: 'high', difficulty: 'pilot' })[k], onChange: () => {} },
  };
  const r0 = Math.random;
  let draws = 0;
  Math.random = () => { draws++; return r0(); };
  const count = (f) => { draws = 0; f(); return draws; };
  const sv = new Survivors(ctx);
  const hull = (style) => new Carrier('hull', 0, 0, { style });
  const [b1, b2, y1, y2, pl] = [hull('boat'), hull('boat'), hull('yacht'), hull('yacht'), hull('plane')];
  const costs = {
    groupObject: count(() => new THREE.Object3D()),
    hullFirst: { boat: count(() => sv._hullDecal(b1, 'МАРИЯ')), yacht: count(() => sv._hullDecal(y1, 'ВЕТЕР')) },
    hullNext: { boat: count(() => sv._hullDecal(b2, 'НАДЕЖДА')), yacht: count(() => sv._hullDecal(y2, 'АЛЫЕ ПАРУСА')) },
    planeDecal: count(() => sv._planeDecal(pl, 'RA-40217')),
    bigBatch: {}, bigBatchAgain: {}, bigBatchOtherDeck: {}, wreckDecal: {},
  };
  for (const model of ['barge', 'ferry', 'trawler']) {
    costs.bigBatch[model] = count(() => sv._bigBatch(model, 6));
    costs.bigBatchAgain[model] = count(() => sv._bigBatch(model, 6));
    costs.bigBatchOtherDeck[model] = count(() => sv._bigBatch(model, 4.5));
  }
  for (const model of ['ferry', 'trawler']) {
    const c = new Carrier('wreck', 0, 0, { deckY: 6 });
    c.batch = sv._bigBatch(model, 6);
    costs.wreckDecal[model] = count(() => sv._wreckDecal(c, 'Северянка'));
  }
  Math.random = r0;
  out('survivors', 'three_costs', { files: [relSrc('systems/survivors.js'), relSrc('systems/survivors/craft.js'), relSrc('systems/survivors/carriers.js')], tolerance: BITWISE, data: costs });
}

// fx/common.js: the lightning envelopes, the signal-orange test and luminance, the quality budgets.
if (want('fx')) {
  const env = [];
  for (let k = -20; k <= 1100; k++) {
    const t = k * 0.00071;
    env.push(t, FxCommon.strokeEnvelope(t), FxCommon.softEnvelope(t));
  }
  const rng = M.createRng(2024);
  const colors = ['#FF7B2E', '#FF5A00', '#E8E4E0', '#D2CAC6', '#FF3A22', '#FFB050', '#9C9692', '#000000', '#0a0a0a', '#FF8800', '#FFAA00', '#CC2200'];
  for (let k = 0; k < 120; k++) colors.push('#' + Math.floor(rng.next() * 0x1000000).toString(16).padStart(6, '0'));
  const col = colors.map((h) => {
    const c = new THREE.Color(h);
    return [h, c.r, c.g, c.b, FxCommon.isOrange(c), FxCommon.lum(c)];
  });
  const q = ['low', 'medium', 'high', 'ultra', '', null];
  const qualityOf = q.map((v) => [v, FxCommon.qualityOf({ get: () => v ?? undefined })]);
  out('fx', 'common', { files: [relSrc('systems/fx/common.js')], tolerance: BITWISE, data: {
    envelopes: sidecar('fx', 'common_envelopes.f64', Float64Array.from(env)), colors: serialize(col), QUALITY: serialize(FxCommon.QUALITY), qualityOf,
  } });
}

// fx/lightpool.js: a scripted crowd of virtual handles (acquire / move / set / colour / distance / release,
// invalid values included) over many updates; the slot assignment with hysteresis and the air uniforms.
if (want('lightpool')) {
  const lp = new LightPool(new THREE.Scene());
  const air = FxCommon.createAirUniforms();
  const rng = M.createRng(99);
  const live = [];
  const steps = [];
  const COLS = ['#FF3A1E', '#FFFFFF', '#8CB4FF', '#FFB050'];
  const pick = (n) => Math.floor(rng.next() * n);
  for (let k = 0; k < 160; k++) {
    const ops = [];
    const r = rng.next();
    if (r < 0.22 && live.length < 9) {
      const c = COLS[pick(4)];
      const I = k % 37 === 0 ? -5 : pick(1500);
      const D = k % 41 === 0 ? 0 : 20 + pick(100);
      live.push(lp.acquire(c, I, D));
      ops.push(['acquire', c, I, D]);
    } else if (r < 0.32 && live.length) {
      const i = pick(live.length);
      live[i].release();
      if (k % 5 === 0) live[i].release(); // a second release is a no-op
      live.splice(i, 1);
      ops.push(['release', i]);
    }
    for (let i = 0; i < live.length; i++) {
      const h = live[i];
      const u = rng.next();
      if (u < 0.6) {
        const x = (rng.next() - 0.5) * 300, y = rng.next() * 40, z = (rng.next() - 0.5) * 300;
        h.position.set(x, y, z);
        ops.push(['pos', i, x, y, z]);
      }
      if (u > 0.3) {
        const I = u > 0.97 ? NaN : u > 0.93 ? -1 : (rng.next() < 0.1 ? 0 : 50 + rng.next() * 1400);
        h.set(I);
        ops.push(['set', i, num(I)]);
      }
      if (u > 0.9) {
        const c = COLS[pick(4)];
        h.setColor(c);
        ops.push(['color', i, c]);
      }
      if (u < 0.05) {
        const d = rng.next() < 0.5 ? -3 : 15 + rng.next() * 90;
        h.setDistance(d);
        ops.push(['distance', i, d]);
      }
    }
    const fx = (rng.next() - 0.5) * 200, fz = (rng.next() - 0.5) * 200;
    lp.update(fx, fz, air);
    ops.push(['update', fx, fz]);
    const st = [lp.handles.length, lp.spare.length];
    for (const h of live) st.push(lp.handles.indexOf(h), h.slot, h.score, h.intensity, h.distance, b(h.active));
    for (let i = 0; i < 4; i++) {
      const l = lp.lights[i];
      st.push(l.intensity, l.distance, l.decay, l.position.x, l.position.y, l.position.z, l.color.r, l.color.g, l.color.b, lp.owner[i] ? live.indexOf(lp.owner[i]) : -1);
      st.push(...air.uFxLightPos.value[i].toArray(), ...air.uFxLightCol.value[i].toArray());
    }
    steps.push([ops, st.map(num)]);
  }
  lp.releaseAll();
  out('fx', 'lightpool', { files: [relSrc('systems/fx/lightpool.js')], tolerance: BITWISE, data: { steps, afterReleaseAll: [lp.handles.length, lp.spare.length] } });
}

// ============================================================================================ stub world
function makeLook(realLook, clock) {
  const look = Object.create(realLook);
  look.uniforms = { ...realLook.uniforms, uWind: { value: new THREE.Vector2() } };
  look.gustField = (x, z) => 0.5 + 0.3 * Math.sin(0.011 * x + 0.3 * clock.t) * Math.cos(0.013 * z);
  return look;
}

// The scripted weather state (all fields the systems read; colours linear).
function makeWeather(w0, clock) {
  const st = {};
  const W = { base: [0, 0], amp: 0 };
  const apply = (w) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === 'wind') Object.assign(W, v);
      else if (k === 'windDir' || k === 'sunDir' || k === 'sunDirVisual') st[k] = v ? new THREE.Vector3(...v) : undefined;
      else if (k === 'flashColor') st[k] = v ? new THREE.Color(...v) : undefined;
      else if (k === 'palette') {
        st.palette = {};
        for (const [pk, pv] of Object.entries(v)) st.palette[pk] = Array.isArray(pv) ? new THREE.Color(...pv) : pv;
      } else if (k === 'detect' || k === 'forecast') W[k] = v;
      else st[k] = v;
    }
    if (st.windDir) st.windDir = new THREE.Vector2(st.windDir.x, st.windDir.y);
  };
  apply(w0);
  return {
    state: st,
    W,
    apply,
    windAt: (x, z, o) => o.set(W.base[0] + W.amp * Math.sin(0.3 * clock.t + 0.002 * x), W.base[1] + W.amp * Math.cos(0.21 * clock.t + 0.002 * z)),
    detectBase: () => W.detect ? { base: W.detect[0], altBonus: W.detect[1] } : undefined,
    forecast: () => W.forecast || [],
  };
}

function makeOcean(bank, clock, calls) {
  const search = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), cosOuter: 0.95, i: 0 };
  const ss = (a, bb, x) => { const t = Math.min(1, Math.max(0, (x - a) / (bb - a))); return t * t * (3 - 2 * t); };
  return {
    search,
    bioluminescence: 1,
    features: { slots: [] },
    heightAt: (x, z) => bank.heightAt(x, z),
    normalAt: (x, z, o) => bank.normalAt(x, z, o),
    // ocean.js searchlightAt with the beam the heli row carries
    searchlightAt(x, z, y = 0) {
      const s = search;
      if (s.i <= 0) return 0;
      const dx = x - s.pos.x, dy = y - s.pos.y, dz = z - s.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1e-3;
      const cs = (dx * s.dir.x + dy * s.dir.y + dz * s.dir.z) / d;
      const rho = Math.acos(Math.min(1, Math.max(-1, cs))) / Math.max(Math.acos(s.cosOuter), 1e-3);
      return Math.min(1, Math.max(0, s.i * (1 - ss(220, 320, d)) * (1 - ss(0.72, 1, rho))));
    },
    splash: (x, z, r, s) => calls.push(1, x, z, r, s),
    stamp: (kind, x, z, o = {}) => calls.push(2, STAMPS.indexOf(kind), x, z, o.radius ?? 3, o.strength ?? 1),
    addGlint: (x, z, r, i, c) => calls.push(3, x, z, r, i, c.r, c.g, c.b),
    addWake: (x, z, s, dx, dz) => calls.push(4, x, z, s, dx, dz),
  };
}

// The heli rows: what Survivors / Effects read from ctx.heli (see SeaHeliView), float32 like recorded inputs.
const HELI_FIELDS = ['x', 'y', 'z', 'alt', 'alive', 'landed', 'padY', 'rpm', 'vx', 'vy', 'vz', 'dwHas', 'dwX', 'dwZ', 'dwR', 'dwS',
  'beamOn', 'beamI', 'beamOx', 'beamOy', 'beamOz', 'beamDx', 'beamDy', 'beamDz', 'beamCos', 'beamLen', 'wState', 'basketHas', 'bx', 'by', 'bz',
  'wHeight', 'bmVisible', 'bmPx', 'bmPy', 'bmPz', 'bmQx', 'bmQy', 'bmQz', 'bmQw'];

function makeHeli() {
  return {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), altitude: 40, alive: true, landed: null, rotorRPM: 1,
    downwash: undefined,
    beam: { on: false, intensity: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), cosOuter: 0.97, length: 30, hit: new THREE.Vector3() },
    winch: { state: 'stowed', load: null, basket: new THREE.Vector3(), height: 99 },
    winchCtl: { basketMesh: { visible: false, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } },
  };
}

function applyHeliRow(h, r, ocean) {
  const F = Object.fromEntries(HELI_FIELDS.map((k, i) => [k, r[i]]));
  h.position.set(F.x, F.y, F.z);
  h.velocity.set(F.vx, F.vy, F.vz);
  h.altitude = F.alt;
  h.alive = F.alive !== 0;
  h.landed = F.landed ? { position: { y: F.padY } } : null;
  h.rotorRPM = F.rpm;
  h.downwash = F.dwHas ? { x: F.dwX, z: F.dwZ, radius: F.dwR, strength: F.dwS } : undefined;
  const bm = h.beam;
  bm.on = F.beamOn !== 0;
  bm.intensity = F.beamI;
  bm.origin.set(F.beamOx, F.beamOy, F.beamOz);
  bm.dir.set(F.beamDx, F.beamDy, F.beamDz);
  bm.cosOuter = F.beamCos;
  bm.length = F.beamLen;
  bm.hit.copy(bm.origin).addScaledVector(bm.dir, F.beamLen); // read by the rain motes only (render side)
  const w = h.winch;
  w.state = WSTATES[F.wState];
  if (F.basketHas) w.basket.set(F.bx, F.by, F.bz);
  w.height = F.wHeight;
  const m = h.winchCtl.basketMesh;
  m.visible = F.bmVisible !== 0;
  m.position.set(F.bmPx, F.bmPy, F.bmPz);
  m.quaternion.set(F.bmQx, F.bmQy, F.bmQz, F.bmQw);
  // heli.update → ocean.setSearchlight(origin, dir, cosOuter, level)
  const s = ocean.search;
  s.pos.copy(bm.origin);
  s.dir.copy(bm.dir);
  s.cosOuter = bm.cosOuter;
  s.i = bm.on ? bm.intensity : 0;
}

// ctx.world: pads (with an optional lowerDeck) and obstacles, as plain data.
function makeWorld(w) {
  return { pads: (w.pads || []).map((p) => ({ ...p })), obstacles: (w.obstacles || []).map((o) => ({ ...o })) };
}

// ctx.hazards: fixed whirlpools, rogue crests (a straight crest line moving along `dir` from `from` at `speed`
// m/s between t0 and t1, lift = peak · max(0, 1 − |x·dx + z·dz − crest| / width)) and a uniform surface flow.
function makeHazards(h, clock) {
  const list = [];
  for (const w of h.whirlpools || []) list.push({ type: 'whirlpool', position: new THREE.Vector3(w.x, 0, w.z), radius: w.radius });
  for (const r of h.rogues || []) list.push({ type: 'rogue', dir: new THREE.Vector2(r.dir[0], r.dir[1]) });
  return {
    list,
    waveLiftAt(x, z) {
      let lift = 0;
      for (const r of h.rogues || []) {
        if (clock.t < r.t0 || clock.t > r.t1) continue;
        const crest = r.from + r.speed * (clock.t - r.t0);
        lift = Math.max(lift, r.peak * Math.max(0, 1 - Math.abs(x * r.dir[0] + z * r.dir[1] - crest) / r.width));
      }
      return lift;
    },
    surfaceFlowAt: (x, z, o) => (h.flow ? o.set(h.flow[0], h.flow[1]) : o),
  };
}

// ctx.mission (the bottle's style bonus): style(name, pos) → points, state.
function makeMission(m) {
  return { state: m.state || 'play', style: m.style ? () => m.style : undefined };
}

// mission.js _takeCheckpoint's survivors part, with the def entries and person records resolved (what
// _restoreCheckpoint hands survivors.restoreCheckpoint): free carriers (dropped rafts, emptied craft) with the
// entry that built them, the groups still out there with their craft, raft, datum and signal stocks.
function takeCheckpoint(sv, craftOf) {
  const carriers = [];
  const freeIdx = new Map();
  for (const c of sv.carriers) {
    if (!c || c.alive === false || c.owner) continue;
    freeIdx.set(c, carriers.length);
    carriers.push({ ...sv.snapCarrier(c), entry: craftOf.get(c)?.def ?? null });
  }
  const groups = [];
  for (const s of sv.list) {
    if (!s || s.state === 'rescued' || s.state === 'lost' || s.attached || !s.people?.length) continue;
    const c = s.carrier;
    groups.push({
      entry: s.def, type: s.type, x: s.position.x, z: s.position.z, people: s.people.map((p) => p.rec), health: s.health ?? 1, spotted: !!s.spotted,
      age: s.age || 0, pet: !!s.pet, datum: s.datum && !s.spotted ? { x: s.datum.x, z: s.datum.z, radius: s.datum.radius } : null,
      carrier: c && c.owner === s ? sv.snapCarrier(c) : null, raft: c && freeIdx.has(c) ? freeIdx.get(c) : null, sig: sv.snapSignals(s),
    });
  }
  return { elapsed: sv.elapsed, groups, carriers, rescued: sv.rescuedTotal, lost: sv.lostTotal, lostMarkers: sv.lostMarkers.map((m) => ({ x: m.x, z: m.z })),
    bottleTaken: !!sv.bottle?.taken };
}

// ============================================================================================ state parts
const PARTS = ['env', 'groups', 'people', 'carriers', 'misc', 'fx', 'life', 'air', 'ocean'];
const RPARTS = ['crowd', 'craft', 'heat', 'collars', 'glows', 'lines', 'uniforms', 'pools', 'fxGlows', 'rings', 'fxHeat', 'gulls', 'dolphins', 'whale'];

function partEnv(sv) {
  const e = sv.env;
  return [e.t, e.dt, b(e.play), e.night, idx(PRESETS, e.preset), e.intensity, b(e.fogBlind), e.fog, e.windSpeed, e.windDirX, e.windDirZ, e.windAngle,
    e.Hs, b(e.sunny), e.base, e.altBonus, b(e.reduceFlashes), e.thermal, b(e.heliAlive), b(e.rotorHeard), e.hx, e.hy, e.hz, e.alt, e.dwR, e.dwS,
    idx(WSTATES, e.wState), e.bx, e.by, e.bz, e.bH, b(e.bWet), e.wLoad ? e.wLoad.id : -1, e.ghostLight.r, e.ghostLight.g, e.ghostLight.b,
    e.foam.r, e.foam.g, e.foam.b, sv.list.length, sv.datums.length, sv.carriers.length, sv.lostMarkers.length, sv.pending.length,
    sv.playerFlares.length, sv.rescuedTotal, sv.lostTotal, sv.elapsed, sv.waterTemp, sv.current.x, sv.current.y];
}

function partGroups(sv) {
  const v = [];
  for (const s of sv.list) {
    const g = s.sig;
    const st = g.strobe === true ? 1 : g.strobe === false ? 0 : -1;
    v.push(s.id, idx(TYPES, s.type), idx(STATES, s.state), s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z,
      s.count, s.remaining, s.health, s.warmth, b(s.spotted), b(s.critical), b(s.panic), b(s.strobe), s.calm, s.excite, s.beamT, s.coreT, s.lostT,
      s.rogueCd, s.dwT, s.dwWarn, s.dwWarnT, b(s.shoutNear), b(s.flower), s.ringSpin, s.nrm.x, s.nrm.y, s.nrm.z, s.dHeli, idx(SWIM, s.swimTo),
      s.jumpT, n(s.since), s.age, n(s.deckY), s.height, b(s.attached), b(s.lostPending), s.carrier ? sv.carriers.indexOf(s.carrier) : -1,
      ...(s.datum ? [s.datum.x, s.datum.z, s.datum.radius] : [NaN, NaN, NaN]),
      ...(s.signal ? [s.signal.until, s.signal.x, s.signal.z, s.signal.error, s.signal.arc, s.signal.t] : [NaN, NaN, NaN, NaN, NaN, NaN]),
      s.people.length, g.rockets, g.rocketT, b(g.rocketHold), g.fired, g.smoke, g.smokeBurn, g.flares, g.flareBurn, b(g.flareObj), b(g.whistle),
      g.whistleT, b(g.dye), g.dyeT, g.dyeStampT, b(g.mirror), g.mirrorT, g.mirrorFlash, b(g.epirb), g.epirbT, g.epirbError, st, g.hornT,
      ...(s.pet ? [1, b(s.pet.far), b(s.pet.refused), s.pet.hopT, s.pet.barkT, s.pet.yaw] : [0, 0, 0, 0, 0, 0]));
  }
  return v;
}

function partPeople(sv) {
  const v = [];
  const one = (s, p) => v.push(s.id, p.skin, p.hood, p.jacket, p.pants, p.scale, p.phase, p.waveArm, p.strobePhase, p.yaw, p.aL, p.pL, p.aR, p.pR,
    p.x, p.y, p.z, p.waterY, p.legFold, p.liftWarmth, p.spin, n(p.strokeT), n(p.strokeSide), n(p.attachT));
  for (const s of sv.list) {
    for (const p of s.people) one(s, p);
    if (s.attached) one(s, s.attached);
  }
  return v;
}

function partCarriers(sv) {
  const v = [];
  for (const c of sv.carriers) {
    v.push(idx(KINDS, c.kind), idx(STYLES, c.style), c.x, c.y, c.z, c.yaw, c.nrm.x, c.nrm.y, c.nrm.z, c.roll, c.pitch, c.sink, c.flip, n(c.flipT),
      b(c.capsized), c.flutter, c.tapeLit, c.tapeFlash, c.tapeGlintT, c.dissolve, c.phase, c.lampPhase, c.owner ? c.owner.id : -1, c.riders.length,
      b(c.dropped), c.inflate, b(c.alive), c.emptyT, c.deckY, c.sinkAt, c.flood, c.age, c.sinking, c.tipT, c.tip, c.tipDir, c.tipPhase ?? 0,
      n(c.baseRoll), c.anchor.x, c.anchor.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, ...(c.vel ? [c.vel.x, c.vel.z] : [NaN, NaN]),
      b(c.lampDead), c.oilT, c.oilN, c.bubbleT, c.creakT, n(c.washT), b(c.warned), c.lights, ...(c.color ? [c.color.r, c.color.g, c.color.b] : [NaN, NaN, NaN]),
      c.debris.length);
    for (const d of c.debris) v.push(d.dx, d.dz, d.x, d.z, d.y, d.yaw, d.spin);
    for (let k = 0; k < 16; k++) v.push(c.matrix.elements[k]);
  }
  return v;
}

function partMisc(sv) {
  const v = [];
  for (const d of sv.datums) v.push(d.x, d.z, d.radius, d.ids[0], d.s ? d.s.id : -1);
  for (const m of sv.lostMarkers) v.push(m.x, m.z, m.y, m.t, m.s ? m.s.id : -1, m.phase, m.nrm.x, m.nrm.y, m.nrm.z);
  for (const f of sv.playerFlares) v.push(f.x, f.z, f.until);
  const bo = sv.bottle;
  v.push(b(bo.active), b(bo.taken), bo.x, bo.z, bo.y, bo.yaw, bo.phase, bo.capT, b(bo.lift), bo.nrm.x, bo.nrm.y, bo.nrm.z, sv._quoteUsed.size);
  return v;
}

function partFx(fx) {
  const v = [fx.t, b(fx.heli.alive), fx.heli.x, fx.heli.y, fx.heli.z, fx.heli.alt, fx.heli.rpm, fx.heli.vx, fx.heli.vz, fx.dw.x, fx.dw.z, fx.dw.radius,
    fx.dw.strength, fx.focus.x, fx.focus.z, fx.wind.x, fx.wind.y, fx._camPos.x, fx._camPos.y, fx._camPos.z];
  for (const p of fx._poolList) v.push(p.head, p.capacity, p.emitted);
  const S = fx.signals;
  v.push(S.lensCd, S.lensCount, S._night);
  const lp = fx.lightPool;
  const L = (h) => (h ? [lp.handles.indexOf(h), h.slot, h.intensity, h.distance] : [-9, -9, NaN, NaN]);
  for (const f of S.flares) v.push(b(f.alive), f.x, f.y, f.z, f.t, f.life, f.seed, b(f.held), f.lift, f.lx, f.lz, f.flick, f.smokeAcc, f.sparkAcc, ...L(f.light));
  for (const r of S.rockets) v.push(b(r.alive), r.x, r.y, r.z, r.x0, r.y0, r.z0, r.px, r.py, r.pz, r.sx, r.sz, r.t, r.trailAcc, r.seed,
    r.color.r, r.color.g, r.color.b, b(r.lens), r.ax, r.ay, r.az, r.top, ...L(r.light));
  v.push(lp.handles.length, lp.spare.length);
  for (const h of lp.handles) v.push(h.position.x, h.position.y, h.position.z, h.intensity, h.distance, h.slot, h.score, h.color.r, h.color.g, h.color.b);
  for (let i = 0; i < lp.lights.length; i++) {
    const l = lp.lights[i];
    v.push(l.intensity, l.distance, l.position.x, l.position.y, l.position.z, l.color.r, l.color.g, l.color.b, lp.owner[i] ? lp.handles.indexOf(lp.owner[i]) : -1);
  }
  v.push(fx.stars.length, fx.timedLights.length);
  const a = fx._acc;
  v.push(a.dw, a.dwHaze, a.bio, a.crest, a.hail, a.hailShake);
  for (const e of fx.emitters) v.push(e.x, e.z, e.kind, e.lastT, e.budget, e.acc);
  for (const r of fx.rings.list) v.push(b(r.alive), r.x, r.z, r.t, r.life, r.r1, r.I);
  return v;
}

function partLife(fx) {
  const g = fx.gulls;
  const v = [b(g.allowed), g.gateT, g.scanT, b(g.leftAnnounced), b(g._returning), g.limit, g.flocks.length];
  for (const f of g.flocks) v.push(f.anchor ? f.anchor.id : -1, f.cx, f.cz, idx(FLOCK, f.state), f.t, f.fleeT, f.fromX, f.fromZ, f.birds.length);
  for (const bd of g.birds) v.push(b(bd.on), bd.x, bd.y, bd.z, bd.vx, bd.vy, bd.vz, bd.heading, bd.bank, bd.phase, bd.amp, bd.burst, bd.burstT,
    bd.ang, bd.rad, bd.alt, bd.w, bd.seed);
  const d = fx.dolphins;
  const pd = d.pod;
  v.push(b(pd.active), d.timer, pd.t, pd.life, pd.x, pd.z, pd.dx, pd.dz, pd.n, d.limit);
  for (const m of pd.members) v.push(m.ox, m.oz, m.ph, b(m.was));
  const w = fx.whale;
  v.push(b(w.active), w.timer, w.t, w.x, w.z, w.dx, w.dz, b(w.blown), b(w.allowed));
  return v;
}

function partAir(fx) {
  const a = fx.air;
  const v = [a.uAirAmb.value.r, a.uAirAmb.value.g, a.uAirAmb.value.b, a.uAirSun.value.r, a.uAirSun.value.g, a.uAirSun.value.b,
    a.uAirSunDir.value.x, a.uAirSunDir.value.y, a.uAirSunDir.value.z, a.uAirFlash.value.r, a.uAirFlash.value.g, a.uAirFlash.value.b,
    a.uAirNight.value, ...a.uBeamPos.value.toArray(), ...a.uBeamDir.value.toArray(), a.uBeamLen.value];
  for (const p of a.uFxLightPos.value) v.push(...p.toArray());
  for (const c of a.uFxLightCol.value) v.push(...c.toArray());
  v.push(a.uFxTime.value, a.uKillBefore.value, ...a.uHeliP.value.toArray(), ...a.uDownwash.value.toArray(), a.uSeaLevel.value, a.uHs.value);
  return v;
}

// ---- render parts (Float32 buffers as the GPU gets them; [0, count)) ----------------------------------------
const f32 = (arr, nItems, size) => Array.from(arr.subarray(0, nItems * size));
function rCrowd(sv) {
  const c = sv.crowd;
  const m = c.mesh;
  return [c.n, b(m.visible), b(c.ghost.visible), b(c.keyline.visible), b(c.keylineOn), ...f32(m.instanceMatrix.array, c.n, 16),
    ...f32(c.aArms.array, c.n, 4), ...f32(c.aPose.array, c.n, 4), ...f32(c.aLook.array, c.n, 4), ...f32(c.aFx.array, c.n, 4)];
}
function rCraft(sv) {
  const v = [];
  const one = (bt) => {
    v.push(bt.n, ...f32(bt.mesh.instanceMatrix.array, bt.n, 16), ...f32(bt.a1.array, bt.n, 4), ...f32(bt.a2.array, bt.n, 4));
    if (bt.mesh.instanceColor) v.push(...f32(bt.mesh.instanceColor.array, bt.n, 3));
  };
  for (const k of ['raft', 'boat', 'yacht', 'container', 'plane', 'stretcher', 'buoy', 'debris']) one(sv.batches[k]);
  for (const bt of sv.bigBatches) one(bt);
  for (const c of sv.carriers) if (c.decal) {
    const dm = c.decal.mesh;
    v.push(b(dm.visible), c.decal.mat.opacity, ...dm.matrix.elements);
  }
  const bo = sv.bottle;
  v.push(b(bo.group.visible), ...bo.group.matrix.elements);
  return v;
}
function rHeat(sv) {
  const v = [];
  for (const k of ['raft', 'boat', 'yacht', 'plane']) { const h = sv.heat[k]; v.push(h.n, ...f32(h.mesh.instanceMatrix.array, h.n, 16)); }
  return v;
}
const rCollars = (sv) => [sv.collars.n, ...f32(sv.collars.mesh.instanceMatrix.array, sv.collars.n, 16), ...f32(sv.collars.data.array, sv.collars.n, 4)];
const rGlows = (sv) => { const g = sv.glows; return [g.n, ...f32(g.P.array, g.n, 4), ...f32(g.Cc.array, g.n, 4), ...f32(g.H.array, g.n, 4)]; };
const rLines = (sv) => [sv.lines.n, ...f32(sv.lines.pos, sv.lines.n, 6)];
function rUniforms(sv) {
  const u = sv.crowd.ghostMaterial.uniforms;
  const c = (x) => [x.r, x.g, x.b];
  return [...c(u.uLight.value), ...c(u.uWater.value), ...c(sv.collars.material.uniforms.uFoam.value), ...c(sv.rim.value), ...c(sv.nightAmb.value),
    ...c(sv.skyFill.value), ...c(sv.steelFill.value), sv.crowd.material.userData.uniforms.uVestGlow.value];
}
function rPools(fx) {
  const v = [];
  for (const p of fx._poolList) for (const k of ['iA', 'iB', 'iC', 'iD', 'iE', 'iF']) v.push(...p.arrays[k]);
  return v;
}
const rFxGlows = (fx) => { const g = fx.glows; return [g.n, ...f32(g.P, g.n, 4), ...f32(g.C, g.n, 4), ...f32(g.H, g.n, 4), ...f32(g.Hc, g.n, 3)]; };
const rRings = (fx) => { const r = fx.rings; const nn = r.geometry.instanceCount; return [nn, ...f32(r.R, nn, 4), ...f32(r.Rc, nn, 4)]; };
const rFxHeat = (fx) => { const h = fx.signals.heat; return [h.count, ...f32(h.instanceMatrix.array, h.count, 16)]; };
const rGulls = (fx) => { const g = fx.gulls; const nn = g.mesh.count; return [nn, ...f32(g.mesh.instanceMatrix.array, nn, 16), ...f32(g.flapAttr.array, nn, 1)]; };
const rDolphins = (fx) => { const d = fx.dolphins; const nn = d.mesh.count; return [nn, b(d.mesh.visible), ...f32(d.mesh.instanceMatrix.array, nn, 16)]; };
function rWhale(fx) {
  const w = fx.whale;
  w.mesh.updateMatrix();
  w.shade.updateMatrix();
  return [b(w.mesh.visible), ...w.mesh.matrix.elements, b(w.shade.visible), ...w.shade.matrix.elements, w.shade.material.uniforms.uK.value];
}

// ============================================================================================ the runner
function runScenario(sc) {
  const clock = { t: 0, frame: 0 };
  const realLook = new Look(7);
  const events = new EventBus();
  const settings = sc.settings || { quality: 'high', difficulty: 'pilot', reduceFlashes: false };
  const camera = new THREE.PerspectiveCamera(40, 1280 / 720, 2, 1200);
  camera.position.set(0, 220, 60);
  camera.lookAt(0, 0, 0);
  const ctx = {
    scene: new THREE.Scene(), look: realLook, events, camera, mode: 'play', time: { t: 0, dt: 0 },
    settings: { get: (k) => settings[k], onChange: () => {} },
  };
  InstanceBounds.setView = () => {};
  InstanceBounds.prototype.culled = () => false;
  const sv = new Survivors(ctx);
  const fx = new Effects(ctx);
  // the cosmetic stream starts here (SeaContext.random in Swift): re-draw what the constructors drew
  const rng = M.createRng(sc.seed);
  Math.random = () => rng.next();
  for (const bd of fx.gulls.birds) {
    bd.phase = Math.random() * 6.28;
    bd.burstT = 2 + Math.random() * 4;
    bd.seed = Math.random();
  }
  fx.dolphins.timer = 20 + Math.random() * 20;
  fx.whale.timer = 50 + Math.random() * 60;
  // the lightning ribbons (fx/lightning.js strike / spider) are render geometry the port does not have yet
  // (M6): their Math.random draws would shift the shared stream, so the trace runs without them
  fx.lightning.strike = () => {};
  fx.lightning.spider = () => {};

  const bank = new Wv.WaveBank();
  bank.setQuality(8, 300);
  bank.setSeed(303, 0.6);
  const calls = [];
  const ocean = makeOcean(bank, clock, calls);
  const weather = makeWeather(sc.weather, clock);
  const look = makeLook(realLook, clock);
  const heli = makeHeli();
  const post = { thermal: { active: false } };
  const shakes = [];
  const cameraRig = { mode: 'follow', shake: (s, d) => shakes.push([clock.frame, s, d]) };
  const mission = sc.mission ? makeMission(sc.mission) : undefined;
  const world = sc.world ? makeWorld(sc.world) : undefined;
  const hazards = sc.hazards ? makeHazards(sc.hazards, clock) : undefined;
  Object.assign(ctx, { ocean, weather, look, heli, post, cameraRig, mission, survivors: sv, fx, hazards, world });

  // events (ids instead of objects)
  const evLog = [];
  let personSerial = 0;
  const ser = (k, v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (k === 'person') return ++personSerial; // survivor:boarded: the per-mission serial (PersonID)
    if (v.id !== undefined && sv.list.includes(v)) return v.id;
    if (v.isVector3 || (typeof v === 'object' && Object.keys(v).length === 3 && ['x', 'y', 'z'].every((k2) => typeof v[k2] === 'number'))) return [num(v.x), num(v.y), num(v.z)];
    return '<object>';
  };
  // carrier → the group it was built for (mission.js _craftOf: emptied craft keep their def)
  const craftOf = new Map();
  const emit0 = events.emit.bind(events);
  events.emit = (name, p) => {
    if (name === 'survivor:spawn' && p?.s?.carrier) craftOf.set(p.s.carrier, p.s);
    const o = {};
    for (const [k, v] of Object.entries(p || {})) o[k] = k === 'def' ? '<def>' : ser(k, v);
    evLog.push([clock.frame, name, o]);
    emit0(name, p);
  };

  const def = sc.def ? sc.def(sv) : null;
  const pokesOut = [];
  const callsOut = [];
  const heliRows = [];
  const digests = [];
  const rdigests = [];
  const dumps = [];
  const dumpVals = [];
  const nearest = [];
  const applyPoke = (pk) => {
    switch (pk.op) {
      case 'setup': events.emit('mission:setup', { def }); break;
      case 'mode': { const from = ctx.mode; ctx.mode = pk.to; events.emit('game:mode', { from, to: pk.to }); break; }
      case 'emit': events.emit(pk.name, { ...pk.payload }); break;
      case 'signal': { const s = sv.byTag(pk.tag)[0]; if (s) sv.fireSignal(s, pk.kind); break; }
      case 'weather': weather.apply(pk.set); break;
      case 'thermal': post.thermal.active = !!pk.on; break;
      case 'spot': { const s = sv.list.find((g) => g.id === pk.s); if (s) sv.spot(s, pk.by); break; }
      case 'settings': Object.assign(settings, pk.set); break;
      case 'warning': events.emit('hazard:warning', { type: pk.type, text: pk.text, position: new THREE.Vector3(...pk.position) }); break;
      case 'checkpoint': {
        // mission._takeCheckpoint → (retry) mission:setup → survivors.restoreCheckpoint, at once
        const cp = takeCheckpoint(sv, craftOf);
        pk.cp = serialize(cp);
        events.emit('mission:setup', { def });
        const res = sv.restoreCheckpoint(structuredClone(cp));
        res.carriers.forEach((c, i) => c && craftOf.set(c, { def: cp.carriers[i].entry }));
        break;
      }
      default: throw new Error('unknown poke ' + pk.op);
    }
  };
  const applyCall = (c) => {
    const s = sv.list.find((g) => g.id === c.s) || null;
    switch (c.op) {
      case 'attach': sv.attachToBasket(s); heli.winch.load = s; break;
      case 'board': {
        const p = sv.boardOne(s);
        heli.winch.load = null;
        c.person = serialize({ ...p, label: p.label ?? null, tag: p.tag ?? null, pet: p.pet ?? null });
        break;
      }
      case 'detach': sv.detachFromBasket(s, c.slip ? { slip: true, heatLoss: 10, reason: 'unsteady' } : {}); heli.winch.load = null; break;
      default: throw new Error('unknown call ' + c.op);
    }
  };

  const pilot = sc.pilot()(); // a fresh closed-loop pilot (legPilot → factory → step)
  for (clock.frame = 1; clock.frame <= sc.frames; clock.frame++) {
    const frame = clock.frame;
    const dt = 1 / 60;
    clock.t += dt;
    ctx.time.t = clock.t;
    ctx.time.dt = dt;
    // pilot → this frame's heli row, pokes and winch contract calls (it reads the world of the previous frame)
    const u = pilot(frame, clock, sv, heli, bank);
    const row = HELI_FIELDS.map((k) => Math.fround(u.heli[k] ?? 0));
    heliRows.push(...row);
    applyHeliRow(heli, row, ocean);
    for (const pk of [...(sc.pokes?.[frame] || []), ...(u.pokes || [])]) {
      applyPoke(pk);
      pokesOut.push([frame, pk]);
    }
    for (const c of u.calls || []) {
      applyCall(c);
      callsOut.push([frame, c]);
    }
    bank.update(dt, clock.t, sc.sea, 0.6, 1, 0, 0);
    const st = weather.state;
    look.uniforms.uWind.value.set(st.windDir.x * st.windSpeed, st.windDir.y * st.windSpeed);
    camera.position.set(heli.position.x, heli.position.y + 160, heli.position.z + 70);
    camera.lookAt(heli.position.x, 0, heli.position.z);
    calls.length = 0;
    sv.update(dt);
    fx.update(dt);
    // winch read-back: the group nearestFor(basket) would capture (the real winch asks every frame it is out)
    if (heli.winch.state !== 'stowed') {
      const s = sv.nearestFor(heli.winch.basket.x, heli.winch.basket.z, 4.5);
      nearest.push([frame, s ? s.id : -1]);
    }
    const parts = [partEnv(sv), partGroups(sv), partPeople(sv), partCarriers(sv), partMisc(sv), partFx(fx), partLife(fx), partAir(fx), calls.slice()];
    for (const p of parts) digests.push(...digest(p));
    if (sc.dumpAt(frame)) for (let k = 0; k < parts.length; k++) { dumps.push([frame, k, dumpVals.length, parts[k].length]); dumpVals.push(...parts[k]); }
    if (frame % 10 === 0) {
      const rp = [rCrowd(sv), rCraft(sv), rHeat(sv), rCollars(sv), rGlows(sv), rLines(sv), rUniforms(sv), frame % 60 === 0 ? rPools(fx) : [], rFxGlows(fx),
        rRings(fx), rFxHeat(fx), rGulls(fx), rDolphins(fx), rWhale(fx)];
      rdigests.push(frame);
      for (const p of rp) rdigests.push(digest(p).toString('hex'));
      // the particle pools (≈ 60 k values) are dumped at one frame only
      if (sc.dumpAt(frame)) for (let k = 0; k < rp.length; k++) if (k !== 7 || frame === sc.poolDump) { dumps.push([frame, 100 + k, dumpVals.length, rp[k].length]); dumpVals.push(...rp[k]); }
    }
    if (process.env.MAYDAY_SV_DEBUG && frame % 60 === 0) {
      console.log(sc.id, frame, clock.t.toFixed(1), u.phase ?? '', heli.position.toArray().map((x) => x.toFixed(1)).join(','), heli.winch.state,
        sv.list.map((s) => `${s.tag}:${s.state}:${s.remaining}`).join(' '), 'fx', fx._poolList.map((p) => p.emitted).join('/'),
        'rk', fx.signals.rockets.filter((r) => r.alive).length, 'fl', fx.signals.flares.filter((f) => f.alive).length, 'lights', fx.lightPool.handles.length,
        'gulls', fx.gulls.flocks.length, fx.gulls.birds.filter((bd) => bd.on).length, 'dol', fx.dolphins.pod.active, 'wh', fx.whale.active,
        'car', sv.carriers.length, 'glows', sv.glows.n, fx.glows.n, 'crowd', sv.crowd.n);
    }
  }
  return { def, heliRows, pokesOut, callsOut, digests, rdigests, dumps, dumpVals, nearest, evLog, shakes, settings: sc.settings || null };
}

// The recorded heli rows, packed: a column that is constant over the run goes to heliConst, a column equal
// (bit for bit) to an earlier one to heliSame; the rest are the f32 sidecar's columns (heliFields).
function packHeli(id, rows, frames) {
  const W = HELI_FIELDS.length;
  const col = (k) => Float32Array.from({ length: frames }, (_, f) => rows[f * W + k]);
  const cols = HELI_FIELDS.map((_, k) => col(k));
  const same = (a, bb) => a.every((v, i) => Object.is(v, bb[i]));
  const heliConst = {};
  const heliSame = {};
  const keep = [];
  for (let k = 0; k < W; k++) {
    const c = cols[k];
    if (c.every((v) => Object.is(v, c[0]))) { heliConst[HELI_FIELDS[k]] = num(c[0]); continue; }
    const j = keep.find((kk) => same(cols[kk], c));
    if (j !== undefined) { heliSame[HELI_FIELDS[k]] = HELI_FIELDS[j]; continue; }
    keep.push(k);
  }
  const packed = new Float32Array(frames * keep.length);
  for (let f = 0; f < frames; f++) for (let i = 0; i < keep.length; i++) packed[f * keep.length + i] = cols[keep[i]][f];
  return { heliFields: keep.map((k) => HELI_FIELDS[k]), heliConst, heliSame, heli: sidecar('survivors', `run_${id}_heli.f32`, packed, [frames, keep.length]) };
}

function writeRun(sc) {
  const r = runScenario(sc);
  const id = sc.id;
  out('survivors', `run_${id}`, {
    files: [...SV_FILES, ...FX_FILES, relSrc('systems/ocean/waves.js'), relSrc('systems/mission/prepare.js')],
    tolerance: TRACE,
    data: {
      setup: { id, frames: sc.frames, dt: '1/60', seed: sc.seed, sea: sc.sea, weather: serialize(sc.weather), settings: sc.settings || { quality: 'high', difficulty: 'pilot', reduceFlashes: false },
        mission: sc.mission ? serialize(sc.mission) : null, hazards: sc.hazards ? serialize(sc.hazards) : null, world: sc.world ? serialize(sc.world) : null,
        camera: 'position (hx, hy + 160, hz + 70), lookAt (hx, 0, hz), fov 40, aspect 1280/720, near 2, far 1200',
        look: 'gustField(x, z) = 0.5 + 0.3·sin(0.011x + 0.3t)·cos(0.013z); uWind = windDir·windSpeed',
        windAt: 'wind.base + wind.amp · (sin(0.3t + 0.002x), cos(0.21t + 0.002z))' },
      def: r.def ? serialize(r.def) : null,
      ...packHeli(id, r.heliRows, sc.frames),
      pokes: r.pokesOut,
      calls: r.callsOut,
      parts: PARTS,
      digests: sidecar('survivors', `run_${id}_digests.u8`, Uint8Array.from(r.digests), [sc.frames, PARTS.length, 8]),
      renderParts: RPARTS,
      renderDigests: r.rdigests,
      dumps: r.dumps,
      dumpValues: sidecar('survivors', `run_${id}_dumps.f64`, Float64Array.from(r.dumpVals)),
      nearest: r.nearest,
      events: r.evLog,
      shakes: r.shakes,
    },
  });
}

// ============================================================================================ pilots
const sat = (x) => Math.min(1, Math.max(0, x));
// A closed-loop pilot over a list of legs. Leg kinds: pad (rotor spin-up on the pad), climb, transit (to a group
// by tag / a point), descend, hover (hold, optionally `until` a condition), winch (lower → capture → raise →
// board, repeated while the group has people; `slipFirst` drops the first person back halfway up), pokes,
// drop (a life raft next to a group), land. Optional `beam: {i, aim}` points the searchlight at the leg's
// group. It writes the heli row and asks for winch contract calls; it reads the web state of the last frame.
function legPilot(legs) {
  return () => {
    const H = { x: 0, y: 14, z: 0, alt: 1, rpm: 0.55, vx: 0, vy: 0, vz: 0, landed: 1, padY: 13, dw: true, wState: 0, bx: 0, by: 0, bz: 0,
      length: 0, spin: 0 };
    let li = 0;
    let lt = 0;
    let load = null;
    let slipped = false;
    return (frame, clock, sv, heli, bank) => {
      const dt = 1 / 60;
      const calls = [];
      const pokes = [];
      const leg = legs[li];
      lt += dt;
      const done = () => { li = Math.min(legs.length - 1, li + 1); lt = 0; };
      const groupOf = (tag) => sv.list.find((s) => s.tag === tag && s.state !== 'rescued' && s.state !== 'lost');
      const track = (tx, tz, speed) => {
        const dx = tx - H.x, dz = tz - H.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, speed * dt);
        const k = d > 1e-6 ? step / d : 0;
        H.vx = d > 1e-6 ? (dx / d) * Math.min(speed, d / dt) : 0;
        H.vz = d > 1e-6 ? (dz / d) * Math.min(speed, d / dt) : 0;
        H.x += dx * k;
        H.z += dz * k;
        return d;
      };
      const g = leg.tag ? groupOf(leg.tag) : null;
      // a fixed point, or the drifting bottle while it is in the water
      const pt = leg.bottle ? (sv.bottle.active && !sv.bottle.taken ? { x: sv.bottle.x, z: sv.bottle.z } : null) : leg.x !== undefined ? { x: leg.x, z: leg.z } : null;
      switch (leg.kind) {
        case 'pad':
          H.landed = 1;
          H.rpm = Math.min(1, 0.55 + 0.45 * (lt / leg.dur));
          H.alt = 1;
          if (lt >= leg.dur) done();
          break;
        case 'climb':
          if (H.landed) H.alt = Math.max(H.alt, H.padY + 1); // lift off the pad
          H.landed = 0;
          H.rpm = 1;
          H.alt = Math.min(leg.alt, H.alt + 6 * dt);
          if (H.alt >= leg.alt) done();
          break;
        case 'transit': {
          if ((leg.tag && !g) || (leg.bottle && !pt)) { done(); break; } // the group is gone (rescued / lost), the bottle taken
          const tx = g ? g.position.x + (leg.dx || 0) : pt.x;
          const tz = g ? g.position.z + (leg.dz || 0) : pt.z;
          H.alt += (leg.alt - H.alt) * Math.min(1, dt * 1.5);
          const d = track(tx, tz, leg.speed || 25);
          if (d < (leg.near || 3)) done();
          break;
        }
        case 'descend': {
          if (g) track(g.position.x + (leg.dx || 0), g.position.z + (leg.dz || 0), 6);
          else if (pt) track(pt.x, pt.z, 6);
          H.alt = Math.max(leg.alt, H.alt - 4 * dt);
          if (H.alt <= leg.alt + 1e-9) done();
          break;
        }
        case 'hover': {
          if (g) track(g.position.x + (leg.dx || 0), g.position.z + (leg.dz || 0), 6);
          else if (pt) track(pt.x, pt.z, 6);
          if (leg.alt !== undefined) H.alt += (leg.alt - H.alt) * Math.min(1, dt * 1.2);
          if (lt >= leg.dur || (leg.until && leg.until(sv, g)) || (leg.bottle && !pt)) done();
          break;
        }
        case 'winch': {
          if (!g && !load) { H.wState = H.length > 0 ? 3 : 0; if (H.length <= 0) done(); }
          if (g) track(g.position.x, g.position.z, 4);
          if (H.wState === 0 && g) { H.wState = 1; H.length = 0; }
          if (H.wState === 1 || H.wState === 2) {
            H.length = Math.min(H.alt + 3, H.length + 4 * dt);
            const sea = bank.heightAt(H.x, H.z);
            const hgt = H.y - H.length - sea;
            if (hgt < 1.2 || (g && g.deckY !== undefined && H.y - H.length < g.deckY + 1)) H.wState = 2;
            if (H.wState === 2 && !load) {
              const s = sv.nearestFor(H.bx, H.bz, 4.5);
              if (s && s.tag === leg.tag && lt > 0.8) { calls.push({ op: 'attach', s: s.id }); load = s; H.wState = 3; }
            }
          } else if (H.wState === 3) {
            H.length = Math.max(0, H.length - 3 * dt);
            if (leg.slipFirst && !slipped && load && H.length < (H.alt + 3) * 0.5) {
              slipped = true;
              calls.push({ op: 'detach', s: load.id, slip: true });
              load = null;
              H.wState = 1;
              lt = 0;
            } else if (H.length <= 0) {
              if (load) {
                calls.push({ op: 'board', s: load.id });
                const left = load.remaining - 1;
                load = null;
                if (left <= 0 || (leg.n && --leg.n <= 0)) done();
              }
              H.wState = 0;
              lt = 0;
            }
          }
          break;
        }
        case 'pokes':
          pokes.push(...leg.pokes);
          done();
          break;
        case 'drop':
          if (g) pokes.push({ op: 'emit', name: 'heli:raft-drop', payload: { x: g.position.x + (leg.dx || 0), z: g.position.z + (leg.dz || 0) } });
          done();
          break;
        case 'land': {
          const d = track(leg.x, leg.z, 20);
          if (d < 2) { H.alt = Math.max(1, H.alt - 5 * dt); if (H.alt <= 1) { H.landed = 1; H.rpm = Math.max(0.55, H.rpm - 0.1 * dt); } }
          break;
        }
        default: throw new Error('unknown leg ' + leg.kind);
      }
      H.y = H.landed ? H.padY + 1 : H.alt + bank.heightAt(H.x, H.z);
      H.spin += dt * 0.4;
      H.bx = H.x + 0.3 * Math.sin(clock.t * 1.3);
      H.bz = H.z + 0.3 * Math.cos(clock.t * 1.1);
      H.by = H.y - H.length;
      const out = H.wState !== 0;
      const R = 9 + 0.35 * Math.max(0, H.alt);
      const sd = sat(1 - (H.alt - 4) / 28);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), H.spin);
      // searchlight: a fixed direction, or aimed at the leg's group
      const beam = leg.beam ?? null;
      let bdx = 0, bdy = -1, bdz = 0;
      if (beam) {
        const ag = beam.aim ? groupOf(beam.aim) : null;
        if (ag) {
          const ex = ag.position.x - H.x, ey = ag.position.y - (H.y - 1), ez = ag.position.z - H.z;
          const l = Math.hypot(ex, ey, ez) || 1;
          bdx = ex / l; bdy = ey / l; bdz = ez / l;
        } else if (beam.dx !== undefined) {
          bdx = beam.dx; bdz = beam.dz; bdy = -Math.sqrt(Math.max(0, 1 - bdx * bdx - bdz * bdz));
        }
      }
      const heliRow = {
        x: H.x, y: H.y, z: H.z, alt: H.alt, alive: 1, landed: H.landed, padY: H.padY, rpm: H.rpm, vx: H.vx, vy: 0, vz: H.vz,
        dwHas: H.dw ? 1 : 0, dwX: H.x, dwZ: H.z, dwR: R, dwS: sd * sd * H.rpm,
        beamOn: beam ? 1 : 0, beamI: beam ? beam.i : 0, beamOx: H.x, beamOy: H.y - 1, beamOz: H.z, beamDx: bdx, beamDy: bdy, beamDz: bdz,
        beamCos: 0.97, beamLen: 30, wState: H.wState, basketHas: 1, bx: H.bx, by: H.by, bz: H.bz,
        wHeight: H.by - bank.heightAt(H.bx, H.bz), bmVisible: out ? 1 : 0, bmPx: H.bx, bmPy: H.by, bmPz: H.bz, bmQx: q.x, bmQy: q.y, bmQz: q.z, bmQw: q.w,
      };
      return { heli: heliRow, calls, pokes, phase: `${li}:${leg.kind}` };
    };
  };
}

// ============================================================================================ scenarios
const CALM_PAL = { ambient: [0.42, 0.47, 0.52], ambientIntensity: 0.62, sun: [1, 0.93, 0.82], sunIntensity: 2.2, sky: [0.45, 0.6, 0.78],
  foam: [0.86, 0.9, 0.9], body: [0.03, 0.09, 0.12] };
const NIGHT_PAL = { ambient: [0.05, 0.06, 0.08], ambientIntensity: 0.3, sun: [0.3, 0.35, 0.5], sunIntensity: 0.2, sky: [0.02, 0.03, 0.05],
  foam: [0.3, 0.33, 0.35], body: [0.005, 0.01, 0.015] };
const ROUGH_PAL = { ambient: [0.3, 0.33, 0.37], ambientIntensity: 0.7, sun: [0.85, 0.85, 0.82], sunIntensity: 1.9, sky: [0.32, 0.38, 0.45],
  foam: [0.8, 0.83, 0.84], body: [0.02, 0.06, 0.08] };

// op1 «Первый вылет»: the prepared campaign def; both kayakers and the raft crew lifted, scripted rockets,
// loudspeaker, a player flare, a landing.
const OP1 = {
  id: 'op1',
  seed: 4242,
  frames: Number(process.env.MAYDAY_SV_FRAMES || 9600),
  sea: { Hs: 0.5, swellAdd: 0.4, Q: 0.25, clearing: 0 },
  weather: { preset: 'calm', night: 0, intensity: 0, fog: 0, rain: 0, hail: 0, waveHeight: 0.5, windDir: [0.7071067811865476, -0.7071067811865476, 0],
    windSpeed: 3, flash: 0, sunDir: [0.4, 0.8, 0.3], sunDirVisual: [0.4, 0.8, 0.3], palette: CALM_PAL, wind: { base: [2.1, -2.1], amp: 0.4 }, detect: [260, 1] },
  def: (sv) => prepareDef(CAMPAIGN[0], { index: 0, survivorTypes: sv.types }),
  pokes: {
    1: [{ op: 'setup' }],
    600: [{ op: 'signal', tag: 'kayak-1', kind: 'rocket' }], // script {at: 10, do: 'rocket', tag: 'kayak-1'}
  },
  pilot: () => legPilot([
    { kind: 'pad', dur: 3 },
    { kind: 'climb', alt: 40 },
    { kind: 'transit', tag: 'kayak-1', alt: 40, speed: 18, dx: -14, dz: 6, near: 4 },
    { kind: 'descend', tag: 'kayak-1', alt: 11 },
    { kind: 'hover', tag: 'kayak-1', alt: 11, dur: 2 },
    { kind: 'winch', tag: 'kayak-1' },
    { kind: 'pokes', pokes: [{ op: 'emit', name: 'heli:loudspeaker', payload: { x: 300, z: -260 } }] },
    { kind: 'hover', alt: 30, dur: 5 },
    { kind: 'pokes', pokes: [{ op: 'signal', tag: 'kayak-2', kind: 'rocket' }] },
    { kind: 'transit', tag: 'kayak-2', alt: 30, speed: 20, dx: 10, dz: -8, near: 4 },
    { kind: 'pokes', pokes: [{ op: 'emit', name: 'heli:flare', payload: { x: 400, z: -320 } }, { op: 'signal', tag: 'kayak-raft', kind: 'rocket' }] },
    { kind: 'descend', tag: 'kayak-2', alt: 10 },
    { kind: 'winch', tag: 'kayak-2' },
    { kind: 'transit', tag: 'kayak-raft', alt: 35, speed: 30, dx: 12, dz: 0, near: 5 },
    { kind: 'descend', tag: 'kayak-raft', alt: 12, dx: 9 },
    { kind: 'hover', tag: 'kayak-raft', alt: 12, dur: 1.5, dx: 4 },
    { kind: 'winch', tag: 'kayak-raft' },
    { kind: 'hover', alt: 40, dur: 3 },
    { kind: 'land', x: 0, z: 0 },
  ]),
  dumpAt: (f) => f <= 3 || f === 10 || f === 60 || f % 600 === 0,
  poolDump: 1800,
};

// night: strobes, a handheld flare in a hand, rockets, EPIRB, searchlight spotting, FLIR, a raft capsized by the
// downwash, a life raft dropped to a pair of swimmers (they swim to it and climb in), a stretcher case, a swimmer
// lost to the cold, a late (pending) group, fog, a lightning strike on the sea, reduceFlashes, a pause, and a
// checkpoint taken and restored mid-flight (free carriers: the capsized raft and the dropped one with its riders).
const NIGHT = {
  id: 'night',
  seed: 777,
  frames: 11400,
  settings: { quality: 'high', difficulty: 'ace', reduceFlashes: false },
  sea: { Hs: 1.1, swellAdd: 0.5, Q: 0.3, clearing: 0 },
  weather: { preset: 'nightCalm', night: 1, intensity: 0.15, fog: 0.1, rain: 0, hail: 0, waveHeight: 1.1, windDir: [0.8, 0.6, 0], windSpeed: 6, flash: 0,
    flashColor: [0.6, 0.65, 1], sunDir: [-0.3, 0.5, 0.2], sunDirVisual: [-0.3, 0.5, 0.2], palette: NIGHT_PAL, wind: { base: [4.8, 3.6], amp: 0.8 },
    detect: [80, 0.5] },
  def: () => ({
    seed: 31337, waterTemp: 9, current: { x: 0.12, z: -0.05 }, theme: null, script: [],
    survivors: [
      { tag: 'sw-a', type: 'swimmer', x: 150, z: -120, count: 2, hidden: true, datumRadius: 90, signals: { strobe: true, whistle: true } },
      { tag: 'raft-n', type: 'raft', x: -140, z: -210, count: 2, hidden: true, signals: { rockets: 2, flares: 1, epirb: true } },
      { tag: 'inj', type: 'injured', x: 90, z: 170, count: 1, hidden: false, signals: { strobe: true } },
      { tag: 'cold', type: 'swimmer', x: 520, z: 380, count: 1, hidden: true, since: 30 },
      { tag: 'drop', type: 'swimmer', x: -330, z: 60, count: 2, hidden: false, signals: { strobe: false } },
      { tag: 'late', type: 'swimmer', x: 60, z: -300, count: 1, at: 40, hidden: true },
    ],
  }),
  pokes: {
    1: [{ op: 'setup' }],
    2400: [{ op: 'thermal', on: true }],
    3000: [{ op: 'weather', set: { fog: 0.6 } }],
    3600: [{ op: 'thermal', on: false }],
    4200: [{ op: 'weather', set: { fog: 0.1 } }],
    4800: [{ op: 'settings', set: { reduceFlashes: true } }],
    5000: [{ op: 'emit', name: 'weather:lightning', payload: { x: -200, z: 100, distance: 300, strength: 1, cloudOnly: false } }],
    5400: [{ op: 'settings', set: { reduceFlashes: false } }],
    5900: [{ op: 'checkpoint' }],
    6000: [{ op: 'mode', to: 'paused' }],
    6120: [{ op: 'mode', to: 'play' }],
    8000: [{ op: 'emit', name: 'weather:lightning', payload: { x: 260, z: -40, distance: 200, strength: 0.8, cloudOnly: true } }],
  },
  pilot: () => legPilot([
    { kind: 'pad', dur: 3 },
    { kind: 'climb', alt: 50 },
    { kind: 'transit', tag: 'sw-a', alt: 45, speed: 22, dx: -6, dz: 4, near: 4, beam: { i: 1, aim: 'sw-a' } },
    { kind: 'descend', tag: 'sw-a', alt: 11, beam: { i: 1, aim: 'sw-a' } },
    { kind: 'hover', tag: 'sw-a', alt: 11, dur: 1.5, beam: { i: 1, aim: 'sw-a' } },
    { kind: 'winch', tag: 'sw-a', beam: { i: 0.8, aim: 'sw-a' } },
    { kind: 'pokes', pokes: [{ op: 'emit', name: 'heli:loudspeaker', payload: { x: -140, z: -210 } }] },
    { kind: 'transit', tag: 'drop', alt: 30, speed: 35, dx: 16, near: 5, beam: { i: 1, aim: 'drop' } },
    { kind: 'drop', tag: 'drop', dx: 10, dz: 0 },
    { kind: 'transit', tag: 'inj', alt: 30, speed: 35, near: 4, beam: { i: 1, aim: 'inj' } },
    { kind: 'descend', tag: 'inj', alt: 11, beam: { i: 1, aim: 'inj' } },
    { kind: 'winch', tag: 'inj' },
    { kind: 'pokes', pokes: [{ op: 'emit', name: 'heli:flare', payload: { x: 500, z: 360 } }] },
    { kind: 'transit', tag: 'raft-n', alt: 30, speed: 35, near: 4, beam: { i: 1, aim: 'raft-n' } },
    { kind: 'descend', tag: 'raft-n', alt: 6 },
    { kind: 'hover', tag: 'raft-n', alt: 6, dur: 3 },
    { kind: 'hover', tag: 'raft-n', alt: 11, dur: 2 },
    { kind: 'winch', tag: 'raft-n', beam: { i: 0.6, dx: 0.1, dz: 0.1 } },
    { kind: 'transit', tag: 'drop', alt: 30, speed: 35, near: 4, beam: { i: 1, aim: 'drop' } },
    { kind: 'hover', tag: 'drop', alt: 25, dur: 20, until: (sv, g) => !!g?.carrier },
    { kind: 'descend', tag: 'drop', alt: 12 },
    { kind: 'winch', tag: 'drop' },
    { kind: 'transit', tag: 'cold', alt: 40, speed: 35, near: 6 },
    { kind: 'hover', alt: 40, dur: 4 },
    { kind: 'land', x: 0, z: 0 },
  ]),
  dumpAt: (f) => f <= 3 || f === 60 || f % 900 === 0,
  poolDump: 2700,
};

// core: a rough day sea (Hs 4.2) with every carrier — the boat «МАРИЯ» with a cat, a yacht that sinks early,
// the Ан-2 with a dog, a container tipping people off, the ferry «Северянка» flooding, the trawler «Вайгач»,
// a barge aground, the rig's lower deck — plus a whirlpool, a rogue crest, a surface flow, the bottle picked
// up by hovering, orange smoke / dye / mirror, hail with camera shakes, a waterspout warning that scares the
// gulls, a slip off the cable, a pause, and a checkpoint restored with emptied craft drifting free.
const CORE = {
  id: 'core',
  seed: 9001,
  frames: 9000,
  settings: { quality: 'medium', difficulty: 'cadet', reduceFlashes: false },
  sea: { Hs: 4.2, swellAdd: 0.6, Q: 0.35, clearing: 0 },
  weather: { preset: 'overcast', night: 0, intensity: 0.5, fog: 0, rain: 0.1, hail: 0, waveHeight: 4.2, windDir: [-0.6, 0.8, 0], windSpeed: 14, flash: 0,
    flashColor: [1, 1, 1], sunDir: [0.5, 0.7, -0.2], sunDirVisual: [0.5, 0.7, -0.2], palette: ROUGH_PAL, wind: { base: [-8.4, 11.2], amp: 1.5 },
    detect: [220, 1] },
  world: {
    pads: [{ x: -400, z: -420, radius: 30, lowerDeck: { x: -400, y: 9, z: -420 } }, { x: 0, z: 0, radius: 18 }],
    obstacles: [{ x: 150, z: 150, radius: 25 }],
  },
  hazards: {
    whirlpools: [{ x: 200, z: 430, radius: 40 }],
    rogues: [{ dir: [0.6, 0.8], from: -700, speed: 14, t0: 20, t1: 90, peak: 5, width: 9 }],
    flow: [0.05, -0.02],
  },
  def: () => ({
    seed: 4711, waterTemp: 12, current: { x: -0.1, z: 0.15 }, theme: null, script: [],
    world: { props: { bottle: { x: 40, z: -30 } } },
    survivors: [
      { tag: 'boat', type: 'hull', x: 120, z: -60, count: 2, name: 'МАРИЯ', pet: 'cat', hidden: false, sinkTime: 150, signals: { flares: 1, smoke: true, dye: true } },
      { tag: 'yacht', type: 'hull', x: -160, z: -140, count: 2, label: 'яхта «Ветер»', hidden: true, sinkTime: 60, signals: { mirror: true, rockets: 1 } },
      { tag: 'plane', type: 'plane', x: 300, z: 200, count: 3, reg: 'RA-40217', sinkTime: 100, hidden: false, pet: 'dog' },
      { tag: 'box', type: 'container', x: -60, z: 260, count: 3, color: '#1F5E8C', hidden: false },
      { tag: 'ferry', type: 'wreck', x: 420, z: -300, count: 6, name: 'Северянка', height: 6, heading: 0.4, sinkTime: 120 },
      { tag: 'rig', type: 'deck', x: -400, z: -420, count: 3, height: 9 },
      { tag: 'barge', type: 'deck', x: 600, z: 500, count: 2, height: 4 },
      { tag: 'trawler', type: 'wreck', x: -520, z: 300, count: 2, name: 'Вайгач', height: 5, sinkTime: 400 },
      { tag: 'wp-core', type: 'swimmer', x: 203, z: 428, count: 1, hidden: false },
      { tag: 'wp-edge', type: 'swimmer', x: 222, z: 445, count: 2, hidden: false },
      { tag: 'rogue-raft', type: 'raft', x: -250, z: 0, count: 3, hidden: false, signals: { rockets: 0 } },
      { tag: 'sig', type: 'swimmer', x: 470, z: 60, count: 1, hidden: true, signals: { smoke: 1, dye: true, mirror: true, whistle: true } },
      { tag: 'radar', type: 'swimmer', x: -600, z: -100, count: 1, hidden: true, signals: { whistle: false } },
    ],
  }),
  pokes: {
    1: [{ op: 'setup' }],
    1500: [{ op: 'spot', s: 13, by: 'radar' }],
    2400: [{ op: 'warning', type: 'waterspout', text: 'Смерч', position: [60, 0, -40] }],
    3000: [{ op: 'weather', set: { hail: 0.6 } }],
    3600: [{ op: 'weather', set: { hail: 0 } }],
    4200: [{ op: 'mode', to: 'paused' }],
    4320: [{ op: 'mode', to: 'play' }],
    6600: [{ op: 'checkpoint' }],
  },
  pilot: () => legPilot([
    { kind: 'pad', dur: 2 },
    { kind: 'climb', alt: 35 },
    { kind: 'transit', bottle: true, alt: 20, speed: 20, near: 2 },
    { kind: 'descend', bottle: true, alt: 5 },
    { kind: 'hover', bottle: true, alt: 5, dur: 4 },
    { kind: 'hover', alt: 20, dur: 2 },
    { kind: 'transit', tag: 'boat', alt: 25, speed: 25, near: 3 },
    { kind: 'descend', tag: 'boat', alt: 12 },
    { kind: 'winch', tag: 'boat', slipFirst: true },
    { kind: 'transit', tag: 'plane', alt: 30, speed: 30, near: 3 },
    { kind: 'descend', tag: 'plane', alt: 13 },
    { kind: 'winch', tag: 'plane' },
    { kind: 'transit', tag: 'box', alt: 30, speed: 30, near: 3 },
    { kind: 'descend', tag: 'box', alt: 13 },
    { kind: 'winch', tag: 'box', n: 2 },
    { kind: 'transit', tag: 'rig', alt: 30, speed: 35, near: 3 },
    { kind: 'descend', tag: 'rig', alt: 18 },
    { kind: 'winch', tag: 'rig', n: 1 },
    { kind: 'hover', alt: 30, dur: 4 },
    { kind: 'land', x: 0, z: 0 },
  ]),
  dumpAt: (f) => f <= 3 || f === 60 || f % 900 === 0,
  poolDump: 1800,
};

// Each trace runs in its own process: module-level state of the web code (carriers.js NEXT_ID, bottle.js
// noteCursor, three's uuid counter) would otherwise leak from one scenario into the next.
const RUNS = { op1: OP1, night: NIGHT, core: CORE };
const runIds = Object.keys(RUNS).filter(want);
if (process.env.MAYDAY_SV_CHILD) {
  for (const id of runIds) writeRun(RUNS[id]);
} else {
  for (const id of runIds) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--only', id, '--out', OUT], { stdio: 'inherit', env: { ...process.env, MAYDAY_SV_CHILD: '1' } });
    if (r.status !== 0) throw new Error(`export-survivors: scenario ${id} failed (${r.status})`);
  }
}

// ============================================================================================ summary
for (const r of results) console.log(`${r.path}  ${r.bytes} B`);
