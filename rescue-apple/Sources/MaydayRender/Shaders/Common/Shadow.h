// Shadow.h — port of three r185 directional shadow mapping with renderer.shadowMap.type = PCFShadowMap
// (main.js; PCFSoft is deprecated in r185): shadowmap_pars_vertex / shadowmap_vertex (shadow coordinate
// with normal bias) and shadowmap_pars_fragment (getShadow: 5 Vogel-disk taps of a hardware-compare
// sampler, rotated per pixel by interleaved gradient noise). Sun settings: weather/lights.js
// (bias −0.0004, normalBias 0.6, radius lerped per preset); MDLightsUniforms carries them.
//
// Not included by any family yet: the shadow pass lands in M2 (FramePass.shadow) and the receivers
// (ocean `oShadow`, props, terrain) switch on with the MD_FC_SHADOWS function constant.
//
// Conventions (PLAN §2.5 «Тени», «Конвенции координат») — the CPU builds
//   MDLightsUniforms.shadowMatrix = B · lightProjMetal · lightView
// where lightProjMetal = glToMetal × three's orthographic shadow camera projection (Metal clip z ∈ [0, 1],
// which equals three's 0.5·z + 0.5 after its bias matrix, so shadowBias keeps its units) and
//   B = [0.5 0 0 0.5; 0 −0.5 0 0.5; 0 0 1 0; 0 0 0 1]   (row-major notation)
// maps clip xy to METAL texture coordinates (v down, row 0 = top of the shadow map). three's B has +0.5 on
// y because GL textures start at the bottom row; the flip keeps the same texel under the same world point.
// The depth target stores Metal depth = three's depth, so the comparison is unchanged:
//   three  texture(sampler2DShadow, vec3(uv, z))  = z ≤ stored ? 1 : 0   (LessEqualCompare, LinearFilter)
//   Metal  sample_compare(shadowSmp, uv, z)       with MTLSamplerDescriptor.compareFunction = .lessEqual,
//          min/mag filter .linear (2×2 hardware PCF like WebGL), address .clampToEdge — sampler slot
//          MD_SMP_SHADOW. Taps use level(0) (no mips; legal in the non-uniform frustum branch).
#ifndef MAYDAY_SHADOW_H
#define MAYDAY_SHADOW_H

#include "Common.h"
#include "../ShaderTypes.h"

#define MD_PI2 6.283185307179586f

// ---- vertex: shadowmap_vertex (directional light, USE_SHADOWMAP) ---------------------------------------
// three: shadowWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix) — i.e. the
// normalised WORLD normal; shadowWorldPosition = worldPosition + vec4(shadowWorldNormal · normalBias, 0).
inline float4 threeDirShadowCoord(float4 worldPosition, float3 worldNormal, constant MDLightsUniforms& LT) {
  float3 shadowWorldNormal = normalize(worldNormal);
  float4 shadowWorldPosition = worldPosition + float4(shadowWorldNormal * LT.shadowParams.y, 0.0f);
  return LT.shadowMatrix * shadowWorldPosition;
}

// ---- fragment: shadowmap_pars_fragment (SHADOWMAP_TYPE_PCF) -----------------------------------------------
inline float interleavedGradientNoise(float2 position) {
  return fract(52.9829189f * fract(dot(position, float2(0.06711056f, 0.00583715f))));
}

inline float2 vogelDiskSample(int sampleIndex, int samplesCount, float phi) {
  const float goldenAngle = 2.399963229728653f;
  float r = sqrt((float(sampleIndex) + 0.5f) / float(samplesCount));
  float theta = float(sampleIndex) * goldenAngle + phi;
  return float2(cos(theta), sin(theta)) * r;
}

// getShadow(shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord).
// fragCoordGLxy: gl_FragCoord.xy (fragCoordGL() in GL.h) so the noise rotation matches the web per pixel.
inline float getShadow(depth2d<float> shadowMap, sampler shadowSmp, float2 shadowMapSize, float shadowIntensity,
                       float shadowBias, float shadowRadius, float4 shadowCoord, float2 fragCoordGLxy) {
  float shadow = 1.0f;
  float3 sc = shadowCoord.xyz / shadowCoord.w;
  sc.z += shadowBias;
  bool inFrustum = sc.x >= 0.0f && sc.x <= 1.0f && sc.y >= 0.0f && sc.y <= 1.0f;
  bool frustumTest = inFrustum && sc.z <= 1.0f;
  if (frustumTest) {
    float2 texelSize = float2(1.0f) / shadowMapSize;
    float radius = shadowRadius * texelSize.x;
    float phi = interleavedGradientNoise(fragCoordGLxy) * MD_PI2;
    shadow = (shadowMap.sample_compare(shadowSmp, sc.xy + vogelDiskSample(0, 5, phi) * radius, sc.z, level(0.0f)) +
              shadowMap.sample_compare(shadowSmp, sc.xy + vogelDiskSample(1, 5, phi) * radius, sc.z, level(0.0f)) +
              shadowMap.sample_compare(shadowSmp, sc.xy + vogelDiskSample(2, 5, phi) * radius, sc.z, level(0.0f)) +
              shadowMap.sample_compare(shadowSmp, sc.xy + vogelDiskSample(3, 5, phi) * radius, sc.z, level(0.0f)) +
              shadowMap.sample_compare(shadowSmp, sc.xy + vogelDiskSample(4, 5, phi) * radius, sc.z, level(0.0f))) * 0.2f;
  }
  return glMix(1.0f, shadow, shadowIntensity);
}

// lights_fragment_begin, directional light i = 0:
//   directLight.color *= (directLight.visible && receiveShadow) ? getShadow(…) : 1.0
// MDLightsUniforms: shadowParams = (bias, normalBias, radius, intensity), shadowMapSize = (w, h, enabled, 0).
inline float threeDirShadow(constant MDLightsUniforms& LT, depth2d<float> shadowMap, sampler shadowSmp,
                            float4 shadowCoord, float2 fragCoordGLxy, bool visible, bool receiveShadow) {
  if (!(visible && receiveShadow) || LT.shadowMapSize.z < 0.5f) return 1.0f;
  return getShadow(shadowMap, shadowSmp, LT.shadowMapSize.xy, LT.shadowParams.w, LT.shadowParams.x,
                   LT.shadowParams.z, shadowCoord, fragCoordGLxy);
}

#endif // MAYDAY_SHADOW_H
