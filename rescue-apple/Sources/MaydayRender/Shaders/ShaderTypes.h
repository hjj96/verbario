// ShaderTypes.h — CPU/GPU shared uniform layouts and binding indices (PLAN §3.4).
//
// Included by every .metal file (MSL, C++14) and imported into Swift as the clang module
// `MaydayShaderTypes` (module.modulemap next to this file, SWIFT_INCLUDE_PATHS in project.yml).
//
// Layout rules (PLAN §3.4):
//   * allowed member types: float, int, unsigned int, simd_float2, simd_float4, simd_float4x4
//     (`int` is 32 bit on every Apple target; Swift sees Int32);
//   * vec3 is packed into simd_float4 (w = padding or a packed scalar); float3 / packed_float3
//     are forbidden in structs (12 vs 16 byte disagreement between C and MSL);
//   * fixed-size arrays use the MD_MAX_* defines below;
//   * every struct has a size assert here (both compilers) and in Swift
//     (Tests/MaydayRenderTests/ShaderTypesLayoutTests.swift).
//
// Uniform names keep the GLSL names of the web shaders (uWaveA, uSeaB, …) so a grep finds both
// code bases. Comments name the web source of each block.
#ifndef MAYDAY_SHADER_TYPES_H
#define MAYDAY_SHADER_TYPES_H

#include <simd/simd.h>

#ifdef __METAL_VERSION__
#define MD_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
#define MD_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif

// ---- fixed array sizes ------------------------------------------------------------------------
#define MD_MAX_WAVES 8          // ocean/waves.js MAX_WAVES
#define MD_MAX_SHOALS 8         // ocean.js setShoals (≤ 8)
#define MD_MAX_FEATURES 4       // ocean/features.js MAX_FEATURES
#define MD_MAX_GLINTS 8         // ocean.js MAX_GLINTS
#define MD_MAX_SPLASHES 24      // ocean.js MAX_SPLASHES
#define MD_SPLASH_S_VEC4 6      // uSplashS: 24 strengths packed 4 per vec4
#define MD_GUST_FRONTS 4        // core/look.js uGustFronts[4]
#define MD_SPOT_LIGHTS 2        // CONTRACT light set: heli searchlight, lighthouse beam
#define MD_POINT_LIGHTS 6       // heli belly, ship deck, 4 fx pools

// ---- buffer indices ([[buffer(n)]]) ---------------------------------------------------------------
#define MD_BUF_VERTICES 0
#define MD_BUF_INSTANCES 1
#define MD_BUF_FRAME 2
#define MD_BUF_LOOK 3
#define MD_BUF_LIGHTS 4
#define MD_BUF_MATERIAL 5
#define MD_BUF_OBJECT 6
#define MD_BUF_PASS 7
#define MD_BUF_OUTPUT 1         // compute kernels: results

// ---- texture indices ([[texture(n)]]) ---------------------------------------------------------------
#define MD_TEX_ATLAS 0          // look atlas 256² (R fbm, G worley F1, B F2−F1, A hash)
#define MD_TEX_DETAIL 1         // look detail 256² (RG slopes, B height)
#define MD_TEX_LACE 2           // look lace 512² (R lace, G blotches, B fine lace)
#define MD_TEX_SHADOW 3         // directional shadow map (not yet: M2)
#define MD_TEX_ENV 4            // env cube (not yet: M2)
#define MD_TEX_DFG 5            // three r185 DFG LUT 16² rg16Float (BRDF_GGX_Multiscatter)
#define MD_TEX_COAST 6          // ocean coastline distance map (r8Unorm, R·48 m)
#define MD_TEX_MEMORY 7         // ocean water memory (rgba16Float: foam, dye, disturbance, oil)
// full-screen passes
#define MD_TEX_SOURCE 0         // pass input (scene HDR / post LDR)
#define MD_TEX_DROPS 1          // FinalPass lens drops grid (28 × 16)
#define MD_TEX_HEAT 2           // FinalPass thermal heat/mass target

