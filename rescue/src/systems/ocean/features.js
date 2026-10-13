// Large surface features rendered IN the water (DESIGN §2.6.7): rogue wave, waterspout base
// (vortex), whirlpool — plus the rotor-downwash dimple (§2.6.5 layer 9), because it is also a
// vertical displacement that heightAt() must include.
//
// Heights are evaluated at the LAGRANGIAN point (before Gerstner horizontal displacement) on both
// CPU and GPU, so the CPU mirror stays exact. The GLSL below is the single source for the shader;
// the JS functions are line-by-line mirrors — change both together.
import { clamp } from '../../core/math.js';

export const FEATURE_TYPE = { rogue: 1, vortex: 2, whirlpool: 3 };
export const MAX_FEATURES = 4;
const ROGUE_SCAR_LIFE = 40; // s of lace scar after a rogue wave is removed
const FADE_OUT = 1.6; // s for a removed feature's height to settle

const sech2 = (q) => {
  q = Math.min(12, Math.abs(q));
  const e = Math.exp(-2 * q);
  const s = (2 * Math.sqrt(e)) / (1 + e);
  return s * s;
};

// ---- CPU height functions (mirror the GLSL ones below) -------------------------------------
function rogueHeight(px, pz, A, B, tOff, speed) {
  const cx = A[1] + B[0] * speed * tOff;
  const cz = A[2] + B[1] * speed * tOff;
  const rx = px - cx, rz = pz - cz;
  const u = rx * B[0] + rz * B[1];
  const v = -rx * B[1] + rz * B[0];
  const ue = u + 0.0015 * v * v; // crest bowed forward
  const lc = Math.max(B[3], 1);
  const e = Math.max(Math.abs(v) - 0.3 * lc, 0) / (0.12 * lc);
  const env = Math.exp(-e * e);
  const W = Math.max(B[2], 1);
  const prof = sech2(ue / (ue > 0 ? 0.55 * W : 1.3 * W)); // steep front, long back
  const sk = (ue - 1.6 * W) / (0.9 * W); // suction trough ahead of the wall
  return A[3] * env * (prof - 0.35 * Math.exp(-sk * sk));
}

function vortexHeight(px, pz, A, B) {
  const r = Math.hypot(px - A[1], pz - A[2]);
  const q = r / (0.45 * Math.max(B[0], 1));
  const t = clamp((A[3] - 0.4) / 0.6, 0, 1);
  return -0.8 * t * t * (3 - 2 * t) * Math.exp(-q * q);
}

function whirlHeight(px, pz, A, B) {
  const R = Math.max(B[0], 1);
  const r = Math.hypot(px - A[1], pz - A[2]);
  const q = r / (0.25 * R);
  const m = (r - R) / (0.22 * R);
  return A[3] * (-5 / (1 + q * q) + 0.4 * Math.exp(-m * m));
}

