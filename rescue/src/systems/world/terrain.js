// Terrain for every landmass (DESIGN §2.11; user feedback «горы слишком низкополигональные»).
//
// A landmass is an analytic height function h(x, z) (metres, sea level 0) sampled on a regular grid:
//   lobes      elliptical granite domes (whalebacks / sea stacks), ragged coast from domain-warped
//              noise, cliff or slab profile chosen per bearing (exposed side → sea cliffs)
//   detail     glacier-polished ridges (ridged fbm stretched along the ice flow) + fbm knobs
//   terraces   granite sheeting: flat shelves, steep risers
//   joints     two near-orthogonal fracture sets cut clefts / gullies (sheltered hollows)
//   flats      structure footprints blended to a target height (pads, plinths, walkways)
//   cuts       kept under water (jetty)
// The grid gives an indexed mesh with smooth normals (underwater cells culled) and per-vertex
// aTerr = (cover, cavity, shelter, bird) for the terrain material, plus a CPU sampler for placing
// vegetation and boulders on the rendered surface, and inscribed circles for ocean.setShoals.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Noise (2D gradient, quintic fade; hash-based so any seed works without tables).
const GX = new Float32Array(16);
const GY = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  const a = ((i + 0.5) / 16) * Math.PI * 2;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}
function hashi(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash01(x, y, s) {
  return hashi(x, y, s) / 4294967296;
}
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let g = hashi(xi, yi, s) & 15;
  const n00 = GX[g] * fx + GY[g] * fy;
  g = hashi(xi + 1, yi, s) & 15;
  const n10 = GX[g] * (fx - 1) + GY[g] * fy;
  g = hashi(xi, yi + 1, s) & 15;
  const n01 = GX[g] * fx + GY[g] * (fy - 1);
  g = hashi(xi + 1, yi + 1, s) & 15;
  const n11 = GX[g] * (fx - 1) + GY[g] * (fy - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41;
}
// fbm ≈ −1..1
export function fbm2(x, y, s, oct = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise2(x, y, s + o * 31);
    norm += amp;
    x = x * 2.03 + 1.7;
    y = y * 2.03 - 0.9;
    amp *= 0.5;
  }
  return sum / norm;
}
// ridged multifractal ≈ 0..1 (sharp crests, rounded valleys)
export function ridged2(x, y, s, oct = 4) {
  let sum = 0, amp = 0.5, w = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(noise2(x, y, s + o * 47));
    n *= n;
    n *= w;
    w = Math.min(1, Math.max(0, n * 1.8));
    sum += n * amp;
    norm += amp;
    x = x * 2.1 - 3.1;
    y = y * 2.1 + 0.7;
    amp *= 0.5;
  }
  return sum / norm;
}
export const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function smax(a, b, k) {
  const d = Math.abs(a - b);
  const m = a > b ? a : b;
  return d >= k ? m : m + ((k - d) * (k - d)) / (4 * k);
}
// Distance from (x, z) to a structure footprint: circle {x, z, r}, box {box:[cx, cz, hx, hz], rot},
// segment {seg:[[ax, az], [bx, bz]], hw}. Returns [distance outside (≤ 0 inside), t along segment].
const _fd = [0, 0];
function footDist(F, x, z) {
  if (F.seg) {
    const [a, b] = F.seg;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
    _fd[0] = Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) - F.hw;
    _fd[1] = t;
    return _fd;
  }
  if (F.box) {
    const [cx, cz, hx, hz] = F.box;
    let dx = x - cx, dz = z - cz;
    if (F.rot) {
      const c = Math.cos(F.rot), s = Math.sin(F.rot);
      const u = dx * c - dz * s;
      dz = dx * s + dz * c;
      dx = u;
    }
    const qx = Math.abs(dx) - hx, qz = Math.abs(dz) - hz;
    _fd[0] = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    _fd[1] = 0;
    return _fd;
  }
  _fd[0] = Math.hypot(x - F.x, z - F.z) - F.r;
  _fd[1] = 0;
  return _fd;
}

