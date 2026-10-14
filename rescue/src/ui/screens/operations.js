// ОПЕРАЦИИ (DESIGN §7.2): the paper register — a grid of 280×160 cards on a slowly drifting sea chart.
// Card: number «03» (mono 40), title, weather pictograms, 1–5 difficulty waves, three lifebuoy medal
// rings (bronze / silver / gold, empty = outline) + the cross, best score; locked cards at 40 % with a
// lock and «Пройдите операцию 02». Selecting emits ui:select-mission {index}.
import { el, fitCanvas } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { WEATHER_ICON, medalRing, waves, LOCK, STAR } from '../common/icons.js';
import { buildChartModel, makeView, drawChart, drawPad, drawLight, drawRose } from '../common/chart.js';
import { num0, mmss, esc, PRESET_LABEL } from '../common/fmt.js';
import { PAPER } from '../common/palette.js';
import { Screen } from './screen.js';

const BG_DEF = {
  seed: 31,
  coords: '69°12′ с.ш. 33°30′ в.д.',
  area: { radius: 3000 },
  world: {
    pads: [{ type: 'lighthouse', name: 'Скалистый', x: 0, z: 0 }, { type: 'rig', name: 'Северная-7', x: 1150, z: -650 }, { type: 'ship', name: 'Арктур', x: -700, z: -500 }],
    props: { lighthouse: true, rocks: [{ x: -62, z: 38, radius: 26, height: 12 }, { x: 74, z: 52, radius: 16, height: 8 }, { x: -260, z: 150, radius: 22, height: 38 }, { x: 420, z: 90, radius: 16, height: 22 }] },
  },
};

