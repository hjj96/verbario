// Typewriter text (DESIGN §7.2 briefing 28 ms/char, §7.5 radio 22 ms/char, §7.7 logbook lines).
// Writes into a text node only when the visible character count changes; `finish()` shows everything
// at once (click / Space). Emits `ui:type {ch, voice}` for each typed letter so audio can tick the
// teletype (every 2nd char) and babble the speaker's vowels; the HUD passes the emitter in.

export class Typewriter {
  /**
   * @param node   element whose textContent is typed
   * @param opts   { msPerChar = 28, emit(ch) | null, onDone() }
   */
  constructor(node, opts = {}) {
    this.node = node;
    this.ms = opts.msPerChar || 28;
    this.emit = opts.emit || null;
    this.onDone = opts.onDone || null;
    this.text = '';
    this.shown = 0;
    this.t = 0;
    this.done = true;
    this.cursor = opts.cursor !== false;
  }

  start(text, delay = 0) {
    this.text = String(text || '');
    this.shown = 0;
    this.t = -delay;
    this.done = this.text.length === 0;
    this.node.textContent = '';
    this.node.classList.toggle('is-typing', !this.done && this.cursor);
    if (this.done) this.onDone?.();
  }

  finish() {
    if (this.done) return;
    this.shown = this.text.length;
    this.node.textContent = this.text;
    this._end();
  }

  _end() {
    this.done = true;
    this.node.classList.remove('is-typing');
    this.onDone?.();
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.t < 0) return;
    const n = Math.min(this.text.length, Math.floor((this.t * 1000) / this.ms));
    if (n === this.shown) return;
    if (this.emit) for (let i = this.shown; i < n; i++) this.emit(this.text[i], i);
    this.shown = n;
    this.node.textContent = this.text.slice(0, n);
    if (n >= this.text.length) this._end();
  }
}