// ---- sampler indices ([[sampler(n)]]) -----------------------------------------------------------------
#define MD_SMP_LOOK 0           // repeat, trilinear, anisotropy 2 (look.* textures; ocean uDetail copy)
#define MD_SMP_OCEAN 1          // repeat, trilinear, anisotropy 1 (ocean copies of uAtlas / uLace)
#define MD_SMP_CLAMP 2          // clamp to edge, linear, no mips (render targets, LUTs, coast map)
#define MD_SMP_SHADOW 3         // compare sampler (not yet: M2)
#define MD_SMP_NEAREST 4        // clamp to edge, nearest

// ---- function constants ([[function_constant(n)]]) ------------------------------------------------------
#define MD_FC_OCEAN_WAVES 0     // int  4 / 6 / 8  (ocean/material.js OCEAN_WAVES)
#define MD_FC_OCEAN_Q 1         // int  0 / 1 / 2  (OCEAN_Q)
#define MD_FC_OCEAN_RAIN 2      // int  0 / 1 / 2  (OCEAN_RAIN_LAYERS)
#define MD_FC_OCEAN_GLINTS 3    // int  0 / 4 / 8  (OCEAN_GLINTS)
#define MD_FC_OCEAN_MEMORY 4    // bool            (OCEAN_MEMORY)
#define MD_FC_SHADOWS 5         // bool            (shadow map bound; false until M2)

// =====================================================================================================
// Frame (buffer 2): camera + fog. Matrices are column-major (three Matrix4.elements order).
typedef struct {
  simd_float4x4 viewMatrix;        // world → view (three camera.matrixWorldInverse)
  simd_float4x4 projMatrix;        // view → Metal clip: glToMetal × three projectionMatrix (z ∈ [0, 1])
  simd_float4x4 viewProjMatrix;    // projMatrix × viewMatrix
  simd_float4x4 invViewProjMatrix; // inverse(viewProjMatrix)
  simd_float4 cameraPosition;      // xyz world, w = near
  simd_float4 fogColorNear;        // fog colour (linear), fog.near
  simd_float4 fogFarFocus;         // fog.far, lookFocus.x, lookFocus.y (core/look.js fog_fragment), fog on (1/0)
  simd_float4 timeRes;             // uTime (game t), realT, render target width px, height px
} MDFrameUniforms;
MD_STATIC_ASSERT(sizeof(MDFrameUniforms) == 320, "MDFrameUniforms layout");

// Look (buffer 3): core/look.js LOOK_GLSL_UNIFORMS (shared by every look-driven material).
typedef struct {
  simd_float4 timeWindRain;        // uTime, uWind.x (world X), uWind.y (world Z), uRain
  simd_float4 windOffsetWetFlash;  // uWindOffset.x, uWindOffset.y, uWet, uFlash
  simd_float4 nightResolution;     // uNight, 0, uResolution.x, uResolution.y
  simd_float4 uGustFronts[MD_GUST_FRONTS];   // xy = centre (world x, z), zw = unit direction of travel
  simd_float4 uGustFrontsB[MD_GUST_FRONTS];  // x = strength m/s (0 = off), y = width m, z = length m, w = 0
} MDLookUniforms;
MD_STATIC_ASSERT(sizeof(MDLookUniforms) == 176, "MDLookUniforms layout");

