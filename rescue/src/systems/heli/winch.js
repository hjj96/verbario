// Rescue winch (DESIGN §2.9, §3.5): hold Space to pay out (4 m/s) to the target surface (water or deck)
// + 1.5 m slack, max 30 m, auto stop; release before capture → reel in at 4 m/s; after capture the
// lift is automatic (3 m/s person, 1.5 m/s stretcher); presses buffer for 0.4 s while the height /
// speed window opens. 14-segment verlet cable with wind, game gravity 14 m/s², basket drift
// (0.8·wind_surface − v_b)·0.8, damping 0.15 s⁻¹, never below the surface.
//
// Steadiness S = clamp(1 − 0.12·|v_basket − v_target| − 0.05·|v_heli| − 0.3·[crest ≥ 6 m], 0, 1),
// smoothed 0.3 s. Capture via survivors.nearestFor / attachToBasket / boardOne (CONTRACT).
// Failures: slip («Сорвался!»), snag («ТРОС ЗАХЛЕСТНУЛО»), tension («НАТЯЖЕНИЕ ТРОСА»).
import * as THREE from 'three';
import { createCableMaterial, createRingMaterial } from './materials.js';
import { tube } from './shapes.js';

export const SEGS = 14;
const N = SEGS + 1;
const G = 14; // game gravity
const MAX_LEN = 30;
const SLACK = 1.5;
const PAY = 4;
const LIFT_PERSON = 3;
const LIFT_STRETCHER = 1.5;
const BUFFER = 0.4;
const DAMP = 0.15;
const WINDOW_SPEED = 5; // m/s ground speed to start lowering
const WINDOW_HEIGHT = MAX_LEN + SLACK + 4.5; // hoist height above the surface
const BASKET_FLOAT = 0.25; // basket centre above the surface when it sits in the water
const HOOK = 1.05; // bridle hook above the basket centre
const RING_SEGS = 48;

// [capture radius m, time s] per target type (DESIGN §3.5 table)
const CAPTURE = {
  swimmer: [3, 1.0],
  raft: [4.5, 0.8],
  hull: [3, 1.0],
  container: [3, 1.0],
  deck: [3, 1.0],
  wreck: [3, 1.0],
  plane: [3, 1.0],
  injured: [3, 3.0],
};
const MAX_CAPTURE_R = 4.5;

// Cable snag on flotsam (DESIGN §3.5 «ТРОС ЗАХЛЕСТНУЛО» [SHOULD]): contact radii of floating props
// (world floaters by shape, hazard debris by kind). Moored buoys, containers (rescue targets) and toy
// ducks never snag the cable.
const SNAG_R_FLOAT = { plank: 0.9, barrel: 0.6, ring: 0.55, canister: 0.45, kayak: 1.1, paddle: 0.7, suitcase: 0.5, fender: 0.45, fishbox: 0.55, float: 0.35, sail: 1.6 };
const SNAG_R_DEBRIS = { board: 1.2, barrel: 0.6, buoy: 0.65, boat: 2.4 };
const SNAG_CABLE = 0.55; // cable + basket half-width
const SNAG_SETTLE = 0.8; // s in the water before a crossing counts (items already there don't)
const SNAG_COOLDOWN = 15; // s between debris snags

export class Winch {
  constructor(ctx, heli) {
    this.ctx = ctx;
    this.heli = heli;
    // Public object (CONTRACT heli.winch) — same object for the whole session.
    this.pub = heli.winch;
    Object.assign(this.pub, {
      state: 'stowed',
      length: 0,
      basket: new THREE.Vector3(),
      steadiness: 1,
      load: null,
      speed: 0,
      swing: 0,
      target: null,
      capture: 0,
      // extras for HUD/audio
      tension: 0, // 0..1 progress of the tension auto-retract timer
      jammed: 0, // seconds the winch stays jammed (snag)
      surfaceY: 0, // surface height under the basket (water or deck)
      height: 0, // basket height above that surface
      inRange: false, // a person is inside the capture radius
      radius: 3, // current capture radius (for the reach ring / HUD sight)
      stretcher: false,
      cabinFull: false,
      denied: null, // 'high' | 'fast' | 'landed' | 'full' — why a press did nothing (briefly)
    });

    this.cur = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.stepPrev = new Float32Array(N * 3); // positions at the start of the last fixed step
    this.rend = new Float32Array(N * 3); // interpolated for rendering
    this.held = false;
    this.buffer = 0;
    this.pending = false;
    this.grace = 0;
    this.slipT = 0;
    this.tensionT = 0;
    this.tensionOn = false;
    this.autoRetract = false;
    this.deniedT = 0;
    this.fullWarned = false;
    this.spin = 0;
    this.spinRate = 0;
    this._hoist = new THREE.Vector3();
    this._vb = new THREE.Vector3();
    this._w = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._tv = new THREE.Vector3();
    this.basketVel = new THREE.Vector3();
    this.snagWet = 0; // s the empty basket has been at the water
    this.snagCd = 0;
    this.snagInside = new Set(); // flotsam currently touching the cable (a crossing = a new entry)

    this._buildVisuals();
  }

