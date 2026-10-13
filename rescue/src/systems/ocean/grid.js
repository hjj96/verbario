// Warped camera-following grid (DESIGN §2.6.1).
// N×N cells on [−1, 1], x' = sign(x)·|x|^1.6·380 (760 m across, dense under the focus), plus two
// flat "skirt" rows on every side out to 3 km so the far sea never ends in a visible edge.
// Vertices store LOCAL grid coordinates; the vertex shader adds the snapped world offset.
import * as THREE from 'three';
import { GRID_EXTENT, GRID_POW, SKIRT_ROWS } from './waves.js';

export function buildOceanGrid(N) {
  const coords = [];
  coords.push(-SKIRT_ROWS[1], -SKIRT_ROWS[0]);
  for (let i = 0; i <= N; i++) {
    const x = -1 + (2 * i) / N;
    coords.push(Math.sign(x) * Math.pow(Math.abs(x), GRID_POW) * GRID_EXTENT);
  }
  coords.push(SKIRT_ROWS[0], SKIRT_ROWS[1]);
  const M = coords.length;
  const mid = (M - 1) / 2;

  const pos = new Float32Array(M * M * 3);
  const nrm = new Float32Array(M * M * 3);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const v = (j * M + i) * 3;
      pos[v] = coords[i];
      pos[v + 2] = coords[j];
      nrm[v + 1] = 1; // real normals come from the vertex shader; attribute keeps HAS_NORMAL (shadow normal bias)
    }
  }

  // Diagonals mirror per quadrant (diamond pattern) so tessellation has no directional bias.
  const idx = new Uint32Array((M - 1) * (M - 1) * 6);
  let k = 0;
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = j * M + i;
      const b = a + 1;
      const c = a + M;
      const d = c + 1;
      const flip = (i < mid) !== (j < mid);
      if (flip) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // The mesh follows the camera through a uniform, so bounds are meaningless: never cull it.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geo;
}

// Snap quantum: cell size ≈ 20 m from the focus (≈1.3 m on high), DESIGN "шаг под фокусом".
export function snapQuantum(N) {
  return 608 * (2 / N) * Math.pow(20 / GRID_EXTENT, 0.375);
}
