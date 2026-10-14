// Radio voice (DESIGN §6.4): the channel chain, squelch, interference and the vowel-formant «babble»
// synced to the HUD typewriter (22 ms per character, a syllable per typed vowel).
//
// Chain (one persistent graph, reconfigured per line):
//   КАН 16 (ext)   HP 380 → LP 2800 → peak 1.6 kHz +5 dB → tanh k = 4 + 6·interference (ship +3)
//   СПУ (ics)      HP 250 → LP 4200, a 1 ms click at the start and the end, no static
//   рация          as ext, plus the survivor's heavier interference and a 7 Hz ±40 cent tremor
//   мегафон        BP 500–3000, hard clip, 120 ms echo (the loudspeaker, w_horn)
// Squelch: opening burst of white BP 2.2 kHz 70 ms, «кшш» tail 140 ms; static bed ∝ interference;
// lightning during a line: +12 dB of crackle for 180 ms.
// Babble: sawtooth f0 → two parallel band-passes (F1/F2 per vowel: а 750/1250, о 520/900, у 340/750,
// э/е 470/1950, и 290/2250, ы 330/1550), sibilants as noise 3–5 kHz, plosives as short bursts;
// intonation falls 3 semitones over a phrase, «?» lifts the end.
import { dB, clamp, tanhCurve, clipCurve } from './dsp.js';

const CHAR_S = 0.022;
const F0 = { dispatch: 215, pilot: 122, winchman: 138, rescuer: 150, ship: 95, coastguard: 105, survivor: 185, f: 210, child: 290, m: 118 };
const FORMANT_K = { f: 1.14, child: 1.3, dispatch: 1.12, survivor: 1.05 };
const VOWEL = {
  а: [750, 1250], я: [750, 1250], о: [520, 900], ё: [520, 900], у: [340, 750], ю: [340, 750],
  э: [470, 1950], е: [470, 1950], и: [290, 2250], ы: [330, 1550],
};
const FRIC = { с: 4800, ш: 2800, щ: 3600, ж: 2600, з: 4200, ф: 3800, х: 2000, ц: 4500, ч: 3200 };
const PLOSIVE = { п: 1400, т: 2600, к: 1800, б: 900, д: 2000, г: 1500 };
const PHRASE_END = /[.!?…]/;

export class RadioVoice {
  constructor(eng) {
    this.eng = eng;
    this.activeUntil = 0;
    this.lineStart = 0;
    this.bed = 0;
    this._cfgKey = '';
    this._liveCfgT = -1;
    this._build();
  }

  _build() {
    const { g, mix } = this.eng;
    const A = this.eng.srcA;
    this.post = g.gain(1, mix.bus.radio);
    this.echoG = g.gain(0, mix.bus.radio);
    this.echo = g.delay(0.3, 0.12, this.echoG);
    this.post.connect(this.echo);
    this.shaper = g.shaper(tanhCurve(4), this.post);
    this.peak = g.filter('peaking', 1600, 1.0, this.shaper);
    this.peak.gain.value = 5;
    this.lp = g.filter('lowpass', 2800, 0.7, this.peak);
    this.hp = g.filter('highpass', 380, 0.7, this.lp);
    this.input = g.gain(1, this.hp);
    // voice
    this.vca = g.gain(0, this.input);
    this.saw = g.osc('sawtooth', 140);
    this.f1 = g.filter('bandpass', 600, 6, this.vca);
    this.f2g = g.gain(0.55, this.vca);
    this.f2 = g.filter('bandpass', 1300, 8, this.f2g);
    this.saw.connect(this.f1);
    this.saw.connect(this.f2);
    this.vib = g.osc('sine', 7);
    this.vibDepth = g.gain(0, this.saw.detune);
    this.vib.connect(this.vibDepth);
    // fricatives / plosives
    this.fricVca = g.gain(0, this.input);
    this.fricBP = g.filter('bandpass', 4000, 1.6, this.fricVca);
    A.white.connect(this.fricBP);
    // static & squelch
    this.stVca = g.gain(0, this.input);
    this.stBP = g.filter('bandpass', 2200, 0.7, this.stVca);
    A.white.connect(this.stBP);
    const t = this.eng.ac.currentTime + 0.02;
    this.saw.start(t);
    this.vib.start(t);
  }

