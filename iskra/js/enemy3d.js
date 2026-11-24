'use strict';
/* ===== Рой в 3D: модели машин, предрасчёт спрайтов по ракурсам, элита вживую, обломки ===== */

// палитра машин Роя: тёмное стекло с тёплым отливом, раскалённые рёбра цвета сектора, акцентные узлы — цвет типа (у элиты — золото)
const _ePalCache = {};
function enemyPal(SP, acc, elite) {
  const key = SP.enemy + SP.enemyD + acc + (elite ? 'E' : '');
  let p = _ePalCache[key];
  if (p) return p;
  const C = hexToRgb, gold = '#ffd36b', A = elite ? gold : acc;
  p = {
    T: {
      m: [C(mixHex('#07060c', SP.enemyD, 0.7)), C(mixHex('#232539', SP.enemy, 0.24)), 0.96],
      l: [C(mixHex('#09080f', SP.enemyD, 0.6)), C(mixHex('#303352', SP.enemy, 0.3)), 0.96],
      d: [C('#040408'), C(mixHex('#16182b', SP.enemy, 0.16)), 0.97],
      r: [C('#020204'), C('#0c0c16'), 0.98],
      a: [C(shade(A, -0.72)), C(shade(A, -0.18)), 0.93],
    },
    ln: elite ? mixHex(SP.enemy, gold, 0.4) : SP.enemy, ls: mixHex(SP.enemy, SP.enemyD, 0.4), ag: shade(A, 0.3),
    a: A, acc, e: SP.eye, el: SP.enemyL,
  };
  p.FS = fillSteps(p.T);
  _ePalCache[key] = p;
  return p;
}

/* --- общие узлы моделей --- */
// фаза шага ноги: sw — вынос вперёд/назад, up — подъём стопы
function legPh(ph, off) { const a = (ph + off) * TAU; return { sw: Math.sin(a), up: Math.max(0, Math.cos(a)) }; }
function leg2(m, root, knee, foot, r0, r1, tone) { m.strut(root, knee, r0, r0 * 0.85, 4, tone, true); m.strut(knee, foot, r0 * 0.78, r1, 4, tone === 'm' ? 'l' : tone, true); }
function eEye(m, face, x, y, z, rr, col) { if (face) { m.glow(face, x, y, z, rr * 2.6, col, 0.85); m.glow(face, x, y, z, rr * 0.8, '#ffffff', 0.95); } else { const g = m.glow(null, x, y, z, rr * 2.6, col, 0.85); g.auto = true; } }
function bicone(m, x, y, z, rw, h0, h1, n, tone, tone2) { m.push(); m.t(x, y, z); m.cyl(rw * 0.42, rw, -h0, 0, n, tone, true); m.cyl(rw, rw * 0.4, 0, h1, n, tone2 || tone, true); m.pop(); }

