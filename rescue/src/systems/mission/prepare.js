// Turns a campaign/endless/title entry (campaign.js) into the runtime `def` handed to every system via
// `mission:setup`. Deterministic for a given seed: people manifests, datum offsets and hazard schedules
// are generated here, once, so a retry plays the same story.
import { createRng } from '../../core/math.js';
import { makePeople } from './manifest.js';
import { PRESETS, conditionsLine, clockToDay, squareOf, bearingDeg, toWords, distWords, peopleCollective, fmtPar, NBSP } from './text.js';

// Survivor types every survivors implementation must support (DESIGN §3.11 MUST rows).
export const MUST_TYPES = ['swimmer', 'raft', 'hull', 'container', 'injured', 'deck'];

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const todayWords = (d = new Date()) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const todaySeed = (d = new Date()) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/**
 * @param raw      entry from campaign.js
 * @param opts     { index, seed (override), survivorTypes (array | null) }
 */
export function prepareDef(raw, opts = {}) {
  const def = structuredClone(raw);
  def.index = opts.index ?? def.index ?? 0;
  def.number = def.endless ? 'СМ' : String(def.index + 1).padStart(2, '0');
  if (Number.isFinite(opts.seed)) def.seed = opts.seed;
  else if (def.seed == null) def.seed = todaySeed();
  def.date = def.date || todayWords();
  def.area = def.area || { radius: 1500 };
  def.waterTemp = def.waterTemp ?? 8;
  def.current = def.current || { x: 0, z: 0 };
  def.par = def.par ?? 600;
  def.hazards = def.hazards || [];
  def.survivors = def.survivors || [];
  def.script = def.script || [];
  def.radio = def.radio || [];
  def.hints = def.hints || [];
  def.tags = def.tags || [];
  def.timeOfDay = def.timeOfDay ?? clockToDay(def.clock);
  def.weather = def.weather || { start: 'calm', script: [] };
  def.weather.script = def.weather.script || [];
  def.world = def.world || { pads: [], props: {} };

  const rng = createRng((def.seed >>> 0) * 7919 + 13);
  const supported = Array.isArray(opts.survivorTypes) ? opts.survivorTypes : MUST_TYPES;

  // --- survivors: tags, type fallbacks, people manifests ---------------------------------------
  const used = new Set();
  let total = 0;
  let lastAt = 0;
  def.survivors.forEach((s, i) => {
    s.tag = s.tag || `g${i + 1}`;
    s.at = s.at || 0;
    s.count = Math.max(1, s.count || 1);
    s.hidden = s.hidden !== false;
    s.signals = s.signals || {};
    if (s.fallbackType && !supported.includes(s.type)) {
      s.requestedType = s.type;
      s.type = s.fallbackType;
    }
    if (!Array.isArray(s.people) || s.people.length !== s.count) s.people = makePeople(rng, s.theme || def.theme, s.count, { used, lead: s.lead });
    total += s.count;
    lastAt = Math.max(lastAt, s.at);
  });
  def.total = total;
  def.lastSpawnAt = lastAt;

  // Dispatcher's search areas (DESIGN §3.10): centred off the true position by up to 35 % of R.
  def.datums = [];
  for (const s of def.survivors) {
    if (!s.hidden) continue;
    const R = s.datumRadius || 200;
    const a = rng.next() * Math.PI * 2;
    const d = rng.next() * 0.35 * R;
    s.datum = { x: Math.round(s.x + Math.cos(a) * d), z: Math.round(s.z + Math.sin(a) * d) };
    if (s.at <= 0) def.datums.push({ x: s.datum.x, z: s.datum.z, radius: R, tag: s.tag, label: s.label || '' });
  }

  // --- objectives -------------------------------------------------------------------------------
  def.objectives = { rescue: Math.ceil(0.6 * total), timeLimit: 0, extra: [], ...(def.objectives || {}) };
  def.objectives.rescue = Math.min(total, Math.max(def.endless ? 0 : 1, def.objectives.rescue || 0));

  // --- hazards: expand repeating entries (e.g. rogue waves every 60 s after 4:00) --------------
  const expanded = [];
  for (const h of def.hazards) {
    if (!h.repeat) {
      expanded.push(h);
      continue;
    }
    const until = h.until ?? h.at + h.repeat * 10;
    for (let t = h.at; t <= until; t += h.repeat) {
      // keep clear of scripted hazards of the same type (±20 s)
      if (def.hazards.some((o) => o !== h && !o.repeat && o.type === h.type && Math.abs(o.at - t) < 20)) continue;
      const e = { ...h, at: t };
      delete e.repeat;
      delete e.until;
      delete e.heights;
      if (h.heights) e.height = Math.round(h.heights[0] + rng.next() * (h.heights[1] - h.heights[0]));
      if (e.fromDeg == null && def.weather.windFrom != null) e.fromDeg = Math.round(def.weather.windFrom + (rng.next() - 0.5) * 40);
      expanded.push(e);
    }
  }
  def.hazards = expanded.sort((a, b) => (a.at || 0) - (b.at || 0));

  // --- weather presets & chapters («ГЛАВА 2 · ШКВАЛ») --------------------------------------------
  def.presets = [def.weather.start, ...def.weather.script.map((s) => s.to)];
  def.chapters = [{ at: 0, n: 1, text: (PRESETS[def.weather.start] || PRESETS.calm).chapter }];
  for (const s of def.weather.script) def.chapters.push({ at: s.at, n: def.chapters.length + 1, text: s.chapter || (PRESETS[s.to] || PRESETS.calm).chapter });
  for (const s of def.script) if (s.do === 'chapter') def.chapters.push({ at: s.at, n: 0, text: s.text, script: true });
  def.chapters.sort((a, b) => a.at - b.at).forEach((c, i) => (c.n = i + 1));

  // --- typed card & dispatcher variables -------------------------------------------------------------
  def.windFrom = def.weather.windFrom ?? 300;
  def.card = def.attract ? '' : cardLine(def, def.weather.start, def.windFrom);
  const pad0 = def.world.pads[(def.heli && def.heli.pad) || 0] || { x: 0, z: 0 };
  const start = def.heli && def.heli.x != null ? def.heli : pad0;
  const first = def.survivors.find((s) => s.primary) || def.survivors.find((s) => s.at <= 0);
  if (first) {
    const c = (first.hidden && first.datum) || first;
    const dx = c.x - start.x;
    const dz = c.z - start.z;
    const dist = Math.hypot(dx, dz);
    def.dispatch = {
      square: squareOf(c.x, c.z),
      count: total,
      countWords: peopleCollective(total),
      dir: toWords(bearingDeg(dx, dz)),
      dist: Math.round(dist / 50) * 50,
      distWords: distWords(dist),
      x: c.x,
      z: c.z,
    };
  }

  // --- medal criteria text (DESIGN §3.15) ----------------------------------------------------------
  if (!def.endless && !def.attract) {
    const n60 = Math.ceil(0.6 * total);
    const n85 = Math.ceil(0.85 * total);
    def.medalText = {
      bronze: `Спасти не менее 60${NBSP}% — ${n60} из ${total}`,
      silver: `Не менее 85${NBSP}% — ${n85} из ${total}, время до ${fmtPar(def.par * 1.3)}`,
      gold: `Всех, время до ${fmtPar(def.par)}, 2 стилевых бонуса`,
      cross: 'Золото — и ни одной царапины',
    };
  }
  return def;
}

// «ОПЕРАЦИЯ «ПАРОМ» · 14 октября, 15:20 · 69°12′ с.ш. 33°27′ в.д. · ветер СЗ 9 м/с, волнение 4, видимость 8 км»
export function cardLine(def, preset, windFromDeg) {
  const head = def.endless ? 'ДЕЖУРНАЯ СМЕНА' : `ОПЕРАЦИЯ «${def.codename || def.title.toUpperCase()}»`;
  return [head, `${def.date}, ${def.clock}`, def.coords, conditionsLine(preset, windFromDeg)].filter(Boolean).join(' · ');
}
