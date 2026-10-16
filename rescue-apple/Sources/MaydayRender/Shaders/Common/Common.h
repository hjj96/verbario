// Common.h — three.js r185 `common` chunk constants and helpers used by the ported materials.
#ifndef MAYDAY_COMMON_H
#define MAYDAY_COMMON_H

#include "GL.h"

#define MD_PI 3.141592653589793f
#define MD_RECIPROCAL_PI 0.3183098861837907f
#define MD_EPSILON 1e-6f

inline float pow2(float x) { return x * x; }
inline float3 pow2(float3 x) { return x * x; }
inline float pow4(float x) { float x2 = x * x; return x2 * x2; }

// Upper-left 3×3 of a column-major 4×4 (GLSL mat3(m)).
inline float3x3 upper3x3(float4x4 m) {
  return float3x3(m[0].xyz, m[1].xyz, m[2].xyz);
}

#endif // MAYDAY_COMMON_H
