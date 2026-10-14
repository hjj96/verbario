// Procedural SAR helicopter «Чайка-07» (DESIGN §2.9): ~17.5 m, main rotor R 8.1 m, ~2.5k triangles.
//
// Draw calls: hull (everything solid, incl. glass + decals, ONE physical material) · keyline ·
// lights (all bulbs + halos, additive) · main rotor disc · tail rotor disc. Real blades for the
// stroboscopic rotor shadow live on layer 1 (shadow pass only).
//
// Local frame: nose → −Z, up +Y, starboard (right) +X. Origin = rotor-mast axis at mid-fuselage;
// skids at y = −1.6.
import * as THREE from 'three';
import { loft, stationProfile, remapUv, tube, mergeSurfaces, triCount } from './shapes.js';
import { DECAL_RECT, drawDecals } from './decals.js';
import { createHullMaterial, createRotorMaterial, createLightsMaterial } from './materials.js';

export const ROTOR_R = 8.1;
export const TAIL_R = 1.4;
export const SKID_Y = -1.6;

// Livery (DESIGN §2.9)
const C = {
  white: '#ECEBE6',
  orange: '#FF4F1A',
  dark: '#2E3338',
  blade: '#22262A',
  glass: '#0B1B26',
  metal: '#8E969C',
  metalDark: '#3A3F44',
  exhaust: '#26282A',
  soot: '#09090A',
  grille: '#1B1E21',
};

// Surface classes → aSurf (roughness, metalness, clearcoat weight, flags)
const SURF = {
  paint: [0.55, 0, 1, 0],
  matte: [0.78, 0, 0.25, 0],
  metal: [0.42, 0.65, 0.15, 0],
  rubber: [0.82, 0, 0, 0],
  glass: [0.06, 0, 1, 2],
  decal: [0.5, 0, 1, 1],
};

// Key named points (local) used by the lights, searchlight, winch, smoke…
export const POINTS = {
  hoist: new THREE.Vector3(2.12, 0.6, -1.45), // winch cable top (boom tip, starboard door)
  door: new THREE.Vector3(1.24, 0.52, -1.45),
  lens: new THREE.Vector3(0.55, -1.42, -4.02), // searchlight lens
  belly: new THREE.Vector3(0, -2.6, -0.2), // belly PointLight
  exhaustL: new THREE.Vector3(-0.86, 1.36, 2.72),
  exhaustR: new THREE.Vector3(0.86, 1.36, 2.72),
  navPort: new THREE.Vector3(-2.15, -0.56, 0.62),
  navStbd: new THREE.Vector3(2.15, -0.56, 0.62),
  navTail: new THREE.Vector3(0, 0.74, 10.12),
  beacon: new THREE.Vector3(0, 1.6, 1.8),
  beaconLow: new THREE.Vector3(0, -1.1, 0.7),
  strobeL: new THREE.Vector3(-1.68, 0.82, 8.56),
  strobeR: new THREE.Vector3(1.68, 0.82, 8.56),
  probeL: new THREE.Vector3(-0.3, -0.16, -5.95),
  probeR: new THREE.Vector3(0.3, -0.16, -5.95),
  mast: new THREE.Vector3(0, 2.12, -0.3),
  tailRotor: new THREE.Vector3(-0.27, 2.1, 9.95),
};

// Light channels (index into the lights material uChan[]).
export const CH = { navRed: 0, navGreen: 1, navWhite: 2, beacon: 3, strobe: 4, door: 5, elmo: 6, lens: 7, flir: 8 };

