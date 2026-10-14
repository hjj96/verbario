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
    this.wasd.innerHTML = `<span class="k-w">${keycap('W')}</span><span class="k-a">${keycap('A')}</span><span class="k-s">${keycap('S')}</span><span class="k-d">${keycap('D')}</span>`;
    this.active = null;
  }

  onHint(p) {
    if (!p) return;
    if (p.show === false || p.text == null) {
      if (!p.key || !this.active || this.active.key === p.key) this.hide();
      return;
    }
    this.active = { key: p.key, anchor: p.anchor || 'bottom', pulse: !!p.pulse };
    const isWasd = p.key === 'move' && (this.ctx.input?.lastDevice || 'keyboard') === 'keyboard';
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
