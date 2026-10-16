// Ocean.metal — port of the sea surface material (PLAN §3.3 #2):
//   rescue/src/systems/ocean/material.js  (MeshStandardMaterial + onBeforeCompile injection order)
//   rescue/src/systems/ocean/shaders.js   (OCEAN_VERTEX_*, OCEAN_FRAGMENT_SURFACE / _ROUGHNESS /
//                                          _NORMAL / _EMISSIVE / _FINAL)
//   three r185 meshphysical frag (the parts the ocean keeps: point/spot/dir direct light, no IBL,
//   no hemisphere/ambient diffuse — "irradiance = vec3(0.0)"), fog patch (core/look.js).
//
// Assembled fragment order (as three builds it):
//   color_fragment      → OCEAN_FRAGMENT_SURFACE (whole surface model, o* variables)
//   roughnessmap        → roughnessFactor = oRough
//   normal_fragment_*   → normal = oN (world here, see ThreePBR.h)
//   emissivemap         → totalEmissiveRadiance += oEmis
//   lights_fragment_begin (patched): point lights, spot lights × uSpotWater, sun: × oCloudMul,
//                         shadow → oShadow, oSunSpecular (specular only, × uLookK.w)
//   lights_fragment_maps → irradiance = 0 (no IBL)
//   opaque_fragment     ← OCEAN_FRAGMENT_FINAL before it (look radiance, flash, coloured shadow,
//                         searchlight pool, heli contact patch)
//   (no tone mapping / colour space: the scene target is linear HDR) → fog_fragment.
//
// Deviations (all PLAN §3.1 rule 3 — implicit-LOD samples never run in non-uniform control flow):
//   * downwash cat's paws: samples taken under the UNIFORM test uDownwash.w > 0, applied where
//     oDwIn > 0 exactly as before (oCatPaw is only ever used multiplied by oDwIn);
//   * coast/shoal surf: the two shore noise samples (identical uvs in both blocks) are taken once
//     under the uniform test (coast on || shoals > 0);
//   * whitecaps: the two `nz` samples are taken under a uniform "whitecaps possible" test;
//   * streaks / foam lines: evaluated under a uniform "streaks possible" test, the result is kept
//     only where cSea.z + cSea.w > 0.001 (the per-pixel GLSL condition);
//   * water memory dye / oil samples: hoisted under the kOceanMemory function constant.
//   Results are identical to the GLSL wherever the GLSL derivatives were well defined.
// Shadows: material.js patches the directional light loop to capture getShadow() in oShadow (layer 15,
// coloured shadows); here threeDirShadow() (Common/Shadow.h) under kOceanShadows, with the shadow
// coordinate from shadowmap_vertex (world position of the displaced vertex + normalBias · world normal).
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "../Common/Common.h"
#include "../Common/Noise.h"
#include "../Common/Look.h"
#include "../Common/Fog.h"
#include "../Common/ThreePBR.h"
#include "../Common/Shadow.h"
#include "OceanCommon.h"

struct OceanVaryings {
  float4 position [[position]];
  float3 vNormal;        // view-space normal (three vNormal)
  float3 vViewPosition;  // −mvPosition.xyz
  float3 vFogOff;        // world offset from the camera (fog patch)
  float2 vGrid;          // lagrangian world xz (foam & dye ride the orbits)
  float3 vOWorld;        // displaced world position
  float4 vOAux;          // y/Hs, Jacobian, grid cell size, wave damping
  float4 vShadowCoord;   // vDirectionalShadowCoord[0] (shadowmap_vertex)
};

// ---- vertex -----------------------------------------------------------------------------------------
vertex OceanVaryings ocean_vs(uint vid [[vertex_id]],
                              const device float2* gridPositions [[buffer(MD_BUF_VERTICES)]],
                              constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                              constant MDOceanUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                              constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                              texture2d<float> uCoast [[texture(MD_TEX_COAST)]],
                              sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  float2 gl = gridPositions[vid];                         // position.xz (local grid coordinates)
  OceanVertexOut ov = oceanVertex(gl, U, uCoast, smpClamp);
  float4 mvPosition = F.viewMatrix * float4(ov.pos, 1.0f);
  float3x3 normalMatrix = upper3x3(F.viewMatrix);         // inverse-transpose of an orthonormal view
  OceanVaryings o;
  o.position = F.projMatrix * mvPosition;
  o.vNormal = normalize(normalMatrix * ov.nrm);
  o.vViewPosition = -mvPosition.xyz;
  o.vFogOff = fogOffset(mvPosition, F.viewMatrix);
  o.vGrid = ov.grid;
  o.vOWorld = ov.pos;
  o.vOAux = ov.aux;
  // shadowmap_vertex: worldPosition = modelMatrix · transformed (identity model), world normal of the vertex
  o.vShadowCoord = kOceanShadows ? threeDirShadowCoord(float4(ov.pos, 1.0f), ov.nrm, LT) : float4(0.0f);
  return o;
}

// ---- fragment helpers (OCEAN_FRAGMENT_PARS) ---------------------------------------------------------------

// Exact inverse of three's ACES fit (input matrix → RRT/ODT fit → output matrix). Palette colours
// are the intended on-screen colours, so the water's own radiance is "what ACES needs to show it".
inline float3 oInvACES(float3 y) {
  const float3x3 OUT_INV = float3x3(float3(0.643038f, 0.059269f, 0.005962f),
                                    float3(0.311187f, 0.931436f, 0.063929f),
                                    float3(0.045775f, 0.009295f, 0.930118f));
  const float3x3 IN_INV = float3x3(float3(1.764741f, -0.147028f, -0.036337f),
                                   float3(-0.675778f, 1.160252f, -0.162436f),
                                   float3(-0.088963f, -0.013224f, 1.198773f));
  float3 v = clamp(OUT_INV * y, float3(0.0f), float3(0.95f));
  float3 a = 1.0f - 0.983729f * v;
  float3 b = 0.0245786f - 0.4329510f * v;
  float3 c = -0.000090537f - 0.238081f * v;
  float3 u = (-b + sqrt(b * b - 4.0f * a * c)) / (2.0f * a);
  return max(IN_INV * u, float3(0.0f)) * 0.6f;
}

inline float2 oToFrame(float2 p, float2 cs) { return float2(cs.x * p.x + cs.y * p.y, -cs.y * p.x + cs.x * p.y); }
inline float2 oFromFrame(float2 q, float2 cs) { return float2(cs.x * q.x - cs.y * q.y, cs.y * q.x + cs.x * q.y); }

// Foam density f → appearance (ragged dense core + translucent texture-broken fringe).
inline float oFoamShape(float f, float tex, float rag) {
  float e = f + 0.3f * (rag - 0.5f);
  float core = glSmoothstep(0.6f, 1.0f, e) * (0.5f + 0.36f * glMix(tex, rag, 0.55f));
  float body = glSmoothstep(0.06f, 0.75f, e);
  float fringe = body * glSmoothstep(1.0f - body, 1.35f - 0.6f * body, tex + 0.25f) * (0.22f + 0.4f * body);
  return max(core, fringe);
}

// Aged foam (rogue carpet, residual scar): marbling from the warped lace, thinned by the streaky texture.
inline float oFoamAged(float f, float laceN, float tex) {
  float m = glSmoothstep(0.62f, 1.0f, laceN * (0.7f + 0.6f * tex));
  float veil = glSmoothstep(0.4f, 0.85f, tex) * 0.14f;
  return f * (veil + 0.38f * m);
}

// Wind streaks: long meandering bands along the wind (q.x along, q.y across). Uniform flow only.
inline float oStreakBands(float2 q, float spacing, float seed, texture2d<float> uAtlas, sampler smp) {
  float lv = q.y / spacing + (uAtlas.sample(smp, float2(q.x * 0.0028f, q.y * 0.006f + seed)).r - 0.5f) * 0.45f;
  lv += (uAtlas.sample(smp, float2(q.x * 0.021f, q.y * 0.013f + seed * 3.0f)).r - 0.5f) * 0.22f;   // small wobble
  float id = floor(lv);
  float d = abs(fract(lv) - 0.5f);
  // each band id reads its own noise row: R = breaks into 15–60 m segments, G = width, B = strength
  float4 t = uAtlas.sample(smp, float2(q.x * 0.006f + fract(id * 0.618f) * 7.0f, fract(id * 0.382f) + seed));
  float brk = glSmoothstep(0.5f, 0.72f, t.r * 0.65f + t.b * 0.35f);
  float w = 0.025f + 0.09f * t.g;
  return (1.0f - glSmoothstep(0.0f, w, d)) * brk * (0.55f + 0.45f * t.b);
}

// Lace lookup with an explicit LOD (polar coordinates have a seam that breaks automatic mips).
inline float oLaceLod(float2 uv, float footUv, int ch, texture2d<float> uLace, sampler smp) {
  float4 t = uLace.sample(smp, uv, level(log2(max(footUv * 512.0f, 1.0f))));
  return ch == 0 ? t.r : (ch == 1 ? t.g : t.b);
}

