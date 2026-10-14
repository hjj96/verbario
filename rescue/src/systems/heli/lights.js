// Helicopter lights (DESIGN §2.9, §2.7.1, §4 #3/#7/#8): emissive bulbs (one additive draw call,
// per-channel intensities), the belly PointLight that makes the sea under the heli pulse red/white at
// night, and the reflections of every light on the water via ocean.addGlint() each frame.
//
// Timings: nav red/green/white steady; roof + belly beacon rotate, pow(cos, 8) at 0.9 Hz; white
// strobes double-flash 0–45 / 140–185 ms every 1.1 s; door #B3121A while the winch is out; St. Elmo's
// fire crackles on the nose probes. reduceFlashes: strobes at 40 %, single flash (≤ 1 Hz).
import * as THREE from 'three';
import { POINTS, CH } from './model.js';

const STROBE_PERIOD = 1.1;
const BEACON_HZ = 0.9;

// Emissive gains (×6–14 per DESIGN) — HDR so bloom picks them up.
const GAIN = { nav: 7, navWhite: 6, beacon: 10, strobe: 14, door: 7, elmo: 9, lens: 12, flir: 0 };

// Belly light candela per source (tuned so the night sea visibly pulses under the heli).
const BELLY = { strobe: 3400, beacon: 1500, door: 1100 };

const COL = {
  red: new THREE.Color('#FF2015'),
  green: new THREE.Color('#12FF6E'),
  white: new THREE.Color('#FFFFFF'),
  beacon: new THREE.Color('#FF1A10'),
  door: new THREE.Color('#B3121A'),
  lens: new THREE.Color('#FFF1DA'),
};

// Glint sources: [point name, colour, channel, base glint intensity]
const GLINTS = [
  ['navPort', COL.red, CH.navRed, 0.35],
  ['navStbd', COL.green, CH.navGreen, 0.35],
  ['navTail', COL.white, CH.navWhite, 0.1], // steady white: small, never a white disc between strobes
  ['beacon', COL.beacon, CH.beacon, 0.6],
  ['strobeL', COL.white, CH.strobe, 1.0],
  ['strobeR', COL.white, CH.strobe, 1.0],
  ['door', COL.door, CH.door, 0.5],
  ['lens', COL.lens, CH.lens, 0.25],
];
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Light spill painted onto the hull (local glow slots of the hull material):
// [point, colour, channel, radius m, gain]
const SPILL = [
  ['strobeL', COL.white, CH.strobe, 2.4, 0.05],
  ['strobeR', COL.white, CH.strobe, 2.4, 0.05],
  ['beacon', COL.beacon, CH.beacon, 2.2, 0.07],
  ['beaconLow', COL.beacon, CH.beacon, 2.0, 0.06],
  ['navPort', COL.red, CH.navRed, 1.5, 0.05],
  ['navStbd', COL.green, CH.navGreen, 1.5, 0.05],
  ['door', COL.door, CH.door, 1.8, 0.08],
  ['lens', COL.lens, CH.lens, 1.5, 0.05],
];

export class HeliLights {
  constructor(ctx, model) {
    this.ctx = ctx;
    this.model = model;
    this.chan = model.lightsMat.uniforms.uChan.value;
    // Belly / beacon PointLight: created once, only colour & intensity change afterwards.
    this.belly = new THREE.PointLight(0xffffff, 0, 90, 2);
    this.belly.name = 'heli.bellyLight';
    this.belly.position.copy(POINTS.belly);
    this.belly.castShadow = false;
    model.body.add(this.belly);

    this.t = 0;
    this.strobe = 0; // 0..1 current strobe output (for HUD/audio/post if they care)
    this.beacon = 0;
    this.door = 0;
    this.blinkSeed = Math.random() * 10;
    this._w = new THREE.Vector3();
    this._c = new THREE.Color();
    this._lensLevel = 0;
  }

