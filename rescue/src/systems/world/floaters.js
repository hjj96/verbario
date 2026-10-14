// Floating props (DESIGN §2.11, catalogue #45): debris fields (planks, barrels, life rings,
// canisters, kayaks, paddles, luggage, a torn sail, net-float chains, fish boxes, fenders),
// drifting containers (#B3412E / #1F5E8C / #2F7D4F / #C9A227) as scenery, buoys with their real
// light rhythms (cardinal marks, isolated danger, regatta marks) and — in one container field out
// of twenty — 300 rubber ducks. Everything bobs on ocean.heightAt / normalAt with lag, drifts with
// current + leeway, and gets a foam collar + dark contact disc (§2.7.2).
//
// One InstancedMesh per shape (only the shapes the mission uses are visible). No ink keylines (one
// realistic style): contact foam, the dark contact disc, rim light and weathering separate them.
// Containers share the survivors' container model and craft material (one container in the game).
import * as THREE from 'three';
import { bake, p, member, rng, UNIT, SURF, emit } from './geo.js';
import { CH } from './materials.js';
import { containerGeometry, createCraftMaterial, containerPaint, CONT } from '../survivors/craft.js';
import { WEAR } from '../../core/weathering.js';

const SIDES = [-1, 1];

// --------------------------------------------------------------------------------------------
// Shapes: geometry parts centred at the waterline (y = 0), long axis along X. `y` = vertical
// offset of the instance (draft), `R` = collar radius (0 = none), `tint` = per-instance colours.
const W = '#FFFFFF';
const SHAPES = {
  plank: {
    k: 1.1,
    parts: () => [p(UNIT.box, W, [0, 0, 0], [3.0, 0.14, 0.3], null, SURF.wood)],
    y: -0.02, R: 0.9, tint: ['#6B5A45', '#7A6248', '#5A4C3C', '#8C3B2E', '#4E5A52'], leeway: 0.025,
  },
  barrel: {
    k: 1.15,
    parts: () => [
      p(UNIT.cyl12, W, [0, 0, 0], [0.31, 0.9, 0.31], [0, 0, Math.PI / 2], SURF.paint),
      p(UNIT.cyl12, '#555555', [-0.3, 0, 0], [0.325, 0.05, 0.325], [0, 0, Math.PI / 2], SURF.steel),
      p(UNIT.cyl12, '#555555', [0.3, 0, 0], [0.325, 0.05, 0.325], [0, 0, Math.PI / 2], SURF.steel),
    ],
    y: -0.06, R: 0.6, tint: ['#1F5E8C', '#B3412E', '#2F7D4F', '#6B3A2A', '#C9A227'], leeway: 0.03,
  },
  ring: {
    k: 1.15,
    parts: () => {
      const out = [];
      for (let i = 0; i < 8; i++) {
        const g = new THREE.TorusGeometry(0.37, 0.09, 6, 4, Math.PI / 4).rotateZ((i * Math.PI) / 4).rotateX(Math.PI / 2);
        out.push({ geometry: g, color: i % 2 ? '#F4F1EA' : '#FF5A1F', surf: SURF.gloss });
      }
      return out;
    },
    y: 0.0, R: 0.55, tint: null, leeway: 0.04,
  },
  canister: {
    k: 1.15,
    parts: () => [
      p(UNIT.box, W, [0, 0, 0], [0.48, 0.2, 0.34], null, SURF.paint),
      p(UNIT.box, W, [0.08, 0.13, 0], [0.18, 0.06, 0.08], null, SURF.paint),
      p(UNIT.cyl8, '#1A1C1E', [-0.18, 0.12, 0.1], [0.04, 0.06, 0.04], null, SURF.rubber),
    ],
    y: 0.0, R: 0.45, tint: ['#C9A227', '#B3261E', '#2F7D4F', '#E6E6E0'], leeway: 0.04,
  },
  kayak: {
    k: 1.05,
    parts: () => [
      { geometry: kayakHull(), color: W, vcol: true, surf: SURF.paint },
      p(UNIT.torus, '#1A1C1E', [0.2, 0.15, 0], [0.42, 0.24, 0.26], [Math.PI / 2, 0, 0], SURF.rubber), // cockpit coaming
      p(UNIT.sphereLo, '#0E1012', [0.2, 0.12, 0], [0.4, 0.03, 0.22], null, SURF.rubber),
      p(UNIT.box, '#2A2E33', [1.25, 0.15, 0], [1.1, 0.012, 0.012], null, SURF.rubber), // deck lines
      p(UNIT.box, '#2A2E33', [-1.15, 0.15, 0], [1.0, 0.012, 0.012], null, SURF.rubber),
      p(UNIT.box, '#2A2E33', [1.3, 0.14, 0], [0.012, 0.012, 0.36], null, SURF.rubber),
      p(UNIT.box, '#2A2E33', [-1.2, 0.14, 0], [0.012, 0.012, 0.36], null, SURF.rubber),
    ],
    y: -0.03, R: 1.1, tint: ['#C8553C', '#D9A030', '#3A6E94', '#D8D4C8'], leeway: 0.035,
  },
  paddle: {
    k: 1.1,
    parts: () => [
      p(UNIT.cyl6, '#1A1C1E', [0, 0, 0], [0.025, 2.2, 0.025], [0, 0, Math.PI / 2], SURF.rubber),
      p(UNIT.box, '#F2C200', [1.15, 0, 0], [0.46, 0.02, 0.17], [0, 0.4, 0], SURF.gloss),
      p(UNIT.box, '#F2C200', [-1.15, 0, 0], [0.46, 0.02, 0.17], [0, -0.4, 0], SURF.gloss),
    ],
    y: 0.01, R: 0, tint: null, leeway: 0.03,
  },
  suitcase: {
    k: 1.15,
    parts: () => [
      p(UNIT.box, W, [0, 0, 0], [0.7, 0.26, 0.5], null, SURF.paint),
      p(UNIT.box, '#1A1C1E', [0, 0.15, 0.18], [0.24, 0.05, 0.04], null, SURF.rubber),
      p(UNIT.box, '#9A9E9B', [0, 0.131, 0], [0.71, 0.01, 0.06], null, SURF.steel),
    ],
    y: -0.02, R: 0.6, tint: ['#2E3338', '#7A1E1E', '#1F5E8C', '#4E5A52', '#C2B79C'], leeway: 0.03,
  },
  fender: {
    k: 1.1,
    parts: () => [p(UNIT.cyl12, W, [0, 0, 0], [0.2, 0.75, 0.2], [0, 0, Math.PI / 2], SURF.rubber), p(UNIT.sphereLo, W, [0.37, 0, 0], 0.2, null, SURF.rubber), p(UNIT.sphereLo, W, [-0.37, 0, 0], 0.2, null, SURF.rubber)],
    y: 0.02, R: 0.45, tint: ['#E6E6E0', '#1F5E8C', '#2E3338'], leeway: 0.05,
  },
  fishbox: {
    k: 1.1,
    parts: () => [p(UNIT.box, W, [0, 0, 0], [0.8, 0.3, 0.5], null, SURF.paint), p(UNIT.box, '#10161A', [0, 0.151, 0], [0.7, 0.01, 0.4], null, SURF.rubber)],
    y: -0.04, R: 0.6, tint: ['#1F5E8C', '#E8452C', '#E6E6E0'], leeway: 0.035,
  },
  float: {
    k: 1.15,
    parts: () => [p(UNIT.sphereLo, W, [0, 0, 0], 0.17, null, SURF.gloss)],
    y: 0.02, R: 0, tint: ['#FF7B2E', '#F2C200', '#E6E6E0'], leeway: 0.02,
  },
  sail: {
    k: 1.0,
    parts: () => {
      // torn dacron draped on the swell: the luff edge floats (stiff tape + bolt rope), the belly and
      // the torn leech sag under the surface (the sea hides them); seam grid as darker panel lines
      const g = new THREE.PlaneGeometry(4.6, 3.0, 23, 10).rotateX(-Math.PI / 2).toNonIndexed();
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const u = (x + 2.3) / 4.6;
        const sink = Math.max(0, u - 0.25) * 0.55 + Math.max(0, Math.sin(z * 1.9 + 0.6)) * 0.12 * u;
        pos.setY(i, 0.07 * Math.sin(x * 2.1 + z * 0.7) + 0.05 * Math.sin(z * 3.3) - sink - (u > 0.86 ? 0.25 * Math.abs(Math.sin(z * 5.3)) : 0));
        const seam = Math.abs(((x + 2.3) % 0.92) - 0.46) > 0.42 || Math.abs(((z + 1.5) % 1.0) - 0.5) > 0.47;
        const v = seam ? 0.8 : 1;
        col[i * 3] = v;
        col[i * 3 + 1] = v;
        col[i * 3 + 2] = v * 0.98;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      return [
        { geometry: g, color: '#E6E4DC', vcol: true, surf: SURF.fabric },
        p(UNIT.box, '#C9C6BA', [-2.27, 0.06, 0], [0.12, 0.03, 3.0], null, SURF.fabric),
        member([-2.33, 0.06, -1.5], [-2.33, 0.06, 1.5], 0.025, '#5E6466', SURF.rubber),
        p(UNIT.box, '#9A3A2E', [-1.6, 0.04, 1.1], [0.25, 0.025, 0.25], [0, 0.4, 0], SURF.fabric), // sail number patch
      ];
    },
    y: 0.04, R: 1.9, tint: null, leeway: 0.012,
  },
  // the survivors' container model (survivors/craft.js), awash: per-item extra draft `sink`
  container: { k: 1.0, craft: true, y: 0, R: 2.4, tint: ['#9E4636', '#2D5876', '#3D6A4C', '#B49440'], leeway: 0.06 },
  duck: {
    k: 1.4,
    parts: () => [
      p(UNIT.sphereLo, '#FFD400', [0, 0.04, 0], [0.17, 0.12, 0.13], null, SURF.gloss),
      p(UNIT.sphereLo, '#FFD400', [0.11, 0.15, 0], 0.08, null, SURF.gloss),
      p(UNIT.box, '#FF8A00', [0.2, 0.14, 0], [0.07, 0.03, 0.05], null, SURF.gloss),
    ],
    y: 0.0, R: 0, tint: null, leeway: 0.035,
  },
};

