// HeliShaderTypes.h — uniform layouts, slots and constants of the helicopter families (PLAN §3.3 #28–33):
// Hull (+ hub), Rotor (main + tail veil), Lights (bulbs + halos), Cone (searchlight shaft), Cable, Ring
// (winch reach ring) and the heli props (hoist operator, basket, rescue swimmer, raft packs, flotation
// bags, flare embers). Same rules as ShaderTypes.h (§3.4): float4 / float4x4 members only, a size assert
// per struct. Swift mirrors them member for member in Heli/HeliShaderTypes.swift (MemoryLayout asserts the
// same sizes at start-up), because the clang module MaydayShaderTypes only exports ShaderTypes.h.
// Uniform names keep the GLSL names of rescue/src/systems/heli/materials.js and core/weathering.js.
#ifndef MAYDAY_HELI_SHADER_TYPES_H
#define MAYDAY_HELI_SHADER_TYPES_H

#include "../ShaderTypes.h"

// ---- fixed sizes -----------------------------------------------------------------------------------------
#define MD_HULL_GLOWS 8          // heli/materials.js HULL_GLOWS
#define MD_LIGHT_CHANNELS 10     // heli/materials.js LIGHT_CHANNELS (uChan[10], packed 4 per float4)
#define MD_CABLE_POINTS 15       // heli/winch.js N = SEGS + 1 (verlet points, ribbon pairs)
#define MD_RING_VERTICES 98      // heli/winch.js (RING_SEGS + 1) × 2 (inner / outer edge)

// ---- vertex attribute slots of the heli meshes (baked .mmesh names → [[attribute(n)]]) ----------------------
// position / normal / uv / color / aSurf use the shared MD_ATTR_* slots; the rest are heli-only.
#define MD_HELI_ATTR_CORNER 6    // lights: aCorner (halo quad corner, 0 0 on bulb vertices)
#define MD_HELI_ATTR_CHAN 7      // lights: aChan (light channel index, heli/model.js CH)
#define MD_HELI_ATTR_SIZE 8      // lights: aSize (halo half-size, m)
#define MD_HELI_ATTR_SIDE 9      // cable: aSide (−1 / +1 ribbon edge)
#define MD_HELI_ATTR_DIR 10      // cable: aDir (+1 toward the next point, −1 at the last point)
#define MD_HELI_ATTR_V 11        // cable: aV (0 at the hoist … 1 at the hook)
#define MD_HELI_ATTR_ANG 12      // ring: aAng (0 … 1 around the ring)
#define MD_HELI_ATTR_EDGE 13     // ring: aEdge (0 inner, 1 outer)

// ---- textures / function constants ------------------------------------------------------------------------
#define MD_TEX_HELI_DECAL 8      // hull uDecal: livery atlas 1024 × 512 (heli/decals.js, sRGB, clamp, mipmapped)
#define MD_FC_HELI_VCOLOR 20     // bool: heli prop mesh has vertex colours (material.vertexColors)

// =====================================================================================================
// core/weathering.js patchWeathering uniforms (the hull's preset; shared shape for future prop families).
typedef struct {
  simd_float4 uWxA;              // breakup, streaks, grime, waterline
  simd_float4 uWxB;              // roughBreakup, deckWear, scale, seaLevel
  simd_float4 uWxStreak;         // rgb (linear), 0
  simd_float4 uWxGrime;          // rgb, 0
  simd_float4 uWxAlgae;          // rgb, 0
  simd_float4 uWxSalt;           // rgb, 0
} MDWxParams;
MD_STATIC_ASSERT(sizeof(MDWxParams) == 96, "MDWxParams layout");

// Hull (buffer 5): createHullMaterial — MeshPhysicalMaterial parameters + userData.uniforms + weathering.
// Shared by heli.hull and heli.rotorHub (one material in the web).
typedef struct {
  simd_float4 diffuseOpacity;    // material.color (linear), opacity
  simd_float4 physical;          // roughness, metalness, clearcoat, clearcoatRoughness
  simd_float4 uRim;              // rgb, uSunScale
  simd_float4 uFill;             // rgb, uSoot
  simd_float4 uInstr;            // rgb, receiveShadow (1 / 0: hull yes, hub no)
  simd_float4 uGlowPos[MD_HULL_GLOWS]; // xyz airframe-local, w = radius m
  simd_float4 uGlowCol[MD_HULL_GLOWS]; // rgb, 0
  MDWxParams wx;
} MDHullUniforms;
MD_STATIC_ASSERT(sizeof(MDHullUniforms) == 432, "MDHullUniforms layout");

