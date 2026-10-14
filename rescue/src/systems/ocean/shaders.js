// GLSL for the sea surface (DESIGN §2.6.1–2.6.7, §2.7.2). Injected into MeshStandardMaterial by
// material.js so the water keeps three.js lighting (sun shadow, heli SpotLight, pooled PointLights).
//
// Injection order (fragment): color_fragment → roughnessmap_fragment → normal_fragment_maps →
// emissivemap_fragment → lights_fragment_begin (shadow/cloud capture) → before opaque_fragment.
// Everything is computed once in the color stage (world space) and handed to later stages
// through main-scope variables prefixed with `o`.
import { LOOK_GLSL_UNIFORMS, LOOK_GLSL_FUNCS } from '../../core/look.js';
import { GLSL_NOISE } from '../../core/math.js';
import { FEATURES_GLSL } from './features.js';

// ---- shared by vertex + fragment + self-test -------------------------------------------------
export const OCEAN_COMMON = /* glsl */ `
#ifndef OCEAN_WAVES
#define OCEAN_WAVES 8
#endif
uniform vec4 uWaveA[8];      // Dx, Dz, k, a
uniform vec4 uWaveB[8];      // b, phase (wrapped, grid-relative), L, wind alignment (whitecap crests)
uniform vec2 uOffset;        // snapped world position of the grid origin
uniform float uGridStep;     // 2 / N
uniform float uHsEff;        // effective significant height (colour normalisation)
uniform int uShoalCount;
uniform vec4 uShoals[8];     // x, z, radius, 1
${FEATURES_GLSL}
varying vec2 vGrid;          // lagrangian world xz (foam & dye ride the orbits)
varying vec3 vOWorld;        // displaced world position
varying vec4 vOAux;          // y/Hs, Jacobian, grid cell size, wave damping (edge × shoals)

// Local cell size of the warped grid: derivative of 380·|x|^1.6 (same as waves.js cellSize()).
float oceanCell(vec2 gl) {
  float m = max(abs(gl.x), abs(gl.y)) * (1.0 / 380.0);
  return 608.0 * uGridStep * pow(max(m, 1e-5), 0.375);
}
float oceanEdge(vec2 gl) {
  return 1.0 - smoothstep(380.0, 1200.0, max(abs(gl.x), abs(gl.y)));
}
float oceanShoalDamp(vec2 p) {
  float d = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uShoalCount) break;
    vec4 s = uShoals[i];
    d *= 0.15 + 0.85 * smoothstep(s.z * 0.9, s.z * 2.6, length(p - s.xy));
  }
  return d;
}
`;

// ---- vertex ------------------------------------------------------------------------------------
export const OCEAN_VERTEX_PARS = /* glsl */ `
${OCEAN_COMMON}
// Gerstner bank + features at grid vertex gl (local coordinates). Mirrors WaveBank._eval().
void oceanVertex(vec2 gl, out vec3 pos, out vec3 nrm) {
  vec2 p0 = gl + uOffset;
  float cell = oceanCell(gl);
  float damp = oceanEdge(gl) * oceanShoalDamp(p0);
  vec2 dxz = vec2(0.0);
  float y = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0, sx = 0.0, sz = 0.0;
  float nxx = 0.0, nzz = 0.0, nxz = 0.0;
  if (damp > 0.0) {
    for (int i = 0; i < OCEAN_WAVES; i++) {
      vec4 A = uWaveA[i];
      vec4 B = uWaveB[i];
      float w = damp * smoothstep(3.5, 5.0, B.z / cell);   // LOD: short waves move to the fragment normal
      // Normals need more vertices per wavelength than the displacement: a wave sampled by 4–8
      // vertices gives piecewise-linear normals — the blocky checker seen on the calm swell from
      // altitude. Below 10 cells per wavelength its normal is computed per fragment instead.
      float wn = damp * smoothstep(7.0, 10.0, B.z / cell);
      float th = A.z * dot(A.xy, gl) + B.y;
      float s = sin(th);
      float c = cos(th);
      float a = A.w * w;
      float b = B.x * w;
      dxz += (b * c) * A.xy;
      y += a * s;
      float kbs = A.z * b * s;
      jxx += kbs * A.x * A.x;
      jzz += kbs * A.y * A.y;
      jxz += kbs * A.x * A.y;
      float kbn = A.z * B.x * wn * s;
      nxx += kbn * A.x * A.x;
      nzz += kbn * A.y * A.y;
      nxz += kbn * A.x * A.y;
      float kac = A.z * A.w * wn * c;
      sx += kac * A.x;
      sz += kac * A.y;
    }
  }
  float fh = 0.0;
  vec2 fg = vec2(0.0);
  if (uFeatCount > 0 || uDownwash.w > 0.0) {
    fh = oceanFeatureHeight(p0);
    fg = vec2(oceanFeatureHeight(p0 + vec2(0.5, 0.0)) - fh, oceanFeatureHeight(p0 + vec2(0.0, 0.5)) - fh) * 2.0;
  }
  vec3 tx = vec3(1.0 - nxx, sx + fg.x, -nxz);
  vec3 tz = vec3(-nxz, sz + fg.y, 1.0 - nzz);
  nrm = normalize(cross(tz, tx));
  pos = vec3(p0.x + dxz.x, y + fh, p0.y + dxz.y);
  vGrid = p0;
  vOWorld = pos;
  vOAux = vec4(pos.y / uHsEff, (1.0 - jxx) * (1.0 - jzz) - jxz * jxz, cell, damp);
}
`;

