// Prefilter.metal — port of three r185 PMREMGenerator._applyGGXFilter (material
// "PMREMGGXConvolution", GGX_SAMPLES 256, Heitz 2018 VNDF importance sampling) (PLAN §3.3 #6).
// For lod i = 1 … 9 three renders two passes over the lod's 3f × 2f viewport:
//   1. envMap = cube-UV atlas, roughness = √(l² − c²)·1.25·l (l = i/9, c = (i−1)/9), mipInt = 7 − (i−1)
//      → ping-pong target;
//   2. envMap = ping-pong, roughness = 0 (the shader's direct bilinearCubeUV branch), mipInt = 7 − i
//      → back into the atlas at the same viewport.
// Each lod quad maps a face's f pixels onto uv −1/(f−2) … 1 + 1/(f−2) (a one-texel border that
// bilinearCubeUV reads across face seams), i.e. pixel k → uv = (k − ½)/(f − 2). The varying
// vOutputDirection = getDirection(uv, face) is linear in uv inside a face, so per-texel evaluation equals
// the rasterised interpolation. One thread per texel of the lod block; rows in GL order like the atlas.
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "../Common/IBL.h"
#include "CubeUV.h"

#define PMREM_PI 3.14159265359f
#define GGX_SAMPLES 256u

// Van der Corput radical inverse
inline float radicalInverse_VdC(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10f;   // / 0x100000000
}

// Hammersley sequence
inline float2 hammersley(uint i, uint N) {
  return float2(float(i) / float(N), radicalInverse_VdC(i));
}

// GGX VNDF importance sampling (Eric Heitz 2018, "Sampling the GGX Distribution of Visible Normals")
inline float3 importanceSampleGGX_VNDF(float2 Xi, float3 V, float roughness) {
  float alpha = roughness * roughness;
  // Section 4.1: orthonormal basis
  float3 T1 = float3(1.0f, 0.0f, 0.0f);
  float3 T2 = cross(V, T1);
  // Section 4.2: parameterization of the projected area
  float r = sqrt(Xi.x);
  float phi = 2.0f * PMREM_PI * Xi.y;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5f * (1.0f + V.z);
  t2 = (1.0f - s) * sqrt(1.0f - t1 * t1) + s * t2;
  // Section 4.3: reprojection onto the hemisphere
  float3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0f, 1.0f - t1 * t1 - t2 * t2)) * V;
  // Section 3.4: transform back to the ellipsoid configuration
  return normalize(float3(alpha * Nh.x, alpha * Nh.y, max(0.0f, Nh.z)));
}

inline float3 pmremGGX(float3 vOutputDirection, float roughness, float mipInt, texture2d<float> envMap, sampler smp) {
  float3 N = normalize(vOutputDirection);
  float3 V = N;   // view direction = normal for pre-filtering
  float3 prefilteredColor = float3(0.0f);
  float totalWeight = 0.0f;
  // for very low roughness, sample the environment directly
  if (roughness < 0.001f) {
    return bilinearCubeUV(envMap, smp, N, mipInt);
  }
  // tangent-space basis for VNDF sampling
  float3 up = abs(N.z) < 0.999f ? float3(0.0f, 0.0f, 1.0f) : float3(1.0f, 0.0f, 0.0f);
  float3 tangent = normalize(cross(up, N));
  float3 bitangent = cross(N, tangent);
  for (uint i = 0u; i < GGX_SAMPLES; i++) {
    float2 Xi = hammersley(i, GGX_SAMPLES);
    // V = N, so in tangent space V is always (0, 0, 1)
    float3 H_tangent = importanceSampleGGX_VNDF(Xi, float3(0.0f, 0.0f, 1.0f), roughness);
    float3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
    float3 L = normalize(2.0f * dot(V, H) * H - V);
    float NdotL = max(dot(N, L), 0.0f);
    if (NdotL > 0.0f) {
      // fixed source mip; the VNDF distribution does the filtering (split-sum weight N·L)
      float3 sampleColor = bilinearCubeUV(envMap, smp, L, mipInt);
      prefilteredColor += sampleColor * NdotL;
      totalWeight += NdotL;
    }
  }
  if (totalWeight > 0.0f) {
    prefilteredColor = prefilteredColor / totalWeight;
  }
  return prefilteredColor;
}

// grid = (3f, 2f) of the target lod; region = (x0, y0, f) in atlas texels (GL rows).
kernel void pmrem_ggx_kernel(texture2d<float> envMap [[texture(MD_TEX_SOURCE)]],
                             texture2d<float, access::write> target [[texture(MD_TEX_OUTPUT)]],
                             constant MDPmremUniforms& U [[buffer(MD_BUF_PASS)]],
                             sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                             uint2 gid [[thread_position_in_grid]]) {
  const uint f = uint(U.region.z);
  if (gid.x >= 3u * f || gid.y >= 2u * f) return;
  PmremTexel t = pmremTexel(gid, f);
  float2 uv = (float2(t.pixel) - 0.5f) / (float(f) - 2.0f);
  float3 c = pmremGGX(pmremGetDirection(uv, t.face), U.params.x, U.params.y, envMap, smpClamp);
  target.write(float4(c, 1.0f), uint2(uint(U.region.x), uint(U.region.y)) + gid);
}
