// export-heli: parity traces of the REAL web Helicopter (systems/heli.js + heli/*) and CameraRig
// (systems/camera.js + camera/*) run in Node 22 on stub systems -> Tests/Vectors/{heli,camera}/*.json.
//
//   heli/heli_<scenario>.json   Helicopter.update + CameraRig.update per frame on scripted input: flight,
//                               winch (cable Float32), ops, searchlight, lights, crewman, visual state,
//                               rig / camera; every event, fx and ocean call, the lamp glints
//   camera/rig_<scenario>.json  the same runner on camera-centred scripts (attract, briefing, cinematic,
//                               photo-mode free camera)
//   camera/projection.json      worldToScreen / screenToWater (three GL conventions) for fixed camera poses
//   camera/shake.json           CameraMotion alone: drift, trauma, floor, gust push
//
// The stubs are deliberately simple and fully described in each file's `setup` (the Swift tests build the
// same stubs): ocean = real WaveBank, weather = analytic wind + scripted state, world = pads / obstacles /
// floaters moving linearly, survivors = groups with linear drift and a nearest-pickable rule, hazards =
// one downdraft / vortex / rogue lift / debris script. Inputs are produced by closed-loop "pilots" here and
// RECORDED per frame, so the Swift side only replays them. Math.random is re-seeded (createRng) right
// after `new Helicopter` and blinkSeed re-drawn, matching SimContext.random.
//
// Same wrapper / number / determinism rules as export-vectors.mjs (tools/README.md).
// Usage: node rescue-apple/tools/export/export-heli.mjs [--only heli,camera] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, writeWrapped, writeSidecar, relSrc } from './lib/common.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const PRODUCER = 'tools/export/export-heli.mjs';
const results = [];
console.warn = () => {};

const THREE = await import('three');
const M = await gameImport('core/math.js');
const { Look } = await gameImport('core/look.js');
const { EventBus } = await gameImport('core/events.js');
const { Helicopter } = await gameImport('systems/heli.js');
const { CameraRig } = await gameImport('systems/camera.js');
const { CameraMotion } = await gameImport('systems/camera/shake.js');
const Wv = await gameImport('systems/ocean/waves.js');

const FILES = ['systems/heli.js', 'systems/heli/flight.js', 'systems/heli/ops.js', 'systems/heli/winch.js', 'systems/heli/searchlight.js',
  'systems/heli/lights.js', 'systems/heli/crewman.js', 'systems/heli/model.js', 'systems/camera.js', 'systems/camera/shake.js',
  'systems/camera/freecam.js', 'systems/ocean/waves.js', 'core/math.js'].map(relSrc);
const CHAOS = { class: 'chaos', note: 'every recorded row bitwise (PLAN §5.1 chaos class: the first 600 steps must be bitwise; these runs stay bitwise throughout); events / fx / ocean calls identical' };
const BITWISE = { class: 'bitwise', note: 'compare Double.bitPattern; report index, both values and ulp distance on mismatch' };

function out(domain, name, { files, tolerance, data }) {
  const r = writeWrapped(path.join(OUT, domain, `${name}.json`), {
    schema: `mayday.vectors.${domain}.${name}`, version: 1, files, producer: PRODUCER, extra: { tolerance }, data,
  });
  if (r.bytes > 1024 * 1024) throw new Error(`${r.path} is ${r.bytes} bytes (> 1 MB budget)`);
  results.push(r);
}
const sidecar = (domain, name, typed, shape) => writeSidecar(path.join(OUT, domain, name), typed, shape);

// ------------------------------------------------------------------------------------------ constants
const MODES = ['title', 'briefing', 'play', 'paused', 'debrief'];
const DEVICES = ['keyboard', 'gamepad', 'touch'];
const ACTIONS = ['winch', 'boost', 'searchlight', 'flare', 'raftDrop', 'horn', 'altPreset1', 'altPreset2', 'altPreset3', 'altUp', 'altDown', 'zoom'];
const WINCH_STATES = ['stowed', 'lowering', 'down', 'raising'];
const AIM_SOURCES = ['mouse', 'stick', 'touch', 'nose'];
const DENIED = [null, 'high', 'fast', 'landed'];
// Scripted per-frame inputs. Every value is a float32 (Math.fround before it reaches the game), so the
// sidecar is f32 and exact; realDt goes in its own f64 column. Derived, not stored: nowMs = realT·1000
// (realT = Σ realDt), mouse.x = (ndcX + 1)·640, mouse.y = (1 − ndcY)·360, lastMoveT = nowMs on mouseMoved frames.
const INPUT_FIELDS = ['mode', 'moveX', 'moveY', 'lift', 'aimX', 'aimY', 'wheel', 'device', 'mouseActive', 'mouseNdcX', 'mouseNdcY', 'mouseMoved',
  'down', 'pressed', 'photo', 'photoWheel', 'mouseButtons', 'shift', 'padLB', 'padRB', 'axMoveX', 'axMoveY',
  'axAimX', 'axAimY', 'axLift', 'turbulence', 'rain', 'fog', 'intensity', 'night', 'flash', 'stElmo'];
const q32 = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = typeof v === 'number' ? Math.fround(v) : v; return r; };

