'use strict';
/* ===== Орудия на корпусе: слоты крепления и дульные срезы (сами модули — в robot3d.js) ===== */

const SLOTS = ['armR', 'armL', 'shR', 'shL', 'back', 'chest'];
const SLOT_NAME = { armR: 'правый манипулятор', armL: 'левый манипулятор', shR: 'правое плечо', shL: 'левое плечо', back: 'спинная рама', chest: 'грудной порт' };
const SLOT_PREF = {
  blaster: ['armR', 'armL'], blade: ['armL', 'armR'], flamer: ['armL', 'armR'], cryo: ['armR', 'armL'], saw: ['armL', 'armR'],
  missiles: ['shR', 'shL'], drones: ['shL', 'shR'], arc: ['shR', 'shL'],
  rail: ['back', 'shR'], mines: ['back', 'chest'], gravity: ['chest', 'back'], nanites: ['chest', 'back'], shock: ['chest', 'back'],
};
function baseOf(w) { return w.evo ? EVOS[w.id].from : w.id; }
function assignSlot(id) {
  const used = new Set(P.weapons.map(w => w.slot).filter(Boolean));
  for (const s of SLOT_PREF[id] || []) if (!used.has(s)) return s;
  for (const s of SLOTS) if (!used.has(s)) return s;
  return 'chest';
}
function slotHost(slot) {
  if (slot === 'armR') return { only: 'arms', armSide: 1 };
  if (slot === 'armL') return { only: 'arms', armSide: -1 };
  if (slot === 'back') return { only: 'back' };
  return { only: 'core' };
}
// опорные точки модели игрока на текущем шаге симуляции (одна сборка модели на шаг)
function playerPoints() {
  if (P._pts && P._ptsT === G.time && P._ptsV === P.view && P._ptsL === P.look) return P._pts;
  P._pts = robotPoints(P.look, G.time, playerOpts(), playerMesh());
  P._ptsT = G.time; P._ptsV = P.view; P._ptsL = P.look;
  return P._pts;
}
// мировая точка дульного среза модуля (для вылета снарядов)
function muzzleWorld(w) {
  if (!P || !P.look) return { x: 0, y: 0 };
  const R = playerPoints(), a = R.an[w.slot || 'chest'];
  if (a) return { x: P.x + a.x, y: P.y + a.y };
  return { x: P.x + Math.cos(P.aim) * 12 * R.k, y: P.y + Math.sin(P.aim) * 12 * R.k - 6 * R.k };
}
