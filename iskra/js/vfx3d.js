'use strict';
/* ===== Снаряды и эффекты в 3D: модели в технике робота (стекло граней + светящиеся рёбра),
   один раз пререндерятся в кадры вращения или курса — сотни снарядов рисуются как картинки ===== */

/* ---------- Палитры: тёмное стекло, рёбра — насыщенный цвет орудия (как у робота; свечение не выбеливает) ---------- */
// глубокий оттенок: насыщенность вверх, светлота не выше 0,56
function deepen(col) {
  const [r, g, b] = hexToRgb(col).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  const L = Math.min(l, 0.56), S = Math.min(1, sat * 1.15 + 0.1), C2 = (1 - Math.abs(2 * L - 1)) * S, X = C2 * (1 - Math.abs((h / 60) % 2 - 1)), m = L - C2 / 2;
  const [r1, g1, b1] = h < 60 ? [C2, X, 0] : h < 120 ? [X, C2, 0] : h < 180 ? [0, C2, X] : h < 240 ? [0, X, C2] : h < 300 ? [X, 0, C2] : [C2, 0, X];
  const hx = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + hx(r1) + hx(g1) + hx(b1);
}
const _vpal = {};
// оболочка молнии/луча: насыщенный оттенок цвета (белое и почти белое остаётся как есть)
const _sheath = {};
function sheathCol(col) {
  let s = _sheath[col];
  if (s) return s;
  const [r, g, b] = hexToRgb(col), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return (_sheath[col] = mx - mn < 40 ? col : deepen(col));
}
function vpal(col0, metal) {
  const key = col0 + (metal ? 'M' : '');
  let p = _vpal[key];
  if (p) return p;
  const C = hexToRgb, col = metal ? col0 : deepen(col0);
  p = {
    T: {
      m: [C(mixHex('#050c1a', col, 0.06)), C(mixHex(metal ? '#46566e' : '#1d3d6c', col, metal ? 0.08 : 0.16)), 0.97],
      l: [C(mixHex('#081428', col, 0.07)), C(mixHex(metal ? '#7f90a8' : '#2c5a94', col, metal ? 0.1 : 0.2)), 0.97],
      d: [C('#02060d'), C(mixHex('#122036', col, 0.1)), 0.98],
      r: [C('#02050b'), C('#0c1626'), 0.98],
      a: [C(shade(col, -0.7)), C(shade(col, -0.2)), 0.96],
    },
    ln: metal ? mixHex('#dfe8f5', col, 0.3) : mixHex(col, '#ffffff', 0.12), ls: shade(col, -0.2), ag: mixHex(col, '#ffffff', 0.3),
    a: col, ad: shade(col, -0.35), e: '#ffffff', t: '#ffd36b', o: '#ffffff',
  };
  p.FS = fillSteps(p.T);
  return (_vpal[key] = p);
}

/* ---------- Атлас кадров: модель → n кадров (вращение или курс) с общим якорем ---------- */
const VFX = { view: null, res: 0, cache: {} };
// проекция модели в координатах мира кадра: экранные величины делятся на сжатие пола (см. floorK)
const vfxSp = () => Math.max(0.42, Math.sin(VIEW_PITCH[enemyView()] || 0.42)) / RENDER.k;
const vfxCp = () => Math.cos(VIEW_PITCH[enemyView()] || 0.42) / RENDER.k;
function vfxSprites(key, n, build, pal) {
  const view = enemyView(), res = clamp((VIEW.scale || 1) * (VIEW.dpr || 1) * 1.3, 1.6, 3.4);
  if (VFX.view !== view || Math.abs(VFX.res - res) > 0.35) { VFX.view = view; VFX.res = res; VFX.cache = {}; }
  let S = VFX.cache[key];
  if (S) return S;
  const phi = VIEW_PITCH[view], sp = Math.sin(phi), cp = Math.cos(phi), meshes = [];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let f = 0; f < n; f++) {
    const m = new Mesh(); m.zc = 0; build(m, f); meshes.push(m);
    for (const v of m.V) { const sx = v[0], sy = -v[1] * sp - v[2] * cp; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; }
  }
  const mg = 3.5; x0 -= mg; x1 += mg; y0 -= mg; y1 += mg;
  const pw = Math.max(2, Math.ceil((x1 - x0) * res)), ph = Math.max(2, Math.ceil((y1 - y0) * res)), ax = -x0 * res, ay = -y0 * res;
  const cv = meshes.map(m => { const c = makeCanvas(pw, ph), g = c.getContext('2d'); g.setTransform(res, 0, 0, res, ax, ay); renderMesh(g, m, pal, view, {}); return c; });
  S = { cv, pw, ph, ax, ay, res, n };
  return (VFX.cache[key] = S);
}
// кадр модели рисуется вертикально: высота растягивается обратно на сжатие пола
function vfxDraw(c, S, f, x, y, k, alpha) {
  const cv = S.cv[((f % S.n) + S.n) % S.n], s = (k || 1) / S.res, sy = s / RENDER.k;
  if (alpha !== undefined && alpha < 1) { const ga = c.globalAlpha; c.globalAlpha = ga * alpha; c.drawImage(cv, x - S.ax * s, y - S.ay * sy, S.pw * s, S.ph * sy); c.globalAlpha = ga; }
  else c.drawImage(cv, x - S.ax * s, y - S.ay * sy, S.pw * s, S.ph * sy);
}
// экранный курс → кадр (модель в кадре f смотрит в мировой угол f·2π/n)
const yawFrame = (a, n) => Math.round((((a % TAU) + TAU) % TAU) / TAU * n) % n;
// тень на полу под летящим предметом
function vfxShadow(c, x, y, r, a) {
  const sp = floorRy();
  c.globalAlpha = a; c.drawImage(shadowBlob(), x - r, y - r * sp, r * 2, r * 2 * sp); c.globalAlpha = 1;
}

