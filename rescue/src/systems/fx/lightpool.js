// Pooled PointLights (CONTRACT light budget: fx owns exactly 4, created once in the constructor; DESIGN
// §2.7.1 «пул fx ×4»: flares 800–1400 cd with 12–18 Hz flicker, lightning ground glow, fire).
//
// Callers get VIRTUAL handles — any number of them. Every frame the 4 physical lights are assigned to
// the handles that matter most (intensity × proximity to the camera focus) with hysteresis, so a fifth
// flare never steals a light mid-flicker and nothing ever adds/removes a light (no shader recompiles).
//
//   const h = fx.acquireLight('#FF3A1E', 1000, 60);
//   h.position.set(x, y, z); h.set(intensity); h.setColor('#…'); h.release();
import * as THREE from 'three';
import { toColor } from './common.js';

const PHYSICAL = 4;
const HYSTERESIS = 1.35;

class LightHandle {
  constructor(pool) {
    this.pool = pool;
    this.position = new THREE.Vector3();
    this.color = new THREE.Color(1, 1, 1);
    this.intensity = 0;
    this.distance = 60;
    this.decay = 2;
    this.alive = false;
    this.slot = -1; // physical light index or −1
    this.score = 0;
  }

  set(intensity) {
    this.intensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
    return this;
  }

  setColor(c) {
    toColor(c, this.color);
    return this;
  }

  setDistance(d) {
    if (Number.isFinite(d) && d > 0) this.distance = d;
    return this;
  }

  release() {
    if (!this.alive) return;
    this.alive = false;
    this.intensity = 0;
    this.pool._free(this);
  }

  get active() {
    return this.alive && this.slot >= 0;
  }
}

export class LightPool {
  constructor(scene) {
    this.lights = [];
    for (let i = 0; i < PHYSICAL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 60, 2);
      l.name = `fx.light${i}`;
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      scene.add(l);
      this.lights.push(l);
    }
    this.owner = new Array(PHYSICAL).fill(null);
    this.handles = []; // live handles
    this.spare = []; // recycled handle objects
    this._cand = [];
  }

  acquire(color, intensity = 0, distance = 60) {
    const h = this.spare.pop() || new LightHandle(this);
    h.alive = true;
    h.slot = -1;
    h.position.set(0, 0, 0);
    toColor(color ?? '#ffffff', h.color);
    h.intensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
    h.distance = Number.isFinite(distance) && distance > 0 ? distance : 60;
    this.handles.push(h);
    return h;
  }

  _free(h) {
    const i = this.handles.indexOf(h);
    if (i >= 0) this.handles.splice(i, 1);
    if (h.slot >= 0) {
      this.owner[h.slot] = null;
      this.lights[h.slot].intensity = 0;
      h.slot = -1;
    }
    if (this.spare.length < 32) this.spare.push(h);
  }

  releaseAll() {
    for (let i = this.handles.length - 1; i >= 0; i--) this.handles[i].release();
  }

  // focusX/Z: camera ground focus. air: shared air uniforms (uFxLightPos / uFxLightCol) to fill.
  update(focusX, focusZ, air) {
    const hs = this.handles;
    for (const h of hs) {
      const dx = h.position.x - focusX;
      const dz = h.position.z - focusZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      const reach = Math.max(20, h.distance);
      h.score = h.intensity > 0 ? h.intensity / (1 + (Math.max(0, d - 0.5 * reach) / reach) ** 2) : 0;
      if (h.slot >= 0) h.score *= HYSTERESIS; // incumbents keep their light unless clearly beaten
    }
    // Candidates sorted by score (few handles: insertion sort, no allocation).
    const c = this._cand;
    c.length = 0;
    for (const h of hs) {
      if (h.score <= 0) continue;
      let i = c.length;
      c.push(h);
      while (i > 0 && c[i - 1].score < h.score) {
        c[i] = c[i - 1];
        i--;
      }
      c[i] = h;
    }
    // Winners keep/receive a slot; losers drop theirs.
    for (let k = 0; k < c.length; k++) {
      const h = c[k];
      if (k >= PHYSICAL && h.slot >= 0) {
        this.owner[h.slot] = null;
        h.slot = -1;
      }
    }
    for (const h of hs) {
      if (h.score <= 0 && h.slot >= 0) {
        this.owner[h.slot] = null;
        h.slot = -1;
      }
    }
    for (let k = 0; k < Math.min(PHYSICAL, c.length); k++) {
      const h = c[k];
      if (h.slot >= 0) continue;
      const free = this.owner.indexOf(null);
      if (free < 0) break;
      this.owner[free] = h;
      h.slot = free;
    }
    // Push state to the physical lights and the shared air uniforms.
    const P = air.uFxLightPos.value;
    const C = air.uFxLightCol.value;
    for (let i = 0; i < PHYSICAL; i++) {
      const l = this.lights[i];
      const h = this.owner[i];
      if (h && h.alive && h.intensity > 0) {
        l.position.copy(h.position);
        l.color.copy(h.color);
        l.intensity = h.intensity;
        l.distance = h.distance;
        l.decay = h.decay;
        P[i].set(h.position.x, h.position.y, h.position.z, h.intensity);
        C[i].set(h.color.r, h.color.g, h.color.b, h.distance);
      } else {
        l.intensity = 0;
        P[i].w = 0;
      }
    }
  }
}
