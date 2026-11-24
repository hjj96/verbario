'use strict';
/* ===== Рой: появление волн, поведение врагов, боссы, вражеские снаряды ===== */

function minutes() { return G.time / 60; }
function enemyHpMul() {
  const m = minutes();
  let k = G.sector.hp * (1 + G.threat * 0.15) * (1 + 0.08 * m + 0.032 * m * m);
  if (m > 20) k *= Math.pow(1.1, m - 20);
  return k;
}
function newStatus() { return { burn: 0, burnT: 0, burnTick: 0, burnSrc: null, chill: 0, chillT: 0, frost: 0, freezeT: 0, stunT: 0, corr: 0, corrT: 0, markT: 0 }; }
function spawnEnemy(tid, x, y, o) {
  const T = ENEMIES[tid], m = minutes(), A = T.prop ? 1 : (G.alert || 1);
  const hp = T.hp * (T.prop ? 1 : enemyHpMul()) * A;
  const e = {
    id: ++G.eid, tid, T, x, y, vx: 0, vy: 0, kbx: 0, kby: 0, r: T.r, hp, maxHp: hp,
    spd: T.spd * G.sector.spd * (1 + Math.min(0.25, m * 0.007)) * (1 + G.threat * 0.03) * (1 + Math.max(0, A - 1) * 0.06) * rand(0.92, 1.08), xpK: Math.sqrt(Math.max(1, A)),
    dmg: T.dmg * (1 + m * 0.035) * (1 + Math.max(0, A - 1) * 0.1), xp: T.xp, alive: true, flash: 0, t: 0, face: 1, anim: rand(0, 10),
    st: newStatus(), ai: {}, elite: false, boss: false, icd: null, shieldT: 0, phased: false, scale: 1,
  };
  if (o && o.elite) { e.elite = true; e.r *= 1.4; e.scale = 1.4; e.hp *= 9; e.maxHp = e.hp; e.dmg *= 1.5; e.xp *= 1; }
  if (o && o.ai) e.ai = o.ai;
  if (!T.prop) rollVariant(e, o);
  G.enemies.push(e);
  if (!T.prop) discover('enemies', tid);
  return e;
}
function spawnPoint(margin) {
  const m = margin || 60, hw = VIEW.hw + m, hh = VIEW.hh + m;
  const L1 = 2 * hw, L2 = 2 * hh;
  let r = Math.random() * 2 * (L1 + L2);
  if (r < L1) return { x: P.x - hw + r, y: P.y - hh };
  r -= L1; if (r < L1) return { x: P.x - hw + r, y: P.y + hh };
  r -= L1; if (r < L2) return { x: P.x - hw, y: P.y - hh + r };
  r -= L2; return { x: P.x + hw, y: P.y - hh + r };
}
function weightedKey(pool) {
  let tot = 0; for (const k in pool) tot += pool[k];
  let r = Math.random() * tot;
  for (const k in pool) { r -= pool[k]; if (r <= 0) return k; }
  return Object.keys(pool)[0];
}
const GROUP = { bug: [3, 5], kami: [2, 3], mini: [3, 4], splitter: [1, 2], blinker: [1, 2] };
function spawnGroup(pool) {
  let tid = weightedKey(pool);
  // на высокой тревоге Рой отвечает огнём издалека: пули достают даже ту сборку, что выкашивает всё вблизи
  const A = G.alert || 1;
  if (A >= 2.6 && G.time > 240 && Math.random() < Math.min(0.3, (A - 2.6) * 0.15 + 0.1)) tid = Math.random() < 0.6 ? 'gunner' : 'spitter';
  const g = GROUP[tid] || [1, 2];
  const n = randi(g[0], g[1]);
  const p = spawnPoint();
  for (let i = 0; i < n; i++) spawnEnemy(tid, p.x + rand(-20, 20), p.y + rand(-20, 20));
  return n;
}

