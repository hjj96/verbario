// Confirmation dialog (pause «НАЧАТЬ ЗАНОВО» / «В ГЛАВНОЕ МЕНЮ», settings «Сбросить прогресс»).
// An overlay screen: drawn above the screen that opened it; Esc / B = «Нет».
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Screen } from './screen.js';

export class ConfirmScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-confirm', { overlay: true, role: 'alertdialog' });
    this.box = el('div.confirm-box.paper', { parent: this.node });
    this.head = el('div.confirm-head', { parent: this.box });
    this.text = el('p.confirm-text', { parent: this.box });
    const row = el('div.confirm-btns', { parent: this.box });
    this.bYes = el('div.btn.btn-danger', { text: 'ДА', parent: row, attrs: { role: 'button' } });
    this.bNo = el('div.btn', { text: 'НЕТ', parent: row, attrs: { role: 'button' } });
    this.menu = new Menu(hud, { name: 'confirm', layout: 'horizontal', onBack: () => this._answer(false) });
    this.menu.setItems([
      { el: this.bYes, onActivate: () => this._answer(true) },
      { el: this.bNo, onActivate: () => this._answer(false) },
    ]);
    this.onYes = null;
  }

  // opts: { title, text, yes, no, onYes }
  show(opts = {}) {
    super.show(opts);
    this.head.textContent = opts.title || 'ПОДТВЕРДИТЕ';
    this.text.textContent = opts.text || '';
    this.bYes.textContent = opts.yes || 'ДА';
    this.bNo.textContent = opts.no || 'НЕТ';
    this.onYes = opts.onYes || null;
    this.menu.focus(1, true); // the safe answer is focused
  }

  _answer(yes) {
    const fn = this.onYes;
    this.onYes = null;
    this.hud.back();
    if (yes && fn) fn();
  }
}