export const OCEAN_VERTEX_BEGINNORMAL = /* glsl */ `
vec3 oPos;
vec3 oNrm;
oceanVertex(position.xz, oPos, oNrm);
vec3 objectNormal = oNrm;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

export const OCEAN_VERTEX_BEGIN = /* glsl */ `
vec3 transformed = oPos;
`;

// ---- fragment ----------------------------------------------------------------------------------
export const OCEAN_FRAGMENT_PARS = /* glsl */ `
${OCEAN_COMMON}
${LOOK_GLSL_UNIFORMS}
${LOOK_GLSL_FUNCS}
${GLSL_NOISE}
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uCrest;
uniform vec3 uShallow;
uniform vec3 uFoamCol;
uniform vec3 uSkyCol;
uniform vec3 uFogCol;
uniform vec3 uSunCol;
uniform vec3 uSpecCol;
uniform vec3 uAmbCol;
uniform vec3 uShadowTint;
uniform vec3 uFlashCol;
uniform vec3 uSunDirV;     // true visual sun direction (glitter, SSS)
uniform vec4 uSeaA;        // detail, whitecaps, streaks, foamLines
uniform vec4 uSeaB;        // roughness (incl. rain), sss, clearing, sunIntensity
uniform vec4 uSeaC;        // cloud reflection, cloud shadow, shadow intensity, glitter
uniform vec4 uSeaD;        // glitter exponent, glitter light lift, residual lace, bioluminescence
uniform vec4 uSeaE;        // mean wind m/s, flash, night, ambient intensity
uniform vec4 uJStats;      // K = Σ k·b, sigma of normalised crest compression
uniform vec4 uDetOff;      // detail tile offsets (uv): 14 m tile .xy, 5.5 m tile .zw
uniform vec4 uDetRot;      // detail frames: (cos, sin) base swell, (cos, sin) base + 37°
uniform vec4 uStreakRot;   // streak frames A (xy) and B (zw)
uniform float uStreakMix;  // 0 → frame A, 1 → frame B (wind turned: cross-fade)
uniform vec4 uHeliP;       // heli x, z, altitude, enabled
uniform vec3 uSearchPos;
uniform vec4 uSearchDir;   // axis xyz, cos(outer)
uniform float uSearchI;
uniform int uGlintCount;
uniform vec4 uGlints[8];   // x, z, radius, intensity
uniform vec4 uGlintCol[8];
uniform int uSplashCount;
uniform vec4 uSplash[24];  // x, z, age, radius
uniform vec4 uSplashS[6];  // strengths, packed 4 per vec4
uniform sampler2D uMem;    // water memory: R foam, G dye, B disturbance, A oil
uniform vec4 uMemWin;      // centre x, z, window size, enabled
uniform vec3 uSunDirS;     // shadow-casting (clamped) sun direction
uniform float uSpotWater;  // share of the physical SpotLights on the water
uniform vec4 uFront;       // spatial weather front (DESIGN §2.5): origin xz, unit direction xz
uniform vec4 uFrontB;      // travelled distance (speed·t), half-width W, active, 0
uniform vec3 uPrevDeep;    // palettePrev / paletteNext subset blended per pixel across the front
uniform vec3 uPrevBody;
uniform vec3 uPrevCrest;
uniform vec3 uPrevFoam;
uniform vec3 uNextDeep;
uniform vec3 uNextBody;
uniform vec3 uNextCrest;
uniform vec3 uNextFoam;
uniform vec4 uPrevSea;     // detail, whitecaps, streaks, foamLines
uniform vec4 uNextSea;
uniform vec4 uLookK;       // sun share of the light, look gain / exposure, flash shadow, sun-disk specular

// Exact inverse of three's ACES fit (input matrix → RRT/ODT fit → output matrix). Palette colours
// are the intended on-screen colours (they follow the DESIGN §2.1 luminance law), so the water's
// own radiance is "what ACES needs to show that colour", then shaded by shadows and N·L.
vec3 oInvACES(vec3 y) {
  const mat3 OUT_INV = mat3(vec3(0.643038, 0.059269, 0.005962), vec3(0.311187, 0.931436, 0.063929), vec3(0.045775, 0.009295, 0.930118));
  const mat3 IN_INV = mat3(vec3(1.764741, -0.147028, -0.036337), vec3(-0.675778, 1.160252, -0.162436), vec3(-0.088963, -0.013224, 1.198773));
  vec3 v = clamp(OUT_INV * y, 0.0, 0.95);
  vec3 a = 1.0 - 0.983729 * v;
  vec3 b = 0.0245786 - 0.4329510 * v;
  vec3 c = -0.000090537 - 0.238081 * v;
  vec3 u = (-b + sqrt(b * b - 4.0 * a * c)) / (2.0 * a);
  return max(IN_INV * u, vec3(0.0)) * 0.6;
}

vec2 oToFrame(vec2 p, vec2 cs) { return vec2(cs.x * p.x + cs.y * p.y, -cs.y * p.x + cs.x * p.y); }
vec2 oFromFrame(vec2 q, vec2 cs) { return vec2(cs.x * q.x - cs.y * q.y, cs.y * q.x + cs.x * q.y); }
// Foam density f → appearance: a ragged dense core, and a Worley lace net (lace = look.lace R)
// wherever there is any foam — the net is what decaying foam looks like from above.
float oFoamShape(float f, float lace, float rag) {
  float dense = smoothstep(0.58, 0.98, f + 0.35 * (rag - 0.5));
  float net = smoothstep(0.05, 0.38, lace) * smoothstep(0.1, 0.55, f);
  // dense foam is bubbly, not flat white: lace and the ragged noise modulate it
  return max(dense * (0.72 + 0.16 * smoothstep(0.0, 0.3, lace) + 0.24 * rag), net * 0.85);
}
// Wind streaks: long meandering bands along the wind (q.x along, q.y across), broken up along
// their length; returns a 0..1 amount (caller textures it with lace).
float oStreakBands(vec2 q, float spacing, float seed) {
  float lv = q.y / spacing + (texture2D(uAtlas, vec2(q.x * 0.0028, q.y * 0.006 + seed)).r - 0.5) * 0.45;
  lv += (texture2D(uAtlas, vec2(q.x * 0.021, q.y * 0.013 + seed * 3.0)).r - 0.5) * 0.22;      // small wobble
  float id = floor(lv);
  float d = abs(fract(lv) - 0.5);
  // each band id reads its own noise row: R = breaks into 15–60 m segments, G = width, B = strength
  vec4 t = texture2D(uAtlas, vec2(q.x * 0.006 + fract(id * 0.618) * 7.0, fract(id * 0.382) + seed));
  float brk = smoothstep(0.5, 0.72, t.r * 0.65 + t.b * 0.35);
  float w = 0.025 + 0.09 * t.g;
  return (1.0 - smoothstep(0.0, w, d)) * brk * (0.55 + 0.45 * t.b);
}
// Lace lookup with an explicit LOD (polar coordinates have a seam that breaks automatic mips).
float oLaceLod(vec2 uv, float footUv, int ch) {
  vec4 t = textureLod(uLace, uv, log2(max(footUv * 512.0, 1.0)));
  return ch == 0 ? t.r : (ch == 1 ? t.g : t.b);
}
`;

// Color stage: the whole surface model. Sets diffuseColor and the o* variables used later.
export const OCEAN_FRAGMENT_SURFACE = /* glsl */ `
vec3 oP = vOWorld;
vec3 oV = normalize(cameraPosition - oP);
vec2 oXZ = oP.xz;
vec2 oG = vGrid;
float oFoot = max(length(fwidth(oG)), 0.002);           // metres per pixel
float oH01 = clamp(0.5 + vOAux.x, 0.0, 1.0);
float oCell = vOAux.z;
float oDamp = vOAux.w;
vec3 oNm = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);   // macro normal, world
float oT = uTime;
float oNight = uSeaE.z;
vec2 oWd = length(uWind) > 0.05 ? normalize(uWind) : vec2(1.0, 0.0);
vec2 oFlow = uWindOffset * 0.03;                          // surface drift ≈ 3% of the wind
float oShadow = 1.0;                                      // captured in the light loop

