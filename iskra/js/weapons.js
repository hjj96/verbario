'use strict';
/* ===== Орудия: поведение, снаряды, зоны поражения ===== */

const WB = {};   // логика орудий
const WD = {};   // постоянная отрисовка (дроны, лучи, ауры)

function cdReady(w, dt, spd) { w.t -= dt * spd; return w.t <= 0; }
function updateWeapons(dt) {
  P.gooOn = false; P.novaOn = false; P.zeroBonus = false; P.leechBudget = Math.min((P.leechBudget || 0) + dt * 4, 4);
  const spd = P.od.active ? 2 : 1;
  for (const w of P.weapons) { const b = WB[w.id]; if (b) b(w, dt, spd); }
}
function leech(v) {
  if (P.leechBudget <= 0 || P.hp >= P.stats.maxHp) return;
  const h = Math.min(v, P.leechBudget);
  P.leechBudget -= h; P.hp = Math.min(P.stats.maxHp, P.hp + h);
}
function aimAt(e) { return e ? Math.atan2(e.y - P.y, e.x - P.x) : (P.face > 0 ? 0 : Math.PI); }
function lineEnemies(x, y, ang, len, width, fn) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const ex = e.x - x, ey = e.y - y, t = ex * dx + ey * dy;
    if (t < -e.r || t > len + e.r) continue;
    const px = ex - dx * t, py = ey - dy * t, rr = width / 2 + e.r;
    if (px * px + py * py <= rr * rr) fn(e, t);
  }
}
function icdOk(e, key, cd) {
  const ic = e.icd || (e.icd = {});
  if ((ic[key] || 0) > G.time) return false;
  ic[key] = G.time + cd;
  return true;
}

/* ---------- Импульсный бластер ---------- */
WB.blaster = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.q && st.q.length) {
    st.qt -= dt * spd;
    while (st.q.length && st.qt <= 0) { fireBolt(w, st.q.shift()); st.qt += 0.07; }
    return;
  }
  if (!cdReady(w, dt, spd)) return;
  const tg = nearestK(P.x, P.y, p.amount, 560);
  if (!tg.length) { w.t = 0.15; return; }
  st.q = []; for (let i = 0; i < p.amount; i++) st.q.push(tg[i % tg.length]);
  st.qt = 0; w.t = p.cd;
};
function fireBolt(w, tgt) {
  const p = w.p;
  const ang = (tgt && tgt.alive ? Math.atan2(tgt.y - P.y, tgt.x - P.x) : aimAt(null)) + rand(-0.04, 0.04);
  const sx = P.x + Math.cos(ang) * 14, sy = P.y - 4 + Math.sin(ang) * 14;
  spawnProj('bolt', sx, sy, Math.cos(ang) * p.speed, Math.sin(ang) * p.speed, { dmg: p.dmg, pierce: p.pierce, r: p.size, life: p.life, src: w.id, col: WEAPONS.blaster.color, kb: 40 });
  P.fire = 1;
  AUDIO.sfx('shoot', { f: 920 });
  FX.sparks(sx, sy, 2, '#bff6ff', 120, ang, 0.4, 0.15);
}
WB.annihilator = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tgt = nearestEnemy(P.x, P.y, 640);
  if (!tgt) { w.t = 0.15; return; }
  const base = aimAt(tgt), n = p.amount;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.17;
    spawnProj('orb', P.x + Math.cos(a) * 14, P.y - 4 + Math.sin(a) * 14, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, pierce: 999, r: p.size * Math.sqrt(p.area), life: p.life, src: w.id, col: EVOS.annihilator.color, blast: p.blast * p.area, kb: 60 });
  }
  w.t = p.cd; P.fire = 1; AUDIO.sfx('laser');
};

/* ---------- Плазменный клинок ---------- */
WB.blade = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.q && st.q.length) { st.qt -= dt * spd; if (st.qt <= 0) { swing(w, st.q.shift()); st.qt = 0.12; } return; }
  if (!cdReady(w, dt, spd)) return;
  const range = p.range * p.area, tgt = nearestEnemy(P.x, P.y, range * 1.7);
  if (!tgt) { w.t = 0.12; return; }
  const base = aimAt(tgt), offs = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -3 * Math.PI / 4];
  st.q = []; for (let i = 0; i < p.amount; i++) st.q.push(base + offs[i % offs.length]);
  st.qt = 0; w.t = p.cd;
};
function swing(w, ang) {
  const p = w.p, range = p.range * p.area, half = p.arc / 2;
  FX.slash(P.x, P.y - 4, ang, p.arc, range, 0.24, WEAPONS.blade.color);
  AUDIO.sfx('swing');
  P.fire = 1;
  eachEnemyIn(P.x, P.y, range, e => {
    if (Math.abs(angDiff(ang, Math.atan2(e.y - P.y, e.x - P.x))) <= half + 0.2) hitEnemy(e, p.dmg, { src: w.id, kb: p.kb, burn: p.burn || 0 });
  });
}
WB.bladestorm = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.a = (st.a || 0) + p.rot * dt * spd;
  const R = p.orbit * p.area, sz = p.size * Math.sqrt(p.area);
  for (let i = 0; i < p.amount; i++) {
    const a = st.a + i * TAU / p.amount, bx = P.x + Math.cos(a) * R, by = P.y - 4 + Math.sin(a) * R;
    eachEnemyIn(bx, by, sz, e => { if (icdOk(e, 'bs', p.icd)) { hitEnemy(e, p.dmg, { src: w.id, kb: 90 }); leech(p.leech); } });
  }
  st.wt = (st.wt === undefined ? p.cd : st.wt) - dt * spd;
  if (st.wt <= 0) {
    st.wt = p.cd;
    const RR = R * 1.7;
    FX.slash(P.x, P.y - 4, st.a, TAU * 0.98, RR, 0.35, '#ff9ae6');
    AUDIO.sfx('swing');
    eachEnemyIn(P.x, P.y, RR, e => { hitEnemy(e, p.wave, { src: w.id, kb: 200 }); });
  }
};
WD.bladestorm = (c, w) => {
  const p = w.p, st = w.st, R = p.orbit * p.area, sz = p.size * Math.sqrt(p.area);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < p.amount; i++) {
    const a = (st.a || 0) + i * TAU / p.amount;
    c.strokeStyle = rgba('#ff9ae6', 0.3); c.lineWidth = sz * 0.5;
    c.beginPath(); c.arc(P.x, P.y - 4, R, a - 0.7, a); c.stroke();
    c.save(); c.translate(P.x + Math.cos(a) * R, P.y - 4 + Math.sin(a) * R); c.rotate(a + Math.PI / 2);
    c.fillStyle = rgba('#ffffff', 0.9);
    c.beginPath(); c.moveTo(0, -sz); c.quadraticCurveTo(sz * 0.45, 0, 0, sz); c.quadraticCurveTo(sz * 0.15, 0, 0, -sz); c.fill();
    c.fillStyle = rgba('#ff5fd2', 0.6);
    c.beginPath(); c.moveTo(0, -sz * 1.1); c.quadraticCurveTo(sz * 0.7, 0, 0, sz * 1.1); c.quadraticCurveTo(-sz * 0.2, 0, 0, -sz * 1.1); c.fill();
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
};

