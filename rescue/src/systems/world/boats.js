// Scenery vessels from def.world.props.boats (DESIGN §1, §3.14): the coast-guard cutter
// «Сторож-7» (patrols slowly, blue flasher, turning radar), the trawler «Кильдин» aground on the
// Кошки rocks (15° list, heavy rust, surf breaking on its weather side) and the cargo ship
// «Полярный ветер» with gaps in its container stacks. Realism pass: weathered hulls (plating, rust
// runs, grimy boot-top — vessel.js weatherHull), per-part wear on the shared prop material. They bob like the Арктур (three ocean samples), wear foam
// collars, carry navigation lights and their superstructures are obstacles.
import * as THREE from 'three';
import { bake, p, member, beam as boxBeam, hullGeometry, deckGeometry, windowParts, latticeParts, railParts, shadeVerts, rng, UNIT, SURF, worn } from './geo.js';
import { CH } from './materials.js';
import { VesselMotion, Navigator, weatherHull, streakPart, containerGeo, lifeboatGeo, framed, bridgeGlass } from './vessel.js';
import { clamp, smoothstep } from '../../core/math.js';

const SIDES = [-1, 1]; // reused in per-frame loops (no array literal per frame)
const DEG = Math.PI / 180;
const ST_SURF = { radius: 7, strength: 0.6 };
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s2 = new THREE.Vector2();
const RADAR_COL = new THREE.Color('#2A2E33');

// Shared bits: a bulwark (plates + capping) along the hull edge between z0 and z1 (z1 < z0, forward).
function bulwark(P, hull, z0, z1, h, color, cap, surf, step = 1.5) {
  const edge = (z) => Math.max(0.12, hull.halfBeamAt(z) - 0.08);
  for (const side of SIDES) {
    for (let z = z0; z > z1; z -= step) {
      const z2 = Math.max(z - step, z1);
      const a = [side * edge(z), hull.deckAt(z), z], b = [side * edge(z2), hull.deckAt(z2), z2];
      P.push(boxBeam([a[0], a[1] + h / 2, a[2]], [b[0], b[1] + h / 2, b[2]], 0.08, h, color, surf));
      if (cap) P.push(member([a[0], a[1] + h + 0.02, a[2]], [b[0], b[1] + h + 0.02, b[2]], 0.06, cap, surf));
    }
  }
}
function bitts(P, hull, z, inset, color, surf) {
  for (const s of SIDES) {
    const x = s * (hull.halfBeamAt(z) - inset), y = hull.deckAt(z);
    for (const dz of [0, 0.6]) P.push(p(UNIT.cyl8, color, [x, y + 0.28, z + dz], [0.18, 0.56, 0.18], null, surf));
  }
}

