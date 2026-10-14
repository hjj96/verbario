// Weather — the mood engine's state machine (DESIGN §2.3, §2.5, §2.7, §3.13; CONTRACT «weather»).
//
// Owns: the blended palette (+ palettePrev / paletteNext for the spatial front), staged transitions,
// wind field (mean + wander + cat's-paw gust field + gust fronts), lightning scheduling and the flash
// envelope, the barometer, time of day, the two scene lights (sun/moon with shadows, hemisphere),
// the PMREM environment for props, scene.fog / scene.background, the shared look uniforms
// (uRain/uWet/uFlash/uNight, wind, gust fronts) and the «Смена» escalation.
//
// Helpers: weather/presets.js (numbers), weather/palette.js (packing + channel blending),
// weather/gusts.js, weather/lightning.js, weather/lights.js, weather/env.js, weather/endless.js.
//
// Beyond the contract:
//   state.paletteNext        target preset palette; with state.front.active blend per pixel as
//                            mix(paletteNext, palettePrev, f) — `palette` itself switches as the front
//                            passes over the heli (global light / grading)
//   state.sunDirShadow       cheated preset sun (state.sunDir = light actually used, incl. strike swing)
//   state.flashColor, wet, severity, presetLabel, windFrom (deg «from»), gustMax, pressureTrend,
//   state.rates {lightning, spouts, rogues} per minute, transition {active, from, to, t, over, progress},
//   state.lastStrike {x, z, distance, cloudOnly, t}
//   palette extras: shadowRadius, fog, cloudShadow (−1 = clearing's running sun patches), glitter,
//   glitterExp, sss, scud, beam, detect {base, altBonus}, wind/gust/turbulence/rate keys,
//   sea.roughnessRain (already folded into sea.roughness), sea.clearing, sea.cloudReflect
//   setPreset(name, over, { windFrom })   wind «from» bearing rotates with the wind channel
//   strikeLightning(x, z, { cloudOnly, strength, charge, eta }); setHail(v) (hazards' hail cells)
//   cloudShadowAt(x, z) → sun multiplier on props; attract (title cycle flag); labels; presets
//   events: weather:preset also carries {worse, label, windFrom, gust}; weather:charge {target, heli}
import * as THREE from 'three';
import { clamp, damp, createRng } from '../core/math.js';
import { PRESETS, PRESET_NAMES, SEVERITY, LABELS, BEAUFORT, DOUGLAS } from './weather/presets.js';
import {
  COMPILED, SLOTS, OFF, CHANNELS, CH_COLOR, CH_WIND, CH_RAIN, CH_WAVE,
  blendPacked, applyGreen, createPalette, unpack,
} from './weather/palette.js';
import { Gusts } from './weather/gusts.js';
import { Lightning } from './weather/lightning.js';
import { WeatherLights } from './weather/lights.js';
import { WeatherEnv } from './weather/env.js';
import { Endless, CLOCK_RATE } from './weather/endless.js';

const DEG = Math.PI / 180;
const ATTRACT_CYCLE = ['nightStorm', 'fog', 'calm', 'clearing']; // title screen, every 45 s (DESIGN §7.2)
const FRONT_SPEED = 20;
const FRONT_WIDTH = 120;
const FRONT_MIN_OVER = 12; // shorter transitions are plain time blends

const smootherstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

