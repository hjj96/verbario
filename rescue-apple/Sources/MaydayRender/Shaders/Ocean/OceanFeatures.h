// OceanFeatures.h — port: rescue/src/systems/ocean/features.js FEATURES_GLSL.
// Big analytic sea features (rogue crest, spout vortex dip, whirlpool) + rotor downwash dip.
// CPU mirror: MaydayCore/Ocean/FeatureSet.swift (heightAt / flowAt) — same formulas, same order.
#ifndef MAYDAY_OCEAN_FEATURES_H
#define MAYDAY_OCEAN_FEATURES_H

#include "../Common/GL.h"
#include "../ShaderTypes.h"

inline float oSech2(float q) {
  q = min(12.0f, abs(q));
  float e = exp(-2.0f * q);
  float s = 2.0f * sqrt(e) / (1.0f + e);
  return s * s;
}

// (ue, v, envelope) — local frame of a rogue crest. ue > 0 is ahead of the crest.
inline float3 oRogueFrame(float2 p, float4 A, float4 B) {
  float2 rel = p - A.yz;
  float u = dot(rel, B.xy);
  float v = dot(rel, float2(-B.y, B.x));
  float lc = max(B.w, 1.0f);
  float e = max(abs(v) - 0.3f * lc, 0.0f) / (0.12f * lc);
  return float3(u + 0.0015f * v * v, v, exp(-e * e));
}

inline float oRogueHeight(float2 p, float4 A, float4 B) {
  float3 f = oRogueFrame(p, A, B);
  float W = max(B.z, 1.0f);
  float prof = oSech2(f.x / (f.x > 0.0f ? 0.55f * W : 1.3f * W));
  float sk = (f.x - 1.6f * W) / (0.9f * W);
  return A.w * f.z * (prof - 0.35f * exp(-sk * sk));
}

inline float oVortexHeight(float2 p, float4 A, float4 B) {
  float q = length(p - A.yz) / (0.45f * max(B.x, 1.0f));
  return -0.8f * glSmoothstep(0.4f, 1.0f, A.w) * exp(-q * q);
}

inline float oWhirlHeight(float2 p, float4 A, float4 B) {
  float R = max(B.x, 1.0f);
  float r = length(p - A.yz);
  float q = r / (0.25f * R);
  float m = (r - R) / (0.22f * R);
  return A.w * (-5.0f / (1.0f + q * q) + 0.4f * exp(-m * m));
}

inline float oceanFeatureHeight(float2 p, constant MDOceanUniforms& U) {
  float h = 0.0f;
  for (int i = 0; i < MD_MAX_FEATURES; i++) {
    if (i >= U.uFeatCount) break;
    float4 A = U.uFeatA[i];
    float4 B = U.uFeatB[i];
    if (A.x < 1.5f) h += oRogueHeight(p, A, B);
    else if (A.x < 2.5f) h += oVortexHeight(p, A, B);
    else h += oWhirlHeight(p, A, B);
  }
  if (U.uDownwash.w > 0.0f) {
    float q = length(p - U.uDownwash.xy) / (0.6f * U.uDownwash.z);
    h -= 0.25f * U.uDownwash.w * exp(-q * q);
  }
  return h;
}

// Horizontal surface flow of swirling features, m/s (water memory advection, debris).
inline float2 oceanFeatureFlow(float2 p, constant MDOceanUniforms& U) {
  float2 f = float2(0.0f);
  for (int i = 0; i < MD_MAX_FEATURES; i++) {
    if (i >= U.uFeatCount) break;
    float4 A = U.uFeatA[i];
    if (A.x < 1.5f) continue;
    float4 B = U.uFeatB[i];
    float2 d = p - A.yz;
    float r = max(length(d), 0.5f);
    float R = max(B.x, 1.0f);
    float2 tang = float2(-d.y, d.x) / r * B.y;
    float prof = (r / R) * exp(0.5f * (1.0f - (r * r) / (R * R)));
    float vt = A.x < 2.5f ? 6.0f * A.w : 2.0f * A.w;
    float vin = A.x < 2.5f ? 0.35f * vt : 0.4f * A.w;
    f += (tang * vt - d / r * vin) * prof;
  }
  return f;
}

#endif // MAYDAY_OCEAN_FEATURES_H
