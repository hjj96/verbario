'use strict';
/* ===== Ядро игры: состояние, игрок, характеристики, урон, подбор, волны, уровни ===== */

const STEP = 1 / 60;
const GEM_CAP = 340;

const G = {
  state: 'boot', time: 0, rt: 0,
  robot: null, sector: null, threat: 0,
  enemies: [], bigs: [], projs: [], ebullets: [], areas: [], gems: [], items: [], warns: [],
  grid: new Grid(64, 72, 72),
  kills: 0, eid: 0, pendingLevels: 0, pendingChests: [],
  eliteIdx: 0, eventIdx: 0, bossIdx: 0, spawnAcc: 0, propT: 0, nextEliteEndless: 0,
  banished: new Set(), rerolls: 0, banishes: 0,
  dmgBy: {}, scrapRun: 0, bossKills: 0, bossesAlive: 0, evolvedThisRun: [],
  cam: { x: 0, y: 0, zoom: 1 },
  hitstop: 0, freezeT: 0, dmgMul: 1, endless: false, won: false, final: null,
  tf: new Transformer(),
  runAch: new Set(), statusT: 0, lastHurtT: -99,
};
let P = null;

const VIEW = { w: 1, h: 1, dpr: 1, scale: 1, hw: 500, hh: 300 };

/* ---------- Характеристики ---------- */
function xpReq(L) { return Math.round(5 + L * 5 + L * L * 0.42); }

function collectMods() {
  const m = {};
  const add = st => { if (!st) return; for (const k in st) m[k] = (m[k] || 0) + st[k]; };
  add(G.robot.st);
  for (const u of UPGRADES) { const r = (SAVE.upg[u.id] || 0); if (r) for (const k in u.st) m[k] = (m[k] || 0) + u.st[k] * r; }
  for (const id of PART_ORDER) {
    const pr = P.parts[id];
    for (let r = 1; r <= pr.rank; r++) add(partRankDef(id, r, pr.branch).st);
  }
  add(FORMS[P.form].st);
  add(P.fillerSt);
  return m;
}
function computeStats() {
  const m = collectMods(), g = k => m[k] || 0;
  const thr = 1 + G.threat * 0.0;
  const s = {
    maxHp: Math.max(20, Math.round(100 + g('maxHp'))),
    armor: g('armor'), regen: g('regen'),
    speed: 150 * Math.max(0.45, 1 + g('speed')),
    might: 1 + g('might'), area: 1 + g('area'), cdMul: Math.max(0.35, 1 - g('cdr')),
    projSpd: 1 + g('projSpd'), duration: 1 + g('duration'), amount: Math.round(g('amount')),
    magnet: 55 * (1 + g('magnet')), luck: 1 + g('luck'), growth: 1 + g('growth'),
    crit: 0.05 + g('crit'), critDmg: 1.6 + g('critDmg'), greed: 1 + g('greed'),
    odRate: 1 + g('odRate'), odStart: g('odStart'), odDur: 8 + g('odDur'), burn: 1 + g('burn'),
    dashCd: Math.max(0.3, 1 - g('dashCd')), dashCharges: 1 + Math.round(g('dashCharges')),
    kb: 1 + g('kb'), kbRes: clamp(g('kbRes'), 0, 0.95), arcDmg: 1 + g('arcDmg'),
    revive: g('revive'), reroll: g('reroll'), banish: g('banish'), thr,
  };
  return s;
}
function recompute() {
  const prevMax = P.stats ? P.stats.maxHp : null;
  P.stats = computeStats();
  if (prevMax !== null && P.stats.maxHp > prevMax) P.hp += P.stats.maxHp - prevMax;
  P.hp = Math.min(P.hp, P.stats.maxHp);
  P.dash.max = P.stats.dashCharges;
  P.dash.charges = Math.min(P.dash.charges, P.dash.max);
  const core = P.parts.core;
  P.shield.has = core.branch === 'B' && core.rank >= 3;
  P.shield.cd = core.rank >= 4 ? 8 : 12;
  for (const w of P.weapons) computeWeapon(w);
}
function weaponDef(w) { return w.evo ? EVOS[w.id] : WEAPONS[w.id]; }
function computeWeapon(w) {
  const def = weaponDef(w);
  const p = Object.assign({}, def.base);
  if (!w.evo) for (let i = 0; i < w.lvl - 1; i++) { const L = def.levels[i]; for (const k in L) if (k !== 'd') p[k] = (p[k] || 0) + L[k]; }
  const S = P.stats;
  const base = w.evo ? EVOS[w.id].from : w.id;
  p.dmg = (p.dmg || 0) * S.might * (base === 'arc' ? S.arcDmg : 1);
  if (p.cd) p.cd = p.cd * S.cdMul;
  p.area = (p.area || 1) * S.area;
  if (p.speed) p.speed *= S.projSpd;
  if (p.dur) p.dur *= S.duration;
  if (p.amount !== undefined) p.amount += S.amount;
  if (p.burn) p.burn *= S.burn;
  w.p = p;
}
function partRank(id) { return P.parts[id].rank; }
function hasBranch(id, b, minRank) { const pr = P.parts[id]; return pr.branch === b && pr.rank >= (minRank || 3); }

/* ---------- Создание забега ---------- */
function newPlayer(robot) {
  const parts = {};
  for (const k of PART_ORDER) parts[k] = { rank: robot.startParts || 0, branch: null };
  return {
    x: 0, y: 0, vx: 0, vy: 0, r: 13, face: 1, wp: 0, dist: 0, moving: 0,
    hp: 100, stats: null, weapons: [], parts, form: 0, fillerSt: {},
    xp: 0, level: 1, xpNext: xpReq(1),
    iframes: 0, hurtFlash: 0, fire: 0,
    dash: { charges: 1, max: 1, cdT: 0, t: 0, dx: 1, dy: 0, trailT: 0 },
    od: { meter: 0, active: false, t: 0, count: 0 },
    shield: { has: false, ready: true, t: 0, cd: 12 },
    revives: 0, phoenixUsed: false, still: 0, siege: false,
    look: null, featherT: 0, haloT: 0, ramT: 0, pulseT: 40, citadelT: 0, regenAcc: 0,
    time() { return G.time; },
  };
}

