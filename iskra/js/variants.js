'use strict';
/* ===== Цветные варианты Роя: цвет рёбер — поведение =====
   синий — ледяные сгустки замедляют робота; зелёный — кислотная лужа после гибели; жёлтый — энергощит поверх корпуса;
   фиолетовый — короткие фазовые прыжки к роботу; оранжевый — взрыв через полсекунды после гибели.
   Появляются с полутора минут, чем дальше и выше тревога — тем чаще; набор зависит от сектора. */
function variantChance() { return clamp((minutes() - 1.5) * 0.015, 0, 0.22) * (1 + Math.max(0, (G.alert || 1) - 1) * 0.25); }
function rollVariant(e, o) {
  if (e.elite || e.boss || (o && (o.elite || o.noVar)) || !VAR_TYPES.includes(e.tid)) return;
  if (Math.random() >= variantChance()) return;
  const v = weightedKey(VAR_W[G.sector.id] || VAR_W.rust);
  e.var = v; e.xp *= 1.6; e.vt = rand(1.2, 2.6);
  if (v === 'shield') e.shp = e.shpMax = e.maxHp * 0.7 + 6;
  queueVariantSprites(e.tid + '~' + v);
  discover('variants', v);
}
// кадры варианта строятся заранее, по одному набору за кадр игры
function queueVariantSprites(key) {
  (SPR.vKeys || (SPR.vKeys = new Set())).add(key);
  if (SPR.enemies && SPR.enemies[key]) return;
  if (!SPR.ePend) SPR.ePend = [];
  if (!SPR.ePend.includes(key)) SPR.ePend.push(key);
}
function variantPalSP(SP, v) {
  const col = VARIANTS[v].col;
  return Object.assign({}, SP, { enemy: col, enemyD: mixHex('#06070c', col, 0.2), enemyL: mixHex('#ffffff', col, 0.5) });
}
function variantTick(e, dt) {
  const v = e.var;
  if (v !== 'ice' && v !== 'blink') return;
  e.vt -= dt;
  if (e.vt > 0) return;
  const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy) || 1;
  if (v === 'ice') {
    if (d > 360 || !onScreen(e, 20)) { e.vt = 0.5; return; }
    const mz = enemyMuzzle(e), a = Math.atan2(P.y - mz.y, P.x - mz.x), sp = 190;
    G.ebullets.push({ x: mz.x, y: mz.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, dmg: e.dmg * 0.6, life: 2.4, col: '#7fd8ff', kind: 'frost', frost: 1.6, rot: rand(0, TAU) });
    FX.hexRing(mz.x, mz.y, 1.5, 9, 0.18, '#7fd8ff', 1);
    e.vt = rand(2.6, 3.6);
  } else {
    if (d < 110 || d > 460) { e.vt = 0.4; return; }
    const jump = Math.min(130, d - 60), ox = e.x, oy = bodyY(e);
    e.x += dx / d * jump; e.y += dy / d * jump;
    if (BLD_LIST.length) collideStructures(e, e.r * 0.85);
    const ny = bodyY(e);
    FX.hexRing(ox, oy, 4, 16, 0.25, '#b56bff', 1.2); FX.hexRing(e.x, ny, 16, 4, 0.25, '#e0c4ff', 1.2);
    FX.beam(ox, oy, e.x, ny, 0.8, 0.14, '#b56bff');
    e.vt = rand(2.2, 3.4);
  }
}
// щит поглощает урон; пробитый — разлетается осколками, остаток урона проходит наполовину
function variantShield(e, d) {
  e.shp -= d; e.shF = 0.12;
  if (e.shp > 0) return 0;
  const over = -e.shp; e.shp = 0;
  const y = bodyY(e);
  FX.shards(e.x, y, 10, '#ffd23f', 220); FX.hexRing(e.x, y, e.r * 1.4, e.r * 2.6, 0.3, '#ffe680', 1.4);
  if (onScreen(e, 0)) AUDIO.sfx('clank');
  return over * 0.5;
}
function variantDeath(e) {
  if (e.var === 'acid') {
    spawnArea('acid', e.x, e.y, { r: 20 + e.r, life: 3.2, dmg: e.dmg * 0.6 });
    FX.burst(e.x, e.y, 6, '#7dff3a', 110, 0.3, 4);
  } else if (e.var === 'volatile') {
    const R = 44 + e.r, dmg = e.dmg * 1.6;
    warnCircle(e.x, e.y, R, 0.55, w => {
      FX.explosion(w.x, w.y, R * 0.55, '#ff8a1f'); FX.ering(w.x, w.y, 6, R, 0.3, '#ffd08a', 1.4, true);
      if (onScreen(w, 0)) AUDIO.sfx('boom');
      if (d2(w.x, w.y, P.x, P.y) < (R + P.r * 0.5) ** 2) hurtPlayer(dmg, null);
      eachEnemyIn(w.x, w.y, R, n => { if (!n.boss) hitEnemy(n, n.maxHp * 0.45 + 8, { src: 'hazard', nocrit: true, kb: 140 }); });
    });
  }
}
// энергощит: вертикальный шестигранник вокруг корпуса, вспыхивает от попаданий
function drawVariantShield(c, e) {
  const r = e.r * 1.5 + 3, f = e.shF > 0 ? 1 : 0, q = e.shp / e.shpMax, rot = G.time * 0.8 + e.id;
  uprightAt(c, e.x, bodyY(e));
  c.beginPath();
  for (let i = 0; i <= 6; i++) { const a = rot + i * TAU / 6, px = Math.cos(a) * r, py = Math.sin(a) * r * 0.92; i ? c.lineTo(px, py) : c.moveTo(px, py); }
  c.fillStyle = rgba('#ffd23f', 0.05 + 0.1 * f); c.fill();
  c.strokeStyle = rgba(f ? '#ffffff' : '#ffd23f', 0.35 + 0.4 * q + 0.25 * f); c.lineWidth = 1.2; c.stroke();
}