/* ===== Модели. Локально: x — вправо, y — вперёд (морда), z — вверх; единицы — мира, r — радиус столкновения ===== */
const EM = {
  // Клещ: плоский клещ-дрон на шести лапах, бежит трёхногой походкой
  bug: { frames: 4, fps: 11, build(m, r, ps) {
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const y0 = (0.32 - i * 0.36) * r, L = legPh(ps.ph, ((i + (s > 0 ? 0 : 1)) % 2) * 0.5), sw = L.sw * 0.24 * r * ps.mv, up = L.up * 0.26 * r * ps.mv;
      m.side = s;
      leg2(m, [s * 0.45 * r, y0, 0.55 * r], [s * 0.98 * r, y0 + sw * 0.5 + (1 - i) * 0.16 * r, 0.98 * r + up * 0.4], [s * 1.3 * r, y0 + sw + (1 - i) * 0.38 * r, up], 0.09 * r, 0.035 * r, 'm');
    }
    m.side = 0;
    m.prism([[0, -0.95 * r], [0.55 * r, -0.52 * r], [0.6 * r, 0.12 * r], [0.3 * r, 0.52 * r], [-0.3 * r, 0.52 * r], [-0.6 * r, 0.12 * r], [-0.55 * r, -0.52 * r]], 0.36 * r, 0.76 * r, 'z', 'm');
    m.prism([[0, -0.62 * r], [0.34 * r, -0.32 * r], [0.34 * r, 0.24 * r], [-0.34 * r, 0.24 * r], [-0.34 * r, -0.32 * r]], 0.76 * r, 0.94 * r, 'z', 'l');
    const hd = m.box(-0.32 * r, 0.48 * r, 0.36 * r, 0.32 * r, 0.96 * r, 0.72 * r, 'd');
    eEye(m, hd[3], 0, 0.97 * r, 0.56 * r, 0.16 * r, ps.pal.e);
    for (const s of [-1, 1]) m.strut([s * 0.2 * r, 0.93 * r, 0.44 * r], [s * 0.06 * r, 1.36 * r, 0.3 * r], 0.1 * r, 0.02 * r, 3, 'a', true);
  } },
  // Броневик: шестигранный бронекупол на четырёх тумбах-лапах, забрало цвета типа
  tank: { frames: 4, fps: 6, build(m, r, ps) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const L = legPh(ps.ph, sx * sy > 0 ? 0 : 0.5), sw = L.sw * 0.16 * r * ps.mv, up = L.up * 0.16 * r * ps.mv;
      m.side = sx;
      m.strut([sx * 0.66 * r, sy * 0.5 * r, 0.42 * r], [sx * 1.0 * r, sy * 0.78 * r + sw, 0.3 * r + up], 0.17 * r, 0.14 * r, 5, 'l', true);
      m.box(sx * 1.0 * r - 0.2 * r, sy * 0.78 * r + sw - 0.24 * r, up, sx * 1.0 * r + 0.2 * r, sy * 0.78 * r + sw + 0.24 * r, up + 0.15 * r, 'd');
    }
    m.side = 0;
    m.cyl(1.04 * r, 1.04 * r, 0.26 * r, 0.44 * r, 6, 'd', true);
    const dome = m.cyl(0.98 * r, 0.66 * r, 0.44 * r, 1.0 * r, 6, 'm', true);
    for (let i = 0; i < 6; i++) if (dome.s[i]) m.line(dome.s[i], Math.cos(i * TAU / 6 + 0.52) * 0.82 * r, Math.sin(i * TAU / 6 + 0.52) * 0.82 * r, 0.6 * r, Math.cos(i * TAU / 6 + 0.52) * 0.7 * r, Math.sin(i * TAU / 6 + 0.52) * 0.7 * r, 0.9 * r, ps.pal.ls, 0.8, 0.7);
    m.cyl(0.4 * r, 0.32 * r, 1.0 * r, 1.13 * r, 6, 'l', true);
    const vz = m.box(-0.36 * r, 0.7 * r, 0.5 * r, 0.36 * r, 0.98 * r, 0.72 * r, 'a');
    eEye(m, vz[3], 0, 0.99 * r, 0.61 * r, 0.14 * r, ps.pal.e);
  } },
  // Искровик: летучий дрон-камикадзе — светящийся заряд-октаэдр на четырёх роторах
  kami: { frames: 2, fps: 14, fly: true, build(m, r, ps) {
    m.push(); m.t(0, 0, 1.55 * r);
    m.cyl(0.02, 0.7 * r, -0.72 * r, 0, 4, 'a', true); m.cyl(0.7 * r, 0.02, 0, 0.72 * r, 4, 'a', true);
    const g = m.glow(null, 0, 0, 0, 1.1 * r, ps.pal.a, 0.75); g.auto = true;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * 1.15 * r, y = Math.sin(a) * 1.15 * r;
      m.strut([Math.cos(a) * 0.3 * r, Math.sin(a) * 0.3 * r, 0], [x, y, 0.12 * r], 0.09 * r, 0.07 * r, 4, 'm', true);
      m.push(); m.t(x, y, 0.14 * r); const d = m.cyl(0.42 * r, 0.42 * r, 0, 0.06 * r, 8, 'd');
      if (d.cap1) { const b = ps.ph * TAU + i * 0.8; m.line(d.cap1, Math.cos(b) * 0.4 * r, Math.sin(b) * 0.4 * r, 0.065 * r, -Math.cos(b) * 0.4 * r, -Math.sin(b) * 0.4 * r, 0.065 * r, ps.pal.el, 1.1, 0.9); }
      m.pop();
    }
    m.pop();
  } },
  // Стрелок: треногий шагатель с башней и длинным стволом
  gunner: { frames: 4, fps: 7, build(m, r, ps) {
    for (let i = 0; i < 3; i++) {
      const th = -Math.PI / 2 + i * TAU / 3, cx = Math.cos(th), cy = Math.sin(th), L = legPh(ps.ph, i / 3), lift = L.up * 0.22 * r * ps.mv, sw = L.sw * 0.14 * r * ps.mv;
      m.side = cx > 0.1 ? 1 : cx < -0.1 ? -1 : 0;
      leg2(m, [cx * 0.42 * r, cy * 0.42 * r, 1.05 * r], [cx * 1.0 * r, cy * 1.0 * r, 1.32 * r + lift * 0.4], [cx * 1.28 * r, cy * 1.28 * r + sw, lift], 0.11 * r, 0.05 * r, 'm');
    }
    m.side = 0;
    const body = m.cyl(0.78 * r, 0.62 * r, 0.94 * r, 1.5 * r, 8, 'm');
    m.cyl(0.62 * r, 0.26 * r, 1.5 * r, 1.74 * r, 8, 'l');
    if (body.s[2]) eEye(m, null, 0, 0.72 * r, 1.36 * r, 0.12 * r, ps.pal.e);
    m.push(); m.t(0, 0.42 * r, 1.22 * r);
    m.barrel(0.17 * r, 0.15 * r, 0, 1.25 * r, 6, 'a');
    m.barrel(0.25 * r, 0.25 * r, 1.02 * r, 1.3 * r, 6, 'd');
    m.anchor('muzzle', 0, 1.34 * r, 0, 0, 1, 0);
    m.pop();
  } },
  // Рогач: четвероногий таран с рогом; поза разгона — пригнулся, поза броска — вытянулся
  charger: { frames: 4, fps: 7, poses: ['walk', 'wind', 'dash'], build(m, r, ps) {
    const crouch = ps.pose === 'wind' ? 1 : 0, dash = ps.pose === 'dash' ? 1 : 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const L = legPh(ps.ph, sx * sy > 0 ? 0 : 0.5);
      let sw = L.sw * 0.26 * r * ps.mv, up = L.up * 0.22 * r * ps.mv;
      if (crouch) { sw = sy * 0.14 * r; up = 0; }
      if (dash) { sw = sy > 0 ? 0.5 * r : -0.5 * r; up = 0.12 * r; }
      m.side = sx;
      leg2(m, [sx * 0.42 * r, sy * 0.5 * r, 0.62 * r - crouch * 0.14 * r], [sx * 0.62 * r, sy * 0.52 * r + sw * 0.5, 0.36 * r + up * 0.6 - crouch * 0.08 * r], [sx * 0.64 * r, sy * 0.56 * r + sw, up * 0.5], 0.13 * r, 0.08 * r, 'm');
    }
    m.side = 0;
    m.push();
    if (crouch) { m.t(0, 0.3 * r, 0.5 * r); m.rx(-0.24); m.t(0, -0.3 * r, -0.62 * r); }
    if (dash) { m.t(0, 0, 0.06 * r); m.rx(-0.08); }
    m.prism([[-0.95 * r, 0.5 * r], [0.55 * r, 0.42 * r], [0.95 * r, 0.72 * r], [0.4 * r, 1.15 * r], [-0.7 * r, 1.05 * r]], -0.55 * r, 0.55 * r, 'x', 'm');
    for (const s of [-1, 1]) m.prism([[-0.6 * r, 0.6 * r], [0.35 * r, 0.55 * r], [0.25 * r, 0.98 * r], [-0.5 * r, 0.92 * r]], s * 0.55 * r, s * 0.63 * r, 'x', 'l');
    m.strut([0, 0.9 * r, 0.82 * r], [0, 1.78 * r, 1.0 * r], 0.25 * r, 0.02, 5, 'a', true);
    for (const s of [-1, 1]) m.strut([s * 0.4 * r, 0.62 * r, 1.02 * r], [s * 0.62 * r, 0.95 * r, 1.4 * r], 0.1 * r, 0.02, 4, 'a', true);
    for (const s of [-1, 1]) eEye(m, null, s * 0.26 * r, 0.82 * r, 0.9 * r, 0.09 * r, ps.pal.e);
    if (crouch) { const g = m.glow(null, 0, 1.5 * r, 0.95 * r, 0.7 * r, ps.pal.a, 0.8); g.auto = true; }
    m.pop();
  } },
  // Делитель: три капсулы вокруг ядра, при гибели распадается
  splitter: { frames: 4, fps: 6, build(m, r, ps) {
    const k = 1 + Math.sin(ps.ph * TAU) * 0.06;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + i * TAU / 3, x = Math.cos(a) * 0.46 * r, y = Math.sin(a) * 0.46 * r, L = legPh(ps.ph, i / 3);
      m.strut([x * 1.2, y * 1.2, 0.42 * r], [x * 1.85, y * 1.85 + L.sw * 0.1 * r * ps.mv, L.up * 0.12 * r * ps.mv], 0.08 * r, 0.04 * r, 4, 'd', true);
      bicone(m, x, y, 0.78 * r, 0.56 * r * k, 0.44 * r, 0.42 * r, 6, 'm', 'l');
    }
    m.push(); m.t(0, 0, 1.08 * r); m.cyl(0.02, 0.3 * r, -0.32 * r, 0, 4, 'a', true); m.cyl(0.3 * r, 0.02, 0, 0.32 * r, 4, 'a', true); m.pop();
    const g = m.glow(null, 0, 0, 1.08 * r, 0.75 * r, ps.pal.a, 0.8); g.auto = true;
  } },
  // Осколок: одна капсула на трёх быстрых лапках
  mini: { frames: 4, fps: 13, build(m, r, ps) {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * TAU / 3, cx = Math.cos(a), cy = Math.sin(a), L = legPh(ps.ph, i / 3);
      m.strut([cx * 0.35 * r, cy * 0.35 * r, 0.6 * r], [cx * 1.15 * r, cy * 1.15 * r + L.sw * 0.25 * r * ps.mv, L.up * 0.25 * r * ps.mv], 0.1 * r, 0.04 * r, 4, 'm', true);
    }
    bicone(m, 0, 0, 0.9 * r, 0.7 * r, 0.5 * r, 0.5 * r, 6, 'm', 'l');
    eEye(m, null, 0, 0.62 * r, 0.95 * r, 0.14 * r, ps.pal.a);
  } },
  // Щитоносец: двуногий носильщик с изогнутым щитом и излучателем
  shielder: { frames: 4, fps: 6, build(m, r, ps) {
    for (const s of [-1, 1]) {
      const L = legPh(ps.ph, s > 0 ? 0 : 0.5), sw = L.sw * 0.22 * r * ps.mv, up = L.up * 0.16 * r * ps.mv;
      m.side = s;
      leg2(m, [s * 0.32 * r, -0.05 * r, 0.76 * r], [s * 0.38 * r, 0.12 * r + sw * 0.5, 0.42 * r + up], [s * 0.38 * r, sw, up], 0.15 * r, 0.11 * r, 'm');
      m.box(s * 0.38 * r - 0.17 * r, sw - 0.2 * r, up, s * 0.38 * r + 0.17 * r, sw + 0.32 * r, up + 0.12 * r, 'd');
    }
    m.side = 0;
    m.box(-0.46 * r, -0.4 * r, 0.72 * r, 0.46 * r, 0.32 * r, 1.36 * r, 'm');
    const hd = m.box(-0.22 * r, -0.12 * r, 1.36 * r, 0.22 * r, 0.26 * r, 1.6 * r, 'd');
    eEye(m, hd[3], 0, 0.27 * r, 1.48 * r, 0.1 * r, ps.pal.e);
    m.strut([0, -0.25 * r, 1.36 * r], [0, -0.3 * r, 2.0 * r], 0.05 * r, 0.04 * r, 4, 'l', true);
    const g = m.glow(null, 0, -0.3 * r, 2.05 * r, 0.42 * r, ps.pal.a, 0.85 + Math.sin(ps.ph * TAU) * 0.15); g.auto = true;
    for (let k = -1; k <= 1; k++) { m.push(); m.rz(-k * 0.55); m.t(0, 0.82 * r, 0); m.prism([[-0.34 * r, 0.22 * r], [0.34 * r, 0.22 * r], [0.3 * r, 1.52 * r], [-0.3 * r, 1.52 * r]], -0.05 * r, 0.05 * r, 'y', 'a'); m.pop(); }
  } },
  // Ремонтник: парящий крест-дрон с манипуляторами и кольцом
  medic: { frames: 2, fps: 10, fly: true, build(m, r, ps) {
    m.push(); m.t(0, 0, 1.3 * r);
    m.box(-0.92 * r, -0.24 * r, -0.2 * r, 0.92 * r, 0.24 * r, 0.2 * r, 'm'); m.box(-0.24 * r, -0.92 * r, -0.2 * r, 0.24 * r, 0.92 * r, 0.2 * r, 'm');
    m.box(-0.62 * r, -0.09 * r, 0.2 * r, 0.62 * r, 0.09 * r, 0.28 * r, 'a'); m.box(-0.09 * r, -0.62 * r, 0.2 * r, 0.09 * r, 0.62 * r, 0.28 * r, 'a');
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, x = Math.cos(a) * 0.92 * r, y = Math.sin(a) * 0.92 * r;
      m.push(); m.t(x, y, 0.2 * r); const d = m.cyl(0.32 * r, 0.32 * r, 0, 0.05 * r, 8, 'd');
      if (d.cap1) { const b = ps.ph * TAU + i; m.line(d.cap1, Math.cos(b) * 0.3 * r, Math.sin(b) * 0.3 * r, 0.055 * r, -Math.cos(b) * 0.3 * r, -Math.sin(b) * 0.3 * r, 0.055 * r, ps.pal.el, 1, 0.9); }
      m.pop();
    }
    for (const s of [-1, 1]) { m.strut([s * 0.3 * r, 0.3 * r, -0.2 * r], [s * 0.42 * r, 0.75 * r, -0.75 * r], 0.07 * r, 0.05 * r, 4, 'l', true); m.strut([s * 0.42 * r, 0.75 * r, -0.75 * r], [s * 0.25 * r, 0.95 * r, -0.95 * r], 0.05 * r, 0.02, 3, 'a', true); }
    const rg = m.ring(0, 0, 0, 1.25 * r, 'z', ps.pal.a, 1, 0.6); rg.auto = true;
    eEye(m, null, 0, 0.3 * r, 0.32 * r, 0.12 * r, ps.pal.a);
    m.pop();
  } },
  // Фантом: парящий ромб-дротик с плавниками
  blinker: { frames: 2, fps: 8, fly: true, build(m, r, ps) {
    m.push(); m.t(0, 0, 1.15 * r + Math.sin(ps.ph * TAU) * 0.08 * r);
    m.push(); m.ry(Math.PI / 4); m.barrel(0.02, 0.5 * r, -1.0 * r, 0.12 * r, 4, 'm', true); m.barrel(0.5 * r, 0.02, 0.12 * r, 1.25 * r, 4, 'l', true); m.pop();
    for (const s of [-1, 1]) m.plate([[s * 0.2 * r, -0.1 * r], [s * 1.05 * r, -0.85 * r], [s * 0.95 * r, -0.5 * r], [s * 0.3 * r, 0.35 * r]], 'z', 0, 'a');
    m.plate([[-0.8 * r, 0.1 * r], [-0.1 * r, 0.1 * r], [-0.55 * r, 0.7 * r]], 'x', 0, 'a');
    eEye(m, null, 0, 0.85 * r, 0.05 * r, 0.12 * r, '#ffffff');
    m.pop();
  } },
  // Пожиратель: короб на лапах с огромной жующей пастью
  eater: { frames: 4, fps: 8, build(m, r, ps) {
    const jaw = 0.12 + 0.42 * (0.5 + 0.5 * Math.sin(ps.ph * TAU * 2));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const L = legPh(ps.ph, sx * sy > 0 ? 0 : 0.5);
      m.side = sx;
      m.strut([sx * 0.6 * r, sy * 0.45 * r - 0.15 * r, 0.45 * r], [sx * 0.95 * r, sy * 0.6 * r - 0.15 * r + L.sw * 0.15 * r * ps.mv, L.up * 0.15 * r * ps.mv], 0.13 * r, 0.08 * r, 4, 'l', true);
    }
    m.side = 0;
    m.box(-0.72 * r, -0.8 * r, 0.35 * r, 0.72 * r, 0.4 * r, 1.12 * r, 'm');
    m.box(-0.5 * r, -0.7 * r, 1.12 * r, 0.5 * r, 0.1 * r, 1.25 * r, 'l');
    const up = m.box(-0.72 * r, 0.4 * r, 0.76 * r, 0.72 * r, 0.98 * r, 1.12 * r, 'd');
    for (let k = 0; k < 4; k++) m.strut([(-0.54 + k * 0.36) * r, 0.92 * r, 0.76 * r], [(-0.54 + k * 0.36) * r, 0.95 * r, 0.56 * r], 0.07 * r, 0.01, 3, 'a', true);
    for (const s of [-1, 1]) eEye(m, up[5], s * 0.36 * r, 0.75 * r, 1.13 * r, 0.09 * r, ps.pal.e);
    m.push(); m.t(0, 0.4 * r, 0.72 * r); m.rx(jaw);
    m.box(-0.7 * r, 0, -0.34 * r, 0.7 * r, 0.56 * r, 0, 'd');
    for (let k = 0; k < 4; k++) m.strut([(-0.54 + k * 0.36) * r, 0.5 * r, 0], [(-0.54 + k * 0.36) * r, 0.52 * r, 0.2 * r], 0.07 * r, 0.01, 3, 'a', true);
    m.pop();
  } },
  // Плевун: приземистый краб с кислотным баком и мортирой
  spitter: { frames: 4, fps: 7, build(m, r, ps) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, cx = Math.cos(a), cy = Math.sin(a), L = legPh(ps.ph, i % 2 ? 0.5 : 0);
      m.side = cx > 0 ? 1 : -1;
      leg2(m, [cx * 0.55 * r, cy * 0.55 * r, 0.5 * r], [cx * 1.05 * r, cy * 1.05 * r, 0.75 * r + L.up * 0.12 * r * ps.mv], [cx * 1.3 * r, cy * 1.3 * r + L.sw * 0.12 * r * ps.mv, L.up * 0.15 * r * ps.mv], 0.1 * r, 0.05 * r, 'm');
    }
    m.side = 0;
    m.cyl(0.86 * r, 0.7 * r, 0.34 * r, 0.86 * r, 6, 'm', true);
    m.push(); m.t(0, -0.35 * r, 0.86 * r); m.cyl(0.36 * r, 0.36 * r, 0, 0.6 * r, 8, 'a'); m.pop();
    const g = m.glow(null, 0, -0.35 * r, 1.25 * r, 0.6 * r, ps.pal.a, 0.75 + Math.sin(ps.ph * TAU) * 0.2); g.auto = true;
    m.strut([0, 0.15 * r, 0.8 * r], [0, 0.6 * r, 1.66 * r], 0.22 * r, 0.2 * r, 6, 'l');
    m.anchor('muzzle', 0, 0.62 * r, 1.7 * r, 0, 0.4, 1);
    for (const s of [-1, 1]) eEye(m, null, s * 0.3 * r, 0.72 * r, 0.7 * r, 0.08 * r, ps.pal.e);
  } },
  // Кладка: пульсирующий кокон на ножках
  egg: { frames: 2, fps: 3, build(m, r, ps) {
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; m.strut([Math.cos(a) * 0.3 * r, Math.sin(a) * 0.3 * r, 0.5 * r], [Math.cos(a) * 0.9 * r, Math.sin(a) * 0.9 * r, 0], 0.08 * r, 0.03 * r, 3, 'd', true); }
    bicone(m, 0, 0, 0.95 * r, 0.7 * r * (1 + ps.ph * 0.08), 0.55 * r, 0.75 * r, 8, 'a', 'a');
    const g = m.glow(null, 0, 0, 1.0 * r, 1.1 * r, ps.pal.a, 0.55 + ps.ph * 0.3); g.auto = true;
  } },
  // Контейнер снабжения: ящик с лентами и светящимся замком
  prop: { frames: 1, fps: 1, static: true, build(m, r, ps) {
    const b = m.box(-0.8 * r, -0.8 * r, 0, 0.8 * r, 0.8 * r, 1.0 * r, 'd');
    m.box(-0.83 * r, -0.13 * r, -0.01, 0.83 * r, 0.13 * r, 1.03 * r, 'a'); m.box(-0.13 * r, -0.83 * r, -0.01, 0.13 * r, 0.83 * r, 1.03 * r, 'a');
    m.glow(b[5], 0, 0, 1.04 * r, 0.6 * r, ps.pal.a, 0.8);
  } },
};

