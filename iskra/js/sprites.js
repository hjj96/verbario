'use strict';
/* ===== Генерация спрайтов: враги, предметы, декор, иконки ===== */

const SPR_RES = 3; // пикселей на единицу мира
const SPR = { enemies: {}, gems: [], items: {}, deco: [], icons: {}, glowDots: {} };

function grad(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
  return g;
}
function rgrad(c, x, y, r, stops) {
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
  return g;
}

/* ---------- Неоновые кисти для предрасчёта спрайтов ---------- */
function nstroke(c, col, w, gl) {
  const k = c.getTransform().a;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.save(); c.shadowColor = col; c.shadowBlur = (gl === undefined ? 5 : gl) * k; c.strokeStyle = col; c.lineWidth = w; c.stroke(); c.restore();
  c.strokeStyle = col; c.lineWidth = w * 0.7; c.stroke();
}
function nfill(c, col, a) { c.fillStyle = rgba(col, a === undefined ? 0.9 : a); c.fill(); }
function ndot(c, x, y, r, col) { c.save(); c.shadowColor = col; c.shadowBlur = r * 6 * c.getTransform().a; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = '#ffffff'; c.fill(); c.restore(); }

/* ---------- Предметы ---------- */
const GEM_TIERS = [
  { v: 1, col: '#46e3ff', r: 4 },
  { v: 4, col: '#5dff9b', r: 5 },
  { v: 12, col: '#ffb43d', r: 6 },
  { v: 40, col: '#ff4f9a', r: 7.5 },
  { v: 150, col: '#ffffff', r: 9 },
];
function gemTier(v) { let t = 0; for (let i = 0; i < GEM_TIERS.length; i++) if (v >= GEM_TIERS[i].v) t = i; return t; }

function buildItemSprites() {
  SPR.gems = GEM_TIERS.map(g => {
    const px = Math.ceil(g.r * 5 * SPR_RES), cv = makeCanvas(px, px), c = cv.getContext('2d');
    c.translate(px / 2, px / 2); c.scale(SPR_RES, SPR_RES);
    const r = g.r;
    pathPoly(c, [0, -r * 1.25, r * 0.78, 0, 0, r * 1.25, -r * 0.78, 0]); nfill(c, g.col, 0.16); nstroke(c, g.col, 0.9, 6);
    c.beginPath(); c.moveTo(0, -r * 1.25); c.lineTo(0, r * 1.25); c.moveTo(-r * 0.78, 0); c.lineTo(r * 0.78, 0); nstroke(c, g.col, 0.4, 2);
    ndot(c, 0, -r * 0.2, r * 0.18, g.col);
    return { cv, size: px / SPR_RES };
  });
  const mk = (sz, fn) => { const px = Math.ceil(sz * SPR_RES), cv = makeCanvas(px, px), c = cv.getContext('2d'); c.translate(px / 2, px / 2); c.scale(SPR_RES, SPR_RES); fn(c); return { cv, size: sz }; };
  SPR.items.scrap = mk(22, c => {
    c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, rr = i % 2 ? 4 : 5.6; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath();
    nfill(c, '#ffb43d', 0.18); nstroke(c, '#ffb43d', 0.9, 6);
    c.beginPath(); c.arc(0, 0, 1.8, 0, TAU); nstroke(c, '#ffe4a8', 0.6, 3);
  });
  SPR.items.heal = mk(26, c => {
    pathRR(c, -7, -7, 14, 14, 3); nfill(c, '#5dff9b', 0.12); nstroke(c, '#5dff9b', 1, 7);
    const a = 1.4, b = 4.4; pathPoly(c, [-a, -b, a, -b, a, -a, b, -a, b, a, a, a, a, b, -a, b, -a, a, -b, a, -b, -a, -a, -a]); nfill(c, '#5dff9b', 0.7); nstroke(c, '#d8ffe6', 0.5, 4);
  });
  SPR.items.magnet = mk(26, c => {
    c.beginPath(); c.arc(0, -1, 5, Math.PI, 0); c.lineTo(5, 5); c.moveTo(-5, -1); c.lineTo(-5, 5); nstroke(c, '#ff4d5e', 1.8, 6);
    c.beginPath(); c.moveTo(-5, 3.5); c.lineTo(-5, 6.5); c.moveTo(5, 3.5); c.lineTo(5, 6.5); nstroke(c, '#46e3ff', 1.8, 6);
  });
  SPR.items.bomb = mk(26, c => {
    c.beginPath(); c.arc(0, 0, 6.5, 0, TAU); nfill(c, '#ff4f9a', 0.12); nstroke(c, '#ff4f9a', 1, 7);
    c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); nstroke(c, '#ff4f9a', 0.6, 3);
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.moveTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5); c.lineTo(Math.cos(a) * 9.5, Math.sin(a) * 9.5); } nstroke(c, '#ff9ac6', 0.6, 3);
    ndot(c, 0, 0, 1.3, '#ff4f9a');
  });
  SPR.items.freeze = mk(26, c => {
    c.beginPath();
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); c.lineTo(-Math.cos(a) * 7, -Math.sin(a) * 7); }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, x = Math.cos(a) * 4.2, y = Math.sin(a) * 4.2; c.moveTo(x, y); c.lineTo(x + Math.cos(a + 0.7) * 2.2, y + Math.sin(a + 0.7) * 2.2); c.moveTo(x, y); c.lineTo(x + Math.cos(a - 0.7) * 2.2, y + Math.sin(a - 0.7) * 2.2); }
    nstroke(c, '#8fe8ff', 1, 6);
  });
  const chest = (gold) => mk(34, c => {
    const col = gold ? '#ffd36b' : '#46e3ff';
    const hex = [], hex2 = []; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; hex.push(Math.cos(a) * 10, Math.sin(a) * 10); hex2.push(Math.cos(a) * 5.5, Math.sin(a) * 5.5); }
    pathPoly(c, hex); nfill(c, '#060c18', 0.9); nstroke(c, col, 1.3, 9);
    pathPoly(c, hex2); nfill(c, col, 0.2); nstroke(c, col, 0.8, 5);
    c.beginPath(); c.moveTo(-10, 0); c.lineTo(-5.5, 0); c.moveTo(10, 0); c.lineTo(5.5, 0); nstroke(c, col, 0.7, 3);
    ndot(c, 0, 0, 1.6, col);
  });
  SPR.items.chest = chest(false);
  SPR.items.bigchest = chest(true);
}

