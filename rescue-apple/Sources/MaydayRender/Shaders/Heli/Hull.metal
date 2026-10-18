// Hull.metal — port: rescue/src/systems/heli/materials.js createHullMaterial (PLAN §3.3 #28): ONE
// MeshPhysicalMaterial for the merged airframe (heli.hull) and the rotor hub (heli.rotorHub), with the
// shared core/weathering.js patch pulled into the airframe's LOCAL frame, assembled in three r185's
// meshphysical chunk order:
//   vertex   beginnormal / defaultnormal → begin_vertex (+ vSurf, vDecalUv, vLocal, vLN) → weathering
//            VERT_MAIN without the modelMatrix products (vWxPos = transformed, vWxNrm = objectNormal) →
//            project / worldpos → shadowmap_vertex → fog_vertex
//   fragment diffuseColor (white × vertex colour) → color_fragment hook (decal atlas, panel lines, salt
//            haze, oil streaks, exhaust soot) → roughnessmap hook (aSurf roughness, keep for glass) →
//            weathering FRAG_MAIN → metalnessmap hook (aSurf metalness, glass restored) → normal → emissive
//            hook (rim, instruments, lamp spill, night fill) → lights_physical (IOR, clearcoat × aSurf.z) →
//            lights begin / maps / end (+ clearcoat accumulators) → uSunScale on ALL direct light →
//            outgoingLight + clearcoat layering → fog. Tone mapping / colour space: dropped (HDR target, D10).
// aSurf = (roughness, metalness, clearcoat weight, flags: 0 paint/metal, 1 decal, 2 glass + instruments).
// Deviations (PLAN §10): the soot plume's pow(x, 2.0) with a possibly negative base → sq() (rule 2 / X12);
// the decal atlas texel is fetched before the decal branch (rule 3: implicit LOD out of a branch).
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "../Common/ThreeVertex.h"
#include "../Common/ThreePBR.h"
#include "../Common/IBL.h"
#include "../Common/Shadow.h"
#include "../Common/Fog.h"
#include "HeliShaderTypes.h"
#include "HullPBR.h"
#include "Weathering.h"

constant bool kHullShadows [[function_constant(MD_FC_SHADOWS)]];
constant bool kHullEnv [[function_constant(MD_FC_STD_ENV)]];

struct HullIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
  float3 normal [[attribute(MD_ATTR_NORMAL)]];
  float2 uv [[attribute(MD_ATTR_UV)]];
  float3 color [[attribute(MD_ATTR_COLOR)]];
  float4 surf [[attribute(MD_ATTR_SURF)]];
};

struct HullVaryings {
  float4 position [[position]];
  float3 vNormal;        // view-space normal (three vNormal: geometryRoughness input)
  float3 vWorldNormal;   // world-space normal (lighting)
  float3 vWorldPosition;
  float3 vFogOff;
  float4 vShadowCoord;
  float3 vColor;         // color_vertex (USE_COLOR)
  float4 vSurf;          // aSurf
  float2 vDecalUv;       // uv (decal atlas coordinates on decal patches)
  float3 vLocal;         // airframe-local position (panel lines, soot, spill)
  float3 vLN;            // airframe-local normal
  float3 vWxNrm;         // weathering: normalize(objectNormal), local (vWxPos = vLocal)
};

vertex HullVaryings hull_vs(HullIn in [[stage_in]],
                            constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                            constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                            constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  float3 objectNormal = in.normal;
  float3 transformed = in.position;
  ThreeProjected p = threeProject(transformed, O.model, F.viewMatrix, F.projMatrix);
  float3 worldNormal = threeWorldNormal(objectNormal, O.normalMatrix, false);
  HullVaryings o;
  o.position = p.clip;
  o.vNormal = threeViewNormal(worldNormal, F.viewMatrix);
  o.vWorldNormal = worldNormal;
  o.vWorldPosition = p.worldPosition.xyz;
  o.vFogOff = fogOffset(p.mvPosition, F.viewMatrix);
  o.vShadowCoord = kHullShadows ? threeDirShadowCoord(p.worldPosition, worldNormal, LT) : float4(0.0f);
  o.vColor = float3(1.0f) * in.color;
  o.vSurf = in.surf;
  o.vDecalUv = in.uv;
  o.vLocal = in.position;
  o.vLN = in.normal;
  o.vWxNrm = normalize(objectNormal);
  return o;
}