function startRun(robotId, sectorId, threat) {
  const robot = ROBOTS.find(r => r.id === robotId) || ROBOTS[0];
  const sector = SECTORS.find(s => s.id === sectorId) || SECTORS[0];
  G.robot = robot; G.sector = sector; G.threat = threat || 0;
  G.time = 0; G.rt = 0;
  G.enemies.length = 0; G.bigs.length = 0; G.projs.length = 0; G.ebullets.length = 0; G.areas.length = 0;
  G.gems.length = 0; G.items.length = 0; G.warns.length = 0;
  G.kills = 0; G.eid = 0; G.pendingLevels = 0; G.pendingChests.length = 0;
  G.eliteIdx = 0; G.eventIdx = 0; G.bossIdx = 0; G.spawnAcc = 0; G.propT = 4; G.nextEliteEndless = 0;
  G.banished = new Set(); G.dmgBy = {}; G.scrapRun = 0; G.bossKills = 0; G.bossesAlive = 0; G.evolvedThisRun = [];
  G.hitstop = 0; G.freezeT = 0; G.endless = false; G.won = false; G.final = null;
  G.runAch = new Set(); G.statusT = 0; G.lastHurtT = -99; G.pendingWin = false; G.dmgTaken = 0; G.endlessBossT = undefined;
  G.tf.clear(); FX.clear(); LATER.length = 0;
  RENDER.ghostKey = '';
  P = newPlayer(robot);
  P.stats = computeStats();
  P.hp = P.stats.maxHp;
  P.revives = P.stats.revive;
  G.rerolls = 2 + P.stats.reroll; G.banishes = 1 + P.stats.banish;
  P.od.meter = P.stats.odStart;
  P.dash.charges = P.stats.dashCharges;
  let wid = robot.weapon;
  if (!wid) wid = pick(WEAPON_ORDER);
  addWeapon(wid);
  P.form = formFor(totalRanks());
  P.look = makeLook(robot, P.parts, P.form, 0);
  G.cam.x = 0; G.cam.y = 0; G.cam.zoom = 1;
  buildEnemySprites(sector.pal);
  buildBackground(sector);
  recompute();
  P.hp = P.stats.maxHp;
  G.state = 'play';
  SAVE.stats.runs = (SAVE.stats.runs || 0) + 1;
  discover('weapons', wid);
  AUDIO.music(2, SECTORS.indexOf(sector));
  UI.onRunStart();
}

function addWeapon(id) {
  const w = { id, lvl: 1, evo: false, t: 0.3, st: {}, p: null };
  P.weapons.push(w);
  if (P.stats) computeWeapon(w);
  discover('weapons', id);
  return w;
}
function totalRanks() { let s = 0; for (const k of PART_ORDER) s += P.parts[k].rank; return s; }
function formFor(total) { let f = 0; for (let i = 0; i < FORMS.length; i++) if (total >= FORMS[i].at) f = i; return f; }

