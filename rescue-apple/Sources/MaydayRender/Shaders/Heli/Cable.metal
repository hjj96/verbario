// Cable.metal — port: rescue/src/systems/heli/materials.js createCableMaterial (PLAN §3.3 #32): the winch
// cable as a camera-facing ribbon of constant screen width (uPx px each side), steel with a glint running
// along it and up to ×3 highlights inside the searchlight cone.
// Geometry: heli_cable.mmesh — the web's ribbon topology (2 vertices per verlet point, aSide / aDir / aV,
// web vertex numbering kept). The web rewrites `position` / `aOther` every frame from the interpolated
// points (heli/winch.js render(): vertex 2i + s → point i, aOther → point i + 1, or i − 1 for the last);
// here the 15 points arrive in MDCableUniforms and the vertex shader picks them by vertex_id — the same
// values reach the same vertices. Extrusion only uses clip xy / w, which the Metal depth mapping keeps.
// ShaderMaterial: opaque, DoubleSide, depth write on, no fog.
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "HeliShaderTypes.h"

struct CableIn {
  float aSide [[attribute(MD_HELI_ATTR_SIDE)]];
  float aDir [[attribute(MD_HELI_ATTR_DIR)]];
  float aV [[attribute(MD_HELI_ATTR_V)]];
};

struct CableVaryings {
  float4 position [[position]];
  float vV;
  float3 vW;
};

vertex CableVaryings cable_vs(CableIn in [[stage_in]],
                              uint vid [[vertex_id]],
                              constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                              constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                              constant MDCableUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  const float2 uResolution = L.nightResolution.zw;
  const float uPx = U.uBeamColorPx.w;
  int i = min(int(vid / 2u), MD_CABLE_POINTS - 1);
  int j = i < MD_CABLE_POINTS - 1 ? i + 1 : i - 1;
  float3 position = U.points[i].xyz;
  float3 aOther = U.points[j].xyz;
  CableVaryings o;
  o.vV = in.aV;
  o.vW = position;
  float4 c0 = F.projMatrix * (F.viewMatrix * float4(position, 1.0f));
  float4 c1 = F.projMatrix * (F.viewMatrix * float4(aOther, 1.0f));
  float2 s0 = c0.xy / c0.w * uResolution;
  float2 s1 = c1.xy / c1.w * uResolution;
  float2 d = s1 - s0;
  float l = length(d);
  d = l > 1e-4f ? d / l * in.aDir : float2(0.0f, 1.0f);
  float2 n = float2(-d.y, d.x);
  c0.xy += n * in.aSide * uPx * c0.w / uResolution;
  o.position = c0;
  return o;
}

fragment float4 cable_fs(CableVaryings in [[stage_in]],
                         constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                         constant MDCableUniforms& U [[buffer(MD_BUF_MATERIAL)]]) {
  const float uTime = L.timeWindRain.x;
  const float3 uBase = U.uBaseLit.xyz;
  const float uLit = U.uBaseLit.w;
  const float3 uBeamPos = U.uBeamPosCos.xyz;
  const float uBeamCos = U.uBeamPosCos.w;
  const float3 uBeamDir = U.uBeamDirI.xyz;
  const float uBeamI = U.uBeamDirI.w;
  const float3 uBeamColor = U.uBeamColorPx.xyz;
  float3 col = uBase * uLit;
  float glint = pow(0.5f + 0.5f * sin(in.vV * 140.0f - uTime * 2.3f), 18.0f);
  col += float3(0.9f, 0.95f, 1.0f) * glint * 0.35f * uLit;
  float3 toP = in.vW - uBeamPos;
  float inBeam = glSmoothstep(uBeamCos, glMix(uBeamCos, 1.0f, 0.35f), dot(normalize(toP), uBeamDir)) * uBeamI;
  col += uBeamColor * inBeam * (0.45f + 1.35f * glint) * 3.0f * 0.4f;
  return float4(col, 1.0f);
}