// Coast-guard cutter «Сторож-7»: gun-grey hull with the slanted service stripe, bulwarked
// foredeck with bitts and a small gun mount, deckhouse with framed ports, raked wheelhouse with
// dark wrap glass, mast with radar platform and lights, fendered RIB on chocks aft with its davit.
function patrolParts() {
  const L = 34, B = 7, ST = 14;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 2.6, deckFwd: 3.6, keel: 2.2, bowStart: 0.55, rake: 3, stations: ST, topside: '#4C555D', antifoul: '#5B2622', boot: '#E6E6E0', stripe: '#24577E', stripeAt: 0.7 });
  weatherHull(hull, { L, seam: L / ST, seed: 3, rustK: 0.3, scupper: 5, boot: 0.35, bow: 0.3, lift: 0.3 });
  const W1 = worn(SURF.paint, 'light'), WS = worn(SURF.steel, 'light');
  const P = [{ geometry: hull.geometry, vcol: true, surf: W1 }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 0.6, 0.2, 14), color: '#565C61', surf: worn([0.72, 0, 0, 0], 'light') });
  bulwark(P, hull, -5, -L / 2 + 0.4, 0.8, '#4C555D', '#D8D8D2', W1, 1.4);
  // deckhouse (main deck) + wheelhouse with raked glass, visor roof, mast
  const yd = hull.deckAt(-2);
  P.push(p(UNIT.box, '#E2E2DC', [0, (yd + 5.6) / 2, -1.5], [5.4, 5.6 - yd, 9], null, W1));
  P.push(...framed(windowParts([0, 4.4, -1.5], [5.4, 2.6, 9], 'x+', { cols: 5, w: 0.55, h: 0.55, ch: CH.WINDOWS, color: '#FFC98A' }), '#9A9E9E', 0.12));
  P.push(...framed(windowParts([0, 4.4, -1.5], [5.4, 2.6, 9], 'x-', { cols: 5, w: 0.55, h: 0.55, ch: CH.WINDOWS, color: '#FFC98A' }), '#9A9E9E', 0.12));
  for (const s of SIDES) P.push(p(UNIT.box, '#4A5056', [s * 2.72, yd + 1.0, 1.8], [0.08, 1.85, 0.8], null, worn(SURF.paint, 'medium')));
  P.push(p(UNIT.box, '#E2E2DC', [0, 6.6, -4.1], [4.8, 2.0, 4.2], null, W1));
  bridgeGlass(P, -2.2, 2.2, 6.0, 7.2, -6.2, { n: 4, rake: 0.3 });
  for (const s of SIDES) {
    P.push(p(UNIT.box, '#1A2630', [s * 2.43, 6.7, -4.3], [0.06, 0.95, 2.6], null, SURF.glass));
    P.push(p(UNIT.box, '#E2E2DC', [s * 2.45, 6.3, -5.85], [0.6, 1.5, 0.6], [0, s * 0.7, 0], W1));
  }
  P.push(p(UNIT.box, '#C9CCC8', [0, 7.68, -4.3], [5.2, 0.16, 4.9], null, W1)); // visor roof
  P.push(p(UNIT.box, '#24577E', [0, 7.5, -4.1], [4.86, 0.14, 4.26], null, W1)); // service band
  P.push(member([0, 7.7, -3.6], [0, 13, -3.6], 0.12, '#B9BDB9', WS));
  for (const s of SIDES) P.push(member([s * 1.6, 7.7, -2.4], [0, 10.6, -3.6], 0.06, '#B9BDB9', WS));
  P.push(p(UNIT.box, '#9AA1A6', [0, 10.4, -3.6], [1.6, 0.1, 1.2], null, WS));
  P.push(p(UNIT.cyl8, '#2E3338', [0, 10.6, -3.6], [0.3, 0.35, 0.3], null, WS));
  P.push(member([-1.4, 11.5, -3.6], [1.4, 11.5, -3.6], 0.06, '#B9BDB9', WS));
  for (const s of SIDES) P.push(member([s * 1.3, 11.5, -3.6], [s * 1.3, 12.8, -3.6], 0.025, '#2E3338'));
  for (const s of SIDES) P.push(p(UNIT.cyl8, '#2E3338', [s * 1.6, 6.4, 3.0], [0.22, 1.6, 0.22], null, worn(SURF.steel, 'medium'))); // exhausts
  // foredeck: gun mount, bitts, capstan, rails aft
  const zg = -10.5, yg = hull.deckAt(zg);
  P.push(p(UNIT.cyl12, '#5C646A', [0, yg + 0.3, zg], [0.8, 0.6, 0.8], null, WS));
  P.push(p(UNIT.box, '#5C646A', [0, yg + 0.95, zg + 0.1], [1.0, 0.7, 1.2], null, WS));
  P.push(member([0, yg + 1.05, zg - 0.4], [0, yg + 1.2, zg - 2.6], 0.06, '#3A3F44', WS));
  bitts(P, hull, -13.5, 0.7, '#2A2E30', WS);
  bitts(P, hull, 12.5, 0.7, '#2A2E30', WS);
  P.push(p(UNIT.cyl12, '#2A2E30', [0, hull.deckAt(-14.5) + 0.3, -14.5], [0.35, 0.6, 0.35], null, WS));
  P.push(...railParts([[-3.2, 4], [-3.2, 16.4], [3.2, 16.4], [3.2, 4]], hull.deckAt(10), 0.95, '#D8D8D2', { post: 1.6, r: 0.035 }));
  // fendered RIB on chocks + davit
  const yr = hull.deckAt(10) + 0.85;
  for (const s of SIDES) P.push(p(UNIT.cyl8, '#C8561E', [s * 0.8, yr, 10], [0.33, 4.4, 0.33], [Math.PI / 2, 0, 0], SURF.rubber));
  P.push(p(UNIT.sphereLo, '#C8561E', [0, yr, 7.8], [1.1, 0.33, 0.7], null, SURF.rubber));
  P.push(p(UNIT.box, '#2A2E33', [0, yr - 0.15, 10.2], [1.3, 0.35, 4.2], null, SURF.rubber));
  P.push(p(UNIT.box, '#D8D8D2', [0, yr + 0.35, 10.4], [0.5, 0.5, 0.5], null, W1));
  P.push(p(UNIT.box, '#1A1C1E', [0, yr + 0.2, 12.3], [0.35, 0.7, 0.3], null, WS));
  for (const dz of [-1.2, 1.2]) P.push(p(UNIT.box, '#3A3F44', [0, yr - 0.55, 10 + dz], [1.9, 0.35, 0.3], null, WS));
  P.push(member([1.9, hull.deckAt(9), 8.6], [1.4, yr + 2.6, 9.6], 0.1, '#D8D8D2', W1));
  P.push(member([1.4, yr + 2.6, 9.6], [0.2, yr + 2.4, 10], 0.07, '#D8D8D2', W1));
  P.push(member([0.2, yr + 2.4, 10], [0, yr + 0.5, 10], 0.015, '#2A2C2E'));
  for (const s of SIDES) P.push(p(UNIT.cyl8, '#ECEBE6', [s * 2.1, 5.85, 1.2], [0.28, 0.9, 0.28], [Math.PI / 2, 0, 0], SURF.gloss)); // raft canisters
  // aft deck: low store house, towing bitt, deck hatches, non-slip walkways, fenders, life rings
  const ya = hull.deckAt(5);
  P.push(p(UNIT.box, '#D8D8D2', [0, ya + 0.8, 4.6], [4.2, 1.6, 2.4], null, W1));
  P.push(p(UNIT.box, '#4A5056', [0, ya + 0.75, 5.82], [0.8, 1.4, 0.06], null, worn(SURF.paint, 'medium')));
  P.push(p(UNIT.cyl12, '#2A2E30', [0, hull.deckAt(15.6) + 0.4, 15.6], [0.42, 0.8, 0.42], null, WS));
  P.push(p(UNIT.box, '#2A2E30', [0, hull.deckAt(15.6) + 0.7, 15.6], [1.4, 0.18, 0.22], null, WS));
  for (const z of [6.8, 14.2]) P.push(p(UNIT.box, '#4E555A', [0, hull.deckAt(z) + 0.08, z], [1.3, 0.16, 1.0], null, WS));
  for (const s of SIDES) {
    P.push(p(UNIT.box, '#45494C', [s * 2.3, hull.deckAt(9) + 0.012, 10], [0.7, 0.02, 11.5], null, worn([0.9, 0, 0, 0], 'medium')));
    for (const z of [-8, -1, 6, 12]) {
      const x = s * (hull.halfBeamAt(z) + 0.12);
      P.push(p(UNIT.cyl8, '#1C1E20', [x, hull.deckAt(z) - 0.9, z], [0.3, 0.75, 0.3], [0, 0, Math.PI / 2], SURF.rubber));
      P.push(member([x, hull.deckAt(z) - 0.6, z], [x - s * 0.15, hull.deckAt(z) + 0.85, z], 0.015, '#2A2C2E'));
    }
    P.push(p(UNIT.torus, '#D8561E', [s * 3.15, hull.deckAt(14) + 0.7, 14], [0.32, 0.32, 0.32], [0, Math.PI / 2, 0], SURF.rubber));
  }
  return { parts: P, L, B, lights: [[0, 13.2, -3.6, '#FFFFFF', CH.NAV], [-2.6, 7.2, -5.5, '#FF2015', CH.NAV], [2.6, 7.2, -5.5, '#12FF6E', CH.NAV], [0, 12.2, -3.6, '#4FA3FF', CH.BLUE], [0, 3.6, L / 2, '#FFFFFF', CH.NAV]], obstacle: [0, -3, 5, 13.5], radar: [0, 10.75, -3.6, 1.7] };
}

