'use strict';
/* ===== Постройки сектора: препятствия в технике чертежа =====
   Стоят на карте детерминированно по ячейкам (как опасности), не пересекаются с опасностями и стартом.
   Робот и машины Роя обходят их (летуны и боссы — пролетают), снаряды летят поверх. */

const BLD = {
  cell: 600, ch: 0.36,
  types: { rust: ['container', 'silo', 'wall', 'chimney', 'container'], neon: ['tower', 'billboard', 'kiosk', 'antenna', 'tower'], hive: ['spire', 'pod', 'arch', 'spire'] },
  col: { rust: '#c9a46a', neon: '#8f7bff', hive: '#d0486a' },
  acc: { rust: '#ffb43d', neon: '#ff3fa4', hive: '#c6ff3d' },
};
const BLD_CACHE = new Map(), BLD_LIST = [], BLD_ROT = { container: 1, wall: 1 };
function resetStructures() { BLD_CACHE.clear(); BLD_LIST.length = 0; }

// формы препятствий: { x, y, hw, hd } — прямоугольник по осям, { x, y, R } — круг
const BLD_T = {
  container: { make: (b, h) => { const L = 40 + h(1) * 12, D = 14; b.stack = h(2) < 0.45; b.H = b.stack ? 52 : 26; return [{ hw: L, hd: D }]; } },
  silo: { make: (b, h) => { b.R = 20 + h(1) * 7; b.H = 46 + h(2) * 18; return [{ R: b.R }]; } },
  wall: { make: (b, h) => { b.L = 48 + h(1) * 14; b.H = 34; return [{ hw: b.L, hd: 8 }]; } },
  chimney: { make: (b, h) => { b.H = 92 + h(1) * 24; return [{ hw: 16, hd: 16 }]; } },
  tower: { make: (b, h) => { b.W = 24 + h(1) * 8; b.D = 20 + h(2) * 6; b.H = 66 + h(3) * 26; return [{ hw: b.W, hd: b.D }]; } },
  billboard: { make: (b, h) => { b.L = 34 + h(1) * 8; b.H = 58; return [{ dx: -b.L * 0.72, R: 6 }, { dx: b.L * 0.72, R: 6 }]; } },
  kiosk: { make: (b, h) => { b.H = 24; return [{ hw: 17, hd: 13 }]; } },
  antenna: { make: (b, h) => { b.H = 104 + h(1) * 30; return [{ R: 11 }]; } },
  spire: { make: (b, h) => { b.R = 24 + h(1) * 6; b.H = 50 + h(2) * 30; return [{ R: b.R }]; } },
  pod: { make: (b, h) => { b.R = 26 + h(1) * 6; b.H = 38; return [{ R: b.R }]; } },
  arch: { make: (b, h) => { b.L = 32 + h(1) * 8; b.H = 48; return [{ dx: -b.L, R: 7 }, { dx: b.L, R: 7 }]; } },
};

