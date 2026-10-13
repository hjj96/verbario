// Minimal fallback implementations of every system. main.js uses them when a real module fails
// to load/construct. They also document the minimum surface other systems can rely on.
import * as THREE from 'three';

const noop = () => {};

export class Weather {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = {
      preset: 'calm', intensity: 0, windDir: new THREE.Vector2(1, 0), windSpeed: 4, gust: 0,
      rain: 0, fog: 0, hail: 0, lightning: 0, waveHeight: 0.6, waveChoppiness: 0.3, night: 0,
      timeOfDay: 0.4, flash: 0, visibility: 3000, sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
      palette: {
        sky: new THREE.Color('#9fb8c4'), fogColor: new THREE.Color('#9fb8c4'), deep: new THREE.Color('#0d3b4f'),
        shallow: new THREE.Color('#2a7f8f'), foam: new THREE.Color('#eef4f2'), sun: new THREE.Color('#fff1d6'),
        ambient: new THREE.Color('#8fa7b3'), accent: new THREE.Color('#ff6a3d'),
        body: new THREE.Color('#17586A'), crest: new THREE.Color('#4FB3AC'), ambientGround: new THREE.Color('#0A2A36'),
        spec: new THREE.Color('#FFE9C6'), shadowTint: new THREE.Color('#12313D'),
        sunIntensity: 2.2, ambientIntensity: 0.9, shadowIntensity: 0.75, fogNear: 260, fogFar: 950, exposure: 1, envIntensity: 1,
        sea: { Hs: 0.6, swellAdd: 0.4, Q: 0.25, detail: 0.25, whitecaps: 0, streaks: 0, foamLines: 0, roughness: 0.05 },
        post: {
          bloomStrength: 0.3, bloomRadius: 0.45, bloomThreshold: 1.1, saturation: 1.05, contrast: 1.05,
          slope: new THREE.Vector3(1, 1, 1), offset: new THREE.Vector3(), power: 1, splitShadow: new THREE.Color('#0F3640'),
          splitHighlight: new THREE.Color('#FFE2BC'), splitStrength: 0.15, vignette: 0.22, vignetteColor: new THREE.Color('#000'),
          grain: 0.025, ca: 0.4, drops: 0,
        },
      },
      sunDirVisual: new THREE.Vector3(0.4, 0.3, -0.8).normalize(),
      front: { origin: new THREE.Vector2(), dir: new THREE.Vector2(1, 0), speed: 20, width: 120, active: false, t: 0 },
      greenTint: 0, stElmo: 0, pressure: 1016, gustFronts: [], turbulence: 0.3, beaufort: 2, seaState: 1,
    };
    this.state.palettePrev = this.state.palette;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(100, 200, 80);
    this.hemi = new THREE.HemisphereLight(0xbfd6e0, 0x0d3b4f, 0.9);
    ctx.scene.add(this.sun, this.hemi);
    ctx.scene.background = this.state.palette.sky.clone();
  }
  windAt(x, z, out) { return out.copy(this.state.windDir).multiplyScalar(this.state.windSpeed); }
  setPreset(name) { this.state.preset = name; }
  setGreenTint() {}
  runScript() {}
  forecast() { return []; }
  strikeLightning() {}
  update() {}
}

export class Ocean {
  constructor(ctx) {
    this.ctx = ctx;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0d3b4f, roughness: 0.4 }),
    );
    ctx.scene.add(this.mesh);
  }
  heightAt() { return 0; }
  setSearchlight() {}
  searchlightAt() { return 0; }
  setGlints() {}
  setFeature() {}
  removeFeature() {}
  stamp() {}
  normalAt(x, z, out) { return out.set(0, 1, 0); }
  velocityAt(x, z, out) { return out.set(0, 0); }
  splash() {}
  setDownwash() {}
  addWake() {}
  update() {}
}

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.pads = [];
    this.obstacles = [];
    ctx.events.on('mission:setup', ({ def }) => this._setup(def));
  }
  _setup(def) {
    for (const p of this.pads) this.ctx.scene.remove(p.object3d);
    this.pads = (def.world?.pads || [{ type: 'ship', x: 0, z: 0, name: 'Судно' }]).map((p, i) => {
      const obj = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 4, 24), new THREE.MeshStandardMaterial({ color: 0x555555 }));
      obj.position.set(p.x, 2, p.z);
      this.ctx.scene.add(obj);
      return { id: i, name: p.name || 'Площадка', type: p.type || 'ship', position: new THREE.Vector3(p.x, 4, p.z), radius: 12, refuel: true, heading: 0, object3d: obj };
    });
  }
  padAt(x, z) { return this.pads.find((p) => Math.hypot(p.position.x - x, p.position.z - z) < p.radius) || null; }
  nearestPad(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.pads) { const d = Math.hypot(p.position.x - x, p.position.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  update() {}
}

export class Hazards {
  constructor(ctx) { this.ctx = ctx; this.list = []; }
  spawn() { return null; }
  clear() { this.list.length = 0; }
  forceAt(x, z, alt, out) { return out.set(0, 0, 0); }
  surfaceFlowAt(x, z, out) { return out.set(0, 0); }
  waveLiftAt() { return 0; }
  dangerAt() { return 0; }
  update() {}
}

export class Helicopter {
  constructor(ctx) {
    this.ctx = ctx;
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
    this.winch = { state: 'stowed', length: 0, basket: new THREE.Vector3(), steadiness: 1, load: null, speed: 0, swing: 0, target: null, capture: 0 };
    this.rotorRPM = 1;
    this.load = 0.3;
    this.bank = 0;
    this.boost = false;
    this.engineTemp = 0;
    this.flares = 4;
    this.rafts = 2;
    this.emp = 0;
    this.aim = new THREE.Vector3();
    this.altTarget = 40;
    this.group = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 10), new THREE.MeshStandardMaterial({ color: 0xff5a2a }));
    ctx.scene.add(this.group);
  }
  reset(spawn = {}) { this.position.set(spawn.x || 0, 40, spawn.z || 0); this.velocity.set(0, 0, 0); }
  applyImpulse(v) { this.velocity.add(v); }
  damage(a) { this.hull = Math.max(0, this.hull - a); }
  addFuel(a) { this.fuel = Math.min(1, this.fuel + a); }
  update(dt) {
    if (this.ctx.mode !== 'play') return;
    const m = this.ctx.input.move();
    this.velocity.x += m.x * 20 * dt;
    this.velocity.z -= m.y * 20 * dt;
    this.velocity.multiplyScalar(Math.exp(-0.8 * dt));
    this.position.addScaledVector(this.velocity, dt);
    this.group.position.copy(this.position);
    this.winch.basket.copy(this.position);
  }
}

