// export-core: parity vectors for the core foundation of the port (MaydayCore Math/, Core/, Input/,
// Settings/), produced by running the REAL web code in Node 22 (the reference engine):
//
//   math/jsnumber.json          Math.round, ToUint32/ToInt32, `%`, String(n), toFixed, parseFloat,
//                               parseInt, Number(string)                       (V8 builtins)
//   math/three_<class>.json     three.js r185 math (vendored rescue/vendor/three) on randomized and
//                               edge-case inputs: utils, vector, quaternion, euler, matrix, color
//   core/events.json            core/events.js EventBus delivery-order scripts
//   core/loop.json              main.js frame() (the real function source, extracted with acorn)
//   settings/settings.json      core/settings.js: defaults, migrations, first-run rules, set/onChange
//   input/input.json            core/input.js: bindings, applyBindings, poll() sequences
//   input/haptics.json          core/haptics.js: game events → gamepad rumble (mode / device / vibration gates)
//
// Same wrapper / numbers / determinism rules as export-vectors.mjs (see tools/README.md).
// Usage: node rescue-apple/tools/export/export-core.mjs [--only jsnumber,three,events,loop,settings,input,haptics] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APPLE, SRC_DIR, num, writeWrapped, relSrc } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/export-core.mjs';
const results = [];
const warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));

const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern (NaN == NaN); report index, both values and ulp distance on mismatch' };
const BYTES = { class: 'bytes', note: 'strings compared byte for byte (UTF-8)' };

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}

// Deterministic input generator (mulberry32).
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
const N = (a) => Array.from(a, num);

// ================================================================================================ jsnumber
async function jsnumber() {
  const R = mulberry(0x4a53);
  const rnd = (lo, hi) => lo + (hi - lo) * R();
  const mags = () => { const e = Math.floor(rnd(-12, 22)); return (R() < 0.5 ? -1 : 1) * rnd(1, 10) * 10 ** e; };

  // Math.round: halves, near-halves, signed zero, huge values, specials
  const roundIn = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.49999999999999994, -0.49999999999999994, 0.5000000000000001,
    -0.5000000000000001, 4503599627370495.5, -4503599627370495.5, 4503599627370497, 9007199254740993, 1e300, -1e300,
    5e-324, -5e-324, 255.5, -255.5, 1 / 3, -2 / 3, NaN, Infinity, -Infinity];
  for (let i = 0; i < 120; i++) roundIn.push(R() < 0.5 ? Math.round(rnd(-1e4, 1e4)) + (R() < 0.5 ? 0.5 : -0.5) : mags());

  // ToUint32 / ToInt32 from large products (hash seeds) and from fractional / negative values
  const intIn = [0, -0, 1, -1, 0.9, -0.9, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297,
    -4294967297, 9007199254740992, 9007199254740994, 1e21, -1e21, 1.2345678901234567e19, 1e300, NaN, Infinity, -Infinity];
  for (let i = 0; i < 80; i++) intIn.push(Math.floor(rnd(0, 4294967296)) * [2654435761, 2246822519, 7919, 1664525, 1103515245][i % 5] + (i % 7));
  for (let i = 0; i < 40; i++) intIn.push(mags());

  // a % b (sign of the dividend, exact)
  const modIn = [[-7, 3], [7, -3], [-0, 3], [7.5, -2], [5.5, 1], [-5.5, 1], [1e20, 3], [Math.PI * 7, Math.PI * 2], [-Math.PI * 7, Math.PI * 2],
    [1, 0], [0, 0], [NaN, 1], [1, NaN], [Infinity, 2], [3, Infinity], [-3, Infinity], [0.1, 0.01]];
  for (let i = 0; i < 60; i++) modIn.push([rnd(-1000, 1000), [Math.PI * 2, 1, 360, 0.25, 7, -3][i % 6]]);

  // String(n)
  const strIn = [0, -0, 1, -1, 0.1, 0.5, 1.5, 123.456, 1e21, 1e20, 123e18, 1e-7, 1.5e-7, 1e-6, 0.000001234, -1e-7, 5e-324,
    1.7976931348623157e308, 4294967295, 9007199254740993, 0.1 + 0.2, 3e-5, 1 / 3, 2 / 3, 100, 1e100, 1.2345678901234567e-300,
    NaN, Infinity, -Infinity];
  for (let i = 0; i < 80; i++) strIn.push(mags());

  // toFixed: tie cases that are not ties in binary, signed zero, the game's digits (0…5) and wide ones
  const fixedIn = [[1.005, 2], [1.45, 1], [2.5, 0], [-2.5, 0], [0.5, 0], [-0.5, 0], [1.5, 0], [0.05, 1], [0.15, 1], [0.25, 1],
    [0.35, 1], [9.995, 2], [123.456, 2], [-0.0001, 2], [-0, 2], [0, 0], [1e20, 2], [1e21, 2], [-1e21, 3], [1e-7, 3],
    [0.000001, 7], [1.23e-10, 20], [Math.PI, 100], [5e-324, 100], [1.7976931348623157e308, 3], [4294967295.5, 0],
    [999.9999, 3], [0.9999, 3], [99.95, 1], [-99.95, 1], [NaN, 2], [Infinity, 1], [-Infinity, 0], [12.5, 0], [13.5, 0]];
  for (let i = 0; i < 120; i++) fixedIn.push([R() < 0.7 ? rnd(-2000, 2000) : mags(), [0, 1, 2, 3, 4, 5, 20][i % 7]]);

  // parseFloat / parseInt / Number(string)
  const strs = ['', ' ', '0', '-0', '+0', '12', '  12  ', '\t\n12.5e3x', '1.', '.5', '-.5', '+.5', '.', '-', '+', 'e5', '1e', '1e+',
    '1e-3', '1E3', '1_000', '0x10', '0X1f', '-0x10', '+0x10', '0x', '0xg', '0b101', '0o17', '0b', '00012', '1.2.3', 'Infinity',
    '-Infinity', '+Infinity', 'Infinityx', 'infinity', 'NaN', ' 12 ', '﻿7', '12px', '#ff8800', 'ff8800', 'FFFFFF',
    '1e400', '-1e400', '1e-400', '123456789012345678901234567890', '0.1e1', '9007199254740993', '0x20000000000001',
    '0x1fffffffffffff', '0x400000000000000080000000000000001', '3.14abc', '  -7  ', '　-8', '١٢', '12 34'];
  const radixes = [0, 10, 16, 2, 8, 36, 1, 37, 16.9, -1];
  const parseIntCases = [];
  for (const s of strs) parseIntCases.push([s, 0]);
  for (const s of ['ff', 'FF', '0xff', '-ff', '777', '1010', 'zz', 'Zz9', '12', '0x10', ' 9', '']) for (const r of radixes) parseIntCases.push([s, r]);

  out('math', 'jsnumber', {
    files: ['Node ' + process.version + ' (V8 Number builtins)'],
    tolerance: { class: 'bitwise', note: 'numbers bit-exact (NaN == NaN), strings byte-exact; parseInt radix 0 = undefined' },
    data: {
      node: process.version,
      round: roundIn.map((x) => [num(x), num(Math.round(x))]),
      toUint32: intIn.map((x) => [num(x), num(x >>> 0)]),
      toInt32: intIn.map((x) => [num(x), num(x | 0)]),
      mod: modIn.map(([a, b]) => [num(a), num(b), num(a % b)]),
      toString: strIn.map((x) => [num(x), String(x)]),
      toFixed: fixedIn.map(([x, f]) => [num(x), f, x.toFixed(f)]),
      parseFloat: strs.map((s) => [s, num(parseFloat(s))]),
      parseInt: parseIntCases.map(([s, r]) => [s, r, num(r === 0 ? parseInt(s) : parseInt(s, r))]),
      number: strs.map((s) => [s, num(Number(s))]),
    },
  });
}

// ================================================================================================ three
// Ops are encoded as rows [inputs…, outputs…] (`in` and `out` give the split). Euler orders and colour
// spaces are passed as indices into ORDERS / SPACES so every row stays numeric.
const ORDERS = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
const SPACES = ['', 'srgb', 'srgb-linear'];

