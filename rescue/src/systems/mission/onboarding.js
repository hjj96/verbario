// Onboarding glyph hints (DESIGN §3.16): one hint at a time via `mission:hint {text, key}`, each hint
// disappears after it has been performed (usually twice) and is remembered in progress storage.
// Operation 1 also gets the "first 90 seconds" beats (auto take-off after 6 s idle, etc.); later operations
// introduce their mechanic with exactly one glyph, the first moment it is needed.
//
// Event protocol for the HUD:
//   show: mission:hint { key, text, label, keys: ['E'], anchor: 'heli'|'altimeter'|'pad'|'bottom', pulse, show: true }
//   hide: mission:hint { key, text: null, show: false, learned }
// `mission.hint` always mirrors the current one (or null) for polling.
import { keyLabel } from '../../ui/common/keys.js';
import { currentKeys } from '../../core/input.js';

// Per device texts. [X] marks a keycap. anchor: where the HUD may place it (default bottom centre).
// Keyboard caps follow the player's bindings (settings `bindings`, core/input.js REBINDABLE ids):
// `{id}` becomes the keycap of that action's current first key. Gamepad buttons are fixed (input.js PAD).
const HINTS = {
  takeoff: { kb: '[{climb}] Взлёт', pad: '[RT] Взлёт', touch: '[Высота ▲] Взлёт', anchor: 'heli', pulse: true, need: 1, ttl: 0 },
  move: { kb: '[{up}] [{left}] [{down}] [{right}] Полёт', pad: '[Левый стик] Полёт', touch: '[Стик] Полёт', anchor: 'heli', need: 3, ttl: 20 },
  descend: { kb: '[{descend}] Ниже · [{altPreset1}] 15 м', pad: '[LT] Ниже · [↓] 15 м', touch: '[Высота ▼] Ниже, к 15 м', anchor: 'altimeter', need: 1, ttl: 25 },
  winch: { kb: '[{winch}] держать — лебёдка', pad: '[A] держать — лебёдка', touch: '[Лебёдка] держать', need: 1, ttl: 40 },
  land: { kb: 'Сядь в круг посадки', pad: 'Сядь в круг посадки', touch: 'Сядь в круг посадки', anchor: 'pad', need: 1, ttl: 0 },
  deck: { kb: 'Палуба качается — садись, когда горизонт выровняется', anchor: 'pad', need: 1, ttl: 30 },
  raftDrop: { kb: '[{raftDrop}] Сбросить плот — пусть гребут к нему', pad: '[→] Сбросить плот', touch: '[Плот] Сбросить', need: 1, ttl: 20 },
  horn: { kb: '[{horn}] Громкоговоритель — пусть отзовутся', pad: '[Y] Громкоговоритель', touch: '[Рупор] Позвать', need: 1, ttl: 25 },
  searchlight: { kb: '[{searchlight}] Прожектор · наводится мышью', pad: '[X] Прожектор · правый стик', touch: '[Прожектор] Вкл', need: 1, ttl: 25 },
  flare: { kb: '[{flare}] Фальшфейер к курсору', pad: '[B] Фальшфейер', touch: '[Фальшфейер] Бросить', need: 1, ttl: 25 },
  boost: { kb: '[{boost}] Форсаж — уходи от смерча', pad: '[LB] Форсаж', touch: '[Форсаж]', need: 2, ttl: 15, urgent: true },
  climb: { kb: '[{climb}] Вверх! · [{altPreset3}] 90 м', pad: '[RT] Вверх! · [↑] 90 м', touch: '[Высота ▲] Вверх!', need: 1, ttl: 12, urgent: true },
  deckWinch: { kb: 'Высота над палубой: висите в 12–25 м над ней', need: 1, ttl: 30 },
  stretcher: { kb: 'Носилки: 3 с без раскачки — устойчивость ≥ 60 %', need: 1, ttl: 30 },
  map: { kb: '[{map}] Карта — держать', pad: '[View] Карта — держать', touch: 'Карта', need: 1, ttl: 15 },
};

// The cap a hint shows when that key is still among the action's bindings (map is [M, Tab] by default;
// the HUD's key bar says Tab, so does the hint); otherwise the first bound key.
const PREFERRED = { map: 'Tab' };
const ACTION_RE = /\{(\w+)\}/g;

