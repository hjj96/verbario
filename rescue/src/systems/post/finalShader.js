// FinalPass — display-referred grade & lens stack (DESIGN §2.8 «FinalPass», in this order):
//   1. lens drops (beads with refraction 0.018, rim, highlight; rivulets along the flow; fog
//      condensation at the edges; salt crust)
//   2. radial chromatic aberration
//   3. pulses (flash → #DCE6FF highlights, damage / hull / fuel edges, vortex smear + veil)
//   4. grading: CDL slope/offset/power → S-curve around 0.42 → soft-light split tone → greenTint
//      sickly lift → saturation with ORANGE PROTECTION (high-chroma orange only, never boosted)
//   5. tinted vignette (milky in fog)
//   6. luminance grain reseeded at 24 Hz (+ chroma noise at night)
//   7. letterbox 2.39:1
//   8. triangular dither ±1/255
// Input: the OutputPass result (ACES + sRGB already applied). Colour uniforms are sRGB values.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDrops;
uniform vec2 uRes;            // output size, device px
uniform float uPxScale;       // device px per CSS px (grain/condensation cell size)
uniform vec2 uGrid;           // lens-drop grid (28 × 16)
uniform vec2 uFlow;           // drop flow direction, screen space (x right, y up), unit
uniform float uDrops;         // 1 = render beads
uniform float uRefr;          // bead refraction strength (0.018)
uniform float uCondense;      // fog condensation 0..1
uniform float uSalt;          // salt crust 0..1
uniform float uCA;            // chromatic aberration, px at the screen edge
uniform float uFlash;         // 0..1
uniform vec3 uFlashTint;      // #DCE6FF
uniform vec4 uEdge;           // rgb edge colour, a = alpha (damage / hull / fuel pulses)
uniform float uVortex;        // 0..1 radial smear + grey veil
uniform float uBright;        // brightness multiplier (pause)
uniform float uSatMul;        // saturation multiplier from pulses (flash, damage, pause)
uniform vec3 uSlope;
uniform vec3 uOffset;
uniform float uPower;
uniform float uContrast;
uniform float uSat;
uniform vec3 uSplitShadow;
uniform vec3 uSplitHighlight;
uniform float uSplitStrength;
uniform float uGreen;
uniform float uVignette;
uniform vec3 uVignetteColor;
uniform float uGrain;
uniform float uNight;
uniform float uSeed;
uniform float uLetterbox;
uniform float uDayToe;
uniform float uFloor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// W3C soft light: b = base, s = blend.
vec3 softLight(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
}

