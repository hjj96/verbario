// Hazards — the antagonists (CONTRACT «hazards»; DESIGN §2.12 look, §3.12 mechanics, §3.8 damage, §3.13 rates).
//
// The weather is the only enemy; hazards are where it gets a shape:
//   waterspout [MUST]  five telegraphed stages (dark spot → spiral → spray ring → mature funnel → rope decay),
//                      Rankine-vortex forces, drift, collar with a hole around the heli     (hazards/spout.js)
//   tornado [SHOULD]   the same system ×4, satellites, orbiting debris and a boat, internal lightning,
//                      rain arc, the green sky (weather.setGreenTint over 20 s)             (hazards/spout.js)
//   rogue [MUST]       ocean 'rogue' feature + 500-sprite spray sheet + torn-foam veil; T−12/8/6/4 telegraph,
//                      impact (20 % + 6 %/5 m, 18 m/s knock, intake flood), 40 m sweep        (hazards/rogue.js)
//   whirlpool [SHOULD] ocean 'whirlpool' feature, 2 / 0.4 m/s surface pull, flotsam, engulf events
//   downburst, hail [NICE]                                                                    (hazards/cells.js)
//   lightning damage   charge rings on the water, hit / EMP / near-miss                       (hazards/charges.js)
//   rig air            lee turbulence wedge and flare-plume updraft (inside forceAt)
// Random spawns per preset rates (weather.state.rates) when def.hazardsRandom or endless; scripted ones from
// def.hazards ({type, at, …}; a rogue's `at` is its ARRIVAL, it spawns `telegraph` seconds earlier).
//
// Public API beyond the contract (read-only for others):
//   list[i].{id, type, label, stage, stageName, eta, strength, velocity, coreRadius, influence, spin,
//            spinRate (rad/s heli yaw in the core), scripted, name}
//     rogue: {dir, height, width, length, speed, threat, crest {origin, dir, length, width, bow, height}}
//     tornado: {satellites [{position, coreRadius}], green}
//   forceAt(): out.x / out.z are accelerations (m/s²); out.y is a vertical AIR SPEED (m/s) — heli adds it to
//   its commanded climb rate (core updraft +6 m/s, downburst −5 m/s, flare plume +4 m/s).
//   spawn(type, opts) also takes {stage, mature, life, x, z, vx, vz (fixed drift), heading|headingDeg, speed,
//   radius, duration, eta|telegraph, fromDeg|dir, height, offset, target:'heli'}; dissipate(hazard);
//   hazardsNear(x, z, r); mediaGain (light calibration multiplier for funnels / collars / spray, default 1).
// Extra events: hazard:stage {hazard, stage}, hazard:pass {hazard, clearance} (crest under the heli),
//   hazard:crest {hazard, survivor, x, z, height} (crest over a floating group: rafts may capsize),
//   hazard:engulf {hazard, survivor} (5 s in a whirlpool core: lost).
import * as THREE from 'three';
import { createHazardUniforms, clamp01, smooth, lerp, metres, fromPhrase, bearingDeg, rng32, HAIL } from './hazards/common.js';
import { VortexFx } from './hazards/vortexfx.js';
import { Curtains } from './hazards/curtains.js';
import { WaterRings } from './hazards/waterrings.js';
import { RogueFx, Rogue, MAX_ROGUE } from './hazards/rogue.js';
import { Spout } from './hazards/spout.js';
import { Whirlpool } from './hazards/whirlpool.js';
import { Downburst, HailCell } from './hazards/cells.js';
import { Charges } from './hazards/charges.js';
import { Debris } from './hazards/debris.js';

const K = 0.4; // heli drag towards the air (s⁻¹), DESIGN §3.3
const C_WIND = 0.6; // effective wind coefficient
const profile = (alt) => Math.min(1.4, Math.max(0.6, 0.6 + 0.008 * alt));
const MAX_FEATURES = 4; // ocean features at once (rogue, vortex, whirlpool share them)
const ALIAS = { spout: 'waterspout', smerch: 'waterspout', wave: 'rogue', vortex: 'waterspout' };
const TYPES = new Set(['waterspout', 'tornado', 'rogue', 'whirlpool', 'downburst', 'hail']);
const FEATURE_TYPES = new Set(['waterspout', 'tornado', 'rogue', 'whirlpool']);
const VORTEX_TYPES = new Set(['waterspout', 'tornado']);
const QUALITY_K = { low: 0.4, medium: 0.66, high: 1 };

export class Hazards {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.time = 0; // hazards clock (game time, all modes but pause)
    this.playClock = 0; // seconds of play since mission start (fallback when mission.elapsed is missing)
    this._id = 0;
    this.rng = rng32(4711);
    this.schedule = [];
    this.randomOn = false;
    this._cool = { spout: 8, rogue: 20, downburst: 30, hail: 40 };

