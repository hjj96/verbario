// In-flight DOM text panels (DESIGN §7.3): documentary frame (● REC + timecode, «КАМ-2 · БПЛА СОПРОВ.»),
// meteo block, mission strip + current task, radar-altimeter readout «РВ», bottom bar (speed, heading,
// fuel 20 segments + BINGO tick + endurance, hull 10 segments, engine temp, mode icons, cabin seats),
// key hints for input.lastDevice, chapter caption and «золотой час». Written at 12 Hz and only when a
// string/class actually changes (TextSlot / HtmlSlot / setClass).
import { el, TextSlot, HtmlSlot, setClass, StyleSlot } from '../common/dom.js';
import { NBSP, num0, num1, mmss, mss, timecode, deg3, visU, ballsU, beaufortOf, windFromDeg, PRESET_SHORT, clamp01 } from '../common/fmt.js';
import { keycap } from '../common/icons.js';

const KEYS = {
  keyboard: [['Пробел', 'лебёдка'], ['L', 'прожектор'], ['G', 'фальшфейер'], ['H', 'рупор'], ['Tab', 'карта'], ['Esc', 'пауза']],
  gamepad: [['A', 'лебёдка'], ['X', 'прожектор'], ['B', 'фальшфейер'], ['Y', 'рупор'], ['View', 'карта'], ['Start', 'пауза']],
  touch: [],
};

