// Camera rig — the "documentary escort drone" (CONTRACT: cameraRig; DESIGN §2.2, §2.15, §7.2, §7.7).
//
// follow    : H = clamp(110 + alt + 1.2·speed, 105, 230) + 15·intensity, winch 95 m, hazard reveal +50 m
//             (≤ 280), zoom ×1 / ×0.8 / ×1.25 (Z); tilt 14° calm → 18° storm, 26° reveal, 10° winch;
//             focus spring ω 4 with look-ahead velocity·0.7 s ≤ 25 m (→ 0 while winching), the heli held
//             at ~55 % screen height; tilt spring ζ 0.75. Every driver goes through a spring.
// attract   : title — slow drift at 300 m around the parked heli, thin letterbox.
// cinematic : debrief — rise to 400 m, full letterbox.
// + handheld drift, trauma shake (event-driven), FOV punches, ≤ 1-per-mission slow-mo moments,
//   letterbox 0..1 animated over 0.8 s (post/hud draw the bars). Never shows the horizon.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { CameraMotion } from './camera/shake.js';

const DEG = Math.PI / 180;
const BASE_FOV = 40;
const ZOOMS = [1, 0.8, 1.25];
const HELI_SCREEN_Y = 0.1; // NDC: heli at ~55 % of the screen height (from the bottom)
const ATTRACT_LB = 0.47; // ≈ 6vh bars on the title screen
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Exact critically damped spring step (stable for any dt). Writes into `out` (no allocation).
const SPR = { x: 0, v: 0 };
function crit(x, v, target, omega, dt, out = SPR) {
  const y = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * y;
  out.x = target + (y + k * dt) * e;
  out.v = (v - omega * k * dt) * e;
  return out;
}

export class CameraRig {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = ctx.mode === 'title' || ctx.mode === 'briefing' ? 'attract' : 'follow';
    this.zoom = 1;
    this.zoomIndex = 0;
    this.letterbox = 0;
    this.focusPoint = new THREE.Vector3();
    this.height = 150;
    this.tiltDeg = 14;
    this.fov = BASE_FOV;
    this.viewHeight = 100;
    this.reveal = false;
    this.heliScreen = { x: 0, y: 0, ndcX: 0, ndcY: 0 };
    this.heliScreenVelocity = new THREE.Vector2(); // NDC units / s (post: lens rivulets)

    this.motion = new CameraMotion(4242);
    this._fv = new THREE.Vector2();
    this._hv = 0;
    this._tilt = 14 * DEG;
    this._tiltV = 0;
    this._fovV = 0;
    this._punch = 0;
    this._punchT = 0;
    this._punchHold = 0;
    this._climbFov = 0;
    this._winch = 0;
    this._snap = true;
    this._t = 0;
    this._lbPulse = 0;
    this._revealHold = 0;
    this._slowT = 0;
    this._slowScale = 1;
    this._used = new Set();
    this._pending = []; // delayed shakes {t, trauma, freq, push?}
    this._focusPos = new THREE.Vector3();
    this._focusT = 0;
    this._focusDur = 0;
    this._focusW = 0;
    this._crashT = -1;
    this._rogueUnder = false;
    this._firstHazard = true;

    this._v = new THREE.Vector3();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._look = new THREE.Vector3();

