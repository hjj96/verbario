// Generative music in D minor (DESIGN §6.6). Intensity I = .45·weather.intensity + .35·max dangerAt +
// .2·urgency, smoothed τ 4 s up / 8 s down; layers cross-fade with τ 2–4 s:
//   1 drone [MUST]        saws D2 / A2 → LP 400 + 800I, −24 dB — always
//   2 pads [MUST]         I ≥ .15 — chords every 13.3 s (72 BPM). Calm: Dm9 → B♭maj7 → Gm9 → Csus2;
//                         storm: Dm(♭6) → E♭maj7(♯11) → B♭/D → A7sus4(♭9)
//   3 ostinato [SHOULD]   I ≥ .45 — plucked saw sixteenths on the chord tones
//   4 strings [SHOULD]    I ≥ .7 — A4 / B♭4 / D5 / E5 cluster, 6 Hz tremolo
//   5 Shepard riser [SHOULD]  a hazard closer than 250 m or eta < 10 s — endless rising tension
//   6 bells of hope [SHOULD]  I < .35 or 4 s after survivor:boarded — D dorian pentatonic
// Title: drone, pads and bells only. Debrief stingers: success D add9, failure drone D2 + E♭2.
// Low quality: layers 1–3 only. Persistent: drone + pads; the rest is built the first time it is needed.
import { dB, clamp, midiHz } from './dsp.js';
import { ctl } from './graph.js';

const BAR = 13.3;
const SIX = 60 / 72 / 4; // a sixteenth at 72 BPM
const CALM = [[53, 57, 60, 64], [53, 57, 58, 62], [55, 58, 62, 69], [55, 60, 62, 67]];
const STORM = [[53, 57, 58, 62], [51, 55, 62, 69], [50, 53, 58, 62], [50, 55, 58, 64]];
const ADD9 = [62, 66, 69, 76];
const BELLS = [74, 76, 77, 81, 83, 86];
const CLUSTER = [69, 70, 74, 76];
const OST = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];

export class Music {
  constructor(eng) {
    this.eng = eng;
    this.I = 0;
    this.chord = -1;
    this.nextChord = 0;
    this.prog = CALM;
    this.ostNext = 0;
    this.ostStep = 0;
    this.bellT = 3;
    this.bellsUntil = 0;
    this.riserPh = 0;
    this.stinger = null; // 'success' | 'fail'
    this.ost = null;
    this.str = null;
    this.riser = null;
    this.layer = { drone: 0, pads: 0, ost: 0, str: 0, riser: 0 };
    this._build();
  }

  _build() {
    const { g, ac, mix } = this.eng;
    this.out = g.gain(1, mix.bus.music);
    const wet = g.gain(0.45, mix.send);
    // drone
    this.droneG = g.gain(0, this.out);
    this.droneLP = g.filter('lowpass', 400, 0.7, this.droneG);
    this.drone = [g.osc('sawtooth', midiHz(38)), g.osc('sawtooth', midiHz(45))];
    for (const o of this.drone) o.connect(this.droneLP);
    // pads: 4 voices × 2 detuned saws
    this.padG = g.gain(0, this.out);
    this.padG.connect(wet);
    this.padVca = g.gain(0.7, this.padG);
    this.padLP = g.filter('lowpass', 900, 0.6, this.padVca);
    this.pads = [];
    for (let i = 0; i < 8; i++) {
      const o = g.osc('sawtooth', midiHz(CALM[0][i >> 1]));
      o.detune.value = i & 1 ? 7 : -7;
      o.connect(this.padLP);
      this.pads.push(o);
    }
    const t = ac.currentTime + 0.05;
    for (const o of [...this.drone, ...this.pads]) o.start(t);
    this.wet = wet;
  }

  _buildOst() {
    const { g, mix } = this.eng;
    const G = g.gain(0, this.out);
    const vca = g.gain(0, G);
    const lp = g.filter('lowpass', 600, 3, vca);
    const o = g.osc('sawtooth', 220);
    o.connect(lp);
    o.start();
    G.connect(g.gain(0.3, mix.send));
    this.ost = { G, vca, lp, o };
  }