// ------------------------------------------------------------------------------------------------
function fuselageProfile() {
  return stationProfile([
    { z: -5.36, hw: 0.06, hh: 0.06, cy: -0.26, n: 2.0 },
    { z: -5.16, hw: 0.46, hh: 0.4, cy: -0.28, n: 2.2 },
    { z: -4.8, hw: 0.8, hh: 0.66, cy: -0.22, n: 2.4 },
    { z: -4.3, hw: 1.0, hh: 0.86, cy: -0.12, n: 2.6 },
    { z: -3.6, hw: 1.12, hh: 1.0, cy: 0.0, n: 2.8 },
    { z: -2.8, hw: 1.17, hh: 1.06, cy: 0.05, n: 3.0 },
    { z: -1.5, hw: 1.18, hh: 1.08, cy: 0.06, n: 3.2 },
    { z: 0.2, hw: 1.18, hh: 1.08, cy: 0.06, n: 3.2 },
    { z: 1.2, hw: 1.12, hh: 1.0, cy: 0.12, n: 3.0 },
    { z: 2.1, hw: 0.92, hh: 0.8, cy: 0.24, n: 2.6 },
    { z: 3.0, hw: 0.62, hh: 0.56, cy: 0.38, n: 2.2 },
    { z: 3.8, hw: 0.44, hh: 0.42, cy: 0.46, n: 2.0 },
    { z: 6.5, hw: 0.36, hh: 0.36, cy: 0.55, n: 2.0 },
    { z: 9.4, hw: 0.27, hh: 0.27, cy: 0.68, n: 2.0 },
    { z: 10.05, hw: 0.14, hh: 0.16, cy: 0.72, n: 2.0 },
  ]);
}

function sponsonProfile(side) {
  const s = side;
  return stationProfile([
    { z: -0.8, hw: 0.1, hh: 0.1, cx: 1.42 * s, cy: -0.62, n: 2.2 },
    { z: -0.5, hw: 0.42, hh: 0.28, cx: 1.55 * s, cy: -0.62, n: 2.6 },
    { z: 0.2, hw: 0.53, hh: 0.33, cx: 1.6 * s, cy: -0.62, n: 2.8 },
    { z: 1.1, hw: 0.51, hh: 0.32, cx: 1.58 * s, cy: -0.62, n: 2.8 },
    { z: 1.72, hw: 0.3, hh: 0.24, cx: 1.45 * s, cy: -0.6, n: 2.4 },
    { z: 1.98, hw: 0.08, hh: 0.08, cx: 1.35 * s, cy: -0.58, n: 2.0 },
  ]);
}

function humpProfile() {
  return stationProfile([
    { z: -1.38, hw: 0.36, hh: 0.08, cy: 1.02, n: 2.2 },
    { z: -1.05, hw: 0.72, hh: 0.42, cy: 1.02, n: 3.0 },
    { z: 1.6, hw: 0.74, hh: 0.5, cy: 1.04, n: 3.2 },
    { z: 2.4, hw: 0.56, hh: 0.3, cy: 1.02, n: 2.6 },
    { z: 2.78, hw: 0.24, hh: 0.1, cy: 0.98, n: 2.2 },
  ]);
}

// Fin: swept trapezoid extruded across X (shape x → world z, shape y → world y).
function finGeometry(points, thick) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape x → world z, depth → −x
  g.translate(thick / 2, 0, 0);
  return g;
}

