// export-app: parity traces for the app layer of the native port (Sources/MaydayApp: GameSession, the
// input adapters' event mapping, the touch controls) -> Tests/Vectors/app/*.json.
//
//   app/session_flight.json  main.js boot() + frame() over the REAL systems the M3 app runs — Weather, Ocean,
//                            the stubs.js World, Helicopter, CameraRig — with the REAL core/input.js Input fed
//                            DOM events (keydown / keyup / mousemove / mousedown / mouseup / wheel / blur /
//                            touchstart), virtual (touch) axes and buttons and navigator.getGamepads()
//                            snapshots, the REAL core/settings.js Settings (empty localStorage) and the REAL
//                            core/haptics.js Haptics (vibrationActuator.playEffect recorded). The mission is the
//                            stubs.js Mission (its «Свободный полёт» def, start → briefing, launch → play) with
//                            the run-state rules of systems/mission.js that the app's FreeFlightMission mirrors
//                            (input only while flying, Esc → pause, the rAF pause poll, ui:pause, crash →
//                            CRASH_TO_DEBRIEF_S → a fresh start); it is the one piece written here, line for line
//                            the same as Sources/MaydayApp/Session/FreeFlight.swift.
//                            Per frame: the raw events and pokes (weather.setPreset / spawnGust / strikeLightning,
//                            heli.damage, ui:pause) applied before the frame, realDt, and a probe row of the
//                            heli / camera / rig / weather / ocean / look / input / mission state after it
//                            (ocean._lateUpload() first, as the render would). Every event name and every rumble.
//   app/touch.json           ui/flight/touch.js TouchControls driven through synthetic touch events on its own
//                            elements: the virtual axes, the knob and the thumb offsets after every event.
//
// Same wrapper / number / determinism rules as the other exporters (tools/README.md). Math.random (only the
// heli's cosmetic draws) is re-seeded right after `new Helicopter` and blinkSeed re-drawn, matching
// SimContext.random (export-heli.mjs does the same).
// Usage: node rescue-apple/tools/export/export-app.mjs [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, writeWrapped, writeSidecar, relSrc } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const PRODUCER = 'tools/export/export-app.mjs';
const results = [];
console.warn = () => {};

const THREE = await import('three');
const M = await gameImport('core/math.js');
const { EventBus } = await gameImport('core/events.js');
const { Input } = await gameImport('core/input.js');
const { Settings } = await gameImport('core/settings.js');
const { Look } = await gameImport('core/look.js');
const { Haptics } = await gameImport('core/haptics.js');
const Stubs = await gameImport('core/stubs.js');
const { Weather } = await gameImport('systems/weather.js');
const { Ocean } = await gameImport('systems/ocean.js');
const { Helicopter } = await gameImport('systems/heli.js');
const { CameraRig } = await gameImport('systems/camera.js');
const { TouchControls } = await gameImport('ui/flight/touch.js');
const missionScope = (await gameImport('systems/mission.js')).__scope();
const { PRESET_NAMES } = await gameImport('systems/weather/presets.js');

const BITWISE = { class: 'bitwise', note: 'every probe value Double.bitPattern-equal; event names and rumble requests identical' };
const MODES = ['title', 'briefing', 'play', 'paused', 'debrief'];
const DEVICES = ['keyboard', 'gamepad', 'touch'];
const WINCH = ['stowed', 'lowering', 'down', 'raising'];
const STATES = ['idle', 'briefing', 'play', 'crash'];
const SYSTEMS = ['weather', 'ocean', 'world', 'heli', 'cameraRig', 'mission']; // main.js SYSTEMS order, the ones present
const RUN_WHEN_PAUSED = new Set(['cameraRig', 'audio', 'hud', 'post', 'radio']);
const VIEW = { w: 1280, h: 720 };

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}

