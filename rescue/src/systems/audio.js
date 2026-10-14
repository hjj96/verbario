// Procedural audio engine (CONTRACT «audio»; DESIGN §6). WebAudio with native nodes only — no
// ScriptProcessor, no AudioWorklet, no samples: every sound is synthesised from noise buffers,
// oscillators and filters generated at unlock.
//
//   audio/dsp.js          noise buffers, IR, droplet/hail/crackle/bubble loops, PeriodicWaves, curves
//   audio/graph.js        node factory (+ persistent-node count), ctl(), Mixer (buses, glue, limiter,
//                         worldLP, reverb, ducking, snapshots), Voices (≤ 24 one-shots, stealing), emitter law
//   audio/rotor.js        rotor layers at BPF = 11.5 Hz × rpm, turbine, spray, sea reflection, cough, grind
//   audio/environment.js  wind, rain, hail, sea, rogue approach, thunder, gust telegraph, hazard emitters
//   audio/voice.js        radio channel chains, squelch, interference, vowel-formant babble
//   audio/alarms.js       one alarm at a time by priority
//   audio/music.js        generative D-minor score in 6 layers driven by intensity
//   audio/winch.js        winch motor, ratchet, basket hits, Aeolian cable
//   audio/sfx.js          UI, world and event one-shots
//
// Lifecycle: the AudioContext is created in unlock() on the first pointerdown / keydown / touchend
// (capture), master fades 0 → 1 with τ 0.8; visibilitychange suspends / resumes (iOS 'interrupted' is
// treated as suspended and resumed on the next gesture). Snapshots per game:mode (τ 0.6). Parameters are
// written by a 30 Hz control tick via setTargetAtTime only; positional emitters are recomputed at 20 Hz.
//
// Public: unlock(), play(name, opts), setMuted(bool) (CONTRACT); beyond it: muted, ready, stats(),
// startMeter(busName?) / meter {peak, rms} (dBFS, for tests), alarms.state.name, voices.
import { Graph, Mixer, Voices } from './audio/graph.js';
import { noiseBuffers, subWave, hornWave, clamp } from './audio/dsp.js';
import { RotorSound } from './audio/rotor.js';
import { EnvSound } from './audio/environment.js';
import { RadioVoice } from './audio/voice.js';
import { Alarms } from './audio/alarms.js';
import { Music } from './audio/music.js';
import { WinchSound } from './audio/winch.js';
import { Sfx } from './audio/sfx.js';

const CONTROL_HZ = 30;
const EMITTER_HZ = 20;

