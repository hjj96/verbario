// CubeUV.h — the PMREMGenerator face convention shared by the env bake kernels (EnvSky.metal,
// Prefilter.metal). three r185 renders lod 0 with a 90° cube camera per face (_sceneToCubeUV) and
// filters the lower lods through quads whose vertex shader maps (uv, face) to a direction with
// getDirection() (PMREM `_getCommonVertexShader`). Both give the same direction for a face uv, the
// inverse of cube_uv_reflection_fragment getUV() (checked face by face against the camera bases:
// +X up +Y, +Y up −Z, +Z up +Y, −X up +Y, −Y up +Z, −Z up +Y), so one function serves both.
//
// Atlas addressing (GL rows, row 0 = bottom, exactly as three's viewports): a lod of face size f sits
// at (x0, y0) and spans 3f × 2f texels; faces 0–2 fill the lower row, 3–5 the upper row.
#ifndef MAYDAY_CUBE_UV_H
#define MAYDAY_CUBE_UV_H

#include "../Common/GL.h"

// RH coordinate system; PMREM face-indexing convention (getDirection, uv in face units, 0..1 inside).
inline float3 pmremGetDirection(float2 uv, float face) {
  uv = 2.0f * uv - 1.0f;
  float3 direction = float3(uv, 1.0f);
  if (face == 0.0f) {
    direction = direction.zyx;                         // ( 1, v, u ) pos x
  } else if (face == 1.0f) {
    direction = direction.xzy;
    direction.xz *= -1.0f;                             // ( -u, 1, -v ) pos y
  } else if (face == 2.0f) {
    direction.x *= -1.0f;                              // ( -u, v, 1 ) pos z
  } else if (face == 3.0f) {
    direction = direction.zyx;
    direction.xz *= -1.0f;                             // ( -1, v, -u ) neg x
  } else if (face == 4.0f) {
    direction = direction.xzy;
    direction.xy *= -1.0f;                             // ( -u, -1, v ) neg y
  } else if (face == 5.0f) {
    direction.z *= -1.0f;                              // ( u, v, -1 ) neg z
  }
  return direction;
}

struct PmremTexel {
  float face;    // 0 … 5
  uint2 pixel;   // pixel inside the face (x right, y up from the face's bottom row)
};

// Texel (x, y) of a 3f × 2f lod block (y counted from the block's bottom row) → face + face pixel.
inline PmremTexel pmremTexel(uint2 local, uint f) {
  PmremTexel t;
  uint col = local.x / f;
  uint row = local.y / f;
  t.face = float(col + 3u * row);
  t.pixel = uint2(local.x - col * f, local.y - row * f);
  return t;
}

#endif // MAYDAY_CUBE_UV_H
