// Russian words for radio templates (DESIGN §5): {square}, {clock}, {dist}, {dir}, {heading}, {count},
// {gust}, {side}, {wind}, {pitch}, {n}. Pure functions, no state, no allocations beyond the strings.
//
// The square grid is the same 500 m grid the mission director uses for the dispatcher (phonetic
// columns × number rows, «Анна-три»), so a square named on the radio matches the HUD and the briefing.

export const NBSP = ' ';

// Russian plural: plural(5, 'метр', 'метра', 'метров').
export function plural(n, one, few, many) {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// ---------------------------------------------------------------------------------------------
// Number words, masculine nominative, 0..9999 («четыреста пятьдесят»).
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

// Genitive («до двадцати пяти метров»), 0..999.
const G_UNITS = ['ноля', 'одного', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти'];
const G_TEENS = ['десяти', 'одиннадцати', 'двенадцати', 'тринадцати', 'четырнадцати', 'пятнадцати', 'шестнадцати', 'семнадцати', 'восемнадцати', 'девятнадцати'];
const G_TENS = ['', '', 'двадцати', 'тридцати', 'сорока', 'пятидесяти', 'шестидесяти', 'семидесяти', 'восьмидесяти', 'девяноста'];
const G_HUNDREDS = ['', 'ста', 'двухсот', 'трёхсот', 'четырёхсот', 'пятисот', 'шестисот', 'семисот', 'восьмисот', 'девятисот'];

export function numberGenitive(n) {
  n = Math.max(0, Math.min(999, Math.round(n)));
  if (n === 0) return G_UNITS[0];
  const out = [];
  if (n >= 100) out.push(G_HUNDREDS[Math.floor(n / 100)]);
  const t = n % 100;
  if (t >= 10 && t < 20) out.push(G_TEENS[t - 10]);
  else {
    if (t >= 20) out.push(G_TENS[Math.floor(t / 10)]);
    if (t % 10) out.push(G_UNITS[t % 10]);
  }
  return out.join(' ');
}

// {dist}: rounded to 50 m, in words («четыреста пятьдесят»).
export const distWords = (m) => numberWords(Math.max(50, Math.round((m || 0) / 50) * 50));

// {count}: collective numeral for people (2 → «двое», 5 → «пятеро»).
const COLLECTIVE = ['никого', 'один', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро', 'семеро', 'восьмеро', 'девятеро', 'десятеро'];
export const countWords = (n) => {
  n = Math.max(0, Math.round(n || 0));
  return n <= 10 ? COLLECTIVE[n] : `${numberWords(n)} ${plural(n, 'человек', 'человека', 'человек')}`;
};

// «три человека», «пять человек»
export function peopleWords(n) {
  n = Math.max(1, Math.round(n || 1));
  const w = n === 1 ? 'один' : n === 2 ? 'два' : numberWords(n);
  return `${w} ${plural(n, 'человек', 'человека', 'человек')}`;
}

// «восемь метров», «один метр» (wind on deck, patter).
export const metresWords = (n) => `${numberWords(n)} ${plural(n, 'метр', 'метра', 'метров')}`;
// «четыре градуса»
export const degreesWords = (n) => `${numberWords(n)} ${plural(n, 'градус', 'градуса', 'градусов')}`;
// «двадцати пяти метров» — genitive after «до».
export const metresGenitive = (n) => `${numberGenitive(n)} ${Math.round(n) % 10 === 1 && Math.round(n) % 100 !== 11 ? 'метра' : 'метров'}`;

// ---------------------------------------------------------------------------------------------
// Bearings. Degrees: 0 = north (−Z), 90 = east (+X), clockwise (CONTRACT coordinates).
export const bearingDeg = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
const sector8 = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;
const FROM8 = ['с севера', 'с северо-востока', 'с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада'];
const TO8 = ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'];
export const fromWords = (deg) => FROM8[sector8(deg)]; // «с северо-запада»
export const toWords = (deg) => TO8[sector8(deg)]; // «к северо-западу»

// {clock}: o'clock relative to the nose, round(relBearing / 30), 0 → 12 («на два часа»).
const CLOCK = ['двенадцать часов', 'час', 'два часа', 'три часа', 'четыре часа', 'пять часов', 'шесть часов', 'семь часов', 'восемь часов', 'девять часов', 'десять часов', 'одиннадцать часов'];
export function clockWords(heading, dx, dz) {
  let rel = Math.atan2(dx, -dz) - (heading || 0);
  rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return CLOCK[Math.round(rel / (Math.PI / 6)) % 12];
}

// {side}: «слева» / «справа» / «прямо по курсу» / «сзади», relative to the nose.
export function sideWords(heading, dx, dz) {
  let rel = Math.atan2(dx, -dz) - (heading || 0);
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const a = Math.abs(rel);
  if (a < 0.45) return 'прямо по курсу';
  if (a > 2.6) return 'сзади';
  return rel > 0 ? 'справа' : 'слева';
}

// {heading}: digit by digit, «два-семь-ноль».
const DIGIT = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
export function headingWords(deg) {
  const d = String(Math.round((((deg % 360) + 360) % 360)) % 360).padStart(3, '0');
  return [...d].map((c) => DIGIT[c.charCodeAt(0) - 48]).join('-');
}

// {square}: 500 m grid, phonetic columns, number-word rows («Анна-три»).
const SQUARE_COLS = ['Анна', 'Борис', 'Василий', 'Григорий', 'Дмитрий', 'Елена', 'Женя', 'Зинаида', 'Иван', 'Константин', 'Леонид', 'Михаил'];
const SQUARE_ROWS = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать'];
export function squareOf(x, z) {
  const c = Math.max(0, Math.min(SQUARE_COLS.length - 1, Math.floor((x + 3000) / 500)));
  const r = Math.max(0, Math.min(SQUARE_ROWS.length - 1, Math.floor((z + 3000) / 500)));
  return `${SQUARE_COLS[c]}-${SQUARE_ROWS[r]}`;
}

// «Вспышка — гром»: the crew counts seconds (DESIGN §4 #41). «Раз… два… три.»
const COUNT = ['Раз', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
export function countSeconds(n) {
  n = Math.max(1, Math.min(COUNT.length, Math.round(n)));
  return COUNT.slice(0, n).join('… ');
}
// «километр», «полтора километра», «два километра»
export function kmWords(m) {
  const h = Math.round(m / 500) / 2; // nearest 0.5 km
  if (h <= 0.5) return 'полкилометра';
  if (h === 1) return 'километр';
  if (h === 1.5) return 'полтора километра';
  if (h % 1) return `${numberWords(Math.floor(h))} с половиной ${plural(Math.floor(h), 'километр', 'километра', 'километров')}`;
  return `${numberWords(h)} ${plural(h, 'километр', 'километра', 'километров')}`;
}

// Fill «{key}» placeholders from vars; unknown keys stay readable («…»).
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : '…'));
}