/* ---------- Режиссёр волн ---------- */
function currentWave() {
  const m = Math.floor(minutes());
  if (m < WAVES.length) return WAVES[m];
  return { rate: 38 + (m - 20) * 1.5, cap: 540, pool: ENDLESS_POOL };
}
function director(dt) {
  const t = G.time, m = Math.floor(t / 60);
  const W = currentWave();
  const N = m + 1 < WAVES.length ? WAVES[m + 1] : W;
  const f = (t % 60) / 60;
  const A = G.alert || 1;
  const rate = lerp(W.rate, N.rate, f) * G.sector.rate * (1 + G.threat * 0.08) * (G.bossesAlive ? 0.55 : 1) * (A > 1 ? 1 + (A - 1) * 0.35 : 1);
  const cap = Math.min(600, W.cap * (1 + G.threat * 0.05) * (FX.quality < 1 ? 0.75 : 1) * (A > 1 ? Math.min(1.3, 1 + (A - 1) * 0.12) : 1));
  let alive = 0;
  for (const e of G.enemies) if (e.alive && !e.T.prop && !e.boss && !e.parent) alive++;
  G.spawnAcc += rate * dt * (alive < cap * 0.25 && t > 4 ? 1.6 : 1);
  if (G.freezeT > 0) G.spawnAcc = Math.min(G.spawnAcc, 1);
  let guard = 0;
  while (G.spawnAcc >= 1 && alive < cap && guard++ < 20) { const n = spawnGroup(W.pool); G.spawnAcc -= n; alive += n; }
  if (G.spawnAcc > 8) G.spawnAcc = 8;
  // элитные
  if (G.eliteIdx < ELITE_TIMES.length && t >= ELITE_TIMES[G.eliteIdx]) { G.eliteIdx++; spawnElite(W.pool); }
  if (t > RUN_LENGTH) { G.nextEliteEndless -= dt; if (G.nextEliteEndless <= 0) { G.nextEliteEndless = 40; spawnElite(W.pool); } }
  // на высокой тревоге элита выходит сверх расписания
  if (A >= 2 && !G.bossesAlive) { G.alertEliteT -= dt; if (G.alertEliteT <= 0) { G.alertEliteT = A >= 3 ? 28 : 42; spawnElite(W.pool); } }
  // удары Роя по координатам и десант — угроза, которую не перебить огнём
  if (A >= 1.7 && t > 90) {
    G.strikeT = (G.strikeT === undefined ? 10 : G.strikeT) - dt;
    if (G.strikeT <= 0) { G.strikeT = rand(10, 16) / Math.min(2, A / 1.7); swarmStrike(Math.min(8, 2 + Math.floor(A * 1.2))); }
  }
  if (A >= 2.3 && t > 120 && !G.bossesAlive) {
    G.podT = (G.podT === undefined ? 14 : G.podT) - dt;
    if (G.podT <= 0) { G.podT = rand(16, 24) / Math.min(1.6, A / 2.3); dropPod(W.pool); }
  }
  // лейтенанты Роя между боссами
  if (G.ltIdx < LIEUTENANT_TIMES.length && t >= LIEUTENANT_TIMES[G.ltIdx]) { G.ltIdx++; spawnLieutenant(W.pool); }
  // события
  if (G.eventIdx < EVENTS.length && t >= EVENTS[G.eventIdx].t) { runEvent(EVENTS[G.eventIdx].kind); G.eventIdx++; }
  // боссы
  const SCH = G.schedule || BOSS_SCHEDULE;
  if (G.bossIdx < SCH.length && t >= SCH[G.bossIdx].t) { const b = SCH[G.bossIdx]; G.bossIdx++; spawnBoss(b.id, b.final); }
  if (G.endless && !G.bossesAlive) { G.endlessBossT = (G.endlessBossT === undefined ? 120 : G.endlessBossT) - dt; if (G.endlessBossT <= 0) { G.endlessBossT = 150; spawnBoss(pick(['hammer', 'hive', 'serpent', 'reaper', 'arachna']), false); } }
  // контейнеры снабжения
  G.propT -= dt;
  if (G.propT <= 0) {
    G.propT = rand(16, 26);
    let props = 0; for (const e of G.enemies) if (e.alive && e.T.prop) props++;
    if (props < 4) { const a = rand(0, TAU), d = rand(300, 560); spawnEnemy('prop', P.x + Math.cos(a) * d, P.y + Math.sin(a) * d); }
  }
  if (G.freezeT > 0) G.freezeT -= dt;
}
// свойство элиты (броня, разгон, матка, нестабильность) и его следствия; plain — без свойства
function eliteSetup(e, plain) {
  const af = plain ? null : pick(Object.keys(ELITE_AFFIX));
  e.affix = af;
  if (af === 'armored') e.armored = true;
  else if (af === 'overclock') { e.spd *= 1.55; e.hp *= 0.8; e.maxHp = e.hp; }
  else if (af === 'brood') e.ai.brood = 2.5;
  return af;
}
function spawnElite(pool) {
  const keys = Object.keys(pool).filter(k => k !== 'bug' && k !== 'kami' && k !== 'mini');
  const tid = keys.length ? pick(keys) : 'tank';
  const p = spawnPoint();
  const e = spawnEnemy(tid, p.x, p.y, { elite: true });
  // первая элита — без свойства, дальше — со случайным
  const af = eliteSetup(e, G.eliteIdx <= 1 && !G.endless);
  UI.banner('ЭЛИТНЫЙ ВРАГ', (af ? ELITE_AFFIX[af].name + ' ' + ENEMIES[tid].name.toLowerCase() + ' · ' + ELITE_AFFIX[af].d.toLowerCase() : ENEMIES[tid].name + ' · внутри контейнер'), 'gold');
  AUDIO.sfx('elite');
}
// удар по координатам: круги вокруг игрока и чуть впереди по ходу — через 1,3 с взрываются
function swarmStrike(n) {
  const lead = 0.8, base = minutes();
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), r = i === 0 ? 0 : rand(40, 150);
    const x = P.x + P.vx * lead + Math.cos(a) * r, y = P.y + P.vy * lead + Math.sin(a) * r;
    warnCircle(x, y, 58, 1.3 + i * 0.12, w => { FX.explosion(w.x, w.y, 58, '#ff4d5e', true); FX.addShake(3); AUDIO.sfx('boom'); if (d2(w.x, w.y, P.x, P.y) < (w.r + P.r * 0.5) ** 2) hurtPlayer(12 + base * 1.6, null); });
  }
  AUDIO.sfx('warn');
}
// десант: кольцо машин высаживается вокруг игрока (кольцо разметки предупреждает)
function dropPod(pool) {
  const n = randi(7, 10), R = rand(120, 170), off = rand(0, TAU), keys = Object.keys(pool).filter(k => k !== 'kami');
  for (let i = 0; i < n; i++) {
    const a = off + i * TAU / n, x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
    later(0.8, () => { if (G.state === 'play') spawnEnemy(keys.length ? pick(keys) : 'bug', x, y); });
  }
  G.warns.push({ kind: 'c', x: P.x, y: P.y, r: R, t: 0, dur: 0.8, fn: null });
  UI.banner('ДЕСАНТ РОЯ', 'Кольцо смыкается — прорывайтесь', 'red');
}
// лейтенант Роя: огромная элита со свойством, ударной волной и подкреплением на половине прочности
function spawnLieutenant(pool) {
  const heavy = ['tank', 'charger', 'gunner', 'shielder', 'spitter', 'eater'], keys = Object.keys(pool).filter(k => heavy.includes(k));
  const tid = keys.length ? pick(keys) : pick(['tank', 'charger']);
  const a = rand(0, TAU), d = Math.min(VIEW.hw, VIEW.hh) * 0.75 + 60;
  const e = spawnEnemy(tid, P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, { elite: true });
  e.lt = true; e.r = ENEMIES[tid].r * 2.1; e.scale = 2.1; e.hp *= 3.2; e.dmg *= 1.25; e.xpK = (e.xpK || 1) * 2;
  if ((G.alert || 1) < 1.05) e.hp = Math.min(e.hp, Math.max(e.hp * 0.3, (G.dps || 0) * 25 * 0.5));
  e.maxHp = e.hp;
  e.affix = pick(Object.keys(ELITE_AFFIX));
  if (e.affix === 'armored') e.armored = true; else if (e.affix === 'overclock') e.spd *= 1.3; else if (e.affix === 'brood') e.ai.brood = 3;
  e.ai.wave = 3; e.ai.called = false;
  UI.banner('ЛЕЙТЕНАНТ РОЯ', ELITE_AFFIX[e.affix].name + ' ' + ENEMIES[tid].name.toLowerCase() + ' · ударные волны, зовёт подкрепление', 'gold');
  AUDIO.sfx('elite'); AUDIO.sfx('warn');
}
// поведение свойств элиты, работающее поверх обычного ИИ
function eliteTick(e, dt) {
  if (e.lt) {
    // лейтенант тоже не тает за секунду: адаптивная броня под бой ~25 с
    e.fightT = (e.fightT || 0) + dt;
    e.bossK = paceBoss(e, dt, 25, 0.05);
    e.ai.wave -= dt;
    if (e.ai.wave <= 0 && onScreen(e, 60)) { e.ai.wave = 4.2; radial(e, 14, 125, e.dmg * 0.45, rand(0, TAU), '#ffd36b'); FX.ring(e.x, e.y, 10, e.r * 3, 0.4, '#ffd36b', 4); AUDIO.sfx('thump'); }
    if (!e.ai.called && e.hp < e.maxHp * 0.5) { e.ai.called = true; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; spawnEnemy(pick(['bug', 'mini', 'kami']), e.x + Math.cos(a) * e.r * 2, e.y + Math.sin(a) * e.r * 2); } FX.ring(e.x, e.y, 10, e.r * 4, 0.5, '#ff4d5e', 5); }
  }
  if (e.affix === 'brood') {
    e.ai.brood -= dt;
    if (e.ai.brood <= 0 && onScreen(e, 120)) {
      e.ai.brood = 5;
      const kid = minutes() > 8 ? 'mini' : 'bug';
      for (let i = 0; i < 3; i++) { const a = rand(0, TAU); spawnEnemy(kid, e.x + Math.cos(a) * e.r * 1.6, e.y + Math.sin(a) * e.r * 1.6); }
      FX.ring(e.x, e.y, 6, e.r * 3, 0.4, '#8dff6a', 3); AUDIO.sfx('thump');
    }
  } else if (e.affix === 'overclock' && Math.random() < 0.5 && (Math.abs(e.vx) + Math.abs(e.vy)) > 20) {
    FX.dot(e.x + rand(-e.r, e.r) * 0.4, e.y + rand(-e.r, e.r) * 0.3, 0, 0, 0.35, e.r * 0.7, '#ff5a3a', 0);
  }
}
function runEvent(kind) {
  if (kind === 'ring') {
    const n = 26, R = Math.max(VIEW.hw, VIEW.hh) * 0.85 + 40;
    const tid = minutes() > 8 ? 'tank' : 'bug';
    for (let i = 0; i < n; i++) { const a = i * TAU / n; spawnEnemy(tid, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R); }
    UI.banner('ОКРУЖЕНИЕ', 'Прорывайтесь рывком', 'red');
    AUDIO.sfx('elite');
  } else if (kind === 'rush') {
    const a = rand(0, TAU), dx = Math.cos(a), dy = Math.sin(a);
    const R = Math.max(VIEW.hw, VIEW.hh) + 120;
    const cx = P.x - dx * R, cy = P.y - dy * R;
    const tid = minutes() > 10 ? 'mini' : 'bug';
    for (let i = 0; i < 36; i++) {
      const off = rand(-160, 160), back = rand(0, 260);
      spawnEnemy(tid, cx - dy * off - dx * back, cy + dx * off - dy * back, { ai: { rush: true, dx, dy, life: 9 } });
    }
    UI.banner('РОЙ-ПОТОК', 'Уходите с линии!', 'red');
    AUDIO.sfx('warn');
  }
}

