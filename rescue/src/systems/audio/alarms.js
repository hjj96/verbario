// Alarms (DESIGN §6.5): the alarm bus plays ONE alarm at a time by priority; they differ by rhythm.
// Never ducked or filtered; muted by settings.alarms = false.
//   МАЛАЯ ВЫСОТА  clearance < 6 m while descending: sine 1250 Hz, 40 ms pulses every clamp(clr/25, .08, .6) s,
//                 continuous below 2 m (not over a pad — that is a landing)
//   ПРЕПЯТСТВИЕ   < 40 m from world.obstacles: the same pulses at 1600 Hz, in pairs
//   НАТЯЖЕНИЕ     winch tension: saw 330 Hz triplets
//   КОРПУС        hull < 25 %: square 720 Hz, 3 × 70 ms every 2 s
//   ТОПЛИВО       25 % once / 10 % every 1.5 s / 5 % continuous: 880 → 660 Hz
//   ОПАСНОСТЬ     hazard:warning (danger): two saws 98/103.5 Hz → LP 600, 1.5 s swell, ring 1760 Hz (one-shot)
// Pattern alarms share one oscillator + VCA; pulses are scheduled ≤ 0.2 s ahead on the audio clock.
import { dB, clamp } from './dsp.js';

const LEVEL = dB(-14);
const PRIO = { danger: 6, lowalt: 5, obstacle: 4, tension: 3, hull: 2, fuel: 1 };

export class Alarms {
  constructor(eng) {
    this.eng = eng;
    const { g, mix } = eng;
    this.vca = g.gain(0, mix.bus.alarm);
    this.osc = g.osc('sine', 1250);
    this.osc.connect(this.vca);
    this.osc.start();
    this.active = null; // current pattern alarm name
    this.next = 0; // ac time of the next pattern start
    this.dangerUntil = 0;
    this.fuelOnce = false;
    this.fuelLevel = null;
    this.tensionUntil = 0;
    this.steady = false;
    this.state = { name: null };
  }

