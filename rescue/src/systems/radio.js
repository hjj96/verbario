// Radio chatter (CONTRACT «radio»; DESIGN §5, §7.5): the line catalogue, the queue and its rules, and
// the triggers that make the crew, «Берег», ships and survivors talk (radio/triggers.js).
//
// Queue rules (DESIGN §5):
//   · priority 3 — critical, interrupts a priority-1 line; 2 — gameplay; 1 — flavour, only after 12 s of
//     silence on the channel;
//   · a line id is not repeated within 300 s (per-line cooldowns in radio/catalogue.js — shorter for
//     gameplay confirmations; the mission director's own lines with ids are de-duplicated the same way);
//   · one voice on the channel at a time, a short breath between lines — so at most 2 lines are on screen;
//   · stale lines expire in the queue (each line has a max age).
// The HUD types every line at 22 ms per character; the audio engine schedules the vowel-formant
// «babble» on the same clock (a syllable per typed vowel), so `duration` = characters × 22 ms.
//
// Emits radio:line {speaker, name, channel, text, duration, priority, id,
//                   voice /*audio f0 hint*/, fx /*'megaphone'|null*/, interference /*0..1*/}.
// Public beyond the contract: history (last 120 emitted lines, for tests/pause log), dropped (debug),
// queue, speaking, silence, clear(), stats().
import { LINES, SPEAKER_DEFAULTS, voiceOf } from './radio/catalogue.js';
import { fill } from './radio/words.js';
import { RadioTriggers } from './radio/triggers.js';

const CHAR_S = 0.022; // HUD typing speed (DESIGN §7.5)
const FLAVOUR_SILENCE = 12; // priority-1 lines only after this much silence
const GAP = 0.7; // breath between two lines (s)
const DEFAULT_COOLDOWN = 300;
const MAX_AGE = [0, 40, 15, 20]; // by priority
const HISTORY = 120;
const SPEAKERS = new Set(['dispatch', 'pilot', 'winchman', 'survivor', 'ship', 'coastguard', 'rescuer']);

