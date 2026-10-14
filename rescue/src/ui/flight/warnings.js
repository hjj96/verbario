// Central warnings (DESIGN §7.3.11): at 22vh, Oswald 600 26 px 0.22em in ⟦ ⟧ with an Inter 14 second
// line. «Опасно» — inverted red plate with hatching that blinks at 2 Hz for the first 1.5 s; «внимание» —
// amber outline without hatching. With «Меньше вспышек» / «Меньше движения» the blink becomes a 0.5 Hz
// breathing frame. Only ONE warning at a time, by priority. Event-driven ones (hazard:warning) have a
// TTL; conditions are polled at 10 Hz. A persistent condition shows for 5 s at onset, then 3 s every 20 s.
import { el, TextSlot, setClass } from '../common/dom.js';
import { NBSP, distU } from '../common/fmt.js';

const POLL = 0.1;

// id → { prio, level }
const DEFS = {
  rogue: { prio: 10, level: 'danger' },
  hull: { prio: 9, level: 'danger' },
  spout: { prio: 8, level: 'danger' },
  tornado: { prio: 8, level: 'danger' },
  low: { prio: 7, level: 'danger' },
  obstacle: { prio: 7, level: 'danger' },
  tension: { prio: 6, level: 'caution' },
  storm: { prio: 6, level: 'caution' },
  hazard: { prio: 5, level: 'caution' },
  fuel: { prio: 5, level: 'caution' },
  overheat: { prio: 4, level: 'caution' },
  turbulence: { prio: 3, level: 'caution' },
  outside: { prio: 2, level: 'caution' },
};

