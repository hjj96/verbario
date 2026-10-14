// GPU particle pools (DESIGN §2.13, §2.9 damage smoke, §2.10 signals).
//
// A pool is ONE instanced draw call. The CPU only writes a particle once, at birth (ring buffer,
// partial buffer uploads); the vertex shader integrates everything analytically:
//   * drag towards the local air (wind × windFollow) with gravity / buoyancy:
//       p(t) = p0 + vT·t + (v0 − vT)·(1 − e^{−kt})/k,  vT = w + (0, accY/k, 0)
//   * optional swirl in the rotor downwash (damage smoke curls around the heli, DESIGN §4 #4)
//   * size / colour / alpha over life, velocity stretch for sparks, ≥ 1.2 px minimum size
//   * lighting of scattering media: ambient + sun + lightning flash + searchlight cone + pooled lights
//     (flare smoke glows red, spray sparkles ×4 in the beam)
// Kinds: 'spray' (alpha, droplet puffs), 'smoke' (alpha, soft eroding puffs), 'glow' (additive sparks,
// embers, bioluminescent sparkles).
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, fogUniforms, quadGeometry } from './common.js';

// Behaviour flags (bit field in iE.w).
export const F_SWIRL = 1; // curls in the rotor downwash
export const F_STRETCH = 2; // stretched along the screen-space velocity
export const F_TWINKLE = 4; // glow flicker
export const F_FLOAT = 8; // never sinks below the sea surface (drifting smoke at the water line)
export const F_BIO = 16; // bioluminescent: only visible at night, teal

const ATTRS = ['iA', 'iB', 'iC', 'iD', 'iE', 'iF'];

const VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 iA; // p0.xyz, birth time
attribute vec4 iB; // v0.xyz, life
attribute vec4 iC; // size0, size1 (diameters, m), rotation, spin
attribute vec4 iD; // colour rgb (linear, may be HDR), alpha
attribute vec4 iE; // drag k, accY, windFollow, flags
attribute vec4 iF; // end colour rgb, emissive 0..1
uniform float uFadeIn, uFadeOut, uGrowth, uStretch, uBeamGain, uLightGain, uSunGain, uPush;
varying vec2 vUv;
varying vec4 vCol;
varying float vAge;
varying float vSeed;
varying float vFog;
varying vec2 vSun;

bool hasFlag(float flags, float bit) { return mod(floor(flags / bit), 2.0) > 0.5; }

