// Helicopter operations: fuel & BINGO (§3.7), boost / engine temperature (§3.3), hull (§3.8),
// pads — landing, unload, refuel, repair, resupply (§3.9), consumables (rafts, flares, loudspeaker),
// crash / ditching sequence (§3.15).
import * as THREE from 'three';

const DIFF = { cadet: 0.6, pilot: 1, ace: 1.3 };
const CRUISE = 30; // m/s airspeed assumed for the BINGO estimate
const UNLOAD_PERSON = 1;
const UNLOAD_STRETCHER = 3;
const FLARES = 4;
const RAFTS = 2;
const FLARE_RANGE = 120;
const HORN_COOLDOWN = 6;

export class HeliOps {
  constructor(heli) {
    this.h = heli;
    this.ctx = heli.ctx;
    this.bingoT = 0;
    this.fuelLevel = 'ok'; // last emitted fuel level
    this.bingoWarned = false;
    this.unloadT = 0;
    this.unloaded = [];
    this.refueling = false;
    this.resupplyT = 0;
    this.hornT = 0;
    this.floodT = 0;
    this.overheatT = 0;
    this.crewRocketT = -1;
    this.flights = []; // thrown flares in the air
    this.drops = []; // packed rafts falling to the water
    this._v2 = new THREE.Vector2();
    this._v3 = new THREE.Vector3();
  }

  reset() {
    const h = this.h;
    this.bingoT = 0;
    this.fuelLevel = 'ok';
    this.bingoWarned = false;
    this.unloadT = 0;
    this.unloaded = [];
    this.refueling = false;
    this.resupplyT = 0;
    this.hornT = 0;
    this.floodT = 0;
    this.overheatT = 0;
    this.crewRocketT = -1;
    this.flights.length = 0;
    this.drops.length = 0;
    h.flares = FLARES;
    h.rafts = RAFTS;
  }

  // ---------------------------------------------------------------------------------------------
  // Per fixed step.
  step(dt) {
    const h = this.h;
    const ctx = this.ctx;
    const play = ctx.mode === 'play';
    if (this.hornT > 0) this.hornT -= dt;
    if (this.floodT > 0) this.floodT -= dt;
    if (h.emp > 0) h.emp = Math.max(0, h.emp - dt);

    // --- crash sequence -------------------------------------------------------------------------
    if (h.crash) {
      h.crash.t += dt;
      if (h.crash.phase === 'autorot' && h.crash.t > 6) this.ditch(h.crash.reason); // safety: normally the water ends it at ~3 s
      if (h.crash.phase === 'ditched' && this.crewRocketT >= 0) {
        this.crewRocketT += dt;
        if (this.crewRocketT > 2.6) {
          this.crewRocketT = -1;
          const p = h.position;
          // The crew's own raft fires a red rocket: now they are the ones being rescued.
          if (ctx.fx?.burst) ctx.fx.burst('rocket', this._v3.set(p.x + 4, 0, p.z + 3), { color: '#FF3A22' });
          else ctx.fx?.flare?.(p.x + 4, p.z + 3);
        }
      }
      h.boosting = false;
      return;
    }

    // --- engine temperature / boost ---------------------------------------------------------------
    const st = ctx.weather?.state || {};
    if (this.overheatT > 0) {
      this.overheatT -= dt;
      h.boosting = false;
      if (this.overheatT <= 0) h.engineTemp = 60;
    } else {
      h.boosting = play && h.boostHeld && h.fuel > 0 && !h.landed;
      if (h.boosting) h.engineTemp += 12 * dt;
      else h.engineTemp -= ((st.rain || 0) > 0.3 ? 14 : 10) * dt;
      if (h.engineTemp >= 100) {
        h.engineTemp = 100;
        this.overheatT = 6;
        h.boosting = false;
        ctx.events.emit('heli:overheat', {});
      }
    }
    h.engineTemp = Math.max(0, Math.min(100, h.engineTemp));
    h.overheat = Math.max(0, this.overheatT);
    h.boost = h.boosting;

    // --- thrust factor ---------------------------------------------------------------------------
    let tf = 1;
    if (h.hull < 0.25) tf = 0.9;
    if (this.overheatT > 0) tf = Math.min(tf, 0.6);
    if (this.floodT > 0) tf = Math.min(tf, 0.6);
    if (this._inVortexCore()) tf = Math.min(tf, 0.4);
    h.thrustFactor = tf;

    // --- fuel --------------------------------------------------------------------------------------
    if (play && !h.landed && h.fuel > 0) {
      let burn = 0.3 + 0.25 * (h.uMag || 0) + 0.6 * (h.boosting ? 1 : 0) + 0.01 * h.cabin.length;
      const r = ctx.mission?.def?.area?.radius;
      if (r && Math.hypot(h.position.x, h.position.z) > r) burn *= 1.5;
      h.fuelBurn = burn;
      h.fuel = Math.max(0, h.fuel - (burn / 100) * dt);
      this._fuelLevels();
      if (h.fuel <= 0 && !h.autorotation) {
        h.autorotation = true;
        ctx.events.emit('heli:autorotation', {});
      }
    }
    if (h.autorotation && h.fuel > 0.001) h.autorotation = false;

    // --- BINGO: fuel to the nearest pad with headwind + 10 %, every 0.5 s --------------------------
    this.bingoT -= dt;
    if (this.bingoT <= 0) {
      this.bingoT = 0.5;
      this._bingo();
    }

    // --- on a pad: unload, refuel, repair, resupply ------------------------------------------------
    if (h.landed) this._padServices(dt);

    // --- thrown flares, falling rafts -------------------------------------------------------------
    this._stepFlares(dt);
    this._stepDrops(dt);
  }