/* ---------- Поиск целей ---------- */
function rebuildGrid() {
  const g = G.grid;
  g.reset(P.x, P.y);
  G.bigs.length = 0;
  for (const e of G.enemies) { if (!e.alive) continue; if (e.r > 22) G.bigs.push(e); else g.insert(e); }
}
function eachEnemyIn(x, y, r, fn) {
  G.grid.each(x, y, r + 22, e => {
    if (!e.alive) return;
    const rr = r + e.r;
    if (d2(x, y, e.x, e.y) <= rr * rr) return fn(e);
  });
  for (let i = 0; i < G.bigs.length; i++) {
    const e = G.bigs[i];
    if (!e.alive) continue;
    const rr = r + e.r;
    if (d2(x, y, e.x, e.y) <= rr * rr) if (fn(e) === true) return;
  }
}
function targetable(e) { return e.alive && !e.T.prop && !e.phased; }
function nearestEnemy(x, y, maxD, skip) {
  let best = null, bd = (maxD || 1e9) * (maxD || 1e9);
  for (const e of G.enemies) {
    if (!targetable(e) || (skip && skip.has(e))) continue;
    const d = d2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function nearestK(x, y, k, maxD) {
  const out = [], md = maxD * maxD;
  for (const e of G.enemies) {
    if (!targetable(e)) continue;
    const d = d2(x, y, e.x, e.y);
    if (d > md) continue;
    if (out.length < k) { out.push({ e, d }); out.sort((a, b) => a.d - b.d); }
    else if (d < out[k - 1].d) { out[k - 1] = { e, d }; out.sort((a, b) => a.d - b.d); }
  }
  return out.map(o => o.e);
}
function onScreen(e, m) {
  m = m || 0;
  return Math.abs(e.x - G.cam.x) < VIEW.hw + m && Math.abs(e.y - G.cam.y) < VIEW.hh + m;
}
function randomOnScreen(skip) {
  const list = [];
  for (const e of G.enemies) if (targetable(e) && onScreen(e, -10) && !(skip && skip.has(e))) list.push(e);
  return list.length ? pick(list) : null;
}
function densestPoint(maxD, samples) {
  let best = null, bc = -1;
  for (let i = 0; i < (samples || 10); i++) {
    const e = randomOnScreen();
    if (!e) break;
    if (maxD && d2(P.x, P.y, e.x, e.y) > maxD * maxD) continue;
    let n = 0;
    eachEnemyIn(e.x, e.y, 80, () => { n++; });
    if (n > bc) { bc = n; best = e; }
  }
  return best;
}

/* ---------- Урон по врагам ---------- */
const NOOPT = {};
function bossy(e) { return e.boss || !!e.parent || !!(e.ai && e.ai.node); }
function hitEnemy(e, dmg, o) {
  if (!e.alive || e.inv) return 0;
  if (e.parent) {
    if (e.flash < -0.14) e.flash = 0.07;
    const B = e.parent;
    if (!B.alive || !icdOk(B, 'seg' + ((o && o.src) || ''), 0.12)) return 0;
    return hitEnemy(B, dmg * 0.6, o);
  }
  o = o || NOOPT;
  let d = dmg * G.dmgMul;
  let crit = false;
  if (!o.nocrit && Math.random() < P.stats.crit) { crit = true; d *= P.stats.critDmg; if (hasBranch('head', 'A', 5)) d *= 1.15; }
  const s = e.st;
  if (s.corrT > 0) d *= 1 + s.corr;
  if (s.markT > 0) d *= 1.15;
  if (s.freezeT > 0 && P.zeroBonus) d *= 1.5;
  if (e.shieldT > 0) d *= 0.5;
  if (e.T.armor) d *= 1 - e.T.armor;
  if (e.dmgRes) d *= 1 - e.dmgRes;
  const before = e.hp;
  e.hp -= d;
  if (e.flash < -0.14) e.flash = 0.07;
  const real = Math.min(before, d);
  const src = o.src || 'other';
  G.dmgBy[src] = (G.dmgBy[src] || 0) + real;
  if (FX.dmgNumbers && (crit || (FX.texts.length < 26 && d >= 2 && Math.random() < 0.45))) FX.dmg(e.x, e.y - e.r, d, crit);
  if (o.kb) {
    const res = (e.T.kbRes || 0) + (e.boss ? 0.92 : 0) + (e.elite ? 0.5 : 0);
    if (res < 1) {
      let kx = o.kx, ky = o.ky;
      if (kx === undefined) { const dx = e.x - P.x, dy = e.y - P.y, l = Math.hypot(dx, dy) || 1; kx = dx / l; ky = dy / l; }
      const k = o.kb * (1 - res) * P.stats.kb;
      e.kbx += kx * k; e.kby += ky * k;
    }
  }
  if (o.burn) applyBurn(e, o.burn);
  if (o.chill) applyChill(e, o.chill, o.frost || 0, o.freeze);
  if (o.corrode) { s.corr = Math.max(s.corr, o.corrode); s.corrT = Math.max(s.corrT, 2.5); }
  if (o.stun && (o.stunChance === undefined || Math.random() < o.stunChance)) {
    if (!e.boss) { s.stunT = Math.max(s.stunT, o.stun); if (s.corrT > 0 && !o.combo) shortCircuit(e); }
  }
  if (crit) {
    if (hasBranch('head', 'A', 4)) s.markT = 3;
    if (hasBranch('head', 'A', 5) && !o.combo && Math.random() < 0.25) critChain(e, d);
  }
  if (e.hp <= 0) killEnemy(e, o);
  return d;
}
function applyBurn(e, dps) {
  const s = e.st;
  if (s.freezeT > 0 && !e.boss) { thermoShock(e); return; }
  s.burn = Math.max(s.burn, dps); s.burnT = Math.max(s.burnT, 2.6);
}
function applyChill(e, slow, frost, freezeDur) {
  const s = e.st;
  s.chill = Math.max(s.chill, slow); s.chillT = Math.max(s.chillT, 1.2);
  if (e.boss) return;
  s.frost += frost;
  if (s.frost >= 100) {
    s.frost = 0;
    if (s.burnT > 0) { thermoShock(e); return; }
    s.freezeT = freezeDur || 1.5;
    AUDIO.sfx('freeze');
  }
}
function thermoShock(e) {
  const s = e.st;
  s.burnT = 0; s.freezeT = 0; s.frost = 0;
  const dmg = Math.max(e.maxHp * 0.3, 40 * P.stats.might);
  FX.text(e.x, e.y - 18, 'ТЕРМОШОК', '#ffd36b', 13, { life: 0.9 });
  FX.burst(e.x, e.y, 12, '#8fe8ff', 220, 0.5, 6);
  FX.burst(e.x, e.y, 12, '#ff7a2e', 220, 0.5, 6);
  FX.ring(e.x, e.y, 6, 60, 0.35, '#ffffff', 3);
  AUDIO.sfx('thermo');
  hitEnemy(e, dmg, { src: 'combo', nocrit: true, combo: true });
  eachEnemyIn(e.x, e.y, 50, n => { if (n !== e) hitEnemy(n, dmg * 0.35, { src: 'combo', nocrit: true, combo: true }); });
}
function shortCircuit(e) {
  const dmg = 30 * P.stats.might;
  FX.ring(e.x, e.y, 6, 70, 0.3, '#c9a6ff', 3);
  for (let i = 0; i < 4; i++) { const a = rand(0, TAU); FX.lightning(e.x, e.y, e.x + Math.cos(a) * 55, e.y + Math.sin(a) * 55, '#c9a6ff', 1.2, 0.15); }
  AUDIO.sfx('zap');
  eachEnemyIn(e.x, e.y, 70, n => { hitEnemy(n, dmg, { src: 'combo', nocrit: true, combo: true }); });
  e.st.corrT = 0;
}
function critChain(e, d) {
  let cur = e;
  const hit = new Set([e]);
  for (let i = 0; i < 3; i++) {
    let nx = null, bd = 120 * 120;
    eachEnemyIn(cur.x, cur.y, 120, n => { if (!hit.has(n) && targetable(n)) { const dd = d2(cur.x, cur.y, n.x, n.y); if (dd < bd) { bd = dd; nx = n; } } });
    if (!nx) break;
    FX.lightning(cur.x, cur.y, nx.x, nx.y, '#ff4d5e', 1.2, 0.14);
    hit.add(nx);
    hitEnemy(nx, d * 0.3, { src: 'crit', nocrit: true, combo: true });
    cur = nx;
  }
}

function killEnemy(e, o) {
  if (!e.alive) return;
  e.alive = false;
  const T = e.T;
  if (T.prop) {
    FX.debris(e.x, e.y, 10, '#5d6673', 160); FX.sparks(e.x, e.y, 8, '#ffb43d', 200);
    AUDIO.sfx('kill');
    dropPropLoot(e);
    return;
  }
  if (e.boss) { bossKilled(e); return; }
  G.kills++;
  const odGain = (e.elite ? 7 : 0.38) * P.stats.odRate;
  if (!P.od.active) P.od.meter = Math.min(100, P.od.meter + odGain);
  const m = G.time / 60;
  const xp = e.xp * (1 + m * 0.02) * (e.elite ? 10 : 1);
  dropGem(e.x, e.y, xp);
  if (e.ate) dropGem(e.x + 6, e.y, e.ate * 1.5);
  const luck = P.stats.luck;
  if (Math.random() < 0.018 * luck) dropItem(e.x, e.y, 'scrap', randi(1, 3));
  if (Math.random() < 0.0025 * luck) dropItem(e.x, e.y, 'heal');
  if (e.elite) dropItem(e.x, e.y, 'chest');
  // эффекты гибели
  const col = G.sector.pal.enemy;
  FX.debris(e.x, e.y, e.elite ? 12 : 3, col, 140);
  FX.sparks(e.x, e.y, e.elite ? 14 : 3, e.T.acc, 160);
  if (e.elite) { FX.explosion(e.x, e.y, 40, '#ffd36b', true); AUDIO.sfx('boom', { big: true }); }
  AUDIO.sfx('kill');
  if (T.split) for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + rand(-0.3, 0.3); spawnEnemy(T.split, e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10); }
  // эффекты орудий
  if (P.gooOn && d2(e.x, e.y, P.x, P.y) < P.gooR * P.gooR) spawnArea('cloud', e.x, e.y, { r: 40 * P.stats.area, life: 2, dmg: 5 * P.stats.might, tick: 0.3, src: 'goo' });
  if (P.novaOn && e.st.burnT > 0) { FX.explosion(e.x, e.y, 22, '#ffb35c'); eachEnemyIn(e.x, e.y, 38 * P.stats.area, n => { hitEnemy(n, 20 * P.stats.might, { src: 'supernova', nocrit: true }); }); }
  if (P.zeroBonus && e.st.freezeT > 0) {
    FX.burst(e.x, e.y, 8, '#d8f7ff', 180, 0.4, 5);
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + rand(-0.2, 0.2); spawnProj('shard', e.x, e.y, Math.cos(a) * 340, Math.sin(a) * 340, { dmg: 15 * P.stats.might, pierce: 2, r: 4, life: 0.5, src: 'zero' }); }
  }
}

