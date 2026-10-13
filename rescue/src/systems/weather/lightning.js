// Lightning scheduler + flash envelope (DESIGN §2.8 «Вспышка», §2.12, §3.12 «Молния», CONTRACT weather).
//
// * Poisson strikes at the preset rate (per minute, wind channel), only while intensity ≥ 0.6.
// * 70 % in-cloud (`cloudOnly`, harmless, immediate); 30 % sea strikes ≤ 600 m from the heli,
//   above 70 m altitude 35 % of those target the heli. Sea strikes are telegraphed: `weather:charge`
//   2 s before (3 s on cadet difficulty) + St. Elmo's fire when the heli is inside the charge zone.
// * Tall obstacles (rig derrick, masts) attract the harmless sea strikes nearby.
// * Flash envelope: triple pulse; photosensitivity: ≤ 3 full-screen pulses per second (one strike per
//   second at most), `reduceFlashes` → one soft pulse (attack 120 ms, decay 600 ms, peak 0.3) ≤ 1 per 1.5 s.
import * as THREE from 'three';
import { FLASH_DAY, FLASH_NIGHT } from './presets.js';

const MAX_CHARGES = 4;
const MIN_GAP = 1.0; // s between full flashes (each is a ≤ 3-peak envelope)
const MIN_GAP_REDUCED = 1.5;

function envelope(t) {
  // DESIGN §2.8: flash = min(1, exp(−14t) + [t>.11]·.75·exp(−10(t−.11)) + [t>.23]·.45·exp(−7(t−.23)))
  let f = Math.exp(-t * 14);
  if (t > 0.11) f += 0.75 * Math.exp(-(t - 0.11) * 10);
  if (t > 0.23) f += 0.45 * Math.exp(-(t - 0.23) * 7);
  return Math.min(1, f);
}

function envelopeReduced(t) {
  if (t < 0.12) {
    const k = t / 0.12;
    return k * k * (3 - 2 * k);
  }
  const d = (t - 0.12) / 0.6;
  if (d >= 1) return 0;
  const k = 1 - d;
  return k * k * (3 - 2 * k);
}