// Trawler «Кильдин», old and aground: rust-red hull streaked with rust, stern gantry with blocks,
// net drum with the dark net mass trailing to the stern, trawl boards on the gallows, warp winches,
// fish-hold hatches, a foremast with derrick and stays, rusted white wheelhouse with raked glass.
function trawlerParts() {
  const L = 44, B = 10, ST = 18;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 3.4, deckFwd: 5.2, keel: 3.0, bowStart: 0.6, rake: 4, stations: ST, topside: '#6B3A2A', antifoul: '#1E2226', boot: '#D6D2C6', stripe: null });
  weatherHull(hull, { L, seam: L / ST, seed: 17, rust: '#8A4A22', rustK: 1.0, scupper: 3.2, boot: 0.9, bow: 0.9, lift: 0.3, plateVar: 0.09,
    runs: [[-17.5, 0, 4.4, 4.0, 0.6, 0.9], [-6, 1, 3.7, 3.4, 0.9, 0.7], [7, -1, 3.5, 3.4, 1.1, 0.8], [15, 1, 3.4, 3.2, 0.7, 0.8]] });
  const H = worn(SURF.paint, 'heavy'), HS = SURF.steelRusty, RU = SURF.rust;
  const P = [{ geometry: hull.geometry, vcol: true, surf: H }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 0.6, 0.25, 16), color: '#4E4640', surf: worn([0.85, 0, 0, 0], 'heavy') });
  bulwark(P, hull, L / 2 - 1, -L / 2 + 0.6, 1.0, '#6B3A2A', '#7A4A36', H);
  // deckhouse + wheelhouse (rust-streaked white), raked glass, mast, radar
  P.push(p(UNIT.box, '#D6D2C6', [0, 6.0, -9], [7, 3.2, 8], null, H));
  P.push(...framed(windowParts([0, 6.0, -9], [7, 3.2, 8], 'x+', { cols: 4, w: 0.6, h: 0.6, ch: CH.BOAT, color: '#FFE2B0', gain: 0.5 }), '#8A7A6A', 0.12));
  P.push(...framed(windowParts([0, 6.0, -9], [7, 3.2, 8], 'x-', { cols: 4, w: 0.6, h: 0.6, ch: CH.BOAT, color: '#FFE2B0', gain: 0.5 }), '#8A7A6A', 0.12));
  P.push(p(UNIT.box, '#D6D2C6', [0, 8.6, -10], [5.6, 2.0, 4.4], null, H));
  bridgeGlass(P, -2.5, 2.5, 8.1, 9.3, -12.2, { n: 5, rake: 0.25 });
  for (const s of SIDES) P.push(p(UNIT.box, '#1A2630', [s * 2.83, 8.8, -10.3], [0.06, 0.9, 2.4], null, SURF.glass));
  P.push(p(UNIT.box, '#B8B2A6', [0, 9.68, -10], [6.0, 0.16, 4.9], null, H));
  P.push(member([0, 9.8, -10], [0, 16, -10], 0.14, '#B9B0A0', HS));
  P.push(member([-1.6, 13.5, -10], [1.6, 13.5, -10], 0.07, '#B9B0A0', HS));
  P.push(p(UNIT.box, '#2E3338', [0, 10.1, -10.2], [1.8, 0.12, 0.25], null, HS)); // radar scanner (stopped)
  P.push(p(UNIT.cyl8, '#3A302A', [1.6, 8.4, -6.2], [0.28, 2.6, 0.28], null, RU)); // exhaust
  P.push(p(UNIT.cyl8, '#0E0E0E', [1.6, 9.72, -6.2], [0.24, 0.06, 0.24], null, RU));
  // foremast with crosstree, derrick boom, stays and shrouds
  const zm = -15.5, ym = hull.deckAt(zm);
  P.push(member([0, ym, zm], [0, ym + 10, zm], 0.16, '#C2B8A6', HS));
  P.push(member([-1.4, ym + 8, zm], [1.4, ym + 8, zm], 0.06, '#C2B8A6', HS));
  P.push(member([0, ym + 0.8, zm + 0.3], [0, ym + 3.4, zm + 6.8], 0.11, '#C2B8A6', HS)); // derrick
  P.push(member([0, ym + 9.6, zm], [0, ym + 3.4, zm + 6.8], 0.02, '#2A2624')); // topping lift
  P.push(member([0, ym + 3.4, zm + 6.8], [0, ym + 1.1, zm + 6.8], 0.02, '#2A2624'));
  P.push(member([0, ym + 9.8, zm], [0, hull.deckAt(-21.5) + 1, -21.5], 0.02, '#2A2624')); // forestay
  P.push(member([0, ym + 9.8, zm], [0, 9.8, -11.8], 0.02, '#2A2624')); // triatic stay to the wheelhouse
  P.push(member([0, 16, -10], [0, 9.8, -7.4], 0.02, '#2A2624'));
  for (const s of SIDES) P.push(member([0, ym + 8, zm], [s * (hull.halfBeamAt(zm) - 0.1), ym + 1.0, zm + 0.6], 0.02, '#2A2624')); // shrouds
  // fish-hold hatches, warp winches with wire, gallows + trawl boards, net drum, stern gantry
  for (const [z, w] of [[-3.5, 2.6], [1.2, 2.2]]) {
    const y = hull.deckAt(z);
    P.push(p(UNIT.box, '#4A3A30', [0, y + 0.35, z], [w + 0.3, 0.7, w + 0.3], null, HS));
    P.push(p(UNIT.box, '#5A3A2E', [0, y + 0.74, z], [w, 0.1, w], null, H));
  }
  const yw = hull.deckAt(5.5);
  for (const s of SIDES) {
    P.push(p(UNIT.cyl12, '#3A4038', [s * 1.6, yw + 0.9, 5.5], [0.75, 1.4, 0.75], [0, 0, Math.PI / 2], HS));
    P.push(p(UNIT.cyl12, '#1E1C1A', [s * 1.6, yw + 0.9, 5.5], [0.82, 1.0, 0.82], [0, 0, Math.PI / 2], RU)); // wire on the drum
    P.push(member([s * 1.6, yw + 1.6, 5.5], [s * 4.5, 6.0, 15.2], 0.025, '#1E1C1A')); // warp to the gallows block
    P.push(member([s * 4.7, hull.deckAt(15), 15], [s * 4.9, 7.0, 15], 0.16, '#7A4A36', HS)); // gallows
    P.push(member([s * 4.9, 7.0, 15], [s * 5.4, 6.4, 15], 0.12, '#7A4A36', HS));
    P.push(p(UNIT.box, '#26221F', [s * 5.6, 4.4, 15.3], [0.25, 2.2, 2.9], [0, 0, s * 0.12], RU)); // trawl board
    P.push(p(UNIT.box, '#3A302A', [s * 5.62, 4.4, 15.3], [0.3, 0.2, 2.95], [0, 0, s * 0.12], RU));
    P.push(member([s * 5.4, 6.4, 15], [s * 5.6, 5.5, 15.3], 0.02, '#1E1C1A'));
  }
  const yn = hull.deckAt(12);
  P.push(p(UNIT.cyl20, '#3C3A36', [0, yn + 1.7, 12], [1.1, 5.6, 1.1], [0, 0, Math.PI / 2], HS));
  P.push(p(UNIT.cyl20, '#1C2420', [0, yn + 1.7, 12], [1.55, 5.0, 1.55], [0, 0, Math.PI / 2], SURF.fabric)); // wound net
  for (let k = 0; k < 5; k++) P.push(p(UNIT.sphereLo, k % 2 ? '#22302A' : '#1A221E', [-1.8 + k * 0.9, yn + 1.7 + 0.4 * Math.sin(k * 2.1), 12 + 0.9 * Math.cos(k * 1.7)], [0.7, 0.6, 0.6], null, SURF.fabric));
  for (const s of SIDES) {
    P.push(p(UNIT.cyl20, '#4A3A30', [s * 2.75, yn + 1.7, 12], [1.8, 0.12, 1.8], [0, 0, Math.PI / 2], HS)); // flanges
    P.push(p(UNIT.box, '#4A3A30', [s * 2.8, yn + 0.85, 12], [0.3, 1.7, 1.2], null, HS));
  }
  P.push(p(UNIT.box, '#1E2620', [0, yn + 0.9, 16.5], [3.2, 0.8, 5.5], [-0.25, 0, 0], SURF.fabric)); // net trailing to the stern
  P.push(p(UNIT.sphereLo, '#1A221E', [0.6, yn + 0.4, 19.2], [1.6, 0.5, 1.4], null, SURF.fabric));
  for (const s of SIDES) {
    P.push(boxBeam([s * 4.0, hull.deckAt(19), 19], [s * 1.7, 11, 19.6], 0.4, 0.4, '#B5562A', HS));
    P.push(boxBeam([s * 3.6, hull.deckAt(17), 17], [s * 1.9, 9.5, 19.4], 0.2, 0.2, '#B5562A', HS));
  }
  P.push(boxBeam([-1.9, 11, 19.6], [1.9, 11, 19.6], 0.45, 0.45, '#B5562A', HS));
  for (const s of SIDES) {
    P.push(p(UNIT.box, '#2A2624', [s * 1.0, 10.4, 19.6], [0.4, 0.7, 0.3], null, RU)); // blocks
    P.push(member([s * 1.0, 10.1, 19.6], [s * 0.6, 4.6, 19.0], 0.02, '#1E1C1A'));
  }
  P.push(boxBeam([0, hull.deckAt(L / 2 - 1) - 0.6, L / 2 - 2.5], [0, hull.deckAt(L / 2 - 1) - 2.2, L / 2 + 0.2], 3.0, 0.1, '#3A302A', RU)); // stern ramp
  bitts(P, hull, -19, 0.8, '#2A2624', HS);
  P.push(streakPart([3.55, 7.2, -9], new THREE.Vector3(1, 0, 0), 2.6, 0.9, '#7A4A2A', '#D6D2C6'));
  P.push(streakPart([-3.55, 7.0, -7.4], new THREE.Vector3(-1, 0, 0), 2.4, 0.8, '#7A4A2A', '#D6D2C6'));
  P.push(streakPart([1.0, 8.8, -12.25], new THREE.Vector3(0, 0, -1), 1.6, 0.6, '#7A4A2A', '#D6D2C6'));
  return { parts: P, L, B, lights: [[0, 16.2, -10, '#FFFFFF', CH.BOAT], [0, 7.8, 4, '#FFE2B0', CH.BOAT], [-3.6, 9, -8, '#FF2015', CH.BOAT], [3.6, 9, -8, '#12FF6E', CH.BOAT]], obstacle: [0, -9, 6.5, 16.5] };
}

