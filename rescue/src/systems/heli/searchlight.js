// Gimballed searchlight (DESIGN §2.7.1, §2.9, §3.10): SpotLight #FFF1DA aimed at the cursor on the
// water (≤ 60° from nadir), wide straight down, narrow when slanted; an open additive volumetric
// cone to the water hit point with density by weather; drives ocean.setSearchlight every frame and
// publishes the beam on heli.beam for fx (rain sparkle in the beam), survivors and the cable shader.
import * as THREE from 'three';
import { POINTS } from './model.js';
import { createConeMaterial } from './materials.js';

const MAX_NADIR = THREE.MathUtils.degToRad(60);
const D10 = THREE.MathUtils.degToRad(10);
const D40 = THREE.MathUtils.degToRad(40);
const RANGE = 300;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Searchlight {
  constructor(ctx, model) {
    this.ctx = ctx;
    this.model = model;
    // Light (no shadow). Created once; only intensity/angle/direction change.
    this.spot = new THREE.SpotLight(0xfff1da, 0, RANGE, 0.26, 0.35, 2);
    this.spot.name = 'heli.searchlight';
    this.spot.castShadow = false;
    this.spot.target.name = 'heli.searchlightTarget';
    ctx.scene.add(this.spot, this.spot.target);

    // Volumetric cone: apex at y = 0, wide end at y = −1 (scaled per frame).
    const g = new THREE.CylinderGeometry(0.02, 1, 1, 28, 6, true);
    g.translate(0, -0.5, 0);
    this.coneMat = createConeMaterial(ctx.look);
    this.cone = new THREE.Mesh(g, this.coneMat);
    this.cone.name = 'heli.searchlightCone';
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 6;
    this.cone.visible = false;
    ctx.scene.add(this.cone);

    this.level = 0; // 0..1 smoothed on/off (relay warm-up)
    this.dir = new THREE.Vector3(0, -1, 0); // current (slewed) beam direction
    this.origin = new THREE.Vector3();
    this.hit = new THREE.Vector3();
    this.length = 30;
    this.angle = 0.26;
    this.flick = 0;
    this._want = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._down = new THREE.Vector3(0, -1, 0);
    // Public beam description (heli.beam): fx / survivors / cable read it.
    this.beam = {
      on: false,
      intensity: 0,
      origin: this.origin,
      dir: this.dir,
      hit: this.hit,
      cosOuter: Math.cos(0.26),
      angle: 0.26,
      length: 30,
    };
  }

  reset() {
    this.level = 0;
    this.dir.set(0, -1, 0);
  }

  // on = heli.searchlight, aim = heli.aim (world point on the water), seaY = water height near aim.
  update(dt, h, aim) {
    const ctx = this.ctx;
    const st = ctx.weather?.state || {};
    const on = h.searchlight && h.alive;
    // Relay "ka-chunk": quick ramp with a short ignition flicker.
    const target = on ? 1 : 0;
    if (on && this.level < 0.02) this.flick = 0.18;
    this.level += (target - this.level) * (1 - Math.exp(-dt * (on ? 9 : 14)));
    this.flick = Math.max(0, this.flick - dt);
    const flicker = this.flick > 0 ? 0.55 + 0.45 * Math.sin(this.flick * 160) : 1;
    const level = this.level * flicker;

    // Lens world position.
    const o = this.origin.copy(POINTS.lens);
    this.model.body.localToWorld(o);

    // Desired direction to the aim point, clamped to ≤ 60° from nadir.
    const sea = h.seaY || 0;
    const w = this._want.set(aim.x - o.x, 0, aim.z - o.z);
    const drop = Math.max(1, o.y - sea);
    const horiz = Math.hypot(w.x, w.z);
    const maxH = drop * Math.tan(MAX_NADIR);
    if (horiz > maxH) w.multiplyScalar(maxH / horiz);
    w.y = -drop;
    w.normalize();
    // Gimbal slew (≈ 6 rad/s responsiveness, never snaps).
    const k = 1 - Math.exp(-dt * 7);
    this.dir.lerp(w, k).normalize();
    if (this.dir.y > -0.2) this.dir.y = -0.2;
    this.dir.normalize();

    // Hit point on the water plane under the beam.
    const s = (o.y - sea) / Math.max(0.05, -this.dir.y);
    this.length = Math.min(RANGE, s);
    this.hit.copy(o).addScaledVector(this.dir, this.length);

    const nadir = Math.acos(Math.min(1, -this.dir.y));
    this.angle = THREE.MathUtils.lerp(0.26, 0.12, smooth(D10, D40, nadir));

    // Spot: keep the pool brightness roughly constant with distance (pool 0.75–0.9 after tonemap).
    const spot = this.spot;
    spot.angle = this.angle;
    spot.penumbra = 0.35;
    spot.position.copy(o);
    spot.target.position.copy(this.hit);
    spot.target.updateMatrixWorld();
    const night = st.night || 0;
    const dayDim = 0.55 + 0.45 * night; // by day the pool still shows but never fights the sun
    // The pool on the water is the ocean's look-driven layer 11 (it only takes a share of this light):
    // the SpotLight is sized for what floats in it — a raft canopy stays orange (≈0.6 on screen),
    // not a blown pink-white disc under the night bloom.
    spot.intensity = level * dayDim * 0.6 * Math.max(150, this.length * this.length);

    // Volumetric cone: density by weather (clear .02, rain .18, storm .25, fog .35).
    const rain = st.rain || 0;
    const fog = st.fog || 0;
    const inten = st.intensity || 0;
    let density = 0.02 + 0.16 * smooth(0, 0.8, rain) + 0.07 * smooth(0.6, 0.95, inten) + 0.33 * fog;
    density = Math.min(0.4, density);
    const cu = this.coneMat.uniforms;
    cu.uDensity.value = density;
    cu.uIntensity.value = level * (0.3 + 0.7 * night) * 0.55; // double-sided cone: each wall adds
    cu.uLen.value = this.length;
    const rEnd = this.length * Math.tan(this.angle * 1.05);
    this.cone.visible = level > 0.01;
    if (this.cone.visible) {
      this.cone.position.copy(o);
      this._q.setFromUnitVectors(this._down, this.dir);
      this.cone.quaternion.copy(this._q);
      this.cone.scale.set(rEnd, this.length, rEnd);
    }

    // Publish.
    const b = this.beam;
    b.on = on;
    b.intensity = level;
    b.cosOuter = Math.cos(this.angle);
    b.angle = this.angle;
    b.length = this.length;
    ctx.ocean?.setSearchlight?.(o, this.dir, b.cosOuter, level);
  }
}
