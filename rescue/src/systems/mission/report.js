// Debrief payload (DESIGN §7.7 «ВАХТЕННЫЙ ЖУРНАЛ»): caption for the cinematic, report lines, score
// breakdown, medals with criteria, people manifest with quotes, flight track, crew remark, stamp.
// Built once when an operation ends; HUD renders it, nothing here touches the DOM.
import { createRng } from '../../core/math.js';
import { quoteFor, conditionFor } from './manifest.js';
import { fmtTime, fmtPct, fmtKm, windLine, PRESETS, NBSP, plural } from './text.js';
import { medalsFor, STYLES } from './scoring.js';

const MEDAL_LABEL = { bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', cross: 'Крест' };

export const FAIL_TEXT = {
  crash: 'АВАРИЙНОЕ ПРИВОДНЕНИЕ',
  ditch: 'АВАРИЙНОЕ ПРИВОДНЕНИЕ',
  abort: 'ОТБОЙ ОПЕРАЦИИ',
  time: 'ВРЕМЯ ВЫШЛО',
  lost: 'СМЕНА ОКОНЧЕНА',
  quit: 'СМЕНА СДАНА',
};

// Crew remarks: first matching rule wins (most specific first). DESIGN §7.7 examples included verbatim.
const REMARKS = [
  { when: (r) => r.reason === 'crash', speaker: 'pilot', name: 'Гордеев', text: 'Машину жалко. Людей — нет: все живы. Это главное.' },
  { when: (r) => r.reason === 'ditch', speaker: 'winchman', name: 'Семёныч', text: 'Говорил же: бинго — значит бинго. Ладно. Искупались.' },
  { when: (r) => r.endless && r.rescued >= 20, speaker: 'dispatch', name: 'Берег', text: 'Смена сдана. Двадцать с лишним человек дома. Спасибо, Чайка. Отдыхайте.' },
  { when: (r) => r.endless, speaker: 'dispatch', name: 'Берег', text: 'Смена сдана. Спасибо, Чайка. Катера продолжают работу.' },
  { when: (r) => r.reason === 'abort' || r.reason === 'time', speaker: 'pilot', name: 'Гордеев', text: 'Не всех. Но и не никого. Пошли писать рапорт.' },
  { when: (r) => r.damage >= 0.5, speaker: 'winchman', name: 'Семёныч', text: 'Вертолёт — на ремонт, командира — на беседу.' },
  { when: (r) => r.styleIds.includes('lastDrops'), speaker: 'pilot', name: 'Гордеев', text: 'Сели на парах. Больше так не делай. Пожалуйста.' },
  { when: (r) => r.styleIds.includes('paws'), speaker: 'rescuer', name: 'Костя', text: 'Кот, кстати, так и не сказал спасибо.' },
  { when: (r) => r.styleIds.includes('bottle'), speaker: 'rescuer', name: 'Костя', text: 'Записку я забираю. Повешу над койкой — пусть кто-нибудь и нам напишет.' },
  { when: (r) => r.jewels >= 3, speaker: 'winchman', name: 'Семёныч', text: 'Висели как люстра. Красиво.' },
  { when: (r) => r.success && r.damage <= 1e-6, speaker: 'winchman', name: 'Семёныч', text: 'Даже чай не расплескали.' },
  { when: (r) => r.styleIds.includes('stormDeck'), speaker: 'winchman', name: 'Семёныч', text: 'Сели на палубу, как кот на забор. Уважаю.' },
  { when: (r) => r.styleIds.includes('lightning'), speaker: 'pilot', name: 'Гордеев', text: 'Рядом шарахнуло, а приборы живы. И мы живы.' },
  { when: (r) => r.lost > 0, speaker: 'pilot', name: 'Гордеев', text: 'Не всех… Ладно. Работаем дальше.' },
  { when: (r) => r.par && r.time < r.par * 0.75, speaker: 'pilot', name: 'Гордеев', text: 'Быстро. Берег спрашивает, не перепутали ли мы район.' },
  { when: (r) => r.tags.includes('fog'), speaker: 'pilot', name: 'Гордеев', text: 'Летели на ощупь, как в погреб за картошкой. Но нашли.' },
  { when: (r) => r.tags.includes('eye'), speaker: 'rescuer', name: 'Костя', text: 'Небо было голубое ровно минуту. Я засёк.' },
  { when: (r) => r.tags.includes('night'), speaker: 'rescuer', name: 'Костя', text: 'Вода плюс семь. Напоминаю: я на это не подписывался. А, нет, подписывался.' },
  { when: () => true, speaker: 'winchman', name: 'Семёныч', text: 'Вот вернёмся — борща. И спать. Именно в таком порядке.' },
];

/**
 * @param m        Mission instance (reads def, stats, scorer, manifest, track, marks)
 * @param success  bool
 * @param reason   'complete' | 'crash' | 'ditch' | 'abort' | 'time' | 'lost' | 'quit'
 */
export function buildReport(m, success, reason) {
  const def = m.def;
  const st = m.stats;
  const sc = m.scorer;
  const total = Math.max(1, st.total);
  const ratio = Math.min(1, st.rescued / total);

  // End-of-mission score lines (time bonus, «Без царапины») — silent, they appear in the logbook.
  if (success && !def.endless && def.par && st.time < def.par) sc.add('time', 2 * (def.par - st.time), 'Быстрее пара', null, 1, false);
  if (success && !def.endless && st.damage <= 1e-6) sc.style('noScratch', st.time, null, false, false);

  const breakdown = sc.breakdown();
  const medals = def.endless ? { bronze: false, silver: false, gold: false, cross: false, rings: 0 } : medalsFor({ success, ratio, time: st.time, par: def.par, styles: sc.styleCount(), damage: st.damage });

  // People manifest with quotes (deterministic per seed).
  const rng = createRng((def.seed >>> 0) + 4242);
  const usedQuotes = new Set();
  const people = [];
  for (const p of m.manifest) {
    const status = p.status === 'aboard' ? (reason === 'crash' || reason === 'ditch' ? 'arktur' : 'aboard') : p.status;
    const minutes = p.boardedAt != null ? Math.round((p.since || 0) + (p.boardedAt - (p.spawnAt || 0)) / 60) : null;
    const entry = {
      name: p.name,
      first: p.first,
      surname: p.surname,
      gender: p.gender,
      age: p.age,
      child: !!p.child,
      occupation: p.occupation,
      group: p.groupLabel,
      type: p.type,
      status, // 'rescued' | 'aboard' | 'arktur' | 'lost' | 'missing'
      statusText: statusText(status, p.gender),
      minutes,
      warmth: p.warmth,
      condition: p.condition || (status === 'rescued' || status === 'aboard' || status === 'arktur' ? conditionFor(p.warmth, p.injured) : null),
      injured: !!p.injured,
      pet: p.pet || null,
      quote: null,
    };
    if (status === 'rescued') {
      const tags = [];
      if (p.child) tags.push('child');
      if (p.pet) tags.push('pet');
      if (p.injured) tags.push('injured');
      if (minutes != null && minutes >= 45) tags.push('long');
      if (p.preset === 'fog') tags.push('fog');
      if (p.preset === 'nightStorm' || p.preset === 'nightCalm') tags.push('night');
      if (p.preset === 'storm' || p.preset === 'squall') tags.push('storm');
      if (p.preset === 'clearing') tags.push(def.tags.includes('eye') ? 'eye' : 'sunset');
      if (p.type === 'raft') tags.push('raft');
      if (p.type === 'deck' || p.type === 'wreck') tags.push('deck');
      for (const t of def.tags) if (!tags.includes(t)) tags.push(t);
      if ((def.waterTemp ?? 8) <= 6) tags.push('cold');
      tags.push('any');
      entry.quote = quoteFor(rng, p, tags, usedQuotes);
    }
    people.push(entry);
  }

  const styleIds = breakdown.styles.map((s) => s.id);
  const facts = {
    success,
    reason,
    endless: !!def.endless,
    rescued: st.rescued,
    lost: st.lost,
    damage: st.damage,
    time: st.time,
    par: def.par,
    styleIds,
    jewels: styleIds.filter((s) => s === 'jewel').length,
    tags: def.tags || [],
  };
  const R = REMARKS.find((r) => r.when(facts));

  // Weather summary: the worst wind seen and the sequence of presets flown through.
  const presetPath = [];
  for (const p of st.presets) if (presetPath[presetPath.length - 1] !== p) presetPath.push(p);
  const gusts = (st.maxGust || 0) > st.maxWind + 2.5 ? `, порывы до ${Math.round(st.maxGust)}${NBSP}м/с` : '';
  const weatherText = `${windLine(st.maxWind, st.maxWindFrom)}${gusts}${presetPath.length ? ` · ${presetPath.map((p) => (PRESETS[p] ? PRESETS[p].chapter.toLowerCase() : p)).join(' → ')}` : ''}`;

  const lines = [
    { label: 'Дата', value: `${def.date}, ${def.clock}` },
    { label: 'Борт', value: '«Чайка-07» · Гордеев, Семёныч, Костя' },
    { label: 'Погода', value: weatherText },
    { label: 'Время полёта', value: fmtTime(st.time) },
    { label: 'Спасено', value: `${st.rescued} из ${def.endless ? st.total : total}${st.lost ? ` · потеряно ${st.lost}` : ''}` },
    { label: 'Топливо', value: `израсходовано ${fmtPct(st.fuelUsed)} · остаток ${fmtPct(st.fuelEnd)}${st.refuels ? ` · заправок ${st.refuels}` : ''}` },
    { label: 'Циклы лебёдки', value: String(st.winchCycles) },
    { label: 'Повреждения', value: st.damage > 0 ? fmtPct(st.damage) : 'нет' },
    { label: 'Налёт', value: fmtKm(st.distance) },
  ];
  if (def.endless) lines.splice(5, 0, { label: 'Вызовы', value: `${st.calls} · закрыто ${st.closed}` });
  if (st.bottle) lines.push({ label: 'Находка', value: `бутылка с запиской · «${st.bottle}»` });

  // Cinematic caption & stamp.
  const timeStr = fmtTime(st.time);
  let caption;
  let stamp;
  if (def.endless) {
    caption = `СМЕНА ОКОНЧЕНА · СПАСЕНО ${st.rescued} · ВЫЗОВОВ ${st.calls} · ВРЕМЯ ${timeStr}`;
    stamp = reason === 'crash' || reason === 'ditch' ? 'АВАРИЙНОЕ ПРИВОДНЕНИЕ' : 'СМЕНА СДАНА';
  } else if (success) {
    caption = `ОПЕРАЦИЯ ВЫПОЛНЕНА · ПОДНЯТО НА БОРТ ${st.rescued}/${total} · ВРЕМЯ ${timeStr} · ТОПЛИВО ${fmtPct(st.fuelEnd)}`;
    stamp = `СПАСЕНЫ ${st.rescued}/${total}`;
  } else if (reason === 'crash' || reason === 'ditch') {
    caption = 'АВАРИЙНОЕ ПРИВОДНЕНИЕ · ЭКИПАЖ И ПАССАЖИРЫ ПОДОБРАНЫ «АРКТУРОМ»';
    stamp = 'ОПЕРАЦИЯ ПРЕРВАНА';
  } else {
    caption = `${FAIL_TEXT[reason] || 'ОПЕРАЦИЯ ПРЕРВАНА'} · СПАСЕНО ${st.rescued}/${total} · ВРЕМЯ ${timeStr}`;
    stamp = 'ОПЕРАЦИЯ ПРЕРВАНА';
  }

  const medalList = def.endless
    ? []
    : ['bronze', 'silver', 'gold', 'cross'].map((id) => ({ id, label: MEDAL_LABEL[id], text: def.medalText ? def.medalText[id] : '', got: !!medals[id] }));

  const missing = people.filter((p) => p.status === 'missing').length;

  return {
    id: def.id,
    index: def.index,
    number: def.number,
    title: def.title,
    codename: def.codename,
    card: def.card,
    endless: !!def.endless,
    success: !!success,
    reason,
    reasonText: success ? 'ОПЕРАЦИЯ ВЫПОЛНЕНА' : FAIL_TEXT[reason] || 'ОПЕРАЦИЯ ПРЕРВАНА',
    caption,
    stamp,
    stampColor: '#C8102E',
    rescued: st.rescued,
    total: def.endless ? st.total : total,
    lost: st.lost,
    missing,
    missingText: missing ? `${missing}${NBSP}${plural(missing, 'человек', 'человека', 'человек')} — поиск продолжается` : '',
    time: st.time,
    par: def.par,
    fuel: st.fuelEnd,
    fuelUsed: st.fuelUsed,
    winchCycles: st.winchCycles,
    pickups: st.pickups,
    damage: st.damage,
    distance: st.distance,
    lines,
    score: breakdown,
    styles: breakdown.styles,
    styleCatalogue: STYLES,
    medals,
    medalList,
    people,
    track: m.trackPoints(),
    marks: m.marks.slice(),
    remark: { speaker: R.speaker, name: R.name, text: R.text },
    weather: weatherText,
    stats: { ...st },
  };
}

function statusText(status, gender) {
  const a = gender === 'f' ? 'а' : '';
  switch (status) {
    case 'rescued':
      return `доставлен${a}`;
    case 'aboard':
      return 'на борту';
    case 'arktur':
      return `подобран${a} «Арктуром»`;
    case 'lost':
      return `потерян${a}`;
    default:
      return 'поиск продолжается';
  }
}