// Cargo ship «Полярный ветер»: corrugated 20' boxes (door ends, faded paint, ±10 % per-box value)
// on hatch covers between lashing bridges, a gap where a stack went overboard, stowed deck cranes
// on rests, a breakwater and windlass forward, white aft block with window bands and bridge wings,
// sooty funnel, free-fall lifeboat on its stern skid. Hull: plating, rust runs, grimy boot-top.
function cargoParts(seed) {
  const L = 140, B = 21, ST = 56;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 9, deckFwd: 11.5, keel: 6, bowStart: 0.72, rake: 9, stations: ST, transom: 0.9, topside: '#26343F', antifoul: '#5B2622', boot: '#D6D4CC', stripe: null });
  weatherHull(hull, { L, seam: L / ST, seed: seed + 1, rustK: 0.75, scupper: 7, boot: 0.6, bow: 0.6, lift: 0.3,
    runs: [[-64.5, 0, 8.6, 6.5, 0.9, 0.9], [-50, 0, 8.8, 5, 0.8, 0.5], [40, 1, 7.6, 6, 1.0, 0.6], [55, -1, 7.8, 5.5, 0.8, 0.6]] });
  const M = worn(SURF.paint, 'medium'), MS = SURF.steelWorn, LT = worn(SURF.paint, 'light');
  const P = [{ geometry: hull.geometry, vcol: true, surf: M }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 1, 0.3, 30), color: '#4E3A32', surf: worn([0.85, 0, 0, 0], 'medium') });
  bulwark(P, hull, -52, -L / 2 + 1, 1.2, '#26343F', '#B9B6AE', M, 2.4);
  bulwark(P, hull, L / 2 - 1, 44, 1.0, '#26343F', '#B9B6AE', M, 2.4);
  // aft block: 5 decks with window bands, bridge with raked glass and wings, funnel with soot
  P.push(p(UNIT.box, '#E2E0D8', [0, 16, 52], [17, 14, 11], null, LT));
  for (const y of [11, 13.8, 16.6, 19.4]) {
    P.push(...framed(windowParts([0, 16, 52], [17, 14, 11], 'z-', { cols: 8, w: 1.2, h: 0.85, ch: CH.WINDOWS, color: '#FFC98A', y0: y }), '#8E9294', 0.14));
    for (const f of ['x+', 'x-']) P.push(...framed(windowParts([0, 16, 52], [17, 14, 11], f, { cols: 5, w: 1.0, h: 0.85, ch: CH.WINDOWS, color: '#FFC98A', y0: y }), '#8E9294', 0.14));
    P.push(p(UNIT.box, '#C9C8C0', [0, y + 1.35, 52], [17.4, 0.14, 11.4], null, LT)); // deck cornices
  }
  P.push(p(UNIT.box, '#E2E0D8', [0, 24, 50.5], [16, 2.6, 6], null, LT));
  bridgeGlass(P, -7.4, 7.4, 23.4, 24.9, 47.5, { n: 10 });
  for (const s of SIDES) {
    P.push(p(UNIT.box, '#E2E0D8', [s * 9.8, 23.0, 49.5], [3.6, 0.25, 3.0], null, LT)); // wing deck
    P.push(p(UNIT.box, '#E2E0D8', [s * 9.8, 23.7, 48.05], [3.6, 1.2, 0.12], null, LT));
    P.push(p(UNIT.box, '#E2E0D8', [s * 11.55, 23.7, 49.5], [0.12, 1.2, 3.0], null, LT));
    P.push(member([s * 8.2, 22.8, 48.3], [s * 11.4, 20.6, 48.3], 0.12, '#E2E0D8', LT));
    for (let k = 0; k < 2; k++) P.push(p(UNIT.box, '#1A2630', [s * 8.03, 24.15, 49.3 + k * 1.8], [0.06, 1.2, 1.5], null, SURF.glass));
  }
  P.push(p(UNIT.box, '#B8B8B0', [0, 25.45, 50.2], [16.6, 0.3, 7.0], null, LT)); // bridge roof
  P.push(member([0, 25.5, 49], [0, 36, 49], 0.25, '#B9BDB9', MS));
  P.push(member([-2.6, 31.5, 49], [2.6, 31.5, 49], 0.1, '#B9BDB9', MS));
  P.push(p(UNIT.box, '#2E3338', [0, 29.8, 49.6], [3.2, 0.14, 0.3], null, MS)); // radar scanner
  P.push({ geometry: funnelGeo(), vcol: true, color: '#2E3338', position: [0, 27.5, 59.5], scale: [2.8, 8, 3.4], rotation: [0.06, 0, 0], surf: LT });
  P.push(p(UNIT.cyl12, '#9E3A2E', [0, 28.6, 59.45], [2.86, 1.2, 3.46], [0.06, 0, 0], LT));
  for (const x of [-0.8, 0.8]) P.push(p(UNIT.cyl12, '#1A1A1A', [x, 32.3, 59.9], [0.4, 1.6, 0.4], null, SURF.steelRusty));
  // hatch covers, container stacks (gap mid-ships), lashing bridges
  const r = rng(seed);
  const cols = ['#B3412E', '#1F5E8C', '#2F7D4F', '#C9A227', '#6E7378', '#8C3B2E', '#D2D0C8', '#3E4A52'].map((h) => {
    const c = new THREE.Color(h);
    const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
    return c.lerp(new THREE.Color(l, l, l), 0.25);
  });
  const box = containerGeo(true);
  const MC = worn(SURF.paint, 'medium', 0.66);
  for (let bay = 0; bay < 8; bay++) {
    const zc = -55 + bay * 12.9;
    const zf = zc - 6.3;
    const hb = Math.min(hull.halfBeamAt(zf), hull.halfBeamAt(zc + 6.3));
    const yb = hull.deckAt(zc) + 1.7;
    const rows = [];
    for (let row = -3; row <= 3; row++) if (Math.abs(row) * 2.5 + 1.3 < hb - 0.6) rows.push(row);
    if (!rows.length) continue;
    const span = (rows[rows.length - 1] - rows[0]) * 2.5 + 2.6;
    P.push(p(UNIT.box, '#4E3A32', [0, yb - 0.5, zc], [span + 0.6, 1.0, 12.6], null, MS)); // hatch cover
    for (const row of rows) {
      const lost = bay > 2 && bay < 6 && Math.abs(row) < 3 && r() < 0.45;
      const tiers = lost ? Math.floor(r() * 2) : 2 + Math.floor(r() * 3);
      for (const half of [-1, 1]) {
        for (let t = 0; t < tiers; t++) {
          const c = cols[Math.floor(r() * cols.length)].clone().multiplyScalar(0.9 + 0.2 * r());
          const tilt = (r() - 0.5) * (lost ? 0.1 : 0.008);
          P.push({ geometry: box, vcol: true, color: c, position: [row * 2.5, yb + t * 2.6, zc + half * 3.08], rotation: [0, half > 0 ? 0 : Math.PI, tilt], surf: MC });
        }
        if (tiers > 0 && half > 0) {
          for (const s of [-1, 1]) P.push(member([row * 2.5 + s * 1.1, yb + 0.05, zc + 6.25], [row * 2.5 - s * 1.0, yb + Math.min(tiers, 2) * 2.55, zc + 6.2], 0.03, '#5A5E60', MS)); // lashing bars
        }
      }
    }
    // lashing bridge in the gap ahead of the bay
    if (bay > 0) {
      const zl = zf - 0.3;
      for (const y of [2.7, 5.3]) P.push(boxBeam([-span / 2 - 0.4, yb + y, zl], [span / 2 + 0.4, yb + y, zl], 0.6, 0.12, '#C9A227', MS));
      for (let x = -span / 2; x <= span / 2 + 0.1; x += span / 3) P.push(member([x, yb - 1, zl], [x, yb + 6.4, zl], 0.1, '#C9A227', MS));
    }
  }
  // deck cranes (pedestal, cab, boom stowed on a rest), breakwater, windlass, foremast
  for (const z of [-30, 10]) {
    const y = hull.deckAt(z);
    P.push(p(UNIT.cyl12, '#B49440', [-8.5, y + 4.5, z + 6.4], [1.3, 9, 1.3], null, M));
    P.push(p(UNIT.box, '#B49440', [-8.5, y + 10.2, z + 6.4], [3.2, 2.4, 3.6], null, M));
    P.push(p(UNIT.box, '#1A2630', [-6.86, y + 10.5, z + 6.4], [0.06, 1.0, 2.2], null, SURF.glass));
    P.push(...latticeParts([-8.5, y + 11, z + 4.8], [-8.0, y + 9.4, z - 12.5], 0.7, 0.3, '#B49440', { bays: 7, r: 0.12, brace: 0.05 }));
    P.push(member([-8.0, y, z - 12.5], [-8.0, y + 8.9, z - 12.5], 0.2, '#B49440', M)); // boom rest
  }
  const zb = -62, yb2 = hull.deckAt(zb);
  for (const s of SIDES) P.push(boxBeam([0, yb2 + 1.0, zb - 2.6], [s * (hull.halfBeamAt(zb) - 0.4), yb2 + 1.0, zb + 0.6], 0.15, 2.0, '#26343F', M)); // breakwater
  for (const s of SIDES) {
    P.push(p(UNIT.cyl12, '#3C4A44', [s * 1.6, hull.deckAt(-65) + 0.8, -65], [0.7, 0.8, 0.7], [0, 0, Math.PI / 2], MS));
    P.push(boxBeam([s * 1.6, hull.deckAt(-65) + 1.4, -65.4], [s * 1.5, hull.deckAt(-67.5) + 0.1, -67.5], 0.25, 0.1, '#2B2725', SURF.steelRusty));
  }
  P.push(member([0, hull.deckAt(-66), -66], [0, 18, -66], 0.18, '#B9BDB9', MS));
  bitts(P, hull, -58, 1.4, '#2A2624', MS);
  bitts(P, hull, 64, 1.4, '#2A2624', MS);
  // free-fall lifeboat on its stern skid
  P.push({ geometry: lifeboatGeo(true), vcol: true, color: '#FFFFFF', position: [0, 17.3, 66.3], rotation: [0.61, Math.PI, 0], surf: worn(SURF.gloss, 'light') });
  for (const s of SIDES) P.push(boxBeam([s * 0.8, 18.8, 62.4], [s * 0.8, 13.6, 69.2], 0.2, 0.3, '#7E868C', MS));
  for (const s of SIDES) P.push(member([s * 0.8, hull.deckAt(63), 63], [s * 0.8, 18.3, 63], 0.14, '#7E868C', MS));
  return { parts: P, L, B, lights: [[0, 36.2, 49, '#FFFFFF', CH.BOAT], [0, 18, -66, '#FFFFFF', CH.BOAT], [-11.6, 24.5, 48, '#FF2015', CH.BOAT], [11.6, 24.5, 48, '#12FF6E', CH.BOAT], [0, 22, 30, '#FFE2B0', CH.FLOOD], [0, 22, -10, '#FFE2B0', CH.FLOOD]], obstacle: [0, 52, 12, 37] };
}

