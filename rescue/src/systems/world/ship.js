// Rescue ship «Арктур» (DESIGN §2.11 [MUST], §3.9, catalogue #15, #44): grey hull #5C6670 with a
// rescue stripe, white superstructure #E6E6E0, orange lifeboats, mast with navigation lights and a
// turning radar, stern helideck at 9 m (#2B3034, yellow circle #F2C200, white H, green perimeter
// #3CFF7A, floodlights #FFE6B0 + the world's deck PointLight). Steams 3–5 m/s along its route,
// pitches / rolls / heaves from three ocean samples (deck tilt → pad.tilt), slams its bow into
// crests (fx spray), leaves a Kelvin wake (ocean.addWake), a signalman marshals with glowing wands,
// and the horn sounds when the heli comes within 300 m ('world:horn').
import * as THREE from 'three';
import { bake, p, member, beam as boxBeam, hullGeometry, deckGeometry, windowParts, UNIT, SURF, emit } from './geo.js';
import { CH, createPropMaterial, beamGeometry, setGlow } from './materials.js';
import { paintHelideck, decalTexture } from './decals.js';
import { VesselMotion, Navigator } from './vessel.js';
import { Windsock } from './rigging.js';
import { clamp, smoothstep } from '../../core/math.js';

const SIDES = [-1, 1]; // reused in per-frame loops (no array literal per frame)
const L = 72;
const B = 15;
const DECK_Y = 9.0; // helideck top (local)
const DECK_Z = 24.5; // helideck centre (local, aft)
const DECK_R = 11.5; // octagon corner radius
const HORN_R = 300;

const C = {
  white: '#E6E6E0',
  deck: '#4B524E',
  helideckUnder: '#3A4044',
  dark: '#2E3338',
  steel: '#7E868C',
  orange: '#FF6A13',
  yellow: '#C9A227',
  black: '#1A1C1E',
  window: '#FFC98A',
  bridge: '#9FB8C8',
};

// Signalman pose (ship-local): stands on the starboard-forward corner of the deck, facing the H.
const SIG = { x: 7.0, z: DECK_Z - 7.6 };
const SIG_SCALE = 1.45;