async function three() {
  const T = await import('three');
  const R = mulberry(0x7493);
  const rnd = (lo, hi) => lo + (hi - lo) * R();
  const sc = () => { const k = R(); return k < 0.6 ? rnd(-10, 10) : k < 0.85 ? rnd(-1000, 1000) : rnd(-0.01, 0.01); };
  const v2 = () => [sc(), sc()];
  const v3 = () => [sc(), sc(), sc()];
  const v4 = () => [sc(), sc(), sc(), sc()];
  const unit3 = () => { const v = new T.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(); return [v.x, v.y, v.z]; };
  const quat = () => { const q = new T.Quaternion(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(); return [q.x, q.y, q.z, q.w]; };
  const ang = () => rnd(-Math.PI, Math.PI);
  const ord = () => Math.floor(R() * 6);
  const trs = () => { // a random affine TRS matrix (scale may be negative)
    const m = new T.Matrix4();
    const s = v3().map((x) => (Math.abs(x) < 0.05 ? 0.5 : x) / 3);
    m.compose(new T.Vector3(...v3()), new T.Quaternion(...quat()), new T.Vector3(...s));
    return [...m.elements];
  };
  const rot = () => { const m = new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion(...quat())); return [...m.elements]; };
  const m4 = () => (R() < 0.5 ? trs() : Array.from({ length: 16 }, sc));
  const m3 = () => Array.from({ length: 9 }, sc);
  const M4 = (a, o = 0) => new T.Matrix4().fromArray(a, o);
  const M3 = (a, o = 0) => new T.Matrix3().fromArray(a, o);
  const V2 = (a, o = 0) => new T.Vector2(a[o], a[o + 1]);
  const V3 = (a, o = 0) => new T.Vector3(a[o], a[o + 1], a[o + 2]);
  const V4 = (a, o = 0) => new T.Vector4(a[o], a[o + 1], a[o + 2], a[o + 3]);
  const Q = (a, o = 0) => new T.Quaternion(a[o], a[o + 1], a[o + 2], a[o + 3]);
  const E = (a, o = 0) => new T.Euler(a[o], a[o + 1], a[o + 2], ORDERS[a[o + 3]]);
  const C = (a, o = 0) => new T.Color(a[o], a[o + 1], a[o + 2]);
  const v2o = (v) => [v.x, v.y];
  const v3o = (v) => [v.x, v.y, v.z];
  const v4o = (v) => [v.x, v.y, v.z, v.w];
  const qo = (q) => [q.x, q.y, q.z, q.w];
  const co = (c) => [c.r, c.g, c.b];

  // One table per file: name → {in, out, rows}. `cases` random rows + `edge` fixed rows.
  const COUNT = { utils: 48, vector: 40, quaternion: 48, euler: 48, matrix: 28, color: 48 };
  function table(file, defs) {
    const ops = {};
    for (const [name, d] of Object.entries(defs)) {
      const rows = [];
      const inputs = [...(d.edge || [])];
      for (let i = 0; i < (d.count ?? COUNT[file]); i++) inputs.push(d.gen());
      for (const a of inputs) {
        if (a.length !== d.in) throw new Error(`${file}.${name}: input arity ${a.length} != ${d.in}`);
        const o = [].concat(d.run(a));
        if (d.out !== undefined && o.length !== d.out) throw new Error(`${file}.${name}: output arity ${o.length} != ${d.out}`);
        rows.push(N([...a, ...o.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x))]));
      }
      ops[name] = { in: d.in, out: rows[0].length - d.in, rows };
    }
    return ops;
  }

  const MU = T.MathUtils;
  const utils = table('utils', {
    clamp: { in: 3, gen: () => [sc(), -1, 1], run: (a) => MU.clamp(a[0], a[1], a[2]), edge: [[NaN, 0, 1], [-0, 0, 1], [0, -0, 1], [5, 1, -1]] },
    euclideanModulo: { in: 2, gen: () => [sc(), [1, 360, Math.PI * 2, -3][Math.floor(R() * 4)]], run: (a) => MU.euclideanModulo(a[0], a[1]), edge: [[-0, 1], [-1e-17, 1], [7, 0]] },
    mapLinear: { in: 5, gen: () => [sc(), sc(), sc(), sc(), sc()], run: (a) => MU.mapLinear(...a) },
    inverseLerp: { in: 3, gen: () => [sc(), sc(), sc()], run: (a) => MU.inverseLerp(...a), edge: [[2, 2, 5], [NaN, NaN, 1]] },
    lerp: { in: 3, gen: () => [sc(), sc(), rnd(-0.5, 1.5)], run: (a) => MU.lerp(...a) },
    damp: { in: 4, gen: () => [sc(), sc(), rnd(0, 20), rnd(0, 0.1)], run: (a) => MU.damp(...a) },
    pingpong: { in: 2, gen: () => [sc(), rnd(0.5, 4)], run: (a) => MU.pingpong(a[0], a[1]) },
    smoothstep: { in: 3, gen: () => [rnd(-1, 2), 0.1, 0.9], run: (a) => MU.smoothstep(...a), edge: [[0.1, 0.1, 0.9], [0.9, 0.1, 0.9], [NaN, 0, 1]] },
    smootherstep: { in: 3, gen: () => [rnd(-1, 2), 0.1, 0.9], run: (a) => MU.smootherstep(...a) },
    degToRad: { in: 1, gen: () => [rnd(-720, 720)], run: (a) => MU.degToRad(a[0]), edge: [[90], [180], [-0]] },
    radToDeg: { in: 1, gen: () => [rnd(-7, 7)], run: (a) => MU.radToDeg(a[0]), edge: [[Math.PI], [Math.PI / 2]] },
    isPowerOfTwo: { in: 1, gen: () => [2 ** Math.floor(rnd(0, 31)) + (R() < 0.3 ? 1 : 0)], run: (a) => MU.isPowerOfTwo(a[0]), edge: [[0], [1], [2147483648], [-2147483648], [3]] },
    ceilPowerOfTwo: { in: 1, gen: () => [rnd(1, 5000)], run: (a) => MU.ceilPowerOfTwo(a[0]), edge: [[1], [1024], [1025]] },
    floorPowerOfTwo: { in: 1, gen: () => [rnd(1, 5000)], run: (a) => MU.floorPowerOfTwo(a[0]), edge: [[1], [1024], [1023]] },
  });
  out('math', 'three_utils', { files: ['rescue/vendor/three/three.core.min.js (r185) MathUtils'], tolerance: BITWISE, data: { revision: T.REVISION, ops: utils } });

  const vector = table('vector', {
    'v2.add': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => v2o(V2(a).add(V2(a, 2))) },
    'v2.sub': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => v2o(V2(a).sub(V2(a, 2))) },
    'v2.multiplyScalar': { in: 3, gen: () => [...v2(), sc()], run: (a) => v2o(V2(a).multiplyScalar(a[2])) },
    'v2.divideScalar': { in: 3, gen: () => [...v2(), sc()], run: (a) => v2o(V2(a).divideScalar(a[2])), edge: [[1, 2, 0], [1, 2, 3]] },
    'v2.normalize': { in: 2, gen: v2, run: (a) => v2o(V2(a).normalize()), edge: [[0, 0], [-0, 0], [3, 4], [1e-200, 1e-200]] },
    'v2.length': { in: 2, gen: v2, run: (a) => V2(a).length() },
    'v2.lengthSq': { in: 2, gen: v2, run: (a) => V2(a).lengthSq() },
    'v2.manhattanLength': { in: 2, gen: v2, run: (a) => V2(a).manhattanLength() },
    'v2.dot': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => V2(a).dot(V2(a, 2)) },
    'v2.cross': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => V2(a).cross(V2(a, 2)) },
    'v2.angle': { in: 2, gen: v2, run: (a) => V2(a).angle(), edge: [[0, 0], [1, 0], [-1, -0], [0, -1]] },
    'v2.angleTo': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => V2(a).angleTo(V2(a, 2)), edge: [[0, 0, 1, 1], [1, 0, -1, 0]] },
    'v2.distanceTo': { in: 4, gen: () => [...v2(), ...v2()], run: (a) => V2(a).distanceTo(V2(a, 2)) },
    'v2.lerp': { in: 5, gen: () => [...v2(), ...v2(), rnd(0, 1)], run: (a) => v2o(V2(a).lerp(V2(a, 2), a[4])) },
    'v2.lerpVectors': { in: 5, gen: () => [...v2(), ...v2(), rnd(0, 1)], run: (a) => v2o(new T.Vector2().lerpVectors(V2(a), V2(a, 2), a[4])) },
    'v2.rotateAround': { in: 5, gen: () => [...v2(), ...v2(), ang()], run: (a) => v2o(V2(a).rotateAround(V2(a, 2), a[4])) },
    'v2.clampLength': { in: 4, gen: () => [...v2(), 0.5, 3], run: (a) => v2o(V2(a).clampLength(a[2], a[3])), edge: [[0, 0, 1, 2]] },
    'v2.setLength': { in: 3, gen: () => [...v2(), sc()], run: (a) => v2o(V2(a).setLength(a[2])) },
    'v2.applyMatrix3': { in: 11, gen: () => [...v2(), ...m3()], run: (a) => v2o(V2(a).applyMatrix3(M3(a, 2))) },
    'v2.round': { in: 2, gen: () => [Math.round(sc()) + 0.5, sc()], run: (a) => v2o(V2(a).round()) },
    'v2.floor': { in: 2, gen: v2, run: (a) => v2o(V2(a).floor()) },
    'v2.roundToZero': { in: 2, gen: v2, run: (a) => v2o(V2(a).roundToZero()) },
    'v3.add': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).add(V3(a, 3))) },
    'v3.addScalar': { in: 4, gen: () => [...v3(), sc()], run: (a) => v3o(V3(a).addScalar(a[3])) },
    'v3.addScaledVector': { in: 7, gen: () => [...v3(), ...v3(), sc()], run: (a) => v3o(V3(a).addScaledVector(V3(a, 3), a[6])) },
    'v3.sub': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).sub(V3(a, 3))) },
    'v3.multiply': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).multiply(V3(a, 3))) },
    'v3.multiplyScalar': { in: 4, gen: () => [...v3(), sc()], run: (a) => v3o(V3(a).multiplyScalar(a[3])) },
    'v3.divide': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).divide(V3(a, 3))) },
    'v3.divideScalar': { in: 4, gen: () => [...v3(), sc()], run: (a) => v3o(V3(a).divideScalar(a[3])), edge: [[1, -2, 3, 0], [1, 2, 3, 3]] },
    'v3.min': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).min(V3(a, 3))), edge: [[0, -0, NaN, -0, 0, 1]] },
    'v3.max': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).max(V3(a, 3))), edge: [[0, -0, NaN, -0, 0, 1]] },
    'v3.clamp': { in: 9, gen: () => [...v3(), -1, -2, -3, 1, 2, 3], run: (a) => v3o(V3(a).clamp(V3(a, 3), V3(a, 6))) },
    'v3.clampScalar': { in: 5, gen: () => [...v3(), -2, 2], run: (a) => v3o(V3(a).clampScalar(a[3], a[4])) },
    'v3.clampLength': { in: 5, gen: () => [...v3(), 1, 4], run: (a) => v3o(V3(a).clampLength(a[3], a[4])), edge: [[0, 0, 0, 1, 2]] },
    'v3.floor': { in: 3, gen: v3, run: (a) => v3o(V3(a).floor()) },
    'v3.ceil': { in: 3, gen: v3, run: (a) => v3o(V3(a).ceil()), edge: [[-0.5, 0.5, -0]] },
    'v3.round': { in: 3, gen: () => [Math.round(sc()) - 0.5, sc(), -0.5], run: (a) => v3o(V3(a).round()) },
    'v3.roundToZero': { in: 3, gen: v3, run: (a) => v3o(V3(a).roundToZero()) },
    'v3.negate': { in: 3, gen: v3, run: (a) => v3o(V3(a).negate()), edge: [[0, -0, 1]] },
    'v3.dot': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => V3(a).dot(V3(a, 3)) },
    'v3.length': { in: 3, gen: v3, run: (a) => V3(a).length() },
    'v3.lengthSq': { in: 3, gen: v3, run: (a) => V3(a).lengthSq() },
    'v3.manhattanLength': { in: 3, gen: v3, run: (a) => V3(a).manhattanLength() },
    'v3.normalize': { in: 3, gen: v3, run: (a) => v3o(V3(a).normalize()), edge: [[0, 0, 0], [-0, 0, -0], [0, 3, 4], [1e-300, 0, 0], [NaN, 1, 1]] },
    'v3.setLength': { in: 4, gen: () => [...v3(), sc()], run: (a) => v3o(V3(a).setLength(a[3])) },
    'v3.lerp': { in: 7, gen: () => [...v3(), ...v3(), rnd(-0.2, 1.2)], run: (a) => v3o(V3(a).lerp(V3(a, 3), a[6])) },
    'v3.lerpVectors': { in: 7, gen: () => [...v3(), ...v3(), rnd(0, 1)], run: (a) => v3o(new T.Vector3().lerpVectors(V3(a), V3(a, 3), a[6])) },
    'v3.cross': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).cross(V3(a, 3))) },
    'v3.crossVectors': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(new T.Vector3().crossVectors(V3(a), V3(a, 3))) },
    'v3.projectOnVector': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => v3o(V3(a).projectOnVector(V3(a, 3))), edge: [[1, 2, 3, 0, 0, 0]] },
    'v3.projectOnPlane': { in: 6, gen: () => [...v3(), ...unit3()], run: (a) => v3o(V3(a).projectOnPlane(V3(a, 3))) },
    'v3.reflect': { in: 6, gen: () => [...v3(), ...unit3()], run: (a) => v3o(V3(a).reflect(V3(a, 3))) },
    'v3.angleTo': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => V3(a).angleTo(V3(a, 3)), edge: [[0, 0, 0, 1, 2, 3], [1, 0, 0, -2, 0, 0], [1, 1, 0, 2, 2, 0]] },
    'v3.distanceTo': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => V3(a).distanceTo(V3(a, 3)) },
    'v3.distanceToSquared': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => V3(a).distanceToSquared(V3(a, 3)) },
    'v3.manhattanDistanceTo': { in: 6, gen: () => [...v3(), ...v3()], run: (a) => V3(a).manhattanDistanceTo(V3(a, 3)) },
    'v3.equals': { in: 6, gen: () => { const a = v3(); return R() < 0.5 ? [...a, ...a] : [...a, ...v3()]; }, run: (a) => V3(a).equals(V3(a, 3)), edge: [[0, 0, 0, -0, -0, -0], [NaN, 0, 0, NaN, 0, 0]] },
    'v3.applyQuaternion': { in: 7, gen: () => [...v3(), ...quat()], run: (a) => v3o(V3(a).applyQuaternion(Q(a, 3))) },
    'v3.applyAxisAngle': { in: 7, gen: () => [...v3(), ...unit3(), ang()], run: (a) => v3o(V3(a).applyAxisAngle(V3(a, 3), a[6])) },
    'v3.applyEuler': { in: 7, gen: () => [...v3(), ang(), ang(), ang(), ord()], run: (a) => v3o(V3(a).applyEuler(E(a, 3))) },
    'v3.applyMatrix3': { in: 12, gen: () => [...v3(), ...m3()], run: (a) => v3o(V3(a).applyMatrix3(M3(a, 3))) },
    'v3.applyNormalMatrix': { in: 12, gen: () => [...v3(), ...m3()], run: (a) => v3o(V3(a).applyNormalMatrix(M3(a, 3))) },
    'v3.applyMatrix4': { in: 19, gen: () => [...v3(), ...m4()], run: (a) => v3o(V3(a).applyMatrix4(M4(a, 3))) },
    'v3.transformDirection': { in: 19, gen: () => [...v3(), ...m4()], run: (a) => v3o(V3(a).transformDirection(M4(a, 3))) },
    'v3.setFromSphericalCoords': { in: 3, gen: () => [rnd(0, 100), rnd(0, Math.PI), ang()], run: (a) => v3o(new T.Vector3().setFromSphericalCoords(a[0], a[1], a[2])) },
    'v3.setFromCylindricalCoords': { in: 3, gen: () => [rnd(0, 100), ang(), sc()], run: (a) => v3o(new T.Vector3().setFromCylindricalCoords(a[0], a[1], a[2])) },
    'v3.setFromMatrixScale': { in: 16, gen: m4, run: (a) => v3o(new T.Vector3().setFromMatrixScale(M4(a))) },
    'v3.setFromMatrixPosition': { in: 16, gen: m4, run: (a) => v3o(new T.Vector3().setFromMatrixPosition(M4(a))) },
    'v3.setFromMatrixColumn': { in: 17, gen: () => [...m4(), Math.floor(R() * 4)], run: (a) => v3o(new T.Vector3().setFromMatrixColumn(M4(a), a[16])) },
    'v4.applyMatrix4': { in: 20, gen: () => [...v4(), ...m4()], run: (a) => v4o(V4(a).applyMatrix4(M4(a, 4))) },
    'v4.normalize': { in: 4, gen: v4, run: (a) => v4o(V4(a).normalize()), edge: [[0, 0, 0, 0]] },
    'v4.length': { in: 4, gen: v4, run: (a) => V4(a).length() },
    'v4.dot': { in: 8, gen: () => [...v4(), ...v4()], run: (a) => V4(a).dot(V4(a, 4)) },
    'v4.lerp': { in: 9, gen: () => [...v4(), ...v4(), rnd(0, 1)], run: (a) => v4o(V4(a).lerp(V4(a, 4), a[8])) },
    'v4.divideScalar': { in: 5, gen: () => [...v4(), sc()], run: (a) => v4o(V4(a).divideScalar(a[4])) },
    'v4.addScaledVector': { in: 9, gen: () => [...v4(), ...v4(), sc()], run: (a) => v4o(V4(a).addScaledVector(V4(a, 4), a[8])) },
  });
  out('math', 'three_vector', { files: ['rescue/vendor/three/three.core.min.js (r185) Vector2/3/4'], tolerance: BITWISE, data: { revision: T.REVISION, ops: vector } });

  const quaternion = table('quaternion', {
    setFromEuler: { in: 4, gen: () => [ang(), ang(), ang(), ord()], run: (a) => qo(new T.Quaternion().setFromEuler(E(a))) },
    setFromAxisAngle: { in: 4, gen: () => [...unit3(), ang() * 2], run: (a) => qo(new T.Quaternion().setFromAxisAngle(V3(a), a[3])) },
    setFromRotationMatrix: { in: 16, gen: rot, run: (a) => qo(new T.Quaternion().setFromRotationMatrix(M4(a))),
      edge: [[...new T.Matrix4().makeRotationX(Math.PI).elements], [...new T.Matrix4().makeRotationY(Math.PI).elements], [...new T.Matrix4().makeRotationZ(Math.PI).elements], [...new T.Matrix4().elements]] },
    setFromUnitVectors: { in: 6, gen: () => { const a = unit3(); return R() < 0.15 ? [...a, -a[0], -a[1], -a[2]] : [...a, ...unit3()]; }, run: (a) => qo(new T.Quaternion().setFromUnitVectors(V3(a), V3(a, 3))),
      edge: [[1, 0, 0, -1, 0, 0], [0, 0, 1, 0, 0, -1], [0, 1, 0, 0, -1, 0], [0, 1, 0, 0, 1, 0]] },
    angleTo: { in: 8, gen: () => [...quat(), ...quat()], run: (a) => Q(a).angleTo(Q(a, 4)) },
    rotateTowards: { in: 9, gen: () => [...quat(), ...quat(), rnd(0, 1)], run: (a) => qo(Q(a).rotateTowards(Q(a, 4), a[8])), edge: [[0, 0, 0, 1, 0, 0, 0, 1, 0.5]] },
    invert: { in: 4, gen: quat, run: (a) => qo(Q(a).invert()), edge: [[0, -0, 0, 1]] },
    dot: { in: 8, gen: () => [...quat(), ...quat()], run: (a) => Q(a).dot(Q(a, 4)) },
    length: { in: 4, gen: v4, run: (a) => Q(a).length() },
    lengthSq: { in: 4, gen: v4, run: (a) => Q(a).lengthSq() },
    normalize: { in: 4, gen: v4, run: (a) => qo(Q(a).normalize()), edge: [[0, 0, 0, 0]] },
    multiply: { in: 8, gen: () => [...quat(), ...quat()], run: (a) => qo(Q(a).multiply(Q(a, 4))) },
    premultiply: { in: 8, gen: () => [...quat(), ...quat()], run: (a) => qo(Q(a).premultiply(Q(a, 4))) },
    slerp: { in: 9, gen: () => { const a = quat(); const k = R(); const b = k < 0.2 ? a.map((x) => x + rnd(-1e-3, 1e-3)) : k < 0.4 ? a.map((x) => -x + rnd(-1e-3, 1e-3)) : quat(); return [...a, ...b, rnd(-0.2, 1.2)]; },
      run: (a) => qo(Q(a).slerp(Q(a, 4), a[8])), edge: [[0, 0, 0, 1, 0, 0, 0, 1, 0.3], [0, 0, 0, 1, 0, 0, 1, 0, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1]] },
    slerpQuaternions: { in: 9, gen: () => [...quat(), ...quat(), rnd(0, 1)], run: (a) => qo(new T.Quaternion().slerpQuaternions(Q(a), Q(a, 4), a[8])) },
  });
  out('math', 'three_quaternion', { files: ['rescue/vendor/three/three.core.min.js (r185) Quaternion'], tolerance: BITWISE, data: { revision: T.REVISION, orders: ORDERS, ops: quaternion } });

  const eo = (e) => [e.x, e.y, e.z, ORDERS.indexOf(e.order)];
  const gimbal = () => { const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(ang(), Math.PI / 2 * (R() < 0.5 ? 1 : -1), ang(), 'XYZ')); return [...m.elements]; };
  const euler = table('euler', {
    setFromRotationMatrix: { in: 17, gen: () => [...(R() < 0.15 ? gimbal() : rot()), ord()], run: (a) => eo(new T.Euler().setFromRotationMatrix(M4(a), ORDERS[a[16]])) },
    setFromQuaternion: { in: 5, gen: () => [...quat(), ord()], run: (a) => eo(new T.Euler().setFromQuaternion(Q(a), ORDERS[a[4]])),
      edge: [[Math.SQRT1_2, 0, 0, Math.SQRT1_2, 1], [0, Math.SQRT1_2, 0, Math.SQRT1_2, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2, 4], [0.5, 0.5, 0.5, 0.5, 2]] },
    reorder: { in: 5, gen: () => [ang(), ang(), ang(), ord(), ord()], run: (a) => eo(E(a).reorder(ORDERS[a[4]])) },
    makeRotationFromEuler: { in: 4, gen: () => [ang(), ang(), ang(), ord()], run: (a) => [...new T.Matrix4().makeRotationFromEuler(E(a)).elements] },
  });
  out('math', 'three_euler', { files: ['rescue/vendor/three/three.core.min.js (r185) Euler, Matrix4.makeRotationFromEuler'], tolerance: BITWISE, data: { revision: T.REVISION, orders: ORDERS, ops: euler } });

  const mo = (m) => [...m.elements];
  const singular = () => { const a = m4(); for (let k = 0; k < 4; k++) a[k * 4 + 2] = 2 * a[k * 4 + 1]; return a; };
  const matrix = table('matrix', {
    'm4.multiply': { in: 32, gen: () => [...m4(), ...m4()], run: (a) => mo(M4(a).multiply(M4(a, 16))) },
    'm4.premultiply': { in: 32, gen: () => [...m4(), ...m4()], run: (a) => mo(M4(a).premultiply(M4(a, 16))) },
    'm4.multiplyScalar': { in: 17, gen: () => [...m4(), sc()], run: (a) => mo(M4(a).multiplyScalar(a[16])) },
    'm4.determinant': { in: 16, gen: m4, run: (a) => M4(a).determinant(), edge: [singular()] },
    'm4.determinantAffine': { in: 16, gen: m4, run: (a) => M4(a).determinantAffine() },
    'm4.transpose': { in: 16, gen: m4, run: (a) => mo(M4(a).transpose()) },
    'm4.invert': { in: 16, gen: () => (R() < 0.1 ? singular() : m4()), run: (a) => mo(M4(a).invert()), edge: [singular(), new Array(16).fill(0)] },
    'm4.scale': { in: 19, gen: () => [...m4(), ...v3()], run: (a) => mo(M4(a).scale(V3(a, 16))) },
    'm4.getMaxScaleOnAxis': { in: 16, gen: m4, run: (a) => M4(a).getMaxScaleOnAxis() },
    'm4.makeTranslation': { in: 3, gen: v3, run: (a) => mo(new T.Matrix4().makeTranslation(a[0], a[1], a[2])) },
    'm4.makeRotationX': { in: 1, gen: () => [ang()], run: (a) => mo(new T.Matrix4().makeRotationX(a[0])) },
    'm4.makeRotationY': { in: 1, gen: () => [ang()], run: (a) => mo(new T.Matrix4().makeRotationY(a[0])) },
    'm4.makeRotationZ': { in: 1, gen: () => [ang()], run: (a) => mo(new T.Matrix4().makeRotationZ(a[0])) },
    'm4.makeRotationAxis': { in: 4, gen: () => [...unit3(), ang()], run: (a) => mo(new T.Matrix4().makeRotationAxis(V3(a), a[3])) },
    'm4.makeScale': { in: 3, gen: v3, run: (a) => mo(new T.Matrix4().makeScale(a[0], a[1], a[2])) },
    'm4.makeShear': { in: 6, gen: () => [sc(), sc(), sc(), sc(), sc(), sc()], run: (a) => mo(new T.Matrix4().makeShear(...a)) },
    'm4.makeBasis': { in: 9, gen: () => [...unit3(), ...unit3(), ...unit3()], run: (a) => mo(new T.Matrix4().makeBasis(V3(a), V3(a, 3), V3(a, 6))) },
    'm4.extractBasis': { in: 16, gen: m4, run: (a) => { const x = new T.Vector3(), y = new T.Vector3(), z = new T.Vector3(); M4(a).extractBasis(x, y, z); return [...v3o(x), ...v3o(y), ...v3o(z)]; }, edge: [singular()] },
    'm4.extractRotation': { in: 16, gen: trs, run: (a) => mo(new T.Matrix4().extractRotation(M4(a))), edge: [singular()] },
    'm4.setPosition': { in: 19, gen: () => [...m4(), ...v3()], run: (a) => mo(M4(a).setPosition(a[16], a[17], a[18])) },
    'm4.copyPosition': { in: 32, gen: () => [...m4(), ...m4()], run: (a) => mo(M4(a).copyPosition(M4(a, 16))) },
    'm4.setFromMatrix3': { in: 9, gen: m3, run: (a) => mo(new T.Matrix4().setFromMatrix3(M3(a))) },
    'm4.compose': { in: 10, gen: () => [...v3(), ...quat(), ...v3()], run: (a) => mo(new T.Matrix4().compose(V3(a), Q(a, 3), V3(a, 7))) },
    'm4.decompose': { in: 16, gen: () => (R() < 0.8 ? trs() : m4()), run: (a) => { const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(); M4(a).decompose(p, q, s); return [...v3o(p), ...qo(q), ...v3o(s)]; }, edge: [singular()] },
    'm4.makeRotationFromQuaternion': { in: 4, gen: quat, run: (a) => mo(new T.Matrix4().makeRotationFromQuaternion(Q(a))) },
    'm4.lookAt': { in: 25, gen: () => { const base = m4(); const k = R(); const eye = v3(); const target = k < 0.1 ? eye.slice() : v3(); const up = k > 0.85 ? (() => { const d = new T.Vector3(...eye).sub(new T.Vector3(...target)).normalize(); return [d.x, d.y, d.z]; })() : (R() < 0.5 ? [0, 1, 0] : unit3()); return [...base, ...eye, ...target, ...up]; },
      run: (a) => mo(M4(a).lookAt(V3(a, 16), V3(a, 19), V3(a, 22))),
      edge: [[...new T.Matrix4().elements, 0, 10, 0, 0, 0, 0, 0, 1, 0], [...new T.Matrix4().elements, 0, 0, 5, 0, 0, 0, 0, 0, 1], [...new T.Matrix4().elements, 0, 220, 60, 0, 0, 0, 0, 1, 0]] },
    'm4.makePerspective': { in: 8, gen: () => { const near = rnd(0.1, 5), far = near + rnd(10, 2000), t = rnd(0.1, 3), r = t * rnd(0.5, 2.5); return [-r, r, t, -t, near, far, Math.floor(R() * 2), R() < 0.2 ? 1 : 0]; },
      run: (a) => mo(new T.Matrix4().makePerspective(a[0], a[1], a[2], a[3], a[4], a[5], a[6] ? T.WebGPUCoordinateSystem : T.WebGLCoordinateSystem, !!a[7])),
      edge: [[-1.6, 1.4, 0.72, -0.75, 2, 1200, 0, 0]] },
    'm4.makeOrthographic': { in: 8, gen: () => { const near = rnd(0, 5), far = near + rnd(10, 2000), t = rnd(1, 300), r = t * rnd(0.5, 2.5); return [-r, r, t, -t, near, far, Math.floor(R() * 2), R() < 0.2 ? 1 : 0]; },
      run: (a) => mo(new T.Matrix4().makeOrthographic(a[0], a[1], a[2], a[3], a[4], a[5], a[6] ? T.WebGPUCoordinateSystem : T.WebGLCoordinateSystem, !!a[7])) },
    'm3.multiply': { in: 18, gen: () => [...m3(), ...m3()], run: (a) => mo(M3(a).multiply(M3(a, 9))) },
    'm3.premultiply': { in: 18, gen: () => [...m3(), ...m3()], run: (a) => mo(M3(a).premultiply(M3(a, 9))) },
    'm3.determinant': { in: 9, gen: m3, run: (a) => M3(a).determinant() },
    'm3.invert': { in: 9, gen: m3, run: (a) => mo(M3(a).invert()), edge: [[1, 2, 3, 2, 4, 6, 7, 8, 9]] },
    'm3.transpose': { in: 9, gen: m3, run: (a) => mo(M3(a).transpose()) },
    'm3.getNormalMatrix': { in: 16, gen: m4, run: (a) => mo(new T.Matrix3().getNormalMatrix(M4(a))) },
    'm3.setFromMatrix4': { in: 16, gen: m4, run: (a) => mo(new T.Matrix3().setFromMatrix4(M4(a))) },
    'm3.setUvTransform': { in: 7, gen: () => [sc(), sc(), rnd(0.1, 4), rnd(0.1, 4), ang(), rnd(0, 1), rnd(0, 1)], run: (a) => mo(new T.Matrix3().setUvTransform(...a)) },
    'm3.makeRotation': { in: 1, gen: () => [ang()], run: (a) => mo(new T.Matrix3().makeRotation(a[0])) },
    'm3.multiplyScalar': { in: 10, gen: () => [...m3(), sc()], run: (a) => mo(M3(a).multiplyScalar(a[9])) },
  });
  out('math', 'three_matrix', { files: ['rescue/vendor/three/three.core.min.js (r185) Matrix3, Matrix4'], tolerance: BITWISE, data: { revision: T.REVISION, ops: matrix } });

  const rgb = () => [rnd(0, 1), rnd(0, 1), rnd(0, 1)];
  const hdr = () => [rnd(-0.2, 3), rnd(0, 1.2), rnd(0, 1)];
  const hexIn = () => [Math.floor(rnd(0, 0x1000000))];
  const color = table('color', {
    setHex: { in: 2, gen: () => [...hexIn(), Math.floor(R() * 3)], run: (a) => co(new T.Color().setHex(a[0], SPACES[a[1]])),
      edge: [[0xffffff, 1], [0, 1], [0x0b1a24, 1], [0x1ffffff, 1], [-1, 1], [12345.9, 1], [NaN, 1], [0x80ff00, 2]] },
    setRGB: { in: 4, gen: () => [...hdr(), Math.floor(R() * 3)], run: (a) => co(new T.Color().setRGB(a[0], a[1], a[2], SPACES[a[3]])) },
    setHSL: { in: 4, gen: () => [rnd(-1.5, 2.5), rnd(-0.2, 1.2), rnd(-0.2, 1.2), Math.floor(R() * 3)], run: (a) => co(new T.Color().setHSL(a[0], a[1], a[2], SPACES[a[3]])),
      edge: [[0, 0, 0.5, 2], [1 / 6, 1, 0.5, 2], [0.5, 1, 0.25, 1], [2 / 3, 0.5, 0.75, 2], [-0, 0, 0, 2]] },
    getHex: { in: 4, gen: () => [...hdr(), Math.floor(R() * 3)], run: (a) => C(a).getHex(SPACES[a[3]]), edge: [[NaN, 0, 0, 1], [1, 1, 1, 1], [0.5, 0.5, 0.5, 2]] },
    getHSL: { in: 4, gen: () => [...rgb(), Math.floor(R() * 3)], run: (a) => { const t = {}; C(a).getHSL(t, SPACES[a[3]]); return [t.h, t.s, t.l]; },
      edge: [[1, 0, 0, 2], [0, 1, 0, 2], [0, 0, 1, 2], [1, 1, 0, 2], [0.5, 0.5, 0.5, 2], [1, 0, 1, 2], [0.2, 0.2, 0.1, 2]] },
    getRGB: { in: 4, gen: () => [...hdr(), Math.floor(R() * 3)], run: (a) => { const t = new T.Color(); C(a).getRGB(t, SPACES[a[3]]); return co(t); } },
    offsetHSL: { in: 6, gen: () => [...rgb(), rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)], run: (a) => co(C(a).offsetHSL(a[3], a[4], a[5])) },
    add: { in: 6, gen: () => [...hdr(), ...hdr()], run: (a) => co(C(a).add(C(a, 3))) },
    addScalar: { in: 4, gen: () => [...hdr(), rnd(-1, 1)], run: (a) => co(C(a).addScalar(a[3])) },
    sub: { in: 6, gen: () => [...hdr(), ...hdr()], run: (a) => co(C(a).sub(C(a, 3))) },
    multiply: { in: 6, gen: () => [...hdr(), ...hdr()], run: (a) => co(C(a).multiply(C(a, 3))) },
    multiplyScalar: { in: 4, gen: () => [...hdr(), rnd(0, 4)], run: (a) => co(C(a).multiplyScalar(a[3])) },
    lerp: { in: 7, gen: () => [...hdr(), ...hdr(), rnd(0, 1)], run: (a) => co(C(a).lerp(C(a, 3), a[6])) },
    lerpColors: { in: 7, gen: () => [...hdr(), ...hdr(), rnd(0, 1)], run: (a) => co(new T.Color().lerpColors(C(a), C(a, 3), a[6])) },
    lerpHSL: { in: 7, gen: () => [...rgb(), ...rgb(), rnd(0, 1)], run: (a) => co(C(a).lerpHSL(C(a, 3), a[6])) },
    convertSRGBToLinear: { in: 3, gen: hdr, run: (a) => co(C(a).convertSRGBToLinear()), edge: [[0.04045, 0.04044999999999999, 0], [1, 0.5, -0.1]] },
    convertLinearToSRGB: { in: 3, gen: hdr, run: (a) => co(C(a).convertLinearToSRGB()), edge: [[0.0031308, 0.0031307999999999996, 0], [1, 0.5, -0.1]] },
    applyMatrix3: { in: 12, gen: () => [...rgb(), ...m3()], run: (a) => co(C(a).applyMatrix3(M3(a, 3))) },
  });
  const styles = ['#ff8800', '#FF8800', '#f80', '#0b1a24', '#12345', '#1234567', '#', 'red', 'Red', 'SeaGreen', 'rebeccapurple', 'nosuchcolor',
    'rgb(255, 128, 0)', 'rgb(255,128,0)', 'rgba(10, 20, 30, 0.5)', 'rgb(300, 0, 0)', 'rgb( 1 , 2 , 3 )', 'rgb(50%, 25%, 100%)',
    'rgb(150%, 0%, 0%)', 'rgba(50%,50%,50%,.25)', 'rgb(1.5, 2, 3)', 'rgb(1, 2)', 'hsl(120, 50%, 50%)', 'hsl(0.5, 100%, 25%)',
    'hsla(240,100%,50%,0.3)', 'hsl(.5, 10.5%, 99%)', 'hsl(120, 50, 50)', 'cmyk(1,2,3)', 'rgb(1,2,3) trailing', 'RGB(1,2,3)', ''];
  const styleRows = styles.map((s) => { const c = new T.Color(0.25, 0.5, 0.75); c.setStyle(s); return [s, ...N(co(c))]; });
  const hexStrRows = [];
  for (let i = 0; i < 40; i++) { const a = [...hdr(), Math.floor(R() * 3)]; hexStrRows.push([...N(a), C(a).getHexString(SPACES[a[3]])]); }
  hexStrRows.push([...N([NaN, 0, 0, 1]), C([NaN, 0, 0]).getHexString()]);
  const styleOutRows = [];
  for (let i = 0; i < 24; i++) { const a = [...hdr(), Math.floor(R() * 3)]; styleOutRows.push([...N(a), C(a).getStyle(SPACES[a[3]] || 'srgb')]); }
  out('math', 'three_color', {
    files: ['rescue/vendor/three/three.core.min.js (r185) Color, ColorManagement'], tolerance: BITWISE,
    data: {
      revision: T.REVISION, spaces: SPACES, ops: color,
      setStyle: { note: 'start colour (0.25, 0.5, 0.75); setStyle(style) → r, g, b (unparsable styles leave it unchanged)', rows: styleRows },
      getHexString: { note: '[r, g, b, space index, string]', rows: hexStrRows },
      getStyle: { note: '[r, g, b, space index (0 → srgb), string]', rows: styleOutRows },
      names: Object.keys(T.Color.NAMES).length,
    },
  });
}

