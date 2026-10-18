// Weathering.h — port: rescue/src/core/weathering.js (VERT_MAIN / FRAG_PARS / FRAG_MAIN of patchWeathering):
// albedo mottling, vertical run-streaks, grime toward the sea, ragged waterline (algae + salt), deck wear,
// rain wetness — procedural from a position + normal and the shared look atlas.
// The web injects FRAG_MAIN right after <roughnessmap_fragment>, where diffuseColor and roughnessFactor are
// both live; applyWeathering takes them by reference in that state.
// The space is the caller's: props weather in WORLD space (vWxPos = modelMatrix · transformed), the heli
// hull in its LOCAL frame (materials.js strips the modelMatrix products, so the grime rides with the
// moving airframe). Only the hull uses it today; PLAN §2.9 places the shared copy at
// Common/Weathering.h — move it there when the first prop family needs it.
// pow(abs(n), 4) has a non-negative base (well defined, PLAN §3.1 rule 2). Implicit-LOD samples: call
// in uniform control flow (rule 3).
#ifndef MAYDAY_WEATHERING_H
#define MAYDAY_WEATHERING_H

#include "../Common/GL.h"
#include "HeliShaderTypes.h"

// FRAG_PARS wxTri: triplanar look-atlas sample, weights |n|⁴ normalised.
inline float4 wxTri(float3 p, float3 n, float s, texture2d<float> atlas, sampler smp) {
  float3 w = pow(abs(n), float3(4.0f));
  w /= (w.x + w.y + w.z + 1e-4f);
  return atlas.sample(smp, p.zy * s) * w.x + atlas.sample(smp, p.xz * s) * w.y + atlas.sample(smp, p.xy * s) * w.z;
}

// FRAG_MAIN. wxPos / wxNrm: the vWxPos / vWxNrm varyings; uWxWet = look uWet.
inline void applyWeathering(thread float3& albedo, thread float& roughnessFactor, float3 wxPos, float3 wxNrm,
                            constant MDWxParams& W, float uWxWet, texture2d<float> atlas, sampler smp) {
  float sc = W.uWxB.z;
  float3 n = normalize(wxNrm);
  float4 n1 = wxTri(wxPos, n, 0.08f * sc, atlas, smp);
  float4 n2 = wxTri(wxPos + 17.3f, n, 0.6f * sc, atlas, smp);
  // 1. albedo mottling (value ±, slight warm/cool hue drift)
  float br = (n1.r - 0.5f) * 0.7f + (n2.r - 0.5f) * 0.3f;
  albedo *= 1.0f + br * W.uWxA.x * 2.0f;
  albedo = glMix(albedo, albedo * float3(1.04f, 1.0f, 0.95f), clamp((n1.g - 0.5f) * 2.0f, 0.0f, 1.0f) * W.uWxA.x);
  // 2. vertical run-streaks on walls (stretched 1:12 along Y)
  float vert = 1.0f - glSmoothstep(0.35f, 0.65f, abs(n.y));
  float2 hz = normalize(float2(-n.z, n.x) + float2(1e-4f));
  float2 suv = float2(dot(wxPos.xz, hz) * 0.9f, wxPos.y * 0.075f) * sc;
  float st = glSmoothstep(0.55f, 0.85f, atlas.sample(smp, suv).r) * glSmoothstep(0.3f, 0.7f, atlas.sample(smp, suv * 0.37f + 0.21f).r);
  albedo = glMix(albedo, W.uWxStreak.xyz * (0.75f + 0.5f * n2.g), st * vert * W.uWxA.y);
  // 3. grime gathering low, toward the sea / base
  float h = wxPos.y - W.uWxB.w;
  float low = 1.0f - glSmoothstep(0.0f, 3.5f, h);
  float n0 = wxTri(wxPos + 41.7f, n, 0.025f * sc, atlas, smp).r; // large, smooth stain field
  albedo = glMix(albedo, W.uWxGrime.xyz, low * W.uWxA.z * (0.45f + 0.55f * n0));
  // 4. ragged waterline: algae below ~0.3 m, salt crust above to ~1.3 m
  float rag = (n2.b - 0.5f) * 0.5f;
  float algae = (1.0f - glSmoothstep(0.15f, 0.45f, h + rag)) * step(-3.0f, h);
  float salt = glSmoothstep(0.3f, 0.5f, h + rag) * (1.0f - glSmoothstep(0.8f, 1.6f, h + rag)) * glSmoothstep(0.35f, 0.7f, n1.r);
  albedo = glMix(albedo, W.uWxAlgae.xyz, algae * W.uWxA.w * 0.85f);
  albedo = glMix(albedo, W.uWxSalt.xyz, salt * W.uWxA.w * 0.4f);
  // 5. decks: low-frequency stains + worn centre paths
  float horiz = glSmoothstep(0.75f, 0.95f, n.y);
  albedo *= 1.0f - horiz * W.uWxB.y * glSmoothstep(0.45f, 0.85f, n0 * 0.7f + n1.r * 0.3f) * 0.35f;
  // 6. rain wetness darkens, roughness drops (water-polished decks most)
  albedo *= 1.0f - 0.12f * uWxWet;
  roughnessFactor = clamp(roughnessFactor + (n2.r - 0.5f) * 2.0f * W.uWxB.x - uWxWet * (0.12f + 0.2f * horiz) + algae * W.uWxA.w * 0.1f,
                          0.04f, 1.0f);
}

#endif // MAYDAY_WEATHERING_H