fragment float4 hull_fs(HullVaryings in [[stage_in]],
                        constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                        constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                        constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                        constant MDHullUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                        texture2d<float> atlas [[texture(MD_TEX_ATLAS)]],
                        texture2d<float> decal [[texture(MD_TEX_HELI_DECAL)]],
                        texture2d<float> dfgLUT [[texture(MD_TEX_DFG)]],
                        texture2d<float> envMap [[texture(MD_TEX_ENV)]],
                        depth2d<float> shadowMap [[texture(MD_TEX_SHADOW)]],
                        sampler smpLook [[sampler(MD_SMP_LOOK)]],
                        sampler smpDecal [[sampler(MD_SMP_HELI_DECAL)]],
                        sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                        sampler smpShadow [[sampler(MD_SMP_SHADOW)]]) {
  const float uWet = L.windOffsetWetFlash.z;
  const float3 uRim = U.uRim.xyz;
  const float uSunScale = U.uRim.w;
  const float3 uFill = U.uFill.xyz;
  const float uSoot = U.uFill.w;
  const float3 uInstr = U.uInstr.xyz;
  float4 vSurf = in.vSurf;

  float4 diffuseColor = U.diffuseOpacity;
  // color_fragment (USE_COLOR)
  float3 albedo = diffuseColor.rgb * in.vColor;
  // ---- hull color_fragment hook -------------------------------------------------------------------
  float4 dc = decal.sample(smpDecal, in.vDecalUv);
  if (abs(vSurf.w - 1.0f) < 0.5f) albedo = glMix(albedo, dc.rgb, dc.a);
  float hNotGlass = 1.0f - step(1.5f, vSurf.w);
  float hPaint = step(0.9f, vSurf.z) * (1.0f - step(0.5f, vSurf.w)); // clearcoated paint, no decal / glass
  float3 hp = in.vLocal;
  float3 hn = normalize(in.vLN);
  // panel lines: frames along the lathe, stringers, door edges, engine-cowling seams
  float dl = abs(fract(hp.z / 1.05f + 0.37f) - 0.5f) * 1.05f;
  if (abs(hp.x) > 0.55f && hp.z < 3.6f) dl = min(dl, min(abs(hp.y - 0.62f), abs(hp.y + 0.48f)));
  if (abs(hp.x) > 0.5f && hp.z > -2.1f && hp.z < -0.5f) dl = min(dl, min(abs(hp.y + 0.67f), abs(hp.y - 0.87f)));
  if (hp.y > 1.08f && hp.z > -1.3f && hp.z < 2.7f) dl = min(dl, abs(abs(hp.x) - 0.45f));
  float dfw = max(fwidth(dl), 1e-4f);
  float pline = clamp((0.011f - dl) / dfw + 0.5f, 0.0f, 1.0f) * min(1.0f, 0.022f / dfw);
  albedo *= 1.0f - 0.34f * pline * hPaint;
  // salt haze on the lower 30 % of the airframe: +8 % value, −10 % saturation, patchy
  float saltM = (1.0f - glSmoothstep(-0.6f, -0.15f, hp.y)) * (0.55f + 0.45f * atlas.sample(smpLook, hp.xz * 0.35f + hp.y * 0.2f).g) * hNotGlass;
  float hLum = dot(albedo, float3(0.2126f, 0.7152f, 0.0722f));
  albedo = glMix(albedo, float3(hLum), 0.10f * saltM) * (1.0f + 0.08f * saltM);
  // oil / hydraulic streaks on the belly under the transmission deck, run back by the airflow
  float oilN = atlas.sample(smpLook, float2(hp.x * 1.7f + 0.3f, hp.z * 0.11f + 0.5f)).r;
  float oil = glSmoothstep(-0.15f, -0.7f, hn.y) * glSmoothstep(-1.9f, -0.9f, hp.z) * (1.0f - glSmoothstep(2.4f, 4.4f, hp.z)) * glSmoothstep(0.42f, 0.72f, oilN);
  float runN = atlas.sample(smpLook, float2(hp.z * 2.6f, hp.y * 0.18f + 0.2f)).r;
  oil += (1.0f - abs(hn.y)) * glSmoothstep(1.2f, 1.8f, hp.z) * (1.0f - glSmoothstep(2.6f, 3.6f, hp.z)) * glSmoothstep(1.0f, 0.3f, hp.y) * glSmoothstep(0.5f, 0.75f, runN) * 0.7f;
  albedo = glMix(albedo, float3(0.05f, 0.04f, 0.032f), clamp(oil, 0.0f, 1.0f) * 0.5f * hNotGlass);
  // exhaust soot: two plumes from the outlets (x ±.86, z 2.7) back over the boom roof and upper sides
  float dzx = max(hp.z - 2.6f, 0.0f);
  float plume = exp(-sq((abs(hp.x) - max(0.86f - 0.16f * dzx, 0.1f)) / (0.22f + 0.09f * dzx)))
              * glSmoothstep(2.2f, 2.75f, hp.z) * exp(-dzx / 3.4f) * glSmoothstep(-0.15f, 0.55f, hn.y);
  float sootN = atlas.sample(smpLook, float2(hp.x * 2.3f, hp.z * 0.2f)).r;
  float soot = uSoot * plume * (0.4f + 1.0f * sootN);
  albedo = glMix(albedo, float3(0.03f, 0.028f, 0.026f), clamp(soot * 0.9f, 0.0f, 0.92f) * hNotGlass);

  // roughnessmap_fragment (no map) + hull hook
  float roughnessFactor = U.physical.x;
  roughnessFactor = clamp(vSurf.x - 0.1f * uWet + 0.12f * pline - 0.12f * oil + 0.2f * soot, 0.04f, 1.0f);
  float3 hKeepC = albedo;
  float hKeepR = roughnessFactor;
  // core/weathering.js FRAG_MAIN in the airframe's local frame
  applyWeathering(albedo, roughnessFactor, in.vLocal, in.vWxNrm, U.wx, uWet, atlas, smpLook);
  // metalnessmap_fragment (no map) + hull hook: glass stays clean
  float metalnessFactor = U.physical.y;
  metalnessFactor = vSurf.y;
  if (vSurf.w > 1.5f) {
    albedo = hKeepC;
    roughnessFactor = hKeepR;
  }
  diffuseColor.rgb = albedo;

  // normal_fragment_begin (FrontSide: no face flip), clearcoat_normal_fragment_begin
  float3 normalView = normalize(in.vNormal);
  float3 normal = normalize(in.vWorldNormal);
  float3 clearcoatNormal = normal;
  float3 viewDir = normalize(F.cameraPosition.xyz - in.vWorldPosition); // normalize(vViewPosition), world space

  // emissivemap_fragment (emissive 0) + hull hook
  float3 totalEmissiveRadiance = float3(0.0f);
  float hullRim = pow(1.0f - saturate1(dot(normal, viewDir)), 3.0f);
  totalEmissiveRadiance += uRim * hullRim * 0.35f * (1.0f - step(1.5f, vSurf.w));
  if (abs(vSurf.w - 2.0f) < 0.5f)
    totalEmissiveRadiance += uInstr * (0.15f + 0.85f * glSmoothstep(-3.7f, -4.4f, in.vLocal.z) * glSmoothstep(0.2f, 0.75f, in.vLocal.y));
  // light spill from the airframe's own lamps — at night the strobes and beacon paint the hull
  float3 hullGlow = float3(0.0f);
  for (int i = 0; i < MD_HULL_GLOWS; i++) {
    float3 gd = in.vLocal - U.uGlowPos[i].xyz;
    hullGlow += U.uGlowCol[i].xyz * exp(-dot(gd, gd) / (U.uGlowPos[i].w * U.uGlowPos[i].w));
  }
  totalEmissiveRadiance += hullGlow * diffuseColor.rgb;
  // night fill: top surfaces catch a little moonlight so the silhouette reads on black water
  totalEmissiveRadiance += uFill * diffuseColor.rgb * (0.55f + 0.45f * saturate1(dot(normal, viewDir))) * (1.0f - step(1.5f, vSurf.w));

  // lights_physical_fragment (IOR, USE_SPECULAR, USE_CLEARCOAT) + hull hook (clearcoat × aSurf.z)
  float geometryRoughness = 0.0f;
  PhysicalMaterial material = makePhysicalMaterialIOR(diffuseColor.rgb, metalnessFactor, roughnessFactor, normalView,
                                                      U.iorShadow.x, U.specular.w, U.specular.xyz, geometryRoughness);
  ClearcoatMaterial cc = makeClearcoat(U.physical.z, U.physical.w, geometryRoughness);
  cc.clearcoat *= vSurf.z;

  // lights_fragment_begin
  float3 geometryPosition = in.vWorldPosition;
  float3 geometryNormal = normal;
  float3 geometryViewDir = viewDir;
  float3 geometryClearcoatNormal = clearcoatNormal;
  bool receiveShadow = U.iorShadow.y > 0.5f;
  ReflectedLight reflectedLight = makeReflectedLight();
  float3 clearcoatSpecularDirect = float3(0.0f);
  float3 clearcoatSpecularIndirect = float3(0.0f);
  for (int i = 0; i < MD_POINT_LIGHTS; i++) {
    MDPointLight pl = LT.point[i];
    if (pl.color.x + pl.color.y + pl.color.z <= 0.0f) continue;
    IncidentLight directLight = getPointLightInfo(pl, geometryPosition);
    RE_Direct_Clearcoat(directLight, geometryViewDir, geometryClearcoatNormal, cc, clearcoatSpecularDirect);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  for (int i = 0; i < MD_SPOT_LIGHTS; i++) {
    MDSpotLight sl = LT.spot[i];
    if (sl.color.x + sl.color.y + sl.color.z <= 0.0f) continue;
    IncidentLight directLight = getSpotLightInfo(sl, geometryPosition);
    RE_Direct_Clearcoat(directLight, geometryViewDir, geometryClearcoatNormal, cc, clearcoatSpecularDirect);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  {
    IncidentLight directLight = getDirectionalLightInfo(LT.dir);
    if (kHullShadows) {
      directLight.color *= threeDirShadow(LT, shadowMap, smpShadow, in.vShadowCoord, fragCoordGL(in.position, F.timeRes.zw),
                                          directLight.visible, receiveShadow);
    }
    RE_Direct_Clearcoat(directLight, geometryViewDir, geometryClearcoatNormal, cc, clearcoatSpecularDirect);
    RE_Direct_Physical(directLight, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  }
  float3 iblIrradiance = float3(0.0f);
  float3 irradiance = getAmbientLightIrradiance(LT.ambientEnv.xyz);
  irradiance += getHemisphereLightIrradiance(LT.hemi, geometryNormal);
  float3 radiance = float3(0.0f);
  float3 clearcoatRadiance = float3(0.0f);
  // lights_fragment_maps (ENVMAP_TYPE_CUBE_UV, STANDARD, USE_CLEARCOAT)
  if (kHullEnv) {
    float envMapIntensity = LT.ambientEnv.w;
    iblIrradiance += getIBLIrradiance(geometryNormal, envMap, smpClamp, envMapIntensity);
    radiance += getIBLRadiance(geometryViewDir, geometryNormal, material.roughness, envMap, smpClamp, envMapIntensity);
    clearcoatRadiance += getIBLRadiance(geometryViewDir, geometryClearcoatNormal, cc.clearcoatRoughness, envMap, smpClamp, envMapIntensity);
  }
  // lights_fragment_end
  RE_IndirectDiffuse_Physical(irradiance, material, reflectedLight);
  RE_IndirectSpecular_Clearcoat(clearcoatRadiance, geometryViewDir, geometryClearcoatNormal, cc, clearcoatSpecularIndirect, dfgLUT, smpClamp);
  RE_IndirectSpecular_Physical(radiance, iblIrradiance, geometryNormal, geometryViewDir, material, reflectedLight, dfgLUT, smpClamp);
  // hull hook: the cloud shadow scales the whole direct term (not the clearcoat accumulators)
  reflectedLight.directDiffuse *= uSunScale;
  reflectedLight.directSpecular *= uSunScale;

  float3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  outgoingLight = clearcoatComposite(outgoingLight, geometryClearcoatNormal, geometryViewDir, cc, clearcoatSpecularDirect, clearcoatSpecularIndirect);
  // opaque_fragment → fog_fragment
  float3 color = applyFog(outgoingLight, in.vFogOff, F);
  return float4(color, diffuseColor.a);
}
