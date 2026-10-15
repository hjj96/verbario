// Rescue ship «Арктур» (DESIGN §2.11 [MUST], §3.9, catalogue #15, #44): grey hull #5C6670 with a
// rescue stripe, white superstructure #E6E6E0, orange lifeboats, mast with navigation lights and a
// turning radar, stern helideck at 9 m (#2B3034, yellow circle #F2C200, white H, green perimeter
// #3CFF7A, floodlights #FFE6B0 + the world's deck PointLight). Steams 3–5 m/s along its route,
// pitches / rolls / heaves from three ocean samples (deck tilt → pad.tilt), slams its bow into
// crests (fx spray), leaves a Kelvin wake (ocean.addWake), a signalman marshals with glowing wands,
// and the horn sounds when the heli comes within 300 m ('world:horn').
// Realism pass (one style with the granite terrain): weathered hull (2.5 m plating, rust runs from
// hawses / scuppers, grimy boot-top), bulwark with freeing ports, hawse pipes with stowed anchors,
// windlass + chain, painted foredeck plating (decal), raked bridge glass with open wings, tripod
// mast with radar platform, sooty funnel with exhausts, enclosed lifeboats on gravity davits,
// helideck safety net; medium wear on the shared prop material; green water sweeps the
// forecastle after a heavy bow slam (sheet + fx spray).
import * as THREE from 'three';
import { bake, p, member, beam as boxBeam, hullGeometry, deckGeometry, windowParts, railParts, shadeVerts, UNIT, SURF, emit, worn } from './geo.js';
import { CH, createPropMaterial, beamGeometry, setGlow } from './materials.js';
import { paintHelideck, decalTexture } from './decals.js';
import { VesselMotion, Navigator, weatherHull, hullSurface, streakPart, containerGeo, lifeboatGeo, framed, bridgeGlass, ladderParts, netRing, paintDeck } from './vessel.js';
import { Windsock } from './rigging.js';
import { clamp, smoothstep } from '../../core/math.js';

