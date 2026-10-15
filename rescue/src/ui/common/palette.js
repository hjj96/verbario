// HUD colour tokens shared by CSS (custom properties on the HUD root) and the canvases (DESIGN §2.14,
// §7.3 «Ночь и цвет»). Categories are ALWAYS also told apart by shape: ◆ people, ○H pads, ▲ hazards.
// Orange is never used on hazards.

export const BASE = {
  fg: '#E8E4D8',
  rescue: '#FF5A1F', // people, main action — ◆
  nav: '#56B4E9', // pads, home, course — ○H
  hazard: '#D67AD9', // spouts, waves, storm cells — ▲
  wind: '#BFE6FF',
  info: '#8FD3E0',
  ok: '#7CF2A8',
  warn: '#FFC24B',
  danger: '#FF3B30',
};

// High-distinguishability set for colourblind players (settings.colorblindMarkers).
export const COLORBLIND = { rescue: '#FFB000', nav: '#2FA8FF', hazard: '#C86CFF' };

export const NIGHT_AMBER = '#FFB547';

// Paper register (menus, briefing, logbook).
export const PAPER = {
  paper: '#F3E9D6',
  ink: '#12212B',
  orange: '#FF5A1F',
  yellow: '#F5D547',
  stamp: '#C8102E',
  bronze: '#C8814A',
  silver: '#C9D3DA',
  gold: '#FFD36A',
  cold: '#2E6BD6',
  warm: '#E5322D',
  occl: '#8A4FBF',
};

const hex2rgb = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgb2hex = (r, g, b) => '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
export const mixHex = (a, b, t) => {
  const A = hex2rgb(a);
  const B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
export const rgba = (hex, a) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// Live palette object the canvases read every frame (mutated in place, no allocation per frame).
export class HudPalette {
  constructor() {
    this.fg = BASE.fg;
    this.dim = rgba(BASE.fg, 0.45);
    this.faint = rgba(BASE.fg, 0.22);
    this.rescue = BASE.rescue;
    this.nav = BASE.nav;
    this.hazard = BASE.hazard;
    this.wind = BASE.wind;
    this.info = BASE.info;
    this.ok = BASE.ok;
    this.warn = BASE.warn;
    this.danger = BASE.danger;
    this.shadow = 'rgba(0,0,0,0.65)';
    this.night = 0; // 0..1 amber amount (quantised)
    this.haze = 0; // 0..1 bright-scene legibility boost (quantised)
    this.colorblind = false;
    this.version = 0; // bumps when anything changes (cached backgrounds redraw)
  }

  // night: 0..1 (weather.state.night), quantised to 10 steps so CSS/caches update rarely.
  // haze: 0..1 how bright and flat the scene behind the HUD is (thick daylight fog): the light,
  // semi-transparent «dim»/«faint» text vanishes over a pale grey frame, so it gains opacity and a
  // tighter dark halo, and the panels get a soft scrim (CSS --haze) — quantised the same way.
  apply(night, colorblind, haze = 0) {
    const n = Math.round(Math.max(0, Math.min(1, (night - 0.55) / 0.15)) * 10) / 10;
    const z = Math.round(Math.max(0, Math.min(1, haze)) * 10) / 10;
    if (n === this.night && colorblind === this.colorblind && z === this.haze) return false;
    this.night = n;
    this.colorblind = colorblind;
    this.haze = z;
    const fg = mixHex(BASE.fg, NIGHT_AMBER, n);
    this.fg = fg;
    this.dim = rgba(fg, 0.45 + 0.4 * z);
    this.faint = rgba(fg, 0.22 + 0.3 * z);
    this.shadow = `rgba(0,0,0,${0.65 + 0.25 * z})`;
    this.wind = mixHex(BASE.wind, NIGHT_AMBER, n * 0.55);
    this.info = mixHex(BASE.info, NIGHT_AMBER, n * 0.4);
    const C = colorblind ? COLORBLIND : BASE;
    this.rescue = C.rescue;
    this.nav = C.nav;
    this.hazard = C.hazard;
    this.version++;
    return true;
  }

  // CSS custom properties for the HUD root.
  cssVars() {
    return {
      '--hud-fg': this.fg,
      '--hud-dim': this.dim,
      '--hud-faint': this.faint,
      '--rescue': this.rescue,
      '--nav': this.nav,
      '--hazard': this.hazard,
      '--wind': this.wind,
      '--info': this.info,
      '--haze': String(this.haze),
      // tight dark halo first (reads over a pale frame), then the soft documentary glow
      '--tsh': this.haze ? `0 0 1px rgba(4,10,14,${0.9 * this.haze}), 0 0 3px rgba(4,10,14,${0.7 * this.haze}), 0 0 6px rgba(0,0,0,.65)` : '0 0 6px rgba(0, 0, 0, .65)',
    };
  }
}