/* ---------- Орбитальные дроны ---------- */
WB.drones = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.a = (st.a || 0) + p.rot * dt * spd;
  const R = p.orbit * p.area, n = p.amount;
  for (let i = 0; i < n; i++) {
    const a = st.a + i * TAU / n, x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
    eachEnemyIn(x, y, p.size, e => { if (icdOk(e, 'dr', p.icd)) { hitEnemy(e, p.dmg, { src: w.id, kb: p.kb }); FX.sparks(x, y, 2, WEAPONS.drones.color, 140); } });
  }
};
function drawDrone(c, x, y, a, col, sz) {
  glow(c, x, y, sz * 2.2, col, 0.6);
  c.save(); c.translate(x, y); c.rotate(a);
  c.fillStyle = '#2a313c'; c.beginPath(); c.arc(0, 0, sz * 0.75, 0, TAU); c.fill();
  c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.arc(0, 0, sz * 0.75, 0, TAU); c.stroke();
  c.fillStyle = '#e6eef8'; c.fillRect(-sz * 1.05, -sz * 0.18, sz * 2.1, sz * 0.36);
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, sz * 0.28, 0, TAU); c.fill();
  c.restore();
}
WD.drones = (c, w) => {
  const p = w.p, st = w.st, R = p.orbit * p.area;
  for (let i = 0; i < p.amount; i++) { const a = (st.a || 0) + i * TAU / p.amount; drawDrone(c, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R, a * 3, WEAPONS.drones.color, p.size); }
};
WB.halo = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.a = (st.a || 0) + p.rot * dt * spd;
  st.l = (st.l || 0) - dt * spd;
  const half = Math.ceil(p.amount / 2), R1 = p.orbit * p.area, R2 = p.orbit2 * p.area;
  const fireL = st.l <= 0;
  if (fireL) st.l = p.lcd;
  for (let i = 0; i < p.amount; i++) {
    const inner = i < half, k = inner ? i : i - half, n = inner ? half : p.amount - half;
    const a = (inner ? st.a : -st.a * 0.8) + k * TAU / n, R = inner ? R1 : R2;
    const x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
    eachEnemyIn(x, y, p.size, e => { if (icdOk(e, 'hl', p.icd)) hitEnemy(e, p.dmg, { src: w.id, kb: 70 }); });
    if (fireL) {
      const t = nearestEnemy(x, y, 220);
      if (t) { FX.beam(x, y, t.x, t.y, 1.4, 0.12, '#9dffcf'); hitEnemy(t, p.laser * P.stats.might, { src: w.id }); }
    }
  }
  if (fireL) AUDIO.sfx('laser');
};
WD.halo = (c, w) => {
  const p = w.p, st = w.st, half = Math.ceil(p.amount / 2), R1 = p.orbit * p.area, R2 = p.orbit2 * p.area;
  c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#9dffcf', 0.12); c.lineWidth = 2;
  c.beginPath(); c.arc(P.x, P.y, R1, 0, TAU); c.stroke(); c.beginPath(); c.arc(P.x, P.y, R2, 0, TAU); c.stroke(); c.restore();
  for (let i = 0; i < p.amount; i++) {
    const inner = i < half, k = inner ? i : i - half, n = inner ? half : p.amount - half;
    const a = (inner ? (st.a || 0) : -(st.a || 0) * 0.8) + k * TAU / n, R = inner ? R1 : R2;
    drawDrone(c, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R, a * 3, '#9dffcf', p.size);
  }
};

/* ---------- Дуговой разрядник ---------- */
function chainZap(x, y, first, chains, range, dmg, src, stunChance, col) {
  let cx = x, cy = y, cur = first;
  const hit = new Set();
  for (let i = 0; i <= chains && cur; i++) {
    FX.lightning(cx, cy, cur.x, cur.y, col, 1.5, 0.16);
    FX.sparks(cur.x, cur.y, 3, col, 150);
    hit.add(cur);
    const ex = cur.x, ey = cur.y;
    hitEnemy(cur, dmg, { src, stun: 0.4, stunChance, kb: 15 });
    cx = ex; cy = ey;
    let nx = null, bd = range * range;
    eachEnemyIn(cx, cy, range, n => { if (!hit.has(n) && targetable(n)) { const d = d2(cx, cy, n.x, n.y); if (d < bd) { bd = d; nx = n; } } });
    cur = nx;
  }
}
WB.arc = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, firsts = nearestK(P.x, P.y, p.amount, p.reach);
  if (!firsts.length) { w.t = 0.15; return; }
  for (const f of firsts) chainZap(P.x, P.y - 8, f, p.chains, p.range, p.dmg, w.id, p.stun, WEAPONS.arc.color);
  w.t = p.cd; P.fire = 1; AUDIO.sfx('zap');
};
WB.stormdome = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.big = (st.big === undefined ? p.bigCd : st.big) - dt * spd;
  if (st.big <= 0) {
    const tg = densestPoint(0, 8);
    if (tg) {
      st.big = p.bigCd;
      const x = tg.x, y = tg.y, R = 64 * p.area;
      FX.lightning(x + rand(-30, 30), y - 420, x, y, '#ffffff', 4, 0.3, 26);
      FX.lightning(x + rand(-30, 30), y - 420, x, y, '#e2d4ff', 2.5, 0.25, 30);
      FX.explosion(x, y, R, '#c9a6ff', true); FX.addShake(5);
      AUDIO.sfx('boom', { big: true });
      eachEnemyIn(x, y, R, e => { hitEnemy(e, p.big * P.stats.might, { src: w.id, stun: 0.6, kb: 160 }); });
    } else st.big = 0.3;
  }
  if (!cdReady(w, dt, spd)) return;
  const t = randomOnScreen();
  if (!t) { w.t = 0.2; return; }
  FX.lightning(t.x + rand(-40, 40), t.y - 360, t.x, t.y, '#e2d4ff', 2, 0.18, 22);
  chainZap(t.x, t.y, t, p.chains, p.range, p.dmg, w.id, p.stun, '#e2d4ff');
  w.t = p.cd; AUDIO.sfx('zap');
};

