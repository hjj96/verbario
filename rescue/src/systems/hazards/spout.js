// Waterspout «смерч», tornado «торнадо» and the tornado's satellite ropes (DESIGN §2.12 look, §3.12 mechanics).
//
// Five stages (waterspout timings; the tornado stretches the telegraph to the 20 s of its green sky):
//   1 «тёмное пятно» 6 s   rotating cloud-shadow disc 30–80 m (diffuse ×0.6), the collar starts to form
//   2 «спираль»      5 s   foam arms of the ocean 'vortex' feature, a funnel cloud hangs from the collar
//   3 «кольцо брызг» 4 s   300-sprite spray ring (25 m/s orbit, 4 m/s rise); forces at 50 %
//   4 «зрелый»   30–90 s   the funnel descends from the collar in 3 s; full Rankine forces
//   5 «распад»       6 s   thins into a rope, leans, the base detaches; forces fade
// Forces: Rankine vortex (core Rc, influence, Vmax, inflow −0.35·v_t) as ADDED WIND (Hazards.forceAt turns
// it into K·c·profile·V), +updraft in the core; the column centre follows the drawn lean at every height
// («что видишь, то и толкает»). The ocean feature carries the matching surface swirl.
import * as THREE from 'three';
import {
  SPOUT, TORNADO, SATELLITE, COLORS, TAU, rng32, clamp01, smooth, lerp, easeInOut, rankine,
} from './common.js';
import { debrisTint } from './debris.js';

const STAGE_NAMES = ['', 'spot', 'spiral', 'spray', 'mature', 'decay'];
const RAIN_COLOR = new THREE.Color(COLORS.rainColumn);

export class Spout {
  // hz: the Hazards system; type 'waterspout' | 'tornado' | 'satellite'
  constructor(hz, type, opts = {}) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.id = hz.nextId();
    this.type = type;
    const P = (this.P = type === 'tornado' ? TORNADO : type === 'satellite' ? SATELLITE : SPOUT);
    const rnd = (this.rnd = rng32(opts.seed ?? hz.seedFor(this.id)));
    this.position = new THREE.Vector3(Number(opts.x) || 0, 0, Number(opts.z) || 0);
    this.velocity = new THREE.Vector3();
    this.rc = this.coreRadius = P.rc;
    this.radius = this.influence = P.rinf;
    this.vmax = P.vmax;
    this.spin = opts.spin === 1 ? 1 : -1; // −1 = counter-clockwise seen from above (cyclonic)
    this.spinRate = P.spinRate * this.spin; // rad/s the heli is turned in the core (heli may read it)
    this.scale = P.scale * (Number(opts.scale) || 1);
    this.life = Number(opts.life) || lerp(P.life[0], P.life[1], rnd());
    const tele = P.stages[0] + P.stages[1] + P.stages[2];
    this.durations = [P.stages[0], P.stages[1], P.stages[2], Math.max(20, this.life - tele - P.decay), P.decay];
    if (Number(opts.mature) > 0) this.durations[3] = Number(opts.mature);
    this.life = this.durations.reduce((a, b) => a + b, 0);
    this.telegraph = tele;
    this.stage = 1;
    this.stageName = STAGE_NAMES[1];
    this.stageT = 0;
    this.age = 0;
    this.strength = 0; // force factor 0..1
    this.oceanStrength = 0;
    this.eta = tele; // seconds until mature (HUD / imminent)
    this.scripted = !!opts.scripted;
    this.name = opts.name || null;
    this.label = type === 'tornado' ? 'ТОРНАДО' : 'СМЕРЧ';
    this.alive = true;
    this.parent = opts.parent || null;
    this.slot = hz.vfx.alloc();
    this.featureId = type === 'satellite' ? null : `hz-${this.id}`;
    this.collarR = P.collarR ? lerp(P.collarR[0], P.collarR[1], rnd()) : 0;
    this.topY = (P.collarY ?? opts.topY ?? 110) + (rnd() - 0.5) * 6;
    this.lean = new THREE.Vector2();
    this.drift = new THREE.Vector2();
    this.wander = rnd() * TAU;
    this.green = 0;
    // heli interaction bookkeeping (Hazards reads / writes these)
    this.dmgAcc = 0;
    this.dmgTick = 0;
    this.closePass = false;
    this.passDamaged = false;
    this.warned600 = false;
    this.warned300 = false;

