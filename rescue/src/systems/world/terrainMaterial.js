// Terrain material (DESIGN §2.1, §2.7, §2.11): weathered Arctic granite + tundra ground cover.
// MeshStandardMaterial + onBeforeCompile (shadows, fog patch, every light for free):
//   granite      grey-pink mottling, biotite/quartz grain, quartz veins, joint cracks (tileable
//                rock texture, triplanar) + crisp micro bump from the same fields (derivative bump)
//   lichens      pale crust patches, yellow-green map lichen, orange Xanthoria on sunny faces
//   shore        zonation that follows the swell: wet line (sets every ~6 s), Fucus band, barnacle
//                specks, black Verrucaria band, orange lichen zone above the spray line
//   cover        aTerr.x (flat, sheltered, above the spray): tundra moss, crowberry, heather,
//                dwarf birch rust, straw sedge; hummocky clumps; ragged edges round outcrops
//   guano        white streaks down steep faces (bird rocks: aTerr.w), whitewashed crowns
//   weather      uWet darkens + polishes, puddles in flat hollows; cavity AO on the ambient light;
//                cloud shadows + night rim shared with the props (no pure black, §2.1)
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS, LOOK_GLSL_FUNCS } from '../../core/look.js';
import { hash01 } from './terrain.js';

// ------------------------------------------------------------------------------------------------
// Tileable rock detail texture (256², linear, mipmapped):
//   R granite mottling + grain, G crack lines, B bump height, A clump / lichen-rosette mask.
const RT = 256;
let rockTex = null;

function pgrad(x, y, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => {
    const a = hash01(((ix % P) + P) % P, ((iy % P) + P) % P, s) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const a = g(xi, yi, fx, fy), b = g(xi + 1, yi, fx - 1, fy);
  const c = g(xi, yi + 1, fx, fy - 1), d = g(xi + 1, yi + 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}
function pfbm(u, v, P, oct, s) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * pgrad(u * P, v * P, P, s + o * 13);
    norm += amp;
    P *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}
const _w = [0, 0, 0];
function pworley(u, v, N, s) {
  const x = u * N, y = v * N;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % N) + N) % N, wy = ((cy % N) + N) % N;
      const dx = cx + hash01(wx, wy, s) - x;
      const dy = cy + hash01(wx, wy, s + 101) - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash01(wx, wy, s + 202);
      } else if (d < f2) f2 = d;
    }
  }
  _w[0] = f1;
  _w[1] = f2;
  _w[2] = id;
  return _w;
}
const sm = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function rockTexture() {
  if (rockTex) return rockTex;
  const data = new Uint8Array(RT * RT * 4);
  const S = 913;
  for (let y = 0; y < RT; y++) {
    for (let x = 0; x < RT; x++) {
      const u = x / RT, v = y / RT;
      const mott = 0.5 + 0.5 * pfbm(u, v, 4, 5, S);
      const grain = hash01(x, y, S + 7);
      // warped joint blocks (5 per tile) + finer fracture net (11 per tile)
      const wu = u + 0.035 * pfbm(u, v, 3, 3, S + 11), wv = v + 0.035 * pfbm(u + 0.5, v, 3, 3, S + 12);
      const W1 = pworley(wu, wv, 5, S + 21);
      const e1 = W1[1] - W1[0], f1 = W1[0];
      const W2 = pworley(wu * 1.0, wv * 1.0, 11, S + 31);
      const e2 = W2[1] - W2[0];
      // fractures open only in places (gated by noise) — granite is not crazy paving
      const gate1 = sm(0.05, 0.3, pfbm(u, v, 3, 3, S + 41));
      const gate2 = sm(0.2, 0.45, pfbm(u + 0.3, v + 0.6, 4, 3, S + 43));
      const crack = Math.max((1 - sm(0.0, 0.035, e1)) * gate1, 0.45 * (1 - sm(0.0, 0.03, e2)) * gate2);
      // clumps / rosettes: 16 per tile, random size and strength
      const W3 = pworley(u, v, 16, S + 51);
      const rad = 0.35 + 0.4 * W3[2];
      const clump = (1 - sm(rad * 0.45, rad, W3[0])) * (0.45 + 0.55 * hash01(Math.floor(W3[2] * 977), 3, S));
      const speck = grain < 0.12 ? 0.2 : grain > 0.9 ? 0.85 : 0.55;
      const R = 0.82 * mott + 0.18 * speck;
      const B = 0.42 * (1 - Math.min(1, f1 * f1)) + 0.33 * mott + 0.1 * grain + 0.15 - 0.45 * crack;
      const i = (y * RT + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, R)) * 255);
      data[i + 1] = Math.round(Math.min(1, crack) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, B)) * 255);
      data[i + 3] = Math.round(Math.min(1, clump) * 255);
    }
  }
  const t = new THREE.DataTexture(data, RT, RT, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  rockTex = t;
  return t;
}