export class Warnings {
  constructor(hud, parent) {
    this.hud = hud;
    this.ctx = hud.ctx;
    this.node = el('div.hud-warn', { parent, attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const plate = el('div.warn-plate', { parent: this.node });
    this.title = new TextSlot(el('div.warn-title', { parent: plate }));
    this.detail = new TextSlot(el('div.warn-detail', { parent: this.node }));
    this.state = {}; // id → { active, since, ttl, text, detail, level, hazard }
    for (const id of Object.keys(DEFS)) this.state[id] = { active: false, since: 0, ttl: 0, text: '', detail: '', level: DEFS[id].level, hazard: null, persistent: true };
    this.current = null;
    this.shownT = 0;
    this._poll = 0;
    this.time = 0;
  }

  // Event-driven warning (hazards). ttl seconds.
  raise(id, text, detail, opts = {}) {
    const s = this.state[id] || (this.state[id] = { active: false, since: 0, ttl: 0, level: 'caution', persistent: false });
    if (!s.active) s.since = this.time;
    s.active = true;
    s.persistent = false;
    s.ttl = opts.ttl ?? 4;
    s.text = text;
    s.detail = detail || '';
    s.level = opts.level || DEFS[id]?.level || 'caution';
    s.hazard = opts.hazard || null;
  }

  onHazardWarning(p) {
    if (!p) return;
    const type = p.type;
    const raw = String(p.text || '');
    const parts = raw.split(' · ');
    let title = parts[0] || raw;
    let rest = parts.slice(1).join(' · ');
    if (type === 'rogue') {
      if (p.stage === 'radio' || p.stage === 'suction') this.raise('hazard', 'ВОЛНА!', p.detail || (p.stage === 'suction' ? 'ОТСОС' : ''), { level: 'caution', ttl: 3.5 });
      else this.raise('rogue', 'ВОЛНА-УБИЙЦА', '', { level: 'danger', ttl: Math.max(2, (p.eta || 6) + 1.5), hazard: p.hazard || null, from: p.detail || p.from });
      if (this.state.rogue.active) {
        this.state.rogue.from = (p.detail || p.from || '').toString().toUpperCase();
        this.state.rogue.heightM = p.height || p.hazard?.height || 14;
      }
      return;
    }
    if (type === 'waterspout' || type === 'tornado') {
      const id = type === 'tornado' ? 'tornado' : 'spout';
      title = type === 'tornado' ? 'ТОРНАДО' : 'СМЕРЧ';
      this.raise(id, title, p.detail || (type === 'tornado' ? 'уходите на форсаже' : 'ближе трёхсот метров не подходить'), { level: p.level === 'caution' ? 'caution' : 'danger', ttl: 5, hazard: p.hazard || null });
      return;
    }
    if (type === 'lightning' || type === 'charge') {
      this.raise('storm', 'ГРОЗА РЯДОМ', p.detail || 'УХОДИТЕ ИЗ ЗОНЫ ЗАРЯДА', { level: 'caution', ttl: 3 });
      return;
    }
    this.raise('hazard', title || 'ОПАСНОСТЬ', rest || p.detail || '', { level: p.level === 'danger' ? 'danger' : 'caution', ttl: 4 });
  }

  _cond(id, on, text, detail, level) {
    const s = this.state[id];
    if (on && !s.active) {
      s.active = true;
      s.since = this.time;
    } else if (!on && s.active && s.persistent) s.active = false;
    if (on) {
      s.persistent = true;
      s.text = text;
      s.detail = detail;
      if (level) s.level = level;
    }
  }

  // Persistent conditions only show in windows: 5 s at onset, then 3 s every 20 s.
  _visible(s) {
    if (!s.active) return false;
    if (!s.persistent) return true;
    const a = this.time - s.since;
    if (a < 5) return true;
    return (a - 5) % 20 > 17;
  }

  _pollConditions() {
    const ctx = this.ctx;
    const h = ctx.heli;
    if (!h?.position) return;
    const m = this.hud.flight.model;
    const alt = m.alt;
    const nearPad = m.home && m.homeDist < 45;
    this._cond('low', alt < 6 && m.vy < -0.5 && !h.landed && !nearPad && h.alive !== false, 'МАЛАЯ ВЫСОТА', alt < 2 ? 'ВВЕРХ!' : `${Math.max(0, Math.round(alt))}${NBSP}М`, 'danger');
    const hull = h.hull ?? 1;
    this._cond('hull', hull < 0.25 && h.alive !== false, 'КОРПУС · КРИТИЧЕСКОЕ', `${Math.round(hull * 100)}${NBSP}% · ремонт только на маяке`, 'danger');
    const fuel = h.fuel ?? 1;
    const bingo = Number.isFinite(h.bingo) ? h.bingo : 0.1;
    this._cond('fuel', !h.landed && (fuel <= bingo || fuel < 0.1), 'ТОПЛИВО · ВОЗВРАТ НА БАЗУ', `${Math.round(fuel * 100)}${NBSP}% · ${h.bingoPad?.name ? `до «${String(h.bingoPad.name).replace(/[«»]/g, '')}»` : 'на ближайшую площадку'}`, fuel < 0.1 ? 'danger' : 'caution');
    const w = h.winch;
    this._cond('tension', !!w && ((w.tension || 0) > 0.05), 'НАТЯЖЕНИЕ ТРОСА', 'сбавьте скорость — трос выберется сам', 'caution');
    this._cond('overheat', (h.overheat || 0) > 0, 'ПЕРЕГРЕВ', `форсаж недоступен · ${Math.ceil(h.overheat)}${NBSP}с`, 'caution');
    // obstacles within 40 m (horizontal) and below their top + 10 m
    let obst = null;
    let od = Infinity;
    const obs = ctx.world?.obstacles;
    if (obs) for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const d = Math.hypot(o.x - m.hx, o.z - m.hz) - (o.radius || 0);
      if (d < 40 && m.hy < (o.top || 0) + 10 && d < od) {
        od = d;
        obst = o;
      }
    }
    this._cond('obstacle', !!obst && !h.landed, 'ПРЕПЯТСТВИЕ', obst ? `${obst.name || 'препятствие'} · ${distU(Math.max(0, od))}` : '', 'danger');
    // lee turbulence behind the rig / strong turbulence aloft
    const ws = ctx.weather?.state;
    let turb = false;
    const pads = ctx.world?.pads;
    if (pads && ws?.windDir) for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p?.lee || !p.position) continue;
      const dx = m.hx - p.position.x;
      const dz = m.hz - p.position.z;
      const along = dx * ws.windDir.x + dz * ws.windDir.y;
      const lat = Math.abs(-dx * ws.windDir.y + dz * ws.windDir.x);
      if (along > 10 && along < 150 && lat < 20 + along * 0.4) turb = true;
    }
    if (ws && (ws.turbulence || 0) > 3.2 && alt > 70) turb = true;
    this._cond('turbulence', turb && !h.landed, 'ТУРБУЛЕНТНОСТЬ', 'держите скорость, уходите из следа', 'caution');
    // out of the search area
    const R = ctx.mission?.def?.area?.radius;
    const out = Number.isFinite(R) && Math.hypot(m.hx, m.hz) > R && ctx.mission?.def && !ctx.mission.def.attract;
    this._cond('outside', !!out, 'ВНЕ ЗОНЫ ПОИСКА', 'топливо расходуется быстрее', 'caution');
    // St. Elmo / charge around the heli
    if ((ws?.stElmo || 0) > 0.35) this.raise('storm', 'ГРОЗА РЯДОМ', 'огни на лопастях — уходите', { level: 'caution', ttl: 1.5 });
  }

  update(dt) {
    this.time += dt;
    this._poll += dt;
    if (this._poll >= POLL) {
      this._poll = 0;
      this._pollConditions();
      // TTL of event warnings
      for (const id of Object.keys(this.state)) {
        const s = this.state[id];
        if (s.active && !s.persistent) {
          s.ttl -= POLL;
          if (s.ttl <= 0) s.active = false;
        }
      }
    }
    // choose the visible one by priority
    let best = null;
    let bp = -1;
    for (const id of Object.keys(this.state)) {
      const s = this.state[id];
      if (!this._visible(s)) continue;
      const p = DEFS[id]?.prio ?? 1;
      if (p > bp) {
        bp = p;
        best = id;
      }
    }
    if (best !== this.current) {
      this.current = best;
      this.shownT = 0;
      setClass(this.node, 'on', !!best);
      if (best) {
        const s = this.state[best];
        const reduce = this.ctx.settings?.get('reduceFlashes') || this.ctx.settings?.get('reduceMotion');
        setClass(this.node, 'danger', s.level === 'danger');
        setClass(this.node, 'caution', s.level !== 'danger');
        setClass(this.node, 'breathe', !!reduce);
        setClass(this.node, 'blink', !reduce && s.level === 'danger');
        this.node.classList.remove('pop');
        void this.node.offsetWidth;
        this.node.classList.add('pop');
      }
    }
    if (!best) return;
    this.shownT += dt;
    if (this.shownT > 1.5) setClass(this.node, 'blink', false);
    const s = this.state[best];
    let title = s.text;
    let detail = s.detail;
    if (best === 'rogue') {
      const hz = s.hazard;
      const eta = hz && Number.isFinite(hz.eta) ? hz.eta : s.ttl - 1.5;
      detail = `${Math.round(hz?.height || s.heightM || 14)}${NBSP}М${s.from ? ` · ${s.from}` : ''} · ${Math.max(0, Math.ceil(eta))}${NBSP}С`;
    } else if ((best === 'spout' || best === 'tornado') && s.hazard?.position) {
      // «СМЕРЧ · 600 М» with the live distance
      const m = this.hud.flight.model;
      title = `${s.text} · ${distU(Math.hypot(s.hazard.position.x - m.hx, s.hazard.position.z - m.hz))}`;
    }
    this.title.set(`⟦${NBSP}${title}${NBSP}⟧`);
    this.detail.set(detail || '');
  }

  clear() {
    for (const id of Object.keys(this.state)) this.state[id].active = false;
    this.current = null;
    setClass(this.node, 'on', false);
  }
}