// ================================================================================================ events
// Scripts replayed against the real core/events.js EventBus. A script registers named handlers
// (stable function identity per handler id, like a bound method in the game) and emits events;
// every handler call is logged as [handlerId, eventName, tag]. Handler actions (run after logging,
// optionally only for one tag) exercise removal / addition during emit, once, clear and re-entrancy.
//   step / action: ['on', name, hid, offId?] | ['once', name, hid, offId?] | ['off', offId] |
//                  ['emit', name, tag] | ['clear'] | ['mark', label]
//   offId defaults to `${hid}|${name}`; handler actions are {when?: tag, do: action}.
async function events() {
  const { EventBus } = await gameImport('core/events.js');
  function run(script) {
    const bus = new EventBus();
    const log = [];
    const offs = {};
    const fns = {};
    const handler = (hid) => (fns[hid] ||= (p) => {
      log.push([hid, p.name, p.tag]);
      for (const a of script.handlers?.[hid] || []) if (a.when === undefined || a.when === p.tag) exec(a.do);
    });
    function exec(a) {
      switch (a[0]) {
        case 'on': offs[a[3] || `${a[2]}|${a[1]}`] = bus.on(a[1], handler(a[2])); break;
        case 'once': offs[a[3] || `${a[2]}|${a[1]}`] = bus.once(a[1], handler(a[2])); break;
        case 'off': offs[a[1]]?.(); break;
        case 'emit': bus.emit(a[1], { name: a[1], tag: a[2] }); break;
        case 'clear': bus.clear(); break;
        case 'mark': log.push(['mark', a[1]]); break;
        default: throw new Error('bad action ' + a[0]);
      }
    }
    for (const s of script.steps) exec(s);
    return log;
  }
  const C = 'ui:click', H = 'ui:hover', K = 'ui:back';
  const scripts = [
    { id: 'registration-order', steps: [['on', C, 'A'], ['on', C, 'B'], ['on', C, 'C'], ['on', H, 'B'], ['emit', C, 1], ['emit', H, 2], ['emit', K, 3]] },
    { id: 'same-listener-twice-is-noop', steps: [['on', C, 'A'], ['on', C, 'B'], ['on', C, 'A'], ['emit', C, 1]] },
    { id: 'off-then-on-moves-to-end', steps: [['on', C, 'A'], ['on', C, 'B'], ['off', `A|${C}`], ['on', C, 'A'], ['emit', C, 1], ['off', 'nobody'], ['off', `B|${C}`], ['off', `B|${C}`], ['emit', C, 2]] },
    { id: 'stale-off-still-removes', steps: [['on', C, 'A', 'a1'], ['on', C, 'A', 'a2'], ['on', C, 'B'], ['off', 'a1'], ['emit', C, 1], ['on', C, 'A', 'a3'], ['off', 'a1'], ['emit', C, 2], ['on', C, 'A', 'a4'], ['emit', C, 3]] },
    { id: 'removed-during-emit-still-runs', handlers: { A: [{ when: 1, do: ['off', `B|${C}`] }] }, steps: [['on', C, 'A'], ['on', C, 'B'], ['on', C, 'C'], ['emit', C, 1], ['mark', 'second'], ['emit', C, 2]] },
    { id: 'self-removal', handlers: { B: [{ do: ['off', `B|${C}`] }] }, steps: [['on', C, 'A'], ['on', C, 'B'], ['on', C, 'C'], ['emit', C, 1], ['emit', C, 2]] },
    { id: 'added-during-emit-runs-next-time', handlers: { A: [{ when: 1, do: ['on', C, 'D'] }, { when: 1, do: ['on', C, 'A'] }] }, steps: [['on', C, 'A'], ['on', C, 'B'], ['emit', C, 1], ['mark', 'second'], ['emit', C, 2]] },
    { id: 'once', steps: [['on', C, 'A'], ['once', C, 'B'], ['on', C, 'C'], ['emit', C, 1], ['emit', C, 2]] },
    { id: 'once-unsubscribes-before-call', handlers: { B: [{ when: 1, do: ['emit', C, 2] }] }, steps: [['on', C, 'A'], ['once', C, 'B'], ['on', C, 'C'], ['emit', C, 1], ['mark', 'after'], ['emit', C, 3]] },
    { id: 'once-twice-and-once-plus-on', steps: [['once', C, 'A'], ['once', C, 'A'], ['on', C, 'A'], ['emit', C, 1], ['emit', C, 2]] },
    { id: 'once-off-before-fire', steps: [['once', C, 'A', 'o1'], ['on', C, 'B'], ['off', 'o1'], ['emit', C, 1], ['off', 'o1']] },
    { id: 'reentrant-emit-completes-first', handlers: { A: [{ when: 1, do: ['emit', H, 10] }], X: [{ when: 10, do: ['emit', K, 20] }] },
      steps: [['on', C, 'A'], ['on', H, 'X'], ['on', H, 'Y'], ['on', K, 'Z'], ['on', C, 'B'], ['emit', C, 1]] },
    { id: 'recursive-same-event', handlers: { A: [{ when: 1, do: ['emit', C, 2] }, { when: 2, do: ['emit', C, 3] }] }, steps: [['on', C, 'A'], ['on', C, 'B'], ['emit', C, 1]] },
    { id: 'nested-off-of-outer-listener', handlers: { X: [{ do: ['off', `C|${C}`] }], A: [{ when: 1, do: ['emit', H, 5] }] },
      steps: [['on', C, 'A'], ['on', H, 'X'], ['on', C, 'B'], ['on', C, 'C'], ['emit', C, 1], ['mark', 'again'], ['emit', C, 2]] },
    { id: 'clear-during-emit', handlers: { A: [{ when: 1, do: ['clear'] }] }, steps: [['on', C, 'A', 'a1'], ['on', C, 'B'], ['on', H, 'H'], ['emit', C, 1], ['emit', C, 2], ['emit', H, 3], ['on', C, 'A'], ['off', 'a1'], ['emit', C, 4]] },
    { id: 'no-listeners', steps: [['emit', C, 1], ['on', H, 'A'], ['off', `A|${H}`], ['emit', H, 2], ['mark', 'end']] },
  ];
  out('core', 'events', {
    files: [relSrc('core/events.js')],
    tolerance: { class: 'exact', note: 'the handler-call log must be identical (order, handler, event, tag)' },
    data: {
      grammar: "step/action: ['on', name, hid, offId?] | ['once', name, hid, offId?] | ['off', offId] | ['emit', name, tag] | ['clear'] | ['mark', label]; offId defaults to `${hid}|${name}`; handlers[hid] = [{when?: tag, do: action}] run after the call is logged",
      log: '[hid, eventName, tag] per handler call, [\'mark\', label] for marks',
      scripts: scripts.map((s) => ({ ...s, log: run(s) })),
    },
  });
}