    if (type === 'tornado') {
      const hp = hz.heliPos;
      let a;
      if (Number.isFinite(opts.heading)) a = Math.atan2(-Math.cos(opts.heading), Math.sin(opts.heading));
      else if (Number.isFinite(opts.headingDeg)) {
        const h = (opts.headingDeg * Math.PI) / 180;
        a = Math.atan2(-Math.cos(h), Math.sin(h));
      } else a = Math.atan2(hp.z - this.position.z, hp.x - this.position.x) + (rnd() - 0.5) * 1.6;
      this.pathAng = a;
      this.pathCurve = (rnd() < 0.5 ? -1 : 1) * lerp(0.002, 0.005, rnd());
      this.pathSpeed = Number(opts.speed) || lerp(P.speed[0], P.speed[1], rnd());
      this.satellites = [];
      this.satTimer = 4 + rnd() * 6;
      this.debris = [];
      this.boat = null;
      this.boltTimer = 6;
      this.rainArc = hz.curtains.alloc();
      if (this.rainArc) {
        this.rainArc.color.copy(RAIN_COLOR);
        this.rainArc.fall = 24;
        this.rainArc.kind = 0;
        this.rainArc.taper = 1.12;
      }
    }
    if (type === 'satellite') {
      this.orbitR = Number(opts.orbitR) || 190;
      this.orbitAng = Number(opts.orbitAng) || 0;
      this.orbitW = (rnd() < 0.5 ? -1 : 1) * lerp(0.015, 0.035, rnd());
    }
    if (Number.isFinite(opts.vx) && Number.isFinite(opts.vz)) this.fixedDrift = new THREE.Vector2(opts.vx, opts.vz);

