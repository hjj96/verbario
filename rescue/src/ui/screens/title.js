// ТИТУЛ (DESIGN §7.2) over the live attract scene: letterbox (post draws the 6vh bars), heavy vignette,
// orange rule 64×3, «MAYDAY» wordmark, «МОРСКАЯ СПАСАТЕЛЬНАЯ СЛУЖБА», the menu (hover/focus shifts the
// item 8 px, orange tick, ui:hover), the meteo telex from weather.state (top right), career line and rank.
// Starting fades the menu out in 240 ms before the ui:* event goes to the mission system.
import { el, TextSlot } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { Typewriter } from '../common/typewriter.js';
import { NBSP, num0, deg3, clockOf, beaufortOf, douglasOf, visU, windFromDeg, plural, ballsU } from '../common/fmt.js';
import { Screen } from './screen.js';

export class TitleScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-title');
    el('div.title-vignette', { parent: this.node });
    const left = el('div.title-left', { parent: this.node });
    el('div.title-rule', { parent: left });
    el('h1.title-word', { text: 'MAYDAY', parent: left });
    el('div.title-sub', { text: 'МОРСКАЯ СПАСАТЕЛЬНАЯ СЛУЖБА', parent: left });
    this.menuEl = el('div.title-menu', { parent: left, attrs: { role: 'menu' } });

    this.telexEl = el('div.title-telex', { parent: this.node });
    el('span.telex-tag', { text: 'МЕТЕО · БЕРЕГ', parent: this.telexEl });
    this.telexText = el('span.telex-text', { parent: this.telexEl });
    this.telexGhost = el('span.telex-ghost', { parent: this.telexEl }); // untyped remainder keeps the line still
    this.tw = new Typewriter(this.telexText, { msPerChar: 14, cursor: true });
    this._telexFull = '';

    const foot = el('div.title-foot', { parent: this.node });
    this.career = new TextSlot(el('div.title-career', { parent: foot }));
    this.rank = new TextSlot(el('div.title-rank', { parent: foot }));
    el('div.title-keys', { parent: this.node, html: '<kbd class="cap">↑</kbd><kbd class="cap">↓</kbd> выбор&nbsp;&nbsp;<kbd class="cap wide">Enter</kbd> подтвердить' });

    this.menu = new Menu(hud, { name: 'title' });
    this._telexT = 0;
    this._telexPreset = null;
    this._leaving = 0;
  }

  _item(label, sub, fn) {
    const it = el('div.title-item', { parent: this.menuEl, attrs: { role: 'menuitem' } });
    el('span.ti-label', { text: label, parent: it });
    if (sub) el('span.ti-sub', { text: sub, parent: it });
    return { el: it, onActivate: fn };
  }

  _build() {
    this.menuEl.innerHTML = '';
    const mis = this.ctx.mission || {};
    const items = [];
    const ops = Array.isArray(mis.list) ? mis.list : [];
    const total = mis.campaignCount || ops.filter((d) => !d.star).length || 0;
    if (mis.hasProgress && ops.length) {
      const i = Number.isFinite(mis.continueIndex) ? mis.continueIndex : 0;
      const d = ops[i];
      items.push(this._item('ПРОДОЛЖИТЬ', d ? `${d.number || String(i + 1).padStart(2, '0')} · ${d.title}` : '', () => this._start('ui:start', { index: i })));
    }
    items.push(this._item('ОПЕРАЦИИ', total ? `${total} ${plural(total, 'операция', 'операции', 'операций')}` : '', () => this.hud.go('operations')));
    const hs = typeof mis.highscores === 'object' && Array.isArray(mis.highscores) ? mis.highscores : [];
    items.push(this._item('СМЕНА', hs.length ? `рекорд ${num0(hs[0].score)}` : 'бесконечное дежурство', () => this._start('ui:endless', {})));
    items.push(this._item('НАСТРОЙКИ', '', () => this.hud.go('settings')));
    items.push(this._item('УПРАВЛЕНИЕ', '', () => this.hud.go('controls')));
    this.menu.setItems(items);

    const c = mis.career || null;
    if (c) {
      this.career.set(`Спасено за карьеру: ${num0(c.rescued || 0)}`);
      const next = c.nextRank ? ` · до «${c.nextRank.replace(/[«»]/g, '')}» — ${c.ringsToNext} ${plural(c.ringsToNext, 'круг', 'круга', 'кругов')}` : '';
      this.rank.set(`Звание: ${c.rank || 'Стажёр'}${next}`);
    } else {
      this.career.set('Спасено за карьеру: 0');
      this.rank.set('Звание: Стажёр');
    }
  }

  _start(event, payload) {
    if (this._leaving > 0) return;
    this._leaving = 0.24;
    this.blockInput = true;
    this.node.classList.add('leaving');
    this._pending = () => this.hud.emit(event, payload);
  }

  show(opts = {}) {
    super.show(opts);
    this._build();
    this.node.classList.remove('leaving');
    this.blockInput = false;
    this._leaving = 0;
    this._telexT = 1;
    this._telexPreset = null;
    this.node.classList.toggle('intro', !!opts.intro);
  }

  _telex() {
    const ws = this.ctx.weather?.state;
    if (!ws) return;
    const from = Number.isFinite(ws.windFrom) ? ws.windFrom : ws.windDir ? windFromDeg(ws.windDir.x, ws.windDir.y) : 0;
    const ms = ws.windSpeed || 0;
    const b = Number.isFinite(ws.beaufort) ? ws.beaufort : beaufortOf(ms);
    const sea = Number.isFinite(ws.seaState) ? ws.seaState : douglasOf(ws.waveHeight || 0);
    const tr = ws.pressureTrend < 0 ? ' ↓' : ws.pressureTrend > 0 ? ' ↑' : '';
    const text = `${clockOf(ws.timeOfDay)} · ВЕТЕР ${deg3(from)} ${num0(ms)}${NBSP}М/С · ${ballsU(b)} · ВОЛНЕНИЕ ${sea} · ВИДИМОСТЬ ${visU(ws.visibility)} · ${num0(ws.pressure || 1016)}${NBSP}гПа${tr}`;
    if (ws.preset !== this._telexPreset) {
      this._telexPreset = ws.preset;
      this._telexFull = text;
      this.tw.start(text);
    } else if (this.tw.done && text !== this._telexFull) {
      this._telexFull = text;
      this.telexText.textContent = text;
    }
  }

  update(dt, top) {
    if (!this.visible) return;
    this.tw.update(dt);
    const rest = this.tw.done ? '' : this._telexFull.slice(this.tw.shown);
    if (rest !== this._ghost) {
      this._ghost = rest;
      this.telexGhost.textContent = rest;
    }
    this._telexT += dt;
    if (this._telexT >= 1) {
      this._telexT = 0;
      this._telex();
    }
    if (this._leaving > 0) {
      this._leaving -= dt;
      if (this._leaving <= 0 && this._pending) {
        const p = this._pending;
        this._pending = null;
        p();
        // if the mission did not react (stub), give the menu back
        setTimeout(() => {
          if (this.visible && this.hud.screen === 'title') {
            this.node.classList.remove('leaving');
            this.blockInput = false;
          }
        }, 600);
      }
    }
    void top;
  }
}
