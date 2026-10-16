// ThreePBR.h — port of the three.js r185 MeshStandardMaterial lighting subset (PLAN D7, §2.5):
//   common (BRDF_Lambert, F_Schlick), lights_pars_begin (getDistanceAttenuation, getSpotAttenuation,
//   get*LightInfo, getHemisphereLightIrradiance), lights_physical_pars_fragment (V_GGX_SmithCorrelated,
//   D_GGX, BRDF_GGX, BRDF_GGX_Multiscatter with the DFG LUT, RE_Direct_Physical) and
//   lights_physical_fragment (PhysicalMaterial setup incl. geometryRoughness), and the indirect half
//   (computeMultiscattering, RE_IndirectDiffuse_Physical, RE_IndirectSpecular_Physical) fed by the
//   PMREM environment of Common/IBL.h.
//
// Differences from three, all result-neutral:
//   * lighting runs in WORLD space (three: view space) — only dot products of unit vectors, which a
//     rotation preserves; geometryRoughness still uses the VIEW-space normal derivatives like three;
//   * the light arrays are the fixed CONTRACT set; an unused light has zero colour;
//   * the DFG LUT (three's 16² RG half-float table, exported to Resources/Textures/dfg_lut.rg16f) is
//     sampled with level(0): it has no mips, so implicit and explicit LOD give the same texel and the
//     call is safe inside light loops (non-uniform control flow).
#ifndef MAYDAY_THREE_PBR_H
#define MAYDAY_THREE_PBR_H

#include "Common.h"
#include "../ShaderTypes.h"

struct IncidentLight {
  float3 color;
  float3 direction;
  bool visible;
};

struct ReflectedLight {
  float3 directDiffuse;
  float3 directSpecular;
  float3 indirectDiffuse;
  float3 indirectSpecular;
};

struct PhysicalMaterial {
  float3 diffuseColor;
  float3 diffuseContribution;
  float3 specularColor;
  float3 specularColorBlended;
  float roughness;
  float metalness;
  float specularF90;
};

inline ReflectedLight makeReflectedLight() {
  ReflectedLight r;
  r.directDiffuse = float3(0.0f);
  r.directSpecular = float3(0.0f);
  r.indirectDiffuse = float3(0.0f);
  r.indirectSpecular = float3(0.0f);
  return r;
}

inline float3 BRDF_Lambert(float3 diffuseColor) {
  return MD_RECIPROCAL_PI * diffuseColor;
}

inline float3 F_Schlick(float3 f0, float f90, float dotVH) {
  float fresnel = exp2((-5.55473f * dotVH - 6.98316f) * dotVH);
  return f0 * (1.0f - fresnel) + (f90 * fresnel);
}

inline float V_GGX_SmithCorrelated(float alpha, float dotNL, float dotNV) {
  float a2 = pow2(alpha);
  float gv = dotNL * sqrt(a2 + (1.0f - a2) * pow2(dotNV));
  float gl = dotNV * sqrt(a2 + (1.0f - a2) * pow2(dotNL));
  return 0.5f / max(gv + gl, MD_EPSILON);
}

inline float D_GGX(float alpha, float dotNH) {
  float a2 = pow2(alpha);
  float denom = pow2(dotNH) * (a2 - 1.0f) + 1.0f;
  return MD_RECIPROCAL_PI * a2 / pow2(denom);
}

