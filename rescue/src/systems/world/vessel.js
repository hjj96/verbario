// Seakeeping for anything with a hull (DESIGN §2.11, §3.9): pitch / roll from three
// ocean.heightAt samples (bow, port quarter, starboard quarter), heave from their mean, all
// through second-order springs (a ship rolls with inertia and a little overshoot, it never snaps
// to the wave slope). Deck tilt is clamped to ±2…9° by Hs (DESIGN §3.9 table). Bow slams are
// detected from the bow plunging into a rising crest.
//
// Heading convention (CONTRACT): 0 = north (−Z), clockwise positive. Local frame: bow = −Z,
// starboard = +X. local (lx, lz) → world (x + lx·cos h − lz·sin h, z + lx·sin h + lz·cos h).
import { clamp, smoothstep } from '../../core/math.js';

const DEG = Math.PI / 180;

export class VesselMotion {
  constructor({ length = 70, beam = 15, rollGain = 1.5, pitchW = 1.05, rollW = 0.66, heaveW = 1.4, zeta = 0.32, heaveK = 0.78 } = {}) {
    this.L = length;
    this.B = beam;
    this.rollGain = rollGain;
    this.pitchW = pitchW;
    this.rollW = rollW;
    this.heaveW = heaveW;
    this.zeta = zeta;
    this.heaveK = heaveK;
    this.pitch = 0; // rad, bow up +
    this.roll = 0; // rad, starboard up +
    this.heave = 0; // m
    this.pv = 0;
    this.rv = 0;
    this.hv = 0;
    this.tilt = 0; // rad from horizontal
    this.bowRel = 0; // bow height above the local water (m)
    this.bowRate = 0; // d(bowRel)/dt
    this.slam = 0; // strength of a slam this frame (0 = none)
    this.slamCooldown = 0;
    this.hb = 0;
    this.hp = 0;
    this.hs = 0;
  }

  reset() {
    this.pitch = this.roll = this.heave = 0;
    this.pv = this.rv = this.hv = 0;
    this.bowRel = 0;
    this.bowRate = 0;
    this.slam = 0;
    this.slamCooldown = 1;
  }

  // Sample world position of a local point.
  static local(x, z, heading, lx, lz, out) {
    const c = Math.cos(heading), s = Math.sin(heading);
    out.x = x + lx * c - lz * s;
    out.y = z + lx * s + lz * c;
    return out;
  }

  step(dt, x, z, heading, ocean, Hs, settle = false) {
    const L = this.L, B = this.B;
    const c = Math.cos(heading), s = Math.sin(heading);
    const hb = (this.hb = sampleH(ocean, x, z, c, s, 0, -0.42 * L));
    const hp = (this.hp = sampleH(ocean, x, z, c, s, -0.45 * B, 0.38 * L));
    const hs = (this.hs = sampleH(ocean, x, z, c, s, 0.45 * B, 0.38 * L));
    const sternMid = 0.5 * (hp + hs);
    const maxTilt = (2 + 7 * smoothstep(0.4, 7.5, Hs || 0)) * DEG;
    const pitchT = clamp(Math.atan2(hb - sternMid, 0.8 * L), -maxTilt, maxTilt);
    const rollT = clamp(this.rollGain * Math.atan2(hs - hp, 0.9 * B), -maxTilt, maxTilt);
    const heaveT = this.heaveK * (hb + hp + hs) / 3;
    if (settle || !(dt > 0)) {
      if (settle) {
        this.pitch = pitchT;
        this.roll = rollT;
        this.heave = heaveT;
        this.pv = this.rv = this.hv = 0;
      }
    } else {
      const h = Math.min(dt, 0.05);
      const z2 = 2 * this.zeta;
      this.pv += (this.pitchW * this.pitchW * (pitchT - this.pitch) - z2 * this.pitchW * this.pv) * h;
      this.rv += (this.rollW * this.rollW * (rollT - this.roll) - z2 * this.rollW * this.rv) * h;
      this.hv += (this.heaveW * this.heaveW * (heaveT - this.heave) - z2 * this.heaveW * this.hv) * h;
      this.pitch = clamp(this.pitch + this.pv * h, -maxTilt * 1.15, maxTilt * 1.15);
      this.roll = clamp(this.roll + this.rv * h, -maxTilt * 1.15, maxTilt * 1.15);
      this.heave += this.hv * h;
    }
    this.tilt = Math.acos(clamp(Math.cos(this.pitch) * Math.cos(this.roll), -1, 1));

    // Bow slam: the bow (≈ waterline at the stem) plunging into a rising crest.
    const bowY = this.heave + Math.sin(this.pitch) * 0.42 * L;
    const rel = bowY - hb;
    this.slam = 0;
    if (dt > 0) {
      const rate = (rel - this.bowRel) / dt;
      this.bowRate += (rate - this.bowRate) * Math.min(1, dt * 8);
      this.slamCooldown -= dt;
      const sea = smoothstep(1.2, 4.5, Hs || 0);
      if (sea > 0 && this.slamCooldown <= 0 && rel < 0.4 && this.bowRate < -1.6) {
        this.slam = clamp((-this.bowRate - 1.6) / 3, 0.25, 1) * sea;
        this.slamCooldown = 2.2 + 1.5 * (1 - sea);
      }
    }
    this.bowRel = rel;
    return this;
  }

