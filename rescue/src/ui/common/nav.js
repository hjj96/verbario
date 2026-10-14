// Menu navigation (DESIGN §7.6 «Навигация»): every menu is fully usable with arrows / WASD / D-pad
// (input nav* actions, repeat 180 ms then every 90 ms), Enter / Space / A to activate, Esc / B to go
// back, and the mouse (hover focuses, click activates). The focused item gets `.is-focus`; the HUD root
// carries `.kbd-nav` while the keyboard/gamepad drives focus so the 2 px orange outline only shows then.
// Emits ui:hover on focus change and ui:click on activation (the audio system plays the UI sounds).

const REPEAT_FIRST = 0.18;
const REPEAT_NEXT = 0.09;
const DIRS = ['navUp', 'navDown', 'navLeft', 'navRight'];

export class Menu {
  /**
   * @param hud   Hud instance (events, input, root)
   * @param opts  { columns: number | () => number, layout, wrap = true, onBack, onFocus(item, i), name }
   * Items flagged `disabled` stay focusable (a locked card explains itself) but call onDisabled
   * instead of onActivate; `noFocus` items are skipped.
   */
  constructor(hud, opts = {}) {
    this.hud = hud;
    this.items = [];
    this.index = 0;
    this.columns = opts.columns || 1;
    this.wrap = opts.wrap !== false;
    this.onBack = opts.onBack || null;
    this.onFocus = opts.onFocus || null;
    this.name = opts.name || '';
    this.layout = opts.layout || 'vertical'; // 'vertical' | 'horizontal' | 'grid' (columns > 1)
    this._held = { navUp: 0, navDown: 0, navLeft: 0, navRight: 0 };
  }

  // items: [{ el, onActivate?, onLeft?, onRight?, disabled?, onDisabled?, noFocus? }]
  setItems(items, keepIndex = false) {
    for (const it of this.items) if (it._off) it._off();
    this.items = items.filter(Boolean);
    for (let i = 0; i < this.items.length; i++) this._bind(this.items[i], i);
    if (!keepIndex) this.index = this._firstEnabled(0);
    else this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
    this._paint(false);
  }

  _bind(it, i) {
    const el = it.el;
    if (!el) return;
    const enter = () => {
      if (it.noFocus) return;
      this.hud.setKeyboardNav(false);
      if (this.index !== i) this.focus(i);
    };
    const click = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (it.disabled) {
        it.onDisabled?.();
        return;
      }
      this.focus(i, true);
      this.activate();
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('click', click);
    it._off = () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('click', click);
    };
  }

  _firstEnabled(from) {
    for (let k = 0; k < this.items.length; k++) {
      const i = (from + k) % this.items.length;
      if (!this.items[i].noFocus) return i;
    }
    return 0;
  }

  get current() {
    return this.items[this.index] || null;
  }

  focus(i, silent = false) {
    if (!this.items.length) return;
    i = Math.max(0, Math.min(this.items.length - 1, i));
    const changed = i !== this.index;
    this.index = i;
    this._paint(!silent && changed);
  }

  _paint(sound) {
    for (let k = 0; k < this.items.length; k++) {
      const el = this.items[k].el;
      if (el) el.classList.toggle('is-focus', k === this.index);
    }
    const it = this.current;
    if (it?.el && this.hud.keyboardNav) it.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (sound) this.hud.emit('ui:hover', { menu: this.name, index: this.index });
    this.onFocus?.(it, this.index);
  }

  activate() {
    const it = this.current;
    if (!it || it.disabled) {
      it?.onDisabled?.();
      return;
    }
    this.hud.emit('ui:click', { menu: this.name, index: this.index });
    it.onActivate?.(it);
  }

  _cols() {
    return typeof this.columns === 'function' ? Math.max(1, this.columns()) : this.columns;
  }

  _move(dir) {
    const n = this.items.length;
    if (!n) return;
    const it = this.current;
    if (dir === 'navLeft' && it?.onLeft) {
      it.onLeft(it);
      this.hud.emit('ui:hover', { menu: this.name, index: this.index, adjust: -1 });
      return;
    }
    if (dir === 'navRight' && it?.onRight) {
      it.onRight(it);
      this.hud.emit('ui:hover', { menu: this.name, index: this.index, adjust: 1 });
      return;
    }
    const cols = this._cols();
    let step = 0;
    if (this.layout === 'horizontal') {
      if (dir === 'navLeft') step = -1;
      else if (dir === 'navRight') step = 1;
      else return;
    } else if (cols <= 1) {
      if (dir === 'navUp') step = -1;
      else if (dir === 'navDown') step = 1;
      else return;
    } else step = dir === 'navUp' ? -cols : dir === 'navDown' ? cols : dir === 'navLeft' ? -1 : 1;
    let i = this.index;
    for (let guard = 0; guard < n; guard++) {
      let j = i + step;
      if (j < 0 || j >= n) {
        if (!this.wrap) return;
        if (cols > 1 && (step === cols || step === -cols)) {
          // wrap vertically within the same column
          const col = this.index % cols;
          j = step > 0 ? col : col + Math.floor((n - 1 - col) / cols) * cols;
        } else j = (j + n) % n;
      }
      i = j;
      if (!this.items[i].noFocus) break;
    }
    if (i !== this.index) this.focus(i);
  }

  // Called by the HUD each frame for the active menu. dt = real seconds.
  handle(dt) {
    const hud = this.hud;
    for (const d of DIRS) {
      const down = hud.rawDown(d);
      if (!down) {
        this._held[d] = 0;
        continue;
      }
      if (this._held[d] === 0) {
        this._held[d] = REPEAT_FIRST;
        hud.setKeyboardNav(true);
        this._move(d);
      } else {
        this._held[d] -= dt;
        if (this._held[d] <= 0) {
          this._held[d] += REPEAT_NEXT;
          this._move(d);
        }
      }
    }
    if (hud.rawPressed('confirm') || hud.rawPressed('winch')) {
      hud.setKeyboardNav(true);
      this.activate();
      return true;
    }
    if (hud.rawPressed('back') && this.onBack) {
      hud.emit('ui:back', { menu: this.name });
      this.onBack();
      return true;
    }
    return false;
  }

  reset() {
    for (const d of DIRS) this._held[d] = 0;
  }

  destroy() {
    for (const it of this.items) if (it._off) it._off();
    this.items = [];
  }
}