/* ---------- Урон по игроку ---------- */
function hurtPlayer(dmg, src) {
  if (G.state !== 'play' || P.iframes > 0 || P.od.active || G.tf.blocking || P.dash.t > 0 || DEBUG_GOD) return;
  const S = P.stats;
  if (P.shield.has && P.shield.ready) {
    P.shield.ready = false; P.shield.t = P.shield.cd; P.iframes = 0.6;
    FX.ring(P.x, P.y, 10, 60, 0.4, '#ff9a4a', 4); FX.burst(P.x, P.y, 14, '#ffb36b', 200, 0.4, 5);
    AUDIO.sfx('shield');
    if (P.parts.core.rank >= 4) { FX.explosion(P.x, P.y, 70, '#ff7a35', true); eachEnemyIn(P.x, P.y, 120 * S.area, e => { hitEnemy(e, 50 * S.might, { src: 'core', kb: 200, nocrit: true }); }); }
    return;
  }
  if (hasBranch('core', 'A', 4) && Math.random() < 0.12) { P.iframes = 0.3; FX.text(P.x, P.y - 30, 'ПОГЛОЩЕНО', '#ffb43d', 12); FX.ring(P.x, P.y, 8, 40, 0.25, '#ffb43d', 2); return; }
  const d = Math.max(1, dmg * G.sector.dmg * (1 + G.threat * 0.08) - S.armor);
  P.hp -= d; P.iframes = 0.42; P.hurtFlash = 1; G.lastHurtT = G.time; G.dmgTaken = (G.dmgTaken || 0) + d;
  FX.addShake(4); FX.flash('#ff2a3a', 0.18);
  FX.text(P.x, P.y - 30, '−' + Math.round(d), '#ff4d5e', 13);
  AUDIO.sfx('hurt');
  if (src && src.alive && hasBranch('core', 'A')) {
    const th = (P.parts.core.rank >= 4 ? 30 : 15) * S.might;
    hitEnemy(src, th, { src: 'core', kb: 160, nocrit: true });
  }
  if (hasBranch('core', 'A', 5) && G.time - P.citadelT > 0.8) {
    P.citadelT = G.time;
    FX.ring(P.x, P.y, 10, 130, 0.4, '#ffb43d', 5);
    eachEnemyIn(P.x, P.y, 130 * S.area, e => { hitEnemy(e, 40 * S.might, { src: 'core', kb: 260, nocrit: true }); });
  }
  if (P.hp <= 0) playerDown();
}
function playerDown() {
  if (hasBranch('core', 'B', 5) && !P.phoenixUsed) {
    P.phoenixUsed = true; revive(0.6, 'ФЕНИКС');
    return;
  }
  if (P.revives > 0) { P.revives--; revive(0.5, 'РЕЗЕРВНАЯ КОПИЯ'); return; }
  P.hp = 0;
  endRun(false);
}
function revive(frac, label) {
  P.hp = P.stats.maxHp * frac; P.iframes = 2.5;
  FX.flash('#ffd36b', 0.8); FX.addShake(12);
  FX.explosion(P.x, P.y, 140, '#ff7a35', true);
  FX.ring(P.x, P.y, 10, 380, 0.8, '#ffd36b', 6);
  eachEnemyIn(P.x, P.y, 300, e => { if (e.parent) return; if (!bossy(e)) hitEnemy(e, 9999, { src: 'core', nocrit: true }); else hitEnemy(e, 300, { src: 'core', nocrit: true }); });
  AUDIO.sfx('formBoom');
  UI.banner(label, 'Корпус восстановлен', 'gold');
}

