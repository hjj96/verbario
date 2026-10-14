// Numbers, colours and small helpers shared by the SURVIVORS system (DESIGN §2.10, §3.10, §3.11, §4).
//
// Everything here is plain data: the survivors class and its helper modules read it, nothing writes it.
// Colours are sRGB hex (THREE.Color converts them to the linear working space).

// Perceptual scale of people (DESIGN §2.10): head ≈ 0.33 m, vest ≈ 10–14 px at H 150 on 1080p.
export const PERSON_SCALE = 1.5;

// Group types (DESIGN §3.11 table). warmth = seconds from 1 → 0 before multipliers, leeway = share of
// the wind speed the group drifts with, capture = winch capture radius (heli owns the real numbers).
export const TYPES = {
  swimmer: { warmth: 180, leeway: 0.02, capture: 3, size: 1.0 },
  raft: { warmth: 480, leeway: 0.045, capture: 4.5, size: 1.25 },
  hull: { warmth: 360, leeway: 0.03, capture: 3, size: 1.3, sink: 200 },
  container: { warmth: 420, leeway: 0.06, capture: 3, size: 1.35, tipEvery: 40 },
  injured: { warmth: 150, leeway: 0.02, capture: 3, size: 1.0 },
  deck: { warmth: 600, leeway: 0, capture: 3, size: 2.0 },
  wreck: { warmth: 600, leeway: 0.005, capture: 3, size: 2.5, flood: 300 },
  plane: { warmth: 300, leeway: 0.01, capture: 3, size: 1.6, sink: 120 },
};

// Types this implementation supports (mission/prepare.js reads `survivors.types`).
export const SUPPORTED_TYPES = ['swimmer', 'raft', 'hull', 'container', 'injured', 'deck', 'wreck', 'plane'];

// DESIGN §3.11: mT = clamp(0.35 + T/20, 0.4, 1.6), night ×0.9, difficulty cadet ×1.5 / ace ×0.8.
export const DIFFICULTY_WARMTH = { cadet: 1.5, pilot: 1, ace: 0.8 };
export const CRITICAL = 0.25;
export const LOST_FADE = 3; // s — the figure freezes and dissolves into the wave (never show death)

// Detection (DESIGN §3.10) — fallback when weather.detectBase() is missing.
export const DETECT = {
  calm: [260, 1], overcast: [220, 1], squall: [140, 0.3], storm: [150, 0.3],
  nightStorm: [60, 0], fog: [45, 0], clearing: [280, 1], nightCalm: [80, 0.5],
};
export const BEAM_SPOT_TIME = 0.4; // s in the searchlight pool
export const BEAM_RANGE = 250; // slant metres
export const FLARE_SPOT_R = 45; // player flare (heli:flare) lights 45 m for 40 s
export const FLARE_SPOT_LIFE = 40;
export const STROBE_MULT = 3;

// Signals (DESIGN §2.10 table, §3.10 table).
export const SIG = {
  hearRotor: 700, // red rocket when the rotor is heard and nobody has seen them
  rocketGap: [30, 45],
  rocketError: 20,
  rocketSignalLife: 20,
  smokeAt: 400, // orange smoke lit when the heli is closer than this (day)
  smokeBurn: 60,
  smokeSpot: 500,
  flareAt: 500, // handheld flare at night
  flareBurn: 45,
  flareSpot: 700,
  whistleAt: 150,
  whistleGap: [4, 7],
  whistleArc: 15, // degrees
  hornHear: 180, // loudspeaker: hidden groups answer within 180 m after 1–2 s
  hornCalm: 60, // spotted within 60 m stop panicking
  epirbRange: 2000,
  epirbGap: 4.5,
  dyeHear: 900,
  dyeSpot: 600,
  dyeMinAlt: 50,
  mirrorRange: 300,
  mirrorGap: [3, 6],
  mirrorFlash: 0.15,
  strobePeriod: 1.5,
  strobeOn: 0.06,
  lampPeriod: 1.0, // raft canopy lamp 60 / min
};

// Behaviour distances (DESIGN §3.11, §2.10).
export const NEAR_WAVE = 60; // both arms 1.1 Hz
export const SEEN_RANGE = 120; // swimmers wave, people in rafts sit up
export const SWIM_TO_BASKET = 10; // m, 0.5 m/s
export const SWIM_SPEED = 0.5;
export const SWIM_TO_RAFT = 60;
export const RAFT_SEATS = 6;

// Downwash (DESIGN §3.4): swimmers inside R = 9 + .35·alt below 12 m are pushed (12 − alt)·0.4 m/s;
// a raft capsizes after 2 s below 8 m within 6 m of the rotor axis.
export const DW_PUSH_ALT = 12;
export const DW_CAPSIZE_ALT = 8;
export const DW_CAPSIZE_R = 6;
export const DW_CAPSIZE_T = 2;

// Rogue wave (DESIGN §3.12): floating things are carried ~40 m; rafts capsize 40 % (> 4 aboard: 60 %).
export const ROGUE_SWEEP = 40;
export const ROGUE_SWEEP_T = 2.6;

// --- colours (DESIGN §2.4, §2.10) --------------------------------------------------------------
export const C = {
  vest: '#FF5A00',
  tape: '#E9F2FF',
  strobe: '#FFFFFF',
  chem: '#6CFF4A',
  mirror: '#FFF6E0',
  flare: '#FF2A12',
  smoke: '#FF7B2E',
  raftTube: '#1E1E1E',
  raftStripe: '#FF6A13',
  canopy: '#FF6A13',
  hull: '#7E2A22',
  waterline: '#ECEBE6',
  lostBuoy: '#8E979C',
};
export const SKIN = ['#E8C3A0', '#D9A07A', '#B57A55', '#6B4430'];
export const HOOD = ['#1F2A33', '#7A1E1E', '#2E4A2A', '#2A2F36'];
// clothes under the vest (sleeves, torso) and trousers — cold, desaturated (pillar 1: people are the
// only warm thing, and the vest carries that)
export const JACKET = ['#26303B', '#3A3F44', '#4A2626', '#2F4436', '#46403A', '#1E2630'];
export const PANTS = ['#1E2226', '#2B3644', '#3A352F'];
export const CONTAINER_COLORS = ['#B3412E', '#1F5E8C', '#2F7D4F', '#C9A227'];

// Palette indices are fixed in the shader — keep the array lengths in sync with crowd.js.
export const PALETTE_SIZES = { skin: SKIN.length, hood: HOOD.length, jacket: JACKET.length, pants: PANTS.length };

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
// Frame-rate independent exponential approach.
export const approach = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