export class Panels {
  constructor(flight, parent) {
    this.flight = flight;
    this.hud = flight.hud;
    this.ctx = flight.hud.ctx;
    const P = parent;

    // --- documentary frame + meteo (top-left) ---------------------------------------------------
    this.tl = el('div.hud-tl', { parent: P });
    const rec = el('div.hud-rec', { parent: this.tl });
    el('i.rec-dot', { parent: rec });
    el('span.rec-label', { text: 'REC', parent: rec });
    this.tc = new TextSlot(el('span.rec-tc', { parent: rec }));
    el('span.rec-cam', { text: `·${NBSP}КАМ-2 · БПЛА СОПРОВ.`, parent: rec });
    this.met1 = new TextSlot(el('div.hud-met', { parent: this.tl }));
    this.met2 = new TextSlot(el('div.hud-met', { parent: this.tl }));
    const l3 = el('div.hud-met', { parent: this.tl });
    this.met3 = new TextSlot(el('span', { parent: l3 }));
    this.pillEl = el('span.hud-pill', { parent: l3 });
    this.pill = new TextSlot(this.pillEl);
    this.boltEl = el('div.hud-met.hud-bolt', { parent: this.tl });
    this.bolt = new TextSlot(this.boltEl);

    // --- mission strip (top centre, under the compass tape) -------------------------------------
    this.tcBox = el('div.hud-strip', { parent: P });
    this.strip = new TextSlot(el('div.strip-main', { parent: this.tcBox }));
    this.taskEl = el('div.strip-task', { parent: this.tcBox });
    this.task = new TextSlot(this.taskEl);
    this.goldEl = el('div.strip-gold', { parent: this.tcBox });
    this.gold = new TextSlot(this.goldEl);

    // --- chapter caption («ГЛАВА 2 · ШКВАЛ») ------------------------------------------------------
    this.chapterEl = el('div.hud-chapter', { parent: P });
    this.chapterT = -1;

    // --- radar altimeter readout (left; the scale itself is on the overlay canvas) ----------------
    this.altBox = el('div.hud-alt', { parent: P });
    el('div.alt-lab', { text: 'РВ', parent: this.altBox });
    this.altVal = new HtmlSlot(el('div.alt-val', { parent: this.altBox }));
    this.altVsEl = el('div.alt-vs', { parent: this.altBox });
    this.altVs = new TextSlot(this.altVsEl);
    this.altLowEl = el('div.alt-low', { text: 'МАЛАЯ ВЫСОТА', parent: this.altBox });
    this.altCeilEl = el('div.alt-ceil', { text: 'ПОТОЛОК', parent: this.altBox });

    // --- bottom bar --------------------------------------------------------------------------------
    this.bar = el('div.hud-bottom', { parent: P });
    const cell = (cls, label) => {
      const c = el(`div.hb-cell.${cls}`, { parent: this.bar });
      if (label) el('b', { text: label, parent: c });
      return c;
    };
    const spd = cell('hb-spd', 'СКОР');
    this.spd = new TextSlot(el('span.v', { parent: spd }));
    el('i', { text: 'КМ/Ч', parent: spd });
    const hdg = cell('hb-hdg', 'КУРС');
    this.hdg = new TextSlot(el('span.v', { parent: hdg }));

    const fuel = cell('hb-fuel', 'ТОПЛ');
    this.fuelCell = fuel;
    const fseg = el('span.segs.segs-20', { parent: fuel });
    this.fuelSegs = [];
    for (let i = 0; i < 20; i++) this.fuelSegs.push(el('i', { parent: fseg }));
    this.bingoEl = el('span.bingo', { parent: fseg, html: '<em>H</em>' });
    this.bingoX = new StyleSlot(this.bingoEl, 'left');
    this.fuelT = new TextSlot(el('span.v.small', { parent: fuel }));
    this.bingoTxt = el('span.bingo-txt', { text: 'БИНГО', parent: fuel });

    const hull = cell('hb-hull', 'КОРПУС');
    this.hullCell = hull;
    const hseg = el('span.segs.segs-10', { parent: hull });
    this.hullSegs = [];
    for (let i = 0; i < 10; i++) this.hullSegs.push(el('i', { parent: hseg }));
    this.hullV = new TextSlot(el('span.v.small', { parent: hull }));

    const temp = cell('hb-temp', 'Т ДВИГ');
    this.tempCell = temp;
    const tb = el('span.tbar', { parent: temp });
    this.tempFill = new StyleSlot(el('i', { parent: tb }), 'transform');

    const modes = cell('hb-modes');
    this.modeLight = el('span.mode', { text: 'ПРОЖ', parent: modes });
    this.modeWinch = el('span.mode', { text: 'ЛЕБ', parent: modes });
    this.modeAuto = el('span.mode', { text: 'АВТО', parent: modes });
    this.modeBoost = el('span.mode', { text: 'ФОРС', parent: modes });
    this.cons = new TextSlot(el('span.cons', { parent: modes }));

    const cab = cell('hb-cabin', 'НА БОРТУ');
    this.seatsEl = el('span.seats', { parent: cab });
    this.seats = new HtmlSlot(this.seatsEl);
    this.cabV = new TextSlot(el('span.v.small', { parent: cab }));

    // key hints (above the bar, right)
    this.keysEl = el('div.hud-keys', { parent: P });
    this.keys = new HtmlSlot(this.keysEl);

    this._hullPrev = 10;
    this._hullBlink = new Array(10).fill(0);
    this._fuelN = -1;
    this._hullN = -1;
  }

  showChapter(title) {
    if (!title) return;
    this.chapterEl.textContent = title;
    this.chapterEl.classList.remove('on');
    void this.chapterEl.offsetWidth; // restart the CSS animation
    this.chapterEl.classList.add('on');
    this.chapterT = 4.2;
  }

