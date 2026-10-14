// One-shot sound library (DESIGN §6.4 winch hits, §6.6 UI & world). Every sound is a short-lived voice
// from the pool (≤ 24, stolen by priority); positional ones use the emitter law at their start, and the
// long ones (a burning flare) are re-panned at 20 Hz.
//
// UI: hover 2400 Hz 18 ms; confirm = click + 1320 → 1760 Hz; back 1320 → 880; pause «radio tuning»
// (BP 3000 → 800 + 90 Hz hum); teletype 2 ms of noise per 2nd character; typewriter key; logbook stamp
// (60 Hz thump); objective arpeggio D5–F#5–A5; «человек на борту» glass bell a scale step higher per
// occupant; unload chimes; screen-transition static.
// World: hit (white 30 ms + modal 200–380 Hz through a clip), crash sequence, flare pop + 40 s crackle,
// searchlight relay «ка-чанк» (+ 100/200 Hz hum while on), landing thump 70 → 45 Hz, refuel pump 50 Hz
// with gurgle + «динь» when full, survivor whistle 3.2 kHz with a 25 Hz trill, shouts, a barking dog,
// Arktur horn (saws 98 + 147 Hz), lighthouse foghorn (116 Hz 2.2 s → 98 Hz), loudspeaker chirp, raft
// throw + CO₂ hiss, ignition ticks, survivor rockets, St. Elmo buzz, hull creak, bubbles, chapter boom.
import { dB, clamp, midiHz, clipCurve, crackleBuffer, bubbleBuffer } from './dsp.js';
import { ctl, emitterLaw } from './graph.js';

// D dorian from D5 — the «on board» bell climbs one step per person (DESIGN §6.6)
const BELL_STEPS = [74, 76, 77, 79, 81, 83, 84, 86, 88];
const MODES = [1, 2.76, 5.4, 8.93]; // basket modal partials (DESIGN §6.4)

export class Sfx {
  constructor(eng) {
    this.eng = eng;
    this.tracked = []; // positional voices re-panned at 20 Hz: {v, x, z, pan, lp, g, base}
    this._law = { pan: 0, gain: 0, lpf: 0, d: 0 };
    this.pump = null;
    this.hum = null;
  }

  get ac() {
    return this.eng.ac;
  }

  // Generic voice with an output gain (and an optional pan) into `dest`.
  _shot(prio, tag, dest, level, pan, build) {
    const e = this.eng;
    const ac = e.ac;
    return e.voices.start(prio, (v) => {
      const out = v.n(ac.createGain());
      out.gain.value = level;
      if (pan) {
        const p = v.n(ac.createStereoPanner());
        p.pan.value = pan;
        out.connect(p).connect(dest);
      } else out.connect(dest);
      v.out = out;
      build(v, out, ac.currentTime + 0.005);
    }, tag);
  }

  // Positional voice: out → LP (distance) → pan → dest, using the emitter law.
  _pos(prio, tag, x, z, level, build, opts = {}) {
    const e = this.eng;
    const ac = e.ac;
    const p = e.ctx.heli?.position;
    const L = emitterLaw(p ? x - p.x : 0, p ? z - p.z : 0, e.ctx.weather?.state?.rain || 0, this._law);
    const g = level * Math.min(1, L.gain * (opts.carry || 1));
    if (g < 0.0015) return null;
    let rec = null;
    const v = e.voices.start(prio, (vv) => {
      const out = vv.n(ac.createGain());
      out.gain.value = g;
      const lp = vv.n(ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(opts.minLp || 400, L.lpf);
      const pn = vv.n(ac.createStereoPanner());
      pn.pan.value = L.pan;
      out.connect(lp).connect(pn).connect(opts.dest || e.mix.bus.world);
      if (opts.wet) {
        const w = vv.n(ac.createGain());
        w.gain.value = opts.wet;
        pn.connect(w).connect(e.mix.send);
      }
      vv.out = out;
      if (opts.track) rec = { v: vv, x, z, pan: pn, lp, g: out, base: level, carry: opts.carry || 1, minLp: opts.minLp || 400 };
      build(vv, out, ac.currentTime + 0.005);
    }, tag);
    if (v && rec) this.tracked.push(rec);
    return v;
  }

  track20(now) {
    const e = this.eng;
    const p = e.ctx.heli?.position;
    if (!p) return;
    const rain = e.ctx.weather?.state?.rain || 0;
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      const r = this.tracked[i];
      if (r.v.dead || !e.voices.active.includes(r.v)) {
        this.tracked.splice(i, 1);
        continue;
      }
      const L = emitterLaw(r.x - p.x, r.z - p.z, rain, this._law);
      ctl(r.pan.pan, L.pan, now, 0.08);
      ctl(r.lp.frequency, Math.max(r.minLp, L.lpf), now, 0.1);
      ctl(r.g.gain, r.base * Math.min(1, L.gain * r.carry), now, 0.1);
    }
  }

