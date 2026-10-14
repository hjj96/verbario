// Procedural audio resources (DESIGN §6.1 «Общие ресурсы»): noise buffers (white 4 s, pink/Kellet 4 s,
// brown 6 s — stereo with decorrelated channels, 10 ms loop seam), the convolution IR (2.8 s filtered
// exponential noise), pre-rendered texture loops (Minnaert rain droplets, hail clicks with a hull ring,
// flare crackle, bubbles), PeriodicWaves (the rotor's «fast attack / exponential decay» pulse, click
// train, cosine, sub with harmonics) and WaveShaper curves. Everything is generated once, in JS.

export const dB = (db) => Math.pow(10, db / 20);
export const toDb = (g) => 20 * Math.log10(Math.max(1e-6, g));
// Volume slider v (0..1) → gain (DESIGN §6.1: v === 0 ? 0 : dB(−40·(1−v)))
export const volume = (v) => (!(v > 0) ? 0 : dB(-40 * (1 - Math.min(1, v))));
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Small seeded RNG (mulberry32) so buffers are identical between sessions.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fill one channel of `len` samples + a 10 ms crossfaded seam so the loop never clicks.
function seamless(out, gen, len, fade) {
  const tmp = new Float32Array(len + fade);
  for (let i = 0; i < len + fade; i++) tmp[i] = gen();
  for (let i = 0; i < len; i++) out[i] = tmp[i];
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = tmp[i] * k + tmp[len + i] * (1 - k);
  }
}

function normalize(data, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}

// White / pink / brown, stereo, decorrelated (different seeds per channel).
export function noiseBuffers(ac) {
  const sr = ac.sampleRate;
  const fade = Math.round(sr * 0.01);
  const make = (seconds, kind, seed) => {
    const len = Math.round(sr * seconds);
    const buf = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const r = rng(seed + ch * 7919);
      const data = buf.getChannelData(ch);
      let gen;
      if (kind === 'white') gen = () => r() * 2 - 1;
      else if (kind === 'pink') {
        // Paul Kellet's refined pink filter
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        gen = () => {
          const w = r() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
          b6 = w * 0.115926;
          return p * 0.11;
        };
      } else {
        // brown: leaky integrator of white
        let last = 0;
        gen = () => {
          last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
          return last * 3.5;
        };
      }
      seamless(data, gen, len, fade);
      normalize(data, kind === 'white' ? 0.7 : 0.85);
    }
    return buf;
  };
  return { white: make(4, 'white', 11), pink: make(4, 'pink', 23), brown: make(6, 'brown', 37) };
}

// Convolution IR: 2.8 s stereo exponential noise (−60 dB at the end), darkening with time.
export function impulseResponse(ac, seconds = 2.8) {
  const sr = ac.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(101 + ch * 31);
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.exp(-6.9 * t) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
      const a = 0.12 + 0.75 * t; // one-pole LP coefficient grows: the tail gets darker
      lp += (r() * 2 - 1 - lp) * (1 - a);
      d[i] = lp * env;
    }
    normalize(d, 0.6);
  }
  return buf;
}

// Rain droplets: 3 s, 900 Minnaert bubbles — a sine 1.8–5.2 kHz gliding up 15 % in 6 ms, amplitude r³.
export function minnaertBuffer(ac, seconds = 3, drops = 900) {
  const sr = ac.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const r = rng(555);
  for (let n = 0; n < drops; n++) {
    const t0 = Math.floor(r() * len);
    const size = r();
    const amp = Math.pow(0.25 + 0.75 * size, 3);
    const f0 = 5200 - 3400 * size * (0.6 + 0.4 * r()); // bigger drop → lower note
    const tau = 0.003 + 0.007 * size;
    const pan = r();
    const gl = Math.sqrt(1 - pan) * amp;
    const gr = Math.sqrt(pan) * amp;
    const N = Math.min(Math.round(tau * 6 * sr), len);
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const f = f0 * (1 + 0.15 * Math.min(1, t / 0.006));
      ph += (2 * Math.PI * f) / sr;
      const v = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, i / 8);
      const j = (t0 + i) % len; // wraps: seamless loop
      L[j] += v * gl;
      R[j] += v * gr;
    }
  }
  normalize(L, 0.8);
  normalize(R, 0.8);
  return buf;
}

// Hail: Poisson clicks (60/s) with the metal hull ring baked in (comb 1.7 ms, feedback .5), 3 s loop.
export function hailBuffer(ac, seconds = 3, rate = 60) {
  const sr = ac.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const r = rng(777);
  const comb = Math.round(sr * 0.0017);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const n = Math.round(rate * seconds * 0.5);
    for (let k = 0; k < n; k++) {
      const t0 = Math.floor(r() * len);
      const a = 0.3 + 0.7 * r();
      const N = Math.round(sr * 0.004);
      for (let i = 0; i < N; i++) d[(t0 + i) % len] += (r() * 2 - 1) * a * Math.exp(-i / (sr * 0.0007));
    }
    // comb: y[n] = x[n] + 0.5·y[n−D] — the clicks ring like a metal hull
    for (let i = comb; i < len; i++) d[i] += 0.5 * d[i - comb];
    normalize(d, 0.8);
  }
  return buf;
}