export class Weather {
  constructor(ctx) {
    this.ctx = ctx;
    // Own deterministic RNG (reseeded from the mission seed); sub-modules hold this wrapper.
    this._rngImpl = createRng(4242);
    this.rng = { next: () => this._rngImpl.next() };

    // Packed palettes: _from (transition start snapshot), _to (target preset), _cur (blended),
    // _out (blended + greenTint), _tmp (scratch for prev/next).
    this._from = new Float64Array(SLOTS);
    this._to = COMPILED.calm;
    this._cur = new Float64Array(SLOTS);
    this._out = new Float64Array(SLOTS);
    this._tmp = new Float64Array(SLOTS);
    this._from.set(this._to);
    this._cur.set(this._to);
    this._tCh = new Float64Array(CHANNELS).fill(1);

    this.gusts = new Gusts(ctx, this.rng);
    this.lightning = new Lightning(ctx, this.rng);
    this.endless = new Endless(this.rng);

    const palette = createPalette();
    unpack(palette, this._cur);
    this.state = {
      preset: 'calm',
      presetLabel: LABELS.calm.label,
      intensity: 0,
      windDir: new THREE.Vector2(0, 1),
      windSpeed: 3,
      windFrom: 0, // meteorological «from» bearing, degrees (HUD «ВЕТЕР 250°»)
      gust: 0,
      gustMax: 3,
      rain: 0,
      fog: 0,
      hail: 0,
      lightning: 0,
      waveHeight: 0.4,
      waveChoppiness: 0.25,
      night: 0,
      timeOfDay: 0.4,
      flash: 0,
      flashColor: new THREE.Color('#DCE6FF'),
      visibility: 20000,
      palette,
      palettePrev: createPalette(),
      paletteNext: createPalette(),
      sunDir: new THREE.Vector3(0, 1, 0), // light direction actually used (cheated sun, or the strike during a swing)
      sunDirShadow: new THREE.Vector3(0, 1, 0), // cheated sun of the preset (clamped elevation)
      sunDirVisual: new THREE.Vector3(0, 1, 0), // true sun (glitter, sky warmth)
      front: { origin: new THREE.Vector2(), dir: new THREE.Vector2(1, 0), speed: FRONT_SPEED, width: FRONT_WIDTH, active: false, t: 0 },
      greenTint: 0,
      stElmo: 0,
      pressure: 1016,
      pressureTrend: 0, // −1 falling, 0 steady, +1 rising
      gustFronts: this.gusts.active,
      turbulence: 0.3,
      beaufort: 2,
      seaState: 2,
      wet: 0,
      rates: { lightning: 0, spouts: 0, rogues: 0 }, // per minute (hazards' random spawns)
      transition: { active: false, from: 'calm', to: 'calm', t: 0, over: 0, progress: 1 },
      lastStrike: { x: 0, z: 0, distance: Infinity, cloudOnly: true, t: -99 },
      severity: 0,
    };
    unpack(this.state.palettePrev, this._cur);
    unpack(this.state.paletteNext, this._cur);

    this.tr = { active: false, t: 0, over: 0, wavesDown: false, rainUp: false, rainStart: -1, frontEnd: 0 };

    // Wind direction: base bearing (towards, radians, compass) rotating with the wind channel.
    this._windTo = 120 * DEG;
    this._windA0 = this._windTo;
    this._windA1 = this._windTo;
    this._windAngle = this._windTo;
    this._meanWind = new THREE.Vector2();

    this.greenTarget = 0;
    this.clock = 0; // weather time (s, game time)
    this.script = [];
    this.scriptIdx = 0;
    this.scriptT = 0;
    this.attract = false;
    this.attractT = 0;
    this.attractIdx = 0;
    this._eye = false;
    this._pTrendRate = 0;
    this._pEmitted = 1016;
    this._pEmittedTrend = 0;
    this._greenApplied = -1;
    this._upcoming = { in: 0, preset: 'calm' };
    this._detect = { base: 260, altBonus: 1 };
    this._forecast = [];
    this._fcPool = [];
    this._fcPushBound = (inS, preset) => this._fcPush(inS, preset);

    // URL overrides (DESIGN §8.4): ?weather=<preset> forces the preset and disables scripts; ?tod=
    const wp = ctx.params?.get('weather');
    this.forced = wp && PRESETS[wp] ? wp : null;
    const tod = parseFloat(ctx.params?.get('tod'));
    this.forcedTod = Number.isFinite(tod) ? ((tod % 1) + 1) % 1 : null;

    // Scene: lights (created once — never added/removed later), fog, background.
    this.lights = new WeatherLights(ctx);
    this.env = new WeatherEnv(ctx);
    ctx.scene.fog = new THREE.Fog(palette.fogColor.getHex(), palette.fogNear, palette.fogFar);
    ctx.scene.background = new THREE.Color().copy(palette.fogColor);
    this.lightning.onStrike = (x, z) => {
      const hp = this.heliPos;
      this.lights.swing(x, z, hp.x, hp.z, this.rng);
    };

    // scratch
    this.heliPos = new THREE.Vector3();
    this.heliAlt = 40;
    this._camFocus = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._v2 = new THREE.Vector2();

    ctx.events.on('mission:setup', ({ def } = {}) => this._onSetup(def || {}));
    ctx.events.on('mission:start', () => {
      this.scriptT = 0;
    });
    ctx.events.on('game:mode', ({ to } = {}) => {
      if (to === 'title') this._startAttract(3);
    });
    ctx.settings.onChange?.((k) => {
      if (k === 'quality') this.lights.applyQuality(ctx.settings.get('quality'));
    });
  }

