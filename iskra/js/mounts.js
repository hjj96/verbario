'use strict';
/* ===== Орудия на корпусе: слоты крепления, модули, их анимации ===== */

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
function slotLocal(slot, ly, view) {
  const tw = ly.tw;
  if (view === 'top') {
    switch (slot) {
      case 'armR': return { x: 17, y: tw + 0.5 };
      case 'armL': return { x: 17, y: -(tw + 0.5) };
      case 'shR': return { x: 1, y: tw + 4 };
      case 'shL': return { x: 1, y: -(tw + 4) };
      case 'back': return { x: -12, y: 0 };
      default: return { x: 7.5, y: 0 };
    }
  }
  switch (slot) {
    case 'armR': return { x: tw + 2, y: ly.shY + 19 };
    case 'armL': return { x: -(tw + 2), y: ly.shY + 19 };
    case 'shR': return { x: tw - 0.5, y: ly.tTop - 1.5 };
    case 'shL': return { x: -(tw - 0.5), y: ly.tTop - 1.5 };
    case 'back': return { x: tw * 0.5, y: ly.tTop - 9 };
    default: return { x: 0, y: ly.tBot - 5 };
  }
}
// мировая точка дульного среза модуля (для вылета снарядов)
function muzzleWorld(w) {
  if (!P || !P.look) return { x: 0, y: 0 };
  const L = P.look, ly = robotLayout(L), k = L.scale * (P.view === 'top' ? TOP_K : 1), s = slotLocal(w.slot || 'chest', ly, P.view);
  let x, y;
  if (P.view === 'top') { const ca = Math.cos(P.aim), sa = Math.sin(P.aim); x = (s.x * ca - s.y * sa) * k; y = (s.x * sa + s.y * ca) * k; }
  else { x = s.x * k; y = s.y * k; }
  const len = (baseOf(w) === 'rail' ? 20 : 11) * k;
  return { x: P.x + x + Math.cos(P.aim) * len, y: P.y + y + Math.sin(P.aim) * len };
}
function mountList(filterOnly, armSide) {
  const out = [];
  for (const w of P.weapons) {
    if (!w.slot || w.hidden) continue;
    if (filterOnly) {
      const h = slotHost(w.slot);
      if (h.only !== filterOnly) continue;
      if (armSide && h.armSide !== armSide) continue;
    }
    out.push(w);
  }
  return out;
}

