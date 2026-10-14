// Rogue wave «волна-убийца» (DESIGN §2.6.7 look in the ocean, §2.12 extras, §3.12 mechanics, §3.8 damage).
//
// The ocean draws the wave itself (`ocean.setFeature(id, {type: 'rogue', …})`: sech² wall bowed forward,
// suction trough −0.35H at 1.6W ahead, bottle-green glow, fingered foam lip, white carpet behind). Hazards
// keep the crest's position authoritative (re-set every frame), run the telegraph timeline and the impact,
// and add what lives ABOVE the water:
//   * a 500-sprite spray sheet torn off the crest (GPU-animated from the crest uniforms)
//   * a veil of torn foam streaming back over the crest (ribbon along the bowed crest line)
// Telegraph (eta measured live at the heli): T−12 radio + edge arrow «ВОЛНА!» · T−8 suction & foam streaks ·
// T−6 «ВОЛНА-УБИЙЦА · 14 М · 6 С» · T−4 camera reveal (+50 m, 26°) via hazards.imminent.
import * as THREE from 'three';
import { ROGUE, COLORS, HZ_GLSL, FINISH, quadGeometry, clamp01, smooth, lerp, rng32, fromPhrase, bearingDeg, NBSP } from './common.js';

export const MAX_ROGUE = 2;
const SHEET_PER = 500;
const VEIL_SEGS = 140;
const VEIL_ROWS = 7;

const sech2 = (q) => {
  q = Math.min(12, Math.abs(q));
  const e = Math.exp(-2 * q);
  const s = (2 * Math.sqrt(e)) / (1 + e);
  return s * s;
};

// ---- GLSL: crest frame shared by the sheet and the veil ---------------------------------------
const CREST_GLSL = /* glsl */ `
uniform vec4 uRg[${MAX_ROGUE}];  // crest centre x, z, dir x, dir z
uniform vec4 uRg2[${MAX_ROGUE}]; // height H, front width W, crest length L, visibility
uniform vec4 uRg3[${MAX_ROGUE}]; // speed, wind along dir, age, 0
float rgEnv(float v, float L) {
  float e = max(abs(v) - 0.3 * L, 0.0) / (0.12 * L);
  return exp(-e * e);
}
// world xz of the crest frame point (ue ahead of the bowed crest, v along it)
vec2 rgPoint(vec4 A, float ue, float v) {
  vec2 d = A.zw;
  vec2 perp = vec2(-d.y, d.x);
  return A.xy + d * (ue - ${ROGUE.bow.toFixed(4)} * v * v) + perp * v;
}
float rgProfile(float ue, float W) {
  return hzSech2(ue / (ue > 0.0 ? 0.55 * W : 1.3 * W));
}
// +1: spume streams ahead of the crest (wind behind the wave), −1: it trails behind
float rgStream(float windAlong) {
  float s = clamp((windAlong - 3.0) / 6.0, -1.0, 1.0);
  return abs(s) < 0.35 ? 0.35 : s;
}
`;

