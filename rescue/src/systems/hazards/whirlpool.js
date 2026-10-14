// Whirlpool «водоворот» [SHOULD] (DESIGN §2.6.7 look, §3.12 mechanics): R 30–60 m, pulls floating things
// round at 2 m/s and inward at 0.4 m/s; a person closer than 8 m to the centre for 5 s in a row is lost
// (survivors own that state — we emit `hazard:engulf`). «Цель №1». The ocean draws the funnel of water
// (dip −5s/(1+(r/.25R)²), +0.4 m lip, log-polar foam arms, the #010406 abyss with a faint teal night glow);
// hazards add the flotsam that circles it forever — a plank, a barrel and a lifebuoy.
import * as THREE from 'three';
import { WHIRL, TAU, rng32, lerp, clamp01, smooth } from './common.js';
import { debrisTint } from './debris.js';

export class Whirlpool {
  constructor(hz, opts = {}) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.id = hz.nextId();
    this.type = 'whirlpool';
    this.label = 'ВОДОВОРОТ';
    const rnd = (this.rnd = rng32(opts.seed ?? hz.seedFor(this.id)));
    this.position = new THREE.Vector3(Number(opts.x) || 0, 0, Number(opts.z) || 0);
    this.velocity = new THREE.Vector3();
    this.radius = Number(opts.radius) || lerp(WHIRL.radius[0], WHIRL.radius[1], rnd());
    this.coreRadius = WHIRL.core;
    this.spin = opts.spin === -1 ? -1 : 1;
    this.life = Number(opts.duration ?? opts.life) || lerp(WHIRL.life[0], WHIRL.life[1], rnd());
    this.scripted = !!opts.scripted;
    this.name = opts.name || null;
    this.age = 0;
    this.strength = 0;
    this.stage = 'forming';
    this.eta = WHIRL.grow;
    this.alive = true;
    this.featureId = `hz-${this.id}`;
    this.engulf = new Map(); // survivor → seconds inside the core
    this.flotsam = [];
    const D = hz.debris;
    if (D) {
      const kinds = ['buoy', 'board', 'barrel', 'board'];
      for (let i = 0; i < kinds.length; i++) {
        const it = D.acquire(kinds[i], this, debrisTint(kinds[i], rnd));
        if (!it) continue;
        this.flotsam.push({ it, r: this.radius * lerp(0.3, 0.8, rnd()), ang: rnd() * TAU, ph: rnd() * TAU, spinY: lerp(-0.8, 0.8, rnd()) });
      }
    }
  }

  update(dt, env) {
    if (!this.alive) return;
    this.age += dt;
    const grow = clamp01(this.age / WHIRL.grow);
    const fade = clamp01((this.life - this.age) / WHIRL.decay);
    this.strength = grow * grow * (3 - 2 * grow) * fade;
    this.stage = this.age < WHIRL.grow ? 'forming' : fade < 1 ? 'decay' : 'active';
    this.eta = Math.max(0, WHIRL.grow - this.age);
    if (this.age >= this.life) {
      this.alive = false;
      return;
    }
    this.hz.ocean?.setFeature?.(this.featureId, {
      type: 'whirlpool', x: this.position.x, z: this.position.z, radius: this.radius, strength: this.strength, spin: this.spin,
    });

    // flotsam circling forever (a little faster near the centre, banking into the bowl)
    for (const f of this.flotsam) {
      const it = f.it;
      const w = (WHIRL.tangential * this.strength * (1 + 0.8 * (1 - f.r / this.radius))) / Math.max(4, f.r);
      f.ang += this.spin * w * dt;
      f.r = this.radius * (0.55 + 0.25 * Math.sin(this.age * 0.05 + f.ph));
      it.x = this.position.x + Math.cos(f.ang) * f.r;
      it.z = this.position.z + Math.sin(f.ang) * f.r;
      it.y = this.hz.seaHeight(it.x, it.z) + (it.kind === 'buoy' ? 0.05 : 0.12);
      it.ry += f.spinY * dt;
      it.rx = 0.12 * Math.sin(this.age * 0.9 + f.ph);
      it.rz = 0.12 * Math.cos(this.age * 0.7 + f.ph) - 0.15 * this.strength;
    }

    // people in the core for 5 s in a row → engulfed (survivors decide what that means)
    const list = this.ctx.survivors?.list;
    if (list && list.length && env.playing) {
      for (const s of list) {
        if (!s || !s.position || s.state === 'rescued' || s.state === 'lost' || s.state === 'winching') continue;
        const d = Math.hypot(s.position.x - this.position.x, s.position.z - this.position.z);
        let t = this.engulf.get(s) || 0;
        if (d < WHIRL.core * Math.max(0.3, this.strength)) t += dt;
        else t = 0;
        if (t >= WHIRL.coreTime && t - dt < WHIRL.coreTime) this.hz.emit('hazard:engulf', { hazard: this, type: 'whirlpool', survivor: s });
        this.engulf.set(s, t);
      }
    }
  }

  // 2 m/s round, 0.4 m/s inward inside R, fading out by 1.6 R.
  addFlow(x, z, out) {
    const s = this.strength;
    if (s <= 0.001) return;
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const R = this.radius;
    const r2 = dx * dx + dz * dz;
    if (r2 > 2.6 * R * R) return;
    const r = Math.max(0.5, Math.sqrt(r2));
    const outer = 1 - smooth(R, 1.6 * R, r);
    const vt = WHIRL.tangential * s * smooth(0, 0.3 * R, r) * outer;
    const vin = WHIRL.inward * s * outer * smooth(1, 4, r);
    out.x += ((this.spin * -dz) / r) * vt - (dx / r) * vin;
    out.y += ((this.spin * dx) / r) * vt - (dz / r) * vin;
  }

  danger(x, z, alt) {
    if (alt > 14) return 0;
    const r = Math.hypot(x - this.position.x, z - this.position.z);
    return 0.3 * this.strength * (1 - smooth(this.radius * 0.6, this.radius * 1.2, r));
  }

  dispose() {
    this.hz.ocean?.removeFeature?.(this.featureId);
    this.hz.debris?.releaseOwner(this);
    this.flotsam.length = 0;
    this.alive = false;
  }

  dissipate() {
    this.life = Math.min(this.life, this.age + WHIRL.decay);
  }
}
