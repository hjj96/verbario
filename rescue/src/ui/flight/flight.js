// In-flight HUD — "documentary escort-drone overlay + aircraft instruments" (DESIGN §2.14, §7.3, §7.4,
// §7.5). Composes the DOM text panels, the 60 Hz overlay canvas, the 30 Hz radar, toasts, central
// warnings, onboarding hints, the winch panel, radio subtitles and the Tab map; owns their layout
// (hudScale), the night amber / colourblind palette, the EMP/strike glitch and the event wiring.
import { el, setClass, Ticker } from '../common/dom.js';
import { NBSP, plural, groupOf, toWords, bearingDeg, clamp01, num0 } from '../common/fmt.js';
import { FlightModel } from './model.js';
import { Overlay } from './overlay.js';
import { Radar } from './radar.js';
import { Panels } from './panels.js';
import { Toasts } from './toasts.js';
import { Subtitles } from './subtitles.js';
import { Warnings } from './warnings.js';
import { WinchPanel } from './winch.js';
import { Hints } from './hints.js';
import { TacMap } from './map.js';

const SAFE = 24;

export class FlightHud {
  constructor(hud) {
    this.hud = hud;
    this.ctx = hud.ctx;
    this.node = el('div.hud-flight', { parent: hud.root });
    this.frame = el('div.hud-vf', { parent: this.node }); // viewfinder corners (CSS)
    for (const c of ['tl', 'tr', 'bl', 'br']) el(`i.vf-${c}`, { parent: this.frame });
    // Thermal / FLIR mode (post owns the image, CONTRACT «Depth pass»): a sensor-mode label under the
    // REC block with the grey-scale bar, plus a faint inner frame with mid-edge ticks.
    this.flir = el('div.hud-flir', { parent: this.node });
    for (const c of ['t', 'r', 'b', 'l']) el(`i.flir-tk.flir-${c}`, { parent: this.flir });
    this.flirLabel = el('div.flir-label', { parent: this.flir });
    this.flirMode = el('div.flir-mode', { parent: this.flirLabel });
    el('div.flir-sub', { parent: this.flirLabel, html: `<i class="flir-scale"></i><span>ИК 8–14${NBSP}мкм · АРУ</span>` });
    this._flirOn = false;
    this._flirPal = '';
    this.model = new FlightModel(hud);
    this.L = { W: 0, H: 0, hs: 1, tape: {}, alt: {}, winchPanel: {}, radar: {}, avoid: [] };
    this.overlay = new Overlay(this);
    this.node.appendChild(this.overlay.canvas);
    this.panels = new Panels(this, this.node);
    this.radar = new Radar(this);
    this.node.appendChild(this.radar.node);
    this.toasts = new Toasts(hud, this.node);
    this._toastH = 0;
    this.toasts.onHeight = (px) => {
      this._toastH = px;
      if (this.L.toastRect) this.L.toastRect.h = px ? px + 16 : 0;
    };
    this.warnings = new Warnings(hud, this.node);
    this.winch = new WinchPanel(this, this.node);
    this.hints = new Hints(this, this.node);
    this.subs = new Subtitles(hud, this.node);
    this.map = new TacMap(this, this.node);
    this.fps = el('div.hud-fps', { parent: hud.root });
    this.visible = false;
    this.altPulse = false;
    this.crestAbove = 0;
    this.rogueBar = 0;
    this._t12 = new Ticker(12);
    this._t10 = new Ticker(10);
    this._t4 = new Ticker(4);
    this._t1 = new Ticker(1);
    this._glitchT = 0;
    this._fpsN = 0;
    this._fpsT = 0;
    this._fpsVal = 0;
    this._tPause = new Ticker(4);
    this._objDone = new Set();
    this._objFailed = new Set();
    this._listen();
  }

