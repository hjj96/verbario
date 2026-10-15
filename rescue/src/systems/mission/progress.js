// Persistent career (DESIGN §3.15): medals per operation, ranks by total rings, «Спасено за карьеру»,
// unlocks, remembered onboarding hints and the «Смена» top-10. Stored through core/settings.js
// loadProgress/saveProgress (guarded localStorage — the game works without storage).
import { loadProgress, saveProgress } from '../../core/settings.js';

// Ranks by the sum of rings (bronze + silver + gold per operation; 8 operations × 3 = 24 = all gold).
export const RANKS = [
  { rings: 0, name: 'Стажёр' },
  { rings: 3, name: 'Второй пилот' },
  { rings: 7, name: 'Командир экипажа' },
  { rings: 12, name: 'Пилот-спасатель 2-го класса' },
  { rings: 17, name: 'Пилот-спасатель 1-го класса' },
  { rings: 21, name: 'Старший пилот-инструктор' },
  { rings: 24, name: '«Буревестник»' },
];

const blank = () => ({
  v: 1,
  ops: {}, // id -> { best, bestTime, medals: {bronze, silver, gold, cross}, plays, passed }
  career: { rescued: 0, lost: 0, flights: 0, flightTime: 0, distance: 0 },
  hints: {}, // onboarding glyphs already learned
  endless: [], // top-10 [{ score, rescued, lost, time, calls, date, seed }]
  last: 0, // last played operation index
});

export class Progress {
  constructor() {
    this.data = blank();
    this.reload();
  }

  reload() {
    this._career = null;
    this._rank = null;
    const raw = loadProgress();
    const d = blank();
    if (raw && typeof raw === 'object') {
      if (raw.ops && typeof raw.ops === 'object') d.ops = raw.ops;
      if (raw.career && typeof raw.career === 'object') Object.assign(d.career, raw.career);
      if (raw.hints && typeof raw.hints === 'object') d.hints = raw.hints;
      if (Array.isArray(raw.endless)) d.endless = raw.endless.slice(0, 10);
      if (Number.isFinite(raw.last)) d.last = raw.last;
    }
    this.data = d;
  }

  reset() {
    this.data = blank();
    this.save();
  }

  save() {
    this._career = null; // invalidate cached summaries
    this._rank = null;
    saveProgress(this.data);
  }

  get hasProgress() {
    return Object.keys(this.data.ops).length > 0 || this.data.career.flights > 0;
  }

  op(id) {
    return this.data.ops[id] || null;
  }

  ringsFor(id) {
    const m = this.op(id)?.medals;
    return m ? (m.bronze ? 1 : 0) + (m.silver ? 1 : 0) + (m.gold ? 1 : 0) : 0;
  }

  rings() {
    let n = 0;
    for (const id of Object.keys(this.data.ops)) n += this.ringsFor(id);
    return n;
  }

  rank(rings) {
    if (rings === undefined) {
      if (!this._rank) this._rank = this.rank(this.rings());
      return this._rank;
    }
    let i = 0;
    for (let k = 0; k < RANKS.length; k++) if (rings >= RANKS[k].rings) i = k;
    const next = RANKS[i + 1] || null;
    return { index: i, name: RANKS[i].name, rings, next: next ? next.name : null, need: next ? next.rings - rings : 0 };
  }

  // Operation i is open when it is the first one or the previous one was passed (bronze).
  isUnlocked(list, i) {
    if (i <= 0) return true;
    const prev = list[i - 1];
    return !!(prev && this.op(prev.id)?.passed);
  }

  hintSeen(key) {
    return !!this.data.hints[key];
  }

  markHint(key) {
    if (this.data.hints[key]) return;
    this.data.hints[key] = true;
    this.save();
  }

  // Store a finished campaign operation. Returns what changed for the logbook. r.career (optional): the
  // {rescued, lost, time, distance} to add to the career instead of the run's totals — a run restored from
  // a checkpoint only adds what happened since that landing (the rest was filed when the earlier run ended).
  recordMission(list, def, r) {
    const before = this.rank();
    const rec = this.data.ops[def.id] || { best: 0, bestTime: 0, medals: { bronze: false, silver: false, gold: false, cross: false }, plays: 0, passed: false };
    rec.plays++;
    const newBest = r.success && r.total > rec.best;
    if (r.success) {
      if (newBest) rec.best = r.total;
      if (!rec.bestTime || r.time < rec.bestTime) rec.bestTime = Math.round(r.time);
      for (const k of ['bronze', 'silver', 'gold', 'cross']) rec.medals[k] = rec.medals[k] || !!r.medals[k];
    }
    const wasPassed = rec.passed;
    rec.passed = rec.passed || !!r.success;
    this.data.ops[def.id] = rec;
    this.data.last = def.index;
    this._addCareer(r.career || r);
    this.save();
    const after = this.rank();
    const nextIdx = def.index + 1;
    const unlocked = r.success && !wasPassed && list[nextIdx] ? { index: nextIdx, title: list[nextIdx].title } : null;
    return { newBest, unlocked, rankUp: after.index > before.index ? { from: before.name, to: after.name } : null, rank: after, career: this.career() };
  }

  // Store a finished «Смена». Returns the 1-based place in the top-10, or 0.
  recordEndless(entry, r) {
    const list = this.data.endless;
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    list.length = Math.min(list.length, 10);
    this._addCareer(r);
    this.save();
    return list.indexOf(entry) + 1;
  }

  _addCareer(r) {
    const c = this.data.career;
    c.rescued += r.rescued || 0;
    c.lost += r.lost || 0;
    c.flights += 1;
    c.flightTime += Math.round(r.time || 0);
    c.distance += Math.round(r.distance || 0);
  }

  // Cached summary for the title screen («Спасено за карьеру: 137», rank); rebuilt after each save.
  career() {
    if (this._career) return this._career;
    const rank = this.rank();
    return (this._career = { rescued: this.data.career.rescued, lost: this.data.career.lost, flights: this.data.career.flights, flightTime: this.data.career.flightTime, rings: rank.rings, rank: rank.name, nextRank: rank.next, ringsToNext: rank.need });
  }

  highscores() {
    return this.data.endless.slice();
  }
}