// Sea kayak hull (long axis X, 4.4 m): pointed ends, flat-ish deck with a centre ridge, deeper rounded
// bottom; the bottom is vertex-darkened (scuffed, wet) so a capsized one reads dark, not candy.
function kayakHull() {
  const g = new THREE.SphereGeometry(1, 24, 10).toNonIndexed();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.max(0, 1 - x * x);
    const zz = z * 0.3 * Math.pow(t, 0.38);
    const ridge = y > 0 ? 0.035 * Math.max(0, 1 - Math.abs(zz) / 0.12) * Math.pow(t, 0.5) : 0;
    pos.setXYZ(i, x * 2.2, y * (y > 0 ? 0.13 : 0.19) * Math.pow(t, 0.15) + ridge, zz);
    const v = y < -0.15 ? 0.5 : y < 0.05 ? 0.78 : 1;
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Buoy shapes per kind (IALA region A colours, sun-faded; vertex coloured, no tint). Light height
// 3.6. A real lattice buoy: float, four-legged tubular tower around a painted core (the cardinal
// colours), radar reflector, lantern in a guard cage, topmarks with guano, mooring eye, chain and a
// counterweight tail below the water.
const Y = '#B89A3C', K = '#232526', R = '#9E2E24';
function buoyParts(kind) {
  const out = [];
  const body = (c1, c2, c3) => {
    out.push(p(UNIT.cyl12, c1, [0, 0.2, 0], [0.95, 1.2, 0.95], null, SURF.paint));
    out.push(p(UNIT.cyl12, '#2A2622', [0, 0.82, 0], [0.97, 0.06, 0.97], null, SURF.rust)); // deck rim
    out.push(p(UNIT.cyl8, c2, [0, 1.6, 0], [0.3, 1.5, 0.3], null, SURF.paint));
    out.push(p(UNIT.cyl8, c3, [0, 2.75, 0], [0.26, 0.85, 0.26], null, SURF.paint));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      out.push(member([ca * 0.62, 0.82, sa * 0.62], [ca * 0.3, 3.2, sa * 0.3], 0.045, c2, SURF.paint));
      const b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      out.push(member([ca * 0.5, 1.75, sa * 0.5], [Math.cos(b) * 0.5, 1.75, Math.sin(b) * 0.5], 0.03, c2, SURF.paint));
      out.push(member([ca * 0.62, 0.85, sa * 0.62], [Math.cos(b) * 0.42, 2.45, Math.sin(b) * 0.42], 0.022, c2, SURF.paint));
    }
    out.push(p(UNIT.cyl12, '#3A3E42', [0, 3.22, 0], [0.42, 0.05, 0.42], null, SURF.steel)); // lantern platform
    // radar reflector (three crossed plates) on a short arm
    for (const r of [null, [0, Math.PI / 2, 0], [Math.PI / 2, 0, 0]]) out.push(p(UNIT.box, '#8E9290', [0.36, 2.95, 0], [0.34, 0.34, 0.012], r, SURF.steel));
    // lantern in its guard cage
    out.push(p(UNIT.cyl8, '#2E3236', [0, 3.33, 0], [0.12, 0.2, 0.12], null, SURF.steel));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      out.push(member([Math.cos(a) * 0.2, 3.24, Math.sin(a) * 0.2], [Math.cos(a) * 0.2, 3.85, Math.sin(a) * 0.2], 0.012, '#2E3236', SURF.steel));
    }
    out.push(p(UNIT.torus, '#2E3236', [0, 3.85, 0], [0.2, 0.2, 0.05], [Math.PI / 2, 0, 0], SURF.steel));
    // mooring eye, chain and the counterweight tail
    out.push(p(UNIT.torus, '#3A2E26', [0, -0.42, 0], [0.12, 0.12, 0.25], null, SURF.rust));
    out.push(member([0, -0.5, 0], [0.5, -2.6, 0.3], 0.035, '#2E2620', SURF.rust));
    out.push(p(UNIT.cyl8, '#2A2622', [0, -1.2, 0], [0.2, 1.6, 0.2], null, SURF.rust));
  };
  // topmark cone with a guano splash on its upper face
  const cone = (y, up) => {
    out.push(p(UNIT.cone8, K, [0, y, 0], [0.32, 0.42, 0.32], up ? null : [Math.PI, 0, 0], SURF.paint));
    out.push(p(UNIT.sphereLo, '#E4E2D8', [0.07, y + (up ? 0.08 : 0.2), 0.05], [0.16, 0.03, 0.11], [0.3, 0.6, up ? 0.5 : 0], SURF.paint));
  };
  switch (kind) {
    case 'north': body(K, K, Y); cone(4.15, true); cone(4.65, true); break;
    case 'south': body(Y, Y, K); cone(4.15, false); cone(4.65, false); break;
    case 'east': body(K, Y, K); cone(4.15, false); cone(4.65, true); break;
    case 'west': body(Y, K, Y); cone(4.15, true); cone(4.65, false); break;
    case 'isolated':
      body(K, R, K);
      out.push(p(UNIT.sphereLo, K, [0, 4.05, 0], 0.22, null, SURF.paint));
      out.push(p(UNIT.sphereLo, K, [0, 4.55, 0], 0.22, null, SURF.paint));
      out.push(p(UNIT.sphereLo, '#E4E2D8', [0.06, 4.74, 0.04], [0.14, 0.03, 0.1], [0.4, 0.2, 0.3], SURF.paint));
      break;
    default: // regatta mark: inflatable orange PVC cylinder with a white band, mooring line
      out.push(p(UNIT.cyl12, '#E06A2C', [0, 0.8, 0], [0.75, 1.9, 0.75], null, SURF.fabric));
      out.push(p(UNIT.cyl12, '#E2DED2', [0, 1.3, 0], [0.77, 0.35, 0.77], null, SURF.fabric));
      out.push(p(UNIT.cone16, '#E06A2C', [0, 2.05, 0], [0.75, 0.6, 0.75], null, SURF.fabric));
      out.push(p(UNIT.torus, '#2A2E33', [0, -0.12, 0.62], [0.1, 0.1, 0.2], [0, 0, 0], SURF.rubber));
      out.push(member([0, -0.15, 0.62], [0, -2.4, 1.6], 0.025, '#C9C2A8', SURF.fabric));
      return out;
  }
  out.push(p(UNIT.box, '#FFF4DC', [0, 3.42, 0], [0.13, 0.16, 0.13], null, emit(CH.ALWAYS, 0.4)));
  return out;
}
const BUOY_KINDS = ['east', 'west', 'north', 'south', 'isolated', 'mark'];
// Light characters: colour, channel (CH.BUOY0 + index). Rhythms are animated in rhythm().
const BUOY_LIGHT = {
  north: '#FFFFFF',
  south: '#FFFFFF',
  east: '#FFFFFF',
  west: '#FFFFFF',
  isolated: '#FFFFFF',
  mark: '#F2C200',
};

