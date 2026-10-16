// GL.h — GLSL semantics in MSL (PLAN §3.1 rule 1). Every GLSL → MSL port uses these instead of
// the metal:: builtins whose contract differs from GLSL:
//   * metal::smoothstep / clamp are "undefined" for edge0 ≥ edge1 / min > max; GLSL code relies on
//     the formula (e.g. smoothstep(r, 0.55r, d) in finalShader.js, smoothstep(−0.15W, −0.9W, x) in
//     the rogue carpet) → glSmoothstep evaluates the formula for any edges;
//   * metal::mix requires a ∈ [0, 1]; GLSL extrapolates → glMix;
//   * GLSL mod(x, y) = x − y·floor(x/y) (not fmod) → glMod;
//   * GLSL dFdy points up the screen, Metal dfdy down → glDFdy = −dfdy;
//   * render targets: Metal row 0 = top. Full-screen passes keep GL-style vUv (0,0 bottom-left)
//     and sample targets through rtUV; gl_FragCoord → fragCoordGL;
//   * pow(x, 2.0) with a possibly negative base is undefined in both languages → sq() (rule 2).
#ifndef MAYDAY_GL_H
#define MAYDAY_GL_H

#include <metal_stdlib>
using namespace metal;

// ---- smoothstep (formula, any edge order) ----------------------------------------------------------
inline float glSmoothstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}
inline float2 glSmoothstep(float e0, float e1, float2 x) {
  float2 t = clamp((x - e0) / (e1 - e0), float2(0.0f), float2(1.0f));
  return t * t * (3.0f - 2.0f * t);
}
inline float3 glSmoothstep(float e0, float e1, float3 x) {
  float3 t = clamp((x - e0) / (e1 - e0), float3(0.0f), float3(1.0f));
  return t * t * (3.0f - 2.0f * t);
}

// ---- mix (GLSL: x·(1 − a) + y·a, any a) ---------------------------------------------------------------
inline float glMix(float x, float y, float a) { return x + (y - x) * a; }
inline float2 glMix(float2 x, float2 y, float a) { return x + (y - x) * a; }
inline float3 glMix(float3 x, float3 y, float a) { return x + (y - x) * a; }
inline float4 glMix(float4 x, float4 y, float a) { return x + (y - x) * a; }
inline float3 glMix(float3 x, float3 y, float3 a) { return x + (y - x) * a; }

// ---- misc ---------------------------------------------------------------------------------------------------
inline float glMod(float x, float y) { return x - y * floor(x / y); }
inline float2 glMod(float2 x, float2 y) { return x - y * floor(x / y); }
inline float sq(float x) { return x * x; }
inline float glAtan(float y, float x) { return atan2(y, x); }
inline float saturate1(float x) { return clamp(x, 0.0f, 1.0f); }
inline float3 saturate3(float3 x) { return clamp(x, float3(0.0f), float3(1.0f)); }

// GLSL dFdy (window y up) from Metal dfdy (window y down).
inline float glDFdy(float x) { return -dfdy(x); }
inline float2 glDFdy(float2 x) { return -dfdy(x); }
inline float3 glDFdy(float3 x) { return -dfdy(x); }

// GL-style uv (0,0 = bottom-left) → Metal texture coordinate of a render target (row 0 = top).
inline float2 rtUV(float2 uv) { return float2(uv.x, 1.0f - uv.y); }
// Same, for a source that only fills the sub-rectangle [0, scale] of its texture (dynamic
// resolution renders into a viewport sub-rect); clampMax keeps bilinear taps inside it.
inline float2 rtUVScaled(float2 uv, float2 scale, float2 clampMax) {
  float2 t = float2(uv.x, 1.0f - uv.y) * scale;
  return clamp(t, float2(0.0f), clampMax);
}
// gl_FragCoord.xy (origin bottom-left, pixel centres at .5) from Metal [[position]] (origin top-left).
inline float2 fragCoordGL(float4 position, float2 resolution) {
  return float2(position.x, resolution.y - position.y);
}

#endif // MAYDAY_GL_H
