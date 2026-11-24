'use strict';
/* ===== Управление: клавиатура, сенсорный джойстик, мышь, геймпад ===== */

const INPUT = {
  keys: {}, pressed: {}, joy: { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  gpPrev: [], gpAxisT: 0, mode: 'kb', touchSeen: false,
  init() {
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys = {}; this.joy.active = false; if (G.state === 'play') UI.pause(); });
    const cv = canvas;
    cv.addEventListener('pointerdown', e => this.pDown(e));
    window.addEventListener('pointermove', e => this.pMove(e));
    window.addEventListener('pointerup', e => this.pUp(e));
    window.addEventListener('pointercancel', e => this.pUp(e));
    cv.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') UI.pause(); });
  },
  onKey(e, down) {
    const k = e.code;
    AUDIO.init();
    if (down && !e.repeat && UI.key(e)) { e.preventDefault(); return; }
    if (G.state !== 'play') { if (!down) this.keys[k] = false; return; }
    this.mode = 'kb';
    this.keys[k] = down;
    if (down && !e.repeat) {
      if (k === 'Space') this.pressed.dash = true;
      if (k === 'KeyE' || k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyQ') this.pressed.od = true;
      if (k === 'Escape' || k === 'KeyP') UI.pause();
      if (DEBUG) debugKey(k);
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  },
  pDown(e) {
    AUDIO.init();
    if (G.state !== 'play') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') { this.touchSeen = true; UI.touchMode(true); }
    this.mode = e.pointerType === 'touch' ? 'touch' : 'mouse';
    const j = this.joy;
    j.active = true; j.id = e.pointerId; j.ox = e.clientX; j.oy = e.clientY; j.x = e.clientX; j.y = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ }
    e.preventDefault();
  },
  pMove(e) { const j = this.joy; if (j.active && e.pointerId === j.id) { j.x = e.clientX; j.y = e.clientY; } },
  pUp(e) { const j = this.joy; if (j.active && e.pointerId === j.id) { j.active = false; j.id = null; } },
  move() {
    let x = 0, y = 0;
    const K = this.keys;
    if (K.KeyA || K.ArrowLeft) x -= 1;
    if (K.KeyD || K.ArrowRight) x += 1;
    if (K.KeyW || K.ArrowUp) y -= 1;
    if (K.KeyS || K.ArrowDown) y += 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; }
    const j = this.joy;
    if (j.active) {
      const R = 56, dx = j.x - j.ox, dy = j.y - j.oy, d = Math.hypot(dx, dy);
      if (d > R) { j.ox = j.x - dx / d * R; j.oy = j.y - dy / d * R; }
      const q = Math.min(1, d / R);
      if (q < 0.12) return { x: 0, y: 0 };
      return { x: dx / (d || 1) * q, y: dy / (d || 1) * q };
    }
    if (this.gpMove) return this.gpMove;
    return { x: 0, y: 0 };
  },
  consume(n) { if (this.pressed[n]) { this.pressed[n] = false; return true; } return false; },
  press(n) { this.pressed[n] = true; },
  poll(dt) {
    this.gpMove = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) return;
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = i => { const now = b(i), was = !!this.gpPrev[i]; this.gpPrev[i] = now; return now && !was; };
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, m = Math.hypot(ax, ay);
    const eA = edge(0), eB = edge(1), eX = edge(2), eY = edge(3), eRB = edge(5), eRT = edge(7), eStart = edge(9);
    const eUp = edge(12), eDown = edge(13), eLeft = edge(14), eRight = edge(15);
    if (G.state === 'play' && !UI.modal) {
      if (m > 0.2) { const q = Math.min(1, (m - 0.2) / 0.8); this.gpMove = { x: ax / m * q, y: ay / m * q }; this.mode = 'pad'; }
      else if (b(12) || b(13) || b(14) || b(15)) { let x = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), y = (b(13) ? 1 : 0) - (b(12) ? 1 : 0); const l = Math.hypot(x, y) || 1; this.gpMove = { x: x / l, y: y / l }; }
      if (eA || eRB) this.pressed.dash = true;
      if (eX || eRT || eY) this.pressed.od = true;
      if (eStart) UI.pause();
      return;
    }
    this.gpAxisT -= dt;
    let dir = null;
    if (eUp) dir = 'up'; else if (eDown) dir = 'down'; else if (eLeft) dir = 'left'; else if (eRight) dir = 'right';
    else if (m > 0.6 && this.gpAxisT <= 0) { dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up'); this.gpAxisT = 0.22; }
    if (m < 0.3) this.gpAxisT = 0;
    if (dir) UI.nav(dir);
    if (eA) UI.activate();
    if (eB || eStart) UI.back();
  },
  drawJoystick(c, dpr) {
    const j = this.joy;
    if (!j.active || this.mode !== 'touch' || G.state !== 'play') return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = 'rgba(191,246,255,0.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(j.ox, j.oy, 56, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(191,246,255,0.06)'; c.fill();
    let dx = j.x - j.ox, dy = j.y - j.oy; const d = Math.hypot(dx, dy);
    if (d > 56) { dx = dx / d * 56; dy = dy / d * 56; }
    c.fillStyle = 'rgba(191,246,255,0.55)'; c.beginPath(); c.arc(j.ox + dx, j.oy + dy, 22, 0, TAU); c.fill();
  },
};

/* --- Отладка (?debug) --- */
function debugKey(k) {
  if (k === 'KeyL') { G.pendingLevels++; }
  if (k === 'KeyK') { for (const e of G.enemies) if (!e.boss && !e.parent) e.alive = false; }
  if (k === 'KeyT') { G.time += 60; }
  if (k === 'KeyB') { const S = G.schedule || BOSS_SCHEDULE, b = S[Math.min(G.bossIdx, S.length - 1)]; G.bossIdx++; spawnBoss(b.id, b.final); }
  if (k === 'KeyO') { P.od.meter = 100; }
  if (k === 'KeyG') { DEBUG_GOD = !DEBUG_GOD; UI.banner('БОГ: ' + (DEBUG_GOD ? 'ВКЛ' : 'ВЫКЛ'), '', 'cyan'); }
  if (k === 'KeyC') { G.pendingChests.push(true); }
  if (k === 'KeyM') { for (const id of PART_ORDER) if (P.parts[id].rank < 5) { upgradePart(id, Math.random() < 0.5 ? 'A' : 'B'); break; } }
  if (k === 'KeyX') { for (const w of P.weapons) if (!w.evo) { w.lvl = 8; computeWeapon(w); } }
}
