// Fog.h — port: rescue/src/core/look.js patchFog() (fog_vertex / fog_fragment).
//
// Fog distance = HORIZONTAL distance from the point under the screen centre (a "visibility
// bubble" when looking down), thinned with height: × (1 − 0.6·smoothstep(30, 140, worldY)).
// Linear fog only (scene.fog = THREE.Fog); the FOG_EXP2 branch is dead in the game.
//
// vertex:   vFogOff = mvPosition.xyz * mat3(viewMatrix)  (world-space offset from the camera)
// fragment: lookFocus is the same for every fragment of a frame; the CPU computes it once from the
//           view matrix (FrameUniforms.fogFarFocus.yz):
//             lookFwd = −(V[0][2], V[1][2], V[2][2]);  lookFocus = lookFwd.xz · camY / max(−lookFwd.y, 0.25)
#ifndef MAYDAY_FOG_H
#define MAYDAY_FOG_H

#include "Common.h"
#include "../ShaderTypes.h"

// GLSL `mvPosition.xyz * mat3(viewMatrix)` = transpose(mat3(view)) · mv.
inline float3 fogOffset(float4 mvPosition, float4x4 viewMatrix) {
  return transpose(upper3x3(viewMatrix)) * mvPosition.xyz;
}

inline float3 applyFog(float3 color, float3 fogOff, constant MDFrameUniforms& F) {
  if (F.fogFarFocus.w < 0.5f) return color;
  float2 lookFocus = F.fogFarFocus.yz;
  float lookHD = length(fogOff.xz - lookFocus);
  float lookWY = F.cameraPosition.y + fogOff.y;
  float fogFactor = glSmoothstep(F.fogColorNear.w, F.fogFarFocus.x, lookHD);
  fogFactor *= (1.0f - 0.6f * glSmoothstep(30.0f, 140.0f, lookWY));
  return glMix(color, F.fogColorNear.xyz, fogFactor);
}

#endif // MAYDAY_FOG_H
