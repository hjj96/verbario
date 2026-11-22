'use strict';
/* ===== Общие утилиты: математика, цвета, сетка, канвасы ===== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const chance = p => Math.random() < p;
const pick = a => a[(Math.random() * a.length) | 0];
const d2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outQuad: t => 1 - (1 - t) * (1 - t),
  inQuad: t => t * t,
  outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

function weighted(list, wf) {
  let tot = 0;
  for (const it of list) tot += wf(it);
  let r = Math.random() * tot;
  for (const it of list) { r -= wf(it); if (r <= 0) return it; }
  return list[list.length - 1];
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function removeAt(arr, i) { const last = arr.pop(); if (i < arr.length) arr[i] = last; }

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}
function fmtNum(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'М';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + 'к';
  return String(n);
}
function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// детерминированный хеш для расстановки декора
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1013, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* ===== Цвета ===== */
const _rgbCache = {};
function hexToRgb(hex) {
  let c = _rgbCache[hex];
  if (c) return c;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  _rgbCache[hex] = c;
  return c;
}
function rgba(hex, a) { const c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = Math.round(lerp(A[0], B[0], t)), g = Math.round(lerp(A[1], B[1], t)), bl = Math.round(lerp(A[2], B[2], t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
function shade(hex, amt) { return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt); }
function hsl(h, s, l, a) { return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')'; }

/* ===== Пространственная сетка (фиксированная, привязана к игроку) ===== */
class Grid {
  constructor(cell, w, h) {
    this.cell = cell; this.w = w; this.h = h;
    this.cells = new Array(w * h);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.used = [];
    this.ox = 0; this.oy = 0;
  }
  reset(cx, cy) {
    for (let i = 0; i < this.used.length; i++) this.cells[this.used[i]].length = 0;
    this.used.length = 0;
    this.ox = Math.floor(cx / this.cell) - (this.w >> 1);
    this.oy = Math.floor(cy / this.cell) - (this.h >> 1);
  }
  insert(e) {
    const gx = Math.floor(e.x / this.cell) - this.ox, gy = Math.floor(e.y / this.cell) - this.oy;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return;
    const i = gy * this.w + gx;
    const c = this.cells[i];
    if (c.length === 0) this.used.push(i);
    c.push(e);
  }
  // вызывает fn(e) для всех объектов в ячейках, пересекающих квадрат вокруг (x,y,r)
  each(x, y, r, fn) {
    const c = this.cell;
    let x0 = Math.floor((x - r) / c) - this.ox, x1 = Math.floor((x + r) / c) - this.ox;
    let y0 = Math.floor((y - r) / c) - this.oy, y1 = Math.floor((y + r) / c) - this.oy;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= this.w) x1 = this.w - 1; if (y1 >= this.h) y1 = this.h - 1;
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * this.w;
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.cells[row + gx];
        for (let k = 0; k < cell.length; k++) if (fn(cell[k]) === true) return;
      }
    }
  }
}

/* ===== Хранилище с защитой ===== */
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* нет доступа */ } },
};

const URLP = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
const DEBUG = URLP.has('debug');
