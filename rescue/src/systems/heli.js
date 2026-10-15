// Helicopter «Чайка-07» (CONTRACT: heli; DESIGN §2.9, §3.2–3.9, §3.15).
//
// Owns the procedural model (heli/model.js), the fixed-60 Hz flight model with render interpolation
// (heli/flight.js), the winch (heli/winch.js), searchlight (heli/searchlight.js), lights + water
// glints (heli/lights.js) and operations — fuel, hull, pads, consumables, crash (heli/ops.js).
//
// Public state is plain fields (read by camera, HUD, audio, survivors…); position/heading are the
// INTERPOLATED render state, so everyone sees the same smooth helicopter.
//
// Beyond the CONTRACT fields it exposes (read-only for others):
//   pitch, yawRate, vy, speed (ground m/s), airspeed, seaY, surfaceY, skidClearance, bingo (fuel
//   fraction to reach bingoPad +10 %), bingoPad, fuelBurn (%/s), overheat (s), thrustFactor,
//   autorotation, crash {phase:'autorot'|'ditched', t, reason, deck}, ditched, damageTaken, refueling,
//   seatsUsed, ceiling, aimSource, hoistWorld, downwash {x, z, radius, strength},
//   beam {on, intensity, origin, dir, hit, cosOuter, angle, length}, setSearchlight(on),
//   winch.{tension, jammed, surfaceY, height, inRange, radius, stretcher, cabinFull, denied}.
// Extra events: heli:capture {survivor}, heli:slip {survivor, reason}, heli:snag {x, z, reason:
//   'wave'|'debris', kind}, heli:winch-denied
//   {reason}, heli:cabin-full, heli:unload-person {pad, person, left}, heli:resupply {pad},
//   heli:overheat, heli:autorotation, heli:failing {reason}, heli:water-strike, heli:touchdown
//   {pad, vy}, heli:flare-throw {x, z, eta}, heli:raft-throw {x, z}. heli:refuel has state
//   'start'|'done'|'stop'; heli:land has {autorotation}; heli:crash has {x, z, onDeck, pad}.
import * as THREE from 'three';
import { clamp, wrapAngle, createNoise2D } from '../core/math.js';
import { buildHeliModel, POINTS, SKID_Y } from './heli/model.js';
import { FlightModel, STEP } from './heli/flight.js';
import { Winch } from './heli/winch.js';
import { Searchlight } from './heli/searchlight.js';
import { HeliLights } from './heli/lights.js';
import { HeliOps } from './heli/ops.js';
import { Crewman } from './heli/crewman.js';

