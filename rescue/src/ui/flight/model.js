// Per-frame snapshot of the world for the in-flight HUD (overlay canvas, radar, compass tape, panels).
// Reads other systems defensively (any of them may be a stub — CONTRACT ground rules) and keeps the
// event-driven bits the HUD needs (signal pings, whistle arcs, strikes, gust telegraph, FLIR snaps,
// lost buoys, score popups) in fixed pools: nothing here allocates per frame.
import * as THREE from 'three';

const POOL = (n, make) => Array.from({ length: n }, make);

export class FlightModel {
  constructor(hud) {
    this.hud = hud;
    this.ctx = hud.ctx;
    // heli snapshot
    this.hx = 0;
    this.hz = 0;
    this.hy = 40;
    this.alt = 40;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.ax = 0;
    this.az = 0;
    this.speed = 0;
    this.heading = 0;
    this.sx = 0; // heli on screen (css px)
    this.sy = 0;
    this.onScreen = true;
    this.pxPerM = 4; // screen px per metre at the sea surface under the heli
    this.time = 0; // real seconds since the flight HUD started
    this.missionT = 0;

    this.selected = null; // survivor group the HUD guides to (◆ wedge, radar range)
    this.selectedDist = Infinity;
    this.home = null; // nearest pad
    this.homeDist = Infinity;
    this.wantHome = false;
    this.winchTarget = null;

    // event pools
    this.signals = POOL(12, () => ({ t: -99, x: 0, z: 0, error: 40, kind: '', s: null, life: 20 }));
    this.whistles = POOL(6, () => ({ t: -99, bearing: 0, spread: 20 }));
    this.strikes = POOL(8, () => ({ t: -99, x: 0, z: 0, distance: 0, cloudOnly: true }));
    this.popups = POOL(10, () => ({ t: -99, x: 0, y: 0, z: 0, hasPos: false, text: '', sub: '', color: '' }));
    this.flir = new Map(); // survivor → spotted real time
    this.lost = POOL(8, () => ({ t: -99, x: 0, z: 0 }));
    this.epirb = POOL(4, () => ({ t: -99, bearing: 0, error: 30, s: null }));
    this.gust = { active: false, t0: 0, eta0: 6, eta: 0, dirX: 1, dirZ: 0, strength: 0, label: false, flash: 0 };
    this.lastFlash = { t: -99, distance: 0 };
    this.patter = { t: -99, dx: 0, dz: 0 };
    this.activity = 0; // seconds since something worth the ring's attention happened

    this._v = new THREE.Vector3();
    this._o = { x: 0, y: 0, onScreen: false, behind: false };
    this._prevV = new THREE.Vector2();
    this._acc = new THREE.Vector2();
  }

  // --------------------------------------------------------------------------------------------
  // Events (subscribed by FlightHud)
  onSignal(p) {
    const s = p.s;
    let x = Number.isFinite(p.x) ? p.x : s?.position?.x;
    let z = Number.isFinite(p.z) ? p.z : s?.position?.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (p.kind === 'whistle' && this.ctx.heli?.position) {
      const h = this.ctx.heli.position;
      const w = this._oldest(this.whistles);
      w.t = this.time;
      w.bearing = Math.atan2(x - h.x, -(z - h.z));
      w.spread = ((p.error && p.error < 90 ? p.error : 15) * Math.PI) / 180;
      this.activity = 0;
    }
    if (p.kind === 'epirb' && this.ctx.heli?.position) {
      const h = this.ctx.heli.position;
      const e = this._oldest(this.epirb);
      e.t = this.time;
      e.bearing = Math.atan2(x - h.x, -(z - h.z));
      e.error = Number.isFinite(p.error) ? p.error : 30; // degrees
      e.s = s || null;
    }
    const sg = this._oldest(this.signals);
    sg.t = this.time;
    sg.x = x;
    sg.z = z;
    sg.kind = p.kind || 'signal';
    sg.s = s || null;
    // error radius in metres (rockets ±20 m, generic ±40 m); epirb errors are degrees → skip ring
    sg.error = p.kind === 'epirb' ? 0 : Number.isFinite(p.error) && p.error > 0 && p.kind !== 'whistle' ? p.error : p.kind === 'rocket' ? 20 : 40;
    sg.life = p.kind === 'rocket' ? 20 : p.kind === 'smoke' ? 30 : 12;
  }

  onStrike(p) {
    const st = this._oldest(this.strikes);
    st.t = this.time;
    st.x = p.x || 0;
    st.z = p.z || 0;
    st.distance = p.distance || 0;
    st.cloudOnly = !!p.cloudOnly;
    this.lastFlash.t = this.time;
    this.lastFlash.distance = p.distance || 0;
  }

  onGust(p) {
    const g = this.gust;
    g.active = true;
    g.t0 = this.time;
    g.eta0 = Math.max(0.5, p.eta || 6);
    g.eta = g.eta0;
    g.flash = 0;
    const d = p.dir;
    if (d) {
      const l = Math.hypot(d.x, d.y ?? d.z ?? 0) || 1;
      g.dirX = d.x / l;
      g.dirZ = (d.y ?? d.z ?? 0) / l;
    }
    g.strength = p.strength || 0;
    g.flash = 0;
    this.activity = 0;
  }

  onSpotted(s) {
    if (s) this.flir.set(s, this.time);
    this.activity = 0;
  }

  onLost(s) {
    if (!s?.position) return;
    const l = this._oldest(this.lost);
    l.t = this.time;
    l.x = s.position.x;
    l.z = s.position.z;
  }

