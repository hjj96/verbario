// ShadowDepth.metal — the directional shadow map's depth pass (PLAN §3.3 #7): three r185 renders every
// castShadow mesh with a MeshDepthMaterial into the DepthTexture of a PCFShadowMap (the colour is never
// read; LessEqual compare happens in the receivers, Common/Shadow.h). Depth-only pipelines: no fragment
// function, Metal clip z ∈ [0, 1] from MDShadowPassUniforms.viewProj = glToMetal × three's orthographic
// shadow projection × view, so the stored depth equals three's gl_FragCoord.z. normalBias is applied by
// the RECEIVER (shadowmap_vertex), never here. Side: three swaps FrontSide ↔ BackSide for the depth
// material (WebGLShadowMap `_[n.side]`): ShadowPass.cullMode(for:) gives the Metal cull mode.
// Families with vertex deformation (vegetation sway, gull flap — FC_DEFORM / FC_ALPHATEST in PLAN §3.3)
// add their own depth functions next to their colour shaders; these two cover plain and instanced meshes.
#include "../ShaderTypes.h"
#include "../Common/Common.h"

struct ShadowDepthIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
};

struct ShadowDepthOut {
  float4 position [[position]];
};

vertex ShadowDepthOut shadow_depth_vs(ShadowDepthIn in [[stage_in]],
                                      constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]],
                                      constant MDShadowPassUniforms& P [[buffer(MD_BUF_PASS)]]) {
  ShadowDepthOut o;
  o.position = P.viewProj * (O.model * float4(in.position, 1.0f));
  return o;
}

// USE_INSTANCING: per-instance matrices (three instanceMatrix) read by [[instance_id]].
vertex ShadowDepthOut shadow_depth_instanced_vs(ShadowDepthIn in [[stage_in]],
                                                uint iid [[instance_id]],
                                                const device float4x4* instances [[buffer(MD_BUF_INSTANCES)]],
                                                constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]],
                                                constant MDShadowPassUniforms& P [[buffer(MD_BUF_PASS)]]) {
  ShadowDepthOut o;
  o.position = P.viewProj * (O.model * (instances[iid] * float4(in.position, 1.0f)));
  return o;
}
