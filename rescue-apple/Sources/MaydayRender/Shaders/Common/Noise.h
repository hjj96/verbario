// Noise.h — port: rescue/src/core/math.js GLSL_NOISE (hash12, hash22, vnoise, fbm).
// Dave Hoskins' hashes, float32 like WebGL highp. Must stay bit-for-bit the same expression order.
#ifndef MAYDAY_NOISE_H
#define MAYDAY_NOISE_H

#include "GL.h"

inline float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

inline float2 hash22(float2 p) {
  float3 p3 = fract(float3(p.xyx) * float3(0.1031f, 0.1030f, 0.0973f));
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.xx + p3.yz) * p3.zy);
}

inline float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0f - 2.0f * f);
  return glMix(glMix(hash12(i), hash12(i + float2(1.0f, 0.0f)), u.x),
               glMix(hash12(i + float2(0.0f, 1.0f)), hash12(i + float2(1.0f, 1.0f)), u.x), u.y);
}

inline float fbm(float2 p) {
  float s = 0.0f;
  float a = 0.5f;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03f + float2(17.1f, 9.2f);
    a *= 0.5f;
  }
  return s;
}

#endif // MAYDAY_NOISE_H