// ------------------------------------------------------------------------------- free-flight mission
// stubs.js Mission + the systems/mission.js run-state rules (FreeFlight.swift, same order).
class FreeFlightMission {
  constructor(ctx, crashToRestart) {
    this.ctx = ctx;
    this.base = new Stubs.Mission(ctx);
    this.def = null;
    this.state = 'idle';
    this.elapsed = 0;
    this.crashT = 0;
    this.crashToRestart = crashToRestart;
    this.pausePolling = false;
    this._pausedFrame = -1;
    ctx.events.on('ui:pause', () => this.pause());
    ctx.events.on('ui:resume', () => this.resume());
    ctx.events.on('heli:crash', () => {
      if (this.state !== 'play') return;
      this.state = 'crash';
      this.crashT = 0;
      ctx.input.enabled = false;
    });
  }
  get areaRadius() { return this.def?.area?.radius; }
  init() { this.begin(); this.launch(); }
  begin() {
    this.pausePolling = false;
    this.state = 'briefing';
    this.elapsed = 0;
    this.crashT = 0;
    // stubs.js Mission.start(): the def, mission:setup (its setMode('briefing') is _setMode below)
    const emit = this.ctx.events.emit.bind(this.ctx.events);
    const setMode = this.ctx.setMode;
    this.ctx.setMode = () => {};
    this.ctx.events.emit = (name, p) => { if (name === 'mission:setup') this.def = p.def; emit(name, p); };
    this.base.start(0);
    this.ctx.events.emit = emit;
    this.ctx.setMode = setMode;
    this._setMode('briefing');
  }
  launch() {
    if (this.state !== 'briefing') return;
    this.elapsed = 0;
    this.state = 'play';
    this._setMode('play');
  }
  _setMode(mode) {
    const ctx = this.ctx;
    ctx.setMode(mode);
    ctx.input.enabled = mode === 'play' && this.state === 'play';
    const cam = mode === 'play' ? 'follow' : mode === 'debrief' ? 'cinematic' : mode === 'paused' ? null : 'attract';
    const rig = ctx.cameraRig;
    if (cam && rig && rig.mode !== cam) rig.setMode(cam);
  }
  pause() {
    const ctx = this.ctx;
    if (ctx.mode !== 'play' || this.state !== 'play') return;
    this._pausedFrame = ctx.time.frame;
    this._setMode('paused');
    this.pausePolling = true;
  }
  resume() {
    const ctx = this.ctx;
    if (ctx.mode !== 'paused') return;
    if (ctx.time.frame === this._pausedFrame) return;
    this.pausePolling = false;
    this._setMode('play');
  }
  // the rAF tick (runs ahead of the next main frame)
  pollWhilePaused() {
    if (!this.pausePolling) return;
    this.pausePolling = false;
    const ctx = this.ctx;
    if (ctx.mode !== 'paused') return;
    if (ctx.input.rawPressed('pause')) this.resume();
    if (ctx.mode === 'paused') this.pausePolling = true;
  }
  update(dt) {
    const ctx = this.ctx;
    const realDt = ctx.time.realDt || 0;
    if (ctx.mode === 'play') {
      if (this.state === 'play') this._updatePlay(dt);
      else if (this.state === 'crash') {
        this.crashT += realDt;
        if (this.crashT >= this.crashToRestart) { this.begin(); this.launch(); }
      }
    }
    const want = ctx.mode === 'play' && this.state === 'play';
    if (ctx.input.enabled !== want) ctx.input.enabled = want;
  }
  _updatePlay(dt) {
    if (this.ctx.input.rawPressed('pause')) { this.pause(); return; }
    if (!(dt > 0)) return;
    this.elapsed += dt;
  }
}