  async init() {
    this.env.init();
    if (!this.def) this._setWindFrom(300, true);
    if (this.ctx.mode === 'title' && !this.def) this._startAttract(0);
    else this.setPreset(this.forced || this.state.preset, 0);
    if (this.forcedTod !== null) this.state.timeOfDay = this.forcedTod;
    this.update(0);
  }

  // --------------------------------------------------------------------------------------------
  // Public API (CONTRACT)

  // Staged transition to a preset (DESIGN §2.5). opts.windFrom (deg, «from» bearing) rotates the
  // wind with the wind channel (mission 8's 180° reversal).
  setPreset(name, over = 30, opts = {}) {
    if (!PRESETS[name]) return false;
    const st = this.state;
    const from = st.preset;
    over = Math.max(0, Number(over) || 0);
    this._eye = false;

    this._from.set(this._cur);
    this._to = COMPILED[name];
    this._windA0 = this._windAngle;
    this._windA1 = opts.windFrom !== undefined ? (opts.windFrom + 180) * DEG : this._windAngle;
    if (opts.windFrom !== undefined) this._windTo = this._windA1;

    const tr = this.tr;
    tr.t = 0;
    tr.over = over;
    tr.wavesDown = this._to[OFF['sea.Hs']] < this._cur[OFF['sea.Hs']];
    tr.rainUp = this._to[OFF.rain] > this._cur[OFF.rain] + 1e-3;
    tr.rainStart = -1;
    tr.active = over > 0;

    const front = st.front;
    front.active = false;
    if (tr.active && over >= FRONT_MIN_OVER) {
      // The front comes from upwind along the NEW wind and passes over the heli mid-transition.
      const a = this._windA1;
      front.dir.set(Math.sin(a), -Math.cos(a));
      const d = FRONT_SPEED * over * 0.5;
      front.origin.set(this.heliPos.x - front.dir.x * d, this.heliPos.z - front.dir.y * d);
      front.t = 0;
      front.active = true;
      tr.frontEnd = over * 0.5 + 30; // front ≈ 600 m past the heli
    } else tr.frontEnd = 0;

    if (!tr.active) {
      this._cur.set(this._to);
      this._windAngle = this._windA1;
      this._tCh.fill(1);
    }
    st.preset = name;
    st.presetLabel = LABELS[name].label;
    st.severity = SEVERITY[name];
    st.transition.active = tr.active;
    st.transition.from = from;
    st.transition.to = name;
    st.transition.t = 0;
    st.transition.over = over;
    st.transition.progress = tr.active ? 0 : 1;
    this._refreshPrevNext(true);
    this.env.markDirty();

    const P = PRESETS[name];
    this.ctx.events.emit('weather:preset', {
      from, to: name, over,
      worse: SEVERITY[name] > SEVERITY[from],
      label: LABELS[name].label,
      windFrom: Math.round(((this._windA1 / DEG + 180) % 360 + 360) % 360),
      gust: Math.round(P.wind + P.gustStrength),
    });
    return true;
  }

