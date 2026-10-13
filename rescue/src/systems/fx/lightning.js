// Lightning visuals (DESIGN §2.12 «Молния», §2.15 #1 «Море вспыхнуло», §4 #33), read from above:
//
//  * 70 % in-cloud «spiders»: branching horizontal ribbons in the 60–85 m scud layer, 80–200 m across,
//    150–300 ms with 3–4 flickers; they light the scud from inside (#6A7BA8 spots via `cloudFlash`).
//  * 30 % sea strikes: midpoint displacement (7 levels) + 2–4 branches; core 0.8 m #FFF ×30 HDR,
//    halo 6 m #C7D6FF ×4 (day #DCE6FF). The bolt starts just under the camera far off the view axis,
//    so from above it reads as a SPEAR thrown from the frame edge. Leader → three return strokes.
//    Impact (star, steam, ring, spray, 0.3 s ground glow) is spawned by Effects.
//  * reduceFlashes: one soft stroke at ~30 % brightness, no re-strokes, single spider flicker.
// Ribbons are built in screen space in the vertex shader (pixel width clamped: never a giant bar near
// the camera, never thinner than ~1.5 px).
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, quadGeometry, strokeEnvelope, softEnvelope } from './common.js';

const MAX_SEG = 288;
const BOLT_SLOTS = 2;
const SPIDER_SLOTS = 2;

const VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 iA; // A.xyz, along (0 top/root → 1 tip)
attribute vec4 iB; // B.xyz, width multiplier
attribute vec4 iC; // intensity multiplier, branch flag, seed, unused
uniform float uWidth;   // world width, m
uniform vec2 uPx;       // min / max width, px
uniform float uI;       // stroke intensity
uniform float uBranchI; // branch visibility (first stroke)
uniform float uReveal;  // stepped leader progress 0..1
varying float vX;
varying float vI;
void main() {
  vec4 ca = projectionMatrix * viewMatrix * vec4(iA.xyz, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(iB.xyz, 1.0);
  vec2 hr = uResolution * 0.5;
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * hr;
  float l = length(d);
  vec2 dir = l > 1e-4 ? d / l : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec4 c = position.y > 0.0 ? cb : ca;
  float pxPerM = projectionMatrix[1][1] * hr.y / max(c.w, 0.5);
  float wpx = clamp(uWidth * iB.w * pxPerM, uPx.x * iB.w, uPx.y);
  c.xy += (perp * position.x * wpx + dir * position.y * wpx * 0.5) / hr * c.w;
  gl_Position = c;
  vX = position.x;
  float vis = 1.0 - smoothstep(uReveal - 0.04, uReveal, iA.w);
  vI = uI * iC.x * mix(1.0, uBranchI, iC.y) * vis * (1.0 - 0.55 * fxFog(iA.xyz));
}
`;
const FRAG_CORE = /* glsl */ `
uniform vec3 uColor;
varying float vX;
varying float vI;
void main() {
  float a = exp(-vX * vX * 2.6);
  gl_FragColor = vec4(uColor * vI * a, 1.0);
  ${FINISH}
}
`;
const FRAG_HALO = /* glsl */ `
uniform vec3 uColor;
varying float vX;
varying float vI;
void main() {
  float a = exp(-vX * vX * 4.0) * 0.8 + exp(-vX * vX * 14.0) * 0.4;
  gl_FragColor = vec4(uColor * vI * a, 1.0);
  ${FINISH}
}
`;

function gauss(r) {
  return (r() + r() + r() - 1.5) * 1.15;
}

class RibbonSlot {
  constructor(look, air, kind) {
    this.kind = kind; // 'bolt' | 'spider'
    const g = quadGeometry();
    this.A = new Float32Array(MAX_SEG * 4);
    this.B = new Float32Array(MAX_SEG * 4);
    this.C = new Float32Array(MAX_SEG * 4);
    for (const [n, arr] of [['iA', this.A], ['iB', this.B], ['iC', this.C]]) {
      const at = new THREE.InstancedBufferAttribute(arr, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(n, at);
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    this.n = 0;
    const mk = (frag, width, px, color, order) => {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          ...fogUniforms(),
          ...look.uniforms,
          ...air,
          uWidth: { value: width },
          uPx: { value: new THREE.Vector2(px[0], px[1]) },
          uI: { value: 0 },
          uBranchI: { value: 1 },
          uReveal: { value: 1 },
          uColor: { value: new THREE.Color(color) },
        },
        vertexShader: VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
      side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.visible = false;
      return mesh;
    };
    const spider = kind === 'spider';
    this.halo = mk(FRAG_HALO, spider ? 5 : 6, spider ? [4, 30] : [5, 46], COLORS.boltHalo, 26);
    this.core = mk(FRAG_CORE, spider ? 0.45 : 0.8, spider ? [1.2, 4] : [1.6, 6.5], COLORS.bolt, 27);
    this.halo.name = `fx.${kind}Halo`;
    this.core.name = `fx.${kind}Core`;
    this.t = 99;
    this.life = 0;
    this.active = false;
    this.strength = 1;
    this.x = 0;
    this.z = 0;
    this.y = 70;
    this.extent = 100;
    this.cx = 0;
    this.cz = 0;
    this.pulses = [0, 0, 0, 0];
    this.pulseW = [0.03, 0.03, 0.03, 0.03];
    this.pulseA = [1, 1, 1, 1];
    this.np = 0;
    this.reduced = false;
  }

  begin() {
    this.n = 0;
  }

  seg(ax, ay, az, bx, by, bz, along, width, inten, branch) {
    if (this.n >= MAX_SEG) return;
    const o = this.n * 4;
    this.A[o] = ax; this.A[o + 1] = ay; this.A[o + 2] = az; this.A[o + 3] = along;
    this.B[o] = bx; this.B[o + 1] = by; this.B[o + 2] = bz; this.B[o + 3] = width;
    this.C[o] = inten; this.C[o + 1] = branch; this.C[o + 2] = 0; this.C[o + 3] = 0;
    this.n++;
  }

  commit() {
    const g = this.geometry;
    g.instanceCount = this.n;
    for (const k of ['iA', 'iB', 'iC']) {
      const at = g.attributes[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4);
      at.needsUpdate = true;
    }
  }

  setVisible(v) {
    this.core.visible = v;
    this.halo.visible = v;
  }
}

export class LightningFx {
  constructor(look, air, scene) {
    this.slots = [];
    for (let i = 0; i < BOLT_SLOTS; i++) this.slots.push(new RibbonSlot(look, air, 'bolt'));
    for (let i = 0; i < SPIDER_SLOTS; i++) this.slots.push(new RibbonSlot(look, air, 'spider'));
    for (const s of this.slots) scene.add(s.halo, s.core);
    // Cloud flash spots for the scud shader: (x, z, radius, intensity).
    this.cloudFlash = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    // scratch point buffers for midpoint displacement
    this._px = new Float32Array(260);
    this._py = new Float32Array(260);
    this._pz = new Float32Array(260);
    this._qx = new Float32Array(260);
    this._qy = new Float32Array(260);
    this._qz = new Float32Array(260);
    this.rand = Math.random;
    this._halo = new THREE.Color();
    this._haloDay = new THREE.Color(COLORS.boltHaloDay);
    this._haloNight = new THREE.Color(COLORS.boltHalo);
  }

  _slot(kind) {
    let best = null;
    for (const s of this.slots) {
      if (s.kind !== kind) continue;
      if (!s.active) return s;
      if (!best || s.t > best.t) best = s;
    }
    return best;
  }

  // Midpoint displacement between (ax..) and (bx..): `levels` subdivisions into the scratch buffers.
  // Returns the point count. horizontalOnly keeps y close to the straight line (spiders).
  _displace(ax, ay, az, bx, by, bz, levels, rough, yRough) {
    const r = this.rand;
    let px = this._px, py = this._py, pz = this._pz, qx = this._qx, qy = this._qy, qz = this._qz;
    px[0] = ax; py[0] = ay; pz[0] = az;
    px[1] = bx; py[1] = by; pz[1] = bz;
    let n = 2;
    for (let l = 0; l < levels; l++) {
      let m = 0;
      for (let i = 0; i < n - 1; i++) {
        const x0 = px[i], y0 = py[i], z0 = pz[i];
        const x1 = px[i + 1], y1 = py[i + 1], z1 = pz[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        qx[m] = x0; qy[m] = y0; qz[m] = z0; m++;
        qx[m] = (x0 + x1) * 0.5 + gauss(r) * len * rough;
        qy[m] = (y0 + y1) * 0.5 + gauss(r) * len * yRough;
        qz[m] = (z0 + z1) * 0.5 + gauss(r) * len * rough;
        m++;
      }
      qx[m] = px[n - 1]; qy[m] = py[n - 1]; qz[m] = pz[n - 1]; m++;
      // swap
      let t = px; px = qx; qx = t;
      t = py; py = qy; qy = t;
      t = pz; pz = qz; qz = t;
      n = m;
    }
    this._px = px; this._py = py; this._pz = pz; this._qx = qx; this._qy = qy; this._qz = qz;
    return n;
  }

  _emitPolyline(slot, n, along0, along1, width, inten, branch) {
    const px = this._px, py = this._py, pz = this._pz;
    for (let i = 0; i < n - 1; i++) {
      const a = along0 + (along1 - along0) * (i / (n - 1));
      // taper towards the tip
      const w = width * (1 - 0.45 * (i / (n - 1)) * branch);
      slot.seg(px[i], py[i], pz[i], px[i + 1], py[i + 1], pz[i + 1], a, w, inten, branch);
    }
  }

  // Sea strike. cam: camera Vector3, focus: {x, z} ground point under the screen centre.
  strike(x, z, seaY, strength, cam, focus, reduced) {
    const s = this._slot('bolt');
    const r = this.rand;
    s.active = true;
    s.t = 0;
    s.reduced = reduced;
    s.life = reduced ? 0.8 : 0.55;
    s.strength = Math.max(0.3, Math.min(1.4, strength || 1));
    s.x = x;
    s.z = z;
    // Top: just under the camera, pushed away from the view axis → enters from the frame edge.
    let ux = x - focus.x;
    let uz = z - focus.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 8) {
      const a = r() * Math.PI * 2;
      ux = Math.cos(a);
      uz = Math.sin(a);
    } else {
      ux /= ul;
      uz /= ul;
    }
    const H = Math.max(60, cam.y - seaY);
    const lat = (r() * 2 - 1) * 0.25 * H;
    const off = (0.45 + 0.25 * r()) * H;
    const tx = x + ux * off - uz * lat;
    const tz = z + uz * off + ux * lat;
    const ty = cam.y - 12 - 6 * r();
    s.y = ty;
    // where the channel crosses the scud layer (~72 m): the cloud lights up there
    const kc = Math.max(0, Math.min(1, (ty - 72) / Math.max(1, ty - seaY)));
    s.cx = tx + (x - tx) * kc;
    s.cz = tz + (z - tz) * kc;
    s.begin();
    // main channel: 7 levels → 128 segments
    const n = this._displace(tx, ty, tz, x, seaY, z, 7, 0.16, 0.05);
    this._emitPolyline(s, n, 0, 1, 1, 1, 0);
    // keep a copy of the main path for branch roots
    const mx = this._mx || (this._mx = new Float32Array(130));
    const my = this._my || (this._my = new Float32Array(130));
    const mz = this._mz || (this._mz = new Float32Array(130));
    for (let i = 0; i < n; i++) {
      mx[i] = this._px[i];
      my[i] = this._py[i];
      mz[i] = this._pz[i];
    }
    // 2–4 branches from the upper 10–70 %
    const nb = 2 + Math.floor(r() * 3);
    const total = Math.hypot(tx - x, ty - seaY, tz - z);
    for (let b = 0; b < nb; b++) {
      const k = Math.floor((0.1 + 0.6 * r()) * (n - 2));
      const bx0 = mx[k], by0 = my[k], bz0 = mz[k];
      const dx = mx[k + 1] - bx0, dy = my[k + 1] - by0, dz = mz[k + 1] - bz0;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const len = total * (0.12 + 0.2 * r());
      const ang = (r() < 0.5 ? -1 : 1) * (0.45 + 0.5 * r());
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // rotate the local direction around the vertical, keep it heading down
      const hx = (dx * ca - dz * sa) / dl;
      const hz = (dx * sa + dz * ca) / dl;
      const hy = Math.min(-0.25, dy / dl);
      const bl = Math.hypot(hx, hy, hz) || 1;
      const ex = bx0 + (hx / bl) * len;
      const ey = Math.max(seaY + 4, by0 + (hy / bl) * len);
      const ez = bz0 + (hz / bl) * len;
      const nn = this._displace(bx0, by0, bz0, ex, ey, ez, 5, 0.2, 0.08);
      const a0 = k / (n - 1);
      this._emitPolyline(s, nn, a0, a0 + 0.25, 0.55, 0.6, 1);
    }
    s.commit();
    s.setVisible(true);
    return s;
  }

  // In-cloud spider at (x, z): branching horizontal ribbons in the 60–85 m layer.
  spider(x, z, strength, reduced) {
    const s = this._slot('spider');
    const r = this.rand;
    s.active = true;
    s.t = 0;
    s.reduced = reduced;
    const dur = 0.15 + 0.15 * r();
    s.life = dur + 0.12;
    s.strength = Math.max(0.3, Math.min(1.2, strength || 0.7));
    s.x = x;
    s.z = z;
    s.y = 62 + 20 * r();
    s.extent = 80 + 120 * r();
    // 3–4 flickers (1 when reduced)
    s.np = reduced ? 1 : 3 + Math.floor(r() * 2);
    for (let i = 0; i < s.np; i++) {
      s.pulses[i] = reduced ? 0.06 : (i / s.np) * dur + r() * 0.03;
      s.pulseW[i] = 0.02 + 0.03 * r();
      s.pulseA[i] = i === 0 ? 1 : 0.55 + 0.45 * r();
    }
    s.begin();
    const arms = 3 + Math.floor(r() * 3);
    const a0 = r() * Math.PI * 2;
    for (let a = 0; a < arms; a++) {
      const ang = a0 + (a / arms) * Math.PI * 2 + (r() - 0.5) * 0.9;
      const len = s.extent * (0.35 + 0.3 * r());
      const ex = x + Math.cos(ang) * len;
      const ez = z + Math.sin(ang) * len;
      const ey = s.y + (r() - 0.5) * 8;
      const n = this._displace(x, s.y, z, ex, ey, ez, 5, 0.2, 0.02);
      // copy for sub-branches
      const mx = this._sx || (this._sx = new Float32Array(40));
      const my = this._sy || (this._sy = new Float32Array(40));
      const mz = this._sz || (this._sz = new Float32Array(40));
      for (let i = 0; i < n; i++) {
        mx[i] = this._px[i];
        my[i] = this._py[i];
        mz[i] = this._pz[i];
      }
      this._emitPolyline(s, n, 0, 1, 1, 1, 0);
      const subs = 1 + Math.floor(r() * 2);
      for (let b = 0; b < subs; b++) {
        const k = Math.floor((0.25 + 0.45 * r()) * (n - 1));
        const sa = ang + (r() < 0.5 ? -1 : 1) * (0.5 + 0.6 * r());
        const sl = len * (0.3 + 0.25 * r());
        const nn = this._displace(mx[k], my[k], mz[k], mx[k] + Math.cos(sa) * sl, my[k] + (r() - 0.5) * 4, mz[k] + Math.sin(sa) * sl, 4, 0.22, 0.02);
        this._emitPolyline(s, nn, 0.3, 1, 0.6, 0.65, 1);
      }
    }
    s.commit();
    s.setVisible(true);
    return s;
  }

  clear() {
    for (const s of this.slots) {
      s.active = false;
      s.setVisible(false);
    }
    for (const c of this.cloudFlash) c.set(0, 0, 1, 0);
  }

  // night: 0..1 (halo colour by day/night). Returns nothing; cloudFlash spots are refreshed.
  update(dt, night) {
    this._halo.copy(this._haloDay).lerp(this._haloNight, night);
    let ci = 0;
    for (const c of this.cloudFlash) c.w = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t > s.life) {
        s.active = false;
        s.setVisible(false);
        continue;
      }
      const t = s.t;
      let I;
      let branch = 1;
      let reveal = 1;
      if (s.kind === 'bolt') {
        reveal = Math.min(1, t / 0.035);
        if (s.reduced) I = softEnvelope(t) * 0.3;
        else {
          I = t < 0.035 ? 0.35 : strokeEnvelope(t - 0.035);
          branch = Math.exp(-Math.max(0, t - 0.035) * 22);
        }
      } else {
        I = 0;
        for (let i = 0; i < s.np; i++) {
          const d = (t - s.pulses[i]) / s.pulseW[i];
          I = Math.max(I, s.pulseA[i] * Math.exp(-d * d));
        }
        if (s.reduced) I = softEnvelope(t) * 0.3;
        reveal = Math.min(1, t / 0.05);
      }
      I *= s.strength;
      const cu = s.core.material.uniforms;
      const hu = s.halo.material.uniforms;
      const coreGain = s.kind === 'bolt' ? 30 : 10;
      const haloGain = s.kind === 'bolt' ? 4 : 1.6;
      cu.uI.value = I * coreGain;
      hu.uI.value = I * haloGain;
      cu.uBranchI.value = hu.uBranchI.value = branch;
      cu.uReveal.value = hu.uReveal.value = reveal * 1.05;
      hu.uColor.value.copy(this._halo);
      // light the scud from inside: spiders over their extent, bolts where they cross the layer
      if (ci < this.cloudFlash.length) {
        const c = this.cloudFlash[ci++];
        if (s.kind === 'spider') c.set(s.x, s.z, s.extent * 0.75, Math.min(1.2, I * 1.2));
        else c.set(s.cx, s.cz, 80, Math.min(1, I * 0.8));
      }
    }
  }
}
