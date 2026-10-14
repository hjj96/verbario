// Life at sea (DESIGN §2.11, §3.10 «Чайки», §4 #32 #42):
//
//  Gulls [SHOULD]   V-meshes #F4F4F0 with dark wing tips, cast shadows. 3–5 birds circle at ~20 m over
//                   every survivor group nobody has found yet (survivors.list: state 'hidden', or
//                   'drifting' = a rocket / EPIRB gave only an approximate fix) in calm / overcast /
//                   clearing — a silent hint. They leave DOWNWIND ~60 s before a storm (weather.forecast)
//                   and come back after it («всё кончилось»), scatter from a low heli, flee hazards,
//                   keep their noses into the wind. One ambient flock wanders on the title / debrief.
//                   Wing flap is a vertex rotation (instanced attribute), also in the shadow pass.
//  Dolphins [NICE]  a pod porpoising across the view in calm daylight (medium / high).
//  Whale [NICE]     now and then in calm water (day or moonlit night): a dark back breaks the surface,
//                   blows a mist column, cruises leaving a slick, then dives flukes-up.
//  Jellyfish [NICE] faint teal / violet pulses under the surface on calm nights.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, quadGeometry, rng32, smooth, clamp01 } from './common.js';

const GULL_PRESETS = new Set(['calm', 'overcast', 'clearing']);
// Not found yet: 'hidden', or 'drifting' (a rocket / EPIRB gave an approximate fix, nobody has seen them).
const unseen = (s) => s.state === 'hidden' || (s.state === 'drifting' && !s.spotted);
const HINGE = 0.08;

// ---------------------------------------------------------------------------------------------------
// Gull geometry: nose towards −Z, wings along ±X (span ≈ 2.3 m, perceptual scale like the survivors).
function gullGeometry() {
  const P = [];
  const C = [];
  const white = new THREE.Color(COLORS.gull);
  const grey = new THREE.Color('#C9CED0');
  const tip = new THREE.Color(COLORS.gullTip);
  const tri = (a, b, c, ca, cb = ca, cc = ca) => {
    P.push(...a, ...b, ...c);
    C.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };
  for (const s of [1, -1]) {
    const v = (x, y, z) => [x * s, y, z];
    const rootL = v(HINGE, 0, -0.13), rootT = v(HINGE, 0, 0.17);
    const elbL = v(0.46, 0.07, -0.15), elbT = v(0.43, 0.07, 0.21);
    const wriL = v(0.86, 0.02, -0.04), wriT = v(0.78, 0.02, 0.24);
    const tipL = v(1.16, -0.03, 0.12), tipT = v(1.04, -0.03, 0.28);
    tri(rootL, rootT, elbT, white);
    tri(rootL, elbT, elbL, white);
    tri(elbL, elbT, wriT, white, white, grey);
    tri(elbL, wriT, wriL, white, grey, grey);
    tri(wriL, wriT, tipT, tip);
    tri(wriL, tipT, tipL, tip);
  }
  // body (diamond with a raised spine), head, tail fan
  const nose = [0, 0.03, -0.46], tail = [0, 0.01, 0.34], l = [-HINGE, 0, 0.0], r = [HINGE, 0, 0.0], top = [0, 0.085, -0.06];
  tri(nose, l, top, white);
  tri(nose, top, r, white);
  tri(top, l, tail, white);
  tri(top, tail, r, white);
  tri([-0.1, 0.01, 0.3], [0.1, 0.01, 0.3], [0, 0.01, 0.52], white);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  const s = 1.0;
  g.scale(s, s, s);
  return g;
}

// Wing flap: rotate wing vertices about the body axis (inner panel by a, outer by 1.35a).
const FLAP_HEAD = /* glsl */ `
attribute float iFlap;
vec3 gullFlap(vec3 p, float a) {
  float ax = abs(p.x);
  if (ax <= ${HINGE.toFixed(3)} + 0.001) return p;
  float sg = sign(p.x);
  float d = ax - ${HINGE.toFixed(3)};
  float d1 = min(d, 0.38);
  float d2 = max(d - 0.38, 0.0);
  float a2 = a * 1.35 - 0.05;
  vec2 q = vec2(cos(a), sin(a)) * d1 + vec2(cos(a2), sin(a2)) * d2;
  return vec3(sg * (${HINGE.toFixed(3)} + q.x), p.y + q.y, p.z);
}
`;