/* ---------- Ракеты ---------- */
WB.missiles = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tg = nearestK(P.x, P.y, 8, 520);
  if (!tg.length) { w.t = 0.2; return; }
  for (let i = 0; i < p.amount; i++) {
    const a = -Math.PI / 2 + rand(-1.3, 1.3);
    spawnProj('missile', P.x + rand(-6, 6), P.y - 16, Math.cos(a) * 150, Math.sin(a) * 150,
      { dmg: p.dmg, pierce: 1, r: 5, life: p.life, src: w.id, target: tg[i % tg.length], speed: p.speed, turn: p.turn, blast: p.blast * p.area, col: '#ff9a3d' });
  }
  w.t = p.cd; AUDIO.sfx('missile');
};
WB.carpet = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, list = [];
  for (const e of G.enemies) if (targetable(e) && onScreen(e, 20)) list.push(e);
  if (!list.length) { w.t = 0.2; return; }
  shuffle(list);
  for (let i = 0; i < p.amount; i++) {
    const a = -Math.PI / 2 + rand(-1.5, 1.5);
    spawnProj('missile', P.x + rand(-8, 8), P.y - 16, Math.cos(a) * 180, Math.sin(a) * 180,
      { dmg: p.dmg, pierce: 1, r: 5, life: p.life, src: w.id, target: list[i % list.length], speed: p.speed, turn: p.turn, blast: p.blast * p.area, col: '#ffb35c', fire: p.fire, delay: i * 0.03 });
  }
  w.t = p.cd; AUDIO.sfx('missile');
};

/* ---------- Огнемёт ---------- */
function emitFlame(w, ang, dmg, burn, cone, range, area) {
  const a = ang + rand(-cone / 2, cone / 2), s = 300 * range * rand(0.85, 1.15);
  spawnProj('flame', P.x + Math.cos(ang) * 12, P.y - 4 + Math.sin(ang) * 12, Math.cos(a) * s, Math.sin(a) * s,
    { dmg, pierce: 999, r: 6 * area, grow: 28 * area, life: 0.42 * range, src: w.id, burn });
}
WB.flamer = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.on > 0) {
    st.on -= dt;
    st.acc = (st.acc || 0) + p.rate * dt * spd;
    st.aimT = (st.aimT || 0) - dt;
    if (st.aimT <= 0) { st.aimT = 0.15; const t = nearestEnemy(P.x, P.y, 300); st.ang = aimAt(t); }
    while (st.acc >= 1) { st.acc -= 1; for (let k = 0; k < p.amount; k++) emitFlame(w, st.ang + (k ? Math.PI : 0), p.dmg, p.burn, p.cone, p.range, p.area); }
    P.fire = 0.6;
    AUDIO.sfx('flame');
    return;
  }
  if (!cdReady(w, dt, spd)) return;
  if (!nearestEnemy(P.x, P.y, 280)) { w.t = 0.2; return; }
  st.on = p.dur; st.aimT = 0; w.t = p.cd;
};
WB.supernova = (w, dt, spd) => {
  const p = w.p, st = w.st;
  P.novaOn = true;
  st.a = (st.a || 0) + p.spin * dt * spd;
  st.acc = (st.acc || 0) + p.rate * dt * spd;
  while (st.acc >= 1) {
    st.acc -= 1;
    st.k = ((st.k || 0) + 1) % p.amount;
    emitFlame(w, st.a + st.k * TAU / p.amount, p.dmg, p.burn, p.cone, p.range, p.area);
  }
  AUDIO.sfx('flame');
};

/* ---------- Мины ---------- */
WB.mines = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.n = st.n || 0;
  if (!cdReady(w, dt, spd)) return;
  if (st.n >= p.max) { w.t = 0.25; return; }
  for (let i = 0; i < p.amount && st.n < p.max; i++) {
    spawnArea('mine', P.x + rand(-12, 12) - P.vx * 0.06, P.y + 12 + rand(-6, 6), { r: p.trig, life: p.life, dmg: p.dmg, blast: p.blast * p.area, arm: p.arm, src: w.id, stun: p.stun, w, col: WEAPONS.mines.color });
    st.n++;
  }
  AUDIO.sfx('mine'); w.t = p.cd;
};
WB.cluster = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.n = st.n || 0;
  if (!cdReady(w, dt, spd)) return;
  w.t = P.moving > 0.3 ? p.cd : p.cd * 2.5;
  if (st.n >= p.max) return;
  spawnArea('mine', P.x + rand(-14, 14), P.y + 12 + rand(-8, 8), { r: p.trig, life: p.life, dmg: p.dmg, blast: p.blast * p.area, arm: p.arm, src: w.id, stun: p.stun, w, col: EVOS.cluster.color, bomblets: p.bomblets });
  st.n++;
  AUDIO.sfx('mine');
};

