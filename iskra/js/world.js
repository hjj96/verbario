'use strict';
/* ===== Живые локации: опасности секторов и ретрансляторы Роя ===== */

/* ---------- Опасности: стоят на карте, работают по циклу, бьют и Рой, и игрока ----------
   цикл: [0, t0) — покой, [t0, t1) — предупреждение, [t1, per) — удар/работа */
const HAZ = {
  rust: { id: 'press', name: 'Пресс-молоты', col: '#ffb43d', per: 4.4, t0: 2.8, t1: 3.6, cell: 760, ch: 0.42, r: 44,
    d: 'Промышленные прессы бьют каждые 4 секунды, мигающий круг — сигнал. Заманите Рой под молот: давит любую машину, элите и боссам — тяжёлый урон.' },
  neon: { id: 'fence', name: 'Лазерные заборы', col: '#ff3fa4', per: 5.2, t0: 2.4, t1: 3.2, cell: 800, ch: 0.45, len: 240, w: 14,
    d: 'Пары пилонов включают луч на 2 секунды. Луч режет машины Роя пополам, игрока ранит. Рывок проходит насквозь.' },
  hive: { id: 'geyser', name: 'Кислотные гейзеры', col: '#c6ff3d', per: 6.2, t0: 3.6, t1: 4.5, cell: 720, ch: 0.45, r: 56,
    d: 'Жерла выбрасывают столб кислоты, пузыри — за секунду до извержения. Кислота плавит всё вокруг, и Рой тоже.' },
  cryo: { id: 'vent', name: 'Криовыбросы', col: '#9ff0ff', per: 6.6, t0: 4.0, t1: 4.8, cell: 740, ch: 0.45, r: 72,
    d: 'Решётки сброса раз в несколько секунд выбрасывают облако жидкого азота: Рой вмерзает намертво, робота ранит и замедляет. Белые кольца и туман — сигнал.' },
  orbit: { id: 'lock', name: 'Шлюзы', col: '#ffd36b', per: 7.2, t0: 4.6, t1: 5.4, cell: 820, ch: 0.42, r: 150, hole: 30,
    d: 'Люки шлюзов раскрываются почти на две секунды: разгерметизация тянет всё к проёму, а машины в самом проёме выбрасывает за борт. Мигающие полосы — сигнал.' },
};
const HZ_CACHE = new Map(), HZ_LIST = [];
function hazDef() { return G.sector ? HAZ[G.sector.id] || null : null; }
function resetWorld() { HZ_CACHE.clear(); HZ_LIST.length = 0; if (typeof resetStructures === 'function') resetStructures(); G.relay = null; G.nestT = undefined; G.nestKills = 0; G.relayT = 70; G.relayN = 0; G.surgeT = 0; }
const smooth01 = q => q * q * (3 - 2 * q);

