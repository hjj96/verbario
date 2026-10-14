// The operation's ledger: live statistics, people manifest, logbook map marks, flight track and every
// score award that comes from gameplay events (DESIGN §3.15). Mission owns flow; the ledger only counts.
//
// Event semantics it accepts (robust to either order / to stubs):
//   heli:capture {survivor}            basket grabbed someone      → warmth at lift, map mark, «Одним заходом» start
//   heli:pickup  {survivor, person?}   person is now in the cabin  → manifest «на борту», «Ювелирно», «Под гребнем»
//   survivor:boarded {s, person}       survivors' own record        → only enriches names (no double count)
//   heli:unload  {pad, count, people}  delivered                    → 100 + 50·warmth, «Золотой час»
import * as THREE from 'three';
import { guessGender } from './manifest.js';
import { groupWords, windFromDeg } from './text.js';

const TRACK_MAX = 1800; // samples (decimated ×2 when full)
const GOLDEN_HOUR_S = 150;
const DAMAGE_FLUSH_S = 0.35; // aggregate continuous damage into one popup

export function blankStats() {
  return {
    rescued: 0, // delivered to a pad
    lost: 0,
    total: 0,
    inCabin: 0,
    time: 0,
    par: 0,
    fuelUsed: 0, // fraction of a tank (> 1 with refuels)
    fuelEnd: 1,
    hullEnd: 1,
    refuels: 0,
    winchCycles: 0,
    pickups: 0,
    damage: 0, // 0..1 hull lost in total
    damageTaken: 0, // CONTRACT name, same value as `damage`
    landings: 0,
    distance: 0, // m
    maxAlt: 0,
    flares: 0,
    spotted: 0,
    nearMisses: 0,
    maxWind: 0, // sustained (mean) wind — the logbook's Beaufort number
    maxWindFrom: 0,
    maxGust: 0, // mean + gust
    presets: [],
    calls: 0,
    closed: 0,
    lastDamageSource: null,
  };
}

export class Ledger {
  constructor(mission) {
    this.m = mission;
    this.ctx = mission.ctx;
    this.stats = blankStats();
    this.manifest = []; // [{name, first, surname, gender, age, occupation, child, tag, type, groupLabel, status, …}]
    this.marks = []; // [{type: 'rescue'|'lost'|'hazard'|'pad', x, z, label}]
    this.goldenHour = null;
    this._track = new Float32Array(TRACK_MAX * 3);
    this._trackN = 0;
    this._trackEvery = 2;
    this._trackT = 0;
    this._lastPos = new THREE.Vector3();
    this._tagOf = new WeakMap(); // survivor group object -> def tag
    this._recOf = new WeakMap(); // person record (heli cabin / survivors) -> manifest entry
    this._groups = new Map(); // tag -> { tag, rockets, rescued }
    this._golden = [];
    this._once = new Set();
    this._cycle = { active: false, min: 1, crest: false };
  }

  reset(def) {
    this.def = def;
    this.stats = blankStats();
    this.stats.total = def.total || 0;
    this.stats.par = def.par || 0;
    this.manifest = [];
    this.marks = [];
    this.goldenHour = null;
    this._trackN = 0;
    this._trackEvery = 2;
    this._trackT = 0;
    this._tagOf = new WeakMap();
    this._recOf = new WeakMap();
    this._groups.clear();
    this._golden.length = 0;
    this._once.clear();
    this._cycle.active = false;
    this._cycle.min = 1;
    this._cycle.crest = false;
    this._winchPrev = 'stowed';
    this._oneGo = null;
    this._captured = null;
    this._captureWarmth = null;
    this._dmgPending = 0;
    this._dmgT = 0;
    this.lastDamageT = -1e9;
    this._lastPreset = null;
    for (const s of def.survivors || []) this._addPeople(s);
  }

  // Launch baselines (fuel/hull deltas, distance origin, first track point).
  baseline() {
    const h = this.ctx.heli;
    this._fuelPrev = h?.fuel ?? 1;
    this._hullPrev = h?.hull ?? 1;
    if (h?.position) this._lastPos.copy(h.position);
    this._lastPreset = null;
    // Only the preset here: launch() runs in the same frame as mission:setup, before weather.update
    // has refreshed windSpeed/gust from the new preset (they still hold the title cycle's storm —
    // the logbook then read «ветер 24 м/с, 9 баллов · штиль»). The 2 Hz tick samples wind from now on.
    this.weatherTick(false);
    this._pushTrack();
  }