/* ---------- Гравитон ---------- */
WB.gravity = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p;
  let any = false;
  for (let i = 0; i < p.amount; i++) {
    const tgt = densestPoint(400, 8) || nearestEnemy(P.x, P.y, 400);
    if (!tgt) break;
    any = true;
    spawnProj('grav', P.x, P.y - 10, 0, 0, { noHit: true, sx: P.x, sy: P.y - 10, tx: tgt.x + rand(-24, 24), ty: tgt.y + rand(-24, 24), life: 0.42, src: w.id,
      well: { r: p.radius * p.area, life: p.dur, dmg: p.dmg, tick: p.tick, pull: p.pull, collapse: (p.collapse || 0) * P.stats.might } });
  }
  w.t = any ? p.cd : 0.3;
};
WB.horizon = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (!st.h) st.h = { x: P.x + 80, y: P.y, t: 0, retarget: 0, tx: P.x, ty: P.y, grow: 0 };
  const h = st.h;
  h.t += dt * spd; h.retarget -= dt;
  if (h.retarget <= 0) {
    h.retarget = 0.8;
    const d = densestPoint(330, 8);
    if (d) { h.tx = d.x; h.ty = d.y; } else { h.tx = P.x + Math.cos(G.time) * 90; h.ty = P.y + Math.sin(G.time) * 90; }
  }
  const dx = h.tx - h.x, dy = h.ty - h.y, dd = Math.hypot(dx, dy);
  if (dd > 1) { const s = Math.min(dd, 150 * dt); h.x += dx / dd * s; h.y += dy / dd * s; }
  if (d2(h.x, h.y, P.x, P.y) > 420 * 420) { h.x = lerp(h.x, P.x, 0.1); h.y = lerp(h.y, P.y, 0.1); }
  h.grow = Math.min(1, h.grow + dt * 1.5);
  const R = p.radius * p.area * h.grow;
  st.tick = (st.tick || 0) - dt * spd;
  const doTick = st.tick <= 0;
  if (doTick) st.tick = p.tick;
  eachEnemyIn(h.x, h.y, R, e => {
    const ex = h.x - e.x, ey = h.y - e.y, d = Math.hypot(ex, ey) || 1;
    if (!e.boss) { const pull = p.pull * (1 - d / (R + e.r)) * dt; e.x += ex / d * Math.min(pull, d); e.y += ey / d * Math.min(pull, d); }
    if (doTick) {
      if (!e.boss && !e.elite && e.hp < e.maxHp * p.exec && d < R * 0.6) { FX.burst(e.x, e.y, 4, '#c08bff', 80, 0.3, 4); killEnemy(e, { src: w.id }); G.dmgBy[w.id] = (G.dmgBy[w.id] || 0) + e.hp; }
      else hitEnemy(e, p.dmg, { src: w.id, nocrit: false });
    }
  });
  if (Math.random() < 0.5) { const a = rand(0, TAU), r = R * rand(0.7, 1.1); FX.dot(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, -Math.cos(a) * r * 2 - Math.sin(a) * 90, -Math.sin(a) * r * 2 + Math.cos(a) * 90, 0.4, 3.5, '#c08bff', 0.5); }
  if (h.t >= p.cycle) {
    h.t = 0; h.grow = 0.15;
    const BR = R * 1.3;
    FX.explosion(h.x, h.y, BR, '#c08bff', true); FX.ring(h.x, h.y, 10, BR * 1.4, 0.5, '#ffffff', 5); FX.addShake(7);
    AUDIO.sfx('boom', { big: true });
    eachEnemyIn(h.x, h.y, BR, e => { hitEnemy(e, p.burst * P.stats.might, { src: w.id, kb: 300 }); });
  }
};
WD.horizon = (c, w) => { const h = w.st.h; if (h) drawHole(c, h.x, h.y, w.p.radius * w.p.area * h.grow, G.time, '#c08bff', 1); };
function drawHole(c, x, y, R, t, col, a) {
  if (!(R >= 2) || !isFinite(x) || !isFinite(y)) return;
  c.save();
  const g = c.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.35, 'rgba(10,3,20,0.85)'); g.addColorStop(0.75, rgba(col, 0.18 * a)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = rgba(i % 2 ? '#ffffff' : col, (0.5 - i * 0.08) * a); c.lineWidth = 2 - i * 0.3;
    c.beginPath(); c.arc(x, y, R * (0.3 + i * 0.16), t * (3 - i * 0.5) + i, t * (3 - i * 0.5) + i + 2.4); c.stroke();
  }
  c.strokeStyle = rgba(col, 0.7 * a); c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, R * 0.22, 0, TAU); c.stroke();
  c.restore();
}

/* ---------- Криолуч ---------- */
function cryoUpdate(w, dt, spd, isZero) {
  const p = w.p, st = w.st;
  if (isZero) P.zeroBonus = true;
  if (!st.beams) st.beams = [];
  if (st.on > 0) {
    st.on -= dt;
    while (st.beams.length < p.amount) st.beams.push({ tgt: null, ang: aimAt(null) });
    st.beams.length = p.amount;
    const used = new Set();
    for (const b of st.beams) {
      if (!b.tgt || !b.tgt.alive || d2(P.x, P.y, b.tgt.x, b.tgt.y) > p.range * p.range || used.has(b.tgt)) b.tgt = nearestEnemy(P.x, P.y, p.range, used);
      if (b.tgt) { used.add(b.tgt); const ta = aimAt(b.tgt); b.ang += angDiff(b.ang, ta) * Math.min(1, dt * 14); }
    }
    st.tick = (st.tick || 0) - dt * spd;
    if (st.tick <= 0) {
      st.tick = 0.1;
      for (const b of st.beams) {
        if (!b.tgt) continue;
        lineEnemies(P.x, P.y - 4, b.ang, p.range, p.width, e => { hitEnemy(e, p.dmg, { src: w.id, chill: p.slow, frost: p.frost, freeze: p.freeze, nocrit: true }); });
        if (Math.random() < 0.6) FX.sparks(P.x + Math.cos(b.ang) * p.range * rand(0.2, 1), P.y - 4 + Math.sin(b.ang) * p.range * rand(0.2, 1), 1, '#d8f7ff', 80);
      }
      AUDIO.sfx('beam');
    }
    P.fire = 0.5;
    return;
  }
  st.beams.length = 0;
  if (!cdReady(w, dt, spd)) return;
  if (!nearestEnemy(P.x, P.y, p.range)) { w.t = 0.2; return; }
  st.on = p.dur; st.tick = 0; w.t = p.cd + p.dur * 0.5;
}
WB.cryo = (w, dt, spd) => cryoUpdate(w, dt, spd, false);
WB.zero = (w, dt, spd) => cryoUpdate(w, dt, spd, true);
function drawCryo(c, w) {
  const st = w.st, p = w.p;
  if (!(st.on > 0) || !st.beams) return;
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (const b of st.beams) {
    if (!b.tgt) continue;
    const x1 = P.x + Math.cos(b.ang) * 12, y1 = P.y - 4 + Math.sin(b.ang) * 12;
    const x2 = P.x + Math.cos(b.ang) * p.range, y2 = P.y - 4 + Math.sin(b.ang) * p.range;
    const g = c.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, rgba('#8fe8ff', 0.85)); g.addColorStop(0.8, rgba('#8fe8ff', 0.5)); g.addColorStop(1, rgba('#8fe8ff', 0));
    c.strokeStyle = g; c.lineWidth = p.width * (1.1 + Math.sin(G.time * 40) * 0.15);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = rgba('#ffffff', 0.9); c.lineWidth = p.width * 0.3; c.stroke();
    glow(c, x1, y1, 14, '#8fe8ff', 0.8);
  }
  c.restore();
}
WD.cryo = drawCryo; WD.zero = drawCryo;