// опасности вокруг игрока: детерминированно по ячейкам, состояние ячейки — в кэше
function hazardsAround() {
  const H = hazDef();
  HZ_LIST.length = 0;
  if (!H) return HZ_LIST;
  const C = H.cell, seed = 501 + SECTORS.indexOf(G.sector) * 37;
  const x0 = P.x - 1000, x1 = P.x + 1000, y0 = P.y - 800, y1 = P.y + 800;
  if (HZ_CACHE.size > 400) HZ_CACHE.clear();
  for (let cy = Math.floor(y0 / C); cy <= Math.floor(y1 / C); cy++) for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) {
    if (hash2(cx, cy, seed) > H.ch) continue;
    const key = cx * 65536 + cy;
    let h = HZ_CACHE.get(key);
    if (!h) {
      const x = (cx + 0.18 + hash2(cx, cy, seed + 1) * 0.64) * C, y = (cy + 0.18 + hash2(cx, cy, seed + 2) * 0.64) * C;
      h = { key, kind: H.id, x, y, off: hash2(cx, cy, seed + 3) * H.per, ang: hash2(cx, cy, seed + 4) * Math.PI, u: 0, ph: 0, safe: x * x + y * y < 340 * 340 };
      // уже идущий удар не срабатывает «задним числом» у только что замеченной опасности
      h.cyc = ((G.time + h.off) % H.per) >= H.t1 ? Math.floor((G.time + h.off) / H.per) : -1;
      if (H.id === 'fence') { const c = Math.cos(h.ang) * H.len / 2, s = Math.sin(h.ang) * H.len / 2; h.ax = x - c; h.ay = y - s; h.bx = x + c; h.by = y + s; }
      HZ_CACHE.set(key, h);
    }
    if (h.safe) continue;
    h.u = (G.time + h.off) % H.per;
    h.ph = h.u < H.t0 ? 0 : h.u < H.t1 ? 1 : 2;
    HZ_LIST.push(h);
  }
  return HZ_LIST;
}
function segD2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}
// урон среды — долей прочности: рядовых машин уничтожает, элите и боссам — ощутимо, но не насмерть
function envHit(e, frac, src) {
  if (!e.alive || e.inv || e.parent || e.T.prop || e.T.ai === 'node') return;
  const k = e.boss ? 0.05 : e.lt ? 0.1 : e.elite ? 0.2 : 1.05;
  hitEnemy(e, e.maxHp * frac * k / (G.dmgMul || 1), { src, nocrit: true });
}
function updateHazards(dt) {
  const H = hazDef();
  if (!H) return;
  const m = G.time / 60;
  for (const h of hazardsAround()) {
    const cyc = Math.floor((G.time + h.off) / H.per), first = h.ph === 2 && h.cyc !== cyc, near = onScreen(h, 140);
    if (first) h.cyc = cyc;
    if (h.kind === 'press') {
      if (h.ph === 1 && near && Math.random() < dt * 6) FX.dot(h.x + rand(-30, 30), h.y + rand(-30, 30), 0, rand(-20, -5), 0.4, 1.6, H.col, 0.6);
      if (!first) continue;
      eachEnemyIn(h.x, h.y, H.r, e => { envHit(e, 1, 'hazard'); });
      if (d2(h.x, h.y, P.x, P.y) < (H.r + P.r * 0.3) ** 2) hurtPlayer(14 + m * 0.8, null);
      if (near) {
        FX.ring(h.x, h.y, H.r * 0.5, H.r * 1.7, 0.35, H.col, 3); FX.debris(h.x, h.y, 8, '#8a7a5c', 190);
        FX.smoke(h.x, h.y, 5, '#3a3428', 14); FX.addShake(2.5); AUDIO.sfx('thump');
      }
    } else if (h.kind === 'fence') {
      if (first && near) AUDIO.sfx('laser');
      if (h.ph !== 2) continue;
      const w = H.w / 2;
      eachEnemyIn(h.x, h.y, H.len / 2 + 24, e => {
        if (segD2(e.x, e.y, h.ax, h.ay, h.bx, h.by) < (w + e.r * 0.8) ** 2 && icdOk(e, 'hz', 0.3)) { envHit(e, 1, 'hazard'); if (near) FX.sparks(e.x, e.y, 4, H.col, 200, undefined, 0, 0.25); }
      });
      if (segD2(P.x, P.y, h.ax, h.ay, h.bx, h.by) < (w + P.r * 0.5) ** 2) hurtPlayer(10 + m * 0.6, null);
    } else if (h.kind === 'vent') {
      // криовыброс: туман нарастает, затем облако азота вмораживает Рой и ранит, замедляет робота
      if (h.ph === 1 && near && Math.random() < dt * 22) FX.dot(h.x + rand(-H.r, H.r) * 0.5, h.y + rand(-H.r, H.r) * 0.35, rand(-10, 10), rand(-40, -15), 0.7, rand(2, 3.5), '#dff8ff', 0.5);
      if (first) {
        eachEnemyIn(h.x, h.y, H.r, e => { if (!e.boss) applyChill(e, 0.6, 100, 2.4, true); envHit(e, 0.25, 'hazard'); });
        if (d2(h.x, h.y, P.x, P.y) < (H.r + P.r * 0.3) ** 2) { hurtPlayer(8 + m * 0.5, null); if (!hasBranch('legs', 'C')) P.slowT = Math.max(P.slowT || 0, 2); }
        if (near) { FX.ering(h.x, h.y, 8, H.r * 1.5, 0.45, '#dff8ff', 1.6, true); FX.shards(h.x, h.y, 14, '#bff0ff', 260); FX.light(h.x, h.y, H.r * 2, '#9ff0ff', 0.35, 0.35); AUDIO.sfx('thermo'); FX.addShake(2); }
      }
      if (h.ph === 2 && near && Math.random() < dt * 30) FX.dot(h.x + rand(-22, 22), h.y + rand(-8, 8), rand(-30, 30), rand(-210, -110), 0.7, rand(2, 4), '#dff8ff', 0.3);
    } else if (h.kind === 'lock') {
      // шлюз: разгерметизация тянет всё к проёму; машины в проёме — за борт, робота в проёме ранит
      if (first && near) { AUDIO.sfx('dash'); FX.ering(h.x, h.y, H.r, H.hole, 0.4, '#ffd36b', 1.4, true); }
      if (h.ph !== 2) continue;
      const open = clamp((h.u - H.t1) / 0.25, 0, 1) * clamp((H.per - h.u) / 0.2, 0, 1);
      eachEnemyIn(h.x, h.y, H.r, e => {
        if (e.boss) return;
        const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (d < H.hole) { if (icdOk(e, 'hz', 0.3)) { envHit(e, 1, 'hazard'); if (near && !e.alive) FX.sparks(h.x, h.y, 3, '#ffd36b', 140); } return; }
        const pull = (40 + 300 * (1 - d / H.r)) * open * dt; e.x += dx / d * Math.min(pull, d); e.y += dy / d * Math.min(pull, d);
      });
      { const dx = h.x - P.x, dy = h.y - P.y, d = Math.hypot(dx, dy) || 1;
        if (d < H.r && !(P.dash.t > 0)) { const pull = (25 + 150 * (1 - d / H.r)) * open * dt; P.x += dx / d * Math.min(pull, d); P.y += dy / d * Math.min(pull, d); }
        if (d < H.hole) hurtPlayer(12 + m * 0.7, null); }
      if (near && Math.random() < dt * 50 * open) { const a = rand(0, TAU), rr = H.r * rand(0.6, 1); FX.sparks(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, 1, '#fff2c0', rr * 3, a + Math.PI, 0.05, 0.3); }
    } else {
      if (h.ph === 1 && near && Math.random() < dt * 24) FX.dot(h.x + rand(-18, 18), h.y + rand(-10, 10), rand(-8, 8), rand(-50, -20), 0.5, rand(1.5, 3), H.col, 0.6);
      if (first && near) { AUDIO.sfx('thermo'); FX.ring(h.x, h.y, 14, H.r * 1.5, 0.4, H.col, 3); FX.addShake(2); }
      if (h.ph !== 2) continue;
      eachEnemyIn(h.x, h.y, H.r, e => { if (icdOk(e, 'hz', 0.3)) envHit(e, 0.6, 'hazard'); });
      if (d2(h.x, h.y, P.x, P.y) < (H.r + P.r * 0.3) ** 2) hurtPlayer(9 + m * 0.6, null);
      if (near && Math.random() < dt * 34) FX.dot(h.x + rand(-16, 16), h.y + rand(-6, 6), rand(-40, 40), rand(-230, -120), 0.75, rand(2, 4.5), H.col, 0.3);
    }
  }
}