// Lights (buffer 4): the fixed CONTRACT light set (PLAN D7), WORLD space (three works in view
// space; every dot product is rotation invariant, so the results are the same).
typedef struct {
  simd_float4 direction;           // xyz unit vector TOWARD the light (three DirectionalLight.direction)
  simd_float4 color;               // rgb = color × intensity (physically correct mode, no π), w = 0
} MDDirLight;
typedef struct {
  simd_float4 skyColor;            // rgb × intensity
  simd_float4 groundColor;         // rgb × intensity
  simd_float4 direction;           // xyz up vector of the hemisphere light
} MDHemiLight;
typedef struct {
  simd_float4 position;            // xyz world
  simd_float4 direction;           // xyz unit, FROM the light toward its target (negated three spot.direction)
  simd_float4 color;               // rgb × intensity
  simd_float4 params;              // distance (0 = infinite), decay, coneCos, penumbraCos
} MDSpotLight;
typedef struct {
  simd_float4 position;            // xyz world
  simd_float4 color;               // rgb × intensity
  simd_float4 params;              // distance (0 = infinite), decay, 0, 0
} MDPointLight;
typedef struct {
  MDDirLight dir;                  // sun / moon (shadow caster)
  MDHemiLight hemi;
  MDSpotLight spot[MD_SPOT_LIGHTS];
  MDPointLight point[MD_POINT_LIGHTS];
  simd_float4 ambientEnv;          // ambient light rgb, environmentIntensity
  simd_float4x4 shadowMatrix;      // world → shadow clip (M2)
  simd_float4 shadowParams;        // bias, normalBias, radius, intensity (M2)
  simd_float4 shadowMapSize;       // width, height, enabled, 0 (M2)
} MDLightsUniforms;
MD_STATIC_ASSERT(sizeof(MDDirLight) == 32, "MDDirLight layout");
MD_STATIC_ASSERT(sizeof(MDHemiLight) == 48, "MDHemiLight layout");
MD_STATIC_ASSERT(sizeof(MDSpotLight) == 64, "MDSpotLight layout");
MD_STATIC_ASSERT(sizeof(MDPointLight) == 48, "MDPointLight layout");
MD_STATIC_ASSERT(sizeof(MDLightsUniforms) == 608, "MDLightsUniforms layout");

// Ocean (buffer 5): every uniform of ocean/material.js createOceanUniforms, same names.
typedef struct {
  // waves & grid (ocean/waves.js uWaveA/uWaveB mirrors)
  simd_float4 uWaveA[MD_MAX_WAVES];      // Dx, Dz, k, a
  simd_float4 uWaveB[MD_MAX_WAVES];      // b, phase (wrapped, grid-relative), L, wind alignment
  simd_float4 uShoals[MD_MAX_SHOALS];    // x, z, radius, on (0 = terrain coast: the coast map handles it)
  simd_float4 uFeatA[MD_MAX_FEATURES];   // type, x, z, height|strength
  simd_float4 uFeatB[MD_MAX_FEATURES];   // rogue: dirX, dirZ, width W, crest length | others: radius, spin
  simd_float4 uFeatC[MD_MAX_FEATURES];   // rogue: carpet, age, speed, removed | others: age
  simd_float4 uDownwash;                 // x, z, radius, strength
  simd_float4 uCoastWin;                 // x0, z0, 1 / width m, 1 / height m
  simd_float4 grid;                      // uOffset.x, uOffset.y (snapped grid origin), uGridStep (2/N), uHsEff
  int uShoalCount;
  int uFeatCount;
  int uGlintCount;
  int uSplashCount;
  simd_float4 misc;                      // uCoastOn, uSpotWater, uSearchI, uStreakMix
  // palette (linear rgb, w = 0)
  simd_float4 uDeep;
  simd_float4 uBody;
  simd_float4 uCrest;
  simd_float4 uShallow;
  simd_float4 uFoamCol;
  simd_float4 uSkyCol;
  simd_float4 uFogCol;
  simd_float4 uSunCol;
  simd_float4 uSpecCol;
  simd_float4 uAmbCol;
  simd_float4 uShadowTint;
  simd_float4 uFlashCol;
  simd_float4 uSunDirV;                  // xyz true visual sun direction (glitter, SSS)
  simd_float4 uSunDirS;                  // xyz shadow-casting (clamped) sun direction
  simd_float4 uSeaA;                     // detail, whitecaps, streaks, foamLines
  simd_float4 uSeaB;                     // roughness (incl. rain), sss, clearing, sunIntensity
  simd_float4 uSeaC;                     // cloud reflection, cloud shadow, shadow intensity, glitter
  simd_float4 uSeaD;                     // glitter exponent, glitter light lift, residual lace, bioluminescence
  simd_float4 uSeaE;                     // mean wind m/s, flash, night, ambient intensity
  simd_float4 uJStats;                   // K = Σ k·b, sigma, crestNorm, 0
  simd_float4 uDetOff;                   // detail tile offsets (uv): 14 m tile .xy, 5.5 m tile .zw
  simd_float4 uDetRot;                   // detail frames: (cos, sin) base swell, (cos, sin) base + 37°
  simd_float4 uStreakRot;                // streak frames A (xy) and B (zw)
  simd_float4 uHeliP;                    // heli x, z, altitude, enabled
  simd_float4 uSearchPos;                // xyz, 0
  simd_float4 uSearchDir;                // axis xyz, cos(outer)
  simd_float4 uGlints[MD_MAX_GLINTS];    // x, z, radius, intensity
  simd_float4 uGlintCol[MD_MAX_GLINTS];  // rgb, 0
  simd_float4 uSplash[MD_MAX_SPLASHES];  // x, z, age, radius
  simd_float4 uSplashS[MD_SPLASH_S_VEC4];// strengths, packed 4 per vec4
  simd_float4 uMemWin;                   // centre x, z, window size, enabled
  simd_float4 uFront;                    // spatial weather front: origin xz, unit direction xz
  simd_float4 uFrontB;                   // travelled distance, half-width W, active, 0
  simd_float4 uPrevDeep;
  simd_float4 uPrevBody;
  simd_float4 uPrevCrest;
  simd_float4 uPrevFoam;
  simd_float4 uNextDeep;
  simd_float4 uNextBody;
  simd_float4 uNextCrest;
  simd_float4 uNextFoam;
  simd_float4 uPrevSea;                  // detail, whitecaps, streaks, foamLines
  simd_float4 uNextSea;
  simd_float4 uLookK;                    // sun share, look gain / exposure, flash shadow, sun-disk specular
} MDOceanUniforms;
MD_STATIC_ASSERT(sizeof(MDOceanUniforms) == 2032, "MDOceanUniforms layout");

