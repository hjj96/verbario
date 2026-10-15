// The single full-screen HUD canvas (DESIGN §7.3 «Реализация»: one canvas, DPR ≤ 2, pointer-events none,
// 60 Hz). Draws everything graphical in flight: the ring around the heli (§7.3.5), world markers
// (§7.3.6), edge indicators (§7.3.7), the compass tape (§7.3.1), the radar-altimeter scale (§7.3.4),
// the winch sight + cable gauge (§7.4), score popups (§7.3.10), the cursor crosshair and «ЦЕЛЬ».
// Text panels stay in the DOM (panels.js). No allocations per frame: projections reuse scratch objects,
// edge indicators live in a fixed pool, label strings come from caches in fmt.js.
import { fitCanvas } from '../common/dom.js';
import { distU, deg3, clamp01, smooth, easeOutBack, num1, groupOf, NBSP } from '../common/fmt.js';
import { isOpen, isSpotted, isPinged } from './model.js';
import { font, MONO, HEAD } from '../common/fonts.js';

// '#RRGGBB' (or '#RGB') → 'rgba(r, g, b, a)' for canvas gradients
function rgbaHex(hex, a) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const TAU = Math.PI * 2;
const DASH_A = [5, 5];
const DASH_B = [2, 4];
const DASH_C = [8, 6];
const NO_DASH = [];
const EDGE_MAX = 8;
const EDGE_MARGIN = 56;
const MERGE_PX = 26;


// Group footprint (m) for bracket size.
const FOOT = { swimmer: 1.6, injured: 1.6, raft: 3.6, hull: 4.2, container: 5.5, deck: 9, wreck: 16, plane: 9 };

// Heartbeat envelope (lub-dub) for critical indicators; period 0.8 s healthy → 1.6 s weak.
function heartbeat(t, health) {
  const period = 0.8 + 0.8 * (1 - clamp01((health ?? 0.5) / 0.5));
  const ph = (t % period) / period;
  const a = Math.exp(-Math.pow((ph - 0.08) / 0.05, 2));
  const b = 0.6 * Math.exp(-Math.pow((ph - 0.26) / 0.06, 2));
  return Math.min(1, a + b);
}

export class Overlay {
  constructor(flight) {
    this.flight = flight;
    this.hud = flight.hud;
    this.ctx = flight.hud.ctx;
    this.m = flight.model;
    this.pal = flight.hud.palette;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-overlay';
    this.g = this.canvas.getContext('2d');
    this.dpr = 1;
    this.W = 0;
    this.H = 0;
    this.fontsReady = false;
    this._p = { x: 0, y: 0, onScreen: false, behind: false };
    this._q = { x: 0, y: 0, onScreen: false, behind: false };
    this._r = { x: 0, y: 0, onScreen: false, behind: false };
    this.edges = Array.from({ length: 24 }, () => ({ kind: '', x: 0, y: 0, ax: 0, ay: 0, dist: 0, crit: false, health: 1, n: 1, used: false, prio: 0 }));
    this.edgeN = 0;
    this._order = new Array(24).fill(0);
    this.trail = new Float32Array(72); // winch basket trail (36 samples × xz offset, 30 Hz)
    this.trailN = 0;
    this.trailT = 0;
    this.trailHead = 0;
    this.hover = null; // survivor under the crosshair
    this._names = new WeakMap(); // pad → «МАЯК «СКАЛИСТЫЙ»» (never written onto other systems' objects)
    this._caps = new WeakMap(); // survivor group → FLIR caption
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    this.dpr = fitCanvas(this.canvas, W, H, 2);
  }

  // --------------------------------------------------------------------------------------------
  draw(dt) {
    const g = this.g;
    const L = this.flight.L;
    const hs = L.hs;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!this.hud.fontsReady) return; // DESIGN §7.3: wait for document.fonts before canvas text
    const ctx = this.ctx;
    const h = ctx.heli;
    if (!h?.position) return;
    const emp = (h.emp || 0) > 0;
    if (emp && (Math.floor(this.m.time * 18) % 5 === 0)) return; // EMP: the overlay drops frames

    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.textBaseline = 'middle';
    g.shadowColor = this.pal.haze ? this.pal.shadow : 'rgba(0,0,0,0.6)'; // pale fog: a darker halo
    g.shadowBlur = (4 - this.pal.haze) * this.dpr;