/* ---------- Рельсотрон ---------- */
function railShot(w, ang, dmg, width, length, kb, stun) {
  const x = P.x + Math.cos(ang) * 12, y = P.y - 4 + Math.sin(ang) * 12;
  lineEnemies(x, y, ang, length, width, e => { hitEnemy(e, dmg, { src: w.id, kb, kx: Math.cos(ang), ky: Math.sin(ang), stun: stun || 0 }); FX.sparks(e.x, e.y, 3, '#eaf6ff', 220, ang, 0.6, 0.25); });
  FX.beam(x, y, x + Math.cos(ang) * length, y + Math.sin(ang) * length, width, 0.32, '#9fd8ff');
  FX.dot(x, y, 0, 0, 0.2, 26, '#ffffff', 0);
  FX.addShake(3);
  P.fire = 1;
  AUDIO.sfx('rail');
}
WB.rail = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.charge > 0) {
    st.charge -= dt * spd;
    if (st.charge <= 0) for (const a of st.angs) railShot(w, a, p.dmg, p.width, p.length, p.kb, p.stun);
    return;
  }
  if (!cdReady(w, dt, spd)) return;
  const tg = nearestK(P.x, P.y, p.amount, 700);
  if (!tg.length) { w.t = 0.2; return; }
  st.angs = tg.map(aimAt);
  while (st.angs.length < p.amount) st.angs.push(st.angs[0] + Math.PI * (st.angs.length % 2 ? 1 : 0.5));
  st.charge = 0.22; w.t = p.cd;
  AUDIO.sfx('charge');
};
WD.rail = (c, w) => {
  const st = w.st;
  if (!(st.charge > 0) || !st.angs) return;
  c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#eaf6ff', 0.45 + Math.sin(G.time * 60) * 0.2); c.lineWidth = 1;
  for (const a of st.angs) { c.beginPath(); c.moveTo(P.x, P.y - 4); c.lineTo(P.x + Math.cos(a) * 900, P.y - 4 + Math.sin(a) * 900); c.stroke(); }
  glow(c, P.x, P.y - 4, 16, '#eaf6ff', 0.6);
  c.restore();
};
WB.lance = (w, dt, spd) => {
  const p = w.p;
  if (!cdReady(w, dt, spd)) return;
  const t = nearestEnemy(P.x, P.y, 800);
  if (!t) { w.t = 0.2; return; }
  railShot(w, aimAt(t), p.rail * P.stats.might, p.width, p.length, 120, 0.4);
  const used = new Set();
  for (let i = 0; i < p.amount; i++) {
    const d = densestPoint(0, 6) || randomOnScreen();
    if (!d || used.has(d)) continue;
    used.add(d);
    spawnArea('strike', d.x + rand(-16, 16), d.y + rand(-16, 16), { r: p.radius * p.area, life: 0.9, delay: 0.6, dmg: p.dmg, src: w.id });
  }
  w.t = p.cd;
};

/* ---------- Пила-диск ---------- */
WB.saw = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tg = nearestK(P.x, P.y, p.amount, 420);
  if (!tg.length) { w.t = 0.2; return; }
  for (let i = 0; i < p.amount; i++) {
    const t = tg[i % tg.length], a = aimAt(t);
    spawnProj('saw', P.x, P.y - 4, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, pierce: 999, r: p.size * p.area, life: 5, src: w.id, target: t, bounces: p.bounces, speed: p.speed, corrode: p.corrode || 0, kb: 50, rot: 0 });
  }
  w.t = p.cd; AUDIO.sfx('saw');
};
WB.sawmill = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p;
  for (let i = 0; i < p.amount; i++) {
    const a = i * TAU / p.amount + rand(-0.3, 0.3);
    spawnProj('bigsaw', P.x, P.y - 4, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, r: p.size * p.area, life: p.dur, src: w.id, icd: p.icd, icdKey: 'sm', kb: 60, rot: 0, pierce: 1 });
  }
  w.t = p.cd; AUDIO.sfx('saw');
};

/* ---------- Нанорой ---------- */
function auraUpdate(w, dt, spd, isGoo) {
  const p = w.p, st = w.st, R = p.radius * p.area;
  if (isGoo) { P.gooOn = true; P.gooR = R; }
  st.tick = (st.tick || 0) - dt * spd;
  if (st.tick > 0) return;
  st.tick = p.tick;
  eachEnemyIn(P.x, P.y, R, e => { hitEnemy(e, p.dmg, { src: w.id, corrode: p.corrode, nocrit: true }); if (p.leech) leech(p.leech); });
}
WB.nanites = (w, dt, spd) => auraUpdate(w, dt, spd, false);
WB.goo = (w, dt, spd) => auraUpdate(w, dt, spd, true);
function drawAuraCloud(c, w, col, n) {
  const R = w.p.radius * w.p.area, t = G.time;
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(P.x, P.y, R * 0.2, P.x, P.y, R);
  g.addColorStop(0, rgba(col, 0.02)); g.addColorStop(0.8, rgba(col, 0.09)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(P.x, P.y, R, 0, TAU); c.fill();
  c.fillStyle = rgba(col, 0.75);
  for (let i = 0; i < n; i++) {
    const a = t * (0.6 + (i % 5) * 0.15) * (i % 2 ? 1 : -1) + i * 2.399;
    const rr = R * (0.25 + ((i * 0.618) % 1) * 0.75) + Math.sin(t * 3 + i) * 4;
    const s = 1 + (i % 3) * 0.5;
    c.fillRect(P.x + Math.cos(a) * rr - s / 2, P.y + Math.sin(a) * rr - s / 2, s, s);
  }
  c.restore();
}
WD.nanites = (c, w) => drawAuraCloud(c, w, '#8dff6a', 46);
WD.goo = (c, w) => drawAuraCloud(c, w, '#c9ffb8', 90);

/* ---------- Ударная волна ---------- */
WB.shock = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.q > 0) { st.qt -= dt * spd; if (st.qt <= 0) { st.q--; st.qt = 0.22; emitShockRing(w.id, p.radius * p.area, p.dmg, p.kb, p.stun, WEAPONS.shock.color); } }
  if (!cdReady(w, dt, spd)) return;
  if (!nearestEnemy(P.x, P.y, p.radius * p.area * 1.3)) { w.t = 0.2; return; }
  st.q = p.amount; st.qt = 0; w.t = p.cd;
};
function emitShockRing(src, R, dmg, kb, stun, col) {
  spawnArea('ring', P.x, P.y, { r: 0, maxR: R, life: 0.36, dmg, kb, stun: stun || 0, src, hits: new Set(), col });
  AUDIO.sfx('thump');
  P.fire = 1;
}
WB.seismic = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.q > 0) { st.qt -= dt * spd; if (st.qt <= 0) { st.q--; st.qt = 0.2; emitShockRing(w.id, p.radius * p.area, p.dmg, p.kb, p.stun, EVOS.seismic.color); } }
  if (!cdReady(w, dt, spd)) return;
  if (!nearestEnemy(P.x, P.y, p.radius * p.area * 1.2)) { w.t = 0.2; return; }
  st.q = p.amount; st.qt = 0; w.t = p.cd;
  const off = rand(0, TAU), L = p.radius * p.area * 1.1;
  for (let i = 0; i < p.fissures; i++) {
    const a = off + i * TAU / p.fissures;
    const pts = [P.x, P.y + 8];
    let x = P.x, y = P.y + 8;
    for (let k = 1; k <= 6; k++) { x = P.x + Math.cos(a) * L * k / 6 + rand(-8, 8); y = P.y + 8 + Math.sin(a) * L * k / 6 + rand(-8, 8); pts.push(x, y); }
    FX.arcs.push({ pts, life: 0.7, max: 0.7, col: '#ff8a3d', w: 3 });
    lineEnemies(P.x, P.y + 8, a, L, 22, e => { hitEnemy(e, p.fdmg * P.stats.might, { src: w.id, stun: 0.5 }); });
  }
  FX.addShake(6);
  AUDIO.sfx('boom', { big: true });
};

