// HUD & menus (CONTRACT «hud»; DESIGN §2.14, §7.1–7.8, catalogue §4 items 48–52).
//
// Two registers: in flight — the documentary escort-drone overlay with aircraft instruments
// (src/ui/flight/*: DOM text panels at ≤ 12 Hz, ONE full-screen canvas at 60 Hz, radar canvas at 30 Hz);
// off flight — the navigator's chart table and the logbook (src/ui/screens/*: paper, ink, red pencil).
//
// Flow (§7.1): boot → [first launch] flash warning → «НАЖМИТЕ ЛЮБУЮ КЛАВИШУ» → ТИТУЛ → ОПЕРАЦИИ →
// БРИФИНГ → play ⇄ ПАУЗА → ДЕБРИФ (cinematic caption → logbook) → далее / повтор / меню.
// The mission system owns modes; the HUD only emits ui:* events (ui:start {index}, ui:select-mission
// {index}, ui:endless, ui:launch, ui:resume, ui:retry, ui:next, ui:menu, ui:hover, ui:click) and calls
// settings.set(). Extra UI events for audio: ui:back, ui:static (screen transition squelch),
// ui:type {ch, voice} (typewriter), ui:stamp (logbook stamp impact).
//
// Public (beyond the contract): screen (current menu screen name), capturingBack (mission's pause poll
// checks it), show(name) (tests), toast(title, detail, opts), flight (FlightHud), palette, fontsReady.
import { el, setClass } from '../ui/common/dom.js';
import { HudPalette } from '../ui/common/palette.js';
import { StaticTransition } from '../ui/common/transition.js';
import { FlightHud } from '../ui/flight/flight.js';
import { FlashScreen, PressScreen } from '../ui/screens/boot.js';
import { TitleScreen } from '../ui/screens/title.js';
import { OperationsScreen } from '../ui/screens/operations.js';
import { BriefingScreen } from '../ui/screens/briefing.js';
import { PauseScreen } from '../ui/screens/pause.js';
import { SettingsScreen } from '../ui/screens/settings.js';
import { ControlsScreen } from '../ui/screens/controls.js';
import { DebriefScreen } from '../ui/screens/debrief.js';
import { ConfirmScreen } from '../ui/screens/confirm.js';
import { TouchControls } from '../ui/flight/touch.js';
import { BINDINGS } from '../core/input.js';

const SCREENS = {
  flash: FlashScreen,
  press: PressScreen,
  title: TitleScreen,
  operations: OperationsScreen,
  briefing: BriefingScreen,
  pause: PauseScreen,
  settings: SettingsScreen,
  controls: ControlsScreen,
  debrief: DebriefScreen,
  confirm: ConfirmScreen,
};

