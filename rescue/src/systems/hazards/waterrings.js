// Rings drawn ON the water, conformed to the live sea surface (CPU: ocean.heightAt per vertex, so they ride
// the swell instead of slicing through it):
//   'glow' — the lightning charge ring: pale pulsing #7FB8FF, R 30 m, additive (DESIGN §2.12, §3.12)
//   'foam' — the downburst's growing white ring (§3.12 telegraph), normal blending, lacy
// One draw call per kind; a slot is a ring. Only active slots touch the CPU (≈ 200 heightAt calls each).
import * as THREE from 'three';
import { HZ_GLSL, FINISH, TAU } from './common.js';

// Radial rows: the ring line plus a soft inner fill (fractions of the radius).
const ROWS = {
  glow: [0.66, 0.88, 0.975, 1.0, 1.03],
  foam: [0.9, 0.97, 1.0, 1.035, 1.1],
};

const VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 aQ; // signed metres from the ring line, angle (turns), slot, 0
varying vec3 vW;
varying vec4 vQ;
void main() {
  vW = position;
  vQ = aQ;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG_GLOW = /* glsl */ `
${HZ_GLSL}
uniform vec4 uRing[MAXR];    // radius, intensity, pulse (0..1), crackle (0..1)
uniform vec3 uRingCol[MAXR];
varying vec3 vW;
varying vec4 vQ;
void main() {
  int slot = int(vQ.z + 0.5);
  vec4 R = uRing[slot];
  float q = vQ.x;
  float line = exp(-pow(q / 0.75, 2.0));
  float halo = exp(-pow(q / 3.2, 2.0)) * 0.32;
  float fill = smoothstep(-0.34 * R.x, -0.02 * R.x, q) * step(q, 0.0) * 0.1; // faint charged zone inside
  // electric crackle: angular dashes re-rolled 18 times a second
  float tick = floor(uHzTime * 18.0);
  float h = texture2D(uAtlas, vec2(vQ.y * 9.0 + tick * 0.137, tick * 0.071)).a;
  float crack = mix(1.0, 0.45 + 1.1 * step(0.45, h), R.w);
  float I = (line * crack + halo + fill) * R.y * (0.45 + 0.55 * R.z);
  vec3 col = uRingCol[slot] * I * (1.0 - hzFog(vW));
  gl_FragColor = vec4(col, 1.0);
  ${FINISH}
}
`;

const FRAG_FOAM = /* glsl */ `
${HZ_GLSL}
uniform vec4 uRing[MAXR];    // radius, alpha, lace scroll, 0
uniform vec3 uRingCol[MAXR];
varying vec3 vW;
varying vec4 vQ;
void main() {
  int slot = int(vQ.z + 0.5);
  vec4 R = uRing[slot];
  float q = vQ.x;
  float w = max(0.035 * R.x, 1.5);
  float band = exp(-pow(q / w, 2.0)) + 0.35 * exp(-pow((q + 1.8 * w) / (1.6 * w), 2.0));
  float lace = texture2D(uLace, vec2(vQ.y * max(8.0, floor(R.x * 0.25)), q * 0.08 - R.z)).r;
  float a = clamp(band * (0.35 + 0.95 * lace), 0.0, 1.0) * R.y;
  vec3 col = uRingCol[slot] * hzAirLight(vW, 0.9) * 0.55 + uRingCol[slot] * uAirFlash;
  col = mix(col, hzFogColor(col), hzFog(vW));
  gl_FragColor = vec4(col, a);
  ${FINISH}
}
`;

export class WaterRings {
  constructor(uniforms, kind, slots = 4, segs = 64) {
    this.kind = kind;
    this.rows = ROWS[kind];
    this.segs = segs;
    this.nSlots = slots;
    const perSlot = (segs + 1) * this.rows.length;
    this.perSlot = perSlot;
    const n = perSlot * slots;
    this.pos = new Float32Array(n * 3);
    this.q = new Float32Array(n * 4);
    const idx = [];
    const R = this.rows.length;
    for (let s = 0; s < slots; s++) {
      const base = s * perSlot;
      for (let i = 0; i <= segs; i++) {
        for (let j = 0; j < R; j++) {
          const v = base + i * R + j;
          this.q[v * 4 + 1] = i / segs;
          this.q[v * 4 + 2] = s;
          this.pos[v * 3 + 1] = -500; // parked far below the sea while inactive
        }
      }
      for (let i = 0; i < segs; i++) {
        for (let j = 0; j < R - 1; j++) {
          const a = base + i * R + j;
          const b = a + R;
          idx.push(a, b, a + 1, b, b + 1, a + 1); // facing up
        }
      }
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.qAttr = new THREE.BufferAttribute(this.q, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aQ', this.qAttr);
    g.setIndex(idx);
    this.ringU = Array.from({ length: slots }, () => new THREE.Vector4());
    this.ringC = Array.from({ length: slots }, () => new THREE.Color());
    const glow = kind === 'glow';
    this.material = new THREE.ShaderMaterial({
      defines: { MAXR: slots },
      uniforms: { ...uniforms, uRing: { value: this.ringU }, uRingCol: { value: this.ringC } },
      vertexShader: VERT,
      fragmentShader: glow ? FRAG_GLOW : FRAG_FOAM,
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = `hazards.rings.${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.slots = [];
    for (let i = 0; i < slots; i++) {
      this.slots.push({ index: i, used: false, x: 0, z: 0, radius: 30, a: 0, b: 0, c: 0, color: this.ringC[i], dirty: false });
    }
    this._parked = new Array(slots).fill(true);
  }

  alloc() {
    for (const s of this.slots) {
      if (!s.used) {
        s.used = true;
        s.a = s.b = s.c = 0;
        return s;
      }
    }
    return null;
  }

  free(s) {
    if (s) s.used = false;
  }

  clear() {
    for (const s of this.slots) s.used = false;
  }

  // ocean: the Ocean system (heightAt); lift: metres above the surface.
  update(ocean, lift = 0.3) {
    const R = this.rows.length;
    let any = false;
    let dirty = false;
    for (const s of this.slots) {
      const i0 = s.index * this.perSlot;
      const show = s.used && (s.a > 0.002 || s.b > 0.002);
      this.ringU[s.index].set(s.radius, s.a, s.b, s.c);
      if (!show) {
        if (!this._parked[s.index]) {
          for (let v = i0; v < i0 + this.perSlot; v++) this.pos[v * 3 + 1] = -500;
          this._parked[s.index] = true;
          dirty = true;
        }
        continue;
      }
      any = true;
      dirty = true;
      this._parked[s.index] = false;
      for (let i = 0; i <= this.segs; i++) {
        const ang = (i / this.segs) * TAU;
        const cx = Math.cos(ang);
        const cz = Math.sin(ang);
        for (let j = 0; j < R; j++) {
          const r = s.radius * this.rows[j];
          const x = s.x + cx * r;
          const z = s.z + cz * r;
          const v = i0 + i * R + j;
          this.pos[v * 3] = x;
          this.pos[v * 3 + 1] = (ocean && ocean.heightAt ? ocean.heightAt(x, z) : 0) + lift;
          this.pos[v * 3 + 2] = z;
          this.q[v * 4] = r - s.radius;
        }
      }
    }
    if (dirty) {
      this.posAttr.needsUpdate = true;
      this.qAttr.needsUpdate = true;
    }
    this.mesh.visible = any;
  }

  warmup(on) {
    this.mesh.visible = on;
  }
}