  // Channel configuration (set at the start of a line).
  _configure(t, channel, voice, interference, fx) {
    const key = `${channel}|${voice}|${Math.round(interference * 10)}|${fx || ''}`;
    if (key === this._cfgKey) return;
    this._cfgKey = key;
    const set = (p, v) => {
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    };
    if (fx === 'megaphone') {
      set(this.hp.frequency, 500);
      set(this.lp.frequency, 3000);
      set(this.peak.gain, 6);
      set(this.peak.frequency, 1200);
      this.shaper.curve = clipCurve(5);
      set(this.post.gain, dB(-16));
      set(this.echoG.gain, 0.35);
      this.bed = 0;
    } else if (channel === 'ics') {
      set(this.hp.frequency, 250);
      set(this.lp.frequency, 4200);
      set(this.peak.gain, 0);
      this.shaper.curve = tanhCurve(1);
      set(this.post.gain, dB(-4));
      set(this.echoG.gain, 0);
      this.bed = 0;
    } else {
      const k = 4 + 6 * interference + (voice === 'ship' ? 3 : 0);
      set(this.hp.frequency, channel === 'handheld' ? 450 : 380);
      set(this.lp.frequency, channel === 'handheld' ? 2400 : 2800);
      set(this.peak.gain, 5);
      set(this.peak.frequency, 1600);
      this.shaper.curve = tanhCurve(Math.round(k * 2) / 2);
      set(this.post.gain, dB(-12 - 2 * interference));
      set(this.echoG.gain, 0);
      this.bed = dB(-30) * (0.3 + 1.4 * interference);
    }
    set(this.vibDepth.gain, voice === 'survivor' ? 40 : 5);
    set(this.vib.frequency, voice === 'survivor' ? 7 : 5.2);
  }

  // Silence the current line (interrupted by a new one).
  _cut(now) {
    for (const p of [this.vca.gain, this.fricVca.gain, this.stVca.gain]) {
      p.cancelScheduledValues(now);
      p.setTargetAtTime(0, now, 0.008);
    }
    for (const p of [this.f1.frequency, this.f2.frequency, this.saw.frequency, this.fricBP.frequency]) p.cancelScheduledValues(now);
  }

  // A radio:line — schedule the whole babble now (the HUD types it from this moment).
  line(p) {
    const ac = this.eng.ac;
    const now = ac.currentTime;
    const text = String(p.text || '');
    if (!text) return;
    const voice = p.voice || p.speaker || 'dispatch';
    const channel = p.fx === 'megaphone' ? 'ics' : p.channel || 'ext';
    let I = p.interference;
    if (!Number.isFinite(I)) I = channel === 'ics' ? 0 : clamp(0.15 + 0.6 * (this.eng.ctx.weather?.state?.intensity || 0) + 0.3, 0, 1);
    if (now < this.activeUntil) this._cut(now);
    const t0 = now + 0.025;
    this._cfgKey = '';
    this._configure(t0 - 0.004, channel, voice, I, p.fx);
    const st = this.stVca.gain;
    const end = t0 + text.length * CHAR_S;
    if (p.fx === 'megaphone') {
      // nothing: the loudspeaker has its own feedback chirp (sfx)
    } else if (channel === 'ics') {
      st.setValueAtTime(dB(-4), t0);
      st.setValueAtTime(0, t0 + 0.001);
      st.setValueAtTime(dB(-4), end + 0.05);
      st.setValueAtTime(0, end + 0.051);
    } else {
      st.setTargetAtTime(dB(-10), t0, 0.003); // squelch opens
      st.setTargetAtTime(this.bed, t0 + 0.07, 0.02);
      st.setTargetAtTime(dB(-12), end + 0.03, 0.004); // «кшш»
      st.setTargetAtTime(0, end + 0.17, 0.02);
    }
    this._schedule(text, t0 + 0.04, voice, p.fx === 'megaphone' ? 1.25 : 1);
    this.lineStart = t0;
    this.activeUntil = end + 0.25;
    this.eng.mix.duck(end - now + 0.3);
  }