// Foam collar discs along the hull (local x, z, radius).
// Centre-line ellipses: the inner (contact) part hides under the hull, the foam band shows
// as a continuous 2–3 m strip along the waterline. [local z, R (beam), elongation along the hull]
const COLLARS = [[-29, 3.6, 2.0], [-13, 5.6, 2.1], [5, 5.9, 2.0], [22, 5.9, 1.9], [34, 5.4, 1.0]];
const OBST_Z = [1, -3, -26];
// reusable ocean.stamp options (no per-frame allocations)
const ST_BOW = { radius: 3.2, strength: 0 };
const ST_WASH = { radius: 4.5, strength: 0 };
const ST_DISTURB = { radius: 6, strength: 0 };
const ST_SLAM = { radius: 9, strength: 0 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v2 = new THREE.Vector2();
const RADAR_COL = new THREE.Color('#2A2E33');
const ARM_COL = new THREE.Color('#FF7A1A');
const WAND_COL = new THREE.Color(1 + 3.6, 1 + 0.75, 1 + 0.05); // > 1 → glows (prop material)

export class Ship {
  constructor(W, def, index = 0) {
    this.W = W;
    this.name = def.name || 'Арктур';
    this.nav = new Navigator();
    this.nav.setup(def);
    this.motion = new VesselMotion({ length: L, beam: B });
    this.group = new THREE.Group();
    this.group.name = 'ship';
    W.root.add(this.group);

    this.decal = decalTexture(W.look, 512, 512, (g, w) =>
      paintHelideck(g, 0, 0, w, DECK_R, { name: this.name.toUpperCase(), seed: 29 + index, numbers: ['12.8', '9.6'] }),
    );
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'ship' });
    this.mesh = new THREE.Mesh(bake(W.look, this._parts()), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // flood cones from the superstructure onto the helideck (visible in rain / fog / night)
    this.cones = new THREE.Mesh(this._coneGeometry(), W.mats.flood);
    this.cones.frustumCulled = false;
    this.cones.renderOrder = 5;
    this.group.add(this.cones);

    this.windsock = new Windsock(7 + index);
    this.sockLocal = new THREE.Vector3(-10.0, DECK_Y + 3.7, DECK_Z - 9.6);
    this.hoop = new THREE.Vector3();
    this.signal = { mode: 'idle', t: 0, landedT: 0, armL: new THREE.Vector3(0, -1, 0), armR: new THREE.Vector3(0, -1, 0) };
    this.radarA = index * 1.7;
    this._lamps();

    // gameplay data (updated every frame)
    this.padPosition = new THREE.Vector3();
    this.padVelocity = new THREE.Vector3();
    this.padRadius = 10.5;
    this.prevPad = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.obstacles = [
      { x: 0, z: 0, radius: 9.5, top: 14.6, kind: 'ship', name: 'надстройка' },
      { x: 0, z: 0, radius: 2.2, top: 26, kind: 'mast', name: 'мачта' },
      { x: 0, z: 0, radius: 6.5, top: 8.5, kind: 'ship', name: 'бак' },
    ];
    this.hornArmed = false; // armed once the heli has been well away (no horn for a deck start)
    this.hornT = 0;
    this.slamFx = 0;
    this.motion.reset();
    this._place(0, true);
    this.prevPad.copy(this.padPosition);
  }

  // --------------------------------------------------------------------------------------------
  _parts() {
    const P = [];
    const hull = hullGeometry({ length: L, beam: B, deckAft: 5.2, deckFwd: 7.4, keel: 3.6, transom: 0.86, bowStart: 0.6, rake: 5, stripeAt: 0.8 });
    this.hull = hull;
    P.push({ geometry: hull.geometry, vcol: true, surf: SURF.paint });
    P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 0.6, 0.3, 26), color: C.deck, surf: [0.82, 0, 0, 0] });
    // bulwark rail along the deck edge (forward of the helideck)
    for (const side of [-1, 1]) {
      let prev = null;
      for (let z = 12; z >= -35; z -= 2.4) {
        const x = side * Math.max(0.2, hull.halfBeamAt(z) - 0.15);
        const y = hull.deckAt(z);
        P.push(member([x, y, z], [x, y + 1.1, z], 0.045, C.white));
        if (prev) P.push(member([prev[0], prev[1] + 1.1, prev[2]], [x, y + 1.1, z], 0.05, C.white));
        prev = [x, y, z];
      }
    }

    // --- helideck at the stern (octagon, painted top, safety net, supports)
    P.push(p(UNIT.oct, C.helideckUnder, [0, DECK_Y - 0.3, DECK_Z], [DECK_R, 0.6, DECK_R], null, SURF.steel));
    P.push({ geometry: new THREE.CircleGeometry(DECK_R, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [0, DECK_Y + 0.01, DECK_Z], surf: SURF.decal, uvRect: [0, 0, 1, 1] });
    P.push({ geometry: new THREE.RingGeometry(DECK_R, DECK_R + 1.4, 8, 1, Math.PI / 8).rotateX(-Math.PI / 2), color: '#202529', position: [0, DECK_Y - 0.2, DECK_Z], surf: SURF.rubber });
    for (const x of [-5.5, 5.5]) {
      for (const z of [DECK_Z - 8, DECK_Z, DECK_Z + 8]) {
        const y = hull.deckAt(Math.min(z, L / 2 - 0.5));
        P.push(member([x, y, z], [x, DECK_Y - 0.6, z], 0.28, C.steel));
        P.push(member([x * 1.25, y, z], [x * 1.95, DECK_Y - 0.6, z], 0.12, C.steel));
      }
    }

    // --- superstructure: deckhouse A, B, bridge C, roof, funnel
    const yA0 = hull.deckAt(4);
    P.push(p(UNIT.box, C.white, [0, (yA0 + 8.6) / 2, 4], [12.4, 8.6 - yA0, 14], null, SURF.paint));
    P.push(p(UNIT.box, C.white, [0, 9.9, 2.5], [11.2, 2.6, 13], null, SURF.paint));
    P.push(p(UNIT.box, C.white, [0, 12.5, -3.2], [15.2, 2.6, 6.4], null, SURF.paint));
    P.push(p(UNIT.box, '#B4B9B8', [0, 13.95, -3.2], [15.4, 0.3, 6.8], null, SURF.paint)); // bridge roof
    P.push(p(UNIT.box, '#C9CCC8', [0, 11.25, 2.5], [11.4, 0.12, 13.2], null, SURF.paint)); // B-deck roof
    P.push(p(UNIT.box, '#9AA1A6', [0, 8.65, 4], [12.5, 0.1, 14.1], null, SURF.paint)); // A-deck roof walkway
    P.push(...windowParts([0, 6.9, 4], [12.4, 3.3, 14], 'x+', { cols: 7, w: 0.9, h: 0.7, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([0, 6.9, 4], [12.4, 3.3, 14], 'x-', { cols: 7, w: 0.9, h: 0.7, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([0, 9.9, 2.5], [11.2, 2.6, 13], 'x+', { cols: 6, w: 0.9, h: 0.7, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([0, 9.9, 2.5], [11.2, 2.6, 13], 'x-', { cols: 6, w: 0.9, h: 0.7, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([0, 9.9, 2.5], [11.2, 2.6, 13], 'z+', { cols: 5, w: 1.2, h: 0.8, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([0, 12.6, -3.2], [15.2, 2.6, 6.4], 'z-', { cols: 9, w: 1.35, h: 1.1, ch: CH.DIM, color: C.bridge, gain: 0.8 }));
    P.push(...windowParts([0, 12.6, -3.2], [15.2, 2.6, 6.4], 'x+', { cols: 3, w: 1.2, h: 1.1, ch: CH.DIM, color: C.bridge, gain: 0.8 }));
    P.push(...windowParts([0, 12.6, -3.2], [15.2, 2.6, 6.4], 'x-', { cols: 3, w: 1.2, h: 1.1, ch: CH.DIM, color: C.bridge, gain: 0.8 }));
    // funnel with the service band (white / orange / white) and a black top
    P.push(p(UNIT.cyl12, '#5C6670', [0, 13.8, 5.4], [1.9, 5.2, 2.5], null, SURF.paint));
    P.push(p(UNIT.cyl12, C.white, [0, 14.7, 5.4], [1.94, 0.5, 2.54], null, SURF.paint));
    P.push(p(UNIT.cyl12, '#FF5A1F', [0, 15.2, 5.4], [1.94, 0.5, 2.54], null, SURF.paint));
    P.push(p(UNIT.cyl12, C.black, [0, 16.3, 5.4], [1.95, 0.35, 2.55], null, SURF.steel));
    // mast, yardarm, radar platform, lamp brackets
    P.push(member([0, 14.1, -3], [0, 25.3, -3], 0.2, '#B9BDB9'));
    P.push(member([-2.4, 21.2, -3], [2.4, 21.2, -3], 0.09, '#B9BDB9'));
    P.push(p(UNIT.cyl8, C.dark, [0, 22.0, -3], [0.75, 0.25, 0.75], null, SURF.steel));
    P.push(member([0, 18, -3], [0, 14.1, 0.4], 0.07, '#B9BDB9'));
    // lifeboats (enclosed, orange) on davits, both sides; liferaft canisters
    for (const side of [-1, 1]) {
      for (const z of [0.2, 6.8]) {
        P.push(p(UNIT.sphere, C.orange, [side * 8.0, 9.4, z], [1.25, 1.15, 3.05], null, SURF.gloss));
        P.push(p(UNIT.box, '#F4F1EA', [side * 8.0, 10.55, z], [0.7, 0.2, 1.3], null, SURF.paint));
        P.push(member([side * 6.2, 8.6, z - 2.2], [side * 8.2, 11.6, z - 2.2], 0.12, C.steel));
        P.push(member([side * 6.2, 8.6, z + 2.2], [side * 8.2, 11.6, z + 2.2], 0.12, C.steel));
      }
      for (let k = 0; k < 3; k++) P.push(p(UNIT.cyl8, '#ECEBE6', [side * 5.7, 11.65, -1.5 + k * 1.1], [0.32, 1.1, 0.32], [0, 0, Math.PI / 2], SURF.gloss));
    }
    // fast rescue boat (orange RIB) + its davit, port side forward
    {
      const y = hull.deckAt(-9) + 0.55, z = -9, x = -4.2;
      for (const s of [-1, 1]) P.push(p(UNIT.cyl8, C.orange, [x + s * 0.95, y, z], [0.42, 5.4, 0.42], [Math.PI / 2, 0, 0], SURF.rubber));
      P.push(p(UNIT.sphereLo, C.orange, [x, y, z - 2.7], [1.35, 0.42, 0.9], null, SURF.rubber));
      P.push(p(UNIT.box, '#2A2E33', [x, y - 0.1, z + 0.2], [1.5, 0.4, 5], null, SURF.rubber));
      P.push(p(UNIT.box, '#D8D8D2', [x, y + 0.45, z + 0.6], [0.6, 0.6, 0.6], null, SURF.paint));
      P.push(member([x - 1.6, y - 0.5, z + 3.2], [x - 0.6, y + 3.6, z + 1.4], 0.14, C.yellow, SURF.paint));
    }
    // forecastle: knuckle crane, windlass, bollards, chain, anchor light mast
    {
      const z = -17, y = hull.deckAt(z);
      P.push(p(UNIT.cyl12, C.yellow, [3.6, y + 1.5, z], [0.95, 3, 0.95], null, SURF.paint));
      P.push(boxBeam([3.6, y + 3, z], [1.0, y + 4.6, z - 5.5], 0.7, 0.7, C.yellow, SURF.paint));
      P.push(boxBeam([1.0, y + 4.6, z - 5.5], [2.6, y + 2.2, z - 8.5], 0.55, 0.55, C.yellow, SURF.paint));
      const zw = -27, yw = hull.deckAt(zw);
      for (const s of [-1, 1]) {
        P.push(p(UNIT.cyl12, '#3C4A44', [s * 1.4, yw + 0.7, zw], [0.6, 1.0, 0.6], [0, 0, Math.PI / 2], SURF.steel));
        P.push(boxBeam([s * 1.4, yw + 0.1, zw - 0.6], [s * 1.1, hull.deckAt(-33.5) + 0.05, -33.5], 0.25, 0.1, '#1E2226', SURF.steel));
      }
      for (const zb of [-31, -22, 10]) {
        for (const s of [-1, 1]) {
          const xb = s * (hull.halfBeamAt(zb) - 1.0);
          P.push(p(UNIT.cyl8, C.black, [xb, hull.deckAt(zb) + 0.35, zb], [0.24, 0.7, 0.24], null, SURF.steel));
          P.push(p(UNIT.cyl8, C.black, [xb, hull.deckAt(zb) + 0.35, zb + 0.8], [0.24, 0.7, 0.24], null, SURF.steel));
        }
      }
      P.push(member([0, hull.deckAt(-33), -33], [0, hull.deckAt(-33) + 4.2, -33], 0.08, '#B9BDB9'));
      // hatch covers and deck boxes
      P.push(p(UNIT.box, '#3C4A44', [-1.5, hull.deckAt(-12) + 0.3, -12], [3.2, 0.6, 2.4], null, SURF.steel));
      P.push(p(UNIT.box, '#6E7378', [2.6, hull.deckAt(-6) + 0.6, -6], [2.4, 1.2, 2.2], null, SURF.steel));
    }
    // windsock pole on the deck corner
    P.push(member([-10.0, DECK_Y, DECK_Z - 9.6], [-10.0, DECK_Y + 3.9, DECK_Z - 9.6], 0.08, '#D8D8D2'));
    P.push(p(UNIT.torus, '#2A2E33', [-10.0, DECK_Y + 3.7, DECK_Z - 9.6], 0.5, [Math.PI / 2, 0, 0], SURF.steel));
    // flood lamp housings
    for (const s of [-1, 1]) {
      P.push(p(UNIT.box, '#FFE6B0', [s * 5.0, 11.0, 9.1], [0.6, 0.4, 0.35], null, emit(CH.FLOOD, 2)));
      P.push(member([s * 10.4, DECK_Y - 0.1, DECK_Z + 9.7], [s * 10.4, DECK_Y + 0.8, DECK_Z + 9.7], 0.07, C.dark));
    }
    // signalman (static body; arms and wands are rigging instances)
    {
      const fx = -SIG.x, fz = DECK_Z - SIG.z;
      const fl = Math.hypot(fx, fz);
      const yaw = Math.atan2(-fx / fl, -fz / fl);
      this.sigYaw = yaw;
      this.sigF = new THREE.Vector3(fx / fl, 0, fz / fl);
      this.sigR = new THREE.Vector3(-fz / fl, 0, fx / fl);
      const k = SIG_SCALE;
      const at = (r, y, f) => [SIG.x + this.sigR.x * r + this.sigF.x * f, DECK_Y + y * k, SIG.z + this.sigR.z * r + this.sigF.z * f];
      for (const s of [-1, 1]) P.push(member(at(s * 0.13 * k, 0, 0), at(s * 0.11 * k, 0.92, 0), 0.085 * k, '#262A30', SURF.fabric));
      P.push(p(UNIT.box, '#FF7A1A', at(0, 1.22, 0), [0.5 * k, 0.62 * k, 0.3 * k], [0, yaw, 0], SURF.fabric));
      P.push(p(UNIT.box, '#D8DEE2', at(0, 1.12, 0), [0.52 * k, 0.07 * k, 0.32 * k], [0, yaw, 0], SURF.gloss));
      P.push(p(UNIT.sphereLo, '#D9A07A', at(0, 1.66, 0), 0.13 * k, null, SURF.paint));
      P.push(p(UNIT.hemi, '#ECEBE6', at(0, 1.69, 0), 0.15 * k, null, SURF.gloss));
      this.shoulders = [new THREE.Vector3(...at(-0.3 * k, 1.47, 0)), new THREE.Vector3(...at(0.3 * k, 1.47, 0))];
    }
    return P;
  }

  _coneGeometry() {
    const parts = [];
    const target = new THREE.Vector3(0, DECK_Y, DECK_Z + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const s of [-1, 1]) {
      const from = new THREE.Vector3(s * 5.0, 10.9, 9.3);
      const dir = target.clone().add(new THREE.Vector3(s * 2.5, 0, 0)).sub(from);
      const len = dir.length() + 2;
      const g = beamGeometry(len, 0.3, 5.5, { radial: 12, segs: 3 });
      q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      m.compose(from, q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      parts.push(g);
    }
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'aV']) {
      const arrs = parts.map((g) => g.attributes[name]);
      const total = arrs.reduce((a, b) => a + b.array.length, 0);
      const arr = new Float32Array(total);
      let off = 0;
      for (const a of arrs) {
        arr.set(a.array, off);
        off += a.array.length;
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, arrs[0].itemSize));
    }
    for (const g of parts) g.dispose();
    return out;
  }

  _lamps() {
    const Lm = this.W.lamps;
    const g = this.group;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      Lm.add(Math.cos(a) * (DECK_R - 0.25), DECK_Y + 0.12, DECK_Z + Math.sin(a) * (DECK_R - 0.25), '#3CFF7A', { gain: 3, bulb: 0.17, halo: 0.8, ch: CH.PERIM, parent: g });
    }
    for (const s of [-1, 1]) {
      Lm.add(s * 5.0, 11.0, 9.35, '#FFE6B0', { gain: 4, bulb: 0.28, halo: 2.0, ch: CH.FLOOD, parent: g });
      Lm.add(s * 10.4, DECK_Y + 0.95, DECK_Z + 9.7, '#FFE6B0', { gain: 3, bulb: 0.2, halo: 1.5, ch: CH.FLOOD, parent: g });
      Lm.add(s * 3.2, this.hull.deckAt(-18) + 3.2, -18, '#FFE2B0', { gain: 2, bulb: 0.15, halo: 1.3, ch: CH.FLOOD, parent: g });
    }
    Lm.add(0, 24.8, -3, '#FFFFFF', { gain: 4, bulb: 0.2, halo: 1.6, ch: CH.NAV, parent: g, pen: 0.35 });
    Lm.add(0, 25.5, -3, '#FFFFFF', { gain: 6, bulb: 0.22, halo: 2.2, ch: CH.BEACON, parent: g, pen: 0.4 });
    Lm.add(-7.7, 12.9, -4.6, '#FF2015', { gain: 4.5, bulb: 0.2, halo: 1.4, ch: CH.NAV, parent: g, pen: 0.3 });
    Lm.add(7.7, 12.9, -4.6, '#12FF6E', { gain: 4.5, bulb: 0.2, halo: 1.4, ch: CH.NAV, parent: g, pen: 0.3 });
    Lm.add(0, DECK_Y - 0.6, L / 2 + 0.4, '#FFFFFF', { gain: 3, bulb: 0.18, halo: 1.2, ch: CH.NAV, parent: g });
    Lm.add(0, this.hull.deckAt(-33) + 4.3, -33, '#FFFFFF', { gain: 3, bulb: 0.18, halo: 1.2, ch: CH.NAV, parent: g });
    this.unloadLamps = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.unloadLamps.push(Lm.add(Math.cos(a) * (DECK_R + 0.5), DECK_Y + 0.25, DECK_Z + Math.sin(a) * (DECK_R + 0.5), '#4FA3FF', { gain: 4, bulb: 0.2, halo: 1.4, ch: CH.UNLOAD0, parent: g }));
    }
    this.wandLamps = [
      Lm.add(0, 0, 0, '#FF7A1A', { gain: 3, bulb: 0.1, halo: 1.1, ch: CH.WANDS, parent: g }),
      Lm.add(0, 0, 0, '#FF7A1A', { gain: 3, bulb: 0.1, halo: 1.1, ch: CH.WANDS, parent: g }),
    ];
  }

  setUnloadChannel(ch) {
    const Lm = this.W.lamps;
    for (const i of this.unloadLamps) if (i >= 0) Lm.iSz.array[i * 4 + 2] = ch;
    Lm.iSz.needsUpdate = true;
  }

  // Position / attitude of the ship this frame → group transform, pad and obstacles.
  _place(dt, settle = false) {
    const nav = this.nav;
    const Hs = this.W.env.Hs;
    this.motion.step(dt, nav.x, nav.z, nav.heading, this.W.ctx.ocean, Hs, settle);
    this.motion.apply(this.group, nav.x, nav.z, nav.heading, 0);
    this.group.updateMatrixWorld(true);
    const m = this.group.matrixWorld;
    this.padPosition.set(0, DECK_Y, DECK_Z).applyMatrix4(m);
    this.up.setFromMatrixColumn(m, 1).normalize();
    // obstacles: superstructure, mast, forecastle
    const c = Math.cos(nav.heading), s = Math.sin(nav.heading);
    const o = this.obstacles;
    for (let i = 0; i < 3; i++) {
      o[i].x = nav.x - OBST_Z[i] * s;
      o[i].z = nav.z + OBST_Z[i] * c;
    }
  }

  // --------------------------------------------------------------------------------------------
  update(dt, env) {
    const W = this.W;
    const ctx = W.ctx;
    this.nav.step(dt, env.windDir);
    this.prevPad.copy(this.padPosition);
    this._place(dt);
    if (dt > 0) {
      _v.subVectors(this.padPosition, this.prevPad).divideScalar(dt);
      this.padVelocity.lerp(_v, 1 - Math.exp(-dt * 10));
    }
    const nav = this.nav;
    const fx = Math.sin(nav.heading), fz = -Math.cos(nav.heading);
    const ocean = ctx.ocean;
    const m = this.group.matrixWorld;

    // --- wake (Kelvin V + bow wave foam + prop wash) and bow slams ---------------------------------
    if (dt > 0 && ocean) {
      const sp = nav.speed;
      if (sp > 0.4) {
        _v.set(0, 0, L / 2 + 2).applyMatrix4(m);
        ocean.addWake?.(_v.x, _v.z, clamp(sp / 2.5, 0.4, 2.2), fx, fz);
        for (const side of SIDES) {
          _v.set(side * 6.2, 0, -26).applyMatrix4(m);
          ST_BOW.strength = dt * 0.9 * clamp(sp / 4, 0.2, 1.2);
          ocean.stamp?.('foam', _v.x, _v.z, ST_BOW);
        }
        // propeller wash: a turbulent white trail straight behind the stern
        _v.set(0, 0, L / 2 + 5).applyMatrix4(m);
        ST_WASH.strength = dt * 0.7 * clamp(sp / 3, 0.3, 1.5);
        ocean.stamp?.('foam', _v.x, _v.z, ST_WASH);
        ST_DISTURB.strength = dt * 1.5;
        ocean.stamp?.('disturb', _v.x, _v.z, ST_DISTURB);
      }
      const slam = this.motion.slam;
      if (slam > 0) {
        _v.set(0, 2.5, -L / 2 + 1).applyMatrix4(m);
        const wind = env.windDir;
        _v2.set(fx * 0.6 + wind.x * 0.8, fz * 0.6 + wind.y * 0.8).normalize();
        ctx.fx?.splash?.(_v.x, Math.max(1, _v.y), _v.z, 5 + 7 * slam);
        ctx.fx?.spray?.(_v.x, _v.z, _v2, 14 + 30 * slam);
        ocean.splash?.(_v.x, _v.z, 5 + 4 * slam, 0.6 + 0.6 * slam);
        ST_SLAM.strength = 0.7 * slam;
        ocean.stamp?.('foam', _v.x, _v.z, ST_SLAM);
        ctx.events.emit('world:slam', { x: _v.x, z: _v.z, strength: slam, ship: this });
        this.slamFx = 1;
      }
    }
    this.slamFx = Math.max(0, this.slamFx - dt * 1.5);

    // --- water contact: foam collars along the hull --------------------------------------------------
    const foam = clamp(0.35 + 0.35 * Math.min(1, nav.speed / 4) + 0.35 * smoothstep(1, 6, env.Hs) + 0.4 * this.slamFx, 0, 1.3);
    for (let i = 0; i < COLLARS.length; i++) {
      const [lz, R, el] = COLLARS[i];
      _v.set(0, 0, lz).applyMatrix4(m);
      const h = ocean ? ocean.heightAt(_v.x, _v.z) : 0;
      if (ocean?.normalAt) ocean.normalAt(_v.x, _v.z, _w);
      else _w.set(0, 1, 0);
      const lit = ocean?.searchlightAt ? ocean.searchlightAt(_v.x, _v.z) : 0;
      W.collars.push(_v.x, h, _v.z, _w.x, _w.y, _w.z, R, foam, 0.22, lit, i * 0.37, -nav.heading, el);
    }

    // --- radar, windsock (apparent wind), signalman ---------------------------------------------------
    this.radarA += dt * Math.PI * 2 * 0.42;
    _d.set(Math.cos(this.radarA), 0, Math.sin(this.radarA));
    _v.set(-_d.x * 1.4, 22.35, -3 - _d.z * 1.4).applyMatrix4(m);
    _w.copy(_d).applyQuaternion(this.group.quaternion);
    W.rigging.push(_v.x, _v.y, _v.z, _w, 2.8, 0.13, RADAR_COL);

    this.hoop.copy(this.sockLocal).applyMatrix4(m);
    const wv = env.windAt(this.hoop.x, this.hoop.z);
    this.windsock.update(W.rigging, this.hoop, wv.x - this.padVelocity.x, wv.y - this.padVelocity.z, env.t, dt);

    this._signalman(dt, env);

    // --- deck light: PointLight above the helideck (#FFE6B0) --------------------------------------
    const point = W.lights.point;
    if (point && !W.pointOwner) {
      W.pointOwner = this;
      point.position.set(0, DECK_Y + 6.5, DECK_Z - 2).applyMatrix4(m);
      point.intensity = W.channels[CH.FLOOD] * 110;
    }
    // cones: visible when the floods are on and the air carries water
    W.mats.flood.uniforms.uIntensity.value = W.channels[CH.FLOOD];
    W.mats.flood.uniforms.uDensity.value = 0.03 + 0.16 * env.rain + 0.22 * env.fogK + 0.05 * this.slamFx;
    setGlow(this.material, 0, 0, this.hull.deckAt(-18) + 0.5, -18, 8, W._col.set('#FFE2B0'), 0.18 * W.channels[CH.FLOOD]);
    setGlow(this.material, 1, 0, 24.6, -3, 1.4, W._col.set('#FFFFFF'), 0.6 * W.channels[CH.NAV]);
    setGlow(this.material, 2, 0, DECK_Y + 1, DECK_Z, 12, W._col.set('#FFE6B0'), 0.07 * W.channels[CH.FLOOD]);

    // --- horn when the heli comes within 300 m -------------------------------------------------
    const hp = env.heliPos;
    const dist = Math.hypot(hp.x - nav.x, hp.z - nav.z);
    this.hornT = Math.max(0, this.hornT - dt);
    if (this.hornArmed && dist < HORN_R && this.hornT <= 0 && ctx.mode === 'play' && dt > 0) {
      this.hornArmed = false;
      this.hornT = 60;
      ctx.events.emit('world:horn', { x: nav.x, z: nav.z, distance: dist, name: this.name });
    } else if (dist > HORN_R * 1.33) this.hornArmed = true;
  }

  // Marshalling: idle (arms down) → beckon on approach → "move down" over the deck → crossed
  // wands above the head after touchdown (hold), then rest. Wands glow (orange) day and night.
  _signalman(dt, env) {
    const W = this.W;
    const sg = this.signal;
    sg.t += dt;
    const hp = env.heliPos;
    const heli = W.ctx.heli;
    const onDeck = heli && heli.landed && heli.landed.object3d === this.group;
    const dx = hp.x - this.padPosition.x, dz = hp.z - this.padPosition.z;
    const dh = Math.hypot(dx, dz);
    const above = hp.y - this.padPosition.y;
    let mode = 'idle';
    if (onDeck) {
      sg.landedT += dt;
      mode = sg.landedT < 4 ? 'hold' : 'idle';
    } else {
      sg.landedT = 0;
      if (dh < 16 && above < 30) mode = 'down';
      else if (dh < 140 && above < 70) mode = 'beckon';
    }
    sg.mode = mode;
    const t = sg.t;
    const k = 1 - Math.exp(-dt * 6);
    // target arm directions in the signalman frame (r right, u up, f forward toward the H)
    for (const s of SIDES) {
      let r = 0.25 * s, u = -1, f = 0.12;
      if (mode === 'beckon') {
        const a = 0.9 + 0.45 * Math.sin(t * Math.PI * 2 * 0.8);
        r = 0.55 * s * Math.cos(a);
        u = Math.sin(a) * 0.9 + 0.3;
        f = 0.35 + 0.25 * Math.sin(t * Math.PI * 2 * 0.8);
      } else if (mode === 'down') {
        const a = -0.15 + 0.45 * Math.sin(t * Math.PI * 2 * 0.6);
        r = s * Math.cos(a);
        u = Math.sin(a);
        f = 0.15;
      } else if (mode === 'hold') {
        r = -0.32 * s;
        u = 1;
        f = 0.15;
      }
      _d.set(this.sigR.x * r + this.sigF.x * f, u, this.sigR.z * r + this.sigF.z * f).normalize();
      const arm = s < 0 ? sg.armL : sg.armR;
      arm.lerp(_d, k).normalize();
      // shoulder → hand (local), wand continues from the hand
      _v.copy(this.shoulders[s < 0 ? 0 : 1]);
      const armLen = 0.62 * SIG_SCALE;
      _w.copy(_v).addScaledVector(arm, armLen);
      W.lamps.setLocal(this.wandLamps[s < 0 ? 0 : 1], _w.x + arm.x * 0.42, _w.y + arm.y * 0.42, _w.z + arm.z * 0.42);
      // to world for the rigging instances
      const m = this.group.matrixWorld;
      _v.applyMatrix4(m);
      _w.applyMatrix4(m);
      _d.copy(arm).applyQuaternion(this.group.quaternion);
      W.rigging.push(_v.x, _v.y, _v.z, _d, armLen, 0.085, ARM_COL);
      W.rigging.push(_w.x, _w.y, _w.z, _d, 0.75, 0.05, WAND_COL);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.cones.geometry.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}

export const SHIP_DECK = { y: DECK_Y, z: DECK_Z, r: DECK_R };
