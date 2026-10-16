// OceanCommon.h — port: rescue/src/systems/ocean/shaders.js OCEAN_COMMON + OCEAN_VERTEX_PARS
// (oceanCell, oceanEdge, oceanShoalDamp, oceanCoastD, oceanCoastDamp, oceanVertex).
//
// oceanVertex() is shared by ocean_vs (Ocean.metal) and the GPU self-test kernel
// (OceanSelftest.metal); its CPU mirror is WaveBank._eval()/forward() (MaydayCore/Ocean/WaveBank.swift).
// PLAN §3.1 rule 4: the wave phases reach ~400 rad at the grid edge → precise::sin/cos.
#ifndef MAYDAY_OCEAN_COMMON_H
#define MAYDAY_OCEAN_COMMON_H

#include "../Common/GL.h"
#include "../ShaderTypes.h"
#include "OceanFeatures.h"

// ---- function constants (ocean/material.js oceanDefines) ---------------------------------------------
constant int kOceanWaves [[function_constant(MD_FC_OCEAN_WAVES)]];
constant int kOceanQ [[function_constant(MD_FC_OCEAN_Q)]];
constant int kOceanRainLayers [[function_constant(MD_FC_OCEAN_RAIN)]];
constant int kOceanGlints [[function_constant(MD_FC_OCEAN_GLINTS)]];
constant bool kOceanMemory [[function_constant(MD_FC_OCEAN_MEMORY)]];

// Grid constants (ocean/waves.js GRID_EXTENT 380, cellSize 608·step·m^0.375, EDGE_FADE [380, 1200]).
// Local cell size of the warped grid: derivative of 380·|x|^1.6 (same as waves.js cellSize()).
inline float oceanCell(float2 gl, constant MDOceanUniforms& U) {
  float m = max(abs(gl.x), abs(gl.y)) * (1.0f / 380.0f);
  return 608.0f * U.grid.z * pow(max(m, 1e-5f), 0.375f);
}

inline float oceanEdge(float2 gl) {
  return 1.0f - glSmoothstep(380.0f, 1200.0f, max(abs(gl.x), abs(gl.y)));
}

inline float oceanShoalDamp(float2 p, constant MDOceanUniforms& U) {
  float d = 1.0f;
  for (int i = 0; i < MD_MAX_SHOALS; i++) {
    if (i >= U.uShoalCount) break;
    float4 s = U.uShoals[i];
    if (s.w < 0.5f) continue;
    d *= 0.15f + 0.85f * glSmoothstep(s.z * 0.9f, s.z * 2.6f, length(p - s.xy));
  }
  return d;
}

// Distance (m) from p to the nearest terrain waterline; 48 = far / no map (coast.js coastDistance).
// Explicit LOD: valid in vertex/compute functions and in any control flow.
inline float oceanCoastD(float2 p, constant MDOceanUniforms& U, texture2d<float> coast, sampler smp) {
  if (U.misc.x < 0.5f) return 48.0f;
  float2 uv = clamp((p - U.uCoastWin.xy) * U.uCoastWin.zw, float2(0.0f), float2(1.0f));
  return coast.sample(smp, uv, level(0.0f)).r * 48.0f;
}

// Waves die down to ≈ 20 % at the waterline, full beyond ≈ 16 m (coast.js coastDamp).
inline float oceanCoastDamp(float2 p, constant MDOceanUniforms& U, texture2d<float> coast, sampler smp) {
  return 0.2f + 0.8f * glSmoothstep(1.0f, 16.0f, oceanCoastD(p, U, coast, smp));
}

struct OceanVertexOut {
  float3 pos;   // displaced world position (vOWorld)
  float3 nrm;   // world normal (object normal; the ocean's model matrix is identity)
  float2 grid;  // lagrangian world xz (vGrid)
  float4 aux;   // y/Hs, Jacobian, grid cell size, wave damping (vOAux)
};

// Gerstner bank + features at grid vertex gl (local coordinates). Mirrors WaveBank._eval().
inline OceanVertexOut oceanVertex(float2 gl, constant MDOceanUniforms& U, texture2d<float> coast, sampler coastSmp) {
  float2 p0 = gl + U.grid.xy;
  float cell = oceanCell(gl, U);
  float damp = oceanEdge(gl) * oceanShoalDamp(p0, U) * oceanCoastDamp(p0, U, coast, coastSmp);
  float2 dxz = float2(0.0f);
  float y = 0.0f, jxx = 0.0f, jzz = 0.0f, jxz = 0.0f, sx = 0.0f, sz = 0.0f;
  float nxx = 0.0f, nzz = 0.0f, nxz = 0.0f;
  if (damp > 0.0f) {
    for (int i = 0; i < kOceanWaves; i++) {
      float4 A = U.uWaveA[i];
      float4 B = U.uWaveB[i];
      float w = damp * glSmoothstep(3.5f, 5.0f, B.z / cell);   // LOD: short waves move to the fragment normal
      // below 10 cells per wavelength the normal is computed per fragment instead (no blocky checker)
      float wn = damp * glSmoothstep(7.0f, 10.0f, B.z / cell);
      float th = A.z * dot(A.xy, gl) + B.y;
      float s = precise::sin(th);
      float c = precise::cos(th);
      float a = A.w * w;
      float b = B.x * w;
      dxz += (b * c) * A.xy;
      y += a * s;
      float kbs = A.z * b * s;
      jxx += kbs * A.x * A.x;
      jzz += kbs * A.y * A.y;
      jxz += kbs * A.x * A.y;
      float kbn = A.z * B.x * wn * s;
      nxx += kbn * A.x * A.x;
      nzz += kbn * A.y * A.y;
      nxz += kbn * A.x * A.y;
      float kac = A.z * A.w * wn * c;
      sx += kac * A.x;
      sz += kac * A.y;
    }
  }
  float fh = 0.0f;
  float2 fg = float2(0.0f);
  if (U.uFeatCount > 0 || U.uDownwash.w > 0.0f) {
    fh = oceanFeatureHeight(p0, U);
    fg = float2(oceanFeatureHeight(p0 + float2(0.5f, 0.0f), U) - fh,
                oceanFeatureHeight(p0 + float2(0.0f, 0.5f), U) - fh) * 2.0f;
  }
  float3 tx = float3(1.0f - nxx, sx + fg.x, -nxz);
  float3 tz = float3(-nxz, sz + fg.y, 1.0f - nzz);
  OceanVertexOut o;
  o.nrm = normalize(cross(tz, tx));
  o.pos = float3(p0.x + dxz.x, y + fh, p0.y + dxz.y);
  o.grid = p0;
  o.aux = float4(o.pos.y / U.grid.w, (1.0f - jxx) * (1.0f - jzz) - jxz * jxz, cell, damp);
  return o;
}

#endif // MAYDAY_OCEAN_COMMON_H