// ------------------------------------------------------------------------------------------- stubs
// world: pads (optionally moving / turning / tilting), obstacles, floaters (moving), lighthouse.
function makeWorld(def) {
  const pads = (def.pads || []).map((p) => ({
    type: p.type, position: new THREE.Vector3(...p.position), radius: p.radius, heading: p.heading || 0, tilt: 0,
    velocity: p.velocity ? new THREE.Vector3(...p.velocity) : null, services: p.services, refuel: !!p.refuel,
    object3d: p.tiltAmp !== undefined ? { matrixWorld: new THREE.Matrix4() } : undefined,
    _yawRate: p.yawRate || 0, _tiltAmp: p.tiltAmp || 0, _tiltFreq: p.tiltFreq || 0,
  }));
  const floaters = (def.floaters || []).map((f, i) => ({ id: i, shape: f.shape, x: f.x, z: f.z, vx: f.vx || 0, vz: f.vz || 0, moored: !!f.moored }));
  const world = {
    pads,
    obstacles: (def.obstacles || []).map((o) => ({ ...o })),
    floaters: { items: floaters },
    lighthouse: def.lighthouse ? { x: def.lighthouse[0], z: def.lighthouse[1] } : undefined,
    padAt: (x, z) => pads.find((p) => Math.hypot(x - p.position.x, z - p.position.z) < p.radius) || null,
    nearestPad: (x, z) => {
      let best = null, bd = Infinity;
      for (const p of pads) { const d = Math.hypot(p.position.x - x, p.position.z - z); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    deckAt: () => -Infinity,
    advance(dt, t) {
      for (const p of pads) {
        if (p.velocity) { p.position.x += p.velocity.x * dt; p.position.y += p.velocity.y * dt; p.position.z += p.velocity.z * dt; }
        p.heading += p._yawRate * dt;
        if (p.object3d) { p.tilt = p._tiltAmp * Math.sin(p._tiltFreq * t); p.object3d.matrixWorld.makeRotationX(p.tilt); }
      }
      for (const f of floaters) { f.x += f.vx * dt; f.z += f.vz * dt; }
    },
  };
  return world;
}

// survivors: groups drifting linearly; nearestFor = nearest pickable group (remaining > 0, not rescued /
// winching / hidden) with d ≤ r; boardOne hands out person records {id = 100·group + n}.
function makeSurvivors(def) {
  const list = (def || []).map((g) => ({
    id: g.id, type: g.type, position: new THREE.Vector3(...g.position), velocity: g.velocity ? new THREE.Vector3(...g.velocity) : null,
    height: g.height, remaining: g.remaining, state: g.state || 'drifting', spotted: !!g.spotted, boarded: 0,
  }));
  return {
    list,
    log: [],
    nearestFor(x, z, r) {
      let best = null, bd = Infinity;
      for (const s of list) {
        if (!(s.remaining > 0) || s.state === 'rescued' || s.state === 'winching' || s.state === 'hidden') continue;
        const d = Math.hypot(s.position.x - x, s.position.z - z);
        if (d <= r && d < bd) { bd = d; best = s; }
      }
      return best;
    },
    attachToBasket(s) { s.state = 'winching'; },
    detachFromBasket(s, opts) { s.state = 'drifting'; },
    boardOne(s) {
      s.remaining -= 1;
      s.boarded += 1;
      s.state = s.remaining > 0 ? 'drifting' : 'rescued';
      return { id: 100 * s.id + s.boarded, name: `Person ${s.id}-${s.boarded}`, age: 30 + s.boarded, condition: s.type === 'injured' ? 'тяжёлое' : 'стабильное' };
    },
    deckAt: () => -Infinity,
    advance(dt) {
      for (const s of list) {
        if (s.state === 'winching' || s.state === 'rescued' || !s.velocity) continue;
        s.position.x += s.velocity.x * dt;
        s.position.z += s.velocity.z * dt;
      }
    },
  };
}

// hazards: a downdraft disc (forceAt), vortices (list), a rogue-lift window (waveLiftAt), debris moving
// linearly, an imminent window.
function makeHazards(def, clock) {
  if (!def) return undefined;
  const debris = {};
  for (const [kind, arr] of Object.entries(def.debris || {})) debris[kind] = arr.map((d) => ({ kind, x: d.x, y: d.y, z: d.z, vx: d.vx || 0, vz: d.vz || 0 }));
  const list = (def.vortices || []).map((v) => ({ type: v.type, position: new THREE.Vector3(...v.position), coreRadius: v.core, stage: v.stage }));
  const hz = {
    list,
    debris: { items: debris },
    forceAt(x, z, alt, outV) {
      const dd = def.downdraft;
      if (!dd) return outV;
      const d = Math.hypot(x - dd.x, z - dd.z);
      if (d < dd.r) { const k = 1 - d / dd.r; outV.set(dd.push[0] * k, -dd.s * k, dd.push[1] * k); }
      return outV;
    },
    rogueOn: false,
    waveLiftAt(x, z) {
      const rg = def.rogue;
      if (!rg) return 0;
      if (rg.t0 !== undefined ? clock.t < rg.t0 || clock.t > rg.t1 : !hz.rogueOn) return 0;
      const d = Math.hypot(x - rg.x, z - rg.z);
      return d < rg.r ? rg.h * (1 - d / rg.r) : 0;
    },
    get imminent() {
      const im = def.imminent;
      if (!im || clock.t < im.t0 || clock.t > im.t1) return null;
      return { type: im.type, position: new THREE.Vector3(...im.position), eta: im.eta };
    },
    advance(dt) { for (const arr of Object.values(debris)) for (const d of arr) { d.x += d.vx * dt; d.z += d.vz * dt; } },
  };
  return hz;
}

// ------------------------------------------------------------------------------------------- runner
// sc: { id, seed, frames, every, dt(frame), sea, wind: {base, amp}, weather(frame, t) -> state numbers,
//       env: {sunDir, sunDirShadow, palette}, settings, detail, world, survivors, hazards, mission,
//       autostart, pilot(frame, ctx, h, rig) -> input, pokes: {frame: [..]} }
function run(sc) {
  const clock = { t: 0, realT: 0, frame: 0 };
  const look = new Look(7);
  look.cloudAt = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.01) * Math.cos(z * 0.013);
  const events = new EventBus();
  const bank = new Wv.WaveBank();
  bank.setQuality(8, 300);
  bank.setSeed(303, 0.6);
  const world = makeWorld(sc.world || {});
  const survivors = makeSurvivors(sc.survivors);
  const hazards = makeHazards(sc.hazards, clock);
  const fxLog = [];
  const oceanLog = [];
  const glints = [];
  let frameGlints = [];
  const fx = {
    spray: (x, z, dir, count) => fxLog.push([clock.frame, 'spray', num(x), num(z), num(dir.x), num(dir.y), num(count)]),
    smoke: (x, y, z, color, size) => fxLog.push([clock.frame, 'smoke', num(x), num(y), num(z), color, num(size)]),
    sparks: (x, y, z, color, count) => fxLog.push([clock.frame, 'sparks', num(x), num(y), num(z), color, num(count)]),
    splash: (x, y, z, size) => fxLog.push([clock.frame, 'splash', num(x), num(y), num(z), num(size)]),
    flare: (x, z) => fxLog.push([clock.frame, 'flare', num(x), num(z)]),
    burst: (kind, at, opts) => fxLog.push([clock.frame, 'burst', kind, num(at.x), num(at.y), num(at.z), opts?.color ?? null]),
  };
  const lastDw = [0, 0, 0, 0];
  const lastSl = [0, 0, 0, 0, 0, 0, 0, 0];
  const ocean = {
    heightAt: (x, z) => bank.heightAt(x, z),
    normalAt: (x, z, o) => bank.normalAt(x, z, o),
    splash: (x, z, r, s) => oceanLog.push([clock.frame, 'splash', num(x), num(z), num(r), num(s)]),
    setDownwash: (x, z, r, s) => { lastDw[0] = x; lastDw[1] = z; lastDw[2] = r; lastDw[3] = s; },
    setSearchlight: (o, d, c, l) => { lastSl.splice(0, 8, o.x, o.y, o.z, d.x, d.y, d.z, c, l); },
    addGlint: (gx, gz, r, gi, col) => frameGlints.push([gx, gz, r, gi]),
  };
  const st = { turbulence: 0, rain: 0, fog: 0, intensity: 0, night: 0, flash: 0, stElmo: 0 };
  const env = sc.env || {};
  if (env.sunDir) st.sunDir = new THREE.Vector3(...env.sunDir);
  if (env.sunDirShadow) st.sunDirShadow = new THREE.Vector3(...env.sunDirShadow);
  if (env.palette) {
    st.palette = {};
    for (const [k, v] of Object.entries(env.palette)) st.palette[k] = Array.isArray(v) ? new THREE.Color(...v) : v;
  }
  const W = sc.wind || { base: [0, 0], amp: 0 };
  const weather = {
    state: st,
    windAt: (x, z, o) => o.set(W.base[0] + W.amp * Math.sin(0.3 * clock.t + 0.002 * x), W.base[1] + W.amp * Math.cos(0.21 * clock.t + 0.002 * z)),
  };
  const settings = sc.settings || {};
  const inp = { move: { x: 0, y: 0 }, axes: { lift: 0, aimX: 0, aimY: 0 }, down: new Set(), pressed: new Set(), wheel: 0 };
  const input = {
    move: () => ({ x: inp.move.x, y: inp.move.y }),
    axis: (n) => inp.axes[n] || 0,
    down: (n) => inp.down.has(n),
    pressed: (n) => inp.pressed.has(n),
    consumeWheel: () => { const w = inp.wheel; inp.wheel = 0; return w; },
    lastDevice: 'keyboard',
    mouse: { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, wheel: 0, active: false, lastMoveT: -1e9 },
    axesValues: { moveX: 0, moveY: 0, lift: 0, aimX: 0, aimY: 0 },
    mouseButtons: new Set(),
    keys: new Set(),
  };
  const pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad], configurable: true, writable: true });
  performance.now = () => clock.realT * 1000;
  const camera = new THREE.PerspectiveCamera(40, 1280 / 720, 2, 1200);
  camera.position.set(0, 220, 60);
  camera.lookAt(0, 0, 0);
  const photo = { active: false };
  const ctx = {
    scene: new THREE.Scene(), look, events, mode: sc.mode0 || 'play', params: new URLSearchParams(sc.autostart ? 'autostart' : ''),
    settings: { get: (k) => settings[k], onChange: () => {}, detail: () => sc.detail ?? 1 },
    input, camera, timeScale: 1, renderer: { domElement: { clientWidth: 1280, clientHeight: 720 } },
    ocean, weather, world, hazards, survivors, fx, photo,
    mission: sc.mission ? { def: { area: { radius: sc.mission.radius } }, elapsed: 0 } : undefined,
  };
  const h = new Helicopter(ctx);
  // three.js draws Math.random for every object's uuid while the model is built (≈ 2500 draws), so the
  // cosmetic random stream is re-seeded AFTER construction and HeliLights.blinkSeed re-drawn as its first
  // value — SimContext.random in Swift (createRng(seed)) draws blinkSeed first, exactly here.
  const rng = M.createRng(sc.seed);
  Math.random = () => rng.next();
  h.lightsCtl.blinkSeed = Math.random() * 10;
  ctx.heli = h;
  const rig = new CameraRig(ctx);
  ctx.cameraRig = rig;

  // event log (ids instead of objects)
  const evLog = [];
  const ser = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(ser);
    if (v.isVector3) return [num(v.x), num(v.y), num(v.z)];
    if (v.isVector2) return [num(v.x), num(v.y)];
    if (world.pads.includes(v)) return world.pads.indexOf(v);
    if (survivors.list.includes(v)) return v.id;
    if (v.survivor !== undefined && v.stretcher !== undefined) return v.id ?? null; // cabin record → person id
    if (typeof v === 'object' && 'x' in v && 'y' in v && Object.keys(v).length === 2) return [num(v.x), num(v.y)]; // {x, y} dir
    return '<object>';
  };
  const emit0 = events.emit.bind(events);
  events.emit = (name, p) => {
    const o = {};
    for (const [k, v] of Object.entries(p || {})) o[k] = k === 'def' || k === 'checkpoint' ? '<def>' : ser(v);
    evLog.push([clock.frame, name, o]);
    emit0(name, p);
  };

  const pokesOut = [];
  const applyPoke = (pk) => {
    pokesOut.push([clock.frame, pk]);
    switch (pk.op) {
      case 'emit': {
        const p = {};
        for (const [k, v] of Object.entries(pk.payload)) p[k] = v === 'NaN' ? NaN : v;
        if (pk.name === 'survivor:signal') p.s = survivors.list.find((s) => s.id === pk.payload.s) || null;
        if (pk.name === 'weather:gust' && p.dir) p.dir = new THREE.Vector2(p.dir[0], p.dir[1]);
        events.emit(pk.name, p);
        break;
      }
      case 'mode': { const from = ctx.mode; ctx.mode = pk.to; events.emit('game:mode', { from, to: pk.to }); break; }
      case 'damage': h.damage(pk.amount, pk.source); break;
      case 'fuel': h.fuel = pk.value; break;
      case 'impulse': h.applyImpulse(new THREE.Vector3(...pk.v)); break;
      case 'autoTakeoff': h.autoTakeoff(pk.alt); break;
      case 'capacity': h.capacity = pk.value; break;
      case 'shake': rig.shake(pk.strength, pk.duration); break;
      case 'punch': rig.punch(pk.delta, pk.duration); break;
      case 'focus': rig.focus(new THREE.Vector3(...pk.position), pk.duration); break;
      case 'slowMo': rig.slowMo(pk.scale, pk.duration, pk.key ?? null); break;
      case 'rigMode': rig.setMode(pk.mode); break;
      case 'rogue': hazards.rogueOn = pk.on; break;
      case 'debris': Object.assign(hazards.debris.items[pk.kind][pk.i], { x: pk.x, z: pk.z, vx: pk.vx, vz: pk.vz }); break;
      default: throw new Error('unknown poke ' + pk.op);
    }
  };

  const queued = []; // pokes a pilot asks for, applied at the start of the next frame
  const realDts = [];
  const inputs = [];
  const states = [];
  const cables = [];
  const rings = [];
  const all = stateFields();
  const names = new Set();
  for (const [n] of all) { if (names.has(n)) throw new Error('duplicate state field ' + n); names.add(n); }
  const fields = all.filter((f) => f[2] === 'A');
  const vfields = all.filter((f) => f[2] === 'B');
  const visuals = [];
  for (clock.frame = 1; clock.frame <= sc.frames; clock.frame++) {
    const frame = clock.frame;
    const realDt = sc.dt(frame);
    for (const pk of [...((sc.pokes && sc.pokes[frame]) || []), ...queued.splice(0)]) applyPoke(pk);
    const dt = ctx.mode === 'paused' ? 0 : realDt * ctx.timeScale;
    clock.t += dt;
    clock.realT += realDt;
    if (ctx.mission) ctx.mission.elapsed = clock.t;
    world.advance(dt, clock.t);
    survivors.advance(dt);
    hazards?.advance(dt);
    Object.assign(st, q32(sc.weather ? sc.weather(frame, clock.t) : {}));
    bank.update(dt, clock.t, sc.sea, 0.6, 1, 0, 0);
    // pilot → input for this frame
    const u = q32(sc.pilot(frame, ctx, h, rig, clock));
    if (u.mouse) u.mouse = u.mouse.map(Math.fround);
    if (u.axes) u.axes = q32(u.axes);
    if (u.pokes) queued.push(...u.pokes);
    realDts.push(realDt);
    if (process.env.MAYDAY_HELI_DEBUG && frame % 60 === 0) console.log(sc.id, frame, u.phase ?? '', h.position.toArray().map((v) => v.toFixed(1)).join(','), 'spd', h.speed.toFixed(1), 'landed', !!h.landed, h.winch.state, 'len', h.winch.length.toFixed(1), 'fuel', h.fuel.toFixed(3), 'hull', h.hull.toFixed(2), 'cab', h.cabin.length);
    inp.move.x = u.moveX ?? 0; inp.move.y = u.moveY ?? 0;
    inp.axes.lift = u.lift ?? 0; inp.axes.aimX = u.aimX ?? 0; inp.axes.aimY = u.aimY ?? 0;
    inp.down = new Set(u.down || []); inp.pressed = new Set(u.pressed || []);
    inp.wheel = u.wheel ?? 0;
    input.lastDevice = u.device ?? 'keyboard';
    const mo = input.mouse;
    if (u.mouse) { mo.active = true; mo.ndcX = u.mouse[0]; mo.ndcY = u.mouse[1]; mo.x = (mo.ndcX + 1) * 640; mo.y = (1 - mo.ndcY) * 360; if (u.mouseMoved) mo.lastMoveT = clock.realT * 1000; }
    photo.active = !!u.photo;
    if (u.photoWheel) rig.freecam._wheel += Math.sign(u.photoWheel);
    input.mouseButtons = new Set(u.mouseButtons || []);
    input.keys = new Set(u.shift ? ['ShiftLeft'] : []);
    pad.buttons[4].pressed = !!u.padLB; pad.buttons[5].pressed = !!u.padRB;
    const ax = u.axes || {};
    input.axesValues = { moveX: ax.moveX ?? 0, moveY: ax.moveY ?? 0, lift: ax.lift ?? 0, aimX: ax.aimX ?? 0, aimY: ax.aimY ?? 0 };
    const bits = (set) => ACTIONS.reduce((a, n, i) => a | (set.has(n) ? 1 << i : 0), 0);
    inputs.push(MODES.indexOf(ctx.mode), inp.move.x, inp.move.y, inp.axes.lift, inp.axes.aimX, inp.axes.aimY, inp.wheel,
      DEVICES.indexOf(input.lastDevice), mo.active ? 1 : 0, mo.ndcX, mo.ndcY, u.mouse && u.mouseMoved ? 1 : 0, bits(inp.down), bits(inp.pressed),
      photo.active ? 1 : 0, u.photoWheel ? Math.sign(u.photoWheel) : 0, (input.mouseButtons.has('Mouse0') ? 1 : 0) | (input.mouseButtons.has('Mouse2') ? 2 : 0),
      u.shift ? 1 : 0, u.padLB ? 1 : 0, u.padRB ? 1 : 0, input.axesValues.moveX, input.axesValues.moveY, input.axesValues.aimX, input.axesValues.aimY,
      input.axesValues.lift, st.turbulence, st.rain, st.fog, st.intensity, st.night, st.flash, st.stElmo);

    frameGlints = [];
    h.update(dt);
    rig.update(realDt);

    if (frame % 12 === 0) for (let i = 0; i < frameGlints.length; i++) glints.push(frame, i, ...frameGlints[i]);
    const S = { h, f: h.flight, w: h.winch, wc: h.winchCtl, o: h.ops, sl: h.searchlightCtl, lc: h.lightsCtl, cr: h.crewman, m: h.model, rig, cam: camera, ctx, world, lastDw, lastSl };
    if (frame % sc.every === 0) {
      states.push(frame, ...fields.map(([, g]) => g(S)));
      cables.push(...h.winchCtl.cur, ...h.winchCtl.rend);
    }
    if (frame % 30 === 0) {
      visuals.push(frame, ...vfields.map(([, g]) => g(S)));
      rings.push(...h.winchCtl.ringPos);
    }
  }
  for (let i = 0; i < inputs.length; i++) if (Math.fround(inputs[i]) !== inputs[i]) throw new Error(`input ${INPUT_FIELDS[i % INPUT_FIELDS.length]} is not a float32`);
  return { inputs, realDts, states, visuals, cables, rings, glints, evLog, fxLog, oceanLog, pokesOut, fields, vfields };
}

