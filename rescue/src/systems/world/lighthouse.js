// Lighthouse «Скалистый» (DESIGN §2.11 [MUST], §3.9, catalogue #31, #43): the start pad.
// Island: granite terrain (landforms.js — heightfield, boulders, krummholz) with surf (ocean.setShoals).
// Structures (one weathered prop mesh, materials.js wear API, seated on the sampled terrain): banded
// tower (weathered #D6D2C6 / #9E2A22, rust runs under the gallery and windows, base grime, stone
// base course, entrance porch, corbelled gallery, glazed lantern with astragals, vane), keeper's
// house (standing-seam roof, eaves, gutters, framed windows), shed, fuel tank in a bund, pump,
// radio mast on footings, concrete walkway with kerbs and railings, pier on piles; steel helideck
// on a braced frame at 12 m with a painted, scuffed deck and an inclined safety net; rotating DOUBLE
// beam (8 s per turn) = additive volumetric cones + the world's one SpotLight sweeping the sea;
// translucent in fog; windsock on the pad; foghorn every 30 s in fog.
import * as THREE from 'three';
import { bake, thinNoShadow, p, member, beam, railParts, latticeParts, shadeVerts, fbm3, worn, UNIT, SURF, emit } from './geo.js';
import { CH, createPropMaterial, beamGeometry, setGlow } from './materials.js';
import { paintHelideck, decalTexture } from './decals.js';
import { Windsock } from './rigging.js';
import { createIsland } from './landforms.js';
import { shadowLod } from './terrain.js';
import { setTerrainGlow } from './terrainMaterial.js';
import { clamp, smoothstep } from '../../core/math.js';

const DECK_Y = 12;
const PAD_R = 12.3; // octagon corner radius of the deck
const TOWER = { x: -9, z: -27 };
const LANTERN_Y = 38.3;
const BEAM_LEN = 680;
const PERIOD = 8; // s per revolution
const PERIM_R = (PAD_R * Math.cos(Math.PI / 8)) / Math.cos(Math.PI / 16) - 0.3; // perimeter lights: inside the octagon edge

const C = {
  white: '#D6D2C6', // weathered off-white (muted from #ECEBE6)
  red: '#9E2A22', // weathered signal red (muted from #B3261E)
  dark: '#383E3D', // painted steel: gallery, lantern, railings
  cupola: '#5A2622',
  roof: '#6E2C26',
  roofEave: '#552A25',
  roofSeam: '#5F2722',
  trim: '#E2DED3',
  render: '#D2CEC2',
  door: '#3E4C47',
  concrete: '#8E8E87',
  concreteDark: '#6E706B',
  jetty: '#76776F', // sea-weathered concrete (darker than the rock it leaves)
  deckEdge: '#5A5F5C',
  net: '#2A2F2E',
  glass: '#FFF1CF',
  window: '#FFC98A',
  steel: '#535C5A',
  galv: '#A3A7A2',
  clad: '#6E6A60',
  cladRib: '#5F5B52',
  tank: '#C2C2B8',
  rust: '#6B3A22',
};
const _c = new THREE.Color();
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const noShadow = (part) => ((part.shadow = false), part);
// light-spill colours, parsed once (update() runs every frame)
const GLOW = { lamp: new THREE.Color('#FFE2B0'), flood: new THREE.Color('#FFE6B0'), window: new THREE.Color('#FFC98A'), nav: new THREE.Color('#12FF6E') };
const fract = (v) => v - Math.floor(v);

// Tower band: open tapered cylinder with baked weathering — rust runs below the gallery and each
// window (noise stretched along Y), green-grey salt / algae grime over the bottom 2 m, lantern soot.
function towerBand(a, b, hex, y0, y1, rAt, windows) {
  const g = new THREE.CylinderGeometry(rAt(b), rAt(a), b - a, 72, Math.max(2, Math.round((b - a) / 0.5)), true);
  const base = new THREE.Color(hex), rust = new THREE.Color(C.rust), grime = new THREE.Color('#59604F'), soot = new THREE.Color('#2C2A28');
  const yc = (a + b) / 2;
  return shadeVerts(g, (x, y, z, out) => {
    const Y = y + yc, th = Math.atan2(z, x), r = Math.hypot(x, z);
    const n = fbm3(x * 0.7, Y * 0.35, z * 0.7, 11, 2);
    out.copy(base).multiplyScalar(0.9 + 0.2 * n);
    const run = fbm3(x * 1.7, Y * 0.06, z * 1.7, 23, 2);
    let rs = smoothstep(0.46, 0.64, run) * Math.exp(-(y1 - Y) / 7) * 0.8 + 0.28 * smoothstep(0.54, 0.7, fbm3(x * 2.3, Y * 0.04, z * 2.3, 29, 2));
    for (const w of windows) {
      let d = Math.abs(th - w.th);
      if (d > Math.PI) d = 2 * Math.PI - d;
      const s = d * r;
      if (s < 0.5 && Y < w.y - 0.5) rs = Math.max(rs, (1 - s / 0.5) * Math.exp(-(w.y - 0.5 - Y) / 2.4) * (0.45 + 0.5 * run));
    }
    out.lerp(rust, Math.min(0.7, rs));
    out.lerp(grime, 0.55 * (1 - smoothstep(0, 2.4, Y - y0 + (n - 0.5) * 1.2)));
    out.lerp(soot, 0.3 * smoothstep(y1 - 2.4, y1, Y));
  });
}

// Stone base course: coursed blocks (per-block tone), green-grey grime at the foot.
function baseCourse(rb, rt, h) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 96, 5, true);
  const a = new THREE.Color('#77736A'), b = new THREE.Color('#9A958A'), m = new THREE.Color('#4E5146');
  return shadeVerts(g, (x, y, z, out) => {
    const row = Math.floor((y + h / 2) / 0.44);
    const th = Math.atan2(z, x) + Math.PI;
    const blk = Math.floor((th * rb) / 0.85 + (row % 2) * 0.5);
    out.copy(a).lerp(b, fract(Math.sin(row * 127.1 + blk * 311.7) * 43758.5453));
    out.multiplyScalar(0.92 + 0.16 * fbm3(x * 1.3, y * 1.3, z * 1.3, 61, 2));
    out.lerp(m, 0.45 * (1 - smoothstep(0, 0.9, y + h / 2)));
  });
}