  // ----------------------------------------------------------------------------------------------
  _buildVisuals() {
    const { scene, look } = this.ctx;
    // Cable ribbon: 2 vertices per verlet point.
    const n = N * 2;
    const g = new THREE.BufferGeometry();
    this.cablePos = new Float32Array(n * 3);
    this.cableOther = new Float32Array(n * 3);
    const side = new Float32Array(n);
    const dir = new Float32Array(n);
    const v = new Float32Array(n);
    for (let i = 0; i < N; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      dir[i * 2] = dir[i * 2 + 1] = i < N - 1 ? 1 : -1;
      v[i * 2] = v[i * 2 + 1] = i / (N - 1);
    }
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.cablePos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aOther', new THREE.BufferAttribute(this.cableOther, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 1));
    g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    g.setIndex(idx);
    this.cableMat = createCableMaterial(look);
    this.cable = new THREE.Mesh(g, this.cableMat);
    this.cable.name = 'heli.cable';
    this.cable.frustumCulled = false;
    this.cable.matrixAutoUpdate = false;
    this.cable.visible = false;
    scene.add(this.cable);

    // Basket: orange wire cage with a flotation collar and a 4-leg bridle (×1.4 perceptual scale).
    const O = '#FF5A1F';
    const D = '#2E3338';
    const parts = [];
    const L = 0.5;
    const W = 0.3;
    const H = 0.21;
    const r = 0.022;
    const edge = (a, b, rad = r, color = O) => parts.push({ geometry: tube(a, b, rad, rad, 4), color });
    for (const y of [-H, H]) {
      edge([-W, y, -L], [W, y, -L]);
      edge([-W, y, L], [W, y, L]);
      edge([-W, y, -L], [-W, y, L], y > 0 ? 0.055 : r); // flotation collar on top long edges
      edge([W, y, -L], [W, y, L], y > 0 ? 0.055 : r);
    }
    for (const x of [-W, W]) for (const z of [-L, L]) edge([x, -H, z], [x, H, z]);
    for (const z of [-L / 3, L / 3]) {
      edge([-W, -H, z], [-W, H, z]);
      edge([W, -H, z], [W, H, z]);
      edge([-W, -H, z], [W, -H, z]);
    }
    parts.push({ geometry: new THREE.BoxGeometry(W * 2, 0.025, L * 2), position: [0, -H, 0], color: D });
    for (const x of [-W, W]) for (const z of [-L, L]) edge([x, H, z], [0, HOOK, 0], 0.012, '#C9CED2');
    parts.push({ geometry: new THREE.SphereGeometry(0.06, 6, 4), position: [0, HOOK, 0], color: '#C9CED2' });
    const bg = look.merge(parts);
    this.basketMesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
    this.basketMesh.name = 'heli.basket';
    this.basketMesh.scale.setScalar(1.4);
    this.basketMesh.castShadow = true;
    this.basketMesh.visible = false;
    scene.add(this.basketMesh);

    // Rescue swimmer riding the hook beside the basket [NICE] (DESIGN §2.9): wetsuit #15181A,
    // helmet #FF5A1F, one hand on the strop. Origin = the bridle hook.
    const K = '#15181A';
    const cap = (a, b, r) => parts2.push({ geometry: tube(a, b, r, r, 6), color: K });
    const parts2 = [];
    parts2.push({ geometry: tube([0, 0, 0], [0.42, -0.55, 0.05], 0.014, 0.014, 4), color: '#C9CED2' });
    parts2.push({ geometry: new THREE.CapsuleGeometry(0.19, 0.42, 3, 8), position: [0.5, -0.78, 0.05], rotation: [0, 0, 0.12], color: K });
    parts2.push({ geometry: new THREE.SphereGeometry(0.15, 10, 8), position: [0.47, -0.34, 0.06], color: '#FF5A1F' });
    parts2.push({ geometry: new THREE.BoxGeometry(0.2, 0.06, 0.04), position: [0.47, -0.36, -0.08], color: '#0B1B26' });
    cap([0.43, -1.02, 0.1], [0.36, -1.38, -0.12], 0.075);
    cap([0.36, -1.38, -0.12], [0.36, -1.72, 0.0], 0.07);
    cap([0.6, -1.02, 0.0], [0.66, -1.4, -0.05], 0.075);
    cap([0.66, -1.4, -0.05], [0.64, -1.74, 0.08], 0.07);
    cap([0.36, -0.58, 0.05], [0.2, -0.3, 0.02], 0.06);
    cap([0.2, -0.3, 0.02], [0.08, -0.08, 0.0], 0.055);
    cap([0.66, -0.6, 0.05], [0.84, -0.86, 0.12], 0.06);
    cap([0.84, -0.86, 0.12], [0.8, -1.12, 0.2], 0.055);
    parts2.push({ geometry: new THREE.BoxGeometry(0.42, 0.08, 0.3), position: [0.5, -0.64, 0.05], color: '#FF5A1F' }); // harness
    this.rescuer = new THREE.Mesh(look.merge(parts2), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    this.rescuer.name = 'heli.rescueSwimmer';
    this.rescuer.scale.setScalar(1.4);
    this.rescuer.castShadow = true;
    this.rescuer.visible = false;
    scene.add(this.rescuer);

    // Reach ring on the water (dashed, capture radius).
    const rg = new THREE.BufferGeometry();
    const rv = (RING_SEGS + 1) * 2;
    this.ringPos = new Float32Array(rv * 3);
    const ang = new Float32Array(rv);
    const edgeA = new Float32Array(rv);
    for (let i = 0; i <= RING_SEGS; i++) {
      ang[i * 2] = ang[i * 2 + 1] = i / RING_SEGS;
      edgeA[i * 2] = 0;
      edgeA[i * 2 + 1] = 1;
    }
    const ri = [];
    for (let i = 0; i < RING_SEGS; i++) {
      const a = i * 2;
      ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    rg.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
    rg.setAttribute('aEdge', new THREE.BufferAttribute(edgeA, 1));
    rg.setIndex(ri);
    this.ringMat = createRingMaterial();
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.name = 'heli.reachRing';
    this.ring.frustumCulled = false;
    this.ring.matrixAutoUpdate = false;
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringOpacity = 0;
    this.ringHeights = new Float32Array(RING_SEGS + 1);
    this.ringOrange = 0;
    this._cOrange = new THREE.Color('#FF5A1F').multiplyScalar(1.6);
    this._cPale = new THREE.Color('#E8E4D8');
  }

  // ----------------------------------------------------------------------------------------------
  reset() {
    const w = this.pub;
    if (w.load) this.ctx.survivors?.detachFromBasket?.(w.load);
    w.state = 'stowed';
    w.length = 0;
    w.load = null;
    w.target = null;
    w.capture = 0;
    w.speed = 0;
    w.swing = 0;
    w.tension = 0;
    w.jammed = 0;
    this.snagWet = 0;
    this.snagCd = 0;
    this.snagInside.clear();
    w.steadiness = 1;
    w.inRange = false;
    w.stretcher = false;
    w.cabinFull = false;
    w.denied = null;
    this.buffer = 0;
    this.pending = false;
    this.grace = 0;
    this.slipT = 0;
    this.tensionT = 0;
    this.tensionOn = false;
    this.autoRetract = false;
    this._pinAll(this.heli.hoistWorld);
  }

  _pinAll(p) {
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      this.cur[k] = this.prev[k] = this.stepPrev[k] = p.x;
      this.cur[k + 1] = this.prev[k + 1] = this.stepPrev[k + 1] = p.y;
      this.cur[k + 2] = this.prev[k + 2] = this.stepPrev[k + 2] = p.z;
    }
    this.pub.basket.copy(p);
  }

  // Input sample once per rendered frame (Space held, edge buffered for 0.4 s).
  input(held, pressed) {
    this.held = held;
    if (pressed) {
      this.buffer = BUFFER;
      this.pending = true;
    }
  }

  _setState(s, extra) {
    const w = this.pub;
    if (w.state === s) return;
    w.state = s;
    this.ctx.events.emit('heli:winch', { state: s, load: w.load, ...(extra || {}) });
  }

  _deny(reason) {
    this.pub.denied = reason;
    this.deniedT = 1.2;
    this.ctx.events.emit('heli:winch-denied', { reason });
  }

  // Surface under a point: water, a pad deck, or the deck of a structure-type target.
  surfaceAt(x, z) {
    const ctx = this.ctx;
    let y = ctx.ocean?.heightAt ? ctx.ocean.heightAt(x, z) : 0;
    const pad = ctx.world?.padAt?.(x, z);
    if (pad && pad.position) y = Math.max(y, pad.position.y);
    // Decks people stand on (barge, sinking ferry, rig lower deck) wherever the basket is — not only
    // under the current target: a basket swinging off the target must still land on the deck, and
    // the height window counts from the deck (DESIGN §3.5 «на конструкции»).
    const deck = ctx.survivors?.deckAt ? ctx.survivors.deckAt(x, z) : -Infinity;
    if (deck > y) y = deck;
    const sdeck = ctx.world?.deckAt ? ctx.world.deckAt(x, z) : -Infinity; // the rig's open lower deck
    if (sdeck > y) y = sdeck;
    const t = this.pub.target || this.pub.load;
    if (t && t.position && (t.type === 'deck' || t.type === 'wreck')) {
      const d = Math.hypot(t.position.x - x, t.position.z - z);
      if (d < 12) y = Math.max(y, Math.max(t.position.y || 0, t.height || 0));
    }
    return y;
  }

  seatsUsed() {
    let n = 0;
    for (const p of this.heli.cabin) n += p.stretcher ? 2 : 1;
    return n;
  }

  // ----------------------------------------------------------------------------------------------
  // Fixed 60 Hz step. hoist = world position of the cable top this step.
  step(dt, hoist) {
    const h = this.heli;
    const w = this.pub;
    const ctx = this.ctx;
    this.stepPrev.set(this.cur);
    if (this.buffer > 0) this.buffer -= dt;
    if (this.deniedT > 0 && (this.deniedT -= dt) <= 0) w.denied = null;

    const gs = Math.hypot(h.velocity.x, h.velocity.z);
    const prevLen = w.length;
    const wantDown = (this.held || this.buffer > 0) && !this.autoRetract && h.alive && !h.crash;

    // --- length control / state machine -----------------------------------------------------------
    if (w.jammed > 0) {
      w.jammed = Math.max(0, w.jammed - dt);
    } else if (w.state === 'stowed') {
      if (wantDown && ctx.mode === 'play') {
        const surf = this.surfaceAt(hoist.x, hoist.z);
        const reason = h.landed ? 'landed' : hoist.y - surf > WINDOW_HEIGHT ? 'high' : gs > WINDOW_SPEED ? 'fast' : null;
        if (!reason) {
          this.buffer = 0;
          this.pending = false;
          this.fullWarned = false;
          this._setState('lowering');
        } else if (this.pending && this.buffer <= 0) {
          // The 0.4 s buffer ran out and the window is still shut: tell the HUD why (once per press).
          // Holding Space keeps waiting — lowering starts the moment the window opens.
          this.pending = false;
          this._deny(reason);
        }
      }
    } else if (w.state === 'lowering' || w.state === 'down') {
      if (!w.load && !(this.held || this.buffer > 0)) {
        this._setState('raising');
      } else if (!w.load) {
        const surf = this.surfaceAt(w.basket.x, w.basket.z);
        const target = Math.min(MAX_LEN, Math.max(0, hoist.y - surf - BASKET_FLOAT + SLACK));
        const d = target - w.length;
        w.length += Math.sign(d) * Math.min(Math.abs(d), PAY * dt);
        // hysteresis: 'down' once at the surface; back to 'lowering' only if the heli climbs ≥ 1 m
        if (w.state === 'lowering' && Math.abs(d) < 0.08) this._setState('down');
        else if (w.state === 'down' && d > 1) this._setState('lowering');
      }
    }
    if (w.state === 'raising' && w.jammed <= 0) {
      const rate = w.load ? (w.stretcher ? LIFT_STRETCHER : LIFT_PERSON) : PAY;
      w.length = Math.max(0, w.length - rate * dt);
      if (!w.load && wantDown && !this.autoRetract && gs <= WINDOW_SPEED) this._setState('lowering');
      else if (w.length <= 0.02) {
        if (w.load) this._board();
        w.length = 0;
        this.autoRetract = false;
        if (wantDown && gs <= WINDOW_SPEED) this._setState('lowering');
        else this._setState('stowed');
      }
    }
    w.speed = dt > 0 ? (w.length - prevLen) / dt : 0;

    // --- cable physics ------------------------------------------------------------------------------
    if (w.length < 0.05 && w.state === 'stowed') {
      this._pinAll(hoist);
      this.basketVel.set(0, 0, 0);
    } else {
      this._simulate(dt, hoist);
    }

    // --- capture / failures -------------------------------------------------------------------------
    this._capture(dt, gs);
    this._failures(dt, gs);
  }

  _simulate(dt, hoist) {
    const ctx = this.ctx;
    const w = this.pub;
    const cur = this.cur;
    const prev = this.prev;
    const rest = Math.max(0.02, w.length / SEGS);
    const bx = cur[(N - 1) * 3];
    const bz = cur[(N - 1) * 3 + 2];
    const surf = this.surfaceAt(bx, bz);
    w.surfaceY = surf;

    // Wind at the basket (surface wind × profile × c, DESIGN §3.3/§3.5).
    const wind = this._w.set(0, 0);
    if (ctx.weather?.windAt) ctx.weather.windAt(bx, bz, wind);
    const prof = Math.min(1.4, Math.max(0.6, 0.6 + 0.008 * Math.max(0, cur[(N - 1) * 3 + 1] - surf)));
    const wx = wind.x * prof * 0.6;
    const wz = wind.y * prof * 0.6;
    const damp = Math.max(0, 1 - DAMP * dt);
    const dt2 = dt * dt;

    // Pin the top.
    cur[0] = hoist.x;
    cur[1] = hoist.y;
    cur[2] = hoist.z;
    for (let i = 1; i < N; i++) {
      const k = i * 3;
      const basket = i === N - 1;
      let vx = (cur[k] - prev[k]) * damp;
      let vy = (cur[k + 1] - prev[k + 1]) * damp;
      let vz = (cur[k + 2] - prev[k + 2]) * damp;
      // wind drag as an acceleration toward 0.8·wind (basket) / wind (light cable points)
      const kx = basket ? 0.8 : 0.5;
      const ax = (kx * wx - vx / dt) * (basket ? 0.8 : 0.6);
      const az = (kx * wz - vz / dt) * (basket ? 0.8 : 0.6);
      prev[k] = cur[k];
      prev[k + 1] = cur[k + 1];
      prev[k + 2] = cur[k + 2];
      cur[k] += vx + ax * dt2;
      cur[k + 1] += vy - G * dt2;
      cur[k + 2] += vz + az * dt2;
    }
    // Rope constraints: only resist stretching (slack cable may bunch up). Basket is heavy.
    for (let it = 0; it < 12; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = i * 3;
        const b = a + 3;
        const dx = cur[b] - cur[a];
        const dy = cur[b + 1] - cur[a + 1];
        const dz = cur[b + 2] - cur[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= rest || d < 1e-6) continue;
        const ia = i === 0 ? 0 : 1;
        const ib = i + 1 === N - 1 ? 0.15 : 1;
        const sum = ia + ib;
        const corr = (d - rest) / d / sum;
        cur[a] += dx * corr * ia;
        cur[a + 1] += dy * corr * ia;
        cur[a + 2] += dz * corr * ia;
        cur[b] -= dx * corr * ib;
        cur[b + 1] -= dy * corr * ib;
        cur[b + 2] -= dz * corr * ib;
      }
      // Surface: the basket floats, cable points lie on the water.
      for (let i = 1; i < N; i++) {
        const k = i * 3 + 1;
        const floor = surf + (i === N - 1 ? BASKET_FLOAT : 0.05);
        if (cur[k] < floor) cur[k] = floor;
      }
    }
    // Water drag on the floating basket.
    const kb = (N - 1) * 3;
    if (cur[kb + 1] <= surf + BASKET_FLOAT + 0.05) {
      const f = Math.max(0, 1 - 3 * dt);
      prev[kb] = cur[kb] - (cur[kb] - prev[kb]) * f;
      prev[kb + 2] = cur[kb + 2] - (cur[kb + 2] - prev[kb + 2]) * f;
      prev[kb + 1] = cur[kb + 1];
    }
    this.basketVel.set((cur[kb] - prev[kb]) / dt, (cur[kb + 1] - prev[kb + 1]) / dt, (cur[kb + 2] - prev[kb + 2]) / dt);
    w.basket.set(cur[kb], cur[kb + 1], cur[kb + 2]);
    w.height = w.basket.y - BASKET_FLOAT - surf;
    const hx = w.basket.x - hoist.x;
    const hz = w.basket.z - hoist.z;
    w.swing = Math.atan2(Math.hypot(hx, hz), Math.max(0.01, hoist.y - w.basket.y));
  }