// ---- spatial weather front: the new weather sweeps across the sea as a ragged line
vec3 cDeep = uDeep;
vec3 cBody = uBody;
vec3 cCrest = uCrest;
vec3 cFoam = uFoamCol;
vec4 cSea = uSeaA;
if (uFrontB.z > 0.5) {
  float along = dot(oXZ - uFront.xy, uFront.zw) - uFrontB.x;
  along += (texture2D(uAtlas, oXZ * 0.004 + vec2(0.21, 0.47)).r - 0.5) * uFrontB.y * 0.9;
  float f = smoothstep(-uFrontB.y, uFrontB.y, along);     // 1 = the old weather still holds here
  cDeep = mix(uNextDeep, uPrevDeep, f);
  cBody = mix(uNextBody, uPrevBody, f);
  cCrest = mix(uNextCrest, uPrevCrest, f);
  cFoam = mix(uNextFoam, uPrevFoam, f);
  cSea = mix(uNextSea, uPrevSea, f);
}

// ---- 2. gusts: the same field that pushes the helicopter (look.gustField / frontsAt)
float oGust = lookGust(oXZ);
float oFrontW = lookFronts(oXZ);
float oGustV = clamp(max(oGust, oFrontW * 0.16), 0.0, 1.0);
float oULoc = uSeaE.x * (0.85 + 0.3 * oGust) + oFrontW;

// ---- 9. rotor downwash disc
vec2 oDwD = oXZ - uDownwash.xy;
float oDwR = length(oDwD);
vec2 oDwDir = oDwD / max(oDwR, 1e-3);
float oDwS = uDownwash.w;
float oDwIn = oDwS * (1.0 - smoothstep(0.8 * uDownwash.z, 1.08 * uDownwash.z, oDwR));
float oLow = (1.0 - smoothstep(8.0, 12.0, uHeliP.z)) * step(0.001, oDwS);

// ---- 11. searchlight pool (CPU mirror: Ocean.searchlightAt)
float oBeam = 0.0;
float oRing = 0.0;
float oRho = 2.0;
if (uSearchI > 0.0) {
  vec3 sl = oP - uSearchPos;
  float sd = length(sl);
  float cs = dot(sl / max(sd, 1e-3), uSearchDir.xyz);
  oRho = acos(clamp(cs, -1.0, 1.0)) / max(acos(uSearchDir.w), 1e-3);
  float range = 1.0 - smoothstep(220.0, 320.0, sd);
  oBeam = uSearchI * range * (1.0 - smoothstep(0.72, 1.0, oRho));
  vec2 ctr = uSearchPos.xz + uSearchDir.xz * (uSearchPos.y / max(-uSearchDir.y, 0.05));
  vec2 rc = oXZ - ctr;
  float flick = 1.0 + 0.015 * sin(atan(rc.y, rc.x) * 9.0 + oT * 23.0) + 0.01 * sin(oT * 61.0);
  oRing = uSearchI * range * exp(-pow((oRho - 0.85) / 0.07, 2.0)) * flick;
}

// ---- 1. normals: macro (vertex) + 2 detail octaves + LOD'd short waves + ripples
vec2 oSm = -oNm.xz / max(oNm.y, 0.2);
vec2 oSd = vec2(0.0);
float oDetAmt = cSea.x * (0.6 + 0.8 * oGustV) * (1.0 + 0.3 * oBeam);
{
  vec2 t1 = texture2D(uDetail, oToFrame(oG, uDetRot.xy) / 14.0 + uDetOff.xy).rg * 2.0 - 1.0;
#if OCEAN_Q > 0
  vec2 t2 = texture2D(uDetail, oToFrame(oG, uDetRot.zw) / 5.5 + uDetOff.zw).rg * 2.0 - 1.0;
  vec2 det = oFromFrame(t1, uDetRot.xy) * 0.6 + oFromFrame(t2, uDetRot.zw) * 0.4;
#else
  vec2 det = oFromFrame(t1, uDetRot.xy);
#endif
  // amplitude calibrated to wind-ripple slope statistics (Cox–Munk σ ≈ 0.08 calm … 0.3 storm)
  oSd += det * (1.5 * oDetAmt);
}
for (int i = 0; i < OCEAN_WAVES; i++) {
  vec4 A = uWaveA[i];
  vec4 B = uWaveB[i];
  float wv = oDamp * (1.0 - smoothstep(7.0, 10.0, B.z / oCell)) * smoothstep(2.5, 5.0, B.z / oFoot);
  if (wv <= 0.0) continue;
  float th = A.z * dot(A.xy, oG - uOffset) + B.y;
  oSd += (A.w * A.z * cos(th) * wv) * A.xy;
}
if (oDwIn > 0.0) oSd += oDwDir * (sin(oDwR * 4.2 - oT * 15.0) * 0.10 * oDwIn);

