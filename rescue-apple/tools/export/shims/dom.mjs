// Minimal browser globals so the game's modules can be imported and their pure logic run in Node 22.
// Nothing here renders: canvases return a recording 2D stub (enough for modules that measure or paint
// at construction), WebGL is absent, timers are inert. Math.random is replaced by a seeded mulberry32 so
// any accidental use is reproducible (seed: MAYDAY_RANDOM_SEED, default 20261016).

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedRandom(seed) {
  Math.random = mulberry32(seed >>> 0);
}

class Listeners {
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

function ctx2d(canvas) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy({
    canvas,
    measureText: (s) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  }, {
    get(t, k) { return k in t ? t[k] : noop; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

class Element extends Listeners {
  constructor(tag = 'div') {
    super();
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.childNodes = this.children;
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
    this.width = 300; this.height = 150;
    this.clientWidth = 1280; this.clientHeight = 720;
  }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  prepend(...c) { this.children.unshift(...c); }
  removeChild(c) { return c; }
  remove() {}
  replaceChildren() { this.children.length = 0; }
  insertBefore(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }; }
  getContext(type) { return type === '2d' ? (this._ctx ||= ctx2d(this)) : null; }
  toDataURL() { return 'data:,'; }
  focus() {} blur() {} click() {}
  animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  closest() { return null; }
  contains() { return false; }
}

export function installDom() {
  const g = globalThis;
  if (g.__maydayDom) return;
  g.__maydayDom = true;
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const body = new Element('body');
  const docEl = new Element('html');
  const document = Object.assign(new Listeners(), {
    body, documentElement: docEl, head: new Element('head'),
    hidden: false, visibilityState: 'visible', readyState: 'complete',
    createElement: (t) => new Element(t),
    createElementNS: (_ns, t) => new Element(t),
    createTextNode: (s) => ({ textContent: s }),
    createDocumentFragment: () => new Element('fragment'),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, add() {}, addEventListener() {} },
    activeElement: null,
    pointerLockElement: null,
    fullscreenElement: null,
    exitPointerLock() {}, exitFullscreen() { return Promise.resolve(); },
  });
  const matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const location = { search: '', hash: '', href: 'http://localhost:8765/rescue/index.html', pathname: '/rescue/index.html', origin: 'http://localhost:8765', host: 'localhost:8765', hostname: 'localhost', protocol: 'http:', reload() {} };
  const win = {
    document, localStorage, sessionStorage: localStorage, matchMedia, location,
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    getComputedStyle: () => new Proxy({}, { get: (t, k) => (k === 'getPropertyValue' ? () => '' : '') }),
    HTMLElement: Element, HTMLCanvasElement: Element, Element,
    Image: class extends Element { constructor() { super('img'); } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    scrollTo() {},
    AudioContext: undefined, webkitAudioContext: undefined, OfflineAudioContext: undefined,
    speechSynthesis: undefined,
    visualViewport: null,
  };
  for (const [k, v] of Object.entries(win)) {
    if (!(k in g) || g[k] === undefined) {
      try { Object.defineProperty(g, k, { value: v, writable: true, configurable: true }); } catch {}
    }
  }
  g.window = g;
  g.self = g;
  try {
    const nav = g.navigator;
    if (nav) {
      for (const [k, v] of Object.entries({ getGamepads: () => [], vibrate: () => false, maxTouchPoints: 0, hardwareConcurrency: 4, languages: ['ru-RU'], language: 'ru-RU' })) {
        if (!(k in nav)) Object.defineProperty(nav, k, { value: v, configurable: true });
      }
    }
  } catch {}
  g.CSS = g.CSS || { supports: () => false };
  g.ResizeObserver = g.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  g.IntersectionObserver = g.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
  g.OffscreenCanvas = g.OffscreenCanvas || class extends Element { constructor(w, h) { super('canvas'); this.width = w; this.height = h; } };
  g.Path2D = g.Path2D || class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} bezierCurveTo() {} quadraticCurveTo() {} };
}