// ------------------------------------------------------------------------------------------------
// Height function of a landmass definition.
//   def.lobes: [{x, z, rx, rz, rot, h, w (rise width, fraction of radius), k (rise exponent),
//                peak (0 dome … 1 spire), rag (coast raggedness)}]
//   def.expose: unit [x, z] bearing of the open sea (cliffs face it), def.cliff 0..1
//   def.ridge / bump: detail amplitudes (m); def.step / terr: terrace step (m) / strength
//   def.joint: {sp: [a, b] spacing m, depth m, width m, dir rad}
//   def.flats / def.cuts: see footDist; flats {y | y0,y1, blend, keep}, cuts {y, blend}
export function makeHeightFn(def) {
  const S = def.seed | 0;
  const lobes = [...def.lobes].sort((a, b) => (a.h < 0) - (b.h < 0)).map((L) => {
    const rm = Math.sqrt(L.rx * L.rz);
    const reach = Math.max(L.rx, L.rz) * 1.6 + 10;
    return { ...L, c: Math.cos(L.rot || 0), s: Math.sin(L.rot || 0), rm, reach2: reach * reach, w: L.w ?? 0.45, k: L.k ?? 2, peak: L.peak ?? 0, rag: L.rag ?? 1 };
  });
  const ex = def.expose ? def.expose[0] : 0, ez = def.expose ? def.expose[1] : 0;
  const cliff = def.cliff ?? 0.5;
  const ia = def.ice ?? 0.4;
  const ic = Math.cos(ia), is = Math.sin(ia);
  const ridge = def.ridge ?? 2, bump = def.bump ?? 0.8;
  const step = def.step ?? 1.7, terr = def.terr ?? 0.5;
  const J = def.joint || { sp: [17, 23], depth: 2.2, width: 1.6, dir: 0.5 };
  const jc = [Math.cos(J.dir), Math.cos(J.dir + 1.45)];
  const js = [Math.sin(J.dir), Math.sin(J.dir + 1.45)];
  const flats = def.flats || [];
  const cuts = def.cuts || [];
  const floor = def.floor ?? -6;
  const tiltX = def.tilt ? def.tilt[0] : 0.05, tiltZ = def.tilt ? def.tilt[1] : -0.035;

  return function height(x, z) {
    // domain warp: no two coves alike
    const X = x + 6.5 * fbm2(x * 0.019, z * 0.019, S + 1, 3);
    const Z = z + 6.5 * fbm2(x * 0.019 + 5.2, z * 0.019 + 1.3, S + 2, 3);
    const cn = 6 * fbm2(X * 0.045, Z * 0.045, S + 3, 3) + 2.2 * fbm2(X * 0.12, Z * 0.12, S + 5, 2) + 1.3 * noise2(X * 0.35, Z * 0.35, S + 4) + 0.6 * noise2(X * 0.9, Z * 0.9, S + 6);
    let h = floor;
    for (let i = 0; i < lobes.length; i++) {
      const L = lobes[i];
      const dx = X - L.x, dz = Z - L.z;
      const dd = dx * dx + dz * dz;
      if (dd > L.reach2) continue;
      const u = (dx * L.c - dz * L.s) / L.rx;
      const v = (dx * L.s + dz * L.c) / L.rz;
      const inv = 1 / (Math.sqrt(dd) + 1e-3);
      const ax = dx * inv, az = dz * inv;
      // cliffs on the exposed bearings, slabs in the lee (+ a little noise around the shore)
      const an = 0.5 + 0.5 * noise2(ax * 1.7 + L.x * 0.07, az * 1.7 + L.z * 0.07, S + 7);
      const e = sstep(-0.35, 0.75, ax * ex + az * ez);
      const w = Math.max(0.05, L.w * (1 - cliff * (0.25 + 0.75 * e) * (0.35 + 0.65 * an)));
      const d = Math.sqrt(u * u + v * v) + (cn * L.rag) / L.rm;
      if (L.h < 0) {
        // cove: carve below sea level inside the ellipse
        const cv = d < 1 ? L.h * (1 - d * d) : (d - 1) * 30;
        h = -smax(-h, -cv, 1.5);
        continue;
      }
      let lh;
      if (d < 1) {
        const s = Math.min(1, (1 - d) / w);
        const rise = 1 - Math.pow(1 - s, L.k);
        const crown = L.peak > 0 ? 1 - L.peak + L.peak * Math.pow(1 - d, 1.35) : 0.62 + 0.38 * (1 - d * d);
        lh = L.h * rise * crown;
      } else {
        const crown0 = L.peak > 0 ? 1 - L.peak : 0.62;
        lh = Math.max(floor, (-L.h * crown0 * L.k * (d - 1)) / w);
      }
      h = smax(h, lh, 1.6);
    }
    if (h < -3.5 && !cuts.length) return h; // deep water: no detail needed (the sea is opaque)
    const land = sstep(-0.6, 2.4, h);
    if (land > 0) {
      // glacier-polished whalebacks along the ice flow + knobs
      const iu = (X * ic + Z * is) * 0.03;
      const iv = (-X * is + Z * ic) * 0.075;
      h += land * ridge * (ridged2(iu, iv, S + 11, 4) - 0.42);
      h += land * bump * fbm2(X * 0.12, Z * 0.12, S + 13, 3);
      // the shore step is never a smooth wall: buttresses, gullies and fallen blocks
      const shore = land * (1 - sstep(3, 6.5, h));
      if (shore > 0) h += shore * 1.4 * (ridged2(X * 0.16, Z * 0.16, S + 15, 3) - 0.45);
      // granite sheeting: shelves and risers
      if (h > 0.2 && terr > 0) {
        const st = step * (1 + 0.28 * noise2(X * 0.031, Z * 0.031, S + 17));
        const hT = h + X * tiltX + Z * tiltZ; // sheeting planes are tilted, not contour lines
        const t = hT / st;
        const fl = Math.floor(t);
        const f = t - fl;
        const ter = (fl + sstep(0.28, 0.72, f)) * st;
        h += (ter - hT) * terr * land;
      }
      // joint clefts (two fracture sets; only some joints open, in stretches)
      const jl = sstep(0.2, 2.5, h);
      if (jl > 0 && J.depth > 0) {
        for (let k = 0; k < 2; k++) {
          const sp = J.sp[k];
          const q = X * jc[k] + Z * js[k] + 2.4 * noise2(X * 0.04, Z * 0.04, S + 19 + k);
          const cell = Math.floor(q / sp + 0.5);
          const act = hash01(cell, k, S + 23);
          if (act < 0.38) continue;
          const dist = Math.abs(q - cell * sp);
          const wd = J.width * (0.6 + 0.9 * act);
          if (dist >= wd) continue;
          const along = -X * js[k] + Z * jc[k];
          const pres = sstep(-0.15, 0.35, noise2(along * 0.045, cell * 1.73, S + 29 + k));
          if (pres <= 0) continue;
          const g = 1 - dist / wd;
          h -= jl * J.depth * (0.55 + 0.9 * (act - 0.38)) * g * g * (3 - 2 * g) * pres;
        }
      }
    }
    // structure footprints
    for (let i = 0; i < flats.length; i++) {
      const F = flats[i];
      const fd = footDist(F, x, z);
      const wgt = 1 - sstep(0, F.blend, fd[0]);
      if (wgt <= 0) continue;
      const ty = F.seg ? F.y0 + (F.y1 - F.y0) * fd[1] : F.y;
      const keep = F.keep ?? 0.12;
      let target = ty + (h - ty) * keep;
      if (F.max !== undefined) target = Math.min(h, F.max);
      h += (target - h) * wgt;
    }
    for (let i = 0; i < cuts.length; i++) {
      const F = cuts[i];
      const fd = footDist(F, x, z);
      const wgt = 1 - sstep(0, F.blend, fd[0]);
      if (wgt > 0) h = Math.min(h, h + (F.y - h) * wgt);
    }
    return h;
  };
}