// splash rings (24 analytic slots)
float oSplF = 0.0;
for (int i = 0; i < 24; i++) {
  if (i >= uSplashCount) break;
  vec4 s = uSplash[i];
  float life = 1.4 + 0.3 * s.w;
  float k = s.z / life;
  if (k >= 1.0) continue;
  vec2 d = oXZ - s.xy;
  float r = length(d);
  float rr = s.w * (0.35 + 2.4 * sqrt(k));
  float x = (r - rr) / (0.3 + 0.15 * s.w);
  if (abs(x) > 4.0 && r > rr) continue;
  float str = uSplashS[i >> 2][i & 3];
  float env = (1.0 - k) * (1.0 - k) * str;
  oSd += d / max(r, 1e-3) * (cos(x * 2.6) * exp(-0.5 * x * x) * env * 0.35);
  float core = (1.0 - smoothstep(0.2 * rr, rr, r)) * (1.0 - smoothstep(0.0, 0.45, k)) * str;
  oSplF = max(oSplF, max(exp(-x * x) * env, core * 0.8));
}

// 8. rain rings (two cell layers), denser with rain; first rare big rings
#if OCEAN_RAIN_LAYERS > 0
if (uRain > 0.02) {
  float big = mix(1.6, 1.0, smoothstep(0.1, 0.6, uRain));
  for (int l = 0; l < OCEAN_RAIN_LAYERS; l++) {
    float sz = (l == 0 ? 0.9 : 0.55) * big;
    vec2 cc = oXZ / sz + float(l) * 17.3;
    vec2 ci = floor(cc);
    vec2 cf = fract(cc) - 0.5;
    vec2 h = hash22(ci);
    float tt = oT / 0.7 + h.x * 7.0;
    float cyc = floor(tt);
    float ph = tt - cyc;
    float on = step(hash12(ci + cyc * 3.17), uRain * uRain * 0.85 + 0.08 * uRain);
    vec2 dd = cf - (h - 0.5) * 0.36;
    float dr = length(dd);
    float wr = max(0.05, oFoot / sz * 0.8);
    float x = (dr - ph * 0.42) / wr;
    float ring = exp(-x * x) * (1.0 - ph) * on * (1.0 - smoothstep(0.25, 1.1, oFoot / sz));
    oSd += dd / max(dr, 1e-3) * ring * 0.45;
  }
}
#endif

// ---- 3. body colour, cat's paws, troughs, pressed water
// Wave groups: the fixed Gerstner bank interferes into a regular lattice, and colouring every crest
// equally drew it as a checker in calm and as hard diagonal bands in clearing. Crests read in sets
// instead (low-frequency group envelope), and the height tint fades with the pixel footprint so a
// 0.4 m swell does not paint the sea when seen from 230 m.
float oGroup = smoothstep(0.15, 0.85, texture2D(uAtlas, oXZ * 0.0045 + vec2(0.61, 0.13) - uWindOffset * 0.003).r);
float oHc = clamp(0.5 + (oH01 - 0.5) * mix(0.3, 1.2, oGroup) * mix(1.0, 0.6, smoothstep(0.15, 0.6, oFoot)), 0.0, 1.0);
vec3 oBodyC = mix(cDeep, cBody, pow(oHc, 1.2));
oBodyC *= mix(0.78, 1.0, smoothstep(0.0, 0.45, oHc));
oBodyC *= 1.0 - 0.12 * oGustV * (1.0 - 0.75 * oNight);
oBodyC *= 1.0 - 0.10 * oDwIn;

// ---- 4. shallows & surf around rocks
float oShallow = 0.0;
float oSurf = 0.0;
for (int i = 0; i < 8; i++) {
  if (i >= uShoalCount) break;
  vec4 s = uShoals[i];
  float d = length(oXZ - s.xy) - s.z;
  d += (texture2D(uAtlas, oXZ * 0.045 + s.xy * 0.013).r - 0.5) * (0.6 * s.z + 2.0);   // rocks aren't circles
  oShallow = max(oShallow, 1.0 - smoothstep(0.0, 1.8 * s.z + 6.0, d));
  float setT = fract(oT / 6.0 + s.x * 0.013 + s.y * 0.007);    // sets every 6 s
  float bandPos = mix(9.0, 0.5, setT);
  float band = exp(-pow((d - bandPos) / 1.8, 2.0)) * (0.3 + 0.7 * (1.0 - setT));
  float wash = 1.0 - smoothstep(0.0, 2.5, d);
  oSurf = max(oSurf, max(band, wash * 0.9) * step(-1.0, d));
}
oBodyC = mix(oBodyC, uShallow, oShallow * 0.85);

