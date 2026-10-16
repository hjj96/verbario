// WaterMemory.metal — port: rescue/src/systems/ocean/memory.js (ADVECT_VS/FS, STAMP_VS/FS) (PLAN §3.3 #3, #4).
// "Water memory": a 320 m window of the sea around the camera focus in a HalfFloat ping-pong pair.
// Channels: R foam (half-life 3 s), G dye (240 s, light diffusion), B disturbance (0.8 s), A oil (600 s).
// Pass 1 advects the previous frame (wind drift 3 %, swirl of the ocean features, whole-texel re-centre,
// per-channel decay); pass 2 adds instanced stamps (One/One additive): discs, rings, Kelvin wakes.
//
// Data pass (PLAN §2.5 «Конвенции координат»): the texture keeps GL row order (row 0 = vUv.y 0 = the
// window's −Z edge) so the ocean reads it with GL uv directly; both vertex shaders therefore flip clip y.
// That also mirrors the stamp quads' winding: the pipeline draws them without culling (in GL they are
// front-facing ShaderMaterial quads, i.e. always drawn).
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "OceanFeatures.h"

struct MemoryAdvectVaryings {
  float4 position [[position]];
  float2 vUv;
};

vertex MemoryAdvectVaryings memory_advect_vs(uint vid [[vertex_id]]) {
  // one oversized triangle: vUv (0,0) (2,0) (0,2) → GL clip (−1,−1) (3,−1) (−1,3), y flipped for Metal rows
  float x = float((vid << 1) & 2u);
  float y = float(vid & 2u);
  MemoryAdvectVaryings o;
  o.vUv = float2(x, y);
  o.position = float4(x * 2.0f - 1.0f, -(y * 2.0f - 1.0f), 0.0f, 1.0f);
  return o;
}

fragment float4 memory_advect_fs(MemoryAdvectVaryings in [[stage_in]],
                                 constant MDMemoryAdvectUniforms& M [[buffer(MD_BUF_PASS)]],
                                 constant MDOceanUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                                 texture2d<float> uPrev [[texture(MD_TEX_SOURCE)]],
                                 sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  const float2 uShift = M.shiftCenter.xy;
  const float2 uCenter = M.shiftCenter.zw;
  const float uExtent = M.extentDtWind.x;
  const float uDt = M.extentDtWind.y;
  const float2 uWindV = M.extentDtWind.zw;
  const float4 uDecay = M.uDecay;
  const float2 uTexel = M.texelDiffuse.xy;
  const float uDiffuse = M.texelDiffuse.z;
  const float2 vUv = in.vUv;
  float2 world = uCenter + (vUv - 0.5f) * uExtent;
  float2 vel = 0.03f * uWindV + oceanFeatureFlow(world, U);
  float2 src = vUv + uShift - vel * (uDt / uExtent);
  float4 c = uPrev.sample(smpClamp, src, level(0.0f));
  float n = uPrev.sample(smpClamp, src + float2(uTexel.x, 0.0f), level(0.0f)).g + uPrev.sample(smpClamp, src - float2(uTexel.x, 0.0f), level(0.0f)).g
          + uPrev.sample(smpClamp, src + float2(0.0f, uTexel.y), level(0.0f)).g + uPrev.sample(smpClamp, src - float2(0.0f, uTexel.y), level(0.0f)).g;
  c.g = glMix(c.g, n * 0.25f, uDiffuse);
  float2 inside = step(float2(0.0f), src) * step(src, float2(1.0f));
  return max(c * uDecay * (inside.x * inside.y), float4(0.0f));
}

struct MemoryStampVaryings {
  float4 position [[position]];
  float2 vQ;
  float4 vB;
  float4 vC;
  float vS;
  float2 vSeed;
};

// PlaneGeometry(2, 2) as two triangles (three's index order 0 2 1, 2 3 1 over the 2×2 vertex grid).
constant float2 kStampQuad[6] = { float2(-1.0f, 1.0f), float2(-1.0f, -1.0f), float2(1.0f, 1.0f),
                                  float2(-1.0f, -1.0f), float2(1.0f, -1.0f), float2(1.0f, 1.0f) };

vertex MemoryStampVaryings memory_stamp_vs(uint vid [[vertex_id]], uint iid [[instance_id]],
                                           const device MDMemoryStamp* stamps [[buffer(MD_BUF_INSTANCES)]],
                                           constant MDMemoryAdvectUniforms& M [[buffer(MD_BUF_PASS)]]) {
  MDMemoryStamp s = stamps[iid];
  const float2 uCenter = M.shiftCenter.zw;
  const float uExtent = M.extentDtWind.x;
  float2 position = kStampQuad[vid];
  MemoryStampVaryings o;
  o.vQ = position;
  o.vSeed = fract(s.aA.xy * 0.0137f) * 97.0f;
  o.vB = s.aB;
  o.vC = s.aC;
  o.vS = s.aA.w;
  float2 world = s.aA.xy + position * s.aA.z;
  float2 clip = (world - uCenter) / (0.5f * uExtent);
  o.position = float4(clip.x, -clip.y, 0.0f, 1.0f);
  return o;
}

inline float sHash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

inline float sNoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0f - 2.0f * f);
  return glMix(glMix(sHash(i), sHash(i + float2(1.0f, 0.0f)), u.x),
               glMix(sHash(i + float2(0.0f, 1.0f)), sHash(i + float2(1.0f, 1.0f)), u.x), u.y);
}

fragment float4 memory_stamp_fs(MemoryStampVaryings in [[stage_in]]) {
  const float2 vQ = in.vQ;
  const float4 vC = in.vC;
  const float2 vSeed = in.vSeed;
  // irregular outlines: the radius wobbles with value noise seeded by the stamp position
  float r = length(vQ) + (sNoise(vQ * 3.0f + vSeed) - 0.5f) * 0.35f + (sNoise(vQ * 7.0f + vSeed.yx) - 0.5f) * 0.12f;
  float shape;
  if (vC.x < 0.5f) {
    shape = 1.0f - glSmoothstep(0.35f, 1.0f, r);
  } else if (vC.x < 1.5f) {
    shape = exp(-sq((r - vC.y) / 0.13f)) * (1.0f - glSmoothstep(0.92f, 1.0f, r));   // pow(x, 2.0) → sq (W7)
  } else {
    // Kelvin wake: V arms at 19.47° behind the mover plus a turbulent centre line
    float2 dir = vC.zw;
    float along = -dot(vQ, dir);
    float lat = dot(vQ, float2(-dir.y, dir.x));
    float arm = exp(-sq((abs(lat) - along * 0.3535f) / 0.08f));
    float core = exp(-sq(lat / 0.06f)) * 0.45f;
    shape = max(arm, core) * step(0.0f, along) * (1.0f - glSmoothstep(0.55f, 1.0f, along));
  }
  return in.vB * (in.vS * shape);
}