  // h = Helicopter (public state). dt = game seconds.
  update(dt, h) {
    const ctx = this.ctx;
    const st = ctx.weather?.state || {};
    const night = st.night || 0;
    const reduce = !!ctx.settings.get('reduceFlashes');
    this.t += dt;
    const t = this.t;
    const powered = h.rotorRPM > 0.05 || h.alive;

    // --- strobe: double flash (single, dimmer when reduceFlashes) ------------------------------
    const ph = t % STROBE_PERIOD;
    let strobe = ph < 0.045 ? 1 : !reduce && ph >= 0.14 && ph < 0.185 ? 1 : 0;
    if (reduce) strobe *= 0.4;
    if (!powered) strobe = 0;
    this.strobe = strobe;

    // --- rotating beacon --------------------------------------------------------------------------
    const beacon = Math.pow(Math.max(0, Math.cos(t * BEACON_HZ * Math.PI * 2)), 8);
    this.beacon = beacon;

    // --- door light while the winch is out (eased) ---------------------------------------------
    const doorT = h.winch.state !== 'stowed' && h.alive ? 1 : 0;
    this.door += (doorT - this.door) * (1 - Math.exp(-dt * 6));

    // --- nav lights; below 25 % hull the green one blinks erratically ---------------------------
    let green = 1;
    if (h.hull < 0.25) {
      const f = Math.sin(t * 13.1 + this.blinkSeed) + Math.sin(t * 7.3) * 0.8 + Math.sin(t * 29.0) * 0.5;
      green = f > 0.6 ? 0.08 : 1;
    }
    const navOn = h.ditched ? 0 : 1;

    // --- St. Elmo's fire on the nose probes (30 Hz crackle) ---------------------------------------
    const elmo = st.stElmo || 0;
    const crack = Math.sin(Math.floor(t * 30) * 12.9898) * 43758.5453;
    const crackle = elmo > 0.01 ? elmo * (0.35 + (crack - Math.floor(crack) > 0.45 ? 1 : 0)) : 0;

    // --- searchlight lens --------------------------------------------------------------------------
    this._lensLevel = h.beam ? h.beam.intensity : 0;

    const C = this.chan;
    C[CH.navRed] = GAIN.nav * navOn;
    C[CH.navGreen] = GAIN.nav * navOn * green;
    C[CH.navWhite] = GAIN.navWhite * navOn;
    C[CH.beacon] = GAIN.beacon * (0.06 + 0.94 * beacon) * (powered ? 1 : 0);
    C[CH.strobe] = GAIN.strobe * strobe;
    C[CH.door] = GAIN.door * this.door;
    C[CH.elmo] = GAIN.elmo * crackle;
    C[CH.lens] = GAIN.lens * this._lensLevel;
    C[CH.flir] = 0;
    // Halos: a touch by day, stronger at night; low quality (no bloom) relies on them entirely.
    const low = ctx.settings.get('quality') === 'low';
    this.model.lightsMat.uniforms.uHalo.value = (low ? 0.9 : 0.2) * (0.03 + 0.97 * night * night);

    // --- belly PointLight: pulses with strobes / beacon, red door light while winching ----------
    const c = this._c.setRGB(0, 0, 0);
    c.r += COL.white.r * BELLY.strobe * strobe + COL.beacon.r * BELLY.beacon * beacon + COL.door.r * BELLY.door * this.door;
    c.g += COL.white.g * BELLY.strobe * strobe + COL.beacon.g * BELLY.beacon * beacon + COL.door.g * BELLY.door * this.door;
    c.b += COL.white.b * BELLY.strobe * strobe + COL.beacon.b * BELLY.beacon * beacon + COL.door.b * BELLY.door * this.door;
    const I = Math.max(c.r, c.g, c.b);
    if (I > 1e-3) this.belly.color.setRGB(c.r / I, c.g / I, c.b / I);
    // By day the effect is invisible anyway; keep it physically modest so it never fights the sun.
    // Keep the pool on the surface roughly constant: E = I/d², so scale by (d/20 m)² near the surface
    // (otherwise the strobe floods the deck when parked).
    const d = Math.max(0.5, (h.position.y + POINTS.belly.y) - (h.surfaceY || 0));
    const near = Math.min(1, (d / 20) * (d / 20));
    this.belly.intensity = powered ? I * near * (0.08 + 0.92 * night) : 0;

    this._spill(night, C);
    this._glints(h, night, C);
  }

  // Feed the hull material's local glow slots (only matters at night; free by day).
  _spill(night, C) {
    const u = this.model.hullMat.userData.uniforms;
    const pos = u.uGlowPos.value;
    const col = u.uGlowCol.value;
    const k = 0.1 + 0.9 * night;
    for (let i = 0; i < SPILL.length && i < pos.length; i++) {
      const sp = SPILL[i];
      const p = POINTS[sp[0]];
      pos[i].set(p.x, p.y, p.z, sp[3]);
      col[i].copy(sp[1]).multiplyScalar(C[sp[2]] * sp[4] * k);
    }
  }

  // Reflections on the water: mirror each light through the local sea plane and intersect the
  // camera→mirror ray with it, so the glint sits where a real reflection would be. Seen from the
  // cinematic heights a lamp's reflection is a small wave-broken sparkle, not a blob bigger than the
  // aircraft: radius and gain shrink with camera height, and the steady lamps are capped well below
  // the strobe (the ocean's specular term breaks what is left up on the wave facets).
  _glints(h, night, C) {
    const ocean = this.ctx.ocean;
    if (!ocean || !ocean.addGlint) return;
    const cam = this.ctx.camera.position;
    const body = this.model.body;
    const sea = h.seaY || 0;
    const scale = 0.05 + 0.95 * night * night; // reflections of small lamps only matter after dusk
    const alt = smooth(90, 360, cam.y - sea);
    const rK = 1 - 0.62 * alt;
    const iK = 1 - 0.6 * alt;
    for (let i = 0; i < GLINTS.length; i++) {
      const g = GLINTS[i];
      const name = g[0];
      const col = g[1];
      const ch = g[2];
      const base = g[3];
      const I = C[ch] / 10;
      if (I < 0.02) continue;
      const w = this._w.copy(POINTS[name]);
      body.localToWorld(w);
      const hgt = w.y - sea;
      if (hgt < 0.2) continue;
      const my = sea - hgt; // mirrored light height
      const t = (cam.y - sea) / Math.max(0.01, cam.y - my);
      const gx = cam.x + (w.x - cam.x) * t;
      const gz = cam.z + (w.z - cam.z) * t;
      const r = (0.75 + 0.035 * hgt) * rK;
      let gi = I * base * scale * iK;
      if (ch !== CH.strobe) gi = Math.min(gi, 0.3);
      ocean.addGlint(gx, gz, r, gi, col);
    }
  }
}
