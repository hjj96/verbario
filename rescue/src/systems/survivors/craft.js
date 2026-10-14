// Things people float on or cling to (DESIGN §2.10 object table, §3.11):
//   ПСН-6 life raft — hex tube #1E1E1E with an orange band, canopy #FF6A13 with retro-reflective
//     patches and a lamp blinking 60/min, open doorway (people sit in it), ballast pockets underneath
//   capsized hull — motor dory «Мария» style: antifouling #7E2A22, white waterline, keel, rudder, screw;
//     yacht variant (regatta): dark bottom, fin keel and spade rudder in the air
//   20' container — corrugated, any of #B3412E / #1F5E8C / #2F7D4F / #C9A227 (instance colour)
//   barge — high-sided rusty deck barge aground («Печора»), deckhouse aft
//   ferry — «Северянка»: navy hull, white superstructure with window rows (emissive, flicker), funnel
//   stretcher (Stokes litter, orange), lost-person marker buoy (grey), debris (rings, floats, cans, planks)
//
// One CraftBatch (InstancedMesh + per-instance attributes) per model; one shared material patch:
//   aMat  = (kind, flex)  kind: 0 plain, 1 retro tape, 2 lamp, 3 windows, 4 chemlight, 5 nav/always-on
//   iCraft  = (tape lit, lamp, flutter amplitude, lights)  iCraft2 = (dissolve, chem, phase, roughness+)
import * as THREE from 'three';
import { mergeParts, rod, limb, shipHull, hullDeck } from './geo.js';
import { PERSON_SCALE, C } from './tables.js';

const K_PLAIN = 0, K_TAPE = 1, K_LAMP = 2, K_WIN = 3, K_CHEM = 4, K_NAV = 5;
const S = PERSON_SCALE;

// raft dimensions (real PSN-6 ≈ 2.6 m across, perceptual ×1.5 like its people)
export const RAFT = { R: 1.32 * S, tube: 0.19 * S, floorY: 0.06 * S, doorZ: 1.2 * S, canopyTop: 1.38 * S };

const part = (geometry, color, kind = K_PLAIN, flex = 0, extra = {}) => ({ geometry, color, attrs: { aMat: [kind, flex] }, ...extra });