  // Wind at a point (m/s, Vector2 x = world X, y = world Z): mean · (0.85 + 0.3·gustField) + gust fronts.
  windAt(x, z, out = new THREE.Vector2()) {
    const st = this.state;
    const g = this.ctx.look ? this.ctx.look.gustField(x, z) : 0.5;
    const s = st.windSpeed * (0.85 + 0.3 * g);
    out.set(st.windDir.x * s, st.windDir.y * s);
    this.gusts.addWindAt(x, z, out);
    return out;
  }

  // Upcoming changes: [{in, preset, label, short, severity, worse, windFrom}] (reused array/objects —
  // read them right away). Campaign scripts are exact; «Смена» forecasts are 80 % accurate.
  forecast() {
    const out = this._forecast;
    out.length = 0;
    if (this.forced) return out;
    for (let i = this.scriptIdx; i < this.script.length; i++) {
      const s = this.script[i];
      const e = this._fcPush(Math.max(0, s.at - this.scriptT), s.to);
      if (s.windFrom !== undefined) e.windFrom = s.windFrom;
      else if (s.windShift) e.windFrom = (((e.windFrom + s.windShift) % 360) + 360) % 360;
    }
    if (this.endless.active) this.endless.forEachUpcoming(this, this._fcPushBound);
    return out;
  }

  _fcPush(inS, preset) {
    const out = this._forecast;
    const st = this.state;
    const e = this._fcPool[out.length] || (this._fcPool[out.length] = {});
    e.in = inS;
    e.preset = preset;
    e.label = LABELS[preset].label;
    e.short = LABELS[preset].short;
    e.severity = SEVERITY[preset];
    e.worse = SEVERITY[preset] > SEVERITY[st.preset];
    e.windFrom = st.windFrom;
    out.push(e);
    return e;
  }

  // Forced lightning (hazards: tornado internal lightning, scripted strikes).
  // opts: { cloudOnly, strength, charge: true → telegraphed sea strike, eta }
  strikeLightning(x, z, opts = {}) {
    if (opts.charge && !opts.cloudOnly) return this.lightning.charge(this, x, z, opts);
    this.lightning.strike(this, x, z, opts);
    return null;
  }

  setGreenTint(v) {
    this.greenTarget = clamp(Number(v) || 0, 0, 1);
  }

  // Hail level 0..1 at the heli (hazards' hail cells drive it; fx rain pellets / bounces read state.hail).
  setHail(v) {
    this.state.hail = clamp(Number(v) || 0, 0, 1);
  }

  // Scripted gust front (onboarding: harmless, labelled «ПОРЫВ»). Reaches the heli in `eta` s.
  spawnGust({ strength = 8, dir, eta = 6, harmless = false } = {}) {
    const st = this.state;
    const f = this.gusts.spawn(this.heliPos.x, this.heliPos.z, st.windDir, st.windSpeed, { strength, dir, eta, harmless });
    this._emitGust(f);
    return f;
  }

  // «Смена» escalation (mission calls this in endless mode; also started by def.endless).
  runEndless() {
    if (!this.def || !(this.def.timeOfDay > 0)) {
      if (this.forcedTod === null) this.state.timeOfDay = 9 / 24;
    }
    this.script = [];
    this.scriptIdx = 0;
    this.endless.start(this.state.timeOfDay);
  }

  // DESIGN §3.10 detection table for the current blend.
  detectBase() {
    const d = this.state.palette.detect;
    this._detect.base = d.base;
    this._detect.altBonus = d.altBonus;
    return this._detect;
  }

