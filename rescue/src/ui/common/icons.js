// Inline SVG icons for both UI registers: weather pictograms (operation cards, briefing conditions),
// WMO-style forecast symbols (briefing forecast strip, pause), lifebuoy medal rings, difficulty waves,
// lock, keycaps. Everything is stroke = currentColor so the same icon works on ink and on the dark HUD.

const svg = (body, size = 20, vb = 20, extra = '') =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

const CLOUD = 'M5.5 13.5h9a3 3 0 0 0 .3-6 4.3 4.3 0 0 0-8.3-.6A3.3 3.3 0 0 0 5.5 13.5z';
const BOLT = '<path d="M10.5 12.5l-2 3.5h3l-2 3.5" />';
const MOON = '<path d="M12.8 3.6a6 6 0 1 0 3.6 8.6 5 5 0 0 1-3.6-8.6z" />';

// Weather pictograms per preset (DESIGN §2.3 names).
export const WEATHER_ICON = {
  calm: svg('<circle cx="10" cy="11" r="3.4"/><path d="M10 3.5v2M3.5 11h2M14.5 11h2M5.4 6.4l1.4 1.4M14.6 6.4l-1.4 1.4M3 16.5h14"/>'),
  overcast: svg(`<path d="${CLOUD}"/><path d="M4 16.5h12" opacity=".6"/>`),
  squall: svg(`<path d="${CLOUD}"/><path d="M6.5 15.5l-1.2 2.5M9.7 15.5l-1.2 2.5M12.9 15.5l-1.2 2.5"/><path d="M15.5 3.8c1.6 0 2.3.9 2 2" opacity=".7"/>`),
  storm: svg(`<path d="${CLOUD}"/>${BOLT}<path d="M5.5 15.5l-1 2M14.5 15.5l-1 2" opacity=".7"/>`),
  nightStorm: svg('<path d="M7.6 2.6a3.8 3.8 0 1 0 4 5.2 3.2 3.2 0 0 1-4-5.2z"/><path d="M7 15h8.5a2.6 2.6 0 0 0 .2-5.2 3.8 3.8 0 0 0-7.3-.5A2.9 2.9 0 0 0 7 15z"/><path d="M11.5 15.5l-1.6 2.6h2.4l-1.4 2"/>'),
  fog: svg('<path d="M3 7h11M6 10.5h11M3 14h11M7 17.5h8"/>'),
  clearing: svg('<path d="M4.5 14a5.5 5.5 0 0 1 11 0"/><path d="M10 4.5v2M3.6 8.6l1.3 1M16.4 8.6l-1.3 1M2.5 14h15M5 17h10" /><path d="M1.5 4.5h4" opacity=".55"/>'),
  nightCalm: svg(`${MOON}<path d="M4.5 4.2v2M3.5 5.2h2" opacity=".7"/><path d="M3 17h14" opacity=".5"/>`),
};

// WMO-style present/forecast weather symbols (ink drawing for the briefing strip).
export const WMO = {
  calm: svg('<circle cx="10" cy="10" r="5.5"/>', 22),
  overcast: svg('<circle cx="10" cy="10" r="5.5" fill="currentColor"/>', 22),
  squall: svg('<path d="M5 5.5l5 9 5-9" /><path d="M5 5.5h10" opacity=".0"/>', 22),
  storm: svg('<path d="M6 16V4.5h7"/><path d="M13 4.5l-3 4.5h3.5l-3 5.5"/><path d="M10.5 14.5l-.3-2.3 2 1z" fill="currentColor"/>', 22),
  nightStorm: svg('<path d="M5 16V4.5h7"/><path d="M12 4.5l-3 4.5h3.5l-3 5.5"/><circle cx="16" cy="15" r="1.5" fill="currentColor"/>', 22),
  fog: svg('<path d="M4 6.5h12M4 10h12M4 13.5h12"/>', 22),
  clearing: svg('<circle cx="10" cy="10" r="5.5"/><path d="M10 4.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>', 22),
  nightCalm: svg('<circle cx="10" cy="10" r="5.5"/><path d="M8.6 7.2a3 3 0 1 0 3.6 4.2 2.4 2.4 0 0 1-3.6-4.2z" fill="currentColor" stroke="none"/>', 22),
};