  // Apply to an Object3D (position y + YXZ rotation: yaw from heading, then pitch, then roll).
  // rotation about X by +a lifts −Z (the bow); about Z by +b lifts +X (starboard).
  apply(obj, x, z, heading, lift = 0) {
    obj.position.set(x, this.heave + lift, z);
    obj.rotation.set(this.pitch, -heading, this.roll, 'YXZ');
  }
}

// Steering for ships on a looped route / constant drift / station keeping (bow into the weather).
export class Navigator {
  constructor() {
    this.route = null;
    this.idx = 0;
    this.speedT = 0; // target speed m/s
    this.speed = 0;
    this.heading = 0;
    this.yawRate = 0;
    this.station = false;
    this.driftHeading = 0;
    this.x = 0;
    this.z = 0;
  }

  // def: {x, z, heading, drift {x,z}, speed, route [[x,z]...]}
  setup(def) {
    this.x = def.x || 0;
    this.z = def.z || 0;
    this.heading = Number.isFinite(def.heading) ? def.heading : 0;
    const dv = def.drift ? Math.hypot(def.drift.x || 0, def.drift.z || 0) : 0;
    const explicitStill = def.drift && dv < 0.05;
    this.station = !!explicitStill || def.station === true;
    this.route = !this.station && Array.isArray(def.route) && def.route.length >= 2 ? def.route : null;
    this.idx = 0;
    if (this.route) {
      // start toward the first route point that is not where we already are
      let best = 0;
      for (let i = 0; i < this.route.length; i++) {
        const [rx, rz] = this.route[i];
        if (Math.hypot(rx - this.x, rz - this.z) > 60) {
          best = i;
          break;
        }
      }
      this.idx = best;
    }
    const base = Number.isFinite(def.speed) && def.speed > 0 ? def.speed : dv || 3;
    this.speedT = this.station ? 0 : clamp(base, 3, 5);
    if (!this.route && !this.station && dv > 0.05) this.heading = Math.atan2(def.drift.x, -def.drift.z);
    this.driftHeading = this.heading;
    this.speed = this.speedT;
    this.yawRate = 0;
  }

  step(dt, windDir) {
    if (!(dt > 0)) return;
    let desired = this.heading;
    if (this.station) {
      // heave-to: bow into the weather, slowly
      if (windDir && (windDir.x || windDir.y)) desired = Math.atan2(-windDir.x, windDir.y);
    } else if (this.route) {
      const [tx, tz] = this.route[this.idx];
      if (Math.hypot(tx - this.x, tz - this.z) < 90) this.idx = (this.idx + 1) % this.route.length;
      const [nx, nz] = this.route[this.idx];
      desired = Math.atan2(nx - this.x, -(nz - this.z));
    } else desired = this.driftHeading;
    let d = desired - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxRate = (this.station ? 0.6 : 2.2) * DEG;
    const rateT = clamp(d * 0.12, -maxRate, maxRate);
    this.yawRate += (rateT - this.yawRate) * (1 - Math.exp(-dt * 0.6));
    this.heading += this.yawRate * dt;
    this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    this.speed += clamp(this.speedT - this.speed, -0.15 * dt, 0.15 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += -Math.cos(this.heading) * this.speed * dt;
  }
}

function sampleH(ocean, x, z, c, s, lx, lz) {
  return ocean && ocean.heightAt ? ocean.heightAt(x + lx * c - lz * s, z + lx * s + lz * c) : 0;
}
