'use strict';
/* ===== Робот — низкополигональная CAD-модель: поворот на 360°, вид «во весь рост» или сверху ===== */

const VIEW_PITCH = { front: 0.42, top: 1.12 };
const VIEW_K = { front: 1.22, top: 1.5 };
const ZC = 21; // высота центра робота над землёй
const LIGHT = (() => { const v = [-0.42, -0.55, 0.72], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();

/* --- матрицы 3×4 --- */
function m3id() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; }
function m3mul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
    A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
    A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11],
  ];
}
const m3t = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const m3rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; };
const m3ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; };
const m3rz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; };
const m3s = (x, y, z) => [x, 0, 0, 0, 0, y === undefined ? x : y, 0, 0, 0, 0, z === undefined ? x : z, 0];
// курс θ — экранный угол движения (0 — вправо, π/2 — к зрителю). Локально: x — вправо, y — вперёд, z — вверх.
// Мир: X — восток, N — север (вверх по экрану), Z — высота.
const m3yaw = th => { const s = Math.sin(th), c = Math.cos(th); return [-s, c, 0, 0, -c, -s, 0, 0, 0, 0, 1, 0]; };

/* --- построитель сетки --- */
class Mesh {
  constructor() { this.V = []; this.F = []; this.O = []; this.st = []; this.M = m3id(); this.g = 'core'; this.side = 0; this.slot = null; this.rv = undefined; this.anchors = {}; this.pa = {}; this.zc = ZC; }
  push() { this.st.push(this.M); return this; }
  pop() { this.M = this.st.pop(); return this; }
  mul(B) { this.M = m3mul(this.M, B); return this; }
  t(x, y, z) { return this.mul(m3t(x, y, z)); }
  rx(a) { return a ? this.mul(m3rx(a)) : this; }
  ry(a) { return a ? this.mul(m3ry(a)) : this; }
  rz(a) { return a ? this.mul(m3rz(a)) : this; }
  sc(x, y, z) { return this.mul(m3s(x, y, z)); }
  P(x, y, z) { const M = this.M; return [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]; }
  D(x, y, z) { const M = this.M, v = [M[0] * x + M[1] * y + M[2] * z, M[4] * x + M[5] * y + M[6] * z, M[8] * x + M[9] * y + M[10] * z], l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  vx(x, y, z) { this.V.push(this.P(x, y, z)); return this.V.length - 1; }
  face(idx, tone, cx) {
    const V = this.V;
    let nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0;
    for (let i = 0; i < idx.length; i++) {
      const a = V[idx[i]], b = V[idx[(i + 1) % idx.length]];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      fx += a[0]; fy += a[1]; fz += a[2];
    }
    fx /= idx.length; fy /= idx.length; fz /= idx.length;
    if (nx * (fx - cx[0]) + ny * (fy - cx[1]) + nz * (fz - cx[2]) < 0) { idx.reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    const f = { v: idx, n: [nx / l, ny / l, nz / l], tone, g: this.g, side: this.side, slot: this.slot, rv: this.rv, dec: null, edges: null, cond: null, vis: false, d: 0 };
    if (l < 1e-6) f.n = [0, 0, -1];
    this.F.push(f);
    return f;
  }
  box(x0, y0, z0, x1, y1, z1, tone) {
    const v = [this.vx(x0, y0, z0), this.vx(x1, y0, z0), this.vx(x1, y1, z0), this.vx(x0, y1, z0), this.vx(x0, y0, z1), this.vx(x1, y0, z1), this.vx(x1, y1, z1), this.vx(x0, y1, z1)];
    const c = this.P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return [
      this.face([v[0], v[3], v[7], v[4]], tone, c), this.face([v[1], v[2], v[6], v[5]], tone, c),
      this.face([v[0], v[1], v[5], v[4]], tone, c), this.face([v[3], v[2], v[6], v[7]], tone, c),
      this.face([v[0], v[1], v[2], v[3]], tone, c), this.face([v[4], v[5], v[6], v[7]], tone, c),
    ];
  }
  // призма: многоугольник в плоскости, перпендикулярной оси, выдавленный от a0 до a1
  prism(poly, a0, a1, axis, tone) {
    const map = axis === 'z' ? (u, v, w) => [u, v, w] : axis === 'y' ? (u, v, w) => [u, w, v] : (u, v, w) => [w, u, v];
    const n = poly.length, b = [], t = [];
    let cu = 0, cv = 0;
    for (const p of poly) { cu += p[0]; cv += p[1]; b.push(this.vx(...map(p[0], p[1], a0))); t.push(this.vx(...map(p[0], p[1], a1))); }
    const c = this.P(...map(cu / n, cv / n, (a0 + a1) / 2));
    const res = { b: this.face(b.slice(), tone, c), t: this.face(t.slice(), tone, c), s: [] };
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; res.s.push(this.face([b[i], b[j], t[j], t[i]], tone, c)); }
    return res;
  }
  // тонкая двусторонняя пластина (перья, полотна, гребни): две грани вместо призмы — вдвое-втрое дешевле
  plate(poly, axis, w, tone) {
    const map = axis === 'z' ? (u, v, q) => [u, v, q] : axis === 'y' ? (u, v, q) => [u, q, v] : (u, v, q) => [q, u, v];
    const idx = poly.map(p => this.vx(...map(p[0], p[1], w)));
    let cu = 0, cv = 0; for (const p of poly) { cu += p[0]; cv += p[1]; }
    cu /= poly.length; cv /= poly.length;
    const a = this.P(...map(cu, cv, w - 1)), b = this.P(...map(cu, cv, w + 1));
    return [this.face(idx.slice(), tone, a), this.face(idx.slice(), tone, b)];
  }
  // цилиндр / усечённый конус вдоль локальной z
  cyl(r0, r1, z0, z1, n, tone, sharp) {
    if (z0 > z1) { let k = z0; z0 = z1; z1 = k; k = r0; r0 = r1; r1 = k; }
    const b = [], t = [];
    for (let i = 0; i < n; i++) { const a = i * TAU / n; b.push(this.vx(Math.cos(a) * r0, Math.sin(a) * r0, z0)); t.push(this.vx(Math.cos(a) * r1, Math.sin(a) * r1, z1)); }
    const c = this.P(0, 0, (z0 + z1) / 2);
    const res = { cap0: r0 > 0.01 ? this.face(b.slice(), tone, c) : null, cap1: r1 > 0.01 ? this.face(t.slice(), tone, c) : null, s: [] };
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; res.s.push(this.face([b[i], b[j], t[j], t[i]], tone, c)); }
    if (!sharp) for (let i = 0; i < n; i++) { const j = (i + 1) % n, f = res.s[i]; f.edges = [[b[i], b[j]], [t[j], t[i]]]; f.cond = [[b[j], t[j], res.s[j]], [t[i], b[i], res.s[(i + n - 1) % n]]]; }
    return res;
  }
  // ствол вдоль локальной +y
  barrel(r0, r1, y0, y1, n, tone, sharp) { this.push(); this.rx(-Math.PI / 2); const c = this.cyl(r0, r1, y0, y1, n, tone, sharp); this.pop(); return c; }
  dec(face, d) { d.g = this.g; d.side = this.side; d.slot = this.slot; if (face) (face.dec || (face.dec = [])).push(d); else this.O.push(d); return d; }
  line(face, x1, y1, z1, x2, y2, z2, col, w, a) { return this.dec(face, { k: 'line', a: this.P(x1, y1, z1), b: this.P(x2, y2, z2), col, w: w || 0.8, al: a === undefined ? 1 : a }); }
  glow(face, x, y, z, r, col, a) { return this.dec(face, { k: 'glow', p: this.P(x, y, z), r, col, al: a === undefined ? 1 : a }); }
  flame(x, y, z, dx, dy, dz, len, w, col) { return this.dec(null, { k: 'flame', p: this.P(x, y, z), q: this.P(x + dx * len, y + dy * len, z + dz * len), w, col, under: true }); }
  ring(x, y, z, r, ax, col, w, a, rot) {
    const pts = [], n = 28;
    for (let i = 0; i <= n; i++) {
      const u = i * TAU / n, cu = Math.cos(u) * r, su = Math.sin(u) * r;
      const p = ax === 'z' ? [cu, su, 0] : ax === 'y' ? [cu, 0, su] : [0, cu, su];
      pts.push(this.P(x + p[0], y + p[1], z + p[2]));
    }
    return this.dec(null, { k: 'ring', pts, col, w: w || 1, al: a === undefined ? 1 : a, c: this.P(x, y, z) });
  }
  anchor(name, x, y, z, dx, dy, dz) { this.anchors[name] = { p: this.P(x, y, z), d: this.D(dx, dy, dz) }; }
  mark(part, x, y, z) { this.pa[part] = this.P(x, y, z); }
}

