// Flight model (DESIGN §3.3, §3.4, §3.8, §3.9), stepped at a fixed 60 Hz by Helicopter.
//
//   W   = weather.windAt(x, z) · profile(alt) · c                 c = 0.6, profile = clamp(.6 + .008·alt, .6, 1.4)
//   u   = input.move();  winch out → u·0.45
//   A   = 14.4 · (boost ? 1.4 : 1) · thrustFactor · (1 − 0.02·passengers)
//   acc = A·u + K·(W − v) + hazards.forceAt(x, z, alt) + assist   K = 0.4 s⁻¹
//
// Vertical: altTarget over MEAN sea level (4–120 m); vyCmd = clamp((altTarget − y)·1.2, −6, +7) + updraft,
// vy chases it at 6 m/s². Skids 1.6 m below the centre. Water strikes, obstacles, pad decks (moving,
// tilting), hard landings, autorotation and the crash descent live here too.
import * as THREE from 'three';
import { clamp, wrapAngle, createNoise2D } from '../../core/math.js';
import { SKID_Y } from './model.js';

export const STEP = 1 / 60;
const K = 0.4;
const C_WIND = 0.6;
const A_BASE = 14.4;
const SKID = -SKID_Y; // 1.6
const OBSTACLE_MARGIN = 6.5; // fuselage + part of the rotor
const D12 = THREE.MathUtils.degToRad(12);
const D5 = THREE.MathUtils.degToRad(5);

export const profile = (alt) => clamp(0.6 + 0.008 * alt, 0.6, 1.4);

export class FlightModel {
  constructor(heli) {
    this.h = heli;
    this.ctx = heli.ctx;
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.prevP = new THREE.Vector3();
    this.heading = 0;
    this.prevHeading = 0;
    this.yawRate = 0;
    this.noseTarget = null; // number | null (hold)
    this.thrust = new THREE.Vector2(); // rotor horizontal acceleration (drives the visual tilt)
    this.windEff = new THREE.Vector2();
    this.windSmooth = new THREE.Vector2();
    this.force = new THREE.Vector3();
    this.sea = 0;
    this.surface = 0;
    this.time = 0;
    this.waterCooldown = 0;
    this.obstacleCooldown = 0;
    this.deckCooldown = 0;
    this.contactPad = null;
    this.landTimer = 0;
    this.landOffset = new THREE.Vector2();
    this.landHeading = 0;
    this.landPadHeading = 0;
    this.turb = 0;
    this.lastVy = 0;
    this.noise = createNoise2D(9173);
    this._w = new THREE.Vector2();
    this._pv = new THREE.Vector3();
  }

  reset(x, y, z, heading) {
    this.p.set(x, y, z);
    this.prevP.copy(this.p);
    this.v.set(0, 0, 0);
    this.heading = this.prevHeading = heading;
    this.yawRate = 0;
    this.thrust.set(0, 0);
    this.windSmooth.set(0, 0);
    this.contactPad = null;
    this.landTimer = 0;
    this.waterCooldown = this.obstacleCooldown = this.deckCooldown = 0;
  }

  padVel(pad, out) {
    const v = pad && pad.velocity;
    return out.set(v ? v.x || 0 : 0, v ? v.y || 0 : 0, v ? v.z || 0 : 0);
  }

  // Remember where on the deck we sit (pad frame), so moving / turning decks carry the heli.
  attachTo(pad) {
    const ph = pad.heading || 0;
    const dx = this.p.x - pad.position.x;
    const dz = this.p.z - pad.position.z;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    // heading convention: clockwise from north; rotate world offset into the pad frame
    this.landOffset.set(dx * c + dz * s, -dx * s + dz * c);
    this.landPadHeading = ph;
    this.landHeading = this.heading;
  }