  _inVortexCore() {
    const list = this.ctx.hazards?.list;
    if (!list || !list.length) return false;
    const p = this.h.position;
    for (const z of list) {
      if (!z || !z.position || (z.type !== 'waterspout' && z.type !== 'tornado')) continue;
      const rc = z.coreRadius || z.rc || z.core || (z.type === 'tornado' ? 35 : 15);
      if (Math.hypot(z.position.x - p.x, z.position.z - p.z) < rc && (z.stage === undefined || z.stage >= 4)) return true;
    }
    return false;
  }

  _fuelLevels() {
    const h = this.h;
    const f = h.fuel;
    const level = f <= 0 ? 'empty' : f <= 0.1 ? 'critical' : f <= 0.25 ? 'low' : 'ok';
    const rank = { ok: 0, low: 1, critical: 2, empty: 3 };
    if (rank[level] > rank[this.fuelLevel]) this.ctx.events.emit('heli:fuel-low', { fuel: f, level });
    this.fuelLevel = level;
  }

  _bingo() {
    const h = this.h;
    const ctx = this.ctx;
    const world = ctx.world;
    const p = h.position;
    const pad = world?.nearestPad ? world.nearestPad(p.x, p.z) : null;
    if (!pad || !pad.position) {
      h.bingo = 0.1;
      return;
    }
    const dx = pad.position.x - p.x;
    const dz = pad.position.z - p.z;
    const d = Math.hypot(dx, dz);
    let along = 0;
    if (d > 1 && ctx.weather?.windAt) {
      const w = ctx.weather.windAt(p.x, p.z, this._v2);
      const prof = Math.min(1.4, Math.max(0.6, 0.6 + 0.008 * 40));
      along = ((w.x * dx + w.y * dz) / d) * prof * 0.6;
    }
    const gs = Math.max(6, CRUISE + along);
    let burn = 0.55 + 0.01 * h.cabin.length;
    const r = ctx.mission?.def?.area?.radius;
    if (r && Math.hypot(p.x, p.z) > r) burn *= 1.5;
    h.bingo = Math.min(1, ((d / gs) * burn) / 100 + 0.1);
    h.bingoPad = pad;
    if (!h.landed && h.fuel <= h.bingo && !this.bingoWarned && ctx.mode === 'play') {
      this.bingoWarned = true;
      ctx.events.emit('heli:fuel-low', { fuel: h.fuel, level: 'bingo', pad });
    }
    if (h.fuel > h.bingo + 0.05) this.bingoWarned = false;
  }

  // ---------------------------------------------------------------------------------------------
  damage(amount, source) {
    const h = this.h;
    const ctx = this.ctx;
    if (!(amount > 0) || !h.alive || h.crash || ctx.mode !== 'play') return;
    let amt = amount * (DIFF[ctx.settings.get('difficulty')] || 1);
    if (h.firstHit) {
      amt *= 0.5; // «тебя предупреждали»
      h.firstHit = false;
    }
    h.hull = Math.max(0, h.hull - amt);
    h.damageTaken += amt;
    if (/rogue|wave/.test(String(source))) this.floodT = 3; // intake flooded: thrust ×0.6 for 3 s
    if (/lightning|strike/.test(String(source))) h.emp = Math.max(h.emp, 4);
    ctx.events.emit('heli:damage', { amount: amt, source, hull: h.hull });
    if (h.hull <= 0) this.startCrash('hull');
  }

