// export-sim: time-stepped traces of the web's weather and ocean systems (Node 22 = reference engine)
// -> rescue-apple/Tests/Vectors/{weather,ocean}/*.json (+ little-endian .f64 / .u32 sidecars).
//
// The REAL systems (systems/weather.js with gusts/lightning/lights/env/endless, systems/ocean.js with
// waves/features/memory) run on a stub ctx — EventBus, a settings stub, the real Look(7) and
// createNoise2D(1337), a scripted heli trajectory and camera — at a fixed dt of 1/60 s. Every scenario
// lists its per-frame actions (mode changes, mission:setup, scripted gusts and strikes, tints,
// checkpoints, queries); the Swift test (MaydayCoreTests/Weather, /Ocean) replays them and compares:
//   * rows   — every `every` frames, the full numeric probe (fields listed in data.fields) as f64;
//   * hashes — FNV-1a 32 over the probe row (+ the packed palettes / uniform arrays) of EVERY frame,
//              chained frame to frame, so the first divergent frame is found even between rows;
//   * events — every weather:* (and ocean-relevant) event with its frame and payload;
//   * queries— return values of the API calls the actions make (forecast, checkpointState, windAt …).
// NaN is canonicalised (0x7ff8000000000000) in rows and hashes; -0 is kept (bitwise class).
//
// Usage: node rescue-apple/tools/export/export-sim.mjs [--only weather,ocean] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, serialize, writeWrapped, writeSidecar, relSrc } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/export-sim.mjs';
const results = [];
const BUDGET = 1024 * 1024; // per JSON file

console.warn = () => {};

const THREE = await import('three');
const { EventBus } = await gameImport('core/events.js');
const { createNoise2D } = await gameImport('core/math.js');
const { Look } = await gameImport('core/look.js');
const { PRESET_NAMES } = await gameImport('systems/weather/presets.js');

const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern; report index, both values and ulp distance on mismatch' };
const DT = 1 / 60;

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > BUDGET) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}
function sidecar(domain, file, typed, shape) {
  const r = writeSidecar(path.join(OUT, domain, file), typed, shape);
  results.push({ path: `Tests/Vectors/${domain}/${file}`, bytes: typed.byteLength });
  return r;
}