export class Lightning {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.rng = rng;
    this.charges = [];
    for (let i = 0; i < MAX_CHARGES; i++) {
      this.charges.push({ x: 0, z: 0, eta: 0, total: 2, radius: 30, target: 'sea', strength: 1, alive: false });
    }
    this.flashT = 99;
    this.flashStrength = 0;
    this.flashReduced = false;
    this.lastFlashAt = -99; // weather clock
    this.timer = 6;
    this.clock = 0;
    this.dayColor = new THREE.Color(FLASH_DAY);
    this.nightColor = new THREE.Color(FLASH_NIGHT);
    this.onStrike = null; // (x, z, strength, cloudOnly) → lights swing; set by weather
  }

  reset() {
    for (const c of this.charges) c.alive = false;
    this.flashT = 99;
    this.flashStrength = 0;
    this.timer = 4 + this.rng.next() * 6;
  }

  get reduce() {
    return !!this.ctx.settings.get('reduceFlashes');
  }

  // Telegraphed sea strike at (x, z).
  charge(w, x, z, { eta, radius = 30, target = 'sea', strength = 1 } = {}) {
    const cadet = this.ctx.settings.get('difficulty') === 'cadet';
    const e = eta ?? (cadet ? 3 : 2);
    let c = this.charges.find((k) => !k.alive);
    if (!c) {
      // all slots busy: strike the most imminent one now and reuse it
      c = this.charges.reduce((a, b) => (a.eta < b.eta ? a : b));
      this.strike(w, c.x, c.z, { strength: c.strength });
    }
    Object.assign(c, { x, z, eta: e, total: e, radius, target, strength, alive: true });
    const hp = w.heliPos;
    const inside = Math.hypot(hp.x - x, hp.z - z) < radius * 1.5;
    this.ctx.events.emit('weather:charge', { x, z, radius, eta: e, target, heli: inside });
    return c;
  }

  // Immediate strike (in-cloud or at sea).
  strike(w, x, z, { cloudOnly = false, strength = 1 } = {}) {
    const hp = w.heliPos;
    const distance = Math.hypot(hp.x - x, hp.z - z);
    const st = w.state;
    st.lastStrike.x = x;
    st.lastStrike.z = z;
    st.lastStrike.distance = distance;
    st.lastStrike.cloudOnly = cloudOnly;
    st.lastStrike.t = this.clock;
    this.ctx.events.emit('weather:lightning', { x, z, distance, strength, cloudOnly });
    // Flash: weaker in-cloud and far away; lightning reads stronger in the dark.
    const f = strength * (cloudOnly ? 0.75 : 1) * (1 - 0.4 * THREE.MathUtils.clamp(distance / 700, 0, 1)) *
      (0.62 + 0.38 * st.night);
    if (this._flash(f) && this.onStrike) this.onStrike(x, z, f, cloudOnly);
  }

  _flash(f) {
    const reduce = this.reduce;
    const gap = reduce ? MIN_GAP_REDUCED : MIN_GAP;
    if (this.clock - this.lastFlashAt < gap) {
      // inside the photosensitivity window: never re-trigger, only let a stronger strike lift the tail
      if (!reduce && this.flashT > 0.3) this.flashStrength = Math.max(this.flashStrength * 0.5, Math.min(1, f) * 0.35);
      return false;
    }
    this.lastFlashAt = this.clock;
    this.flashT = 0;
    this.flashStrength = Math.min(1, f);
    this.flashReduced = reduce;
    return true;
  }

  update(dt, w, allowRandom, playing) {
    const st = w.state;
    this.clock += dt;

    // --- flash envelope -------------------------------------------------------------------------
    this.flashT += dt;
    let flash = 0;
    if (this.flashReduced) flash = envelopeReduced(this.flashT) * 0.3 * Math.min(1, 0.5 + this.flashStrength);
    else if (this.flashT < 1.5) flash = envelope(this.flashT) * this.flashStrength;
    st.flash = flash < 1e-3 ? 0 : flash;
    st.flashColor.copy(this.dayColor).lerp(this.nightColor, st.night);

    // --- telegraphed charges ---------------------------------------------------------------------
    const hp = w.heliPos;
    let elmo = 0;
    for (const c of this.charges) {
      if (!c.alive) continue;
      c.eta -= dt;
      if (Math.hypot(hp.x - c.x, hp.z - c.z) < c.radius * 1.5) elmo = Math.max(elmo, 1 - Math.max(0, c.eta) / c.total);
      if (c.eta <= 0) {
        c.alive = false;
        this.strike(w, c.x, c.z, { strength: c.strength });
      }
    }
    st.stElmo = elmo > st.stElmo ? elmo : Math.max(elmo, st.stElmo - dt * 1.5);

    // --- random strikes ---------------------------------------------------------------------------
    const rate = st.palette.lightningPerMin;
    if (!allowRandom || rate < 0.01 || st.intensity < 0.6 - 1e-3) {
      this.timer = Math.max(this.timer, 3);
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = Math.max(1.2, (-Math.log(1 - this.rng.next() * 0.999) * 60) / rate);

    if (this.rng.next() < 0.7) {
      // in-cloud «spider» somewhere around the heli
      const a = this.rng.next() * Math.PI * 2;
      const r = 80 + this.rng.next() * 620;
      this.strike(w, hp.x + Math.cos(a) * r, hp.z + Math.sin(a) * r, { cloudOnly: true, strength: 0.45 + 0.35 * this.rng.next() });
      return;
    }
    // sea strike
    const alt = w.heliAlt;
    if (playing && alt > 70 && this.rng.next() < 0.35) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * 6;
      this.charge(w, hp.x + Math.cos(a) * r, hp.z + Math.sin(a) * r, { target: 'heli' });
      return;
    }
    const a = this.rng.next() * Math.PI * 2;
    const r = 40 + 560 * Math.sqrt(this.rng.next());
    let x = hp.x + Math.cos(a) * r;
    let z = hp.z + Math.sin(a) * r;
    // Masts and the rig's lightning rod attract harmless strikes nearby.
    const obstacles = this.ctx.world?.obstacles;
    if (obstacles && obstacles.length) {
      let best = null, bd = 140;
      for (const o of obstacles) {
        if (!o || (o.top ?? 0) < 20) continue;
        const d = Math.hypot(o.x - x, o.z - z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best && this.rng.next() < 0.6) {
        x = best.x;
        z = best.z;
      }
    }
    this.charge(w, x, z, { target: 'sea' });
  }
}
