// Shared pieces of the FX system (DESIGN §2.11–§2.13, §8.2): quality budgets, fixed source colours,
// the "air lighting" uniform block every scattering medium reads (rain, spray, smoke, scud, streaks),
// fog helpers for custom shaders and tiny math utilities.
import * as THREE from 'three';

// --- budgets per quality (DESIGN §8.2) ---------------------------------------------------------
export const QUALITY = {
  low: {
    rain: 2000, motes: 0, downwash: 200, crest: 0, crestProbes: 0, splash: 220, smoke: 260, glow: 260,
    scud: 4, fogLayers: 2, gulls: 8, seaSmoke: false, dolphins: 0, jelly: 0,
  },
  medium: {
    rain: 5000, motes: 160, downwash: 350, crest: 150, crestProbes: 15, splash: 320, smoke: 460, glow: 520,
    scud: 8, fogLayers: 2, gulls: 16, seaSmoke: true, dolphins: 4, jelly: 40,
  },
  high: {
    rain: 9000, motes: 320, downwash: 600, crest: 300, crestProbes: 30, splash: 420, smoke: 720, glow: 900,
    scud: 14, fogLayers: 3, gulls: 24, seaSmoke: true, dolphins: 5, jelly: 70,
  },
};
export const qualityOf = (settings) => (QUALITY[settings?.get?.('quality')] ? settings.get('quality') : 'high');

// --- fixed source colours (DESIGN §2.4; never blended with the palette) ------------------------
export const COLORS = {
  rain: '#B9C7CD',
  bolt: '#FFFFFF',
  boltHalo: '#C7D6FF',
  boltHaloDay: '#DCE6FF',
  cloudLit: '#6A7BA8', // scud lit from inside by in-cloud lightning (§2.7.3)
  flare: '#FF2A12', // hand flare
  flareCore: '#FFF4E8',
  flareLight: '#FF3A1E', // pooled light of flares (§2.7.1)
  rocket: '#FF3A22',
  bio: '#35E0FF', // bioluminescence
  smokeOrange: '#FF7B2E',
  smokeOrangeEnd: '#E8A27A',
  streak: '#E8EEF0', // gust-front streaks (§2.12)
  spray: '#E4ECEE',
  steam: '#C8D0D4',
  gull: '#F4F4F0',
  gullTip: '#23272A',
  searchlight: '#FFF1DA',
  elmo: '#7FB8FF',
};