// ------------------------------------------------------------------------------------------------
// Grid sampling → mesh + sampler.
//   opts.cover(x, z, h, ny, cav, shel) → 0..1 ground-cover weight; opts.bird(x, z, h, hmax) → 0..1
//   opts.scaleTo: rescale the land part so the summit is exactly this high (rocks keep their H)
export function buildTerrain(def, { x0, z0, x1, z1, step = 1, cut = -2.2, cover = null, bird = null, scaleTo = 0, height = null } = {}) {
  const fn = height || makeHeightFn(def);
  const nx = Math.max(2, Math.ceil((x1 - x0) / step) + 1);
  const nz = Math.max(2, Math.ceil((z1 - z0) / step) + 1);
  const N = nx * nz;
  const H = new Float32Array(N);
  let hmax = -Infinity;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const v = fn(x0 + i * step, z);
      H[j * nx + i] = v;
      if (v > hmax) hmax = v;
    }
  }
  if (scaleTo > 0 && hmax > 0.5) {
    const k = scaleTo / hmax;
    for (let i = 0; i < N; i++) if (H[i] > 0) H[i] *= k;
    hmax = scaleTo;
  }
  // normals (central differences)
  const NX = new Float32Array(N), NY = new Float32Array(N), NZ = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * nx + i;
      const hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * nx + i], hu = H[Math.min(nz - 1, j + 1) * nx + i];
      const sx = (hr - hl) / (step * ((i > 0 && i < nx - 1) ? 2 : 1));
      const sz = (hu - hd) / (step * ((j > 0 && j < nz - 1) ? 2 : 1));
      const il = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      NX[id] = -sx * il;
      NY[id] = il;
      NZ[id] = -sz * il;
    }
  }
  // neighbourhood means (cavity ≈ 3 m, shelter ≈ 10 m)
  const B1 = boxBlur(H, nx, nz, Math.max(1, Math.round(1.6 / step)));
  const B2 = boxBlur(H, nx, nz, Math.max(2, Math.round(9 / step)));
  const CAV = new Float32Array(N), SHL = new Float32Array(N), COV = new Float32Array(N), BRD = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * nx + i;
      const x = x0 + i * step, z = z0 + j * step, h = H[id];
      const cav = Math.min(1, Math.max(0, 0.5 + (B1[id] - h) * 0.55));
      const shel = Math.min(1, Math.max(0, 0.5 + (B2[id] - h) * 0.22));
      CAV[id] = cav;
      SHL[id] = shel;
      COV[id] = cover ? cover(x, z, h, NY[id], cav, shel) : 0;
      BRD[id] = bird ? bird(x, z, h, hmax) : 0;
    }
  }
  // indices: keep cells with any corner above the cut; compact the used vertices
  const remap = new Int32Array(N).fill(-1);
  const idx = [];
  let used = 0;
  const use = (id) => {
    if (remap[id] < 0) remap[id] = used++;
    return remap[id];
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (Math.max(H[a], H[b], H[c], H[d]) < cut) continue;
      const A = use(a), Bv = use(b), C = use(c), D = use(d);
      // split along the shorter height diagonal (follows ridges and gullies)
      if (Math.abs(H[a] - H[d]) < Math.abs(H[b] - H[c])) idx.push(A, C, D, A, D, Bv);
      else idx.push(A, C, Bv, Bv, C, D);
    }
  }
  const pos = new Float32Array(used * 3), nrm = new Float32Array(used * 3), ter = new Float32Array(used * 4);
  for (let id = 0; id < N; id++) {
    const k = remap[id];
    if (k < 0) continue;
    const i = id % nx, j = (id - i) / nx;
    pos[k * 3] = x0 + i * step;
    pos[k * 3 + 1] = H[id];
    pos[k * 3 + 2] = z0 + j * step;
    nrm[k * 3] = NX[id];
    nrm[k * 3 + 1] = NY[id];
    nrm[k * 3 + 2] = NZ[id];
    ter[k * 4] = COV[id];
    ter[k * 4 + 1] = CAV[id];
    ter[k * 4 + 2] = SHL[id];
    ter[k * 4 + 3] = BRD[id];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aTerr', new THREE.BufferAttribute(ter, 4));
  g.setIndex(used > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();

  const sampler = makeSampler({ x0, z0, nx, nz, step, H, NY, COV, SHL, CAV });
  sampler.hmax = hmax;
  return { geometry: g, sampler, triangles: idx.length / 3 };
}

function boxBlur(src, nx, nz, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(nx - 1, Math.max(0, i))];
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc / (2 * r + 1);
      acc += src[row + Math.min(nx - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(nz - 1, Math.max(0, j)) * nx + i];
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = acc / (2 * r + 1);
      acc += tmp[Math.min(nz - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
    }
  }
  return out;
}

// Bilinear CPU sampler of the rendered surface (placement of trees, boulders; shoal fitting).
function makeSampler(G) {
  const { x0, z0, nx, nz, step } = G;
  const lerp = (A, x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / step));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / step));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = A[j * nx + i], b = A[j * nx + i + 1], c = A[(j + 1) * nx + i], d = A[(j + 1) * nx + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  return {
    grid: G,
    inside: (x, z) => x >= x0 && z >= z0 && x <= x0 + (nx - 1) * step && z <= z0 + (nz - 1) * step,
    heightAt: (x, z) => lerp(G.H, x, z),
    upAt: (x, z) => lerp(G.NY, x, z),
    coverAt: (x, z) => lerp(G.COV, x, z),
    shelterAt: (x, z) => lerp(G.SHL, x, z),
    cavityAt: (x, z) => lerp(G.CAV, x, z),
    normalAt(x, z, out) {
      const e = step;
      const hx = lerp(G.H, x + e, z) - lerp(G.H, x - e, z);
      const hz = lerp(G.H, x, z + e) - lerp(G.H, x, z - e);
      return out.set(-hx, 2 * e, -hz).normalize();
    },
  };
}