// Composite + Output (buffer 7): post.js OutputPass (ACES Filmic + sRGB OETF), bloom composite.
typedef struct {
  simd_float4 params;              // toneMappingExposure, bloom strength, uvScale.x, uvScale.y (dynres)
  simd_float4 bloomFactors;        // UnrealBloom per-mip factors (M2; zero = no bloom)
} MDOutputUniforms;
MD_STATIC_ASSERT(sizeof(MDOutputUniforms) == 32, "MDOutputUniforms layout");

// FinalPass (buffer 7): post/finalShader.js uniforms, packed. Colours are sRGB (display space).
typedef struct {
  simd_float4 resPxSeed;           // uRes.x, uRes.y (output px), uPxScale (px per point), uSeed
  simd_float4 gridFlow;            // uGrid.xy (28, 16), uFlow.xy
  simd_float4 lens;                // uDrops, uRefr, uCondense, uSalt
  simd_float4 caFlashVortexBright; // uCA, uFlash, uVortex, uBright
  simd_float4 flashTintSatMul;     // uFlashTint.rgb, uSatMul
  simd_float4 edge;                // uEdge rgba
  simd_float4 slopePower;          // uSlope.rgb, uPower
  simd_float4 offsetContrast;      // uOffset.rgb, uContrast
  simd_float4 splitShadowSat;      // uSplitShadow.rgb, uSat
  simd_float4 splitHighStrength;   // uSplitHighlight.rgb, uSplitStrength
  simd_float4 vignetteColorAmount; // uVignetteColor.rgb, uVignette
  simd_float4 greenGrainNightLb;   // uGreen, uGrain, uNight, uLetterbox
  simd_float4 toeFloorLookMixSat;  // uDayToe, uFloor, uLookMix, uLookSat
  simd_float4 dof;                 // uDof, uDofFocus, uDofBand, uDofTaps
  simd_float4 lookThermal;         // uLookContrast, uLookFade, uThermal, uThermBoot
  simd_float4 lookShadowFlick;     // uLookShadow.rgb, uThermFlick
  simd_float4 lookHighThermT;      // uLookHigh.rgb, uThermT
  simd_float4 source;              // source uvScale.x, uvScale.y, max u, max v (dynres subrect, texel-clamped)
} MDFinalUniforms;
MD_STATIC_ASSERT(sizeof(MDFinalUniforms) == 288, "MDFinalUniforms layout");

#endif // MAYDAY_SHADER_TYPES_H
