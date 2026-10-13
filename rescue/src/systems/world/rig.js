// Oil rig «Северная-7» (DESIGN §2.11 [SHOULD], §3.9, §3.14 op. 4, catalogue #47): four-legged
// jacket, open lower (cellar) deck at 22 m for the 'deck' survivors, upper deck at 32 m with the
// drill floor, derrick (obstacle), accommodation block, process modules and crane; cantilevered
// helideck with H at 32 m; flare boom whose flame bends with the wind (emissive flame mesh + fx
// smoke/sparks + a pooled fx light when close) and lights the low cloud base #FF8A2A.
// On 27 December the accommodation roof reads «С ДНЁМ СПАСАТЕЛЯ» (День спасателя).
import * as THREE from 'three';
import { bake, p, member, beam as boxBeam, railParts, latticeParts, windowParts, UNIT, SURF, emit } from './geo.js';
import { CH, createPropMaterial, flameGeometry, setGlow } from './materials.js';
import { paintHelideck, paintRoof, decalTexture } from './decals.js';
import { Windsock } from './rigging.js';
import { clamp, smoothstep } from '../../core/math.js';

const LOWER_Y = 22;
const UPPER_Y = 32;
const PAD = { x: -34, z: -24, r: 11.5 };
const FLARE_BASE = [22, 30, 16];
const FLARE_TIP = [56.8, 47, 28.1];
const DERRICK = { x: 4, z: -12, top: 74 };

const C = {
  leg: '#B89A3A',
  splash: '#4A3A30',
  deck: '#5E6467',
  deckTop: '#7A8084',
  module: '#A7B0B3',
  white: '#E6E6E0',
  derrick: '#D8D8D2',
  yellow: '#C9A227',
  orange: '#FF6A13',
  dark: '#2E3338',
  window: '#FFC98A',
  steel: '#7E868C',
};

