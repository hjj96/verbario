// Lights.metal — port: rescue/src/systems/heli/materials.js createLightsMaterial (PLAN §3.3 #30): every
// emissive bulb (octahedron) and its view-facing halo quad in ONE additive draw (heli_lights.mmesh,
// heli/model.js buildLightsGeometry). Per-vertex channel index into uChan[10] (intensity per light group,
// driven by MaydayCore HeliLights: nav, beacon, strobes, door, St. Elmo, lens); halos are built in VIEW
// space (corner × size, pulled 1.5 m toward the camera so the hull never clips them).
// ShaderMaterial: transparent, depthWrite off, AdditiveBlending (SRC_ALPHA, ONE), FrontSide, no fog.
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "HeliShaderTypes.h"

struct HeliLightsIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
  float2 aCorner [[attribute(MD_HELI_ATTR_CORNER)]];
  float aChan [[attribute(MD_HELI_ATTR_CHAN)]];
  float aSize [[attribute(MD_HELI_ATTR_SIZE)]];
  float3 aColor [[attribute(MD_ATTR_COLOR)]];
};

struct HeliLightsVaryings {
  float4 position [[position]];
  float3 vCol;
  float2 vC;
  float vHalo;
};

inline float heliChannel(constant MDHeliLightsUniforms& U, int i) {
  int k = clamp(i, 0, MD_LIGHT_CHANNELS - 1);
  return U.uChan[k / 4][k % 4];
}

vertex HeliLightsVaryings heli_lights_vs(HeliLightsIn in [[stage_in]],
                                         constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                                         constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]],
                                         constant MDHeliLightsUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  HeliLightsVaryings o;
  float4 mv = F.viewMatrix * (O.model * float4(in.position, 1.0f));
  o.vHalo = step(0.5f, abs(in.aCorner.x) + abs(in.aCorner.y));
  if (o.vHalo > 0.5f) {
    mv.xy += in.aCorner * in.aSize;
    mv.z += 1.5f; // pull halos toward the camera so the hull never clips them
  }
  o.position = F.projMatrix * mv;
  o.vCol = in.aColor * heliChannel(U, int(in.aChan + 0.5f));
  o.vC = in.aCorner;
  return o;
}

fragment float4 heli_lights_fs(HeliLightsVaryings in [[stage_in]],
                               constant MDHeliLightsUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  const float uHalo = U.haloBulb.x;
  const float uBulb = U.haloBulb.y;
  float r2 = dot(in.vC, in.vC);
  float a = in.vHalo > 0.5f ? exp(-r2 * 4.5f) * (1.0f - glSmoothstep(0.45f, 1.0f, r2)) * uHalo : uBulb;
  return float4(in.vCol * a, 1.0f);
}
