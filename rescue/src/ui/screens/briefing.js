// БРИФИНГ (DESIGN §7.2): left — the dossier: «ОПЕРАЦИЯ 03 / 08», title (Oswald 48), the operation card
// and the brief typed at 28 ms/char (teletype ticks + the dispatcher's babble via ui:type; click / Space
// prints everything at once), objectives «□ / ◇», the forecast strip with WMO symbols from
// def.weather.script, the aircraft card. Right — the procedural navigation chart: border graduations,
// isobaths, coordinates, search areas, pads ○H, red pencil circles that draw themselves, fronts as
// meteo symbols, wind barb, compass rose, scale bar, cartouche. Bottom: [ВЫЛЕТ] (Enter / A) and «Назад».
import { el, fitCanvas } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Typewriter } from '../common/typewriter.js';
import { WEATHER_ICON, WMO, HELI } from '../common/icons.js';
import { buildChartModel, makeView, drawChart, drawPad, drawLight, drawDatum, pencilCircle, pencilCross, drawFront, drawWindBarb, drawRose, drawScaleBar } from '../common/chart.js';
import { NBSP, mss, esc, num0, PRESET_LABEL, PRESET_SEVERITY, compass8 } from '../common/fmt.js';
import { PAPER } from '../common/palette.js';
import { Screen } from './screen.js';

const WIND = { calm: 3, overcast: 9, squall: 16, storm: 24, nightStorm: 21, fog: 3, clearing: 6, nightCalm: 2 };