/* --- модули (локально: +x — направление стрельбы) --- */
function muzzleStar(c, x, f, col) {
  if (f < 0.45) return;
  const k = (f - 0.45) / 0.55, r = 3 + k * 5;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.fillStyle = rgba('#ffffff', k);
  c.beginPath(); c.moveTo(x - 1, 0); c.lineTo(x + r * 0.4, -r * 0.35); c.lineTo(x + r * 1.6, 0); c.lineTo(x + r * 0.4, r * 0.35); c.closePath(); c.fill();
  c.restore();
  glow(c, x + r * 0.5, 0, r * 2.2, col, k);
}
function drawModule(c, w, pal, t, view) {
  const id = baseOf(w), def = w.evo ? EVOS[w.id] : WEAPONS[w.id], col = def.color, A = w.anim || {}, f = A.fire || 0;
  const ev = w.evo, prev = RS.reveal;
  if (w.reveal !== undefined) RS.reveal = w.reveal;
  c.save();
  c.translate(-f * 2.4, 0);
  if (ev) c.scale(1.14, 1.14);
  const M = tone => fillMetal(c, pal, 0, 0, 0, 0, tone || 'm');
  switch (id) {
    case 'blaster':
      pathRR(c, -3, -3, 7, 6, 1.5); M('m');
      pathRR(c, 3, -1.6, 10, 3.2, 1); M('l');
      lightLine(c, 4, 0, 12, 0, col, 0.8, 0.9);
      if (ev) { pathRR(c, 3, -3.6, 9, 1.3, 0.5); fillFlat(c, col); pathRR(c, 3, 2.3, 9, 1.3, 0.5); fillFlat(c, col); }
      muzzleStar(c, 13, f, col);
      break;
    case 'blade': {
      pathRR(c, -3, -2.6, 8, 5.2, 1.5); M('m');
      const sw = A.swing || 0, len = 4 + sw * 24 + (A.out ? 14 : 0);
      c.save(); c.globalCompositeOperation = 'lighter';
      c.fillStyle = rgba(col, 0.75); c.beginPath(); c.moveTo(5, -1.7); c.quadraticCurveTo(5 + len * 0.7, -2.6 - sw * 2, 5 + len, 0); c.quadraticCurveTo(5 + len * 0.7, 1.4, 5, 1.7); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.moveTo(5, -0.6); c.quadraticCurveTo(5 + len * 0.7, -1, 5 + len * 0.96, 0); c.quadraticCurveTo(5 + len * 0.7, 0.5, 5, 0.6); c.fill();
      c.restore();
      glow(c, 5 + len * 0.5, 0, 4 + len * 0.35, col, 0.35 + sw * 0.4);
      break;
    }
    case 'saw':
      pathRR(c, -3, -2.4, 6, 4.8, 1.2); M('d');
      if (A.out) { c.beginPath(); c.arc(5, 0, 1.6, 0, TAU); fillFlat(c, pal.gd, pal.ls); }
      else {
        c.save(); c.translate(5.5, 0); c.rotate(t * 8);
        c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r = i % 2 ? 3.6 : 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath();
        c.fillStyle = rgba(col, 0.25); c.fill(); strokeLine(c, col, 0.9);
        c.beginPath(); c.arc(0, 0, 1.4, 0, TAU); fillFlat(c, pal.gdd, pal.ln);
        c.restore();
      }
      break;
    case 'drones':
      pathRR(c, -3.5, -3.5, 7, 7, 2); M('d');
      c.beginPath(); c.arc(0, 0, 4.6, 0, TAU); c.setLineDash([1.5, 1.5]); strokeLine(c, col, 0.6); c.setLineDash([]);
      if (Math.sin(t * 6) > 0) glow(c, 0, 0, 3.5, col, 1);
      break;
    case 'arc':
      for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(1 + i * 2.6, 0, 1.2, 3.6 - i * 0.6, 0, 0, TAU); M(i === 1 ? 'l' : 'm'); }
      c.beginPath(); c.arc(8.5, 0, 1.6, 0, TAU); fillFlat(c, col);
      glow(c, 8.5, 0, 5 + f * 5, col, 0.6 + f * 0.4);
      if (f > 0.3 || Math.random() < 0.06) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#ffffff'; c.lineWidth = 0.7 * RS.k; c.beginPath(); c.moveTo(8.5, 0); c.lineTo(11 + rand(0, 3), rand(-3, 3)); c.lineTo(14 + rand(0, 3), rand(-3, 3)); c.stroke(); c.restore(); }
      break;
    case 'missiles':
      pathRR(c, -4, -4.6, 10, 9.2, 1.6); M('m');
      for (const [x, y] of [[2.5, -2.2], [2.5, 2.2], [-0.8, -2.2], [-0.8, 2.2]]) { c.beginPath(); c.arc(x, y, 1.4, 0, TAU); fillFlat(c, f > 0.2 ? col : pal.gdd, pal.ls); }
      if (f > 0.2) glow(c, 1, 0, 9, col, f * 0.6);
      c.beginPath(); c.moveTo(6, -4.6 - f * 2); c.lineTo(6 + f * 3, -6); strokeLine(c, pal.ln, 0.7);
      break;
    case 'flamer':
      c.beginPath(); c.arc(-1.5, 0, 3.2, 0, TAU); M('d');
      pathPoly(c, [0.5, -2, 10, -3.4, 10, 3.4, 0.5, 2]); M('m');
      lightLine(c, 2, 0, 9, 0, col, 0.6, 0.7);
      glow(c, 10.5, 0, 3 + f * 6, '#ffcf5a', 0.6 + f * 0.4);
      break;
    case 'mines':
      pathRR(c, -4, -4, 8, 8, 1.4); M('d');
      c.beginPath(); c.moveTo(-2.4, 0); c.lineTo(2.4, 0); strokeLine(c, col, 0.8);
      if (Math.sin(t * 5) > 0.2) glow(c, 0, 0, 3.5, '#ff4d5e', 0.9);
      break;
    case 'gravity': {
      c.beginPath(); c.arc(1, 0, 4.4, 0, TAU); M('m');
      c.beginPath(); c.arc(1, 0, 2.4, 0, TAU); fillFlat(c, '#000000', col);
      c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(col, 0.8); c.lineWidth = 0.8 * RS.k;
      c.beginPath(); c.arc(1, 0, 3.4, t * 4, t * 4 + 2.4); c.stroke(); c.restore();
      glow(c, 1, 0, 5 + f * 4, col, 0.5);
      break;
    }
    case 'cryo':
      pathPoly(c, [-2.5, -3, 7, -1.3, 10, 0, 7, 1.3, -2.5, 3]); M('m');
      lightLine(c, 0, 0, 9, 0, col, 0.7, 0.9);
      glow(c, 10, 0, 3.5 + f * 4, col, 0.8);
      break;
    case 'rail': {
      const ch = w.st && w.st.charge > 0 ? 1 : 0;
      pathRR(c, -7, -1.6, 28, 3.2, 0.8); M('l');
      c.beginPath(); c.moveTo(-5, -2.6); c.lineTo(20, -2.6); c.moveTo(-5, 2.6); c.lineTo(20, 2.6); strokeLine(c, pal.ln, 0.6);
      for (let k = 0; k < 3; k++) { pathRR(c, -2 + k * 5, -3.2, 1.6, 6.4, 0.5); fillFlat(c, ch ? '#ffffff' : col); }
      if (ch) glow(c, 8, 0, 16, '#9fd8ff', 0.6 + Math.sin(t * 60) * 0.2);
      muzzleStar(c, 21, f, '#eaf6ff');
      break;
    }
    case 'nanites':
      pathRR(c, -3, -4, 7, 8, 1.4); M('d');
      c.beginPath(); for (let k = 0; k < 3; k++) { c.moveTo(-1.5 + k * 2, -2.8); c.lineTo(-1.5 + k * 2, 2.8); } strokeLine(c, col, 0.6);
      for (let i = 0; i < 4; i++) { const a = t * 3 + i * 1.7; glow(c, 5 + Math.cos(a) * 2, Math.sin(a * 1.3) * 3, 1.5, col, 0.9); }
      break;
    case 'shock':
      c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); M('m');
      c.beginPath(); c.arc(0, 0, 5.2 + f * 2, 0, TAU); strokeLine(c, col, 0.9);
      if (f > 0) glow(c, 0, 0, 10 * f, col, f);
      break;
  }
  if (ev) glow(c, 3, 0, 9, '#ffd36b', 0.22 + Math.sin(t * 4) * 0.08);
  c.restore();
  RS.reveal = prev;
}
// модули в главном виде: в своих слотах, направлены к цели
function drawMountsFront(c, L, ly, t, o) {
  const aim = o.aim || 0;
  for (const w of o.mounts) {
    if (!w.slot || w.hidden) continue;
    const h = slotHost(w.slot);
    if (o.only && (h.only !== o.only || (o.armSide && h.armSide !== o.armSide))) continue;
    if (o.skipArmSide && h.armSide === o.skipArmSide) continue;
    if (o.skip && o.skip === h.only && !h.armSide) continue;
    const s = slotLocal(w.slot, ly, 'front');
    c.save(); c.translate(s.x, s.y);
    let a = aim;
    if (w.slot === 'back') a = -Math.PI / 2 + Math.cos(aim) * 0.6;
    c.rotate(a);
    if (Math.cos(a) < 0) c.scale(1, -1);
    drawModule(c, w, L.pal, t, 'front');
    c.restore();
  }
}
function drawMountsTop(c, L, ly, t, o) {
  for (const w of o.mounts) {
    if (!w.slot || w.hidden) continue;
    const h = slotHost(w.slot);
    if (o.only && (h.only !== o.only || (o.armSide && h.armSide !== o.armSide))) continue;
    if (o.skipArmSide && h.armSide === o.skipArmSide) continue;
    if (o.skip && o.skip === h.only && !h.armSide) continue;
    const s = slotLocal(w.slot, ly, 'top');
    c.save(); c.translate(s.x, s.y);
    if (h.armSide) c.rotate(-h.armSide * 0.06);
    drawModule(c, w, L.pal, t, 'top');
    c.restore();
  }
}
