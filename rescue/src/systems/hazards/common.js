// Shared pieces of the HAZARDS system (DESIGN §2.12, §3.12, §8.2): numbers, fixed colours, the
// "hazard air" uniform block (light on scattering media, flash, searchlight, heli cut-out), GLSL helpers
// (top-down fog, beam, heli screen hole) and tiny math utilities.
//
// Colour rule (DESIGN §1.1, pillar 1): hazards are COLD — greys, slate, cold blue, magenta in the HUD.
// Nothing in this folder may use orange.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

// Deterministic small RNG (mulberry32) for layouts and per-hazard randomness.
export function rng32(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Numbers (DESIGN §3.12). Stage durations in seconds.
export const SPOUT = {
  // waterspout: Rankine core 15 m, influence 120 m, Vmax 50 m/s, inflow −0.35·v_t
  rc: 15, rinf: 120, vmax: 50, inflow: 0.35, updraft: 6, damage: 0.06, spinRate: 3,
  stages: [6, 5, 4], // dark spot, spiral, spray ring (telegraph 15 s)
  descend: 3, // mature funnel descends from the collar in 3 s
  decay: 6,
  life: [60, 120],
  drift: [3, 8], // m/s, wind × 0.35 + wander
  collarY: 110,
  collarR: [60, 90],
  oceanR: 25, // ocean 'vortex' feature radius (foam ring at R, dark ring at 1.2R)
  scale: 1,
};
export const TORNADO = {
  rc: 35, rinf: 300, vmax: 70, inflow: 0.35, updraft: 9, damage: 0.10, spinRate: 3,
  stages: [8, 6, 6], // telegraph 20 s (green sky grows over the same 20 s)
  descend: 4,
  decay: 10,
  life: [180, 300],
  speed: [4, 8],
  collarY: 112,
  collarR: [230, 290],
  oceanR: 70, // the debris skirt
  scale: 4,
  debrisDamage: 0.05,
};
export const SATELLITE = {
  rc: 6, rinf: 45, vmax: 28, inflow: 0.35, updraft: 3, damage: 0.03, spinRate: 2,
  stages: [2, 2, 2], descend: 2.5, decay: 5, life: [35, 70], scale: 0.42,
};
export const ROGUE = {
  height: [12, 18], width: 22, speed: 15, length: 500, telegraph: 12,
  bow: 0.0015, // crest bowed forward: u += 0.0015·v²  (same as the ocean's rogue feature)
  damage: 0.20, damagePer5m: 0.06, knock: 18,
  sweep: 40, // floating things are carried ~40 m by the passing crest
};
export const WHIRL = { radius: [30, 60], tangential: 2, inward: 0.4, grow: 8, decay: 10, life: [180, 300], core: 8, coreTime: 5 };
export const DOWNBURST = { radius: 150, telegraph: 6, life: 25, decay: 4, outflow: 18, down: 5 };
export const HAIL = { radius: 220, life: [60, 90], damage: 0.01 };

// ---------------------------------------------------------------------------------------------
// Fixed colours (sRGB hex → THREE.Color converts to the linear working space).
export const COLORS = {
  funnelDark: '#3B4447',
  funnelLight: '#A8B3B5',
  funnelPale: '#E8EEF0', // clear weather
  tornadoDark: '#1C2326',
  tornadoLight: '#5E686B',
  collarDark: '#2C3437',
  collarLight: '#9AA5A8',
  collarPale: '#D2D9DB',
  spray: '#DCE6E6', // spout spray ring (α .3)
  rogueSpray: '#E4ECEE',
  foam: '#EEF3F2',
  charge: '#7FB8FF', // lightning charge ring (= St. Elmo's fire colour)
  chargeCore: '#DCEBFF',
  rainColumn: '#2A3236',
  hailColumn: '#CFE3D6',
  wood: '#5B4B3C',
  woodLight: '#7A6A58',
  barrelBlue: '#2C4756',
  barrelRust: '#5E2B27',
  hullWhite: '#C9CDCC',
  hullDark: '#2B3236',
  buoyWhite: '#E9ECEA',
  buoyRed: '#B3262A', // lifebuoy bands — red, never orange (DESIGN §1.1)
};

// ---------------------------------------------------------------------------------------------
// Shared uniforms: the look layer (by reference) + hazards' own air lighting / heli hole block.
export function createHazardUniforms(look) {
  const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  return {
    ...look.uniforms,
    ...fog,
    uHzTime: { value: 0 }, // hazards clock (game seconds; frozen while paused)
    uAirAmb: { value: new THREE.Color(0.3, 0.32, 0.34) }, // ambient on scattering media (linear)
    uAirSun: { value: new THREE.Color(0, 0, 0) }, // sun colour × intensity
    uAirSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAirFlash: { value: new THREE.Color(0, 0, 0) }, // flash colour × flash
    uAirNight: { value: 0 },
    uClear: { value: 0 }, // 0 storm … 1 clear daylight (pale funnels, white collars)
    uBeamPos: { value: new THREE.Vector4(0, 0, 0, 0) }, // searchlight origin, w = level
    uBeamDir: { value: new THREE.Vector4(0, -1, 0, 0.97) }, // dir, w = cos(outer)
    uBeamLen: { value: 30 },
    uHeliNdc: { value: new THREE.Vector4(0, 0, 0.3, 0) }, // aspect-corrected ndc xy, hole radius, visible
    uHeliDist: { value: 100 }, // camera → heli distance (only things in front of the heli are cut)
    uAspect: { value: 1.78 },
    uShadowY: { value: 3 }, // height of the cloud-shadow discs (above every crest)
    uQuality: { value: 1 }, // 1 high, 0.65 medium, 0.35 low (sprite thinning)
  };
}

export const HZ_GLSL = /* glsl */ `
${LOOK_GLSL_UNIFORMS}
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
#endif
uniform float uHzTime;
uniform vec3 uAirAmb;
uniform vec3 uAirSun;
uniform vec3 uAirSunDir;
uniform vec3 uAirFlash;
uniform float uAirNight;
uniform float uClear;
uniform vec4 uBeamPos;
uniform vec4 uBeamDir;
uniform float uBeamLen;
uniform vec4 uHeliNdc;
uniform float uHeliDist;
uniform float uAspect;
uniform float uShadowY;
uniform float uQuality;

// 0..1: how much a point sits inside the heli searchlight cone.
float hzBeam(vec3 p) {
  if (uBeamPos.w <= 0.001) return 0.0;
  vec3 d = p - uBeamPos.xyz;
  float l = length(d);
  float c = dot(d, uBeamDir.xyz) / max(l, 1e-3);
  float edge = smoothstep(uBeamDir.w, mix(uBeamDir.w, 1.0, 0.45), c);
  float range = 1.0 - smoothstep(uBeamLen + 2.0, uBeamLen + 14.0, l);
  return uBeamPos.w * edge * range;
}

// Light on scattering media (spray, cloud, funnel walls): ambient + sun·k + searchlight + a faint
// night floor so the worst frame still reads (DESIGN pillar 8). Flash is added by the caller.
vec3 hzAirLight(vec3 p, float sunK) {
  vec3 L = uAirAmb + uAirSun * sunK;
  L += vec3(1.0, 0.945, 0.855) * hzBeam(p) * 4.0;
  L += vec3(0.010, 0.014, 0.020) * uAirNight;
  return L;
}

// Patched top-down fog (core/look.js): horizontal distance from the point under the screen centre.
float hzFog(vec3 wp) {
#ifdef USE_FOG
  vec3 off = wp - cameraPosition;
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  float hd = length(off.xz - focus);
  return smoothstep(fogNear, fogFar, hd) * (1.0 - 0.6 * smoothstep(30.0, 140.0, wp.y));
#else
  return 0.0;
#endif
}
vec3 hzFogColor(vec3 c) {
#ifdef USE_FOG
  return fogColor;
#else
  return c;
#endif
}

// Keep the heli readable: alpha multiplier around the heli's screen position for fragments that sit
// between the camera and the heli. clip = the fragment's clip-space position (varying).
float hzHeliHole(vec4 clip, vec3 wp, float minA) {
  if (uHeliNdc.w < 0.5) return 1.0;
  vec2 ndc = clip.xy / max(clip.w, 1e-3);
  ndc.x *= uAspect;
  float dh = length(ndc - uHeliNdc.xy);
  float front = 1.0 - smoothstep(uHeliDist - 6.0, uHeliDist + 2.0, distance(wp, cameraPosition));
  float k = smoothstep(uHeliNdc.z * 0.5, uHeliNdc.z * 1.3, dh);
  return mix(1.0, mix(minA, 1.0, k), front);
}

float hzSech2(float q) {
  q = min(12.0, abs(q));
  float e = exp(-2.0 * q);
  float s = 2.0 * sqrt(e) / (1.0 + e);
  return s * s;
}
`;

export const FINISH = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// Base quad for instanced billboards: corner ∈ {−1, 1}².
export function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// Polar disc grid for instanced discs: position = (r01, theta, 0). Rings are denser near the rim.
export function polarDiscGeometry(rings, segs) {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= rings; j++) {
    const r = Math.pow(j / rings, 0.8);
    for (let i = 0; i <= segs; i++) pos.push(r, (i / segs) * TAU, 0);
  }
  const row = segs + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from above (+Y normal)
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Open cylinder grid: position = (theta, s 0..1, layer). Several layers stacked in one geometry.
export function cylinderGridGeometry(segs, rows, layers = 1) {
  const pos = [];
  const idx = [];
  const row = segs + 1;
  for (let l = 0; l < layers; l++) {
    const base = pos.length / 3;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= segs; i++) pos.push((i / segs) * TAU, j / rows, l);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Attach per-instance vec4 attributes (dynamic) to an InstancedBufferGeometry.
export function addInstanceAttrs(geo, names, count) {
  const out = {};
  for (const n of names) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, a);
    out[n] = a;
  }
  geo.instanceCount = 0;
  return out;
}

// Rankine vortex tangential speed with a smooth taper to 0 at the influence radius (m/s).
export function rankine(r, rc, vmax, rinf) {
  if (r >= rinf) return 0;
  const v = r < rc ? (vmax * r) / rc : (vmax * rc) / r;
  return v * (1 - smooth(0.55 * rinf, rinf, r));
}

// Compass «from» phrase for radio/HUD (direction the hazard comes FROM, as seen from the heli).
const FROM = ['с севера', 'с северо-востока', 'с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада'];
export function fromPhrase(dx, dz) {
  // bearing of the hazard from the heli: 0 = north (−Z), clockwise
  const b = Math.atan2(dx, -dz);
  const i = ((Math.round(b / (Math.PI / 4)) % 8) + 8) % 8;
  return FROM[i];
}
export function bearingDeg(dx, dz) {
  return ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360;
}

// Russian number formatting with a non-breaking space before units (DESIGN §2.14).
export const NBSP = ' ';
export function metres(d) {
  if (d >= 1000) return `${(Math.round(d / 100) / 10).toLocaleString('ru-RU')}${NBSP}КМ`;
  return `${Math.round(d / 50) * 50}${NBSP}М`;
}