const _c = new THREE.Color();
// Parse a colour (string / hex / Color) into `out` (linear working space). Tiny cache for strings.
const cache = new Map();
export function toColor(c, out) {
  if (c && c.isColor) return out.copy(c);
  if (typeof c === 'string') {
    let v = cache.get(c);
    if (!v) {
      v = new THREE.Color(c);
      if (cache.size < 256) cache.set(c, v);
    }
    return out.copy(v);
  }
  if (typeof c === 'number') return out.setHex(c);
  return out.setRGB(1, 1, 1);
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// Hue/saturation test for "this smoke colour is a signal orange" (survivor day smoke).
export function isOrange(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (max < 0.05 || (max - min) / max < 0.55) return false;
  return c.r >= max - 1e-6 && c.b < 0.5 * c.r && c.g > 0.08 * c.r && c.g < 0.75 * c.r;
}

// Lightning stroke envelope (DESIGN §2.8 flash): three return strokes.
export function strokeEnvelope(t) {
  let f = Math.exp(-t * 14);
  if (t > 0.11) f += 0.75 * Math.exp(-(t - 0.11) * 10);
  if (t > 0.23) f += 0.45 * Math.exp(-(t - 0.23) * 7);
  return Math.min(1, f);
}
// reduceFlashes: one soft pulse (attack 120 ms, decay 600 ms).
export function softEnvelope(t) {
  if (t < 0) return 0;
  if (t < 0.12) {
    const k = t / 0.12;
    return k * k * (3 - 2 * k);
  }
  const d = (t - 0.12) / 0.6;
  if (d >= 1) return 0;
  const k = 1 - d;
  return k * k * (3 - 2 * k);
}

// --- shared "air lighting" uniforms --------------------------------------------------------------
// One object, updated once per frame by Effects; every FX material spreads it into its uniforms
// (same objects → no per-material upload logic).
export function createAirUniforms() {
  const v4 = () => [0, 1, 2, 3].map(() => new THREE.Vector4());
  return {
    uAirAmb: { value: new THREE.Color(0.2, 0.22, 0.24) }, // ambient light on scattering media (linear)
    uAirSun: { value: new THREE.Color(0, 0, 0) }, // sun/moon colour × intensity (linear)
    uAirSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAirFlash: { value: new THREE.Color(0, 0, 0) }, // flash colour × flash
    uAirNight: { value: 0 },
    uBeamPos: { value: new THREE.Vector4(0, 0, 0, 0) }, // searchlight origin xyz, w = level 0..1
    uBeamDir: { value: new THREE.Vector4(0, -1, 0, 0.97) }, // dir xyz, w = cos(outer)
    uBeamLen: { value: 30 },
    uFxLightPos: { value: v4() }, // pooled PointLights: xyz, w = intensity (cd)
    uFxLightCol: { value: v4() }, // rgb (linear), w = range (m)
    uFxTime: { value: 0 }, // fx clock (game seconds; frozen while paused)
    uKillBefore: { value: -1 }, // particles born before this time are dead (mission reset)
    uHeliP: { value: new THREE.Vector4(0, 40, 0, 0) }, // heli xyz, w = alive
    uDownwash: { value: new THREE.Vector4(0, 0, 9, 0) }, // x, z, radius, strength
    uSeaLevel: { value: 0 }, // mean surface height near the focus (≈ 0)
    uHs: { value: 0.4 },
  };
}

export const AIR_GLSL = /* glsl */ `
uniform vec3 uAirAmb;
uniform vec3 uAirSun;
uniform vec3 uAirSunDir;
uniform vec3 uAirFlash;
uniform float uAirNight;
uniform vec4 uBeamPos;
uniform vec4 uBeamDir;
uniform float uBeamLen;
uniform vec4 uFxLightPos[4];
uniform vec4 uFxLightCol[4];
uniform float uFxTime;
uniform float uKillBefore;
uniform vec4 uHeliP;
uniform vec4 uDownwash;
uniform float uSeaLevel;
uniform float uHs;

// 0..1: how much a point sits inside the heli searchlight cone (soft edge, range-limited).
float fxBeam(vec3 p) {
  if (uBeamPos.w <= 0.001) return 0.0;
  vec3 d = p - uBeamPos.xyz;
  float l = length(d);
  float c = dot(d, uBeamDir.xyz) / max(l, 1e-3);
  float edge = smoothstep(uBeamDir.w, mix(uBeamDir.w, 1.0, 0.45), c);
  float range = 1.0 - smoothstep(uBeamLen + 2.0, uBeamLen + 12.0, l);
  return uBeamPos.w * edge * range;
}

// Irradiance from the pooled point lights (flares, rocket, lightning glow, rig flare).
vec3 fxPointLights(vec3 p) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 lp = uFxLightPos[i];
    if (lp.w <= 0.0) continue;
    vec3 d = lp.xyz - p;
    float dd = dot(d, d);
    float r = uFxLightCol[i].w;
    float win = clamp(1.0 - dd / (r * r), 0.0, 1.0);
    s += uFxLightCol[i].rgb * (lp.w / max(dd, 4.0)) * win * win;
  }
  return s;
}

// Fog factor of the patched top-down fog (core/look.js) for a world position: horizontal distance from
// the point under the screen centre + height falloff. Use for additive materials (fade) or manual mixes.
float fxFog(vec3 wp) {
#ifdef USE_FOG
  vec3 off = wp - cameraPosition;
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  float hd = length(off.xz - focus);
  float f = smoothstep(fogNear, fogFar, hd);
  return f * (1.0 - 0.6 * smoothstep(30.0, 140.0, wp.y));
#else
  return 0.0;
#endif
}

// World point under the screen centre (same as the fog focus).
vec2 fxFocus() {
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  return cameraPosition.xz + fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
}

float fxHash(float n) { return fract(sin(n) * 43758.5453123); }
vec2 fxHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

// Fog uniform declarations for the fragment/vertex stage (the patched chunks only declare them in
// their own pars; we need them in both stages for fxFog()).
export const FOG_PARS = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
#endif
`;

export const FINISH = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// Uniforms for `fog: true` ShaderMaterials (three writes fogColor/fogNear/fogFar into them).
export function fogUniforms() {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

// Base quad for instanced billboards / ribbons: corner.x ∈ {−1, 1}, corner.y ∈ {−1, 1}.
export function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// Deterministic small RNG (mulberry32) for effect layouts.
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

export { _c as _scratchColor };
