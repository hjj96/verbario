'use strict';
/* ===== Отрисовка мира и главного меню ===== */

let canvas = null, ctx = null;
const RENDER = { z: 1, e0: 0, f0: 0, vign: null, frameMs: 16, slowFrames: 0, autoLow: false, ghost: null, ghostKey: '' };

function initCanvas() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d', { alpha: false });
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
}
function resize() {
  const w = Math.max(320, window.innerWidth), h = Math.max(320, window.innerHeight);
  const q = SAVE ? SAVE.settings.quality : 'auto';
  let dpr = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : 2);
  if (q === 'auto' && RENDER.autoLow) dpr = Math.min(dpr, 1.25);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  VIEW.w = w; VIEW.h = h; VIEW.dpr = dpr;
  // портрет (телефон): фиксируем видимую ширину, иначе робот слишком мелкий
  VIEW.scale = h > w ? clamp(w / 400, 0.62, 2.2) : clamp(Math.sqrt(w * h / 470000), 0.62, 2.2);
  VIEW.hw = w / 2 / VIEW.scale; VIEW.hh = h / 2 / VIEW.scale;
  FX.quality = q === 'low' || RENDER.autoLow ? 0.55 : 1;
  buildVignette();
  buildBloom();
}
// блум: уменьшенные копии кадра, «порог» умножением на себя, размытие цепочкой
function buildBloom() {
  const w = canvas.width, h = canvas.height;
  RENDER.bloom = { a: makeCanvas(w / 2, h / 2), b: makeCanvas(w / 4, h / 4), c: makeCanvas(w / 8, h / 8), d: makeCanvas(w / 16, h / 16) };
}
function bloomOn() { const q = SAVE ? SAVE.settings.quality : 'auto'; return q === 'high' || (q === 'auto' && !RENDER.autoLow); }
function applyBloom(c, k) {
  const B = RENDER.bloom;
  if (!B) return;
  const a = B.a.getContext('2d'), b = B.b.getContext('2d'), cc = B.c.getContext('2d'), d = B.d.getContext('2d');
  a.globalCompositeOperation = 'copy'; a.drawImage(canvas, 0, 0, B.a.width, B.a.height);
  b.globalCompositeOperation = 'copy'; b.drawImage(B.a, 0, 0, B.b.width, B.b.height);
  b.globalCompositeOperation = 'multiply'; b.drawImage(B.b, 0, 0);
  cc.globalCompositeOperation = 'copy'; cc.drawImage(B.b, 0, 0, B.c.width, B.c.height);
  d.globalCompositeOperation = 'copy'; d.drawImage(B.c, 0, 0, B.d.width, B.d.height);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.globalAlpha = k;
  c.drawImage(B.b, 0, 0, canvas.width, canvas.height); c.drawImage(B.c, 0, 0, canvas.width, canvas.height); c.drawImage(B.d, 0, 0, canvas.width, canvas.height);
  c.restore();
}
function buildVignette() {
  const w = canvas.width, h = canvas.height;
  const v = makeCanvas(w, h), c = v.getContext('2d');
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(1,3,8,0.62)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  RENDER.vign = v;
}
function worldToScreen(x, y) { return { x: (x * RENDER.z + RENDER.e0) / VIEW.dpr, y: (y * RENDER.z + RENDER.f0) / VIEW.dpr }; }

/* ---------- Пол: план-чертёж сектора ---------- */
function drawGround(c, x0, y0, x1, y1) {
  const T = 512, tile = SPR.bgTile, Pl = G.sector.pal, z = RENDER.z, e0 = RENDER.e0, f0 = RENDER.f0;
  const gx0 = Math.floor(x0 / T), gy0 = Math.floor(y0 / T), gx1 = Math.floor(x1 / T), gy1 = Math.floor(y1 / T);
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) c.drawImage(tile, gx * T, gy * T, T + 0.5, T + 0.5);
  const px = VIEW.dpr / z;
  c.lineWidth = px; c.strokeStyle = Pl.grid;
  c.beginPath();
  for (let x = Math.floor(x0 / 32) * 32; x <= x1; x += 32) { c.moveTo(x, y0); c.lineTo(x, y1); }
  for (let y = Math.floor(y0 / 32) * 32; y <= y1; y += 32) { c.moveTo(x0, y); c.lineTo(x1, y); }
  c.stroke();
  c.strokeStyle = Pl.gridMajor; c.lineWidth = px * 1.3;
  c.beginPath();
  for (let x = Math.floor(x0 / 160) * 160; x <= x1; x += 160) { c.moveTo(x, y0); c.lineTo(x, y1); }
  for (let y = Math.floor(y0 / 160) * 160; y <= y1; y += 160) { c.moveTo(x0, y); c.lineTo(x1, y); }
  c.stroke();
  c.strokeStyle = Pl.cross; c.lineWidth = px * 1.4;
  c.beginPath();
  for (let x = Math.floor(x0 / 160) * 160; x <= x1; x += 160) for (let y = Math.floor(y0 / 160) * 160; y <= y1; y += 160) { c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); }
  c.stroke();
  // подписи координат на редких узлах
  c.font = '600 7px "JetBrains Mono", monospace'; c.fillStyle = Pl.note; c.textBaseline = 'top';
  for (let x = Math.floor(x0 / 640) * 640; x <= x1; x += 640) for (let y = Math.floor(y0 / 640) * 640; y <= y1; y += 640) {
    if (hash2(x / 640, y / 640, 31) < 0.5) c.fillText('X ' + x + ' · Y ' + (-y), x + 4, y + 3);
  }
  // векторный декор по ячейкам
  const D = 320, seed = SECTORS.indexOf(G.sector) * 97 + 11, V = SPR.decoV || [];
  if (V.length) {
    for (let cy = Math.floor((y0 - 160) / D); cy <= Math.floor((y1 + 160) / D); cy++) for (let cx = Math.floor((x0 - 160) / D); cx <= Math.floor((x1 + 160) / D); cx++) {
      if (hash2(cx, cy, seed) > 0.5) continue;
      const d = V[Math.floor(hash2(cx, cy, seed + 7) * V.length)];
      const ox = (hash2(cx, cy, seed + 3) - 0.5) * 140, oy = (hash2(cx, cy, seed + 5) - 0.5) * 140;
      const x = cx * D + D / 2 + ox, y = cy * D + D / 2 + oy;
      if (x + d.r < x0 || x - d.r > x1 || y + d.r < y0 || y - d.r > y1) continue;
      const rot = Math.floor(hash2(cx, cy, seed + 9) * 4) * Math.PI / 2, sc = 0.9 + hash2(cx, cy, seed + 13) * 0.35;
      const ca = Math.cos(rot) * sc * z, sa = Math.sin(rot) * sc * z;
      c.setTransform(ca, sa, -sa, ca, x * z + e0, y * z + f0);
      for (const st of d.s) {
        c.globalAlpha = st.a; c.strokeStyle = st.col; c.lineWidth = st.w * VIEW.dpr / (z * sc);
        if (st.dash) c.setLineDash(st.dash);
        c.stroke(st.path);
        if (st.dash) c.setLineDash([]);
      }
      c.globalAlpha = 1;
      if (d.t) { c.setTransform(sc * z, 0, 0, sc * z, x * z + e0, y * z + f0); c.font = '600 8px "JetBrains Mono", monospace'; c.fillStyle = Pl.note; for (const t of d.t) c.fillText(t[2], t[0], t[1]); }
    }
    c.setTransform(z, 0, 0, z, e0, f0);
  }
  c.textBaseline = 'alphabetic';
}