  _buildStrings() {
    const { g, ac } = this.eng;
    const G = g.gain(0, this.out);
    G.connect(this.wet);
    const trem = g.gain(0.7, G);
    const lp = g.filter('lowpass', 2400, 0.6, trem);
    const oscs = CLUSTER.map((m) => {
      const o = g.osc('sawtooth', midiHz(m));
      o.connect(lp);
      return o;
    });
    const lfo = g.osc('sine', 6);
    lfo.connect(g.gain(0.3, trem.gain));
    const t = ac.currentTime + 0.01;
    for (const o of [...oscs, lfo]) o.start(t);
    this.str = { G };
  }

  _buildRiser() {
    const { g, ac } = this.eng;
    const G = g.gain(0, this.out);
    const lp = g.filter('lowpass', 2200, 0.5, G);
    const parts = [0, 1, 2].map(() => {
      const pg = g.gain(0, lp);
      const o = g.osc('sawtooth', 110);
      o.connect(pg);
      o.start(ac.currentTime + 0.01);
      return { o, pg };
    });
    this.riser = { G, parts };
  }

  // Music intensity inputs (DESIGN §6.6)
  _target() {
    const ctx = this.eng.ctx;
    const ws = ctx.weather?.state || {};
    const h = ctx.heli;
    let danger = 0;
    if (h?.position && ctx.hazards?.dangerAt) {
      try {
        danger = clamp(ctx.hazards.dangerAt(h.position.x, h.position.z, h.altitude ?? 30) || 0, 0, 1);
      } catch {
        danger = 0;
      }
    }
    let u = 0;
    if (h) {
      if ((h.fuel ?? 1) < 0.25) u = Math.max(u, (0.25 - h.fuel) / 0.2);
      if ((h.hull ?? 1) < 0.5) u = Math.max(u, (0.5 - h.hull) / 0.4);
    }
    for (const s of ctx.survivors?.list || []) {
      if (!s || !s.spotted || s.state === 'rescued' || s.state === 'lost') continue;
      if ((s.health ?? 1) < 0.3) u = Math.max(u, 1 - s.health / 0.3);
    }
    return clamp(0.45 * (ws.intensity || 0) + 0.35 * danger + 0.2 * clamp(u, 0, 1), 0, 1);
  }

  onBoarded() {
    this.bellsUntil = this.eng.ac.currentTime + 4;
    this.bellT = Math.min(this.bellT, 0.6);
  }

  setStinger(kind) {
    this.stinger = kind;
    const now = this.eng.ac.currentTime;
    this.nextChord = now; // re-voice immediately
    if (kind === 'success') this.eng.sfx._shot(2, 'music', this.out, dB(-16), 0, (v, out, t) => {
      out.connect(v.n(this.eng.ac.createGain())).connect(this.eng.mix.send);
      ADD9.forEach((m, i) => this.eng.sfx._bell(v, out, m + 12, t + 0.4 + i * 0.18, 0.5, 3));
    });
  }

  reset() {
    this.stinger = null;
    this.I = 0;
    this.nextChord = 0;
  }

