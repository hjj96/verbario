'use strict';
/* ===== Орудия: поведение, снаряды, зоны поражения ===== */

const WB = {};   // логика орудий
const WD = {};   // постоянная отрисовка (дроны, лучи, ауры) — под корпусом
const WF = {};   // второй проход поверх корпуса: то, что ближе к камере (наниты на передней дуге орбит)
const WG = {};   // проход по полу — под врагами (поля, воронки)

function cdReady(w, dt, spd) { w.t -= dt * spd; return w.t <= 0; }
function updateWeapons(dt) {
  refreshLinks();
  P.gooOn = false; P.novaOn = false; P.zeroBonus = false; P.leechBudget = Math.min((P.leechBudget || 0) + dt * 4, 4);
  const spd = P.od.active ? 2 : 1;
  for (const w of P.weapons) {
    const b = WB[w.id]; if (b) b(w, dt, spd);
    const A = w.anim || (w.anim = { fire: 0, swing: 0, out: 0 });
    A.fire = Math.max(0, A.fire - dt * 7); A.swing = Math.max(0, A.swing - dt * 3.2);
    A.out = (w.st.outN || 0) > 0 || w.id === 'bladestorm' ? 1 : 0;
  }
}
// отдача корпуса по типу орудия: рельса бьёт сильнее всего
const KICK = { rail: 1, missiles: 0.45, gravity: 0.5, shock: 0.35, saw: 0.3, mines: 0.25, cryo: 0.2, arc: 0.18, blaster: 0.12, flamer: 0.04, glaive: 0.22, magnet: 0.45 };
function fired(w, k) {
  const q = k === undefined ? 1 : k;
  if (w.anim) w.anim.fire = Math.max(w.anim.fire, q);
  if (P) P.kick = Math.max(P.kick || 0, (KICK[baseOf(w)] || 0) * q);
}
function leech(v) {
  if (P.leechBudget <= 0 || P.hp >= P.stats.maxHp) return;
  const h = Math.min(v, P.leechBudget);
  P.leechBudget -= h; P.hp = Math.min(P.stats.maxHp, P.hp + h);
}
function aimAt(e) { return e ? Math.atan2(e.y - P.y, e.x - P.x) : P.aim; }
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
  const m = muzzleWorld(w), sx = m.x, sy = m.y;
  const ang = (tgt && tgt.alive ? Math.atan2(tgt.y - sy, tgt.x - sx) : aimAt(null)) + rand(-0.04, 0.04);
  fired(w);
  spawnProj('bolt', sx, sy, Math.cos(ang) * p.speed, Math.sin(ang) * p.speed, { dmg: p.dmg, pierce: p.pierce, r: p.size, life: p.life, src: w.id, col: WEAPONS.blaster.color, kb: 40 });
  droneVolley(tgt, p.dmg);
  P.fire = 1;
  AUDIO.sfx('shoot', { f: 920 });
  FX.mflash(sx, sy, ang, 4.2, WEAPONS.blaster.color);
}
WB.annihilator = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tgt = nearestEnemy(P.x, P.y, 640);
  if (!tgt) { w.t = 0.15; return; }
  const m = muzzleWorld(w), base = Math.atan2(tgt.y - m.y, tgt.x - m.x), n = p.amount;
  fired(w);
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.17;
    spawnProj('orb', m.x, m.y, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, pierce: 999, r: p.size * Math.sqrt(p.area), life: p.life, src: w.id, col: EVOS.annihilator.color, blast: p.blast * p.area, kb: 60 });
  }
  droneVolley(tgt, p.dmg * 0.6);
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
  P.fire = 1; if (w.anim) { w.anim.swing = 1; w.anim.fire = 0.6; }
  eachEnemyIn(P.x, P.y, range, e => {
    if (Math.abs(angDiff(ang, Math.atan2(e.y - P.y, e.x - P.x))) <= half + 0.2) hitEnemy(e, p.dmg, { src: w.id, kb: p.kb, burn: p.burn || 0 });
  });
  twinGlaive(p.dmg, ang);
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
    if (linkK('twin')) for (let i = 0; i < 3; i++) twinGlaive(p.wave, st.a + i * TAU / 3);
  }
};
// вихрь клинков: каждый клинок — чёткий серп-лезвие (контур + полупрозрачное тело), за ним по орбите тянутся
// три тонкие дуги-следа разной длины
WD.bladestorm = (c, w) => {
  const p = w.p, st = w.st, R = p.orbit * p.area, sz = p.size * Math.sqrt(p.area), cs = sheathCol('#ff9ae6');
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let i = 0; i < p.amount; i++) {
    const a = (st.a || 0) + i * TAU / p.amount;
    c.strokeStyle = cs; c.lineWidth = 1;
    for (let k = 0; k < 3; k++) { c.globalAlpha = 0.55 - k * 0.15; const rr = R + (k - 1) * sz * 0.35; c.beginPath(); c.arc(P.x, P.y - 4, rr, a - 0.9 + k * 0.2, a - 0.08); c.stroke(); }
    c.globalAlpha = 1;
    c.save(); c.translate(P.x + Math.cos(a) * R, P.y - 4 + Math.sin(a) * R); c.rotate(a + Math.PI / 2);
    c.beginPath(); c.moveTo(0, -sz * 1.1); c.quadraticCurveTo(sz * 0.75, 0, 0, sz * 1.1); c.quadraticCurveTo(sz * 0.18, 0, 0, -sz * 1.1); c.closePath();
    c.fillStyle = rgba(cs, 0.35); c.fill();
    c.strokeStyle = '#ffd6f4'; c.lineWidth = 1.3; c.stroke();
    c.beginPath(); c.moveTo(0, -sz * 1.1); c.quadraticCurveTo(sz * 0.75, 0, 0, sz * 1.1); c.strokeStyle = '#ffffff'; c.lineWidth = 1.6; c.stroke();
    c.restore();
  }
  c.restore();
};

/* ---------- Орбитальные дроны ---------- */
WB.drones = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.a = (st.a || 0) + p.rot * dt * spd;
  const R = p.orbit * p.area, n = p.amount;
  for (let i = 0; i < n; i++) {
    const a = st.a + i * TAU / n, x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
    eachEnemyIn(x, y, p.size, e => { if (icdOk(e, 'dr', p.icd)) { hitEnemy(e, p.dmg, { src: w.id, kb: p.kb }); const hy = bodyY(e); FX.hexRing(e.x, hy, 2, 8, 0.15, WEAPONS.drones.color, 1.1); FX.sparks(e.x, hy, 3, '#ffffff', 150, Math.atan2(e.y - P.y, e.x - P.x), 0.8, 0.18); } });
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
// дроны на орбите: позиция, радиус и направление облёта (+1 — по часовой на экране)
function droneList(w) {
  const p = w.p, st = w.st, out = [];
  if (w.id === 'halo') {
    const half = Math.ceil(p.amount / 2), R1 = p.orbit * p.area, R2 = p.orbit2 * p.area;
    for (let i = 0; i < p.amount; i++) {
      const inner = i < half, k = inner ? i : i - half, n = inner ? half : p.amount - half;
      out.push({ a: (inner ? (st.a || 0) : -(st.a || 0) * 0.8) + k * TAU / n, R: inner ? R1 : R2, dir: inner ? 1 : -1, ph: i * 1.3 });
    }
  } else for (let i = 0; i < p.amount; i++) out.push({ a: (st.a || 0) + i * TAU / p.amount, R: p.orbit * p.area, dir: 1, ph: i * 1.7 });
  return out;
}
// задняя половина орбиты рисуется до корпуса, передняя — после: дроны честно облетают робота
function drawDrones(c, w, front) {
  const halo = w.id === 'halo', col = halo ? '#9dffcf' : WEAPONS.drones.color;
  for (const d of droneList(w)) {
    if ((Math.sin(d.a) > 0) !== front) continue;
    drawDroneOrbit(c, P.x, P.y, d.a, d.R, d.dir, col, w.p.size, halo, d.ph);
  }
}
WD.drones = (c, w) => drawDrones(c, w, false);
WF.drones = (c, w) => drawDrones(c, w, true);
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
      if (t) { const ey = y - droneEmit(p.size) * vfxCp(), ty = bodyY(t); FX.beam(x, ey, t.x, ty, 1, 0.12, '#9dffcf'); FX.hexRing(t.x, ty, 1.5, 6, 0.14, '#9dffcf', 1); hitEnemy(t, p.laser * P.stats.might, { src: w.id }); }
    }
  }
  if (fireL) AUDIO.sfx('laser');
};
WD.halo = (c, w) => drawDrones(c, w, false);
WF.halo = (c, w) => drawDrones(c, w, true);

