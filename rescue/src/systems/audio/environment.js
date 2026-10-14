// Wind, rain, sea, thunder and hazard emitters (DESIGN §6.3, §6.6 «Мир»). All on the world bus.
//
// Wind (W = |windAt(heli)|, A = airspeed): bed pink → LP clamp(250+90W, 250, 3000), −34+22·min(1, W/30) dB;
// blow white → BP 500+35A, −40+20·min(1, A/40) dB; howl two BP Q 14 at 380/610 Hz with a ±18 % random
// walk, panned from windward, −60+34·smoothstep(10, 28, W) dB; gust telegraph at eta−1.4 s (white BP
// 300 → 1400 Hz over 1.4 s, windward → centre).
// Rain: sheet pink HP 600/LP 7000 (−40+24·rain dB), hiss white HP 4.5 kHz, droplets (pre-rendered
// Minnaert loop), hail [SHOULD] (Poisson clicks with a hull ring) built on first hail.
// Sea: swell brown → LP 140+40Hs → VCA (LFO 1/T + 1/(1.618T), T = 4+1.1Hs); whitecaps white BP 1.6 kHz
// on the same LFO shifted T/4 (cosine); group LP 6000·exp(−alt/120)+500 («наверху ротор, внизу море»);
// crash(pos, size) breakers; rogue approach rumble (brown LP 110, −60 → −14 dB over eta) and suction hiss
// in the last 3 s (BP 2500 → 600).
// Thunder: delay d < 120 ? 0 : min(d/343, 9); crack (d < 700, not in-cloud): 4–7 white HP 1.8 kHz
// micro-bursts; rumble brown LP 80+900·exp(−d/1400), 3–6 swells over min(9, 2.5+d/500); sub 32–45 Hz
// through tanh; reverb −6 dB; in-cloud: rumble only, −6 dB; ≤ 2 at once.
// Levels: every filtered layer gets a makeup gain equal to its measured peak loss (offline render of the
// shared noise loops through the same filters), so the DESIGN's dB formulas are true peak levels.
// Emitters: waterspout/tornado (brown LP 500 + pink BP 220 Q 2, 0.7 Hz sway, whistle 150–300 Hz,
// audible from 800 m), whirlpool (brown LP 200 + bubbles) — positional, recomputed at 20 Hz.
import { dB, clamp, smoothstep, cosWave, subWave, tanhCurve, minnaertBuffer, hailBuffer, bubbleBuffer } from './dsp.js';
import { ctl, emitterLaw } from './graph.js';

const VORTEX = new Set(['waterspout', 'tornado']);

export class EnvSound {
  constructor(eng) {
    this.eng = eng;
    this.howlWalk = [0, 0];
    this.hail = null;
    this.rogue = null;
    this.emitters = []; // {hazard, kind, nodes…}
    this._law = { pan: 0, gain: 0, lpf: 0, d: 0 };
    this._wind = new eng.ctx.THREE.Vector2();
    this.thunders = 0;
    this._build();
  }

