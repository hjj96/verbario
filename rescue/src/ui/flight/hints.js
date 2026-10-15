// Onboarding glyph hints (DESIGN §3.16, §7.3.12): one at a time from `mission:hint {key, text, label,
// keys, anchor, pulse, show}`. Bottom centre in Inter 15 with keycaps; anchor 'heli' follows the
// helicopter under its ring (the «W A S D» glyph is laid out AROUND the ring instead), 'altimeter' sits
// next to the РВ scale. Hidden with {show: false}.
import { el, StyleSlot, setClass } from '../common/dom.js';
import { withKeycaps, keycap } from '../common/icons.js';

export class Hints {
  constructor(flight, parent) {
    this.flight = flight;
    this.ctx = flight.hud.ctx;
    this.node = el('div.hud-hint', { parent, attrs: { 'aria-live': 'polite' } });
    this.tr = new StyleSlot(this.node, 'transform');
    this.wasd = el('div.hud-wasd', { parent });
    this.wasdTr = new StyleSlot(this.wasd, 'transform');
    this._setWasd(['W', 'A', 'S', 'D']);
    this.active = null;
  }

  // The four caps around the ring: [up, left, down, right] — the player's current bindings (mission sends
  // them resolved in mission:hint.keys), W A S D by default.
  _setWasd(caps) {
    const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const key = caps.join('\u0001');
    if (key === this._wasdKey) return;
    this._wasdKey = key;
    const [w, a, s, d] = caps.map(e);
    this.wasd.innerHTML = `<span class="k-w">${keycap(w)}</span><span class="k-a">${keycap(a)}</span><span class="k-s">${keycap(s)}</span><span class="k-d">${keycap(d)}</span>`;
  }

  onHint(p) {
    if (!p) return;
    if (p.show === false || p.text == null) {
      if (!p.key || !this.active || this.active.key === p.key) this.hide();
      return;
    }
    this.active = { key: p.key, anchor: p.anchor || 'bottom', pulse: !!p.pulse };
    const isWasd = p.key === 'move' && (this.ctx.input?.lastDevice || 'keyboard') === 'keyboard';
    if (isWasd) this._setWasd(p.keys?.length === 4 ? p.keys : ['W', 'A', 'S', 'D']);
    this.node.innerHTML = withKeycaps(p.text);
    setClass(this.node, 'pulse', !!p.pulse);
    setClass(this.node, 'anchor-heli', this.active.anchor === 'heli' && !isWasd);
    setClass(this.node, 'anchor-alt', this.active.anchor === 'altimeter');
    setClass(this.node, 'on', !isWasd);
    setClass(this.wasd, 'on', isWasd);
    this.node.classList.remove('pop');
    void this.node.offsetWidth;
    this.node.classList.add('pop');
  }

  hide() {
    this.active = null;
    setClass(this.node, 'on', false);
    setClass(this.wasd, 'on', false);
  }

  // per frame: follow the anchor
  update() {
    const a = this.active;
    if (!a) return;
    const m = this.flight.model;
    const L = this.flight.L;
    if (this.wasd.classList.contains('on')) {
      this.wasdTr.set(`translate(${Math.round(m.sx)}px, ${Math.round(m.sy)}px)`);
      return;
    }
    if (a.anchor === 'heli') this.tr.set(`translate(${Math.round(m.sx)}px, ${Math.round(m.sy + 84 * L.hs + 34 * L.hs)}px) translateX(-50%)`);
    else if (a.anchor === 'altimeter') this.tr.set(`translate(${Math.round(L.alt.x + L.alt.w + 52 * L.hs)}px, ${Math.round(L.alt.y + L.alt.h * 0.72)}px)`);
    else this.tr.set('');
  }
}
