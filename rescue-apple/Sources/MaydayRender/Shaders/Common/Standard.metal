// Standard.metal — plain three r185 MeshStandardMaterial (PLAN §3.3 #20: debris, dolphins, raft packs,
// probes; no maps, no onBeforeCompile hooks), assembled in three's chunk order:
//   vertex   beginnormal / defaultnormal (+ USE_INSTANCING rule) → begin / project / worldpos →
//            shadowmap_vertex (normalBias) → fog_vertex (core/look.js vFogOff)
//   fragment diffuseColor = vec4(color, opacity); roughnessFactor / metalnessFactor; normal = normalize(vNormal)
//            (× faceDirection when DoubleSide); emissive; lights_physical_fragment (makeStandardMaterial);
//            lights_fragment_begin (point, spot, directional with getShadow, ambient + hemisphere irradiance);
//            lights_fragment_maps (IBL: getIBLIrradiance, getIBLRadiance — scene.environment, the PMREM
//            atlas, envMapIntensity = scene.environmentIntensity); lights_fragment_end (indirect diffuse /
//            specular); opaque_fragment; (no tone mapping / colour space: linear HDR target); fog_fragment.
// Lighting runs in WORLD space (ThreePBR.h); geometryRoughness still differentiates the VIEW normal.
// Function constants: FC_INSTANCED (instanceMatrix per [[instance_id]]), shadows (USE_SHADOWMAP with a
// map bound), FC_ENV (scene.environment present), FC_DOUBLE_SIDED.
#include "../ShaderTypes.h"
#include "Common.h"
#include "ThreeVertex.h"
#include "ThreePBR.h"
#include "IBL.h"
#include "Shadow.h"
#include "Fog.h"

constant bool kStdInstanced [[function_constant(MD_FC_STD_INSTANCED)]];
constant bool kStdShadows [[function_constant(MD_FC_SHADOWS)]];
constant bool kStdEnv [[function_constant(MD_FC_STD_ENV)]];
constant bool kStdDoubleSided [[function_constant(MD_FC_STD_DOUBLE_SIDED)]];

struct StandardIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
  float3 normal [[attribute(MD_ATTR_NORMAL)]];
};

struct StandardVaryings {
  float4 position [[position]];
  float3 vNormal;        // view-space normal (three vNormal)
  float3 vWorldNormal;   // world-space normal (lighting)
  float3 vWorldPosition; // geometryPosition in world space
  float3 vFogOff;        // core/look.js fog patch
  float4 vShadowCoord;   // vDirectionalShadowCoord[0]
};

vertex StandardVaryings standard_vs(StandardIn in [[stage_in]],
                                    uint iid [[instance_id]],
                                    const device float4x4* instances [[buffer(MD_BUF_INSTANCES)]],
                                    constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                                    constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                                    constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]],
                                    constant MDStandardMaterial& M [[buffer(MD_BUF_MATERIAL)]]) {
  float3 objectNormal = in.normal;
  ThreeProjected p;
  if (kStdInstanced) {
    float4x4 im = instances[iid];
    objectNormal = threeInstanceNormal(objectNormal, im);
    p = threeProjectInstanced(in.position, im, O.model, F.viewMatrix, F.projMatrix);
  } else {
    p = threeProject(in.position, O.model, F.viewMatrix, F.projMatrix);
  }
  bool flipSided = M.params.w > 0.5f;   // material.side == BackSide
  float3 worldNormal = threeWorldNormal(objectNormal, O.normalMatrix, flipSided);
  StandardVaryings o;
  o.position = p.clip;
  o.vNormal = threeViewNormal(worldNormal, F.viewMatrix);
  o.vWorldNormal = worldNormal;
  o.vWorldPosition = p.worldPosition.xyz;
  o.vFogOff = fogOffset(p.mvPosition, F.viewMatrix);
  o.vShadowCoord = kStdShadows ? threeDirShadowCoord(p.worldPosition, worldNormal, LT) : float4(0.0f);
  return o;
}

fragment float4 standard_fs(StandardVaryings in [[stage_in]],
                            bool frontFacing [[front_facing]],
                            constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                            constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                            constant MDStandardMaterial& M [[buffer(MD_BUF_MATERIAL)]],
                            texture2d<float> dfgLUT [[texture(MD_TEX_DFG)]],
                            texture2d<float> envMap [[texture(MD_TEX_ENV)]],
                            depth2d<float> shadowMap [[texture(MD_TEX_SHADOW)]],
                            sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                            sampler smpShadow [[sampler(MD_SMP_SHADOW)]]) {
  float4 diffuseColor = M.color;
  float roughnessFactor = M.params.x;
  float metalnessFactor = M.params.y;
  bool receiveShadow = M.params.z > 0.5f;
  // normal_fragment_begin (view space for geometryRoughness, world space for the lights)
  float faceDirection = (kStdDoubleSided && !frontFacing) ? -1.0f : 1.0f;
  float3 normalView = normalize(in.vNormal) * faceDirection;
  float3 normal = normalize(in.vWorldNormal) * faceDirection;
  float3 totalEmissiveRadiance = M.emissive.xyz;
  PhysicalMaterial material = makeStandardMaterial(diffuseColor.rgb, metalnessFactor, roughnessFactor, normalView);

  // lights_fragment_begin
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
    MDDirLight dirLight = LT.dir;
    IncidentLight directLight = getDirectionalLightInfo(dirLight);
    if (kStdShadows) {
      directLight.color *= threeDirShadow(LT, shadowMap, smpShadow, in.vShadowCoord, fragCoordGL(in.position, F.timeRes.zw),
                                          directLight.visible, receiveShadow);
    }
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  MDHemiLight hemi = LT.hemi;
  float3 iblIrradiance = float3(0.0f);
  float3 irradiance = getAmbientLightIrradiance(LT.ambientEnv.xyz);
  irradiance += getHemisphereLightIrradiance(hemi, geometryNormal);
  float3 radiance = float3(0.0f);
  // lights_fragment_maps (ENVMAP_TYPE_CUBE_UV, STANDARD)
  if (kStdEnv) {
    float envMapIntensity = LT.ambientEnv.w;
    iblIrradiance += getIBLIrradiance(geometryNormal, envMap, smpClamp, envMapIntensity);
    radiance += getIBLRadiance(geometryViewDir, geometryNormal, material.roughness, envMap, smpClamp, envMapIntensity);
  }
  // lights_fragment_end
  RE_IndirectDiffuse_Physical(irradiance, material, reflectedLight);
  RE_IndirectSpecular_Physical(radiance, iblIrradiance, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);

  float3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  // opaque_fragment → fog_fragment
  float3 color = applyFog(outgoingLight, in.vFogOff, F);
  return float4(color, diffuseColor.a);
}
