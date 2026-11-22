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

/* ---------- Враги ---------- */
const ENEMY_DRAW = {
  bug(c, r, P, acc, f) {
    const L = P.enemyL, B = P.enemy, D = P.enemyD;
    c.strokeStyle = D; c.lineWidth = 1.6; c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
      const ph = (f + (i + 1)) % 2 ? 1 : -1;
      const bx = i * r * 0.45, by = s * r * 0.45;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + ph * r * 0.25 + i * r * 0.2, s * r * 1.05); c.stroke();
    }
    c.beginPath(); c.ellipse(-r * 0.1, 0, r, r * 0.76, 0, 0, TAU);
    c.fillStyle = rgrad(c, -r * 0.1, 0, r, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = rgba('#000000', 0.35); c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(-r * 0.9, 0); c.lineTo(r * 0.4, 0); c.stroke();
    c.beginPath(); c.ellipse(r * 0.72, 0, r * 0.42, r * 0.4, 0, 0, TAU); c.fillStyle = D; c.fill(); c.stroke();
    glow(c, r * 0.85, 0, r * 0.8, acc, 0.9);
    c.beginPath(); c.arc(r * 0.85, 0, r * 0.16, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
  tank(c, r, P, acc, f) {
    const L = P.enemyL, B = P.enemy, D = P.enemyD;
    c.fillStyle = D;
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const lx = -r * 0.35 + i * r * 0.7 + ((f % 2) ? 1 : -1) * r * 0.06;
      c.beginPath(); c.ellipse(lx, s * r * 0.82, r * 0.22, r * 0.18, 0, 0, TAU); c.fill();
    }
    c.beginPath(); c.ellipse(0, 0, r * 1.05, r * 0.86, 0, 0, TAU);
    c.fillStyle = rgrad(c, 0, 0, r * 1.05, [shade(L, 0.15), B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1.2; c.stroke();
    c.strokeStyle = rgba(D, 0.9); c.lineWidth = 1.1;
    for (let k = -1; k <= 1; k++) { c.beginPath(); c.ellipse(k * r * 0.42, 0, r * 0.2, r * 0.8, 0, -1.2, 1.2); c.stroke(); }
    c.beginPath(); c.ellipse(-r * 0.15, -r * 0.25, r * 0.5, r * 0.22, -0.2, 0, TAU); c.fillStyle = rgba('#ffffff', 0.18); c.fill();
    pathRR(c, r * 0.55, -r * 0.35, r * 0.4, r * 0.7, r * 0.15); c.fillStyle = '#0b0d12'; c.fill();
    glow(c, r * 0.78, 0, r * 0.7, acc, 0.8);
    c.fillStyle = acc; c.fillRect(r * 0.68, -r * 0.22, r * 0.18, r * 0.44);
  },
  kami(c, r, P, acc, f) {
    const D = P.enemyD, B = P.enemy;
    c.strokeStyle = D; c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const x = Math.cos(a) * r * 1.15, y = Math.sin(a) * r * 1.15;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(x, y); c.stroke();
      c.beginPath(); c.ellipse(x, y, r * 0.55, r * 0.18, a + f * 0.8, 0, TAU); c.fillStyle = rgba('#cfd8e6', 0.45); c.fill();
    }
    c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.fillStyle = rgrad(c, 0, 0, r * 0.62, [P.enemyL, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    glow(c, 0, 0, r * 1.1, acc, f % 2 ? 1 : 0.55);
    c.beginPath(); c.arc(0, 0, r * 0.25, 0, TAU); c.fillStyle = f % 2 ? '#ffffff' : acc; c.fill();
  },
  gunner(c, r, P, acc, f) {
    const D = P.enemyD, B = P.enemy;
    c.strokeStyle = D; c.lineWidth = 2; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i - 1) * 1.1 + (f % 2 ? 0.08 : -0.08);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 1.1 - r * 0.2, Math.sin(a) * r * 1.05); c.stroke();
    }
    c.beginPath(); c.arc(0, 0, r * 0.82, 0, TAU); c.fillStyle = rgrad(c, 0, 0, r * 0.82, [P.enemyL, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(0, 0, r * 0.45, 0, TAU); c.fillStyle = D; c.fill();
    glow(c, 0, 0, r * 0.7, acc, 0.85);
    c.beginPath(); c.arc(0, 0, r * 0.18, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
  charger(c, r, P, acc, f) {
    const D = P.enemyD, B = P.enemy, L = P.enemyL;
    c.strokeStyle = D; c.lineWidth = 1.8;
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const lx = -r * 0.5 + i * r * 0.6, ph = (f + i) % 2 ? 0.2 : -0.2;
      c.beginPath(); c.moveTo(lx, s * r * 0.4); c.lineTo(lx + ph * r, s * r * 0.95); c.stroke();
    }
    pathPoly(c, [-r * 0.95, -r * 0.62, r * 0.35, -r * 0.55, r * 0.95, 0, r * 0.35, r * 0.55, -r * 0.95, r * 0.62, -r * 0.7, 0]);
    c.fillStyle = grad(c, 0, -r, 0, r, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1.1; c.stroke();
    pathPoly(c, [r * 0.55, -r * 0.18, r * 1.45, 0, r * 0.55, r * 0.18]); c.fillStyle = '#e8e2d6'; c.fill(); c.stroke();
    c.strokeStyle = acc; c.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) { c.beginPath(); c.moveTo(-r * 0.5 + k * r * 0.35, -r * 0.45); c.lineTo(-r * 0.3 + k * r * 0.35, r * 0.45); c.stroke(); }
    glow(c, r * 0.4, 0, r * 0.5, acc, 0.8);
  },
  splitter(c, r, P, acc, f) {
    const B = P.enemy, D = P.enemyD, L = P.enemyL;
    const bub = [[-r * 0.35, -r * 0.3, r * 0.6], [-r * 0.3, r * 0.35, r * 0.58], [r * 0.35, 0, r * 0.62]];
    for (const b of bub) {
      c.beginPath(); c.arc(b[0], b[1], b[2] * (1 + (f % 2) * 0.04), 0, TAU);
      c.fillStyle = rgrad(c, b[0], b[1], b[2], [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    }
    glow(c, 0, 0, r * 0.9, acc, 0.85);
    c.beginPath(); c.arc(0, 0, r * 0.26, 0, TAU); c.fillStyle = acc; c.fill();
    c.beginPath(); c.arc(0, 0, r * 0.1, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
  mini(c, r, P, acc, f) {
    c.strokeStyle = P.enemyD; c.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4 + (f % 2 ? 0.25 : -0.25); c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2); c.stroke(); }
    c.beginPath(); c.arc(0, 0, r * 0.8, 0, TAU); c.fillStyle = rgrad(c, 0, 0, r * 0.8, [P.enemyL, P.enemy, P.enemyD]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    glow(c, r * 0.3, 0, r * 0.6, acc, 0.9);
  },
  shielder(c, r, P, acc, f) {
    const B = P.enemy, D = P.enemyD, L = P.enemyL;
    c.fillStyle = D;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse((f % 2 ? 0.1 : -0.1) * r, s * r * 0.9, r * 0.3, r * 0.18, 0, 0, TAU); c.fill(); }
    const hex = [];
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; hex.push(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); }
    pathPoly(c, hex); c.fillStyle = rgrad(c, 0, 0, r, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1.1; c.stroke();
    c.beginPath(); c.arc(r * 0.1, 0, r * 0.42, 0, TAU); c.fillStyle = D; c.fill();
    glow(c, r * 0.1, 0, r * 0.95, acc, 0.9);
    c.beginPath(); c.arc(r * 0.1, 0, r * 0.22, 0, TAU); c.fillStyle = shade(acc, 0.5); c.fill();
  },
  medic(c, r, P, acc, f) {
    const B = P.enemy, D = P.enemyD, L = P.enemyL;
    c.beginPath(); c.ellipse(0, 0, r * 1.25, r * 0.28, f * 0.9, 0, TAU); c.fillStyle = rgba('#d6e2ee', 0.4); c.fill();
    c.beginPath(); c.arc(0, 0, r * 0.85, 0, TAU); c.fillStyle = rgrad(c, 0, 0, r * 0.85, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    c.fillStyle = acc;
    c.fillRect(-r * 0.14, -r * 0.5, r * 0.28, r); c.fillRect(-r * 0.5, -r * 0.14, r, r * 0.28);
    glow(c, 0, 0, r * 1.1, acc, 0.6);
  },
  blinker(c, r, P, acc, f) {
    const B = P.enemy, L = P.enemyL;
    pathPoly(c, [r * 1.1, 0, 0, -r * 0.85, -r * 1.1, 0, 0, r * 0.85]);
    c.fillStyle = grad(c, -r, -r, r, r, [shade(L, 0.3), B, P.enemyD]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = rgba(acc, 0.9); c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(-r * 0.6, -r * 0.1 + f * 0.4); c.lineTo(r * 0.7, -r * 0.1 + f * 0.4); c.stroke();
    c.beginPath(); c.moveTo(-r * 0.4, r * 0.3 - f * 0.3); c.lineTo(r * 0.4, r * 0.3 - f * 0.3); c.stroke();
    glow(c, 0, 0, r * 1.2, acc, 0.7);
    c.beginPath(); c.arc(r * 0.25, 0, r * 0.18, 0, TAU); c.fillStyle = '#fff'; c.fill();
  },
  eater(c, r, P, acc, f) {
    const B = P.enemy, D = P.enemyD, L = P.enemyL;
    c.fillStyle = '#15181f';
    pathRR(c, -r * 0.95, r * 0.55, r * 1.7, r * 0.45, r * 0.2); c.fill();
    pathRR(c, -r * 0.95, -r, r * 1.7, r * 0.45, r * 0.2); c.fill();
    pathRR(c, -r * 0.9, -r * 0.78, r * 1.75, r * 1.56, r * 0.35); c.fillStyle = grad(c, 0, -r, 0, r, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1.1; c.stroke();
    pathRR(c, r * 0.55, -r * 0.62, r * 0.45, r * 1.24, r * 0.15); c.fillStyle = '#090a0e'; c.fill();
    c.strokeStyle = shade(acc, -0.1); c.lineWidth = 1;
    for (let k = 0; k < 4; k++) { const y = -r * 0.48 + k * r * 0.32; c.beginPath(); c.moveTo(r * 0.6, y); c.lineTo(r * 0.95, y + (f % 2 ? 0.6 : -0.6)); c.stroke(); }
    pathRR(c, -r * 0.6, -r * 0.32, r * 0.9, r * 0.64, r * 0.15); c.fillStyle = '#100a1a'; c.fill(); c.strokeStyle = '#07080c'; c.stroke();
    glow(c, r * 0.75, 0, r * 0.8, acc, 0.7);
  },
  spitter(c, r, P, acc, f) {
    const B = P.enemy, D = P.enemyD, L = P.enemyL;
    c.beginPath(); c.ellipse(-r * 0.1, 0, r * 1.1, r * 0.7 + (f % 2) * r * 0.04, 0, 0, TAU);
    c.fillStyle = rgrad(c, -r * 0.1, 0, r * 1.1, [L, B, D]); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = rgba(D, 0.8); c.lineWidth = 1;
    for (let k = -1; k <= 1; k++) { c.beginPath(); c.arc(k * r * 0.45 - r * 0.1, 0, r * 0.62, -1.1, 1.1); c.stroke(); }
    c.beginPath(); c.arc(-r * 0.2, -r * 0.1, r * 0.45, 0, TAU); c.fillStyle = rgrad(c, -r * 0.2, -r * 0.1, r * 0.45, ['#f4ffd0', acc, shade(acc, -0.5)]); c.fill(); c.strokeStyle = '#07080c'; c.stroke();
    glow(c, -r * 0.2, -r * 0.1, r * 0.8, acc, 0.6);
    pathRR(c, r * 0.6, -r * 0.18, r * 0.5, r * 0.36, r * 0.12); c.fillStyle = D; c.fill();
    c.beginPath(); c.arc(r * 1.1, 0, r * 0.12, 0, TAU); c.fillStyle = acc; c.fill();
  },
  prop(c, r, P, acc, f) {
    pathRR(c, -r, -r * 0.85, r * 2, r * 1.7, r * 0.2);
    c.fillStyle = grad(c, 0, -r, 0, r, ['#5d6673', '#3b424d', '#22272f']); c.fill(); c.strokeStyle = '#07080c'; c.lineWidth = 1.2; c.stroke();
    c.save(); pathRR(c, -r, -r * 0.85, r * 2, r * 0.5, r * 0.2); c.clip();
    c.fillStyle = '#ffb43d'; for (let x = -r * 1.4; x < r * 1.4; x += r * 0.5) { pathPoly(c, [x, -r * 0.35, x + r * 0.25, -r * 0.35, x + r * 0.5, -r * 0.85, x + r * 0.25, -r * 0.85]); c.fill(); }
    c.restore();
    c.strokeStyle = rgba('#000000', 0.5); c.lineWidth = 1; c.strokeRect(-r * 0.7, -r * 0.2, r * 1.4, r * 0.85);
    glow(c, 0, r * 0.22, r * 0.7, acc, 0.5 + (f % 2) * 0.2);
    c.fillStyle = acc; c.fillRect(-r * 0.3, r * 0.15, r * 0.6, r * 0.14);
  },
};

function flipCanvas(cv) {
  const f = makeCanvas(cv.width, cv.height), c = f.getContext('2d');
  c.translate(cv.width, 0); c.scale(-1, 1); c.drawImage(cv, 0, 0);
  return f;
}
function buildEnemySprites(P) {
  SPR.enemies = {};
  // разрешение под реальный масштаб экрана (меньше лишней выборки текстуры)
  const res = clamp((VIEW.scale || 1) * (VIEW.dpr || 1) * 1.15, 1.4, SPR_RES);
  for (const id in ENEMIES) {
    const T = ENEMIES[id];
    const r = T.r, size = r * 3.2, px = Math.ceil(size * res);
    const frames = [];
    for (let f = 0; f < 2; f++) {
      const cv = makeCanvas(px, px), c = cv.getContext('2d');
      c.translate(px / 2, px / 2); c.scale(px / size, px / size);
      c.save(); c.translate(0, r * 0.95); c.scale(1, 0.32);
      c.beginPath(); c.arc(0, 0, r * 1.05, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(); c.restore();
      ENEMY_DRAW[id] ? ENEMY_DRAW[id](c, r, P, T.acc, f) : ENEMY_DRAW.bug(c, r, P, T.acc, f);
      frames.push(cv);
    }
    const flash = silhouette(frames[0], '#ffffff'), ice = silhouette(frames[0], '#9ff0ff');
    SPR.enemies[id] = { frames, flip: frames.map(flipCanvas), flash, flashF: flipCanvas(flash), ice, iceF: flipCanvas(ice), size };
  }
}

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
    glow(c, 0, 0, g.r * 2.4, g.col, 0.7);
    const r = g.r;
    pathPoly(c, [0, -r * 1.25, r * 0.8, -r * 0.2, 0, r * 1.15, -r * 0.8, -r * 0.2]);
    c.fillStyle = grad(c, -r, -r, r, r, ['#ffffff', g.col, shade(g.col, -0.5)]); c.fill();
    c.strokeStyle = shade(g.col, -0.6); c.lineWidth = 0.8; c.stroke();
    pathPoly(c, [0, -r * 1.25, r * 0.8, -r * 0.2, 0, -r * 0.05]); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();
    return { cv, size: px / SPR_RES };
  });
  const mk = (sz, fn) => { const px = Math.ceil(sz * SPR_RES), cv = makeCanvas(px, px), c = cv.getContext('2d'); c.translate(px / 2, px / 2); c.scale(SPR_RES, SPR_RES); fn(c); return { cv, size: sz }; };
  SPR.items.scrap = mk(22, c => {
    glow(c, 0, 0, 10, '#ffb43d', 0.6);
    c.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * TAU / 16, rr = i % 2 ? 4.2 : 5.6; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    c.closePath(); c.fillStyle = grad(c, -5, -5, 5, 5, ['#fff2c2', '#ffb43d', '#8a5a10']); c.fill(); c.strokeStyle = '#3a2506'; c.lineWidth = 0.8; c.stroke();
    c.beginPath(); c.arc(0, 0, 1.8, 0, TAU); c.fillStyle = '#3a2506'; c.fill();
  });
  SPR.items.heal = mk(26, c => {
    glow(c, 0, 0, 12, '#5dff9b', 0.6);
    pathRR(c, -7, -4.5, 14, 9, 4.5); c.fillStyle = grad(c, 0, -5, 0, 5, ['#f4fff8', '#c9d6dc', '#7f8b94']); c.fill(); c.strokeStyle = '#0b1014'; c.lineWidth = 0.9; c.stroke();
    c.fillStyle = '#ff4d5e'; c.fillRect(-1.2, -3.2, 2.4, 6.4); c.fillRect(-3.2, -1.2, 6.4, 2.4);
  });
  SPR.items.magnet = mk(26, c => {
    glow(c, 0, 0, 12, '#46e3ff', 0.55);
    c.lineWidth = 3.6; c.strokeStyle = '#ff4d5e'; c.beginPath(); c.arc(0, -1, 5, Math.PI, 0); c.stroke();
    c.strokeStyle = '#ff4d5e'; c.beginPath(); c.moveTo(-5, -1); c.lineTo(-5, 3); c.moveTo(5, -1); c.lineTo(5, 3); c.stroke();
    c.strokeStyle = '#e8eef5'; c.beginPath(); c.moveTo(-5, 3); c.lineTo(-5, 6); c.moveTo(5, 3); c.lineTo(5, 6); c.stroke();
  });
  SPR.items.bomb = mk(26, c => {
    glow(c, 0, 0, 12, '#ff4f9a', 0.55);
    c.beginPath(); c.arc(0, 1, 6, 0, TAU); c.fillStyle = grad(c, -5, -5, 5, 6, ['#555c6b', '#22262f', '#0b0d12']); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 0.8; c.stroke();
    c.strokeStyle = '#ff4f9a'; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 1, 3.6, 0, TAU); c.stroke();
    c.font = 'bold 5px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ff9ac6'; c.fillText('ЭМИ', 0, 1.3);
    c.fillStyle = '#c9ced8'; c.fillRect(-1.2, -7, 2.4, 2.6);
  });
  SPR.items.freeze = mk(26, c => {
    glow(c, 0, 0, 12, '#8fe8ff', 0.6);
    c.strokeStyle = '#e9fbff'; c.lineWidth = 1.5; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3;
      c.beginPath(); c.moveTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5); c.lineTo(-Math.cos(a) * 6.5, -Math.sin(a) * 6.5); c.stroke();
    }
    c.strokeStyle = '#8fe8ff'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, x = Math.cos(a) * 4, y = Math.sin(a) * 4;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a + 0.7) * 2, y + Math.sin(a + 0.7) * 2); c.moveTo(x, y); c.lineTo(x + Math.cos(a - 0.7) * 2, y + Math.sin(a - 0.7) * 2); c.stroke();
    }
  });
  const chest = (gold) => mk(34, c => {
    const col = gold ? '#ffd36b' : '#46e3ff';
    glow(c, 0, 0, 16, col, 0.75);
    const hex = []; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; hex.push(Math.cos(a) * 10, Math.sin(a) * 10); }
    pathPoly(c, hex); c.fillStyle = grad(c, 0, -10, 0, 10, ['#59626f', '#2c323c', '#14181f']); c.fill(); c.strokeStyle = col; c.lineWidth = 1.3; c.stroke();
    const hex2 = []; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; hex2.push(Math.cos(a) * 5.5, Math.sin(a) * 5.5); }
    pathPoly(c, hex2); c.fillStyle = rgba(col, 0.25); c.fill(); c.strokeStyle = col; c.lineWidth = 0.9; c.stroke();
    c.beginPath(); c.moveTo(-10, 0); c.lineTo(-5.5, 0); c.moveTo(10, 0); c.lineTo(5.5, 0); c.stroke();
    glow(c, 0, 0, 6, '#ffffff', 0.8);
  });
  SPR.items.chest = chest(false);
  SPR.items.bigchest = chest(true);
}

