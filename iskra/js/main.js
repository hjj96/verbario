'use strict';
/* ===== Запуск и главный цикл ===== */

let lastT = 0, acc = 0, prevT = 0, wakeLock = null;

function boot() {
  loadSave();
  const S = SAVE.settings;
  if (!SAVE.seenIntro && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) S.shake = false;
  FX.dmgNumbers = S.dmg;
  AUDIO.vol.music = S.music; AUDIO.vol.sfx = S.sfx;
  initCanvas();
  buildItemSprites();
  buildEnemySprites(SECTORS[0].pal);
  buildIcons();
  G.sector = SECTORS[0];
  INPUT.init();
  UI.init();
  menuInit();
  G.state = 'menu';
  UI.open('title');
  const unlock = () => {
    AUDIO.init();
    AUDIO.music(G.state === 'menu' ? 1 : 2, 0);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  if (matchMedia('(pointer: coarse)').matches) INPUT.touchSeen = true;
  requestAnimationFrame(frame);
  window.ISKRA = { G, get P() { return P; }, step, startRun, upgradePart, evolveWeapon, spawnBoss, addWeapon, computeWeapon, recompute, UI, SAVE: () => SAVE, FX, INPUT, MENU };
}

function requestWake() {
  try {
    if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
  } catch (e) { /* не поддерживается */ }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (G.sim) return;
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = 1 / 60;
  dt = Math.min(dt, 0.1);
  RENDER.frameMs = lerp(RENDER.frameMs, dt * 1000, 0.05);
  if (SAVE.settings.quality === 'auto' && !RENDER.autoLow && G.state === 'play') {
    if (RENDER.frameMs > 26) { if (++RENDER.slowFrames > 240) { RENDER.autoLow = true; resize(); } }
    else RENDER.slowFrames = Math.max(0, RENDER.slowFrames - 1);
  }
  INPUT.poll(dt);
  if (G.state === 'play') {
    requestWake();
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) { step(STEP); acc -= STEP; n++; if (G.state !== 'play') break; }
    if (n >= 4) acc = 0;
    renderGame();
  } else if (G.state === 'menu') {
    acc = 0;
    menuUpdate(dt);
    renderMenu();
  } else {
    acc = 0;
    if (P && G.sector && SPR.bgTile) renderGame();
  }
  UI.frame(dt);
  if (now - prevT > 33) { prevT = now; UI.drawPreviews(now / 1000); }
}

(function start() {
  const run = () => { try { boot(); } catch (e) { console.error(e); const d = document.getElementById('ui'); if (d) d.innerHTML = '<div style="padding:24px;font-family:monospace;color:#ff4d5e">Ошибка запуска: ' + String(e && e.message || e) + '</div>'; } };
  try {
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ v: 1 }));
    if (hot && typeof hot.ready === 'function') hot.ready(run); else run();
  } catch (e) { run(); }
})();
