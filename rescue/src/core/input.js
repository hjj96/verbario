// Unified input: keyboard, mouse, gamepad and virtual (touch) controls mapped to named actions.
// Systems read actions only — never raw keys. See BINDINGS for the action list.
import { clamp } from './math.js';

// Keyboard bindings use KeyboardEvent.code (layout independent, so ЙЦУКЕН works too).
export const BINDINGS = {
  // axes: [negativeKeys, positiveKeys]. Never bind Ctrl (Ctrl+W closes the tab).
  axes: {
    moveX: [['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']],
    moveY: [['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']], // +1 = screen up (north)
    lift: [['KeyQ', 'KeyF', 'PageDown'], ['KeyE', 'KeyR', 'PageUp']], // +1 = climb
  },
  buttons: {
    winch: ['Space'],
    boost: ['ShiftLeft', 'ShiftRight'],
    searchlight: ['KeyL'],
    flare: ['KeyG', 'Mouse0'],
    raftDrop: ['KeyC', 'Mouse2'],
    horn: ['KeyH'], // loudspeaker
    altPreset1: ['Digit1', 'Numpad1'], // 15 m
    altPreset2: ['Digit2', 'Numpad2'], // 40 m
    altPreset3: ['Digit3', 'Numpad3'], // 90 m
    altUp: [], // gamepad D-pad only
    altDown: [],
    map: ['KeyM', 'Tab'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter', 'NumpadEnter'],
    back: ['Escape', 'Backspace'],
    zoom: ['KeyZ'],
    debug: ['Backquote'],
    photo: ['KeyV'], // photo mode (free camera, hidden HUD)
    thermal: ['KeyT'], // FLIR / thermal view
    // menu navigation (also used by HUD menus)
    navUp: ['ArrowUp', 'KeyW'],
    navDown: ['ArrowDown', 'KeyS'],
    navLeft: ['ArrowLeft', 'KeyA'],
    navRight: ['ArrowRight', 'KeyD'],
  },
};

// Player key rebinding (DESIGN §7.6 [NICE], settings key `bindings`): two keys per action by event.code.
// REBINDABLE lists the actions the УПРАВЛЕНИЕ sheet offers, each pointing at its slot in BINDINGS; an
// override replaces that slot's whole key list. Menu keys (confirm / back / nav*), pause, debug stay fixed.
export const REBINDABLE = [
  { id: 'up', label: 'Полёт вверх по экрану (север)', axis: 'moveY', side: 1 },
  { id: 'down', label: 'Полёт вниз по экрану', axis: 'moveY', side: 0 },
  { id: 'left', label: 'Полёт влево', axis: 'moveX', side: 0 },
  { id: 'right', label: 'Полёт вправо', axis: 'moveX', side: 1 },
  { id: 'climb', label: 'Набор высоты (держать)', axis: 'lift', side: 1 },
  { id: 'descend', label: 'Снижение (держать)', axis: 'lift', side: 0 },
  { id: 'altPreset1', label: 'Высота 15 м', button: 'altPreset1' },
  { id: 'altPreset2', label: 'Высота 40 м', button: 'altPreset2' },
  { id: 'altPreset3', label: 'Высота 90 м', button: 'altPreset3' },
  { id: 'winch', label: 'Лебёдка (держать)', button: 'winch' },
  { id: 'boost', label: 'Форсаж (держать)', button: 'boost' },
  { id: 'searchlight', label: 'Прожектор', button: 'searchlight' },
  { id: 'flare', label: 'Фальшфейер к курсору', button: 'flare' },
  { id: 'raftDrop', label: 'Сбросить плот', button: 'raftDrop' },
  { id: 'horn', label: 'Громкоговоритель', button: 'horn' },
  { id: 'map', label: 'Карта (держать)', button: 'map' },
  { id: 'zoom', label: 'Зум камеры', button: 'zoom' },
  { id: 'thermal', label: 'Тепловизор', button: 'thermal' },
  { id: 'photo', label: 'Фоторежим', button: 'photo' },
];

// Keys a player may never bind: modifiers (Ctrl+W closes the tab — Ctrl is never used), the menu /
// pause keys, the debug key and the browser's function keys.
export function bindableCode(code) {
  if (typeof code !== 'string' || !code) return false;
  if (/^(Control|Meta|Alt|OS|Fn)/.test(code) || /^F\d+$/.test(code)) return false;
  return !['Escape', 'Backspace', 'Backquote', 'Enter', 'NumpadEnter', 'CapsLock', 'ContextMenu', 'PrintScreen'].includes(code);
}

const DEFAULT_BINDINGS = JSON.parse(JSON.stringify(BINDINGS));

// The default key list of a rebindable action (a copy).
export function defaultKeys(id) {
  const r = REBINDABLE.find((x) => x.id === id);
  if (!r) return [];
  return (r.axis ? DEFAULT_BINDINGS.axes[r.axis][r.side] : DEFAULT_BINDINGS.buttons[r.button]).slice();
}

// Current key list of a rebindable action (live BINDINGS).
export function currentKeys(id) {
  const r = REBINDABLE.find((x) => x.id === id);
  if (!r) return [];
  return r.axis ? BINDINGS.axes[r.axis][r.side] : BINDINGS.buttons[r.button];
}

// Rebuild BINDINGS in place from the defaults plus `overrides` ({ id: [code, code] }); everyone holding a
// reference to BINDINGS (Input.poll, the HUD's raw key buffer, the controls sheet) sees the change live.
// Mouse0 / Mouse2 stay allowed (flare / raft); anything unbindable is dropped.
export function applyBindings(overrides) {
  for (const name of Object.keys(DEFAULT_BINDINGS.axes)) {
    BINDINGS.axes[name][0] = DEFAULT_BINDINGS.axes[name][0].slice();
    BINDINGS.axes[name][1] = DEFAULT_BINDINGS.axes[name][1].slice();
  }
  for (const name of Object.keys(DEFAULT_BINDINGS.buttons)) BINDINGS.buttons[name] = DEFAULT_BINDINGS.buttons[name].slice();
  if (!overrides || typeof overrides !== 'object') return;
  for (const r of REBINDABLE) {
    const list = overrides[r.id];
    if (!Array.isArray(list)) continue;
    const keys = [...new Set(list.filter((c) => bindableCode(c) || c === 'Mouse0' || c === 'Mouse2'))].slice(0, 2);
    if (r.axis) BINDINGS.axes[r.axis][r.side] = keys;
    else BINDINGS.buttons[r.button] = keys;
  }
}

// Standard gamepad mapping.
const PAD = {
  axes: { moveX: 0, moveY: 1, aimX: 2, aimY: 3 },
  lift: { up: 7, down: 6 }, // RT climbs, LT descends (analog)
  buttons: {
    winch: [0], confirm: [0], flare: [1], back: [1], searchlight: [2], horn: [3], boost: [4], zoom: [5],
    map: [8], pause: [9], photo: [10], thermal: [11], altUp: [12], altDown: [13], raftDrop: [15],
    navUp: [12], navDown: [13], navLeft: [14], navRight: [15],
  },
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.prevButtons = new Map();
    this.buttons = new Map(); // action -> bool (this frame)
    this.axesValues = { moveX: 0, moveY: 0, lift: 0, aimX: 0, aimY: 0 };
    this._stick = { x: 0, y: 0 }; // scratch for the gamepad stick curve (poll() allocates nothing)
    this.mouseButtons = new Set(); // 'Mouse0' | 'Mouse2' (only presses that started on the game canvas)
    this.virtualAxes = {}; // set by touch UI
    this.virtualButtons = {}; // set by touch UI
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, wheel: 0, active: false, lastMoveT: -1e9 };
    this.lastDevice = 'keyboard'; // 'keyboard' | 'gamepad' | 'touch'
    this.enabled = true;
    this.anyPressedThisFrame = false;

    // Codes / buttons that went down since the last poll: a tap shorter than one frame (fast fingers
    // at low fps, synthetic test input) still counts as one press instead of being lost.
    this._taps = new Set();
    this._onKeyDown = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (!e.repeat) this._taps.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'PageUp', 'PageDown'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => {
      this.keys.clear();
      this._taps.clear();
      this.mouseButtons.clear();
    };
    this._onMouseMove = (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouse.active = true;
      this.mouse.lastMoveT = performance.now(); // heli nose follows the cursor for 2 s after it moved
    };
    this._onMouseDown = (e) => {
      this.mouse.down = true;
      this.mouse.lastMoveT = performance.now();
      if (e.target && e.target.tagName === 'CANVAS' && e.target.closest('#game')) {
        this.mouseButtons.add('Mouse' + e.button);
        this._taps.add('Mouse' + e.button);
      }
    };
    this._onMouseUp = (e) => {
      this.mouse.down = false;
      this.mouseButtons.delete('Mouse' + e.button);
    };
    this._onContextMenu = (e) => {
      if (e.target && e.target.closest && e.target.closest('#game')) e.preventDefault();
    };
    this._onWheel = (e) => (this.mouse.wheel += Math.sign(e.deltaY));
    this._onTouch = () => (this.lastDevice = 'touch');

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('touchstart', this._onTouch, { passive: true });
  }

  // Called once per frame by main.js before systems update.
  poll() {
    const pad = this._pad();
    const prevAny = this.anyPressedThisFrame;
    this.anyPressedThisFrame = false;

    for (const name of Object.keys(BINDINGS.axes)) {
      const [neg, pos] = BINDINGS.axes[name];
      let v = 0;
      if (neg.some((k) => this.keys.has(k) || this._taps.has(k))) v -= 1;
      if (pos.some((k) => this.keys.has(k) || this._taps.has(k))) v += 1;
      if (pad && name === 'lift') {
        const up = pad.buttons[PAD.lift.up]?.value || 0;
        const down = pad.buttons[PAD.lift.down]?.value || 0;
        if (Math.abs(up - down) > 0.08) v = up - down;
      }
      const va = this.virtualAxes[name];
      if (va !== undefined && Math.abs(va) > 0.02) v = va;
      this.axesValues[name] = clamp(v, -1, 1);
    }
    // Gamepad sticks: radial dead zone 0.14, response curve 0.55m + 0.45m³ (DESIGN §3.2).
    if (pad) {
      const s = this._stick;
      const stick = (ix, iy) => {
        const x = pad.axes[ix] || 0;
        const y = -(pad.axes[iy] || 0); // pad Y is +1 down; ours is +1 = north/screen up
        const m = Math.hypot(x, y);
        if (m < 0.14) return null;
        const mm = Math.min(1, (m - 0.14) / 0.86);
        const k = (0.55 * mm + 0.45 * mm * mm * mm) / m;
        s.x = clamp(x * k, -1, 1);
        s.y = clamp(y * k, -1, 1);
        return s;
      };
      // Stick and movement keys combine: the stronger one wins, so a stray held key (Ctrl, Shift boost, a keyup
      // lost behind Cmd) never freezes the stick. Touch controls, when active, own movement.
      const vm = this.virtualAxes.moveX || this.virtualAxes.moveY;
      const mv = !vm && stick(PAD.axes.moveX, PAD.axes.moveY);
      const av = this.axesValues;
      if (mv && Math.hypot(mv.x, mv.y) > Math.hypot(av.moveX, av.moveY)) {
        av.moveX = mv.x;
        av.moveY = mv.y;
      }
      const aim = stick(PAD.axes.aimX, PAD.axes.aimY);
      av.aimX = aim ? aim.x : 0;
      av.aimY = aim ? aim.y : 0;
    } else {
      this.axesValues.aimX = this.virtualAxes.aimX || 0;
      this.axesValues.aimY = this.virtualAxes.aimY || 0;
    }

    for (const name of Object.keys(BINDINGS.buttons)) {
      let down = BINDINGS.buttons[name].some((k) => this.keys.has(k) || this.mouseButtons.has(k) || this._taps.has(k));
      if (pad && PAD.buttons[name]) down = down || PAD.buttons[name].some((i) => pad.buttons[i]?.pressed);
      if (this.virtualButtons[name]) down = true;
      this.prevButtons.set(name, this.buttons.get(name) || false);
      this.buttons.set(name, down);
      if (down && !this.prevButtons.get(name)) this.anyPressedThisFrame = true;
    }
    if (this.mouse.down) this.anyPressedThisFrame = this.anyPressedThisFrame || !prevAny;
    if (this._taps.size) this.anyPressedThisFrame = true;
    this._taps.clear();
  }

  // Wheel delta accumulated since the last call (consumed).
  consumeWheel() {
    const w = this.mouse.wheel;
    this.mouse.wheel = 0;
    return w;
  }

  axis(name) {
    return this.enabled ? this.axesValues[name] || 0 : 0;
  }

  // Movement vector with length <= 1 (x = east/right, y = north/up on screen).
  move() {
    let x = this.axis('moveX');
    let y = this.axis('moveY');
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  down(name) {
    return this.enabled && !!this.buttons.get(name);
  }

  // True only on the frame the button went down.
  pressed(name) {
    return this.enabled && !!this.buttons.get(name) && !this.prevButtons.get(name);
  }

  released(name) {
    return this.enabled && !this.buttons.get(name) && !!this.prevButtons.get(name);
  }

  // Raw button state ignoring `enabled` (menus use this while gameplay input is disabled).
  rawPressed(name) {
    return !!this.buttons.get(name) && !this.prevButtons.get(name);
  }

  setVirtualAxis(name, value) {
    this.virtualAxes[name] = value;
    this.lastDevice = 'touch';
  }

  setVirtualButton(name, down) {
    this.virtualButtons[name] = !!down;
    this.lastDevice = 'touch';
  }

  // Gamepad rumble if supported. strength 0..1, duration ms.
  rumble(strength = 0.5, duration = 200) {
    const pad = this._pad();
    const act = pad && pad.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', { duration, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
    }
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) {
        if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.3)) this.lastDevice = 'gamepad';
        return p;
      }
    }
    return null;
  }
}