// опасность в ячейке её сетки (та же формула, что в hazardsAround)
function hazAtCell(H, cx, cy) {
  const seed = 501 + SECTORS.indexOf(G.sector) * 37;
  if (hash2(cx, cy, seed) > H.ch) return null;
  return { x: (cx + 0.18 + hash2(cx, cy, seed + 1) * 0.64) * H.cell, y: (cy + 0.18 + hash2(cx, cy, seed + 2) * 0.64) * H.cell };
}
function nearHazard(x, y, R) {
  const H = hazDef();
  if (!H) return false;
  const gx = Math.floor(x / H.cell), gy = Math.floor(y / H.cell), lim = R + (H.len ? H.len / 2 : H.r || 40) + 70;
  for (let cy = gy - 1; cy <= gy + 1; cy++) for (let cx = gx - 1; cx <= gx + 1; cx++) { const h = hazAtCell(H, cx, cy); if (h && d2(h.x, h.y, x, y) < lim * lim) return true; }
  return false;
}
function structuresAround() {
  BLD_LIST.length = 0;
  const types = G.sector && BLD.types[G.sector.id];
  if (!types) return BLD_LIST;
  const C = BLD.cell, seed = 911 + SECTORS.indexOf(G.sector) * 53;
  const x0 = P.x - 1150, x1 = P.x + 1150, y0 = P.y - 1000, y1 = P.y + 1000;
  if (BLD_CACHE.size > 160) BLD_CACHE.clear();
  for (let cy = Math.floor(y0 / C); cy <= Math.floor(y1 / C); cy++) for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) {
    if (hash2(cx, cy, seed) > BLD.ch) continue;
    const key = cx * 65536 + cy;
    let b = BLD_CACHE.get(key);
    if (!b) {
      const h = k => hash2(cx, cy, seed + 10 + k);
      const x = (cx + 0.22 + hash2(cx, cy, seed + 1) * 0.56) * C, y = (cy + 0.22 + hash2(cx, cy, seed + 2) * 0.56) * C;
      const type = types[Math.floor(hash2(cx, cy, seed + 3) * types.length)];
      // поворот на 90° — только у построек без фасада (у башни, билборда, киоска фасад смотрит в камеру)
      b = { key, type, x, y, rot: BLD_ROT[type] && hash2(cx, cy, seed + 4) < 0.5 ? 1 : 0, fade: 1, mesh: null, mk: '' };
      const shapes = BLD_T[b.type].make(b, h);
      // повёрнутая на 90° постройка меняет стороны прямоугольников и смещения опор
      b.cols = shapes.map(s => s.R ? { x: x + (b.rot ? 0 : s.dx || 0), y: y + (b.rot ? s.dx || 0 : 0), R: s.R } : { x, y, hw: b.rot ? s.hd : s.hw, hd: b.rot ? s.hw : s.hd });
      let ex = 0, ey = 0;
      for (const s of b.cols) { ex = Math.max(ex, Math.abs(s.x - x) + (s.R || s.hw)); ey = Math.max(ey, Math.abs(s.y - y) + (s.R || s.hd)); }
      b.ex = ex; b.ey = ey;
      b.skip = x * x + y * y < 460 * 460 || nearHazard(x, y, Math.max(ex, ey));
      BLD_CACHE.set(key, b);
    }
    if (!b.skip) BLD_LIST.push(b);
  }
  return BLD_LIST;
}

/* ---------- Столкновения ---------- */
// выталкивает круг o (x, y, радиус r) из формы s; возвращает нормаль или null
function pushOut(o, r, s) {
  if (s.R) {
    const dx = o.x - s.x, dy = o.y - s.y, rr = r + s.R, q = dx * dx + dy * dy;
    if (q >= rr * rr) return null;
    const d = Math.sqrt(q) || 1, k = rr - d, nx = q > 1e-6 ? dx / d : 1, ny = q > 1e-6 ? dy / d : 0;
    o.x += nx * k; o.y += ny * k;
    return { nx, ny };
  }
  const qx = clamp(o.x, s.x - s.hw, s.x + s.hw), qy = clamp(o.y, s.y - s.hd, s.y + s.hd), dx = o.x - qx, dy = o.y - qy, q = dx * dx + dy * dy;
  if (q >= r * r) return null;
  if (q > 1e-6) { const d = Math.sqrt(q), k = r - d; o.x += dx / d * k; o.y += dy / d * k; return { nx: dx / d, ny: dy / d }; }
  // центр внутри: к ближайшей стороне
  const l = o.x - (s.x - s.hw), rt = s.x + s.hw - o.x, t = o.y - (s.y - s.hd), bt = s.y + s.hd - o.y, m = Math.min(l, rt, t, bt);
  if (m === l) { o.x = s.x - s.hw - r; return { nx: -1, ny: 0 }; }
  if (m === rt) { o.x = s.x + s.hw + r; return { nx: 1, ny: 0 }; }
  if (m === t) { o.y = s.y - s.hd - r; return { nx: 0, ny: -1 }; }
  o.y = s.y + s.hd + r; return { nx: 0, ny: 1 };
}
function collideStructures(o, r) {
  let hit = null;
  for (const b of BLD_LIST) {
    if (Math.abs(o.x - b.x) > b.ex + r + 2 || Math.abs(o.y - b.y) > b.ey + r + 2) continue;
    for (const s of b.cols) { const n = pushOut(o, r, s); if (n) { n.s = s; hit = n; } }
  }
  return hit;
}
// машина Роя упёрлась в стену: скользит вдоль неё к ближнему краю (короткий путь в обход) и помнит выбранную
// сторону, пока не обогнёт препятствие; удар в стену гасится
function enemyVsStructures(e, dt) {
  if (!BLD_LIST.length || e.boss || e.parent || e.T.prop || e.leapH > 12 || (EM[e.tid] && EM[e.tid].fly)) return;
  if (e.slideT > 0) e.slideT -= dt;
  const n = collideStructures(e, e.r * 0.85);
  if (!n) return;
  const kn = e.kbx * n.nx + e.kby * n.ny;
  if (kn < 0) { e.kbx -= kn * n.nx; e.kby -= kn * n.ny; }
  let tx = -n.ny, ty = n.nx;
  const s = n.s, toP = tx * (P.x - e.x) + ty * (P.y - e.y);
  // у круга обход — в сторону робота; у прямоугольника — к ближнему краю грани, если робот не явно в другую сторону
  let dir = s.R ? Math.sign(toP) || 1 : Math.sign((e.x - s.x) * tx + (e.y - s.y) * ty) || 1;
  if (!s.R && Math.abs(toP) > (Math.abs(tx) > 0.5 ? s.hw : s.hd) * 1.2) dir = Math.sign(toP);
  if (e.slideT > 0 && e.slideS === s) dir = e.slideD; else { e.slideS = s; e.slideD = dir; }
  e.slideT = 0.6;
  const sp = e.spd || 60;
  e.x += tx * dir * sp * dt; e.y += ty * dir * sp * dt;
}