/* ---------- Поведение ---------- */
function steer(e, tx, ty, k) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
  e.vx = dx / d * e.spd * k; e.vy = dy / d * e.spd * k;
  return d;
}
function eBullet(x, y, a, spd, dmg, o) {
  const b = { x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 5, dmg, life: 4, col: '#ff4f9a', kind: 'b' };
  if (o) for (const k in o) b[k] = o[k];
  G.ebullets.push(b);
  return b;
}
const AI = {
  chase(e, dt) { steer(e, P.x, P.y, 1); },
  none(e) { e.vx = 0; e.vy = 0; },
  kami(e, dt) {
    const a = e.ai;
    if (a.fuse !== undefined) {
      a.fuse -= dt; e.vx = 0; e.vy = 0;
      if (a.fuse <= 0) {
        e.alive = false;
        FX.explosion(e.x, e.y, 34, '#ff3b3b'); AUDIO.sfx('boom');
        if (d2(e.x, e.y, P.x, P.y) < 54 * 54) hurtPlayer(e.dmg, null);
      }
      return;
    }
    const d = steer(e, P.x, P.y, 1);
    if (d < 36) { a.fuse = 0.45; }
  },
  ranged(e, dt) {
    const a = e.ai, d = Math.sqrt(d2(e.x, e.y, P.x, P.y));
    if (d > 250) steer(e, P.x, P.y, 1);
    else if (d < 170) steer(e, P.x, P.y, -0.8);
    else { const ang = Math.atan2(P.y - e.y, P.x - e.x) + Math.PI / 2; e.vx = Math.cos(ang) * e.spd * 0.5; e.vy = Math.sin(ang) * e.spd * 0.5; }
    a.cd = (a.cd === undefined ? rand(1, 2.5) : a.cd) - dt;
    if (a.cd <= 0 && d < 430) {
      a.cd = rand(2.2, 2.9);
      const mz = enemyMuzzle(e);
      eBullet(mz.x, mz.y, Math.atan2(P.y - mz.y, P.x - mz.x), 165, e.dmg, { col: '#ff5fd2' });
      FX.sparks(mz.x, mz.y, 3, '#ff9ae6', 120, undefined, 0, 0.18);
    }
  },
  charger(e, dt) {
    const a = e.ai;
    a.cd = (a.cd === undefined ? rand(1, 2) : a.cd) - dt;
    if (!a.s) a.s = 'walk';
    if (a.s === 'walk') {
      const d = steer(e, P.x, P.y, 1);
      if (d < 290 && a.cd <= 0) { a.s = 'wind'; a.t = 0.7; a.ang = Math.atan2(P.y - e.y, P.x - e.x); }
    } else if (a.s === 'wind') {
      e.vx = 0; e.vy = 0; a.t -= dt;
      a.ang += clamp(angDiff(a.ang, Math.atan2(P.y - e.y, P.x - e.x)), -2 * dt, 2 * dt);
      if (a.t <= 0) { a.s = 'dash'; a.t = 0.5; }
    } else if (a.s === 'dash') {
      e.vx = Math.cos(a.ang) * 430; e.vy = Math.sin(a.ang) * 430; a.t -= dt;
      if (Math.random() < 0.5) FX.dot(e.x, e.y, 0, 0, 0.25, e.r, e.T.acc, 0);
      if (a.t <= 0) { a.s = 'rest'; a.t = 0.6; }
    } else { e.vx = 0; e.vy = 0; a.t -= dt; if (a.t <= 0) { a.s = 'walk'; a.cd = rand(2.2, 3.4); } }
  },
  shielder(e, dt) {
    steer(e, P.x, P.y, 0.9);
    const a = e.ai;
    a.t = (a.t || 0) - dt;
    if (a.t <= 0) { a.t = 0.25; eachEnemyIn(e.x, e.y, 95, n => { if (n !== e && !n.boss) n.shieldT = 0.35; }); }
  },
  medic(e, dt) {
    const a = e.ai, d = Math.sqrt(d2(e.x, e.y, P.x, P.y));
    if (d < 190) steer(e, P.x, P.y, -0.9); else if (d > 260) steer(e, P.x, P.y, 1);
    else { const ang = Math.atan2(P.y - e.y, P.x - e.x) - Math.PI / 2; e.vx = Math.cos(ang) * e.spd * 0.6; e.vy = Math.sin(ang) * e.spd * 0.6; }
    a.cd = (a.cd === undefined ? 1 : a.cd) - dt;
    if (a.cd <= 0) {
      a.cd = 1.2;
      let n = 0;
      eachEnemyIn(e.x, e.y, 120, o => {
        if (o === e || o.boss || o.hp >= o.maxHp || n > 6) return;
        n++; o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.1);
        FX.beam(e.x, e.y, o.x, o.y, 1, 0.25, '#5dff9b');
      });
      if (n) FX.ring(e.x, e.y, 4, 30, 0.3, '#5dff9b', 2);
    }
  },
  blinker(e, dt) {
    const a = e.ai;
    a.cd = (a.cd === undefined ? rand(2, 4) : a.cd) - dt;
    if (a.fade > 0) {
      a.fade -= dt; e.vx = 0; e.vy = 0;
      if (a.fade <= 0) {
        const an = rand(0, TAU), d = rand(85, 135);
        FX.burst(e.x, e.y, 6, e.T.acc, 120, 0.3, 4);
        e.x = P.x + Math.cos(an) * d; e.y = P.y + Math.sin(an) * d;
        e.phased = false; a.cd = rand(3, 4.5);
        FX.burst(e.x, e.y, 8, e.T.acc, 140, 0.35, 5); FX.ring(e.x, e.y, 2, 24, 0.25, e.T.acc, 2);
      }
      return;
    }
    steer(e, P.x, P.y, 1);
    if (a.cd <= 0 && d2(e.x, e.y, P.x, P.y) > 120 * 120) { a.fade = 0.3; e.phased = true; }
  },
  eater(e, dt) {
    const a = e.ai;
    a.scan = (a.scan || 0) - dt;
    if (a.scan <= 0) {
      a.scan = 0.5; a.gem = null;
      let bd = 330 * 330;
      for (const g of G.gems) { const d = d2(e.x, e.y, g.x, g.y); if (d < bd && !g.mag) { bd = d; a.gem = g; } }
    }
    const g = a.gem;
    if (g && !g.dead && !g.mag) {
      const d = steer(e, g.x, g.y, 1.1);
      if (d < e.r + 4) {
        e.ate = (e.ate || 0) + g.v;
        const i = G.gems.indexOf(g); if (i >= 0) removeAt(G.gems, i);
        g.dead = true; a.gem = null;
        e.r = Math.min(e.T.r * 1.8, e.r + 0.35); e.scale = e.r / e.T.r;
        e.hp = Math.min(e.maxHp * 2, e.hp + e.maxHp * 0.05);
        FX.burst(e.x, e.y, 3, '#b38bff', 60, 0.25, 4);
      }
    } else steer(e, P.x, P.y, 0.9);
  },
  spitter(e, dt) {
    const a = e.ai, d = Math.sqrt(d2(e.x, e.y, P.x, P.y));
    if (d > 230) steer(e, P.x, P.y, 1); else if (d < 150) steer(e, P.x, P.y, -0.8);
    else { e.vx *= 0.9; e.vy *= 0.9; }
    a.cd = (a.cd === undefined ? rand(1.5, 3) : a.cd) - dt;
    if (a.cd <= 0 && d < 340) {
      a.cd = rand(2.8, 3.6);
      const tx = P.x + P.vx * 0.5, ty = P.y + P.vy * 0.5, mz = enemyMuzzle(e);
      G.ebullets.push({ x: mz.x, y: mz.y, sx: mz.x, sy: mz.y, tx, ty, t: 0, dur: 0.8, vx: 0, vy: 0, r: 5, dmg: e.dmg, life: 0.8, col: '#c6ff3d', kind: 'glob' });
      FX.burst(mz.x, mz.y, 4, '#c6ff3d', 80, 0.25, 3);
    }
  },
  // гнездо: раз в 2,6 с раскрывает лепестки и выпускает машины текущей волны (не больше cap живых «детей»);
  // через 45 с созревает — выпускает чаще и раз в 16 с добавляет элиту
  nest(e, dt) {
    e.vx = e.vy = 0; e.kbx = e.kby = 0;
    const a = e.ai;
    a.age = (a.age || 0) + dt;
    if (a.open > 0) a.open -= dt;
    if (!a.mature && a.age > 45) {
      a.mature = true; a.eT = 4;
      FX.hexRing(e.x, bodyY(e), 6, 60, 0.5, '#ffd36b', 2); AUDIO.sfx('warn');
      if (onScreen(e, 0)) FX.text(e.x, e.y - 56, 'ГНЕЗДО СОЗРЕЛО', '#ffd36b', 12);
    }
    a.cd = (a.cd === undefined ? 1.2 : a.cd) - dt;
    if (a.mature) a.eT -= dt;
    if (a.cd > 0 && !(a.mature && a.eT <= 0)) return;
    let kids = 0;
    for (const k of G.enemies) if (k.alive && k.nest === e) kids++;
    if (kids >= a.cap) { a.cd = 0.8; return; }
    const elite = a.mature && a.eT <= 0, n = elite ? 1 : 2 + Math.min(3, Math.floor(minutes() / 4)), W = currentWave(), y0 = bodyY(e);
    for (let i = 0; i < n; i++) {
      const an = rand(0, TAU), d = e.r + 12;
      const k = spawnEnemy(elite ? pick(['tank', 'charger', 'gunner']) : weightedKey(W.pool), e.x + Math.cos(an) * d, e.y + Math.sin(an) * d, elite ? { elite: true } : undefined);
      if (elite) eliteSetup(k);
      k.nest = e; k.kbx = Math.cos(an) * 160; k.kby = Math.sin(an) * 160;
    }
    if (elite) a.eT = 16; else a.cd = a.mature ? 1.7 : 2.6;
    a.open = 0.6;
    FX.hexRing(e.x, y0, 4, 34, 0.3, '#ff3b5c', 1.4); FX.sparks(e.x, y0, 8, '#ffb0bb', 200, undefined, 0, 0.3);
    if (onScreen(e, 40)) AUDIO.sfx('thump');
  },
  // кладка: отсчитывает до вылупления; разбили раньше — выводка нет
  egg(e, dt) {
    e.vx = e.vy = 0;
    e.ai.h = (e.ai.h === undefined ? 2.4 : e.ai.h) - dt;
    if (e.ai.h <= 0) {
      e.alive = false;
      for (let i = 0; i < 3; i++) { const a = rand(0, TAU); spawnEnemy(minutes() > 9 ? 'mini' : 'bug', e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10); }
      FX.burst(e.x, e.y, 8, '#c6ff3d', 120, 0.35, 4); AUDIO.sfx('thump');
    }
  },
  rush(e, dt) {
    const a = e.ai;
    e.vx = a.dx * e.spd * 1.6; e.vy = a.dy * e.spd * 1.6;
    a.life -= dt;
    if (a.life <= 0) e.alive = false;
  },
};

