// render-goldens: reference data for MaydayRender, produced by the WEB game (PLAN §5.5, §7 M2).
//
//   Node part (default) — CPU vectors of the render-side ports, from the real web modules (Node 22 =
//   reference engine, PLAN §5.2). Bit-exact (Double) unless the file's tolerance says otherwise:
//     Tests/Goldens/lighting/sunrig.json   weather/lights.js WeatherLights.update / swing / applyQuality and
//                                          three LightShadow.updateMatrices of the sun (SunRig, ShadowCamera)
//     Tests/Goldens/post/state/<case>.json post.js PostFX.update + pulse / event handlers (PostState), the
//                                          createFinalMaterial defaults (FinalUniformsCPU)
//     Tests/Goldens/post/dynres.json       post.js _dynamicResolution, resize pixel ratio, main.js pixelRatio
//     Tests/Goldens/post/bloom.json        post.js ScaledBloomPass (UnrealBloomPass) sizes / coefficients
//     Tests/Goldens/env/pmrem.json         three PMREMGenerator.fromScene(…, { size: 128 }) lod table and the
//                                          GGX filter passes as three issues them (EnvironmentProbe)
//     Tests/Goldens/env/weather_env.json   weather/env.js WeatherEnv.update schedule + bake uniforms
//     Tests/Goldens/ocean/memory.json      ocean/memory.js WaterMemory push / update (window, advect uniforms,
//                                          stamp attributes) fed by ocean.js stamp / splash / addWake / _autoStamps
//   --browser — frames from headless Chromium (lib/browser.mjs: SwiftShader WebGL2, serialised by the
//   machine-wide lock), written by renderFrames() below (see its header).
//
// Usage: node rescue-apple/tools/export/render-goldens.mjs [--only sunrig,post,dynres,bloom,env,memory,png] [--browser]
//                                                           [--frames synthetic,scenes] [--scenes a,b] [--out <dir>]
// Deterministic: the same web revision gives byte-identical files. Re-run after any change to the
// modules listed in each file's sourceFiles (or to the vendored three).
import { gameImport } from './shims/loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { APPLE, num, writeWrapped, relSrc } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Goldens'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/render-goldens.mjs';
const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern (Float values: Float(js) == swift Float); report index, both values and ulp distance on mismatch' };
const results = [];

console.warn = () => {};

const THREE = await import('three');
const { createRng } = await gameImport('core/math.js');
const { EventBus } = await gameImport('core/events.js');
const { PRESET_NAMES, FLASH_DAY, FLASH_NIGHT } = await gameImport('systems/weather/presets.js');
const { COMPILED, createPalette, unpack } = await gameImport('systems/weather/palette.js');

