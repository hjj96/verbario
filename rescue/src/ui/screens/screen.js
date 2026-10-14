// Base class for menu screens: a full-screen DOM layer inside .hud-screens with show/hide fades,
// an optional Menu (common/nav.js) that receives keyboard/gamepad input while the screen is on top,
// and hooks the Hud calls (update, resize, onFonts, onSettings).
import { el } from '../common/dom.js';

export class Screen {
  constructor(hud, cls, opts = {}) {
    this.hud = hud;
    this.ctx = hud.ctx;
    this.node = el(`div.screen.${cls}`, { parent: hud.screensRoot, attrs: { role: opts.role || 'dialog' } });
    this.node.setAttribute('aria-hidden', 'true');
    this.menu = null;
    this.overlay = !!opts.overlay; // drawn above the screen under it (confirmations)
    this.visible = false;
    this.blockInput = false;
  }

  show() {
    this.visible = true;
    this.node.classList.add('on');
    this.node.setAttribute('aria-hidden', 'false');
    this.menu?.reset();
  }

  hide() {
    this.visible = false;
    this.node.classList.remove('on');
    this.node.setAttribute('aria-hidden', 'true');
  }

  update() {}
}