function patchFlap(shader, withNormal) {
  shader.vertexShader = FLAP_HEAD + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  transformed = gullFlap(transformed, iFlap);',
  );
  if (withNormal) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
  if (abs(position.x) > ${HINGE.toFixed(3)} + 0.001) {
    float ga = iFlap * sign(position.x);
    objectNormal.xy = vec2(cos(ga) * objectNormal.x - sin(ga) * objectNormal.y, sin(ga) * objectNormal.x + cos(ga) * objectNormal.y);
  }`,
    );
  }
}

export class Gulls {
  constructor(fx, maxBirds) {
    this.fx = fx;
    this.ctx = fx.ctx;
    this.max = maxBirds;
    this.limit = maxBirds;
    const geo = gullGeometry();
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxBirds), 1);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iFlap', this.flapAttr);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => patchFlap(sh, true);
    mat.customProgramCacheKey = () => 'fx.gull';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (sh) => patchFlap(sh, false);
    depth.customProgramCacheKey = () => 'fx.gullDepth';
    this.mesh = new THREE.InstancedMesh(geo, mat, maxBirds);
    this.mesh.name = 'fx.gulls';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.customDepthMaterial = depth;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.birds = [];
    for (let i = 0; i < maxBirds; i++) {
      this.birds.push({
        on: false, flock: null, x: 0, y: 20, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, bank: 0,
        phase: Math.random() * 6.28, amp: 0.1, burst: 0, burstT: 2 + Math.random() * 4,
        ang: 0, rad: 15, alt: 20, w: 0.35, seed: Math.random(),
      });
    }
    this.flocks = []; // { anchor (survivor|null), cx, cz, state: 'circle'|'leave'|'flee', t, fleeT, birds: [] }
    this.allowed = true;
    this.scanT = 0;
    this.gateT = 0;
    this.leftAnnounced = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1.35, 1.35, 1.35); // perceptual scale (≈ 3.1 m span reads at H 150)
    this._ids = new Set();
  }

  setLimit(n) {
    this.limit = Math.max(0, Math.min(this.max, n));
  }

  clear() {
    for (const b of this.birds) {
      b.on = false;
      b.flock = null;
    }
    this.flocks.length = 0;
    this.mesh.count = 0;
    this.leftAnnounced = false;
  }

  // scatter flocks near (x, z) (hazard warnings)
  scare(x, z, radius = 500) {
    for (const f of this.flocks) {
      if (Math.hypot(f.cx - x, f.cz - z) < radius) this._leave(f, x, z);
    }
  }

  _leave(f, fromX, fromZ) {
    if (f.state === 'leave') return;
    f.state = 'leave';
    f.t = 0;
    f.fromX = fromX;
    f.fromZ = fromZ;
  }

  _freeBird() {
    let used = 0;
    for (const b of this.birds) if (b.on) used++;
    if (used >= this.limit) return null;
    return this.birds.find((b) => !b.on) || null;
  }

  _spawnFlock(anchor, cx, cz, n, wind, farStart) {
    const f = { anchor, cx, cz, state: 'circle', t: 0, fleeT: 0, birds: [], fromX: 0, fromZ: 0 };
    const wl = Math.hypot(wind.x, wind.y) || 1;
    for (let i = 0; i < n; i++) {
      const b = this._freeBird();
      if (!b) break;
      b.on = true;
      b.flock = f;
      b.rad = 7 + Math.random() * 10;
      b.alt = 17 + Math.random() * 7;
      b.ang = Math.random() * Math.PI * 2;
      b.w = (0.28 + Math.random() * 0.22) * (Math.random() < 0.5 ? -1 : 1);
      if (farStart) {
        // come back from downwind, spread out
        const d = 380 + Math.random() * 160;
        b.x = cx + (wind.x / wl) * d + (Math.random() - 0.5) * 120;
        b.z = cz + (wind.y / wl) * d + (Math.random() - 0.5) * 120;
        b.y = 40 + Math.random() * 15;
      } else {
        b.x = cx + Math.cos(b.ang) * b.rad;
        b.z = cz + Math.sin(b.ang) * b.rad;
        b.y = b.alt;
      }
      b.vx = -Math.sin(b.ang) * 9 * Math.sign(b.w);
      b.vz = Math.cos(b.ang) * 9 * Math.sign(b.w);
      b.vy = 0;
      f.birds.push(b);
    }
    this.flocks.push(f);
    return f;
  }

  // Is the weather gull weather now and for the next minute?
  _gate(st, weather) {
    if (!GULL_PRESETS.has(st.preset) || (st.night ?? 0) > 0.6 || (st.intensity ?? 0) > 0.45) return false;
    const fc = weather?.forecast?.();
    if (Array.isArray(fc)) {
      for (const e of fc) {
        if (e && e.in <= 60 && !GULL_PRESETS.has(e.preset)) return false;
      }
    }
    return true;
  }

  update(dt, st, wind, focus, heli) {
    const ctx = this.ctx;
    if (!(dt > 0)) {
      this._write();
      return;
    }
    // weather gate (2 Hz)
    this.gateT -= dt;
    if (this.gateT <= 0) {
      this.gateT = 0.5;
      const was = this.allowed;
      this.allowed = this._gate(st, ctx.weather);
      if (was && !this.allowed) {
        let seen = false;
        for (const f of this.flocks) {
          if (f.state !== 'leave') this._leave(f, f.cx - wind.x, f.cz - wind.y);
          if (Math.hypot(f.cx - focus.x, f.cz - focus.z) < 450) seen = true;
        }
        if (seen && !this.leftAnnounced) {
          this.leftAnnounced = true;
          ctx.events.emit('fx:gulls', { state: 'leave' });
        }
      } else if (!was && this.allowed) {
        this.leftAnnounced = false;
        this._returning = true;
      }
    }

    // anchors: hidden survivors (1 Hz)
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1;
      this._scan(wind);
    }

    // flocks: follow anchors, scatter from the heli
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.t += dt;
      if (f.anchor && f.anchor.position) {
        f.cx = f.anchor.position.x;
        f.cz = f.anchor.position.z;
      } else if (!f.anchor && f.state === 'circle') {
        // ambient flock wanders slowly near the camera focus
        f.cx += (focus.x + 40 * Math.sin(f.t * 0.05) - f.cx) * Math.min(1, dt * 0.05);
        f.cz += (focus.z - 30 + 30 * Math.cos(f.t * 0.04) - f.cz) * Math.min(1, dt * 0.05);
      }
      if (f.state === 'circle' && heli.alive) {
        const d = Math.hypot(heli.x - f.cx, heli.z - f.cz);
        if (d < 34 && heli.alt < 50) {
          f.state = 'flee';
          f.fleeT = 6 + Math.random() * 3;
        }
      } else if (f.state === 'flee') {
        f.fleeT -= dt;
        const d = Math.hypot(heli.x - f.cx, heli.z - f.cz);
        if (f.fleeT <= 0 && (d > 45 || heli.alt > 55)) f.state = 'circle';
      }
      // drop finished flocks
      let alive = 0;
      for (const b of f.birds) if (b.on) alive++;
      if (!alive) this.flocks.splice(i, 1);
    }

    for (const b of this.birds) if (b.on) this._fly(b, dt, wind, focus, heli);
    this._write();
  }

  _scan(wind) {
    const ctx = this.ctx;
    const ids = this._ids;
    ids.clear();
    const list = ctx.survivors?.list;
    const ambientMode = ctx.mode === 'title' || ctx.mode === 'debrief' || ctx.mode === 'briefing';
    // existing flocks whose anchor is no longer hidden → leave
    for (const f of this.flocks) {
      if (f.state === 'leave') continue;
      if (f.anchor) {
        const s = f.anchor;
        if (!list || !list.includes(s) || !unseen(s)) this._leave(f, f.cx, f.cz);
        else ids.add(s);
      } else if (!ambientMode || !this.allowed) this._leave(f, f.cx - wind.x, f.cz - wind.y);
      else ids.add('ambient');
    }
    if (!this.allowed) return;
    const far = !!this._returning;
    this._returning = false;
    if (Array.isArray(list)) {
      for (const s of list) {
        if (!s || !unseen(s) || !s.position || ids.has(s)) continue;
        const n = 3 + (((s.id ?? 0) * 7 + 3) % 3);
        if (!this._spawnFlock(s, s.position.x, s.position.z, n, wind, far).birds.length) {
          this.flocks.pop();
          break;
        }
      }
    }
    if (ambientMode && !ids.has('ambient')) {
      const foc = this.fx.focus;
      const f = this._spawnFlock(null, foc.x + 30, foc.z - 40, 4, wind, false);
      if (!f.birds.length) this.flocks.pop();
    }
  }

  _fly(b, dt, wind, focus, heli) {
    const f = b.flock;
    let dvx, dvy, dvz;
    if (!f || f.state === 'leave') {
      // downwind and up, away from where the trouble is
      const wl = Math.hypot(wind.x, wind.y);
      let ax = wl > 0.5 ? wind.x / wl : b.x - (f ? f.fromX : focus.x);
      let az = wl > 0.5 ? wind.y / wl : b.z - (f ? f.fromZ : focus.z);
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      dvx = ax * 12 + wind.x * 0.4;
      dvz = az * 12 + wind.y * 0.4;
      dvy = b.y < 48 ? 2.6 : 0;
      if (Math.hypot(b.x - focus.x, b.z - focus.z) > 560) {
        b.on = false;
        b.flock = null;
        return;
      }
    } else if (f.state === 'flee') {
      let ax = b.x - heli.x;
      let az = b.z - heli.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      dvx = ax * 14 - az * 3 * Math.sign(b.w);
      dvz = az * 14 + ax * 3 * Math.sign(b.w);
      dvy = b.y < 32 ? 3 : 0;
    } else {
      // circle the anchor
      b.ang += b.w * dt;
      const tx = f.cx + Math.cos(b.ang) * b.rad;
      const tz = f.cz + Math.sin(b.ang) * b.rad;
      const s = Math.sign(b.w);
      const sp = Math.abs(b.w) * b.rad;
      dvx = -Math.sin(b.ang) * sp * s + (tx - b.x) * 0.6;
      dvz = Math.cos(b.ang) * sp * s + (tz - b.z) * 0.6;
      const alt = b.alt + 2.5 * Math.sin(b.ang * 0.5 + b.seed * 6);
      dvy = Math.max(-3, Math.min(3, (alt - b.y) * 0.6));
      // limit far approach speed (returning birds)
      const dl = Math.hypot(dvx, dvz);
      if (dl > 14) {
        dvx *= 14 / dl;
        dvz *= 14 / dl;
      }
    }
    // steer (ground frame)
    const maxA = 7 * dt;
    const ax = Math.max(-maxA, Math.min(maxA, dvx - b.vx));
    const ay = Math.max(-maxA, Math.min(maxA, dvy - b.vy));
    const az = Math.max(-maxA, Math.min(maxA, dvz - b.vz));
    b.vx += ax;
    b.vy += ay;
    b.vz += az;
    b.x += b.vx * dt;
    b.y = Math.max(4, b.y + b.vy * dt);
    b.z += b.vz * dt;
    // nose into the relative wind: heading from the AIR velocity (ground velocity − wind)
    const avx = b.vx - wind.x * 0.85;
    const avz = b.vz - wind.y * 0.85;
    if (avx * avx + avz * avz > 0.25) {
      const h = Math.atan2(avx, -avz);
      let d = h - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.heading += d * Math.min(1, dt * 5);
      const turn = d / Math.max(dt, 1e-3);
      b.bank += (Math.max(-0.65, Math.min(0.65, -turn * 0.12)) - b.bank) * Math.min(1, dt * 4);
    }
    // flapping: climb / accelerate → flap 3.2 Hz; otherwise glide with bursts
    b.burstT -= dt;
    if (b.burstT <= 0) {
      b.burst = 0.8 + Math.random() * 0.8;
      b.burstT = 3 + Math.random() * 5;
    }
    b.burst = Math.max(0, b.burst - dt);
    const need = b.vy > 0.6 || (ax * ax + az * az) / (dt * dt + 1e-6) > 9 || b.burst > 0 || (f && f.state !== 'circle');
    const target = need ? 0.62 : 0.06;
    b.amp += (target - b.amp) * Math.min(1, dt * 3);
    b.phase += dt * (need ? 3.3 : 2.4) * Math.PI * 2;
  }

  _write() {
    let n = 0;
    const m = this._m;
    for (const b of this.birds) {
      if (!b.on) continue;
      this._e.set(0, -b.heading, b.bank);
      this._q.setFromEuler(this._e);
      this._p.set(b.x, b.y, b.z);
      m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, m);
      this.flapAttr.array[n] = 0.12 + b.amp * Math.sin(b.phase);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.flapAttr.clearUpdateRanges();
      this.flapAttr.addUpdateRange(0, n);
      this.flapAttr.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Dolphins [NICE]: a pod porpoising across the view in calm daylight.
function dolphinGeometry(look) {
  const body = new THREE.SphereGeometry(0.5, 10, 6);
  body.scale(0.42, 0.36, 2.3);
  const fin = new THREE.ConeGeometry(0.2, 0.42, 4);
  fin.scale(0.35, 1, 1.4);
  const fluke = new THREE.BoxGeometry(0.9, 0.05, 0.25);
  const flip = new THREE.BoxGeometry(0.8, 0.04, 0.2);
  return look.merge([
    { geometry: body, color: '#36454D' },
    { geometry: fin, color: '#2B373E', position: [0, 0.28, 0.05], rotation: [-0.5, 0, 0] },
    { geometry: fluke, color: '#2B373E', position: [0, 0, 1.18] },
    { geometry: flip, color: '#2F3C43', position: [0, -0.06, -0.3] },
  ]);
}

export class Dolphins {
  constructor(fx, max) {
    this.fx = fx;
    this.max = Math.max(1, max);
    this.limit = max;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(dolphinGeometry(fx.ctx.look), mat, this.max);
    this.mesh.name = 'fx.dolphins';
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pod = { active: false, t: 0, life: 40, x: 0, z: 0, dx: 1, dz: 0, n: 0, members: [] };
    for (let i = 0; i < this.max; i++) this.pod.members.push({ ox: 0, oz: 0, ph: 0, was: false });
    this.timer = 20 + Math.random() * 20;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  setLimit(n) {
    this.limit = Math.max(0, Math.min(this.max, n));
  }

  clear() {
    this.pod.active = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  update(dt, st, focus, heli) {
    const pod = this.pod;
    const ok = this.limit > 0 && (st.night ?? 0) < 0.3 && (st.waveHeight ?? 1) < 1.6 && (st.intensity ?? 0) < 0.25 && (st.rain ?? 0) < 0.05;
    if (!pod.active) {
      this.mesh.visible = false;
      if (!ok || !(dt > 0)) return;
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 45 + Math.random() * 40;
      // start off one side of the view, cross it, avoid the heli
      const a = Math.random() * Math.PI * 2;
      pod.dx = Math.cos(a);
      pod.dz = Math.sin(a);
      const lat = (Math.random() - 0.5) * 70;
      pod.x = focus.x - pod.dx * 110 - pod.dz * lat;
      pod.z = focus.z - pod.dz * 110 + pod.dx * lat;
      if (Math.hypot(pod.x - heli.x, pod.z - heli.z) < 40) pod.x += 60;
      pod.t = 0;
      pod.life = 38;
      pod.n = Math.min(this.limit, 3 + Math.floor(Math.random() * 3));
      for (let i = 0; i < pod.n; i++) {
        const m = pod.members[i];
        m.ox = (Math.random() - 0.5) * 9;
        m.oz = (Math.random() - 0.5) * 12;
        m.ph = Math.random() * 6.28;
        m.was = false;
      }
      pod.active = true;
    }
    if (dt > 0) {
      pod.t += dt;
      pod.x += pod.dx * 6.5 * dt;
      pod.z += pod.dz * 6.5 * dt;
    }
    if (pod.t > pod.life || !ok && pod.t > 4) {
      pod.active = false;
      this.mesh.count = 0;
      return;
    }
    const fx = this.fx;
    const heading = Math.atan2(pod.dx, -pod.dz);
    let n = 0;
    for (let i = 0; i < pod.n; i++) {
      const m = pod.members[i];
      const ph = pod.t * (2 * Math.PI / 2.3) + m.ph;
      const s = Math.sin(ph);
      const x = pod.x + pod.dx * m.oz - pod.dz * m.ox;
      const z = pod.z + pod.dz * m.oz + pod.dx * m.ox;
      const sea = fx.seaHeight(x, z);
      const y = sea - 0.75 + 1.25 * s;
      const above = y > sea - 0.2;
      if (above !== m.was && dt > 0) {
        fx.splash(x, sea, z, 0.6);
        m.was = above;
      }
      if (y < sea - 0.9) continue;
      const pitch = Math.cos(ph) * 0.55;
      this._e.set(pitch, -heading, 0);
      this._q.setFromEuler(this._e);
      this._p.set(x, y, z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------
// Jellyfish glow [NICE]: faint pulses just under the surface on calm nights (box-wrapped around the focus).
const JELLY_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 aJ;
uniform float uJellyAmt;
uniform vec2 uDrift;
varying vec2 vQ;
varying vec3 vC;
void main() {
  vec2 focus = fxFocus();
  float L = 240.0;
  vec2 rel = mod(aJ.xy * L + uDrift - focus + 0.5 * L, L) - 0.5 * L;
  vec3 p = vec3(focus.x + rel.x, uSeaLevel - 0.05, focus.y + rel.y);
  // they drift in blooms, not as an even sprinkle: a slow noise mask over the sea
  float bloom = smoothstep(0.48, 0.72, texture2D(uAtlas, p.xz * 0.0035 + vec2(0.31, 0.77)).r);
  if (aJ.w > uJellyAmt || bloom < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // a bell contracting at ~1 Hz; the light swells on the contraction
  float ph = uFxTime * (5.0 + 2.5 * aJ.z) + aJ.w * 40.0;
  float pulse = pow(0.5 + 0.5 * sin(ph), 3.0);
  float size = (0.55 + 0.55 * aJ.z) * (0.9 - 0.12 * pulse);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vQ = position.xy;
  vec3 teal = vec3(0.035, 0.75, 1.0);
  vec3 violet = vec3(0.45, 0.25, 1.0);
  vC = mix(teal, violet, step(0.75, fract(aJ.w * 9.1))) * (0.12 + 0.5 * pulse) * bloom * (1.0 - fxFog(p))
     * (1.0 - smoothstep(0.35, 0.5, max(abs(rel.x), abs(rel.y)) / L));
}
`;
const JELLY_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vC;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  // seen through a little water: a soft core and a faint rim of the bell
  float a = exp(-r2 * 4.0) * 0.7 + exp(-abs(sqrt(r2) - 0.6) * 14.0) * 0.3;
  gl_FragColor = vec4(vC * a, 1.0);
  ${FINISH}
}
`;

export class Jellies {
  constructor(look, air, max) {
    this.max = Math.max(1, max);
    const g = quadGeometry();
    const r = rng32(4040);
    const a = new Float32Array(this.max * 4);
    for (let i = 0; i < a.length; i++) a[i] = r();
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(a, 4));
    g.instanceCount = max;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.drift = new THREE.Vector2();
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), ...look.uniforms, ...air, uJellyAmt: { value: 0 }, uDrift: { value: this.drift } },
      vertexShader: JELLY_VERT,
      fragmentShader: JELLY_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx.jellyfish';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.visible = false;
  }

  setLimit(n) {
    this.mesh.geometry.instanceCount = Math.max(0, Math.min(this.max, n));
  }

  update(dt, st, wind) {
    const amt = smooth(0.6, 0.95, st.night ?? 0) * (1 - smooth(0.25, 0.5, st.intensity ?? 0)) * (1 - smooth(1.0, 2.0, st.waveHeight ?? 0));
    this.mesh.visible = amt > 0.02 && this.mesh.geometry.instanceCount > 0;
    this.material.uniforms.uJellyAmt.value = clamp01(amt);
    this.drift.x += wind.x * 0.02 * dt + 0.05 * dt;
    this.drift.y += wind.y * 0.02 * dt;
  }
}

// ---------------------------------------------------------------------------------------------------
// Whale [NICE]: a ~14 m back surfacing in calm water, a blow, a short cruise, a flukes-up dive.
const SURFACE_T = 16; // s for one surfacing

function whaleGeometry(look) {
  const body = new THREE.SphereGeometry(1, 16, 10);
  body.scale(1.55, 1.25, 7);
  const head = new THREE.SphereGeometry(1, 12, 8);
  head.scale(1.35, 1.0, 2.4);
  const hump = new THREE.SphereGeometry(0.5, 8, 6);
  hump.scale(0.6, 0.5, 1.4);
  const stock = new THREE.CylinderGeometry(0.35, 0.9, 3.2, 8);
  stock.rotateX(Math.PI / 2);
  const fluke = new THREE.SphereGeometry(1, 10, 4);
  fluke.scale(2.6, 0.18, 0.9);
  return look.merge([
    { geometry: body, color: '#1C2428' },
    { geometry: head, color: '#20292E', position: [0, 0.1, -5.6] },
    { geometry: hump, color: '#161D21', position: [0, 1.15, 2.6] },
    { geometry: stock, color: '#1A2226', position: [0, -0.1, 7.6] },
    { geometry: fluke, color: '#151B1F', position: [0, -0.05, 9.4] },
  ]);
}

export class Whale {
  constructor(fx, allowed) {
    this.fx = fx;
    this.allowed = allowed;
    this.mesh = new THREE.Mesh(whaleGeometry(fx.ctx.look), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 }));
    this.mesh.name = 'fx.whale';
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.active = false;
    this.timer = 50 + Math.random() * 60;
    this.t = 0;
    this.x = 0;
    this.z = 0;
    this.dx = 1;
    this.dz = 0;
    this.blown = false;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._mist = new THREE.Color(1.1, 1.15, 1.2);
  }

  setAllowed(v) {
    this.allowed = v;
  }

  clear() {
    this.active = false;
    this.mesh.visible = false;
  }

  update(dt, st, focus, heli) {
    const fx = this.fx;
    const calm = (st.intensity ?? 0) < 0.2 && (st.waveHeight ?? 1) < 1.2 && (st.rain ?? 0) < 0.05;
    if (!this.active) {
      this.mesh.visible = false;
      if (!this.allowed || !calm || !(dt > 0)) return;
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 80 + Math.random() * 90;
      // somewhere in view, away from the heli
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 45;
        this.x = focus.x + Math.cos(a) * r;
        this.z = focus.z + Math.sin(a) * r * 0.6;
        if (Math.hypot(this.x - heli.x, this.z - heli.z) > 45) break;
      }
      const h = Math.random() * Math.PI * 2;
      this.dx = Math.sin(h);
      this.dz = -Math.cos(h);
      this.t = 0;
      this.blown = false;
      this.active = true;
    }
    if (dt > 0) {
      this.t += dt;
      this.x += this.dx * 1.8 * dt;
      this.z += this.dz * 1.8 * dt;
    }
    const k = this.t / SURFACE_T;
    if (k >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    const sea = fx.seaHeight(this.x, this.z);
    // rise (0–.18), cruise with a gentle roll (.18–.7), dive: pitch down, flukes up (.7–1)
    let y, pitch;
    if (k < 0.18) {
      const u = k / 0.18;
      y = sea - 3.2 + 2.75 * u * u * (3 - 2 * u);
      pitch = 0.12 * (1 - u);
    } else if (k < 0.7) {
      y = sea - 0.45 + 0.12 * Math.sin(this.t * 0.9);
      pitch = 0.02 * Math.sin(this.t * 0.7);
    } else {
      const u = (k - 0.7) / 0.3;
      pitch = -0.75 * Math.sin(Math.min(1, u * 1.3) * Math.PI * 0.5);
      y = sea - 0.45 - 4.5 * u * u;
    }
    this._e.set(pitch, -Math.atan2(this.dx, -this.dz), 0.04 * Math.sin(this.t * 0.6));
    this.mesh.rotation.copy(this._e);
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.visible = true;
    if (dt > 0) {
      // the blow: a mist column, then a slick while cruising
      if (!this.blown && k > 0.22) {
        this.blown = true;
        const sp = fx.pools.spray;
        const hx = this.x + this.dx * 4.5;
        const hz = this.z + this.dz * 4.5;
        for (let i = 0; i < 26; i++) {
          sp.emit(fx.t, hx + (Math.random() - 0.5) * 0.6, sea + 0.8, hz + (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 1.2, 7 + 4 * Math.random(), (Math.random() - 0.5) * 1.2,
            1.6 + Math.random(), 0.8, 4.5 + 2 * Math.random(), this._mist, 0.32, this._mist, BLOW);
        }
        fx.ctx.ocean?.splash?.(this.x, this.z, 4, 0.5);
      }
      if (k > 0.15 && k < 0.85) fx.ctx.ocean?.addWake?.(this.x, this.z, 0.8, this.dx, this.dz);
    }
  }
}

const BLOW = { drag: 1.4, accY: -2.2, wind: 0.8, flags: 0, emissive: 0, spin: 0.3 };