export class Survivors {
  constructor(ctx) { this.ctx = ctx; this.list = []; this.datums = []; }
  spawn() { return null; }
  clear() { this.list.length = 0; }
  nearestFor() { return null; }
  attachToBasket() {}
  detachFromBasket() {}
  boardOne() { return { name: 'Пострадавший', age: 30, condition: 'стабилен' }; }
  remainingCount() { return 0; }
  rescuedCount() { return 0; }
  lostCount() { return 0; }
  update() {}
}

export class Effects {
  constructor(ctx) { this.ctx = ctx; }
  splash() {}
  spray() {}
  smoke() {}
  sparks() {}
  flare() {}
  burst() {}
  update() {}
}

export class CameraRig {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'follow';
    this.zoom = 1;
    this.letterbox = 0;
    this._v = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }
  screenToWater(ndcX, ndcY, out = new THREE.Vector3()) {
    this._ray.setFromCamera({ x: ndcX, y: ndcY }, this.ctx.camera);
    return this._ray.ray.intersectPlane(this._plane, out) || out.set(0, 0, 0);
  }
  shake() {}
  punch() {}
  focus() {}
  worldToScreen(v, out = {}) {
    this._v.copy(v).project(this.ctx.camera);
    out.x = (this._v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
    out.behind = this._v.z > 1;
    out.onScreen = !out.behind && Math.abs(this._v.x) <= 1 && Math.abs(this._v.y) <= 1;
    return out;
  }
  update() {
    const h = this.ctx.heli;
    if (!h) return;
    this.ctx.camera.position.set(h.position.x, h.position.y + 180, h.position.z + 50);
    this.ctx.camera.lookAt(h.position.x, 0, h.position.z);
  }
}

export class Radio {
  constructor(ctx) { this.ctx = ctx; }
  say(speaker, text, opts = {}) {
    this.ctx.events.emit('radio:line', {
      speaker, text, name: opts.name || speaker, channel: opts.channel || 'ics', id: opts.id || null,
      duration: opts.duration || 4, priority: opts.priority || 1,
    });
  }
  line() {}
  update() {}
}

export class Mission {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.def = null;
    this.score = 0;
    this.stats = { rescued: 0, lost: 0, time: 0 };
    this.objectives = [];
  }
  init() {
    // Without a real mission system: jump straight into free flight.
    this.start(0);
    this.launch();
  }
  start() {
    this.def = {
      id: 'stub', index: 0, title: 'Свободный полёт', brief: '', seed: 1, area: { radius: 1500 }, timeOfDay: 0.4,
      weather: { start: 'calm', script: [] }, world: { pads: [{ type: 'ship', x: 0, z: 0, name: 'Судно' }], props: {} },
      heli: { pad: 0 }, survivors: [], hazards: [], objectives: { rescue: 0, timeLimit: 0 },
    };
    this.ctx.events.emit('mission:setup', { def: this.def });
    this.ctx.setMode('briefing');
  }
  launch() { this.ctx.setMode('play'); }
  update() {}
}

export class AudioEngine {
  constructor(ctx) { this.ctx = ctx; }
  unlock() {}
  play() {}
  setMuted() {}
  update() {}
}

export class Hud {
  constructor(ctx) { this.ctx = ctx; }
  update() {}
}

export class PostFX {
  constructor(ctx) { this.ctx = ctx; }
  render() { this.ctx.renderer.render(this.ctx.scene, this.ctx.camera); }
  pulse() {}
  resize() {}
}