// ----------------------------------------------------------------------------------------- the row
// [name, getter(S)] — numbers only; booleans 0/1; nulls / ids −1; enums by index. The Swift test has the
// same names (Tests/MaydayCoreTests/Heli/HeliTraceTests.swift).
function stateFields() {
  const F = [];
  let tier = 'A';
  const push0 = F.push.bind(F);
  F.push = (...items) => push0(...items.map(([n, g]) => [n, g, tier]));
  const v3 = (name, g) => { F.push([name + 'X', (S) => g(S).x], [name + 'Y', (S) => g(S).y], [name + 'Z', (S) => g(S).z]); };
  const q4 = (name, g) => { for (const c of ['x', 'y', 'z', 'w']) F.push([name + c.toUpperCase(), (S) => g(S)[c]]); };
  const rgb = (name, g) => { for (const c of ['r', 'g', 'b']) F.push([name + c.toUpperCase(), (S) => g(S)[c]]); };
  const b = (x) => (x ? 1 : 0);
  const padIdx = (S, p) => (p ? S.world.pads.indexOf(p) : -1);
  const sid = (s) => (s ? s.id : -1);
  // heli: contract + extras
  v3('pos', (S) => S.h.position); v3('vel', (S) => S.h.velocity);
  for (const k of ['heading', 'altitude', 'fuel', 'hull', 'rotorRPM', 'load', 'bank', 'pitch', 'engineTemp', 'emp', 'altTarget', 'yawRate', 'vy', 'speed',
    'airspeed', 'seaY', 'surfaceY', 'skidClearance', 'bingo', 'fuelBurn', 'overheat', 'thrustFactor', 'damageTaken', 'uMag', 'capacity', 'flares', 'rafts']) F.push([k, (S) => S.h[k]]);
  v3('aim', (S) => S.h.aim);
  F.push(['uMoveX', (S) => S.h.uMove.x], ['uMoveY', (S) => S.h.uMove.y]);
  v3('hoistW', (S) => S.h.hoistWorld); v3('hoistR', (S) => S.h.hoistRender);
  F.push(['dwX', (S) => S.h.downwash.x], ['dwZ', (S) => S.h.downwash.z], ['dwRadius', (S) => S.h.downwash.radius], ['dwStrength', (S) => S.h.downwash.strength]);
  F.push(['landed', (S) => padIdx(S, S.h.landed)], ['bingoPad', (S) => padIdx(S, S.h.bingoPad)], ['alive', (S) => b(S.h.alive)], ['searchlight', (S) => b(S.h.searchlight)],
    ['boost', (S) => b(S.h.boost)], ['boosting', (S) => b(S.h.boosting)], ['boostHeld', (S) => b(S.h.boostHeld)], ['autorotation', (S) => b(S.h.autorotation)],
    ['crashPhase', (S) => (S.h.crash ? (S.h.crash.phase === 'autorot' ? 1 : 2) : 0)], ['crashT', (S) => (S.h.crash ? S.h.crash.t : -1)],
    ['crashDeck', (S) => padIdx(S, S.h.crash?.deck)], ['ceiling', (S) => b(S.h.ceiling)], ['refueling', (S) => b(S.h.refueling)],
    ['cabin', (S) => S.h.cabin.length], ['firstHit', (S) => b(S.h.firstHit)], ['aimSource', (S) => AIM_SOURCES.indexOf(S.h.aimSource)],
    ['acc', (S) => S.h.acc], ['liftActive', (S) => b(S.h.liftActive)], ['liftAxis', (S) => S.h.liftAxis], ['pitchV', (S) => S.h.pitchV], ['bankV', (S) => S.h.bankV]);
  // flight model internals
  v3('fp', (S) => S.f.p); v3('fv', (S) => S.f.v);
  F.push(['fHeading', (S) => S.f.heading], ['noseTarget', (S) => (S.f.noseTarget === null ? NaN : S.f.noseTarget)], ['landTimer', (S) => S.f.landTimer],
    ['contactPad', (S) => padIdx(S, S.f.contactPad)], ['fSea', (S) => S.f.sea], ['fSurface', (S) => S.f.surface], ['fTurb', (S) => S.f.turb], ['lastVy', (S) => S.f.lastVy]);
  // winch
  F.push(['wState', (S) => WINCH_STATES.indexOf(S.w.state)], ['wLength', (S) => S.w.length]);
  v3('basket', (S) => S.w.basket);
  F.push(['steadiness', (S) => S.w.steadiness], ['wLoad', (S) => sid(S.w.load)], ['wSpeed', (S) => S.w.speed], ['swing', (S) => S.w.swing], ['wTarget', (S) => sid(S.w.target)],
    ['capture', (S) => S.w.capture], ['tension', (S) => S.w.tension], ['jammed', (S) => S.w.jammed], ['wSurfaceY', (S) => S.w.surfaceY], ['wHeight', (S) => S.w.height],
    ['inRange', (S) => b(S.w.inRange)], ['radius', (S) => S.w.radius], ['stretcher', (S) => b(S.w.stretcher)], ['cabinFull', (S) => b(S.w.cabinFull)],
    ['denied', (S) => DENIED.indexOf(S.w.denied)]);
  v3('basketVel', (S) => S.wc.basketVel);
  for (const k of ['buffer', 'slipT', 'tensionT', 'snagWet', 'snagCd', 'grace', 'spin', 'spinRate', 'ringOrange', 'ringOpacity']) F.push(['wc_' + k, (S) => S.wc[k]]);
  F.push(['wc_autoRetract', (S) => b(S.wc.autoRetract)], ['wc_snagInside', (S) => S.wc.snagInside.size], ['wc_pending', (S) => b(S.wc.pending)], ['crestUnder', (S) => S.wc.crestUnder ?? 0]);
  // ops
  for (const k of ['bingoT', 'unloadT', 'resupplyT', 'hornT', 'floodT', 'overheatT', 'crewRocketT']) F.push(['ops_' + k, (S) => S.o[k]]);
  F.push(['ops_fuelLevel', (S) => ['ok', 'low', 'critical', 'empty'].indexOf(S.o.fuelLevel)], ['ops_bingoWarned', (S) => b(S.o.bingoWarned)], ['ops_refueling', (S) => b(S.o.refueling)],
    ['ops_unloaded', (S) => S.o.unloaded.length], ['nFlights', (S) => S.o.flights.length], ['nDrops', (S) => S.o.drops.length]);
  v3('flight0', (S) => S.o.flights[0] || { x: NaN, y: NaN, z: NaN });
  v3('drop0', (S) => S.o.drops[0] || { x: NaN, y: NaN, z: NaN });
  F.push(['drop0Spin', (S) => (S.o.drops[0] ? S.o.drops[0].spin : NaN)]);
  // visual state (tier B: recorded every 30th frame)
  tier = 'B';
  v3('root', (S) => S.m.root.position);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) F.push(['body' + i, (S) => S.m.body.matrixWorld.elements[i]]); // rotation part (translation = root)
  for (const k of ['uBlade', 'uGhost', 'uSharp', 'uExp', 'uElmo', 'uArc', 'uTipFade']) F.push(['rotor_' + k, (S) => S.m.rotorMat.uniforms[k].value]);
  for (const k of ['uBlade', 'uGhost', 'uSharp', 'uExp', 'uArc', 'uTipFade']) F.push(['tail_' + k, (S) => S.m.tailMat.uniforms[k].value]);
  F.push(['hubAngle', (S) => S.m.hub.rotation.y], ['bladesAngle', (S) => S.m.blades.rotation.y], ['bladesVisible', (S) => b(S.m.blades.visible)]);
  const hu = (S) => S.m.hullMat.userData.uniforms;
  rgb('rim', (S) => hu(S).uRim.value); rgb('fill', (S) => hu(S).uFill.value);
  F.push(['sunScale', (S) => hu(S).uSunScale.value], ['soot', (S) => hu(S).uSoot.value]);
  rgb('instr', (S) => hu(S).uInstr.value);
  const rl = (S) => S.m.rotorLight;
  rgb('veilSun', (S) => rl(S).uSunCol.value); rgb('veilAmb', (S) => rl(S).uAmbCol.value); rgb('veilSky', (S) => rl(S).uSkyCol.value);
  v3('veilSunDir', (S) => rl(S).uSunDir.value);
  rgb('glow', (S) => rl(S).uGlow.value); rgb('glowB', (S) => rl(S).uGlowB.value); rgb('glowS', (S) => rl(S).uGlowS.value);
  F.push(['floatsVisible', (S) => b(S.m.floats[0].visible)]);
  v3('floatScale', (S) => S.m.floats[0].scale);
  F.push(['heatVisible', (S) => b(S.h.heatProxies[0].visible)]);
  // searchlight
  F.push(['slLevel', (S) => S.sl.level]);
  v3('slDir', (S) => S.sl.dir); v3('slOrigin', (S) => S.sl.origin); v3('slHit', (S) => S.sl.hit);
  F.push(['slLength', (S) => S.sl.length], ['slAngle', (S) => S.sl.angle], ['slFlick', (S) => S.sl.flick], ['spotIntensity', (S) => S.sl.spot.intensity], ['spotAngle', (S) => S.sl.spot.angle]);
  v3('spotTarget', (S) => S.sl.spot.target.position);
  const cu = (S) => S.sl.coneMat.uniforms;
  F.push(['coneDensity', (S) => cu(S).uDensity.value], ['coneIntensity', (S) => cu(S).uIntensity.value], ['coneLen', (S) => cu(S).uLen.value],
    ['coneTanA', (S) => cu(S).uTanA.value], ['coneCos2', (S) => cu(S).uCos2.value], ['coneVisible', (S) => b(S.sl.cone.visible)]);
  q4('coneQ', (S) => S.sl.cone.quaternion);
  v3('coneScale', (S) => S.sl.cone.scale);
  F.push(['beamOn', (S) => b(S.h.beam.on)], ['beamIntensity', (S) => S.h.beam.intensity], ['beamCos', (S) => S.h.beam.cosOuter]);
  F.push(['oceanSlLevel', (S) => S.lastSl[7]], ['oceanDwStrength', (S) => S.lastDw[3]]);
  // lights
  for (let i = 0; i < 10; i++) F.push(['chan' + i, (S) => S.lc.chan[i]]);
  F.push(['halo', (S) => S.m.lightsMat.uniforms.uHalo.value], ['strobe', (S) => S.lc.strobe], ['beacon', (S) => S.lc.beacon], ['door', (S) => S.lc.door]);
  rgb('belly', (S) => S.lc.belly.color);
  F.push(['bellyIntensity', (S) => S.lc.belly.intensity]);
  for (let i = 0; i < 8; i++) F.push(['glowCol' + i, (S) => hu(S).uGlowCol.value[i].r]);
  // crewman
  F.push(['crewLean', (S) => S.cr.lean], ['crewVisible', (S) => b(S.cr.group.visible)]);
  v3('crewPos', (S) => S.cr.group.position);
  q4('crewArm', (S) => S.cr.arm.quaternion); q4('crewHead', (S) => S.cr.head.quaternion);
  // winch render
  F.push(['cableVisible', (S) => b(S.wc.cable.visible)], ['basketVisible', (S) => b(S.wc.basketMesh.visible)], ['rescuerVisible', (S) => b(S.wc.rescuer.visible)],
    ['ringVisible', (S) => b(S.wc.ring.visible)]);
  v3('basketMesh', (S) => S.wc.basketMesh.position); q4('basketQ', (S) => S.wc.basketMesh.quaternion);
  v3('rescuer', (S) => S.wc.rescuer.position);
  F.push(['cableLit', (S) => S.wc.cableMat.uniforms.uLit.value], ['cableBeamCos', (S) => S.wc.cableMat.uniforms.uBeamCos.value],
    ['cableBeamI', (S) => S.wc.cableMat.uniforms.uBeamI.value], ['ringMatOpacity', (S) => S.wc.ringMat.uniforms.uOpacity.value],
    ['ringPhase', (S) => S.wc.ringMat.uniforms.uPhase.value]);
  rgb('ringColor', (S) => S.wc.ringMat.uniforms.uColor.value);
  // camera rig + camera
  tier = 'A';
  v3('cam', (S) => S.cam.position); q4('camQ', (S) => S.cam.quaternion);
  F.push(['camFov', (S) => S.cam.fov], ['camProj0', (S) => S.cam.projectionMatrix.elements[0]], ['camProj5', (S) => S.cam.projectionMatrix.elements[5]]);
  for (const k of ['zoom', 'zoomIndex', 'letterbox', 'height', 'tiltDeg', 'fov', 'viewHeight', 'trauma', '_hv', '_tilt', '_tiltV', '_punch', '_punchT', '_climbFov',
    '_winch', '_t', '_lbPulse', '_revealHold', '_slowT', '_slowScale', '_focusT', '_focusW', '_crashT']) F.push(['rig' + k, (S) => S.rig[k]]);
  F.push(['rigReveal', (S) => b(S.rig.reveal)], ['rigMode', (S) => ['follow', 'attract', 'cinematic'].indexOf(S.rig.mode)], ['rigPhoto', (S) => b(S.rig._photo)],
    ['rigPending', (S) => S.rig._pending.length], ['rigRogueUnder', (S) => b(S.rig._rogueUnder)], ['timeScale', (S) => S.ctx.timeScale]);
  F.push(['focusX', (S) => S.rig.focusPoint.x], ['focusZ', (S) => S.rig.focusPoint.z], ['rigFvX', (S) => S.rig._fv.x], ['rigFvY', (S) => S.rig._fv.y]);
  for (const k of ['x', 'y', 'ndcX', 'ndcY']) F.push(['hs_' + k, (S) => S.rig.heliScreen[k]]);
  F.push(['hs_behind', (S) => b(S.rig.heliScreen.behind)], ['hs_onScreen', (S) => b(S.rig.heliScreen.onScreen)],
    ['hsvX', (S) => S.rig.heliScreenVelocity.x], ['hsvY', (S) => S.rig.heliScreenVelocity.y]);
  v3('mPos', (S) => S.rig.motion.pos); v3('mRot', (S) => S.rig.motion.rot);
  F.push(['mPushX', (S) => S.rig.motion.push.x], ['mPushY', (S) => S.rig.motion.push.y], ['mTrauma', (S) => S.rig.motion.trauma], ['mFreq', (S) => S.rig.motion.freq],
    ['mShakeT', (S) => S.rig.motion.shakeT]);
  v3('fcP', (S) => S.rig.freecam.p); v3('fcPivot', (S) => S.rig.freecam.pivot);
  F.push(['fcYaw', (S) => S.rig.freecam.yaw], ['fcPitch', (S) => S.rig.freecam.pitch], ['fcDist', (S) => S.rig.freecam.dist],
    ['fc_yaw', (S) => S.rig.freecam._yaw], ['fc_pitch', (S) => S.rig.freecam._pitch], ['fc_dist', (S) => S.rig.freecam._dist]);
  return F;
}