  // ------------------------------------------------------------------------------------------------
  layout(W, H) {
    const hs = this.hud.hs;
    const L = this.L;
    L.W = W;
    L.H = H;
    L.hs = hs;
    L.safe = SAFE;
    // Phone-size viewports (DESIGN §7.3 is laid out for 1920 × 1080): a smaller radar, tighter text,
    // and in portrait the compass + mission strip move down under the meteo block / radar instead of
    // sharing the top row with them (CSS .compact / .portrait do the text side).
    const compact = W < 900 || H < 500;
    const portrait = compact && H > W && W < 700;
    setClass(this.node, 'compact', compact);
    setClass(this.node, 'portrait', portrait);
    const rs = compact ? Math.round(Math.max(96, Math.min(208 * hs, Math.min(W, H) * 0.3))) : Math.round(208 * hs);
    const tw = portrait ? Math.min(420 * hs, W * 0.6) : Math.min(420 * hs, W * (compact ? 0.3 : 0.36));
    const tlMax = portrait ? W - 2 * SAFE - rs - 12 : 360 * hs;
    this.node.style.setProperty('--tl-max', `${Math.round(tlMax)}px`);
    const tapeY = portrait ? SAFE + Math.max(rs, 112 * hs) + 10 : SAFE;
    L.tape = { x: W / 2 - tw / 2, y: tapeY, w: tw, h: 26 * hs };
    L.radar = { x: W - SAFE - rs, y: SAFE, size: rs };
    const stripTop = tapeY + L.tape.h + 22 * hs;
    const tTop = portrait ? stripTop + 64 * hs : SAFE + rs + 14 * hs;
    const tcw = Math.min(300 * hs, W - 2 * SAFE);
    L.toastRect = { x: W - SAFE - tcw - 10, y: tTop - 8, w: tcw + SAFE + 10, h: this._toastH ? this._toastH + 16 : 0 };
    const barH = (portrait ? 2 * 34 * 0.8 + 6 : 34) * hs; // portrait: the bar wraps into two rows
    L.bar = { y: H - SAFE - barH, h: barH };
    const ah = compact ? Math.min(140 * hs, H * 0.3) : 140 * hs;
    L.alt = { x: SAFE + 66 * hs, y: Math.round(H * 0.47 - ah / 2), w: 8 * hs, h: ah };
    const pw = 380 * hs;
    const ph = 156 * hs;
    L.winchPanel = { x: Math.round(W / 2 - pw / 2), y: Math.round(L.bar.y - 18 * hs - ph), w: pw, h: ph };
    L.avoid = [
      { x: 0, y: 0, w: tlMax + SAFE, h: (portrait ? 140 : 130) * hs }, // REC + meteo
      { x: L.radar.x - 8, y: 0, w: W - L.radar.x + 8, h: L.radar.y + rs + 8 }, // radar
      portrait ? { x: L.tape.x - 30, y: tapeY - 8, w: L.tape.w + 60, h: stripTop - tapeY + 58 * hs } : { x: L.tape.x - 30, y: 0, w: L.tape.w + 60, h: 96 * hs }, // compass + mission strip
      this.panels.stripRect, // the strip as laid out (a long task line is wider / lower than the above)
      { x: 0, y: L.bar.y - 12, w: W, h: H - L.bar.y + 12 }, // bottom bar
      L.toastRect, // toast column (height kept current by Toasts.onHeight)
    ];
    this.overlay.resize(W, H);
    this.radar.resize(rs);
    Object.assign(this.radar.node.style, { left: `${L.radar.x}px`, top: `${L.radar.y}px`, width: `${rs}px`, height: `${rs}px` });
    Object.assign(this.winch.node.style, { left: `${L.winchPanel.x}px`, top: `${L.winchPanel.y}px`, width: `${pw}px`, height: `${ph}px` });
    Object.assign(this.panels.altBox.style, { left: `${SAFE}px`, top: `${L.alt.y + L.alt.h / 2}px`, width: `${L.alt.x - SAFE - 12 * hs}px` });
    this.panels.tcBox.style.top = `${stripTop}px`;
    Object.assign(this.flirLabel.style, { left: `${SAFE}px`, top: `${Math.round(L.avoid[0].h + 4 * hs)}px` });
    Object.assign(this.toasts.col.style, { top: `${tTop}px`, width: `${tcw}px` });
    // radio subtitles: in a short landscape frame they start right of the altimeter column
    this.subs.box.style.left = compact && !portrait ? `${Math.round(L.alt.x + 44 * hs)}px` : '';
    this.map.resize(W, H);
    this.panels._barK = 0; // re-measure the bottom bar at the new size / scale
    this.panels.bar.style.removeProperty('--hs');
    if (this.visible) this.panels.fitBar();
    this.panels._remeasure = true;
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    setClass(this.node, 'on', on);
    if (on) {
      this._t12.force();
      this._t10.force();
    }
  }

