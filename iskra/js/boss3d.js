'use strict';
/* ===== Боссы в 3D: модели, позы по состоянию ИИ, высадка по деталям с неба, гибель по деталям ===== */

const BOSS_NOM = { hammer: 34, hive: 42, serpent: 24, core: 56, reaper: 28, arachna: 40 };
const BOSS_ZC = { hammer: 34, hive: 28, serpent: 12, core: 52, reaper: 34, arachna: 20 };   // высота точки привязки над полом (номинал)
const BOSS_INTRO = 2.2;
// босс визуально заметно крупнее своего круга столкновения — он должен нависать над героем
const BOSS_VIS = { hammer: 1.75, hive: 1.45, serpent: 1.3, core: 1.0, reaper: 1.55, arachna: 1.3 };
const bossSc = e => e.r / BOSS_NOM[e.bid] * BOSS_VIS[e.bid];
function bossPal(bid) { return enemyPal(G.sector ? G.sector.pal : SECTORS[0].pal, BOSSES[bid].color, false); }

// икосаэдр: ядро Роя и его бронеплиты
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(p => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
const OCTA = { v: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]] };

/* ===== Модели (номинальный масштаб; локально y — вперёд, z — вверх) ===== */
const BOSS_M = {
  // МОЛОТ: штурмовой шагатель на обратных коленях с молотом-кувалдой и пушкой-клешнёй
  hammer(m, ps) {
    const st = ps.st, q = ps.q, wp = ps.wp;
    const walk = st === 'walk' ? 1 : st === 'charge' ? 1.5 : 0;
    const crouch = st === 'wind' ? 5 * ease.outCubic(q) : st === 'slam' && q > 0.9 ? 4 : 0;
    for (const s of [-1, 1]) {
      const ph = wp + (s > 0 ? 0 : Math.PI), sw = Math.sin(ph) * 7 * walk, up = Math.max(0, Math.cos(ph)) * 6 * walk;
      const H = [s * 13, -3, 33 - crouch], K = [s * 15.5, 9 + sw * 0.5, 20 - crouch * 0.6 + up * 0.5], A = [s * 15.5, -5 + sw, 7 + up], F = [s * 15.5, 2 + sw, up];
      m.side = s;
      m.push(); m.t(H[0], H[1], H[2]); m.ry(Math.PI / 2); m.cyl(5.2, 5.2, -3.2, 3.2, 8, 'd'); m.pop();
      m.strut(H, K, 5, 4.2, 6, 'm'); m.strut(K, A, 3.8, 3.2, 6, 'l'); m.strut(A, F, 2.6, 2.2, 5, 'd');
      m.box(F[0] - 5, F[1] - 6, F[2], F[0] + 5, F[1] + 9, F[2] + 3.5, 'd');
      for (const tx of [-3.2, 0, 3.2]) m.strut([F[0] + tx, F[1] + 8, F[2] + 1.8], [F[0] + tx * 1.1, F[1] + 12.5, F[2] + 0.2], 1.4, 0.3, 4, 'a', true);
    }
    m.side = 0;
    m.box(-11, -9, 29 - crouch, 11, 6, 37 - crouch, 'd');
    let lean = 0;
    if (st === 'wind') lean = 0.26 * ease.outCubic(q); else if (st === 'charge') lean = 0.36;
    else if (st === 'slam') lean = q < 0.72 ? -0.14 * (q / 0.72) : q < 0.9 ? -0.14 : 0.2;
    m.push(); m.t(0, 0, 35 - crouch); m.rx(-lean); m.t(0, 0, -35);
    m.prism([[-13, 36], [9, 34], [15, 44], [8, 58], [-11, 56]], -17, 17, 'x', 'm');
    for (const s of [-1, 1]) m.prism([[-10, 38], [8, 37], [11, 45], [6, 54], [-8, 53]], s * 17, s * 19.6, 'x', 'l');
    const vz = m.box(-9, 12.4, 45, 9, 14.6, 49.6, 'a');
    for (const x of [-5, 0, 5]) { m.glow(vz[3], x, 14.65, 47.3, 4.2, '#ffd36b', 0.9); m.glow(vz[3], x, 14.65, 47.3, 1.2, '#ffffff', 1); }
    for (const s of [-1, 1]) {
      m.push(); m.t(s * 7, -10, 55); m.cyl(2.5, 2.1, 0, 11, 8, 'l'); m.pop();
      const hot = st === 'wind' ? 1 : 0.35 + Math.sin(ps.t * 6 + s) * 0.15;
      const g = m.glow(null, s * 7, -10, 67, 4 + hot * 4, '#ff8a3d', hot); g.auto = true;
    }
    // люк на спине: раскрывается, когда выпускает клещей
    const hatch = st === 'summon' ? ease.outBack(Math.min(1, q * 2)) * 1.15 : 0;
    for (const s of [-1, 1]) { m.push(); m.t(s * 0.5, -12.4, 54); m.ry(s * hatch); m.box(s > 0 ? 0 : -9, -0.9, -12, s > 0 ? 9 : 0, 0.9, 0, 'l'); m.pop(); }
    if (hatch > 0.1) { const g = m.glow(null, 0, -13, 47, 12 * hatch, '#ff8a3d', 0.8); g.auto = true; }
    // рука-молот
    let P2 = 0.25 + Math.sin(wp) * 0.2 * walk, el = 0.15;
    if (st === 'slam') { if (q < 0.72) P2 = lerp(0.3, 2.9, ease.inOutCubic(q / 0.72)); else if (q < 0.9) P2 = 2.9 + Math.sin(ps.t * 40) * 0.03; else P2 = lerp(2.9, 1.15, ease.inCubic(clamp((q - 0.9) / 0.06, 0, 1))); el = q < 0.9 ? 0.55 : 0.1; }
    else if (st === 'wind') { P2 = -0.9; el = 0.5; } else if (st === 'charge') { P2 = 1.5; el = 0; } else if (st === 'summon') P2 = 0.45;
    m.push(); m.t(21, 0, 50); { m.push(); m.ry(Math.PI / 2); m.cyl(5.5, 5.5, -3, 3, 8, 'd'); m.pop(); } m.rx(P2);
    m.cyl(5, 4.5, -15, 0, 8, 'm'); m.t(0, 0, -15); { m.push(); m.ry(Math.PI / 2); m.cyl(4.4, 4.4, -2.6, 2.6, 8, 'd'); m.pop(); } m.rx(el);
    m.cyl(4.2, 4, -14, 0, 8, 'l'); m.t(0, 0, -14);
    const hh = m.box(-8, -8.5, -15.5, 8, 8.5, 0.5, 'a');
    for (let k = 0; k < 3; k++) m.line(hh[3], -7.5 + k * 5, 8.55, -1, -4.5 + k * 5, 8.55, -14.5, '#2a1606', 1.6, 0.9);
    if (st === 'slam' && q > 0.55) { const g = m.glow(null, 0, 0, -8, 18 * (q - 0.55), '#ffd36b', 0.9); g.auto = true; }
    m.pop();
    // левая рука: пушка-клешня
    m.push(); m.t(-21, 0, 50); { m.push(); m.ry(Math.PI / 2); m.cyl(5, 5, -3, 3, 8, 'd'); m.pop(); } m.rx(st === 'charge' ? 1.45 : 1.25 + Math.sin(wp + 1) * 0.12 * walk);
    m.cyl(4, 3.6, -13, 0, 8, 'm'); m.t(0, 0, -13); m.cyl(3.4, 3, -10, 0, 8, 'l');
    for (const s of [-1, 1]) m.strut([s * 2, 0, -10], [s * 4.5, 0, -17], 1.4, 0.4, 4, 'a', true);
    const g2 = m.glow(null, 0, 0, -12, 4, '#ff8a3d', 0.7); g2.auto = true;
    m.pop();
    m.pop();
  },
  // УЛЕЙ: парящая матка — шестигранный корпус, кольцо сот-ангаров с люками, двигатели снизу
  hive(m, ps) {
    const t = ps.t, col = BOSSES.hive.color;
    m.push(); m.t(0, 0, 28 + Math.sin(t * 1.4) * 2);
    m.cyl(22, 9, -8, -15, 6, 'd', true);
    m.cyl(22, 22, -8, 8, 6, 'm', true);
    m.cyl(22, 12, 8, 15, 6, 'l', true);
    m.push(); m.t(0, 0, 19); m.cyl(0.1, 4, -4, 0, 6, 'a', true); m.cyl(4, 0.1, 0, 4, 6, 'a', true); m.pop();
    { const g = m.glow(null, 0, 0, 19, 11 + ps.fire * 6, col, 0.85); g.auto = true; }
    for (let i = 0; i < 6; i++) {
      const a = (ps.rot || 0) + i * Math.PI / 3, cx = Math.cos(a), cy = Math.sin(a);
      m.strut([cx * 18, cy * 18, 0], [cx * 24, cy * 24, 0], 2.2, 2.2, 5, 'd', true);
      m.push(); m.t(cx * 31, cy * 31, 0); m.rz(a);
      m.cyl(9, 9, -6, 6, 6, 'l', true);
      m.push(); m.t(9, 0, 6); m.ry(-ps.open * 1.75); m.t(-9, 0, 0); m.cyl(9, 7.5, 0, 1.4, 6, 'm', true); m.pop();
      if (ps.open > 0.05) { const g = m.glow(null, 0, 0, 7, 9 * ps.open, col, 0.9); g.auto = true; }
      m.pop();
    }
    for (let k = 0; k < 3; k++) {
      const a = k * TAU / 3 + 0.5;
      m.push(); m.t(Math.cos(a) * 12, Math.sin(a) * 12, -15); m.cyl(3.6, 4.6, -5, 0, 8, 'd');
      m.flame(0, 0, -5, 0, 0, -1, 9 + Math.sin(t * 25 + k) * 2, 3.2, col);
      m.pop();
    }
    const rg = m.ring(0, 0, 0, 40, 'z', col, 1.3, 0.3 + ps.fire * 0.6); rg.auto = true;
    m.pop();
  },
  // ЗМЕЙ: голова механической многоножки с жвалами
  serpent(m, ps) {
    const open = ps.open, col = BOSSES.serpent.color;
    m.prism([[-20, 4], [14, 5], [24, 12], [12, 22], [-16, 20]], -15, 15, 'x', 'm');
    m.prism([[-14, 20], [6, 21.5], [2, 26.5], [-12, 25]], -6, 6, 'x', 'l');
    for (const s of [-1, 1]) {
      m.side = s;
      const root = [s * 10, 19, 10], mid = [s * (13 + open * 7), 30, 9], tip = [s * (6 + open * 13), 38 + open * 2, 7];
      m.strut(root, mid, 2.6, 2, 5, 'a', true); m.strut(mid, tip, 2, 0.3, 4, 'a', true);
      eEye(m, null, s * 7.5, 20.5, 16, 1.5, col);
      m.strut([s * 5, 12, 22], [s * 12, 26, 31], 0.7, 0.5, 4, 'l', true);
      const g = m.glow(null, s * 12, 26, 31.5, 2.2, col, 0.85); g.auto = true;
      m.strut([s * 12, 2, 8], [s * 20, 6 + Math.sin(ps.t * 12 + s) * 3, 0], 1.6, 0.8, 4, 'l', true);
    }
    m.side = 0;
  },
  // позвонок многоножки: панцирь, две пары бегущих ног, у каждого третьего — турель
  seg(m, ps) {
    const t = ps.t, idx = ps.idx, col = BOSSES.serpent.color;
    for (const y of [-5, 5]) for (const s of [-1, 1]) {
      const ph = t * 11 + idx * 0.85 + (y > 0 ? 0 : Math.PI) + (s > 0 ? 0 : Math.PI / 2), sw = Math.sin(ph) * 4, up = Math.max(0, Math.cos(ph)) * 3.5;
      m.side = s;
      m.strut([s * 10, y, 10], [s * 16.5, y + sw * 0.5, 14 + up * 0.3], 1.6, 1.3, 4, 'l', true);
      m.strut([s * 16.5, y + sw * 0.5, 14 + up * 0.3], [s * 19, y + sw, up], 1.2, 0.4, 4, 'd', true);
    }
    m.side = 0;
    m.push(); m.t(0, 0, 12); m.barrel(12, 12, -9.5, 9.5, 8, 'm'); m.pop();
    m.plate([[-8, 22.5], [8, 22.5], [4, 28.5], [-6, 27.5]], 'x', 0, 'l');
    if (idx % 3 === 1) {
      m.push(); m.t(0, 3, 22); m.cyl(5, 4, 0, 4, 8, 'l'); m.t(0, 0, 2.5); m.barrel(1.3, 1.1, 2, 11, 6, 'a'); m.pop();
      const g = m.glow(null, 0, 14, 24.5, 3 + (ps.flash > 0 ? 4 : 0), col, 0.8); g.auto = true;
    }
    const g = m.glow(null, 0, 0, 24, 5, col, 0.35 + Math.sin(t * 4 + idx) * 0.2); g.auto = true;
  },
  // ЯДРО РОЯ: икосаэдр-реактор в броне из двадцати плит; плиты расходятся по фазам, вокруг — орбиты, глаз смотрит на вас
  core(m, ps) {
    const t = ps.t, col = BOSSES.core.color, rot = ps.rot || 0, ph = ps.ph || 1;
    const open = ph === 1 ? 1.5 : ph === 2 ? 7 + Math.sin(t * 2) * 1.2 : 14 + Math.sin(t * 3) * 2.5;
    m.push(); m.t(0, 0, 52 + Math.sin(t * 1.2) * 2.5);
    m.push(); m.rz(rot * 0.6);
    m.poly(ICO.v.map(v => [v[0] * 24, v[1] * 24, v[2] * 24]), ICO.f, 'a');
    m.pop();
    { const g = m.glow(null, 0, 0, 0, 46 + open, col, 0.55 + Math.sin(t * 2) * 0.1); g.auto = true; }
    m.push(); m.rz(rot * 0.35); m.rx(rot * 0.22);
    for (const f of ICO.f) {
      const A = ICO.v[f[0]], B = ICO.v[f[1]], C = ICO.v[f[2]], cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      const R0 = 38 + open, R1 = R0 + 3.2, ins = 0.8;
      const P3 = (V, R) => { const x = cx + (V[0] - cx) * ins, y = cy + (V[1] - cy) * ins, z = cz + (V[2] - cz) * ins, l = Math.hypot(x, y, z); return [x / l * R, y / l * R, z / l * R]; };
      const vs = [P3(A, R0), P3(B, R0), P3(C, R0), P3(A, R1), P3(B, R1), P3(C, R1)];
      m.poly(vs, [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], 'm');
    }
    m.pop();
    for (let i = 0; i < 3; i++) { m.push(); m.rz(rot * (0.5 + i * 0.3) + i * 2); m.rx(1.05 + i * 0.42); const rg = m.ring(0, 0, 0, 60 + i * 8, 'z', i === 1 ? '#ffd23f' : col, 1.3, 0.55); rg.auto = true; m.pop(); }
    // глаз-линза к игроку
    m.push(); m.t(0, 40 + open + 3, 0); m.rx(-Math.PI / 2);
    const ey = m.cyl(10, 8, 0, 3.5, 12, 'a');
    if (ey.cap1) { m.glow(ey.cap1, 0, 0, 3.55, ps.laser ? 26 : 14, '#ffe14d', 0.9); m.glow(ey.cap1, 0, 0, 3.55, 4, '#ffffff', 1); }
    m.pop();
    m.pop();
  },
  // ЖНЕЦ: парящий призрак — плащ из пластин, череп с прорезью, две энергокосы
  reaper(m, ps) {
    const st = ps.st, q = ps.q, t = ps.t, col = BOSSES.reaper.color;
    m.push(); m.t(0, 0, 14 + Math.sin(t * 2) * 2);
    if (ps.spin) m.rz(ps.spin);
    if (st === 'dash') m.rx(-0.45); else if (st === 'wind') m.rx(0.2 * q);
    for (let i = 0; i < 7; i++) { const a = i * TAU / 7; m.push(); m.rz(a); m.t(0, 6.5, 14); m.rx(0.32 + Math.sin(t * 4 + i) * 0.1); m.plate([[-4, 0], [4, 0], [2.2, -17], [-1, -22]], 'y', 0, i % 2 ? 'd' : 'm'); m.pop(); }
    m.prism([[-8, 14], [8, 14], [10, 26], [6, 32], [-6, 32], [-10, 26]], -4.5, 4.5, 'y', 'm');
    m.plate([[-1, 15], [1, 15], [0.5, 31], [-0.5, 31]], 'x', 0, 'a');
    const hd = m.prism([[0, 7.5], [-5, 3], [-4.4, -4], [4.4, -4], [5, 3]], 33, 41, 'z', 'd');
    m.glow(hd.s[0], -2.4, 5.4, 37.5, 3, col, 0.95); m.glow(hd.s[4], 2.4, 5.4, 37.5, 3, col, 0.95);
    for (const s of [-1, 1]) m.strut([s * 3, -2, 40], [s * 8, -9, 50], 1.2, 0.2, 4, 'a', true);
    for (const s of [-1, 1]) {
      let sw = 0.9, fw = 0.3;
      if (st === 'wind' || st === 'dash') { sw = -0.6; fw = 0.1; } else if (st === 'throw') { sw = 1.7 - q * 0.4; fw = 0; } else if (ps.spin) { sw = 1.57; fw = 0; }
      m.push(); m.t(s * 10, 0, 29); m.rz(s * 0.35); m.rx(sw);
      m.cyl(1.8, 1.4, -11, 0, 6, 'l'); m.t(0, 0, -11); m.rx(fw); m.cyl(1.4, 1.1, -10, 0, 6, 'm'); m.t(0, 0, -10);
      if (!ps.thrown) {
        m.strut([0, 0, 4], [0, 0, -26], 0.9, 0.9, 5, 'd', true);
        const blade = []; for (let k = 0; k <= 7; k++) { const a = k / 7 * 2.2; blade.push([Math.sin(a) * 19, -26 + (1 - Math.cos(a)) * 10 - 2]); }
        for (let k = 7; k >= 0; k--) { const a = k / 7 * 2.2; blade.push([Math.sin(a) * 12.5, -26 + (1 - Math.cos(a)) * 6.5]); }
        m.plate(blade, 'x', 0, 'a');
        const g = m.glow(null, 0, 10, -24, 7, col, 0.5); g.auto = true;
      }
      m.pop();
    }
    m.pop();
  },
  // ПАУЧИХА: восемь трёхзвенных ног, головогрудь с шестью глазами, брюшко с кислотной меткой
  arachna(m, ps) {
    const t = ps.t, col = BOSSES.arachna.color, lift = ps.leapH || 0, crouch = ps.st === 'crouch' ? 1 : 0;
    m.push(); m.t(0, 0, lift - crouch * 5);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
      const y0 = 9 - i * 5, ph = ps.wp + i * Math.PI / 2 + (s > 0 ? 0 : Math.PI), sw = Math.sin(ph) * 5 * ps.mv, up = Math.max(0, Math.cos(ph)) * 6 * ps.mv, fan = (1.5 - i) * 0.5;
      const tuck = lift > 4 ? 0.55 : 1;
      m.side = s;
      const hip = [s * 7, y0, 17], knee = [s * 22 * tuck, y0 + fan * 14 + sw * 0.5, 32 + up * 0.5 - crouch * 3], foot = [s * 35 * tuck, y0 + fan * 28 + sw, lift > 4 ? 8 - lift * 0.2 : up + crouch * 5];
      m.strut(hip, knee, 2.5, 2.1, 5, 'm'); m.strut(knee, foot, 2.1, 0.5, 5, 'l');
    }
    m.side = 0;
    const oc = []; for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + TAU / 16; oc.push([Math.cos(a) * 11, Math.sin(a) * 12 + 3]); }
    const ce = m.prism(oc, 12, 22, 'z', 'm');
    for (let k = 0; k < 6; k++) { const x = (k % 3 - 1) * 3.2, z = 18.5 + Math.floor(k / 3) * 2.6; eEye(m, null, x, 14.6, z, k < 3 ? 1.2 : 0.9, col); }
    for (const s of [-1, 1]) m.strut([s * 3, 14, 14], [s * 1.5, 20, 6], 1.6, 0.3, 4, 'a', true);
    bicone(m, 0, -17, 21, 16, 10, 12, 8, 'm', 'l');
    m.push(); m.t(0, -17, 33); m.cyl(3.4, 2, 0, 2, 6, 'a'); m.pop();
    const pulse = ps.st === 'eggs' ? 1 : 0.4 + Math.sin(t * 3) * 0.2;
    const g = m.glow(null, 0, -17, 26, 14 * pulse, col, 0.55); g.auto = true;
    m.pop();
  },
  // щитовой узел ядра: октаэдр-пилон с кольцом
  node(m, ps) {
    m.push(); m.t(0, 0, 22 + Math.sin(ps.t * 3 + ps.idx) * 2); m.rz(ps.t * 1.5);
    m.poly(OCTA.v.map(v => [v[0] * 9, v[1] * 9, v[2] * 13]), OCTA.f, 'l');
    const rg = m.ring(0, 0, 0, 13, 'z', '#46e3ff', 1.1, 0.8); rg.auto = true;
    const g = m.glow(null, 0, 0, 0, 12, '#46e3ff', 0.7); g.auto = true;
    m.pop();
  },
};

