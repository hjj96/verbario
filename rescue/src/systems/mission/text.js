// Russian text & formatting helpers for the mission director (DESIGN §2.14 «Русская типографика», §5 templates).
// Pure functions, no state. Numbers via Intl ru-RU, U+00A0 between a number and its unit, «ёлочки».

export const NBSP = ' ';
const NF1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const fmtNum = (n, digits = 0) => (digits ? NF1 : NF0).format(n);

// Russian plural: plural(5, 'человек', 'человека', 'человек').
export function plural(n, one, few, many) {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// 754 → «12:34»; ≥ 1 h → «1:02:34». Negative is clamped to 0.
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

// «6:00» style for par times in briefing text (minutes without a leading zero).
export function fmtPar(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtPct = (v01) => `${NF0.format(Math.round(v01 * 100))}${NBSP}%`;
export const fmtKm = (m) => (m < 1000 ? `${NF0.format(Math.round(m / 10) * 10)}${NBSP}м` : `${NF1.format(m / 1000)}${NBSP}км`);

// ---------------------------------------------------------------------------------------------
// Number words (masculine), 0..9999 — for radio templates («четыреста пятьдесят»).
const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

export function numberWords(n) {
  n = Math.max(0, Math.min(9999, Math.round(n)));
  if (n === 0) return UNITS[0];
  const out = [];
  const th = Math.floor(n / 1000);
  if (th) out.push(th === 1 ? 'тысяча' : th === 2 ? 'две тысячи' : `${UNITS[th]} ${plural(th, 'тысяча', 'тысячи', 'тысяч')}`);
  const r = n % 1000;
  if (r >= 100) out.push(HUNDREDS[Math.floor(r / 100)]);
  const t = r % 100;
  if (t >= 10 && t < 20) out.push(TEENS[t - 10]);
  else {
    if (t >= 20) out.push(TENS[Math.floor(t / 10)]);
    if (t % 10) out.push(UNITS[t % 10]);
  }
  return out.join(' ');
}

// «четыреста пятьдесят» — distance rounded to 50 m (DESIGN §5 {dist}).
export const distWords = (m) => numberWords(Math.max(50, Math.round(m / 50) * 50));

// Collective numerals for people: 2 → «двое», 5 → «пятеро».
const COLLECTIVE = ['', 'один', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро', 'семеро', 'восьмеро', 'девятеро', 'десятеро'];
export const peopleCollective = (n) => (n >= 1 && n <= 10 ? COLLECTIVE[n] : `${n}${NBSP}${plural(n, 'человек', 'человека', 'человек')}`);

// «три человека», «пять человек» (case: nominative).
const UNITS_F = ['ноль', 'один', 'два', 'три', 'четыре'];
export function peopleWords(n) {
  const w = n < 5 ? UNITS_F[n] : numberWords(n);
  return `${w} ${plural(n, 'человек', 'человека', 'человек')}`;
}

// ---------------------------------------------------------------------------------------------
// Directions. Bearing in degrees: 0 = north (−Z), 90 = east (+X), clockwise.
export const bearingDeg = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;

const C8 = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const FROM8 = ['с севера', 'с северо-востока', 'с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада'];
const TO8 = ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'];
const sector8 = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;

export const compass8 = (deg) => C8[sector8(deg)]; // «СЗ»
export const fromWords = (deg) => FROM8[sector8(deg)]; // «с северо-запада»
export const toWords = (deg) => TO8[sector8(deg)]; // «к северо-западу»

// Wind "from" bearing given the direction the wind blows TOWARDS (weather.state.windDir, x = X, y = Z).
export const windFromDeg = (dirX, dirZ) => bearingDeg(-dirX, -dirZ);

// {clock}: o'clock relative to the nose (DESIGN §5): round(relBearing / 30), 0 → 12.
export function clockOf(heading, dx, dz) {
  const b = Math.atan2(dx, -dz);
  let rel = b - (heading || 0);
  rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const c = Math.round(rel / (Math.PI / 6)) % 12;
  return c === 0 ? 12 : c;
}
const CLOCK_WORDS = ['', 'час', 'два часа', 'три часа', 'четыре часа', 'пять часов', 'шесть часов', 'семь часов', 'восемь часов', 'девять часов', 'десять часов', 'одиннадцать часов', 'двенадцать часов'];
export const clockWords = (c) => CLOCK_WORDS[c] || 'двенадцать часов';

// ---------------------------------------------------------------------------------------------
// Search squares: 500 m grid, columns by phonetic names, rows by number words («Анна-три»).
const SQUARE_COLS = ['Анна', 'Борис', 'Василий', 'Григорий', 'Дмитрий', 'Елена', 'Женя', 'Зинаида', 'Иван', 'Константин', 'Леонид', 'Михаил'];
const SQUARE_ROWS = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать'];
export function squareOf(x, z) {
  const c = Math.max(0, Math.min(SQUARE_COLS.length - 1, Math.floor((x + 3000) / 500)));
  const r = Math.max(0, Math.min(SQUARE_ROWS.length - 1, Math.floor((z + 3000) / 500)));
  return `${SQUARE_COLS[c]}-${SQUARE_ROWS[r]}`;
}

// ---------------------------------------------------------------------------------------------
// Weather presets as the crew talks about them (DESIGN §2.3 table: wind, Hs, HUD visibility).
export const PRESETS = {
  calm: { title: 'Утро. Штиль', chapter: 'ШТИЛЬ', wind: 3, Hs: 0.4, vis: `20${NBSP}км`, sev: 0 },
  overcast: { title: 'Ветер крепчает', chapter: 'ВЕТЕР КРЕПЧАЕТ', wind: 9, Hs: 1.8, vis: `8${NBSP}км`, sev: 1 },
  squall: { title: 'Шквал', chapter: 'ШКВАЛ', wind: 16, Hs: 3.5, vis: `1,5${NBSP}км`, sev: 2 },
  storm: { title: 'Шторм', chapter: 'ШТОРМ', wind: 24, Hs: 7.5, vis: `2${NBSP}км`, sev: 3 },
  nightStorm: { title: 'Ночной шторм', chapter: 'НОЧНОЙ ШТОРМ', wind: 21, Hs: 6.5, vis: `1${NBSP}км`, sev: 4 },
  fog: { title: 'Туман', chapter: 'ТУМАН', wind: 3, Hs: 0.6, vis: `0,2${NBSP}км`, sev: 1 },
  clearing: { title: 'После шторма. Закат', chapter: 'ПРОСВЕТ', wind: 6, Hs: 2.5, vis: `15${NBSP}км`, sev: 1 },
  nightCalm: { title: 'Лунная ночь', chapter: 'ЛУННАЯ НОЧЬ', wind: 2, Hs: 0.5, vis: `10${NBSP}км`, sev: 0 },
};

const DOUGLAS = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
export function seaState(Hs) {
  let s = 0;
  for (const b of DOUGLAS) if (Hs > b) s++;
  return Math.min(9, s + 1);
}
const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function beaufort(ms) {
  let b = 0;
  for (const v of BEAUFORT) if (ms >= v) b++;
  return b;
}

// «ветер СЗ 9 м/с, волнение 4, видимость 8 км» (DESIGN §3.14 operation card).
export function conditionsLine(preset, windFromDegrees) {
  const p = PRESETS[preset] || PRESETS.calm;
  return `ветер ${compass8(windFromDegrees)} ${p.wind}${NBSP}м/с, волнение ${seaState(p.Hs)}, видимость ${p.vis}`;
}

// «ветер СЗ 18 м/с, 8 баллов» for the logbook (live numbers).
export function windLine(speed, fromDeg) {
  const b = beaufort(speed);
  return `ветер ${compass8(fromDeg)} ${NF0.format(Math.round(speed))}${NBSP}м/с, ${b}${NBSP}${plural(b, 'балл', 'балла', 'баллов')}`;
}

// «15:20» → 0..1 day fraction (weather uses it only for the HUD clock).
export function clockToDay(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock || '');
  if (!m) return 0.4;
  return (Number(m[1]) * 60 + Number(m[2])) / 1440;
}

// Human words for survivor group types (accusative for tasks, nominative for radio).
export const GROUP_WORDS = {
  swimmer: { nom: 'человек за бортом', acc: 'человека в воде', short: 'пловец' },
  raft: { nom: 'спасательный плот', acc: 'плот', short: 'плот' },
  hull: { nom: 'перевёрнутая лодка', acc: 'перевёрнутую лодку', short: 'лодка' },
  container: { nom: 'люди на контейнере', acc: 'людей на контейнере', short: 'контейнер' },
  injured: { nom: 'раненый в воде', acc: 'раненого', short: 'раненый' },
  deck: { nom: 'люди на палубе', acc: 'людей на палубе', short: 'палуба' },
  wreck: { nom: 'тонущее судно', acc: 'людей на судне', short: 'судно' },
  plane: { nom: 'самолёт на воде', acc: 'самолёт', short: 'самолёт' },
};
export const groupWords = (type) => GROUP_WORDS[type] || GROUP_WORDS.swimmer;

// Pad names in the genitive for «к северу от маяка».
export function padGenitive(pad) {
  if (!pad) return 'базы';
  const t = pad.type;
  if (t === 'lighthouse') return 'маяка';
  if (t === 'rig') return 'буровой';
  const n = (pad.name || (t === 'ship' ? 'Арктур' : '')).replace(/[«»"]/g, '');
  if (n === 'Арктур') return '«Арктура»';
  return n ? `«${n}»` : 'площадки';
}
export function padName(pad) {
  if (!pad) return 'площадку';
  const n = (pad.name || '').replace(/[«»"]/g, '');
  if (pad.type === 'lighthouse') return `маяк «${n || 'Скалистый'}»`;
  if (pad.type === 'rig') return `буровую «${n || 'Северная-7'}»`;
  if (pad.type === 'ship') return `«${n || 'Арктур'}»`;
  return n ? `«${n}»` : 'площадку';
}