/* ---------- Пол сектора: план-чертёж ---------- */
function hatchPath(poly, angle, step) {
  const ca = Math.cos(angle), sa = Math.sin(angle), path = new Path2D();
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < poly.length; i += 2) { const d = -poly[i] * sa + poly[i + 1] * ca; mn = Math.min(mn, d); mx = Math.max(mx, d); }
  for (let d = mn + step / 2; d < mx; d += step) {
    const hits = [];
    for (let i = 0; i < poly.length; i += 2) {
      const x1 = poly[i], y1 = poly[i + 1], x2 = poly[(i + 2) % poly.length], y2 = poly[(i + 3) % poly.length];
      const d1 = -x1 * sa + y1 * ca - d, d2v = -x2 * sa + y2 * ca - d;
      if ((d1 < 0) !== (d2v < 0)) { const q = d1 / (d1 - d2v); hits.push(x1 + (x2 - x1) * q, y1 + (y2 - y1) * q); }
    }
    const pts = [];
    for (let k = 0; k < hits.length; k += 2) pts.push({ x: hits[k], y: hits[k + 1], t: hits[k] * ca + hits[k + 1] * sa });
    pts.sort((a, b) => a.t - b.t);
    for (let k = 0; k + 1 < pts.length; k += 2) { path.moveTo(pts[k].x, pts[k].y); path.lineTo(pts[k + 1].x, pts[k + 1].y); }
  }
  return path;
}
function polyPath(p) { const path = new Path2D(); path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); path.closePath(); return path; }
function blobPoly(cx, cy, r, n, j, seed) { const p = []; for (let i = 0; i < n; i++) { const a = i * TAU / n, rr = r * (1 - j / 2 + j * hash2(i, seed, 7)); p.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } return p; }
function buildBackground(S) {
  const P = S.pal;
  // мягкая тональная текстура
  const tile = makeCanvas(512, 512), c = tile.getContext('2d');
  c.fillStyle = P.ground; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = rand(40, 130);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(P.ground2, 0.9)); g.addColorStop(1, rgba(P.ground2, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 600; i++) { c.fillStyle = rgba('#ffffff', rand(0.008, 0.03)); c.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5); }
  SPR.bgTile = tile;
  // векторный декор: каждый — набор штрихов и подписей
  const D = [], L = (path, col, w, dash, a) => ({ path, col, w: w || 1, dash: dash || null, a: a === undefined ? 1 : a });
  const lines = segs => { const p = new Path2D(); for (const s of segs) { p.moveTo(s[0], s[1]); p.lineTo(s[2], s[3]); } return p; };
  const circ = (cx, cy, r) => { const p = new Path2D(); p.arc(cx, cy, r, 0, TAU); return p; };
  if (S.id === 'rust') {
    D.push({ r: 60, s: [L(circ(0, 0, 24), P.deco, 1, [6, 6]), L(circ(0, 0, 38), P.deco, 1, [6, 6]), L(circ(0, 0, 54), P.deco2, 1, [10, 6]), L(lines([[-8, 0, 8, 0], [0, -8, 0, 8]]), P.cross, 1.2)], t: [[30, -48, 'R 54']] });
    const heap = blobPoly(0, 0, 52, 9, 0.5, 3);
    D.push({ r: 60, s: [L(hatchPath(heap, 0.8, 7), P.deco, 0.8, null, 0.7), L(polyPath(heap), P.deco2, 1.3)], t: [[-40, 66, 'УЧ. 12-Б']] });
    const fl = []; for (let x = -110; x <= 110; x += 44) fl.push([x, -12, x, 12]);
    D.push({ r: 120, s: [L(lines([[-110, -7, 110, -7], [-110, 7, 110, 7]]), P.deco2, 1.2), L(lines(fl), P.deco, 1), L(circ(-116, 0, 9), P.deco, 1), L(circ(116, 0, 9), P.deco, 1),
      L(lines([[-110, -30, 110, -30], [-110, -35, -110, -25], [110, -35, 110, -25]]), P.note, 0.8)], t: [[-14, -36, '2 200']] });
    D.push({ r: 45, s: [L(circ(-26, 0, 13), P.deco2, 1.1), L(circ(-26, 0, 6), P.deco, 0.8), L(circ(0, -8, 13), P.deco2, 1.1), L(circ(0, -8, 6), P.deco, 0.8), L(circ(26, 2, 13), P.deco2, 1.1), L(circ(26, 2, 6), P.deco, 0.8)] });
    const sq = [-36, -36, 36, -36, 36, 36, -36, 36];
    D.push({ r: 52, s: [L(polyPath(sq), P.deco2, 1.1), L(hatchPath([-36, -36, 36, -36, 36, -4, -36, -4], -0.8, 9), '#7a5a2a', 2, null, 0.8), L(lines([[-36, 46, 36, 46], [-36, 41, -36, 51], [36, 41, 36, 51]]), P.note, 0.8)], t: [[-10, 58, '720']] });
  } else if (S.id === 'neon') {
    const bw = 66, bh = 46, win = [];
    for (let x = -48; x <= 48; x += 16) for (let y = -28; y <= 28; y += 14) win.push([x - 4, y, x + 4, y]);
    D.push({ r: 80, s: [L(polyPath([-bw, -bh, bw, -bh, bw, bh, -bw, bh]), P.deco2, 1.3), L(polyPath([-bw + 9, -bh + 9, bw - 9, -bh + 9, bw - 9, bh - 9, -bw + 9, bh - 9]), P.deco, 1), L(lines(win), P.cross, 1.2, null, 0.7)], t: [[-bw, -bh - 8, 'Д-7 · 24 ЭТ.']] });
    const zebra = []; for (let y = -16; y <= 16; y += 6) zebra.push([120, y, 140, y]);
    D.push({ r: 150, s: [L(lines([[-150, -18, 150, -18], [-150, 18, 150, 18]]), P.deco2, 1.2), L(lines([[-150, 0, 150, 0]]), P.deco, 1, [12, 10]), L(lines(zebra), P.cross, 2, null, 0.6)] });
    const rad = []; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; rad.push([Math.cos(a) * 18, Math.sin(a) * 18, Math.cos(a) * 56, Math.sin(a) * 56]); }
    D.push({ r: 60, s: [L(circ(0, 0, 56), P.deco2, 1.2), L(circ(0, 0, 18), P.deco, 1), L(lines(rad), P.deco, 0.8, [4, 4])], t: [[24, -60, 'ПЛ. «РАССВЕТ»']] });
    const arcs = new Path2D(); for (const r of [16, 24, 32]) { arcs.moveTo(Math.cos(-0.7) * r, Math.sin(-0.7) * r); arcs.arc(0, 0, r, -0.7, 0.7); }
    D.push({ r: 40, s: [L(circ(0, 0, 9), P.deco2, 1.2), L(lines([[-9, 0, 9, 0], [0, -9, 0, 9]]), P.cross, 1), L(arcs, '#ff3fa4', 1.2, null, 0.7)] });
  } else {
    const cells = []; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.4, d = i ? 34 : 0; cells.push(blobPoly(Math.cos(a) * d, Math.sin(a) * d, i ? 16 : 18, 10, 0.35, i * 5 + 1)); }
    D.push({ r: 60, s: cells.map(p => L(polyPath(p), P.deco2, 1.1)).concat(cells.map((p, i) => L(circ(p[0] * 0.15 + (i ? Math.cos(i * TAU / 6 + 0.4) * 34 * 0.85 : 0), (i ? Math.sin(i * TAU / 6 + 0.4) * 34 * 0.85 : 0), 3.5), '#ff3d5a', 1, null, 0.6))) });
    const vein = new Path2D(); vein.moveTo(-120, 10); vein.bezierCurveTo(-60, -40, 0, 50, 60, -10); vein.bezierCurveTo(90, -30, 110, -10, 130, -30);
    vein.moveTo(-40, 0); vein.quadraticCurveTo(-30, 30, -10, 40); vein.moveTo(40, 0); vein.quadraticCurveTo(50, -30, 70, -44);
    D.push({ r: 130, s: [L(vein, P.deco2, 2.2, null, 0.8), L(vein, '#ff3d5a', 0.8, null, 0.6)] });
    const cont = []; for (let k = 0; k < 3; k++) cont.push(L(polyPath(blobPoly(0, 0, 22 + k * 16, 14, 0.25, 9)), k === 0 ? P.deco2 : P.deco, 1, k === 2 ? [5, 5] : null));
    D.push({ r: 70, s: cont, t: [[30, -56, '−4.20']] });
    const eggs = new Path2D(); for (let i = 0; i < 7; i++) { const a = i * 0.9, d = 8 + i * 4; eggs.moveTo(Math.cos(a) * d + 6, Math.sin(a) * d); eggs.ellipse(Math.cos(a) * d, Math.sin(a) * d, 6, 8.5, a, 0, TAU); }
    D.push({ r: 45, s: [L(eggs, '#ffb43d', 1, null, 0.75)] });
  }
  // на полу остаются только круглые мотивы: остальное (кучи, рельсы, дома, дороги, прожилки) — шум
  const keep = { rust: [0, 3], neon: [2, 3], hive: [0, 2], cryo: [0, 3], orbit: [2, 3] }[S.id] || null;
  SPR.decoV = keep ? keep.map(i => D[i]).filter(Boolean) : D;
  SPR.deco = [];
}