// Contrast S-curve through (0,0), (p,p), (1,1) with slope c at the pivot.
float sCurve(float x, float p, float c) {
  x = clamp(x, 0.0, 1.0);
  return x < p ? p * pow(x / p, c) : 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), c);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 ec = (vUv - 0.5) * vec2(aspect, 1.0);          // centred, isotropic
  float er = length((vUv - 0.5) * 2.0) * 0.70710678;   // 0 centre → 1 corner (screen-shaped)

  // ---- 1. lens drops ------------------------------------------------------------------------
  float dropA = 0.0;      // coverage (anti-aliased)
  float dropK = 0.0;      // 0 centre → 1 rim
  vec3 dropN = vec3(0.0, 0.0, 1.0);
  if (uDrops > 0.5) {
    vec2 cellPx = uRes / uGrid;
    vec2 p = vUv * uGrid;
    vec2 b = floor(p - 0.5);
    float best = 0.0;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 c = b + vec2(float(i), float(j));
        if (c.x < 0.0 || c.y < 0.0 || c.x >= uGrid.x || c.y >= uGrid.y) continue;
        vec4 d = texture2D(tDrops, (c + 0.5) / uGrid);
        if (d.z <= 0.001) continue;
        // vector from the drop head, in cell heights (isotropic)
        vec2 q = (p - (c + 0.5 + d.xy)) * cellPx / cellPx.y;
        vec2 tail = -uFlow * d.w;
        float h = clamp(dot(q, tail) / max(dot(tail, tail), 1e-5), 0.0, 1.0);
        vec2 dv = q - tail * h;
        float rr = d.z * mix(1.0, 0.42, h);
        float k = length(dv) / rr;
        if (k < 1.0) {
          float hz = sqrt(1.0 - k * k);
          if (hz > best) {
            best = hz;
            dropK = k;
            dropN = vec3(dv / rr, hz);
            // a lens focused at 100+ m sees the bead defocused: its edge is blurred over ≈ 3 px
            dropA = smoothstep(0.0, 1.0, (1.0 - k) * rr * cellPx.y / 3.0);
          }
        }
      }
    }
    // a convex water lens: magnified, inverted view of what is behind it
    uv -= dropN.xy * uRefr * dropA * (1.0 - 0.6 * smoothstep(0.55, 1.0, dropK)) * vec2(1.0 / aspect, 1.0);
  }

  // fog condensation: micro droplets creeping in from the edges
  float condense = 0.0;
  if (uCondense > 0.01) {
    float edge = smoothstep(0.45, 1.0, er + 0.08 * vnoise(vUv * 9.0));
    vec2 g = gl_FragCoord.xy / (5.0 * uPxScale);
    vec2 gi = floor(g);
    vec2 gf = fract(g) - 0.5;
    vec2 o = (vec2(hash12(gi + 3.3), hash12(gi + 5.7)) - 0.5) * 0.45;
    float r = 0.16 + 0.22 * hash12(gi + 7.1);
    float on = step(1.0 - edge * uCondense * 0.85, hash12(gi));
    float m = on * smoothstep(r, r * 0.55, length(gf - o));
    uv += (gf - o) * m * 0.0025;
    condense = edge * uCondense * 0.32 + m * 0.18;
  }

  // ---- 2. chromatic aberration (radial, uCA px at the side edges) -----------------------------
  vec2 caOff = (uv - 0.5) * 2.0 * uCA / uRes.x;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + caOff).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - caOff).b;

  // vortex: radial smear toward the centre + grey veil
  if (uVortex > 0.001) {
    vec3 acc = col;
    for (int i = 1; i <= 5; i++) {
      float s = 1.0 - float(i) * 0.014 * uVortex;
      acc += texture2D(tDiffuse, 0.5 + (uv - 0.5) * s).rgb;
    }
    col = mix(col, acc / 6.0, clamp(uVortex, 0.0, 1.0));
    float lv = luma(col);
    col = mix(col, vec3(lv * 0.8 + 0.1), 0.3 * clamp(uVortex, 0.0, 1.0));
  }

  // drop shading: a defocused water bead — the view through it is blurred, a faint lift, a barely
  // darker meniscus (≤ 8 %) and a soft broad highlight; no icon-like rim or specular dot
  if (dropA > 0.0) {
    vec2 bo = 2.5 * uPxScale / uRes;
    vec3 blur = (texture2D(tDiffuse, uv + vec2(bo.x, bo.y)).rgb + texture2D(tDiffuse, uv + vec2(-bo.x, bo.y)).rgb
               + texture2D(tDiffuse, uv + vec2(bo.x, -bo.y)).rgb + texture2D(tDiffuse, uv - bo).rgb) * 0.25;
    col = mix(col, blur, 0.75 * dropA);
    float lift = (0.02 + 0.06 * luma(col)) * (1.0 - 0.55 * uNight);
    col = mix(col, col * 1.03 + lift, 0.5 * dropA * (1.0 - smoothstep(0.55, 1.0, dropK)));
    col *= 1.0 - 0.08 * smoothstep(0.6, 1.0, dropK) * dropA;
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float spec = pow(max(dot(normalize(dropN), L), 0.0), 14.0);
    // light focused through the bead: a soft crescent opposite the highlight
    float caustic = smoothstep(0.4, 0.9, dropK) * (1.0 - smoothstep(0.9, 1.0, dropK)) * max(0.0, dot(dropN.xy, -L.xy) / length(L.xy));
    col += vec3(0.85, 0.9, 0.95) * spec * 0.12 * dropA * (1.0 - 0.5 * uNight) + col * caustic * 0.22 * dropA;
  }
  if (condense > 0.0) col = mix(col, vec3(luma(col) * 0.7 + 0.22), clamp(condense, 0.0, 0.6));
  if (uSalt > 0.01) {
    float blot = smoothstep(0.45, 0.8, vnoise(vUv * vec2(aspect, 1.0) * 7.0 + 13.0));
    float edge = smoothstep(0.3, 1.0, er);
    // dried salt: sparse crystalline specks clumped in blotches toward the edges
    float speck = step(1.0 - 0.16 * uSalt * blot * edge, hash12(floor(gl_FragCoord.xy / (1.5 * uPxScale)) + 91.7));
    col = mix(col, vec3(0.86, 0.88, 0.86), speck * 0.35 + blot * edge * uSalt * 0.06);
  }

  // ---- 3. pulses ----------------------------------------------------------------------------
  float l0 = luma(col);
  col = mix(col, uFlashTint * l0 * 1.06, uFlash * smoothstep(0.3, 0.95, l0) * 0.8);
  float edgeMask = smoothstep(0.42, 1.0, er + 0.04 * vnoise(vUv * 6.0));
  col = mix(col, uEdge.rgb, clamp(uEdge.a * edgeMask, 0.0, 1.0));

  // ---- 4. grading ---------------------------------------------------------------------------
  // human orange (rafts, vests, the heli's stripes) is measured before grading: the cold highlight
  // split-tone must not turn a lit canopy pink (DESIGN §2.8 «защита оранжевого»)
  float orange0;
  {
    float mx0 = max(col.r, max(col.g, col.b));
    float mn0 = min(col.r, min(col.g, col.b));
    orange0 = smoothstep(.12, .35, mx0 - mn0) * smoothstep(.08, .3, col.r - col.b) * (1. - smoothstep(.55, .8, col.g / max(col.r, 1e-3)));
  }
  col = pow(max(col * uSlope + uOffset, 0.0), vec3(uPower));
  col = vec3(sCurve(col.r, 0.42, uContrast), sCurve(col.g, 0.42, uContrast), sCurve(col.b, 0.42, uContrast));
  // split tone in soft-light mode. The tints are luminance-normalised (hue + chroma only), so a dark
  // shadow tint like nightStorm's #02090D shifts the hue of the shadows instead of crushing them to
  // pure black (DESIGN §2.1: night water never pure black).
  float l = luma(col);
  vec3 tS = clamp(mix(vec3(0.5), uSplitShadow * (0.5 / max(luma(uSplitShadow), 0.02)), 0.75), 0.0, 1.0);
  vec3 tH = clamp(mix(vec3(0.5), uSplitHighlight * (0.5 / max(luma(uSplitHighlight), 0.02)), 0.75), 0.0, 1.0);
  col = clamp(col, 0.0, 1.0);
  col = mix(col, softLight(col, tS), uSplitStrength * (1.0 - smoothstep(0.0, 0.6, l)));
  col = mix(col, softLight(col, tH), uSplitStrength * smoothstep(0.3, 1.0, l) * (1.0 - 0.85 * orange0));
  // «Зелёное небо»: sickly olive lift in the shadows and mids
  col += uGreen * vec3(0.012, 0.03, 0.004) * (1.0 - l);
  col = mix(col, col * vec3(0.95, 1.04, 0.88), uGreen * 0.6);
  // saturation with orange protection (DESIGN §2.8)
  {
    vec3 c = col;
    float maxc = max(c.r, max(c.g, c.b));
    float minc = min(c.r, min(c.g, c.b));
    // a true protection: survivors' orange (vests, rafts, flares: chroma > .35) keeps at least its
    // ungraded saturation; it is never boosted, so warm-sunlit granite is not pushed toward brick
    float orange = smoothstep(.35, .5, maxc - minc) * smoothstep(.25, .45, c.r - c.b) * (1. - smoothstep(.45, .7, c.g / max(c.r, 1e-3)));
    float sat = mix(uSat, max(uSat, 1.0), orange) * uSatMul;
    col = mix(vec3(luma(c)), c, sat);
  }
  col *= uBright;
  // film-base black level: never a dead, pure black (≈ 2–3/255, a touch more at night)
  col = uFloor + col * (1.0 - uFloor);

  // ---- 5. vignette (tinted; milky in fog) ----------------------------------------------------
  col = mix(col, uVignetteColor, uVignette * er * er * (1.25 - 0.25 * er));

  // daylight toe (DESIGN §2.1: open water by day never below ≈0.08): power + S-curve + vignette of
  // the storm grades crushed the sea to ≈0.03–0.05. Lift only the deepest tones (after the
  // vignette, so dark corners obey the floor too); the mids keep the grade's contrast.
  if (uDayToe > 0.0) {
    float lt = luma(col);
    float lift = uDayToe * (1.0 - smoothstep(0.0, 0.2, lt));
    col *= (lt + lift) / max(lt, 0.02);
  }
  // ---- 6. grain: luminance, 24 Hz reseed; chroma noise at night -------------------------------
  vec2 gp = floor(gl_FragCoord.xy / uPxScale);
  float n = hash12(gp + vec2(uSeed * 37.0, uSeed * 17.0)) + hash12(gp + vec2(uSeed * 11.0 + 5.3, uSeed * 23.0 + 1.7)) - 1.0;
  l = luma(col);
  col += n * uGrain * mix(1.0, 0.4, smoothstep(0.5, 1.0, l));
  col += (vec3(hash12(gp + uSeed + 1.1), hash12(gp + uSeed + 2.3), hash12(gp + uSeed + 3.7)) - 0.5) * 0.024 * uNight;

  // ---- 7. letterbox 2.39:1 ------------------------------------------------------------------
  float bar = 0.5 * max(0.0, 1.0 - aspect / 2.39) * uLetterbox;
  float px1 = 1.0 / uRes.y;
  col *= smoothstep(bar - px1, bar, vUv.y) * smoothstep(bar - px1, bar, 1.0 - vUv.y);

  // ---- 8. triangular dither ±1/255 ---------------------------------------------------------
  float dz = hash12(gl_FragCoord.xy + fract(uSeed * 0.618) * 97.0) + hash12(gl_FragCoord.xy * 1.37 + 17.1) - 1.0;
  gl_FragColor = vec4(max(col, 0.0) + dz / 255.0, 1.0);
}`;

export function createFinalMaterial(dropsTexture) {
  const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  return new THREE.ShaderMaterial({
    name: 'MaydayFinalPass',
    uniforms: {
      tDiffuse: { value: null },
      tDrops: { value: dropsTexture },
      uRes: { value: new THREE.Vector2(1280, 720) },
      uPxScale: { value: 1 },
      uGrid: { value: new THREE.Vector2(28, 16) },
      uFlow: { value: new THREE.Vector2(0, -1) },
      uDrops: { value: 0 },
      uRefr: { value: 0.018 },
      uCondense: { value: 0 },
      uSalt: { value: 0 },
      uCA: { value: 0.4 },
      uFlash: { value: 0 },
      uFlashTint: { value: v3(0.86, 0.9, 1) },
      uEdge: { value: new THREE.Vector4(0, 0, 0, 0) },
      uVortex: { value: 0 },
      uBright: { value: 1 },
      uSatMul: { value: 1 },
      uSlope: { value: v3(1, 1, 1) },
      uOffset: { value: v3() },
      uPower: { value: 1 },
      uContrast: { value: 1 },
      uSat: { value: 1 },
      uSplitShadow: { value: v3(0.5, 0.5, 0.5) },
      uSplitHighlight: { value: v3(0.5, 0.5, 0.5) },
      uSplitStrength: { value: 0 },
      uGreen: { value: 0 },
      uVignette: { value: 0.2 },
      uVignetteColor: { value: v3() },
      uGrain: { value: 0.03 },
      uNight: { value: 0 },
      uSeed: { value: 0 },
      uLetterbox: { value: 0 },
      uDayToe: { value: 0 },
      uFloor: { value: 0.008 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