    // --- render resources (created once; programs compiled in init) -----------------------------
    this.uniforms = createHazardUniforms(ctx.look);
    this.vfx = new VortexFx(this.uniforms);
    this.curtains = new Curtains(this.uniforms);
    this.rogueFx = new RogueFx(this.uniforms);
    this.glowRings = new WaterRings(this.uniforms, 'glow', 4, 64);
    this.foamRings = new WaterRings(this.uniforms, 'foam', 2, 96);
    this.debris = new Debris(ctx);
    this.charges = new Charges(this);
    this.group = new THREE.Group();
    this.group.name = 'hazards';
    this.group.add(this.vfx.group, this.curtains.mesh, this.rogueFx.group, this.glowRings.mesh, this.foamRings.mesh, this.debris.group);
    ctx.scene.add(this.group);

    // --- per-frame shared state (no allocation in update) -----------------------------------------
    this.heliPos = new THREE.Vector3(0, 40, 0);
    this.heliVel = new THREE.Vector3();
    this.heliAlt = 40;
    this.heliAlive = false;
    this.heliLanded = false;
    this.playing = false;
    this.env = { wind: { x: 0, z: 0 }, windDir: { x: 1, z: 0 }, windSpeed: 0, playing: false, t: 0 };
    this._acc = { x: 0, y: 0, z: 0 };
    this._imm = { type: null, position: new THREE.Vector3(), eta: 0, hazard: null };
    this._v3 = new THREE.Vector3();
    this._green = 0;
    this._hailOut = 0;
    this._debrisCd = 0;
    this._hailDmg = { acc: 0, t: 0 };
    this.mediaGain = 1; // light calibration of hazard media (funnel, collar, spray) — tuning hook
    this._fallbackSt = { palette: {}, windDir: new THREE.Vector2(1, 0), windSpeed: 0, night: 0, flash: 0, intensity: 0, waveHeight: 0.5 };

