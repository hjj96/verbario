// HeliProps.metal — the plain three r185 materials of the helicopter's small parts (PLAN §3.3 #20 / #34):
//   heli_prop_*   MeshStandardMaterial({vertexColors}) — hoist operator (crewman.js: roughness .62), rescue
//                 basket (winch.js: .55 / metalness .05), rescue swimmer (.6), packed life rafts (heli.js: .7)
//                 and, without vertex colours, the flotation bags (heli/model.js #F5B300, .62);
//   heli_basic_*  MeshBasicMaterial — the thrown flare embers (#FF2A12 × 9, HDR).
// Same chunk order as Common/Standard.metal (beginnormal / defaultnormal → project / worldpos →
// shadowmap_vertex → fog_vertex; color_fragment multiplies the vertex colour in when USE_COLOR) plus the
// emissive term. MeshBasic: indirectDiffuse = 1 × diffuseColor (no lights, scene.environment does not apply
// to MeshBasicMaterial), fog. Function constants: MD_FC_SHADOWS, MD_FC_STD_ENV, MD_FC_HELI_VCOLOR.
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "../Common/ThreeVertex.h"
#include "../Common/ThreePBR.h"
#include "../Common/IBL.h"
#include "../Common/Shadow.h"
#include "../Common/Fog.h"
#include "HeliShaderTypes.h"

constant bool kPropShadows [[function_constant(MD_FC_SHADOWS)]];
constant bool kPropEnv [[function_constant(MD_FC_STD_ENV)]];
constant bool kPropVColor [[function_constant(MD_FC_HELI_VCOLOR)]];

struct HeliPropIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
  float3 normal [[attribute(MD_ATTR_NORMAL)]];
  float3 color [[attribute(MD_ATTR_COLOR), function_constant(kPropVColor)]];
};

struct HeliPropVaryings {
  float4 position [[position]];
  float3 vNormal;
  float3 vWorldNormal;
  float3 vWorldPosition;
  float3 vFogOff;
  float4 vShadowCoord;
  float3 vColor;
};

vertex HeliPropVaryings heli_prop_vs(HeliPropIn in [[stage_in]],
                                     constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                                     constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                                     constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  float3 objectNormal = in.normal;
  ThreeProjected p = threeProject(in.position, O.model, F.viewMatrix, F.projMatrix);
  float3 worldNormal = threeWorldNormal(objectNormal, O.normalMatrix, false);
  HeliPropVaryings o;
  o.position = p.clip;
  o.vNormal = threeViewNormal(worldNormal, F.viewMatrix);
  o.vWorldNormal = worldNormal;
  o.vWorldPosition = p.worldPosition.xyz;
  o.vFogOff = fogOffset(p.mvPosition, F.viewMatrix);
  o.vShadowCoord = kPropShadows ? threeDirShadowCoord(p.worldPosition, worldNormal, LT) : float4(0.0f);
  o.vColor = kPropVColor ? float3(1.0f) * in.color : float3(1.0f);   // color_vertex
  return o;
}

fragment float4 heli_prop_fs(HeliPropVaryings in [[stage_in]],
                             constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                             constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                             constant MDHeliPropMaterial& M [[buffer(MD_BUF_MATERIAL)]],
                             texture2d<float> dfgLUT [[texture(MD_TEX_DFG)]],
                             texture2d<float> envMap [[texture(MD_TEX_ENV)]],
                             depth2d<float> shadowMap [[texture(MD_TEX_SHADOW)]],
                             sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                             sampler smpShadow [[sampler(MD_SMP_SHADOW)]]) {
  float4 diffuseColor = M.color;
  diffuseColor.rgb = diffuseColor.rgb * in.vColor;      // color_fragment
  float roughnessFactor = M.params.x;
  float metalnessFactor = M.params.y;
  bool receiveShadow = M.params.z > 0.5f;
  float3 normalView = normalize(in.vNormal);
  float3 normal = normalize(in.vWorldNormal);
  float3 totalEmissiveRadiance = M.emissive.xyz;
  PhysicalMaterial material = makeStandardMaterial(diffuseColor.rgb, metalnessFactor, roughnessFactor, normalView);

  float3 geometryPosition = in.vWorldPosition;
  float3 geometryNormal = normal;
  float3 geometryViewDir = normalize(F.cameraPosition.xyz - in.vWorldPosition);
  ReflectedLight reflectedLight = makeReflectedLight();
  for (int i = 0; i < MD_POINT_LIGHTS; i++) {
    MDPointLight pl = LT.point[i];
    if (pl.color.x + pl.color.y + pl.color.z <= 0.0f) continue;
    IncidentLight directLight = getPointLightInfo(pl, geometryPosition);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  for (int i = 0; i < MD_SPOT_LIGHTS; i++) {
    MDSpotLight sl = LT.spot[i];
    if (sl.color.x + sl.color.y + sl.color.z <= 0.0f) continue;
    IncidentLight directLight = getSpotLightInfo(sl, geometryPosition);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  {
    IncidentLight directLight = getDirectionalLightInfo(LT.dir);
    if (kPropShadows) {
      directLight.color *= threeDirShadow(LT, shadowMap, smpShadow, in.vShadowCoord, fragCoordGL(in.position, F.timeRes.zw),
                                          directLight.visible, receiveShadow);
    }
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  float3 iblIrradiance = float3(0.0f);
  float3 irradiance = getAmbientLightIrradiance(LT.ambientEnv.xyz);
  irradiance += getHemisphereLightIrradiance(LT.hemi, geometryNormal);
  float3 radiance = float3(0.0f);
  if (kPropEnv) {
    float envMapIntensity = LT.ambientEnv.w;
    iblIrradiance += getIBLIrradiance(geometryNormal, envMap, smpClamp, envMapIntensity);
    radiance += getIBLRadiance(geometryViewDir, geometryNormal, material.roughness, envMap, smpClamp, envMapIntensity);
  }
  RE_IndirectDiffuse_Physical(irradiance, material, reflectedLight);
  RE_IndirectSpecular_Physical(radiance, iblIrradiance, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  float3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  float3 color = M.params.w > 0.5f ? applyFog(outgoingLight, in.vFogOff, F) : outgoingLight;
  return float4(color, diffuseColor.a);
}

// ---- MeshBasicMaterial (flare embers) ---------------------------------------------------------------------
struct HeliBasicIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
};

struct HeliBasicVaryings {
  float4 position [[position]];
  float3 vFogOff;
};

vertex HeliBasicVaryings heli_basic_vs(HeliBasicIn in [[stage_in]],
                                       constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                                       constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  ThreeProjected p = threeProject(in.position, O.model, F.viewMatrix, F.projMatrix);
  HeliBasicVaryings o;
  o.position = p.clip;
  o.vFogOff = fogOffset(p.mvPosition, F.viewMatrix);
  return o;
}

fragment float4 heli_basic_fs(HeliBasicVaryings in [[stage_in]],
                              constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                              constant MDHeliPropMaterial& M [[buffer(MD_BUF_MATERIAL)]]) {
  float4 diffuseColor = M.color;
  float3 indirectDiffuse = float3(1.0f);               // no lightmap
  indirectDiffuse *= diffuseColor.rgb;
  float3 outgoingLight = indirectDiffuse;
  float3 color = M.params.w > 0.5f ? applyFog(outgoingLight, in.vFogOff, F) : outgoingLight;
  return float4(color, diffuseColor.a);
}
