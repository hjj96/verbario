// РАДАР (DESIGN §7.3.8): 208 px, separate canvas redrawn at 30 Hz. North-up, range auto 600 м / 1,2 км /
// 2,4 км to keep the selected target inside. Heli triangle with a 60 s trail, ◆ people, ○H pads,
// ▲ hazards (spiral for spouts, a line of running chevrons for a rogue crest), rain cells hatched from
// the shared cloud field (look.cloudAt × rain — the same field that shades the sea), «×» at strikes for
// 1.5 s, EPIRB bearing blinking --info, sweep 2.4 s with afterglow [SHOULD], wind flag on the rim.
// After an EMP the scope goes blank for its duration («РЛС ПЕРЕЗАГРУЗКА»).
import { fitCanvas } from '../common/dom.js';
import { clamp01, smooth } from '../common/fmt.js';
import { isOpen, isSpotted, isPinged } from './model.js';

const TAU = Math.PI * 2;
const RANGES = [600, 1200, 2400];
const RANGE_TXT = ['600 М', '1,2 КМ', '2,4 КМ'];
const FONT_MONO = '"JetBrains Mono", ui-monospace, "DejaVu Sans Mono", monospace';
const FONT_HEAD = 'Oswald, Impact, "Arial Narrow", sans-serif';
const TRAIL = 60;
const DASH = [2, 3];
const NO_DASH = [];

export class Radar {
  constructor(flight) {
    this.flight = flight;
    this.hud = flight.hud;
    this.ctx = flight.hud.ctx;
    this.m = flight.model;
    this.pal = flight.hud.palette;
    this.node = document.createElement('div');
    this.node.className = 'hud-radar';
    this.canvas = document.createElement('canvas');
    this.node.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.bgVersion = -1;
    this.size = 208;
    this.dpr = 1;
    this.rangeI = 1;
    this.acc = 1;
    this.trail = new Float32Array(TRAIL * 2);
    this.trailN = 0;
    this.trailHead = 0;
    this.trailT = 0;
    this.sweep = 0;
  }

  resize(size) {
    this.size = size;
    this.dpr = fitCanvas(this.canvas, size, size, 2);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    this.bgVersion = -1;
  }

  _background() {
    const g = this.bg.getContext('2d');
    const S = this.size;
    const c = S / 2;
    const R = c - 8;
    const pal = this.pal;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const gr = g.createRadialGradient(c, c, R * 0.1, c, c, R);
    gr.addColorStop(0, 'rgba(10,26,32,0.72)');
    gr.addColorStop(1, 'rgba(4,10,14,0.82)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();
    g.strokeStyle = pal.dim;
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = pal.faint;
    g.beginPath();
    g.arc(c, c, R / 3, 0, TAU);
    g.moveTo(c + (2 * R) / 3, c);
    g.arc(c, c, (2 * R) / 3, 0, TAU);
    g.stroke();
    g.beginPath();
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const l = d % 30 === 0 ? 7 : 3.5;
      g.moveTo(c + Math.sin(a) * R, c - Math.cos(a) * R);
      g.lineTo(c + Math.sin(a) * (R - l), c - Math.cos(a) * (R - l));
    }
    g.strokeStyle = pal.dim;
    g.stroke();
    // cross hair
    g.strokeStyle = pal.faint;
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    g.font = `700 11px ${FONT_HEAD}`;
    g.fillStyle = pal.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('С', c, c - R + 14);
    this.bgVersion = pal.version;
  }

  update(dt) {
    const m = this.m;
    // trail sample once per second (60 s)
    if ((this.ctx.time?.dt || 0) > 0) {
      this.trailT += dt;
      if (this.trailT >= 1) {
        this.trailT = 0;
        const i = this.trailHead * 2;
        this.trail[i] = m.hx;
        this.trail[i + 1] = m.hz;
        this.trailHead = (this.trailHead + 1) % TRAIL;
        this.trailN = Math.min(TRAIL, this.trailN + 1);
      }
    }
    this.sweep = (this.sweep + dt / 2.4) % 1;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    this._autoRange();
    this.draw();
  }

  resetTrail() {
    this.trailN = 0;
    this.trailHead = 0;
  }

  _autoRange() {
    const d = this.m.selected ? this.m.selectedDist : this.m.wantHome ? this.m.homeDist : 500;
    let want = d < 540 ? 0 : d < 1080 ? 1 : 2;
    // hysteresis: only zoom in when comfortably inside
    if (want < this.rangeI && d > RANGES[want] * 0.8) want = this.rangeI;
    this.rangeI = want;
  }