/* --- элитные навесы: корона и признаки свойства --- */
function eliteParts(m, tid, r, ps, D) {
  const top = D.top, rad = D.rad, pal = ps.pal, t = ps.t || 0;
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + (i - 1) * 0.7, x = Math.cos(a) * 0.32 * r, y = Math.sin(a) * 0.32 * r - 0.1 * r; m.strut([x, y, top - 0.05 * r], [x * 1.35, y * 1.35, top + (i === 1 ? 0.62 : 0.42) * r], 0.11 * r, 0.02, 4, 'a', true); }
  const rg = m.ring(0, 0, top + 0.05 * r, rad * 0.75, 'z', '#ffd36b', 1, 0.45); rg.auto = true;
  const af = ps.affix;
  if (af === 'armored' && ps.armored) {
    m.g = 'armor';
    for (let k = 0; k < 4; k++) { m.push(); m.rz(k * Math.PI / 2 + Math.PI / 4); m.t(0, rad * 0.9, 0); m.prism([[-0.42 * r, 0.18 * top], [0.42 * r, 0.18 * top], [0.34 * r, 0.82 * top], [-0.34 * r, 0.82 * top]], -0.07 * r, 0.07 * r, 'y', 'l'); m.pop(); }
    m.g = 'core';
  } else if (af === 'overclock') {
    for (const s of [-1, 1]) { m.strut([s * 0.3 * r, -0.4 * r, top * 0.7], [s * 0.42 * r, -0.85 * r, top * 0.95], 0.1 * r, 0.08 * r, 6, 'd'); m.flame(s * 0.42 * r, -0.85 * r, top * 0.95, 0, -0.6, 0.3, 0.5 * r + Math.sin(t * 30 + s) * 0.1 * r, 0.12 * r, '#ff5a3a').under = false; }
  } else if (af === 'brood') {
    for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.42 * r; bicone(m, x, -0.5 * r, top * 0.82, 0.24 * r, 0.18 * r, 0.22 * r, 6, 'a'); const g = m.glow(null, x, -0.5 * r, top * 0.85, 0.35 * r, '#8dff6a', 0.6 + Math.sin(t * 5 + i) * 0.3); g.auto = true; }
  } else if (af === 'volatile') {
    const g = m.glow(null, 0, 0, top + 0.3 * r, 0.9 * r, '#ff4d2e', 0.6 + Math.sin(t * 9) * 0.35); g.auto = true;
    m.push(); m.t(0, 0, top + 0.3 * r); m.cyl(0.02, 0.26 * r, -0.26 * r, 0, 4, 'a', true); m.cyl(0.26 * r, 0.02, 0, 0.26 * r, 4, 'a', true); m.pop();
  }
}

