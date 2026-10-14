// Screen transitions «радиопомеха» (DESIGN §7.1): 250 ms of radio static — a low-res noise canvas at
// 18 % opacity, a bright tearing band and the squelch (the HUD emits `ui:static`; audio plays it).
// With «Меньше движения» it degrades to a plain 200 ms crossfade (the caller fades the screens).
import { el } from './dom.js';

const NW = 160;
const NH = 90;
const DURATION = 0.25;

export class StaticTransition {
  constructor(root) {
    this.node = el('div.hud-static', { attrs: { 'aria-hidden': 'true' }, parent: root });
    this.canvas = el('canvas', { parent: this.node });
    this.canvas.width = NW;
    this.canvas.height = NH;
    this.band = el('div.hud-static-band', { parent: this.node });
    this.g = this.canvas.getContext('2d');
    this.img = this.g.createImageData(NW, NH);
    this.t = -1;
    this.mid = null;
    this._seed = 1;
  }

  // Run the static; `onMid` is called at the peak (swap screens there).
  run(onMid) {
    if (this.t >= 0 && this.mid) {
      const m = this.mid;
      this.mid = null;
      m(); // a pending swap happens immediately
    }
    this.t = 0;
    this._t0 = performance.now();
    this.mid = onMid || null;
    this.node.classList.add('on');
    this._paint(1);
  }

  get active() {
    return this.t >= 0;
  }

  // Wall-clock driven: a UI transition must last 250 ms even when the game runs at 5 fps.
  update() {
    if (this.t < 0) return;
    this.t = (performance.now() - this._t0) / 1000;
    const k = this.t / DURATION;
    if (this.mid && k >= 0.45) {
      const m = this.mid;
      this.mid = null;
      m();
    }
    if (k >= 1) {
      this.t = -1;
      this.node.classList.remove('on');
      this.node.style.opacity = '';
      return;
    }
    // envelope: fast attack, slower release
    const a = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55;
    this._paint(a);
  }

  _paint(a) {
    const d = this.img.data;
    let s = (this._seed = (this._seed * 1664525 + 1013904223) >>> 0);
    for (let i = 0; i < d.length; i += 4) {
      s = (s * 1103515245 + 12345) >>> 0;
      const r = ((s >>> 24) & 255) / 255;
      const v = Math.round(r * r * 255); // darker-biased grain: less milky over night scenes
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    this.g.putImageData(this.img, 0, 0);
    this.node.style.opacity = String(Math.max(0, Math.min(1, a)));
    const y = ((this._seed >>> 8) % 1000) / 10;
    this.band.style.transform = `translateY(${y}vh) scaleY(${0.6 + ((this._seed >>> 4) % 10) / 6})`;
  }
}