  // ------------------------------------------------------------------------------------------------
  _listen() {
    const hud = this.hud;
    const on = (n, fn) => hud.on(n, (p) => fn(p || {}));
    const m = this.model;
    const playing = () => this.ctx.mode === 'play' || this.ctx.mode === 'paused';
    const T = (title, detail, opts) => playing() && this.toasts.push(title, detail, opts);

    on('mission:setup', ({ def }) => this._reset(def));
    on('mission:chapter', (p) => this.panels.showChapter(p.title || (p.text ? `ГЛАВА ${p.n} · ${p.text}` : '')));
    on('mission:hint', (p) => this.hints.onHint(p));
    // Landing snapshot (CONTRACT «Depth pass»): the take-off pad snapshot at the start stays silent.
    on('mission:checkpoint', (p) => {
      if ((this.ctx.mission?.elapsed ?? 99) < 5) return;
      const cp = p.checkpoint || this.ctx.mission?.checkpoint || p;
      const n = cp?.pad?.name || p.pad?.name || cp?.padName || '';
      T('КОНТРОЛЬНАЯ ТОЧКА', `${n ? `«${String(n).replace(/[«»]/g, '')}» · ` : ''}повтор с посадки — в меню паузы`, { kind: 'nav', key: 'checkpoint' });
    });
    on('mission:objective', ({ objective: o }) => {
      if (!o || !playing()) return;
      if (o.done && !this._objDone.has(o.id)) {
        this._objDone.add(o.id);
        T('ЗАДАЧА ВЫПОЛНЕНА', o.text || '', { kind: 'ok', key: `obj-${o.id}` });
      }
      if (o.failed && o.kind === 'bonus' && !this._objFailed.has(o.id)) {
        this._objFailed.add(o.id);
        T('ЗАДАЧА ПРОВАЛЕНА', o.text || '', { kind: 'warn', key: `objf-${o.id}` });
      }
    });
    on('mission:call', ({ call: c }) => {
      if (!c) return;
      T('НОВЫЙ ВЫЗОВ', `${c.what || 'люди в воде'}, квадрат ${c.square || '—'}, ${c.count || 1}${NBSP}чел.`, { kind: 'rescue' });
    });
    on('score:add', (p) => {
      if (!playing()) return;
      const pal = hud.palette;
      m.onScore(p, p.kind === 'style' ? pal.warn : p.points < 0 ? pal.danger : pal.ok);
      if (p.kind === 'style') T(`${String(p.reason || 'СТИЛЬ').toUpperCase()} +${Math.round(p.points)}`, p.chain > 1.01 ? `цепочка ×${p.chain.toFixed(1).replace('.', ',')}` : '', { kind: 'style' });
    });
    on('radio:line', (p) => {
      this.subs.line(p);
      if (p.id && /patter/.test(p.id)) m.onPatter(p);
    });

    on('survivor:signal', (p) => m.onSignal(p));
    on('survivor:spotted', ({ s }) => {
      m.onSpotted(s);
      if (!s) return;
      const n = s.remaining ?? s.count ?? 1;
      const G = groupOf(s.type);
      T(n > 1 ? 'ОБНАРУЖЕНЫ ЛЮДИ' : 'ОБНАРУЖЕН ЧЕЛОВЕК', `${G.toast}${n > 1 ? `, ${n}${NBSP}чел.` : ''}`, { kind: 'rescue', key: `spot-${s.id ?? ''}` });
    });
    on('survivor:critical', ({ s }) => {
      if (!s?.position) return;
      const b = bearingDeg(s.position.x - m.hx, s.position.z - m.hz);
      T('СОСТОЯНИЕ КРИТИЧЕСКОЕ', `${groupOf(s.type).short} ${toWords(b)}`, { kind: 'danger' });
    });
    on('survivor:lost', ({ s }) => {
      m.onLost(s);
      T('ЧЕЛОВЕК ПОТЕРЯН', s ? `${groupOf(s.type).short}` : '', { kind: 'danger' });
    });
    on('survivor:rescued', ({ s }) => {
      const n = s?.count || 1;
      T('ГРУППА СПАСЕНА', `${groupOf(s?.type).short}, ${n}${NBSP}чел. — на борту`, { kind: 'ok' });
    });
    on('heli:pickup', ({ person }) => {
      this.winch.onPickup();
      this.overlay.thumbT = m.time; // thumbs-up at the door (DESIGN §4 #25)
      T('ЧЕЛОВЕК НА БОРТУ', this._personLine(person), { kind: 'ok' });
    });
    on('heli:cabin-full', () => T('САЛОН ЗАПОЛНЕН', 'на площадку', { kind: 'warn', key: 'cabin-full' }));
    on('heli:refuel', (p) => {
      if (p.state === 'done') T('ДОЗАПРАВКА ЗАВЕРШЕНА', p.pad?.name ? `«${String(p.pad.name).replace(/[«»]/g, '')}»` : '', { kind: 'nav', key: 'refuel' });
    });
    on('heli:unload', (p) => {
      const n = p.count || p.people?.length || 0;
      if (n) T('ВЫГРУЗКА', `${n}${NBSP}${plural(n, 'человек', 'человека', 'человек')} передано медикам`, { kind: 'ok' });
    });
    on('heli:resupply', () => T('ПОПОЛНЕНИЕ', 'фальшфейеры и плоты на борту', { kind: 'nav', key: 'resupply' }));
    on('heli:slip', () => T('СОРВАЛСЯ!', 'опускаем ещё раз', { kind: 'danger' }));
    on('heli:snag', () => T('ТРОС ЗАХЛЕСТНУЛО', 'лебёдка заклинена', { kind: 'warn' }));
    on('heli:fuel-low', (p) => {
      if (p.level === 'bingo') T('БИНГО ПО ТОПЛИВУ', 'немедленно на заправку', { kind: 'warn', key: 'bingo' });
    });
    on('heli:damage', (p) => {
      if ((p.amount || 0) > 0.12) this.glitch();
    });
    on('weather:preset', (p) => {
      if (this.ctx.mode !== 'play') return;
      T('ПОГОДА МЕНЯЕТСЯ', p.label || '', { kind: p.worse === false ? 'nav' : 'warn', key: 'weather' });
    });
    on('weather:gust', (p) => m.onGust(p));
    on('weather:lightning', (p) => {
      m.onStrike(p);
      if (this.subs.lines.length) this.subs.corrupt();
      if (!p.cloudOnly && (p.distance ?? 999) < 60) this.glitch();
    });
    on('weather:charge', (p) => {
      if (!this.ctx.heli?.position) return;
      const d = Math.hypot((p.x || 0) - m.hx, (p.z || 0) - m.hz);
      if (p.heli || p.target === 'heli' || d < (p.radius || 30) + 40) this.warnings.raise('storm', 'ГРОЗА РЯДОМ', 'заряд над вами — уходите', { level: 'caution', ttl: Math.max(2, p.eta || 2) + 0.5 });
    });
    on('hazard:warning', (p) => {
      if (this.ctx.mode !== 'play') return;
      this.warnings.onHazardWarning(p);
      m.activity = 0;
    });
    on('hazard:end', (p) => this.warnings.endHazard(p?.hazard));
    on('hazard:hit', (p) => {
      if (p.type === 'lightning' || p.emp) this.glitch(0.3);
    });
    on('post:quality-hint', (p) => {
      const to = p.suggest === 'low' ? 'low' : 'medium';
      const word = to === 'low' ? '«Низкого»' : '«Среднего»';
      this.toasts.push('КАДРЫ ПРОСЕДАЮТ', `Качество можно снизить до ${word} для плавности`, {
        kind: 'info',
        hold: 12,
        action: { label: 'СНИЗИТЬ', fn: () => this.ctx.settings.set('quality', to) },
      });
    });
  }

