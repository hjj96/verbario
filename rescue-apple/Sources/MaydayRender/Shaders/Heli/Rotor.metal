// Rotor.metal — port: rescue/src/systems/heli/materials.js createRotorMaterial (PLAN §3.3 #29): the main and
// tail rotor discs as a LIT translucent veil (time-averaged blades: sun·N·L + ambient over π, sky sheen),
// concentric motion-blur streaks, ghost blades drifting with the stagecoach alias, the per-frame shutter
// sweep, tip paint only inside the sweeps, crisp frozen blades in a lightning frame / slow rotor, the
// fuselage hole, local beacon / strobe glow and St. Elmo's fire on the tips. Geometry: three
// CircleGeometry(1, segs) in its xy plane (heli_rotor_main / _low / _tail.mmesh), placed by the rotor pivot.
// ShaderMaterial: transparent, DoubleSide, depthWrite off, NormalBlending, no fog, no tone mapping (the
// FINISH chunks are dropped: HDR target, PLAN D10).
// Changes that keep the result: the r > 1 discard moves to the end so every texture sample runs in uniform
// control flow (PLAN §3.1 rule 3); GLSL smoothstep / mix / mod → glSmoothstep / glMix / glMod (GL.h).
#include "../ShaderTypes.h"
#include "../Common/Common.h"
#include "HeliShaderTypes.h"

struct RotorIn {
  float3 position [[attribute(MD_ATTR_POSITION)]];
};

struct RotorVaryings {
  float4 position [[position]];
  float2 vP;
  float3 vN;
  float3 vView;
};

vertex RotorVaryings rotor_vs(RotorIn in [[stage_in]],
                              constant MDFrameUniforms& F [[buffer(MD_BUF_FRAME)]],
                              constant MDObjectData& O [[buffer(MD_BUF_OBJECT)]]) {
  RotorVaryings o;
  o.vP = in.position.xy;
  float4 wp = O.model * float4(in.position, 1.0f);
  o.vN = normalize(upper3x3(O.model) * float3(0.0f, 0.0f, 1.0f));
  o.vView = F.cameraPosition.xyz - wp.xyz;
  o.position = F.projMatrix * (F.viewMatrix * wp);
  return o;
}

