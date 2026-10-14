// Fixed Gerstner wave bank — CPU side (DESIGN §2.6.1–2.6.2).
//
// The bank never changes wavelengths or directions at runtime: weather only re-weights amplitudes,
// so a wind shift produces believable cross-sea instead of a pattern "jump". Everything the vertex
// shader does is mirrored here with the same arrays and the same LOD/damping rules, so
// heightAt()/normalAt() agree with the rendered surface to a few centimetres (see selftest.js).
//
// Conventions (shared with shaders.js):
//   lagrangian point p0 (world xz) → local grid coordinate gl = p0 − offset
//   θ_i = k_i·(D_i · gl) + phase_i          (phase_i wrapped on the CPU, includes k·D·offset − ω·t)
//   P.xz = p0 + Σ b_i·w_i·D_i·cos θ_i         (horizontal, no loops because Σ k·b ≤ Q < 1)
//   P.y  =      Σ a_i·w_i·sin θ_i  + features(p0) + downwash(p0)
//   w_i  = smoothstep(3.5, 5, L_i / cell(gl)) · edgeFade(gl) · shoalDamp(p0) · coastDamp(p0)
import { clamp } from '../../core/math.js';
import { coastDistance, coastDamp } from './coast.js';

export const GRID_EXTENT = 380; // half-size of the warped grid, m (x' = sign(x)·|x|^1.6·380)
export const GRID_POW = 1.6;
export const SKIRT_ROWS = [1200, 3000]; // flat skirt rows beyond the grid (DESIGN §2.6.1 SHOULD)
export const EDGE_FADE = [380, 1200]; // waves fade to flat across the skirt

export const WAVE_L = [120, 78, 52, 34, 22, 14.5, 9.5, 6.2];
export const WAVE_DIR_DEG = [0, 18, -27, 41, -55, 66, -12, 33];
export const MAX_WAVES = 8;

// Per-quality knobs (DESIGN §8.2).
export const QUALITY = {
  high: { grid: 300, waves: 8, q: 2, memory: 512, glints: 8 },
  medium: { grid: 224, waves: 6, q: 1, memory: 384, glints: 4 },
  low: { grid: 160, waves: 4, q: 0, memory: 0, glints: 0 },
};

const TAU = Math.PI * 2;
const GRAV = 9.81;
const FD = 0.5; // finite-difference step for feature gradients (same as the vertex shader)

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const wrapPhase = (x) => {
  x %= TAU;
  return x < 0 ? x + TAU : x;
};

// Cell size of the warped grid at local coordinate (lx, lz). The derivative of 380·|x|^1.6 is
// 608·|x|^0.6; expressed through x' it is 608·(|x'|/380)^0.375 per unit of grid parameter.
export function cellSize(lx, lz, gridStep) {
  const m = Math.max(Math.abs(lx), Math.abs(lz)) / GRID_EXTENT;
  return 608 * gridStep * Math.pow(Math.max(m, 1e-5), 0.375);
}

export function edgeFade(lx, lz) {
  return 1 - smoothstep(EDGE_FADE[0], EDGE_FADE[1], Math.max(Math.abs(lx), Math.abs(lz)));
}

export class WaveBank {
  constructor() {
    this.count = 8; // active waves (quality)
    this.gridStep = 2 / 300;
    this.L = Float64Array.from(WAVE_L);
    this.k = this.L.map((L) => TAU / L);
    this.omega = this.k.map((k) => 0.9 * Math.sqrt(GRAV * k)); // DESIGN: ω = 0.9·sqrt(g·k)
    this.dirOffset = Float64Array.from(WAVE_DIR_DEG, (d) => (d * Math.PI) / 180);
    this.Dx = new Float64Array(MAX_WAVES);
    this.Dz = new Float64Array(MAX_WAVES);
    this.phi0 = new Float64Array(MAX_WAVES); // seeded phase
    this.a = new Float64Array(MAX_WAVES); // smoothed amplitude
    this.aTarget = new Float64Array(MAX_WAVES);
    this.b = new Float64Array(MAX_WAVES); // horizontal (Gerstner) amplitude
    this.phase = new Float64Array(MAX_WAVES); // wrapped, relative to the grid offset
    this.baseAngle = 0;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.time = 0;
    this.snap = true; // jump straight to target amplitudes on the next update
    this.stats = { Hs: 0, HsEff: 0.3, Lp: 16, K: 0, sigma: 0.4, Q: 0.25 };
    this.shoals = []; // [{x, z, r, on}] (≤ 8)
    this.coast = null; // coastline distance map (coast.js) — terrain coasts
    this.features = null; // FeatureSet (features.js) — optional
    // Shader uniform mirrors (flat arrays → zero-copy upload).
    this.uWaveA = new Float32Array(4 * MAX_WAVES); // Dx, Dz, k, a
    this.uWaveB = new Float32Array(4 * MAX_WAVES); // b, phase, L, wind alignment (whitecap crest weight)
    this._raw = new Float64Array(MAX_WAVES);
    this.align = new Float64Array(MAX_WAVES);
    this._ev = { dx: 0, dz: 0, y: 0, jxx: 0, jzz: 0, jxz: 0, sx: 0, sz: 0, vx: 0, vz: 0, vy: 0 };
    this.setSeed(1, 0);
  }

