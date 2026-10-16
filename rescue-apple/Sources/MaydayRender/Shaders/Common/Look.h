// Look.h — port: rescue/src/core/look.js LOOK_GLSL_FUNCS (lookGust, lookFront, lookFronts, lookCloud).
// The CPU mirrors (gustField / frontsAt / cloudAt) live in MaydayCore/Look; the same field that
// pushes the helicopter is drawn on the water ("what you SEE is what PUSHES").
//
// Scales are the GLSL literals look.js bakes in with toFixed() (GUST_SCALE.toFixed(5) = "0.00600",
// GUST_DRIFT.toFixed(3) = "0.900", CLOUD_*); look.json `core/look` carries the same numbers and
// BootstrapSim (debug builds) asserts they still match.
//
// Every function samples with implicit LOD: call them only in uniform control flow (PLAN §3.1 rule 3).
#ifndef MAYDAY_LOOK_H
#define MAYDAY_LOOK_H

#include "GL.h"
#include "../ShaderTypes.h"

#define LOOK_GUST_SCALE 0.00600f
#define LOOK_GUST_DRIFT 0.900f
#define LOOK_CLOUD_SCALE 0.00250f
#define LOOK_CLOUD_DRIFT 1.500f

// Gust intensity field 0..1 ("cat's paws"). Same formula as look.gustField() on the CPU.
inline float lookGust(float2 xz, constant MDLookUniforms& L, texture2d<float> atlas, sampler smp) {
  float2 wo = L.windOffsetWetFlash.xy;
  float r = atlas.sample(smp, (xz - wo * LOOK_GUST_DRIFT) * LOOK_GUST_SCALE).r;
  return glSmoothstep(0.45f, 0.8f, r);
}

// Profile of one moving gust front at world xz: 0..1 (sin² band across, gaussian taper along).
// pow(x, 2.0) → sq() (PLAN X12 / W7).
inline float lookFront(float2 xz, float4 a, float4 b) {
  if (b.x <= 0.0f) return 0.0f;
  float2 rel = xz - a.xy;
  float along = dot(rel, a.zw);
  float lat = dot(rel, float2(-a.w, a.z));
  float band = abs(along) < 0.5f * b.y ? sq(sin(3.14159265f * (along / b.y + 0.5f))) : 0.0f;
  float taper = exp(-2.0f * sq(lat / (0.5f * b.z)));
  return band * taper;
}

// Sum of all gust fronts, in m/s of extra wind speed.
inline float lookFronts(float2 xz, constant MDLookUniforms& L) {
  float s = 0.0f;
  for (int i = 0; i < MD_GUST_FRONTS; i++) s += lookFront(xz, L.uGustFronts[i], L.uGustFrontsB[i]) * L.uGustFrontsB[i].x;
  return s;
}

// Cloud cover 0..1 for cloud shadows. Two scales + domain warp. Same maths as look.cloudAt().
inline float lookCloud(float2 xz, constant MDLookUniforms& L, texture2d<float> atlas, sampler smp) {
  float2 wo = L.windOffsetWetFlash.xy;
  float2 uv = (xz - wo * LOOK_CLOUD_DRIFT) * LOOK_CLOUD_SCALE + float2(0.37f, 0.61f);
  float2 w = float2(atlas.sample(smp, uv * 0.53f + float2(0.11f, 0.29f)).r,
                    atlas.sample(smp, uv * 0.53f + float2(0.47f, 0.83f)).r) - 0.5f;
  uv += w * 0.18f;
  float r = 0.65f * atlas.sample(smp, uv).r + 0.35f * atlas.sample(smp, uv * 2.31f + float2(0.23f, 0.71f)).r;
  return glSmoothstep(0.44f, 0.66f, r);
}

#endif // MAYDAY_LOOK_H