/* ---------- Модели ---------- */
const BLD_M = {
  // морской контейнер: рифлёные борта, двери на торцах; иногда второй ярусом
  container(m, b, col, acc) {
    const L = b.cols[0].hw > b.cols[0].hd ? b.cols[0].hw : b.cols[0].hd, D = 14;
    const lay = (z0, l, tone) => {
      const f = m.box(-l, -D, z0, l, D, z0 + 26, tone);
      for (let x = -l + 6; x < l - 3; x += 6.5) { m.line(f[2], x, -D, z0 + 3, x, -D, z0 + 23, col, 0.6, 0.45); m.line(f[3], x, D, z0 + 3, x, D, z0 + 23, col, 0.6, 0.45); }
      for (const sx of [-1, 1]) { const fe = f[sx < 0 ? 0 : 1]; m.line(fe, sx * l, -4, z0 + 2, sx * l, -4, z0 + 24, col, 0.9, 0.7); m.line(fe, sx * l, 4, z0 + 2, sx * l, 4, z0 + 24, col, 0.9, 0.7); }
      m.line(f[5], -l + 2, -D + 3, z0 + 26, l - 2, -D + 3, z0 + 26, acc, 1, 0.6);
    };
    lay(0, L, 'm');
    if (b.stack) { m.push(); m.rz(0.12); lay(26, L * 0.82, 'l'); m.pop(); }
  },
  // силос: цилиндр с поясами, конусная крыша, лестница и труба к земле
  silo(m, b, col, acc) {
    const R = b.R, H = b.H;
    const c = m.cyl(R, R, 0, H, 12, 'm');
    for (const z of [H * 0.28, H * 0.62]) m.cyl(R + 1.2, R + 1.2, z, z + 2.4, 12, 'd');
    m.cyl(R + 0.5, 3, H, H + R * 0.55, 12, 'l');
    for (const sx of [-3, 3]) m.strut([sx, -R - 2.5, 0], [sx, -R - 2.5, H], 0.5, 0.5, 4, 'd');
    for (let z = 4; z < H; z += 6) m.line(null, -3, -R - 2.5, z, 3, -R - 2.5, z, col, 0.7, 0.6);
    m.strut([R * 0.7, R * 0.7, H * 0.85], [R + 12, R + 6, 0], 1.6, 1.6, 6, 'd');
    const g = m.glow(null, 0, 0, H + R * 0.55 + 2, 3, acc, 0.8); g.auto = true; b.blink = g;
  },
  // руина цеховой стены: рваный верх, пустые окна, обломки у основания
  wall(m, b, col, acc) {
    const L = b.L, top = [[-L, 0], [L, 0], [L, 26], [L * 0.62, 34], [L * 0.4, 21], [L * 0.05, 31], [-L * 0.3, 19], [-L * 0.55, 29], [-L, 23]];
    const p = m.prism(top, -7, 7, 'y', 'm');
    for (const wx of [-L * 0.55, -L * 0.1, L * 0.35]) { const w = 7; m.line(p.b, wx - w, -7, 8, wx + w, -7, 8, col, 0.8, 0.7); m.line(p.b, wx - w, -7, 16, wx + w, -7, 16, col, 0.8, 0.7); m.line(p.b, wx - w, -7, 8, wx - w, -7, 16, col, 0.8, 0.7); m.line(p.b, wx + w, -7, 8, wx + w, -7, 16, col, 0.8, 0.7); }
    m.line(p.b, -L + 3, -7, 3, L - 3, -7, 3, acc, 1, 0.55);
    m.box(L * 0.55, -16, 0, L * 0.75, -9, 6, 'd'); m.box(-L * 0.8, -15, 0, -L * 0.62, -8, 4, 'l');
  },
  // заводская труба: цоколь, сужающийся ствол с поясами, красный огонь сверху
  chimney(m, b, col, acc) {
    const H = b.H, f = m.box(-16, -16, 0, 16, 16, 14, 'd');
    m.line(f[2], -14, -16, 4, 14, -16, 4, acc, 1, 0.6);
    m.cyl(9, 6.5, 14, H, 10, 'm');
    for (const q of [0.35, 0.6, 0.85]) { const z = 14 + (H - 14) * q, r = 9 - 2.5 * q; m.cyl(r + 1.1, r + 1.1, z, z + 2, 10, 'l'); }
    const g = m.glow(null, 0, 0, H + 2, 4, '#ff4d5e', 1); g.auto = true; b.blink = g;
  },
  // жилая башня: ряды окон неоновыми полосами, угловая вывеска, антенна на крыше
  tower(m, b, col, acc) {
    const W = b.rot ? b.cols[0].hd : b.cols[0].hw, D = b.rot ? b.cols[0].hw : b.cols[0].hd, H = b.H;
    const f = m.box(-W, -D, 0, W, D, H, 'm');
    for (let z = 10, row = 0; z < H - 6; z += 9, row++) {
      for (let x = -W + 4, k = 0; x < W - 6; x += 9, k++) if (hash2(b.key, row * 7 + k, 3) < 0.62) m.line(f[2], x, -D, z, x + 6, -D, z, hash2(b.key, row, k) < 0.3 ? acc : '#c9bcff', 1.4, 0.95);
      for (let y = -D + 4, k = 0; y < D - 6; y += 9, k++) if (hash2(b.key, row * 5 + k, 9) < 0.5) m.line(f[1], W, y, z, W, y + 6, z, col, 1.2, 0.75);
    }
    m.line(f[2], -W + 1.5, -D, 6, -W + 1.5, -D, H - 6, acc, 1.4, 0.9);
    m.box(-W * 0.5, -D * 0.5, H, W * 0.3, D * 0.4, H + 7, 'l');
    m.strut([W * 0.5, 0, H], [W * 0.5, 0, H + 26], 0.6, 0.4, 4, 'd');
    const g = m.glow(null, W * 0.5, 0, H + 27, 3, acc, 1); g.auto = true; b.blink = g;
  },
  // билборд на двух опорах: экран с бегущими полосами-строками
  billboard(m, b, col, acc) {
    const L = b.L, z0 = 26, z1 = 56;
    for (const sx of [-1, 1]) m.strut([sx * L * 0.72, 0, 0], [sx * L * 0.72, 0, z0], 1.6, 1.4, 6, 'd');
    const f = m.box(-L, -3, z0, L, 3, z1, 'm');
    m.line(f[2], -L + 3, -3, z0 + 22, L * 0.4, -3, z0 + 22, acc, 1.6, 0.95);
    m.line(f[2], -L + 3, -3, z0 + 15, L - 6, -3, z0 + 15, col, 1.2, 0.8);
    m.line(f[2], -L + 3, -3, z0 + 8, L * 0.1, -3, z0 + 8, col, 1.2, 0.8);
    m.line(f[2], -L, -3, z0, L, -3, z0, acc, 1, 0.6);
  },
  // киоск: короб с наклонным козырьком и вывеской
  kiosk(m, b, col, acc) {
    const f = m.box(-17, -13, 0, 17, 13, 20, 'm');
    m.line(f[2], -12, -13, 5, 12, -13, 5, col, 1, 0.75); m.line(f[2], -12, -13, 13, 12, -13, 13, '#c9bcff', 1.2, 0.85);
    const r = m.box(-21, -18, 20, 21, 15, 23.5, 'l');
    m.line(r[2], -18, -18, 21.8, 18, -18, 21.8, acc, 1.6, 0.95);
    m.box(-9, -3, 23.5, 9, 3, 31, 'd'); m.line(null, -7, -3.2, 27, 7, -3.2, 27, acc, 1.4, 0.95);
  },
  // решётчатая мачта связи: четыре сходящиеся стойки, раскосы, мигающий огонь
  antenna(m, b, col, acc) {
    const H = b.H, r0 = 9, r1 = 2.5;
    const P4 = (r, z) => [[-r, -r, z], [r, -r, z], [r, r, z], [-r, r, z]];
    const lo = P4(r0, 0), hi = P4(r1, H);
    for (let i = 0; i < 4; i++) m.strut(lo[i], hi[i], 0.9, 0.6, 4, 'd');
    for (let k = 1; k < 6; k++) { const z = H * k / 6, r = r0 + (r1 - r0) * k / 6; const p = P4(r, z); for (let i = 0; i < 4; i++) m.line(null, ...p[i], ...p[(i + 1) % 4], col, 0.8, 0.7); }
    const g = m.glow(null, 0, 0, H + 3, 4, acc, 1); g.auto = true; b.blink = g;
  },
  // шпили Роя: кристаллические шестигранные иглы с прожилками
  spire(m, b, col, acc) {
    const R = b.R;
    const spikes = [[0, 0, 1, 1], [-R * 0.55, R * 0.25, 0.62, 0.7], [R * 0.5, -R * 0.2, 0.75, 0.55]];
    for (const [x, y, hs, rs] of spikes) {
      const h = b.H * hs, r = R * 0.42 * rs;
      m.push(); m.t(x, y, 0); m.rz(x * 0.1);
      const c = m.cyl(r, r * 0.75, 0, h, 6, 'm');
      m.cyl(r * 0.75, 0, h, h + r * 2.2, 6, 'l');
      m.line(null, 0, -r * 0.8, 2, 0, -r * 0.6, h * 0.9, acc, 1, 0.8);
      m.pop();
    }
  },
  // кокон-купол Роя: рёбра-меридианы и светящаяся щель
  pod(m, b, col, acc) {
    const R = b.R;
    m.cyl(R, R * 0.92, 0, 10, 10, 'd');
    m.cyl(R * 0.92, R * 0.55, 10, 28, 10, 'm');
    m.cyl(R * 0.55, 0, 28, b.H, 10, 'l');
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3, c = Math.cos(a), s = Math.sin(a); m.strut([c * R * 1.02, s * R * 1.02, 0], [c * R * 0.6, s * R * 0.6, 27], 1.1, 0.9, 4, 'd'); }
    const g = m.glow(null, 0, -R * 0.75, 15, 5, acc, 0.9); g.auto = true; b.blink = g;
    m.line(null, -4, -R * 0.78, 13, 4, -R * 0.78, 13, acc, 1.6, 1);
  },
  // арка: два ребра, сходящиеся вверху, — проход между опорами
  arch(m, b, col, acc) {
    const L = b.L, H = b.H, N = 6, pts = [];
    for (let i = 0; i <= N; i++) { const u = i / N, a = Math.PI * u; pts.push([-Math.cos(a) * L, 0, Math.sin(a) * H]); }
    for (let i = 0; i < N; i++) m.strut(pts[i], pts[i + 1], 3.2 - Math.sin(Math.PI * i / N) * 1.2, 3.2 - Math.sin(Math.PI * (i + 1) / N) * 1.2, 6, i % 2 ? 'm' : 'd');
    for (const sx of [-1, 1]) { m.push(); m.t(sx * L, 0, 0); m.cyl(7, 5, 0, 6, 6, 'l'); m.pop(); }
    const g = m.glow(null, 0, 0, H + 2, 4, acc, 0.9); g.auto = true; b.blink = g;
  },
};
function buildStructure(m, b, view) {
  const sid = G.sector.id, col = BLD.col[sid], acc = BLD.acc[sid];
  b.blink = null;
  m.push(); m.sc(1, floorFit(view), 1); if (b.rot) m.rz(Math.PI / 2);
  BLD_M[b.type](m, b, col, acc);
  m.pop();
  // мигающий огонь не запекается в кадр — рисуется поверх живьём
  if (b.blink) { b.blinkP = b.blink.p.slice(); b.blinkR = b.blink.r; b.blinkCol = b.blink.col; b.blink.al = 0; }
  else b.blinkP = null;
}
// постройка статична: один пререндеренный кадр на постройку (пересобирается при смене вида, проекции или разрешения)
function structSprite(b, view) {
  const key = view + RENDER.k.toFixed(3) + ':' + VFX.view + VFX.res.toFixed(2);
  if (b.spr && b.sk === key) return b.spr;
  delete VFX.cache.__bld;
  const S = vfxSprites('__bld', 1, m => buildStructure(m, b, view), structPal());
  delete VFX.cache.__bld;
  b.spr = S; b.sk = view + RENDER.k.toFixed(3) + ':' + VFX.view + VFX.res.toFixed(2);
  return S;
}
// палитра построек — как у робота: тёмное стекло граней с оттенком сектора и яркие рёбра его цвета
function structPal() {
  const col = BLD.col[G.sector.id], key = 'bld' + col;
  if (_vpal[key]) return _vpal[key];
  const base = vpal(col), C = hexToRgb, dc = deepen(col);
  const p = Object.assign({}, base, {
    T: { m: [C('#03060c'), C(mixHex('#0d1626', dc, 0.2)), 0.97], l: [C('#050a14'), C(mixHex('#142238', dc, 0.26)), 0.97], d: [C('#010307'), C(mixHex('#0a111d', dc, 0.14)), 0.98], r: base.T.r, a: [C(shade(dc, -0.6)), C(shade(dc, -0.15)), 0.96] },
    ln: mixHex(col, '#ffffff', 0.15), ls: shade(col, -0.2), ag: mixHex(col, '#ffffff', 0.3),
  });
  p.FS = fillSteps(p.T);
  return (_vpal[key] = p);
}
// постройка заслоняет робота — становится полупрозрачной
function structFade(b) {
  const cp = vfxCp(), top = b.y - b.ey - b.H * cp, inX = Math.abs(P.x - b.x) < b.ex + 16, behind = P.y < b.y + b.ey && P.y - upY(46) < b.y + b.ey && P.y > top - 10;
  const want = inX && behind ? 0.32 : 1;
  b.fade += (want - b.fade) * 0.18;
  return b.fade;
}
function drawStructure(c, b, z, e0, f0, view) {
  const S = structSprite(b, view), fade = structFade(b);
  worldT(c);
  vfxDraw(c, S, 0, b.x, b.y, 1, fade);
  if (b.blinkP) {
    const ph = VIEW_PITCH[view], X = b.blinkP[0], Y = b.blinkP[1], Z = b.blinkP[2];
    const al = (Math.sin(G.time * 3 + b.key) > 0.2 ? 1 : 0.25) * fade;
    glow(c, b.x + X, b.y + (-Y * Math.sin(ph) - Z * Math.cos(ph)) / RENDER.k, b.blinkR, b.blinkCol, al);
  }
}
// площадка постройки на полу: тёмное основание с контуром и угловыми засечками чертежа
function drawStructureGround(c) {
  if (!BLD_LIST.length) return;
  const col = BLD.col[G.sector.id];
  c.save();
  for (const b of BLD_LIST) {
    if (!onScreen(b, b.ex + 40)) continue;
    for (const s of b.cols) {
      c.fillStyle = 'rgba(0,0,0,0.42)'; c.strokeStyle = rgba(col, 0.38); c.lineWidth = 1;
      if (s.R) { c.beginPath(); c.arc(s.x, s.y, s.R + 5, 0, TAU); c.fill(); c.stroke(); continue; }
      const x0 = s.x - s.hw - 5, y0 = s.y - s.hd - 5, w = s.hw * 2 + 10, h = s.hd * 2 + 10;
      c.fillRect(x0, y0, w, h); c.strokeRect(x0, y0, w, h);
      c.strokeStyle = rgba(col, 0.75); c.beginPath();
      for (const [px, py, dx, dy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]]) { c.moveTo(px + dx * 9, py); c.lineTo(px, py); c.lineTo(px, py + dy * 9); }
      c.stroke();
    }
  }
  c.restore();
}