const SKID = -SKID_Y;
const PRESETS = [15, 40, 90];
const ALT_MIN = 4;
const ALT_MAX = 120;
const IDLE_RPM = 0.55;
const MAX_TILT = 0.38;
const WHITE = new THREE.Color(1, 1, 1);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Key smoothing (DESIGN §3.2): k = 9 press / 14 release / 18 reversal.
function smoothAxis(cur, target, dt) {
  let k = 9;
  if (target * cur < 0) k = 18;
  else if (Math.abs(target) < Math.abs(cur)) k = 14;
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

export class Helicopter {
  constructor(ctx) {
    this.ctx = ctx;
    // ---- CONTRACT fields -----------------------------------------------------------------------
    this.position = new THREE.Vector3(0, 40, 0);
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.altitude = 40;
    this.fuel = 1;
    this.hull = 1;
    this.cabin = [];
    this.capacity = 6;
    this.landed = null;
    this.alive = true;
    this.searchlight = false;
    this.winch = {};
    this.rotorRPM = 1;
    this.load = 0;
    this.bank = 0;
    this.boost = false;
    this.engineTemp = 0;
    this.flares = 4;
    this.rafts = 2;
    this.emp = 0;
    this.aim = new THREE.Vector3();
    this.altTarget = 40;
    // ---- extras (documented in the report) ------------------------------------------------------
    this.pitch = 0;
    this.yawRate = 0;
    this.vy = 0;
    this.speed = 0; // ground speed m/s
    this.airspeed = 0;
    this.seaY = 0; // water height under the heli
    this.surfaceY = 0; // local surface (water or deck)
    this.skidClearance = 0;
    this.bingo = 0.1; // fuel fraction needed to reach the nearest pad (+10 %)
    this.bingoPad = null;
    this.fuelBurn = 0; // %/s
    this.overheat = 0; // seconds of overheat lock left
    this.boosting = false;
    this.boostHeld = false;
    this.thrustFactor = 1;
    this.autorotation = false;
    this.crash = null; // { phase: 'autorot' | 'ditched', t, reason }
    this.firstHit = true;
    this.damageTaken = 0;
    this.refueling = false;
    this.uMove = new THREE.Vector2(); // smoothed stick (x east, y north)
    this.uMag = 0;
    this.aimSource = 'nose'; // 'mouse' | 'stick' | 'nose'
    this.hoistWorld = new THREE.Vector3(); // cable top (physics)
    this.hoistRender = new THREE.Vector3(); // cable top (rendered)
    this.downwash = { x: 0, z: 0, radius: 9, strength: 0 };
    this.windEff = new THREE.Vector2();

    // ---- model ---------------------------------------------------------------------------------
    this.model = buildHeliModel(ctx);
    this.group = this.model.root;
    ctx.scene.add(this.group);

    this.flight = new FlightModel(this);
    this.winchCtl = new Winch(ctx, this);
    this.searchlightCtl = new Searchlight(ctx, this.model);
    this.beam = this.searchlightCtl.beam;
    this.lightsCtl = new HeliLights(ctx, this.model);
    this.ops = new HeliOps(this);
    this.crewman = new Crewman(ctx, this.model); // hoist operator in the door (DESIGN §4 #9)

    // Thermal heat sources (CONTRACT «Depth pass additions»): proxies on render layer 2 ONLY — the
    // engine bays under the cowling and the two exhaust plumes; invisible to the normal camera.
    const heatMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
    const plumeMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.55, depthWrite: false });
    this.heatProxies = [];
    for (const s of [-1, 1]) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.7), heatMat);
      bay.position.set(0.5 * s, 1.36, 1.75);
      const ex = POINTS[s < 0 ? 'exhaustL' : 'exhaustR'];
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.6, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 1.3), plumeMat);
      plume.position.copy(ex);
      plume.rotation.set(-0.2, 0.35 * s, 0);
      for (const m of [bay, plume]) {
        m.name = 'heli.heat';
        m.layers.set(2);
        m.frustumCulled = false;
        this.model.body.add(m);
        this.heatProxies.push(m);
      }
    }

    // Thrown flare visuals (small HDR embers, pooled).
    const fg = new THREE.SphereGeometry(0.28, 8, 6);
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF2A12').multiplyScalar(9) });
    this.flareMeshes = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(fg, fm);
      m.name = 'heli.flareInFlight';
      m.visible = false;
      m.layers.enable(2); // burning flare: a heat source for the thermal view
      ctx.scene.add(m);
      this.flareMeshes.push(m);
    }

    // Packed life rafts in free fall (orange valise with a dark strap).
    const rg = ctx.look.merge([
      { geometry: new THREE.BoxGeometry(0.9, 0.5, 0.6), color: '#FF6A13' },
      { geometry: new THREE.BoxGeometry(0.94, 0.08, 0.64), position: [0, 0.05, 0], color: '#1E1E1E' },
    ]);
    const rm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.raftMeshes = [0, 1].map(() => {
      const m = new THREE.Mesh(rg, rm);
      m.name = 'heli.raftPack';
      m.visible = false;
      m.castShadow = true;
      ctx.scene.add(m);
      return m;
    });

    // ---- internal ------------------------------------------------------------------------------
    this.acc = 0;
    this.liftActive = false;
    this.liftRelease = 0;
    this.pitchV = 0;
    this.bankV = 0;
    this.bladeAngle = 0;
    this.ghostAngle = 0;
    this.tailBlade = 0;
    this.tailGhost = 0;
    this.shadowAngle = 0;
    this.sprayAcc = 0;
    this.smokeT = 0;
    this.sparkT = 0;
    this.t = 0;
    this.liftAxis = 0;
    this.noise = createNoise2D(5531);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector2();
    this._dir = new THREE.Vector2();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._m = new THREE.Matrix4();
    this._col = new THREE.Color();

    ctx.events.on('mission:setup', ({ def }) => this.reset((def && def.heli) || { pad: 0 }));
    // Touch auto-aim (DESIGN §3.2): remember recent distress signals (rocket, smoke, strobe…).
    this._signals = [];
    this._touchTgt = null;
    ctx.events.on('survivor:signal', (p) => {
      if (!p || !Number.isFinite(p.x + p.z)) return;
      if (this._signals.length >= 12) this._signals.shift();
      this._signals.push({ x: p.x, z: p.z, t: this.t, s: p.s || null });
    });
    ctx.events.on('mission:setup', () => {
      this._signals.length = 0;
      this._touchTgt = null;
    });
    ctx.settings.onChange((k) => {
      if (k === 'quality') this._applyQuality();
    });
    this.flight.reset(0, 40, 0, 0);
    this.winchCtl.reset();
    this._syncRender(0);
  }

  async init() {
    this._applyQuality();
    // If a mission was already set up before we existed (unlikely), sit on the first pad.
    if (this.ctx.world?.pads?.length && !this._didReset) this.reset({ pad: 0 });
  }

  _applyQuality() {
    const high = this.ctx.settings.get('quality') === 'high';
    this.model.blades.castShadow = high;
    this.model.blades.visible = high;
  }

  // ----------------------------------------------------------------------------------------------
  // CONTRACT API
  reset(spawn = {}) {
    const ctx = this.ctx;
    this._didReset = true;
    const pads = ctx.world?.pads || [];
    const pad = spawn.pad !== undefined && spawn.pad !== null && pads[spawn.pad] && pads[spawn.pad].position ? pads[spawn.pad] : null;
    this.hull = 1;
    this.fuel = 1;
    this.cabin.length = 0;
    this.emp = 0;
    this.engineTemp = 0;
    this.overheat = 0;
    this.boost = this.boosting = false;
    this.autorotation = false;
    this.crash = null;
    this.alive = true;
    this.firstHit = true;
    this.damageTaken = 0;
    this.thrustFactor = 1;
    this.uMove.set(0, 0);
    this.liftActive = false;
    this.acc = 0;
    if (pad) {
      const hd = spawn.heading !== undefined ? spawn.heading : pad.heading || 0;
      this.flight.reset(pad.position.x, pad.position.y + SKID, pad.position.z, hd);
      this.landed = pad;
      this.flight.attachTo(pad);
      this.flight.contactPad = pad;
      this.altTarget = this.flight.p.y;
      this.rotorRPM = IDLE_RPM;
    } else {
      const y = spawn.altitude !== undefined ? spawn.altitude : spawn.y !== undefined ? spawn.y : 40;
      this.flight.reset(spawn.x || 0, y, spawn.z || 0, spawn.heading || 0);
      this.landed = null;
      this.altTarget = clamp(y, ALT_MIN, ALT_MAX);
      this.rotorRPM = 1;
    }
    this.ops.reset();
    this.searchlightCtl.reset();
    this._computeHoist(this.flight.p, this.flight.heading, this.hoistWorld);
    this.winchCtl.reset();
    this.crewman.reset();
    for (const m of this.flareMeshes) m.visible = false;
    for (const m of this.raftMeshes) m.visible = false;
    this._syncRender(0);
  }

  applyImpulse(v) {
    this.flight.v.add(v);
    if (this.landed && Math.hypot(v.x, v.z) > 3) this.ops.takeoff();
  }

  damage(amount, source = 'unknown') {
    this.ops.damage(amount, source);
  }

  addFuel(amount) {
    this.fuel = clamp(this.fuel + amount, 0, 1);
  }

  autoTakeoff(altitude = 40) {
    const y = this.flight.p.y;
    this.altTarget = clamp(Math.max(altitude, y + 2), ALT_MIN, ALT_MAX);
    this.liftActive = false;
  }

  setSearchlight(on) {
    on = !!on && this.alive;
    if (on === this.searchlight) return;
    this.searchlight = on;
    this.ctx.events.emit('heli:searchlight', { on });
  }

  get onPad() {
    return this.landed;
  }

  get ditched() {
    return !!(this.crash && this.crash.phase === 'ditched');
  }

  get seatsUsed() {
    return this.winchCtl.seatsUsed();
  }

  // ----------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    this.t += dt;
    this._input(dt);
    this._aimAndNose();

    // Fixed 60 Hz physics with an accumulator; render interpolates (DESIGN §3.1).
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      this._step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n >= 8) this.acc = 0;
    const alpha = clamp(this.acc / STEP, 0, 1);

    this._syncRender(alpha);
    this._visuals(dt, alpha);
    if (ctx.mode === 'play') this._buttons();
  }

  _step(dt) {
    const f = this.flight;
    f.step(dt);
    this._computeHoist(f.p, f.heading, this.hoistWorld);
    this.winchCtl.step(dt, this.hoistWorld);
    this.ops.step(dt);
    f.lastVy = f.v.y;
  }

  // Cable top from the physics pose (yaw only; the visual tilt is cosmetic).
  _computeHoist(p, heading, out) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const hx = POINTS.hoist.x;
    const hz = POINTS.hoist.z;
    // local (x right, z tail) → world with clockwise heading
    out.set(p.x + hx * c - hz * s, p.y + POINTS.hoist.y, p.z + hx * s + hz * c);
    return out;
  }

  // ----------------------------------------------------------------------------------------------
  _input(dt) {
    const ctx = this.ctx;
    const input = ctx.input;
    const play = ctx.mode === 'play' && this.alive && !this.crash;
    const m = play ? input.move() : null;
    this.uMove.x = smoothAxis(this.uMove.x, m ? m.x : 0, dt);
    this.uMove.y = smoothAxis(this.uMove.y, m ? m.y : 0, dt);

    // Vertical: lift axis moves the target at 12 m/s; 0.25 s after release the target = current height.
    let lift = play ? input.axis('lift') : 0;
    if (ctx.settings.get('invertLift')) lift = -lift;
    this.liftAxis = lift;
    if (Math.abs(lift) > 0.05) {
      this.altTarget += lift * 12 * dt;
      this.liftActive = true;
      this.liftRelease = 0.25;
    } else if (this.liftActive) {
      this.liftRelease -= dt;
      if (this.liftRelease <= 0) {
        this.liftActive = false;
        this.altTarget = this.flight.p.y;
      }
    }
    if (play) {
      if (input.pressed('altPreset1')) this._preset(15);
      if (input.pressed('altPreset2')) this._preset(40);
      if (input.pressed('altPreset3')) this._preset(90);
      if (input.pressed('altUp')) this._preset(PRESETS.find((a) => a > this.altTarget + 1) ?? ALT_MAX);
      if (input.pressed('altDown')) this._preset([...PRESETS].reverse().find((a) => a < this.altTarget - 1) ?? ALT_MIN);
      const wheel = input.consumeWheel ? input.consumeWheel() : 0;
      if (wheel) {
        this.altTarget -= 5 * Math.sign(wheel) * Math.min(3, Math.abs(wheel));
        this.liftActive = false;
      }
    }
    if (this.landed && this.altTarget < this.flight.p.y) this.altTarget = this.flight.p.y;
    this.altTarget = clamp(this.altTarget, ALT_MIN, ALT_MAX);
    this.ceiling = this.altTarget >= ALT_MAX - 0.01;

    this.boostHeld = play && input.down('boost');
    this.winchCtl.input(play && input.down('winch'), play && input.pressed('winch'));
  }

  _preset(alt) {
    this.altTarget = alt;
    this.liftActive = false;
  }

  _buttons() {
    const input = this.ctx.input;
    if (!this.alive || this.crash) return;
    if (input.pressed('searchlight')) this.setSearchlight(!this.searchlight);
    if (input.pressed('flare')) this.ops.flare();
    if (input.pressed('raftDrop')) this.ops.raftDrop();
    if (input.pressed('horn')) this.ops.horn();
  }

  // Aim point (cursor on the water / right stick / ahead of the nose) and the nose target.
  _aimAndNose() {
    const ctx = this.ctx;
    const input = ctx.input;
    const f = this.flight;
    const p = f.p;
    const play = ctx.mode === 'play' && this.alive && !this.crash;
    const ax = play ? input.axis('aimX') : 0;
    const ay = play ? input.axis('aimY') : 0;
    const am = Math.hypot(ax, ay);
    const fx = Math.sin(f.heading);
    const fz = -Math.cos(f.heading);
    if (am > 0.12) {
      const r = 12 + 90 * am;
      this.aim.set(p.x + (ax / am) * r, 0, p.z - (ay / am) * r);
      this.aimSource = 'stick';
    } else if (play && input.lastDevice === 'touch' && this._touchAim(this.aim)) {
      // touch: the searchlight and flares lock onto the nearest spotted survivor / fresh signal
      this.aimSource = 'touch';
    } else if (input.lastDevice !== 'gamepad' && input.lastDevice !== 'touch' && input.mouse.active && ctx.cameraRig?.screenToWater) {
      ctx.cameraRig.screenToWater(input.mouse.ndcX, input.mouse.ndcY, this.aim);
      this.aimSource = 'mouse';
    } else {
      // gamepad with the stick centred: under the heli, a little ahead (flare "под себя")
      this.aim.set(p.x + fx * 12, 0, p.z + fz * 12);
      this.aimSource = 'nose';
    }
    if (!Number.isFinite(this.aim.x + this.aim.z)) this.aim.set(p.x, 0, p.z);

    // Nose: cursor if the mouse moved within 2 s or the searchlight is on; else airspeed > 5 m/s.
    let target = null;
    if (play && !this.landed) {
      const dx = this.aim.x - p.x;
      const dz = this.aim.z - p.z;
      const far = dx * dx + dz * dz > 36;
      const mouseRecent = this.aimSource === 'mouse' && performance.now() - input.mouse.lastMoveT < 2000;
      if (far && (this.aimSource === 'stick' || mouseRecent || (this.searchlight && this.aimSource === 'mouse'))) {
        target = Math.atan2(dx, -dz);
      } else {
        const vx = f.v.x - f.windEff.x;
        const vz = f.v.z - f.windEff.y;
        if (vx * vx + vz * vz > 25) target = Math.atan2(vx, -vz);
      }
    }
    f.noseTarget = target;
  }

  // Nearest spotted survivor group or recent distress signal (≤ 260 m, signals ≤ 25 s old) → out.
  // A little hysteresis keeps the lock from flickering between two equally close targets.
  _touchAim(out) {
    const p = this.flight.p;
    const R2 = 260 * 260;
    let best = null;
    let bd = R2;
    let cur = Infinity;
    const list = this.ctx.survivors?.list || [];
    for (const s of list) {
      if (!s || !s.position || !(s.remaining > 0)) continue;
      if (s.state === 'rescued' || s.state === 'lost' || s.state === 'hidden') continue;
      if (!s.spotted && s.state !== 'spotted' && s.state !== 'winching') continue;
      const d2 = (s.position.x - p.x) ** 2 + (s.position.z - p.z) ** 2;
      if (s === this._touchTgt) cur = d2;
      if (d2 < bd) {
        bd = d2;
        best = s;
      }
    }
    for (const g of this._signals) {
      if (this.t - g.t > 25) continue;
      if (g.s && list.includes(g.s) && (g.s.spotted || g.s.state === 'spotted')) continue; // already have it exactly
      const d2 = (g.x - p.x) ** 2 + (g.z - p.z) ** 2;
      if (g === this._touchTgt) cur = d2;
      if (d2 < bd) {
        bd = d2;
        best = g;
      }
    }
    if (!best) {
      this._touchTgt = null;
      return false;
    }
    if (this._touchTgt && best !== this._touchTgt && cur < R2 && bd > cur * 0.7) best = this._touchTgt;
    this._touchTgt = best;
    const x = best.position ? best.position.x : best.x;
    const z = best.position ? best.position.z : best.z;
    if (!Number.isFinite(x + z)) return false;
    out.set(x, 0, z);
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  _syncRender(alpha) {
    const f = this.flight;
    this.position.lerpVectors(f.prevP, f.p, alpha);
    this.heading = wrapAngle(f.prevHeading + wrapAngle(f.heading - f.prevHeading) * alpha);
    this.velocity.copy(f.v);
    this.vy = f.v.y;
    this.yawRate = f.yawRate;
    this.windEff.copy(f.windEff);
    this.seaY = f.sea;
    this.surfaceY = f.surface;
    this.altitude = this.position.y - Math.max(f.sea, this.landed ? this.landed.position.y : f.surface);
    this.skidClearance = this.altitude - SKID;
    this.speed = Math.hypot(f.v.x, f.v.z);
    this.airspeed = Math.hypot(f.v.x - f.windEff.x, f.v.z - f.windEff.y);
  }

  _visuals(dt, alpha) {
    const ctx = this.ctx;
    const st = ctx.weather?.state || {};
    const night = st.night || 0;
    const flash = st.flash || 0;
    const mdl = this.model;
    const f = this.flight;
    const ditched = this.ditched;

    // --- rotor RPM (idle on the pad in title/briefing; spool τ 2.2 s; stops after ditching) -------
    let rpmT = 1;
    if ((ctx.mode === 'title' || ctx.mode === 'briefing') && this.landed) rpmT = IDLE_RPM;
    if (this.autorotation) rpmT = 0.9;
    if (ditched) rpmT = 0;
    const tau = rpmT > this.rotorRPM ? 2.2 : ditched ? 0.6 : 1.2;
    this.rotorRPM += (rpmT - this.rotorRPM) * (1 - Math.exp(-dt / tau));
    const rpm = this.rotorRPM;

    // --- visual pitch / bank springs (ω 5.5, ζ 0.9) + turbulence jitter -----------------------------
    const hd = this.heading;
    const cx = Math.cos(hd);
    const sx = Math.sin(hd);
    const th = f.thrust;
    const aF = th.x * sx - th.y * cx;
    const aR = th.x * cx + th.y * sx;
    let pitchT = clamp(-0.03 * aF, -MAX_TILT, MAX_TILT);
    let bankT = clamp(0.03 * aR, -MAX_TILT, MAX_TILT);
    const T = st.turbulence || 0;
    if (!this.landed && !ditched) {
      pitchT += 0.02 * (T / 5) * this.noise(this.t * 2.3, 1.7) * 3;
      bankT += 0.02 * (T / 5) * this.noise(this.t * 2.3, 9.1) * 3;
    }
    // The swinging basket tugs the airframe (heavier with a person aboard).
    const wn = this.winch;
    if (wn.state !== 'stowed' && !this.landed && wn.length > 1) {
      const dx = wn.basket.x - this.hoistWorld.x;
      const dz = wn.basket.z - this.hoistWorld.z;
      const k = wn.load ? 0.012 : 0.006;
      bankT += clamp((dx * cx + dz * sx) * k, -0.06, 0.06);
      pitchT += clamp(-(dx * sx - dz * cx) * k * 0.7, -0.04, 0.04);
    }
    if (this.landed) {
      // sit level with the (possibly tilting) deck
      const obj = this.landed.object3d;
      pitchT = 0;
      bankT = 0;
      if (obj && obj.matrixWorld) {
        this._up.setFromMatrixColumn(obj.matrixWorld, 1).normalize();
        pitchT = -(this._up.x * sx - this._up.z * cx) * 0.9;
        bankT = (this._up.x * cx + this._up.z * sx) * 0.9;
      }
    }
    const onDeckWreck = ditched && !!this.crash.deck;
    if (onDeckWreck) {
      pitchT = 0.05;
      bankT = 0.14; // skid collapsed — lists on the deck
    } else if (ditched && ctx.ocean?.normalAt) {
      ctx.ocean.normalAt(this.position.x, this.position.z, this._up);
      pitchT = -(this._up.x * sx - this._up.z * cx) * 1.2;
      bankT = (this._up.x * cx + this._up.z * sx) * 1.2 + 0.18; // lists to starboard
    }
    const w = 5.5;
    const z = 0.9;
    this.pitchV += (w * w * (pitchT - this.pitch) - 2 * z * w * this.pitchV) * dt;
    this.bankV += (w * w * (bankT - this.bank) - 2 * z * w * this.bankV) * dt;
    this.pitch += this.pitchV * dt;
    this.bank += this.bankV * dt;
    if (!Number.isFinite(this.pitch + this.bank)) this.pitch = this.bank = this.pitchV = this.bankV = 0;

    // --- transforms -------------------------------------------------------------------------------------
    const root = mdl.root;
    root.position.copy(this.position);
    if (!this.landed && !ditched) root.position.y += 0.07 * Math.sin(this.t * 1.9) * rpm;
    root.rotation.set(0, -hd, 0);
    mdl.body.rotation.set(this.pitch, 0, -this.bank);
    mdl.rotorPivot.rotation.set(this.pitch * 0.3, 0, -this.bank * 0.3);
    root.updateMatrixWorld(true);
    this.hoistRender.copy(POINTS.hoist);
    mdl.body.localToWorld(this.hoistRender);

    // --- rotor discs (ghost blades, stagecoach, freeze in the flash) ----------------------------------
    const freeze = smooth(0.45, 0.55, flash);
    if (freeze < 0.5) {
      this.bladeAngle += rpm * Math.PI * 2 * 4.6 * dt;
      this.tailBlade += rpm * Math.PI * 2 * 22 * dt;
    }
    this.ghostAngle += (0.7 + 3.0 * (rpm - 1)) * dt;
    this.tailGhost += (1.3 + 4.0 * (rpm - 1)) * dt;
    const slow = 1 - smooth(0.18, 0.5, rpm);
    const sharp = Math.max(freeze, slow);
    const ru = mdl.rotorMat.uniforms;
    ru.uBlade.value = this.bladeAngle % (Math.PI * 2);
    ru.uGhost.value = this.ghostAngle % (Math.PI * 2);
    ru.uSharp.value = sharp;
    ru.uExp.value = 6 + 34 * (1 - smooth(0.4, 0.95, rpm));
    ru.uElmo.value = st.stElmo || 0;
    // per-frame blade sweep of a 1/60 s "shutter" (rad), the tip smears' length
    ru.uArc.value = clamp(rpm * Math.PI * 2 * 4.6 / 60, 0.04, 0.9);
    // tip smears are a close-range cue only: gone by 180 m of camera distance
    ru.uTipFade.value = 1 - smooth(90, 180, ctx.camera.position.distanceTo(this.position));
    const tu = mdl.tailMat.uniforms;
    tu.uBlade.value = this.tailBlade % (Math.PI * 2);
    tu.uGhost.value = this.tailGhost % (Math.PI * 2);
    tu.uSharp.value = sharp;
    tu.uExp.value = 4 + 20 * (1 - smooth(0.4, 0.95, rpm));
    tu.uArc.value = clamp(rpm * Math.PI * 2 * 22 / 60, 0.04, 1.2);
    tu.uTipFade.value = ru.uTipFade.value;
    // the hub and blade roots turn with what the disc shows (ghost alias, or the frozen blades)
    mdl.hub.rotation.y = sharp > 0.5 ? this.bladeAngle : this.ghostAngle;
    // shadow blades alias at 0.7–1 rev/s (stroboscopic rotor shadow)
    const aliasRate = rpm > 0.6 ? (0.7 + 0.3 * Math.sin(this.t * 0.37)) * Math.PI * 2 * rpm : rpm * Math.PI * 2 * 4.6;
    if (freeze < 0.5) this.shadowAngle += aliasRate * dt;
    mdl.blades.rotation.y = -this.shadowAngle;

    // --- hull shading: rim by day, cloud shadow on the sun, instruments, soot -------------------------
    const hu = mdl.hullMat.userData.uniforms;
    const pal = st.palette;
    if (pal && pal.ambient) {
      // Day: hemisphere-sky rim (DESIGN §2.7.3). Night: a faint moonlit rim so the silhouette still
      // reads against black water ("readable in the worst frame", pillar 8).
      hu.uRim.value.copy(pal.ambient).multiplyScalar(1 - night);
      if (night > 0 && pal.sun) hu.uRim.value.add(this._col.copy(pal.sun).multiplyScalar(0.9 * night));
      if (pal.sun) hu.uFill.value.copy(pal.sun).multiplyScalar(0.2 * night * night);
      // Day under heavy cloud (squall/storm): the white airframe sank to ≈0.3 on screen, darker
      // than the foam around it. A soft "overcast sky on white paint" fill keeps it the most
      // readable object of the frame (DESIGN §2.1 pillar 8, hull ≤ 0.85); zero in calm sun.
      const sy = Math.max(0.2, st.sunDirShadow?.y ?? st.sunDir?.y ?? 0.7);
      const lumOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const light = (pal.sunIntensity ?? 1) * sy * lumOf(pal.sun || pal.ambient) + (pal.ambientIntensity ?? 0.6) * lumOf(pal.ambient);
      const dull = clamp(1 - light / 1.1, 0, 1) * (1 - smooth(0.3, 0.8, night));
      if (dull > 0) hu.uFill.value.add(this._col.copy(pal.ambient).multiplyScalar(0.5 / Math.max(0.05, lumOf(pal.ambient))).lerp(WHITE, 0.5).multiplyScalar(0.42 * dull));
    }
    const cloud = ctx.look?.cloudAt ? ctx.look.cloudAt(this.position.x, this.position.z) : 0;
    hu.uSunScale.value = 1 - 0.2 * cloud * (1 - night);
    hu.uInstr.value.set('#3AE0C8').multiplyScalar(0.4 * (0.04 + 0.96 * night * night) * (this.alive ? 1 : 0.2));
    hu.uSoot.value = 0.3 + 0.7 * smooth(0.55, 0.12, this.hull); // engines always leave some soot

    // --- rotor veil light: the hull's light rig (sun · N·L + hemisphere), lightning, own lamps ----------
    const rl = mdl.rotorLight;
    if (pal && pal.ambient) {
      rl.uSunCol.value.copy(pal.sun || pal.ambient).multiplyScalar((pal.sunIntensity ?? 1) * hu.uSunScale.value);
      rl.uAmbCol.value.copy(pal.ambient).multiplyScalar((pal.ambientIntensity ?? 0.6) * (1 + 3 * flash));
      rl.uSkyCol.value.copy(pal.sky || pal.ambient).multiplyScalar(0.5 * (pal.ambientIntensity ?? 0.6) * (1 + 3 * flash));
    }
    if (st.sunDir) rl.uSunDir.value.copy(st.sunDir);
    const lc = this.lightsCtl;
    const glowK = 0.1 + 1.1 * night; // irradiance-scale: a strobe flash catches the veil at night
    // broad: the searchlight pool bouncing up; local (falls off from the lamp over the veil): beacon, strobes
    rl.uGlow.value.setRGB(1, 1, 1).multiplyScalar((this.beam?.intensity || 0) * glowK * 0.12);
    rl.uGlowB.value.setRGB(1, 0.08, 0.06).multiplyScalar(lc.beacon * glowK * 0.9);
    rl.uGlowS.value.setRGB(1, 1, 1).multiplyScalar(lc.strobe * glowK * 1.4);

    // --- flotation bags pop when ditched ---------------------------------------------------------------
    const fl = ditched && !this.crash.deck ? clamp(this.crash.t / 0.6, 0, 1) : 0;
    for (const m of mdl.floats) {
      m.visible = fl > 0.01;
      if (m.visible) m.scale.set(0.3 + 0.7 * fl, 0.3 + 0.7 * fl, 0.6 + 0.4 * fl);
    }

    // --- searchlight, lights, glints ---------------------------------------------------------------------
    this.searchlightCtl.update(dt, this, this.aim);
    this.lightsCtl.update(dt, this);

    // --- winch visuals -------------------------------------------------------------------------------------
    this.winchCtl.render(dt, alpha, this.beam);
    this.crewman.update(dt, this);
    // engines are hot while turning (thermal proxies, layer 2 only)
    const hot = !ditched && rpm > 0.2;
    for (const m of this.heatProxies) m.visible = hot;

    // --- downwash on the water (R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²) + spray ------------------
    const altW = Math.max(0, this.position.y - this.seaY);
    const R = 9 + 0.35 * altW;
    const s0 = clamp(1 - (altW - 4) / 28, 0, 1);
    const sDw = s0 * s0 * smooth(0.3, 0.9, rpm) * (ditched ? 0 : 1);
    const dw = this.downwash;
    dw.x = this.position.x;
    dw.z = this.position.z;
    dw.radius = R;
    dw.strength = sDw;
    ctx.ocean?.setDownwash?.(dw.x, dw.z, R, sDw);
    if (sDw > 0.02 && ctx.fx?.spray && !(this.landed && this.landed.position.y - this.seaY > 4)) {
      this.sprayAcc += sDw * 260 * ctx.settings.detail() * dt;
      while (this.sprayAcc >= 3) {
        this.sprayAcc -= 3;
        const a = Math.random() * Math.PI * 2;
        const rr = R * (0.75 + Math.random() * 0.35);
        this._dir.set(Math.cos(a), Math.sin(a));
        ctx.fx.spray(dw.x + this._dir.x * rr, dw.z + this._dir.y * rr, this._dir, 3);
      }
    } else this.sprayAcc = 0;

    // --- damage smoke (<50 % grey, <25 % black + sparks), swirled by the downwash in fx ---------------
    if ((this.hull < 0.5 || this.crash) && ctx.fx?.smoke) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.07;
        const black = this.hull < 0.25 || !!this.crash;
        const ex = Math.random() < 0.5 ? POINTS.exhaustL : POINTS.exhaustR;
        this._v.copy(ex);
        mdl.body.localToWorld(this._v);
        ctx.fx.smoke(this._v.x, this._v.y, this._v.z, black ? '#0A0A0A' : '#2A2A2A', black ? 1.4 : 0.8);
        if (black && ctx.fx.sparks) {
          this.sparkT -= 0.07;
          if (this.sparkT <= 0) {
            this.sparkT = 0.2 + Math.random() * 0.5;
            ctx.fx.sparks(this._v.x, this._v.y, this._v.z, '#FFB050', 6);
          }
        }
      }
    }

    // --- flares in flight -----------------------------------------------------------------------------------
    const flights = this.ops.flights;
    for (let i = 0; i < this.flareMeshes.length; i++) {
      const m = this.flareMeshes[i];
      const fi = flights[i];
      m.visible = !!fi;
      if (fi) {
        m.position.set(fi.x, fi.y, fi.z);
        if (ctx.fx?.sparks && Math.random() < 0.5) ctx.fx.sparks(fi.x, fi.y, fi.z, '#FF6A2A', 1);
      }
    }

    const drops = this.ops.drops;
    for (let i = 0; i < this.raftMeshes.length; i++) {
      const m = this.raftMeshes[i];
      const d = drops[i];
      m.visible = !!d;
      if (d) {
        m.position.set(d.x, d.y, d.z);
        m.rotation.set(d.spin * 0.7, d.spin, d.spin * 0.4);
      }
    }

    // --- rotor load (audio): .35|lift| + .4|bank|/max + .5·max(0,−vy)/6 + .3·turb, τ .15 -----------------
    const loadT = clamp(0.35 * Math.abs(this.liftAxis) + (0.4 * Math.abs(this.bank)) / MAX_TILT + (0.5 * Math.max(0, -this.vy)) / 6 + 0.3 * clamp(f.turb / 4, 0, 1), 0, 1);
    this.load += (loadT - this.load) * (1 - Math.exp(-dt / 0.15));
  }

  // Hooks from the flight model.
  onWaterStrike(x, z, strength) {
    this.ctx.ocean?.splash?.(x, z, 6, 0.8);
    this.ctx.fx?.splash?.(x, this.seaY, z, 2.5);
    this.ctx.events.emit('heli:water-strike', { x, z, strength });
  }

  onTouch(pad, relVy) {
    this.ctx.events.emit('heli:touchdown', { pad, vy: relVy });
  }
}