  // ----------------------------------------------------------------------------------------------
  _capture(dt, gs) {
    const ctx = this.ctx;
    const w = this.pub;
    const h = this.heli;
    const cadet = ctx.settings.get('difficulty') === 'cadet';
    const mult = cadet ? 1.4 : 1;

    // Steadiness (always computed while the cable is out).
    const t = w.target || w.load;
    const tv = this._tv.set(0, 0, 0);
    if (t && t.velocity) tv.set(t.velocity.x || 0, t.velocity.isVector2 ? 0 : t.velocity.y || 0, t.velocity.isVector2 ? t.velocity.y : t.velocity.z || 0);
    const vrel = this._vb.copy(this.basketVel).sub(tv).length();
    const waterAtBasket = ctx.ocean?.heightAt ? ctx.ocean.heightAt(w.basket.x, w.basket.z) : 0;
    const crest = w.state !== 'stowed' && waterAtBasket >= 6 ? 1 : 0;
    const sRaw = w.state === 'stowed' ? 1 : Math.min(1, Math.max(0, 1 - 0.12 * vrel - 0.05 * gs - 0.3 * crest));
    w.steadiness += (sRaw - w.steadiness) * (1 - Math.exp(-dt / 0.3));
    this.crestUnder = crest;

    if (w.load || w.state === 'stowed' || w.state === 'raising' || w.jammed > 0 || !h.alive) {
      w.target = w.load || null;
      w.inRange = false;
      if (!w.load) w.capture = 0;
      return;
    }

    const sv = ctx.survivors;
    const s = sv?.nearestFor ? sv.nearestFor(w.basket.x, w.basket.z, MAX_CAPTURE_R * mult) : null;
    w.target = s || null;
    if (!s || !s.position) {
      w.inRange = false;
      w.capture = Math.max(0, w.capture - dt * 2);
      w.radius = 3 * mult;
      return;
    }
    const spec = CAPTURE[s.type] || CAPTURE.swimmer;
    const injured = s.type === 'injured';
    const r = spec[0] * mult;
    w.radius = r;
    const d = Math.hypot(w.basket.x - s.position.x, w.basket.z - s.position.z);
    const maxH = s.type === 'swimmer' || injured ? 1.5 : 2.2;
    const inRange = d <= r && w.height <= maxH;
    w.inRange = inRange;
    if (inRange) this.grace = 0.3;
    else this.grace -= dt;
    const minS = injured ? 0.6 : 0.45;

    // Cabin space (stretcher = 2 seats).
    const need = injured ? 2 : 1;
    const full = this.seatsUsed() + need > (h.capacity || 6);
    w.cabinFull = full;
    if (full) {
      w.capture = 0;
      if (inRange && !this.fullWarned) {
        this.fullWarned = true;
        ctx.events.emit('heli:cabin-full', { survivor: s, seats: this.seatsUsed() });
      }
      return;
    }
    if (inRange || this.grace > 0) {
      if (injured && w.steadiness < 0.6) w.capture = 0;
      else if (w.steadiness >= minS) w.capture += dt / spec[1];
    } else {
      w.capture = 0;
    }
    if (w.capture >= 1) this._attach(s);
  }