const SHEET_VERT = /* glsl */ `
${HZ_GLSL}
${CREST_GLSL}
attribute vec4 sp; // seed0, seed1, seed2, slot
uniform vec3 uSprayCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
varying float vFog;
void main() {
  int slot = int(sp.w + 0.5);
  vec4 A = uRg[slot];
  vec4 B = uRg2[slot];
  vec4 C = uRg3[slot];
  if (B.w <= 0.002 || sp.y > uQuality) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float life = mix(1.2, 2.4, sp.z);
  float tt = uHzTime + sp.x * life * 11.0;
  float age = mod(tt, life);
  float cyc = floor(tt / life);
  float a01 = age / life;
  float L = B.z;
  // lateral position along the crest (re-rolled every cycle), weighted to the tall middle
  float q = fract(sp.z * 7.31 + cyc * 0.6180339) * 2.0 - 1.0;
  float v = q * abs(q) * 0.5 * L * 1.1 + (fract(sp.x * 3.1 + cyc * 0.37) - 0.5) * 0.25 * L;
  float env = rgEnv(v, L);
  float H = B.x * env;
  // torn off the lip and carried by the wind: with the wind behind the wave the sheet flies ahead of
  // the crest and hangs over the dark front face (the best contrast), against it it trails behind
  float sd = rgStream(C.y);
  float rel = sd * mix(1.5, 6.5, sp.z) * (0.6 + 0.4 * env);
  float ue = 0.1 * B.y + rel * age;
  vec2 xz = rgPoint(A, ue, v);
  // blown downwind as it flies (a soft cloud of spume, not a fan of parallel strokes)
  float wr = fract(sp.y * 5.17 + cyc * 0.41);
  xz += uWind * age * mix(0.15, 0.45, wr);
  float up = mix(4.0, 10.0, sp.y) * (0.55 + 0.45 * env);
  float y = H * 0.95 + up * age - 4.0 * age * age + 0.6;
  y = max(y, H * rgProfile(ue, B.y) * env + 0.8);
  vec3 p = vec3(xz.x, y, xz.y);
  // random sizes: droplet clots to big drifting puffs
  float sr = fract(sp.x * 9.13 + cyc * 0.53);
  float size = mix(1.2, 6.5, pow(a01, 0.6)) * mix(0.35, 1.7, sr * sr) * (0.6 + 0.4 * clamp(B.x / 14.0, 0.5, 1.5));
  float alpha = mix(0.08, 0.2, wr) * B.w * smoothstep(0.08, 0.35, env) * smoothstep(0.0, 0.12, a01) * (1.0 - smoothstep(0.4, 1.0, a01));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xyz += normalize(-mv.xyz) * size * 0.5;
  float rot = sp.x * 33.0 + age;
  float cs = cos(rot), sn = sin(rot);
  vec2 c = position.xy;
  mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
  gl_Position = projectionMatrix * mv;
  vUv = c;
  // spray scatters forward: brighter than the foam it was torn from under the same grey sky
  vec3 light = hzAirLight(p, 0.8) * 0.8 + uAirFlash * 2.0;
  vCol = vec4(uSprayCol * light, alpha);
  vSeed = fract(sp.x * 17.3 + cyc * 0.29);
  vFog = hzFog(p);
}
`;

const SHEET_FRAG = /* glsl */ `
${HZ_GLSL}
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
varying float vFog;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec2 o = vec2(vSeed * 5.0, vSeed * 2.7);
  float n = texture2D(uAtlas, vUv * 0.3 + o).r * 0.65 + texture2D(uAtlas, vUv * 0.75 + o * 1.7).r * 0.35;
  // a soft volumetric puff of torn spume: noise-eroded edge, denser core, slightly self-shadowed
  float shape = 1.0 - smoothstep(0.0, 1.0, sqrt(r2));
  float a = vCol.a * shape * smoothstep(0.25, 0.75, n * 0.85 + shape * 0.4) * 1.4;
  vec3 col = vCol.rgb * (0.78 + 0.32 * n);
  col = mix(col, hzFogColor(col), vFog);
  gl_FragColor = vec4(col, clamp(a * (1.0 - 0.7 * vFog), 0.0, 1.0));
  ${FINISH}
}
`;

