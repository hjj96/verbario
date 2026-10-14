// Touch controls [NICE] (DESIGN §3.2 «Тач»): landscape only. A floating left stick (R 64 px), an altitude
// slider on the right with detents 15 / 40 / 90 m, the winch button 88 px (hold), 56 px buttons for the
// searchlight, flare, loudspeaker and raft, pause 44 px. Everything goes through input.setVirtualAxis /
// setVirtualButton, so the flight model never knows the difference.
import { el, setClass } from '../common/dom.js';

const STICK_R = 64;

export class TouchControls {
  constructor(hud) {
    this.hud = hud;
    this.ctx = hud.ctx;
    this.input = hud.ctx.input;
    const root = (this.node = el('div.hud-touch', { parent: hud.root }));
    this.stickZone = el('div.tc-zone', { parent: root });
    this.stick = el('div.tc-stick', { parent: root });
    this.knob = el('div.tc-knob', { parent: this.stick });
    const right = el('div.tc-right', { parent: root });
    this.slider = el('div.tc-slider', { parent: right });
    this.thumb = el('div.tc-thumb', { parent: this.slider });
    for (const [h, name, frac] of [[90, 'altPreset3', 0.12], [40, 'altPreset2', 0.48], [15, 'altPreset1', 0.82]]) {
      const d = el('div.tc-detent', { text: String(h), parent: this.slider, style: { top: `${frac * 100}%` } });
      this._hold(d, name);
    }
    const btns = el('div.tc-btns', { parent: right });
    this.winch = el('div.tc-btn.tc-winch', { text: 'ЛЕБЁДКА', parent: btns });
    this._hold(this.winch, 'winch');
    for (const [txt, name] of [['ПРОЖ', 'searchlight'], ['ФАЛЬШ', 'flare'], ['РУПОР', 'horn'], ['ПЛОТ', 'raftDrop']]) this._hold(el('div.tc-btn', { text: txt, parent: btns }), name);
    const pause = el('div.tc-btn.tc-pause', { text: 'II', parent: root });
    pause.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.hud.emit('ui:pause', {});
    });

    this._id = null;
    this._ox = 0;
    this._oy = 0;
    this.stickZone.addEventListener('touchstart', (e) => this._start(e), { passive: false });
    this.stickZone.addEventListener('touchmove', (e) => this._move(e), { passive: false });
    this.stickZone.addEventListener('touchend', (e) => this._end(e));
    this.stickZone.addEventListener('touchcancel', (e) => this._end(e));
    this._sid = null;
    this.slider.addEventListener('touchstart', (e) => this._slide(e, true), { passive: false });
    this.slider.addEventListener('touchmove', (e) => this._slide(e, false), { passive: false });
    const sEnd = () => {
      this._sid = null;
      this.input.setVirtualAxis('lift', 0);
      this.thumb.style.transform = '';
    };
    this.slider.addEventListener('touchend', sEnd);
    this.slider.addEventListener('touchcancel', sEnd);
  }

  _hold(node, name) {
    node.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.add('down');
      this.input.setVirtualButton(name, true);
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      node.classList.remove('down');
      this.input.setVirtualButton(name, false);
    };
    node.addEventListener('touchend', up);
    node.addEventListener('touchcancel', up);
  }

  _start(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._id = t.identifier;
    this._ox = t.clientX;
    this._oy = t.clientY;
    this.stick.style.transform = `translate(${this._ox}px, ${this._oy}px)`;
    this.stick.classList.add('on');
    this.knob.style.transform = '';
  }

  _move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== this._id) continue;
      let dx = t.clientX - this._ox;
      let dy = t.clientY - this._oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        dx *= STICK_R / d;
        dy *= STICK_R / d;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.setVirtualAxis('moveX', dx / STICK_R);
      this.input.setVirtualAxis('moveY', -dy / STICK_R);
    }
  }

  _end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== this._id) continue;
      this._id = null;
      this.stick.classList.remove('on');
      this.input.setVirtualAxis('moveX', 0);
      this.input.setVirtualAxis('moveY', 0);
    }
  }

  _slide(e, start) {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (start) this._sid = t.identifier;
    if (t.identifier !== this._sid) return;
    const r = this.slider.getBoundingClientRect();
    const k = Math.max(-1, Math.min(1, ((r.top + r.height / 2 - t.clientY) / (r.height / 2))));
    this.input.setVirtualAxis('lift', Math.abs(k) < 0.12 ? 0 : k);
    this.thumb.style.transform = `translateY(${(-k * r.height) / 2}px)`;
  }

  update() {
    const show = this.ctx.mode === 'play' && this.input?.lastDevice === 'touch';
    setClass(this.node, 'on', show);
  }
}