/* ===== Гнёзда Роя: цели, которые надо уничтожать =====
   Появляются за краем экрана (стрелка указывает), выпускают машины, через 45 с созревают и добавляют элиту.
   Уничтоженное гнездо разлетается по деталям и оставляет опыт, лом и часто контейнер с улучшением. */
const NEST = { first: 95, every: [70, 95], max: 2, cap: 14 };
function nestHp() { return expectedDps(minutes()) * 11 * Math.sqrt(G.alert || 1); }
function spawnNest() {
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), d = rand(520, 680), x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
    if (BLD_LIST.some(b => Math.abs(b.x - x) < b.ex + 70 && Math.abs(b.y - y) < b.ey + 70)) continue;
    if (HZ_LIST.some(h => (h.kind === 'fence' ? segD2(x, y, h.ax, h.ay, h.bx, h.by) : d2(h.x, h.y, x, y)) < 170 * 170)) continue;
    if (G.relay && d2(G.relay.x, G.relay.y, x, y) < 300 * 300) continue;
    const e = spawnEnemy('nest', x, y);
    e.hp = e.maxHp = nestHp(); e.ai = { cap: NEST.cap + Math.floor(minutes() / 3) * 2, cd: 2.2 };
    UI.banner('ГНЕЗДО РОЯ', 'Выпускает машины, пока цело — найдите по стрелке и уничтожьте', 'red');
    AUDIO.sfx('warn');
    return true;
  }
  return false;
}
function updateNests(dt) {
  if (G.nestT === undefined) G.nestT = NEST.first;
  G.nestT -= dt;
  if (G.nestT > 0) return;
  let alive = 0;
  for (const e of G.enemies) if (e.alive && e.tid === 'nest') alive++;
  if (alive >= NEST.max || G.bossesAlive || (!G.endless && G.time > RUN_LENGTH - 50)) { G.nestT = 8; return; }
  G.nestT = spawnNest() ? rand(NEST.every[0], NEST.every[1]) : 4;
}
function nestKilled(e) {
  G.kills++; G.nestKills = (G.nestKills || 0) + 1;
  const y0 = bodyY(e);
  crispBurst(e.x, e.y, 90, '#ff3b5c', y0); FX.explosion(e.x, e.y, 30, '#ff7a35', true); FX.addShake(6);
  AUDIO.sfx('boom', { big: true });
  // обломки: раскрытое гнездо разлетается по деталям
  const S = enemySprites('nest'), pal = enemyPal(G.sector.pal, e.T.acc, false);
  addWreck({ x: e.x, y: e.y, k: 1, dur: 1.1, D: 46, pal, build: t => eModelMesh('nest', e.T.r, 0, { ph: 0, mv: 0, t, pal, pose: 'open' }, S.zc) });
  const m = minutes(), xp = (14 + m * 4) * (e.xpK || 1);
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + rand(-0.2, 0.2); dropGem(e.x + Math.cos(a) * 26, e.y + Math.sin(a) * 26, xp / 6); }
  dropItem(e.x, e.y + 12, 'scrap', randi(3, 6));
  const chest = Math.random() < 0.6 * Math.min(1.5, P.stats.luck || 1);
  if (chest) dropItem(e.x, e.y - 12, 'chest');
  if (!P.od.active) P.od.meter = Math.min(100, P.od.meter + 12 * P.stats.odRate);
  UI.banner('ГНЕЗДО УНИЧТОЖЕНО', 'Опыт и лом' + (chest ? ' · контейнер с улучшением' : ''), 'gold');
}