const VEIL_VERT = /* glsl */ `
${HZ_GLSL}
${CREST_GLSL}
attribute vec4 vq; // a (0..1 along the crest), b (0..1 back from the lip), slot, 0
varying vec3 vW;
varying vec4 vV; // v (m), back (m), env, visibility
varying vec4 vClip;
void main() {
  int slot = int(vq.z + 0.5);
  vec4 A = uRg[slot];
  vec4 B = uRg2[slot];
  vec4 C = uRg3[slot];
  float L = B.z;
  float W = B.y;
  float v = (vq.x - 0.5) * L * 1.2;
  float env = rgEnv(v, L);
  // a sheet of spume peeling off the lip and streaming with the wind, sagging as it goes
  float sd = rgStream(C.y);
  float run = vq.y * (10.0 + 0.55 * W) * (0.8 + 0.2 * sin(v * 0.05 + uHzTime * 0.9));
  float back = run;
  float ue = 0.12 * W + sd * run;
  vec2 xz = rgPoint(A, ue, v);
  float y = B.x * env * mix(0.97, 0.62, vq.y) + 1.6 + vq.y * 2.0 * (0.6 + 0.4 * sin(v * 0.11 - uHzTime * 1.7));
  y = max(y, B.x * env * rgProfile(ue, W) + 1.0);
  vec3 p = vec3(xz.x, y, xz.y);
  if (B.w <= 0.002) p.y = -500.0;
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vClip = gl_Position;
  vV = vec4(v, back, env, B.w);
}
`;

const VEIL_FRAG = /* glsl */ `
${HZ_GLSL}
uniform vec3 uFoamCol;
varying vec3 vW;
varying vec4 vV;
varying vec4 vClip;
void main() {
  float back = vV.y;
  float b01 = back / (10.0 + 0.55 * 22.0);
  // torn strands streaming back off the lip: 3 fbm octaves, elongated ≤ 2.5:1 along the stream and
  // irregular along the crest (no lace tile, no periodic fingers)
  float n1 = texture2D(uAtlas, vec2(vV.x * 0.03, back * 0.012 - uHzTime * 0.3)).r;
  float n2 = texture2D(uAtlas, vec2(vV.x * 0.075 + 0.3, back * 0.035 - uHzTime * 0.5)).r;
  float n3 = texture2D(uAtlas, vec2(vV.x * 0.009 + 0.7, back * 0.006 - uHzTime * 0.1)).r;
  float streak = smoothstep(0.45, 0.85, 0.45 * n1 + 0.2 * n2 + 0.45 * n3);
  float a = smoothstep(0.1, 0.45, vV.z) * smoothstep(0.0, 0.12, b01) * pow(1.0 - clamp(b01, 0.0, 1.0), 1.3);
  a *= (0.1 + 0.9 * streak) * 0.4 * vV.w;
  if (a <= 0.003) discard;
  vec3 col = uFoamCol * (hzAirLight(vW, 0.9) * 0.75 + uAirFlash * 1.6);
  a *= hzHeliHole(vClip, vW, 0.4);
  col = mix(col, hzFogColor(col), hzFog(vW));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  ${FINISH}
}
`;

// ---------------------------------------------------------------------------------------------
export class RogueFx {
  constructor(uniforms) {
    this.group = new THREE.Group();
    this.group.name = 'hazards.rogue';
    this.rg = Array.from({ length: MAX_ROGUE }, () => new THREE.Vector4(0, 0, 1, 0));
    this.rg2 = Array.from({ length: MAX_ROGUE }, () => new THREE.Vector4(14, 22, 500, 0));
    this.rg3 = Array.from({ length: MAX_ROGUE }, () => new THREE.Vector4(15, 0, 0, 0));
    const crestU = { uRg: { value: this.rg }, uRg2: { value: this.rg2 }, uRg3: { value: this.rg3 } };

    // spray sheet
    const qg = quadGeometry();
    const n = SHEET_PER * MAX_ROGUE;
    const seeds = new Float32Array(n * 4);
    const rnd = rng32(777);
    for (let i = 0; i < n; i++) {
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = Math.floor(i / SHEET_PER);
    }
    qg.setAttribute('sp', new THREE.InstancedBufferAttribute(seeds, 4));
    qg.instanceCount = 0;
    this.sheetMat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...crestU, uSprayCol: { value: new THREE.Color(COLORS.rogueSpray) } },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.sheet = new THREE.Mesh(qg, this.sheetMat);
    this.sheet.name = 'hazards.rogueSpray';
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 21.6;
    this.sheet.visible = false;
    this.group.add(this.sheet);

