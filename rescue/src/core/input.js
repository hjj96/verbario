// Unified input: keyboard, mouse, gamepad and virtual (touch) controls mapped to named actions.
// Systems read actions only — never raw keys. See BINDINGS for the action list.
import { clamp } from './math.js';

// Keyboard bindings use KeyboardEvent.code (layout independent, so ЙЦУКЕН works too).
export const BINDINGS = {
  // axes: [negativeKeys, positiveKeys]
  axes: {
    moveX: [['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']],
    moveY: [['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']], // +1 = screen up (north)
    lift: [['KeyF', 'ControlLeft', 'ControlRight'], ['KeyR', 'ShiftLeft', 'ShiftRight']], // +1 = climb
  },
  buttons: {
    winch: ['Space'],
    searchlight: ['KeyL'],
    flare: ['KeyG'],
    horn: ['KeyH'],
    map: ['KeyM', 'Tab'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter', 'NumpadEnter'],
    zoom: ['KeyZ'],
    debug: ['Backquote'],
  },
};

// Standard gamepad mapping.
const PAD = {
  axes: { moveX: 0, moveY: 1 },
  lift: { up: 7, down: 6 }, // RT climbs, LT descends
  buttons: { winch: [0], searchlight: [2], flare: [1], horn: [3], map: [8], pause: [9], confirm: [0], zoom: [5] },
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.prevButtons = new Map();
    this.buttons = new Map(); // action -> bool (this frame)
    this.axesValues = { moveX: 0, moveY: 0, lift: 0 };
    this.virtualAxes = {}; // set by touch UI
    this.virtualButtons = {}; // set by touch UI
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, wheel: 0, active: false };
    this.lastDevice = 'keyboard'; // 'keyboard' | 'gamepad' | 'touch'
    this.enabled = true;
    this.anyPressedThisFrame = false;

    this._onKeyDown = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouse.active = true;
    };
    this._onMouseDown = () => (this.mouse.down = true);
    this._onMouseUp = () => (this.mouse.down = false);
    this._onWheel = (e) => (this.mouse.wheel += Math.sign(e.deltaY));
    this._onTouch = () => (this.lastDevice = 'touch');

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
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
      if (neg.some((k) => this.keys.has(k))) v -= 1;
      if (pos.some((k) => this.keys.has(k))) v += 1;
      if (pad) {
        if (name === 'lift') {
          const up = pad.buttons[PAD.lift.up]?.value || 0;
          const down = pad.buttons[PAD.lift.down]?.value || 0;
          if (Math.abs(up - down) > 0.08) v = up - down;
        } else {
          let a = pad.axes[PAD.axes[name]] || 0;
          if (name === 'moveY') a = -a;
          if (Math.abs(a) > 0.15) v = a;
        }
      }
      const va = this.virtualAxes[name];
      if (va !== undefined && Math.abs(va) > 0.02) v = va;
      this.axesValues[name] = clamp(v, -1, 1);
    }

    for (const name of Object.keys(BINDINGS.buttons)) {
      let down = BINDINGS.buttons[name].some((k) => this.keys.has(k));
      if (pad && PAD.buttons[name]) down = down || PAD.buttons[name].some((i) => pad.buttons[i]?.pressed);
      if (this.virtualButtons[name]) down = true;
      this.prevButtons.set(name, this.buttons.get(name) || false);
      this.buttons.set(name, down);
      if (down && !this.prevButtons.get(name)) this.anyPressedThisFrame = true;
    }
    if (this.mouse.down) this.anyPressedThisFrame = this.anyPressedThisFrame || !prevAny;
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
