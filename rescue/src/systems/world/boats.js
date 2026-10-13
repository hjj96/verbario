// Scenery vessels from def.world.props.boats (DESIGN §1, §3.14): the coast-guard cutter
// «Сторож-7» (patrols slowly, blue flasher), the trawler «Кильдин» aground on the Кошки rocks
// (listing, deck lights flickering, surf breaking on its hull) and the cargo ship «Полярный ветер»
// with gaps in its container stacks. They bob like the Арктур (three ocean samples), wear foam
// collars, carry navigation lights and their superstructures are obstacles.
import * as THREE from 'three';
import { bake, p, member, hullGeometry, deckGeometry, windowParts, latticeParts, rng, UNIT, SURF } from './geo.js';
import { CH } from './materials.js';
import { VesselMotion, Navigator } from './vessel.js';
import { clamp, smoothstep } from '../../core/math.js';

const SIDES = [-1, 1]; // reused in per-frame loops (no array literal per frame)
const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function patrolParts() {
  const L = 34, B = 7;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 2.6, deckFwd: 3.6, keel: 2.2, bowStart: 0.55, rake: 3, stations: 16, topside: '#3E4850', antifoul: '#5B2622', boot: '#E6E6E0', stripe: '#1F5E8C', stripeAt: 0.7 });
  const P = [{ geometry: hull.geometry, vcol: true, surf: SURF.paint }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 0.6, 0.2, 14), color: '#5A605C', surf: [0.8, 0, 0, 0] });
  P.push(p(UNIT.box, '#E6E6E0', [0, 4.4, -2], [5.6, 2.6, 9], null, SURF.paint));
  P.push(p(UNIT.box, '#E6E6E0', [0, 6.6, -4], [5.0, 1.8, 4], null, SURF.paint));
  P.push(...windowParts([0, 6.6, -4], [5.0, 1.8, 4], 'z-', { cols: 4, w: 0.9, h: 0.7, ch: CH.DIM, color: '#9FB8C8', gain: 0.8 }));
  P.push(...windowParts([0, 4.4, -2], [5.6, 2.6, 9], 'x+', { cols: 5, w: 0.7, h: 0.5, ch: CH.WINDOWS, color: '#FFC98A' }));
  P.push(...windowParts([0, 4.4, -2], [5.6, 2.6, 9], 'x-', { cols: 5, w: 0.7, h: 0.5, ch: CH.WINDOWS, color: '#FFC98A' }));
  P.push(member([0, 7.5, -4], [0, 13, -4], 0.12, '#B9BDB9'));
  P.push(member([-1.4, 11.5, -4], [1.4, 11.5, -4], 0.06, '#B9BDB9'));
  P.push(p(UNIT.box, '#1F5E8C', [0, 7.55, -4], [5.1, 0.12, 4.1], null, SURF.paint));
  // RIB on the aft deck, gun-grey deck boxes
  for (const s of [-1, 1]) P.push(p(UNIT.cyl8, '#FF6A13', [s * 0.8, 3.3, 10], [0.35, 4.5, 0.35], [Math.PI / 2, 0, 0], SURF.rubber));
  P.push(p(UNIT.box, '#5C6670', [0, 3.2, 5.5], [3, 0.8, 2], null, SURF.steel));
  return { parts: P, L, B, lights: [[0, 13.2, -4, '#FFFFFF', CH.NAV], [-2.6, 7.2, -5.5, '#FF2015', CH.NAV], [2.6, 7.2, -5.5, '#12FF6E', CH.NAV], [0, 12.2, -4, '#4FA3FF', CH.BLUE], [0, 3.6, L / 2, '#FFFFFF', CH.NAV]], obstacle: [0, -3, 5, 13.5] };
}

function trawlerParts() {
  const L = 44, B = 10;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 3.4, deckFwd: 5.2, keel: 3.0, bowStart: 0.6, rake: 4, stations: 16, topside: '#6B3A2A', antifoul: '#1E2226', boot: '#E6E6E0', stripe: null });
  const P = [{ geometry: hull.geometry, vcol: true, surf: [0.7, 0.1, 0, 0] }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 0.6, 0.25, 14), color: '#4A4440', surf: [0.85, 0, 0, 0] });
  P.push(p(UNIT.box, '#E6E6E0', [0, 6.2, -9], [7, 3.4, 8], null, SURF.paint));
  P.push(p(UNIT.box, '#E6E6E0', [0, 8.8, -10], [5.6, 1.9, 4.4], null, SURF.paint));
  P.push(...windowParts([0, 8.8, -10], [5.6, 1.9, 4.4], 'z-', { cols: 4, w: 0.9, h: 0.7, ch: CH.BOAT, color: '#FFE2B0', gain: 0.7 }));
  P.push(member([0, 9.8, -10], [0, 16, -10], 0.14, '#B9BDB9'));
  // stern gantry (A-frame), net drum, trawl boards
  P.push(member([-4, 3.6, 18], [-1.5, 11, 19], 0.3, '#B5562A', SURF.rust));
  P.push(member([4, 3.6, 18], [1.5, 11, 19], 0.3, '#B5562A', SURF.rust));
  P.push(member([-1.6, 11, 19], [1.6, 11, 19], 0.3, '#B5562A', SURF.rust));
  P.push(p(UNIT.cyl12, '#2F4A3A', [0, 4.8, 11], [1.3, 6, 1.3], [0, 0, Math.PI / 2], SURF.rubber));
  for (const s of [-1, 1]) P.push(p(UNIT.box, '#3A3E42', [s * 5.1, 4.6, 14], [0.3, 2.0, 3.2], null, SURF.rust));
  P.push(p(UNIT.box, '#6E7378', [0, 4.2, 2], [4, 1.2, 4], null, SURF.steel));
  return { parts: P, L, B, lights: [[0, 16.2, -10, '#FFFFFF', CH.BOAT], [0, 7.8, 4, '#FFE2B0', CH.BOAT], [-3.6, 9, -8, '#FF2015', CH.BOAT], [3.6, 9, -8, '#12FF6E', CH.BOAT]], obstacle: [0, -9, 6.5, 16.5] };
}