  // dt = real seconds; called at 12 Hz by FlightHud
  update(dt) {
    const ctx = this.ctx;
    const m = this.flight.model;
    const h = ctx.heli || {};
    const ws = ctx.weather?.state || {};
    const mis = ctx.mission || {};

    // REC timecode
    this.tc.set(timecode(m.missionT));

    // meteo
    const wsSpeed = ws.windSpeed || 0;
    const from = Number.isFinite(ws.windFrom) ? ws.windFrom : ws.windDir ? windFromDeg(ws.windDir.x, ws.windDir.y) : 0;
    const gustPeak = Math.max(wsSpeed + (ws.gust || 0), ws.gustMax || 0);
    const bf = Number.isFinite(ws.beaufort) ? ws.beaufort : beaufortOf(wsSpeed);
    this.met1.set(`ВЕТЕР ${deg3(from)} ${num0(wsSpeed)}${NBSP}М/С${gustPeak > wsSpeed + 1.5 ? ` (ПОР ${num0(gustPeak)})` : ''} · ${ballsU(bf)}`);
    this.met2.set(`ВОЛНА ${num1(ws.waveHeight ?? ws.palette?.sea?.Hs ?? 0)}${NBSP}М · ВИДИМ ${visU(ws.visibility)}`);
    const tr = ws.pressureTrend < 0 ? '↓' : ws.pressureTrend > 0 ? '↑' : '→';
    this.met3.set(Number.isFinite(ws.pressure) ? `ДАВЛ ${Math.round(ws.pressure)}${NBSP}ГПА ${tr}` : '');
    let pill = '';
    try {
      const fc = ctx.weather?.forecast?.();
      const f = fc && fc[0];
      if (f && f.preset && f.preset !== ws.preset) pill = `${PRESET_SHORT[ws.preset] || ''} → ${f.short || PRESET_SHORT[f.preset] || f.preset} ${mss(f.in)}`;
    } catch {
      pill = '';
    }
    this.pill.set(pill);
    setClass(this.pillEl, 'on', !!pill);
    const lf = m.lastFlash;
    const boltOn = m.time - lf.t < 4 && lf.distance > 0;
    this.bolt.set(boltOn ? `⚡ ${visU(lf.distance)}` : '');
    setClass(this.boltEl, 'on', boltOn);

    // mission strip
    const st = mis.stats || {};
    let strip;
    if (mis.endless) strip = `СПАСЕНО ${st.rescued || 0} · ПОТЕРЯНО ${st.lost || 0}/10 · ВЫЗОВОВ ${mis.calls?.length ?? st.calls ?? 0} · ${mmss(m.missionT)}`;
    else {
      const total = st.total || mis.def?.total || 0;
      strip = `СПАСЕНО ${st.rescued || 0}/${total} · ПОТЕРЯНО ${st.lost || 0} · ${mis.timeLeft != null ? `ОСТАЛОСЬ ${mmss(mis.timeLeft)}` : mmss(m.missionT)}`;
    }
    this.strip.set(strip);
    this.task.set(mis.task || '');
    const gh = mis.goldenHour;
    this.gold.set(Number.isFinite(gh) ? `♥ ЗОЛОТОЙ ЧАС ${mss(gh)}` : '');
    setClass(this.goldEl, 'on', Number.isFinite(gh));
    setClass(this.goldEl, 'urgent', Number.isFinite(gh) && gh < 30);

    if (this.chapterT > 0) {
      this.chapterT -= dt;
      if (this.chapterT <= 0) this.chapterEl.classList.remove('on');
    }

    // radar altimeter readout «024» with the leading zero faint
    const alt = Math.max(0, Math.round(m.alt));
    const s3 = String(Math.min(999, alt)).padStart(3, '0');
    let lead = 0;
    while (lead < 2 && s3[lead] === '0') lead++;
    this.altVal.set(lead ? `<span class="lz">${s3.slice(0, lead)}</span>${s3.slice(lead)}` : s3);
    const vy = m.vy;
    const fast = vy < -4 && m.alt < 20;
    this.altVs.set(Math.abs(vy) < 0.15 ? '— 0,0' : `${vy < 0 ? '▼' : '▲'} ${num1(Math.abs(vy))}`);
    setClass(this.altVsEl, 'warn', fast);
    setClass(this.altLowEl, 'on', m.alt < 8 && !h.landed);
    setClass(this.altCeilEl, 'on', m.alt > 117);

    // bottom bar
    this.spd.set(String(Math.round(m.speed * 3.6)).padStart(3, '0'));
    this.hdg.set(deg3((m.heading * 180) / Math.PI));
    const fuel = clamp01(h.fuel ?? 1);
    const fn = Math.ceil(fuel * 20 - 1e-6);
    const fcls = fuel < 0.1 ? 'red' : fuel < 0.25 ? 'amber' : '';
    if (fn !== this._fuelN || fcls !== this._fuelCls) {
      this._fuelN = fn;
      this._fuelCls = fcls;
      for (let i = 0; i < 20; i++) setClass(this.fuelSegs[i], 'on', i < fn);
      setClass(this.fuelCell, 'amber', fcls === 'amber');
      setClass(this.fuelCell, 'red', fcls === 'red');
    }
    const bingo = Number.isFinite(h.bingo) ? clamp01(h.bingo) : null;
    if (bingo != null) this.bingoX.set(`${(bingo * 100).toFixed(1)}%`);
    setClass(this.bingoEl, 'on', bingo != null);
    const nearBingo = bingo != null && fuel <= bingo + 0.04 && !h.landed;
    setClass(this.fuelCell, 'near-bingo', nearBingo && fuel > bingo);
    setClass(this.fuelCell, 'below-bingo', bingo != null && fuel <= bingo && !h.landed);
    const burn = h.fuelBurn > 0 ? h.fuelBurn : 0.4; // %/s
    this.fuelT.set(`≈${mss((fuel * 100) / burn)}`);

    const hull = clamp01(h.hull ?? 1);
    const hn = Math.ceil(hull * 10 - 1e-6);
    if (hn !== this._hullN) {
      if (this._hullN > hn) for (let i = hn; i < this._hullN; i++) this._hullBlink[i] = 1.2; // lost ones blink ×3
      this._hullN = hn;
    }
    for (let i = 0; i < 10; i++) {
      if (this._hullBlink[i] > 0) this._hullBlink[i] -= dt;
      setClass(this.hullSegs[i], 'on', i < hn);
      setClass(this.hullSegs[i], 'lost', this._hullBlink[i] > 0);
    }
    setClass(this.hullCell, 'red', hull < 0.25);
    setClass(this.hullCell, 'amber', hull >= 0.25 && hull < 0.5);
    this.hullV.set(`${Math.round(hull * 100)}${NBSP}%`);

    const temp = clamp01((h.engineTemp ?? 0) / 100);
    this.tempFill.set(`scaleX(${temp.toFixed(3)})`);
    setClass(this.tempCell, 'hot', temp > 0.8 || (h.overheat || 0) > 0);

    setClass(this.modeLight, 'on', !!h.searchlight);
    setClass(this.modeWinch, 'on', !!h.winch && h.winch.state && h.winch.state !== 'stowed');
    const assist = ctx.settings?.get('assist');
    setClass(this.modeAuto, 'on', assist !== 'off' && !((h.emp || 0) > 0));
    this.modeAuto.title = assist === 'full' ? 'Стабилизация: полная' : assist === 'off' ? 'Стабилизация выключена' : 'Стабилизация: стандарт';
    setClass(this.modeBoost, 'on', !!(h.boost || h.boosting));
    this.cons.set(`ФАЛЬШ ${h.flares ?? 0} · ПЛОТ ${h.rafts ?? 0}`);

    // cabin seats ■■■□□□ with condition icons
    const cap = h.capacity || 6;
    const cabin = h.cabin || [];
    let html = '';
    let used = 0;
    for (let i = 0; i < cabin.length && used < cap; i++) {
      const p = cabin[i] || {};
      const cond = String(p.condition || '');
      const ic = p.stretcher || p.injured || /травм/.test(cond) ? '<em class="c-inj">+</em>' : /переохл/.test(cond) ? '<em class="c-cold">✱</em>' : '';
      const w = p.stretcher ? 2 : 1;
      html += `<i class="on${w === 2 ? ' str' : ''}">${ic}</i>`;
      used += w;
    }
    for (; used < cap; used++) html += '<i></i>';
    this.seats.set(html);
    const seatsUsed = Number.isFinite(h.seatsUsed) ? h.seatsUsed : cabin.length;
    this.cabV.set(`${seatsUsed}/${cap}`);

    // key hints for the current device
    const dev = ctx.input?.lastDevice || 'keyboard';
    if (dev !== this._dev) {
      this._dev = dev;
      const list = KEYS[dev] || KEYS.keyboard;
      this.keys.set(list.map(([k, t]) => `<span>${keycap(k)}${t}</span>`).join(''));
    }
  }
}
