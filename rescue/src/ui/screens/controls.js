// УПРАВЛЕНИЕ (DESIGN §3.2, §7.6): the controls card — keyboard + mouse and gamepad columns with keycaps,
// built from core/input.js BINDINGS (keys by event.code, so ЙЦУКЕН works; Ctrl is never used) — and the
// key rebinding [NICE]: two keys per action, ↑↓ choose the action, ←→ the slot, Enter / click listens for
// the new key (Esc cancels, Delete clears); a key already used by another action swaps with it.
// «Сбросить» restores the defaults. Overrides live in settings `bindings`; core/input.js applies them live.
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { keycap } from '../common/icons.js';
import { keyLabel } from '../common/keys.js';
import { BINDINGS, REBINDABLE, bindableCode, currentKeys } from '../../core/input.js';
import { Screen } from './screen.js';

// gamepad column per rebindable action
const PAD = {
  up: 'левый стик', down: 'левый стик', left: 'левый стик', right: 'левый стик', climb: 'RT', descend: 'LT',
  altPreset1: 'D-pad ↑ / ↓', altPreset2: 'D-pad ↑ / ↓', altPreset3: 'D-pad ↑ / ↓', winch: 'A', boost: 'LB',
  searchlight: 'X · правый стик', flare: 'B', raftDrop: 'D-pad →', horn: 'Y', map: 'View', zoom: 'RB',
  thermal: 'R3', photo: 'L3',
};

