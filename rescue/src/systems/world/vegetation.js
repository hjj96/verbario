// Northern vegetation (DESIGN §2.11; user feedback «деревья … реалистичнее»): sparse, wind-shaped.
//   spruce   krummholz Picea in sheltered hollows: drooping branch whorls of alpha-tested needle
//            fronds (procedural canvas), sharp leader, star-shaped crown from above; per-instance
//            whorl twist, size, colour, lean and windward flagging; sways with look.uniforms.uWind
//   shrubs   dwarf birch in autumn rust/orange/yellow + juniper / crowberry mats (dome clumps)
//   tufts    sedge / grass tufts near paths and in hollows
// Three instanced meshes, one shared material (+ one alpha-tested depth material for shadows).
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS, LOOK_GLSL_FUNCS } from '../../core/look.js';
import { rng } from './geo.js';

export const VEG_COUNTS = {
  high: { spruce: 64, shrub: 300, tuft: 340 },
  medium: { spruce: 46, shrub: 190, tuft: 150 },
  low: { spruce: 28, shrub: 90, tuft: 0 },
};
const PREVAIL = new THREE.Vector2(-0.7, 0.7).normalize(); // prevailing gales from the south-west

// ------------------------------------------------------------------------------------------------
// Card atlas (512², sRGB): A/B spruce fronds (0..1 × .75..1), C birch clump (0..0.5 × .25..0.75),
// D juniper clump (0.5..1 × .25..0.75), E grass tuft (0..0.5 × 0..0.25), F bark (0.5..0.56 × 0..0.25)
let vegTex = null;
function drawFrond(g, ox, oy, w, h, seed) {
  const r = rng(seed);
  const cy = oy + h / 2;
  // soft body keeps alpha coverage in the small mips
  g.fillStyle = 'rgba(26,40,30,0.62)';
  g.beginPath();
  g.ellipse(ox + w * 0.5, cy, w * 0.47, h * 0.26, 0, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = '#3B3328';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(ox + 2, cy);
  g.quadraticCurveTo(ox + w * 0.5, cy + 2, ox + w - 4, cy - 1);
  g.stroke();
  const greens = ['#22362A', '#273D2E', '#2C4532', '#1E3026', '#33503A'];
  for (let x = 8; x < w - 8; x += 7) {
    const t = x / w;
    for (const side of [-1, 1]) {
      const len = h * 0.46 * (1 - t * 0.72) * (0.8 + 0.3 * r());
      const ang = side * (0.95 + 0.25 * r());
      const bx = ox + x, by = cy + side * 1.5;
      const ex = bx + Math.cos(ang * 0.55) * len * 0.55, ey = by + Math.sin(ang) * len;
      g.strokeStyle = '#3A3A2A';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(ex, ey);
      g.stroke();
      const n = Math.floor(len / 2.2);
      for (let k = 0; k < n; k++) {
        const q = k / n;
        const px = bx + (ex - bx) * q, py = by + (ey - by) * q;
        const tip = t > 0.7 || q > 0.75;
        g.strokeStyle = tip && r() < 0.6 ? (r() < 0.5 ? '#4A6640' : '#3F5A3A') : greens[Math.floor(r() * greens.length)];
        g.lineWidth = 1.6;
        for (const s2 of [-1, 1]) {
          const a = Math.atan2(ey - by, ex - bx) + s2 * (0.9 + 0.3 * r());
          const l = 3.5 + 2.5 * r();
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
          g.stroke();
        }
      }
    }
  }
}
function drawClump(g, ox, oy, s, seed, cols, leaf) {
  const r = rng(seed);
  const cx = ox + s / 2, cy = oy + s / 2;
  g.fillStyle = leaf ? 'rgba(70,45,28,0.55)' : 'rgba(30,42,30,0.6)';
  g.beginPath();
  g.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
  g.fill();
  // twigs
  g.strokeStyle = '#3E3128';
  g.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42);
    g.stroke();
  }
  const n = leaf ? 520 : 1400;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * s * 0.46 * (0.85 + 0.15 * Math.sin(a * 5 + seed));
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.strokeStyle = g.fillStyle;
    if (leaf) {
      g.beginPath();
      g.ellipse(x, y, 3.2 + 2 * r(), 2.2 + 1.2 * r(), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    } else {
      const b = r() * Math.PI * 2;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(b) * 4.5, y + Math.sin(b) * 4.5);
      g.stroke();
    }
  }
}
function drawTuft(g, ox, oy, w, h, seed) {
  const r = rng(seed);
  const cols = ['#8C8250', '#6F7444', '#A39A64', '#5E6640', '#7D7550', '#93885A'];
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const bx = ox + w / 2 + (r() - 0.5) * w * 0.18;
    const lean = (r() - 0.5) * w * 0.9;
    const top = oy + h * (0.05 + 0.4 * r());
    g.strokeStyle = cols[Math.floor(r() * cols.length)];
    g.lineWidth = 1.6 + 1.4 * r();
    g.beginPath();
    g.moveTo(bx, oy + h);
    g.quadraticCurveTo(bx + lean * 0.3, oy + h * 0.55, bx + lean, top);
    g.stroke();
  }
}
export function vegTexture() {
  if (vegTex) return vegTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  drawFrond(g, 0, 0, 256, 128, 11);
  drawFrond(g, 256, 0, 256, 128, 23);
  drawClump(g, 0, 128, 256, 31, ['#B5651D', '#C9A13B', '#8E3B22', '#A0522D', '#6E7A3A', '#B8862E', '#7A3320'], true);
  drawClump(g, 256, 128, 256, 37, ['#2C3B2A', '#3A4A33', '#26332A', '#46553A', '#33402E'], false);
  drawTuft(g, 0, 384, 256, 128, 41);
  g.fillStyle = '#4A4038';
  g.fillRect(256, 384, 32, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  vegTex = t;
  return t;
}

// ------------------------------------------------------------------------------------------------
// Geometries (unit height 1; aVeg = (height fraction, along-branch / outer 0..1, phase, whorl))
class Builder {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.a = [];
    this.i = [];
  }
  v(x, y, z, nx, ny, nz, u, w, a0, a1, a2, a3) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z);
    this.n.push(nx / l, ny / l, nz / l);
    this.uv.push(u, w);
    this.a.push(a0, a1, a2, a3);
    return this.p.length / 3 - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.a, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