  // Run a mission weather definition {start, script: [{at, to, over, windFrom?, windShift?}], windFrom?}.
  runScript(w = {}) {
    this.endless.stop();
    this.attract = false;
    const start = this.forced || (PRESETS[w.start] ? w.start : 'calm');
    this.script = this.forced ? [] : (w.script || []).filter((s) => s && PRESETS[s.to]).slice().sort((a, b) => a.at - b.at);
    this.scriptIdx = 0;
    this.scriptT = 0;
    this._eye = false;
    const from = w.windFrom ?? 220 + this.rng.next() * 110;
    this._setWindFrom(from, true);
    this.setPreset(start, 0);
    this.state.pressure = 1016 - 38 * PRESETS[start].intensity;
    this._pEmitted = this.state.pressure;
  }

  // Sun multiplier from cloud shadows at a point (same field as the ocean's layer 6): ~0.72..1.2.
  cloudShadowAt(x, z) {
    const p = this.state.palette;
    const k = p.cloudShadow * (1 - p.night);
    if (Math.abs(k) < 1e-3 || !this.ctx.look) return 1;
    const c = this.ctx.look.cloudAt(x, z);
    return k > 0 ? 1 - 0.28 * c * k : 1 + 0.2 * c * -k;
  }

  get labels() {
    return LABELS;
  }

  get presets() {
    return PRESET_NAMES;
  }

  // --------------------------------------------------------------------------------------------
  // Mission integration

  _onSetup(def) {
    this.def = def;
    this._rngImpl = createRng(((def.seed ?? 1) * 7919 + 13) >>> 0);
    this.gusts.reset();
    this.lightning.reset();
    this.greenTarget = 0;
    this.state.greenTint = 0;
    this.state.hail = 0;
    this.state.wet = 0;
    this.runScript(def.weather || {});
    this.state.timeOfDay = this.forcedTod ?? (Number.isFinite(def.timeOfDay) ? def.timeOfDay : 0.4);
    if (def.endless) this.runEndless();
    // Title scene: weather runs the 45 s showcase cycle itself (mission checks weather.attract).
    if (def.attract && !this.forced) {
      this.attract = true;
      this.attractT = 0;
      this.attractIdx = Math.max(0, ATTRACT_CYCLE.indexOf(this.state.preset));
    }
  }

  _startAttract(over) {
    if (this.forced || this.attract) return;
    this.attract = true;
    this.attractT = 0;
    this.attractIdx = 0;
    this.setPreset(ATTRACT_CYCLE[0], over);
  }

  _setWindFrom(deg, instant) {
    const a = (deg + 180) * DEG;
    this._windTo = a;
    if (instant) {
      this._windA0 = this._windA1 = this._windAngle = a;
    }
  }

  _emitGust(f) {
    if (!f) return;
    this.ctx.events.emit('weather:gust', {
      dir: new THREE.Vector2(f.dirX, f.dirZ), strength: f.baseStrength, eta: f.eta, x: f.x, z: f.z, harmless: f.harmless,
    });
  }

  // --------------------------------------------------------------------------------------------
  // Frame update