function updateEnemies(dt) {
  const frozen = G.freezeT > 0;
  const far = Math.max(VIEW.hw, VIEW.hh) + 420;
  const arr = G.enemies;
  const sepOdd = (Math.floor(G.time * 60) & 1);
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e.alive) { removeAt(arr, i); continue; }
    e.t += dt;
    if (e.flash > -1) e.flash -= dt;
    if (e.shieldT > 0) e.shieldT -= dt;
    const s = e.st;
    if (s.burnT > 0) {
      s.burnT -= dt; s.burnTick -= dt;
      if (s.burnTick <= 0) { s.burnTick = 0.5; hitEnemy(e, s.burn * 0.5, { src: 'burn', nocrit: true }); if (!e.alive) { removeAt(arr, i); continue; } }
      if (Math.random() < 0.15) FX.dot(e.x + rand(-e.r, e.r) * 0.6, e.y - e.r * 0.3, 0, -50, 0.35, rand(3, 5), '#ff7a2e', 1);
    }
    if (s.chillT > 0) { s.chillT -= dt; if (s.chillT <= 0) s.chill = 0; }
    if (s.freezeT > 0) s.freezeT -= dt;
    if (s.stunT > 0) s.stunT -= dt;
    if (s.corrT > 0) s.corrT -= dt;
    if (s.markT > 0) s.markT -= dt;
    if (s.frost > 0) s.frost = Math.max(0, s.frost - dt * 12);
    // высадка босса: собирается из деталей, неуязвим и неподвижен
    if (e.boss && e.intro > 0) {
      e.intro -= dt; e.vx = e.vy = 0;
      if (e.intro <= 0) { e.inv = false; FX.ring(e.x, e.y, 10, e.r * 4, 0.6, BOSSES[e.bid].color, 6); FX.sparks(e.x, e.y, 30, '#ffd36b', 380, undefined, 0, 0.5); FX.addShake(10); AUDIO.sfx('boom', { big: true }); }
      continue;
    }
    if (e.parent && e.parent.intro > 0) { segAI(e, dt); continue; }
    // во власти электромагнита: летит, кружит или висит в поле — обычный ИИ не работает
    if (e.mag && magnetStep(e, dt)) { if (!e.alive) removeAt(arr, i); continue; }
    if (e.boss) {
      if (e.bid !== 'core') { const f = e.hp / e.maxHp, ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3; if (ph > (e.phase || 1)) bossPhase(e, ph); }
      if (e.phaseT > 0) { e.phaseT -= dt; e.vx = e.vy = 0; if (e.phaseT <= 0) e.inv = false; continue; }
      e.fightT = (e.fightT || 0) + dt;
      // темп боя: тает быстрее задуманного — адаптивная броня; затянулся — броня «устаёт», урон по боссу растёт
      const T = BOSSES[e.bid].t || 60;
      e.bossK = paceBoss(e, dt, T * (e.bid === 'core' ? 1 : 0.9), 0.02);
      if (!e.enraged && e.fightT > (BOSSES[e.bid].t || 60) * 2.1) { e.enraged = true; UI.banner(e.name + ' В ЯРОСТИ', 'Атаки чаще и быстрее', 'red'); AUDIO.sfx('warn'); FX.ring(e.x, e.y, 20, e.r * 5, 0.7, '#ff2a3a', 6); }
    }
    // движение
    if (e.boss) BOSS_AI[e.bid](e, dt, frozen);
    else if (e.parent) segAI(e, dt);
    else if (frozen || s.freezeT > 0 || s.stunT > 0) { e.vx = 0; e.vy = 0; }
    else if (e.ai.rush) AI.rush(e, dt);
    else (AI[e.T.ai] || AI.chase)(e, dt);
    if (e.affix) eliteTick(e, dt);
    if (e.var && !frozen && !(s.freezeT > 0) && !(s.stunT > 0)) variantTick(e, dt);
    if (e.shF > 0) e.shF -= dt;
    if (!e.alive) { removeAt(arr, i); continue; }
    let slow = 1;
    if (s.chillT > 0) slow = 1 - s.chill * (e.boss ? 0.5 : 1);
    if (frozen && !e.boss) slow = 0;
    e.x += (e.vx * slow + e.kbx) * dt;
    e.y += (e.vy * slow + e.kby) * dt;
    enemyVsStructures(e, dt);
    const kd = Math.exp(-8 * dt);
    e.kbx *= kd; e.kby *= kd;
    if (e.vx > 5) e.face = 1; else if (e.vx < -5) e.face = -1;
    {
      const vv = Math.abs(e.vx) + Math.abs(e.vy);
      const toP = e.tid === 'gunner' || e.tid === 'spitter' || e.tid === 'shielder' || vv < 6;
      const want = toP ? Math.atan2(P.y - e.y, P.x - e.x) : Math.atan2(e.vy, e.vx);
      e.ang = e.ang === undefined ? want : e.ang + angDiff(e.ang, want) * Math.min(1, dt * 9);
    }
    // расталкивание
    if (!e.boss && !e.parent && !e.T.prop && e.T.ai !== 'nest' && ((e.id & 1) === sepOdd)) {
      let k = 0;
      G.grid.each(e.x, e.y, e.r + 14, n => {
        if (n === e || !n.alive || k > 6) return;
        const dx = e.x - n.x, dy = e.y - n.y, rr = e.r + n.r, dd = dx * dx + dy * dy;
        if (dd < rr * rr && dd > 0.01) {
          const d = Math.sqrt(dd), push = (rr - d) * 0.5;
          e.x += dx / d * push; e.y += dy / d * push;
          k++;
        }
      });
    }
    // контакт с игроком
    if (e.T.ai === 'nest') {
      // гнездо — твёрдое: выталкивает робота, само не сдвигается
      const rr = e.r + P.r * 0.7, dx = P.x - e.x, dy = P.y - e.y, dd = dx * dx + dy * dy;
      if (dd < rr * rr) { const d = Math.sqrt(dd) || 1; P.x = e.x + dx / d * rr; P.y = e.y + dy / d * rr; }
    } else if (!e.T.prop) {
      const rr = e.r + P.r - 3, dx = e.x - P.x, dy = e.y - P.y, dd = dx * dx + dy * dy;
      if (dd < rr * rr) {
        if (e.T.ai !== 'kami' && e.T.ai !== 'egg' && !e.phased && !(e.leapH > 12)) hurtPlayer(e.dmg, e);
        if (!e.boss) { const d = Math.sqrt(dd) || 1, push = (rr - d) * 0.6; e.x += dx / d * push; e.y += dy / d * push; }
      }
    }
    // переброска отставших
    if (!e.boss && !e.parent && !e.ai.rush && e.T.ai !== 'nest' && (Math.abs(e.x - P.x) > far || Math.abs(e.y - P.y) > far)) {
      if (e.T.prop) { e.alive = false; removeAt(arr, i); continue; }
      const p = spawnPoint(); e.x = p.x; e.y = p.y; e.kbx = e.kby = 0;
    }
  }
}

