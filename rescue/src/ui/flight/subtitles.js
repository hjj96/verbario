// Radio subtitles (DESIGN §7.5): left above the bottom bar, width min(520px, 40vw), panel-strong with a
// 2 px left rule in the speaker's colour; header = caption (Oswald 11, 0.2em) + channel tag «КАН 16» /
// «СПУ» / «РАЦИЯ». Typed at 22 ms/char (click → whole line), held max(2.5 s, 0.06 s × chars) + 1 s,
// at most 2 lines (the older moves up at 75 %). On lightning 10–20 % of the characters turn into ▒ for
// 150 ms [SHOULD]. Keeps the last 30 lines for the pause log [NICE].
import { el } from '../common/dom.js';
import { Typewriter } from '../common/typewriter.js';

export const SPEAKER_COLOR = {
  dispatch: '#56B4E9',
  pilot: '#E8EEF2',
  winchman: '#FFC24B',
  rescuer: '#FFC24B',
  survivor: '#FF6A3D',
  ship: '#B8A6FF',
  coastguard: '#8FB8FF',
};
const DEFAULT_NAME = { dispatch: 'БЕРЕГ', pilot: 'ВТОРОЙ ПИЛОТ', winchman: 'БОРТОПЕРАТОР', rescuer: 'СПАСАТЕЛЬ', survivor: 'ПОСТРАДАВШИЙ', ship: 'АРКТУР', coastguard: 'СТОРОЖ-7' };
const CHANNEL = { ext: 'КАН 16', ics: 'СПУ', handheld: 'РАЦИЯ' };
const DEFAULT_CHANNEL = { dispatch: 'ext', pilot: 'ics', winchman: 'ics', rescuer: 'ics', survivor: 'handheld', ship: 'ext', coastguard: 'ext' };

export class Subtitles {
  constructor(hud, parent) {
    this.hud = hud;
    this.box = el('div.hud-subs', { parent });
    this.lines = []; // { node, tw, hold, t, done }
    this.log = []; // last 30 {name, channel, text, color, time}
    this._corruptT = 0;
  }

  line(p) {
    if (!p || !p.text) return;
    const speaker = p.speaker || 'dispatch';
    const color = SPEAKER_COLOR[speaker] || '#E8E4D8';
    const name = (p.name || DEFAULT_NAME[speaker] || speaker).toUpperCase();
    const ch = CHANNEL[p.channel || DEFAULT_CHANNEL[speaker]] || 'СПУ';
    const text = String(p.text);
    this.log.push({ name, channel: ch, text, color, time: this.hud.ctx.mission?.elapsed ?? 0 });
    if (this.log.length > 30) this.log.shift();
    if (this.hud.ctx.settings?.get('subtitles') === false) return;

    // at most 2 lines: the oldest leaves, the remaining one becomes «old»
    while (this.lines.length >= 2) this._drop(this.lines[0]);
    for (const l of this.lines) l.node.classList.add('old');

    const node = el('div.sub', { style: { '--spk': color } });
    const head = el('div.sub-head', { parent: node });
    el('span.sub-name', { text: name, parent: head });
    el('span.sub-ch', { text: ch, parent: head });
    const body = el('div.sub-text', { parent: node });
    const tw = new Typewriter(body, { msPerChar: 22 });
    tw.start(text);
    const hold = Math.max(2.5, 0.06 * text.length, Number(p.duration) || 0) + 1;
    const ln = { node, tw, body, hold, t: 0, text };
    node.addEventListener('click', () => tw.finish());
    this.box.appendChild(node);
    requestAnimationFrame(() => node.classList.add('in'));
    this.lines.push(ln);
  }

  // Lightning during a line: corrupt characters for 150 ms.
  corrupt() {
    if (this.hud.ctx.settings?.get('reduceMotion')) return;
    this._corruptT = 0.15;
  }

  finishTyping() {
    for (const l of this.lines) l.tw.finish();
  }

  _drop(ln) {
    const i = this.lines.indexOf(ln);
    if (i >= 0) this.lines.splice(i, 1);
    ln.node.classList.remove('in');
    ln.node.classList.add('out');
    setTimeout(() => ln.node.remove(), 260);
  }

  clear() {
    for (const l of this.lines.slice()) this._drop(l);
  }

  update(dt) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.tw.update(dt);
      if (l.tw.done) {
        l.t += dt;
        if (l.t > l.hold) this._drop(l);
      }
    }
    if (this._corruptT > 0) {
      this._corruptT -= dt;
      for (const l of this.lines) {
        const shown = l.tw.done ? l.text : l.text.slice(0, l.tw.shown);
        if (this._corruptT > 0) {
          let s = '';
          for (let k = 0; k < shown.length; k++) s += shown[k] !== ' ' && Math.random() < 0.16 ? '▒' : shown[k];
          l.body.textContent = s;
        } else l.body.textContent = shown;
      }
    }
  }
}