// ---- GLSL (shared by vertex + fragment shaders and the self-test) ---------------------------
export const FEATURES_GLSL = /* glsl */ `
uniform int uFeatCount;
uniform vec4 uFeatA[${MAX_FEATURES}];  // type, x, z, height|strength (incl. fades)
uniform vec4 uFeatB[${MAX_FEATURES}];  // rogue: dirX, dirZ, width W, crest length | others: radius, spin, 0, 0
uniform vec4 uFeatC[${MAX_FEATURES}];  // rogue: carpet, age, speed, removed | others: age, 0, 0, 0
uniform vec4 uDownwash;                // x, z, radius, strength
float oSech2(float q) {
  q = min(12.0, abs(q));
  float e = exp(-2.0 * q);
  float s = 2.0 * sqrt(e) / (1.0 + e);
  return s * s;
}
// (ue, v, envelope) — local frame of a rogue crest. ue > 0 is ahead of the crest.
vec3 oRogueFrame(vec2 p, vec4 A, vec4 B) {
  vec2 rel = p - A.yz;
  float u = dot(rel, B.xy);
  float v = dot(rel, vec2(-B.y, B.x));
  float lc = max(B.w, 1.0);
  float e = max(abs(v) - 0.3 * lc, 0.0) / (0.12 * lc);
  return vec3(u + 0.0015 * v * v, v, exp(-e * e));
}
float oRogueHeight(vec2 p, vec4 A, vec4 B) {
  vec3 f = oRogueFrame(p, A, B);
  float W = max(B.z, 1.0);
  float prof = oSech2(f.x / (f.x > 0.0 ? 0.55 * W : 1.3 * W));
  float sk = (f.x - 1.6 * W) / (0.9 * W);
  return A.w * f.z * (prof - 0.35 * exp(-sk * sk));
}
float oVortexHeight(vec2 p, vec4 A, vec4 B) {
  float q = length(p - A.yz) / (0.45 * max(B.x, 1.0));
  return -0.8 * smoothstep(0.4, 1.0, A.w) * exp(-q * q);
}
float oWhirlHeight(vec2 p, vec4 A, vec4 B) {
  float R = max(B.x, 1.0);
  float r = length(p - A.yz);
  float q = r / (0.25 * R);
  float m = (r - R) / (0.22 * R);
  return A.w * (-5.0 / (1.0 + q * q) + 0.4 * exp(-m * m));
}
float oceanFeatureHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_FEATURES}; i++) {
    if (i >= uFeatCount) break;
    vec4 A = uFeatA[i];
    vec4 B = uFeatB[i];
    if (A.x < 1.5) h += oRogueHeight(p, A, B);
    else if (A.x < 2.5) h += oVortexHeight(p, A, B);
    else h += oWhirlHeight(p, A, B);
  }
  if (uDownwash.w > 0.0) {
    float q = length(p - uDownwash.xy) / (0.6 * uDownwash.z);
    h -= 0.25 * uDownwash.w * exp(-q * q);
  }
  return h;
}
// Horizontal surface flow of swirling features, m/s (water memory advection, debris).
vec2 oceanFeatureFlow(vec2 p) {
  vec2 f = vec2(0.0);
  for (int i = 0; i < ${MAX_FEATURES}; i++) {
    if (i >= uFeatCount) break;
    vec4 A = uFeatA[i];
    if (A.x < 1.5) continue;
    vec4 B = uFeatB[i];
    vec2 d = p - A.yz;
    float r = max(length(d), 0.5);
    float R = max(B.x, 1.0);
    vec2 tang = vec2(-d.y, d.x) / r * B.y;
    float prof = (r / R) * exp(0.5 * (1.0 - (r * r) / (R * R)));
    float vt = A.x < 2.5 ? 6.0 * A.w : 2.0 * A.w;
    float vin = A.x < 2.5 ? 0.35 * vt : 0.4 * A.w;
    f += (tang * vt - d / r * vin) * prof;
  }
  return f;
}
`;

// ---- Feature slots ---------------------------------------------------------------------------
export class FeatureSet {
  constructor() {
    this.slots = []; // {id, type, A[4], B[4], C[4], speed, height, strength, age, removed, fade, fadeIn}
    this.uA = new Float32Array(4 * MAX_FEATURES);
    this.uB = new Float32Array(4 * MAX_FEATURES);
    this.uC = new Float32Array(4 * MAX_FEATURES);
    this.count = 0;
    this.downwash = new Float32Array(4); // x, z, radius, strength
    this.residual = 0; // 0..1 lace residual after rogue waves (decays over 40 s)
    this.active = false;
  }

  clear() {
    this.slots.length = 0;
    this.count = 0;
    this.residual = 0;
    this.downwash[3] = 0;
    this._pack();
  }

  get(id) {
    for (const s of this.slots) if (s.id === id && !s.removed) return s;
    return null;
  }

  set(id, f) {
    const type = FEATURE_TYPE[f.type];
    if (!type) return null;
    let s = null;
    for (const x of this.slots) if (x.id === id) s = x;
    if (!s) {
      if (this.slots.length >= MAX_FEATURES) {
        // evict a removed (fading) slot first, else the oldest
        let victim = this.slots.find((x) => x.removed) || this.slots[0];
        this.slots.splice(this.slots.indexOf(victim), 1);
      }
      s = { id, type, A: [type, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0], speed: 0, height: 0, strength: 1, age: 0, removed: false, fade: 1, fadeIn: 0 };
      this.slots.push(s);
    }
    s.type = type;
    s.removed = false;
    s.fade = 1;
    s.A[0] = type;
    if (type === 1) {
      const o = f.origin || f.position || { x: f.x ?? 0, y: f.z ?? 0 };
      s.A[1] = o.x;
      s.A[2] = o.isVector2 ? o.y : (o.z ?? o.y ?? 0); // Vector2 (x, z) | Vector3 | {x, z}
      const d = f.dir || { x: 1, y: 0 };
      const dz = d.isVector3 ? d.z : d.y;
      const l = Math.hypot(d.x, dz) || 1;
      s.B[0] = d.x / l;
      s.B[1] = dz / l;
      s.B[2] = f.width ?? 22;
      s.B[3] = f.length ?? 500;
      s.speed = f.speed ?? 15;
      s.height = f.height ?? 14;
      s.strength = f.strength ?? 1;
    } else {
      s.A[1] = f.x ?? f.position?.x ?? 0;
      s.A[2] = f.z ?? f.position?.z ?? 0;
      s.B[0] = f.radius ?? (type === 2 ? 25 : 45);
      s.B[1] = f.spin ?? (type === 2 ? -1 : 1); // spout base turns opposite to the whirlpool
      s.strength = clamp(f.strength ?? 1, 0, 1);
    }
    this._pack();
    return s;
  }