/* ---------- Подбираемое ---------- */
function drawPickups(c) {
  const t = G.time;
  for (const g of G.gems) {
    if (!onScreen(g, 30)) continue;
    const s = SPR.gems[g.tier], bob = g.mag ? 0 : Math.sin(t * 4 + g.t) * 1.5;
    if (g.mag && g.sp > 200) { const d = Math.hypot(P.x - g.x, P.y - g.y) || 1, l = Math.min(26, g.sp * 0.03); c.strokeStyle = GEM_TIERS[g.tier].col; c.globalAlpha = 0.5; c.lineWidth = 1.2; c.beginPath(); c.moveTo(g.x, g.y); c.lineTo(g.x - (P.x - g.x) / d * l, g.y - (P.y - g.y) / d * l); c.stroke(); c.globalAlpha = 1; }
    c.drawImage(s.cv, g.x - s.size / 2, g.y - s.size / 2 + bob, s.size, s.size);
  }
  for (const it of G.items) {
    const s = SPR.items[it.kind];
    if (!s) continue;
    const bob = Math.sin(t * 3 + it.x) * 2;
    const k = it.kind === 'bigchest' ? 1.3 : 1;
    if (it.kind === 'chest' || it.kind === 'bigchest') {
      c.save(); c.globalCompositeOperation = 'lighter';
      c.strokeStyle = rgba(it.kind === 'bigchest' ? '#ffd36b' : '#46e3ff', 0.4 + Math.sin(t * 5) * 0.2); c.lineWidth = 1.5;
      c.beginPath(); c.arc(it.x, it.y, 22 + Math.sin(t * 3) * 3, 0, TAU); c.stroke(); c.restore();
    }
    c.drawImage(s.cv, it.x - s.size * k / 2, it.y - s.size * k / 2 + bob, s.size * k, s.size * k);
  }
}

