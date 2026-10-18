// HullPBR.h — the MeshPhysicalMaterial half of three.js r185 that the heli hull needs on top of
// Common/ThreePBR.h (PLAN D7: «clearcoat (только корпус вертолёта)»):
//   lights_physical_fragment, IOR / USE_SPECULAR branch (MeshPhysicalMaterial defines PHYSICAL → IOR and
//   USE_SPECULAR) and USE_CLEARCOAT branch          → makePhysicalMaterialIOR, makeClearcoat
//   lights_physical_pars_fragment: BRDF_GGX_Clearcoat, EnvironmentBRDF, the clearcoat parts of
//   RE_Direct_Physical / RE_IndirectSpecular_Physical → RE_Direct_Clearcoat, RE_IndirectSpecular_Clearcoat
//   meshphysical.glsl.js main(): the clearcoat layering of outgoingLight → clearcoatComposite
// The base layer uses ThreePBR.h unchanged (RE_Direct_Physical, RE_Indirect*_Physical): in three the
// clearcoat terms are separate accumulators (clearcoatSpecularDirect / Indirect), so splitting the
// functions keeps every operation and its order. World space like ThreePBR.h.
#ifndef MAYDAY_HULL_PBR_H
#define MAYDAY_HULL_PBR_H

#include "../Common/ThreePBR.h"
#include "../Common/IBL.h"

struct ClearcoatMaterial {
  float clearcoat;
  float clearcoatRoughness;
  float3 clearcoatF0;
  float clearcoatF90;
};

// lights_physical_fragment for MeshPhysicalMaterial (IOR + USE_SPECULAR without maps).
inline PhysicalMaterial makePhysicalMaterialIOR(float3 diffuseColor, float metalnessFactor, float roughnessFactor,
                                                float3 nonPerturbedNormalView, float ior, float specularIntensity,
                                                float3 specularColor, thread float& geometryRoughness) {
  PhysicalMaterial material;
  material.diffuseColor = diffuseColor;
  material.diffuseContribution = diffuseColor * (1.0f - metalnessFactor);
  material.metalness = metalnessFactor;
  float3 dxy = max(abs(dfdx(nonPerturbedNormalView)), abs(dfdy(nonPerturbedNormalView)));
  geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);
  material.roughness = max(roughnessFactor, 0.0525f);
  material.roughness += geometryRoughness;
  material.roughness = min(material.roughness, 1.0f);
  float specularIntensityFactor = specularIntensity;
  float3 specularColorFactor = specularColor;
  material.specularF90 = glMix(specularIntensityFactor, 1.0f, metalnessFactor);
  material.specularColor = min(pow2((ior - 1.0f) / (ior + 1.0f)) * specularColorFactor, float3(1.0f)) * specularIntensityFactor;
  material.specularColorBlended = glMix(material.specularColor, diffuseColor, metalnessFactor);
  return material;
}

// lights_physical_fragment, USE_CLEARCOAT (no clearcoat maps).
inline ClearcoatMaterial makeClearcoat(float clearcoat, float clearcoatRoughness, float geometryRoughness) {
  ClearcoatMaterial cc;
  cc.clearcoat = clearcoat;
  cc.clearcoatRoughness = clearcoatRoughness;
  cc.clearcoatF0 = float3(0.04f);
  cc.clearcoatF90 = 1.0f;
  cc.clearcoat = saturate1(cc.clearcoat);
  cc.clearcoatRoughness = max(cc.clearcoatRoughness, 0.0525f);
  cc.clearcoatRoughness += geometryRoughness;
  cc.clearcoatRoughness = min(cc.clearcoatRoughness, 1.0f);
  return cc;
}

inline float3 BRDF_GGX_Clearcoat(float3 lightDir, float3 viewDir, float3 normal, ClearcoatMaterial material) {
  float3 f0 = material.clearcoatF0;
  float f90 = material.clearcoatF90;
  float roughness = material.clearcoatRoughness;
  float alpha = pow2(roughness);
  float3 halfDir = normalize(lightDir + viewDir);
  float dotNL = saturate1(dot(normal, lightDir));
  float dotNV = saturate1(dot(normal, viewDir));
  float dotNH = saturate1(dot(normal, halfDir));
  float dotVH = saturate1(dot(viewDir, halfDir));
  float3 F = F_Schlick(f0, f90, dotVH);
  float V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  float D = D_GGX(alpha, dotNH);
  return F * (V * D);
}

inline float3 EnvironmentBRDF(float3 normal, float3 viewDir, float3 specularColor, float specularF90, float roughness,
                              texture2d<float> dfgLUT, sampler dfgSampler) {
  float dotNV = saturate1(dot(normal, viewDir));
  float2 fab = dfgLUT.sample(dfgSampler, float2(roughness, dotNV), level(0.0f)).rg;
  return specularColor * fab.x + specularF90 * fab.y;
}

// RE_Direct_Physical, USE_CLEARCOAT part (call next to RE_Direct_Physical for the same light).
inline void RE_Direct_Clearcoat(IncidentLight directLight, float3 geometryViewDir, float3 geometryClearcoatNormal,
                                ClearcoatMaterial material, thread float3& clearcoatSpecularDirect) {
  float dotNLcc = saturate1(dot(geometryClearcoatNormal, directLight.direction));
  float3 ccIrradiance = dotNLcc * directLight.color;
  clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(directLight.direction, geometryViewDir, geometryClearcoatNormal, material);
}

// RE_IndirectSpecular_Physical, USE_CLEARCOAT part.
inline void RE_IndirectSpecular_Clearcoat(float3 clearcoatRadiance, float3 geometryViewDir, float3 geometryClearcoatNormal,
                                          ClearcoatMaterial material, thread float3& clearcoatSpecularIndirect,
                                          texture2d<float> dfgLUT, sampler dfgSampler) {
  clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF(geometryClearcoatNormal, geometryViewDir, material.clearcoatF0,
                                                                   material.clearcoatF90, material.clearcoatRoughness, dfgLUT, dfgSampler);
}

// meshphysical.glsl.js: outgoingLight layering under the clearcoat.
inline float3 clearcoatComposite(float3 outgoingLight, float3 geometryClearcoatNormal, float3 geometryViewDir,
                                 ClearcoatMaterial material, float3 clearcoatSpecularDirect, float3 clearcoatSpecularIndirect) {
  float dotNVcc = saturate1(dot(geometryClearcoatNormal, geometryViewDir));
  float3 Fcc = F_Schlick(material.clearcoatF0, material.clearcoatF90, dotNVcc);
  return outgoingLight * (1.0f - material.clearcoat * Fcc) + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
}

#endif // MAYDAY_HULL_PBR_H