  update(dt) {
    const ctx = this.ctx;
    const st = this.state;
    const mode = ctx.mode;
    const playing = mode === 'play';
    this.clock += dt;

    // Heli / camera focus (read from last frame; weather updates first).
    const heli = ctx.heli;
    if (heli && heli.position) {
      this.heliPos.copy(heli.position);
      this.heliAlt = Number.isFinite(heli.altitude) ? heli.altitude : heli.position.y;
    }
    this._updateCamFocus();

    // Clocks & schedulers.
    if (playing) {
      this.scriptT += dt;
      st.timeOfDay = (st.timeOfDay + (dt * (this.endless.active ? CLOCK_RATE : 1)) / 86400) % 1;
    }
    this._runSchedulers(dt, playing);

    // Transition progress → blended palette.
    this._progress(dt);
    blendPacked(this._cur, this._from, this._to, this._tCh);
    st.greenTint = damp(st.greenTint, this.greenTarget, 0.5, dt);
    this._out.set(this._cur);
    applyGreen(this._out, st.greenTint);
    unpack(st.palette, this._out);
    this._refreshPrevNext(false);

    const p = st.palette;
    // Scalars for everyone else.
    st.intensity = p.intensity;
    st.rain = p.rain;
    st.lightning = p.lightning;
    st.night = p.night;
    st.fog = p.fog;
    st.visibility = p.visibility;
    st.waveHeight = p.sea.Hs;
    st.waveChoppiness = p.sea.Q;
    st.turbulence = p.turbulence;
    st.rates.lightning = p.lightningPerMin * (st.intensity >= 0.6 - 1e-3 ? 1 : 0);
    st.rates.spouts = p.spoutsPerMin;
    st.rates.rogues = p.roguesPerMin;
    this._updateSun(p);

    // Wind: base bearing (rotating with the wind channel) + ±15°/min wander.
    const tw = this._tCh[CH_WIND];
    this._windAngle = this._windA0 + wrapPi(this._windA1 - this._windA0) * tw;
    const wander = (ctx.noise ? ctx.noise(this.clock / 55, 7.31) : 0) * 15 * DEG;
    const a = this._windAngle + wander;
    st.windDir.set(Math.sin(a), -Math.cos(a));
    st.windSpeed = p.wind;
    st.windFrom = Math.round((((a / DEG + 180) % 360) + 360) % 360);
    st.gustMax = p.wind + p.gustStrength;
    this._meanWind.copy(st.windDir).multiplyScalar(st.windSpeed);

    // Gust fronts (random per preset; scripted via spawnGust).
    const spawned = this.gusts.update(
      dt, this.heliPos.x, this.heliPos.z, st.windDir, st.windSpeed, p.gustStrength, p.gustRate, dt > 0 && mode !== 'briefing',
    );
    if (spawned) this._emitGust(spawned);

    // Shared look layer.
    const look = ctx.look;
    if (look) {
      look.setWind(this._meanWind, dt);
      look.setFronts(this.gusts.active);
    }

    // Lightning, flash, St. Elmo.
    this.lightning.update(dt, this, dt > 0 && mode !== 'briefing' && mode !== 'debrief', playing);

    // Wetness: follows rain up quickly, dries over 30 s.
    st.wet = st.rain > st.wet ? damp(st.wet, st.rain, 0.8, dt) : Math.max(st.rain, st.wet - dt / 30);

    if (look) {
      const u = look.uniforms;
      u.uRain.value = st.rain;
      u.uWet.value = st.wet;
      u.uFlash.value = st.flash;
      u.uNight.value = st.night;
    }

    this._updatePressure(dt);

    // At the heli: gust magnitude, HUD numbers.
    this.windAt(this.heliPos.x, this.heliPos.z, this._v2);
    st.gust = Math.max(0, this._v2.length() - st.windSpeed);
    st.beaufort = countBelow(BEAUFORT, st.windSpeed);
    st.seaState = st.waveHeight <= 0.02 ? 0 : 1 + countBelow(DOUGLAS, st.waveHeight);

    // Scene: lights, fog, background, environment.
    this.lights.update(dt, st, this.heliPos, Math.max(0, this.heliAlt), this._camFocus);
    const scene = ctx.scene;
    const fog = scene.fog;
    if (fog && fog.isFog) {
      // The fog bubble is lit by lightning too (silver-blue scatter).
      const k = st.flash * 0.025;
      fog.color.setRGB(p.fogColor.r + st.flashColor.r * k, p.fogColor.g + st.flashColor.g * k, p.fogColor.b + st.flashColor.b * k);
      fog.near = p.fogNear;
      fog.far = Math.max(p.fogNear + 1, p.fogFar);
    }
    if (scene.background && scene.background.isColor) scene.background.copy(fog ? fog.color : p.fogColor);
    this.env.update(this.clock, st, this.tr.active);
    // Exposure baseline (post refines it every frame with the flash / afterimage; this keeps the
    // palette exposure when post is a stub and the renderer tone-maps to screen directly).
    ctx.renderer.toneMappingExposure = p.exposure * (1 + 2.4 * st.flash);
  }