function updateEnemyBullets(dt) {
  const arr = G.ebullets;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt;
    if (b.kind === 'glob') {
      b.t += dt;
      const q = Math.min(1, b.t / b.dur);
      b.x = lerp(b.sx, b.tx, q); b.y = lerp(b.sy, b.ty, q); b.h = Math.sin(q * Math.PI) * 50;
      if (q >= 1) {
        if (b.web) { (G.webs || (G.webs = [])).push({ x: b.tx, y: b.ty, r: 48, life: 7, max: 7, rot: rand(0, TAU) }); FX.burst(b.tx, b.ty, 6, '#e8ffe0', 90, 0.3, 3); }
        else { spawnArea('acid', b.tx, b.ty, { r: 34, life: 3.2, dmg: b.dmg }); FX.burst(b.tx, b.ty, 6, '#c6ff3d', 90, 0.3, 4); }
        removeAt(arr, i);
      }
      continue;
    }
    if (b.kind === 'scythe') {
      const h = b.host && b.host.alive ? b.host : null;
      b.u += dt * b.du; b.rot += dt * 16;
      const loop = Math.floor(b.u), u = b.u - loop;
      if (!h || loop >= b.loops) { removeAt(arr, i); continue; }
      if (loop !== b.lp) { b.lp = loop; b.ox = h.x; b.oy = h.y; b.ang = Math.atan2(P.y - h.y, P.x - h.x) + b.side * 0.25; }
      const ca = Math.cos(b.ang), sa = Math.sin(b.ang), f = Math.sin(Math.PI * u) * b.R, l = b.side * Math.sin(TAU * u) * b.R * 0.45, qq = u * u;
      const hx = lerp(b.ox, h.x, qq), hy = lerp(b.oy, h.y, qq);
      b.x = hx + ca * f - sa * l; b.y = hy + sa * f + ca * l;
      if (d2(b.x, b.y, P.x, P.y) < (b.r + P.r - 4) ** 2) hurtPlayer(b.dmg, null);
      continue;
    }
    if (G.freezeT > 0) { b.life -= dt * 2; } else { b.x += b.vx * dt; b.y += b.vy * dt; }
    if (b.accel) { b.vx *= 1 + b.accel * dt; b.vy *= 1 + b.accel * dt; }
    const rr = b.r + P.r - 4;
    if (d2(b.x, b.y, P.x, P.y) < rr * rr) {
      // ледяной сгусток: кроме урона, замедляет робота (если удар прошёл — не в рывке, не в неуязвимости)
      if (b.frost && P.iframes <= 0 && !(P.dash.t > 0) && !P.od.active) { P.slowT = Math.max(P.slowT || 0, b.frost); FX.hexRing(P.x, P.y - upY(18), 4, 22, 0.3, '#bff0ff', 1.2); }
      hurtPlayer(b.dmg, null); FX.burst(b.x, b.y, 4, b.col, 100, 0.2, 4); removeAt(arr, i); continue;
    }
    if (b.rot !== undefined) b.rot += dt * 7;
    if (b.life <= 0) removeAt(arr, i);
  }
}

/* ===== Боссы ===== */
function bossHpMul() {
  let k = G.sector.hp * (1 + G.threat * 0.2) * (0.6 + 0.02 * P.level);
  if (G.endless) k *= Math.pow(1.12, Math.max(0, minutes() - 20));
  return k;
}
function spawnBoss(id, final) {
  const B = BOSSES[id];
  // высаживается сбоку или снизу — там, где сборку видно (табличка тревоги — вверху)
  const pa = pick([0, Math.PI, Math.PI / 2, Math.PI / 2]) + rand(-0.45, 0.45), pd = Math.min(VIEW.hw, VIEW.hh) * 0.55 + B.r;
  const p = { x: P.x + Math.cos(pa) * pd, y: P.y + Math.sin(pa) * pd };
  let hp = B.hp * bossHpMul() * Math.pow(Math.max(1, G.alert || 1), 0.85);
  // слабой сборке (тревога ниже обычной) босс не стена: не больше, чем она наносит примерно за целевое время боя
  if ((G.alert || 1) < 1.05) hp = Math.min(hp, Math.max(B.hp * 0.6, (G.dps || 0) * (B.t || 60) * 0.5));
  const e = {
    id: ++G.eid, tid: 'boss', T: { r: B.r, acc: B.color, kbRes: 1, ai: 'boss', name: B.name }, bid: id, name: B.name,
    x: p.x, y: p.y, vx: 0, vy: 0, kbx: 0, kby: 0, r: B.r, hp, maxHp: hp, spd: B.spd * G.sector.spd, dmg: B.dmg * (1 + minutes() * 0.02) * (1 + Math.max(0, (G.alert || 1) - 1) * 0.15),
    xp: 0, alive: true, flash: 0, t: 0, face: 1, anim: 0, st: newStatus(), ai: { s: 'walk', t: 0, cd: 2.5, k: 0 },
    elite: false, boss: true, final: !!final, icd: null, shieldT: 0, phased: false, scale: 1,
    intro: BOSS_INTRO, inv: true,
  };
  G.enemies.push(e); G.bossesAlive++;
  warnCircle(e.x, e.y, B.r * 1.6, BOSS_INTRO * 0.95, null);
  if (id === 'serpent') {
    e.segs = [];
    let prev = e;
    for (let i = 0; i < B.segs; i++) {
      const s = { id: ++G.eid, tid: 'seg', T: { r: 17, acc: B.color, kbRes: 1, ai: 'seg' }, parent: e, prev, idx: i,
        x: e.x, y: e.y, vx: 0, vy: 0, kbx: 0, kby: 0, r: 17, hp: 1, maxHp: 1, spd: 0, dmg: e.dmg * 0.7, xp: 0, alive: true, flash: 0, t: 0, face: 1, anim: i,
        st: newStatus(), ai: { cd: 2 + i * 0.25 }, elite: false, boss: false, icd: null, shieldT: 0, phased: false, scale: 1 };
      G.enemies.push(s); e.segs.push(s); prev = s;
    }
  }
  if (final) G.final = e;
  discover('enemies', 'boss_' + id);
  AUDIO.sfx('warn'); AUDIO.music(3);
  UI.bossWarn(B);
}
function segAI(s, dt) {
  const p = s.prev, sp = 22;
  if (!s.parent.alive) { s.alive = false; return; }
  const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
  if (d > sp) { s.x = p.x - dx / d * sp; s.y = p.y - dy / d * sp; }
  s.vx = 0; s.vy = 0; s.ang = Math.atan2(dy, dx);
  s.ai.cd -= dt;
  if (s.ai.cd <= 0 && G.freezeT <= 0 && !(s.parent.intro > 0)) {
    const ph = s.parent.phase || 1;
    s.ai.cd = rand(3.5, 5.5) * (ph >= 3 ? 0.8 : 1);
    if ((ph >= 3 || (ph >= 2 ? s.idx % 2 === 1 : s.idx % 3 === 1)) && onScreen(s)) { eBullet(s.x, s.y, Math.atan2(P.y - s.y, P.x - s.x), 150, s.parent.dmg * 0.6, { col: '#8dff6a', r: 6 }); }
  }
}
// смена фазы: короткая неуязвимость, броня «вздыхает», новые приёмы
function bossPhase(e, ph) {
  e.phase = ph; e.inv = true; e.phaseT = 1.4;
  const a = e.ai; a.s = 'walk'; a.t = 0; a.cd = 1.4; a.chain = 0; a.second = false;
  G.warns = G.warns.filter(w => w.follow !== e);
  const B = BOSSES[e.bid];
  FX.ring(e.x, e.y, 20, e.r * 6, 0.8, B.color, 6); FX.flash(B.color, 0.25); FX.addShake(10); FX.impact = 2;
  UI.banner(e.name + ' · ФАЗА ' + ROMAN[ph], (BOSS_PHASE_TXT[e.bid] || [])[ph - 2] || '', 'red');
  AUDIO.sfx('warn'); AUDIO.sfx('tfBoom');
}
const bossK = e => (e.phase >= 3 ? 0.72 : e.phase >= 2 ? 0.86 : 1) * (e.enraged ? 0.6 : 1);
// темп боя с боссом/лейтенантом — множитель урона по нему. Прямая связь: сырой урон (до брони, сглажен ~1,5 с) против
// нужного темпа «уложиться в целевое время T»; обратная связь: опережает график — броня крепче, отстаёт — слабее.
// Слишком быстро — броня до предела lo; слишком медленно — после 30% времени броня «устаёт», урон растёт до ×4 (×8 к двойному времени)
function paceBoss(e, dt, T, lo) {
  const raw = (e.rawAcc || 0) / Math.max(dt, 1e-4); e.rawAcc = 0;
  const need = e.hp / Math.max(3, T - e.fightT);
  if (e.rawR === undefined) e.rawR = Math.max(need, G.dps || 0);
  e.rawR += (raw - e.rawR) * Math.min(1, dt / 1.5);
  const lost = 1 - e.hp / e.maxHp, want = Math.min(1, (e.fightT + 3) / T);
  const corr = Math.pow(clamp(want / Math.max(lost, 0.01), 0.25, 4), 2);
  let k = need / Math.max(e.rawR, 1e-3) * corr;
  const top = 4 + 4 * clamp(e.fightT / T - 1, 0, 1);   // совсем затянувшийся бой: до ×8 к двойному времени
  if (k > 1) k = 1 + (Math.min(top, k) - 1) * clamp((e.fightT / T - 0.3) / 0.7, 0, 1);
  return clamp(k, lo, top);
}
function warnCircle(x, y, r, dur, fn) { G.warns.push({ kind: 'c', x, y, r, t: 0, dur, fn }); }
function warnLine(x, y, ang, len, w, dur, fn, follow) { G.warns.push({ kind: 'l', x, y, ang, len, w, t: 0, dur, fn, follow }); }
function updateWarns(dt) {
  for (let i = G.warns.length - 1; i >= 0; i--) {
    const w = G.warns[i];
    w.t += dt;
    if (w.follow) { w.x = w.follow.x; w.y = w.follow.y; }
    if (w.t >= w.dur) { if (w.fn) w.fn(w); removeAt(G.warns, i); }
  }
}
function inLine(px, py, x, y, ang, len, w) {
  const dx = Math.cos(ang), dy = Math.sin(ang), ex = px - x, ey = py - y, t = ex * dx + ey * dy;
  if (t < 0 || t > len) return false;
  const qx = ex - dx * t, qy = ey - dy * t;
  return qx * qx + qy * qy < (w / 2 + P.r * 0.6) ** 2;
}
function radial(e, n, spd, dmg, off, col) { for (let i = 0; i < n; i++) eBullet(e.x, e.y, off + i * TAU / n, spd, dmg, { col: col || '#ffd23f', r: 6 }); }

