// Camera motion layers (DESIGN §2.2): documentary "drone" handheld drift + trauma shake + gust push.
//
// * Drift: 3 octaves of smooth noise at 0.21 / 0.57 / 1.3 Hz; position 0.25 m (calm) → 1.2 m (storm),
//   roll & pitch 0.15° → 0.8°.
// * Trauma: shake = trauma², decays 1.2/s, × settings.screenShake; frequency per source (thunder 8 Hz).
// * Gust push: 0.3–0.8° nudge toward the gust direction over 250 ms, springs back.
import * as THREE from 'three';
import { createNoise2D } from '../../core/math.js';

const DEG = Math.PI / 180;
const OCT = [
  [0.21, 1.0],
  [0.57, 0.55],
  [1.3, 0.3],
];
const NORM = 1 / (1 + 0.55 + 0.3);

export class CameraMotion {
  constructor(seed = 2024) {
    this.noise = createNoise2D(seed);
    this.t = 0;
    this.shakeT = 0;
    this.trauma = 0;
    this.freq = 11;
    this.pos = new THREE.Vector3(); // metres, world-aligned (x east, y up, z south)
    this.rot = new THREE.Vector3(); // radians: x pitch, y yaw, z roll (camera-local)
    // gust push spring (2D: x = east, y = south in world terms)
    this.push = new THREE.Vector2();
    this.pushV = new THREE.Vector2();
    this.pushTarget = new THREE.Vector2();
    this.pushT = 0;
  }

  addTrauma(amount, freq) {
    if (amount > this.trauma) {
      this.trauma = Math.min(1, amount);
      if (freq) this.freq = freq;
    }
  }

  // Raise trauma to at least `floor` (continuous sources such as a nearby waterspout).
  floor(v) {
    if (v > this.trauma) this.trauma = Math.min(1, v);
  }

  gustPush(dirX, dirZ, deg) {
    const l = Math.hypot(dirX, dirZ) || 1;
    this.pushTarget.set((dirX / l) * deg * DEG, (dirZ / l) * deg * DEG);
    this.pushT = 0.25;
  }

  _oct(ch, t) {
    let s = 0;
    for (let i = 0; i < 3; i++) s += this.noise(t * OCT[i][0], ch * 13.37 + i * 3.1) * OCT[i][1];
    return s * NORM;
  }

  // storm 0..1, shakeScale = settings.screenShake (0..1), calm = reduceMotion factor
  update(dt, storm, shakeScale, motionScale = 1) {
    this.t += dt;
    const t = this.t;
    // handheld drift
    const pa = (0.25 + (1.2 - 0.25) * storm) * motionScale;
    const ra = (0.15 + (0.8 - 0.15) * storm) * DEG * motionScale;
    this.pos.set(this._oct(0, t) * pa, this._oct(1, t) * pa * 0.5, this._oct(2, t) * pa);
    this.rot.set(this._oct(3, t) * ra, 0, this._oct(4, t) * ra);

    // trauma shake
    this.trauma = Math.max(0, this.trauma - 1.2 * dt);
    const shake = this.trauma * this.trauma * shakeScale;
    if (shake > 1e-4) {
      this.shakeT += dt * this.freq;
      const st = this.shakeT;
      this.pos.x += this.noise(st, 101.1) * 2.0 * shake;
      this.pos.y += this.noise(st, 202.2) * 1.0 * shake;
      this.pos.z += this.noise(st, 303.3) * 2.0 * shake;
      this.rot.x += this.noise(st, 404.4) * 1.2 * DEG * shake;
      this.rot.y += this.noise(st, 505.5) * 0.6 * DEG * shake;
      this.rot.z += this.noise(st, 606.6) * 1.2 * DEG * shake;
    }

    // gust push (spring ω 9, ζ 0.7)
    if (this.pushT > 0) this.pushT -= dt;
    else this.pushTarget.set(0, 0);
    const w = 9;
    const z = 0.7;
    const s = Math.min(dt, 0.05);
    this.pushV.x += (w * w * (this.pushTarget.x - this.push.x) - 2 * z * w * this.pushV.x) * s;
    this.pushV.y += (w * w * (this.pushTarget.y - this.push.y) - 2 * z * w * this.pushV.y) * s;
    this.push.x += this.pushV.x * s;
    this.push.y += this.pushV.y * s;
    // world east push → yaw the view east; world south push → pitch the view south (down-screen)
    this.rot.y += -this.push.x * shakeScale;
    this.rot.x += -this.push.y * shakeScale;
  }
}