// oSunSpecular (material.js SUN_SPECULAR): the sun only contributes its specular, × sun-disk visibility.
inline void oSunSpecular(IncidentLight directLight, float3 geometryNormal, float3 geometryViewDir,
                         thread const PhysicalMaterial& material, thread ReflectedLight& reflectedLight,
                         float sunDisk, texture2d<float> dfgLUT, sampler dfgSmp) {
  float dotNL = saturate1(dot(geometryNormal, directLight.direction));
  reflectedLight.directSpecular += dotNL * directLight.color * sunDisk *
      BRDF_GGX_Multiscatter(directLight.direction, geometryViewDir, geometryNormal, material, dfgLUT, dfgSmp);
}

// ---- fragment -------------------------------------------------------------------------------------------
fragment float4 ocean_fs(OceanVaryings in [[stage_in]],
                         constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                         constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                         constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                         constant MDOceanUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                         texture2d<float> uAtlas [[texture(MD_TEX_ATLAS)]],
                         texture2d<float> uDetail [[texture(MD_TEX_DETAIL)]],
                         texture2d<float> uLace [[texture(MD_TEX_LACE)]],
                         texture2d<float> dfgLUT [[texture(MD_TEX_DFG)]],
                         texture2d<float> uCoast [[texture(MD_TEX_COAST)]],
                         texture2d<float> uMem [[texture(MD_TEX_MEMORY)]],
                         depth2d<float> shadowMap [[texture(MD_TEX_SHADOW)]],
                         sampler smpLook [[sampler(MD_SMP_LOOK)]],
                         sampler smpOcean [[sampler(MD_SMP_OCEAN)]],
                         sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                         sampler smpShadow [[sampler(MD_SMP_SHADOW)]]) {
  // shared look uniforms
  const float uTime = L.timeWindRain.x;
  const float2 uWind = L.timeWindRain.yz;
  const float uRain = L.timeWindRain.w;
  const float2 uWindOffset = L.windOffsetWetFlash.xy;
  // ocean uniforms with their GLSL names
  const float2 uOffset = U.grid.xy;
  const float uHsEff = U.grid.w;
  const float uSearchI = U.misc.z;
  const float uStreakMix = U.misc.w;
  const float uSpotWater = U.misc.y;
  const float3 cameraPosition = F.cameraPosition.xyz;

  // ================= OCEAN_FRAGMENT_SURFACE =================
  float3 oP = in.vOWorld;
  float3 oV = normalize(cameraPosition - oP);
  float2 oXZ = oP.xz;
  float2 oG = in.vGrid;
  float oFoot = max(length(fwidth(oG)), 0.002f);            // metres per pixel
  float oH01 = clamp(0.5f + in.vOAux.x, 0.0f, 1.0f);
  float oCell = in.vOAux.z;
  float oDamp = in.vOAux.w;
  float3x3 viewRot = upper3x3(F.viewMatrix);
  float3 nonPerturbedNormal = normalize(in.vNormal);        // normal_fragment_begin (view space)
  float3 oNm = normalize(transpose(viewRot) * nonPerturbedNormal);   // macro normal, world
  float oT = uTime;
  float oNight = U.uSeaE.z;
  float2 oWd = length(uWind) > 0.05f ? normalize(uWind) : float2(1.0f, 0.0f);
  float2 oFlow = uWindOffset * 0.03f;                         // surface drift ≈ 3% of the wind
  float oShadow = 1.0f;                                       // captured in the light loop (sun shadow)

  // ---- spatial weather front: the new weather sweeps across the sea as a ragged line
  float3 cDeep = U.uDeep.xyz;
  float3 cBody = U.uBody.xyz;
  float3 cCrest = U.uCrest.xyz;
  float3 cFoam = U.uFoamCol.xyz;
  float4 cSea = U.uSeaA;
  if (U.uFrontB.z > 0.5f) {
    float along = dot(oXZ - U.uFront.xy, U.uFront.zw) - U.uFrontB.x;
    along += (uAtlas.sample(smpOcean, oXZ * 0.004f + float2(0.21f, 0.47f)).r - 0.5f) * U.uFrontB.y * 0.9f;
    float f = glSmoothstep(-U.uFrontB.y, U.uFrontB.y, along);   // 1 = the old weather still holds here
    cDeep = glMix(U.uNextDeep.xyz, U.uPrevDeep.xyz, f);
    cBody = glMix(U.uNextBody.xyz, U.uPrevBody.xyz, f);
    cCrest = glMix(U.uNextCrest.xyz, U.uPrevCrest.xyz, f);
    cFoam = glMix(U.uNextFoam.xyz, U.uPrevFoam.xyz, f);
    cSea = glMix(U.uNextSea, U.uPrevSea, f);
  }
  const bool frontOn = U.uFrontB.z > 0.5f;

  // ---- 2. gusts: the same field that pushes the helicopter (look.gustField / frontsAt)
  float oGust = lookGust(oXZ, L, uAtlas, smpOcean);
  float oFrontW = lookFronts(oXZ, L);
  float oGustV = clamp(max(oGust, oFrontW * 0.16f), 0.0f, 1.0f);
  float oULoc = U.uSeaE.x * (0.85f + 0.3f * oGust) + oFrontW;

  // ---- 9. rotor downwash disc
  float2 oDwD = oXZ - U.uDownwash.xy;
  float oDwR = length(oDwD);
  float2 oDwDir = oDwD / max(oDwR, 1e-3f);
  float oDwS = U.uDownwash.w;
  // no clean outer edge: the roughened disc frays out over the outer half, its radius wandering ±15 %
  float oDwRn = uAtlas.sample(smpOcean, oDwDir * 0.33f + float2(oT * 0.03f, 0.31f)).r;
  float oDwIn = oDwS * (1.0f - glSmoothstep(0.5f * U.uDownwash.z, (1.1f + 0.3f * (oDwRn - 0.5f)) * U.uDownwash.z, oDwR));
  float oLow = (1.0f - glSmoothstep(8.0f, 12.0f, U.uHeliP.z)) * step(0.001f, oDwS);

  // ---- 11. searchlight pool (CPU mirror: Ocean.searchlightAt)
  float oBeam = 0.0f;
  float oRing = 0.0f;
  float oRho = 2.0f;
  float oPoolK = 0.0f;
  float2 oPoolDir = float2(0.0f);
  if (uSearchI > 0.0f) {
    float3 sl = oP - U.uSearchPos.xyz;
    float sd = length(sl);
    float cs = dot(sl / max(sd, 1e-3f), U.uSearchDir.xyz);
    oRho = acos(clamp(cs, -1.0f, 1.0f)) / max(acos(U.uSearchDir.w), 1e-3f);
    float range = 1.0f - glSmoothstep(220.0f, 320.0f, sd);
    oPoolK = uSearchI * range;
    oBeam = oPoolK * (1.0f - glSmoothstep(0.45f, 1.0f, oRho));
    float2 ctr = U.uSearchPos.xz + U.uSearchDir.xz * (U.uSearchPos.y / max(-U.uSearchDir.y, 0.05f));
    float2 rc = oXZ - ctr;
    oPoolDir = rc / max(length(rc), 1e-3f);
    // the reflector's faint broad ring (no crisp circle), shimmering with the lamp
    oRing = oPoolK * exp(-sq((oRho - 0.78f) / 0.16f)) * (1.0f + 0.02f * sin(oT * 61.0f));
  }

  // ---- 1. normals: macro (vertex) + 2 detail octaves + LOD'd short waves + ripples
  float2 oSm = -oNm.xz / max(oNm.y, 0.2f);
  float2 oSd = float2(0.0f);
  float oDetAmt = cSea.x * (0.6f + 0.8f * oGustV) * (1.0f + 0.3f * oBeam);
  {
    float2 t1 = uDetail.sample(smpLook, oToFrame(oG, U.uDetRot.xy) / 14.0f + U.uDetOff.xy).rg * 2.0f - 1.0f;
    float2 det;
    if (kOceanQ > 0) {
      float2 t2 = uDetail.sample(smpLook, oToFrame(oG, U.uDetRot.zw) / 5.5f + U.uDetOff.zw).rg * 2.0f - 1.0f;
      det = oFromFrame(t1, U.uDetRot.xy) * 0.6f + oFromFrame(t2, U.uDetRot.zw) * 0.4f;
    } else {
      det = oFromFrame(t1, U.uDetRot.xy);
    }
    // amplitude calibrated to wind-ripple slope statistics (Cox–Munk σ ≈ 0.08 calm … 0.3 storm)
    oSd += det * (1.5f * oDetAmt);
  }
  for (int i = 0; i < kOceanWaves; i++) {
    float4 A = U.uWaveA[i];
    float4 B = U.uWaveB[i];
    float wv = oDamp * (1.0f - glSmoothstep(7.0f, 10.0f, B.z / oCell)) * glSmoothstep(2.5f, 5.0f, B.z / oFoot);
    if (wv <= 0.0f) continue;
    float th = A.z * dot(A.xy, oG - uOffset) + B.y;
    oSd += (A.w * A.z * cos(th) * wv) * A.xy;
  }
  // downwash: wind-flattened, gust-driven cat's-paw ripples racing outward (no concentric rings)
  float oCatPaw = 0.0f;
  if (oDwS > 0.0f) {                                       // uniform: the samples run in uniform flow
    float2 dq = oToFrame(oDwD, oWd);
    float2 rip = uDetail.sample(smpLook, oXZ * 0.33f - oDwDir * (oT * 2.4f)).rg * 2.0f - 1.0f;
    float catPaw = glSmoothstep(0.4f, 0.7f, uAtlas.sample(smpOcean, dq * float2(0.035f, 0.11f) - float2(oT * 0.21f, 0.0f) + float2(0.31f, 0.77f)).r
                                + 0.35f * (uAtlas.sample(smpOcean, oXZ * 0.21f - oDwDir * oT * 0.6f).r - 0.5f)
                                + 0.3f * (uAtlas.sample(smpOcean, oDwDir * 1.7f + float2(0.13f, oDwR * 0.05f - oT * 0.35f)).r - 0.5f));
    if (oDwIn > 0.0f) {
      oCatPaw = catPaw;
      oSd += (rip * 0.16f + oDwDir * 0.05f * sin(oDwR * 3.1f - oT * 13.0f + rip.x * 3.0f)) * oDwIn * (0.5f + 0.8f * oCatPaw);
    }
  }

  // splash rings (24 analytic slots)
  float oSplF = 0.0f;
  for (int i = 0; i < MD_MAX_SPLASHES; i++) {
    if (i >= U.uSplashCount) break;
    float4 s = U.uSplash[i];
    float life = 1.4f + 0.3f * s.w;
    float k = s.z / life;
    if (k >= 1.0f) continue;
    float2 d = oXZ - s.xy;
    float r = length(d);
    float rr = s.w * (0.35f + 2.4f * sqrt(k));
    float x = (r - rr) / (0.3f + 0.15f * s.w);
    if (abs(x) > 4.0f && r > rr) continue;
    float str = U.uSplashS[i >> 2][i & 3];
    float env = (1.0f - k) * (1.0f - k) * str;
    oSd += d / max(r, 1e-3f) * (cos(x * 2.6f) * exp(-0.5f * x * x) * env * 0.35f);
    float core = (1.0f - glSmoothstep(0.2f * rr, rr, r)) * (1.0f - glSmoothstep(0.0f, 0.45f, k)) * str;
    oSplF = max(oSplF, max(exp(-x * x) * env, core * 0.8f));
  }

  // 8. rain rings (two cell layers), denser with rain; first rare big rings
  if (kOceanRainLayers > 0 && uRain > 0.02f) {
    float big = glMix(1.6f, 1.0f, glSmoothstep(0.1f, 0.6f, uRain));
    for (int l = 0; l < kOceanRainLayers; l++) {
      float sz = (l == 0 ? 0.9f : 0.55f) * big;
      float2 cc = oXZ / sz + float(l) * 17.3f;
      float2 ci = floor(cc);
      float2 cf = fract(cc) - 0.5f;
      float2 h = hash22(ci);
      float tt = oT / 0.7f + h.x * 7.0f;
      float cyc = floor(tt);
      float ph = tt - cyc;
      float on = step(hash12(ci + cyc * 3.17f), uRain * uRain * 0.85f + 0.08f * uRain);
      float2 dd = cf - (h - 0.5f) * 0.36f;
      float dr = length(dd);
      float wr = max(0.05f, oFoot / sz * 0.8f);
      float x = (dr - ph * 0.42f) / wr;
      float ring = exp(-x * x) * (1.0f - ph) * on * (1.0f - glSmoothstep(0.25f, 1.1f, oFoot / sz));
      oSd += dd / max(dr, 1e-3f) * ring * 0.45f;
    }
  }

  // ---- 3. body colour, cat's paws, troughs, pressed water (wave groups, footprint-faded height tint)
  float oGroup = glSmoothstep(0.15f, 0.85f, uAtlas.sample(smpOcean, oXZ * 0.0045f + float2(0.61f, 0.13f) - uWindOffset * 0.003f).r);
  float oHc = clamp(0.5f + (oH01 - 0.5f) * glMix(0.3f, 1.2f, oGroup) * glMix(1.0f, 0.6f, glSmoothstep(0.15f, 0.6f, oFoot)), 0.0f, 1.0f);
  float3 oBodyC = glMix(cDeep, cBody, pow(oHc, 1.2f));
  oBodyC *= glMix(0.78f, 1.0f, glSmoothstep(0.0f, 0.45f, oHc));
  oBodyC *= 1.0f - 0.12f * oGustV * (1.0f - 0.75f * oNight);
  oBodyC *= 1.0f - (0.02f + 0.22f * oCatPaw) * oDwIn;          // roughened, darker cat's paws under the rotor

  // ---- 4. shallows & surf around rocks (coast map + analytic shoal circles)
  float oShallow = 0.0f;
  float oSurf = 0.0f;
  float oSurfOld = 0.0f;
  float oCoastD = oceanCoastD(oXZ, U, uCoast, smpClamp);
  // shore noise: identical uvs in the coast and the shoal block, sampled once in uniform flow
  float shoreA = 0.5f;
  float shoreB = 0.5f;
  if (U.misc.x > 0.5f || U.uShoalCount > 0) {
    shoreA = uAtlas.sample(smpOcean, oXZ * 0.035f + float2(0.29f, 0.61f)).r;
    shoreB = uAtlas.sample(smpOcean, oXZ * 0.11f + float2(0.83f, 0.17f)).r;
  }
  if (oCoastD < 40.0f) {
    float sn = shoreA;
    float sn2 = shoreB;
    float2 gd = float2(oceanCoastD(oXZ + float2(2.0f, 0.0f), U, uCoast, smpClamp) - oceanCoastD(oXZ - float2(2.0f, 0.0f), U, uCoast, smpClamp),
                       oceanCoastD(oXZ + float2(0.0f, 2.0f), U, uCoast, smpClamp) - oceanCoastD(oXZ - float2(0.0f, 2.0f), U, uCoast, smpClamp));
    float2 cn = gd / max(length(gd), 1e-3f);                                                    // seaward
    float d = oCoastD + (sn - 0.5f) * 2.4f + (sn2 - 0.5f) * 1.2f;                               // ragged
    oShallow = 1.0f - glSmoothstep(0.0f, 9.0f + 1.5f * uHsEff, d + (sn - 0.5f) * 6.0f);
    float expo = clamp(0.5f - 0.6f * dot(cn, oWd), 0.0f, 1.0f);                                 // 1 = windward
    // sets every 6 s arrive with the swell (phase runs along the wind) and break unevenly along the shore
    float setT = fract(oT / 6.0f - dot(oXZ, oWd) / 72.0f + 0.4f * sn);
    float pulse = 1.0f - setT;
    float cover = glSmoothstep(0.42f, 0.68f, sn * 0.5f + sn2 * 0.25f + expo * 0.45f + 0.12f * pulse - 0.06f);   // 30–60 % gaps
    float zone = 1.5f + 1.0f * uHsEff * (0.4f + 0.8f * expo);                                   // spread
    float bandPos = glMix(0.3f, zone, setT);
    float sea = glSmoothstep(0.25f, 2.5f, uHsEff);
    float brkL = glSmoothstep(0.35f, 0.65f, sn2 + 0.4f * pulse - 0.15f);
    float band = exp(-sq((d - bandPos) / (0.6f + (0.15f + 0.3f * setT) * uHsEff))) * (0.12f + 0.8f * pulse * pulse) * glMix(1.0f, brkL, setT);
    float wash = (1.0f - glSmoothstep(0.0f, 1.2f + 0.5f * uHsEff, d)) * (0.3f + 0.45f * pulse) * (0.3f + 0.7f * sea);
    oSurf = max(band * (0.35f + 0.65f * sea), wash) * cover;
    // backwash fringe: aged lace seaward of the break, fading over a few metres
    oSurfOld = exp(-max(d - 0.5f, 0.0f) / (2.0f + 1.2f * uHsEff)) * glSmoothstep(0.3f, 0.6f, sn + 0.3f * expo) * 0.75f;
  }
  for (int i = 0; i < MD_MAX_SHOALS; i++) {
    if (i >= U.uShoalCount) break;
    float4 s = U.uShoals[i];
    if (s.w < 0.5f) continue;
    float2 rel = oXZ - s.xy;
    float d = length(rel) - s.z;
    d += (uAtlas.sample(smpOcean, oXZ * 0.045f + s.xy * 0.013f).r - 0.5f) * (0.6f * s.z + 2.0f);   // rocks aren't circles
    oShallow = max(oShallow, 1.0f - glSmoothstep(0.0f, 1.8f * s.z + 6.0f, d));
    if (d > 30.0f) continue;
    float expo = clamp(0.5f - 0.6f * dot(rel / max(length(rel), 1e-3f), oWd), 0.0f, 1.0f);       // 1 = windward
    float setT = fract(oT / 6.0f + s.x * 0.013f + s.y * 0.007f);    // sets every 6 s
    float pulse = 1.0f - setT;
    float shore = shoreA * 0.65f + shoreB * 0.35f;
    float cover = glSmoothstep(0.42f, 0.68f, shore * 0.75f + expo * 0.45f + 0.12f * pulse - 0.08f);
    float zone = 3.0f + 2.2f * uHsEff * (0.5f + 0.7f * expo);                                   // break zone width
    float bandPos = glMix(zone, 0.5f, setT);
    float band = exp(-sq((d - bandPos) / (0.8f + 0.35f * uHsEff))) * (0.25f + 0.75f * pulse);
    float wash = (1.0f - glSmoothstep(0.0f, 1.5f + 0.5f * uHsEff, d)) * (0.35f + 0.45f * pulse);
    oSurf = max(oSurf, max(band, wash) * cover * step(-1.0f, d));
    oSurfOld = max(oSurfOld, exp(-max(d - 0.5f, 0.0f) / (2.5f + 1.2f * uHsEff)) * glSmoothstep(-1.0f, 1.0f, d) * glSmoothstep(0.3f, 0.6f, shore + 0.3f * expo) * 0.8f);
  }
  // cold granite seabed: the shallow halo stays close to the body colour (≤ ~25 % lighter)
  oBodyC = glMix(oBodyC, U.uShallow.xyz, oShallow * 0.5f);

  // ---- big features: rogue wave, spout base, whirlpool (shading; heights come from the vertex)
  float oFeatFoam = 0.0f;
  float oFeatAged = 0.0f;
  float oFeatLine = 0.0f;
  float oFeatDark = 0.0f;
  float oFeatSss = 0.0f;
  float oAbyss = 0.0f;
  for (int i = 0; i < MD_MAX_FEATURES; i++) {
    if (i >= U.uFeatCount) break;
    float4 A = U.uFeatA[i];
    float4 B = U.uFeatB[i];
    float4 C = U.uFeatC[i];
    if (A.x < 1.5f) {
      float3 f = oRogueFrame(oG, A, B);
      float W = max(B.z, 1.0f);
      float xm = f.x;                                         // metres, > 0 ahead of the crest
      float xf = xm / W;
      float hk = clamp(A.w / 8.0f, 0.0f, 1.0f);
      float age = C.y;
      // crest edge: three noise octaves along the crest; fingers 2–12 m long, leaning with the wind
      float fy = f.y - dot(oWd, float2(-B.y, B.x)) * 0.5f * max(xm, 0.0f);
      float e1 = uAtlas.sample(smpOcean, float2(fy * 0.004f + 0.13f, 0.37f + age * 0.002f)).r;
      float e2 = uAtlas.sample(smpOcean, float2(fy * 0.017f + 0.61f, 0.71f + age * 0.006f)).r;
      float e3 = uAtlas.sample(smpOcean, float2(fy * 0.06f + 0.29f, 0.19f + age * 0.015f)).r;
      // finger mask: two fbm octaves at incommensurate scales (≈ 14 m and 5 m) → irregular spacing
      float fn = uAtlas.sample(smpOcean, float2(fy * 0.019f + 0.47f, 0.83f + age * 0.004f)).r * 0.65f
               + uAtlas.sample(smpOcean, float2(fy * 0.053f + 0.11f, 0.29f + age * 0.009f)).r * 0.35f;
      float fsel = glSmoothstep(0.55f, 0.72f, fn) * glSmoothstep(0.3f, 0.6f, e2);
      float flen = 2.0f + 10.0f * uAtlas.sample(smpOcean, float2(fy * 0.013f + 0.77f, 0.05f)).r;
      float edgeM = W * 0.06f + (e1 - 0.5f) * 0.3f * W + (e2 - 0.5f) * 3.0f + (e3 - 0.5f) * 1.4f + fsel * flen;
      float lip = (1.0f - glSmoothstep(edgeM - 1.0f - 0.7f * fsel * flen, edgeM + 0.8f + 0.4f * fsel * flen, xm)) * glSmoothstep(-1.3f * W, -0.25f * W, xm);
      lip *= 1.0f - 0.45f * fsel * glSmoothstep(edgeM - fsel * flen, edgeM, xm);     // fingers thin out toward the tips
      // the white water on the back of the crest is already marbled (boils ≈ 9 m and 30 m)
      float mbL = uAtlas.sample(smpOcean, oG * 0.11f + float2(0.71f, 0.33f) - age * 0.004f).r * 0.3f
                + uAtlas.sample(smpOcean, oG * 0.033f + float2(0.07f, 0.58f)).r * 0.45f
                + uAtlas.sample(smpOcean, oG * 0.013f + float2(0.41f, 0.19f)).r * 0.25f;
      lip *= glMix(glMix(0.5f, 1.06f, glSmoothstep(0.22f, 0.78f, mbL)), 1.0f, glSmoothstep(edgeM - 0.5f * W, edgeM - 0.1f * W, xm));
      // a thin bright broken line where the lip plunges
      float brk = glSmoothstep(0.42f, 0.62f, e3 * 0.4f + uAtlas.sample(smpOcean, float2(fy * 0.14f + 0.21f, 0.6f + age * 0.03f)).r * 0.6f);
      oFeatLine = max(oFeatLine, exp(-sq((xm - (edgeM - fsel * flen) + 1.2f) / 0.9f)) * brk * f.z * hk);
      // white-water carpet behind the crest: dense when fresh, then marbled, a scar for 30–40 s
      float behind = max(-xm, 0.0f);
      float travelled = C.y * C.z;
      float ageB = behind / max(C.z, 1.0f);
      float pn = uAtlas.sample(smpOcean, oG * 0.011f + float2(0.53f, 0.07f)).r * 0.6f + uAtlas.sample(smpOcean, oG * 0.037f + float2(0.19f, 0.91f)).r * 0.4f;
      // where the wave began to break is a ragged, soft line (never a straight spawn edge)
      float began = travelled * (0.62f + 0.38f * pn);
      float carpet = (0.3f + 0.7f * exp(-behind / 45.0f)) * exp(-behind / max(C.z * 30.0f, 60.0f))
                   * (1.0f - glSmoothstep(began - 14.0f, began + 2.0f, behind)) * glSmoothstep(-0.15f * W, -0.9f * W, xm);
      float thr = 0.3f + 0.2f * glSmoothstep(1.0f, 10.0f, ageB) + 0.1f * (1.0f - C.x);
      carpet *= glSmoothstep(thr - 0.05f, thr + 0.12f, pn);
      float mb = uAtlas.sample(smpOcean, oG * 0.11f + float2(0.71f, 0.33f) - C.y * 0.004f).r * 0.3f
               + uAtlas.sample(smpOcean, oG * 0.033f + float2(0.07f, 0.58f)).r * 0.45f
               + uAtlas.sample(smpOcean, oG * 0.013f + float2(0.41f, 0.19f)).r * 0.25f;
      carpet *= glMix(0.45f, 1.08f, glSmoothstep(0.22f, 0.78f, mb));
      oFeatFoam = max(oFeatFoam, max(lip * hk, carpet * C.x * (1.0f - glSmoothstep(2.0f, 7.0f, ageB))) * f.z);
      oFeatAged = max(oFeatAged, carpet * C.x * glSmoothstep(1.0f, 5.0f, ageB) * f.z);
      // the forward face: bottle-green glass only in the top ~20 % where the lip thins
      float ef = (edgeM - fsel * flen) / W;
      oFeatSss = max(oFeatSss, glSmoothstep(ef - 0.03f, ef + 0.05f, xf) * (1.0f - glSmoothstep(ef + 0.1f, ef + 0.26f, xf)) * f.z * hk);
      oFeatDark = max(oFeatDark, glSmoothstep(ef + 0.06f, ef + 0.8f, xf) * (1.0f - glSmoothstep(1.5f, 2.6f, xf)) * f.z * hk);
      // suction ahead of the wall: broken foam streaks pulled toward it
      float ahead = glSmoothstep(1.0f, 1.8f, xf) * (1.0f - glSmoothstep(2.8f, 7.0f, xf));
      float strk = glSmoothstep(0.6f, 0.85f, uAtlas.sample(smpOcean, float2(f.x * 0.004f, fy * 0.05f)).r * 0.6f
                                           + uAtlas.sample(smpOcean, float2(f.x * 0.013f + 0.4f, fy * 0.13f)).r * 0.4f);
      oFeatAged = max(oFeatAged, ahead * strk * f.z * hk * 0.7f);
    } else {
      float2 d = oG - A.yz;
      float r = length(d);
      float R = max(B.x, 1.0f);
      float s = A.w;
      float ang = glAtan(d.y, d.x);
      float age = C.x;
      float lr = log(max(r, 0.5f) / R);
      float fuv = oFoot * max(0.08f, 1.2732f / max(r, 1.0f));
      if (A.x < 2.5f) {
        float disc = (1.0f - glSmoothstep(0.5f * R, 1.5f * R, r)) * glSmoothstep(0.0f, 0.25f, s);
        float ringD = exp(-sq((r - 1.2f * R) / (0.16f * R))) * glSmoothstep(0.2f, 0.5f, s);
        oFeatDark = max(oFeatDark, max(disc * 0.4f, ringD * 0.75f));
        float arms = sin(4.0f * (ang + B.y * 2.2f * lr) + B.y * age * 5.0f);
        float spiral = glSmoothstep(0.35f, 0.95f, arms) * (1.0f - glSmoothstep(0.9f * R, 1.6f * R, r))
                     * glSmoothstep(0.08f * R, 0.3f * R, r) * glSmoothstep(0.25f, 0.6f, s);
        float ringF = exp(-sq((r - R) / (0.1f * R))) * glSmoothstep(0.55f, 0.9f, s);
        float lace = oLaceLod(float2(ang * 1.2732f, r * 0.08f - age * 0.9f * B.y), fuv, 2, uLace, smpOcean);
        float brk = glSmoothstep(0.3f, 0.6f, oLaceLod(float2(ang * 0.6366f, r * 0.03f - age * 0.3f * B.y), fuv * 0.4f, 1, uLace, smpOcean));
        oFeatFoam = max(oFeatFoam, max(spiral * brk * (0.55f + 0.6f * lace), ringF * (0.75f + 0.4f * lace)));
      } else {
        float arms = sin(5.0f * (ang - B.y * 1.8f * lr) - B.y * age * (1.2f + 2.0f / (0.3f + r / R)));
        float a = glSmoothstep(0.25f, 0.9f, arms) * (1.0f - glSmoothstep(R, 1.4f * R, r)) * glSmoothstep(0.1f * R, 0.35f * R, r);
        float rim = exp(-sq((r - R) / (0.12f * R)));
        float lace = oLaceLod(float2(ang * 1.2732f, r * 0.06f + age * 0.5f), fuv, 0, uLace, smpOcean);
        float brk = glSmoothstep(0.3f, 0.62f, oLaceLod(float2(ang * 0.6366f, r * 0.025f + age * 0.2f), fuv * 0.4f, 1, uLace, smpOcean));
        oFeatFoam = max(oFeatFoam, (a * brk * 0.85f + rim * 0.7f) * s * clamp(0.55f + 0.6f * lace, 0.0f, 1.0f));
        oAbyss = max(oAbyss, (1.0f - glSmoothstep(0.05f * R, 0.4f * R, r)) * s);
        oFeatDark = max(oFeatDark, (1.0f - glSmoothstep(0.3f * R, 0.9f * R, r)) * s * 0.5f);
      }
    }
  }

  // ---- 6.6 water memory (render target; off until the memory pass lands → kOceanMemory = false)
  float4 oMem = float4(0.0f);
  float memDyeTurb = 0.0f;
  float memOilTex = 0.0f;
  if (kOceanMemory) {
    float2 muv = (oXZ - U.uMemWin.xy) / U.uMemWin.z + 0.5f;
    float2 me = glSmoothstep(0.0f, 0.07f, muv) * (1.0f - glSmoothstep(0.93f, 1.0f, muv));
    // memory pass writes GL row order (PLAN §2.5: flipped clip-y), so muv addresses it directly
    oMem = max(uMem.sample(smpClamp, muv), float4(0.0f)) * (me.x * me.y);
    memDyeTurb = (uAtlas.sample(smpOcean, oXZ * 0.11f - oFlow * 0.11f).r - 0.5f) * 0.5f + (uAtlas.sample(smpOcean, oXZ * 0.31f + 0.5f).r - 0.5f) * 0.25f;
    memOilTex = uAtlas.sample(smpOcean, oXZ * 0.08f - oFlow * 0.08f).r;
  }

  // ---- 7. foam layers (combined with max): shared multi-scale foam texture
  float2 oQw = oToFrame(oG - oFlow, oWd);                                          // x along the wind
  float oFb1 = uAtlas.sample(smpOcean, oQw * float2(0.010f, 0.05f) + float2(0.11f, 0.83f)).r;   // ≈100 × 20 m
  float oFb2 = uAtlas.sample(smpOcean, oQw * float2(0.040f, 0.20f) + float2(0.57f, 0.21f)).r;   // ≈25 × 5 m
  float2 oWp = oG - oFlow + (uAtlas.sample(smpOcean, oG * 0.017f + float2(0.71f, 0.29f)).rg - 0.5f) * 9.0f;
  float4 oLaceAvg = uLace.sample(smpOcean, float2(0.5f), level(10.0f));           // 512² → the 1×1 mip
  float oL1 = uLace.sample(smpOcean, oToFrame(oWp, float2(0.8f, 0.6f)) * 0.045f).r;
  float oL2 = uLace.sample(smpOcean, oToFrame(oWp, float2(0.28f, 0.96f)) * 0.1215f + float2(0.37f, 0.11f)).r;
  float oFb3;
  float oL3;
  float oBub;
  if (kOceanQ > 0) {
    oFb3 = uAtlas.sample(smpOcean, oQw * float2(0.15f, 0.75f) + float2(0.33f, 0.66f)).r;    // ≈7 × 1.3 m
    oL3 = uLace.sample(smpOcean, oToFrame(oWp, float2(-0.6f, 0.8f)) * 0.3285f + float2(0.71f, 0.53f)).r;
    oBub = uLace.sample(smpOcean, oWp * 0.9f + float2(0.13f, 0.41f)).b - oLaceAvg.b;
  } else {
    oFb3 = 0.5f;
    oL3 = oLaceAvg.r;
    oBub = 0.0f;
  }
  float oLaceN = (oL1 * 0.45f + oL2 * 0.33f + oL3 * 0.22f) / max(2.0f * oLaceAvg.r, 0.05f);
  oLaceN = clamp(glMix(oLaceN, 0.5f, glSmoothstep(0.35f, 0.9f, oFoot)), 0.0f, 1.0f);
  float oFTex = clamp(0.5f + 1.25f * (0.3f * (oFb2 - 0.5f) + 0.27f * (oFb3 - 0.5f) + 0.18f * (oFb1 - 0.5f)) + 0.3f * oBub + 0.15f * (oLaceN - 0.5f), 0.0f, 1.0f);
  float oRag = uAtlas.sample(smpOcean, oWp * 0.06f + float2(0.17f, 0.53f)).r;

  // 7a whitecaps — Monahan coverage ∝ U^3.41; preset value = mean, local gusts modulate (softened)
  float oCov = clamp(cSea.y * 0.45f * pow(max(oULoc, 0.0f) / max(U.uSeaE.x, 1.0f), 2.5f), 0.0f, 0.6f);
  oCov *= 1.0f - oLow * (1.0f - glSmoothstep(0.7f, 1.0f, oDwR / max(U.uDownwash.z, 1.0f)));           // "ты низко"
  oCov = min(oCov * (0.45f + 1.1f * oGroup), 0.6f);       // breaking comes in wave groups
  float oWc = 0.0f;
  float oWcRaw = 0.0f;
  // uniform "whitecaps possible": cSea.y is uSeaA.y, or a blend of uPrevSea.y / uNextSea.y across the front
  const bool wcPossible = U.uSeaA.y > 0.0f || (frontOn && (U.uPrevSea.y > 0.0f || U.uNextSea.y > 0.0f));
  float nzS = 0.0f;
  if (wcPossible) {
    nzS = (uAtlas.sample(smpOcean, oQw * float2(0.024f, 0.014f) + float2(0.63f, 0.29f)).r - 0.5f) * 5.0f
        + (uAtlas.sample(smpOcean, oQw * float2(0.07f, 0.045f) + float2(0.27f, 0.81f)).r - 0.5f) * 2.4f;
  }
  if (oCov > 0.002f) {
    // breaking on the crests of the shorter wind waves (bank waves 3–6), grouped on the long-wave
    // crests (Jacobian), broken up by two octaves of fbm
    float c = (1.0f - in.vOAux.y) / max(U.uJStats.x, 0.02f) / max(U.uJStats.y, 0.05f);
    float cs = 0.0f;
    for (int i = 3; i < 7; i++) cs += U.uWaveB[i].w * sin(U.uWaveA[i].z * dot(U.uWaveA[i].xy, oG - uOffset) + U.uWaveB[i].y);
    cs *= U.uJStats.z;                                                                               // → unit variance
    float nz = nzS;
    float z = 0.588f * log((1.0f - oCov) / oCov);                                                    // ≈ Φ⁻¹(1 − coverage)
    oWcRaw = glSmoothstep(z - 0.3f, z + 1.9f, 0.65f * c + 0.5f * cs + 0.4f * nz);
    oWc = oFoamShape(oWcRaw, oFTex, oRag);
    if (kOceanQ > 0) {
      // decaying trails: where the crests broke 1.6 s and 3.2 s ago (the waves moved on, the foam stayed)
      float tr = 0.0f;
      for (int k = 1; k <= 2; k++) {
        float dt = 1.6f * float(k);
        float csp = 0.0f;
        for (int i = 3; i < 7; i++) csp += U.uWaveB[i].w * sin(U.uWaveA[i].z * dot(U.uWaveA[i].xy, oG - uOffset) + U.uWaveB[i].y + 0.9f * sqrt(9.81f * U.uWaveA[i].z) * dt);
        tr = max(tr, glSmoothstep(z - 0.1f, z + 2.2f, 0.65f * c + 0.5f * csp * U.uJStats.z + 0.4f * nz) * (1.0f - 0.36f * float(k)));
      }
      float trail = tr * glSmoothstep(0.42f, 0.78f, oFTex + 0.25f * tr) * 0.6f;
      oWc = max(oWc, trail);
      oWcRaw = max(oWcRaw, tr * 0.5f);
    }
  }

  // 7b streaks along the wind (Beaufort ≥ 7) and 7c Langmuir windrows / foam lines (≈ 30 m)
  float oStreak = 0.0f;
  float oStreakRaw = 0.0f;
  float oLines = 0.0f;
  const bool streakPossible = (U.uSeaA.z + U.uSeaA.w > 0.001f) ||
                              (frontOn && (U.uPrevSea.z + U.uPrevSea.w > 0.001f || U.uNextSea.z + U.uNextSea.w > 0.001f));
  if (streakPossible) {
    float2 qa = oToFrame(oG - oFlow, U.uStreakRot.xy);
    float sa = max(oStreakBands(qa, 9.0f, 0.13f, uAtlas, smpOcean) * 0.7f, oStreakBands(qa, 23.0f, 0.57f, uAtlas, smpOcean) * 0.85f);
    float la = uAtlas.sample(smpOcean, qa * float2(0.0035f, 0.012f)).r;
    if (uStreakMix > 0.001f) {
      float2 qb = oToFrame(oG - oFlow, U.uStreakRot.zw);
      sa = glMix(sa, max(oStreakBands(qb, 9.0f, 0.13f, uAtlas, smpOcean) * 0.7f, oStreakBands(qb, 23.0f, 0.57f, uAtlas, smpOcean) * 0.85f), uStreakMix);
      la = glMix(la, uAtlas.sample(smpOcean, qb * float2(0.0035f, 0.012f)).r, uStreakMix);
      qa = glMix(qa, qb, uStreakMix);
    }
    // streaks are soft wind-combed fbm, not a stretched cell net
    float tS = uAtlas.sample(smpOcean, float2(qa.x * 0.02f, qa.y * 0.16f) + float2(0.71f, 0.37f)).r;
    float lv = qa.y / 30.0f + la * 1.4f;
    float line = 1.0f - glSmoothstep(0.01f, 0.06f, abs(fract(lv) - 0.5f));
    float brk = glSmoothstep(0.35f, 0.65f, uAtlas.sample(smpOcean, qa * float2(0.011f, 0.03f) + 0.5f).r);
    if (cSea.z + cSea.w > 0.001f) {                         // the per-pixel GLSL condition
      oStreakRaw = sa * clamp(cSea.z * (0.45f + 0.75f * oGustV), 0.0f, 1.0f);
      oStreak = oStreakRaw * glSmoothstep(0.3f, 0.75f, 0.55f * tS + 0.45f * oFTex) * 0.6f;
      float lf = line * brk * cSea.w;
      oLines = lf * glSmoothstep(0.25f, 0.7f, 0.5f * tS + 0.5f * oFTex) * 0.55f;
    }
  }

  // 9 downwash: a roughened disc with a broken, irregular foam edge that sheds streaks downwind
  float oDwFoam = 0.0f;
  if (oDwS > 0.001f) {
    float n1 = uAtlas.sample(smpOcean, oDwDir * 0.33f + float2(oT * 0.03f, 0.31f)).r;
    float n2 = uAtlas.sample(smpOcean, oDwDir * 1.3f + float2(0.57f, oT * 0.11f)).r;
    float dwW = dot(oDwDir, oWd) * clamp(U.uSeaE.x / 8.0f, 0.0f, 1.0f);                         // downwind side
    float R = U.uDownwash.z * (1.0f + 0.3f * (n1 - 0.5f) + 0.14f * (n2 - 0.5f) + 0.1f * dwW);
    float wid = glMix(0.5f, 2.5f, uAtlas.sample(smpOcean, oDwDir * 0.8f + float2(0.23f, 0.61f + oT * 0.05f)).r) + 0.06f * R;
    float ringP = exp(-sq((oDwR - R) / wid));
    // radial streaks racing outward break the ring into tufts (seamless: sampled by the unit vector)
    float rs = uAtlas.sample(smpOcean, oDwDir * 0.8f + float2(0.0f, oDwR * 0.03f - oT * 0.18f)).r * 0.55f
             + uAtlas.sample(smpOcean, oDwDir * 2.6f + float2(0.41f, oDwR * 0.09f - oT * 0.5f)).r * 0.3f
             + uAtlas.sample(smpOcean, oDwD * 0.35f + float2(0.77f, -oT * 0.4f)).r * 0.15f;
    float tuft = glSmoothstep(0.36f, 0.64f, rs + 0.25f * (oFTex - 0.5f));
    // streaks shed downwind past the ring
    float shed = glSmoothstep(0.1f, 0.8f, dwW) * glSmoothstep(R * 0.95f, R * 1.15f, oDwR) * exp(-max(oDwR - R, 0.0f) / (0.7f * R + 4.0f));
    oDwFoam = oFoamShape(ringP * (0.35f + 0.65f * tuft) * min(0.85f, oDwS * 1.3f), oFTex, oRag) * 0.75f;
    oDwFoam = max(oDwFoam, shed * glSmoothstep(0.55f, 0.85f, rs) * min(1.0f, oDwS * 1.5f) * 0.45f);
    // "ты низко": a fresh thin white rim, broken into tufts
    float fresh = exp(-sq((oDwR - 0.97f * R) / (0.25f + 0.03f * R))) * glSmoothstep(0.45f, 0.7f, rs);
    oDwFoam = max(oDwFoam, fresh * oLow * 0.85f);
    oDwFoam = max(oDwFoam, oDwIn * 0.22f * glSmoothstep(0.6f, 0.9f, rs) * oCatPaw);
  }
  // residual lace: aged foam, decaying in large irregular patches (after a rogue wave, clearing)
  float oResid = 0.0f;
  if (U.uSeaD.z > 0.001f) {
    float pn = uAtlas.sample(smpOcean, oWp * 0.006f + float2(0.2f, 0.7f)).r * 0.6f + oFb1 * 0.4f;
    oResid = oFoamAged(U.uSeaD.z * glSmoothstep(0.52f, 0.7f, pn), oLaceN, oFTex) * 0.6f;
  }
  float oFoam = max(max(oWc, oStreak), max(oLines, oDwFoam));
  oFoam = max(oFoam, oFoamShape(max(oSplF, oFeatFoam), oFTex, oRag));
  oFoam = max(oFoam, oFoamAged(oFeatAged, oLaceN, oFTex));
  oFoam = max(oFoam, oFeatLine * 0.95f);
  oFoam = max(oFoam, oFoamShape(oSurf, oFTex, oRag));
  oFoam = max(oFoam, oFoamAged(oSurfOld, oLaceN, oFTex));
  oFoam = max(oFoam, oResid);
  if (kOceanMemory) {
    oFoam = max(oFoam, oFoamShape(clamp(oMem.r, 0.0f, 1.0f), oFTex, oRag));
  }
  // 8. downpour: the surface "boils" with pixel-sized splash specks
  if (uRain > 0.85f) {
    float2 bc = oXZ / max(0.25f, oFoot * 2.0f);
    float speck = step(0.992f, hash12(floor(bc) + floor(oT * 18.0f) * 7.31f));
    oFoam = max(oFoam, speck * glSmoothstep(0.85f, 1.0f, uRain) * 0.35f);
  }
  oFoam = clamp(oFoam, 0.0f, 1.0f);
  // 10. oil (NICE): smooth, darker slick with a thin-film rainbow (water memory A)
  float oOil = 0.0f;
  if (kOceanMemory) {
    oOil = glSmoothstep(0.05f, 0.4f, oMem.a) * (1.0f - oFoam);
  }

  // 3. crest SSS, look-driven: backlit crests take the palette crest colour ("bottle green")
  float2 oLh = normalize(U.uSunDirV.xz + float2(1e-4f, 0.0f));
  float oAway = clamp(0.5f - dot(oNm.xz, oLh) * 4.0f, 0.0f, 1.0f);
  float oSssM = glSmoothstep(0.55f, 1.0f, oHc) * (0.08f + 0.92f * oAway * oAway) * U.uSeaB.y;   // back-lit crests only
  oSssM = max(oSssM, oFeatSss);
  oBodyC = glMix(oBodyC, glMix(cCrest, cCrest * 1.6f, oFeatSss), clamp(oSssM, 0.0f, 1.0f) * 0.75f * (1.0f - 0.85f * oNight));
  // aeration halo under and around foam (crest·1.15 at 0.35): turquoise bubbles in the holes of the lace
  float oRaw = max(max(oWcRaw, oStreakRaw * 0.35f), max(max(oSplF, oFeatFoam), oDwFoam));
  float oHalo = glSmoothstep(0.03f, 0.45f, oRaw) * (1.0f - oFoam);
  oBodyC = glMix(oBodyC, cCrest * 1.15f, 0.35f * oHalo);
  oBodyC = glMix(oBodyC, cDeep * 0.6f, oFeatDark * 0.85f);
  oBodyC = glMix(oBodyC, float3(0.0003f, 0.0012f, 0.0018f), oAbyss);   // #010406 abyss

  // ---- 10. dye (fluorescein) from the water memory
  float oDye = 0.0f;
  if (kOceanMemory) {
    if (oMem.g > 0.01f) {
      oDye = glSmoothstep(0.05f, 0.65f, oMem.g + memDyeTurb);              // turbulent, translucent edge
    }
  }

  // ---- albedo: foam is lit like a diffuse surface
  float3 oFoamC = glMix(cFoam, float3(0.888f, 0.955f, 1.0f), clamp(oBeam * 1.3f, 0.0f, 1.0f));   // #F2FAFF in the beam
  float3 oAlb = glMix(oBodyC * (1.0f - 0.35f * oOil), oFoamC, oFoam);
  oAlb = glMix(oAlb, float3(0.028f, 0.807f, 0.195f), oDye * 0.65f * (1.0f - 0.5f * oFoam));
  float3 diffuseColor = oAlb;

  // ---- roughness
  float oRough = (U.uSeaB.x + 0.25f * oGustV + (0.02f + 0.12f * oCatPaw) * oDwIn) * (1.0f - 0.6f * oOil);   // uSeaB.x includes rain
  oRough += 0.12f * glSmoothstep(0.25f, 1.5f, oFoot);
  oRough = clamp(glMix(oRough, 0.9f, oFoam), 0.04f, 1.0f);

  // ---- final normal
  oSd *= (1.0f - 0.3f * oDwIn * (1.0f - oCatPaw)) * (1.0f - 0.5f * oFoam) * (1.0f - 0.7f * oOil);
  float2 oS = oSm + oSd;
  float3 oN = normalize(float3(-oS.x, 1.0f, -oS.y));
  float oNV = clamp(dot(oN, oV), 0.0f, 1.0f);
  float oFres = 0.02f + 0.98f * pow(1.0f - oNV, 5.0f);
  // searchlight pool edge ripples with the waves: facets rising outward face the lamp and catch it
  float oRhoE = max(oRho * (1.0f - 0.22f * clamp(dot(oS, oPoolDir), -0.7f, 0.7f)) - 0.05f * oFoam, 0.0f);

  // ---- 6. cloud shadows (applied to the sun inside the light loop); clearing: running sun patches
  float oCloud = lookCloud(oXZ, L, uAtlas, smpOcean);
  oCloud = glMix(oCloud, 1.0f - oCloud, U.uSeaB.z);
  float oCloudMul = glMix(1.0f, glMix(0.72f, 0.55f, U.uSeaB.z), oCloud * U.uSeaC.y);

  // ---- emissive layers
  float3 oEmis = float3(0.0f);
  // 5. analytic sky reflection (envMapIntensity = 0)
  {
    float3 R = reflect(-oV, oN);
    float ry = max(R.y, 0.0f);
    float3 sky = glMix(U.uFogCol.xyz, U.uSkyCol.xyz * 0.85f, glSmoothstep(0.0f, 0.6f, ry));
    if (U.uSeaC.x > 0.001f) {
      float2 cuv = (oXZ + R.xz / (ry + 0.15f) * 220.0f - uWindOffset * 1.5f) * 0.0016f;
      // broken cloud reflections: soft grey-white patches, not a crisp white crackle net
      float cl = glSmoothstep(0.35f, 0.95f, uAtlas.sample(smpOcean, cuv + float2(0.13f, 0.71f)).r);
      sky = glMix(sky, glMix(U.uFogCol.xyz, float3(1.0f), 0.3f), cl * U.uSeaC.x * 0.8f);
    }
    // swell relief: faces tilted away from the camera see more of the bright sky (grazing)
    float2 vxz = oV.xz / max(length(oV.xz), 1e-3f);
    float awayV = clamp(-dot(oNm.xz, vxz) * 3.0f + 0.5f * (1.0f - oNV), -1.0f, 1.0f);
    float relief = glSmoothstep(1.5f, 5.0f, uHsEff) * (1.0f - 0.7f * oNight);
    oEmis += sky * (oFres * 2.0f + relief * 0.1f * max(awayV, 0.0f)) * (1.0f - oFoam) * (1.0f - 0.5f * uRain);
    // swell mass from above: faces toward the brighter (sun-side) sky lift, lee faces and troughs sink
    float2 skyL = normalize(U.uSunDirS.xz + float2(1e-4f, 0.0f));
    float hill = clamp(dot(oNm.xz, skyL) * 4.0f, -1.0f, 1.0f);
    oAlb *= (1.0f + relief * (0.3f * hill - 0.12f * max(-awayV, 0.0f))) * (1.0f - oFoam) + oFoam;
    diffuseColor = oAlb;
  }
  // 3. crest SSS at night: the searchlight and the flash shine through the crests
  oEmis += glMix(cCrest, cCrest * 1.6f, oFeatSss) * oSssM * (oBeam * 0.3f + U.uSeaE.y * 0.5f) * (1.0f - oFoam);
  // rogue crest edge on transmission by day (#7FE0C8)
  oEmis += float3(0.212f, 0.745f, 0.578f) * oFeatSss * glSmoothstep(0.65f, 1.0f, oH01) * U.uSeaB.w * 0.035f * (1.0f - oNight);
  // 11. searchlight: hot ring at 0.85 R, glitter on lit facets (the pool itself is in the FINAL block)
  if (oBeam + oRing > 0.0f) {
    float3 Ls = normalize(U.uSearchPos.xyz - oP);
    float sp = pow(clamp(dot(oN, normalize(Ls + oV)), 0.0f, 1.0f), 90.0f);
    float nl = clamp(dot(oN, Ls), 0.0f, 1.0f);
    oEmis += float3(1.0f, 0.879f, 0.701f) * (oBeam * (0.9f * sp * (1.0f - oFoam) * (0.4f + 0.6f * nl)) + oRing * 0.025f);
  }
  // 12. light glints (strobes, nav lights, raft lamps): gaussian stretched toward the screen bottom
  if (kOceanGlints > 0) {
    float3 fwd = -float3(F.viewMatrix[0][2], F.viewMatrix[1][2], F.viewMatrix[2][2]);
    float2 toCam = -normalize(fwd.xz + float2(0.0f, 1e-4f));
    float2 side = float2(-toCam.y, toCam.x);
    // a reflection, not a lamp: smaller and dimmer as the camera climbs, broken by the wave facets
    float gH = clamp(70.0f / max(cameraPosition.y, 1.0f), 0.3f, 1.0f);
    float gBrk = 0.2f + 0.8f * glSmoothstep(0.35f, 0.75f, uAtlas.sample(smpOcean, oXZ * 0.37f + float2(oT * 0.05f, 0.13f)).r);
    for (int i = 0; i < kOceanGlints; i++) {
      if (i >= U.uGlintCount) break;
      float4 g = U.uGlints[i];
      float2 d = oXZ - g.xy;
      float rad = g.z * gH;
      float al = dot(d, toCam);
      float la = dot(d, side);
      al /= al > 0.0f ? 3.0f : 1.2f;
      la /= 0.5f;
      float r2 = (al * al + la * la) / max(rad * rad, 0.01f);
      if (r2 > 9.0f) continue;
      float3 Lg = normalize(float3(g.x, 2.0f + g.z, g.y) - oP);
      float sp = pow(clamp(dot(oN, normalize(Lg + oV)), 0.0f, 1.0f), 48.0f);
      oEmis += U.uGlintCol[i].xyz * (g.w * gH * exp(-r2) * (0.06f + 1.3f * sp) * gBrk * (1.0f - 0.6f * oFoam));
    }
  }
  // 13. sun glitter (calm / clearing): cheated light direction so it lands in a top-down frame
  if (kOceanQ > 0) {
    if (U.uSeaC.w > 0.001f) {
      float3 Lg = normalize(U.uSunDirV.xyz + float3(0.0f, U.uSeaD.y, 0.0f));   // lifted toward the zenith
      float ndh = clamp(dot(oN, normalize(Lg + oV)), 0.0f, 1.0f);
      float csz = oFoot * 1.6f;                                // ~1.5 px sparkles at any distance
      float2 sc = floor(oG / csz);
      float tw = floor(oT * 7.0f + hash12(sc) * 7.0f);
      // at night the sparkles crowd into the core of the moon path
      float spT = glMix(0.93f, glMix(0.975f, 0.9f, pow(ndh, U.uSeaD.x * 0.08f)), oNight);
      float sp = step(spT, hash12(sc + tw * 0.173f)) * (1.0f - glSmoothstep(0.15f, 0.5f, length(fract(oG / csz) - 0.5f)));
      float glit = pow(ndh, U.uSeaD.x) * sp;
      // at night a broad soft sheen carries the moon path between the sparkles («Лунная дорожка»)
      float ndhM = clamp(dot(normalize(glMix(oNm, oN, 0.3f)), normalize(Lg + oV)), 0.0f, 1.0f);
      glit += oNight * (0.012f * pow(ndh, U.uSeaD.x * 0.3f) + 0.03f * pow(ndhM, U.uSeaD.x * 0.12f) * glMix(0.4f, 1.0f, oGroup));
      oEmis += U.uSunCol.xyz * U.uSpecCol.xyz * (glit * 9.0f * U.uSeaC.w * (1.0f - min(1.0f, oCloud * U.uSeaC.y * 1.4f)) * (1.0f - oFoam));
    }
    // moonlit night: the swell faces toward the moon catch a little more of the bright sky
    if (oNight > 0.5f && U.uSeaC.w > 0.001f) {
      float2 ml = normalize(U.uSunDirV.xz + float2(1e-4f, 0.0f));
      float mf = glSmoothstep(-0.2f, 1.0f, dot(glMix(oNm.xz, oN.xz, 0.3f), ml) * 5.0f + 0.4f * dot(-oV.xz, ml)) * glMix(0.35f, 1.0f, oGroup);
      oEmis += U.uSkyCol.xyz * mf * U.uSeaC.w * 0.6f * (1.0f - oFoam);         // ≈ +15 % toward the moon
    }
  }
  // 10. bioluminescence in any disturbed water at night; dye glows
  if (U.uSeaD.w > 0.001f) {
    float dist = clamp(max(oMem.b, max(oSplF, oDwFoam) * 0.8f) + oWc * 0.3f, 0.0f, 1.0f);
    float2 bc = oXZ / max(0.2f, oFoot * 2.0f);
    float spark = glSmoothstep(0.955f, 0.995f, hash12(floor(bc) + floor(oT * 9.0f))) * (1.0f - glSmoothstep(0.2f, 0.5f, length(fract(bc) - 0.5f)));
    oEmis += float3(0.0356f, 0.745f, 1.0f) * (dist * (0.05f + 1.6f * spark) * 2.5f * 0.35f * U.uSeaD.w);
  }
  oEmis += float3(0.028f, 0.807f, 0.195f) * oDye * (0.08f * (1.0f - 0.9f * oNight) + 0.35f * oBeam);   // fluoresces in light
  if (oOil > 0.0f) {
    float hue = oMem.a * 1.2f + oNV * 1.6f + memOilTex * 2.5f;
    float3 film = 0.5f + 0.5f * cos(6.2832f * (hue + float3(0.0f, 0.33f, 0.67f)));
    oEmis += film * film * (0.15f * oOil) * (0.06f + 0.25f * U.uSeaB.w * (1.0f - oNight) + 0.5f * oBeam);
  }

  // ================= lights (MeshStandardMaterial, roughness = oRough, metalness 0) =================
  float3 totalEmissiveRadiance = oEmis;                      // emissive = 0 + oEmis
  PhysicalMaterial material = makeStandardMaterial(diffuseColor, 0.0f, oRough, nonPerturbedNormal);
  float3 geometryNormal = oN;                                // world space (three: view space)
  float3 geometryViewDir = oV;                               // = R^T · normalize(vViewPosition)
  float3 geometryPosition = oP;
  ReflectedLight reflectedLight = makeReflectedLight();
  for (int i = 0; i < MD_POINT_LIGHTS; i++) {
    MDPointLight pl = LT.point[i];
    if (pl.color.x + pl.color.y + pl.color.z <= 0.0f) continue;       // unused slot (zero colour)
    IncidentLight directLight = getPointLightInfo(pl, geometryPosition);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  for (int i = 0; i < MD_SPOT_LIGHTS; i++) {
    MDSpotLight sl = LT.spot[i];
    if (sl.color.x + sl.color.y + sl.color.z <= 0.0f) continue;
    IncidentLight directLight = getSpotLightInfo(sl, geometryPosition);
    directLight.color *= uSpotWater;                         // only a share of the physical lamp on the water
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  {
    MDDirLight sunLight = LT.dir;                            // explicit copy: constant → thread
    IncidentLight directLight = getDirectionalLightInfo(sunLight);
    directLight.color *= oCloudMul;                          // layer 6: cloud shadows on the sun only
    // material.js patchLightsBegin: oShadow = (visible && receiveShadow) ? getShadow(…) : 1.0
    oShadow = kOceanShadows ? threeDirShadow(LT, shadowMap, smpShadow, in.vShadowCoord, fragCoordGL(in.position, F.timeRes.zw),
                                             directLight.visible, true)
                            : 1.0f;
    directLight.color *= oShadow;
    oSunSpecular(directLight, geometryNormal, geometryViewDir, material, reflectedLight, U.uLookK.w, dfgLUT, smpClamp);
  }
  // lights_fragment_maps: irradiance = vec3(0.0) — no IBL, no hemisphere/ambient diffuse (look term)
  float3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

  // ================= OCEAN_FRAGMENT_FINAL =================
  {
    // body + foam: palette look × (ambient share + sun share × shadow × cloud × relative N·L)
    float nlRel = clamp(dot(oN, U.uSunDirS.xyz), 0.0f, 1.0f) / max(U.uSunDirS.y, 0.25f);
    float sunK = oShadow * oCloudMul * glMix(1.0f, nlRel, 0.8f);
    // foam targets the low end of the law (≈0.82 on screen) so it never clips and stays under bloom
    float3 look = oInvACES(min(oAlb, float3(0.64f))) * U.uLookK.y;
    outgoingLight += look * ((1.0f - U.uLookK.x) + U.uLookK.x * sunK);
    // 14. lightning: the sea turns silver-blue; the heli's shadow swings toward the strike
    outgoingLight += U.uFlashCol.xyz * (U.uSeaE.y * (0.06f + 0.5f * oFres + 0.35f * oFoam + 0.25f * oSssM)) * glMix(1.0f, oShadow, U.uLookK.z);
    float sh = 1.0f - oShadow;
    // hue of the preset's shadow colour (normalised to its brightest channel, so it only darkens)
    float3 st = U.uShadowTint.xyz;
    float3 tl = st / max(max(st.x, max(st.y, st.z)), 1e-4f);
    float3 tint = glMix(float3(1.0f), tl, 0.5f);
    outgoingLight *= glMix(float3(1.0f), tint, clamp(sh * 1.3f, 0.0f, 1.0f));
    // lightning: cancel most of the flash exposure boost inside the swung strike shadow
    float flashSh = sh * glSmoothstep(0.05f, 0.35f, U.uSeaE.y) * U.uLookK.z;
    outgoingLight *= glMix(1.0f, 1.0f / (1.0f + 2.4f * U.uSeaE.y), flashSh);
    // 11. searchlight pool, look-driven: "the lamp opens the sea" (display-space radial profile)
    if (oPoolK > 0.001f && oRhoE < 1.0f) {
      float3 Lp = normalize(U.uSearchPos.xyz - oP);
      float nlp = clamp(dot(oN, Lp), 0.0f, 1.0f);
      float nhp = clamp(dot(oN, normalize(Lp + oV)), 0.0f, 1.0f);
      float facet = 0.62f + 0.75f * pow(nhp, 12.0f);                   // wave facets catch the lamp
      float3 litWater = float3(0.78f, 0.92f, 0.86f) * (0.66f + 0.42f * nlp) * (0.8f + 0.4f * oH01) * facet;
      litWater = litWater / (1.0f + 0.25f * max(litWater - 0.6f, float3(0.0f)));   // soft knee instead of a flat clip
      // a real beam profile: no plateau — brightest in the middle, falling smoothly all the way out
      float pr = exp(-2.2f * oRhoE * oRhoE) * (1.0f - glSmoothstep(0.6f, 1.1f, oRhoE));
      float hot = exp(-sq(oRhoE / 0.3f));
      float3 poolDisp = glMix(min(litWater, float3(0.88f)), min(oFoamC * 0.92f, float3(0.86f)), oFoam) * float3(1.0f, 0.97f, 0.9f);
      poolDisp *= pr * (0.9f + 0.12f * hot);
      float3 poolLook = oInvACES(poolDisp) * U.uLookK.y;
      // by day the pool only lifts the water a little (it never fights the sun)
      outgoingLight = glMix(outgoingLight, max(outgoingLight, poolLook), clamp(oPoolK, 0.0f, 1.0f) * glMix(0.1f, 1.0f, glSmoothstep(0.0f, 0.7f, U.uSeaE.z)));
    }
    float hr = length(oXZ - U.uHeliP.xy);
    float alt = max(U.uHeliP.z, 0.0f);
    float patchK = exp(-sq(hr / (3.5f + 0.25f * alt))) * glMix(0.55f, 0.15f, clamp(alt / 60.0f, 0.0f, 1.0f))
                 * (1.0f - 0.6f * U.uSeaC.z) * U.uHeliP.w;
    outgoingLight *= 1.0f - patchK;
  }

  // opaque_fragment → (no tone mapping, linear output) → fog_fragment
  float3 color = applyFog(outgoingLight, in.vFogOff, F);
  return float4(color, 1.0f);
}