export function isRescuerDay(params) {
  if (params?.has?.('rescuerday')) return true;
  const d = new Date();
  return d.getMonth() === 11 && d.getDate() === 27;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const FLAME_COL = new THREE.Color('#FF8A2A');
const SODIUM = new THREE.Color('#FFC27A');
const SMOKE_OPTS = { kind: 'generic', size: [4, 18], life: 7, rise: 2.5, alpha: 0.3 };

export class Rig {
  constructor(W, def) {
    this.W = W;
    this.x = def.x || 0;
    this.z = def.z || 0;
    this.name = def.name || 'Северная-7';
    this.group = new THREE.Group();
    this.group.name = 'rig';
    this.group.position.set(this.x, 0, this.z);
    W.root.add(this.group);
    this.festive = isRescuerDay(W.ctx.params);

    this.decal = decalTexture(W.look, 1024, 512, (g, w, h) => {
      paintHelideck(g, 0, 0, h, PAD.r, { name: this.name.toUpperCase(), deck: '#2E3A36', seed: 41, numbers: ['16.0', '12.8'] });
      paintRoof(g, h, 0, w - h, h, { text: this.name.toUpperCase(), sub: 'ПЛАТФОРМА · КАНАЛ 16', festive: this.festive, seed: 43 });
    });
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'rig' });
    this.mesh = new THREE.Mesh(bake(W.look, this._parts()), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // flare flame at the boom tip (unrotated group; bend comes from the wind uniform)
    this.flameMat = W.mats.flame;
    this.flame = new THREE.Mesh(flameGeometry(), this.flameMat);
    this.flame.position.set(...FLARE_TIP);
    this.flame.position.y += 0.6;
    this.flame.frustumCulled = false;
    this.flame.renderOrder = 7;
    this.group.add(this.flame);
    this.tip = new THREE.Vector3(this.x + FLARE_TIP[0], FLARE_TIP[1] + 0.6, this.z + FLARE_TIP[2]);
    this.flameCenter = new THREE.Vector3();
    this.bend = new THREE.Vector3();
    this.flicker = 1;
    this.smokeT = 0;
    this.sparkT = 0;
    this.light = null;

    this.windsock = new Windsock(11);
    this.hoop = new THREE.Vector3(this.x + PAD.x + 10.6, UPPER_Y + 4.6, this.z + PAD.z + 6.4);
    this._lamps();

    this.padPosition = new THREE.Vector3(this.x + PAD.x, UPPER_Y, this.z + PAD.z);
    this.padRadius = 10.5;
    this.lowerDeck = { x: this.x, z: this.z + 11, y: LOWER_Y };
    const o = (x, z, radius, top, kind, name) => ({ x: this.x + x, z: this.z + z, radius, top, kind, name });
    this.obstacles = [
      o(DERRICK.x, DERRICK.z, 6.5, DERRICK.top + 2, 'derrick', 'буровая вышка'),
      o(16, -14, 8, 43, 'rig', 'жилой блок'),
      o(-11, -13, 10, 39, 'rig', 'модули'),
      o(-18, -3, 3, 41, 'crane', 'кран'),
      o(-11, -12, 3, 53, 'crane', 'стрела крана'),
      o(FLARE_TIP[0], FLARE_TIP[2], 4.5, FLARE_TIP[1] + 6, 'flare', 'факел'),
      o(39, 22, 3, 40, 'flare', 'факельная стрела'),
      o(16, 16, 3.6, 21, 'leg', 'опора'),
      o(-16, 16, 3.6, 21, 'leg', 'опора'),
      o(16, -16, 3.6, 21, 'leg', 'опора'),
      o(-16, -16, 3.6, 21, 'leg', 'опора'),
    ];
  }

  // --------------------------------------------------------------------------------------------
  _parts() {
    const P = [];
    // --- jacket legs with splash-zone bands, bracing
    const legs = [[16, 16], [-16, 16], [16, -16], [-16, -16]];
    for (const [x, z] of legs) {
      P.push(p(UNIT.cyl20, C.leg, [x, 8, z], [3.0, 24, 3.0], null, SURF.paint));
      P.push(p(UNIT.cyl20, C.splash, [x, 0.5, z], [3.08, 7, 3.08], null, SURF.rust));
      P.push(p(UNIT.cyl20, C.dark, [x, 19.6, z], [3.4, 1.2, 3.4], null, SURF.steel));
    }
    for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const A = legs[a], Bv = legs[b];
      for (const y of [5, 13]) P.push(member([A[0], y, A[1]], [Bv[0], y, Bv[1]], 0.55, C.leg, SURF.paint));
      P.push(member([A[0], 5, A[1]], [Bv[0], 13, Bv[1]], 0.45, C.leg, SURF.paint));
      P.push(member([Bv[0], 5, Bv[1]], [A[0], 13, A[1]], 0.45, C.leg, SURF.paint));
      P.push(member([A[0], 13, A[1]], [Bv[0], 19.5, Bv[1]], 0.4, C.leg, SURF.paint));
    }
    // boat landing + ladder on the south-west leg
    P.push(p(UNIT.box, C.yellow, [-16, 2.2, 20], [6, 0.4, 2.2], null, SURF.paint));
    P.push(member([-16, 2.2, 19.2], [-16, 19.5, 18.7], 0.08, C.yellow));

    // --- lower (cellar) deck at 22 m: plating, yellow walkways, railing, lifeboats, baskets, pipes
    P.push(p(UNIT.box, C.deck, [0, LOWER_Y - 1.25, 0], [44, 2.5, 44], null, SURF.steel));
    P.push(p(UNIT.box, C.deckTop, [0, LOWER_Y + 0.01, 10], [43.6, 0.02, 23.6], null, [0.75, 0.3, 0, 0]));
    for (const x of [-20.5, 20.5]) P.push(p(UNIT.box, C.yellow, [x, LOWER_Y + 0.03, 10], [0.25, 0.02, 22], null, SURF.paint));
    P.push(p(UNIT.box, C.yellow, [0, LOWER_Y + 0.03, 20.5], [41, 0.02, 0.25], null, SURF.paint));
    P.push(p(UNIT.box, C.yellow, [0, LOWER_Y + 0.03, 0.6], [41, 0.02, 0.25], null, SURF.paint));
    P.push(...railParts([[-22, -1], [-22, 22], [22, 22], [22, -1]], LOWER_Y, 1.1, C.yellow, { post: 2.4, r: 0.05 }));
    for (const x of [-12, 6]) {
      P.push(p(UNIT.sphere, C.orange, [x, LOWER_Y + 0.4, 23.6], [4.0, 1.5, 1.5], null, SURF.gloss));
      P.push(p(UNIT.box, '#F4F1EA', [x, LOWER_Y + 1.85, 23.6], [1.6, 0.25, 0.6], null, SURF.paint));
      P.push(member([x - 2.6, LOWER_Y, 22], [x - 2.6, LOWER_Y + 3.2, 23.8], 0.12, C.steel));
      P.push(member([x + 2.6, LOWER_Y, 22], [x + 2.6, LOWER_Y + 3.2, 23.8], 0.12, C.steel));
    }
    P.push(p(UNIT.box, '#1F5E8C', [16, LOWER_Y + 1.1, 6], [5.6, 2.2, 2.4], null, SURF.paint)); // cargo basket
    P.push(p(UNIT.box, '#B3412E', [16, LOWER_Y + 1.1, 10], [5.6, 2.2, 2.4], null, SURF.paint));
    P.push(p(UNIT.box, '#5C6670', [17.5, LOWER_Y + 0.6, 15.5], [3, 1.2, 3], null, SURF.steel));
    for (let i = 0; i < 4; i++) P.push(member([21, LOWER_Y + 0.6 + i * 0.5, 2], [21, LOWER_Y + 0.6 + i * 0.5, 20], 0.18, i % 2 ? '#7E868C' : '#A88A2E'));
    // muster point marking on the deck (yellow square + "M") near the survivors' corner
    P.push(p(UNIT.box, C.yellow, [-15, LOWER_Y + 0.035, 16], [4.4, 0.02, 0.3], null, SURF.paint));
    P.push(p(UNIT.box, C.yellow, [-15, LOWER_Y + 0.035, 18.2], [4.4, 0.02, 0.3], null, SURF.paint));
    // columns between the decks
    for (const [x, z] of [[-21, -21], [21, -21], [-21, -3], [21, -3], [0, -3], [-11, -3], [11, -3]]) {
      P.push(p(UNIT.cyl8, C.steel, [x, (LOWER_Y + UPPER_Y - 2) / 2, z], [0.7, UPPER_Y - 2 - LOWER_Y, 0.7], null, SURF.steel));
    }

    // --- upper deck at 32 m
    P.push(p(UNIT.box, C.deck, [0, UPPER_Y - 1, -12], [44, 2, 20], null, SURF.steel));
    P.push(...railParts([[-22, -2], [22, -2]], UPPER_Y, 1.1, C.yellow, { post: 2.4, r: 0.05 }));
    // drill floor + derrick
    P.push(p(UNIT.box, '#7E8A91', [DERRICK.x, UPPER_Y + 3, DERRICK.z], [12, 6, 12], null, SURF.steel));
    P.push(...latticeParts([DERRICK.x, UPPER_Y + 6, DERRICK.z], [DERRICK.x, DERRICK.top, DERRICK.z], 5, 1.3, C.derrick, { bays: 10, r: 0.22, brace: 0.1 }));
    P.push(p(UNIT.box, C.dark, [DERRICK.x, DERRICK.top + 1, DERRICK.z], [3.4, 2, 3.4], null, SURF.steel));
    P.push(p(UNIT.box, '#B3261E', [DERRICK.x, DERRICK.top - 3, DERRICK.z], [2.9, 0.6, 2.9], null, SURF.paint));
    // pipe rack beside the drill floor
    for (let i = 0; i < 5; i++) P.push(member([-2, UPPER_Y + 0.5 + i * 0.32, -20 + i * 0.4], [-2, UPPER_Y + 0.5 + i * 0.32, -5], 0.15, '#9AA1A6'));
    // accommodation block, windows, roof banner (decal right half), lifeboats on its east face
    P.push(p(UNIT.box, C.white, [16, UPPER_Y + 5, -14], [11, 10, 14], null, SURF.paint));
    for (const y of [UPPER_Y + 2, UPPER_Y + 5, UPPER_Y + 8]) {
      P.push(...windowParts([16, UPPER_Y + 5, -14], [11, 10, 14], 'z+', { cols: 5, w: 1.1, h: 0.8, ch: CH.WINDOWS, color: C.window, y0: y }));
      P.push(...windowParts([16, UPPER_Y + 5, -14], [11, 10, 14], 'x+', { cols: 6, w: 1.1, h: 0.8, ch: CH.WINDOWS, color: C.window, y0: y }));
      P.push(...windowParts([16, UPPER_Y + 5, -14], [11, 10, 14], 'x-', { cols: 6, w: 1.1, h: 0.8, ch: CH.WINDOWS, color: C.window, y0: y }));
    }
    P.push({ geometry: UNIT.plane, color: '#FFFFFF', position: [16, UPPER_Y + 10.02, -14], scale: [10.6, 1, 13.6], surf: SURF.decal, uvRect: [0.5, 0, 1, 1] });
    for (const z of [-18, -10]) {
      P.push(p(UNIT.sphere, C.orange, [22.6, UPPER_Y + 3, z], [1.4, 1.4, 3.4], null, SURF.gloss));
    }
    // process modules, stacks
    P.push(p(UNIT.box, C.module, [-11, UPPER_Y + 3, -13], [18, 6, 16], null, SURF.steel));
    P.push(p(UNIT.box, C.yellow, [-15, UPPER_Y + 6.8, -16], [7, 1.6, 6], null, SURF.paint));
    P.push(p(UNIT.box, '#4F6D7A', [-6, UPPER_Y + 7, -9], [6, 2, 5], null, SURF.paint));
    P.push(p(UNIT.box, '#C9CCC8', [-15, UPPER_Y + 7.2, -8], [5, 2.4, 4], null, SURF.paint));
    for (const [x, z] of [[-3, -19], [-7, -19]]) P.push(p(UNIT.cyl12, C.dark, [x, UPPER_Y + 8.5, z], [0.8, 5, 0.8], null, SURF.steel));
    // crane: pedestal, cab, lattice boom up to the north-east (over the modules)
    P.push(p(UNIT.cyl12, C.yellow, [-18, UPPER_Y + 3.5, -3], [1.2, 7, 1.2], null, SURF.paint));
    P.push(p(UNIT.box, C.yellow, [-18, UPPER_Y + 7.8, -3], [3.2, 2.2, 3.2], null, SURF.paint));
    P.push(p(UNIT.box, '#1E2A33', [-16.4, UPPER_Y + 8.1, -3], [0.1, 1.2, 2.2], null, emit(CH.WINDOWS, 0.5)));
    P.push(...latticeParts([-18, UPPER_Y + 8.5, -3], [-5, UPPER_Y + 21, -20], 0.9, 0.35, C.yellow, { bays: 8, r: 0.14, brace: 0.06 }));

    // --- cantilevered helideck at 32 m (octagon, painted, net, trusses)
    P.push(p(UNIT.oct, '#3A4044', [PAD.x, UPPER_Y - 0.35, PAD.z], [PAD.r, 0.7, PAD.r], null, SURF.steel));
    P.push({ geometry: new THREE.CircleGeometry(PAD.r, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [PAD.x, UPPER_Y + 0.01, PAD.z], surf: SURF.decal, uvRect: [0, 0, 0.5, 1] });
    P.push({ geometry: new THREE.RingGeometry(PAD.r, PAD.r + 1.4, 8, 1, Math.PI / 8).rotateX(-Math.PI / 2), color: '#202529', position: [PAD.x, UPPER_Y - 0.25, PAD.z], surf: SURF.rubber });
    for (const z of [-30, -22, -14]) {
      P.push(boxBeam([-22, UPPER_Y - 1, z * 0.6 - 6], [PAD.x - 6, UPPER_Y - 0.7, z], 0.6, 0.9, C.steel));
      P.push(member([-16, LOWER_Y - 2, -16], [PAD.x + 2, UPPER_Y - 0.7, z], 0.35, C.steel));
    }
    P.push(member([PAD.x + 10.6, UPPER_Y, PAD.z + 6.4], [PAD.x + 10.6, UPPER_Y + 4.8, PAD.z + 6.4], 0.08, '#D8D8D2'));
    P.push(p(UNIT.torus, '#2A2E33', [PAD.x + 10.6, UPPER_Y + 4.6, PAD.z + 6.4], 0.5, [Math.PI / 2, 0, 0], SURF.steel));

    // --- flare boom (lattice) + burner tip
    P.push(...latticeParts(FLARE_BASE, FLARE_TIP, 1.25, 0.6, '#C9CCC8', { bays: 9, r: 0.16, brace: 0.07 }));
    P.push(p(UNIT.cyl8, C.dark, [FLARE_TIP[0], FLARE_TIP[1] + 0.2, FLARE_TIP[2]], [0.7, 1.2, 0.7], null, SURF.rust));
    // deck flood housings (sodium) on the lower deck edges
    for (const [x, z] of [[-21.5, 4], [-21.5, 20], [0, 21.6], [20, 21.6]]) {
      P.push(member([x, LOWER_Y, z], [x, LOWER_Y + 3, z], 0.08, C.dark));
      P.push(p(UNIT.box, '#FFC27A', [x, LOWER_Y + 3.1, z], [0.5, 0.35, 0.35], null, emit(CH.FLOOD, 2)));
    }
    return P;
  }

  _lamps() {
    const L = this.W.lamps;
    const X = this.x, Z = this.z;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      L.add(X + PAD.x + Math.cos(a) * (PAD.r - 0.25), UPPER_Y + 0.12, Z + PAD.z + Math.sin(a) * (PAD.r - 0.25), '#3CFF7A', { gain: 3, bulb: 0.17, halo: 0.8, ch: CH.PERIM });
    }
    L.add(X + DERRICK.x, DERRICK.top + 2.3, Z + DERRICK.z, '#FF2015', { gain: 6, bulb: 0.3, halo: 3, ch: CH.ANTI, pen: 0.5 });
    L.add(X + DERRICK.x, UPPER_Y + 24, Z + DERRICK.z + 3, '#FF2015', { gain: 4, bulb: 0.2, halo: 2, ch: CH.ANTI, pen: 0.4 });
    L.add(X - 5, UPPER_Y + 21.4, Z - 20, '#FF2015', { gain: 5, bulb: 0.22, halo: 2.4, ch: CH.ANTI, pen: 0.4 });
    L.add(X + FLARE_TIP[0] - 2, FLARE_TIP[1] - 1, Z + FLARE_TIP[2] - 1, '#FF2015', { gain: 4, bulb: 0.2, halo: 2, ch: CH.ANTI, pen: 0.4 });
    for (const [x, z] of [[11, -20.5], [21, -7.5]]) L.add(X + x, UPPER_Y + 10.3, Z + z, '#FF2015', { gain: 3, bulb: 0.16, halo: 1.6, ch: CH.ANTI });
    for (const [x, z] of [[-21.5, 4], [-21.5, 20], [0, 21.6], [20, 21.6]]) {
      L.add(X + x, LOWER_Y + 3.1, Z + z, '#FFC27A', { gain: 3, bulb: 0.24, halo: 1.6, ch: CH.FLOOD });
    }
    for (const [x, z] of [[-20, -21], [20, -3], [-20, -3]]) L.add(X + x, UPPER_Y + 2.6, Z + z, '#FFC27A', { gain: 3, bulb: 0.22, halo: 1.5, ch: CH.FLOOD });
    L.add(X + PAD.x - 9, UPPER_Y + 1, Z + PAD.z + 6, '#FFE6B0', { gain: 4, bulb: 0.25, halo: 1.8, ch: CH.PADLIGHT });
    L.add(X + PAD.x + 6, UPPER_Y + 1, Z + PAD.z - 9, '#FFE6B0', { gain: 4, bulb: 0.25, halo: 1.8, ch: CH.PADLIGHT });
    // flare: hot core lamp + glow on the low cloud base
    L.add(X + FLARE_TIP[0], FLARE_TIP[1] + 2, Z + FLARE_TIP[2], '#FF9A40', { gain: 1.4, bulb: 0.6, halo: 7, ch: CH.FLAME, pen: 0.8 });
    this.cloudLamp = L.add(X + FLARE_TIP[0], 74, Z + FLARE_TIP[2], '#FF8A2A', { gain: 0.3, bulb: 0.01, halo: 85, ch: CH.CLOUD, pen: 0.9 });
    this.unloadLamps = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.unloadLamps.push(L.add(X + PAD.x + Math.cos(a) * (PAD.r + 0.5), UPPER_Y + 0.25, Z + PAD.z + Math.sin(a) * (PAD.r + 0.5), '#4FA3FF', { gain: 4, bulb: 0.2, halo: 1.4, ch: CH.UNLOAD0 }));
    }
  }

  setUnloadChannel(ch) {
    const L = this.W.lamps;
    for (const i of this.unloadLamps) if (i >= 0) L.iSz.array[i * 4 + 2] = ch;
    L.iSz.needsUpdate = true;
  }

  // --------------------------------------------------------------------------------------------
  update(dt, env) {
    const W = this.W;
    const ctx = W.ctx;
    const t = env.t;
    // flame: bend with the wind (nearly horizontal in a storm), flicker
    const w = env.windAt(this.tip.x, this.tip.z);
    const ws = Math.hypot(w.x, w.y);
    const bend = clamp(ws / 13, 0, 1.9);
    if (ws > 0.01) this.bend.set((w.x / ws) * bend, 0, (w.y / ws) * bend);
    else this.bend.set(0, 0, 0);
    const u = this.flameMat.uniforms;
    u.uBend.value.lerp(this.bend, dt > 0 ? 1 - Math.exp(-dt * 3) : 0);
    this.flicker = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 23.7 + 1.3) + 0.06 * Math.sin(t * 5.1);
    u.uLen.value = 15 + 3 * Math.sin(t * 0.7);
    u.uRad.value = 2.7;
    u.uI.value = 0.85 + 0.45 * env.night;
    W.channels[CH.FLAME] = this.flicker * (0.7 + 0.5 * env.night);
    const cloudiness = clamp(env.intensity * 1.2 + env.fogK + env.rain * 0.5, 0, 1);
    W.channels[CH.CLOUD] = this.flicker * (0.15 + 0.85 * env.night) * (0.25 + 0.75 * cloudiness);
    const len = u.uLen.value;
    const bv = u.uBend.value;
    this.flameCenter.set(this.tip.x + bv.x * len * 0.35, this.tip.y + len * 0.4, this.tip.z + bv.z * len * 0.35);
    // light spill: flame on the boom and the legs, sodium pools on the decks (object space)
    setGlow(this.material, 0, FLARE_TIP[0] + bv.x * 6, FLARE_TIP[1] + 4, FLARE_TIP[2] + bv.z * 6, 18, FLAME_COL, this.flicker * (0.25 + 0.6 * env.night));
    setGlow(this.material, 1, -6, LOWER_Y + 2, 10, 15, SODIUM, 0.16 * W.channels[CH.FLOOD]);
    setGlow(this.material, 2, 4, UPPER_Y + 3, -8, 15, SODIUM, 0.12 * W.channels[CH.FLOOD]);
    setGlow(this.material, 3, PAD.x, UPPER_Y + 2, PAD.z, 12, SODIUM, 0.08 * W.channels[CH.PADLIGHT]);
    setGlow(this.material, 4, 36, 24, 22, 30, FLAME_COL, this.flicker * 0.12 * env.night);

    // reflection on the water below the flame
    ctx.ocean?.addGlint?.(this.flameCenter.x, this.flameCenter.z, 16, (0.5 + 0.8 * env.night) * this.flicker, FLAME_COL);

    // fx (only when near the camera focus): smoke trail, sparks, a pooled point light
    const near = Math.hypot(env.focus.x - this.tip.x, env.focus.y - this.tip.z) < 520;
    if (near && dt > 0) {
      // dark flare smoke streaming downwind (fx rate-limits; fractional puffs accumulate)
      _v.copy(this.flameCenter).addScaledVector(bv, len * 0.45);
      _v.y += len * 0.3;
      ctx.fx?.smoke?.(_v.x, _v.y, _v.z, '#3A322C', dt * 5, SMOKE_OPTS);
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.35 + 0.5 * Math.random();
        ctx.fx?.sparks?.(this.flameCenter.x, this.flameCenter.y, this.flameCenter.z, '#FFB060', 3);
      }
    }
    if (near && !this.light && ctx.fx?.acquireLight) {
      try {
        this.light = ctx.fx.acquireLight('#FF8A2A', 0, 150) || null;
      } catch {
        this.light = null;
      }
    } else if (!near && this.light) {
      this.light.release?.();
      this.light = null;
    }
    if (this.light) {
      this.light.position?.copy?.(this.flameCenter);
      this.light.set?.(this.flicker * (900 + 3200 * env.night));
    }

    // windsock on the helideck
    const ww = env.windAt(this.hoop.x, this.hoop.z);
    this.windsock.update(W.rigging, this.hoop, ww.x, ww.y, t, dt);

    // foam collars at the legs: breaking water
    const ocean = ctx.ocean;
    const foam = 0.55 + 0.45 * smoothstep(0.5, 5, env.Hs);
    for (let i = 0; i < 4; i++) {
      const lx = this.x + (i & 1 ? -16 : 16), lz = this.z + (i & 2 ? -16 : 16);
      const h = ocean ? ocean.heightAt(lx, lz) : 0;
      if (ocean?.normalAt) ocean.normalAt(lx, lz, _w);
      else _w.set(0, 1, 0);
      W.collars.push(lx, h, lz, _w.x, _w.y, _w.z, 4.4, foam, 0.3, ocean?.searchlightAt ? ocean.searchlightAt(lx, lz) : 0, i * 0.71);
    }
  }

  dispose() {
    if (this.light) {
      this.light.release?.();
      this.light = null;
    }
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.flame.geometry.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}