  step(dt) {
    const h = this.h;
    const ctx = this.ctx;
    this.time += dt;
    this.prevP.copy(this.p);
    this.prevHeading = this.heading;
    if (this.waterCooldown > 0) this.waterCooldown -= dt;
    if (this.obstacleCooldown > 0) this.obstacleCooldown -= dt;
    if (this.deckCooldown > 0) this.deckCooldown -= dt;

    const p = this.p;
    const v = this.v;
    const ocean = ctx.ocean;
    this.sea = ocean?.heightAt ? ocean.heightAt(p.x, p.z) : 0;

    if (h.crash && h.crash.phase === 'ditched') return this._float(dt);
    if (h.landed) return this._landed(dt);

    // --- environment ---------------------------------------------------------------------------
    const st = ctx.weather?.state || {};
    const altSea = Math.max(0, p.y - this.sea);
    const prof = profile(altSea);
    const W = this._w.set(0, 0);
    if (ctx.weather?.windAt) ctx.weather.windAt(p.x, p.z, W);
    const T = st.turbulence || 0;
    const t = this.time;
    const n1 = this.noise(t * 0.9, 3.7);
    const n2 = this.noise(t * 0.9, 41.3);
    this.turb = Math.abs(n1) * T;
    this.windEff.set((W.x + T * n1) * prof * C_WIND, (W.y + T * n2) * prof * C_WIND);
    const ks = 1 - Math.exp(-dt / 2); // assist sees the wind smoothed over τ 2 s
    this.windSmooth.x += (this.windEff.x - this.windSmooth.x) * ks;
    this.windSmooth.y += (this.windEff.y - this.windSmooth.y) * ks;
    const F = this.force.set(0, 0, 0);
    if (ctx.hazards?.forceAt) ctx.hazards.forceAt(p.x, p.z, altSea, F);
    if (!Number.isFinite(F.x + F.y + F.z)) F.set(0, 0, 0);

    // --- controls -------------------------------------------------------------------------------
    let ux = h.uMove.x;
    let uy = h.uMove.y;
    if (h.winch.state !== 'stowed') {
      ux *= 0.45;
      uy *= 0.45;
    }
    const crashing = !!h.crash;
    if (h.autorotation || crashing) {
      ux *= 0.5;
      uy *= 0.5;
    }
    if (h.hull < 0.25) {
      const j = 1 + 0.05 * this.noise(t * 6.0, 77.7);
      ux *= j;
      uy *= j;
    }
    const uMag = Math.min(1, Math.hypot(ux, uy));
    h.uMag = uMag;
    const rpmAuth = THREE.MathUtils.smoothstep(h.rotorRPM, 0.55, 0.88);
    const passengers = h.cabin.length;
    const A = A_BASE * (h.boosting ? 1.4 : 1) * h.thrustFactor * (1 - 0.02 * passengers) * rpmAuth;

    // --- stabilisation assist (only with the stick centred; off during EMP) ----------------------
    let assist = crashing ? 'off' : ctx.settings.get('assist') || 'standard';
    if (h.emp > 0) assist = 'off';
    const centred = 1 - THREE.MathUtils.smoothstep(uMag, 0.05, 0.35);
    let asx = 0;
    let asz = 0;
    if (assist === 'full') {
      asx = -K * this.windSmooth.x - 0.8 * v.x;
      asz = -K * this.windSmooth.y - 0.8 * v.z;
      const lim = 0.6 * A_BASE * rpmAuth;
      const l = Math.hypot(asx, asz);
      if (l > lim) {
        asx *= lim / l;
        asz *= lim / l;
      }
    } else if (assist === 'standard') {
      asx = -0.7 * K * this.windSmooth.x;
      asz = -0.7 * K * this.windSmooth.y;
    }
    asx *= centred * rpmAuth;
    asz *= centred * rpmAuth;

    // --- horizontal integration --------------------------------------------------------------------
    const tx = A * ux + asx;
    const tz = -A * uy + asz;
    this.thrust.set(tx, tz);
    v.x += (tx + K * (this.windEff.x - v.x) + F.x) * dt;
    v.z += (tz + K * (this.windEff.y - v.z) + F.z) * dt;
    p.x += v.x * dt;
    p.z += v.z * dt;

    // --- nose (spring ω 7, ≤ 2 rad/s) ---------------------------------------------------------------
    if (crashing) {
      this.yawRate += (0.9 - this.yawRate) * (1 - Math.exp(-dt * 1.5)); // tail rotor gone: slow spin
    } else if (this.noseTarget !== null) {
      const err = wrapAngle(this.noseTarget - this.heading);
      this.yawRate += (49 * err - 14 * this.yawRate) * dt;
    } else {
      this.yawRate *= Math.exp(-dt * 8);
    }
    this.yawRate = clamp(this.yawRate, -2, 2);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // --- vertical -------------------------------------------------------------------------------------
    let vyCmd;
    const pad = ctx.world?.padAt?.(p.x, p.z) || null;
    const deckY = pad && pad.position ? pad.position.y : -Infinity;
    if (crashing) {
      const left = Math.max(0.4, 3 - h.crash.t);
      vyCmd = -Math.max(6, (p.y - SKID - this.sea) / left);
    } else if (h.autorotation) {
      vyCmd = -6;
      // flare over a deck: the one chance to land without fuel
      if (pad && p.y - SKID - deckY < 9) vyCmd = -1.8;
    } else {
      vyCmd = clamp((h.altTarget - p.y) * 1.2, -6, 7) + (F.y || 0) + T * 0.35 * this.noise(t * 0.6, 12.1);
      if (assist === 'full' && h.winch.state !== 'stowed') {
        const floor = this.sea + 3 + SKID; // soft floor: crest + 3 m
        vyCmd = Math.max(vyCmd, (floor - p.y) * 1.2);
      }
      // Deck flare (assist on): the sink rate eases off over a pad so a held «down» ends in a soft
      // touchdown (~1.2 m/s) instead of a hard landing. With assist off the pilot does it by hand.
      if (pad && assist !== 'off') {
        const above = Math.max(0, p.y - SKID - deckY);
        if (above < 14) vyCmd = Math.max(vyCmd, -(0.8 + 0.45 * above));
      }
    }
    vyCmd *= crashing || h.autorotation ? 1 : 0.15 + 0.85 * rpmAuth;
    const dv = vyCmd - v.y;
    const maxDv = (crashing ? 12 : 6) * dt;
    v.y += clamp(dv, -maxDv, maxDv);
    p.y += v.y * dt;
    if (p.y > 122) {
      p.y = 122;
      if (v.y > 0) v.y = 0;
    }

    this._surfaces(dt, pad, deckY);
  }

