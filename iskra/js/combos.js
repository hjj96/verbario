'use strict';
/* ===== Комбинации: реакции статусов на одной цели и связки орудий (данные — в data.js) ===== */

/* ---------- Реакции ---------- */
// урон реакции: доля прочности рядовой машины или плоский урон, растущий с минутами (боссам — плоский)
function rxDmg(e, pct, flat) {
  const fl = flat * P.stats.might * (1 + minutes() * 0.12);
  if (e.boss) return fl * 1.5;
  return Math.max(fl, e.maxHp * pct * (e.elite || e.lt ? 0.25 : 1));
}
const RXO = (src, extra) => Object.assign({ src, nocrit: true, combo: true }, extra);
// реакционные лужи и облака ограничены по числу — толпа не превращается в слайд-шоу
function fxAreas(src) { let n = 0; for (const a of G.areas) if (a.src === src) n++; return n; }
const RX = {
  thermo(e) {
    const s = e.st;
    s.burnT = 0; s.freezeT = 0; s.frost = 0; s.chillT = Math.min(s.chillT, 0.3);
    FX.burst(e.x, e.y, 12, '#8fe8ff', 220, 0.5, 6); FX.burst(e.x, e.y, 12, '#ff7a2e', 220, 0.5, 6);
    FX.ring(e.x, e.y, 6, 64, 0.35, '#ffffff', 3); AUDIO.sfx('thermo');
    hitEnemy(e, rxDmg(e, 0.3, 40), RXO('rx_thermo'));
    eachEnemyIn(e.x, e.y, 56 * P.stats.area, n => { if (n !== e) hitEnemy(n, rxDmg(n, 0.1, 14), RXO('rx_thermo', { kb: 120 })); });
  },
  plasma(e) {
    e.st.burnT = Math.min(e.st.burnT, 0.5);
    hitEnemy(e, rxDmg(e, 0.06, 16), RXO('rx_plasma'));
    const near = [];
    eachEnemyIn(e.x, e.y, 120, n => { if (n !== e && targetable(n) && near.length < 4) near.push(n); });
    for (const n of near) {
      FX.lightning(e.x, e.y, n.x, n.y, '#ffb36b', 1.4, 0.2);
      hitEnemy(n, rxDmg(n, 0.05, 14), RXO('rx_plasma', { burn: 5 * P.stats.burn }));
    }
    FX.burst(e.x, e.y, 10, '#ff9a5a', 200, 0.4, 5); FX.light(e.x, e.y, 80, '#ff9a5a', 0.5); AUDIO.sfx('zap');
  },
  thermite(e) {
    e.st.corrT = 0;
    hitEnemy(e, rxDmg(e, 0.12, 26), RXO('rx_thermite'));
    if (fxAreas('rx_thermite') < 12) spawnArea('fire', e.x, e.y, { r: 34 * P.stats.area, life: 2.4, dmg: 5 * P.stats.might, tick: 0.3, burn: 4 * P.stats.burn, corr: 0.2, src: 'rx_thermite', combo: true, col: '#ffcf5a' });
    FX.sparks(e.x, e.y, 14, '#fff2c8', 260); FX.light(e.x, e.y, 70, '#ffd08a', 0.5); AUDIO.sfx('flame');
  },
  super(e) {
    let cur = e;
    const hit = new Set([e]), o = { chill: 0.4, frost: 40, freeze: 1.2 };
    hitEnemy(e, rxDmg(e, 0.05, 14), RXO('rx_super', o));
    for (let i = 0; i < 5; i++) {
      let nx = null, bd = 150 * 150;
      eachEnemyIn(cur.x, cur.y, 150, n => {
        if (hit.has(n) || !targetable(n)) return;
        let d = d2(cur.x, cur.y, n.x, n.y); if (n.st.chillT > 0) d *= 0.5;
        if (d < bd) { bd = d; nx = n; }
      });
      if (!nx) break;
      FX.lightning(cur.x, cur.y, nx.x, nx.y, '#bff6ff', 1.6, 0.22);
      hit.add(nx);
      hitEnemy(nx, rxDmg(nx, 0.05, 16), RXO('rx_super', o));
      cur = nx;
    }
    AUDIO.sfx('freeze');
  },
  brittle(e) {
    const s = e.st;
    s.freezeT = 0; s.frost = 0; s.corrT = 0;
    FX.shards(e.x, e.y, 16, '#dfffe8', 260); FX.ring(e.x, e.y, 6, 60, 0.3, '#c8ffd8', 3); AUDIO.sfx('clank'); AUDIO.sfx('freeze');
    hitEnemy(e, rxDmg(e, 0.35, 36), RXO('rx_brittle'));
    eachEnemyIn(e.x, e.y, 64 * P.stats.area, n => { if (n !== e) hitEnemy(n, rxDmg(n, 0.06, 12), RXO('rx_brittle', { chill: 0.3, frost: 25 })); });
  },
  short(e) {
    e.st.corrT = 0;
    FX.ring(e.x, e.y, 6, 70, 0.3, '#c9a6ff', 3);
    for (let i = 0; i < 4; i++) { const a = rand(0, TAU); FX.lightning(e.x, e.y, e.x + Math.cos(a) * 55, e.y + Math.sin(a) * 55, '#c9a6ff', 1.2, 0.15); }
    AUDIO.sfx('zap');
    eachEnemyIn(e.x, e.y, 70 * P.stats.area, n => { hitEnemy(n, rxDmg(n, n === e ? 0.1 : 0.04, 30), RXO('rx_short')); });
  },
};
// реакция на цели: не чаще раза в 0,6 с (элите — 1 с, боссу и лейтенанту — 2 с); подпись — не чаще 3 раз в секунду на вид
function react(e, id) {
  if (!e.alive || e.T.prop) return false;
  if ((e.rxT || 0) > G.time) return false;
  e.rxT = G.time + (e.boss || e.lt ? 2 : e.elite ? 1 : 0.6);
  RX[id](e);
  G.rxN = G.rxN || {}; G.rxN[id] = (G.rxN[id] || 0) + 1;
  if (G.rxN[id] === 1 && Object.keys(G.rxN).length >= 4) achieve('rx4');
  G.rxLbl = G.rxLbl || {};
  if ((G.rxLbl[id] || 0) <= G.time) { G.rxLbl[id] = G.time + 0.33; FX.text(e.x, e.y - e.r - 12, REACTIONS[id].name.toUpperCase(), REACTIONS[id].col, 12, { life: 0.9 }); }
  discover('reactions', id);
  return true;
}