// --------------------------------------------------------------------------------------------- session
function sessionRun() {
  // DOM listener capture: Input registers on the target and on window
  const listeners = {};
  const capture = (type, fn) => { (listeners[type] ||= []).push(fn); };
  const prevAdd = globalThis.addEventListener;
  globalThis.addEventListener = capture;
  const target = { addEventListener: capture, removeEventListener() {} };
  const fire = (type, e) => { for (const fn of listeners[type] || []) fn(e); };

  const clock = { realT: 0 };
  performance.now = () => clock.realT * 1000;
  let pads = [];
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => pads, configurable: true, writable: true });
  try { globalThis.localStorage.clear(); } catch {}

  // ---- boot (main.js) --------------------------------------------------------------------------------
  const settings = new Settings();
  const renderer = {
    toneMappingExposure: 1, autoClear: true, domElement: { clientWidth: VIEW.w, clientHeight: VIEW.h, addEventListener() {} },
    extensions: { has: (e) => e === 'EXT_color_buffer_float' || e === 'EXT_color_buffer_half_float' },
    getRenderTarget: () => null, setRenderTarget() {}, getClearAlpha: () => 1, getClearColor: (c) => c, setClearColor() {},
    clear() {}, render() {}, getPixelRatio: () => 1,
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, VIEW.w / VIEW.h, 2, 1200);
  camera.position.set(0, 220, 60);
  camera.lookAt(0, 0, 0);
  const look = new Look(7);
  const ctx = {
    THREE, look, renderer, scene, camera, settings, events: new EventBus(), input: new Input(target),
    rng: M.createRng(1337), noise: M.createNoise2D(1337), time: { t: 0, dt: 0, realT: 0, realDt: 0, frame: 0 },
    mode: 'title', timeScale: 1, debug: false, params: new URLSearchParams(''),
    setMode(mode) {
      if (ctx.mode === mode) return;
      const from = ctx.mode;
      ctx.mode = mode;
      ctx.events.emit('game:mode', { from, to: mode });
    },
  };
  globalThis.addEventListener = prevAdd;
  const evLog = [];
  const emit0 = ctx.events.emit.bind(ctx.events);
  ctx.events.emit = (name, p) => { evLog.push([ctx.time.frame, name]); emit0(name, p); };

  ctx.weather = new Weather(ctx);
  ctx.weather.env.init = function () { this.pmrem = { fromScene: () => ({ texture: { isTexture: true }, dispose() {} }) }; };
  ctx.ocean = new Ocean(ctx);
  ctx.world = new Stubs.World(ctx);
  // three.js draws Math.random for the uuid of every object the stub World builds on mission:setup; those
  // draws stay off the heli's cosmetic stream (the Swift World builds no three objects)
  const setupWorld = ctx.world._setup.bind(ctx.world);
  const uuidRng = M.createRng(4711);
  ctx.world._setup = (def) => {
    const r = Math.random;
    Math.random = () => uuidRng.next();
    try { setupWorld(def); } finally { Math.random = r; }
  };
  ctx.heli = new Helicopter(ctx);
  const rng = M.createRng(SEED);
  Math.random = () => rng.next();
  ctx.heli.lightsCtl.blinkSeed = Math.random() * 10;
  ctx.cameraRig = new CameraRig(ctx);
  ctx.mission = new FreeFlightMission(ctx, missionScope.CRASH_TO_DEBRIEF_S);
  // init() in SYSTEMS order
  for (const key of SYSTEMS) ctx[key].init?.();
  const rumbles = [];
  ctx.haptics = new Haptics(ctx);
  ctx.events.emit('game:ready', {});
  const setup = {
    seed: SEED, viewport: [VIEW.w, VIEW.h],
    def: ctx.mission.def,
    pads: ctx.world.pads.map((p) => ({ id: p.id, name: p.name, type: p.type, position: [p.position.x, p.position.y, p.position.z], radius: p.radius,
      refuel: p.refuel, heading: p.heading, object: [p.object3d.position.x, p.object3d.position.y, p.object3d.position.z] })),
    settings: { ...settings.values },
    presets: PRESET_NAMES,
  };

  // ---- the script ---------------------------------------------------------------------------------------
  const FRAMES = 2700;
  const h = ctx.heli;
  const actions = new Map(); // frame → [[kind, ...]] (raw events and pokes, in order)
  const at = (f, ...a) => { if (!actions.has(f)) actions.set(f, []); actions.get(f).push(a); };
  const key = (f, code, down, repeat = false) => at(f, 'key', code, down ? 1 : 0, repeat ? 1 : 0);
  key(20, 'Digit2', true); key(22, 'Digit2', false);
  at(40, 'preset', 'overcast', 8);
  key(80, 'KeyE', true); key(100, 'KeyE', true, true); key(110, 'KeyE', false);
  key(150, 'Digit3', true); key(152, 'Digit3', false);
  key(160, 'KeyW', true); key(160, 'KeyD', true); key(260, 'ShiftLeft', true); key(300, 'ShiftLeft', false); key(330, 'KeyD', false); key(400, 'KeyW', false);
  for (let f = 410; f <= 520; f += 2) at(f, 'mouse', Math.fround(640 + 300 * Math.sin(f * 0.05)), Math.fround(360 + 150 * Math.cos(f * 0.04)));
  at(430, 'button', 0, 1); at(434, 'button', 0, 0);
  key(450, 'KeyL', true); key(453, 'KeyL', false);
  for (const f of [470, 474, 478]) at(f, 'wheel', 100);
  for (const f of [490, 494]) at(f, 'wheel', -100);
  at(500, 'button', 2, 1); at(503, 'button', 2, 0);
  key(530, 'Space', true); key(600, 'Space', false);
  key(610, 'Escape', true); key(612, 'Escape', false); key(640, 'Escape', true); key(642, 'Escape', false);
  key(650, 'KeyA', true); at(655, 'blur'); key(660, 'KeyA', false);
  at(720, 'gust', 10, 1.5);
  at(760, 'strike', 80, 0);
  at(870, 'touch');
  at(872, 'vaxis', 'moveX', -0.5); at(872, 'vaxis', 'moveY', -0.625);
  at(880, 'vaxis', 'lift', -0.375); at(900, 'vaxis', 'lift', 0);
  at(910, 'vbutton', 'winch', 1); at(930, 'vbutton', 'winch', 0);
  at(935, 'vaxis', 'moveX', 0); at(935, 'vaxis', 'moveY', 0);
  at(940, 'uiPause');
  key(960, 'Escape', true); key(962, 'Escape', false);
  // gamepad phase: a W3C standard pad, 670 … 860
  const padAt = (f) => {
    if (f < 670 || f > 860) return null;
    const b = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const ax = [0, 0, 0, 0];
    if (f >= 680 && f < 760) { ax[0] = 0.75; ax[1] = -0.5; }
    if (f >= 700 && f < 730) b[7] = { pressed: true, value: 0.875 };
    if (f >= 770 && f < 790) b[0] = { pressed: true, value: 1 };
    if (f >= 800 && f < 803) b[2] = { pressed: true, value: 1 };
    if (f >= 820 && f < 850) { ax[2] = 0.5; ax[3] = 0.25; } // aim stick
    return { buttons: b, axes: ax };
  };
  const dtAt = (f) => (f === 333 ? 0.25 : f % 97 === 0 ? 1 / 30 : 1 / 60 + 0.0015 * Math.sin(f * 1.7));

  // closed loop after the touch phase: fly back to the pad (velocity targets toward the origin, keyboard),
  // descend and land; a minute later two hull hits (the first is halved) crash it on the deck, and the
  // free flight restarts CRASH_TO_DEBRIEF_S after heli:crash
  const held = new Set();
  const want = (f, code, on) => {
    if (on && !held.has(code)) { held.add(code); key(f, code, true); }
    if (!on && held.has(code)) { held.delete(code); key(f, code, false); }
  };
  let landedAt = -1;
  let hits = 0;
  const pilot = (f) => {
    if (f < 980) return;
    if (h.landed || !h.alive || ctx.mission.state !== 'play') {
      for (const c of [...held]) want(f, c, false);
      if (h.landed && landedAt < 0) landedAt = f;
      if (landedAt > 0 && hits < 2 && f >= landedAt + 60 + 30 * hits) { at(f, 'damage', 1.2, 'test'); hits++; }
      return;
    }
    const dx = -h.position.x, dz = -h.position.z;
    const vx = h.velocity.x, vz = h.velocity.z;
    const tx = Math.max(-16, Math.min(16, dx * 0.4)), tz = Math.max(-16, Math.min(16, dz * 0.4));
    want(f, 'KeyD', vx < tx - 1); want(f, 'KeyA', vx > tx + 1);
    want(f, 'KeyS', vz < tz - 1); want(f, 'KeyW', vz > tz + 1); // +z = south (moveY −1)
    const over = Math.hypot(dx, dz) < 6 && Math.hypot(vx, vz) < 2.5;
    want(f, 'Digit1', Math.hypot(dx, dz) < 30 && h.altTarget > 15.5 && !held.has('Digit1'));
    want(f, 'KeyQ', over && h.altitude < 18);
  };

  // ---- run ------------------------------------------------------------------------------------------------
  const order = SYSTEMS;
  const rows = [];
  const realDts = [];
  const applied = [];
  const padRows = [];
  for (let f = 1; f <= FRAMES; f++) {
    pilot(f);
    // raw events and pokes before the frame
    for (const a of actions.get(f) || []) {
      applied.push([f, ...a]);
      const [kind] = a;
      switch (kind) {
        case 'key': fire(a[2] ? 'keydown' : 'keyup', { code: a[1], repeat: !!a[3], target: { tagName: 'BODY' }, preventDefault() {} }); break;
        case 'mouse': fire('mousemove', { clientX: a[1], clientY: a[2] }); break;
        case 'button': fire(a[2] ? 'mousedown' : 'mouseup', { button: a[1], target: { tagName: 'CANVAS', closest: (s) => (s === '#game' ? {} : null) } }); break;
        case 'wheel': fire('wheel', { deltaY: a[1] }); break;
        case 'blur': fire('blur', {}); break;
        case 'touch': fire('touchstart', {}); break;
        case 'vaxis': ctx.input.setVirtualAxis(a[1], a[2]); break;
        case 'vbutton': ctx.input.setVirtualButton(a[1], !!a[2]); break;
        case 'uiPause': ctx.events.emit('ui:pause', {}); break;
        case 'preset': ctx.weather.setPreset(a[1], a[2]); break;
        case 'gust': ctx.weather.spawnGust({ strength: a[1], eta: a[2] }); break;
        case 'strike': {
          // absolute position recorded (the Swift side replays the numbers)
          const x = h.position.x + a[1], z = h.position.z + a[2];
          applied[applied.length - 1] = [f, 'strike', x, z];
          ctx.weather.strikeLightning(x, z, {});
          break;
        }
        case 'damage': h.damage(a[1], a[2]); break;
        default: throw new Error('unknown action ' + kind);
      }
    }
    const p = padAt(f);
    pads = p ? [{ connected: true, buttons: p.buttons, axes: p.axes, vibrationActuator: { playEffect: (type, o) => { rumbles.push([ctx.time.frame, type, o.duration, o.strongMagnitude, o.weakMagnitude]); return Promise.resolve(); } } }] : [];
    if (p) padRows.push(f, ...p.buttons.map((b) => b.value), ...p.buttons.map((b) => (b.pressed ? 1 : 0)), ...p.axes);
    // the mission's rAF pause poll, then main.js frame()
    ctx.mission.pollWhilePaused();
    const realDt = Math.min(dtAt(f), 0.1);
    realDts.push(dtAt(f));
    const paused = ctx.mode === 'paused';
    const dt = paused ? 0 : realDt * ctx.timeScale;
    ctx.time.realDt = realDt; ctx.time.realT += realDt; ctx.time.dt = dt; ctx.time.t += dt; ctx.time.frame++;
    clock.realT = ctx.time.realT;
    look.setTime(ctx.time.t);
    ctx.input.poll();
    for (const k of order) {
      const sys = ctx[k];
      if (!sys.update) continue;
      if (paused && !RUN_WHEN_PAUSED.has(k)) continue;
      sys.update(RUN_WHEN_PAUSED.has(k) ? realDt : dt);
    }
    ctx.ocean._lateUpload(); // the render: Mesh.onBeforeRender
    rows.push(...probe(ctx));
  }
  if (rows.length !== FRAMES * PROBE.length) throw new Error('probe length');
  return { setup, rows, realDts, applied, padRows, evLog, rumbles, frames: FRAMES };
}