export class Radio {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = [];
    this.history = []; // {t, id, speaker, name, channel, priority, text}
    this.dropped = []; // {t, id, reason} (debug)
    this.clock = 0; // radio time: freezes while paused
    this.busyUntil = -1; // the channel is occupied until this clock time (typing)
    this.lastEnd = -1e9; // clock time the last line finished typing
    this.current = null; // last emitted line
    this._cool = new Map(); // id → clock of the last time it was queued/said
    this._seq = 0;
    this.triggers = new RadioTriggers(this);
  }

  init() {
    this.triggers.init();
  }

  get speaking() {
    return this.clock < this.busyUntil;
  }

  // seconds of silence on the channel (0 while someone is talking)
  get silence() {
    return this.speaking ? 0 : this.clock - this.lastEnd;
  }

  // ---------------------------------------------------------------------------------------------
  // CONTRACT: radio.say(speaker, text, {priority, duration, name, channel, id})
  // Extras: cooldown (s), maxAge (s), delay (s), transient (emit now or never — winch patter),
  //         immediate (bypass the queue — the loudspeaker), voice, fx, pos {x, z} (survivor's set).
  say(speaker, text, opts = {}) {
    if (!text) return false;
    speaker = SPEAKERS.has(speaker) ? speaker : 'dispatch';
    const id = opts.id || null;
    const base = id ? String(id).replace(/-\d+$/, '') : null;
    const entry = base ? LINES[base] : null;
    const cd = opts.cooldown ?? entry?.cd ?? DEFAULT_COOLDOWN;
    if (id) {
      const last = this._cool.get(id);
      if (last !== undefined && this.clock - last < cd) return this._drop(id, 'repeat');
      if (this.queue.some((q) => q.id === id)) return this._drop(id, 'queued');
    }
    const priority = Math.max(1, Math.min(3, Math.round(opts.priority ?? entry?.p ?? 1)));
    const def = SPEAKER_DEFAULTS[speaker] || SPEAKER_DEFAULTS.dispatch;
    const item = {
      seq: this._seq++,
      speaker,
      text: String(text),
      name: opts.name || entry?.n || def.n,
      channel: opts.channel || entry?.ch || def.ch,
      priority,
      id,
      voice: opts.voice || voiceOf(speaker, entry),
      fx: opts.fx || entry?.fx || null,
      duration: opts.duration,
      pos: opts.pos || null,
      t: this.clock,
      due: this.clock + Math.max(0, opts.delay || 0),
      maxAge: (opts.maxAge ?? entry?.age ?? MAX_AGE[priority]) + Math.max(0, opts.delay || 0),
      prevCool: id ? this._cool.get(id) : undefined,
    };
    if (opts.immediate) {
      if (id) this._cool.set(id, this.clock);
      this._emit(item);
      return true;
    }
    if (opts.transient) {
      // only if the channel is free right now (the patter must be live, never queued)
      if (this.speaking || this.clock - this.lastEnd < 0.25) return this._drop(id, 'busy');
      if (id) this._cool.set(id, this.clock);
      this._emit(item);
      return true;
    }
    if (id) this._cool.set(id, this.clock);
    this.queue.push(item);
    return true;
  }

  // CONTRACT: radio.line(id, vars) — a catalogue line with template vars; opts as in say().
  line(id, vars = {}, opts = {}) {
    const entry = LINES[id];
    if (!entry) return false;
    return this.say(entry.s, fill(entry.t, vars), { ...opts, id: opts.id || id });
  }

  clear() {
    this.queue.length = 0;
    this.busyUntil = this.clock;
  }

  stats() {
    return { queued: this.queue.length, said: this.history.length, speaking: this.speaking, silence: this.silence, clock: this.clock };
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const mode = this.ctx.mode;
    if (mode === 'paused') return; // the channel freezes with the game
    this.clock += dt || 0;
    if (mode === 'title' || mode === 'briefing') {
      if (this.queue.length) this.queue.length = 0;
      return;
    }
    if (mode === 'play') this.triggers.update(dt || 0);
    if (mode === 'play' || mode === 'debrief') this._pump();
  }

  _pump() {
    const q = this.queue;
    if (!q.length) return;
    const now = this.clock;
    // stale lines leave the queue (their cooldown is restored so they may come back later)
    for (let i = q.length - 1; i >= 0; i--) {
      const it = q[i];
      if (now - it.t > it.maxAge) {
        q.splice(i, 1);
        if (it.id) {
          if (it.prevCool === undefined) this._cool.delete(it.id);
          else this._cool.set(it.id, it.prevCool);
        }
        this._drop(it.id, 'stale');
      }
    }
    // best due line: highest priority, then oldest
    let best = null;
    for (const it of q) {
      if (it.due > now) continue;
      if (!best || it.priority > best.priority || (it.priority === best.priority && it.seq < best.seq)) best = it;
    }
    if (!best) return;
    if (this.speaking) {
      // priority 3 interrupts flavour
      if (!(best.priority === 3 && this.current && this.current.priority === 1)) return;
    } else {
      const sil = now - this.lastEnd;
      if (sil < GAP) return;
      if (best.priority === 1 && sil < FLAVOUR_SILENCE) return;
    }
    q.splice(q.indexOf(best), 1);
    this._emit(best);
  }

  _emit(item) {
    const typing = item.text.length * CHAR_S;
    this.current = item;
    this.busyUntil = this.clock + typing;
    this.lastEnd = this.busyUntil;
    const payload = {
      speaker: item.speaker,
      name: item.name,
      channel: item.channel,
      text: item.text,
      duration: item.duration || typing,
      priority: item.priority,
      id: item.id,
      voice: item.voice,
      fx: item.fx,
      interference: this.triggers.interferenceFor(item),
    };
    this.history.push({ t: Math.round(this.clock * 10) / 10, id: item.id, speaker: item.speaker, name: item.name, channel: item.channel, priority: item.priority, text: item.text });
    if (this.history.length > HISTORY) this.history.shift();
    this.ctx.events.emit('radio:line', payload);
  }

  _drop(id, reason) {
    this.dropped.push({ t: Math.round(this.clock * 10) / 10, id, reason });
    if (this.dropped.length > 60) this.dropped.shift();
    return false;
  }
}