/* ---------- Пила: зубчатый диск со ступицей и облегчающими окнами, наклонён к камере ---------- */
// пила: стальной диск, раскалённое кольцо зубьев, ступица; летит над полом, слегка наклонена к камере
const SAW_TILT = 0.35, SAW_H = 4;
function sawMesh(m, f, n, R, teeth) {
  m.push(); m.t(0, 0, SAW_H); m.rx(SAW_TILT); m.rz(f / n * TAU / 3);
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = i * TAU / teeth, da = TAU / teeth;
    pts.push([Math.cos(a0 + da * 0.62) * R, Math.sin(a0 + da * 0.62) * R]);
    pts.push([Math.cos(a0 + da * 0.9) * R * 0.86, Math.sin(a0 + da * 0.9) * R * 0.86]);
    pts.push([Math.cos(a0 + da) * R * 0.76, Math.sin(a0 + da) * R * 0.76]);
  }
  m.prism(pts, -0.45, 0.45, 'z', 'a');
  const inner = [];
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; inner.push([Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7]); }
  m.prism(inner, -0.7, 0.7, 'z', 'm');
  // три прорези-окна в диске
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5, cx = Math.cos(a) * R * 0.44, cy = Math.sin(a) * R * 0.44, s = R * 0.11; m.prism([[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]].map(([px, py]) => { const dx = px - cx, dy = py - cy, ca = Math.cos(a), sa = Math.sin(a); return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]; }), 0.7, 0.85, 'z', 'd'); }
  m.cyl(R * 0.2, R * 0.18, -1.4, 1.4, 8, 'd');
  m.pop();
}
// стальная палитра (пила, рукоять меча): тёмная сталь со стальными рёбрами (свечение её не выбеливает), акцент — цвет орудия
function steelPal(col) {
  const key = 'saw' + col;
  if (_vpal[key]) return _vpal[key];
  const base = vpal(col, true), C = hexToRgb, dc = deepen(col);
  const p = Object.assign({}, base, {
    T: Object.assign({}, base.T, { m: [C('#04070d'), C('#1c2636'), 0.98], a: [C(shade(dc, -0.6)), C(shade(dc, -0.12)), 0.97], d: [C('#010204'), C('#0a1019'), 0.99] }),
    ln: '#8ea2ba', ag: mixHex(dc, '#ffffff', 0.25), ls: '#4c5d73',
  });
  p.FS = fillSteps(p.T);
  return (_vpal[key] = p);
}
// дуги вращения по ободу (две «кометы») и линии скорости позади — чёткие, без свечения
function drawSaw3D(c, x, y, r, rot, col, big, vx, vy) {
  const S = vfxSprites(big ? 'bigsaw' : 'saw', 12, (m, f) => sawMesh(m, f, 12, 10, big ? 22 : 14), steelPal(col));
  const k = r / 10 * (big ? 1.25 : 1.5), f = Math.floor(((rot % (TAU / 3)) + TAU / 3) % (TAU / 3) / (TAU / 3) * 12), R = 10 * k;
  const sp = vfxSp(), cp = vfxCp(), cy = y - SAW_H * k * cp, ry = Math.cos(SAW_TILT) * sp + Math.sin(SAW_TILT) * cp, cs = sheathCol(col);
  vfxShadow(c, x, y, 8 * k, 0.4);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  const v = Math.hypot(vx || 0, vy || 0);
  if (v > 40) {
    const ux = vx / v, uy = vy / v, L = Math.min(R * 2.2, v * 0.07);
    for (const sd of [-1, 1]) {
      const sx = x - uy * sd * R * 0.85, sy = cy + ux * sd * R * 0.85 * ry, g = c.createLinearGradient(sx, sy, sx - ux * L, sy - uy * L);
      g.addColorStop(0, rgba(cs, 0.55)); g.addColorStop(1, rgba(cs, 0));
      c.strokeStyle = g; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - ux * L, sy - uy * L); c.stroke();
    }
  }
  c.restore();
  vfxDraw(c, S, f, x, cy + SAW_H * k * cp, k);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const h0 = -rot * 1.3 + i * Math.PI;
    for (let s = 0; s < 3; s++) {
      c.strokeStyle = s === 2 ? '#ffffff' : cs; c.globalAlpha = 0.25 + s * 0.28; c.lineWidth = 0.7 + s * 0.4;
      c.beginPath(); c.ellipse(x, cy, R * 1.1, R * 1.1 * ry, 0, h0 + s * 0.3, h0 + s * 0.3 + 0.32); c.stroke();
    }
  }
  c.restore();
}

/* ---------- Дроны: корпус-октагон, купол, сенсор, две пушки и четыре ротора; дрон гало — кольцо вокруг кристалла ---------- */
function droneMesh(m, f, n, halo, col) {
  m.push(); m.rz(-f / n * TAU);
  if (!halo) {
    // компактный дрон: сплюснутая шестигранная бипирамида и глаз по курсу
    m.cyl(1.4, 4.6, 2.2, 3.8, 6, 'm');
    m.cyl(4.6, 1.8, 3.8, 5.6, 6, 'l');
    const g = m.glow(null, 4.5, 0, 3.8, 1.1, '#ffffff', 0.9); g.auto = true;
  } else {
    // дрон гало: тот же силуэт дрона (не путать с кристаллами опыта), сверху — светящийся излучатель
    m.cyl(1.4, 4.8, 2.2, 3.8, 8, 'm');
    m.cyl(4.8, 2.0, 3.8, 5.2, 8, 'l');
    m.poly(OCTA.v.map(v => [v[0] * 1.5, v[1] * 1.5, v[2] * 1.9 + 6.4]), OCTA.f, 'a');
    const g = m.glow(null, 0, 0, 6.4, 1.6, '#ffffff', 0.85); g.auto = true;
  }
  m.pop();
}
const DRONE_H = 9;   // высота полёта дронов над полом
const droneEmit = sz => DRONE_H + 6.4 * sz / 8 * 1.7;   // высота излучателя гало-дрона (для лазера)
function drawDrone3D(c, x, y, ang, col, sz, halo, ph, hov) {
  const S = vfxSprites((halo ? 'halo' : 'drone') + col, 16, (m, f) => droneMesh(m, f, 16, halo, deepen(col)), vpal(col));
  const k = sz / 8 * 1.7, cp = vfxCp(), lift = ((hov || 0) + Math.sin(G.time * 6 + (ph || 0)) * 1.2) * cp;
  vfxShadow(c, x, y, 6 * k, hov ? 0.3 : 0.4);
  vfxDraw(c, S, yawFrame(ang, 16), x, y - lift, k);
  c.save(); c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.55; c.drawImage(dotSprite(col), x - 3 * k, y - 2.4 * k * cp - lift - 3 * k, 6 * k, 6 * k);   // тяга под корпусом
  c.restore();
}
// дрон на орбите вокруг корпуса: след-дуга по орбите позади (три сегмента: тонкий хвост → плотная голова), затем сам дрон
function drawDroneOrbit(c, cx, cy, a, R, dir, col, sz, halo, ph) {
  const cp = vfxCp(), oy = cy - DRONE_H * cp, cs = sheathCol(col);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.strokeStyle = cs;
  for (let s = 0; s < 3; s++) {
    const a0 = a - dir * (0.62 - s * 0.19), a1 = a - dir * (0.43 - s * 0.19) - dir * 0.02;
    c.globalAlpha = 0.14 + s * 0.17; c.lineWidth = 0.6 + s * 0.45;
    c.beginPath(); c.arc(cx, oy, R, Math.min(a0, a1), Math.max(a0, a1)); c.stroke();
  }
  c.restore();
  drawDrone3D(c, cx + Math.cos(a) * R, cy + Math.sin(a) * R, a + dir * Math.PI / 2, col, sz, halo, ph, DRONE_H);
}