  control(now, dt, mode, quality) {
    const low = quality === 'low';
    const title = mode === 'title' || mode === 'briefing';
    const tI = mode === 'play' || mode === 'paused' ? this._target() : 0.15;
    this.I += (tI - this.I) * (1 - Math.exp(-dt / (tI > this.I ? 4 : 8)));
    const I = this.I;
    const st = this.stinger;
    // layer targets
    const L = this.layer;
    L.drone = 1;
    L.pads = st === 'fail' ? 0 : title || st === 'success' || I >= 0.15 ? 1 : 0;
    L.ost = !title && !st && I >= 0.45 ? 1 : 0;
    L.str = !low && !title && !st && I >= 0.7 ? 1 : 0;
    let riser = 0;
    if (!low && mode === 'play' && !st) {
      const imm = this.eng.ctx.hazards?.imminent;
      const h = this.eng.ctx.heli?.position;
      if (imm && h && imm.position) {
        const d = Math.hypot(imm.position.x - h.x, imm.position.z - h.z);
        if (d < 250 || (imm.eta ?? 99) < 10) riser = 1;
      }
    }
    L.riser = riser;
    // drone
    ctl(this.droneLP.frequency, 400 + 800 * I, now, 0.5);
    ctl(this.droneG.gain, dB(-24) * (st === 'fail' ? 1.6 : 1), now, 2);
    ctl(this.drone[1].frequency, midiHz(st === 'fail' ? 39 : 45), now, 1.5);
    // pads
    ctl(this.padG.gain, L.pads * dB(-23), now, L.pads ? 3 : 2);
    ctl(this.padLP.frequency, 700 + 1100 * I, now, 1);
    if (now >= this.nextChord) this._nextChord(now, I);
    // ostinato
    if (L.ost && !this.ost) this._buildOst();
    if (this.ost) {
      ctl(this.ost.G.gain, L.ost * dB(-26), now, L.ost ? 2 : 3);
      if (L.ost) this._ostinato(now);
      else this.ostNext = 0;
    }
    // strings
    if (L.str && !this.str) this._buildStrings();
    if (this.str) ctl(this.str.G.gain, L.str * dB(-30), now, L.str ? 3 : 4);
    // riser
    if (L.riser && !this.riser) this._buildRiser();
    if (this.riser) this._riser(now, dt, L.riser);
    // bells of hope
    const bellsOn = !low && !st && (I < 0.35 || now < this.bellsUntil) && mode !== 'paused';
    this.bellT -= dt;
    if (bellsOn && this.bellT <= 0) {
      this.bellT = 2.5 + 3.5 * Math.random();
      const m = BELLS[Math.floor(Math.random() * BELLS.length)];
      this.eng.sfx._shot(0, 'music', this.out, dB(-26), (Math.random() - 0.5) * 0.6, (v, out, t) => {
        const w = v.n(this.eng.ac.createGain());
        w.gain.value = 0.7;
        out.connect(w).connect(this.eng.mix.send);
        this.eng.sfx._bell(v, out, m, t, 1, 3.5);
      });
    }
  }

  _nextChord(now, I) {
    let notes;
    if (this.stinger === 'success') notes = ADD9;
    else {
      const storm = I > 0.55;
      if ((storm ? STORM : CALM) !== this.prog) this.prog = storm ? STORM : CALM;
      this.chord = (this.chord + 1) % 4;
      notes = this.prog[this.chord];
    }
    this.notes = notes;
    for (let i = 0; i < 8; i++) {
      const p = this.pads[i].frequency;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(midiHz(notes[i >> 1]), now, 0.9);
      p._v = undefined;
    }
    const v = this.padVca.gain;
    v.cancelScheduledValues(now);
    v.setTargetAtTime(1, now, 2.2);
    v.setTargetAtTime(0.6, now + BAR * 0.6, 3);
    this.nextChord = now + BAR;
  }

  _ostinato(now) {
    const O = this.ost;
    if (this.ostNext < now) this.ostNext = now + 0.05;
    const notes = this.notes || CALM[0];
    while (this.ostNext < now + 0.25) {
      const t = this.ostNext;
      const step = this.ostStep++ % 16;
      const m = notes[OST[step]] + 12;
      const acc = step % 4 === 0 ? 1 : 0.6;
      O.o.frequency.setValueAtTime(midiHz(m), t);
      O.vca.gain.setValueAtTime(0, t);
      O.vca.gain.linearRampToValueAtTime(acc, t + 0.004);
      O.vca.gain.setTargetAtTime(0, t + 0.01, 0.06);
      O.lp.frequency.setValueAtTime(900 + 2200 * acc * (0.5 + this.I), t);
      O.lp.frequency.setTargetAtTime(450, t + 0.01, 0.07);
      this.ostNext += SIX;
    }
  }

  // Shepard riser: 3 saws an octave apart gliding up forever, each faded by a bell over its log-pitch.
  _riser(now, dt, on) {
    const R = this.riser;
    ctl(R.G.gain, on * dB(-28), now, on ? 1.5 : 2.5);
    this.riserPh = (this.riserPh + dt / 24) % 1; // 8 s per octave over a 3-octave span
    for (let i = 0; i < 3; i++) {
      const p = (this.riserPh + i / 3) % 1;
      const f = 110 * Math.pow(2, p * 3);
      const amp = Math.pow(Math.sin(Math.PI * p), 2);
      const fp = R.parts[i].o.frequency;
      if (p < 0.02) {
        fp.cancelScheduledValues(now);
        fp.setValueAtTime(f, now);
        fp._v = f;
      } else ctl(fp, f, now, 0.03);
      ctl(R.parts[i].pg.gain, amp * 0.5, now, 0.05);
    }
  }
}