fragment float4 rotor_fs(RotorVaryings in [[stage_in]],
                         constant MDLookUniforms& L [[buffer(MD_BUF_LOOK)]],
                         constant MDRotorUniforms& U [[buffer(MD_BUF_MATERIAL)]],
                         texture2d<float> uAtlas [[texture(MD_TEX_ATLAS)]],
                         sampler smpLook [[sampler(MD_SMP_LOOK)]]) {
  const float uTime = L.timeWindRain.x;
  const float uBlade = U.bladeGhostSharpExp.x, uGhost = U.bladeGhostSharpExp.y, uSharp = U.bladeGhostSharpExp.z, uExp = U.bladeGhostSharpExp.w;
  const float uElmo = U.elmoBladesWidthOpacity.x, uBlades = U.elmoBladesWidthOpacity.y;
  const float uBladeW = U.elmoBladesWidthOpacity.z, uOpacity = U.elmoBladesWidthOpacity.w;
  const float uLit = U.litArcTipInner.x, uArc = U.litArcTipInner.y, uTipFade = U.litArcTipInner.z, uInner = U.litArcTipInner.w;
  const float3 uSunDir = U.uSunDir.xyz, uSunCol = U.uSunCol.xyz, uAmbCol = U.uAmbCol.xyz, uSkyCol = U.uSkyCol.xyz;
  const float3 uGlow = U.uGlow.xyz, uGlowB = U.uGlowB.xyz, uGlowS = U.uGlowS.xyz;
  const float3 uGlowBAt = U.uGlowBAt.xyz, uGlowSAt = U.uGlowSAt.xyz;
  const float4 uHull = U.uHull;

  float2 vP = in.vP;
  float r = length(vP);
  bool outside = r > 1.0f;                       // GLSL: if (r > 1.0) discard;  (moved to the end)
  float th = glAtan(vP.y, vP.x);
  float2 cs = vP / max(r, 1e-4f);
  float seg = 6.2831853f / uBlades;
  // --- light: same convention as the hull (irradiance / π), camera-facing side ------------------------
  float3 V = normalize(in.vView);
  float3 N = normalize(in.vN);
  N = dot(N, V) < 0.0f ? -N : N;
  float ndv = clamp(dot(N, V), 0.0f, 1.0f);
  float ndl = max(dot(N, normalize(uSunDir)), 0.0f);
  float2 gdB = vP - uGlowBAt.xy;
  float2 gdS = float2(abs(vP.x) - uGlowSAt.x, vP.y - uGlowSAt.y);
  float3 irr = (uSunCol * ndl + uAmbCol) * 0.3183f * uLit + uGlow
             + uGlowB / (1.0f + dot(gdB, gdB) / max(uGlowBAt.z * uGlowBAt.z, 1e-4f))
             + uGlowS / (1.0f + dot(gdS, gdS) / max(uGlowSAt.z * uGlowSAt.z, 1e-4f));
  float3 H = normalize(normalize(uSunDir) + V);
  float sheen = pow(max(dot(N, H), 0.0f), 6.0f);
  float Fr = 0.1f + 0.9f * pow(1.0f - ndv, 5.0f); // semi-gloss, twisted blades: never a perfect mirror angle
  // --- motion blur: noise smeared along θ → fine concentric streaks ---------------------------------------
  float s1 = uAtlas.sample(smpLook, float2(r * 2.3f, 0.17f) + 0.03f * cs).r;
  float s2 = uAtlas.sample(smpLook, float2(r * 5.5f, 0.61f) + 0.05f * cs).r;
  float streak = clamp(0.5f + (s1 - 0.5f) * 1.3f + (s2 - 0.5f) * 0.6f, 0.0f, 1.0f);
  float ghost = pow(0.5f + 0.5f * cos(uBlades * (th - uGhost)), uExp);
  // per-frame shutter sweep of each blade (trails the blade, which moves toward +θ)
  float rel = glMod(uBlade - th, seg);
  float sweep = (1.0f - glSmoothstep(0.0f, uArc, rel)) * (1.0f - 0.45f * rel / max(uArc, 1e-3f));
  float aG = 0.075f * (0.86f + 0.28f * streak) + 0.035f * ghost + 0.03f * sweep;
  if (uHull.x > 0.0f) {
    // disc-local +y = nose. Cabin (wide) → tail boom (narrow) → beyond the nose: open disc.
    float hw = glMix(uHull.y, uHull.x, glSmoothstep(uHull.w - 0.12f, uHull.w + 0.08f, vP.y));
    float hullM = (1.0f - glSmoothstep(hw, hw + 0.06f, abs(vP.x))) * (1.0f - glSmoothstep(uHull.z - 0.06f, uHull.z + 0.04f, vP.y));
    aG *= 1.0f - 0.6f * hullM;
  }
  // crisp frozen blades (lightning frame / slow rotor)
  float d = abs(glMod(th - uBlade + 0.5f * seg, seg) - 0.5f * seg) * r;
  float blade = (1.0f - glSmoothstep(uBladeW * 0.75f, uBladeW * 1.25f, d)) * glSmoothstep(0.07f, 0.13f, r);
  float a = glMix(aG, 0.92f * blade, uSharp);
  // blurred tip path has no hard rim: fade the outer ~14% (the frozen blades keep their crisp tips)
  a *= glSmoothstep(uInner, uInner + 0.06f, r) * (1.0f - glSmoothstep(glMix(0.86f, 0.93f, uSharp), 1.0f, r) * (1.0f - 0.9f * uSharp));
  float3 alb = U.uDiscColor.xyz;
  float3 col = alb * irr + uSkyCol * Fr * (0.8f + 0.3f * streak) + uSunCol * sheen * 0.012f * (1.0f - uSharp);
  // tip paint: soft band, visible only inside the 5 shutter smears; crisp on frozen blades
  float band = glSmoothstep(0.915f, 0.97f, r) * (1.0f - glSmoothstep(0.982f, 1.0f, r));
  float tipA = band * (0.012f + 0.078f * sweep) * uTipFade;
  float tipCrisp = blade * glSmoothstep(0.925f, 0.94f, r);
  tipA = glMix(tipA, 0.95f * tipCrisp, uSharp);
  float3 tipCol = U.uTipColor.xyz * irr + uSkyCol * Fr * 0.5f;
  float aT = tipA + a * (1.0f - tipA);
  col = (tipCol * tipA + col * a * (1.0f - tipA)) / max(aT, 1e-4f);
  a = aT;
  // St. Elmo's fire: blue corona crackling at 30 Hz on the tip path
  float seg30 = floor(uTime * 30.0f);
  float crack = fract(sin(seg30 * 12.9898f + floor(th * 23.0f) * 78.233f) * 43758.5453f);
  float arc = glSmoothstep(0.55f, 1.0f, fract(sin(seg30 * 3.17f + floor(th * 7.0f) * 19.1f) * 9631.7f));
  float eband = glSmoothstep(0.93f, 0.97f, r) * (1.0f - glSmoothstep(0.985f, 1.0f, r));
  float elmo = uElmo * eband * (0.25f + 0.75f * step(0.5f, crack)) * (0.4f + 0.6f * arc);
  col = glMix(col, U.uElmoColor.xyz * 1.8f, min(1.0f, elmo * 1.4f));
  a = max(a, min(0.9f, elmo * 1.2f));
  if (outside) discard_fragment();
  return float4(col, a * uOpacity);
}