  _personLine(person) {
    // prefer the mission manifest (full name, gender-correct), else the cabin record
    let name = person?.name;
    let age = person?.age;
    let cond = person?.condition;
    const man = this.ctx.mission?.manifest;
    if (Array.isArray(man)) {
      let best = null;
      for (const e of man) if (e && e.status === 'aboard' && (!best || (e.boardedAt ?? 0) >= (best.boardedAt ?? 0))) best = e;
      if (best) {
        name = best.name || name;
        age = best.age ?? age;
        cond = best.condition || cond;
      }
    }
    let s = name && name !== 'Пострадавший' ? String(name) : '';
    if (Number.isFinite(age)) s += `${s ? ', ' : ''}${age}${NBSP}${plural(age, 'год', 'года', 'лет')}`;
    if (cond && cond !== 'стабилен' && cond !== 'стабильное') s += `${s ? ' · ' : ''}${cond}`;
    return s;
  }

  _reset(def) {
    const m = this.model;
    for (const p of [m.signals, m.whistles, m.strikes, m.popups, m.lost, m.epirb]) for (const x of p) x.t = -99;
    m.flir.clear();
    m.gust.active = false;
    m.lastFlash.t = -99;
    this.radar.resetTrail();
    this.toasts.clear();
    this.subs.clear();
    this.warnings.clear();
    this.hints.hide();
    this.map.setup(def);
    this._objDone.clear();
    this._objFailed.clear();
  }