export class BriefingScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-brief');
    el('div.brief-table', { parent: this.node }); // dark wooden table under the papers
    const dossier = el('div.brief-dossier.paper', { parent: this.node });
    this.dossier = dossier;
    const head = el('div.bd-head', { parent: dossier });
    this.opNum = el('div.bd-num', { parent: head });
    el('div.bd-stamp', { text: 'СРОЧНО', parent: head });
    this.title = el('h2.bd-title', { parent: dossier });
    this.subtitle = el('div.bd-subtitle', { parent: dossier });
    this.cond = el('div.bd-cond', { parent: dossier });
    this.cardEl = el('div.bd-card', { parent: dossier });
    this.textWrap = el('div.bd-text-wrap', { parent: dossier });
    this.textEl = el('div.bd-text', { parent: this.textWrap });
    const cols = el('div.bd-cols', { parent: dossier });
    const ob = el('div.bd-block', { parent: cols });
    el('div.bd-label', { text: 'ЗАДАЧИ', parent: ob });
    this.objEl = el('ul.bd-obj', { parent: ob });
    const fc = el('div.bd-block', { parent: cols });
    el('div.bd-label', { text: 'ПРОГНОЗ', parent: fc });
    this.fcEl = el('div.bd-fc', { parent: fc });
    this.craft = el('div.bd-craft', { parent: dossier });
    this.hsEl = el('div.bd-hs', { parent: dossier });

    const chartWrap = el('div.brief-chart.paper', { parent: this.node });
    this.chartWrap = chartWrap;
    this.canvas = el('canvas', { parent: chartWrap });
    this.base = document.createElement('canvas');

    const foot = el('div.brief-foot', { parent: this.node });
    this.bBack = el('div.btn.btn-ghost', { text: '‹ НАЗАД', parent: foot, attrs: { role: 'button' } });
    this.bGo = el('div.btn.btn-launch', { parent: foot, attrs: { role: 'button' }, html: 'ВЫЛЕТ <kbd class="cap wide">Enter</kbd>' });
    this.menu = new Menu(hud, { name: 'briefing', layout: 'horizontal', onBack: () => this._back() });
    this.menu.setItems([
      { el: this.bBack, onActivate: () => this._back() },
      { el: this.bGo, onActivate: () => this._launch() },
    ]);
    this.twCard = new Typewriter(this.cardEl, { msPerChar: 22, emit: (ch, i) => this._tick(ch, i), cursor: true });
    this.tw = new Typewriter(this.textEl, { msPerChar: 28, emit: (ch, i) => this._tick(ch, i, 'dispatch'), cursor: true });
    this.chartT = 0;
    this._leaving = 0;
    this.textWrap.addEventListener('click', () => this._finishTyping());
  }

  _tick(ch, i, voice) {
    if (ch === ' ' || ch === '\n') return;
    this.hud.emit('ui:type', { ch, i, voice: voice || 'teletype' });
  }

  _finishTyping() {
    this.twCard.finish();
    this.tw.finish();
  }

  _back() {
    this.hud.emit('ui:menu', {});
  }

  _launch() {
    if (this._leaving > 0) return;
    this._finishTyping();
    this._leaving = 0.24; // the menu fades out in 240 ms, then the camera dives (DESIGN §7.2)
    this.node.classList.add('leaving');
  }

  show(opts = {}) {
    super.show(opts);
    this.node.classList.remove('leaving');
    this._leaving = 0;
    const mis = this.ctx.mission || {};
    const def = mis.def || {};
    this.def = def;
    const endless = !!def.endless;
    const total = mis.campaignCount || 8;
    this.opNum.textContent = endless ? 'ДЕЖУРНАЯ СМЕНА · МАЯК «СКАЛИСТЫЙ»' : `ОПЕРАЦИЯ ${def.number || String((def.index ?? 0) + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}${def.star ? ' · ★' : ''}`;
    this.title.textContent = def.title || 'Операция';
    this.subtitle.textContent = def.subtitle || '';
    // conditions with pictograms
    const presets = def.presets || [def.weather?.start || 'calm'];
    const uniq = presets.filter((p, i, a) => a.indexOf(p) === i);
    this.cond.innerHTML = uniq.map((p) => `<span class="bc-item">${WEATHER_ICON[p] || ''}<span>${esc(PRESET_LABEL[p] || p)}</span></span>`).join('<i class="arr">→</i>') + `<span class="bc-item bc-water">вода +${def.waterTemp ?? 8}${NBSP}°C</span>`;
    // typed card + brief
    this.twCard.start(def.card || '', 0.25);
    this.tw.start(String(def.brief || '').trim(), 0.25 + (def.card ? def.card.length * 0.022 : 0) + 0.35);
    this.textWrap.scrollTop = 0;
    // objectives
    const objs = Array.isArray(mis.objectives) ? mis.objectives : [];
    this.objEl.innerHTML = objs.length
      ? objs.map((o) => `<li class="${o.kind === 'main' ? 'main' : 'bonus'}"><span class="box">${o.kind === 'main' ? '□' : '◇'}</span>${esc(o.text)}</li>`).join('')
      : `<li class="main"><span class="box">□</span>Спасти людей</li>`;
    // forecast strip (WMO symbols)
    const steps = [{ at: 0, to: def.weather?.start || 'calm' }, ...(def.weather?.script || [])];
    this.fcEl.innerHTML = endless
      ? `<div class="fc-step">${WMO.calm}<span class="fc-t">08:00</span><span class="fc-l">штиль</span></div><div class="fc-arrow">→</div><div class="fc-step">${WMO.storm}<span class="fc-t">по обстановке</span><span class="fc-l">ухудшение к вечеру</span></div><div class="fc-arrow">→</div><div class="fc-step">${WMO.nightStorm}<span class="fc-t">15:00</span><span class="fc-l">ночь</span></div>`
      : steps
          .map((s, i) => `${i ? '<div class="fc-arrow">→</div>' : ''}<div class="fc-step${PRESET_SEVERITY[s.to] >= 3 ? ' bad' : ''}">${WMO[s.to] || ''}<span class="fc-t">${i ? `+${mss(s.at)}` : 'сейчас'}</span><span class="fc-l">${esc((PRESET_LABEL[s.to] || s.to).toLowerCase())}</span></div>`)
          .join('');
    this.craft.innerHTML = `<span class="cr-ico">${HELI}</span><b>«Чайка-07»</b> · топливо 100${NBSP}% · мест 6 · трос 30${NBSP}м<span class="cr-crew">экипаж: Гордеев, Семёныч, Костя</span>${def.par ? `<span class="cr-par">пар ${mss(def.par)}</span>` : ''}`;
    // «Смена»: the top table
    const hs = endless && Array.isArray(mis.highscores) ? mis.highscores : [];
    this.hsEl.innerHTML = hs.length ? `<div class="bd-label">ЛУЧШИЕ СМЕНЫ</div>${hs.slice(0, 5).map((h, i) => `<div class="hs-row"><b>${i + 1}</b><span>${esc(h.date || '')}</span><span>спасено ${h.rescued}</span><span class="hs-score">${num0(h.score)}</span></div>`).join('')}` : '';
    this.menu.focus(1, true);
    this.blockInput = false;
    this._buildChart();
    this.chartT = 0;
  }

  // ---------------------------------------------------------------------------------------------
  _buildChart() {
    const r = this.chartWrap.getBoundingClientRect();
    const W = Math.max(200, Math.round(r.width));
    const H = Math.max(200, Math.round(r.height));
    this.cw = W;
    this.ch = H;
    this.dpr = fitCanvas(this.canvas, W, H, 2);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const def = this.def;
    const R = def.area?.radius || 1500;
    const model = buildChartModel(this.ctx.look, def, { radius: R, margin: 1.12, grid: 120 });
    this.model = model;
    const v = makeView(model, W, H, { span: R * 2.05, pad: 18 });
    this.view = v;
    const g = this.base.getContext('2d');
    drawChart(g, model, v, { style: 'paper', dpr: this.dpr, border: true, labels: true });
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const X = (x) => v.ox + x * v.scale;
    const Z = (z) => v.oy + z * v.scale;

    // fronts from the weather script (cold = worse, warm = gentler worsening, occluded = both ways)
    const steps = def.weather?.script || [];
    let worse = 0;
    let better = 0;
    let prev = def.weather?.start || 'calm';
    for (const s of steps) {
      const d = (PRESET_SEVERITY[s.to] ?? 0) - (PRESET_SEVERITY[prev] ?? 0);
      if (d >= 2) worse += 2;
      else if (d > 0) worse += 1;
      else if (d < 0) better++;
      prev = s.to;
    }
    const kind = worse && better ? 'occluded' : worse >= 2 ? 'cold' : worse ? 'warm' : null;
    const from = def.windFrom ?? def.weather?.windFrom ?? 300;
    if (kind) {
      // the front approaches from upwind: a curve across the chart on the windward side
      const a = (from * Math.PI) / 180;
      const ux = Math.sin(a);
      const uz = -Math.cos(a);
      const cx = ux * R * 0.72;
      const cz = uz * R * 0.72;
      const pts = [];
      for (let k = -8; k <= 8; k++) {
        const o = k * R * 0.16;
        const bend = (k * k - 20) * R * 0.0045 + Math.sin(k * 1.3) * R * 0.012; // bulges downwind, wavy
        pts.push(X(cx - uz * o - ux * bend), Z(cz + ux * o - uz * bend));
      }
      drawFront(g, pts, kind, -ux, -uz);
      g.font = 'italic 10.5px Inter, system-ui, sans-serif';
      g.fillStyle = kind === 'cold' ? PAPER.cold : kind === 'warm' ? PAPER.warm : PAPER.occl;
      g.textAlign = 'center';
      g.fillText(kind === 'cold' ? 'холодный фронт' : kind === 'warm' ? 'тёплый фронт' : 'фронт окклюзии', X(cx + ux * 60), Z(cz + uz * 60));
    } else if ((PRESET_SEVERITY[def.weather?.start] ?? 0) >= 3) {
      // a deep low: «Н» with isobars upwind
      const a = (from * Math.PI) / 180;
      const lx = X(Math.sin(a) * R * 0.8);
      const ly = Z(-Math.cos(a) * R * 0.8);
      g.strokeStyle = 'rgba(46,107,214,.55)';
      g.lineWidth = 1;
      for (let k = 1; k <= 4; k++) {
        g.beginPath();
        g.ellipse(lx, ly, k * 34, k * 26, 0.4, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = '700 26px Oswald, Impact, "Arial Narrow", sans-serif';
      g.fillStyle = PAPER.warm;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Н', lx, ly);
    }

    // pads
    const pads = def.world?.pads || [];
    for (const p of pads) {
      const x = X(p.x);
      const y = Z(p.z);
      if (p.type === 'lighthouse') drawLight(g, x, y);
      if (p.type === 'ship' && Array.isArray(p.route) && p.route.length > 1) {
        g.save();
        g.strokeStyle = 'rgba(18,33,43,.45)';
        g.setLineDash([5, 4]);
        g.beginPath();
        p.route.forEach((q, i) => (i ? g.lineTo(X(q[0]), Z(q[1])) : g.moveTo(X(q[0]), Z(q[1]))));
        g.closePath();
        g.stroke();
        g.restore();
      }
      if (p.type === 'rig') {
        g.strokeStyle = PAPER.ink;
        g.lineWidth = 1.4;
        g.strokeRect(x - 7, y - 7, 14, 14);
        g.beginPath();
        g.moveTo(x - 7, y - 7);
        g.lineTo(x + 7, y + 7);
        g.moveTo(x + 7, y - 7);
        g.lineTo(x - 7, y + 7);
        g.stroke();
      }
      drawPad(g, x, y + (p.type === 'lighthouse' ? 15 : p.type === 'rig' ? 17 : 0), p.name || '', PAPER.ink);
    }
    // datums
    let di = 0;
    for (const d of def.datums || []) {
      di++;
      drawDatum(g, X(d.x), Z(d.z), Math.max(10, d.radius * v.scale), `РАЙОН ${di}`, PAPER.orange);
    }
    // visible incidents (not hidden): pencil cross + label
    for (const s of def.survivors || []) {
      if (s.hidden || s.at > 0) continue;
      pencilCross(g, X(s.x), Z(s.z), 7);
      g.font = 'italic 11px Inter, system-ui, sans-serif';
      g.fillStyle = PAPER.stamp;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(s.label || s.name || '', X(s.x) + 12, Z(s.z) + 2);
    }
    // heli start: a small triangle «Ч-07» left of the start point
    const hp = def.heli && Number.isFinite(def.heli.x) ? def.heli : pads[def.heli?.pad || 0] || { x: 0, z: 0 };
    const sx = X(hp.x) - 26;
    const sy = Z(hp.z) + 15;
    g.fillStyle = PAPER.ink;
    g.beginPath();
    g.moveTo(sx, sy - 6);
    g.lineTo(sx + 4.5, sy + 5);
    g.lineTo(sx - 4.5, sy + 5);
    g.closePath();
    g.fill();
    g.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText('Ч-07', sx - 8, sy);

    // furniture: wind barb, rose, scale bar, cartouche
    const preset = def.weather?.start || 'calm';
    const bx = W - 70;
    const by = 70;
    drawWindBarb(g, bx, by, from, WIND[preset] ?? 6, 30);
    g.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
    g.fillStyle = PAPER.ink;
    g.textAlign = 'center';
    g.fillText(`ВЕТЕР ${compass8(from)} ${WIND[preset] ?? 6} м/с`, bx, by + 42);
    drawRose(g, W - 74, H - 96, 40);
    drawScaleBar(g, 34, H - 44, v.scale);
    // cartouche
    const cw = Math.min(250, W * 0.42);
    g.fillStyle = 'rgba(243,233,214,.93)';
    g.fillRect(30, 30, cw, 64);
    g.strokeStyle = PAPER.ink;
    g.lineWidth = 1;
    g.strokeRect(30.5, 30.5, cw, 64);
    g.strokeRect(33.5, 33.5, cw - 6, 58);
    g.fillStyle = PAPER.ink;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = '700 13px Oswald, Impact, "Arial Narrow", sans-serif';
    g.fillText(def.endless ? 'РАЙОН ДЕЖУРСТВА' : `КАРТА РАЙОНА ОПЕРАЦИИ`, 42, 52);
    g.font = '600 12px Oswald, Impact, "Arial Narrow", sans-serif';
    g.fillText(def.codename ? `«${def.codename}»` : def.title || '', 42, 68);
    g.font = 'italic 10px Inter, system-ui, sans-serif';
    g.fillText(`Студёное море · глубины в метрах · ${def.coords || ''}`.slice(0, 64), 42, 84);
    this._pencils = (def.datums || []).map((d, i) => ({ x: X(d.x), y: Z(d.z), r: Math.max(14, d.radius * v.scale) * 1.18 + 6, t0: 0.6 + i * 0.75, seed: 17 + i * 31 }));
    for (const s of def.survivors || []) {
      if (s.hidden || s.at > 0) continue;
      this._pencils.push({ x: X(s.x), y: Z(s.z), r: 22, t0: 0.6 + this._pencils.length * 0.75, seed: 91 + this._pencils.length });
    }
    this._compose(0);
  }

  _compose(t) {
    const g = this.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    let done = true;
    for (const p of this._pencils || []) {
      const k = Math.max(0, Math.min(1, (t - p.t0) / 0.9));
      if (k < 1) done = false;
      pencilCircle(g, p.x, p.y, p.r, k, p.seed, '#C8102E');
    }
    return done;
  }

  update(dt) {
    if (!this.visible) return;
    this.twCard.update(dt);
    this.tw.update(dt);
    this.blockInput = !this.tw.done || !this.twCard.done;
    // keep the typing line in view
    if (!this.tw.done) this.textWrap.scrollTop = this.textWrap.scrollHeight;
    if (this.chartT >= 0) {
      this.chartT += dt;
      if (this._compose(this.chartT)) this.chartT = -1;
    }
    if (this._leaving > 0) {
      this._leaving -= dt;
      if (this._leaving <= 0) this.hud.emit('ui:launch', {});
    }
  }

  // While the brief is being typed the menu is blocked: Space / Enter / A print everything at once
  // (a click on the text too); Esc still goes back. Then Enter launches.
  handleInput() {
    if (!this.visible || !this.blockInput) return;
    if (this.hud.rawPressed('winch') || this.hud.rawPressed('confirm')) {
      this._finishTyping();
      this.hud.setKeyboardNav(true);
    } else if (this.hud.rawPressed('back')) this._back();
  }

  resize() {
    if (this.visible) {
      this._buildChart();
      this.chartT = -1;
      this._compose(99);
    }
  }

  onFonts() {
    if (this.visible) {
      this._buildChart();
      this._compose(this.chartT < 0 ? 99 : this.chartT);
    }
  }
}