// ---- big features: rogue wave, spout base, whirlpool (shading; heights come from the vertex)
float oFeatFoam = 0.0;
float oFeatDark = 0.0;
float oFeatSss = 0.0;
float oAbyss = 0.0;
for (int i = 0; i < 4; i++) {
  if (i >= uFeatCount) break;
  vec4 A = uFeatA[i];
  vec4 B = uFeatB[i];
  vec4 C = uFeatC[i];
  if (A.x < 1.5) {
    vec3 f = oRogueFrame(oG, A, B);
    float W = max(B.z, 1.0);
    float xf = f.x / W;                                   // > 0 ahead of the crest
    float hk = clamp(A.w / 8.0, 0.0, 1.0);
    // white lip with irregular rounded lobes along the crest ("пальцы пены")
    float n1 = texture2D(uAtlas, vec2(f.y * 0.009, 0.37)).r;
    float n2 = texture2D(uAtlas, vec2(f.y * 0.043, 0.71)).r;
    float sl = sin(f.y * 0.175 + n1 * 4.0);
    float lobe = sl * sl;                                         // rounded lobes, no cusps
    float edge = 0.05 + (0.06 + 0.24 * lobe) * (0.55 + 0.9 * n2);
    float lip = (1.0 - smoothstep(edge - 0.1, edge + 0.06, xf)) * smoothstep(-1.3, -0.25, xf);
    // white-water carpet behind the crest, decaying into a lace scar over 30–40 s
    float behind = max(-f.x, 0.0);
    float travelled = C.y * C.z;
    float carpet = (0.3 + 0.7 * exp(-behind / 45.0)) * exp(-behind / max(C.z * 30.0, 60.0))
                 * (1.0 - smoothstep(travelled * 0.8, travelled + 1.0, behind)) * smoothstep(-0.15, -0.9, xf);
    oFeatFoam = max(oFeatFoam, max(lip * hk, carpet * C.x) * f.z);
    // bottle-green glass just under the lip, then the dark steep face (deep·0.6)
    oFeatSss = max(oFeatSss, exp(-pow((xf - edge - 0.2) / 0.28, 2.0)) * f.z * hk);
    oFeatDark = max(oFeatDark, smoothstep(edge + 0.2, edge + 0.6, xf) * (1.0 - smoothstep(1.3, 2.4, xf)) * f.z * hk);
    // suction ahead of the wall: foam streaks pulled toward it
    float ahead = smoothstep(1.0, 1.8, xf) * (1.0 - smoothstep(2.8, 7.0, xf));
    float strk = smoothstep(0.6, 0.85, texture2D(uAtlas, vec2(f.x * 0.004, f.y * 0.06)).r);
    oFeatFoam = max(oFeatFoam, ahead * strk * f.z * hk * 0.55);
  } else {
    vec2 d = oG - A.yz;
    float r = length(d);
    float R = max(B.x, 1.0);
    float s = A.w;
    float ang = atan(d.y, d.x);
    float age = C.x;
    float lr = log(max(r, 0.5) / R);
    float fuv = oFoot * max(0.08, 1.2732 / max(r, 1.0));
    if (A.x < 2.5) {
      float disc = (1.0 - smoothstep(0.5 * R, 1.5 * R, r)) * smoothstep(0.0, 0.25, s);
      float ringD = exp(-pow((r - 1.2 * R) / (0.16 * R), 2.0)) * smoothstep(0.2, 0.5, s);
      oFeatDark = max(oFeatDark, max(disc * 0.4, ringD * 0.75));
      float arms = sin(4.0 * (ang + B.y * 2.2 * lr) + B.y * age * 5.0);
      float spiral = smoothstep(0.35, 0.95, arms) * (1.0 - smoothstep(0.9 * R, 1.6 * R, r))
                   * smoothstep(0.08 * R, 0.3 * R, r) * smoothstep(0.25, 0.6, s);
      float ringF = exp(-pow((r - R) / (0.1 * R), 2.0)) * smoothstep(0.55, 0.9, s);
      float lace = oLaceLod(vec2(ang * 1.2732, r * 0.08 - age * 0.9 * B.y), fuv, 2);
      float brk = smoothstep(0.3, 0.6, oLaceLod(vec2(ang * 0.6366, r * 0.03 - age * 0.3 * B.y), fuv * 0.4, 1));
      oFeatFoam = max(oFeatFoam, max(spiral * brk * (0.55 + 0.6 * lace), ringF * (0.75 + 0.4 * lace)));
    } else {
      float arms = sin(5.0 * (ang - B.y * 1.8 * lr) - B.y * age * (1.2 + 2.0 / (0.3 + r / R)));
      float a = smoothstep(0.25, 0.9, arms) * (1.0 - smoothstep(R, 1.4 * R, r)) * smoothstep(0.1 * R, 0.35 * R, r);
      float rim = exp(-pow((r - R) / (0.12 * R), 2.0));
      float lace = oLaceLod(vec2(ang * 1.2732, r * 0.06 + age * 0.5), fuv, 0);
      float brk = smoothstep(0.3, 0.62, oLaceLod(vec2(ang * 0.6366, r * 0.025 + age * 0.2), fuv * 0.4, 1));
      oFeatFoam = max(oFeatFoam, (a * brk * 0.85 + rim * 0.7) * s * clamp(0.55 + 0.6 * lace, 0.0, 1.0));
      oAbyss = max(oAbyss, (1.0 - smoothstep(0.05 * R, 0.4 * R, r)) * s);
      oFeatDark = max(oFeatDark, (1.0 - smoothstep(0.3 * R, 0.9 * R, r)) * s * 0.5);
    }
  }
}

// ---- 6.6 water memory (render target)
vec4 oMem = vec4(0.0);
#ifdef OCEAN_MEMORY
{
  vec2 muv = (oXZ - uMemWin.xy) / uMemWin.z + 0.5;
  vec2 me = smoothstep(0.0, 0.07, muv) * (1.0 - smoothstep(0.93, 1.0, muv));
  oMem = max(texture2D(uMem, muv), vec4(0.0)) * (me.x * me.y);
}
#endif

