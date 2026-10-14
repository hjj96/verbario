// ДЕБРИФ (DESIGN §7.7, catalogue §4 items 50, 52): first the cinematic — letterbox, the caption typed in
// the lower bar («ОПЕРАЦИЯ ВЫПОЛНЕНА · ПОДНЯТО НА БОРТ 7/9 · ВРЕМЯ 14:32 · ТОПЛИВО 12 %»); then the
// «ВАХТЕННЫЙ ЖУРНАЛ»: a paper sheet with SVG feTurbulence grain. Report lines one every 400 ms with a
// typewriter clack (ui:type), the score counting up over 1.2 s, style bonuses, medals as lifebuoy rings
// with their criteria, the people manifest (names, ages, occupations, quotes; the unfound in grey —
// «поиск продолжается»), the flight track on a sea chart coloured by altitude, the crew remark, and the
// red stamp at −8° slamming in (scale 1.6 → 1 in 120 ms, ui:stamp, the sheet shakes 4 px).
// Buttons: ДАЛЕЕ / ПОВТОРИТЬ / В МЕНЮ. Any confirm skips the animation to its end.
import { el, fitCanvas } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Typewriter } from '../common/typewriter.js';
import { medalRing } from '../common/icons.js';
import { buildChartModel, makeView, drawChart, altColor } from '../common/chart.js';
import { NBSP, num0, esc, mmss, plural, easeOutCubic } from '../common/fmt.js';
import { Screen } from './screen.js';

const LINE_DT = 0.4;
const SPEAKER = { dispatch: 'БЕРЕГ', pilot: 'ВТОРОЙ ПИЛОТ', winchman: 'БОРТОПЕРАТОР', rescuer: 'СПАСАТЕЛЬ' };

let filterSeq = 0;