// ------------------------------------------------------------------------------------------------
export function raftGeometry() {
  const P = [];
  const { R, tube } = RAFT;
  // two stacked hexagonal buoyancy tubes (6 tubular segments → hex) lying flat
  const tubeAt = (y, r, color) => {
    const g = new THREE.TorusGeometry(R, r, 8, 6);
    g.rotateX(Math.PI / 2);
    P.push(part(g, color, K_PLAIN, 0, { position: [0, y, 0] }));
  };
  tubeAt(0.1 * S, tube, C.raftTube);
  tubeAt(0.1 * S + tube * 1.85, tube * 0.93, C.raftTube);
  // orange band around the upper tube (hex prism ring aligned with the tube's corners)
  const band = new THREE.CylinderGeometry(R + tube * 0.96, R + tube * 0.96, 0.07 * S, 6, 1, true, Math.PI / 6);
  P.push(part(band, C.raftStripe, K_PLAIN, 0, { position: [0, 0.1 * S + tube * 1.85, 0] }));
  // grab line (lifeline) around the outside
  const line = new THREE.TorusGeometry(R + tube * 1.12, 0.01 * S, 3, 18);
  line.rotateX(Math.PI / 2);
  P.push(part(line, '#5E5A50', K_PLAIN, 0, { position: [0, 0.1 * S + tube * 0.9, 0] }));
  // floor (dark) and four yellow ballast pockets underneath (seen when the raft is capsized)
  P.push(part(new THREE.CylinderGeometry(R, R, 0.05 * S, 6, 1, false, Math.PI / 6), '#2A2A2A', K_PLAIN, 0, { position: [0, RAFT.floorY, 0] }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    P.push(part(new THREE.SphereGeometry(0.26 * S, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#C9A227', K_PLAIN, 0, {
      position: [Math.cos(a) * R * 0.55, 0.02, Math.sin(a) * R * 0.55],
    }));
  }
  // canopy dome over the upper tube with the doorway facing +Z (flex = flutters in downwash; the
  // weight is re-graded by height after merging so the rim stays put on the tube)
  const open = 1.15;
  const base = 0.1 * S + tube * 2.4;
  const dome = new THREE.SphereGeometry(R * 1.02, 16, 8, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI / 2);
  P.push(part(dome, C.canopy, K_PLAIN, 1, { position: [0, base, 0], scale: [1, 0.86, 1] }));
  // door edges (dark meridian trims) — read the doorway at a glance
  for (const phi of [Math.PI / 2 - open / 2, Math.PI / 2 + open / 2]) {
    const edge = new THREE.TorusGeometry(R * 1.02, 0.028 * S, 4, 8, Math.PI / 2);
    edge.rotateY(Math.PI + phi);
    P.push(part(edge, '#2B1A12', K_PLAIN, 0.5, { position: [0, base, 0], scale: [1, 0.86, 1] }));
  }
  // arch tube across the canopy (black, slightly proud of the fabric)
  const arch = new THREE.TorusGeometry(R * 1.035, 0.035 * S, 5, 14, Math.PI);
  P.push(part(arch, '#1E1E1E', K_PLAIN, 0.3, { position: [0, base, 0], scale: [1, 0.86, 1] }));
  // retro-reflective patches on the canopy (SOLAS): four strips around the top
  const RD = R * 1.02;
  const domeY = (rr) => base + 0.86 * Math.sqrt(Math.max(0, RD * RD - rr * rr));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rr = R * 0.6;
    const y = domeY(rr) + 0.015;
    const slope = Math.atan((0.86 * rr) / Math.sqrt(RD * RD - rr * rr)); // the dome falls away outwards
    P.push(part(new THREE.BoxGeometry(0.42 * S, 0.012, 0.12 * S), C.tape, K_TAPE, 0.8, {
      position: [Math.cos(a) * rr, y, Math.sin(a) * rr],
      rotation: [0, -a, -slope, 'YXZ'],
    }));
  }
  // lamp on top (white lens + dark housing) and a chemlight tied to the arch
  const top = domeY(0);
  P.push(part(new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.06 * S, 8), '#202020', K_PLAIN, 0.5, { position: [0, top + 0.02, 0] }));
  P.push(part(new THREE.SphereGeometry(0.05 * S, 8, 6), '#F4F8FF', K_LAMP, 0.5, { position: [0, top + 0.07 * S, 0] }));
  P.push(part(new THREE.CylinderGeometry(0.018 * S, 0.018 * S, 0.12 * S, 6), '#9CFF84', K_CHEM, 0.6, {
    position: [R * 0.5, domeY(R * 0.5) + 0.03, R * 0.35],
    rotation: [0.4, 0, 1.0],
  }));
  // boarding ramp at the door
  P.push(part(new THREE.BoxGeometry(0.7 * S, 0.06 * S, 0.45 * S), '#2A2A2A', K_PLAIN, 0, { position: [0, 0.1 * S, R + tube * 0.9] }));
  P.push(part(new THREE.BoxGeometry(0.5 * S, 0.02 * S, 0.06 * S), '#C9A227', K_PLAIN, 0, { position: [0, 0.14 * S, R + tube * 1.05] }));
  const g = mergeParts(P, { aMat: 2 });
  // dome flex by height above the tube
  const pos = g.attributes.position.array;
  const mat = g.attributes.aMat.array;
  for (let i = 0; i < mat.length / 2; i++) {
    if (mat[i * 2 + 1] > 0.99) mat[i * 2 + 1] = Math.min(1, Math.max(0, (pos[i * 3 + 1] - base) / (R * 0.86)));
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
  const g = mergeParts(P, { aMat: 2 });
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
// 20' container floating low. Origin at the waterline; body white × instance colour.
export const CONT = { L: 6.06, W: 2.44, H: 2.59, freeboard: 0.85 };
export function containerGeometry() {
  const P = [];
  const { L, W, H, freeboard } = CONT;
  const yc = freeboard - H / 2; // body centre
  P.push(part(new THREE.BoxGeometry(W, H, L), '#FFFFFF', K_PLAIN, 0, { position: [0, yc, 0] }));
  // corrugated sides (vertical ribs) and roof (transverse ribs, slightly darker)
  const ribs = 18;
  for (let i = 0; i < ribs; i++) {
    const z = -L / 2 + 0.3 + (i / (ribs - 1)) * (L - 0.6);
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.05, H * 0.92, 0.12), '#E2E2E2', K_PLAIN, 0, { position: [s * (W / 2 + 0.025), yc, z] }));
  }
  for (let i = 0; i < 11; i++) {
    const z = -L / 2 + 0.35 + (i / 10) * (L - 0.7);
    P.push(part(new THREE.BoxGeometry(W * 0.94, 0.04, 0.16), '#D6D6D6', K_PLAIN, 0, { position: [0, freeboard + 0.02, z] }));
  }
  // corner posts / castings and top rails (dark), door end lock bars
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.18, H + 0.04, 0.18), '#3A3A38', K_PLAIN, 0, { position: [sx * (W / 2 - 0.06), yc, sz * (L / 2 - 0.06)] }));
    P.push(part(new THREE.BoxGeometry(0.12, 0.1, L), '#4A4A46', K_PLAIN, 0, { position: [sx * (W / 2 - 0.04), freeboard - 0.02, 0] }));
  }
  for (const sz of [-1, 1]) P.push(part(new THREE.BoxGeometry(W, 0.1, 0.12), '#4A4A46', K_PLAIN, 0, { position: [0, freeboard - 0.02, sz * (L / 2 - 0.04)] }));
  for (let i = 0; i < 4; i++) P.push(part(new THREE.CylinderGeometry(0.025, 0.025, H * 0.95, 5), '#6A6A66', K_PLAIN, 0, { position: [-W / 2 + 0.35 + i * 0.58, yc, L / 2 + 0.05] }));
  // a strip of reflective marking along the top rail (container stencils often carry it) — subtle
  P.push(part(new THREE.BoxGeometry(0.02, 0.05, 1.2), C.tape, K_TAPE, 0, { position: [W / 2 + 0.06, freeboard - 0.12, -L / 2 + 1.0] }));
  const g = mergeParts(P, { aMat: 2 });
  // rust and grime by height: the waterline band darker
  const col = g.attributes.color.array;
  const pos = g.attributes.position.array;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    const k = y < 0.25 ? 0.62 : 1 - 0.08 * Math.sin(pos[i * 3 + 2] * 3.1 + pos[i * 3] * 1.7) ** 2;
    col[i * 3] *= k;
    col[i * 3 + 1] *= k * 0.97;
    col[i * 3 + 2] *= k * 0.95;
  }
  return g;
}