    const on = (n, fn) => ctx.events.on(n, fn);
    on('game:mode', ({ to }) => {
      if (to === 'title' || to === 'briefing') this.mode = 'attract';
      else if (to === 'play') this.mode = 'follow';
      else if (to === 'debrief') this.mode = 'cinematic';
    });
    on('mission:setup', () => {
      this._used.clear();
      this._firstHazard = true;
      this._crashT = -1;
      this._snap = true;
      this._pending.length = 0;
      this.motion.trauma = 0;
      this._endSlowMo();
    });
    on('mission:start', () => this.cinematicBars(3.2));
    on('hazard:warning', () => {
      if (this._firstHazard) {
        this._firstHazard = false;
        this.cinematicBars(3);
      }
    });
    on('weather:lightning', (e) => this._onLightning(e || {}));
    on('weather:gust', (e) => {
      if (!e) return;
      const s = clamp((e.strength || 6) / 12, 0, 1);
      const dir = e.dir || { x: 1, y: 0 };
      this._pending.push({ t: Math.max(0, e.eta ?? 6), trauma: 0.15, freq: 6, push: [dir.x, dir.y, 0.3 + 0.5 * s] });
    });
    on('heli:damage', (e) => {
      if (!e) return;
      if (e.source === 'water') this.motion.addTrauma(0.5, 12);
      else if ((e.amount || 0) >= 0.03) this.motion.addTrauma(0.8, 13);
      else this.motion.addTrauma(0.3 + (e.amount || 0) * 10, 13);
    });
    on('heli:crash', () => {
      this.motion.addTrauma(0.8, 10);
      this.slowMo(0.3, 1.2, null);
      this._crashT = 0;
    });
  }

  init() {
    this._snap = true;
  }

  // ----------------------------------------------------------------------------------------------
  // CONTRACT API
  setMode(mode) {
    if (mode === 'follow' || mode === 'attract' || mode === 'cinematic') this.mode = mode;
  }

  shake(strength = 0.5, duration = 0) {
    // duration > 0 keeps the trauma topped up (continuous rumble); otherwise a single kick.
    this.motion.addTrauma(clamp(strength, 0, 1));
    if (duration > 0) this._pending.push({ t: 0, trauma: strength, freq: 11, hold: duration });
  }

  punch(fovDelta, duration = 0.08) {
    this._punch = fovDelta;
    this._punchHold = duration;
    this._punchT = duration + 0.25;
  }

  focus(position, duration = 3) {
    if (!position) return;
    this._focusPos.set(position.x, 0, position.z);
    this._focusDur = Math.max(0.5, duration);
    this._focusT = this._focusDur;
  }

  // Letterbox pulse (cinematic bars for `duration` seconds, eased in/out over 0.8 s).
  cinematicBars(duration = 3) {
    this._lbPulse = Math.max(this._lbPulse, duration);
  }

  // Slow-motion moment; `key` limits it to once per mission (null = unlimited, e.g. the crash).
  slowMo(scale, duration, key) {
    if (key) {
      if (this._used.has(key)) return false;
      this._used.add(key);
    }
    this._slowScale = scale;
    this._slowT = duration;
    this.ctx.timeScale = scale;
    return true;
  }

  _endSlowMo() {
    if (this._slowT > 0 || this.ctx.timeScale === this._slowScale) {
      if (this.ctx.timeScale === this._slowScale) this.ctx.timeScale = 1;
    }
    this._slowT = 0;
  }

  worldToScreen(v, out = {}) {
    const cam = this.ctx.camera;
    this._v.copy(v).project(cam);
    const el = this.ctx.renderer?.domElement;
    const w = (el && el.clientWidth) || window.innerWidth;
    const h = (el && el.clientHeight) || window.innerHeight;
    out.x = (this._v.x * 0.5 + 0.5) * w;
    out.y = (-this._v.y * 0.5 + 0.5) * h;
    out.ndcX = this._v.x;
    out.ndcY = this._v.y;
    out.behind = this._v.z > 1;
    out.onScreen = !out.behind && Math.abs(this._v.x) <= 1 && Math.abs(this._v.y) <= 1;
    return out;
  }

  // Ray through the screen point → hit on the sea plane y = 0 (cursor aim).
  screenToWater(ndcX, ndcY, out = new THREE.Vector3()) {
    const cam = this.ctx.camera;
    const o = this._o.setFromMatrixPosition(cam.matrixWorld);
    const d = this._d.set(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
    if (d.y > -1e-4) return out.set(o.x + d.x * 400, 0, o.z + d.z * 400);
    const t = -o.y / d.y;
    return out.set(o.x + d.x * t, 0, o.z + d.z * t);
  }

  // ----------------------------------------------------------------------------------------------
  _onLightning(e) {
    const h = this.ctx.heli;
    let d = e.distance;
    if (!(d >= 0) && h && e.x !== undefined) d = Math.hypot(e.x - h.position.x, e.z - h.position.z);
    if (!(d >= 0)) d = 1000;
    if (!e.cloudOnly) {
      if (d < 150) this.punch(-1.5, 0.08);
      if (d < 40) this.slowMo(0.4, 0.5, 'lightning');
    }
    if (d < 600) {
      // Thunder rumble arrives d/343 s later (8 Hz).
      this._pending.push({ t: d < 120 ? 0 : d / 343, trauma: e.cloudOnly ? 0.22 : 0.35, freq: 8 });
    }
  }

  _hazards(dt, hp) {
    const hz = this.ctx.hazards;
    if (!hz) return;
    // Continuous rumble near a waterspout / tornado: 0.2·(1 − d/150).
    const list = hz.list;
    if (list && list.length) {
      for (const z of list) {
        if (!z || !z.position || (z.type !== 'waterspout' && z.type !== 'tornado')) continue;
        const reach = z.type === 'tornado' ? 300 : 150;
        const d = Math.hypot(z.position.x - hp.x, z.position.z - hp.z);
        if (d < reach) this.motion.floor(0.2 * (1 - d / reach));
      }
    }
    // Rogue crest passing under the heli: trauma 0.6, slow-mo 0.35 × 1 s if the heli is below 15 m.
    const lift = hz.waveLiftAt ? hz.waveLiftAt(hp.x, hp.z) || 0 : 0;
    if (lift > 5 && !this._rogueUnder) {
      this._rogueUnder = true;
      this.motion.addTrauma(0.6, 9);
      const clearance = hp.y - lift;
      if (clearance < 15) this.slowMo(0.35, 1.0, 'rogue');
    } else if (lift < 2) this._rogueUnder = false;
    // Hazard reveal (+50 m, 26°): rogue at T−4, waterspout / tornado close by.
    let imm = null;
    try {
      imm = hz.imminent;
    } catch {
      imm = null;
    }
    if (imm && imm.position) {
      const d = Math.hypot(imm.position.x - hp.x, imm.position.z - hp.z);
      const eta = imm.eta ?? 0;
      if ((imm.type === 'rogue' && eta < 4.5) || ((imm.type === 'waterspout' || imm.type === 'tornado') && d < 320)) this._revealHold = 2.5;
    }
    if (this._revealHold > 0) this._revealHold -= dt;
    this.reveal = this._revealHold > 0;
  }

  // ----------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    if (!(dt > 0)) dt = 0;
    this._t += dt;
    const cam = ctx.camera;
    const h = ctx.heli;
    const st = ctx.weather?.state || {};
    const storm = clamp(st.intensity || 0, 0, 1);
    const hp = h?.position || this._v.set(0, 40, 0);
    const hv = h?.velocity;

    // Zoom cycle (Z): Auto ×1 → closer ×0.8 → farther ×1.25.
    if (ctx.mode === 'play' && ctx.input?.pressed?.('zoom')) {
      this.zoomIndex = (this.zoomIndex + 1) % ZOOMS.length;
      ctx.events.emit('camera:zoom', { zoom: ZOOMS[this.zoomIndex], index: this.zoomIndex });
    }
    this.zoom += (ZOOMS[this.zoomIndex] - this.zoom) * (1 - Math.exp(-dt * 3));

    // Timers: delayed shakes, slow-mo, focus envelope, letterbox pulse.
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      p.t -= dt;
      if (p.hold !== undefined) {
        this.motion.floor(p.trauma);
        p.hold -= dt;
        if (p.hold <= 0) this._pending.splice(i, 1);
        continue;
      }
      if (p.t <= 0) {
        this.motion.addTrauma(p.trauma, p.freq);
        if (p.push) this.motion.gustPush(p.push[0], p.push[1], p.push[2]);
        this._pending.splice(i, 1);
      }
    }
    if (this._slowT > 0) {
      this._slowT -= dt;
      if (this._slowT <= 0) this._endSlowMo();
    }
    if (this._lbPulse > 0) this._lbPulse -= dt;
    if (this._focusT > 0) this._focusT -= dt;
    if (this._crashT >= 0) this._crashT += dt;
    if (ctx.mode === 'play' || ctx.mode === 'debrief') this._hazards(dt, hp);
    else this.reveal = false;

    // --- targets per mode ------------------------------------------------------------------------
    const winchOut = h?.winch && h.winch.state && h.winch.state !== 'stowed' ? 1 : 0;
    this._winch += (winchOut - this._winch) * (1 - Math.exp(-dt * 1.2));
    const wb = this._winch;
    let Ht;
    let tiltT;
    let wFocus = 4;
    let wH = 2.2;
    let lb = 0;
    const tgt = this._target.set(hp.x, 0, hp.z);

    if (this.mode === 'attract') {
      Ht = 300;
      tiltT = 16;
      wFocus = 0.7;
      wH = 1.6;
      lb = ATTRACT_LB;
      const t = this._t;
      tgt.x += 55 * Math.sin(t * 0.047) + 18 * Math.sin(t * 0.11);
      tgt.z += 35 * Math.sin(t * 0.033 + 1.3) - 25;
    } else if (this.mode === 'cinematic') {
      Ht = 400;
      tiltT = 18;
      wFocus = 1.2;
      wH = 0.75;
      lb = 1;
    } else {
      const alt = Math.max(0, h?.altitude ?? hp.y);
      const speed = hv ? Math.hypot(hv.x, hv.z) : 0;
      Ht = clamp(110 + alt + 1.2 * speed, 105, 230) + 15 * storm;
      Ht += (95 - Ht) * wb;
      Ht *= this.zoom;
      tiltT = 14 + 4 * storm;
      tiltT += (10 - tiltT) * wb;
      if (this.reveal) {
        Ht = Math.min(Ht + 50, 280);
        tiltT = 26;
      }
      // Crash: the camera slowly lifts away from the floating wreck.
      if (this._crashT >= 0) {
        Ht = Math.max(Ht, 150 + Math.min(this._crashT, 8) * 14);
        wH = 0.9;
      }
      // Look-ahead (velocity × 0.7 s, ≤ 25 m, → 0 while winching).
      if (hv && this._crashT < 0) {
        let lx = hv.x * 0.7;
        let lz = hv.z * 0.7;
        const l = Math.hypot(lx, lz);
        if (l > 25) {
          lx *= 25 / l;
          lz *= 25 / l;
        }
        tgt.x += lx * (1 - wb);
        tgt.z += lz * (1 - wb);
      }
    }
    if (this._lbPulse > 0) lb = Math.max(lb, 1);
    // letterbox 0..1 at a constant rate (full travel in 0.8 s)
    const step = dt / 0.8;
    this.letterbox += clamp(lb - this.letterbox, -step, step);

    // Never show the horizon: tilt + FOV/2 ≤ 55° (with margin for drift/shake).
    tiltT = Math.min(tiltT, 55 - (this.fov / 2) - 2);

    // --- springs: tilt (ζ 0.75), height (critical), focus (critical, ω 4) ---------------------------
    if (this._snap) {
      this._tilt = tiltT * DEG;
      this._tiltV = 0;
      this.height = Ht;
      this._hv = 0;
    } else {
      const w = 2.6;
      const z = 0.75;
      let rem = dt;
      while (rem > 0) {
        const s = Math.min(rem, 1 / 60);
        this._tiltV += (w * w * (tiltT * DEG - this._tilt) - 2 * z * w * this._tiltV) * s;
        this._tilt += this._tiltV * s;
        rem -= s;
      }
      const r = crit(this.height, this._hv, Ht, wH, dt);
      this.height = r.x;
      this._hv = r.v;
    }
    const T = this._tilt;
    this.tiltDeg = T / DEG;
    const H = Math.max(20, this.height);

    // Keep the heli at ~55 % screen height: shift the focus so its projection lands at NDC y = +0.1
    // (accounts for the heli's altitude parallax under the tilted camera).
    if (this.mode === 'follow') {
      const delta = Math.atan(HELI_SCREEN_Y * Math.tan((this.fov / 2) * DEG));
      const hy = clamp(hp.y, 0, H - 10);
      tgt.z += (H - hy) * Math.tan(T + delta) - H * Math.tan(T);
    }
    // focus(): pull toward a point of interest, but keep the heli inside the frame.
    if (this._focusT > 0) {
      const k = Math.min(1, (this._focusDur - this._focusT) / 0.6, this._focusT / 0.8);
      this._focusW = smooth(0, 1, k);
    } else this._focusW = 0;
    if (this._focusW > 0) {
      let fx = (this._focusPos.x - tgt.x) * 0.65;
      let fz = (this._focusPos.z - tgt.z) * 0.65;
      const lim = 0.32 * 2 * H * Math.tan((BASE_FOV / 2) * DEG);
      const l = Math.hypot(fx, fz);
      if (l > lim) {
        fx *= lim / l;
        fz *= lim / l;
      }
      tgt.x += fx * this._focusW;
      tgt.z += fz * this._focusW;
    }

    const f = this.focusPoint;
    if (this._snap || Math.hypot(tgt.x - f.x, tgt.z - f.z) > 450) {
      f.set(tgt.x, 0, tgt.z);
      this._fv.set(0, 0);
      this._snap = false;
    } else {
      let r = crit(f.x, this._fv.x, tgt.x, wFocus, dt);
      f.x = r.x;
      this._fv.x = r.v;
      r = crit(f.z, this._fv.y, tgt.z, wFocus, dt);
      f.z = r.x;
      this._fv.y = r.v;
    }

    // --- FOV: punches + "+2° at max climb" -----------------------------------------------------------
    if (this._punchT > 0) this._punchT -= dt;
    const punch = this._punchT > 0.25 ? this._punch : this._punchT > 0 ? this._punch * (this._punchT / 0.25) : 0;
    const climb = smooth(5, 6.8, h?.vy ?? 0) * (this.mode === 'follow' ? 1 : 0);
    this._climbFov += (2 * climb - this._climbFov) * (1 - Math.exp(-dt * 2));
    const fov = BASE_FOV + punch + this._climbFov;
    if (Math.abs(fov - cam.fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.fov = fov;

    // --- motion layers ---------------------------------------------------------------------------------
    const reduce = ctx.settings.get('reduceMotion') ? 0.4 : 1;
    const shakeScale = clamp(ctx.settings.get('screenShake') ?? 1, 0, 1);
    this.motion.update(dt, storm, shakeScale, reduce * (this.mode === 'attract' ? 0.6 : 1));
    this.trauma = this.motion.trauma;

    // --- place the camera --------------------------------------------------------------------------------
    const m = this.motion;
    cam.position.set(f.x + m.pos.x, H + m.pos.y, f.z + H * Math.tan(T) + m.pos.z);
    this._look.set(f.x + m.pos.x, 0, f.z + m.pos.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._look);
    cam.rotateX(m.rot.x);
    cam.rotateY(m.rot.y);
    cam.rotateZ(m.rot.z);
    cam.updateMatrixWorld();
    this.height = H;
    this.viewHeight = (2 * H * Math.tan((fov / 2) * DEG)) / Math.cos(T);

    // --- heli screen position + its ground velocity in screen units (NDC/s, +y = up-screen) — post's
    //     lens rivulets run along −heliScreenVelocity -------------------------------------------------
    if (h) {
      this.worldToScreen(hp, this.heliScreen);
      const halfH = Math.max(1, this.viewHeight / 2);
      const halfW = halfH * (cam.aspect || 16 / 9);
      this.heliScreenVelocity.set(hv ? hv.x / halfW : 0, hv ? -hv.z / halfH : 0);
    }
  }
}