const BOSS_AI = {
  // МОЛОТ: удар молотом по кругам, таран, вызов клещей. Фаза II — волна от удара и двойной таран; фаза III — шесть кругов и огненный след
  hammer(e, dt, frozen) {
    const a = e.ai, ph = e.phase || 1;
    a.t -= dt; a.cd -= dt;
    if (frozen) { e.vx = e.vy = 0; return; }
    if (a.s === 'walk') {
      steer(e, P.x, P.y, e.enraged ? 1.2 : 1);
      if (a.cd <= 0) {
        a.k = (a.k + 1) % 3;
        if (a.k === 0) {
          a.s = 'slam'; a.t = 1.1; e.vx = e.vy = 0;
          const pts = [[P.x, P.y]], n = ph >= 3 ? 5 : 3;
          for (let i = 0; i < n; i++) { const an = rand(0, TAU), rr = 90 + rand(0, 60); pts.push([P.x + Math.cos(an) * rr, P.y + Math.sin(an) * rr]); }
          for (const q of pts) warnCircle(q[0], q[1], 72, 1.05, w => {
            FX.explosion(w.x, w.y, 70, '#ff8a3d', true); FX.addShake(6); AUDIO.sfx('boom', { big: true });
            if (d2(w.x, w.y, P.x, P.y) < (w.r + P.r * 0.5) ** 2) hurtPlayer(e.dmg * 1.5, null);
            if (ph >= 2 && e.alive) radial(w, 9, 115, e.dmg * 0.45, rand(0, TAU), '#ff8a3d');
          });
        } else if (a.k === 1) { a.s = 'wind'; a.t = 0.85; a.chain = ph >= 2 ? 2 : 1; a.ang = Math.atan2(P.y - e.y, P.x - e.x); warnLine(e.x, e.y, a.ang, 520, e.r * 1.8, 0.85, null, e); }
        else {
          a.s = 'summon'; a.t = 0.6;
          for (let i = 0; i < 10; i++) { const an = i * TAU / 10; spawnEnemy('bug', e.x + Math.cos(an) * 60, e.y + Math.sin(an) * 60); }
          if (ph >= 2) for (let i = 0; i < 4; i++) { const an = rand(0, TAU); spawnEnemy('kami', e.x + Math.cos(an) * 50, e.y + Math.sin(an) * 50); }
          FX.ring(e.x, e.y, 10, 90, 0.4, '#ff8a3d', 4);
        }
        a.cd = 3.6 * bossK(e);
      }
    } else if (a.s === 'slam' || a.s === 'summon') { e.vx = e.vy = 0; if (a.t <= 0) a.s = 'walk'; }
    else if (a.s === 'wind') {
      e.vx = e.vy = 0;
      const w = G.warns.find(x => x.follow === e); if (w) w.ang = a.ang;
      if (a.t <= 0) { a.s = 'charge'; a.t = 0.62; AUDIO.sfx('dash'); }
    } else if (a.s === 'charge') {
      const sp = 540 * (e.enraged ? 1.15 : 1);
      e.vx = Math.cos(a.ang) * sp; e.vy = Math.sin(a.ang) * sp;
      if (Math.random() < 0.7) FX.dot(e.x, e.y, 0, 0, 0.3, e.r * 1.1, '#ff8a3d', 0);
      if (ph >= 3) { a.trail = (a.trail || 0) - dt; if (a.trail <= 0) { a.trail = 0.06; eBullet(e.x, e.y, 0, 0, e.dmg * 0.35, { r: 13, life: 2.4, col: '#ff7a2e', kind: 'fire' }); } }
      if (a.t <= 0) {
        FX.addShake(4);
        if (--a.chain > 0) { a.s = 'wind'; a.t = 0.5; a.ang = Math.atan2(P.y - e.y, P.x - e.x); warnLine(e.x, e.y, a.ang, 520, e.r * 1.8, 0.5, null, e); }
        else a.s = 'walk';
      }
    }
  },
  // УЛЕЙ: кольца залпов, спираль, камикадзе, кольцо клещей. Фаза II — залпы плотнее, спираль в три луча; фаза III — таран
  hive(e, dt, frozen) {
    const a = e.ai, ph = e.phase || 1;
    a.t -= dt; a.cd -= dt; e.rot = (e.rot || 0) + dt * (a.s === 'spiral' ? 2.2 : a.s === 'dash' ? 4 : 0.6);
    a.hatch = Math.max(0, (a.hatch || 0) - dt); a.flare = Math.max(0, (a.flare || 0) - dt * 3);
    if (frozen) { e.vx = e.vy = 0; return; }
    if (a.s === 'dash') {
      e.vx = Math.cos(a.ang) * 330; e.vy = Math.sin(a.ang) * 330;
      if (Math.random() < 0.6) FX.dot(e.x, e.y, 0, 0, 0.3, e.r, '#ffd23f', 0);
      if (a.t <= 0) { a.s = 'walk'; a.flare = 1; radial(e, 16, 150, e.dmg * 0.6, rand(0, TAU)); FX.addShake(5); }
      return;
    }
    if (a.s === 'windd') { e.vx *= 0.8; e.vy *= 0.8; const w = G.warns.find(x => x.follow === e); if (w) w.ang = a.ang; if (a.t <= 0) { a.s = 'dash'; a.t = 0.75; AUDIO.sfx('dash'); } return; }
    const d = Math.sqrt(d2(e.x, e.y, P.x, P.y));
    // парит на средней дистанции, но подпускает ближе — ближнему бою тоже есть что делать
    if (d > 200) steer(e, P.x, P.y, 1); else if (d < 115) steer(e, P.x, P.y, -0.5); else { e.vx *= 0.95; e.vy *= 0.95; }
    if (a.s === 'spiral') {
      a.sp = (a.sp || 0) - dt;
      if (a.sp <= 0) {
        a.sp = ph >= 3 ? 0.075 : 0.09; a.ang = (a.ang || 0) + 0.45;
        const arms = ph >= 2 ? 3 : 2;
        for (let k = 0; k < arms; k++) eBullet(e.x, e.y, a.ang + k * TAU / arms, 140, e.dmg * 0.7, { col: '#ffd23f', r: 6 });
      }
      if (a.t <= 0) a.s = 'walk';
      return;
    }
    if (a.cd <= 0) {
      a.k = (a.k + 1) % (ph >= 3 ? 5 : 4); a.cd = 3.2 * bossK(e);
      const n = [18, 24, 30][ph - 1];
      if (a.k === 0) { a.flare = 1; radial(e, n, 150, e.dmg * 0.7, rand(0, TAU)); later(0.5, () => { if (e.alive) { a.flare = 1; radial(e, n, 150, e.dmg * 0.7, rand(0, TAU)); } }); }
      else if (a.k === 1) { a.s = 'spiral'; a.t = 2.6; }
      else if (a.k === 2) { a.hatch = 1.6; for (let i = 0; i < 7 + ph; i++) { const an = rand(0, TAU); spawnEnemy('kami', e.x + Math.cos(an) * 40, e.y + Math.sin(an) * 40); } FX.ring(e.x, e.y, 10, 80, 0.4, '#ffd23f', 3); }
      else if (a.k === 3) { const R = 230; for (let i = 0; i < 14; i++) { const an = i * TAU / 14; spawnEnemy('bug', P.x + Math.cos(an) * R, P.y + Math.sin(an) * R); } }
      else { a.s = 'windd'; a.t = 0.8; a.ang = Math.atan2(P.y - e.y, P.x - e.x); warnLine(e.x, e.y, a.ang, 300, e.r * 2, 0.8, null, e); }
    }
  },
  // ЗМЕЙ: бросок. Фаза II — кислотный след; фаза III — быстрее и двойной бросок
  serpent(e, dt, frozen) {
    const a = e.ai, ph = e.phase || 1;
    a.t -= dt; a.cd -= dt;
    if (frozen) { e.vx = e.vy = 0; return; }
    if (a.ang === undefined) a.ang = Math.atan2(P.y - e.y, P.x - e.x);
    const boost = (ph >= 3 ? 1.3 : 1) * (e.enraged ? 1.15 : 1);
    let spd = e.spd * boost, turn = 1.6;
    if (a.s === 'wind') { spd = 30; turn = 3; if (a.t <= 0) { a.s = 'lunge'; a.t = 1.1; AUDIO.sfx('dash'); } }
    else if (a.s === 'lunge') {
      spd = 300 * boost; turn = 0.5;
      if (ph >= 2) { a.trail = (a.trail || 0) - dt; if (a.trail <= 0) { a.trail = 0.07; eBullet(e.x, e.y, 0, 0, e.dmg * 0.35, { r: 14, life: 3, col: '#8dff6a', kind: 'fire' }); } }
      if (a.t <= 0) { if (ph >= 3 && !a.second) { a.second = true; a.s = 'wind'; a.t = 0.45; } else { a.second = false; a.s = 'walk'; a.cd = 5 * bossK(e); } }
    }
    else if (a.cd <= 0 && d2(e.x, e.y, P.x, P.y) < 380 * 380) { a.s = 'wind'; a.t = 0.8; FX.ring(e.x, e.y, 10, 60, 0.5, '#8dff6a', 3); }
    const target = Math.atan2(P.y - e.y, P.x - e.x) + Math.sin(e.t * 2.2) * 0.5;
    a.ang += clamp(angDiff(a.ang, target), -turn * dt, turn * dt);
    e.vx = Math.cos(a.ang) * spd; e.vy = Math.sin(a.ang) * spd;
    if (a.s === 'lunge' && Math.random() < 0.6) FX.dot(e.x, e.y, 0, 0, 0.3, e.r, '#8dff6a', 0);
  },
  // ЖНЕЦ: кружит рядом, рывок насквозь, косы-бумеранги, вихрь клинков. Фаза II — косы возвращаются дважды; фаза III — призраки повторяют рывок
  reaper(e, dt, frozen) {
    const a = e.ai, ph = e.phase || 1;
    a.t -= dt; a.cd -= dt;
    if (frozen) { e.vx = e.vy = 0; return; }
    const ang = Math.atan2(P.y - e.y, P.x - e.x);
    if (a.s === 'walk') {
      const d = Math.sqrt(d2(e.x, e.y, P.x, P.y)), k = d > 230 ? 1 : d < 150 ? -0.7 : 0, side = ang + Math.PI / 2 * (a.dir || 1);
      e.vx = (Math.cos(ang) * k + Math.cos(side) * 0.6) * e.spd; e.vy = (Math.sin(ang) * k + Math.sin(side) * 0.6) * e.spd;
      if (Math.random() < dt * 0.5) a.dir = -(a.dir || 1);
      if (a.cd <= 0) {
        a.k = ((a.k || 0) + 1) % 3;
        if (a.k === 0) {
          a.s = 'wind'; a.t = 0.65; a.ang = ang; a.len = Math.min(560, d + 190);
          warnLine(e.x, e.y, a.ang, a.len, e.r * 1.4, 0.65, null, e);
          a.ghosts = ph >= 3 ? [-1, 1].map(s => ({ ox: -Math.sin(ang) * 95 * s, oy: Math.cos(ang) * 95 * s })) : null;
          if (a.ghosts) for (const g of a.ghosts) warnLine(e.x + g.ox, e.y + g.oy, ang, a.len, e.r * 1.2, 0.65, null, null);
        } else if (a.k === 1) {
          a.s = 'throw'; a.t = 0.5; AUDIO.sfx('swing');
          for (const s of [-1, 1]) G.ebullets.push({ kind: 'scythe', x: e.x, y: e.y, ox: e.x, oy: e.y, host: e, ang: ang + s * 0.25, side: s, u: 0, du: 1 / 1.4, loops: ph >= 2 ? 2 : 1, R: 300, r: 13, dmg: e.dmg * 0.8, life: 8, col: '#ff4fd8', vx: 0, vy: 0, rot: 0 });
        } else { a.s = 'whirl'; a.t = 2.2; a.sp = 0; AUDIO.sfx('swing'); }
        a.cd = 2.6 * bossK(e);
      }
    } else if (a.s === 'wind') {
      e.vx = e.vy = 0; const w = G.warns.find(x => x.follow === e); if (w) w.ang = a.ang;
      if (a.t <= 0) { a.s = 'dash'; a.t = a.len / 760; AUDIO.sfx('dash'); }
    } else if (a.s === 'dash') {
      e.vx = Math.cos(a.ang) * 760; e.vy = Math.sin(a.ang) * 760;
      FX.dot(e.x, e.y, 0, 0, 0.3, e.r * 0.9, '#ff4fd8', 0);
      if (a.ghosts) for (const g of a.ghosts) { const gx = e.x + g.ox, gy = e.y + g.oy; FX.dot(gx, gy, 0, 0, 0.35, e.r * 0.8, '#ff9ae6', 0); if (d2(gx, gy, P.x, P.y) < (e.r + P.r) ** 2) hurtPlayer(e.dmg, null); }
      if (a.t <= 0) { a.s = 'walk'; a.ghosts = null; }
    } else if (a.s === 'throw') { e.vx *= 0.9; e.vy *= 0.9; if (a.t <= 0) a.s = 'walk'; }
    else if (a.s === 'whirl') {
      e.vx = Math.cos(ang) * e.spd * 0.45; e.vy = Math.sin(ang) * e.spd * 0.45;
      a.sp -= dt;
      if (a.sp <= 0) { a.sp = ph >= 3 ? 0.12 : ph >= 2 ? 0.15 : 0.2; a.wa = (a.wa || 0) + 0.7; for (let k = 0; k < 3; k++) eBullet(e.x, e.y, a.wa + k * TAU / 3, 170, e.dmg * 0.5, { col: '#ff4fd8', r: 6 }); }
      if (a.t <= 0) a.s = 'walk';
    }
  },
  // ПАУЧИХА: прыжок на игрока, паутина замедляет, кладки вылупляются. Фаза II — паутины и кладок больше; фаза III — прыжок за прыжком
  arachna(e, dt, frozen) {
    const a = e.ai, ph = e.phase || 1;
    a.t -= dt; a.cd -= dt;
    if (frozen) { e.vx = e.vy = 0; return; }
    if (a.s === 'walk') {
      steer(e, P.x, P.y, e.enraged ? 1.2 : 1);
      if (a.cd <= 0) {
        a.k = ((a.k || 0) + 1) % 3;
        if (a.k === 0) { a.leaps = ph >= 3 ? 3 : 1; arachnaAim(e); }
        else if (a.k === 1) {
          a.s = 'spit'; a.t = 0.8; AUDIO.sfx('flame');
          for (let i = 0; i < (ph >= 2 ? 5 : 3); i++) { const tx = P.x + rand(-120, 120), ty = P.y + rand(-120, 120); G.ebullets.push({ x: e.x, y: e.y, sx: e.x, sy: e.y, tx, ty, t: 0, dur: 0.9, vx: 0, vy: 0, r: 5, dmg: e.dmg * 0.4, life: 0.9, col: '#e8ffe0', kind: 'glob', web: true }); }
        } else {
          a.s = 'eggs'; a.t = 0.7;
          const n = ph >= 2 ? 6 : 4;
          for (let i = 0; i < n; i++) { const an = i * TAU / n + rand(-0.3, 0.3), dd = e.r * 1.6 + rand(0, 40); const g = spawnEnemy('egg', e.x + Math.cos(an) * dd, e.y + Math.sin(an) * dd); g.ai.h = ph >= 2 ? 1.6 : 2.4; }
          FX.ring(e.x, e.y, 10, e.r * 3, 0.4, '#c6ff3d', 3);
        }
        a.cd = 3.2 * bossK(e);
      }
    } else if (a.s === 'crouch') { e.vx = e.vy = 0; if (a.t <= 0) { a.s = 'leap'; a.t = 0.7; a.x0 = e.x; a.y0 = e.y; AUDIO.sfx('dash'); } }
    else if (a.s === 'leap') {
      const q = clamp(1 - a.t / 0.7, 0, 1);
      e.x = lerp(a.x0, a.tx, q); e.y = lerp(a.y0, a.ty, q); e.vx = e.vy = 0; e.leapH = Math.sin(Math.PI * q) * 95;
      if (a.t <= 0) {
        e.leapH = 0; FX.explosion(e.x, e.y, e.r * 2, '#c6ff3d', true); FX.addShake(10); AUDIO.sfx('boom', { big: true });
        if (d2(e.x, e.y, P.x, P.y) < (e.r * 2.1 + P.r * 0.5) ** 2) hurtPlayer(e.dmg * 1.4, null);
        if (ph >= 2) radial(e, 10, 120, e.dmg * 0.4, rand(0, TAU), '#c6ff3d');
        if (--a.leaps > 0) arachnaAim(e, 0.42); else a.s = 'walk';
      }
    } else { e.vx *= 0.85; e.vy *= 0.85; if (a.t <= 0) a.s = 'walk'; }
  },
  core(e, dt, frozen) {
    const a = e.ai;
    a.t -= dt; a.cd -= dt; e.rot = (e.rot || 0) + dt;
    const ph = e.hp > e.maxHp * 0.6 ? 1 : e.hp > e.maxHp * 0.25 ? 2 : 3;
    if (ph !== a.ph) {
      if (a.ph && ph > a.ph) { e.inv = true; e.phaseT = 1.4; FX.impact = 2; }
      a.ph = ph; e.phase = ph;
      if (ph > 1) { UI.banner('ЯДРО РОЯ · ФАЗА ' + ROMAN[ph], ph === 3 ? 'Уничтожьте щитовые узлы' : 'Лазеры!', 'red'); FX.ring(e.x, e.y, 20, 300, 0.7, '#ff3d5a', 6); AUDIO.sfx('warn'); }
      if (ph === 3) {
        e.nodes = [];
        for (let i = 0; i < 4; i++) {
          const n = spawnEnemy('shielder', e.x, e.y, { ai: { node: true } });
          n.hp = n.maxHp = e.maxHp * 0.025; n.r = 16; n.boss = false; n.orbit = i * TAU / 4; n.host = e; n.T = Object.assign({}, n.T, { ai: 'node', kbRes: 1 });
          e.nodes.push(n);
        }
      }
    }
    if (e.nodes) { const alive = e.nodes.filter(n => n.alive).length; e.dmgRes = alive ? 0.88 : 0; }
    if (frozen) { e.vx = e.vy = 0; return; }
    const d = Math.sqrt(d2(e.x, e.y, P.x, P.y));
    if (d > 200) steer(e, P.x, P.y, 1); else { e.vx *= 0.9; e.vy *= 0.9; }
    a.sp = (a.sp || 0) - dt;
    if (ph === 1) {
      if (a.sp <= 0) { a.sp = 0.16; a.ang = (a.ang || 0) + 0.32; for (let k = 0; k < 3; k++) eBullet(e.x, e.y, a.ang + k * TAU / 3, 135, e.dmg * 0.6, { col: '#ff3d5a', r: 6 }); }
      if (a.cd <= 0) { a.cd = 6; for (let i = 0; i < 10; i++) { const an = rand(0, TAU); spawnEnemy('kami', e.x + Math.cos(an) * 60, e.y + Math.sin(an) * 60); } }
    } else if (ph === 2) {
      if (a.s !== 'laser' && a.cd <= 0) {
        a.s = 'laser'; a.t = 4.2; a.lang = Math.atan2(P.y - e.y, P.x - e.x) - 1.1; a.dir = Math.random() < 0.5 ? 1 : -1;
        warnLine(e.x, e.y, a.lang, 720, 30, 1.0, null, e);
        warnLine(e.x, e.y, a.lang + Math.PI, 720, 30, 1.0, null, e);
      }
      if (a.s === 'laser') {
        const on = a.t < 3.2;
        if (on) a.lang += a.dir * 0.85 * dt;
        a.laserOn = on;
        if (on) { for (const off of [0, Math.PI]) if (inLine(P.x, P.y, e.x, e.y, a.lang + off, 720, 30)) hurtPlayer(e.dmg * 1.2, null); }
        if (a.t <= 0) { a.s = 'walk'; a.cd = 2.5; a.laserOn = false; radial(e, 22, 150, e.dmg * 0.6, rand(0, TAU), '#ff3d5a'); }
      }
      if (a.sp <= 0 && a.s !== 'laser') { a.sp = 0.6; eBullet(e.x, e.y, Math.atan2(P.y - e.y, P.x - e.x), 210, e.dmg * 0.7, { col: '#ff3d5a', r: 7 }); }
    } else {
      if (a.sp <= 0) { a.sp = 1.1; radial(e, 24, 140, e.dmg * 0.6, rand(0, TAU), '#ff3d5a'); }
      if (a.cd <= 0) { a.cd = 2.2; const b = Math.atan2(P.y - e.y, P.x - e.x); for (let k = -2; k <= 2; k++) eBullet(e.x, e.y, b + k * 0.14, 230, e.dmg * 0.7, { col: '#ffffff', r: 6 }); }
    }
  },
};
// Паучиха целится: присед и круг приземления у игрока (с упреждением)
function arachnaAim(e, crouch) {
  const a = e.ai;
  a.s = 'crouch'; a.t = crouch || 0.55;
  a.tx = P.x + P.vx * 0.4; a.ty = P.y + P.vy * 0.4;
  warnCircle(a.tx, a.ty, e.r * 2.1, a.t + 0.7, null);
}
// паутина: замедляет игрока, пока он внутри
function inWeb(x, y) { for (const w of G.webs || []) if (d2(x, y, w.x, w.y) < w.r * w.r) return true; return false; }
AI.node = function (n, dt) {
  const h = n.host;
  if (!h || !h.alive) { n.alive = false; return; }
  n.orbit += dt * 0.9;
  const tx = h.x + Math.cos(n.orbit) * 120, ty = h.y + Math.sin(n.orbit) * 120;
  n.vx = (tx - n.x) * 6; n.vy = (ty - n.y) * 6;
};