/* ---------- Ретрансляторы Роя: захват под огнём ради награды ---------- */
const RELAY = { r: 84, cap: 5.5, life: 42 };
const RELAY_REW = {
  strike: { name: 'Орбитальный удар', d: 'луч с орбиты выжигает Рой вокруг мачты', w: () => 3 },
  repair: { name: 'Ремонтный пакет', d: '+40% прочности', w: () => (P.hp < P.stats.maxHp * 0.5 ? 4 : P.hp < P.stats.maxHp * 0.9 ? 1.5 : 0.2) },
  od: { name: 'Перегрузка реактора', d: '+60% овердрайва', w: () => (P.od.active ? 0.2 : 2) },
  surge: { name: 'Энергосеть', d: '+25% урона на 30 секунд', w: () => 2.5 },
  cache: { name: 'Тайник лома', d: 'лом в копилку забега', w: () => 1.5 },
};
function spawnRelay() {
  for (let i = 0; i < 12; i++) {
    const a = rand(0, TAU), d = rand(400, 540), x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
    if (HZ_LIST.some(h => (h.kind === 'fence' ? segD2(x, y, h.ax, h.ay, h.bx, h.by) : d2(h.x, h.y, x, y)) < 190 * 190)) continue;
    if (BLD_LIST.some(b => Math.abs(b.x - x) < b.ex + RELAY.r + 30 && Math.abs(b.y - y) < b.ey + RELAY.r + 30)) continue;
    G.relay = { x, y, t: 0, prog: 0, st: 'idle', waveT: 1.2, doneT: 0, rew: null, rot: rand(0, TAU) };
    UI.banner('РЕТРАНСЛЯТОР РОЯ', 'Захватите: стойте в круге ' + RELAY.cap.toString().replace('.', ',') + ' с — Рой будет мешать', 'gold');
    AUDIO.sfx('reveal');
    return true;
  }
  return false;
}
function relayWave(R) {
  const W = currentWave(), n = 3 + Math.min(4, Math.floor(G.time / 240));
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), d = rand(250, 320); spawnEnemy(weightedKey(W.pool), R.x + Math.cos(a) * d, R.y + Math.sin(a) * d); }
}
function updateRelay(dt) {
  const R = G.relay;
  if (!R) {
    G.relayT -= dt;
    if (G.relayT <= 0) {
      if (G.bossesAlive || (!G.endless && G.time > RUN_LENGTH - 40)) G.relayT = 6;
      else G.relayT = spawnRelay() ? rand(75, 100) : 3;
    }
    return;
  }
  R.t += dt; R.rot += dt * (R.st === 'cap' ? 2.6 : R.st === 'done' ? 5 : 0.7);
  if (R.st === 'done' || R.st === 'off') { R.doneT += dt; if (R.doneT > (R.st === 'done' ? 3 : 1.2)) G.relay = null; return; }
  const inside = d2(R.x, R.y, P.x, P.y) < RELAY.r * RELAY.r;
  if (inside) {
    R.prog = Math.min(1, R.prog + dt / RELAY.cap); R.st = 'cap';
    R.waveT -= dt;
    if (R.waveT <= 0) { R.waveT = 2; relayWave(R); }
    if (Math.random() < dt * 14) { const a = rand(0, TAU); FX.dot(R.x + Math.cos(a) * RELAY.r, R.y + Math.sin(a) * RELAY.r, -Math.cos(a) * 140, -Math.sin(a) * 140, 0.55, 2, '#46e3ff', 0); }
  } else { R.prog = Math.max(0, R.prog - dt / 16); R.st = 'idle'; }
  if (R.prog >= 1) { relayCaptured(R); return; }
  if (R.t > RELAY.life && !inside) {
    R.st = 'off'; R.doneT = 0;
    FX.ring(R.x, R.y, 10, RELAY.r, 0.5, '#ff4d5e', 3); FX.sparks(R.x, R.y - 40, 10, '#ff4d5e', 160);
    FX.text(R.x, R.y - 70, 'РЕТРАНСЛЯТОР ОТКЛЮЧЁН', '#ff4d5e', 12);
  }
}
function relayCaptured(R) {
  R.st = 'done'; R.doneT = 0; G.relayN = (G.relayN || 0) + 1;
  for (const g of G.gems) if (d2(g.x, g.y, R.x, R.y) < 650 * 650) g.mag = true;
  const ids = Object.keys(RELAY_REW), id = weighted(ids, k => RELAY_REW[k].w());
  R.rew = id;
  FX.ring(R.x, R.y, 10, 280, 0.8, '#46e3ff', 4); FX.flash('#46e3ff', 0.16); AUDIO.sfx('formUp');
  if (id === 'strike') {
    warnCircle(R.x, R.y, 330, 0.55, w => {
      FX.beam(w.x, w.y - 1100, w.x, w.y, 70, 0.7, '#9ff0ff'); FX.explosion(w.x, w.y, 140, '#46e3ff', true);
      FX.ring(w.x, w.y, 30, 330, 0.7, '#bff6ff', 7); FX.flash('#bff6ff', 0.32); FX.addShake(12); AUDIO.sfx('boom', { big: true });
      eachEnemyIn(w.x, w.y, 330, e => { envHit(e, e.boss ? 1.2 : e.elite || e.lt ? 1.3 : 1, 'relay'); });
    });
    G.warns[G.warns.length - 1].ally = true;
  } else if (id === 'repair') {
    const v = P.stats.maxHp * 0.4; P.hp = Math.min(P.stats.maxHp, P.hp + v);
    FX.text(P.x, P.y - 34, '+' + Math.round(v), '#5dff9b', 14); FX.ring(P.x, P.y, 10, 70, 0.5, '#5dff9b', 3); AUDIO.sfx('heal');
  } else if (id === 'od') {
    if (!P.od.active) P.od.meter = Math.min(100, P.od.meter + 60);
    AUDIO.sfx('od');
  } else if (id === 'surge') {
    G.surgeT = 30; AUDIO.sfx('tfBoom');
  } else {
    const v = Math.round((22 + G.time / 60 * 3) * P.stats.greed * G.sector.scrap);
    G.scrapRun += v; FX.text(R.x, R.y - 60, '+' + v + ' лома', '#ffb43d', 14); AUDIO.sfx('coin');
  }
  UI.banner('РЕТРАНСЛЯТОР ЗАХВАЧЕН', RELAY_REW[id].name + ' — ' + RELAY_REW[id].d, 'gold');
}
function updateWorld(dt) {
  structuresAround();
  updateHazards(dt);
  updateRelay(dt);
  updateNests(dt);
  if (G.surgeT > 0) G.surgeT = Math.max(0, G.surgeT - dt);
}