// Keycap label of an action's current key ('—' when the player cleared both slots).
export function actionKey(id) {
  const keys = currentKeys(id) || [];
  const pref = PREFERRED[id];
  return keyLabel(pref && keys.includes(pref) ? pref : keys[0]);
}

// The hint text for the player's last device, keyboard caps resolved from the live bindings.
export function hintText(key, device) {
  const H = HINTS[key];
  if (!H) return '';
  const text = (device === 'gamepad' ? H.pad : device === 'touch' ? H.touch : H.kb) || H.kb;
  // a key bound to [ or ] must not close the [cap] markup early: full-width look-alikes
  return text.replace(ACTION_RE, (_, id) => actionKey(id).replace(/\[/g, '［').replace(/\]/g, '］'));
}

// Higher priority pre-empts a lower one on screen (the pre-empted hint is queued again).
const PRIORITY = { takeoff: 1, move: 1, map: 1, descend: 2, land: 2, deck: 2, horn: 2, searchlight: 2, flare: 2, raftDrop: 3, winch: 3, deckWinch: 3, stretcher: 3, boost: 5, climb: 5 };
const QUEUE_TTL = 8; // s a queued hint stays relevant

const KEY_RE = /\[([^\]]+)\]/g;

export class Onboarding {
  constructor(mission) {
    this.m = mission;
    this.ctx = mission.ctx;
    this.enabled = new Set();
    this.shown = new Set(); // shown during this mission
    this.counts = Object.create(null); // per key: actions performed this mission (before or while shown)
    this.queue = [];
    this.active = null;
    this._tick = 0;
    this._idle = 0;
    this._autoTookOff = false;
    this._moveT = 0;
    this._lightT = 0;
    this._gapT = 0;
  }

  reset(def) {
    if (this.active) this._emitHide(this.active.key, false);
    this.enabled = new Set(def.hints || []);
    this.onboarding = !!def.onboarding;
    this.shown.clear();
    for (const k of Object.keys(this.counts)) delete this.counts[k];
    this.queue.length = 0;
    this.active = null;
    this._tick = 0;
    this._idle = 0;
    this._autoTookOff = false;
    this._moveT = 0;
    this._lightT = 0;
    this._gapT = 0;
  }

  get current() {
    return this.active;
  }

  // ---------------------------------------------------------------------------------------------
  wants(key) {
    return this.enabled.has(key) && !this.m.progress.hintSeen(key) && !this.shown.has(key);
  }

  // Is the hint's goal already met (then it is learned silently, never flashed)?
  _satisfied(key) {
    const H = HINTS[key];
    if ((this.counts[key] || 0) >= H.need) return true;
    const h = this.ctx.heli;
    if (!h) return false;
    const alt = h.altitude ?? 0;
    switch (key) {
      case 'takeoff':
        return !h.landed && alt > 6;
      case 'descend':
        return alt < 30;
      case 'climb':
        return alt > 45;
      case 'searchlight':
        return !!h.searchlight;
      default:
        return false;
    }
  }

  show(key) {
    if (!this.wants(key)) return;
    const H = HINTS[key];
    if (!H) return;
    if (this._satisfied(key)) {
      this.shown.add(key);
      this.m.progress.markHint(key);
      return;
    }
    if (this._gapT > 0 && (PRIORITY[key] || 1) < 5) {
      this._enqueue(key, false); // a short breath between two glyphs
      return;
    }
    const a = this.active;
    if (a) {
      if (a.key === key) return;
      if ((PRIORITY[key] || 1) > (PRIORITY[a.key] || 1)) {
        // pre-empt: the current hint goes back to the queue
        this._emitHide(a.key, false);
        this.shown.delete(a.key);
        this.active = null;
        this._enqueue(a.key, true);
      } else {
        this._enqueue(key, false);
        return;
      }
    }
    this.active = {
      key,
      text: '',
      label: '',
      keys: [],
      anchor: H.anchor || 'bottom',
      pulse: !!H.pulse,
      priority: PRIORITY[key] || 1,
      t0: this.m.elapsed,
      ttl: H.ttl,
      need: H.need,
    };
    this.shown.add(key);
    this._emitShow(this.active);
  }

