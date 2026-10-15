// Small details (DESIGN §6.6 «Мир» + [NICE] list, §3.11 pets, §2.12 hazard stages) — one-shots and a
// slow (≈ 4 Hz) scheduler for ambient life. Everything is a pooled voice from the 24-voice pool; nothing
// here is persistent.
//
//   meow(x, z)            the cat that refuses the basket: a sulky «мя-а-у» + a hiss (survivor:pet refuse)
//   gulls(n)              n gull cries scattered around the heli (fx:gulls 'leave' — the flock lifts off)
//   spoutStage(h, stage)  waterspout / tornado life: 'spray' (the spray ring blooms), 'mature' (the funnel
//                         touches down: sub whoomp + roar swell), 'decay' (rain-dump wash as it collapses)
//   engulf(x, z)          whirlpool swallows someone: a falling gurgle + bubbles (hazard:engulf)
//   flameout()            turbine dies (heli:autorotation): compressor-stall pop + spool-down whine
//   tick(now, dt, mode)   ambient scheduler: buoy bells rung by the swell (nearest moored buoy < 260 m),
//                         gulls in fair daylight, the whale's blow + a distant song, and the heartbeat
//                         under 20 % hull (70 → 110 bpm as the hull drops) — all [NICE] in DESIGN §6.6.
import { dB, clamp, midiHz, tanhCurve } from './dsp.js';

const BUOY_R = 260;
const HEART_HULL = 0.2;

export class Extras {
  constructor(eng) {
    this.eng = eng;
    this.reset();
  }

  reset() {
    this.buoyT = 2;
    this.gullT = 18;
    this.heartT = 0;
    this.whaleBlown = false;
    this.whaleSung = false;
    this.whaleActive = false;
  }

  get ac() {
    return this.eng.ac;
  }

  get sfx() {
    return this.eng.sfx;
  }

  // ---- event one-shots -------------------------------------------------------------------------

  // Sawtooth through two formant band-passes; F(t) glides и → а → у, the pitch rises then sulks down.
  meow(x, z) {
    const ac = this.ac;
    this.sfx._pos(1, 'pet', x, z, dB(-15), (v, out, t) => {
      const o = v.n(ac.createOscillator());
      o.type = 'sawtooth';
      const f0 = 560 + 80 * Math.random();
      o.frequency.setValueAtTime(f0 * 0.9, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.22);
      o.frequency.linearRampToValueAtTime(f0 * 0.82, t + 0.62);
      const g = v.n(ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7, t + 0.06);
      g.gain.setValueAtTime(0.7, t + 0.45);
      g.gain.setTargetAtTime(0, t + 0.5, 0.06);
      const F = [[290, 2250, 2000], [750, 1250, 1500], [340, 750, 1000]]; // и → а → у (Hz, F1/F2) + glide end ms
      for (let k = 0; k < 2; k++) {
        const bp = v.n(ac.createBiquadFilter());
        bp.type = 'bandpass';
        bp.Q.value = k ? 7 : 5;
        bp.frequency.setValueAtTime(F[0][k] * 1.6, t);
        bp.frequency.linearRampToValueAtTime(F[1][k] * 1.6, t + 0.2);
        bp.frequency.linearRampToValueAtTime(F[2][k] * 1.6, t + 0.6);
        o.connect(bp).connect(g);
      }
      g.connect(out);
      v.play(o, t, t + 0.9);
      // the refusal: a short hiss after the meow
      this.sfx._noise(v, out, 'white', 'highpass', 3200, 0, 0.7, t + 0.75, 0.45, 0.02, 0.35);
    }, { carry: 2.5 });
  }

