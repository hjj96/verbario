// Effects — FX & AIR & LIFE (CONTRACT «fx»; DESIGN §2.7.3–2.7.4, §2.11–§2.13, §2.15, §8.2).
//
// Everything that lives in the air between the camera and the sea, plus the particle API other
// systems use. Helpers live in systems/fx/*:
//   common.js     quality budgets, fixed colours, shared "air lighting" uniforms + GLSL (fog, beam, lights)
//   lightpool.js  the 4 pooled PointLights behind fx.acquireLight() (virtual handles, priority by impact)
//   particles.js  GPU particle pools (spray / smoke / glow) — CPU writes a particle once, the GPU flies it
//   rain.js       instanced rain streaks converging to the nadir, sparkle in the beam; motes; hail pellets
//   lightning.js  sea-strike spears and in-cloud spiders (ribbons), cloud flash spots for the scud
//   sky.js        scud layer, fog layers with the rotor hole, glory, sea smoke
//   gusts.js      gust-front streak ribbons ahead of every gust front
//   signals.js    flares on the water, red parachute rockets, glow sprites, light rings
//   life.js       gulls over hidden survivors, dolphins, night jellyfish
//
// Public API (CONTRACT + extras, see the report):
//   splash(x, y, z, size), spray(x, z, dir, amount), smoke(x, y, z, color, amount, opts?),
//   sparks(x, y, z, color, amount), flare(x, z, opts?) → flare, burst(name, position, opts) → handle|null,
//   acquireLight(color, intensity, distance) → handle {position, color, set(I), setColor(c), setDistance(d), release()},
//   bolt(x, z, strength), spider(x, z, strength), steam(x, y, z, amount), clear(), seaHeight(x, z),
//   flares (live list), rockets, gulls, stats.
import * as THREE from 'three';
import { QUALITY, COLORS, qualityOf, createAirUniforms, toColor, isOrange, lum, smooth, clamp01, strokeEnvelope, softEnvelope } from './fx/common.js';
import { LightPool } from './fx/lightpool.js';
import { ParticlePool, F_SWIRL, F_STRETCH, F_TWINKLE, F_BIO, F_TURB, F_FLOAT } from './fx/particles.js';
import { Rain } from './fx/rain.js';
import { LightningFx } from './fx/lightning.js';
import { Scud, AirLayers } from './fx/sky.js';
import { GustStreaks } from './fx/gusts.js';
import { Glows, Rings, Signals } from './fx/signals.js';
import { Gulls, Dolphins, Jellies, Whale } from './fx/life.js';

const HIGH = QUALITY.high;
const MAX_SPRAY = HIGH.downwash + HIGH.crest + HIGH.splash;
const DEG = Math.PI / 180;

// Particle behaviour presets (constant objects: no allocation per spawn).
const P = {
  dwSpray: { drag: 1.5, accY: -6, wind: 0.55, flags: F_STRETCH, emissive: 0, spin: 0.6 },
  dwMist: { drag: 1.3, accY: -1.6, wind: 0.95, flags: 0, emissive: 0, spin: 0.7 }, // soft round wash mist
  dwHaze: { drag: 0.7, accY: 0.25, wind: 1.0, flags: F_FLOAT, emissive: 0, spin: 0.15 }, // low annulus haze
  crest: { drag: 0.7, accY: -3.5, wind: 0.75, flags: F_STRETCH, emissive: 0, spin: 0.3 },
  droplet: { drag: 0.6, accY: -9.8, wind: 0.3, flags: 0, emissive: 0, spin: 0.8 },
  mist: { drag: 1.2, accY: -0.5, wind: 0.7, flags: 0, emissive: 0, spin: 0.3 },
  signalSmoke: { drag: 0.8, accY: 1.2, wind: 0.8, flags: F_TURB, emissive: 0, spin: 0.25 },
  damageSmoke: { drag: 1.1, accY: 0.7, wind: 1.0, flags: F_SWIRL | F_TURB, emissive: 0, spin: 0.5 },
  smoke: { drag: 0.9, accY: 0.9, wind: 0.85, flags: F_SWIRL | F_TURB, emissive: 0, spin: 0.35 },
  steam: { drag: 0.9, accY: 2.4, wind: 0.7, flags: 0, emissive: 0, spin: 0.4 },
  boltSteam: { drag: 1.4, accY: 1.5, wind: 0.85, flags: F_TURB, emissive: 0, spin: 0.6 },
  spark: { drag: 0.8, accY: -9.8, wind: 0.2, flags: F_STRETCH | F_TWINKLE, emissive: 1, spin: 0 },
  bio: { drag: 1.6, accY: -3, wind: 0.4, flags: F_TWINKLE | F_BIO | F_FLOAT, emissive: 1, spin: 0 }, // skims the surface
  hail: { drag: 0.4, accY: -9.8, wind: 0.2, flags: 0, emissive: 0, spin: 0 },
};

export class Effects {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.quality = qualityOf(ctx.settings);
    this.cfg = QUALITY[this.quality];
    const look = ctx.look;
    const scene = ctx.scene;
    this.air = createAirUniforms();

    // --- lights (created once — CONTRACT) ---------------------------------------------------------
    this.lightPool = new LightPool(scene);

    // --- particle pools ---------------------------------------------------------------------------
    this.pools = {
      spray: new ParticlePool('spray', 'spray', look, this.air, MAX_SPRAY),
      smoke: new ParticlePool('smoke', 'smoke', look, this.air, HIGH.smoke),
      glow: new ParticlePool('glow', 'glow', look, this.air, HIGH.glow),
    };
    this._poolList = [this.pools.spray, this.pools.smoke, this.pools.glow];
    for (const p of this._poolList) scene.add(p.mesh);