// ------------------------------------------------------------------------------------------ helpers
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// realDt pattern: mostly 1/60 with jitter (0, 1 and 2 substeps; alpha interpolation exercised)
const JITTER = [1 / 60, 1 / 60, 1 / 60, 0.0215, 0.0118, 1 / 60, 1 / 30, 1 / 60, 0.0172, 1 / 60, 0.0151, 1 / 60];
const jitterDt = (frame) => JITTER[frame % JITTER.length];
// steer the hoist (or the heli) over a point: PD on position / velocity, stick in [−1, 1]
function steer(h, tx, tz, { useHoist = false, kp = 0.06, kd = 0.12, max = 1 } = {}) {
  // with the cable out, aim the basket itself (it hangs downwind of the hoist)
  const basket = useHoist && h.winch.length > 3;
  const p = basket ? h.winch.basket : useHoist ? h.hoistWorld : h.position;
  if (basket) { kp *= 0.6; }
  const dx = tx - p.x, dz = tz - p.z;
  let ux = kp * dx - kd * h.velocity.x;
  let uz = kp * dz - kd * h.velocity.z;
  const l = Math.hypot(ux, uz);
  if (l > max) { ux *= max / l; uz *= max / l; }
  return { moveX: ux, moveY: -uz, d: Math.hypot(dx, dz) };
}
const DAY_PALETTE = { ambient: [0.42, 0.47, 0.52], sun: [1.0, 0.93, 0.82], sky: [0.5, 0.6, 0.72], sunIntensity: 1.1, ambientIntensity: 0.6 };
const STORM_PALETTE = { ambient: [0.16, 0.18, 0.21], sun: [0.3, 0.32, 0.35], sky: [0.2, 0.23, 0.27], sunIntensity: 0.4, ambientIntensity: 0.5 };
const NIGHT_PALETTE = { ambient: [0.03, 0.04, 0.06], sun: [0.12, 0.14, 0.2], sunIntensity: 0.2, ambientIntensity: 0.4 };