  remove(id) {
    for (const s of this.slots) {
      if (s.id === id && !s.removed) {
        s.removed = true;
        s.removeAge = 0;
        if (s.type === 1) this.residual = 1;
      }
    }
    this._pack();
  }

  setDownwash(x, z, radius, strength) {
    const d = this.downwash;
    d[0] = x;
    d[1] = z;
    d[2] = Math.max(1, radius);
    d[3] = clamp(strength, 0, 1);
    this.active = this.count > 0 || d[3] > 0;
  }

  update(dt) {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      s.age += dt;
      s.fadeIn = Math.min(1, s.fadeIn + dt / 0.6);
      if (s.type === 1) {
        s.A[1] += s.B[0] * s.speed * dt;
        s.A[2] += s.B[1] * s.speed * dt;
      }
      if (s.removed) {
        s.removeAge += dt;
        s.fade = Math.max(0, 1 - s.removeAge / FADE_OUT);
        const life = s.type === 1 ? ROGUE_SCAR_LIFE : FADE_OUT;
        if (s.removeAge >= life) this.slots.splice(i, 1);
      }
    }
    if (this.residual > 0) this.residual = Math.max(0, this.residual - dt / ROGUE_SCAR_LIFE);
    this._pack();
  }

  _pack() {
    let n = 0;
    for (const s of this.slots) {
      if (n >= MAX_FEATURES) break;
      const j = n * 4;
      const ease = s.fadeIn * s.fadeIn * (3 - 2 * s.fadeIn);
      if (s.type === 1) {
        s.A[3] = s.height * s.strength * s.fade * ease;
        s.C[0] = s.removed ? Math.max(0, 1 - s.removeAge / ROGUE_SCAR_LIFE) : 1; // carpet/scar strength
        s.C[1] = s.age;
        s.C[2] = s.speed;
        s.C[3] = s.removed ? 1 : 0;
      } else {
        s.A[3] = s.strength * s.fade * ease;
        s.C[0] = s.age;
        s.C[1] = s.C[2] = s.C[3] = 0;
      }
      for (let c = 0; c < 4; c++) {
        this.uA[j + c] = s.A[c];
        this.uB[j + c] = s.B[c];
        this.uC[j + c] = s.C[c];
      }
      n++;
    }
    this.count = n;
    this.active = n > 0 || this.downwash[3] > 0;
  }

  // Sum of feature heights at lagrangian point (px, pz). tOff moves rogue crests forward in time.
  heightAt(px, pz, tOff = 0) {
    let h = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i];
      if (s.type === 1) h += rogueHeight(px, pz, s.A, s.B, tOff, s.speed);
      else if (s.type === 2) h += vortexHeight(px, pz, s.A, s.B);
      else h += whirlHeight(px, pz, s.A, s.B);
    }
    const d = this.downwash;
    if (d[3] > 0) {
      const q = Math.hypot(px - d[0], pz - d[1]) / (0.6 * d[2]);
      h -= 0.25 * d[3] * Math.exp(-q * q);
    }
    return h;
  }

  // Horizontal swirl flow (m/s) — mirrors oceanFeatureFlow().
  flowAt(x, z, out) {
    let fx = 0, fz = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i];
      if (s.type === 1) continue;
      const dx = x - s.A[1], dz = z - s.A[2];
      const r = Math.max(Math.hypot(dx, dz), 0.5);
      const R = Math.max(s.B[0], 1);
      const prof = (r / R) * Math.exp(0.5 * (1 - (r * r) / (R * R)));
      const vt = s.type === 2 ? 6 * s.A[3] : 2 * s.A[3];
      const vin = s.type === 2 ? 0.35 * vt : 0.4 * s.A[3];
      fx += ((-dz / r) * s.B[1] * vt - (dx / r) * vin) * prof;
      fz += ((dx / r) * s.B[1] * vt - (dz / r) * vin) * prof;
    }
    return out.set(fx, fz);
  }
}
