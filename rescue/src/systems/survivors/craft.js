// Things people float on or cling to (DESIGN §2.10 object table, §3.11):
//   ПСН-6 life raft — hex tube #1E1E1E with an orange band, canopy #FF6A13 with retro-reflective
//     patches and a lamp blinking 60/min, open doorway (people sit in it), ballast pockets underneath
//   capsized hull — motor dory «Мария» style: antifouling #7E2A22, white waterline, keel, rudder, screw;
//     yacht variant (regatta): dark bottom, fin keel and spade rudder in the air
//   20' container — corrugated, awash, faded #9E4636 / #2D5876 / #3D6A4C / #B49440 (instance colour);
//     the world's drifting containers use this same model (world/floaters.js)
//   barge — high-sided rusty deck barge aground («Печора»), faceted rakes, ribbed hatches, deckhouse aft
//   ferry — «Северянка»: navy hull, superstructure with recessed ribbon windows (lit at night/overcast,
//     dark sky-mirroring glass by day), empty davits, raft racks, funnel; trawler wreck «Вайгач»
//   plane — Ан-2 biplane ditched, nose down, lower wing awash, people on the upper wing (op 9★)
// Every batch wears the shared core/weathering.js chunk in the craft's own frame (per-part aWear).
//   stretcher (Stokes litter, orange), lost-person marker buoy (grey), debris (rings, floats, cans, planks)
//
// One CraftBatch (InstancedMesh + per-instance attributes) per model; one shared material patch:
//   aMat  = (kind, flex)  kind: 0 plain, 1 retro tape, 2 lamp, 3 windows, 4 chemlight, 5 nav/always-on
//   aWear = weathering amount of the part (0 lenses/fabric … 1 the batch's preset)
//   iCraft  = (tape lit, lamp, flutter amplitude, lights)  iCraft2 = (dissolve, chem, phase, roughness+)
import * as THREE from 'three';
import { mergeParts, rod, limb, shipHull, hullDeck } from './geo.js';
import { PERSON_SCALE, C } from './tables.js';
import { patchWeathering, WEAR } from '../../core/weathering.js';

const K_PLAIN = 0, K_TAPE = 1, K_LAMP = 2, K_WIN = 3, K_CHEM = 4, K_NAV = 5;
const _cA = new THREE.Color();
const _cB = new THREE.Color();
const S = PERSON_SCALE;

// raft dimensions (real PSN-6 ≈ 2.6 m across, perceptual ×1.5 like its people)
export const RAFT = { R: 1.32 * S, tube: 0.19 * S, floorY: 0.06 * S, doorZ: 1.2 * S, canopyTop: 1.42 * S };

// extra.wear scales the shared weathering per part (0 = clean fabric/lenses … 1 = the batch's preset)
const part = (geometry, color, kind = K_PLAIN, flex = 0, extra = {}) => ({ geometry, color, attrs: { aMat: [kind, flex], aWear: extra.wear ?? 1 }, ...extra });
const ATTRS = { aMat: 2, aWear: 1 };

// ------------------------------------------------------------------------------------------------
// Drop the triangles of a (non-indexed) geometry whose centroid fails keep(x, y, z).
function cutTris(g, keep) {
  const src = g.index ? g.toNonIndexed() : g;
  const P = src.attributes.position.array;
  const N = src.attributes.normal.array;
  const out = [];
  const nrm = [];
  for (let i = 0; i < P.length; i += 9) {
    if (!keep((P[i] + P[i + 3] + P[i + 6]) / 3, (P[i + 1] + P[i + 4] + P[i + 7]) / 3, (P[i + 2] + P[i + 5] + P[i + 8]) / 3)) continue;
    for (let k = 0; k < 9; k++) {
      out.push(P[i + k]);
      nrm.push(N[i + k]);
    }
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  r.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return r;
}

export function raftGeometry() {
  const P = [];
  const { R, tube } = RAFT;
  const y0 = 0.1 * S;
  const y1 = 0.1 * S + tube * 1.85;
  // two stacked hexagonal buoyancy tubes (6 tubular segments → hex) lying flat; wet-dark rubberised
  // fabric with a faint lighter crown where it dries
  const tubeAt = (y, r) => {
    const g = new THREE.TorusGeometry(R, r, 8, 6);
    g.rotateX(Math.PI / 2);
    P.push(part(g, C.raftTube, K_PLAIN, 0, { position: [0, y, 0], vcolor: (x, yy, z, c) => c.multiplyScalar(yy > y + r * 0.5 ? 1.35 : 1) }));
  };
  tubeAt(y0, tube);
  tubeAt(y1, tube * 0.93);
  // orange band around the upper tube (hex prism ring aligned with the tube's corners)
  const band = new THREE.CylinderGeometry(R + tube * 0.96, R + tube * 0.96, 0.07 * S, 6, 1, true, Math.PI / 6);
  P.push(part(band, '#E0601C', K_PLAIN, 0, { position: [0, y1, 0] }));
  // lifeline: rope loops sagging between patches on the upper tube, all the way round
  const RL = R + tube * 1.02;
  const nL = 12;
  for (let i = 0; i < nL; i++) {
    const a0 = (i / nL) * Math.PI * 2;
    const a1 = ((i + 1) / nL) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const yA = y1 + tube * 0.35;
    const pA = [Math.cos(a0) * RL, yA, Math.sin(a0) * RL];
    const pM = [Math.cos(am) * (RL + 0.03 * S), y0 + tube * 0.6, Math.sin(am) * (RL + 0.03 * S)];
    const pB = [Math.cos(a1) * RL, yA, Math.sin(a1) * RL];
    P.push(part(rod(pA, pM, 0.011 * S, 0.011 * S, 3, false), '#837C6A', K_PLAIN, 0, { wear: 0.5 }));
    P.push(part(rod(pM, pB, 0.011 * S, 0.011 * S, 3, false), '#837C6A', K_PLAIN, 0, { wear: 0.5 }));
    P.push(part(new THREE.BoxGeometry(0.06 * S, 0.05 * S, 0.06 * S), '#1A1A1A', K_PLAIN, 0, { position: pA })); // patch
  }
  // floor (dark) and four yellow ballast pockets underneath (seen when the raft is capsized)
  P.push(part(new THREE.CylinderGeometry(R, R, 0.05 * S, 6, 1, false, Math.PI / 6), '#2A2A2A', K_PLAIN, 0, { position: [0, RAFT.floorY, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    P.push(part(new THREE.SphereGeometry(0.26 * S, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#B89A3A', K_PLAIN, 0, {
      position: [Math.cos(a) * R * 0.55, 0.02, Math.sin(a) * R * 0.55],
    }));
  }
  // canopy: a FLAT dome (≈0.74 R high) of six panels sagging between the arch tube and the buoyancy
  // tube, darker seams, sun-bleached crown, wet-dark lower third; a real doorway cut into the +Z side
  // (rim up to ~60 % height) with the dark inside showing through it
  const base = y1 + tube * 0.55;
  const RD = R * 1.02;
  const HK = 0.64;
  const half = 0.62; // doorway half-angle at the rim
  const inDoor = (x, y, z) => {
    const rh = Math.hypot(x, z) / RD;
    const ang = Math.abs(Math.atan2(x, z));
    return ang < half * Math.sqrt(Math.min(1, Math.max(0, (rh - 0.52) / 0.3)));
  };
  const domeGeo = (scale) => {
    const g = new THREE.SphereGeometry(RD * scale, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const rh = Math.hypot(x, z);
      const el = y / (RD * scale); // 0 rim … 1 crown
      // panel sag: dips between the six ribs (the arch is two of them), strongest mid-height
      const th = Math.atan2(z, x);
      const sag = 0.06 * S * Math.abs(Math.sin(3 * th)) ** 0.7 * Math.sin(Math.PI * Math.min(1, el * 1.1));
      const k = rh > 1e-4 ? Math.max(0, rh - sag) / rh : 1;
      p[i] = x * k;
      p[i + 2] = z * k;
      p[i + 1] = y * HK - sag * 0.6;
    }
    g.computeVertexNormals();
    return cutTris(g, (x, y, z) => !inDoor(x, y, z));
  };
  const BLEACH = new THREE.Color('#D98058');
  P.push(part(domeGeo(1), C.canopy, K_PLAIN, 1, {
    position: [0, base, 0],
    wear: 0.6,
    vcolor: (x, y, z, c) => {
      const el = Math.max(0, (y - base) / (RD * HK));
      c.lerp(BLEACH, Math.min(1, Math.max(0, (el - 0.35) / 0.55)));
      const th = Math.atan2(z, x);
      if (Math.abs(Math.cos(3 * th)) > 0.985 && el < 0.97) c.multiplyScalar(0.45); // panel seams
      if (el < 0.33) c.multiplyScalar(0.6 + 1.2 * el); // wet lower third
    },
  }));
  P.push(part(domeGeo(0.965), '#4A2412', K_PLAIN, 1, { position: [0, base, 0], wear: 0 })); // inside, in shade
  // arch tube across the canopy (black, proud of the fabric) — the ridge line
  const arch = new THREE.TorusGeometry(RD * 1.012, 0.04 * S, 6, 20, Math.PI);
  P.push(part(arch, '#1E1E1E', K_PLAIN, 0.3, { position: [0, base, 0], scale: [1, HK, 1] }));
  // doorway rim: dark trim around the cut (two meridian strips + the lintel)
  for (const sd of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const rh0 = RD * (0.98 - j * 0.15), rh1 = RD * (0.98 - (j + 1) * 0.15);
      const hA = Math.sqrt(Math.max(0, 1 - (rh0 / RD) ** 2)) * RD * HK;
      const hB = Math.sqrt(Math.max(0, 1 - (rh1 / RD) ** 2)) * RD * HK;
      const aA = sd * half * Math.sqrt(Math.min(1, Math.max(0, (rh0 / RD - 0.52) / 0.3)));
      const aB = sd * half * Math.sqrt(Math.min(1, Math.max(0, (rh1 / RD - 0.52) / 0.3)));
      P.push(part(rod([Math.sin(aA) * rh0, base + hA, Math.cos(aA) * rh0], [Math.sin(aB) * rh1, base + hB, Math.cos(aB) * rh1], 0.022 * S, 0.022 * S, 4), '#2B1A12', K_PLAIN, 0.5));
    }
  }
  // retro-reflective patches on the canopy (SOLAS): four strips around the top
  const domeY = (rr) => base + HK * Math.sqrt(Math.max(0, RD * RD - rr * rr));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rr = R * 0.6;
    const y = domeY(rr) + 0.015;
    const slope = Math.atan((HK * rr) / Math.sqrt(RD * RD - rr * rr));
    P.push(part(new THREE.BoxGeometry(0.42 * S, 0.012, 0.12 * S), C.tape, K_TAPE, 0.8, {
      position: [Math.cos(a) * rr, y, Math.sin(a) * rr],
      rotation: [0, -a, -slope, 'YXZ'],
      wear: 0.3,
    }));
  }
  // lamp on top (white lens + dark housing) and a chemlight tied to the arch
  const top = domeY(0);
  P.push(part(new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.06 * S, 8), '#202020', K_PLAIN, 0.5, { position: [0, top + 0.02, 0] }));
  P.push(part(new THREE.SphereGeometry(0.05 * S, 8, 6), '#F4F8FF', K_LAMP, 0.5, { position: [0, top + 0.07 * S, 0], wear: 0 }));
  P.push(part(new THREE.CylinderGeometry(0.018 * S, 0.018 * S, 0.12 * S, 6), '#9CFF84', K_CHEM, 0.6, {
    position: [R * 0.5, domeY(R * 0.5) + 0.03, R * 0.35],
    rotation: [0.4, 0, 1.0],
    wear: 0,
  }));
  // boarding ramp + rope boarding ladder hanging from the door into the sea
  P.push(part(new THREE.BoxGeometry(0.7 * S, 0.06 * S, 0.45 * S), '#2A2A2A', K_PLAIN, 0, { position: [0, 0.1 * S, R + tube * 0.9] }));
  const zl = R + tube * 1.25;
  for (const sx of [-1, 1]) P.push(part(rod([sx * 0.2 * S, y1, zl], [sx * 0.2 * S, -0.35 * S, zl + 0.08 * S], 0.014 * S, 0.014 * S, 3), '#D8D2BC', K_PLAIN, 0, { wear: 0.6 }));
  for (let j = 0; j < 3; j++) {
    const yy = y1 - 0.08 * S - j * 0.22 * S;
    P.push(part(new THREE.BoxGeometry(0.42 * S, 0.03 * S, 0.04 * S), '#C9A227', K_PLAIN, 0, { position: [0, yy, zl + (j * 0.03 + 0.01) * S], wear: 0.6 }));
  }
  const g = mergeParts(P, ATTRS);
  // dome flex by height above the tube
  const pos = g.attributes.position.array;
  const mat = g.attributes.aMat.array;
  for (let i = 0; i < mat.length / 2; i++) {
    if (mat[i * 2 + 1] > 0.99) mat[i * 2 + 1] = Math.min(1, Math.max(0, (pos[i * 3 + 1] - base) / (RD * HK)));
  }
  return g;
}

// ------------------------------------------------------------------------------------------------
// Capsized hull: the boat geometry is built upright then flipped (keel up). Origin at the waterline.
export function capsizedHullGeometry(style = 'boat') {
  const P = [];
  const yacht = style === 'yacht';
  const L = yacht ? 10.5 : 9.2;
  const B = yacht ? 3.4 : 3.0;
  const keel = yacht ? 0.95 : 1.05; // hull depth below the sheer reference
  const hull = shipHull({ length: L, beam: B, keel, freeboard: 0.25, bowStart: yacht ? 0.5 : 0.58, sternTaper: yacht ? 0.75 : 0.7, stations: 16 });
  // Upright hull: keel at −keel, sheer at +0.25. Capsized: rotate π about Z → keel at +keel.
  // We float it with ~0.45 of the depth above water: shift so the keel stands ~0.75 m proud.
  const lift = yacht ? -0.25 : -0.32;
  const bottom = yacht ? '#1F2A44' : C.hull;
  P.push(part(hull, bottom, K_PLAIN, 0, {
    rotation: [0, 0, Math.PI],
    position: [0, lift, 0],
    vcolor: (x, y, z, c) => {
      // after the flip: y is up. White boot-top stripe at the waterline, topsides (under water) white/blue
      if (y < 0.02 && y > -0.16) c.set(C.waterline);
      else if (y <= -0.16) c.set(yacht ? '#E8E8E4' : '#3C5A6E');
      else if (yacht && y > 0.02) c.set('#1F2A44');
    },
  }));
  if (yacht) {
    // fin keel + bulb and spade rudder, pointing at the sky
    P.push(part(new THREE.BoxGeometry(0.16, 1.7, 1.3), '#2A3036', K_PLAIN, 0, { position: [0, keel + lift + 0.85, 0.3] }));
    P.push(part(new THREE.CapsuleGeometry(0.22, 1.1, 3, 8), '#3A3F44', K_PLAIN, 0, { position: [0, keel + lift + 1.7, 0.35], rotation: [Math.PI / 2, 0, 0] }));
    P.push(part(new THREE.BoxGeometry(0.1, 1.0, 0.55), '#2A3036', K_PLAIN, 0, { position: [0, keel * 0.6 + lift + 0.5, L / 2 - 1.2] }));
  } else {
    // keel strip, skeg, rudder and a 3-blade screw at the stern
    P.push(part(new THREE.BoxGeometry(0.14, 0.12, L * 0.82), '#3A1814', K_PLAIN, 0, { position: [0, keel + lift + 0.05, -0.2] }));
    P.push(part(new THREE.BoxGeometry(0.1, 0.55, 0.5), '#3A1814', K_PLAIN, 0, { position: [0, keel + lift + 0.2, L / 2 - 0.55] }));
    P.push(part(new THREE.BoxGeometry(0.06, 0.6, 0.42), '#4A4A48', K_PLAIN, 0, { position: [0, keel * 0.75 + lift + 0.32, L / 2 - 0.1] }));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      P.push(part(new THREE.BoxGeometry(0.06, 0.26, 0.04), '#B08A3A', K_PLAIN, 0, {
        position: [Math.sin(a) * 0.13, keel * 0.7 + lift + 0.22 + Math.cos(a) * 0.13, L / 2 - 0.42],
        rotation: [0.3, 0, a],
      }));
    }
    // bilge rubbing strakes
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.06, 0.06, L * 0.6), '#5A2018', K_PLAIN, 0, { position: [s * B * 0.27, keel * 0.6 + lift, -0.3] }));
  }
  const g = mergeParts(P, ATTRS);
  g.userData = { L, B, keelY: keel + lift, yacht };
  return g;
}