// Rotor veil (buffer 5): createRotorMaterial uniforms (uTime comes from MDLookUniforms).
typedef struct {
  simd_float4 bladeGhostSharpExp;   // uBlade, uGhost, uSharp, uExp
  simd_float4 elmoBladesWidthOpacity; // uElmo, uBlades, uBladeW, uOpacity
  simd_float4 litArcTipInner;       // uLit, uArc, uTipFade, uInner
  simd_float4 uSunDir;              // xyz, 0
  simd_float4 uSunCol;              // rgb, 0
  simd_float4 uAmbCol;
  simd_float4 uSkyCol;
  simd_float4 uGlow;
  simd_float4 uGlowB;
  simd_float4 uGlowS;
  simd_float4 uGlowBAt;             // disc-local x, y, falloff radius (disc units), 0
  simd_float4 uGlowSAt;
  simd_float4 uHull;                // cabin half-width, boom half-width, nose, boom start (disc units)
  simd_float4 uDiscColor;           // rgb, 0
  simd_float4 uTipColor;
  simd_float4 uElmoColor;
} MDRotorUniforms;
MD_STATIC_ASSERT(sizeof(MDRotorUniforms) == 256, "MDRotorUniforms layout");

// Lights (buffer 5): createLightsMaterial — uChan[10] (4 per float4), uHalo, uBulb.
typedef struct {
  simd_float4 uChan[3];
  simd_float4 haloBulb;             // uHalo, uBulb, 0, 0
} MDHeliLightsUniforms;
MD_STATIC_ASSERT(sizeof(MDHeliLightsUniforms) == 64, "MDHeliLightsUniforms layout");

// Searchlight cone (buffer 5): createConeMaterial uniforms (look uniforms from MDLookUniforms).
typedef struct {
  simd_float4 uColorDensity;        // uColor (linear), uDensity
  simd_float4 uApexIntensity;       // uApex (world), uIntensity
  simd_float4 uAxisLen;             // uAxis (unit), uLen
  simd_float4 cosTan;               // uCos2, uTanA, 0, 0
} MDConeUniforms;
MD_STATIC_ASSERT(sizeof(MDConeUniforms) == 64, "MDConeUniforms layout");

// Cable (buffer 5): createCableMaterial uniforms + the interpolated verlet points (heli/winch.js render():
// the ribbon's `position` / `aOther` pairs are built from these in the vertex shader, uResolution from look).
typedef struct {
  simd_float4 points[MD_CABLE_POINTS]; // xyz world (Float32 as winch.rend), 0
  simd_float4 uBaseLit;             // uBase (linear), uLit
  simd_float4 uBeamPosCos;          // uBeamPos, uBeamCos
  simd_float4 uBeamDirI;            // uBeamDir, uBeamI
  simd_float4 uBeamColorPx;         // uBeamColor (linear), uPx
} MDCableUniforms;
MD_STATIC_ASSERT(sizeof(MDCableUniforms) == 304, "MDCableUniforms layout");

// Reach ring (buffer 5): createRingMaterial uniforms + the ring vertices (winch _ring(): inner / outer per
// segment end, world space).
typedef struct {
  simd_float4 positions[MD_RING_VERTICES]; // xyz world, 0
  simd_float4 uColorOpacity;        // uColor (linear), uOpacity
  simd_float4 phaseDashes;          // uPhase, uDashes, 0, 0
} MDRingUniforms;
MD_STATIC_ASSERT(sizeof(MDRingUniforms) == 1600, "MDRingUniforms layout");

// Heli props (buffer 5): plain MeshStandardMaterial / MeshBasicMaterial of crewman.js, winch.js, heli.js.
typedef struct {
  simd_float4 color;                // material.color (linear), opacity
  simd_float4 emissive;             // emissive × emissiveIntensity, 0
  simd_float4 params;               // roughness, metalness, receiveShadow (1 / 0), fog (1 / 0)
} MDHeliPropMaterial;
MD_STATIC_ASSERT(sizeof(MDHeliPropMaterial) == 48, "MDHeliPropMaterial layout");

#endif // MAYDAY_HELI_SHADER_TYPES_H