  draw() {
    if (!this.hud.fontsReady) return;
    const g = this.g;
    const S = this.size;
    const c = S / 2;
    const R = c - 8;
    const pal = this.pal;
    const ctx = this.ctx;
    const m = this.m;
    if (this.bgVersion !== pal.version) this._background();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const h = ctx.heli;
    if ((h?.emp || 0) > 0) {
      this._emp(g, c, R);
      return;
    }
    const range = RANGES[this.rangeI];
    const k = R / range;
    const hx = m.hx;
    const hz = m.hz;
    g.save();
    g.beginPath();
    g.arc(c, c, R - 1, 0, TAU);
    g.clip();

    // rain cells (hatched) from the shared cloud field
    const ws = ctx.weather?.state;
    const rain = ws?.rain || 0;
    const look = ctx.look;
    if (rain > 0.25 && look?.cloudAt) {
      g.strokeStyle = pal.info;
      g.globalAlpha = 0.22 * clamp01((rain - 0.25) / 0.5);
      g.lineWidth = 1;
      g.beginPath();
      const step = (2 * R) / 13;
      for (let iy = 0; iy < 13; iy++) {
        for (let ix = 0; ix < 13; ix++) {
          const sx = c - R + (ix + 0.5) * step;
          const sy = c - R + (iy + 0.5) * step;
          const wx = hx + (sx - c) / k;
          const wz = hz + (sy - c) / k;
          if (look.cloudAt(wx, wz) < 0.5) continue;
          const h2 = step * 0.5;
          g.moveTo(sx - h2, sy + h2);
          g.lineTo(sx + h2, sy - h2);
          g.moveTo(sx - h2, sy);
          g.lineTo(sx, sy - h2);
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // sweep with afterglow (off with «Меньше движения»)
    if (!ctx.settings?.get('reduceMotion')) {
      const a = this.sweep * TAU - Math.PI / 2;
      for (let i = 0; i < 10; i++) {
        g.globalAlpha = 0.11 * (1 - i / 10);
        g.fillStyle = pal.info;
        g.beginPath();
        g.moveTo(c, c);
        g.arc(c, c, R, a - (i + 1) * 0.07, a - i * 0.07);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 0.5;
      g.strokeStyle = pal.info;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      g.stroke();
      g.globalAlpha = 1;
    }

    // datums
    const datums = ctx.survivors?.datums;
    if (datums) {
      g.strokeStyle = pal.info;
      g.setLineDash(DASH);
      g.globalAlpha = 0.6;
      for (let i = 0; i < datums.length; i++) {
        const d = datums[i];
        if (!d || d.done || d.found || !Number.isFinite(d.x)) continue;
        g.beginPath();
        g.arc(c + (d.x - hx) * k, c + (d.z - hz) * k, Math.max(3, (d.radius || 200) * k), 0, TAU);
        g.stroke();
      }
      g.setLineDash(NO_DASH);
      g.globalAlpha = 1;
    }

    // trail (60 s)
    g.fillStyle = pal.fg;
    for (let i = 0; i < this.trailN; i++) {
      const j = ((this.trailHead - 1 - i + TRAIL) % TRAIL) * 2;
      const x = c + (this.trail[j] - hx) * k;
      const y = c + (this.trail[j + 1] - hz) * k;
      g.globalAlpha = 0.5 * (1 - i / TRAIL);
      g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    g.globalAlpha = 1;

    // pads ○H
    const pads = ctx.world?.pads;
    if (pads) for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p?.position) continue;
      this._blip(g, 'nav', c, R, (p.position.x - hx) * k, (p.position.z - hz) * k);
    }
    // hazards ▲
    const hzl = ctx.hazards?.list;
    if (hzl) for (let i = 0; i < hzl.length; i++) {
      const hz2 = hzl[i];
      if (!hz2?.position || hz2.alive === false || hz2.type === 'satellite') continue;
      if (hz2.type === 'rogue') this._rogue(g, hz2, c, R, k, hx, hz);
      else this._blip(g, hz2.type === 'waterspout' || hz2.type === 'tornado' ? 'spiral' : 'hazard', c, R, (hz2.position.x - hx) * k, (hz2.position.z - hz) * k, hz2);
    }
    // people
    const list = ctx.survivors?.list;
    if (list) for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s?.position || !isOpen(s)) continue;
      if (isSpotted(s)) this._blip(g, 'rescue', c, R, (s.position.x - hx) * k, (s.position.z - hz) * k, s);
    }
    // signals «?»
    for (let i = 0; i < m.signals.length; i++) {
      const sg = m.signals[i];
      const age = m.time - sg.t;
      if (age > sg.life || sg.kind === 'epirb' || sg.kind === 'whistle') continue;
      if (sg.s && (isSpotted(sg.s) || !isOpen(sg.s))) continue;
      g.globalAlpha = 1 - smooth(sg.life - 3, sg.life, age);
      this._blip(g, 'signal', c, R, (sg.x - hx) * k, (sg.z - hz) * k);
    }
    g.globalAlpha = 1;
    // strikes «×» 1.5 s
    g.strokeStyle = pal.warn;
    g.lineWidth = 1.6;
    for (let i = 0; i < m.strikes.length; i++) {
      const st = m.strikes[i];
      const age = m.time - st.t;
      if (age > 1.5 || st.cloudOnly) continue;
      const x = c + (st.x - hx) * k;
      const y = c + (st.z - hz) * k;
      g.globalAlpha = 1 - age / 1.5;
      g.beginPath();
      g.moveTo(x - 4, y - 4);
      g.lineTo(x + 4, y + 4);
      g.moveTo(x + 4, y - 4);
      g.lineTo(x - 4, y + 4);
      g.stroke();
    }
    g.globalAlpha = 1;
    // EPIRB bearings (blink --info)
    for (let i = 0; i < m.epirb.length; i++) {
      const e = m.epirb[i];
      const age = m.time - e.t;
      if (age > 6) continue;
      if (e.s && (isSpotted(e.s) || !isOpen(e.s))) continue;
      const half = Math.max(0.04, (e.error * Math.PI) / 180);
      const on = Math.sin(m.time * 8) > -0.2;
      if (!on) continue;
      g.globalAlpha = 0.85 * (1 - smooth(4, 6, age));
      g.fillStyle = pal.info;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, R, e.bearing - Math.PI / 2 - half, e.bearing - Math.PI / 2 + half);
      g.closePath();
      g.globalAlpha *= 0.25;
      g.fill();
      g.globalAlpha = 0.9 * (1 - smooth(4, 6, age));
      g.strokeStyle = pal.info;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.sin(e.bearing) * R, c - Math.cos(e.bearing) * R);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();

    // heli triangle
    const hd = m.heading;
    g.fillStyle = pal.fg;
    g.beginPath();
    g.moveTo(c + Math.sin(hd) * 7, c - Math.cos(hd) * 7);
    g.lineTo(c + Math.sin(hd + 2.45) * 5, c - Math.cos(hd + 2.45) * 5);
    g.lineTo(c + Math.sin(hd - 2.45) * 5, c - Math.cos(hd - 2.45) * 5);
    g.closePath();
    g.fill();

    // wind flag on the rim (upwind side), speed
    if (ws?.windDir) {
      const b = Math.atan2(-ws.windDir.x, ws.windDir.y); // screen angle of the upwind side
      const x0 = c + Math.sin(b) * (R + 1);
      const y0 = c - Math.cos(b) * (R + 1);
      const x1 = c + Math.sin(b) * (R - 13);
      const y1 = c - Math.cos(b) * (R - 13);
      g.strokeStyle = pal.wind;
      g.fillStyle = pal.wind;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x1 - Math.cos(a - 0.5) * 5, y1 - Math.sin(a - 0.5) * 5);
      g.lineTo(x1 - Math.cos(a + 0.5) * 5, y1 - Math.sin(a + 0.5) * 5);
      g.closePath();
      g.fill();
    }
    // range label
    g.font = `600 10px ${FONT_MONO}`;
    g.fillStyle = pal.dim;
    g.fillText(RANGE_TXT[this.rangeI], c, c + R - 10);
  }

  _emp(g, c, R) {
    const pal = this.pal;
    g.save();
    g.beginPath();
    g.arc(c, c, R - 1, 0, TAU);
    g.clip();
    let s = (this.m.time * 1000) | 0;
    g.fillStyle = pal.fg;
    for (let i = 0; i < 260; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const x = c - R + ((s >>> 8) % 1000) / 1000 * 2 * R;
      s = (s * 1103515245 + 12345) >>> 0;
      const y = c - R + ((s >>> 8) % 1000) / 1000 * 2 * R;
      g.globalAlpha = ((s >>> 4) % 100) / 300;
      g.fillRect(x, y, 1.5, 1.5);
    }
    g.restore();
    g.globalAlpha = 0.6 + 0.4 * Math.sin(this.m.time * 10);
    g.font = `600 11px ${FONT_HEAD}`;
    g.fillStyle = pal.warn;
    g.fillText('РЛС', c, c - 8);
    g.font = `600 9px ${FONT_MONO}`;
    g.fillText('ПЕРЕЗАГРУЗКА', c, c + 8);
    g.globalAlpha = 1;
  }

  _rogue(g, hz, c, R, k, hx, hzz) {
    const cr = hz.crest;
    const dir = hz.dir || cr?.dir;
    const org = hz.origin || cr?.origin;
    if (!dir || !org) return;
    const dx = dir.x;
    const dz = dir.y ?? dir.z ?? 0;
    const L = hz.length || cr?.length || 500;
    const bow = cr?.bow ?? 0.0015;
    g.strokeStyle = this.pal.hazard;
    g.lineWidth = 1.6;
    g.beginPath();
    let first = true;
    for (let i = 0; i <= 16; i++) {
      const v = (i / 16 - 0.5) * L * 0.84;
      const u = -bow * v * v;
      const x = c + (org.x + dx * u - dz * v - hx) * k;
      const y = c + (org.y + dz * u + dx * v - hzz) * k;
      if (first) g.moveTo(x, y);
      else g.lineTo(x, y);
      first = false;
    }
    g.stroke();
    // running chevrons
    const ph = (this.m.time * 0.8) % 1;
    for (let i = 0; i < 4; i++) {
      const v = ((i + ph) / 4 - 0.5) * L * 0.7;
      const u = -bow * v * v;
      const x = c + (org.x + dx * u - dz * v - hx) * k;
      const y = c + (org.y + dz * u + dx * v - hzz) * k;
      const s = 3.5;
      g.beginPath();
      g.moveTo(x - dx * s + dz * s, y - dz * s - dx * s);
      g.lineTo(x + dx * s, y + dz * s);
      g.lineTo(x - dx * s - dz * s, y - dz * s + dx * s);
      g.stroke();
    }
  }

  _blip(g, kind, c, R, dx, dy, obj) {
    const pal = this.pal;
    let d = Math.hypot(dx, dy);
    let a = g.globalAlpha;
    if (d > R - 6) {
      const s = (R - 6) / d;
      dx *= s;
      dy *= s;
      d = R - 6;
      g.globalAlpha = a * 0.5;
    }
    const x = c + dx;
    const y = c + dy;
    const r = 4;
    if (kind === 'rescue') {
      const crit = obj && (obj.health < 0.3 || obj.priority);
      g.fillStyle = crit && Math.sin(this.m.time * 7) > 0 ? this.pal.danger : pal.rescue;
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
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, r + 0.5, 0, TAU);
      g.stroke();
      g.font = `700 7px ${FONT_HEAD}`;
      g.fillText('H', x, y + 0.5);
    } else if (kind === 'hazard') {
      g.fillStyle = pal.hazard;
      g.beginPath();
      g.moveTo(x, y - r);
      g.lineTo(x + r, y + r * 0.8);
      g.lineTo(x - r, y + r * 0.8);
      g.closePath();
      g.fill();
      if (obj?.radius) {
        g.strokeStyle = pal.hazard;
        g.setLineDash(DASH);
        g.beginPath();
        g.arc(x, y, Math.max(r + 2, obj.radius * (R / RANGES[this.rangeI]) * 0.5), 0, TAU);
        g.stroke();
        g.setLineDash(NO_DASH);
      }
    } else if (kind === 'spiral') {
      g.strokeStyle = pal.hazard;
      g.lineWidth = 1.4;
      g.beginPath();
      const rot = this.m.time * 3;
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        const aa = rot + t * TAU * 1.6;
        const rr = 1 + t * 6;
        if (i === 0) g.moveTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
        else g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
      }
      g.stroke();
      g.fillStyle = pal.hazard;
      g.beginPath();
      g.moveTo(x, y - 12);
      g.lineTo(x + 3.5, y - 7);
      g.lineTo(x - 3.5, y - 7);
      g.closePath();
      g.fill();
    } else if (kind === 'signal') {
      g.strokeStyle = pal.rescue;
      g.lineWidth = 1;
      g.setLineDash(DASH);
      g.beginPath();
      g.arc(x, y, 5, 0, TAU);
      g.stroke();
      g.setLineDash(NO_DASH);
      g.fillStyle = pal.rescue;
      g.font = `700 8px ${FONT_HEAD}`;
      g.fillText('?', x, y + 0.5);
    }
    g.globalAlpha = a;
  }
}