  _attach(s) {
    const w = this.pub;
    w.capture = 1;
    w.load = s;
    w.target = s;
    w.stretcher = s.type === 'injured';
    this.slipT = 0;
    try {
      this.ctx.survivors?.attachToBasket?.(s);
    } catch (err) {
      console.error('[heli] survivors.attachToBasket failed', err);
    }
    this.ctx.events.emit('heli:capture', { survivor: s });
    w.state = 'down';
    this._setState('raising');
  }

  _board() {
    const w = this.pub;
    const s = w.load;
    const h = this.heli;
    let person = null;
    try {
      person = this.ctx.survivors?.boardOne?.(s) || null;
    } catch (err) {
      console.error('[heli] survivors.boardOne failed', err);
    }
    const rec = Object.assign({ name: 'Пострадавший', age: 30, condition: 'стабилен' }, person || {}, {
      survivor: s,
      stretcher: w.stretcher,
      type: s?.type,
    });
    h.cabin.push(rec);
    w.load = null;
    w.target = null;
    w.capture = 0;
    w.stretcher = false;
    this.ctx.events.emit('heli:pickup', { survivor: s, person: rec });
  }

  _slip(reason) {
    const w = this.pub;
    const s = w.load;
    if (!s) return;
    try {
      this.ctx.survivors?.detachFromBasket?.(s, { slip: true, heatLoss: 10, reason });
    } catch (err) {
      console.error('[heli] survivors.detachFromBasket failed', err);
    }
    w.load = null;
    w.capture = 0;
    w.stretcher = false;
    this.slipT = 0;
    this.ctx.events.emit('heli:slip', { survivor: s, reason });
  }

