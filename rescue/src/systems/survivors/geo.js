// Geometry helpers for the survivors' procedural models (people, rafts, hulls, wrecks).
//
// mergeParts() is look.merge() with extra per-part float attributes (part ids, emissive kinds, flex
// weights, arm pivots…) — everything we draw is one merged, vertex-coloured BufferGeometry per model,
// instanced where there can be many.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Merge parts into one non-indexed geometry.
 * parts: [{ geometry, color, position?, rotation? ([x,y,z] | Euler), scale? (n | [x,y,z]), matrix?,
 *           attrs?: { name: number | number[] } }]
 * attrDefs: { name: itemSize } — every part gets these attributes (missing → 0).
 * Per-vertex colour callbacks: part.vcolor(x, y, z, outColor) may override the colour per vertex.
 */
export function mergeParts(parts, attrDefs = {}) {
  const geos = [];
  for (const p of parts) {
    let g = p.geometry.clone();
    if (p.matrix) _m.copy(p.matrix);
    else {
      if (p.position) _p.set(p.position[0] ?? p.position.x, p.position[1] ?? p.position.y, p.position[2] ?? p.position.z);
      else _p.set(0, 0, 0);
      if (p.rotation) {
        if (Array.isArray(p.rotation)) _e.set(p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3] || 'XYZ');
        else _e.copy(p.rotation);
      } else _e.set(0, 0, 0);
      _q.setFromEuler(_e);
      if (p.scale === undefined) _s.set(1, 1, 1);
      else if (typeof p.scale === 'number') _s.setScalar(p.scale);
      else _s.set(p.scale[0], p.scale[1], p.scale[2]);
      _m.compose(_p, _q, _s);
    }
    g.applyMatrix4(_m);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const pos = g.attributes.position.array;
    const col = new Float32Array(n * 3);
    _c.set(p.color !== undefined ? p.color : 0xffffff);
    for (let i = 0; i < n; i++) {
      if (p.vcolor) {
        _c.set(p.color !== undefined ? p.color : 0xffffff);
        p.vcolor(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], _c);
      }
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const [name, size] of Object.entries(attrDefs)) {
      const arr = new Float32Array(n * size);
      const v = p.attrs ? p.attrs[name] : undefined;
      if (v !== undefined) {
        for (let i = 0; i < n; i++) {
          if (size === 1) arr[i] = typeof v === 'function' ? v(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : v;
          else for (let k = 0; k < size; k++) arr[i * size + k] = v[k];
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color' && !(name in attrDefs)) g.deleteAttribute(name);
    }
    geos.push(g);
  }
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'color', ...Object.keys(attrDefs)];
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    let total = 0;
    for (const g of geos) total += g.attributes[name].count;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Cylinder (or cone) between two points, radius r0 at a, r1 at b.
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
export function rod(a, b, r0, r1 = r0, seg = 6, capped = true) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _d.subVectors(_b, _a);
  const len = Math.max(1e-4, _d.length());
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, !capped);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

// Capsule between two points (rounded limbs).
export function limb(a, b, r, seg = 6) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  _d.subVectors(_b, _a);
  const len = Math.max(1e-4, _d.length());
  const g = new THREE.CapsuleGeometry(r, len, 2, seg);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

// Ship-like hull from cross-sections. Stations along z (stern +z … bow −z); each station is a closed
// half-section mirrored in x. Returns a geometry with per-vertex colours from colorAt(x, y, z, out).
//   length, beam, keel (depth below the reference line, positive down), freeboard (deck above it),
//   bowStart (0..1 of the length where the bow starts tapering), sternTaper (0..1 transom width)
//   rows: extra section heights (m) inserted into the topsides so vertex-colour bands stay crisp
export function shipHull({ length, beam, keel, freeboard, bowStart = 0.55, sternTaper = 0.8, stations = 14, deckRise = 0, rows = null }) {
  const P = [];
  const half = length / 2;
  const prof = (k) => {
    // k: 0 stern … 1 bow. Half-beam profile: full amidships, pointed bow, wide transom.
    if (k > bowStart) {
      const t = (k - bowStart) / (1 - bowStart);
      return Math.sqrt(Math.max(0, 1 - t * t * 1.02)) * 0.5 * beam;
    }
    const t = k / bowStart;
    return (sternTaper + (1 - sternTaper) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * 0.5 * beam;
  };
  // section points (x ≥ 0) from the keel up to the deck edge
  const section = (w, k) => {
    const sheer = freeboard + deckRise * Math.pow(Math.max(0, k - 0.6) / 0.4, 2);
    const kd = keel * (0.75 + 0.25 * Math.sin(Math.min(1, k * 1.15) * Math.PI));
    const pts = [
      [0, -kd],
      [w * 0.45, -kd * 0.82],
      [w * 0.82, -kd * 0.45],
      [w * 0.98, -kd * 0.05],
      [w, sheer * 0.5],
      [w * 1.02, sheer],
    ];
    if (!rows) return pts;
    // every ring keeps the same point count (rows clamped into the section's height range)
    for (const ry of rows) {
      const y = Math.min(sheer - 0.02, Math.max(-kd * 0.05 + 0.01, ry));
      let j = 3;
      while (j < pts.length - 1 && pts[j + 1][1] < y) j++;
      const a = pts[j], b = pts[j + 1];
      const t = (y - a[1]) / Math.max(1e-4, b[1] - a[1]);
      pts.splice(j + 1, 0, [a[0] + (b[0] - a[0]) * t, y]);
    }
    return pts;
  };
  const rings = [];
  for (let i = 0; i <= stations; i++) {
    const k = i / stations;
    const z = half - k * length;
    const w = Math.max(0.02, prof(k));
    rings.push({ z, pts: section(w, k) });
  }
  const pos = [];
  const push = (x, y, z) => pos.push(x, y, z);
  const m = rings[0].pts.length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < m - 1; j++) {
      for (const side of [1, -1]) {
        const a0 = A.pts[j], a1 = A.pts[j + 1], b0 = B.pts[j], b1 = B.pts[j + 1];
        if (side > 0) {
          push(a0[0], a0[1], A.z); push(b0[0], b0[1], B.z); push(a1[0], a1[1], A.z);
          push(a1[0], a1[1], A.z); push(b0[0], b0[1], B.z); push(b1[0], b1[1], B.z);
        } else {
          push(-a0[0], a0[1], A.z); push(-a1[0], a1[1], A.z); push(-b0[0], b0[1], B.z);
          push(-a1[0], a1[1], A.z); push(-b1[0], b1[1], B.z); push(-b0[0], b0[1], B.z);
        }
      }
    }
  }
  // transom (flat stern)
  const T = rings[0];
  for (let j = 0; j < m - 1; j++) {
    const a = T.pts[j], b = T.pts[j + 1];
    push(-a[0], a[1], T.z); push(a[0], a[1], T.z); push(b[0], b[1], T.z);
    push(-a[0], a[1], T.z); push(b[0], b[1], T.z); push(-b[0], b[1], T.z);
  }
  P.push(...pos);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.computeVertexNormals();
  g.userData.rings = rings;
  return g;
}

// Deck plate that fits the hull outline at height y (flat polygon from the hull rings).
export function hullDeck(hullGeo, y, inset = 0.05) {
  const rings = hullGeo.userData.rings;
  const pos = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    const wa = Math.max(0, A.pts[A.pts.length - 1][0] - inset);
    const wb = Math.max(0, B.pts[B.pts.length - 1][0] - inset);
    pos.push(-wa, y, A.z, wa, y, A.z, wb, y, B.z);
    pos.push(-wa, y, A.z, wb, y, B.z, -wb, y, B.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}