const LATER = [];
function later(t, fn) { LATER.push({ t, fn }); }
function updateLater(dt) { for (let i = LATER.length - 1; i >= 0; i--) { LATER[i].t -= dt; if (LATER[i].t <= 0) { const f = LATER[i].fn; removeAt(LATER, i); f(); } } }

function bossKilled(e) {
  G.bossesAlive = Math.max(0, G.bossesAlive - 1);
  G.bossKills++;
  bossWreck(e);
  if (e.segs) for (const s of e.segs) { s.alive = false; FX.explosion(s.x, s.y, 26, '#8dff6a'); }
  if (e.nodes) for (const n of e.nodes) n.alive = false;
  for (const b of G.ebullets) b.life = Math.min(b.life, 0.05);
  G.hitstop = 0.12;
  FX.flash('#ffffff', 0.7); FX.addShake(16);
  AUDIO.sfx('bossDie');
  for (let i = 0; i < 6; i++) later(i * 0.15, () => { FX.explosion(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), 40 + i * 6, BOSSES[e.bid].color, true); });
  FX.ring(e.x, e.y, 20, 360, 0.9, BOSSES[e.bid].color, 8);
  for (let i = 0; i < 18; i++) { const a = rand(0, TAU), d = rand(10, 70); dropGem(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 12 + minutes() * 1.5); }
  dropItem(e.x, e.y, 'bigchest');
  dropItem(e.x + 20, e.y, 'scrap', randi(15, 30));
  if (!P.od.active) P.od.meter = Math.min(100, P.od.meter + 30);
  UI.banner(e.name + ' УНИЧТОЖЕН', 'Заберите контейнер', 'gold');
  const sid = G.sector.id;
  if (e.bid === 'hammer') achieve('boss1');
  if (e.bid === 'hive' && sid === 'rust') achieve('boss2');
  if (e.bid === 'serpent') { achieve('boss3'); if (sid === 'neon') achieve('neon3'); }
  if (!G.bossesAlive) AUDIO.music(2);
  if (e.final) later(1.6, () => { if (G.state === 'play') winRun(); else G.pendingWin = true; });
}