// Funnel shell with a soot-black top third (vertex colours × part colour).
let _funnel = null;
function funnelGeo() {
  if (_funnel) return _funnel;
  _funnel = shadeVerts(new THREE.CylinderGeometry(1, 1.05, 1, 16, 6), (x, y, z, c) => c.setScalar(1 - 0.85 * smoothstep(0.6 - 0.25 * Math.max(0, z), 0.97, y + 0.5)));
  return _funnel;
}

const KINDS = { patrol: patrolParts, trawler: trawlerParts, cargo: cargoParts };

export class Boat {
  constructor(Wd, def, index) {
    this.W = Wd;
    const kind = KINDS[def.kind] ? def.kind : 'patrol';
    this.kind = kind;
    this.name = def.name || '';
    const spec = KINDS[kind](101 + index * 7);
    this.L = spec.L;
    this.B = spec.B;
    this.group = new THREE.Group();
    this.group.name = `boat-${kind}`;
    Wd.root.add(this.group);
    this.mesh = new THREE.Mesh(bake(Wd.look, spec.parts), Wd.mats.plain);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    for (const [x, y, z, col, ch] of spec.lights) Wd.lamps.add(x, y, z, col, { gain: 4, bulb: 0.2, halo: kind === 'cargo' ? 3 : 2, ch, parent: this.group, pen: 0.3 });

    this.radar = spec.radar || null;
    this.radarA = index * 2.3;
    this.aground = !!def.aground;
    this.nav = new Navigator();
    const h = Number.isFinite(def.heading) ? def.heading : 0;
    if (kind === 'patrol') {
      // slow patrol circle around the spawn point
      const route = [];
      for (let i = 0; i < 8; i++) {
        const a = h + (i / 8) * Math.PI * 2;
        route.push([def.x + Math.sin(a) * 160, def.z - Math.cos(a) * 160]);
      }
      this.nav.setup({ x: def.x, z: def.z, heading: h, route, speed: 3 });
      this.nav.speedT = this.nav.speed = 2.2;
    } else if (kind === 'cargo') {
      this.nav.setup({ x: def.x, z: def.z, heading: h, drift: { x: Math.sin(h) * 0.4, z: -Math.cos(h) * 0.4 } });
      this.nav.speedT = this.nav.speed = 0.6;
    } else {
      this.nav.setup({ x: def.x, z: def.z, heading: h, drift: { x: 0, z: 0 } });
      this.nav.station = false;
      this.nav.speedT = this.nav.speed = 0;
    }
    this.motion = new VesselMotion({ length: this.L, beam: this.B, rollGain: kind === 'cargo' ? 0.8 : 1.7 });
    this.motion.reset();
    const [ox, oz, orad, otop] = spec.obstacle;
    this.obsLocal = [ox, oz];
    this.obstacles = [{ x: def.x, z: def.z, radius: orad, top: otop, kind: 'ship', name: this.name || 'судно' }];
    this.flick = 1;
    this._place(0, true);
  }