/* ---------- Иконки (для интерфейса) ---------- */
function iconCanvas(fn, col) {
  const cv = makeCanvas(96, 96), c = cv.getContext('2d');
  c.translate(48, 48); c.scale(3, 3);
  c.lineCap = 'round'; c.lineJoin = 'round';
  glow(c, 0, 0, 16, col, 0.35);
  fn(c, col);
  return cv;
}
const ICON_DRAW = {
  blaster(c, k) {
    for (let i = -1; i <= 1; i++) { c.strokeStyle = rgba(k, 0.5 - Math.abs(i) * 0.2); c.lineWidth = 1.5; c.beginPath(); c.moveTo(-11, i * 5); c.lineTo(-3, i * 5); c.stroke(); }
    pathRR(c, -4, -3.2, 15, 6.4, 3.2); c.fillStyle = k; c.fill();
    pathRR(c, -1, -1.4, 10, 2.8, 1.4); c.fillStyle = '#fff'; c.fill();
    glow(c, 9, 0, 9, k, 0.9);
  },
  blade(c, k) {
    c.beginPath(); c.arc(-4, 2, 12, -1.35, 0.95); c.arc(-6, 3, 7.5, 0.95, -1.35, true); c.closePath();
    c.fillStyle = grad(c, -10, -10, 10, 10, ['#ffffff', k, shade(k, -0.4)]); c.fill();
    glow(c, 4, -3, 10, k, 0.7);
  },
  drones(c, k) {
    c.strokeStyle = rgba(k, 0.45); c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.stroke();
    c.beginPath(); c.arc(0, 0, 3.5, 0, TAU); c.fillStyle = '#c9d4e2'; c.fill();
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 - 0.5; c.beginPath(); c.arc(Math.cos(a) * 10, Math.sin(a) * 10, 3, 0, TAU); c.fillStyle = k; c.fill(); glow(c, Math.cos(a) * 10, Math.sin(a) * 10, 6, k, 0.8); }
  },
  arc(c, k) {
    const pts = [[-12, -6], [-5, -2], [-7, 3], [2, 1], [0, 7], [11, 4]];
    c.strokeStyle = k; c.lineWidth = 2.4; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 0.9; c.stroke();
    for (const p of [pts[0], pts[3], pts[5]]) { c.beginPath(); c.arc(p[0], p[1], 2.2, 0, TAU); c.fillStyle = '#fff'; c.fill(); glow(c, p[0], p[1], 6, k, 0.9); }
  },
  missiles(c, k) {
    c.save(); c.rotate(-0.7);
    pathRR(c, -3, -11, 6, 17, 3); c.fillStyle = grad(c, -3, 0, 3, 0, ['#f2f5fa', '#9aa6b5', '#55606e']); c.fill();
    pathPoly(c, [-3, -6, 0, -14, 3, -6]); c.fillStyle = k; c.fill();
    pathPoly(c, [-3, 2, -6.5, 7, -3, 6]); pathPoly(c, [3, 2, 6.5, 7, 3, 6]); c.fillStyle = shade(k, -0.2); c.fill();
    const g = c.createLinearGradient(0, 6, 0, 14); g.addColorStop(0, '#fff'); g.addColorStop(1, rgba(k, 0));
    c.fillStyle = g; c.beginPath(); c.moveTo(-2.5, 6); c.lineTo(0, 15); c.lineTo(2.5, 6); c.fill();
    c.restore();
  },
  flamer(c, k) {
    c.beginPath(); c.moveTo(0, 12); c.bezierCurveTo(-11, 6, -6, -4, -2, -12); c.bezierCurveTo(0, -5, 4, -6, 5, -10); c.bezierCurveTo(10, -2, 10, 8, 0, 12);
    c.fillStyle = grad(c, 0, -12, 0, 12, ['#fff6c8', '#ffcf5a', k, shade(k, -0.4)]); c.fill();
    c.beginPath(); c.moveTo(0, 10); c.bezierCurveTo(-5, 6, -3, 0, 0, -3); c.bezierCurveTo(3, 1, 5, 6, 0, 10); c.fillStyle = '#fffbe6'; c.fill();
  },
  mines(c, k) {
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.strokeStyle = '#8b95a5'; c.lineWidth = 2; c.beginPath(); c.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); c.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); c.stroke(); }
    c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fillStyle = grad(c, -6, -6, 6, 6, ['#6b7484', '#2c323c', '#14181f']); c.fill();
    c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fillStyle = k; c.fill(); glow(c, 0, 0, 8, k, 1);
  },
  gravity(c, k) {
    for (let i = 0; i < 3; i++) { c.strokeStyle = rgba(k, 0.9 - i * 0.25); c.lineWidth = 2 - i * 0.4; c.beginPath(); c.arc(0, 0, 5 + i * 3.5, i * 2.1, i * 2.1 + 4); c.stroke(); }
    c.beginPath(); c.arc(0, 0, 4.2, 0, TAU); c.fillStyle = '#05030a'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 0.8; c.stroke();
  },
  cryo(c, k) {
    c.strokeStyle = rgba(k, 0.55); c.lineWidth = 5; c.beginPath(); c.moveTo(-13, 8); c.lineTo(12, -8); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.strokeStyle = k; c.lineWidth = 1.6; c.beginPath(); c.moveTo(6 + Math.cos(a) * 6, -4 + Math.sin(a) * 6); c.lineTo(6 - Math.cos(a) * 6, -4 - Math.sin(a) * 6); c.stroke(); }
  },
  rail(c, k) {
    c.strokeStyle = rgba(k, 0.4); c.lineWidth = 6; c.beginPath(); c.moveTo(-14, 0); c.lineTo(14, 0); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
    c.strokeStyle = '#9aa6b5'; c.lineWidth = 1.6;
    for (const x of [-10, -4]) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x, 6); c.stroke(); }
    pathRR(c, -14, -3.5, 8, 7, 1.5); c.fillStyle = '#4a5363'; c.fill();
  },
  glaive(c, k) {
    c.save(); c.rotate(-0.7); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    c.strokeStyle = rgba(k, 0.35); c.lineWidth = 7; c.beginPath(); c.moveTo(-13, 0); c.lineTo(13, 0); c.stroke();
    c.strokeStyle = k; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#ffffff'; c.lineWidth = 1.2; c.stroke();
    c.restore();
    c.save(); c.rotate(-0.7); c.fillStyle = '#16202f'; c.fillRect(-3.5, -2, 7, 4); c.strokeStyle = '#b8ecff'; c.lineWidth = 0.8; c.strokeRect(-3.5, -2, 7, 4); c.restore();
    c.strokeStyle = rgba(k, 0.4); c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 13, 0.3, 2.4); c.stroke();
  },
  magnet(c, k) {
    c.lineCap = 'butt'; c.lineWidth = 6;
    c.strokeStyle = grad(c, -10, -10, 10, 10, ['#ffffff', '#c9d3e6', '#6f7c94']);
    c.beginPath(); c.arc(0, -1, 7, Math.PI, 0); c.lineTo(7, 8); c.moveTo(-7, -1); c.lineTo(-7, 8); c.stroke();
    c.fillStyle = '#ff5a6e'; c.fillRect(-10, 6, 6, 5); c.fillStyle = '#5aa8ff'; c.fillRect(4, 6, 6, 5);
    c.strokeStyle = rgba(k, 0.5); c.lineWidth = 1; for (const r of [11, 14]) { c.beginPath(); c.arc(0, 12, r, -2.6, -0.55); c.stroke(); }
  },
  saw(c, k) {
    c.beginPath();
    for (let i = 0; i < 24; i++) { const a = i * TAU / 24, r = i % 2 ? 9 : 12; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath(); c.fillStyle = grad(c, -12, -12, 12, 12, ['#ffffff', k, shade(k, -0.45)]); c.fill();
    c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fillStyle = '#2a2f38'; c.fill();
  },
  nanites(c, k) {
    for (let i = 0; i < 34; i++) { const a = i * 2.4, r = 2 + (i % 11); c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r * 0.85, 1 + (i % 3) * 0.4, 0, TAU); c.fillStyle = i % 4 ? k : '#fff'; c.fill(); }
  },
  shock(c, k) {
    for (let i = 0; i < 3; i++) { c.strokeStyle = rgba(k, 1 - i * 0.28); c.lineWidth = 2.4 - i * 0.5; c.beginPath(); c.arc(0, 0, 4 + i * 4.5, 0, TAU); c.stroke(); }
    c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
};
const PART_ICON = {
  core(c, k) {
    pathPoly(c, [-10, -9, 10, -9, 8, 9, -8, 9]); c.fillStyle = grad(c, 0, -9, 0, 9, ['#c9d4e2', '#7d8899', '#3b4350']); c.fill(); c.strokeStyle = '#0a0d14'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(0, -1, 4.5, 0, TAU); c.fillStyle = k; c.fill(); glow(c, 0, -1, 12, k, 0.9);
    c.beginPath(); c.arc(0, -1, 1.8, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
  legs(c, k) {
    for (const s of [-1, 1]) {
      c.strokeStyle = '#8b95a5'; c.lineWidth = 4; c.beginPath(); c.moveTo(s * 4, -10); c.lineTo(s * 5, 0); c.lineTo(s * 5.5, 9); c.stroke();
      c.beginPath(); c.arc(s * 5, 0, 2.4, 0, TAU); c.fillStyle = k; c.fill();
      pathRR(c, s * 5.5 - 4.5, 8, 9, 3.5, 1.5); c.fillStyle = '#4a5363'; c.fill();
    }
    glow(c, 0, 10, 12, k, 0.5);
  },
  arms(c, k) {
    c.strokeStyle = '#8b95a5'; c.lineWidth = 4; c.beginPath(); c.moveTo(-8, -10); c.lineTo(-6, -2); c.stroke();
    pathRR(c, -10.5, -3, 9, 15, 3); c.fillStyle = grad(c, -10, 0, -1, 0, ['#c9d4e2', '#7d8899', '#3b4350']); c.fill();
    c.beginPath(); c.ellipse(-6, 12, 4, 1.6, 0, 0, TAU); c.fillStyle = k; c.fill(); glow(c, -6, 12, 8, k, 0.9);
    for (let i = 0; i < 3; i++) { c.strokeStyle = rgba(k, 0.8 - i * 0.2); c.lineWidth = 1.4; c.beginPath(); c.moveTo(2 + i * 3, -6 + i * 5); c.lineTo(11, -6 + i * 5); c.stroke(); }
  },
  head(c, k) {
    pathRR(c, -9, -8, 18, 15, 5); c.fillStyle = grad(c, 0, -8, 0, 7, ['#c9d4e2', '#7d8899', '#3b4350']); c.fill(); c.strokeStyle = '#0a0d14'; c.lineWidth = 1; c.stroke();
    pathRR(c, -6.5, -2.5, 13, 4.5, 2.2); c.fillStyle = '#0a0d14'; c.fill();
    pathRR(c, -5.5, -1.8, 11, 3, 1.5); c.fillStyle = k; c.fill(); glow(c, 0, 0, 12, k, 0.8);
    c.strokeStyle = '#c9d4e2'; c.lineWidth = 1; c.beginPath(); c.moveTo(5, -8); c.lineTo(8, -13); c.stroke();
  },
  back(c, k) {
    for (const s of [-1, 1]) {
      c.strokeStyle = '#8b95a5'; c.lineWidth = 2; c.beginPath(); c.moveTo(s * 3, 2); c.lineTo(s * 13, -9); c.stroke();
      for (let i = 1; i <= 3; i++) { const x = s * (3 + i * 3.2), y = 2 - i * 3.6; c.strokeStyle = k; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x + s * 1.5, y + 8); c.stroke(); }
    }
    pathRR(c, -4.5, -2, 9, 11, 2); c.fillStyle = '#4a5363'; c.fill();
    glow(c, 0, 3, 10, k, 0.7);
  },
};
const ITEM_ICON = {
  f_heal(c, k) { pathRR(c, -9, -6, 18, 12, 6); c.fillStyle = '#d6dee6'; c.fill(); c.fillStyle = '#ff4d5e'; c.fillRect(-1.8, -4.5, 3.6, 9); c.fillRect(-4.5, -1.8, 9, 3.6); },
  f_scrap(c, k) { c.drawImage(SPR.items.scrap.cv, -12, -12, 24, 24); },
  f_might(c, k) { ICON_DRAW.blaster(c, k); },
  f_cdr(c, k) { c.strokeStyle = k; c.lineWidth = 2.4; c.beginPath(); c.arc(0, 0, 9, -Math.PI / 2, Math.PI); c.stroke(); pathPoly(c, [-12, 0, -6, 0, -9, -5]); c.fillStyle = k; c.fill(); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -6); c.moveTo(0, 0); c.lineTo(4, 2); c.stroke(); },
  f_hp(c, k) { PART_ICON.core(c, k); },
  f_area(c, k) { ICON_DRAW.shock(c, k); },
};

