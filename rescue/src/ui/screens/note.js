// БУТЫЛКА С ЗАПИСКОЙ (CONTRACT «Depth pass»: survivors emit `survivor:bottle {title, text}`, op 9★ easter
// egg). The navigator-table register: a sheet of water-stained notepaper laid over the paused game, folded
// once, the text in an old hand; Enter / Space / A or Esc / B fold it away. The HUD pauses the game for the
// reading (hud.showNote) and resumes it when the note is dismissed.
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Screen } from './screen.js';

export class NoteScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-note', { overlay: true, role: 'dialog' });
    this.sheet = el('div.note-sheet', { parent: this.node });
    el('div.note-kicker', { parent: this.sheet, text: 'НАХОДКА · БУТЫЛКА С ЗАПИСКОЙ' });
    this.title = el('div.note-title', { parent: this.sheet });
    this.body = el('div.note-body', { parent: this.sheet });
    const foot = el('div.note-foot', { parent: this.sheet });
    el('span.note-keys', { parent: foot, html: '<kbd class="cap wide">Enter</kbd> / <kbd class="cap wide">Esc</kbd> убрать' });
    this.bOk = el('div.btn', { text: 'СЛОЖИТЬ ЗАПИСКУ', parent: foot, attrs: { role: 'button' } });
    this.menu = new Menu(hud, { name: 'note', onBack: () => this._close() });
    this.menu.setItems([{ el: this.bOk, onActivate: () => this._close() }]);
    this.onClose = null;
  }

  // opts: { title, text, onClose }
  show(opts = {}) {
    super.show(opts);
    this.title.textContent = opts.title || 'Записка';
    const paras = String(opts.text || '')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    this.body.replaceChildren(...paras.map((p) => el('p', { text: p })));
    this.onClose = opts.onClose || null;
    this.menu.focus(0, true);
  }

  _close() {
    const fn = this.onClose;
    this.onClose = null;
    this.hud.back();
    fn?.();
  }
}
