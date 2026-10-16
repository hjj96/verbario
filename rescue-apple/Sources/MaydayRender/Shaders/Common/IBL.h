// IBL.h — image-based lighting from the PMREM cube-UV atlas (PLAN §2.5 «IBL», D9):
//   three r185 cube_uv_reflection_fragment (getFace, getUV, bilinearCubeUV, roughnessToMip,
//   textureCubeUV) and envmap_physical_pars_fragment (getIBLIrradiance, getIBLRadiance).
// The atlas is baked by Lighting/EnvironmentProbe.swift (Shaders/Lighting/EnvSky.metal +
// Prefilter.metal, a port of PMREMGenerator.fromScene(weather/env.js sky, 0, 0.1, 50, { size: 128 })),
// so CUBEUV_TEXEL_WIDTH / HEIGHT / MAX_MIP are the fixed constants of that size (ShaderTypes.h).
//
// Conventions:
//   * the atlas keeps GL row order (row 0 = v 0): the uv maths below is three's, unchanged;
//   * three's bilinearCubeUV reads with texture2DGradEXT(…, 0, 0) (WebGL2) = level 0, so every read
//     here is an explicit level(0) sample — legal in any control flow;
//   * lighting runs in WORLD space (ThreePBR.h): three transforms its view-space normal / reflection
//     vector back to world space before the lookup (transformDirectionByInverseViewMatrix), so the
//     world-space vectors go in directly. envMapRotation is the identity for scene.environment
//     (WebGLMaterials: Euler(0,0,0) with the x/y/z sign flips → identity).
//   * envMapIntensity: a MeshStandardMaterial without its own envMap takes scene.environmentIntensity
//     (WebGLRenderer.setProgram) = MDLightsUniforms.ambientEnv.w.
#ifndef MAYDAY_IBL_H
#define MAYDAY_IBL_H

#include "Common.h"
#include "../ShaderTypes.h"

#define MD_CUBEUV_TEXEL_WIDTH (1.0f / float(MD_CUBEUV_WIDTH))
#define MD_CUBEUV_TEXEL_HEIGHT (1.0f / float(MD_CUBEUV_HEIGHT))
#define MD_CUBEUV_MAX_MIP_F float(MD_CUBEUV_MAX_MIP)
#define cubeUV_minMipLevel 4.0f
#define cubeUV_minTileSize 16.0f

inline float cubeUVGetFace(float3 direction) {
  float3 absDirection = abs(direction);
  float face = -1.0f;
  if (absDirection.x > absDirection.z) {
    if (absDirection.x > absDirection.y)
      face = direction.x > 0.0f ? 0.0f : 3.0f;
    else
      face = direction.y > 0.0f ? 1.0f : 4.0f;
  } else {
    if (absDirection.z > absDirection.y)
      face = direction.z > 0.0f ? 2.0f : 5.0f;
    else
      face = direction.y > 0.0f ? 1.0f : 4.0f;
  }
  return face;
}

inline float2 cubeUVGetUV(float3 direction, float face) {
  float2 uv;
  if (face == 0.0f) {
    uv = float2(direction.z, direction.y) / abs(direction.x);
  } else if (face == 1.0f) {
    uv = float2(-direction.x, -direction.z) / abs(direction.y);
  } else if (face == 2.0f) {
    uv = float2(-direction.x, direction.y) / abs(direction.z);
  } else if (face == 3.0f) {
    uv = float2(-direction.z, direction.y) / abs(direction.x);
  } else if (face == 4.0f) {
    uv = float2(-direction.x, direction.z) / abs(direction.y);
  } else {
    uv = float2(direction.x, direction.y) / abs(direction.z);
  }
  return 0.5f * (uv + 1.0f);
}