    this.edgeN = 0;
    this._datums(g, hs);
    this._hazards(g, hs);
    this._pads(g, hs);
    this._signals(g, hs);
    this._lost(g, hs);
    this._people(g, hs);
    this._ring(g, hs);
    this._underText(g);
    this._edges(g, hs);
    this._tape(g, L.tape, hs);
    this._altimeter(g, L.alt, hs);
    if (this.flight.winch.visible > 0.01) this._winch(g, L.winchPanel, hs, dt);
    this._popups(g, hs);
    this._crosshair(g, hs);
    g.shadowBlur = 0;
  }

  // World-anchored markers (pad cues, names, distances) and the heli ring's wedges that slide under the
  // background-less HUD text (meteo, mission strip, bottom bar, key hints) fade out there — soft-edged, so the HUD line stays
  // readable instead of two texts printing over each other. Screen-anchored layers draw after this.
  _underText(g) {
    const rects = this.flight.panels.textRects;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 10 * this.dpr;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.w > 0) g.fillRect(r.x - 4, r.y - 2, r.w + 8, r.h + 4);
    }
    g.restore();
  }

  // ============================================================================================
  // World markers
  _datums(g, hs) {
    const list = this.ctx.survivors?.datums;
    if (!list || !list.length) return;
    const m = this.m;
    const pal = this.pal;
    g.lineWidth = 1;
    g.setLineDash(DASH_C);
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d || !Number.isFinite(d.x)) continue;
      // skip search areas whose groups are all found (survivors may keep them)
      if (d.done || d.found) continue;
      const p = m.project(d.x, 0, d.z, this._p);
      const r = (d.radius || 200) * m.pxPerM;
      if (p.x + r < 0 || p.x - r > this.W || p.y + r < 0 || p.y - r > this.H) {
        this._pushEdge('datum', p.x, p.y, Math.hypot(d.x - m.hx, d.z - m.hz), false, 1, 1);
        continue;
      }
      g.strokeStyle = pal.info;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.ellipse(p.x, p.y, r, r * 0.97, 0, 0, TAU);
      g.stroke();
      // A soft lift only along the inside of the rim: a uniform 7 % veil over the whole area doubled
      // the night sea (0.04 → 0.08) and left the screen beyond the arc as a dark «wedge» in a corner.
      const night = this.ctx.weather?.state?.night || 0;
      const rim = g.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, r);
      rim.addColorStop(0, rgbaHex(pal.info, 0));
      rim.addColorStop(1, rgbaHex(pal.info, 0.07 * (1 - 0.6 * night)));
      g.globalAlpha = 1;
      g.fillStyle = rim;
      g.fill();
      g.globalAlpha = 0.75;
      g.font = font(500, 10 * hs, MONO);
      g.fillStyle = pal.info;
      g.textAlign = 'center';
      g.fillText('РАЙОН ПОИСКА', p.x, p.y - r - 9 * hs);
    }
    g.setLineDash(NO_DASH);
    g.globalAlpha = 1;
  }

  _hazards(g, hs) {
    const list = this.ctx.hazards?.list;
    if (!list || !list.length) return;
    const m = this.m;
    const pal = this.pal;
    for (let i = 0; i < list.length; i++) {
      const hz = list[i];
      if (!hz || hz.alive === false || !hz.position) continue;
      const dist = Math.hypot(hz.position.x - m.hx, hz.position.z - m.hz);
      if (hz.type === 'rogue') {
        this._rogue(g, hz, hs, dist);
        continue;
      }
      if (hz.type === 'satellite') continue;
      const p = m.project(hz.position.x, 0, hz.position.z, this._p);
      const inner = (hz.coreRadius || hz.rc || 15) * 2 * m.pxPerM;
      const outer = (hz.radius || 120) * m.pxPerM;
      const off = p.x + outer < 0 || p.x - outer > this.W || p.y + outer < 0 || p.y - outer > this.H;
      if (off || !p.onScreen) {
        if (dist < 1200) this._pushEdge('hazard', p.x, p.y, dist, dist < 400, 1, 1);
        if (off) continue;
      }
      const stageA = hz.stage === 1 || hz.stage === 2 ? 0.6 : 1;
      g.strokeStyle = pal.hazard;
      g.lineWidth = 1.2 * hs;
      g.globalAlpha = 0.85 * stageA;
      g.setLineDash(DASH_A);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(10 * hs, inner), 0, TAU);
      g.stroke();
      g.globalAlpha = 0.3 * stageA;
      g.setLineDash(DASH_B);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(16 * hs, outer), 0, TAU);
      g.stroke();
      g.setLineDash(NO_DASH);
      // path for the next 10 s
      const v = hz.velocity;
      if (v && (v.x || v.z)) {
        const q = m.project(hz.position.x + v.x * 10, 0, hz.position.z + v.z * 10, this._q);
        g.globalAlpha = 0.7 * stageA;
        g.setLineDash(DASH_B);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
        g.setLineDash(NO_DASH);
        const a = Math.atan2(q.y - p.y, q.x - p.x);
        this._arrowHead(g, q.x, q.y, a, 6 * hs);
      }
      // ▲ glyph + label
      g.globalAlpha = 1;
      this._glyph(g, 'hazard', p.x, p.y - Math.max(10 * hs, inner) - 10 * hs, 7 * hs);
      g.font = font(600, 10.5 * hs, MONO);
      g.fillStyle = pal.hazard;
      g.textAlign = 'center';
      const label = hz.label || (hz.type === 'whirlpool' ? 'ВОДОВОРОТ' : hz.type === 'hail' ? 'ГРАД' : hz.type === 'downburst' ? 'ШКВАЛ' : 'ОПАСНОСТЬ');
      g.fillText(label, p.x, p.y + Math.max(10 * hs, inner) + 11 * hs);
      g.fillStyle = pal.dim;
      g.fillText(distU(dist), p.x, p.y + Math.max(10 * hs, inner) + 24 * hs);
    }
    g.globalAlpha = 1;
  }

  // Rogue wave: a line of chevrons along the bowed crest, «ВАЛ 14 М · 9 С» (DESIGN §7.3.6).
  _rogue(g, hz, hs, dist) {
    const m = this.m;
    const pal = this.pal;
    const c = hz.crest;
    const dir = hz.dir || c?.dir;
    const org = hz.origin || c?.origin;
    if (!dir || !org) return;
    const dx = dir.x;
    const dz = dir.y ?? dir.z ?? 0;
    const L = hz.length || c?.length || 500;
    const bow = c?.bow ?? 0.0015;
    const px = -dz;
    const pz = dx;
    const eta = hz.eta ?? 0;
    const blink = eta < 6 ? 0.65 + 0.35 * Math.sin(m.time * 12) : 1;
    g.strokeStyle = pal.hazard;
    g.lineWidth = 1.6 * hs;
    let anyOn = false;
    const n = 22;
    for (let k = 0; k <= n; k++) {
      const v = (k / n - 0.5) * L * 0.84;
      const env = Math.exp(-Math.pow(Math.max(Math.abs(v) - 0.3 * L, 0) / (0.12 * L), 2));
      if (env < 0.2) continue;
      const u = -bow * v * v;
      const wxp = org.x + dx * u + px * v;
      const wzp = org.y + dz * u + pz * v;
      const p = m.project(wxp, 0, wzp, this._p);
      if (p.x < -20 || p.y < -20 || p.x > this.W + 20 || p.y > this.H + 20) continue;
      anyOn = true;
      // chevron pointing along the travel direction (screen ≈ world xz)
      const s = 6 * hs;
      g.globalAlpha = env * blink;
      g.beginPath();
      g.moveTo(p.x - dx * s - px * s, p.y - dz * s - pz * s);
      g.lineTo(p.x + dx * s * 0.6, p.y + dz * s * 0.6);
      g.lineTo(p.x - dx * s + px * s, p.y - dz * s + pz * s);
      g.stroke();
    }
    g.globalAlpha = 1;
    const p = m.project(hz.position.x, 0, hz.position.z, this._p);
    if (!anyOn || !p.onScreen) {
      this._pushEdge('hazard', p.x, p.y, dist, true, 1, 1);
      if (!anyOn) return;
    }
    // label at the crest point nearest the heli
    const H = Math.round(hz.height || c?.height || 14);
    const t = Math.max(0, Math.round(eta));
    g.font = font(600, 11 * hs, MONO);
    g.fillStyle = pal.hazard;
    g.textAlign = 'center';
    g.globalAlpha = blink;
    g.fillText(`ВАЛ ${H}${NBSP}М · ${t}${NBSP}С`, p.x - dx * 18 * hs, p.y - dz * 18 * hs);
    g.globalAlpha = 1;
  }

  _pads(g, hs) {
    const pads = this.ctx.world?.pads;
    if (!pads || !pads.length) return;
    const m = this.m;
    const pal = this.pal;
    const h = this.ctx.heli;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad?.position) continue;
      const dist = Math.hypot(pad.position.x - m.hx, pad.position.z - m.hz);
      const p = m.project(pad.position.x, pad.position.y || 0, pad.position.z, this._p);
      if (!p.onScreen) {
        if (pad === m.home && m.wantHome) this._pushEdge('nav', p.x, p.y, dist, (h?.fuel ?? 1) < 0.15, 1, 1);
        continue;
      }
      if (dist > 400) continue;
      const r = Math.max(14 * hs, (pad.radius || 12) * m.pxPerM);
      const landed = h?.landed === pad || h?.onPad === pad;
      if (!landed) {
        // dashed landing circle, slowly running
        g.strokeStyle = pal.nav;
        g.lineWidth = 1.2 * hs;
        g.globalAlpha = 0.75;
        g.setLineDash(DASH_A);
        g.lineDashOffset = -m.time * 6;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, TAU);
        g.stroke();
        g.setLineDash(NO_DASH);
        g.lineDashOffset = 0;
        g.globalAlpha = 1;
      }
      // name + distance under the circle
      g.font = font(600, 10.5 * hs, MONO);
      g.fillStyle = pal.nav;
      g.textAlign = 'center';
      const name = this._padName(pad);
      g.fillText(name, p.x, p.y + r + 11 * hs);
      // deck horizon for the moving ship (DESIGN §3.9: closer than 60 m)
      if (pad.type === 'ship' && dist < 90) this._deckHorizon(g, pad, p, r, hs);
      // landing cue
      if (landed) {
        g.fillStyle = pal.ok;
        g.font = font(600, 11 * hs, HEAD);
        g.fillText('НА ПЛОЩАДКЕ', p.x, p.y - r - 12 * hs);
      } else if (dist < 60 && m.hy - (pad.position.y || 0) < 30) {
        // (height above the DECK: the rig's pad is 32 m up, the ship's 9 m)
        g.font = font(600, 12 * hs, HEAD);
        g.fillStyle = pal.fg;
        g.fillText('ПОСАДКА', p.x, p.y - r - 24 * hs);
        const vy = m.vy;
        g.font = font(600, 11 * hs, MONO);
        if (Math.abs(vy) < 1.5) {
          g.fillStyle = pal.ok;
          g.fillText('✓ мягко', p.x, p.y - r - 10 * hs);
        } else if (vy < 0) {
          g.fillStyle = vy < -2.5 ? pal.danger : pal.warn;
          g.fillText(`▼ ${num1(-vy)}${NBSP}м/с`, p.x, p.y - r - 10 * hs);
        }
      }
    }
  }

  _deckHorizon(g, pad, p, r, hs) {
    const tilt = pad.tilt || 0; // roll, rad
    const a = tilt * 4; // exaggerated for reading from above
    const ok = Math.abs(tilt) < (5 * Math.PI) / 180;
    const len = r * 1.6;
    g.strokeStyle = ok ? this.pal.ok : this.pal.warn;
    g.lineWidth = 1.5 * hs;
    g.beginPath();
    g.moveTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
    g.lineTo(p.x - Math.cos(a) * r * 0.4, p.y - Math.sin(a) * r * 0.4);
    g.moveTo(p.x + Math.cos(a) * r * 0.4, p.y + Math.sin(a) * r * 0.4);
    g.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
    g.stroke();
    // fixed reference ticks (true horizon)
    g.strokeStyle = this.pal.dim;
    g.beginPath();
    g.moveTo(p.x - len - 6 * hs, p.y);
    g.lineTo(p.x - len + 2 * hs, p.y);
    g.moveTo(p.x + len - 2 * hs, p.y);
    g.lineTo(p.x + len + 6 * hs, p.y);
    g.stroke();
  }

  _padName(pad) {
    let t = this._names.get(pad);
    if (t) return t;
    const n = String(pad.name || '').replace(/[«»"]/g, '');
    t = pad.type === 'lighthouse' ? `МАЯК «${n.toUpperCase()}»` : pad.type === 'rig' ? `БУРОВАЯ «${n.toUpperCase()}»` : `«${n.toUpperCase()}»`;
    this._names.set(pad, t);
    return t;
  }

  // Signals: expanding «?» rings with an error radius (rocket, smoke, mirror, strobe).
  _signals(g, hs) {
    const m = this.m;
    const pal = this.pal;
    const now = m.time;
    for (let i = 0; i < m.signals.length; i++) {
      const s = m.signals[i];
      const age = now - s.t;
      if (age > s.life || s.error <= 0 || s.kind === 'whistle') continue;
      if (s.s && (isSpotted(s.s) || !isOpen(s.s))) continue;
      const p = m.project(s.x, 0, s.z, this._p);
      const dist = Math.hypot(s.x - m.hx, s.z - m.hz);
      if (!p.onScreen) {
        this._pushEdge('signal', p.x, p.y, dist, false, 1, 1);
        continue;
      }
      const fade = 1 - smooth(s.life - 3, s.life, age);
      const R = Math.max(16 * hs, s.error * m.pxPerM);
      g.strokeStyle = pal.rescue;
      g.lineWidth = 1.2 * hs;
      g.setLineDash(DASH_B);
      g.globalAlpha = 0.8 * fade;
      g.beginPath();
      g.arc(p.x, p.y, R, 0, TAU);
      g.stroke();
      g.setLineDash(NO_DASH);
      for (let k = 0; k < 2; k++) {
        const ph = ((now * 0.6 + k * 0.5) % 1);
        g.globalAlpha = (1 - ph) * 0.6 * fade;
        g.beginPath();
        g.arc(p.x, p.y, R * (0.3 + ph * 0.9), 0, TAU);
        g.stroke();
      }
      g.globalAlpha = fade;
      g.fillStyle = pal.rescue;
      g.font = font(700, 15 * hs, HEAD);
      g.textAlign = 'center';
      g.fillText('?', p.x, p.y);
      g.font = font(600, 10 * hs, MONO);
      const lab = s.kind === 'rocket' ? 'РАКЕТА' : s.kind === 'smoke' ? 'ДЫМ' : s.kind === 'mirror' ? 'ЗЕРКАЛО' : s.kind === 'strobe' ? 'СТРОБ' : 'СИГНАЛ';
      g.fillText(lab, p.x, p.y - R - 9 * hs);
      g.fillStyle = pal.dim;
      g.fillText(`±${Math.round(s.error)}${NBSP}М`, p.x, p.y + R + 10 * hs);
    }
    g.globalAlpha = 1;
  }

  _lost(g, hs) {
    const m = this.m;
    for (let i = 0; i < m.lost.length; i++) {
      const l = m.lost[i];
      const age = m.time - l.t;
      if (age > 7) continue;
      const p = m.project(l.x, 0, l.z, this._p);
      if (!p.onScreen) continue;
      const a = 1 - smooth(5, 7, age);
      g.globalAlpha = a * 0.85;
      g.strokeStyle = '#8B9094';
      g.fillStyle = '#8B9094';
      g.lineWidth = 1.2 * hs;
      // grey buoy: small circle with a mast
      g.beginPath();
      g.arc(p.x, p.y, 5 * hs, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(p.x, p.y - 5 * hs);
      g.lineTo(p.x, p.y - 14 * hs);
      g.stroke();
      g.font = font(600, 10 * hs, MONO);
      g.textAlign = 'center';
      g.fillText('ПОТЕРЯН', p.x, p.y + 15 * hs);
    }
    g.globalAlpha = 1;
  }

  _people(g, hs) {
    const list = this.ctx.survivors?.list;
    if (!list || !list.length) return;
    const m = this.m;
    const pal = this.pal;
    const now = m.time;
    this.hover = null;
    const mouse = this.ctx.input?.mouse;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s?.position || !isOpen(s)) continue;
      const sy = s.position.y || 0;
      const dist = Math.hypot(s.position.x - m.hx, s.position.z - m.hz);
      if (isPinged(s)) {
        // «СИГНАЛ»: no exact position — a dashed chevron on the ring at the bearing ±25°
        this._pingedOnRing(s, hs);
        continue;
      }
      if (!isSpotted(s)) continue;
      const p = m.project(s.position.x, sy, s.position.z, this._p);
      const health = Number.isFinite(s.health) ? s.health : 1;
      const crit = health < 0.3 || !!s.priority;
      if (!p.onScreen) {
        this._pushEdge('rescue', p.x, p.y, dist, crit, health, s.remaining ?? s.count ?? 1);
        continue;
      }
      const foot = (FOOT[s.type] || 2) * (s.type === 'raft' && (s.count || 1) > 4 ? 1.2 : 1);
      let hsz = Math.max(13 * hs, foot * m.pxPerM * 0.5 + 7 * hs);
      // FLIR snap with a 120 ms overshoot
      const ts = m.flir.get(s);
      const age = ts !== undefined ? now - ts : 99;
      if (age < 0.4) hsz *= 1 + 1.1 * (1 - easeOutBack(age / 0.16));
      const sel = s === m.selected;
      const winching = s.state === 'winching' || s === m.winchTarget;
      const col = winching ? pal.ok : pal.rescue;
      g.strokeStyle = col;
      g.lineWidth = (sel ? 1.8 : 1.4) * hs;
      const k = hsz * 0.42;
      g.beginPath();
      // four corner brackets
      g.moveTo(p.x - hsz, p.y - hsz + k);
      g.lineTo(p.x - hsz, p.y - hsz);
      g.lineTo(p.x - hsz + k, p.y - hsz);
      g.moveTo(p.x + hsz - k, p.y - hsz);
      g.lineTo(p.x + hsz, p.y - hsz);
      g.lineTo(p.x + hsz, p.y - hsz + k);
      g.moveTo(p.x + hsz, p.y + hsz - k);
      g.lineTo(p.x + hsz, p.y + hsz);
      g.lineTo(p.x + hsz - k, p.y + hsz);
      g.moveTo(p.x - hsz + k, p.y + hsz);
      g.lineTo(p.x - hsz, p.y + hsz);
      g.lineTo(p.x - hsz, p.y + hsz - k);
      g.stroke();
      // FLIR lock lines right after detection
      if (age < 0.6) {
        g.globalAlpha = 1 - age / 0.6;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(p.x - hsz * 2.4, p.y);
        g.lineTo(p.x - hsz - 2, p.y);
        g.moveTo(p.x + hsz + 2, p.y);
        g.lineTo(p.x + hsz * 2.4, p.y);
        g.moveTo(p.x, p.y - hsz * 2.4);
        g.lineTo(p.x, p.y - hsz - 2);
        g.moveTo(p.x, p.y + hsz + 2);
        g.lineTo(p.x, p.y + hsz * 2.4);
        g.stroke();
        g.globalAlpha = 1;
      }
      // warmth arc 270° (DESIGN: --danger below 30 %)
      const ar = hsz * 1.32 + 3 * hs;
      const a0 = Math.PI * 0.75;
      g.lineWidth = 2 * hs;
      g.strokeStyle = pal.faint;
      g.beginPath();
      g.arc(p.x, p.y, ar, a0, a0 + Math.PI * 1.5);
      g.stroke();
      let warmCol = health < 0.3 ? pal.danger : col;
      let beat = 1;
      if (crit) beat = 0.55 + 0.45 * heartbeat(now, health);
      g.strokeStyle = warmCol;
      g.globalAlpha = beat;
      g.beginPath();
      g.arc(p.x, p.y, ar, a0, a0 + Math.PI * 1.5 * clamp01(health));
      g.stroke();
      g.globalAlpha = 1;
      // count / FLIR caption
      const n = s.remaining ?? s.count ?? 1;
      g.fillStyle = col;
      g.textAlign = 'left';
      if (age < 4.5) {
        const a = age < 4 ? 1 : 1 - (age - 4) / 0.5;
        g.globalAlpha = a;
        g.font = font(600, 11 * hs, HEAD);
        let cap = this._caps.get(s);
        if (!cap || cap.n !== n) this._caps.set(s, (cap = { n, text: `${groupOf(s.type).flir} · ${n}` }));
        cap = cap.text;
        g.fillText(cap, p.x + hsz + 6 * hs, p.y - hsz + 2 * hs);
        g.globalAlpha = 1;
      } else if (n > 1) {
        g.font = font(600, 11 * hs, MONO);
        g.fillText(TIMES[n] || `×${n}`, p.x + hsz + 4 * hs, p.y - hsz + 2 * hs);
      }
      if (sel && dist > 30) {
        g.font = font(500, 10 * hs, MONO);
        g.fillStyle = pal.dim;
        g.fillText(distU(dist), p.x + hsz + 4 * hs, p.y + hsz - 2 * hs);
      }
      // cursor hover → «ЦЕЛЬ»
      if (mouse?.active && Math.abs(mouse.x - p.x) < hsz + 6 && Math.abs(mouse.y - p.y) < hsz + 6) this.hover = s;
    }
  }

  _pingedOnRing(s, hs) {
    const m = this.m;
    if (!m.onScreen) return;
    const R = 84 * hs;
    const id = typeof s.id === 'number' ? s.id : String(s.id || '').length;
    const jitter = ((Math.sin(id * 12.9898) * 43758.5453) % 1) * 0.44; // ±25° fixed per group
    const b = Math.atan2(s.position.x - m.hx, -(s.position.z - m.hz)) + jitter;
    const g = this.g;
    const x = m.sx + Math.sin(b) * (R + 12 * hs);
    const y = m.sy - Math.cos(b) * (R + 12 * hs);
    g.strokeStyle = this.pal.rescue;
    g.lineWidth = 1.4 * hs;
    g.setLineDash(DASH_B);
    g.globalAlpha = 0.65 + 0.35 * Math.sin(m.time * 3);
    this._chevron(g, x, y, b, 8 * hs);
    g.setLineDash(NO_DASH);
    g.globalAlpha = 1;
  }

  // ============================================================================================
  // Ring around the heli (DESIGN §7.3.5)
  _ring(g, hs) {
    const m = this.m;
    if (!m.onScreen) return;
    const ctx = this.ctx;
    const pal = this.pal;
    const h = ctx.heli;
    const R = 84 * hs;
    const cx = m.sx;
    const cy = m.sy;
    // idle dimming: 3 s without events → 45 %
    const inp = ctx.input;
    const mv = inp?.axis ? Math.hypot(inp.axis('moveX'), inp.axis('moveY')) : 0; // axis(): no allocation
    if (mv > 0.2 || (h?.winch?.state && h.winch.state !== 'stowed')) m.activity = 0;
    const ringA = 1 - 0.55 * smooth(3, 4, m.activity);

    g.globalAlpha = ringA;
    g.strokeStyle = pal.fg;
    g.lineWidth = 1;
    g.globalAlpha = 0.35 * ringA;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    // ticks every 30°, cardinals longer + letters
    g.globalAlpha = 0.7 * ringA;
    g.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      const l = k % 3 === 0 ? 8 : 4;
      const sx = Math.sin(a);
      const sy = -Math.cos(a);
      g.moveTo(cx + sx * R, cy + sy * R);
      g.lineTo(cx + sx * (R + l * hs), cy + sy * (R + l * hs));
    }
    g.stroke();
    g.font = font(600, 10 * hs, MONO);
    g.fillStyle = pal.fg;
    g.textAlign = 'center';
    g.globalAlpha = 0.6 * ringA;
    g.fillText('С', cx, cy - R - 16 * hs);
    g.fillText('Ю', cx, cy + R + 16 * hs);
    g.fillText('В', cx + R + 16 * hs, cy);
    g.fillText('З', cx - R - 16 * hs, cy);

    // heading tick on the ring
    const hd = m.heading;
    g.globalAlpha = 0.9 * ringA;
    g.strokeStyle = pal.fg;
    g.lineWidth = 2 * hs;
    g.beginPath();
    g.moveTo(cx + Math.sin(hd) * (R - 7 * hs), cy - Math.cos(hd) * (R - 7 * hs));
    g.lineTo(cx + Math.sin(hd) * (R - 1 * hs), cy - Math.cos(hd) * (R - 1 * hs));
    g.stroke();

    this._wind(g, cx, cy, R, hs, ringA);
    this._predictor(g, hs, ringA);
    this._wedges(g, cx, cy, R, hs, ringA);
    this._whistles(g, cx, cy, R, hs);
    this._epirbRing(g, cx, cy, R, hs, ringA);
    this._refuelArc(g, cx, cy, R, hs);
    g.globalAlpha = 1;
  }

  _wind(g, cx, cy, R, hs, ringA) {
    const m = this.m;
    const ws = this.ctx.weather?.state;
    if (!ws?.windDir) return;
    const W = (ws.windSpeed || 0) + (ws.gust || 0);
    if (W < 0.8) return;
    const gu = m.gust;
    const gustOn = gu.active;
    // chevrons sit on the windward side and run downwind (into the ring)
    let dx = ws.windDir.x;
    let dz = ws.windDir.y;
    if (gustOn) {
      dx = gu.dirX;
      dz = gu.dirZ;
    }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const up = Math.atan2(-dx, dz); // screen angle of the upwind side
    const col = gustOn ? this.pal.warn : this.pal.wind;
    const a = (0.3 + 0.7 * Math.min(1, W / 25)) * (gustOn ? 1 : ringA);
    g.strokeStyle = col;
    g.lineWidth = 1.6 * hs;
    const speed = 0.6 + Math.min(1.6, W / 14);
    const spacing = 10 * hs;
    const off = ((m.time * speed * 14 * hs) % spacing);
    for (let k = 0; k < 3; k++) {
      const r = R + 34 * hs - k * spacing - off;
      const fade = clamp01((R + 36 * hs - r) / (8 * hs)) * clamp01((r - R - 4 * hs) / (8 * hs));
      g.globalAlpha = a * fade;
      const x = cx + Math.sin(up) * r;
      const y = cy - Math.cos(up) * r;
      this._chevron(g, x, y, up + Math.PI, 5.5 * hs);
    }
    if (gustOn) {
      // countdown arc on the incoming side + «ПОРЫВ 4»
      const frac = gu.eta > 0 ? clamp01(gu.eta / gu.eta0) : 0;
      g.globalAlpha = 1;
      g.lineWidth = 3 * hs;
      g.strokeStyle = this.pal.warn;
      const a0 = up - Math.PI / 2 - 0.42;
      if (frac > 0) {
        g.beginPath();
        g.arc(cx, cy, R + 4 * hs, a0, a0 + 0.84 * frac);
        g.stroke();
      }
      const lx = cx + Math.sin(up) * (R + 50 * hs);
      const ly = cy - Math.cos(up) * (R + 50 * hs);
      g.font = font(600, 12 * hs, HEAD);
      g.fillStyle = this.pal.warn;
      g.textAlign = 'center';
      if (gu.eta > 0) g.fillText(`ПОРЫВ ${Math.ceil(gu.eta)}`, lx, ly);
      else {
        g.globalAlpha = 0.5 + 0.5 * Math.sin(m.time * 14);
        g.fillText('ПОРЫВ', lx, ly);
      }
    }
    g.globalAlpha = 1;
  }

  // Where the heli will be in 3 s (incl. drift): dotted line of projected world points.
  _predictor(g, hs, ringA) {
    const m = this.m;
    if (m.speed < 1.2 || this.ctx.heli?.landed) return;
    g.fillStyle = this.pal.fg;
    const amax = 6;
    const ax = Math.max(-amax, Math.min(amax, m.ax));
    const az = Math.max(-amax, Math.min(amax, m.az));
    let lx = m.sx;
    let ly = m.sy;
    for (let k = 1; k <= 12; k++) {
      const t = k * 0.25;
      const x = m.hx + m.vx * t + 0.5 * ax * t * t * 0.5;
      const z = m.hz + m.vz * t + 0.5 * az * t * t * 0.5;
      const p = m.project(x, m.hy, z, this._p);
      lx = p.x;
      ly = p.y;
      const d = Math.hypot(p.x - m.sx, p.y - m.sy);
      if (d < 84 * hs * 0.35) continue;
      g.globalAlpha = (0.85 - k * 0.04) * ringA;
      g.beginPath();
      g.arc(p.x, p.y, (k === 12 ? 1.4 : 1.2) * hs, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 0.9 * ringA;
    g.strokeStyle = this.pal.fg;
    g.lineWidth = 1.2 * hs;
    g.beginPath();
    g.arc(lx, ly, 5 * hs, 0, TAU);
    g.stroke();
    g.font = font(500, 9 * hs, MONO);
    g.fillStyle = this.pal.dim;
    g.textAlign = 'left';
    g.fillText('3С', lx + 8 * hs, ly);
    g.globalAlpha = 1;
  }

  // Bearing wedges: ◆ selected target, ○H home, ▲ hazards within 600 m.
  _wedges(g, cx, cy, R, hs, ringA) {
    const m = this.m;
    const pal = this.pal;
    const s = m.selected;
    if (s?.position && m.selectedDist > 20) {
      const b = Math.atan2(s.position.x - m.hx, -(s.position.z - m.hz));
      this._wedge(g, cx, cy, R, b, 'rescue', pal.rescue, distU(m.selectedDist), hs, 1);
    }
    if (m.wantHome && m.home) {
      const b = Math.atan2(m.home.position.x - m.hx, -(m.home.position.z - m.hz));
      this._wedge(g, cx, cy, R, b, 'nav', pal.nav, distU(m.homeDist), hs, 1);
    }
    const list = this.ctx.hazards?.list;
    if (list) {
      let n = 0;
      for (let i = 0; i < list.length && n < 3; i++) {
        const hz = list[i];
        if (!hz?.position || hz.alive === false || hz.type === 'satellite') continue;
        const d = Math.hypot(hz.position.x - m.hx, hz.position.z - m.hz);
        if (d > 600) continue;
        n++;
        m.activity = 0;
        const b = Math.atan2(hz.position.x - m.hx, -(hz.position.z - m.hz));
        this._wedge(g, cx, cy, R, b, 'hazard', pal.hazard, distU(d), hs, 1);
      }
    }
    g.globalAlpha = ringA;
  }

  _wedge(g, cx, cy, R, b, kind, col, label, hs, a) {
    const sx = Math.sin(b);
    const sy = -Math.cos(b);
    g.globalAlpha = a;
    g.fillStyle = col;
    g.strokeStyle = col;
    // small wedge touching the ring
    const w = 0.09;
    g.beginPath();
    g.moveTo(cx + Math.sin(b - w) * (R + 2 * hs), cy - Math.cos(b - w) * (R + 2 * hs));
    g.lineTo(cx + sx * (R + 9 * hs), cy + sy * (R + 9 * hs));
    g.lineTo(cx + Math.sin(b + w) * (R + 2 * hs), cy - Math.cos(b + w) * (R + 2 * hs));
    g.closePath();
    g.fill();
    const gx = cx + sx * (R + 20 * hs);
    const gy = cy + sy * (R + 20 * hs);
    this._glyph(g, kind, gx, gy, 6 * hs);
    g.font = font(600, 10.5 * hs, MONO);
    g.fillStyle = col;
    g.textAlign = sx > 0.3 ? 'left' : sx < -0.3 ? 'right' : 'center';
    const tx = gx + (sx > 0.3 ? 11 * hs : sx < -0.3 ? -11 * hs : 0);
    const ty = gy + (Math.abs(sx) <= 0.3 ? (sy < 0 ? -13 * hs : 13 * hs) : 0);
    g.fillText(label, tx, ty);
  }

  _whistles(g, cx, cy, R, hs) {
    const m = this.m;
    for (let i = 0; i < m.whistles.length; i++) {
      const w = m.whistles[i];
      const age = m.time - w.t;
      if (age > 2.6) continue;
      const a = 1 - smooth(1.6, 2.6, age);
      const half = (20 * Math.PI) / 180; // arc «СВИСТОК» 40°
      const b = w.bearing;
      const a0 = b - Math.PI / 2 - half;
      g.globalAlpha = a;
      g.strokeStyle = this.pal.rescue;
      g.lineWidth = 3 * hs;
      g.beginPath();
      g.arc(cx, cy, R + 6 * hs + age * 6 * hs, a0, a0 + half * 2);
      g.stroke();
      g.font = font(600, 10.5 * hs, HEAD);
      g.fillStyle = this.pal.rescue;
      g.textAlign = 'center';
      g.fillText('СВИСТОК', cx + Math.sin(b) * (R + 24 * hs + age * 6 * hs), cy - Math.cos(b) * (R + 24 * hs + age * 6 * hs));
    }
    g.globalAlpha = 1;
  }

  _epirbRing(g, cx, cy, R, hs, ringA) {
    const m = this.m;
    if (this.ctx.settings?.get('difficulty') === 'ace') return; // ace: radar only (DESIGN §3.17)
    for (let i = 0; i < m.epirb.length; i++) {
      const e = m.epirb[i];
      const age = m.time - e.t;
      if (age > 6) continue;
      if (e.s && (isSpotted(e.s) || !isOpen(e.s))) continue;
      const half = Math.max(0.05, (e.error * Math.PI) / 180);
      const blink = Math.sin(m.time * 9) > 0 ? 1 : 0.35;
      g.globalAlpha = blink * ringA * (1 - smooth(4, 6, age));
      g.strokeStyle = this.pal.info;
      g.lineWidth = 2 * hs;
      g.setLineDash(DASH_B);
      const a0 = e.bearing - Math.PI / 2 - half;
      g.beginPath();
      g.arc(cx, cy, R - 5 * hs, a0, a0 + half * 2);
      g.stroke();
      g.setLineDash(NO_DASH);
    }
    g.globalAlpha = 1;
  }

  // Refuelling: the ring fills with fuel (animated arc), DESIGN §3.16 «заправка анимированными дугами».
  _refuelArc(g, cx, cy, R, hs) {
    const h = this.ctx.heli;
    if (!h?.refueling && !h?.landed) return;
    if (!h.refueling) return;
    const f = clamp01(h.fuel ?? 0);
    g.globalAlpha = 0.85;
    g.strokeStyle = this.pal.nav;
    g.lineWidth = 3 * hs;
    g.beginPath();
    g.arc(cx, cy, R - 4 * hs, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    g.stroke();
    const run = (this.m.time * 1.4) % 1;
    g.globalAlpha = 0.5 * (1 - run);
    g.beginPath();
    g.arc(cx, cy, R - 4 * hs + run * 14 * hs, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    g.stroke();
    g.globalAlpha = 1;
    g.font = font(600, 10 * hs, MONO);
    g.fillStyle = this.pal.nav;
    g.textAlign = 'center';
    g.fillText(`ЗАПРАВКА ${Math.round(f * 100)}${NBSP}%`, cx, cy + R - 16 * hs);
  }

  // ============================================================================================
  // Edge indicators (DESIGN §7.3.7)
  _pushEdge(kind, x, y, dist, crit, health, n) {
    if (this.edgeN >= this.edges.length) return;
    const e = this.edges[this.edgeN++];
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.dist = dist;
    e.crit = crit;
    e.health = health;
    e.n = n || 1;
    e.used = false;
    e.prio = (kind === 'hazard' ? 3 : kind === 'rescue' ? 2 : kind === 'nav' ? 1.5 : kind === 'signal' ? 1.2 : 0.5) + (crit ? 2 : 0) - dist / 4000;
  }

  _edges(g, hs) {
    const N = this.edgeN;
    if (!N) return;
    const W = this.W;
    const H = this.H;
    const cx = W / 2;
    const cy = H / 2;
    const ax = cx - EDGE_MARGIN;
    const ay = cy - EDGE_MARGIN;
    // place on the ellipse
    for (let i = 0; i < N; i++) {
      const e = this.edges[i];
      let dx = e.x - cx;
      let dy = e.y - cy;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
        dx = 0;
        dy = -1;
      }
      const k = 1 / Math.sqrt((dx * dx) / (ax * ax) + (dy * dy) / (ay * ay));
      e.ax = cx + dx * k;
      e.ay = cy + dy * k;
      this._avoidPanels(e);
      this._order[i] = i;
    }
    // priority order (insertion sort on a tiny array, no allocation)
    const ord = this._order;
    for (let i = 1; i < N; i++) {
      const v = ord[i];
      let j = i - 1;
      while (j >= 0 && this.edges[ord[j]].prio < this.edges[v].prio) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v;
    }
    // merge neighbours of the same kind closer than 26 px, draw ≤ 8
    let drawn = 0;
    for (let a = 0; a < N && drawn < EDGE_MAX; a++) {
      const e = this.edges[ord[a]];
      if (e.used) continue;
      e.used = true;
      let count = e.kind === 'rescue' ? e.n : 1;
      let merged = 1;
      for (let b = a + 1; b < N; b++) {
        const f = this.edges[ord[b]];
        if (f.used || f.kind !== e.kind) continue;
        if (Math.hypot(f.ax - e.ax, f.ay - e.ay) < MERGE_PX * hs) {
          f.used = true;
          merged++;
          count += f.kind === 'rescue' ? f.n : 1;
          if (f.dist < e.dist) e.dist = f.dist;
          e.crit = e.crit || f.crit;
        }
      }
      this._drawEdge(g, e, merged > 1 || (e.kind === 'rescue' && count > 1) ? count : 0, hs);
      drawn++;
    }
  }

  _avoidPanels(e) {
    const rects = this.flight.L.avoid;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (e.ax > r.x && e.ax < r.x + r.w && e.ay > r.y && e.ay < r.y + r.h) {
        // push out along the cheaper axis — only toward the screen centre (indicators then gather in
        // one column beside the panel and merge, instead of lining up in the gap between two panels)
        // and never past the screen edge
        const pad = 22;
        const W = this.W;
        const H = this.H;
        const cx = W / 2;
        const cy = H / 2;
        const dl = r.x - 4 >= pad && cx < e.ax ? e.ax - r.x : Infinity;
        const dr = r.x + r.w + 4 <= W - pad && cx > e.ax ? r.x + r.w - e.ax : Infinity;
        const dt = r.y - 4 >= pad && cy < e.ay ? e.ay - r.y : Infinity;
        const db = r.y + r.h + 4 <= H - pad && cy > e.ay ? r.y + r.h - e.ay : Infinity;
        const m = Math.min(dl, dr, dt, db);
        if (m === Infinity) continue;
        if (m === dl) e.ax = r.x - 4;
        else if (m === dr) e.ax = r.x + r.w + 4;
        else if (m === dt) e.ay = r.y - 4;
        else e.ay = r.y + r.h + 4;
      }
    }
  }

  _drawEdge(g, e, count, hs) {
    const pal = this.pal;
    const col = e.kind === 'rescue' ? pal.rescue : e.kind === 'nav' ? pal.nav : e.kind === 'hazard' ? pal.hazard : e.kind === 'signal' ? pal.rescue : pal.info;
    const W = this.W;
    const H = this.H;
    const ang = Math.atan2(e.ay - H / 2, e.ax - W / 2);
    let s = 1;
    let a = 1;
    if (e.crit) {
      const hb = heartbeat(this.m.time, e.health);
      s = 1 + 0.22 * hb;
      a = 0.7 + 0.3 * hb;
    }
    if (e.kind === 'datum') a *= 0.7;
    g.globalAlpha = a;
    g.fillStyle = col;
    g.strokeStyle = col;
    g.lineWidth = 1.4 * hs;
    // outward triangle
    const tx = e.ax + Math.cos(ang) * 13 * hs * s;
    const ty = e.ay + Math.sin(ang) * 13 * hs * s;
    const tsz = 5 * hs * s;
    g.beginPath();
    g.moveTo(tx + Math.cos(ang) * tsz, ty + Math.sin(ang) * tsz);
    g.lineTo(tx + Math.cos(ang + 2.3) * tsz, ty + Math.sin(ang + 2.3) * tsz);
    g.lineTo(tx + Math.cos(ang - 2.3) * tsz, ty + Math.sin(ang - 2.3) * tsz);
    g.closePath();
    g.fill();
    // glyph (14 px)
    this._glyph(g, e.kind === 'signal' ? 'signal' : e.kind, e.ax, e.ay, 7 * hs * s);
    // label inward
    const lx = e.ax - Math.cos(ang) * 16 * hs;
    const ly = e.ay - Math.sin(ang) * 16 * hs;
    g.font = font(600, 10.5 * hs, MONO);
    g.textAlign = Math.cos(ang) > 0.35 ? 'right' : Math.cos(ang) < -0.35 ? 'left' : 'center';
    const dy = Math.abs(Math.cos(ang)) <= 0.35 ? (Math.sin(ang) < 0 ? 8 * hs : -8 * hs) : 0;
    g.fillStyle = col;
    if (count > 1) {
      g.fillText(TIMES[count] || `×${count}`, lx, ly + dy - 6 * hs);
      g.fillStyle = pal.dim;
      g.fillText(distU(e.dist), lx, ly + dy + 7 * hs);
    } else {
      g.fillText(e.kind === 'datum' ? 'РАЙОН' : distU(e.dist), lx, ly + dy);
      if (e.kind === 'datum') {
        g.fillStyle = pal.dim;
        g.fillText(distU(e.dist), lx, ly + dy + 13 * hs);
      }
    }
    g.globalAlpha = 1;
  }

  // ◆ / ○H / ▲ / ? glyphs — categories are always distinguished by shape (DESIGN §7.3).
  _glyph(g, kind, x, y, r) {
    const pal = this.pal;
    if (kind === 'rescue') {
      g.fillStyle = pal.rescue;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.8, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r * 0.8, y);
      g.closePath();
      g.fill();
    } else if (kind === 'nav') {
      g.strokeStyle = pal.nav;
      g.fillStyle = pal.nav;
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      g.font = font(700, r * 1.3, HEAD);
      g.textAlign = 'center';
      g.fillText('H', x, y + 0.5);
    } else if (kind === 'hazard') {
      g.fillStyle = pal.hazard;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.95, y + r * 0.75);
      g.lineTo(x - r * 0.95, y + r * 0.75);
      g.closePath();
      g.fill();
    } else if (kind === 'signal') {
      g.strokeStyle = pal.rescue;
      g.fillStyle = pal.rescue;
      g.lineWidth = 1.2;
      g.setLineDash(DASH_B);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      g.setLineDash(NO_DASH);
      g.font = font(700, r * 1.5, HEAD);
      g.textAlign = 'center';
      g.fillText('?', x, y + 0.5);
    } else {
      g.strokeStyle = pal.info;
      g.lineWidth = 1.2;
      g.setLineDash(DASH_B);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      g.setLineDash(NO_DASH);
    }
  }

  _chevron(g, x, y, ang, s) {
    // chevron pointing along screen angle `ang` (0 = up, clockwise)
    const fx = Math.sin(ang);
    const fy = -Math.cos(ang);
    const px = -fy;
    const py = fx;
    g.beginPath();
    g.moveTo(x - fx * s + px * s, y - fy * s + py * s);
    g.lineTo(x, y);
    g.lineTo(x - fx * s - px * s, y - fy * s - py * s);
    g.stroke();
  }

  _arrowHead(g, x, y, a, s) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - Math.cos(a - 0.45) * s, y - Math.sin(a - 0.45) * s);
    g.moveTo(x, y);
    g.lineTo(x - Math.cos(a + 0.45) * s, y - Math.sin(a + 0.45) * s);
    g.stroke();
  }

  // ============================================================================================
  // Compass tape (DESIGN §7.3.1): ‹ З ··· С ··◆····▲··· В ›
  _tape(g, r, hs) {
    const m = this.m;
    const pal = this.pal;
    const hdg = ((m.heading * 180) / Math.PI + 360) % 360;
    const span = 70; // ± degrees shown
    const cx = r.x + r.w / 2;
    const ppd = r.w / (2 * span);
    const yBase = r.y + r.h * 0.62;
    g.lineWidth = 1;
    g.strokeStyle = pal.fg;
    g.fillStyle = pal.fg;
    g.textAlign = 'center';
    const start = Math.ceil((hdg - span) / 5) * 5;
    g.font = font(600, 11 * hs, MONO);
    for (let d = start; d <= hdg + span; d += 5) {
      const off = d - hdg;
      const x = cx + off * ppd;
      const fade = 1 - smooth(span * 0.6, span, Math.abs(off));
      const dd = ((d % 360) + 360) % 360;
      if (dd % 45 === 0) {
        g.globalAlpha = fade;
        const lab = dd === 0 ? 'С' : dd === 90 ? 'В' : dd === 180 ? 'Ю' : dd === 270 ? 'З' : dd === 45 ? 'СВ' : dd === 135 ? 'ЮВ' : dd === 225 ? 'ЮЗ' : 'СЗ';
        g.font = dd % 90 === 0 ? font(700, 13 * hs, HEAD) : font(600, 10.5 * hs, MONO);
        g.fillText(lab, x, yBase - 1);
      } else if (dd % 15 === 0) {
        g.globalAlpha = fade * 0.75;
        g.font = font(500, 9 * hs, MONO);
        g.fillText(String(dd).padStart(3, '0'), x, yBase - 1);
      } else {
        g.globalAlpha = fade * 0.55;
        g.beginPath();
        g.arc(x, yBase, 0.9 * hs, 0, TAU);
        g.fill();
      }
    }
    // glyphs: people ◆, pads ○H, hazards ▲ at their bearings; clamped ones at the ends as ‹ ›
    const list = this.ctx.survivors?.list;
    if (list) for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s?.position || !isOpen(s) || !isSpotted(s)) continue;
      this._tapeGlyph(g, 'rescue', s.position.x, s.position.z, hdg, span, cx, ppd, r, hs);
    }
    const pads = this.ctx.world?.pads;
    if (pads) for (let i = 0; i < pads.length; i++) if (pads[i]?.position) this._tapeGlyph(g, 'nav', pads[i].position.x, pads[i].position.z, hdg, span, cx, ppd, r, hs);
    const hz = this.ctx.hazards?.list;
    if (hz) for (let i = 0; i < hz.length; i++) if (hz[i]?.position && hz[i].alive !== false && hz[i].type !== 'satellite') this._tapeGlyph(g, 'hazard', hz[i].position.x, hz[i].position.z, hdg, span, cx, ppd, r, hs);
    g.globalAlpha = 1;
    // centre index + heading box
    g.strokeStyle = pal.fg;
    g.lineWidth = 1.2 * hs;
    g.beginPath();
    g.moveTo(cx - 5 * hs, r.y);
    g.lineTo(cx, r.y + 5 * hs);
    g.lineTo(cx + 5 * hs, r.y);
    g.stroke();
    g.font = font(600, 9 * hs, MONO);
    g.fillStyle = pal.dim;
    g.textAlign = 'left';
    g.fillText('‹', r.x - 10 * hs, yBase);
    g.textAlign = 'right';
    g.fillText('›', r.x + r.w + 10 * hs, yBase);
    // heading readout under the tape
    g.font = font(600, 11 * hs, MONO);
    g.fillStyle = pal.fg;
    g.textAlign = 'center';
    g.fillText(deg3(hdg), cx, r.y + r.h + 7 * hs);
  }

  _tapeGlyph(g, kind, x, z, hdg, span, cx, ppd, r, hs) {
    const m = this.m;
    if (Math.abs(x - m.hx) + Math.abs(z - m.hz) < 30) return; // no bearing to something under us
    const b = (Math.atan2(x - m.hx, -(z - m.hz)) * 180) / Math.PI;
    let off = ((b - hdg + 540) % 360) - 180;
    const out = Math.abs(off) > span;
    if (out) off = Math.sign(off) * span;
    g.globalAlpha = out ? 0.35 : 1;
    this._glyph(g, kind, cx + off * ppd, r.y + r.h * 0.2, 4.5 * hs);
  }

  // ============================================================================================
  // Radar altimeter «РВ» scale (DESIGN §7.3.4): 8×140 px, √-scale 0..120 m, zones, caret, target
  // chevron, local crest line, rogue crest bar; «breathes» with the swell under the heli.
  _altimeter(g, r, hs) {
    const ctx = this.ctx;
    const m = this.m;
    const pal = this.pal;
    const h = ctx.heli;
    const Y = (alt) => r.y + r.h - r.h * Math.sqrt(clamp01(alt / 120));
    // frame
    g.strokeStyle = pal.faint;
    g.lineWidth = 1;
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    // 0–8 m red hatch
    g.save();
    g.beginPath();
    g.rect(r.x, Y(8), r.w, Y(0) - Y(8));
    g.clip();
    g.strokeStyle = pal.danger;
    g.globalAlpha = 0.85;
    g.lineWidth = 1;
    g.beginPath();
    for (let y = Y(8) - r.w; y < Y(0) + r.w; y += 3.5 * hs) {
      g.moveTo(r.x, y + r.w);
      g.lineTo(r.x + r.w, y);
    }
    g.stroke();
    g.restore();
    // 12–25 m «ЛЕБ.» band
    const pulse = this.flight.altPulse ? 0.55 + 0.45 * Math.sin(m.time * 6) : 1;
    g.globalAlpha = pulse;
    g.strokeStyle = pal.ok;
    g.lineWidth = 1.2;
    g.strokeRect(r.x - 1.5, Y(25), r.w + 3, Y(12) - Y(25));
    g.globalAlpha = 0.18 * pulse;
    g.fillStyle = pal.ok;
    g.fillRect(r.x, Y(25), r.w, Y(12) - Y(25));
    g.globalAlpha = pulse;
    g.font = font(600, 9.5 * hs, MONO);
    g.fillStyle = pal.ok;
    g.textAlign = 'left';
    g.fillText('ЛЕБ.', r.x + r.w + 12 * hs, (Y(25) + Y(12)) / 2); // right of the target chevron
    g.globalAlpha = 1;
    // preset ticks 15 / 40 / 90 + ceiling
    g.font = font(500, 8.5 * hs, MONO);
    g.fillStyle = pal.dim;
    g.strokeStyle = pal.dim;
    g.beginPath();
    for (const a of TICKS) {
      const y = Y(a);
      g.moveTo(r.x + r.w, y);
      g.lineTo(r.x + r.w + 4 * hs, y);
    }
    g.stroke();
    g.fillText('40', r.x + r.w + 6 * hs, Y(40));
    g.fillText('90', r.x + r.w + 6 * hs, Y(90));
    g.fillText('120', r.x + r.w + 6 * hs, Y(120) + 4 * hs);
    // local crest line (max sea height over the next 3 s under the heli), relative to the surface now
    const crest = this.flight.crestAbove;
    if (crest > 0.3) {
      g.strokeStyle = pal.warn;
      g.lineWidth = 1.6 * hs;
      g.beginPath();
      g.moveTo(r.x - 3 * hs, Y(crest));
      g.lineTo(r.x + r.w + 3 * hs, Y(crest));
      g.stroke();
    }
    // approaching rogue crest: red bar
    const rog = this.flight.rogueBar;
    if (rog > 0) {
      g.fillStyle = pal.danger;
      g.globalAlpha = 0.6 + 0.4 * Math.sin(m.time * 10);
      g.fillRect(r.x - 6 * hs, Y(rog) - 2 * hs, r.w + 12 * hs, 4 * hs);
      g.globalAlpha = 1;
      g.font = font(600, 9.5 * hs, MONO);
      g.fillStyle = pal.danger;
      g.textAlign = 'right';
      g.fillText(`ВАЛ ${Math.round(rog)}`, r.x - 8 * hs, Y(rog));
    }
    // swell line at the bottom (the scale breathes with the sea)
    const seaY = h?.seaY ?? 0;
    g.strokeStyle = pal.info;
    g.lineWidth = 1.2;
    g.beginPath();
    const by = r.y + r.h + 6 * hs - clamp01(0.5 + seaY / 8) * 4 * hs;
    for (let k = 0; k <= 10; k++) {
      const x = r.x - 4 * hs + (k / 10) * (r.w + 8 * hs);
      const y = by + Math.sin(m.time * 2.2 + k * 0.9) * 1.2 * hs;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // target chevron (hollow, right side)
    const tgt = h?.altTarget;
    if (Number.isFinite(tgt)) {
      const yT = Y(Math.max(0, tgt - (h.seaY || 0) * 0));
      g.strokeStyle = pal.fg;
      g.lineWidth = 1.2 * hs;
      g.beginPath();
      g.moveTo(r.x + r.w + 9 * hs, yT - 4 * hs);
      g.lineTo(r.x + r.w + 3 * hs, yT);
      g.lineTo(r.x + r.w + 9 * hs, yT + 4 * hs);
      g.stroke();
    }
    // current altitude caret (left, filled) + line across
    const yA = Y(m.alt);
    const low = m.alt < 8;
    g.fillStyle = low ? pal.danger : pal.fg;
    g.beginPath();
    g.moveTo(r.x - 2 * hs, yA);
    g.lineTo(r.x - 9 * hs, yA - 4.5 * hs);
    g.lineTo(r.x - 9 * hs, yA + 4.5 * hs);
    g.closePath();
    g.fill();
    g.strokeStyle = low ? pal.danger : pal.fg;
    g.lineWidth = 2 * hs;
    g.beginPath();
    g.moveTo(r.x - 1, yA);
    g.lineTo(r.x + r.w + 1, yA);
    g.stroke();
  }

  // ============================================================================================
  // Winch sight and cable gauge (DESIGN §7.4) — drawn into the panel rectangle laid out by FlightHud.
  _winch(g, P, hs, dt) {
    const ctx = this.ctx;
    const h = ctx.heli;
    const w = h?.winch;
    if (!w) return;
    const m = this.m;
    const pal = this.pal;
    const vis = this.flight.winch.visible;
    const oy = (1 - vis) * 16 * hs; // slide-in 16 px with the DOM panel
    g.globalAlpha = vis;

    // --- cable gauge (10×120) ------------------------------------------------------------------
    const gx = P.x + 22 * hs;
    const gy = P.y + 20 * hs + oy;
    const gh = 116 * hs;
    const gw = 10 * hs;
    const maxL = 32;
    const hoistH = Math.max(2, (h.hoistWorld?.y ?? h.position.y - 1.5) - (w.surfaceY ?? h.seaY ?? 0));
    const Yg = (d) => gy + gh * clamp01(d / maxL);
    g.strokeStyle = pal.faint;
    g.lineWidth = 1;
    g.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
    // cabin block
    g.fillStyle = pal.fg;
    g.fillRect(gx - 3 * hs, gy - 6 * hs, gw + 6 * hs, 4 * hs);
    // live water line under the basket
    const wy = Yg(hoistH);
    g.strokeStyle = pal.info;
    g.lineWidth = 1.4 * hs;
    g.beginPath();
    for (let k = 0; k <= 8; k++) {
      const x = gx - 6 * hs + (k / 8) * (gw + 12 * hs);
      const y = wy + Math.sin(m.time * 3 + k * 1.3) * 1.6 * hs;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = vis * 0.18;
    g.fillStyle = pal.info;
    g.fillRect(gx, Math.min(gy + gh, wy), gw, Math.max(0, gy + gh - wy));
    g.globalAlpha = vis;
    // cable + basket
    const len = w.length || 0;
    const by = Yg(Math.min(len, maxL));
    g.strokeStyle = pal.fg;
    g.lineWidth = 1.2 * hs;
    g.beginPath();
    g.moveTo(gx + gw / 2, gy);
    g.lineTo(gx + gw / 2, by);
    g.stroke();
    g.fillStyle = w.load ? pal.ok : pal.rescue;
    g.fillRect(gx - 2 * hs, by - 3 * hs, gw + 4 * hs, 6 * hs);

    // --- sight (circle 120 px = 14 m, relative to the target) ----------------------------------
    const R = 58 * hs;
    const cx = P.x + 112 * hs;
    const cy = P.y + 80 * hs + oy;
    const ppm = R / 7; // 120 px = 14 m
    const tgt = w.target || w.load || m.selected;
    const tx = tgt?.position ? tgt.position.x : m.hx;
    const tz = tgt?.position ? tgt.position.z : m.hz;
    g.strokeStyle = pal.faint;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R * 0.5, 0, TAU);
    g.stroke();
    // capture circle (dashed, radius from the winch)
    const capR = Math.min(R, (w.radius || 3) * ppm);
    g.strokeStyle = w.inRange ? pal.ok : pal.rescue;
    g.lineWidth = 1.4 * hs;
    g.setLineDash(DASH_B);
    g.beginPath();
    g.arc(cx, cy, capR, 0, TAU);
    g.stroke();
    g.setLineDash(NO_DASH);
    // ◆ target
    if (tgt) this._glyph(g, 'rescue', cx, cy, 5 * hs);
    // basket trail (1.2 s) + ring
    const bk = w.basket;
    let bx = 0;
    let bz = 0;
    if (bk && w.state !== 'stowed') {
      bx = bk.x - tx;
      bz = bk.z - tz;
    } else {
      bx = m.hx - tx;
      bz = m.hz - tz;
    }
    this.trailT += dt;
    if (this.trailT >= 1 / 30) {
      this.trailT = 0;
      const i = this.trailHead * 2;
      this.trail[i] = bx;
      this.trail[i + 1] = bz;
      this.trailHead = (this.trailHead + 1) % 36;
      this.trailN = Math.min(36, this.trailN + 1);
    }
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();
    g.strokeStyle = pal.fg;
    g.lineWidth = 1.2 * hs;
    for (let k = 1; k < this.trailN; k++) {
      const i0 = ((this.trailHead - k + 36) % 36) * 2;
      const i1 = ((this.trailHead - k - 1 + 36) % 36) * 2;
      if (k + 1 > this.trailN) break;
      g.globalAlpha = vis * (1 - k / this.trailN) * 0.7;
      g.beginPath();
      g.moveTo(cx + this.trail[i0] * ppm, cy + this.trail[i0 + 1] * ppm);
      g.lineTo(cx + this.trail[i1] * ppm, cy + this.trail[i1 + 1] * ppm);
      g.stroke();
    }
    g.globalAlpha = vis;
    // heli triangle (relative to the target)
    const hxp = cx + (m.hx - tx) * ppm;
    const hyp = cy + (m.hz - tz) * ppm;
    const hd = m.heading;
    g.fillStyle = pal.dim;
    g.beginPath();
    g.moveTo(hxp + Math.sin(hd) * 7 * hs, hyp - Math.cos(hd) * 7 * hs);
    g.lineTo(hxp + Math.sin(hd + 2.5) * 5 * hs, hyp - Math.cos(hd + 2.5) * 5 * hs);
    g.lineTo(hxp + Math.sin(hd - 2.5) * 5 * hs, hyp - Math.cos(hd - 2.5) * 5 * hs);
    g.closePath();
    g.fill();
    // basket ring
    const bxp = cx + bx * ppm;
    const byp = cy + bz * ppm;
    g.strokeStyle = w.load ? pal.ok : pal.fg;
    g.lineWidth = 2 * hs;
    g.beginPath();
    g.arc(bxp, byp, 5 * hs, 0, TAU);
    g.stroke();
    g.restore();
    // capture fill ring
    const cap = clamp01(w.capture || 0);
    g.strokeStyle = pal.faint;
    g.lineWidth = 3 * hs;
    g.beginPath();
    g.arc(cx, cy, R + 5 * hs, 0, TAU);
    g.stroke();
    if (cap > 0) {
      g.strokeStyle = pal.ok;
      g.beginPath();
      g.arc(cx, cy, R + 5 * hs, -Math.PI / 2, -Math.PI / 2 + TAU * cap);
      g.stroke();
    }
    // patter arrow: where to move (basket → target), synced with the winchman's lines
    const off = Math.hypot(bx, bz);
    const capM = w.radius || 3;
    if (tgt && off > capM * 0.8 && !w.load) {
      const ang = Math.atan2(-bz, -bx); // from basket toward target (screen)
      const since = m.time - m.patter.t;
      const pulse = since < 1.2 ? 1 - since / 1.2 : 0;
      const ax = cx + Math.cos(ang) * (R + 10 * hs);
      const ay = cy + Math.sin(ang) * (R + 10 * hs);
      g.fillStyle = pal.warn;
      g.globalAlpha = vis * (0.65 + 0.35 * pulse);
      const s = (7 + 3 * pulse) * hs;
      g.beginPath();
      g.moveTo(ax + Math.cos(ang) * s, ay + Math.sin(ang) * s);
      g.lineTo(ax + Math.cos(ang + 2.4) * s, ay + Math.sin(ang + 2.4) * s);
      g.lineTo(ax + Math.cos(ang - 2.4) * s, ay + Math.sin(ang - 2.4) * s);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = vis;
    this._waveWindow(g, P, hs, oy, dt, bk && w.state !== 'stowed' ? bk : null);
    g.globalAlpha = 1;
  }

  // [NICE] «Окно волны» (DESIGN §7.4): the sea height under the basket for the next 4 s, troughs
  // hatched, the basket bottom as a dashed line — when to dip, when to wait. Sampled at 15 Hz.
  _waveWindow(g, P, hs, oy, dt, basket) {
    const ocean = this.ctx.ocean;
    if (!ocean?.heightAt) return;
    const m = this.m;
    const wave = this.wave || (this.wave = { t: 1, h: new Float32Array(WAVE_N), x: 0, z: 0, by: 0, ok: false });
    wave.t += dt;
    if (wave.t >= 1 / 15) {
      wave.t = 0;
      const x = basket ? basket.x : m.hx;
      const z = basket ? basket.z : m.hz;
      let sum = 0;
      for (let i = 0; i < WAVE_N; i++) {
        const y = ocean.heightAt(x, z, (i / (WAVE_N - 1)) * 4);
        wave.h[i] = Number.isFinite(y) ? y : 0;
        sum += wave.h[i];
      }
      wave.mean = sum / WAVE_N;
      wave.by = basket ? basket.y - 0.3 : NaN; // basket bottom
      wave.ok = true;
    }
    if (!wave.ok) return;
    const x0 = P.x + 192 * hs;
    const x1 = P.x + 368 * hs;
    const y0 = P.y + 94 * hs + oy;
    const hh = 16 * hs;
    const mid = y0 + hh / 2;
    let amp = 0.8;
    for (let i = 0; i < WAVE_N; i++) amp = Math.max(amp, Math.abs(wave.h[i] - wave.mean));
    const k = (hh / 2) / (amp * 1.15);
    const X = (i) => x0 + ((x1 - x0) * i) / (WAVE_N - 1);
    const Yv = (y) => mid - (y - wave.mean) * k;
    const pal = this.pal;
    // troughs hatched (clip to the area under the mean line and above the curve)
    g.save();
    g.beginPath();
    g.moveTo(X(0), mid);
    for (let i = 0; i < WAVE_N; i++) g.lineTo(X(i), Math.max(mid, Yv(wave.h[i])));
    g.lineTo(X(WAVE_N - 1), mid);
    g.closePath();
    g.clip();
    g.strokeStyle = pal.info;
    g.globalAlpha *= 0.55;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = x0 - hh; x < x1; x += 4 * hs) {
      g.moveTo(x, y0 + hh);
      g.lineTo(x + hh, y0);
    }
    g.stroke();
    g.restore();
    // the surface curve
    g.strokeStyle = pal.info;
    g.lineWidth = 1.3 * hs;
    g.beginPath();
    for (let i = 0; i < WAVE_N; i++) {
      if (i === 0) g.moveTo(X(i), Yv(wave.h[i]));
      else g.lineTo(X(i), Yv(wave.h[i]));
    }
    g.stroke();
    // basket bottom (only when it is within the window's range)
    const yb = Yv(wave.by);
    if (basket && Number.isFinite(yb) && yb > y0 - 4 * hs && yb < y0 + hh + 4 * hs) {
      g.strokeStyle = pal.fg;
      g.lineWidth = 1;
      g.setLineDash(DASH_B);
      g.beginPath();
      g.moveTo(x0, yb);
      g.lineTo(x1, yb);
      g.stroke();
      g.setLineDash(NO_DASH);
    }
    // «now» tick + label
    g.strokeStyle = pal.dim;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, y0 - 2 * hs);
    g.lineTo(x0, y0 + hh + 2 * hs);
    g.stroke();
    g.font = font(600, 8 * hs, MONO);
    g.fillStyle = pal.dim;
    g.textAlign = 'right';
    g.fillText('ВОЛНА · 4 С', x1, y0 - 5 * hs);
  }

  // ============================================================================================
  _popups(g, hs) {
    const m = this.m;
    for (let i = 0; i < m.popups.length; i++) {
      const p = m.popups[i];
      const age = m.time - p.t;
      if (age > 1.8) continue;
      let x;
      let y;
      if (p.hasPos) {
        const q = m.project(p.x, p.y, p.z, this._p);
        x = q.x;
        y = q.y;
      } else {
        x = m.sx + 30 * hs;
        y = m.sy - 30 * hs;
      }
      x = Math.max(40, Math.min(this.W - 40, x));
      y = Math.max(60, Math.min(this.H - 60, y));
      const rise = easeOutBack(Math.min(1, age / 0.5)) * 18 * hs + age * 22 * hs;
      const a = 1 - smooth(1.2, 1.8, age);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.font = font(600, 20 * hs, HEAD);
      g.fillStyle = p.neg ? this.pal.danger : p.color || this.pal.ok;
      g.fillText(p.text, x, y - rise);
      if (p.sub) {
        g.font = font(600, 9.5 * hs, MONO);
        g.fillStyle = this.pal.fg;
        g.fillText(p.sub, x, y - rise + 15 * hs);
      }
    }
    g.globalAlpha = 1;
  }

  // Cursor crosshair 18 px; over a spotted group it becomes «ЦЕЛЬ» brackets (DESIGN §7.3.6).
  _crosshair(g, hs) {
    const ctx = this.ctx;
    const mo = ctx.input?.mouse;
    if (!mo?.active || ctx.mode !== 'play' || ctx.input.lastDevice === 'touch') return;
    if (performance.now() - (mo.lastMoveT || 0) > 6000 && !ctx.heli?.searchlight) return;
    const x = mo.x;
    const y = mo.y;
    const s = 9 * hs;
    const pal = this.pal;
    g.strokeStyle = this.hover ? pal.rescue : pal.fg;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x - s, y);
    g.lineTo(x - 3 * hs, y);
    g.moveTo(x + 3 * hs, y);
    g.lineTo(x + s, y);
    g.moveTo(x, y - s);
    g.lineTo(x, y - 3 * hs);
    g.moveTo(x, y + 3 * hs);
    g.lineTo(x, y + s);
    g.stroke();
    if (this.hover) {
      const b = 16 * hs;
      const k = 5 * hs;
      g.beginPath();
      g.moveTo(x - b, y - b + k);
      g.lineTo(x - b, y - b);
      g.lineTo(x - b + k, y - b);
      g.moveTo(x + b - k, y - b);
      g.lineTo(x + b, y - b);
      g.lineTo(x + b, y - b + k);
      g.moveTo(x + b, y + b - k);
      g.lineTo(x + b, y + b);
      g.lineTo(x + b - k, y + b);
      g.moveTo(x - b + k, y + b);
      g.lineTo(x - b, y + b);
      g.lineTo(x - b, y + b - k);
      g.stroke();
      g.font = font(600, 10 * hs, HEAD);
      g.fillStyle = pal.rescue;
      g.textAlign = 'center';
      g.fillText('ЦЕЛЬ', x, y + b + 10 * hs);
    }
  }
}

const TICKS = [15, 40, 90, 120];
const WAVE_N = 32; // wave-window samples over 4 s
const TIMES = Array.from({ length: 64 }, (_, i) => `×${i}`); // «×3» labels without per-frame strings