/* ===== Поза босса по состоянию ИИ ===== */
function bossPose(e, t) {
  const a = e.ai, bid = e.bid, toP = Math.atan2(P.y - e.y, P.x - e.x), pal = bossPal(bid);
  if (bid === 'hammer') {
    const st = a.s || 'walk', dur = { slam: 1.1, wind: 0.85, charge: 0.62, summon: 0.6 }[st] || 1;
    return { st, q: st === 'walk' ? 0 : clamp(1 - a.t / dur, 0, 1), wp: e.t * (st === 'charge' ? 9 : 4.2), yaw: st === 'charge' || st === 'wind' ? a.ang : toP, t, pal };
  }
  if (bid === 'hive') return { t, rot: e.rot || 0, open: clamp(a.hatch || 0, 0, 1), fire: a.s === 'spiral' ? 1 : clamp(a.flare || 0, 0, 1), yaw: Math.PI / 2, pal };
  if (bid === 'reaper') {
    const st = a.s || 'walk', dur = { wind: 0.65, dash: 0.8, throw: 0.5, whirl: 2.2 }[st] || 1;
    return { st, q: st === 'walk' ? 0 : clamp(1 - a.t / dur, 0, 1), t, yaw: st === 'dash' || st === 'wind' ? a.ang : toP, spin: st === 'whirl' ? t * 14 : 0, thrown: G.ebullets.some(b => b.kind === 'scythe' && b.host === e), pal };
  }
  if (bid === 'arachna') {
    const st = a.s || 'walk';
    return { st, q: 0, wp: e.t * 7, mv: st === 'walk' ? 1 : 0, t, leapH: e.leapH || 0, yaw: st === 'leap' || st === 'crouch' ? Math.atan2(a.ty - e.y, a.tx - e.x) : toP, pal };
  }
  if (bid === 'serpent') return { t, open: a.s === 'wind' || a.s === 'lunge' ? 1 : 0.15 + Math.sin(t * 5) * 0.1, yaw: Math.atan2(e.vy, e.vx) || 0, pal };
  return { t, rot: e.rot || 0, ph: a.ph || 1, laser: !!a.laserOn, yaw: toP, pal };
}
function bossMesh(bid, ps, sc) {
  const m = new Mesh(); m.zc = BOSS_ZC[bid] * sc;
  m.push(); m.mul(m3yaw(ps.yaw || 0)); m.sc(sc); BOSS_M[bid](m, ps); m.pop();
  return m;
}
// высадка: детали падают с неба по порядку постройки (сначала ноги, потом корпус) и защёлкиваются
function skyAssemble(q, seed) {
  return m => {
    const n = m.prims.length;
    m.animate(pr => {
      const i = pr.i, p = clamp((q - (i / n) * 0.55) / 0.42, 0, 1);
      if (p <= 0) return PRIM_HIDE;
      if (p >= 1) return null;
      const h1 = hsh(i + 1, seed), h2 = hsh(i + 5, seed + 2), r = 1 - ease.outBack(p);
      return { m: animMat(pr.c, (h1 - 0.5) * 40 * r, (h2 - 0.5) * 40 * r, 170 * r, h2 - 0.5, h1 - 0.5, 0.4, (1 - p) * (2 + h1 * 3), 1), al: Math.min(1, p * 3), nodec: true };
    }, d => (q < 0.97 ? PRIM_HIDE : null));
  };
}
function drawBoss3D(c, e, z, e0, f0, t) {
  const bid = e.bid, sc = bossSc(e), ps = bossPose(e, t), view = enemyView();
  const m = bossMesh(bid, ps, sc);
  if (e.intro > 0) skyAssemble(1 - e.intro / BOSS_INTRO, e.id)(m);
  // смена фазы: броня «вздыхает» — детали расходятся и возвращаются
  else if (e.phaseT > 0) explodeAnim(0.45 * Math.sin(Math.PI * (1 - e.phaseT / 1.4)))(m);
  c.setTransform(z, 0, 0, z, e.x * z + e0, e.y * z + f0);
  renderMesh(c, m, ps.pal, view, {});
  if (e.flash > 0.035) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.16; renderMesh(c, m, ps.pal, view, { flat: '#ffffff' }); c.restore(); }
  if (e.st.chillT > 0 || e.st.freezeT > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.18; renderMesh(c, m, ps.pal, view, { flat: '#9ff0ff' }); c.restore(); }
  if (e.enraged) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.1 + Math.sin(t * 10) * 0.06; renderMesh(c, m, ps.pal, view, { flat: '#ff2a3a' }); c.restore(); }
  c.setTransform(z, 0, 0, z, e0, f0);
  if (bid === 'core') {
    if (e.dmgRes) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#46e3ff', 0.5 + Math.sin(t * 8) * 0.2); c.lineWidth = 2; c.beginPath(); c.arc(e.x, e.y, e.r * 1.25, 0, TAU); c.stroke(); c.restore(); }
    if (e.ai.laserOn) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      for (const off of [0, Math.PI]) {
        const a = e.ai.lang + off, x2 = e.x + Math.cos(a) * 720, y2 = e.y + Math.sin(a) * 720;
        c.strokeStyle = rgba('#ff3d5a', 0.7); c.lineWidth = 30 + Math.sin(t * 50) * 3; c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(x2, y2); c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = 8; c.stroke();
      }
      c.restore();
    }
  }
}
function drawBossShadow(c, e) {
  const sc = bossSc(e), view = enemyView(), cp = Math.cos(VIEW_PITCH[view]), sn = Math.max(0.42, Math.sin(VIEW_PITCH[view]));
  const q = e.intro > 0 ? 1 - e.intro / BOSS_INTRO : 1, rx = e.r * BOSS_VIS[e.bid] * (e.bid === 'serpent' ? 1.1 : 1.25) * (0.4 + 0.6 * q), ry = rx * sn;
  c.drawImage(shadowBlob(), e.x - rx, e.y + BOSS_ZC[e.bid] * sc * cp - ry, rx * 2, ry * 2);
}
// позвонки змея: живые модели, при высадке собираются вслед за головой
function drawSeg3D(c, e, z, e0, f0, t) {
  const B = e.parent, sc = e.r / 17 * BOSS_VIS.serpent, view = enemyView(), cp = Math.cos(VIEW_PITCH[view]), sn = Math.max(0.42, Math.sin(VIEW_PITCH[view]));
  const ps = { t, idx: e.idx, flash: e.flash, pal: bossPal('serpent'), yaw: e.ang || 0 };
  const m = new Mesh(); m.zc = 12 * sc;
  m.push(); m.mul(m3yaw(ps.yaw)); m.sc(sc); BOSS_M.seg(m, ps); m.pop();
  if (B && B.intro > 0) { const q = 1 - B.intro / BOSS_INTRO; skyAssemble(clamp((q - 0.25 - e.idx * 0.025) / 0.6, 0, 1), e.id)(m); }
  c.setTransform(z, 0, 0, z, e0, f0);
  const rx = e.r * 1.15, ry = rx * sn; c.drawImage(shadowBlob(), e.x - rx, e.y + 12 * sc * cp - ry, rx * 2, ry * 2);
  c.setTransform(z, 0, 0, z, e.x * z + e0, e.y * z + f0);
  renderMesh(c, m, ps.pal, view, {});
  if (e.flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.4; renderMesh(c, m, ps.pal, view, { flat: '#ffffff' }); c.restore(); }
}
// щитовые узлы ядра: пилоны с лучом к хозяину
function drawNode3D(c, e, z, e0, f0, t) {
  const view = enemyView(), cp = Math.cos(VIEW_PITCH[view]), ps = { t, idx: e.id % 7, pal: bossPal('core') };
  const m = new Mesh(); m.zc = 22;
  m.push(); BOSS_M.node(m, ps); m.pop();
  if (e.host && e.host.alive) {
    c.setTransform(z, 0, 0, z, e0, f0);
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#46e3ff', 0.35 + Math.sin(t * 9 + e.id) * 0.15); c.lineWidth = 2; c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(e.host.x, e.host.y); c.stroke(); c.restore();
  }
  c.setTransform(z, 0, 0, z, e0, f0);
  c.drawImage(shadowBlob(), e.x - 14, e.y + 22 * cp - 7, 28, 14);
  c.setTransform(z, 0, 0, z, e.x * z + e0, e.y * z + f0);
  renderMesh(c, m, ps.pal, view, {});
  if (e.flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5; renderMesh(c, m, ps.pal, view, { flat: '#ffffff' }); c.restore(); }
}
// гибель: корпус разваливается на детали
function bossWreck(e) {
  const bid = e.bid, sc = bossSc(e), ps = bossPose(e, G.time);
  addWreck({ x: e.x, y: e.y, k: 1, dur: 1.9, pal: ps.pal, D: e.r * 1.5, build: () => bossMesh(bid, ps, sc) });
  if (e.segs) e.segs.forEach((s, i) => {
    const sps = { t: G.time, idx: s.idx, flash: 0, pal: ps.pal, yaw: s.ang || 0 }, ssc = s.r / 17 * BOSS_VIS.serpent;
    addWreck({ x: s.x, y: s.y, k: 1, dur: 1.1 + i * 0.04, pal: ps.pal, D: s.r * 1.6, build: () => { const m = new Mesh(); m.zc = 12 * ssc; m.push(); m.mul(m3yaw(sps.yaw)); m.sc(ssc); BOSS_M.seg(m, sps); m.pop(); return m; } });
  });
}
/* --- превью для справочника --- */
function drawBossPreview(cv, bid) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height, pal = enemyPal(SECTORS[0].pal, BOSSES[bid].color, false);
  const ps = { st: 'walk', q: 0, wp: 0.6, t: 1, rot: 0.4, open: 0.3, fire: 0, ph: 2, idx: 1, pal, yaw: Math.PI / 2 - 0.55 };
  const m = bossMesh(bid, ps, 1);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const phi = VIEW_PITCH.front, sp = Math.sin(phi), cp = Math.cos(phi);
  for (const v of m.V) { const x = v[0], y = -v[1] * sp - (v[2] - m.zc) * cp; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.86;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
  c.setTransform(s, 0, 0, s, w / 2 - (x0 + x1) / 2 * s, h / 2 - (y0 + y1) / 2 * s);
  renderMesh(c, m, pal, 'front', {});
}