// ------------------------------------------------------------------------------------------------
// Barge aground (deck survivors without a world structure). deckY = deck height above the water.
export function bargeGeometry(deckY = 6) {
  const P = [];
  const L = 34, B = 10, draft = 2.2;
  P.push(part(new THREE.BoxGeometry(B, deckY + draft, L), '#2B2D2E', K_PLAIN, 0, {
    position: [0, (deckY - draft) / 2, 0],
    vcolor: (x, y, z, c) => {
      if (y < 0.5) c.set('#7A2A22');
      else if (Math.abs(y - (deckY - 0.4)) < 0.25) c.set('#C9A227');
    },
  }));
  // raked bow ends
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(B / 2, B / 2, deckY + draft, 3, 1, false, -Math.PI / 2, Math.PI);
    P.push(part(g, '#2B2D2E', K_PLAIN, 0, { position: [0, (deckY - draft) / 2, s * L / 2], rotation: [0, s > 0 ? 0 : Math.PI, 0], scale: [1, 1, 0.5] }));
  }
  P.push(part(new THREE.BoxGeometry(B - 0.3, 0.1, L - 0.3), '#4A4842', K_PLAIN, 0, { position: [0, deckY + 0.05, 0] }));
  // hatch coamings, bollards, deckhouse aft with windows, mast with a light
  for (let i = 0; i < 3; i++) P.push(part(new THREE.BoxGeometry(B * 0.62, 0.7, 5.5), '#5A5850', K_PLAIN, 0, { position: [0, deckY + 0.35, -11 + i * 7] }));
  for (const s of [-1, 1]) for (const z of [-15, -6, 4, 14]) P.push(part(new THREE.CylinderGeometry(0.18, 0.2, 0.5, 6), '#1A1A1A', K_PLAIN, 0, { position: [s * (B / 2 - 0.5), deckY + 0.3, z] }));
  P.push(part(new THREE.BoxGeometry(5.5, 3.0, 4.2), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 1.5, L / 2 - 4.2] }));
  for (let i = 0; i < 4; i++) P.push(part(new THREE.BoxGeometry(0.7, 0.55, 0.05), '#FFC98A', K_WIN, 0, { position: [-1.9 + i * 1.25, deckY + 2.0, L / 2 - 6.33] }));
  P.push(part(rod([0, deckY + 3, L / 2 - 4.2], [0, deckY + 7.5, L / 2 - 4.2], 0.08, 0.06, 5), '#C9CED2'));
  P.push(part(new THREE.SphereGeometry(0.16, 6, 5), '#FFFFFF', K_NAV, 0, { position: [0, deckY + 7.6, L / 2 - 4.2] }));
  // railing along the stern
  for (let i = 0; i <= 8; i++) P.push(part(rod([-B / 2 + 0.3 + i * (B - 0.6) / 8, deckY, L / 2 - 0.3], [-B / 2 + 0.3 + i * (B - 0.6) / 8, deckY + 1.0, L / 2 - 0.3], 0.03, 0.03, 4), '#C9C2B0'));
  P.push(part(rod([-B / 2 + 0.3, deckY + 1.0, L / 2 - 0.3], [B / 2 - 0.3, deckY + 1.0, L / 2 - 0.3], 0.04, 0.04, 4), '#C9C2B0'));
  const g = mergeParts(P, { aMat: 2 });
  g.userData = { L, B, deckY, stand: [0, deckY, L / 2 - 9] }; // where people gather (near the deckhouse)
  return g;
}