  // ---------------------------------------------------------------------------------------------
  land(pad) {
    const h = this.h;
    const f = h.flight;
    h.landed = pad;
    f.attachTo(pad);
    f.v.set(0, 0, 0);
    f.contactPad = pad;
    h.altTarget = f.p.y;
    this.unloadT = 0;
    this.unloaded = [];
    this.resupplyT = 0;
    this.refueling = false;
    const auto = h.autorotation;
    this.ctx.events.emit('heli:land', { pad, autorotation: auto, vy: f.lastVy || 0 });
  }

  takeoff() {
    const h = this.h;
    const pad = h.landed;
    if (!pad) return;
    this._finishUnload(pad);
    if (this.refueling) {
      this.refueling = false;
      this.ctx.events.emit('heli:refuel', { pad, state: 'stop', fuel: h.fuel });
    }
    h.landed = null;
    this.ctx.events.emit('heli:takeoff', { pad });
  }

  _padServices(dt) {
    const h = this.h;
    const ctx = this.ctx;
    const pad = h.landed;
    if (ctx.mode !== 'play') return;
    // Unload: 1 s per person, 3 s per stretcher → heli:unload {pad, count, people}.
    if (h.cabin.length) {
      this.unloadT += dt;
      const first = h.cabin[0];
      const need = first.stretcher ? UNLOAD_STRETCHER : UNLOAD_PERSON;
      if (this.unloadT >= need) {
        this.unloadT = 0;
        h.cabin.shift();
        this.unloaded.push(first);
        ctx.events.emit('heli:unload-person', { pad, person: first, left: h.cabin.length });
        if (!h.cabin.length) this._finishUnload(pad);
      }
    }
    const sv = pad.services || {};
    // Refuel (%/s from pad.services.fuel; legacy pad.refuel → 10 %/s).
    const rate = sv.fuel !== undefined ? sv.fuel : pad.refuel ? 10 : 0;
    if (rate > 0 && h.fuel < 1) {
      if (!this.refueling) {
        this.refueling = true;
        ctx.events.emit('heli:refuel', { pad, state: 'start', fuel: h.fuel });
      }
      h.fuel = Math.min(1, h.fuel + (rate / 100) * dt);
      if (h.fuel >= 1) {
        this.refueling = false;
        this.fuelLevel = 'ok';
        ctx.events.emit('heli:refuel', { pad, state: 'done', fuel: 1 });
      }
    }
    h.refueling = this.refueling;
    // Repair (lighthouse only, 4 %/s).
    if (sv.repair > 0 && h.hull < 1) h.hull = Math.min(1, h.hull + (sv.repair / 100) * dt);
    // Resupply: flares and rafts back to full after a moment on the deck.
    if (sv.resupply || (sv.resupply === undefined && pad.refuel && pad.type !== 'rig')) {
      this.resupplyT += dt;
      if (this.resupplyT > 1.5 && (h.flares < FLARES || h.rafts < RAFTS)) {
        h.flares = FLARES;
        h.rafts = RAFTS;
        ctx.events.emit('heli:resupply', { pad });
      }
    }
  }

  _finishUnload(pad) {
    if (!this.unloaded.length) return;
    const people = this.unloaded;
    this.unloaded = [];
    this.ctx.events.emit('heli:unload', { pad, count: people.length, people });
  }

