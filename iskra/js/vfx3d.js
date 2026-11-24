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
const vfxSp = () => Math.max(0.42, Math.sin(VIEW_PITCH[enemyView()] || 0.42));
const vfxCp = () => Math.cos(VIEW_PITCH[enemyView()] || 0.42);
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
function vfxDraw(c, S, f, x, y, k, alpha) {
  const cv = S.cv[((f % S.n) + S.n) % S.n], s = (k || 1) / S.res;
  if (alpha !== undefined && alpha < 1) { const ga = c.globalAlpha; c.globalAlpha = ga * alpha; c.drawImage(cv, x - S.ax * s, y - S.ay * s, S.pw * s, S.ph * s); c.globalAlpha = ga; }
  else c.drawImage(cv, x - S.ax * s, y - S.ay * s, S.pw * s, S.ph * s);
}
// экранный курс → кадр (модель в кадре f смотрит в мировой угол f·2π/n)
const yawFrame = (a, n) => Math.round((((a % TAU) + TAU) % TAU) / TAU * n) % n;
// тень на полу под летящим предметом
function vfxShadow(c, x, y, r, a) {
  const sp = vfxSp();
  c.globalAlpha = a; c.drawImage(shadowBlob(), x - r, y - r * sp, r * 2, r * 2 * sp); c.globalAlpha = 1;
}

/* ---------- Пила: зубчатый диск со ступицей и облегчающими окнами, наклонён к камере ---------- */
function sawMesh(m, f, n, R, teeth, col) {
  m.push(); m.rx(0.6); m.rz(f / n * TAU / 3);
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = i * TAU / teeth, da = TAU / teeth;
    pts.push([Math.cos(a0 + da * 0.62) * R, Math.sin(a0 + da * 0.62) * R]);
    pts.push([Math.cos(a0 + da * 0.9) * R * 0.87, Math.sin(a0 + da * 0.9) * R * 0.87]);
    pts.push([Math.cos(a0 + da) * R * 0.78, Math.sin(a0 + da) * R * 0.78]);
  }
  m.prism(pts, -0.5, 0.5, 'z', 'm');
  const inner = [];
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; inner.push([Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62]); }
  m.prism(inner, -0.85, 0.85, 'z', 'l');
  m.cyl(R * 0.22, R * 0.2, -1.6, 1.6, 8, 'd');
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; m.ring(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, 0.9, R * 0.1, 'z', col, 0.7, 0.6); }
  m.pop();
}
function drawSaw3D(c, x, y, r, rot, col, big) {
  const dc = deepen(col), S = vfxSprites(big ? 'bigsaw' : 'saw', 12, (m, f) => sawMesh(m, f, 12, 10, big ? 22 : 14, dc), vpal(col));
  const k = r / 10 * (big ? 1.25 : 1.5), f = Math.floor(((rot % (TAU / 3)) + TAU / 3) % (TAU / 3) / (TAU / 3) * 12), R = 10 * k;
  vfxShadow(c, x, y + 10 * k, 8 * k, 0.4);
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.2; c.drawImage(glowSprite(dc), x - R * 1.2, y - R * 1.2, R * 2.4, R * 2.4); c.restore();
  vfxDraw(c, S, f, x, y, k);
  // кромка в движении: светящееся кольцо по зубьям
  c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(dc, 0.55); c.lineWidth = 1.4;
  c.beginPath(); c.ellipse(x, y, R * 0.98, R * 0.98 * 0.84, 0, 0, TAU); c.stroke(); c.restore();
}

/* ---------- Дроны: корпус-октагон, купол, сенсор, две пушки и четыре ротора; дрон гало — кольцо вокруг кристалла ---------- */
function droneMesh(m, f, n, halo, col) {
  m.push(); m.rz(-f / n * TAU);
  if (!halo) {
    // компактный дрон: сплюснутая шестигранная бипирамида, глаз по курсу, кольцо винта сверху
    m.cyl(1.4, 4.6, 2.2, 3.8, 6, 'm');
    m.cyl(4.6, 1.8, 3.8, 5.6, 6, 'l');
    const g = m.glow(null, 4.5, 0, 3.8, 1.1, '#ffffff', 0.9); g.auto = true;
    m.ring(0, 0, 6.1, 5.2, 'z', col, 1, 0.55);
  } else {
    // дрон гало: кристалл-излучатель в кольце
    m.poly(OCTA.v.map(v => [v[0] * 2.6, v[1] * 2.6, v[2] * 3.6 + 4.4]), OCTA.f, 'a');
    m.ring(0, 0, 4.4, 5.2, 'z', col, 1, 0.6);
  }
  m.pop();
}
function drawDrone3D(c, x, y, ang, col, sz, halo, ph) {
  const S = vfxSprites((halo ? 'halo' : 'drone') + col, 16, (m, f) => droneMesh(m, f, 16, halo, deepen(col)), vpal(col));
  const k = sz / 8 * (halo ? 1.4 : 1.5), bob = Math.sin(G.time * 6 + (ph || 0)) * 1.2 * vfxCp();
  vfxShadow(c, x, y, 6 * k, 0.4);
  vfxDraw(c, S, yawFrame(ang, 16), x, y - bob, k);
  c.save(); c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.55; c.drawImage(dotSprite(col), x - 3 * k, y - 2.4 * k * vfxCp() - bob - 3 * k, 6 * k, 6 * k);   // тяга под корпусом
  c.restore();
}