/* ===== Снаряды ===== */
function spawnProj(kind, x, y, vx, vy, o) {
  const p = { kind, x, y, vx, vy, r: 4, dmg: 0, pierce: 1, life: 1, src: 'other', hits: null, dead: false, t: 0 };
  if (o) for (const k in o) p[k] = o[k];
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.vx) || !isFinite(p.vy)) return p;
  if (p.pierce > 1 && !p.icd) p.hits = new Set();
  p.max = p.life;
  G.projs.push(p);
  return p;
}
function missileBoom(p) {
  if (p.boomed) return;
  p.boomed = true;
  FX.explosion(p.x, p.y, p.blast * 0.8, p.col || '#ff9a3d');
  AUDIO.sfx('boom');
  eachEnemyIn(p.x, p.y, p.blast, e => { hitEnemy(e, p.dmg, { src: p.src, kb: 120, kx: undefined }); });
  if (p.fire) spawnArea('fire', p.x, p.y, { r: p.blast * 0.7, life: 1.6, dmg: p.fire * P.stats.might, tick: 0.25, burn: 4 * P.stats.burn, src: p.src });
}
const PK = {
  bolt: {
    draw(c, p) {
      const a = Math.atan2(p.vy, p.vx), L = p.r * 3.2;
      c.strokeStyle = rgba(p.col, 0.9); c.lineWidth = p.r * 1.6;
      c.beginPath(); c.moveTo(p.x - Math.cos(a) * L, p.y - Math.sin(a) * L); c.lineTo(p.x, p.y); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = p.r * 0.6; c.stroke();
    },
  },
  orb: {
    hit(p, e) {
      hitEnemy(e, p.dmg, p);
      p.nb = (p.nb || 0) + 1;
      if (p.nb % 2 === 1) {
        FX.dot(e.x, e.y, 0, 0, 0.15, p.blast * 1.2, p.col, 0);
        eachEnemyIn(e.x, e.y, p.blast, n => { if (n !== e) hitEnemy(n, p.dmg * 0.5, { src: p.src, nocrit: true }); });
      }
    },
    draw(c, p) {
      c.drawImage(dotSprite(p.col), p.x - p.r * 2.6, p.y - p.r * 2.6, p.r * 5.2, p.r * 5.2);
      const a = Math.atan2(p.vy, p.vx);
      c.strokeStyle = rgba(p.col, 0.35); c.lineWidth = p.r * 1.4;
      c.beginPath(); c.moveTo(p.x - Math.cos(a) * p.r * 4, p.y - Math.sin(a) * p.r * 4); c.lineTo(p.x, p.y); c.stroke();
    },
  },
  missile: {
    update(p, dt) {
      if (p.delay > 0) { p.delay -= dt; return; }
      if (!p.target || !p.target.alive) p.target = nearestEnemy(p.x, p.y, 420);
      const sp = Math.hypot(p.vx, p.vy);
      let a = Math.atan2(p.vy, p.vx);
      if (p.target) a += clamp(angDiff(a, Math.atan2(p.target.y - p.y, p.target.x - p.x)), -p.turn * dt, p.turn * dt);
      const ns = Math.min(p.speed, sp + 520 * dt);
      p.vx = Math.cos(a) * ns; p.vy = Math.sin(a) * ns;
      p.trail = (p.trail || 0) - dt;
      if (p.trail <= 0) { p.trail = 0.035; FX.add({ k: 3, x: p.x, y: p.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 2.5, col: 'rgba(180,180,190,0.6)', drag: 1, grow: 9 }); FX.dot(p.x, p.y, 0, 0, 0.1, 5, '#ffb35c', 0); }
    },
    hit(p, e) { missileBoom(p); },
    expire(p) { missileBoom(p); },
    draw(c, p) {
      const a = Math.atan2(p.vy, p.vx);
      c.save(); c.translate(p.x, p.y); c.rotate(a);
      c.fillStyle = '#dfe6ee'; c.fillRect(-6, -2, 9, 4);
      c.fillStyle = p.col; c.beginPath(); c.moveTo(3, -2); c.lineTo(7, 0); c.lineTo(3, 2); c.fill();
      c.restore();
      c.drawImage(dotSprite('#ffb35c'), p.x - Math.cos(a) * 7 - 5, p.y - Math.sin(a) * 7 - 5, 10, 10);
    },
  },
  flame: {
    update(p, dt) { p.r += (p.grow || 0) * dt; },
    draw(c, p) {
      const q = p.life / p.max, s = p.r * 2.1;
      c.globalAlpha = Math.min(1, q * 1.6);
      c.drawImage(dotSprite(q > 0.55 ? '#ffcf5a' : q > 0.25 ? '#ff7a2e' : '#c2361b'), p.x - s, p.y - s, s * 2, s * 2);
      c.globalAlpha = 1;
    },
  },
  saw: {
    update(p, dt) {
      p.rot += dt * 22;
      if (p.returning) {
        const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy) || 1;
        p.vx = dx / d * p.speed * 1.3; p.vy = dy / d * p.speed * 1.3;
        if (d < 18) p.dead = true;
        return;
      }
      if (!p.target || !p.target.alive) { p.target = nearestEnemy(p.x, p.y, 260, p.hits); if (!p.target) { p.returning = true; return; } }
      const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.vx = dx / d * p.speed; p.vy = dy / d * p.speed;
    },
    hit(p, e) {
      hitEnemy(e, p.dmg, p);
      AUDIO.sfx('saw');
      FX.sparks(e.x, e.y, 4, '#ffcf8a', 220);
      if (e === p.target) {
        p.bounces--;
        if (p.bounces < 0) { p.returning = true; return; }
        p.hits.add(e);
        p.target = nearestEnemy(p.x, p.y, 260, p.hits);
        if (!p.target) p.returning = true;
      }
    },
    draw(c, p) { drawSaw(c, p.x, p.y, p.r, p.rot, '#ffcf8a'); },
  },
  bigsaw: {
    update(p, dt) {
      p.rot += dt * 16;
      const hw = VIEW.hw - p.r, hh = VIEW.hh - p.r;
      if (p.x < G.cam.x - hw && p.vx < 0) p.vx = -p.vx;
      if (p.x > G.cam.x + hw && p.vx > 0) p.vx = -p.vx;
      if (p.y < G.cam.y - hh && p.vy < 0) p.vy = -p.vy;
      if (p.y > G.cam.y + hh && p.vy > 0) p.vy = -p.vy;
      if (Math.random() < 0.3) FX.sparks(p.x, p.y, 1, '#ffdcaa', 160);
    },
    draw(c, p) { drawSaw(c, p.x, p.y, p.r, p.rot, '#ffdcaa'); },
  },
  shard: {
    draw(c, p) {
      const a = Math.atan2(p.vy, p.vx);
      c.save(); c.translate(p.x, p.y); c.rotate(a);
      c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -2.5); c.lineTo(-4, 2.5); c.fill();
      c.restore();
      c.drawImage(dotSprite('#8fe8ff'), p.x - 6, p.y - 6, 12, 12);
    },
  },
  feather: {
    update(p, dt) {
      if (p.delay > 0) { p.delay -= dt; p.vx *= Math.exp(-4 * dt); p.vy *= Math.exp(-4 * dt); return; }
      if (!p.target || !p.target.alive) p.target = nearestEnemy(p.x, p.y, 500);
      let a = Math.atan2(p.vy, p.vx);
      if (p.target) a += clamp(angDiff(a, Math.atan2(p.target.y - p.y, p.target.x - p.x)), -p.homing * dt, p.homing * dt);
      const s = Math.min(p.speed, Math.hypot(p.vx, p.vy) + 900 * dt);
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
    },
    draw(c, p) {
      const a = Math.atan2(p.vy, p.vx), col = P.look ? P.look.pal.a : '#ff4f9a';
      c.save(); c.translate(p.x, p.y); c.rotate(a);
      c.fillStyle = rgba(col, 0.9); c.beginPath(); c.moveTo(8, 0); c.quadraticCurveTo(0, -3.5, -8, -1); c.lineTo(-8, 1); c.quadraticCurveTo(0, 3.5, 8, 0); c.fill();
      c.fillStyle = '#ffffff'; c.fillRect(-5, -0.5, 11, 1);
      c.restore();
    },
  },
  bomblet: {
    update(p, dt) { p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt); },
    hit(p, e) { p.life = 0; },
    expire(p) { FX.explosion(p.x, p.y, p.blast * 0.7, '#fff08a'); AUDIO.sfx('boom'); eachEnemyIn(p.x, p.y, p.blast, e => { hitEnemy(e, p.dmg, { src: p.src, kb: 80, nocrit: true }); }); },
    draw(c, p) { c.drawImage(dotSprite('#fff08a'), p.x - 5, p.y - 5, 10, 10); },
  },
  grav: {
    update(p, dt) {
      const q = 1 - p.life / p.max;
      p.x = lerp(p.sx, p.tx, q); p.y = lerp(p.sy, p.ty, q) - Math.sin(q * Math.PI) * 40;
    },
    expire(p) {
      const W = p.well;
      spawnArea('well', p.tx, p.ty, { r: W.r, life: W.life, dmg: W.dmg, tick: W.tick, pull: W.pull, collapse: W.collapse, src: p.src });
      FX.ring(p.tx, p.ty, 4, W.r, 0.4, '#a77bff', 3);
    },
    draw(c, p) { c.drawImage(dotSprite('#a77bff'), p.x - 8, p.y - 8, 16, 16); c.fillStyle = '#000'; c.beginPath(); c.arc(p.x, p.y, 3, 0, TAU); c.fill(); },
  },
};
function drawSaw(c, x, y, r, rot, col) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.beginPath();
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16, rr = i % 2 ? r * 0.72 : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  c.closePath(); c.fillStyle = rgba(col, 0.95); c.fill();
  c.fillStyle = '#3a3f48'; c.beginPath(); c.arc(0, 0, r * 0.4, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, r * 0.14, 0, TAU); c.fill();
  c.restore();
}

