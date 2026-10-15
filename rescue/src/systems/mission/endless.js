// «СМЕНА» — endless shift (DESIGN §3.14): a new call every 70 s, shrinking to 35 s by minute 12;
// 600–1500 m from the nearest pad, search area 150–300 m, at most 5 active. Each call is announced by
// the dispatcher (d_call) with type, square and head-count, and spawned through survivors.spawn().
import { createRng } from '../../core/math.js';
import { makePeople } from './manifest.js';
import { squareOf, groupWords, peopleWords } from './text.js';

const MAX_ACTIVE = 5;

export class Shift {
  constructor(mission) {
    this.m = mission;
    this.ctx = mission.ctx;
    this.calls = []; // [{ id, n, tag, type, x, z, count, square, what, t, s, entry, done, outcome }]
    this.activeCount = 0;
    this.closed = 0;
    this.next = 0;
  }

  reset(def) {
    this.def = def;
    this.rng = createRng(((def.seed >>> 0) ^ 0x5eed) + 1);
    this.calls.length = 0;
    this.activeCount = 0;
    this.closed = 0;
    this.n = 0;
    this.next = 5; // first call a few seconds into the shift
    this.used = new Set();
  }

  // Seconds between calls at shift time t.
  interval(t) {
    const k = Math.min(1, Math.max(0, t / 720));
    return 70 + (35 - 70) * k;
  }

  update(dt, t) {
    let active = 0;
    for (const c of this.calls) {
      if (c.done) continue;
      if (!c.s) c.s = this._lookup(c.tag); // survivors.spawn() returned nothing: find the group by tag
      const st = c.s && c.s.state;
      if (st === 'rescued' || st === 'lost') {
        c.done = true;
        c.outcome = st;
        this.closed++;
        continue;
      }
      active++;
    }
    this.activeCount = active;
    if (t < this.next) return;
    if (active >= MAX_ACTIVE) {
      this.next = t + 8; // the board is full — try again shortly
      return;
    }
    this.spawn(t);
    this.next = t + this.interval(t) * (0.85 + 0.3 * this.rng.next());
  }

  _lookup(tag) {
    const list = this.ctx.survivors?.list;
    if (list) for (const s of list) if (s && this.m.ledger.tag(s) === tag) return s;
    return null;
  }

  _pads() {
    const pads = this.ctx.world?.pads;
    if (pads && pads.length) return pads.map((p) => ({ x: p.position.x, z: p.position.z }));
    return (this.def.world.pads || []).map((p) => ({ x: p.x, z: p.z }));
  }

  _pickType(t) {
    const w = this.ctx.weather?.state;
    const preset = w?.preset || 'calm';
    const rough = preset === 'storm' || preset === 'nightStorm' || preset === 'squall';
    const table = [
      ['swimmer', 3],
      ['raft', 2.5],
      ['hull', 1.6],
      ['container', rough ? 2 : 0.8],
      ['injured', t > 180 ? 1.1 : 0],
    ];
    let sum = 0;
    for (const e of table) sum += e[1];
    let r = this.rng.next() * sum;
    for (const e of table) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return 'swimmer';
  }

  spawn(t) {
    const rng = this.rng;
    const pads = this._pads();
    const R = (this.def.area?.radius || 2400) - 120;
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 40; tries++) {
      const p = pads.length ? pads[Math.floor(rng.next() * pads.length)] : { x: 0, z: 0 };
      const a = rng.next() * Math.PI * 2;
      const d = 650 + rng.next() * 800;
      x = p.x + Math.cos(a) * d;
      z = p.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > R) continue;
      let near = Infinity;
      for (const q of pads) near = Math.min(near, Math.hypot(q.x - x, q.z - z));
      if (near < 600 || near > 1500) continue;
      let clash = false;
      for (const c of this.calls) if (!c.done && Math.hypot(c.x - x, c.z - z) < 300) clash = true;
      if (!clash) break;
    }

    const type = this._pickType(t);
    const w = this.ctx.weather?.state;
    const night = (w?.night || 0) > 0.5;
    const sunny = w && (w.preset === 'calm' || w.preset === 'clearing');
    let count = 1;
    let theme = 'generic';
    let pet = null;
    const signals = {};
    switch (type) {
      case 'raft':
        count = rng.int(3, 6);
        theme = rng.pick(['fishing', 'ferry', 'cargo', 'regatta']);
        signals.rockets = 2;
        signals.epirb = rng.chance(0.5);
        if (night) signals.strobe = true;
        // now and then a fishing crew took the boat's dog into the raft (DESIGN §4: «Четыре лапы»)
        if (rng.chance(theme === 'fishing' ? 0.5 : 0.06)) pet = 'dog';
        break;
      case 'hull':
        count = rng.int(2, 4);
        theme = 'fishing';
        signals.rockets = rng.chance(0.5) ? 1 : 0;
        signals.epirb = rng.chance(0.3);
        break;
      case 'container':
        count = rng.int(1, 3);
        theme = 'cargo';
        signals.strobe = night || rng.chance(0.4);
        break;
      case 'injured':
        signals.whistle = true;
        break;
      default:
        signals.whistle = true;
        if (night) signals.strobe = rng.chance(0.8);
        else {
          signals.smoke = rng.chance(0.5);
          signals.dye = rng.chance(0.3);
        }
        if (sunny) signals.mirror = rng.chance(0.35);
    }

    this.n++;
    const radius = Math.round(150 + rng.next() * 150);
    const ang = rng.next() * Math.PI * 2;
    const off = rng.next() * 0.35 * radius;
    const entry = {
      tag: `call-${this.n}`,
      type,
      x: Math.round(x),
      z: Math.round(z),
      count,
      at: 0,
      hidden: true,
      datumRadius: radius,
      datum: { x: Math.round(x + Math.cos(ang) * off), z: Math.round(z + Math.sin(ang) * off) },
      signals,
      since: rng.int(5, 40),
      label: groupWords(type).nom,
      people: makePeople(rng, theme, count, { used: this.used }),
      call: this.n,
    };
    if (pet) entry.pet = pet;
    let s = null;
    try {
      s = this.ctx.survivors?.spawn?.(entry) || null;
    } catch (err) {
      console.error('[mission] survivors.spawn failed', err);
    }
    this.m._registerCallGroup(entry, s);

    const what = groupWords(type).nom;
    const square = squareOf(entry.datum.x, entry.datum.z);
    const call = { id: entry.tag, n: this.n, tag: entry.tag, type, x: entry.datum.x, z: entry.datum.z, radius, count, square, what, t, s, entry, done: false, outcome: null };
    this.calls.push(call);
    this.ctx.radio?.say?.('dispatch', `Чайка, Берег. Новый вызов: ${what}, квадрат ${square}, ${peopleWords(count)}.`, {
      priority: 2,
      name: 'БЕРЕГ',
      channel: 'ext',
      id: `d_call-${this.n}`,
    });
    this.ctx.events.emit('mission:call', { call });
    return call;
  }
}
