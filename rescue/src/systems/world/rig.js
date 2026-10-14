// Oil rig «Северная-7» (DESIGN §2.11 [SHOULD], §3.9, §3.14 op. 4, catalogue #47): four-legged
// jacket, open lower (cellar) deck at 22 m for the 'deck' survivors, upper deck at 32 m with the
// drill floor, derrick (obstacle), accommodation block, process modules and crane; cantilevered
// helideck with H at 32 m; flare boom whose flame bends with the wind (emissive flame mesh + fx
// smoke/sparks + a pooled fx light when close) and lights the low cloud base #FF8A2A.
// On 27 December the accommodation roof reads «С ДНЁМ СПАСАТЕЛЯ» (День спасателя).
import * as THREE from 'three';
import { bake, p, member, beam as boxBeam, railParts, latticeParts, windowParts, shadeVerts, UNIT, SURF, emit, worn } from './geo.js';
import { CH, createPropMaterial, setGlow } from './materials.js';
import { paintHelideck, paintRoof, decalTexture } from './decals.js';
import { Windsock } from './rigging.js';
import { streakPart, containerGeo, lifeboatGeo, stairTower, netRing, paintDeck } from './vessel.js';
import { clamp, smoothstep } from '../../core/math.js';

const LOWER_Y = 22;
const UPPER_Y = 32;
const PAD = { x: -34, z: -24, r: 11.5 };
const FLARE_BASE = [22, 30, 16];
const FLARE_TIP = [56.8, 47, 28.1];
const DERRICK = { x: 4, z: -12, top: 74 };
const LD = { cz: 10, w: 43.6, d: 23.6 }; // painted open part of the lower deck (decal bottom half)

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
const SMOKE_OPTS = { kind: 'generic', size: [4, 18], life: 7, rise: 2.5, alpha: 0.22 };
const TAU = Math.PI * 2;

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

    // decal atlas: helideck (top-left), accommodation roof (top-right), lower-deck plating (bottom)
    this.decal = decalTexture(W.look, 1024, 1024, (g) => {
      paintHelideck(g, 0, 0, 512, PAD.r, { name: this.name.toUpperCase(), deck: '#2E3A36', seed: 41, numbers: ['16.0', '12.8'] });
      paintRoof(g, 512, 0, 512, 512, { text: this.name.toUpperCase(), sub: 'ПЛАТФОРМА · КАНАЛ 16', festive: this.festive, seed: 43 });
      this._paintLowerDeck(g);
    });
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'rig', wear: 'heavy', scale: 0.75 });
    this.mesh = new THREE.Mesh(bake(W.look, this._parts()), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // flare flame at the boom tip (unrotated group; bend comes from the wind uniform)
    // gas flare: layered billboard licks (white-hot core → #FF8A2A → dark red tail, fbm-eaten
    // edges) + a grey-black smoke ribbon streaming downwind, lit orange from below
    const look = W.look;
    this.flameU = {
      uTime: look.uniforms.uTime, uAtlas: look.uniforms.uAtlas,
      uBend: { value: new THREE.Vector3() }, uLen: { value: 15 }, uRad: { value: 2.7 }, uI: { value: 1 },
      uWind: { value: new THREE.Vector3() }, uGlow: { value: 0 }, uDay: { value: 1 },
      uFogNear: W.shared.uFogNear, uFogFar: W.shared.uFogFar,
    };
    this.flameMat = new THREE.ShaderMaterial({ uniforms: this.flameU, vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.smokeMat = new THREE.ShaderMaterial({ uniforms: this.flameU, vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.flame = new THREE.Mesh(flameGeometry(22), this.flameMat);
    this.plume = new THREE.Mesh(plumeGeometry(28), this.smokeMat);
    for (const m of [this.flame, this.plume]) {
      m.position.set(...FLARE_TIP);
      m.position.y += 0.6;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.flame.renderOrder = 7;
    this.plume.renderOrder = 6;
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
    // open part of the cellar deck (under open sky, not under the upper deck): world rect + top height
    this.lowerDeck = { x: this.x, z: this.z + 11, y: LOWER_Y, x0: this.x - 21.8, x1: this.x + 21.8, z0: this.z - 1.5, z1: this.z + 21.8 };
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
    const HV = SURF.steelRusty;
    // --- jacket legs: marine growth through the splash zone, rust weeping at the brace joints, anodes
    const legs = [[16, 16], [-16, 16], [16, -16], [-16, -16]];
    const growth = growthGeometry(C.leg);
    for (const [x, z] of legs) {
      P.push(p(UNIT.cyl20, C.leg, [x, 8, z], [3.0, 24, 3.0], null, SURF.paint));
      P.push({ geometry: growth, vcol: true, color: '#FFFFFF', position: [x, 1, z], scale: [3.1, 6, 3.1], surf: [0.85, 0, 0, 0] });
      P.push(p(UNIT.cyl20, C.dark, [x, 19.6, z], [3.4, 1.2, 3.4], null, HV));
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + x * 0.1;
        P.push(p(UNIT.box, '#A9ADA8', [x + Math.cos(a) * 3.12, 2.2 + k * 0.7, z + Math.sin(a) * 3.12], [0.28, 0.9, 0.28], [0, -a, 0], SURF.steel));
      }
      for (const [dx, dz] of [[-Math.sign(x), 0], [0, -Math.sign(z)]]) {
        const n = new THREE.Vector3(dx, 0, dz);
        for (const y of [12.6, 4.6]) P.push(streakPart([x + dx * 3.0, y, z + dz * 3.0], n, 3.6, 1.6, '#5E3320', C.leg));
        P.push(streakPart([x + dx * 3.0 + dz * 1.4, 19.0, z + dz * 3.0 + dx * 1.4], n, 5.5, 1.2, '#6B3A22', C.leg));
      }
    }
    for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const A = legs[a], Bv = legs[b];
      for (const y of [5, 13]) P.push(member([A[0], y, A[1]], [Bv[0], y, Bv[1]], 0.55, C.leg, SURF.paint));
      P.push(member([A[0], 5, A[1]], [Bv[0], 13, Bv[1]], 0.45, C.leg, SURF.paint));
      P.push(member([Bv[0], 5, Bv[1]], [A[0], 13, A[1]], 0.45, C.leg, SURF.paint));
      P.push(member([A[0], 13, A[1]], [Bv[0], 19.5, Bv[1]], 0.4, C.leg, SURF.paint));
      for (const t of [0.3, 0.7]) P.push(p(UNIT.box, '#A9ADA8', [A[0] + (Bv[0] - A[0]) * t, 4.35, A[1] + (Bv[1] - A[1]) * t], [0.3, 0.3, 0.3], null, SURF.steel));
    }
    // boat landing + ladder + fender tubes on the south-west leg
    P.push(p(UNIT.box, C.yellow, [-16, 2.2, 20], [6, 0.4, 2.2], null, SURF.paintWorn));
    P.push(member([-16, 2.2, 19.2], [-16, 19.5, 18.7], 0.08, C.yellow));
    for (const x of [-18.6, -13.4]) P.push(p(UNIT.cyl8, '#1C1E20', [x, 1.6, 21.2], [0.28, 3.4, 0.28], null, SURF.rubber));

    // --- lower (cellar) deck at 22 m: slab + painted plating (decal), rails, pipe racks, stair tower,
    //     containers, IBC totes, gas bottles, free-fall lifeboats on launch skids, flood posts
    P.push(p(UNIT.box, C.deck, [0, LOWER_Y - 1.25, 0], [44, 2.5, 44], null, HV));
    P.push(p(UNIT.box, '#4A5054', [0, LOWER_Y - 2.7, 0], [42, 0.5, 42], null, HV)); // under-deck girders
    P.push({ geometry: UNIT.plane, color: '#FFFFFF', position: [0, LOWER_Y + 0.015, LD.cz], scale: [LD.w, 1, LD.d], surf: [0.74, 0.2, 0, -1], uvRect: [0, 0, 1, 0.5] });
    const lowerRail = [[-22, -1], [-22, 22], [22, 22], [22, -1]];
    P.push(...railParts(lowerRail, LOWER_Y, 1.1, C.yellow, { post: 2.4, r: 0.05 }));
    P.push(...railParts(lowerRail, LOWER_Y, 0.55, C.yellow, { post: 1000, r: 0.035 }));
    // pipe racks: H-frames along the east edge (full) and the west edge (part), 3 pipes per tier
    const rack = (x0, x1, z0, z1, n) => {
      for (let k = 0; k <= n; k++) {
        const z = z0 + ((z1 - z0) * k) / n;
        for (const x of [x0, x1]) P.push(member([x, LOWER_Y, z], [x, LOWER_Y + 2.7, z], 0.1, '#6E7678', HV));
        for (const y of [1.2, 2.5]) P.push(boxBeam([x0, LOWER_Y + y, z], [x1, LOWER_Y + y, z], 0.16, 0.2, '#6E7678', HV));
      }
      const cols = ['#8A8F88', '#A88A2E', '#5E6B73', '#B9B4A6', '#7E868C', '#6B4A3A'];
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < 3; i++) {
          const x = x0 + ((x1 - x0) * (i + 0.5)) / 3, y = LOWER_Y + (t ? 2.5 : 1.2) + 0.2 + (i === 1 ? 0.06 : 0);
          P.push(member([x, y, z0 - 0.4], [x, y, z1 + 0.4], i === 1 ? 0.2 : 0.14, cols[(t * 3 + i + (x0 > 0 ? 0 : 2)) % 6], i === 1 && t ? SURF.paintWorn : HV));
        }
      }
    };
    rack(19.4, 21.3, 1.5, 19.5, 5);
    rack(-21.3, -19.6, 3.5, 12.5, 3);
    // stair tower: lower deck ↔ upper deck on the west face
    stairTower(P, -24.2, -4.2, LOWER_Y, UPPER_Y, { w: 2.6, d: 4.6, color: C.yellow, frame: '#6E7678' });
    P.push(p(UNIT.box, '#6E7678', [-22.7, LOWER_Y - 0.06, -4.2], [1.4, 0.12, 1.6], null, SURF.steelWorn));
    P.push(p(UNIT.box, '#6E7678', [-22.7, UPPER_Y - 0.06, -4.2], [1.4, 0.12, 1.6], null, SURF.steelWorn));
    // containers (corrugated, doors), an open cargo basket, IBC totes, tool boxes, gas bottle rack
    const box20 = containerGeo();
    P.push({ geometry: box20, vcol: true, color: '#2D5876', position: [13.8, LOWER_Y, 6], rotation: [0, Math.PI / 2, 0], surf: SURF.paintWorn });
    P.push({ geometry: box20, vcol: true, color: '#9E4636', position: [13.8, LOWER_Y, 9.0], rotation: [0, -Math.PI / 2, 0], surf: SURF.paintWorn });
    P.push({ geometry: box20, vcol: true, color: '#7A7F78', position: [13.8, LOWER_Y + 2.6, 7.5], rotation: [0, Math.PI / 2 + 0.03, 0], surf: SURF.paintWorn });
    {
      const bx = 15.6, bz = 15.5, y = LOWER_Y;
      P.push(p(UNIT.box, '#4E5A62', [bx, y + 0.08, bz], [3.2, 0.16, 3.0], null, HV));
      for (const s of [-1, 1]) {
        P.push(p(UNIT.box, '#4E5A62', [bx + s * 1.55, y + 0.6, bz], [0.1, 1.1, 3.0], null, HV));
        P.push(p(UNIT.box, '#4E5A62', [bx, y + 0.6, bz + s * 1.45], [3.2, 1.1, 0.1], null, HV));
      }
      P.push(p(UNIT.box, '#6B4A3A', [bx - 0.5, y + 0.4, bz + 0.3], [1.6, 0.6, 1.2], null, SURF.wood));
    }
    for (const [x, z] of [[7.6, 18.6], [9.0, 18.6], [7.6, 17.2]]) {
      P.push(p(UNIT.box, '#D6D4CA', [x, LOWER_Y + 0.62, z], [1.1, 1.0, 1.1], null, SURF.paintFaded));
      P.push(p(UNIT.box, '#5A6064', [x, LOWER_Y + 1.15, z], [1.18, 0.08, 1.18], null, SURF.steelWorn));
      P.push(p(UNIT.box, '#5A6064', [x, LOWER_Y + 0.07, z], [1.2, 0.14, 1.2], null, SURF.steelWorn));
    }
    P.push(p(UNIT.box, '#B3261E', [-18.4, LOWER_Y + 0.45, 1.6], [1.4, 0.9, 0.7], null, SURF.paintWorn)); // tool boxes
    P.push(p(UNIT.box, '#2F5D8C', [-16.6, LOWER_Y + 0.35, 1.6], [1.0, 0.7, 0.6], null, SURF.paintWorn));
    {
      const gx = -20.4, gz = 15.0;
      P.push(p(UNIT.box, '#5A6064', [gx, LOWER_Y + 0.06, gz], [1.2, 0.12, 2.6], null, HV));
      for (const s of [-1, 1]) P.push(boxBeam([gx + s * 0.55, LOWER_Y + 1.3, gz - 1.3], [gx + s * 0.55, LOWER_Y + 1.3, gz + 1.3], 0.06, 0.08, '#5A6064', HV));
      for (let i = 0; i < 8; i++) {
        const col = i < 4 ? '#2F5D8C' : i < 6 ? '#D8D8D0' : '#7A2A22';
        P.push(p(UNIT.cyl8, col, [gx + (i % 2 ? 0.25 : -0.25), LOWER_Y + 0.85, gz - 1.0 + Math.floor(i / 2) * 0.66], [0.14, 1.5, 0.14], null, SURF.paintWorn));
      }
    }
    // free-fall lifeboats on 35° launch skids over the south edge
    const ff = lifeboatGeo(true);
    for (const x of [-12, 6]) {
      const top = [0, LOWER_Y + 3.6, 19.4], bot = [0, LOWER_Y - 1.3, 26.4];
      for (const s of [-1, 1]) {
        const rx = x + s * 0.8;
        P.push(boxBeam([rx, top[1], top[2]], [rx, bot[1], bot[2]], 0.22, 0.3, '#6E7678', HV));
        P.push(member([rx, LOWER_Y, 19.6], [rx, LOWER_Y + 3.45, 19.6], 0.12, '#6E7678', HV));
        P.push(member([rx, LOWER_Y, 21.7], [rx, LOWER_Y + 1.95, 21.7], 0.12, '#6E7678', HV));
        P.push(member([rx, LOWER_Y - 2.4, 21.9], [rx, bot[1] + 0.2, 25.8], 0.12, '#6E7678', HV));
      }
      P.push(boxBeam([x - 1.1, LOWER_Y + 3.75, 19.4], [x + 1.1, LOWER_Y + 3.75, 19.4], 0.3, 0.3, '#6E7678', HV));
      P.push({ geometry: ff, vcol: true, color: '#FFFFFF', position: [x, LOWER_Y + 1.95, 23.4], rotation: [0.61, Math.PI, 0], surf: worn(SURF.gloss, 'medium') });
    }
    for (const [x, z] of [[-21.5, 4], [-21.5, 20], [0, 21.6], [20, 21.6]]) {
      P.push(member([x, LOWER_Y, z], [x, LOWER_Y + 3, z], 0.08, C.dark));
      P.push(p(UNIT.box, '#FFC27A', [x, LOWER_Y + 3.1, z], [0.5, 0.35, 0.35], null, emit(CH.FLOOD, 2)));
    }
    // columns between the decks
    for (const [x, z] of [[-21, -21], [21, -21], [-21, -3], [21, -3], [0, -3], [-11, -3], [11, -3]]) {
      P.push(p(UNIT.cyl8, C.steel, [x, (LOWER_Y + UPPER_Y - 2) / 2, z], [0.7, UPPER_Y - 2 - LOWER_Y, 0.7], null, HV));
    }

    // --- upper deck at 32 m
    P.push(p(UNIT.box, C.deck, [0, UPPER_Y - 1, -12], [44, 2, 20], null, HV));
    const upperRail = [[-22, -15.5], [-22, -2], [22, -2], [22, -22], [-12, -22]];
    P.push(...railParts(upperRail, UPPER_Y, 1.1, C.yellow, { post: 2.4, r: 0.05 }));
    P.push(...railParts(upperRail, UPPER_Y, 0.55, C.yellow, { post: 1000, r: 0.035 }));
    // drill floor + derrick
    P.push(p(UNIT.box, '#7E8A91', [DERRICK.x, UPPER_Y + 3, DERRICK.z], [12, 6, 12], null, HV));
    for (let k = 0; k < 7; k++) P.push(p(UNIT.box, '#6E7A81', [DERRICK.x - 5.4 + k * 1.8, UPPER_Y + 3, DERRICK.z + 6.04], [0.14, 5.6, 0.1], null, HV));
    P.push(...latticeParts([DERRICK.x, UPPER_Y + 6, DERRICK.z], [DERRICK.x, DERRICK.top, DERRICK.z], 5, 1.3, C.derrick, { bays: 10, r: 0.22, brace: 0.1 }));
    P.push(p(UNIT.box, C.dark, [DERRICK.x, DERRICK.top + 1, DERRICK.z], [3.4, 2, 3.4], null, HV));
    P.push(p(UNIT.box, '#B3261E', [DERRICK.x, DERRICK.top - 3, DERRICK.z], [2.9, 0.6, 2.9], null, SURF.paintWorn));
    P.push(...railParts([[DERRICK.x - 6, DERRICK.z - 6], [DERRICK.x + 6, DERRICK.z - 6], [DERRICK.x + 6, DERRICK.z + 6], [DERRICK.x - 6, DERRICK.z + 6]], UPPER_Y + 6, 1.0, C.yellow, { loop: true, post: 2.4, r: 0.04 }));
    // pipe rack beside the drill floor
    for (let i = 0; i < 5; i++) P.push(member([-2, UPPER_Y + 0.5 + i * 0.32, -20 + i * 0.4], [-2, UPPER_Y + 0.5 + i * 0.32, -5], 0.15, i % 2 ? '#9AA1A6' : '#7A6A4A', HV));
    // accommodation block: window bands with mullions, floor cornices, external stair, roof plant, radio mast
    const AC = { x: 16, y: UPPER_Y + 5, z: -14, w: 11, h: 10, d: 14 };
    P.push(p(UNIT.box, C.white, [AC.x, AC.y, AC.z], [AC.w, AC.h, AC.d], null, SURF.paintWorn));
    for (let f = 0; f < 3; f++) {
      const y0 = UPPER_Y + 1.6 + f * 3.3;
      P.push(...windowParts([AC.x, AC.y, AC.z], [AC.w, AC.h, AC.d], 'z+', { cols: 7, w: 1.36, h: 1.05, ch: CH.WINDOWS, color: C.window, y0 }));
      for (const fc of ['x+', 'x-']) P.push(...windowParts([AC.x, AC.y, AC.z], [AC.w, AC.h, AC.d], fc, { cols: 9, w: 1.38, h: 1.05, ch: CH.WINDOWS, color: C.window, y0 }));
      P.push(p(UNIT.box, '#5A6268', [AC.x, y0, AC.z], [AC.w + 0.06, 1.3, AC.d + 0.06], null, SURF.paint)); // frame band
      P.push(p(UNIT.box, '#C9CCC8', [AC.x, UPPER_Y + 3.3 * (f + 1) - 0.05, AC.z], [AC.w + 0.3, 0.16, AC.d + 0.3], null, SURF.paintWorn)); // cornice
    }
    P.push({ geometry: UNIT.plane, color: '#FFFFFF', position: [AC.x, UPPER_Y + 10.02, AC.z], scale: [10.6, 1, 13.6], surf: SURF.decal, uvRect: [0.5, 0.5, 1, 1] });
    P.push(...railParts([[AC.x - 5.5, AC.z - 7], [AC.x + 5.5, AC.z - 7], [AC.x + 5.5, AC.z + 7], [AC.x - 5.5, AC.z + 7]], UPPER_Y + 10, 1.0, '#B9BDB9', { loop: true, post: 2.2, r: 0.04 }));
    stairTower(P, 19.3, -4.6, UPPER_Y, UPPER_Y + 10, { w: 2.4, d: 4.4, color: C.yellow, frame: '#6E7678' });
    for (const x of [13.2, 16.0]) {
      P.push(p(UNIT.box, '#9AA1A6', [x, UPPER_Y + 10.6, -8.4], [2.2, 1.2, 1.4], null, SURF.paintWorn));
      P.push(p(UNIT.cyl12, '#2A2E30', [x, UPPER_Y + 11.22, -8.4], [0.5, 0.06, 0.5], null, SURF.steel));
    }
    P.push(p(UNIT.box, '#9AA1A6', [14.6, UPPER_Y + 10.35, -10.0], [4.6, 0.6, 0.6], null, SURF.paintWorn)); // duct
    P.push(...latticeParts([11.4, UPPER_Y + 10, -8.0], [11.4, UPPER_Y + 19, -8.0], 0.45, 0.18, '#C9CCC8', { bays: 5, r: 0.05, brace: 0.03 }));
    P.push(member([11.4, UPPER_Y + 19, -8.0], [11.4, UPPER_Y + 23, -8.0], 0.04, '#2E3338'));
    P.push(member([12.4, UPPER_Y + 10, -20.4], [12.4, UPPER_Y + 14.5, -20.4], 0.04, '#2E3338'));
    // davit lifeboats on the accommodation's east face
    const dv = lifeboatGeo(false);
    for (const z of [-18, -10]) {
      P.push({ geometry: dv, vcol: true, color: '#FFFFFF', position: [23.5, UPPER_Y + 3.2, z], surf: worn(SURF.gloss, 'medium') });
      for (const dz of [-2.1, 2.1]) {
        P.push(boxBeam([21.8, UPPER_Y, z + dz], [21.9, UPPER_Y + 5.8, z + dz], 0.3, 0.3, C.steel, HV));
        P.push(boxBeam([21.9, UPPER_Y + 5.8, z + dz], [23.7, UPPER_Y + 6.2, z + dz], 0.24, 0.3, C.steel, HV));
        P.push(member([23.65, UPPER_Y + 6.1, z + dz], [23.5, UPPER_Y + 4.4, z + dz * 0.85], 0.025, '#2A2C2E'));
      }
    }
    // process modules: clad walls with ribs, doors, louvres; separator vessel; vent stacks
    P.push(p(UNIT.box, C.module, [-11, UPPER_Y + 3, -13], [18, 6, 16], null, HV));
    for (let k = 0; k < 12; k++) P.push(p(UNIT.box, '#959EA1', [-19.6 + k * 1.55, UPPER_Y + 3, -4.94], [0.14, 5.8, 0.1], null, HV));
    for (let k = 0; k < 10; k++) P.push(p(UNIT.box, '#959EA1', [-20.04, UPPER_Y + 3, -20.4 + k * 1.6], [0.1, 5.8, 0.14], null, HV));
    for (const x of [-15.5, -6.5]) P.push(p(UNIT.box, '#4A5056', [x, UPPER_Y + 1.1, -4.9], [1.1, 2.1, 0.1], null, SURF.paintWorn));
    P.push(p(UNIT.box, '#3A4046', [-11, UPPER_Y + 5.2, -4.92], [12, 0.9, 0.08], null, HV)); // louvres
    P.push(...railParts([[-20, -21], [-2, -21], [-2, -5], [-20, -5]], UPPER_Y + 6, 1.0, C.yellow, { loop: true, post: 2.4, r: 0.04 }));
    P.push(p(UNIT.box, C.yellow, [-15, UPPER_Y + 6.8, -16], [7, 1.6, 6], null, SURF.paintWorn));
    P.push(p(UNIT.cyl20, '#4F6D7A', [-6, UPPER_Y + 7.3, -9], [1.05, 6.4, 1.05], [0, 0, Math.PI / 2], SURF.paintWorn));
    for (const x of [-8.2, -3.8]) P.push(p(UNIT.box, '#3A4046', [x, UPPER_Y + 6.4, -9], [0.5, 0.8, 1.8], null, HV));
    P.push(p(UNIT.box, '#C9CCC8', [-15, UPPER_Y + 7.2, -8], [5, 2.4, 4], null, SURF.paintWorn));
    for (let i = 0; i < 4; i++) P.push(member([-19.5, UPPER_Y + 6.3 + i * 0.3, -19 + i * 0.5], [-3, UPPER_Y + 6.3 + i * 0.3, -19 + i * 0.5], 0.12, i % 2 ? '#8A8F88' : '#A88A2E', HV));
    for (const [x, z] of [[-3, -19], [-7, -19]]) P.push(p(UNIT.cyl12, C.dark, [x, UPPER_Y + 8.5, z], [0.8, 5, 0.8], null, HV));
    // crane: pedestal, cab, lattice boom, boom rest
    P.push(p(UNIT.cyl12, C.yellow, [-18, UPPER_Y + 0.3, -3], [1.8, 0.6, 1.8], null, SURF.paintWorn));
    P.push(p(UNIT.cyl12, C.yellow, [-18, UPPER_Y + 3.5, -3], [1.2, 7, 1.2], null, SURF.paintWorn));
    P.push(p(UNIT.box, C.yellow, [-18, UPPER_Y + 7.8, -3], [3.2, 2.2, 3.2], null, SURF.paintWorn));
    P.push(p(UNIT.box, '#1E2A33', [-16.4, UPPER_Y + 8.1, -3], [0.1, 1.2, 2.2], null, emit(CH.WINDOWS, 0.5)));
    P.push(...latticeParts([-18, UPPER_Y + 8.5, -3], [-5, UPPER_Y + 21, -20], 0.9, 0.35, C.yellow, { bays: 8, r: 0.14, brace: 0.06 }));
    P.push(member([-5, UPPER_Y + 21, -20], [-5, UPPER_Y + 13, -20], 0.03, '#2A2C2E'));
    P.push(p(UNIT.box, '#C8A030', [-5, UPPER_Y + 12.6, -20], [0.5, 0.7, 0.4], null, SURF.paintWorn));
    P.push(member([-8.6, UPPER_Y + 6, -15.2], [-8.6, UPPER_Y + 9.5, -15.2], 0.18, C.yellow, SURF.paintWorn));
    P.push(p(UNIT.box, C.yellow, [-8.6, UPPER_Y + 9.6, -15.2], [1.6, 0.3, 0.5], [0, 0.9, 0], SURF.paintWorn));

    // --- cantilevered helideck at 32 m (octagon, painted, net, trusses)
    P.push(p(UNIT.oct, '#3A4044', [PAD.x, UPPER_Y - 0.35, PAD.z], [PAD.r, 0.7, PAD.r], null, HV));
    P.push({ geometry: new THREE.CircleGeometry(PAD.r, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [PAD.x, UPPER_Y + 0.01, PAD.z], surf: SURF.decal, uvRect: [0, 0.5, 0.5, 1] });
    netRing(P, PAD.x, UPPER_Y - 0.12, PAD.z, PAD.r + 0.05);
    for (const z of [-30, -22, -14]) {
      P.push(boxBeam([-22, UPPER_Y - 1, z * 0.6 - 6], [PAD.x - 6, UPPER_Y - 0.7, z], 0.6, 0.9, C.steel, HV));
      P.push(member([-16, LOWER_Y - 2, -16], [PAD.x + 2, UPPER_Y - 0.7, z], 0.35, C.steel, HV));
    }
    P.push(member([PAD.x + 10.6, UPPER_Y, PAD.z + 6.4], [PAD.x + 10.6, UPPER_Y + 4.8, PAD.z + 6.4], 0.08, '#D8D8D2'));
    P.push(p(UNIT.torus, '#2A2E33', [PAD.x + 10.6, UPPER_Y + 4.6, PAD.z + 6.4], 0.5, [Math.PI / 2, 0, 0], SURF.steel));

    // --- flare boom (lattice) + burner tip, soot-blackened
    P.push(...latticeParts(FLARE_BASE, FLARE_TIP, 1.25, 0.6, '#C9CCC8', { bays: 9, r: 0.16, brace: 0.07 }));
    P.push(p(UNIT.cyl8, '#141414', [FLARE_TIP[0], FLARE_TIP[1] + 0.2, FLARE_TIP[2]], [0.7, 1.2, 0.7], null, SURF.rust));
    P.push(p(UNIT.box, '#2A2826', [FLARE_TIP[0] - 1.2, FLARE_TIP[1] - 0.8, FLARE_TIP[2] - 0.4], [2.6, 0.2, 2.6], null, HV));
    return P;
  }

  // Lower-deck plating (decal bottom half, ≈23 px/m): plates, gratings along the edges and over the
  // drains, a hatched crane laydown area, the muster point, worn walkways, rust and oil.
  _paintLowerDeck(g) {
    const kx = 1024 / LD.w, kz = 512 / LD.d, k = (kx + kz) / 2;
    const X = (x) => (x + LD.w / 2) * kx, Z = (z) => (z - (LD.cz - LD.d / 2)) * kz;
    const rust = [];
    for (const [x, z] of [[-21, -1.6], [21, -1.6], [0, -1.6], [-11, -1.6], [11, -1.6]]) rust.push([X(x), Z(z), 1.4 * k, 0.8]);
    for (let x = -20; x <= 20; x += 5) rust.push([X(x), Z(21.4), 1.0 * k, 0.6]);
    for (let z = 2; z <= 20; z += 4.5) rust.push([X(20.2), Z(z), 0.9 * k, 0.7], [X(-20.4), Z(z), 0.8 * k, 0.5]);
    rust.push([X(16), Z(15.5), 2 * k, 0.5], [X(-20.4), Z(15), 1.2 * k, 0.6], [X(-12), Z(20), 1.3 * k, 0.6], [X(6), Z(20), 1.3 * k, 0.6]);
    paintDeck(g, 0, 512, 1024, 512, k, {
      base: '#6A7072',
      plate: [6, 2.4],
      seed: 47,
      gratings: [[X(-21.8), Z(-1.8), X(-19.4) - X(-21.8), Z(21.8) - Z(-1.8)], [X(19.2), Z(-1.8), X(21.8) - X(19.2), Z(21.8) - Z(-1.8)], [X(-19.4), Z(19.6), X(19.2) - X(-19.4), Z(21.8) - Z(19.6)], [X(-4), Z(8), 3 * kx, 2 * kz], [X(4), Z(12), 3 * kx, 2 * kz]],
      hatch: [[X(11.6), Z(3.2), 0.5 * kx, 9 * kz], [X(11.6), Z(3.2), 6.6 * kx, 0.5 * kz], [X(11.6), Z(11.7), 6.6 * kx, 0.5 * kz]],
      lines: [[X(-17.4), Z(13.8), 4.8 * kx, 0.25 * kz], [X(-17.4), Z(18.5), 4.8 * kx, 0.25 * kz], [X(-17.4), Z(13.8), 0.25 * kx, 4.9 * kz], [X(-12.85), Z(13.8), 0.25 * kx, 4.9 * kz],
        [X(-19.2), Z(0.4), 38.3 * kx, 0.2 * kz], [X(-19.2), Z(19.2), 38.3 * kx, 0.2 * kz]],
      marks: [['М', X(-15), Z(16.0), 2.6 * k, 'rgba(201,162,39,0.85)'], ['ПУНКТ СБОРА', X(-15), Z(18.0), 0.55 * k, 'rgba(230,228,220,0.75)']],
      paths: [[X(-21), Z(-1), X(-15), Z(15), 2.2 * k], [X(-15), Z(17), X(6), Z(19), 2.4 * k], [X(-21), Z(-1), X(14), Z(4), 2 * k], [X(14), Z(4), X(18), Z(18), 1.6 * k]],
      rust,
      oil: 14,
      fade: 0.18,
    });
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
    L.add(X + FLARE_TIP[0], FLARE_TIP[1] + 2, Z + FLARE_TIP[2], '#FF9A40', { gain: 0.8, bulb: 0.5, halo: 4, ch: CH.FLAME, pen: 0.8 });
    this.cloudLamp = L.add(X + FLARE_TIP[0], 74, Z + FLARE_TIP[2], '#FF8A2A', { gain: 0.2, bulb: 0.01, halo: 50, ch: CH.CLOUD, pen: 0.9 });
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
    const u = this.flameU;
    u.uBend.value.lerp(this.bend, dt > 0 ? 1 - Math.exp(-dt * 3) : 0);
    this.flicker = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 23.7 + 1.3) + 0.06 * Math.sin(t * 5.1);
    // 12–18 Hz jitter of the light it throws (the flame's own licks animate in the shader)
    const jit = 1 + 0.13 * Math.sin(t * TAU * 13.1) + 0.09 * Math.sin(t * TAU * 17.3 + 1.7) + 0.05 * Math.sin(t * TAU * 15.2 + 0.4);
    u.uLen.value = 15 + 3 * Math.sin(t * 0.7);
    u.uRad.value = 2.9;
    u.uI.value = 0.75 + 0.55 * env.night;
    u.uGlow.value = this.flicker * (0.08 + 0.5 * env.night);
    u.uDay.value = 1 - env.night;
    const wk = clamp(ws / 12, 0, 1);
    if (ws > 0.01) u.uWind.value.set((w.x / ws) * wk, clamp(ws / 16, 0, 1), (w.y / ws) * wk);
    else u.uWind.value.set(0, 0, 0);
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

    // reflection on the water below the flame: a tight, flickering orange pool (emissive, so the
    // hue stays orange instead of being multiplied into brown by the dark water albedo)
    ctx.ocean?.addGlint?.(this.flameCenter.x, this.flameCenter.z, 13, (0.45 + 1.0 * env.night) * this.flicker * jit, FLAME_COL);

    // fx (only when near the camera focus): smoke trail, sparks, a pooled point light
    const near = Math.hypot(env.focus.x - this.tip.x, env.focus.y - this.tip.z) < 520;
    if (near && dt > 0) {
      // dark flare smoke streaming downwind (fx rate-limits; fractional puffs accumulate)
      _v.copy(this.flameCenter).addScaledVector(bv, len * 0.45);
      _v.y += len * 0.3;
      ctx.fx?.smoke?.(_v.x, _v.y, _v.z, '#3A322C', dt * 2.5, SMOKE_OPTS);
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.35 + 0.5 * Math.random();
        ctx.fx?.sparks?.(this.flameCenter.x, this.flameCenter.y, this.flameCenter.z, '#FFB060', 3);
      }
    }
    if (near && !this.light && ctx.fx?.acquireLight) {
      try {
        this.light = ctx.fx.acquireLight('#FF8A2A', 0, 55) || null;
      } catch {
        this.light = null;
      }
    } else if (!near && this.light) {
      this.light.release?.();
      this.light = null;
    }
    if (this.light) {
      this.light.position?.copy?.(this.flameCenter);
      this.light.set?.(this.flicker * jit * (300 + 1100 * env.night));
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
    this.plume.geometry.dispose();
    this.flameMat.dispose();
    this.smokeMat.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}

// Splash-zone marine growth (unit cylinder band, y −0.5…0.5 → world −2…4 m): mussel / kelp
// green-brown, mottled, with a ragged top that fades into the leg paint.
let _growth = null;
function growthGeometry(legHex) {
  if (_growth) return _growth;
  const g = new THREE.CylinderGeometry(1, 1.02, 1, 28, 8, true);
  const leg = new THREE.Color(legHex), a = new THREE.Color('#2E3424'), b = new THREE.Color('#4A3A26'), rust = new THREE.Color('#6B3A22');
  shadeVerts(g, (x, y, z, c) => {
    const ang = Math.atan2(x, z);
    const n = 0.5 + 0.25 * Math.sin(ang * 5 + y * 9) + 0.25 * Math.sin(ang * 13 - y * 17);
    const top = 0.18 + 0.2 * Math.sin(ang * 7 + 1.3) * Math.sin(ang * 3);
    c.copy(a).lerp(b, n);
    const f = THREE.MathUtils.smoothstep(y, top, top + 0.22);
    c.lerp(rust, f * 0.6 * n).lerp(leg, f * f);
  });
  return (_growth = g);
}

// Flame: n camera-facing licks rising along the bent axis and recycling (≈1 s), each eaten by two
// octaves of upward-scrolling atlas noise → turbulent breakup instead of a smooth cone.
function flameGeometry(n) {
  const q = [], k = [];
  for (let i = 0; i < n; i++) {
    const seed = ((i * 0.618034) % 1 + 0.05 * Math.sin(i * 12.9)) % 1;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      q.push(x, y);
      k.push(i / n, seed);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(q.length * 1.5), 3));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(q, 2));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(k, 2));
  return g;
}
function plumeGeometry(n) {
  const s = [], side = [];
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    for (const [t, sd] of [[a, -1], [b, -1], [b, 1], [a, -1], [b, 1], [a, 1]]) {
      s.push(t);
      side.push(sd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(s.length * 3), 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  return g;
}
const FLAME_VS = /* glsl */ `
uniform float uTime, uLen, uRad;
uniform vec3 uBend;
attribute vec2 aQ;
attribute vec2 aK;
varying vec2 vQ;
varying float vH;
varying float vS;
void main() {
  float s = aK.y;
  float h = fract(aK.x + uTime * (0.85 + 0.45 * s));
  float len = uLen * (0.9 + 0.2 * s);
  vec3 c = vec3(0.0, h * len, 0.0) + uBend * (h * h) * len;
  c.x += sin(uTime * 6.0 + s * 31.0) * h * h * 2.2;
  c.z += cos(uTime * 5.3 + s * 17.0) * h * h * 2.2;
  float size = uRad * (0.55 + 1.7 * h) * (1.0 - 0.5 * h * h) * (0.8 + 0.4 * s);
  vec4 wp = modelMatrix * vec4(c, 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float an = s * 6.2832 + uTime * (s - 0.5) * 1.5;
  vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * aQ;
  wp.xyz += (right * q.x + up * q.y) * size;
  vQ = aQ;
  vH = h;
  vS = s;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FLAME_FS = /* glsl */ `
uniform float uTime, uI;
uniform sampler2D uAtlas;
varying vec2 vQ;
varying float vH;
varying float vS;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  vec2 uv = vQ * 0.3 + vec2(vS * 7.1, vS * 3.3);
  float n = texture2D(uAtlas, uv + vec2(0.0, -uTime * 0.8)).r * 0.65 + texture2D(uAtlas, uv * 2.3 + vec2(0.31, -uTime * 1.9)).g * 0.35;
  float shape = (1.0 - r) * 1.3 - (1.0 - n) * (0.5 + 0.5 * vH);
  float a = smoothstep(0.0, 0.3, shape) * (1.0 - smoothstep(0.7, 1.0, vH)) * smoothstep(0.0, 0.04, vH);
  float heat = clamp((1.0 - vH * 1.35) * (0.45 + 0.65 * (1.0 - r)) * (0.7 + 0.5 * n), 0.0, 1.0);
  vec3 core = vec3(1.0, 0.906, 0.745) * 3.5;
  vec3 mid = vec3(1.0, 0.254, 0.023) * 1.3;
  vec3 tail = vec3(0.3, 0.035, 0.008);
  vec3 col = heat > 0.55 ? mix(mid, core, smoothstep(0.55, 0.95, heat)) : mix(tail, mid, smoothstep(0.08, 0.55, heat));
  // ~22 licks overlap where the camera looks down the flame axis: keep each one faint
  gl_FragColor = vec4(col * a * uI * 0.075, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Smoke ribbon from the flame tip: rises steeply in a calm, streams downwind in a blow; camera-facing
// width, puffy edges from scrolling noise, alpha ≤ .3, orange underglow near the flame.
const PLUME_VS = /* glsl */ `
uniform float uTime, uLen;
uniform vec3 uBend;
uniform vec3 uWind;
attribute float aS;
attribute float aSide;
varying float vS;
varying float vSide;
varying vec3 vW;
void main() {
  float s = aS;
  vec3 top = vec3(0.0, uLen * 0.85, 0.0) + uBend * uLen * 0.75;
  float wk = length(uWind.xz);
  vec3 dir = normalize(vec3(uWind.x, 0.25 + 1.1 * (1.0 - wk), uWind.z));
  float L = 60.0 + 70.0 * uWind.y;
  vec3 c = top + dir * (s * L);
  c.y += s * s * 10.0;
  vec3 lat = normalize(vec3(-dir.z, 0.0, dir.x) + vec3(1e-4, 0.0, 0.0));
  c += lat * sin(s * 6.0 - uTime * 0.5) * s * 5.0;
  vec4 wp = modelMatrix * vec4(c, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 side = normalize(cross(dir, toCam) + vec3(0.0, 1e-4, 0.0));
  wp.xyz += side * aSide * (1.8 + 15.0 * s);
  vS = s;
  vSide = aSide;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const PLUME_FS = /* glsl */ `
uniform float uTime, uGlow, uDay, uFogNear, uFogFar;
uniform sampler2D uAtlas;
varying float vS;
varying float vSide;
varying vec3 vW;
void main() {
  float n = texture2D(uAtlas, vec2(vS * 2.0 - uTime * 0.05, vSide * 0.25 + 0.5)).r;
  float n2 = texture2D(uAtlas, vec2(vS * 5.5 - uTime * 0.11, vSide * 0.55 + 0.2)).g;
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide) + (n2 - 0.5) * 0.6);
  float a = 0.3 * edge * smoothstep(0.0, 0.05, vS) * (1.0 - smoothstep(0.5, 1.0, vS)) * (0.45 + 0.7 * n);
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  a *= 1.0 - smoothstep(uFogNear, uFogFar, length(vW.xz - cameraPosition.xz - focus));
  vec3 col = vec3(0.06, 0.056, 0.052) * (0.2 + 0.8 * uDay) + vec3(1.0, 0.254, 0.023) * uGlow * (1.0 - smoothstep(0.0, 0.3, vS));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