  _runSchedulers(dt, playing) {
    // Title screen: cycle the showcase presets.
    if (this.attract) {
      if (this.ctx.mode !== 'title') this.attract = false;
      else {
        this.attractT += dt;
        if (this.attractT >= 45) {
          this.attractT = 0;
          this.attractIdx = (this.attractIdx + 1) % ATTRACT_CYCLE.length;
          this.setPreset(ATTRACT_CYCLE[this.attractIdx], 8);
        }
        // night storm on the title: a sea strike or an in-cloud flash every 8–12 s lights the scene
        // (the lightning module still applies reduceFlashes)
        const pal = this.state.palette;
        if ((pal?.night ?? 0) > 0.6 && (pal?.lightning ?? 0) > 0.5) {
          this._attractBolt = (this._attractBolt ?? 2) - dt;
          if (this._attractBolt <= 0) {
            const r = this.rng;
            this._attractBolt = 8 + 4 * r.next();
            const a = r.next() * Math.PI * 2;
            const d = 120 + 180 * r.next();
            this.strikeLightning(this.heliPos.x + Math.cos(a) * d, this.heliPos.z + Math.sin(a) * d, { cloudOnly: r.next() < 0.45, strength: 0.85 });
          }
        }
      }
    }
    if (this.forced) return;
    // Mission script.
    while (this.scriptIdx < this.script.length && this.script[this.scriptIdx].at <= this.scriptT) {
      const s = this.script[this.scriptIdx++];
      const opts = {};
      if (s.windFrom !== undefined) opts.windFrom = s.windFrom;
      else if (s.windShift) opts.windFrom = this._windTo / DEG - 180 + s.windShift;
      this.setPreset(s.to, s.over ?? 30, opts);
      this._eye = !!s.eye; // eye of the storm: calm air, but the barometer stays at its lowest
    }
    // Endless escalation.
    if (playing && this.endless.active) {
      const go = this.endless.update(dt, this);
      if (go) this.setPreset(go.to, go.over);
    }
  }

  // Channel progress for the current transition (DESIGN §2.5).
  _progress(dt) {
    const tr = this.tr;
    const t = this._tCh;
    const st = this.state;
    const front = st.front;
    if (!tr.active) {
      t.fill(1);
      if (front.active) {
        front.t += dt;
        if (front.t > tr.frontEnd) front.active = false;
      }
      return;
    }
    tr.t += dt;
    const o = tr.over;
    const tt = tr.t;

    // Colours & light: smootherstep in time, or — with a spatial front — switch as the front passes
    // over the heli (time fallback completes by 1.3·over if the heli outruns it).
    let col = smootherstep(tt / o);
    let lead = 0;
    if (front.active) {
      front.t += dt;
      const along = (this.heliPos.x - front.origin.x) * front.dir.x + (this.heliPos.z - front.origin.y) * front.dir.y - front.speed * front.t;
      const f = smooth01((along + front.width) / (2 * front.width)); // 1 = old weather still at the heli
      lead = 1 - smooth01((along - front.width) / front.width); // leading edge (W ahead) reached
      col = Math.max(1 - f, smootherstep((tt - o) / (0.3 * o)));
    }
    // Wind, gusts, cat's paws: lead by 15 %.
    const wind = Math.max(smootherstep(tt / (0.85 * o)), col);
    // Rain: from +10 % (or the front's leading edge), sparse → pow(t, 2.5) over 8 s.
    let rain;
    if (tr.rainUp) {
      if (tr.rainStart < 0 && (front.active ? lead > 0.02 || tt >= o : tt >= 0.1 * o)) tr.rainStart = tt;
      const ramp = Math.min(8, Math.max(0.5, 0.9 * o));
      rain = tr.rainStart < 0 ? 0 : Math.pow(clamp((tt - tr.rainStart) / ramp, 0, 1), 2.5);
    } else rain = col;
    // Waves lag: from +25 % to 140 %; calming takes twice as long (swell outlives the wind).
    const span = 1.15 * o * (tr.wavesDown ? 2 : 1);
    const wave = smooth01((tt - 0.25 * o) / span);

    t[CH_COLOR] = col;
    t[CH_WIND] = wind;
    t[CH_RAIN] = rain;
    t[CH_WAVE] = wave;
    st.transition.t = tt;
    st.transition.progress = col;

    if (col >= 1 && wind >= 1 && rain >= 1 && wave >= 1) {
      tr.active = false;
      st.transition.active = false;
      st.transition.progress = 1;
      this._windAngle = this._windA1;
      this._windA0 = this._windA1;
      this.env.markDirty();
      if (front.active && front.t > tr.frontEnd) front.active = false;
    }
  }