    // tests / scripted entries may start later in the life cycle
    const st = Math.max(1, Math.min(5, Math.floor(Number(opts.stage) || 1)));
    if (st > 1) {
      for (let i = 1; i < st; i++) this.age += this.durations[i - 1];
      this.stage = st;
      this.stageName = STAGE_NAMES[st];
      if (st === 4 && !opts.descend) this.stageT = P.descend; // already touching down
      this.age += this.stageT;
      this.green = type === 'tornado' ? 0.85 : 0;
    }
    this._applyVisual(0);
  }

  get mature() {
    return this.stage === 4;
  }

  // Centre of the column at a height (lean grows towards the collar, like the drawn funnel).
  centerAt(alt, out) {
    const k = Math.pow(clamp01(alt / this.topY), 1.35);
    out.x = this.position.x + this.lean.x * k;
    out.y = this.position.z + this.lean.y * k;
    return out;
  }

  // ----------------------------------------------------------------------------------------------
  update(dt, env) {
    if (!this.alive) return;
    const P = this.P;
    this.age += dt;
    this.stageT += dt;
    while (this.stage <= 5 && this.stageT >= this.durations[this.stage - 1]) {
      this.stageT -= this.durations[this.stage - 1];
      this.stage++;
      if (this.stage <= 5) {
        this.stageName = STAGE_NAMES[this.stage];
        this.hz.onStage(this);
      }
    }
    if (this.stage > 5) {
      this.alive = false;
      return;
    }
    let tele = 0;
    for (let i = this.stage - 1; i < 3; i++) tele += this.durations[i];
    this.eta = Math.max(0, tele - (this.stage <= 3 ? this.stageT : 0));

    this._move(dt, env);
    this._applyVisual(dt, env);
    if (this.type === 'tornado') this._tornado(dt, env);
  }

  _move(dt, env) {
    const P = this.P;
    const w = env.wind;
    if (this.type === 'satellite' && this.parent) {
      this.orbitAng += this.orbitW * dt;
      const px = this.parent.position.x + Math.cos(this.orbitAng) * this.orbitR;
      const pz = this.parent.position.z + Math.sin(this.orbitAng) * this.orbitR;
      if (dt > 0) this.velocity.set((px - this.position.x) / dt, 0, (pz - this.position.z) / dt);
      this.position.set(px, 0, pz);
      this.drift.set(this.velocity.x, this.velocity.z);
    } else if (this.type === 'tornado') {
      this.pathAng += this.pathCurve * dt;
      const v = this.pathSpeed;
      this.drift.set(Math.cos(this.pathAng) * v, Math.sin(this.pathAng) * v);
    } else if (this.fixedDrift) {
      this.drift.copy(this.fixedDrift);
    } else {
      // wind × 0.35 + a noise wander; 3–8 m/s
      const n = this.ctx.noise ? this.ctx.noise(this.age * 0.05, this.id * 3.17) : 0;
      this.wander += n * 0.5 * dt;
      let tx = w.x * 0.35 + Math.cos(this.wander) * 2.2;
      let tz = w.z * 0.35 + Math.sin(this.wander) * 2.2;
      const l = Math.hypot(tx, tz) || 1;
      const sp = Math.min(P.drift[1], Math.max(P.drift[0], l));
      tx *= sp / l;
      tz *= sp / l;
      const k = 1 - Math.exp(-dt / 4);
      if (this.age < 0.05) this.drift.set(tx, tz);
      else this.drift.set(this.drift.x + (tx - this.drift.x) * k, this.drift.y + (tz - this.drift.y) * k);
    }
    if (this.type !== 'satellite') {
      this.position.x += this.drift.x * dt;
      this.position.z += this.drift.y * dt;
      this.velocity.set(this.drift.x, 0, this.drift.y);
    }
    // lean: the cloud top rides the wind, the base drags behind (DESIGN «наклон и раскачка по ветру»)
    const leanK = this.stage === 5 ? 1 + 1.5 * easeInOut(this.stageT / this.durations[4]) : 1;
    const sq = Math.sqrt(this.scale);
    let lx = (w.x * 0.85 - this.drift.x) * 1.3 * sq;
    let lz = (w.z * 0.85 - this.drift.y) * 1.3 * sq;
    const ll = Math.hypot(lx, lz);
    const lmax = 32 * sq;
    if (ll > lmax) {
      lx *= lmax / ll;
      lz *= lmax / ll;
    }
    const k = this.age < 0.05 ? 1 : 1 - Math.exp(-dt / 3);
    this.lean.x += (lx * leanK - this.lean.x) * k;
    this.lean.y += (lz * leanK - this.lean.y) * k;
  }

  // Stage → look + force factor, written into the vortex slot and the ocean feature.
  _applyVisual(dt, env) {
    const P = this.P;
    const p = clamp01(this.stageT / this.durations[this.stage - 1]);
    let shadow = 1, collarA = 0.95, form = 1, oceanS = 1, reach = 1, spray = 1, force = 1, thin = 0, cut = 0, alpha = 1;
    switch (this.stage) {
      case 1:
        shadow = easeInOut(p);
        collarA = 0.55 * easeInOut(p);
        form = 0.45 * p;
        oceanS = 0.3 * p;
        reach = 0;
        spray = 0;
        force = 0;
        break;
      case 2:
        collarA = 0.55 + 0.3 * p;
        form = 0.45 + 0.35 * p;
        oceanS = 0.3 + 0.32 * p;
        reach = 0.12 * easeInOut(p);
        spray = 0;
        force = 0;
        break;
      case 3:
        collarA = 0.85 + 0.1 * p;
        form = 0.8 + 0.2 * p;
        oceanS = 0.62 + 0.28 * p;
        reach = 0.12 + 0.16 * easeInOut(p);
        spray = easeInOut(p);
        force = 0.5 * Math.min(1, this.stageT / 1.0);
        break;
      case 4: {
        const d = clamp01(this.stageT / P.descend);
        reach = 0.28 + 0.72 * easeInOut(d);
        oceanS = 0.9 + 0.1 * d;
        force = Math.min(1, 0.5 + this.stageT / 1.0);
        break;
      }
      case 5: {
        const e = easeInOut(p);
        thin = e;
        cut = 0.6 * Math.pow(e, 1.2);
        alpha = 1 - smooth(0.45, 1, p);
        oceanS = 1 - e;
        spray = 1 - e;
        force = 1 - e;
        shadow = 1 - e;
        collarA = 0.95 * (1 - e);
        break;
      }
      default:
        break;
    }
    this.strength = force;
    this.oceanStrength = oceanS;
    const sat = this.type === 'satellite';
    const sc = this.scale;

    // ocean: the base of the vortex lives IN the water (dark ring, inflow spiral, foam ring at R)
    if (this.featureId && this.hz.ocean?.setFeature) {
      this.hz.ocean.setFeature(this.featureId, {
        type: 'vortex', x: this.position.x, z: this.position.z, radius: P.oceanR, strength: Math.max(0, oceanS), spin: this.spin,
      });
    }

    const s = this.slot;
    if (!s) return;
    const spinW = this.type === 'tornado' ? 0.55 : sat ? 1.8 : 1.3;
    s.x = this.position.x;
    s.z = this.position.z;
    s.scale = sc;
    s.reach = reach;
    s.bottomCut = cut;
    s.thin = sat ? Math.max(0.35, thin) : thin;
    s.alpha = alpha * (sat ? 0.85 : 1);
    s.leanX = this.lean.x;
    s.leanZ = this.lean.y;
    const ws = env ? env.windSpeed : 10;
    s.sway = (2.5 + 0.15 * ws) * Math.sqrt(sc) * (1 + 1.5 * thin);
    s.spinAngle += spinW * dt;
    s.spinDir = this.spin;
    s.topY = this.topY;
    s.tone = this.type === 'tornado' ? 1 : 0;
    s.seed = (this.id * 0.6180339) % 1;
    s.phase = this.id * 1.37;
    if (sat) {
      s.collarAlpha = 0;
      s.shadowStrength = 0;
    } else {
      s.collarAlpha = collarA;
      s.collarForm = form;
      s.collarRadius = this.collarR * (0.6 + 0.4 * form);
      s.collarRot += (this.type === 'tornado' ? 0.05 : 0.14) * dt;
      s.collarSag = (this.type === 'tornado' ? 14 : 7) * form;
      s.shadowStrength = shadow;
      s.shadowRadius = lerp(30, this.collarR, easeInOut(Math.min(1, this.age / 8))) * (this.type === 'tornado' ? 1.05 : 1);
      s.shadowRot += (this.type === 'tornado' ? 0.04 : 0.11) * dt;
    }
    s.sprayStrength = spray;
    s.sprayRadius = this.type === 'tornado' ? 64 : sat ? 6 : 13;
    s.sprayRise = this.type === 'tornado' ? 9 : sat ? 3 : 4;
  }

  // ----------------------------------------------------------------------------------------------
  // Tornado extras: satellites, orbiting debris (boat at the climax), internal lightning, rain arc, green sky.
  _tornado(dt, env) {
    const rnd = this.rnd;
    const stage = this.stage;
    const pDecay = stage === 5 ? easeInOut(this.stageT / this.durations[4]) : 0;
    // green sky grows over the 20 s telegraph and fades with the decay
    this.green = stage < 5 ? 0.85 * clamp01(this.age / 20) : 0.85 * (1 - pDecay);

    // satellites (2–3 ropes orbiting 160–250 m out) while mature
    for (let i = this.satellites.length - 1; i >= 0; i--) {
      const s = this.satellites[i];
      s.update(dt, env);
      if (!s.alive) {
        this.hz.vfx.free(s.slot);
        this.satellites.splice(i, 1);
      }
    }
    if (stage === 4) {
      this.satTimer -= dt;
      const want = 2 + (this.id % 2);
      if (this.satTimer <= 0 && this.satellites.length < want) {
        this.satTimer = 6 + rnd() * 12;
        const s = new Spout(this.hz, 'satellite', {
          parent: this, orbitR: lerp(160, 250, rnd()), orbitAng: rnd() * TAU, spin: this.spin, seed: Math.floor(rnd() * 1e9),
        });
        s.position.set(this.position.x + Math.cos(s.orbitAng) * s.orbitR, 0, this.position.z + Math.sin(s.orbitAng) * s.orbitR);
        if (s.slot) this.satellites.push(s);
      }
    }

    // debris skirt: boards and barrels rise with the spray ring, the boat joins at the climax
    const D = this.hz.debris;
    if (D && stage >= 3 && stage <= 4 && this.debris.length === 0) {
      for (let i = 0; i < 26; i++) {
        const kind = i < 18 ? 'board' : 'barrel';
        const it = D.acquire(kind, this, debrisTint(kind, rnd));
        if (!it) continue;
        this.debris.push({
          it, r: lerp(22, 72, Math.pow(rnd(), 0.8)), ang: rnd() * TAU, y0: lerp(3, 62, rnd()), yA: lerp(2, 9, rnd()),
          yF: lerp(0.2, 0.6, rnd()), ph: rnd() * TAU, tx: lerp(-3, 3, rnd()), ty: lerp(-2, 2, rnd()), tz: lerp(-3, 3, rnd()),
          vy: 0, hitR: kind === 'board' ? 3.5 : 2.6, falling: false, gone: false,
        });
      }
    }
    if (D && stage === 4 && !this.boat && this.stageT > this.durations[3] * 0.45) {
      const it = D.acquire('boat', this, null);
      if (it) {
        this.boat = { it, r: 52, ang: rnd() * TAU, y0: 32, yA: 8, yF: 0.25, ph: 0, tx: 0.7, ty: 0.4, tz: 0.9, vy: 0, hitR: 5.5, falling: false, gone: false };
        this.debris.push(this.boat);
      }
    }
    const rise = stage === 3 ? easeInOut(this.stageT / this.durations[2]) : 1;
    const c = this._c || (this._c = { x: 0, y: 0 });
    for (const d of this.debris) {
      if (d.gone) continue;
      const it = d.it;
      if (stage === 5 && !d.falling && rnd() < dt * 0.9) d.falling = true;
      if (d.falling) {
        d.vy -= 9.8 * dt;
        it.y += d.vy * dt;
        const sea = this.hz.seaHeight(it.x, it.z);
        if (it.y < sea) {
          d.gone = true;
          it.y = -60;
          this.ctx.fx?.splash?.(it.x, sea, it.z, d.it.kind === 'boat' ? 5 : 1.5);
        }
      } else {
        d.ang += (this.spin * 25) / d.r * dt * (d.it.kind === 'boat' ? 0.6 : 1);
        const y = (d.y0 + d.yA * Math.sin(this.age * d.yF + d.ph)) * rise;
        this.centerAt(y, c);
        it.x = c.x + Math.cos(d.ang) * d.r;
        it.z = c.y + Math.sin(d.ang) * d.r;
        it.y = Math.max(this.hz.seaHeight(it.x, it.z) + 0.5, y);
      }
      it.rx += d.tx * dt;
      it.ry += d.ty * dt;
      it.rz += d.tz * dt;
    }

    // internal lightning (cloud-only flashes inside the wall cloud)
    if (stage === 4) {
      this.boltTimer -= dt;
      if (this.boltTimer <= 0) {
        this.boltTimer = 4 + rnd() * 6;
        const a = rnd() * TAU;
        const r = rnd() * this.collarR * 0.5;
        this.ctx.weather?.strikeLightning?.(this.position.x + this.lean.x + Math.cos(a) * r, this.position.z + this.lean.y + Math.sin(a) * r, {
          cloudOnly: true, strength: 0.55 + 0.35 * rnd(),
        });
      }
    }

    // rain arc wrapped around the rear flank (behind the direction of travel)
    const arc = this.rainArc;
    if (arc) {
      const back = this.pathAng + Math.PI;
      arc.arcLen = 2.3;
      arc.arcStart = back - arc.arcLen / 2 + this.spin * 0.5;
      arc.x = this.position.x;
      arc.z = this.position.z;
      arc.radius = 205;
      arc.height = this.topY;
      arc.leanX = this.lean.x;
      arc.leanZ = this.lean.y;
      const vis = stage <= 3 ? 0.4 * clamp01(this.age / 20) : stage === 4 ? Math.min(1, 0.4 + this.stageT / 6) : 1 - pDecay;
      arc.alpha = 0.24 * vis;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // Added wind (m/s) and vertical air speed (m/s) at a point; accumulates into acc {x, z, y}.
  addAir(x, z, alt, acc) {
    if (this.strength > 0.001) {
      const c = this._ca || (this._ca = { x: 0, y: 0 });
      this.centerAt(alt, c);
      const dx = x - c.x;
      const dz = z - c.y;
      const r2 = dx * dx + dz * dz;
      const ri = this.influence;
      if (r2 < ri * ri) {
        const r = Math.max(0.5, Math.sqrt(r2));
        const vt = rankine(r, this.rc, this.vmax, ri) * this.strength;
        const vr = -this.P.inflow * vt;
        acc.x += ((this.spin * -dz) / r) * vt + (dx / r) * vr;
        acc.z += ((this.spin * dx) / r) * vt + (dz / r) * vr;
        acc.y += this.P.updraft * this.strength * (1 - smooth(0.8 * this.rc, 1.4 * this.rc, r));
      }
    }
    if (this.satellites) for (const s of this.satellites) s.addAir(x, z, alt, acc);
  }

  // Surface swirl (m/s) for floating things — mirrors the ocean's drawn vortex flow.
  addFlow(x, z, out) {
    const sat = this.type === 'satellite';
    const s = this.oceanStrength;
    if (s > 0.001) {
      const R = sat ? 10 : this.P.oceanR;
      const dx = x - this.position.x;
      const dz = z - this.position.z;
      const r2 = dx * dx + dz * dz;
      if (r2 < 16 * R * R) {
        const r = Math.max(0.5, Math.sqrt(r2));
        const prof = (r / R) * Math.exp(0.5 * (1 - r2 / (R * R)));
        const vt = (sat ? 3 : 6) * s;
        const vin = 0.35 * vt;
        out.x += (((this.spin * -dz) / r) * vt - (dx / r) * vin) * prof;
        out.y += (((this.spin * dx) / r) * vt - (dz / r) * vin) * prof;
      }
    }
    if (this.satellites) for (const t of this.satellites) t.addFlow(x, z, out);
  }

  // Distance (horizontal) from the column at a height.
  distanceAt(x, z, alt) {
    const c = this._cd || (this._cd = { x: 0, y: 0 });
    this.centerAt(alt, c);
    return Math.hypot(x - c.x, z - c.y);
  }

  danger(x, z, alt) {
    const r = this.distanceAt(x, z, alt);
    let d;
    if (this.stage < 3) d = 0.35 * clamp01(this.age / this.telegraph) * (1 - smooth(this.rc, this.influence * 0.6, r));
    else d = Math.max(0.3, this.strength) * (1 - smooth(this.rc * 1.2, this.influence * 0.55, r));
    if (this.satellites) for (const s of this.satellites) d = Math.max(d, s.danger(x, z, alt));
    return d;
  }

  // Release everything this vortex owns (slot, feature, curtains, debris, satellites).
  dispose() {
    const hz = this.hz;
    if (this.featureId) hz.ocean?.removeFeature?.(this.featureId);
    hz.vfx.free(this.slot);
    this.slot = null;
    if (this.rainArc) hz.curtains.free(this.rainArc);
    this.rainArc = null;
    hz.debris?.releaseOwner(this);
    if (this.satellites) {
      for (const s of this.satellites) hz.vfx.free(s.slot);
      this.satellites.length = 0;
    }
    this.alive = false;
  }

  // Shorten the life: jump into the decay (scripted hazards need the ocean feature slot).
  dissipate() {
    if (this.stage < 5) {
      this.stage = 5;
      this.stageName = STAGE_NAMES[5];
      this.stageT = 0;
      this.hz.onStage(this);
    }
  }
}