  // ---- building blocks -------------------------------------------------------------------------
  _osc(v, dest, type, f0, f1, t, dur, a = 0.005, level = 1, wave = null) {
    const ac = this.ac;
    const o = v.n(ac.createOscillator());
    if (wave) o.setPeriodicWave(wave);
    else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = v.n(ac.createGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + a);
    g.gain.setTargetAtTime(0, t + Math.max(a, dur * 0.35), dur * 0.3);
    o.connect(g).connect(dest);
    v.play(o, t, t + dur + 0.05);
    return { o, g };
  }

  _noise(v, dest, color, type, f0, f1, q, t, dur, a = 0.003, level = 1) {
    const ac = this.ac;
    const s = v.n(ac.createBufferSource());
    s.buffer = this.eng.buf[color];
    const f = v.n(ac.createBiquadFilter());
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = v.n(ac.createGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + a);
    g.gain.setTargetAtTime(0, t + Math.max(a, dur * 0.3), dur * 0.3);
    s.connect(f).connect(g).connect(dest);
    v.play(s, t, t + dur + 0.1);
    return { s, f, g };
  }

  _modal(v, dest, f0, t, dur, level = 1) {
    for (let i = 0; i < MODES.length; i++) this._osc(v, dest, 'sine', f0 * MODES[i], 0, t, dur / (1 + i * 0.7), 0.002, level / (1 + i * 1.3));
  }

  _bell(v, dest, midi, t, level = 1, dur = 2.4) {
    const f = midiHz(midi);
    // glassy: fundamental + inharmonic partials
    this._osc(v, dest, 'sine', f, 0, t, dur, 0.003, level);
    this._osc(v, dest, 'sine', f * 2.01, 0, t, dur * 0.6, 0.003, level * 0.35);
    this._osc(v, dest, 'sine', f * 3.98, 0, t, dur * 0.35, 0.002, level * 0.18);
    this._osc(v, dest, 'sine', f * 5.43, 0, t, dur * 0.2, 0.002, level * 0.08);
  }

