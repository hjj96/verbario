// Rotor & turbine (DESIGN §6.2). Stylised blade-pass frequency BPF = 11.5 Hz × rpm so the «вуп-вуп»
// reads from above. Every layer is a noise loop → filter → VCA driven by a pulse oscillator at BPF
// (PeriodicWave «fast attack / exponential decay», see dsp.pulseWave):
//   thump  brown → LP 160 → tanh(k 2.5)     pulse .06/.18   −8 dB      rpm
//   swish  pink  → BP 420 Q .8              pulse .04/.12   −14 dB     rpm
//   slap   white → BP 1100 Q 1.4            pulse .015/.05  −40 → −12  load
//   tail   saw BPF×5.3 → BP 520 Q 1.5                       −28 → −18  yaw rate
// (all −2 dB in practice: the rotor group peaks at −14 dBFS in flight, DESIGN §6.6 targets)
// + per-revolution accent (sine BPF/4 × .15 on the gain) and a bank «swirl» of the panorama [SHOULD],
// sea reflection below 25 m (delay 2·alt/343, LP 3 kHz, −6 dB·(1−alt/25)) [SHOULD], spray hiss on the
// rotor VCA (white BP 2.4 kHz, depth .25, −18 dB·(1−alt/18)²), RPM dip of 3 % on a sharp collective.
// Turbine: N = 0.6 + 0.4·power (τ .6); sines 1800+1600N, ×2.02 (−12 dB), 6400+1800N (−18 dB) + pink LP 900
// (−10 dB) → HP 150, −30…−24 dB, detune sway 0.21 Hz ±6 cents; start from cold with ignition ticks
// [SHOULD]; fuel < 5 % → «cough» (−300 cents, every 0.4–1.6 s); hull < 35 % → grind (saw f1/12 → clip →
// BP 1.3 kHz). Title: occasional fly-bys; debrief: spin-down.
import { dB, clamp, smoothstep, pulseWave, tanhCurve, clipCurve } from './dsp.js';
import { ctl } from './graph.js';

export class RotorSound {
  constructor(eng) {
    this.eng = eng;
    this.N = 0.6; // turbine spool
    this.dip = 0;
    this.prevLoad = 0;
    this.modeRpm = 1;
    this.coughT = 1;
    this.fly = { t: 0, next: 6, active: false };
    this.grind = null;
    this.startT = -1; // ignition (ac time)
    this._build();
  }