  _build() {
    const { g, ac, mix } = this.eng;
    const B = this.eng.srcB;
    const W = mix.bus.world;
    // --- wind
    this.bedG = g.gain(0, g.gain(dB(5), W));
    this.bedLP = g.filter('lowpass', 250, 0.6, this.bedG);
    B.pink.connect(this.bedLP);
    this.blowG = g.gain(0, g.gain(dB(8), W));
    this.blowBP = g.filter('bandpass', 600, 0.9, this.blowG);
    B.white.connect(this.blowBP);
    this.howlPan = g.pan(0, W);
    this.howlG = g.gain(0, g.gain(dB(22), this.howlPan));
    this.howl = [g.filter('bandpass', 380, 14, this.howlG), g.filter('bandpass', 610, 14, this.howlG)];
    for (const h of this.howl) B.pink.connect(h);
    // --- rain
    this.sheetG = g.gain(0, g.gain(dB(8), W));
    const sheetLP = g.filter('lowpass', 7000, 0.5, this.sheetG);
    B.pink.connect(g.filter('highpass', 600, 0.5, sheetLP));
    this.hissG = g.gain(0, W);
    B.white.connect(g.filter('highpass', 4500, 0.6, this.hissG));
    this.dropsG = g.gain(0, W);
    this.drops = g.src(minnaertBuffer(ac));
    this.drops.connect(this.dropsG);
    // --- sea (group LP by altitude)
    this.seaLP = g.filter('lowpass', 6000, 0.5, W);
    this.swellG = g.gain(0, g.gain(dB(7), this.seaLP));
    this.swellVca = g.gain(0.7, this.swellG);
    this.swellLP = g.filter('lowpass', 160, 0.7, this.swellVca);
    B.brown.connect(this.swellLP);
    this.lfo1 = g.osc('sine', 0.2);
    this.lfo2 = g.osc('sine', 0.2 / 1.618);
    this.lfo1.connect(g.gain(0.22, this.swellVca.gain));
    this.lfo2.connect(g.gain(0.1, this.swellVca.gain));
    this.capsG = g.gain(0, g.gain(dB(7.5), this.seaLP));
    this.capsVca = g.gain(0.5, this.capsG);
    B.white.connect(g.filter('bandpass', 1600, 0.8, this.capsVca));
    this.lfoC = g.osc(null, 0.2, cosWave(ac));
    this.lfoC.connect(g.gain(0.45, this.capsVca.gain));
    const t0 = ac.currentTime + 0.02;
    this.drops.start(t0, Math.random() * 2.9);
    for (const o of [this.lfo1, this.lfo2, this.lfoC]) o.start(t0);
  }

  _buildHail() {
    const { g, ac, mix } = this.eng;
    const lvl = g.gain(0, mix.bus.world);
    const s = g.src(hailBuffer(ac));
    s.connect(lvl);
    s.start();
    this.hail = lvl;
  }

  _buildRogue() {
    const { g, mix } = this.eng;
    const B = this.eng.srcB;
    const rum = g.gain(0, g.gain(dB(9), mix.bus.world));
    B.brown.connect(g.filter('lowpass', 110, 0.8, rum));
    const hiss = g.gain(0, g.gain(dB(8), mix.bus.world));
    const bp = g.filter('bandpass', 2500, 1.2, hiss);
    B.white.connect(bp);
    this.rogue = { rum, hiss, bp };
  }