  // ---- UI ----------------------------------------------------------------------------------------
  hover() {
    this._shot(0, 'ui', this.eng.mix.bus.ui, dB(-32), 0, (v, out, t) => this._osc(v, out, 'sine', 2400, 0, t, 0.018, 0.002));
  }
  confirm() {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-30), 0, (v, out, t) => {
      this._noise(v, out, 'white', 'highpass', 3000, 0, 0.7, t, 0.006, 0.001, 0.8);
      this._osc(v, out, 'triangle', 1320, 1760, t + 0.01, 0.09, 0.004, 0.9);
    });
  }
  back() {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-30), 0, (v, out, t) => this._osc(v, out, 'triangle', 1320, 880, t, 0.1, 0.004));
  }
  deny() {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-30), 0, (v, out, t) => {
      this._osc(v, out, 'square', 330, 0, t, 0.06, 0.003, 0.5);
      this._osc(v, out, 'square', 262, 0, t + 0.08, 0.08, 0.003, 0.5);
    });
  }
  // Pause: «radio tuning» — BP sweep 3000 → 800 + 90 Hz hum (reverse on resume)
  tune(down = true) {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-26), 0, (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', down ? 3000 : 800, down ? 800 : 3000, 4, t, 0.35, 0.02, 1);
      this._osc(v, out, 'sawtooth', 90, 0, t, 0.3, 0.02, 0.25);
    });
  }
  teletype(i = 0) {
    if (i % 2) return;
    this._shot(0, 'ui', this.eng.mix.bus.ui, dB(-34), 0, (v, out, t) => this._noise(v, out, 'white', 'highpass', 2500, 0, 0.7, t, 0.002, 0.0005, 1));
  }
  typewriter() {
    this._shot(0, 'ui', this.eng.mix.bus.ui, dB(-27), (Math.random() - 0.5) * 0.3, (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 2600, 0, 1.5, t, 0.012, 0.001, 1);
      this._osc(v, out, 'sine', 180, 120, t, 0.04, 0.002, 0.5, this.eng.waves.sub);
    });
  }
  stamp(soft = false) {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(soft ? -27 : -19), 0, (v, out, t) => {
      this._osc(v, out, 'sine', 60, 45, t, 0.18, 0.002, 1, this.eng.waves.sub);
      this._noise(v, out, 'pink', 'lowpass', 1800, 600, 0.7, t, 0.06, 0.001, 0.9);
    });
  }
  static() {
    this._shot(0, 'ui', this.eng.mix.bus.ui, dB(-30), 0, (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 2200, 0, 0.7, t, 0.25, 0.005, 1);
    });
  }
  epirb() {
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-32), 0, (v, out, t) => {
      this._osc(v, out, 'sine', 1240, 0, t, 0.06, 0.003);
      this._osc(v, out, 'sine', 1240, 0, t + 0.12, 0.06, 0.003);
    });
  }
  objective() {
    this._shot(2, 'ui', this.eng.mix.bus.ui, dB(-28), 0, (v, out, t) => {
      [74, 78, 81].forEach((m, i) => this._bell(v, out, m, t + i * 0.11, 0.6, 1.4));
    });
  }
  // «Человек на борту»: glass bell, one scale step higher per occupant
  boardBell(n) {
    const m = BELL_STEPS[clamp((n || 1) - 1, 0, BELL_STEPS.length - 1)];
    this._shot(2, 'ui', this.eng.mix.bus.ui, dB(-25), 0, (v, out, t) => {
      const wet = v.n(this.ac.createGain());
      wet.gain.value = 0.5;
      out.connect(wet).connect(this.eng.mix.send);
      this._bell(v, out, m, t, 1, 3);
    });
  }
  // Unload: a soft descending chime per person (cascade of bells)
  unloadChime(left) {
    const m = BELL_STEPS[clamp(left, 0, BELL_STEPS.length - 1)] - 12;
    this._shot(1, 'ui', this.eng.mix.bus.ui, dB(-30), 0, (v, out, t) => this._bell(v, out, m, t, 0.8, 1.6));
  }
  click() {
    this._shot(0, 'ui', this.eng.mix.bus.ui, dB(-32), 0, (v, out, t) => this._noise(v, out, 'white', 'bandpass', 3200, 0, 2, t, 0.008, 0.001));
  }
  chapter() {
    this._shot(2, 'music', this.eng.mix.bus.music, dB(-14), 0, (v, out, t) => {
      const wet = v.n(this.ac.createGain());
      wet.gain.value = 0.8;
      out.connect(wet).connect(this.eng.mix.send);
      this._osc(v, out, 'sine', 55, 41, t, 2.2, 0.01, 1, this.eng.waves.sub);
      this._noise(v, out, 'brown', 'lowpass', 400, 120, 0.7, t, 1.8, 0.02, 0.6);
      this._bell(v, out, 62, t + 0.05, 0.25, 3);
    });
  }

  // ---- helicopter ----------------------------------------------------------------------------------
  ignition() {
    // 8 Hz ignition ticks for 2.5 s
    this._shot(2, 'engine', this.eng.mix.bus.engine, dB(-22), 0, (v, out, t) => {
      for (let i = 0; i < 20; i++) this._noise(v, out, 'white', 'bandpass', 3500, 0, 3, t + i / 8, 0.012, 0.001, 0.8 + 0.2 * Math.random());
      this._noise(v, out, 'brown', 'lowpass', 200, 600, 0.7, t, 2.6, 0.5, 0.5);
    });
  }
  hit(amount = 0.1) {
    const lvl = dB(-12 + 8 * clamp(amount / 0.3, 0, 1));
    this._shot(3, 'hit', this.eng.mix.bus.engine, lvl, 0, (v, out, t) => {
      this._noise(v, out, 'white', 'highpass', 800, 0, 0.7, t, 0.03, 0.001, 1);
      const sh = v.n(this.ac.createWaveShaper());
      sh.curve = clipCurve(3);
      sh.connect(out);
      this._modal(v, sh, 200 + 180 * Math.random(), t, 0.5, 0.8);
    });
  }
  // Crash: metallic crunch → (rotor stops: heli τ .6) → big splash → «under water» LP → near silence
  crash(x, z, onDeck) {
    const e = this.eng;
    this._shot(4, 'crash', e.mix.bus.engine, dB(-8), 0, (v, out, t) => {
      const sh = v.n(this.ac.createWaveShaper());
      sh.curve = clipCurve(4);
      sh.connect(out);
      for (let i = 0; i < 5; i++) this._modal(v, sh, 140 + 260 * Math.random(), t + i * 0.07 * Math.random(), 0.9, 0.6);
      this._noise(v, out, 'white', 'bandpass', 1800, 400, 0.8, t, 0.8, 0.002, 1);
    });
    if (!onDeck) e.env.crash(x, z, 1, 4);
    const now = e.ac.currentTime;
    e.mix.lpOverride = now + 4.5;
    e.mix.lpOverrideHz = 300;
  }
  landing(vy = 1) {
    const lvl = dB(-14 + 6 * clamp(vy / 4, 0, 1));
    this._shot(2, 'land', this.eng.mix.bus.engine, lvl, 0, (v, out, t) => {
      this._osc(v, out, 'sine', 70, 45, t, 0.35, 0.003, 1, this.eng.waves.sub);
      this._noise(v, out, 'pink', 'lowpass', 900, 300, 0.7, t, 0.12, 0.002, 0.6);
      if (vy > 2.5) this._modal(v, out, 260, t, 0.4, 0.5);
    });
  }
  relay(on) {
    // «ка-чанк»
    this._shot(1, 'relay', this.eng.mix.bus.engine, dB(-18), 0, (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 4200, 0, 2, t, 0.008, 0.0005, 1);
      this._noise(v, out, 'white', 'bandpass', 900, 0, 1.5, t + 0.045, 0.03, 0.001, 1);
      this._osc(v, out, 'sine', 160, 0, t + 0.045, 0.06, 0.002, 0.6);
    });
    this._searchHum(on);
  }
  _searchHum(on) {
    const e = this.eng;
    if (!this.hum) {
      const { g } = e;
      const lvl = g.gain(0, e.mix.bus.engine);
      const a = g.osc('sine', 100);
      const b = g.osc('sine', 200);
      a.connect(lvl);
      b.connect(g.gain(0.5, lvl));
      a.start();
      b.start();
      this.hum = lvl;
    }
    ctl(this.hum.gain, on ? dB(-38) : 0, e.ac.currentTime, 0.08);
  }
  refuel(state) {
    const e = this.eng;
    if (state === 'start' && !this.pump) {
      this.pump = this._shot(1, 'pump', e.mix.bus.engine, dB(-22), 0.25, (v, out, t) => {
        const o = this._osc(v, out, 'sine', 50, 0, t, 400, 0.4, 1, e.waves.sub);
        o.g.gain.cancelScheduledValues(t);
        o.g.gain.setValueAtTime(0, t);
        o.g.gain.linearRampToValueAtTime(1, t + 0.4);
        // gurgle: brown noise through a wobbling band-pass
        const s = v.n(this.ac.createBufferSource());
        s.buffer = e.buf.brown;
        s.loop = true;
        const bp = v.n(this.ac.createBiquadFilter());
        bp.type = 'bandpass';
        bp.frequency.value = 380;
        bp.Q.value = 6;
        const lfo = v.n(this.ac.createOscillator());
        lfo.frequency.value = 5.5;
        const ld = v.n(this.ac.createGain());
        ld.gain.value = 140;
        lfo.connect(ld).connect(bp.frequency);
        const gg = v.n(this.ac.createGain());
        gg.gain.value = 0.7;
        s.connect(bp).connect(gg).connect(out);
        v.play(s, t, t + 400);
        v.play(lfo, t, t + 400);
      });
    } else if (state !== 'start' && this.pump) {
      this.pump.kill(0.15);
      this.pump = null;
      if (state === 'done') this.ding();
    }
  }
  ding() {
    this._shot(2, 'ui', this.eng.mix.bus.ui, dB(-26), 0, (v, out, t) => this._bell(v, out, 88, t, 1, 1.8));
  }
  resupply() {
    this._shot(1, 'clank', this.eng.mix.bus.engine, dB(-22), 0.2, (v, out, t) => {
      this._modal(v, out, 310, t, 0.4, 0.6);
      this._modal(v, out, 240, t + 0.18, 0.4, 0.5);
    });
  }
  overheat() {
    this._shot(2, 'warn', this.eng.mix.bus.alarm, dB(-20), 0, (v, out, t) => {
      this._osc(v, out, 'triangle', 988, 0, t, 0.12, 0.004);
      this._osc(v, out, 'triangle', 740, 0, t + 0.15, 0.2, 0.004);
    });
  }
  megaphone() {
    // loudspeaker feedback chirp before the voice
    this._shot(2, 'horn', this.eng.mix.bus.radio, dB(-24), 0, (v, out, t) => {
      this._osc(v, out, 'sine', 2900, 3300, t, 0.18, 0.01, 0.7);
      this._noise(v, out, 'white', 'bandpass', 1500, 0, 2, t, 0.03, 0.001, 0.4);
    });
  }
  flareThrow() {
    this._shot(2, 'flare', this.eng.mix.bus.engine, dB(-20), 0.15, (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 900, 2600, 1.5, t, 0.25, 0.01, 1);
      this._noise(v, out, 'white', 'highpass', 1500, 0, 0.7, t, 0.02, 0.001, 0.8);
    });
  }
  // A flare burning on the water: pop + 40 s of crackle, re-panned at 20 Hz.
  flareBurn(x, z, dur = 40) {
    const e = this.eng;
    if (!e._crackle) e._crackle = crackleBuffer(e.ac);
    this._pos(2, 'flare', x, z, dB(-12), (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 1200, 0, 1, t, 0.06, 0.001, 1.2);
      const s = v.n(this.ac.createBufferSource());
      s.buffer = e._crackle;
      s.loop = true;
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7, t + 0.3);
      g.gain.setValueAtTime(0.7, t + dur - 3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      s.connect(g).connect(out);
      v.play(s, t, t + dur + 0.1);
    }, { track: true, carry: 2.5 });
  }
  raftThrow() {
    this._shot(2, 'raft', this.eng.mix.bus.engine, dB(-20), 0.2, (v, out, t) => this._noise(v, out, 'pink', 'bandpass', 600, 1800, 1.2, t, 0.35, 0.03, 1));
  }
  raftInflate(x, z) {
    this.eng.env.crash(x, z, 0.25, 2);
    this._pos(2, 'raft', x, z, dB(-14), (v, out, t) => this._noise(v, out, 'white', 'bandpass', 3800, 2200, 1.0, t + 0.3, 2.2, 0.05, 1), { carry: 2 });
  }

  // ---- winch hits (DESIGN §6.4) -------------------------------------------------------------------
  carabiner() {
    this._shot(2, 'winch', this.eng.mix.bus.engine, dB(-18), 0.1, (v, out, t) => {
      this._osc(v, out, 'sine', 2400, 0, t, 0.05, 0.001, 1);
      this._osc(v, out, 'sine', 3100, 0, t + 0.035, 0.05, 0.001, 0.8);
    });
  }
  basketHit(f0 = 180, level = 1) {
    this._shot(2, 'winch', this.eng.mix.bus.engine, dB(-16) * level, 0.1, (v, out, t) => this._modal(v, out, f0, t, 0.7, 1));
  }
  winchKnock() {
    this._shot(1, 'winch', this.eng.mix.bus.engine, dB(-20), 0.1, (v, out, t) => this._osc(v, out, 'sine', 110, 60, t, 0.12, 0.002, 1, this.eng.waves.sub));
  }
  snag() {
    this._shot(3, 'winch', this.eng.mix.bus.engine, dB(-14), 0.1, (v, out, t) => {
      const sh = v.n(this.ac.createWaveShaper());
      sh.curve = clipCurve(3);
      sh.connect(out);
      this._modal(v, sh, 150, t, 0.8, 1);
      this._noise(v, out, 'white', 'bandpass', 2400, 900, 1, t, 0.3, 0.002, 0.6);
    });
  }
  splashSmall(x, z, size = 0.2) {
    this.eng.env.crash(x, z, size, 1);
  }

  // ---- world -----------------------------------------------------------------------------------------
  // Survivor whistle: 3.2 kHz with a 25 Hz trill, 0.6 s, positional.
  whistle(x, z) {
    this._pos(2, 'whistle', x, z, dB(-14), (v, out, t) => {
      for (let k = 0; k < 2; k++) {
        const t0 = t + k * 0.75;
        const o = v.n(this.ac.createOscillator());
        o.frequency.value = 3200;
        const tr = v.n(this.ac.createOscillator());
        tr.type = 'square';
        tr.frequency.value = 25;
        const td = v.n(this.ac.createGain());
        td.gain.value = 140;
        tr.connect(td).connect(o.frequency);
        const g = v.n(this.ac.createGain());
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.8, t0 + 0.03);
        g.gain.setValueAtTime(0.8, t0 + 0.55);
        g.gain.linearRampToValueAtTime(0, t0 + 0.6);
        o.connect(g).connect(out);
        v.play(o, t0, t0 + 0.62);
        v.play(tr, t0, t0 + 0.62);
        this._noise(v, out, 'white', 'bandpass', 3200, 0, 4, t0, 0.6, 0.03, 0.25);
      }
    }, { carry: 3, minLp: 2500 });
  }
  // «Сюда!» — a formant shout, positional
  shout(x, z) {
    this._pos(1, 'shout', x, z, dB(-16), (v, out, t) => {
      const syl = [[340, 750], [750, 1250], [340, 750]];
      const f0 = 230 + 60 * Math.random();
      syl.forEach((F, i) => {
        const t0 = t + i * 0.22;
        const o = v.n(this.ac.createOscillator());
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0 * (i === 1 ? 1.15 : 1), t0);
        o.frequency.linearRampToValueAtTime(f0 * 0.92, t0 + 0.18);
        const g = v.n(this.ac.createGain());
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
        g.gain.setTargetAtTime(0, t0 + 0.14, 0.03);
        for (const f of F) {
          const bp = v.n(this.ac.createBiquadFilter());
          bp.type = 'bandpass';
          bp.frequency.value = f;
          bp.Q.value = 6;
          o.connect(bp).connect(g);
        }
        g.connect(out);
        v.play(o, t0, t0 + 0.3);
      });
    }, { carry: 2.5 });
  }
  bark(x, z) {
    this._pos(1, 'bark', x, z, dB(-16), (v, out, t) => {
      for (let i = 0; i < 2; i++) {
        const t0 = t + i * 0.26;
        const o = v.n(this.ac.createOscillator());
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(620, t0);
        o.frequency.exponentialRampToValueAtTime(330, t0 + 0.12);
        const bp = v.n(this.ac.createBiquadFilter());
        bp.type = 'bandpass';
        bp.frequency.value = 1100;
        bp.Q.value = 2;
        const g = v.n(this.ac.createGain());
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.8, t0 + 0.01);
        g.gain.setTargetAtTime(0, t0 + 0.05, 0.03);
        o.connect(bp).connect(g).connect(out);
        v.play(o, t0, t0 + 0.2);
      }
    }, { carry: 2.5 });
  }
  // Arktur horn (< 300 m): saws 98 + 147 Hz
  horn(x, z) {
    this._pos(2, 'horn', x, z, dB(-10), (v, out, t) => {
      const lp = v.n(this.ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(out);
      for (const f of [98, 147]) {
        const o = v.n(this.ac.createOscillator());
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = v.n(this.ac.createGain());
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.15);
        g.gain.setValueAtTime(0.5, t + 2.2);
        g.gain.setTargetAtTime(0, t + 2.2, 0.15);
        o.connect(g).connect(lp);
        v.play(o, t, t + 3);
      }
    }, { carry: 6, wet: 0.5, minLp: 700 });
  }
  // Lighthouse foghorn: 116 Hz for 2.2 s, then a drop to 98 Hz (the «grunt»)
  foghorn(x, z) {
    this._pos(2, 'horn', x, z, dB(-8), (v, out, t) => {
      const o = v.n(this.ac.createOscillator());
      o.setPeriodicWave(this.eng.waves.horn);
      o.frequency.setValueAtTime(116, t);
      o.frequency.setValueAtTime(116, t + 2.2);
      o.frequency.exponentialRampToValueAtTime(98, t + 2.5);
      const lp = v.n(this.ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 750;
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.25);
      g.gain.setValueAtTime(0.8, t + 2.5);
      g.gain.setTargetAtTime(0, t + 2.5, 0.25);
      o.connect(lp).connect(g).connect(out);
      v.play(o, t, t + 3.8);
    }, { carry: 12, wet: 0.7, minLp: 600 });
  }
  // Survivor's parachute rocket: whoosh up + pop, far away
  rocket(x, z) {
    this._pos(1, 'rocket', x, z, dB(-14), (v, out, t) => {
      this._noise(v, out, 'white', 'bandpass', 700, 2600, 1.2, t, 1.6, 0.05, 1);
      this._noise(v, out, 'white', 'lowpass', 1800, 0, 0.7, t + 2.4, 0.08, 0.001, 0.9);
    }, { carry: 4, wet: 0.4, minLp: 900 });
  }
  // St. Elmo / charge telegraph: buzz + crackle at 30 Hz for `dur`
  charge(dur = 2) {
    this._shot(3, 'charge', this.eng.mix.bus.world, dB(-22), 0, (v, out, t) => {
      const o = v.n(this.ac.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = 120;
      const bp = v.n(this.ac.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 1.5;
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + dur * 0.8);
      g.gain.setTargetAtTime(0, t + dur, 0.05);
      const am = v.n(this.ac.createOscillator());
      am.type = 'square';
      am.frequency.value = 30;
      const ad = v.n(this.ac.createGain());
      ad.gain.value = 0.4;
      am.connect(ad).connect(g.gain);
      o.connect(bp).connect(g).connect(out);
      v.play(o, t, t + dur + 0.3);
      v.play(am, t, t + dur + 0.3);
    });
  }
  creak(x, z) {
    this._pos(1, 'creak', x, z, dB(-16), (v, out, t) => {
      const o = v.n(this.ac.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t);
      o.frequency.linearRampToValueAtTime(55 + 40 * Math.random(), t + 0.9);
      const bp = v.n(this.ac.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 4;
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.2);
      g.gain.setTargetAtTime(0, t + 0.8, 0.12);
      o.connect(bp).connect(g).connect(out);
      v.play(o, t, t + 1.4);
    }, { carry: 3 });
  }
  bubbles(x, z) {
    const e = this.eng;
    if (!e._bubbles) e._bubbles = bubbleBuffer(e.ac);
    this._pos(1, 'bubbles', x, z, dB(-16), (v, out, t) => {
      const s = v.n(this.ac.createBufferSource());
      s.buffer = e._bubbles;
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.3);
      g.gain.setTargetAtTime(0, t + 2, 0.4);
      s.connect(g).connect(out);
      v.play(s, t, t + 3.5);
    }, { carry: 3 });
  }
}