  _failures(dt, gs) {
    const w = this.pub;
    const ctx = this.ctx;
    // «Сорвался!»: S < 0.25 for 1.5 s while the loaded basket is < 3 m above the water.
    if (w.load && w.height < 3 && w.steadiness < 0.25) {
      this.slipT += dt;
      if (this.slipT >= 1.5) {
        this._slip('unsteady');
        if (w.state === 'raising' && this.held) this._setState('down');
      }
    } else this.slipT = 0;

    // «НАТЯЖЕНИЕ ТРОСА»: > 5 m/s with > 3 m paid out → after 1.5 s the cable reels in by itself.
    if (w.state !== 'stowed' && w.length > 3 && gs > WINDOW_SPEED && !this.autoRetract) {
      if (!this.tensionOn) {
        this.tensionOn = true;
        ctx.events.emit('heli:tension', { level: 0, phase: 'warn' });
      }
      this.tensionT += dt;
      if (this.tensionT >= 1.5) {
        this.autoRetract = true;
        this.tensionT = 0;
        this.tensionOn = false;
        if (w.load) this._slip('tension');
        ctx.events.emit('heli:tension', { level: 1, phase: 'release' });
        w.state = 'down';
        this._setState('raising');
      }
    } else if (this.tensionT > 0) {
      this.tensionT = Math.max(0, this.tensionT - dt * 2);
      if (this.tensionT === 0 && this.tensionOn) {
        this.tensionOn = false;
        ctx.events.emit('heli:tension', { level: 0, phase: 'clear' });
      }
    }
    w.tension = this.tensionT / 1.5;

    // «ТРОС ЗАХЛЕСТНУЛО» [SHOULD]: a rogue crest sweeps over an empty basket at the water → jam 6 s.
    if (!w.load && w.jammed <= 0 && w.length > 3 && w.height < 2.5 && ctx.hazards?.waveLiftAt) {
      const lift = ctx.hazards.waveLiftAt(w.basket.x, w.basket.z) || 0;
      if (lift > 3) {
        w.jammed = 6;
        ctx.events.emit('heli:snag', { x: w.basket.x, z: w.basket.z, reason: 'wave' });
      }
    }
    // …or a plank / barrel / hazard wreckage drifting across the EMPTY cable where it meets the water.
    this.snagCd = Math.max(0, this.snagCd - dt);
    if (!w.load && w.length > 3 && w.height < 2.5 && w.state !== 'stowed') {
      this.snagWet += dt;
      const hit = this._flotsamCrossing();
      if (hit && w.jammed <= 0 && this.snagCd <= 0 && this.snagWet > SNAG_SETTLE) {
        w.jammed = 6;
        this.snagCd = SNAG_COOLDOWN;
        ctx.events.emit('heli:snag', { x: w.basket.x, z: w.basket.z, reason: 'debris', kind: hit.shape || hit.kind || 'debris' });
      }
    } else if (this.snagWet > 0 || this.snagInside.size) {
      this.snagWet = 0;
      this.snagInside.clear();
    }
  }