  _schedule(text, t0, voice, loud) {
    const base = F0[voice] || F0.dispatch;
    const fk = FORMANT_K[voice] || 1;
    const peak = 0.55 * loud;
    const s = text.toLowerCase();
    const n = s.length;
    // phrase boundaries for the declination
    let phraseStart = 0;
    let phraseEnd = n;
    const nextEnd = (from) => {
      for (let j = from; j < n; j++) if (PHRASE_END.test(s[j])) return j + 1;
      return n;
    };
    phraseEnd = nextEnd(0);
    let question = s[phraseEnd - 1] === '?';
    let exclaim = s[phraseEnd - 1] === '!';
    for (let i = 0; i < n; i++) {
      if (i >= phraseEnd) {
        phraseStart = i;
        phraseEnd = nextEnd(i);
        question = s[phraseEnd - 1] === '?';
        exclaim = s[phraseEnd - 1] === '!';
      }
      const c = s[i];
      const t = t0 + i * CHAR_S;
      const v = VOWEL[c];
      if (v) {
        const k = (i - phraseStart) / Math.max(1, phraseEnd - phraseStart);
        let semi = -3 * k + (exclaim ? 2 : 0) + (Math.random() - 0.5) * 0.8;
        if (question && k > 0.7) semi += 5 * (k - 0.7) / 0.3;
        const f0 = base * Math.pow(2, semi / 12);
        this.saw.frequency.setTargetAtTime(f0, t - 0.005, 0.02);
        this.f1.frequency.setTargetAtTime(v[0] * fk, t - 0.012, 0.012);
        this.f2.frequency.setTargetAtTime(v[1] * fk, t - 0.012, 0.012);
        const a = peak * (0.75 + 0.25 * Math.random()) * (exclaim ? 1.15 : 1);
        this.vca.gain.setTargetAtTime(a, t, 0.009);
        this.vca.gain.setTargetAtTime(0, t + 0.045, 0.022);
      } else if (FRIC[c]) {
        this.fricBP.frequency.setValueAtTime(FRIC[c], t);
        this.fricVca.gain.setTargetAtTime(peak * 0.45, t, 0.004);
        this.fricVca.gain.setTargetAtTime(0, t + 0.024, 0.01);
      } else if (PLOSIVE[c]) {
        this.fricBP.frequency.setValueAtTime(PLOSIVE[c], t);
        this.fricVca.gain.setTargetAtTime(peak * 0.5, t + 0.006, 0.002);
        this.fricVca.gain.setTargetAtTime(0, t + 0.011, 0.005);
      }
    }
  }

  // Briefing typewriter: one syllable per typed vowel in real time (ui:type {voice:'dispatch'}).
  syllableNow(ch, voice = 'dispatch') {
    const ac = this.eng.ac;
    const now = ac.currentTime;
    if (now - this._liveCfgT > 1 || this._cfgKey.indexOf(voice) < 0) this._configure(now, 'ext', voice, 0.1, null);
    this._liveCfgT = now;
    const c = String(ch || '').toLowerCase();
    if (!VOWEL[c] && !FRIC[c] && !PLOSIVE[c]) return;
    this._schedule(c, now + 0.005, voice, 0.7);
  }

  // Lightning during a line: +12 dB of crackle for 180 ms.
  crackle() {
    const now = this.eng.ac.currentTime;
    if (now > this.activeUntil) return;
    const st = this.stVca.gain;
    const lvl = Math.max(this.bed, dB(-30)) * 4;
    st.setTargetAtTime(lvl, now, 0.004);
    st.setTargetAtTime(this.bed, now + 0.18, 0.02);
  }
}