function buildHullParts() {
  const fp = fuselageProfile();
  const L = (o) => loft({ profile: fp, inflate: 0, ...o });
  const OV = 0.014; // overlay inflate (stripes, glass, decals)
  const paint = [];
  const matte = [];
  const metal = [];
  const rubber = [];
  const glass = [];
  const decal = [];

  // --- fuselage bands ---------------------------------------------------------------------------
  paint.push({ geometry: L({ z0: -5.36, z1: -4.72, zSegs: 3 }), color: C.orange }); // rescue nose
  paint.push({ geometry: L({ z0: -4.72, z1: -2.6, zSegs: 5 }), color: C.white });
  paint.push({ geometry: L({ z0: -2.6, z1: 1.4, zSegs: 5 }), color: C.white });
  paint.push({ geometry: L({ z0: 1.4, z1: 3.8, zSegs: 5 }), color: C.white });
  paint.push({ geometry: L({ z0: 3.8, z1: 10.05, zSegs: 5, uSegs: 10 }), color: C.white });
  // diagonal rescue stripes on the tail boom
  for (const zc of [5.0, 6.35]) {
    paint.push({ geometry: L({ z0: zc - 0.22, z1: zc + 0.22, zSegs: 1, uSegs: 10, inflate: OV, shear: 0.75 }), color: C.orange });
  }
  // orange band just behind the cockpit (reads as a ring from the sides)
  paint.push({ geometry: L({ z0: 1.55, z1: 1.95, zSegs: 1, uFrom: 0.02, uTo: 0.98, uSegs: 12, inflate: OV }), color: C.orange });

  // anti-glare panel on the nose, walkways along the engine hump
  matte.push({ geometry: L({ z0: -5.02, z1: -4.5, zSegs: 2, uFrom: 0.4, uTo: 0.6, uSegs: 4, inflate: OV }), color: C.dark });
  matte.push({ geometry: L({ z0: -1.0, z1: 1.9, zSegs: 2, uFrom: 0.395, uTo: 0.43, uSegs: 1, inflate: OV }), color: C.dark });
  matte.push({ geometry: L({ z0: -1.0, z1: 1.9, zSegs: 2, uFrom: 0.57, uTo: 0.605, uSegs: 1, inflate: OV }), color: C.dark });
  // cabin door outline (starboard) — a dark frame, the winch works through it
  matte.push({ geometry: L({ z0: -2.05, z1: -1.98, zSegs: 1, uFrom: 0.16, uTo: 0.36, uSegs: 3, inflate: OV }), color: C.dark });
  matte.push({ geometry: L({ z0: -0.62, z1: -0.55, zSegs: 1, uFrom: 0.16, uTo: 0.36, uSegs: 3, inflate: OV }), color: C.dark });

  // --- glass: windscreen, cockpit doors, cabin windows ----------------------------------------
  glass.push({ geometry: L({ z0: -4.5, z1: -3.42, zSegs: 3, uFrom: 0.355, uTo: 0.645, uSegs: 6, inflate: OV }), color: C.glass });
  glass.push({ geometry: L({ z0: -3.42, z1: -2.5, zSegs: 2, uFrom: 0.27, uTo: 0.38, uSegs: 2, inflate: OV }), color: C.glass });
  glass.push({ geometry: L({ z0: -3.42, z1: -2.5, zSegs: 2, uFrom: 0.62, uTo: 0.73, uSegs: 2, inflate: OV }), color: C.glass });
  for (const [a, b] of [[-1.75, -1.05], [0.05, 0.75]]) {
    glass.push({ geometry: L({ z0: a, z1: b, zSegs: 1, uFrom: 0.275, uTo: 0.335, uSegs: 1, inflate: OV }), color: C.glass });
    glass.push({ geometry: L({ z0: a, z1: b, zSegs: 1, uFrom: 0.665, uTo: 0.725, uSegs: 1, inflate: OV }), color: C.glass });
  }
  // chin windows (seen when the heli banks)
  glass.push({ geometry: L({ z0: -4.65, z1: -3.9, zSegs: 1, uFrom: 0.08, uTo: 0.16, uSegs: 1, inflate: OV }), color: C.glass });
  glass.push({ geometry: L({ z0: -4.65, z1: -3.9, zSegs: 1, uFrom: 0.84, uTo: 0.92, uSegs: 1, inflate: OV }), color: C.glass });

  // --- decals: roof plate «07 СПАС», side «ЧАЙКА-07» -------------------------------------------
  decal.push({
    geometry: remapUv(L({ z0: -2.46, z1: -1.3, zSegs: 3, uFrom: 0.385, uTo: 0.615, uSegs: 6, inflate: OV * 1.6 }), DECAL_RECT.roof, { flipU: true, flipV: true }),
    color: C.white,
  });
  decal.push({
    geometry: remapUv(L({ z0: -1.85, z1: 0.95, zSegs: 2, uFrom: 0.2, uTo: 0.262, uSegs: 2, inflate: OV }), DECAL_RECT.side, { swap: true, flipU: true }),
    color: C.white,
  });
  decal.push({
    geometry: remapUv(L({ z0: -1.85, z1: 0.95, zSegs: 2, uFrom: 0.738, uTo: 0.8, uSegs: 2, inflate: OV }), DECAL_RECT.side, { swap: true, flipV: true }),
    color: C.white,
  });

  // --- sponsons (widen the silhouette from above), orange tops ---------------------------------
  for (const s of [1, -1]) {
    const sp = sponsonProfile(s);
    paint.push({ geometry: loft({ profile: sp, z0: -0.8, z1: 1.98, zSegs: 6, uSegs: 10 }), color: C.white });
    paint.push({ geometry: loft({ profile: sp, z0: -0.55, z1: 1.74, zSegs: 4, uFrom: 0.38, uTo: 0.62, uSegs: 4, inflate: OV }), color: C.orange });
  }

  // --- engine hump, intakes, exhausts ----------------------------------------------------------
  const hp = humpProfile();
  paint.push({ geometry: loft({ profile: hp, z0: -1.38, z1: 2.78, zSegs: 6, uFrom: 0.22, uTo: 0.78, uSegs: 8 }), color: C.white });
  for (const [a, b] of [[0.28, 0.36], [0.64, 0.72]]) {
    rubber.push({ geometry: loft({ profile: hp, z0: -1.0, z1: -0.45, zSegs: 1, uFrom: a, uTo: b, uSegs: 1, inflate: OV }), color: C.grille });
  }
  for (const s of [1, -1]) {
    metal.push({ geometry: tube([0.5 * s, 1.24, 2.05], [0.86 * s, 1.36, 2.72], 0.2, 0.17, 8), color: C.exhaust });
    rubber.push({ geometry: tube([0.82 * s, 1.35, 2.62], [0.88 * s, 1.37, 2.76], 0.13, 0.13, 8), color: C.soot });
  }

  // --- rotor mast + hub ------------------------------------------------------------------------
  metal.push({ geometry: tube([0, 1.38, -0.3], [0, 2.0, -0.3], 0.17, 0.14, 8), color: C.metalDark });
  metal.push({ geometry: new THREE.CylinderGeometry(0.44, 0.48, 0.22, 10), position: [0, 2.02, -0.3], color: C.metalDark });
  metal.push({ geometry: new THREE.CylinderGeometry(0.16, 0.2, 0.18, 8), position: [0, 2.2, -0.3], color: C.metal });

  // --- tail: fin, stabiliser with endplates, tail-rotor hub, antenna ---------------------------
  paint.push({ geometry: finGeometry([[8.75, 0.62], [9.95, 0.62], [10.42, 2.82], [10.05, 3.05], [9.62, 2.98], [8.95, 1.0]], 0.17), color: C.white });
  paint.push({ geometry: finGeometry([[9.98, 2.58], [10.37, 2.6], [10.42, 2.82], [10.05, 3.05], [9.62, 2.98], [9.7, 2.6]], 0.2), color: C.orange });
  paint.push({ geometry: new THREE.BoxGeometry(3.3, 0.08, 0.62), position: [0, 0.8, 8.55], color: C.white });
  for (const s of [1, -1]) {
    paint.push({ geometry: new THREE.BoxGeometry(0.06, 0.52, 0.56), position: [1.66 * s, 0.86, 8.6], color: C.orange });
  }
  metal.push({ geometry: tube([0.02, 2.1, 9.95], [-0.3, 2.1, 9.95], 0.1, 0.1, 6), color: C.metalDark });
  matte.push({ geometry: new THREE.BoxGeometry(0.04, 0.34, 0.26), position: [0, 0.95, 4.6], rotation: [0.35, 0, 0], color: C.dark });

  // --- skids + cross tubes ---------------------------------------------------------------------
  for (const s of [1, -1]) {
    const x = 1.36 * s;
    metal.push({ geometry: tube([x, -1.6, -2.7], [x, -1.6, 1.95], 0.065, 0.065, 6), color: C.metalDark });
    metal.push({ geometry: tube([x, -1.6, -2.7], [x, -1.32, -3.28], 0.065, 0.06, 6), color: C.metalDark });
    metal.push({ geometry: tube([0.8 * s, -0.98, -1.7], [x, -1.6, -1.9], 0.07, 0.07, 6), color: C.metal });
    metal.push({ geometry: tube([0.8 * s, -0.98, 0.95], [x, -1.6, 1.15], 0.07, 0.07, 6), color: C.metal });
  }

  // --- winch boom (starboard, over the cabin door) ---------------------------------------------
  metal.push({ geometry: new THREE.BoxGeometry(0.14, 0.62, 0.14), position: [1.12, 0.72, -1.45], color: C.metal });
  metal.push({ geometry: new THREE.BoxGeometry(1.06, 0.15, 0.17), position: [1.62, 1.0, -1.45], color: C.metal });
  metal.push({ geometry: tube([2.12, 0.82, -1.68], [2.12, 0.82, -1.22], 0.17, 0.17, 8), color: C.metalDark });
  paint.push({ geometry: new THREE.BoxGeometry(0.2, 0.06, 0.2), position: [2.12, 1.0, -1.45], color: C.orange });

  // --- gimballed searchlight (starboard chin) + FLIR ball (port chin) --------------------------
  metal.push({ geometry: new THREE.BoxGeometry(0.14, 0.26, 0.14), position: [0.55, -0.98, -3.9], color: C.metalDark });
  metal.push({ geometry: new THREE.TorusGeometry(0.24, 0.035, 4, 12), position: [0.55, -1.18, -3.94], rotation: [0, Math.PI / 2, 0], color: C.metal });
  metal.push({ geometry: tube([0.55, -1.12, -3.86], [0.55, -1.38, -4.0], 0.21, 0.24, 10), color: C.metal });
  metal.push({ geometry: new THREE.SphereGeometry(0.3, 10, 7), position: [-0.5, -1.18, -4.15], color: '#4A5056' });
  glass.push({ geometry: new THREE.SphereGeometry(0.13, 8, 6), position: [-0.5, -1.2, -4.41], color: C.glass });

  // --- nose probes (St. Elmo's fire crackles on their tips) ------------------------------------
  for (const s of [1, -1]) metal.push({ geometry: tube([0.3 * s, -0.16, -5.0], [0.3 * s, -0.16, -5.95], 0.028, 0.02, 4), color: C.metal });

  return [
    { surf: SURF.paint, parts: paint },
    { surf: SURF.matte, parts: matte },
    { surf: SURF.metal, parts: metal },
    { surf: SURF.rubber, parts: rubber },
    { surf: SURF.glass, parts: glass },
    { surf: SURF.decal, parts: decal },
  ];
}