void main() {
  float age = uFxTime - iA.w;
  float life = iB.w;
  if (life <= 0.0 || age < 0.0 || age >= life || iA.w < uKillBefore) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float a01 = age / life;
  float k = max(iE.x, 0.05);
  float flags = iE.w;
  vec3 w = vec3(uWind.x, 0.0, uWind.y) * iE.z;
  vec3 vT = w + vec3(0.0, iE.y / k, 0.0);
  float ek = exp(-k * age);
  vec3 p = iA.xyz + vT * age + (iB.xyz - vT) * ((1.0 - ek) / k);
  vec3 vel = vT + (iB.xyz - vT) * ek;

  if (hasFlag(flags, ${F_SWIRL.toFixed(1)}) && uDownwash.w > 0.01) {
    vec2 d = p.xz - uDownwash.xy;
    float R = max(uDownwash.z, 4.0);
    float s = uDownwash.w * exp(-dot(d, d) / (R * R * 1.4)) * (1.0 - smoothstep(uHeliP.y + 2.0, uHeliP.y + 12.0, p.y));
    float ang = 1.5 * s * age;
    float cs = cos(ang), sn = sin(ang);
    d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) * (1.0 + 0.45 * s * age);
    p.xz = uDownwash.xy + d;
    p.y -= 4.5 * s * age;
    p.y = max(p.y, uSeaLevel + 0.4 + 0.35 * uHs);
  }
  if (hasFlag(flags, ${F_FLOAT.toFixed(1)})) p.y = max(p.y, uSeaLevel + 0.25 + 0.3 * uHs);

  float size = 0.5 * mix(iC.x, iC.y, pow(a01, uGrowth));
  float alpha = iD.a * smoothstep(0.0, uFadeIn, a01) * (1.0 - smoothstep(uFadeOut, 1.0, a01));

  vec4 mv = viewMatrix * vec4(p, 1.0);
  // cheap "soft particle": slide the billboard towards the camera so it does not slice the waves
  mv.xyz += normalize(-mv.xyz) * size * uPush;
  float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.1);
  float minR = 0.6 / pxPerM; // ≥ 1.2 px diameter
  if (size < minR) { alpha *= size / minR; size = minR; }

  vec2 corner = position.xy;
  vec2 off;
  if (hasFlag(flags, ${F_STRETCH.toFixed(1)})) {
    vec2 sv = (viewMatrix * vec4(vel, 0.0)).xy;
    float sl = length(sv);
    vec2 dir = sl > 1e-3 ? sv / sl : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size + sl * uStretch;
    off = dir * corner.x * len + perp * corner.y * size;
    alpha *= min(1.0, size / len * 1.6);
  } else {
    float r = iC.z + iC.w * age;
    float cs = cos(r), sn = sin(r);
    off = vec2(cs * corner.x - sn * corner.y, sn * corner.x + cs * corner.y) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vUv = corner;

  // colour over life + lighting (scattering media) / emission
  vec3 col = mix(iD.rgb, iF.rgb, a01);
  vec3 light = uAirAmb + uAirSun * uSunGain + uAirFlash * 1.6
             + vec3(1.0, 0.945, 0.855) * fxBeam(p) * uBeamGain
             + fxPointLights(p) * uLightGain;
  col *= mix(light, vec3(1.0), iF.w);
  if (hasFlag(flags, ${F_TWINKLE.toFixed(1)})) {
    float tw = 0.55 + 0.45 * sin(uFxTime * (19.0 + 13.0 * fract(iA.w * 7.31)) + iA.w * 31.0);
    col *= tw;
  }
  if (hasFlag(flags, ${F_BIO.toFixed(1)})) alpha *= smoothstep(0.45, 0.9, uAirNight);
  vCol = vec4(col, alpha);
  vAge = a01;
  vSeed = fract(iA.w * 3.7 + iA.x * 0.013 + iA.z * 0.017);
  vFog = fxFog(p);
  // sun direction in the billboard plane (fake volume lighting of smoke)
  vec3 sv3 = (viewMatrix * vec4(uAirSunDir, 0.0)).xyz;
  vSun = sv3.xy;
}
`;

const FRAG = {
  spray: /* glsl */ `
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    vec2 o = vec2(vSeed * 7.0, vSeed * 3.3);
    float n = texture2D(uAtlas, vUv * 0.28 + o).r;
    float dots = smoothstep(0.78, 0.97, texture2D(uAtlas, vUv * 0.85 + o * 1.7).a);
    float body = pow(1.0 - r2, 1.6) * (0.35 + 0.9 * n) * (1.0 - 0.55 * vAge);
    float a = vCol.a * (body + dots * (1.0 - r2) * 0.9);
    vec3 col = mix(vCol.rgb, fogColorOr(vCol.rgb), vFog);
    gl_FragColor = vec4(col, clamp(a * (1.0 - 0.7 * vFog), 0.0, 1.0));
  `,
  smoke: /* glsl */ `
    float r = length(vUv);
    if (r > 1.0) discard;
    vec2 o = vec2(vSeed * 5.0, vSeed * 2.1);
    vec2 drift = vec2(0.05, 0.11) * vAge;
    float n = texture2D(uAtlas, vUv * 0.32 + o + drift).r;
    float n2 = texture2D(uAtlas, vUv * 0.75 + o * 1.3 - drift).g;
    float shape = 1.0 - smoothstep(0.15, 1.0, r);
    // older puffs get torn into wisps
    float erosion = smoothstep(0.2 + 0.55 * vAge, 0.7 + 0.3 * vAge, n * 0.9 + shape * 0.5);
    float dens = shape * erosion * (0.65 + 0.7 * (1.0 - n2)) * (1.0 - 0.45 * vAge);
    // fake volume: the sun-facing side of the puff is brighter
    vec3 nrm = normalize(vec3(vUv, sqrt(max(0.0, 1.0 - r * r))));
    float lit = 0.72 + 0.4 * clamp(dot(nrm.xy, normalize(vSun + 1e-4)) * length(vSun), -1.0, 1.0);
    vec3 col = vCol.rgb * lit * (0.85 + 0.3 * n);
    col = mix(col, fogColorOr(col), vFog);
    gl_FragColor = vec4(col, clamp(vCol.a * dens * (1.0 - 0.6 * vFog), 0.0, 1.0));
  `,
  glow: /* glsl */ `
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 4.5) + 0.8 * exp(-r2 * 28.0);
    gl_FragColor = vec4(vCol.rgb * a * vCol.a * (1.0 - 0.85 * vFog), 1.0);
  `,
};

const FRAG_HEAD = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
varying vec2 vUv;
varying vec4 vCol;
varying float vAge;
varying float vSeed;
varying float vFog;
varying vec2 vSun;
vec3 fogColorOr(vec3 c) {
#ifdef USE_FOG
  return fogColor;
#else
  return c;
#endif
}
`;