  // 30 Hz control tick
  control(now, dt, mode) {
    const e = this.eng;
    const ctx = e.ctx;
    const ws = ctx.weather?.state || {};
    const h = ctx.heli || {};
    const p = h.position;
    // --- wind
    let W = ws.windSpeed || 0;
    if (p && ctx.weather?.windAt) {
      try {
        W = ctx.weather.windAt(p.x, p.z, this._wind).length();
      } catch {
        /* keep the mean */
      }
    }
    const A = mode === 'play' && !h.landed ? h.airspeed ?? h.speed ?? 0 : 0;
    ctl(this.bedLP.frequency, clamp(250 + 90 * W, 250, 3000), now, 0.15);
    ctl(this.bedG.gain, dB(-34 + 22 * Math.min(1, W / 30)), now, 0.2);
    ctl(this.blowBP.frequency, 500 + 35 * A, now, 0.15);
    ctl(this.blowG.gain, A > 0.5 ? dB(-40 + 20 * Math.min(1, A / 40)) : 0, now, 0.2);
    for (let i = 0; i < 2; i++) {
      this.howlWalk[i] = clamp(this.howlWalk[i] + (Math.random() - 0.5) * 0.06, -0.18, 0.18);
      ctl(this.howl[i].frequency, (i ? 610 : 380) * (1 + this.howlWalk[i]), now, 0.25);
    }
    const wd = ws.windDir;
    ctl(this.howlPan.pan, wd ? clamp(-wd.x * 0.7, -0.7, 0.7) : 0, now, 0.5);
    ctl(this.howlG.gain, dB(-60 + 34 * smoothstep(10, 28, W)) * (W > 6 ? 1 : 0), now, 0.3);
    // --- rain / hail
    const rain = ws.rain || 0;
    ctl(this.sheetG.gain, rain > 0.01 ? dB(-40 + 24 * rain) : 0, now, 0.4);
    ctl(this.hissG.gain, rain > 0.01 ? dB(-48 + 22 * rain) : 0, now, 0.4);
    // droplets lead at light rain (rare big circles first), sit under the sheet in a downpour
    ctl(this.dropsG.gain, rain > 0.01 ? dB(-34 + 10 * Math.sqrt(rain)) : 0, now, 0.4);
    const hail = ws.hail || 0;
    if (hail > 0.02 && !this.hail) this._buildHail();
    if (this.hail) ctl(this.hail.gain, hail > 0.02 ? dB(-30 + 14 * hail) : 0, now, 0.3);
    // --- sea
    const Hs = ws.waveHeight ?? ws.palette?.sea?.Hs ?? 1;
    const T = 4 + 1.1 * Hs;
    ctl(this.lfo1.frequency, 1 / T, now, 1);
    ctl(this.lfo2.frequency, 1 / (1.618 * T), now, 1);
    ctl(this.lfoC.frequency, 1 / T, now, 1);
    ctl(this.swellLP.frequency, 140 + 40 * Hs, now, 0.5);
    ctl(this.swellG.gain, dB(-28 + 6 * Math.min(1, Hs / 6)), now, 0.5);
    const caps = ws.palette?.sea?.whitecaps ?? clamp((Hs - 1) / 6, 0, 1);
    ctl(this.capsG.gain, dB(-42 + 18 * clamp(caps * 1.6 + Hs / 12, 0, 1)), now, 0.5);
    const alt = mode === 'play' ? h.altitude ?? 40 : 60;
    ctl(this.seaLP.frequency, 6000 * Math.exp(-alt / 120) + 500, now, 0.2);
    // --- rogue approach
    this._rogue(now, mode);
  }

  _rogue(now, mode) {
    const hz = this.eng.ctx.hazards;
    let best = null;
    if (mode === 'play' && hz?.list) {
      for (const r of hz.list) {
        if (r.type !== 'rogue' || r.alive === false || !(r.eta > 0) || (r.threat ?? 1) < 0.15) continue;
        if (!best || r.eta < best.eta) best = r;
      }
    }
    if (!best && !this.rogue) return;
    if (!this.rogue) this._buildRogue();
    const R = this.rogue;
    if (!best) {
      ctl(R.rum.gain, 0, now, 0.8);
      ctl(R.hiss.gain, 0, now, 0.3);
      return;
    }
    const k = 1 - clamp(best.eta / 12, 0, 1);
    ctl(R.rum.gain, dB(-60 + 46 * k), now, 0.2);
    const s = best.eta < 3 ? 1 - best.eta / 3 : 0;
    ctl(R.bp.frequency, 2500 - 1900 * s, now, 0.1);
    ctl(R.hiss.gain, s > 0 ? dB(-36 + 16 * s) : 0, now, 0.1);
  }