  // Seeded phases and base swell direction (radians, xz-plane angle of travel).
  setSeed(seed, baseAngle) {
    let s = (seed >>> 0) || 1;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < MAX_WAVES; i++) this.phi0[i] = rnd() * TAU;
    this.setBaseAngle(baseAngle);
    this.snap = true;
  }

  setBaseAngle(angle) {
    this.baseAngle = angle;
    for (let i = 0; i < MAX_WAVES; i++) {
      const ang = angle + this.dirOffset[i];
      this.Dx[i] = Math.cos(ang);
      this.Dz[i] = Math.sin(ang);
    }
  }

  setQuality(waves, gridN) {
    this.count = waves;
    this.gridStep = 2 / gridN;
    this.snap = true;
  }

  // sea: palette.sea {Hs, swellAdd, Q}; windAngle: xz angle the wind blows towards;
  // shortScale: 1 normally, 0.25 in `clearing` (waves 3..7 ×0.25).
  update(dt, t, sea, windAngle, shortScale, offsetX, offsetZ) {
    const n = this.count;
    const Hs = Math.max(0, sea.Hs);
    const Lp = clamp(14 * Hs + 12, 16, 120);
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const l = Math.log(this.L[i] / Lp) / 0.45;
      const spec = Math.exp(-l * l);
      const c = Math.max(0, Math.cos(this.baseAngle + this.dirOffset[i] - windAngle));
      const raw = spec * (0.35 + 0.65 * c * c);
      this._raw[i] = raw;
      sum2 += raw * raw;
    }
    // normalise over the ACTIVE waves so every quality level has the same Hs
    const norm = sum2 > 0 ? Hs / (4 * Math.sqrt(sum2 / 2)) : 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      let target = i < n ? this._raw[i] * norm : 0;
      if (i === 0) target += Math.max(0, sea.swellAdd || 0);
      if (i >= 3) target *= shortScale;
      this.aTarget[i] = target;
      if (this.snap) this.a[i] = target;
      else if (dt > 0) {
        const tau = target > this.a[i] ? 8 : 20; // grow 8 s, decay 20 s (swell outlives wind)
        this.a[i] += (target - this.a[i]) * (1 - Math.exp(-dt / tau));
      }
    }
    this.snap = false;

    let ka = 0;
    for (let i = 0; i < n; i++) ka += this.k[i] * this.a[i];
    const Q = clamp(sea.Q ?? 0.3, 0, 0.95);
    const div = Math.max(1, ka);
    let a2 = 0, K = 0, kb2 = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      this.b[i] = i < n ? (Q * this.a[i]) / div : 0;
      if (i < n) {
        a2 += this.a[i] * this.a[i];
        const kb = this.k[i] * this.b[i];
        K += kb;
        kb2 += kb * kb;
      }
    }
    this.time = t;
    this.offsetX = offsetX;
    this.offsetZ = offsetZ;
    let wa2 = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      const c = Math.max(0, Math.cos(this.baseAngle + this.dirOffset[i] - windAngle));
      this.align[i] = 0.25 + c * c;
      if (i >= 3 && i < 7) wa2 += this.align[i] * this.align[i];
    }
    this.stats.crestNorm = 1 / Math.sqrt(Math.max(wa2 / 2, 1e-4));
    for (let i = 0; i < MAX_WAVES; i++) {
      this.phase[i] = wrapPhase(this.k[i] * (this.Dx[i] * offsetX + this.Dz[i] * offsetZ) + this.phi0[i] - this.omega[i] * t);
      const j = i * 4;
      this.uWaveA[j] = this.Dx[i];
      this.uWaveA[j + 1] = this.Dz[i];
      this.uWaveA[j + 2] = this.k[i];
      this.uWaveA[j + 3] = i < n ? this.a[i] : 0;
      this.uWaveB[j] = this.b[i];
      this.uWaveB[j + 1] = this.phase[i];
      this.uWaveB[j + 2] = this.L[i];
      this.uWaveB[j + 3] = this.align[i];
    }
    const st = this.stats;
    st.Hs = Hs;
    st.Lp = Lp;
    st.Q = Q;
    st.HsEff = Math.max(0.3, 4 * Math.sqrt(a2 / 2));
    st.K = K;
    // standard deviation of the normalised crest compression c = (1 − J)/K (≈ Σ k·b·sinθ / K)
    st.sigma = K > 1e-5 ? Math.sqrt(kb2 / 2) / K : 0.4;
  }

  // Shoals damp waves near rocks (same falloff as GLSL oceanShoalDamp).
  shoalDamp(px, pz) {
    let d = 1;
    for (let i = 0; i < this.shoals.length; i++) {
      const s = this.shoals[i];
      if (s.on === false) continue; // a terrain coast: the coast map damps it
      const r = Math.hypot(px - s.x, pz - s.z);
      d *= 0.15 + 0.85 * smoothstep(s.r * 0.9, s.r * 2.6, r);
    }
    return d;
  }

  // Evaluate the Gerstner sum at lagrangian point (px, pz). deriv: also fill tangent terms and
  // orbital velocity. Results in this._ev.
  _eval(px, pz, tOff, deriv) {
    const ev = this._ev;
    const lx = px - this.offsetX;
    const lz = pz - this.offsetZ;
    const cell = cellSize(lx, lz, this.gridStep);
    let damp = edgeFade(lx, lz) * (this.shoals.length ? this.shoalDamp(px, pz) : 1);
    if (this.coast) damp *= coastDamp(coastDistance(this.coast, px, pz));
    let dx = 0, dz = 0, y = 0, jxx = 0, jzz = 0, jxz = 0, sx = 0, sz = 0, vx = 0, vz = 0, vy = 0;
    if (damp > 0) {
      for (let i = 0; i < this.count; i++) {
        const w = damp * smoothstep(3.5, 5.0, this.L[i] / cell);
        if (w <= 0) continue;
        const Dx = this.Dx[i], Dz = this.Dz[i], k = this.k[i];
        const th = k * (Dx * lx + Dz * lz) + this.phase[i] - this.omega[i] * tOff;
        const s = Math.sin(th), c = Math.cos(th);
        const a = this.a[i] * w, b = this.b[i] * w;
        dx += b * c * Dx;
        dz += b * c * Dz;
        y += a * s;
        if (deriv) {
          const kbs = k * b * s;
          jxx += kbs * Dx * Dx;
          jzz += kbs * Dz * Dz;
          jxz += kbs * Dx * Dz;
          const kac = k * a * c;
          sx += kac * Dx;
          sz += kac * Dz;
          const om = this.omega[i];
          vx += b * om * s * Dx; // d/dt of b·cos(… − ω t)
          vz += b * om * s * Dz;
          vy -= a * om * c;
        }
      }
    }
    ev.dx = dx; ev.dz = dz; ev.y = y;
    ev.jxx = jxx; ev.jzz = jzz; ev.jxz = jxz; ev.sx = sx; ev.sz = sz;
    ev.vx = vx; ev.vz = vz; ev.vy = vy;
    return ev;
  }

  // Lagrangian point whose displaced position lands on world (x, z): 3 fixed-point iterations.
  // Returns [px, pz] in this._p.
  invert(x, z, tOff = 0, iterations = 3) {
    let px = x, pz = z;
    for (let it = 0; it < iterations; it++) {
      const ev = this._eval(px, pz, tOff, false);
      px = x - ev.dx;
      pz = z - ev.dz;
    }
    this._px = px;
    this._pz = pz;
    return this;
  }

  _featureHeight(px, pz, tOff) {
    return this.features ? this.features.heightAt(px, pz, tOff) : 0;
  }

  heightAt(x, z, tOff = 0) {
    this.invert(x, z, tOff);
    const px = this._px, pz = this._pz;
    return this._eval(px, pz, tOff, false).y + this._featureHeight(px, pz, tOff);
  }

  // Exact normal of the displaced surface (same tangent cross product as the vertex shader).
  normalAt(x, z, out, tOff = 0) {
    this.invert(x, z, tOff);
    const px = this._px, pz = this._pz;
    const ev = this._eval(px, pz, tOff, true);
    let fx = 0, fz = 0;
    if (this.features && this.features.active) {
      const f0 = this._featureHeight(px, pz, tOff);
      fx = (this._featureHeight(px + FD, pz, tOff) - f0) / FD;
      fz = (this._featureHeight(px, pz + FD, tOff) - f0) / FD;
    }
    // Tx = (1−jxx, sx+fx, −jxz), Tz = (−jxz, sz+fz, 1−jzz), N = Tz × Tx
    const ax = -ev.jxz, ay = ev.sz + fz, az = 1 - ev.jzz;
    const bx = 1 - ev.jxx, by = ev.sx + fx, bz = -ev.jxz;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return out.set(nx / l, ny / l, nz / l);
  }

  // Orbital velocity of the surface at world (x, z): Vector2 (x, z) or Vector3 (x, vertical, z).
  velocityAt(x, z, out, tOff = 0) {
    this.invert(x, z, tOff);
    const ev = this._eval(this._px, this._pz, tOff, true);
    if (out.isVector3) return out.set(ev.vx, ev.vy, ev.vz);
    return out.set(ev.vx, ev.vz);
  }

  // Forward evaluation (lagrangian → displaced), used by the self-test as the independent reference.
  forward(px, pz, tOff, out) {
    const ev = this._eval(px, pz, tOff, false);
    out.x = px + ev.dx;
    out.z = pz + ev.dz;
    out.y = ev.y + this._featureHeight(px, pz, tOff);
    return out;
  }
}