/* --- проекция --- */
function projW(p, view) {
  const f = VIEW_PITCH[view] || VIEW_PITCH.front, sp = Math.sin(f), cp = Math.cos(f);
  return { x: p[0], y: -p[1] * sp - (p[2] - ZC) * cp };
}

/* --- отрисовка: стекло граней + светящиеся рёбра --- */
let _SX = new Float32Array(2048), _SY = new Float32Array(2048), _SD = new Float32Array(2048);
function renderMesh(c, m, pal, view, o) {
  const phi = VIEW_PITCH[view] || VIEW_PITCH.front, sp = Math.sin(phi), cp = Math.cos(phi), zc = m.zc, V = m.V, n = V.length;
  if (_SX.length < n) { _SX = new Float32Array(n * 2); _SY = new Float32Array(n * 2); _SD = new Float32Array(n * 2); }
  for (let i = 0; i < n; i++) { const v = V[i]; _SX[i] = v[0]; _SY[i] = -v[1] * sp - (v[2] - zc) * cp; _SD[i] = -v[1] * cp + v[2] * sp; }
  const T = c.getTransform(), kk = (typeof VIEW !== 'undefined' && VIEW.dpr ? VIEW.dpr : 1) / Math.max(0.02, Math.hypot(T.a, T.b));
  const ppu = 1 / kk, lw = clamp(0.5 + ppu * 0.2, 0.75, 1.4) * kk, dw = lw / 1.3;
  const pass = f => {
    if (o.onlyMounts && !f.slot) return false;
    if (o.only) { if (f.g !== o.only) return false; if (o.armSide && f.side !== o.armSide) return false; }
    if (o.skip && f.g === o.skip) return false;
    if (o.skipArmSide && f.g === 'arms' && f.side === o.skipArmSide) return false;
    return true;
  };
  const vis = [];
  for (const f of m.F) {
    f.vis = false;
    if (!pass(f)) continue;
    if (-f.n[1] * cp + f.n[2] * sp <= 0.0005) continue;
    f.vis = true;
    let d = 0; for (const i of f.v) d += _SD[i];
    f.d = d / f.v.length;
    vis.push(f);
  }
  vis.sort((a, b) => a.d - b.d);
  const prj = p => [p[0], -p[1] * sp - (p[2] - zc) * cp];
  const cdep = (m.lift || 0) * sp + zc * sp;
  const under = [], over = [];
  for (const d of m.O) { if (!pass(d)) continue; const ref = d.c || d.p || d.a; const dep = ref ? -ref[1] * cp + ref[2] * sp : 0; if (d.under || (d.k === 'ring' || d.auto) && dep < cdep) under.push(d); else over.push(d); }
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (o.flat) {
    c.fillStyle = o.flat; c.strokeStyle = o.flat; c.lineWidth = lw * 1.6;
    for (const f of vis) {
      const v = f.v;
      c.beginPath(); c.moveTo(_SX[v[0]], _SY[v[0]]);
      for (let i = 1; i < v.length; i++) c.lineTo(_SX[v[i]], _SY[v[i]]);
      c.closePath(); c.fill(); c.stroke();
    }
    return;
  }
  const dd = d => (o.highlight && d.g !== o.highlight ? 0.2 : 1);
  for (const d of under) drawDec(c, d, prj, dw, dd(d));
  for (const f of vis) {
    const rv = f.rv !== undefined ? f.rv : RS.reveal;
    const fa = rv >= 1 ? 1 : clamp((rv - 0.6) / 0.4, 0, 1);
    const dim = o.highlight && f.g !== o.highlight ? 0.2 : 1;
    const v = f.v;
    c.beginPath(); c.moveTo(_SX[v[0]], _SY[v[0]]);
    for (let i = 1; i < v.length; i++) c.lineTo(_SX[v[i]], _SY[v[i]]);
    c.closePath();
    if (fa > 0) {
      const sh = clamp(f.n[0] * LIGHT[0] + f.n[1] * LIGHT[1] + f.n[2] * LIGHT[2], 0, 1);
      if (fa === 1 && dim === 1) c.fillStyle = (pal.FS[f.tone] || pal.FS.m)[(sh * 15 + 0.5) | 0];
      else {
        const q = 0.15 + 0.85 * sh, tn = pal.T[f.tone] || pal.T.m, a0 = tn[0], a1 = tn[1];
        c.fillStyle = 'rgba(' + ((a0[0] + (a1[0] - a0[0]) * q) | 0) + ',' + ((a0[1] + (a1[1] - a0[1]) * q) | 0) + ',' + ((a0[2] + (a1[2] - a0[2]) * q) | 0) + ',' + (tn[2] * fa * dim).toFixed(3) + ')';
      }
      c.fill();
    }
    c.strokeStyle = f.tone === 'a' ? pal.ag : (f.tone === 'd' || f.tone === 'r') ? pal.ls : pal.ln;
    c.lineWidth = lw;
    if (dim < 1) c.globalAlpha = dim;
    if (rv < 1) c.setLineDash([Math.max(0.001, rv) * 46 * kk, 46 * kk]);
    if (f.edges) {
      c.beginPath();
      for (const e of f.edges) { c.moveTo(_SX[e[0]], _SY[e[0]]); c.lineTo(_SX[e[1]], _SY[e[1]]); }
      for (const e of f.cond) if (!e[2].vis) { c.moveTo(_SX[e[0]], _SY[e[0]]); c.lineTo(_SX[e[1]], _SY[e[1]]); }
      c.stroke();
    } else c.stroke();
    if (rv < 1) c.setLineDash([]);
    if (f.dec && fa > 0.25) for (const d of f.dec) if (d.k !== 'line' || ppu > 1.1) drawDec(c, d, prj, dw, dim * fa);
    if (dim < 1) c.globalAlpha = 1;
  }
  for (const d of over) drawDec(c, d, prj, dw, dd(d));
}
function drawDec(c, d, prj, kk, al) {
  if (d.k === 'glow') { const p = prj(d.p); glow(c, p[0], p[1], d.r, d.col, d.al * al); return; }
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= (d.al === undefined ? 1 : d.al) * al;
  if (d.k === 'line') {
    const a = prj(d.a), b = prj(d.b);
    c.strokeStyle = d.col; c.lineWidth = d.w * 1.3 * kk;
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
  } else if (d.k === 'ring') {
    c.strokeStyle = d.col; c.lineWidth = d.w * 1.3 * kk;
    c.beginPath();
    for (let i = 0; i < d.pts.length; i++) { const p = prj(d.pts[i]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
    c.stroke();
  } else if (d.k === 'flame') {
    const a = prj(d.p), b = prj(d.q), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * d.w, ny = dx / l * d.w;
    const g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, rgba(d.col, 0.85)); g.addColorStop(1, rgba(d.col, 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(a[0] + nx, a[1] + ny); c.quadraticCurveTo(b[0] + dx * 0.3, b[1] + dy * 0.3, a[0] - nx, a[1] - ny); c.closePath(); c.fill();
    c.restore();
    glow(c, a[0], a[1], d.w * 2.2, d.col, 0.6 * al);
    return;
  } else if (d.k === 'cone') {
    const a = prj(d.p), b = prj(d.q), cc = prj(d.r2);
    const g = c.createLinearGradient(a[0], a[1], (b[0] + cc[0]) / 2, (b[1] + cc[1]) / 2);
    g.addColorStop(0, rgba(d.col, 0.2)); g.addColorStop(1, rgba(d.col, 0));
    c.fillStyle = g; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(cc[0], cc[1]); c.closePath(); c.fill();
  }
  c.restore();
}

/* ===== Модель ===== */
function buildRobot(L, ps) {
  const m = new Mesh(), ly = robotLayout(L);
  const lift = ly.hover ? 4.5 + (ps.static ? 0 : Math.sin(ps.t * 3.2) * 1.3) : (ps.static ? 0 : Math.abs(Math.sin(ps.wp)) * 0.8 * ps.mv);
  m.lift = lift;
  if (ps.squash) m.sc(1 + ps.squash * 0.1, 1 + ps.squash * 0.1, 1 - ps.squash * 0.18);
  m.push(); m.mul(m3yaw(ps.yawL)); m.t(0, 0, lift); m.g = 'legs'; buildLegs3(m, L, ly, ps); m.pop();
  m.push(); m.mul(m3yaw(ps.yawU)); m.t(0, 0, lift);
  m.g = 'back'; buildBack3(m, L, ly, ps);
  m.g = 'core'; buildCore3(m, L, ly, ps);
  m.g = 'head'; buildHead3(m, L, ly, ps);
  m.g = 'arms'; buildArms3(m, L, ly, ps);
  buildMounts3(m, L, ly, ps);
  m.g = 'core'; buildTrim3(m, L, ly, ps);
  m.pop();
  return m;
}

/* ----- шасси ----- */
function buildLegs3(m, L, ly, ps) {
  const p = L.parts.legs, r = p.rank, br = p.branch, tw = ly.tw, pal = L.pal;
  m.mark('legs', 0, 2, 8);
  if (r >= 3 && br === 'A') {
    const len = 31 + (r - 3) * 1.5, h = len / 2;
    m.box(-tw + 2.5, -7.5, 8, tw - 2.5, 7.5, 13.5, 'd');
    m.box(-tw * 0.5, -4.2, 12.5, tw * 0.5, 4.2, 16.5, 'd');
    for (const s of [-1, 1]) {
      m.side = s;
      const xc = s * (tw - 0.5), x0 = xc - 3.8, x1 = xc + 3.8;
      const fs = m.box(x0, -h, 0, x1, h, 10, 'r');
      const off = (((ps.dist || 0) * 0.35) % 3.6 + 3.6) % 3.6;
      for (let y = -h + 1.6 + off; y < h - 1; y += 3.6) {
        m.line(fs[5], x0 + 0.4, y, 10.02, x1 - 0.4, y, 10.02, pal.ls, 0.7, 0.8);
        m.line(s > 0 ? fs[1] : fs[0], xc + s * 3.82, y, 1.2, xc + s * 3.82, y, 8.8, pal.ls, 0.6, 0.7);
      }
      for (const y of [-h + 5, 0, h - 5]) { m.push(); m.t(xc + s * 3.8, y, 5); m.ry(s * Math.PI / 2); const wh = m.cyl(4, 4, 0, 1.1, 8, 'm'); if (wh.cap1) m.glow(wh.cap1, 0, 0, 1.15, 1.5, pal.a, 0.9); m.pop(); }
      if (r >= 4) { const sk = m.box(xc + s * 4.1 - 0.7, -h + 2, 4.5, xc + s * 4.1 + 0.7, h - 2, 11.5, 'l'); m.line(s > 0 ? sk[1] : sk[0], xc + s * 4.82, -h + 3, 8.5, xc + s * 4.82, h - 3, 8.5, pal.a, 1, 0.9); }
    }
    m.side = 0;
    if (r >= 5) {
      const pf = m.prism([[h, 0], [h + 6.5, 0.6], [h + 4.5, 9], [h, 10]], -tw - 3.5, tw + 3.5, 'x', 'l');
      for (let x = -tw - 2; x < tw + 2; x += 3) m.line(pf.s[1], x, h + 6.3, 1.3, x + 2, h + 4.75, 8, '#ffd23f', 1.5, 0.9);
      for (const x of [-tw, 0, tw]) { m.push(); m.t(x, h + 6.4, 1.6); m.rx(-Math.PI / 2); m.cyl(1.4, 0.05, 0, 3.4, 4, 'l', true); m.pop(); }
    }
    return;
  }
  m.box(-tw * 0.5, -4.2, 12.5, tw * 0.5, 4.2, 16.5, 'd');
  if (r >= 3 && br === 'B') {
    const col = r >= 5 ? '#b38bff' : pal.a, od = L.od || 0;
    for (const s of [-1, 1]) {
      m.side = s;
      m.push(); m.t(s * 5.4, 0, 14.5); m.rx(-0.18 * ps.mv);
      if (r >= 5) { m.cyl(2.6, 2.6, -5, 0, 6, 'm'); m.cyl(2.4, 2.9, -10.6, -6.4, 6, 'l'); m.cyl(2.9, 3.8, -13.4, -11.6, 8, 'd'); }
      else { m.cyl(2.6, 2.5, -6, 0, 6, 'm'); m.cyl(2.4, 3.1, -11.4, -6, 6, 'l'); m.cyl(3.1, 3.9, -13.6, -11.4, 8, 'd'); }
      const fl = 6 + ps.mv * 7 + (ps.static ? 0 : Math.sin(ps.t * 31 + s * 2) * 1.2) + od * 4;
      m.flame(0, 0, -13.6, 0, 0, -1, fl, 3.2, col);
      if (r === 4) { m.push(); m.t(s * 2.8, 0, -3.5); m.ry(s * 1.0); m.cyl(1.2, 1.8, -3, 0, 6, 'd'); m.flame(0, 0, -3, 0, 0, -1, 3 + ps.mv * 3, 1.6, col); m.pop(); }
      m.pop();
    }
    m.side = 0;
    if (r >= 5) for (let k = 0; k < 2; k++) { const ph = ((ps.t || 0) * 1.4 + k * 0.5) % 1; const rg = m.ring(0, 0, 0.6, 10 + ph * 9, 'z', col, 1.2, (1 - ph) * 0.7); rg.under = true; }
    return;
  }
  // шагающие ноги
  const th = [2.2, 2.6, 2.8][r], sh = [1.9, 2.3, 2.5][r], fl = [7.5, 9, 10.5][r], fw = [2.3, 2.7, 3][r];
  for (const s of [-1, 1]) {
    m.side = s;
    const ph = (ps.wp || 0) + (s > 0 ? 0 : Math.PI);
    const a1 = Math.sin(ph) * 0.55 * ps.mv, a2 = 0.08 + Math.max(0, -Math.cos(ph)) * 0.75 * ps.mv;
    m.push(); m.t(s * 5.2, 0, 14.5); m.rx(a1);
    m.cyl(th, th * 0.92, -6.6, 0, 6, 'm');
    if (r >= 2) m.box(-th - 0.4, th - 0.3, -6, th + 0.4, th + 0.9, -1.2, 'l');
    m.t(0, 0, -6.6);
    if (r >= 1) { m.push(); m.ry(Math.PI / 2); const k = m.cyl(2.5, 2.5, -1.9, 1.9, 8, 'd'); if (k.cap1 && s > 0) m.glow(k.cap1, 0, 0, 1.95, 1.3, pal.a, 0.9); if (k.cap0 && s < 0) m.glow(k.cap0, 0, 0, -1.95, 1.3, pal.a, 0.9); m.pop(); }
    m.rx(-a2);
    m.cyl(sh, sh * 0.85, -6.2, 0, 6, 'l');
    if (r >= 2) { m.push(); m.t(s * (sh + 0.9), -0.5, -3.1); m.cyl(0.55, 0.55, -2.8, 2.8, 4, 'd'); m.pop(); }
    m.t(0, 0, -6.2);
    m.rx(a2 - a1);
    m.box(-fw, -2.6, -1.8, fw, fl - 2.6, 0.1, 'd');
    if (r >= 2) m.box(-fw + 0.4, fl - 3.3, -1.5, fw - 0.4, fl - 2.3, -0.2, 'a');
    m.pop();
  }
  m.side = 0;
}

/* ----- ядро (торс) ----- */
function buildCore3(m, L, ly, ps) {
  const p = L.parts.core, r = p.rank, br = p.branch, tw = ly.tw, od = L.od || 0, pal = L.pal;
  const z0 = 16.5, z1 = 33;
  let cy = 5.6, cz = 26.5, rr = [2.5, 3, 3.6][Math.min(r, 2)], rc = pal.a, front = null;
  if (r >= 3 && br === 'A') {
    const f = m.prism([[-tw, z1], [tw, z1], [tw + 1.3, z1 - 7], [tw * 0.74, z0], [-tw * 0.74, z0], [-tw - 1.3, z1 - 7]], -6, 6, 'y', 'm');
    front = f.t;
    const off = od * 1.8;
    if (od > 0) m.glow(front, 0, 6.05, (z0 + z1) / 2, 12, OD_COLOR, od);
    for (const s of [-1, 1]) {
      m.side = s;
      m.prism([[s * (1.2 + off), z1 - 2.5], [s * (tw - 1.6 + off), z1 - 2.5], [s * (tw - 0.6 + off), z1 - 9], [s * (tw * 0.56 + off), z0 + 3], [s * (1.2 + off), z0 + 3]], 6, 7.4, 'y', 'l');
      m.push(); m.t(s * (tw + 0.6), 0, z1 - 2.5);
      const e = r - 3;
      m.prism([[-6.5 - e, 0], [6.5 + e, 0], [5 + e, 3.6 + e * 0.4], [0, 4.8 + e * 0.6], [-5 - e, 3.6 + e * 0.4]], -6, 6, 'y', 'l');
      m.box(-6, 5.9, 0.3, 6, 6.4, 1, r >= 5 ? 'a' : 'd');
      if (r >= 4) for (const k of [-1, 0, 1]) { m.push(); m.t(k * 3.2, 0, 4.4 + e * 0.5 - Math.abs(k) * 0.9); m.cyl(1.2, 0.05, 0, 3.6, 4, 'l', true); m.pop(); }
      m.pop();
    }
    m.side = 0;
    rr = 3.1; cy = 7.4;
    if (r >= 5) {
      m.push(); m.t(0, 7.3, (z0 + z1) / 2); m.rx(-Math.PI / 2);
      const hx = m.cyl(5.2, 5.2, 0, 1, 6, 'd', true);
      if (hx.cap1) for (let i = 0; i < 6; i++) { const a = i * TAU / 6, b = a + TAU / 6; m.line(hx.cap1, Math.cos(a) * 5.2, Math.sin(a) * 5.2, 1.02, Math.cos(b) * 5.2, Math.sin(b) * 5.2, 1.02, pal.t, 1.1); }
      m.pop();
      rc = pal.t; rr = 2.4; cz = (z0 + z1) / 2; cy = 8.4;
    }
  } else if (r >= 3 && br === 'B') {
    const f = m.prism([[-tw - 1, z1], [tw + 1, z1], [tw * 0.62, z0], [-tw * 0.62, z0]], -5.2, 5.2, 'y', 'm');
    front = f.t;
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) m.line(front, s * 4.6, 5.25, z0 + 4 + k * 2.6, s * (tw * 0.74 - k * 1.2), 5.25, z0 + 5.5 + k * 2.9, pal.ls, 0.7, 0.8);
    rr = 4.6 + (r - 3) * 1.1; rc = '#ff7a35'; cz = 25.5; cy = 5.3;
    if (r >= 4) for (const s of [-1, 1]) { m.line(front, s * rr * 0.9, 5.3, cz + rr * 0.4, s * (tw - 0.5), 5.3, z1 - 1, '#ffb36b', 1.1); m.line(front, s * rr * 0.5, 5.3, cz - rr * 0.8, s * tw * 0.55, 5.3, z0 + 1, '#ffb36b', 0.9); }
    if (r >= 5) {
      for (let i = 0; i < 3; i++) { const a = (ps.t || 0) * 3 + i * TAU / 3; const g = m.glow(null, Math.cos(a) * (rr + 3.6), cy + 2 + Math.sin(a) * 2.5, cz + Math.sin(a) * (rr + 3.6) * 0.6, 2.2, '#ffd36b', 0.75); g.auto = true; }
      const fl = Math.sin((ps.t || 0) * 9) * 0.8;
      m.flame(0, cy + 1, cz + rr + 0.5, 0, 0.15, 1, 8 + fl, 3, '#ffb36b').under = false;
    }
  } else {
    if (r === 0) front = m.box(-tw, -5.5, z0, tw, 5.5, z1, 'm')[3];
    else front = m.prism([[-tw, z1], [tw, z1], [tw * 0.8, z0], [-tw * 0.8, z0]], -5.5, 5.5, 'y', 'm').t;
    if (r >= 1) { const pl = m.box(-tw * 0.62, 5.5, z1 - 11, tw * 0.62, 6.6, z1 - 1.5, 'l'); m.glow(pl[3], -tw * 0.5, 6.62, z1 - 2.6, 0.9, pal.a, 0.9); m.glow(pl[3], tw * 0.5, 6.62, z1 - 2.6, 0.9, pal.a, 0.9); cy = 6.6; }
    if (r >= 2) for (let k = 0; k < 3; k++) m.line(front, -tw * 0.85, 5.55, z0 + 2 + k * 1.6, -tw * 0.62, 5.55, z0 + 2 + k * 1.6, pal.ls, 0.8, 0.8);
  }
  // реактор
  m.push(); m.t(0, cy, cz); m.rx(-Math.PI / 2);
  const ch = m.cyl(rr + 1.3, rr + 1.3, -0.4, 1, 10, 'd');
  const pulse = 0.75 + Math.sin((ps.t || 0) * 4.2) * 0.25 + od * 0.4;
  if (ch.cap1) { m.glow(ch.cap1, 0, 0, 1.05, rr * 1.1, '#ffffff', 0.9); m.glow(ch.cap1, 0, 0, 1.05, rr * 2.4 + od * 6, rc, 0.5 * pulse); }
  m.pop();
  m.mark('core', 0, 6, 24);
  m.coreFront = front;
}

/* ----- сенсоры (голова) ----- */
function buildHead3(m, L, ly, ps) {
  const p = L.parts.head, r = p.rank, br = p.branch, pal = L.pal, od = L.od || 0, t = ps.t || 0;
  const z0 = 34;
  m.cyl(2.4, 2.4, 32.6, 34.6, 6, 'd');
  m.mark('head', 0, 5, z0 + 5);
  if (r >= 3 && br === 'A') {
    const col = od > 0.5 ? '#ffffff' : '#ff4d5e';
    const hp = m.prism([[0, 7.2], [-6.6, 3], [-6, -5], [6, -5], [6.6, 3]], z0, z0 + 10.5, 'z', 'd');
    m.glow(hp.s[0], -2.9, 5.6, z0 + 5.6, 3.6, col, 0.9); m.glow(hp.s[0], -2.9, 5.6, z0 + 5.6, 0.9, '#ffffff', 1);
    m.glow(hp.s[4], 2.9, 5.6, z0 + 5.6, 3.6, col, 0.9); m.glow(hp.s[4], 2.9, 5.6, z0 + 5.6, 0.9, '#ffffff', 1);
    m.glow(hp.s[4], 0.2, 7.1, z0 + 6.4, 3.2, col, 0.8);
    if (r >= 4) {
      for (const s of [-1, 1]) { m.push(); m.t(s * 4.2, -1.5, z0 + 9.8); m.rx(-0.95); m.ry(s * 0.35); m.cyl(1.1, 0.05, 0, 8, 4, 'l', true); m.pop(); }
      const rg = m.ring(0, 15, z0 + 5, 3.4, 'y', col, 0.9, 0.7); rg.auto = true;
    }
    if (r >= 5) { const rg = m.ring(0, 0, z0 + 14, 8.5, 'z', col, 1, 0.65); rg.auto = true; for (let k = 0; k < 6; k++) { const a = t * 0.6 + k * TAU / 6; const g = m.glow(null, Math.cos(a) * 8.5, Math.sin(a) * 8.5, z0 + 14, 1.4, col, 0.9); g.auto = true; } }
    return;
  }
  if (r >= 3 && br === 'B') {
    const col = '#5dff9b';
    m.cyl(6.8, 4.4, z0, z0 + 8, 8, 'm');
    m.cyl(4.4, 2.6, z0 + 8, z0 + 10, 8, 'l');
    const lens = m.box(-2.8, 4.6, z0 + 2.6, 2.8, 7, z0 + 6.6, 'd');
    m.glow(lens[3], 0, 7.05, z0 + 4.6, r >= 5 ? 9 : 5.5, col, 0.85); m.glow(lens[3], 0, 7.05, z0 + 4.6, 1.6, '#ffffff', 1);
    m.push(); m.t(0, -0.5, z0 + 10); m.rz(t * 2.2); m.cyl(0.5, 0.5, 0, 3, 4, 'd', true); m.t(0, 0, 3.2); m.rx(1.05); m.cyl(5.2, 5.2, -0.3, 0.3, 12, 'l'); m.pop();
    if (r >= 4) { m.push(); m.t(-5, -2, z0 + 7); m.rz(-t * 3); m.rx(0.9); m.cyl(2.8, 2.8, -0.25, 0.25, 10, 'l'); m.pop(); m.push(); m.t(5, -2, z0 + 8); m.cyl(0.45, 0.35, 0, 9, 4, 'l', true); m.pop(); if (Math.sin(t * 6) > 0) { const g = m.glow(null, 5, -2, z0 + 17.3, 3.2, col, 1); g.auto = true; } }
    if (r >= 5) { const sw = Math.sin(t * 1.5) * 0.5; m.dec(null, { k: 'cone', p: m.P(0, 7, z0 + 4.6), q: m.P(-14 + sw * 20, 46, z0 + 2), r2: m.P(14 + sw * 20, 46, z0 + 2), col, auto: true }); }
    return;
  }
  let hb;
  if (r === 0) hb = m.box(-6, -5, z0, 6, 5, z0 + 10, 'm');
  else { const oc = []; for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + TAU / 16; oc.push([Math.cos(a) * 6.6, Math.sin(a) * 6.6]); } hb = m.prism(oc, z0, z0 + 10.5, 'z', 'm'); }
  const vy = r === 0 ? 5 : 6.1;
  const vb = m.box(-4.4, vy - 0.4, z0 + 4, 4.4, vy + 0.9, z0 + (r === 0 ? 6.2 : 6.9), 'a');
  m.glow(vb[3], 0, vy + 0.95, z0 + 5.3, 6.5, pal.e, 0.7);
  m.line(vb[3], -3.6, vy + 0.95, z0 + 5.3, 3.6, vy + 0.95, z0 + 5.3, pal.e, 1.4, 1);
  if (r >= 1) for (const s of [-1, 1]) { m.push(); m.t(s * 6.6, 0, z0 + 5); m.ry(Math.PI / 2); m.cyl(1.4, 1.4, s > 0 ? 0 : -1, s > 0 ? 1 : 0, 8, 'd'); m.pop(); }
  if (r >= 2) {
    m.push(); m.t(3.6, -1.5, z0 + 10); m.rx(-0.25); m.ry(0.3); m.cyl(0.5, 0.35, 0, 7.5, 4, 'l', true); m.pop();
    const tip = m.glow(null, 5.6, -3.4, z0 + 17.2, 3.2, pal.a, Math.sin(t * 5) > 0 ? 1 : 0.35); tip.auto = true;
    for (const s of [-1, 1]) m.box(s * 6.9 - 1.1, -2.4, z0 + 2.5, s * 6.9 + 1.1, 2.4, z0 + 7.5, 'd');
  }
}

/* ----- руки ----- */
function buildArms3(m, L, ly, ps) {
  const p = L.parts.arms, r = p.rank, br = p.branch, tw = ly.tw, pal = L.pal;
  m.mark('arms', tw + 3, 0, 23);
  for (const s of [-1, 1]) {
    m.side = s;
    const slot = s > 0 ? 'armR' : 'armL';
    const w = ps.mounts ? ps.mounts.find(x => x.slot === slot && !x.hidden) : null;
    const A = w && w.anim ? w.anim : null;
    const walk = ps.static ? 0 : Math.sin((ps.wp || 0) + (s > 0 ? Math.PI : 0)) * 0.35 * ps.mv;
    let pitch = 0.16 + walk, yawR = 0;
    if (w && ps.armed) { pitch = 1.32 - (A ? A.fire * 0.14 : 0); yawR = -s * 0.07; }
    if (A && A.swing > 0) { const q = 1 - A.swing; pitch = 1.3; yawR = s * (1.0 - q * 2.0); }
    m.push(); m.t(s * (tw + 1.7), 0, 30); m.mark(s > 0 ? 'jR' : 'jL', 0, 0, 0); m.rz(yawR); m.rx(pitch);
    { m.push(); m.ry(Math.PI / 2); const jr = r >= 3 ? 3.4 : 2.8; const j = m.cyl(jr, jr, -1.8, 1.8, 8, 'd'); if (s > 0 && j.cap1) m.glow(j.cap1, 0, 0, 1.85, 1, pal.a, 0.9); if (s < 0 && j.cap0) m.glow(j.cap0, 0, 0, -1.85, 1, pal.a, 0.9); m.pop(); }
    let tipZ;
    if (r >= 3 && br === 'A') {
      m.cyl(3.2, 3, -7.5, 0, 8, 'm');
      const can = (x, rad, len) => {
        m.push(); m.t(x, 0, 0);
        m.cyl(rad, rad, -7 - len, -6.5, 10, 'l');
        const mz = m.cyl(rad * 1.15, rad * 0.9, -9 - len, -7 - len, 10, 'd');
        if (mz.cap0) m.glow(mz.cap0, 0, 0, -9.05 - len, rad * 1.3, pal.a, 0.6 + (A ? A.fire * 0.4 : 0) + (ps.siege ? 0.4 : 0));
        m.pop();
      };
      if (r === 3) { can(0, 4.3, 14); tipZ = -23; }
      else if (r === 4) { can(-2.6, 2.9, 15); can(2.8, 2.9, 16.5); m.cyl(5.8, 5.8, -14, -12.5, 10, 'd'); tipZ = -25; }
      else { can(0, 5.6, 17); for (let k = 0; k < 3; k++) m.cyl(6.6, 6.6, -12 - k * 4, -10.8 - k * 4, 12, 'a'); tipZ = -26; }
    } else if (r >= 3 && br === 'B') {
      m.cyl(2.8, 2.6, -8, 0, 8, 'm');
      m.cyl(4, 4, -12, -8, 10, 'd');
      const n = r === 3 ? 3 : r === 4 ? 6 : 4, len = r === 5 ? 14 : 11;
      const spin = (ps.t || 0) * (A && A.fire > 0.1 ? 40 : 5);
      for (let i = 0; i < n; i++) { const a = spin + i * TAU / n; m.push(); m.t(Math.cos(a) * 2.3, Math.sin(a) * 2.3, 0); m.cyl(0.75, 0.75, -12 - len, -12, 4, 'l'); m.pop(); }
      m.cyl(3, 3, -12 - len + 0.6, -12 - len + 1.6, 8, 'd');
      if (r >= 5) { const g = m.glow(null, 0, 0, -12 - len, 4, '#ff7a35', 0.8); g.auto = true; }
      tipZ = -12 - len;
    } else {
      const w1 = [2, 2.5, 2.6][r], w2 = [1.9, 2.5, 2.8][r];
      m.cyl(w1, w1 * 0.95, -9.5, 0, 6, 'm');
      m.t(0, 0, -9.5);
      if (r >= 1) { m.push(); m.ry(Math.PI / 2); m.cyl(2.4, 2.4, -1.6, 1.6, 8, 'd'); m.pop(); }
      m.rx(w && ps.armed ? 0.04 : 0.32);
      m.cyl(w2, w2 * 0.9, -8.5, 0, 6, r >= 1 ? 'l' : 'm');
      if (r >= 2) m.plate([[0, -1.5], [0, -6.5], [s * 3.4, -5]], 'y', 0, 'a');
      if (!w) {
        if (r === 0) for (const k of [-1, 1]) { m.push(); m.t(k * 0.9, 0, -8.5); m.cyl(0.7, 0.05, -3, 0, 4, 'd', true); m.pop(); }
        else m.box(-2.6, -2, -11.8, 2.6, 2, -8.4, 'd');
      }
      tipZ = -8.6;
    }
    if (w) {
      m.push(); m.t(0, 0, tipZ); m.rx(-Math.PI / 2);
      m.slot = slot; m.rv = w.reveal;
      buildModule3(m, w, pal, ps);
      m.slot = null; m.rv = undefined;
      m.pop();
    } else m.anchor(slot, 0, 0, tipZ, 0, 0, -1);
    m.pop();
  }
  m.side = 0;
}

/* ----- генератор (спина) ----- */
function buildBack3(m, L, ly, ps) {
  const p = L.parts.back, r = p.rank, br = p.branch, tw = ly.tw, pal = L.pal, t = ps.t || 0;
  m.mark('back', 0, -10, 28);
  const pack = m.box(-7.5, -10.2, 21, 7.5, -5.5, 32, 'd');
  if (r === 0) { const a = t * 9; m.line(pack[2], -2.6 * Math.cos(a), -10.22, 26.5 - 2.6 * Math.sin(a), 2.6 * Math.cos(a), -10.22, 26.5 + 2.6 * Math.sin(a), pal.a, 1, 0.9); m.glow(pack[2], 0, -10.22, 26.5, 3, pal.a, 0.6); }
  if (r >= 1 && r < 3) for (let i = 0; i < 3; i++) m.box(-4.8 + i * 4.8 - 0.4, -9.6, 32, -4.8 + i * 4.8 + 0.4, -6, 36, 'm');
  if (r >= 2) for (const s of [-1, 1]) {
    m.push(); m.t(s * (tw - 2.5), -8.2, 24);
    m.cyl(2.4, 2.4, 0, 14.5, 8, 'm');
    m.cyl(2.65, 2.65, 4, 5.2, 8, 'a'); m.cyl(2.65, 2.65, 8.6, 9.8, 8, 'a');
    m.pop();
  }
  if (r >= 3 && br === 'A') buildWings3(m, L, ly, ps, r);
  if (r >= 3 && br === 'B') buildHalo3(m, L, ly, ps, r);
}
function buildWings3(m, L, ly, ps, r) {
  const pal = L.pal, tw = ly.tw, od = L.od || 0, t = ps.t || 0;
  const rows = r === 5 ? 3 : 1, feathers = r === 3 ? 3 : 5;
  const flap = (ps.static ? 0 : Math.sin(t * (od > 0.5 ? 7 : 2.3))) * 0.12;
  for (const s of [-1, 1]) for (let w = 0; w < rows; w++) {
    const e = 0.42 + w * 0.36 + flap * (1 + w * 0.5) + od * 0.12, len = (28 - w * 5) * (r >= 4 ? 1.08 : 1);
    m.push(); m.t(s * 4.5, -9.5 - w * 1.2, 30 - w * 1.5); m.rz(-s * 0.28); m.ry(-s * e);
    m.push(); m.ry(s * Math.PI / 2); m.cyl(0.9, 0.6, 0, len, 6, 'l'); m.pop();
    if (r >= 4) {
      const poly = [[0, 0]];
      for (let k = 1; k <= feathers; k++) { const q = k / feathers; poly.push([s * (len * q + 2), -(7 + q * 7)]); }
      poly.push([s * len, 0]);
      if (s < 0) poly.reverse();
      m.plate(poly, 'y', 0, 'a');
    }
    for (let k = 1; k <= feathers; k++) {
      const q = k / feathers, x = s * len * q, fl = 6 + q * 8;
      m.plate([[x - s * 1.1, 0], [x + s * 1.1, 0], [x + s * 3, -fl], [x + s * 1.4, -fl + 1]], 'y', 0, w === 0 ? 'm' : 'l');
    }
    const tip = m.glow(null, s * len, 0, 0, 5.5, r === 5 ? '#ffffff' : pal.a, 0.8); tip.auto = true;
    m.pop();
  }
}
function buildHalo3(m, L, ly, ps, r) {
  const pal = L.pal, od = L.od || 0, t = ps.t || 0, col = '#9dffcf', pulse = 0.8 + Math.sin(t * 3) * 0.2;
  m.ring(0, -11, 27, 19 + od * 3, 'y', col, 1.4, 0.6 * pulse);
  if (r >= 4) {
    m.push(); m.t(0, -2, 27); m.rz(t * 0.9); m.rx(1.15 + Math.sin(t * 1.3) * 0.2);
    m.ring(0, 0, 0, 24, 'z', col, 1.1, 0.38);
    m.pop();
  }
  for (const s of [-1, 1]) { m.push(); m.t(s * 8, -11, 22); m.cyl(1.6, 1.6, 0, 7, 6, 'd'); m.cyl(1.8, 1.8, 2, 2.8, 6, 'a'); m.cyl(1.8, 1.8, 4.2, 5, 6, 'a'); m.pop(); }
  if (r >= 5) for (let i = 0; i < 3; i++) {
    const a = t * 1.7 + i * TAU / 3;
    const g = m.glow(null, Math.cos(a) * 25, Math.sin(a) * 25, 27 + Math.sin(a * 2) * 4, 4.2, col, 0.65); g.auto = true;
    const g2 = m.glow(null, Math.cos(a) * 25, Math.sin(a) * 25, 27 + Math.sin(a * 2) * 4, 1.3, '#ffffff', 0.9); g2.auto = true;
  }
}

/* ----- отделка форм ----- */
function buildTrim3(m, L, ly, ps) {
  const f = L.form, pal = L.pal, tw = ly.tw, fr = m.coreFront, t = ps.t || 0;
  if (!fr) return;
  if (f >= 1) for (const s of [-1, 1]) m.line(fr, s * (tw - 1.5), 5.6, 31.5, s * tw * 0.55, 5.6, 18, pal.a, 0.8, 0.6);
  if (f >= 2) m.line(fr, -tw + 1, 5.6, 32.6, tw - 1, 5.6, 32.6, pal.ag, 0.8, 0.6 + Math.sin(t * 3) * 0.3);
  if (f >= 3) m.line(fr, -tw * 0.8, 5.6, 17, tw * 0.8, 5.6, 17, pal.t, 1, 0.9);
  if (f >= 4) for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.42; const g = m.glow(null, Math.cos(a) * 12, 0, 50 + Math.sin(t * 3 + i) * 0.8 - Math.abs(i - 2) * 1.5, 2.4, '#fff6d0', 0.7); g.auto = true; }
}