// ========================================================================================= scenarios
// 1. rescue: pad take-off, searchlight + mouse aim, winch a swimmer pair (2 lifts), raft drop, flare, horn,
//    return, deck flare + landing, unload, refuel, repair, resupply.
function scRescue() {
  const S1 = { x: 36, z: -26 };
  let phase = 'takeoff', phaseT = 0, lifts = 0, pressedOnce = new Set();
  const once = (k, cond) => { if (cond && !pressedOnce.has(k)) { pressedOnce.add(k); return [k.split(':')[0]]; } return []; };
  return {
    id: 'rescue', seed: 1337, frames: 3000, every: 10, dt: jitterDt,
    sea: { Hs: 1.8, swellAdd: 0.5, Q: 0.45, clearing: 0 }, wind: { base: [5, -2.5], amp: 1.2 },
    weather: (frame, t) => ({ turbulence: 0.25, rain: 0.1, fog: 0.05, intensity: 0.3, night: 0.15, flash: frame >= 900 && frame < 906 ? 0.6 : 0, stElmo: 0 }),
    env: { sunDir: [0.3, 0.8, 0.2], palette: DAY_PALETTE }, settings: { assist: 'standard', difficulty: 'pilot', quality: 'high' },
    world: { pads: [{ type: 'lighthouse', position: [0, 8, 0], radius: 14, heading: 0.3, services: { fuel: 10, repair: 4, resupply: true } }],
      obstacles: [{ x: -30, z: 25, radius: 3, top: 40 }], floaters: [{ shape: 'plank', x: 60, z: -20, vx: -0.2 }], lighthouse: [-30, 25] },
    survivors: [{ id: 1, type: 'swimmer', position: [S1.x, 0, S1.z], velocity: [0.15, 0, 0.05], remaining: 2, spotted: true },
      { id: 2, type: 'raft', position: [12, 0, -58], velocity: [0, 0, -0.1], remaining: 1 }],
    mission: { radius: 900 },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { pad: 0 } } } }, { op: 'emit', name: 'mission:start', payload: { def: {} } }],
      600: [{ op: 'emit', name: 'survivor:signal', payload: { s: 2, kind: 'rocket', x: 14, z: -55, error: 4 } }],
      700: [{ op: 'emit', name: 'weather:gust', payload: { dir: [0.8, -0.6], strength: 9, eta: 1.2, x: 40, z: -30, harmless: true } }],
      1500: [{ op: 'damage', amount: 0.12, source: 'debris' }] },
    pilot(frame, ctx, h) {
      phaseT += 1;
      const s = ctx.survivors.list[0];
      const w = h.winch;
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [], mouse: [0.05, -0.2], mouseMoved: frame % 40 < 20 };
      if (phase === 'takeoff') {
        u.lift = 1;
        if (h.altTarget > 20) { phase = 'fly'; phaseT = 0; u.pressed.push('altPreset1'); }
      } else if (phase === 'fly') {
        Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.05, kd: 0.16 }));
        u.pressed.push(...once('searchlight', phaseT === 30));
        if (u.d < 2.5 && h.speed < 1.5) { phase = 'winch'; phaseT = 0; }
      } else if (phase === 'winch') {
        Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.05, kd: 0.18, max: 0.5 }));
        if (!w.load && h.cabin.length === lifts) { u.down.push('winch'); if (phaseT === 1) u.pressed.push('winch'); }
        if (h.cabin.length > lifts) { lifts = h.cabin.length; phaseT = 0; if (lifts >= 2) { phase = 'raft'; } }
      } else if (phase === 'raft') {
        const r = ctx.survivors.list[1];
        Object.assign(u, steer(h, r.position.x + 18, r.position.z, { kp: 0.07, kd: 0.14 }));
        u.mouse = [-0.3, 0.1];
        if (u.d < 12 && h.speed < 3) {
          u.pressed.push(...once('raftDrop:1', true));
          u.pressed.push(...once('flare:1', phaseT > 10));
          u.pressed.push(...once('horn:1', phaseT > 20));
          if (pressedOnce.has('horn:1') && phaseT > 60) { phase = 'home'; phaseT = 0; }
        }
      } else if (phase === 'home') {
        const p = ctx.world.pads[0].position;
        Object.assign(u, steer(h, p.x + 2, p.z + 1, { kp: 0.07, kd: 0.14 }));
        if (u.d < 8) u.lift = -1;
        if (h.landed) { phase = 'landed'; phaseT = 0; }
      } else {
        u.pressed.push(...once('searchlight:off', phaseT === 200));
      }
      u.phase = phase;
      return u;
    },
  };
}

// 2. storm: night storm, assist full, downdraft + vortex core, rogue lift, lightning EMP, intake flood,
//    hull to zero → autorotation crash → ditch at sea (crew rocket) → rig crash slow-mo / lift-off.
function scStorm() {
  return {
    id: 'storm_crash', seed: 4242, frames: 1500, every: 10, dt: jitterDt,
    sea: { Hs: 3.5, swellAdd: 0.5, Q: 0.6, clearing: 0 }, wind: { base: [13, 5], amp: 3.5 },
    weather: (frame, t) => ({ turbulence: 1.4, rain: 0.8, fog: 0.1, intensity: 0.9, night: 0.85, flash: frame % 170 < 4 ? 1 : 0, stElmo: frame > 300 ? 0.6 : 0 }),
    env: { sunDir: [-0.2, 0.6, 0.4], sunDirShadow: [-0.2, 0.7, 0.4], palette: NIGHT_PALETTE }, settings: { assist: 'full', difficulty: 'ace', quality: 'medium', reduceFlashes: true },
    detail: 0.7,
    world: { pads: [{ type: 'rig', position: [200, 30, 150], radius: 18, refuel: true }] },
    survivors: [{ id: 3, type: 'raft', position: [30, 0, -10], velocity: [0.4, 0, 0.2], remaining: 2, spotted: true }],
    hazards: { downdraft: { x: 25, z: -15, r: 40, s: 3, push: [1.5, -0.8] }, vortices: [{ type: 'waterspout', position: [60, 0, -40], core: 18, stage: 4 }],
      rogue: { t0: 11, t1: 14, x: 30, z: -12, r: 30, h: 6 }, imminent: { type: 'rogue', position: [40, 0, -20], eta: 3, t0: 5, t1: 7 } },
    mission: { radius: 300 },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { x: 0, z: 0, altitude: 25, heading: 0.4 } } } }],
      2: [{ op: 'emit', name: 'mission:start', payload: { def: {} } }],
      120: [{ op: 'emit', name: 'weather:lightning', payload: { x: 20, z: 10, distance: 30, strength: 1, cloudOnly: false } }, { op: 'damage', amount: 0.1, source: 'lightning' }],
      300: [{ op: 'emit', name: 'hazard:warning', payload: { type: 'rogue', text: 'ВОЛНА' } }],
      420: [{ op: 'damage', amount: 0.3, source: 'rogue' }],
      520: [{ op: 'emit', name: 'weather:lightning', payload: { x: 400, z: 300, distance: 480, strength: 0.6, cloudOnly: true } }],
      600: [{ op: 'damage', amount: 0.5, source: 'tornado' }],
      700: [{ op: 'damage', amount: 0.9, source: 'debris' }],
      760: [{ op: 'damage', amount: 0.9, source: 'hail' }] },
    pilot(frame, ctx, h) {
      const s = ctx.survivors.list[0];
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [], device: 'gamepad', aimX: frame > 200 && frame < 400 ? 0.6 : 0, aimY: frame > 200 && frame < 400 ? -0.3 : 0 };
      if (frame < 500) {
        Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.05, kd: 0.15, max: 0.8 }));
        if (frame > 60 && frame < 100) u.lift = -1;
        if (frame > 150) u.down.push('winch');
        if (frame === 151) u.pressed.push('winch');
        if (frame === 90) u.pressed.push('searchlight');
        if (frame > 330 && frame < 400) u.down.push('boost');
      } else {
        u.moveX = 0.6; u.moveY = 0.3;
        if (frame === 560) u.pressed.push('flare');
      }
      return u;
    },
  };
}

