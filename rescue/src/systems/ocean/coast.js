// Coastline distance map (DESIGN layer 4 surf / shallows, Gerstner shoal damping).
// Baked once per world from the rendered granite: every non-instanced mesh carrying the terrain
// attribute `aTerr` (world/terrain.js — island, rocks, boulders) is rasterised by its vertex heights
// into a world-space grid; sea cells get their distance to the waterline (y = 0) by a two-pass
// chamfer transform. Stored as R8 (0 … COAST_MAX m) so the GPU (vertex damping, surf band) and the
// CPU wave bank (buoyancy, self-test) read the same bilinear field. Replaces the fitted shoal circles
// for terrain coasts; circles stay for anything else that declares shoals (rig legs, wrecks).
import * as THREE from 'three';

export const COAST_MAX = 48; // metres encoded; "far from any coast" beyond

const _v = new THREE.Vector3();

// → { texture, data (Uint8Array), w, h, x0, z0, cell } or null when the scene has no terrain.
export function bakeCoast(scene, { maxCells = 1024, minCell = 0.7 } = {}) {
  const meshes = [];
  scene.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.aTerr && o.geometry.attributes.position) meshes.push(o);
  });
  if (!meshes.length) return null;
  // bounds of the land (vertices above the waterline)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (_v.y <= 0) continue;
      if (_v.x < x0) x0 = _v.x;
      if (_v.x > x1) x1 = _v.x;
      if (_v.z < z0) z0 = _v.z;
      if (_v.z > z1) z1 = _v.z;
    }
  }
  if (!(x1 > x0 && z1 > z0)) return null;
  const pad = COAST_MAX + 6;
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const cell = Math.max(minCell, (x1 - x0) / maxCells, (z1 - z0) / maxCells);
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  const N = w * h;
  // max vertex height per cell (−∞ = no sample)
  const H = new Float32Array(N).fill(-1e9);
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const ci = Math.floor((_v.x - x0) / cell), cj = Math.floor((_v.z - z0) / cell);
      if (ci < 0 || cj < 0 || ci >= w || cj >= h) continue;
      const id = cj * w + ci;
      if (_v.y > H[id]) H[id] = _v.y;
    }
  }
  // land: a sampled cell above the waterline, or an unsampled cell surrounded by land (terrain grids
  // coarser than the cell leave holes)
  const D = new Float32Array(N);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const id = j * w + i;
      let land = H[id] > 0;
      if (!land && H[id] < -1e8 && i > 0 && j > 0 && i < w - 1 && j < h - 1) {
        let up = 0, any = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const v = H[id + dj * w + di];
          if (v > -1e8) { any++; if (v > 0) up++; }
        }
        land = any > 0 && up * 2 > any;
      }
      D[id] = land ? 0 : 1e9;
    }
  }
  const S = Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const id = j * w + i;
      let d = D[id];
      if (d === 0) continue;
      if (i > 0) d = Math.min(d, D[id - 1] + 1);
      if (j > 0) {
        d = Math.min(d, D[id - w] + 1);
        if (i > 0) d = Math.min(d, D[id - w - 1] + S);
        if (i < w - 1) d = Math.min(d, D[id - w + 1] + S);
      }
      D[id] = d;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const id = j * w + i;
      let d = D[id];
      if (d === 0) continue;
      if (i < w - 1) d = Math.min(d, D[id + 1] + 1);
      if (j < h - 1) {
        d = Math.min(d, D[id + w] + 1);
        if (i < w - 1) d = Math.min(d, D[id + w + 1] + S);
        if (i > 0) d = Math.min(d, D[id + w - 1] + S);
      }
      D[id] = d;
    }
  }
  const data = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    // the waterline lies half a cell outside the last land cell
    const m = D[i] === 0 ? 0 : (D[i] - 0.5) * cell;
    data[i] = Math.round(Math.min(Math.max(m, 0) / COAST_MAX, 1) * 255);
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, data, w, h, x0, z0, cell };
}

// CPU mirror of the GPU's bilinear R8 lookup (texel centres at (i + .5)·cell), metres.
export function coastDistance(c, x, z) {
  const fx = (x - c.x0) / c.cell - 0.5, fz = (z - c.z0) / c.cell - 0.5;
  if (fx < 0 || fz < 0 || fx > c.w - 1 || fz > c.h - 1) return COAST_MAX;
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const i1 = Math.min(i + 1, c.w - 1), j1 = Math.min(j + 1, c.h - 1);
  const d = c.data;
  const a = d[j * c.w + i] + (d[j * c.w + i1] - d[j * c.w + i]) * tx;
  const b = d[j1 * c.w + i] + (d[j1 * c.w + i1] - d[j1 * c.w + i]) * tx;
  return ((a + (b - a) * tz) / 255) * COAST_MAX;
}

// Wave amplitude near a coast: ≈ 20 % at the waterline, full beyond ~16 m (same in GLSL).
export function coastDamp(d) {
  const t = Math.min(Math.max((d - 1) / 15, 0), 1);
  return 0.2 + 0.8 * t * t * (3 - 2 * t);
}