// ------------------------------------------------------------------------------------------------
// Sinking ferry «Северянка». Origin at the waterline amidships, bow towards −Z. Stern deck at deckY.
export function ferryGeometry(deckY = 6) {
  const P = [];
  const L = 52, B = 11.5;
  const hull = shipHull({ length: L, beam: B, keel: 4.2, freeboard: deckY, bowStart: 0.62, sternTaper: 0.82, stations: 18, deckRise: 2.2 });
  P.push(part(hull, '#1E3348', K_PLAIN, 0, {
    vcolor: (x, y, z, c) => {
      if (y < -0.3) c.set('#7A2A22');
      else if (y < 0.15) c.set('#ECEBE6');
      else if (y > deckY - 0.9) c.set('#ECEBE6');
    },
  }));
  P.push(part(hullDeck(hull, deckY + 0.02, 0.25), '#5E6A6E', K_PLAIN, 0));
  // superstructure: two decks of white with window rows (emissive, flicker), bridge forward
  const sx = B * 0.82;
  P.push(part(new THREE.BoxGeometry(sx, 2.8, 28), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 1.4, -4] }));
  P.push(part(new THREE.BoxGeometry(sx * 0.86, 2.6, 18), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 4.1, -7] }));
  P.push(part(new THREE.BoxGeometry(sx * 0.7, 2.4, 6), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 6.6, -12] }));
  P.push(part(new THREE.BoxGeometry(sx * 0.7 + 0.04, 0.9, 0.06), '#16222C', K_PLAIN, 0, { position: [0, deckY + 6.9, -15.03] }));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 12; i++) P.push(part(new THREE.BoxGeometry(0.05, 0.75, 1.3), '#FFC98A', K_WIN, 0, { position: [s * (sx / 2 + 0.02), deckY + 1.6, -16.5 + i * 2.2] }));
    for (let i = 0; i < 8; i++) P.push(part(new THREE.BoxGeometry(0.05, 0.7, 1.2), '#FFC98A', K_WIN, 0, { position: [s * (sx * 0.43 + 0.02), deckY + 4.3, -14.5 + i * 2.1] }));
    // empty lifeboat davits (the boats are gone)
    for (const z of [-12, 2]) P.push(part(rod([s * (sx / 2), deckY + 2.8, z], [s * (sx / 2 + 1.2), deckY + 4.5, z], 0.1, 0.08, 5), '#C9CED2'));
  }
  // funnel with a red band, mast with lights
  P.push(part(new THREE.CylinderGeometry(1.2, 1.4, 4, 10), '#E6E6E0', K_PLAIN, 0, { position: [0, deckY + 7.2, 1], scale: [1, 1, 1.5] }));
  P.push(part(new THREE.CylinderGeometry(1.22, 1.22, 0.9, 10), '#B3261E', K_PLAIN, 0, { position: [0, deckY + 8.6, 1], scale: [1, 1, 1.5] }));
  P.push(part(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 10), '#16181A', K_PLAIN, 0, { position: [0, deckY + 9.15, 1], scale: [1, 1, 1.5] }));
  P.push(part(rod([0, deckY + 7.8, -12], [0, deckY + 13, -12], 0.1, 0.07, 5), '#C9CED2'));
  P.push(part(new THREE.SphereGeometry(0.22, 6, 5), '#FFFFFF', K_NAV, 0, { position: [0, deckY + 13.1, -12] }));
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.2, 6, 5), s < 0 ? '#FF2015' : '#12FF6E', K_NAV, 0, { position: [s * (sx * 0.35 + 0.3), deckY + 7.9, -14.6] }));
  // open stern deck: railing, bollards, a flagstaff — people gather here
  const sternZ = L / 2 - 1.2;
  for (let i = 0; i <= 10; i++) {
    const x = -B * 0.42 + (i / 10) * B * 0.84;
    P.push(part(rod([x, deckY, sternZ], [x, deckY + 1.1, sternZ], 0.035, 0.035, 4), '#D8D8D0'));
  }
  P.push(part(rod([-B * 0.42, deckY + 1.1, sternZ], [B * 0.42, deckY + 1.1, sternZ], 0.05, 0.05, 4), '#D8D8D0'));
  P.push(part(rod([0, deckY, sternZ + 0.2], [0, deckY + 4.2, sternZ + 0.2], 0.05, 0.04, 4), '#D8D8D0'));
  P.push(part(new THREE.BoxGeometry(0.03, 0.8, 1.2), '#2C5DA8', K_PLAIN, 0, { position: [0, deckY + 3.7, sternZ + 0.85] }));
  for (const s of [-1, 1]) P.push(part(new THREE.CylinderGeometry(0.22, 0.25, 0.5, 6), '#1A1A1A', K_PLAIN, 0, { position: [s * 3.2, deckY + 0.25, sternZ - 2.5] }));
  // stern deck flood lamps (go out as she floods)
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.18, 6, 5), '#FFE6B0', K_WIN, 0, { position: [s * 3.8, deckY + 3.0, 9.6] }));
  const g = mergeParts(P, { aMat: 2 });
  // people gather aft on the high (port, −X) side as she heels to starboard
  g.userData = { L, B, deckY, stand: [-2.6, deckY, L / 2 - 6.5] };
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
  return mergeParts(P, { aMat: 2 });
}

