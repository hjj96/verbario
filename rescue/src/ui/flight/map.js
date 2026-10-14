// Tactical map [SHOULD] (DESIGN §7.3.13): hold Tab / M — a round dark sea chart in the centre with the
// search areas and their drift forecast, the call list («Смена»), pads, rain cells, the weather front as
// meteo symbols, people / hazards / signals and the heli. The bathymetry is pre-rendered once per
// operation (common/chart.js 'dark' style); live layers are redrawn at 30 Hz only while the map is held.
import { el, fitCanvas, setClass } from '../common/dom.js';
import { buildChartModel, makeView, drawChart, drawFront } from '../common/chart.js';
import { distL, NBSP, PRESET_SEVERITY } from '../common/fmt.js';
import { isOpen, isSpotted } from './model.js';
import { font, MONO, HEAD } from '../common/fonts.js';

const TAU = Math.PI * 2;

export class TacMap {
  constructor(flight, parent) {
    this.flight = flight;
    this.hud = flight.hud;
    this.ctx = flight.hud.ctx;
    this.node = el('div.hud-map', { parent });
    this.canvas = el('canvas', { parent: this.node });
    this.list = el('div.map-calls', { parent: this.node });
    this.g = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.model = null;
    this.size = 0;
    this.dpr = 1;
    this.open = 0;
    this.acc = 1;
    this._def = null;
    this._listKey = '';
    this._pts = new Array(26).fill(0);
  }

  setup(def) {
    this._def = def;
    this.model = null; // rebuilt lazily the first time the map opens
  }

  resize(W, H) {
    this.size = Math.round(Math.min(W, H) * 0.78);
    this.dpr = fitCanvas(this.canvas, this.size, this.size, 2);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this._baseFor = null;
  }