// Flare crackle: sputtering impulses over a hiss bed, 2 s loop.
export function crackleBuffer(ac, seconds = 2) {
  const sr = ac.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(901 + ch);
    const d = buf.getChannelData(ch);
    let hp = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      hp = w - hp * 0.6; // brightish hiss
      d[i] = hp * 0.12 * (0.7 + 0.3 * Math.sin((i / sr) * 2 * Math.PI * 13));
    }
    const pops = Math.round(seconds * 70);
    for (let k = 0; k < pops; k++) {
      const t0 = Math.floor(r() * len);
      const a = Math.pow(r(), 2);
      const N = Math.round(sr * (0.001 + 0.004 * r()));
      for (let i = 0; i < N; i++) d[(t0 + i) % len] += (r() * 2 - 1) * a * (1 - i / N);
    }
    normalize(d, 0.8);
  }
  return buf;
}

// Bubbles (whirlpool, sinking hull): short rising sine chirps 180–900 Hz, 3 s loop.
export function bubbleBuffer(ac, seconds = 3, count = 140) {
  const sr = ac.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const r = rng(4242);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let k = 0; k < count; k++) {
    const t0 = Math.floor(r() * len);
    const f0 = 180 + 720 * Math.pow(r(), 1.6);
    const tau = 0.01 + 0.04 * r();
    const a = 0.3 + 0.7 * r();
    const pan = r();
    const N = Math.round(tau * 5 * sr);
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * f0 * (1 + 2.5 * t)) / sr;
      const v = Math.sin(ph) * Math.exp(-t / tau) * a * Math.min(1, i / 20);
      const j = (t0 + i) % len;
      L[j] += v * (1 - pan);
      R[j] += v * pan;
    }
  }
  normalize(L, 0.8);
  normalize(R, 0.8);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// PeriodicWaves

// The rotor pulse (DESIGN §6.2): per blade pass a linear attack over `attack` of the period, then an
// exponential decay with time constant `decay` (fractions of the period; tails wrap over 6 periods).
// disableNormalization: the oscillator outputs e(t) − mean exactly; a VCA whose intrinsic gain is `mean`
// and whose gain param receives the oscillator then multiplies its input by e(t) ∈ [0, 1].
export function pulseWave(ac, attack, decay, harmonics = 128) {
  const N = 4096;
  const e = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const ph = i / N;
    let v = 0;
    for (let k = 0; k < 6; k++) {
      const t = ph + k; // time since a pulse start, in periods
      if (t < attack) v += t / attack;
      else v += Math.exp(-(t - attack) / decay);
    }
    e[i] = v;
  }
  let mx = 0;
  for (let i = 0; i < N; i++) mx = Math.max(mx, e[i]);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    e[i] /= mx;
    mean += e[i];
  }
  mean /= N;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < N; i += 2) {
      const w = (2 * Math.PI * k * i) / N;
      a += e[i] * Math.cos(w);
      b += e[i] * Math.sin(w);
    }
    real[k] = (4 / N) * a; // 2/N with every other sample
    imag[k] = (4 / N) * b;
  }
  return { wave: ac.createPeriodicWave(real, imag, { disableNormalization: true }), mean };
}

// Narrow click train (ratchet): 48 equal harmonics, normalised.
export function clickWave(ac) {
  const n = 48;
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) real[k] = 1 - k / (n + 4);
  return ac.createPeriodicWave(real, imag);
}

// Cosine (a 90° = T/4 phase shift of the sine — the whitecaps LFO).
export function cosWave(ac) {
  return ac.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
}

// Sub with audible harmonics: everything below 120 Hz carries its 2nd/3rd harmonic (DESIGN §6.6 note).
export function subWave(ac) {
  return ac.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.45, 0.22]));
}

// Reedy horn / diaphone spectrum: odd-heavy harmonics (ship horn, foghorn).
export function hornWave(ac) {
  const n = 12;
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) imag[k] = (k % 2 ? 1 : 0.45) / Math.pow(k, 0.9);
  return ac.createPeriodicWave(real, imag);
}

// ---------------------------------------------------------------------------------------------
// WaveShaper curves

const curveCache = new Map();
export function tanhCurve(k, n = 1024) {
  const key = `t${Math.round(k * 10)}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

export function clipCurve(drive = 4, n = 1024) {
  const key = `c${Math.round(drive * 10)}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * drive;
    c[i] = Math.max(-1, Math.min(1, x)) * 0.9;
  }
  curveCache.set(key, c);
  return c;
}