// The boat's name on a capsized hull (DESIGN §2.10 «МАРИЯ»): painted on both bottom flanks amidships,
// upside down now that she floats keel up, in the capsized frame of capsizedHullGeometry(). The two
// strips are bent onto the hull section station by station so they hug the curve. UV: text space.
export function hullNameGeometry(style = 'boat') {
  const yacht = style === 'yacht';
  const L = yacht ? 10.5 : 9.2;
  const B = yacht ? 3.4 : 3.0;
  const keel = yacht ? 0.95 : 1.05;
  const bowStart = yacht ? 0.5 : 0.58;
  const sternTaper = yacht ? 0.75 : 0.7;
  const lift = yacht ? -0.25 : -0.32;
  // same half-beam / depth profile as geo.shipHull()
  const prof = (k) => {
    if (k > bowStart) {
      const t = (k - bowStart) / (1 - bowStart);
      return Math.sqrt(Math.max(0, 1 - t * t * 1.02)) * 0.5 * B;
    }
    const t = k / bowStart;
    return (sternTaper + (1 - sternTaper) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * 0.5 * B;
  };
  const kdAt = (k) => keel * (0.75 + 0.25 * Math.sin(Math.min(1, k * 1.15) * Math.PI));
  const len = yacht ? 2.1 : 1.9; // text length along the hull
  const zc = L / 2 - 0.38 * L; // a little aft of amidships, where the section is constant
  const pos = [];
  const uv = [];
  const nrm = [];
  for (const side of [1, -1]) {
    const pl = new THREE.PlaneGeometry(1, 1, 10, 1).toNonIndexed();
    const P = pl.attributes.position.array;
    const U = pl.attributes.uv.array;
    for (let i = 0; i < P.length / 3; i++) {
      const u = P[i * 3];
      const v = P[i * 3 + 1] + 0.5;
      // seen from outside, the text runs bow→stern on the port side and stern→bow to starboard
      const z = zc - side * u * len;
      const k = (L / 2 - z) / L;
      const w = prof(k);
      const kd = kdAt(k);
      // upright frame: bottom slope from P1 (deep, near the keel) to P2 (towards the chine)
      const ax = 0.45 * w, ay = -0.82 * kd, bx = 0.82 * w, by = -0.45 * kd;
      const t = 0.18 + 0.64 * v;
      let nx = by - ay;
      let ny = -(bx - ax);
      const nl = Math.hypot(nx, ny);
      nx /= nl;
      ny /= nl;
      const x = side * (ax + (bx - ax) * t + nx * 0.03);
      const y = ay + (by - ay) * t + ny * 0.03;
      // capsize (π about Z) and float like the hull
      pos.push(-x, -y + lift, z);
      nrm.push(-side * nx, -ny, 0);
      uv.push(U[i * 2], U[i * 2 + 1]);
    }
    pl.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// ------------------------------------------------------------------------------------------------
// 20' container floating almost awash (one model for survivor containers AND the world's drifting
// containers). Origin at the waterline, long axis Z, door end at +Z; body white × instance colour.
// Corrugated walls, dented roof, corner castings, door seam, hinges and lock bars; rust, salt and
// algae come from the shared weathering in the craft frame.
export const CONT = { L: 6.06, W: 2.44, H: 2.59, freeboard: 0.6 };
// faded, salt-dulled paint for the catalogue colours (DESIGN §2.10 lists the factory colours)
const CONT_FADE = { '#b3412e': '#9E4636', '#1f5e8c': '#2D5876', '#2f7d4f': '#3D6A4C', '#c9a227': '#B49440' };
export function containerPaint(hex) {
  const k = String(hex || '').toLowerCase();
  if (CONT_FADE[k]) return CONT_FADE[k];
  const c = new THREE.Color(hex || '#9E4636');
  const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
  return '#' + c.lerp(new THREE.Color(l, l, l), 0.3).multiplyScalar(0.92).getHexString();
}
export function containerGeometry() {
  const P = [];
  const { L, W, H, freeboard } = CONT;
  const yc = freeboard - H / 2; // body centre
  const body = new THREE.BoxGeometry(W, H, L, 2, 1, 10);
  // roof dents: jitter the roof's inner vertices downwards (deterministic)
  const bp = body.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    if (y > H / 2 - 1e-3 && Math.abs(x) < W / 2 - 1e-3 && Math.abs(z) < L / 2 - 1e-3) bp.setY(i, y - 0.03 - 0.05 * (0.5 + 0.5 * Math.sin(z * 4.7 + x * 3.1)));
  }
  body.computeVertexNormals();
  P.push(part(body, '#FFFFFF', K_PLAIN, 0, { position: [0, yc, 0] }));
  // corrugated sides (vertical ribs) and roof (transverse ribs)
  const ribs = 18;
  for (let i = 0; i < ribs; i++) {
    const z = -L / 2 + 0.3 + (i / (ribs - 1)) * (L - 0.6);
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.05, H * 0.92, 0.12), '#E2E2E2', K_PLAIN, 0, { position: [s * (W / 2 + 0.025), yc, z] }));
  }
  for (let i = 0; i < 11; i++) {
    const z = -L / 2 + 0.35 + (i / 10) * (L - 0.7);
    P.push(part(new THREE.BoxGeometry(W * 0.94, 0.035, 0.16), '#D8D8D8', K_PLAIN, 0, { position: [0, freeboard - 0.02 - 0.02 * (i % 3), z] }));
  }
  // corner posts + top/bottom rails in the body paint, rusty corner castings at all eight corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.push(part(new THREE.BoxGeometry(0.17, H, 0.17), '#D0D0D0', K_PLAIN, 0, { position: [sx * (W / 2 - 0.06), yc, sz * (L / 2 - 0.06)] }));
      for (const sy of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.2, 0.13, 0.2), '#3E3028', K_PLAIN, 0, { position: [sx * (W / 2 - 0.07), yc + sy * (H / 2 - 0.04), sz * (L / 2 - 0.07)] }));
    }
    P.push(part(new THREE.BoxGeometry(0.12, 0.11, L - 0.3), '#C8C8C8', K_PLAIN, 0, { position: [sx * (W / 2 - 0.03), freeboard - 0.05, 0] }));
  }
  for (const sz of [-1, 1]) P.push(part(new THREE.BoxGeometry(W - 0.3, 0.11, 0.12), '#C8C8C8', K_PLAIN, 0, { position: [0, freeboard - 0.05, sz * (L / 2 - 0.03)] }));
  // door end: centre seam, hinges, four lock bars with cams and handles
  const dz = L / 2 + 0.02;
  P.push(part(new THREE.BoxGeometry(0.04, H * 0.94, 0.03), '#2A2522', K_PLAIN, 0, { position: [0, yc, dz] }));
  for (const sx of [-1, 1]) for (let j = 0; j < 4; j++) P.push(part(new THREE.BoxGeometry(0.1, 0.16, 0.06), '#5A4A40', K_PLAIN, 0, { position: [sx * (W / 2 - 0.16), yc - H * 0.4 + j * H * 0.27, dz + 0.02] }));
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + 0.38 + i * 0.56;
    P.push(part(new THREE.CylinderGeometry(0.024, 0.024, H * 0.95, 5), '#7A746C', K_PLAIN, 0, { position: [x, yc, dz + 0.05] }));
    P.push(part(new THREE.BoxGeometry(0.05, 0.05, 0.26), '#7A746C', K_PLAIN, 0, { position: [x + 0.06, yc - 0.35, dz + 0.16], rotation: [0, 0.5, 0] }));
  }
  // a strip of reflective marking along the top rail (container stencils often carry it) — subtle
  P.push(part(new THREE.BoxGeometry(0.02, 0.05, 1.2), C.tape, K_TAPE, 0, { position: [W / 2 + 0.06, freeboard - 0.12, -L / 2 + 1.0], wear: 0.3 }));
  return mergeParts(P, ATTRS);
}