// ------------------------------------------------------------------------------------------------
// Lights geometry: bulbs (octahedra) + halo quads with per-vertex channel / colour / size.
const LIGHT_DEFS = [
  // [point, colour, channel, bulb radius, halo size]
  ['navPort', '#FF2015', CH.navRed, 0.14, 1.1],
  ['navStbd', '#12FF6E', CH.navGreen, 0.14, 1.1],
  ['navTail', '#FFFFFF', CH.navWhite, 0.12, 0.9],
  ['beacon', '#FF1A10', CH.beacon, 0.17, 1.8],
  ['beaconLow', '#FF1A10', CH.beacon, 0.15, 1.4],
  ['strobeL', '#FFFFFF', CH.strobe, 0.13, 2.6],
  ['strobeR', '#FFFFFF', CH.strobe, 0.13, 2.6],
  ['door', '#B3121A', CH.door, 0.12, 1.3],
  ['probeL', '#7FB8FF', CH.elmo, 0.07, 0.8],
  ['probeR', '#7FB8FF', CH.elmo, 0.07, 0.8],
  ['lens', '#FFF1DA', CH.lens, 0.2, 1.6],
];

function buildLightsGeometry() {
  const bulb = new THREE.OctahedronGeometry(1, 0); // polyhedra are already non-indexed
  const bp = bulb.attributes.position.array;
  const nb = bp.length / 3;
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  const per = nb + quad.length;
  const total = per * LIGHT_DEFS.length;
  const pos = new Float32Array(total * 3);
  const corner = new Float32Array(total * 2);
  const chan = new Float32Array(total);
  const size = new Float32Array(total);
  const col = new Float32Array(total * 3);
  const c = new THREE.Color();
  let v = 0;
  for (const [name, hex, ch, r, halo] of LIGHT_DEFS) {
    const p = POINTS[name];
    c.set(hex);
    for (let i = 0; i < nb; i++, v++) {
      pos.set([p.x + bp[i * 3] * r, p.y + bp[i * 3 + 1] * r, p.z + bp[i * 3 + 2] * r], v * 3);
      chan[v] = ch;
      col.set([c.r, c.g, c.b], v * 3);
    }
    for (const [qx, qy] of quad) {
      pos.set([p.x, p.y, p.z], v * 3);
      corner.set([qx, qy], v * 2);
      chan[v] = ch;
      size[v] = halo;
      col.set([c.r, c.g, c.b], v * 3);
      v++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aChan', new THREE.BufferAttribute(chan, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 3; // halos
  bulb.dispose();
  return g;
}

// Real blades (shadow only, layer 1): 5 thin planks from the hub.
function buildBlades(look) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(ROTOR_R - 0.5, 0.06, 0.52),
      position: [Math.cos(a) * (ROTOR_R / 2 + 0.25), 0, -Math.sin(a) * (ROTOR_R / 2 + 0.25)],
      rotation: [0, a, 0],
      color: C.blade,
    });
  }
  return look.merge(parts);
}

