// Photo-mode free camera (CONTRACT «Depth pass additions»: photo mode — camera side).
// Orbit / pan / zoom / height around a pivot, starting from the exact follow framing.
//   mouse: LMB drag orbit, RMB (or Shift+LMB) drag pan, wheel zoom
//   keys:  WASD / arrows pan, Q/E (R/F, PgUp/PgDn) height
//   pad:   left stick pan, right stick orbit, LT/RT height, LB/RB zoom
// Every control drives a target that the camera eases toward (no snaps, no allocation per frame).
// The horizon stays out of frame: the top edge of the view must meet the sea within ~700 m (the
// world beyond is fog / the warped ocean grid's edge).
import * as THREE from 'three';

const DEG = Math.PI / 180;
const PITCH_MAX = 89.5 * DEG;
const DIST_MIN = 8;
const DIST_MAX = 700;
const SEA_REACH = 700; // m — the top-of-frame ray must hit the sea within this
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class FreeCam {
  constructor(ctx) {
    this.ctx = ctx;
    this.pivot = new THREE.Vector3(); // target
    this.yaw = 0;
    this.pitch = 60 * DEG; // angle of the view axis below the horizon
    this.dist = 150;
    this.p = new THREE.Vector3(); // eased
    this._yaw = 0;
    this._pitch = this.pitch;
    this._dist = this.dist;
    this.position = new THREE.Vector3();
    this._mx = 0;
    this._my = 0;
    // The wheel is ours while the photo mode is up: a capture listener stops it before input.js
    // sees it (heli would otherwise consume it as an altitude change and move its target).
    this._wheel = 0;
    if (typeof window !== 'undefined') {
      window.addEventListener('wheel', (e) => {
        if (!this.ctx?.photo?.active) return;
        this._wheel += Math.sign(e.deltaY);
        e.stopPropagation();
      }, { capture: true, passive: true });
    }
  }

  // Start from the current camera pose looking at `look`.
  begin(cam, look, mouse) {
    this.pivot.copy(look);
    const dx = cam.position.x - look.x;
    const dy = cam.position.y - look.y;
    const dz = cam.position.z - look.z;
    this.dist = clamp(Math.hypot(dx, dy, dz), DIST_MIN, DIST_MAX);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = clamp(Math.asin(clamp(dy / Math.max(1e-3, Math.hypot(dx, dy, dz)), -1, 1)), 5 * DEG, PITCH_MAX);
    this.p.copy(this.pivot);
    this._yaw = this.yaw;
    this._pitch = this.pitch;
    this._dist = this.dist;
    this._mx = mouse?.x ?? 0;
    this._my = mouse?.y ?? 0;
    this._wheel = 0;
  }

  _pad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : null;
      if (pads) for (const p of pads) if (p && p.connected) return p;
    } catch {
      /* no gamepad API */
    }
    return null;
  }

  // dt = real seconds. Returns the camera position (this.position); look at this.p.
  update(dt, ctx, fovDeg, areaRadius = 1500) {
    const input = ctx.input;
    const A = input?.axesValues || {};
    const mouse = input?.mouse;
    const btn = input?.mouseButtons;
    const keys = input?.keys;
    const pad = this._pad();
    const screenH = Math.max(1, window.innerHeight || 720);
    const fovR = fovDeg * DEG;

    // --- mouse drag: orbit (LMB) / pan (RMB, Shift+LMB) ---------------------------------------------
    const mx = mouse?.x ?? this._mx;
    const my = mouse?.y ?? this._my;
    const dxm = mx - this._mx;
    const dym = my - this._my;
    this._mx = mx;
    this._my = my;
    const lmb = !!btn?.has('Mouse0');
    const rmb = !!btn?.has('Mouse2');
    const shift = !!(keys?.has('ShiftLeft') || keys?.has('ShiftRight'));
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // screen-right and screen-up (forward) directions on the sea plane
    const rx = cy, rz = -sy, fx = -sy, fz = -cy;
    const upp = (2 * this.dist * Math.tan(fovR / 2)) / screenH; // metres per CSS px at the pivot
    if (lmb && !shift) {
      this.yaw -= dxm * 0.005;
      this.pitch += dym * 0.004;
    } else if (rmb || (lmb && shift)) {
      this.pivot.x -= (rx * dxm - fx * dym) * upp;
      this.pivot.z -= (rz * dxm - fz * dym) * upp;
    }

    // --- sticks / keys -----------------------------------------------------------------------------
    const panS = Math.max(12, this.dist * 0.9) * dt;
    const mvx = A.moveX || 0;
    const mvy = A.moveY || 0;
    this.pivot.x += (rx * mvx + fx * mvy) * panS;
    this.pivot.z += (rz * mvx + fz * mvy) * panS;
    this.yaw -= (A.aimX || 0) * 1.6 * dt;
    this.pitch -= (A.aimY || 0) * 0.9 * dt;
    this.pivot.y = clamp(this.pivot.y + (A.lift || 0) * Math.max(10, this.dist * 0.5) * dt, 0, 300);

    // --- zoom: wheel, pad LB/RB ----------------------------------------------------------------------
    const wheel = this._wheel;
    this._wheel = 0;
    if (wheel) this.dist *= Math.pow(1.12, clamp(wheel, -4, 4));
    const zIn = pad?.buttons?.[5]?.pressed ? 1 : 0;
    const zOut = pad?.buttons?.[4]?.pressed ? 1 : 0;
    if (zIn || zOut) this.dist *= Math.exp((zOut - zIn) * 1.2 * dt);
    this.dist = clamp(this.dist, DIST_MIN, DIST_MAX);

    // keep the pivot over the play area
    const pr = Math.hypot(this.pivot.x, this.pivot.z);
    const lim = areaRadius + 400;
    if (pr > lim) {
      this.pivot.x *= lim / pr;
      this.pivot.z *= lim / pr;
    }
    // no horizon: tan(pitch − fov/2) ≥ camY / SEA_REACH
    const camY = this.pivot.y + this.dist * Math.sin(this.pitch);
    const minPitch = fovR / 2 + Math.atan(Math.max(0, camY) / SEA_REACH) + 2 * DEG;
    this.pitch = clamp(this.pitch, Math.min(minPitch, PITCH_MAX - 0.01), PITCH_MAX);

    // --- ease toward the targets -----------------------------------------------------------------------
    const k = 1 - Math.exp(-dt * 9);
    this.p.lerp(this.pivot, k);
    this._yaw += (this.yaw - this._yaw) * k;
    this._pitch += (this.pitch - this._pitch) * k;
    this._dist += (this.dist - this._dist) * k;

    const cp = Math.cos(this._pitch);
    const o = this.position.set(
      this.p.x + this._dist * cp * Math.sin(this._yaw),
      this.p.y + this._dist * Math.sin(this._pitch),
      this.p.z + this._dist * cp * Math.cos(this._yaw),
    );
    // never under the waves
    let sea = 0;
    try {
      sea = ctx.ocean?.heightAt ? ctx.ocean.heightAt(o.x, o.z) || 0 : 0;
    } catch {
      sea = 0;
    }
    if (o.y < sea + 2.5) o.y = sea + 2.5;
    return o;
  }
}