// ------------------------------------------------------------------------------------------------
// Barge «Печора» aground (deck survivors without a world structure). deckY = deck height above the
// water. Black/rust-brown riveted hull with flat-plated raked ends (two facets each), big rust
// patches and runs from the deck edge; lighter worn deck with ribbed hatch covers, scattered cargo,
// an aft deckhouse with door/windows and a mast with lights.
function hexa(zA, wA, bA, zB, wB, bB, top) {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const b = p.getZ(i) > 0;
    const w = b ? wB : wA;
    p.setXYZ(i, Math.sign(p.getX(i)) * w, p.getY(i) > 0 ? top : b ? bB : bA, b ? zB : zA);
  }
  g.computeVertexNormals();
  return g;
}
export function bargeGeometry(deckY = 6) {
  const P = [];
  const L = 34, B = 10, draft = 2.2;
  const HULL = '#3A2A24', RUST = '#6A3E26', DECK = '#6A645A';
  const box = (w, h, d, x, y, z, color, kind = K_PLAIN, extra = {}) => P.push(part(new THREE.BoxGeometry(w, h, d), color, kind, 0, { position: [x, y, z], ...extra }));
  const hullCol = (x, y, z, c) => {
    if (y < 0.35) c.set('#2A1E1A');
    else if (y > deckY - 0.35) c.set('#4A3A30');
  };
  // midbody + two-facet rakes at both ends
  P.push(part(hexa(-13, B / 2, -draft, 13, B / 2, -draft, deckY), HULL, K_PLAIN, 0, { vcolor: hullCol }));
  for (const s of [-1, 1]) {
    const a = hexa(13, B / 2, -draft, 15.6, B / 2 - 0.1, -0.5, deckY);
    const b = hexa(15.6, B / 2 - 0.1, -0.5, 17, B / 2 - 0.45, 1.4, deckY);
    if (s < 0) {
      a.rotateY(Math.PI);
      b.rotateY(Math.PI);
    }
    P.push(part(a, HULL, K_PLAIN, 0, { vcolor: hullCol }), part(b, HULL, K_PLAIN, 0, { vcolor: hullCol }));
    // the rake's plate seams (knuckles)
    box(B - 0.15, 0.08, 0.08, 0, -0.5, s * 15.6, '#1E1714');
  }
  // big rust patches and runs from the deck edge down the topsides (both sides)
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = -14 + i * 3.4 + ((i * 7) % 5) * 0.3;
      const h = 0.8 + ((i * 5) % 4) * 0.55;
      const y = 0.6 + ((i * 3) % 5) * 0.75;
      box(0.04, h, 1.2 + ((i * 11) % 4) * 0.6, s * (B / 2 + 0.02), Math.min(deckY - h / 2 - 0.2, y + h / 2), z, i % 3 ? RUST : '#5A3A28', K_PLAIN, { wear: 0.6 });
    }
    for (let i = 0; i < 14; i++) {
      const z = -15.5 + i * 2.3 + ((i * 7) % 3) * 0.3;
      const len = 1.4 + ((i * 5) % 5) * 0.55;
      _cA.set('#7A4428');
      _cB.set(HULL);
      P.push(part(new THREE.BoxGeometry(0.04, len, 0.16 + ((i * 3) % 3) * 0.08), '#7A4428', K_PLAIN, 0, {
        position: [s * (B / 2 + 0.035), deckY - 0.15 - len / 2, z],
        wear: 0.4,
        vcolor: (x, y, zz, c) => c.copy(_cA).lerp(_cB, Math.min(1, Math.max(0, (deckY - 0.15 - y) / len)) ** 0.7),
      }));
    }
  }
  // deck: worn plate, coaming, three ribbed hatch covers, cargo left on deck
  box(B - 0.3, 0.1, 33.4, 0, deckY + 0.05, 0, DECK);
  for (let i = 0; i < 3; i++) {
    const z = -11 + i * 7;
    box(B * 0.62, 0.55, 5.5, 0, deckY + 0.32, z, '#4E564C');
    for (let k = 0; k < 9; k++) box(B * 0.62 + 0.04, 0.08, 0.12, 0, deckY + 0.63, z - 2.5 + k * 0.625, '#3E463C', K_PLAIN, { wear: 0.8 });
    box(0.08, 0.06, 5.4, 0, deckY + 0.62, z, '#2E322C');
  }
  // cargo: sacks, a stack of planks, drums, a coil of rope
  for (let i = 0; i < 6; i++) P.push(part(new THREE.SphereGeometry(0.42, 8, 5), '#8A7A5A', K_PLAIN, 0, { position: [-3.6 + (i % 3) * 0.75, deckY + 0.24, -6.5 + Math.floor(i / 3) * 0.9 + (i % 2) * 0.2], scale: [1.2, 0.5, 0.8], rotation: [0, i * 0.7, 0], wear: 0.6 }));
  for (let k = 0; k < 4; k++) box(1.2, 0.12, 4.2, 3.4, deckY + 0.16 + k * 0.13, 0.5 + (k % 2) * 0.12, '#7A6248', K_PLAIN, { rotation: [0, 0.04 * k, 0], wear: 0.8 });
  for (let i = 0; i < 3; i++) P.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), i === 1 ? '#2D5876' : '#6A3A26', K_PLAIN, 0, { position: [3.6 - i * 0.66, deckY + 0.45, 6.4 + (i % 2) * 0.3] }));
  P.push(part(new THREE.TorusGeometry(0.45, 0.09, 5, 12), '#9A8A64', K_PLAIN, 0, { position: [-3.2, deckY + 0.1, 3.4], rotation: [Math.PI / 2, 0, 0] }));
  for (const s of [-1, 1]) for (const z of [-15, -6, 4, 14]) P.push(part(new THREE.CylinderGeometry(0.18, 0.2, 0.5, 8), '#1A1A1A', K_PLAIN, 0, { position: [s * (B / 2 - 0.5), deckY + 0.3, z] }));
  // deckhouse aft: door, windows, rails on its roof, mast with lights
  const hz = L / 2 - 4.2;
  box(5.5, 3.0, 4.2, 0, deckY + 1.5, hz, '#C8C6BC');
  box(5.7, 0.12, 4.4, 0, deckY + 3.06, hz, '#6E706A');
  box(1.0, 2.0, 0.05, -1.4, deckY + 1.0, hz - 2.12, '#2A2E30');
  for (let i = 0; i < 2; i++) box(0.8, 0.6, 0.05, 0.6 + i * 1.3, deckY + 2.0, hz - 2.12, '#121A20', K_WIN, { wear: 0 });
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) box(0.05, 0.6, 0.8, s * 2.77, deckY + 2.0, hz - 0.9 + i * 1.6, '#121A20', K_WIN, { wear: 0 });
  P.push(part(rod([0, deckY + 3, hz], [0, deckY + 7.5, hz], 0.08, 0.06, 5), '#B9BCB6'));
  P.push(part(rod([-1.0, deckY + 6.4, hz], [1.0, deckY + 6.4, hz], 0.04, 0.04, 4), '#B9BCB6'));
  P.push(part(new THREE.SphereGeometry(0.16, 6, 5), '#FFFFFF', K_NAV, 0, { position: [0, deckY + 7.6, hz], wear: 0 }));
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.12, 6, 5), s < 0 ? '#FF2015' : '#12FF6E', K_NAV, 0, { position: [s * 1.0, deckY + 6.5, hz], wear: 0 }));
  // railing along the stern and the deck edges aft
  for (let i = 0; i <= 8; i++) P.push(part(rod([-B / 2 + 0.3 + i * (B - 0.6) / 8, deckY, L / 2 - 0.3], [-B / 2 + 0.3 + i * (B - 0.6) / 8, deckY + 1.0, L / 2 - 0.3], 0.03, 0.03, 4), '#A9A496'));
  P.push(part(rod([-B / 2 + 0.3, deckY + 1.0, L / 2 - 0.3], [B / 2 - 0.3, deckY + 1.0, L / 2 - 0.3], 0.04, 0.04, 4), '#A9A496'));
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 6; i++) P.push(part(rod([s * (B / 2 - 0.2), deckY, 4 + i * 2], [s * (B / 2 - 0.2), deckY + 1.0, 4 + i * 2], 0.03, 0.03, 4), '#A9A496'));
    P.push(part(rod([s * (B / 2 - 0.2), deckY + 1.0, 4], [s * (B / 2 - 0.2), deckY + 1.0, 16], 0.04, 0.04, 4), '#A9A496'));
  }
  const g = mergeParts(P, ATTRS);
  g.userData = { L, B, deckY, stand: [0, deckY, L / 2 - 9], collarR: 5.6, elong: 3.2, model: 'barge' }; // where people gather (near the deckhouse)
  return g;
}