// Real light rhythms (IALA): returns 0..1 at time t. reduce → soft ≤ 1 Hz pulses at 40 %.
export function buoyRhythm(kind, t, reduce) {
  if (reduce) return 0.4 * Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.25), 3);
  const flash = (ph, on) => (ph < on ? 1 : 0);
  switch (kind) {
    case 'north': return flash((t * 1.0) % 1, 0.35); // Q: continuous quick, 60/min
    case 'east': { const ph = t % 10; return ph < 3 ? flash(ph % 1, 0.35) : 0; } // Q(3) 10 s
    case 'south': { const ph = t % 15; return ph < 6 ? flash(ph % 1, 0.35) : ph < 8 ? 1 : 0; } // Q(6)+LFl 15 s
    case 'west': { const ph = t % 15; return ph < 9 ? flash(ph % 1, 0.35) : 0; } // Q(9) 15 s
    case 'isolated': { const ph = t % 5; return ph < 0.5 || (ph > 1.0 && ph < 1.5) ? 1 : 0; } // Fl(2) 5 s
    default: return (t % 4) < 0.6 ? 1 : 0; // Fl Y 4 s
  }
}

// --------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _n = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _flow = new THREE.Vector2();
const _col = new THREE.Color();

export class Floaters {
  constructor(Wd) {
    this.W = Wd;
    this.banks = new Map(); // shape → { mesh, keyline, n, max, def }
    this.items = [];
    this.buoys = [];
    this.frame = 0;
    this.keylines = false;
  }

