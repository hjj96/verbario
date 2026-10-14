// Tiny DOM helpers for the HUD: element factory, "write only when changed" text/attribute setters and
// a throttle clock. The in-flight HUD writes DOM at ≤ 12 Hz and only when the string changed
// (DESIGN §7.3 «Реализация»); every setter here enforces the "only when changed" half.

// el('div.panel.dim', {text, html, attrs, style, on}, children)
export function el(spec, opts = {}, children = []) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const node = document.createElement(m[1] || 'div');
  const rest = m[2] || '';
  for (const part of rest.match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.attrs) for (const k of Object.keys(opts.attrs)) node.setAttribute(k, opts.attrs[k]);
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.on) for (const k of Object.keys(opts.on)) node.addEventListener(k, opts.on[k]);
  if (opts.parent) opts.parent.appendChild(node);
  for (const c of children) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

// Text slot that touches the DOM only when the value changes.
export class TextSlot {
  constructor(node) {
    this.node = node;
    this.v = undefined;
  }
  set(v) {
    if (v === this.v) return false;
    this.v = v;
    this.node.textContent = v;
    return true;
  }
}

// HTML slot (trusted markup built by the HUD itself).
export class HtmlSlot {
  constructor(node) {
    this.node = node;
    this.v = undefined;
  }
  set(v) {
    if (v === this.v) return false;
    this.v = v;
    this.node.innerHTML = v;
    return true;
  }
}

// Toggle a class only when it changes.
export function setClass(node, name, on) {
  if (!node) return;
  const has = node.classList.contains(name);
  if (on && !has) node.classList.add(name);
  else if (!on && has) node.classList.remove(name);
}

// Cached style property writer (transform/opacity per frame without redundant writes).
export class StyleSlot {
  constructor(node, prop) {
    this.node = node;
    this.prop = prop;
    this.v = undefined;
  }
  set(v) {
    if (v === this.v) return;
    this.v = v;
    this.node.style[this.prop] = v;
  }
}

// Fixed-rate gate: tick(dt) → true at most `hz` times per second.
export class Ticker {
  constructor(hz) {
    this.period = 1 / hz;
    this.acc = this.period; // fire on the first frame
  }
  tick(dt) {
    this.acc += dt;
    if (this.acc < this.period) return false;
    this.acc = this.acc % this.period;
    return true;
  }
  force() {
    this.acc = this.period;
  }
}

// HiDPI canvas helper: size the backing store to css × min(DPR, cap). Returns the scale used.
export function fitCanvas(canvas, cssW, cssH, cap = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, cap);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  return dpr;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