// ------------------------------------------------------------------------------------------------
// Big-vessel helpers. Half-beam of a geo.shipHull at z (same profile), and a part-list builder with
// the recurring details (boxes, ribbon windows set under a lip, hull-side rust runs).
function hullHalfBeam(z, L, B, bowStart, sternTaper) {
  const k = (L / 2 - z) / L;
  if (k > bowStart) {
    const t = (k - bowStart) / (1 - bowStart);
    return Math.sqrt(Math.max(0, 1 - t * t * 1.02)) * 0.5 * B;
  }
  const t = k / bowStart;
  return (sternTaper + (1 - sternTaper) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * 0.5 * B;
}

function shipKit(P, hw) {
  const box = (w, h, d, x, y, z, color, kind = K_PLAIN, extra = {}) => P.push(part(new THREE.BoxGeometry(w, h, d), color, kind, 0, { position: [x, y, z], ...extra }));
  return {
    box,
    // ribbon window along a side wall (outer face at |x| = x0, side s): dark glass, mullions, a lip above
    ribbonX(s, x0, yC, z0, z1, h, lip = '#E4E3DC', pitch = 1.4) {
      const len = z1 - z0;
      const zc = (z0 + z1) / 2;
      box(0.04, h, len, s * (x0 + 0.01), yC, zc, '#121A20', K_WIN, { wear: 0 });
      box(0.24, 0.1, len + 0.3, s * (x0 + 0.11), yC + h / 2 + 0.07, zc, lip);
      box(0.08, 0.06, len, s * (x0 + 0.04), yC - h / 2 - 0.03, zc, '#8E908C', K_PLAIN, { wear: 1 });
      const n = Math.max(1, Math.round(len / pitch));
      for (let i = 0; i <= n; i++) box(0.07, h, 0.08, s * (x0 + 0.035), yC, z0 + (i / n) * len, '#1E252A', K_PLAIN, { wear: 0.3 });
    },
    // the same on a wall facing ±Z (outer face at z0, facing f = ±1)
    ribbonZ(f, z0, yC, x0, x1, h, lip = '#E4E3DC', pitch = 1.1) {
      const len = x1 - x0;
      const xc = (x0 + x1) / 2;
      box(len, h, 0.04, xc, yC, z0 + f * 0.01, '#121A20', K_WIN, { wear: 0 });
      box(len + 0.3, 0.1, 0.24, xc, yC + h / 2 + 0.07, z0 + f * 0.11, lip);
      const n = Math.max(1, Math.round(len / pitch));
      for (let i = 0; i <= n; i++) box(0.08, h, 0.07, x0 + (i / n) * len, yC, z0 + f * 0.035, '#1E252A', K_PLAIN, { wear: 0.3 });
    },
    // rust run down the hull side from (z, yTop): fades into the hull colour below
    run(s, z, yTop, len, width, rust, base) {
      const w = hw(z);
      const dw = (hw(z + 0.3) - hw(z - 0.3)) / 0.6;
      _cA.set(rust);
      _cB.set(base);
      P.push(part(new THREE.BoxGeometry(0.04, len, width), rust, K_PLAIN, 0, {
        position: [s * (w * 1.012 + 0.03), yTop - len / 2, z],
        rotation: [0, Math.atan(s * dw), 0],
        wear: 0.4,
        vcolor: (x, y, zz, c) => c.copy(_cA).lerp(_cB, Math.min(1, Math.max(0, (yTop - y) / len)) ** 0.7),
      }));
    },
    // hawse pipe (dark ring on the bow flank) with its rust run
    hawse(s, z, y, rust, base) {
      const w = hw(z);
      const dw = (hw(z + 0.3) - hw(z - 0.3)) / 0.6;
      P.push(part(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10), '#1A1614', K_PLAIN, 0, {
        position: [s * (w * 1.01 + 0.02), y, z],
        rotation: [0, Math.atan(s * dw), Math.PI / 2, 'YXZ'],
        wear: 0.3,
      }));
      this.run(s, z, y - 0.25, 2.8, 0.42, rust, base);
    },
    rail(s, z0, z1, y, inset, color = '#D3D3CB') {
      const n = Math.max(1, Math.round((z1 - z0) / 1.6));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const z = z0 + (i / n) * (z1 - z0);
        const x = s * (hw(z) - inset);
        P.push(part(rod([x, y, z], [x, y + 1.05, z], 0.03, 0.03, 4), color, K_PLAIN, 0, { wear: 0.6 }));
        if (prev) P.push(part(rod([prev[0], y + 1.05, prev[1]], [x, y + 1.05, z], 0.04, 0.04, 4), color, K_PLAIN, 0, { wear: 0.6 }));
        prev = [x, z];
      }
    },
  };
}

