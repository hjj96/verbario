// ACES.h — three.js r185 tonemapping_pars_fragment (ACESFilmicToneMapping, Stephen Hill's fit) and
// colorspace_pars_fragment (sRGB transfer), used by the merged Composite+Output pass (PLAN D10, X4).
#ifndef MAYDAY_ACES_H
#define MAYDAY_ACES_H

#include "Common.h"

inline float3 RRTAndODTFit(float3 v) {
  float3 a = v * (v + 0.0245786f) - 0.000090537f;
  float3 b = v * (0.983729f * v + 0.4329510f) + 0.238081f;
  return a / b;
}

// three r185: color *= toneMappingExposure / 0.6; input matrix → RRT/ODT fit → output matrix; saturate.
inline float3 ACESFilmicToneMapping(float3 color, float toneMappingExposure) {
  const float3x3 ACESInputMat = float3x3(float3(0.59719f, 0.07600f, 0.02840f),
                                         float3(0.35458f, 0.90834f, 0.13383f),
                                         float3(0.04823f, 0.01566f, 0.83777f));
  const float3x3 ACESOutputMat = float3x3(float3(1.60475f, -0.10208f, -0.00327f),
                                          float3(-0.53108f, 1.10813f, -0.07276f),
                                          float3(-0.07367f, -0.00605f, 1.07602f));
  color *= toneMappingExposure / 0.6f;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return saturate3(color);
}

// sRGBTransferOETF: mix(pow(c, 0.41666)·1.055 − 0.055, c·12.92, c ≤ 0.0031308).
inline float3 sRGBTransferOETF(float3 value) {
  float3 hi = pow(max(value, float3(0.0f)), float3(0.41666f)) * 1.055f - float3(0.055f);
  float3 lo = value * 12.92f;
  return select(hi, lo, value <= float3(0.0031308f));
}

inline float3 sRGBTransferEOTF(float3 value) {
  float3 hi = pow(value * 0.9478672986f + float3(0.0521327014f), float3(2.4f));
  float3 lo = value * 0.0773993808f;
  return select(hi, lo, value <= float3(0.04045f));
}

#endif // MAYDAY_ACES_H