/* ---------- Враги ---------- */
function drawEnemies(c, z, e0, f0) {
  const t = G.time;
  const det = RENDER.det || (RENDER.det = []);
  det.length = 0;
  for (const e of G.enemies) {
    if (!e.alive || !onScreen(e, 70)) continue;
    if (e.boss) { c.setTransform(z, 0, 0, z, e0, f0); drawBoss(c, e, t); continue; }
    if (e.parent) { c.setTransform(z, 0, 0, z, e0, f0); drawSegment(c, e, t); continue; }
    const S = SPR.enemies[e.tid];
    const fi = ((t * 7 + e.anim) | 0) & 1;
    let k = e.scale;
    if (e.t < 0.35) k *= 0.45 + 0.55 * ease.outBack(e.t / 0.35);
    const sz = S.size * k, h = sz / 2, a = e.ang || 0, ca = Math.cos(a) * z, sa = Math.sin(a) * z;
    c.setTransform(ca, sa, -sa, ca, e.x * z + e0, e.y * z + f0);
    if (e.elite) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + Math.sin(t * 5) * 0.15; c.drawImage(dotSprite('#ffd36b'), -h * 0.9, -h * 0.9, h * 1.8, h * 1.8); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
    if (e.phased) c.globalAlpha = 0.3 + Math.sin(t * 50) * 0.15;
    if (e.t < 0.35) c.globalAlpha = Math.min(c.globalAlpha, e.t / 0.2);
    c.drawImage(S.frames[fi], -h, -h, sz, sz);
    if (e.flash > 0) { c.globalAlpha = 0.65; c.drawImage(S.flash, -h, -h, sz, sz); }
    if (e.st.freezeT > 0) { c.globalAlpha = 0.7; c.drawImage(S.ice, -h, -h, sz, sz); }
    else if (e.st.chillT > 0) { c.globalAlpha = 0.28; c.drawImage(S.ice, -h, -h, sz, sz); }
    c.globalAlpha = 1;
    if (e.t < 0.4 || e.tid === 'kami' || e.tid === 'charger' || e.shieldT > 0 || e.st.stunT > 0 || e.st.markT > 0 || e.elite || e.tid === 'shielder' || e.tid === 'medic' || (e.tid === 'eater' && e.ate)) det.push(e);
  }
  c.setTransform(z, 0, 0, z, e0, f0);
  if (!det.length) return;
  const Pl = G.sector.pal;
  c.lineCap = 'round';
  c.strokeStyle = rgba(Pl.enemy, 0.7); c.lineWidth = 1; c.beginPath();
  for (const e of det) if (e.t < 0.4) { const q = e.t / 0.4, r = e.r * (2.6 - q * 1.4); c.moveTo(e.x + r, e.y); c.arc(e.x, e.y, r, 0, TAU * (0.3 + q * 0.7)); }
  c.stroke();
  c.strokeStyle = 'rgba(167,123,255,0.4)'; c.lineWidth = 1; c.beginPath();
  for (const e of det) if (e.shieldT > 0) { c.moveTo(e.x + e.r + 4, e.y); c.arc(e.x, e.y, e.r + 4, 0, TAU); }
  c.stroke();
  c.setLineDash([3, 5]);
  c.strokeStyle = 'rgba(167,123,255,0.14)'; c.beginPath();
  for (const e of det) if (e.tid === 'shielder') { c.moveTo(e.x + 95, e.y); c.arc(e.x, e.y, 95, 0, TAU); }
  c.stroke();
  c.strokeStyle = 'rgba(93,255,155,0.14)'; c.beginPath();
  for (const e of det) if (e.tid === 'medic') { c.moveTo(e.x + 120, e.y); c.arc(e.x, e.y, 120, 0, TAU); }
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#ffe66b'; c.beginPath();
  for (const e of det) if (e.st.stunT > 0) for (let i = 0; i < 3; i++) { const a = t * 6 + i * TAU / 3, sx = e.x + Math.cos(a) * e.r * 0.8, sy = e.y - e.r - 4 + Math.sin(a) * 3; c.moveTo(sx + 1.6, sy); c.arc(sx, sy, 1.6, 0, TAU); }
  c.fill();
  for (const e of det) {
    if (e.tid === 'kami' && e.ai.fuse !== undefined) {
      if (Math.sin(t * 50) > 0) glow(c, e.x, e.y, 26, '#ff3b3b', 0.9);
      c.strokeStyle = 'rgba(255,59,59,0.55)'; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.arc(e.x, e.y, 54, 0, TAU); c.stroke(); c.setLineDash([]);
    }
    if (e.tid === 'charger' && e.ai.s === 'wind') {
      const q = 1 - e.ai.t / 0.7, ex = e.x + Math.cos(e.ai.ang) * 230, ey = e.y + Math.sin(e.ai.ang) * 230;
      c.strokeStyle = rgba('#ff4d5e', 0.04 + q * 0.06); c.lineWidth = e.r;
      c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(ex, ey); c.stroke();
      c.strokeStyle = rgba('#ff4d5e', 0.35 + q * 0.4); c.lineWidth = 1; c.setLineDash([6, 5]); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(ex - Math.cos(e.ai.ang - 0.5) * 9, ey - Math.sin(e.ai.ang - 0.5) * 9); c.lineTo(ex, ey); c.lineTo(ex - Math.cos(e.ai.ang + 0.5) * 9, ey - Math.sin(e.ai.ang + 0.5) * 9); c.stroke();
    }
    if (e.tid === 'eater' && e.ate) { const q = Math.min(1, e.ate / 40); glow(c, e.x, e.y, e.r * (0.6 + q * 0.6), '#b38bff', 0.5 + q * 0.5); }
    if (e.st.markT > 0) { c.strokeStyle = 'rgba(255,77,94,0.85)'; c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + t * 2; c.moveTo(e.x + Math.cos(a) * (e.r + 3), e.y + Math.sin(a) * (e.r + 3)); c.lineTo(e.x + Math.cos(a) * (e.r + 9), e.y + Math.sin(a) * (e.r + 9)); } c.stroke(); }
    if (e.elite) {
      const w = e.r * 2.4, q = clamp(e.hp / e.maxHp, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(e.x - w / 2, e.y - e.r - 12, w, 4);
      c.fillStyle = '#ffd36b'; c.fillRect(e.x - w / 2, e.y - e.r - 12, w * q, 4);
    }
  }
  c.lineCap = 'butt';
}
function drawWarns(c) {
  for (const w of G.warns) {
    const q = w.t / w.dur;
    if (w.kind === 'c') {
      c.fillStyle = rgba('#ff4d5e', 0.12 + q * 0.12);
      c.beginPath(); c.arc(w.x, w.y, w.r, 0, TAU); c.fill();
      c.fillStyle = rgba('#ff4d5e', 0.3); c.beginPath(); c.arc(w.x, w.y, w.r * q, 0, TAU); c.fill();
      c.strokeStyle = rgba('#ff4d5e', 0.85); c.lineWidth = 2; c.beginPath(); c.arc(w.x, w.y, w.r, 0, TAU); c.stroke();
    } else {
      c.strokeStyle = rgba('#ff4d5e', 0.14 + q * 0.2); c.lineWidth = w.w; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(w.x, w.y); c.lineTo(w.x + Math.cos(w.ang) * w.len, w.y + Math.sin(w.ang) * w.len); c.stroke();
      c.strokeStyle = rgba('#ff4d5e', 0.8); c.lineWidth = 1.5;
      for (const s of [-1, 1]) { const ox = -Math.sin(w.ang) * w.w / 2 * s, oy = Math.cos(w.ang) * w.w / 2 * s; c.beginPath(); c.moveTo(w.x + ox, w.y + oy); c.lineTo(w.x + ox + Math.cos(w.ang) * w.len, w.y + oy + Math.sin(w.ang) * w.len); c.stroke(); }
    }
  }
}
function drawEnemyBullets(c) {
  c.globalCompositeOperation = 'lighter';
  for (const b of G.ebullets) {
    if (b.kind === 'glob') {
      const y = b.y - (b.h || 0);
      c.drawImage(dotSprite(b.col), b.x - 9, y - 9, 18, 18);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(b.tx, b.ty, 10, 4, 0, 0, TAU); c.fill();
      c.globalCompositeOperation = 'lighter';
      continue;
    }
    const s = b.r * 2.6;
    c.drawImage(dotSprite(b.col), b.x - s, b.y - s, s * 2, s * 2);
  }
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#ffffff';
  for (const b of G.ebullets) { if (b.kind === 'glob') continue; c.beginPath(); c.arc(b.x, b.y, b.r * 0.45, 0, TAU); c.fill(); }
}

