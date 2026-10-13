// «Смена» weather escalation (DESIGN §3.13 [MUST]).
//
// * Intensity I(t) = min(1, t/900) + 0.08·sin(t/90), t = shift time in play.
// * Every 90–180 s the next preset is drawn with weight exp(−(sev − 4·I)²/1.5), current excluded.
//   Day (before 13:30): calm, overcast, fog, squall, storm, clearing. 13:30 → forced clearing (sunset),
//   15:00 → night; afterwards only nightStorm / nightCalm.
// * Relief: after ≥ 120 s at severity ≥ 3, 35 % chance of a lull (clearing by day, nightCalm by night).
// * Forecast is 80 % accurate: a planned front may «intensify en route» by one severity step.
// * The shift clock runs CLOCK_RATE× faster than real time (DESIGN gives no rate: 30× puts sunset at
//   ~9 min and night at ~12 min of a shift that starts at 09:00 — when calls come every 35 s).
import { SEVERITY } from './presets.js';

export const CLOCK_RATE = 30;
const DAY = ['calm', 'overcast', 'fog', 'squall', 'storm', 'clearing'];
const NIGHT = ['nightStorm', 'nightCalm'];
const SUNSET = 13.5 / 24;
const NIGHTFALL = 15 / 24;

export class Endless {
  constructor(rng) {
    this.rng = rng;
    this.active = false;
    this.t = 0;
    this.next = null; // { at, preset (announced), over }
    this.inPreset = 0;
    this.lullRolled = false;
    this.phase = 'day';
  }

  start(tod) {
    this.active = true;
    this.t = 0;
    this.inPreset = 0;
    this.lullRolled = false;
    this.phase = tod >= NIGHTFALL || tod < 0.2 ? 'night' : tod >= SUNSET ? 'sunset' : 'day';
    this.next = null;
    this.nightPick = this._pick(NIGHT, null);
  }

  stop() {
    this.active = false;
    this.next = null;
  }

  intensity() {
    return Math.min(1, this.t / 900) + 0.08 * Math.sin(this.t / 90);
  }

  _pick(set, exclude) {
    const I = this.intensity();
    let total = 0;
    const w = [];
    for (const name of set) {
      const v = name === exclude ? 0 : Math.exp(-((SEVERITY[name] - 4 * I) ** 2) / 1.5);
      w.push(v);
      total += v;
    }
    let r = this.rng.next() * total;
    for (let i = 0; i < set.length; i++) {
      r -= w[i];
      if (r <= 0 && w[i] > 0) return set[i];
    }
    return set.find((s) => s !== exclude) || set[0];
  }

  _plan(current, delay) {
    const set = this.phase === 'night' ? NIGHT : DAY;
    this.next = { at: this.t + delay, preset: this._pick(set, current), over: 30 + this.rng.next() * 25 };
  }

  // Seconds of shift time until the shift clock reaches `tod`.
  _until(clockTod, tod) {
    return ((tod - clockTod) * 86400) / CLOCK_RATE;
  }

  // Advance; returns {to, over} when a transition must start now, else null.
  // `w` = the Weather instance (current preset, clock, rng shared).
  update(dt, w) {
    if (!this.active) return null;
    this.t += dt;
    this.inPreset += dt;
    const cur = w.state.preset;
    const tod = w.state.timeOfDay;

    // Clock-driven phases.
    if (this.phase === 'day' && tod >= SUNSET) {
      this.phase = 'sunset';
      this.next = null;
      this.nightPick = this._pick(NIGHT, null);
      return this._go('clearing', 60);
    }
    if (this.phase === 'sunset' && tod >= NIGHTFALL) {
      this.phase = 'night';
      this.next = null;
      return this._go(this.nightPick || 'nightCalm', 60);
    }
    if (this.phase === 'sunset') return null;

    // Relief roll once per heavy spell.
    if (!this.lullRolled && SEVERITY[cur] >= 3 && this.inPreset >= 120) {
      this.lullRolled = true;
      if (this.rng.next() < 0.35) {
        this.next = { at: this.t + 15, preset: this.phase === 'night' ? 'nightCalm' : 'clearing', over: 40, lull: true };
      }
    }

    if (!this.next) this._plan(cur, 90 + this.rng.next() * 90);
    if (this.t < this.next.at) return null;

    // 80 % accurate forecast: 20 % the front intensifies by one step on the way.
    let to = this.next.preset;
    if (!this.next.lull && this.rng.next() < 0.2) {
      const set = this.phase === 'night' ? NIGHT : DAY;
      const worse = set.filter((s) => SEVERITY[s] === SEVERITY[to] + 1 && s !== cur);
      if (worse.length) to = worse[Math.floor(this.rng.next() * worse.length)];
    }
    const over = this.next.over;
    this.next = null;
    return this._go(to, over);
  }

  _go(to, over) {
    this.inPreset = 0;
    this.lullRolled = false;
    return { to, over };
  }

  // Forecast for the HUD/radio: calls fn(inSeconds, preset) for each announced change, soonest first
  // (announced = possibly inaccurate). No allocation.
  forEachUpcoming(w, fn) {
    if (!this.active) return;
    const tod = w.state.timeOfDay;
    const nextIn = this.next ? Math.max(0, this.next.at - this.t) : Infinity;
    let clockIn = Infinity;
    let clockPreset = null;
    if (this.phase === 'day') {
      clockIn = Math.max(0, this._until(tod, SUNSET));
      clockPreset = 'clearing';
    } else if (this.phase === 'sunset') {
      clockIn = Math.max(0, this._until(tod, NIGHTFALL));
      clockPreset = this.nightPick || 'nightCalm';
    }
    if (nextIn <= clockIn) {
      if (this.next) fn(nextIn, this.next.preset);
      if (clockPreset && clockIn < Infinity) fn(clockIn, clockPreset);
    } else {
      fn(clockIn, clockPreset);
      // the planned change is cancelled by the clock (sunset / nightfall resets the plan)
    }
  }

  // Next planned change without allocating: fills `out` {in, preset}, returns false if none.
  // (The barometer starts falling 15 s before it.)
  upcoming(w, out) {
    if (!this.active) return false;
    const tod = w.state.timeOfDay;
    let best = Infinity;
    if (this.next) {
      best = this.next.at - this.t;
      out.preset = this.next.preset;
    }
    if (this.phase === 'day') {
      const s = this._until(tod, SUNSET);
      if (s < best) { best = s; out.preset = 'clearing'; }
    } else if (this.phase === 'sunset') {
      const s = this._until(tod, NIGHTFALL);
      if (s < best) { best = s; out.preset = this.nightPick || 'nightCalm'; }
    }
    out.in = Math.max(0, best);
    return best < Infinity;
  }
}
