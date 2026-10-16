// Final.metal — port: rescue/src/systems/post/finalShader.js (FinalPass, display-referred grade &
// lens stack), in the same order:
//   1. lens drops (beads, refraction, rim, highlight; fog condensation; salt crust)
//   2. radial chromatic aberration (+ photo-mode tilt-shift DOF, vortex smear)
//   3. pulses (flash tint, damage / hull / fuel edges)
//   4. grading: CDL slope/offset/power → S-curve around 0.42 → soft-light split tone → greenTint →
//      saturation with ORANGE PROTECTION → brightness → film-base floor
//   5. tinted vignette; daylight toe; photo grade presets; thermal composite
//   6. luminance grain reseeded at 24 Hz (+ chroma noise at night)
//   7. letterbox 2.39:1
//   8. triangular dither ±1/255
// Input: the Composite+Output result (ACES + sRGB already applied), rendered at the internal
// resolution into the sub-rectangle `source.xy` of its texture; output: the drawable (bgra8Unorm,
// layer colorspace sRGB — values are written as-is, like WebGL's default framebuffer).
//
// GL conventions kept (PLAN §2.5): vUv is GL-style (0,0 bottom-left); every read of a render target
// goes through rtUVScaled(); gl_FragCoord → fragCoordGL(). The source and heat targets have no mips,
// so they are sampled with level(0) everywhere (several reads sit in non-uniform loops/branches).
#include "../ShaderTypes.h"
#include "../Common/GL.h"
#include "../Common/Noise.h"
#include "FullscreenTypes.h"

struct FinalCtx {
  float2 scale;     // source uv scale (dynres sub-rect)
  float2 clampMax;  // max source uv (texel-clamped)
};

inline float3 srcRGB(texture2d<float> t, sampler s, float2 uvGL, FinalCtx c) {
  return t.sample(s, rtUVScaled(uvGL, c.scale, c.clampMax), level(0.0f)).rgb;
}

inline float luma(float3 c) { return dot(c, float3(0.2126f, 0.7152f, 0.0722f)); }

// W3C soft light: b = base, s = blend.
inline float3 softLight(float3 b, float3 s) {
  float3 d = glMix(sqrt(b), ((16.0f * b - 12.0f) * b + 4.0f) * b, step(b, float3(0.25f)));
  return glMix(b - (1.0f - 2.0f * s) * b * (1.0f - b), b + (2.0f * s - 1.0f) * (d - b), step(float3(0.5f), s));
}

// Contrast S-curve through (0,0), (p,p), (1,1) with slope c at the pivot.
inline float sCurve(float x, float p, float c) {
  x = clamp(x, 0.0f, 1.0f);
  return x < p ? p * pow(x / p, c) : 1.0f - (1.0f - p) * pow((1.0f - x) / (1.0f - p), c);
}

