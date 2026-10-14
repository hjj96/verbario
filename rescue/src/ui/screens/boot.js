// Boot gates (DESIGN §7.1): the first-launch photosensitivity warning and «НАЖМИТЕ ЛЮБУЮ КЛАВИШУ»
// (the gesture that lets the audio system unlock itself).
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Screen } from './screen.js';

export class FlashScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-flash', { role: 'alertdialog' });
    const box = el('div.flash-box', { parent: this.node });
    el('div.flash-sign', { text: '⚠', parent: box, attrs: { 'aria-hidden': 'true' } });
    el('div.flash-head', { text: 'ФОТОЧУВСТВИТЕЛЬНОСТЬ', parent: box });
    el('p.flash-text', {
      parent: box,
      text: 'Внимание: в игре есть яркие вспышки молний и мигающие огни. Если вы чувствительны к вспышкам, включите режим «Меньше вспышек».',
    });
    const row = el('div.flash-btns', { parent: box });
    this.bOn = el('div.btn.btn-primary', { text: 'ВКЛЮЧИТЬ «МЕНЬШЕ ВСПЫШЕК»', parent: row, attrs: { role: 'button' } });
    this.bGo = el('div.btn', { text: 'ПРОДОЛЖИТЬ', parent: row, attrs: { role: 'button' } });
    el('div.flash-note', { text: 'Изменить можно в любой момент: НАСТРОЙКИ → ДОСТУПНОСТЬ', parent: box });
    this.menu = new Menu(hud, { name: 'flash', layout: 'horizontal' });
    const done = (reduce) => {
      const s = this.ctx.settings;
      if (reduce) s?.set('reduceFlashes', true);
      s?.set('seenFlashWarning', true);
      this.hud.gateDone('flash');
    };
    this.menu.setItems([
      { el: this.bOn, onActivate: () => done(true) },
      { el: this.bGo, onActivate: () => done(false) },
    ]);
  }

  show(opts) {
    super.show(opts);
    // initial choice follows prefers-reduced-motion (settings already default to it)
    const prm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.menu.focus(prm || this.ctx.settings?.get('reduceFlashes') ? 0 : 1, true);
  }
}

export class PressScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-press');
    el('div.press-bar', { parent: this.node });
    el('div.press-title', { text: 'MAYDAY', parent: this.node });
    el('div.press-sub', { text: 'МОРСКАЯ СПАСАТЕЛЬНАЯ СЛУЖБА', parent: this.node });
    el('div.press-key', { text: 'НАЖМИТЕ ЛЮБУЮ КЛАВИШУ', parent: this.node });
    el('div.press-note', { text: 'наушники · звук включится после нажатия', parent: this.node });
    this.t = 0;
    this._armed = false;
    this._onAny = (e) => {
      // wall-clock debounce: the key that closed the previous gate must not also close this one
      if (!this.visible || performance.now() - this._shownAt < 350) return;
      if (e.type === 'keydown' && (e.repeat || e.ctrlKey || e.metaKey || e.altKey)) return;
      this._go();
    };
    window.addEventListener('keydown', this._onAny);
    window.addEventListener('pointerdown', this._onAny);
  }

  show(opts) {
    super.show(opts);
    this.t = 0;
    this._shownAt = performance.now();
    this._armed = true;
  }

  _go() {
    if (!this._armed) return;
    this._armed = false;
    this.hud.emit('ui:click', { menu: 'press' });
    this.hud.gateDone('press');
  }

  update(dt) {
    this.t += dt;
    // gamepad / any action (input.anyPressedThisFrame covers pads)
    if (this.visible && performance.now() - this._shownAt > 350 && this.ctx.input?.anyPressedThisFrame) this._go();
  }
}