  // ---------------------------------------------------------------------------------------------
  // Consumables (called on button presses in 'play').
  flare() {
    const h = this.h;
    if (h.flares <= 0 || h.crash) return false;
    const p = h.position;
    const a = h.aim;
    let dx = a.x - p.x;
    let dz = a.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > FLARE_RANGE) {
      dx *= FLARE_RANGE / d;
      dz *= FLARE_RANGE / d;
    }
    h.flares--;
    const T = 0.7 + (Math.min(d, FLARE_RANGE) / FLARE_RANGE) * 0.9;
    const ox = p.x + Math.sin(h.heading) * 0.5;
    const oz = p.z - Math.cos(h.heading) * 0.5;
    this.flights.push({ x0: ox, y0: p.y - 1, z0: oz, x1: p.x + dx, z1: p.z + dz, t: 0, T, x: ox, y: p.y - 1, z: oz });
    this.ctx.events.emit('heli:flare-throw', { x: p.x + dx, z: p.z + dz, eta: T });
    return true;
  }

  _stepFlares(dt) {
    const ctx = this.ctx;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.T);
      const sea = ctx.ocean?.heightAt ? ctx.ocean.heightAt(f.x1, f.z1) : 0;
      f.x = f.x0 + (f.x1 - f.x0) * k;
      f.z = f.z0 + (f.z1 - f.z0) * k;
      // ballistic-looking arc: small lob, then falls
      f.y = f.y0 + (sea - f.y0) * k * k + 6 * k * (1 - k);
      if (k >= 1) {
        this.flights.splice(i, 1);
        ctx.fx?.flare?.(f.x1, f.z1);
        ctx.ocean?.splash?.(f.x1, f.z1, 1.2, 0.4);
        ctx.events.emit('heli:flare', { x: f.x1, z: f.z1 });
      }
    }
  }

  raftDrop() {
    const h = this.h;
    if (h.rafts <= 0 || h.landed || h.crash) return false;
    h.rafts--;
    // Pushed out of the starboard door: the packed raft falls (drifting with the heli's speed) and
    // the event fires at the splash, where survivors inflate it.
    const o = h.hoistWorld;
    const v = h.velocity;
    this.drops.push({ x: o.x, y: o.y - 0.4, z: o.z, vx: v.x + Math.cos(h.heading) * 2.5, vy: 0, vz: v.z + Math.sin(h.heading) * 2.5, spin: 0 });
    this.ctx.events.emit('heli:raft-throw', { x: o.x, z: o.z });
    return true;
  }

  _stepDrops(dt) {
    const ctx = this.ctx;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy -= 9.81 * dt;
      d.vx *= Math.exp(-0.6 * dt);
      d.vz *= Math.exp(-0.6 * dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.spin += dt * 3;
      const sea = ctx.ocean?.heightAt ? ctx.ocean.heightAt(d.x, d.z) : 0;
      if (d.y <= sea) {
        this.drops.splice(i, 1);
        ctx.ocean?.splash?.(d.x, d.z, 2.5, 0.8);
        ctx.fx?.splash?.(d.x, sea, d.z, 1.5);
        ctx.events.emit('heli:raft-drop', { x: d.x, z: d.z });
      }
    }
  }

  horn() {
    const h = this.h;
    if (this.hornT > 0 || h.crash) return false;
    this.hornT = HORN_COOLDOWN;
    this.ctx.events.emit('heli:loudspeaker', { x: h.position.x, z: h.position.z });
    return true;
  }

  get hornCooldown() {
    return Math.max(0, this.hornT);
  }

  // ---------------------------------------------------------------------------------------------
  // Crash: 3 s of controlled autorotation → ditching → heli:crash (camera does the slow-mo & rise).
  startCrash(reason) {
    const h = this.h;
    if (h.crash) return;
    if (h.winch.load) h.winchCtl._slip('crash');
    h.crash = { phase: 'autorot', t: 0, reason };
    h.landed = null;
    this.ctx.events.emit('heli:failing', { reason });
  }

  // deck: the pad the failing heli came down on (it stays there, wrecked) — otherwise the sea.
  ditch(reason = 'hull', deck = null) {
    const h = this.h;
    const ctx = this.ctx;
    if (h.crash && h.crash.phase === 'ditched') return;
    if (!h.crash) h.crash = { phase: 'ditched', t: 0, reason };
    h.crash.phase = 'ditched';
    h.crash.reason = reason;
    h.crash.t = 0;
    h.crash.deck = deck;
    h.alive = false;
    h.landed = null;
    h.setSearchlight(false);
    const f = h.flight;
    f.v.multiplyScalar(0.25);
    f.v.y = 0;
    const p = f.p;
    if (deck) {
      f.attachTo(deck);
      ctx.fx?.sparks?.(p.x, p.y - 1.4, p.z, '#FFB050', 30);
    } else {
      ctx.ocean?.splash?.(p.x, p.z, 9, 1);
      ctx.fx?.splash?.(p.x, f.sea, p.z, 4);
      ctx.fx?.spray?.(p.x, p.z, this._v2.set(0, 0), 60);
      this.crewRocketT = 0;
    }
    ctx.events.emit('heli:crash', { reason, x: p.x, z: p.z, onDeck: !!deck, pad: deck });
  }
}

