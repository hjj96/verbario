// Gust-front streaks (DESIGN §2.12 «Фронт порыва» [MUST], §3.12 «Порыв», §4 #28): 40–80 ribbon
// strokes (#E8EEF0, α .12, 20–60 m) gliding AHEAD of every gust front, on top of the ocean's
// «cat's paws». The fronts come from weather.state.gustFronts (the same data that pushes the heli);
// with a stub weather the `weather:gust` event spawns a local copy.
//
// All motion happens in the vertex shader: each streak cycles (1.4–3 s) through «draw on → glide →
// fade», re-seeded every cycle at a new spot inside the band ahead of the front.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, quadGeometry, rng32, smooth } from './common.js';

const SLOTS = 4;
const PER = 80;

const VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 aG;  // slot, rank 0..1, period factor, phase
attribute vec4 aG2; // random: along, lateral, length, height
uniform vec4 uF[${SLOTS}];  // centre x, z, dir x, dir z
uniform vec4 uF2[${SLOTS}]; // strength 0..1 (fade), speed, age, visible count fraction
uniform vec4 uF3[${SLOTS}]; // width, length, seed, unused
uniform vec3 uLight;
varying vec2 vQ;
varying float vA;
varying vec3 vC;
varying float vSeed;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  int s = int(aG.x + 0.5);
  vec4 F = uF[0]; vec4 F2 = uF2[0]; vec4 F3 = uF3[0];
  if (s == 1) { F = uF[1]; F2 = uF2[1]; F3 = uF3[1]; }
  else if (s == 2) { F = uF[2]; F2 = uF2[2]; F3 = uF3[2]; }
  else if (s == 3) { F = uF[3]; F2 = uF2[3]; F3 = uF3[3]; }
  if (F2.x <= 0.001 || aG.y > F2.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float period = 1.4 + 1.6 * aG.z;
  float tt = F2.z / period + aG.w;
  float cyc = floor(tt);
  float ph = tt - cyc; // 0..1 within this streak's life
  float sd = F3.z + cyc * 7.13 + aG.y * 91.7;
  float rA = fract(aG2.x + h1(sd));
  float rL = fract(aG2.y + h1(sd + 1.7));
  float rLen = fract(aG2.z + h1(sd + 3.1));
  float rH = fract(aG2.w + h1(sd + 5.3));

  vec2 dir = F.zw;
  vec2 lat = vec2(-dir.y, dir.x);
  float W = F3.x;
  float Lm = F3.y;
  // ahead of the band (leading edge at +W/2), gaussian-ish across the 500 m front
  float along = W * (0.35 + 1.0 * rA) + F2.y * 0.18 * ph * period;
  float g = (rL - 0.5) * 2.0;
  float across = g * abs(g) * Lm * 0.42;
  float len = mix(20.0, 60.0, rLen) * smoothstep(0.0, 0.35, ph);
  vec2 head = F.xy + dir * along + lat * across;
  float y = uSeaLevel + 0.55 * uHs + 1.6 + 5.0 * rH;

  // ribbon: corner.y −1 → tail, +1 → head; expanded across in screen space (≥ 1.2 px)
  vec3 ph3 = vec3(head.x, y, head.y);
  vec3 pt3 = vec3(head.x - dir.x * len, y, head.y - dir.y * len);
  vec4 ch = projectionMatrix * viewMatrix * vec4(ph3, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(pt3, 1.0);
  vec2 hr = uResolution * 0.5;
  vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * hr;
  float l = length(d);
  vec2 sdir = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 perp = vec2(-sdir.y, sdir.x);
  vec4 c = position.y > 0.0 ? ch : ct;
  float pxPerM = projectionMatrix[1][1] * hr.y / max(c.w, 0.5);
  // a fine brush stroke: ~0.35 m wide at the head, thinning to a hair at the tail
  float wpx = max(2.0, 0.5 * pxPerM) * (position.y > 0.0 ? 1.0 : 0.5);
  c.xy += perp * position.x * wpx * 0.5 / hr * c.w;
  gl_Position = c;
  vQ = position.xy;
  vSeed = fract(sd * 0.137);
  float env = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.6, 1.0, ph));
  float fog = fxFog(ph3);
  // DESIGN α .12 is the average over a stroke's life; the peak is brighter so the telegraph reads
  vA = 0.3 * F2.x * env * (1.0 - fog) * (0.7 + 0.6 * rH);
  vC = uLight + uAirFlash * 1.5;
}
`;
const FRAG = /* glsl */ `
${LOOK_GLSL_UNIFORMS}
varying vec2 vQ;
varying float vA;
varying vec3 vC;
varying float vSeed;
void main() {
  float across = 1.0 - vQ.x * vQ.x;
  float along = sin(3.14159 * (vQ.y * 0.5 + 0.5));
  // a dry-brush stroke: brighter head, ragged broken tail
  float u = vQ.y * 0.5 + 0.5;
  float rag = texture2D(uAtlas, vec2(u * 0.35 + vSeed * 7.0, vSeed * 3.0 + vQ.x * 0.02)).r;
  float stroke = mix(0.45, 1.0, u) * smoothstep(0.12 + 0.3 * (1.0 - u), 0.55, rag + 0.25 * u);
  gl_FragColor = vec4(vC, vA * across * along * stroke);
  ${FINISH}
}
`;

export class GustStreaks {
  constructor(look, air) {
    const g = quadGeometry();
    const r = rng32(5521);
    const a = new Float32Array(SLOTS * PER * 4);
    const b = new Float32Array(SLOTS * PER * 4);
    for (let s = 0; s < SLOTS; s++) {
      for (let i = 0; i < PER; i++) {
        const k = (s * PER + i) * 4;
        a[k] = s;
        a[k + 1] = (i + 0.5) / PER; // rank → visible count
        a[k + 2] = r();
        a[k + 3] = r();
        b[k] = r();
        b[k + 1] = r();
        b[k + 2] = r();
        b[k + 3] = r();
      }
    }
    g.setAttribute('aG', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aG2', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = SLOTS * PER;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const v4 = () => [0, 1, 2, 3].map(() => new THREE.Vector4());
    this.uF = v4();
    this.uF2 = v4();
    this.uF3 = v4();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        ...look.uniforms,
        ...air,
        uF: { value: this.uF },
        uF2: { value: this.uF2 },
        uF3: { value: this.uF3 },
        uLight: { value: new THREE.Color(COLORS.streak) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx.gustStreaks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.visible = false;

    // slot bookkeeping: which weather front object owns a slot
    this.owner = new Array(SLOTS).fill(null);
    this.ownerAge = new Float32Array(SLOTS);
    this.local = []; // fallback fronts (stub weather): { x, z, dirX, dirZ, strength, baseStrength, speed, width, length, age, alive }
    for (let i = 0; i < SLOTS; i++) {
      this.local.push({ x: 0, z: 0, dirX: 1, dirZ: 0, strength: 0, baseStrength: 0, speed: 10, width: 140, length: 500, age: 0, fade: 0, alive: false });
    }
    this._list = [];
    this._seed = 1;
    this._streakCol = new THREE.Color(COLORS.streak);
  }

  // Fallback when weather does not publish gustFronts (stub weather): emulate the front locally.
  onGust(e, windSpeed) {
    if (!e) return;
    const f = this.local.find((x) => !x.alive) || this.local[0];
    const dl = Math.hypot(e.dir?.x ?? 1, e.dir?.y ?? 0) || 1;
    f.dirX = (e.dir?.x ?? 1) / dl;
    f.dirZ = (e.dir?.y ?? 0) / dl;
    f.baseStrength = e.strength ?? 8;
    f.speed = Math.max(4, (windSpeed || 6) + f.baseStrength);
    const eta = e.eta ?? 6;
    f.x = (e.x ?? 0) - (Number.isFinite(e.x) ? 0 : f.dirX * f.speed * eta);
    f.z = (e.z ?? 0) - (Number.isFinite(e.z) ? 0 : f.dirZ * f.speed * eta);
    f.width = 140;
    f.length = 500;
    f.age = 0;
    f.alive = true;
  }

  // fronts: weather.state.gustFronts (array or undefined). light: Color (ambient on the streaks).
  update(dt, fronts, light) {
    let list = fronts;
    if (!Array.isArray(list)) {
      // advance local fallback fronts
      list = this._list;
      list.length = 0;
      for (const f of this.local) {
        if (!f.alive) continue;
        f.age += dt;
        f.x += f.dirX * f.speed * dt;
        f.z += f.dirZ * f.speed * dt;
        f.fade = Math.min(1, f.age / 1.2) * (1 - smooth(14, 20, f.age));
        f.strength = f.baseStrength * f.fade;
        if (f.age > 20) f.alive = false;
        else list.push(f);
      }
    }
    // release slots whose front is gone or recycled (age went backwards)
    for (let i = 0; i < SLOTS; i++) {
      const o = this.owner[i];
      if (!o) continue;
      if (!list.includes(o) || !o.alive && o.alive !== undefined || (o.age ?? 0) + 0.25 < this.ownerAge[i]) this.owner[i] = null;
    }
    for (const f of list) {
      if (!f || !(f.strength > 0 || f.baseStrength > 0)) continue;
      if (this.owner.includes(f)) continue;
      const free = this.owner.indexOf(null);
      if (free < 0) break;
      this.owner[free] = f;
      this.uF3[free].z = (this._seed = (this._seed * 16807) % 2147483647) % 1000;
    }
    let any = false;
    for (let i = 0; i < SLOTS; i++) {
      const f = this.owner[i];
      if (!f) {
        this.uF2[i].x = 0;
        continue;
      }
      this.ownerAge[i] = f.age ?? 0;
      const base = f.baseStrength ?? f.strength ?? 0;
      const fade = f.fade ?? (base > 0 ? (f.strength ?? 0) / base : 0);
      // visible streak count 40–80 by gust strength
      const count = (40 + 40 * smooth(4, 13, base)) / PER;
      this.uF[i].set(f.x, f.z, f.dirX, f.dirZ);
      this.uF2[i].set(Math.min(1, fade) * smooth(1.5, 5, base), f.speed ?? 15, f.age ?? 0, count);
      this.uF3[i].x = f.width ?? 140;
      this.uF3[i].y = f.length ?? 500;
      if (this.uF2[i].x > 0.001) any = true;
    }
    this.mesh.visible = any;
    if (any) this.material.uniforms.uLight.value.copy(this._streakCol).multiply(light).multiplyScalar(1.6);
  }

  clear() {
    for (const f of this.local) f.alive = false;
    this.owner.fill(null);
    for (const v of this.uF2) v.x = 0;
    this.mesh.visible = false;
  }
}