export class OperationsScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-ops');
    this.bg = el('canvas.ops-chart', { parent: this.node });
    el('div.ops-vignette', { parent: this.node });
    const head = el('div.ops-head', { parent: this.node });
    this.back = el('div.btn.btn-ghost.ops-back', { text: '‹ НАЗАД', parent: head, attrs: { role: 'button' } });
    const ht = el('div.ops-titles', { parent: head });
    el('h2.ops-title', { text: 'ОПЕРАЦИИ', parent: ht });
    this.sub = el('div.ops-sub', { parent: ht });
    this.grid = el('div.ops-grid', { parent: this.node, attrs: { role: 'list' } });
    this.note = el('div.ops-note', { parent: this.node });
    this.menu = new Menu(hud, {
      name: 'operations',
      columns: () => this._cols(),
      onBack: () => this.hud.back(),
    });
    this.back.addEventListener('click', () => {
      this.hud.emit('ui:back', {});
      this.hud.back();
    });
    this._bgDone = false;
    this.on = this.hud.on('mission:locked', (p) => this._shakeLocked(p?.index));
  }

  _cols() {
    const items = this.grid.children;
    if (items.length < 2) return 1;
    const top = items[0].offsetTop;
    let n = 0;
    for (const c of items) if (c.offsetTop === top) n++;
    return Math.max(1, n);
  }

  _drawBg() {
    const W = Math.round(window.innerWidth * 1.25);
    const H = Math.round(window.innerHeight * 1.25);
    const dpr = fitCanvas(this.bg, W, H, 1.5);
    const g = this.bg.getContext('2d');
    const model = buildChartModel(this.ctx.look, BG_DEF, { radius: 3000, margin: 1.1, grid: 120 });
    const v = makeView(model, W, H, { span: 4200 });
    drawChart(g, model, v, { style: 'paper', dpr, border: true, labels: true, fontScale: 1.1 });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of BG_DEF.world.pads) {
      const x = v.ox + p.x * v.scale;
      const y = v.oy + p.z * v.scale;
      if (p.type === 'lighthouse') drawLight(g, x, y, 1.1);
      drawPad(g, x + (p.type === 'lighthouse' ? 0 : 0), y + (p.type === 'lighthouse' ? 16 : 0), p.name, PAPER.ink, 1.1);
    }
    drawRose(g, W - 150, H - 170, 62, PAPER.ink, 1.1);
    this._bgDone = true;
  }

  _card(c, total) {
    const node = el(`div.op-card.paper${c.locked ? '.locked' : ''}${c.star ? '.star' : ''}${c.passed ? '.passed' : ''}`, { attrs: { role: 'listitem' } });
    const top = el('div.op-top', { parent: node });
    el('div.op-num', { text: c.star ? '★' : c.number || '', parent: top });
    const meta = el('div.op-meta', { parent: top });
    el('div.op-code', { text: c.codename ? `«${c.codename}»` : '', parent: meta });
    el('div.op-wx', { parent: meta, html: (c.presets || []).filter((p, i, a) => a.indexOf(p) === i).map((p) => `<span title="${esc(PRESET_LABEL[p] || p)}">${WEATHER_ICON[p] || ''}</span>`).join('<i class="arr">›</i>') });
    el('div.op-title', { text: c.title || '', parent: node });
    el('div.op-subt', { text: c.subtitle || '', parent: node });
    const bot = el('div.op-bot', { parent: node });
    el('div.op-diff', { parent: bot, html: waves(c.difficulty || 1) });
    const med = c.medals || {};
    el('div.op-medals', {
      parent: bot,
      html: medalRing('bronze', med.bronze, 20) + medalRing('silver', med.silver, 20) + medalRing('gold', med.gold, 20) + (med.cross ? medalRing('cross', true, 20) : ''),
    });
    el('div.op-best', { parent: bot, text: c.best ? `лучший ${num0(c.best)}` : c.par ? `пар ${mmss(c.par)}` : '' });
    if (c.locked) {
      const lk = el('div.op-lock', { parent: node });
      lk.innerHTML = `${LOCK}<span>${esc(c.lockText || 'Закрыта')}</span>`;
    }
    if (c.star) el('div.op-star', { parent: node, html: STAR });
    void total;
    return node;
  }

  _cards() {
    const mis = this.ctx.mission || {};
    if (typeof mis.cards === 'function') {
      try {
        return mis.cards();
      } catch (err) {
        console.error('[hud] mission.cards() failed', err);
      }
    }
    return (mis.list || []).map((d, i) => ({ index: i, number: String(i + 1).padStart(2, '0'), title: d.title || `Операция ${i + 1}`, subtitle: d.subtitle || '', presets: d.presets || [d.weather?.start || 'calm'], difficulty: d.difficulty || 1, medals: {}, best: 0, locked: false }));
  }

  show(opts = {}) {
    super.show(opts);
    if (!this._bgDone) this._drawBg();
    const cards = this._cards();
    this.grid.innerHTML = '';
    const items = [];
    for (const c of cards) {
      const node = this._card(c, cards.length);
      this.grid.appendChild(node);
      items.push({
        el: node,
        disabled: !!c.locked && !this.ctx.debug,
        card: c,
        onActivate: () => this.hud.emit('ui:select-mission', { index: c.index }),
        onDisabled: () => this._shakeLocked(c.index),
      });
    }
    const keep = opts.returning;
    this.menu.setItems(items, keep);
    if (!keep) {
      // focus the operation to continue
      const ci = this.ctx.mission?.continueIndex;
      const k = items.findIndex((it) => it.card.index === ci);
      this.menu.focus(k >= 0 ? k : 0, true);
    }
    const r = this.ctx.mission?.career;
    this.sub.textContent = r ? `Студёное море · ${r.rank || 'Стажёр'} · кругов ${r.rings ?? 0} из 24` : 'Студёное море';
    this.note.innerHTML = '<kbd class="cap">←</kbd><kbd class="cap">→</kbd><kbd class="cap">↑</kbd><kbd class="cap">↓</kbd> выбор&nbsp;&nbsp;<kbd class="cap wide">Enter</kbd> брифинг&nbsp;&nbsp;<kbd class="cap wide">Esc</kbd> назад';
  }

  _shakeLocked(index) {
    const it = this.menu.items.find((x) => x.card?.index === index);
    if (!it) return;
    it.el.classList.remove('shake');
    void it.el.offsetWidth;
    it.el.classList.add('shake');
    this.hud.emit('ui:back', { menu: 'operations', locked: true });
  }

  resize() {
    if (this._bgDone) this._bgDone = false;
    if (this.visible) this._drawBg();
  }
}
