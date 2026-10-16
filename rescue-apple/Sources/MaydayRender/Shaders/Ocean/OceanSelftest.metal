// OceanSelftest.metal — port: rescue/src/systems/ocean/selftest.js (SELFTEST_VERTEX/FRAGMENT).
// The web renders displaced world positions into a float target and reads them back; here a compute
// kernel evaluates the SAME oceanVertex() (OceanCommon.h) at given local grid points and writes
// (displaced position xyz, wave damping). OceanSelftest.swift compares it with the CPU WaveBank
// forward evaluation (selftest.js pass criterion: p99 error < 0.05 m).
#include "../ShaderTypes.h"
#include "OceanCommon.h"

kernel void ocean_selftest_kernel(const device float2* points [[buffer(MD_BUF_VERTICES)]],
                                  device float4* results [[buffer(MD_BUF_OUTPUT)]],
                                  constant MDOceanUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                                  constant uint& count [[buffer(MD_BUF_PASS)]],
                                  texture2d<float> uCoast [[texture(MD_TEX_COAST)]],
                                  sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                                  uint gid [[thread_position_in_grid]]) {
  if (gid >= count) return;
  OceanVertexOut ov = oceanVertex(points[gid], U, uCoast, smpClamp);
  results[gid] = float4(ov.pos, ov.aux.w);
}