/* ---------- Дуговой разрядник ---------- */
// точка попадания — середина корпуса врага, а не пол под ним
const bodyY = e => e.y - (e.r || 10) * 0.5 * vfxCp();
function zapMark(x, y, col) { FX.hexRing(x, y, 2, 9, 0.16, col, 1.1); FX.sparks(x, y, 3, '#ffffff', 170, undefined, 0, 0.16); }
// цепной разряд: каждый перескок появляется на 22 мс позже предыдущего; o — вид первого отрезка (небесный удар купола)
function chainZap(x, y, first, chains, range, dmg, src, stunChance, col, o) {
  let cx = x, cy = y, cur = first, dl = 0;
  const hit = new Set();
  for (let i = 0; i <= chains && cur; i++) {
    const ty = bodyY(cur), mx = cur.x, fx = cur.x, fy = cur.y;
    if (i === 0 && o) FX.lightning(cx, cy, mx, ty, o.col || col, o.w, o.life, o.jag, { fk: o.fk });
    else FX.lightning(cx, cy, mx, ty, col, 1.3, 0.17, 8, { d: dl, fk: i === 0 || Math.random() < 0.4 ? 1 : 0 });
    FX.later(dl, () => zapMark(mx, ty, col));
    dl += 0.022;
    hit.add(cur);
    hitEnemy(cur, dmg, { src, stun: 0.4, stunChance, kb: 15 });
    cx = mx; cy = ty;
    let nx = null, bd = range * range;
    eachEnemyIn(fx, fy, range, n => { if (!hit.has(n) && targetable(n)) { const q = d2(fx, fy, n.x, n.y); if (q < bd) { bd = q; nx = n; } } });
    cur = nx;
  }
}
WB.arc = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, firsts = nearestK(P.x, P.y, p.amount, p.reach);
  if (!firsts.length) { w.t = 0.15; return; }
  const m = muzzleWorld(w);
  FX.hexRing(m.x, m.y, 1, 7, 0.14, '#ffffff', 1);
  for (const f of firsts) chainZap(m.x, m.y, f, p.chains, p.range, p.dmg, w.id, p.stun, WEAPONS.arc.color);
  w.t = p.cd; P.fire = 1; fired(w); AUDIO.sfx('zap');
};
WB.stormdome = (w, dt, spd) => {
  const p = w.p, st = w.st;
  st.big = (st.big === undefined ? p.bigCd : st.big) - dt * spd;
  if (st.big <= 0) {
    const tg = densestPoint(0, 8);
    if (tg) {
      st.big = p.bigCd;
      const x = tg.x, y = tg.y, R = 64 * p.area, sx = x + rand(-30, 30);
      FX.lightning(sx, y - 420, x, y, '#ffffff', 1.8, 0.3, 24, { fk: 3 });
      FX.lightning(sx, y - 420, x, y, '#c9a6ff', 1.1, 0.26, 34, { fk: 2 });
      crispBurst(x, y, R, '#c9a6ff'); FX.addShake(5);
      AUDIO.sfx('boom', { big: true });
      eachEnemyIn(x, y, R, e => { hitEnemy(e, p.big * P.stats.might, { src: w.id, stun: 0.6, kb: 160 }); });
    } else st.big = 0.3;
  }
  if (!cdReady(w, dt, spd)) return;
  const t = randomOnScreen();
  if (!t) { w.t = 0.2; return; }
  chainZap(t.x + rand(-40, 40), t.y - 360, t, p.chains, p.range, p.dmg, w.id, p.stun, '#e2d4ff', { w: 1.7, life: 0.2, jag: 22, fk: 2 });
  FX.ering(t.x, t.y, 3, 18, 0.22, '#e2d4ff', 1.2, true);
  FX.light(t.x, t.y, 70, '#c9a6ff', 0.35);
  w.t = p.cd; fired(w, 0.7); AUDIO.sfx('zap');
};

