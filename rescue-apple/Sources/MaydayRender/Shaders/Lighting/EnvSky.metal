// EnvSky.metal — port: rescue/src/systems/weather/env.js (VERT/FRAG of the PMREM source sky) rendered
// the way three r185 PMREMGenerator._sceneToCubeUV does it (PLAN §3.3 #6):
//   six 90° cube-camera renders (fov 90, aspect 1, near 0.1, far 50) of a BackSide sphere (r 10) into
//   viewports (face % 3 · 128, face > 2 ? 128 : 0, 128, 128) of the HalfFloat cube-UV target.
// The sphere's vDir = normalize(position) interpolates perspective-correctly to the point the view ray
// hits on the flat triangle, whose normalisation is the ray direction itself: the kernel evaluates the
// FRAG at the exact ray through each texel centre (no tessellation to reproduce). Tone mapping is off
// during the bake (renderer.toneMapping = NoToneMapping) and the ShaderMaterial writes linear radiance.
//
// One thread per lod-0 texel: grid 384 × 256, row y = GL row (atlas rows are stored in GL order).
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "CubeUV.h"

inline float envBlob(float3 d, float3 c, float r) {
  return glSmoothstep(r, r * 0.35f, acos(clamp(dot(d, normalize(c)), -1.0f, 1.0f)));
}

// weather/env.js FRAG for the view direction d (normalised).
inline float3 envSkyColor(float3 d, constant MDEnvSkyUniforms& U) {
  const float3 uSky = U.uSky.xyz;
  const float3 uFog = U.uFog.xyz;
  const float3 uDeep = U.uDeep.xyz;
  const float3 uSunDir = U.uSunDir.xyz;
  const float uSunI = U.uSunDir.w;
  const float3 uSunColor = U.uSunColor.xyz;
  const float uCloud = U.uSunColor.w;
  float3 col;
  if (d.y >= 0.0f) col = glMix(uFog, uSky, glSmoothstep(0.0f, 0.6f, d.y));
  else col = glMix(uFog, uDeep * 0.5f, glSmoothstep(0.0f, 0.3f, -d.y));
  // three soft clouds, lit from the sun side
  float cl = max(envBlob(d, float3(0.6f, 0.45f, -0.5f), 0.55f),
                 max(envBlob(d, float3(-0.7f, 0.35f, -0.2f), 0.45f), envBlob(d, float3(0.1f, 0.7f, 0.6f), 0.5f)));
  float3 cloudCol = glMix(uFog, float3(dot(uSky, float3(0.3333f))) * 1.15f, 0.5f) + uSunColor * uSunI * 0.04f;
  col = glMix(col, cloudCol, cl * uCloud);
  // sun disc + glow (HDR)
  float s = max(dot(d, normalize(uSunDir)), 0.0f);
  col += uSunColor * uSunI * (pow(s, 900.0f) * 24.0f + pow(s, 14.0f) * 0.18f);
  return col;
}

kernel void env_sky_kernel(texture2d<float, access::write> atlas [[texture(MD_TEX_OUTPUT)]],
                           constant MDEnvSkyUniforms& U [[buffer(MD_BUF_PASS)]],
                           uint2 gid [[thread_position_in_grid]]) {
  const uint size = uint(MD_CUBEUV_SIZE);
  if (gid.x >= 3u * size || gid.y >= 2u * size) return;
  PmremTexel t = pmremTexel(gid, size);
  // texel centre of the face render → camera NDC → the face uv of the same ray (getUV ∘ camera)
  float2 uv = (float2(t.pixel) + 0.5f) / float(size);
  float3 d = normalize(pmremGetDirection(uv, t.face));
  atlas.write(float4(envSkyColor(d, U), 1.0f), gid);
}