  _build() {
    const { g, ac, mix } = this.eng;
    const A = this.eng.srcA;
    // output: level (fly-bys / spin-down) → pan swirl → rotor bus
    this.panner = g.pan(0, mix.bus.rotor);
    this.out = g.gain(1, this.panner);
    const th = pulseWave(ac, 0.06, 0.18);
    const sw = pulseWave(ac, 0.04, 0.12);
    const sl = pulseWave(ac, 0.015, 0.05);
    this.oscs = [g.osc(null, 11.5, th.wave), g.osc(null, 11.5, sw.wave), g.osc(null, 11.5, sl.wave)];

    // thump
    this.thLvl = g.gain(dB(-8), this.out);
    this.thVca = g.gain(th.mean, this.thLvl);
    const thSh = g.shaper(tanhCurve(2.5), this.thVca);
    const thLP = g.filter('lowpass', 160, 0.9, thSh);
    A.brown.connect(thLP);
    this.oscs[0].connect(this.thVca.gain);
    // swish
    this.swLvl = g.gain(dB(-14), this.out);
    this.swVca = g.gain(sw.mean, this.swLvl);
    A.pink.connect(g.filter('bandpass', 420, 0.8, this.swVca));
    this.oscs[1].connect(this.swVca.gain);
    // blade slap (load)
    this.slLvl = g.gain(dB(-40), this.out);
    this.slVca = g.gain(sl.mean, this.slLvl);
    A.white.connect(g.filter('bandpass', 1100, 1.4, this.slVca));
    this.oscs[2].connect(this.slVca.gain);
    // tail rotor
    this.tail = g.osc('sawtooth', 11.5 * 5.3);
    this.tailLvl = g.gain(dB(-28), this.out);
    this.tail.connect(g.filter('bandpass', 520, 1.5, this.tailLvl));
    // per-revolution accent on the level + bank swirl on the panorama
    this.acc = g.osc('sine', 11.5 / 4);
    this.accDepth = g.gain(0.15, this.out.gain);
    this.acc.connect(this.accDepth);
    this.panDepth = g.gain(0, this.panner.pan);
    this.acc.connect(this.panDepth);
    // sea reflection (low: flanger, higher: echo off the water)
    this.refGain = g.gain(0, mix.bus.rotor);
    this.refLP = g.filter('lowpass', 3000, 0.5, this.refGain);
    this.refDelay = g.delay(0.2, 0.05, this.refLP);
    this.out.connect(this.refDelay);
    // spray hiss on the rotor VCA (depth .25)
    this.sprLvl = g.gain(0, g.gain(dB(6), mix.bus.rotor));
    this.sprVca = g.gain(0.75 + 0.25 * sw.mean, this.sprLvl);
    A.white.connect(g.filter('bandpass', 2400, 1.0, this.sprVca));
    const sprDepth = g.gain(0.25, this.sprVca.gain);
    this.oscs[1].connect(sprDepth);

    // turbine
    this.tLvl = g.gain(0, mix.bus.engine);
    const hp = g.filter('highpass', 150, 0.7, this.tLvl);
    const sum = g.gain(1, hp);
    this.f1 = g.osc('sine', 2760);
    this.f2 = g.osc('sine', 2760 * 2.02);
    this.f3 = g.osc('sine', 7480);
    this.f1.connect(sum);
    this.f2.connect(g.gain(dB(-12), sum));
    this.f3.connect(g.gain(dB(-18), sum));
    A.pink.connect(g.filter('lowpass', 900, 0.7, g.gain(dB(-10), sum)));
    const sway = g.osc('sine', 0.21);
    const swayDepth = g.gain(6, null);
    sway.connect(swayDepth);
    for (const o of [this.f1, this.f2, this.f3]) swayDepth.connect(o.detune);

    const t0 = ac.currentTime + 0.02;
    for (const o of [...this.oscs, this.tail, this.acc, this.f1, this.f2, this.f3, sway]) o.start(t0);
  }

  // Grind is built only when the hull first drops below 35 %.
  _buildGrind() {
    const { g, mix } = this.eng;
    const lvl = g.gain(0, mix.bus.engine);
    const bp = g.filter('bandpass', 1300, 2.0, lvl);
    const sh = g.shaper(clipCurve(6), bp);
    const o = g.osc('sawtooth', 230);
    o.connect(sh);
    o.start();
    this.grind = { o, lvl };
  }

  // Engine start from cold (briefing on the pad): N from 0 (τ 1.6) and 8 Hz ignition ticks for 2.5 s.
  ignite() {
    const e = this.eng;
    this.N = 0;
    this.startT = e.ac.currentTime;
    e.sfx.ignition();
  }