  _ensureBase() {
    const def = this._def || this.ctx.mission?.def;
    if (!def) return false;
    if (!this.model || this.model.def !== def) {
      const R = def.area?.radius || 1500;
      this.model = buildChartModel(this.ctx.look, def, { radius: R, margin: 1.05, grid: 96, coast: true });
      this._baseFor = null;
    }
    if (this._baseFor === this.model) return true;
    const S = this.size;
    this.view = makeView(this.model, S, S, { span: this.model.R * 2.1 });
    const g = this.base.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.base.width, this.base.height);
    g.save();
    g.beginPath();
    g.arc((S / 2) * this.dpr, (S / 2) * this.dpr, (S / 2) * this.dpr, 0, TAU);
    g.clip();
    drawChart(g, this.model, this.view, { style: 'dark', dpr: this.dpr, border: false, labels: true, fontScale: 1 });
    g.restore();
    this._baseFor = this.model;
    return true;
  }

  update(dt, held) {
    const target = held ? 1 : 0;
    this.open += Math.max(-dt / 0.15, Math.min(dt / 0.15, target - this.open));
    setClass(this.node, 'on', this.open > 0.01);
    this.node.style.opacity = this.open.toFixed(3);
    if (this.open <= 0.01) return;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    if (!this.hud.fontsReady || !this._ensureBase()) return;
    this._draw();
    this._calls();
  }

  _draw() {
    const g = this.g;
    const S = this.size;
    const v = this.view;
    const ctx = this.ctx;
    const pal = this.hud.palette;
    const m = this.flight.model;
    const X = (x) => v.ox + x * v.scale;
    const Z = (z) => v.oy + z * v.scale;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 1, 0, TAU);
    g.clip();
    g.textBaseline = 'middle';
    g.textAlign = 'center';

    // area boundary
    const R = this.model.R;
    g.strokeStyle = pal.dim;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.arc(X(0), Z(0), R * v.scale, 0, TAU);
    g.stroke();
    g.setLineDash([]);

    // rain cells
    const ws = ctx.weather?.state;
    if ((ws?.rain || 0) > 0.25 && ctx.look?.cloudAt) {
      g.strokeStyle = pal.info;
      g.globalAlpha = 0.18;
      g.beginPath();
      const n = 28;
      const step = S / n;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
        const sx = (ix + 0.5) * step;
        const sy = (iy + 0.5) * step;
        const wx = (sx - v.ox) / v.scale;
        const wz = (sy - v.oy) / v.scale;
        if (ctx.look.cloudAt(wx, wz) < 0.5) continue;
        g.moveTo(sx - step / 2, sy + step / 2);
        g.lineTo(sx + step / 2, sy - step / 2);
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // weather front (spatial transition)
    const fr = ws?.front;
    if (fr?.active && fr.origin && fr.dir) {
      const t = fr.t || 0;
      const cx = fr.origin.x + fr.dir.x * (fr.speed || 20) * t;
      const cz = fr.origin.y + fr.dir.y * (fr.speed || 20) * t;
      const pts = this._pts;
      for (let k = -6; k <= 6; k++) {
        const o = k * 220;
        const bend = Math.sin(k * 0.6) * 40;
        pts[(k + 6) * 2] = X(cx - fr.dir.y * o + fr.dir.x * bend);
        pts[(k + 6) * 2 + 1] = Z(cz + fr.dir.x * o + fr.dir.y * bend);
      }
      const tr = ws.transition || {};
      const worse = (PRESET_SEVERITY[tr.to] ?? 0) >= (PRESET_SEVERITY[tr.from] ?? 0);
      drawFront(g, pts, worse ? 'cold' : 'warm', fr.dir.x, fr.dir.y, 0.9);
    }

    // search areas + drift forecast (current + leeway, 2 min)
    const datums = ctx.survivors?.datums;
    const cur = ctx.mission?.def?.current || { x: 0, z: 0 };
    if (datums) for (let i = 0; i < datums.length; i++) {
      const d = datums[i];
      if (!d || d.done || d.found || !Number.isFinite(d.x)) continue;
      const x = X(d.x);
      const y = Z(d.z);
      const r = Math.max(4, (d.radius || 200) * v.scale);
      g.strokeStyle = pal.info;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      const wdx = (ws?.windDir?.x || 0) * (ws?.windSpeed || 0) * 0.035;
      const wdz = (ws?.windDir?.y || 0) * (ws?.windSpeed || 0) * 0.035;
      const dx = (cur.x + wdx) * 120;
      const dz = (cur.z + wdz) * 120;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(X(d.x + dx), Z(d.z + dz));
      g.stroke();
      g.globalAlpha = 0.5;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.arc(X(d.x + dx), Z(d.z + dz), r + 60 * v.scale, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      if (d.label) {
        g.font = font(500, 10, MONO);
        g.fillStyle = pal.info;
        g.fillText(String(d.label).toUpperCase(), x, y - r - 8);
      }
    }

    // pads
    const pads = ctx.world?.pads;
    if (pads) for (const p of pads) {
      if (!p?.position) continue;
      const x = X(p.position.x);
      const y = Z(p.position.z);
      g.strokeStyle = pal.nav;
      g.fillStyle = pal.nav;
      g.lineWidth = 1.3;
      g.beginPath();
      g.arc(x, y, 7, 0, TAU);
      g.stroke();
      g.font = font(700, 9, HEAD);
      g.fillText('H', x, y + 0.5);
      g.font = font(500, 10, MONO);
      g.textAlign = 'left';
      g.fillText(String(p.name || '').toUpperCase(), x + 11, y);
      g.textAlign = 'center';
    }
    // hazards
    const hz = ctx.hazards?.list;
    if (hz) for (const h of hz) {
      if (!h?.position || h.alive === false || h.type === 'satellite') continue;
      const x = X(h.position.x);
      const y = Z(h.position.z);
      g.fillStyle = pal.hazard;
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y + 5);
      g.lineTo(x - 6, y + 5);
      g.closePath();
      g.fill();
      if (h.radius) {
        g.strokeStyle = pal.hazard;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(x, y, h.radius * v.scale, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // people
    const list = ctx.survivors?.list;
    if (list) for (const s of list) {
      if (!s?.position || !isOpen(s) || !isSpotted(s)) continue;
      const x = X(s.position.x);
      const y = Z(s.position.z);
      g.fillStyle = pal.rescue;
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 5, y);
      g.closePath();
      g.fill();
      const n = s.remaining ?? s.count ?? 1;
      if (n > 1) {
        g.font = font(600, 10, MONO);
        g.textAlign = 'left';
        g.fillText(`×${n}`, x + 8, y);
        g.textAlign = 'center';
      }
    }
    // signals
    for (const sg of m.signals) {
      if (m.time - sg.t > sg.life || sg.error <= 0) continue;
      if (sg.s && (isSpotted(sg.s) || !isOpen(sg.s))) continue;
      g.strokeStyle = pal.rescue;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.arc(X(sg.x), Z(sg.z), Math.max(6, sg.error * v.scale), 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = pal.rescue;
      g.font = font(700, 11, HEAD);
      g.fillText('?', X(sg.x), Z(sg.z));
    }
    // heli + heading line
    const hx = X(m.hx);
    const hy = Z(m.hz);
    const hd = m.heading;
    g.strokeStyle = pal.fg;
    g.globalAlpha = 0.4;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx + Math.sin(hd) * 60, hy - Math.cos(hd) * 60);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = pal.fg;
    g.beginPath();
    g.moveTo(hx + Math.sin(hd) * 9, hy - Math.cos(hd) * 9);
    g.lineTo(hx + Math.sin(hd + 2.5) * 6, hy - Math.cos(hd + 2.5) * 6);
    g.lineTo(hx + Math.sin(hd - 2.5) * 6, hy - Math.cos(hd - 2.5) * 6);
    g.closePath();
    g.fill();
    g.restore();

    // rim: ticks + title
    g.strokeStyle = pal.dim;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 1, 0, TAU);
    g.stroke();
    g.font = font(600, 12, HEAD);
    g.fillStyle = pal.fg;
    g.textAlign = 'center';
    g.fillText('КАРТА РАЙОНА', S / 2, 22);
    g.font = font(500, 10, MONO);
    g.fillStyle = pal.dim;
    g.fillText(`РАДИУС ${distL(R).toUpperCase()}`, S / 2, 38);
  }

  _calls() {
    const mis = this.ctx.mission;
    const calls = mis?.endless ? mis.calls : null;
    let key = '';
    if (calls) for (const c of calls) key += `${c.n}:${c.done ? 1 : 0}:${c.outcome || ''};`;
    if (key === this._listKey) return;
    this._listKey = key;
    if (!calls || !calls.length) {
      this.list.innerHTML = '';
      return;
    }
    let html = '<div class="mc-head">ВЫЗОВЫ</div>';
    for (const c of calls.slice(-8)) {
      const st = c.done ? (c.outcome === 'lost' ? 'потерян' : 'закрыт') : 'активен';
      html += `<div class="mc-row${c.done ? ' done' : ''}"><b>№${c.n}</b> ${escapeHtml(String(c.what || ''))} · ${escapeHtml(String(c.square || ''))} · ${c.count || 1}${NBSP}чел. <i>${st}</i></div>`;
    }
    this.list.innerHTML = html;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