/* ---------- Подбор ---------- */
function dropGem(x, y, v) {
  if (G.gems.length >= GEM_CAP) {
    // переполнение: самый дальний от игрока кристалл вливается в новый, у места боя
    let fi = 0, fd = -1;
    for (let i = 0; i < G.gems.length; i++) { const g = G.gems[i]; if (g.mag) continue; const d = d2(g.x, g.y, P.x, P.y); if (d > fd) { fd = d; fi = i; } }
    v += G.gems[fi].v;
    G.gems[fi].dead = true;
    removeAt(G.gems, fi);
  }
  G.gems.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), v, tier: gemTier(v), mag: false, sp: 0, t: rand(0, 6) });
}
function dropItem(x, y, kind, v) { G.items.push({ x, y, kind, v: v || 0, t: 0, mag: false, sp: 0 }); }
function dropPropLoot(e) {
  const r = Math.random();
  const kind = r < 0.36 ? 'heal' : r < 0.62 ? 'scrap' : r < 0.76 ? 'magnet' : r < 0.9 ? 'bomb' : 'freeze';
  dropItem(e.x, e.y, kind, kind === 'scrap' ? randi(3, 8) : 0);
}
function gainXp(v) {
  P.xp += v * P.stats.growth;
  while (P.xp >= P.xpNext) {
    P.xp -= P.xpNext; P.level++; P.xpNext = xpReq(P.level); G.pendingLevels++;
    if (P.level >= 50) achieve('lvl50');
  }
}
function heal(v) {
  const before = P.hp;
  P.hp = Math.min(P.stats.maxHp, P.hp + v);
  if (P.hp - before >= 1) FX.text(P.x, P.y - 32, '+' + Math.round(P.hp - before), '#5dff9b', 13);
}
function collectItem(it) {
  switch (it.kind) {
    case 'heal': heal(30 + P.stats.maxHp * 0.12); AUDIO.sfx('heal'); FX.ring(P.x, P.y, 8, 50, 0.35, '#5dff9b', 3); break;
    case 'scrap': { const v = Math.round(it.v * P.stats.greed * G.sector.scrap); G.scrapRun += v; FX.text(P.x, P.y - 34, '+' + v + ' лома', '#ffb43d', 12); AUDIO.sfx('coin'); break; }
    case 'magnet': for (const g of G.gems) g.mag = true; AUDIO.sfx('pick'); FX.ring(P.x, P.y, 10, 300, 0.6, '#46e3ff', 3); break;
    case 'bomb': empBlast(); break;
    case 'freeze': G.freezeT = 5; AUDIO.sfx('freeze'); FX.flash('#8fe8ff', 0.4); UI.banner('СТОП-КАДР', 'Рой заморожен на 5 с', 'cyan'); break;
    case 'chest': case 'bigchest': G.pendingChests.push(it.kind === 'bigchest'); break;
  }
}
function empBlast() {
  FX.flash('#ff4f9a', 0.6); FX.addShake(10);
  FX.ring(P.x, P.y, 20, Math.max(VIEW.hw, VIEW.hh) * 1.3, 0.7, '#ff4f9a', 8);
  AUDIO.sfx('boom', { big: true });
  for (const e of G.enemies) if (e.alive && !e.T.prop && !e.parent && onScreen(e, 40)) hitEnemy(e, bossy(e) ? e.maxHp * 0.04 : Math.max(200, e.maxHp * 0.6), { src: 'emp', nocrit: true });
}
function updatePickups(dt) {
  const mr = P.stats.magnet, mr2 = mr * mr, cr = P.r + 7, cr2 = cr * cr;
  const arr = G.gems;
  for (let i = arr.length - 1; i >= 0; i--) {
    const g = arr[i];
    g.t += dt;
    const dd = d2(g.x, g.y, P.x, P.y);
    if (!g.mag && dd < mr2) g.mag = true;
    if (g.mag) {
      g.sp = Math.min(g.sp + 900 * dt, 900);
      const d = Math.sqrt(dd) || 1;
      const s = Math.max(g.sp, 120);
      g.x += (P.x - g.x) / d * s * dt; g.y += (P.y - g.y) / d * s * dt;
      if (dd < cr2 || d < s * dt) { gainXp(g.v); AUDIO.sfx('gem'); g.dead = true; removeAt(arr, i); }
    }
  }
  const it = G.items;
  for (let i = it.length - 1; i >= 0; i--) {
    const o = it[i];
    o.t += dt;
    const dd = d2(o.x, o.y, P.x, P.y);
    const isChest = o.kind === 'chest' || o.kind === 'bigchest';
    if (!o.mag && dd < (isChest ? 30 * 30 : mr2 * 0.5)) o.mag = true;
    if (o.mag) {
      o.sp = Math.min(o.sp + 700 * dt, 700);
      const d = Math.sqrt(dd) || 1, s = Math.max(o.sp, 100);
      o.x += (P.x - o.x) / d * s * dt; o.y += (P.y - o.y) / d * s * dt;
      if (dd < (cr + 4) * (cr + 4)) { collectItem(o); removeAt(it, i); continue; }
    }
    if (!isChest && o.t > 60 && !o.mag) removeAt(it, i);
  }
}