/* ---------- Ракеты ---------- */
WB.missiles = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tg = nearestK(P.x, P.y, 8, 520);
  if (!tg.length) { w.t = 0.2; return; }
  const m = muzzleWorld(w);
  const W = linkK('focus') ? wellNear(P.x, P.y, 600) : null, ft = W ? nearestEnemy(W.x, W.y, W.r + 30) : null;
  if (ft) tg.unshift(ft, ft, ft);
  fired(w);
  for (let i = 0; i < p.amount; i++) {
    const a = P.aim + rand(-1.1, 1.1);
    spawnProj('missile', m.x + rand(-3, 3), m.y + rand(-3, 3), Math.cos(a) * 150, Math.sin(a) * 150,
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
  const W = linkK('focus') ? wellNear(P.x, P.y, 600) : null, ft = W ? nearestEnemy(W.x, W.y, W.r + 30) : null;
  if (ft) for (let i = 0; i < list.length; i += 2) list[i] = ft;
  const m = muzzleWorld(w);
  fired(w);
  for (let i = 0; i < p.amount; i++) {
    const a = P.aim + rand(-1.6, 1.6);
    spawnProj('missile', m.x + rand(-4, 4), m.y + rand(-4, 4), Math.cos(a) * 180, Math.sin(a) * 180,
      { dmg: p.dmg, pierce: 1, r: 5, life: p.life, src: w.id, target: list[i % list.length], speed: p.speed, turn: p.turn, blast: p.blast * p.area, col: '#ffb35c', fire: p.fire, delay: i * 0.03 });
  }
  w.t = p.cd; AUDIO.sfx('missile');
};

/* ---------- Огнемёт ---------- */
function emitFlame(w, ang, dmg, burn, cone, range, area, ox, oy) {
  const a = ang + rand(-cone / 2, cone / 2), s = 300 * range * rand(0.85, 1.15);
  const sx = ox !== undefined ? ox : P.x + Math.cos(ang) * 12, sy = oy !== undefined ? oy : P.y - 4 + Math.sin(ang) * 12;
  spawnProj('flame', sx, sy, Math.cos(a) * s, Math.sin(a) * s,
    { dmg, pierce: 999, r: 6 * area, grow: 28 * area, life: 0.42 * range, src: w.id, burn });
}
WB.flamer = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.on > 0) {
    st.on -= dt;
    st.acc = (st.acc || 0) + p.rate * dt * spd;
    st.aimT = (st.aimT || 0) - dt;
    if (st.aimT <= 0) { st.aimT = 0.15; const t = nearestEnemy(P.x, P.y, 300); st.ang = aimAt(t); }
    const m = muzzleWorld(w);
    while (st.acc >= 1) { st.acc -= 1; for (let k = 0; k < p.amount; k++) { if (k) emitFlame(w, st.ang + Math.PI, p.dmg, p.burn, p.cone, p.range, p.area); else emitFlame(w, st.ang, p.dmg, p.burn, p.cone, p.range, p.area, m.x, m.y); } }
    P.fire = 0.6; fired(w, 0.55);
    if (Math.random() < 0.3) FX.light(m.x + Math.cos(st.ang) * 30, m.y + Math.sin(st.ang) * 30, 70, '#ff7a2e', 0.25);
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
  fired(w, 0.7); AUDIO.sfx('mine'); w.t = p.cd;
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
    const m = muzzleWorld(w); fired(w);
    spawnProj('grav', m.x, m.y, 0, 0, { noHit: true, sx: m.x, sy: m.y, tx: tgt.x + rand(-24, 24), ty: tgt.y + rand(-24, 24), life: 0.42, src: w.id,
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
  if (Math.random() < 0.6) { const a = rand(0, TAU), r = R * rand(0.75, 1.1); FX.sparks(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, 1, '#d8c2ff', r * 2.4, a + Math.PI + 0.9, 0.1, 0.34); }
  if (h.t >= p.cycle) {
    h.t = 0; h.grow = 0.15;
    const BR = R * 1.3;
    gravBurst(h.x, h.y, BR, '#c08bff'); FX.addShake(7);
    AUDIO.sfx('boom', { big: true });
    eachEnemyIn(h.x, h.y, BR, e => { hitEnemy(e, p.burst * P.stats.might, { src: w.id, kb: 300 }); });
  }
};
WG.horizon = (c, w) => { const h = w.st.h; if (h) drawHole3D(c, h.x, h.y, w.p.radius * w.p.area * h.grow, G.time, '#c08bff', 1); };

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
    const m = muzzleWorld(w); st.mx = m.x; st.my = m.y;
    fired(w, 0.35);
    if (st.tick <= 0) {
      st.tick = 0.1;
      for (const b of st.beams) {
        if (!b.tgt) continue;
        lineEnemies(m.x, m.y, b.ang, p.range, p.width, e => { hitEnemy(e, p.dmg, { src: w.id, chill: p.slow, frost: p.frost, freeze: p.freeze, nocrit: true }); });
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
// криолуч: тонкое белое ядро в голубой оболочке, гаснет к концу; по лучу бегут поперечные импульсы инея и кувыркаются
// ледяные кристаллы; у излучателя — вращающаяся снежинка, на цели — ледяной шестигранник. Включается и гаснет плавно
function drawCryo(c, w) {
  const st = w.st, p = w.p;
  if (!(st.on > 0) || !st.beams) return;
  const ox = st.mx !== undefined ? st.mx : P.x, oy = st.my !== undefined ? st.my : P.y, t = G.time;
  const on = ease.outCubic(clamp((p.dur - st.on) / 0.14, 0, 1)), k = on * clamp(st.on / 0.18, 0, 1), sh = sheathCol('#8fe8ff');
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (const b of st.beams) {
    if (!b.tgt) continue;
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang), L = p.range * on, x2 = ox + ca * L, y2 = oy + sa * L;
    const g = c.createLinearGradient(ox, oy, x2, y2);
    g.addColorStop(0, rgba(sh, 0.95)); g.addColorStop(0.55, rgba(sh, 0.7)); g.addColorStop(1, rgba(sh, 0));
    const gc = c.createLinearGradient(ox, oy, x2, y2);
    gc.addColorStop(0, 'rgba(240,253,255,1)'); gc.addColorStop(0.7, 'rgba(240,253,255,0.75)'); gc.addColorStop(1, 'rgba(240,253,255,0)');
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(x2, y2);
    c.strokeStyle = g; c.lineWidth = Math.max(2.2, p.width * 0.24) * k * (1 + Math.sin(t * 38 + b.ang) * 0.08); c.stroke();
    c.strokeStyle = gc; c.lineWidth = 1.1 * k; c.stroke();
    // границы поля заморозки: две тонкие параллельные линии по ширине луча
    const hw0 = p.width * 0.5 * k, L2 = L * 0.75;
    c.globalAlpha = 0.28; c.strokeStyle = g; c.lineWidth = 0.8; c.beginPath();
    c.moveTo(ox - sa * hw0, oy + ca * hw0); c.lineTo(ox - sa * hw0 + ca * L2, oy + ca * hw0 + sa * L2);
    c.moveTo(ox + sa * hw0, oy - ca * hw0); c.lineTo(ox + sa * hw0 + ca * L2, oy - ca * hw0 + sa * L2);
    c.stroke(); c.globalAlpha = 1;
    // импульсы инея: короткие поперечные штрихи бегут от излучателя
    c.strokeStyle = '#d8f7ff'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const u = (t * 1.5 + i / 6) % 1, d = u * L, hw = (6 - u * 3) * k, px = ox + ca * d, py = oy + sa * d;
      c.globalAlpha = (1 - u) * 0.75; c.beginPath(); c.moveTo(px - sa * hw, py + ca * hw); c.lineTo(px + sa * hw, py - ca * hw); c.stroke();
    }
    c.globalAlpha = 1;
    // ледяной шестигранник на цели
    if (b.tgt.alive && on >= 1) {
      const tx = b.tgt.x, ty = bodyY(b.tgt), r = 7 + Math.sin(t * 9) * 0.8;
      c.strokeStyle = rgba('#d8f7ff', 0.85 * k); c.lineWidth = 1.1; c.beginPath();
      for (let j = 0; j <= 6; j++) { const a = t * 2 + j * TAU / 6, px = tx + Math.cos(a) * r, py = ty + Math.sin(a) * r; j ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke();
    }
  }
  // снежинка у излучателя: шесть лучей с развилками
  c.strokeStyle = rgba('#e8fbff', 0.9 * k); c.lineWidth = 1;
  c.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = t * 3 + j * TAU / 6, ca = Math.cos(a), sa = Math.sin(a), R = 6.5 * k, mx = ox + ca * R * 0.6, my = oy + sa * R * 0.6;
    c.moveTo(ox, oy); c.lineTo(ox + ca * R, oy + sa * R);
    c.moveTo(mx, my); c.lineTo(mx + Math.cos(a + 0.7) * R * 0.35, my + Math.sin(a + 0.7) * R * 0.35);
    c.moveTo(mx, my); c.lineTo(mx + Math.cos(a - 0.7) * R * 0.35, my + Math.sin(a - 0.7) * R * 0.35);
  }
  c.stroke();
  c.restore();
  // ледяные кристаллы летят вдоль луча и кувыркаются
  const S = vfxSprites('shard', 16, (m, f) => { m.push(); m.t(0, 0, 3); m.rz(-f / 16 * TAU); m.poly(OCTA.v.map(v => [v[0] * 6, v[1] * 1.7, v[2] * 1.7]), OCTA.f, f % 2 ? 'l' : 'a'); m.pop(); }, vpal('#8fe8ff'));
  for (const b of st.beams) {
    if (!b.tgt) continue;
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    for (let j = 0; j < 3; j++) {
      const u = (t * 1.1 + j / 3) % 1, d = u * p.range * on, x = ox + ca * d - sa * Math.sin(u * 9 + j) * 4, y = oy + sa * d + ca * Math.sin(u * 9 + j) * 4;
      vfxDraw(c, S, Math.floor(t * 18 + j * 5), x, y, 0.75, (1 - u * 0.8) * k);
    }
  }
}
WD.cryo = drawCryo; WD.zero = drawCryo;

/* ---------- Рельсотрон ---------- */
function railShot(w, ang, dmg, width, length, kb, stun) {
  const m = muzzleWorld(w), x = m.x, y = m.y;
  fired(w);
  FX.light(x, y, 70, '#9fd8ff', 0.28);
  const ik = linkK('icebreak');
  lineEnemies(x, y, ang, length, width, e => {
    const frozen = e.st.freezeT > 0, cold = frozen || e.st.chillT > 0;
    hitEnemy(e, dmg, ik ? { src: w.id, kb, kx: Math.cos(ang), ky: Math.sin(ang), stun: stun || 0, chill: 0.3, frost: 30, freeze: 1.2 } : { src: w.id, kb, kx: Math.cos(ang), ky: Math.sin(ang), stun: stun || 0 });
    FX.sparks(e.x, e.y, 3, ik ? '#bff6ff' : '#eaf6ff', 220, ang, 0.6, 0.25);
    if (ik && cold) {
      hitEnemy(e, dmg * (frozen ? 3 : 1.5) * ik, { src: 'link_icebreak', nocrit: true });
      if (frozen) {
        FX.shards(e.x, e.y, 12, '#dff8ff', 260); AUDIO.sfx('clank');
        eachEnemyIn(e.x, e.y, 64 * P.stats.area, n => { if (n !== e) hitEnemy(n, dmg * 0.4 * ik, { src: 'link_icebreak', nocrit: true, chill: 0.3, frost: 30 }); });
      }
    }
  });
  FX.rail(x, y, x + Math.cos(ang) * length, y + Math.sin(ang) * length, width, 0.3, '#9fd8ff');
  FX.dot(x, y, 0, 0, 0.1, 6, '#ffffff', 0);
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
  let tg = nearestK(P.x, P.y, p.amount, 700);
  if (!tg.length) { w.t = 0.2; return; }
  // Ледокол: рельса ищет замороженных и охлаждённых
  if (linkK('icebreak')) { const cold = []; for (const e of G.enemies) if (targetable(e) && (e.st.freezeT > 0 || e.st.chillT > 0) && d2(e.x, e.y, P.x, P.y) < 700 * 700) cold.push(e); cold.sort((a, b) => (b.st.freezeT > 0) - (a.st.freezeT > 0)); if (cold.length) tg = cold.slice(0, p.amount).concat(tg).slice(0, p.amount); }
  st.angs = tg.map(aimAt);
  while (st.angs.length < p.amount) st.angs.push(st.angs[0] + Math.PI * (st.angs.length % 2 ? 1 : 0.5));
  st.charge = 0.22; w.t = p.cd;
  AUDIO.sfx('charge');
};
// зарядка рельсы: две пунктирные направляющие сходятся к линии выстрела, у излучателя смыкаются три дуги-конденсатора
WF.rail = (c, w) => {
  const st = w.st, p = w.p;
  if (!(st.charge > 0) || !st.angs) return;
  const m = muzzleWorld(w), u = ease.outCubic(clamp(1 - st.charge / 0.22, 0, 1));
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  c.setLineDash([10, 8]); c.lineDashOffset = -G.time * 300;
  c.strokeStyle = rgba('#9fd8ff', 0.25 + 0.5 * u); c.lineWidth = 1;
  for (const a of st.angs) {
    const ca = Math.cos(a), sa = Math.sin(a), hw = p.width * 1.4 * (1 - u) + 1, L = 900;
    c.beginPath();
    c.moveTo(m.x - sa * hw, m.y + ca * hw); c.lineTo(m.x - sa * hw + ca * L, m.y + ca * hw + sa * L);
    c.moveTo(m.x + sa * hw, m.y - ca * hw); c.lineTo(m.x + sa * hw + ca * L, m.y - ca * hw + sa * L);
    c.stroke();
  }
  c.setLineDash([]);
  c.strokeStyle = rgba('#ffffff', 0.55 + 0.45 * u); c.lineWidth = 1.2;
  const r = 10 - 6 * u;
  for (let i = 0; i < 3; i++) { const a0 = G.time * 14 + i * TAU / 3; c.beginPath(); c.arc(m.x, m.y, r, a0, a0 + 1.3); c.stroke(); }
  c.restore();
};
WB.lance = (w, dt, spd) => {
  const p = w.p;
  if (!cdReady(w, dt, spd)) return;
  const t = nearestEnemy(P.x, P.y, 800);
  if (!t) { w.t = 0.2; return; }
  railShot(w, aimAt(t), p.rail * P.stats.might, p.width, p.length, 120, 0.4);
  // удары ложатся розеткой вокруг самого плотного скопления, а не друг на друга; с небольшим разбросом по времени
  const d0 = densestPoint(0, 6) || randomOnScreen(), R = p.radius * p.area, a0 = rand(0, TAU);
  if (d0) for (let i = 0; i < p.amount; i++) {
    const an = a0 + i * TAU / Math.max(1, p.amount - 1), off = i === 0 ? 0 : R * 1.15;
    spawnArea('strike', d0.x + Math.cos(an) * off + rand(-8, 8), d0.y + Math.sin(an) * off + rand(-8, 8), { r: R, life: 0.9 + i * 0.08, delay: 0.6 + i * 0.08, dmg: p.dmg, src: w.id });
  }
  w.t = p.cd;
};

/* ---------- Пила-диск ---------- */
WB.saw = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tg = nearestK(P.x, P.y, p.amount, 420);
  if (!tg.length) { w.t = 0.2; return; }
  const m = muzzleWorld(w);
  for (let i = 0; i < p.amount; i++) {
    const t = tg[i % tg.length], a = Math.atan2(t.y - m.y, t.x - m.x);
    spawnProj('saw', m.x, m.y, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, pierce: 999, r: p.size * p.area, life: 5, src: w.id, target: t, bounces: p.bounces, speed: p.speed, corrode: p.corrode || 0, kb: 50, rot: 0, w });
    w.st.outN = (w.st.outN || 0) + 1;
  }
  fired(w, 0.8);
  w.t = p.cd; AUDIO.sfx('saw');
};
WB.sawmill = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p;
  for (let i = 0; i < p.amount; i++) {
    const a = i * TAU / p.amount + rand(-0.3, 0.3);
    const m = muzzleWorld(w);
    spawnProj('bigsaw', m.x, m.y, Math.cos(a) * p.speed, Math.sin(a) * p.speed,
      { dmg: p.dmg, r: p.size * p.area, life: p.dur, src: w.id, icd: p.icd, icdKey: 'sm', kb: 60, rot: 0, pierce: 1, w });
    w.st.outN = (w.st.outN || 0) + 1;
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
  // укус: нанит бросается к машине, на ней вспыхивает шестиугольник коррозии
  const col = isGoo ? EVOS.goo.color : WEAPONS.nanites.color, cy = P.y - 14 * vfxCp();
  let darts = 0;
  eachEnemyIn(P.x, P.y, R, e => {
    hitEnemy(e, p.dmg, { src: w.id, corrode: p.corrode, nocrit: true }); if (p.leech) leech(p.leech);
    if (darts < (isGoo ? 5 : 3) && Math.random() < 0.5) {
      darts++; const a = Math.atan2(e.y - P.y, e.x - P.x) + rand(-0.6, 0.6);
      FX.beam(P.x + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.22, e.x, e.y - 3, 1, 0.12, col); FX.hexRing(e.x, e.y - 3, 1.5, 7, 0.2, col, 1);
    }
  });
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
WD.nanites = (c, w) => nanoSwarm(c, P.x, P.y, w.p.radius * w.p.area, WEAPONS.nanites.color, 30, G.time, false, 14, 3);
WF.nanites = (c, w) => nanoSwarm(c, P.x, P.y, w.p.radius * w.p.area, WEAPONS.nanites.color, 30, G.time, true, 14, 3);
WD.goo = (c, w) => nanoSwarm(c, P.x, P.y, w.p.radius * w.p.area, EVOS.goo.color, 46, G.time, false, 14, 4);
WF.goo = (c, w) => nanoSwarm(c, P.x, P.y, w.p.radius * w.p.area, EVOS.goo.color, 46, G.time, true, 14, 4);

/* ---------- Ударная волна ---------- */
WB.shock = (w, dt, spd) => {
  const p = w.p, st = w.st;
  if (st.q > 0) { st.qt -= dt * spd; if (st.qt <= 0) { st.q--; st.qt = 0.22; emitShockRing(w.id, p.radius * p.area, p.dmg, p.kb, p.stun, WEAPONS.shock.color); } }
  if (!cdReady(w, dt, spd)) return;
  if (!nearestEnemy(P.x, P.y, p.radius * p.area * 1.3)) { w.t = 0.2; return; }
  st.q = p.amount; st.qt = 0; w.t = p.cd;
};
function emitShockRing(src, R, dmg, kb, stun, col) {
  spawnArea('ring', P.x, P.y, { r: 0, maxR: R, life: 0.36, dmg, kb, stun: stun || 0, src, hits: new Set(), col, rot: rand(0, TAU) });
  AUDIO.sfx('thump');
  P.fire = 1; P.squash = 1;
  for (const w of P.weapons) if (baseOf(w) === 'shock') fired(w);
  FX.light(P.x, P.y, R * 0.8, col, 0.25);
  FX.hexRing(P.x, P.y, 3, 18, 0.2, '#ffffff', 1.3);
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
    FX.crack(P.x + Math.cos(a) * 8, P.y + 4 + Math.sin(a) * 8, P.x + Math.cos(a) * L, P.y + 4 + Math.sin(a) * L, '#ff8a3d', 1.1);
    lineEnemies(P.x, P.y + 8, a, L, 22, e => { hitEnemy(e, p.fdmg * P.stats.might, { src: w.id, stun: 0.5 }); });
  }
  FX.addShake(6);
  AUDIO.sfx('boom', { big: true });
};