/* ---------- Декор и фон ---------- */
function buildBackground(S) {
  const P = S.pal;
  // текстурная плитка 512 единиц
  const tile = makeCanvas(512, 512), c = tile.getContext('2d');
  c.fillStyle = P.ground; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = rand(30, 110);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(P.ground2, 0.9)); g.addColorStop(1, rgba(P.ground2, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i++) {
    c.fillStyle = rgba(Math.random() < 0.5 ? '#000000' : '#ffffff', rand(0.02, 0.06));
    const s = rand(1, 3); c.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  c.strokeStyle = rgba('#000000', 0.35); c.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * TAU;
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 7; k++) { a += rand(-0.8, 0.8); x += Math.cos(a) * rand(8, 22); y += Math.sin(a) * rand(8, 22); c.lineTo(x, y); }
    c.stroke();
  }
  if (S.id === 'neon') {
    c.strokeStyle = rgba('#36e2ff', 0.07); c.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let x = Math.round(Math.random() * 16) * 32, y = Math.round(Math.random() * 16) * 32;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) { if (Math.random() < 0.5) x += (Math.random() < 0.5 ? -1 : 1) * 64; else y += (Math.random() < 0.5 ? -1 : 1) * 64; c.lineTo(x, y); }
      c.stroke();
      c.fillStyle = rgba('#36e2ff', 0.12); c.fillRect(x - 3, y - 3, 6, 6);
    }
  }
  if (S.id === 'hive') {
    c.strokeStyle = rgba('#ff3d5a', 0.08); c.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      let x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * TAU;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 12; k++) { a += rand(-0.5, 0.5); x += Math.cos(a) * 14; y += Math.sin(a) * 14; c.lineTo(x, y); }
      c.stroke();
    }
  }
  SPR.bgTile = tile;
  // декор
  SPR.deco = [];
  const mk = (w, h, fn) => { const cv = makeCanvas(w * 2, h * 2), x = cv.getContext('2d'); x.scale(2, 2); x.translate(w / 2, h / 2); fn(x); return { cv, w, h }; };
  const crater = mk(120, 80, x => {
    x.beginPath(); x.ellipse(0, 0, 52, 30, 0, 0, TAU); x.fillStyle = rgba('#000000', 0.35); x.fill();
    x.beginPath(); x.ellipse(0, -3, 44, 24, 0, 0, TAU); x.fillStyle = rgba('#000000', 0.25); x.fill();
    x.strokeStyle = rgba('#ffffff', 0.05); x.lineWidth = 3; x.beginPath(); x.ellipse(0, 2, 50, 28, 0, 0.2, Math.PI - 0.2); x.stroke();
  });
  const puddle = (col) => mk(110, 60, x => {
    x.beginPath(); x.ellipse(0, 0, 48, 20, 0, 0, TAU); x.fillStyle = rgba('#000000', 0.45); x.fill();
    x.beginPath(); x.ellipse(-8, -3, 30, 9, 0, 0, TAU); x.fillStyle = rgba(col, 0.12); x.fill();
  });
  if (S.id === 'rust') {
    SPR.deco.push(crater, puddle('#ff8a3d'));
    SPR.deco.push(mk(110, 90, x => {
      for (let i = 0; i < 14; i++) {
        x.save(); x.translate(rand(-34, 34), rand(-18, 22)); x.rotate(rand(-1, 1));
        const w = rand(10, 30), h = rand(5, 14);
        x.fillStyle = pick([P.deco, P.deco2, '#4a3a2c', '#2e3842']); x.fillRect(-w / 2, -h / 2, w, h);
        x.strokeStyle = rgba('#000', 0.6); x.lineWidth = 1; x.strokeRect(-w / 2, -h / 2, w, h); x.restore();
      }
      x.fillStyle = rgba('#ff8a3d', 0.25); x.fillRect(-6, -4, 3, 3);
    }));
    SPR.deco.push(mk(90, 70, x => {
      for (let i = 0; i < 3; i++) {
        x.beginPath(); x.ellipse(-14 + i * 14, 6 - i * 2, 14, 9, 0, 0, TAU); x.fillStyle = '#1b1e22'; x.fill(); x.strokeStyle = '#000'; x.stroke();
        x.beginPath(); x.ellipse(-14 + i * 14, 6 - i * 2, 6, 4, 0, 0, TAU); x.fillStyle = '#0c0d0f'; x.fill();
      }
    }));
    SPR.deco.push(mk(140, 50, x => {
      x.fillStyle = grad(x, 0, -10, 0, 10, ['#5a4636', '#3b2a20', '#1d140f']);
      pathRR(x, -60, -9, 120, 18, 8); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1.2; x.stroke();
      x.beginPath(); x.ellipse(60, 0, 5, 9, 0, 0, TAU); x.fillStyle = '#0d0b09'; x.fill();
      for (let k = -40; k <= 40; k += 26) { x.fillStyle = '#2a1e16'; x.fillRect(k, -10, 5, 20); }
    }));
  } else if (S.id === 'neon') {
    SPR.deco.push(crater, puddle('#ff3fa4'), puddle('#36e2ff'));
    SPR.deco.push(mk(120, 60, x => {
      pathRR(x, -50, -18, 100, 36, 4); x.fillStyle = '#120f22'; x.fill(); x.strokeStyle = '#000'; x.stroke();
      x.strokeStyle = rgba('#ff3fa4', 0.75); x.lineWidth = 2.2; x.lineCap = 'round';
      x.beginPath(); x.moveTo(-38, 8); x.lineTo(-30, -8); x.lineTo(-22, 8); x.moveTo(-10, -8); x.lineTo(-10, 8); x.lineTo(2, 8); x.moveTo(14, -8); x.lineTo(30, -8); x.stroke();
      glow(x, -12, 0, 40, '#ff3fa4', 0.18);
    }));
    SPR.deco.push(mk(110, 60, x => {
      x.strokeStyle = '#090812'; x.lineWidth = 4; x.lineCap = 'round';
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(-50, -10 + i * 6); x.bezierCurveTo(-10, -30 + i * 10, 10, 30 - i * 8, 50, -4 + i * 5); x.stroke(); }
      x.strokeStyle = rgba('#36e2ff', 0.35); x.lineWidth = 1; x.beginPath(); x.moveTo(-50, -4); x.bezierCurveTo(-10, -20, 10, 22, 50, 6); x.stroke();
    }));
    SPR.deco.push(mk(70, 70, x => {
      x.beginPath(); x.arc(0, 0, 24, 0, TAU); x.fillStyle = '#16131f'; x.fill(); x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke();
      x.strokeStyle = '#26223a'; x.lineWidth = 2; for (let k = -16; k <= 16; k += 8) { x.beginPath(); x.moveTo(k, -18); x.lineTo(k, 18); x.stroke(); }
    }));
  } else {
    SPR.deco.push(crater, puddle('#ff3d5a'));
    SPR.deco.push(mk(110, 90, x => {
      for (let i = 0; i < 9; i++) {
        const cx = rand(-34, 34), cy = rand(-24, 24), r = rand(7, 14);
        const hex = []; for (let k = 0; k < 6; k++) { const a = k * TAU / 6; hex.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        pathPoly(x, hex); x.fillStyle = pick(['#3d1424', '#4d1a2d', '#2a0f1f']); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1.2; x.stroke();
        x.beginPath(); x.arc(cx, cy, r * 0.35, 0, TAU); x.fillStyle = rgba('#ff3d5a', 0.35); x.fill();
      }
    }));
    SPR.deco.push(mk(90, 60, x => {
      for (let i = 0; i < 5; i++) {
        const cx = -28 + i * 14, cy = rand(-8, 8);
        x.beginPath(); x.ellipse(cx, cy, 6, 9, rand(-0.4, 0.4), 0, TAU);
        x.fillStyle = grad(x, cx, cy - 9, cx, cy + 9, ['#ffd23f', '#d9572b', '#5a1020']); x.fill(); x.strokeStyle = '#1a0508'; x.stroke();
        glow(x, cx, cy, 14, '#ff8a3d', 0.15);
      }
    }));
    SPR.deco.push(mk(130, 60, x => {
      x.strokeStyle = '#2a0f1f'; x.lineWidth = 6; x.lineCap = 'round';
      x.beginPath(); x.moveTo(-58, 10); x.quadraticCurveTo(0, -30, 58, 10); x.stroke();
      x.strokeStyle = '#4d1a2d'; x.lineWidth = 2; x.stroke();
      for (let k = -40; k <= 40; k += 20) { x.beginPath(); x.moveTo(k, -8 + Math.abs(k) * 0.3); x.lineTo(k, 16); x.strokeStyle = '#2a0f1f'; x.lineWidth = 3; x.stroke(); }
    }));
  }
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