const SIDES = [-1, 1]; // reused in per-frame loops (no array literal per frame)
const L = 72;
const B = 15;
const DECK_Y = 9.0; // helideck top (local)
const DECK_Z = 24.5; // helideck centre (local, aft)
const DECK_R = 11.5; // octagon corner radius
const HORN_R = 300;
const HULL_C = '#5C6670'; // topside grey (DESIGN §2.11)
const FORE = { z0: -36, z1: -4, w: 16 }; // painted foredeck: decal u along z0 → z1, v across a w-wide beam

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
const FLOOD_COL = new THREE.Color('#FFE2B0'); // light-spill colours, parsed once (update() runs every frame)
const DECK_COL = new THREE.Color('#FFE6B0');
const WHITE = new THREE.Color('#FFFFFF');
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

    const parts = this._parts();
    // decal atlas: helideck (top-left), painted foredeck plating (bottom half)
    this.decal = decalTexture(W.look, 1024, 1024, (g) => {
      paintHelideck(g, 0, 0, 512, DECK_R, { name: this.name.toUpperCase(), seed: 29 + index, numbers: ['12.8', '9.6'] });
      this._paintForedeck(g, 29 + index);
    });
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'ship', wear: 'medium', scale: 0.8 });
    this.mesh = new THREE.Mesh(bake(W.look, parts), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // flood cones from the superstructure onto the helideck (visible in rain / fog / night)
    this.cones = new THREE.Mesh(this._coneGeometry(), W.mats.flood);
    this.cones.frustumCulled = false;
    this.cones.renderOrder = 5;
    this.group.add(this.cones);

    // green water over the forecastle after a bow slam: a foam-laced sheet sweeping aft
    this.green = 0;
    this.greenT = 0;
    this.sheetU = { uT: { value: 9 }, uK: { value: 0 }, uLit: { value: 1 }, uTime: W.look.uniforms.uTime, uAtlas: W.look.uniforms.uAtlas, uFogNear: W.shared.uFogNear, uFogFar: W.shared.uFogFar };
    this.sheet = new THREE.Mesh(deckGeometry(this.hull, -8, -L / 2 + 0.5, 0.2, 16).translate(0, 0.2, 0), new THREE.ShaderMaterial({ uniforms: this.sheetU, vertexShader: SHEET_VS, fragmentShader: SHEET_FS, transparent: true, depthWrite: false }));
    this.sheet.visible = false;
    this.sheet.renderOrder = 4;
    this.group.add(this.sheet);

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
    const hull = hullGeometry({ length: L, beam: B, deckAft: 5.2, deckFwd: 7.4, keel: 3.6, transom: 0.86, bowStart: 0.6, rake: 5, stripeAt: 0.8, stations: 29, topside: HULL_C, stripe: '#D2512A' });
    // plating seams every 2.5 m, rust runs from scuppers / hawses, grimy boot-top, scraped bow
    weatherHull(hull, { L, seed: 11, rustK: 0.55, lift: 0.36, runs: [[-31.4, 0, 6.1, 4.2, 0.55, 0.75], [-27.5, 0, 5.4, 3, 0.4, 0.4]] });
    this.hull = hull;
    P.push({ geometry: hull.geometry, vcol: true, surf: SURF.paint });
    // main deck: painted, plated foredeck (decal) + plain aft deck under the superstructure
    const fore = deckGeometry(hull, FORE.z1, -L / 2 + 0.6, 0.3, 22);
    const fp = fore.attributes.position;
    const uv = new Float32Array(fp.count * 2);
    for (let i = 0; i < fp.count; i++) {
      uv[i * 2] = (fp.getZ(i) - FORE.z0) / (FORE.z1 - FORE.z0);
      uv[i * 2 + 1] = 1 - (fp.getX(i) + FORE.w / 2) / FORE.w;
    }
    fore.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    P.push({ geometry: fore, color: '#FFFFFF', surf: [0.72, 0, 0, -1], uvRect: [0, 0, 1, 0.5] });
    P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, FORE.z1, 0.3, 14), color: C.deck, surf: [0.74, 0, 0, 0] });
    const deckAt = (z) => hull.deckAt(z);
    const edge = (z) => Math.max(0.15, hull.halfBeamAt(z) - 0.1);

    // --- bulwark with freeing ports along the foredeck, white capping; open rails further aft
    for (const side of SIDES) {
      let k = 0;
      for (let z = FORE.z1; z > -35.2; z -= 1.6, k++) {
        const z2 = Math.max(z - 1.6, -35.4);
        const a = [side * edge(z), deckAt(z), z], b = [side * edge(z2), deckAt(z2), z2];
        const port = z > -27 && k % 3 === 1;
        const y0 = port ? 0.36 : 0.02, y1 = 1.1;
        P.push(boxBeam([a[0], a[1] + (y0 + y1) / 2, a[2]], [b[0], b[1] + (y0 + y1) / 2, b[2]], 0.1, y1 - y0, HULL_C, SURF.paint));
        P.push(member([a[0], a[1] + 1.13, a[2]], [b[0], b[1] + 1.13, b[2]], 0.08, C.white, SURF.paint));
        if (!port) P.push(p(UNIT.box, HULL_C, [a[0] - side * 0.24, a[1] + 0.45, a[2]], [0.4, 0.86, 0.06], null, SURF.paint));
      }
      let prev = null;
      for (let z = 12; z >= FORE.z1; z -= 2.4) {
        const x = side * Math.max(0.2, hull.halfBeamAt(z) - 0.15);
        const y = deckAt(z);
        P.push(member([x, y, z], [x, y + 1.1, z], 0.045, C.white));
        if (prev) {
          P.push(member([prev[0], prev[1] + 1.1, prev[2]], [x, y + 1.1, z], 0.05, C.white));
          P.push(member([prev[0], prev[1] + 0.55, prev[2]], [x, y + 0.55, z], 0.035, C.white));
        }
        prev = [x, y, z];
      }
    }

    // --- helideck at the stern (octagon, painted top, safety net, supports)
    P.push(p(UNIT.oct, C.helideckUnder, [0, DECK_Y - 0.3, DECK_Z], [DECK_R, 0.6, DECK_R], null, SURF.steelWorn));
    P.push({ geometry: new THREE.CircleGeometry(DECK_R, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [0, DECK_Y + 0.01, DECK_Z], surf: SURF.decal, uvRect: [0, 0.5, 0.5, 1] });
    netRing(P, 0, DECK_Y - 0.12, DECK_Z, DECK_R + 0.05);
    for (const x of [-5.5, 5.5]) {
      for (const z of [DECK_Z - 8, DECK_Z, DECK_Z + 8]) {
        const y = deckAt(Math.min(z, L / 2 - 0.5));
        P.push(member([x, y, z], [x, DECK_Y - 0.6, z], 0.28, C.steel, SURF.steelWorn));
        P.push(member([x * 1.25, y, z], [x * 1.95, DECK_Y - 0.6, z], 0.12, C.steel, SURF.steelWorn));
      }
      P.push(boxBeam([x, DECK_Y - 0.75, DECK_Z - 10], [x, DECK_Y - 0.75, DECK_Z + 10], 0.35, 0.3, C.steel, SURF.steelWorn));
    }

    // --- superstructure: deckhouse A (main deck), B, bridge C with wings, monkey island, funnel
    const yA0 = deckAt(4);
    P.push(p(UNIT.box, C.white, [0, (yA0 + 8.6) / 2, 4], [12.4, 8.6 - yA0, 14], null, SURF.paint));
    P.push(p(UNIT.box, C.white, [0, 9.9, 2.5], [11.2, 2.6, 13], null, SURF.paint));
    P.push(p(UNIT.box, C.white, [0, 12.5, -3.2], [11.6, 2.6, 6.4], null, SURF.paint));
    P.push(p(UNIT.box, '#B4B9B8', [0, 13.95, -3.5], [12.0, 0.3, 7.2], null, SURF.paint)); // bridge roof + visor
    P.push(p(UNIT.box, '#C9CCC8', [0, 11.25, 2.5], [11.4, 0.12, 13.2], null, SURF.paint)); // B-deck roof
    P.push(p(UNIT.box, '#9AA1A6', [0, 8.65, 4], [12.5, 0.1, 14.1], null, SURF.paint)); // A-deck roof walkway
    P.push(p(UNIT.box, '#D6D6D0', [0, 8.0, 4], [12.5, 0.25, 14.1], null, SURF.paint)); // A deck cornice
    // portholes / cabin windows with frames
    const win = (c, s, f, o) => P.push(...framed(windowParts(c, s, f, { ch: CH.WINDOWS, color: C.window, ...o })));
    for (const f of ['x+', 'x-']) {
      win([0, 6.9, 4], [12.4, 3.3, 14], f, { cols: 7, w: 0.8, h: 0.8 });
      win([0, 9.9, 2.5], [11.2, 2.6, 13], f, { cols: 6, w: 0.9, h: 0.75 });
    }
    win([0, 9.9, 2.5], [11.2, 2.6, 13], 'z+', { cols: 5, w: 1.1, h: 0.8 });
    // doors (A front and sides) with coamings
    for (const s of SIDES) {
      P.push(p(UNIT.box, '#4A5056', [s * 2.6, yA0 + 1.05, -3.04], [0.95, 1.95, 0.08], null, SURF.paintWorn));
      P.push(p(UNIT.box, '#4A5056', [s * 6.24, yA0 + 1.05, -1.2], [0.08, 1.95, 0.95], null, SURF.paintWorn));
      P.push(p(UNIT.box, '#4A5056', [s * 5.64, 9.55, 7.6], [0.08, 1.9, 0.9], null, SURF.paintWorn));
    }
    // bridge: raked wrap-around glass (front, chamfered corners, sides) — dark, reflecting the sky
    bridgeGlass(P, -5.1, 5.1, 12.15, 13.45, -6.4, { n: 7 });
    for (const s of SIDES) {
      P.push(p(UNIT.box, '#1A2630', [s * 5.55, 12.8, -6.15], [0.75, 1.3, 0.06], [0, s * 0.78, 0], SURF.glass));
      for (let k = 0; k < 3; k++) P.push(p(UNIT.box, '#1A2630', [s * 5.83, 12.8, -5.0 + k * 1.55], [0.06, 1.2, 1.3], null, SURF.glass));
      // open bridge wing: deck plate, bulwark front / side, side-light box, wing console
      P.push(p(UNIT.box, C.white, [s * 6.75, 11.15, -4.7], [1.9, 0.22, 3.2], null, SURF.paint));
      P.push(p(UNIT.box, C.white, [s * 6.75, 11.8, -6.25], [1.9, 1.1, 0.1], null, SURF.paint));
      P.push(p(UNIT.box, C.white, [s * 7.68, 11.8, -4.7], [0.1, 1.1, 3.2], null, SURF.paint));
      P.push(p(UNIT.box, '#2E3338', [s * 7.7, 12.55, -4.6], [0.3, 0.4, 0.5], null, SURF.steel));
      P.push(member([s * 5.85, 11.0, -6.2], [s * 7.6, 9.8, -6.2], 0.08, C.white, SURF.paint)); // wing bracket
      P.push(p(UNIT.box, '#3A4046', [s * 6.6, 11.75, -5.6], [0.6, 1.0, 0.5], null, SURF.paint));
    }
    // monkey island: rails, searchlights, mast tripod, radar platform, yard, antennas
    P.push(...railParts([[-5.9, -7.0], [5.9, -7.0], [5.9, 0.0], [-5.9, 0.0]], 14.1, 1.0, C.white, { loop: true, post: 1.8, r: 0.04 }));
    for (const s of SIDES) {
      P.push(p(UNIT.cyl12, '#2E3338', [s * 4.8, 14.6, -6.3], [0.32, 0.55, 0.32], [Math.PI / 2, 0, 0], SURF.steel));
      P.push(member([s * 1.7, 14.1, -0.6], [0, 20.4, -2.9], 0.11, '#B9BDB9'));
      P.push(member([s * 1.4, 21.65, -2.0], [s * 1.4, 24.0, -2.0], 0.03, '#2E3338')); // whip antennas
      P.push(member([s * 5.4, 14.1, -0.4], [s * 5.4, 18.0, -0.4], 0.03, '#2E3338'));
    }
    P.push(member([0, 14.1, -3], [0, 25.3, -3], 0.2, '#B9BDB9'));
    P.push(p(UNIT.box, '#9AA1A6', [0, 21.5, -3.0], [2.6, 0.14, 2.2], null, SURF.steelWorn));
    P.push(...railParts([[-1.3, -4.1], [1.3, -4.1], [1.3, -1.9], [-1.3, -1.9]], 21.57, 0.8, '#B9BDB9', { loop: true, post: 1.3, r: 0.03 }));
    P.push(p(UNIT.cyl8, C.dark, [0, 21.95, -3], [0.55, 0.6, 0.55], null, SURF.steel));
    P.push(p(UNIT.sphereLo, '#E8E8E2', [0.9, 22.1, -2.2], 0.32, null, SURF.gloss)); // satcom dome
    P.push(member([-2.3, 23.6, -3], [2.3, 23.6, -3], 0.08, '#B9BDB9'));
    P.push(member([0, 18, -3], [0, 14.1, 0.4], 0.07, '#B9BDB9'));
    // funnel: raked elliptic stack, service bands, soot-blackened top, exhaust pipes
    P.push({ geometry: funnelGeometry(), vcol: true, color: HULL_C, position: [0, 13.8, 5.4], scale: [1.9, 5.2, 2.5], rotation: [0.07, 0, 0], surf: SURF.paint });
    P.push(p(UNIT.cyl12, C.white, [0, 14.0, 5.3], [1.95, 0.5, 2.56], [0.07, 0, 0], SURF.paint));
    P.push(p(UNIT.cyl12, '#E8581E', [0, 14.5, 5.33], [1.95, 0.5, 2.56], [0.07, 0, 0], SURF.paint));
    P.push(p(UNIT.cyl12, '#0E0F10', [0, 16.25, 5.58], [1.75, 0.2, 2.3], [0.07, 0, 0], SURF.rust)); // stack mouth
    for (const [x, z, r, h] of [[-0.6, 5.3, 0.3, 1.5], [0.6, 5.3, 0.3, 1.5], [0, 6.4, 0.2, 1.1]]) {
      P.push(p(UNIT.cyl12, '#26282A', [x, 16.3 + h / 2, z + 0.25], [r, h, r], null, SURF.steelRusty));
      P.push(p(UNIT.cyl12, '#0B0B0B', [x, 16.32 + h, z + 0.25], [r * 0.82, 0.06, r * 0.82], null, SURF.rust));
    }
    P.push(p(UNIT.cyl8, '#3A4046', [0, 15.6, 3.15], [0.12, 0.6, 0.12], [Math.PI / 2.5, 0, 0], SURF.steel)); // whistle
    // A / B roofs: mushroom vents, AC units; ladders between the decks
    for (const [x, z] of [[-4.6, 10.2], [4.6, 10.2], [-3.2, 10.3]]) {
      P.push(p(UNIT.cyl8, '#C9CCC8', [x, 9.0, z], [0.18, 0.7, 0.18], null, SURF.paint));
      P.push(p(UNIT.hemi, '#C9CCC8', [x, 9.33, z], [0.36, 0.25, 0.36], null, SURF.paint));
    }
    P.push(p(UNIT.box, '#AEB3B2', [2.6, 11.65, 7.4], [1.6, 0.8, 1.0], null, SURF.paintWorn));
    for (const s of SIDES) {
      ladderParts(P, [s * 4.4, deckAt(-5.8), -5.8], [s * 4.4, 8.6, -3.2], 0.7, '#C9CCC8');
      ladderParts(P, [s * 3.4, 8.7, 10.9], [s * 3.4, 11.3, 9.1], 0.7, '#C9CCC8', { treads: 5 });
    }
    // lifeboats (totally enclosed, gravity davits with falls), both sides; liferaft canisters
    const lb = lifeboatGeo(false);
    for (const side of SIDES) {
      for (const z of [0.2, 6.8]) {
        P.push({ geometry: lb, vcol: true, color: '#FFFFFF', position: [side * 8.0, 9.5, z], scale: [1.02, 1.0, 1.04], surf: worn(SURF.gloss, 'light') });
        for (const dz of [-2.2, 2.2]) {
          P.push(boxBeam([side * 6.2, 8.6, z + dz], [side * 6.4, 11.4, z + dz], 0.3, 0.3, C.steel, SURF.steelWorn));
          P.push(boxBeam([side * 6.4, 11.4, z + dz], [side * 8.2, 11.9, z + dz], 0.24, 0.3, C.steel, SURF.steelWorn));
          P.push(member([side * 8.15, 11.8, z + dz], [side * 8.0, 10.75, z + dz * 0.85], 0.025, '#2A2C2E'));
        }
      }
      for (let k = 0; k < 3; k++) P.push(p(UNIT.cyl8, '#ECEBE6', [side * 5.7, 11.65, -1.5 + k * 1.1], [0.32, 1.1, 0.32], [0, 0, Math.PI / 2], SURF.gloss));
      P.push(p(UNIT.box, '#7E868C', [side * 5.7, 11.36, -0.4], [1.2, 0.1, 3.4], null, SURF.steelWorn));
    }
    // fast rescue boat (orange RIB) in its cradle + davit, port side forward
    {
      const y = deckAt(-9) + 0.75, z = -9, x = -4.2;
      for (const s of SIDES) P.push(p(UNIT.cyl8, '#E8641E', [x + s * 0.95, y, z], [0.42, 5.4, 0.42], [Math.PI / 2, 0, 0], SURF.rubber));
      P.push(p(UNIT.sphereLo, '#E8641E', [x, y, z - 2.7], [1.35, 0.42, 0.9], null, SURF.rubber));
      P.push(p(UNIT.box, '#2A2E33', [x, y - 0.1, z + 0.2], [1.5, 0.4, 5], null, SURF.rubber));
      P.push(p(UNIT.box, '#D8D8D2', [x, y + 0.45, z + 0.6], [0.6, 0.6, 0.6], null, SURF.paint));
      P.push(p(UNIT.box, '#1A1C1E', [x, y + 0.35, z + 2.85], [0.45, 0.9, 0.4], null, SURF.steel)); // outboard
      for (const dz of [-1.6, 1.6]) P.push(p(UNIT.box, '#3A3F44', [x, y - 0.55, z + dz], [2.3, 0.4, 0.35], null, SURF.steelWorn)); // chocks
      P.push(member([x - 1.6, y - 0.7, z + 3.2], [x - 0.6, y + 3.4, z + 1.4], 0.14, C.yellow, SURF.paintWorn));
      P.push(member([x - 0.6, y + 3.4, z + 1.4], [x - 0.3, y + 3.2, z], 0.1, C.yellow, SURF.paintWorn));
      P.push(member([x - 0.3, y + 3.2, z], [x, y + 0.6, z], 0.02, '#2A2C2E'));
    }
    // forecastle: knuckle crane with rams and hook block, windlass, chain, hawse pipes, anchors
    {
      const z = -17, y = deckAt(z);
      P.push(p(UNIT.cyl12, C.yellow, [3.6, y + 0.15, z], [1.35, 0.3, 1.35], null, SURF.paintWorn));
      P.push(p(UNIT.cyl12, C.yellow, [3.6, y + 1.5, z], [0.95, 3, 0.95], null, SURF.paintWorn));
      P.push(p(UNIT.box, C.yellow, [3.6, y + 3.2, z], [1.6, 0.8, 1.9], null, SURF.paintWorn));
      const j1 = [3.6, y + 3.4, z], j2 = [1.0, y + 4.8, z - 5.5], j3 = [2.6, y + 2.4, z - 8.5];
      P.push(boxBeam(j1, j2, 0.7, 0.7, C.yellow, SURF.paintWorn));
      P.push(boxBeam(j2, j3, 0.55, 0.55, C.yellow, SURF.paintWorn));
      P.push(member([3.4, y + 2.4, z - 0.6], [2.2, y + 4.4, z - 3.2], 0.12, '#B9BDB9')); // hydraulic rams
      P.push(member([1.4, y + 4.2, z - 4.6], [1.8, y + 3.6, z - 7.0], 0.1, '#B9BDB9'));
      P.push(member(j3, [2.6, y + 1.3, z - 8.5], 0.02, '#2A2C2E'));
      P.push(p(UNIT.box, '#C8A030', [2.6, y + 1.05, z - 8.5], [0.4, 0.5, 0.3], null, SURF.paintWorn)); // hook block
      P.push(p(UNIT.box, '#2A2C2E', [2.6, y + 0.68, z - 8.5], [0.12, 0.25, 0.12], null, SURF.steel));
      P.push(member([2.6, deckAt(z - 8.5), z - 8.9], [2.6, y + 1.9, z - 8.9], 0.12, C.yellow, SURF.paintWorn)); // boom rest
      // windlass: bedplate, gypsies, band brakes, gearbox, warping heads
      const zw = -27, yw = deckAt(zw);
      P.push(p(UNIT.box, '#33383C', [0, yw + 0.15, zw], [4.4, 0.3, 1.8], null, SURF.steelWorn));
      P.push(p(UNIT.box, '#3C4A44', [0, yw + 0.75, zw + 0.2], [1.2, 1.0, 1.3], null, SURF.paintWorn));
      for (const s of SIDES) {
        P.push(p(UNIT.cyl12, '#3C4A44', [s * 1.4, yw + 0.75, zw], [0.62, 0.7, 0.62], [0, 0, Math.PI / 2], SURF.steelWorn));
        P.push(p(UNIT.cyl12, '#23272A', [s * 1.9, yw + 0.75, zw], [0.68, 0.18, 0.68], [0, 0, Math.PI / 2], SURF.steelRusty));
        P.push(p(UNIT.cyl8, '#3C4A44', [s * 2.35, yw + 0.75, zw], [0.32, 0.5, 0.32], [0, 0, Math.PI / 2], SURF.steelWorn));
        // chain: gypsy → deck hawse (spurling pipe) and gypsy → chain locker pipe
        const zh = -31.0, yh = deckAt(zh);
        const a = [s * 1.4, yw + 1.3, zw - 0.3], b = [s * 1.25, yh + 0.2, zh];
        for (let k = 0; k < 9; k++) {
          const t0 = k / 9, t1 = (k + 1) / 9;
          const pa = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
          const pb = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
          P.push(boxBeam(pa, pb, k % 2 ? 0.08 : 0.22, k % 2 ? 0.22 : 0.08, '#2B2725', SURF.steelRusty));
        }
        P.push(boxBeam([s * 1.4, yw + 0.2, zw + 0.6], [s * 1.4, yw + 0.06, zw + 1.6], 0.22, 0.08, '#2B2725', SURF.steelRusty));
        P.push(p(UNIT.cyl12, '#2A2E30', [s * 1.25, yh + 0.12, zh], [0.42, 0.25, 0.42], null, SURF.steelRusty)); // deck hawse
        P.push(p(UNIT.cyl8, '#2A2E30', [s * 1.4, yw + 0.12, zw + 1.7], [0.3, 0.2, 0.3], null, SURF.steelRusty)); // spurling pipe
        // hull hawse pipe, stockless anchor stowed in it, rust bleeding from the pipe
        const hp = hullSurface(hull, -31.6, deckAt(-31.6) - 1.6, s);
        const n = hp.n, rt = new THREE.Vector3(-n.z, 0, n.x);
        const o = [hp.x + n.x * 0.08, hp.y, hp.z + n.z * 0.08];
        P.push(member([o[0] - n.x * 0.2, o[1], o[2] - n.z * 0.2], [o[0] + n.x * 0.18, o[1], o[2] + n.z * 0.18], 0.55, '#1E2124', SURF.steelRusty, UNIT.cyl12));
        P.push(streakPart([o[0], o[1] - 0.45, o[2]], n, 3.6, 1.3, '#6E3A1E', HULL_C));
        const c0 = [o[0] + n.x * 0.32, o[1] - 1.75, o[2] + n.z * 0.32];
        P.push(boxBeam([o[0] + n.x * 0.22, o[1] + 0.1, o[2] + n.z * 0.22], c0, 0.26, 0.2, '#25282B', SURF.steelRusty));
        for (const f of [-1, 1]) {
          P.push(boxBeam(c0, [c0[0] + rt.x * f * 0.75 + n.x * 0.12, c0[1] + 0.65, c0[2] + rt.z * f * 0.75 + n.z * 0.12], 0.34, 0.16, '#25282B', SURF.steelRusty));
        }
        P.push(p(UNIT.box, '#25282B', c0, [0.5, 0.32, 0.5], null, SURF.steelRusty));
      }
      // mooring bitts on base plates, fairleads in the bulwark
      for (const zb of [-31, -22, 10]) {
        for (const s of SIDES) {
          const xb = s * (hull.halfBeamAt(zb) - 1.0);
          P.push(p(UNIT.box, '#2A2E30', [xb, deckAt(zb) + 0.06, zb + 0.4], [0.7, 0.12, 1.5], null, SURF.steelWorn));
          P.push(p(UNIT.cyl8, C.black, [xb, deckAt(zb) + 0.35, zb], [0.24, 0.7, 0.24], null, SURF.steelWorn));
          P.push(p(UNIT.cyl8, C.black, [xb, deckAt(zb) + 0.35, zb + 0.8], [0.24, 0.7, 0.24], null, SURF.steelWorn));
          if (zb < 0) P.push(p(UNIT.box, '#2A2E30', [s * (edge(zb) - 0.12), deckAt(zb) + 0.5, zb + 0.4], [0.3, 0.5, 0.9], null, SURF.steelRusty));
        }
      }
      P.push(member([0, deckAt(-33), -33], [0, deckAt(-33) + 4.2, -33], 0.08, '#B9BDB9'));
      // hatch cover (coaming, stiffened lid, hinges), deck stores, a 20' container, lamp post
      const yh = deckAt(-13);
      P.push(p(UNIT.box, '#33403A', [0.4, yh + 0.3, -13], [3.4, 0.6, 2.6], null, SURF.paintWorn));
      P.push(p(UNIT.box, '#3C4A44', [0.4, yh + 0.66, -13], [3.2, 0.12, 2.4], null, SURF.paintWorn));
      for (let k = 0; k < 4; k++) P.push(p(UNIT.box, '#3C4A44', [-0.8 + k * 0.8, yh + 0.77, -13], [0.1, 0.1, 2.3], null, SURF.paintWorn));
      for (const dz of [-0.7, 0.7]) P.push(p(UNIT.cyl8, '#2A2E30', [2.15, yh + 0.62, -13 + dz], [0.1, 0.4, 0.1], [0, 0, Math.PI / 2], SURF.steel));
      const yc = deckAt(-8);
      P.push({ geometry: containerGeo(), vcol: true, color: '#4F6372', position: [4.25, yc, -8.3], rotation: [0, Math.PI, 0], surf: SURF.paintWorn });
      for (let k = 0; k < 5; k++) P.push(p(UNIT.cyl12, k % 2 ? '#2F4A5A' : '#7A3B2A', [-1.9 + (k % 3) * 0.62, deckAt(-6.2) + 0.45, -5.7 - Math.floor(k / 3) * 0.62], [0.29, 0.9, 0.29], null, SURF.paintWorn));
      P.push(p(UNIT.box, '#6E5A3E', [-2.0, deckAt(-20) + 0.3, -20], [1.2, 0.6, 1.0], null, SURF.wood)); // pallet of stores
      P.push(p(UNIT.box, '#7A8086', [-2.0, deckAt(-20) + 0.85, -20], [1.0, 0.5, 0.9], null, SURF.paintWorn));
      P.push(member([-3.2, deckAt(-18), -18], [-3.2, deckAt(-18) + 3.0, -18], 0.07, C.steel));
      P.push(p(UNIT.box, '#2E3338', [-3.2, deckAt(-18) + 3.1, -18.1], [0.45, 0.3, 0.3], null, SURF.steel));
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

  // Foredeck plating in the decal's bottom half (32 px/m): plates and weld seams, worn walkways,
  // rust at the chain run, bitts, windlass and scuppers, faded walkway lines, a hatched windlass zone.
  _paintForedeck(g, seed) {
    const k = 32;
    const X = (z) => (z - FORE.z0) * k, Y = (x) => (x + FORE.w / 2) * k;
    const hb = (z) => this.hull.halfBeamAt(z);
    const rust = [[X(-27), Y(0), 1.8 * k, 0.45], [X(-17), Y(3.6), 1.6 * k, 0.35], [X(-13), Y(0.4), 2.0 * k, 0.25]];
    for (const s of SIDES) {
      for (let t = 0; t <= 1; t += 0.25) rust.push([X(-27 - 4 * t), Y(s * (1.4 - 0.15 * t)), 0.7 * k, 0.6]);
      for (const zb of [-31, -22]) rust.push([X(zb + 0.4), Y(s * (hb(zb) - 1)), 1.1 * k, 0.5]);
      for (let z = -6; z > -33; z -= 3.7) rust.push([X(z), Y(s * (hb(z) - 0.35)), 0.8 * k, 0.4]);
    }
    paintDeck(g, 0, 512, 1024, 512, k, {
      base: C.deck,
      plate: [6, 2.5],
      seed,
      paths: [[X(-4), Y(0), X(-27), Y(0), 2.4 * k], [X(-4.5), Y(-4.6), X(-15), Y(-3.0), 1.6 * k], [X(-4.5), Y(4.0), X(-13), Y(2.2), 1.4 * k]],
      rust,
      oil: 5,
      hatch: [[X(-28.4), Y(-2.7), 2.6 * k, 5.4 * k]],
      lines: [[X(-25.5), Y(-1.2), 21 * k, 3, 'rgba(201,162,39,0.55)'], [X(-25.5), Y(1.2) - 3, 21 * k, 3, 'rgba(201,162,39,0.55)']],
      fade: 0.15,
    });
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
        if (slam > 0.3 && this.sheetU.uT.value > 0.7) {
          this.green = 0.55 + 0.45 * slam;
          this.sheetU.uT.value = 0;
        }
      }
    }
    // green water: the sheet sweeps aft, throwing spray off the bulwarks at its front
    const su = this.sheetU;
    if (su.uT.value < 1.4) {
      su.uT.value += dt * 0.8;
      su.uK.value = this.green;
      su.uLit.value = 0.22 + 0.78 * (1 - env.night);
      this.sheet.visible = true;
      this.greenT -= dt;
      const zf = -35.4 + Math.min(1, su.uT.value) * 27;
      if (this.greenT <= 0 && su.uT.value < 0.9 && dt > 0) {
        this.greenT = 0.09;
        for (const side of SIDES) {
          _v.set(side * Math.max(0.5, this.hull.halfBeamAt(zf) - 0.2), this.hull.deckAt(zf) + 1.2, zf).applyMatrix4(m);
          _w.set(side * 0.8, 0, 1).applyQuaternion(this.group.quaternion);
          _v2.set(_w.x + env.windDir.x * 0.6, _w.z + env.windDir.y * 0.6).normalize();
          ctx.fx?.spray?.(_v.x, _v.z, _v2, 5 + 9 * this.green);
        }
      }
    } else this.sheet.visible = false;
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
    setGlow(this.material, 0, 0, this.hull.deckAt(-18) + 0.5, -18, 8, FLOOD_COL, 0.18 * W.channels[CH.FLOOD]);
    setGlow(this.material, 1, 0, 24.6, -3, 1.4, WHITE, 0.6 * W.channels[CH.NAV]);
    setGlow(this.material, 2, 0, DECK_Y + 1, DECK_Z, 12, DECK_COL, 0.07 * W.channels[CH.FLOOD]);

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
    this.sheet.geometry.dispose();
    this.sheet.material.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}