function out(domain, name, { files, tolerance = BITWISE, data, extra = {} }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.goldens.${domain.replace(/\//g, '.')}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance, ...extra }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}

const N = (a) => Array.from(a, num);
const V3 = (v) => [num(v.x), num(v.y), num(v.z)];
const C3 = (c) => [num(c.r), num(c.g), num(c.b)];
const M16 = (m) => N(m.elements);
const DEG = Math.PI / 180;

/** The live palette of a preset (COMPILED → unpack), as weather.js holds it after a finished transition. */
function presetPalette(name) {
  const p = createPalette();
  unpack(p, COMPILED[name]);
  return p;
}

/** weather.js _updateSun(p): visual and shadow (cheated elevation) sun directions of a palette. */
function sunDirs(p) {
  const az = p.sunAz * DEG, ev = p.sunElev * DEG, es = p.shadowElev * DEG;
  return {
    visual: new THREE.Vector3(Math.sin(az) * Math.cos(ev), Math.sin(ev), -Math.cos(az) * Math.cos(ev)),
    shadow: new THREE.Vector3(Math.sin(az) * Math.cos(es), Math.sin(es), -Math.cos(az) * Math.cos(es)),
  };
}

/** The palette fields the render ports read (light, env bake, post), exact. */
function paletteJSON(p) {
  return {
    sky: C3(p.sky), fogColor: C3(p.fogColor), deep: C3(p.deep), sun: C3(p.sun), ambient: C3(p.ambient),
    ambientGround: C3(p.ambientGround), sunIntensity: num(p.sunIntensity), ambientIntensity: num(p.ambientIntensity),
    shadowIntensity: num(p.shadowIntensity), shadowRadius: num(p.shadowRadius), exposure: num(p.exposure),
    envIntensity: num(p.envIntensity), fog: num(p.fog), scud: num(p.scud), fogNear: num(p.fogNear), fogFar: num(p.fogFar),
    sea: { whitecaps: num(p.sea.whitecaps) },
    post: {
      bloomStrength: num(p.post.bloomStrength), bloomRadius: num(p.post.bloomRadius), bloomThreshold: num(p.post.bloomThreshold),
      saturation: num(p.post.saturation), contrast: num(p.post.contrast), slope: V3(p.post.slope), offset: V3(p.post.offset),
      power: num(p.post.power), splitShadow: C3(p.post.splitShadow), splitHighlight: C3(p.post.splitHighlight),
      splitStrength: num(p.post.splitStrength), vignette: num(p.post.vignette), vignetteColor: C3(p.post.vignetteColor),
      grain: num(p.post.grain), ca: num(p.post.ca), drops: num(p.post.drops),
    },
  };
}

/** A renderer stand-in for the constructors that only size things (no GL is ever touched). */
function fakeRenderer(w = 960, h = 540, pr = 1) {
  return {
    _pr: pr, _w: w, _h: h, toneMappingExposure: 1, autoClear: true, toneMapping: 0, xr: { enabled: false },
    getPixelRatio() { return this._pr; }, setPixelRatio(p) { this._pr = p; },
    getSize(v) { return v.set(this._w, this._h); }, setSize(w2, h2) { this._w = w2; this._h = h2; },
    getDrawingBufferSize(v) { return v.set(Math.floor(this._w * this._pr), Math.floor(this._h * this._pr)); },
    getRenderTarget() { return null; }, setRenderTarget() {}, getActiveCubeFace() { return 0; }, getActiveMipmapLevel() { return 0; },
    getClearColor(c) { return c.set(0, 0, 0); }, getClearAlpha() { return 1; }, setClearColor() {}, clear() {}, render() {},
    domElement: { addEventListener() {}, width: w, height: h }, capabilities: {}, info: {},
    state: { buffers: { depth: { getReversed: () => false } } },
  };
}

// ===================================================================================== lighting/sunrig
async function sunrig() {
  const { WeatherLights } = await gameImport('systems/weather/lights.js');
  const cases = [];
  // presets: real palettes and sun directions; heli and camera focus move between steps
  const scenario = (name, quality, presetName, plan) => {
    const scene = new THREE.Scene();
    const settings = { get: (k) => (k === 'quality' ? quality : undefined) };
    const lights = new WeatherLights({ scene, settings });
    const p = presetPalette(presetName);
    const dirs = sunDirs(p);
    const st = {
      palette: p, sunDirShadow: dirs.shadow.clone(), sunDir: new THREE.Vector3(), flash: 0,
      flashColor: new THREE.Color(p.night > 0.5 ? FLASH_NIGHT : FLASH_DAY),
    };
    const rngSeed = 4242 + cases.length;
    const rng = createRng(rngSeed);
    const steps = [];
    for (const s of plan) {
      if (s.quality) {
        lights.applyQuality(s.quality);
        steps.push({ op: 'quality', quality: s.quality });
        continue;
      }
      if (s.swing) {
        const [x, z, hx, hz] = s.swing;
        lights.swing(x, z, hx, hz, rng);
        steps.push({ op: 'swing', x, z, hx, hz, swingDir: V3(lights.swingDir) });
        continue;
      }
      if (s.dir) st.sunDirShadow.set(...s.dir);
      st.flash = s.flash ?? 0;
      const focus = new THREE.Vector3(...s.focus);
      const camFocus = s.camFocus ? new THREE.Vector3(...s.camFocus) : null;
      lights.update(s.dt, st, focus, s.alt, camFocus);
      // what WebGLShadowMap does before drawing: world matrices, then LightShadow.updateMatrices
      scene.updateMatrixWorld();
      lights.sun.shadow.updateMatrices(lights.sun);
      const sh = lights.sun.shadow;
      steps.push({
        op: 'update', dt: num(s.dt),
        input: {
          sunDirShadow: V3(st.sunDirShadow), flash: num(st.flash), flashColor: C3(st.flashColor),
          focus: V3(focus), alt: num(s.alt), camFocus: camFocus ? V3(camFocus) : null,
        },
        out: {
          sunDir: V3(st.sunDir), swingWeight: num(lights.swingWeight), position: V3(lights.sun.position),
          target: V3(lights.sun.target.position), intensity: num(lights.sun.intensity), color: C3(lights.sun.color),
          shadowIntensity: num(sh.intensity), shadowRadius: num(sh.radius), hemiColor: C3(lights.hemi.color),
          hemiGround: C3(lights.hemi.groundColor), hemiIntensity: num(lights.hemi.intensity), mapSize: sh.mapSize.x,
          shadowLayer1: sh.camera.layers.isEnabled(1),
          camera: {
            projection: M16(sh.camera.projectionMatrix), quaternion: N(sh.camera.quaternion.toArray()),
            matrixWorld: M16(sh.camera.matrixWorld), matrixWorldInverse: M16(sh.camera.matrixWorldInverse),
            shadowMatrix: M16(sh.matrix),
          },
        },
      });
    }
    cases.push({ name, quality, preset: presetName, palette: paletteJSON(p), rngSeed, steps });
  };
  const walk = (dt, focus, alt, camFocus, extra = {}) => ({ dt, focus, alt, camFocus, ...extra });
  PRESET_NAMES.forEach((preset, i) => {
    const q = ['high', 'medium', 'low'][i % 3];
    scenario(`${preset}_${q}`, q, preset, [
      walk(1 / 60, [0, 40, 0], 40, [0, 0, -20]),
      walk(1 / 60, [12.3, 35, -40.7], 35, [10, 0, -60]),
      walk(1 / 30, [-210.25, 120, 333.5], 160, [-200, 0, 300]),        // alt > 140: offset clamps
      walk(0.1, [57.01, 5, 91.3], 0, [400, 0, 900]),                     // camera focus far: fallback
      walk(1 / 60, [3.14159, 22, -2.71828], 22, null),                   // no camera focus
      i % 2 ? { quality: i % 4 === 1 ? 'low' : 'high' } : { quality: 'medium' },
      walk(1 / 60, [1000.5, 60, -1500.25], 60, [1010, 0, -1490]),
    ]);
  });
  // lightning swing: hold 0.3 s, fade 0.12 s (weight 1 → 0), flash ramps the sun and the hemisphere
  scenario('swing_storm_high', 'high', 'nightStorm', [
    walk(1 / 60, [20, 30, -10], 30, [20, 0, -40]),
    { swing: [140.5, -220.25, 20, -10] },
    walk(1 / 60, [20.5, 30, -10.2], 30, [20, 0, -40], { flash: 1 }),
    walk(0.2, [21, 30, -10.4], 30, [20, 0, -40], { flash: 0.8 }),
    walk(0.1, [21.5, 30, -10.6], 30, [20, 0, -40], { flash: 0.4 }),     // t = 0.317: fading (w > 0.5)
    walk(0.05, [22, 30, -10.8], 30, [20, 0, -40], { flash: 0.1 }),      // t = 0.367: w < 0.5, dir back
    walk(0.1, [22.5, 30, -11], 30, [20, 0, -40]),
    { swing: [20.25, -10.5, 20, -10] },                                  // strike under the heli: random bearing
    walk(1 / 60, [22.5, 30, -11], 30, [20, 0, -40], { flash: 1 }),
  ]);
  // degenerate light directions: straight down (lookAt basis fallback), grazing sun (h = 0.05 clamp)
  scenario('degenerate_dirs', 'high', 'calm', [
    walk(1 / 60, [5, 50, 5], 50, [5, 0, -15], { dir: [0, 1, 0] }),
    walk(1 / 60, [5, 50, 5], 50, [5, 0, -15], { dir: [0.9998, 0.02, 0] }),
    walk(1 / 60, [-35, 80, 64], 80, [-30, 0, 40], { dir: [-0.6, 0.48, -0.64] }),
  ]);
  const L = new WeatherLights({ scene: new THREE.Scene(), settings: { get: () => 'high' } }).sun;
  out('lighting', 'sunrig', {
    files: [relSrc('systems/weather/lights.js'), relSrc('systems/weather/palette.js'), 'rescue/vendor/three (LightShadow, OrthographicCamera, Object3D.lookAt)'],
    data: {
      constants: {
        BOX: 250, DIST: 520, SWING_HOLD: 0.3, SWING_OUT: 0.12, MAP_SIZE: { low: 512, medium: 1024, high: 2048 },
        bias: num(L.shadow.bias), normalBias: num(L.shadow.normalBias), near: num(L.shadow.camera.near), far: num(L.shadow.camera.far),
        left: num(L.shadow.camera.left), right: num(L.shadow.camera.right), top: num(L.shadow.camera.top), bottom: num(L.shadow.camera.bottom),
      },
      note: 'swing() draws from createRng(rngSeed) of its case (mulberry32), in order; update outputs are the three objects after WeatherLights.update, scene.updateMatrixWorld() and sun.shadow.updateMatrices(sun)',
      cases,
    },
  });
}

// ======================================================================================== post/state
// PostFX is constructed for real (fake renderer: nothing is drawn). Systems that post.js only reads are
// inputs: the thermal view (mix / boot / flick), photo mode (inactive) and the lens drops — a bead-free
// stand-in exactly like the port's NoLensDrops placeholder (it never draws from the shared rng).
function makePost(quality, { reduceFlashes = false, reduceMotion = false, dynres = false } = {}) {
  return (async () => {
    const { PostFX } = await gameImport('systems/post.js');
    const settings = { v: { quality, reduceFlashes, reduceMotion }, get(k) { return this.v[k]; }, onChange() {} };
    const renderer = fakeRenderer();
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, 2, 1200);
    const ctx = {
      renderer, scene: new THREE.Scene(), camera, settings, events: new EventBus(), mode: 'play',
      params: new URLSearchParams(dynres ? '' : 'dynres=0'), time: { t: 0, dt: 0, realT: 0, realDt: 0, frame: 0 },
    };
    const post = new PostFX(ctx);
    post.drops = { count: 0, clear() {}, spray() {}, update() {}, upload() {}, setAspect() {}, texture: null };
    post.thermal = { mix: 0, boot: 0, flick: 1, active: false, update() {}, toggle() {}, prewarm() {}, setQuality() {}, setSize() {}, render() {} };
    return { post, ctx };
  })();
}

const UNIFORMS = ['uFlow', 'uDrops', 'uCondense', 'uSalt', 'uCA', 'uFlash', 'uFlashTint', 'uEdge', 'uVortex', 'uBright', 'uSatMul',
  'uSlope', 'uOffset', 'uPower', 'uContrast', 'uSat', 'uSplitShadow', 'uSplitHighlight', 'uSplitStrength', 'uGreen', 'uVignette',
  'uVignetteColor', 'uGrain', 'uNight', 'uSeed', 'uLetterbox', 'uDayToe', 'uFloor', 'uDof', 'uDofFocus', 'uDofBand', 'uDofTaps',
  'uLookMix', 'uLookSat', 'uLookContrast', 'uLookFade', 'uLookShadow', 'uLookHigh', 'uThermal', 'uThermBoot', 'uThermFlick', 'uThermT'];

function uniformValue(v) {
  if (typeof v === 'number') return num(v);
  if (v && v.isVector4) return [num(v.x), num(v.y), num(v.z), num(v.w)];
  if (v && v.isVector3) return V3(v);
  if (v && v.isVector2) return [num(v.x), num(v.y)];
  throw new Error('uniform value type');
}

function uniformsJSON(u) {
  const o = {};
  for (const k of UNIFORMS) o[k] = uniformValue(u[k].value);
  return o;
}

async function postState() {
  const cases = [];
  const palettes = {};
  const run = async (name, quality, opts, frames) => {
    const { post, ctx } = await makePost(quality, opts);
    const bufferHeight = opts.bufferHeight ?? 540;
    post._size.set(Math.round(bufferHeight * 16 / 9), bufferHeight);
    const rec = [];
    for (const f of frames) {
      // events land before post.update (other systems emit them earlier in the frame)
      for (const e of f.events || []) {
        if (e.type === 'pulse') post.pulse(e.name, e.strength);
        else if (e.type === 'heli:damage') ctx.events.emit('heli:damage', { source: e.source, amount: e.amount });
        else if (e.type === 'weather:lightning') ctx.events.emit('weather:lightning', { distance: e.distance, cloudOnly: e.cloudOnly });
        else if (e.type === 'hazard:hit') ctx.events.emit('hazard:hit', { type: e.kind });
      }
      ctx.mode = f.mode || 'play';
      ctx.weather = f.weather ? { state: f.weather.st } : undefined;
      ctx.heli = f.heli ? { ...f.heli, velocity: new THREE.Vector3(f.heli.velocity[0], 0, f.heli.velocity[1]) } : undefined;
      ctx.cameraRig = { letterbox: f.letterbox ?? 0 };
      if (f.camera) {
        ctx.camera.position.set(...f.camera.position);
        ctx.camera.lookAt(...f.camera.target);
        ctx.camera.updateMatrixWorld();
      }
      post.thermal.mix = f.thermal?.mix ?? 0;
      post.thermal.boot = f.thermal?.boot ?? 0;
      post.thermal.flick = f.thermal?.flick ?? 1;
      post.update(f.dt);
      const e = ctx.camera.matrixWorld.elements;
      const P = post.pulses;
      rec.push({
        dt: num(f.dt), mode: ctx.mode, events: f.events || [],
        weather: f.weather ? f.weather.json : null,
        heli: f.heli ? { hull: num(f.heli.hull), fuel: num(f.heli.fuel), alive: f.heli.alive, velocity: N(f.heli.velocity), altitude: num(f.heli.altitude), landed: !!f.heli.landed } : null,
        cameraRightXZ: [num(e[0]), num(e[2])], cameraUpXZ: [num(e[4]), num(e[6])],
        letterbox: num(f.letterbox ?? 0), thermal: { mix: num(post.thermal.mix), boot: num(post.thermal.boot), flick: num(post.thermal.flick) },
        out: {
          uniforms: uniformsJSON(post.finalMaterial.uniforms),
          exposure: num(ctx.renderer.toneMappingExposure),
          bloom: [num(post.bloom.strength), num(post.bloom.radius), num(post.bloom.threshold)],
          pulses: { damage: num(P.damage), caKick: num(P.caKick), caHold: num(P.caHold), vortex: num(P.vortex), flash: num(P.flash), after: num(P.after), pause: num(P.pause), salt: num(P.salt), sprayCd: num(P.sprayCd) },
          realT: num(post.realT), seedT: num(post.seedT), seed: num(post.seed),
        },
      });
    }
    cases.push({ name, quality, reduceFlashes: !!opts.reduceFlashes, reduceMotion: !!opts.reduceMotion, bufferHeight, frames: rec });
  };

  // weather state as weather.js publishes it (st), plus its JSON for the port
  const weather = (preset, extra = {}) => {
    const p = presetPalette(preset);
    const st = {
      palette: p, flash: 0, night: p.night, greenTint: 0, flashColor: new THREE.Color(p.night > 0.5 ? FLASH_NIGHT : FLASH_DAY),
      fog: p.fog, rain: p.rain, windDir: new THREE.Vector2(0.6, -0.8), windSpeed: p.wind, waveHeight: p.sea.Hs, preset, ...extra,
    };
    palettes[preset] ||= paletteJSON(p);
    const json = {
      preset, flash: num(st.flash), night: num(st.night), greenTint: num(st.greenTint),
      flashColor: st.flashColor ? C3(st.flashColor) : null, fog: num(st.fog), rain: st.rain === undefined ? null : num(st.rain),
      windDir: st.windDir ? [num(st.windDir.x), num(st.windDir.y)] : null, windSpeed: num(st.windSpeed), waveHeight: num(st.waveHeight),
    };
    return { st, json };
  };
  const heli = (o = {}) => ({ hull: 1, fuel: 1, alive: true, velocity: [0, 0], altitude: 40, landed: false, ...o });
  const cam = { position: [10, 220, 60], target: [10, 0, 0] };
  const camTurned = { position: [-40, 180, 30], target: [20, 0, -25] };
  const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  for (const [i, preset] of PRESET_NAMES.entries()) {
    const q = ['high', 'medium', 'low'][i % 3];
    await run(`${preset}_${q}`, q, { bufferHeight: [540, 720, 1080][i % 3] }, seq(30, (k) => ({
      dt: k % 7 === 3 ? 1 / 30 : 1 / 60,
      weather: weather(preset, { flash: k >= 10 && k < 14 ? [1, 0.6, 0.3, 0.1][k - 10] : 0, greenTint: preset === 'storm' ? 0.4 : 0 }),
      heli: heli({ velocity: [8 * Math.sin(k * 0.3), -14 + k * 0.2], altitude: 40 - k }),
      camera: k < 20 ? cam : camTurned,
      letterbox: k > 24 ? (k - 24) / 5 : 0,
      events: k === 5 ? [{ type: 'heli:damage', source: 'wave', amount: 0.12 }]
        : k === 8 ? [{ type: 'weather:lightning', distance: 25, cloudOnly: false }]
          : k === 18 ? [{ type: 'weather:lightning', distance: 300, cloudOnly: true }, { type: 'pulse', name: 'vortex', strength: 0.7 }]
            : k === 24 ? [{ type: 'hazard:hit', kind: 'rogue' }, { type: 'pulse', name: 'salt', strength: 2 }]
              : k === 27 ? [{ type: 'pulse', name: 'flash', strength: 0.9 }, { type: 'hazard:hit', kind: 'lightning' }]
                : [],
    })));
  }
  // low hull (breathing red edge), low fuel (amber pulses), death, pause damping, reduced flashes, thermal mix
  await run('edges_pause_reduce', 'high', { reduceFlashes: true, bufferHeight: 1080 }, seq(60, (k) => ({
    dt: 1 / 60 + (k % 5) * 0.004,
    mode: k >= 30 && k < 45 ? 'paused' : 'play',
    weather: weather('squall', { flash: k === 12 ? 1 : 0 }),
    heli: heli({ hull: 0.2 - k * 0.002, fuel: k < 30 ? 0.2 : 0.07, alive: k < 55, altitude: 6, velocity: [2, 3], landed: k > 50 }),
    camera: cam,
    thermal: { mix: k > 20 ? Math.min(1, (k - 20) / 10) : 0, boot: k > 20 ? 0.5 : 0, flick: 0.9 },
    events: k === 2 ? [{ type: 'heli:damage', source: 'rotor', amount: 0 }, { type: 'pulse', name: 'flash', strength: 1 }]
      : k === 7 ? [{ type: 'weather:lightning', distance: 10, cloudOnly: false }, { type: 'pulse', name: 'strike', strength: 1 }]
        : k === 40 ? [{ type: 'heli:damage', source: 'crest', amount: 0.5 }] : [],
  })));
  // low over breaking seas: spray cooldowns draw from the shared rng(911), salt builds while slow (high only)
  await run('spray_salt', 'high', { bufferHeight: 720 }, seq(70, (k) => ({
    dt: 1 / 20,
    weather: weather('storm', { rain: k > 45 ? undefined : 0.4 }),
    heli: heli({ altitude: 4 + (k % 9) * 0.5, velocity: [k < 50 ? 3 : 12, 1] }),
    camera: camTurned,
  })));
  // medium: drops allowed without rivulets; weather stub (st undefined) and no heli
  await run('stub_weather_medium', 'medium', { bufferHeight: 540 }, seq(20, (k) => ({
    dt: 1 / 60,
    weather: k < 10 ? null : weather('fog', { windDir: undefined }),
    heli: k < 5 ? null : heli({ altitude: 3, velocity: [1, 1] }),
    camera: cam,
    events: k === 1 ? [{ type: 'heli:damage', source: 'splash' }, { type: 'pulse', name: 'unknown', strength: 1 }] : [],
  })));

  const { createFinalMaterial } = await gameImport('systems/post/finalShader.js');
  const defaults = uniformsJSON(createFinalMaterial(null).uniforms);
  // one file per case (Tests/Goldens/post/state/<case>.json): the whole set is > 1 MB
  for (const c of cases) {
    const used = {};
    for (const f of c.frames) if (f.weather) used[f.weather.preset] = palettes[f.weather.preset];
    out('post/state', c.name, {
      files: [relSrc('systems/post.js'), relSrc('systems/post/finalShader.js'), relSrc('systems/post/photo.js'), relSrc('systems/weather/palette.js'), relSrc('core/math.js')],
      data: {
        note: 'Per frame: events (emitted before update), then PostFX.update(dt). Inputs: weather.state (palettes[preset] + scalars), ctx.heli, camera matrixWorld right/up (e0,e2 / e4,e6), cameraRig.letterbox, thermal view outputs. Lens drops: bead-free stand-in (NoLensDrops). photo mode inactive.',
        defaults,
        palettes: used,
        case: c,
      },
    });
  }
}

// ======================================================================================= post/dynres
async function dynres() {
  const cases = [];
  const run = async (name, quality, frames) => {
    const { post, ctx } = await makePost(quality, { dynres: true });
    const hints = [];
    ctx.events.on('post:quality-hint', (e) => hints.push(e));
    post.resize = () => {};          // the scale is the output here; resize() has its own cases below
    const windows = [];
    frames.forEach((f, i) => {
      ctx.mode = f.paused ? 'paused' : 'play';
      post.photo.state.active = !!f.photo;
      const before = post.stats.frameMs;
      const n0 = hints.length;
      post._dynamicResolution(f.dt);
      if (post._n === 0 && post._acc === 0) {
        windows.push({ frame: i, frameMs: num(post.stats.frameMs), scale: num(post.scale), atMinScale: post.stats.atMinScale, hint: hints.length > n0 ? { quality: hints[n0].quality, suggest: hints[n0].suggest, frameMs: num(hints[n0].frameMs) } : null });
      } else if (post.stats.frameMs !== before) throw new Error('dynres: frameMs changed mid-window');
    });
    cases.push({ name, quality, frames: frames.map((f) => ({ dt: num(f.dt), paused: !!f.paused, photo: !!f.photo })), windows });
  };
  const frames = (spec) => spec.flatMap(([n, dt, extra = {}]) => Array.from({ length: n }, () => ({ dt, ...extra })));
  await run('slow_then_fast_high', 'high', frames([[300, 0.02], [180, 1 / 60], [600, 0.025], [240, 0.012], [200, 1 / 60]]));
  await run('hint_medium', 'medium', frames([[1000, 0.024], [60, 1 / 60]]));
  await run('paused_photo_low', 'low', frames([[120, 0.03], [120, 0.03, { paused: true }], [120, 0.03, { photo: true }], [480, 0.03]]));
  await run('jittery_high', 'high', Array.from({ length: 900 }, (_, i) => ({ dt: 0.008 + ((i * 7919) % 17) * 0.0011 })));

  // post.js resize(): composer pixel ratio = max(0.25, min(prBase, max(cap, 0.5)) · scale)
  const resize = [];
  for (const [w, h, prBase, scale] of [[960, 540, 1, 1], [1280, 720, 2, 0.8], [2560, 1440, 2, 1], [844, 390, 3, 0.75], [3840, 2160, 1, 0.67], [400, 300, 1.25, 0.9]]) {
    const { post, ctx } = await makePost('high');
    ctx.renderer._pr = prBase;
    post.scale = scale;
    post.resize(w, h);
    resize.push({ w, h, prBase: num(prBase), scale: num(scale), pixelRatio: num(post.composer._pixelRatio) });
  }
  // main.js pixelRatio() — transcribed (main.js boots the game when imported): settings.pixelRatioCap() per quality
  const { Settings } = await gameImport('core/settings.js');
  const base = [];
  for (const q of ['low', 'medium', 'high']) {
    const s = new Settings();
    s.values.quality = q;
    for (const [dpr, w, h] of [[1, 960, 540], [2, 1440, 900], [3, 844, 390], [2, 2560, 1440], [1.5, 1366, 768]]) {
      const cap = s.pixelRatioCap();
      base.push({ quality: q, dpr: num(dpr), pixelRatioCap: num(cap), w, h, pixelRatio: num(Math.min(dpr, cap, Math.max(1, Math.sqrt((1920 * 1080) / (w * h))))) });
    }
  }
  out('post', 'dynres', {
    files: [relSrc('systems/post.js'), relSrc('main.js'), relSrc('core/settings.js')],
    data: {
      note: 'windows: one entry per closed 1 s window of _dynamicResolution(dt) (frame-time mean; the port feeds GPU time instead, X2, and never changes MSAA, X1). basePixelRatio: main.js pixelRatio() expression, transcribed.',
      MIN_SCALE: { low: 0.67, medium: 0.75, high: 0.8 },
      cases, resize, basePixelRatio: base,
    },
  });
}

// ======================================================================================== post/bloom
async function bloom() {
  const { __scope } = await gameImport('systems/post.js');
  const { ScaledBloomPass, BLOOM_SCALE } = __scope();
  const make = () => new ScaledBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.1);
  const b0 = make();
  const kernels = b0.separableBlurMaterials.map((m) => ({ KERNEL_RADIUS: m.defines.KERNEL_RADIUS, coefficients: N(m.uniforms.gaussianCoefficients.value) }));
  const sizes = [];
  for (const [w, h] of [[960, 540], [1920, 1080], [1280, 720], [2119, 979], [1001, 333], [7, 5]]) {
    for (const scale of [1, 0.5]) {
      const b = make();
      b.scale = scale;
      b.setSize(w, h);
      sizes.push({
        width: w, height: h, scale: num(scale),
        bright: [b.renderTargetBright.width, b.renderTargetBright.height],
        mips: b.renderTargetsHorizontal.map((t) => [t.width, t.height]),
        invSize: b.separableBlurMaterials.map((m) => [num(m.uniforms.invSize.value.x), num(m.uniforms.invSize.value.y)]),
      });
    }
  }
  out('post', 'bloom', {
    files: [relSrc('systems/post.js'), 'rescue/vendor/three/addons/postprocessing/UnrealBloomPass.js'],
    data: {
      BLOOM_SCALE, nMips: b0.nMips, smoothWidth: num(b0.highPassUniforms.smoothWidth.value),
      defaults: { strength: num(b0.strength), radius: num(b0.radius), threshold: num(b0.threshold) },
      bloomFactors: N(b0.compositeMaterial.uniforms.bloomFactors.value),
      bloomTintColors: b0.bloomTintColors.map(V3),
      kernels, sizes,
    },
  });
}

// ========================================================================================== env/pmrem
async function env() {
  const { PMREMGenerator } = THREE;
  // --- PMREMGenerator.fromScene(scene, 0, 0.1, 50, { size: 128 }): lods and the GGX passes it issues
  const passes = [];
  const r = fakeRenderer();
  let target = null;
  r.setRenderTarget = (t) => { target = t; };
  const gen = new PMREMGenerator(r);
  gen._setSize(128);
  const cube = gen._allocateTargets();
  r.render = (mesh) => {
    const m = mesh.material;
    if (m !== gen._ggxMaterial) return;
    const u = m.uniforms;
    const lod = gen._lodMeshes.indexOf(mesh);
    passes.push({
      lod, roughness: num(u.roughness.value), mipInt: num(u.mipInt.value),
      source: u.envMap.value === cube.texture ? 'cubeUV' : 'pingPong', target: target === cube ? 'cubeUV' : 'pingPong',
      viewport: [target.viewport.x, target.viewport.y, target.viewport.z, target.viewport.w],
    });
  };
  gen._applyPMREM(cube);
  const uvRange = gen._lodMeshes.map((mesh) => { const a = mesh.geometry.getAttribute('uv').array; return [num(a[0]), num(a[4])]; });
  const d = gen._ggxMaterial.defines;
  out('env', 'pmrem', {
    files: ['rescue/vendor/three (PMREMGenerator r185)', relSrc('systems/weather/env.js')],
    data: {
      size: 128, lodMax: gen._lodMax, cubeSize: gen._cubeSize, width: cube.width, height: cube.height,
      defines: { GGX_SAMPLES: d.GGX_SAMPLES, CUBEUV_TEXEL_WIDTH: num(d.CUBEUV_TEXEL_WIDTH), CUBEUV_TEXEL_HEIGHT: num(d.CUBEUV_TEXEL_HEIGHT), CUBEUV_MAX_MIP: d.CUBEUV_MAX_MIP },
      sizeLods: gen._sizeLods, uvRange, passes,
    },
  });

  // --- WeatherEnv.update(clock, st, transitioning): bake schedule, bake uniforms, environmentIntensity
  const { WeatherEnv } = await gameImport('systems/weather/env.js');
  const scene = new THREE.Scene();
  const we = new WeatherEnv({ scene, renderer: fakeRenderer() });
  we.init();
  let baked = null;
  we.pmrem.fromScene = (sc, sigma, near, far, opts) => {
    const u = we.uniforms;
    baked = {
      sigma, near, far, size: opts.size,
      uSky: C3(u.uSky.value), uFog: C3(u.uFog.value), uDeep: C3(u.uDeep.value), uSunDir: V3(u.uSunDir.value),
      uSunColor: C3(u.uSunColor.value), uSunI: num(u.uSunI.value), uCloud: num(u.uCloud.value),
    };
    return { texture: {}, dispose() {} };
  };
  const steps = [];
  let clock = 0;
  const plan = [];
  for (const [i, preset] of PRESET_NAMES.entries()) {
    plan.push({ dt: 0.5, preset, transitioning: false });
    plan.push({ dt: 1.5, preset, transitioning: true, flash: i % 3 === 1 ? 0.5 : 0 });
    plan.push({ dt: 2.6, preset, transitioning: true });
    plan.push({ dt: 0.004, preset, transitioning: true, flash: 0.02 });
    plan.push({ dt: 4.1, preset, transitioning: i % 2 === 0, markDirty: i % 2 === 1 });
  }
  for (const s of plan) {
    clock += s.dt;
    const p = presetPalette(s.preset);
    const sd = sunDirs(p);
    const st = { palette: p, flash: s.flash ?? 0, sunDirVisual: sd.visual };
    if (s.markDirty) we.markDirty();
    baked = null;
    we.update(clock, st, s.transitioning);
    steps.push({
      clock: num(clock), preset: s.preset, palette: paletteJSON(p), sunDirVisual: V3(sd.visual), flash: num(st.flash),
      transitioning: s.transitioning, markDirty: !!s.markDirty,
      out: { baked, environmentIntensity: num(scene.environmentIntensity) },
    });
  }
  out('env', 'weather_env', {
    files: [relSrc('systems/weather/env.js'), relSrc('systems/weather/palette.js')],
    data: { note: 'per step: markDirty() if set, then WeatherEnv.update(clock, st, transitioning); baked = the uniforms of PMREMGenerator.fromScene when it ran (else null)', steps },
  });
}

// ======================================================================================= ocean/memory
async function memory() {
  const { WaterMemory } = await gameImport('systems/ocean/memory.js');
  const { Ocean } = await gameImport('systems/ocean.js');
  const sizes = [384, 512];
  const cases = [];
  for (const size of sizes) {
    const wm = new WaterMemory(fakeRenderer(), size, 320, {});
    const steps = [];
    const flushed = () => {
      const n = wm.count;
      return { count: n, aA: N(wm.aA.array.slice(0, n * 4)), aB: N(wm.aB.array.slice(0, n * 4)), aC: N(wm.aC.array.slice(0, n * 4)) };
    };
    const ocean = (dt) => ({ memory: wm, ctx: { time: { t: 12.5, dt } }, _spl: { next: 0, x: [], z: [], r: [], s: [], t0: [] }, features: { downwash: [0, 0, 10, 0] } });
    const op = (o) => steps.push(o);
    const plan = [
      ['stamp', 'foam', 10.5, -20.25, {}], ['stamp', 'dye', -3, 7, { radius: 9, strength: 0.4 }], ['stamp', 'disturb', 0, 0, { radius: 2 }],
      ['stamp', 'oil', 55.5, 12, { radius: 14, strength: 0.25 }], ['stamp', 'ring', 1, 2, { radius: 6, inner: 0.5 }], ['stamp', 'ring', 1, 2, {}],
      ['stamp', 'scar', -40, 33, { radius: 11, strength: 0.8 }], ['stamp', 'splash', 7, 7, { radius: 3.5, strength: 1.2 }],
      ['stamp', 'wake', 2, -9, { radius: 5, dirX: 3, dirZ: -4 }], ['stamp', 'wake', 2, -9, { radius: 5 }], ['stamp', 'bogus', 0, 0, {}],
      ['stamp', 'foam', 0, 0, { radius: 0 }], ['stamp', 'foam', 0, 0, { strength: NaN }],
      ['splash', 30.25, -14.5, 2.4, 0.9], ['wake', -12, 40, 1.7, 0.6, -0.8, 1 / 60], ['wake', -12, 40, 5, undefined, undefined, 1 / 60],
      ['wake', 4, 4, 1, 1, 0, 0], ['auto', [12, -8, 18.5, 0.7], 1 / 60], ['auto', [12, -8, 18.5, 0.005], 1 / 60],
      ['update', 1 / 60, 3.3, -7.9, 4.2, -1.3],
      ['update', 1 / 60, 3.31, -7.95, 4.2, -1.3],
      ['splash', 0, 0, 1, 1], ['update', 0.05, 25.123, 18.7, -9, 11],
      ['overflow', 140], ['update', 1 / 30, 25.5, 18.9, -9, 11],
      ['clear'], ['stamp', 'foam', 1, 1, {}], ['update', 0.1, -500.6, 1200.2, 0, 0],
      ['update', 2.5, -499.1, 1201.9, 20, -3],
    ];
    for (const p of plan) {
      const [kind] = p;
      if (kind === 'stamp') { Ocean.prototype.stamp.call(ocean(0), p[1], p[2], p[3], p[4]); op({ op: 'stamp', kind: p[1], x: num(p[2]), z: num(p[3]), opts: Object.fromEntries(Object.entries(p[4]).map(([k, v]) => [k, num(v)])) }); }
      else if (kind === 'splash') { Ocean.prototype.splash.call(ocean(0), p[1], p[2], p[3], p[4]); op({ op: 'splash', x: num(p[1]), z: num(p[2]), radius: num(p[3]), strength: num(p[4]) }); }
      else if (kind === 'wake') { Ocean.prototype.addWake.call(ocean(p[6]), p[1], p[2], p[3], p[4], p[5]); op({ op: 'addWake', x: num(p[1]), z: num(p[2]), strength: num(p[3]), dirX: p[4] === undefined ? null : num(p[4]), dirZ: p[5] === undefined ? null : num(p[5]), dt: num(p[6]) }); }
      else if (kind === 'auto') { const o = ocean(p[2]); o.features.downwash = p[1]; Ocean.prototype._autoStamps.call(o, p[2]); op({ op: 'autoStamps', downwash: N(p[1]), dt: num(p[2]) }); }
      else if (kind === 'overflow') { for (let i = 0; i < p[1]; i++) wm.push('disc', i, -i, 1 + i * 0.01, 0.5, 1, 0, 0.3, 0); op({ op: 'overflow', n: p[1] }); }
      else if (kind === 'clear') { wm.clear(); op({ op: 'clear' }); }
      else if (kind === 'update') {
        const stamps = flushed();
        wm.update(p[1], p[2], p[3], p[4], p[5]);
        const u = wm.advect.uniforms;
        op({
          op: 'update', dt: num(p[1]), focus: [num(p[2]), num(p[3])], wind: [num(p[4]), num(p[5])], stamps,
          out: {
            uShift: [num(u.uShift.value.x), num(u.uShift.value.y)], uCenter: [num(u.uCenter.value.x), num(u.uCenter.value.y)],
            uExtent: num(u.uExtent.value), uDt: num(u.uDt.value), uWindV: [num(u.uWindV.value.x), num(u.uWindV.value.y)],
            uDecay: [num(u.uDecay.value.x), num(u.uDecay.value.y), num(u.uDecay.value.z), num(u.uDecay.value.w)],
            uTexel: [num(u.uTexel.value.x), num(u.uTexel.value.y)], uDiffuse: num(u.uDiffuse.value),
            center: [num(wm.center.x), num(wm.center.y)], countAfter: wm.count,
          },
        });
      }
    }
    cases.push({ size, steps });
  }
  out('ocean', 'memory', {
    files: [relSrc('systems/ocean/memory.js'), relSrc('systems/ocean.js')],
    data: {
      note: 'stamps = the aA/aB/aC instance attributes (Float32Array) queued before each update(dt, focusX, focusZ, windX, windZ); out = the advect uniforms after it (three uploads them as float) and the new window centre',
      MAX_STAMPS: 128, HALF_LIFE: [3, 240, 0.8, 600], EXTENT: 320, cases,
    },
  });
}

// ============================================================================================ frames
// --browser: reference frames of the WEB game, rendered by headless Chromium (SwiftShader WebGL2) with a
// frozen clock: an init script replaces performance.now / requestAnimationFrame by a manual clock (every
// frame advances exactly 1/60 s) and Math.random by mulberry32(20261016), so a scene is the same frame on
// every run. Each scene boots the game with only weather + ocean + post real (?only=…, everything else is
// a core/stubs.js stand-in: the heli is the stub box BoxGeometry(3, 2, 10) #FF5A2A — a MeshStandardMaterial
// lit by the sun, the hemisphere light and the PMREM environment, i.e. a lighting probe), ?dynres=0, the
// stub world's pad removed. After FRAMES frames the page reads, in the frame's own task:
//   final.png   the canvas (FinalPass output, or the plain tone-mapped render when post is stubbed), RGBA8
//   post.png    the OutputPass result (post.rtPost, half float → round(v·255)), RGBA8 — post scenes only
//   <name>.json the complete render state of that frame: camera, look / fog / lights / environment uniforms,
//               every ocean uniform + quality config, the FinalPass uniforms, exposure, bloom, the probe box,
//               and the water-memory log (each WaterMemory.update call since boot: dt, focus, wind, the
//               queued stamp attributes) so the Metal test replays the memory before drawing the frame.
// The Metal side (RenderGoldenTests) rebuilds a RenderFrame from the JSON alone — render parity is tested
// in isolation from the simulation — and compares with PLAN §5.5 metrics (SSIM ≥ 0.92 for scenes).
// Images are stored top row first (PNG), like Renderer.renderOffscreen returns them.

const FRAME_W = 480, FRAME_H = 270;
const FRAMES = 48;

// ---- PNG (8-bit or 16-bit RGBA, filter 0 per row, zlib level 9) ------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** rows: top row first; px: Uint8Array (depth 8) or Uint16Array (depth 16) of width·height·4 samples.
 *  filters: 'none' (type 0 on every row) or 'cycle' (row y uses type y % 5: exercises every decoder path). */
export function encodePNG(width, height, px, depth = 8, filters = 'none') {
  const bpp = depth === 16 ? 8 : 4;
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const r = Buffer.alloc(stride);
    for (let i = 0; i < width * 4; i++) {
      const v = px[y * width * 4 + i];
      if (depth === 16) r.writeUInt16BE(v, i * 2); else r[i] = v;
    }
    rows.push(r);
  }
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const f = filters === 'cycle' ? y % 5 : 0;
    const cur = rows[y], prev = y > 0 ? rows[y - 1] : Buffer.alloc(stride);
    const o = y * (1 + stride);
    raw[o] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[o + 1 + i] = (cur[i] - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function writeBinary(rel, buf) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return { path: path.relative(APPLE, p), bytes: buf.length };
}

// The frozen clock (page init script, before any game module runs).
function CLOCK_INIT() {
  let now = 0;
  const q = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__clock = {
    step(n, dt) { for (let i = 0; i < n; i++) { now += dt * 1000; const cbs = q.splice(0); for (const cb of cbs) cb(now); } return now; },
    pending: () => q.length,
  };
  let a = 20261016;
  Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// name, preset, quality, heli stub position (the camera stub follows it: (x, y + 180, z + 50) → (x, 0, z)),
// probe casts a shadow, post (false = ?stub post: plain render to the canvas with in-material ACES + sRGB).
const SCENES = [
  ...PRESET_NAMES.map((preset) => ({ name: `${preset}_high`, preset, quality: 'high', heli: [0, 40, 0] })),
  { name: 'shadow_calm_high', preset: 'calm', quality: 'high', heli: [12, 22, -6], castShadow: true },
  { name: 'shadow_clearing_medium', preset: 'clearing', quality: 'medium', heli: [-30, 30, 25], castShadow: true },
  { name: 'downwash_overcast_high', preset: 'overcast', quality: 'high', heli: [5, 9, 3], castShadow: true },
  { name: 'fog_low', preset: 'fog', quality: 'low', heli: [140, 40, -220] },
  { name: 'nightCalm_medium', preset: 'nightCalm', quality: 'medium', heli: [-60, 40, 90] },
  { name: 'storm_high_postoff', preset: 'storm', quality: 'high', heli: [0, 40, 0], post: false },
  { name: 'calm_low_postoff', preset: 'calm', quality: 'low', heli: [0, 40, 0], post: false },
];

// In the page: the render state of the frame just drawn (see the header).
function READ_STATE(spec) {
  const g = window.__game;
  const S = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (v.isColor) return [v.r, v.g, v.b];
    if (v.isVector2) return [v.x, v.y];
    if (v.isVector3) return [v.x, v.y, v.z];
    if (v.isVector4 || v.isQuaternion) return [v.x, v.y, v.z, v.w];
    if (v.isMatrix4 || v.isMatrix3) return Array.from(v.elements);
    if (ArrayBuffer.isView(v)) return Array.from(v);
    if (Array.isArray(v)) return v.map(S);
    return undefined;
  };
  const uniforms = (u) => {
    const o = {};
    for (const [k, x] of Object.entries(u)) { const s = S(x.value); if (s !== undefined && s !== null) o[k] = s; }
    return o;
  };
  const cam = g.camera;
  const sun = g.weather.lights.sun, hemi = g.weather.lights.hemi;
  const fog = g.scene.fog;
  const post = g.post && g.post.finalMaterial ? g.post : null;
  const box = g.heli.group;
  const gl = g.renderer.getContext();
  return {
    frame: g.time.frame, t: g.time.t, realT: g.time.realT, mode: g.mode,
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], pixelRatio: g.renderer.getPixelRatio(),
    camera: {
      position: S(cam.position), target: [spec.heli[0], 0, spec.heli[2]], up: S(cam.up), fov: cam.fov, near: cam.near, far: cam.far,
      aspect: cam.aspect, zoom: cam.zoom, matrixWorld: S(cam.matrixWorld), matrixWorldInverse: S(cam.matrixWorldInverse), projectionMatrix: S(cam.projectionMatrix),
    },
    look: uniforms(g.look.uniforms),
    fog: { color: S(fog.color), near: fog.near, far: fog.far },
    background: S(g.scene.background),
    lights: {
      sun: { position: S(sun.position), target: S(sun.target.position), color: S(sun.color), intensity: sun.intensity,
        shadow: { bias: sun.shadow.bias, normalBias: sun.shadow.normalBias, radius: sun.shadow.radius, intensity: sun.shadow.intensity,
          mapSize: sun.shadow.mapSize.x, layer1: sun.shadow.camera.layers.isEnabled(1), matrix: S(sun.shadow.matrix) } },
      hemi: { color: S(hemi.color), groundColor: S(hemi.groundColor), intensity: hemi.intensity },
      environmentIntensity: g.scene.environmentIntensity,
    },
    environment: uniforms(g.weather.env.uniforms),
    weather: { preset: g.weather.state.preset, flash: g.weather.state.flash, night: g.weather.state.night },
    ocean: { cfg: { ...g.ocean.cfg }, defines: { ...g.ocean.material.defines }, memory: g.ocean.memory ? g.ocean.memory.size : 0, uniforms: uniforms(g.ocean.uniforms) },
    post: post ? {
      exposure: g.renderer.toneMappingExposure, samples: post.samples,
      bloom: { enabled: post.bloom.enabled, scale: post.bloom.scale, strength: post.bloom.strength, radius: post.bloom.radius, threshold: post.bloom.threshold },
      final: uniforms(post.finalMaterial.uniforms),
    } : { exposure: g.renderer.toneMappingExposure, stub: true },
    probe: {
      matrixWorld: S(box.matrixWorld), color: S(box.material.color), emissive: S(box.material.emissive), roughness: box.material.roughness,
      metalness: box.material.metalness, castShadow: box.castShadow, receiveShadow: box.receiveShadow, geometry: [3, 2, 10],
    },
    memoryLog: window.__memLog || [],
  };
}

