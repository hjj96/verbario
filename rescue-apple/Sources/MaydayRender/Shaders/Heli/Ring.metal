// Ring.metal — port: rescue/src/systems/heli/materials.js createRingMaterial (PLAN §3.3 #33): the winch
// reach ring on the water — a dashed circle at the capture radius (22 dashes), pale when empty, rescue
// orange while a person is inside the capture zone, its edges feathered across the band.
// Geometry: heli_ring.mmesh — the web's ring topology (inner / outer vertex per segment end, aAng 0 … 1,
// aEdge 0 / 1, web numbering kept). heli/winch.js _ring() rewrites the world positions every frame so the
// ring hugs the waves; they arrive in MDRingUniforms.positions and are picked by vertex_id (the mesh has
// an identity matrix in the web: matrixAutoUpdate off).
// ShaderMaterial: transparent, depthWrite off, NormalBlending, FrontSide, no fog.
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "HeliShaderTypes.h"

struct RingIn {
  float aAng [[attribute(MD_HELI_ATTR_ANG)]];
  float aEdge [[attribute(MD_HELI_ATTR_EDGE)]];
};

struct RingVaryings {
  float4 position [[position]];
  float vAng;
  float vEdge;
};

vertex RingVaryings ring_vs(RingIn in [[stage_in]],
                            uint vid [[vertex_id]],
                            constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                            constant MDRingUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  RingVaryings o;
  o.vAng = in.aAng;
  o.vEdge = in.aEdge;
  float3 position = U.positions[min(int(vid), MD_RING_VERTICES - 1)].xyz;
  o.position = F.projMatrix * (F.viewMatrix * float4(position, 1.0f));
  return o;
}

fragment float4 ring_fs(RingVaryings in [[stage_in]],
                        constant MDRingUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  const float3 uColor = U.uColorOpacity.xyz;
  const float uOpacity = U.uColorOpacity.w;
  const float uPhase = U.phaseDashes.x;
  const float uDashes = U.phaseDashes.y;
  float f = fract(in.vAng * uDashes - uPhase);
  float dash = glSmoothstep(0.0f, 0.06f, f) * (1.0f - glSmoothstep(0.52f, 0.58f, f));
  float edge = 1.0f - pow(abs(in.vEdge * 2.0f - 1.0f), 6.0f);
  return float4(uColor, uOpacity * dash * edge);
}