// ------------------------------------------------------------------------------------------------
const PALETTE = {
  cGranL: '#8A8884',
  cGranD: '#454549',
  cGranP: '#8C7A72',
  cQuartz: '#BDB8AE',
  cLichG: '#9EA095',
  cLichY: '#8E8A5A',
  cLichO: '#B0703A',
  cBlack: '#262522',
  cWeed: '#3A3820',
  cBarn: '#ABA799',
  cMoss: '#4E5A38',
  cCrow: '#2F3826',
  cHeath: '#5A4655',
  cRust: '#6E5136',
  cStraw: '#7D7550',
  cGuano: '#D9D6CB',
};

// Uniforms every terrain material shares (world.update writes uSwell).
const GLOWS = 4;
export const terrainUniforms = {
  uSwell: { value: 0.5 },
  uTGlow: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
  uTGlowCol: { value: Array.from({ length: GLOWS }, () => new THREE.Color(0, 0, 0)) },
};
// Local light spill on the terrain (world position, radius m, colour × intensity): pad floods etc.
export function setTerrainGlow(i, x, y, z, radius, color, intensity) {
  if (i >= GLOWS) return;
  terrainUniforms.uTGlow.value[i].set(x, y, z, Math.max(0.1, radius));
  terrainUniforms.uTGlowCol.value[i].copy(color).multiplyScalar(intensity);
}