// The probe row: [name, getter(ctx)] (numbers; booleans 0/1; enums by index; null pad → −1).
const v3 = (n, g) => [[n + 'X', (c) => g(c).x], [n + 'Y', (c) => g(c).y], [n + 'Z', (c) => g(c).z]];
const v2 = (n, g) => [[n + 'X', (c) => g(c).x], [n + 'Y', (c) => g(c).y]];
const v4 = (n, g) => [[n + 'X', (c) => g(c).x], [n + 'Y', (c) => g(c).y], [n + 'Z', (c) => g(c).z], [n + 'W', (c) => g(c).w]];
const b = (x) => (x ? 1 : 0);
const PROBE = [
  ['mode', (c) => MODES.indexOf(c.mode)], ['t', (c) => c.time.t], ['realT', (c) => c.time.realT], ['timeScale', (c) => c.timeScale],
  ...v3('heliPos', (c) => c.heli.position), ...v3('heliVel', (c) => c.heli.velocity),
  ['heading', (c) => c.heli.heading], ['altitude', (c) => c.heli.altitude], ['altTarget', (c) => c.heli.altTarget], ['fuel', (c) => c.heli.fuel],
  ['hull', (c) => c.heli.hull], ['rotorRPM', (c) => c.heli.rotorRPM], ['bank', (c) => c.heli.bank], ['pitch', (c) => c.heli.pitch],
  ['landed', (c) => (c.heli.landed ? c.world.pads.indexOf(c.heli.landed) : -1)], ['alive', (c) => b(c.heli.alive)], ['searchlight', (c) => b(c.heli.searchlight)],
  ['boosting', (c) => b(c.heli.boosting)], ['flares', (c) => c.heli.flares], ['rafts', (c) => c.heli.rafts],
  ['winchState', (c) => WINCH.indexOf(c.heli.winch.state)], ['winchLength', (c) => c.heli.winch.length], ...v3('aim', (c) => c.heli.aim),
  ...v3('camPos', (c) => c.camera.position), ...v4('camQuat', (c) => c.camera.quaternion), ['camFov', (c) => c.camera.fov],
  ['rigHeight', (c) => c.cameraRig.height], ['rigTilt', (c) => c.cameraRig.tiltDeg], ['rigLetterbox', (c) => c.cameraRig.letterbox], ['rigZoom', (c) => c.cameraRig.zoom],
  ['rigMode', (c) => ['follow', 'attract', 'cinematic'].indexOf(c.cameraRig.mode)],
  ['windSpeed', (c) => c.weather.state.windSpeed], ...v2('windDir', (c) => c.weather.state.windDir), ['weatherClock', (c) => c.weather.clock],
  ['flash', (c) => c.weather.state.flash], ['preset', (c) => PRESET_NAMES.indexOf(c.weather.state.preset)], ...v3('sunDir', (c) => c.weather.state.sunDir),
  ...v2('oceanOffset', (c) => c.ocean.uniforms.uOffset.value), ['hsEff', (c) => c.ocean.uniforms.uHsEff.value], ...v2('focus', (c) => c.ocean.focus),
  ...v4('heliP', (c) => c.ocean.uniforms.uHeliP.value), ...v4('downwash', (c) => c.ocean.uniforms.uDownwash.value), ['searchI', (c) => c.ocean.uniforms.uSearchI.value],
  ['splashCount', (c) => c.ocean.uniforms.uSplashCount.value],
  ...v2('windOffset', (c) => c.look.uniforms.uWindOffset.value), ['lookTime', (c) => c.look.uniforms.uTime.value],
  ['axMoveX', (c) => c.input.axesValues.moveX], ['axMoveY', (c) => c.input.axesValues.moveY], ['axLift', (c) => c.input.axesValues.lift],
  ['axAimX', (c) => c.input.axesValues.aimX], ['axAimY', (c) => c.input.axesValues.aimY],
  ['lastDevice', (c) => DEVICES.indexOf(c.input.lastDevice)], ['inputEnabled', (c) => b(c.input.enabled)],
  ['missionState', (c) => STATES.indexOf(c.mission.state)], ['elapsed', (c) => c.mission.elapsed],
];
const probe = (c) => PROBE.map(([, g]) => g(c));
const SEED = 20261016;