// Lost-person marker: a grey spar buoy with a dark band («ПОТЕРЯН» is the HUD's label).
export function lostBuoyGeometry() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 8), C.lostBuoy, K_PLAIN, 0, { position: [0, 0.35, 0] }));
  P.push(part(new THREE.CylinderGeometry(0.235, 0.235, 0.22, 8), '#2E3438', K_PLAIN, 0, { position: [0, 0.75, 0] }));
  P.push(part(new THREE.SphereGeometry(0.16, 8, 6), '#2E3438', K_PLAIN, 0, { position: [0, 1.25, 0] }));
  P.push(part(new THREE.SphereGeometry(0.06, 6, 4), '#B8C2C8', K_NAV, 0, { position: [0, 1.45, 0] }));
  return mergeParts(P, { aMat: 2 });
}

// Debris: several shapes in one geometry; the vertex shader keeps only the instance's kind (aMat.y =
// kind id, iCraft2.w = wanted kind) — one draw call for every piece of flotsam.
export const DEBRIS_KINDS = ['ring', 'float', 'can', 'plank', 'cooler', 'drogue', 'cat', 'dog'];
export function debrisGeometry() {
  const P = [];
  const kind = (k) => DEBRIS_KINDS.indexOf(k) + 1;
  // life ring: orange with four white bands
  const ring = new THREE.TorusGeometry(0.42, 0.11, 6, 16);
  ring.rotateX(Math.PI / 2);
  P.push({ geometry: ring, color: '#FF5A1F', attrs: { aMat: [K_TAPE * 0, kind('ring')] }, vcolor: (x, y, z, c) => { const a = Math.atan2(z, x); if (Math.abs(Math.sin(a * 2)) < 0.28) c.set('#ECEBE6'); } });
  P.push({ geometry: new THREE.SphereGeometry(0.26, 8, 6), color: '#FF6A13', attrs: { aMat: [0, kind('float')] } });
  P.push({ geometry: new THREE.BoxGeometry(0.34, 0.24, 0.5), color: '#B3261E', attrs: { aMat: [0, kind('can')] } });
  P.push({ geometry: new THREE.BoxGeometry(0.3, 0.08, 2.0), color: '#6B4A2E', attrs: { aMat: [0, kind('plank')] } });
  P.push({ geometry: new THREE.BoxGeometry(0.6, 0.35, 0.42), color: '#E4E6E2', attrs: { aMat: [0, kind('cooler')] } });
  P.push({ geometry: new THREE.ConeGeometry(0.28, 0.5, 8, 1, true), color: '#FF6A13', attrs: { aMat: [0, kind('drogue')] }, rotation: [Math.PI / 2, 0, 0] });
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
  return mergeParts(P, { aMat: 2 });
}