// Collision columns for a landmass (world.obstacles are vertical cylinders): one per square cell
// whose rock rises above `min`, fitted round the grid vertices above it (centroid + farthest).
export function terrainColumns(sampler, { x0, z0, x1, z1 }, { cell = 7, min = 2.5 } = {}) {
  const G = sampler.grid;
  const ncx = Math.ceil((x1 - x0) / cell), ncz = Math.ceil((z1 - z0) / cell);
  const N = ncx * ncz;
  const n = new Uint32Array(N), sx = new Float64Array(N), sz = new Float64Array(N), top = new Float32Array(N).fill(-1e9);
  const cellOf = (x, z) => {
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
    return ci < 0 || cj < 0 || ci >= ncx || cj >= ncz ? -1 : cj * ncx + ci;
  };
  const each = (fn) => {
    for (let j = 0; j < G.nz; j++) {
      const z = G.z0 + j * G.step;
      for (let i = 0; i < G.nx; i++) {
        const h = G.H[j * G.nx + i];
        if (h < min) continue;
        const x = G.x0 + i * G.step;
        const c = cellOf(x, z);
        if (c >= 0) fn(c, x, z, h);
      }
    }
  };
  each((c, x, z, h) => {
    n[c]++;
    sx[c] += x;
    sz[c] += z;
    if (h > top[c]) top[c] = h;
  });
  const rad = new Float32Array(N);
  each((c, x, z) => {
    rad[c] = Math.max(rad[c], Math.hypot(x - sx[c] / n[c], z - sz[c] / n[c]));
  });
  const out = [];
  for (let c = 0; c < N; c++) {
    if (n[c]) out.push({ x: sx[c] / n[c], z: sz[c] / n[c], radius: rad[c] + G.step * 0.5, top: top[c] + 0.3 });
  }
  return out;
}