  danger() {
    const e = this.eng;
    const ac = e.ac;
    const now = ac.currentTime;
    if (now < this.dangerUntil - 0.5) return;
    this.dangerUntil = now + 1.9;
    this._silence(now);
    e.voices.start(5, (v) => {
      const t = now + 0.01;
      const out = v.n(ac.createGain());
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(LEVEL * 1.2, t + 1.5);
      out.gain.setTargetAtTime(0, t + 1.55, 0.12);
      out.connect(e.mix.bus.alarm);
      const lp = v.n(ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(250, t);
      lp.frequency.exponentialRampToValueAtTime(600, t + 1.5);
      lp.Q.value = 2;
      lp.connect(out);
      for (const f of [98, 103.5]) {
        const o = v.n(ac.createOscillator());
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        v.play(o, t, t + 2.2);
      }
      // the ring on top
      const r = v.n(ac.createOscillator());
      r.frequency.value = 1760;
      const rg = v.n(ac.createGain());
      rg.gain.setValueAtTime(0, t + 1.45);
      rg.gain.linearRampToValueAtTime(LEVEL * 0.8, t + 1.47);
      rg.gain.setTargetAtTime(0, t + 1.5, 0.12);
      r.connect(rg).connect(e.mix.bus.alarm);
      v.out = out;
      v.play(r, t, t + 2.2);
    }, 'alarm');
  }

  fuel(level) {
    // level: 'low' (25 %) | 'critical' (10 %) | 'empty' (5 %)
    this.fuelLevel = level;
    if (level === 'low') this.fuelOnce = true;
  }

  tension() {
    this.tensionUntil = this.eng.ac.currentTime + 1.6;
  }

  _silence(now) {
    const p = this.vca.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(0, now, 0.005);
    this.active = null;
  }

  // per-frame: decide the alarm, schedule its pulses ahead
  update(mode) {
    const e = this.eng;
    const ac = e.ac;
    const now = ac.currentTime;
    const h = e.ctx.heli;
    let want = null;
    let clr = 99;
    if (mode === 'play' && h && h.alive !== false && now >= this.dangerUntil) {
      clr = h.skidClearance ?? (h.altitude ?? 40) - 1.6;
      const p = h.position;
      const overPad = p && e.ctx.world?.padAt?.(p.x, p.z);
      const descending = (h.vy ?? h.velocity?.y ?? 0) < -0.4;
      if (!h.landed && !overPad && clr < 6 && (descending || clr < 2)) want = 'lowalt';
      if (!want && p && !h.landed) {
        for (const o of e.ctx.world?.obstacles || []) {
          if (Math.hypot(o.x - p.x, o.z - p.z) - (o.radius || 0) < 40 && p.y < (o.top ?? 999) + 12) {
            want = 'obstacle';
            break;
          }
        }
      }
      if (!want && now < this.tensionUntil) want = 'tension';
      if (!want && (h.hull ?? 1) < 0.25) want = 'hull';
      const fuel = h.fuel ?? 1;
      if (!want && fuel > 0 && !h.landed) {
        if (fuel < 0.1) want = 'fuel';
        else if (this.fuelOnce && fuel < 0.25) want = 'fuel';
      }
    }
    if (want !== this.active) {
      // a new alarm cancels pending pulses; a finished pulse pattern simply runs out
      if (want || this.steady) this._silence(now);
      this.steady = false;
      this.active = want;
      this.next = now + 0.02;
    }
    this.state.name = want;
    if (!want) return;
    const p = this.vca.gain;
    const o = this.osc;
    const ahead = now + 0.2;
    while (this.next < ahead) {
      const t = this.next;
      switch (want) {
        case 'lowalt': {
          o.type = 'sine';
          o.frequency.setValueAtTime(1250, t);
          if (clr < 2) {
            p.setTargetAtTime(LEVEL, t, 0.005);
            this.steady = true;
            this.next = t + 0.1;
          } else {
            this._pulse(p, t, 0.04);
            this.next = t + clamp(clr / 25, 0.08, 0.6);
          }
          break;
        }
        case 'obstacle':
          o.type = 'sine';
          o.frequency.setValueAtTime(1600, t);
          this._pulse(p, t, 0.04);
          this._pulse(p, t + 0.1, 0.04);
          this.next = t + 0.6;
          break;
        case 'tension':
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(330, t);
          for (let i = 0; i < 3; i++) this._pulse(p, t + i * 0.1, 0.06, 0.7);
          this.next = t + 0.8;
          break;
        case 'hull':
          o.type = 'square';
          o.frequency.setValueAtTime(720, t);
          for (let i = 0; i < 3; i++) this._pulse(p, t + i * 0.12, 0.07, 0.6);
          this.next = t + 2;
          break;
        case 'fuel': {
          o.type = 'sine';
          const f = h?.fuel ?? 1;
          o.frequency.setValueAtTime(880, t);
          o.frequency.setValueAtTime(660, t + 0.16);
          if (f < 0.05) {
            p.setTargetAtTime(LEVEL * 0.8, t, 0.005);
            this.steady = true;
            this.next = t + 0.32;
          } else {
            this._pulse(p, t, 0.14);
            this._pulse(p, t + 0.16, 0.14);
            if (f >= 0.1) {
              // 25 %: the double signal once
              this.fuelOnce = false;
              this.next = t + 0.4;
              this.active = 'fuel-done';
              return;
            }
            this.next = t + 1.5;
          }
          break;
        }
        default:
          this.next = t + 1;
      }
    }
  }

  _pulse(p, t, len, k = 1) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(LEVEL * k, t + 0.004);
    p.setValueAtTime(LEVEL * k, t + len - 0.004);
    p.linearRampToValueAtTime(0, t + len);
  }
}

export { PRIO };