// ----------------------------------------------------------------------------------------------- touch
function touchRun() {
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const add0 = proto.addEventListener;
  proto.addEventListener = function (type, fn) { ((this._ls ||= {})[type] ||= []).push(fn); };
  const input = new Input({ addEventListener() {}, removeEventListener() {} });
  const hud = { ctx: { input, mode: 'play' }, root: document.createElement('div'), emit: (n) => steps.push(['emit', n]) };
  const steps = [];
  const tc = new TouchControls(hud);
  proto.addEventListener = add0;
  const SL = { top: 300, height: 220 };
  tc.slider.getBoundingClientRect = () => ({ top: SL.top, height: SL.height, left: 1000, width: 44, bottom: SL.top + SL.height, right: 1044, x: 1000, y: SL.top });
  const ev = (touches) => ({ preventDefault() {}, stopPropagation() {}, changedTouches: touches.map(([id, x, y]) => ({ identifier: id, clientX: x, clientY: y })) });
  const send = (node, type, touches) => { for (const fn of node._ls?.[type] || []) fn(ev(touches)); };
  const num2 = (s) => (s ? (s.match(/-?[\d.e+-]+(?=px)/g) || []).map(Number) : []);
  const record = (what, touches) => {
    steps.push([what, touches.map((t) => t.map(num)), [num(input.virtualAxes.moveX ?? 0), num(input.virtualAxes.moveY ?? 0), num(input.virtualAxes.lift ?? 0)],
      num2(tc.knob.style.transform).map(num), num2(tc.thumb.style.transform).map(num)]);
  };
  // stick: start, a path inside / outside the radius, end
  send(tc.stickZone, 'touchstart', [[1, 200, 500]]); record('stickStart', [[1, 200, 500]]);
  const path = [[1, 230, 480], [1, 200, 436], [1, 300, 500], [1, 150, 600], [1, 245.5, 455.25], [1, 200, 500], [1, 201, 499], [2, 50, 50]];
  for (const t of path) { send(tc.stickZone, 'touchmove', [t]); record('stickMove', [t]); }
  send(tc.stickZone, 'touchend', [[1, 0, 0]]); record('stickEnd', [[1, 0, 0]]);
  // slider: start inside the dead zone, then up, down, past both ends, a foreign finger, end
  const sy = [410, 399, 380, 300.5, 250, 470, 520, 600, 411];
  send(tc.slider, 'touchstart', [[5, 1020, sy[0]]]); record('sliderStart', [[5, 1020, sy[0]]]);
  for (const y of sy.slice(1)) { send(tc.slider, 'touchmove', [[5, 1020, y]]); record('sliderMove', [[5, 1020, y]]); }
  send(tc.slider, 'touchmove', [[6, 1020, 300]]); record('sliderForeign', [[6, 1020, 300]]);
  send(tc.slider, 'touchend', [[5, 0, 0]]); record('sliderEnd', [[5, 0, 0]]);
  return { stickRadius: 64, slider: SL, steps };
}