// ================================================================================================ loop
// main.js frame() is not importable (it lives inside boot()), so its source and the sources it
// closes over (RUN_WHEN_PAUSED, startWarmup, ctx.setMode, pixelRatio) are cut out of main.js with
// acorn and evaluated against recording stubs. Only the stubs are written here.
function acornParse(src) {
  const req = createRequire(import.meta.url);
  for (const c of ['acorn', '/opt/node-tools/node_modules/acorn', '/opt/node22/lib/node_modules/acorn']) {
    try { return req(c).parse(src, { ecmaVersion: 'latest', sourceType: 'module' }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new Error('acorn not found');
}
function findNode(ast, pred) {
  let found = null;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (pred(n)) { found = n; return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast);
  if (!found) throw new Error('main.js: node not found');
  return found;
}

async function loop() {
  const { EventBus } = await gameImport('core/events.js');
  const src = fs.readFileSync(path.join(SRC_DIR, 'main.js'), 'utf8');
  const ast = acornParse(src);
  const cut = (n) => src.slice(n.start, n.end);
  const decl = (name) => cut(findNode(ast, (n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === name)));
  const SYSTEMS_SRC = decl('SYSTEMS');
  const RWP_SRC = decl('RUN_WHEN_PAUSED');
  const START_SRC = decl('startWarmup');
  const PIXEL_SRC = decl('pixelRatio');
  const FRAME_SRC = cut(findNode(ast, (n) => n.type === 'FunctionDeclaration' && n.id?.name === 'frame'));
  const setModeNode = findNode(ast, (n) => n.type === 'Property' && n.key?.name === 'setMode');
  // method shorthand: the FunctionExpression's source is `(mode) { … }`
  const SETMODE_SRC = 'function setMode' + cut(setModeNode.value).replace(/^function\s*/, '');

  // Instantiate the cut-out code over a stub environment.
  const make = new Function('env', `
    const { ctx, look, scene, render, renderHidden, compileScene, renderer, camera, performance, requestAnimationFrame, console } = env;
    ${SYSTEMS_SRC}
    ${RWP_SRC}
    const order = SYSTEMS.map(([key]) => key);
    let last = env.start;
    let warm = 'due';
    const offscreen = true;
    ${START_SRC}
    const failed = new Set();
    ${FRAME_SRC}
    ${SETMODE_SRC}
    ctx.setMode = setMode;
    return { frame, order, getWarm: () => warm, setWarm: (w) => { warm = w; }, failed, RUN_WHEN_PAUSED };
  `);

  const flush = () => new Promise((r) => setTimeout(r, 0));
  async function run(script) {
    const log = [];
    const env = { now: script.start };
    let compileDone = null;
    const ctx = {
      mode: script.mode, timeScale: 1, events: new EventBus(),
      time: { t: 0, dt: 0, realT: 0, realDt: 0, frame: 0 },
      input: { poll: () => log.push(['poll']) },
    };
    ctx.events.on('game:mode', (p) => log.push(['game:mode', p.from, p.to]));
    const api = make({
      ctx, start: script.start,
      look: { setTime: (t) => log.push(['setTime', num(t)]) },
      scene: {}, renderer: {}, camera: {},
      render: (dt) => log.push(['render', num(dt)]),
      renderHidden: (_scene, fn) => { log.push(['renderHidden']); fn(); },
      compileScene: () => { log.push(['compile']); return new Promise((res, rej) => { compileDone = { res, rej }; }); },
      performance: { now: () => env.now },
      requestAnimationFrame: () => {},
      console: { error: (...a) => log.push(['error', String(a[0])]), warn: () => {} },
    });
    const throwing = new Set();
    for (const key of api.order) {
      if ((script.noUpdate || []).includes(key)) { ctx[key] = {}; continue; }
      ctx[key] = { update: (dt) => { log.push(['update', key, num(dt)]); if (throwing.has(key)) throw new Error(`${key} broke`); } };
    }
    const frames = [];
    for (const f of script.frames) {
      for (const a of f.before || []) {
        switch (a[0]) {
          case 'setMode': ctx.setMode(a[1]); break;
          case 'timeScale': ctx.timeScale = a[1]; break;
          case 'throw': throwing.add(a[1]); break;
          case 'warmupDue': api.setWarm('due'); break; // main.js: mission:setup / quality change
          case 'compileDone': if (compileDone) { a[1] ? compileDone.rej(new Error('x')) : compileDone.res(); compileDone = null; } await flush(); break;
          default: throw new Error('bad loop action ' + a[0]);
        }
      }
      const beforeLog = log.splice(0);
      env.now = f.now;
      api.frame();
      const during = log.splice(0);
      await flush(); // the browser runs microtasks between animation frames: startWarmup's compileScene call
      const after = log.splice(0);
      const t = ctx.time;
      frames.push({ now: f.now, before: f.before || [], beforeLog, log: during, after, time: N([t.t, t.dt, t.realT, t.realDt, t.frame]), warm: api.getWarm(), failed: [...api.failed] });
    }
    return { order: api.order, runWhenPaused: [...api.RUN_WHEN_PAUSED], frames };
  }

  const ms = (k) => 1000 / 60 * k;
  const scripts = [
    { id: 'play-60hz-warmup', start: 1000, mode: 'play', noUpdate: ['world'],
      frames: [{ now: 1000 + ms(1) }, { now: 1000 + ms(2) }, { now: 1000 + ms(3), before: [['compileDone', false]] }, { now: 1000 + ms(4) },
        { now: 1000 + ms(5), before: [['warmupDue']] }, { now: 1000 + ms(6), before: [['compileDone', true]] }, { now: 1000 + ms(7) },
        { now: 1000 + ms(8), before: [['warmupDue']] }, { now: 1000 + ms(9), before: [['warmupDue']] }, { now: 1000 + ms(10), before: [['compileDone', false]] },
        { now: 1000 + ms(11), before: [['compileDone', false]] }] },
    { id: 'dt-cap-and-clock', start: 0, mode: 'play',
      frames: [{ now: 250 }, { now: 350 }, { now: 350 }, { now: 349 }, { now: 449.99999 }, { now: 1e6 }, { now: 1e6 + 7.123456789 }] },
    { id: 'pause-and-time-scale', start: 5000, mode: 'play',
      frames: [{ now: 5016.7 }, { now: 5033.3, before: [['timeScale', 0.3]] }, { now: 5050, before: [['setMode', 'paused']] }, { now: 5066.7 },
        { now: 5083.3, before: [['setMode', 'paused'], ['timeScale', 0.5]] }, { now: 5100, before: [['setMode', 'play']] },
        { now: 5116.7, before: [['setMode', 'debrief'], ['timeScale', 1]] }, { now: 5133.3, before: [['setMode', 'title']] }] },
    { id: 'failing-system-is-disabled', start: 0, mode: 'play',
      frames: [{ now: 16 }, { now: 33, before: [['throw', 'hazards']] }, { now: 50 }, { now: 66, before: [['setMode', 'paused'], ['throw', 'hud']] }, { now: 83 }] },
  ];
  const runs = [];
  for (const s of scripts) runs.push({ ...s, ...(await run(s)) });

  // pixelRatio(): min(devicePixelRatio || 1, settings.pixelRatioCap(), max(1, sqrt(1920·1080 / (w·h))))
  const pixelFn = new Function('window', 'settings', `${PIXEL_SRC}; return pixelRatio;`);
  const caps = { low: 1, medium: 1.25, high: 2, odd: 1.5 };
  const pixel = [];
  for (const [w, h] of [[1280, 720], [1920, 1080], [2532, 1170], [844, 390], [2560, 1600], [3840, 2160], [390, 844], [1, 1]]) {
    for (const dpr of [1, 2, 3, 0, 1.5]) {
      for (const [q, cap] of Object.entries(caps)) {
        const f = pixelFn({ devicePixelRatio: dpr, innerWidth: w, innerHeight: h }, { pixelRatioCap: () => cap });
        pixel.push([w, h, dpr, cap, num(f())]);
      }
    }
  }

  out('core', 'loop', {
    files: [relSrc('main.js')],
    tolerance: { class: 'bitwise', note: 'per frame: the call log (setTime, poll, update [key, dt], renderHidden, render [dt], compile, game:mode, error) in order, ctx.time [t, dt, realT, realDt, frame] bit-exact, warm-up state and disabled systems' },
    data: {
      note: 'frame() cut from main.js (acorn) and run over stubs: performance.now() = frames[i].now (ms); systems record update(dt); a system listed in `noUpdate` has no update(); `before` actions run before the frame: setMode, timeScale, throw (the system throws from now on), warmupDue (mission:setup / quality change), compileDone [failed?] (the pending compileScene promise settles). Per frame: beforeLog (calls caused by the before actions, e.g. game:mode), log (inside frame()), after (microtasks after the frame: startWarmup → compileScene = [\'compile\']), warm state after those microtasks',
      scripts: runs,
      pixelRatio: { rule: 'min(devicePixelRatio || 1, cap, max(1, sqrt(1920 * 1080 / (w * h))))', rows: pixel, columns: ['innerWidth', 'innerHeight', 'devicePixelRatio', 'pixelRatioCap', 'pixelRatio'] },
    },
  });
}

// ================================================================================================ settings
// The real Settings class constructed against stubbed localStorage / matchMedia / location.search,
// then driven by scripted set() / onChange() calls. JSON values are passed as-is; ['setNaN', key]
// stands for set(key, NaN) (JSON has no NaN).
async function settings() {
  const S = await gameImport('core/settings.js');
  const I = await gameImport('core/input.js');
  const g = globalThis;
  const saved = { localStorage: g.localStorage, matchMedia: g.matchMedia, search: g.location.search };
  const KEY = 'mayday.settings.v1', PKEY = 'mayday.progress.v1';
  const bindingsSnap = () => JSON.parse(JSON.stringify(I.BINDINGS));
  function install(c) {
    const store = new Map();
    if (typeof c.stored === 'string') store.set(KEY, c.stored);
    if (typeof c.progress === 'string') store.set(PKEY, c.progress);
    g.localStorage = c.unavailable
      ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
    g.matchMedia = (q) => ({ matches: (q.includes('prefers-reduced-motion') && !!c.reduced) || (q.includes('pointer: coarse') && !!c.coarse) });
    g.location.search = c.search || '';
    return store;
  }
  function run(c) {
    const store = install(c);
    const s = new S.Settings();
    const log = [];
    const probe = () => log.push(['probe', JSON.stringify(s.values), store.has(KEY) ? store.get(KEY) : null, num(s.pixelRatioCap()), num(s.detail()), s.autoAssist(), bindingsSnap()]);
    probe();
    const offs = {};
    const listen = (id, behaviors = []) => {
      offs[id] = s.onChange((key, value) => {
        log.push(['call', id, key, value === undefined ? null : JSON.parse(JSON.stringify(value === value ? value : null))]);
        for (const b of behaviors) {
          if (b.when !== key) continue;
          if (b.set) s.set(b.set[0], b.set[1]);
          if (b.off) offs[b.off]?.();
          if (b.listen) listen(b.listen[0], b.listen[1] || []);
        }
      });
    };
    for (const a of c.actions || []) {
      switch (a[0]) {
        case 'listen': listen(a[1], a[2]); break;
        case 'off': offs[a[1]]?.(); break;
        case 'set': s.set(a[1], a[2]); log.push(['stored', store.has(KEY) ? store.get(KEY) : null]); break;
        case 'setNaN': s.set(a[1], NaN); log.push(['stored', store.has(KEY) ? store.get(KEY) : null]); break;
        case 'probe': probe(); break;
        default: throw new Error('bad settings action ' + a[0]);
      }
    }
    return log;
  }
  const B = { up: ['KeyI', 'KeyI', 'Escape', 'F5', 'ControlLeft', 'KeyK', 'KeyL'], down: ['Mouse2'], flare: ['Mouse1', 'KeyX', 5, ''], winch: 'Space', nope: ['KeyQ'], climb: [], thermal: ['Mouse0', 'MetaLeft', 'KeyY'] };
  const cases = [
    { id: 'defaults' },
    { id: 'first-run-reduced-motion', reduced: true },
    { id: 'first-run-touch', coarse: true },
    { id: 'first-run-touch-reduced', coarse: true, reduced: true },
    { id: 'stored-assist-off-migrates', stored: '{"assist":"off"}', reduced: true },
    { id: 'stored-assist-full-cadet-touch', stored: '{"assist":"full","difficulty":"cadet"}', coarse: true },
    { id: 'stored-assist-standard-cadet', stored: '{"assist":"standard","difficulty":"cadet"}' },
    { id: 'stored-assistExplicit-null', stored: '{"assist":"off","assistExplicit":null}' },
    { id: 'stored-assistExplicit-false', stored: '{"assist":"off","assistExplicit":false}' },
    { id: 'stored-assist-falsy', stored: '{"assist":0}' },
    { id: 'stored-garbage', stored: '{oops', reduced: true, coarse: true },
    { id: 'stored-null', stored: 'null', reduced: true },
    { id: 'stored-string', stored: '"ab"' },
    { id: 'stored-array', stored: '[1,{"x":2},"z"]' },
    { id: 'stored-number', stored: '5' },
    { id: 'stored-key-order', stored: '{"zeta":1,"10":"a","2":"b","quality":"medium","alarms":false,"01":"c","x":{"9":1,"y":2,"1":3}}' },
    { id: 'stored-bindings', stored: JSON.stringify({ bindings: B }) },
    { id: 'stored-bindings-number', stored: '{"bindings":5}' },
    { id: 'stored-bindings-null', stored: '{"bindings":null}' },
    { id: 'stored-bindings-array', stored: '{"bindings":[["KeyI"]]}' },
    { id: 'stored-unknown-quality', stored: '{"quality":"ultra"}' },
    { id: 'stored-quality-array', stored: '{"quality":["low"]}' },
    { id: 'stored-quality-number', stored: '{"quality":5}' },
    { id: 'storage-unavailable', unavailable: true, reduced: true, actions: [['set', 'quality', 'low'], ['probe']] },
    { id: 'quality-param', search: '?quality=medium', coarse: true },
    { id: 'quality-param-invalid', search: '?quality=ultra&debug' },
    { id: 'quality-param-empty', search: '?quality=', stored: '{"quality":"low"}' },
    { id: 'set-sequence', actions: [
      ['listen', 'L1'], ['listen', 'L2', [{ when: 'quality', set: ['showFps', true] }]],
      ['set', 'quality', 'low'], ['set', 'quality', 'low'], ['probe'],
      ['set', 'difficulty', 'cadet'], ['set', 'assistExplicit', true], ['set', 'difficulty', 'ace'], ['set', 'assist', 'off'],
      ['set', 'bindings', { up: ['KeyI'], left: ['Mouse0', 'KeyJ'] }], ['probe'], ['set', 'bindings', { up: ['KeyI'] }], ['set', 'bindings', {}], ['probe'],
      ['setNaN', 'masterVolume'], ['setNaN', 'masterVolume'], ['set', 'masterVolume', 0], ['set', 'masterVolume', 0],
      ['listen', 'L3', [{ when: 'textScale', off: 'L4' }, { when: 'hudScale', listen: ['L5'] }, { when: 'hudScale', off: 'L1' }]], ['listen', 'L4'],
      ['set', 'textScale', 1.25], ['set', 'hudScale', 1.1], ['set', 'hudScale', 1.2],
      ['off', 'L2'], ['off', 'L2'], ['set', 'quality', 'medium'], ['set', 'newKey', 'x'], ['set', 'vibration', 'loud'], ['set', 'subtitles', null], ['probe']] },
    { id: 'difficulty-cascade-not-explicit', stored: '{"difficulty":"ace","assist":"standard"}', actions: [
      ['listen', 'L', [{ when: 'assist', set: ['seenFlashWarning', true] }]], ['set', 'difficulty', 'cadet'], ['set', 'difficulty', 'pilot'], ['probe']] },
    { id: 'touch-difficulty', coarse: true, actions: [['set', 'difficulty', 'pilot'], ['set', 'difficulty', 'cadet'], ['probe']] },
  ];
  const runs = cases.map((c) => ({ ...c, log: run(c) }));

  // loadProgress / saveProgress
  const progress = [];
  for (const raw of [null, '{"a":1,"2":[true]}', 'garbage', '0', '5', '""', '[]', 'false', 'null', '"x"']) {
    install({ progress: raw });
    progress.push(['load', raw, JSON.stringify(S.loadProgress())]);
  }
  install({ unavailable: true });
  progress.push(['load-unavailable', null, JSON.stringify(S.loadProgress())]);
  for (const data of [{ medals: { 0: ['gold'] }, best: 1234.5, s: 'ё "q" \\ \n\u0001' }, [], 7, null, { nan: NaN, inf: -Infinity, nz: -0 }]) {
    const store = install({});
    S.saveProgress(data);
    progress.push(['save', JSON.parse(JSON.stringify(data === null ? null : data)), store.get(PKEY) ?? null]);
  }
  g.localStorage = saved.localStorage;
  g.matchMedia = saved.matchMedia;
  g.location.search = saved.search;
  I.applyBindings({});

  out('settings', 'settings', {
    files: [relSrc('core/settings.js'), relSrc('core/input.js')],
    tolerance: { class: 'bytes', note: 'stored strings byte-exact (JSON.stringify of the values), listener call order exact, numbers bit-exact' },
    data: {
      note: "case: {stored (raw localStorage string, absent = nothing stored), unavailable (storage throws), reduced (prefers-reduced-motion), coarse (pointer: coarse), search (location.search), actions}; log rows: ['probe', JSON.stringify(values), stored, pixelRatioCap(), detail(), autoAssist(), BINDINGS] | ['call', listenerId, key, value] | ['stored', string after a set()]; actions: ['listen', id, [{when: key, set|off|listen}]] | ['off', id] | ['set', key, json] | ['setNaN', key] | ['probe']",
      cases: runs,
      progress: { note: "['load', raw, JSON.stringify(loadProgress())] | ['save', data (NaN/±Infinity serialised as null, -0 as 0 here), stored string]; the save rows' data is re-parsed from JSON, see export-core.mjs for the exact inputs", rows: progress,
        saveInputs: ['{"medals":{"0":["gold"]},"best":1234.5,"s":"ё \\"q\\" \\\\ \\n\\u0001"}', '[]', '7', 'null', 'NaN/-Infinity/-0 object'] },
    },
  });
}

// ================================================================================================ input
// The real Input class with stubbed DOM events, navigator.getGamepads() and performance.now(): every
// script frame feeds raw events (calling the class's own listener functions), sets the pads, polls,
// then records everything a system can read.
async function input() {
  const I = await gameImport('core/input.js');
  const g = globalThis;
  const ACTIONS = Object.keys(I.BINDINGS.buttons);
  const AXES = ['moveX', 'moveY', 'lift', 'aimX', 'aimY'];
  const saved = { innerWidth: g.innerWidth, innerHeight: g.innerHeight };
  let pads = [];
  let clock = 0;
  const rumbles = [];
  Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true, writable: true });
  const perfNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
  g.innerWidth = 1280;
  g.innerHeight = 720;

  // pad spec: {connected?, vib?, axes?, b?: {index: [pressed, value]}}
  const val = (x) => (x === 'NaN' ? NaN : x); // the script spells NaN as a string (JSON)
  const mkPad = (p) => {
    if (!p) return null;
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    for (const [i, [pressed, value]] of Object.entries(p.b || {})) buttons[i] = { pressed, value: val(value) };
    const pad = { connected: p.connected !== false, buttons, axes: (p.axes || [0, 0, 0, 0]).map(val) };
    if (p.vib) pad.vibrationActuator = { playEffect: (type, o) => { rumbles.push([type, num(o.duration), num(o.strongMagnitude), num(o.weakMagnitude)]); return Promise.resolve(); } };
    return pad;
  };
  const canvas = { tagName: 'CANVAS', closest: () => ({}) };
  const hudDiv = { tagName: 'DIV', closest: () => null };
  function run(script) {
    I.applyBindings({});
    const inp = new I.Input({ addEventListener() {} });
    const frames = [];
    for (const f of script.frames) {
      const reads = [];
      if (f.pads !== undefined) pads = f.pads.map(mkPad);
      for (const e of f.events || []) {
        if (e[0] === 'time') clock = e[1];
        else if (e[0] === 'keydown') inp._onKeyDown({ code: e[1], repeat: !!e[2], target: e[3] ? { tagName: 'INPUT' } : canvas, preventDefault() {} });
        else if (e[0] === 'keyup') inp._onKeyUp({ code: e[1] });
        else if (e[0] === 'blur') inp._onBlur();
        else if (e[0] === 'mousemove') inp._onMouseMove({ clientX: e[1], clientY: e[2] });
        else if (e[0] === 'mousedown') inp._onMouseDown({ button: e[1], target: e[2] ? canvas : hudDiv });
        else if (e[0] === 'mouseup') inp._onMouseUp({ button: e[1] });
        else if (e[0] === 'wheel') inp._onWheel({ deltaY: e[1] });
        else if (e[0] === 'touchstart') inp._onTouch();
        else if (e[0] === 'vaxis') inp.setVirtualAxis(e[1], val(e[2]));
        else if (e[0] === 'vbutton') inp.setVirtualButton(e[1], e[2]);
        else if (e[0] === 'enabled') inp.enabled = e[1];
        else if (e[0] === 'bindings') I.applyBindings(e[1]);
        else if (e[0] === 'rumble') { const at = rumbles.length; inp.rumble(e[1], e[2]); reads.push(['rumble', ...rumbles.slice(at).flat()]); }
        else if (e[0] === 'consumeWheel') reads.push(['consumeWheel', num(inp.consumeWheel())]);
        else throw new Error('bad input event ' + e[0]);
      }
      if (f.poll !== false) inp.poll();
      const m = inp.mouse;
      const mv = inp.move();
      frames.push({
        events: (f.events || []).map((e) => e.map((x) => (typeof x === 'number' ? num(x) : x))), ...(f.pads !== undefined ? { pads: f.pads } : {}), poll: f.poll !== false, reads,
        axesValues: N(AXES.map((a) => inp.axesValues[a])),
        axis: N(AXES.map((a) => inp.axis(a))),
        move: N([mv.x, mv.y]),
        // per action: down | pressed << 1 | released << 2 | rawPressed << 3
        buttons: ACTIONS.map((a) => (inp.down(a) ? 1 : 0) | (inp.pressed(a) ? 2 : 0) | (inp.released(a) ? 4 : 0) | (inp.rawPressed(a) ? 8 : 0)),
        any: inp.anyPressedThisFrame, lastDevice: inp.lastDevice,
        mouse: [...N([m.x, m.y, m.ndcX, m.ndcY]), m.down, num(m.wheel), m.active, num(m.lastMoveT)],
      });
    }
    return frames;
  }
  const stickPad = (ax, b) => (b ? { axes: ax, b } : { axes: ax });
  const scripts = [
    { id: 'keyboard', frames: [
      { events: [['keydown', 'KeyW']] }, {}, { events: [['keydown', 'KeyW', true]] }, { events: [['keyup', 'KeyW']] },
      { events: [['keydown', 'KeyG'], ['keyup', 'KeyG']] }, {},
      { events: [['keydown', 'KeyA'], ['keydown', 'KeyD']] }, { events: [['keyup', 'KeyA'], ['keydown', 'KeyW']] },
      { events: [['keydown', 'KeyE'], ['keydown', 'PageDown']] }, { events: [['keyup', 'KeyE']] },
      { events: [['keydown', 'Space'], ['keydown', 'ShiftLeft'], ['keydown', 'Escape']] }, { events: [['blur']] },
      { events: [['keydown', 'KeyL', false, true]] }, { events: [['keydown', 'KeyL', true]] }, { poll: false, events: [['keyup', 'KeyL']] }, {},
    ] },
    { id: 'mouse', frames: [
      { events: [['time', 1000], ['mousemove', 640, 360]] }, { events: [['time', 1016.5], ['mousemove', 100.5, 700]] },
      { events: [['time', 1033], ['mousedown', 0, true]] }, {}, {}, {}, { events: [['mouseup', 0]] }, {},
      { events: [['mousedown', 2, true], ['mouseup', 2]] }, {},
      { events: [['time', 2000], ['mousedown', 0, false]] }, {}, { events: [['mouseup', 0]] },
      { events: [['wheel', 120], ['wheel', 3], ['wheel', -0.5], ['wheel', 0], ['wheel', -0]] }, { events: [['consumeWheel'], ['consumeWheel'], ['wheel', -10]] },
      { events: [['mousedown', 1, true]] }, { events: [['mouseup', 1], ['blur']] },
    ] },
    { id: 'disabled', frames: [
      { events: [['enabled', false], ['keydown', 'Enter'], ['keydown', 'KeyD']] }, {}, { events: [['enabled', true]] }, { events: [['keyup', 'KeyD'], ['keyup', 'Enter']] },
    ] },
    { id: 'gamepad', frames: [
      { pads: [stickPad([0.1, 0.05, 0, 0])] },
      { pads: [stickPad([0.6, -0.8, 0, 0])] },
      { pads: [stickPad([0.3, 0.2, -1, 1])], events: [['keydown', 'KeyW']] },
      { pads: [stickPad([1, 1, 0.2, -0.13])], events: [['keyup', 'KeyW']] },
      { pads: [stickPad([0, 0, 0, 0], { 7: [false, 0.9], 6: [false, 0.1] })] },
      { pads: [stickPad([0, 0, 0, 0], { 7: [false, 0.5], 6: [false, 0.45] })], events: [['keydown', 'KeyE']] },
      { pads: [stickPad([0, 0, 0, 0], { 0: [true, 1], 12: [true, 1] })], events: [['keyup', 'KeyE']] },
      { pads: [stickPad([0, 0, 0, 0], { 0: [true, 1], 15: [true, 1], 7: [true, 'NaN'] })] },
      { pads: [stickPad(['NaN', 0.5, 0, 0])] },
      { pads: [null, { connected: false, axes: [1, 0, 0, 0] }, stickPad([0, 0.2, 0, 0])], events: [['keydown', 'KeyS']] },
      { pads: [], events: [['keyup', 'KeyS']] },
      { pads: [{ axes: [0.5, 0, 0, 0], vib: true }], events: [['rumble', 0.7, 300], ['rumble', 0.5, 200]] },
      { pads: [{ axes: [0, 0, 0, 0] }], events: [['rumble', 1, 50]] },
      { pads: [], events: [['rumble', 1, 50]] },
    ] },
    { id: 'touch', frames: [
      { events: [['touchstart']] },
      { events: [['vaxis', 'moveX', 0.5], ['vaxis', 'moveY', -0.25], ['vaxis', 'lift', 0.01], ['vaxis', 'aimX', 0.3], ['vbutton', 'winch', true]] },
      { pads: [stickPad([0.9, 0, 0.9, 0])] },
      { events: [['vaxis', 'moveX', 0], ['vaxis', 'moveY', 0], ['vaxis', 'lift', -0.7], ['vbutton', 'winch', false]] },
      { pads: [], events: [['vaxis', 'aimY', 'NaN'], ['vaxis', 'lift', 3], ['keydown', 'KeyD']] },
      { events: [['vaxis', 'moveX', 'NaN'], ['vbutton', 'map', 1]] },
    ] },
    { id: 'rebinding-live', frames: [
      { events: [['keydown', 'KeyW']] },
      { events: [['bindings', { up: ['KeyI'], winch: ['KeyW', 'Mouse2'], descend: ['KeyW'] }]] },
      { events: [['keydown', 'KeyI'], ['mousedown', 2, true]] },
      { events: [['bindings', {}], ['keyup', 'KeyI'], ['mouseup', 2]] },
      { events: [['bindings', { up: [] }]] },
      { events: [['bindings', null], ['keyup', 'KeyW']] },
    ] },
  ];
  const runs = scripts.map((s) => ({ ...s, frames: run(s) }));

  const codes = ['KeyA', 'ControlLeft', 'Control', 'MetaRight', 'AltGraph', 'OSLeft', 'FnLock', 'F1', 'F12', 'F', 'Fx', 'F1a', 'f5', 'Escape', 'Backspace',
    'Backquote', 'Enter', 'NumpadEnter', 'CapsLock', 'ContextMenu', 'PrintScreen', 'Mouse0', 'Mouse2', 'Space', '', 'Controller', 'ArrowUp'];
  const overrides = [{}, null, 5, 'x', [], { up: ['KeyI', 'KeyO', 'KeyP'] }, { up: 'KeyI' }, { left: ['Mouse0', 'Mouse1', 'Mouse2', 'F3', 'ControlRight', 'KeyJ'] },
    { climb: ['KeyE', 'KeyE', 'KeyE'], descend: [], photo: ['KeyV', 'Backquote', null, 7, 'KeyB'] }, { altPreset1: ['Digit0'], map: ['Tab'], zoom: ['KeyZ', 'Escape', 'Enter'] }];
  const ids = I.REBINDABLE.map((r) => r.id).concat(['nope']);
  const apply = overrides.map((ov) => {
    I.applyBindings(ov);
    return { overrides: ov, bindings: JSON.parse(JSON.stringify(I.BINDINGS)), currentKeys: ids.map((id) => I.currentKeys(id)) };
  });
  I.applyBindings({});
  const defaultKeys = ids.map((id) => [id, I.defaultKeys(id)]);

  if (perfNow) Object.defineProperty(performance, 'now', perfNow); else delete performance.now;
  g.innerWidth = saved.innerWidth;
  g.innerHeight = saved.innerHeight;

  out('input', 'input', {
    files: [relSrc('core/input.js')],
    tolerance: { class: 'bitwise', note: 'every recorded read bit-exact / equal after each poll' },
    data: {
      actions: ACTIONS, axes: AXES, view: [1280, 720],
      note: "frame: events (raw: ['time', ms] sets performance.now(); keydown code repeat? inTextField?; keyup; blur; mousemove x y; mousedown button onGameCanvas?; mouseup button; wheel deltaY; touchstart; vaxis name v; vbutton name down; enabled bool; bindings overrides (applyBindings); rumble strength ms; consumeWheel), pads (navigator.getGamepads(): null | {connected?, axes, b: {index: [pressed, value]}, vib?}; absent = unchanged), poll (default true). Recorded after the poll: reads (rumble effects issued, consumeWheel results), axesValues, axis(), move(), buttons per action (down | pressed<<1 | released<<2 | rawPressed<<3), anyPressedThisFrame, lastDevice, mouse [x, y, ndcX, ndcY, down, wheel, active, lastMoveT]",
      scripts: runs,
      bindableCode: codes.map((c) => [c, I.bindableCode(c)]),
      defaultKeys,
      applyBindings: apply,
    },
  });
}

// ================================================================================================ haptics
// The real core/haptics.js Haptics on a stub ctx (events = the real EventBus, input.rumble recorded,
// settings.get('vibration') scripted). Payloads are complete, as the game emits them (the port's
// payloads are typed, so a field is never missing).
//   step: ['emit', name, payload] | ['mode', m] | ['device', d] | ['vibration', v | null]
async function haptics() {
  const { Haptics } = await gameImport('core/haptics.js');
  const { EventBus } = await gameImport('core/events.js');
  const rumbles = [];
  const ctx = {
    events: new EventBus(), mode: 'play',
    input: { lastDevice: 'gamepad', rumble: (s, d) => rumbles.push([num(s), num(d)]) },
    vibration: 1,
    settings: { get: (k) => (k === 'vibration' ? ctx.vibration : undefined) },
  };
  new Haptics(ctx);
  const dmg = (amount) => ['emit', 'heli:damage', { amount, source: 'rogue', hull: 0.5 }];
  const hit = (damage) => ['emit', 'hazard:hit', { type: 'rogue', damage, source: 'rogue' }];
  const gust = (strength, harmless) => ['emit', 'weather:gust', { dir: [1, 0], strength, eta: 3, x: 10, z: -20, harmless }];
  const bolt = (distance, cloudOnly) => ['emit', 'weather:lightning', { x: 0, z: 0, distance, strength: 1, cloudOnly }];
  const all = [dmg(0), dmg(0.1), dmg(0.25), dmg(0.3), ['emit', 'heli:water-strike', { x: 1, z: 2, strength: 0.4 }], ['emit', 'heli:touchdown', { vy: -1.5 }],
    ['emit', 'heli:land', { autorotation: false, vy: -0.5 }], ['emit', 'heli:land', { autorotation: true, vy: -3 }],
    ['emit', 'heli:crash', { reason: 'water', x: 0, z: 0, onDeck: false }], ['emit', 'heli:capture', { survivor: 3 }],
    ['emit', 'heli:pickup', { survivor: 3, person: 7 }], ['emit', 'heli:slip', { survivor: 3, reason: 'tension' }],
    ['emit', 'heli:snag', { x: 1, z: 2, reason: 'wave' }], hit(0), hit(0.05), hit(0.13), hit(0.4),
    gust(0, false), gust(5, false), gust(12, false), gust(15, false), gust(40, false), gust(20, true),
    bolt(0, false), bolt(100, false), bolt(495, false), bolt(600, false), bolt(600.0000000000001, false), bolt(50, true), bolt(1e4, false),
    ['emit', 'ui:click', { menu: 'controls' }]];
  const steps = [...all,
    ['vibration', 0.5], dmg(0.1), hit(0.4), bolt(100, false), ['vibration', 2], dmg(0.1), gust(12, false), ['vibration', 0], dmg(0.1),
    ['vibration', -1], dmg(0.1), ['vibration', null], dmg(0.1), ['vibration', 'loud'], dmg(0.1), ['vibration', '0.5'], dmg(0.1),
    ['vibration', ''], dmg(0.1), ['vibration', true], dmg(0.1), ['vibration', false], dmg(0.1), ['vibration', [0.25]], dmg(0.1), ['vibration', 1],
    ['mode', 'paused'], dmg(0.1), ['mode', 'title'], ['emit', 'heli:crash', { reason: 'water', x: 0, z: 0, onDeck: false }], ['mode', 'play'],
    ['device', 'keyboard'], dmg(0.1), ['device', 'touch'], dmg(0.1), ['device', 'gamepad'], dmg(0.1)];
  const rows = steps.map((s) => {
    switch (s[0]) {
      case 'emit': ctx.events.emit(s[1], s[2]); break;
      case 'mode': ctx.mode = s[1]; break;
      case 'device': ctx.input.lastDevice = s[1]; break;
      case 'vibration': ctx.vibration = s[1]; break;
      default: throw new Error('bad haptics step ' + s[0]);
    }
    return { step: s, rumble: rumbles.splice(0) };
  });
  out('input', 'haptics', {
    files: [relSrc('core/haptics.js')],
    tolerance: { class: 'bitwise', note: 'rumble calls per step, [strength, duration] bit-exact (NaN == NaN)' },
    data: { note: "steps run in order on one Haptics; step: ['emit', name, payload] | ['mode', m] | ['device', lastDevice] | ['vibration', settings value]; rumble: input.rumble(strength, ms) calls the step caused", rows },
  });
}

// ===================================================================================================== run
const GROUPS = { jsnumber, three, events, loop, settings, input, haptics };
for (const [k, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.has(k)) continue;
  const t0 = Date.now();
  await fn();
  console.log(`[${k}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const r of results) console.log(`${r.path}\t${r.bytes}`);