/* ---------- Игрок ---------- */
function updatePlayer(dt) {
  const S = P.stats;
  const mv = INPUT.move();
  let sp = S.speed * (P.od.active ? 1.2 : 1);
  if (P.dash.t > 0) {
    P.dash.t -= dt;
    const ds = 640;
    P.x += P.dash.dx * ds * dt; P.y += P.dash.dy * ds * dt;
    if (Math.random() < 0.9) FX.ghosts.push({ x: P.x, y: P.y, life: 0.25, max: 0.25, face: P.face });
    if (hasBranch('legs', 'B') && !hasBranch('legs', 'B', 5)) {
      P.dash.trailT -= dt;
      if (P.dash.trailT <= 0) { P.dash.trailT = 0.03; spawnArea('fire', P.x, P.y + 12, { r: 20, life: 2.2, dmg: (P.parts.legs.rank >= 4 ? 9 : 5) * S.might, tick: 0.25, burn: 4 * S.burn, src: 'legs' }); }
    }
    if (hasBranch('legs', 'A', 5)) {
      eachEnemyIn(P.x, P.y, P.r + 14, e => {
        if (P.dash.hit.has(e)) return;
        P.dash.hit.add(e);
        hitEnemy(e, 80 * S.might, { src: 'legs', kb: 360, kx: P.dash.dx, ky: P.dash.dy, stun: 0.8 });
        FX.sparks(e.x, e.y, 6, '#ffd23f', 240);
      });
    }
  } else {
    P.vx = mv.x * sp; P.vy = mv.y * sp;
    P.x += P.vx * dt; P.y += P.vy * dt;
  }
  const moving = Math.hypot(mv.x, mv.y);
  P.moving = lerp(P.moving, moving > 0.1 ? 1 : 0, 1 - Math.exp(-10 * dt));
  if (mv.x > 0.15) P.face = 1; else if (mv.x < -0.15) P.face = -1;
  P.wp += dt * (6 + S.speed / 30) * moving;
  P.dist += Math.hypot(P.vx, P.vy) * dt;
  if (moving < 0.1) P.still += dt; else P.still = 0;
  P.siege = hasBranch('arms', 'A', 5) && P.still > 0.7;
  G.dmgMul = (P.od.active ? 1.5 : 1) * (P.siege ? 1.35 : 1);
  // рывок
  if (P.dash.charges < P.dash.max) {
    P.dash.cdT -= dt;
    if (P.dash.cdT <= 0) { P.dash.charges++; P.dash.cdT = (P.dash.charges < P.dash.max) ? 2.6 * S.dashCd : 0; }
  }
  if (INPUT.consume('dash')) tryDash(mv);
  if (INPUT.consume('od')) tryOverdrive();
  // таймеры
  if (P.iframes > 0) P.iframes -= dt;
  P.hurtFlash = Math.max(0, P.hurtFlash - dt * 3);
  P.fire = Math.max(0, P.fire - dt * 6);
  if (S.regen > 0 && P.hp < S.maxHp) { P.hp = Math.min(S.maxHp, P.hp + S.regen * dt); }
  if (P.shield.has && !P.shield.ready) { P.shield.t -= dt; if (P.shield.t <= 0) { P.shield.ready = true; FX.ring(P.x, P.y, 30, 16, 0.3, '#ff9a4a', 2); } }
  // овердрайв
  if (P.od.active) {
    P.od.t -= dt;
    P.od.meter = Math.max(0, 100 * P.od.t / S.odDur);
    if (Math.random() < 0.6) FX.ghosts.push({ x: P.x, y: P.y, life: 0.18, max: 0.18, face: P.face, od: true });
    if (P.od.t <= 0) endOverdrive();
  } else if (P.od.meter < 100) {
    P.od.meter = Math.min(100, P.od.meter + 0.12 * S.odRate * dt);
  }
  // давление гусеницами
  if (hasBranch('legs', 'A') && P.moving > 0.3) {
    P.ramT -= dt;
    if (P.ramT <= 0) {
      P.ramT = 0.3;
      const dmg = (P.parts.legs.rank >= 4 ? 26 : 13) * S.might;
      eachEnemyIn(P.x, P.y + 10, P.r + 10, e => { if (!e.T.prop || true) { hitEnemy(e, dmg, { src: 'legs', kb: 140, nocrit: true }); FX.sparks(e.x, e.y, 3, '#ffd23f', 160); } });
    }
  }
  // перья
  if (hasBranch('back', 'A')) {
    P.featherT -= dt * (P.od.active ? 2 : 1);
    if (P.featherT <= 0) {
      const r = P.parts.back.rank;
      P.featherT = 2.4 * S.cdMul;
      const n = r === 3 ? 2 : r === 4 ? 4 : 6;
      const dmg = (r >= 5 ? 20 : 12) * S.might;
      for (let i = 0; i < n; i++) {
        const s = i % 2 ? 1 : -1, a = -Math.PI / 2 + s * (0.5 + (i >> 1) * 0.35);
        spawnProj('feather', P.x + s * 10, P.y - 18, Math.cos(a) * 260, Math.sin(a) * 260, { dmg, pierce: 1, r: 5, life: 2.2, src: 'back', homing: 7, speed: 420 * S.projSpd, delay: 0.18 });
      }
    }
  }
  // гало-кольцо
  if (hasBranch('back', 'B')) {
    P.haloT -= dt;
    if (P.haloT <= 0) {
      P.haloT = 0.4;
      const r = P.parts.back.rank;
      const rad = (r >= 5 ? 72 : 48) * S.area, dmg = (r >= 4 ? 8 : 5) * S.might;
      eachEnemyIn(P.x, P.y, rad, e => { hitEnemy(e, dmg, { src: 'back', nocrit: true, burn: 2 * S.burn }); });
    }
  }
  // импульс радара
  if (hasBranch('head', 'B', 4)) {
    P.pulseT -= dt;
    if (P.pulseT <= 0) { P.pulseT = 40; for (const g of G.gems) g.mag = true; FX.ring(P.x, P.y, 10, 600, 0.9, '#5dff9b', 3); AUDIO.sfx('pick'); }
  }
}
function tryDash(mv) {
  if (P.dash.charges <= 0 || P.dash.t > 0) return;
  let dx = mv.x, dy = mv.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.1) { dx = P.face; dy = 0; } else { dx /= l; dy /= l; }
  if (P.dash.charges === P.dash.max) P.dash.cdT = 2.6 * P.stats.dashCd;
  P.dash.charges--;
  if (hasBranch('legs', 'B', 5)) {
    // фазовый скачок
    const S = P.stats, dist = 160;
    const ox = P.x, oy = P.y;
    blinkBoom(ox, oy);
    P.x += dx * dist; P.y += dy * dist;
    blinkBoom(P.x, P.y);
    P.iframes = Math.max(P.iframes, 0.35);
    for (let i = 0; i < 6; i++) FX.ghosts.push({ x: lerp(ox, P.x, i / 6), y: lerp(oy, P.y, i / 6), life: 0.3, max: 0.3, face: P.face });
    AUDIO.sfx('blink');
    return;
  }
  P.dash.t = 0.17; P.dash.dx = dx; P.dash.dy = dy; P.dash.hit = new Set();
  P.iframes = Math.max(P.iframes, 0.3);
  AUDIO.sfx('dash');
  FX.ring(P.x, P.y, 6, 40, 0.25, '#bff6ff', 2);
}
function blinkBoom(x, y) {
  const S = P.stats;
  FX.explosion(x, y, 50, '#b38bff');
  eachEnemyIn(x, y, 65 * S.area, e => { hitEnemy(e, 55 * S.might, { src: 'legs', kb: 200, nocrit: true }); });
}
function tryOverdrive() {
  if (P.od.active || P.od.meter < 100 || G.tf.busy) return;
  P.od.count++;
  if (P.od.count >= 10) achieve('od10');
  G.tf.push(seqOverdrive(P, {
    onCommit() {
      P.od.active = true; P.od.t = P.stats.odDur;
      eachEnemyIn(P.x, P.y, 170, e => { hitEnemy(e, 30 * P.stats.might, { src: 'od', kb: 300, nocrit: true }); });
      if (hasBranch('back', 'B', 5)) {
        spawnArea('well', P.x, P.y, { r: 200 * P.stats.area, life: 1.6, dmg: 20 * P.stats.might, tick: 0.2, pull: 260, src: 'back', collapse: 200 * P.stats.might });
      }
      UI.banner('ОВЕРДРАЙВ', 'Урон ×1,5 · перезарядка ×2 · неуязвимость', 'magenta');
    },
  }));
}
function endOverdrive() {
  P.od.active = false; P.od.t = 0; P.od.meter = 0;
  P.look.od = 0; refreshLook(P.look);
  AUDIO.sfx('odEnd');
  FX.smoke(P.x, P.y - 10, 14, '#c8ccd6', 10);
  FX.ring(P.x, P.y, 10, 90, 0.4, OD_COLOR, 3);
  P.iframes = Math.max(P.iframes, 0.8);
}