// ------------------------------------------------------------------------------------------------
export function buildHeliModel(ctx) {
  const { look } = ctx;
  const quality = ctx.settings.get('quality');

  // Decal atlas (redrawn when the web fonts arrive).
  const decalTex = look.canvasTexture(1024, 512, drawDecals);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready
      .then(() => {
        const cv = decalTex.image;
        drawDecals(cv.getContext('2d'), cv.width, cv.height);
        decalTex.needsUpdate = true;
      })
      .catch(() => {});
  }

  const root = new THREE.Group(); // world position + heading
  root.name = 'heli';
  const body = new THREE.Group(); // visual pitch / bank / bob
  root.add(body);

  const hullGeo = mergeSurfaces(look, buildHullParts());
  const hullMat = createHullMaterial(look, decalTex);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.name = 'heli.hull';
  hull.castShadow = true;
  hull.receiveShadow = true;
  body.add(hull);

  const keyline = new THREE.Mesh(hullGeo, look.keyline({ color: '#05090B', opacity: 0.55, px: 1 }));
  keyline.name = 'heli.keyline';
  keyline.renderOrder = -1;
  body.add(keyline);

  const lightsMat = createLightsMaterial();
  const lights = new THREE.Mesh(buildLightsGeometry(), lightsMat);
  lights.name = 'heli.lights';
  lights.renderOrder = 5;
  lights.frustumCulled = false;
  body.add(lights);

  // Main rotor: disc tilts 1.3× the body (extra 0.3× applied on this pivot).
  const rotorPivot = new THREE.Group();
  rotorPivot.position.copy(POINTS.mast);
  body.add(rotorPivot);
  const discSegs = quality === 'low' ? 48 : 72;
  const rotorMat = createRotorMaterial(look, { blades: 5, bladeHalfWidth: 0.27 / ROTOR_R, hull: [1.5 / ROTOR_R, 0.42 / ROTOR_R, 5.2 / ROTOR_R, -3.2 / ROTOR_R] });
  const rotor = new THREE.Mesh(new THREE.CircleGeometry(1, discSegs), rotorMat);
  rotor.name = 'heli.rotor';
  rotor.scale.setScalar(ROTOR_R);
  rotor.rotation.x = -Math.PI / 2;
  rotor.renderOrder = 4;
  rotorPivot.add(rotor);

  const tailMat = createRotorMaterial(look, { blades: 4, bladeHalfWidth: 0.11 / TAIL_R });
  const tail = new THREE.Mesh(new THREE.CircleGeometry(1, 32), tailMat);
  tail.name = 'heli.tailRotor';
  tail.scale.setScalar(TAIL_R);
  tail.position.copy(POINTS.tailRotor);
  tail.rotation.y = Math.PI / 2;
  tail.renderOrder = 4;
  body.add(tail);

  // Real blades for the strobing rotor shadow (layer 1 only — never drawn by the main camera).
  const blades = new THREE.Mesh(buildBlades(look), new THREE.MeshBasicMaterial({ color: C.blade }));
  blades.name = 'heli.bladesShadow';
  blades.layers.set(1);
  blades.castShadow = quality === 'high';
  blades.visible = quality === 'high';
  rotorPivot.add(blades);

  // Emergency flotation bags (hidden; inflate when the heli ditches — DESIGN §3.15).
  const floatGeo = new THREE.CapsuleGeometry(0.55, 2.4, 4, 10).rotateX(Math.PI / 2);
  const floatMat = new THREE.MeshStandardMaterial({ color: '#F5B300', roughness: 0.62 });
  const floats = [1, -1].map((s) => {
    const m = new THREE.Mesh(floatGeo, floatMat);
    m.name = 'heli.float';
    m.position.set(1.95 * s, -0.78, 0.45);
    m.visible = false;
    m.castShadow = true;
    body.add(m);
    return m;
  });

  if (ctx.debug) console.info(`[heli] hull ${Math.round(triCount(hullGeo))} tris`);

  return {
    root,
    body,
    hull,
    hullMat,
    keyline,
    lights,
    lightsMat,
    rotorPivot,
    rotor,
    rotorMat,
    tail,
    tailMat,
    blades,
    decalTex,
    floats,
  };
}