/* ===== Снаряды ===== */
/* ---------- Световая глефа: двухклинковые световые мечи летят бумерангом ---------- */
// путь: уходит дугой в одну сторону, возвращается по другой — к текущему положению корпуса
function glaivePos(p) {
  const u = clamp(p.u, 0, 1), R = p.range, ca = Math.cos(p.ang), sa = Math.sin(p.ang);
  const f = Math.sin(Math.PI * u) * R, l = p.side * Math.sin(TAU * u) * R * 0.42, q = u * u;
  const hx = lerp(p.ox, P.x, q), hy = lerp(p.oy, P.y - 6, q);
  return { x: hx + ca * f - sa * l, y: hy + sa * f + ca * l };
}
function drawSaber(c, x, y, len, rot, col) {
  const dx = Math.cos(rot) * len, dy = Math.sin(rot) * len;
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  c.strokeStyle = rgba(col, 0.16); c.lineWidth = 1.4; c.beginPath(); c.arc(x, y, len, 0, TAU); c.stroke();
  c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy);
  c.strokeStyle = rgba(col, 0.32); c.lineWidth = len * 0.46; c.stroke();
  c.strokeStyle = rgba(col, 0.9); c.lineWidth = len * 0.18; c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = len * 0.07; c.stroke();
  c.restore();
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = '#16202f'; c.fillRect(-len * 0.17, -len * 0.08, len * 0.34, len * 0.16);
  c.strokeStyle = '#b8ecff'; c.lineWidth = 0.8; c.strokeRect(-len * 0.17, -len * 0.08, len * 0.34, len * 0.16);
  c.restore();
}
WB.glaive = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, tg = nearestK(P.x, P.y, p.amount, p.range * 1.6);
  if (!tg.length) { w.t = 0.25; return; }
  const m = muzzleWorld(w);
  for (let i = 0; i < p.amount; i++) {
    const t = tg[i % tg.length], a = Math.atan2(t.y - m.y, t.x - m.x) + (i - (p.amount - 1) / 2) * 0.32;
    w.st.n = ((w.st.n || 0) + 1) % 97;
    spawnProj('glaive', m.x, m.y, 0, 0, { dmg: p.dmg, pierce: 999, r: p.size * p.area, life: p.dur + 0.5 + i * 0.08, src: w.id, icd: 0.3, icdKey: 'gl' + w.st.n, kb: 70, stun: p.stun || 0,
      ang: a, side: i % 2 ? -1 : 1, range: p.range, ox: m.x, oy: m.y, u: 0, du: 1 / p.dur, rot: rand(0, TAU), len: p.size * p.area, col: '#62f0ff', wait: i * 0.08, w });
  }
  fired(w, 0.6); w.t = p.cd; AUDIO.sfx('swing');
};
// Танец клинков: шесть мечей на орбите; раз в цикл разлетаются звездой и возвращаются
WB.bladedance = (w, dt, spd) => {
  const p = w.p, st = w.st, R = p.orbit * p.area, sz = p.size * Math.sqrt(p.area), T = 1.1;
  st.c = (st.c === undefined ? p.cycle : st.c) - dt * spd;
  if (st.c <= 0 && !st.out) { st.c = p.cycle + T; st.out = T; AUDIO.sfx('swing'); fired(w, 1); }
  if (st.out > 0) st.out = Math.max(0, st.out - dt * spd); else st.a = (st.a || 0) + p.rot * dt * spd;
  st.pos = st.pos || [];
  for (let i = 0; i < p.amount; i++) {
    const a0 = (st.a || 0) + i * TAU / p.amount;
    let x, y;
    if (st.out > 0) { const u = 1 - st.out / T, d = R + Math.sin(Math.PI * u) * p.range, aa = a0 + Math.sin(TAU * u) * 0.55; x = P.x + Math.cos(aa) * d; y = P.y - 6 + Math.sin(aa) * d; }
    else { x = P.x + Math.cos(a0) * R; y = P.y - 6 + Math.sin(a0) * R; }
    st.pos[i] = { x, y, rot: (st.spin = (st.spin || 0) + dt * 2.2) + i };
    eachEnemyIn(x, y, sz, e => { if (icdOk(e, 'bd' + i, p.icd)) { hitEnemy(e, p.dmg, { src: w.id, kb: 80 }); thunderHop(e, p.dmg); } });
  }
  st.pos.length = p.amount;
};
WD.bladedance = (c, w) => {
  const st = w.st, p = w.p; if (!st.pos) return;
  const sz = p.size * Math.sqrt(p.area), tr = st.tr || (st.tr = []);
  const cols = ['#29a8ff', '#3dff6a', '#c45bff'];
  // на броске звездой клинки удлиняются
  const ext = st.out > 0 ? 1 + 0.3 * Math.sin(Math.PI * (1 - st.out / 1.1)) : 1;
  st.pos.forEach((q, i) => drawSaber3D(c, q.x, q.y + 6, q.rot * 6, sz * 1.5, cols[i % 3], saberTrail(tr[i] || (tr[i] = []), q.x, q.y + 6, q.rot * 6), ext, 0));
};