/* ---------- Повышение уровня ---------- */
function unlockedWeapons() { return WEAPON_ORDER; }
function ownedBase(id) { return P.weapons.find(w => (w.evo ? EVOS[w.id].from : w.id) === id); }
function buildPool() {
  const pool = [];
  for (const w of P.weapons) if (!w.evo && w.lvl < 8 && !G.banished.has(w.id)) pool.push({ kind: 'wup', id: w.id, w: 10 });
  if (P.weapons.length < MAX_WEAPONS) for (const id of unlockedWeapons()) if (!ownedBase(id) && !G.banished.has(id)) pool.push({ kind: 'wnew', id, w: 6 });
  for (const id of PART_ORDER) if (P.parts[id].rank < 5 && !G.banished.has('part_' + id)) pool.push({ kind: 'part', id, w: 9 });
  return pool;
}
function rollChoices() {
  const pool = buildPool();
  const n = Math.random() < clamp(0.08 + (P.stats.luck - 1) * 0.6, 0, 0.7) ? 4 : 3;
  const out = [];
  const tmp = pool.slice();
  while (out.length < n && tmp.length) {
    const c = weighted(tmp, x => x.w);
    out.push(c); tmp.splice(tmp.indexOf(c), 1);
  }
  // гарантируем и орудие, и модуль, если возможно
  const hasW = out.some(c => c.kind !== 'part'), hasP = out.some(c => c.kind === 'part');
  if (!hasP) { const alt = tmp.find(c => c.kind === 'part'); if (alt) out[out.length - 1] = alt; }
  else if (!hasW) { const alt = tmp.find(c => c.kind !== 'part'); if (alt) out[out.length - 1] = alt; }
  const fill = shuffle(FILLERS.slice());
  while (out.length < 3) out.push({ kind: 'filler', id: fill.pop().id });
  return out;
}
function openLevelUp() {
  G.state = 'levelup';
  AUDIO.sfx('levelup'); AUDIO.muffle(true);
  UI.showLevelUp(rollChoices());
}
function applyChoice(ch, branch) {
  if (ch.kind === 'wnew') { addWeapon(ch.id); }
  else if (ch.kind === 'wup') { const w = P.weapons.find(x => x.id === ch.id); if (w) { w.lvl = Math.min(8, w.lvl + 1); computeWeapon(w); } }
  else if (ch.kind === 'part') { upgradePart(ch.id, branch); }
  else if (ch.kind === 'filler') {
    const f = FILLERS.find(x => x.id === ch.id);
    if (f.id === 'f_heal') heal(P.stats.maxHp * 0.35);
    else if (f.id === 'f_scrap') { G.scrapRun += Math.round(30 * P.stats.greed); }
    else if (f.st) { for (const k in f.st) P.fillerSt[k] = (P.fillerSt[k] || 0) + f.st[k]; recompute(); }
  }
}
function upgradePart(id, branch, fromChest) {
  const pr = P.parts[id];
  if (pr.rank >= 5) return;
  const nr = pr.rank + 1;
  const br = nr === 3 ? (branch || pr.branch || 'A') : pr.branch;
  pr.rank = nr; pr.branch = br;
  if (nr === 3) { SAVE.branches[id + br] = true; if (Object.keys(SAVE.branches).length >= 10) achieve('branches'); }
  const prevForm = P.form;
  const nf = formFor(totalRanks());
  recompute();
  const def = partRankDef(id, nr, br);
  const subj = P;
  G.tf.push(seqPart(subj, id, nr, br, {
    onCommit() {
      shockwave(P.x, P.y, 150, 25);
      UI.tfBanner(id, nr, br, def);
    },
  }));
  if (nf > prevForm) {
    P.form = nf;
    G.tf.push(seqForm(subj, nf, {
      onStart() { UI.formCard(nf); },
      onCommit() {
        recompute();
        shockwave(P.x, P.y, 380, 9999);
        if (nf >= 2) achieve('form3');
        if (nf >= 4) achieve('formO');
        SAVE.stats.maxForm = Math.max(SAVE.stats.maxForm || 0, nf);
      },
    }));
  }
}
function shockwave(x, y, r, dmg) {
  eachEnemyIn(x, y, r, e => {
    if (e.T.prop || e.parent) return;
    const d = bossy(e) ? Math.min(dmg, e.maxHp * 0.03) : dmg;
    hitEnemy(e, d * (dmg >= 9999 ? 1 : P.stats.might), { src: 'tf', kb: 420, nocrit: true });
  });
}

/* ---------- Контейнеры и эволюции ---------- */
function eligibleEvos() {
  const out = [];
  for (const w of P.weapons) {
    if (w.evo || w.lvl < 8) continue;
    const def = WEAPONS[w.id];
    if (P.parts[def.part].rank >= EVO_RANK) out.push({ w, evo: def.evo });
  }
  return out;
}
function rollChestRewards(big) {
  const rewards = [];
  const evos = eligibleEvos();
  if (evos.length) { const e = evos[0]; rewards.push({ kind: 'evo', id: e.w.id, evo: e.evo }); if (big && evos[1]) rewards.push({ kind: 'evo', id: evos[1].w.id, evo: evos[1].evo }); }
  let n = big ? (Math.random() < 0.3 * P.stats.luck ? 5 : 3) : (Math.random() < 0.12 * P.stats.luck ? 3 : 1);
  if (hasBranch('head', 'B', 5)) n++;
  const simW = {}; for (const w of P.weapons) simW[w.id] = w.lvl;
  const simP = {}; for (const id of PART_ORDER) simP[id] = P.parts[id].rank;
  let guard = 0;
  while (rewards.length < n && guard++ < 20) {
    const opts = [];
    for (const w of P.weapons) if (!w.evo && simW[w.id] < 8 && !rewards.some(r => r.kind === 'evo' && r.id === w.id)) opts.push({ kind: 'wup', id: w.id });
    for (const id of PART_ORDER) if (simP[id] < 5 && simP[id] !== 2) opts.push({ kind: 'part', id });
    if (!opts.length) break;
    const o = pick(opts);
    if (o.kind === 'wup') simW[o.id]++; else { simP[o.id]++; o.rank = simP[o.id]; o.branch = P.parts[o.id].branch; }
    rewards.push(o);
  }
  const scrap = Math.round((big ? randi(25, 45) : randi(6, 14)) * P.stats.greed * G.sector.scrap);
  return { rewards, scrap, big };
}
function openChest(big) {
  G.state = 'chest';
  AUDIO.sfx('chest'); AUDIO.muffle(true);
  UI.showChest(rollChestRewards(big));
}
function applyChestRewards(res) {
  G.scrapRun += res.scrap;
  for (const r of res.rewards) {
    if (r.kind === 'evo') evolveWeapon(r.id, r.evo);
    else if (r.kind === 'wup') { const w = P.weapons.find(x => x.id === r.id); if (w && !w.evo) { w.lvl = Math.min(8, w.lvl + 1); computeWeapon(w); } }
    else if (r.kind === 'part') upgradePart(r.id, null, true);
  }
}
function evolveWeapon(wid, evo) {
  const w = P.weapons.find(x => x.id === wid);
  if (!w) return;
  G.tf.push(seqEvolve(P, evo, {
    onStart() { UI.evolveCard(wid, evo); },
    onCommit() {
      w.id = evo; w.evo = true; w.lvl = 8; w.st = {}; w.t = 0.2;
      computeWeapon(w);
      G.evolvedThisRun.push(evo);
      discover('evolutions', evo);
      achieve('evolve1');
      const n = Object.keys(SAVE.discovered.evolutions || {}).length;
      if (n >= 5) achieve('evolve5');
      if (n >= 13) achieve('evolveAll');
      SAVE.stats.evolutions = (SAVE.stats.evolutions || 0) + 1;
    },
  }));
}