inline float3 BRDF_GGX(float3 lightDir, float3 viewDir, float3 normal, thread const PhysicalMaterial& material) {
  float3 f0 = material.specularColorBlended;
  float f90 = material.specularF90;
  float roughness = material.roughness;
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

// r185 BRDF_GGX_Multiscatter (energy compensation with the DFG LUT, Fdez-Agüera).
inline float3 BRDF_GGX_Multiscatter(float3 lightDir, float3 viewDir, float3 normal,
                                    thread const PhysicalMaterial& material,
                                    texture2d<float> dfgLUT, sampler dfgSampler) {
  float3 singleScatter = BRDF_GGX(lightDir, viewDir, normal, material);
  float dotNL = saturate1(dot(normal, lightDir));
  float dotNV = saturate1(dot(normal, viewDir));
  float2 dfgV = dfgLUT.sample(dfgSampler, float2(material.roughness, dotNV), level(0.0f)).rg;
  float2 dfgL = dfgLUT.sample(dfgSampler, float2(material.roughness, dotNL), level(0.0f)).rg;
  float3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
  float3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
  float Ess_V = dfgV.x + dfgV.y;
  float Ess_L = dfgL.x + dfgL.y;
  float Ems_V = 1.0f - Ess_V;
  float Ems_L = 1.0f - Ess_L;
  float3 Favg = material.specularColorBlended + (1.0f - material.specularColorBlended) * 0.047619f;
  float3 Fms = FssEss_V * FssEss_L * Favg / (1.0f - Ems_V * Ems_L * Favg + MD_EPSILON);
  float compensationFactor = Ems_V * Ems_L;
  float3 multiScatter = Fms * compensationFactor;
  return singleScatter + multiScatter;
}

// lights_physical_fragment for MeshStandardMaterial (no IOR / clearcoat / sheen / iridescence).
// nonPerturbedNormalView: normalize(vNormal) in VIEW space (three's geometryRoughness input).
inline PhysicalMaterial makeStandardMaterial(float3 diffuseColor, float metalnessFactor, float roughnessFactor,
                                             float3 nonPerturbedNormalView) {
  PhysicalMaterial material;
  material.diffuseColor = diffuseColor;
  material.diffuseContribution = diffuseColor * (1.0f - metalnessFactor);
  material.metalness = metalnessFactor;
  float3 dxy = max(abs(dfdx(nonPerturbedNormalView)), abs(dfdy(nonPerturbedNormalView)));
  float geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);
  material.roughness = max(roughnessFactor, 0.0525f);
  material.roughness += geometryRoughness;
  material.roughness = min(material.roughness, 1.0f);
  material.specularColor = float3(0.04f);
  material.specularColorBlended = glMix(material.specularColor, diffuseColor, metalnessFactor);
  material.specularF90 = 1.0f;
  return material;
}

inline void RE_Direct_Physical(IncidentLight directLight, float3 geometryNormal, float3 geometryViewDir,
                               thread const PhysicalMaterial& material, thread ReflectedLight& reflectedLight,
                               texture2d<float> dfgLUT, sampler dfgSampler) {
  float dotNL = saturate1(dot(geometryNormal, directLight.direction));
  float3 irradiance = dotNL * directLight.color;
  reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter(directLight.direction, geometryViewDir, geometryNormal, material, dfgLUT, dfgSampler);
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert(material.diffuseContribution);
}

// ---- light info (lights_pars_begin) --------------------------------------------------------------
inline float getDistanceAttenuation(float lightDistance, float cutoffDistance, float decayExponent) {
  float distanceFalloff = 1.0f / max(pow(lightDistance, decayExponent), 0.01f);
  if (cutoffDistance > 0.0f) {
    distanceFalloff *= pow2(saturate1(1.0f - pow4(lightDistance / cutoffDistance)));
  }
  return distanceFalloff;
}

inline float getSpotAttenuation(float coneCosine, float penumbraCosine, float angleCosine) {
  return glSmoothstep(coneCosine, penumbraCosine, angleCosine);
}

inline IncidentLight getDirectionalLightInfo(MDDirLight directionalLight) {
  IncidentLight light;
  light.color = directionalLight.color.xyz;
  light.direction = directionalLight.direction.xyz;
  light.visible = true;
  return light;
}

inline IncidentLight getPointLightInfo(MDPointLight pointLight, float3 geometryPosition) {
  IncidentLight light;
  float3 lVector = pointLight.position.xyz - geometryPosition;
  light.direction = normalize(lVector);
  float lightDistance = length(lVector);
  light.color = pointLight.color.xyz;
  light.color *= getDistanceAttenuation(lightDistance, pointLight.params.x, pointLight.params.y);
  light.visible = any(light.color != float3(0.0f));
  return light;
}

// MDSpotLight.direction points FROM the light toward its target; three's spotLight.direction is the
// opposite (position − target), so angleCos = dot(L, −axis).
inline IncidentLight getSpotLightInfo(MDSpotLight spotLight, float3 geometryPosition) {
  IncidentLight light;
  float3 lVector = spotLight.position.xyz - geometryPosition;
  light.direction = normalize(lVector);
  float angleCos = dot(light.direction, -spotLight.direction.xyz);
  float spotAttenuation = getSpotAttenuation(spotLight.params.z, spotLight.params.w, angleCos);
  if (spotAttenuation > 0.0f) {
    float lightDistance = length(lVector);
    light.color = spotLight.color.xyz * spotAttenuation;
    light.color *= getDistanceAttenuation(lightDistance, spotLight.params.x, spotLight.params.y);
    light.visible = any(light.color != float3(0.0f));
  } else {
    light.color = float3(0.0f);
    light.visible = false;
  }
  return light;
}

