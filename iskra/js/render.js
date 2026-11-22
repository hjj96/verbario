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
  VIEW.scale = h > w ? clamp(w / 440, 0.62, 2.1) : clamp(Math.sqrt(w * h / 580000), 0.62, 2.1);
  VIEW.hw = w / 2 / VIEW.scale; VIEW.hh = h / 2 / VIEW.scale;
  FX.quality = q === 'low' || RENDER.autoLow ? 0.55 : 1;
  buildVignette();
}
function buildVignette() {
  const w = canvas.width, h = canvas.height;
  const v = makeCanvas(w, h), c = v.getContext('2d');
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(2,4,10,0.72)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  RENDER.vign = v;
}
function worldToScreen(x, y) { return { x: (x * RENDER.z + RENDER.e0) / VIEW.dpr, y: (y * RENDER.z + RENDER.f0) / VIEW.dpr }; }

/* ---------- Земля ---------- */
function drawGround(c, x0, y0, x1, y1) {
  const T = 512, tile = SPR.bgTile, Pl = G.sector.pal;
  const gx0 = Math.floor(x0 / T), gy0 = Math.floor(y0 / T), gx1 = Math.floor(x1 / T), gy1 = Math.floor(y1 / T);
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) c.drawImage(tile, gx * T, gy * T, T + 0.5, T + 0.5);
  const px = VIEW.dpr / RENDER.z;
  c.lineWidth = px;
  c.strokeStyle = Pl.grid;
  c.beginPath();
  for (let x = Math.floor(x0 / 64) * 64; x <= x1; x += 64) { c.moveTo(x, y0); c.lineTo(x, y1); }
  for (let y = Math.floor(y0 / 64) * 64; y <= y1; y += 64) { c.moveTo(x0, y); c.lineTo(x1, y); }
  c.stroke();
  c.strokeStyle = Pl.gridMajor; c.lineWidth = px * 1.5;
  c.beginPath();
  for (let x = Math.floor(x0 / 320) * 320; x <= x1; x += 320) { c.moveTo(x, y0); c.lineTo(x, y1); }
  for (let y = Math.floor(y0 / 320) * 320; y <= y1; y += 320) { c.moveTo(x0, y); c.lineTo(x1, y); }
  c.stroke();
  c.strokeStyle = rgba(Pl.a, 0.28); c.lineWidth = px * 1.5;
  c.beginPath();
  for (let x = Math.floor(x0 / 320) * 320; x <= x1; x += 320) for (let y = Math.floor(y0 / 320) * 320; y <= y1; y += 320) { c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.moveTo(x, y - 6); c.lineTo(x, y + 6); }
  c.stroke();
  const D = 260, seed = SECTORS.indexOf(G.sector) * 97 + 11;
  if (SPR.deco.length) {
    for (let cy = Math.floor((y0 - 80) / D); cy <= Math.floor((y1 + 80) / D); cy++) for (let cx = Math.floor((x0 - 80) / D); cx <= Math.floor((x1 + 80) / D); cx++) {
      if (hash2(cx, cy, seed) > 0.42) continue;
      const d = SPR.deco[Math.floor(hash2(cx, cy, seed + 7) * SPR.deco.length)];
      const ox = (hash2(cx, cy, seed + 3) - 0.5) * 150, oy = (hash2(cx, cy, seed + 5) - 0.5) * 150;
      c.drawImage(d.cv, cx * D + D / 2 + ox - d.w / 2, cy * D + D / 2 + oy - d.h / 2, d.w, d.h);
    }
  }
}