/* ---------- Цикл ---------- */
let DEBUG_GOD = false;
function step(dt) {
  G.rt += dt;
  if (G.tf.blocking) {
    G.tf.update(dt);
    FX.update(dt);
    updateCamera(dt);
    return;
  }
  if (G.hitstop > 0) { G.hitstop -= dt; FX.update(dt); updateCamera(dt); return; }
  G.time += dt;
  director(dt);
  updateLater(dt);
  updateWarns(dt);
  updatePlayer(dt);
  rebuildGrid();
  updateWeapons(dt);
  updateProjectiles(dt);
  updateAreas(dt);
  updateEnemies(dt);
  updateEnemyBullets(dt);
  updatePickups(dt);
  FX.update(dt);
  G.tf.update(dt);
  updateCamera(dt);
  checkProgress();
  if (G.state !== 'play') return;
  if (!G.tf.busy) {
    if (G.pendingWin) { G.pendingWin = false; winRun(); }
    else if (G.pendingChests.length) openChest(G.pendingChests.shift());
    else if (G.pendingLevels > 0) { G.pendingLevels--; openLevelUp(); }
  }
}
function updateCamera(dt) {
  const k = 1 - Math.exp(-8 * dt);
  G.cam.x = lerp(G.cam.x, P.x, k);
  G.cam.y = lerp(G.cam.y, P.y - (G.tf.cur ? 8 : 0), k);
  const tz = G.tf.zoom();
  G.cam.zoom = lerp(G.cam.zoom, tz, 1 - Math.exp(-10 * dt));
}
function checkProgress() {
  const t = G.time;
  if (t >= 300) achieve('survive5');
  if (t >= 600) achieve('survive10');
  if (t >= 1800) achieve('endless30');
  if (G.kills >= 1000) achieve('kills1k');
}

function endRun(victory) {
  if (G.state === 'over') return;
  G.state = 'over';
  AUDIO.music(1); AUDIO.muffle(false);
  AUDIO.sfx(victory ? 'victory' : 'defeat');
  const m = Math.floor(G.time / 60);
  const bonus = Math.round((m * 6 + G.bossKills * 60 + P.level * 2) * G.sector.scrap * (1 + G.threat * 0.15) * P.stats.greed);
  const total = G.scrapRun + bonus;
  SAVE.scrap += total; SAVE.stats.scrapTotal = (SAVE.stats.scrapTotal || 0) + total;
  SAVE.stats.kills = (SAVE.stats.kills || 0) + G.kills;
  if (SAVE.stats.kills >= 10000) achieve('kills10k');
  achieve('first');
  const sid = G.sector.id;
  const best = SAVE.best[sid] || { time: 0, level: 0, kills: 0 };
  const rec = G.time > best.time;
  SAVE.best[sid] = { time: Math.max(best.time, G.time), level: Math.max(best.level, P.level), kills: Math.max(best.kills, G.kills) };
  persist();
  UI.showGameOver({ victory: !!victory, time: G.time, level: P.level, kills: G.kills, form: P.form, scrapRun: G.scrapRun, bonus, total, rec, dmgBy: G.dmgBy, ach: Array.from(G.runAch) });
}
function winRun() {
  G.won = true;
  achieve('win');
  if (G.sector.id === 'hive') achieve('winHive');
  if (G.threat >= 5) achieve('threat5');
  SAVE.threat[G.sector.id] = Math.max(SAVE.threat[G.sector.id] || 0, Math.min(10, G.threat + 1));
  persist();
  G.state = 'victory';
  AUDIO.muffle(true);
  UI.showVictory();
}
function continueEndless() {
  G.endless = true; G.state = 'play'; AUDIO.muffle(false); AUDIO.music(2);
  UI.banner('БЕСКОНЕЧНЫЙ РЕЖИМ', 'Рой не кончается. Сколько продержитесь?', 'magenta');
}

/* ---------- Сохранения и достижения ---------- */
const SAVE_KEY = 'iskra_save_v1';
let SAVE = null;
function defaultSave() {
  return { v: 1, scrap: 0, upg: {}, ach: {}, best: {}, threat: {}, branches: {}, stats: {}, discovered: { weapons: {}, evolutions: {}, enemies: {} },
    settings: { music: 0.55, sfx: 0.75, dmg: true, shake: true, quality: 'auto' }, last: { robot: 'iskra', sector: 'rust', threat: 0 }, seenIntro: false };
}
function loadSave() {
  const d = defaultSave();
  const s = store.get(SAVE_KEY);
  if (s && typeof s === 'object') {
    for (const k in d) if (s[k] !== undefined) d[k] = (typeof d[k] === 'object' && !Array.isArray(d[k])) ? Object.assign({}, d[k], s[k]) : s[k];
    d.discovered = Object.assign({ weapons: {}, evolutions: {}, enemies: {} }, s.discovered || {});
  }
  SAVE = d;
}
function persist() { store.set(SAVE_KEY, SAVE); }
function achieve(id) {
  if (SAVE.ach[id]) return;
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;
  SAVE.ach[id] = true;
  SAVE.scrap += a.r;
  if (G.runAch) G.runAch.add(id);
  persist();
  UI.toast(a);
}
function discover(kind, id) {
  if (!SAVE.discovered[kind]) SAVE.discovered[kind] = {};
  if (!SAVE.discovered[kind][id]) { SAVE.discovered[kind][id] = true; }
}
function robotUnlocked(r) { return !r.unlock || !!SAVE.ach[r.unlock.ach] || DEBUG; }
function sectorUnlocked(s) { return !s.unlock || !!SAVE.ach[s.unlock.ach] || DEBUG; }
