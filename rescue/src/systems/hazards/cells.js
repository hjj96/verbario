// Downburst «нисходящий поток» and hail cell «град» [NICE] (DESIGN §3.12, §2.12, §3.8).
//   downburst  R 150 m, 25 s: radial outflow up to 18 m/s at 0.8R, sinking air −5 m/s inside 0.6R.
//              Telegraph 6 s: a dark rain column and a growing white ring on the water.
//   hail       cell R 220 m, 60–90 s, drifts with the wind: 1 %/s hull damage (×1.5 above 25 m/s).
//              Telegraph: a whitish-grey hail shaft #C9CFD2 (+ metallic ticking, audio). Drives weather.state.hail
//              near the heli so fx draws pellets.
import * as THREE from 'three';
import { DOWNBURST, HAIL, COLORS, rng32, lerp, clamp01, smooth, easeInOut } from './common.js';

const RAIN = new THREE.Color(COLORS.rainColumn);
const HAILC = new THREE.Color(COLORS.hailColumn);
const FOAM = new THREE.Color(COLORS.foam);

export class Downburst {
  constructor(hz, opts = {}) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.id = hz.nextId();
    this.type = 'downburst';
    this.label = 'НИСХОДЯЩИЙ ПОТОК';
    this.position = new THREE.Vector3(Number(opts.x) || 0, 0, Number(opts.z) || 0);
    this.velocity = new THREE.Vector3();
    this.radius = Number(opts.radius) || DOWNBURST.radius;
    this.telegraph = DOWNBURST.telegraph;
    this.life = this.telegraph + (Number(opts.duration) || DOWNBURST.life) + DOWNBURST.decay;
    this.scripted = !!opts.scripted;
    this.age = 0;
    this.strength = 0;
    this.stage = 'telegraph';
    this.eta = this.telegraph;
    this.alive = true;
    this.warned = false;
    this.column = hz.curtains.alloc();
    if (this.column) {
      this.column.color.copy(RAIN);
      this.column.kind = 0;
      this.column.fall = 30;
      this.column.taper = 1.25;
    }
    this.ring = hz.foamRings.alloc();
    if (this.ring) this.ring.color.copy(FOAM);
    this.slot = hz.vfx.alloc(); // only its cloud shadow
  }

  update(dt, env) {
    this.age += dt;
    const T = this.telegraph;
    const active = this.life - T - DOWNBURST.decay;
    const a = this.age;
    this.eta = Math.max(0, T - a);
    let vis;
    if (a < T) {
      this.stage = 'telegraph';
      this.strength = 0;
      vis = easeInOut(a / T);
    } else if (a < T + active) {
      this.stage = 'active';
      this.strength = Math.min(1, (a - T) / 1.0);
      vis = 1;
    } else {
      this.stage = 'decay';
      const k = clamp01((this.life - a) / DOWNBURST.decay);
      this.strength = k;
      vis = k;
    }
    if (a >= this.life) {
      this.alive = false;
      return;
    }
    const R = this.radius;
    if (this.column) {
      const c = this.column;
      c.x = this.position.x;
      c.z = this.position.z;
      c.radius = 0.42 * R;
      c.height = 112;
      c.alpha = 0.42 * vis;
      c.leanX = env.wind.x * 0.6;
      c.leanZ = env.wind.z * 0.6;
    }
    if (this.ring) {
      const r = this.ring;
      r.x = this.position.x;
      r.z = this.position.z;
      // grows out to 0.8R during the telegraph, then the outflow front breathes at 0.8–1.0R
      r.radius = a < T ? R * lerp(0.15, 0.8, easeInOut(a / T)) : R * (0.8 + 0.2 * (0.5 + 0.5 * Math.sin((a - T) * 1.4)));
      r.a = 0.85 * vis;
      r.b = 0;
      r.c = a * 0.35;
    }
    const s = this.slot;
    if (s) {
      s.x = this.position.x;
      s.z = this.position.z;
      s.alpha = 0;
      s.reach = 0;
      s.collarAlpha = 0;
      s.sprayStrength = 0;
      s.shadowStrength = 0.8 * vis;
      s.shadowRadius = 0.75 * R;
      s.shadowRot += 0.05 * dt;
      s.spinDir = 1;
    }
  }

  addAir(x, z, alt, acc) {
    const f = this.strength;
    if (f <= 0.001) return;
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const R = this.radius;
    const r = Math.hypot(dx, dz);
    if (r > 2 * R) return;
    const rr = Math.max(0.5, r);
    const v0 = DOWNBURST.outflow;
    const V = (r < 0.8 * R ? v0 * (r / (0.8 * R)) : v0 * Math.exp(-(((r - 0.8 * R) / (0.35 * R)) ** 2))) * f;
    const kAlt = 1 - 0.6 * smooth(40, 110, alt); // the outflow spreads along the sea
    acc.x += (dx / rr) * V * kAlt;
    acc.z += (dz / rr) * V * kAlt;
    acc.y -= DOWNBURST.down * f * (1 - smooth(0.5 * R, 0.65 * R, r));
  }

  danger(x, z) {
    const r = Math.hypot(x - this.position.x, z - this.position.z);
    const base = this.stage === 'telegraph' ? 0.35 * easeInOut(this.age / this.telegraph) : 0.7 * this.strength;
    return base * (1 - smooth(this.radius * 0.8, this.radius * 1.3, r));
  }

  dispose() {
    this.hz.curtains.free(this.column);
    this.hz.foamRings.free(this.ring);
    this.hz.vfx.free(this.slot);
    this.column = this.ring = this.slot = null;
    this.alive = false;
  }

  dissipate() {
    this.life = Math.min(this.life, this.age + DOWNBURST.decay);
  }
}