  // One gull cry «кии-а»: a fast up-down glide with a rough 30 Hz flutter, band-passed around 2 kHz.
  _gull(v, out, t, f) {
    const ac = this.ac;
    const o = v.n(ac.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.8, t);
    o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.32);
    const fl = v.n(ac.createOscillator());
    fl.frequency.value = 28 + 8 * Math.random();
    const fd = v.n(ac.createGain());
    fd.gain.value = f * 0.04;
    fl.connect(fd).connect(o.frequency);
    const bp = v.n(ac.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 2.2;
    const g = v.n(ac.createGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.22, 0.05);
    o.connect(bp).connect(g).connect(out);
    v.play(o, t, t + 0.5);
    v.play(fl, t, t + 0.5);
  }

  // n gulls around the heli, each 1–3 cries; one voice per bird.
  gulls(n = 4, level = dB(-20)) {
    const p = this.eng.ctx.heli?.position;
    if (!p) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 50 + 140 * Math.random();
      const delay = i * 0.35 + Math.random() * 0.9;
      const f = 1500 + 500 * Math.random();
      const cries = 1 + Math.floor(Math.random() * 3);
      this.sfx._pos(0, 'gull', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, level, (v, out, t) => {
        for (let k = 0; k < cries; k++) this._gull(v, out, t + delay + k * (0.38 + 0.1 * Math.random()), f * (1 - 0.04 * k));
      }, { carry: 2 });
    }
  }

  spoutStage(h, stage) {
    const pos = h?.position;
    if (!pos) return;
    const big = h.type === 'tornado';
    const ac = this.ac;
    if (stage === 'spray' || stage === 3) {
      // the spray ring blooms: a hiss swelling over 2 s
      this.sfx._pos(1, 'hazard', pos.x, pos.z, dB(big ? -12 : -15), (v, out, t) => {
        const n = this.sfx._noise(v, out, 'white', 'bandpass', 900, 1600, 0.9, t, 3, 1.6, 0.8);
        n.g.gain.cancelScheduledValues(t);
        n.g.gain.setValueAtTime(0, t);
        n.g.gain.linearRampToValueAtTime(0.8, t + 1.8);
        n.g.gain.setTargetAtTime(0, t + 2.2, 0.5);
      }, { carry: 8, wet: 0.3, minLp: 900 });
    } else if (stage === 'mature' || stage === 4) {
      // touchdown: sub whoomp + brown roar swelling, the funnel «locks» onto the sea
      this.sfx._pos(2, 'hazard', pos.x, pos.z, dB(big ? -6 : -9), (v, out, t) => {
        const o = v.n(ac.createOscillator());
        o.setPeriodicWave(this.eng.waves.sub);
        o.frequency.setValueAtTime(46, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
        const sh = v.n(ac.createWaveShaper());
        sh.curve = tanhCurve(2);
        const g = v.n(ac.createGain());
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.12);
        g.gain.setTargetAtTime(0, t + 0.5, 0.45);
        o.connect(sh).connect(g).connect(out);
        v.play(o, t, t + 2.6);
        this.sfx._noise(v, out, 'brown', 'lowpass', 220, 700, 0.8, t, 3.2, 0.6, 1);
      }, { carry: 9, wet: 0.45, minLp: 700 });
    } else if (stage === 'decay' || stage === 5) {
      // collapse: the column dumps its water — a wash of rain-noise falling in pitch
      this.sfx._pos(1, 'hazard', pos.x, pos.z, dB(big ? -12 : -14), (v, out, t) => {
        this.sfx._noise(v, out, 'pink', 'bandpass', 2600, 700, 0.8, t, 4, 0.25, 0.9);
        this.sfx._noise(v, out, 'brown', 'lowpass', 400, 120, 0.7, t + 0.2, 3, 0.1, 0.8);
      }, { carry: 7, wet: 0.4, minLp: 800 });
    }
  }

  engulf(x, z) {
    const e = this.eng;
    this.sfx._pos(2, 'hazard', x, z, dB(-11), (v, out, t) => {
      // the throat closes: a falling brown gurgle with a 7 Hz «glug» flutter
      const n = this.sfx._noise(v, out, 'brown', 'lowpass', 700, 110, 2.5, t, 2.4, 0.08, 1);
      const am = v.n(this.ac.createOscillator());
      am.frequency.setValueAtTime(9, t);
      am.frequency.linearRampToValueAtTime(4, t + 2);
      const ad = v.n(this.ac.createGain());
      ad.gain.value = 0.45;
      am.connect(ad).connect(n.g.gain);
      v.play(am, t, t + 2.5);
      // the last bubbles
      if (e._bubbles) {
        const s = v.n(this.ac.createBufferSource());
        s.buffer = e._bubbles;
        const g = v.n(this.ac.createGain());
        g.gain.setValueAtTime(0, t + 0.6);
        g.gain.linearRampToValueAtTime(0.7, t + 0.9);
        g.gain.setTargetAtTime(0, t + 2.2, 0.35);
        s.connect(g).connect(out);
        v.play(s, t + 0.6, t + 3.6);
      }
    }, { carry: 4, wet: 0.35 });
  }

  flameout() {
    const e = this.eng;
    this.sfx._shot(4, 'flameout', e.mix.bus.engine, dB(-10), 0, (v, out, t) => {
      // compressor stall: a dull pop
      this.sfx._noise(v, out, 'white', 'lowpass', 900, 200, 0.8, t, 0.25, 0.002, 1);
      this.sfx._osc(v, out, 'sine', 95, 48, t, 0.3, 0.003, 0.8);
      // spool-down: the turbine whine falls away
      const o = v.n(this.ac.createOscillator());
      o.frequency.setValueAtTime(3300, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(420, t + 3.2);
      const g = v.n(this.ac.createGain());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.08);
      g.gain.setTargetAtTime(0, t + 1.2, 0.8);
      o.connect(g).connect(out);
      v.play(o, t, t + 4);
    });
  }

  // ---- ambient scheduler (called from the 30 Hz control tick) -----------------------------------
  tick(now, dt, mode) {
    if (mode !== 'play' || !(dt > 0)) return;
    const ctx = this.eng.ctx;
    const h = ctx.heli;
    const p = h?.position;
    if (!p) return;
    const ws = ctx.weather?.state || {};
    this._buoys(p, ws, dt);
    this._gulls(ws, dt);
    this._whale(p);
    this._heart(h, now, dt);
  }

  _buoys(p, ws, dt) {
    this.buoyT -= dt;
    if (this.buoyT > 0) return;
    const Hs = ws.waveHeight ?? 1;
    // the swell rocks the bell: rarer in a flat calm, a lazy double strike in a sea
    this.buoyT = clamp(7 - Hs, 2.2, 6.5) * (0.7 + 0.6 * Math.random());
    const list = this.eng.ctx.world?.floaters?.buoys;
    if (!list || !list.length) return;
    let best = null;
    let bd = BUOY_R;
    for (const b of list) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return;
    const two = Hs > 1.5 && Math.random() < 0.5;
    this.sfx._pos(0, 'buoy', best.x, best.z, dB(-17), (v, out, t) => {
      // a heavy bronze bell (A4 with a minor-third partial) struck once or twice
      this.sfx._bell(v, out, 69, t, 0.8, 3.2);
      this.sfx._osc(v, out, 'sine', midiHz(69) * 1.19, 0, t, 2.2, 0.003, 0.25);
      if (two) this.sfx._bell(v, out, 69, t + 0.55, 0.55, 2.6);
    }, { carry: 3, wet: 0.5 });
  }

  _gulls(ws, dt) {
    this.gullT -= dt;
    if (this.gullT > 0) return;
    this.gullT = 22 + 40 * Math.random();
    if ((ws.intensity ?? 0) > 0.35 || (ws.night ?? 0) > 0.4 || (ws.rain ?? 0) > 0.3) return;
    this.gulls(1 + Math.floor(Math.random() * 2), dB(-26));
  }

  _whale(p) {
    const w = this.eng.ctx.fx?.whale;
    if (!w) return;
    const active = !!w.active;
    if (active && !this.whaleActive) {
      this.whaleSung = false;
      this.whaleBlown = !!w.blown;
    }
    this.whaleActive = active;
    if (!active || !Number.isFinite(w.x)) return;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    // the blow: a breathy «пфф» when the spout goes up
    if (w.blown && !this.whaleBlown && d < 500) {
      this.sfx._pos(0, 'whale', w.x, w.z, dB(-14), (v, out, t) => {
        this.sfx._noise(v, out, 'pink', 'bandpass', 700, 380, 0.8, t, 1.1, 0.05, 1);
        this.sfx._noise(v, out, 'brown', 'lowpass', 300, 160, 0.7, t, 0.9, 0.04, 0.8);
      }, { carry: 2.5 });
    }
    this.whaleBlown = !!w.blown;
    // one distant song per visit — heard «through the water», low and slow
    if (!this.whaleSung && d < 700) {
      this.whaleSung = true;
      this.sfx._pos(0, 'whale', w.x, w.z, dB(-20), (v, out, t) => {
        const ac = this.ac;
        const o = v.n(ac.createOscillator());
        o.type = 'triangle';
        const f = 180 + 60 * Math.random();
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * 1.9, t + 1.4);
        o.frequency.exponentialRampToValueAtTime(f * 0.75, t + 3.6);
        o.frequency.linearRampToValueAtTime(f * 1.3, t + 5.2);
        const lp = v.n(ac.createBiquadFilter());
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const g = v.n(ac.createGain());
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.7, t + 0.8);
        g.gain.setValueAtTime(0.7, t + 4.2);
        g.gain.setTargetAtTime(0, t + 4.4, 0.5);
        o.connect(lp).connect(g).connect(out);
        v.play(o, t, t + 6.5);
      }, { carry: 4, wet: 0.8, minLp: 600 });
    }
  }

  // Heartbeat «лаб-даб» under 20 % hull, on the UI bus (the pilot's own, not the world's).
  // Also, quieter, while an injured person is aboard and the «золотой час» runs (DESIGN §3.6):
  // a calm 64 bpm that quickens to ~100 bpm over the last 30 s.
  _heart(h, now, dt) {
    const hull = h.hull ?? 1;
    const gh = this.eng.ctx.mission?.goldenHour;
    const golden = Number.isFinite(gh) && gh > 0 && h.alive !== false;
    const hurt = hull < HEART_HULL && h.alive !== false;
    if (!hurt && !golden) {
      this.heartT = 0;
      return;
    }
    this.heartT -= dt;
    if (this.heartT > 0) return;
    let bpm = 0;
    let gain = -40;
    if (golden) {
      const u = clamp((30 - gh) / 30, 0, 1);
      bpm = 64 + 36 * u * u * (3 - 2 * u);
      gain = -24 + 4 * u;
    }
    if (hurt) {
      const kh = clamp((HEART_HULL - hull) / HEART_HULL, 0, 1);
      bpm = Math.max(bpm, 70 + 40 * kh);
      gain = Math.max(gain, -14 + 4 * kh);
    }
    this.heartT = 60 / bpm;
    this.heartBpm = bpm; // read-only stats (debug / tests)
    this.heartBeats = (this.heartBeats || 0) + 1;
    this.sfx._shot(1, 'heart', this.eng.mix.bus.ui, dB(gain), 0, (v, out, t) => {
      // «лаб» + «даб»; a 2nd harmonic each so laptop speakers still carry it (DESIGN §6.6 target note)
      this.sfx._osc(v, out, 'sine', 62, 40, t, 0.12, 0.004, 1);
      this.sfx._osc(v, out, 'sine', 124, 80, t, 0.08, 0.004, 0.35);
      this.sfx._osc(v, out, 'sine', 55, 36, t + 0.2, 0.1, 0.004, 0.7);
      this.sfx._osc(v, out, 'sine', 110, 72, t + 0.2, 0.07, 0.004, 0.25);
    });
  }
}