  glitch(dur = 0.15) {
    if (this.ctx.settings?.get('reduceMotion')) return;
    this._glitchT = Math.max(this._glitchT, dur);
    setClass(this.node, 'glitch', true);
  }

  // ------------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    const paused = ctx.mode === 'paused';
    this.model.update(dt);
    if (this._t4.tick(dt)) this._palette();
    if (this._t1.tick(dt)) {
      this.panels.fitBar();
      this.panels.measureText();
    }
    if (this._glitchT > 0) {
      this._glitchT -= dt;
      if (this._glitchT <= 0) setClass(this.node, 'glitch', false);
    }
    const emp = (ctx.heli?.emp || 0) > 0;
    setClass(this.node, 'emp', emp);
    const th = ctx.post?.thermal;
    const flir = !!th?.active;
    if (flir !== this._flirOn) {
      this._flirOn = flir;
      setClass(this.node, 'thermal', flir);
    }
    if (flir) {
      const black = /black|ч[её]рн/i.test(String(th.palette || th.mode || ''));
      const pal = black ? 'ЧЁРН. ГОРЯЧ.' : 'БЕЛ. ГОРЯЧ.';
      if (pal !== this._flirPal) {
        this._flirPal = pal;
        this.flirMode.innerHTML = `<b>ТЕПЛОВИЗОР</b> · ${pal}`;
        setClass(this.flirLabel, 'black-hot', black);
      }
    }
    if (emp && Math.random() < 0.08) this.glitch(0.12);