/* ---------- Игрок ---------- */
function playerOpts(extra) {
  const o = {
    moving: P.moving, wp: P.wp, back: P.back, fire: P.fire, siege: P.siege, dist: P.dist, view: P.view, aim: P.aim, hd: P.hd, mounts: P.weapons, squash: P.squash,
    mvDir: P.back ? P.hd + Math.PI : P.hd, kick: P.kick || 0, hurt: P.hurtFlash * P.hurtFlash, hitA: P.hitA, headYaw: P.hy || 0,
  };
  if (extra) for (const k in extra) o[k] = extra[k];
  return o;
}
// модель игрока на этот кадр: одна сборка на тень, корпус и дульные срезы; в овердрайве бронеплиты раскрыты
function playerMesh() {
  if (P._mesh && P._meshT === G.time && P._meshV === P.view && P._meshL === P.look && P._meshOd === P.od.active) return P._mesh;
  const m = buildRobot(P.look, robotPose(P.look, G.time, playerOpts()));
  if (P.od.active) explodeAnim(odOpen(G.time))(m);
  P._mesh = m; P._meshT = G.time; P._meshV = P.view; P._meshL = P.look; P._meshOd = P.od.active;
  return m;
}
// тень настоящей формы робота на полу (рисуется вместе с полом, под врагами)
function drawPlayerShadow(c, z, e0, f0) {
  if (G.tf.cur || P.split || !P.look) return;
  const view = P.view === 'top' ? 'top' : 'front', k = robotK(P.look, view);
  c.setTransform(z * k, 0, 0, z * k, P.x * z + e0, P.y * z + f0);
  // светлое пятно реактора на полу — на нём читается тень
  const fy = ZC * Math.cos(VIEW_PITCH[view]), fl = Math.sin(VIEW_PITCH[view]), lc = P.od.active ? '255,79,154' : '70,227,255';
  const g = c.createRadialGradient(0, fy, 0, 0, fy, 46);
  g.addColorStop(0, 'rgba(' + lc + ',0.13)'); g.addColorStop(1, 'rgba(' + lc + ',0)');
  c.fillStyle = g; c.beginPath(); c.ellipse(0, fy, 46, 46 * fl, 0, 0, TAU); c.fill();
  renderShadow(c, playerMesh(), view, {}, 0.42);
  c.setTransform(z, 0, 0, z, e0, f0);
}
function ghostSprite() {
  const L = P.look;
  const key = PART_ORDER.map(k => L.parts[k].rank + (L.parts[k].branch || '')).join('') + L.form + (L.od > 0.5 ? 'o' : '') + P.view + Math.round(P.aim * 3) + ':' + Math.round(P.hd * 3);
  if (RENDER.ghostKey !== key) {
    RENDER.ghostKey = key;
    const s = robotSnapshot(L, 0, { view: P.view, aim: P.aim, hd: P.hd, mounts: P.weapons });
    RENDER.ghost = { snap: s, cyan: silhouette(s.cv, '#46e3ff'), mag: silhouette(s.cv, OD_COLOR) };
  }
  return RENDER.ghost;
}
function drawSplit(c, z, e0, f0) {
  const sp = P.split, q = clamp(sp.t / sp.dur, 0, 1), L = P.look;
  c.save();
  c.setTransform(z, 0, 0, z, e0, f0);
  c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  const paths = [];
  for (const pt of sp.parts) {
    const qq = ease.inOutCubic(clamp((q - pt.d) / (1 - 0.1), 0, 1));
    const mx = (sp.fx + sp.tx) / 2 + pt.nx * pt.bend, my = (sp.fy + sp.ty) / 2 + pt.ny * pt.bend;
    const B = u => ({ x: (1 - u) * (1 - u) * sp.fx + 2 * (1 - u) * u * mx + u * u * sp.tx, y: (1 - u) * (1 - u) * sp.fy + 2 * (1 - u) * u * my + u * u * sp.ty });
    const cur = B(qq);
    paths.push({ pt, cur, qq });
    if (qq > 0.02 && qq < 0.99) {
      c.beginPath();
      for (let k = 0; k <= 8; k++) { const u = Math.max(0, qq - k * 0.04), p = B(u); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
      c.strokeStyle = 'rgba(70,227,255,0.28)'; c.lineWidth = 2.4; c.stroke();
      c.strokeStyle = 'rgba(234,246,255,0.55)'; c.lineWidth = 0.8; c.stroke();
    }
  }
  c.restore();
  // одна модель: каждый узел летит своей дугой и кувыркается в 3D вокруг своего шарнира, глубина — общая
  const vo = playerOpts({ static: true, moving: 0 }), view = P.view === 'top' ? 'top' : 'front';
  const k = robotK(L, view), spn = Math.sin(VIEW_PITCH[view]);
  const m = buildRobot(L, robotPose(L, G.time, vo)), GM = {};
  for (const { pt, cur, qq } of paths) {
    const key = pt.only === 'arms' ? 'arms' + pt.armSide : pt.only;
    const an = (pt.only === 'arms' ? m.pa[pt.armSide > 0 ? 'jR' : 'jL'] : m.pa[pt.only]) || [0, 0, ZC];
    const hop = Math.sin(qq * Math.PI);
    GM[key] = animMat(an, (cur.x - P.x) / k, -(cur.y - P.y) / (k * spn), hop * 7, pt.ax[0], pt.ax[1], pt.ax[2], hop * pt.spin * 1.4, 1);
  }
  const gk = x => (x.g === 'arms' ? 'arms' + x.side : x.g);
  m.animate(pr => (GM[gk(pr)] ? { m: GM[gk(pr)] } : null), d => GM[gk(d)] || null);
  c.setTransform(z, 0, 0, z, P.x * z + e0, P.y * z + f0);
  drawRobot(c, L, G.time, Object.assign({}, vo, { mesh: m }));
}
function drawPlayer(c, z, e0, f0) {
  const L = P.look, sc = L.scale;
  const gs = FX.ghosts.length ? ghostSprite() : null;
  if (gs) for (const g of FX.ghosts) {
    c.setTransform(z, 0, 0, z, g.x * z + e0, g.y * z + f0);
    c.globalAlpha = (g.life / g.max) * 0.45; c.globalCompositeOperation = 'lighter';
    drawSnap(c, gs.snap, g.od ? gs.mag : gs.cyan, 1);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  c.setTransform(z, 0, 0, z, P.x * z + e0, P.y * z + f0);
  const ly = robotLayout(L), view = P.view === 'top' ? 'top' : 'front', K = robotK(L, view), fy = feetY(L, view), flat = Math.sin(VIEW_PITCH[view]);
  // тень на полу: эллипс в проекции камеры, у парящего робота — меньше и бледнее
  const sr = (ly.tread ? 19 : ly.hover ? 11 : 14) * K, g = c.createRadialGradient(0, fy, 0, 0, fy, sr);
  g.addColorStop(0, ly.hover ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.ellipse(0, fy, sr, sr * flat, 0, 0, TAU); c.fill();
  glow(c, 0, 0, 46 * sc, '#46e3ff', 0.12);
  if (P.siege) { c.strokeStyle = rgba('#ff8a3d', 0.5 + Math.sin(G.time * 10) * 0.2); c.lineWidth = 1.5; c.setLineDash([4, 4]); c.beginPath(); c.ellipse(0, fy, 26 * K, 26 * K * flat, 0, 0, TAU); c.stroke(); c.setLineDash([]); }
  const tf = G.tf.cur;
  if (P.split && !tf) { drawSplit(c, z, e0, f0); c.setTransform(z, 0, 0, z, P.x * z + e0, P.y * z + f0); }
  else {
    const blink = P.iframes > 0 && P.hurtFlash > 0 && !P.od.active && (Math.floor(G.rt * 22) % 2 === 0);
    if (blink) c.globalAlpha = 0.45;
    if (tf && tf.drawSubject) tf.drawSubject(c, G.time);
    else drawRobot(c, L, G.time, Object.assign(playerOpts(), { mesh: playerMesh() }));
    c.globalAlpha = 1;
  }
  if (P.hurtFlash > 0.5) glow(c, 0, -4, 40 * sc, '#ff2a3a', (P.hurtFlash - 0.5) * 0.8);
  if (P.shield.has && P.shield.ready && !tf) {
    c.save(); c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba('#ff9a4a', 0.35 + Math.sin(G.time * 4) * 0.12); c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, -2 * K, 30 * sc, 0, TAU); c.stroke(); c.restore();
  }
  if (hasBranch('back', 'B') && !tf) {
    const r = (P.parts.back.rank >= 5 ? 72 : 48) * P.stats.area;
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#9dffcf', 0.18); c.lineWidth = 6;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); c.restore();
  }
  if (!tf && !P.split) {
    const w = 34, q = clamp(P.hp / P.stats.maxHp, 0, 1), y = fy + 8 * K;
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(-w / 2 - 1, y - 1, w + 2, 5);
    c.fillStyle = q > 0.5 ? '#5dff9b' : q > 0.25 ? '#ffd36b' : '#ff4d5e'; c.fillRect(-w / 2, y, w * q, 3);
  }
}
// линии скорости: радиальные (трансформация) или вдоль рывка
function drawSpeedLines(c, k) {
  const W = VIEW.w, H = VIEW.h, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
  c.save(); c.fillStyle = 'rgba(234,246,255,' + (0.22 * k) + ')';
  const t = Math.floor(G.rt * 30);
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * TAU + hash2(i, t, 3) * 0.12, r1 = R * (0.6 + hash2(i, t, 5) * 0.3), w = 0.002 + hash2(i, t, 7) * 0.004;
    c.beginPath(); c.moveTo(cx + Math.cos(a - w) * r1, cy + Math.sin(a - w) * r1); c.lineTo(cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2); c.lineTo(cx + Math.cos(a + w) * r1, cy + Math.sin(a + w) * r1); c.fill();
  }
  c.restore();
}
function drawDashLines(c, k) {
  const W = VIEW.w, H = VIEW.h, a = FX.speedDir, ca = Math.cos(a), sa = Math.sin(a), t = Math.floor(G.rt * 40);
  c.save(); c.strokeStyle = 'rgba(191,246,255,' + (0.35 * k) + ')'; c.lineWidth = 1.2; c.beginPath();
  for (let i = 0; i < 26; i++) {
    const off = (hash2(i, t, 11) - 0.5) * Math.hypot(W, H), along = (hash2(i, t, 13) - 0.5) * W, len = 40 + hash2(i, t, 17) * 120;
    const x = W / 2 - sa * off + ca * along, y = H / 2 + ca * off + sa * along;
    c.moveTo(x, y); c.lineTo(x - ca * len, y - sa * len);
  }
  c.stroke(); c.restore();
}

/* ---------- Полный кадр игры ---------- */
function renderGame() {
  const c = ctx, dpr = VIEW.dpr, W = canvas.width, H = canvas.height;
  const z = VIEW.scale * G.cam.zoom * dpr;
  let sx = 0, sy = 0;
  if (FX.shake > 0 && SAVE.settings.shake && G.state === 'play') { sx = rand(-1, 1) * FX.shake; sy = rand(-1, 1) * FX.shake; }
  const cx = G.cam.x + sx / VIEW.scale, cy = G.cam.y + sy / VIEW.scale;
  const e0 = W / 2 - cx * z, f0 = H / 2 - cy * z;
  RENDER.z = z; RENDER.e0 = e0; RENDER.f0 = f0;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = G.sector.pal.ground; c.fillRect(0, 0, W, H);
  c.setTransform(z, 0, 0, z, e0, f0);
  const vx0 = cx - W / 2 / z, vy0 = cy - H / 2 / z, vx1 = cx + W / 2 / z, vy1 = cy + H / 2 / z;
  drawGround(c, vx0, vy0, vx1, vy1);
  FX.drawLights(c);
  for (const a of G.areas) if (a.kind !== 'ring' && a.kind !== 'strike') AK[a.kind].draw(c, a);
  drawWarns(c);
  drawPickups(c);
  drawPlayerShadow(c, z, e0, f0);
  FX.drawUnder(c);
  drawEnemies(c, z, e0, f0);
  const dim = G.tf.dim();
  if (dim > 0) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(2,4,10,' + dim + ')'; c.fillRect(0, 0, W, H); }
  c.setTransform(z, 0, 0, z, e0, f0);
  if (!G.tf.cur) for (const w of P.weapons) { const d = WD[w.id]; if (d) d(c, w); }
  drawPlayer(c, z, e0, f0);
  c.setTransform(z, 0, 0, z, e0, f0);
  c.globalCompositeOperation = 'lighter';
  for (const p of G.projs) if (p.kind === 'bolt' || p.kind === 'orb' || p.kind === 'flame' || p.kind === 'bomblet' || p.kind === 'grav') PK[p.kind].draw(c, p);
  c.globalCompositeOperation = 'source-over';
  for (const p of G.projs) if (p.kind === 'missile' || p.kind === 'saw' || p.kind === 'bigsaw' || p.kind === 'shard' || p.kind === 'feather') PK[p.kind].draw(c, p);
  for (const a of G.areas) if (a.kind === 'ring' || a.kind === 'strike') AK[a.kind].draw(c, a);
  drawEnemyBullets(c);
  FX.drawGlow(c);
  if (bloomOn()) applyBloom(c, 0.6);
  // экранные слои
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const spd = Math.max(G.tf.cur && G.tf.cur.speed ? G.tf.cur.speed() : 0, 0);
  if (spd > 0.01) drawSpeedLines(c, spd);
  if (FX.speedT > 0 && P.split) drawDashLines(c, Math.min(1, FX.speedT * 6));
  FX.drawTexts(c, worldToScreen, 1);
  drawOffscreen(c);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (RENDER.vign) c.drawImage(RENDER.vign, 0, 0);
  const hp = P.hp / P.stats.maxHp;
  if (hp < 0.3 && G.state === 'play') {
    const a = (0.3 - hp) / 0.3 * (0.35 + Math.sin(G.rt * 6) * 0.12);
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, 'rgba(255,0,30,0)'); g.addColorStop(1, 'rgba(255,0,30,' + a + ')');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  if (FX.flashA > 0) { c.globalAlpha = Math.min(1, FX.flashA); c.fillStyle = FX.flashCol; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  if (G.freezeT > 0) { c.fillStyle = 'rgba(143,232,255,' + (0.08 + Math.sin(G.rt * 4) * 0.03) + ')'; c.fillRect(0, 0, W, H); }
  if (FX.impact > 0 && G.state === 'play') { FX.impact--; c.globalCompositeOperation = 'difference'; c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
  INPUT.drawJoystick(c, dpr);
}
function drawOffscreen(c) {
  const W = VIEW.w, H = VIEW.h, m = 46;
  const mark = (x, y, col, label) => {
    const p = worldToScreen(x, y);
    if (p.x > 0 && p.x < W && p.y > 0 && p.y < H) return;
    const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy;
    const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
    const ax = cx + dx * k, ay = cy + dy * k, a = Math.atan2(dy, dx);
    c.save(); c.translate(ax, ay); c.rotate(a);
    c.fillStyle = col; c.beginPath(); c.moveTo(14, 0); c.lineTo(-6, -9); c.lineTo(-2, 0); c.lineTo(-6, 9); c.closePath(); c.fill();
    c.restore();
    if (label) { c.font = '600 10px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.fillStyle = col; c.fillText(label, ax - Math.cos(a) * 22, ay - Math.sin(a) * 22 + 3); }
  };
  for (const e of G.enemies) if (e.boss && e.alive) mark(e.x, e.y, '#ff4d5e', e.name);
  for (const it of G.items) if (it.kind === 'chest' || it.kind === 'bigchest') mark(it.x, it.y, it.kind === 'bigchest' ? '#ffd36b' : '#46e3ff', null);
}

/* ===== Главное меню: чертёж и витрина трансформаций ===== */
const MENU = { t: 0, tf: new Transformer(), subj: null, idle: 0, robotIdx: 0, resetT: 0, layout: null };
function menuInit() {
  const r = ROBOTS[MENU.robotIdx % ROBOTS.length];
  const parts = {}; for (const k of PART_ORDER) parts[k] = { rank: 0, branch: null };
  const yaw = MENU.subj ? MENU.subj.aim : Math.PI / 2 - 0.5;
  MENU.subj = { x: 0, y: 0, look: makeLook(r, parts, 0, 0), time: () => MENU.t, aim: yaw, hd: yaw, view: 'front' };
  MENU.tf.clear(); MENU.idle = 1.4; MENU.resetT = 0;
}
function menuUpdate(dt) {
  MENU.t += dt;
  MENU.tf.update(dt);
  FX.update(dt);
  const S = MENU.subj;
  if (!S) return;
  // поворотный стол: медленный оборот, на время смены формы — пауза (форма крутит робота сама)
  const tf = MENU.tf.cur;
  if (!(tf && tf.kind === 'form')) { S.aim += dt * 0.42; S.hd = S.aim; }
  if (MENU.tf.busy) return;
  if (MENU.resetT > 0) {
    MENU.resetT -= dt;
    if (MENU.resetT <= 0) {
      FX.burst(0, -6, 30, '#46e3ff', 260, 0.7, 7); FX.sparks(0, -6, 30, '#ffd36b', 340);
      MENU.robotIdx = (MENU.robotIdx + 1) % ROBOTS.length;
      menuInit();
    }
    return;
  }
  MENU.idle -= dt;
  if (MENU.idle > 0) return;
  MENU.idle = 1.3;
  const parts = S.look.parts;
  const open = PART_ORDER.filter(k => parts[k].rank < 5);
  if (!open.length) { MENU.resetT = 2.2; return; }
  const k = pick(open), nr = parts[k].rank + 1, br = nr === 3 ? (Math.random() < 0.5 ? 'A' : 'B') : parts[k].branch;
  MENU.tf.push(seqPart(S, k, nr, br, { silent: true, fast: true }));
  let tot = 1; for (const q of PART_ORDER) tot += parts[q].rank;
  const nf = formFor(tot);
  if (nf > S.look.form) MENU.tf.push(seqForm(S, nf, { silent: true }));
}
function menuLayout() {
  const W = VIEW.w, H = VIEW.h, wide = W > 860;
  const size = wide ? Math.min(H * 0.72, W * 0.44) : Math.min(W * 0.8, H * 0.36);
  return { cx: wide ? W * 0.68 : W / 2, cy: wide ? H * 0.52 : H * 0.19, size, wide };
}
function renderMenu() {
  const c = ctx, dpr = VIEW.dpr, W = canvas.width, H = canvas.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = VIEW.w, h = VIEW.h, t = MENU.t;
  const off = (t * 6) % 32;
  c.strokeStyle = 'rgba(70,227,255,0.06)'; c.lineWidth = 1;
  c.beginPath();
  for (let x = -off; x < w; x += 32) { c.moveTo(x, 0); c.lineTo(x, h); }
  for (let y = -off; y < h; y += 32) { c.moveTo(0, y); c.lineTo(w, y); }
  c.stroke();
  c.strokeStyle = 'rgba(70,227,255,0.12)';
  c.beginPath();
  for (let x = -off; x < w; x += 160) { c.moveTo(x, 0); c.lineTo(x, h); }
  for (let y = -off; y < h; y += 160) { c.moveTo(0, y); c.lineTo(w, y); }
  c.stroke();
  const Lc = menuLayout();
  MENU.layout = Lc;
  const S = MENU.subj;
  if (!S) return;
  const sc = Lc.size / 90;
  // круги разметки
  c.save(); c.translate(Lc.cx, Lc.cy);
  c.strokeStyle = 'rgba(70,227,255,0.16)'; c.setLineDash([4, 6]);
  c.beginPath(); c.arc(0, 0, Lc.size * 0.48, 0, TAU); c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(70,227,255,0.3)';
  c.beginPath(); c.arc(0, 0, Lc.size * 0.5, t * 0.3, t * 0.3 + 1.2); c.stroke();
  c.beginPath(); c.arc(0, 0, Lc.size * 0.5, t * 0.3 + Math.PI, t * 0.3 + Math.PI + 1.2); c.stroke();
  c.restore();
  // робот
  c.save(); c.translate(Lc.cx, Lc.cy); c.scale(sc, sc);
  const g = c.createRadialGradient(0, 0, 4, 0, 0, 60);
  g.addColorStop(0, 'rgba(70,227,255,0.18)'); g.addColorStop(1, 'rgba(70,227,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 60, 0, TAU); c.fill();
  const fy = feetY(S.look, 'front'), K = robotK(S.look, 'front'), fl = Math.sin(VIEW_PITCH.front);
  // поворотная платформа: эллипс на полу и бегущие засечки
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.ellipse(0, fy, 17 * K, 17 * K * fl, 0, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(70,227,255,0.35)'; c.lineWidth = 1 / sc;
  c.beginPath(); c.ellipse(0, fy, 24 * K, 24 * K * fl, 0, 0, TAU); c.stroke();
  c.beginPath();
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24 - S.aim, r0 = 24 * K, r1 = (i % 6 ? 26 : 28.5) * K; c.moveTo(Math.cos(a) * r0, fy + Math.sin(a) * r0 * fl); c.lineTo(Math.cos(a) * r1, fy + Math.sin(a) * r1 * fl); }
  c.stroke();
  FX.drawUnder(c);
  const tf = MENU.tf.cur;
  if (tf && tf.drawSubject) tf.drawSubject(c, t);
  else drawRobot(c, S.look, t, svo(S, { static: false }));
  FX.drawGlow(c);
  c.restore();
  // выноски следуют за модулями при повороте
  const vo = tf && tf.voAt ? tf.voAt(tf.t) : svo(S);
  const R = robotPoints(S.look, t, vo), ls = sc;
  const side = { head: 1, back: -1, arms: 1, core: -1, legs: 1 };
  const rowY = { head: -0.36, back: -0.18, arms: 0.0, core: 0.14, legs: 0.32 };
  const pts = {}, cd = R.pa.core ? R.pa.core.d : 0;
  for (const k of PART_ORDER) {
    let p = R.pa[k] || { x: 0, y: 0, d: 0 };
    if (k === 'arms' && R.pa.jR && R.pa.jL) p = R.pa.jR.x * side.arms > R.pa.jL.x * side.arms ? R.pa.jR : R.pa.jL;
    pts[k] = [p.x, p.y, p.d];
  }
  c.font = '600 11px "JetBrains Mono", monospace'; c.textBaseline = 'middle';
  // левые подписи не должны залезать на колонку меню: при нехватке места уходят направо
  const tb = Lc.wide ? document.querySelector('#scr-title .title-block') : null, leftLim = tb ? tb.getBoundingClientRect().right + 14 : 0;
  for (const k of PART_ORDER) {
    const p = pts[k], x = Lc.cx + p[0] * ls, y = Lc.cy + p[1] * ls, hid = p[2] < cd - 3;
    const pr = S.look.parts[k];
    let s = side[k];
    if (s < 0) {
      const d0 = pr.rank ? partRankDef(k, pr.rank, pr.branch) : null;
      const tw = Math.max(c.measureText(PARTS[k].code + ' · МК-' + ROMAN[pr.rank]).width, c.measureText(d0 ? d0.name : 'базовая сборка').width);
      if (Lc.cx - Lc.size * (Lc.wide ? 0.56 : 0.5) - 6 - tw < leftLim) s = 1;
    }
    const d1 = pr.rank ? partRankDef(k, pr.rank, pr.branch) : null;
    const tw1 = Math.max(c.measureText(PARTS[k].code + ' · МК-' + ROMAN[pr.rank]).width, c.measureText(d1 ? d1.name : 'базовая сборка').width);
    let lx = Lc.cx + s * Lc.size * (Lc.wide ? 0.56 : 0.5);
    if (Lc.wide || w >= 520) { if (s > 0) lx = Math.min(lx, w - 14 - tw1); else lx = Math.max(lx, 14 + tw1); }
    const lyy = Lc.cy + rowY[k] * Lc.size;
    c.strokeStyle = hid ? 'rgba(70,227,255,0.22)' : 'rgba(70,227,255,0.45)'; c.lineWidth = 1;
    if (hid) c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(x, y); c.lineTo(lx - s * 30, lyy); c.lineTo(lx, lyy); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.arc(x, y, 2.2, 0, TAU);
    if (hid) { c.strokeStyle = '#46e3ff'; c.stroke(); } else { c.fillStyle = '#46e3ff'; c.fill(); }
    const def = pr.rank ? partRankDef(k, pr.rank, pr.branch) : null;
    const label = PARTS[k].code + ' · МК-' + ROMAN[pr.rank];
    const sub = def ? def.name : 'базовая сборка';
    c.textAlign = s > 0 ? 'left' : 'right';
    if (!Lc.wide && w < 520) continue;
    c.fillStyle = '#e8f2ff'; c.fillText(label, lx + s * 6, lyy - 7);
    c.fillStyle = '#8ea6c4'; c.fillText(sub, lx + s * 6, lyy + 8);
  }
  c.textAlign = 'center'; c.fillStyle = 'rgba(255,211,107,0.85)'; c.font = '600 12px "JetBrains Mono", monospace';
  if (Lc.wide) c.fillText('ФОРМА ' + FORMS[S.look.form].code + ' · ' + FORMS[S.look.form].name.toUpperCase(), Lc.cx, Lc.cy + Lc.size * 0.56);
  if (RENDER.vign) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 0.8; c.drawImage(RENDER.vign, 0, 0); c.globalAlpha = 1; }
  if (FX.flashA > 0) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = Math.min(0.5, FX.flashA); c.fillStyle = FX.flashCol; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
}