/* ---------- Ракета: корпус, обтекатель, полоса, сопло и стабилизаторы крест-накрест ---------- */
// ракета: длинный шестигранный корпус тёмной стали, гранёный нос, цветной пояс и стабилизаторы, сопло;
// модель вдоль оси x, 32 курса — поворот плавный
const MSL_TAIL = 7.2;
function missileMesh(m, f, n) {
  const yaw = f / n * TAU;
  m.push(); m.rz(-yaw); m.ry(Math.PI / 2);
  m.cyl(1.3, 1.3, -6.2, 3.6, 6, 'm');
  m.cyl(1.3, 0.05, 3.6, 8.6, 6, 'l', true);
  m.cyl(1.42, 1.42, 0.8, 2.1, 6, 'a');
  m.cyl(0.95, 1.25, -MSL_TAIL, -6.2, 6, 'd');
  m.pop();
  m.push(); m.rz(-yaw);
  for (let k = 0; k < 4; k++) { m.push(); m.rx(k * Math.PI / 2 + Math.PI / 4); m.plate([[-6.2, 1.25], [-3.4, 1.25], [-6.3, 4.6], [-7.3, 4.6]], 'z', 0, 'a'); m.pop(); }
  m.pop();
}
// инверсионный след по траектории: у сопла — горячий и белый, дальше — тонкая остывающая синевато-серая линия
function missileTrail(c, tr, w) {
  if (!tr || tr.length < 2) return;
  c.save(); c.lineCap = 'round';
  const n = tr.length - 1;
  for (let i = 0; i < n; i++) {
    const q = 1 - i / n, A = tr[i], B = tr[i + 1];
    if (Math.abs(A.x - B.x) + Math.abs(A.y - B.y) > 60) break;
    c.strokeStyle = i < 3 ? rgba('#fff0c8', 0.85 * q) : rgba('#a8b8d4', 0.42 * q);
    c.lineWidth = (0.45 + 1.25 * q) * w;
    c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
  }
  c.restore();
}
function drawMissile3D(c, p, col, k) {
  if (p.delay > 0) return;
  k *= 1.45;
  const S = vfxSprites('missile2' + col, 32, (m, f) => missileMesh(m, f, 32), steelPal(col));
  const sp = vfxSp(), cp = vfxCp(), a = Math.atan2(p.vy, p.vx), h = (p.h || 0) * cp;
  const ca = Math.cos(a), sa = Math.sin(a) * sp, x = p.x, y = p.y - h;
  if (p.h > 4) vfxShadow(c, p.x, p.y, 4 * k, 0.32);
  missileTrail(c, p.tr, k * 0.8);
  // выхлоп: узкий язык пламени с белым ядром, длина дрожит; до зажигания — нет
  if (!(p.ign > 0)) {
    const tx = x - ca * MSL_TAIL * k, ty = y - sa * MSL_TAIL * k, fl = 0.7 + 0.3 * Math.sin(G.time * 70 + p.x * 0.3);
    const L = (6 + 5 * fl) * k, W = 1.05 * k;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.translate(tx, ty); c.rotate(Math.atan2(sa, ca) + Math.PI);
    c.fillStyle = rgba(sheathCol(col), 0.9); c.beginPath(); c.moveTo(0, -W); c.lineTo(L, 0); c.lineTo(0, W); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,248,225,0.95)'; c.beginPath(); c.moveTo(0, -W * 0.5); c.lineTo(L * 0.42, 0); c.lineTo(0, W * 0.5); c.closePath(); c.fill();
    c.restore();
  }
  vfxDraw(c, S, yawFrame(a, 32), x, y, k);
}
/* ---------- Гранёный огненный шар: неровная икосфера с плоской заливкой граней (низкополигональный взрыв) ---------- */
const FBALL_R = 16;
let _lump = null;
// подразбитый икосаэдр, каждая вершина на своём радиусе — «клуб», а не кристалл
function lumpMesh() {
  if (_lump) return _lump;
  const v = ICO.v.map(p => p.slice()), f = [], mid = {};
  const mp = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (mid[k] === undefined) { const p = v[a], q = v[b], x = p[0] + q[0], y = p[1] + q[1], z = p[2] + q[2], l = Math.hypot(x, y, z); v.push([x / l, y / l, z / l]); mid[k] = v.length - 1; }
    return mid[k];
  };
  for (const [a, b, c] of ICO.f) { const ab = mp(a, b), bc = mp(b, c), ca = mp(c, a); f.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  const R = v.map((p, i) => FBALL_R * (0.8 + 0.3 * (((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1)));
  // грани делятся на два тона; весь клуб — одним примитивом с центром в начале координат (нормали наружу)
  return (_lump = { v: v.map((p, i) => [p[0] * R[i], p[1] * R[i], p[2] * R[i] * 0.92]), fl: f.filter((_, i) => i % 5 !== 2), fm: f.filter((_, i) => i % 5 === 2) });
}
// огонь: освещённые грани светло-жёлтые, теневые — красно-оранжевые; остывший шар — тот же силуэт в тёмно-красном
function firePal(col, cool) {
  const key = (cool ? 'E' : 'F') + col;
  let p = _vpal[key];
  if (p) return p;
  const C = hexToRgb, hot = mixHex(cool ? '#e8642c' : '#ffe9a8', col, 0.12), lo = mixHex(cool ? '#8a2810' : '#e0501e', col, 0.15);
  p = {
    T: { l: [C(lo), C(hot), 1], m: [C(shade(lo, cool ? -0.12 : -0.25)), C(mixHex(lo, hot, 0.62)), 1], d: [C('#2a0c06'), C(lo), 1], r: [C('#2a0c06'), C(lo), 1], a: [C(lo), C(hot), 1] },
    ln: rgba(hot, cool ? 0.22 : 0.32), ls: rgba(lo, 0.4), ag: rgba(hot, 0.3), a: col, ad: lo, e: '#ffffff', t: '#ffd36b', o: '#ffffff',
  };
  p.FS = fillSteps(p.T);
  return (_vpal[key] = p);
}
const FBALL_N = 8;
// кадры — разные повороты одного клуба; часть граней на тон темнее — пятнистость огня
function fireBallSprites(col, cool) {
  return vfxSprites((cool ? 'eball' : 'fball') + col, FBALL_N, (m, f) => { const L = lumpMesh(); m.push(); m.rz(f * 2.4); m.rx(f * 1.3); m.poly(L.v, L.fl, 'l'); m.poly(L.v, L.fm, 'm'); m.pop(); }, firePal(col, cool));
}
// t — доля прожитой жизни: шар вспухает за первые 14 %, дальше сжимается и остывает (тот же кадр в тёмно-красной палитре)
function drawFireBall(c, p, cp) {
  const t = 1 - p.life / p.max, y = p.y - p.z * cp, fr = p.rot | 0;
  const s = p.size * (t < 0.14 ? 0.45 + 0.55 * Math.sqrt(t / 0.14) : 1 - 0.6 * (t - 0.14) / 0.86) / FBALL_R;
  if (t > 0.22) vfxDraw(c, fireBallSprites(p.col, true), fr, p.x, y, s, t > 0.56 ? 1 - (t - 0.56) / 0.44 : 1);
  if (t < 0.56) vfxDraw(c, fireBallSprites(p.col), fr, p.x, y, s, t < 0.3 ? 1 : 1 - (t - 0.3) / 0.26);
}
// взрыв ракеты: звезда-вспышка, тонкое кольцо по радиусу поражения, гранёные огненные шары, искры и осколки
function missileBlast(x, y, r, col) {
  FX.star(x, y - upY(3), Math.min(r * 0.2, 9), '#ffd9a0', 0.1);
  FX.ering(x, y, r * 0.25, r, 0.3, col, 1.5, true);
  const n = FX.parts.length > 1200 ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), d = i ? r * rand(0.16, 0.26) : 0, big = i === 0;
    FX.add({ k: 10, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, z: big ? r * 0.12 : rand(0, r * 0.08), vx: Math.cos(a) * r * (big ? 0 : 0.7), vy: Math.sin(a) * r * (big ? 0 : 0.45), vz: r * (big ? 0.9 : rand(0.4, 0.9)),
      life: big ? 0.5 : rand(0.36, 0.46), max: big ? 0.5 : 0.46, size: r * (big ? 0.3 : rand(0.17, 0.22)), col, drag: 3.6, rot: rand(0, FBALL_N) });
  }
  FX.sparks(x, y - upY(3), 8, '#ffd9a0', r * 6, undefined, 0, 0.24);
  FX.shards(x, y, 4, col, r * 3);
  FX.light(x, y, r * 1.6, col, 0.28, 0.24);
}