export class ControlsScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-controls');
    const sheet = el('div.ctl-sheet.paper', { parent: this.node });
    const head = el('div.set-head', { parent: sheet });
    el('h2.set-title', { text: 'УПРАВЛЕНИЕ', parent: head });
    el('div.set-form', { text: 'ИНСТРУКЦИЯ ЭКИПАЖУ «ЧАЙКИ-07»', parent: head });
    const tbl = el('div.ctl-table', { parent: sheet });
    el('div.ctl-row.ctl-th', { parent: tbl, html: '<span>действие</span><span>клавиши · две на действие</span><span>геймпад</span>' });
    this.slot = 0;
    this.rows = [];
    const items = [];
    for (const r of REBINDABLE) {
      const node = el('div.ctl-row.ctl-bind', { parent: tbl, attrs: { role: 'group' } });
      el('span', { parent: node, text: r.label });
      const keys = el('span.ctl-keys', { parent: node });
      const slots = [0, 1].map((i) => {
        const s = el('span.ctl-slot', { parent: keys, attrs: { role: 'button' } });
        s.addEventListener('click', () => this._setSlot(i)); // the row's own click then starts listening
        return s;
      });
      el('span.pad', { parent: node, text: PAD[r.id] || '—' });
      const row = { r, node, slots };
      this.rows.push(row);
      items.push({
        el: node,
        row,
        onLeft: () => this._setSlot(0),
        onRight: () => this._setSlot(1),
        onActivate: () => this._listen(row),
      });
    }
    // fixed rows (not rebindable)
    for (const [label, kb, pad] of [
      ['Цель высоты ±5 м', 'колесо мыши', 'D-pad ↑ / ↓'],
      ['Пауза', `${keycap('Esc')}${keycap('P')}`, 'Start'],
    ])
      el('div.ctl-row.ctl-fixed', { parent: tbl, html: `<span>${label}</span><span>${kb}</span><span class="pad">${pad}</span>` });
    this.status = el('div.ctl-status', { parent: sheet });
    el('div.ctl-notes', {
      parent: sheet,
      html:
        '<p>Нос смотрит на курсор, пока двигается мышь или горит прожектор, иначе — по курсу. Выпущенный трос включает точный режим: машина слушается вдвое мягче.</p>' +
        '<p>Клавиши привязаны к физическим кнопкам — работает и русская раскладка. Ctrl, Alt, Esc, Enter, Backspace и F1–F12 не назначаются.</p>',
    });
    const foot = el('div.set-foot', { parent: sheet });
    this.bReset = el('div.btn.btn-ghost', { text: 'СБРОСИТЬ', parent: foot, attrs: { role: 'button' } });
    this.bDone = el('div.btn.btn-primary', { text: 'ПОНЯТНО', parent: foot, attrs: { role: 'button' } });
    items.push({ el: this.bReset, onActivate: () => this._reset() });
    items.push({ el: this.bDone, onActivate: () => this.hud.back() });
    this.menu = new Menu(hud, { name: 'controls', onBack: () => this.hud.back(), onFocus: () => this._paintFocus() });
    this.menu.setItems(items);

    this.capturing = null; // { row, slot }
    this._capKey = (e) => this._onCapKey(e);
    this._capMouse = (e) => this._onCapMouse(e);
    this._eat = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    this._help();
  }

  show(opts) {
    super.show(opts);
    if (!opts?.returning) this.menu.focus(0, true);
    this._paint();
    this._help();
  }

  hide() {
    this._stopListening();
    super.hide();
  }

  onSettings(k) {
    if (k === 'bindings' && this.visible) this._paint();
  }

  // ----------------------------------------------------------------------------------------------
  _slots(id) {
    const k = currentKeys(id) || [];
    return [k[0] || null, k[1] || null];
  }

  _paint() {
    for (const row of this.rows) {
      const k = this._slots(row.r.id);
      row.slots.forEach((s, i) => {
        const cap = this.capturing && this.capturing.row === row && this.capturing.slot === i;
        s.innerHTML = cap ? '<i>нажмите клавишу…</i>' : k[i] ? keycap(keyLabel(k[i])) : '<em>—</em>';
        s.classList.toggle('listening', !!cap);
      });
    }
    this._paintFocus();
  }

  _paintFocus() {
    const cur = this.menu?.current?.row;
    for (const row of this.rows) row.slots.forEach((s, i) => s.classList.toggle('sel', row === cur && i === this.slot));
  }

  _setSlot(i) {
    if (this.capturing) return;
    this.slot = i;
    this._paintFocus();
  }

  // kind: '' (key help), 'listen' (waiting for a key), 'msg' (a refusal / result line)
  _help(text, kind = 'msg') {
    this.status.textContent = text || '↑↓ действие · ←→ клавиша · Enter — назначить · клик по клавише — тоже';
    this.status.classList.toggle('msg', !!text && kind === 'msg');
    this.status.classList.toggle('listen', !!text && kind === 'listen');
  }

  _listen(row) {
    if (this.capturing) return;
    this.capturing = { row, slot: this.slot };
    this.blockInput = true;
    window.addEventListener('keydown', this._capKey, true);
    window.addEventListener('mousedown', this._capMouse, true);
    this._paint();
    row.node.scrollIntoView?.({ block: 'nearest' });
    this._help(`«${row.r.label}»: нажмите клавишу · Esc — отмена · Delete — очистить · ЛКМ / ПКМ — щелчком по полю`, 'listen');
  }

  _stopListening() {
    if (!this.capturing) return;
    this.capturing = null;
    window.removeEventListener('keydown', this._capKey, true);
    window.removeEventListener('mousedown', this._capMouse, true);
    // the HUD's own input waits a frame, so the captured key never also acts on the menu
    requestAnimationFrame(() => (this.blockInput = false));
  }

  _onCapKey(e) {
    // nothing else (game input, HUD menus, the pause poll) sees the key being captured
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this._stopListening();
      this._paint();
      this._help('Отменено');
      return;
    }
    if (e.code === 'Delete') return this._assign(null);
    if (e.ctrlKey || e.metaKey || e.altKey || !bindableCode(e.code)) {
      this._help(/^(Control|Meta|Alt|OS)/.test(e.code) || e.ctrlKey ? 'Ctrl, Alt и Win не используются — нажмите другую клавишу' : `${keyLabel(e.code)} занята меню — нажмите другую клавишу`);
      return;
    }
    if (BINDINGS.buttons.pause.includes(e.code)) {
      this._help(`${keyLabel(e.code)} — пауза, нажмите другую клавишу`);
      return;
    }
    this._assign(e.code);
  }

  // A mouse button binds only when pressed on the listening slot itself; a press anywhere else cancels
  // (and goes on as an ordinary click — e.g. onto another slot, which then listens).
  _onCapMouse(e) {
    const cap = this.capturing;
    if (!cap) return;
    if (!cap.row.slots[cap.slot].contains(e.target) || (e.button !== 0 && e.button !== 2)) {
      this._stopListening();
      this._paint();
      this._help();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    // swallow the click / context menu that follows this press
    window.addEventListener('click', this._eat, { capture: true, once: true });
    if (e.button === 2) window.addEventListener('contextmenu', this._eat, { capture: true, once: true });
    this._assign(`Mouse${e.button}`);
  }

  // Put `code` into the listening slot; a key held by another action swaps with this slot's old key.
  _assign(code) {
    const cap = this.capturing;
    if (!cap) return;
    const { row, slot } = cap;
    const s = this.ctx.settings;
    const ov = { ...(s?.get('bindings') || {}) };
    const mine = this._slots(row.r.id);
    const old = mine[slot];
    let msg = '';
    if (code === null) {
      if (!old) {
        this._help('Слот уже пуст — нажмите клавишу или Esc');
        return;
      }
      if (!mine[1 - slot]) {
        this._help('Нужна хотя бы одна клавиша — нажмите другую или Esc');
        return;
      }
      mine[slot] = null;
      msg = `${keyLabel(old)} снята с «${row.r.label}»`;
    } else if (mine[1 - slot] === code) {
      mine[1 - slot] = old;
      mine[slot] = code;
    } else if (old !== code) {
      for (const other of REBINDABLE) {
        if (other.id === row.r.id) continue;
        const keys = (currentKeys(other.id) || []).slice();
        const j = keys.indexOf(code);
        if (j < 0) continue;
        if (old) keys[j] = old;
        else keys.splice(j, 1);
        ov[other.id] = keys.slice(0, 2);
        msg = old ? `Обмен: «${other.label}» теперь на ${keyLabel(old)}` : `${keyLabel(code)} снята с «${other.label}»`;
      }
      mine[slot] = code;
    }
    ov[row.r.id] = mine.filter(Boolean);
    this._stopListening();
    s?.set('bindings', ov);
    this.hud.emit('ui:click', { menu: 'controls' });
    this._paint();
    this._help(msg || `«${row.r.label}»: ${mine.filter(Boolean).map(keyLabel).join(' / ')}`);
  }

  _reset() {
    this.ctx.settings?.set('bindings', {});
    this._paint();
    this._help('Клавиши по умолчанию');
  }
}