/* ---------- Связки орудий ---------- */
// связка жива, пока стоят оба орудия (эволюция — то же орудие); сила — от младшего уровня пары: 65% … 100%
function linkLvl(id) { const w = P.weapons.find(x => baseOf(x) === id); return w ? (w.evo ? 8 : w.lvl) : 0; }
function refreshLinks() {
  const on = P.links || (P.links = {});
  let n = 0;
  for (const L of LINKS) {
    const la = linkLvl(L.a), lb = linkLvl(L.b);
    if (la && lb) {
      const k = 0.6 + 0.05 * Math.min(la, lb);
      if (!on[L.id] && G.state === 'play') {
        UI.banner('СВЯЗКА «' + L.name.toUpperCase() + '»', L.d, 'gold');
        AUDIO.sfx('formUp'); FX.ring(P.x, P.y, 10, 120, 0.6, L.col, 4);
        discover('links', L.id);
      }
      on[L.id] = k; n++;
    } else if (on[L.id]) delete on[L.id];
  }
  if (n >= 3) achieve('link3');
}
const linkK = id => (P.links && P.links[id]) || 0;
// пара, которую достроит орудие id (для карточек улучшений)
function linksFor(id) {
  const out = [];
  for (const L of LINKS) {
    const other = L.a === id ? L.b : L.b === id ? L.a : null;
    if (other) out.push({ L, other, have: !!linkLvl(other) });
  }
  return out;
}
// сингулярность рядом с точкой: поле гравитона или горизонт событий
function wellNear(x, y, R) {
  let best = null, bd = R * R;
  for (const a of G.areas) if (a.kind === 'well') { const d = d2(a.x, a.y, x, y); if (d < bd) { bd = d; best = { x: a.x, y: a.y, r: a.r }; } }
  for (const w of P.weapons) if (w.id === 'horizon' && w.st.h) { const h = w.st.h, d = d2(h.x, h.y, x, y); if (d < bd) { bd = d; best = { x: h.x, y: h.y, r: w.p.radius * w.p.area * h.grow }; } }
  return best;
}
// Метеоры: брошенная магнитом машина взрывается огненным шаром
function meteorBlast(e, w) {
  const k = linkK('meteor'), R = 60 * P.stats.area;
  FX.explosion(e.x, e.y, R, '#ff7a2e', true); FX.addShake(2); AUDIO.sfx('boom');
  eachEnemyIn(e.x, e.y, R, o => { if (o !== e) hitEnemy(o, w.p.dmg * 1.2 * k, { src: 'link_meteor', kb: 140, burn: 5 * P.stats.burn }); });
  if (fxAreas('link_meteor') < 8) spawnArea('fire', e.x, e.y, { r: 32 * P.stats.area, life: 1.4, dmg: 4 * P.stats.might, tick: 0.3, burn: 4 * P.stats.burn, src: 'link_meteor' });
}
// Громовой бумеранг: удар глефы прыгает молнией на соседа
function thunderHop(e, dmg) {
  if (!linkK('thunder') || !icdOk(e, 'thz', 0.25)) return;
  let nx = null, bd = 130 * 130;
  eachEnemyIn(e.x, e.y, 130, n => { if (n !== e && targetable(n)) { const d = d2(e.x, e.y, n.x, n.y); if (d < bd) { bd = d; nx = n; } } });
  if (!nx) return;
  FX.lightning(e.x, e.y, nx.x, nx.y, '#d8c8ff', 1.3, 0.16);
  hitEnemy(nx, dmg * 0.8 * linkK('thunder'), { src: 'link_thunder', stun: 0.25, stunChance: 0.5, kb: 20 });
}
// Парные клинки: взмах выпускает малую глефу
function twinGlaive(dmg, ang) {
  const k = linkK('twin'); if (!k) return;
  G.twinN = ((G.twinN || 0) + 1) % 97;
  const sx = P.x + Math.cos(ang) * 10, sy = P.y - 6 + Math.sin(ang) * 10;
  spawnProj('glaive', sx, sy, 0, 0, { dmg: dmg * 0.9 * k, pierce: 999, r: 11 * P.stats.area, life: 1.4, src: 'link_twin', icd: 0.3, icdKey: 'tw' + G.twinN, kb: 50,
    ang, side: G.twinN % 2 ? -1 : 1, range: 150 * P.stats.area, ox: sx, oy: sy, u: 0, du: 1 / 0.85, rot: rand(0, TAU), len: 10 * Math.sqrt(P.stats.area), col: '#bffbff', wait: 0 });
}
// Огневая поддержка: дроны дублируют выстрел по той же цели
function droneVolley(tgt, dmg) {
  const k = linkK('support'); if (!k || !tgt || !tgt.alive) return;
  const dw = P.weapons.find(w => baseOf(w) === 'drones'); if (!dw || !dw.p) return;
  const st = dw.st, p = dw.p, R = p.orbit * p.area, n = dw.id === 'halo' ? Math.ceil(p.amount / 2) : p.amount;
  for (let i = 0; i < Math.min(4, n); i++) {
    const a = (st.a || 0) + i * TAU / n, x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R, an = Math.atan2(tgt.y - y, tgt.x - x);
    spawnProj('bolt', x, y, Math.cos(an) * 520, Math.sin(an) * 520, { dmg: dmg * 0.7 * k, pierce: 1, r: 3, life: 1.1, src: 'link_support', col: '#7dffb0', kb: 20 });
  }
}
// Детонатор: кольцо ударной волны подрывает мины, которых коснулось
function ringDetonate(a) {
  if (!linkK('detonator')) return;
  for (const m of G.areas) {
    if (m.kind !== 'mine' || m.det || m.life <= 0) continue;
    if (d2(m.x, m.y, a.x, a.y) <= a.r * a.r) { m.det = true; m.boom = true; m.life = 0; FX.ring(m.x, m.y, 4, 30, 0.25, '#ffe066', 2); }
  }
}
// Ржавые пилы: облачко нанитов на удар и надбавка по разъеденным
function rustSawHit(e, p) {
  const k = linkK('rustsaw'); if (!k) return;
  if (e.alive && e.st.corrT > 0) hitEnemy(e, p.dmg * 0.6 * k, { src: 'link_rustsaw', nocrit: true });
  if (icdOk(e, 'rsw', 0.4) && fxAreas('link_rustsaw') < 10) spawnArea('cloud', e.x, e.y, { r: 30 * P.stats.area, life: 2, dmg: 3 * P.stats.might, tick: 0.4, src: 'link_rustsaw' });
}
