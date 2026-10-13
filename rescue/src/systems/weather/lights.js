// Scene lights owned by weather (DESIGN §2.7.1, §2.7.2, CONTRACT light budget: exactly 2).
//
// * Sun/moon DirectionalLight — the only shadow caster. Shadow box 250 m following the heli (centred
//   between the heli and its shadow so the «shadow altimeter» is always in the map), texel-snapped to
//   kill shimmering, map 2048/1024/512 by quality, PCF radius and shadow.intensity per preset,
//   bias −0.0004, normalBias 0.6. Uses the CHEATED direction (clamped elevation) — shadow offset
//   alt·cot(elev) ≤ 1.28·alt — while weather.state.sunDirVisual keeps the true sun for looks.
// * Lightning swings the light toward the strike for ~350 ms (elevation 35–60°, #C7D6FF,
//   intensity flash × 5, shadow strength 0.9): the heli's shadow snaps around at every strike.
// * HemisphereLight: palette ambient / ambientGround, ×4 on a flash.
// Lights are created once in the constructor; afterwards only intensity/colour/direction change.
import * as THREE from 'three';
import { FLASH_NIGHT } from './presets.js';

const BOX = 250; // shadow box, metres
const DIST = 520; // light distance from its target along the light direction
const SWING_HOLD = 0.3;
const SWING_OUT = 0.12;
const MAP_SIZE = { low: 512, medium: 1024, high: 2048 };

export class WeatherLights {
  constructor(ctx) {
    this.ctx = ctx;
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.name = 'weather.sun';
    sun.castShadow = true;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    const cam = sun.shadow.camera;
    cam.left = -BOX / 2;
    cam.right = BOX / 2;
    cam.top = BOX / 2;
    cam.bottom = -BOX / 2;
    cam.near = 1;
    cam.far = DIST + 420;
    cam.updateProjectionMatrix();
    sun.target.name = 'weather.sunTarget';
    this.sun = sun;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.6);
    this.hemi.name = 'weather.hemi';
    ctx.scene.add(sun, sun.target, this.hemi);

    this.mapSize = 0;
    this.applyQuality(ctx.settings.get('quality'));

    // lightning swing
    this.swingT = 99;
    this.swingDir = new THREE.Vector3(0, 1, 0);
    this.flashColor = new THREE.Color(FLASH_NIGHT);

    // scratch
    this._dir = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this._R = new THREE.Vector3();
    this._U = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._col = new THREE.Color();
  }

  applyQuality(q) {
    const size = MAP_SIZE[q] || 1024;
    const shadow = this.sun.shadow;
    if (size !== this.mapSize) {
      this.mapSize = size;
      shadow.mapSize.set(size, size);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    }
    // Rotor blades live on layer 1 (shadow only) — stroboscopic rotor shadow on high (DESIGN §2.7.2).
    if (q === 'high') shadow.camera.layers.enable(1);
    else shadow.camera.layers.disable(1);
  }

  // Lightning: snap the key light toward the strike for ~350 ms.
  swing(x, z, hx, hz, rng) {
    let dx = x - hx;
    let dz = z - hz;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      const a = rng.next() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= d;
      dz /= d;
    }
    const elev = THREE.MathUtils.degToRad(35 + 25 * rng.next());
    this.swingDir.set(dx * Math.cos(elev), Math.sin(elev), dz * Math.cos(elev));
    this.swingT = 0;
  }

  // Swing weight 0..1 (1 while the strike owns the light).
  get swingWeight() {
    const t = this.swingT;
    if (t < SWING_HOLD) return 1;
    if (t < SWING_HOLD + SWING_OUT) return 1 - (t - SWING_HOLD) / SWING_OUT;
    return 0;
  }

  // st = weather.state; focus = Vector3 the shadow box follows (heli); camFocus = camera ground point.
  update(dt, st, focus, alt, camFocus) {
    const p = st.palette;
    this.swingT += dt;
    const w = this.swingWeight;
    const flash = st.flash;

    // Direction: cheated sun, or the strike while swinging (hard switch = the shadow snaps).
    const dir = this._dir.copy(st.sunDirShadow);
    if (w > 0.5) dir.copy(this.swingDir);
    st.sunDir.copy(dir);

    // Intensity & colour.
    const sunI = p.sunIntensity;
    this.flashColor.copy(st.flashColor);
    this.sun.intensity = sunI * (1 - w) + Math.max(sunI, flash * 5) * w;
    this.sun.color.copy(p.sun).lerp(this.flashColor, w);
    this.sun.shadow.intensity = THREE.MathUtils.lerp(p.shadowIntensity, 0.9, w);
    this.sun.shadow.radius = THREE.MathUtils.lerp(p.shadowRadius, 1.5, w);

    this.hemi.color.copy(p.ambient).lerp(this.flashColor, Math.min(1, flash * 0.8));
    this.hemi.groundColor.copy(p.ambientGround);
    this.hemi.intensity = p.ambientIntensity * (1 + 3 * flash);

    // Shadow box: midway between the heli and its shadow on the water, so the convergence of the
    // two (the altimeter) is always inside the map. Falls back to the camera focus when the heli
    // is far from the view (title drift, cinematics).
    const c = this._center;
    const h = Math.max(0.05, dir.y);
    const horiz = Math.hypot(dir.x, dir.z) || 1;
    const off = Math.min(alt, 140) * (horiz / h) * 0.5;
    c.set(focus.x - (dir.x / horiz) * off, 0, focus.z - (dir.z / horiz) * off);
    if (camFocus && Math.hypot(camFocus.x - c.x, camFocus.z - c.z) > 160) c.set(camFocus.x, 0, camFocus.z);

    // Texel snapping in light space (axes of the shadow camera's lookAt basis).
    const R = this._R.crossVectors(this._up, dir);
    if (R.lengthSq() < 1e-6) R.set(1, 0, 0);
    R.normalize();
    const U = this._U.crossVectors(dir, R).normalize();
    const texel = BOX / this.mapSize;
    const r = c.dot(R);
    const u = c.dot(U);
    c.addScaledVector(R, Math.round(r / texel) * texel - r);
    c.addScaledVector(U, Math.round(u / texel) * texel - u);

    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, DIST);
    this.sun.target.updateMatrixWorld();
  }
}
