// Rings drawn ON the water, conformed to the live sea surface (CPU: ocean.heightAt per vertex, so they ride
// the swell instead of slicing through it):
//   'glow' — the lightning charge zone: a noise-broken pale #7FB8FF rim (30–50 % gaps) and a flickering
//            glow hugging the crests inside, pulsing in brightness, additive (DESIGN §2.12, §3.12)
//   'foam' — the downburst's growing white ring (§3.12 telegraph), normal blending, lacy
// One draw call per kind; a slot is a ring. Only active slots touch the CPU (≈ 200 heightAt calls each).
import * as THREE from 'three';
import { HZ_GLSL, FINISH, TAU } from './common.js';

// Radial rows: the ring line plus a soft inner fill (fractions of the radius).
const ROWS = {
  glow: [0.0, 0.4, 0.7, 0.88, 0.96, 1.0, 1.04, 1.1],
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
  float sl = float(slot);
  // seamless angular noise (sampled on a circle in atlas space), drifting: the rim wobbles ±1.5 m and
  // 30–50 % of it is simply missing — a charged sea, not an area-of-effect decal
  float ang = vQ.y * 6.2831853;
  vec2 cs = vec2(cos(ang), sin(ang));
  float n1 = texture2D(uAtlas, cs * 0.21 + vec2(0.31 * sl, uHzTime * 0.013)).r;
  float n2 = texture2D(uAtlas, cs * 0.6 + vec2(0.57, 0.11 * sl - uHzTime * 0.021)).r;
  float n3 = texture2D(uAtlas, cs * 1.3 + vec2(0.13 * sl + uHzTime * 0.05, 0.71)).r;
  float qq = q + (n1 - 0.5) * 9.0 + (n3 - 0.5) * 3.5;
  // soft-ended gaps (atlas fbm ≈ .5 ± .16: this cut leaves ~40 % of the arc dark) and a brightness that
  // wanders along the arc (no even dashes)
  float gaps = smoothstep(0.46, 0.58, n2 * 0.75 + n1 * 0.25);
  // a soft, uneven glow band (1.4–3.2 m), brightness wandering along the arc — never a neon tube
  float w = mix(1.4, 3.2, n3);
  float line = exp(-pow(qq / w, 2.0)) * gaps * (0.15 + 0.85 * smoothstep(0.3, 0.75, n3 * 0.6 + n1 * 0.4)) * 1.6 / w;
  float halo = exp(-pow(qq / 5.0, 2.0)) * 0.1 * gaps;
  // inside: a flickering pale glow that hugs the wave crests over capillary-agitated water
  float inside = smoothstep(0.03 * R.x, -0.1 * R.x, q);
  vec2 xz = vW.xz;
  float tick = floor(uHzTime * 12.0);
  float rip = texture2D(uAtlas, xz * 0.13 + vec2(tick * 0.137, tick * 0.071)).r;
  float flick = texture2D(uAtlas, xz * 0.023 + vec2(uHzTime * 0.05, -uHzTime * 0.037)).r;
  float crest = smoothstep(0.0, 1.6, vQ.w);
  float spark = inside * (0.15 + 0.85 * crest) * smoothstep(0.5, 0.8, flick) * smoothstep(0.4, 0.85, rip);
  // crackle towards the strike: smooth random brightness along the rim (no bead / dash pattern)
  float ck = texture2D(uAtlas, cs * 0.9 + vec2(floor(uHzTime * 14.0) * 0.173, 0.3 + sl * 0.2)).r;
  float crack = mix(1.0, 0.4 + 1.2 * ck, R.w);
  float I = (line * crack * 1.15 + halo + spark * (0.45 + 0.45 * R.w)) * R.y * (0.4 + 0.6 * R.z);
  // a pale corona glow, not a saturated UI blue (additive blue saturates hard through the tone curve)
  vec3 rc = mix(uRingCol[slot], vec3(dot(uRingCol[slot], vec3(0.3, 0.5, 0.2))), 0.3);
  vec3 col = rc * I * (1.0 - hzFog(vW));
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
      let sum = 0;
      for (let i = 0; i <= this.segs; i++) {
        const ang = (i / this.segs) * TAU;
        const cx = Math.cos(ang);
        const cz = Math.sin(ang);
        for (let j = 0; j < R; j++) {
          const r = s.radius * this.rows[j];
          const x = s.x + cx * r;
          const z = s.z + cz * r;
          const v = i0 + i * R + j;
          const h = ocean && ocean.heightAt ? ocean.heightAt(x, z) : 0;
          sum += h;
          this.pos[v * 3] = x;
          this.pos[v * 3 + 1] = h + lift;
          this.pos[v * 3 + 2] = z;
          this.q[v * 4] = r - s.radius;
        }
      }
      // aQ.w: height above the ring's mean surface (the charge glow hugs the crests)
      const mean = sum / this.perSlot + lift;
      for (let v = i0; v < i0 + this.perSlot; v++) this.q[v * 4 + 3] = this.pos[v * 3 + 1] - mean;
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