inline float3 getHemisphereLightIrradiance(MDHemiLight hemiLight, float3 normal) {
  float dotNL = dot(normal, hemiLight.direction.xyz);
  float hemiDiffuseWeight = 0.5f * dotNL + 0.5f;
  return glMix(hemiLight.groundColor.xyz, hemiLight.skyColor.xyz, hemiDiffuseWeight);
}

// lights_pars_begin: physically correct mode, no π.
inline float3 getAmbientLightIrradiance(float3 ambientLightColor) {
  float3 irradiance = ambientLightColor;
  return irradiance;
}

// ---- indirect light (lights_physical_pars_fragment; IBL inputs from Common/IBL.h) ---------------------
// lights_fragment_begin → maps → end, for MeshStandardMaterial with scene.environment:
//   irradiance  = getAmbientLightIrradiance(ambient) + Σ getHemisphereLightIrradiance(hemi, N)
//   iblIrradiance = getIBLIrradiance(N);  radiance = getIBLRadiance(V, N, material.roughness)
//   RE_IndirectDiffuse_Physical(irradiance, …);  RE_IndirectSpecular_Physical(radiance, iblIrradiance, …)

inline void computeMultiscattering(float3 normal, float3 viewDir, float3 specularColor, float specularF90, float roughness,
                                   thread float3& singleScatter, thread float3& multiScatter,
                                   texture2d<float> dfgLUT, sampler dfgSampler) {
  float dotNV = saturate1(dot(normal, viewDir));
  float2 fab = dfgLUT.sample(dfgSampler, float2(roughness, dotNV), level(0.0f)).rg;
  float3 Fr = specularColor;
  float3 FssEss = Fr * fab.x + specularF90 * fab.y;
  float Ess = fab.x + fab.y;
  float Ems = 1.0f - Ess;
  float3 Favg = Fr + (1.0f - Fr) * 0.047619f;
  float3 Fms = FssEss * Favg / (1.0f - Ems * Favg);
  singleScatter += FssEss;
  multiScatter += Fms * Ems;
}

inline void RE_IndirectDiffuse_Physical(float3 irradiance, thread const PhysicalMaterial& material,
                                        thread ReflectedLight& reflectedLight) {
  float3 diffuse = irradiance * BRDF_Lambert(material.diffuseContribution);
  reflectedLight.indirectDiffuse += diffuse;
}

inline void RE_IndirectSpecular_Physical(float3 radiance, float3 irradiance, float3 geometryNormal, float3 geometryViewDir,
                                         thread const PhysicalMaterial& material, thread ReflectedLight& reflectedLight,
                                         texture2d<float> dfgLUT, sampler dfgSampler) {
  float3 singleScatteringDielectric = float3(0.0f);
  float3 multiScatteringDielectric = float3(0.0f);
  float3 singleScatteringMetallic = float3(0.0f);
  float3 multiScatteringMetallic = float3(0.0f);
  computeMultiscattering(geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness,
                         singleScatteringDielectric, multiScatteringDielectric, dfgLUT, dfgSampler);
  computeMultiscattering(geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness,
                         singleScatteringMetallic, multiScatteringMetallic, dfgLUT, dfgSampler);
  float3 singleScattering = glMix(singleScatteringDielectric, singleScatteringMetallic, material.metalness);
  float3 multiScattering = glMix(multiScatteringDielectric, multiScatteringMetallic, material.metalness);
  float3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
  float3 diffuse = material.diffuseContribution * (1.0f - totalScatteringDielectric);
  float3 cosineWeightedIrradiance = irradiance * MD_RECIPROCAL_PI;
  float3 indirectSpecular = radiance * singleScattering;
  indirectSpecular += multiScattering * cosineWeightedIrradiance;
  float3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
  reflectedLight.indirectSpecular += indirectSpecular;
  reflectedLight.indirectDiffuse += indirectDiffuse;
}

#endif // MAYDAY_THREE_PBR_H
