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
uniform vec4 uShoals[8];     // x, z, radius, on (0 = a terrain coast: the coast map handles it)
uniform sampler2D uCoast;    // coastline distance map (coast.js): R = distance to the waterline / 48 m
uniform vec4 uCoastWin;      // x0, z0, 1 / width m, 1 / height m
uniform float uCoastOn;
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
    if (s.w < 0.5) continue;
    d *= 0.15 + 0.85 * smoothstep(s.z * 0.9, s.z * 2.6, length(p - s.xy));
  }
  return d;
}
// Distance (m) from p to the nearest terrain waterline; 48 = far / no map (coast.js coastDistance).
float oceanCoastD(vec2 p) {
  if (uCoastOn < 0.5) return 48.0;
  return textureLod(uCoast, clamp((p - uCoastWin.xy) * uCoastWin.zw, 0.0, 1.0), 0.0).r * 48.0;
}
// Waves die down to ≈ 20 % at the waterline, full beyond ≈ 16 m (coast.js coastDamp).
float oceanCoastDamp(vec2 p) {
  return 0.2 + 0.8 * smoothstep(1.0, 16.0, oceanCoastD(p));
}
`;

// ---- vertex ------------------------------------------------------------------------------------
export const OCEAN_VERTEX_PARS = /* glsl */ `
${OCEAN_COMMON}
// Gerstner bank + features at grid vertex gl (local coordinates). Mirrors WaveBank._eval().
void oceanVertex(vec2 gl, out vec3 pos, out vec3 nrm) {
  vec2 p0 = gl + uOffset;
  float cell = oceanCell(gl);
  float damp = oceanEdge(gl) * oceanShoalDamp(p0) * oceanCoastDamp(p0);
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
// Foam density f → appearance. tex = the multi-scale foam texture (0..1, mean ≈ .5: wind-streaky
// fbm at three scales + bubble speckle + ≤ 15 % cellular lace, see layer 7). A ragged dense core
// that tops out near .85 and is never a flat fill, fading through a translucent, texture-broken
// fringe — no single cell size, no bright net lines.
float oFoamShape(float f, float tex, float rag) {
  float e = f + 0.3 * (rag - 0.5);
  // the dense core breaks up isotropically (turbulent boils); the wind-streaky texture shapes only the
  // translucent fringe and the tails, so whitecaps never read as combed paint smears
  float core = smoothstep(0.6, 1.0, e) * (0.5 + 0.36 * mix(tex, rag, 0.55));
  float body = smoothstep(0.06, 0.75, e);
  float fringe = body * smoothstep(1.0 - body, 1.35 - 0.6 * body, tex + 0.25) * (0.22 + 0.4 * body);
  return max(core, fringe);
}
// Aged foam (rogue carpet, residual scar): marbling from the 3-octave warped lace (laceN, mean .5),
// thinned by the streaky texture — sparse, irregular, decaying; never a regular net.
float oFoamAged(float f, float laceN, float tex) {
  float m = smoothstep(0.62, 1.0, laceN * (0.7 + 0.6 * tex));
  float veil = smoothstep(0.4, 0.85, tex) * 0.14;
  return f * (veil + 0.38 * m);
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
// no clean outer edge: the roughened disc frays out over the outer half, its radius wandering ±15 %
float oDwRn = texture2D(uAtlas, oDwDir * 0.33 + vec2(oT * 0.03, 0.31)).r;
float oDwIn = oDwS * (1.0 - smoothstep(0.5 * uDownwash.z, (1.1 + 0.3 * (oDwRn - 0.5)) * uDownwash.z, oDwR));
float oLow = (1.0 - smoothstep(8.0, 12.0, uHeliP.z)) * step(0.001, oDwS);

// ---- 11. searchlight pool (CPU mirror: Ocean.searchlightAt)
// The pool has a soft penumbra over the outer ~40 % of the cone (profile shaped in display space in
// OCEAN_FRAGMENT_FINAL); oBeam is the soft weight for the beam-driven tints (detail, foam, SSS).
float oBeam = 0.0;
float oRing = 0.0;
float oRho = 2.0;
float oPoolK = 0.0;
vec2 oPoolDir = vec2(0.0);
if (uSearchI > 0.0) {
  vec3 sl = oP - uSearchPos;
  float sd = length(sl);
  float cs = dot(sl / max(sd, 1e-3), uSearchDir.xyz);
  oRho = acos(clamp(cs, -1.0, 1.0)) / max(acos(uSearchDir.w), 1e-3);
  float range = 1.0 - smoothstep(220.0, 320.0, sd);
  oPoolK = uSearchI * range;
  oBeam = oPoolK * (1.0 - smoothstep(0.45, 1.0, oRho));
  vec2 ctr = uSearchPos.xz + uSearchDir.xz * (uSearchPos.y / max(-uSearchDir.y, 0.05));
  vec2 rc = oXZ - ctr;
  oPoolDir = rc / max(length(rc), 1e-3);
  // the reflector's faint broad ring (no crisp circle), shimmering with the lamp
  oRing = oPoolK * exp(-pow((oRho - 0.78) / 0.16, 2.0)) * (1.0 + 0.02 * sin(oT * 61.0));
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
// downwash: wind-flattened, gust-driven cat's-paw ripples racing outward (no concentric rings)
float oCatPaw = 0.0;
if (oDwIn > 0.0) {
  vec2 dq = oToFrame(oDwD, oWd);
  vec2 rip = texture2D(uDetail, oXZ * 0.33 - oDwDir * (oT * 2.4)).rg * 2.0 - 1.0;
  oCatPaw = smoothstep(0.4, 0.7, texture2D(uAtlas, dq * vec2(0.035, 0.11) - vec2(oT * 0.21, 0.0) + vec2(0.31, 0.77)).r
                                + 0.35 * (texture2D(uAtlas, oXZ * 0.21 - oDwDir * oT * 0.6).r - 0.5)
                                + 0.3 * (texture2D(uAtlas, oDwDir * 1.7 + vec2(0.13, oDwR * 0.05 - oT * 0.35)).r - 0.5));
  oSd += (rip * 0.16 + oDwDir * 0.05 * sin(oDwR * 3.1 - oT * 13.0 + rip.x * 3.0)) * oDwIn * (0.5 + 0.8 * oCatPaw);
}

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
oBodyC *= 1.0 - (0.02 + 0.22 * oCatPaw) * oDwIn;          // roughened, darker cat's paws under the rotor

// ---- 4. shallows & surf around rocks
// Surf is broken, pulses with the sets, is wide on exposed (windward) headlands and missing in
// sheltered coves; the break zone widens with the sea state and leaves a fading backwash seaward.
// Terrain coasts read the baked coastline distance map (it follows the real granite waterline);
// the analytic circles remain for other shoals (rig legs, wrecks).
float oShallow = 0.0;
float oSurf = 0.0;
float oSurfOld = 0.0;
float oCoastD = oceanCoastD(oXZ);
if (oCoastD < 40.0) {
  float sn = texture2D(uAtlas, oXZ * 0.035 + vec2(0.29, 0.61)).r;
  float sn2 = texture2D(uAtlas, oXZ * 0.11 + vec2(0.83, 0.17)).r;
  vec2 gd = vec2(oceanCoastD(oXZ + vec2(2.0, 0.0)) - oceanCoastD(oXZ - vec2(2.0, 0.0)),
                 oceanCoastD(oXZ + vec2(0.0, 2.0)) - oceanCoastD(oXZ - vec2(0.0, 2.0)));
  vec2 cn = gd / max(length(gd), 1e-3);                                                      // seaward
  float d = oCoastD + (sn - 0.5) * 2.4 + (sn2 - 0.5) * 1.2;                                  // ragged
  oShallow = 1.0 - smoothstep(0.0, 9.0 + 1.5 * uHsEff, d + (sn - 0.5) * 6.0);
  float expo = clamp(0.5 - 0.6 * dot(cn, oWd), 0.0, 1.0);                                    // 1 = windward
  // sets every 6 s arrive with the swell (phase runs along the wind) and break unevenly along the shore
  float setT = fract(oT / 6.0 - dot(oXZ, oWd) / 72.0 + 0.4 * sn);
  float pulse = 1.0 - setT;
  float cover = smoothstep(0.42, 0.68, sn * 0.5 + sn2 * 0.25 + expo * 0.45 + 0.12 * pulse - 0.06);   // 30–60 % gaps
  // steep granite has no beach to shoal on: each set bursts white against the rock face, and the white
  // water spreads seaward a few metres, widening, breaking up and fading as it drains back (no
  // breaker line standing off the shore); a calm sea only laps the rocks
  float zone = 1.5 + 1.0 * uHsEff * (0.4 + 0.8 * expo);                                      // spread
  float bandPos = mix(0.3, zone, setT);
  float sea = smoothstep(0.25, 2.5, uHsEff);
  float brkL = smoothstep(0.35, 0.65, sn2 + 0.4 * pulse - 0.15);
  float band = exp(-pow((d - bandPos) / (0.6 + (0.15 + 0.3 * setT) * uHsEff), 2.0)) * (0.12 + 0.8 * pulse * pulse) * mix(1.0, brkL, setT);
  float wash = (1.0 - smoothstep(0.0, 1.2 + 0.5 * uHsEff, d)) * (0.3 + 0.45 * pulse) * (0.3 + 0.7 * sea);
  oSurf = max(band * (0.35 + 0.65 * sea), wash) * cover;
  // backwash fringe: aged lace seaward of the break, fading over a few metres
  oSurfOld = exp(-max(d - 0.5, 0.0) / (2.0 + 1.2 * uHsEff)) * smoothstep(0.3, 0.6, sn + 0.3 * expo) * 0.75;
}
for (int i = 0; i < 8; i++) {
  if (i >= uShoalCount) break;
  vec4 s = uShoals[i];
  if (s.w < 0.5) continue;
  vec2 rel = oXZ - s.xy;
  float d = length(rel) - s.z;
  d += (texture2D(uAtlas, oXZ * 0.045 + s.xy * 0.013).r - 0.5) * (0.6 * s.z + 2.0);   // rocks aren't circles
  oShallow = max(oShallow, 1.0 - smoothstep(0.0, 1.8 * s.z + 6.0, d));
  if (d > 30.0) continue;
  float expo = clamp(0.5 - 0.6 * dot(rel / max(length(rel), 1e-3), oWd), 0.0, 1.0);        // 1 = windward
  float setT = fract(oT / 6.0 + s.x * 0.013 + s.y * 0.007);    // sets every 6 s
  float pulse = 1.0 - setT;
  float shore = texture2D(uAtlas, oXZ * 0.035 + vec2(0.29, 0.61)).r * 0.65 + texture2D(uAtlas, oXZ * 0.11 + vec2(0.83, 0.17)).r * 0.35;
  float cover = smoothstep(0.42, 0.68, shore * 0.75 + expo * 0.45 + 0.12 * pulse - 0.08);   // 30–60 % gaps
  float zone = 3.0 + 2.2 * uHsEff * (0.5 + 0.7 * expo);                                    // break zone width
  float bandPos = mix(zone, 0.5, setT);
  float band = exp(-pow((d - bandPos) / (0.8 + 0.35 * uHsEff), 2.0)) * (0.25 + 0.75 * pulse);
  float wash = (1.0 - smoothstep(0.0, 1.5 + 0.5 * uHsEff, d)) * (0.35 + 0.45 * pulse);
  oSurf = max(oSurf, max(band, wash) * cover * step(-1.0, d));
  oSurfOld = max(oSurfOld, exp(-max(d - 0.5, 0.0) / (2.5 + 1.2 * uHsEff)) * smoothstep(-1.0, 1.0, d) * smoothstep(0.3, 0.6, shore + 0.3 * expo) * 0.8);
}
// cold granite seabed: the shallow halo stays close to the body colour (≤ ~25 % lighter)
oBodyC = mix(oBodyC, uShallow, oShallow * 0.5);

// ---- big features: rogue wave, spout base, whirlpool (shading; heights come from the vertex)
float oFeatFoam = 0.0;
float oFeatAged = 0.0;
float oFeatLine = 0.0;
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
    float xm = f.x;                                       // metres, > 0 ahead of the crest
    float xf = xm / W;
    float hk = clamp(A.w / 8.0, 0.0, 1.0);
    float age = C.y;
    // crest edge: three noise octaves along the crest (no periodic lobes); fingers 2–12 m long
    // at random places, leaning with the wind
    float fy = f.y - dot(oWd, vec2(-B.y, B.x)) * 0.5 * max(xm, 0.0);
    float e1 = texture2D(uAtlas, vec2(fy * 0.004 + 0.13, 0.37 + age * 0.002)).r;
    float e2 = texture2D(uAtlas, vec2(fy * 0.017 + 0.61, 0.71 + age * 0.006)).r;
    float e3 = texture2D(uAtlas, vec2(fy * 0.06 + 0.29, 0.19 + age * 0.015)).r;
    // finger mask: two fbm octaves at incommensurate scales (≈ 14 m and 5 m) → irregular spacing
    float fn = texture2D(uAtlas, vec2(fy * 0.019 + 0.47, 0.83 + age * 0.004)).r * 0.65
             + texture2D(uAtlas, vec2(fy * 0.053 + 0.11, 0.29 + age * 0.009)).r * 0.35;
    float fsel = smoothstep(0.55, 0.72, fn) * smoothstep(0.3, 0.6, e2);
    float flen = 2.0 + 10.0 * texture2D(uAtlas, vec2(fy * 0.013 + 0.77, 0.05)).r;
    float edgeM = W * 0.06 + (e1 - 0.5) * 0.3 * W + (e2 - 0.5) * 3.0 + (e3 - 0.5) * 1.4 + fsel * flen;
    float lip = (1.0 - smoothstep(edgeM - 1.0 - 0.7 * fsel * flen, edgeM + 0.8 + 0.4 * fsel * flen, xm)) * smoothstep(-1.3 * W, -0.25 * W, xm);
    lip *= 1.0 - 0.45 * fsel * smoothstep(edgeM - fsel * flen, edgeM, xm);     // fingers thin out toward the tips
    // only the breaking front is solid white; the white water on the back of the crest is already
    // marbled with darker, thinner foam (turbulent boils ≈ 9 m and 30 m), never a flat painted band
    float mbL = texture2D(uAtlas, oG * 0.11 + vec2(0.71, 0.33) - age * 0.004).r * 0.3 + texture2D(uAtlas, oG * 0.033 + vec2(0.07, 0.58)).r * 0.45
              + texture2D(uAtlas, oG * 0.013 + vec2(0.41, 0.19)).r * 0.25;
    lip *= mix(mix(0.5, 1.06, smoothstep(0.22, 0.78, mbL)), 1.0, smoothstep(edgeM - 0.5 * W, edgeM - 0.1 * W, xm));
    // a thin bright broken line where the lip plunges
    float brk = smoothstep(0.42, 0.62, e3 * 0.4 + texture2D(uAtlas, vec2(fy * 0.14 + 0.21, 0.6 + age * 0.03)).r * 0.6);
    oFeatLine = max(oFeatLine, exp(-pow((xm - (edgeM - fsel * flen) + 1.2) / 0.9, 2.0)) * brk * f.z * hk);
    // white-water carpet behind the crest: dense when fresh, then marbled, breaking into irregular
    // patches within ~10 s (large-scale noise with an age-driven threshold), a scar for 30–40 s
    float behind = max(-xm, 0.0);
    float travelled = C.y * C.z;
    float ageB = behind / max(C.z, 1.0);
    float pn = texture2D(uAtlas, oG * 0.011 + vec2(0.53, 0.07)).r * 0.6 + texture2D(uAtlas, oG * 0.037 + vec2(0.19, 0.91)).r * 0.4;
    // where the wave began to break is a ragged, soft line (never a straight spawn edge)
    float began = travelled * (0.62 + 0.38 * pn);
    float carpet = (0.3 + 0.7 * exp(-behind / 45.0)) * exp(-behind / max(C.z * 30.0, 60.0))
                 * (1.0 - smoothstep(began - 14.0, began + 2.0, behind)) * smoothstep(-0.15 * W, -0.9 * W, xm);
    float thr = 0.3 + 0.2 * smoothstep(1.0, 10.0, ageB) + 0.1 * (1.0 - C.x);
    carpet *= smoothstep(thr - 0.05, thr + 0.12, pn);
    // fresh white water is marbled, not a flat fill: turbulent boils (≈ 9 m and 30 m) with thinner,
    // greyer foam between them, readable from 280 m
    float mb = texture2D(uAtlas, oG * 0.11 + vec2(0.71, 0.33) - C.y * 0.004).r * 0.3 + texture2D(uAtlas, oG * 0.033 + vec2(0.07, 0.58)).r * 0.45
             + texture2D(uAtlas, oG * 0.013 + vec2(0.41, 0.19)).r * 0.25;
    carpet *= mix(0.45, 1.08, smoothstep(0.22, 0.78, mb));
    oFeatFoam = max(oFeatFoam, max(lip * hk, carpet * C.x * (1.0 - smoothstep(2.0, 7.0, ageB))) * f.z);
    oFeatAged = max(oFeatAged, carpet * C.x * smoothstep(1.0, 5.0, ageB) * f.z);
    // the forward face reads as a slope: bottle-green glass only in the top ~20 % where the lip
    // thins, then a gradient down to deep·0.6 in the face and the trough ahead
    float ef = (edgeM - fsel * flen) / W;
    oFeatSss = max(oFeatSss, smoothstep(ef - 0.03, ef + 0.05, xf) * (1.0 - smoothstep(ef + 0.1, ef + 0.26, xf)) * f.z * hk);
    oFeatDark = max(oFeatDark, smoothstep(ef + 0.06, ef + 0.8, xf) * (1.0 - smoothstep(1.5, 2.6, xf)) * f.z * hk);
    // suction ahead of the wall: broken foam streaks pulled toward it
    float ahead = smoothstep(1.0, 1.8, xf) * (1.0 - smoothstep(2.8, 7.0, xf));
    float strk = smoothstep(0.6, 0.85, texture2D(uAtlas, vec2(f.x * 0.004, fy * 0.05)).r * 0.6 + texture2D(uAtlas, vec2(f.x * 0.013 + 0.4, fy * 0.13)).r * 0.4);
    oFeatAged = max(oFeatAged, ahead * strk * f.z * hk * 0.7);
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

// ---- 7. foam layers (combined with max)
// Shared multi-scale foam texture: wind-streaky fbm stretched 1:5 along the wind at three scales,
// bubble speckle (resolves only up close; mips average it away) and the cellular lace as a faint
// ≤ 15 % breakup. The lace itself is three warped, rotated octaves (1×, 2.7×, 7.3×) so no single
// cell size dominates, blended to its mean from altitude (no moiré).
vec2 oQw = oToFrame(oG - oFlow, oWd);                                        // x along the wind
float oFb1 = texture2D(uAtlas, oQw * vec2(0.010, 0.05) + vec2(0.11, 0.83)).r;   // ≈100 × 20 m
float oFb2 = texture2D(uAtlas, oQw * vec2(0.040, 0.20) + vec2(0.57, 0.21)).r;   // ≈25 × 5 m
vec2 oWp = oG - oFlow + (texture2D(uAtlas, oG * 0.017 + vec2(0.71, 0.29)).rg - 0.5) * 9.0;
vec4 oLaceAvg = textureLod(uLace, vec2(0.5), 10.0);
float oL1 = texture2D(uLace, oToFrame(oWp, vec2(0.8, 0.6)) * 0.045).r;
float oL2 = texture2D(uLace, oToFrame(oWp, vec2(0.28, 0.96)) * 0.1215 + vec2(0.37, 0.11)).r;
#if OCEAN_Q > 0
float oFb3 = texture2D(uAtlas, oQw * vec2(0.15, 0.75) + vec2(0.33, 0.66)).r;    // ≈7 × 1.3 m
float oL3 = texture2D(uLace, oToFrame(oWp, vec2(-0.6, 0.8)) * 0.3285 + vec2(0.71, 0.53)).r;
float oBub = texture2D(uLace, oWp * 0.9 + vec2(0.13, 0.41)).b - oLaceAvg.b;
#else
float oFb3 = 0.5;
float oL3 = oLaceAvg.r;
float oBub = 0.0;
#endif
float oLaceN = (oL1 * 0.45 + oL2 * 0.33 + oL3 * 0.22) / max(2.0 * oLaceAvg.r, 0.05);
oLaceN = clamp(mix(oLaceN, 0.5, smoothstep(0.35, 0.9, oFoot)), 0.0, 1.0);
float oFTex = clamp(0.5 + 1.25 * (0.3 * (oFb2 - 0.5) + 0.27 * (oFb3 - 0.5) + 0.18 * (oFb1 - 0.5)) + 0.3 * oBub + 0.15 * (oLaceN - 0.5), 0.0, 1.0);
float oRag = texture2D(uAtlas, oWp * 0.06 + vec2(0.17, 0.53)).r;
// 7a whitecaps — Monahan coverage ∝ U^3.41; preset value = mean, local gusts modulate (softened)
float oCov = clamp(cSea.y * 0.45 * pow(max(oULoc, 0.0) / max(uSeaE.x, 1.0), 2.5), 0.0, 0.6);
oCov *= 1.0 - oLow * (1.0 - smoothstep(0.7, 1.0, oDwR / max(uDownwash.z, 1.0)));             // "ты низко"
oCov = min(oCov * (0.45 + 1.1 * oGroup), 0.6);       // breaking comes in wave groups, not an even lattice
float oWc = 0.0;
float oWcRaw = 0.0;
if (oCov > 0.002) {
  // breaking happens on the crests of the shorter wind waves (bank waves 3–6, unit amplitude, so
  // the pattern is quality-independent), grouped on the long-wave crests (Jacobian), broken up by
  // two octaves of fbm so every breaking event has its own size and shape
  float c = (1.0 - vOAux.y) / max(uJStats.x, 0.02) / max(uJStats.y, 0.05);
  float cs = 0.0;
  for (int i = 3; i < 7; i++) cs += uWaveB[i].w * sin(uWaveA[i].z * dot(uWaveA[i].xy, oG - uOffset) + uWaveB[i].y);
  cs *= uJStats.z;                                                                           // → unit variance
  float nz = (texture2D(uAtlas, oQw * vec2(0.024, 0.014) + vec2(0.63, 0.29)).r - 0.5) * 5.0
           + (texture2D(uAtlas, oQw * vec2(0.07, 0.045) + vec2(0.27, 0.81)).r - 0.5) * 2.4;
  float z = 0.588 * log((1.0 - oCov) / oCov);                                                // ≈ Φ⁻¹(1 − coverage)
  oWcRaw = smoothstep(z - 0.3, z + 1.9, 0.65 * c + 0.5 * cs + 0.4 * nz);
  oWc = oFoamShape(oWcRaw, oFTex, oRag);
#if OCEAN_Q > 0
  // decaying trails: where the crests broke 1.6 s and 3.2 s ago (the waves moved on, the foam stayed)
  // — ragged, streaky tails 5–25 m long behind each whitecap
  float tr = 0.0;
  for (int k = 1; k <= 2; k++) {
    float dt = 1.6 * float(k);
    float csp = 0.0;
    for (int i = 3; i < 7; i++) csp += uWaveB[i].w * sin(uWaveA[i].z * dot(uWaveA[i].xy, oG - uOffset) + uWaveB[i].y + 0.9 * sqrt(9.81 * uWaveA[i].z) * dt);
    tr = max(tr, smoothstep(z - 0.1, z + 2.2, 0.65 * c + 0.5 * csp * uJStats.z + 0.4 * nz) * (1.0 - 0.36 * float(k)));
  }
  float trail = tr * smoothstep(0.42, 0.78, oFTex + 0.25 * tr) * 0.6;
  oWc = max(oWc, trail);
  oWcRaw = max(oWcRaw, tr * 0.5);
#endif
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
  // streaks are soft wind-combed fbm, not a stretched cell net
  float tS = texture2D(uAtlas, vec2(qa.x * 0.02, qa.y * 0.16) + vec2(0.71, 0.37)).r;
  oStreakRaw = sa * clamp(cSea.z * (0.45 + 0.75 * oGustV), 0.0, 1.0);
  oStreak = oStreakRaw * smoothstep(0.3, 0.75, 0.55 * tS + 0.45 * oFTex) * 0.6;
  float lv = qa.y / 30.0 + la * 1.4;
  float line = 1.0 - smoothstep(0.01, 0.06, abs(fract(lv) - 0.5));
  float brk = smoothstep(0.35, 0.65, texture2D(uAtlas, qa * vec2(0.011, 0.03) + 0.5).r);
  float lf = line * brk * cSea.w;
  oLines = lf * smoothstep(0.25, 0.7, 0.5 * tS + 0.5 * oFTex) * 0.55;
}
// 9 downwash: a roughened disc with a broken, irregular foam edge (radius ±15 %, width 0.5–2.5 m)
// that sheds streaks downwind; the fresh ring when low is broken too
float oDwFoam = 0.0;
if (oDwS > 0.001) {
  float n1 = texture2D(uAtlas, oDwDir * 0.33 + vec2(oT * 0.03, 0.31)).r;
  float n2 = texture2D(uAtlas, oDwDir * 1.3 + vec2(0.57, oT * 0.11)).r;
  float dwW = dot(oDwDir, oWd) * clamp(uSeaE.x / 8.0, 0.0, 1.0);                           // downwind side
  float R = uDownwash.z * (1.0 + 0.3 * (n1 - 0.5) + 0.14 * (n2 - 0.5) + 0.1 * dwW);
  float wid = mix(0.5, 2.5, texture2D(uAtlas, oDwDir * 0.8 + vec2(0.23, 0.61 + oT * 0.05)).r) + 0.06 * R;
  float ringP = exp(-pow((oDwR - R) / wid, 2.0));
  // radial streaks racing outward break the ring into tufts (seamless: sampled by the unit vector)
  // gusts and blade passes: big gaps at low angular frequency, finer tufts inside, all drifting
  float rs = texture2D(uAtlas, oDwDir * 0.8 + vec2(0.0, oDwR * 0.03 - oT * 0.18)).r * 0.55
           + texture2D(uAtlas, oDwDir * 2.6 + vec2(0.41, oDwR * 0.09 - oT * 0.5)).r * 0.3
           + texture2D(uAtlas, oDwD * 0.35 + vec2(0.77, -oT * 0.4)).r * 0.15;
  float tuft = smoothstep(0.36, 0.64, rs + 0.25 * (oFTex - 0.5));
  // streaks shed downwind past the ring
  float shed = smoothstep(0.1, 0.8, dwW) * smoothstep(R * 0.95, R * 1.15, oDwR) * exp(-max(oDwR - R, 0.0) / (0.7 * R + 4.0));
  oDwFoam = oFoamShape(ringP * (0.35 + 0.65 * tuft) * min(0.85, oDwS * 1.3), oFTex, oRag) * 0.75;
  oDwFoam = max(oDwFoam, shed * smoothstep(0.55, 0.85, rs) * min(1.0, oDwS * 1.5) * 0.45);
  // "ты низко": a fresh thin white rim, broken into tufts
  float fresh = exp(-pow((oDwR - 0.97 * R) / (0.25 + 0.03 * R), 2.0)) * smoothstep(0.45, 0.7, rs);
  oDwFoam = max(oDwFoam, fresh * oLow * 0.85);
  oDwFoam = max(oDwFoam, oDwIn * 0.22 * smoothstep(0.6, 0.9, rs) * oCatPaw);
}
// residual lace: aged foam, decaying in large irregular patches (after a rogue wave, clearing)
float oResid = 0.0;
if (uSeaD.z > 0.001) {
  float pn = texture2D(uAtlas, oWp * 0.006 + vec2(0.2, 0.7)).r * 0.6 + oFb1 * 0.4;
  oResid = oFoamAged(uSeaD.z * smoothstep(0.52, 0.7, pn), oLaceN, oFTex) * 0.6;
}
float oFoam = max(max(oWc, oStreak), max(oLines, oDwFoam));
oFoam = max(oFoam, oFoamShape(max(oSplF, oFeatFoam), oFTex, oRag));
oFoam = max(oFoam, oFoamAged(oFeatAged, oLaceN, oFTex));
oFoam = max(oFoam, oFeatLine * 0.95);
oFoam = max(oFoam, oFoamShape(oSurf, oFTex, oRag));
oFoam = max(oFoam, oFoamAged(oSurfOld, oLaceN, oFTex));
oFoam = max(oFoam, oResid);
#ifdef OCEAN_MEMORY
oFoam = max(oFoam, oFoamShape(clamp(oMem.r, 0.0, 1.0), oFTex, oRag));
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
float oSssM = smoothstep(0.55, 1.0, oHc) * (0.08 + 0.92 * oAway * oAway) * uSeaB.y;   // back-lit crests only
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
float oRough = (uSeaB.x + 0.25 * oGustV + (0.02 + 0.12 * oCatPaw) * oDwIn) * (1.0 - 0.6 * oOil);   // uSeaB.x includes rain
oRough += 0.12 * smoothstep(0.25, 1.5, oFoot);
oRough = clamp(mix(oRough, 0.9, oFoam), 0.04, 1.0);

// ---- final normal
oSd *= (1.0 - 0.3 * oDwIn * (1.0 - oCatPaw)) * (1.0 - 0.5 * oFoam) * (1.0 - 0.7 * oOil);
vec2 oS = oSm + oSd;
vec3 oN = normalize(vec3(-oS.x, 1.0, -oS.y));
float oNV = clamp(dot(oN, oV), 0.0, 1.0);
float oFres = 0.02 + 0.98 * pow(1.0 - oNV, 5.0);
// searchlight pool edge ripples with the waves: facets rising outward face the lamp and catch it
float oRhoE = max(oRho * (1.0 - 0.22 * clamp(dot(oS, oPoolDir), -0.7, 0.7)) - 0.05 * oFoam, 0.0);

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
    vec2 cuv = (oXZ + R.xz / (ry + 0.15) * 220.0 - uWindOffset * 1.5) * 0.0016;
    // broken cloud reflections: soft grey-white patches, not a crisp white crackle net
    float cl = smoothstep(0.35, 0.95, texture2D(uAtlas, cuv + vec2(0.13, 0.71)).r);
    sky = mix(sky, mix(uFogCol, vec3(1.0), 0.3), cl * uSeaC.x * 0.8);
  }
  // swell relief: faces tilted away from the camera see more of the bright sky (grazing), faces
  // turned toward it look into the dark water (strongest in a heavy sea, where the veil used to help)
  vec2 vxz = oV.xz / max(length(oV.xz), 1e-3);
  float awayV = clamp(-dot(oNm.xz, vxz) * 3.0 + 0.5 * (1.0 - oNV), -1.0, 1.0);
  float relief = smoothstep(1.5, 5.0, uHsEff) * (1.0 - 0.7 * oNight);
  oEmis += sky * (oFres * 2.0 + relief * 0.1 * max(awayV, 0.0)) * (1.0 - oFoam) * (1.0 - 0.5 * uRain);
  // swell mass from above: the long faces tilted toward the brighter (sun-side) sky lift, the lee faces
  // and troughs sink — readable crest lines across the wind from 150–230 m, even under overcast
  vec2 skyL = normalize(uSunDirS.xz + vec2(1e-4, 0.0));
  float hill = clamp(dot(oNm.xz, skyL) * 4.0, -1.0, 1.0);
  oAlb *= (1.0 + relief * (0.3 * hill - 0.12 * max(-awayV, 0.0))) * (1.0 - oFoam) + oFoam;
  diffuseColor.rgb = oAlb;
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
  oEmis += vec3(1.0, 0.879, 0.701) * (oBeam * (0.9 * sp * (1.0 - oFoam) * (0.4 + 0.6 * nl)) + oRing * 0.025);
}
// 12. light glints (strobes, nav lights, raft lamps): gaussian stretched toward the screen bottom
#if OCEAN_GLINTS > 0
{
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 toCam = -normalize(fwd.xz + vec2(0.0, 1e-4));
  vec2 side = vec2(-toCam.y, toCam.x);
  // a reflection, not a lamp: smaller and dimmer as the camera climbs, a thin streak toward the
  // viewer broken by the wave facets (no round diffuse disc)
  float gH = clamp(70.0 / max(cameraPosition.y, 1.0), 0.3, 1.0);
  float gBrk = 0.2 + 0.8 * smoothstep(0.35, 0.75, texture2D(uAtlas, oXZ * 0.37 + vec2(oT * 0.05, 0.13)).r);
  for (int i = 0; i < OCEAN_GLINTS; i++) {
    if (i >= uGlintCount) break;
    vec4 g = uGlints[i];
    vec2 d = oXZ - g.xy;
    float rad = g.z * gH;
    float al = dot(d, toCam);
    float la = dot(d, side);
    al /= al > 0.0 ? 3.0 : 1.2;
    la /= 0.5;
    float r2 = (al * al + la * la) / max(rad * rad, 0.01);
    if (r2 > 9.0) continue;
    vec3 L = normalize(vec3(g.x, 2.0 + g.z, g.y) - oP);
    float sp = pow(clamp(dot(oN, normalize(L + oV)), 0.0, 1.0), 48.0);
    oEmis += uGlintCol[i].rgb * (g.w * gH * exp(-r2) * (0.06 + 1.3 * sp) * gBrk * (1.0 - 0.6 * oFoam));
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
  // at night the sparkles crowd into the core of the moon path instead of a sparse starfield
  float spT = mix(0.93, mix(0.975, 0.9, pow(ndh, uSeaD.x * 0.08)), oNight);
  float sp = step(spT, hash12(sc + tw * 0.173)) * (1.0 - smoothstep(0.15, 0.5, length(fract(oG / csz) - 0.5)));
  float glit = pow(ndh, uSeaD.x) * sp;
  // at night a broad soft sheen carries the moon path between the sparkles («Лунная дорожка»)
  // (the broad sheen follows the swell, not the short regular wavelets: no corduroy from 400 m)
  float ndhM = clamp(dot(normalize(mix(oNm, oN, 0.3)), normalize(Lg + oV)), 0.0, 1.0);
  glit += oNight * (0.012 * pow(ndh, uSeaD.x * 0.3) + 0.03 * pow(ndhM, uSeaD.x * 0.12) * mix(0.4, 1.0, oGroup));
  oEmis += uSunCol * uSpecCol * (glit * 9.0 * uSeaC.w * (1.0 - min(1.0, oCloud * uSeaC.y * 1.4)) * (1.0 - oFoam));
}
// moonlit night: the swell faces toward the moon catch a little more of the bright sky
if (oNight > 0.5 && uSeaC.w > 0.001) {
  vec2 ml = normalize(uSunDirV.xz + vec2(1e-4, 0.0));
  float mf = smoothstep(-0.2, 1.0, dot(mix(oNm.xz, oN.xz, 0.3), ml) * 5.0 + 0.4 * dot(-oV.xz, ml)) * mix(0.35, 1.0, oGroup);
  oEmis += uSkyCol * mf * uSeaC.w * 0.6 * (1.0 - oFoam);         // ≈ +15 % toward the moon
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
  // The radial profile is shaped in display space (what the eye sees): hot-spot ≈ .85 at the centre,
  // ≈ .25–.3 at ρ ≈ .7, fading to 0 at the cone edge — no plateau and no rim, rippled by the wave
  // facets (oRhoE) and the foam, never an evenly filled disc.
  if (oPoolK > 0.001 && oRhoE < 1.0) {
    vec3 Lp = normalize(uSearchPos - oP);
    float nlp = clamp(dot(oN, Lp), 0.0, 1.0);
    float nhp = clamp(dot(oN, normalize(Lp + oV)), 0.0, 1.0);
    float facet = 0.62 + 0.75 * pow(nhp, 12.0);                     // wave facets catch the lamp
    vec3 litWater = vec3(0.78, 0.92, 0.86) * (0.66 + 0.42 * nlp) * (0.8 + 0.4 * oH01) * facet;
    litWater = litWater / (1.0 + 0.25 * max(litWater - 0.6, 0.0));   // soft knee instead of a flat clip
    // a real beam profile: no plateau — brightest in the middle, falling smoothly all the way out
    // (≈ .85 → .5 at ρ .5 → ≈ .25 at ρ .7 → .05 at ρ .9 on screen): a penumbra, never a rim
    float pr = exp(-2.2 * oRhoE * oRhoE) * (1.0 - smoothstep(0.6, 1.1, oRhoE));
    float hot = exp(-pow(oRhoE / 0.3, 2.0));
    vec3 poolDisp = mix(min(litWater, vec3(0.88)), min(oFoamC * 0.92, vec3(0.86)), oFoam) * vec3(1.0, 0.97, 0.9);
    poolDisp *= pr * (0.9 + 0.12 * hot);
    vec3 poolLook = oInvACES(poolDisp) * uLookK.y;
    // by day the pool only lifts the water a little (it never fights the sun): at 0.3 it showed as a
    // flat milky ellipse on sunlit water
    outgoingLight = mix(outgoingLight, max(outgoingLight, poolLook), clamp(oPoolK, 0.0, 1.0) * mix(0.1, 1.0, smoothstep(0.0, 0.7, uSeaE.z)));
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
