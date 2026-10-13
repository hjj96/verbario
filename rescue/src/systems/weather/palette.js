// Palette packing & blending.
//
// Every preset is compiled once into a flat Float64Array (colours as linear RGB triplets, angles as
// sin/cos pairs). A transition blends two such arrays slot by slot, each slot advancing with the
// progress of its own CHANNEL (DESIGN §2.5: colours/light, wind, rain and waves change on different
// schedules). The result is unpacked into the contract-shaped `palette` object (THREE.Color,
// Vector3, plain numbers) without allocating anything per frame.
import * as THREE from 'three';
import { PRESETS, PRESET_NAMES, GREEN_TINT } from './presets.js';

// Transition channels.
export const CH_COLOR = 0; // sky, light, fog, grading — smootherstep 0–100 %
export const CH_WIND = 1; // wind, gusts, turbulence, hazard rates, intensity — lead by 15 %
export const CH_RAIN = 2; // rain, lightning factor — from +10 %, pow(t, 2.5) onset
export const CH_WAVE = 3; // sea state — lag: from +25 % to 140 %, twice slower when calming
export const CHANNELS = 4;

// [key, kind, channel, group]. kind: 'color' (3 floats), 'vec3' (3), 'angle' (2: sin, cos), 'num' (1).
// group: '' = palette root, 'post' = palette.post, 'sea' = palette.sea, 'detect' = palette.detect.
const ENTRIES = [
  // light & atmosphere
  ['sky', 'color', CH_COLOR, ''], ['fogColor', 'color', CH_COLOR, ''], ['deep', 'color', CH_COLOR, ''],
  ['body', 'color', CH_COLOR, ''], ['crest', 'color', CH_COLOR, ''], ['shallow', 'color', CH_COLOR, ''],
  ['foam', 'color', CH_COLOR, ''], ['sun', 'color', CH_COLOR, ''], ['ambient', 'color', CH_COLOR, ''],
  ['ambientGround', 'color', CH_COLOR, ''], ['spec', 'color', CH_COLOR, ''], ['accent', 'color', CH_COLOR, ''],
  ['shadowTint', 'color', CH_COLOR, ''],
  ['sunIntensity', 'num', CH_COLOR, ''], ['ambientIntensity', 'num', CH_COLOR, ''],
  ['shadowIntensity', 'num', CH_COLOR, ''], ['shadowRadius', 'num', CH_COLOR, ''],
  ['sunElev', 'num', CH_COLOR, ''], ['sunAz', 'angle', CH_COLOR, ''], ['shadowElev', 'num', CH_COLOR, ''],
  ['fogNear', 'num', CH_COLOR, ''], ['fogFar', 'num', CH_COLOR, ''], ['exposure', 'num', CH_COLOR, ''],
  ['envIntensity', 'num', CH_COLOR, ''], ['night', 'num', CH_COLOR, ''], ['visibility', 'num', CH_COLOR, ''],
  ['fog', 'num', CH_COLOR, ''], ['cloudShadow', 'num', CH_COLOR, ''],
  ['glitter', 'num', CH_COLOR, ''], ['glitterExp', 'num', CH_COLOR, ''], ['sss', 'num', CH_COLOR, ''],
  ['scud', 'num', CH_COLOR, ''], ['beam', 'num', CH_COLOR, ''],
  ['base', 'num', CH_COLOR, 'detect'], ['altBonus', 'num', CH_COLOR, 'detect'],
  // grading (DESIGN §2.8 table)
  ['bloomStrength', 'num', CH_COLOR, 'post'], ['bloomRadius', 'num', CH_COLOR, 'post'],
  ['bloomThreshold', 'num', CH_COLOR, 'post'], ['saturation', 'num', CH_COLOR, 'post'],
  ['contrast', 'num', CH_COLOR, 'post'], ['slope', 'vec3', CH_COLOR, 'post'], ['offset', 'vec3', CH_COLOR, 'post'],
  ['power', 'num', CH_COLOR, 'post'], ['splitShadow', 'color', CH_COLOR, 'post'],
  ['splitHighlight', 'color', CH_COLOR, 'post'], ['splitStrength', 'num', CH_COLOR, 'post'],
  ['vignette', 'num', CH_COLOR, 'post'], ['vignetteColor', 'color', CH_COLOR, 'post'],
  ['grain', 'num', CH_COLOR, 'post'], ['ca', 'num', CH_COLOR, 'post'], ['drops', 'num', CH_COLOR, 'post'],
  // wind & storminess
  ['wind', 'num', CH_WIND, ''], ['gustStrength', 'num', CH_WIND, ''], ['gustRate', 'num', CH_WIND, ''],
  ['turbulence', 'num', CH_WIND, ''], ['lightningPerMin', 'num', CH_WIND, ''], ['spoutsPerMin', 'num', CH_WIND, ''],
  ['roguesPerMin', 'num', CH_WIND, ''], ['intensity', 'num', CH_WIND, ''],
  // precipitation
  ['rain', 'num', CH_RAIN, ''], ['lightning', 'num', CH_RAIN, ''],
  // sea state (DESIGN §2.6.3)
  ['Hs', 'num', CH_WAVE, 'sea'], ['swellAdd', 'num', CH_WAVE, 'sea'], ['Q', 'num', CH_WAVE, 'sea'],
  ['detail', 'num', CH_WAVE, 'sea'], ['whitecaps', 'num', CH_WAVE, 'sea'], ['streaks', 'num', CH_WAVE, 'sea'],
  ['foamLines', 'num', CH_WAVE, 'sea'], ['roughness', 'num', CH_WAVE, 'sea'], ['roughnessRain', 'num', CH_WAVE, 'sea'],
  ['clearing', 'num', CH_WAVE, 'sea'], ['cloudReflect', 'num', CH_COLOR, 'sea'],
];