    // --- air, sky, life ---------------------------------------------------------------------------
    this.rain = new Rain(look, this.air, HIGH.rain, HIGH.motes);
    this.lightning = new LightningFx(look, this.air, scene);
    this.scud = new Scud(look, this.air);
    this.layers = new AirLayers(look, this.air);
    this.gusts = new GustStreaks(look, this.air);
    this.glows = new Glows(look, this.air);
    this.rings = new Rings(look, this.air);
    this.signals = new Signals(this);
    this.gulls = new Gulls(this, HIGH.gulls);
    this.dolphins = new Dolphins(this, HIGH.dolphins);
    this.jellies = new Jellies(look, this.air, HIGH.jelly);
    this.whale = new Whale(this, true);
    scene.add(
      this.rain.mesh, this.rain.local, this.rain.localLight, this.rain.motes, this.scud.mesh, this.scud.shadow, ...this.layers.layers, this.layers.glory,
      this.gusts.mesh, this.glows.mesh, this.rings.mesh, this.gulls.mesh, this.dolphins.mesh, this.jellies.mesh, this.whale.mesh, this.whale.shade,
    );

    // --- state / scratch --------------------------------------------------------------------------
    this.focus = { x: 0, z: 0 };
    this.heli = { x: 0, y: 40, z: 0, alt: 40, alive: false, rpm: 1, vx: 0, vz: 0 };
    this.dw = { x: 0, z: 0, radius: 9, strength: 0 };
    this.wind = new THREE.Vector2();
    this.heliNdc = { x: 0, y: 0 };
    this.stars = []; // timed impact stars {x, y, z, t, life, I}
    this.timedLights = []; // {handle, t, life, peak, reduced}
    this.emitters = []; // smoke emitter coalescing slots
    for (let i = 0; i < 24; i++) this.emitters.push({ x: 0, z: 0, kind: 0, lastT: -99, budget: 0, acc: 0 });
    this.stats = { emitted: 0 };
    // Debug / test switches (console: __game.fx.enabled.rain = false).
    this.enabled = { rain: true, scud: true, fogLayers: true, seaSmoke: true, gusts: true, particles: true, gulls: true, life: true, lightning: true };
    this._acc = { dw: 0, dwHaze: 0, bio: 0, crest: 0, hail: 0, hailShake: 0 };
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._col = new THREE.Color();
    this._sprayCol = new THREE.Color(COLORS.spray);
    this._bioCol = new THREE.Color(COLORS.bio).multiplyScalar(4);
    this._steamCol = new THREE.Color(COLORS.steam);
    this._starCol = new THREE.Color('#FFFFFF');
    this._haloCol = new THREE.Color(COLORS.boltHalo);
    this._orange = new THREE.Color(COLORS.smokeOrange);
    this._orangeEnd = new THREE.Color(COLORS.smokeOrangeEnd);
    this._light = new THREE.Color();
    this._fwd = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v2 = new THREE.Vector2();
    this._fallbackSt = { palette: {}, rain: 0, night: 0, flash: 0, intensity: 0, waveHeight: 0.5, windDir: new THREE.Vector2(1, 0), windSpeed: 3 };

    this._applyQuality(this.quality);

