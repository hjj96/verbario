// Human light in a cold sea (DESIGN §1.1 «Свет — это жизнь», §2.10 signals, §2.7.1 pooled lights):
//
//  * Glows  — instanced additive sprites (HDR core + halo, round or 4-point star) for flare cores,
//             rocket stars and lightning impact stars. Always carry their own halo, so they read on
//             low quality without bloom (DESIGN §2.8).
//  * Rings  — additive light rings on the water (lightning impact shock ring).
//  * Signals — player flares burning 40 s on the water (12–18 Hz flicker of a pooled red PointLight,
//             smoke lit red, sparks, glint) and red parachute rockets (up to 80 m in 2.5 s, 2 m/s down
//             for 25 s swaying at 0.5 Hz, a pooled light tinting sea & clouds within 120 m).
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, quadGeometry, smooth, toColor } from './common.js';
import { F_TWINKLE, F_STRETCH } from './particles.js';

const MAX_GLOWS = 32;
const MAX_RINGS = 4;

// --------------------------------------------------------------------------------------------------
const GLOW_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 iP; // pos.xyz, core size (m)
attribute vec4 iC; // colour rgb (core tint), intensity
attribute vec4 iH; // halo size (m), halo intensity, kind (0 round, 1 star), rotation
attribute vec3 iHc; // halo colour
varying vec2 vUv;
varying vec3 vCore;
varying vec3 vHalo;
varying float vCoreF;
varying float vKind;
void main() {
  vec4 mv = viewMatrix * vec4(iP.xyz, 1.0);
  float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5);
  float halo = max(iH.x * 0.5, 7.0 / pxPerM);
  float core = max(iP.w * 0.5, 1.6 / pxPerM);
  float dim = min(1.0, (iP.w * 0.5) / core);
  float cs = cos(iH.w), sn = sin(iH.w);
  vec2 c = position.xy;
  mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * halo;
  // pull towards the camera a little so the sprite never sinks into a wave
  mv.xyz += normalize(-mv.xyz) * min(halo * 0.5, 3.0);
  gl_Position = projectionMatrix * mv;
  vUv = c;
  float fog = fxFog(iP.xyz);
  float k = 1.0 - 0.55 * fog;
  vCore = iC.rgb * iC.a * k * (0.35 + 0.65 * dim);
  vHalo = iHc * iH.y * k;
  vCoreF = core / halo;
  vKind = iH.z;
}
`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCore;
varying vec3 vHalo;
varying float vCoreF;
varying float vKind;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float rc = r / max(vCoreF, 1e-3);
  float core = exp(-rc * rc * 2.2);
  float halo = exp(-r * r * 5.0) * (1.0 - r) + 0.25 * exp(-r * r * 22.0);
  vec3 col = vCore * core + vHalo * halo;
  if (vKind > 0.5) {
    // 4-point star: thin rays along the sprite axes
    float ray = exp(-abs(vUv.y) / (vCoreF * 0.35)) * exp(-abs(vUv.x) * 2.2)
              + exp(-abs(vUv.x) / (vCoreF * 0.35)) * exp(-abs(vUv.y) * 2.2);
    col += vCore * ray * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
  ${FINISH}
}
`;

export class Glows {
  constructor(look, air) {
    const g = quadGeometry();
    this.P = new Float32Array(MAX_GLOWS * 4);
    this.C = new Float32Array(MAX_GLOWS * 4);
    this.H = new Float32Array(MAX_GLOWS * 4);
    this.Hc = new Float32Array(MAX_GLOWS * 3);
    for (const [n, arr, s] of [['iP', this.P, 4], ['iC', this.C, 4], ['iH', this.H, 4], ['iHc', this.Hc, 3]]) {
      const a = new THREE.InstancedBufferAttribute(arr, s);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(n, a);
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), ...look.uniforms, ...air },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx.glows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 28;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  // core: Color (HDR multiplied by `intensity`), halo: Color × haloI.
  add(x, y, z, coreSize, core, intensity, haloSize, halo, haloI, kind = 0, rot = 0) {
    if (this.n >= MAX_GLOWS) return;
    const i = this.n++;
    this.P[i * 4] = x; this.P[i * 4 + 1] = y; this.P[i * 4 + 2] = z; this.P[i * 4 + 3] = coreSize;
    this.C[i * 4] = core.r; this.C[i * 4 + 1] = core.g; this.C[i * 4 + 2] = core.b; this.C[i * 4 + 3] = intensity;
    this.H[i * 4] = haloSize; this.H[i * 4 + 1] = haloI; this.H[i * 4 + 2] = kind; this.H[i * 4 + 3] = rot;
    this.Hc[i * 3] = halo.r; this.Hc[i * 3 + 1] = halo.g; this.Hc[i * 3 + 2] = halo.b;
  }