// ---- 7. foam layers (combined with max). Fresh foam is dense white with a ragged edge; the
// Worley lace only lives in its fringes and in aged foam (oFoamShape).
float oLaceA = texture2D(uLace, oG * 0.16 - oFlow * 0.16).r;
float oRag = texture2D(uAtlas, oG * 0.045 + vec2(0.17, 0.53) - oFlow * 0.045).r;
// 7a whitecaps — Monahan coverage ∝ U^3.41; preset value = mean, local gusts modulate (softened)
float oCov = clamp(cSea.y * 0.45 * pow(max(oULoc, 0.0) / max(uSeaE.x, 1.0), 2.5), 0.0, 0.6);
oCov *= 1.0 - oLow * (1.0 - smoothstep(0.7, 1.0, oDwR / max(uDownwash.z, 1.0)));             // "ты низко"
float oWc = 0.0;
float oWcRaw = 0.0;
if (oCov > 0.002) {
  // breaking happens on the crests of the shorter wind waves (bank waves 3–6, unit amplitude, so
  // the pattern is quality-independent), grouped on the long-wave crests (Jacobian), broken up by fbm
  float c = (1.0 - vOAux.y) / max(uJStats.x, 0.02) / max(uJStats.y, 0.05);
  float cs = 0.0;
  for (int i = 3; i < 7; i++) cs += uWaveB[i].w * sin(uWaveA[i].z * dot(uWaveA[i].xy, oG - uOffset) + uWaveB[i].y);
  cs *= uJStats.z;                                                                           // → unit variance
  vec2 qw = oToFrame(oG - oFlow, oWd);                                                       // patches long across the wind
  float nz = (texture2D(uAtlas, qw * vec2(0.024, 0.014) + vec2(0.63, 0.29)).r - 0.5) * 5.0;
  float cc = 0.65 * c + 0.5 * cs + 0.4 * nz;
  float z = 0.588 * log((1.0 - oCov) / oCov);                                                // ≈ Φ⁻¹(1 − coverage)
  oWcRaw = smoothstep(z - 0.3, z + 1.9, cc);
  oWc = oFoamShape(oWcRaw, oLaceA, oRag);
}
// 7b streaks along the wind (Beaufort ≥ 7) and 7c Langmuir windrows / foam lines (≈ 30 m)
float oStreak = 0.0;
float oStreakRaw = 0.0;
float oLines = 0.0;
if (cSea.z + cSea.w > 0.001) {
  vec2 qa = oToFrame(oG - oFlow, uStreakRot.xy);
  float sa = max(oStreakBands(qa, 9.0, 0.13) * 0.7, oStreakBands(qa, 23.0, 0.57) * 0.85);
  float la = texture2D(uAtlas, qa * vec2(0.0035, 0.012)).r;
  if (uStreakMix > 0.001) {
    vec2 qb = oToFrame(oG - oFlow, uStreakRot.zw);
    sa = mix(sa, max(oStreakBands(qb, 9.0, 0.13) * 0.7, oStreakBands(qb, 23.0, 0.57) * 0.85), uStreakMix);
    la = mix(la, texture2D(uAtlas, qb * vec2(0.0035, 0.012)).r, uStreakMix);
    qa = mix(qa, qb, uStreakMix);
  }
  float laceS = texture2D(uLace, vec2(qa.x * 0.03, qa.y * 0.15)).r;                          // net stretched by the wind
  oStreakRaw = sa * clamp(cSea.z * (0.45 + 0.75 * oGustV), 0.0, 1.0);
  oStreak = oFoamShape(oStreakRaw, laceS, oRag) * 0.8;
  float lv = qa.y / 30.0 + la * 1.4;
  float line = 1.0 - smoothstep(0.01, 0.05, abs(fract(lv) - 0.5));
  float brk = smoothstep(0.35, 0.65, texture2D(uAtlas, qa * vec2(0.011, 0.03) + 0.5).r);
  float lf = line * brk * cSea.w;
  oLines = oFoamShape(lf, laceS, oRag) * 0.8;
}
// 9 downwash: lacy foam edge running outward, fresh white ring when low
float oDwFoam = 0.0;
if (oDwS > 0.001) {
  // radius wobbles with direction (seamless: sampled by the unit vector, no atan seam)
  float R = uDownwash.z * (1.0 + 0.14 * (texture2D(uAtlas, oDwDir * 0.33 + vec2(oT * 0.03, 0.31)).r - 0.5));
  float ringP = exp(-pow((oDwR - R) / (0.16 * R), 2.0));
  float ph = fract(oT * 0.35);
  float ph2 = fract(ph + 0.5);
  float l1 = texture2D(uLace, (oXZ - oDwDir * (ph * 9.0)) * 0.13).r;
  float l2 = texture2D(uLace, (oXZ - oDwDir * (ph2 * 9.0)) * 0.13 + 0.5).r;
  float laceDw = l1 * (1.0 - abs(2.0 * ph - 1.0)) + l2 * (1.0 - abs(2.0 * ph2 - 1.0));
  oDwFoam = oFoamShape(ringP * min(0.85, oDwS * 1.3), laceDw, oRag);
  // "ты низко": a fresh thin white ring, broken by the lace
  float fresh = exp(-pow((oDwR - 0.97 * R) / (0.035 * R), 2.0)) * smoothstep(0.05, 0.4, laceDw + 0.2);
  oDwFoam = max(oDwFoam, fresh * oLow * 0.95);
  oDwFoam = max(oDwFoam, oDwIn * 0.3 * smoothstep(0.55, 0.9, laceDw));
}
// residual lace: aged foam, sparse patches (after a rogue wave, in the clearing preset)
float oResid = 0.0;
if (uSeaD.z > 0.001) {
  float r1 = texture2D(uLace, oToFrame(oG - oFlow, vec2(0.8, 0.6)) * 0.07).r;
  float blot = smoothstep(0.45, 0.75, texture2D(uLace, oG * 0.006 + vec2(0.2, 0.7)).g);
  oResid = uSeaD.z * 0.4 * smoothstep(0.45, 0.9, r1) * blot;
}
float oFoam = max(max(oWc, oStreak), max(oLines, oDwFoam));
oFoam = max(oFoam, oFoamShape(max(oSplF, oFeatFoam), oLaceA, oRag));
oFoam = max(oFoam, oFoamShape(oSurf, oLaceA, oRag));
oFoam = max(oFoam, oResid);
#ifdef OCEAN_MEMORY
oFoam = max(oFoam, oFoamShape(clamp(oMem.r, 0.0, 1.0), oLaceA, oRag));
#endif
// 8. downpour: the surface "boils" with pixel-sized splash specks
if (uRain > 0.85) {
  vec2 bc = oXZ / max(0.25, oFoot * 2.0);
  float speck = step(0.992, hash12(floor(bc) + floor(oT * 18.0) * 7.31));
  oFoam = max(oFoam, speck * smoothstep(0.85, 1.0, uRain) * 0.35);
}
oFoam = clamp(oFoam, 0.0, 1.0);
// 10. oil (NICE): smooth, darker slick with a thin-film rainbow (water memory A)
float oOil = 0.0;
#ifdef OCEAN_MEMORY
oOil = smoothstep(0.05, 0.4, oMem.a) * (1.0 - oFoam);
#endif

// 3. crest SSS, look-driven: backlit crests take the palette crest colour ("bottle green")
vec2 oLh = normalize(uSunDirV.xz + vec2(1e-4, 0.0));
float oAway = clamp(0.5 - dot(oNm.xz, oLh) * 4.0, 0.0, 1.0);
float oSssM = smoothstep(0.55, 1.0, oHc) * (0.35 + 0.65 * oAway) * uSeaB.y;
oSssM = max(oSssM, oFeatSss);
oBodyC = mix(oBodyC, mix(cCrest, cCrest * 1.6, oFeatSss), clamp(oSssM, 0.0, 1.0) * 0.75 * (1.0 - 0.85 * oNight));
// aeration halo under and around foam (crest·1.15 at 0.35): turquoise bubbles in the holes of the lace
float oRaw = max(max(oWcRaw, oStreakRaw * 0.35), max(max(oSplF, oFeatFoam), oDwFoam));
float oHalo = smoothstep(0.03, 0.45, oRaw) * (1.0 - oFoam);
oBodyC = mix(oBodyC, cCrest * 1.15, 0.35 * oHalo);
oBodyC = mix(oBodyC, cDeep * 0.6, oFeatDark * 0.85);
oBodyC = mix(oBodyC, vec3(0.0003, 0.0012, 0.0018), oAbyss);   // #010406 abyss