  // Returns a flotsam item that has just started touching the low cable (basket or the node above
  // it), or null. Reads world floaters and hazard debris positions only.
  _flotsamCrossing() {
    const ctx = this.ctx;
    const w = this.pub;
    const cur = this.cur;
    const kb = (N - 1) * 3;
    const ka = (N - 2) * 3;
    const bx = cur[kb], bz = cur[kb + 2];
    // on a deck (structure targets, pads) nothing floats past the basket
    const water = ctx.ocean?.heightAt ? ctx.ocean.heightAt(bx, bz) : w.surfaceY;
    if (w.surfaceY - water > 1) return null;
    const lowA = cur[ka + 1] - w.surfaceY < 2.5; // the node above the basket is near the water too
    const ax = cur[ka], az = cur[ka + 2];
    const inside = this.snagInside;
    let hit = null;
    const test = (it, r) => {
      if (!it || !Number.isFinite(it.x + it.z)) return;
      const rr = r + SNAG_CABLE;
      const touch = (it.x - bx) ** 2 + (it.z - bz) ** 2 < rr * rr || (lowA && (it.x - ax) ** 2 + (it.z - az) ** 2 < rr * rr);
      if (touch) {
        if (!inside.has(it)) {
          inside.add(it);
          if (!hit && this.snagWet > SNAG_SETTLE) hit = it;
        }
      } else if (inside.has(it)) inside.delete(it);
    };
    const fl = ctx.world?.floaters?.items;
    if (fl && fl.length) {
      for (let i = 0; i < fl.length; i++) {
        const it = fl[i];
        const r = SNAG_R_FLOAT[it.shape];
        if (!r || it.moored) continue;
        if (Math.abs(it.x - bx) > 8 || Math.abs(it.z - bz) > 8) {
          if (inside.has(it)) inside.delete(it);
          continue;
        }
        test(it, r);
      }
    }
    const items = ctx.hazards?.debris?.items;
    if (items) {
      for (const kind in items) {
        const r = SNAG_R_DEBRIS[kind];
        const list = items[kind];
        if (!r || !list) continue;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          // airborne tornado junk passes over the cable; only what floats at the surface snags it
          if (!Number.isFinite(it.y) || Math.abs(it.y - w.surfaceY) > 1.5) {
            if (inside.has(it)) inside.delete(it);
            continue;
          }
          test(it, r);
        }
      }
    }
    return hit;
  }

  // ----------------------------------------------------------------------------------------------
  // Per rendered frame: interpolate the cable, draw ribbon / basket / reach ring.
  render(dt, alpha, beam) {
    const w = this.pub;
    const out = w.state !== 'stowed' || w.length > 0.05;
    this.cable.visible = out;
    this.basketMesh.visible = out;
    this.rescuer.visible = out && w.length > 1.2;
    const ringTarget = out && w.state !== 'raising' && !w.load ? 1 : 0;
    this.ringOpacity += (ringTarget - this.ringOpacity) * (1 - Math.exp(-dt * 6));
    this.ring.visible = this.ringOpacity > 0.01;
    if (!out && !this.ring.visible) return;

    const R = this.rend;
    for (let i = 0; i < N * 3; i++) R[i] = this.stepPrev[i] + (this.cur[i] - this.stepPrev[i]) * alpha;
    // The ribbon is pinned to the rendered hoist (heli is interpolated too).
    const hp = this.heli.hoistRender;
    R[0] = hp.x;
    R[1] = hp.y;
    R[2] = hp.z;
    const kb = (N - 1) * 3;
    // Basket orientation: up along the last cable segment, slow spin (faster with a person).
    const bx = R[kb];
    const by = R[kb + 1];
    const bz = R[kb + 2];
    let ux = R[kb - 3] - bx;
    let uy = R[kb - 2] - by;
    let uz = R[kb - 1] - bz;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4 || uy < 0.2 * ul) {
      ux = 0;
      uy = 1;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    this.spinRate += ((w.load ? 0.35 : 0.12) - this.spinRate) * (1 - Math.exp(-dt));
    this.spin += this.spinRate * dt;
    const bm = this.basketMesh;
    bm.position.set(bx, by, bz);
    this._tmp.set(ux, uy, uz);
    bm.quaternion.setFromUnitVectors(UP, this._tmp);
    _qs.setFromAxisAngle(UP, this.spin + this.heli.heading * -1);
    bm.quaternion.multiply(_qs);
    // The ribbon ends at the bridle hook, not inside the basket.
    const hook = HOOK * 1.4;
    R[kb] = bx + ux * hook;
    R[kb + 1] = by + uy * hook;
    R[kb + 2] = bz + uz * hook;
    if (this.rescuer.visible) {
      this.rescuer.position.set(R[kb], R[kb + 1], R[kb + 2]);
      this.rescuer.quaternion.copy(bm.quaternion);
    }

    // Ribbon vertices.
    const P = this.cablePos;
    const O = this.cableOther;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const j = (i < N - 1 ? i + 1 : i - 1) * 3;
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        P[v] = R[k];
        P[v + 1] = R[k + 1];
        P[v + 2] = R[k + 2];
        O[v] = R[j];
        O[v + 1] = R[j + 1];
        O[v + 2] = R[j + 2];
      }
    }
    const ga = this.cable.geometry.attributes;
    ga.position.needsUpdate = true;
    ga.aOther.needsUpdate = true;
    const st = this.ctx.weather?.state || {};
    const cu = this.cableMat.uniforms;
    cu.uLit.value = 0.25 + 0.75 * (1 - (st.night || 0)) + 2 * (st.flash || 0);
    if (beam) {
      cu.uBeamPos.value.copy(beam.origin);
      cu.uBeamDir.value.copy(beam.dir);
      cu.uBeamCos.value = beam.cosOuter;
      cu.uBeamI.value = beam.intensity;
    }

    // Reach ring: hugs the waves around the basket's water point.
    if (this.ring.visible) this._ring(dt, bx, bz);
  }

  _ring(dt, cx, cz) {
    const w = this.pub;
    const ocean = this.ctx.ocean;
    const r = w.radius;
    const half = 0.16;
    const P = this.ringPos;
    for (let i = 0; i <= RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      let y = 0;
      if (i === RING_SEGS) y = this.ringHeights[0];
      else {
        const px = cx + c * r;
        const pz = cz + s * r;
        y = (ocean?.heightAt ? ocean.heightAt(px, pz) : 0) + 0.22;
        // decks: the ring sits on the deck top when the basket works a structure
        if (w.surfaceY > y + 0.5 && w.height < 3) y = w.surfaceY + 0.12;
        this.ringHeights[i] = y;
      }
      const k = i * 6;
      P[k] = cx + c * (r - half);
      P[k + 1] = y;
      P[k + 2] = cz + s * (r - half);
      P[k + 3] = cx + c * (r + half);
      P[k + 4] = y;
      P[k + 5] = cz + s * (r + half);
    }
    this.ring.geometry.attributes.position.needsUpdate = true;
    const u = this.ringMat.uniforms;
    this.ringOrange += ((w.inRange ? 1 : 0) - this.ringOrange) * (1 - Math.exp(-dt * 10));
    u.uColor.value.copy(this._cPale).lerp(this._cOrange, this.ringOrange);
    u.uOpacity.value = this.ringOpacity * (0.55 + 0.4 * this.ringOrange);
    u.uPhase.value += dt * (0.15 + 0.5 * this.ringOrange);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _qs = new THREE.Quaternion();