  onScore(p, color) {
    const pop = this._oldest(this.popups);
    pop.t = this.time;
    const pos = p.position;
    pop.hasPos = !!(pos && Number.isFinite(pos.x));
    if (pop.hasPos) {
      pop.x = pos.x;
      pop.y = pos.y || 0;
      pop.z = pos.z;
    }
    const pts = Math.round(p.points || 0);
    pop.text = (pts > 0 ? '+' : pts < 0 ? '−' : '') + Math.abs(pts);
    pop.sub = p.reason ? String(p.reason).toUpperCase() : '';
    pop.color = color;
    pop.neg = pts < 0;
  }

  onPatter(p) {
    // w_patter: «Вперёд три… вправо два…» → the HUD arrow pulses in the basket→target direction
    this.patter.t = this.time;
  }

  _oldest(pool) {
    let o = pool[0];
    for (let i = 1; i < pool.length; i++) if (pool[i].t < o.t) o = pool[i];
    return o;
  }

  // --------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    this.time += dt;
    this.activity += dt;
    const h = ctx.heli;
    const p = h?.position;
    if (p) {
      this.hx = p.x;
      this.hz = p.z;
      this.hy = p.y;
      this.alt = Number.isFinite(h.altitude) ? h.altitude : p.y;
      const v = h.velocity;
      const nvx = v ? v.x : 0;
      const nvz = v ? v.z : 0;
      const gdt = ctx.time?.dt || 0;
      if (gdt > 0) {
        // smoothed horizontal acceleration (trajectory predictor)
        const ax = (nvx - this.vx) / gdt;
        const az = (nvz - this.vz) / gdt;
        const k = 1 - Math.exp(-gdt * 4);
        this.ax += (Math.max(-20, Math.min(20, ax)) - this.ax) * k;
        this.az += (Math.max(-20, Math.min(20, az)) - this.az) * k;
      }
      this.vx = nvx;
      this.vz = nvz;
      this.vy = Number.isFinite(h.vy) ? h.vy : v ? v.y : 0;
      this.speed = Math.hypot(this.vx, this.vz);
      this.heading = h.heading || 0;
    }
    this.missionT = ctx.mission?.elapsed ?? ctx.mission?.stats?.time ?? ctx.time?.t ?? 0;

    // heli on screen & local scale
    const rig = ctx.cameraRig;
    if (rig?.worldToScreen && p) {
      const o = rig.worldToScreen(p, this._o);
      this.sx = o.x;
      this.sy = o.y;
      this.onScreen = !!o.onScreen;
      this._v.set(p.x + 10, Math.max(0, p.y - this.alt), p.z);
      const a = rig.worldToScreen(this._v, this._o);
      const ax = a.x;
      const ay = a.y;
      this._v.set(p.x - 10, Math.max(0, p.y - this.alt), p.z);
      const b = rig.worldToScreen(this._v, this._o);
      const ppm = Math.hypot(ax - b.x, ay - b.y) / 20;
      if (Number.isFinite(ppm) && ppm > 0.05) this.pxPerM = ppm;
    } else {
      this.sx = window.innerWidth / 2;
      this.sy = window.innerHeight * 0.45;
    }

    // gust telegraph countdown — in GAME seconds (the front travels in game time; slow-mo slows it)
    const g = this.gust;
    if (g.active) {
      const gdt = this.ctx.time?.dt || 0;
      g.eta -= gdt;
      if (g.eta <= 0) {
        g.flash += gdt;
        if (g.flash > 2) g.active = false;
      }
    }

    // selected target: winch target, else nearest spotted group; home pad
    this._select();
  }

  _select() {
    const ctx = this.ctx;
    const list = ctx.survivors?.list || [];
    const wt = ctx.heli?.winch?.target || ctx.heli?.winch?.load || null;
    this.winchTarget = wt;
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || !s.position || !isOpen(s) || !isSpotted(s)) continue;
      const d = Math.hypot(s.position.x - this.hx, s.position.z - this.hz);
      const w = d * (s.priority || s.type === 'injured' ? 0.6 : 1) * (s.health < 0.3 ? 0.75 : 1);
      if (w < bd) {
        bd = w;
        best = s;
      }
    }
    if (wt && wt.position) best = wt;
    this.selected = best;
    this.selectedDist = best ? Math.hypot(best.position.x - this.hx, best.position.z - this.hz) : Infinity;

    const W = ctx.world;
    const pad = W?.nearestPad?.(this.hx, this.hz) || null;
    this.home = pad && pad.position ? pad : null;
    this.homeDist = this.home ? Math.hypot(this.home.position.x - this.hx, this.home.position.z - this.hz) : Infinity;
    const h = ctx.heli;
    const cabin = h?.cabin ? h.cabin.length : 0;
    this.wantHome = !!this.home && !h?.landed && (cabin > 0 || (h?.fuel ?? 1) < 0.35);
  }

  // Project a world point into `out` {x, y, onScreen, behind}; returns out.
  project(x, y, z, out) {
    const rig = this.ctx.cameraRig;
    this._v.set(x, y, z);
    if (rig?.worldToScreen) return rig.worldToScreen(this._v, out);
    out.x = 0;
    out.y = 0;
    out.onScreen = false;
    out.behind = true;
    return out;
  }
}

export const isOpen = (s) => s.state !== 'rescued' && s.state !== 'lost' && (s.remaining === undefined || s.remaining > 0 || s.state === 'winching');
export const isSpotted = (s) => !!(s.spotted || s.state === 'spotted' || s.state === 'winching');
export const isPinged = (s) => s.state === 'drifting' && !s.spotted;