export class Lighthouse {
  constructor(W, def) {
    this.W = W;
    this.x = def.x || 0;
    this.z = def.z || 0;
    this.name = def.name || 'Скалистый';
    this.group = new THREE.Group();
    this.group.name = 'lighthouse';
    this.group.position.set(this.x, 0, this.z);
    W.root.add(this.group);

    this.decal = decalTexture(W.look, 512, 512, (g, w) =>
      paintHelideck(g, 0, 0, w, PAD_R, { name: this.name.toUpperCase(), deck: '#7D827F', seed: 17, numbers: ['5.5', '20'] }),
    );
    // lightly weathered (a maintained station); the jetty and fittings carry heavier per-part wear
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'lighthouse', wear: 'light', seaLevel: 0 });

    // the island itself: granite terrain + tide-washed boulders + krummholz (landforms.js) — built
    // first: the structures sample its height (plinths, posts, walkway, anchors seated on the rock)
    this.land = createIsland(W, W.ctx.settings.get?.('quality') || 'high');
    this.group.add(this.land.group);

    this.mesh = shadowLod(new THREE.Mesh(bake(W.look, thinNoShadow(this._parts())), this.material));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // double beam (one geometry, rotates as a whole)
    this.beam = new THREE.Mesh(beamGeometry(BEAM_LEN, 0.9, 34, { twin: true, tilt: -1.4 * Math.PI / 180 }), W.mats.beam);
    this.beam.position.set(TOWER.x, LANTERN_Y, TOWER.z);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    this.group.add(this.beam);

    this.angle = 1.1;
    this.fogT = 22; // first foghorn soon after the fog rolls in
    this.windsock = new Windsock(3);
    this.hoop = new THREE.Vector3(this.x + 10.4, DECK_Y + 4.6, this.z + 7.6);
    this._lamps();

    // gameplay data
    this.padPosition = new THREE.Vector3(this.x, DECK_Y, this.z);
    this.padRadius = 10.5;
    this.lantern = new THREE.Vector3(this.x + TOWER.x, LANTERN_Y, this.z + TOWER.z);
    this.obstacles = [
      { x: this.x + TOWER.x, z: this.z + TOWER.z, radius: 5, top: LANTERN_Y + 3, kind: 'tower', name: 'маяк' },
      { x: this.x + 22, z: this.z - 31, radius: 1.8, top: 27, kind: 'mast', name: 'мачта' },
    ];
    // surf rings = circles inscribed in the real coastline (fitted on the terrain grid)
    this.shoals = this.land.shoals.map((s) => ({ x: this.x + s.x, z: this.z + s.z, radius: s.radius }));
    // the rock itself: collision columns fitted to the terrain (crags, shoulders, skerries)
    this.island = { x: this.x - 6, z: this.z - 17, radius: 26, top: 10.5, kind: 'rock', name: 'скалы' };
    for (const o of this.land.obstacles) this.obstacles.push({ x: this.x + o.x, z: this.z + o.z, radius: o.radius, top: o.top, kind: 'rock', name: 'скалы' });
    // lantern light spill on the gallery & tower top, house windows on the rock
    setGlow(this.material, 0, TOWER.x, LANTERN_Y, TOWER.z, 5, new THREE.Color('#FFE2B0'), 0);
    setGlow(this.material, 1, 0, DECK_Y + 4, 0, 14, new THREE.Color('#FFE6B0'), 0);
  }

  // --------------------------------------------------------------------------------------------
  // Everything man-made on the island, baked into one weathered prop mesh (materials.js wear API).
  // Static parts standing on land carry `ground` (terrain height under them): base grime, a thin
  // splash / algae line and the grime gradient gather above it; the jetty weathers above the sea.
  _parts() {
    const P = [];
    const S = this.land.sampler;
    const gh = (x, z) => S.heightAt(x, z);
    const minG = (pts) => pts.reduce((m, [x, z]) => Math.min(m, gh(x, z)), 1e9);
    const on = (part, ground) => ((part.ground = ground), part);
    const vc = (geometry, surf, position = [0, 0, 0], ground) => {
      const part = { geometry, color: '#FFFFFF', position, surf, vcol: true };
      if (ground !== undefined) part.ground = ground;
      return part;
    };

    // --- helipad: steel deck on a braced steel frame over the rock, painted deck, inclined net
    const pad = [];
    pad.push(p(UNIT.oct, C.deckEdge, [0, DECK_Y - 0.225, 0], [PAD_R, 0.45, PAD_R], null, SURF.steelWorn));
    pad.push({ geometry: new THREE.CircleGeometry(PAD_R, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [0, DECK_Y + 0.02, 0], surf: SURF.decal, uvRect: [0, 0, 1, 1] });
    const net = new THREE.RingGeometry(PAD_R + 0.05, PAD_R + 1.5, 8, 2, Math.PI / 8).rotateX(-Math.PI / 2);
    const np = net.attributes.position;
    for (let i = 0; i < np.count; i++) np.setY(i, -(Math.hypot(np.getX(i), np.getZ(i)) - PAD_R) * 0.18);
    net.computeVertexNormals();
    pad.push({ geometry: net, color: C.net, position: [0, DECK_Y - 0.12, 0], surf: SURF.fabric });
    const corner = (i, r) => [Math.cos(Math.PI / 8 + (i * Math.PI) / 4) * r, Math.sin(Math.PI / 8 + (i * Math.PI) / 4) * r];
    for (let i = 0; i < 8; i++) {
      const [ax, az] = corner(i, PAD_R), [bx, bz] = corner(i, PAD_R + 1.5), [cx, cz] = corner(i + 1, PAD_R + 1.5);
      pad.push(member([ax, DECK_Y - 0.1, az], [bx, DECK_Y - 0.4, bz], 0.06, C.steel)); // net brackets
      pad.push(member([bx, DECK_Y - 0.4, bz], [cx, DECK_Y - 0.4, cz], 0.05, C.steel)); // net rim tube
      const [ex, ez] = corner(i, PAD_R - 0.3), [fx, fz] = corner(i + 1, PAD_R - 0.3);
      pad.push(beam([0, DECK_Y - 0.7, 0], [ex, DECK_Y - 0.7, ez], 0.28, 0.5, C.steel, SURF.steelWorn)); // radial girders
      pad.push(beam([ex, DECK_Y - 0.7, ez], [fx, DECK_Y - 0.7, fz], 0.28, 0.5, C.steel, SURF.steelWorn)); // ring girder
    }
    // perimeter light housings (the green lamps sit on them, just inside the deck edge)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      pad.push(p(UNIT.box, '#23282B', [Math.cos(a) * PERIM_R, DECK_Y + 0.05, Math.sin(a) * PERIM_R], [0.3, 0.1, 0.3], [0, -a, 0], SURF.steel));
    }
    // posts to the rock (8 under the corners, 4 inner) on concrete footings, X-braced round the rim
    const posts = [];
    for (let i = 0; i < 8; i++) posts.push(corner(i, PAD_R - 1.1));
    for (let i = 0; i < 4; i++) posts.push(corner(i * 2, 5.2));
    posts.forEach(([x, z], k) => {
      const g = gh(x, z);
      pad.push(on(member([x, g - 0.3, z], [x, DECK_Y - 0.9, z], 0.2, C.steel, SURF.steelRusty, UNIT.cyl8), g));
      pad.push(on(p(UNIT.box, C.concreteDark, [x, g + 0.1, z], [0.95, 0.9, 0.95], [0, k * 0.4, 0], SURF.concreteStained), g));
    });
    for (let i = 0; i < 8; i++) {
      const [ax, az] = posts[i], [bx, bz] = posts[(i + 1) % 8];
      const ga = gh(ax, az), gb = gh(bx, bz);
      pad.push(member([ax, DECK_Y - 1.0, az], [bx, gb + 0.5, bz], 0.07, C.steel, SURF.steelRusty));
      pad.push(member([bx, DECK_Y - 1.0, bz], [ax, ga + 0.5, az], 0.07, C.steel, SURF.steelRusty));
    }
    P.push(...pad);

    // --- walkway pad → tower: poured concrete on the rock, kerbs, railings, bollard lights
    P.push(...this._walkway(S, [-3.2, -11.2], [-7.9, -22.6]));

    // --- tower: plinth, stone base course, banded tapered shaft (rust bleed, base grime and lantern
    // soot baked into vertex colours), entrance porch, window reveals, corbelled gallery, lantern
    const tx = TOWER.x, tz = TOWER.z;
    const y0 = 10.5, y1 = 36;
    const rAt = (y) => 4.3 - ((y - y0) / (y1 - y0)) * 1.25;
    P.push(on(p(UNIT.cyl32, C.concreteDark, [tx, 6.5, tz], [5.4, 8, 5.4], null, SURF.concreteStained), 9.6));
    // the finely tessellated base course and banded shaft (vertex-colour weathering) cast their
    // shadow through two 24-sided stand-ins (bake shadow LOD)
    P.push(noShadow(vc(baseCourse(4.6, 4.45, 2.2), SURF.concreteStained, [tx, y0 - 0.2 + 1.1, tz], y0)));
    P.push({ ...p(new THREE.CylinderGeometry(4.45, 4.6, 2.2, 24, 1, true), C.white, [tx, y0 - 0.2 + 1.1, tz]), shadow: 'only' });
    P.push({ ...p(new THREE.CylinderGeometry(rAt(y1), rAt(y0), y1 - y0, 24, 1, true), C.white, [tx, (y0 + y1) / 2, tz]), shadow: 'only' });
    P.push(p(new THREE.RingGeometry(rAt(y0 + 2), 4.52, 48, 1).rotateX(-Math.PI / 2), '#8F8C83', [tx, y0 + 2.01, tz], 1, null, SURF.concrete));
    const windows = [{ y: 17.5, th: 1.15 }, { y: 23, th: 1.85 }, { y: 28.5, th: 0.95 }];
    const bands = [
      [y0, 15.5, C.white],
      [15.5, 19.5, C.red],
      [19.5, 25, C.white],
      [25, 29, C.red],
      [29, 33.2, C.white],
      [33.2, y1, C.red],
    ];
    bands.forEach(([a, b, col], i) => {
      P.push(noShadow(vc(towerBand(a, b, col, y0, y1, rAt, windows), worn(SURF.paint, 0.5, 0.66 + (i % 3) * 0.04), [tx, (a + b) / 2, tz], y0)));
      if (i) P.push(noShadow(p(new THREE.CylinderGeometry(rAt(a) + 0.03, rAt(a) + 0.03, 0.07, 48, 1, true), shade(bands[i - 1][2], 0.86), [tx, a, tz], 1, null, SURF.paintFaded)));
    });
    const onShaft = (th, y, off, size, color, surf) => {
      const r = rAt(y) + off;
      return p(UNIT.box, color, [tx + Math.cos(th) * r, y, tz + Math.sin(th) * r], size, [0, Math.PI / 2 - th, 0], surf);
    };
    for (const w of windows) {
      P.push(onShaft(w.th, w.y + 0.05, 0.0, [0.8, 1.4, 0.1], '#C9C4B6', SURF.paintFaded)); // surround
      P.push(onShaft(w.th, w.y, 0.04, [0.52, 1.08, 0.06], '#1B1F21', SURF.concrete)); // reveal shadow
      P.push(onShaft(w.th, w.y, 0.06, [0.4, 0.92, 0.04], '#14181B', emit(CH.WINDOWS, 0.6))); // glass
      P.push(onShaft(w.th, w.y - 0.6, 0.1, [0.82, 0.08, 0.24], '#D8D4C8', SURF.concrete)); // sill
    }
    // entrance porch facing the walkway: rendered box, flat roof, green steel door, step
    const dth = 1.33, dc = Math.cos(dth), ds = Math.sin(dth), dr = [0, Math.PI / 2 - dth, 0];
    const at = (r, y) => [tx + dc * r, y, tz + ds * r];
    P.push(on(p(UNIT.box, C.render, at(4.25, y0 + 1.45), [2.3, 2.9, 2.0], dr, SURF.paintFaded), y0));
    P.push(p(UNIT.box, '#6A6862', at(4.35, y0 + 2.98), [2.6, 0.16, 2.3], dr, SURF.concreteStained));
    P.push(p(UNIT.box, '#C9C4B6', at(5.26, y0 + 1.15), [1.3, 2.35, 0.06], dr, SURF.paintFaded));
    P.push(p(UNIT.box, C.door, at(5.29, y0 + 1.06), [0.98, 2.1, 0.06], dr, SURF.paintWorn));
    P.push(on(p(UNIT.box, C.concrete, at(5.62, y0 - 0.12), [1.7, 0.24, 0.7], dr, SURF.concreteStained), y0 - 0.3));
    this.doorLamp = [this.x + tx + dc * 5.4, y0 + 2.62, this.z + tz + ds * 5.4];
    // lightning conductor down the north side
    P.push(member([tx, y0 + 2, tz - rAt(y0 + 2) - 0.06], [tx, y1, tz - rAt(y1) - 0.06], 0.025, '#4A3A30', SURF.steelRusty));
    // gallery: corbelled balcony slab + railing
    P.push(p(UNIT.cyl32, C.dark, [tx, y1 + 0.18, tz], [4.7, 0.36, 4.7], null, SURF.paintWorn));
    for (let i = 0; i < 16; i++) {
      const th = ((i + 0.5) / 16) * Math.PI * 2;
      P.push(onShaft(th, y1 - 0.35, 0.72, [0.22, 0.7, 1.45], C.dark, SURF.paintWorn));
      P.push(onShaft(th, y1 - 1.0, 0.3, [0.2, 0.6, 0.62], C.dark, SURF.paintWorn));
    }
    const ring = [];
    for (let i = 0; i < 16; i++) ring.push([tx + Math.cos((i / 16) * Math.PI * 2) * 4.5, tz + Math.sin((i / 16) * Math.PI * 2) * 4.5]);
    P.push(...railParts(ring, y1 + 0.36, 1.05, C.dark, { loop: true, post: 1.8, r: 0.05 }));
    // lantern room: drum, glazing with vertical + diagonal astragals, cupola, vent ball, vane
    P.push(p(UNIT.cyl32, C.dark, [tx, y1 + 0.75, tz], [2.5, 0.8, 2.5], null, SURF.paintWorn));
    P.push(p(UNIT.cyl20, C.glass, [tx, LANTERN_Y, tz], [2.25, 3.2, 2.25], null, emit(CH.LANTERN, 1.6, 0.06)));
    const gy0 = LANTERN_Y - 1.6, gy1 = LANTERN_Y + 1.6, gr = 2.29;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, b = ((i + 1) / 16) * Math.PI * 2;
      if (i % 2 === 0) P.push(p(UNIT.box, C.dark, [tx + Math.cos(a) * 2.27, LANTERN_Y, tz + Math.sin(a) * 2.27], [0.1, 3.2, 0.1], [0, -a, 0], SURF.steel));
      P.push(member([tx + Math.cos(a) * gr, gy0, tz + Math.sin(a) * gr], [tx + Math.cos(b) * gr, gy1, tz + Math.sin(b) * gr], 0.022, C.dark, SURF.steel));
      P.push(member([tx + Math.cos(b) * gr, gy0, tz + Math.sin(b) * gr], [tx + Math.cos(a) * gr, gy1, tz + Math.sin(a) * gr], 0.022, C.dark, SURF.steel));
    }
    P.push(p(new THREE.CylinderGeometry(2.3, 2.3, 0.08, 32, 1, true), C.dark, [tx, LANTERN_Y + 0.55, tz], 1, null, SURF.steel));
    P.push(p(new THREE.CylinderGeometry(2.3, 2.3, 0.08, 32, 1, true), C.dark, [tx, LANTERN_Y - 0.55, tz], 1, null, SURF.steel));
    P.push(p(UNIT.cyl32, C.dark, [tx, gy1 + 0.08, tz], [2.8, 0.16, 2.8], null, SURF.paintWorn));
    P.push(p(new THREE.ConeGeometry(2.75, 1.7, 32), C.cupola, [tx, LANTERN_Y + 2.45, tz], 1, null, worn(SURF.paint, 'medium', 0.6)));
    P.push(p(UNIT.sphere, C.dark, [tx, LANTERN_Y + 3.5, tz], 0.42, null, SURF.steelWorn));
    P.push(member([tx, LANTERN_Y + 3.8, tz], [tx, LANTERN_Y + 5.6, tz], 0.035, C.dark));
    P.push(p(UNIT.box, C.dark, [tx, LANTERN_Y + 4.55, tz], [0.9, 0.03, 0.03], null, SURF.steel));
    P.push(p(UNIT.box, C.dark, [tx, LANTERN_Y + 4.55, tz], [0.03, 0.03, 0.9], null, SURF.steel));
    P.push(p(UNIT.box, C.dark, [tx, LANTERN_Y + 5.05, tz], [1.25, 0.05, 0.05], [0, 0.6, 0], SURF.steel)); // vane arrow
    P.push(p(UNIT.box, C.dark, [tx + Math.cos(-0.6) * 0.5, LANTERN_Y + 5.05, tz + Math.sin(-0.6) * 0.5], [0.34, 0.3, 0.03], [0, 0.6, 0], SURF.steel)); // tail fin

    // --- keeper's house: plinth stepped to the rock, rendered walls, standing-seam roof with eaves,
    // bargeboards, gutters, downpipe, chimney with cap, framed windows with sills, door + porch step
    P.push(...this._house(gh, minG, 13, -27));
    // --- annex / shed: corrugated cladding, lean-to roof, door, small window
    P.push(...this._shed(minG, 4.8, -24.5));
    // --- fuel station: tank on saddles in a bund, ladder, manway, pipework, pump cabinet
    P.push(...this._fuel(minG));

    // --- radio mast: lattice on a footing, guy wires to concrete anchors, equipment cabinet
    const mg = gh(22, -31);
    P.push(on(p(UNIT.box, C.concreteDark, [22, mg + 0.05, -31], [1.9, 0.9, 1.9], null, SURF.concreteStained), mg));
    P.push(...latticeParts([22, mg + 0.5, -31], [22, 26.5, -31], 0.55, 0.25, C.galv, { bays: 7, r: 0.05, brace: 0.03 }));
    for (const [ax, az] of [[30, -38], [16, -40], [26, -20]]) {
      const ag = gh(ax, az);
      P.push(on(p(UNIT.box, C.concreteDark, [ax, ag + 0.05, az], [0.9, 0.6, 0.9], [0, ax * 0.3, 0], SURF.concreteStained), ag));
      P.push(member([22, 24, -31], [ax, ag + 0.35, az], 0.025, '#6E726E'));
    }
    const cg = gh(23.6, -29.8);
    P.push(on(p(UNIT.box, '#8E928C', [23.6, cg + 0.7, -29.8], [0.9, 1.4, 0.6], [0, 0.2, 0], SURF.paintWorn), cg));
    P.push(p(UNIT.box, '#5E625E', [23.6, cg + 1.44, -29.8], [1.0, 0.08, 0.7], [0, 0.2, 0], SURF.steelWorn));

    // --- windsock mast at the pad edge
    const wg = gh(10.4, 7.6);
    P.push(on(member([10.4, wg - 0.2, 7.6], [10.4, DECK_Y + 4.8, 7.6], 0.11, '#C9C9C2', SURF.paintWorn), wg));
    P.push(on(p(UNIT.box, C.concreteDark, [10.4, wg + 0.1, 7.6], [0.8, 0.6, 0.8], null, SURF.concreteStained), wg));
    P.push(p(UNIT.torus, '#2A2E33', [10.4, DECK_Y + 4.6, 7.6], 0.5, [Math.PI / 2, 0, 0], SURF.steel));
    // pad flood posts
    for (const [x, z] of [[-9.5, 9.5], [9.5, -9.5]]) {
      P.push(member([x, DECK_Y - 0.2, z], [x, DECK_Y + 0.9, z], 0.08, C.dark));
      P.push(p(UNIT.box, '#2A2E31', [x, DECK_Y + 1.0, z], [0.56, 0.4, 0.4], null, SURF.steel));
      P.push(p(UNIT.box, '#FFE6B0', [x, DECK_Y + 1.0, z + (z > 0 ? -0.21 : 0.21)], [0.46, 0.3, 0.02], null, emit(CH.PADLIGHT, 2)));
    }

    // --- jetty: concrete deck on two rows of piles, cross-beams, fenders, ladder, bollards
    P.push(...this._jetty(gh, [23, 9], [33, 25]));
    return P;
  }

  _walkway(S, a, b) {
    const P = [];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const hw = 1.1, kw = 0.2, kh = 0.16;
    const N = Math.ceil(len / 0.5);
    const H = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * len;
      const cx = a[0] + ux * t, cz = a[1] + uz * t;
      let h = -1e9;
      for (const u of [-hw - kw, -hw * 0.5, 0, hw * 0.5, hw + kw]) h = Math.max(h, S.heightAt(cx + nx * u, cz + nz * u));
      H.push(h + 0.1);
    }
    const Hs = H.map((h, i) => Math.max(h, (H[Math.max(0, i - 1)] + 2 * h + H[Math.min(N, i + 1)]) / 4));
    // profile across: [u, dy] with dy relative to the deck height; null dy = skirt to the rock
    const prof = [[-hw - kw, null], [-hw - kw, kh], [-hw, kh], [-hw, 0], [hw, 0], [hw, kh], [hw + kw, kh], [hw + kw, null]];
    const pos = [], col = [];
    const cDeck = new THREE.Color('#9A9A92'), cMoss = new THREE.Color('#58633F'), cLichen = new THREE.Color('#B5B59A'), cDirt = new THREE.Color('#5A5650');
    const c = new THREE.Color();
    const vert = (i, k) => {
      const t = (i / N) * len;
      const [u, dy] = prof[k];
      const x = a[0] + ux * t + nx * u, z = a[1] + uz * t + nz * u;
      const y = dy === null ? S.heightAt(x, z) - 0.45 : Hs[i] + dy;
      const n = fbm3(x * 0.9, 0, z * 0.9, 31, 2), n2 = fbm3(x * 3.1, 1, z * 3.1, 37, 2);
      const edge = Math.abs(u) > hw - 0.25 ? 1 : 0.15;
      const cov = S.coverAt ? S.coverAt(x, z) : 0.5;
      c.copy(cDeck).multiplyScalar(0.9 + 0.2 * n);
      c.lerp(cMoss, Math.min(0.85, edge * (0.25 + 0.9 * cov) * smoothstep(0.45, 0.7, n2 + 0.2 * cov) + (dy === null ? 0.35 : 0)));
      c.lerp(cLichen, 0.35 * smoothstep(0.66, 0.8, n2) * (1 - edge * 0.5));
      if (dy === null) c.lerp(cDirt, 0.4);
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < prof.length - 1; k++) {
        // two triangles (i,k) (i+1,k) (i+1,k+1) / (i,k) (i+1,k+1) (i,k+1), wound to face outward/up
        vert(i, k); vert(i, k + 1); vert(i + 1, k + 1);
        vert(i, k); vert(i + 1, k + 1); vert(i + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    P.push({ geometry: g, color: '#FFFFFF', position: [0, 0, 0], surf: SURF.concreteStained, vcol: true, ground: Hs[N] - 0.1 });
    // railings on both kerbs + three bollard lights on the east kerb
    for (const side of [-1, 1]) {
      const u = side * (hw + kw * 0.5);
      let prev = null;
      const cnt = Math.round(len / 1.8);
      for (let k = 0; k <= cnt; k++) {
        const t = (k / cnt) * len, i = Math.round((t / len) * N);
        const x = a[0] + ux * t + nx * u, z = a[1] + uz * t + nz * u, y = Hs[i] + kh;
        P.push(member([x, y, z], [x, y + 1.0, z], 0.035, C.galv, SURF.steelWorn));
        if (prev) {
          P.push(member([prev[0], prev[1] + 1.0, prev[2]], [x, y + 1.0, z], 0.035, C.galv, SURF.steelWorn));
          P.push(member([prev[0], prev[1] + 0.5, prev[2]], [x, y + 0.5, z], 0.025, C.galv, SURF.steelWorn));
        }
        prev = [x, y, z];
      }
    }
    this.walkLamps = [];
    for (const f of [0.22, 0.55, 0.83]) {
      const t = f * len, i = Math.round(f * N);
      const u = hw + kw * 0.5;
      const x = a[0] + ux * t + nx * u, z = a[1] + uz * t + nz * u, y = Hs[i] + kh;
      P.push(p(UNIT.box, '#2A2E31', [x, y + 0.3, z], [0.18, 0.6, 0.18], null, SURF.steel));
      P.push(p(UNIT.box, '#FFD9A0', [x, y + 0.66, z], [0.2, 0.12, 0.2], null, emit(CH.PADLIGHT, 1.2)));
      P.push(p(UNIT.box, '#2A2E31', [x, y + 0.75, z], [0.24, 0.05, 0.24], null, SURF.steel));
      this.walkLamps.push([this.x + x, y + 0.66, this.z + z]);
    }
    return P;
  }

  _house(gh, minG, hx, hz) {
    const P = [];
    const W = 10, D = 6.2, floor = 10.0, wallH = 3.3, eave = floor + wallH;
    const pitch = Math.atan2(2.0, D / 2);
    const ground = minG([[hx - 5.3, hz - 3.4], [hx + 5.3, hz - 3.4], [hx - 5.3, hz + 3.4], [hx + 5.3, hz + 3.4], [hx, hz - 3.4], [hx, hz + 3.4], [hx - 5.3, hz], [hx + 5.3, hz]]);
    const pb = ground - 0.4;
    P.push({ geometry: UNIT.box, color: C.concreteDark, position: [hx, (pb + floor) / 2, hz], scale: [W + 0.4, floor - pb, D + 0.4], surf: SURF.concreteStained, ground });
    P.push({ geometry: UNIT.box, color: C.render, position: [hx, floor + wallH / 2, hz], scale: [W, wallH, D], surf: worn(SURF.paint, 'light', 0.86), ground: floor });
    P.push(p(UNIT.prism, C.render, [hx, eave, hz], [W, 2.0, D], null, worn(SURF.paint, 'light', 0.86))); // gable walls
    // roof: two slabs (eave → ridge, 0.4 m overhang all round) shaded darker toward the eaves
    const L = (D / 2 + 0.4) / Math.cos(pitch), T = 0.12;
    const ridgeY = eave + 2.0;
    for (const s of [1, -1]) {
      const g = new THREE.BoxGeometry(W + 0.8, T, L, 16, 1, 8);
      shadeVerts(g, (x, y, z, out) => {
        const t = 0.5 + (s * z) / L; // 0 ridge → 1 eave
        out.set(C.roof).lerp(_c.set(C.roofEave), smoothstep(0.35, 1.0, t)).multiplyScalar(0.9 + 0.2 * fbm3(x * 0.6, 0, z * 0.6 + s, 41, 2));
      });
      const mz = (s * L * Math.cos(pitch)) / 2, my = ridgeY - (L * Math.sin(pitch)) / 2;
      const nz = s * Math.sin(pitch) * (T / 2), ny = Math.cos(pitch) * (T / 2);
      P.push({ geometry: g, color: '#FFFFFF', position: [hx, my + ny, hz + mz + nz], rotation: [s * pitch, 0, 0], surf: worn(SURF.paint, 'medium', 0.6), vcol: true });
      // standing seams every 0.5 m
      for (let x = -W / 2 - 0.3; x <= W / 2 + 0.31; x += 0.5) {
        P.push(p(UNIT.box, C.roofSeam, [hx + x, my + ny * 2 + Math.cos(pitch) * 0.03, hz + mz + nz * 2 + s * Math.sin(pitch) * 0.03], [0.04, 0.06, L], [s * pitch, 0, 0], worn(SURF.paint, 'medium', 0.55)));
      }
      // fascia + gutter + bargeboards
      const ez = hz + s * (D / 2 + 0.4), ey = eave - 0.4 * Math.tan(pitch);
      P.push(p(UNIT.box, C.trim, [hx, ey - 0.12, ez + s * 0.02], [W + 0.84, 0.24, 0.05], null, SURF.paintWorn));
      P.push(member([hx - W / 2 - 0.4, ey - 0.2, ez + s * 0.1], [hx + W / 2 + 0.4, ey - 0.2, ez + s * 0.1], 0.07, '#5E6362', SURF.steelWorn));
      for (const e of [-1, 1]) {
        const bx = hx + e * (W / 2 + 0.42);
        P.push(beam([bx, ey + 0.02, ez + s * 0.02], [bx, ridgeY + 0.05, hz], 0.05, 0.26, C.trim, SURF.paintWorn));
      }
    }
    P.push(p(UNIT.box, C.roofSeam, [hx, ridgeY + T + 0.03, hz], [W + 0.85, 0.1, 0.34], null, worn(SURF.paint, 'medium', 0.55))); // ridge cap
    // downpipe at the south-east corner
    P.push(member([hx + W / 2 + 0.3, eave - 0.45, hz + D / 2 + 0.5], [hx + W / 2 + 0.12, floor - 0.1, hz + D / 2 + 0.12], 0.05, '#5E6362', SURF.steelWorn));
    // chimney on the north slope: rendered stack, soot-dark cap, two pots
    const cx = hx + 3, cz = hz - 1;
    const roofAt = ridgeY - Math.abs(cz - hz) * Math.tan(pitch);
    P.push(p(UNIT.box, '#8A847A', [cx, (roofAt - 0.3 + roofAt + 1.6) / 2, cz], [0.8, 1.9, 0.8], null, worn(SURF.concrete, 'medium')));
    P.push(p(UNIT.box, '#3E3B38', [cx, roofAt + 1.66, cz], [1.0, 0.12, 1.0], null, worn(SURF.concrete, 'heavy')));
    for (const o of [-0.18, 0.18]) P.push(p(UNIT.cyl8, '#6A4A3A', [cx + o, roofAt + 1.9, cz], [0.11, 0.38, 0.11], null, SURF.concrete));
    // windows: frame, glass (night channel), glazing bars, sill
    const win = (x, z, face) => {
      const fx = face === 'x' ? 1 : 0, rot = face === 'x' ? [0, Math.PI / 2, 0] : null;
      const sx = Math.sign(face === 'x' ? x - hx : z - hz);
      const pos = (o, y) => (face === 'x' ? [x + sx * o, y, z] : [x, y, z + sx * o]);
      const y = floor + 1.75, w = 1.0, h = 1.15;
      P.push(p(UNIT.box, C.trim, pos(0.03, y), [w + 0.2, h + 0.2, 0.06], rot, SURF.paintWorn));
      P.push(p(UNIT.box, C.window, pos(0.06, y), [w, h, 0.04], rot, emit(CH.WINDOWS, 1)));
      P.push(p(UNIT.box, '#3A3A36', pos(0.09, y), [0.05, h, 0.03], rot, SURF.paint));
      P.push(p(UNIT.box, '#3A3A36', pos(0.09, y + 0.15), [w, 0.05, 0.03], rot, SURF.paint));
      P.push(p(UNIT.box, '#B5B2A8', pos(0.12, y - h / 2 - 0.12), [w + 0.35, 0.07, 0.24], rot, SURF.concreteStained));
      void fx;
    };
    for (const ox of [-3.8, -2.0, 2.0, 3.8]) win(hx + ox, hz + D / 2, 'z');
    for (const ox of [-3.0, 0, 3.0]) win(hx + ox, hz - D / 2, 'z');
    for (const oz of [-1.4, 1.4]) win(hx + W / 2, hz + oz, 'x');
    win(hx - W / 2, hz, 'x');
    // door (south, centre) with frame, canopy and a porch step down to the rock
    const dz = hz + D / 2;
    P.push(p(UNIT.box, C.trim, [hx, floor + 1.15, dz + 0.03], [1.25, 2.3, 0.06], null, SURF.paintWorn));
    P.push(p(UNIT.box, C.door, [hx, floor + 1.05, dz + 0.06], [0.95, 2.08, 0.05], null, SURF.paintWorn));
    P.push(p(UNIT.box, '#4A4C4A', [hx, floor + 2.45, dz + 0.45], [1.6, 0.1, 0.9], null, SURF.steelWorn));
    this.porchLamp = [this.x + hx, floor + 2.3, this.z + dz + 0.3];
    const sg = gh(hx, dz + 0.6);
    P.push({ geometry: UNIT.box, color: C.concrete, position: [hx, (sg - 0.2 + floor) / 2, dz + 0.6], scale: [1.8, floor - sg + 0.2, 1.1], surf: SURF.concreteStained, ground: sg });
    return P;
  }

  _shed(minG, sx, sz) {
    const P = [];
    const w = 3.4, d = 3.0, h = 2.4;
    const ground = minG([[sx - 1.8, sz - 1.6], [sx + 1.8, sz - 1.6], [sx - 1.8, sz + 1.6], [sx + 1.8, sz + 1.6]]);
    const fl = Math.max(ground + 0.15, 9.45);
    P.push({ geometry: UNIT.box, color: C.concreteDark, position: [sx, (ground - 0.3 + fl) / 2, sz], scale: [w + 0.3, fl - ground + 0.3, d + 0.3], surf: SURF.concreteStained, ground });
    P.push({ geometry: UNIT.box, color: C.clad, position: [sx, fl + h / 2, sz], scale: [w, h, d], surf: worn(SURF.paint, 'medium', 0.72), ground: fl });
    // corrugation ribs round the walls
    for (let x = -w / 2 + 0.25; x < w / 2; x += 0.5) {
      for (const s of [-1, 1]) P.push(p(UNIT.box, C.cladRib, [sx + x, fl + h / 2, sz + s * (d / 2 + 0.015)], [0.05, h - 0.05, 0.03], null, worn(SURF.paint, 'medium', 0.7)));
    }
    for (let z = -d / 2 + 0.25; z < d / 2; z += 0.5) {
      for (const s of [-1, 1]) P.push(p(UNIT.box, C.cladRib, [sx + s * (w / 2 + 0.015), fl + h / 2, sz + z], [0.03, h - 0.05, 0.05], null, worn(SURF.paint, 'medium', 0.7)));
    }
    // lean-to roof falling to the south, door + small window
    P.push(p(UNIT.box, '#55574F', [sx, fl + h + 0.2, sz], [w + 0.5, 0.1, d + 0.6], [0.14, 0, 0], SURF.steelRusty));
    P.push(p(UNIT.box, '#4A4640', [sx + 0.6, fl + 1.0, sz + d / 2 + 0.04], [0.95, 1.95, 0.05], null, SURF.paintWorn));
    P.push(p(UNIT.box, '#1C2024', [sx - w / 2 - 0.04, fl + 1.5, sz], [0.05, 0.55, 0.8], null, SURF.glass));
    return P;
  }

  _fuel(minG) {
    const P = [];
    const fx = 15, fz = -8.5;
    const ground = minG([[fx - 3.3, fz - 1.8], [fx + 3.3, fz - 1.8], [fx - 3.3, fz + 1.8], [fx + 3.3, fz + 1.8]]);
    const top = 10.3;
    P.push({ geometry: UNIT.box, color: C.concrete, position: [fx, (ground - 0.3 + top) / 2, fz], scale: [6.6, top - ground + 0.3, 3.6], surf: SURF.concreteStained, ground });
    // bund wall round the slab
    for (const s of [-1, 1]) {
      P.push(p(UNIT.box, C.concreteDark, [fx, top + 0.25, fz + s * 1.68], [6.6, 0.5, 0.24], null, SURF.concreteStained));
      P.push(p(UNIT.box, C.concreteDark, [fx + s * 3.18, top + 0.25, fz], [0.24, 0.5, 3.12], null, SURF.concreteStained));
    }
    // tank: rust at the saddles, a muted hazard band, grime underneath, oily drips under the valve
    const R = 1.35, cyY = top + 0.1 + R;
    const tg = new THREE.CylinderGeometry(R, R, 5, 40, 12).rotateZ(Math.PI / 2);
    const base = new THREE.Color(C.tank), band = new THREE.Color('#A89040'), rust = new THREE.Color(C.rust), oil = new THREE.Color('#34302A');
    shadeVerts(tg, (x, y, z, out) => {
      const n = fbm3(x * 0.8, y * 0.8, z * 0.8, 51, 2);
      out.copy(Math.abs(x) < 0.2 ? band : base).multiplyScalar(0.9 + 0.16 * n);
      out.multiplyScalar(0.82 + 0.18 * smoothstep(-R, 0.4, y));
      const sd = Math.abs(Math.abs(x) - 1.6);
      if (sd < 0.45 && y < -0.4) out.lerp(rust, (1 - sd / 0.45) * smoothstep(-0.4, -1.1, y) * (0.5 + 0.4 * n));
      if (x < -2.3 && Math.abs(z) < 0.5 && y < 0.9) out.lerp(oil, (1 - Math.abs(z) / 0.5) * smoothstep(0.9, 0.2, y) * 0.7);
      out.lerp(rust, 0.3 * smoothstep(0.62, 0.78, fbm3(x * 1.4, y * 0.1, z * 1.4, 53, 2)) * smoothstep(1.2, -0.6, y));
    });
    P.push({ geometry: tg, color: '#FFFFFF', position: [fx, cyY, fz], surf: worn(SURF.paint, 'medium', 0.5), vcol: true });
    for (const s of [-1, 1]) P.push(p(UNIT.box, C.steel, [fx + s * 1.6, top + 0.45, fz], [0.4, 0.75, 2.5], null, SURF.steelRusty));
    // ladder (south side) to a manway on top
    const lz = fz + R + 0.2;
    for (const lx of [fx - 0.75, fx - 0.3]) P.push(member([lx, top, lz], [lx, cyY + R + 0.6, lz], 0.03, C.galv, SURF.steelWorn));
    for (let y = top + 0.3; y < cyY + R + 0.5; y += 0.3) P.push(member([fx - 0.75, y, lz], [fx - 0.3, y, lz], 0.018, C.galv, SURF.steelWorn));
    P.push(p(UNIT.cyl12, '#B8B8AE', [fx + 0.6, cyY + R + 0.08, fz], [0.38, 0.22, 0.38], null, SURF.paintWorn));
    P.push(p(UNIT.cyl12, '#5A5E5A', [fx + 0.6, cyY + R + 0.21, fz], [0.42, 0.05, 0.42], null, SURF.steelRusty));
    // valve + pipe from the west end cap to the pump
    P.push(p(UNIT.cyl8, '#8A2A22', [fx - 2.62, cyY - 0.85, fz], [0.12, 0.25, 0.12], [0, 0, Math.PI / 2], SURF.paintWorn));
    P.push(member([fx - 2.75, cyY - 0.85, fz], [fx - 2.75, top + 0.15, fz], 0.06, '#5A5E5A', SURF.steelRusty));
    P.push(member([fx - 2.75, top + 0.15, fz], [11.9, top - 0.75, -6.9], 0.06, '#5A5E5A', SURF.steelRusty));
    // pump cabinet: plinth, cabinet, cap, display, faded stencil band, holster, hose reel
    const pg = minG([[11, -7], [12.2, -7], [11, -5.8], [12.2, -5.8]]);
    P.push({ geometry: UNIT.box, color: C.concreteDark, position: [11.6, (pg - 0.2 + pg + 0.2) / 2, -6.4], scale: [1.5, 0.4, 1.1], surf: SURF.concreteStained, ground: pg });
    P.push({ geometry: UNIT.box, color: '#A9ADA6', position: [11.6, pg + 0.2 + 0.8, -6.4], scale: [1.1, 1.6, 0.7], surf: SURF.paintWorn, ground: pg + 0.2 });
    P.push(p(UNIT.box, '#3C403E', [11.6, pg + 1.85, -6.4], [1.25, 0.1, 0.85], null, SURF.steelWorn));
    P.push(p(UNIT.box, '#1D2226', [11.6, pg + 1.5, -6.04], [0.5, 0.3, 0.03], null, SURF.glass));
    P.push(p(UNIT.box, '#A65A36', [11.6, pg + 1.2, -6.4], [1.12, 0.12, 0.72], null, SURF.paintFaded));
    P.push(p(UNIT.box, '#1E2226', [12.17, pg + 1.0, -6.3], [0.08, 0.32, 0.14], null, SURF.rubber));
    P.push(p(UNIT.cyl12, '#2A2E33', [11.6, pg + 0.9, -5.85], [0.42, 0.36, 0.42], [Math.PI / 2, 0, 0], SURF.rubber));
    return P;
  }

  _jetty(gh, ja, jb) {
    const P = [];
    const dx = jb[0] - ja[0], dz = jb[1] - ja[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const jr = Math.atan2(dx, dz);
    const at = (s, u, y) => [ja[0] + ux * s + nx * u, y, ja[1] + uz * s + nz * u];
    const back = 4; // the shore end runs under the rock
    const top = 2.1;
    P.push(p(UNIT.box, C.jetty, at((len - back) / 2, 0, top - 0.2), [3.2, 0.4, len + back], [0, jr, 0], SURF.concreteWet));
    for (const s of [-1, 1]) P.push(p(UNIT.box, C.concreteDark, at((len - back) / 2, s * 1.48, top + 0.1), [0.24, 0.2, len + back], [0, jr, 0], SURF.concreteWet));
    this.piles = [];
    for (let s = 3; s <= len; s += 4) {
      const ss = Math.min(s, len - 0.4);
      if (gh(...at(ss, 0, 0).filter((_, k) => k !== 1)) > 1.2) continue; // still on the rock
      for (const u of [-1.2, 1.2]) {
        const [x, , z] = at(ss, u, 0);
        P.push(member([x, -3, z], [x, top - 0.4, z], 0.25, C.jetty, SURF.concreteWet, UNIT.cyl12));
        this.piles.push([this.x + x, this.z + z]);
      }
      P.push(p(UNIT.box, C.concreteDark, at(ss, 0, top - 0.55), [3.0, 0.35, 0.45], [0, jr, 0], SURF.concreteWet));
      for (const u of [-1.7, 1.7]) P.push(p(UNIT.box, '#1C1F20', at(ss, u, 1.1), [0.22, 1.9, 0.42], [0, jr, 0], SURF.rubber));
    }
    // seaward ladder down the head
    for (const u of [-0.25, 0.25]) P.push(member(at(len + 0.12, u, -1.2), at(len + 0.12, u, top + 0.9), 0.03, '#4E524E', SURF.steelRusty));
    for (let y = -1.0; y < top; y += 0.3) P.push(member(at(len + 0.12, -0.25, y), at(len + 0.12, 0.25, y), 0.02, '#4E524E', SURF.steelRusty));
    // bollards, cleat, rope coils
    for (const t of [0.3, 0.6, 0.88]) {
      P.push(p(UNIT.cyl12, '#26292A', at(len * t, 1.05, top + 0.3), [0.2, 0.6, 0.2], null, SURF.steelRusty));
      P.push(p(UNIT.cyl12, '#26292A', at(len * t, 1.05, top + 0.62), [0.28, 0.07, 0.28], null, SURF.steelRusty));
    }
    P.push(p(UNIT.box, '#26292A', at(len - 1.0, -1.0, top + 0.22), [0.7, 0.1, 0.16], [0, jr, 0], SURF.steelRusty));
    P.push(p(UNIT.box, '#26292A', at(len - 1.0, -1.0, top + 0.1), [0.2, 0.2, 0.14], [0, jr, 0], SURF.steelRusty));
    P.push(p(UNIT.torus, '#8B7B5A', at(len - 2.2, -0.7, top + 0.05), [0.36, 0.36, 0.5], [Math.PI / 2, 0, 0], SURF.fabric));
    P.push(p(UNIT.torus, '#7E7052', at(len * 0.45, -0.9, top + 0.05), [0.3, 0.3, 0.45], [Math.PI / 2, 0, 0], SURF.fabric));
    // harbour light on a post with a lantern housing
    const [hx, , hz] = at(len - 0.4, 1.0, 0);
    P.push(member([hx, top, hz], [hx, 5.3, hz], 0.07, '#2F5D45', SURF.paintWorn));
    P.push(p(UNIT.box, '#26292A', [hx, 5.38, hz], [0.32, 0.12, 0.32], null, SURF.steel));
    P.push(p(UNIT.cyl8, '#12FF6E', [hx, 5.6, hz], [0.13, 0.32, 0.13], null, emit(CH.NAV, 1.2)));
    P.push(p(UNIT.cone8, '#26292A', [hx, 5.88, hz], [0.22, 0.22, 0.22], null, SURF.steel));
    this.jettyHead = [hx, hz];
    return P;
  }

  _lamps() {
    const L = this.W.lamps;
    const x = this.x, z = this.z;
    // perimeter (green) — 2 per octagon side, on their housings inside the deck edge
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      L.add(x + Math.cos(a) * PERIM_R, DECK_Y + 0.14, z + Math.sin(a) * PERIM_R, '#3CFF7A', { gain: 3, bulb: 0.14, halo: 0.7, ch: CH.PERIM });
    }
    // pad floods
    L.add(x - 9.5, DECK_Y + 1.0, z + 9.29, '#FFE6B0', { gain: 3, bulb: 0.2, halo: 1.6, ch: CH.PADLIGHT });
    L.add(x + 9.5, DECK_Y + 1.0, z - 9.29, '#FFE6B0', { gain: 3, bulb: 0.2, halo: 1.6, ch: CH.PADLIGHT });
    // lantern: a modest soft core — the beam and its flash carry the lighthouse, not a bloom disc
    this.lanternLamp = L.add(x + TOWER.x, LANTERN_Y, z + TOWER.z, '#FFF4DC', { gain: 2.2, bulb: 1.0, halo: 3.6, ch: CH.LANTERN, pen: 0.75 });
    // tower porch light, radio mast obstruction light, house porch light, walkway bollards, jetty head
    L.add(this.doorLamp[0], this.doorLamp[1], this.doorLamp[2], '#FFE2B0', { gain: 2.5, bulb: 0.16, halo: 1.3, ch: CH.PADLIGHT });
    L.add(x + 22, 26.8, z - 31, '#FF2015', { gain: 5, bulb: 0.2, halo: 2.2, ch: CH.ANTI, pen: 0.4 });
    L.add(this.porchLamp[0], this.porchLamp[1], this.porchLamp[2], '#FFC98A', { gain: 2.5, bulb: 0.14, halo: 1.4, ch: CH.WINDOWS });
    for (const [wx, wy, wz] of this.walkLamps) L.add(wx, wy, wz, '#FFD9A0', { gain: 2, bulb: 0.1, halo: 1.0, ch: CH.PADLIGHT });
    L.add(x + this.jettyHead[0], 5.6, z + this.jettyHead[1], '#12FF6E', { gain: 4, bulb: 0.16, halo: 1.6, ch: CH.NAV, pen: 0.3 });
    // offload lights (blue) at the deck's four diagonal corners — channel set by the world
    this.unloadLamps = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.unloadLamps.push(L.add(x + Math.cos(a) * (PAD_R + 0.6), DECK_Y + 0.25, z + Math.sin(a) * (PAD_R + 0.6), '#4FA3FF', { gain: 4, bulb: 0.2, halo: 1.4, ch: CH.UNLOAD0 }));
    }
  }

  // Unload light channel for this pad (blue cascade while the heli unloads here).
  setUnloadChannel(ch) {
    const L = this.W.lamps;
    for (const i of this.unloadLamps) if (i >= 0) L.iSz.array[i * 4 + 2] = ch;
    L.iSz.needsUpdate = true;
  }

  // --------------------------------------------------------------------------------------------
  update(dt, env) {
    const W = this.W;
    const ctx = W.ctx;
    // `hold` (debug / screenshots): freeze the beam at a given angle
    this.angle = Number.isFinite(this.hold) ? this.hold : (this.angle + (dt * Math.PI * 2) / PERIOD) % (Math.PI * 2);
    this.beam.rotation.y = this.angle;

    // The light works at night and in poor visibility (fog, heavy rain).
    const on = clamp(Math.max(env.night * 1.15, env.fogK * 1.2, smoothstep(4000, 1200, env.visibility), 0.35 * env.rain), 0, 1);
    this.on = on;
    const mat = W.mats.beam;
    mat.uniforms.uIntensity.value = on * (0.42 + 0.6 * env.fogK);
    mat.uniforms.uDensity.value = 0.03 + 0.07 * env.rain + 0.16 * env.fogK; // fog scatters more, stays translucent
    mat.uniforms.uPen.value = 0.45 + 0.4 * env.fogK;
    mat.uniforms.uFall.value = 1.7;

    // Beam directions (world): +X rotated by angle about Y → (cos a, 0, −sin a); twin = opposite.
    const bx = Math.cos(this.angle), bz = -Math.sin(this.angle);
    // Flash of the lantern when a beam swings across the viewer (camera position, horizontal).
    const cam = env.camPos;
    const vx = cam.x - this.lantern.x, vz = cam.z - this.lantern.z;
    const vl = Math.hypot(vx, vz) || 1;
    const facing = Math.abs((bx * vx + bz * vz) / vl);
    const flash = Math.pow(facing, 40) * (env.reduceFlashes ? 0.35 : 1);
    // daylight: the lamp is off behind its lens (a faint glint only); lit: a modest steady core that
    // flares only while a beam swings across the viewer (one dominant light per frame, §2.1)
    W.channels[CH.LANTERN] = Math.max(W.channels[CH.LANTERN], 0.03 + on * (0.4 + 1.5 * flash));
    setGlow(this.material, 0, TOWER.x, LANTERN_Y, TOWER.z, 5, GLOW.lamp, on * (0.45 + 0.9 * flash));
    setGlow(this.material, 1, 0, DECK_Y + 3, 0, 13, GLOW.flood, 0.22 * W.channels[CH.PADLIGHT]);
    // base floods at the tower foot: the light dies out ~10 m up, so the upper shaft stays dim and
    // the lantern remains the one bright point of the island
    setGlow(this.material, 2, TOWER.x, 10.5, TOWER.z + 5.5, 6.5, GLOW.lamp, 0.6 * W.channels[CH.PADLIGHT]);
    // the same floods / windows spill onto the rock round them (terrain material, world space)
    const pl = W.channels[CH.PADLIGHT];
    setTerrainGlow(0, this.x, DECK_Y, this.z, 21, GLOW.flood, 0.9 * pl);
    setTerrainGlow(1, this.x + TOWER.x, 12, this.z + TOWER.z + 3, 12, GLOW.lamp, 0.8 * pl);
    setTerrainGlow(2, this.x + 13, 10, this.z - 22.5, 7, GLOW.window, 0.45 * W.channels[CH.WINDOWS]);
    setTerrainGlow(3, this.x + this.jettyHead[0], 3, this.z + this.jettyHead[1], 7, GLOW.nav, 0.3 * W.channels[CH.NAV]);

    // SpotLight: sweep the sea with whichever beam faces the heli; the swap happens at zero.
    const spot = W.lights.spot;
    if (spot && !W.spotOwner) {
      W.spotOwner = this;
      const hp = env.heliPos;
      const hx = hp.x - this.lantern.x, hz = hp.z - this.lantern.z;
      const hl = Math.hypot(hx, hz) || 1;
      const c = (bx * hx + bz * hz) / hl;
      const sgn = c >= 0 ? 1 : -1;
      const reach = 260;
      spot.position.copy(this.lantern);
      W.lights.spotTarget.position.set(this.lantern.x + sgn * bx * reach, 0, this.lantern.z + sgn * bz * reach);
      W.lights.spotTarget.updateMatrixWorld();
      spot.intensity = on * smoothstep(0.05, 0.4, Math.abs(c)) * (32000 + 26000 * env.fogK) * (0.6 + 0.4 * env.night);
    }

    // Jetty piles break the swell: small foam collars round each pile at the live waterline.
    const ocean = ctx.ocean;
    if (ocean && W.collars) {
      for (let i = 0; i < this.piles.length; i++) {
        const [px, pz] = this.piles[i];
        W.collars.push(px, ocean.heightAt(px, pz), pz, 0, 1, 0, 0.42, 0.75, 0.25, 0, i * 0.37);
      }
    }

    // Windsock on the pad.
    const w = env.windAt(this.hoop.x, this.hoop.z);
    this.windsock.update(W.rigging, this.hoop, w.x, w.y, env.t, dt);

    // Foghorn every 30 s in fog (audio plays it; radio line c_light announces it).
    if (env.fogK > 0.45 && dt > 0) {
      this.fogT += dt;
      if (this.fogT >= 30) {
        this.fogT = 0;
        ctx.events.emit('world:foghorn', { x: this.lantern.x, z: this.lantern.z });
      }
    } else this.fogT = Math.min(this.fogT, 26);
  }

  dispose() {
    this.group.removeFromParent();
    this.land.dispose();
    for (let i = 0; i < 4; i++) setTerrainGlow(i, 0, -1e4, 0, 1, this.W._col.set(0, 0, 0), 0);
    this.mesh.geometry.dispose();
    this.beam.geometry.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}