export class HailCell {
  constructor(hz, opts = {}) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.id = hz.nextId();
    this.type = 'hail';
    this.label = 'ГРАД';
    const rnd = rng32(opts.seed ?? hz.seedFor(this.id));
    this.position = new THREE.Vector3(Number(opts.x) || 0, 0, Number(opts.z) || 0);
    this.velocity = new THREE.Vector3();
    this.radius = Number(opts.radius) || HAIL.radius;
    this.life = Number(opts.duration ?? opts.life) || lerp(HAIL.life[0], HAIL.life[1], rnd());
    this.scripted = !!opts.scripted;
    this.age = 0;
    this.strength = 0;
    this.stage = 'forming';
    this.eta = 8;
    this.alive = true;
    this.warned = false;
    this.column = hz.curtains.alloc();
    if (this.column) {
      this.column.color.copy(HAILC);
      this.column.kind = 1;
      this.column.fall = 34;
      this.column.taper = 1.1;
    }
  }

  update(dt, env) {
    this.age += dt;
    const k = clamp01(this.age / 8) * clamp01((this.life - this.age) / 8);
    this.strength = k;
    this.stage = this.age < 8 ? 'forming' : this.life - this.age < 8 ? 'decay' : 'active';
    this.eta = Math.max(0, 8 - this.age);
    if (this.age >= this.life) {
      this.alive = false;
      return;
    }
    this.velocity.set(env.wind.x * 0.6, 0, env.wind.z * 0.6);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    const c = this.column;
    if (c) {
      c.x = this.position.x;
      c.z = this.position.z;
      c.radius = 0.5 * this.radius;
      c.height = 112;
      c.alpha = 0.26 * k;
      c.leanX = env.wind.x * 0.8;
      c.leanZ = env.wind.z * 0.8;
    }
  }

  // 0..1 hail intensity at a point (drives weather.state.hail near the heli)
  levelAt(x, z) {
    const r = Math.hypot(x - this.position.x, z - this.position.z);
    return this.strength * (1 - smooth(0.6 * this.radius, this.radius, r));
  }

  addAir() {}

  danger(x, z) {
    return 0.5 * this.levelAt(x, z);
  }

  dispose() {
    this.hz.curtains.free(this.column);
    this.column = null;
    this.alive = false;
  }

  dissipate() {
    this.life = Math.min(this.life, this.age + 8);
  }
}