// 3. fuel: boost to overheat, bingo → empty → autorotation onto a moving, turning, tilting ship deck (flare
//    over the deck), deck damage on touch, autorotation landing, refuel + resupply (legacy pad.refuel), a
//    shove off the deck (applyImpulse → takeoff) and re-landing, autoTakeoff, then a hull failure over the
//    deck: the wreck comes down on it (ditch onto the pad, carried by the moving deck).
function scFuel() {
  let phase = 'out';
  return {
    id: 'fuel_ship', seed: 909, frames: 2100, every: 10, dt: jitterDt,
    sea: { Hs: 0.6, swellAdd: 0.7, Q: 0.3, clearing: 0 }, wind: { base: [-3, 4], amp: 0.6 },
    weather: () => ({ turbulence: 0.1, rain: 0, fog: 0.4, intensity: 0.1, night: 0, flash: 0, stElmo: 0 }),
    env: { palette: STORM_PALETTE }, settings: { assist: 'off', difficulty: 'cadet', quality: 'low', invertLift: false },
    world: { pads: [{ type: 'ship', position: [-40, 6, 30], radius: 13, heading: 1.2, velocity: [1.2, 0, -0.6], yawRate: 0.02, tiltAmp: 0.11, tiltFreq: 0.7, refuel: true },
      { type: 'pad', position: [400, 4, -380], radius: 12 }] },
    survivors: [],
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { x: -20, z: 0, y: 40, heading: 0 } } } }, { op: 'fuel', value: 0.27 }],
      700: [{ op: 'fuel', value: 0.004 }],
      1380: [{ op: 'impulse', v: [4, 0, -1] }],
      1600: [{ op: 'autoTakeoff', alt: 24 }],
      1720: [{ op: 'damage', amount: 3, source: 'lightning' }] },
    pilot(frame, ctx, h) {
      const deck = ctx.world.pads[0];
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [], device: 'touch' };
      if (phase === 'out') {
        Object.assign(u, steer(h, deck.position.x + 30 * Math.cos(frame * 0.01), deck.position.z + 30 * Math.sin(frame * 0.01), { kp: 0.05, kd: 0.12 }));
        if (frame > 60) u.down.push('boost');
        if (frame === 380) u.wheel = 2;
        if (frame === 600) u.pressed.push('raftDrop');
        if (frame === 620) u.pressed.push('flare');
        if (h.autorotation) phase = 'glide';
      } else if (phase === 'glide') {
        Object.assign(u, steer(h, deck.position.x, deck.position.z, { kp: 0.09, kd: 0.18 }));
        u.lift = -1;
        if (h.landed) phase = 'deck';
      } else if (frame > 1600) {
        // hold station over the moving deck (the crash comes down on it)
        Object.assign(u, steer(h, deck.position.x, deck.position.z, { kp: 0.08, kd: 0.25, max: 0.6 }));
      }
      u.phase = phase;
      return u;
    },
  };
}

// 4. winch failures: denied (landed / high / fast), tension auto-retract with a load (slip), wave snag and
//    debris snag on the empty basket, pickups, cabin full (capacity 3 + an injured stretcher), touch
//    auto-aim with distress signals, mouse aim, stick aim.
function scWinch() {
  let phase = 'pad';
  let t0 = 0;
  let high = 0;
  const go = (p, frame) => { phase = p; t0 = frame; };
  return {
    id: 'winch_failures', seed: 2024, frames: 4200, every: 10, dt: jitterDt,
    sea: { Hs: 2.5, swellAdd: 1.4, Q: 0.35, clearing: 1 }, wind: { base: [9, 4], amp: 2.5 },
    weather: () => ({ turbulence: 0.6, rain: 0.4, fog: 0, intensity: 0.6, night: 0.4, flash: 0, stElmo: 0 }),
    env: { sunDir: [0.5, 0.5, -0.3], palette: { ambient: [0.25, 0.27, 0.3], sky: [0.3, 0.33, 0.38], ambientIntensity: 0.55 } },
    settings: { assist: 'standard', difficulty: 'cadet', quality: 'high' },
    world: { pads: [{ type: 'pad', position: [0, 3, 0], radius: 12 }], floaters: [{ shape: 'barrel', x: 300, z: 300 }, { shape: 'ring', x: 50, z: -60, moored: true }] },
    survivors: [{ id: 5, type: 'swimmer', position: [40, 0, -30], velocity: [0.3, 0, 0.1], remaining: 3, spotted: true },
      { id: 6, type: 'injured', position: [55, 0, -18], velocity: [0.3, 0, 0.1], remaining: 1, state: 'spotted' }],
    hazards: { rogue: { x: 0, z: 0, r: 4000, h: 5 }, debris: { board: [{ x: 500, y: 0.2, z: 500 }], boat: [{ x: 0, y: 15, z: 0 }] } },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { pad: 0, heading: 0.9 } } } }, { op: 'capacity', value: 3 }],
      200: [{ op: 'emit', name: 'survivor:signal', payload: { s: 6, kind: 'smoke', x: 54, z: -20, error: 6 } }],
      210: [{ op: 'emit', name: 'survivor:signal', payload: { s: 5, kind: 'strobe', x: 41, z: -31, error: 2 } }],
      215: [{ op: 'emit', name: 'survivor:signal', payload: { s: 5, kind: 'mirror', x: 'NaN', z: 0, error: 2 } }] },
    pilot(frame, ctx, h) {
      const [s, inj] = ctx.survivors.list;
      const w = h.winch;
      const k = frame - t0;
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [], device: 'keyboard' };
      const hold = (tx, tz, max = 0.5) => Object.assign(u, steer(h, tx, tz, { useHoist: true, kp: 0.05, kd: 0.18, max }));
      const winch = () => { u.down.push('winch'); if (k === 1) u.pressed.push('winch'); };
      switch (phase) {
        case 'pad': // denied: landed
          winch();
          if (k > 40) { go('climb', frame); u.pressed.push('altPreset2'); }
          break;
        case 'climb': // hover at 40 m, then denied: high
          if (h.position.y > 37 && !high) high = frame;
          if (high) { u.down.push('winch'); if (frame === high) u.pressed.push('winch'); }
          if (high && frame - high > 60) { go('dash', frame); u.pressed.push('altPreset1'); }
          break;
        case 'dash': // fast and low: denied: fast; touch aim locks onto the signals
          u.device = 'touch';
          u.moveX = 0.6; u.moveY = 0.55;
          if (k >= 70 && k < 110) { u.down.push('winch'); if (k === 70) u.pressed.push('winch'); }
          if (k > 110) go('approach', frame);
          break;
        case 'approach':
          Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.07, kd: 0.16 }));
          u.mouse = [0.2, 0.3]; u.mouseMoved = k % 30 < 10;
          if (k === 20) u.pressed.push('altUp');
          if (k === 40) u.pressed.push('altDown');
          if (u.d < 3 && h.speed < 1.2) go('lift1', frame);
          break;
        case 'lift1': // capture, then dash off with the person on the cable: tension → slip
          hold(s.position.x, s.position.z);
          u.device = 'gamepad'; u.aimX = 0.5; u.aimY = 0.5;
          if (!w.load) winch();
          if (w.load && w.length < 12) go('tension', frame);
          break;
        case 'tension':
          u.moveX = 0.6; u.moveY = 0.1; u.down.push('winch');
          if (!w.load && k > 30) go('lift2', frame);
          break;
        case 'lift2': // two more people from the group
          Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.06, kd: 0.18, max: 0.7 }));
          if (!w.load) u.down.push('winch');
          if (h.cabin.length >= 2) go('full', frame);
          break;
        case 'full': // the injured needs a stretcher (2 seats): cabin full; the empty basket stays in the water
          hold(inj.position.x, inj.position.z);
          u.down.push('winch');
          if (w.cabinFull && w.state === 'down' && w.height < 2 && !ctx.hazards.rogueOn && !u.pokes && k > 60) u.pokes = [{ op: 'rogue', on: true }];
          if (w.jammed > 0) { go('debris', frame); u.pokes = [{ op: 'rogue', on: false }]; }
          break;
        case 'debris': // after the jam, a board drifts across the cable → debris snag
          hold(inj.position.x, inj.position.z);
          u.down.push('winch');
          if (w.jammed <= 0) {
            u.pokes = [{ op: 'debris', kind: 'board', i: 0, x: w.basket.x - 4, z: w.basket.z + 0.3, vx: 1.5, vz: 0 }];
            go('debris2', frame);
          }
          break;
        case 'debris2':
          hold(inj.position.x, inj.position.z);
          u.down.push('winch');
          break;
      }
      u.phase = phase;
      return u;
    },
  };
}

