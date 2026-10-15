// ПАУЗА (DESIGN §7.6): the scene is desaturated and darkened by post; left — the menu ПРОДОЛЖИТЬ ·
// НАСТРОЙКИ · УПРАВЛЕНИЕ · НАЧАТЬ ЗАНОВО · В ГЛАВНОЕ МЕНЮ (the last two ask for confirmation); right —
// a paper flight summary: objectives, time, rescued / lost, the cabin manifest, the forecast and the
// radio log (last lines, [NICE]).
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { NBSP, mmss, mss, esc, PRESET_LABEL } from '../common/fmt.js';
import { WMO } from '../common/icons.js';
import { Screen } from './screen.js';

export class PauseScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-pause');
    const left = el('div.pause-left', { parent: this.node });
    el('div.pause-kicker', { text: 'ЗАПИСЬ ОСТАНОВЛЕНА', parent: left });
    el('h2.pause-title', { text: 'ПАУЗА', parent: left });
    this.tcEl = el('div.pause-tc', { parent: left });
    this.menuEl = el('div.pause-menu', { parent: left, attrs: { role: 'menu' } });
    const mk = (label, fn, cls = '') => {
      const it = el(`div.pause-item${cls}`, { text: label, parent: this.menuEl, attrs: { role: 'menuitem' } });
      return { el: it, onActivate: fn };
    };
    this.menu = new Menu(hud, { name: 'pause' });
    this.iResume = mk('ПРОДОЛЖИТЬ', () => this.hud.emit('ui:resume', {}));
    // «ПОВТОРИТЬ С ПОСАДКИ» (CONTRACT «Depth pass»: checkpoints) — only while mission.checkpoint exists
    this.iCheck = mk('ПОВТОРИТЬ С ПОСАДКИ', () => this._checkpoint(), '.pi-check');
    this.iCheckSub = el('span.pi-sub', { parent: this.iCheck.el });
    this.iRest = [
      mk('НАСТРОЙКИ', () => this.hud.go('settings')),
      mk('УПРАВЛЕНИЕ', () => this.hud.go('controls')),
      mk('НАЧАТЬ ЗАНОВО', () =>
        this.hud.go('confirm', { title: 'НАЧАТЬ ЗАНОВО?', text: 'Вылет начнётся заново с площадки. Всё, что сделано в этом вылете, будет потеряно.', yes: 'ЗАНОВО', onYes: () => this.hud.emit('ui:retry', {}) }),
      ),
      mk('В ГЛАВНОЕ МЕНЮ', () =>
        this.hud.go('confirm', { title: 'ПРЕРВАТЬ ОПЕРАЦИЮ?', text: 'Экипаж вернётся на базу, люди в воде останутся ждать катера. Выйти в главное меню?', yes: 'В МЕНЮ', onYes: () => this.hud.emit('ui:menu', {}) }),
      ),
    ];
    this._hasCheck = null;
    this._items();
    el('div.pause-keys', { parent: left, html: '<kbd class="cap wide">Esc</kbd> продолжить' });

    this.card = el('div.pause-card.paper', { parent: this.node });
    this.cardMain = el('div.pc-main', { parent: this.card });
    // radio log: all stored lines (subtitles keep 30) in their own scroll box, re-rendered only on change
    this.logWrap = el('div.pc-logwrap', { parent: this.card });
    this.logLabel = el('div.pc-label', { parent: this.logWrap });
    this.logBox = el('div.pc-log', { parent: this.logWrap });
    this._logKey = '';
    this._t = 0;
  }

  // Menu items: the checkpoint entry appears only while the mission holds a landing snapshot.
  _items() {
    const cp = this.ctx.mission?.checkpoint;
    const has = !!cp;
    if (has) {
      const t = Number(cp.elapsed ?? cp.time ?? cp.t);
      const pad = this._padName(cp);
      this.iCheckSub.textContent = [pad, Number.isFinite(t) ? mmss(t) : ''].filter(Boolean).join(' · ');
    }
    if (has === this._hasCheck) return;
    this._hasCheck = has;
    this.iCheck.el.hidden = !has;
    const keep = this.menu.current;
    this.menu.setItems([this.iResume, has ? this.iCheck : null, ...this.iRest]);
    const i = this.menu.items.indexOf(keep);
    if (i >= 0) this.menu.focus(i, true);
  }

  _padName(cp) {
    const n = cp?.pad?.name || cp?.padName || '';
    return n ? `«${String(n).replace(/[«»]/g, '')}»` : '';
  }

  _checkpoint() {
    const cp = this.ctx.mission?.checkpoint;
    if (!cp) return;
    const t = Number(cp.elapsed ?? cp.time ?? cp.t);
    const pad = this._padName(cp);
    const when = Number.isFinite(t) ? ` (${mmss(t)})` : '';
    this.hud.go('confirm', {
      title: 'ВЕРНУТЬСЯ К ПОСАДКЕ?',
      text: `Вылет продолжится с последней посадки${pad ? ` на ${pad}` : ''}${when}. Всё, что случилось после неё, будет потеряно.`,
      yes: 'С ПОСАДКИ',
      onYes: () => this.hud.emit('ui:retry-checkpoint', {}),
    });
  }

  show(opts) {
    super.show(opts);
    this._items();
    if (!opts?.returning) this.menu.focus(0, true);
    this._logKey = '';
    this._fill();
    if (!opts?.returning) this.logBox.scrollTop = this.logBox.scrollHeight;
  }

  _fill() {
    const ctx = this.ctx;
    const mis = ctx.mission || {};
    const def = mis.def || {};
    const st = mis.stats || {};
    const h = ctx.heli || {};
    const t = mis.elapsed ?? st.time ?? 0;
    this.tcEl.textContent = `● ${mmss(t)} · ${def.endless ? 'СМЕНА' : `ОПЕРАЦИЯ ${def.number || ''}`}`;
    let html = `<div class="pc-head"><span class="pc-num">${esc(def.endless ? 'СМЕНА' : def.number || '')}</span><span class="pc-title">${esc(def.title || '')}</span></div>`;
    // numbers
    const total = st.total || def.total || 0;
    html += '<div class="pc-stats">';
    html += `<div><b>${st.rescued || 0}${def.endless ? '' : `/${total}`}</b><span>спасено</span></div>`;
    html += `<div><b>${st.lost || 0}</b><span>потеряно</span></div>`;
    html += `<div><b>${mmss(t)}</b><span>${def.par ? `пар ${mss(def.par)}` : 'в полёте'}</span></div>`;
    html += `<div><b>${Math.round((h.fuel ?? 1) * 100)}${NBSP}%</b><span>топливо</span></div>`;
    html += '</div>';
    // objectives
    const objs = Array.isArray(mis.objectives) ? mis.objectives : [];
    if (objs.length) {
      html += '<div class="pc-label">ЗАДАЧИ</div><ul class="pc-obj">';
      for (const o of objs) {
        const mark = o.done ? '■' : o.failed ? '✕' : o.kind === 'main' ? '□' : '◇';
        const prog = o.target && (o.id === 'rescue' || o.id === 'all' || o.tags) ? ` · ${o.progress || 0}/${o.target}` : '';
        html += `<li class="${o.done ? 'done' : o.failed ? 'failed' : ''}"><span class="box">${mark}</span>${esc(o.text)}${prog}</li>`;
      }
      html += '</ul>';
    }
    // cabin manifest
    const cabin = h.cabin || [];
    html += `<div class="pc-label">НА БОРТУ · ${cabin.length}/${h.capacity || 6}</div>`;
    if (cabin.length) {
      html += '<ul class="pc-cabin">';
      for (const p of cabin) {
        const cond = p.condition && p.condition !== 'стабилен' ? ` · <i>${esc(p.condition)}</i>` : '';
        html += `<li>${esc(p.name || 'Пострадавший')}${Number.isFinite(p.age) ? `, ${p.age}` : ''}${cond}${p.stretcher ? ' · носилки' : ''}</li>`;
      }
      html += '</ul>';
    } else html += '<div class="pc-empty">салон пуст</div>';
    // forecast
    let fc = [];
    try {
      fc = ctx.weather?.forecast?.() || [];
    } catch {
      fc = [];
    }
    const ws = ctx.weather?.state;
    html += '<div class="pc-label">ПРОГНОЗ</div><div class="pc-fc">';
    if (ws) html += `<span class="fc-now">${WMO[ws.preset] || ''}${esc((PRESET_LABEL[ws.preset] || ws.preset || '').toLowerCase())}</span>`;
    for (const f of fc.slice(0, 3)) html += `<span class="fc-arr">→</span><span>${WMO[f.preset] || ''}через ${mss(f.in)} — ${esc((f.label || PRESET_LABEL[f.preset] || '').toLowerCase())}</span>`;
    if (!fc.length) html += '<span class="fc-arr">·</span><span>без изменений</span>';
    html += '</div>';
    this.cardMain.innerHTML = html;
    this._fillLog();
  }

  // Radio log (DESIGN §7.6 [NICE]): every stored line, oldest first, with the flight time; stays pinned
  // to the newest line unless the player has scrolled up to read.
  _fillLog() {
    const log = this.hud.flight?.subs?.log || [];
    const last = log[log.length - 1];
    const key = `${log.length}|${last ? last.time + last.text : ''}`;
    if (key === this._logKey) return;
    this._logKey = key;
    this.logWrap.hidden = !log.length;
    if (!log.length) return;
    const box = this.logBox;
    const pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    this.logLabel.textContent = `ЖУРНАЛ СВЯЗИ · ${log.length}`;
    let html = '';
    for (const l of log) {
      const t = Number.isFinite(l.time) ? `<span class="t">${mmss(l.time)}</span>` : '';
      html += `<div>${t}<b style="color:${l.color === '#E8EEF2' ? '#12212B' : l.color}">${esc(l.name)}</b> ${esc(l.text)}</div>`;
    }
    box.innerHTML = html;
    if (pinned) box.scrollTop = box.scrollHeight;
  }

  update(dt, top) {
    if (!this.visible || !top) return;
    this._t += dt;
    if (this._t > 1) {
      this._t = 0;
      this._items();
      this._fill();
    }
    // Backspace (back without pause) resumes; Esc / P are handled by the mission's pause poll
    if (this.hud.rawPressed('back') && !this.hud.rawPressed('pause')) this.hud.emit('ui:resume', {});
  }
}