/* ---------- Электромагнит: хватает врагов, крутит и швыряет в толпу ---------- */
function magnetAnchor(w, k, n) {
  const m = muzzleWorld(w), a = P.aim + (n > 1 ? (k / (n - 1) - 0.5) * 1.2 : 0);
  return { x: m.x + Math.cos(a) * 26, y: m.y + Math.sin(a) * 26 };
}
const magnetable = e => e.alive && !e.boss && !e.parent && !e.elite && !e.mag && !e.T.prop && e.T.ai !== 'node' && e.T.ai !== 'nest';
WB.magnet = (w, dt, spd) => {
  if (!cdReady(w, dt, spd)) return;
  const p = w.p, R = p.range * p.area, cand = [];
  eachEnemyIn(P.x, P.y, R, e => { if (magnetable(e)) cand.push(e); });
  if (!cand.length) { w.t = 0.25; return; }
  cand.sort((a, b) => d2(a.x, a.y, P.x, P.y) - d2(b.x, b.y, P.x, P.y));
  const n = Math.min(p.amount, cand.length);
  for (let k = 0; k < n; k++) cand[k].mag = { w, k, n, t: 0, ph: 'pull', hits: new Set() };
  for (const g of G.gems) if (!g.mag && d2(g.x, g.y, P.x, P.y) < (R * 1.6) ** 2) g.mag = true;
  fired(w, 0.8); w.t = p.cd; AUDIO.sfx('charge');
  // импульс захвата: два кольца полюсов сжимаются к корпусу одно за другим
  FX.ring(P.x, P.y, R, 12, 0.3, '#ff5a6e', 1.4);
  FX.later(0.07, () => FX.ring(P.x, P.y, R * 0.92, 12, 0.3, '#5aa8ff', 1.4));
};
// Магнитная буря: враги на орбите таранят остальных, раз в цикл разлетаются во все стороны
WB.magstorm = (w, dt, spd) => {
  const p = w.p, st = w.st, R = p.orbit * p.area;
  st.a = (st.a || 0) + p.rot * dt * spd;
  st.ring = (st.ring || []).filter(e => e.alive && e.mag && e.mag.w === w && e.mag.ph === 'orbit');
  st.pullT = (st.pullT || 0) - dt * spd;
  if (st.ring.length < p.amount && st.pullT <= 0) {
    st.pullT = 0.18;
    let best = null, bd = (p.range * p.area) ** 2;
    eachEnemyIn(P.x, P.y, p.range * p.area, e => { if (!magnetable(e)) return; const d = d2(e.x, e.y, P.x, P.y); if (d < bd) { bd = d; best = e; } });
    if (best) { best.mag = { w, ph: 'orbit', t: 0, hits: new Set() }; st.ring.push(best); }
    for (const g of G.gems) if (!g.mag && d2(g.x, g.y, P.x, P.y) < (p.range * 1.3) ** 2) g.mag = true;
  }
  st.ring.forEach((e, i) => { const a = st.a + i * TAU / Math.max(1, st.ring.length); e.mag.tx = P.x + Math.cos(a) * R; e.mag.ty = P.y - 4 + Math.sin(a) * R; });
  st.c = (st.c === undefined ? p.cycle : st.c) - dt * spd;
  if (st.c <= 0) {
    st.c = p.cycle;
    if (st.ring.length) {
      for (const e of st.ring) { const a = Math.atan2(e.y - P.y, e.x - P.x); e.mag = { w, ph: 'fly', t: 0, vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed, hits: new Set() }; }
      st.ring = []; FX.ring(P.x, P.y, R, R * 2.6, 0.4, '#ff9aa6', 5); AUDIO.sfx('dash'); fired(w, 1);
    }
  }
};
// поле магнита: две силовые линии (красный и синий полюс) выгибаются в разные стороны и плавно «дышат»;
// по ним бегут светлые штрихи потока — от врага к модулю; на враге — две встречные дуги захвата
function drawMagnetArcs(c, w) {
  const m = muzzleWorld(w), t = G.time;
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = 1.1; c.lineCap = 'round';
  for (const e of G.enemies) {
    if (!e.mag || e.mag.w !== w || e.mag.ph === 'fly') continue;
    const ex = e.x, ey = bodyY(e), dx = ex - m.x, dy = ey - m.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const b = Math.min(24, L * 0.3) * (0.8 + 0.2 * Math.sin(t * 6 + (e.id || 0)));
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1, cx = (m.x + ex) / 2 + nx * b * sd, cy = (m.y + ey) / 2 + ny * b * sd;
      c.beginPath(); c.moveTo(m.x, m.y); c.quadraticCurveTo(cx, cy, ex, ey);
      c.strokeStyle = k ? 'rgba(90,168,255,0.7)' : 'rgba(255,90,110,0.7)'; c.setLineDash([]); c.stroke();
      c.strokeStyle = k ? 'rgba(205,230,255,0.9)' : 'rgba(255,210,216,0.9)'; c.setLineDash([3, 11]); c.lineDashOffset = t * 60; c.stroke();
    }
    c.setLineDash([]);
    const r = (e.r || 10) + 5;
    c.strokeStyle = 'rgba(255,90,110,0.85)'; c.beginPath(); c.arc(ex, ey, r, t * 5, t * 5 + 1.6); c.stroke();
    c.strokeStyle = 'rgba(90,168,255,0.85)'; c.beginPath(); c.arc(ex, ey, r, -t * 5 + Math.PI, -t * 5 + Math.PI + 1.6); c.stroke();
  }
  c.restore();
}
WD.magnet = drawMagnetArcs;
WD.magstorm = (c, w) => {
  drawMagnetArcs(c, w);
  const p = w.p, R = p.orbit * p.area;
  c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#ff9aa6', 0.22); c.lineWidth = 1; c.setLineDash([6, 6]);
  c.beginPath(); c.arc(P.x, P.y - 4, R, (w.st.a || 0), (w.st.a || 0) + TAU); c.stroke(); c.restore();
};
// шаг удерживаемого врага: подтягивание, удержание, орбита, полёт; true — обычный ИИ пропускается
function magnetStep(e, dt) {
  const M = e.mag, w = M.w, p = w.p;
  if (!P.weapons.includes(w)) { e.mag = null; return false; }
  M.t += dt; e.vx = e.vy = 0; e.kbx = e.kby = 0; e.ang = (e.ang || 0) + dt * 12;
  if (M.ph === 'pull' || M.ph === 'hold' || M.ph === 'orbit') {
    let tx, ty;
    if (M.ph === 'orbit') { tx = M.tx === undefined ? e.x : M.tx; ty = M.ty === undefined ? e.y : M.ty; }
    else { const an = magnetAnchor(w, M.k, M.n), sp = M.t * 9 + M.k * TAU / M.n; tx = an.x + Math.cos(sp) * 12; ty = an.y + Math.sin(sp) * 12; }
    const k = 1 - Math.exp(-dt * (M.ph === 'pull' ? 9 : 16));
    e.x += (tx - e.x) * k; e.y += (ty - e.y) * k;
    if (M.ph === 'orbit') eachEnemyIn(e.x, e.y, e.r + 6, o => { if (o !== e && !o.mag && icdOk(o, 'ms' + e.id, 0.35)) { hitEnemy(o, p.dmg * 0.5, { src: w.id, kb: 180 }); FX.sparks(o.x, o.y, 2, '#ffd0d6', 160); } });
    if (M.ph === 'pull' && M.t > 0.35) M.ph = 'hold';
    if (M.ph === 'hold' && M.t > 0.62) {
      let best = null, bd = 460 * 460;
      for (const o of G.enemies) { if (o === e || o.mag || !o.alive || o.T.prop) continue; const d = d2(o.x, o.y, e.x, e.y); if (d < bd) { bd = d; best = o; } }
      const a = best ? Math.atan2(best.y - e.y, best.x - e.x) : P.aim;
      M.ph = 'fly'; M.t = 0; M.vx = Math.cos(a) * p.speed; M.vy = Math.sin(a) * p.speed;
      FX.sparks(e.x, e.y, 6, '#ff9aa6', 220); AUDIO.sfx('dash');
    }
    return true;
  }
  e.x += M.vx * dt; e.y += M.vy * dt;
  const meteor = linkK('meteor') > 0;
  // след полёта: у метеора — огонь, иначе чёткие штрихи назад по курсу
  if (meteor) { if (Math.random() < 0.6) FX.dot(e.x, e.y, 0, 0, 0.35, e.r * 0.9, Math.random() < 0.5 ? '#ffb35c' : '#ff5a1f', 0); }
  else if (Math.random() < 0.8) FX.sparks(e.x + rand(-e.r, e.r) * 0.5, bodyY(e) + rand(-e.r, e.r) * 0.3, 1, Math.random() < 0.5 ? '#ffb0bb' : '#b0d4ff', Math.hypot(M.vx, M.vy) * 0.35, Math.atan2(-M.vy, -M.vx), 0.12, 0.2);
  const l = Math.hypot(M.vx, M.vy) || 1;
  eachEnemyIn(e.x, e.y, e.r + 4, o => {
    if (o === e || o.mag || M.hits.has(o)) return;
    M.hits.add(o);
    hitEnemy(o, p.dmg, { src: w.id, kb: 240, kx: M.vx / l, ky: M.vy / l });
    if (e.alive) hitEnemy(e, p.dmg * 0.35, { src: w.id, nocrit: true });
    FX.sparks(o.x, o.y, 4, '#ffd0d6', 200);
  });
  if (M.t > 0.55 || !e.alive) {
    if (meteor) meteorBlast(e, w);
    if (e.alive) {
      hitEnemy(e, p.slam || p.dmg * 0.8, { src: w.id, nocrit: true });
      if (p.blast) { FX.explosion(e.x, e.y, p.blast, '#ff5a6e'); const x = e.x, y = e.y; eachEnemyIn(x, y, p.blast, o => { if (o !== e) hitEnemy(o, p.dmg * 0.6, { src: w.id, kb: 150 }); }); }
    }
    FX.hexRing(e.x, bodyY(e), 4, 26, 0.24, '#ff9aa6', 1.3);
    e.mag = null;
  }
  return true;
}
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
  let blast = p.blast, dmg = p.dmg, src = p.src;
  const fk = linkK('focus'), W = fk ? wellNear(p.x, p.y, 260) : null;
  if (W && d2(W.x, W.y, p.x, p.y) < (W.r + 14) ** 2) { blast *= 1.4; dmg *= 1 + fk; src = 'link_focus'; FX.ring(p.x, p.y, 6, blast, 0.3, '#b78bff', 3); }
  // компактный огненный шар; радиус поражения показывает тонкое кольцо взрыва
  FX.explosion(p.x, p.y, blast * 0.55, p.col || '#ff9a3d');
  AUDIO.sfx('boom');
  eachEnemyIn(p.x, p.y, blast, e => { hitEnemy(e, dmg, { src, kb: 120, kx: undefined }); });
  if (p.fire) spawnArea('fire', p.x, p.y, { r: p.blast * 0.55, life: 1.3, dmg: p.fire * P.stats.might, tick: 0.25, burn: 4 * P.stats.burn, src: p.src });
}
const PK = {
  bolt: {
    // попадание: расходящийся шестиугольник и пара осколков — чётко, без пятна
    hit(p, e) { hitEnemy(e, p.dmg, p); FX.hexRing(p.x, p.y, 2, 6 + p.r * 1.6, 0.16, p.col, 1.3); FX.shards(p.x, p.y, 2, p.col, 150); },
    draw(c, p) { drawBolt3D(c, p); },
  },
  orb: {
    hit(p, e) {
      hitEnemy(e, p.dmg, p);
      p.nb = (p.nb || 0) + 1;
      if (p.nb % 2 === 1) {
        FX.hexRing(e.x, e.y, 4, p.blast, 0.22, p.col, 1.6); FX.dot(e.x, e.y, 0, 0, 0.08, p.blast * 0.35, '#ffffff', 0);
        eachEnemyIn(e.x, e.y, p.blast, n => { if (n !== e) hitEnemy(n, p.dmg * 0.5, { src: p.src, nocrit: true }); });
      }
    },
    draw(c, p) {
      // чёткие линии скорости вместо мягкого хвоста
      const a = Math.atan2(p.vy, p.vx), ca = Math.cos(a), sa = Math.sin(a);
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.strokeStyle = rgba(p.col, 0.45); c.lineWidth = 1.2;
      c.beginPath();
      for (const o of [-0.55, 0, 0.55]) { const ox = -sa * p.r * o, oy = ca * p.r * o, L0 = p.r * (o ? 1.2 : 1.0), L1 = p.r * (o ? 3.2 : 4.4); c.moveTo(p.x + ox - ca * L0, p.y + oy - sa * L0); c.lineTo(p.x + ox - ca * L1, p.y + oy - sa * L1); }
      c.stroke(); c.restore();
      drawOrb3D(c, p);
    },
  },
  missile: {
    update(p, dt) {
      if (p.delay > 0) { p.delay -= dt; return; }
      if (!p.target || !p.target.alive) {
        const W = linkK('focus') ? wellNear(p.x, p.y, 420) : null;
        p.target = (W && nearestEnemy(W.x, W.y, W.r + 30)) || nearestEnemy(p.x, p.y, 420);
      }
      const sp = Math.hypot(p.vx, p.vy);
      let a = Math.atan2(p.vy, p.vx);
      if (p.target) a += clamp(angDiff(a, Math.atan2(p.target.y - p.y, p.target.x - p.x)), -p.turn * dt, p.turn * dt);
      const ns = Math.min(p.speed, sp + 520 * dt);
      p.vx = Math.cos(a) * ns; p.vy = Math.sin(a) * ns;
      // высота: свечка вверх после пуска и пикирование к цели
      const dist = p.target ? Math.hypot(p.target.x - p.x, p.target.y - p.y) : 160;
      p.h = (p.h || 0) + (Math.min(34, dist * 0.3) * Math.min(1, p.t / 0.3) - (p.h || 0)) * Math.min(1, dt * 6);
      p.trail = (p.trail || 0) - dt; p.smk = (p.smk || 0) - dt;
      const cp = vfxCp(), k = p.src === 'carpet' ? 0.75 : 1, ca = Math.cos(a), sa = Math.sin(a) * vfxSp(), tx = p.x - ca * 7 * k, ty = p.y - p.h * cp - sa * 7 * k;
      if (p.trail <= 0) { p.trail = 0.03; FX.dot(tx, ty, 0, 0, 0.18, 3 * k, '#ffb35c', 0); }
      if (p.smk <= 0) { p.smk = p.src === 'carpet' ? 0.14 : 0.07; FX.puff(tx, ty, 2.6 * k, '#8090a8', 0.55, rand(-8, 8), -10); }
    },
    hit(p, e) { missileBoom(p); },
    expire(p) { missileBoom(p); },
    draw(c, p) { drawMissile3D(c, p, p.src === 'carpet' ? '#ffd36b' : '#ff9a3d', p.src === 'carpet' ? 0.75 : 1); },
  },
  flame: {
    update(p, dt) { p.r += (p.grow || 0) * dt; },
    // догорая, порция огня оставляет дымок
    expire(p) { if (Math.random() < 0.3) FX.puff(p.x, p.y, p.r * 0.7, '#5a6272', 0.6, p.vx * 0.15, p.vy * 0.15 - 14); },
    draw(c, p) {
      // язык пламени вдоль полёта: раскалённая голова, хвост тянется назад; цвет остывает с возрастом
      const q = p.life / p.max, s = p.r * 1.2, a = Math.atan2(p.vy, p.vx), al = Math.min(1, q * 2);
      const col = q > 0.72 ? '#ffc04d' : q > 0.42 ? '#ff7a2e' : '#c8361a';
      c.globalAlpha = al * 0.35; c.drawImage(dotSprite(col), p.x - s * 1.2, p.y - s * 1.2, s * 2.4, s * 2.4);
      c.globalAlpha = al * 0.6;
      c.save(); c.translate(p.x, p.y); c.rotate(a - Math.PI / 2);
      c.drawImage(flameSprite(col), -s * 0.5, -s * 0.45, s, s * 3.2);
      c.restore();
      if (q > 0.6) { c.globalAlpha = (q - 0.6) * 1.1; c.drawImage(dotSprite('#fff2c8'), p.x - s * 0.3, p.y - s * 0.3, s * 0.6, s * 0.6); }
      c.globalAlpha = 1;
    },
  },
  glaive: {
    update(p, dt) {
      p.vx = p.vy = 0;
      if (p.wait > 0) { p.wait -= dt; if (p.w) { const m = muzzleWorld(p.w); p.x = p.ox = m.x; p.y = p.oy = m.y; } p.noHit = true; return; }
      p.noHit = false;
      p.u += dt * p.du; p.rot += dt * 19;
      const q = glaivePos(p); p.x = q.x; p.y = q.y;
      if (p.u >= 1) p.dead = true;
      if (Math.random() < 0.35) FX.dot(p.x, p.y, 0, 0, 0.18, p.len * 0.45, p.col, 0);
    },
    hit(p, e) { hitEnemy(e, p.dmg, p); thunderHop(e, p.dmg); FX.sparks(e.x, e.y, 3, '#d8fbff', 200, undefined, 0, 0.2); AUDIO.sfx('hit'); },
    draw(c, p) {
      // клинки зажигаются при броске (выдвигаются со вспышкой) и гаснут, возвращаясь к корпусу
      const on = p.wait > 0 ? 0 : ease.outCubic(clamp(p.u / 0.14, 0, 1)), off = clamp((1 - p.u) / 0.1, 0, 1), ext = Math.min(on, off);
      drawSaber3D(c, p.x, p.y, p.rot, p.len * 1.5, p.src === 'link_twin' ? '#c45bff' : '#29a8ff', saberTrail(p.tr || (p.tr = []), p.x, p.y, p.rot), ext, p.wait > 0 ? 0 : clamp(1 - p.u / 0.14, 0, 1) * 0.9);
    },
  },
  saw: {
    update(p, dt) {
      p.rot += dt * 22;
      if (p.returning) {
        const hm = p.w ? muzzleWorld(p.w) : P;
        const dx = hm.x - p.x, dy = hm.y - p.y, d = Math.hypot(dx, dy) || 1;
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
      rustSawHit(e, p);
      AUDIO.sfx('saw');
      FX.sparks(e.x, bodyY(e), 5, '#ffd9a0', 240, Math.atan2(p.vy, p.vx), 0.9, 0.22);
      if (e === p.target) {
        p.bounces--;
        if (p.bounces < 0) { p.returning = true; return; }
        p.hits.add(e);
        p.target = nearestEnemy(p.x, p.y, 260, p.hits);
        if (!p.target) p.returning = true;
      }
    },
    draw(c, p) { drawSaw3D(c, p.x, p.y, p.r, p.rot, '#ff9a3d', false, p.vx, p.vy); },
  },
  bigsaw: {
    update(p, dt) {
      p.rot += dt * 16;
      const hw = VIEW.hw - p.r, hh = VIEW.hh - p.r;
      if (p.x < G.cam.x - hw && p.vx < 0) p.vx = -p.vx;
      if (p.x > G.cam.x + hw && p.vx > 0) p.vx = -p.vx;
      if (p.y < G.cam.y - hh && p.vy < 0) p.vy = -p.vy;
      if (p.y > G.cam.y + hh && p.vy > 0) p.vy = -p.vy;
      if (Math.random() < 0.3) FX.sparks(p.x, p.y - SAW_H * vfxCp(), 1, '#ffd9a0', 160);
    },
    hit(p, e) { hitEnemy(e, p.dmg, p); rustSawHit(e, p); },
    draw(c, p) { drawSaw3D(c, p.x, p.y, p.r, p.rot, '#ffb36b', true, p.vx, p.vy); },
  },
  shard: {
    draw(c, p) { drawShard3D(c, p); },
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
    draw(c, p) { drawBomblet3D(c, p); },
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
    draw(c, p) { drawGravSeed(c, p); },
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
    if (p.dead || p.life <= 0) {
      if (!p.dead && K.expire) K.expire(p);
      if (p.w && (p.kind === 'saw' || p.kind === 'bigsaw')) sawHome(p);
      removeAt(arr, i); continue;
    }
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
    if (p.dead) { if (p.w && (p.kind === 'saw' || p.kind === 'bigsaw')) sawHome(p); removeAt(arr, i); }
  }
}
function sawHome(p) {
  const w = p.w; p.w = null;
  w.st.outN = Math.max(0, (w.st.outN || 1) - 1);
  if (p.returning || p.kind === 'bigsaw') { const m = muzzleWorld(w); FX.sparks(m.x, m.y, 5, '#ffcf8a', 160); if (p.returning) AUDIO.sfx('clank'); }
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
      if (a.tickT <= 0) { a.tickT = a.tick; eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, burn: a.burn || 0, corrode: a.corr || 0, nocrit: true, combo: a.combo }); }); }
      if (Math.random() < 0.25) FX.dot(a.x + rand(-a.r, a.r) * 0.7, a.y + rand(-a.r, a.r) * 0.5, 0, -40, 0.4, rand(4, 7), a.col || '#ff7a2e', 1);
    },
    draw(c, a) { drawFirePool(c, a); },
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
      c.beginPath(); c.ellipse(a.x, a.y, a.r * g, a.r * (RENDER.k < 1 ? 1 : 0.62) * g, 0, 0, TAU); c.fill();
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
      if (Math.random() < 0.5) { const an = rand(0, TAU), rr = R * rand(0.7, 1); FX.sparks(a.x + Math.cos(an) * rr, a.y + Math.sin(an) * rr, 1, '#c9a6ff', rr * 2.6, an + Math.PI + 0.9, 0.1, 0.32); }
    },
    end(a) {
      if (!a.collapse) return;
      gravBurst(a.x, a.y, a.r * 0.8, '#a77bff'); AUDIO.sfx('boom');
      eachEnemyIn(a.x, a.y, a.r * 0.9, e => { hitEnemy(e, a.collapse, { src: a.src, kb: 250 }); });
    },
    draw(c, a) { const q = Math.min(1, a.life / 0.25); drawHole3D(c, a.x, a.y, a.r * Math.min(1, a.t * 4) * q, G.time + a.x, '#a77bff', q); },
  },
  cloud: {
    update(a, dt) {
      a.tickT -= dt;
      if (a.tickT <= 0) { a.tickT = a.tick; eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, corrode: 0.2, nocrit: true }); }); }
    },
    draw(c, a) {
      const q = Math.min(1, a.life / a.max * 2);
      c.globalAlpha = q; nanoSwarm(c, a.x, a.y, a.r * 0.9, '#8dff6a', 9, G.time + a.x * 0.01, undefined, 4, 2); c.globalAlpha = 1;
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
      const dk = a.det ? 1 + 0.5 * linkK('detonator') : 1, blast = a.blast * dk;
      FX.explosion(a.x, a.y, blast * 0.75, a.det ? '#ffe066' : a.col);
      AUDIO.sfx('boom');
      eachEnemyIn(a.x, a.y, blast, e => { hitEnemy(e, a.dmg * dk, { src: a.det ? 'link_detonator' : a.src, kb: 160, stun: a.stun || (a.det ? 0.3 : 0) }); });
      if (a.bomblets) for (let i = 0; i < a.bomblets; i++) {
        const an = i * TAU / a.bomblets + rand(-0.3, 0.3), s = rand(160, 240);
        spawnProj('bomblet', a.x, a.y, Math.cos(an) * s, Math.sin(an) * s, { dmg: a.dmg * 0.5, r: 5, life: 0.45, src: a.src, blast: 32 * P.stats.area, pierce: 1 });
      }
    },
    draw(c, a) { drawMine3D(c, a); },
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
      if (a.src === 'shock' || a.src === 'seismic') ringDetonate(a);
      // обломки плит пола подлетают на фронте волны
      if (R > 12 && Math.random() < 0.55 * FX.quality) { const an = rand(0, TAU); FX.add({ k: 5, x: a.x + Math.cos(an) * R, y: a.y + Math.sin(an) * R, z: 0, vx: Math.cos(an) * 60, vy: Math.sin(an) * 60, vz: rand(150, 240), life: rand(0.45, 0.7), max: 0.7, size: rand(0.5, 0.8), rot: rand(0, 8), vr: rand(-12, 12), col: a.col, drag: 1.4 }); }
    },
    draw(c, a) { drawShockWall(c, a); },
  },
  strike: {
    update(a, dt) {
      if (!a.hit && a.t >= a.delay) {
        a.hit = true;
        // колонна с орбиты — та же рельса со спиралью, сверху вниз; удар — тонкие волны, компактный огонь
        FX.rail(a.x, a.y - 600, a.x, a.y, 12, 0.32, '#9fd8ff');
        FX.explosion(a.x, a.y, a.r * 0.45, '#eaf6ff', true); crispBurst(a.x, a.y, a.r, '#9fd8ff'); FX.addShake(5);
        AUDIO.sfx('rail');
        eachEnemyIn(a.x, a.y, a.r, e => { hitEnemy(e, a.dmg, { src: a.src, kb: 220, stun: 0.5 }); });
        spawnArea('fire', a.x, a.y, { r: a.r * 0.45, life: 1.2, dmg: 6 * P.stats.might, tick: 0.25, burn: 4, src: a.src });
      }
    },
    // прицел орбитального удара: кольцо, четыре засечки, внутреннее кольцо-таймер смыкается к центру, луч наведения с неба
    draw(c, a) {
      if (a.hit) return;
      const q = clamp(a.t / a.delay, 0, 1), R = a.r, x = a.x, y = a.y, t = G.time, app = ease.outCubic(clamp(a.t / 0.15, 0, 1));
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      c.fillStyle = rgba('#9fd8ff', 0.03 + 0.05 * q); c.beginPath(); c.arc(x, y, R * app, 0, TAU); c.fill();
      c.strokeStyle = rgba('#eaf6ff', 0.75); c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, R * app, 0, TAU); c.stroke();
      c.beginPath();
      for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + t * 0.8; c.moveTo(x + Math.cos(an) * R * 0.8, y + Math.sin(an) * R * 0.8); c.lineTo(x + Math.cos(an) * R * 1.14, y + Math.sin(an) * R * 1.14); }
      c.stroke();
      c.strokeStyle = rgba('#9fd8ff', 0.9); c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, Math.max(1, R * (1 - q)), 0, TAU); c.stroke();
      c.strokeStyle = rgba('#eaf6ff', 0.12 + 0.5 * q); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - 600); c.lineTo(x, y); c.stroke();
      c.restore();
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
