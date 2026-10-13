// Lighthouse «Скалистый» (DESIGN §2.11 [MUST], §3.9, catalogue #31, #43): the start pad.
// Island of displaced icosahedra #2E3437 with surf (ocean.setShoals), white tower with red bands
// #B3261E, lantern room, keeper's house, fuel tank, jetty, radio mast; helipad at 12 m with a
// painted deck; rotating DOUBLE beam (8 s per turn) = additive volumetric cones + the world's one
// SpotLight sweeping the sea; "solid" in fog; windsock on the pad; foghorn every 30 s in fog.
import * as THREE from 'three';
import { bake, p, member, railParts, rockGeometry, windowParts, latticeParts, UNIT, SURF, emit } from './geo.js';
import { CH, createPropMaterial, beamGeometry, setGlow } from './materials.js';
import { paintHelideck, decalTexture } from './decals.js';
import { Windsock } from './rigging.js';
import { clamp, smoothstep } from '../../core/math.js';

const DECK_Y = 12;
const PAD_R = 12.3; // octagon corner radius of the deck
const TOWER = { x: -9, z: -27 };
const LANTERN_Y = 38.3;
const BEAM_LEN = 680;
const PERIOD = 8; // s per revolution

const C = {
  white: '#ECEBE6',
  red: '#B3261E',
  dark: '#2E3338',
  roof: '#8C2A22',
  concrete: '#8C908C',
  concreteDark: '#6E7370',
  glass: '#FFF1CF',
  window: '#FFC98A',
  steel: '#5C6670',
};

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
    this.material = createPropMaterial(W.look, W.shared, { decal: this.decal, name: 'lighthouse' });
    this.mesh = new THREE.Mesh(bake(W.look, this._parts()), this.material);
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
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._lamps();

    // gameplay data
    this.padPosition = new THREE.Vector3(this.x, DECK_Y, this.z);
    this.padRadius = 10.5;
    this.lantern = new THREE.Vector3(this.x + TOWER.x, LANTERN_Y, this.z + TOWER.z);
    this.obstacles = [
      { x: this.x + TOWER.x, z: this.z + TOWER.z, radius: 5, top: LANTERN_Y + 3, kind: 'tower', name: 'маяк' },
      { x: this.x + 22, z: this.z - 31, radius: 1.8, top: 27, kind: 'mast', name: 'мачта' },
    ];
    this.shoals = [{ x: this.x - 9, z: this.z - 17, radius: 32 }, { x: this.x + 20, z: this.z - 20, radius: 16 }];
    this.island = { x: this.x - 6, z: this.z - 17, radius: 26, top: 10.5, kind: 'rock', name: 'скалы' };
    this.obstacles.push(this.island);
    // lantern light spill on the gallery & tower top, house windows on the rock
    setGlow(this.material, 0, TOWER.x, LANTERN_Y, TOWER.z, 5, new THREE.Color('#FFE2B0'), 0);
    setGlow(this.material, 1, 0, DECK_Y + 4, 0, 14, new THREE.Color('#FFE6B0'), 0);
  }

  // --------------------------------------------------------------------------------------------
  _parts() {
    const P = [];
    // --- island: a pile of faceted rocks (fixed seeds: the island is a landmark, always the same)
    const rocks = [
      // x, z, rx, h, rz, seed, rotY, moss
      [-9, -18, 36, 11.4, 27, 11, 0.3, 0.9],
      [-34, -4, 14, 7.0, 11, 12, 1.1, 0.6],
      [12, -38, 16, 7.8, 12, 13, 2.2, 0.6],
      [-30, -40, 11, 5.2, 10, 14, 0.7, 0.3],
      [20, 4, 10, 5.0, 8, 16, 1.7, 0.3],
      [4, 15, 9, 3.2, 7, 17, 0.2, 0],
      [29, -18, 10, 6.0, 9, 18, 2.4, 0.4],
      [-16, 12, 8, 3.6, 8, 19, 1.3, 0],
      [-47, -24, 7, 2.6, 6, 15, 2.9, 0],
      [40, 0, 5, 1.8, 4, 20, 0.9, 0],
      [-50, 2, 5, 1.6, 4, 21, 2.0, 0],
      [-8, 30, 4, 1.4, 3, 22, 0.4, 0],
      [33, -42, 5, 2.0, 4, 23, 1.6, 0],
    ];
    for (const [x, z, rx, h, rz, seed, ry, moss] of rocks) {
      P.push({ geometry: rockGeometry(seed, { detail: 2, moss, terrace: rx > 12 ? 0.7 : 0.45 }), vcol: true, position: [x, 0, z], scale: [rx, h, rz], rotation: [0, ry, 0], surf: SURF.rock });
    }

    // --- helipad: concrete octagon on a plinth, painted deck, safety net
    P.push(p(UNIT.oct, C.concreteDark, [0, 7.4, 0], [PAD_R, 9.2, PAD_R], null, SURF.concrete));
    P.push({ geometry: new THREE.CircleGeometry(PAD_R, 8, Math.PI / 8).rotateX(-Math.PI / 2), color: '#FFFFFF', position: [0, DECK_Y + 0.02, 0], surf: SURF.decal, uvRect: [0, 0, 1, 1] });
    P.push({ geometry: new THREE.RingGeometry(PAD_R, PAD_R + 1.4, 8, 1, Math.PI / 8).rotateX(-Math.PI / 2), color: '#23282C', position: [0, DECK_Y - 0.25, 0], surf: SURF.rubber });
    // net frame posts
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      P.push(member([Math.cos(a) * PAD_R, DECK_Y - 0.1, Math.sin(a) * PAD_R], [Math.cos(a) * (PAD_R + 1.4), DECK_Y - 0.3, Math.sin(a) * (PAD_R + 1.4)], 0.07, C.steel));
    }
    // walkway to the tower (steps down the rock) + white railing
    const walk = [[-4, -12.5, 11.7], [-6, -16.5, 11.2], [-7.5, -20.5, 10.6]];
    for (const [x, z, y] of walk) P.push(p(UNIT.box, C.concrete, [x, y - 0.6, z], [2.6, 1.2, 4.2], [0, 0.35, 0], SURF.concrete));
    P.push(...railParts([[-2.4, -12], [-4.6, -17], [-6.2, -22]], 11.2, 1.0, C.white, { post: 1.8, r: 0.04 }));

    // --- tower: plinth, banded tapered shaft, door, slit windows, gallery, lantern, roof
    const tx = TOWER.x, tz = TOWER.z;
    P.push(p(UNIT.cyl20, C.concrete, [tx, 6.5, tz], [5.4, 8, 5.4], null, SURF.concrete));
    const y0 = 10.5, y1 = 36;
    const rAt = (y) => 4.3 - ((y - y0) / (y1 - y0)) * 1.25;
    const bands = [
      [y0, 15.5, C.white],
      [15.5, 19.5, C.red],
      [19.5, 25, C.white],
      [25, 29, C.red],
      [29, 33.2, C.white],
      [33.2, y1, C.red],
    ];
    for (const [a, b, col] of bands) {
      const g = new THREE.CylinderGeometry(rAt(b), rAt(a), b - a, 24, 1, true);
      P.push({ geometry: g, color: col, position: [tx, (a + b) / 2, tz], surf: SURF.paint });
    }
    P.push(p(UNIT.box, '#1E2226', [tx, y0 + 1.3, tz + rAt(y0 + 1.3) - 0.05], [1.3, 2.4, 0.3], null, SURF.steel)); // door (south)
    for (const y of [17.5, 23, 28.5]) {
      P.push(p(UNIT.box, '#14181B', [tx + 0.6, y, tz + rAt(y) - 0.02], [0.45, 1.0, 0.2], null, emit(CH.WINDOWS, 0.6)));
    }
    // gallery + railing
    P.push(p(UNIT.cyl20, C.dark, [tx, y1 + 0.18, tz], [4.7, 0.36, 4.7], null, SURF.steel));
    const ring = [];
    for (let i = 0; i < 16; i++) ring.push([tx + Math.cos((i / 16) * Math.PI * 2) * 4.5, tz + Math.sin((i / 16) * Math.PI * 2) * 4.5]);
    P.push(...railParts(ring, y1 + 0.36, 1.05, C.dark, { loop: true, post: 1.8, r: 0.05 }));
    // lantern room: glowing glass + mullions + red cupola + vent ball + lightning rod
    P.push(p(UNIT.cyl20, C.dark, [tx, y1 + 0.75, tz], [2.5, 0.8, 2.5], null, SURF.steel));
    P.push(p(UNIT.cyl20, C.glass, [tx, LANTERN_Y, tz], [2.25, 3.2, 2.25], null, emit(CH.LANTERN, 2.2, 0.06)));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      P.push(p(UNIT.box, C.dark, [tx + Math.cos(a) * 2.27, LANTERN_Y, tz + Math.sin(a) * 2.27], [0.12, 3.2, 0.12], [0, -a, 0], SURF.steel));
    }
    P.push(p(UNIT.cone16, C.roof, [tx, LANTERN_Y + 2.45, tz], [2.75, 1.7, 2.75], null, SURF.gloss));
    P.push(p(UNIT.sphereLo, C.dark, [tx, LANTERN_Y + 3.5, tz], 0.45, null, SURF.steel));
    P.push(member([tx, LANTERN_Y + 3.5, tz], [tx, LANTERN_Y + 5.2, tz], 0.04, C.dark));

    // --- keeper's house (white, red gable roof, warm windows), shed, chimney
    const hx = 13, hz = -27;
    P.push(p(UNIT.box, C.concrete, [hx, 7.5, hz], [11, 5, 7.4], null, SURF.concrete));
    P.push(p(UNIT.box, C.white, [hx, 11.6, hz], [10, 3.4, 6.2], null, SURF.paint));
    P.push(p(UNIT.prism, C.roof, [hx, 13.3, hz], [10.8, 2.2, 7.0], null, SURF.gloss));
    P.push(p(UNIT.box, '#7A7E7C', [hx + 3, 15, hz - 1], [0.8, 2.2, 0.8], null, SURF.concrete));
    P.push(...windowParts([hx, 11.6, hz], [10, 3.4, 6.2], 'z+', { cols: 4, w: 1.1, h: 1.1, ch: CH.WINDOWS, color: C.window }));
    P.push(...windowParts([hx, 11.6, hz], [10, 3.4, 6.2], 'x+', { cols: 2, w: 1.1, h: 1.1, ch: CH.WINDOWS, color: C.window }));
    P.push(p(UNIT.box, '#9A9E9B', [hx - 8.2, 10.6, hz + 2.5], [3.4, 2.4, 3], null, SURF.paint)); // shed
    // radio mast with guy wires (red light on top)
    P.push(...latticeParts([22, 9, -31], [22, 26.5, -31], 0.55, 0.25, '#B9BDB9', { bays: 7, r: 0.05, brace: 0.03 }));
    P.push(member([22, 24, -31], [30, 8, -38], 0.025, '#7A7E7C'));
    P.push(member([22, 24, -31], [16, 8, -40], 0.025, '#7A7E7C'));
    P.push(member([22, 24, -31], [26, 7, -20], 0.025, '#7A7E7C'));

    // --- fuel station: white tank on a cradle + pump cabinet (orange stencil) + hose reel
    P.push(p(UNIT.box, C.concrete, [15, 9.6, -8.5], [6.6, 1.4, 3.6], null, SURF.concrete));
    P.push(p(UNIT.cyl20, '#E6E6E0', [15, 11.7, -8.5], [1.35, 5, 1.35], [0, 0, Math.PI / 2], SURF.gloss));
    P.push(p(UNIT.box, '#C9A227', [15, 11.7, -8.5], [0.4, 2.75, 2.75], null, SURF.paint)); // band
    P.push(p(UNIT.box, '#B9BDB9', [11.6, 11.2, -6.4], [1.2, 1.8, 0.8], null, SURF.paint));
    P.push(p(UNIT.cyl12, '#2A2E33', [11.6, 11.2, -5.8], [0.5, 0.4, 0.5], [Math.PI / 2, 0, 0], SURF.rubber));

    // --- windsock mast at the pad edge
    P.push(member([10.4, 3, 7.6], [10.4, DECK_Y + 4.8, 7.6], 0.11, '#D8D8D2', SURF.paint));
    P.push(p(UNIT.torus, '#2A2E33', [10.4, DECK_Y + 4.6, 7.6], 0.5, [Math.PI / 2, 0, 0], SURF.steel));
    // pad flood posts
    for (const [x, z] of [[-9.5, 9.5], [9.5, -9.5]]) {
      P.push(member([x, DECK_Y - 0.2, z], [x, DECK_Y + 0.9, z], 0.08, C.dark));
      P.push(p(UNIT.box, '#FFE6B0', [x, DECK_Y + 1.0, z], [0.5, 0.35, 0.35], null, emit(CH.PADLIGHT, 2)));
    }

    // --- jetty from the eastern rocks toward deep water: bollards, mooring ladder, harbour light
    const ja = [23, 9], jb = [33, 25];
    const jl = Math.hypot(jb[0] - ja[0], jb[1] - ja[1]);
    const jr = Math.atan2(jb[0] - ja[0], jb[1] - ja[1]);
    P.push(p(UNIT.box, C.concrete, [(ja[0] + jb[0]) / 2, 1.0, (ja[1] + jb[1]) / 2], [3.2, 2.2, jl], [0, jr, 0], SURF.concrete));
    for (const t of [0.25, 0.55, 0.85]) {
      const jx = ja[0] + (jb[0] - ja[0]) * t, jz = ja[1] + (jb[1] - ja[1]) * t;
      P.push(p(UNIT.cyl8, '#1E2226', [jx + Math.cos(jr) * 1.2, 2.4, jz - Math.sin(jr) * 1.2], [0.22, 0.6, 0.22], null, SURF.steel));
    }
    P.push(member([jb[0], 2.1, jb[1]], [jb[0], 5.6, jb[1]], 0.1, '#2F7D4F'));
    this.jettyHead = jb;
    return P;
  }

  _lamps() {
    const L = this.W.lamps;
    const x = this.x, z = this.z;
    // perimeter (green) — 2 per octagon side
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      L.add(x + Math.cos(a) * (PAD_R - 0.25), DECK_Y + 0.12, z + Math.sin(a) * (PAD_R - 0.25), '#3CFF7A', { gain: 3, bulb: 0.17, halo: 0.8, ch: CH.PERIM });
    }
    // pad floods
    L.add(x - 9.5, DECK_Y + 1.05, z + 9.5, '#FFE6B0', { gain: 3, bulb: 0.22, halo: 1.8, ch: CH.PADLIGHT });
    L.add(x + 9.5, DECK_Y + 1.05, z - 9.5, '#FFE6B0', { gain: 3, bulb: 0.22, halo: 1.8, ch: CH.PADLIGHT });
    // lantern (big soft core, punches through fog)
    this.lanternLamp = L.add(x + TOWER.x, LANTERN_Y, z + TOWER.z, '#FFF4DC', { gain: 3.5, bulb: 1.4, halo: 6, ch: CH.LANTERN, pen: 0.75 });
    // radio mast obstruction light, house porch light, walkway lights, jetty head (green)
    L.add(x + TOWER.x + 1.5, 11.2, z + TOWER.z + 5.8, '#FFE2B0', { gain: 2.5, bulb: 0.18, halo: 1.4, ch: CH.PADLIGHT });
    L.add(x + 22, 26.8, z - 31, '#FF2015', { gain: 5, bulb: 0.2, halo: 2.2, ch: CH.ANTI, pen: 0.4 });
    L.add(x + 13, 12.6, z - 23.4, '#FFC98A', { gain: 2.5, bulb: 0.15, halo: 1.6, ch: CH.WINDOWS });
    for (const [wx, wz, wy] of [[-2.6, -13, 12.4], [-5, -18.5, 11.9], [-6.4, -23, 11.4]]) {
      L.add(x + wx, wy, z + wz, '#FFD9A0', { gain: 2, bulb: 0.12, halo: 1.2, ch: CH.PADLIGHT });
    }
    L.add(x + this.jettyHead[0], 5.8, z + this.jettyHead[1], '#12FF6E', { gain: 4, bulb: 0.18, halo: 1.8, ch: CH.NAV, pen: 0.3 });
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
    mat.uniforms.uIntensity.value = on * (0.42 + 0.9 * env.fogK);
    mat.uniforms.uDensity.value = 0.03 + 0.07 * env.rain + 0.3 * env.fogK;
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
    W.channels[CH.LANTERN] = Math.max(W.channels[CH.LANTERN], (0.25 + 0.75 * on) * (0.55 + 1.6 * flash));
    setGlow(this.material, 0, TOWER.x, LANTERN_Y, TOWER.z, 5.5, W._col.set('#FFE2B0'), on * (0.6 + 1.2 * flash));
    setGlow(this.material, 1, 0, DECK_Y + 3, 0, 13, W._col.set('#FFE6B0'), 0.22 * W.channels[CH.PADLIGHT]);
    // the tower is floodlit from its base at night: the striped landmark stays readable
    setGlow(this.material, 2, TOWER.x, 17, TOWER.z + 5, 11, W._col.set('#FFE2B0'), 0.55 * W.channels[CH.PADLIGHT]);

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
    this.mesh.geometry.dispose();
    this.beam.geometry.dispose();
    this.material.dispose();
    this.decal.dispose();
  }
}
