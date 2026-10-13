// Score keeping (DESIGN §3.15): base items, style bonuses with a chain multiplier (×1.2 per step within
// 20 s, max ×2), difficulty multiplier, medals. Every award emits `score:add {points, reason, position}`
// so the HUD can float «+150» from the world point and audio can stamp.

export const STYLES = {
  jewel: { label: 'Ювелирно', points: 30, note: 'весь цикл лебёдки при устойчивости ≥ 85 %' },
  underCrest: { label: 'Под гребнем', points: 60, note: 'подъём, пока под тросом шёл гребень ≥ 6 м' },
  lightning: { label: 'Мимо молнии', points: 40, note: 'удар в 15–40 м без урона' },
  eye: { label: 'Глаз в глаз', points: 50, note: 'ближе двух радиусов к ядру вихря без урона' },
  fullHouse: { label: 'Полный борт', points: 100, note: 'доставка с полным салоном' },
  stormDeck: { label: 'Палуба в шторм', points: 75, note: 'чистая посадка при качке ≥ 6°' },
  lastDrops: { label: 'На последних каплях', points: 100, note: 'посадка с топливом < 5 %' },
  oneGo: { label: 'Одним заходом', points: 50, note: 'весь плот поднят без выхода из висения' },
  fogBlind: { label: 'Сквозь молоко', points: 40, note: 'спасение в тумане без ракеты' },
  paws: { label: 'Четыре лапы', points: 50, note: 'спасён зверь' },
  noScratch: { label: 'Без царапины', points: 300, note: 'операция без единого повреждения' },
};

export const DIFFICULTY = {
  cadet: { label: 'Курсант', mult: 0.8 },
  pilot: { label: 'Пилот', mult: 1.0 },
  ace: { label: 'Ас', mult: 1.3 },
};

// Breakdown lines in logbook order.
const ORDER = ['delivered', 'warmth', 'golden', 'style', 'time', 'lost', 'damage', 'autorotation'];
const LABELS = {
  delivered: 'Доставлено людей',
  warmth: 'Тепло при подъёме',
  golden: '«Золотой час»',
  style: 'Стиль',
  time: 'Быстрее пара',
  lost: 'Потеряно людей',
  damage: 'Повреждения корпуса',
  autorotation: 'Посадка на авторотации',
};

const CHAIN_WINDOW = 20;

// Popups anchor to a frozen world point (a moving ship/heli position is copied).
const pt = (p) => (p ? { x: p.x, y: p.y || 0, z: p.z } : null);

export class Scorer {
  constructor(events) {
    this.events = events;
    this.items = new Map(); // id -> { id, label, points, count }
    this.styles = []; // [{ id, label, points, base, chain, t }]
    this.reset('pilot');
  }

  reset(difficulty = 'pilot') {
    this.items.clear();
    this.styles.length = 0;
    this.raw = 0;
    this.chain = 0;
    this.lastStyleT = -1e9;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'pilot';
    this.mult = DIFFICULTY[this.difficulty].mult;
  }

  // Running score before the difficulty multiplier (what the HUD shows during play).
  get score() {
    return this.raw;
  }

  // Logbook total: difficulty multiplier applied, never below zero.
  get final() {
    return Math.max(0, Math.round(this.raw * this.mult));
  }

  _item(id, points, count = 1) {
    let it = this.items.get(id);
    if (!it) this.items.set(id, (it = { id, label: LABELS[id] || id, points: 0, count: 0 }));
    it.points += points;
    it.count += count;
    this.raw += points;
  }

  /**
   * Add a base item. `emit` false for silent bookkeeping (e.g. lines added at the end).
   * @param id       one of ORDER
   * @param reason   popup text («Доставлен», «Потерян»)
   */
  add(id, points, reason, position, count = 1, emit = true) {
    points = Math.round(points);
    this._item(id, points, count);
    if (emit && points !== 0) this.events.emit('score:add', { points, reason, position: pt(position), kind: id });
    return points;
  }

  // Style bonus with chain multiplier. t = mission time (s). End-of-mission bonuses pass chainable = false.
  style(id, t, position, emit = true, chainable = true) {
    const S = STYLES[id];
    if (!S) return 0;
    let chain = 1;
    if (chainable) {
      if (t - this.lastStyleT <= CHAIN_WINDOW && this.styles.length) this.chain++;
      else this.chain = 0;
      this.lastStyleT = t;
      chain = Math.min(2, Math.pow(1.2, this.chain));
    }
    const points = Math.round(S.points * chain);
    this._item('style', points);
    this.styles.push({ id, label: S.label, note: S.note, points, base: S.points, chain, t });
    if (emit) this.events.emit('score:add', { points, reason: S.label, position: pt(position), kind: 'style', style: id, chain });
    return points;
  }

  styleCount() {
    return this.styles.length;
  }

  // Logbook breakdown: lines in fixed order, difficulty line, final total.
  breakdown() {
    const lines = [];
    for (const id of ORDER) {
      const it = this.items.get(id);
      if (it && (it.points !== 0 || it.count)) lines.push({ id, label: it.label, points: it.points, count: it.count });
    }
    const D = DIFFICULTY[this.difficulty];
    return {
      lines,
      styles: this.styles.map((s) => ({ ...s })),
      subtotal: this.raw,
      difficulty: { id: this.difficulty, label: D.label, mult: D.mult, points: this.final - this.raw },
      total: this.final,
    };
  }
}

// Medals (DESIGN §3.15). ratio = delivered / total.
export function medalsFor({ success, ratio, time, par, styles, damage }) {
  const bronze = !!success && ratio >= 0.6 - 1e-9;
  const silver = bronze && ratio >= 0.85 - 1e-9 && (!par || time <= par * 1.3);
  const gold = silver && ratio >= 1 - 1e-9 && (!par || time <= par) && styles >= 2;
  const cross = gold && damage <= 1e-6;
  return { bronze, silver, gold, cross, rings: (bronze ? 1 : 0) + (silver ? 1 : 0) + (gold ? 1 : 0) };
}