/* ---------- Световая глефа: металлическая двусторонняя рукоять + два энергоклинка со шлейфом ---------- */
const SABER_Z = 7, SABER_TILT = 0.6;
// плоскость вращения клинков наклонена к камере: видно весь оборот, а не только горизонталь
const saberE = () => Math.min(1, Math.sin((VIEW_PITCH[enemyView()] || 0.42) + SABER_TILT)) / RENDER.k;
// rot — угол рукояти; R — радиус до кончиков; tr — история положений {x, y, r} для шлейфа;
// ext — выдвижение клинков (0 — погашены, 1 — полные, >1 — удлинены); fl — вспышка зажигания 0..1
function drawSaber3D(c, x, y, rot, R, col, tr, ext, fl) {
  const cy = y - SABER_Z * vfxCp(), h0 = R * 0.3, e = saberE(), ca = Math.cos(rot), sa = Math.sin(rot) * e;
  ext = ext === undefined ? 1 : ext;
  const L = h0 + (R - h0) * ext, hum = 1 + Math.sin(G.time * 53 + x * 0.7) * 0.12;
  c.save(); c.globalCompositeOperation = 'lighter';
  // шлейф: лента между настоящими прошлыми положениями клинков — меч и летит, и крутится
  if (ext > 0.3 && tr && tr.length > 1) {
    for (let i = 0; i < tr.length - 1; i++) {
      const A = tr[i], B = tr[i + 1], q = 1 - (i + 1) / tr.length;
      // только соседние кадры: после паузы или рывка лента не тянется через пол-экрана
      if (A.t - B.t > 0.05 || Math.abs(A.x - B.x) + Math.abs(A.y - B.y) > L * 0.8) break;
      const a0 = Math.cos(A.r), b0 = Math.sin(A.r) * e, a1 = Math.cos(B.r), b1 = Math.sin(B.r) * e;
      c.fillStyle = rgba(col, 0.03 + q * 0.1);
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(A.x + a0 * L * 0.7 * s, A.y + b0 * L * 0.7 * s); c.lineTo(A.x + a0 * L * s, A.y + b0 * L * s);
        c.lineTo(B.x + a1 * L * s, B.y + b1 * L * s); c.lineTo(B.x + a1 * L * 0.7 * s, B.y + b1 * L * 0.7 * s);
        c.closePath(); c.fill();
      }
    }
  }
  // ближний к камере конец оси (глубина конца s пропорциональна s·sin(rot)·cos(наклон камеры + наклон плоскости)):
  // его клинок выходит из видимого торца эмиттера и рисуется поверх рукояти, дальний — под ней
  const near = Math.sin(rot) * Math.cos((VIEW_PITCH[enemyView()] || 0.42) + SABER_TILT) >= 0 ? 1 : -1;
  if (ext > 0.02) saberBlade(c, x, cy, ca, sa, h0, L, R, col, hum, -near);
  // вспышка зажигания у эмиттеров
  if (fl > 0) {
    c.globalAlpha = fl;
    for (const s of [-1, 1]) { const ex = x + ca * h0 * s, ey = cy + sa * h0 * s; c.drawImage(dotSprite(col), ex - R * 0.28, ey - R * 0.28, R * 0.56, R * 0.56); }
    c.globalAlpha = 1;
  }
  c.restore();
  // рукоять: гранёная модель между дальним и ближним клинком
  drawHilt3D(c, x, cy, rot, h0, col);
  if (ext > 0.02) { c.save(); c.globalCompositeOperation = 'lighter'; saberBlade(c, x, cy, ca, sa, h0, L, R, col, hum, near); c.restore(); }
}
// клинок со стороны s: белое ядро и насыщенная оболочка от торца эмиттера; ядро чуть дрожит — «гудит»
function saberBlade(c, x, cy, ca, sa, h0, L, R, col, hum, s) {
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(x + ca * h0 * s, cy + sa * h0 * s); c.lineTo(x + ca * L * s, cy + sa * L * s);
  c.strokeStyle = rgba(col, 0.2); c.lineWidth = R * 0.2 * hum; c.stroke();
  c.strokeStyle = rgba(mixHex(col, '#ffffff', 0.3), 0.9); c.lineWidth = R * 0.085; c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = R * 0.034 * hum; c.stroke();
}
// гранёная рукоять: шестигранный хват с двумя рёбрами, расширяющиеся раструбы-эмиттеры и цветные кольца излучателей.
// Ось рукояти лежит в той же наклонённой плоскости, что и клинки (см. saberE), поэтому совпадает с ними при любом угле.
// Рукоять симметрична, поэтому модели кешируются по углу через каждый градус в пределах полуоборота
const HILT_L = 4, _hilt = {};
function hiltMesh(rot) {
  const key = Math.round(((rot % Math.PI) + Math.PI) % Math.PI / Math.PI * 180) % 180;
  if (_hilt[key]) return _hilt[key];
  const r = key / 180 * Math.PI, cr = Math.cos(r), sr = Math.sin(r), ct = Math.cos(SABER_TILT), st = Math.sin(SABER_TILT);
  const A = [cr, -sr * ct, -sr * st], B = [-sr, -cr * ct, -cr * st], N = [0, st, -ct];
  const m = new Mesh(); m.zc = 0;
  m.push(); m.mul([B[0], N[0], A[0], 0, B[1], N[1], A[1], 0, B[2], N[2], A[2], 0]);
  m.cyl(1.12, 1.12, -2.3, 2.3, 6, 'm');
  m.cyl(1.45, 1.45, -1.45, -0.85, 6, 'd'); m.cyl(1.45, 1.45, 0.85, 1.45, 6, 'd');
  m.cyl(1.72, 1.18, -3.5, -2.3, 8, 'l'); m.cyl(1.18, 1.72, 2.3, 3.5, 8, 'l');
  m.cyl(1.8, 1.8, -HILT_L, -3.5, 8, 'a'); m.cyl(1.8, 1.8, 3.5, HILT_L, 8, 'a');
  m.pop();
  return (_hilt[key] = m);
}
function drawHilt3D(c, x, y, rot, h0, col) {
  const k = h0 / HILT_L;
  c.save(); c.translate(x, y); c.scale(k, k / RENDER.k);
  renderMesh(c, hiltMesh(rot), steelPal(col), enemyView(), {});
  c.restore();
}
function saberTrail(tr, x, y, rot) { tr.unshift({ x, y: y - SABER_Z * vfxCp(), r: rot, t: G.time }); if (tr.length > 3) tr.length = 3; return tr; }