// ------------------------------------------------------------------------------------------------
// Shared material patch for every craft batch.
export function createCraftMaterial(look, opts = {}) {
  const { side = THREE.FrontSide, roughness = 0.7, debris = false } = opts;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side });
  const u = {
    uTime: look.uniforms.uTime,
    uWet: look.uniforms.uWet,
    uTape: { value: new THREE.Color(C.tape) },
    uChem: { value: new THREE.Color(C.chem) },
    uWin: { value: new THREE.Color('#FFC98A') },
    uRim: opts.rim || { value: new THREE.Color(0, 0, 0) }, // shared day rim light (survivors sets it)
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
        attribute vec4 iCraft;
        attribute vec4 iCraft2;
        varying vec2 vCrMat;
        varying vec4 vCr;
        varying vec4 vCr2;
        varying vec3 vCrW;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCrMat = aMat;
        vCr = iCraft;
        vCr2 = iCraft2;
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
        uniform vec3 uTape;
        uniform vec3 uChem;
        uniform vec3 uWin;
        uniform vec3 uRim;
        varying vec2 vCrMat;
        varying vec4 vCr;
        varying vec4 vCr2;
        varying vec3 vCrW;`,
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
        diffuseColor.rgb *= 1.0 - 0.15 * uWet;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - 0.25 * uWet, 0.08, 1.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        ${debris ? '' : `
        int ck = int(vCrMat.x + 0.5);
        if (ck == 1) totalEmissiveRadiance += uTape * 1.4 * vCr.x; // canopy patches are big: at 3.5 their night bloom veiled the canopy pale pink — keep the orange readable
        else if (ck == 2) totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * (0.3 + 18.0 * vCr.y);
        else if (ck == 3) totalEmissiveRadiance += uWin * 2.2 * vCr.w;
        else if (ck == 4) totalEmissiveRadiance += uChem * (0.4 + 3.5 * vCr2.y);
        else if (ck == 5) totalEmissiveRadiance += diffuseColor.rgb * 5.0 * vCr.w;`}`,
      );
  };
  mat.customProgramCacheKey = () => `survivors-craft-${debris ? 'debris' : 'v1'}-${side}`;
  return mat;
}

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
