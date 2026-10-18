// Cone.metal — port: rescue/src/systems/heli/materials.js createConeMaterial (PLAN §3.3 #31): the searchlight
// shaft as single scattering. The cone mesh (heli_searchlight_cone.mmesh: CylinderGeometry(0, 1, 1, 28, 6,
// open) moved to apex y = 0, scaled per frame by MaydayCore Searchlight.cone) is only a proxy drawn with
// FRONT faces; each fragment solves the analytic cone (apex uApex, axis uAxis, cos² uCos2) from the entry
// point, clips at the water end and integrates the in-scatter along the chord with 6 jittered samples
// (equi-asinh: integrand ∝ 1/d from the lamp), × the beam profile, × drifting mist noise (look atlas),
// × a Henyey-Greenstein phase (g .45), × a fade over the last 3.5 m.
// ShaderMaterial: transparent, depthWrite off, AdditiveBlending (SRC_ALPHA, ONE), FrontSide, no fog.
// Changes that keep the result: the `sB > 1e5` discard moves to the end (texture samples stay in uniform
// control flow, PLAN §3.1 rule 3); the unused `cd = dot(CO, uAxis)` of the GLSL is omitted;
// gl_FragCoord → fragCoordGL (GL.h) so the jitter matches the web per pixel.
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "HeliShaderTypes.h"

struct ConeIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
};

struct ConeVaryings {
  float4 position [[position]];
  float3 vW;
};

inline float coneAsinh(float x) { return log(x + sqrt(x * x + 1.0f)); }
inline float coneSinh(float x) { float e = exp(x); return 0.5f * (e - 1.0f / e); }

vertex ConeVaryings cone_vs(ConeIn in [[stage_in]],
                            constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                            constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  ConeVaryings o;
  float4 wp = O.model * float4(in.position, 1.0f);
  o.vW = wp.xyz;
  o.position = F.projMatrix * (F.viewMatrix * wp);
  return o;
}

fragment float4 cone_fs(ConeVaryings in [[stage_in]],
                        constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                        constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                        constant MDConeUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                        texture2d<float> uAtlas [[texture(MD_TEX_ATLAS)]],
                        sampler smpLook [[sampler(MD_SMP_LOOK)]]) {
  const float3 cameraPosition = F.cameraPosition.xyz;
  const float uTime = L.timeWindRain.x;
  const float2 uWindOffset = L.windOffsetWetFlash.xy;
  const float3 uColor = U.uColorDensity.xyz;
  const float uDensity = U.uColorDensity.w;
  const float3 uApex = U.uApexIntensity.xyz;
  const float uIntensity = U.uApexIntensity.w;
  const float3 uAxis = U.uAxisLen.xyz;
  const float uLen = U.uAxisLen.w;
  const float uCos2 = U.cosTan.x;
  const float uTanA = U.cosTan.y;
  float3 vW = in.vW;

  float3 R = normalize(vW - cameraPosition);
  float3 CO = cameraPosition - uApex;
  float rd = dot(R, uAxis);
  float tA = length(vW - cameraPosition);
  // exit: solve the cone quadric from the entry fragment itself (P0 on the wall, s = 0 is the entry root);
  // the far root on the lower nappe is the side exit, else the beam leaves through the water end.
  float3 P0 = vW - uApex;
  float c0 = dot(P0, uAxis);
  float qa = rd * rd - uCos2;
  float qb = 2.0f * (rd * c0 - uCos2 * dot(R, P0));
  float qc = c0 * c0 - uCos2 * dot(P0, P0);
  float disc = qb * qb - 4.0f * qa * qc;
  float sB = 1e6f;
  if (disc > 0.0f && abs(qa) > 1e-6f) {
    float sqd = sqrt(disc);
    float sF = max((-qb - sqd) / (2.0f * qa), (-qb + sqd) / (2.0f * qa));
    if (sF > 0.05f && c0 + sF * rd > 0.0f) sB = sF;
  }
  if (rd > 1e-4f) {
    float sp = (uLen - c0) / rd;
    if (sp > 0.0f) sB = min(sB, sp);
  }
  bool noExit = sB > 1e5f;                       // GLSL: if (sB > 1e5) discard;  (moved to the end)
  float tB = tA + sB;
  // equi-asinh sampling of ∫ f(t)/d(t) dt (d = distance to the lamp); the lamp is a 0.5 m reflector seen
  // through its own glare: soften 1/d by ~1.6 m so the first metres never go white-hot
  float t0 = -dot(CO, R);
  float h = sqrt(max(dot(CO, CO) - t0 * t0, 0.0f) + 2.5f);
  float ua = coneAsinh((tA - t0) / h);
  float ub = coneAsinh((tB - t0) / h);
  float jit = fract(52.9829189f * fract(dot(fragCoordGL(in.position, F.timeRes.zw), float2(0.06711056f, 0.00583715f))));
  float sum = 0.0f;
  for (int i = 0; i < 6; i++) {
    float u = glMix(ua, ub, (float(i) + jit) / 6.0f);
    float t = t0 + h * coneSinh(u);
    float3 P = CO + t * R;                        // relative to the lamp
    float along = max(dot(P, uAxis), 1e-3f);
    float rad = length(P - along * uAxis);
    float ratio = rad / (along * uTanA);
    float prof = 1.0f - glSmoothstep(0.35f, 1.0f, ratio);
    prof *= prof;
    float3 Pw = uApex + P;
    float n = uAtlas.sample(smpLook, Pw.xz * 0.05f + Pw.y * float2(0.021f, 0.034f) - uWindOffset * 0.05f + float2(0.0f, uTime * 0.012f)).r;
    float fade = glSmoothstep(0.0f, 3.5f, uLen - along) * glSmoothstep(0.4f, 3.0f, along);
    sum += prof * fade * (0.3f + 1.4f * n * n);
  }
  sum *= (ub - ua) / 6.0f;
  // Henyey-Greenstein (g = .45), normalised to 1 at 90°: forward scatter bright, back dim
  float cosS = -rd;
  float g = 0.45f;
  float hg = pow((1.0f + g * g) / (1.0f + g * g - 2.0f * g * cosS), 1.5f);
  // rain and spray glint back at every angle: in dense media the backscatter keeps the shaft readable
  hg = max(hg, 0.8f * glSmoothstep(0.08f, 0.25f, uDensity));
  float n2 = uAtlas.sample(smpLook, vW.xz * 0.11f + float2(0.0f, uTime * 0.06f) - uWindOffset * 0.11f).r;
  // seen straight down the beam the whole column stacks into one pixel: keep only a faint core
  float axisFade = 1.0f - 0.7f * glSmoothstep(0.85f, 0.985f, abs(rd));
  float a = uDensity * sum * hg * axisFade * (0.8f + 0.4f * n2) * 6.0f;
  if (noExit) discard_fragment();
  return float4(uColor * a * uIntensity, 1.0f);
}