// Sinking ferry «Северянка». Origin at the waterline amidships, bow towards −Z. Stern deck at deckY.
// Navy hull, white superstructure with recessed ribbon windows (lit cabins at night, dark glass by
// day), EMPTY lifeboat davits with their falls hanging, liferaft racks with two canisters gone, a
// sooty funnel with the company band, radar mast, lifejacket lockers, stern-door seams, rust runs from
// the hawses and scuppers.
export function ferryGeometry(deckY = 6) {
  const P = [];
  const L = 52, B = 11.5, bowStart = 0.62, sternTaper = 0.82;
  const NAVY = '#1E3348', WHITE = '#D6D5CC', RUST = '#6B3A22', ROOF = '#83877F';
  const hw = (z) => hullHalfBeam(z, L, B, bowStart, sternTaper);
  const K = shipKit(P, hw);
  const { box } = K;
  const hull = shipHull({ length: L, beam: B, keel: 4.2, freeboard: deckY, bowStart, sternTaper, stations: 22, deckRise: 2.2, rows: [-0.32, -0.28, 0.28, 0.32, deckY - 0.97, deckY - 0.93] });
  P.push(part(hull, NAVY, K_PLAIN, 0, {
    vcolor: (x, y, z, c) => {
      if (y < -0.3) c.set('#4E2620'); // antifouling
      else if (y < 0.3) c.set('#7E3428'); // boot-top
      else if (y > deckY - 0.95) c.set(WHITE); // sheer strake
    },
  }));
  P.push(part(hullDeck(hull, deckY + 0.02, 0.25), '#565E58', K_PLAIN, 0));
  // superstructure: lounge deck, boat deck house, bridge with wings
  const sx = B * 0.82;
  box(sx, 2.8, 28, 0, deckY + 1.4, -4, WHITE);
  box(sx * 0.86, 2.6, 18, 0, deckY + 4.1, -7, WHITE);
  box(sx * 0.7, 2.4, 6, 0, deckY + 6.6, -12, WHITE);
  box(sx * 0.98, 0.22, 1.8, 0, deckY + 5.5, -14.1, WHITE);
  box(sx * 0.98, 0.9, 0.06, 0, deckY + 6.05, -15.0, WHITE); // wing bulwark
  // painted (grey) roof decks — no bright white planes from above
  box(sx - 0.3, 0.04, 27.7, 0, deckY + 2.82, -4, ROOF);
  box(sx * 0.86 - 0.3, 0.04, 17.7, 0, deckY + 5.42, -7, ROOF);
  box(sx * 0.7 - 0.3, 0.04, 5.7, 0, deckY + 7.82, -12, ROOF);
  for (const s of [-1, 1]) {
    K.ribbonX(s, sx / 2, deckY + 1.6, -17.2, -2.4, 0.85);
    K.ribbonX(s, sx / 2, deckY + 1.6, -0.6, 9.0, 0.85);
    K.ribbonX(s, sx * 0.43, deckY + 4.3, -15.4, 1.4, 0.8);
    K.ribbonX(s, sx * 0.35, deckY + 6.9, -14.6, -9.6, 0.8, WHITE, 1.0);
    box(0.05, 2.0, 1.0, s * (sx / 2 + 0.01), deckY + 1.0, -1.5, '#2A3036'); // side door
  }
  K.ribbonZ(-1, -15.0, deckY + 6.95, -sx * 0.33, sx * 0.33, 0.95);
  K.ribbonZ(1, 10.0, deckY + 1.7, -sx / 2 + 0.5, -1.0, 0.8);
  K.ribbonZ(1, 10.0, deckY + 1.7, 1.0, sx / 2 - 0.5, 0.8);
  box(1.2, 2.0, 0.05, 0, deckY + 1.0, 10.02, '#2A3036'); // aft door to the lounge
  box(sx * 0.86 - 0.6, 0.7, 0.04, 0, deckY + 4.3, 2.01, '#121A20', K_WIN, { wear: 0 });
  // EMPTY lifeboat davits (the boats are gone): arms swung out, falls hanging down the side
  const DAV = '#D2D3CC';
  for (const s of [-1, 1]) {
    for (const zc of [-12.5, -3.5]) {
      for (const dz of [-2.3, 2.3]) {
        const z = zc + dz;
        const yb = deckY + 2.8;
        const xa = s * (sx / 2 - 0.25);
        const xb = s * (sx / 2 + 0.35);
        const xt = s * (sx / 2 + 1.25);
        P.push(part(rod([xa, yb, z], [xb, yb + 1.9, z], 0.11, 0.08, 5), DAV));
        P.push(part(rod([xb, yb + 1.9, z], [xt, yb + 2.1, z], 0.08, 0.07, 5), DAV));
        const xf = xt + s * 0.12;
        const zf = z + (dz > 0 ? 0.25 : -0.15);
        P.push(part(rod([xt, yb + 2.0, z], [xf, deckY - 2.4, zf], 0.025, 0.025, 3), '#2E2A26', K_PLAIN, 0, { wear: 0.2 }));
        box(0.22, 0.42, 0.16, xf, deckY - 2.6, zf, '#34332F');
      }
    }
  }
  // funnel: raked, sooty top, blue company band with a red line; exhaust stubs
  const SOOT = new THREE.Color('#24221F');
  const fy = deckY + 7.3;
  const rk = 0.1;
  P.push(part(new THREE.CylinderGeometry(1.15, 1.35, 4.2, 16, 6), WHITE, K_PLAIN, 0, {
    position: [0, fy, 1.2],
    rotation: [rk, 0, 0],
    scale: [1, 1, 1.5],
    vcolor: (x, y, z, c) => c.lerp(SOOT, 0.85 * Math.min(1, Math.max(0, (y - (fy + 0.8)) / 1.3)) ** 1.3),
  }));
  P.push(part(new THREE.CylinderGeometry(1.215, 1.24, 0.8, 16), '#1F4A78', K_PLAIN, 0, { position: [0, fy + 0.3, 1.2 + 0.3 * rk], rotation: [rk, 0, 0], scale: [1, 1, 1.5] }));
  P.push(part(new THREE.CylinderGeometry(1.23, 1.245, 0.14, 16), '#A8281E', K_PLAIN, 0, { position: [0, fy + 0.3, 1.2 + 0.3 * rk], rotation: [rk, 0, 0], scale: [1, 1, 1.5] }));
  P.push(part(new THREE.CylinderGeometry(0.98, 0.98, 0.3, 16), '#141412', K_PLAIN, 0, { position: [0, fy + 2.12, 1.2 + 2.1 * rk], rotation: [rk, 0, 0], scale: [1, 1, 1.5] }));
  for (const s of [-1, 1]) P.push(part(rod([s * 0.4, fy + 2.0, 1.4], [s * 0.4, fy + 2.75, 1.5], 0.16, 0.16, 8), '#1A1918'));
  // mast with yard, radar scanner, satcom dome, nav lights
  const MAST = '#CFD2CF';
  P.push(part(rod([0, deckY + 7.8, -11], [0, deckY + 13.2, -11], 0.11, 0.07, 6), MAST));
  P.push(part(rod([-1.8, deckY + 11.6, -11], [1.8, deckY + 11.6, -11], 0.05, 0.05, 4), MAST));
  box(1.4, 0.08, 1.1, 0, deckY + 9.9, -11.2, '#8E928F');
  box(2.7, 0.14, 0.32, 0, deckY + 10.3, -11.2, '#E6E6E0');
  box(0.26, 0.3, 0.26, 0, deckY + 10.08, -11.2, '#33383A');
  P.push(part(rod([0, deckY + 7.8, -9.9], [0, deckY + 8.9, -9.9], 0.06, 0.06, 5), MAST));
  P.push(part(new THREE.SphereGeometry(0.42, 12, 8), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 9.2, -9.9] }));
  P.push(part(new THREE.SphereGeometry(0.22, 6, 5), '#FFFFFF', K_NAV, 0, { position: [0, deckY + 13.3, -11], wear: 0 }));
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.2, 6, 5), s < 0 ? '#FF2015' : '#12FF6E', K_NAV, 0, { position: [s * (sx * 0.49), deckY + 6.2, -14.4], wear: 0 }));
  // open stern deck: rails, bollards, mooring winches, liferaft racks (two canisters gone), lifejacket
  // lockers, flagstaff — people gather here
  const sternZ = L / 2 - 1.2;
  for (let i = 0; i <= 10; i++) {
    const x = -B * 0.4 + (i / 10) * B * 0.8;
    P.push(part(rod([x, deckY, sternZ], [x, deckY + 1.1, sternZ], 0.035, 0.035, 4), '#D3D3CB', K_PLAIN, 0, { wear: 0.6 }));
  }
  P.push(part(rod([-B * 0.4, deckY + 1.1, sternZ], [B * 0.4, deckY + 1.1, sternZ], 0.05, 0.05, 4), '#D3D3CB', K_PLAIN, 0, { wear: 0.6 }));
  for (const s of [-1, 1]) K.rail(s, 10.6, sternZ, deckY, 0.25);
  P.push(part(rod([0, deckY, sternZ + 0.2], [0, deckY + 4.2, sternZ + 0.2], 0.05, 0.04, 4), '#D3D3CB'));
  box(0.03, 0.27, 1.2, 0, deckY + 3.97, sternZ + 0.85, '#E8E8E4', K_PLAIN, { wear: 0.3 });
  box(0.03, 0.27, 1.2, 0, deckY + 3.7, sternZ + 0.85, '#2C5DA8', K_PLAIN, { wear: 0.3 });
  box(0.03, 0.27, 1.2, 0, deckY + 3.43, sternZ + 0.85, '#B3261E', K_PLAIN, { wear: 0.3 });
  for (const s of [-1, 1]) P.push(part(new THREE.CylinderGeometry(0.22, 0.25, 0.5, 8), '#1E1E1C', K_PLAIN, 0, { position: [s * 3.2, deckY + 0.25, sternZ - 2.5] }));
  for (const s of [-1, 1]) {
    box(0.9, 0.7, 1.2, s * 2.3, deckY + 0.35, 23.4, '#3A403C');
    P.push(part(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), '#2F4A3A', K_PLAIN, 0, { position: [s * 2.3, deckY + 0.95, 23.4], rotation: [0, 0, Math.PI / 2] }));
    // liferaft racks: three cradles each, one canister gone on each side
    const xr = s * (hw(13) - 0.95);
    for (const dx of [-0.32, 0.32]) box(0.07, 0.07, 3.6, xr + dx, deckY + 0.5, 13.2, '#3A4046');
    for (const z of [11.6, 14.8]) for (const dx of [-0.32, 0.32]) box(0.07, 0.5, 0.07, xr + dx, deckY + 0.25, z, '#3A4046');
    for (const z of [12.0, 13.2, 14.4]) {
      if ((s < 0 && z === 13.2) || (s > 0 && z === 12.0)) continue;
      P.push(part(new THREE.CapsuleGeometry(0.32, 0.85, 3, 10), '#E6E6DE', K_PLAIN, 0, { position: [xr, deckY + 0.86, z], rotation: [0, 0, Math.PI / 2], wear: 0.6 }));
      box(0.12, 0.66, 0.66, xr, deckY + 0.86, z, '#1E2328');
    }
    // lifejacket lockers against the lounge's aft wall (white, orange band)
    box(1.4, 0.9, 0.7, s * 3.3, deckY + 0.45, 10.4, '#E2E1DA');
    box(1.42, 0.14, 0.72, s * 3.3, deckY + 0.72, 10.4, '#D8642A', K_PLAIN, { wear: 0.5 });
  }
  // stern flood lamps (go out as she floods)
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.18, 6, 5), '#FFE6B0', K_WIN, 0, { position: [s * 3.8, deckY + 3.0, 9.6], wear: 0 }));
  // stern door seams on the transom
  const tz = L / 2 + 0.03;
  for (const s of [-1, 1]) box(0.08, 4.0, 0.04, s * 2.6, deckY - 3.1, tz, '#141A20');
  box(5.28, 0.08, 0.04, 0, deckY - 1.1, tz, '#141A20');
  box(5.28, 0.08, 0.04, 0, deckY - 5.1, tz, '#141A20');
  // rust: hawses at the bow, scupper runs along the sheer, a run under each davit station
  for (const s of [-1, 1]) {
    K.hawse(s, -21.5, deckY - 0.7, RUST, NAVY);
    for (let i = 0; i < 9; i++) {
      const z = -9 + i * 3.6 + ((i * 7) % 3) * 0.4;
      K.run(s, z, deckY - 0.12, 1.1 + ((i * 5) % 4) * 0.35, 0.16 + ((i * 3) % 2) * 0.08, RUST, NAVY);
    }
  }
  const g = mergeParts(P, ATTRS);
  // people gather aft on the high (port, −X) side as she heels to starboard
  g.userData = { L, B, deckY, stand: [-2.6, deckY, L / 2 - 6.5], decal: { x: 4.98, y: deckY - 2.25, z: -L / 2 + 10, w: 11, h: 1.9 }, collarR: 6.5, elong: 4.3, model: 'ferry' };
  return g;
}