const SIZE = { color: 3, vec3: 3, angle: 2, num: 1 };

// Resolved layout: offsets + per-slot channel table.
export const LAYOUT = [];
let n = 0;
for (const [key, kind, ch, group] of ENTRIES) {
  LAYOUT.push({ key, kind, ch, group, o: n, size: SIZE[kind] });
  n += SIZE[kind];
}
export const SLOTS = n;
export const SLOT_CHANNEL = new Uint8Array(SLOTS);
for (const e of LAYOUT) for (let i = 0; i < e.size; i++) SLOT_CHANNEL[e.o + i] = e.ch;

// Offsets of individual values that weather.js reads directly from packed arrays.
export const OFF = Object.fromEntries(LAYOUT.map((e) => [(e.group ? e.group + '.' : '') + e.key, e.o]));

const _c = new THREE.Color();

function readSource(def, e) {
  const src = e.group ? def[e.group] : def;
  return src[e.key];
}

// Compile one preset definition into a packed array.
export function compilePreset(def) {
  const a = new Float64Array(SLOTS);
  for (const e of LAYOUT) {
    const v = readSource(def, e);
    if (e.kind === 'color') {
      _c.set(v);
      a[e.o] = _c.r;
      a[e.o + 1] = _c.g;
      a[e.o + 2] = _c.b;
    } else if (e.kind === 'vec3') {
      a[e.o] = v[0];
      a[e.o + 1] = v[1];
      a[e.o + 2] = v[2];
    } else if (e.kind === 'angle') {
      const r = THREE.MathUtils.degToRad(v);
      a[e.o] = Math.sin(r);
      a[e.o + 1] = Math.cos(r);
    } else a[e.o] = v;
  }
  return a;
}

export const COMPILED = Object.fromEntries(PRESET_NAMES.map((name) => [name, compilePreset(PRESETS[name])]));

// greenTint targets, packed: NaN = slot not affected.
const GREEN_TARGET = new Float64Array(SLOTS).fill(NaN);
for (const e of LAYOUT) {
  if (e.group || e.kind !== 'color') continue;
  const hex = GREEN_TINT.colors[e.key];
  if (!hex) continue;
  _c.set(hex);
  GREEN_TARGET[e.o] = _c.r;
  GREEN_TARGET[e.o + 1] = _c.g;
  GREEN_TARGET[e.o + 2] = _c.b;
}
const GREEN_MUL = Object.entries(GREEN_TINT.mul).map(([k, m]) => [OFF[k], m]);

// out = a + (b − a)·t[channel(slot)]
export function blendPacked(out, a, b, t) {
  for (let i = 0; i < SLOTS; i++) out[i] = a[i] + (b[i] - a[i]) * t[SLOT_CHANNEL[i]];
  return out;
}

// Pull a packed palette towards the greenTint column (in place).
export function applyGreen(out, g) {
  if (g <= 0) return out;
  for (let i = 0; i < SLOTS; i++) {
    const v = GREEN_TARGET[i];
    if (v === v) out[i] += (v - out[i]) * g; // skip NaN
  }
  for (const [o, m] of GREEN_MUL) out[o] *= 1 + (m - 1) * g;
  return out;
}

// Contract-shaped palette object (DESIGN §2.3 + extras). Allocated once per holder.
export function createPalette() {
  const p = { post: {}, sea: {}, detect: {} };
  for (const e of LAYOUT) {
    const tgt = e.group ? p[e.group] : p;
    if (e.kind === 'color') tgt[e.key] = new THREE.Color();
    else if (e.kind === 'vec3') tgt[e.key] = new THREE.Vector3();
    else tgt[e.key] = 0;
  }
  // Contract aliases kept in sync by unpack(): sea.Hs drives state.waveHeight etc.
  return p;
}

// Write a packed array into a palette object. Colours stay in the linear working space.
export function unpack(p, a) {
  for (const e of LAYOUT) {
    const tgt = e.group ? p[e.group] : p;
    const o = e.o;
    if (e.kind === 'color') tgt[e.key].setRGB(a[o], a[o + 1], a[o + 2]);
    else if (e.kind === 'vec3') tgt[e.key].set(a[o], a[o + 1], a[o + 2]);
    else if (e.kind === 'angle') {
      let deg = THREE.MathUtils.radToDeg(Math.atan2(a[o], a[o + 1]));
      if (deg < 0) deg += 360;
      tgt[e.key] = deg;
    } else tgt[e.key] = a[o];
  }
  // Rain makes the sea matte (squall «матовое олово», §2.6.3): fold the rain term in once.
  p.sea.roughness = p.sea.roughness + p.sea.roughnessRain * p.rain;
  return p;
}
