// Photo mode — post side (DESIGN §2.1 «tilt-shift … только фоторежим», §8.5 #7; CONTRACT «Depth pass
// additions»). Owns ctx.photo = { active, focus, blur, ev, grade, letterbox }; the camera rig flies
// the free camera while ctx.photo.active, the HUD hides itself, PostFX freezes the sim (timeScale 0,
// gameplay input off) and feeds the options below into FinalPass.
//
//   tilt-shift / DOF: focus line (screen height) + blur strength
//   exposure: −2…+2 EV
//   grade presets: «Как есть», «Хроника», «Ч/Б», «Плёнка»
//   letterbox 2.39:1 on/off, PNG of the clean frame (no DOM), a tiny Russian help card (H hides it)
//
// Keyboard: [ ] focus · − = blur · , . exposure · 1–4 / G grade · B letterbox · Enter save · H help.
// Gamepad (read directly, so the gameplay bindings of the same buttons don't leak in): D-pad ↑↓ focus,
// ←→ exposure, View blur step, X grade, Y letterbox, A save. The camera reads sticks/triggers/LB/RB.

export const GRADES = [
  { id: 'none', name: 'Как есть', mix: 0 },
  { id: 'chronicle', name: 'Хроника', mix: 1, sat: 0.42, contrast: 1.16, fade: 0.03, shadow: [0.93, 1.0, 1.06], high: [1.05, 1.0, 0.93], grain: 0.03 },
  { id: 'bw', name: 'Ч/Б', mix: 1, sat: 0, contrast: 1.24, fade: 0.015, shadow: [1, 1, 1], high: [1, 1, 1], grain: 0.025 },
  { id: 'film', name: 'Плёнка', mix: 1, sat: 0.86, contrast: 0.9, fade: 0.06, shadow: [0.93, 1.03, 1.05], high: [1.07, 1.0, 0.88], grain: 0.02 },
];
const DOF_TAPS = { low: 12, medium: 20, high: 32 };
const BLUR_STEPS = [0, 0.35, 0.7, 1];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class PhotoMode {
  constructor(ctx) {
    this.ctx = ctx;
    // shared state (CONTRACT): HUD hides itself while active
    this.state = ctx.photo && typeof ctx.photo === 'object' ? ctx.photo : {};
    Object.assign(this.state, { active: false, focus: 0.55, blur: 0.5, ev: 0, grade: 'none', letterbox: true });
    ctx.photo = this.state;
    this.gradeIndex = 0;
    this.help = true;
    this.saveRequested = false;
    this.lastSave = null;
    this.letterboxMix = 0;
    this._savedTimeScale = 1;
    this._hit = new Set(); // keys that went down since the last update (taps shorter than a frame)
    this._padPrev = [];
    this._focusShow = 0;
    this._toastT = 0;
    this._dirty = true;
    this._el = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (this.state.active && !e.repeat) this._hit.add(e.code);
      });
    }
  }

  get active() {
    return this.state.active;
  }

  enter() {
    const ctx = this.ctx;
    if (this.state.active) return;
    this.state.active = true;
    this._savedTimeScale = ctx.timeScale > 0 ? ctx.timeScale : 1;
    ctx.timeScale = 0;
    this.letterboxMix = clamp(ctx.cameraRig?.letterbox || 0, 0, 1);
    this._hit.clear();
    this._padPrev.length = 0;
    this._dirty = true;
    this._ensureDom();
    if (this._el) this._el.root.style.display = '';
    ctx.events?.emit?.('photo:toggle', { active: true });
  }

  exit() {
    const ctx = this.ctx;
    if (!this.state.active) return;
    this.state.active = false;
    ctx.timeScale = this._savedTimeScale || 1;
    if (this._el) this._el.root.style.display = 'none';
    ctx.events?.emit?.('photo:toggle', { active: false });
  }

  toggle() {
    if (this.state.active) this.exit();
    else this.enter();
  }

  requestSave() {
    this.saveRequested = true;
  }

  // ------------------------------------------------------------------------------------------
  // realDt; only while active
  update(dt) {
    const ctx = this.ctx;
    const S = this.state;
    ctx.timeScale = 0; // the sim stays frozen even if something else touched it
    if (ctx.input) ctx.input.enabled = false; // runs after mission, which re-enables it every frame
    const keys = ctx.input?.keys;
    const held = (c) => !!keys?.has(c);
    const tap = (c) => this._hit.has(c);
    const pad = this._pad();
    const pHeld = (i) => !!pad?.buttons?.[i]?.pressed;
    const pTap = (i) => pHeld(i) && !this._padPrev[i];

    let focusDir = (held('BracketRight') ? 1 : 0) - (held('BracketLeft') ? 1 : 0) + (pHeld(12) ? 1 : 0) - (pHeld(13) ? 1 : 0);
    if (focusDir) {
      S.focus = clamp(S.focus + focusDir * 0.4 * dt, 0.05, 0.95);
      this._focusShow = 1.2;
      this._dirty = true;
    }
    const blurDir = (held('Equal') || held('NumpadAdd') ? 1 : 0) - (held('Minus') || held('NumpadSubtract') ? 1 : 0);
    if (blurDir) {
      S.blur = clamp(S.blur + blurDir * 0.6 * dt, 0, 1);
      this._focusShow = 1.2;
      this._dirty = true;
    }
    if (pTap(8)) {
      const i = BLUR_STEPS.findIndex((b) => b > S.blur + 0.01);
      S.blur = i < 0 ? 0 : BLUR_STEPS[i];
      this._focusShow = 1.2;
      this._dirty = true;
    }
    const evDir = (held('Period') ? 1 : 0) - (held('Comma') ? 1 : 0) + (pHeld(15) ? 1 : 0) - (pHeld(14) ? 1 : 0);
    if (evDir) {
      S.ev = clamp(S.ev + evDir * 1.5 * dt, -2, 2);
      this._dirty = true;
    }
    for (let i = 0; i < 4; i++) if (tap('Digit' + (i + 1))) this._setGrade(i);
    if (tap('KeyG') || pTap(2)) this._setGrade((this.gradeIndex + 1) % GRADES.length);
    if (tap('KeyB') || pTap(3)) {
      S.letterbox = !S.letterbox;
      this._dirty = true;
    }
    if (tap('KeyH')) {
      this.help = !this.help;
      this._dirty = true;
    }
    if (tap('Enter') || tap('NumpadEnter') || pTap(0)) this.requestSave();

    this._hit.clear();
    if (pad) for (let i = 0; i < 16; i++) this._padPrev[i] = pHeld(i);

    // letterbox eases in/out (0.5 s)
    const lbT = S.letterbox ? 1 : 0;
    this.letterboxMix += clamp(lbT - this.letterboxMix, -dt / 0.5, dt / 0.5);
    if (this._focusShow > 0) this._focusShow -= dt;
    if (this._toastT > 0) {
      this._toastT -= dt;
      if (this._toastT <= 0) this._dirty = true;
    }
    this._renderDom();
  }

  _pad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : null;
      if (!pads) return null;
      for (const p of pads) if (p && p.connected) return p;
    } catch {
      /* no gamepad API */
    }
    return null;
  }

  _setGrade(i) {
    this.gradeIndex = i;
    this.state.grade = GRADES[i].id;
    this._dirty = true;
  }

  // FinalPass uniforms (called every frame; neutral when inactive)
  apply(u, quality, sizeY) {
    const S = this.state;
    if (!S.active) {
      u.uDof.value = 0;
      u.uLookMix.value = 0;
      return 0;
    }
    u.uDof.value = S.blur * 16 * Math.max(0.5, sizeY / 1080);
    u.uDofFocus.value = S.focus;
    u.uDofBand.value = 0.05 + 0.1 * (1 - S.blur);
    u.uDofTaps.value = DOF_TAPS[quality] ?? 24;
    const g = GRADES[this.gradeIndex];
    u.uLookMix.value = g.mix;
    if (g.mix > 0) {
      u.uLookSat.value = g.sat;
      u.uLookContrast.value = g.contrast;
      u.uLookFade.value = g.fade;
      u.uLookShadow.value.set(g.shadow[0], g.shadow[1], g.shadow[2]);
      u.uLookHigh.value.set(g.high[0], g.high[1], g.high[2]);
    }
    return g.grain || 0; // extra grain
  }

  exposureMul() {
    return this.state.active ? Math.pow(2, this.state.ev) : 1;
  }

  // After the frame is drawn (same task → the WebGL drawing buffer is still valid).
  capture(canvas) {
    this.saveRequested = false;
    if (!canvas) return;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const name = `mayday-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    const download = (url, revoke) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    const done = (size) => {
      this.lastSave = { name, size, w: canvas.width, h: canvas.height };
      this._toastT = 2.2;
      this._dirty = true;
      this.ctx.events?.emit?.('photo:saved', this.lastSave);
    };
    try {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) return;
          download(URL.createObjectURL(blob), true);
          done(blob.size);
        }, 'image/png');
      } else {
        const url = canvas.toDataURL('image/png');
        download(url, false);
        done(url.length);
      }
    } catch (err) {
      console.warn('[photo] capture failed', err);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Tiny help card (DOM, so it never lands in the PNG) + a focus-line marker while adjusting.
  _ensureDom() {
    if (this._el || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'photo-mode';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;font:500 11px/1.55 "JetBrains Mono",ui-monospace,monospace;color:rgba(232,236,238,.9);letter-spacing:.02em;';
    const card = document.createElement('div');
    card.style.cssText = 'position:absolute;left:16px;bottom:16px;max-width:calc(100vw - 32px);padding:9px 12px 10px;background:rgba(8,12,15,.58);border:1px solid rgba(232,236,238,.14);border-radius:3px;backdrop-filter:blur(3px);white-space:pre;overflow:hidden;';
    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;left:0;right:0;height:0;border-top:1px dashed rgba(255,214,140,.75);opacity:0;transition:opacity .25s;';
    const toast = document.createElement('div');
    toast.style.cssText = 'position:absolute;right:16px;bottom:16px;padding:6px 10px;background:rgba(8,12,15,.62);border-radius:3px;opacity:0;transition:opacity .3s;';
    root.append(line, card, toast);
    (this.ctx.container || document.body).appendChild(root);
    this._el = { root, card, line, toast };
  }

  _renderDom() {
    const el = this._el;
    if (!el) return;
    const S = this.state;
    el.line.style.bottom = (S.focus * 100).toFixed(2) + '%';
    el.line.style.opacity = this._focusShow > 0 && S.blur > 0.01 ? '1' : '0';
    if (!this._dirty) return;
    this._dirty = false;
    const pad = this.ctx.input?.lastDevice === 'gamepad';
    const ev = (S.ev >= 0 ? '+' : '−') + Math.abs(S.ev).toFixed(1);
    const g = GRADES[this.gradeIndex].name;
    const lb = S.letterbox ? 'вкл' : 'выкл';
    const pct = (v) => Math.round(v * 100) + '%';
    let text;
    if (!this.help) text = pad ? 'ФОТОРЕЖИМ   ☰ скрыто · B выход' : 'ФОТОРЕЖИМ   H — подсказка · V — выход';
    else if (pad) {
      text = 'ФОТОРЕЖИМ · игра на паузе\n'
        + 'стики — сдвиг / вращение · LT RT высота · LB RB зум\n'
        + `D-pad ↑↓ фокус ${pct(S.focus)} · View размытие ${pct(S.blur)}\n`
        + `D-pad ←→ экспозиция ${ev} · X грейд: ${g}\n`
        + `Y кашет: ${lb} · A снимок · B выход`;
    } else {
      text = 'ФОТОРЕЖИМ · игра на паузе\n'
        + 'ЛКМ — вращение · ПКМ, WASD — сдвиг · колесо — зум · Q/E — высота\n'
        + `[ ] фокус ${pct(S.focus)} · − = размытие ${pct(S.blur)} · , . экспозиция ${ev}\n`
        + `1–4 грейд: ${g} · B кашет: ${lb}\n`
        + 'Enter — снимок PNG · H — скрыть · V — выход';
    }
    el.card.textContent = text;
    if (this._toastT > 0 && this.lastSave) {
      el.toast.textContent = 'Снимок сохранён · ' + this.lastSave.name;
      el.toast.style.opacity = '1';
    } else el.toast.style.opacity = '0';
  }

  dispose() {
    this._el?.root.remove();
    this._el = null;
  }
}