/* ----- модули орудий: собраны вдоль локальной +y ----- */
function buildMounts3(m, L, ly, ps) {
  if (!ps.mounts) return;
  const tw = ly.tw;
  for (const w of ps.mounts) {
    if (!w.slot || w.hidden || w.slot === 'armR' || w.slot === 'armL') continue;
    m.g = w.slot === 'back' ? 'back' : 'core'; m.side = 0; m.slot = w.slot; m.rv = w.reveal;
    m.push();
    if (w.slot === 'shR' || w.slot === 'shL') m.t((w.slot === 'shR' ? 1 : -1) * (tw - 0.2), 0, 34.6);
    else if (w.slot === 'back') { m.t(tw * 0.5, -7.5, 37.5); }
    else m.t(0, 7.2, 21.5);
    buildModule3(m, w, L.pal, ps);
    m.pop();
    m.slot = null; m.rv = undefined;
  }
}
function buildModule3(m, w, pal, ps) {
  const id = baseOf(w), def = w.evo ? EVOS[w.id] : WEAPONS[w.id], col = def.color, A = w.anim || {}, f = A.fire || 0, t = ps.t || 0;
  m.push();
  m.t(0, -f * 2.2, 0);
  if (w.evo) m.sc(1.15);
  let tip = 10;
  const muzzle = (cap, y, r, k) => { if (cap) { m.glow(cap, 0, y, 0, r, col, 0.75 + f * 0.25); if (f > 0.45) m.glow(cap, 0, y + 1, 0, r * (2 + f * 2), '#ffffff', (f - 0.45) * 1.8); } };
  switch (id) {
    case 'blaster': {
      m.box(-2.4, -2.5, -2.2, 2.4, 3.6, 2.2, 'm');
      const b = m.barrel(1.3, 1.1, 3.6, 12.5, 8, 'l'); muzzle(b.cap1, 12.6, 1.6);
      if (w.evo) { m.box(-3.2, 2, 1.6, -2.6, 11, 2.2, 'a'); m.box(2.6, 2, 1.6, 3.2, 11, 2.2, 'a'); }
      tip = 13; break;
    }
    case 'blade': {
      m.box(-2, -2, -2, 2, 4, 2, 'm');
      const len = 4 + (A.swing || 0) * 24 + (A.out ? 14 : 0);
      m.box(-0.35, 4, -1.5, 0.35, 4 + len, 1.5, 'a');
      const g = m.line(null, 0, 4.5, 0, 0, 4 + len, 0, col, 2.2, 0.9); g.auto = true;
      tip = 4 + len; break;
    }
    case 'saw': {
      m.box(-1.8, -2.2, -1.8, 1.8, 2.2, 1.8, 'd');
      if (!A.out) {
        m.push(); m.t(0, 6, 0); m.ry(Math.PI / 2);
        const d = m.cyl(5.2, 5.2, -0.45, 0.45, 14, 'a');
        const sp = t * 8;
        for (const cap of [d.cap0, d.cap1]) if (cap) for (let i = 0; i < 3; i++) { const a = sp + i * TAU / 3; m.line(cap, Math.cos(a) * 1.4, Math.sin(a) * 1.4, cap === d.cap1 ? 0.47 : -0.47, Math.cos(a) * 4.8, Math.sin(a) * 4.8, cap === d.cap1 ? 0.47 : -0.47, '#ffffff', 0.8, 0.8); }
        m.pop();
      } else m.barrel(1.4, 1.4, 2.2, 4, 6, 'd');
      tip = 6; break;
    }
    case 'drones': {
      m.box(-3, -3, -3, 3, 3, 3, 'd');
      const rg = m.ring(0, 3.1, 0, 4, 'y', col, 0.9, 0.8); rg.auto = true;
      if (Math.sin(t * 6) > 0) { const g = m.glow(null, 0, 3.4, 0, 3, col, 1); g.auto = true; }
      tip = 4; break;
    }
    case 'arc': {
      m.barrel(1.4, 1.4, -1, 9, 6, 'd');
      for (let i = 0; i < 3; i++) m.barrel(3.6 - i * 0.6, 3.6 - i * 0.6, 1.5 + i * 2.4, 2.3 + i * 2.4, 10, i === 1 ? 'l' : 'm');
      const g = m.glow(null, 0, 10, 0, 4 + f * 5, col, 0.8); g.auto = true;
      tip = 10.5; break;
    }
    case 'missiles': {
      const pod = m.box(-4, -3, -3.6, 4, 5, 3.6, 'm');
      for (const [x, z] of [[-1.8, -1.6], [1.8, -1.6], [-1.8, 1.6], [1.8, 1.6]]) m.glow(pod[3], x, 5.05, z, 1.4, f > 0.2 ? col : '#2a3a5a', f > 0.2 ? 1 : 0.9);
      m.box(-4.2, 4.6 - f * 1.5, 3.6, 4.2, 5.4, 4.2 + f * 2, 'l');
      tip = 6; break;
    }
    case 'flamer': {
      m.barrel(3, 3, -3, 2, 8, 'd');
      const nz = m.barrel(1.7, 3.2, 2, 9.5, 8, 'm'); muzzle(nz.cap1, 9.6, 2.4);
      tip = 10; break;
    }
    case 'mines': {
      const b = m.box(-3.6, -3, -3.6, 3.6, 4, 3.6, 'd');
      if (Math.sin(t * 5) > 0.2) m.glow(b[5], 0, 0.5, 3.65, 2.4, '#ff4d5e', 1);
      m.line(b[3], -2.4, 4.02, 0, 2.4, 4.02, 0, col, 1, 0.9);
      tip = 4; break;
    }
    case 'gravity': {
      const r0 = m.barrel(4.4, 4.4, 0, 1.6, 12, 'm');
      if (r0.cap1) { m.glow(r0.cap1, 0, 1.65, 0, 3.6, '#000000', 0.9); m.glow(r0.cap1, 0, 1.65, 0, 5 + f * 3, col, 0.6); }
      tip = 2; break;
    }
    case 'cryo': {
      m.barrel(2.2, 2.2, -2, 2, 6, 'd');
      const cr = m.barrel(2.6, 0.6, 2, 11, 6, 'a', true); muzzle(cr.cap1, 11, 2);
      const g = m.glow(null, 0, 11.2, 0, 3.5 + f * 4, col, 0.8); g.auto = true;
      tip = 11.5; break;
    }
    case 'rail': {
      const ch = w.st && w.st.charge > 0;
      const rb = m.barrel(1.6, 1.6, -7, 21, 8, 'l');
      m.box(-0.5, -6, 1.9, 0.5, 20, 2.6, 'd'); m.box(-0.5, -6, -2.6, 0.5, 20, -1.9, 'd');
      for (let k = 0; k < 3; k++) m.barrel(2.8, 2.8, -2 + k * 5, -0.8 + k * 5, 8, ch ? 'a' : 'm');
      if (ch) { const g = m.glow(null, 0, 8, 0, 14, '#9fd8ff', 0.6 + Math.sin(t * 60) * 0.2); g.auto = true; }
      muzzle(rb.cap1, 21.2, 1.8);
      tip = 21.5; break;
    }
    case 'nanites': {
      const b = m.box(-3, -3, -3.6, 3, 3.5, 3.6, 'd');
      for (let k = 0; k < 3; k++) m.line(b[3], -1.8 + k * 1.8, 3.52, -2.6, -1.8 + k * 1.8, 3.52, 2.6, col, 0.8, 0.9);
      for (let i = 0; i < 4; i++) { const a = t * 3 + i * 1.7; const g = m.glow(null, Math.cos(a) * 3, 5 + Math.sin(a * 1.3) * 2, Math.sin(a) * 3, 1.5, col, 0.9); g.auto = true; }
      tip = 4; break;
    }
    case 'shock': {
      m.barrel(3.6, 3.6, -1.5, 2.5, 10, 'm');
      const rg = m.ring(0, 2.6, 0, 5.2 + f * 2, 'y', col, 1, 0.85); rg.auto = true;
      tip = 3; break;
    }
  }
  if (w.evo) { const g = m.glow(null, 0, 3, 0, 9, '#ffd36b', 0.22 + Math.sin(t * 4) * 0.08); g.auto = true; }
  m.anchor(w.slot, 0, tip, 0, 0, 1, 0);
  m.pop();
}
