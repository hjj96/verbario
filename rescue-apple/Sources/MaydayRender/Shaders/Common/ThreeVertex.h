// ThreeVertex.h — three.js r185 vertex chunks used by every mesh family (PLAN §3.2):
//   beginnormal_vertex / defaultnormal_vertex  → threeInstanceNormal (USE_INSTANCING rule),
//                                                threeWorldNormal / threeViewNormal (+ FLIP_SIDED)
//   project_vertex / worldpos_vertex            → threeProject / threeProjectInstanced
// Lighting runs in WORLD space (ThreePBR.h); the VIEW-space normal is still produced because three's
// geometryRoughness (lights_physical_fragment) differentiates the view-space vNormal.
// Matrices: MDObjectData.model = matrixWorld, MDObjectData.normalMatrix = inverse-transpose of its
// upper 3×3 (CPU, like three's object.normalMatrix — MSL has no inverse()); the view rotation is
// orthonormal, so view-space normal = mat3(viewMatrix) · world normal.
#ifndef MAYDAY_THREE_VERTEX_H
#define MAYDAY_THREE_VERTEX_H

#include "Common.h"
#include "../ShaderTypes.h"

// defaultnormal_vertex, USE_INSTANCING: an instance matrix may scale non-uniformly, so the normal is
// divided by the squared column lengths before the multiply (= inverse-transpose for scale × rotation).
inline float3 threeInstanceNormal(float3 objectNormal, float4x4 instanceMatrix) {
  float3x3 im = upper3x3(instanceMatrix);
  float3 n = objectNormal / float3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  return im * n;
}

// transformedNormal in world space (not normalised; three normalises in the fragment stage).
inline float3 threeWorldNormal(float3 objectNormal, float4x4 normalMatrixWorld, bool flipSided) {
  float3 n = upper3x3(normalMatrixWorld) * objectNormal;
  return flipSided ? -n : n;                 // FLIP_SIDED (material.side == BackSide)
}

// three vNormal (view space) from the world-space transformed normal.
inline float3 threeViewNormal(float3 worldNormal, float4x4 viewMatrix) {
  return normalize(upper3x3(viewMatrix) * worldNormal);
}

struct ThreeProjected {
  float4 worldPosition;   // worldpos_vertex
  float4 mvPosition;      // project_vertex (view space)
  float4 clip;            // gl_Position with the Metal depth range (FrameUniforms.projMatrix)
};

// project_vertex + worldpos_vertex for a plain mesh: transformed = object-space position after the
// family's begin_vertex hook (deformations).
inline ThreeProjected threeProject(float3 transformed, float4x4 model, float4x4 viewMatrix, float4x4 projMatrix) {
  ThreeProjected p;
  p.worldPosition = model * float4(transformed, 1.0f);
  p.mvPosition = viewMatrix * p.worldPosition;
  p.clip = projMatrix * p.mvPosition;
  return p;
}

// Same with USE_INSTANCING: the instance matrix applies first (mvPosition = modelView · instance · p).
inline ThreeProjected threeProjectInstanced(float3 transformed, float4x4 instanceMatrix, float4x4 model,
                                            float4x4 viewMatrix, float4x4 projMatrix) {
  ThreeProjected p;
  p.worldPosition = model * (instanceMatrix * float4(transformed, 1.0f));
  p.mvPosition = viewMatrix * p.worldPosition;
  p.clip = projMatrix * p.mvPosition;
  return p;
}

#endif // MAYDAY_THREE_VERTEX_H