    if (this._t10.tick(dt)) this._sea();
    this.winch.update(dt);
    this.hints.update();
    // overlay at 60 Hz in flight, 4 Hz under the pause menu
    if (!paused || this._tPause.tick(dt)) this.overlay.draw(dt);
    if (!paused) this.radar.update(dt);
    this.map.update(dt, !paused && !!ctx.input?.down?.('map'));
    if (this._t12.tick(dt)) {
      this.panels.update(1 / 12);
      this.winch.updateText();
    }
    this.toasts.update(dt);
    this.warnings.update(paused ? 0 : dt);
    this.subs.update(dt);
  }

  // Crest line and rogue bar for the radar altimeter (10 Hz), ЛЕБ. band pulse.
  _sea() {
    const ctx = this.ctx;
    const m = this.model;
    const h = ctx.heli;
    const ocean = ctx.ocean;
    let crest = 0;
    if (ocean?.heightAt && h?.position) {
      const base = Number.isFinite(h.seaY) ? h.seaY : ocean.heightAt(m.hx, m.hz, 0);
      let mx = -Infinity;
      for (let k = 0; k <= 6; k++) {
        const y = ocean.heightAt(m.hx, m.hz, k * 0.5);
        if (y > mx) mx = y;
      }
      crest = Math.max(0, mx - base);
    }
    this.crestAbove = crest;
    let rog = 0;
    const list = ctx.hazards?.list;
    if (list) for (const hz of list) {
      if (hz?.type !== 'rogue' || hz.alive === false) continue;
      if ((hz.eta ?? 99) > 12 || (hz.threat ?? 1) < 0.15) continue;
      rog = Math.max(rog, (hz.height || 14) * clamp01(hz.threat ?? 1) - (h?.seaY || 0));
    }
    this.rogueBar = rog;
    // ЛЕБ. band pulses when the onboarding asks to descend or a spotted target is close below
    const hint = ctx.mission?.hint;
    this.altPulse = (hint && hint.key === 'descend') || (m.selected && m.selectedDist < 150 && m.alt > 30);
  }

  _palette() {
    const ctx = this.ctx;
    const ws = ctx.weather?.state;
    const night = ws?.night ?? 0;
    const cb = !!ctx.settings?.get('colorblindMarkers');
    const pal = this.hud.palette;
    // haze: thick fog (the frame is mostly fog colour) × how light that fog renders (linear luminance ×
    // exposure: ≈ 0.48 in the daylight «fog» preset, ≈ 0.1 in a night or storm murk) — DESIGN §7.3
    const fc = ws?.palette?.fogColor;
    const lum = fc ? (0.2126 * fc.r + 0.7152 * fc.g + 0.0722 * fc.b) * (ws.palette.exposure ?? 1) : 0;
    const haze = clamp01(((ws?.fog ?? 0) - 0.35) / 0.4) * clamp01((lum - 0.12) / 0.2);
    if (pal.apply(night, cb, haze)) this.hud.applyPaletteCss();
    setClass(this.hud.root, 'night', night > 0.6);
  }

  // FPS counter (settings.showFps) and ?debug state panel.
  updateFps(dt) {
    const ctx = this.ctx;
    const show = !!ctx.settings?.get('showFps') || ctx.debug;
    setClass(this.fps, 'on', show);
    if (!show) return;
    this._fpsN++;
    this._fpsT += dt;
    if (this._fpsT < 0.5) return;
    this._fpsVal = this._fpsN / this._fpsT;
    this._fpsN = 0;
    this._fpsT = 0;
    let s = `${num0(this._fpsVal)} FPS · ${(1000 / Math.max(1, this._fpsVal)).toFixed(1).replace('.', ',')} МС`;
    if (ctx.debug) {
      const h = ctx.heli || {};
      const w = ctx.weather?.state || {};
      const mi = ctx.mission || {};
      const ps = ctx.post?.stats;
      s += `\nРЕЖИМ ${ctx.mode} · ${mi.state || '—'} · ${mi.def?.id || '—'}`;
      s += `\nВЕРТ ${num0(h.position?.x || 0)}, ${num0(h.position?.z || 0)} · ВЫС ${num0(h.altitude || 0)} · ТОПЛ ${num0((h.fuel ?? 1) * 100)} · КОРП ${num0((h.hull ?? 1) * 100)}`;
      s += `\nПОГОДА ${w.preset || '—'} · I ${(w.intensity ?? 0).toFixed(2)} · НОЧЬ ${(w.night ?? 0).toFixed(2)}`;
      s += `\nЛЮДИ ${ctx.survivors?.list?.length ?? 0} · ОПАСН ${ctx.hazards?.list?.length ?? 0}`;
      if (ps) s += `\nPOST ${ps.frameMs ? ps.frameMs.toFixed(1) : '—'} МС · MSAA ${ps.samples ?? '—'}`;
    }
    this.fps.textContent = s;
  }
}
