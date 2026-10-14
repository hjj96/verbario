// Toasts (DESIGN §7.3.10): a 300 px column under the radar, at most 4. Slide in 220 ms (fade only with
// «Меньше движения»), hold 3.5 s + 40 ms per character beyond 40, a repeat within 5 s becomes «×2».
// Kinds colour the left rule: rescue / ok / nav / warn / danger / style / info.
import { el } from '../common/dom.js';

const MAX = 4;
const REPEAT_S = 5;

export class Toasts {
  constructor(hud, parent) {
    this.hud = hud;
    this.col = el('div.hud-toasts', { parent });
    this.items = []; // { node, key, t, hold, count, countEl, out }
  }

  /**
   * @param title   upper-case head («ЧЕЛОВЕК НА БОРТУ»)
   * @param detail  sentence-case tail («Мария, 8 лет · переохлаждение»)
   * @param opts    { kind, key, action: { label, fn } }
   */
  push(title, detail = '', opts = {}) {
    const key = opts.key || `${title}|${detail}`;
    const now = this.hud.time;
    const prev = this.items.find((it) => it.key === key && !it.out && now - it.t0 < REPEAT_S + it.hold);
    if (prev) {
      prev.count++;
      prev.countEl.textContent = `×${prev.count}`;
      prev.countEl.hidden = false;
      prev.t = 0;
      prev.node.classList.remove('bump');
      void prev.node.offsetWidth;
      prev.node.classList.add('bump');
      return prev;
    }
    const kind = opts.kind || 'info';
    const node = el(`div.toast.k-${kind}`);
    const head = el('div.toast-head', { parent: node });
    el('span.toast-title', { text: title, parent: head });
    const countEl = el('span.toast-count', { parent: head });
    countEl.hidden = true;
    if (detail) el('div.toast-detail', { text: detail, parent: node });
    if (opts.action) {
      const b = el('button.toast-btn', { text: opts.action.label, parent: node, attrs: { type: 'button', tabindex: '-1' } });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hud.emit('ui:click', { menu: 'toast' });
        opts.action.fn();
        this._remove(it);
      });
    }
    const chars = title.length + detail.length;
    const it = { node, key, t: 0, t0: now, hold: (opts.hold || 3.5) + Math.max(0, chars - 40) * 0.04, count: 1, countEl, out: false };
    this.col.appendChild(node);
    this.items.push(it);
    requestAnimationFrame(() => node.classList.add('in'));
    // ≤ 4: the oldest leaves early
    const live = this.items.filter((x) => !x.out);
    if (live.length > MAX) this._remove(live[0]);
    return it;
  }

  _remove(it) {
    if (it.out) return;
    it.out = true;
    it.node.classList.remove('in');
    it.node.classList.add('out');
    setTimeout(() => {
      it.node.remove();
      const i = this.items.indexOf(it);
      if (i >= 0) this.items.splice(i, 1);
    }, 240);
  }

  clear() {
    for (const it of this.items.slice()) this._remove(it);
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.out) continue;
      it.t += dt;
      if (it.t > it.hold) this._remove(it);
    }
  }
}