function updateProjectiles(dt) {
  const arr = G.projs;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    const K = PK[p.kind];
    p.t += dt;
    if (K.update) K.update(p, dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    if (p.dead) { removeAt(arr, i); continue; }
    if (p.life <= 0) { if (K.expire) K.expire(p); removeAt(arr, i); continue; }
    if (!p.noHit && !(p.delay > 0)) {
      eachEnemyIn(p.x, p.y, p.r, e => {
        if (p.dead) return true;
        if (p.hits && p.hits.has(e)) return;
        if (p.icd && !icdOk(e, p.icdKey, p.icd)) return;
        if (K.hit) K.hit(p, e); else hitEnemy(e, p.dmg, p);
        if (p.icd) return;
        if (p.hits) p.hits.add(e);
        if (--p.pierce <= 0) { p.dead = true; if (K.expire && p.kind !== 'missile') K.expire(p); return true; }
      });
    }
    if (p.dead) removeAt(arr, i);
  }
}

/* ===== Зоны ===== */
function spawnArea(kind, x, y, o) {
  const a = { kind, x, y, r: 20, life: 1, dmg: 0, tick: 0.3, tickT: 0, src: 'other', t: 0 };
  if (o) for (const k in o) a[k] = o[k];
  if (!(a.life > 0) || !isFinite(a.x) || !isFinite(a.y) || !isFinite(a.r)) return a;
  a.max = a.life;
  G.areas.push(a);
  return a;
}
const AK = {
  fire: {
    update(a, dt) {
      a.tickT -= dt;
      if (a.tickT <= 0) { a.tickT = a.tick; eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, burn: a.burn || 0, nocrit: true }); }); }
      if (Math.random() < 0.25) FX.dot(a.x + rand(-a.r, a.r) * 0.7, a.y + rand(-a.r, a.r) * 0.5, 0, -40, 0.4, rand(4, 7), '#ff7a2e', 1);
    },
    draw(c, a) {
      const q = Math.min(1, a.life / a.max * 3);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.5 * q * (0.8 + Math.sin(G.time * 20 + a.x) * 0.2);
      c.drawImage(dotSprite('#ff5a1f'), a.x - a.r * 1.3, a.y - a.r * 0.9, a.r * 2.6, a.r * 1.8);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    },
  },
  acid: {
    update(a, dt) {
      a.tickT -= dt;
      if (a.tickT <= 0) { a.tickT = 0.5; if (d2(a.x, a.y, P.x, P.y) < (a.r + P.r * 0.5) ** 2) hurtPlayer(a.dmg, null); }
    },
    draw(c, a) {
      const q = Math.min(1, a.life / a.max * 4), g = Math.min(1, a.t * 5);
      c.globalAlpha = 0.75 * q;
      c.fillStyle = rgba('#7fbf1a', 0.55);
      c.beginPath(); c.ellipse(a.x, a.y, a.r * g, a.r * 0.62 * g, 0, 0, TAU); c.fill();
      c.strokeStyle = rgba('#c6ff3d', 0.7); c.lineWidth = 1.5; c.stroke();
      for (let i = 0; i < 3; i++) { const bx = a.x + Math.sin(G.time * 2 + i * 2.1) * a.r * 0.5, by = a.y + Math.cos(G.time * 1.7 + i) * a.r * 0.25; c.beginPath(); c.arc(bx, by, 1.5 + ((G.time * 2 + i) % 1) * 2, 0, TAU); c.strokeStyle = rgba('#e6ff9a', 0.6); c.stroke(); }
      c.globalAlpha = 1;
    },
  },
  well: {
    update(a, dt) {
      const R = a.r * Math.min(1, a.t * 4);
      a.tickT -= dt;
      const doTick = a.tickT <= 0;
      if (doTick) a.tickT = a.tick;
      eachEnemyIn(a.x, a.y, R, e => {
        const dx = a.x - e.x, dy = a.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (!e.boss) { const pull = Math.min(d, a.pull * dt * (0.4 + 0.6 * (1 - d / (R + e.r)))); e.x += dx / d * pull; e.y += dy / d * pull; }
        if (doTick) hitEnemy(e, a.dmg, { src: a.src, nocrit: true });
      });
      if (Math.random() < 0.6) { const an = rand(0, TAU), rr = R * rand(0.6, 1); FX.dot(a.x + Math.cos(an) * rr, a.y + Math.sin(an) * rr, -Math.cos(an) * rr * 2.5 - Math.sin(an) * 70, -Math.sin(an) * rr * 2.5 + Math.cos(an) * 70, 0.35, 3, '#a77bff', 0.3); }
    },
    end(a) {
      if (!a.collapse) return;
      FX.explosion(a.x, a.y, a.r * 0.8, '#a77bff', true); AUDIO.sfx('boom');
      eachEnemyIn(a.x, a.y, a.r * 0.9, e => { hitEnemy(e, a.collapse, { src: a.src, kb: 250 }); });
    },
    draw(c, a) { const q = Math.min(1, a.life / 0.25); drawHole(c, a.x, a.y, a.r * Math.min(1, a.t * 4) * q, G.time + a.x, '#a77bff', q); },
  },
  cloud: {
    update(a, dt) {
      a.tickT -= dt;
      if (a.tickT <= 0) { a.tickT = a.tick; eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, corrode: 0.2, nocrit: true }); }); }
    },
    draw(c, a) {
      const q = Math.min(1, a.life / a.max * 2);
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.35 * q;
      c.drawImage(dotSprite('#8dff6a'), a.x - a.r, a.y - a.r, a.r * 2, a.r * 2);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    },
  },
  mine: {
    update(a, dt) {
      if (a.t < a.arm) return;
      let trig = false;
      eachEnemyIn(a.x, a.y, a.r, e => { if (!e.T.prop) { trig = true; return true; } });
      if (trig) { a.life = 0; a.boom = true; }
    },
    end(a) {
      if (a.w) a.w.st.n = Math.max(0, (a.w.st.n || 1) - 1);
      if (!a.boom) return;
      FX.explosion(a.x, a.y, a.blast * 0.75, a.col);
      AUDIO.sfx('boom');
      eachEnemyIn(a.x, a.y, a.blast, e => { hitEnemy(e, a.dmg, { src: a.src, kb: 160, stun: a.stun || 0 }); });
      if (a.bomblets) for (let i = 0; i < a.bomblets; i++) {
        const an = i * TAU / a.bomblets + rand(-0.3, 0.3), s = rand(160, 240);
        spawnProj('bomblet', a.x, a.y, Math.cos(an) * s, Math.sin(an) * s, { dmg: a.dmg * 0.5, r: 5, life: 0.45, src: a.src, blast: 32 * P.stats.area, pierce: 1 });
      }
    },
    draw(c, a) {
      const armed = a.t >= a.arm, blink = armed && Math.sin(G.time * 12 + a.x) > 0;
      c.fillStyle = '#2b313b'; c.beginPath(); c.arc(a.x, a.y, 5.5, 0, TAU); c.fill();
      c.strokeStyle = a.col; c.lineWidth = 1.2; c.stroke();
      c.fillStyle = blink ? '#ff4d5e' : a.col; c.beginPath(); c.arc(a.x, a.y, 1.8, 0, TAU); c.fill();
      if (blink) glow(c, a.x, a.y, 9, '#ff4d5e', 0.8);
    },
  },
  ring: {
    update(a, dt) {
      const q = ease.outCubic(1 - a.life / a.max), R = a.maxR * q;
      a.r = R;
      eachEnemyIn(a.x, a.y, R, e => {
        if (a.hits.has(e)) return;
        const d = Math.sqrt(d2(a.x, a.y, e.x, e.y));
        if (d < R - 18 - e.r) return;
        a.hits.add(e);
        hitEnemy(e, a.dmg, { src: a.src, kb: a.kb, stun: a.stun });
      });
    },
    draw(c, a) {
      const q = 1 - a.life / a.max;
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = rgba(a.col, 0.9 * (1 - q)); c.lineWidth = 8 * (1 - q) + 2;
      c.beginPath(); c.arc(a.x, a.y, Math.max(1, a.r), 0, TAU); c.stroke();
      c.strokeStyle = rgba('#ffffff', 0.7 * (1 - q)); c.lineWidth = 2; c.stroke();
      c.globalCompositeOperation = 'source-over';
    },
  },
  strike: {
    update(a, dt) {
      if (!a.hit && a.t >= a.delay) {
        a.hit = true;
        FX.beam(a.x, a.y - 600, a.x, a.y, a.r * 0.5, 0.35, '#ffffff');
        FX.explosion(a.x, a.y, a.r, '#eaf6ff', true); FX.addShake(5);
        AUDIO.sfx('rail');
        eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, kb: 220, stun: 0.5 }); });
        spawnArea('fire', a.x, a.y, { r: a.r * 0.6, life: 1.5, dmg: 6 * P.stats.might, tick: 0.25, burn: 4, src: a.src });
      }
    },
    draw(c, a) {
      if (a.hit) return;
      const q = a.t / a.delay;
      c.strokeStyle = rgba('#eaf6ff', 0.8); c.lineWidth = 1.5;
      c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.stroke();
      c.fillStyle = rgba('#9fd8ff', 0.18); c.beginPath(); c.arc(a.x, a.y, a.r * q, 0, TAU); c.fill();
      c.strokeStyle = rgba('#eaf6ff', 0.5); c.beginPath(); c.moveTo(a.x - a.r * 1.2, a.y); c.lineTo(a.x + a.r * 1.2, a.y); c.moveTo(a.x, a.y - a.r * 1.2); c.lineTo(a.x, a.y + a.r * 1.2); c.stroke();
    },
  },
};
function updateAreas(dt) {
  const arr = G.areas;
  for (let i = arr.length - 1; i >= 0; i--) {
    const a = arr[i], K = AK[a.kind];
    a.t += dt; a.life -= dt;
    if (K.update) K.update(a, dt);
    if (a.life <= 0) { if (K.end) K.end(a); removeAt(arr, i); }
  }
}
