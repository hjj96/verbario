// Rigging: the small animated bits of the world in ONE instanced draw call (+ its shadow): windsock
// segments (catalogue #31: 4-segment fabric cone following weather.windAt), the «Арктур» signalman's arms
// and glowing wands (#44), the ship's rotating radar bar. Every instance is a tapered stick
// (radius 1 → 0.86, height 1 along +Y from its base); colours > 1 glow (prop material encoding).
import * as THREE from 'three';
import { bake, SURF } from './geo.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

export class Rigging {
  constructor(look, material, max = 96) {
    const stick = new THREE.CylinderGeometry(0.86, 1, 1, 8, 1, false).translate(0, 0.5, 0);
    const geo = bake(look, [{ geometry: stick, color: '#FFFFFF', surf: SURF.fabric }]);
    stick.dispose();
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.name = 'world-rigging';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.max = max;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  // Stick from world point a, along unit direction dir, length len, radius r, colour.
  push(ax, ay, az, dir, len, r, color) {
    if (this.n >= this.max) return;
    _q.setFromUnitVectors(_UP, dir);
    _s.set(r, len, r);
    _d.set(ax, ay, az);
    _m.compose(_d, _q, _s);
    this.mesh.setMatrixAt(this.n, _m);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// --------------------------------------------------------------------------------------------
// Windsock: a fabric cone of 4 tapered sag segments in weathered orange / off-white (#C8452E /
// #E8E2D8). Fully streams at ~8 m/s (real socks: 15 kt) with only a slight tail sag, bellies and
// droops progressively in lighter air, hangs limp and half-collapsed in a calm; the cloth breathes
// (radius ripple) and the tail flutters harder, faster with the wind. ×1.5 for the top-down camera.
const ORANGE = new THREE.Color('#C8452E');
const WHITE = new THREE.Color('#E8E2D8');
const SEGS = 4;
const SOCK_LEN = 5.2;
const R0 = 0.5;

export class Windsock {
  constructor(seed = 0) {
    this.phase = seed * 1.37;
    this.ext = 0.5; // smoothed extension 0..1
    this.dir = new THREE.Vector2(1, 0); // smoothed horizontal direction (towards)
    this._a = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  // hoop: world position of the sock mouth; wx, wz: apparent wind (m/s, towards); t: time.
  update(rig, hoop, wx, wz, t, dt) {
    const speed = Math.hypot(wx, wz);
    const ext = THREE.MathUtils.smoothstep(speed, 0.6, 8.5);
    const k = dt > 0 ? 1 - Math.exp(-dt * 2.2) : 0;
    this.ext += (ext - this.ext) * k;
    if (speed > 0.15 && dt > 0) {
      const tx = wx / speed, tz = wz / speed;
      const kk = 1 - Math.exp(-dt * 1.6);
      this.dir.x += (tx - this.dir.x) * kk;
      this.dir.y += (tz - this.dir.y) * kk;
      const l = Math.hypot(this.dir.x, this.dir.y) || 1;
      this.dir.x /= l;
      this.dir.y /= l;
    }
    const e = this.ext;
    const h = this._h.set(this.dir.x, 0, this.dir.y);
    const side = this._side.set(-this.dir.y, 0, this.dir.x);
    const a = this._a.copy(hoop);
    const segLen = SOCK_LEN / SEGS;
    const fq = 2.2 + 0.35 * speed;
    for (let i = 0; i < SEGS; i++) {
      const f = i / (SEGS - 1);
      // droop below the horizontal: limp sock hangs (≈80°); in moderate air the cloth sags more
      // with every segment (a curve, not a stiff cone); a full sock sags a few degrees at the tail
      const mid = e * (1 - e) * 4;
      let droop = (1 - e) * (1.2 + 0.14 * i) + e * (0.05 + 0.04 * i * i) + mid * 0.22 * i;
      const flAmp = (0.03 + 0.11 * f) * (0.25 + 0.75 * e) * (0.5 + 0.5 * Math.min(1, speed / 14));
      droop += flAmp * Math.sin(t * fq * 1.3 + this.phase + i * 0.9);
      const yaw = flAmp * 1.4 * Math.sin(t * fq + this.phase * 2.1 + i * 0.7);
      const cd = Math.cos(droop);
      const seg = this._seg
        .copy(h)
        .multiplyScalar(cd * Math.cos(yaw))
        .addScaledVector(side, cd * Math.sin(yaw));
      seg.y = -Math.sin(Math.min(1.5, droop));
      seg.normalize();
      const breathe = 1 + (0.05 + 0.05 * f) * e * Math.sin(t * fq * 2.1 + this.phase + i * 1.7);
      const r = R0 * (1 - 0.17 * i) * (0.62 + 0.38 * e) * breathe;
      rig.push(a.x, a.y, a.z, seg, segLen * 1.04, r, i % 2 ? WHITE : ORANGE);
      a.addScaledVector(seg, segLen);
    }
  }
}