export class AudioEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;
    this.ready = false;
    this.failed = false;
    this.muted = false;
    this.musicMute = false;
    this.quality = ctx.settings?.get?.('quality') || 'high';
    this._acc = 0;
    this._acc20 = 0;
    this._timers = []; // game-time timers {t, fn}
    this._objDone = new Set();
    this._lastCabin = 0;
    this.meter = { peak: -120, rms: -120, max: -120 };
    this._onGesture = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._onGesture, { capture: true });
    this._onVisibility = () => this._visibility();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  init() {
    this._wire();
    this.ctx.settings?.onChange?.((k) => this._setting(k));
  }

  // ---------------------------------------------------------------------------------------------
  // CONTRACT
  unlock() {
    if (this.failed) return false;
    if (this.ac) {
      const st = this.ac.state;
      if ((st === 'suspended' || st === 'interrupted') && !document.hidden && !this.muted) this.ac.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.failed = true;
      return false;
    }
    try {
      this.ac = new AC({ latencyHint: 'interactive' });
    } catch {
      this.failed = true;
      return false;
    }
    try {
      this._build();
    } catch (err) {
      console.error('[audio] building the graph failed', err);
      this.failed = true;
      try {
        this.ac.close();
      } catch {
        /* ignore */
      }
      this.ac = null;
      return false;
    }
    if (this.ac.state !== 'running') this.ac.resume().catch(() => {});
    this.ready = true;
    // master fade-in 0 → 1, τ 0.8
    this.mix.fadeTau = 0.8;
    this.mix.setSnapshot(this.ctx.mode);
    this.mix.apply(this.ctx.settings, this.ac.currentTime, 0.05);
    setTimeout(() => {
      if (this.mix) this.mix.fadeTau = 0.15;
    }, 3000);
    return true;
  }

  setMuted(m) {
    this.muted = !!m;
    if (!this.ready) return;
    this.mix.muted = this.muted;
    this.mix.apply(this.ctx.settings, this.ac.currentTime, 0.1);
  }

  // play(name, opts) — named one-shots for other systems / tests.
  play(name, opts = {}) {
    if (!this.ready) return false;
    const S = this.sfx;
    const x = opts.x ?? this.ctx.heli?.position?.x ?? 0;
    const z = opts.z ?? this.ctx.heli?.position?.z ?? 0;
    const table = {
      hover: () => S.hover(),
      click: () => S.click(),
      confirm: () => S.confirm(),
      back: () => S.back(),
      deny: () => S.deny(),
      pause: () => S.tune(true),
      resume: () => S.tune(false),
      teletype: () => S.teletype(0),
      typewriter: () => S.typewriter(),
      stamp: () => S.stamp(!!opts.soft),
      static: () => S.static(),
      epirb: () => S.epirb(),
      objective: () => S.objective(),
      bell: () => S.boardBell(opts.n || 1),
      ding: () => S.ding(),
      chapter: () => S.chapter(),
      hit: () => S.hit(opts.amount ?? 0.15),
      landing: () => S.landing(opts.vy ?? 1),
      relay: () => S.relay(opts.on !== false),
      whistle: () => S.whistle(x, z),
      shout: () => S.shout(x, z),
      horn: () => S.horn(x, z),
      foghorn: () => S.foghorn(x, z),
      rocket: () => S.rocket(x, z),
      flare: () => S.flareBurn(x, z, opts.duration || 40),
      splash: () => this.env.crash(x, z, opts.size ?? 0.4),
      crash: () => S.crash(x, z, !!opts.onDeck),
      thunder: () => this.env.thunder(opts.distance ?? 800, opts.dx ?? 0, opts.strength ?? 1, !!opts.cloudOnly),
      gust: () => this.env.gustWhistle(opts.dir, opts.strength ?? 10),
      danger: () => this.alarms.danger(),
      ignition: () => this.rotor.ignite(),
    };
    const fn = table[name];
    if (!fn) return false;
    fn();
    return true;
  }

  stats() {
    return {
      state: this.ac ? this.ac.state : 'locked',
      ready: this.ready,
      sampleRate: this.ac?.sampleRate || 0,
      persistent: this.g?.count || 0,
      voices: this.voices?.active.length || 0,
      started: this.voices?.started || 0,
      stolen: this.voices?.stolen || 0,
      refused: this.voices?.refused || 0,
      alarm: this.alarms?.state.name || null,
      musicI: this.music ? Math.round(this.music.I * 100) / 100 : 0,
      emitters: this.env?.emitters.length || 0,
    };
  }

  // Peak / RMS meter on the master output (or one bus), sampled every 40 ms into this.meter (dBFS).
  // Test/debug only: costs nothing until called; stopMeter() removes it.
  startMeter(bus = null) {
    if (!this.ready) return false;
    const src = bus ? this.mix.bus[bus] : this.mix.limiter;
    if (!src) return false;
    this.stopMeter();
    const an = this.ac.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const sink = this.ac.createGain();
    sink.gain.value = 0;
    an.connect(sink).connect(this.ac.destination);
    const buf = new Float32Array(an.fftSize);
    const m = this.meter;
    m.max = -120;
    this._meter = {
      an,
      src,
      sink,
      id: setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let pk = 0;
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > pk) pk = v;
          sum += buf[i] * buf[i];
        }
        m.peak = 20 * Math.log10(Math.max(1e-6, pk));
        m.rms = 10 * Math.log10(Math.max(1e-12, sum / buf.length));
        m.max = Math.max(m.max, m.peak);
      }, 40),
    };
    return true;
  }

  stopMeter() {
    const M = this._meter;
    if (!M) return;
    clearInterval(M.id);
    try {
      M.src.disconnect(M.an);
      M.an.disconnect();
      M.sink.disconnect();
    } catch {
      /* ignore */
    }
    this._meter = null;
  }

  // ---------------------------------------------------------------------------------------------
  _build() {
    const ac = this.ac;
    this.g = new Graph(ac);
    this.buf = noiseBuffers(ac);
    this.waves = { sub: subWave(ac), horn: hornWave(ac) };
    this.mix = new Mixer(this);
    this.srcA = this._sources(); // rotor, turbine, radio
    this.srcB = this._sources(); // weather, sea, hazards
    this.voices = new Voices(this, 24);
    this.sfx = new Sfx(this);
    this.rotor = new RotorSound(this);
    this.env = new EnvSound(this);
    this.voice = new RadioVoice(this);
    this.alarms = new Alarms(this);
    this.music = new Music(this);
    this.winch = new WinchSound(this);
  }

  // Shared noise loops (stereo, started at random offsets).
  _sources() {
    const t = this.ac.currentTime + 0.01;
    const out = {};
    for (const k of ['white', 'pink', 'brown']) {
      const s = this.g.src(this.buf[k]);
      s.start(t, Math.random() * (s.buffer.duration - 0.1));
      out[k] = s;
    }
    return out;
  }

  _visibility() {
    if (!this.ac) return;
    if (document.hidden) this.ac.suspend().catch(() => {});
    else if (!this.muted) this.ac.resume().catch(() => {});
  }

  _setting(key) {
    if (key === 'quality') {
      this.quality = this.ctx.settings.get('quality') || 'high';
      if (this.ready) this.mix.setQuality();
    }
    if (this.ready) this.mix.apply(this.ctx.settings, this.ac.currentTime, 0.15);
  }

  later(gameSeconds, fn) {
    this._timers.push({ t: (this.ctx.time?.t || 0) + gameSeconds, fn });
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.ready) return;
    const ac = this.ac;
    if (ac.state !== 'running') return;
    const ctx = this.ctx;
    const mode = ctx.mode;
    const now = ac.currentTime;
    // game-time timers (gust telegraphs)
    const gt = ctx.time?.t || 0;
    for (let i = this._timers.length - 1; i >= 0; i--) {
      if (gt >= this._timers[i].t) {
        const tm = this._timers.splice(i, 1)[0];
        try {
          tm.fn();
        } catch (err) {
          console.error('[audio] timer failed', err);
        }
      }
    }
    this.alarms.update(mode);
    // 30 Hz control tick
    this._acc += dt;
    if (this._acc >= 1 / CONTROL_HZ) {
      const cdt = Math.min(this._acc, 0.25);
      this._acc = 0;
      this.mix.apply(ctx.settings, now, 0.6);
      this.rotor.control(now, cdt, mode);
      this.env.control(now, cdt, mode);
      this.music.control(now, cdt, mode, this.quality);
      this.winch.control(now, cdt);
    }
    this._acc20 += dt;
    if (this._acc20 >= 1 / EMITTER_HZ) {
      this._acc20 = 0;
      this.env.emitters20(now);
      this.sfx.track20(now);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Event → sound wiring
  _wire() {
    const ctx = this.ctx;
    const on = (n, fn) =>
      ctx.events.on(n, (p) => {
        if (!this.ready) return;
        try {
          fn(p || {});
        } catch (err) {
          console.error(`[audio] ${n} handler failed`, err);
        }
      });
    const heliPos = () => ctx.heli?.position;
    const sPos = (s) => s?.position || null;

    on('game:mode', ({ from, to }) => {
      this.mix.setSnapshot(to);
      if (to === 'paused') this.sfx.tune(true);
      else if (from === 'paused') this.sfx.tune(false);
      if (to === 'briefing' && from === 'title' && ctx.heli?.landed) this.rotor.ignite();
      if (to === 'title') {
        this.music.reset();
        this.voices.killAll();
      }
    });
    on('mission:setup', () => {
      this.music.reset();
      this._objDone.clear();
      this._lastCabin = 0;
      this._timers.length = 0;
      this.alarms.fuelOnce = false;
      this.alarms.fuelLevel = null;
    });
    on('mission:complete', () => this.music.setStinger('success'));
    on('mission:failed', () => this.music.setStinger('fail'));
    on('mission:objective', ({ objective: o }) => {
      if (!o || !o.done || o.failed || this._objDone.has(o.id) || ctx.mode !== 'play') return;
      this._objDone.add(o.id);
      this.sfx.objective();
    });
    on('mission:chapter', () => ctx.mode === 'play' && this.sfx.chapter());
    on('score:add', (p) => {
      if (p.kind === 'style') this.sfx.stamp(true);
    });

    // radio
    on('radio:line', (p) => {
      this.voice.line(p);
      if (p.fx === 'megaphone') this.sfx.megaphone();
    });

    // weather
    on('weather:gust', (p) => {
      if (ctx.mode !== 'play') return;
      const eta = Number.isFinite(p.eta) ? p.eta : 6;
      const dir = p.dir ? { x: p.dir.x, y: p.dir.y } : null;
      this.later(Math.max(0, eta - 1.4), () => this.env.gustWhistle(dir, p.strength || 8));
    });
    on('weather:lightning', (p) => {
      const hp = heliPos();
      const d = Number.isFinite(p.distance) ? p.distance : hp ? Math.hypot(p.x - hp.x, p.z - hp.z) : 800;
      this.env.thunder(d, hp ? p.x - hp.x : 0, p.strength ?? 1, !!p.cloudOnly);
      this.voice.crackle();
    });
    on('weather:charge', (p) => {
      if (p.heli && ctx.mode === 'play') this.sfx.charge(clamp(p.eta || 2, 0.5, 3.5));
    });

    // hazards
    on('hazard:warning', (p) => {
      if (ctx.mode === 'play' && p.level === 'danger') this.alarms.danger();
    });
    on('hazard:pass', (p) => {
      const hp = heliPos();
      const H = p.hazard?.height || 12;
      if (hp) this.env.crash(hp.x + 20, hp.z, clamp(H / 16, 0.4, 1), 3);
    });
    on('hazard:crest', (p) => {
      if (Number.isFinite(p.x)) this.env.crash(p.x, p.z, clamp((p.height || 8) / 15, 0.3, 1), 2);
    });

    // helicopter
    on('heli:searchlight', (p) => this.sfx.relay(!!p.on));
    on('heli:flare-throw', () => this.sfx.flareThrow());
    on('heli:flare', (p) => this.sfx.flareBurn(p.x, p.z, 40));
    on('heli:touchdown', (p) => this.sfx.landing(Math.abs(p.vy || 1)));
    on('heli:refuel', (p) => this.sfx.refuel(p.state || 'start'));
    on('heli:unload-person', (p) => this.sfx.unloadChime(p.left ?? 0));
    on('heli:unload', () => (this._lastCabin = 0));
    on('heli:resupply', () => this.sfx.resupply());
    on('heli:damage', (p) => {
      if (p.source !== 'water') this.sfx.hit(p.amount || 0.1);
    });
    on('heli:water-strike', (p) => {
      this.env.crash(p.x, p.z, clamp(0.3 + 0.4 * (p.strength || 0.5), 0.3, 0.8), 3);
      this.sfx.hit(0.08);
    });
    on('heli:crash', (p) => {
      const hp = heliPos();
      this.sfx.crash(p.x ?? hp?.x ?? 0, p.z ?? hp?.z ?? 0, !!p.onDeck);
    });
    on('heli:failing', () => this.alarms.danger());
    on('heli:overheat', () => this.sfx.overheat());
    on('heli:tension', (p) => {
      if (p.phase === 'warn') this.alarms.tension();
    });
    on('heli:fuel-low', (p) => this.alarms.fuel(p.level));
    on('heli:capture', () => this.sfx.carabiner());
    on('heli:slip', () => {
      const b = ctx.heli?.winch?.basket;
      if (b) this.env.crash(b.x, b.z, 0.2, 2);
      this.sfx.basketHit(260, 0.7);
    });
    on('heli:snag', () => this.sfx.snag());
    on('heli:winch-denied', () => this.sfx.deny());
    on('heli:loudspeaker', () => {});
    on('heli:raft-throw', () => this.sfx.raftThrow());
    on('heli:raft-drop', (p) => this.sfx.raftInflate(p.x, p.z));

    // survivors
    on('survivor:boarded', () => {
      const n = ctx.heli?.cabin?.length || this._lastCabin + 1;
      this._lastCabin = n;
      this.sfx.boardBell(n);
      this.music.onBoarded();
    });
    on('survivor:signal', (p) => {
      const pos = sPos(p.s);
      const x = p.x ?? pos?.x;
      const z = p.z ?? pos?.z;
      if (!Number.isFinite(x)) return;
      if (p.kind === 'whistle') this.sfx.whistle(x, z);
      else if (p.kind === 'rocket') this.sfx.rocket(x, z);
      else if (p.kind === 'epirb') this.sfx.epirb();
    });
    on('survivor:shout', ({ s }) => {
      const pos = sPos(s);
      if (pos) this.sfx.shout(pos.x, pos.z);
    });
    on('survivor:pet', (p) => {
      const pos = sPos(p.s);
      if (pos && p.pet === 'dog' && p.action === 'bark') this.sfx.bark(pos.x, pos.z);
    });
    on('survivor:creak', (p) => Number.isFinite(p.x) && this.sfx.creak(p.x, p.z));
    on('survivor:sinking', ({ s }) => {
      const pos = sPos(s);
      if (pos) this.sfx.bubbles(pos.x, pos.z);
    });
    on('survivor:capsize', ({ s }) => {
      const pos = sPos(s);
      if (pos) this.env.crash(pos.x, pos.z, 0.35, 2);
    });
    on('survivor:jump', ({ s }) => {
      const pos = sPos(s);
      if (pos) this.env.crash(pos.x, pos.z, 0.12, 1);
    });

    // world
    on('world:horn', (p) => this.sfx.horn(p.x, p.z));
    on('world:foghorn', (p) => this.sfx.foghorn(p.x, p.z));
    on('world:slam', (p) => this.env.crash(p.x, p.z, clamp(0.25 + 0.5 * (p.strength || 0.5), 0.2, 0.8), 1));

    // UI
    on('ui:hover', () => this.sfx.hover());
    on('ui:click', () => this.sfx.confirm());
    on('ui:back', () => this.sfx.back());
    on('ui:stamp', (p) => this.sfx.stamp(!!p.soft));
    on('ui:static', () => this.sfx.static());
    on('ui:type', (p) => {
      if (p.voice === 'typewriter') this.sfx.typewriter();
      else {
        this.sfx.teletype(p.i ?? 0);
        if (p.voice && p.voice !== 'teletype') this.voice.syllableNow(p.ch, p.voice);
      }
    });
    on('camera:zoom', () => this.sfx.click());
  }
}