  // ---------------------------------------------------------------------------------------------
  // People
  _addPeople(entry) {
    const people = entry.people || [];
    for (let i = 0; i < entry.count; i++) {
      const p = people[i] || { name: 'Неизвестный', first: 'Неизвестный', surname: '', gender: 'm', age: null, occupation: '' };
      this.manifest.push({
        ...p,
        tag: entry.tag,
        type: entry.requestedType || entry.type,
        groupLabel: entry.label || groupWords(entry.type).nom,
        since: entry.since || 0,
        spawnAt: entry.at || 0,
        pet: entry.pet && i === 0 ? entry.pet : null,
        injured: entry.type === 'injured',
        status: 'missing', // → 'aboard' → 'rescued' | 'lost'
        warmth: null,
        boardedAt: null,
        deliveredAt: null,
        preset: null,
        condition: null,
      });
    }
  }

  // Endless call spawned at runtime.
  addGroup(entry, s) {
    entry.at = this.m.elapsed;
    this.def.survivors.push(entry);
    this.def.total = (this.def.total || 0) + entry.count;
    this.stats.total += entry.count;
    this._addPeople(entry);
    if (s && typeof s === 'object') this._tagOf.set(s, entry.tag);
  }

  _entry(tag, status, name) {
    let fallback = null;
    for (const e of this.manifest) {
      if (e.status !== status || (tag && e.tag !== tag)) continue;
      if (name && e.name === name) return e;
      if (!fallback) fallback = e;
    }
    return fallback;
  }