    const ev = ctx.events;
    ev.on('mission:setup', ({ def } = {}) => this._setup(def || {}));
    ev.on('mission:start', () => {
      this.playClock = 0;
    });
    ev.on('weather:charge', (e) => this.charges.onCharge(e));
    ev.on('weather:lightning', (e) => this.charges.onStrike(e));
    ctx.settings.onChange?.((k) => {
      if (k === 'quality') this._applyQuality();
    });
    this._applyQuality();
  }

  async init() {
    // Compile every hazard program now (DESIGN §8.1) — the first waterspout must never stall the game.
    const r = this.ctx.renderer;
    try {
      if (r.compileAsync && r.extensions?.has?.('KHR_parallel_shader_compile')) await r.compileAsync(this.group, this.ctx.camera, this.ctx.scene);
      else r.compile?.(this.group, this.ctx.camera, this.ctx.scene);
    } catch {
      /* warming is an optimisation only */
    }
    if (!this.schedule.length && this.ctx.mission?.def) this._setup(this.ctx.mission.def);
  }

  get ocean() {
    return this.ctx.ocean;
  }

  nextId() {
    return ++this._id;
  }

  seedFor(id) {
    return (Math.floor(this.rng() * 1e9) ^ (id * 2654435761)) >>> 0;
  }

  emit(name, payload) {
    this.ctx.events.emit(name, payload);
  }

  // hazard:warning {type, position, eta, text, detail, level 'caution'|'danger', stage, hazard, distance, …}
  warn(p) {
    if (!p.position && p.hazard) p.position = p.hazard.position;
    if (p.hazard && p.id === undefined) p.id = p.hazard.id;
    if (p.position && p.bearing === undefined) {
      const dx = p.position.x - this.heliPos.x;
      const dz = p.position.z - this.heliPos.z;
      p.bearing = bearingDeg(dx, dz);
      if (p.distance === undefined) p.distance = Math.hypot(dx, dz);
      if (!p.from) p.from = fromPhrase(dx, dz);
    }
    this.lastWarning = p;
    this.emit('hazard:warning', p);
  }

  // ---------------------------------------------------------------------------------------------
  // CONTRACT API
  spawn(type, opts = {}) {
    type = ALIAS[type] || type;
    if (!TYPES.has(type)) return null;
    opts = opts || {};
    if (FEATURE_TYPES.has(type) && this._featureCount() >= MAX_FEATURES && !this._evict(opts.scripted)) return null;
    if (type === 'rogue' && this._count('rogue') >= MAX_ROGUE && !this._evictType('rogue')) return null;
    let h = null;
    switch (type) {
      case 'waterspout':
      case 'tornado': {
        let o = opts;
        if (!Number.isFinite(opts.x) || !Number.isFinite(opts.z)) {
          const s = this._pickSpot(type === 'tornado' ? 700 : 300, type === 'tornado' ? 1000 : 600, 180);
          o = { ...opts, x: s.x, z: s.z };
        }
        h = new Spout(this, type, o);
        if (!h.slot) {
          h.dispose();
          return null;
        }
        break;
      }
      case 'rogue':
        h = new Rogue(this, opts);
        break;
      case 'whirlpool': {
        let o = opts;
        if (!Number.isFinite(opts.x) || !Number.isFinite(opts.z)) {
          const s = this._pickSpot(150, 400, 120);
          o = { ...opts, x: s.x, z: s.z };
        }
        h = new Whirlpool(this, o);
        break;
      }
      case 'downburst':
      case 'hail': {
        let o = opts;
        if (!Number.isFinite(opts.x) || !Number.isFinite(opts.z)) {
          const s = type === 'hail' ? this._pickSpot(380, 650, 0) : this._pickSpot(220, 420, 0);
          o = { ...opts, x: s.x, z: s.z };
        }
        h = type === 'hail' ? new HailCell(this, o) : new Downburst(this, o);
        break;
      }
      default:
        return null;
    }
    this.list.push(h);
    this.emit('hazard:spawn', { hazard: h, type: h.type });
    this._spawnWarning(h);
    return h;
  }

  clear() {
    for (const h of this.list) {
      h.dispose?.();
      this.emit('hazard:end', { hazard: h, type: h.type });
    }
    this.list.length = 0;
    this.charges.clear();
    this.vfx.clear();
    this.curtains.clear();
    this.rogueFx.clear();
    this.glowRings.clear();
    this.foamRings.clear();
    this.debris.clear();
    if (this._green > 0) this.ctx.weather?.setGreenTint?.(0);
    this._green = 0;
    this._setHail(0);
  }

  // Added air as an acceleration on the heli (x/z m/s², DESIGN §3.3: K·c·profile·V) + vertical air speed (y, m/s).
  forceAt(x, z, alt, out = new THREE.Vector3()) {
    const a = this._acc;
    a.x = a.y = a.z = 0;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.alive && h.addAir) h.addAir(x, z, alt, a);
    }
    this._rigAir(x, z, Number.isFinite(alt) ? alt : 40, a);
    const k = K * C_WIND * profile(Number.isFinite(alt) ? alt : 40);
    out.set(a.x * k, a.y, a.z * k);
    return out;
  }

  // Horizontal drift (m/s) for floating things: vortex inflow swirl, whirlpool pull, rogue crest sweep.
  surfaceFlowAt(x, z, out = new THREE.Vector2()) {
    out.set(0, 0);
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.alive && h.addFlow) h.addFlow(x, z, out);
    }
    return out;
  }

  // Rogue-wave part of the sea height (m). INFO ONLY: ocean.heightAt already includes it.
  // While a rogue is running this is the ocean's own feature height (exactly what is drawn, Lagrangian
  // inversion included); the analytic crest is the fallback for a stub ocean.
  waveLiftAt(x, z) {
    let s = 0;
    let any = false;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.type === 'rogue' && h.alive) {
        any = true;
        s += h.lift(x, z);
      }
    }
    if (!any) return 0;
    const o = this.ocean;
    return o && typeof o.featureHeightAt === 'function' ? o.featureHeightAt(x, z) : s;
  }

  dangerAt(x, z, altitude = 20) {
    let d = this.charges.danger(x, z);
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.alive && h.danger) d = Math.max(d, h.danger(x, z, altitude));
    }
    return clamp01(d);
  }

  // The most urgent upcoming hazard for the heli {type, position, eta, hazard} (reused object) | null.
  get imminent() {
    const hp = this.heliPos;
    let best = null;
    let bestEta = 30;
    let bestPos = null;
    for (const h of this.list) {
      if (!h.alive) continue;
      let eta = Infinity;
      if (h.type === 'rogue') {
        if (h.threat > 0.15 && h.eta > 0) eta = h.eta;
      } else if (VORTEX_TYPES.has(h.type)) {
        const d = h.distanceAt(hp.x, hp.z, this.heliAlt);
        if (h.stage < 4) eta = d < 600 ? h.eta : Infinity;
        else if (h.stage === 4 && d < 320) eta = Math.max(0, (d - 2 * h.rc) / 12);
      } else if (h.type === 'downburst' || h.type === 'hail') {
        const d = Math.hypot(h.position.x - hp.x, h.position.z - hp.z);
        if (d < h.radius + 150) eta = h.eta + Math.max(0, d - h.radius) / 15;
      }
      if (eta < bestEta) {
        bestEta = eta;
        best = h;
        bestPos = h.position;
      }
    }
    const c = this.charges.nearest(hp.x, hp.z);
    if (c && c.eta < bestEta) {
      bestEta = c.eta;
      best = null;
      this._imm.type = 'lightning';
      this._imm.position.set(c.x, 0, c.z);
      this._imm.eta = Math.max(0, c.eta);
      this._imm.hazard = null;
      return this._imm;
    }
    if (!best) return null;
    this._imm.type = best.type;
    this._imm.position.copy(bestPos);
    this._imm.eta = bestEta;
    this._imm.hazard = best;
    return this._imm;
  }

  // Beyond the contract: hazards within r of a point (for HUD / radio), fills `out`.
  hazardsNear(x, z, r, out = []) {
    out.length = 0;
    for (const h of this.list) if (h.alive && Math.hypot(h.position.x - x, h.position.z - z) < r + (h.radius || 0)) out.push(h);
    return out;
  }

  dissipate(h) {
    h?.dissipate?.();
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    this.time += dt;
    this.uniforms.uHzTime.value = this.time;
    this._readEnv();
    if (this.playing && dt > 0) {
      this.playClock += dt;
      this._runSchedule();
      this._random(dt);
    }

    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      if (h.alive) h.update(dt, this.env);
      if (!h.alive) {
        h.dispose?.();
        list.splice(i, 1);
        this.emit('hazard:end', { hazard: h, type: h.type });
      }
    }
    this._interact(dt);
    this.charges.update(dt);
    this._greenSky();
    this._hail(dt);

    this._updateUniforms(ctx.weather?.state || this._fallbackSt);
    this.vfx.pack();
    this.curtains.pack();
    this.rogueFx.pack();
    this.glowRings.update(this.ocean, 0.35);
    this.foamRings.update(this.ocean, 0.45);
    this.debris.update();
  }

  // Called by Spout when it changes stage.
  onStage(h) {
    if (h.type === 'satellite') return;
    this.emit('hazard:stage', { hazard: h, type: h.type, stage: h.stage, name: h.stageName });
  }

  // ---------------------------------------------------------------------------------------------
  // heli helpers
  hitHeli(amount, source, info) {
    const h = this.ctx.heli;
    if (!h || h.alive === false || !(amount > 0)) return;
    if (typeof h.damage === 'function') h.damage(amount, source);
    this.emit('hazard:hit', { ...info, type: info?.type || source, damage: amount, source });
  }

  // Instant velocity change; `suppressWater` s without the heli's own water-strike damage (the hazard
  // already charged for the same impact).
  heliImpulse(v, suppressWater = 0) {
    const h = this.ctx.heli;
    if (!h) return;
    h.applyImpulse?.(v);
    const f = h.flight;
    if (suppressWater > 0 && f && Number.isFinite(f.waterCooldown)) f.waterCooldown = Math.max(f.waterCooldown, suppressWater);
  }

  seaHeight(x, z) {
    const o = this.ocean;
    return o && o.heightAt ? o.heightAt(x, z) : 0;
  }

  // Sea height without big features (the rogue crest is added on top by the caller).
  baseSeaAt(x, z) {
    const o = this.ocean;
    if (!o || !o.heightAt) return 0;
    const h = o.heightAt(x, z);
    return o.featureHeightAt ? h - o.featureHeightAt(x, z) : h - this.waveLiftAt(x, z);
  }

  // ---------------------------------------------------------------------------------------------
  // internals
  _readEnv() {
    const ctx = this.ctx;
    const h = ctx.heli;
    if (h && h.position) {
      this.heliPos.copy(h.position);
      if (h.velocity) this.heliVel.copy(h.velocity);
      this.heliAlt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
      this.heliAlive = h.alive !== false;
      this.heliLanded = !!(h.landed || h.onPad);
    } else this.heliAlive = false;
    const st = ctx.weather?.state;
    const env = this.env;
    if (st && st.windDir) {
      const ws = Number(st.windSpeed) || 0;
      env.windDir.x = st.windDir.x;
      env.windDir.z = st.windDir.y;
      env.windSpeed = ws;
      env.wind.x = st.windDir.x * ws;
      env.wind.z = st.windDir.y * ws;
    }
    this.playing = env.playing = ctx.mode === 'play';
    env.t = this.time;
  }

  _missionTime() {
    const e = this.ctx.mission?.elapsed;
    return Number.isFinite(e) ? e : this.playClock;
  }

  _setup(def) {
    this.clear();
    this.def = def;
    this.rng = rng32(((Number(def.seed) || 1) * 2246822519 + 77) >>> 0);
    this.playClock = 0;
    this.randomOn = !!(def.hazardsRandom || def.endless || def.hazards?.random);
    this._cool.spout = 25;
    this._cool.rogue = 40;
    this._cool.downburst = 60;
    this._cool.hail = 80;
    const src = Array.isArray(def.hazards) ? def.hazards : [];
    this.schedule = src
      .filter((e) => e && TYPES.has(ALIAS[e.type] || e.type))
      .map((e) => {
        const type = ALIAS[e.type] || e.type;
        const at = Number(e.at) || 0;
        const tele = Number(e.telegraph ?? e.eta) || 12;
        // a rogue's `at` is when it arrives; it is born `telegraph` seconds earlier
        return { e, type, t: type === 'rogue' ? Math.max(0, at - tele) : at, arrive: at, tele, done: false };
      })
      .sort((a, b) => a.t - b.t);
  }

  _runSchedule() {
    const now = this._missionTime();
    for (const s of this.schedule) {
      if (s.done || now < s.t) continue;
      s.done = true;
      const opts = { ...s.e, scripted: s.e.scripted !== false };
      if (s.type === 'rogue') opts.eta = Math.max(4, Math.min(s.tele, s.arrive - now));
      this.spawn(s.type, opts);
    }
  }

  // Random hazards per preset (DESIGN §3.13): Poisson at weather.state.rates (per minute).
  _random(dt) {
    if (!this.randomOn) return;
    const st = this.ctx.weather?.state;
    if (!st) return;
    const pal = st.palette || {};
    const rates = st.rates || { spouts: pal.spoutsPerMin || 0, rogues: pal.roguesPerMin || 0 };
    const c = this._cool;
    for (const k in c) c[k] -= dt;
    const free = MAX_FEATURES - this._featureCount();
    if (c.spout <= 0 && rates.spouts > 0 && free > 1 && this._count('waterspout') < 2 && this.rng() < (rates.spouts / 60) * dt) {
      c.spout = 25;
      const s = this._pickSpot(320, 620, 200);
      this.spawn('waterspout', { x: s.x, z: s.z });
    }
    if (c.rogue <= 0 && rates.rogues > 0 && free > 1 && this._count('rogue') < 1 && this.rng() < (rates.rogues / 60) * dt && !this.heliLanded) {
      c.rogue = 40;
      this.spawn('rogue', { target: 'heli', telegraph: 12 });
    }
    // NICE extras: rare, only in the worst air
    const I = Number(st.intensity) || 0;
    if (c.downburst <= 0 && I > 0.75 && this._count('downburst') < 1 && this.rng() < (0.08 / 60) * dt) {
      c.downburst = 90;
      this.spawn('downburst', {});
    }
    if (c.hail <= 0 && I > 0.55 && (Number(st.night) || 0) < 0.5 && this._count('hail') < 1 && this.rng() < (0.05 / 60) * dt) {
      c.hail = 150;
      this.spawn('hail', {});
    }
  }

  // A sensible spot: dmin..dmax from the heli, upwind-biased (so it drifts into the play), away from pads
  // and other hazards, inside the mission area.
  _pickSpot(dmin, dmax, padClear) {
    const hp = this.heliPos;
    const wd = this.env.windDir;
    const up = Math.atan2(-wd.z, -wd.x);
    const pads = this.ctx.world?.pads || [];
    const area = (this.def?.area?.radius || 1500) + 300;
    const out = this._spot || (this._spot = { x: 0, z: 0 });
    let best = -Infinity;
    for (let i = 0; i < 14; i++) {
      const a = up + (this.rng() - 0.5) * 2.8;
      const d = lerp(dmin, dmax, Math.sqrt(this.rng()));
      const x = hp.x + Math.cos(a) * d;
      const z = hp.z + Math.sin(a) * d;
      let score = 0;
      for (const p of pads) {
        if (!p || !p.position) continue;
        const pd = Math.hypot(p.position.x - x, p.position.z - z);
        if (pd < padClear) score -= (padClear - pd) * 2;
      }
      for (const h of this.list) {
        const hd = Math.hypot(h.position.x - x, h.position.z - z);
        if (hd < 260) score -= 260 - hd;
      }
      const r = Math.hypot(x, z);
      if (r > area) score -= r - area;
      if (score > best) {
        best = score;
        out.x = x;
        out.z = z;
      }
      if (score >= 0) break;
    }
    return out;
  }

  _count(type) {
    let n = 0;
    for (const h of this.list) if (h.alive && h.type === type) n++;
    return n;
  }

  _featureCount() {
    let n = 0;
    for (const h of this.list) if (h.alive && FEATURE_TYPES.has(h.type)) n++;
    return n;
  }

  // Make room for a new ocean feature: random hazards give way to scripted ones.
  _evict(scripted) {
    if (!scripted) return false;
    let victim = null;
    for (const h of this.list) {
      if (!h.alive || h.scripted || !FEATURE_TYPES.has(h.type)) continue;
      if (!victim || h.age > victim.age) victim = h;
    }
    if (!victim) return false;
    this._kill(victim);
    return true;
  }

  _evictType(type) {
    for (const h of this.list) {
      if (h.alive && h.type === type && !h.scripted) {
        this._kill(h);
        return true;
      }
    }
    return false;
  }

  _kill(h) {
    const i = this.list.indexOf(h);
    h.dispose?.();
    if (i >= 0) this.list.splice(i, 1);
    this.emit('hazard:end', { hazard: h, type: h.type });
  }

  _spawnWarning(h) {
    if (!this.playing) return;
    const hp = this.heliPos;
    const d = Math.hypot(h.position.x - hp.x, h.position.z - hp.z);
    if (h.type === 'tornado') {
      h.warned600 = d < 600;
      this.warn({ type: 'tornado', hazard: h, eta: h.telegraph, stage: 'telegraph', level: 'danger', text: 'ТОРНАДО', detail: `${metres(d)} · ${fromPhrase(h.position.x - hp.x, h.position.z - hp.z).toUpperCase()}` });
    } else if (h.type === 'whirlpool' && d < 1200) {
      this.warn({ type: 'whirlpool', hazard: h, eta: h.eta, stage: 'telegraph', level: 'caution', text: 'ВОДОВОРОТ', detail: metres(d) });
    }
  }

  // Heli ↔ hazards: approach warnings, vortex core damage (ticks of 0.5 s), «Глаз в глаз» near-miss,
  // post 'vortex' pulse when the camera target is inside, debris strikes, downburst / hail warnings.
  _interact(dt) {
    const hp = this.heliPos;
    const alt = this.heliAlt;
    const live = this.playing && this.heliAlive && dt > 0;
    const exposed = live && !this.heliLanded;
    this._debrisCd = Math.max(0, this._debrisCd - dt);
    for (const h of this.list) {
      if (!h.alive) continue;
      if (VORTEX_TYPES.has(h.type)) {
        this._vortexContact(h, dt, live, exposed, hp, alt);
        if (h.satellites) for (const s of h.satellites) this._vortexContact(s, dt, live, exposed, hp, alt);
        if (exposed && h.debris && h.debris.length && this._debrisCd <= 0) {
          for (const d of h.debris) {
            if (d.gone) continue;
            const it = d.it;
            const dx = it.x - hp.x, dy = it.y - hp.y, dz = it.z - hp.z;
            if (dx * dx + dy * dy + dz * dz < (d.hitR + 2.5) ** 2) {
              this._debrisCd = 1.0;
              this.hitHeli(0.05, 'debris', { type: 'tornado', x: it.x, z: it.z, hazard: h });
              h.passDamaged = true;
              break;
            }
          }
        }
      } else if (live && (h.type === 'downburst' || h.type === 'hail') && !h.warned) {
        const d = Math.hypot(h.position.x - hp.x, h.position.z - hp.z);
        if (d < h.radius + (h.type === 'hail' ? 250 : 150)) {
          h.warned = true;
          this.warn({ type: h.type, hazard: h, eta: h.eta, stage: 'telegraph', level: 'caution', text: h.label, detail: metres(Math.max(0, d - h.radius)) });
        }
      }
    }
  }

  _vortexContact(h, dt, live, exposed, hp, alt) {
    const d = h.distanceAt(hp.x, hp.z, alt);
    const sat = h.type === 'satellite';
    if (live && !sat) {
      const near = d < 300 && h.stage >= 3 && h.stage < 5;
      if (!h.warned600 && d < 600) {
        // one warning per approach: «СМЕРЧ · 550 М» (caution), or straight to danger when already close
        h.warned600 = true;
        h.warned300 = near;
        this.warn({ type: h.type, hazard: h, eta: h.eta, distance: d, stage: near ? 'near' : 'approach', level: d < 300 ? 'danger' : 'caution', text: `${h.label} · ${d < 75 ? 'РЯДОМ' : metres(d)}` });
      } else if (h.warned600 && d > 800) h.warned600 = false;
      if (!h.warned300 && near) {
        h.warned300 = true;
        this.warn({ type: h.type, hazard: h, eta: h.eta, distance: d, stage: 'near', level: 'danger', text: `${h.label} · ${d < 75 ? 'РЯДОМ' : metres(d)}` });
      } else if (h.warned300 && d > 450) h.warned300 = false;
    }
    // core: thrust ×0.4 (heli reads coreRadius/stage), +updraft (forceAt), 6 %/s (tornado 10 %/s)
    if (exposed && h.stage >= 4 && h.stage < 5 && h.strength > 0.5) {
      if (d < h.rc) {
        h.dmgAcc += h.P.damage * h.strength * dt;
        h.passDamaged = true;
      }
      h.dmgTick += dt;
      if (h.dmgTick >= 0.5) {
        h.dmgTick = 0;
        if (h.dmgAcc > 0) {
          this.hitHeli(h.dmgAcc, h.type === 'tornado' ? 'tornado' : 'waterspout', { type: h.type === 'satellite' ? 'waterspout' : h.type, hazard: h, core: true });
          h.dmgAcc = 0;
        }
      }
    }
    // «Глаз в глаз»: closer than 2·Rc to the core and out again without damage
    if (live && h.stage >= 3 && h.stage < 5) {
      if (d < 2 * h.rc) {
        if (!h.closePass) {
          h.closePass = true;
          h.passDamaged = false;
          h.minPass = d;
        }
        h.minPass = Math.min(h.minPass, d);
      } else if (h.closePass && d > 2.4 * h.rc) {
        h.closePass = false;
        if (!h.passDamaged) this.emit('hazard:near-miss', { type: sat ? 'waterspout' : h.type, distance: h.minPass, hazard: h });
      }
    }
    // the camera target is inside the funnel → radial smear + grey veil
    if (h.stage >= 3 && d < 1.5 * h.rc && dt > 0) {
      const s = (1 - d / (1.5 * h.rc)) * Math.max(h.strength, 0.3);
      if (s > 0.02) this.ctx.post?.pulse?.('vortex', s);
    }
  }

  // Tornado green sky: the strongest tornado's level, eased by weather (λ 0.5) on top of our 20 s ramp.
  _greenSky() {
    let g = 0;
    for (const h of this.list) if (h.alive && h.type === 'tornado') g = Math.max(g, h.green || 0);
    if (Math.abs(g - this._green) > 0.004 || (g === 0 && this._green !== 0)) {
      this._green = g;
      this.ctx.weather?.setGreenTint?.(g);
    }
  }

  // Hail cells: damage 1 %/s (×1.5 above 25 m/s) in ticks, and the hail level for fx pellets.
  _hail(dt) {
    let level = 0;
    for (const h of this.list) if (h.alive && h.type === 'hail') level = Math.max(level, h.levelAt(this.heliPos.x, this.heliPos.z));
    const hd = this._hailDmg;
    if (level > 0.5 && this.playing && this.heliAlive && !this.heliLanded && dt > 0) {
      const speed = Math.hypot(this.heliVel.x, this.heliVel.z);
      hd.acc += HAIL.damage * (speed > 25 ? 1.5 : 1) * dt;
    }
    hd.t += dt;
    if (hd.t >= 0.5) {
      hd.t = 0;
      if (hd.acc > 0) {
        this.hitHeli(hd.acc, 'hail', { type: 'hail' });
        hd.acc = 0;
      }
    }
    this._setHail(level);
  }

  // weather owns state.hail (weather.setHail); hazards drive it while a cell is near (direct write only for a stub).
  _setHail(v) {
    const w = this.ctx.weather;
    if (!w) return;
    if (v <= 0 && this._hailOut <= 0) return;
    this._hailOut = v;
    if (typeof w.setHail === 'function') w.setHail(v);
    else if (w.state) w.state.hail = v;
  }

  // Rig air (DESIGN §3.9): lee turbulence wedge 150 m downwind (+4 m/s noise) and the flare plume updraft.
  _rigAir(x, z, alt, acc) {
    const pads = this.ctx.world?.pads;
    if (!pads || !pads.length) return;
    const wd = this.env.windDir;
    const ws = this.env.windSpeed;
    const noise = this.ctx.noise;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || p.type !== 'rig' || !p.position) continue;
      if (p.lee !== false && ws > 0.5 && noise) {
        const L = p.leeLength || 150;
        const amp = p.leeNoise ?? 4;
        const rx = x - p.position.x;
        const rz = z - p.position.z;
        const along = rx * wd.x + rz * wd.z;
        if (along > 0 && along < L) {
          const lat = Math.abs(-rx * wd.z + rz * wd.x);
          const half = 22 + along * 0.42;
          const k = Math.pow(1 - along / L, 0.6) * (1 - smooth(0.65 * half, half, lat)) *
            (1 - smooth(p.position.y + 20, p.position.y + 60, alt)) * Math.min(1, ws / 8);
          if (k > 0.001) {
            const t = this.time;
            acc.x += amp * k * noise(t * 1.3 + along * 0.02, 11.7 + lat * 0.03);
            acc.z += amp * k * noise(t * 1.3 + 37.1, along * 0.02 - lat * 0.03);
            acc.y += 1.5 * k * noise(t * 0.9 + 71.3, along * 0.015);
          }
        }
      }
      const fl = p.flare;
      if (fl && Number.isFinite(fl.x)) {
        const h = alt - fl.y;
        if (h > -4 && h < 90) {
          const drift = Math.max(0, h) * Math.min(3, ws / 4);
          const cx = fl.x + wd.x * drift;
          const cz = fl.z + wd.z * drift;
          const rad = 6 + 0.3 * Math.max(0, h);
          const q = ((x - cx) ** 2 + (z - cz) ** 2) / (rad * rad);
          if (q < 9) acc.y += 4 * Math.exp(-q) * (1 - smooth(60, 90, h)) * smooth(-4, 2, h);
        }
      }
    }
  }

  _applyQuality() {
    this.uniforms.uQuality.value = QUALITY_K[this.ctx.settings.get('quality')] ?? 1;
  }

  // Light on hazard media (spray, condensation, cloud): the palette's ambient + sun, normalised so that a
  // daytime storm still shows the funnels in their nominal greys (DESIGN pillar 8 «читаемо в худшем
  // кадре»): dark daytime presets are lifted up to ×3.2, bright ones are left alone, night is not lifted
  // (there the searchlight, the flash and a faint floor carry the read).
  _updateUniforms(st) {
    const u = this.uniforms;
    const p = st.palette || {};
    const night = clamp01(Number(st.night) || 0);
    const amb = u.uAirAmb.value;
    const sun = u.uAirSun.value;
    if (p.ambient && p.ambient.isColor) amb.copy(p.ambient).multiplyScalar((p.ambientIntensity ?? 0.6) * 2.2);
    else amb.setRGB(0.45, 0.5, 0.52);
    const sd = st.sunDirVisual || st.sunDir;
    const sunY = sd ? Math.max(0, sd.y) : 0.6;
    if (p.sun && p.sun.isColor) sun.copy(p.sun).multiplyScalar((p.sunIntensity ?? 1) * (0.25 + 0.75 * sunY) * 1.1);
    else sun.setRGB(0.5, 0.48, 0.45);
    const lum = 0.2126 * (amb.r + 0.6 * sun.r) + 0.7152 * (amb.g + 0.6 * sun.g) + 0.0722 * (amb.b + 0.6 * sun.b);
    const lift = 1 + (Math.min(3.2, Math.max(1, 1.1 / Math.max(lum, 1e-3))) - 1) * (1 - smooth(0.35, 0.8, night));
    const g = lift * this.mediaGain;
    amb.multiplyScalar(g);
    sun.multiplyScalar(g);
    if (sd) u.uAirSunDir.value.copy(sd);
    const flash = clamp01(Number(st.flash) || 0);
    if (st.flashColor && st.flashColor.isColor) u.uAirFlash.value.copy(st.flashColor).multiplyScalar(flash);
    else u.uAirFlash.value.setRGB(flash * 0.78, flash * 0.84, flash);
    u.uAirNight.value = night;
    u.uClear.value = (1 - smooth(0.15, 0.55, Number(st.intensity) || 0)) * (1 - night);
    const beam = this.ctx.heli?.beam;
    if (beam && beam.on && beam.intensity > 0.01 && beam.origin && beam.dir) {
      u.uBeamPos.value.set(beam.origin.x, beam.origin.y, beam.origin.z, beam.intensity * (0.3 + 0.7 * night));
      u.uBeamDir.value.set(beam.dir.x, beam.dir.y, beam.dir.z, Number.isFinite(beam.cosOuter) ? beam.cosOuter : 0.97);
      u.uBeamLen.value = beam.length || 30;
    } else u.uBeamPos.value.w = 0;
    const cam = this.ctx.camera;
    const v = this._v3.copy(this.heliPos).project(cam);
    u.uHeliNdc.value.set(v.x * (cam.aspect || 1.78), v.y, 0.3, this.heliAlive && v.z < 1 ? 1 : 0);
    u.uHeliDist.value = cam.position.distanceTo(this.heliPos);
    u.uAspect.value = cam.aspect || 1.78;
    u.uShadowY.value = 0.75 * (Number(st.waveHeight) || 0.5) + 1.2;
  }
}