fragment float4 final_fs(FSVaryings in [[stage_in]],
                         constant MDFinalUniforms& U [[buffer(MD_BUF_PASS)]],
                         texture2d<float> tDiffuse [[texture(MD_TEX_SOURCE)]],
                         texture2d<float> tDrops [[texture(MD_TEX_DROPS)]],
                         texture2d<float> tHeat [[texture(MD_TEX_HEAT)]],
                         sampler smpClamp [[sampler(MD_SMP_CLAMP)]]) {
  // uniforms with their GLSL names
  const float2 uRes = U.resPxSeed.xy;
  const float uPxScale = U.resPxSeed.z;
  const float uSeed = U.resPxSeed.w;
  const float2 uGrid = U.gridFlow.xy;
  const float2 uFlow = U.gridFlow.zw;
  const float uDrops = U.lens.x;
  const float uRefr = U.lens.y;
  const float uCondense = U.lens.z;
  const float uSalt = U.lens.w;
  const float uCA = U.caFlashVortexBright.x;
  const float uFlash = U.caFlashVortexBright.y;
  const float uVortex = U.caFlashVortexBright.z;
  const float uBright = U.caFlashVortexBright.w;
  const float3 uFlashTint = U.flashTintSatMul.xyz;
  const float uSatMul = U.flashTintSatMul.w;
  const float4 uEdge = U.edge;
  const float3 uSlope = U.slopePower.xyz;
  const float uPower = U.slopePower.w;
  const float3 uOffset = U.offsetContrast.xyz;
  const float uContrast = U.offsetContrast.w;
  const float3 uSplitShadow = U.splitShadowSat.xyz;
  const float uSat = U.splitShadowSat.w;
  const float3 uSplitHighlight = U.splitHighStrength.xyz;
  const float uSplitStrength = U.splitHighStrength.w;
  const float3 uVignetteColor = U.vignetteColorAmount.xyz;
  const float uVignette = U.vignetteColorAmount.w;
  const float uGreen = U.greenGrainNightLb.x;
  const float uGrain = U.greenGrainNightLb.y;
  const float uNight = U.greenGrainNightLb.z;
  const float uLetterbox = U.greenGrainNightLb.w;
  const float uDayToe = U.toeFloorLookMixSat.x;
  const float uFloor = U.toeFloorLookMixSat.y;
  const float uLookMix = U.toeFloorLookMixSat.z;
  const float uLookSat = U.toeFloorLookMixSat.w;
  const float uDof = U.dof.x;
  const float uDofFocus = U.dof.y;
  const float uDofBand = U.dof.z;
  const float uDofTaps = U.dof.w;
  const float uLookContrast = U.lookThermal.x;
  const float uLookFade = U.lookThermal.y;
  const float uThermal = U.lookThermal.z;
  const float uThermBoot = U.lookThermal.w;
  const float3 uLookShadow = U.lookShadowFlick.xyz;
  const float uThermFlick = U.lookShadowFlick.w;
  const float3 uLookHigh = U.lookHighThermT.xyz;
  const float uThermT = U.lookHighThermT.w;
  FinalCtx src;
  src.scale = U.source.xy;
  src.clampMax = U.source.zw;
  const float2 gl_FragCoord = fragCoordGL(in.position, uRes);
  const float2 vUv = in.vUv;

  float2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float er = length((vUv - 0.5f) * 2.0f) * 0.70710678f;   // 0 centre → 1 corner (screen-shaped)

  // ---- 1. lens drops ---------------------------------------------------------------------------------
  float dropA = 0.0f;      // coverage (anti-aliased)
  float dropK = 0.0f;      // 0 centre → 1 rim
  float3 dropN = float3(0.0f, 0.0f, 1.0f);
  if (uDrops > 0.5f) {
    float2 cellPx = uRes / uGrid;
    float2 p = vUv * uGrid;
    float2 b = floor(p - 0.5f);
    float best = 0.0f;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        float2 c = b + float2(float(i), float(j));
        if (c.x < 0.0f || c.y < 0.0f || c.x >= uGrid.x || c.y >= uGrid.y) continue;
        // data texture (row 0 = v 0, no flip): addressed with GL uv directly
        float4 d = tDrops.sample(smpClamp, (c + 0.5f) / uGrid, level(0.0f));
        if (d.z <= 0.001f) continue;
        // vector from the drop head, in cell heights (isotropic)
        float2 q = (p - (c + 0.5f + d.xy)) * cellPx / cellPx.y;
        float2 tail = -uFlow * d.w;
        float h = clamp(dot(q, tail) / max(dot(tail, tail), 1e-5f), 0.0f, 1.0f);
        float2 dv = q - tail * h;
        float rr = d.z * glMix(1.0f, 0.42f, h);
        float k = length(dv) / rr;
        if (k < 1.0f) {
          float hz = sqrt(1.0f - k * k);
          if (hz > best) {
            best = hz;
            dropK = k;
            dropN = float3(dv / rr, hz);
            // a lens focused at 100+ m sees the bead defocused: its edge is blurred over ≈ 3 px
            dropA = glSmoothstep(0.0f, 1.0f, (1.0f - k) * rr * cellPx.y / 3.0f);
          }
        }
      }
    }
    // a convex water lens: magnified, inverted view of what is behind it
    uv -= dropN.xy * uRefr * dropA * (1.0f - 0.6f * glSmoothstep(0.55f, 1.0f, dropK)) * float2(1.0f / aspect, 1.0f);
  }

  // fog condensation: micro droplets creeping in from the edges
  float condense = 0.0f;
  if (uCondense > 0.01f) {
    float edge = glSmoothstep(0.45f, 1.0f, er + 0.08f * vnoise(vUv * 9.0f));
    float2 g = gl_FragCoord / (5.0f * uPxScale);
    float2 gi = floor(g);
    float2 gf = fract(g) - 0.5f;
    float2 o = (float2(hash12(gi + 3.3f), hash12(gi + 5.7f)) - 0.5f) * 0.45f;
    float r = 0.16f + 0.22f * hash12(gi + 7.1f);
    float on = step(1.0f - edge * uCondense * 0.85f, hash12(gi));
    float m = on * glSmoothstep(r, r * 0.55f, length(gf - o));
    uv += (gf - o) * m * 0.0025f;
    condense = edge * uCondense * 0.32f + m * 0.18f;
  }

  // ---- 2. chromatic aberration (radial, uCA px at the side edges) -------------------------------------
  float2 caOff = (uv - 0.5f) * 2.0f * uCA / uRes.x;
  float3 col;
  col.r = srcRGB(tDiffuse, smpClamp, uv + caOff, src).r;
  col.g = srcRGB(tDiffuse, smpClamp, uv, src).g;
  col.b = srcRGB(tDiffuse, smpClamp, uv - caOff, src).b;

  // photo mode: tilt-shift depth of field around a horizontal focus line
  if (uDof > 0.01f) {
    float k = glSmoothstep(uDofBand, uDofBand + 0.3f, abs(uv.y - uDofFocus));
    float rad = uDof * k;
    if (rad > 0.5f) {
      float3 acc = float3(0.0f);
      float wsum = 0.0f;
      for (int i = 0; i < 32; i++) {
        if (float(i) >= uDofTaps) break;
        float fi = float(i) + 0.5f;
        float r = sqrt(fi / uDofTaps) * rad;
        float a = fi * 2.39996323f;
        float3 sm = srcRGB(tDiffuse, smpClamp, uv + float2(cos(a), sin(a)) * r / uRes, src);
        float lw = luma(sm);
        float w = 1.0f + 6.0f * lw * lw * lw;
        acc += sm * w;
        wsum += w;
      }
      col = glMix(col, acc / wsum, glSmoothstep(0.5f, 2.0f, rad));
    }
  }

  // vortex: radial smear toward the centre + grey veil
  if (uVortex > 0.001f) {
    float3 acc = col;
    for (int i = 1; i <= 5; i++) {
      float s = 1.0f - float(i) * 0.014f * uVortex;
      acc += srcRGB(tDiffuse, smpClamp, 0.5f + (uv - 0.5f) * s, src);
    }
    col = glMix(col, acc / 6.0f, clamp(uVortex, 0.0f, 1.0f));
    float lv = luma(col);
    col = glMix(col, float3(lv * 0.8f + 0.1f), 0.3f * clamp(uVortex, 0.0f, 1.0f));
  }

  // drop shading: a defocused water bead — blurred view, faint lift, darker meniscus, soft highlight
  if (dropA > 0.0f) {
    float2 bo = 2.5f * uPxScale / uRes;
    float3 blur = (srcRGB(tDiffuse, smpClamp, uv + float2(bo.x, bo.y), src) + srcRGB(tDiffuse, smpClamp, uv + float2(-bo.x, bo.y), src)
                 + srcRGB(tDiffuse, smpClamp, uv + float2(bo.x, -bo.y), src) + srcRGB(tDiffuse, smpClamp, uv - bo, src)) * 0.25f;
    col = glMix(col, blur, 0.75f * dropA);
    float lift = (0.02f + 0.06f * luma(col)) * (1.0f - 0.55f * uNight);
    col = glMix(col, col * 1.03f + lift, 0.5f * dropA * (1.0f - glSmoothstep(0.55f, 1.0f, dropK)));
    col *= 1.0f - 0.08f * glSmoothstep(0.6f, 1.0f, dropK) * dropA;
    float3 Ld = normalize(float3(-0.45f, 0.55f, 0.7f));
    float spec = pow(max(dot(normalize(dropN), Ld), 0.0f), 14.0f);
    // light focused through the bead: a soft crescent opposite the highlight
    float caustic = glSmoothstep(0.4f, 0.9f, dropK) * (1.0f - glSmoothstep(0.9f, 1.0f, dropK)) * max(0.0f, dot(dropN.xy, -Ld.xy) / length(Ld.xy));
    col += float3(0.85f, 0.9f, 0.95f) * spec * 0.12f * dropA * (1.0f - 0.5f * uNight) + col * caustic * 0.22f * dropA;
  }
  if (condense > 0.0f) col = glMix(col, float3(luma(col) * 0.7f + 0.22f), clamp(condense, 0.0f, 0.6f));
  if (uSalt > 0.01f) {
    float blot = glSmoothstep(0.45f, 0.8f, vnoise(vUv * float2(aspect, 1.0f) * 7.0f + 13.0f));
    float edge = glSmoothstep(0.3f, 1.0f, er);
    // dried salt: sparse crystalline specks clumped in blotches toward the edges
    float speck = step(1.0f - 0.16f * uSalt * blot * edge, hash12(floor(gl_FragCoord / (1.5f * uPxScale)) + 91.7f));
    col = glMix(col, float3(0.86f, 0.88f, 0.86f), speck * 0.35f + blot * edge * uSalt * 0.06f);
  }

  // ---- thermal / FLIR (white-hot) -------------------------------------------------------------------------
  float3 tcol = float3(0.0f);
  if (uThermal > 0.001f) {
    float2 uvT = uv;
    float boot = uThermBoot;
    if (boot > 0.001f) {
      // torn rows while the sensor boots
      float row = floor(vUv.y * 48.0f);
      float rs = hash12(float2(row, floor(uThermT * 24.0f)));
      uvT.x += (rs - 0.5f) * 0.08f * boot * step(0.72f, hash12(float2(row * 1.7f, floor(uThermT * 30.0f))));
    }
    float3 sc = boot > 0.001f ? srcRGB(tDiffuse, smpClamp, uvT, src) : col;
    // detail enhancement: local contrast against a 4-tap ring
    float2 dp = 4.0f * uPxScale / uRes;
    float Lc = luma(sc);
    float Ln = 0.25f * (luma(srcRGB(tDiffuse, smpClamp, uvT + float2(dp.x, 0.0f), src)) + luma(srcRGB(tDiffuse, smpClamp, uvT - float2(dp.x, 0.0f), src))
                      + luma(srcRGB(tDiffuse, smpClamp, uvT + float2(0.0f, dp.y), src)) + luma(srcRGB(tDiffuse, smpClamp, uvT - float2(0.0f, dp.y), src)));
    float rel = clamp((Lc - Ln) / (Ln + 0.08f), -0.5f, 0.5f);
    // heat (R) and thermal mass (G) from the low-res pass: crisp centre tap + soft two-ring bloom
    // (the heat target is a full-frame render target: GL uv → rtUV, no sub-rect)
    float2 hs0 = tHeat.sample(smpClamp, rtUV(uvT), level(0.0f)).rg;
    float2 hr = float2(uRes.y / uRes.x, 1.0f);
    float2 g1 = float2(0.0f);
    float g2 = 0.0f;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471976f + 0.4f;
      g1 += tHeat.sample(smpClamp, rtUV(uvT + float2(cos(a), sin(a)) * hr * 0.004f), level(0.0f)).rg;
    }
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982f + 0.1f;
      g2 += tHeat.sample(smpClamp, rtUV(uvT + float2(cos(a), sin(a)) * hr * 0.02f), level(0.0f)).r;
    }
    g1 /= 6.0f;
    g2 /= 8.0f;
    // cold sea: dark and nearly uniform; whitecaps and foam emit a touch more
    float foam = glSmoothstep(0.08f, 0.35f, rel) * (0.5f + 0.5f * glSmoothstep(0.15f, 0.6f, Lc));
    float vSea = 0.17f + 0.09f * rel + 0.06f * foam - 0.05f * (vUv.y - 0.5f);
    // warm mass: land, rock, steel and timber hold the day's heat
    float mass = glMix(hs0.g, g1.g, 0.5f);
    float landK = glSmoothstep(0.05f, 0.2f, mass);
    float vLand = 0.3f + mass * (0.24f + 0.08f * (1.0f - uNight)) + 0.16f * rel
                + 0.12f * (1.0f - uNight) * (glSmoothstep(0.02f, 0.5f, Lc) - 0.4f);
    float v = glMix(vSea, vLand, landK);
    // heat: crisp core (dilated a little), bloom, a faint dark halo (bolometer DDE artefact)
    float core = max(hs0.r, min(1.0f, g1.r * 1.5f) * 0.8f);
    float glow = 0.45f * g1.r + 0.55f * g2;
    v -= 0.1f * max(0.0f, g2 - g1.r * 1.5f);
    v = glMix(v, 0.8f + 0.19f * core, glSmoothstep(0.03f, 0.5f, core));
    v += 0.45f * glow * (1.0f - 0.6f * core);
    // sensor: fixed-pattern column noise, scanlines, a slow rolling band, heavy lens vignette
    float2 fc = gl_FragCoord / uPxScale;
    v += 0.012f * (hash12(float2(floor(fc.x * 0.5f), 7.0f)) - 0.5f);
    v *= 1.0f - 0.05f * step(0.5f, fract(fc.y * 0.5f));
    v *= 1.0f + 0.025f * glSmoothstep(0.85f, 1.0f, sin(vUv.y * 3.0f - uThermT * 0.7f));
    v *= 1.0f - 0.36f * er * er;
    // boot: NUC shutter grey + snow
    float snow = hash12(fc + fract(uThermT * 13.7f) * 311.0f);
    v = glMix(v, 0.3f + 0.35f * snow, boot * boot * 0.85f);
    v *= uThermFlick;
    // reticle (screen centre = the FLIR ball's line of sight): crosshair with a gap, corner brackets
    float2 pc = (gl_FragCoord - 0.5f * uRes) / uPxScale;
    float2 q = abs(pc);
    float lw = 0.7f;
    float ret = (1.0f - glSmoothstep(lw, lw + 1.0f, q.y)) * step(12.0f, q.x) * step(q.x, 54.0f)
              + (1.0f - glSmoothstep(lw, lw + 1.0f, q.x)) * step(12.0f, q.y) * step(q.y, 54.0f);
    float2 B = float2(0.3f * uRes.x, 0.3f * uRes.y) / uPxScale;
    float arm = 26.0f;
    ret += (1.0f - glSmoothstep(lw, lw + 1.0f, abs(q.x - B.x))) * step(B.y - arm, q.y) * step(q.y, B.y);
    ret += (1.0f - glSmoothstep(lw, lw + 1.0f, abs(q.y - B.y))) * step(B.x - arm, q.x) * step(q.x, B.x);
    // range ticks under the centre
    float tick = step(abs(glMod(pc.x + 4.0f, 24.0f) - 4.0f), lw) * step(-B.y + 6.0f, pc.y) * step(pc.y, -B.y + 12.0f) * step(q.x, 120.0f);
    ret = clamp(ret + tick, 0.0f, 1.0f) * (1.0f - boot);
    v = glMix(v, v > 0.6f ? 0.08f : 0.92f, ret * 0.6f);
    tcol = float3(clamp(v, 0.0f, 1.0f));
  }

  // ---- 3. pulses ---------------------------------------------------------------------------------------
  float l0 = luma(col);
  col = glMix(col, uFlashTint * l0 * 1.06f, uFlash * glSmoothstep(0.3f, 0.95f, l0) * 0.8f);
  float edgeMask = glSmoothstep(0.42f, 1.0f, er + 0.04f * vnoise(vUv * 6.0f));
  col = glMix(col, uEdge.xyz, clamp(uEdge.w * edgeMask, 0.0f, 1.0f));

  // ---- 4. grading --------------------------------------------------------------------------------------
  // human orange (rafts, vests, the heli's stripes) is measured before grading («защита оранжевого»)
  float orange0;
  {
    float mx0 = max(col.r, max(col.g, col.b));
    float mn0 = min(col.r, min(col.g, col.b));
    orange0 = glSmoothstep(0.12f, 0.35f, mx0 - mn0) * glSmoothstep(0.08f, 0.3f, col.r - col.b) * (1.0f - glSmoothstep(0.55f, 0.8f, col.g / max(col.r, 1e-3f)));
  }
  col = pow(max(col * uSlope + uOffset, float3(0.0f)), float3(uPower));
  col = float3(sCurve(col.r, 0.42f, uContrast), sCurve(col.g, 0.42f, uContrast), sCurve(col.b, 0.42f, uContrast));
  // split tone in soft-light mode; tints are luminance-normalised (hue + chroma only)
  float l = luma(col);
  float3 tS = clamp(glMix(float3(0.5f), uSplitShadow * (0.5f / max(luma(uSplitShadow), 0.02f)), 0.75f), float3(0.0f), float3(1.0f));
  float3 tH = clamp(glMix(float3(0.5f), uSplitHighlight * (0.5f / max(luma(uSplitHighlight), 0.02f)), 0.75f), float3(0.0f), float3(1.0f));
  col = clamp(col, float3(0.0f), float3(1.0f));
  col = glMix(col, softLight(col, tS), uSplitStrength * (1.0f - glSmoothstep(0.0f, 0.6f, l)));
  col = glMix(col, softLight(col, tH), uSplitStrength * glSmoothstep(0.3f, 1.0f, l) * (1.0f - 0.85f * orange0));
  // «Зелёное небо»: sickly olive lift in the shadows and mids
  col += uGreen * float3(0.012f, 0.03f, 0.004f) * (1.0f - l);
  col = glMix(col, col * float3(0.95f, 1.04f, 0.88f), uGreen * 0.6f);
  // saturation with orange protection (DESIGN §2.8)
  {
    float3 c = col;
    float maxc = max(c.r, max(c.g, c.b));
    float minc = min(c.r, min(c.g, c.b));
    float orange = glSmoothstep(0.35f, 0.5f, maxc - minc) * glSmoothstep(0.25f, 0.45f, c.r - c.b) * (1.0f - glSmoothstep(0.45f, 0.7f, c.g / max(c.r, 1e-3f)));
    float sat = glMix(uSat, max(uSat, 1.0f), orange) * uSatMul;
    col = glMix(float3(luma(c)), c, sat);
  }
  col *= uBright;
  // film-base black level: never a dead, pure black (≈ 2–3/255, a touch more at night)
  col = uFloor + col * (1.0f - uFloor);

  // ---- 5. vignette (tinted; milky in fog) ---------------------------------------------------------------
  col = glMix(col, uVignetteColor, uVignette * er * er * (1.25f - 0.25f * er));

  // daylight toe (DESIGN §2.1): lift only the deepest tones (after the vignette)
  if (uDayToe > 0.0f) {
    float lt = luma(col);
    float lift = uDayToe * (1.0f - glSmoothstep(0.0f, 0.2f, lt));
    col *= (lt + lift) / max(lt, 0.02f);
  }
  // photo-mode grade presets («Хроника», «Ч/Б», «Плёнка»)
  if (uLookMix > 0.001f) {
    float3 c = col;
    c = glMix(float3(luma(c)), c, uLookSat);
    c = clamp((c - 0.42f) * uLookContrast + 0.42f, float3(0.0f), float3(1.0f));
    c *= glMix(uLookShadow, uLookHigh, glSmoothstep(0.05f, 0.8f, luma(c)));
    c = uLookFade + c * (1.0f - uLookFade);
    col = glMix(col, c, uLookMix);
  }
  // thermal replaces the graded picture; damage / hull / fuel edges stay on top
  if (uThermal > 0.001f) {
    col = glMix(col, tcol, uThermal);
    col = glMix(col, uEdge.xyz, clamp(uEdge.w * edgeMask, 0.0f, 1.0f) * uThermal);
  }
  // ---- 6. grain: luminance, 24 Hz reseed; chroma noise at night --------------------------------------
  float2 gp = floor(gl_FragCoord / uPxScale);
  float n = hash12(gp + float2(uSeed * 37.0f, uSeed * 17.0f)) + hash12(gp + float2(uSeed * 11.0f + 5.3f, uSeed * 23.0f + 1.7f)) - 1.0f;
  l = luma(col);
  col += n * uGrain * glMix(1.0f, 0.4f, glSmoothstep(0.5f, 1.0f, l));
  col += (float3(hash12(gp + uSeed + 1.1f), hash12(gp + uSeed + 2.3f), hash12(gp + uSeed + 3.7f)) - 0.5f) * 0.024f * uNight * (1.0f - uThermal);

  // ---- 7. letterbox 2.39:1 -----------------------------------------------------------------------------
  float bar = 0.5f * max(0.0f, 1.0f - aspect / 2.39f) * uLetterbox;
  float px1 = 1.0f / uRes.y;
  col *= glSmoothstep(bar - px1, bar, vUv.y) * glSmoothstep(bar - px1, bar, 1.0f - vUv.y);

  // ---- 8. triangular dither ±1/255 ----------------------------------------------------------------------
  float dz = hash12(gl_FragCoord + fract(uSeed * 0.618f) * 97.0f) + hash12(gl_FragCoord * 1.37f + 17.1f) - 1.0f;
  return float4(max(col, float3(0.0f)) + dz / 255.0f, 1.0f);
}