  // 20 Hz: hazard emitters (nearest 2 vortices + 1 whirlpool)
  emitters20(now) {
    const e = this.eng;
    const ctx = e.ctx;
    const hz = ctx.hazards?.list || [];
    const p = ctx.heli?.position;
    if (!p) return;
    const rain = ctx.weather?.state?.rain || 0;
    // drop emitters whose hazard ended
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (em.hazard.alive === false || !hz.includes(em.hazard) || ctx.mode === 'title') this._dropEmitter(i, now);
    }
    if (ctx.mode !== 'play' && ctx.mode !== 'paused' && ctx.mode !== 'debrief') return;
    for (const h of hz) {
      if (h.alive === false || !h.position) continue;
      const vortex = VORTEX.has(h.type);
      if (!vortex && h.type !== 'whirlpool') continue;
      if (this.emitters.some((em) => em.hazard === h)) continue;
      const d = Math.hypot(h.position.x - p.x, h.position.z - p.z);
      if (d > 1100) continue;
      const same = this.emitters.filter((em) => em.vortex === vortex).length;
      if (same >= (vortex ? 2 : 1)) continue;
      const { res, nodes } = e.g.group(() => (vortex ? this._spout(h) : this._whirl(h)));
      res.nodes = nodes;
      this.emitters.push(res);
    }
    const L = this._law;
    for (const em of this.emitters) {
      const hp = em.hazard.position;
      emitterLaw(hp.x - p.x, hp.z - p.z, rain, L);
      const big = em.hazard.type === 'tornado';
      // vortex audibility law: the roar carries ~800 m (DESIGN §6.6), so its distance gain is softened
      const gain = em.vortex ? Math.min(1, L.gain * (big ? 9 : 6)) : L.gain;
      const st = em.hazard.stage ?? 4;
      const stageK = em.vortex ? (st >= 5 ? 0.5 : st >= 4 ? 1 : st >= 3 ? 0.6 : st >= 2 ? 0.25 : 0.1) : clamp(em.hazard.strength ?? 1, 0, 1);
      ctl(em.pan.pan, L.pan, now, 0.08);
      ctl(em.lp.frequency, Math.max(L.lpf, em.vortex ? 900 : 400), now, 0.1);
      ctl(em.out.gain, gain * stageK * em.level, now, 0.15);
      if (em.whistle) ctl(em.whistle.frequency, 150 + 150 * clamp((em.hazard.spin ?? 1) / 3, 0, 1) * (0.8 + 0.2 * Math.sin(now * 0.7)), now, 0.3);
    }
  }

  _spout(hz) {
    const { g, ac, mix } = this.eng;
    const B = this.eng.srcB;
    const big = hz.type === 'tornado';
    const pan = g.pan(0, mix.bus.world);
    const out = g.gain(0, pan);
    const lp = g.filter('lowpass', 2000, 0.5, out);
    const sway = g.gain(0.75, lp);
    const roar = g.filter('lowpass', big ? 350 : 500, 0.8, sway);
    const body = g.filter('bandpass', big ? 160 : 220, 2, g.gain(dB(9), sway));
    B.brown.connect(roar);
    B.pink.connect(body);
    const whistle = g.filter('bandpass', 220, 9, g.gain(dB(14), sway));
    B.white.connect(whistle);
    const lfo = g.osc('sine', 0.7);
    lfo.connect(g.gain(0.25, sway.gain));
    lfo.start();
    return { hazard: hz, vortex: true, pan, out, lp, whistle, level: big ? dB(-9) : dB(-13) };
  }

  _whirl(hz) {
    const { g, ac, mix } = this.eng;
    const B = this.eng.srcB;
    const pan = g.pan(0, mix.bus.world);
    const out = g.gain(0, pan);
    const lp = g.filter('lowpass', 2000, 0.5, out);
    B.brown.connect(g.filter('lowpass', 200, 0.8, lp));
    if (!this.eng._bubbles) this.eng._bubbles = bubbleBuffer(ac);
    const bub = g.src(this.eng._bubbles);
    bub.connect(g.gain(0.5, lp));
    bub.start(ac.currentTime, Math.random() * 2.5);
    return { hazard: hz, vortex: false, pan, out, lp, level: dB(-10) };
  }

  _dropEmitter(i, now) {
    const em = this.emitters[i];
    this.emitters.splice(i, 1);
    em.out.gain.cancelScheduledValues(now);
    em.out.gain.setTargetAtTime(0, now, 0.4);
    const g = this.eng.g;
    const B = this.eng.srcB;
    setTimeout(() => g.release(em.nodes, [B.white, B.pink, B.brown]), 2500);
  }

  // ---------------------------------------------------------------------------------------------
  // One-shots

  // Gust telegraph: white → BP 300 → 1400 Hz over 1.4 s, panned from windward to centre.
  gustWhistle(dir, strength) {
    const e = this.eng;
    const ac = e.ac;
    const pan0 = dir ? clamp(-(dir.x || 0) * 0.85, -0.85, 0.85) : 0;
    const lvl = dB(-26 + 10 * clamp((strength - 4) / 12, 0, 1));
    e.voices.start(3, (v) => {
      const t = ac.currentTime;
      const out = v.n(ac.createGain());
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(lvl, t + 1.2);
      out.gain.setTargetAtTime(0, t + 1.45, 0.25);
      const pan = v.n(ac.createStereoPanner());
      pan.pan.setValueAtTime(pan0, t);
      pan.pan.linearRampToValueAtTime(0, t + 1.4);
      const bp = v.n(ac.createBiquadFilter());
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1400, t + 1.4);
      const s = v.n(ac.createBufferSource());
      s.buffer = e.buf.white;
      s.connect(bp).connect(out).connect(pan).connect(e.mix.bus.world);
      v.out = out;
      v.play(s, t, t + 2.6);
    }, 'gust');
  }

  // Breaking water (DESIGN §6.3 crash(pos, size)): brown LP 1800 → 250 over 2.5 s, white BP 900 → 500,
  // sub 42 → 28 Hz, 30 % into the reverb. size 0..1.
  crash(x, z, size = 1, prio = 2) {
    const e = this.eng;
    const ac = e.ac;
    const p = e.ctx.heli?.position;
    const L = emitterLaw(p ? x - p.x : 0, p ? z - p.z : 0, e.ctx.weather?.state?.rain || 0, this._law);
    const lvl = dB(-14 + 8 * clamp(size, 0, 1)) * Math.min(1, L.gain * 2);
    if (lvl < 0.003) return;
    const dur = 1.2 + 1.6 * clamp(size, 0, 1);
    e.voices.start(prio, (v) => {
      const t = ac.currentTime;
      const out = v.n(ac.createGain());
      out.gain.value = lvl;
      const pan = v.n(ac.createStereoPanner());
      pan.pan.value = L.pan;
      out.connect(pan).connect(e.mix.bus.world);
      const wet = v.n(ac.createGain());
      wet.gain.value = 0.3;
      out.connect(wet).connect(e.mix.send);
      // brown body
      const b = v.n(ac.createBufferSource());
      b.buffer = e.buf.brown;
      const lp = v.n(ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(250, t + dur);
      const bg = v.n(ac.createGain());
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(1, t + 0.04);
      bg.gain.setTargetAtTime(0, t + 0.1, dur / 3);
      b.connect(lp).connect(bg).connect(out);
      // white wash
      const w = v.n(ac.createBufferSource());
      w.buffer = e.buf.white;
      const bp = v.n(ac.createBiquadFilter());
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + dur);
      const wg = v.n(ac.createGain());
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(0.5, t + 0.08);
      wg.gain.setTargetAtTime(0, t + 0.2, dur / 4);
      w.connect(bp).connect(wg).connect(out);
      // sub
      const o = v.n(ac.createOscillator());
      o.setPeriodicWave(e.waves.sub);
      o.frequency.setValueAtTime(42, t);
      o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.6);
      const og = v.n(ac.createGain());
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.6 * size, t + 0.03);
      og.gain.setTargetAtTime(0, t + 0.1, dur / 5);
      o.connect(og).connect(out);
      v.out = out;
      v.play(b, t, t + dur + 0.6);
      v.play(w, t, t + dur + 0.4);
      v.play(o, t, t + dur);
    }, 'crash');
  }

  // Thunder for a strike at distance d (m), dx = east offset (for the pan).
  thunder(d, dx, strength = 1, cloudOnly = false) {
    const e = this.eng;
    const ac = e.ac;
    if (e.voices.count('thunder') >= 2) return; // ≤ 2 at once
    const delay = d < 120 ? 0 : Math.min(d / 343, 9);
    const dur = Math.min(9, 2.5 + d / 500);
    const near = 1 - clamp(d / 3000, 0, 1);
    const lvl = dB((cloudOnly ? -6 : 0) - 9 - 12 * (1 - near)) * clamp(0.6 + 0.4 * strength, 0.4, 1);
    const pan = clamp(dx / (Math.abs(dx) + 400), -0.7, 0.7);
    const lpf = 80 + 900 * Math.exp(-d / 1400);
    e.voices.start(4, (v) => {
      const t = ac.currentTime + delay;
      const out = v.n(ac.createGain());
      out.gain.value = lvl;
      const pn = v.n(ac.createStereoPanner());
      pn.pan.value = pan;
      out.connect(pn).connect(e.mix.bus.world);
      const wet = v.n(ac.createGain());
      wet.gain.value = dB(-6);
      out.connect(wet).connect(e.mix.send);
      v.out = out;
      // rumble: 3–6 swells
      const b = v.n(ac.createBufferSource());
      b.buffer = e.buf.brown;
      b.playbackRate.value = 0.8 + 0.3 * Math.random();
      const lp = v.n(ac.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = lpf;
      lp.Q.value = 0.6;
      const rg = v.n(ac.createGain());
      rg.gain.setValueAtTime(0, t);
      const n = 3 + Math.floor(Math.random() * 4);
      let tt = t;
      for (let i = 0; i < n; i++) {
        const seg = (dur / n) * (0.6 + 0.8 * Math.random());
        const peak = (1 - i / (n + 1)) * (0.6 + 0.4 * Math.random()) * 1.6;
        rg.gain.setTargetAtTime(peak, tt, 0.05 + 0.1 * Math.random());
        rg.gain.setTargetAtTime(peak * 0.25, tt + seg * 0.35, seg * 0.3);
        tt += seg * 0.8;
      }
      rg.gain.setTargetAtTime(0, Math.min(t + dur, tt), 0.6);
      b.connect(lp).connect(rg).connect(out);
      v.play(b, t, t + dur + 3);
      // sub 32–45 Hz through tanh
      const o = v.n(ac.createOscillator());
      o.frequency.value = 32 + 13 * Math.random();
      o.setPeriodicWave(e.waves.sub);
      const sg = v.n(ac.createGain());
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.9 * near + 0.2, t + 0.15);
      sg.gain.setTargetAtTime(0, t + 0.4, dur / 4);
      const sh = v.n(ac.createWaveShaper());
      sh.curve = tanhCurve(2);
      o.connect(sg).connect(sh).connect(out);
      v.play(o, t, t + dur + 1);
      // crack: 4–7 micro-bursts of white HP 1.8 kHz (close sea strikes only)
      if (d < 700 && !cloudOnly) {
        const w = v.n(ac.createBufferSource());
        w.buffer = e.buf.white;
        const hp = v.n(ac.createBiquadFilter());
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        const cg = v.n(ac.createGain());
        cg.gain.setValueAtTime(0, t);
        const k = 4 + Math.floor(Math.random() * 4);
        let ct = t;
        for (let i = 0; i < k; i++) {
          const a = (1.6 - i * 0.15) * (1 - d / 900);
          cg.gain.setValueAtTime(a, ct);
          cg.gain.setTargetAtTime(0, ct + 0.004, 0.012 + 0.02 * Math.random());
          ct += 0.02 + 0.05 * Math.random();
        }
        w.connect(hp).connect(cg).connect(out);
        v.play(w, t, ct + 0.4);
      }
    }, 'thunder');
  }
}
