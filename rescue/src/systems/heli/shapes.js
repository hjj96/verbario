// Procedural geometry helpers for the helicopter (DESIGN §2.9).
//
// * loft()        — "superellipse lathe": cross-sections swept along the Z axis with a profile function.
//                   Smooth normals (seam averaged), optional partial u-range (patches for glass, stripes,
//                   decals), inflate (overlay offset along the normal) and shear (diagonal boom stripes).
// * mergeSurfaces — look.merge() per surface class, then concatenated with a constant `aSurf` attribute
//                   (roughness, metalness, clearcoat, flags) so the whole hull is ONE draw call.
import * as THREE from 'three';

const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Piecewise-linear profile from key stations [{z, hw, hh, cx?, cy, n?}] (sorted by z).
// Returns profile(z, out) → out {hw, hh, cx, cy, n}.
export function stationProfile(stations) {
  return (z, out) => {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1].z) i++;
    const a = stations[i];
    const b = stations[i + 1];
    let t = (z - a.z) / (b.z - a.z || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    // Smoothstep between stations gives a softer, less faceted silhouette along the body.
    const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    out.hw = a.hw + (b.hw - a.hw) * s;
    out.hh = a.hh + (b.hh - a.hh) * s;
    out.cx = (a.cx || 0) + ((b.cx || 0) - (a.cx || 0)) * s;
    out.cy = a.cy + (b.cy - a.cy) * s;
    out.n = (a.n || 2.6) + ((b.n || 2.6) - (a.n || 2.6)) * s;
    return out;
  };
}

// Superellipse loft along Z.
// u = 0 bottom, 0.25 = +X (starboard), 0.5 = top, 0.75 = −X (port). z grows towards the tail (+Z).
// opts: { profile, z0, z1, zSegs, uFrom = 0, uTo = 1, uSegs = 12, inflate = 0, shear = 0, flipV = false }
export function loft(opts) {
  const { profile, z0, z1, zSegs, uFrom = 0, uTo = 1, uSegs = 12, inflate = 0, shear = 0 } = opts;
  const full = Math.abs(uTo - uFrom - 1) < 1e-6;
  const cols = uSegs + 1;
  const rows = zSegs + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const pr = { hw: 0, hh: 0, cx: 0, cy: 0, n: 2 };
  for (let j = 0; j < rows; j++) {
    const zBase = z0 + ((z1 - z0) * j) / zSegs;
    for (let i = 0; i < cols; i++) {
      const u = uFrom + ((uTo - uFrom) * i) / uSegs;
      const phi = u * Math.PI * 2;
      const sx = Math.sin(phi);
      const cy = -Math.cos(phi);
      // First pass at zBase to know x, then re-evaluate at the sheared z for diagonal bands.
      profile(zBase, pr);
      let x = pr.cx + pr.hw * sgnPow(sx, 2 / pr.n);
      let z = zBase + shear * x;
      if (shear) profile(z, pr);
      x = pr.cx + pr.hw * sgnPow(sx, 2 / pr.n);
      const y = pr.cy + pr.hh * sgnPow(cy, 2 / pr.n);
      const k = (j * cols + i) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      uv[(j * cols + i) * 2] = i / uSegs;
      uv[(j * cols + i) * 2 + 1] = opts.flipV ? 1 - j / zSegs : j / zSegs;
    }
  }
  const index = [];
  for (let j = 0; j < zSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so normals point outward (u runs bottom → +X → top, z runs to the tail).
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  if (full) {
    // Weld the seam normals (u = 0 and u = 1 are the same physical vertex).
    for (let j = 0; j < rows; j++) {
      const a = j * cols * 3;
      const b = (j * cols + uSegs) * 3;
      for (let c = 0; c < 3; c++) {
        const m = (nrm[a + c] + nrm[b + c]) * 0.5;
        nrm[a + c] = m;
        nrm[b + c] = m;
      }
    }
  }
  if (inflate) {
    for (let v = 0; v < cols * rows; v++) {
      const k = v * 3;
      const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1;
      pos[k] += (nrm[k] / l) * inflate;
      pos[k + 1] += (nrm[k + 1] / l) * inflate;
      pos[k + 2] += (nrm[k + 2] / l) * inflate;
    }
  }
  return g;
}

// Remap a geometry's uv into an atlas rectangle [u0, v0, u1, v1] (in place).
export function remapUv(g, rect, { swap = false, flipU = false, flipV = false } = {}) {
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    let u = uv[i];
    let v = uv[i + 1];
    if (swap) [u, v] = [v, u];
    if (flipU) u = 1 - u;
    if (flipV) v = 1 - v;
    uv[i] = rect[0] + (rect[2] - rect[0]) * u;
    uv[i + 1] = rect[1] + (rect[3] - rect[1]) * v;
  }
  g.attributes.uv.needsUpdate = true;
  return g;
}

// A tube between two points (for skids, struts, probes). Cylinder axis is Y → rotate onto a→b.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
export function tube(a, b, r0, r1 = r0, segs = 6) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, false);
  _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  g.applyQuaternion(_q);
  g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
  return g;
}

// Merge surface groups into one geometry with attributes position, normal, color, uv, aSurf.
// groups: [{ surf: [roughness, metalness, clearcoat, flags], parts: [look.merge parts] }]
// flags: 0 paint/metal, 1 decal (uv samples the decal atlas), 2 glass with instrument glow, 3 door light.
export function mergeSurfaces(look, groups) {
  const geos = [];
  for (const grp of groups) {
    if (!grp.parts.length) continue;
    const g = look.merge(grp.parts);
    const n = g.attributes.position.count;
    const s = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) s.set(grp.surf, i * 4);
    g.setAttribute('aSurf', new THREE.BufferAttribute(s, 4));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geos.push(g);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['uv', 2], ['aSurf', 4]]) {
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

// Triangle count of a (non-indexed or indexed) geometry — used for the debug budget check.
export function triCount(g) {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}