// ---- 10. dye (fluorescein) from the water memory
float oDye = 0.0;
#ifdef OCEAN_MEMORY
if (oMem.g > 0.01) {
  float turb = (texture2D(uAtlas, oXZ * 0.11 - oFlow * 0.11).r - 0.5) * 0.5 + (texture2D(uAtlas, oXZ * 0.31 + 0.5).r - 0.5) * 0.25;
  oDye = smoothstep(0.05, 0.65, oMem.g + turb);                   // turbulent, translucent edge
}
#endif

// ---- albedo: foam is lit like a diffuse surface
vec3 oFoamC = mix(cFoam, vec3(0.888, 0.955, 1.0), clamp(oBeam * 1.3, 0.0, 1.0));   // #F2FAFF in the beam
vec3 oAlb = mix(oBodyC * (1.0 - 0.35 * oOil), oFoamC, oFoam);
oAlb = mix(oAlb, vec3(0.028, 0.807, 0.195), oDye * 0.65 * (1.0 - 0.5 * oFoam));
diffuseColor.rgb = oAlb;

// ---- roughness
float oRough = (uSeaB.x + 0.25 * oGustV + 0.08 * oDwIn) * (1.0 - 0.6 * oOil);   // uSeaB.x includes rain
oRough += 0.12 * smoothstep(0.25, 1.5, oFoot);
oRough = clamp(mix(oRough, 0.9, oFoam), 0.04, 1.0);

// ---- final normal
oSd *= (1.0 - 0.6 * oDwIn) * (1.0 - 0.5 * oFoam) * (1.0 - 0.7 * oOil);
vec2 oS = oSm + oSd;
vec3 oN = normalize(vec3(-oS.x, 1.0, -oS.y));
float oNV = clamp(dot(oN, oV), 0.0, 1.0);
float oFres = 0.02 + 0.98 * pow(1.0 - oNV, 5.0);

// ---- 6. cloud shadows (applied to the sun inside the light loop); clearing: running sun patches
float oCloud = lookCloud(oXZ);
oCloud = mix(oCloud, 1.0 - oCloud, uSeaB.z);
float oCloudMul = mix(1.0, mix(0.72, 0.55, uSeaB.z), oCloud * uSeaC.y);

// ---- emissive layers
vec3 oEmis = vec3(0.0);
// 5. analytic sky reflection (envMapIntensity = 0)
{
  vec3 R = reflect(-oV, oN);
  float ry = max(R.y, 0.0);
  vec3 sky = mix(uFogCol, uSkyCol * 0.85, smoothstep(0.0, 0.6, ry));
  if (uSeaC.x > 0.001) {
    vec2 cuv = (oXZ + R.xz / (ry + 0.15) * 350.0 - uWindOffset * 1.5) * 0.0016;
    float cl = smoothstep(0.42, 0.8, texture2D(uAtlas, cuv + vec2(0.13, 0.71)).r);
    sky = mix(sky, mix(uFogCol, vec3(1.0), 0.5) * 1.05, cl * uSeaC.x);
  }
  oEmis += sky * oFres * 2.0 * (1.0 - oFoam) * (1.0 - 0.5 * uRain);
}
// 3. crest SSS at night: the searchlight and the flash shine through the crests
oEmis += mix(cCrest, cCrest * 1.6, oFeatSss) * oSssM * (oBeam * 0.3 + uSeaE.y * 0.5) * (1.0 - oFoam);
// rogue crest edge on transmission by day (#7FE0C8)
oEmis += vec3(0.212, 0.745, 0.578) * oFeatSss * smoothstep(0.65, 1.0, oH01) * uSeaB.w * 0.035 * (1.0 - oNight);
// 11. searchlight: "the lamp opens the sea" — hot ring at 0.85 R, scattered light in the pool
if (oBeam + oRing > 0.0) {
  vec3 Ls = normalize(uSearchPos - oP);
  float sp = pow(clamp(dot(oN, normalize(Ls + oV)), 0.0, 1.0), 90.0);   // glittering hotspot on facets
  float nl = clamp(dot(oN, Ls), 0.0, 1.0);
  // the pool itself is look-driven (OCEAN_FRAGMENT_FINAL); here only the glitter on lit facets and
  // the hot ring at 0.85 R
  oEmis += vec3(1.0, 0.879, 0.701) * (oBeam * (0.9 * sp * (1.0 - oFoam) * (0.4 + 0.6 * nl)) + oRing * 0.07);
}
// 12. light glints (strobes, nav lights, raft lamps): gaussian stretched toward the screen bottom
#if OCEAN_GLINTS > 0
{
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 toCam = -normalize(fwd.xz + vec2(0.0, 1e-4));
  vec2 side = vec2(-toCam.y, toCam.x);
  for (int i = 0; i < OCEAN_GLINTS; i++) {
    if (i >= uGlintCount) break;
    vec4 g = uGlints[i];
    vec2 d = oXZ - g.xy;
    float al = dot(d, toCam);
    float la = dot(d, side);
    al /= al > 0.0 ? 1.6 : 1.0;
    float r2 = (al * al + la * la) / max(g.z * g.z, 0.01);
    if (r2 > 9.0) continue;
    vec3 L = normalize(vec3(g.x, 2.0 + g.z, g.y) - oP);
    float sp = pow(clamp(dot(oN, normalize(L + oV)), 0.0, 1.0), 48.0);
    oEmis += uGlintCol[i].rgb * (g.w * exp(-r2) * (0.3 + 1.5 * sp) * (1.0 - 0.6 * oFoam));
  }
}
#endif
// 13. sun glitter (calm / clearing): cheated light direction so it lands in a top-down frame
#if OCEAN_Q > 0
if (uSeaC.w > 0.001) {
  vec3 Lg = normalize(uSunDirV + vec3(0.0, uSeaD.y, 0.0));   // cheated: lifted toward the zenith
  float ndh = clamp(dot(oN, normalize(Lg + oV)), 0.0, 1.0);
  float csz = oFoot * 1.6;                                // ~1.5 px sparkles at any distance
  vec2 sc = floor(oG / csz);
  float tw = floor(oT * 7.0 + hash12(sc) * 7.0);
  float sp = step(mix(0.93, 0.97, oNight), hash12(sc + tw * 0.173)) * (1.0 - smoothstep(0.15, 0.5, length(fract(oG / csz) - 0.5)));
  float glit = pow(ndh, uSeaD.x) * sp;
  oEmis += uSunCol * uSpecCol * (glit * 9.0 * uSeaC.w * (1.0 - min(1.0, oCloud * uSeaC.y * 1.4)) * (1.0 - oFoam));
}
#endif
// 10. bioluminescence in any disturbed water at night; dye glows
if (uSeaD.w > 0.001) {
  float dist = clamp(max(oMem.b, max(oSplF, oDwFoam) * 0.8) + oWc * 0.3, 0.0, 1.0);
  vec2 bc = oXZ / max(0.2, oFoot * 2.0);
  float spark = smoothstep(0.955, 0.995, hash12(floor(bc) + floor(oT * 9.0))) * (1.0 - smoothstep(0.2, 0.5, length(fract(bc) - 0.5)));
  oEmis += vec3(0.0356, 0.745, 1.0) * (dist * (0.05 + 1.6 * spark) * 2.5 * 0.35 * uSeaD.w);
}
oEmis += vec3(0.028, 0.807, 0.195) * oDye * (0.08 * (1.0 - 0.9 * oNight) + 0.35 * oBeam);   // fluoresces in light
if (oOil > 0.0) {
  float hue = oMem.a * 1.2 + oNV * 1.6 + texture2D(uAtlas, oXZ * 0.08 - oFlow * 0.08).r * 2.5;
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
  oEmis += film * film * (0.15 * oOil) * (0.06 + 0.25 * uSeaB.w * (1.0 - oNight) + 0.5 * oBeam);
}
`;

export const OCEAN_FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = oRough;
`;