  // ---------------------------------------------------------------------------------------------
  // Survivor groups ↔ def entries (tags)
  tag(s) {
    if (!s || typeof s !== 'object') return null;
    let t = this._tagOf.get(s);
    if (t) return t;
    t = s.tag || s.def?.tag || s.spec?.tag || null;
    if (!t && s.position && this.def) {
      // nearest def entry of the same kind (jumpers from a wreck map to the wreck's people)
      let best = null;
      let bd = 450;
      for (const e of this.def.survivors) {
        const k = e.type === s.type || e.requestedType === s.type ? 1 : 1.6;
        const d = Math.hypot(e.x - s.position.x, e.z - s.position.z) * k;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      t = best ? best.tag : null;
    }
    if (t) this._tagOf.set(s, t);
    return t;
  }

  group(tag) {
    let g = this._groups.get(tag);
    if (!g) this._groups.set(tag, (g = { tag, rockets: 0, rescued: false }));
    return g;
  }

  findGroup(tag) {
    const list = this.ctx.survivors?.list;
    if (!list) return null;
    for (const s of list) if (s && this.tag(s) === tag && s.state !== 'rescued' && s.state !== 'lost') return s;
    return null;
  }

  datumFor(s) {
    const ds = this.ctx.survivors?.datums;
    if (ds && s.id != null) for (const d of ds) if (d && d.ids && d.ids.includes(s.id)) return d;
    const tag = this.tag(s);
    const e = tag && this.def.survivors.find((x) => x.tag === tag);
    return e?.datum || null;
  }

  // ---------------------------------------------------------------------------------------------
  // Per-frame polling in play (allocation-free)
  poll(dt) {
    const ctx = this.ctx;
    const h = ctx.heli;
    if (!h) return;
    const st = this.stats;
    const m = this.m;

    // Fuel spent (refuels don't count) and damage taken, from the heli's own numbers.
    const f = h.fuel ?? 1;
    if (f < this._fuelPrev) st.fuelUsed += this._fuelPrev - f;
    this._fuelPrev = f;
    const hull = h.hull ?? 1;
    if (hull < this._hullPrev - 1e-6) {
      const d = this._hullPrev - hull;
      st.damage += d;
      st.damageTaken = st.damage;
      this._dmgPending += d;
      this._dmgT = DAMAGE_FLUSH_S;
      this.lastDamageT = m.elapsed;
    }
    this._hullPrev = hull;
    if (this._dmgPending > 0) {
      this._dmgT -= dt;
      if (this._dmgT <= 0) this.flushDamage(true);
    }
    st.inCabin = h.cabin ? h.cabin.length : 0;

    // Distance flown, max altitude.
    const p = h.position;
    if (p) {
      const d = Math.hypot(p.x - this._lastPos.x, p.z - this._lastPos.z);
      if (d < 200) st.distance += d; // ignore teleports (reset/spawn)
      this._lastPos.copy(p);
      const alt = h.altitude ?? p.y;
      if (alt > st.maxAlt) st.maxAlt = alt;
    }

    // Winch cycle: «Ювелирно» (min steadiness over the whole cycle), «Под гребнем» (≥ 6 m crest under the cable).
    const w = h.winch;
    const ws = (w && w.state) || 'stowed';
    if (ws !== this._winchPrev) {
      if (this._winchPrev === 'stowed' && ws !== 'stowed') {
        st.winchCycles++;
        this._cycle.active = true;
        this._cycle.min = 1;
        this._cycle.crest = false;
      }
      this._winchPrev = ws;
    }
    if (this._cycle.active && w) {
      const s = w.steadiness ?? 1;
      if (s < this._cycle.min) this._cycle.min = s;
      if (w.load && w.basket && ctx.ocean?.heightAt && ctx.ocean.heightAt(w.basket.x, w.basket.z) >= 6) this._cycle.crest = true;
    }

    // «Одним заходом»: the lift session breaks if the heli leaves the hover.
    if (this._oneGo && !this._oneGo.broken) {
      const v = h.velocity;
      if (h.landed || (v && Math.hypot(v.x, v.z) > 6)) this._oneGo.broken = true;
    }

    // «Золотой час» countdown for injured on board.
    if (this._golden.length) {
      let left = Infinity;
      for (const g of this._golden) if (g.e.status === 'aboard') left = Math.min(left, GOLDEN_HOUR_S - (m.elapsed - g.t));
      this.goldenHour = left === Infinity ? null : Math.max(0, left);
    } else this.goldenHour = null;

    // Flight track every 2 s of play.
    this._trackT += dt;
    if (this._trackT >= this._trackEvery) {
      this._trackT = 0;
      this._pushTrack();
    }
  }

  flushDamage(emit) {
    if (this._dmgPending <= 0) return;
    this.m.scorer.add('damage', -this._dmgPending * 100 * 2, 'Повреждение', this.ctx.heli?.position, 1, emit);
    this._dmgPending = 0;
  }

  // 1–2 Hz: worst wind and the presets flown through (logbook weather line).
  weatherTick(sampleWind = true) {
    const w = this.ctx.weather?.state;
    if (!w) return;
    // Beaufort from the sustained wind, gusts apart: a scripted 8 m/s gust in a calm read as
    // «ветер 11 м/с, 5 баллов · штиль» in the logbook.
    const wind = w.windSpeed || 0;
    if (sampleWind) this.stats.maxGust = Math.max(this.stats.maxGust, wind + (w.gust || 0));
    if (sampleWind && wind > this.stats.maxWind) {
      this.stats.maxWind = wind;
      if (Number.isFinite(w.windFrom)) this.stats.maxWindFrom = w.windFrom;
      else if (w.windDir) this.stats.maxWindFrom = windFromDeg(w.windDir.x, w.windDir.y);
    }
    if (w.preset && w.preset !== this._lastPreset) {
      this._lastPreset = w.preset;
      this.stats.presets.push(w.preset);
    }
  }

  _pushTrack() {
    const h = this.ctx.heli;
    const p = h?.position;
    if (!p) return;
    if (this._trackN >= TRACK_MAX) {
      for (let i = 0; i < TRACK_MAX / 2; i++) {
        this._track[i * 3] = this._track[i * 6];
        this._track[i * 3 + 1] = this._track[i * 6 + 1];
        this._track[i * 3 + 2] = this._track[i * 6 + 2];
      }
      this._trackN = TRACK_MAX / 2;
      this._trackEvery *= 2;
    }
    const k = this._trackN * 3;
    this._track[k] = p.x;
    this._track[k + 1] = p.z;
    this._track[k + 2] = h.altitude ?? p.y;
    this._trackN++;
  }

  // [[x, z, alt], …] — allocated on demand (debrief only).
  trackPoints() {
    const out = [];
    for (let i = 0; i < this._trackN; i++) {
      const k = i * 3;
      out.push([Math.round(this._track[k] * 10) / 10, Math.round(this._track[k + 1] * 10) / 10, Math.round(this._track[k + 2] * 10) / 10]);
    }
    return out;
  }

  // End of operation: settle pending numbers, add pad marks and the last track point.
  finalize() {
    const h = this.ctx.heli;
    const st = this.stats;
    st.time = this.m.elapsed;
    st.fuelEnd = h?.fuel ?? 1;
    st.hullEnd = h?.hull ?? 1;
    this.flushDamage(false);
    for (const pad of this.ctx.world?.pads || []) if (pad?.position) this.marks.push({ type: 'pad', x: Math.round(pad.position.x), z: Math.round(pad.position.z), label: pad.name || '' });
    this._pushTrack();
  }

  // ---------------------------------------------------------------------------------------------
  // Event handlers (Mission wires them, only while flying)
  onCapture(s) {
    if (!s || this._captured === s) return;
    this._captured = s;
    this._captureWarmth = Number.isFinite(s.health) ? s.health : null;
    if (s.position) this.marks.push({ type: 'rescue', x: Math.round(s.position.x), z: Math.round(s.position.z), label: groupWords(s.type).short });
    const tag = this.tag(s);
    if (tag && (s.type === 'raft' || s.type === 'deck' || s.type === 'wreck' || s.type === 'plane') && (!this._oneGo || this._oneGo.tag !== tag)) this._oneGo = { tag, broken: false };
  }

  // The person is now in the cabin (heli emits it from its _board()).
  onPickup(s, rec) {
    if (this._captured !== s) this.onCapture(s);
    this._captured = null;
    this.stats.pickups++;
    const tag = this.tag(s);
    const name = rec && rec.name;
    let e = (rec && this._recOf.get(rec)) || this._entry(tag, 'missing', name) || this._entry(null, 'missing', name);
    if (!e) {
      // more people than the manifest knew (e.g. a dropped raft gathered extra swimmers)
      this._addPeople({ tag: tag || 'extra', type: s?.type || 'swimmer', count: 1, label: groupWords(s?.type).nom });
      e = this.manifest[this.manifest.length - 1];
    }
    if (name && name !== 'Пострадавший' && name !== e.name) this._adoptName(e, rec);
    e.status = 'aboard';
    e.boardedAt = this.m.elapsed;
    e.warmth = rec?.warmth ?? this._captureWarmth ?? s?.health ?? null;
    e.preset = this.ctx.weather?.state?.preset || null;
    e.condition = rec?.condition && rec.condition !== 'стабилен' ? rec.condition : e.condition;
    e.injured = e.injured || !!(rec?.stretcher || rec?.injured || s?.type === 'injured' || s?.priority);
    if (rec && typeof rec === 'object') this._recOf.set(rec, e);
    if (e.injured) this._golden.push({ e, t: this.m.elapsed });

    const pos = this.ctx.heli?.position;
    if (this._cycle.active) {
      if (this._cycle.min >= 0.85) this.m.style('jewel', pos);
      if (this._cycle.crest) this.m.style('underCrest', pos);
      this._cycle.active = false;
    }
    return tag;
  }

  // survivors' own record — use it for names/ages only (heli:pickup does the counting).
  onBoarded(s, person) {
    if (!person || typeof person !== 'object' || !person.name) return;
    const tag = this.tag(s);
    // the heli record is a copy of this one: give the same manifest entry a matching name
    const e = this._entry(tag, 'missing', person.name) || this._entry(tag, 'aboard', person.name);
    if (e) this._recOf.set(person, e);
  }

  _adoptName(e, rec) {
    e.name = rec.name;
    const parts = String(rec.name).split(/\s+/);
    e.first = parts[0];
    e.surname = parts.slice(1).join(' ');
    e.gender = rec.gender || guessGender(rec.name);
    if (rec.age) e.age = rec.age;
  }

  onGroupRescued(s) {
    const tag = this.tag(s);
    if (!tag) return null;
    const g = this.group(tag);
    if (g.rescued) return null;
    g.rescued = true;
    const pos = s?.position || this.ctx.heli?.position;
    const entry = this.def.survivors.find((x) => x.tag === tag);
    const count = s?.count || entry?.count || 1;
    if (this._oneGo && this._oneGo.tag === tag) {
      if (!this._oneGo.broken && count >= 2) this.m.style('oneGo', pos);
      this._oneGo = null;
    }
    if (this.ctx.weather?.state?.preset === 'fog' && g.rockets === 0) this.m.style('fogBlind', pos);
    if (entry?.pet && !this._once.has(`paws:${tag}`)) {
      this._once.add(`paws:${tag}`);
      this.m.style('paws', pos);
    }
    return tag;
  }

  onLost(s) {
    const tag = this.tag(s);
    let n = Number.isFinite(s?.remaining) ? s.remaining : s?.count || 1;
    // the manifest is the authority on how many of this group are still out there
    let missing = 0;
    for (const e of this.manifest) if (e.status === 'missing' && (!tag || e.tag === tag)) missing++;
    n = Math.min(n, missing); // nobody left out there → nothing more to lose
    if (n <= 0) return tag;
    let k = n;
    for (const e of this.manifest) {
      if (k <= 0) break;
      if (e.status === 'missing' && (!tag || e.tag === tag)) {
        e.status = 'lost';
        k--;
      }
    }
    this.stats.lost += n;
    const pos = s?.position || null;
    if (pos) this.marks.push({ type: 'lost', x: Math.round(pos.x), z: Math.round(pos.z), label: groupWords(s.type).short });
    this.m.scorer.add('lost', -150 * n, n === 1 ? 'Потерян' : `Потеряно ${n}`, pos, n);
    return tag;
  }

  onUnload(p) {
    const recs = Array.isArray(p.people) ? p.people : null;
    const n = recs ? recs.length : Math.max(0, p.count || 0);
    if (!n) return 0;
    let base = 0;
    let warm = 0;
    let golden = 0;
    for (let i = 0; i < n; i++) {
      const rec = recs ? recs[i] : null;
      let e = rec && typeof rec === 'object' ? this._recOf.get(rec) : null;
      if (!e || e.status !== 'aboard') e = this._entry(null, 'aboard', rec?.name);
      if (!e) e = this._entry(null, 'missing', rec?.name); // boarded without any event we saw
      if (e) {
        e.status = 'rescued';
        e.deliveredAt = this.m.elapsed;
      }
      const w = Math.max(0, Math.min(1, e?.warmth ?? rec?.warmth ?? rec?.health ?? 0.6));
      base += 100;
      warm += Math.round(50 * w);
      if (e?.injured && e.boardedAt != null && this.m.elapsed - e.boardedAt <= GOLDEN_HOUR_S) golden += 150;
    }
    this.stats.rescued += n;
    const sc = this.m.scorer;
    const pos = p.pad?.position || this.ctx.heli?.position || null;
    sc.add('delivered', base, '', pos, n, false);
    sc.add('warmth', warm, '', pos, n, false);
    this.ctx.events.emit('score:add', { points: base + warm, reason: n === 1 ? 'Доставлен' : `Доставлено ${n}`, position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, kind: 'delivered', count: n });
    if (golden) sc.add('golden', golden, '«Золотой час»', pos, golden / 150);
    return n;
  }

  onLand(p) {
    const ctx = this.ctx;
    const h = ctx.heli;
    const pad = p.pad;
    this.stats.landings++;
    if (!h || !pad) return;
    const pos = pad.position || h.position;
    const fuel = h.fuel ?? 1;
    if (p.autorotation || fuel <= 0.001) this.m.scorer.add('autorotation', -200, 'Авторотация', pos);
    else if (fuel < 0.05 && !this._once.has('lastDrops')) {
      this._once.add('lastDrops');
      this.m.style('lastDrops', pos);
    }
    // «Полный борт»: delivery with a full cabin (stretchers take two seats)
    let seats = 0;
    for (const r of h.cabin || []) seats += r && (r.stretcher || r.injured) ? 2 : 1;
    if (seats > 0 && seats >= (h.capacity || 6)) this.m.style('fullHouse', pos);
    // «Палуба в шторм»: clean deck landing while the deck rolls ≥ 6°
    if (pad.type === 'ship' && this.m.elapsed - this.lastDamageT > 1.5 && !this._once.has('stormDeck')) {
      const Hs = ctx.weather?.state?.waveHeight || 0;
      const amp = pad.tiltAmp ?? pad.rollAmp ?? (Math.min(9, 2 + 0.95 * Hs) * Math.PI) / 180;
      if (amp >= (6 * Math.PI) / 180 - 1e-4) {
        this._once.add('stormDeck');
        this.m.style('stormDeck', pos);
      }
    }
  }

  onSignal(s, kind) {
    if (kind !== 'rocket') return null;
    const tag = this.tag(s);
    if (tag) this.group(tag).rockets++;
    return tag;
  }

  onHazardSpawn(hz) {
    if (hz?.position) this.marks.push({ type: 'hazard', x: Math.round(hz.position.x), z: Math.round(hz.position.z), label: hz.type });
  }

  breakOneGo() {
    if (this._oneGo) this._oneGo.broken = true;
  }
}