  _refreshPrevNext(force) {
    const st = this.state;
    if (!force && !this.tr.active && !st.front.active && Math.abs(st.greenTint - this._greenApplied) < 1e-3) return;
    this._greenApplied = st.greenTint;
    this._tmp.set(this._from);
    unpack(st.palettePrev, applyGreen(this._tmp, st.greenTint));
    this._tmp.set(this._to);
    unpack(st.paletteNext, applyGreen(this._tmp, st.greenTint));
  }

  _updateSun(p) {
    const st = this.state;
    const az = p.sunAz * DEG;
    const ev = p.sunElev * DEG;
    const es = p.shadowElev * DEG;
    // north = −Z, east = +X; azimuth clockwise from north
    st.sunDirVisual.set(Math.sin(az) * Math.cos(ev), Math.sin(ev), -Math.cos(az) * Math.cos(ev));
    st.sunDirShadow.set(Math.sin(az) * Math.cos(es), Math.sin(es), -Math.cos(az) * Math.cos(es));
  }

  _updatePressure(dt) {
    const st = this.state;
    // Target: current preset's storminess, or the upcoming one if it is worse and ≤ 15 s away.
    let I = PRESETS[st.preset].intensity;
    if (!this.forced) {
      if (this.scriptIdx < this.script.length) {
        const s = this.script[this.scriptIdx];
        if (s.at - this.scriptT <= 15) I = Math.max(I, PRESETS[s.to].intensity);
      }
      if (this.endless.active && this.endless.upcoming(this, this._upcoming) && this._upcoming.in <= 15) {
        I = Math.max(I, PRESETS[this._upcoming.preset].intensity);
      }
    }
    const target = this._eye ? 1016 - 38 - 6 : 1016 - 38 * I;
    const prev = st.pressure;
    st.pressure = damp(st.pressure, target, 1 / 7, dt);
    if (dt > 0) this._pTrendRate = damp(this._pTrendRate, (st.pressure - prev) / dt, 0.6, dt);
    const trend = this._pTrendRate < -0.03 ? -1 : this._pTrendRate > 0.03 ? 1 : 0;
    st.pressureTrend = trend;
    if (trend !== this._pEmittedTrend || Math.abs(st.pressure - this._pEmitted) >= 1) {
      this._pEmittedTrend = trend;
      this._pEmitted = st.pressure;
      this.ctx.events.emit('weather:pressure', { pressure: st.pressure, trend });
    }
  }

  _updateCamFocus() {
    const cam = this.ctx.camera;
    if (!cam) return;
    const f = this._fwd;
    cam.getWorldDirection(f);
    if (f.y < -0.05) {
      const k = cam.position.y / -f.y;
      this._camFocus.set(cam.position.x + f.x * k, 0, cam.position.z + f.z * k);
    } else this._camFocus.copy(this.heliPos).setY(0);
  }
}

function countBelow(arr, v) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (v >= arr[i]) n++;
  return n;
}
