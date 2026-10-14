// Audio graph plumbing (DESIGN §6.1): node factory with a persistent-node counter, rate-limited
// parameter writes, the mixer (buses → master glue → limiter, worldLP, reverb, ducking, snapshots),
// the one-shot voice pool (≤ 24 voices, lowest priority stolen) and the positional emitter law.
import { dB, volume, clamp, impulseResponse } from './dsp.js';

// ---------------------------------------------------------------------------------------------
// Node factory. Persistent nodes are counted (budget ~110); voices build through Voice.n() instead.
export class Graph {
  constructor(ac) {
    this.ac = ac;
    this.count = 0;
    this.collect = null; // when an array, created nodes are also pushed here (removable sub-graphs)
  }
  _c(node) {
    this.count++;
    if (this.collect) this.collect.push(node);
    return node;
  }
  // Build a removable sub-graph: returns the nodes fn() created (still counted until release()).
  group(fn) {
    const prev = this.collect;
    const list = (this.collect = []);
    let res;
    try {
      res = fn();
    } finally {
      this.collect = prev;
    }
    return { res, nodes: list };
  }
  // Disconnect a sub-graph; `feeds` are long-lived sources that may feed into it (cut those links too).
  release(nodes, feeds = []) {
    for (const n of nodes) {
      for (const f of feeds) {
        try {
          f.disconnect(n);
        } catch {
          /* was not connected */
        }
      }
      try {
        if (n.stop) n.stop();
      } catch {
        /* not started */
      }
      try {
        n.disconnect();
      } catch {
        /* fine */
      }
    }
    this.count -= nodes.length;
  }
  gain(v = 1, dest = null) {
    const g = this._c(this.ac.createGain());
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }
  filter(type, f, q = 0.7, dest = null) {
    const b = this._c(this.ac.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  }
  osc(type, f, wave = null) {
    const o = this._c(this.ac.createOscillator());
    if (wave) o.setPeriodicWave(wave);
    else o.type = type;
    o.frequency.value = f;
    return o;
  }
  src(buffer, rate = 1) {
    const s = this._c(this.ac.createBufferSource());
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }
  shaper(curve, dest = null) {
    const w = this._c(this.ac.createWaveShaper());
    w.curve = curve;
    if (dest) w.connect(dest);
    return w;
  }
  pan(v = 0, dest = null) {
    const p = this._c(this.ac.createStereoPanner());
    p.pan.value = v;
    if (dest) p.connect(dest);
    return p;
  }
  delay(max, t, dest = null) {
    const d = this._c(this.ac.createDelay(max));
    d.delayTime.value = t;
    if (dest) d.connect(dest);
    return d;
  }
  comp(threshold, knee, ratio, attack, release, dest = null) {
    const c = this._c(this.ac.createDynamicsCompressor());
    c.threshold.value = threshold;
    c.knee.value = knee;
    c.ratio.value = ratio;
    c.attack.value = attack;
    c.release.value = release;
    if (dest) c.connect(dest);
    return c;
  }
}

// Rate-limited AudioParam write: only through setTargetAtTime, skipped when the value barely changed
// (parameters are written ≤ 30 Hz by the control tick; DESIGN §6.1).
export function ctl(param, v, now, tau = 0.05) {
  if (!Number.isFinite(v)) return;
  const last = param._v;
  if (last !== undefined && Math.abs(v - last) <= 1e-4 * (Math.abs(last) + 1e-3)) return;
  param._v = v;
  param.setTargetAtTime(v, now, tau);
}

// Positional emitter law (listener = heli, headset mix, screen-relative since north is up):
// pan = clamp(dx/(|dx|+40), −.85, .85), gain = 30/(30 + max(0, d−30)), lpf = 400 + 17600·exp(−d/350)·(1 − .45·rain).
export function emitterLaw(dx, dz, rain, out) {
  const d = Math.hypot(dx, dz);
  out.pan = clamp(dx / (Math.abs(dx) + 40), -0.85, 0.85);
  out.gain = 30 / (30 + Math.max(0, d - 30));
  out.lpf = 400 + 17600 * Math.exp(-d / 350) * (1 - 0.45 * (rain || 0));
  out.d = d;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Snapshots per game mode (τ 0.6 s): rotor/engine, env, music in dB, worldLP in Hz.
const SNAP = {
  title: { rotor: -10, env: -4, music: 0, lp: 20000 },
  briefing: { rotor: -6, env: -8, music: -3, lp: 1600 },
  play: { rotor: 0, env: 0, music: 0, lp: 20000 },
  paused: { rotor: -10, env: -10, music: 0, lp: 500 },
  debrief: { rotor: -8, env: -6, music: 2, lp: 2500 },
};

export class Mixer {
  constructor(eng) {
    this.eng = eng;
    const g = eng.g;
    const ac = eng.ac;
    this.ac = ac;
    // master 0.85 → glue (−18 dB, knee 12, 3:1, 10/250 ms) → limiter (−2 dB, 20:1, 2/100 ms)
    this.limiter = g.comp(-2, 0, 20, 0.002, 0.1, ac.destination);
    this.glue = g.comp(-18, 12, 3, 0.01, 0.25, this.limiter);
    this.master = g.gain(0, this.glue);
    this.worldLP = g.filter('lowpass', 20000, 0.5, this.master);
    // ducks (radio lines): sfx −4, env −7, music −8 dB
    this.sfxDuck = g.gain(1, this.worldLP);
    this.envDuck = g.gain(1, this.worldLP);
    this.musicDuck = g.gain(1, this.master);
    this.bus = {
      rotor: g.gain(1, this.sfxDuck),
      engine: g.gain(1, this.sfxDuck),
      world: g.gain(1, this.envDuck),
      music: g.gain(1, this.musicDuck),
      radio: g.gain(1, this.master),
      alarm: g.gain(1, this.master), // never ducked or filtered
      ui: g.gain(1, this.master),
    };
    this.snap = SNAP.title;
    this.lpOverride = 0; // worldLP override (crash «под водой») until this ac time
    this.lpOverrideHz = 300;
    this.muted = false;
    this.fadeTau = 0.8; // master time constant: the unlock fade-in (τ 0.8), then quicker volume changes
    this._buildReverb();
  }

  // Reverb: convolution with a procedural 2.8 s IR, pre-delay 20 ms, return −8 dB;
  // low quality: delay 87 ms, feedback .45, LP 2.5 kHz.
  _buildReverb() {
    const g = this.eng.g;
    const ac = this.ac;
    if (this.send) {
      try {
        this.send.disconnect();
        this.ret.disconnect();
        for (const n of this._revNodes) n.disconnect();
      } catch {
        /* already gone */
      }
      g.count -= 2 + this._revNodes.length;
    }
    const low = this.eng.quality === 'low';
    this.send = g.gain(1);
    this.ret = g.gain(dB(-8), this.master);
    if (low) {
      const d = g.delay(0.5, 0.087);
      const fb = g.gain(0.45);
      const lp = g.filter('lowpass', 2500, 0.5);
      this.send.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);
      lp.connect(this.ret);
      this._revNodes = [d, fb, lp];
    } else {
      const pre = g.delay(0.1, 0.02);
      const conv = g._c(ac.createConvolver());
      if (!this.eng._ir) this.eng._ir = impulseResponse(ac);
      conv.buffer = this.eng._ir;
      this.send.connect(pre);
      pre.connect(conv);
      conv.connect(this.ret);
      this._revNodes = [pre, conv];
    }
  }

  setQuality() {
    this._buildReverb();
  }

  // userGain per bus from the settings (×) the mode snapshot.
  apply(settings, now, tau = 0.6) {
    const s = this.snap;
    const v = (k, def) => volume(settings?.get?.(k) ?? def);
    const sfx = v('sfxVolume', 0.9);
    ctl(this.bus.rotor.gain, sfx * dB(s.rotor), now, tau);
    ctl(this.bus.engine.gain, sfx * dB(s.rotor), now, tau);
    ctl(this.bus.world.gain, v('envVolume', 0.9) * dB(s.env), now, tau);
    ctl(this.bus.music.gain, v('musicVolume', 0.6) * dB(s.music) * (this.eng.musicMute ? 0 : 1), now, tau);
    ctl(this.bus.radio.gain, v('radioVolume', 0.9), now, 0.1);
    ctl(this.bus.alarm.gain, settings?.get?.('alarms') === false ? 0 : 1, now, 0.05);
    ctl(this.bus.ui.gain, v('uiVolume', 0.8), now, 0.1);
    const m = this.muted ? 0 : 0.85 * v('masterVolume', 0.8);
    ctl(this.master.gain, m, now, this.fadeTau);
    const lp = now < this.lpOverride ? this.lpOverrideHz : s.lp;
    ctl(this.worldLP.frequency, lp, now, now < this.lpOverride ? 0.25 : tau);
  }

  setSnapshot(mode) {
    this.snap = SNAP[mode] || SNAP.play;
  }

  // Duck env −7, music −8, sfx −4 dB for `dur` s (attack τ .04, release τ .35). Alarms are never ducked.
  duck(dur) {
    const now = this.ac.currentTime;
    const end = now + Math.max(0.3, dur);
    for (const [node, d] of [[this.envDuck, -7], [this.musicDuck, -8], [this.sfxDuck, -4]]) {
      const p = node.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(dB(d), now, 0.04);
      p.setTargetAtTime(1, end, 0.35);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// One-shot voices: ≤ 24 at once; when full, the lowest-priority (then oldest) voice is stolen if it is
// not more important than the newcomer. Every node is disconnected when the last source ends.
export class Voices {
  constructor(eng, max = 24) {
    this.eng = eng;
    this.max = max;
    this.active = [];
    this.started = 0;
    this.stolen = 0;
    this.refused = 0;
  }

  // build(v) creates nodes with v.n(node), registers sources with v.play(src, t0, t1), sets v.out.
  start(prio, build, tag = '') {
    const ac = this.eng.ac;
    if (this.active.length >= this.max) {
      let victim = null;
      for (const v of this.active) {
        if (v.prio > prio) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
      }
      if (!victim) {
        this.refused++;
        return null;
      }
      victim.kill();
      this.stolen++;
    }
    const pool = this;
    const v = {
      prio,
      tag,
      t0: ac.currentTime,
      nodes: [],
      srcs: [],
      out: null,
      live: 0,
      dead: false,
      n(node) {
        this.nodes.push(node);
        return node;
      },
      play(src, t0, t1) {
        this.nodes.push(src);
        this.srcs.push(src);
        this.live++;
        src.onended = () => {
          if (--this.live <= 0) this.cleanup();
        };
        src.start(Math.max(ac.currentTime, t0));
        if (t1 !== undefined) src.stop(Math.max(ac.currentTime + 0.01, t1));
        return src;
      },
      cleanup() {
        if (this.dead) return;
        this.dead = true;
        for (const n of this.nodes) {
          try {
            n.disconnect();
          } catch {
            /* fine */
          }
        }
        this.nodes.length = 0;
        const i = pool.active.indexOf(this);
        if (i >= 0) pool.active.splice(i, 1);
      },
      kill(fade = 0.015) {
        if (this.dead) return;
        const now = ac.currentTime;
        if (this.out) {
          this.out.gain.cancelScheduledValues(now);
          this.out.gain.setTargetAtTime(0, now, fade);
        }
        for (const s of this.srcs) {
          try {
            s.stop(now + fade * 5);
          } catch {
            /* not started / already stopped */
          }
        }
        const i = pool.active.indexOf(this);
        if (i >= 0) pool.active.splice(i, 1);
      },
    };
    try {
      build(v);
    } catch (err) {
      v.cleanup();
      console.error('[audio] voice build failed', tag, err);
      return null;
    }
    if (!v.srcs.length) {
      v.cleanup();
      return null;
    }
    this.active.push(v);
    this.started++;
    return v;
  }

  count(tag) {
    let n = 0;
    for (const v of this.active) if (v.tag === tag) n++;
    return n;
  }

  killAll() {
    for (const v of this.active.slice()) v.kill();
  }
}