/* ---------- Импульс бластера: плазменная комета — круглая голова с белым ядром и острый затухающий хвост ----------
   края чёткие, прозрачность оболочки спадает к концу хвоста; свечение даёт общий проход bloom */
const _boltGr = {};
// градиент оболочки в локальных координатах импульса: от носа (w) до кончика хвоста (-L)
function boltGrad(c, cs, w, L) {
  const key = cs + w.toFixed(1) + '|' + L;
  let g = _boltGr[key];
  if (!g) { g = c.createLinearGradient(w, 0, -L, 0); g.addColorStop(0, rgba(cs, 0.95)); g.addColorStop(0.3, rgba(cs, 0.8)); g.addColorStop(1, rgba(cs, 0)); _boltGr[key] = g; }
  return g;
}
function drawBolt3D(c, p) {
  const col = p.col || '#46e3ff', cs = sheathCol(col), a = Math.atan2(p.vy, p.vx);
  const w = 0.6 + p.r * 0.5, L = Math.round(10 + p.r * 3.4), g = Math.min(1, p.t / 0.07);
  c.save(); c.translate(p.x, p.y); c.rotate(a);
  // вылет из ствола: хвост дорастает за 0,07 с, чтобы не торчать назад из пушки
  if (g < 1) c.scale(0.3 + 0.7 * g, 1);
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = boltGrad(c, cs, w, L);
  c.beginPath(); c.arc(0, 0, w, -Math.PI / 2, Math.PI / 2); c.lineTo(-L, 0); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.95)';
  c.beginPath(); c.arc(0, 0, w * 0.45, -Math.PI / 2, Math.PI / 2); c.lineTo(-L * 0.55, 0); c.closePath(); c.fill();
  c.restore();
}
// попадание импульса: короткая звезда в цвет выстрела и брызги искр назад, к стрелку
function boltHit(p) {
  const col = p.col || '#46e3ff', a = Math.atan2(p.vy, p.vx);
  FX.star(p.x, p.y, 2.5 + p.r * 0.55, col, 0.09);
  FX.sparks(p.x, p.y, 3, mixHex(col, '#ffffff', 0.4), 240, a + Math.PI, 0.9, 0.14);
}

/* ---------- Плазменная сфера аннигилятора: икосаэдр, вращается, вокруг — треск ---------- */
function drawOrb3D(c, p) {
  const S = vfxSprites('orb', 8, (m, f) => { m.push(); m.rx(0.5); m.rz(f / 8 * TAU / 5); m.poly(ICO.v.map(v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l * 5, v[1] / l * 5, v[2] / l * 5]; }), ICO.f, f % 2 ? 'l' : 'a'); m.pop(); }, vpal(p.col || '#bff6ff'));
  const k = p.r / 5;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.35; c.drawImage(dotSprite(p.col), p.x - p.r * 1.5, p.y - p.r * 1.5, p.r * 3, p.r * 3);
  c.restore();
  vfxDraw(c, S, Math.floor(G.time * 14 + p.x * 0.1), p.x, p.y, k * 1.25);

}