    // torn-foam veil: (segs+1) × rows grid per slot
    const pos = [];
    const vq = [];
    const idx = [];
    for (let s = 0; s < MAX_ROGUE; s++) {
      const base = pos.length / 3;
      for (let j = 0; j < VEIL_ROWS; j++) {
        for (let i = 0; i <= VEIL_SEGS; i++) {
          pos.push(0, 0, 0);
          vq.push(i / VEIL_SEGS, j / (VEIL_ROWS - 1), s, 0);
        }
      }
      const row = VEIL_SEGS + 1;
      for (let j = 0; j < VEIL_ROWS - 1; j++) {
        for (let i = 0; i < VEIL_SEGS; i++) {
          const a = base + j * row + i;
          idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        }
      }
    }
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    vg.setAttribute('vq', new THREE.Float32BufferAttribute(vq, 4));
    vg.setIndex(idx);
    this.veilMat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...crestU, uFoamCol: { value: new THREE.Color(COLORS.foam) } },
      vertexShader: VEIL_VERT,
      fragmentShader: VEIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.veil = new THREE.Mesh(vg, this.veilMat);
    this.veil.name = 'hazards.rogueVeil';
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 16;
    this.veil.visible = false;
    this.group.add(this.veil);
    this.used = new Array(MAX_ROGUE).fill(false);
  }

  alloc() {
    for (let i = 0; i < MAX_ROGUE; i++) {
      if (!this.used[i]) {
        this.used[i] = true;
        this.rg2[i].w = 0;
        return i;
      }
    }
    return -1;
  }

  free(i) {
    if (i >= 0) {
      this.used[i] = false;
      this.rg2[i].w = 0;
    }
  }

  clear() {
    for (let i = 0; i < MAX_ROGUE; i++) this.free(i);
    this.pack();
  }

  set(i, w, windAlong) {
    if (i < 0) return;
    this.rg[i].set(w.origin.x, w.origin.y, w.dir.x, w.dir.y);
    this.rg2[i].set(w.height, w.width, w.length, w.visual);
    this.rg3[i].set(w.speed, windAlong, w.age, 0);
  }

  pack() {
    let max = -1;
    for (let i = 0; i < MAX_ROGUE; i++) if (this.used[i] && this.rg2[i].w > 0.002) max = i;
    this.sheet.geometry.instanceCount = (max + 1) * SHEET_PER;
    this.sheet.visible = max >= 0;
    this.veil.visible = max >= 0;
  }

  warmup(on) {
    this.sheet.visible = this.veil.visible = on;
    this.sheet.geometry.instanceCount = on ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------------------------
export class Rogue {
  // opts: {x, z (target point the crest passes, default: the heli), dir (Vector2|{x,z}) | fromDeg, height,
  //        eta | telegraph (s until the crest reaches the target), speed, length, width, target:'heli',
  //        offset (lateral m of the target from the crest centre), name, scripted}
  constructor(hz, opts = {}) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.id = hz.nextId();
    this.type = 'rogue';
    this.label = 'ВОЛНА-УБИЙЦА';
    const rnd = rng32(opts.seed ?? hz.seedFor(this.id));
    this.speed = Number(opts.speed) || ROGUE.speed;
    this.width = Number(opts.width) || ROGUE.width;
    this.length = Number(opts.length) || ROGUE.length;
    this.height = Number(opts.height) || Math.round(lerp(ROGUE.height[0], ROGUE.height[1], rnd()));
    this.telegraph = Number(opts.eta ?? opts.telegraph) || ROGUE.telegraph;
    this.scripted = !!opts.scripted;
    this.name = opts.name || null;
    // travel direction: given, from a bearing («fromDeg» = where it comes FROM), or the wind ±20°
    this.dir = new THREE.Vector2();
    if (opts.dir && Number.isFinite(opts.dir.x)) {
      const dz = opts.dir.isVector3 ? opts.dir.z : opts.dir.y ?? opts.dir.z;
      this.dir.set(opts.dir.x, dz);
    } else if (Number.isFinite(opts.fromDeg)) {
      const b = (opts.fromDeg * Math.PI) / 180; // bearing it comes from: travel = opposite
      this.dir.set(-Math.sin(b), Math.cos(b));
    } else {
      const wd = hz.env.windDir;
      const a = Math.atan2(wd.z, wd.x) + (rnd() - 0.5) * 0.7;
      this.dir.set(Math.cos(a), Math.sin(a));
    }
    if (this.dir.lengthSq() < 1e-6) this.dir.set(1, 0);
    this.dir.normalize();
    // place the crest so that it reaches the target after `telegraph` seconds
    const hp = hz.heliPos;
    const tx = Number.isFinite(opts.x) ? opts.x : hp.x;
    const tz = Number.isFinite(opts.z) ? opts.z : hp.z;
    const off = Number.isFinite(opts.offset) ? opts.offset : (rnd() - 0.5) * 120;
    const d = this.speed * this.telegraph;
    const px = -this.dir.y;
    const pz = this.dir.x;
    this.origin = new THREE.Vector2(tx - this.dir.x * d - px * off, tz - this.dir.y * d - pz * off);
    this.position = new THREE.Vector3(tx, 0, tz); // crest point nearest the heli (updated every frame)
    this.velocity = new THREE.Vector3(this.dir.x * this.speed, 0, this.dir.y * this.speed);
    this.radius = this.length * 0.5;
    this.crest = { origin: this.origin, dir: this.dir, length: this.length, width: this.width, bow: ROGUE.bow, height: this.height };
    this.age = 0;
    this.eta = this.telegraph;
    this.threat = 0; // 0..1 how much of the crest will reach the heli (envelope at the heli)
    this.visual = 0;
    this.alive = true;
    this.stage = 'radio';
    this.flags = { radio: false, suction: false, warning: false, reveal: false, hit: false, passed: false };
    this.featureId = `hz-${this.id}`;
    this.fxSlot = hz.rogueFx.alloc();
    this._ue = Infinity;
    this._crossed = new Map(); // survivor → last ue (crest passing over floating groups)
    this._push();
  }

  // Crest frame of a world point: ue (> 0 ahead of the crest), v (along the crest), envelope.
  frame(x, z, out) {
    const rx = x - this.origin.x;
    const rz = z - this.origin.y;
    const u = rx * this.dir.x + rz * this.dir.y;
    const v = -rx * this.dir.y + rz * this.dir.x;
    const L = this.length;
    const e = Math.max(Math.abs(v) - 0.3 * L, 0) / (0.12 * L);
    out.ue = u + ROGUE.bow * v * v;
    out.v = v;
    out.env = Math.exp(-e * e);
    return out;
  }

  // Rogue part of the sea height at a point (m) — same profile as the ocean feature (Eulerian approx).
  lift(x, z) {
    const f = this.frame(x, z, this._f || (this._f = {}));
    const W = this.width;
    const prof = sech2(f.ue / (f.ue > 0 ? 0.55 * W : 1.3 * W));
    const sk = (f.ue - 1.6 * W) / (0.9 * W);
    return this.height * this.visual * f.env * (prof - 0.35 * Math.exp(-sk * sk));
  }

  // Surface drift: a push along the travel direction under the crest (≈ 8 m for a 14 m wave) and a pull
  // towards the suction trough ahead of it. Survivors add their own scripted 40 m carry when the crest
  // lifts a group (survivors.js ROGUE_SWEEP), so this stays the gentle part: flotsam, dye, everything else.
  addFlow(x, z, out) {
    const f = this.frame(x, z, this._f2 || (this._f2 = {}));
    if (f.env < 0.01 || f.ue < -4 * this.width || f.ue > 4 * this.width) return;
    const W = this.width;
    const U = 3.0 * Math.sqrt(this.height / 14) * f.env * this.visual;
    const bump = sech2(f.ue / (f.ue > 0 ? 0.55 * W : 1.3 * W));
    const sk = (f.ue - 1.6 * W) / (0.9 * W);
    const s = U * (bump - 0.22 * Math.exp(-sk * sk));
    out.x += this.dir.x * s;
    out.y += this.dir.y * s;
  }

  danger(x, z, alt) {
    const f = this.frame(x, z, this._f3 || (this._f3 = {}));
    if (f.ue < -this.width) return 0;
    const eta = Math.max(0, f.ue / this.speed);
    const crestTop = this.height * f.env;
    const reach = alt - 1.6 < crestTop + 3 ? 1 : 0.35;
    return clamp01(f.env * (1 - eta / 14) * reach * this.visual);
  }

  // ----------------------------------------------------------------------------------------------
  update(dt, env) {
    if (!this.alive) return;
    const hz = this.hz;
    this.age += dt;
    this.origin.x += this.dir.x * this.speed * dt;
    this.origin.y += this.dir.y * this.speed * dt;
    this.visual = Math.min(1, this.age / 1.5);

    // heli frame → eta / threat / nearest crest point
    const hp = hz.heliPos;
    const f = this.frame(hp.x, hp.z, this._fh || (this._fh = {}));
    const vClamp = Math.max(-this.length * 0.6, Math.min(this.length * 0.6, f.v));
    const px = -this.dir.y;
    const pz = this.dir.x;
    const ueC = -ROGUE.bow * vClamp * vClamp;
    this.position.set(this.origin.x + this.dir.x * ueC + px * vClamp, 0, this.origin.y + this.dir.y * ueC + pz * vClamp);
    this.eta = f.ue > 0 ? f.ue / this.speed : 0;
    this.threat = f.env;
    this.velocity.set(this.dir.x * this.speed, 0, this.dir.y * this.speed);

    if (env.playing && hz.heliAlive) this._telegraph(f);
    if (env.playing && hz.heliAlive && !hz.heliLanded) this._impact(f); // a parked heli rides its deck
    this._sweep();

    // crest passed far beyond the heli → let the ocean turn it into the lace scar
    if (f.ue < -650 || this.age > this.telegraph + 70) {
      this.alive = false;
      return;
    }
    this._ue = f.ue;
    this._push(env);
  }

  _push(env) {
    const hz = this.hz;
    hz.ocean?.setFeature?.(this.featureId, {
      type: 'rogue', origin: this.origin, dir: this.dir, speed: this.speed, height: this.height,
      length: this.length, width: this.width, strength: this.visual,
    });
    const w = env ? env.wind : null;
    const along = w ? w.x * this.dir.x + w.z * this.dir.y : 0;
    hz.rogueFx.set(this.fxSlot, this, along);
  }

  _telegraph(f) {
    const hz = this.hz;
    const fl = this.flags;
    const reaches = f.env > 0.15 && f.ue > 0;
    const eta = this.eta;
    const hp = hz.heliPos;
    const dx = this.position.x - hp.x;
    const dz = this.position.z - hp.z;
    const from = fromPhrase(-this.dir.x, -this.dir.y);
    const base = {
      type: 'rogue', hazard: this, position: this.position, height: this.height, dir: this.dir, from,
      bearing: bearingDeg(dx, dz), distance: Math.hypot(dx, dz),
    };
    if (!fl.radio && reaches && eta <= this.telegraph + 0.5) {
      fl.radio = true;
      this.stage = 'radio';
      hz.warn({ ...base, eta, stage: 'radio', level: 'caution', text: 'ВОЛНА!', detail: `${from.toUpperCase()}`, edge: true, scripted: this.scripted, name: this.name });
    }
    if (!fl.suction && reaches && eta <= 8) {
      fl.suction = true;
      this.stage = 'suction';
      hz.warn({ ...base, eta, stage: 'suction', level: 'caution', text: 'ВОЛНА!', detail: 'ОТСОС', edge: true });
    }
    if (!fl.warning && reaches && eta <= 6) {
      fl.warning = true;
      this.stage = 'warning';
      hz.warn({
        ...base, eta, stage: 'warning', level: 'danger',
        text: `ВОЛНА-УБИЙЦА · ${this.height}${NBSP}М · ${Math.max(1, Math.round(eta))}${NBSP}С`, detail: from.toUpperCase(),
      });
    }
    if (!fl.reveal && reaches && eta <= 4) {
      fl.reveal = true;
      this.stage = 'reveal';
      hz.warn({
        ...base, eta, stage: 'reveal', level: 'danger',
        text: `ВОЛНА-УБИЙЦА · ${this.height}${NBSP}М · ${Math.max(1, Math.round(eta))}${NBSP}С`, detail: from.toUpperCase(),
      });
    }
  }

  // Impact (DESIGN §3.8): skids below the passing crest → 20 % + 6 % per 5 m of overlap, thrown 18 m/s
  // along the wave, intake flooded (heli: thrust ×0.6 for 3 s on a 'rogue' damage source).
  _impact(f) {
    const hz = this.hz;
    const fl = this.flags;
    const W = this.width;
    if (!fl.passed && this._ue > 0 && f.ue <= 0) {
      fl.passed = true;
      this.stage = 'passed';
      const top = this.height * f.env;
      hz.emit('hazard:pass', { hazard: this, type: 'rogue', clearance: hz.heliPos.y - 1.6 - (hz.baseSeaAt(hz.heliPos.x, hz.heliPos.z) + top) });
    }
    // judged as the wall arrives (front ~0.6 W away), with the heli's climb until the crest is under it:
    // the heli's own surface clamp would otherwise lift it up the face before the impact is measured
    if (fl.hit || f.env < 0.08 || f.ue > 0.6 * W || f.ue < -0.35 * W) return;
    const hp = hz.heliPos;
    const crestTop = hz.baseSeaAt(hp.x, hp.z) + this.height * f.env * this.visual;
    const tArrive = Math.max(0, f.ue) / this.speed;
    const skid = hp.y - 1.6 + Math.max(0, hz.heliVel.y) * tArrive;
    const overlap = crestTop - skid;
    if (overlap <= 0) return;
    fl.hit = true;
    const dmg = ROGUE.damage + ROGUE.damagePer5m * Math.floor(overlap / 5);
    hz.hitHeli(dmg, 'rogue', { type: 'rogue', overlap, x: hp.x, z: hp.z, hazard: this });
    const imp = hz._imp || (hz._imp = new THREE.Vector3());
    imp.set(this.dir.x * ROGUE.knock, 4, this.dir.y * ROGUE.knock);
    hz.heliImpulse(imp, 3);
  }

  // Floating groups the crest passes over: survivors may capsize rafts (their rule), lens spray, etc.
  _sweep() {
    const list = this.ctx.survivors?.list;
    if (!list || !list.length) return;
    const f = this._fs || (this._fs = {});
    for (const s of list) {
      if (!s || !s.position || s.state === 'rescued' || s.state === 'lost') continue;
      this.frame(s.position.x, s.position.z, f);
      const prev = this._crossed.get(s);
      if (prev !== undefined && prev > 0 && f.ue <= 0 && f.env > 0.2) {
        this.hz.emit('hazard:crest', { hazard: this, type: 'rogue', survivor: s, x: s.position.x, z: s.position.z, height: this.height * f.env });
      }
      this._crossed.set(s, f.ue);
    }
  }

  dispose() {
    this.hz.ocean?.removeFeature?.(this.featureId);
    this.hz.rogueFx.free(this.fxSlot);
    this.fxSlot = -1;
    this.alive = false;
  }
}