export class DebriefScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-debrief');
    // --- cinematic caption (inside the letterbox bars drawn by post) ------------------------------
    this.cine = el('div.deb-cine', { parent: this.node });
    this.cineTop = el('div.deb-cine-top', { parent: this.cine });
    this.cineCap = el('div.deb-cine-cap', { parent: this.cine });
    this.cineHint = el('div.deb-cine-hint', { parent: this.cine, html: '<kbd class="cap wide">Enter</kbd> вахтенный журнал' });
    this.twCap = new Typewriter(this.cineCap, { msPerChar: 30, emit: (ch) => ch !== ' ' && this.hud.emit('ui:type', { ch, voice: 'teletype' }) });

    // --- logbook sheet -------------------------------------------------------------------------------
    this.sheet = el('div.log-sheet.paper', { parent: this.node });
    const fid = `logNoise${++filterSeq}`;
    this.sheet.insertAdjacentHTML(
      'afterbegin',
      `<svg class="log-grain" aria-hidden="true" preserveAspectRatio="none"><filter id="${fid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="7" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .45  0 0 0 0 .36  0 0 0 0 .22  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#${fid})"/></svg>`,
    );
    el('div.log-stain', { parent: this.sheet });
    const head = el('div.log-head', { parent: this.sheet });
    el('div.log-kicker', { text: 'ВАХТЕННЫЙ ЖУРНАЛ · ВЕРТОЛЁТ «ЧАЙКА-07» · МСС «СТУДЁНОЕ МОРЕ»', parent: head });
    this.hTitle = el('h2.log-title', { parent: head });
    this.hNum = el('div.log-num', { parent: head });
    const cols = el('div.log-cols', { parent: this.sheet });
    // col 1: report + score
    const c1 = el('div.log-col.log-c1', { parent: cols });
    el('div.log-label', { text: 'РАПОРТ', parent: c1 });
    this.linesEl = el('div.log-lines', { parent: c1 });
    el('div.log-label', { text: 'СЧЁТ', parent: c1 });
    this.scoreEl = el('div.log-score', { parent: c1 });
    this.totalEl = el('div.log-total', { parent: c1 });
    // col 2: track + medals + remark
    const c2 = el('div.log-col.log-c2', { parent: cols });
    el('div.log-label', { text: 'ТРЕК ПОЛЁТА', parent: c2 });
    this.trackWrap = el('div.log-track', { parent: c2 });
    this.track = el('canvas', { parent: this.trackWrap });
    this.trackLegend = el('div.log-legend', { parent: c2, html: '<span class="lg-grad"></span><span>низко</span><span class="lg-r">высоко</span><span class="lg-m"><i class="d-res"></i>спасение <i class="d-haz"></i>опасность <i class="d-pad"></i>площадка</span>' });
    this.medalsEl = el('div.log-medals', { parent: c2 });
    this.remarkEl = el('div.log-remark', { parent: c2 });
    // col 3: manifest
    const c3 = el('div.log-col.log-c3', { parent: cols });
    el('div.log-label', { text: 'МАНИФЕСТ', parent: c3 });
    this.manEl = el('div.log-manifest', { parent: c3 });
    this.notesEl = el('div.log-notes', { parent: this.sheet });
    // stamp
    this.stamp = el('div.log-stamp', { parent: this.sheet });
    // buttons
    const foot = el('div.log-foot', { parent: this.sheet });
    this.bNext = el('div.btn.btn-primary', { text: 'ДАЛЕЕ', parent: foot, attrs: { role: 'button' } });
    this.bRetry = el('div.btn', { text: 'ПОВТОРИТЬ', parent: foot, attrs: { role: 'button' } });
    this.bMenu = el('div.btn.btn-ghost', { text: 'В МЕНЮ', parent: foot, attrs: { role: 'button' } });
    this.menu = new Menu(hud, { name: 'debrief', layout: 'horizontal' });
    this.sheet.addEventListener('click', (e) => {
      if (this.phase === 'logbook' && !this.done && !e.target.closest('.btn')) this._finishAll();
    });
    this.report = null;
    this.phase = 'cinematic';
    this.t = 0;
    this.seq = [];
  }

  show(opts = {}) {
    super.show(opts);
    this.report = opts.report || this.ctx.mission?.result || null;
    const phase = this.ctx.mission?.debriefPhase;
    this._cinematic();
    if (phase === 'logbook' && this.report) this.onLogbook(this.report);
  }

  onResult(p) {
    if (p?.report) this.report = p.report;
    if (this.visible && this.phase === 'cinematic') this._cinematic();
  }

  _cinematic() {
    const r = this.report;
    this.phase = 'cinematic';
    this.node.classList.remove('logbook');
    this.cine.classList.add('on');
    this.t = 0;
    this.cineTop.textContent = r ? (r.endless ? 'ДЕЖУРНАЯ СМЕНА' : `ОПЕРАЦИЯ ${r.number || ''} · ${r.codename ? `«${r.codename}»` : r.title || ''}`) : '';
    this.twCap.start(r?.caption || 'ОПЕРАЦИЯ ЗАВЕРШЕНА', 0.6);
    this.menu.setItems([]);
  }

  onLogbook(report) {
    if (report) this.report = report;
    if (!this.visible) return;
    this.phase = 'logbook';
    this.node.classList.add('logbook');
    this.cine.classList.remove('on');
    this._fill();
    this.t = 0;
    this.skip = false;
    this.done = false;
  }

  // ---------------------------------------------------------------------------------------------
  _fill() {
    const r = this.report || {};
    const mis = this.ctx.mission || {};
    this.hTitle.textContent = r.endless ? 'Смена' : `${r.codename ? `«${r.codename}» — ` : ''}${r.title || 'Операция'}`;
    this.hNum.textContent = r.endless ? 'ДЕЖУРСТВО' : `ОПЕРАЦИЯ ${r.number || ''} / ${String(mis.campaignCount || 8).padStart(2, '0')}`;
    this.seq = [];
    // report lines
    this.linesEl.innerHTML = '';
    let t = 0.45;
    for (const ln of r.lines || []) {
      const row = el('div.log-line', { parent: this.linesEl, html: `<span class="ll">${esc(ln.label)}</span><span class="dots"></span><span class="lv">${esc(ln.value)}</span>` });
      this.seq.push({ t, node: row, sound: 'type' });
      t += LINE_DT;
    }
    // score breakdown
    this.scoreEl.innerHTML = '';
    const sc = r.score || { lines: [], styles: [], total: 0 };
    for (const l of sc.lines || []) {
      const row = el('div.sc-row', { parent: this.scoreEl, html: `<span>${esc(l.label)}${l.count > 1 ? ` ×${l.count}` : ''}</span><b class="${l.points < 0 ? 'neg' : ''}">${l.points > 0 ? '+' : l.points < 0 ? '−' : ''}${num0(Math.abs(l.points))}</b>` });
      this.seq.push({ t, node: row });
      t += 0.12;
    }
    for (const s of sc.styles || []) {
      const row = el('div.sc-row.sc-style', { parent: this.scoreEl, html: `<span>«${esc(s.label)}»${s.chain > 1.01 ? ` <i>×${String(s.chain.toFixed(1)).replace('.', ',')}</i>` : ''}</span><b>+${num0(s.points)}</b>` });
      this.seq.push({ t, node: row, sound: 'type' });
      t += 0.15;
    }
    if (sc.difficulty && sc.difficulty.mult !== 1) {
      const row = el('div.sc-row.sc-diff', { parent: this.scoreEl, html: `<span>Сложность «${esc(sc.difficulty.label)}» ×${String(sc.difficulty.mult).replace('.', ',')}</span><b class="${sc.difficulty.points < 0 ? 'neg' : ''}">${sc.difficulty.points >= 0 ? '+' : '−'}${num0(Math.abs(sc.difficulty.points))}</b>` });
      this.seq.push({ t, node: row });
      t += 0.12;
    }
    this.totalEl.innerHTML = '<span>ИТОГО</span><b>0</b>';
    this.totalB = this.totalEl.querySelector('b');
    this.countFrom = t;
    this.countTo = sc.total || 0;
    this.seq.push({ t, node: this.totalEl });
    t += 1.2;

    // medals / endless table
    this.medalsEl.innerHTML = '';
    if (r.endless) {
      const er = r.endlessResult;
      const hs = er?.highscores || mis.highscores || [];
      let html = `<div class="log-label">ЛУЧШИЕ СМЕНЫ${er?.place ? ` · вы ${er.place}-е место` : ''}</div><div class="hs-table">`;
      hs.slice(0, 6).forEach((h, i) => {
        html += `<div class="hs-row${er?.place === i + 1 ? ' me' : ''}"><b>${i + 1}</b><span>${esc(h.date || '')}</span><span>спасено ${h.rescued}</span><span>${mmss(h.time || 0)}</span><span class="hs-score">${num0(h.score)}</span></div>`;
      });
      html += '</div>';
      this.medalsEl.innerHTML = html;
      this.seq.push({ t, node: this.medalsEl });
      t += 0.3;
    } else {
      el('div.log-label', { text: 'МЕДАЛИ', parent: this.medalsEl });
      const row = el('div.md-row', { parent: this.medalsEl });
      for (const m of r.medalList || []) {
        if (m.id === 'cross' && !m.got) continue;
        const cell = el(`div.md-cell${m.got ? '.got' : ''}`, { parent: row, html: `${medalRing(m.id, m.got, 34)}<b>${esc(m.label)}</b><span>${esc(m.text || '')}</span>` });
        this.seq.push({ t, node: cell, sound: m.got ? 'stamp-soft' : null });
        t += 0.32;
      }
    }

    // remark
    const rm = r.remark;
    this.remarkEl.innerHTML = rm ? `<span class="rm-who">${esc(SPEAKER[rm.speaker] || '')}${rm.name ? ` · ${esc(rm.name)}` : ''}</span><q>${esc(rm.text)}</q>` : '';
    this.seq.push({ t, node: this.remarkEl });

    // manifest
    this.manEl.innerHTML = '';
    const people = r.people || [];
    let mt = 0.9;
    for (const p of people) {
      const st = p.status || 'missing';
      const row = el(`div.mf-row.st-${st}`, { parent: this.manEl });
      const age = Number.isFinite(p.age) ? `, ${p.age}${NBSP}${plural(p.age, 'год', 'года', 'лет')}` : '';
      const occ = p.occupation ? ` · ${esc(p.occupation)}` : '';
      const mins = Number.isFinite(p.minutes) && st !== 'missing' && st !== 'lost' ? ` · в воде ${p.minutes}${NBSP}мин` : '';
      row.innerHTML = `<div class="mf-name">${esc(p.name || '—')}<span>${age}${occ}</span></div><div class="mf-st">${esc(p.statusText || '')}${p.condition && st !== 'lost' && st !== 'missing' ? ` · ${esc(p.condition)}` : ''}${mins}</div>${p.quote ? `<q class="mf-q">${esc(p.quote)}</q>` : ''}`;
      this.seq.push({ t: mt, node: row });
      mt += 0.09;
    }
    if (r.missingText) {
      const row = el('div.mf-missing', { parent: this.manEl, text: r.missingText });
      this.seq.push({ t: mt, node: row });
    }
    if (!people.length) this.manEl.innerHTML = '<div class="mf-empty">Список пострадавших не передан.</div>';

    // progress notes (record, unlock, rank)
    const pr = r.progress;
    const notes = [];
    if (pr?.newBest) notes.push('НОВЫЙ РЕКОРД ОПЕРАЦИИ');
    if (pr?.unlocked) notes.push(`ОТКРЫТА ОПЕРАЦИЯ ${String(pr.unlocked.index + 1).padStart(2, '0')} — «${pr.unlocked.title}»`);
    if (pr?.rankUp) notes.push(`НОВОЕ ЗВАНИЕ: ${pr.rankUp.to.toUpperCase()}`);
    if (r.endlessResult?.place) notes.push(`${r.endlessResult.place}-Е МЕСТО В ТАБЛИЦЕ «СМЕНЫ»`);
    this.notesEl.innerHTML = notes.map((n) => `<span>${esc(n)}</span>`).join('');
    this.seq.push({ t: t + 0.2, node: this.notesEl });

    // stamp
    this.stamp.textContent = r.stamp || (r.success ? 'СПАСЕНЫ' : 'ОПЕРАЦИЯ ПРЕРВАНА');
    this.stamp.classList.toggle('fail', !r.success);
    this.stampT = t + 0.5;
    this.stamp.classList.remove('slam');

    for (const s of this.seq) s.node.classList.add('pending');

    // buttons
    const items = [];
    const canNext = !r.endless && r.success && Number.isFinite(r.index) && r.index + 1 < (mis.list?.length || 0);
    this.bNext.hidden = !canNext;
    if (canNext) items.push({ el: this.bNext, onActivate: () => this.hud.emit('ui:next', {}) });
    items.push({ el: this.bRetry, onActivate: () => this.hud.emit('ui:retry', {}) });
    items.push({ el: this.bMenu, onActivate: () => this.hud.emit('ui:menu', {}) });
    this.menu.setItems(items);
    this.menu.focus(0, true);
    this.blockInput = true; // first confirm skips the animation

    // track chart
    this._trackT = 0;
    this._prepTrack();
  }

  _prepTrack() {
    const r = this.report || {};
    const def = this.ctx.mission?.def || {};
    const rc = this.trackWrap.getBoundingClientRect();
    const W = Math.max(160, Math.round(rc.width));
    const H = Math.max(120, Math.round(rc.height));
    this.tw_ = W;
    this.th_ = H;
    this.tdpr = fitCanvas(this.track, W, H, 2);
    const pts = r.track || [];
    // frame the flown area (+ pads)
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const grow = (x, z) => {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    };
    for (const p of pts) grow(p[0], p[1]);
    for (const m of r.marks || []) grow(m.x, m.z);
    if (!Number.isFinite(x0)) {
      x0 = z0 = -800;
      x1 = z1 = 800;
    }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const span = Math.max(500, (x1 - x0) * (H / W) > z1 - z0 ? (x1 - x0) * (H / W) : z1 - z0) * 1.25;
    const model = buildChartModel(this.ctx.look, def, { radius: span, cx, cz, margin: 1, grid: 80, coast: false });
    const v = makeView(model, W, H, { span, cx, cz });
    this._tv = v;
    this._base = document.createElement('canvas');
    this._base.width = this.track.width;
    this._base.height = this.track.height;
    drawChart(this._base.getContext('2d'), model, v, { style: 'dark', dpr: this.tdpr, border: false, labels: false });
    this._pts = pts;
    this._drawTrack(0);
  }

  _drawTrack(k) {
    const g = this.track.getContext('2d');
    const v = this._tv;
    if (!v) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this._base, 0, 0);
    g.setTransform(this.tdpr, 0, 0, this.tdpr, 0, 0);
    const X = (x) => v.ox + x * v.scale;
    const Z = (z) => v.oy + z * v.scale;
    const pts = this._pts || [];
    const n = Math.floor(pts.length * Math.min(1, k));
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      g.strokeStyle = altColor(pts[i][2]);
      g.beginPath();
      g.moveTo(X(pts[i - 1][0]), Z(pts[i - 1][1]));
      g.lineTo(X(pts[i][0]), Z(pts[i][1]));
      g.stroke();
    }
    if (n > 0) {
      const p = pts[n - 1];
      g.fillStyle = '#F4FBF8';
      g.beginPath();
      g.arc(X(p[0]), Z(p[1]), 3, 0, Math.PI * 2);
      g.fill();
    }
    // marks
    for (const m of this.report?.marks || []) {
      const x = X(m.x);
      const y = Z(m.z);
      if (m.type === 'pad') {
        g.strokeStyle = '#56B4E9';
        g.fillStyle = '#56B4E9';
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.stroke();
        g.font = '700 8px Oswald, Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', x, y + 0.5);
      } else if (m.type === 'hazard') {
        g.fillStyle = '#D67AD9';
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 6, y + 5);
        g.lineTo(x - 6, y + 5);
        g.closePath();
        g.fill();
      } else {
        g.fillStyle = m.type === 'lost' ? '#8B9094' : '#FF5A1F';
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
      }
    }
  }

  _finishAll() {
    this.skip = true;
    for (const s of this.seq) s.node.classList.remove('pending');
    this.totalB.textContent = num0(this.countTo);
    this._drawTrack(1);
    this._trackT = 9;
    if (!this.stamp.classList.contains('slam')) this._slam();
    this.done = true;
    this.blockInput = false;
  }

  _slam() {
    this.stamp.classList.add('slam');
    this.sheet.classList.remove('shake');
    void this.sheet.offsetWidth;
    this.sheet.classList.add('shake');
    this.hud.emit('ui:stamp', { success: !!this.report?.success });
  }

  update(dt, top) {
    if (!this.visible) return;
    if (this.phase === 'cinematic') {
      this.t += dt;
      this.twCap.update(dt);
      this.cineHint.classList.toggle('on', this.t > 1.5);
      return;
    }
    if (this.done) return;
    this.t += dt;
    for (const s of this.seq) {
      if (s.fired || this.t < s.t) continue;
      s.fired = true;
      s.node.classList.remove('pending');
      if (s.sound === 'type') this.hud.emit('ui:type', { ch: '■', voice: 'typewriter' });
      else if (s.sound === 'stamp-soft') this.hud.emit('ui:stamp', { soft: true });
    }
    if (this.t >= this.countFrom) {
      const k = easeOutCubic((this.t - this.countFrom) / 1.2);
      this.totalB.textContent = num0(this.countTo * k);
    }
    if (this._trackT < 1.6) {
      this._trackT += dt;
      this._drawTrack(easeOutCubic(this._trackT / 1.6));
    }
    if (this.t >= this.stampT) this._finishAll();
    void top;
  }

  handleInput() {
    if (!this.visible || this.phase !== 'logbook' || this.done) return;
    if (this.hud.rawPressed('confirm') || this.hud.rawPressed('winch') || this.hud.rawPressed('back')) this._finishAll();
  }

  onFonts() {
    if (this.visible && this.phase === 'logbook') this._drawTrack(this.done ? 1 : Math.min(1, this._trackT / 1.6));
  }
}