// ------------------------------------------------------------------------------------- hashing
// FNV-1a 32 over the little-endian bytes of doubles (NaN canonical). Same in the Swift test.
const _hb = new DataView(new ArrayBuffer(8));
function canon(x) {
  return Number.isNaN(x) ? NaN : x; // Float64Array/DataView write V8's canonical quiet NaN
}
function fnv(h, values) {
  for (let i = 0; i < values.length; i++) {
    _hb.setFloat64(0, canon(values[i]), true);
    for (let k = 0; k < 8; k++) {
      h ^= _hb.getUint8(k);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}
const FNV0 = 2166136261;

// ------------------------------------------------------------------------------------- stub ctx parts
function makeSettings(values) {
  const listeners = [];
  return {
    values,
    get: (k) => values[k],
    set(k, v) {
      if (values[k] === v) return;
      values[k] = v;
      for (const fn of [...listeners]) fn(k, v);
    },
    onChange: (fn) => listeners.push(fn),
  };
}

// Scripted heli: a slow figure through 20…100 m altitude (crosses the 70 m heli-strike threshold).
// Only + − × ÷ and Math.sin, all bit-exact in the Swift port (JS.sin = fdlibm).
function heliAt(frame, k) {
  const t = frame / 60;
  return {
    x: k.x0 + k.ax * Math.sin(t * k.wx),
    y: k.y0 + k.ay * Math.sin(t * k.wy),
    z: k.z0 + k.az * Math.sin(t * k.wz),
  };
}
// Camera: fixed offset above/behind the heli, constant unit look direction (0, -0.8, -0.6).
const CAM_OFF = [0, 55, 35];
const CAM_DIR = [0, -0.8, -0.6];

// ===================================================================================================
// weather
// ===================================================================================================
async function weather() {
  const { Weather } = await gameImport('systems/weather.js');
  const Wsc = (await gameImport('systems/weather.js')).__scope();
  const G = (await gameImport('systems/weather/gusts.js'));
  const L = (await gameImport('systems/weather/lightning.js'));
  const Ls = L.__scope();
  const { WeatherLights } = await gameImport('systems/weather/lights.js');
  const { Endless } = await gameImport('systems/weather/endless.js');
  const look7 = new Look(7);
  const lookState = { off: look7.uniforms.uWindOffset.value.clone(), wind: look7.uniforms.uWind.value.clone() };
  const freshLook = () => {
    // Look(7) textures are expensive: reuse the instance, reset the uniforms weather writes.
    const u = look7.uniforms;
    u.uWind.value.copy(lookState.wind);
    u.uWindOffset.value.copy(lookState.off);
    u.uRain.value = 0; u.uWet.value = 0; u.uFlash.value = 0; u.uNight.value = 0;
    look7.setFronts([]);
    return look7;
  };

  const pidx = (n) => (n == null ? -1 : PRESET_NAMES.indexOf(n));
  const b = (v) => (v ? 1 : 0);
  const PHASES = ['day', 'sunset', 'night'];

  // The probe: every number of the weather's observable + internal state, in a fixed order.
  const FIELDS = [];
  const F = (name, get) => FIELDS.push([name, get]);
  F('clock', (w) => w.clock); F('scriptT', (w) => w.scriptT); F('scriptIdx', (w) => w.scriptIdx);
  F('preset', (w) => pidx(w.state.preset)); F('severity', (w) => w.state.severity); F('intensity', (w) => w.state.intensity);
  for (const k of ['active', 't', 'over', 'wavesDown', 'rainUp', 'rainStart', 'frontEnd']) F('tr.' + k, (w) => +w.tr[k]);
  for (let i = 0; i < 4; i++) F('tCh' + i, (w) => w._tCh[i]);
  F('transition.active', (w) => b(w.state.transition.active)); F('transition.from', (w) => pidx(w.state.transition.from));
  F('transition.to', (w) => pidx(w.state.transition.to)); F('transition.t', (w) => w.state.transition.t);
  F('transition.over', (w) => w.state.transition.over); F('transition.progress', (w) => w.state.transition.progress);
  F('windTo', (w) => w._windTo); F('windA0', (w) => w._windA0); F('windA1', (w) => w._windA1); F('windAngle', (w) => w._windAngle);
  F('windDir.x', (w) => w.state.windDir.x); F('windDir.y', (w) => w.state.windDir.y);
  for (const k of ['windSpeed', 'windFrom', 'gust', 'gustMax']) F(k, (w) => w.state[k]);
  F('meanWind.x', (w) => w._meanWind.x); F('meanWind.y', (w) => w._meanWind.y);
  for (const k of ['rain', 'fog', 'hail', 'lightning', 'waveHeight', 'waveChoppiness', 'night', 'timeOfDay', 'visibility', 'turbulence', 'beaufort', 'seaState', 'wet', 'flash'])
    F(k, (w) => w.state[k]);
  for (const c of ['r', 'g', 'b']) F('flashColor.' + c, (w) => w.state.flashColor[c]);
  for (const v of ['sunDir', 'sunDirShadow', 'sunDirVisual']) for (const c of ['x', 'y', 'z']) F(v + '.' + c, (w) => w.state[v][c]);
  F('front.active', (w) => b(w.state.front.active)); F('front.t', (w) => w.state.front.t);
  F('front.origin.x', (w) => w.state.front.origin.x); F('front.origin.y', (w) => w.state.front.origin.y);
  F('front.dir.x', (w) => w.state.front.dir.x); F('front.dir.y', (w) => w.state.front.dir.y);
  F('greenTint', (w) => w.state.greenTint); F('greenTarget', (w) => w.greenTarget); F('greenApplied', (w) => w._greenApplied);
  F('stElmo', (w) => w.state.stElmo);
  F('pressure', (w) => w.state.pressure); F('pressureTrend', (w) => w.state.pressureTrend); F('pTrendRate', (w) => w._pTrendRate);
  F('pEmitted', (w) => w._pEmitted); F('pEmittedTrend', (w) => w._pEmittedTrend); F('eye', (w) => b(w._eye));
  for (const k of ['lightning', 'spouts', 'rogues']) F('rates.' + k, (w) => w.state.rates[k]);
  for (const k of ['x', 'z', 'distance', 'cloudOnly', 't']) F('lastStrike.' + k, (w) => +w.state.lastStrike[k]);
  for (const c of ['x', 'y', 'z']) F('heliPos.' + c, (w) => w.heliPos[c]);
  F('heliAlt', (w) => w.heliAlt);
  for (const c of ['x', 'y', 'z']) F('camFocus.' + c, (w) => w._camFocus[c]);
  F('attract', (w) => b(w.attract)); F('attractT', (w) => w.attractT); F('attractIdx', (w) => w.attractIdx);
  F('attractBolt', (w) => (w._attractBolt === undefined ? NaN : w._attractBolt));
  // gusts: timer, live count, 4 slots of the active list (pool index, record fields)
  F('gusts.timer', (w) => w.gusts.timer); F('gusts.n', (w) => w.gusts.active.length);
  for (let i = 0; i < 4; i++) {
    F(`gust${i}.slot`, (w) => (i < w.gusts.active.length ? w.gusts.pool.indexOf(w.gusts.active[i]) : -1));
    for (const k of ['x', 'z', 'dirX', 'dirZ', 'strength', 'baseStrength', 'eta', 'speed', 'harmless', 'age', 'fade'])
      F(`gust${i}.${k}`, (w) => (i < w.gusts.active.length ? +w.gusts.active[i][k] : 0));
  }
  // lightning scheduler
  for (const k of ['flashT', 'flashStrength', 'flashReduced', 'lastFlashAt', 'timer', 'clock']) F('lightning.' + k, (w) => +w.lightning[k]);
  for (let i = 0; i < 4; i++)
    for (const k of ['x', 'z', 'eta', 'total', 'radius', 'target', 'strength', 'alive'])
      F(`charge${i}.${k}`, (w) => { const c = w.lightning.charges[i]; return k === 'target' ? (c.target === 'heli' ? 1 : 0) : +c[k]; });
  // lights
  F('lights.swingT', (w) => w.lights.swingT);
  for (const c of ['x', 'y', 'z']) F('lights.swingDir.' + c, (w) => w.lights.swingDir[c]);
  F('sun.intensity', (w) => w.lights.sun.intensity);
  for (const c of ['r', 'g', 'b']) F('sun.color.' + c, (w) => w.lights.sun.color[c]);
  F('sun.shadow.intensity', (w) => w.lights.sun.shadow.intensity); F('sun.shadow.radius', (w) => w.lights.sun.shadow.radius);
  for (const c of ['r', 'g', 'b']) F('hemi.color.' + c, (w) => w.lights.hemi.color[c]);
  for (const c of ['r', 'g', 'b']) F('hemi.groundColor.' + c, (w) => w.lights.hemi.groundColor[c]);
  F('hemi.intensity', (w) => w.lights.hemi.intensity);
  for (const c of ['x', 'y', 'z']) F('sun.target.' + c, (w) => w.lights.sun.target.position[c]);
  for (const c of ['x', 'y', 'z']) F('sun.position.' + c, (w) => w.lights.sun.position[c]);
  F('lights.mapSize', (w) => w.lights.mapSize);
  // scene outputs
  for (const c of ['r', 'g', 'b']) F('fog.color.' + c, (w) => w.ctx.scene.fog.color[c]);
  F('fog.near', (w) => w.ctx.scene.fog.near); F('fog.far', (w) => w.ctx.scene.fog.far);
  F('exposure', (w) => w.ctx.renderer.toneMappingExposure);
  F('environmentIntensity', (w) => w.ctx.scene.environmentIntensity);
  F('env.lastBake', (w) => w.env.lastBake); F('env.dirty', (w) => b(w.env.dirty));
  // look uniforms weather writes
  F('look.uWind.x', (w) => w.ctx.look.uniforms.uWind.value.x); F('look.uWind.y', (w) => w.ctx.look.uniforms.uWind.value.y);
  F('look.uWindOffset.x', (w) => w.ctx.look.uniforms.uWindOffset.value.x); F('look.uWindOffset.y', (w) => w.ctx.look.uniforms.uWindOffset.value.y);
  for (const k of ['uRain', 'uWet', 'uFlash', 'uNight']) F('look.' + k, (w) => w.ctx.look.uniforms[k].value);
  // endless planner
  F('endless.active', (w) => b(w.endless.active)); F('endless.t', (w) => w.endless.t); F('endless.inPreset', (w) => w.endless.inPreset);
  F('endless.lullRolled', (w) => b(w.endless.lullRolled)); F('endless.phase', (w) => PHASES.indexOf(w.endless.phase));
  F('endless.next.at', (w) => (w.endless.next ? w.endless.next.at : NaN));
  F('endless.next.preset', (w) => (w.endless.next ? pidx(w.endless.next.preset) : -1));
  F('endless.next.over', (w) => (w.endless.next ? w.endless.next.over : NaN));
  F('endless.next.lull', (w) => (w.endless.next ? b(w.endless.next.lull) : 0));
  F('endless.nightPick', (w) => pidx(w.endless.nightPick));

  const probe = (w) => FIELDS.map(([, g]) => g(w));
  const frameHash = (h, w) => fnv(fnv(fnv(fnv(h, probe(w)), w._from), w._cur), w._out);

  // A run: constructor + init (with the env bake recorder), then per-frame actions and update(DT).
  function makeWeather({ mode, settings, params = '', obstacles = [] }) {
    const events = new EventBus();
    const log = [];
    const ctx = {
      events, mode, params: new URLSearchParams(params), scene: new THREE.Scene(), renderer: { toneMappingExposure: 1 },
      settings: makeSettings({ ...settings }), look: freshLook(), noise: createNoise2D(1337), heli: null, camera: null,
      world: { obstacles },
    };
    const emit = events.emit.bind(events);
    ctx._frame = -1;
    events.emit = (name, p) => {
      if (name.startsWith('weather:')) log.push(eventRow(ctx._frame, name, p));
      emit(name, p);
    };
    const w = new Weather(ctx);
    const bakes = [];
    w.env.init = function () {
      this.pmrem = {
        fromScene: () => {
          const u = this.uniforms;
          bakes.push([ctx._frame, ...['uSky', 'uFog', 'uDeep', 'uSunColor'].flatMap((k) => [u[k].value.r, u[k].value.g, u[k].value.b]),
            u.uSunDir.value.x, u.uSunDir.value.y, u.uSunDir.value.z, u.uSunI.value, u.uCloud.value].map(num));
          return { texture: { isTexture: true }, dispose() {} };
        },
      };
    };
    return { w, ctx, log, bakes };
  }

  function eventRow(frame, name, p) {
    switch (name) {
      case 'weather:preset': return [frame, name, p.from, p.to, num(p.over), p.worse, p.label, num(p.windFrom), num(p.gust)];
      case 'weather:gust': return [frame, name, num(p.dir.x), num(p.dir.y), num(p.strength), num(p.eta), num(p.x), num(p.z), p.harmless];
      case 'weather:charge': return [frame, name, num(p.x), num(p.z), num(p.radius), num(p.eta), p.target, p.heli];
      case 'weather:lightning': return [frame, name, num(p.x), num(p.z), num(p.distance), num(p.strength), p.cloudOnly];
      case 'weather:pressure': return [frame, name, num(p.pressure), num(p.trend)];
      default: return [frame, name, serialize(p)];
    }
  }

  const fc = (w) => w.forecast().map((e) => [num(e.in), e.preset, e.label, e.short, num(e.severity), e.worse, num(e.windFrom)]);
  const cp = (w) => serialize(w.checkpointState());

  // Apply one scripted action (before the frame's update). Queries return a value for data.queries.
  function act(h, a) {
    const { w, ctx } = h;
    switch (a.op) {
      case 'mode': { const from = ctx.mode; ctx.mode = a.to; ctx.events.emit('game:mode', { from, to: a.to }); return undefined; }
      case 'setup': ctx.events.emit('mission:setup', { def: a.def }); return undefined;
      case 'start': ctx.events.emit('mission:start', {}); return undefined;
      case 'spawnGust': w.spawnGust({ ...a.opts, dir: a.opts.dir ? new THREE.Vector2(a.opts.dir[0], a.opts.dir[1]) : undefined }); return undefined;
      case 'strike': return serialize(w.strikeLightning(a.x, a.z, a.opts) ? 'charge' : null);
      case 'green': w.setGreenTint(a.v); return undefined;
      case 'hail': w.setHail(a.v); return undefined;
      case 'preset': return w.setPreset(a.name, a.over, a.windFrom === undefined ? {} : { windFrom: a.windFrom });
      case 'endless': w.runEndless(); return undefined;
      case 'setting': ctx.settings.set(a.key, a.value); return undefined;
      case 'restore': w.restoreCheckpoint(a.t, a.snap); return undefined;
      case 'forecast': return fc(w);
      case 'checkpoint': return { scriptT: num(w.scriptT), snap: cp(w) };
      case 'windAt': return a.points.map(([x, z]) => { const v = w.windAt(x, z); return [num(v.x), num(v.y)]; });
      case 'cloudShadowAt': return a.points.map(([x, z]) => num(w.cloudShadowAt(x, z)));
      case 'detectBase': { const d = w.detectBase(); return [num(d.base), num(d.altBonus)]; }
      default: throw new Error('unknown action ' + a.op);
    }
  }

  function run(sc) {
    const h = makeWeather(sc);
    const { w, ctx } = h;
    const queries = [];
    const byFrame = new Map();
    for (const a of sc.actions) { if (!byFrame.has(a.frame)) byFrame.set(a.frame, []); byFrame.get(a.frame).push(a); }
    const doActions = (f) => {
      for (const a of byFrame.get(f) || []) {
        const r = act(h, a);
        if (r !== undefined) queries.push([f, a.op, r]);
      }
    };
    // frame -1: actions before init (none by default), init() (constructor already ran)
    ctx._frame = -1;
    doActions(-1);
    w.init();
    const rows = [];
    const hashes = [];
    let hsh = FNV0;
    let first = null;
    for (let f = 0; f < sc.frames; f++) {
      ctx._frame = f;
      if (sc.heli) {
        const p = heliAt(f, sc.heli);
        ctx.heli = { position: new THREE.Vector3(p.x, p.y, p.z), altitude: p.y };
        const cam = new THREE.Vector3(p.x + CAM_OFF[0], p.y + CAM_OFF[1], p.z + CAM_OFF[2]);
        ctx.camera = { position: cam, getWorldDirection: (o) => o.set(CAM_DIR[0], CAM_DIR[1], CAM_DIR[2]) };
      }
      doActions(f);
      w.update(sc.dtAt ? sc.dtAt(f) : DT);
      // hashEvery 1: every frame folds into the chain; otherwise only the sampled frames do (long runs)
      if (sc.hashEvery === 1 || (f + 1) % sc.hashEvery === 0) hsh = frameHash(hsh, w);
      if (f === 0) first = { probe: probe(w).map(num), from: Array.from(w._from, num), cur: Array.from(w._cur, num), out: Array.from(w._out, num) };
      if ((f + 1) % sc.hashEvery === 0) hashes.push(hsh);
      if (f % sc.every === sc.every - 1) rows.push(...probe(w));
    }
    return { h, rows, hashes, queries, first };
  }

  function emitRun(name, sc, extra = {}) {
    const r = run(sc);
    const nRows = r.rows.length / FIELDS.length;
    const rowsRef = sidecar('weather', `${name}.f64`, Float64Array.from(r.rows.map(canon)), [nRows, FIELDS.length]);
    const hashRef = sidecar('weather', `${name}_hash.u32`, Uint32Array.from(r.hashes), [r.hashes.length]);
    out('weather', name, {
      files: ['systems/weather.js', 'systems/weather/gusts.js', 'systems/weather/lightning.js', 'systems/weather/lights.js',
        'systems/weather/env.js', 'systems/weather/endless.js', 'systems/weather/palette.js', 'systems/weather/presets.js', 'core/look.js'].map(relSrc),
      tolerance: { class: 'chaos', bitwiseSteps: sc.frames, note: 'every frame bitwise (running FNV-1a of the probe + packed palettes); rows locate the first divergent field' },
      data: {
        setup: {
          dt: num(DT), frames: sc.frames, mode: sc.mode, params: sc.params || '', settings: sc.settings, obstacles: sc.obstacles || [],
          heli: sc.heli || null,
          heliFormula: 't = frame/60; x = x0 + ax·sin(t·wx), y = y0 + ay·sin(t·wy), z = z0 + az·sin(t·wz); ctx.heli = {position, altitude: y}; set BEFORE the frame\'s actions and update',
          camera: { offset: CAM_OFF, direction: CAM_DIR, note: 'camera.position = heli + offset; getWorldDirection = direction' },
          look: 'Look(7) (Resources/Textures atlas), uniforms zeroed; weather writes setWind/setFronts/uRain/uWet/uFlash/uNight',
          noise: 'createNoise2D(1337)',
          env: 'PMREM replaced by a recorder: every bake logs [frame, uSky rgb, uFog rgb, uDeep rgb, uSunColor rgb, uSunDir xyz, uSunI, uCloud]',
          order: 'new Weather(ctx) (mode, settings, params); actions of frame -1; init(); per frame f: heli/camera, actions of f (in order), update(dt)',
          ...extra,
        },
        actions: sc.actions.map((a) => serialize(a)),
        fields: FIELDS.map(([n]) => n),
        every: sc.every,
        rows: rowsRef,
        hashEvery: sc.hashEvery,
        hashes: hashRef,
        hashNote: 'h0 = 2166136261; h = fnv1a32(h, bytes of probe row ++ _from ++ _cur ++ _out as f64 LE) after every frame (hashEvery 1) or after frames (i+1)·hashEvery − 1 only; hashes[i] = h after frame (i+1)·hashEvery − 1',
        firstFrame: r.first,
        firstFrameNote: 'probe row and packed palettes after frame 0 (diagnostics for a hash mismatch)',
        events: r.h.log,
        bakes: r.h.bakes,
        queries: r.queries,
      },
    });
    return r;
  }

  const SET = { quality: 'high', reduceFlashes: false, difficulty: 'pilot' };
  const HELI = { x0: 30, ax: 180, wx: 0.05, y0: 60, ay: 40, wy: 0.1, z0: -40, az: 150, wz: 0.031 };
  const PTS = [[0, 0], [37.5, -12.25], [-140, 260], [610, -455]];
  const probes = (frame) => [
    { frame, op: 'forecast' }, { frame, op: 'windAt', points: PTS }, { frame, op: 'cloudShadowAt', points: PTS }, { frame, op: 'detectBase' },
  ];

  // 1. Campaign script calm → overcast → storm (wind shift, spatial front), scripted gust, charge, tint, hail.
  const defStorm = {
    seed: 5, timeOfDay: 0.42,
    weather: { start: 'calm', windFrom: 250, script: [{ at: 4, to: 'overcast', over: 8 }, { at: 12, to: 'storm', over: 30, windShift: 40 }, { at: 90, to: 'clearing' }] },
  };
  const calmToStorm = {
    mode: 'briefing', settings: SET, heli: HELI, frames: 4800, every: 30, hashEvery: 1,
    obstacles: [{ x: 120, z: -60, top: 45 }, { x: -300, z: 200, top: 12 }, { x: 40, z: 90 }],
    actions: [
      { frame: 0, op: 'setup', def: defStorm },
      ...probes(10),
      { frame: 30, op: 'mode', to: 'play' }, { frame: 30, op: 'start' },
      { frame: 200, op: 'spawnGust', opts: { strength: 6, eta: 5, harmless: true } },
      { frame: 260, op: 'spawnGust', opts: { strength: 9, dir: [0.3, -0.4], eta: 3 } },
      ...probes(400),
      { frame: 900, op: 'checkpoint' },
      { frame: 1500, op: 'green', v: 0.7 }, { frame: 1800, op: 'hail', v: 0.45 },
      { frame: 2100, op: 'strike', x: 20, z: -10, opts: { charge: true } },
      { frame: 2160, op: 'strike', x: -200, z: 50, opts: { cloudOnly: true, strength: 0.6 } },
      ...probes(2400),
      { frame: 2700, op: 'checkpoint' },
      { frame: 4500, op: 'checkpoint' },
      { frame: 3000, op: 'green', v: 0 }, { frame: 3000, op: 'hail', v: 1.5 },
      ...probes(4000),
    ],
  };
  const storm = emitRun('run_calm_to_storm', calmToStorm);

  // 1b. Checkpoint restores from the run above (mid-transition and settled): fresh weather, setup,
  // play, mission:start, restoreCheckpoint(t, snap), then 20 s.
  const cps = storm.queries.filter((q) => q[1] === 'checkpoint');
  cps.forEach((q, i) => {
    emitRun(`run_restore_${i}`, {
      mode: 'briefing', settings: SET, heli: HELI, frames: 1200, every: 30, hashEvery: 1,
      actions: [
        { frame: 0, op: 'setup', def: defStorm }, { frame: 0, op: 'mode', to: 'play' }, { frame: 0, op: 'start' },
        { frame: 0, op: 'restore', t: Number(q[2].scriptT), snap: q[2].snap }, ...probes(1),
      ],
    }, { source: `run_calm_to_storm checkpoint at frame ${q[0]}` });
  });

  // 2. Night storm with reduceFlashes + cadet (soft envelope, 1.5 s gap, +1 s telegraphs), heli above 70 m.
  emitRun('run_night_storm', {
    mode: 'briefing', settings: { quality: 'medium', reduceFlashes: true, difficulty: 'cadet' }, frames: 4800, every: 30, hashEvery: 1,
    heli: { ...HELI, y0: 85, ay: 25 }, obstacles: [{ x: 60, z: 60, top: 80 }],
    actions: [
      { frame: 0, op: 'setup', def: { seed: 9, timeOfDay: 0.9, weather: { start: 'nightStorm', windFrom: 30, script: [{ at: 50, to: 'nightCalm', over: 20, eye: true }] } } },
      { frame: 10, op: 'mode', to: 'play' }, { frame: 10, op: 'start' },
      { frame: 600, op: 'setting', key: 'reduceFlashes', value: false },
      { frame: 1500, op: 'setting', key: 'reduceFlashes', value: true },
      { frame: 1700, op: 'setting', key: 'quality', value: 'low' },
      ...probes(1000), ...probes(3300),
    ],
  });

  // 3. Forced weather and time of day (?weather=fog&tod=1.3): scripts disabled, wind from 300°.
  emitRun('run_fog', {
    mode: 'briefing', settings: SET, params: 'weather=fog&tod=1.3', heli: HELI, frames: 1800, every: 30, hashEvery: 1,
    actions: [
      { frame: 0, op: 'setup', def: { seed: 3, weather: { start: 'storm', script: [{ at: 5, to: 'calm', over: 10 }] } } },
      { frame: 5, op: 'mode', to: 'play' }, { frame: 5, op: 'start' },
      { frame: 300, op: 'green', v: 1 }, { frame: 900, op: 'preset', name: 'squall', over: 6 },
      ...probes(1200),
    ],
  });

  // 4. Title showcase: attract cycle nightStorm → fog → calm (8 s blends every 45 s), title bolts.
  emitRun('run_attract', {
    mode: 'title', settings: SET, heli: { x0: 0, ax: 20, wx: 0.2, y0: 30, ay: 2, wy: 0.5, z0: 0, az: 20, wz: 0.13 }, frames: 6000, every: 60, hashEvery: 1,
    actions: [...probes(100), { frame: 5900, op: 'mode', to: 'briefing' }],
  });

  // 5. «Смена»: endless escalation, 20 min of play (day → sunset → night), forecasts every 30 s.
  const endlessActions = [
    { frame: 0, op: 'setup', def: { seed: 20261016, endless: true, weather: { start: 'calm' } } },
    { frame: 1, op: 'mode', to: 'play' }, { frame: 1, op: 'start' },
  ];
  for (let f = 60; f < 72000; f += 1800) endlessActions.push({ frame: f, op: 'forecast' });
  emitRun('endless_20min', {
    mode: 'briefing', settings: SET, heli: HELI, frames: 72000, every: 600, hashEvery: 60, actions: endlessActions,
  });

  // ---- unit vectors: lightning envelopes, gust fronts, sun rig -------------------------------------
  const ts = [];
  for (let i = 0; i <= 480; i++) ts.push(i / 240);
  ts.push(0.11, 0.1100000001, 0.23, 0.2300000001, 0.12, 0.72, 0.7199999, 1.5, -0.01);
  out('weather', 'lightning', {
    files: [relSrc('systems/weather/lightning.js')], tolerance: BITWISE,
    data: {
      constants: { MAX_CHARGES: Ls.MAX_CHARGES, MIN_GAP: Ls.MIN_GAP, MIN_GAP_REDUCED: Ls.MIN_GAP_REDUCED },
      envelope: ts.map((t) => [num(t), num(Ls.envelope(t)), num(Ls.envelopeReduced(t))]),
      note: '[t, envelope(t), envelopeReduced(t)] (module-private functions via __scope)',
    },
  });

  // Gusts on their own: a shared mulberry32, spawn variants (dir, cadet +1 s, pool full → recycle the
  // oldest), random scheduling, update traces and addWindAt on a grid.
  {
    const { createRng } = await gameImport('core/math.js');
    const impl = createRng(77);
    const rng = { next: () => impl.next() };
    const settings = makeSettings({ difficulty: 'pilot' });
    const gs = new G.Gusts({ settings }, rng);
    const trace = [];
    const wd = new THREE.Vector2(0.6, -0.8);
    const ops = [];
    const snap = () => gs.active.map((f) => [gs.pool.indexOf(f), ...['x', 'z', 'dirX', 'dirZ', 'strength', 'baseStrength', 'eta', 'speed', 'age', 'fade'].map((k) => num(f[k])), f.harmless]);
    gs.reset();
    ops.push(['reset', num(gs.timer)]);
    const spawnOps = [
      [10, -5, { strength: 8 }], [0, 0, { strength: 5, dir: [1, 1], eta: 4, harmless: true }], [3, 4, { dir: [0, 0] }],
      [-20, 30, { strength: 12, eta: 2 }],
    ];
    for (const [x, z, o] of spawnOps) {
      const f = gs.spawn(x, z, wd, 7, { ...o, dir: o.dir ? new THREE.Vector2(o.dir[0], o.dir[1]) : undefined });
      ops.push(['spawn', x, z, serialize(o), gs.pool.indexOf(f), snap()]);
    }
    settings.set('difficulty', 'cadet');
    for (let i = 0; i < 30; i++) gs.update(0.1, 5, 5, wd, 7, 0, 0, false);
    const f5 = gs.spawn(1, 2, wd, 7, { strength: 3 }); // pool full → recycles the oldest
    ops.push(['spawn', 1, 2, { strength: 3 }, gs.pool.indexOf(f5), snap(), 'cadet']);
    settings.set('difficulty', 'pilot');
    const grid = [];
    for (let z = -200; z <= 200; z += 50) for (let x = -200; x <= 200; x += 50) grid.push([x, z]);
    for (let step = 0; step < 900; step++) {
      const allow = step < 700;
      const spawned = gs.update(1 / 30, 5 + step * 0.1, 5, wd, 9, 6, 0.05, allow);
      const row = [step, spawned ? gs.pool.indexOf(spawned) : -1, num(gs.timer), spawned || step % 5 === 0 ? snap() : null];
      if (step % 100 === 0) row.push(grid.map(([x, z]) => { const v = gs.addWindAt(x, z, new THREE.Vector2(0.5, -1)); return [num(v.x), num(v.y)]; }));
      trace.push(row);
    }
    out('weather', 'gusts', {
      files: [relSrc('systems/weather/gusts.js')], tolerance: BITWISE,
      data: {
        setup: 'rng = mulberry32(77) shared; settings.difficulty pilot; windDir (0.6, -0.8); reset(); spawns; difficulty cadet → 30 × update(0.1, 5, 5, wd, 7, 0, 0, false) → spawn(1, 2, …, {strength: 3}); pilot; 900 × update(1/30, 5 + step·0.1, 5, wd, 9, 6, 0.05, step < 700)',
        grid, gridNote: 'every 100 steps: addWindAt(x, z, out = (0.5, −1)) over grid',
        snapFields: ['slot', 'x', 'z', 'dirX', 'dirZ', 'strength', 'baseStrength', 'eta', 'speed', 'age', 'fade', 'harmless'],
        ops, trace,
      },
    });
  }

  // Sun rig: WeatherLights.update over cases (swing on/off, quality tiers, camera far from the box).
  {
    const { createRng } = await gameImport('core/math.js');
    const impl = createRng(4242);
    const rng = { next: () => impl.next() };
    const cases = [];
    for (const q of ['low', 'medium', 'high', 'bogus']) {
      const ctx = { scene: new THREE.Scene(), settings: makeSettings({ quality: q }) };
      const L = new WeatherLights(ctx);
      const pal = { sunIntensity: 2.4, sun: new THREE.Color(1, 0.8, 0.6), shadowIntensity: 0.7, shadowRadius: 3,
        ambient: new THREE.Color(0.4, 0.5, 0.6), ambientGround: new THREE.Color(0.1, 0.12, 0.1), ambientIntensity: 0.8 };
      const st = { palette: pal, flash: 0, flashColor: new THREE.Color(0.7, 0.8, 1), sunDir: new THREE.Vector3(), sunDirShadow: new THREE.Vector3(0.3, 0.8, -0.52).normalize() };
      const steps = [
        { dt: 0.016, focus: [10, 30, -20], alt: 30, cam: [12, 0, -25] },
        { dt: 0.016, focus: [100.37, 80, 55.5], alt: 200, cam: [400, 0, 40] },
        { swing: [130, -40, 100, -20], dt: 0.01, flash: 0.9, focus: [100, 40, -20], alt: 40, cam: [100, 0, -20] },
        { dt: 0.25, flash: 0.4, focus: [101, 40, -20], alt: 40, cam: [101, 0, -20] },
        { dt: 0.1, flash: 0.1, focus: [102, 40, -20], alt: 40, cam: [102, 0, -20] },
        { swing: [5, 5, 5.2, 5.1], dt: 0.05, flash: 1, focus: [5, 10, 5], alt: 10, cam: [5, 0, 5] },
        { dt: 0.3, flash: 0, focus: [5, 10, 5], alt: 10, cam: [5, 0, 5] },
        { sunDirShadow: [0, 1, 0], dt: 0.016, focus: [-33.3, 50, 77.7], alt: 50, cam: [-33.3, 0, 77.7] },
      ];
      const trace = [];
      for (const s of steps) {
        if (s.sunDirShadow) st.sunDirShadow.set(...s.sunDirShadow);
        if (s.swing) L.swing(...s.swing, rng);
        st.flash = s.flash ?? 0;
        L.update(s.dt, st, new THREE.Vector3(...s.focus), s.alt, new THREE.Vector3(...s.cam));
        trace.push([num(L.swingT), ...[L.swingDir.x, L.swingDir.y, L.swingDir.z, st.sunDir.x, st.sunDir.y, st.sunDir.z, L.sun.intensity,
          L.sun.color.r, L.sun.color.g, L.sun.color.b, L.sun.shadow.intensity, L.sun.shadow.radius, L.hemi.color.r, L.hemi.color.g, L.hemi.color.b,
          L.hemi.groundColor.r, L.hemi.groundColor.g, L.hemi.groundColor.b, L.hemi.intensity, L.sun.target.position.x, L.sun.target.position.y,
          L.sun.target.position.z, L.sun.position.x, L.sun.position.y, L.sun.position.z, L.mapSize, b(L.sun.shadow.camera.layers.isEnabled(1))].map(num)]);
      }
      cases.push({ quality: q, steps: steps.map((s) => serialize(s)), trace });
    }
    out('weather', 'sunrig', {
      files: [relSrc('systems/weather/lights.js')], tolerance: BITWISE,
      data: {
        setup: 'rng = mulberry32(4242) for swings; palette {sunIntensity 2.4, sun (1,.8,.6), shadowIntensity .7, shadowRadius 3, ambient (.4,.5,.6), ambientGround (.1,.12,.1), ambientIntensity .8}; flashColor (.7,.8,1); sunDirShadow = normalize(.3,.8,−.52) unless a step sets it; per step: swing(x, z, hx, hz) if given, st.flash, update(dt, st, focus, alt, cam)',
        fields: ['swingT', 'swingDir.x', 'swingDir.y', 'swingDir.z', 'sunDir.x', 'sunDir.y', 'sunDir.z', 'sun.intensity', 'sun.color.r', 'sun.color.g', 'sun.color.b',
          'shadow.intensity', 'shadow.radius', 'hemi.color.r', 'hemi.color.g', 'hemi.color.b', 'hemi.ground.r', 'hemi.ground.g', 'hemi.ground.b', 'hemi.intensity',
          'target.x', 'target.y', 'target.z', 'position.x', 'position.y', 'position.z', 'mapSize', 'layer1'],
        cases,
      },
    });
  }

  // Endless planner on its own: 1 Hz decisions over 20 min with a scripted clock and preset.
  {
    const { createRng } = await gameImport('core/math.js');
    const impl = createRng(20261016);
    const rng = { next: () => impl.next() };
    const en = new Endless(rng);
    const wst = { state: { preset: 'calm', timeOfDay: 9 / 24 } };
    en.start(wst.state.timeOfDay);
    const trace = [];
    const up = { in: 0, preset: 'calm' };
    for (let s = 1; s <= 1200; s++) {
      wst.state.timeOfDay = (9 / 24 + (s * 30) / 86400) % 1;
      const go = en.update(1, wst);
      if (go) wst.state.preset = go.to;
      const list = [];
      en.forEachUpcoming(wst, (i, p) => list.push([num(i), p]));
      const has = en.upcoming(wst, up);
      trace.push([s, go ? go.to : null, go ? num(go.over) : null, en.phase, en.next ? [num(en.next.at), en.next.preset, num(en.next.over), !!en.next.lull] : null,
        en.nightPick, num(en.intensity()), list, has ? [num(up.in), up.preset] : null]);
    }
    out('weather', 'endless', {
      files: [relSrc('systems/weather/endless.js')], tolerance: BITWISE,
      data: {
        setup: 'rng = mulberry32(20261016); start(9/24); per second s = 1…1200: timeOfDay = (9/24 + s·30/86400) % 1, update(1, w), preset = go.to when a change starts',
        fields: ['s', 'to', 'over', 'phase', 'next [at, preset, over, lull]', 'nightPick', 'intensity()', 'forEachUpcoming [[in, preset]…]', 'upcoming [in, preset]'],
        trace,
      },
    });
  }
  void Wsc;
}

// ===================================================================================================
const GROUPS = { weather };
for (const [k, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.has(k)) continue;
  const t0 = Date.now();
  await fn();
  console.log(`[${k}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const r of results) console.log(`${r.path}\t${r.bytes}`);