function buildIcons() {
  for (const id in WEAPONS) SPR.icons[id] = iconCanvas(ICON_DRAW[id], WEAPONS[id].color).toDataURL();
  for (const id in EVOS) {
    const e = EVOS[id];
    SPR.icons[id] = iconCanvas((c, k) => {
      c.save(); c.globalAlpha = 0.9;
      c.strokeStyle = '#ffd36b'; c.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.beginPath(); c.moveTo(Math.cos(a) * 13, Math.sin(a) * 13); c.lineTo(Math.cos(a) * 15.5, Math.sin(a) * 15.5); c.stroke(); }
      c.restore();
      c.save(); c.scale(1.06, 1.06); ICON_DRAW[e.from](c, k); c.restore();
      glow(c, 0, 0, 14, '#ffd36b', 0.35);
    }, e.color).toDataURL();
  }
  for (const id in PARTS) SPR.icons['part_' + id] = iconCanvas(PART_ICON[id], PARTS[id].color).toDataURL();
  for (const f of FILLERS) SPR.icons[f.id] = iconCanvas(ITEM_ICON[f.id], f.color).toDataURL();
}

/* ---------- Светящиеся точки для частиц ---------- */
function dotSprite(col) {
  let s = SPR.glowDots[col];
  if (s) return s;
  s = makeCanvas(32, 32);
  const c = s.getContext('2d');
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.2, rgba(col, 1)); g.addColorStop(0.5, rgba(col, 0.35)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  SPR.glowDots[col] = s;
  return s;
}