// Inscribed circles of the land (surf rings for ocean.setShoals): greedy maxima of a chamfer
// distance transform; each circle is the largest one fitting the coast where nothing is covered yet.
export function fitShoals(sampler, count, { minR = 4, margin = 1.5, level = 0.15 } = {}) {
  const { x0, z0, nx, nz, step, H } = sampler.grid;
  const N = nx * nz;
  const D = new Float32Array(N);
  const BIG = 1e9;
  for (let i = 0; i < N; i++) D[i] = H[i] > level ? BIG : 0;
  const a = step, b = step * Math.SQRT2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * nx + i;
      if (D[id] === 0) continue;
      let v = D[id];
      if (i > 0) v = Math.min(v, D[id - 1] + a);
      if (j > 0) {
        v = Math.min(v, D[id - nx] + a);
        if (i > 0) v = Math.min(v, D[id - nx - 1] + b);
        if (i < nx - 1) v = Math.min(v, D[id - nx + 1] + b);
      }
      D[id] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const id = j * nx + i;
      if (D[id] === 0) continue;
      let v = D[id];
      if (i < nx - 1) v = Math.min(v, D[id + 1] + a);
      if (j < nz - 1) {
        v = Math.min(v, D[id + nx] + a);
        if (i < nx - 1) v = Math.min(v, D[id + nx + 1] + b);
        if (i > 0) v = Math.min(v, D[id + nx - 1] + b);
      }
      D[id] = v;
    }
  }
  const out = [];
  for (let n = 0; n < count; n++) {
    let best = -1, bv = minR;
    for (let id = 0; id < N; id++) {
      const v = D[id];
      if (v <= bv || v >= BIG) continue;
      const x = x0 + (id % nx) * step, z = z0 + Math.floor(id / nx) * step;
      let free = true;
      for (const c of out) if (Math.hypot(x - c.x, z - c.z) < c.radius - margin + v * 0.35) { free = false; break; }
      if (free) {
        bv = v;
        best = id;
      }
    }
    if (best < 0) break;
    out.push({ x: x0 + (best % nx) * step, z: z0 + Math.floor(best / nx) * step, radius: D[best] + margin });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Boulder: smooth displaced sphere (seam-free normals from the implicit surface's gradient).
// Unit size ~1, flattened, bottom tucked under; aTerr = (0, cavity, 0, 0).
export function boulderGeometry(seed = 1, wSeg = 14, hSeg = 10) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = g.attributes.position;
  const sy = 0.62;
  const radius = (dx, dy, dz) => {
    const r = 1 + 0.24 * fbm2(dx * 1.3 + dz * 0.7 + seed, dy * 1.3 - dz * 0.9, seed + 3, 3) + 0.07 * noise2(dx * 4.1 + dy * 2.3, dz * 4.1 - dy * 1.7, seed + 9);
    // flattened facets of jointing: two soft planar cuts
    return Math.min(r, 0.86 + 0.25 * Math.abs(dx * 0.8 + dz * 0.6), 0.9 + 0.3 * Math.abs(dz * 0.9 - dx * 0.4));
  };
  const F = (x, y, z) => {
    const qy = y / sy;
    const l = Math.sqrt(x * x + qy * qy + z * z) || 1e-6;
    return l / radius(x / l, qy / l, z / l) - 1;
  };
  const nrm = new Float32Array(pos.count * 3);
  const ter = new Float32Array(pos.count * 4);
  const e = 0.01;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
    const r = radius(dx, dy, dz);
    let x = dx * r, y = dy * r * sy, z = dz * r;
    if (y < -0.18) y = -0.18 + (y + 0.18) * 0.35; // tucked bottom (sits in the sand / on the rock)
    pos.setXYZ(i, x, y, z);
    let gx = F(x + e, y, z) - F(x - e, y, z);
    let gy = F(x, y + e, z) - F(x, y - e, z);
    let gz = F(x, y, z + e) - F(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    nrm[i * 3] = gx / gl;
    nrm[i * 3 + 1] = gy / gl;
    nrm[i * 3 + 2] = gz / gl;
    ter[i * 4 + 1] = 0.5 + 0.5 * Math.max(0, 0.9 - r); // dents read as cavities
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aTerr', new THREE.BufferAttribute(ter, 4));
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  return g;
}

// Boulder placement on a sampler: tide-washed boulders along the shore + a few glacial erratics.
// avoid(x, z) → true to reject. Returns [{x, y, z, s, sy, ry}] in the sampler's coordinates.
export function scatterBoulders(sampler, rnd, { count = 30, erratics = 4, avoid = null, x0, z0, x1, z1 } = {}) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 60) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    const h = sampler.heightAt(x, z);
    if (h < -0.9 || h > 2.3) continue;
    if (avoid && avoid(x, z)) continue;
    const up = sampler.upAt(x, z);
    if (up < 0.55) continue;
    const big = rnd();
    const s = 0.55 + 2.1 * big * big * (h < 0.6 ? 1 : 0.6);
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < (b.s + s) * 0.9)) continue;
    out.push({ x, y: h - 0.22 * s, z, s, sy: 0.8 + 0.5 * rnd(), ry: rnd() * Math.PI * 2 });
  }
  tries = 0;
  let placed = 0;
  while (placed < erratics && tries++ < erratics * 80) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    const h = sampler.heightAt(x, z);
    if (h < 3 || sampler.upAt(x, z) < 0.88 || sampler.cavityAt(x, z) > 0.6) continue;
    if (avoid && avoid(x, z)) continue;
    const s = 1.3 + 1.4 * rnd();
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < (b.s + s) * 1.2)) continue;
    out.push({ x, y: h - 0.18 * s, z, s, sy: 0.85 + 0.3 * rnd(), ry: rnd() * Math.PI * 2 });
    placed++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Ground cover rules (shared by all landmasses; amounts per landmass via `k`).
export function coverRule(seed, k = 1) {
  return (x, z, h, ny, cav, shel) => {
    const spray = sstep(1.9, 4.2, h); // salt spray zone stays bare
    const flat = sstep(0.62, 0.86, ny);
    const hollow = sstep(0.36, 0.62, cav * 0.7 + shel * 0.5); // soil gathers in concave sites
    const patch = 0.5 + 0.5 * fbm2(x * 0.07, z * 0.07, seed + 41, 3);
    const v = spray * flat * (0.2 + 0.8 * hollow) * (0.5 + 0.8 * patch) * k;
    return Math.min(1, Math.max(0, v * 1.25));
  };
}
