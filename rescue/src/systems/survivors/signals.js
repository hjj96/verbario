// Distress signals (DESIGN §2.10 signal table, §3.10 tools table, §4 #19, #20, #24):
//   red parachute rocket  — rotor heard (< 700 m), nobody has seen them: every 30–45 s, 2–3 per group;
//                           «СИГНАЛ» for 20 s with ±20 m accuracy (fx.burst('rocket'))
//   orange smoke (day)    — lit when the heli is closer than 400 m, burns 60 s, seen from 500 m (fx.smoke)
//   handheld flare (night)— 15 Hz red flicker, pooled light, smoke lit red (fx.flare follows the hand)
//   whistle               — unseen within 150 m: every 4–7 s (positional sound + HUD arc ±15°)
//   EPIRB                 — bearing ping within 2 km, error 30°·clamp(d/1500) + noise (radar)
//   dye (fluorescein)     — released when the rotor is heard; patch grows 10 → 25 m, stretched downwind
//   mirror (sunny)        — star flash (150 ms, ×10) every 3–6 s while the heli is within 300 m
//   loudspeaker answers   — unseen within 180 m answer 1–2 s later with a whistle or a shout
// Every signal is mirrored by `survivor:signal {s, kind, x, z, error, arc?}` so HUD arcs and the
// audio play in sync; shouts by `survivor:shout {s, reason}`.
import * as THREE from 'three';
import { SIG, TYPES, clamp01 } from './tables.js';

const _p = new THREE.Vector3();

const num = (v, d) => (v === true ? Math.max(1, d) : Number.isFinite(v) ? v : d);

export function initSignals(s, entry, rng) {
  const d = entry.signals || {};
  const t = s.type;
  s.sig = {
    rockets: num(d.rockets, t === 'raft' ? 2 : 0),
    rocketT: -1,
    fired: 0,
    smoke: d.smoke ? num(d.smoke, 1) : 0,
    smokeBurn: 0,
    flares: num(d.flares ?? d.flare, t === 'raft' || t === 'hull' ? 1 : 0),
    flareBurn: 0,
    flareObj: null,
    whistle: d.whistle ?? (t === 'swimmer' || t === 'injured'),
    whistleT: 1 + rng.next() * 3,
    dye: !!d.dye,
    dyeT: -1,
    dyeStampT: 0,
    mirror: !!d.mirror,
    mirrorT: 1 + rng.next() * 2,
    mirrorFlash: 0,
    epirb: !!d.epirb,
    epirbT: rng.next() * 3,
    epirbError: 0,
    strobe: d.strobe, // undefined → swimmers and the injured switch theirs on at night
    hornT: -1,
  };
}

// Is the personal strobe on for this group right now?
export function strobeOn(s, night) {
  if (s.sig.strobe === false) return false;
  if (s.sig.strobe === true) return true; // equipped and switched on (useless by day, but it blinks)
  return (s.type === 'swimmer' || s.type === 'injured') && night > 0.45;
}