  // (Re)build the active hint's text for the current device + bindings and send it to the HUD.
  _emitShow(act) {
    const text = hintText(act.key, this.ctx.input?.lastDevice);
    const keys = [];
    let m;
    KEY_RE.lastIndex = 0;
    while ((m = KEY_RE.exec(text))) keys.push(m[1]);
    act.text = text;
    act.label = text.replace(KEY_RE, '').replace(/^\s*[·—]?\s*/, '').trim();
    act.keys = keys;
    this.ctx.events.emit('mission:hint', { key: act.key, text, label: act.label, keys, anchor: act.anchor, pulse: act.pulse, priority: act.priority, show: true });
  }

  // The player switched keyboard ↔ gamepad ↔ touch, or rebound a key: the glyph on screen follows.
  _refresh() {
    const a = this.active;
    if (a && hintText(a.key, this.ctx.input?.lastDevice) !== a.text) this._emitShow(a);
  }

  _enqueue(key, front) {
    if (this.queue.some((q) => q.key === key)) return;
    const q = { key, t: this.m.elapsed };
    if (front) this.queue.unshift(q);
    else this.queue.push(q);
  }

  // An action belonging to a hint was performed.
  did(key, n = 1) {
    this.counts[key] = (this.counts[key] || 0) + n;
    const a = this.active;
    if (a && a.key === key && this.counts[key] >= a.need) this._finish(true);
  }

