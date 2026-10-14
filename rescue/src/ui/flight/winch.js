// Winch panel (DESIGN §7.4): 380×156, bottom centre. Appears (16 px rise + fade over 180 ms) when the
// cable is out OR the heli is at 8–30 m, slower than 4 m/s and a spotted person is within 25 m.
// DOM holds the texts (cable length, УСТОЙЧИВОСТЬ 10 segments + state word, ЗАХВАТ %, status line);
// the cable gauge and the sight are drawn by the overlay canvas inside the same rectangle.
import { el, TextSlot, setClass, StyleSlot } from '../common/dom.js';
import { NBSP, num1, clamp01 } from '../common/fmt.js';
import { isOpen, isSpotted } from './model.js';

export class WinchPanel {
  constructor(flight, parent) {
    this.flight = flight;
    this.ctx = flight.hud.ctx;
    this.node = el('div.hud-winch', { parent, attrs: { 'aria-hidden': 'true' } });
    this.op = new StyleSlot(this.node, 'opacity');
    this.tr = new StyleSlot(this.node, 'transform');
    el('div.wp-title', { text: 'ЛЕБЁДКА', parent: this.node });
    this.cable = new TextSlot(el('div.wp-cable', { parent: this.node }));
    const right = el('div.wp-right', { parent: this.node });
    el('div.wp-lab', { text: 'УСТОЙЧИВОСТЬ', parent: right });
    const segs = el('div.wp-segs', { parent: right });
    this.segs = [];
    for (let i = 0; i < 10; i++) this.segs.push(el('i', { parent: segs }));
    this.steadyWordEl = el('div.wp-word', { parent: right });
    this.steadyWord = new TextSlot(this.steadyWordEl);
    this.capEl = el('div.wp-capture', { parent: right });
    this.cap = new TextSlot(this.capEl);
    this.statusEl = el('div.wp-status', { parent: right });
    this.status = new TextSlot(this.statusEl);
    this.visible = 0; // 0..1 animated
    this.want = false;
    this.boardedT = -1;
    this._steadyN = -1;
  }

  onPickup() {
    this.boardedT = 2.2;
  }

  // per frame (animation) — returns true when visible
  update(dt) {
    const ctx = this.ctx;
    const h = ctx.heli;
    const w = h?.winch;
    const m = this.flight.model;
    let want = false;
    if (w && h.alive !== false) {
      if (w.state && w.state !== 'stowed') want = true;
      else if (m.alt >= 8 && m.alt <= 30 && m.speed < 4 && !h.landed) {
        const list = ctx.survivors?.list;
        if (list) for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (!s?.position || !isOpen(s) || !isSpotted(s)) continue;
          if (Math.hypot(s.position.x - m.hx, s.position.z - m.hz) < 25) {
            want = true;
            break;
          }
        }
      }
    }
    if (this.boardedT > 0) {
      this.boardedT -= dt;
      want = true;
    }
    this.want = want;
    const target = want ? 1 : 0;
    const step = dt / 0.18;
    this.visible += Math.max(-step, Math.min(step, target - this.visible));
    const hs = this.flight.L.hs;
    this.op.set(this.visible.toFixed(3));
    this.tr.set(`translateY(${((1 - this.visible) * 16 * hs).toFixed(1)}px)`);
    const on = this.visible > 0.01;
    setClass(this.node, 'on', on);
    setClass(this.flight.node, 'winch-on', on);
    return on;
  }

  // 12 Hz texts
  updateText() {
    if (this.visible <= 0.01) return;
    const h = this.ctx.heli;
    const w = h?.winch || {};
    this.cable.set(`ТРОС ${num1(w.length || 0)}${NBSP}М`);
    const S = clamp01(w.steadiness ?? 1);
    const n = Math.round(S * 10);
    if (n !== this._steadyN) {
      this._steadyN = n;
      for (let i = 0; i < 10; i++) setClass(this.segs[i], 'on', i < n);
    }
    const word = S < 0.35 ? 'РАСКАЧКА' : S < 0.7 ? 'ДЕРЖИ' : 'СТАБИЛЬНО';
    this.steadyWord.set(word);
    setClass(this.steadyWordEl, 'warn', S < 0.35);
    setClass(this.steadyWordEl, 'ok', S >= 0.7);
    setClass(this.node, 'swing', S < 0.35);
    setClass(this.node, 'steady', S >= 0.7);
    const cap = clamp01(w.capture || 0);
    this.cap.set(cap > 0 && cap < 1 ? `ЗАХВАТ ${Math.round(cap * 100)}${NBSP}%` : w.load ? 'В КОРЗИНЕ' : w.inRange ? 'В ЗОНЕ ЗАХВАТА' : '');
    setClass(this.capEl, 'ok', cap > 0 || !!w.load || !!w.inRange);

    // status line: ОПУСКАНИЕ ▼ 4,0 М/С → КОРЗИНА В ВОДЕ → ЗАХВАТ → ПОДЪЁМ ▲ → ЧЕЛОВЕК НА БОРТУ
    let st;
    let cls = '';
    const sp = Math.abs(w.speed || 0);
    if (this.boardedT > 0 && (!w.state || w.state === 'stowed' || !w.load)) {
      st = 'ЧЕЛОВЕК НА БОРТУ';
      cls = 'ok';
    } else if ((w.jammed || 0) > 0) {
      st = `ТРОС ЗАХЛЕСТНУЛО · ${Math.ceil(w.jammed)}${NBSP}С`;
      cls = 'warn';
    } else if ((w.tension || 0) > 0.05) {
      st = 'НАТЯЖЕНИЕ ТРОСА';
      cls = 'warn';
    } else if (w.state === 'lowering') st = `ОПУСКАНИЕ ▼ ${num1(sp)}${NBSP}М/С`;
    else if (w.state === 'raising') {
      st = w.load ? `ПОДЪЁМ ▲ ${num1(sp)}${NBSP}М/С` : `ВЫБОРКА ▲ ${num1(sp)}${NBSP}М/С`;
      if (w.load) cls = 'ok';
    } else if (w.state === 'down') {
      if (cap > 0) {
        st = 'ЗАХВАТ';
        cls = 'ok';
      } else if ((w.height ?? 9) < 1.6) st = 'КОРЗИНА В ВОДЕ';
      else st = 'КОРЗИНА ВНИЗУ';
    } else if (w.denied === 'high') {
      st = 'ВЫСОКО · НИЖЕ 30 М';
      cls = 'warn';
    } else if (w.denied === 'fast') {
      st = 'БЫСТРО · ЗАВИСНИТЕ';
      cls = 'warn';
    } else if (w.denied === 'full' || w.cabinFull) {
      st = 'САЛОН ЗАПОЛНЕН';
      cls = 'warn';
    } else {
      const dev = this.ctx.input?.lastDevice;
      st = dev === 'gamepad' ? 'ГОТОВ · ДЕРЖИТЕ [A]' : dev === 'touch' ? 'ГОТОВ · ДЕРЖИТЕ ▼' : 'ГОТОВ · ДЕРЖИТЕ ПРОБЕЛ';
    }
    this.status.set(st);
    setClass(this.statusEl, 'ok', cls === 'ok');
    setClass(this.statusEl, 'warn', cls === 'warn');
  }
}