// «Вайгач»: a side-trawler-sized stern trawler — forward wheelhouse, stern A-frame gantry, net drum,
// trawl boards hanging on the quarters, stern slipway; heavily rusted. Same frame as the ferry.
export function trawlerWreckGeometry(deckY = 7) {
  const P = [];
  const L = 44, B = 10, bowStart = 0.6, sternTaper = 0.86;
  const TOP = '#5E3326', WHITE = '#DCDAD0', RUST = '#6B3A22', GANTRY = '#B5562A';
  const hw = (z) => hullHalfBeam(z, L, B, bowStart, sternTaper);
  const K = shipKit(P, hw);
  const { box } = K;
  const hull = shipHull({ length: L, beam: B, keel: 3.4, freeboard: deckY, bowStart, sternTaper, stations: 20, deckRise: 2.6, rows: [-0.32, -0.28, 0.28, 0.32, deckY - 0.62, deckY - 0.58] });
  P.push(part(hull, TOP, K_PLAIN, 0, {
    vcolor: (x, y, z, c) => {
      if (y < -0.3) c.set('#1E2226');
      else if (y < 0.3) c.set('#B9B6AC');
      else if (y > deckY - 0.6) c.set('#2A2826');
    },
  }));
  P.push(part(hullDeck(hull, deckY + 0.02, 0.3), '#4A4440', K_PLAIN, 0));
  // forward superstructure + wheelhouse
  box(7, 3.4, 8, 0, deckY + 1.7, -9, WHITE);
  box(5.6, 1.9, 4.4, 0, deckY + 4.35, -10, WHITE);
  box(6.2, 0.14, 5.0, 0, deckY + 5.35, -10, '#9A9890');
  K.ribbonZ(-1, -12.2, deckY + 4.45, -2.5, 2.5, 0.8, WHITE, 1.0);
  for (const s of [-1, 1]) {
    K.ribbonX(s, 2.8, deckY + 4.45, -11.8, -8.4, 0.75, WHITE, 1.1);
    K.ribbonX(s, 3.5, deckY + 2.1, -12.4, -6.0, 0.6, WHITE, 1.6);
    box(0.05, 1.9, 0.9, s * 3.51, deckY + 0.95, -5.8, '#2A3036');
  }
  K.ribbonZ(1, -5.0, deckY + 2.2, -2.6, 2.6, 0.6, WHITE, 1.3);
  // mast, yard, radar, lights
  P.push(part(rod([0, deckY + 5.4, -10], [0, deckY + 11.5, -10], 0.13, 0.08, 6), '#BDBFBA'));
  P.push(part(rod([-1.6, deckY + 9.6, -10], [1.6, deckY + 9.6, -10], 0.05, 0.05, 4), '#BDBFBA'));
  box(2.4, 0.13, 0.3, 0, deckY + 7.0, -10.2, '#E2E2DC');
  box(0.24, 0.3, 0.24, 0, deckY + 6.8, -10.2, '#33383A');
  P.push(part(new THREE.SphereGeometry(0.2, 6, 5), '#FFFFFF', K_NAV, 0, { position: [0, deckY + 11.6, -10], wear: 0 }));
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.18, 6, 5), s < 0 ? '#FF2015' : '#12FF6E', K_NAV, 0, { position: [s * 3.0, deckY + 4.6, -8.2], wear: 0 }));
  // stern A-frame gantry, net drum with its net, trawl boards on the quarters, stern slipway
  const sz = L / 2 - 3;
  for (const s of [-1, 1]) P.push(part(rod([s * 3.9, deckY, sz - 1], [s * 1.5, deckY + 7.2, sz], 0.28, 0.24, 6), GANTRY));
  P.push(part(rod([-1.7, deckY + 7.2, sz], [1.7, deckY + 7.2, sz], 0.28, 0.28, 6), GANTRY));
  box(0.5, 0.7, 0.5, 0, deckY + 6.7, sz, '#2A2A28');
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.2, 6, 5), '#FFE2B0', K_WIN, 0, { position: [s * 1.9, deckY + 7.0, sz - 0.3], wear: 0 }));
  P.push(part(new THREE.CylinderGeometry(1.3, 1.3, 5.6, 14), '#2F4A3A', K_PLAIN, 0, { position: [0, deckY + 1.5, 9], rotation: [0, 0, Math.PI / 2] }));
  P.push(part(new THREE.CylinderGeometry(1.42, 1.42, 4.8, 10), '#4A5238', K_PLAIN, 0, { position: [0, deckY + 1.5, 9], rotation: [0, 0, Math.PI / 2], wear: 0.6 }));
  for (const s of [-1, 1]) box(0.3, 2.6, 0.6, s * 3.0, deckY + 1.3, 9, '#3A3E42');
  for (const s of [-1, 1]) {
    const z = 14.5;
    const w = hw(z);
    box(0.3, 2.0, 3.2, s * (w + 0.3), deckY - 0.7, z, '#33373A');
    box(0.34, 0.25, 3.25, s * (w + 0.3), deckY + 0.2, z, '#6B3A22');
    P.push(part(rod([s * (w - 0.1), deckY + 1.2, z], [s * (w + 0.3), deckY + 0.3, z], 0.04, 0.04, 3), '#2A2622'));
  }
  box(2.8, 0.12, 5.0, 0, deckY - 1.0, L / 2 - 2.4, '#151514', K_PLAIN, { rotation: [-0.38, 0, 0], wear: 0.4 });
  // working deck: winch, fish-hatch covers, deck lamps, rails forward, bollards
  box(4, 1.2, 3.2, 0, deckY + 0.6, 1.5, '#5E6366');
  for (const z of [-2.5, 5.2]) box(2.4, 0.18, 1.8, 1.6, deckY + 0.09, z, '#3A3A36');
  for (const s of [-1, 1]) {
    K.rail(s, -4.6, 4.5, deckY, 0.25);
    for (const z of [-3, 6, 17]) P.push(part(new THREE.CylinderGeometry(0.2, 0.23, 0.5, 8), '#1E1E1C', K_PLAIN, 0, { position: [s * (hw(z) - 0.6), deckY + 0.25, z] }));
    P.push(part(new THREE.SphereGeometry(0.18, 6, 5), '#FFE2B0', K_WIN, 0, { position: [s * 2.6, deckY + 3.6, -4.8], wear: 0 }));
    K.hawse(s, -18.5, deckY - 0.3, RUST, TOP);
    for (let i = 0; i < 8; i++) {
      const z = -10 + i * 3.8 + ((i * 7) % 3) * 0.5;
      K.run(s, z, deckY - 0.1, 1.4 + ((i * 5) % 4) * 0.4, 0.2 + ((i * 3) % 2) * 0.1, '#7A4428', TOP);
    }
  }
  const g = mergeParts(P, ATTRS);
  g.userData = { L, B, deckY, stand: [-2.2, deckY, 3.6], decal: { x: hw(-L / 2 + 8) * 1.01 + 0.03, y: deckY - 1.5, z: -L / 2 + 8, w: 7.5, h: 1.3 }, collarR: 5.8, elong: 3.9, model: 'trawler' };
  return g;
}

