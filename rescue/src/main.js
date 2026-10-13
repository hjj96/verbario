// Bootstrap: renderer, shared ctx, system loading and the main loop.
// Every gameplay/visual system lives in src/systems/*.js and follows the contract in src/CONTRACT.md.
import * as THREE from 'three';
import { EventBus } from './core/events.js';
import { Input } from './core/input.js';
import { createRng, createNoise2D } from './core/math.js';
import { Settings } from './core/settings.js';
import * as Stubs from './core/stubs.js';

// Update order matters: producers of state run before consumers.
// [ctx key, module path, export name]
const SYSTEMS = [
  ['weather', './systems/weather.js', 'Weather'],
  ['ocean', './systems/ocean.js', 'Ocean'],
  ['world', './systems/world.js', 'World'],
  ['hazards', './systems/hazards.js', 'Hazards'],
  ['heli', './systems/heli.js', 'Helicopter'],
  ['survivors', './systems/survivors.js', 'Survivors'],
  ['fx', './systems/fx.js', 'Effects'],
  ['cameraRig', './systems/camera.js', 'CameraRig'],
  ['radio', './systems/radio.js', 'Radio'],
  ['mission', './systems/mission.js', 'Mission'],
  ['audio', './systems/audio.js', 'AudioEngine'],
  ['hud', './systems/hud.js', 'Hud'],
  ['post', './systems/post.js', 'PostFX'],
];

// Systems that keep running while the game is paused (they receive realDt).
const RUN_WHEN_PAUSED = new Set(['cameraRig', 'audio', 'hud', 'post', 'radio']);

async function loadSystem(path, exportName) {
  try {
    const mod = await import(path);
    if (mod[exportName]) return mod[exportName];
    console.error(`[boot] ${path} does not export ${exportName}, using stub`);
  } catch (err) {
    console.error(`[boot] failed to load ${path}, using stub`, err);
  }
  return Stubs[exportName];
}

async function boot() {
  const container = document.getElementById('game');
  const settings = new Settings();

  const renderer = new THREE.WebGLRenderer({
    antialias: settings.get('quality') !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap()));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = settings.get('quality') !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 1, 4000);
  camera.position.set(0, 220, 60);
  camera.lookAt(0, 0, 0);

  const ctx = {
    THREE,
    renderer,
    scene,
    camera,
    container,
    hudRoot: document.getElementById('hud'),
    settings,
    events: new EventBus(),
    input: new Input(window),
    rng: createRng(1337),
    noise: createNoise2D(1337),
    time: { t: 0, dt: 0, realT: 0, realDt: 0, frame: 0 },
    mode: 'title', // 'title' | 'briefing' | 'play' | 'paused' | 'debrief'
    timeScale: 1,
    debug: new URLSearchParams(location.search).has('debug'),
    params: new URLSearchParams(location.search),
    setMode(mode) {
      if (ctx.mode === mode) return;
      const from = ctx.mode;
      ctx.mode = mode;
      ctx.events.emit('game:mode', { from, to: mode });
    },
  };
  window.__game = ctx; // handy for debugging and automated tests

  // Construct all systems (constructors must not depend on other systems).
  const classes = await Promise.all(SYSTEMS.map(([, path, name]) => loadSystem(path, name)));
  const order = [];
  SYSTEMS.forEach(([key], i) => {
    try {
      ctx[key] = new classes[i](ctx);
    } catch (err) {
      console.error(`[boot] constructing ${key} failed, using stub`, err);
      ctx[key] = new Stubs[SYSTEMS[i][2]](ctx);
    }
    order.push(key);
  });

  // init() may reference other systems and may be async (procedural texture generation etc.).
  for (const key of order) {
    try {
      await ctx[key].init?.();
    } catch (err) {
      console.error(`[boot] init of ${key} failed`, err);
    }
  }

  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap()));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const key of order) ctx[key].resize?.(w, h);
  };
  window.addEventListener('resize', onResize);
  settings.onChange(() => onResize());

  ctx.events.emit('game:ready', {});
  document.body.classList.add('ready');

  let last = performance.now();
  const failed = new Set();
  function frame() {
    const now = performance.now();
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const paused = ctx.mode === 'paused';
    const dt = paused ? 0 : realDt * ctx.timeScale;
    ctx.time.realDt = realDt;
    ctx.time.realT += realDt;
    ctx.time.dt = dt;
    ctx.time.t += dt;
    ctx.time.frame++;

    ctx.input.poll();
    for (const key of order) {
      const sys = ctx[key];
      if (!sys.update || failed.has(key)) continue;
      if (paused && !RUN_WHEN_PAUSED.has(key)) continue;
      try {
        sys.update(RUN_WHEN_PAUSED.has(key) ? realDt : dt);
      } catch (err) {
        // Keep the game alive; report each failing system once.
        console.error(`[loop] ${key}.update failed — system disabled`, err);
        failed.add(key);
      }
    }

    try {
      if (ctx.post && ctx.post.render) ctx.post.render(realDt);
      else renderer.render(scene, camera);
    } catch (err) {
      console.error('[loop] render failed', err);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const el = document.getElementById('fatal');
  if (el) {
    el.hidden = false;
    el.textContent = 'Не удалось запустить игру: ' + (err && err.message ? err.message : err);
  }
});