export const OCEAN_FRAGMENT_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(oN, 0.0)).xyz);
`;

export const OCEAN_FRAGMENT_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += oEmis;
`;

// Before opaque_fragment: the look-driven water radiance (body + foam), 14 lightning, 15 coloured
// shadows, 16 contact patch under the heli.
export const OCEAN_FRAGMENT_FINAL = /* glsl */ `
{
  // body + foam: palette look × (ambient share + sun share × shadow × cloud × relative N·L)
  float nlRel = clamp(dot(oN, uSunDirS), 0.0, 1.0) / max(uSunDirS.y, 0.25);
  float sunK = oShadow * oCloudMul * mix(1.0, nlRel, 0.8);
  // foam targets the low end of the law (≈0.82 on screen) so it never clips and stays under bloom
  vec3 look = oInvACES(min(oAlb, vec3(0.64))) * uLookK.y;
  outgoingLight += look * ((1.0 - uLookK.x) + uLookK.x * sunK);
  // 14. lightning: the sea turns silver-blue; the heli's shadow swings toward the strike
  outgoingLight += uFlashCol * (uSeaE.y * (0.06 + 0.5 * oFres + 0.35 * oFoam + 0.25 * oSssM)) * mix(1.0, oShadow, uLookK.z);
  float sh = 1.0 - oShadow;
  // hue of the preset's shadow colour (normalised to its brightest channel, so it only darkens)
  vec3 tl = uShadowTint / max(max(uShadowTint.r, max(uShadowTint.g, uShadowTint.b)), 1e-4);
  vec3 tint = mix(vec3(1.0), tl, 0.5);
  outgoingLight *= mix(vec3(1.0), tint, clamp(sh * 1.3, 0.0, 1.0));
  // lightning: the flash exposure boost (post: ×(1+2.4f)) also lifts the shadowed sea; cancel most
  // of it inside the swung strike shadow so the heli's shadow visibly snaps (DESIGN §2.7.2)
  float flashSh = sh * smoothstep(0.05, 0.35, uSeaE.y) * uLookK.z;
  outgoingLight *= mix(1.0, 1.0 / (1.0 + 2.4 * uSeaE.y), flashSh);
  // 11. searchlight pool, look-driven: "the lamp opens the sea" — inside the beam the water is shown
  // at the DESIGN §2.1 pool luminance (≈0.75–0.85 on screen, foam a touch brighter, never clipping),
  // the warm lamp tint over the lit body colour, shaded by the facets facing the lamp.
  if (oBeam > 0.001) {
    vec3 Lp = normalize(uSearchPos - oP);
    float nlp = clamp(dot(oN, Lp), 0.0, 1.0);
    float nhp = clamp(dot(oN, normalize(Lp + oV)), 0.0, 1.0);
    float facet = 0.72 + 0.55 * pow(nhp, 14.0);                     // wave facets catch the lamp
    vec3 litWater = vec3(0.56, 0.68, 0.62) * (0.8 + 0.25 * nlp) * (0.88 + 0.24 * oH01) * facet;
    vec3 poolDisp = mix(min(litWater, vec3(0.78)), min(oFoamC * 0.9, vec3(0.8)), oFoam) * vec3(1.0, 0.97, 0.9);
    vec3 poolLook = oInvACES(poolDisp) * uLookK.y;
    // by day the pool only lifts the water a little (it never fights the sun)
    outgoingLight = mix(outgoingLight, max(outgoingLight, poolLook), clamp(oBeam, 0.0, 1.0) * mix(0.3, 1.0, uSeaE.z));
  }
  float hr = length(oXZ - uHeliP.xy);
  float alt = max(uHeliP.z, 0.0);
  float patchK = exp(-pow(hr / (3.5 + 0.25 * alt), 2.0)) * mix(0.55, 0.15, clamp(alt / 60.0, 0.0, 1.0))
               * (1.0 - 0.6 * uSeaC.z) * uHeliP.w;
  outgoingLight *= 1.0 - patchK;
}
`;

// ---- self-test: render displaced world positions into a float target --------------------------
export const SELFTEST_VERTEX = /* glsl */ `
${OCEAN_VERTEX_PARS}
void main() {
  vec3 p;
  vec3 n;
  oceanVertex(position.xz, p, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const SELFTEST_FRAGMENT = /* glsl */ `
varying vec3 vOWorld;
void main() {
  gl_FragColor = vec4(vOWorld, 1.0);
}
`;