// envMap: the cube-UV atlas; smp: linear filter, clamp to edge (three's render-target texture).
inline float3 bilinearCubeUV(texture2d<float> envMap, sampler smp, float3 direction, float mipInt) {
  float face = cubeUVGetFace(direction);
  float filterInt = max(cubeUV_minMipLevel - mipInt, 0.0f);
  mipInt = max(mipInt, cubeUV_minMipLevel);
  float faceSize = exp2(mipInt);
  float2 uv = cubeUVGetUV(direction, face) * (faceSize - 2.0f) + 1.0f;
  if (face > 2.0f) {
    uv.y += faceSize;
    face -= 3.0f;
  }
  uv.x += face * faceSize;
  uv.x += filterInt * 3.0f * cubeUV_minTileSize;
  uv.y += 4.0f * (exp2(MD_CUBEUV_MAX_MIP_F) - faceSize);
  uv.x *= MD_CUBEUV_TEXEL_WIDTH;
  uv.y *= MD_CUBEUV_TEXEL_HEIGHT;
  return envMap.sample(smp, uv, level(0.0f)).rgb;
}

#define cubeUV_r0 1.0f
#define cubeUV_m0 -2.0f
#define cubeUV_r1 0.8f
#define cubeUV_m1 -1.0f
#define cubeUV_r4 0.4f
#define cubeUV_m4 2.0f
#define cubeUV_r5 0.305f
#define cubeUV_m5 3.0f
#define cubeUV_r6 0.21f
#define cubeUV_m6 4.0f

inline float roughnessToMip(float roughness) {
  float mip = 0.0f;
  if (roughness >= cubeUV_r1) {
    mip = (cubeUV_r0 - roughness) * (cubeUV_m1 - cubeUV_m0) / (cubeUV_r0 - cubeUV_r1) + cubeUV_m0;
  } else if (roughness >= cubeUV_r4) {
    mip = (cubeUV_r1 - roughness) * (cubeUV_m4 - cubeUV_m1) / (cubeUV_r1 - cubeUV_r4) + cubeUV_m1;
  } else if (roughness >= cubeUV_r5) {
    mip = (cubeUV_r4 - roughness) * (cubeUV_m5 - cubeUV_m4) / (cubeUV_r4 - cubeUV_r5) + cubeUV_m4;
  } else if (roughness >= cubeUV_r6) {
    mip = (cubeUV_r5 - roughness) * (cubeUV_m6 - cubeUV_m5) / (cubeUV_r5 - cubeUV_r6) + cubeUV_m5;
  } else {
    mip = -2.0f * log2(1.16f * roughness);
  }
  return mip;
}

inline float4 textureCubeUV(texture2d<float> envMap, sampler smp, float3 sampleDir, float roughness) {
  float mip = clamp(roughnessToMip(roughness), cubeUV_m0, MD_CUBEUV_MAX_MIP_F);
  float mipF = fract(mip);
  float mipInt = floor(mip);
  float3 color0 = bilinearCubeUV(envMap, smp, sampleDir, mipInt);
  if (mipF == 0.0f) {
    return float4(color0, 1.0f);
  } else {
    float3 color1 = bilinearCubeUV(envMap, smp, sampleDir, mipInt + 1.0f);
    return float4(glMix(color0, color1, mipF), 1.0f);
  }
}

// ---- envmap_physical_pars_fragment (ENVMAP_TYPE_CUBE_UV), world space ----------------------------------
inline float3 getIBLIrradiance(float3 worldNormal, texture2d<float> envMap, sampler smp, float envMapIntensity) {
  float4 envMapColor = textureCubeUV(envMap, smp, worldNormal, 1.0f);
  return MD_PI * envMapColor.rgb * envMapIntensity;
}

inline float3 getIBLRadiance(float3 viewDir, float3 normal, float roughness, texture2d<float> envMap, sampler smp,
                             float envMapIntensity) {
  float3 reflectVec = reflect(-viewDir, normal);
  reflectVec = normalize(glMix(reflectVec, normal, pow4(roughness)));
  float4 envMapColor = textureCubeUV(envMap, smp, reflectVec, roughness);
  return envMapColor.rgb * envMapIntensity;
}

#endif // MAYDAY_IBL_H