function cargoParts(seed) {
  const L = 140, B = 21;
  const hull = hullGeometry({ length: L, beam: B, deckAft: 9, deckFwd: 11.5, keel: 6, bowStart: 0.72, rake: 9, stations: 28, transom: 0.9, topside: '#22303A', antifoul: '#5B2622', boot: '#E6E6E0', stripe: null });
  const P = [{ geometry: hull.geometry, vcol: true, surf: SURF.paint }];
  P.push({ geometry: deckGeometry(hull, L / 2 - 0.2, -L / 2 + 1, 0.3, 30), color: '#5A3A30', surf: [0.85, 0, 0, 0] });
  // aft accommodation (white, 5 decks), bridge wings, funnel
  P.push(p(UNIT.box, '#E6E6E0', [0, 16, 52], [17, 14, 11], null, SURF.paint));
  P.push(p(UNIT.box, '#E6E6E0', [0, 24, 50], [23, 2.4, 6], null, SURF.paint));
  for (const y of [11, 14, 17, 20]) P.push(...windowParts([0, 16, 52], [17, 14, 11], 'z-', { cols: 8, w: 1.1, h: 0.8, ch: CH.WINDOWS, color: '#FFC98A', y0: y }));
  P.push(...windowParts([0, 24, 50], [23, 2.4, 6], 'z-', { cols: 10, w: 1.4, h: 1, ch: CH.DIM, color: '#9FB8C8', gain: 0.8 }));
  P.push(p(UNIT.box, '#2E3338', [0, 27, 60], [5, 7, 6], null, SURF.paint));
  P.push(p(UNIT.box, '#B3261E', [0, 29.6, 60], [5.1, 1.2, 6.1], null, SURF.paint));
  P.push(member([0, 25.2, 49], [0, 36, 49], 0.25, '#B9BDB9'));
  // container stacks with gaps (lost overboard), two deck cranes
  const r = rng(seed);
  const cols = ['#B3412E', '#1F5E8C', '#2F7D4F', '#C9A227', '#6E7378', '#8C3B2E'];
  for (let bay = 0; bay < 9; bay++) {
    const z = -52 + bay * 10.5;
    for (let row = -3; row <= 3; row++) {
      const lost = bay > 2 && bay < 7 && Math.abs(row) < 3 && r() < 0.45;
      const tiers = lost ? Math.floor(r() * 2) : 2 + Math.floor(r() * 3);
      for (let t = 0; t < tiers; t++) {
        P.push(p(UNIT.box, cols[Math.floor(r() * cols.length)], [row * 2.5, 12.2 + t * 2.6, z], [2.42, 2.55, 6.0], [0, 0, (r() - 0.5) * (lost ? 0.12 : 0.01)], SURF.paint));
      }
    }
  }
  for (const z of [-30, 10]) {
    P.push(p(UNIT.cyl12, '#C9A227', [-8.5, 16, z], [1.2, 9, 1.2], null, SURF.paint));
    P.push(...latticeParts([-8.5, 20, z], [4, 33, z - 10], 0.7, 0.3, '#C9A227', { bays: 6, r: 0.12, brace: 0.05 }));
  }
  return { parts: P, L, B, lights: [[0, 36.2, 49, '#FFFFFF', CH.BOAT], [0, 18, -66, '#FFFFFF', CH.BOAT], [-11.6, 24.5, 48, '#FF2015', CH.BOAT], [11.6, 24.5, 48, '#12FF6E', CH.BOAT], [0, 22, 30, '#FFE2B0', CH.FLOOD], [0, 22, -10, '#FFE2B0', CH.FLOOD]], obstacle: [0, 52, 12, 37] };
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
      this.group.position.set(nav.x, 0.8, nav.z);
      this.group.rotation.set(3 * DEG + 0.4 * DEG * Math.sin(this.W.env.t * 0.4), -nav.heading, -13 * DEG, 'YXZ');
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
        this.flick = 2.5 + 3 * Math.abs(Math.sin(env.t * 1.7));
        _v.set(this.B * 0.5, 0, (Math.sin(env.t) * 0.4) * this.L).applyMatrix4(m);
        ocean.splash?.(_v.x, _v.z, 4, 0.7);
        Wd.ctx.fx?.splash?.(_v.x, 1, _v.z, 4);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