export class SignalDesk {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
  }

  // Per frame for every active group. env: Survivors' frame snapshot; d: horizontal distance to heli.
  update(s, env, dt, d) {
    const sig = s.sig;
    const rng = this.sys.rng;
    const heli = env.heliAlive;
    const unseen = !s.spotted;
    const play = env.play;

    // --- burning things tick down regardless of who is looking -----------------------------------
    if (sig.smokeBurn > 0) {
      sig.smokeBurn -= dt;
      this._smokeTick(s, env, dt);
    }
    if (sig.flareBurn > 0) {
      sig.flareBurn -= dt;
      if (sig.flareBurn <= 0) sig.flareObj = null;
    }
    if (sig.mirrorFlash > 0) sig.mirrorFlash -= dt;
    if (sig.dyeT >= 0) {
      sig.dyeT += dt;
      this._dyeTick(s, env, dt);
    }
    if (!play || !heli) return;

    // --- red parachute rockets ---------------------------------------------------------------------
    const heard = d < SIG.hearRotor;
    if (unseen && sig.rockets > 0 && heard) {
      if (sig.rocketT < 0) sig.rocketT = 2 + rng.next() * 3; // reaction time after the first rotor sound
      sig.rocketT -= dt;
      if (sig.rocketT <= 0) {
        this.fire(s, 'rocket', env);
        sig.rocketT = SIG.rocketGap[0] + rng.next() * (SIG.rocketGap[1] - SIG.rocketGap[0]);
      }
    } else if (!heard && sig.fired === 0) sig.rocketT = -1;

    // --- orange smoke by day --------------------------------------------------------------------------
    if (unseen && sig.smoke > 0 && sig.smokeBurn <= 0 && env.night < 0.45 && d < SIG.smokeAt) this.fire(s, 'smoke', env);

    // --- handheld flare at night ------------------------------------------------------------------------
    if (unseen && sig.flares > 0 && sig.flareBurn <= 0 && env.night >= 0.45 && d < SIG.flareAt) this.fire(s, 'flare', env);

    // --- whistle ------------------------------------------------------------------------------------------
    if (unseen && sig.whistle && d < SIG.whistleAt && s.health > 0.1) {
      sig.whistleT -= dt;
      if (sig.whistleT <= 0) {
        this.fire(s, 'whistle', env);
        sig.whistleT = SIG.whistleGap[0] + rng.next() * (SIG.whistleGap[1] - SIG.whistleGap[0]);
      }
    }

    // --- EPIRB bearing ping ---------------------------------------------------------------------------------
    if (sig.epirb && unseen && d < SIG.epirbRange) {
      sig.epirbT -= dt;
      if (sig.epirbT <= 0) {
        sig.epirbT = SIG.epirbGap;
        sig.epirbError = 30 * clamp01(d / 1500) + (rng.next() - 0.5) * 6;
        const p = s.position;
        // the ping carries a bearing from the heli with an error, not a position
        const a = Math.atan2(p.x - env.hx, -(p.z - env.hz)) + (sig.epirbError * Math.PI) / 180;
        this.sys._emitSignal(s, 'epirb', env.hx + Math.sin(a) * d, env.hz - Math.cos(a) * d, d * Math.tan((Math.abs(sig.epirbError) * Math.PI) / 180), Math.abs(sig.epirbError), false);
      }
    }

    // --- dye: released when they hear the rotor -------------------------------------------------------------
    if (sig.dye && sig.dyeT < 0 && d < SIG.dyeHear) this.fire(s, 'dye', env);

    // --- mirror flashes (sunny presets) ------------------------------------------------------------------------
    if (sig.mirror && env.sunny && d < SIG.mirrorRange && d > 30 && s.health > 0.15) {
      sig.mirrorT -= dt;
      if (sig.mirrorT <= 0) {
        this.fire(s, 'mirror', env);
        sig.mirrorT = SIG.mirrorGap[0] + rng.next() * (SIG.mirrorGap[1] - SIG.mirrorGap[0]);
      }
    }

    // --- loudspeaker answer -----------------------------------------------------------------------------------
    if (sig.hornT >= 0) {
      sig.hornT -= dt;
      if (sig.hornT < 0) {
        this.sys._emit('survivor:shout', { s, reason: 'loudspeaker' });
        if (sig.whistle) this.fire(s, 'whistle', env);
        else this.sys._emitSignal(s, 'whistle', s.position.x, s.position.z, 15, SIG.whistleArc, true, 'shout');
      }
    }
  }

  // Fire a signal now (also used by mission scripts via survivors.fireSignal). Returns true if fired.
  fire(s, kind, env, scripted = false) {
    const sys = this.sys;
    const ctx = this.ctx;
    const sig = s.sig;
    const rng = sys.rng;
    const p = s.position;
    switch (kind) {
      case 'rocket': {
        if (sig.rockets <= 0 && !scripted) return false;
        sig.rockets = Math.max(0, sig.rockets - 1);
        sig.fired++;
        _p.set(p.x, (s.deckY ?? p.y) + 1.2, p.z);
        ctx.fx?.burst?.('rocket', _p, { color: '#FF3A22' });
        const e = SIG.rocketError;
        sys._emitSignal(s, 'rocket', p.x + (rng.next() - 0.5) * 2 * e, p.z + (rng.next() - 0.5) * 2 * e, e, 0, true);
        return true;
      }
      case 'smoke': {
        if (sig.smoke <= 0 && !scripted) return false;
        sig.smoke = Math.max(0, sig.smoke - 1);
        sig.smokeBurn = SIG.smokeBurn;
        sys._emitSignal(s, 'smoke', p.x + (rng.next() - 0.5) * 16, p.z + (rng.next() - 0.5) * 16, 10, 0, true);
        return true;
      }
      case 'flare': {
        if (sig.flares <= 0 && !scripted) return false;
        sig.flares = Math.max(0, sig.flares - 1);
        sig.flareBurn = SIG.flareBurn;
        sig.flareObj = ctx.fx?.flare ? ctx.fx.flare(p.x, p.z, { life: SIG.flareBurn, held: true }) : null;
        sys._emitSignal(s, 'flare', p.x + (rng.next() - 0.5) * 20, p.z + (rng.next() - 0.5) * 20, 12, 0, true);
        return true;
      }
      case 'whistle': {
        const d = Math.hypot(p.x - (env?.hx ?? p.x), p.z - (env?.hz ?? p.z));
        const err = Math.max(4, d * Math.tan((SIG.whistleArc * Math.PI) / 180));
        sys._emitSignal(s, 'whistle', p.x, p.z, err, SIG.whistleArc, true);
        return true;
      }
      case 'dye': {
        sig.dye = true;
        sig.dyeT = 0;
        sig.dyeStampT = 0;
        sys._emitSignal(s, 'dye', p.x, p.z, 25, 0, false);
        return true;
      }
      case 'mirror': {
        sig.mirrorFlash = SIG.mirrorFlash;
        sys._emitSignal(s, 'mirror', p.x, p.z, 8, 0, false);
        return true;
      }
      case 'strobe':
        sig.strobe = true;
        return true;
      case 'epirb':
        sig.epirb = true;
        sig.epirbT = 0;
        return true;
      default:
        return false;
    }
  }

  _smokeTick(s, env, dt) {
    const fx = this.ctx.fx;
    if (!fx?.smoke || !(dt > 0)) return;
    const p = s.position;
    const y = (s.deckY ?? p.y) + (s.type === 'swimmer' || s.type === 'injured' ? 0.5 : 1.2);
    // the canister fades in its last seconds
    const k = Math.min(1, s.sig.smokeBurn / 6);
    fx.smoke(p.x, y, p.z, '#FF7B2E', dt * 7 * k);
  }

  // Fluorescein: a patch growing 10 → 25 m over ~90 s, stretched downwind (ocean water memory, G).
  _dyeTick(s, env, dt) {
    const sig = s.sig;
    const ocean = this.ctx.ocean;
    if (!ocean?.stamp || !(dt > 0) || sig.dyeT > 240) return;
    sig.dyeStampT -= dt;
    if (sig.dyeStampT > 0) return;
    sig.dyeStampT = 1.2;
    const r = 5 + 7.5 * clamp01(sig.dyeT / 90); // radius → diameter 10 → 25 m
    const p = s.position;
    const k = 0.35 * (1 - clamp01((sig.dyeT - 180) / 60));
    ocean.stamp('dye', p.x, p.z, { radius: r * 0.8, strength: k });
    ocean.stamp('dye', p.x + env.windDirX * r * 0.7, p.z + env.windDirZ * r * 0.7, { radius: r * 0.75, strength: k * 0.8 });
    ocean.stamp('dye', p.x + env.windDirX * r * 1.5, p.z + env.windDirZ * r * 1.5, { radius: r * 0.6, strength: k * 0.55 });
  }

  // Detection helpers (DESIGN §3.10): is a burning signal visible from the heli at distance d?
  seen(s, env, d) {
    const sig = s.sig;
    if (sig.smokeBurn > 0 && d < SIG.smokeSpot && env.night < 0.6) return 'smoke';
    if (sig.flareBurn > 0 && d < SIG.flareSpot) return 'flare';
    if (sig.dyeT > 4 && env.night < 0.5 && env.alt > SIG.dyeMinAlt && d < SIG.dyeSpot) return 'dye';
    if (sig.mirrorFlash > 0 && d < SIG.mirrorRange) return 'mirror';
    return null;
  }
}

export { TYPES };
