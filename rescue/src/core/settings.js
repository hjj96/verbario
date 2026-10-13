// Persistent player settings (localStorage, guarded — the game must work without storage).
const KEY = 'mayday.settings.v1';

const DEFAULTS = {
  quality: 'high', // 'low' | 'medium' | 'high'
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  radioVolume: 0.9,
  envVolume: 0.9, // weather & sea
  uiVolume: 0.8,
  alarms: true, // audible warnings
  reduceFlashes: false, // accessibility: dims lightning flashes and strobes (DESIGN §2.8, §7.8)
  reduceMotion: false, // no radar sweep, toast slide-in, glitch text, lens drops
  textScale: 1, // 1 | 1.25 | 1.5
  hudScale: 1, // 0.8 .. 1.3
  vibration: 1, // gamepad rumble 0..1
  assist: 'standard', // 'full' | 'standard' | 'off' — flight stabilisation (DESIGN §3.3)
  difficulty: 'pilot', // 'cadet' | 'pilot' | 'ace' (DESIGN §3.17)
  seenFlashWarning: false,
  screenShake: 1, // 0..1
  colorblindMarkers: false, // adds shapes to colour-coded markers
  subtitles: true,
  invertLift: false,
  showFps: false,
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch {
      /* storage unavailable — defaults are fine */
    }
    if (!localStorageHas(KEY) && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.values.reduceFlashes = true;
      this.values.reduceMotion = true;
    }
    if (!localStorageHas(KEY) && matchMedia?.('(pointer: coarse)').matches) this.values.quality = 'low';
    const q = new URLSearchParams(location.search).get('quality');
    if (q && ['low', 'medium', 'high'].includes(q)) this.values.quality = q;
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  pixelRatioCap() {
    return { low: 1, medium: 1.25, high: 2 }[this.values.quality] || 1.5;
  }

  // Convenience: multiplier for particle counts / shader detail.
  detail() {
    return { low: 0.35, medium: 0.65, high: 1 }[this.values.quality] || 1;
  }
}

function localStorageHas(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

// Small persistent progress store (unlocked missions, medals, best scores).
const PROGRESS_KEY = 'mayday.progress.v1';
export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}
export function saveProgress(data) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