  _place(dt, settle = false) {
    const nav = this.nav;
    if (this.aground) {
      // listing on the rocks, bow lifted, barely moving
      this.motion.step(dt, nav.x, nav.z, nav.heading, null, 0, settle);
      this.group.position.set(nav.x, 1.0, nav.z);
      this.group.rotation.set(3.5 * DEG + 0.4 * DEG * Math.sin(this.W.env.t * 0.4), -nav.heading, -15 * DEG + 0.5 * DEG * Math.sin(this.W.env.t * 0.31), 'YXZ');
    } else {
      this.motion.step(dt, nav.x, nav.z, nav.heading, this.W.ctx.ocean, this.W.env.Hs, settle);
      this.motion.apply(this.group, nav.x, nav.z, nav.heading, 0);
    }
    this.group.updateMatrixWorld(true);
    const c = Math.cos(nav.heading), s = Math.sin(nav.heading);
    const [lx, lz] = this.obsLocal;
    this.obstacles[0].x = nav.x + lx * c - lz * s;
    this.obstacles[0].z = nav.z + lx * s + lz * c;
  }

  update(dt, env) {
    const Wd = this.W;
    if (!this.aground) this.nav.step(dt, env.windDir);
    this._place(dt);
    const m = this.group.matrixWorld;
    const ocean = Wd.ctx.ocean;
    const nav = this.nav;
    // wake + collars
    if (dt > 0 && ocean && nav.speed > 0.4) {
      _v.set(0, 0, this.L / 2 + 1).applyMatrix4(m);
      ocean.addWake?.(_v.x, _v.z, clamp(nav.speed / 3, 0.3, 1.5), Math.sin(nav.heading), -Math.cos(nav.heading));
    }
    const far = Math.abs(nav.x - env.focus.x) + Math.abs(nav.z - env.focus.y) > 600;
    if (far) return;
    if (this.radar && dt > 0) {
      const [rx, ry, rz, rl] = this.radar;
      this.radarA += dt * Math.PI * 2 * 0.4;
      _d.set(Math.cos(this.radarA), 0, Math.sin(this.radarA));
      _v.set(rx - _d.x * rl * 0.5, ry, rz - _d.z * rl * 0.5).applyMatrix4(m);
      _n.copy(_d).applyQuaternion(this.group.quaternion);
      Wd.rigging.push(_v.x, _v.y, _v.z, _n, rl, 0.09, RADAR_COL);
    }
    const foam = this.aground ? 1.2 : 0.4 + 0.4 * smoothstep(1, 6, env.Hs);
    const n = this.kind === 'cargo' ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const lz = (i / (n - 1) - 0.5) * this.L * 0.85;
      for (const side of SIDES) {
        _v.set(side * this.B * 0.42, 0, lz).applyMatrix4(m);
        const h = ocean ? ocean.heightAt(_v.x, _v.z) : 0;
        if (ocean?.normalAt) ocean.normalAt(_v.x, _v.z, _n);
        else _n.set(0, 1, 0);
        Wd.collars.push(_v.x, h, _v.z, _n.x, _n.y, _n.z, this.B * 0.35, foam, 0.28, ocean?.searchlightAt ? ocean.searchlightAt(_v.x, _v.z) : 0, i + side);
      }
    }
    if (this.aground && dt > 0 && ocean) {
      // surf bursting against the hull now and then
      this.flick -= dt;
      if (this.flick <= 0) {
        // breakers burst against the low (weather) side, spray blows over the hull
        const sea = smoothstep(0.3, 4, env.Hs);
        this.flick = (1.1 + 1.6 * Math.abs(Math.sin(env.t * 1.7))) * (1.4 - 0.6 * sea);
        const side = Math.sin(env.t * 0.9) > -0.3 ? -1 : 1;
        _v.set(side * this.B * 0.55, 0, Math.sin(env.t * 1.3) * 0.38 * this.L).applyMatrix4(m);
        ocean.splash?.(_v.x, _v.z, 4 + 3 * sea, 0.7 + 0.4 * sea);
        Wd.ctx.fx?.splash?.(_v.x, 1, _v.z, 4 + 4 * sea);
        _d.set(-side, 0, 0).applyQuaternion(this.group.quaternion);
        _s2.set(_d.x + env.windDir.x, _d.z + env.windDir.y).normalize();
        Wd.ctx.fx?.spray?.(_v.x, _v.z, _s2, 8 + 16 * sea);
        ocean.stamp?.('foam', _v.x, _v.z, ST_SURF);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