// Lifebuoy medal ring (DESIGN §7.2): bronze #C8814A, silver #C9D3DA, gold #FFD36A, empty = outline.
export const MEDAL_COLOR = { bronze: '#C8814A', silver: '#C9D3DA', gold: '#FFD36A', cross: '#C8102E' };
export function medalRing(kind, got, size = 22) {
  if (!got) {
    return svg('<circle cx="10" cy="10" r="7" stroke-width="1.3"/><circle cx="10" cy="10" r="3.6" stroke-width="1.1" opacity=".7"/>', size, 20, ' data-medal="empty"');
  }
  const c = MEDAL_COLOR[kind] || MEDAL_COLOR.bronze;
  if (kind === 'cross') {
    return svg(`<circle cx="10" cy="10" r="8" fill="${c}" stroke="#12212B" stroke-width="1"/><path d="M10 5.2v9.6M5.2 10h9.6" stroke="#F3E9D6" stroke-width="2.6" stroke-linecap="butt"/>`, size);
  }
  // ring body + four white rope bands, ink outline
  return svg(
    `<circle cx="10" cy="10" r="5.4" stroke="${c}" stroke-width="4.2"/>` +
      `<path d="M10 2.4v3.2M10 14.4v3.2M2.4 10h3.2M14.4 10h3.2" stroke="#F7F1E4" stroke-width="2" stroke-linecap="butt"/>` +
      `<circle cx="10" cy="10" r="7.6" stroke="#12212B" stroke-width=".9"/><circle cx="10" cy="10" r="3.2" stroke="#12212B" stroke-width=".9"/>`,
    size,
    20,
    ` data-medal="${kind}"`,
  );
}

// Difficulty waves 1–5.
export function waves(n, max = 5) {
  let s = '<span class="waves" aria-label="Сложность ' + n + ' из ' + max + '">';
  for (let i = 0; i < max; i++) {
    s += `<svg class="wave${i < n ? ' on' : ''}" width="14" height="9" viewBox="0 0 14 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6c2-3.2 4-3.2 6 0s4 3.2 6 0"/></svg>`;
  }
  return s + '</span>';
}

export const LOCK = svg('<rect x="4.5" y="9" width="11" height="8" rx="1"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/><path d="M10 12v2"/>', 22);
export const PAD_H = svg('<circle cx="10" cy="10" r="7.5"/><path d="M7.2 6.5v7M12.8 6.5v7M7.2 10h5.6"/>', 16);
export const STAR = svg('<path d="M10 2.8l2.1 4.5 4.9.6-3.6 3.3 1 4.8L10 13.6 5.6 16l1-4.8L3 7.9l4.9-.6z"/>', 16);
export const HELI = svg('<path d="M3 6.5h14M10 6.5v2.5"/><path d="M6.5 11.5c0-1.6 1.6-2.5 3.5-2.5s4.5.9 4.5 2.5-2.5 2.5-4.5 2.5-3.5-.9-3.5-2.5z"/><path d="M14.5 11.5h3.5M18 10v3"/>', 18);

// Keycap HTML for a key label («E», «Пробел», «ЛКМ»).
export const keycap = (label) => `<kbd class="cap${label.length > 2 ? ' wide' : ''}">${label}</kbd>`;

// Replace [X] tokens in a hint string with keycaps.
export function withKeycaps(text) {
  const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let out = '';
  let last = 0;
  const re = /\[([^\]]+)\]/g;
  const s = String(text || '');
  let m;
  while ((m = re.exec(s))) {
    out += e(s.slice(last, m.index)) + keycap(e(m[1]));
    last = re.lastIndex;
  }
  return out + e(s.slice(last));
}