// 5. stretcher + crash with a load: night, searchlight, an injured survivor (steadiness ≥ 0.6, 3 s capture,
//    stretcher lift 1.5 m/s, 2 seats), land, unload the stretcher (3 s), refuel, take off; winch a swimmer
//    and lose the hull while the person is on the cable (slip 'crash') → autorotation → ditch at sea →
//    flotation bags, crew rocket (fx.burst), bobbing on the swell.
function scStretcher() {
  let phase = 'climb';
  return {
    id: 'stretcher_ditch', seed: 606, frames: 3900, every: 10, dt: jitterDt,
    sea: { Hs: 0.5, swellAdd: 0.4, Q: 0.25, clearing: 0 }, wind: { base: [1.5, -1], amp: 0.3 },
    weather: () => ({ turbulence: 0.05, rain: 0, fog: 0.15, intensity: 0.1, night: 0.95, flash: 0, stElmo: 0 }),
    env: { sunDir: [0.1, 0.4, 0.9], palette: NIGHT_PALETTE }, settings: { assist: 'full', difficulty: 'pilot', quality: 'low' },
    world: { pads: [{ type: 'pad', position: [0, 4, 0], radius: 12, services: { fuel: 25, resupply: false } }] },
    survivors: [{ id: 7, type: 'injured', position: [-28, 0, 22], velocity: [0.05, 0, 0], remaining: 1, spotted: true },
      { id: 8, type: 'swimmer', position: [-30, 0, -35], velocity: [0, 0, 0.1], remaining: 1, spotted: true }],
    mission: { radius: 120 },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { pad: 0 } } } }, { op: 'fuel', value: 0.5 }] },
    pilot(frame, ctx, h) {
      const s = ctx.survivors.list[0];
      const w = h.winch;
      const pad = ctx.world.pads[0];
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [], mouse: [0, -0.1], mouseMoved: false };
      if (frame === 5) u.pressed.push('searchlight');
      if (phase === 'climb') {
        u.lift = 1;
        if (h.altTarget > 12) { phase = 'fly'; u.pressed.push('altPreset1'); }
      } else if (phase === 'fly') {
        Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.06, kd: 0.18 }));
        if (u.d < 2 && h.speed < 0.8) phase = 'winch';
      } else if (phase === 'winch') {
        Object.assign(u, steer(h, s.position.x, s.position.z, { useHoist: true, kp: 0.05, kd: 0.25, max: 0.3 }));
        if (!w.load) u.down.push('winch');
        if (h.cabin.length) phase = 'home';
      } else if (phase === 'home') {
        Object.assign(u, steer(h, pad.position.x, pad.position.z, { kp: 0.06, kd: 0.14 }));
        if (u.d < 8) u.lift = -1;
        if (h.landed) phase = 'pad';
      } else if (phase === 'pad') {
        if (!h.cabin.length && h.fuel >= 1 && frame % 60 === 0) { phase = 'out'; u.pressed.push('altPreset1'); }
      } else if (phase === 'out') {
        const s2 = ctx.survivors.list[1];
        Object.assign(u, steer(h, s2.position.x, s2.position.z, { useHoist: true, kp: 0.06, kd: 0.16 }));
        if (u.d < 2 && h.speed < 0.8) phase = 'out2';
      } else if (phase === 'out2') {
        const s2 = ctx.survivors.list[1];
        Object.assign(u, steer(h, s2.position.x, s2.position.z, { useHoist: true, kp: 0.05, kd: 0.25, max: 0.3 }));
        if (!w.load && h.alive) u.down.push('winch');
        if (w.load && w.length < 9 && h.alive && !h.crash) u.pokes = [{ op: 'damage', amount: 5, source: 'debris' }];
      }
      u.phase = phase;
      return u;
    },
  };
}

// camera-centred runs ---------------------------------------------------------------------------------
// attract → briefing → play (mission start bars, chapters, zoom presses, focus, punch, shake, slow-mo)
function scRigModes() {
  return {
    id: 'modes', seed: 77, frames: 1500, every: 6, dt: jitterDt, mode0: 'title', autostart: false,
    sea: { Hs: 0.4, swellAdd: 0.4, Q: 0.25, clearing: 0 }, wind: { base: [2, 1], amp: 0.4 },
    weather: (frame) => ({ turbulence: 0.05, rain: 0, fog: 0, intensity: frame > 900 ? 0.7 : 0.05, night: 0, flash: 0, stElmo: 0 }),
    env: { sunDir: [0.4, 0.8, 0.1], palette: DAY_PALETTE }, settings: { assist: 'standard', reduceMotion: true, screenShake: 0.6 },
    world: { pads: [{ type: 'pad', position: [10, 5, -20], radius: 12, heading: -0.4, refuel: true }], lighthouse: [-120, 90] },
    mission: { radius: 600 },
    survivors: [{ id: 9, type: 'raft', position: [90, 0, -120], remaining: 2, spotted: true }],
    hazards: { vortices: [{ type: 'tornado', position: [150, 0, -150], core: 30 }], imminent: { type: 'tornado', position: [150, 0, -150], t0: 18, t1: 21 } },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { pad: 0 } } } }],
      300: [{ op: 'mode', to: 'briefing' }],
      420: [{ op: 'mode', to: 'play' }, { op: 'emit', name: 'mission:start', payload: { def: {} } }, { op: 'emit', name: 'mission:chapter', payload: { n: 1, text: 'a', title: 'b' } }],
      640: [{ op: 'emit', name: 'mission:chapter', payload: { n: 2, text: 'c', title: 'd' } }, { op: 'focus', position: [90, 0, -120], duration: 3 }],
      760: [{ op: 'punch', delta: 3, duration: 0.2 }, { op: 'shake', strength: 0.7, duration: 1.5 }],
      820: [{ op: 'slowMo', scale: 0.5, duration: 0.8, key: 'test' }],
      830: [{ op: 'slowMo', scale: 0.2, duration: 0.8, key: 'test' }],
      900: [{ op: 'emit', name: 'hazard:warning', payload: { type: 'tornado', text: 'СМЕРЧ' } }, { op: 'emit', name: 'weather:gust', payload: { dir: [0, 1], strength: 14, eta: 0.5, x: 0, z: 0, harmless: false } }],
      1100: [{ op: 'emit', name: 'weather:lightning', payload: { x: 60, z: -60, distance: 'NaN', strength: 1, cloudOnly: false } }],
      1200: [{ op: 'rigMode', mode: 'attract' }], 1300: [{ op: 'rigMode', mode: 'follow' }] },
    pilot(frame, ctx, h) {
      let u = { moveX: 0, moveY: 0, lift: 0, down: [], pressed: [] };
      if (frame > 450 && frame < 560) u.lift = 1;
      if (frame > 560) { u.moveX = 0.7 * Math.sin(frame * 0.01); u.moveY = 0.6; }
      if (frame === 500 || frame === 700 || frame === 1000) u.pressed.push('zoom');
      if (frame > 1000 && frame < 1060) u.lift = 1;
      return u;
    },
  };
}

// debrief cinematic, then photo mode (mouse orbit / pan, keys, sticks, wheel, LB/RB) and back
function scRigPhoto() {
  return {
    id: 'photo', seed: 5531, frames: 1200, every: 6, dt: jitterDt, mode0: 'play', autostart: true,
    sea: { Hs: 1.8, swellAdd: 0.5, Q: 0.45, clearing: 0 }, wind: { base: [4, 4], amp: 1 },
    weather: () => ({ turbulence: 0.2, rain: 0, fog: 0, intensity: 0.4, night: 0.6, flash: 0, stElmo: 0 }),
    env: { palette: NIGHT_PALETTE }, settings: { assist: 'standard' },
    mission: { radius: 300 },
    pokes: { 1: [{ op: 'emit', name: 'mission:setup', payload: { def: { heli: { x: -20, z: 40, altitude: 60, heading: 2 } } } }, { op: 'emit', name: 'mission:start', payload: { def: {} } }],
      1000: [{ op: 'mode', to: 'debrief' }] },
    pilot(frame) {
      const u = { moveX: 0.3, moveY: 0.2, lift: 0, down: [], pressed: [] };
      if (frame >= 200 && frame < 900) {
        u.photo = true;
        const k = frame - 200;
        u.mouse = [Math.sin(k * 0.02) * 0.5, Math.cos(k * 0.015) * 0.4];
        u.mouseButtons = k < 150 ? ['Mouse0'] : k < 300 ? ['Mouse2'] : k < 380 ? ['Mouse0'] : [];
        u.shift = k >= 330 && k < 380;
        u.axes = { moveX: k > 400 && k < 480 ? 0.8 : 0, moveY: k > 450 && k < 520 ? -0.6 : 0, aimX: k > 520 && k < 580 ? 0.7 : 0, aimY: k > 560 && k < 620 ? -1 : 0, lift: k > 600 && k < 660 ? 1 : 0 };
        if (k === 420 || k === 430) u.photoWheel = 1;
        if (k === 440) u.photoWheel = -1;
        u.padLB = k > 640 && k < 670; u.padRB = k > 670 && k < 690;
      }
      return u;
    },
  };
}

