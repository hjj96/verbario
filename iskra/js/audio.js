'use strict';
/* ===== Звук: синтезированные эффекты и процедурная музыка (WebAudio, без файлов) ===== */

const AUDIO = (() => {
  let ac = null, master = null, sfxBus = null, musBus = null, musFilter = null, noiseBuf = null;
  const vol = { master: 0.8, sfx: 0.75, music: 0.55 };
  const last = {};
  const THR = { hit: 0.03, kill: 0.035, gem: 0.028, shoot: 0.045, zap: 0.06, boom: 0.07, flame: 0.09, clank: 0.05, missile: 0.08, coin: 0.05, laser: 0.05, mine: 0.06, freeze: 0.1, saw: 0.08, beam: 0.09, swing: 0.06, thump: 0.08, hurt: 0.08, charge: 0.1, rail: 0.06, ui: 0.03, card: 0.03 };
  let gemCombo = 0, gemComboT = 0;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ac.createGain(); master.connect(comp); comp.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.connect(master);
    musFilter = ac.createBiquadFilter(); musFilter.type = 'lowpass'; musFilter.frequency.value = 18000; musFilter.Q.value = 0.7;
    musBus = ac.createGain(); musBus.connect(musFilter); musFilter.connect(master);
    const len = ac.sampleRate * 1.5;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    applyVol();
    startScheduler();
  }
  function applyVol() {
    if (!ac) return;
    master.gain.value = vol.master;
    sfxBus.gain.value = vol.sfx;
    musBus.gain.value = vol.music * 0.55;
  }
  function setVol(k, v) { vol[k] = v; applyVol(); }

  /* --- примитивы --- */
  function osc(type, f0, f1, t, dur, v, bus, opt) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (opt && opt.detune) o.detune.value = opt.detune;
    const a = (opt && opt.a) || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opt && opt.filter) {
      const f = ac.createBiquadFilter();
      f.type = opt.filter; f.frequency.value = opt.ff || 1000; f.Q.value = opt.q || 1;
      if (opt.ff1) f.frequency.exponentialRampToValueAtTime(opt.ff1, t + dur);
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, v, ftype, f0, f1, q, bus) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = ftype || 'lowpass'; f.frequency.setValueAtTime(f0 || 2000, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    const off = Math.random() * 1.2;
    s.start(t, off, dur + 0.05);
  }
  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

  /* --- эффекты --- */
  const S = {
    shoot(p) { const t = ac.currentTime, f = (p && p.f) || 880; osc('square', f * rand(0.95, 1.05), f * 0.4, t, 0.07, 0.045, null, { filter: 'lowpass', ff: 3200 }); },
    laser() { const t = ac.currentTime; osc('sawtooth', 1600, 220, t, 0.13, 0.05, null, { filter: 'bandpass', ff: 1800, q: 2 }); },
    zap() { const t = ac.currentTime; noise(t, 0.12, 0.09, 'bandpass', 3200, 1200, 3); osc('square', 140, 90, t, 0.09, 0.035); },
    hit() { const t = ac.currentTime; noise(t, 0.035, 0.05, 'highpass', 2400); },
    kill() { const t = ac.currentTime; noise(t, 0.07, 0.07, 'bandpass', 1100, 500, 1.5); osc('square', 260 * rand(0.9, 1.1), 70, t, 0.06, 0.025); },
    gem() {
      const t = ac.currentTime;
      if (t - gemComboT > 0.4) gemCombo = 0;
      gemComboT = t; gemCombo = Math.min(gemCombo + 1, 24);
      osc('sine', 1100 + gemCombo * 45, 1500 + gemCombo * 45, t, 0.06, 0.035);
    },
    coin() { const t = ac.currentTime; osc('square', 1560, 1560, t, 0.05, 0.03); osc('square', 2090, 2090, t + 0.05, 0.08, 0.03); },
    heal() { const t = ac.currentTime; [0, 4, 7, 12].forEach((n, i) => osc('triangle', NOTE(72 + n), null, t + i * 0.05, 0.18, 0.06)); },
    boom(p) {
      const t = ac.currentTime, big = p && p.big;
      noise(t, big ? 0.8 : 0.35, big ? 0.3 : 0.16, 'lowpass', big ? 1800 : 1400, 90, 0.7);
      osc('sine', big ? 110 : 140, 38, t, big ? 0.6 : 0.28, big ? 0.35 : 0.18);
    },
    missile() { const t = ac.currentTime; noise(t, 0.16, 0.05, 'bandpass', 600, 2400, 1.2); },
    flame() { const t = ac.currentTime; noise(t, 0.16, 0.05, 'lowpass', 900, 400, 0.6); },
    mine() { const t = ac.currentTime; osc('square', 1200, 1200, t, 0.03, 0.025); },
    saw() { const t = ac.currentTime; osc('sawtooth', 700, 900, t, 0.1, 0.02, null, { filter: 'bandpass', ff: 1500, q: 4 }); },
    freeze() { const t = ac.currentTime; osc('sine', 2600, 1800, t, 0.18, 0.04); osc('sine', 3300, 2400, t + 0.03, 0.15, 0.025); },
    beam() { const t = ac.currentTime; noise(t, 0.1, 0.03, 'bandpass', 4200, 3000, 6); },
    rail() { const t = ac.currentTime; osc('sawtooth', 2400, 90, t, 0.3, 0.09, null, { filter: 'lowpass', ff: 6000, ff1: 300 }); noise(t, 0.25, 0.1, 'highpass', 3000, 600); },
    charge() { const t = ac.currentTime; osc('sine', 300, 1400, t, 0.22, 0.03); },
    hurt() { const t = ac.currentTime; osc('square', 240, 90, t, 0.18, 0.08, null, { filter: 'lowpass', ff: 1400 }); noise(t, 0.1, 0.06, 'lowpass', 1800); },
    shield() { const t = ac.currentTime; noise(t, 0.25, 0.08, 'highpass', 5000, 1500); osc('sine', 2200, 400, t, 0.3, 0.06); },
    dash() { const t = ac.currentTime; noise(t, 0.2, 0.09, 'bandpass', 500, 2600, 1.4); },
    swing() { const t = ac.currentTime; noise(t, 0.14, 0.07, 'bandpass', 2600, 700, 2.2); osc('sine', 500, 180, t, 0.1, 0.03); },
    thump() { const t = ac.currentTime; osc('sine', 150, 50, t, 0.22, 0.16); noise(t, 0.12, 0.05, 'lowpass', 900, 200); },
    blink() { const t = ac.currentTime; osc('sine', 300, 2400, t, 0.12, 0.05); noise(t + 0.1, 0.15, 0.06, 'bandpass', 2400, 600, 2); },
    ui() { const t = ac.currentTime; osc('triangle', 880, 990, t, 0.05, 0.04); },
    card() { const t = ac.currentTime; osc('square', 620, 620, t, 0.03, 0.025, null, { filter: 'lowpass', ff: 2400 }); },
    pick() { const t = ac.currentTime; osc('triangle', NOTE(76), null, t, 0.08, 0.06); osc('triangle', NOTE(83), null, t + 0.06, 0.14, 0.06); },
    levelup() {
      const t = ac.currentTime;
      [0, 4, 7, 11, 14].forEach((n, i) => osc('triangle', NOTE(69 + n), null, t + i * 0.06, 0.25, 0.07));
      noise(t, 0.5, 0.03, 'highpass', 6000, 9000);
    },
    tfStart() {
      const t = ac.currentTime;
      osc('sawtooth', 70, 420, t, 0.75, 0.07, null, { filter: 'lowpass', ff: 300, ff1: 3200, q: 4, a: 0.1 });
      noise(t, 0.75, 0.05, 'bandpass', 400, 5000, 2);
    },
    clank() {
      const t = ac.currentTime, k = rand(0.85, 1.2);
      osc('square', 523 * k, 480 * k, t, 0.09, 0.03, null, { filter: 'bandpass', ff: 2200, q: 3 });
      osc('square', 1307 * k, 1200 * k, t, 0.06, 0.022, null, { filter: 'bandpass', ff: 3000, q: 3 });
      noise(t, 0.03, 0.06, 'highpass', 3000);
    },
    tfBoom() {
      const t = ac.currentTime;
      osc('sine', 120, 35, t, 0.7, 0.32);
      noise(t, 0.6, 0.12, 'lowpass', 3000, 120);
      [57, 64, 69, 76].forEach(n => osc('sawtooth', NOTE(n), null, t, 0.9, 0.025, null, { filter: 'lowpass', ff: 2400, ff1: 500 }));
    },
    formUp() {
      const t = ac.currentTime;
      osc('sawtooth', 55, 880, t, 1.6, 0.08, null, { filter: 'lowpass', ff: 200, ff1: 5000, q: 6, a: 0.3 });
      noise(t, 1.6, 0.06, 'bandpass', 300, 8000, 3);
    },
    formBoom() {
      const t = ac.currentTime;
      osc('sine', 90, 28, t, 1.2, 0.45);
      noise(t, 1.2, 0.2, 'lowpass', 5000, 80);
      [45, 52, 57, 64, 69, 73].forEach((n, i) => osc(i % 2 ? 'sawtooth' : 'square', NOTE(n), null, t + i * 0.015, 2.2, 0.03, null, { filter: 'lowpass', ff: 3000, ff1: 400 }));
    },
    od() {
      const t = ac.currentTime;
      osc('sawtooth', 110, 1320, t, 0.55, 0.08, null, { filter: 'lowpass', ff: 400, ff1: 6000, q: 5 });
      osc('sine', 80, 30, t + 0.45, 0.6, 0.35);
      noise(t + 0.45, 0.5, 0.12, 'lowpass', 4000, 200);
    },
    odEnd() { const t = ac.currentTime; noise(t, 0.6, 0.08, 'highpass', 1200, 6000); osc('sine', 600, 120, t, 0.5, 0.05); },
    chest() {
      const t = ac.currentTime;
      for (let i = 0; i < 10; i++) osc('sine', NOTE(84 + ((i * 5) % 12)), null, t + i * 0.07, 0.12, 0.035);
    },
    reveal() { const t = ac.currentTime; [0, 7, 12, 16, 19].forEach((n, i) => osc('triangle', NOTE(72 + n), null, t + i * 0.04, 0.4, 0.06)); },
    evolve() {
      const t = ac.currentTime;
      [48, 55, 60, 63, 67, 72].forEach((n, i) => osc('sawtooth', NOTE(n), null, t + i * 0.05, 1.8, 0.035, null, { filter: 'lowpass', ff: 600, ff1: 5000, a: 0.1 }));
      osc('sine', 100, 30, t + 0.3, 0.9, 0.3);
    },
    warn() {
      const t = ac.currentTime;
      for (let i = 0; i < 4; i++) { osc('square', 620, 620, t + i * 0.3, 0.14, 0.05, null, { filter: 'lowpass', ff: 2000 }); osc('square', 830, 830, t + i * 0.3 + 0.15, 0.14, 0.05, null, { filter: 'lowpass', ff: 2000 }); }
    },
    elite() { const t = ac.currentTime; osc('sawtooth', 220, 110, t, 0.5, 0.06, null, { filter: 'lowpass', ff: 1200 }); osc('sawtooth', 233, 117, t, 0.5, 0.05, null, { filter: 'lowpass', ff: 1200 }); },
    bossDie() {
      const t = ac.currentTime;
      for (let i = 0; i < 5; i++) { noise(t + i * 0.18, 0.6, 0.18, 'lowpass', 2400, 80); osc('sine', 110, 30, t + i * 0.18, 0.5, 0.25); }
    },
    victory() { const t = ac.currentTime; [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => osc('triangle', NOTE(n), null, t + i * 0.09, 0.6, 0.07)); },
    defeat() { const t = ac.currentTime; [64, 60, 57, 52].forEach((n, i) => osc('sawtooth', NOTE(n), null, t + i * 0.22, 0.5, 0.05, null, { filter: 'lowpass', ff: 1200 })); },
    stamp() { const t = ac.currentTime; noise(t, 0.08, 0.14, 'lowpass', 900, 200); osc('sine', 160, 60, t, 0.12, 0.15); },
    thermo() { const t = ac.currentTime; noise(t, 0.3, 0.12, 'highpass', 2000, 8000); osc('sine', 1800, 300, t, 0.3, 0.05); },
  };

  function sfx(name, p) {
    if (!ac || ac.state !== 'running') return;
    const fn = S[name]; if (!fn) return;
    const now = ac.currentTime, th = THR[name] || 0.02;
    if (last[name] !== undefined && now - last[name] < th) return;
    last[name] = now;
    try { fn(p); } catch (e) { /* узел не создан — пропускаем */ }
  }

  /* ===== Музыка ===== */
  // режимы: 0 — тишина, 1 — меню, 2 — бой, 3 — босс
  let mode = 0, nextMode = 0, step = 0, nextTime = 0, timer = null, muffled = false, sector = 0;
  const PROG = [
    [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], // Am F C G
    [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], // Dm Bb F C
    [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]], // Em C D B
  ];
  const BASS_PAT = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1];
  const BPM = [0, 96, 122, 136];

  function startScheduler() {
    if (timer) return;
    nextTime = ac.currentTime + 0.1;
    timer = setInterval(schedule, 25);
  }
  function schedule() {
    if (!ac || ac.state !== 'running') return;
    if (nextTime < ac.currentTime - 0.3) nextTime = ac.currentTime + 0.05;
    while (nextTime < ac.currentTime + 0.14) {
      if (step % 16 === 0 && nextMode !== mode) { mode = nextMode; }
      if (mode) playStep(step, nextTime);
      const bpm = BPM[mode] || 100;
      nextTime += 60 / bpm / 4;
      step = (step + 1) % 64;
    }
  }
  function mKick(t, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g); g.connect(musBus); o.start(t); o.stop(t + 0.34);
  }
  function mHat(t, v, open) { noise(t, open ? 0.12 : 0.035, v, 'highpass', 7500, null, 0.7, musBus); }
  function mSnare(t, v) { noise(t, 0.16, v, 'bandpass', 1900, 900, 0.9, musBus); osc('triangle', 190, 140, t, 0.08, v * 0.6, musBus); }
  function mBass(t, n, dur, v, grit) {
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = NOTE(n);
    f.type = 'lowpass'; f.Q.value = grit ? 8 : 4;
    f.frequency.setValueAtTime(grit ? 1600 : 900, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(musBus); o.start(t); o.stop(t + dur + 0.02);
  }
  function mPad(t, notes, dur, v) {
    for (const n of notes) {
      for (const dt of [-7, 7]) {
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = dt;
        f.type = 'lowpass'; f.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f); f.connect(g); g.connect(musBus); o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }
  function playStep(s, t) {
    const prog = PROG[sector % PROG.length];
    const bar = Math.floor(s / 16), st = s % 16;
    const chord = prog[bar];
    const root = chord[0] - 24;
    if (mode === 1) {
      if (st === 0) mPad(t, chord, 60 / BPM[1] * 4, 0.022);
      if (st === 0 || st === 10) mKick(t, 0.32);
      if (st % 4 === 2) mHat(t, 0.025);
      if (st % 2 === 0) {
        const n = chord[(st / 2) % 3] + 12 + (st >= 8 ? 12 : 0);
        osc('triangle', NOTE(n), null, t, 0.22, 0.03, musBus);
      }
      if (BASS_PAT[st] && st % 4 === 0) mBass(t, root, 0.4, 0.07);
      return;
    }
    const boss = mode === 3;
    if (st % 4 === 0) mKick(t, boss ? 0.5 : 0.42);
    if (st === 4 || st === 12) mSnare(t, boss ? 0.11 : 0.08);
    if (boss && st === 15 && bar === 3) mSnare(t, 0.07);
    if (boss) mHat(t, st % 2 ? 0.02 : 0.035, st % 8 === 6);
    else if (st % 2 === 1) mHat(t, 0.03, st % 8 === 7);
    if (BASS_PAT[st]) mBass(t, root + (st === 14 ? 12 : 0), 0.16, boss ? 0.12 : 0.1, boss);
    if (st % 2 === 0) {
      const idx = [0, 1, 2, 1, 0, 2, 1, 2][(st / 2) | 0];
      const n = chord[idx] + 12 + ((bar % 2 && st >= 8) ? 12 : 0);
      osc('square', NOTE(n), null, t, 0.12, boss ? 0.018 : 0.014, musBus, { filter: 'lowpass', ff: boss ? 3200 : 2200 });
    }
    if (boss && st % 8 === 0) {
      const lead = [chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 12][bar];
      osc('sawtooth', NOTE(lead), null, t, 0.5, 0.022, musBus, { filter: 'lowpass', ff: 2600, a: 0.02 });
    }
    if (st === 0) mPad(t, chord, 60 / BPM[mode] * 4, boss ? 0.008 : 0.012);
  }
  function music(m, sec) {
    if (sec !== undefined) sector = sec;
    nextMode = m;
    if (mode === 0 || m === 0) mode = m;
  }
  function muffle(on) {
    if (!ac || muffled === on) return;
    muffled = on;
    const t = ac.currentTime;
    musFilter.frequency.cancelScheduledValues(t);
    musFilter.frequency.setValueAtTime(musFilter.frequency.value, t);
    musFilter.frequency.exponentialRampToValueAtTime(on ? 650 : 18000, t + 0.35);
  }
  function suspend(on) { if (!ac) return; if (on) ac.suspend().catch(() => {}); else ac.resume().catch(() => {}); }

  return { init, sfx, setVol, vol, music, muffle, suspend, get ready() { return !!ac && ac.state === 'running'; } };
})();