  // 30 Hz control tick
  control(now, dt, mode) {
    const e = this.eng;
    const h = e.ctx.heli || {};
    const crashed = h.alive === false || !!h.ditched;
    // rpm: heli spools (τ 2.2), the debrief spins down, a sharp collective dips 3 % (recovers τ .8)
    const load = clamp(h.load ?? 0.3, 0, 1);
    if (dt > 0 && load - this.prevLoad > 2.4 * dt) this.dip = 0.03;
    this.prevLoad = load;
    this.dip *= Math.exp(-dt / 0.8);
    const modeT = mode === 'debrief' ? 0.45 : 1;
    this.modeRpm += (modeT - this.modeRpm) * (1 - Math.exp(-dt / (mode === 'debrief' ? 3 : 1)));
    let fly = 1;
    let pan = 0;
    if (mode === 'title') {
      // fly-bys: a swell and a pan sweep every 18–30 s
      const F = this.fly;
      F.next -= dt;
      if (!F.active && F.next <= 0) {
        F.active = true;
        F.t = 0;
        F.dir = Math.random() < 0.5 ? -1 : 1;
      }
      if (F.active) {
        F.t += dt / 7;
        const b = Math.sin(Math.PI * clamp(F.t, 0, 1));
        fly = dB(-14 + 14 * b * b);
        pan = F.dir * (-0.7 + 1.4 * clamp(F.t, 0, 1));
        if (F.t >= 1) {
          F.active = false;
          F.next = 18 + 12 * Math.random();
        }
      } else fly = dB(-14);
    }
    const rpm = clamp((h.rotorRPM ?? 1) * this.modeRpm * (1 - this.dip) * (mode === 'title' && this.fly.active ? 1.03 - 0.06 * clamp(this.fly.t, 0, 1) : 1), 0, 1.2);
    const bpf = Math.max(0.3, 11.5 * rpm);
    for (const o of this.oscs) ctl(o.frequency, bpf, now, 0.05);
    ctl(this.tail.frequency, bpf * 5.3, now, 0.05);
    ctl(this.acc.frequency, bpf / 4, now, 0.05);
    const on = smoothstep(0.04, 0.5, rpm);
    ctl(this.out.gain, fly, now, 0.3);
    ctl(this.panner.pan, pan, now, 0.2);
    ctl(this.thLvl.gain, dB(-10) * on, now, 0.08);
    ctl(this.swLvl.gain, dB(-16) * on * (0.6 + 0.4 * rpm), now, 0.08);
    ctl(this.slLvl.gain, dB(-42 + 28 * load) * on, now, 0.08);
    const yaw = Math.abs(h.yawRate || 0);
    ctl(this.tailLvl.gain, dB(-30 + 10 * Math.min(1, yaw / 1.2)) * on, now, 0.1);
    ctl(this.accDepth.gain, 0.15 * on, now, 0.1);
    ctl(this.panDepth.gain, 0.18 * clamp(h.bank || 0, -0.4, 0.4) * 2.5 * on, now, 0.1);
    // sea reflection & spray (play only: on the pad the «sea» is a deck)
    const alt = h.altitude ?? 40;
    const low = mode === 'play' && !h.landed && !crashed;
    ctl(this.refDelay.delayTime, clamp((2 * Math.max(1, alt)) / 343, 0.005, 0.15), now, 0.1);
    ctl(this.refGain.gain, low && alt < 25 ? dB(-6) * (1 - alt / 25) * on : 0, now, 0.15);
    const spr = low && alt < 18 ? Math.pow(1 - alt / 18, 2) : 0;
    ctl(this.sprLvl.gain, dB(-18) * spr * on, now, 0.15);

    // turbine
    const engineOff = crashed || (h.fuel !== undefined && h.fuel <= 0) || h.autorotation;
    const power = clamp(0.2 + 0.75 * load + (h.boost ? 0.3 : 0), 0, 1);
    const Nt = engineOff ? 0 : (mode === 'title' || mode === 'briefing') && h.landed ? 0.62 : 0.6 + 0.4 * power;
    const starting = this.startT > 0 && now - this.startT < 6;
    const tau = engineOff ? 1.5 : starting ? 1.6 : 0.6;
    this.N += (Nt - this.N) * (1 - Math.exp(-dt / tau));
    const N = this.N;
    const f1 = 1800 + 1600 * N;
    ctl(this.f1.frequency, f1, now, 0.06);
    ctl(this.f2.frequency, f1 * 2.02, now, 0.06);
    ctl(this.f3.frequency, 6400 + 1800 * N, now, 0.06);
    ctl(this.tLvl.gain, N > 0.02 ? dB(-28 + 6 * clamp((N - 0.6) / 0.4, 0, 1)) * smoothstep(0, 0.4, N) : 0, now, 0.1);
    // fuel cough
    const fuel = h.fuel ?? 1;
    if (mode === 'play' && fuel > 0 && fuel < 0.05 && !engineOff) {
      this.coughT -= dt;
      if (this.coughT <= 0) {
        this.coughT = 0.4 + 1.2 * Math.random();
        for (const o of [this.f1, this.f2, this.f3]) {
          o.detune.cancelScheduledValues(now);
          o.detune.setTargetAtTime(-300, now, 0.02);
          o.detune.setTargetAtTime(0, now + 0.12, 0.08);
        }
        this.out.gain.setTargetAtTime(fly * 0.75, now, 0.03);
        this.out.gain.setTargetAtTime(fly, now + 0.15, 0.1);
        this.out.gain._v = undefined;
      }
    }
    // damage grind
    const hull = h.hull ?? 1;
    if (hull < 0.35 && !this.grind) this._buildGrind();
    if (this.grind) {
      ctl(this.grind.o.frequency, f1 / 12, now, 0.08);
      ctl(this.grind.lvl.gain, hull < 0.35 && !crashed ? dB(-34 + 14 * clamp((0.35 - hull) / 0.35, 0, 1)) * smoothstep(0.1, 0.5, N) : 0, now, 0.2);
    }
  }
}