// ------------------------------------------------------------------------------------------- writers
function writeRun(domain, name, sc, extraSetup = {}) {
  const r = run(sc);
  const nf = r.fields.length + 1;
  // split off the input columns that never change
  const nIn = INPUT_FIELDS.length;
  const consts = {};
  const keep = [];
  INPUT_FIELDS.forEach((f, j) => {
    const v0 = r.inputs[j];
    let same = true;
    for (let i = j; i < r.inputs.length; i += nIn) if (!Object.is(r.inputs[i], v0)) { same = false; break; }
    if (same) consts[f] = num(v0); else keep.push(j);
  });
  const inp = { fields: keep.map((j) => INPUT_FIELDS[j]), consts, rows: [] };
  for (let i = 0; i < r.inputs.length; i += nIn) for (const j of keep) inp.rows.push(r.inputs[i + j]);
  const setup = {
    seed: sc.seed, frames: sc.frames, every: sc.every, mode0: sc.mode0 || 'play', autostart: !!sc.autostart, detail: sc.detail ?? 1,
    ocean: { wavebank: 'setQuality(8, 300); setSeed(303, 0.6); every frame BEFORE the heli: update(dt, t, sea, 0.6, 1, 0, 0)', sea: sc.sea },
    weather: { wind: sc.wind, windAt: 'base + amp·(sin(0.3t + 0.002x), cos(0.21t + 0.002z)), t = game time this frame', env: sc.env || {} },
    settings: sc.settings || {}, world: sc.world || {}, survivors: sc.survivors || [], hazards: sc.hazards || null, mission: sc.mission || null,
    look: 'cloudAt(x, z) = 0.5 + 0.5·sin(0.01x)·cos(0.013z)',
    camera: 'PerspectiveCamera(40, 1280/720, 2, 1200), position (0, 220, 60), lookAt(0, 0, 0); viewport 1280×720',
    frame: 'pokes; dt = paused ? 0 : realDt·timeScale; t += dt; world/survivors/hazards advance(dt); weather state; bank.update; input; heli.update(dt); rig.update(realDt)',
    ...extraSetup,
  };
  out(domain, name, {
    files: FILES, tolerance: CHAOS,
    data: {
      setup,
      enums: { modes: MODES, devices: DEVICES, actions: ACTIONS, winchStates: WINCH_STATES, aimSources: AIM_SOURCES, denied: DENIED },
      inputFields: inp.fields,
      inputConst: inp.consts,
      inputConstNote: 'input fields equal on every frame (not in the sidecar)',
      inputs: sidecar(domain, `${name}_inputs.f32`, Float32Array.from(inp.rows), [sc.frames, inp.fields.length]),
      realDt: sidecar(domain, `${name}_realdt.f64`, Float64Array.from(r.realDts), [sc.frames]),
      pokes: r.pokesOut,
      stateFields: ['frame', ...r.fields.map(([n]) => n)],
      states: sidecar(domain, `${name}_states.f64`, Float64Array.from(r.states), [r.states.length / nf, nf]),
      statesNote: 'simulation + camera rows every `every` frames',
      visualFields: ['frame', ...r.vfields.map(([n]) => n)],
      visuals: sidecar(domain, `${name}_visuals.f64`, Float64Array.from(r.visuals), [r.visuals.length / (r.vfields.length + 1), r.vfields.length + 1]),
      visualsNote: 'visual-state rows (rotor, hull, veil, searchlight, lights, crewman, winch render) every 30th frame',
      cable: sidecar(domain, `${name}_cable.f32`, Float32Array.from(r.cables), [r.cables.length / 90, 90]),
      cableNote: 'per `states` row: winch cur (15 × xyz) then rend (15 × xyz)',
      ring: sidecar(domain, `${name}_ring.f32`, Float32Array.from(r.rings), [r.rings.length / 294, 294]),
      ringNote: 'every 30th frame: reach-ring vertex positions (49 × 2 × xyz)',
      glints: sidecar(domain, `${name}_glints.f64`, Float64Array.from(r.glints), [r.glints.length / 6, 6]),
      glintsNote: 'every 12th frame: [frame, index in that frame, gx, gz, radius, intensity] per ocean.addGlint call',
      events: r.evLog,
      fx: r.fxLog,
      ocean: r.oceanLog,
    },
  });
}

async function heli() {
  writeRun('heli', 'heli_rescue', scRescue());
  writeRun('heli', 'heli_storm_crash', scStorm());
  writeRun('heli', 'heli_fuel_ship', scFuel());
  writeRun('heli', 'heli_winch_failures', scWinch());
  writeRun('heli', 'heli_stretcher_ditch', scStretcher());
}

async function camera() {
  writeRun('camera', 'rig_modes', scRigModes());
  writeRun('camera', 'rig_photo', scRigPhoto());

  // --- projection.json: worldToScreen / screenToWater for fixed camera poses ---------------------------
  const R = (() => { const r = M.createRng(31337); return () => r.next(); })();
  const poses = [
    { position: [0, 220, 60], look: [0, 0, 0], fov: 40, aspect: 1280 / 720, rot: [0, 0, 0] },
    { position: [35, 150, 90], look: [30, 0, 40], fov: 41.5, aspect: 16 / 9, rot: [0.004, -0.002, 0.003] },
    { position: [-200, 60, 300], look: [-180, 0, 200], fov: 40, aspect: 844 / 390, rot: [0, 0, 0] },
    { position: [10, 400, 10], look: [10, 0, 9.5], fov: 37, aspect: 4 / 3, rot: [0.01, 0.02, -0.01] },
  ];
  const cases = poses.map((pz) => {
    const cam = new THREE.PerspectiveCamera(pz.fov, pz.aspect, 2, 1200);
    cam.position.set(...pz.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(new THREE.Vector3(...pz.look));
    cam.rotateX(pz.rot[0]); cam.rotateY(pz.rot[1]); cam.rotateZ(pz.rot[2]);
    cam.updateMatrixWorld();
    const ctx = { camera: cam, renderer: { domElement: { clientWidth: 1280, clientHeight: 720 } }, events: new EventBus(), mode: 'play', settings: { get: () => undefined } };
    const rig = new CameraRig(ctx);
    const world = [];
    for (let i = 0; i < 200; i++) world.push([pz.look[0] + (R() - 0.5) * 600, (R() - 0.2) * 60, pz.look[2] + (R() - 0.5) * 600]);
    world.push([pz.position[0], pz.position[1] - 1, pz.position[2] - 0.5], [pz.position[0], pz.position[1] + 50, pz.position[2] + 80]);
    const w2s = world.map((p) => { const o = rig.worldToScreen(new THREE.Vector3(...p)); return [...p.map(num), num(o.x), num(o.y), num(o.ndcX), num(o.ndcY), o.behind ? 1 : 0, o.onScreen ? 1 : 0]; });
    const ndc = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) ndc.push([-1 + i * 0.2, -1 + j * 0.2]);
    ndc.push([0, 1.5], [0.3, 3]);
    const s2w = ndc.map(([x, y]) => { const o = rig.screenToWater(x, y); return [num(x), num(y), num(o.x), num(o.y), num(o.z)]; });
    return { pose: pz, matrixWorld: cam.matrixWorld.elements.map(num), projectionMatrix: cam.projectionMatrix.elements.map(num), worldToScreen: w2s, screenToWater: s2w };
  });
  out('camera', 'projection', {
    files: [relSrc('systems/camera.js')], tolerance: BITWISE,
    data: { setup: 'PerspectiveCamera(fov, aspect, 2, 1200); position; up (0,1,0); lookAt(look); rotateX/Y/Z(rot); updateMatrixWorld(); viewport 1280×720', worldToScreenFields: ['x', 'y', 'z', 'px', 'py', 'ndcX', 'ndcY', 'behind', 'onScreen'], screenToWaterFields: ['ndcX', 'ndcY', 'x', 'y', 'z'], cases },
  });

  // --- shake.json: CameraMotion alone ---------------------------------------------------------------------
  const runs = [];
  for (const seed of [4242, 2024]) {
    const m = new CameraMotion(seed);
    const rows = [];
    const script = [];
    for (let k = 1; k <= 600; k++) {
      const dt = jitterDt(k) * (k > 500 ? 3.5 : 1); // > 0.05 s frames clamp the push spring step
      if (k === 30) { m.addTrauma(0.6, 9); script.push([k, 'addTrauma', 0.6, 9]); }
      if (k === 60) { m.addTrauma(0.3); script.push([k, 'addTrauma', 0.3, null]); }
      if (k === 200) { m.addTrauma(1.4, 13); script.push([k, 'addTrauma', 1.4, 13]); }
      if (k > 300 && k < 400) { m.floor(0.25); if (k === 301) script.push([k, 'floor', 0.25, '301..399']); }
      if (k === 450) { m.gustPush(3, -4, 0.8); script.push([k, 'gustPush', 3, -4, 0.8]); }
      if (k === 520) { m.gustPush(0, 0, 0.5); script.push([k, 'gustPush', 0, 0, 0.5]); }
      const storm = Math.min(1, k / 450);
      const shake = k < 470 ? 1 : 0.5;
      const motion = k < 540 ? 1 : 0.4;
      m.update(dt, storm, shake, motion);
      rows.push(dt, storm, shake, motion, m.pos.x, m.pos.y, m.pos.z, m.rot.x, m.rot.y, m.rot.z, m.trauma, m.freq, m.shakeT, m.push.x, m.push.y, m.pushV.x, m.pushV.y, m.pushT);
    }
    runs.push({ seed, script, rows: sidecar('camera', `shake_${seed}.f64`, Float64Array.from(rows), [600, 18]) });
  }
  out('camera', 'shake', {
    files: [relSrc('systems/camera/shake.js'), relSrc('core/math.js')], tolerance: BITWISE,
    data: { fields: ['dt', 'storm', 'shakeScale', 'motionScale', 'posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'trauma', 'freq', 'shakeT', 'pushX', 'pushY', 'pushVX', 'pushVY', 'pushT'],
      note: 'per frame k: script calls of frame k (floor(0.25) every frame 301..399), then update(dt, storm, shakeScale, motionScale)', runs },
  });
}

// ===================================================================================================== run
const GROUPS = { heli, camera };
for (const [k, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.has(k)) continue;
  const t0 = Date.now();
  await fn();
  console.log(`[${k}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const r of results) console.log(`${r.path}\t${r.bytes}`);