/* ---------- Ракета: корпус, обтекатель, полоса, сопло и стабилизаторы крест-накрест ---------- */
function missileMesh(m, f, n) {
  const yaw = f / n * TAU;
  m.push(); m.rz(-yaw); m.ry(Math.PI / 2);
  m.cyl(1.45, 1.45, -5.2, 2.6, 8, 'l');
  m.cyl(1.45, 0.12, 2.6, 6.8, 8, 'l');
  m.cyl(1.55, 1.55, 0.5, 1.8, 8, 'a');
  m.cyl(1.0, 1.35, -6.3, -5.2, 8, 'd');
  m.pop();
  m.push(); m.rz(-yaw);
  for (let k = 0; k < 4; k++) { m.push(); m.rx(k * Math.PI / 2 + Math.PI / 4); m.plate([[-5.2, 1.2], [-2.9, 1.2], [-5.7, 3.7], [-6.4, 3.7]], 'z', 0, 'a'); m.pop(); }
  m.pop();
}
function drawMissile3D(c, p, col, k) {
  k *= 1.7;
  const S = vfxSprites('missile' + col, 16, (m, f) => missileMesh(m, f, 16), vpal(col));
  const sp = vfxSp(), cp = vfxCp(), a = Math.atan2(p.vy, p.vx), h = (p.h || 0) * cp;
  const ca = Math.cos(a), sa = Math.sin(a) * sp, x = p.x, y = p.y - h;
  if (p.h > 4) vfxShadow(c, p.x, p.y, 5 * k, 0.3);
  // выхлоп: белое ядро → жёлтый → оранжевый, мерцает
  const tx = x - ca * 6.3 * k, ty = y - sa * 6.3 * k, L = (9 + Math.random() * 5) * k;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.drawImage(dotSprite('#ffb35c'), tx - 6 * k, ty - 6 * k, 12 * k, 12 * k);
  c.translate(tx, ty); c.rotate(Math.atan2(sa, ca) + Math.PI / 2);
  c.drawImage(flameSprite('#ff7a2e'), -1.8 * k, -L * 0.15, 3.6 * k, L * 1.15);
  c.restore();
  vfxDraw(c, S, yawFrame(a, 16), x, y, k);
}

/* ---------- Световая глефа: металлическая двусторонняя рукоять + два энергоклинка со шлейфом ---------- */
const SABER_Z = 7, SABER_TILT = 0.6;
// плоскость вращения клинков наклонена к камере: видно весь оборот, а не только горизонталь
const saberE = () => Math.min(1, Math.sin((VIEW_PITCH[enemyView()] || 0.42) + SABER_TILT));
// rot — угол рукояти; R — радиус до кончиков; tr — история положений {x, y, r} для шлейфа
function drawSaber3D(c, x, y, rot, R, col, tr) {
  const cy = y - SABER_Z * vfxCp(), h0 = R * 0.26, e = saberE(), ca = Math.cos(rot), sa = Math.sin(rot) * e;
  c.save(); c.globalCompositeOperation = 'lighter';
  // шлейф: лента между настоящими прошлыми положениями клинков — меч и летит, и крутится
  if (tr && tr.length > 1) {
    for (let i = 0; i < tr.length - 1; i++) {
      const A = tr[i], B = tr[i + 1], q = 1 - (i + 1) / tr.length;
      const a0 = Math.cos(A.r), b0 = Math.sin(A.r) * e, a1 = Math.cos(B.r), b1 = Math.sin(B.r) * e;
      c.fillStyle = rgba(col, 0.05 + q * 0.17);
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(A.x + a0 * R * 0.5 * s, A.y + b0 * R * 0.5 * s); c.lineTo(A.x + a0 * R * s, A.y + b0 * R * s);
        c.lineTo(B.x + a1 * R * s, B.y + b1 * R * s); c.lineTo(B.x + a1 * R * 0.5 * s, B.y + b1 * R * 0.5 * s);
        c.closePath(); c.fill();
      }
    }
  }
  // клинки: белое ядро, насыщенное свечение слоями
  c.lineCap = 'round';
  const body = mixHex(col, '#ffffff', 0.35);
  c.beginPath();
  for (const s of [-1, 1]) { c.moveTo(x + ca * h0 * s, cy + sa * h0 * s); c.lineTo(x + ca * R * s, cy + sa * R * s); }
  c.strokeStyle = rgba(col, 0.1); c.lineWidth = R * 0.44; c.stroke();
  c.strokeStyle = rgba(col, 0.3); c.lineWidth = R * 0.24; c.stroke();
  c.strokeStyle = rgba(body, 0.95); c.lineWidth = R * 0.1; c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = R * 0.036; c.stroke();
  c.restore();
  // рукоять: короткий тёмный стержень строго по оси клинков, светлая кромка
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - ca * h0, cy - sa * h0); c.lineTo(x + ca * h0, cy + sa * h0);
  c.strokeStyle = '#141c28'; c.lineWidth = R * 0.14; c.stroke();
  c.strokeStyle = '#7d90aa'; c.lineWidth = R * 0.045; c.stroke();
}
function saberTrail(tr, x, y, rot) { tr.unshift({ x, y: y - SABER_Z * vfxCp(), r: rot }); if (tr.length > 4) tr.length = 4; return tr; }