  // Decks, water strikes, obstacles.
  _surfaces(dt, pad, deckY) {
    const h = this.h;
    const ctx = this.ctx;
    const p = this.p;
    const v = this.v;
    const skid = p.y - SKID;
    const prevSkid = this.prevP.y - SKID;
    this.surface = Math.max(this.sea, deckY);

    // --- pad decks (moving / tilting) ----------------------------------------------------------------
    if (pad && skid < deckY) {
      const pv = this.padVel(pad, this._pv);
      if (h.crash && prevSkid >= deckY - 0.7) {
        // the failing heli comes down on a deck instead of the water
        p.y = deckY + SKID;
        h.ops.ditch(h.crash.reason, pad);
        return;
      }
      if (prevSkid >= deckY - 0.7) {
        const relVy = v.y - pv.y;
        if (this.contactPad !== pad) {
          const tilt = Math.abs(pad.tilt || 0);
          if (relVy < -5) {
            h.damage(0.15, 'landing');
            v.y = pv.y + 3;
          } else if (relVy < -2.5) {
            h.damage(0.05, 'landing');
          }
          if (tilt > D5 && this.deckCooldown <= 0 && pad.type === 'ship') {
            h.damage(0.08, 'deck');
            v.y = pv.y + 2.5;
            this.deckCooldown = 1.5;
          }
          h.onTouch?.(pad, relVy);
        }
        this.contactPad = pad;
        p.y = deckY + SKID;
        if (v.y < pv.y) v.y = pv.y;
        // skid friction on the deck
        const f = Math.min(1, 6 * dt);
        v.x += (pv.x - v.x) * f;
        v.z += (pv.z - v.z) * f;
      } else {
        // flew into the side of the deck structure from below
        this._bump(pad.position.x, pad.position.z, pad.radius || 12, 'obstacle');
      }
    } else if (!pad || skid > deckY + 0.25) {
      this.contactPad = null;
    }

    // Landing criteria: inside the circle, vy < 2.5, rel. horizontal < 3, deck tilt < 12°, held 1 s.
    if (this.contactPad && !h.crash) {
      const cp = this.contactPad;
      const pv = this.padVel(cp, this._pv);
      const relH = Math.hypot(v.x - pv.x, v.z - pv.z);
      const ok = relH < 3 && Math.abs(v.y - pv.y) < 2.5 && Math.abs(cp.tilt || 0) < D12 && h.altTarget <= p.y + 0.6;
      this.landTimer = ok ? this.landTimer + dt : 0;
      if (this.landTimer >= 1.0) {
        this.landTimer = 0;
        h.ops.land(cp);
        return;
      }
    } else this.landTimer = 0;

    // --- water ------------------------------------------------------------------------------------------
    if (skid < this.sea && !this.contactPad) {
      if (h.crash || h.autorotation) {
        h.ops.ditch(h.crash ? h.crash.reason : 'fuel');
        return;
      }
      if (this.waterCooldown <= 0) {
        this.waterCooldown = 1;
        h.damage(0.06 + 0.02 * Math.abs(v.y), 'water');
        v.y = 4;
        h.onWaterStrike?.(p.x, p.z, Math.abs(v.y));
      }
      p.y = Math.max(p.y, this.sea + SKID - 0.3);
    }

    // --- obstacles (rig derrick, lighthouse, masts, fog rocks) ----------------------------------------
    const obs = ctx.world?.obstacles;
    if (obs && obs.length) {
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (skid >= (o.top ?? Infinity)) continue;
        if (this._bump(o.x, o.z, (o.radius || 2) + OBSTACLE_MARGIN, 'obstacle', true)) break;
      }
    }
  }

  // Push out of a cylinder (x, z, R) with a bounce; damage 15 % with a 1 s cooldown.
  _bump(x, z, R, source, cylinderIsOuter = true) {
    const p = this.p;
    const v = this.v;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    if (!cylinderIsOuter || d >= R) return false;
    const nx = d > 1e-3 ? dx / d : 1;
    const nz = d > 1e-3 ? dz / d : 0;
    p.x = x + nx * R;
    p.z = z + nz * R;
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) {
      v.x -= nx * vn * 1.7;
      v.z -= nz * vn * 1.7;
    }
    v.x += nx * 2;
    v.z += nz * 2;
    if (this.obstacleCooldown <= 0) {
      this.obstacleCooldown = 1;
      this.h.damage(0.15, source);
    }
    return true;
  }

  // Sitting on a pad: carried by the moving / turning deck; services handled by HeliOps.
  _landed(dt) {
    const h = this.h;
    const pad = h.landed;
    const p = this.p;
    if (!pad || !pad.position) {
      h.landed = null;
      return;
    }
    const ph = pad.heading || 0;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const ox = this.landOffset.x;
    const oz = this.landOffset.y;
    p.x = pad.position.x + ox * c - oz * s;
    p.z = pad.position.z + ox * s + oz * c;
    p.y = pad.position.y + SKID;
    this.heading = wrapAngle(this.landHeading + (ph - this.landPadHeading));
    this.padVel(pad, this.v);
    this.yawRate = 0;
    this.thrust.set(0, 0);
    this.surface = pad.position.y;
    // Lift-off: commanded altitude above the deck and the rotor at flight RPM.
    if (this.ctx.mode === 'play' && h.alive && h.altTarget > p.y + 0.8 && h.rotorRPM > 0.8 && !h.autorotation) {
      h.ops.takeoff();
      this.v.y = 1.5;
      this.contactPad = pad;
    }
  }

  // Ditched: bob on the swell, drift slowly (or sit wrecked on the deck it came down on).
  _float(dt) {
    const p = this.p;
    const v = this.v;
    const deck = this.h.crash.deck;
    if (deck && deck.position) {
      const ph = deck.heading || 0;
      const c = Math.cos(ph);
      const s = Math.sin(ph);
      p.x = deck.position.x + this.landOffset.x * c - this.landOffset.y * s;
      p.z = deck.position.z + this.landOffset.x * s + this.landOffset.y * c;
      p.y = deck.position.y + SKID;
      v.set(0, 0, 0);
      this.thrust.set(0, 0);
      this.surface = deck.position.y;
      return;
    }
    const target = this.sea + 0.55;
    p.y += (target - p.y) * Math.min(1, dt * 3);
    v.x *= Math.exp(-dt * 0.9);
    v.z *= Math.exp(-dt * 0.9);
    v.y = 0;
    p.x += v.x * dt;
    p.z += v.z * dt;
    this.yawRate *= Math.exp(-dt * 0.6);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.thrust.set(0, 0);
    this.surface = this.sea;
  }
}
