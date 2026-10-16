// Bloom.metal — port of three r185 UnrealBloomPass as post.js configures it (PLAN §2.5 pass 5, §3.3 #40):
//   bloom_highpass_fs  LuminosityHighPassShader (luminance weights = three's Rec.709 coefficients
//                      toFixed(4); smoothWidth 0.3 — ScaledBloomPass's soft knee — threshold per palette)
//   bloom_blur_fs      the separable Gaussian (KERNEL_RADIUS 6/10/14/18/22, σ = K/3, coefficients
//                      0.39894·exp(−½ i²/σ²)/σ from the CPU), H then V per mip; invSize = 1 / target size
//   bloom_composite_fs 3·strength·Σ lerpBloomFactor(f_i)·tint_i·blur_i (factors 1, .8, .6, .4, .2)
// The additive blend of the composite onto the scene target and the OutputPass are merged into
// Output.metal (PLAN X4). Every target here is an exact-size rgba16Float texture (HalfFloat like three),
// so the fragments sample their inputs at the GL vUv of their own pixel through rtUV (row flip only);
// the high pass alone reads the scene's dynamic-resolution sub-rectangle (rtUVScaled).
// Inputs have no mips: level(0) everywhere (the blur loop is uniform, but explicit LOD costs nothing).
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "FullscreenTypes.h"

// three `luminance()` (WebGLProgram prefix): ColorManagement Rec.709 coefficients, toFixed(4).
inline float bloomLuminance(float3 rgb) {
  const float3 weights = float3(0.2126f, 0.7152f, 0.0722f);
  return dot(weights, rgb);
}

fragment float4 bloom_highpass_fs(FSVaryings in [[stage_in]],
                                  constant MDBloomUniforms& B [[buffer(MD_BUF_PASS)]],
                                  texture2d<float> tDiffuse [[texture(MD_TEX_SOURCE)]],
                                  sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  const float luminosityThreshold = B.params.x;
  const float smoothWidth = B.params.y;
  float4 texel = tDiffuse.sample(smpClamp, rtUVScaled(in.vUv, B.source.xy, B.source.zw), level(0.0f));
  float v = bloomLuminance(texel.xyz);
  float4 outputColor = float4(0.0f, 0.0f, 0.0f, 0.0f);   // defaultColor 0x000000, defaultOpacity 0
  float alpha = glSmoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  return glMix(outputColor, texel, alpha);
}

fragment float4 bloom_blur_fs(FSVaryings in [[stage_in]],
                              constant MDBloomUniforms& B [[buffer(MD_BUF_PASS)]],
                              texture2d<float> colorTexture [[texture(MD_TEX_SOURCE)]],
                              sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  const float2 invSize = B.invSizeDirection.xy;
  const float2 direction = B.invSizeDirection.zw;
  const int kernelRadius = int(B.params.z);
  const float2 vUv = in.vUv;
  float weightSum = B.gaussianCoefficients[0].x;
  float3 diffuseSum = colorTexture.sample(smpClamp, rtUV(vUv), level(0.0f)).rgb * weightSum;
  for (int i = 1; i < MD_BLOOM_MAX_KERNEL; i++) {
    if (i >= kernelRadius) break;
    float x = float(i);
    float w = B.gaussianCoefficients[i >> 2][i & 3];
    float2 uvOffset = direction * invSize * x;
    float3 sample1 = colorTexture.sample(smpClamp, rtUV(vUv + uvOffset), level(0.0f)).rgb;
    float3 sample2 = colorTexture.sample(smpClamp, rtUV(vUv - uvOffset), level(0.0f)).rgb;
    diffuseSum += (sample1 + sample2) * w;
  }
  return float4(diffuseSum, 1.0f);
}

inline float lerpBloomFactor(float factor, float bloomRadius) {
  float mirrorFactor = 1.2f - factor;
  return glMix(factor, mirrorFactor, bloomRadius);
}

fragment float4 bloom_composite_fs(FSVaryings in [[stage_in]],
                                   constant MDBloomCompositeUniforms& C [[buffer(MD_BUF_PASS)]],
                                   texture2d<float> blurTexture1 [[texture(MD_TEX_BLUR0)]],
                                   texture2d<float> blurTexture2 [[texture(MD_TEX_BLUR0 + 1)]],
                                   texture2d<float> blurTexture3 [[texture(MD_TEX_BLUR0 + 2)]],
                                   texture2d<float> blurTexture4 [[texture(MD_TEX_BLUR0 + 3)]],
                                   texture2d<float> blurTexture5 [[texture(MD_TEX_BLUR0 + 4)]],
                                   sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  const float bloomStrength = C.strengthRadius.x;
  const float bloomRadius = C.strengthRadius.y;
  const float2 uv = rtUV(in.vUv);
  // 3.0 for backwards compatibility with previous alpha-based intensity
  float3 bloom = 3.0f * bloomStrength * (
      lerpBloomFactor(C.bloomFactors0.x, bloomRadius) * C.bloomTintColors[0].xyz * blurTexture1.sample(smpClamp, uv, level(0.0f)).rgb +
      lerpBloomFactor(C.bloomFactors0.y, bloomRadius) * C.bloomTintColors[1].xyz * blurTexture2.sample(smpClamp, uv, level(0.0f)).rgb +
      lerpBloomFactor(C.bloomFactors0.z, bloomRadius) * C.bloomTintColors[2].xyz * blurTexture3.sample(smpClamp, uv, level(0.0f)).rgb +
      lerpBloomFactor(C.bloomFactors0.w, bloomRadius) * C.bloomTintColors[3].xyz * blurTexture4.sample(smpClamp, uv, level(0.0f)).rgb +
      lerpBloomFactor(C.bloomFactors1.x, bloomRadius) * C.bloomTintColors[4].xyz * blurTexture5.sample(smpClamp, uv, level(0.0f)).rgb);
  float bloomAlpha = max(bloom.r, max(bloom.g, bloom.b));
  return float4(bloom, bloomAlpha);
}