/* ---------- Плазменная сфера аннигилятора: икосаэдр, вращается, вокруг — треск ---------- */
function drawOrb3D(c, p) {
  const S = vfxSprites('orb', 8, (m, f) => { m.push(); m.rx(0.5); m.rz(f / 8 * TAU / 5); m.poly(ICO.v.map(v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l * 5, v[1] / l * 5, v[2] / l * 5]; }), ICO.f, f % 2 ? 'l' : 'a'); m.pop(); }, vpal(p.col || '#bff6ff'));
  const k = p.r / 5;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.75; c.drawImage(dotSprite(p.col), p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
  c.restore();
  vfxDraw(c, S, Math.floor(G.time * 14 + p.x * 0.1), p.x, p.y, k * 1.25);
  if (Math.random() < 0.25) { const a = rand(0, TAU); FX.lightning(p.x, p.y, p.x + Math.cos(a) * p.r * 2.4, p.y + Math.sin(a) * p.r * 2.4, '#e0fbff', 0.8, 0.06, p.r * 0.6); }
}

/* ---------- Мина: диск с куполом, кольцом и тремя упорами; бомбочка кластера; ледяной осколок ---------- */
function drawMine3D(c, a) {
  const S = vfxSprites('mine' + a.col, 1, m => {
    m.cyl(5, 5.2, 0, 1.4, 12, 'd');
    m.cyl(5.35, 5.35, 0.5, 1.0, 12, 'a');
    m.cyl(3.0, 1.7, 1.4, 2.8, 10, 'm');
    for (let i = 0; i < 3; i++) { const an = i * TAU / 3 + 0.4; m.strut([Math.cos(an) * 4.6, Math.sin(an) * 4.6, 0.6], [Math.cos(an) * 7.2, Math.sin(an) * 7.2, 0], 0.5, 0.35, 4, 'm'); }
  }, vpal(a.col));
  const armed = a.t >= a.arm, q = armed ? 1 : 0.55 + 0.45 * ease.outBack(clamp(a.t / a.arm, 0, 1));
  vfxShadow(c, a.x, a.y, 10, 0.4);
  vfxDraw(c, S, 0, a.x, a.y, 1.4 * q);
  const blink = armed && Math.sin(G.time * 12 + a.x) > 0, ly = a.y - 2.9 * 1.4 * vfxCp();
  c.save(); c.globalCompositeOperation = 'lighter';
  c.drawImage(dotSprite(blink ? '#ff4d5e' : a.col), a.x - 5, ly - 5, 10, 10);
  if (blink) c.drawImage(glowSprite('#ff4d5e'), a.x - 12, ly - 12, 24, 24);
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
  const q = Math.min(1, a.life / a.max * 3), col = a.col || '#ff5a1f', t = G.time;
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.3 * q; c.drawImage(dotSprite(col), a.x - a.r * 1.2, a.y - a.r * 0.75, a.r * 2.4, a.r * 1.5);
  const n = a.r > 40 ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const ph = (t * 1.7 + i / n + a.x * 0.013) % 1, fx = a.x + Math.cos(i * 2.4 + a.y) * a.r * 0.5, fy = a.y + Math.sin(i * 1.7 + a.x) * a.r * 0.28;
    const h = a.r * (0.55 + 0.45 * Math.sin(ph * Math.PI)), w = a.r * 0.28;
    c.globalAlpha = q * (1 - ph * 0.8) * 0.85;
    c.drawImage(flameSprite(col), fx - w, fy - h * (1 + ph * 0.6), w * 2, h * 1.5);
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
}
