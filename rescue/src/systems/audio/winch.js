// Winch sounds (DESIGN §6.4): motor — saw 70 + 160·|v|/3 Hz + square ×2.01 → LP 1.5 kHz → soft clip,
// −20 dB (with a load: ×0.88 pitch, +2 dB, 9 Hz vibrato); a knock 110 → 60 Hz when it stops; hydraulic
// hiss; ratchet — a tick per 0.12 m of cable [SHOULD] (a click-train oscillator at |v|/0.12 Hz); basket
// modal hits — a clank when it swings past 15°, the docking hit at f0 180 Hz [SHOULD]; carabiner clicks on
// capture; the Aeolian song of the cable 0.2·W/0.011 Hz in 150–900 Hz [NICE].
// Built on the first winch use, then persistent.
import { dB, clamp, tanhCurve, clickWave } from './dsp.js';
import { ctl } from './graph.js';

export class WinchSound {
  constructor(eng) {
    this.eng = eng;
    this.built = false;
    this.moving = false;
    this.prevState = 'stowed';
    this.clankT = 0;
    this._wv = null;
  }

  _build() {
    const { g, ac, mix } = this.eng;
    const A = this.eng.srcA;
    const bus = mix.bus.engine;
    this.lvl = g.gain(0, bus);
    const clip = g.shaper(tanhCurve(2), this.lvl);
    this.lp = g.filter('lowpass', 1500, 0.8, clip);
    this.saw = g.osc('sawtooth', 70);
    this.sq = g.osc('square', 70 * 2.01);
    this.saw.connect(this.lp);
    this.sq.connect(g.gain(0.3, this.lp));
    this.vib = g.osc('sine', 9);
    this.vibD = g.gain(0, null);
    this.vib.connect(this.vibD);
    this.vibD.connect(this.saw.detune);
    this.vibD.connect(this.sq.detune);
    this.hiss = g.gain(0, g.gain(dB(5), bus));
    A.white.connect(g.filter('bandpass', 3000, 0.8, this.hiss));
    this.rat = g.osc(null, 1, clickWave(ac));
    this.ratG = g.gain(0, bus);
    this.rat.connect(g.filter('bandpass', 3200, 2, this.ratG));
    this.aeo = g.osc('sine', 300);
    this.aeoG = g.gain(0, bus);
    this.aeo.connect(this.aeoG);
    const t = ac.currentTime + 0.01;
    for (const o of [this.saw, this.sq, this.vib, this.rat, this.aeo]) o.start(t);
    this.built = true;
  }

  control(now, dt) {
    const e = this.eng;
    const h = e.ctx.heli;
    const w = h?.winch;
    if (!w || !w.state) return;
    if (!this.built) {
      if (w.state === 'stowed') return;
      this._build();
    }
    const v = Math.abs(w.speed || 0);
    const moving = w.state !== 'stowed' && v > 0.08 && e.ctx.mode === 'play';
    const loaded = !!w.load;
    const f = (70 + (160 * Math.min(v, 4)) / 3) * (loaded ? 0.88 : 1);
    ctl(this.saw.frequency, f, now, 0.05);
    ctl(this.sq.frequency, f * 2.01, now, 0.05);
    ctl(this.vibD.gain, loaded ? 18 : 0, now, 0.1);
    ctl(this.lvl.gain, moving ? dB(loaded ? -18 : -20) : 0, now, 0.04);
    ctl(this.hiss.gain, moving ? dB(-38) : 0, now, 0.06);
    ctl(this.rat.frequency, Math.max(1, v / 0.12), now, 0.03);
    ctl(this.ratG.gain, moving ? dB(-30) : 0, now, 0.03);
    // stop knock
    if (this.moving && !moving && w.state !== 'stowed') e.sfx.winchKnock();
    this.moving = moving;
    // basket clank past 15° of swing (rate-limited)
    this.clankT -= dt;
    if (w.state !== 'stowed' && (w.length || 0) > 3 && (w.swing || 0) > 0.26 && this.clankT <= 0) {
      this.clankT = 1.3;
      e.sfx.basketHit(230 + 60 * Math.random(), 0.6);
    }
    // docking hit when the basket comes home
    if (this.prevState === 'raising' && w.state === 'stowed') e.sfx.basketHit(180, 1);
    this.prevState = w.state;
    // Aeolian song of the cable
    const ws = e.ctx.weather?.state;
    const W = ws?.windSpeed || 0;
    const sing = w.state !== 'stowed' && (w.length || 0) > 2 && W > 6;
    ctl(this.aeo.frequency, clamp((0.2 * W) / 0.011, 150, 900), now, 0.3);
    ctl(this.aeoG.gain, sing ? dB(-50) * Math.min(1, (w.length || 0) / 20) : 0, now, 0.4);
  }
}