export class Hud {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
    this.fontsReady = false;
    this.keyboardNav = false;
    this.palette = new HudPalette();
    this.nohud = !!ctx.params?.has?.('nohud');
    this.root = el('div.mayday-hud', { parent: ctx.hudRoot || document.body });
    if (this.nohud) this.root.hidden = true;
    this.screensRoot = el('div.hud-screens', { parent: this.root });
    this.static = new StaticTransition(this.root);
    this.screens = {};
    this.stack = []; // [{ name, screen }]
    this._offs = [];
    this._holdBackFrame = -1;
    this._gates = { flash: false, press: false };
    this._routedMode = null;
    this._applySettingsCss();
    this.flight = new FlightHud(this);
    this.touch = null;
    // Menus also listen to raw keydown events: at a low frame rate a quick tap can start and end
    // between two input polls, and a menu must never swallow a key press.
    this._kbBuf = new Set();
    this._kbHeld = new Set();
    this._onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      for (const name of Object.keys(BINDINGS.buttons)) {
        if (BINDINGS.buttons[name].includes(e.code)) {
          this._kbBuf.add(name);
          this._kbHeld.add(name);
        }
      }
    };
    this._onKeyUp = (e) => {
      for (const name of Object.keys(BINDINGS.buttons)) if (BINDINGS.buttons[name].includes(e.code)) this._kbHeld.delete(name);
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this._kbHeld.clear());
  }

  async init() {
    const ctx = this.ctx;
    const auto = !!ctx.params?.has?.('autostart');
    this._gates.flash = !auto && !ctx.settings?.get('seenFlashWarning');
    this._gates.press = !auto;
    this.applyPaletteCss();
    this.on('game:mode', ({ to } = {}) => this._route(to));
    this.on('game:ready', () => this._route(ctx.mode, true));
    this.on('mission:logbook', (p) => this.screens.debrief?.onLogbook?.(p?.report));
    this.on('mission:complete', (p) => this._debriefData(p));
    this.on('mission:failed', (p) => this._debriefData(p));
    ctx.settings?.onChange?.((k) => {
      this._applySettingsCss();
      if (k === 'colorblindMarkers') this.flight._palette();
      for (const s of Object.values(this.screens)) s.onSettings?.(k);
    });
    // canvas text waits for the web fonts (DESIGN §7.3), but never longer than 2.5 s
    const ready = document.fonts?.ready || Promise.resolve();
    Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]).then(() => {
      this.fontsReady = true;
      for (const s of Object.values(this.screens)) s.onFonts?.();
    });
    if (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window) {
      try {
        this.touch = new TouchControls(this);
      } catch (err) {
        console.error('[hud] touch controls failed', err);
      }
    }
    this.resize(window.innerWidth, window.innerHeight);
    this._route(ctx.mode, true);
  }

  // ----------------------------------------------------------------------------------------------
  // Helpers used by screens
  emit(name, payload = {}) {
    this.ctx.events.emit(name, payload);
  }

  on(name, fn) {
    const off = this.ctx.events.on(name, fn);
    this._offs.push(off);
    return off;
  }

  rawDown(name) {
    return !!this.ctx.input?.buttons?.get?.(name) || this._kbBuf.has(name) || this._kbHeld.has(name);
  }

  rawPressed(name) {
    return !!this.ctx.input?.rawPressed?.(name) || this._kbBuf.has(name);
  }

  setKeyboardNav(on) {
    if (on === this.keyboardNav) return;
    this.keyboardNav = on;
    setClass(this.root, 'kbd-nav', on);
  }

  get hs() {
    const v = Number(this.ctx.settings?.get('hudScale'));
    return Number.isFinite(v) ? Math.min(1.3, Math.max(0.8, v)) : 1;
  }

  get ts() {
    const v = Number(this.ctx.settings?.get('textScale'));
    return Number.isFinite(v) ? Math.min(1.5, Math.max(1, v)) : 1;
  }

  get screen() {
    return this.stack.length ? this.stack[this.stack.length - 1].name : null;
  }

  // Mission's pause poll ignores the pause key while a sub-menu/confirmation handles «Назад».
  get capturingBack() {
    if (this.ctx.mode !== 'paused') return false;
    if (this.stack.length > 1) return true;
    return (this.ctx.time?.frame ?? 0) <= this._holdBackFrame;
  }

  toast(title, detail, opts) {
    return this.flight.toasts.push(title, detail, opts);
  }

  applyPaletteCss() {
    const vars = this.palette.cssVars();
    for (const k of Object.keys(vars)) this.root.style.setProperty(k, vars[k]);
  }

  _applySettingsCss() {
    const s = this.ctx.settings;
    this.root.style.setProperty('--hs', String(this.hs));
    this.root.style.setProperty('--ts', String(this.ts));
    setClass(this.root, 'reduce-motion', !!s?.get('reduceMotion'));
    setClass(this.root, 'reduce-flashes', !!s?.get('reduceFlashes'));
    setClass(this.root, 'colorblind', !!s?.get('colorblindMarkers'));
    setClass(this.root, 'no-subs', s?.get('subtitles') === false);
    if (this.flight && this._W) this.flight.layout(this._W, this._H);
  }

  // ----------------------------------------------------------------------------------------------
  // Screen stack
  _get(name) {
    let s = this.screens[name];
    if (!s) {
      const C = SCREENS[name];
      if (!C) return null;
      s = this.screens[name] = new C(this);
      if (this.fontsReady) s.onFonts?.();
    }
    return s;
  }

  // Replace the whole stack with one screen (mode changes).
  setRoot(name, opts = {}, transition = true) {
    const old = this.stack.slice();
    this.stack.length = 0;
    const next = name ? this._get(name) : null;
    if (next) this.stack.push({ name, screen: next });
    this._swap(old, next, opts, transition);
  }

  // Push a sub-screen (settings, controls, operations, confirm).
  go(name, opts = {}) {
    const next = this._get(name);
    if (!next) return;
    const top = this.stack[this.stack.length - 1];
    this.stack.push({ name, screen: next });
    if (next.overlay) {
      next.show(opts);
      this._paintStack();
      return;
    }
    this._swap(top ? [top] : [], next, opts, true, true);
  }

  back() {
    const top = this.stack.pop();
    if (!top) return;
    this._holdBackFrame = (this.ctx.time?.frame ?? 0) + 1;
    const under = this.stack[this.stack.length - 1];
    if (top.screen.overlay) {
      top.screen.hide();
      this._paintStack();
      return;
    }
    this._swap([top], under ? under.screen : null, { returning: true }, true, true);
  }

  _swap(oldEntries, next, opts, transition, keepOld = false) {
    const reduce = this.ctx.settings?.get('reduceMotion');
    const doSwap = () => {
      for (const e of oldEntries) if (e.screen !== next) e.screen.hide();
      if (next) next.show(opts);
      this._paintStack();
    };
    if (transition && !this.nohud && !reduce && (oldEntries.length || next)) {
      this.emit('ui:static', {});
      this.static.run(doSwap);
    } else doSwap();
    void keepOld;
  }

  _paintStack() {
    const any = this.stack.length > 0;
    setClass(this.root, 'menu-open', any);
    for (const k of Object.keys(this.screens)) {
      const s = this.screens[k];
      const inStack = this.stack.some((e) => e.screen === s);
      if (!inStack && s.visible) s.hide();
    }
    const top = this.stack[this.stack.length - 1];
    for (const e of this.stack) setClass(e.screen.node, 'is-top', e === top);
    this.activeMenu?.reset?.();
  }

  get activeMenu() {
    const top = this.stack[this.stack.length - 1];
    return top ? top.screen.menu || null : null;
  }

  show(name, opts) {
    this.setRoot(name, opts, false);
  }

  // ----------------------------------------------------------------------------------------------
  // Mode routing (§7.1)
  _route(mode, initial = false) {
    if (!mode) return;
    if (mode === this._routedMode && !initial) return;
    if (initial && mode === this._routedMode && this.stack.length) return;
    this._routedMode = mode;
    const ctx = this.ctx;
    for (const m of ['title', 'briefing', 'play', 'paused', 'debrief']) setClass(document.body, `hud-mode-${m}`, m === mode);
    this.flight.setVisible(mode === 'play' || mode === 'paused');
    if (mode === 'title') {
      if (this._gates.flash) this.setRoot('flash', { next: 'press' }, false);
      else if (this._gates.press) this.setRoot('press', {}, false);
      else this.setRoot('title', {}, !initial);
    } else if (mode === 'briefing') {
      this._gates.press = false;
      if (this._gates.flash) this.setRoot('flash', { next: 'briefing' }, false);
      else this.setRoot('briefing', {}, !initial);
    } else if (mode === 'play') {
      this._gates.flash = this._gates.press = false;
      const fromPause = this.screen === 'pause' || this.stack.some((e) => e.name === 'pause');
      this.setRoot(null, {}, !fromPause && !initial);
    } else if (mode === 'paused') {
      this.setRoot('pause', {}, false);
    } else if (mode === 'debrief') {
      this.setRoot('debrief', { report: ctx.mission?.result || this._lastReport || null }, true);
    }
  }

  // Called by the flash/press gates when they are done.
  gateDone(which) {
    this._gates[which] = false;
    const mode = this.ctx.mode;
    if (which === 'flash' && mode === 'title' && this._gates.press) this.setRoot('press', {}, true);
    else if (mode === 'title') this.setRoot('title', { intro: true }, true);
    else if (mode === 'briefing') this.setRoot('briefing', {}, true);
    else this._route(mode, true);
  }

  _debriefData(p) {
    this._lastReport = p?.report || null;
    this.screens.debrief?.onResult?.(p);
  }

  // ----------------------------------------------------------------------------------------------
  // dt = realDt from main.js (clamped to 0.1 s). Menus run on their own wall clock (uiDt) so typing,
  // pencil circles and transitions keep their real durations even when the game renders at 5 fps.
  update(dt) {
    const now = performance.now();
    const uiDt = this._lastNow ? Math.min(0.25, Math.max(0, (now - this._lastNow) / 1000)) : dt;
    this._lastNow = now;
    this.time += uiDt;
    const top = this.stack[this.stack.length - 1];
    this.static.update(uiDt);
    if (top && !this.static.active) {
      const menu = top.screen.menu;
      if (menu && !top.screen.blockInput) menu.handle(uiDt);
      top.screen.handleInput?.(uiDt);
    }
    for (const e of this.stack) e.screen.update?.(uiDt, e === top);
    if (this.flight.visible) {
      try {
        this.flight.update(dt);
      } catch (err) {
        if (!this._flightErr) console.error('[hud] flight HUD update failed', err);
        this._flightErr = true;
      }
    }
    this.flight.updateFps(dt);
    this.touch?.update(dt);
    this._kbBuf.clear();
  }

  resize(w, h) {
    this._W = w;
    this._H = h;
    this.flight.layout(w, h);
    for (const s of Object.values(this.screens)) s.resize?.(w, h);
  }
}