// Per-kind material defaults.
const KIND = {
  spray: { blending: THREE.NormalBlending, fadeIn: 0.05, fadeOut: 0.55, growth: 0.6, push: 0.6, beam: 4.0, light: 0.5, sun: 0.5 },
  smoke: { blending: THREE.NormalBlending, fadeIn: 0.05, fadeOut: 0.3, growth: 0.5, push: 0.5, beam: 2.0, light: 0.6, sun: 0.55 },
  glow: { blending: THREE.AdditiveBlending, fadeIn: 0.02, fadeOut: 0.5, growth: 1.0, push: 0.2, beam: 0.0, light: 0.0, sun: 0.0 },
};

export class ParticlePool {
  // look: core/look.js instance; air: shared air uniforms; maxCapacity: buffer size (high quality)
  constructor(name, kind, look, air, maxCapacity) {
    this.name = name;
    this.kind = kind;
    this.max = maxCapacity;
    this.capacity = maxCapacity;
    this.head = 0;
    this.air = air;
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
    this.wrapped = false;
    this.emitted = 0;

    const g = quadGeometry();
    this.arrays = {};
    for (const a of ATTRS) {
      const arr = new Float32Array(maxCapacity * 4);
      const attr = new THREE.InstancedBufferAttribute(arr, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(a, attr);
      this.arrays[a] = arr;
    }
    // every slot starts dead (life 0)
    g.instanceCount = maxCapacity;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;

    const K = KIND[kind];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        ...look.uniforms,
        ...air,
        uFadeIn: { value: K.fadeIn },
        uFadeOut: { value: K.fadeOut },
        uGrowth: { value: K.growth },
        uStretch: { value: 0.06 },
        uBeamGain: { value: K.beam },
        uLightGain: { value: K.light },
        uSunGain: { value: K.sun },
        uPush: { value: K.push },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_HEAD + `void main() {\n${FRAG[kind]}\n${FINISH}\n}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      depthTest: true,
      blending: K.blending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = `fx.${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = kind === 'glow' ? 23 : 21;
  }

  setCapacity(n) {
    n = Math.max(16, Math.min(this.max, n | 0));
    if (n === this.capacity) return;
    this.capacity = n;
    this.geometry.instanceCount = n;
    this.head = 0;
    // kill everything (cheap: life = 0 everywhere, full upload once)
    this.arrays.iB.fill(0);
    this._markAll();
  }

  _markAll() {
    this.dirtyLo = 0;
    this.dirtyHi = this.max - 1;
  }

  // Write one particle. col / col2: THREE.Color (linear; may be HDR). preset: constant object
  // { drag, accY, wind, flags, emissive, spin } defined once per effect type.
  emit(t, x, y, z, vx, vy, vz, life, size0, size1, col, alpha, col2, preset, rot = Math.random() * 6.283) {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    const o = i * 4;
    const A = this.arrays;
    A.iA[o] = x; A.iA[o + 1] = y; A.iA[o + 2] = z; A.iA[o + 3] = t;
    A.iB[o] = vx; A.iB[o + 1] = vy; A.iB[o + 2] = vz; A.iB[o + 3] = life;
    A.iC[o] = size0; A.iC[o + 1] = size1; A.iC[o + 2] = rot; A.iC[o + 3] = (preset.spin || 0) * (Math.random() * 2 - 1);
    A.iD[o] = col.r; A.iD[o + 1] = col.g; A.iD[o + 2] = col.b; A.iD[o + 3] = alpha;
    A.iE[o] = preset.drag; A.iE[o + 1] = preset.accY; A.iE[o + 2] = preset.wind; A.iE[o + 3] = preset.flags || 0;
    const c2 = col2 || col;
    A.iF[o] = c2.r; A.iF[o + 1] = c2.g; A.iF[o + 2] = c2.b; A.iF[o + 3] = preset.emissive || 0;
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    this.emitted++;
  }

  // Upload the slots written this frame (one contiguous range; a wrap-around marks the whole span).
  flush() {
    if (this.dirtyHi < 0) return;
    const start = this.dirtyLo * 4;
    const count = (this.dirtyHi - this.dirtyLo + 1) * 4;
    for (const a of ATTRS) {
      const attr = this.geometry.attributes[a];
      attr.clearUpdateRanges();
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
    }
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