  _bank(shape, max) {
    let b = this.banks.get(shape);
    if (b && b.max >= max) return b;
    if (b) this._dropBank(shape);
    const Wd = this.W;
    const def = shape.startsWith('buoy:') ? { parts: () => buoyParts(shape.slice(5)), y: 0, R: 1.0, k: 1.1 } : SHAPES[shape];
    let geo;
    let mat = Wd.mats.floater;
    if (def.craft) {
      // survivors' container (long axis Z → X here) on the craft material: per-instance phase so the
      // rust/salt pattern differs from box to box
      geo = containerGeometry().rotateY(Math.PI / 2);
      const ph = new Float32Array(max * 4);
      for (let i = 0; i < max; i++) ph[i * 4 + 2] = (i * 37.7) % 97;
      geo.setAttribute('iCraft', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
      geo.setAttribute('iCraft2', new THREE.InstancedBufferAttribute(ph, 4));
      if (!this._craftMat) {
        const sv = Wd.ctx.survivors;
        this._craftMat = createCraftMaterial(Wd.look, { roughness: 0.7, rim: sv?.rim, nightAmb: sv?.nightAmb, skyFill: sv?.skyFill, wear: { ...WEAR.heavy, streaks: 0.6, waterline: 0.55, scale: 1.25 }, key: '-floater' });
      }
      mat = this._craftMat;
    } else {
      const parts = def.parts();
      geo = bake(Wd.look, parts);
      for (const part of parts) if (!Object.values(UNIT).includes(part.geometry)) part.geometry.dispose?.();
    }
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.name = `world-float-${shape}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _col.set(1, 1, 1));
    mesh.count = 0;
    Wd.root.add(mesh);
    b = { mesh, n: 0, max, def };
    this.banks.set(shape, b);
    return b;
  }

  _dropBank(shape) {
    const b = this.banks.get(shape);
    if (!b) return;
    b.mesh.removeFromParent();
    b.mesh.geometry.dispose();
    b.mesh.dispose?.();
    this.banks.delete(shape);
  }

  clear() {
    this.items.length = 0;
    this.buoys.length = 0;
    for (const b of this.banks.values()) {
      b.n = 0;
      b.mesh.count = 0;
      b.mesh.visible = false; // no empty draw calls (visibility does not touch the light setup)
    }
  }

  dispose() {
    for (const shape of [...this.banks.keys()]) this._dropBank(shape);
  }

  // --------------------------------------------------------------------------------------------
  // Build from def.world.props (+ seed). Debris kinds map to shape mixes.
  setup(props, seed, detail) {
    this.clear();
    const r = rng((seed | 0) + 777);
    const counts = new Map();
    const add = (shape, o) => {
      counts.set(shape, (counts.get(shape) || 0) + 1);
      this.items.push(Object.assign({ shape, x: 0, z: 0, yaw: r() * Math.PI * 2, yawRate: (r() - 0.5) * 0.08, roll: 0, pitch: 0,
        tilt: 1, h: 0, nx: 0, ny: 1, nz: 0, phase: r() * 10, color: null, idx: -1, moored: null, light: -1, every: 1 }, o));
    };
    const MIX = {
      kayak: [['kayak', 0.45], ['paddle', 0.3], ['fishbox', 0.1], ['ring', 0.15]],
      paddle: [['paddle', 1]],
      luggage: [['suitcase', 0.5], ['ring', 0.15], ['plank', 0.15], ['fender', 0.2]],
      planks: [['plank', 0.5], ['barrel', 0.15], ['canister', 0.15], ['ring', 0.1], ['fishbox', 0.1]],
      sail: [['plank', 0.35], ['ring', 0.2], ['fender', 0.3], ['canister', 0.15]],
      nets: [['fishbox', 0.4], ['plank', 0.3], ['barrel', 0.3]],
      barrels: [['barrel', 0.6], ['canister', 0.4]],
      default: [['plank', 0.4], ['barrel', 0.2], ['ring', 0.15], ['canister', 0.25]],
    };
    const pick = (mix) => {
      let u = r();
      for (const [s, w] of mix) {
        if ((u -= w) <= 0) return s;
      }
      return mix[mix.length - 1][0];
    };
    const tintOf = (shape) => {
      const t = SHAPES[shape]?.tint;
      return t ? t[Math.floor(r() * t.length)] : null;
    };

    for (const d of props?.debris || []) {
      const n = Math.max(1, Math.round((d.count || 6) * (0.6 + 0.4 * detail)));
      const rad = d.radius || 30;
      const mix = MIX[d.kind] || MIX.default;
      if (d.kind === 'sail') add('sail', { x: d.x, z: d.z, color: null });
      if (d.kind === 'nets') {
        // chains of net floats: they rise and fall along the swell — the wave shape made visible
        for (let c = 0; c < Math.max(1, Math.round(n / 3)); c++) {
          const cx = d.x + (r() - 0.5) * rad, cz = d.z + (r() - 0.5) * rad;
          const a = r() * Math.PI * 2;
          const col = tintOf('float');
          for (let k = 0; k < 10; k++) {
            const bend = Math.sin(k * 0.45) * 2.5;
            add('float', { x: cx + Math.cos(a) * k * 1.6 - Math.sin(a) * bend, z: cz + Math.sin(a) * k * 1.6 + Math.cos(a) * bend, color: col, yawRate: 0, chain: true });
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const shape = pick(mix);
        const ang = r() * Math.PI * 2, dist = Math.sqrt(r()) * rad;
        const o = { x: d.x + Math.cos(ang) * dist, z: d.z + Math.sin(ang) * dist, color: tintOf(shape) };
        if (shape === 'kayak' && r() < 0.5) o.roll = Math.PI; // capsized
        if (shape === 'barrel' || shape === 'canister' || shape === 'fishbox') o.roll = (r() - 0.5) * 0.5;
        add(shape, o);
      }
    }

    let ducks = null;
    const containers = props?.containers || [];
    containers.forEach((c, i) => {
      // awash: 0.3–0.6 m of freeboard, listing 5–15° on a flooded corner
      add('container', { x: c.x, z: c.z, color: c.color ? containerPaint(c.color) : tintOf('container'), roll: (r() < 0.5 ? -1 : 1) * (0.09 + r() * 0.17), pitch: (r() - 0.5) * 0.12, tilt: 0.7, long: 3, sink: r() * 0.3 });
      if (!ducks && r() < 0.05) ducks = c; // 1 in 20: a broken container spilled its cargo
    });
    if (ducks || this.W.ctx.params?.has?.('ducks')) {
      const src = ducks || containers[0] || { x: 60, z: -40 };
      const n = Math.round(300 * (0.4 + 0.6 * detail));
      const a0 = r() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const along = Math.pow(r(), 0.7) * 120;
        const lat = (r() - 0.5) * (6 + along * 0.35);
        add('duck', {
          x: src.x + Math.cos(a0) * along - Math.sin(a0) * lat,
          z: src.z + Math.sin(a0) * along + Math.cos(a0) * lat,
          yawRate: (r() - 0.5) * 0.4,
          every: 3,
        });
      }
      this.duckSource = src;
    } else this.duckSource = null;

    for (const b of props?.buoys || []) {
      const kind = BUOY_KINDS.includes(b.kind) ? b.kind : 'mark';
      add(`buoy:${kind}`, { x: b.x, z: b.z, moored: { x: b.x, z: b.z }, kind, tilt: 1.6, yawRate: 0.02 });
    }

    // allocate banks (only shapes in use become visible)
    for (const b of this.banks.values()) b.n = 0;
    for (const [shape, n] of counts) this._bank(shape, Math.max(n, 8));
    for (const it of this.items) {
      const b = this.banks.get(it.shape);
      it.idx = b.n++;
      it.def = b.def;
      it.R = (b.def.R || 0) * (b.def.k || 1);
      it.leeway = b.def.leeway ?? 0.03;
      if (it.color) b.mesh.setColorAt(it.idx, _col.set(it.color));
      else b.mesh.setColorAt(it.idx, _col.set(1, 1, 1));
      if (it.moored) {
        it.light = this.W.lamps.add(it.x, 3.6, it.z, BUOY_LIGHT[it.kind], { gain: 5, bulb: 0.2, halo: 2.4, ch: CH.BUOY0 + BUOY_KINDS.indexOf(it.kind), pen: 0.35 });
        this.buoys.push(it);
      }
    }
    for (const b of this.banks.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
    this.frame = 0;
    // settle on the water immediately
    this.update(0, null, true);
  }

  // Kept for world.js: floaters no longer draw ink keylines at any quality.
  setKeylines() {
    this.keylines = false;
  }

  // --------------------------------------------------------------------------------------------
  update(dt, env, settle = false) {
    const Wd = this.W;
    const ctx = Wd.ctx;
    const ocean = ctx.ocean;
    const hz = ctx.hazards;
    const items = this.items;
    if (!items.length) return;
    this.frame++;
    const focus = env ? env.focus : null;
    const wind = env ? env.wind : null;
    const cur = env ? env.current : null;
    const t = env ? env.t : 0;
    const kh = settle ? 1 : 1 - Math.exp(-(dt || 0) * 5);
    const kn = settle ? 1 : 1 - Math.exp(-(dt || 0) / 0.3); // tilt follows the swell with a 0.3 s lag
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // drift: current + leeway·wind + hazard surface flow (moored buoys swing around the anchor)
      if (dt > 0) {
        let vx = (cur ? cur.x : 0) + (wind ? wind.x * it.leeway : 0);
        let vz = (cur ? cur.y : 0) + (wind ? wind.y * it.leeway : 0);
        if (hz?.surfaceFlowAt) {
          hz.surfaceFlowAt(it.x, it.z, _flow);
          vx += _flow.x;
          vz += _flow.y;
        }
        if (it.moored) {
          const ax = it.moored.x + vx * 6, az = it.moored.z + vz * 6;
          it.x += (ax - it.x) * Math.min(1, dt * 0.2);
          it.z += (az - it.z) * Math.min(1, dt * 0.2);
        } else {
          it.x += vx * dt;
          it.z += vz * dt;
        }
        it.yaw += it.yawRate * dt;
      }
      // far away / staggered: skip the wave evaluation (keep last pose, still drift)
      const far = focus ? Math.abs(it.x - focus.x) + Math.abs(it.z - focus.y) > 520 : false;
      const skip = !settle && ((far && (this.frame + i) % 8) || (it.every > 1 && (this.frame + i) % it.every));
      if (!skip && ocean) {
        const h = ocean.heightAt(it.x, it.z);
        it.h = settle ? h : it.h + (h - it.h) * Math.min(1, kh * it.every);
        if (it.R > 0 || it.moored || it.long) {
          ocean.normalAt(it.x, it.z, _n);
          const k = Math.min(1, kn * it.every);
          it.nx += (_n.x * it.tilt - it.nx) * k;
          it.ny += (_n.y - it.ny) * k;
          it.nz += (_n.z * it.tilt - it.nz) * k;
        }
      }
      // pose
      _n.set(it.nx, it.ny, it.nz).normalize();
      _q.setFromUnitVectors(_UP, _n);
      _qy.setFromAxisAngle(_UP, it.yaw);
      _q.multiply(_qy);
      if (it.roll || it.pitch) {
        _e.set(it.roll, 0, it.pitch);
        _qr.setFromEuler(_e);
        _q.multiply(_qr);
      }
      let y = it.h + (it.def.y || 0) * (it.def.k || 1) - (it.sink || 0);
      if (it.moored) {
        // buoys rock on their mooring: extra sway
        const sw = 0.06 * Math.sin(t * 1.3 + it.phase);
        _qr.setFromAxisAngle(_n.set(Math.cos(it.phase), 0, Math.sin(it.phase)), sw);
        _q.premultiply(_qr);
        y -= 0.35;
      }
      _p.set(it.x, y, it.z);
      _s.setScalar(it.def.k || 1);
      _m.compose(_p, _q, _s);
      const b = this.banks.get(it.shape);
      b.mesh.setMatrixAt(it.idx, _m);
      if (it.light >= 0) {
        _p.set(0, 3.66, 0).applyMatrix4(_m);
        Wd.lamps.setLocal(it.light, _p.x, _p.y, _p.z);
      }
      // containers: the swell washes over the roof — foam where the sea stands above it at an end
      if (it.long && !far && env && dt > 0 && ocean?.stamp) {
        it.washT = (it.washT || 0) - dt;
        if (it.washT <= 0) {
          it.washT = 0.5;
          const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
          for (const e of SIDES) {
            const ex = it.x + c * 2.6 * e, ez = it.z - s * 2.6 * e;
            if (ocean.heightAt(ex, ez) > y + CONT.freeboard - 0.12) {
              ocean.stamp('foam', ex, ez, { radius: 1.5, strength: 0.55 });
              it.washT = 1.2;
            }
          }
        }
      }
      // foam collar + contact disc
      if (it.R > 0 && !far && env) {
        _n.set(it.nx, it.ny, it.nz);
        const lit = ocean?.searchlightAt ? ocean.searchlightAt(it.x, it.z) : 0;
        if (it.long) {
          const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
          Wd.collars.push(it.x + c * 1.6, it.h, it.z - s * 1.6, _n.x, _n.y, _n.z, it.R, 0.75, 0.25, lit, it.phase);
          Wd.collars.push(it.x - c * 1.6, it.h, it.z + s * 1.6, _n.x, _n.y, _n.z, it.R, 0.75, 0.25, lit, it.phase + 3);
        } else {
          Wd.collars.push(it.x, it.h, it.z, _n.x, _n.y, _n.z, it.R, it.moored ? 0.8 : 0.55, 0.25, lit, it.phase);
        }
      }
    }
    for (const b of this.banks.values()) if (b.n) b.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { BUOY_KINDS };
