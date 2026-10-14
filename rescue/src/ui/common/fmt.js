// Russian typography & number formatting for the HUD and menus (DESIGN §2.14 «Русская типографика»).
// Numbers via Intl ru-RU (decimal comma), U+00A0 between a number and its unit, «ёлочки».
// In-flight instruments use UPPER-CASE units («18 М/С», «1,4 КМ»); the paper register uses lower case.
// Functions used every frame (distance labels, bearings) go through small string caches so the
// 60 Hz canvas does not rebuild identical strings.

export const NBSP = ' ';
export const THIN = ' ';

const NF0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF1o = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const num0 = (n) => NF0.format(Math.round(n || 0));
export const num1 = (n) => NF1.format(n || 0); // always one decimal: «4,0»
export const num1o = (n) => NF1o.format(n || 0); // optional decimal: «4» / «4,5»

// Russian plural: plural(5, 'человек', 'человека', 'человек').
export function plural(n, one, few, many) {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutBack = (t) => {
  t = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ------------------------------------------------------------------------------------------------
// Time
export function mmss(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

// «6:20» (minutes without a leading zero) — fuel endurance, forecast.
export function mss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Documentary timecode HH:MM:SS:FF at 25 fps («00:14:32:07»).
export function timecode(sec) {
  const t = Math.max(0, sec || 0);
  const f = Math.floor((t % 1) * 25);
  const s = Math.floor(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}

// Day fraction 0..1 → «05:42».
export function clockOf(dayFraction) {
  let m = Math.round(((((dayFraction || 0) % 1) + 1) % 1) * 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------------
// Distances. «740 М» / «1,4 КМ» (HUD) — cached by rounded value.
const distCacheU = new Map();
const distCacheL = new Map();
export function distU(m) {
  const k = m < 1000 ? Math.round(m / 10) * 10 : 10000 + Math.round(m / 100);
  let s = distCacheU.get(k);
  if (s === undefined) {
    s = m < 1000 ? `${NF0.format(Math.round(m / 10) * 10)}${NBSP}М` : `${NF1.format(Math.round(m / 100) / 10)}${NBSP}КМ`;
    if (distCacheU.size > 600) distCacheU.clear();
    distCacheU.set(k, s);
  }
  return s;
}
export function distL(m) {
  const k = m < 1000 ? Math.round(m / 10) * 10 : 10000 + Math.round(m / 100);
  let s = distCacheL.get(k);
  if (s === undefined) {
    s = m < 1000 ? `${NF0.format(Math.round(m / 10) * 10)}${NBSP}м` : `${NF1o.format(Math.round(m / 100) / 10)}${NBSP}км`;
    if (distCacheL.size > 600) distCacheL.clear();
    distCacheL.set(k, s);
  }
  return s;
}

// Visibility «1,2 КМ» / «200 М».
export function visU(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${NF1o.format(Math.round(m / 100) / 10)}${NBSP}КМ`;
  return `${NF0.format(Math.round(m / 10) * 10)}${NBSP}М`;
}

// ------------------------------------------------------------------------------------------------
// Directions. Bearing in degrees: 0 = north (−Z), 90 = east (+X), clockwise.
export const bearingDeg = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
export const bearingRad = (dx, dz) => Math.atan2(dx, -dz);
const deg3Cache = [];
export function deg3(d) {
  const k = ((Math.round(d) % 360) + 360) % 360;
  return deg3Cache[k] || (deg3Cache[k] = `${String(k).padStart(3, '0')}°`);
}
const C8 = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const FROM8 = ['с севера', 'с северо-востока', 'с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада'];
const TO8 = ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'];
const sector8 = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;
export const compass8 = (deg) => C8[sector8(deg)];
export const fromWords = (deg) => FROM8[sector8(deg)];
export const toWords = (deg) => TO8[sector8(deg)];

// Wind «from» bearing from the direction the wind blows TOWARDS (x = X, y = Z).
export const windFromDeg = (dirX, dirZ) => bearingDeg(-dirX, -dirZ);

// Beaufort / Douglas (DESIGN §3.13).
const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function beaufortOf(ms) {
  let b = 0;
  for (const v of BEAUFORT) if (ms >= v) b++;
  return b;
}
const DOUGLAS = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
export function douglasOf(Hs) {
  let s = 0;
  for (const b of DOUGLAS) if (Hs > b) s++;
  return Math.min(9, s + 1);
}

// «8 БАЛЛОВ»
export const ballsU = (n) => `${n}${NBSP}${plural(n, 'БАЛЛ', 'БАЛЛА', 'БАЛЛОВ').toUpperCase()}`;

// Escape text for innerHTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Replace "quotes" with «ёлочки» (only straight double quotes).
export function guillemets(s) {
  let open = true;
  return String(s ?? '').replace(/"/g, () => {
    const q = open ? '«' : '»';
    open = !open;
    return q;
  });
}

// Weather preset words (HUD short labels, chapter titles).
export const PRESET_SHORT = {
  calm: 'ШТИЛЬ',
  overcast: 'ПАСМУРНО',
  squall: 'ШКВАЛ',
  storm: 'ШТОРМ',
  nightStorm: 'НОЧНОЙ ШТОРМ',
  fog: 'ТУМАН',
  clearing: 'ПРОЯСНЕНИЕ',
  nightCalm: 'ЛУННАЯ НОЧЬ',
};
export const PRESET_LABEL = {
  calm: 'Утро. Штиль',
  overcast: 'Ветер крепчает',
  squall: 'Шквал',
  storm: 'Шторм',
  nightStorm: 'Ночной шторм',
  fog: 'Туман',
  clearing: 'После шторма. Закат',
  nightCalm: 'Лунная ночь',
};
export const PRESET_SEVERITY = { calm: 0, nightCalm: 0, overcast: 1, fog: 1, clearing: 1, squall: 2, storm: 3, nightStorm: 4 };

// Survivor group words for markers and toasts.
export const GROUP = {
  swimmer: { flir: 'ЧЕЛОВЕК В ВОДЕ', toast: 'в воде', short: 'пловец' },
  raft: { flir: 'ПЛОТ', toast: 'плот', short: 'плот' },
  hull: { flir: 'ЛЮДИ НА КИЛЕ', toast: 'перевёрнутая лодка', short: 'лодка' },
  container: { flir: 'КОНТЕЙНЕР', toast: 'на контейнере', short: 'контейнер' },
  injured: { flir: 'РАНЕНЫЙ', toast: 'раненый в воде', short: 'раненый' },
  deck: { flir: 'ЛЮДИ НА ПАЛУБЕ', toast: 'на палубе', short: 'палуба' },
  wreck: { flir: 'ТОНУЩЕЕ СУДНО', toast: 'тонущее судно', short: 'судно' },
  plane: { flir: 'САМОЛЁТ НА ВОДЕ', toast: 'самолёт на воде', short: 'самолёт' },
};
export const groupOf = (type) => GROUP[type] || GROUP.swimmer;