/* ---------- Мина: диск с куполом, кольцом и тремя упорами; бомбочка кластера; ледяной осколок ---------- */
// мина: шестигранный корпус с цветной полосой, купол-детонатор, три лапы-упора. Падает с подскоком,
// раскрывается; на взводе от неё расходится тонкое кольцо до радиуса срабатывания и остаётся пунктир
function drawMine3D(c, a) {
  const S = vfxSprites('mine' + a.col, 1, m => {
    m.cyl(5.2, 5.6, 0, 1.5, 6, 'd');
    m.cyl(5.75, 5.75, 0.55, 1.05, 6, 'a');
    m.cyl(3.0, 1.8, 1.5, 3.0, 6, 'm');
    for (let i = 0; i < 3; i++) { const an = i * TAU / 3 + 0.5; m.strut([Math.cos(an) * 4.8, Math.sin(an) * 4.8, 0.6], [Math.cos(an) * 7.6, Math.sin(an) * 7.6, 0], 0.55, 0.38, 4, 'm'); }
  }, vpal(a.col));
  const u = clamp(a.t / a.arm, 0, 1), armed = a.t >= a.arm, cp = vfxCp();
  const drop = a.t < 0.22 ? (1 - ease.outBounce(a.t / 0.22)) * 14 : 0, q = 0.7 + 0.3 * ease.outBack(clamp(a.t / 0.3, 0, 1)), K = 1.75 * q;
  if (armed) {
    const ta = a.t - a.arm;
    c.save(); c.globalCompositeOperation = 'lighter';
    if (ta < 0.35) { const v = ease.outCubic(ta / 0.35); c.strokeStyle = rgba(a.col, 0.8 * (1 - v)); c.lineWidth = 1.4; c.beginPath(); c.arc(a.x, a.y, 6 + (a.r - 6) * v, 0, TAU); c.stroke(); }
    c.strokeStyle = rgba(a.col, 0.22); c.lineWidth = 1; c.setLineDash([3, 5]); c.lineDashOffset = -G.time * 6;
    c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.stroke(); c.setLineDash([]);
    c.restore();
  }
  vfxShadow(c, a.x, a.y, 10, 0.4);
  vfxDraw(c, S, 0, a.x, a.y - drop * cp, K);
  // огонёк детонатора: при взведении мигает красным всё чаще
  const blink = armed && Math.sin(G.time * 12 + a.x) > 0, ly = a.y - 3.2 * K * cp - drop * cp;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.fillStyle = blink ? '#ff4d5e' : armed ? a.col : rgba(a.col, 0.4 + 0.6 * u);
  c.beginPath(); c.arc(a.x, ly, blink ? 2.2 : 1.6, 0, TAU); c.fill();
  if (blink) { c.strokeStyle = rgba('#ff4d5e', 0.6); c.lineWidth = 1; c.beginPath(); c.arc(a.x, ly, 4.5, 0, TAU); c.stroke(); }
  c.restore();
}
function drawBomblet3D(c, p) {
  const S = vfxSprites('bomblet', 8, (m, f) => { m.push(); m.t(0, 0, 2.5); m.rx(f / 8 * TAU); m.ry(0.6); m.cyl(1.6, 1.6, -1.6, 1.0, 8, 'm'); m.cyl(1.6, 0.3, 1.0, 2.4, 8, 'a'); m.cyl(1.0, 1.0, -2.4, -1.6, 6, 'd'); m.pop(); }, vpal('#fff08a'));
  c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(dotSprite('#fff08a'), p.x - 5, p.y - 5, 10, 10); c.restore();
  vfxDraw(c, S, Math.floor(p.t * 24), p.x, p.y, 1.35);
}
function drawShard3D(c, p) {
  const S = vfxSprites('shard', 16, (m, f) => { m.push(); m.t(0, 0, 3); m.rz(-f / 16 * TAU); m.poly(OCTA.v.map(v => [v[0] * 6, v[1] * 1.7, v[2] * 1.7]), OCTA.f, f % 2 ? 'l' : 'a'); m.pop(); }, vpal('#8fe8ff'));
  c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(dotSprite('#8fe8ff'), p.x - 6, p.y - 6, 12, 12); c.restore();
  vfxDraw(c, S, yawFrame(Math.atan2(p.vy, p.vx), 16), p.x, p.y, 1.35);
}