  _finish(learned) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (learned) this.m.progress.markHint(a.key);
    this._emitHide(a.key, learned);
    this._gapT = 0.7;
  }

  // Show the most important queued hint that is still relevant.
  _drainQueue() {
    // drop hints whose moment has passed or that were learned meanwhile
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.m.elapsed - q.t > QUEUE_TTL || this.m.progress.hintSeen(q.key)) this.queue.splice(i, 1);
    }
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      if (best < 0 || (PRIORITY[this.queue[i].key] || 1) > (PRIORITY[this.queue[best].key] || 1)) best = i;
    }
    if (best < 0) return;
    const q = this.queue.splice(best, 1)[0];
    this.shown.delete(q.key);
    this.show(q.key);
  }

  _emitHide(key, learned) {
    this.ctx.events.emit('mission:hint', { key, text: null, show: false, learned: !!learned });
  }

  hideAll() {
    if (this.active) this._emitHide(this.active.key, false);
    this.active = null;
    this.queue.length = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Events forwarded by Mission.
  onEvent(name, p) {
    switch (name) {
      case 'heli:takeoff':
        this.did('takeoff');
        break;
      case 'heli:pickup': {
        this.did('winch');
        this.did('deckWinch');
        const s = p && p.survivor;
        if (s && (s.type === 'injured' || s.priority)) this.did('stretcher');
        break;
      }
      case 'heli:land':
        this.did('land');
        if (p && p.pad && p.pad.type === 'ship') this.did('deck');
        break;
      case 'heli:raft-drop':
        this.did('raftDrop');
        break;
      case 'heli:loudspeaker':
        this.did('horn');
        break;
      case 'heli:flare':
        this.did('flare');
        break;
      case 'heli:searchlight':
        if (p && p.on) this.did('searchlight');
        break;
      case 'hazard:warning':
        if (p && p.type === 'rogue') this.show('climb');
        if (p && (p.type === 'waterspout' || p.type === 'tornado')) this.show('boost');
        break;
      default:
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Called every frame in play. Cheap input checks every frame; world triggers at ~4 Hz.
  update(dt) {
    const ctx = this.ctx;
    const heli = ctx.heli;
    const input = ctx.input;
    if (!heli || !input) return;
    const t = this.m.elapsed;

    // Inputs that count as "performed"
    const moving = Math.hypot(input.axis('moveX'), input.axis('moveY')) > 0.25;
    if (moving && !heli.landed) {
      this._moveT += dt;
      if (this._moveT >= 1) {
        this._moveT -= 1;
        this.did('move');
      }
    }
    if (input.pressed('winch')) this.did('winch', 0.34); // ~3 presses also count as learned
    if (input.pressed('boost')) this.did('boost');
    if (input.pressed('map')) this.did('map');
    if (input.pressed('altPreset3')) this.did('climb');
    if (input.pressed('altPreset1')) this.did('descend');
    if (heli.searchlight) {
      this._lightT += dt;
      if (this._lightT > 0.8 && !this.counts.searchlight) this.did('searchlight');
    }

    // Operation 1: take off by itself after 6 s without input (no soft-lock).
    if (this.active && this.active.key === 'takeoff') {
      const idle = Math.abs(input.axis('lift')) < 0.1 && !moving;
      this._idle = idle ? this._idle + dt : 0;
      if (this._idle >= 6 && !this._autoTookOff) {
        this._autoTookOff = true;
        heli.autoTakeoff?.(40);
      }
      if (!heli.landed && (heli.altitude ?? 0) > 6) this.did('takeoff');
    }

    // Active hint timeouts (hidden without being learned — it may come back in a later operation)
    const a = this.active;
    if (a) {
      if (a.key === 'descend' && (heli.altitude ?? 99) < 30) this.did('descend');
      else if (a.key === 'climb' && (heli.altitude ?? 0) > 45) this.did('climb');
      else if (a.ttl > 0 && t - a.t0 > a.ttl) this._finish(false);
    }

    // World triggers (≈4 Hz), then the queue: a higher-priority glyph raised this tick wins the slot.
    this._tick -= dt;
    if (this._tick <= 0) {
      this._tick = 0.25;
      if (this.enabled.size) this._triggers(t, heli);
      this._refresh();
    }
    if (this._gapT > 0) this._gapT -= dt;
    else if (!this.active && this.queue.length) this._drainQueue();
  }

  _triggers(t, heli) {
    const ctx = this.ctx;
    const hx = heli.position.x;
    const hz = heli.position.z;
    const alt = heli.altitude ?? heli.position.y;
    const airborne = !heli.landed && alt > 6;

    if (this.wants('takeoff') && heli.landed && t >= 3) this.show('takeoff');
    if (this.wants('move') && airborne && t >= 8) this.show('move');

    const list = ctx.survivors?.list || [];
    let nearSpotted = Infinity;
    let nearSpottedS = null;
    let nearHidden = Infinity;
    let openSpotted = 0;
    let openGroups = 0;
    let swimmersSpotted = 0;
    for (const s of list) {
      if (!s || !s.position) continue;
      const st = s.state;
      if (st === 'rescued' || st === 'lost') continue;
      openGroups++;
      const d = Math.hypot(s.position.x - hx, s.position.z - hz);
      if (s.spotted || st === 'spotted' || st === 'winching') {
        openSpotted++;
        if (s.type === 'swimmer' && d < 150) swimmersSpotted++;
        if (d < nearSpotted) {
          nearSpotted = d;
          nearSpottedS = s;
        }
      } else if (d < nearHidden) nearHidden = d;
    }

    if (this.wants('descend') && openSpotted && airborne && alt > 32 && nearSpotted < 400) this.show('descend');
    if (this.wants('winch') && nearSpotted < 20 && alt >= 8 && alt <= 30) this.show('winch');
    if (this.wants('deckWinch') && nearSpottedS && (nearSpottedS.type === 'deck' || nearSpottedS.type === 'wreck') && nearSpotted < 150) this.show('deckWinch');
    if (this.wants('stretcher') && nearSpottedS && (nearSpottedS.type === 'injured' || nearSpottedS.priority) && nearSpotted < 150) this.show('stretcher');
    if (this.wants('raftDrop') && swimmersSpotted >= 2 && (heli.rafts ?? 1) > 0) this.show('raftDrop');
    if (this.wants('horn') && nearHidden < 200 && airborne) this.show('horn');
    if (this.wants('searchlight') && airborne && !heli.searchlight) {
      const w = ctx.weather?.state;
      if ((w && (w.night > 0.5 || w.preset === 'fog') && t >= 6) || t >= 25) this.show('searchlight');
    }
    if (this.wants('flare') && airborne && t >= 45 && nearHidden < 400 && (heli.flares ?? 1) > 0) this.show('flare');
    if (this.wants('map') && airborne && t >= 60) this.show('map');

    const cabin = heli.cabin ? heli.cabin.length : 0;
    if (cabin > 0 && airborne) {
      const full = cabin >= (heli.capacity || 6);
      const pad = ctx.world?.nearestPad?.(hx, hz);
      const dPad = pad ? Math.hypot(pad.position.x - hx, pad.position.z - hz) : Infinity;
      if (this.wants('land') && (full || !openGroups || (heli.fuel ?? 1) < 0.35 || dPad < 250)) this.show('land');
      if (this.wants('deck') && pad && pad.type === 'ship' && dPad < 250) this.show('deck');
    }
  }
}