// ------------------------------------------------------------------------------------------------
// Ан-2 ditched on the water (op 9★). Origin at the waterline, nose towards −Z; built level with the
// lower wing awash (the carrier adds the nose-down trim). Fabric-covered biplane: 12.7 m fuselage,
// 18.2 m upper / 14.2 m lower wings with I-struts and N bracing wires, cabane struts, a radial engine
// cowling with a four-blade prop (two blades bent by the ditching), dull silver dope with a red
// cheat line and red wing tips. People stand or sit on the upper wing (PLANE.wingTop).
export const PLANE = { wingTop: 2.27, wingZ: -2.6 };
export function planeGeometry() {
  const P = [];
  const SILVER = '#9AA0A0', RED = '#9E2A20', DARK = '#33383A';
  const fy = 0.72; // fuselage axis height
  const cyl = (rz, rn, len, zc, color, extra = {}) => {
    const g = new THREE.CylinderGeometry(rz, rn, len, 16, 2);
    g.rotateX(Math.PI / 2); // +Y (radiusTop) → +Z (aft)
    P.push(part(g, color, K_PLAIN, 0, { position: [0, fy, zc], ...extra }));
  };
  // engine cowling (dark), cowl face, spinner, prop
  cyl(0.84, 0.76, 1.15, -5.78, DARK, { wear: 0.8 });
  P.push(part(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), '#1A1C1E', K_PLAIN, 0, { position: [0, fy, -6.37], rotation: [Math.PI / 2, 0, 0] }));
  P.push(part(new THREE.ConeGeometry(0.2, 0.45, 10), '#2A2D2F', K_PLAIN, 0, { position: [0, fy, -6.6], rotation: [-Math.PI / 2, 0, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const bent = i % 2 ? 0.55 : 0.08; // two blades bent back where they hit the water
    P.push(part(new THREE.BoxGeometry(0.22, 1.7, 0.05), '#2A2826', K_PLAIN, 0, {
      position: [Math.sin(a) * 0.9, fy + Math.cos(a) * 0.9, -6.45 + bent * 0.7],
      rotation: [bent * Math.cos(a), 0, -a, 'ZXY'],
      wear: 0.7,
    }));
  }
  // cabin and tail cone (fabric over the rear fuselage), cheat line, windows, open cabin door
  cyl(0.9, 0.86, 6.2, -2.1, SILVER, { scale: [0.94, 1.08, 1] });
  cyl(0.24, 0.9, 5.35, 3.68, SILVER, { scale: [0.94, 1.0, 1], position: [0, fy + 0.18, 3.68] });
  for (const s of [-1, 1]) {
    P.push(part(new THREE.BoxGeometry(0.04, 0.16, 6.1), RED, K_PLAIN, 0, { position: [s * 0.85, fy + 0.05, -2.1] }));
    for (let i = 0; i < 4; i++) P.push(part(new THREE.BoxGeometry(0.04, 0.34, 0.34), '#1A2228', K_PLAIN, 0, { position: [s * 0.86, fy + 0.42, -3.2 + i * 0.95], wear: 0 }));
    P.push(part(new THREE.BoxGeometry(0.62, 0.05, 0.5), '#1A2228', K_PLAIN, 0, { position: [s * 0.36, fy + 0.98, -4.55], rotation: [0, 0, s * 0.5], wear: 0 })); // cockpit glazing
  }
  P.push(part(new THREE.BoxGeometry(0.05, 1.3, 0.75), '#14181B', K_PLAIN, 0, { position: [-0.87, fy + 0.15, 0.4], wear: 0 }));
  P.push(part(new THREE.BoxGeometry(0.05, 1.25, 0.72), SILVER, K_PLAIN, 0, { position: [-1.2, fy + 0.15, 0.85], rotation: [0, -1.1, 0] }));
  // upper wing: span 18.2, chord 2.45; fabric rib lines, aileron/flap gap, red tips
  const wy = PLANE.wingTop - 0.11;
  const wz = PLANE.wingZ;
  P.push(part(new THREE.BoxGeometry(18.2, 0.2, 2.45), SILVER, K_PLAIN, 0, { position: [0, wy, wz] }));
  for (const s of [-1, 1]) {
    P.push(part(new THREE.BoxGeometry(1.1, 0.22, 2.47), RED, K_PLAIN, 0, { position: [s * 8.55, wy, wz] }));
    P.push(part(new THREE.BoxGeometry(0.9, 0.17, 2.05), RED, K_PLAIN, 0, { position: [s * 6.6, 0.05, wz + 0.1], rotation: [0, 0, s * 0.03] }));
  }
  for (let i = 0; i < 26; i++) {
    const x = -8.6 + i * 0.69;
    if (Math.abs(x) < 0.4) continue;
    P.push(part(new THREE.BoxGeometry(0.05, 0.012, 2.4), '#868C8C', K_PLAIN, 0, { position: [x, wy + 0.105, wz] }));
  }
  P.push(part(new THREE.BoxGeometry(17.6, 0.012, 0.04), '#5A6060', K_PLAIN, 0, { position: [0, wy + 0.105, wz + 0.62] }));
  // lower wing panels (awash) from the fuselage sides, slight dihedral
  for (const s of [-1, 1]) {
    P.push(part(new THREE.BoxGeometry(6.25, 0.17, 2.05), SILVER, K_PLAIN, 0, { position: [s * 3.98, 0.05, wz + 0.1], rotation: [0, 0, s * 0.03] }));
    // I-strut, N bracing wires, cabane struts
    P.push(part(new THREE.BoxGeometry(0.12, 1.95, 0.55), SILVER, K_PLAIN, 0, { position: [s * 5.4, 1.12, wz] }));
    P.push(part(rod([s * 0.9, 0.15, wz - 0.7], [s * 5.4, wy - 0.08, wz - 0.7], 0.014, 0.014, 3), '#2E3234', K_PLAIN, 0, { wear: 0.3 }));
    P.push(part(rod([s * 5.4, 0.15, wz + 0.7], [s * 0.9, wy - 0.08, wz + 0.7], 0.014, 0.014, 3), '#2E3234', K_PLAIN, 0, { wear: 0.3 }));
    P.push(part(rod([s * 0.9, 0.15, wz + 0.7], [s * 5.4, wy - 0.08, wz + 0.7], 0.012, 0.012, 3), '#2E3234', K_PLAIN, 0, { wear: 0.3 }));
    for (const dz of [-0.6, 0.6]) P.push(part(rod([s * 0.42, fy + 0.86, wz + dz], [s * 0.85, wy - 0.08, wz + dz], 0.04, 0.04, 4), '#5E6466'));
    // horizontal tailplane with its red tip, elevator line
    P.push(part(new THREE.BoxGeometry(3.4, 0.12, 1.5), SILVER, K_PLAIN, 0, { position: [s * 1.75, fy + 0.45, 5.6] }));
    P.push(part(new THREE.BoxGeometry(0.5, 0.13, 1.52), RED, K_PLAIN, 0, { position: [s * 3.25, fy + 0.45, 5.6] }));
  }
  // fin + rudder
  P.push(part(new THREE.BoxGeometry(0.14, 2.3, 1.9), SILVER, K_PLAIN, 0, { position: [0, fy + 1.45, 5.65], rotation: [-0.12, 0, 0] }));
  P.push(part(new THREE.BoxGeometry(0.16, 0.5, 1.92), RED, K_PLAIN, 0, { position: [0, fy + 2.45, 5.78], rotation: [-0.12, 0, 0] }));
  const g = mergeParts(P, ATTRS);
  g.userData = { L: 12.7, span: 18.2 };
  return g;
}

// Name decal for big vessels (bow, both sides): a CanvasTexture on two thin quads.
export function nameDecal(look, text, { width = 9, height = 1.6, color = '#ECEBE6' } = {}) {
  const tex = look.canvasTexture(512, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = '700 64px Oswald, Impact, "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(text).toUpperCase(), w / 2, h / 2 + 4);
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const geo = new THREE.PlaneGeometry(width, height);
  return { tex, mat, geo };
}

// ------------------------------------------------------------------------------------------------
// Stokes litter (orange wire basket stretcher), ×1.4 like the heli's rescue basket. Origin at its centre.
export function stretcherGeometry() {
  const P = [];
  const L = 1.05 * 1.4, W = 0.31 * 1.4, H = 0.12 * 1.4;
  const O = '#FF5A1F';
  for (const s of [-1, 1]) P.push(part(rod([s * W, H, -L], [s * W, H, L], 0.03, 0.03, 5), O));
  for (const z of [-L, L]) P.push(part(rod([-W, H, z], [W, H, z], 0.03, 0.03, 5), O));
  for (let i = 0; i <= 6; i++) {
    const z = -L + (i / 6) * 2 * L;
    P.push(part(rod([-W, H, z], [-W * 0.7, -H, z], 0.015, 0.015, 4), O));
    P.push(part(rod([W, H, z], [W * 0.7, -H, z], 0.015, 0.015, 4), O));
    P.push(part(rod([-W * 0.7, -H, z], [W * 0.7, -H, z], 0.015, 0.015, 4), O));
  }
  P.push(part(new THREE.BoxGeometry(W * 1.4, 0.02, L * 2), '#2E3338', K_PLAIN, 0, { position: [0, -H, 0] }));
  // bridle to the hook
  for (const s of [-1, 1]) for (const z of [-L * 0.8, L * 0.8]) P.push(part(rod([s * W, H, z], [0, 1.5, 0], 0.01, 0.01, 3), '#C9CED2'));
  // straps over the casualty
  for (const z of [-0.45, 0.1, 0.6]) P.push(part(new THREE.BoxGeometry(W * 2.05, 0.03, 0.08), '#1A1A1A', K_PLAIN, 0, { position: [0, H + 0.22, z] }));
  return mergeParts(P, ATTRS);
}

// Lost-person marker: a grey spar buoy with a dark band («ПОТЕРЯН» is the HUD's label).
export function lostBuoyGeometry() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 8), C.lostBuoy, K_PLAIN, 0, { position: [0, 0.35, 0] }));
  P.push(part(new THREE.CylinderGeometry(0.235, 0.235, 0.22, 8), '#2E3438', K_PLAIN, 0, { position: [0, 0.75, 0] }));
  P.push(part(new THREE.SphereGeometry(0.16, 8, 6), '#2E3438', K_PLAIN, 0, { position: [0, 1.25, 0] }));
  P.push(part(new THREE.SphereGeometry(0.06, 6, 4), '#B8C2C8', K_NAV, 0, { position: [0, 1.45, 0] }));
  return mergeParts(P, ATTRS);
}

// Debris: several shapes in one geometry; the vertex shader keeps only the instance's kind (aMat.y =
// kind id, iCraft2.w = wanted kind) — one draw call for every piece of flotsam.
export const DEBRIS_KINDS = ['ring', 'float', 'can', 'plank', 'cooler', 'drogue', 'cat', 'dog', 'tank', 'rope'];
export function debrisGeometry() {
  const P = [];
  const kind = (k) => DEBRIS_KINDS.indexOf(k) + 1;
  // life ring: orange with four white bands
  const ring = new THREE.TorusGeometry(0.42, 0.11, 6, 16);
  ring.rotateX(Math.PI / 2);
  P.push({ geometry: ring, color: '#FF5A1F', attrs: { aMat: [0, kind('ring')], aWear: 0.7 }, vcolor: (x, y, z, c) => { const a = Math.atan2(z, x); if (Math.abs(Math.sin(a * 2)) < 0.28) c.set('#ECEBE6'); } });
  P.push({ geometry: new THREE.SphereGeometry(0.26, 8, 6), color: '#FF6A13', attrs: { aMat: [0, kind('float')], aWear: 0.7 } });
  P.push({ geometry: new THREE.BoxGeometry(0.34, 0.24, 0.5), color: '#B3261E', attrs: { aMat: [0, kind('can')], aWear: 0.7 } });
  P.push({ geometry: new THREE.BoxGeometry(0.3, 0.08, 2.0), color: '#6B4A2E', attrs: { aMat: [0, kind('plank')], aWear: 0.7 } });
  P.push({ geometry: new THREE.BoxGeometry(0.6, 0.35, 0.42), color: '#E4E6E2', attrs: { aMat: [0, kind('cooler')], aWear: 0.7 } });
  P.push({ geometry: new THREE.ConeGeometry(0.22, 0.45, 10, 1, true), color: '#A9471C', attrs: { aMat: [0, kind('drogue')], aWear: 0.6 }, rotation: [Math.PI / 2, 0, 0], position: [0, -0.01, 0] });
  // outboard fuel tank (red plastic, black cap) and a floating coil of polypropylene rope
  P.push({ geometry: new THREE.BoxGeometry(0.52, 0.28, 0.36), color: '#9E2A20', attrs: { aMat: [0, kind('tank')], aWear: 0.8 }, position: [0, 0.04, 0] });
  P.push({ geometry: new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6), color: '#1A1A1A', attrs: { aMat: [0, kind('tank')], aWear: 0.3 }, position: [0.16, 0.21, 0.08] });
  for (let j = 0; j < 3; j++) {
    const t = new THREE.TorusGeometry(0.34 - j * 0.05, 0.028, 4, 14);
    t.rotateX(Math.PI / 2);
    P.push({ geometry: t, color: j === 1 ? '#C9A227' : '#B8AC86', attrs: { aMat: [0, kind('rope')], aWear: 0.8 }, position: [j * 0.03, 0.01 + j * 0.02, -j * 0.02] });
  }
  // pets (DESIGN §4 #27, NICE), sitting, facing +Z, origin at the paws, perceptual ×1.5 like people
  const pet = (k, parts) => {
    for (const q of parts) {
      q.attrs = { aMat: [0, kind(k)] };
      q.position = q.position ? q.position.map((v) => v * S) : [0, 0, 0];
      q.scale = (q.scale || [1, 1, 1]).map((v) => v * S);
      P.push(q);
    }
  };
  const CAT = '#C8742E'; // ginger: reads on a blue container at night
  pet('cat', [
    { geometry: new THREE.SphereGeometry(0.11, 8, 6), color: CAT, position: [0, 0.12, -0.02], scale: [1, 1.15, 1.25] },
    { geometry: new THREE.SphereGeometry(0.055, 6, 5), color: '#F0E6D6', position: [0, 0.16, 0.08] }, // white bib
    { geometry: new THREE.SphereGeometry(0.07, 8, 6), color: CAT, position: [0, 0.29, 0.07] },
    { geometry: new THREE.ConeGeometry(0.026, 0.06, 4), color: CAT, position: [-0.038, 0.355, 0.06] },
    { geometry: new THREE.ConeGeometry(0.026, 0.06, 4), color: CAT, position: [0.038, 0.355, 0.06] },
    { geometry: limb([0, 0.03, -0.12], [0.12, 0.02, -0.2], 0.018, 4), color: CAT },
    { geometry: limb([0.12, 0.02, -0.2], [0.17, 0.06, -0.08], 0.016, 4), color: CAT },
  ]);
  const DOG = '#8A5A32';
  pet('dog', [
    { geometry: new THREE.SphereGeometry(0.15, 8, 6), color: DOG, position: [0, 0.2, -0.04], scale: [1, 1.05, 1.45] },
    { geometry: new THREE.SphereGeometry(0.1, 8, 6), color: DOG, position: [0, 0.4, 0.14] },
    { geometry: new THREE.BoxGeometry(0.07, 0.07, 0.11), color: '#3A2618', position: [0, 0.38, 0.25] },
    { geometry: new THREE.SphereGeometry(0.05, 6, 4), color: '#4A2E1A', position: [-0.085, 0.42, 0.12], scale: [0.5, 1.2, 0.9] },
    { geometry: new THREE.SphereGeometry(0.05, 6, 4), color: '#4A2E1A', position: [0.085, 0.42, 0.12], scale: [0.5, 1.2, 0.9] },
    { geometry: limb([-0.06, 0.2, 0.1], [-0.06, 0.02, 0.13], 0.03, 4), color: DOG },
    { geometry: limb([0.06, 0.2, 0.1], [0.06, 0.02, 0.13], 0.03, 4), color: DOG },
    { geometry: new THREE.BoxGeometry(0.17, 0.03, 0.05), color: '#B3261E', position: [0, 0.32, 0.12] }, // collar
    { geometry: limb([0, 0.12, -0.24], [0, 0.26, -0.36], 0.022, 4), color: DOG },
  ]);
  return mergeParts(P, ATTRS);
}