/* ---------- Взрывы: объёмный огненный шар, дым, обломки по баллистике ---------- */
const _fireSpr = {};
function fireSprite(col) {
  let s = _fireSpr[col];
  if (s) return s;
  s = makeCanvas(64, 64);
  const c = s.getContext('2d'), g = c.createRadialGradient(24, 21, 1, 30, 30, 30);
  g.addColorStop(0, '#fffbe8'); g.addColorStop(0.18, mixHex('#ffe08a', col, 0.2)); g.addColorStop(0.45, mixHex('#ff9a3d', col, 0.35)); g.addColorStop(0.75, mixHex('#c2361b', col, 0.3)); g.addColorStop(0.93, rgba(mixHex('#5a1208', col, 0.2), 0.85)); g.addColorStop(1, 'rgba(40,8,4,0)');
  c.fillStyle = g; c.beginPath(); c.arc(30, 30, 30, 0, TAU); c.fill();
  return (_fireSpr[col] = s);
}
let _smokeSpr = null;
function smokeSprite() {
  if (_smokeSpr) return _smokeSpr;
  const s = makeCanvas(64, 64), c = s.getContext('2d'), g = c.createRadialGradient(24, 22, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(150,162,182,0.85)'); g.addColorStop(0.45, 'rgba(72,82,100,0.75)'); g.addColorStop(0.8, 'rgba(36,42,54,0.45)'); g.addColorStop(1, 'rgba(20,24,32,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return (_smokeSpr = s);
}
function chunkSprites() {
  return vfxSprites('chunk', 8, (m, f) => { m.push(); m.rx(f / 8 * TAU); m.rz(f * 0.7); m.poly([[2.2, 0, 0], [-1.2, 1.8, 0.4], [-1, -1.6, 0.9], [0.2, 0.2, -2]], [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], f % 2 ? 'm' : 'd'); m.pop(); }, vpal('#ffb36b', true));
}
/* ---------- Языки пламени: капля с раскалённым низом, для огненных луж ---------- */
const _flameSpr = {};
function flameSprite(col) {
  let s = _flameSpr[col];
  if (s) return s;
  s = makeCanvas(32, 48);
  const c = s.getContext('2d'), g = c.createLinearGradient(0, 46, 0, 2);
  g.addColorStop(0, 'rgba(255,250,225,0.95)'); g.addColorStop(0.3, rgba(mixHex('#ffd36b', col, 0.4), 0.9)); g.addColorStop(0.65, rgba(col, 0.6)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g;
  c.beginPath(); c.moveTo(16, 2); c.bezierCurveTo(30, 20, 30, 34, 26, 40); c.bezierCurveTo(22, 47, 10, 47, 6, 40); c.bezierCurveTo(2, 34, 2, 20, 16, 2); c.fill();
  return (_flameSpr[col] = s);
}
function drawFirePool(c, a) {
  const q = Math.min(1, a.life / a.max * 3), col = a.col || '#ff5a1f', t = G.time, ry = floorRy();
  // зона: тонкий эллипс по краю и едва заметная заливка — без светящегося пятна
  c.globalAlpha = q;
  c.fillStyle = rgba(col, 0.1); c.strokeStyle = rgba(col, 0.42); c.lineWidth = 1;
  c.beginPath(); c.ellipse(a.x, a.y, a.r, a.r * ry, 0, 0, TAU); c.fill(); c.stroke();
  // языки пламени: две плоские грани (освещённая и теневая) и светлая сердцевина; дальние рисуются первыми
  const lit = mixHex(col, '#ffd36b', 0.5), dark = mixHex(col, '#b8301a', 0.45), core = '#fff1c4', n = a.r > 40 ? 6 : 4, F = [];
  for (let i = 0; i < n; i++) {
    const ph = (t * 1.5 + i / n + a.x * 0.013) % 1, k = 0.8 + 0.4 * ((i * 0.618 + a.y * 0.007) % 1);
    F.push({ x: a.x + Math.cos(i * 2.4 + a.y) * a.r * 0.52, y: a.y + Math.sin(i * 1.7 + a.x) * a.r * 0.52 * ry, h: a.r * k * (0.25 + 0.75 * Math.sin(ph * Math.PI)), al: ph > 0.8 ? (1 - ph) / 0.2 : 1, sw: Math.sin(t * 7 + i * 1.9) * 0.35 });
  }
  F.sort((u, v) => u.y - v.y);
  for (const f of F) {
    const h = upY(f.h), w = Math.max(2.4, f.h * 0.34), tx = f.x + f.sw * w;
    c.globalAlpha = q * f.al;
    // капля из семи вершин: пузатый низ, сужение и изогнутый кончик; шов по оси делит её на две грани
    const b0 = f.y + w * 0.3 * ry, mx = f.x + (tx - f.x) * 0.35;
    c.fillStyle = lit; c.beginPath(); c.moveTo(f.x, b0); c.lineTo(f.x - w * 0.85, f.y); c.lineTo(f.x - w, f.y - h * 0.26); c.lineTo(mx - w * 0.55, f.y - h * 0.6); c.lineTo(tx, f.y - h); c.lineTo(mx, f.y - h * 0.5); c.closePath(); c.fill();
    c.fillStyle = dark; c.beginPath(); c.moveTo(f.x, b0); c.lineTo(mx, f.y - h * 0.5); c.lineTo(tx, f.y - h); c.lineTo(mx + w * 0.5, f.y - h * 0.62); c.lineTo(f.x + w * 0.95, f.y - h * 0.24); c.lineTo(f.x + w * 0.8, f.y); c.closePath(); c.fill();
    c.fillStyle = core; c.beginPath(); c.moveTo(f.x, b0 - w * 0.1); c.lineTo(f.x - w * 0.5, f.y - h * 0.08); c.lineTo(f.x - w * 0.42, f.y - h * 0.3); c.lineTo(f.x + (tx - f.x) * 0.5, f.y - h * 0.55); c.lineTo(f.x + w * 0.4, f.y - h * 0.28); c.lineTo(f.x + w * 0.45, f.y - h * 0.06); c.closePath(); c.fill();
  }
  c.globalAlpha = 1;
}
/* ---------- Нанорой: крошечные огранённые наниты на наклонённых орбитах вокруг корпуса ----------
   front — рисовать только тех, кто ближе к камере (второй проход поверх робота), иначе — дальних */
function nanoSwarm(c, x, y, R, col, n, t, front, zc, rings) {
  const sp = vfxSp(), cp = vfxCp(), RN = rings || 3, per = Math.ceil(n / RN), edge = mixHex(col, '#ffffff', 0.25);
  c.lineJoin = 'round'; c.lineWidth = 0.9;
  for (let k = 0; k < n; k++) {
    const ring = k % RN, idx = Math.floor(k / RN), tilt = 0.32 + ring * 0.05, az = ring * TAU / RN + 0.4;
    const th = t * (1.2 + ring * 0.3) * (ring % 2 ? -1 : 1) + idx * TAU / per, r = R * (0.6 + 0.25 * Math.sin(idx * 1.7 + ring));
    const px = Math.cos(th) * r, py0 = Math.sin(th) * r, y1 = py0 * Math.cos(tilt), z1 = py0 * Math.sin(tilt);
    const x2 = px * Math.cos(az) - y1 * Math.sin(az), y2 = px * Math.sin(az) + y1 * Math.cos(az);
    if (front !== undefined && ((-y2 * cp + z1 * sp) > 0) !== front) continue;
    const sx = x + x2, sy = y - y2 * sp - (z1 + zc) * cp, s = 1.9 + (k % 3) * 0.55, ro = t * 5 + k * 1.3;
    c.beginPath();
    for (let i = 0; i < 3; i++) { const a = ro + i * TAU / 3, rr = i ? s : s * 1.5; i ? c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.8) : c.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.8); }
    c.closePath(); c.fillStyle = rgba(col, 0.32); c.fill(); c.strokeStyle = edge; c.stroke();
  }
}
/* ---------- Сингулярность гравитона: гранёный чёрный кристалл над полом и кометные дуги аккреционного диска ---------- */
function singulSprite() {
  return vfxSprites('singul', 10, (m, f) => { m.push(); m.rx(0.55); m.rz(f / 10 * TAU / 5); m.poly(ICO.v.map(v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l * 10, v[1] / l * 10, v[2] / l * 10]; }), ICO.f, 'd'); m.pop(); }, vpal('#b98cff'));
}
// кольца диска: каждая дуга — «комета» из 4 сегментов (яркая голова, тонкий хвост); задняя половина — за ядром, передняя — перед
function holeDisc(c, x, cy, R, t, col, a, sp, front) {
  const B = R * 2 + 40, head = mixHex(col, '#ffffff', 0.55);
  c.save(); c.translate(x, cy); c.rotate(-0.16);
  c.beginPath(); c.rect(-B, front ? 0 : -B, B * 2, B); c.clip();
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const rr = R * (0.34 + i * 0.22), ry = rr * sp * 0.6, w = t * (2.3 - i * 0.5) * (1 + 18 / Math.max(rr, 18)) * 0.6, nS = 2 + i, L = 1.15 - i * 0.15, A = (0.95 - i * 0.22) * a;
    for (let s = 0; s < nS; s++) {
      const h0 = w + s * TAU / nS + i * 1.3;
      for (let k = 0; k < 4; k++) {
        c.strokeStyle = rgba(k === 0 ? head : col, A * (1 - k * 0.22)); c.lineWidth = Math.max(0.5, (2 - i * 0.35) * (1 - k * 0.24));
        c.beginPath(); c.ellipse(0, 0, rr, ry, 0, h0 - L * (k + 1) / 4, h0 - L * k / 4); c.stroke();
      }
    }
  }
  c.restore();
}
function drawHole3D(c, x, y, R, t, col, a) {
  if (!(R >= 2) || !isFinite(x) || !isFinite(y)) return;
  const sp = vfxSp(), cp = vfxCp(), rc = clamp(R * 0.12, 5, 13), cy = y - (rc + 7) * cp;
  c.save();
  // провал на полу: тёмный эллипс и тонкий край зоны притяжения
  const fr = floorRy();
  c.globalAlpha = 0.55 * a; c.fillStyle = '#000000'; c.beginPath(); c.ellipse(x, y, R * 0.5, R * 0.5 * fr, 0, 0, TAU); c.fill();
  c.globalAlpha = 0.22 * a; c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([5, 7]); c.lineDashOffset = t * 10;
  c.beginPath(); c.ellipse(x, y, R, R * fr, 0, 0, TAU); c.stroke(); c.setLineDash([]);
  c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
  holeDisc(c, x, cy, R, t, col, a, sp, false);
  c.globalCompositeOperation = 'source-over';
  // ядро: гранёный кристалл; фотонное кольцо — тонкая окружность с бегущим бликом
  vfxDraw(c, singulSprite(), Math.floor(t * 9), x, cy, rc / 10 * 1.1, a);
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba(col, 0.75 * a); c.lineWidth = 1.1; c.beginPath(); c.arc(x, cy, rc * 1.45, 0, TAU); c.stroke();
  c.strokeStyle = rgba('#ffffff', 0.85 * a); c.lineWidth = 1.2; c.lineCap = 'round'; c.beginPath(); c.arc(x, cy, rc * 1.45, t * 2.2, t * 2.2 + 0.9); c.stroke();
  holeDisc(c, x, cy, R, t, col, a, sp, true);
  c.restore();
}
// зерно сингулярности в полёте: тот же кристалл, маленький, с двумя орбитальными бликами
function drawGravSeed(c, p) {
  const cp = vfxCp(), cy = p.y - 9 * cp;
  vfxShadow(c, p.x, p.y + 9 * cp, 6, 0.35);
  vfxDraw(c, singulSprite(), Math.floor(G.time * 16), p.x, cy, 0.45);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineWidth = 1.1;
  const t = G.time * 9;
  for (let k = 0; k < 2; k++) { const a0 = t + k * Math.PI; c.strokeStyle = rgba(k ? '#c08bff' : '#ffffff', 0.9); c.beginPath(); c.ellipse(p.x, cy, 8, 8 * vfxSp() * 0.7, -0.16, a0, a0 + 1.2); c.stroke(); }
  c.restore();
}
// схлопывание поля: имплозия без огненного шара — эллипс по полу, шестиугольник, осколки
// ударная волна: невысокая светящаяся стена-кольцо — круг на полу, тот же круг на высоте h и рёбра между ними
function drawShockWall(c, a) {
  const q = 1 - a.life / a.max, R = Math.max(2, a.r), cp = vfxCp(), h = 15 * (1 - q * 0.75), al = 1 - q * q, x = a.x, y = a.y, top = y - h * cp;
  c.save(); c.globalCompositeOperation = 'lighter';
  // внутренняя сторона дальней половины и наружная сторона ближней — полупрозрачные полосы
  c.fillStyle = rgba(a.col, 0.1 * al);
  c.beginPath(); c.moveTo(x + R, y); c.arc(x, y, R, 0, Math.PI, true); c.lineTo(x - R, top); c.arc(x, top, R, Math.PI, TAU); c.closePath(); c.fill();
  c.fillStyle = rgba(a.col, 0.2 * al);
  c.beginPath(); c.moveTo(x + R, y); c.arc(x, y, R, 0, Math.PI); c.lineTo(x - R, top); c.arc(x, top, R, Math.PI, 0, true); c.closePath(); c.fill();
  // рёбра стены
  c.strokeStyle = rgba(a.col, 0.45 * al); c.lineWidth = 0.9; c.beginPath();
  const n = R > 60 ? 28 : 18, r0 = (a.rot || 0) + q * 0.5;
  for (let i = 0; i < n; i++) { const an = r0 + i * TAU / n, px = x + Math.cos(an) * R, py = y + Math.sin(an) * R; c.moveTo(px, py); c.lineTo(px, py - h * cp); }
  c.stroke();
  // кромки: яркий круг на полу, тонкий сверху, рябь позади фронта
  c.strokeStyle = rgba(sheathCol(a.col), al); c.lineWidth = 2.2; c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
  c.strokeStyle = rgba('#ffffff', 0.85 * al); c.lineWidth = 0.9; c.stroke();
  c.strokeStyle = rgba(mixHex(a.col, '#ffffff', 0.5), 0.7 * al); c.lineWidth = 1; c.beginPath(); c.arc(x, top, R, 0, TAU); c.stroke();
  if (R > 20) { c.strokeStyle = rgba(a.col, 0.35 * al); c.lineWidth = 1; c.beginPath(); c.arc(x, y, R * 0.8, 0, TAU); c.stroke(); }
  c.restore();
}
// чёткий удар без огненного шара: тонкие волны по полу, шестигранник, искры-штрихи, осколки
function crispBurst(x, y, R, col, cy) {
  if (cy === undefined) cy = y - 6 * vfxCp();
  FX.ering(x, y, 6, R * 1.25, 0.46, col, 2.2, true);
  FX.ering(x, y, 4, R * 0.75, 0.3, '#ffffff', 1, true);
  FX.hexRing(x, cy, 3, Math.min(R * 0.3, 34), 0.22, '#ffffff', 1.3);
  FX.dot(x, cy, 0, 0, 0.07, Math.min(R * 0.1, 12), '#ffffff', 0);
  FX.sparks(x, cy, 12, mixHex(col, '#ffffff', 0.6), R * 4.2, undefined, 0, 0.3);
  FX.shards(x, y, 8, col, R * 3);
  FX.light(x, y, R * 1.1, col, 0.3, 0.3);
}
function gravBurst(x, y, R, col) {
  FX.ering(x, y, R, R * 0.04, 0.16, '#e6d6ff', 1.4, true);          // всё стягивается в точку
  crispBurst(x, y, R, col, y - (clamp(R * 0.12, 5, 13) + 7) * vfxCp()); // и выплёвывается тонкой волной по полу
}