/* ---------- Отрисовка ---------- */
const WORLD_PAL = {};
function hazPal(col) { return WORLD_PAL[col] || (WORLD_PAL[col] = enemyPal({ enemy: col, enemyD: mixHex('#06070c', col, 0.18), eye: '#ffffff', enemyL: mixHex('#ffffff', col, 0.5) }, col, false)); }
function relayPal(R) { return R.st === 'done' ? hazPal('#46e3ff') : enemyPal(G.sector.pal, R.st === 'cap' ? '#46e3ff' : '#ffd36b', false); }
const viewSp = view => Math.max(0.35, Math.sin(VIEW_PITCH[view] || 0.42));
// растяжка глубины моделей на полу: основание совпадает с кругом на полу (с проекцией пола — с его эллипсом)
const floorFit = view => RENDER.k / viewSp(view);
const viewCp = view => Math.cos(VIEW_PITCH[view] || 0.42);

// пресс: четыре стойки, рама, гидроцилиндр и плита-молот; глубина растянута, чтобы основание совпадало с кругом удара
// пресс: задняя рама → плита-молот → гидрошток → передняя рама; слои рисуются по порядку,
// поэтому шток не «протыкает» плиту при подъёме, как было при общей сортировке граней
function pressMeshes(h, H, view) {
  const R = 36, top = 70, ky = floorFit(view);
  let hz;
  if (h.ph === 0) hz = 4 + 46 * smooth01(h.u / H.t0);
  else if (h.ph === 1) hz = 50 + Math.sin(G.time * 70) * 1.2;
  else { const q = (h.u - H.t1) / 0.07; hz = q < 1 ? 50 - 46 * q : 4; }
  const mk = fn => { const m = new Mesh(); m.zc = 0; m.push(); m.sc(1, ky, 1); fn(m); m.pop(); return m; };
  const back = mk(m => {
    for (const sx of [-1, 1]) m.box(sx * R - 3.5, R - 3.5, 0, sx * R + 3.5, R + 3.5, top, 'd');
    m.box(-R - 4.5, R - 4, top, R + 4.5, R + 4, top + 7, 'm');
  });
  const ram = mk(m => {
    const b = m.box(-30, -30, hz, 30, 30, hz + 12, 'm');
    // полосы опасности по передней кромке плиты
    for (let k = 0; k < 4; k++) m.line(b[2], -26 + k * 14, -30, hz + 2, -20 + k * 14, -30, hz + 10, H.col, 1.1, 0.75);
  });
  const rod = mk(m => {
    const r = m.cyl(3.4, 3.4, hz + 15, top + 1, 8, 'l'); if (r.cap0) r.cap0.hid = true;
    m.cyl(6.5, 5.6, hz + 12, hz + 15.5, 8, 'd');   // фланец на плите: шток выходит из втулки
  });
  const front = mk(m => {
    for (const sx of [-1, 1]) m.box(sx * R - 3.5, -R - 3.5, 0, sx * R + 3.5, -R + 3.5, top, 'd');
    m.box(-R - 4.5, -R - 4, top, R + 4.5, -R + 4, top + 7, 'm');
    m.box(-6, -R + 4, top + 1, 6, R - 4, top + 6, 'l');
  });
  const g = front.glow(null, 0, 0, top + 11, h.ph === 1 ? 9 : 4, h.ph === 1 ? '#ff4d5e' : H.col, h.ph === 1 ? (Math.sin(G.time * 28) > 0 ? 1 : 0.25) : 0.55); g.auto = true;
  return [back, ram, rod, front];
}
// пилон лазерного забора: шестигранная колонна, излучатель смотрит на пару
function pylonMesh(h, H, s) {
  const m = new Mesh(); m.zc = 0;
  const hex = [], hex2 = [];
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; hex.push([Math.cos(a) * 9, Math.sin(a) * 9]); hex2.push([Math.cos(a) * 5, Math.sin(a) * 5]); }
  m.prism(hex, 0, 4, 'z', 'd');
  m.prism(hex2, 4, 44, 'z', 'm');
  m.push(); m.t(0, 0, 40); m.rz(-h.ang + (s > 0 ? Math.PI : 0)); m.box(-3.5, -4, -4.5, 7, 4, 4.5, 'l'); m.pop();
  const on = h.ph === 2, g = m.glow(null, 0, 0, 47, on ? 6 : 3, H.col, on ? 1 : h.ph === 1 ? (Math.sin(G.time * 30) > 0 ? 0.9 : 0.2) : 0.5); g.auto = true;
  return m;
}
// решётка криовыброса: шестигранный ворот и три патрубка с вентилями
function ventMesh(h, H, view) {
  const m = new Mesh(), R = H.r * 0.42; m.zc = 0;
  m.push(); m.sc(1, floorFit(view), 1); m.rz(h.ang);
  m.cyl(R + 3, R + 2, 0, 4, 6, 'd'); m.cyl(R + 3.4, R + 3.4, 2.2, 3.2, 6, 'a');
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5, x = Math.cos(a) * (R + 6), y = Math.sin(a) * (R + 6); m.push(); m.t(x, y, 0); m.cyl(2.4, 2.4, 0, 9, 6, 'm'); m.cyl(3.2, 3.2, 9, 10.5, 6, 'l'); m.pop(); }
  m.pop();
  return m;
}
// маяк шлюза: стойка с мигающим огнём — горит, пока люк открыт или вот-вот откроется
function beaconMesh(h, H) {
  const m = new Mesh(); m.zc = 0;
  m.cyl(3, 3.4, 0, 3, 6, 'd'); m.cyl(1.6, 1.4, 3, 22, 6, 'm');
  const on = h.ph === 1 ? Math.sin(G.time * 20) > 0 : h.ph === 2;
  m.cyl(2.4, 2.4, 22, 26, 6, on ? 'a' : 'l');
  const g = m.glow(null, 0, 0, 24, on ? 7 : 3, on ? '#ff4d5e' : H.col, on ? 1 : 0.5); g.auto = true;
  return m;
}
// гейзер: кольцо камней по кромке жерла
function geyserMesh(h, H, view) {
  const m = new Mesh(); m.zc = 0;
  m.push(); m.sc(1, floorFit(view), 1);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + h.ang, rr = H.r * (0.86 + hash2(h.key, i, 7) * 0.16), hh = 6 + hash2(h.key, i, 9) * 12, w = 7 + hash2(h.key, i, 11) * 5;
    m.push(); m.t(Math.cos(a) * rr, Math.sin(a) * rr, 0); m.rz(a);
    m.prism([[-w * 0.5, -w * 0.4], [w * 0.5, -w * 0.5], [w * 0.4, w * 0.5], [-w * 0.45, w * 0.4]], 0, hh, 'z', i % 2 ? 'd' : 'm');
    m.pop();
  }
  m.pop();
  return m;
}
// мачта ретранслятора: трёхногая ферма, поворотная тарелка, маяк
function relayMesh(R) {
  const m = new Mesh(); m.zc = 0;
  const top = 76, base = [];
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; base.push([Math.cos(a) * 17, Math.sin(a) * 17]); }
  m.prism(base, 0, 5, 'z', 'd');
  const legs = [0, 1, 2].map(i => { const a = i * TAU / 3 + 0.5; return [Math.cos(a), Math.sin(a)]; });
  for (const [c, s] of legs) m.strut([c * 13, s * 13, 4], [c * 3, s * 3, top], 1.5, 1.1, 4, 'm');
  for (let k = 0; k < 3; k++) {
    const z0 = 10 + k * 21, z1 = z0 + 21, f0 = 13 - (z0 - 4) / (top - 4) * 10, f1 = 13 - (z1 - 4) / (top - 4) * 10;
    for (let i = 0; i < 3; i++) { const [c0, s0] = legs[i], [c1, s1] = legs[(i + 1) % 3]; m.strut([c0 * f0, s0 * f0, z0], [c1 * f1, s1 * f1, z1], 0.55, 0.55, 3, 'l'); }
  }
  m.push(); m.t(0, 0, top); m.rz(R.rot); m.rx(0.75);
  m.cyl(2.5, 16, 0, 5, 10, 'a');
  m.strut([0, 0, 2], [0, 0, 14], 0.6, 0.45, 3, 'l');
  const g = m.glow(null, 0, 0, 14, 4, R.st === 'idle' ? '#ffd36b' : '#46e3ff', 1); g.auto = true;
  m.pop();
  const blink = Math.sin(G.time * (R.st === 'cap' ? 14 : 5)) > 0;
  const b = m.glow(null, 0, 0, top + 4, blink ? 7 : 3, R.st === 'idle' ? '#ff4d5e' : '#46e3ff', 0.9); b.auto = true;
  return m;
}
function drawMeshAt(c, m, pal, x, y, z, e0, f0, view, alpha) {
  c.setTransform(z, 0, 0, z, x * z + e0, y * z * RENDER.k + f0);
  if (alpha !== undefined && alpha < 1) { const ga = c.globalAlpha; c.globalAlpha = ga * alpha; renderMesh(c, m, pal, view, {}); c.globalAlpha = ga; }
  else renderMesh(c, m, pal, view, {});
}
// объекты мира — в общую сортировку по глубине вместе с машинами Роя
function worldDrawables(vis) {
  const H = hazDef(), view = enemyView();
  if (H) for (const h of HZ_LIST) {
    if (h.kind === 'fence') {
      for (const s of [-1, 1]) {
        const x = s < 0 ? h.ax : h.bx, y = s < 0 ? h.ay : h.by;
        if (Math.abs(x - G.cam.x) < VIEW.hw + 60 && Math.abs(y - G.cam.y) < VIEW.hh + 90) vis.push({ dz: (c, z, e0, f0) => drawMeshAt(c, pylonMesh(h, H, s), hazPal(H.col), x, y, z, e0, f0, view), y });
      }
    } else if (h.kind === 'lock') {
      const S = H.hole * 1.25 + 9;
      for (const [sx, sy] of [[-1, -1], [1, 1]]) { const x = h.x + sx * S, y = h.y + sy * S; if (onScreen({ x, y }, 60)) vis.push({ dz: (c, z, e0, f0) => drawMeshAt(c, beaconMesh(h, H), hazPal('#8a96ff'), x, y, z, e0, f0, view), y }); }
    } else if (onScreen(h, 110)) {
      vis.push({ dz: (c, z, e0, f0) => {
        if (h.kind === 'press') { for (const m of pressMeshes(h, H, view)) drawMeshAt(c, m, hazPal('#c9a46a'), h.x, h.y, z, e0, f0, view); }
        else if (h.kind === 'vent') drawMeshAt(c, ventMesh(h, H, view), hazPal('#7fd0ff'), h.x, h.y, z, e0, f0, view);
        else drawMeshAt(c, geyserMesh(h, H, view), hazPal('#8fb83a'), h.x, h.y, z, e0, f0, view);
      }, y: h.y + (h.kind === 'press' ? 30 : 0) });
    }
  }
  for (const b of BLD_LIST) if (onScreen(b, b.ex + 60)) vis.push({ dz: (c, z, e0, f0) => drawStructure(c, b, z, e0, f0, view), y: b.y + b.ey - 2 });
  const R = G.relay;
  if (R && onScreen(R, 120)) {
    const al = R.st === 'off' ? 1 - R.doneT / 1.2 : R.t < 0.6 ? R.t / 0.6 : 1;
    vis.push({ dz: (c, z, e0, f0) => drawMeshAt(c, relayMesh(R), relayPal(R), R.x, R.y, z, e0, f0, view, al), y: R.y });
  }
}
// пол: подложки опасностей, круги предупреждения, круг захвата
function drawWorldGround(c) {
  drawStructureGround(c);
  const H = hazDef(), t = G.time;
  if (H) for (const h of HZ_LIST) {
    if (!onScreen(h, h.kind === 'fence' ? H.len / 2 + 40 : 90)) continue;
    if (h.kind === 'press') {
      const S = H.r + 6;
      c.save(); c.beginPath(); c.rect(h.x - S, h.y - S, S * 2, S * 2); c.clip();
      c.strokeStyle = rgba(H.col, 0.13); c.lineWidth = 7; c.beginPath();
      for (let k = -S * 2; k <= S * 2; k += 18) { c.moveTo(h.x - S + k, h.y - S); c.lineTo(h.x - S + k + S * 2, h.y + S); }
      c.stroke(); c.restore();
      c.strokeStyle = rgba(H.col, 0.45); c.lineWidth = 1.5; c.strokeRect(h.x - S, h.y - S, S * 2, S * 2);
      if (h.ph === 1) {
        const bl = Math.sin(t * 22) > 0 ? 1 : 0.35;
        c.fillStyle = rgba('#ff4d5e', 0.12 + 0.16 * bl); c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.fill();
        c.strokeStyle = rgba('#ff4d5e', 0.9); c.lineWidth = 2; c.stroke();
      } else if (h.ph === 2 && h.u - H.t1 < 0.35) {
        c.fillStyle = rgba(H.col, 0.4 * (1 - (h.u - H.t1) / 0.35)); c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.fill();
      } else { c.strokeStyle = rgba(H.col, 0.3); c.lineWidth = 1; c.setLineDash([5, 6]); c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.stroke(); c.setLineDash([]); }
    } else if (h.kind === 'fence') {
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(h.ax, h.ay); c.lineTo(h.bx, h.by);
      if (h.ph === 0) { c.strokeStyle = rgba(H.col, 0.22); c.lineWidth = 2; c.setLineDash([6, 8]); c.stroke(); c.setLineDash([]); }
      else if (h.ph === 1) { c.strokeStyle = rgba('#ff4d5e', Math.sin(t * 24) > 0 ? 0.55 : 0.2); c.lineWidth = H.w; c.stroke(); }
      else { c.strokeStyle = rgba(H.col, 0.3); c.lineWidth = H.w; c.stroke(); }
      c.fillStyle = rgba(H.col, 0.25);
      for (const [x, y] of [[h.ax, h.ay], [h.bx, h.by]]) { c.beginPath(); c.arc(x, y, 12, 0, TAU); c.fill(); }
    } else if (h.kind === 'vent') {
      // решётка сброса: шестигранник с прутьями, круг зоны; предупреждение — белые кольца сходятся, выброс — заливка
      const R = H.r, hr = R * 0.42;
      c.save();
      c.beginPath(); for (let i = 0; i <= 6; i++) { const a = h.ang + i * TAU / 6, px = h.x + Math.cos(a) * hr, py = h.y + Math.sin(a) * hr; i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.fillStyle = 'rgba(2,8,14,0.75)'; c.fill(); c.strokeStyle = rgba(H.col, 0.6); c.lineWidth = 1.4; c.stroke();
      c.clip(); c.strokeStyle = rgba(H.col, 0.35); c.lineWidth = 1.2; c.beginPath();
      for (let k = -hr; k <= hr; k += 6) { c.moveTo(h.x + k, h.y - hr); c.lineTo(h.x + k, h.y + hr); }
      c.stroke(); c.restore();
      if (h.ph === 0) { c.strokeStyle = rgba(H.col, 0.28); c.lineWidth = 1; c.setLineDash([4, 6]); c.beginPath(); c.arc(h.x, h.y, R, 0, TAU); c.stroke(); c.setLineDash([]); }
      else if (h.ph === 1) {
        const q = (h.u - H.t0) / (H.t1 - H.t0);
        c.strokeStyle = rgba('#ffffff', Math.sin(t * 22) > 0 ? 0.85 : 0.35); c.lineWidth = 1.6; c.beginPath(); c.arc(h.x, h.y, R, 0, TAU); c.stroke();
        c.strokeStyle = rgba(H.col, 0.7); c.lineWidth = 1.2; c.beginPath(); c.arc(h.x, h.y, R * (1 - q * 0.6), 0, TAU); c.stroke();
        c.fillStyle = rgba('#dff8ff', 0.06 + 0.1 * q); c.beginPath(); c.arc(h.x, h.y, R, 0, TAU); c.fill();
      } else { const q = 1 - (h.u - H.t1) / (H.per - H.t1); c.fillStyle = rgba('#dff8ff', 0.28 * q); c.beginPath(); c.arc(h.x, h.y, R, 0, TAU); c.fill(); c.strokeStyle = rgba('#ffffff', 0.7 * q); c.lineWidth = 1.2; c.stroke(); }
    } else if (h.kind === 'lock') {
      // люк шлюза: рама с полосами опасности, створки разъезжаются, в проёме — космос; круг тяги
      const S = H.hole * 1.25, open = h.ph === 2 ? clamp((h.u - H.t1) / 0.25, 0, 1) * clamp((H.per - h.u) / 0.2, 0, 1) : 0;
      c.save(); c.beginPath(); c.rect(h.x - S - 9, h.y - S - 9, (S + 9) * 2, (S + 9) * 2); c.rect(h.x - S, h.y - S, S * 2, S * 2); c.clip('evenodd');
      c.fillStyle = 'rgba(6,6,10,0.85)'; c.fillRect(h.x - S - 9, h.y - S - 9, (S + 9) * 2, (S + 9) * 2);
      const blink = h.ph === 1 && Math.sin(t * 20) > 0;
      c.strokeStyle = rgba(blink ? '#ff4d5e' : H.col, blink ? 0.9 : 0.5); c.lineWidth = 4; c.beginPath();
      for (let k = -S * 3; k <= S * 3; k += 10) { c.moveTo(h.x - S - 9 + k, h.y - S - 9); c.lineTo(h.x - S - 9 + k + (S + 9) * 2, h.y + S + 9); }
      c.stroke(); c.restore();
      c.fillStyle = '#000000'; c.fillRect(h.x - S, h.y - S, S * 2, S * 2);
      if (open > 0) { c.fillStyle = '#ffffff'; for (let i = 0; i < 14; i++) { const sx = h.x - S + hash2(h.key, i, 1) * S * 2, sy = h.y - S + hash2(h.key, i, 2) * S * 2; c.globalAlpha = open * (0.3 + hash2(h.key, i, 3) * 0.7); c.fillRect(sx, sy, 1, 1); } c.globalAlpha = 1; }
      const w = S * (1 - open);
      c.fillStyle = '#121624'; c.strokeStyle = rgba(H.col, 0.7); c.lineWidth = 1;
      c.fillRect(h.x - S, h.y - S, w, S * 2); c.strokeRect(h.x - S, h.y - S, w, S * 2);
      c.fillRect(h.x + S - w, h.y - S, w, S * 2); c.strokeRect(h.x + S - w, h.y - S, w, S * 2);
      c.strokeStyle = rgba(H.col, 0.6); c.lineWidth = 1.4; c.strokeRect(h.x - S, h.y - S, S * 2, S * 2);
      if (h.ph >= 1) { c.strokeStyle = rgba(H.col, h.ph === 2 ? 0.4 : 0.22); c.lineWidth = 1; c.setLineDash([6, 8]); c.lineDashOffset = t * (h.ph === 2 ? 40 : 10); c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.stroke(); c.setLineDash([]); }
    } else {
      const g = c.createRadialGradient(h.x, h.y, 2, h.x, h.y, H.r);
      g.addColorStop(0, rgba(H.col, h.ph === 2 ? 0.55 : h.ph === 1 ? 0.32 : 0.16)); g.addColorStop(0.45, rgba('#0b1a04', 0.75)); g.addColorStop(1, rgba('#050a02', 0.2));
      c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.fill();
      c.strokeStyle = rgba(H.col, 0.35); c.lineWidth = 1.2; c.stroke();
      if (h.ph === 1) {
        const q = (h.u - H.t0) / (H.t1 - H.t0);
        c.strokeStyle = rgba('#ff4d5e', Math.sin(t * 22) > 0 ? 0.9 : 0.4); c.lineWidth = 2; c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.stroke();
        c.strokeStyle = rgba(H.col, 0.6); c.lineWidth = 2; c.beginPath(); c.arc(h.x, h.y, H.r * q, 0, TAU); c.stroke();
      } else if (h.ph === 2) { c.fillStyle = rgba(H.col, 0.2 + Math.sin(t * 30) * 0.05); c.beginPath(); c.arc(h.x, h.y, H.r, 0, TAU); c.fill(); }
    }
  }
  const R = G.relay;
  if (R && onScreen(R, RELAY.r + 20)) {
    const fade = R.st === 'off' ? 1 - R.doneT / 1.2 : R.st === 'done' ? Math.max(0, 1 - R.doneT / 2) : Math.min(1, R.t / 0.6);
    const col = R.st === 'idle' ? '#ffd36b' : '#46e3ff';
    c.globalAlpha = fade;
    c.fillStyle = rgba(col, R.st === 'cap' ? 0.08 + Math.sin(t * 8) * 0.03 : 0.05); c.beginPath(); c.arc(R.x, R.y, RELAY.r, 0, TAU); c.fill();
    c.strokeStyle = rgba(col, 0.6); c.lineWidth = 2; c.setLineDash([10, 8]); c.lineDashOffset = -t * 24;
    c.beginPath(); c.arc(R.x, R.y, RELAY.r, 0, TAU); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
    if (R.prog > 0) { c.strokeStyle = '#46e3ff'; c.lineWidth = 5; c.lineCap = 'butt'; c.beginPath(); c.arc(R.x, R.y, RELAY.r, -Math.PI / 2, -Math.PI / 2 + R.prog * TAU); c.stroke(); }
    if (R.st === 'idle' || R.st === 'cap') { const left = clamp(1 - R.t / RELAY.life, 0, 1); c.strokeStyle = rgba('#ffd36b', 0.45); c.lineWidth = 1.5; c.beginPath(); c.arc(R.x, R.y, RELAY.r + 7, -Math.PI / 2, -Math.PI / 2 + left * TAU); c.stroke(); }
    c.globalAlpha = 1;
  }
}
// свечение поверх машин: лучи заборов, столбы кислоты, связь с ретранслятором
function drawWorldGlow(c) {
  const H = hazDef(), t = G.time, cp = viewCp(enemyView()) / RENDER.k;
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  if (H) for (const h of HZ_LIST) {
    if (h.kind === 'fence' && h.ph >= 1) {
      if (!onScreen(h, H.len / 2 + 40)) continue;
      const hz = 40 * cp;
      if (h.ph === 1) {
        if (Math.random() < 0.55) { c.strokeStyle = rgba(H.col, rand(0.15, 0.45)); c.lineWidth = 1; c.beginPath(); c.moveTo(h.ax, h.ay - hz); c.lineTo(h.bx, h.by - hz); c.stroke(); }
        continue;
      }
      const fl = 0.85 + Math.sin(t * 60 + h.key) * 0.15;
      c.fillStyle = rgba(H.col, 0.1 * fl); c.beginPath(); c.moveTo(h.ax, h.ay); c.lineTo(h.bx, h.by); c.lineTo(h.bx, h.by - hz); c.lineTo(h.ax, h.ay - hz); c.closePath(); c.fill();
      c.strokeStyle = rgba(H.col, 0.75 * fl); c.lineWidth = 6; c.beginPath(); c.moveTo(h.ax, h.ay - hz); c.lineTo(h.bx, h.by - hz); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.8; c.stroke();
      c.strokeStyle = rgba(H.col, 0.55 * fl); c.lineWidth = 3; c.beginPath(); c.moveTo(h.ax, h.ay); c.lineTo(h.bx, h.by); c.stroke();
    } else if (h.kind === 'vent' && h.ph === 2) {
      if (!onScreen(h, 160)) continue;
      const k = Math.min(1, (h.u - H.t1) / 0.12) * Math.min(1, (H.per - h.u) / 0.4), top = 150 * cp + 30;
      const g = c.createLinearGradient(0, h.y, 0, h.y - top);
      g.addColorStop(0, rgba('#dff8ff', 0.5 * k)); g.addColorStop(0.6, rgba('#9ff0ff', 0.18 * k)); g.addColorStop(1, rgba('#9ff0ff', 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(h.x - 26, h.y); c.lineTo(h.x - 44 + Math.sin(t * 7) * 5, h.y - top); c.lineTo(h.x + 44 + Math.sin(t * 6) * 5, h.y - top); c.lineTo(h.x + 26, h.y); c.closePath(); c.fill();
      c.strokeStyle = rgba('#ffffff', 0.5 * k); c.lineWidth = 1; c.beginPath();
      for (let i = 0; i < 5; i++) { const x = h.x - 20 + i * 10 + Math.sin(t * 9 + i) * 3; c.moveTo(x, h.y - 4); c.lineTo(x * 1 + Math.sin(i) * 8, h.y - top * (0.5 + 0.1 * i)); }
      c.stroke();
    } else if (h.kind === 'geyser' && h.ph === 2) {
      if (!onScreen(h, 160)) continue;
      const k = Math.min(1, (h.u - H.t1) / 0.15) * Math.min(1, (H.per - h.u) / 0.3), top = 170 * cp + 40;
      const g = c.createLinearGradient(0, h.y, 0, h.y - top);
      g.addColorStop(0, rgba(H.col, 0.55 * k)); g.addColorStop(0.6, rgba(H.col, 0.22 * k)); g.addColorStop(1, rgba(H.col, 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(h.x - 22, h.y); c.lineTo(h.x - 36 + Math.sin(t * 9) * 4, h.y - top); c.lineTo(h.x + 36 + Math.sin(t * 7) * 4, h.y - top); c.lineTo(h.x + 22, h.y); c.closePath(); c.fill();
      c.fillStyle = rgba('#f4ffd8', 0.3 * k); c.beginPath(); c.moveTo(h.x - 7, h.y); c.lineTo(h.x - 10, h.y - top * 0.8); c.lineTo(h.x + 10, h.y - top * 0.8); c.lineTo(h.x + 7, h.y); c.closePath(); c.fill();
    }
  }
  const R = G.relay;
  if (R && (R.st === 'cap' || R.st === 'done')) {
    const tz = 80 * cp;
    if (R.st === 'cap') {
      c.strokeStyle = rgba('#46e3ff', 0.55); c.lineWidth = 1.5; c.setLineDash([4, 6]); c.lineDashOffset = -t * 60;
      c.beginPath(); c.moveTo(P.x, P.y - upY(20)); c.lineTo(R.x, R.y - tz); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
      c.strokeStyle = rgba('#46e3ff', 0.2 + R.prog * 0.4); c.lineWidth = 2 + R.prog * 4; c.beginPath(); c.moveTo(R.x, R.y - tz); c.lineTo(R.x, R.y - tz - 120 * R.prog); c.stroke();
    } else {
      const k = Math.max(0, 1 - R.doneT / 3);
      c.strokeStyle = rgba('#46e3ff', 0.7 * k); c.lineWidth = 16 * k + 2; c.beginPath(); c.moveTo(R.x, R.y - tz); c.lineTo(R.x, R.y - tz - 900); c.stroke();
      c.strokeStyle = rgba('#ffffff', 0.8 * k); c.lineWidth = 3; c.stroke();
    }
  }
  c.restore();
}