async function renderScene(page, base, sc) {
  const q = [`only=weather,ocean${sc.post === false ? '' : ',post'}`, `quality=${sc.quality}`, 'dynres=0', 'nohud', `weather=${sc.preset}`].join('&');
  await page.goto(`${base}/rescue/index.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.__clock.pending() > 0, null, { timeout: 120000, polling: 200 });
  await page.evaluate((spec) => {
    const g = window.__game;
    for (const p of g.world.pads || []) g.scene.remove(p.object3d);   // the stub world's pad is not part of the scene
    g.heli.position.set(...spec.heli);
    g.heli.altitude = spec.heli[1];
    g.heli.group.position.copy(g.heli.position);
    g.heli.group.castShadow = !!spec.castShadow;
    // water memory log: every update since boot (the memory starts cleared by the stub mission setup)
    window.__memLog = [];
    const mem = g.ocean.memory;
    if (mem) {
      const update = mem.update.bind(mem);
      mem.update = (dt, fx, fz, wx, wz) => {
        const n = mem.count;
        window.__memLog.push({ dt, focus: [fx, fz], wind: [wx, wz], aA: Array.from(mem.aA.array.slice(0, n * 4)),
          aB: Array.from(mem.aB.array.slice(0, n * 4)), aC: Array.from(mem.aC.array.slice(0, n * 4)) });
        update(dt, fx, fz, wx, wz);
      };
    }
    window.__clock.step(1, 1 / 60);
  }, sc);
  // shader warm-up runs on real timers (compileAsync polling): step until idle, then up to FRAMES in total
  let done = 1;
  for (let k = 0; k < 200 && done < FRAMES - 2; k++) {
    const warm = await page.evaluate(() => { window.__clock.step(1, 1 / 60); return window.__game.warmup; });
    done++;
    if (warm === 'idle') break;
    await page.waitForTimeout(150);
  }
  const shot = await page.evaluate(([n, spec, readState]) => {
    window.__clock.step(n, 1 / 60);                       // frames up to FRAMES − 1 …
    window.__clock.step(1, 1 / 60);                       // … and the captured frame, read in its own task
    const g = window.__game;
    const gl = g.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const fin = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, fin);
    let post = null;
    if (g.post && g.post.rtPost) {
      const buf = new Uint16Array(w * h * 4);
      g.renderer.readRenderTargetPixels(g.post.rtPost, 0, 0, w, h, buf);
      post = Array.from(buf);
    }
    // eslint-disable-next-line no-new-func
    const state = new Function('return ' + readState)()(spec);
    return { w, h, final: Array.from(fin), post, state };
  }, [FRAMES - 1 - done, sc, READ_STATE.toString()]);
  return shot;
}

// RGBA (row 0 = bottom, GL readPixels) → top row first
function flipRows(px, w, h) {
  const out = new px.constructor(px.length);
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return out;
}

/** IEEE half → number (exact). */
function halfToFloat(hb) {
  const s = hb & 0x8000 ? -1 : 1, e = (hb >> 10) & 0x1f, m = hb & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

// ---- synthetic pass goldens (PLAN §5.5: FinalPass with fixed inputs, Bloom and Output on HDR ramps) -------
// The live game's own pass objects (OutputPass, the ScaledBloomPass post.bloom, the FinalPass post.final,
// the env bake weather.env) run on inputs given by integer formulas — reproduced verbatim by the Swift test
// (RenderGoldenTests.SyntheticInputs), all exactly representable in half float, the format of both sides'
// targets. Inputs are DataTextures (row 0 = GL bottom row); results are read back from HalfFloat / RGBA8
// targets and stored top row first, except the PMREM atlas, kept in GL row order like EnvironmentProbe.atlas.
const SYN_W = 256, SYN_H = 144;

async function SYNTH(spec) {
  const g = window.__game, THREE = g.THREE, r = g.renderer;
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
  const { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js');
  const { CopyShader } = await import('three/addons/shaders/CopyShader.js');
  const W = spec.w, H = spec.h;
  const halfRT = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const readHalf = (rt) => { const b = new Uint16Array(rt.width * rt.height * 4); r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, b); return Array.from(b); };
  const readByte = (rt) => { const b = new Uint8Array(rt.width * rt.height * 4); r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, b); return Array.from(b); };
  const texture = (f) => {
    const a = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f(x, y); a.set([v[0], v[1], v[2], 1], (y * W + x) * 4); }
    const t = new THREE.DataTexture(a, W, H, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  // the formulas (x right, y = GL row from the bottom); RenderGoldenTests.SyntheticInputs mirrors them
  const hdrRamp = (x, y) => [x / 128, y / 64, ((x * y) % 97) / 64];
  const spots = (x, y) => {
    const S = [[40, 30, 6, 3, 1.5], [128, 72, 2, 4, 8], [200, 110, 5, 5, 5]];
    for (const [cx, cy, R, G, B] of S) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= 36) return [R, G, B];
    return [0.0625, 0.125, 0.1875];
  };
  const ldr = (x, y) => [Math.floor((x * 255) / (W - 1)) / 256, Math.floor((y * 255) / (H - 1)) / 256, ((x * y + 7 * x) % 256) / 256];
  const out = { output: [], bloom: [], final: [], pmrem: [] };
  const savedExposure = r.toneMappingExposure;

  // 1. OutputPass (ACES Filmic × exposure, sRGB OETF) of an HDR ramp
  const ramp = texture(hdrRamp);
  const op = new OutputPass();
  for (const e of [0.85, 1, 1.4]) {
    const rt = halfRT();
    r.toneMappingExposure = e;
    op.render(r, rt, { texture: ramp });
    out.output.push({ exposure: e, half: readHalf(rt) });
    rt.dispose();
  }
  // 2. UnrealBloomPass (post.js ScaledBloomPass, the game's instance) added onto the scene target, then output
  const copy = new ShaderPass(CopyShader);
  const bl = g.post.bloom;
  const saved = { strength: bl.strength, radius: bl.radius, threshold: bl.threshold, scale: bl.scale };
  for (const c of spec.bloom) {
    const scene = halfRT();
    copy.render(r, scene, { texture: texture(spots) });
    bl.strength = c.strength; bl.radius = c.radius; bl.threshold = c.threshold;
    bl.setScale(c.scale);
    bl.setSize(W, H);
    bl.render(r, null, scene, 0, false);
    const rt = halfRT();
    r.toneMappingExposure = 1;
    op.render(r, rt, { texture: scene.texture });
    out.bloom.push({ ...c, half: readHalf(rt) });
    scene.dispose(); rt.dispose();
  }
  Object.assign(bl, { strength: saved.strength, radius: saved.radius, threshold: saved.threshold });
  bl.setScale(saved.scale);
  r.toneMappingExposure = savedExposure;
  // 3. FinalPass (post/finalShader.js through post.final) on an LDR image, per uniform set
  const src = halfRT();
  copy.render(r, src, { texture: texture(ldr) });
  const fm = g.post.finalMaterial.uniforms;
  for (const c of spec.final) {
    if (c.preset) { g.weather.setPreset(c.preset, 0); window.__clock.step(c.frames || 3, 1 / 60); }
    for (const [k, v] of Object.entries(c.set || {})) { const u = fm[k].value; if (typeof u === 'number') fm[k].value = v; else u.fromArray(v); }
    fm.uRes.value.set(W, H);
    fm.uPxScale.value = 1;
    fm.uGrain.value = 0;   // grain off: see renderSynthetic's tolerance note
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const toScreen = g.post.final.renderToScreen;
    g.post.final.renderToScreen = false;                   // the composer's last pass: draw into our target
    g.post.final.render(r, rt, src);
    g.post.final.renderToScreen = toScreen;
    const uniforms = {};
    for (const [k, x] of Object.entries(fm)) {
      const v = x.value;
      if (typeof v === 'number') uniforms[k] = v;
      else if (v && (v.isVector2 || v.isVector3 || v.isVector4 || v.isColor)) uniforms[k] = v.toArray();
    }
    out.final.push({ name: c.name, uniforms, rgba: readByte(rt) });
    rt.dispose();
  }
  // 4. the PMREM atlas of weather/env.js after a bake, per preset
  for (const p of spec.pmrem) {
    g.weather.setPreset(p, 0);
    g.weather.env.markDirty();
    window.__clock.step(2, 1 / 60);
    const env = g.weather.env, u = env.uniforms;
    out.pmrem.push({
      preset: p, width: env.rt.width, height: env.rt.height, half: readHalf(env.rt),
      uniforms: { uSky: u.uSky.value.toArray(), uFog: u.uFog.value.toArray(), uDeep: u.uDeep.value.toArray(), uSunDir: u.uSunDir.value.toArray(),
        uSunColor: u.uSunColor.value.toArray(), uSunI: u.uSunI.value, uCloud: u.uCloud.value },
    });
  }
  return out;
}

const SYNTH_SPEC = {
  w: SYN_W, h: SYN_H,
  bloom: [
    { name: 'high', strength: 0.3, radius: 0.45, threshold: 0.5, scale: 1 },
    { name: 'medium', strength: 0.6, radius: 0.8, threshold: 1.1, scale: 0.5 },
  ],
  final: [
    ...PRESET_NAMES.map((p) => ({ name: p, preset: p })),
    { name: 'pulses', set: { uFlash: 0.8, uEdge: [0.7, 0.05, 0.08, 0.6], uLetterbox: 0.6, uVortex: 0.5, uCA: 3, uSatMul: 0.4, uBright: 0.8 } },
  ],
  pmrem: ['clearing', 'nightStorm'],
};

async function renderSynthetic(page, base) {
  await page.goto(`${base}/rescue/index.html?only=weather,ocean,post&quality=high&dynres=0&nohud&weather=calm`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.__clock.pending() > 0, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => window.__clock.step(4, 1 / 60));
  const res = await page.evaluate(([fn, spec]) => new Function('return ' + fn)()(spec), [SYNTH.toString(), SYNTH_SPEC]);
  const written = [];
  const W = SYN_W, H = SYN_H;
  const half8 = (half) => { const p = new Uint8Array(W * H * 4); half.forEach((hb, i) => { p[i] = Math.max(0, Math.min(255, Math.round(halfToFloat(hb) * 255))); }); return flipRows(p, W, H); };
  const files = { output: [], bloom: [], final: [], pmrem: [] };
  for (const o of res.output) {
    const f = `synthetic/output_${String(o.exposure).replace('.', '_')}.png`;
    written.push(writeBinary(f, encodePNG(W, H, half8(o.half))));
    files.output.push({ exposure: num(o.exposure), image: f });
  }
  for (const b of res.bloom) {
    const f = `synthetic/bloom_${b.name}.png`;
    written.push(writeBinary(f, encodePNG(W, H, half8(b.half))));
    files.bloom.push({ name: b.name, strength: num(b.strength), radius: num(b.radius), threshold: num(b.threshold), scale: num(b.scale), exposure: 1, image: f });
  }
  for (const c of res.final) {
    const f = `synthetic/final_${c.name}.png`;
    written.push(writeBinary(f, encodePNG(W, H, flipRows(Uint8Array.from(c.rgba), W, H))));
    files.final.push({ name: c.name, image: f, uniforms: JSON.parse(JSON.stringify(c.uniforms, (k, v) => (typeof v === 'number' ? num(v) : v))) });
  }
  for (const p of res.pmrem) {
    const f = `synthetic/pmrem_${p.preset}.png`;
    written.push(writeBinary(f, encodePNG(p.width, p.height, Uint16Array.from(p.half), 16)));   // GL row order, raw half bits
    files.pmrem.push({ preset: p.preset, width: p.width, height: p.height, image: f, uniforms: JSON.parse(JSON.stringify(p.uniforms, (k, v) => (typeof v === 'number' ? num(v) : v))) });
  }
  out('synthetic', 'passes', {
    tolerance: { class: 'image', note: 'output / bloom: max |Δ| ≤ 3/255, mean |Δ| ≤ 0.5/255 (PLAN §5.1 «синтетические входы»); final: the same on ≥ 99 % of the samples (uGrain = 0: hash12 has no sin, but fract() amplifies last-bit multiply-add differences between GPUs, so grain / night chroma noise cannot be bit-identical); pmrem: half-float atlas, |Δ| ≤ 0.02·max(1, |ref|) on ≥ 99 % of the written texels' },
    files: ['rescue/vendor/three/addons/postprocessing/OutputPass.js', 'rescue/vendor/three/addons/postprocessing/UnrealBloomPass.js',
      relSrc('systems/post.js'), relSrc('systems/post/finalShader.js'), relSrc('systems/weather/env.js'), 'rescue/vendor/three (PMREMGenerator)'],
    data: {
      size: [W, H],
      inputs: {
        hdrRamp: '[x / 128, y / 64, ((x·y) mod 97) / 64]',
        spots: 'background [1/16, 1/8, 3/16]; (x − cx)² + (y − cy)² ≤ 36 around (40, 30) → [6, 3, 1.5], (128, 72) → [2, 4, 8], (200, 110) → [5, 5, 5]',
        ldr: '[⌊255x / (W − 1)⌋ / 256, ⌊255y / (H − 1)⌋ / 256, ((x·y + 7x) mod 256) / 256]',
        rows: 'y = GL row (0 = bottom) of the input DataTexture; output PNGs are stored top row first (pmrem: GL row order, 16-bit samples = half-float bits)',
      },
      ...files,
    },
  });
  return written;
}

async function renderFrames({ only }) {
  const { withBrowser } = await import('./lib/browser.mjs');
  const written = [];
  const errs = await withBrowser(async ({ page, base, errors }) => {
    await page.addInitScript(CLOCK_INIT);
    if (!only || only.has('scenes')) {
      const pick = args.scenes ? new Set(String(args.scenes).split(',')) : null;
      for (const sc of SCENES) {
        if (pick && !pick.has(sc.name)) continue;
        const t0 = Date.now();
        const shot = await renderScene(page, base, sc);
        const { w, h } = shot;
        const dir = `scenes/${sc.name}`;
        written.push(writeBinary(`${dir}/final.png`, encodePNG(w, h, flipRows(Uint8Array.from(shot.final), w, h))));
        if (shot.post) {
          const p8 = new Uint8Array(w * h * 4);
          shot.post.forEach((hb, i) => { p8[i] = Math.max(0, Math.min(255, Math.round(halfToFloat(hb) * 255))); });
          written.push(writeBinary(`${dir}/post.png`, encodePNG(w, h, flipRows(p8, w, h))));
        }
        const st = shot.state;
        if (st.frame !== FRAMES + 1 && st.frame !== FRAMES) console.log(`note: ${sc.name} captured at frame ${st.frame}`);
        out('scenes', sc.name, {
          tolerance: { class: 'image', note: 'SSIM ≥ 0.92 on luma vs final.png (and post.png when present), PLAN §5.1 «GPU-кадры, сцены»; plus human side-by-side review (SwiftShader ≠ Apple GPU)' },
          files: [relSrc('systems/ocean.js'), relSrc('systems/ocean/shaders.js'), relSrc('systems/ocean/material.js'), relSrc('systems/weather.js'),
            relSrc('systems/weather/lights.js'), relSrc('systems/weather/env.js'), relSrc('systems/post.js'), relSrc('systems/post/finalShader.js'), relSrc('core/look.js')],
          extra: { url: `?only=weather,ocean${sc.post === false ? '' : ',post'}&quality=${sc.quality}&dynres=0&nohud&weather=${sc.preset}`, viewport: [FRAME_W, FRAME_H] },
          data: { spec: sc, images: { final: `${sc.name}/final.png`, post: shot.post ? `${sc.name}/post.png` : null }, ...JSON.parse(JSON.stringify(st, (k, v) => (typeof v === 'number' ? num(v) : v))) },
        });
        console.log(`scene ${sc.name}: frame ${st.frame}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
    if (!only || only.has('synthetic')) written.push(...(await renderSynthetic(page, base)));
    return errors;
  }, { width: FRAME_W, height: FRAME_H });
  if (errs.length) throw new Error('browser errors:\n  ' + errs.join('\n  '));
  return written;
}