/* ---------- Подбираемое ---------- */
function drawPickups(c) {
  const t = G.time;
  for (const g of G.gems) {
    if (!onScreen(g, 30)) continue;
    const s = SPR.gems[g.tier], bob = Math.sin(t * 4 + g.t) * 1.5;
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
  c.setTransform(z, 0, 0, z, e0, f0);
  const det = RENDER.det || (RENDER.det = []);
  det.length = 0;
  for (const e of G.enemies) {
    if (!e.alive || !onScreen(e, 70)) continue;
    if (e.boss) { drawBoss(c, e, t); c.setTransform(z, 0, 0, z, e0, f0); continue; }
    if (e.parent) { drawSegment(c, e, t); continue; }
    const S = SPR.enemies[e.tid];
    const fl = e.face < 0, fi = ((t * 7 + e.anim) | 0) & 1;
    const sz = S.size * e.scale, h = sz / 2, x = e.x - h, y = e.y - h;
    if (e.elite) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55 + Math.sin(t * 5) * 0.15; c.drawImage(dotSprite('#ffd36b'), e.x - sz * 0.55, e.y - sz * 0.55, sz * 1.1, sz * 1.1); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
    if (e.phased) c.globalAlpha = 0.3 + Math.sin(t * 50) * 0.15;
    c.drawImage(fl ? S.flip[fi] : S.frames[fi], x, y, sz, sz);
    if (e.flash > 0) { c.globalAlpha = 0.6; c.drawImage(fl ? S.flashF : S.flash, x, y, sz, sz); }
    if (e.st.freezeT > 0) { c.globalAlpha = 0.7; c.drawImage(fl ? S.iceF : S.ice, x, y, sz, sz); }
    else if (e.st.chillT > 0) { c.globalAlpha = 0.28; c.drawImage(fl ? S.iceF : S.ice, x, y, sz, sz); }
    c.globalAlpha = 1;
    if (e.tid === 'gunner' || e.tid === 'kami' || e.tid === 'charger' || e.shieldT > 0 || e.st.stunT > 0 || e.st.markT > 0 || e.elite || e.tid === 'shielder' || e.tid === 'medic' || (e.tid === 'eater' && e.ate)) det.push(e);
  }
  if (!det.length) return;
  // пакетные детали
  c.lineCap = 'round';
  c.strokeStyle = '#1a1e26'; c.lineWidth = 4; c.beginPath();
  for (const e of det) if (e.tid === 'gunner') { const a = Math.atan2(P.y - e.y, P.x - e.x); c.moveTo(e.x, e.y); c.lineTo(e.x + Math.cos(a) * e.r * 1.25, e.y + Math.sin(a) * e.r * 1.25); }
  c.stroke();
  c.strokeStyle = 'rgba(70,227,255,0.32)'; c.lineWidth = 1; c.beginPath();
  for (const e of det) if (e.shieldT > 0) { c.moveTo(e.x + e.r + 4, e.y); c.arc(e.x, e.y, e.r + 4, 0, TAU); }
  c.stroke();
  c.strokeStyle = 'rgba(70,227,255,0.06)'; c.beginPath();
  for (const e of det) if (e.tid === 'shielder') { c.moveTo(e.x + 95, e.y); c.arc(e.x, e.y, 95, 0, TAU); }
  c.stroke();
  c.strokeStyle = 'rgba(93,255,155,0.08)'; c.beginPath();
  for (const e of det) if (e.tid === 'medic') { c.moveTo(e.x + 120, e.y); c.arc(e.x, e.y, 120, 0, TAU); }
  c.stroke();
  c.fillStyle = '#ffe66b'; c.beginPath();
  for (const e of det) if (e.st.stunT > 0) for (let i = 0; i < 3; i++) { const a = t * 6 + i * TAU / 3, sx = e.x + Math.cos(a) * e.r * 0.8, sy = e.y - e.r - 4 + Math.sin(a) * 3; c.moveTo(sx + 1.6, sy); c.arc(sx, sy, 1.6, 0, TAU); }
  c.fill();
  for (const e of det) {
    if (e.tid === 'kami' && e.ai.fuse !== undefined) {
      if (Math.sin(t * 50) > 0) glow(c, e.x, e.y, 26, '#ff3b3b', 0.9);
      c.strokeStyle = 'rgba(255,59,59,0.5)'; c.lineWidth = 1; c.beginPath(); c.arc(e.x, e.y, 54, 0, TAU); c.stroke();
    }
    if (e.tid === 'charger' && e.ai.s === 'wind') {
      const q = 1 - e.ai.t / 0.7;
      c.strokeStyle = rgba('#ff4d5e', 0.25 + q * 0.4); c.lineWidth = e.r * 1.4;
      c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(e.x + Math.cos(e.ai.ang) * 230, e.y + Math.sin(e.ai.ang) * 230); c.stroke();
    }
    if (e.tid === 'eater' && e.ate) { const q = Math.min(1, e.ate / 40); glow(c, e.x - e.r * 0.15, e.y, e.r * (0.6 + q * 0.6), '#b38bff', 0.5 + q * 0.5); }
    if (e.st.markT > 0) { c.strokeStyle = 'rgba(255,77,94,0.8)'; c.lineWidth = 1; c.beginPath(); c.arc(e.x, e.y, e.r + 6, 0, TAU); c.stroke(); }
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
function ghostSprite() {
  const L = P.look;
  const key = PART_ORDER.map(k => L.parts[k].rank + (L.parts[k].branch || '')).join('') + L.form + (L.od > 0.5 ? 'o' : '');
  if (RENDER.ghostKey !== key) {
    RENDER.ghostKey = key;
    const s = robotSnapshot(L, 0);
    RENDER.ghost = { snap: s, cyan: silhouette(s.cv, '#46e3ff'), mag: silhouette(s.cv, OD_COLOR) };
  }
  return RENDER.ghost;
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
  const hover = L.parts.legs.branch === 'B' && L.parts.legs.rank >= 3;
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(0, 25 * sc, (hover ? 10 : 15) * sc, (hover ? 3.5 : 4.6) * sc, 0, 0, TAU); c.fill();
  if (P.siege) { c.strokeStyle = rgba('#ff8a3d', 0.5 + Math.sin(G.time * 10) * 0.2); c.lineWidth = 1.5; c.beginPath(); c.ellipse(0, 25 * sc, 24 * sc, 7 * sc, 0, 0, TAU); c.stroke(); }
  const blink = P.iframes > 0 && P.hurtFlash > 0 && !P.od.active && (Math.floor(G.rt * 22) % 2 === 0);
  if (blink) c.globalAlpha = 0.45;
  const tf = G.tf.cur;
  if (tf && tf.drawSubject) tf.drawSubject(c, G.time);
  else drawRobot(c, L, G.time, { moving: P.moving, wp: P.wp, face: P.face, fire: P.fire, siege: P.siege, dist: P.dist });
  c.globalAlpha = 1;
  if (P.hurtFlash > 0.5) glow(c, 0, -4, 40 * sc, '#ff2a3a', (P.hurtFlash - 0.5) * 0.8);
  if (P.shield.has && P.shield.ready && !tf) {
    c.save(); c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba('#ff9a4a', 0.35 + Math.sin(G.time * 4) * 0.12); c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, -2, 30 * sc, 0, TAU); c.stroke(); c.restore();
  }
  if (hasBranch('back', 'B') && !tf) {
    const r = (P.parts.back.rank >= 5 ? 72 : 48) * P.stats.area;
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#9dffcf', 0.18); c.lineWidth = 6;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); c.restore();
  }
  // полоска прочности
  if (!tf) {
    const w = 34, q = clamp(P.hp / P.stats.maxHp, 0, 1), y = 31 * sc;
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(-w / 2 - 1, y - 1, w + 2, 5);
    c.fillStyle = q > 0.5 ? '#5dff9b' : q > 0.25 ? '#ffd36b' : '#ff4d5e'; c.fillRect(-w / 2, y, w * q, 3);
  }
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
  for (const a of G.areas) if (a.kind !== 'ring' && a.kind !== 'strike') AK[a.kind].draw(c, a);
  drawWarns(c);
  drawPickups(c);
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
  // экранные слои
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  MENU.subj = { x: 0, y: 0, look: makeLook(r, parts, 0, 0), time: () => MENU.t };
  MENU.tf.clear(); MENU.idle = 1.4; MENU.resetT = 0;
}
function menuUpdate(dt) {
  MENU.t += dt;
  MENU.tf.update(dt);
  FX.update(dt);
  const S = MENU.subj;
  if (!S) return;
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
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(0, 26 * S.look.scale, 16 * S.look.scale, 5 * S.look.scale, 0, 0, TAU); c.fill();
  FX.drawUnder(c);
  const tf = MENU.tf.cur;
  if (tf && tf.drawSubject) tf.drawSubject(c, t);
  else drawRobot(c, S.look, t, { face: 1 });
  FX.drawGlow(c);
  c.restore();
  // выноски
  const ly = robotLayout(S.look), ls = S.look.scale * sc;
  const pts = {
    head: [0, ly.headY], back: [-(ly.tw + 4), ly.tTop - 4], arms: [ly.tw + 4, ly.shY + 10], core: [0, (ly.tTop + ly.tBot) / 2], legs: [5, ly.hipY + 10],
  };
  c.font = '600 11px "JetBrains Mono", monospace'; c.textBaseline = 'middle';
  const side = { head: 1, back: -1, arms: 1, core: -1, legs: 1 };
  const rowY = { head: -0.36, back: -0.18, arms: 0.0, core: 0.14, legs: 0.32 };
  for (const k of PART_ORDER) {
    const p = pts[k], x = Lc.cx + p[0] * ls, y = Lc.cy + p[1] * ls;
    const s = side[k], lx = Lc.cx + s * Lc.size * (Lc.wide ? 0.56 : 0.5), lyy = Lc.cy + rowY[k] * Lc.size;
    const pr = S.look.parts[k];
    c.strokeStyle = 'rgba(70,227,255,0.45)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(lx - s * 30, lyy); c.lineTo(lx, lyy); c.stroke();
    c.fillStyle = '#46e3ff'; c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill();
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
