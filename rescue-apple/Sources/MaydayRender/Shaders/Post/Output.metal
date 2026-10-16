// Output.metal — merged Composite + Output pass (PLAN D10, X4):
//   post = sRGB_OETF( ACES_Hill( exposure · half(sceneHDR + bloom) ) )   → rgba16Float "post" target
// port: three r185 OutputPass (ACES_FILMIC_TONE_MAPPING + SRGB_TRANSFER) as configured by main.js
// (renderer.toneMapping = ACESFilmic, outputColorSpace = sRGB) and post.js (toneMappingExposure), with
// the last step of UnrealBloomPass folded in: the web blends the bloom composite (renderTargetsHorizontal[0],
// bilinear upsample at the scene pixel) additively (One/One) onto the HalfFloat scene target, and the
// OutputPass reads that target — so the sum is rounded to half precision before tone mapping, here too.
// bloom.x = 0: no bloom this frame (low quality, strength 0) — the scene texel is used as stored.
//
// The pass covers the same viewport sub-rectangle as the scene (dynamic resolution), so every
// fragment reads exactly its own scene texel (read(), no filtering) like the web's 1:1 OutputPass.
#include "../ShaderTypes.h"
#include "../Common/ACES.h"
#include "../Common/GL.h"
#include "FullscreenTypes.h"

fragment float4 composite_output_fs(FSVaryings in [[stage_in]],
                                    texture2d<float> sceneHDR [[texture(MD_TEX_SOURCE)]],
                                    texture2d<float> bloomTexture [[texture(MD_TEX_BLOOM)]],
                                    sampler smpClamp [[sampler(MD_SMP_CLAMP)]],
                                    constant MDOutputUniforms& O [[buffer(MD_BUF_PASS)]]) {
  uint2 px = uint2(in.position.xy);
  px = min(px, uint2(sceneHDR.get_width() - 1, sceneHDR.get_height() - 1));
  float3 c = sceneHDR.read(px).rgb;
  if (O.params.y > 0.5f) {
    // CopyShader (opacity 1) with AdditiveBlending + premultipliedAlpha → blendFunc(ONE, ONE)
    float3 bloom = bloomTexture.sample(smpClamp, rtUV(in.vUv) * O.bloom.xy, level(0.0f)).rgb;
    c = float3(half3(c + bloom));
  }
  c = ACESFilmicToneMapping(c, O.params.x);
  c = sRGBTransferOETF(c);
  return float4(c, 1.0f);
}