// ======================================================================================== png selftest
// Known patterns for the Swift PNG reader (ImageSupport.swift): every row filter, 8 and 16 bit.
export const pngPattern8 = (x, y, c) => (x * 7 + y * 13 + c * 31 + ((x * y) % 17)) & 0xff;
export const pngPattern16 = (x, y, c) => (x * 1031 + y * 7919 + c * 13 + x * y) & 0xffff;
async function png() {
  const w = 37, h = 23;
  const p8 = new Uint8Array(w * h * 4), p16 = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    p8[(y * w + x) * 4 + c] = pngPattern8(x, y, c);
    p16[(y * w + x) * 4 + c] = pngPattern16(x, y, c);
  }
  results.push(writeBinary('png/selftest8.png', encodePNG(w, h, p8, 8, 'cycle')));
  results.push(writeBinary('png/selftest16.png', encodePNG(w, h, p16, 16, 'cycle')));
}

// ================================================================================================ run
const GROUPS = { sunrig, post: postState, dynres, bloom, env, memory, png };
for (const [name, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.has(name)) continue;
  await fn();
}
if (args.browser) results.push(...(await renderFrames({ only: args.frames ? new Set(String(args.frames).split(',')) : null })));
for (const r of results) console.log(`${r.path}\t${r.bytes}`);