  end() {
    const g = this.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    for (const k of ['iP', 'iC', 'iH', 'iHc']) {
      const a = g.attributes[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// --------------------------------------------------------------------------------------------------
const RING_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 iR;  // x, z, radius, width
attribute vec4 iRc; // rgb, intensity
varying vec2 vXZ;
varying vec4 vR;
varying vec4 vRc;
void main() {
  float ext = iR.z + iR.w * 3.0;
  vec3 wp = vec3(iR.x + position.x * ext, uSeaLevel + 0.6 + 0.4 * uHs, iR.y + position.y * ext);
  vXZ = position.xy * ext;
  vR = iR;
  vRc = vec4(iRc.rgb, iRc.a * (1.0 - 0.6 * fxFog(wp)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
${LOOK_GLSL_UNIFORMS}
varying vec2 vXZ;
varying vec4 vR;
varying vec4 vRc;
void main() {
  float r = length(vXZ);
  float d = (r - vR.z) / max(vR.w, 0.1);
  float n = texture2D(uAtlas, vXZ * 0.05 + vR.xy * 0.01).r;
  float a = exp(-d * d) * (0.6 + 0.8 * n) + exp(-r * r / (vR.z * vR.z * 0.15 + 1.0)) * 0.15;
  gl_FragColor = vec4(vRc.rgb * vRc.a * a, 1.0);
  ${FINISH}
}
`;

export class Rings {
  constructor(look, air) {
    const g = quadGeometry();
    this.R = new Float32Array(MAX_RINGS * 4);
    this.Rc = new Float32Array(MAX_RINGS * 4);
    for (const [n, arr] of [['iR', this.R], ['iRc', this.Rc]]) {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(n, a);
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), ...look.uniforms, ...air },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx.rings';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.list = [];
    for (let i = 0; i < MAX_RINGS; i++) this.list.push({ alive: false, x: 0, z: 0, t: 0, life: 0.7, r0: 2, r1: 30, w: 2, col: new THREE.Color(), I: 1 });
  }

  spawn(x, z, r1, life, color, intensity) {
    const s = this.list.find((r) => !r.alive) || this.list.reduce((a, b) => (a.t > b.t ? a : b));
    s.alive = true;
    s.x = x;
    s.z = z;
    s.t = 0;
    s.life = life;
    s.r1 = r1;
    s.I = intensity;
    toColor(color, s.col);
  }

  clear() {
    for (const r of this.list) r.alive = false;
  }

  update(dt) {
    let n = 0;
    for (const r of this.list) {
      if (!r.alive) continue;
      r.t += dt;
      if (r.t >= r.life) {
        r.alive = false;
        continue;
      }
      const k = r.t / r.life;
      const e = 1 - Math.pow(1 - k, 2.2);
      const rad = 1.5 + (r.r1 - 1.5) * e;
      this.R[n * 4] = r.x;
      this.R[n * 4 + 1] = r.z;
      this.R[n * 4 + 2] = rad;
      this.R[n * 4 + 3] = 1 + rad * 0.12;
      this.Rc[n * 4] = r.col.r;
      this.Rc[n * 4 + 1] = r.col.g;
      this.Rc[n * 4 + 2] = r.col.b;
      this.Rc[n * 4 + 3] = r.I * (1 - k) * (1 - k);
      n++;
    }
    const g = this.geometry;
    g.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) {
      for (const k of ['iR', 'iRc']) {
        const a = g.attributes[k];
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
    }
  }
}

// --------------------------------------------------------------------------------------------------
// Presets for the particles the signals emit (constant objects, no allocation).
const P_FLARE_SMOKE = { drag: 0.9, accY: 0.7, wind: 0.8, flags: 0, emissive: 0, spin: 0.4 };
const P_EMBER = { drag: 1.2, accY: -3.5, wind: 0.4, flags: F_TWINKLE | F_STRETCH, emissive: 1, spin: 0 };
const P_TRAIL = { drag: 0.6, accY: 0.4, wind: 0.6, flags: 0, emissive: 0, spin: 0.3 };

const MAX_FLARES = 8;
const MAX_ROCKETS = 4;
const FLARE_LIFE = 40;
const ROCKET_RISE = 2.5;
const ROCKET_DESCENT = 25;

export class Signals {
  // fx: Effects (pools, lights, glows, ocean access)
  constructor(fx) {
    this.fx = fx;
    this.flares = [];
    for (let i = 0; i < MAX_FLARES; i++) {
      this.flares.push({ alive: false, x: 0, y: 0, z: 0, t: 0, life: FLARE_LIFE, seed: 0, light: null, smokeAcc: 0, sparkAcc: 0, flick: 1 });
    }
    this.rockets = [];
    for (let i = 0; i < MAX_ROCKETS; i++) {
      this.rockets.push({ alive: false, x: 0, y: 0, z: 0, x0: 0, y0: 0, z0: 0, t: 0, light: null, trailAcc: 0, seed: 0, color: new THREE.Color(COLORS.rocket) });
    }
    this.cFlare = new THREE.Color(COLORS.flare);
    this.cFlareCore = new THREE.Color(COLORS.flareCore);
    this.cFlareLight = new THREE.Color(COLORS.flareLight);
    this.cSmoke = new THREE.Color('#D2CAC6');
    this.cSmokeEnd = new THREE.Color('#9C9692');
    this.cEmber = new THREE.Color('#FF7A3A').multiplyScalar(7);
    this.cRocketCore = new THREE.Color('#FFE6DA');
    this.cTrail = new THREE.Color('#E8E4E0');
    this.cTmp = new THREE.Color();
  }

  flare(x, z, opts = {}) {
    let f = this.flares.find((k) => !k.alive);
    if (!f) f = this.flares.reduce((a, b) => (a.t > b.t ? a : b));
    if (f.light) f.light.release();
    f.alive = true;
    f.x = x;
    f.z = z;
    f.y = this.fx.seaHeight(x, z);
    f.t = 0;
    f.life = opts.life ?? FLARE_LIFE;
    f.seed = Math.random() * 100;
    f.smokeAcc = 0;
    f.sparkAcc = 0;
    f.light = this.fx.acquireLight(this.cFlareLight, 0, 62);
    // ignition pop
    this.fx.sparks(x, f.y + 0.3, z, '#FF9A60', 14);
    return f;
  }

  rocket(x, y, z, opts = {}) {
    let r = this.rockets.find((k) => !k.alive);
    if (!r) r = this.rockets.reduce((a, b) => (a.t > b.t ? a : b));
    if (r.light) r.light.release();
    r.alive = true;
    r.x0 = x;
    r.z0 = z;
    r.y0 = Number.isFinite(y) && y > 0.5 ? y : this.fx.seaHeight(x, z) + 0.5;
    r.x = x;
    r.y = r.y0;
    r.z = z;
    r.t = 0;
    r.seed = Math.random() * 100;
    r.trailAcc = 0;
    toColor(opts.color ?? COLORS.rocket, r.color);
    r.light = this.fx.acquireLight(r.color, 0, 210);
    this.fx.sparks(x, r.y0 + 0.5, z, '#FFB070', 10);
    return r;
  }

  clear() {
    for (const f of this.flares) {
      f.alive = false;
      if (f.light) f.light.release();
      f.light = null;
    }
    for (const r of this.rockets) {
      r.alive = false;
      if (r.light) r.light.release();
      r.light = null;
    }
  }

  get activeFlares() {
    return this.flares.filter((f) => f.alive);
  }

  update(dt, wind, reduceFlashes, night) {
    const fx = this.fx;
    const glows = fx.glows;
    const t = fx.t;
    const flickAmp = reduceFlashes ? 0.08 : 0.24;
    const ocean = fx.ctx.ocean;

    for (const f of this.flares) {
      if (!f.alive) continue;
      f.t += dt;
      if (f.t >= f.life) {
        f.alive = false;
        f.light?.release();
        f.light = null;
        continue;
      }
      // drift slowly with the wind (leeway) and bob on the surface
      f.x += wind.x * 0.03 * dt;
      f.z += wind.y * 0.03 * dt;
      f.y = fx.seaHeight(f.x, f.z);
      // 12–18 Hz flicker (two incommensurate tones + a little noise), sputter at the end
      const ph = t + f.seed;
      let flick = 1 - flickAmp + flickAmp * (0.55 * Math.sin(ph * 2 * Math.PI * 12.7) + 0.45 * Math.sin(ph * 2 * Math.PI * 17.3 + 1.3)) + (Math.random() - 0.5) * flickAmp * 0.4;
      const ign = smooth(0, 0.6, f.t);
      const end = 1 - smooth(f.life - 3, f.life, f.t);
      if (f.life - f.t < 3 && !reduceFlashes) flick *= 0.6 + 0.4 * (Math.random() < 0.75 ? 1 : 0.2);
      const I = ign * end * Math.max(0, flick);
      f.flick = I;
      if (f.light) {
        f.light.position.set(f.x, f.y + 1.3, f.z);
        f.light.set(1100 * I);
      }
      // core + halo
      glows.add(f.x, f.y + 0.35, f.z, 0.55, this.cFlareCore, 16 * I, 9, this.cFlare, 2.4 * I * (0.6 + 0.4 * night), 0);
      ocean?.addGlint?.(f.x, f.z, 6, 1.8 * I, this.cFlare);
      if (dt > 0) {
        // smoke lit red by its own light, trailing with the wind
        f.smokeAcc += dt * 7 * end;
        while (f.smokeAcc >= 1) {
          f.smokeAcc -= 1;
          fx.pools.smoke.emit(
            t, f.x + (Math.random() - 0.5) * 0.4, f.y + 0.6, f.z + (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4,
            5 + Math.random() * 2.5, 0.8, 6 + Math.random() * 2.5, this.cSmoke, 0.42, this.cSmokeEnd, P_FLARE_SMOKE,
          );
        }
        f.sparkAcc += dt * 5 * I;
        while (f.sparkAcc >= 1) {
          f.sparkAcc -= 1;
          fx.pools.glow.emit(
            t, f.x, f.y + 0.4, f.z,
            (Math.random() - 0.5) * 2.4, 2 + Math.random() * 3, (Math.random() - 0.5) * 2.4,
            0.35 + Math.random() * 0.5, 0.12, 0.08, this.cEmber, 1, this.cEmber, P_EMBER,
          );
        }
      }
    }

    for (const r of this.rockets) {
      if (!r.alive) continue;
      r.t += dt;
      const total = ROCKET_RISE + ROCKET_DESCENT;
      if (r.t >= total) {
        r.alive = false;
        r.light?.release();
        r.light = null;
        continue;
      }
      let I;
      if (r.t < ROCKET_RISE) {
        const k = r.t / ROCKET_RISE;
        r.y = r.y0 + 80 * (1 - (1 - k) * (1 - k));
        r.x = r.x0 + wind.x * 0.15 * r.t;
        r.z = r.z0 + wind.y * 0.15 * r.t;
        I = 0.35 + 0.25 * k;
        // smoky trail of the motor
        if (dt > 0) {
          r.trailAcc += dt * 26;
          while (r.trailAcc >= 1) {
            r.trailAcc -= 1;
            const back = Math.random() * 1.5;
            fx.pools.smoke.emit(
              t, r.x, r.y - back, r.z, (Math.random() - 0.5) * 0.6, -0.5, (Math.random() - 0.5) * 0.6,
              2.5 + Math.random() * 2, 0.5, 3.5, this.cTrail, 0.35, this.cSmokeEnd, P_TRAIL,
            );
          }
        }
      } else {
        const td = r.t - ROCKET_RISE;
        // parachute: 2 m/s down, drifting with the wind, swaying at 0.5 Hz
        r.y = r.y0 + 80 - 2 * td;
        r.x += wind.x * 0.9 * dt;
        r.z += wind.y * 0.9 * dt;
        const wl = Math.hypot(wind.x, wind.y) || 1;
        const sway = Math.sin(2 * Math.PI * 0.5 * td + r.seed) * 1.6;
        const sx = (-wind.y / wl) * sway;
        const sz = (wind.x / wl) * sway;
        const pop = td < 0.3 ? 1.6 - 2 * td : 1;
        const end = 1 - smooth(ROCKET_DESCENT - 2.5, ROCKET_DESCENT, td);
        const flick = reduceFlashes ? 1 : 0.93 + 0.07 * Math.sin(t * 2 * Math.PI * 9.1 + r.seed) * Math.sin(t * 2 * Math.PI * 3.3);
        I = pop * end * flick;
        r.sx = sx;
        r.sz = sz;
        if (dt > 0 && end > 0.05) {
          r.trailAcc += dt * 3;
          while (r.trailAcc >= 1) {
            r.trailAcc -= 1;
            fx.pools.smoke.emit(
              t, r.x + sx, r.y - 0.6, r.z + sz, 0, -0.3, 0,
              4 + Math.random() * 2, 0.7, 4, this.cTrail, 0.22, this.cSmokeEnd, P_TRAIL,
            );
          }
        }
      }
      const px = r.x + (r.sx || 0);
      const pz = r.z + (r.sz || 0);
      if (r.light) {
        r.light.position.set(px, r.y, pz);
        r.light.set((r.t < ROCKET_RISE ? 500 : 4200) * I);
      }
      const core = r.t < ROCKET_RISE ? 6 : 22;
      glows.add(px, r.y, pz, r.t < ROCKET_RISE ? 0.5 : 1.0, this.cRocketCore, core * I, r.t < ROCKET_RISE ? 5 : 16, r.color, (r.t < ROCKET_RISE ? 1 : 3) * I, r.t < ROCKET_RISE ? 0 : 1, t * 0.3);
      if (r.t >= ROCKET_RISE) ocean?.addGlint?.(px, pz, 20, 1.1 * I, r.color);
    }
  }
}