/* ===== Сборка модели и её габариты ===== */
function eModelMesh(tid, r, yaw, ps, zc) {
  const m = new Mesh(); m.zc = zc;
  m.push(); m.mul(m3yaw(yaw));
  EM[tid].build(m, r, ps);
  if (ps.elite) eliteParts(m, tid, r, ps, eModelDim(tid));
  m.pop();
  return m;
}
const _eDim = {};
function eModelDim(tid) {
  if (_eDim[tid]) return _eDim[tid];
  const r = ENEMIES[tid].r, m = new Mesh();
  EM[tid].build(m, r, { ph: 0, mv: 0, t: 0, pal: enemyPal(SECTORS[0].pal, ENEMIES[tid].acc, false), pose: 'walk' });
  let top = 0, rad = 0;
  for (const v of m.V) { top = Math.max(top, v[2]); rad = Math.max(rad, Math.hypot(v[0], v[1])); }
  return (_eDim[tid] = { top, rad, zc: top * 0.42 });
}

/* ===== Спрайты: 9 ракурсов от «спиной» до «лицом» (левая половина — зеркально) × кадры шага ===== */
const E_YAWS = 9;
const eYaw = i => -Math.PI / 2 + i * Math.PI / 8;
function enemyView() { return (typeof P !== 'undefined' && P && P.view) || (SAVE && SAVE.settings.view) || 'front'; }
function buildEnemySprites(SP) {
  SPR.enemies = {}; SPR.eSP = SP; SPR.eView = enemyView(); SPR.eRes = 0;
  SPR.ePend = Object.keys(EM);
}
// по одному типу за кадр в фоне; нужный тип строится сразу
function tickEnemySprites() {
  if (!SPR.ePend || !SPR.ePend.length) return;
  const id = SPR.ePend.shift();
  if (!SPR.enemies[id]) enemySprites(id);
}
function enemySprites(tid) {
  const view = enemyView();
  if (SPR.eView !== view) { SPR.enemies = {}; SPR.eView = view; SPR.ePend = Object.keys(EM); }
  return SPR.enemies[tid] || (SPR.enemies[tid] = buildTypeSprites(tid, SPR.eSP || SECTORS[0].pal, view));
}
function buildTypeSprites(tid, SP, view) {
  const T = ENEMIES[tid], D = EM[tid], r = T.r, pal = enemyPal(SP, T.acc, false), dim = eModelDim(tid);
  const phi = VIEW_PITCH[view], sp = Math.sin(phi), cp = Math.cos(phi), zc = dim.zc;
  const poses = D.poses || ['walk'], nF = D.frames;
  const psOf = (pose, f) => ({ ph: f / nF, mv: D.static ? 0 : 1, t: 0, pal, pose });
  // общий кадр для всех ракурсов и поз
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let yi = 0; yi < E_YAWS; yi += 2) for (const pose of poses) {
    const m = eModelMesh(tid, r, eYaw(yi), psOf(pose, 0), zc);
    for (const v of m.V) { const sx = v[0], sy = -v[1] * sp - (v[2] - zc) * cp; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; }
  }
  const mg = r * 0.55; x0 -= mg; x1 += mg; y0 -= mg; y1 += mg;
  const res = clamp((VIEW.scale || 1) * (VIEW.dpr || 1) * 1.05, 1.2, 2.4);
  const pw = Math.ceil((x1 - x0) * res), ph = Math.ceil((y1 - y0) * res), ax = -x0 * res, ay = -y0 * res;
  const sprites = poses.map(() => []), muz = [];
  for (let yi = 0; yi < E_YAWS; yi++) {
    poses.forEach((pose, pi) => {
      const fr = [], n = pose === 'walk' ? nF : 1;
      for (let f = 0; f < n; f++) {
        const m = eModelMesh(tid, r, eYaw(yi), psOf(pose, f), zc);
        const cv = makeCanvas(pw, ph), c = cv.getContext('2d');
        c.setTransform(res, 0, 0, res, ax, ay);
        renderMesh(c, m, pal, view, {});
        fr.push(cv);
        if (pi === 0 && f === 0 && m.anchors.muzzle) { const a = m.anchors.muzzle.p; muz[yi] = { x: a[0], y: -a[1] * sp - (a[2] - zc) * cp }; }
      }
      sprites[pi][yi] = fr;
    });
  }
  return { tid, r, zc, res, pw, ph, ax, ay, sp: sprites, nF, fps: D.fps, fly: !!D.fly, muz, ice: {}, rad: dim.rad, cp, sn: sp, poses };
}
// ракурс по экранному углу: индекс и зеркальность
function eYawIdx(a) {
  let th = a || 0, mir = false;
  if (Math.cos(th) < 0) { th = Math.PI - th; mir = true; }
  th = Math.atan2(Math.sin(th), Math.cos(th));
  return { yi: clamp(Math.round((th + Math.PI / 2) / (Math.PI / 8)), 0, E_YAWS - 1), mir };
}
// дульный срез на экране (для вспышек выстрела)
function enemyMuzzle(e) {
  const S = SPR.enemies[e.tid];
  if (!S || !S.muz.length) return { x: e.x, y: e.y };
  const Y = eYawIdx(e.ang), q = S.muz[Y.yi] || { x: 0, y: 0 }, k = e.scale || 1;
  return { x: e.x + (Y.mir ? -q.x : q.x) * k, y: e.y + q.y * k };
}
function iceOf(S, yi) {
  return S.ice[yi] || (S.ice[yi] = silhouette(S.sp[0][yi][0], '#9ff0ff'));
}
// высота «падения» при появлении: враги высаживаются сверху
function dropOff(e) { return e.t < 0.4 ? -(1 - ease.inQuad(e.t / 0.4)) * 110 : 0; }
function drawEnemySprite(c, e, z, e0, f0, t) {
  const S = enemySprites(e.tid), Y = eYawIdx(e.T.prop ? Math.PI / 2 - 0.5 : e.ang);
  let pi = 0, fi = 0;
  if (e.tid === 'charger') pi = e.ai.s === 'wind' ? 1 : e.ai.s === 'dash' ? 2 : 0;
  if (pi === 0 && S.nF > 1 && (S.fly || Math.abs(e.vx) + Math.abs(e.vy) > 8)) fi = Math.floor(e.t * S.fps + e.anim * 3) % S.nF;
  const img = S.sp[pi][Y.yi][fi], k = e.scale || 1;
  let oy = dropOff(e);
  if (S.fly) oy -= Math.sin(t * 3 + e.anim) * S.r * 0.1;
  const a = z * k / S.res;
  c.setTransform(Y.mir ? -a : a, 0, 0, a, e.x * z + e0, (e.y + oy) * z + f0);
  let al = e.t < 0.4 ? Math.min(1, e.t * 5) : 1;
  if (e.phased) al *= 0.3 + Math.sin(t * 50) * 0.15;
  c.globalAlpha = al;
  c.drawImage(img, -S.ax, -S.ay);
  if (e.flash > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.8 * al; c.drawImage(img, -S.ax, -S.ay); c.globalCompositeOperation = 'source-over'; }
  if (e.st.freezeT > 0) { c.globalAlpha = 0.7 * al; c.drawImage(iceOf(S, Y.yi), -S.ax, -S.ay); }
  else if (e.st.chillT > 0) { c.globalAlpha = 0.28 * al; c.drawImage(iceOf(S, Y.yi), -S.ax, -S.ay); }
  c.globalAlpha = 1;
}
// экранные смещения от позиции машины: до точки на полу и до её верхушки (для колец, полос, звёзд оглушения)
function eGround(e) { const S = SPR.enemies[e.tid]; return S ? S.zc * S.cp * (e.scale || 1) : e.r * 0.4; }
function eTop(e) { const S = SPR.enemies[e.tid], D = _eDim[e.tid]; return S && D ? ((D.top - S.zc) * S.cp + (e.elite ? e.T.r * 0.6 : 0)) * (e.scale || 1) : e.r; }
// мягкая тень-пятно на полу под машиной (одна на всех, рисуется до врагов)
function shadowBlob() {
  if (SPR.shadow) return SPR.shadow;
  const cv = makeCanvas(64, 64), c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(0.55, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return (SPR.shadow = cv);
}
function drawEnemyShadow(c, e) {
  const S = SPR.enemies[e.tid]; if (!S) return;
  const k = e.scale || 1, q = e.t < 0.4 ? 0.35 + 0.65 * (e.t / 0.4) : 1, rx = S.rad * 1.2 * k * q, ry = rx * Math.max(0.42, S.sn);
  c.drawImage(shadowBlob(), e.x - rx, e.y + S.zc * S.cp * k - ry, rx * 2, ry * 2);
}

/* ===== Элита: живая модель с короной и признаками свойства ===== */
function eliteState(e, t) {
  const S = enemySprites(e.tid), mv = S.fly || Math.abs(e.vx) + Math.abs(e.vy) > 8 ? 1 : 0;
  const pose = e.tid === 'charger' ? (e.ai.s === 'wind' ? 'wind' : e.ai.s === 'dash' ? 'dash' : 'walk') : 'walk';
  return { S, ps: { ph: (e.t * S.fps / Math.max(1, S.nF) + e.anim) % 1, mv, t, pose, pal: enemyPal(G.sector.pal, e.T.acc, true), elite: true, affix: e.affix, armored: e.armored } };
}
function drawElite3D(c, e, z, e0, f0, t) {
  const { S, ps } = eliteState(e, t), view = enemyView(), k = e.scale || 1;
  const m = eModelMesh(e.tid, e.T.r, e.ang || 0, ps, S.zc);
  let oy = dropOff(e);
  if (S.fly) oy -= Math.sin(t * 3 + e.anim) * S.r * 0.1;
  c.setTransform(z * k, 0, 0, z * k, e.x * z + e0, (e.y + oy) * z + f0);
  if (e.t < 0.4) c.globalAlpha = Math.min(1, e.t * 5);
  renderMesh(c, m, ps.pal, view, {});
  if (e.flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.6; renderMesh(c, m, ps.pal, view, { flat: '#ffffff' }); c.restore(); }
  if (e.st.freezeT > 0 || e.st.chillT > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = e.st.freezeT > 0 ? 0.35 : 0.15; renderMesh(c, m, ps.pal, view, { flat: '#9ff0ff' }); c.restore(); }
  c.globalAlpha = 1;
}

/* ===== Обломки: машины разлетаются по деталям ===== */
// q — 0…1; детали летят от центра, кувыркаются, падают и гаснут
function wreckAnim(q, seed, D) {
  return m => {
    const cz = m.zc;
    m.animate(pr => {
      const h1 = hsh(pr.v0 + 1, seed), h2 = hsh(pr.v0 + 7, seed + 3), h3 = hsh(pr.v0 + 13, seed + 5);
      const p = clamp((q - h3 * 0.22) / 0.78, 0, 1);
      if (p >= 1) return PRIM_HIDE;
      let dx = pr.c[0], dy = pr.c[1], dz = pr.c[2] - cz;
      const l = Math.hypot(dx, dy, dz) || 1, e2 = ease.outCubic(p), dist = D * (0.6 + h1 * 0.9);
      return { m: animMat(pr.c, dx / l * dist * e2 + (h1 - 0.5) * D * 0.3 * e2, dy / l * dist * e2, dz / l * dist * e2 + D * 0.5 * e2 - D * 1.6 * p * p, h2 - 0.5, h1 - 0.5, h3 + 0.2, p * (4 + h1 * 6) * (h2 < 0.5 ? -1 : 1), 1 - 0.3 * p), al: 1 - ease.inQuad(p), nodec: p > 0.1 };
    }, d => (q > 0.05 ? PRIM_HIDE : null));
  };
}
// o: { x, y, k, dur, build(t) → Mesh, pal, only, seed, D }
function addWreck(o) { if (G.wrecks) G.wrecks.push(Object.assign({ t: 0, seed: (Math.random() * 97) | 0 }, o)); }
function updateWrecks(dt) {
  if (!G.wrecks) return;
  for (let i = G.wrecks.length - 1; i >= 0; i--) { const w = G.wrecks[i]; w.t += dt; if (w.t >= w.dur) removeAt(G.wrecks, i); }
}
function drawWrecks(c, z, e0, f0) {
  if (!G.wrecks || !G.wrecks.length) return;
  const view = enemyView();
  for (const w of G.wrecks) {
    if (Math.abs(w.x - G.cam.x) > VIEW.hw + 260 || Math.abs(w.y - G.cam.y) > VIEW.hh + 260) continue;
    const m = w.build(G.time);
    wreckAnim(w.t / w.dur, w.seed, w.D)(m);
    c.setTransform(z * w.k, 0, 0, z * w.k, w.x * z + e0, w.y * z + f0);
    renderMesh(c, m, w.pal, view, w.only ? { only: w.only } : {});
  }
}
// обломки элиты целиком или только её брони
function eliteWreck(e, onlyArmor) {
  const { S, ps } = eliteState(e, G.time), ang = e.ang || 0, tid = e.tid, r = e.T.r;
  const ps2 = Object.assign({}, ps, { armored: onlyArmor ? true : ps.armored });
  addWreck({ x: e.x, y: e.y, k: e.scale || 1, dur: onlyArmor ? 0.8 : 1.1, pal: ps.pal, only: onlyArmor ? 'armor' : null, D: r * 1.3, build: () => eModelMesh(tid, r, ang, ps2, S.zc) });
}

/* ===== Превью для справочника ===== */
function drawEnemyPreview(cv, tid) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height, T = ENEMIES[tid], D = eModelDim(tid);
  const pal = enemyPal(SECTORS[0].pal, T.acc, false);
  const m = eModelMesh(tid, T.r, Math.PI / 2 - 0.6, { ph: 0.15, mv: 1, t: 1, pal, pose: 'walk' }, D.zc);
  const s = Math.min(w, h) / (Math.max(D.rad * 2.7, D.top * 1.5) + T.r * 0.6);
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
  c.setTransform(s, 0, 0, s, w / 2, h / 2 + D.top * 0.08 * s);
  renderMesh(c, m, pal, 'front', {});
}