// ------------------------------------------------------------------------------------------------
// Shared material patch for every craft batch. opts.wear: a core/weathering.js preset (+ overrides) or
// false; opts.foul: fouled-bottom mode (capsized hulls: barnacles, chalky antifouling, keel scrapes,
// wet sheen low). Weathering runs in the craft's OWN frame (origin = waterline) so the patterns ride
// with the bobbing, heeling hull instead of swimming through it, and the algae/salt band stays on the
// real boot-top as she lists or settles.
export function createCraftMaterial(look, opts = {}) {
  const { side = THREE.FrontSide, roughness = 0.7, debris = false, lampLift = 0, wear = WEAR.light, foul = false, key = '' } = opts;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side });
  const u = {
    uTime: look.uniforms.uTime,
    uWet: look.uniforms.uWet,
    uNight: look.uniforms.uNight || { value: 0 },
    uTape: { value: new THREE.Color(C.tape) },
    uChem: { value: new THREE.Color(C.chem) },
    uWin: { value: new THREE.Color('#FFC98A') },
    uRim: opts.rim || { value: new THREE.Color(0, 0, 0) }, // shared day rim light (survivors sets it)
    uNightAmb: opts.nightAmb || { value: new THREE.Color(0, 0, 0) }, // moonlit hemi floor (survivors sets it)
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute vec2 aMat;
        attribute float aWear;
        attribute vec4 iCraft;
        attribute vec4 iCraft2;
        varying vec2 vCrMat;
        varying vec4 vCr;
        varying vec4 vCr2;
        varying vec3 vCrW;
        varying float vCrWear;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCrMat = aMat;
        vCr = iCraft;
        vCr2 = iCraft2;
        vCrWear = aWear;
        ${debris ? `if (abs(aMat.y - iCraft2.w) > 0.5) transformed = vec3(0.0);` : `
        // canopy flutter in the downwash: fast, uneven, strongest at the top of the dome
        float fl = aMat.y * iCraft.z;
        if (fl > 0.0) {
          float w = sin(uTime * 27.0 + position.x * 4.1 + position.z * 3.3 + iCraft2.z)
                  + 0.6 * sin(uTime * 43.0 - position.y * 7.0 + position.x * 2.0 + iCraft2.z * 1.7);
          transformed += objectNormal * fl * 0.07 * w;
        }`}
        vCrW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWet;
        uniform float uNight;
        uniform vec3 uTape;
        uniform vec3 uChem;
        uniform vec3 uWin;
        uniform vec3 uRim;
        uniform vec3 uNightAmb;
        varying vec2 vCrMat;
        varying vec4 vCr;
        varying vec4 vCr2;
        varying vec3 vCrW;
        varying float vCrWear;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vCr2.x > 0.001) {
          float h = fract(sin(dot(floor(vCrW * 6.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (h < vCr2.x) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${wear ? '' : 'diffuseColor.rgb *= 1.0 - 0.15 * uWet;'}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        ${wear ? '' : 'roughnessFactor = clamp(roughnessFactor - 0.25 * uWet, 0.08, 1.0);'}
        // CRAFT_FOUL (fouled-bottom chunk goes here once the weathering helpers are declared)
        // window glass: smooth and dark (the sky sheen is added with the emissive below)
        if (int(vCrMat.x + 0.5) == 3) roughnessFactor = 0.1;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float crFr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uRim * crFr;
        // night: moonlit-hemisphere floor (albedo-weighted, never below the sea's own luminance) + a cool rim
        totalEmissiveRadiance += uNightAmb * (0.35 + diffuseColor.rgb * 1.6) * (0.75 + 0.5 * crFr);
        ${debris ? '' : `
        int ck = int(vCrMat.x + 0.5);
        // lamp-lit fabric (DESIGN §2.1 / §2.8 «защита оранжевого»): in the searchlight at night the
        // canopy reads as saturated orange (≈0.8 linear red → sRGB ≈ (230, 105, 25)) instead of a muddy
        // brown under the cone haze; albedo-proportional, so the hue never drifts toward the lamp white
        if (ck == 0) totalEmissiveRadiance += diffuseColor.rgb * ${lampLift.toFixed(3)} * vCr.x * (0.2 + 0.8 * uNight);
        else if (ck == 1) totalEmissiveRadiance += uTape * 1.4 * vCr.x; // tape strips: at 3.5 their night bloom veiled the canopy pale pink
        else if (ck == 2) totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * (0.3 + 18.0 * vCr.y);
        else if (ck == 3) totalEmissiveRadiance += uWin * 2.2 * vCr.w + uRim * (0.5 + 2.5 * crFr) * (1.0 - vCr.w); // lit cabins / dark glass mirroring the sky
        else if (ck == 4) totalEmissiveRadiance += uChem * (0.4 + 3.5 * vCr2.y);
        else if (ck == 5) totalEmissiveRadiance += diffuseColor.rgb * 5.0 * vCr.w;`}`,
      );
    if (wear) {
      patchWeathering(sh, look, wear);
      // craft frame instead of world space; per-part wear (aWear) scales every amount but the breakup
      sh.vertexShader = sh.vertexShader
        .replace('vWxPos = wxp.xyz;', 'vWxPos = transformed + vec3(iCraft2.z * 0.37, 0.0, iCraft2.z * 0.61);')
        .replace('vWxNrm = normalize( mat3( modelMatrix ) * wxn );', 'vWxNrm = normalize( objectNormal );');
      sh.fragmentShader = sh.fragmentShader
        .replace(/uWxA\.([xyzw])/g, '(uWxA.$1 * vCrWear)')
        .replace(/uWxB\.y/g, '(uWxB.y * vCrWear)')
        .replace('// CRAFT_FOUL (fouled-bottom chunk goes here once the weathering helpers are declared)', foul ? FOUL_GLSL : '');
    }
  };
  mat.customProgramCacheKey = () => `survivors-craft-${debris ? 'debris' : 'v3'}-${side}-${lampLift}-${wear ? 'wx' : ''}-${foul ? 'foul' : ''}${key}`;
  return mat;
}

// Fouled bottom (capsized hulls): runs after the weathering chunk; vWxPos is the hull frame (y = height
// above the waterline). Barnacle specks in the wet fringe, chalky faded antifouling higher up,
// fore-and-aft scrapes along the keel, a wet sheen over the lowest 0.3 m.
const FOUL_GLSL = /* glsl */ `
{
  float hh = vWxPos.y;
  vec3 nn = normalize( vWxNrm );
  vec4 fa = wxTri( vWxPos, nn, 0.35 );
  float fringe = ( 1.0 - smoothstep( 0.04, 0.32, hh + ( fa.r - 0.5 ) * 0.25 ) ) * step( -0.6, hh ) * smoothstep( 0.35, 0.6, fa.b );
  float speck = 1.0 - smoothstep( 0.03, 0.08, wxTri( vWxPos * 3.1, nn, 1.0 ).g );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.49, 0.44 ), speck * fringe * 0.6 * vCrWear );
  float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
  float chalk = smoothstep( 0.55, 1.2, hh ) * smoothstep( 0.35, 0.7, fa.g );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( lum * 1.35 + 0.035 ), chalk * 0.45 * vCrWear );
  float scr = smoothstep( 0.6, 0.78, texture2D( uWxAtlas, vec2( vWxPos.x * 2.2, vWxPos.z * 0.05 ) ).r ) * smoothstep( 0.55, 0.95, nn.y );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.6 + 0.03, scr * 0.5 * vCrWear );
  roughnessFactor = mix( roughnessFactor, 0.16, ( 1.0 - smoothstep( 0.1, 0.4, hh ) ) * step( -0.6, hh ) );
}
`;

// InstancedMesh + per-instance attributes. begin() → push() → end() every frame.
export class CraftBatch {
  constructor(name, geometry, material, max, { castShadow = false, keyline = null, instanceColor = false } = {}) {
    this.max = max;
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(n, a);
      return a;
    };
    this.a1 = mk('iCraft');
    this.a2 = mk('iCraft2');
    this.attrs = [this.a1, this.a2];
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.name = `survivors.${name}`;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    if (instanceColor) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.keyline = null;
    this.keylineOn = true; // quality switch (survivors._applyQuality)
    if (keyline) {
      this.keyline = new THREE.InstancedMesh(geometry, keyline, max);
      this.keyline.name = `survivors.${name}.keyline`;
      this.keyline.instanceMatrix = this.mesh.instanceMatrix;
      this.keyline.frustumCulled = false;
      this.keyline.renderOrder = 13;
      this.keyline.count = 0;
    }
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  push(m, tape = 0, lamp = 0, flutter = 0, lights = 0, dissolve = 0, chem = 0, phase = 0, w = 0, color = null) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    const j = i * 4;
    const a = this.a1.array;
    a[j] = tape; a[j + 1] = lamp; a[j + 2] = flutter; a[j + 3] = lights;
    const b = this.a2.array;
    b[j] = dissolve; b[j + 1] = chem; b[j + 2] = phase; b[j + 3] = w;
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(i, color);
    return i;
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    // empty batches skip the draw (and the shadow pass) entirely
    this.mesh.visible = n > 0;
    if (this.keyline) {
      this.keyline.count = n;
      this.keyline.visible = n > 0 && this.keylineOn;
    }
    if (!n) return;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    if (this.mesh.instanceColor) {
      const c = this.mesh.instanceColor;
      c.clearUpdateRanges();
      c.addUpdateRange(0, n * 3);
      c.needsUpdate = true;
    }
  }
}