function spruceGeometry(seed = 5) {
  const r = rng(seed);
  const B = new Builder();
  const NW = 12, NB = 5, SEG = 3;
  for (let i = 0; i < NW; i++) {
    const t = i / (NW - 1);
    const y = 0.05 + 0.84 * t;
    const L = 0.23 * Math.pow(1 - t, 0.9) + 0.035;
    const frond = r() < 0.5 ? 0 : 0.5;
    for (let j = 0; j < NB; j++) {
      const th = (j / NB) * Math.PI * 2 + i * 0.7 + (r() - 0.5) * 0.5;
      const dx = Math.cos(th), dz = Math.sin(th);
      const px = -dz, pz = dx;
      const roll = (r() - 0.5) * 0.6;
      const wd = L * (0.62 + 0.15 * r());
      const droop = 0.5 + 0.25 * r();
      const ph = r();
      const base = B.p.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const s = k / SEG;
        const cx = dx * L * s, cz = dz * L * s;
        const cy = y + L * (0.22 * s - droop * s * s);
        // card spans ±wd/2 across, rolled about the branch, following the droop
        const hx = px * Math.cos(roll) * wd * 0.5, hz = pz * Math.cos(roll) * wd * 0.5, hy = Math.sin(roll) * wd * 0.5;
        const nx = dx * (0.35 + 0.6 * s), nz = dz * (0.35 + 0.6 * s), ny = 0.75 - 0.25 * s;
        const u = frond + s * 0.5;
        B.v(cx - hx, cy - hy, cz - hz, nx, ny, nz, u, 0.75, y, s, ph, i);
        B.v(cx + hx, cy + hy, cz + hz, nx, ny, nz, u, 1.0, y, s, ph, i);
      }
      for (let k = 0; k < SEG; k++) {
        const a = base + k * 2;
        B.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  // leader: two crossed narrow vertical cards → the sharp tip
  for (let c = 0; c < 2; c++) {
    const ax = c ? 0 : 1, az = c ? 1 : 0;
    const base = B.p.length / 3;
    const w = 0.05;
    for (let k = 0; k <= 1; k++) {
      const y = 0.8 + 0.22 * k;
      B.v(-ax * w, y, -az * w, ax * 0.3, 1, az * 0.3, 0.12 + 0.36 * k, 0.75, y, 1, 0.3, NW);
      B.v(ax * w, y, az * w, -ax * 0.3, 1, -az * 0.3, 0.12 + 0.36 * k, 1.0, y, 1, 0.3, NW);
    }
    B.i.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  // trunk: 5-sided cone in bark
  const TS = 5;
  const tb = B.p.length / 3;
  for (let k = 0; k <= TS; k++) {
    const a = (k / TS) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    B.v(cx * 0.03, 0, cz * 0.03, cx, 0.2, cz, 0.505 + 0.05 * (k / TS), 0.02, 0, 0, 0, 0);
    B.v(cx * 0.006, 0.85, cz * 0.006, cx, 0.2, cz, 0.505 + 0.05 * (k / TS), 0.22, 0.85, 0, 0, 0);
  }
  for (let k = 0; k < TS; k++) {
    const a = tb + k * 2;
    B.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return B.build();
}

function shrubGeometry(seed = 9) {
  const r = rng(seed);
  const B = new Builder();
  const N = 9;
  for (let c = 0; c < N; c++) {
    const top = c === 0;
    const a = top ? 0 : ((c - 1) / (N - 1)) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const ring = top ? 0 : 0.42 + 0.12 * r();
    const tilt = top ? 0.12 : 0.55 + 0.35 * r(); // radians from horizontal, facing out
    const cx = Math.cos(a) * ring, cz = Math.sin(a) * ring;
    const cy = top ? 0.62 : 0.3 + 0.12 * r();
    const s = top ? 0.62 : 0.5 + 0.12 * r();
    // card axes: radial (tilted up) and tangent
    const rx = Math.cos(a), rz = Math.sin(a);
    const tx = -rz, tz = rx;
    const ux = rx * Math.cos(tilt), uy = Math.sin(tilt), uz = rz * Math.cos(tilt);
    const nx = rx * 0.6, nz = rz * 0.6, ny = 1;
    const base = B.p.length / 3;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [i, j] of corners) {
      const x = cx + (tx * i + ux * j) * s * 0.5;
      const y = cy + uy * j * s * 0.5;
      const z = cz + (tz * i + uz * j) * s * 0.5;
      B.v(x, Math.max(0, y), z, nx + x * 0.5, ny, nz + z * 0.5, (i + 1) * 0.25, 0.25 + (j + 1) * 0.25, y / 0.9, Math.min(1, Math.hypot(x, z) / 0.7), r(), 0);
    }
    B.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return B.build();
}

function tuftGeometry() {
  const B = new Builder();
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI;
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = B.p.length / 3;
    for (let k = 0; k <= 1; k++) {
      const y = k;
      const w = 0.5 + 0.1 * k;
      B.v(-dx * w, y, -dz * w, 0, 1, 0.2, 0, k * 0.25, y, k, c * 0.3, 0);
      B.v(dx * w, y, dz * w, 0, 1, 0.2, 0.5, k * 0.25, y, k, c * 0.3, 0);
    }
    B.i.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return B.build();
}

// ------------------------------------------------------------------------------------------------
// Material: wind + per-instance variation in the vertex stage (shared with the depth material).
const VEG_VERTEX_PARS = /* glsl */ `
  attribute vec4 aVeg;
  attribute vec2 aInst;   // x exposure (flagging 0..1), y seed
  uniform vec2 uPrevail;
  varying float vVegAO;
  varying vec3 vVegW;
`;
const VEG_PROJECT = /* glsl */ `
  float vSeed = aInst.y;
  #ifdef VEG_SPRUCE
    // per-tree whorl twist (no two crowns alike) + windward flagging (branches pruned by gales)
    float tw = (fract(sin(aVeg.w * 12.9898 + vSeed * 78.233) * 43758.5453) - 0.5) * 1.1;
    float cs = cos(tw), sn = sin(tw);
    transformed.xz = mat2(cs, -sn, sn, cs) * transformed.xz;
    vec3 bdir = mat3(instanceMatrix) * vec3(transformed.x, 0.0, transformed.z);
    float wind = dot(normalize(bdir.xz + 1e-4), -uPrevail);
    transformed.xz *= 1.0 - 0.45 * aInst.x * smoothstep(-0.1, 0.9, wind) * aVeg.y;
  #endif
  #ifdef VEG_VARIANT
    vMapUv.x += step(vSeed, 0.38) * 0.5;
  #endif
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 vegBase = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float instH = length(instanceMatrix[1].xyz);
  #else
    vec3 vegBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float instH = 1.0;
  #endif
  {
    float ws = length(uWind);
    vec2 wd = ws > 0.01 ? uWind / ws : vec2(1.0, 0.0);
    float gust = lookGust(vegBase.xz);
    float k = clamp(ws / 22.0, 0.0, 1.4);
    float sway = (0.3 + 0.7 * gust) * k * k + 0.05 * k + 0.004;
    float osc = 0.62 + 0.38 * sin(uTime * (1.2 + 0.5 * vSeed) + vSeed * 6.28 + dot(vegBase.xz, wd) * 0.07);
    float bend = instH * 0.08 * sway * osc * aVeg.x * aVeg.x;
    mvPosition.xz += wd * bend;
    mvPosition.y -= bend * bend / max(instH, 0.2) * 0.5;
    float fl = sin(uTime * (5.0 + 2.5 * aVeg.z) + aVeg.z * 12.0 + vSeed * 20.0) * (0.2 + 0.8 * gust) * (k + 0.05);
    mvPosition.y += fl * 0.03 * instH * aVeg.y;
    mvPosition.xz += wd * fl * 0.02 * instH * aVeg.y;
  }
  vVegAO = (0.42 + 0.58 * aVeg.y) * (0.72 + 0.28 * aVeg.x);
  vVegW = (modelMatrix * mvPosition).xyz;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

function patchVertex(sh, u, defines) {
  Object.assign(sh.uniforms, u);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${LOOK_GLSL_UNIFORMS}\n${LOOK_GLSL_FUNCS}\n${VEG_VERTEX_PARS}`)
    .replace('#include <project_vertex>', VEG_PROJECT);
  sh.defines = Object.assign(sh.defines || {}, defines);
}

export function createVegMaterials(look, shared, kind) {
  const tex = vegTexture();
  const defines = {};
  if (kind === 'spruce') defines.VEG_SPRUCE = '';
  if (kind === 'shrub') defines.VEG_VARIANT = '';
  const u = { ...look.uniforms, uRim: shared.uRim, uCloudK: shared.uCloudK, uPrevail: { value: PREVAIL } };
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  mat.name = `world-veg-${kind}`;
  mat.onBeforeCompile = (sh) => {
    patchVertex(sh, u, defines);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${LOOK_GLSL_UNIFORMS}
        ${LOOK_GLSL_FUNCS}
        uniform vec3 uRim;
        uniform float uCloudK;
        varying float vVegAO;
        varying vec3 vVegW;`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `{ // keep foliage coverage in the small mips (alpha-test thinning)
          vec2 ts = vMapUv * 512.0;
          float mip = max(0.0, 0.5 * log2(max(dot(dFdx(ts), dFdx(ts)), dot(dFdy(ts), dFdy(ts)))));
          diffuseColor.a *= 1.0 + mip * 0.22;
        }
        #include <alphatest_fragment>
        diffuseColor.rgb *= vVegAO * (1.0 - 0.12 * uWet);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize(vNormal); // soft crown normals on both faces of the cards`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRim * diffuseColor.rgb * 0.25; // sky through the foliage`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float vegCloud = mix(1.0, 0.72, lookCloud(vVegW.xz) * uCloudK);
        reflectedLight.directDiffuse *= vegCloud;
        reflectedLight.directSpecular *= vegCloud;
        reflectedLight.indirectDiffuse *= vVegAO;`,
      );
  };
  mat.customProgramCacheKey = () => `mayday-veg-${kind}-v1`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    patchVertex(sh, u, defines);
    sh.vertexShader = sh.vertexShader.replace('varying float vVegAO;', 'float vVegAO;').replace('varying vec3 vVegW;', 'vec3 vVegW;');
  };
  depth.customProgramCacheKey = () => `mayday-veg-depth-${kind}-v1`;
  return { mat, depth };
}

// ------------------------------------------------------------------------------------------------
// Scatter on a terrain sampler (island-local coordinates).
//   clear(x, z, pad) → true where nothing may grow (structures, paths)
export class Vegetation {
  constructor(look, shared, sampler, { quality = 'high', seed = 1, bounds, clear = null, pathDist = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.meshes = {};
    const r = rng(seed);
    const S = sampler;
    const max = VEG_COUNTS.high;
    const { x0, z0, x1, z1 } = bounds;
    const free = (x, z, pad) => !(clear && clear(x, z, pad));
    const grow = (x, z) => {
      const h = S.heightAt(x, z);
      if (h < 2.6) return 0;
      return S.coverAt(x, z) * S.upAt(x, z);
    };

    // --- spruce groves in the sheltered hollows + solitary wind-pruned mats
    const trees = [];
    const groves = [];
    for (let t = 0; t < 1200 && groves.length < 5; t++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      const sc = grow(x, z) * S.shelterAt(x, z);
      if (sc < 0.12 || !free(x, z, 6)) continue;
      if (groves.some((g) => Math.hypot(g.x - x, g.z - z) < 15)) continue;
      groves.push({ x, z, sc });
    }
    for (let t = 0; t < 4000 && trees.length < max.spruce; t++) {
      const solo = trees.length > max.spruce * 0.85;
      let x, z;
      if (!solo && groves.length) {
        const g = groves[t % groves.length];
        const a = r() * Math.PI * 2, d = Math.abs(r() + r() - 1) * 11;
        x = g.x + Math.cos(a) * d;
        z = g.z + Math.sin(a) * d;
      } else {
        x = x0 + r() * (x1 - x0);
        z = z0 + r() * (z1 - z0);
      }
      if (!S.inside(x, z) || !free(x, z, 2)) continue;
      const gr = grow(x, z), shel = S.shelterAt(x, z);
      if (gr < 0.2 || S.upAt(x, z) < 0.8) continue;
      const hgt = solo ? 1.1 + 1.0 * r() : (3 + 4.5 * r()) * (0.65 + 0.5 * Math.min(1, shel * 1.4));
      const rad = hgt * 0.3;
      if (trees.some((q) => Math.hypot(q.x - x, q.z - z) < (q.r + rad) * 0.62)) continue;
      trees.push({ x, z, y: S.heightAt(x, z) - 0.15, h: hgt, r: rad, solo, exp: solo ? 1 : Math.max(0, 0.9 - shel) });
    }
    // --- shrubs: anywhere the tundra is thick; birch in hollows, juniper / crowberry on knolls
    const shrubs = [];
    for (let t = 0; t < 9000 && shrubs.length < max.shrub; t++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!S.inside(x, z) || !free(x, z, 0.5)) continue;
      const gr = grow(x, z);
      if (gr < 0.15 + 0.35 * r()) continue;
      const s = 0.45 + 0.9 * r() * r();
      if (trees.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 0.8)) continue;
      shrubs.push({ x, z, y: S.heightAt(x, z) - 0.05, s, hs: 0.45 + 0.4 * r() });
    }
    // --- tufts: path verges, round the buildings, wet hollows
    const tufts = [];
    for (let t = 0; t < 9000 && tufts.length < max.tuft; t++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!S.inside(x, z) || !free(x, z, 0)) continue;
      const pd = pathDist ? pathDist(x, z) : 9;
      const gr = grow(x, z) + (pd < 3.5 ? 0.35 : 0) + S.cavityAt(x, z) * 0.3 - 0.15;
      if (gr < 0.25 + 0.3 * r()) continue;
      tufts.push({ x, z, y: S.heightAt(x, z) - 0.03, s: 0.28 + 0.3 * r() });
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    const make = (kind, geo, list, fill) => {
      const { mat, depth } = createVegMaterials(look, shared, kind);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      mesh.name = `veg-${kind}`;
      mesh.customDepthMaterial = depth;
      mesh.castShadow = kind !== 'tuft';
      mesh.receiveShadow = true;
      const inst = new Float32Array(Math.max(1, list.length) * 2);
      list.forEach((it, i) => {
        fill(it, i);
        mesh.setMatrixAt(i, m4.compose(p, q, sc));
        mesh.setColorAt(i, col);
        inst[i * 2] = it.exp || 0;
        inst[i * 2 + 1] = r();
      });
      geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
      mesh.count = list.length;
      mesh.userData.full = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes[kind] = mesh;
    };
    make('spruce', spruceGeometry(seed + 3), trees, (it) => {
      // lean away from the prevailing gales; mats are squat and wide
      const lean = (it.solo ? 0.12 : 0.05) * (0.4 + it.exp);
      e.set(PREVAIL.y * lean, r() * Math.PI * 2, -PREVAIL.x * lean, 'YXZ');
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      const wide = it.solo ? 1.9 : 1;
      sc.set(it.h * wide, it.h, it.h * wide);
      const k = 0.78 + 0.4 * r();
      col.setRGB(k * (0.92 + 0.16 * r()), k * (0.95 + 0.12 * r()), k * (0.88 + 0.2 * r()));
    });
    make('shrub', shrubGeometry(seed + 5), shrubs, (it) => {
      e.set((r() - 0.5) * 0.25, r() * Math.PI * 2, (r() - 0.5) * 0.25);
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      sc.set(it.s, it.s * it.hs, it.s);
      col.setRGB(0.8 + 0.35 * r(), 0.8 + 0.3 * r(), 0.8 + 0.25 * r());
    });
    make('tuft', tuftGeometry(), tufts, (it) => {
      e.set((r() - 0.5) * 0.2, r() * Math.PI * 2, (r() - 0.5) * 0.2);
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      sc.set(it.s, it.s * (0.8 + 0.6 * r()), it.s);
      col.setRGB(0.85 + 0.3 * r(), 0.85 + 0.25 * r(), 0.8 + 0.2 * r());
    });
    this.setQuality(quality);
  }

  setQuality(q) {
    const c = VEG_COUNTS[q] || VEG_COUNTS.high;
    for (const [kind, mesh] of Object.entries(this.meshes)) {
      mesh.count = Math.min(mesh.userData.full, c[kind] ?? 0);
      mesh.visible = mesh.count > 0;
    }
  }

  get triangles() {
    let t = 0;
    for (const mesh of Object.values(this.meshes)) t += (mesh.geometry.index.count / 3) * mesh.count;
    return t;
  }

  dispose() {
    this.group.removeFromParent();
    for (const mesh of Object.values(this.meshes)) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.customDepthMaterial.dispose();
      mesh.dispose?.();
    }
  }
}