export function createTerrainMaterial(look, shared, { name = 'terrain', lq = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.name = `world-${name}`;
  const u = {
    ...look.uniforms,
    uRim: shared.uRim,
    uCloudK: shared.uCloudK,
    uRock: { value: rockTexture() },
    uSwell: terrainUniforms.uSwell,
    uTGlow: terrainUniforms.uTGlow,
    uTGlowCol: terrainUniforms.uTGlowCol,
  };
  for (const [k, v] of Object.entries(PALETTE)) u[k] = { value: new THREE.Color(v) };
  mat.userData.uniforms = u;
  if (lq) mat.defines = { TERRAIN_LQ: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aTerr;
        varying vec4 vTerr;
        varying vec3 vTW;
        varying vec3 vTN;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec3 terrN = objectNormal;
        #ifdef USE_INSTANCING
          terrN = mat3(instanceMatrix) * terrN;
        #endif
        vTN = normalize(mat3(modelMatrix) * terrN);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerr = aTerr;
        vec4 terrW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          terrW = instanceMatrix * terrW;
        #endif
        vTW = (modelMatrix * terrW).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${LOOK_GLSL_UNIFORMS}
        ${LOOK_GLSL_FUNCS}
        uniform vec3 uRim;
        uniform float uCloudK;
        uniform sampler2D uRock;
        uniform float uSwell;
        uniform vec4 uTGlow[${GLOWS}];
        uniform vec3 uTGlowCol[${GLOWS}];
        uniform vec3 ${Object.keys(PALETTE).join(', ')};
        varying vec4 vTerr;
        varying vec3 vTW;
        varying vec3 vTN;
        vec4 terrTri(vec3 p, vec3 w, float s) {
          return texture2D(uRock, p.xz * s) * w.y
               + texture2D(uRock, p.zy * s + vec2(0.31, 0.17)) * w.x
               + texture2D(uRock, p.xy * s + vec2(0.67, 0.43)) * w.z;
        }
        // derivative bump (perturbNormalArb on a procedural height, metres)
        vec3 terrBump(vec3 pos, vec3 n, float h) {
          vec3 sx = dFdx(pos), sy = dFdy(pos);
          vec3 r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(h), dFdy(h));
          vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
          return normalize(abs(det) * n - g);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 tn = normalize(vTN);
        vec3 tw = pow(abs(tn), vec3(4.0));
        tw /= tw.x + tw.y + tw.z;
        vec3 P = vTW;
        float up = tn.y;
        float tCover = vTerr.x, tCav = vTerr.y, tShel = vTerr.z, tBird = vTerr.w;
        vec4 R1 = terrTri(P, tw, 1.0 / 15.0);
        #ifdef TERRAIN_LQ
          vec4 R2 = R1;
        #else
          vec4 R2 = texture2D(uRock, P.xz * (1.0 / 3.1) + vec2(0.13, 0.71));
          R2 = mix(R1, R2, tw.y);
        #endif
        vec4 M = texture2D(uAtlas, P.xz * (1.0 / 90.0) + vec2(0.21, 0.47));
        vec4 M2 = texture2D(uAtlas, P.xz * (1.0 / 23.0) + vec2(0.61, 0.09));

        // --- granite
        float mott = R1.r * 0.65 + M2.r * 0.35;
        vec3 alb = mix(cGranD, cGranL, smoothstep(0.2, 0.85, mott));
        alb = mix(alb, cGranP, smoothstep(0.55, 0.85, M2.g) * 0.28);
        alb *= (0.84 + 0.32 * R2.r) * (0.76 + 0.42 * M.r);
        float vq = abs(fract(dot(P, vec3(0.071, 0.023, -0.052)) + 0.4 * M2.r) - 0.5);
        alb = mix(alb, cQuartz, (1.0 - smoothstep(0.004, 0.012, vq)) * smoothstep(0.5, 0.75, M.g) * 0.4);
        // lichens: pale crusts, yellow-green map lichen, orange on sunny (south) faces & perches
        float lich = smoothstep(0.52, 0.72, M2.r * 0.5 + R1.r * 0.3 + R2.a * 0.15 + 0.1 * up);
        alb = mix(alb, cLichG, lich * 0.5);
        alb = mix(alb, cLichY, smoothstep(0.7, 0.86, M2.g * 0.55 + R2.a * 0.45) * 0.3 * smoothstep(0.2, 0.7, up));
        // dark streaks: black crust lichen and seepage down the slopes
        float streakD = smoothstep(0.56, 0.78, M2.b * 0.55 + R1.r * 0.45) * smoothstep(0.97, 0.55, up);
        alb *= 1.0 - 0.45 * streakD;
        float sunny = smoothstep(-0.15, 0.55, tn.z) * (0.35 + 0.65 * smoothstep(0.25, 0.8, up));
        float orng = smoothstep(0.74, 0.9, R2.a * 0.65 + R1.a * 0.25 + 0.18 * sunny + 0.3 * tBird);
        alb = mix(alb, cLichO, orng * (0.25 + 0.45 * sunny));
        // joints: texture cracks + two straight joint sets (only where the warp lets them open)
        float jA = abs(fract(dot(P.xz, vec2(0.083, 0.031)) + 0.18 * M2.r) - 0.5);
        float jB = abs(fract(dot(P.xz, vec2(-0.027, 0.091)) + 0.2 * M.r) - 0.5);
        float joint = max((1.0 - smoothstep(0.0, 0.012, jA)) * smoothstep(0.5, 0.62, M2.b + 0.2),
                          (1.0 - smoothstep(0.0, 0.01, jB)) * smoothstep(0.55, 0.7, M.b + 0.25));
        float crack = max(max(R1.g, R2.g * 0.35), joint * smoothstep(0.3, 0.8, up + 0.4));
        alb *= 1.0 - 0.5 * crack;

        // --- shore zonation (sea level 0; the swell sets wet the rock every ~6 s)
        float yW = P.y + (M2.r - 0.5) * 0.7 + (R1.r - 0.5) * 0.25;
        float spray = 1.5 + 0.55 * uSwell;
        float surge = (0.25 + 0.2 * uSwell) * (0.6 + 0.4 * sin(uTime * 1.05 + dot(P.xz, vec2(0.05, 0.031))));
        float weed = 1.0 - smoothstep(0.45, 0.95, yW);
        float barn = smoothstep(0.55, 0.85, yW) * (1.0 - smoothstep(1.2, 1.7, yW));
        float blk = smoothstep(0.9, 1.4, yW) * (1.0 - smoothstep(spray, spray + 0.9, yW));
        float xan = smoothstep(spray, spray + 0.7, yW) * (1.0 - smoothstep(spray + 1.6, spray + 3.2, yW));
        alb = mix(alb, cLichO * 0.9, xan * smoothstep(0.55, 0.75, R2.a * 0.6 + M2.g * 0.4) * 0.7);
        alb = mix(alb, cLichY, xan * smoothstep(0.6, 0.8, R1.a + 0.2 * M.r) * 0.35);
        alb = mix(alb, cBlack, blk * (0.65 + 0.3 * R2.r));
        alb = mix(alb, cBarn, barn * step(0.62, R2.a * 0.7 + R2.r * 0.4) * 0.8);
        alb = mix(alb, cWeed * (0.75 + 0.5 * R2.a), weed * smoothstep(0.15, 0.5, up + 0.3));

        // --- ground cover (tundra: moss, crowberry, heather, dwarf birch, sedge)
        float cm = smoothstep(0.24, 0.5, tCover + (R1.a - 0.5) * 0.3 + (M2.r - 0.5) * 0.35 - (1.0 - up) * 1.4);
        // crowberry / grass lines in the joint clefts: pale rock ribs, dark veg-filled cracks
        float jv = max((1.0 - smoothstep(0.0, 0.032, jA)) * smoothstep(0.5, 0.62, M2.b + 0.2),
                       (1.0 - smoothstep(0.0, 0.028, jB)) * smoothstep(0.55, 0.7, M.b + 0.25));
        jv *= smoothstep(0.62, 0.86, up) * smoothstep(2.3, 3.6, P.y) * smoothstep(0.3, 0.6, R1.a + 0.3);
        cm = max(cm, jv * 0.9);
        vec3 veg = cMoss;
        veg = mix(veg, cCrow, smoothstep(0.42, 0.68, M2.g));
        veg = mix(veg, cHeath, smoothstep(0.5, 0.78, M.r) * 0.85);
        veg = mix(veg, cRust, smoothstep(0.58, 0.8, M2.r * 0.7 + R1.a * 0.3) * 0.75);
        veg = mix(veg, cStraw, clamp(smoothstep(0.45, 0.2, tShel) * 0.55 + smoothstep(0.8, 0.96, M.g) * 0.4, 0.0, 0.8));
        veg = mix(veg, cMoss * 0.8, smoothstep(0.6, 0.85, tCav) * 0.5); // wet moss in hollows
        veg *= 0.72 + 0.5 * R2.a;
        veg *= 1.0 - 0.35 * R1.g;
        alb = mix(alb, veg, cm);

        // --- guano: streaks down steep faces, whitewashed crowns of bird rocks
        vec2 gs = abs(tn.x) > abs(tn.z) ? P.zy : P.xy;
        float streak = smoothstep(0.6, 0.78, texture2D(uAtlas, vec2(gs.x * 0.31, gs.y * 0.022 + 0.37)).r);
        float gu = streak * (1.0 - smoothstep(0.35, 0.75, up)) * smoothstep(2.5, 6.0, P.y) * (0.03 + 0.97 * tBird);
        gu = max(gu, tBird * smoothstep(0.55, 0.8, up) * smoothstep(0.35, 0.65, R1.a * 0.6 + M2.r * 0.4));
        alb = mix(alb, cGuano, gu * (1.0 - cm) * 0.85);

        // --- cavity occlusion (dirt), wetness, puddles
        float ao = mix(1.0, 0.62, smoothstep(0.52, 0.92, tCav)) * (1.0 - 0.25 * crack);
        alb *= mix(1.0, ao, 0.6);
        float wetSea = 1.0 - smoothstep(surge, surge + 0.45, yW);
        float damp = (1.0 - smoothstep(surge + 0.3, surge + 1.6, yW)) * 0.55;
        float wet = max(max(wetSea, damp), uWet * (1.0 - 0.35 * cm));
        float pud = uWet * smoothstep(0.6, 0.82, tCav) * smoothstep(0.93, 0.985, up) * (1.0 - 0.6 * cm);
        alb *= 1.0 - 0.42 * wet * (1.0 - 0.4 * cm);
        alb *= 1.0 - 0.35 * pud;
        diffuseColor.rgb = alb;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.86, 0.95, max(cm, lich * 0.5));
        roughnessFactor = mix(roughnessFactor, 0.3, wet * (1.0 - 0.5 * cm));
        roughnessFactor = mix(roughnessFactor, 0.06, pud);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifndef TERRAIN_LQ
        {
          float bh = (R1.b - 0.5) * 0.11 + (R2.b - 0.5) * 0.05 - crack * 0.05 + cm * (R2.a - 0.5) * 0.09;
          bh *= (1.0 - 0.8 * pud) / (1.0 + length(vViewPosition) * 0.004);
          normal = terrBump(-vViewPosition, normal, bh);
        }
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float terrRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        // sky fill + moonlit rim (never pure black at night, §2.1) + flood / window spill
        vec3 terrSpill = vec3(0.0);
        for (int i = 0; i < ${GLOWS}; i++) {
          vec3 gd = vTW - uTGlow[i].xyz;
          terrSpill += uTGlowCol[i] * exp(-dot(gd, gd) / (uTGlow[i].w * uTGlow[i].w));
        }
        totalEmissiveRadiance += diffuseColor.rgb * (uRim * (0.08 + 0.45 * terrRim) + uNight * vec3(0.05, 0.062, 0.08) + terrSpill);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float terrCloud = mix(1.0, 0.72, lookCloud(vTW.xz) * uCloudK);
        reflectedLight.directDiffuse *= terrCloud;
        reflectedLight.directSpecular *= terrCloud;
        reflectedLight.indirectDiffuse *= ao;
        reflectedLight.indirectSpecular *= mix(1.0, ao, 0.7);`,
      );
  };
  mat.customProgramCacheKey = () => `mayday-terrain-v1${mat.defines && mat.defines.TERRAIN_LQ !== undefined ? '-lq' : ''}`;
  return mat;
}