    // --- events -----------------------------------------------------------------------------------
    const ev = ctx.events;
    ev.on('weather:lightning', (e) => this._onLightning(e));
    ev.on('weather:gust', (e) => {
      if (!Array.isArray(ctx.weather?.state?.gustFronts)) this.gusts.onGust(e, ctx.weather?.state?.windSpeed);
    });
    ev.on('mission:setup', () => this.clear());
    const scare = (e) => {
      const h = e?.hazard || e;
      const t = h?.type;
      const p = h?.position || e?.position;
      if (p && (t === 'waterspout' || t === 'tornado' || t === 'downburst' || t === 'hail')) this.gulls.scare(p.x, p.z, 520);
    };
    ev.on('hazard:warning', scare);
    ev.on('hazard:spawn', scare);
    ctx.settings.onChange?.((k) => {
      if (k === 'quality') this._applyQuality(qualityOf(ctx.settings));
    });
  }

  async init() {
    this._readState();
    // Warm up every FX program once (DESIGN §8.1) so the first rain / strike / flare never stalls.
    const r = this.ctx.renderer;
    const objs = [];
    this.ctx.scene.traverse((o) => {
      if (o.name && o.name.startsWith('fx.') && (o.isMesh || o.isInstancedMesh)) objs.push([o, o.visible]);
    });
    try {
      for (const [o] of objs) o.visible = true;
      // compileAsync warns when KHR_parallel_shader_compile is missing (SwiftShader) — compile() then
      if (r.compileAsync && r.extensions?.has?.('KHR_parallel_shader_compile')) await r.compileAsync(this.ctx.scene, this.ctx.camera);
      else r.compile?.(this.ctx.scene, this.ctx.camera);
    } catch (err) {
      /* warming is an optimisation only */
    } finally {
      for (const [o, v] of objs) o.visible = v;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Quality (DESIGN §8.2)
  _applyQuality(q) {
    this.quality = q;
    const c = (this.cfg = QUALITY[q] || HIGH);
    this.pools.spray.setCapacity(c.downwash + c.crest + c.splash);
    this.pools.smoke.setCapacity(c.smoke);
    this.pools.glow.setCapacity(c.glow);
    this.rain.setCounts(c.rain, c.motes);
    this.scud.setCount(c.scud);
    this.layers.setQuality(c.fogLayers, c.seaSmoke);
    this.gulls.setLimit(c.gulls);
    this.dolphins.setLimit(c.dolphins);
    this.jellies.setLimit(c.jelly);
    this.whale.setAllowed(c.dolphins > 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Public API (CONTRACT)

  // Droplet burst (boat slams, water strikes, raft drops, dolphins).
  splash(x, y, z, size = 2) {
    if (!Number.isFinite(x + z)) return;
    const s = Math.max(0.3, Math.min(14, Number(size) || 2));
    const sea = Number.isFinite(y) ? y : this.seaHeight(x, z);
    const sp = this.pools.spray;
    const t = this.t;
    const n = Math.min(64, Math.round(8 + s * 5));
    const k = Math.sqrt(s / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = (0.6 + 2.2 * Math.random()) * k;
      const up = (3 + 5 * Math.random()) * Math.min(2.2, k);
      const sz = (0.35 + 0.5 * Math.random()) * Math.min(2.2, k);
      sp.emit(t, x + Math.cos(a) * 0.3 * s, sea + 0.2, z + Math.sin(a) * 0.3 * s, Math.cos(a) * rad, up, Math.sin(a) * rad,
        0.6 + 0.8 * Math.random(), sz, sz * 2.6, this._sprayCol, 0.55, this._sprayCol, P.droplet);
    }
    const mists = Math.min(6, 1 + Math.round(s * 0.5));
    for (let i = 0; i < mists; i++) {
      const a = Math.random() * Math.PI * 2;
      sp.emit(t, x + Math.cos(a) * s * 0.4, sea + 0.4, z + Math.sin(a) * s * 0.4, Math.cos(a) * 1.5, 1.2 + Math.random(), Math.sin(a) * 1.5,
        1.2 + Math.random(), 0.8 * s, 2.6 * s, this._sprayCol, 0.22, this._sprayCol, P.mist);
    }
    this._bioBurst(x, sea, z, n * 0.4, 3 * k);
  }

  // Spray sheet from the water surface along dir (Vector2; zero → radial).
  spray(x, z, dir, amount = 10) {
    if (!Number.isFinite(x + z)) return;
    const n = Math.min(70, Math.max(0, Math.round(Number(amount) || 0)));
    if (!n) return;
    // fx owns the downwash ring itself (DESIGN §2.13): small spray calls ON the active ring are absorbed
    const dw = this.dw;
    if (dw.strength > 0.02 && n <= 4) {
      const d = Math.hypot(x - dw.x, z - dw.z);
      if (d > dw.radius * 0.55 && d < dw.radius * 1.5) return;
    }
    const sea = this.seaHeight(x, z);
    let dx = dir?.x ?? 0;
    let dz = dir?.y ?? 0;
    const dl = Math.hypot(dx, dz);
    const radial = dl < 1e-3;
    if (!radial) {
      dx /= dl;
      dz /= dl;
    }
    const sp = this.pools.spray;
    const t = this.t;
    for (let i = 0; i < n; i++) {
      let vx, vz;
      if (radial) {
        const a = Math.random() * Math.PI * 2;
        const v = 4 + 8 * Math.random();
        vx = Math.cos(a) * v;
        vz = Math.sin(a) * v;
      } else {
        const v = 6 + 7 * Math.random();
        const sd = (Math.random() - 0.5) * 0.7;
        vx = (dx - dz * sd) * v;
        vz = (dz + dx * sd) * v;
      }
      const sz = 0.5 + 0.5 * Math.random();
      sp.emit(t, x + (Math.random() - 0.5), sea + 0.3, z + (Math.random() - 0.5), vx, 1.5 + 3 * Math.random(), vz,
        0.8 + 0.7 * Math.random(), sz, 2.5 + Math.random(), this._sprayCol, 0.42, this._sprayCol, P.dwSpray);
    }
    this._bioBurst(x, sea, z, n * 0.3, 6);
  }

  // Smoke emitter tick. `amount` = puffs this call (fractions accumulate); repeated calls from the same
  // spot are rate-limited, so per-frame callers are safe. Colour picks the behaviour:
  //   signal orange (#FF7B2E-ish) → survivor day smoke: rises 1.5 m/s, drifts wind ×0.8, 1 → 10 m, → #E8A27A
  //   dark grey / black            → damage smoke swirled by the rotor downwash
  //   anything else                → generic smoke (flare / rig / steam-like)
  // opts: { life, size: [s0, s1], rise, alpha, kind: 'signal'|'damage'|'generic'|'steam' }
  smoke(x, y, z, color = '#888888', amount = 1, opts) {
    if (!Number.isFinite(x + y + z)) return;
    const c = toColor(color, this._col);
    let kind = opts?.kind;
    if (!kind) kind = isOrange(c) ? 'signal' : lum(c) < 0.05 ? 'damage' : 'generic';
    const kindId = kind === 'signal' ? 1 : kind === 'damage' ? 2 : kind === 'steam' ? 3 : 4;
    const maxRate = kind === 'signal' ? 12 : kind === 'damage' ? 16 : 12;
    const slot = this._emitter(x, z, kindId);
    const t = this.t;
    slot.budget = Math.min(3, slot.budget + (t - slot.lastT) * maxRate);
    slot.lastT = t;
    // signal smoke: fewer, bigger puffs read as billows instead of a smooth tube
    slot.acc += Math.max(0, Number(amount) || 0) * (kind === 'signal' ? 0.6 : 1);
    const pool = this.pools.smoke;
    let guard = 8;
    while (slot.acc >= 1 && slot.budget >= 1 && guard-- > 0) {
      slot.acc -= 1;
      slot.budget -= 1;
      this._smokePuff(pool, kind, x, y, z, c, opts);
    }
    if (slot.acc > 4) slot.acc = 4;
  }

  _emitter(x, z, kind) {
    let best = null;
    let oldest = null;
    for (const e of this.emitters) {
      if (e.kind === kind && this.t - e.lastT < 0.8 && Math.abs(e.x - x) < 4 && Math.abs(e.z - z) < 4) {
        best = e;
        break;
      }
      if (!oldest || e.lastT < oldest.lastT) oldest = e;
    }
    if (best) {
      best.x = x;
      best.z = z;
      return best;
    }
    oldest.kind = kind;
    oldest.x = x;
    oldest.z = z;
    oldest.lastT = this.t - 0.12;
    oldest.budget = 1;
    oldest.acc = 0;
    return oldest;
  }

  _smokePuff(pool, kind, x, y, z, c, opts) {
    const t = this.t;
    const j = () => (Math.random() - 0.5);
    if (kind === 'signal') {
      // survivor's orange day smoke: the best wind indicator in the game (DESIGN §2.10)
      // dense saturated orange at the canister, billowing out into a wide pale plume downwind
      // per-puff random size (and rotation, in emit): a billowing plume, not a string of equal balls
      const s0 = (opts?.size?.[0] ?? 0.9) * (0.6 + 0.8 * Math.random());
      const s1 = opts?.size?.[1] ?? 10;
      const v = 0.9 + 0.2 * Math.random();
      pool.emit(t, x + j() * 0.4, y + 0.3, z + j() * 0.4, j() * 1.3, opts?.rise ?? 1.5, j() * 1.3,
        opts?.life ?? 9 + 4 * Math.random(), s0, s1 * (0.8 + 0.5 * Math.random()),
        this._c.copy(this._orange).lerp(c, 0.5).multiplyScalar(v), opts?.alpha ?? 0.42, this._orangeEnd, P.signalSmoke);
    } else if (kind === 'damage') {
      // exhaust smoke: inherits a little of the heli's motion, then the downwash takes it
      const h = this.heli;
      const near = Math.hypot(x - h.x, z - h.z) < 8;
      const black = lum(c) < 0.01;
      pool.emit(t, x + j() * 0.3, y, z + j() * 0.3, (near ? h.vx * 0.3 : 0) + j(), 0.4 + Math.random() * 0.6, (near ? h.vz * 0.3 : 0) + j(),
        opts?.life ?? 3 + 1.2 * Math.random(), opts?.size?.[0] ?? 0.9, opts?.size?.[1] ?? 5.5 + 2 * Math.random(),
        this._c.copy(c).multiplyScalar(black ? 1 : 1.2), opts?.alpha ?? (black ? 0.72 : 0.55), this._c2.copy(c).lerp(this._steamCol, 0.25), P.damageSmoke);
    } else if (kind === 'steam') {
      pool.emit(t, x + j() * 2, y + 0.5, z + j() * 2, j(), 2 + Math.random(), j(),
        opts?.life ?? 3 + 1.5 * Math.random(), opts?.size?.[0] ?? 2, opts?.size?.[1] ?? 8 + 3 * Math.random(),
        this._steamCol, opts?.alpha ?? 0.34, this._steamCol, P.steam);
    } else {
      pool.emit(t, x + j() * 0.5, y + 0.2, z + j() * 0.5, j() * 0.6, opts?.rise ?? 1 + Math.random() * 0.6, j() * 0.6,
        opts?.life ?? 5 + 2 * Math.random(), opts?.size?.[0] ?? 1.2, opts?.size?.[1] ?? 7 + 3 * Math.random(),
        c, opts?.alpha ?? 0.45, this._c2.copy(c).lerp(this._steamCol, 0.35), P.smoke);
    }
  }

  // Additive sparks (embers, damage sparks, rig flare, impact).
  sparks(x, y, z, color = '#FFB050', amount = 6) {
    if (!Number.isFinite(x + y + z)) return;
    const n = Math.min(48, Math.max(0, Math.round(Number(amount) || 0)));
    const c = toColor(color, this._col).multiplyScalar(7);
    const g = this.pools.glow;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9 + 0.1;
      const v = 3 + 7 * Math.random();
      g.emit(this.t, x, y, z, Math.cos(a) * v * (1 - e * 0.5), v * e + 1.5, Math.sin(a) * v * (1 - e * 0.5),
        0.3 + 0.6 * Math.random(), 0.1, 0.06, c, 1, c, P.spark);
    }
  }

  // Player marker flare on the water: burns ~40 s (pooled red light, flicker, smoke, sparks).
  flare(x, z, opts) {
    if (!Number.isFinite(x + z)) return null;
    return this.signals.flare(x, z, opts || {});
  }

  // Named effects. 'rocket' (red parachute rocket), 'flare', 'splash', 'spray', 'sparks', 'smoke',
  // 'steam', 'strike' | 'bolt' | 'lightning' (sea strike), 'spider', 'crash' (big splash + spray).
  burst(name, position, opts = {}) {
    const p = position || this._v3.set(this.heli.x, 0, this.heli.z);
    const x = p.x ?? 0;
    const z = p.z ?? 0;
    const y = Number.isFinite(p.y) ? p.y : this.seaHeight(x, z);
    switch (name) {
      case 'rocket':
        return this.signals.rocket(x, y, z, opts);
      case 'flare':
        return this.flare(x, z, opts);
      case 'splash':
        this.splash(x, y, z, opts.size ?? 2);
        return null;
      case 'spray':
        this.spray(x, z, opts.dir, opts.amount ?? 20);
        return null;
      case 'sparks':
        this.sparks(x, y, z, opts.color ?? '#FFB050', opts.amount ?? 12);
        return null;
      case 'smoke':
        for (let i = 0; i < (opts.amount ?? 6); i++) this._smokePuff(this.pools.smoke, opts.kind || 'generic', x, y, z, toColor(opts.color ?? '#9A9A9A', this._col), opts);
        return null;
      case 'steam':
        this.steam(x, y, z, opts.amount ?? 8);
        return null;
      case 'strike':
      case 'bolt':
      case 'lightning':
        this.bolt(x, z, opts.strength ?? 1);
        return null;
      case 'spider':
        this.spider(x, z, opts.strength ?? 0.7);
        return null;
      case 'crash':
        this.splash(x, y, z, opts.size ?? 8);
        this.spray(x, z, null, 60);
        return null;
      default:
        this.splash(x, y, z, opts.size ?? 1.5);
        return null;
    }
  }

  steam(x, y, z, amount = 8) {
    const pool = this.pools.smoke;
    const n = Math.min(24, Math.round(amount));
    for (let i = 0; i < n; i++) this._smokePuff(pool, 'steam', x, y, z, this._steamCol, null);
  }

  acquireLight(color, intensity = 0, distance = 60) {
    return this.lightPool.acquire(color, intensity, distance);
  }

  // Sea strike visual + impact: star, steam, light ring, spray, 0.3 s ground glow from a pooled light.
  bolt(x, z, strength = 1) {
    if (!Number.isFinite(x + z)) return;
    const reduced = !!this.ctx.settings.get('reduceFlashes');
    const sea = this.seaHeight(x, z);
    this._camera();
    this.lightning.strike(x, z, sea, strength, this.ctx.camera, this.focus, reduced);
    const k = reduced ? 0.3 : 1;
    this.stars.push({ x, y: sea + 1.0, z, t: 0, life: reduced ? 0.6 : 0.32, I: k * Math.min(1.3, strength), reduced });
    if (this.stars.length > 6) this.stars.shift();
    this.rings.spawn(x, z, 14 + 6 * Math.random(), 0.5, COLORS.boltHalo, 0.5 * k);
    // a short, irregular steam burst: a few noise puffs scattered at random (not around a circle),
    // rising and drifting downwind, gone in ~1.5 s
    const sm = this.pools.smoke;
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const s0 = 1 + 2.5 * Math.random();
      // born just after the return stroke (a negative age hides it), so the flash never lights a white ball
      sm.emit(this.t + 0.12 + 0.25 * Math.random(), x + (Math.random() - 0.5) * 5, sea + 0.5 + 1.5 * Math.random(), z + (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 1.5, 2.5 + 4 * Math.random(), (Math.random() - 0.5) * 1.5,
        1 + 0.9 * Math.random(), s0, s0 * (1.8 + 1.8 * Math.random()), this._steamCol, 0.12 + 0.16 * Math.random(), this._steamCol, P.boltSteam);
    }
    // water thrown up by the strike
    const sp = this.pools.spray;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + 5 * Math.random();
      sp.emit(this.t, x, sea + 0.3, z, Math.cos(a) * v, 7 + 9 * Math.random(), Math.sin(a) * v, 0.9 + 0.8 * Math.random(),
        0.5, 2.2, this._sprayCol, 0.5, this._sprayCol, P.droplet);
    }
    this.sparks(x, sea + 0.5, z, '#DCE6FF', 16);
    // 0.3 s ground glow from the pool: lights the water around the impact without burning it white
    // (the global flash already lifts the whole frame)
    const h = this.acquireLight(COLORS.boltHalo, 0, 90);
    h.position.set(x, sea + 8, z);
    this.timedLights.push({ handle: h, t: 0, life: reduced ? 0.75 : 0.36, peak: 2200 * k * Math.min(1.3, strength), reduced });
  }

  spider(x, z, strength = 0.7) {
    if (!Number.isFinite(x + z)) return;
    this.lightning.spider(x, z, strength, !!this.ctx.settings.get('reduceFlashes'));
  }

  // Reset everything (mission setup).
  clear() {
    this.air.uKillBefore.value = this.t + 1e-4;
    this.signals.clear();
    for (const l of this.timedLights) l.handle.release();
    this.timedLights.length = 0;
    this.stars.length = 0;
    this.lightning.clear();
    this.rings.clear();
    this.gusts.clear();
    this.gulls.clear();
    this.dolphins.clear();
    this.whale.clear();
  }

  seaHeight(x, z) {
    const o = this.ctx.ocean;
    if (!o || !o.heightAt) return 0;
    const h = o.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  }

  get flares() {
    return this.signals.flares;
  }

  get rockets() {
    return this.signals.rockets;
  }

  // ---------------------------------------------------------------------------------------------
  _onLightning(e) {
    if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.z)) return;
    if (e.cloudOnly) this.spider(e.x, e.z, e.strength ?? 0.7);
    else this.bolt(e.x, e.z, e.strength ?? 1);
  }

  _camera() {
    const cam = this.ctx.camera;
    cam.getWorldPosition(this._camPos);
    cam.getWorldDirection(this._fwd);
    const k = this._camPos.y / Math.max(-this._fwd.y, 0.25);
    this.focus.x = this._camPos.x + this._fwd.x * k;
    this.focus.z = this._camPos.z + this._fwd.z * k;
  }

  _readState() {
    const ctx = this.ctx;
    this._camera();
    const h = ctx.heli;
    const hs = this.heli;
    if (h && h.position) {
      hs.x = h.position.x;
      hs.y = h.position.y;
      hs.z = h.position.z;
      hs.alt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
      hs.alive = h.alive !== false;
      hs.rpm = Number.isFinite(h.rotorRPM) ? h.rotorRPM : 1;
      hs.vx = h.velocity?.x ?? 0;
      hs.vz = h.velocity?.z ?? 0;
    } else hs.alive = false;
    // downwash: published by the heli, else derived (R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²)
    const dw = this.dw;
    const hd = h?.downwash;
    if (hd && Number.isFinite(hd.strength)) {
      dw.x = hd.x;
      dw.z = hd.z;
      dw.radius = hd.radius;
      dw.strength = hd.strength;
    } else if (hs.alive) {
      const s = clamp01(1 - (hs.alt - 4) / 28);
      dw.x = hs.x;
      dw.z = hs.z;
      dw.radius = 9 + 0.35 * Math.max(0, hs.alt);
      dw.strength = s * s * clamp01(hs.rpm);
    } else dw.strength = 0;
    // no spray from a rotor turning on a high deck
    const pad = h?.landed;
    if (pad && pad.position && pad.position.y - this.seaHeight(hs.x, hs.z) > 4) dw.strength = 0;
  }

  _updateAir(st) {
    const a = this.air;
    const p = st.palette || {};
    const night = clamp01(st.night ?? 0);
    a.uFxTime.value = this.t;
    a.uAirNight.value = night;
    // Scattering media (spray, rain, smoke) are brighter than a Lambert surface under the same light
    // (forward / multiple scattering of the sky): ambient ×2.2, sun ×1.1 — calibrated so day spray reads
    // white (0.8–0.9 after tone mapping, never clipping) and night media vanish outside beam / flash.
    const amb = a.uAirAmb.value;
    if (p.ambient && p.ambient.isColor) amb.copy(p.ambient).multiplyScalar((p.ambientIntensity ?? 0.6) * 2.2);
    else amb.setRGB(0.5, 0.54, 0.56);
    const sun = a.uAirSun.value;
    const sd = st.sunDirVisual || st.sunDir;
    const sunY = sd ? Math.max(0, sd.y) : 0.6;
    if (p.sun && p.sun.isColor) sun.copy(p.sun).multiplyScalar((p.sunIntensity ?? 1) * (0.25 + 0.75 * sunY) * 1.1);
    else sun.setRGB(0.6, 0.58, 0.55);
    if (sd) a.uAirSunDir.value.copy(sd);
    const fc = st.flashColor && st.flashColor.isColor ? st.flashColor : this._haloCol;
    a.uAirFlash.value.copy(fc).multiplyScalar(clamp01(st.flash ?? 0));
    // searchlight beam (heli.beam): stronger sparkle at night
    const beam = this.ctx.heli?.beam;
    if (beam && beam.on && beam.intensity > 0.01 && beam.origin && beam.dir) {
      a.uBeamPos.value.set(beam.origin.x, beam.origin.y, beam.origin.z, beam.intensity * (0.3 + 0.7 * night));
      a.uBeamDir.value.set(beam.dir.x, beam.dir.y, beam.dir.z, Number.isFinite(beam.cosOuter) ? beam.cosOuter : 0.97);
      a.uBeamLen.value = beam.length || 30;
    } else a.uBeamPos.value.w = 0;
    const h = this.heli;
    a.uHeliP.value.set(h.x, h.y, h.z, h.alive ? 1 : 0);
    a.uDownwash.value.set(this.dw.x, this.dw.z, this.dw.radius, this.dw.strength);
    a.uHs.value = st.waveHeight ?? 0.5;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    this.t += dt;
    const st = ctx.weather?.state || this._fallbackSt;
    const en = this.enabled;
    this._readState();
    this._updateAir(st);

    // mean wind: look.uWind (weather writes it) is what the particle shaders use too
    const lw = ctx.look?.uniforms?.uWind?.value;
    if (lw) this.wind.copy(lw);
    else if (st.windDir) this.wind.copy(st.windDir).multiplyScalar(st.windSpeed ?? 0);
    const reduce = !!ctx.settings.get('reduceFlashes');
    const night = clamp01(st.night ?? 0);

    // emitters, signals, lightning → then the light pool picks its 4 lights for this frame
    this.glows.begin();
    if (dt > 0) {
      this._downwashSpray(dt, night);
      this._crestSpray(dt, st);
      this._hail(dt, st);
    }
    this.signals.update(dt, this.wind, reduce, night);
    this._impacts(dt);
    this.lightning.update(dt, night);
    this.lightPool.update(this.focus.x, this.focus.z, this.air);

    // air between camera and sea
    const camY = Math.max(20, this._camPos.y);
    this.rain.update(dt, st, camY, ctx.heli?.beam, this.wind, this._keyLight());
    this._heliScreen();
    this.scud.update(dt, st, this.wind, this.heliNdc, this.heli.alive, this.lightning.cloudFlash);
    this.layers.update(dt, st, this.wind, this.focus, this.heli, this._camPos.y);
    this.gusts.update(dt, st.gustFronts, this._streakLight(st));
    this.rings.update(dt);

    // life
    this.gulls.update(dt, st, this.wind, this.focus, this.heli);
    this.dolphins.update(dt, st, this.focus, this.heli);
    this.jellies.update(dt, st, this.wind);
    this.whale.update(dt, st, this.focus, this.heli);

    this.glows.end();
    for (const pool of this._poolList) pool.flush();
    this._applyEnabled(en);
    this.stats.emitted = this.pools.spray.emitted + this.pools.smoke.emitted + this.pools.glow.emitted;
  }

  // Debug / test switches (fx.enabled): hide whole layers without touching their state.
  _applyEnabled(en) {
    const R = this.rain;
    if (!en.rain) R.mesh.visible = R.local.visible = R.localLight.visible = R.motes.visible = false;
    if (!en.scud) this.scud.mesh.visible = this.scud.shadow.visible = false;
    if (!en.fogLayers) for (let i = 0; i < 3; i++) this.layers.layers[i].visible = false;
    if (!en.fogLayers) this.layers.glory.visible = false;
    if (!en.seaSmoke) this.layers.layers[3].visible = false;
    if (!en.gusts) this.gusts.mesh.visible = false;
    if (!en.gulls) this.gulls.mesh.visible = false;
    if (!en.life) this.dolphins.mesh.visible = this.jellies.mesh.visible = this.whale.mesh.visible = this.whale.shade.visible = false;
    if (!en.lightning) for (const s of this.lightning.slots) s.setVisible(false);
    for (const pool of this._poolList) pool.mesh.visible = en.particles;
  }

  // Light on the gust streaks: sky + a share of the sun.
  _streakLight(st) {
    const p = st.palette || {};
    const L = this._light;
    if (p.ambient && p.ambient.isColor) L.copy(p.ambient).multiplyScalar((p.ambientIntensity ?? 0.6) * 1.1);
    else L.setRGB(0.4, 0.42, 0.44);
    if (p.sun && p.sun.isColor) {
      const k = (p.sunIntensity ?? 1) * 0.35;
      L.r += p.sun.r * k;
      L.g += p.sun.g * k;
      L.b += p.sun.b * k;
    }
    return L;
  }

  // The pooled light that matters most near the view (flare / rocket) — rain sparkles red around it.
  _keyLight() {
    let best = null;
    let bs = 0;
    for (const l of this.lightPool.lights) {
      if (!(l.intensity > 50)) continue;
      const d = Math.hypot(l.position.x - this.focus.x, l.position.z - this.focus.z);
      const sc = l.intensity / (1 + (d / 70) ** 2);
      if (sc > bs) {
        bs = sc;
        best = l.position;
      }
    }
    return best;
  }

  _heliScreen() {
    const cam = this.ctx.camera;
    const v = this._v3.set(this.heli.x, this.heli.y, this.heli.z).project(cam);
    this.heliNdc.x = v.x * (cam.aspect || 1.78);
    this.heliNdc.y = v.y;
  }

  // Downwash spray (DESIGN §2.13 [MUST], signature moment #3). Real rotor wash on water is an irregular,
  // roughened disc with mist blown downwind, its spray flickering with gusts and blade passes — never an
  // evenly spaced crown of petals. Emission angles are rejection-sampled from a downwind bias × slowly
  // wandering lobes; radius ±25 %, sizes 0.5–4 m and lives are random. Most of it is soft round mist
  // (α ≤ .35); a minority are short droplet streaks (≤ 3:1, fading fast); a few large, low haze puffs
  // (α ≤ .25) drift downwind, their spread growing with altitude. Teal sparks in bioluminescent water.
  _downwashSpray(dt, night) {
    const dw = this.dw;
    const acc = this._acc;
    if (dw.strength < 0.02 || !this.heli.alive) {
      acc.dw = 0;
      acc.dwHaze = 0;
      return;
    }
    const s = dw.strength;
    const t = this.t;
    const R = dw.radius;
    // blade passes alias into a ragged 3–5 Hz pulse; gust patches thicken the sheet
    const gust = this.ctx.look?.gustField ? this.ctx.look.gustField(dw.x, dw.z) : 0.5;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 12.7 + Math.sin(t * 3.1))) * (0.7 + 0.3 * Math.sin(t * 2.3));
    acc.dw += (this.cfg.downwash / 1.1) * s * pulse * (0.7 + 0.6 * gust) * dt;
    acc.dwHaze = (acc.dwHaze || 0) + (4 + 0.2 * R) * s * (this.cfg.downwash / 350) * dt;
    const sp = this.pools.spray;
    const bio = night > 0.45 ? clamp01(this.ctx.ocean?.bioluminescence ?? 1) * smooth(0.45, 0.9, night) : 0;
    const wl = Math.hypot(this.wind.x, this.wind.y);
    const wx = wl > 0.1 ? this.wind.x / wl : 0;
    const wz = wl > 0.1 ? this.wind.y / wl : 0;
    const skew = smooth(1.5, 12, wl); // how hard the cloud leans downwind
    const ph1 = t * 0.35 + 2.5 * Math.sin(t * 0.21) + 3 * gust;
    const ph2 = 1.7 - t * 0.5 + Math.sin(t * 0.43);
    let guard = 64;
    // sample the sea on a few ring points once per frame (cheap, wave-accurate enough for spray)
    const ring = this._ringH || (this._ringH = new Float32Array(8));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring[i] = this.seaHeight(dw.x + Math.cos(a) * R, dw.z + Math.sin(a) * R);
    }
    while (acc.dw >= 1 && guard-- > 0) {
      acc.dw -= 1;
      let a = 0;
      let cx = 1;
      let cz = 0;
      for (let k = 0; k < 4; k++) {
        a = Math.random() * Math.PI * 2;
        cx = Math.cos(a);
        cz = Math.sin(a);
        const down = 0.5 + 0.5 * (cx * wx + cz * wz);
        const lobe = 0.5 + 0.25 * Math.sin(3 * a + ph1) + 0.25 * Math.sin(5 * a + ph2);
        if (Math.random() < (1 - 0.65 * skew + 0.65 * skew * down) * (0.12 + 0.88 * lobe * lobe)) break;
      }
      const r = R * (0.75 + 0.5 * Math.random());
      const sea = ring[Math.floor((a / (Math.PI * 2)) * 8 + 0.5) % 8];
      const px = dw.x + cx * r;
      const pz = dw.z + cz * r;
      // upwind spray is beaten back by the wind, downwind spray carried further
      const lean = 1 + 0.35 * skew * (cx * wx + cz * wz);
      if (Math.random() < 0.85) {
        const v = (2 + 6 * Math.random()) * (0.55 + 0.45 * s) * lean;
        const s0 = 0.8 + 1.6 * Math.random() * Math.random();
        sp.emit(t, px, sea + 0.3, pz, cx * v, 0.4 + 2 * Math.random() * s, cz * v,
          0.8 + 1.6 * Math.random(), s0, Math.min(4, s0 * (1.8 + 1.2 * Math.random()) + 0.6), this._sprayCol,
          (0.035 + 0.1 * Math.random()) * (0.45 + 0.55 * s), this._sprayCol, P.dwMist);
      } else {
        const v = (7 + 6 * Math.random()) * (0.55 + 0.45 * s) * lean;
        const s0 = 0.25 + 0.3 * Math.random();
        sp.emit(t, px, sea + 0.25, pz, cx * v, 1.2 + 2.8 * Math.random() * s, cz * v,
          0.35 + 0.4 * Math.random(), s0, s0 * (2 + Math.random()), this._sprayCol,
          (0.1 + 0.12 * Math.random()) * (0.4 + 0.6 * s), this._sprayCol, P.dwSpray);
      }
      if (bio > 0.01) {
        acc.bio += 0.75 * bio;
        if (acc.bio >= 1) {
          acc.bio -= 1;
          const vb = (5 + 5 * Math.random()) * (0.55 + 0.45 * s);
          this.pools.glow.emit(t, px, sea + 0.2, pz, cx * vb, 0.6 + 2 * Math.random(), cz * vb,
            0.5 + 0.6 * Math.random(), 0.42, 0.2, this._bioCol, 0.9, this._bioCol, P.bio);
        }
      }
    }
    if (acc.dw > 8) acc.dw = 8;
    // the misty annulus: big soft puffs low over the water, offset downwind, size ∝ wash radius
    let hg = 4;
    while (acc.dwHaze >= 1 && hg-- > 0) {
      acc.dwHaze -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.55 + 0.85 * Math.random());
      const px = dw.x + Math.cos(a) * r + wx * R * 0.35 * skew;
      const pz = dw.z + Math.sin(a) * r + wz * R * 0.35 * skew;
      const v = 1.5 + 2.5 * Math.random();
      const s0 = R * (0.25 + 0.25 * Math.random());
      this.pools.smoke.emit(t, px, this.seaHeight(px, pz) + 0.8, pz, Math.cos(a) * v, 0.3 + 0.6 * Math.random(), Math.sin(a) * v,
        2.2 + 1.8 * Math.random(), s0, s0 * (1.8 + 0.6 * Math.random()), this._sprayCol,
        (0.07 + 0.1 * Math.random()) * s, this._sprayCol, P.dwHaze);
    }
    if (acc.dwHaze > 3) acc.dwHaze = 3;
  }

  // Bioluminescent sparks for any splash at night.
  _bioBurst(x, y, z, n, v) {
    const night = this.air.uAirNight.value;
    if (night < 0.45) return;
    const bio = clamp01(this.ctx.ocean?.bioluminescence ?? 1) * smooth(0.45, 0.9, night);
    const m = Math.min(24, Math.round(n * bio));
    for (let i = 0; i < m; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = v * (0.3 + 0.7 * Math.random());
      this.pools.glow.emit(this.t, x, y + 0.2, z, Math.cos(a) * s, 0.5 + 2 * Math.random(), Math.sin(a) * s,
        0.5 + 0.7 * Math.random(), 0.42, 0.2, this._bioCol, 0.9, this._bioCol, P.bio);
    }
  }

  // Crest spray (DESIGN §2.13 [SHOULD]): in strong wind, N height probes per frame inside the view;
  // crests higher than 0.7 of the wave amplitude (≈ 0.35·Hs above the mean) tear spray sheets downwind.
  _crestSpray(dt, st) {
    const probes = this.cfg.crestProbes;
    const Hs = st.waveHeight ?? 0;
    const ws = st.windSpeed ?? 0;
    if (!probes || Hs < 2.2 || ws < 12 || !this.ctx.ocean?.heightAt) return;
    const strength = smooth(12, 22, ws) * smooth(2.2, 5, Hs);
    this._acc.crest = Math.min(40, this._acc.crest + (this.cfg.crest / 1.6) * strength * dt);
    if (this._acc.crest < 4) return;
    const camY = Math.max(40, this._camPos.y);
    const halfH = camY * Math.tan(20 * DEG) * 1.05;
    const halfW = halfH * (this.ctx.camera.aspect || 1.78);
    const thr = 0.35 * Hs;
    const wl = Math.hypot(this.wind.x, this.wind.y) || 1;
    const wx = this.wind.x / wl;
    const wz = this.wind.y / wl;
    const sp = this.pools.spray;
    const t = this.t;
    for (let i = 0; i < probes && this._acc.crest >= 4; i++) {
      const x = this.focus.x + (Math.random() * 2 - 1) * halfW;
      const z = this.focus.z + (Math.random() * 2 - 1) * halfH;
      const h = this.ctx.ocean.heightAt(x, z);
      if (!(h > thr)) continue;
      const n = 5 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) {
        const lat = (Math.random() - 0.5) * 9;
        const v = ws * (0.45 + 0.4 * Math.random());
        const sz = 0.8 + 0.6 * Math.random();
        sp.emit(t, x - wz * lat, h + 0.2, z + wx * lat, wx * v, 1.5 + 2.5 * Math.random(), wz * v,
          1.1 + 0.9 * Math.random(), sz, 3.5 + 2 * Math.random(), this._sprayCol, 0.28 + 0.15 * Math.random(), this._sprayCol, P.crest);
      }
      this._acc.crest -= n;
    }
  }

  // Hail [NICE]: pellets in the rain shader (weather.state.hail); here bounces off the water around the
  // focus and a light ticking micro-shake.
  _hail(dt, st) {
    const hail = clamp01(st.hail ?? 0);
    if (hail < 0.02) return;
    this._acc.hail += 70 * hail * dt;
    const sp = this.pools.spray;
    const c = this._c.setRGB(1.6, 1.65, 1.7);
    const camY = Math.max(40, this._camPos.y);
    const half = camY * 0.45;
    while (this._acc.hail >= 1) {
      this._acc.hail -= 1;
      const x = this.focus.x + (Math.random() * 2 - 1) * half;
      const z = this.focus.z + (Math.random() * 2 - 1) * half;
      const sea = this.seaHeight(x, z);
      const a = Math.random() * Math.PI * 2;
      sp.emit(this.t, x, sea + 0.15, z, Math.cos(a) * 1.5, 2.5 + 2 * Math.random(), Math.sin(a) * 1.5, 0.45, 0.14, 0.12, c, 0.9, c, P.hail);
    }
    this._acc.hailShake -= dt;
    if (this._acc.hailShake <= 0 && hail > 0.25) {
      this._acc.hailShake = 0.22 + Math.random() * 0.2;
      this.ctx.cameraRig?.shake?.(0.05 * hail, 0.12);
    }
  }

  // Lightning impact stars + short ground glows.
  _impacts(dt) {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t += dt;
      if (s.t >= s.life) {
        this.stars.splice(i, 1);
        continue;
      }
      const e = s.reduced ? softEnvelope(s.t) : strokeEnvelope(s.t);
      // a small, very hot core (no orb, no star rays): bloom does the glow
      this.glows.add(s.x, s.y, s.z, 1.0, this._starCol, 3.5 * e * s.I, 2.4, this._haloCol, 0.08 * e * s.I, 0, 0);
    }
    for (let i = this.timedLights.length - 1; i >= 0; i--) {
      const l = this.timedLights[i];
      l.t += dt;
      if (l.t >= l.life) {
        l.handle.release();
        this.timedLights.splice(i, 1);
        continue;
      }
      const e = l.reduced ? softEnvelope(l.t) : strokeEnvelope(l.t) * (1 - smooth(l.life * 0.6, l.life, l.t));
      l.handle.set(l.peak * e);
    }
  }
}