export const SHIP_DECK = { y: DECK_Y, z: DECK_Z, r: DECK_R };

// Funnel shell (unit cylinder, × part colour): soot blackens the top third and runs further down
// the aft (exhaust / downwind) side in streaks.
let _funnel = null;
function funnelGeometry() {
  if (_funnel) return _funnel;
  const g = new THREE.CylinderGeometry(1, 1.05, 1, 18, 8, false);
  shadeVerts(g, (x, y, z, c) => {
    const aft = Math.max(0, z);
    const streak = 0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 9.0);
    const soot = smoothstep(0.62 - 0.3 * aft * streak, 0.97, y + 0.5);
    c.setScalar(1 - 0.88 * soot);
  });
  return (_funnel = g);
}

// Green-water sheet (ship-local foredeck, bow z ≈ −35.4 → z −8): uT = sweep front 0..1.4, uK strength.
const SHEET_VS = /* glsl */ `
varying vec3 vL;
varying vec3 vW;
void main() {
  vL = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SHEET_FS = /* glsl */ `
uniform float uT, uK, uLit, uTime, uFogNear, uFogFar;
uniform sampler2D uAtlas;
varying vec3 vL;
varying vec3 vW;
void main() {
  float s = clamp((vL.z + 35.4) / 27.0, 0.0, 1.0);
  float b = uT - s;
  // streaky noise stretched along the deck: water running aft, not spots
  float n1 = texture2D(uAtlas, vL.xz * vec2(0.22, 0.05) - vec2(0.0, uTime * 0.45)).r;
  float n2 = texture2D(uAtlas, vL.xz * vec2(0.6, 0.14) - vec2(uTime * 0.05, uTime * 0.9)).g;
  float body = smoothstep(-0.04, 0.03, b + (n1 - 0.5) * 0.08) * exp(-max(b, 0.0) * 2.4);
  float crest = exp(-pow((b + (n2 - 0.5) * 0.05) / 0.05, 2.0));
  float foam = smoothstep(0.45, 0.8, n1 * 0.65 + n2 * 0.5);
  float a = uK * clamp(body * (0.3 + 0.55 * foam) + crest * (0.65 + 0.35 * n2), 0.0, 0.9);
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  a *= 1.0 - smoothstep(uFogNear, uFogFar, length(vW.xz - cameraPosition.xz - focus));
  vec3 col = mix(vec3(0.09, 0.17, 0.15), vec3(0.78, 0.83, 0.81), clamp(foam * 0.75 + crest, 0.0, 1.0)) * uLit;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