// ------------------------------------------------------------------------------------------------- main
const files = ['main.js', 'core/input.js', 'core/settings.js', 'core/haptics.js', 'core/stubs.js', 'core/look.js', 'systems/weather.js',
  'systems/ocean.js', 'systems/heli.js', 'systems/camera.js', 'systems/mission.js'].map(relSrc);
{
  const r = sessionRun();
  const dir = path.join(OUT, 'app');
  const side = (name, typed) => writeSidecar(path.join(dir, name), typed);
  out('app', 'session_flight', {
    files, tolerance: BITWISE,
    data: {
      setup: r.setup, frames: r.frames, probeFields: PROBE.map(([n]) => n),
      probe: side('session_flight_probe.f64', new Float64Array(r.rows)),
      realDt: side('session_flight_realdt.f64', new Float64Array(r.realDts)),
      pad: side('session_flight_pad.f64', new Float64Array(r.padRows)),
      padFields: ['frame', ...Array.from({ length: 17 }, (_, i) => 'value' + i), ...Array.from({ length: 17 }, (_, i) => 'pressed' + i), 'ax0', 'ax1', 'ax2', 'ax3'],
      actions: r.applied.map((a) => a.map((v) => (typeof v === 'number' ? num(v) : v))),
      events: r.evLog,
      rumbles: r.rumbles.map((a) => a.map((v) => (typeof v === 'number' ? num(v) : v))),
    },
  });
  const last = r.rows.slice(-PROBE.length);
  console.log(`app/session_flight: ${r.frames} frames, ${r.evLog.length} events, ${r.rumbles.length} rumbles, heli at`,
    last.slice(4, 7).map((v) => v.toFixed(1)).join(', '), 'mode', MODES[last[0]]);
}
{
  const r = touchRun();
  out('app', 'touch', { files: ['ui/flight/touch.js'].map(relSrc), tolerance: BITWISE, data: r });
}
for (const r of results) console.log(`  ${r.path}  ${r.bytes} B`);
