// Output.metal — merged Composite + Output pass (PLAN D10, X4):
//   post = sRGB_OETF( ACES_Hill( exposure · (sceneHDR + bloom) ) )   → rgba16Float "post" target
// port: three r185 OutputPass (ACES_FILMIC_TONE_MAPPING + SRGB_TRANSFER) as configured by main.js
// (renderer.toneMapping = ACESFilmic, outputColorSpace = sRGB) and post.js (toneMappingExposure).
// Bloom (UnrealBloomPass mips) is composited here in M2; MDOutputUniforms.params.y = 0 until then.
//
// The pass covers the same viewport sub-rectangle as the scene (dynamic resolution), so every
// fragment reads exactly its own scene texel (read(), no filtering) like the web's 1:1 OutputPass.
#include "../ShaderTypes.h"
#include "../Common/ACES.h"
#include "FullscreenTypes.h"

fragment float4 composite_output_fs(FSVaryings in [[stage_in]],
                                    texture2d<float> sceneHDR [[texture(MD_TEX_SOURCE)]],
                                    constant MDOutputUniforms& O [[buffer(MD_BUF_PASS)]]) {
  uint2 px = uint2(in.position.xy);
  px = min(px, uint2(sceneHDR.get_width() - 1, sceneHDR.get_height() - 1));
  float3 c = sceneHDR.read(px).rgb;
  c = ACESFilmicToneMapping(c, O.params.x);
  c = sRGBTransferOETF(c);
  return float4(c, 1.0f);
}
