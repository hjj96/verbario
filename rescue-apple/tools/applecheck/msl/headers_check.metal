// headers_check.metal — compiled ONLY by check-msl.sh (never part of the app's metallib): reaches every
// function of the shared shader headers that no ported family calls yet, so the shim type-checks them
// too (an unused inline function in a header is otherwise never parsed against real call sites).
#include "ShaderTypes.h"
#include "Common/GL.h"
#include "Common/Common.h"
#include "Common/Noise.h"
#include "Common/Look.h"
#include "Common/Fog.h"
#include "Common/ACES.h"
#include "Common/ThreeVertex.h"
#include "Common/ThreePBR.h"
#include "Common/Shadow.h"

struct HCOut {
  float4 position [[position]];
  float3 vNormal;
  float4 vShadowCoord;
};

vertex HCOut headers_check_vs(uint vid [[vertex_id]],
                              const device float3* positions [[buffer(MD_BUF_VERTICES)]],
                              constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                              constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                              constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  float3 objectNormal = float3(0.0f, 1.0f, 0.0f);
  float3 n = threeInstanceNormal(objectNormal, O.model);
  float3 wn = threeWorldNormal(n, O.normalMatrix, false);
  ThreeProjected p = threeProject(positions[vid], O.model, F.viewMatrix, F.projMatrix);
  ThreeProjected pi = threeProjectInstanced(positions[vid], O.model, O.model, F.viewMatrix, F.projMatrix);
  HCOut o;
  o.position = p.clip + pi.clip * 0.0f;
  o.vNormal = threeViewNormal(wn, F.viewMatrix);
  o.vShadowCoord = threeDirShadowCoord(p.worldPosition, wn, LT);
  return o;
}

fragment float4 headers_check_fs(HCOut in [[stage_in]],
                                 constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                                 constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                                 constant MDLightsUniforms& LT [[buffer(MD_BUF_LIGHTS)]],
                                 texture2d<float> atlas [[texture(MD_TEX_ATLAS)]],
                                 depth2d<float> shadowMap [[texture(MD_TEX_SHADOW)]],
                                 texture2d<float> dfgLUT [[texture(MD_TEX_DFG)]],
                                 sampler smpLook [[sampler(MD_SMP_LOOK)]],
                                 sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                                 sampler smpShadow [[sampler(MD_SMP_SHADOW)]]) {
  float2 fc = fragCoordGL(in.position, F.timeRes.zw);
  float3 nView = normalize(in.vNormal);
  PhysicalMaterial m = makeStandardMaterial(float3(0.5f), 0.0f, 0.6f, nView);
  ReflectedLight rl = makeReflectedLight();
  MDDirLight dl = LT.dir;
  IncidentLight sun = getDirectionalLightInfo(dl);
  sun.color *= threeDirShadow(LT, shadowMap, smpShadow, in.vShadowCoord, fc, sun.visible, true);
  RE_Direct_Physical(sun, nView, nView, m, rl, dfgLUT, smpClamp);
  MDSpotLight sl = LT.spot[0];
  RE_Direct_Physical(getSpotLightInfo(sl, float3(0.0f)), nView, nView, m, rl, dfgLUT, smpClamp);
  MDPointLight pl = LT.point[0];
  RE_Direct_Physical(getPointLightInfo(pl, float3(0.0f)), nView, nView, m, rl, dfgLUT, smpClamp);
  MDHemiLight hl = LT.hemi;
  float3 irr = getHemisphereLightIrradiance(hl, nView);
  float g = lookGust(fc, L, atlas, smpLook) + lookFronts(fc, L) + lookCloud(fc, L, atlas, smpLook) + fbm(fc) + sq(glMod(1.0f, 0.3f));
  float3 c = rl.directDiffuse + rl.directSpecular + irr * g;
  c = applyFog(c, fogOffset(float4(in.vNormal, 1.0f), F.viewMatrix), F);
  c = sRGBTransferOETF(ACESFilmicToneMapping(c, 1.0f)) + sRGBTransferEOTF(c) * 0.0f;
  return float4(c + pow2(glDFdy(g)) + float(pow4(g)), 1.0f);
}
