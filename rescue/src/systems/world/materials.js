// Materials for the world (DESIGN §2.7.3, §2.11): one MeshStandardMaterial patch for every prop
// (vertex colours + per-vertex surface, shared wetness, day rim, cloud shadows, emissive channels,
// local light spill, canvas decals, shared weathering) and a handful of tiny ShaderMaterials for
// things that glow: lamps (bulb + halo billboards), volumetric beams (lighthouse, deck floods), the
// rig flare and the foam collar / contact disc under everything that floats.
//
// WEATHERING / WEAR API (one realistic style: core/weathering.js on every man-made surface)
//   createPropMaterial(look, shared, { wear, seaLevel, scale })
//     wear      'clean' | 'light' | 'medium' | 'heavy' (core/weathering.js WEAR) or an options
//               object — the default for every part of this material (default 'light').
//     seaLevel  world y of the waterline the algae / salt band and base grime gather above (0).
//     scale     weathering noise scale (big hulls / rigs < 1, small boats > 1).
//   Per part (geo.js, baked into aSurf.z — no extra attributes):
//     worn(SURF.steel, 'heavy') or part.wear = 'heavy' | 0..1 overrides the material default;
//     ready-made: SURF.paintWorn, SURF.paintFaded, SURF.steelRusty, SURF.steelWorn,
//     SURF.concreteStained, SURF.concreteWet.
//     part.ground = world y of the land under a static part → base grime, a thin green-grey algae /
//     salt band and the grime gradient gather above that height instead of above the sea.
//   Streak colour is picked per fragment: rust bleed on steel and coloured paint, dark grime on
//   concrete and white / grey paint. Natural rock (aSurf.z = −1) and lit lenses / windows are
//   never weathered. mat.userData.weathering holds the live uniforms (uWxA, uWxB, colours).
//
// Custom shaders end with the tonemapping / colorspace chunks so they look right through the post
// composer (linear target) and straight to the canvas alike.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS, LOOK_GLSL_FUNCS } from '../../core/look.js';
import { patchWeathering, WEAR } from '../../core/weathering.js';

const FINISH = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// Emissive / lamp channels (one shared Float32Array, written by the world every frame).
export const CH = {
  ALWAYS: 0,
  WINDOWS: 1, // warm cabin / accommodation windows (night)
  PERIM: 2, // helideck perimeter lights #3CFF7A
  FLOOD: 3, // deck floodlights #FFE6B0
  NAV: 4, // steady navigation lights
  ANTI: 5, // red obstruction / anti-collision flashers
  LANTERN: 6, // lighthouse lantern (flash when a beam faces the viewer)
  FLAME: 7, // rig flare flicker
  WANDS: 8, // signalman wands
  UNLOAD0: 9, // blue offload lights per pad (#4FA3FF), pads 0..2 → 9..11
  BUOY0: 12, // buoy rhythms: east, west, north, south, isolated, mark → 12..17
  PADLIGHT: 18, // lighthouse / rig pad floods
  BOAT: 19, // scenery boats' steady lights
  BLUE: 20, // patrol boat blue flasher
  CLOUD: 21, // flare glow on the low cloud base
  DIM: 22, // weak always-on (instrument / cabin glows)
  BEACON: 23, // slow white beacon (ship masthead strobe)
};
export const CH_COUNT = 24;
export const GLOWS = 6; // local light-spill slots per prop material

// Uniform objects shared by all world materials (referenced, never copied).
export function createShared() {
  return {
    uChan: { value: new Float32Array(CH_COUNT) },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uCloudK: { value: 0 },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uScatter: { value: 0 }, // 0..1 fog/rain scatter: halos grow, beams thicken
    uFoamCol: { value: new THREE.Color('#F1F4EE') },
    uLampK: { value: new THREE.Vector3(1, 0.35, 1) }, // bulb gain, halo gain, min px
    uNightK: { value: 0 },
  };
}

// Horizontal-bubble fog factor (same maths as look.js' fog patch), for additive materials that
// fade instead of mixing toward the fog colour.
const FOG_FADE = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
float worldFogF(vec3 wp) {
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  float hd = length(wp.xz - cameraPosition.xz - focus);
  return smoothstep(uFogNear, uFogFar, hd) * (1.0 - 0.6 * smoothstep(30.0, 140.0, wp.y));
}
`;

// Light loop with the sun's shadow term captured into propShadow (same patch idea as the ocean's
// coloured shadows). Props are lit twice by "sky" (hemisphere + PMREM environment), so a shadow that
// only removes direct sun reads faint on bright decks and rock: the captured term also occludes part
// of the indirect light (the heli hovering 5 m over a deck blocks the sky too) — DESIGN §2.7.2.
function propLightsBegin() {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const re = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \],([^;]*);/;
  const out = src.replace(re, (m, rest) => `propShadow = min( propShadow, ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ],${rest} );\n\t\tdirectLight.color *= propShadow;`);
  return out === src ? null : out;
}
const PROP_LIGHTS_BEGIN = propLightsBegin();

const _f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const _wxA = (w) => `vec4(${_f(w.breakup)}, ${_f(w.streaks)}, ${_f(w.grime)}, ${_f(w.waterline)})`;
const _wxB = (w) => `vec2(${_f(w.roughBreakup)}, ${_f(w.deckWear)})`;
// The four WEAR presets as GLSL constants: per-part levels interpolate clean → light → medium → heavy.
const WX_PRESETS = /* glsl */ `
const vec4 WXA0 = ${_wxA(WEAR.clean)}; const vec4 WXA1 = ${_wxA(WEAR.light)};
const vec4 WXA2 = ${_wxA(WEAR.medium)}; const vec4 WXA3 = ${_wxA(WEAR.heavy)};
const vec2 WXB0 = ${_wxB(WEAR.clean)}; const vec2 WXB1 = ${_wxB(WEAR.light)};
const vec2 WXB2 = ${_wxB(WEAR.medium)}; const vec2 WXB3 = ${_wxB(WEAR.heavy)};
`;
// Runs just before the shared weathering block: per-part wear level (aSurf.z), land ground height
// (uv when aSurf.w ≥ 0 and uv.y = 1), rust-or-grime streak colour, no weathering on rock / lamps.
const WX_DECODE = /* glsl */ `
vec4 wxA = uWxA;
vec4 wxB = uWxB;
if (vSurf.z < -0.02 && vSurf.z > -0.5) {
  float wl = clamp((-vSurf.z - 0.05) / 0.4, 0.0, 1.0) * 3.0;
  float wf = fract(min(wl, 2.999));
  vec4 a0 = wl < 1.0 ? WXA0 : (wl < 2.0 ? WXA1 : WXA2);
  vec4 a1 = wl < 1.0 ? WXA1 : (wl < 2.0 ? WXA2 : WXA3);
  vec2 b0 = wl < 1.0 ? WXB0 : (wl < 2.0 ? WXB1 : WXB2);
  vec2 b1 = wl < 1.0 ? WXB1 : (wl < 2.0 ? WXB2 : WXB3);
  wxA = mix(a0, a1, wf);
  wxB.xy = mix(b0, b1, wf);
}
float wxOn = (vSurf.z > 0.0 || vSurf.z < -0.5) ? 0.0 : 1.0;
wxA *= wxOn;
wxB.xy *= wxOn;
if (vSurf.w > -0.5 && vPropG.y > 0.5) {
  wxB.w = vPropG.x; // standing on land: base grime + a thin splash / algae line above the ground
  wxA.w *= 0.5;
}
float wxMx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float wxSat = (wxMx - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / max(wxMx, 1e-3);
vec3 wxStreak = mix(uWxGrime * 1.35, uWxStreak, max(smoothstep(0.15, 0.4, vSurf.y), smoothstep(0.12, 0.35, wxSat)));
`;

// ------------------------------------------------------------------------------------------------
// Props. aSurf = (roughness, metalness, emissive gain, channel); channel < 0 → decal surface.
// Instanced meshes may encode glow in instanceColor > 1 (emissive = colour − 1).
// Shared wetness: albedo ×(1 − .15·wet), roughness −.25·wet. Day rim: hemiSky·pow(1−N·V,3)·.35.
// Cloud shadows: the sun share × mix(1, .72, lookCloud·k) — same field the ocean darkens.
// Local light spill (uGlowPos/uGlowCol, object space): floods paint decks, the flare paints steel.
export function createPropMaterial(look, shared, { decal = null, name = 'prop', wear = 'light', seaLevel = 0, scale = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0 });
  mat.name = `world-${name}`;
  const u = {
    ...look.uniforms,
    uChan: shared.uChan,
    uRim: shared.uRim,
    uCloudK: shared.uCloudK,
    uDecal: { value: decal },
    uGlowPos: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
    uGlowCol: { value: Array.from({ length: GLOWS }, () => new THREE.Color(0, 0, 0)) },
  };
  mat.userData.uniforms = u;
  if (decal) mat.defines = { USE_WORLD_DECAL: '' };
  const wxOpts = { ...(typeof wear === 'string' ? WEAR[wear] || WEAR.light : wear), seaLevel, scale };
  mat.onBeforeCompile = (sh) => {
    // shared weathering first (its block lands right after <roughnessmap_fragment>); our own
    // roughness / per-part wear decode is inserted after the same token below, i.e. BEFORE it.
    mat.userData.weathering = patchWeathering(sh, look, wxOpts);
    sh.fragmentShader = sh.fragmentShader.replace(/uWx([AB])\./g, 'wx$1.').replace(/uWxStreak \*/g, 'wxStreak *');
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSurf;
        varying vec4 vSurf;
        varying vec3 vPropW;
        varying vec3 vPropL;
        varying vec2 vPropG;
        #ifdef USE_WORLD_DECAL
          varying vec2 vDecalUv;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurf = aSurf;
        vPropG = uv;
        vPropL = transformed;
        vec4 propW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          propW = instanceMatrix * propW;
        #endif
        vPropW = (modelMatrix * propW).xyz;
        #ifdef USE_WORLD_DECAL
          vDecalUv = uv;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${LOOK_GLSL_UNIFORMS}
        ${LOOK_GLSL_FUNCS}
        uniform float uChan[${CH_COUNT}];
        uniform vec3 uRim;
        uniform float uCloudK;
        uniform vec4 uGlowPos[${GLOWS}];
        uniform vec3 uGlowCol[${GLOWS}];
        varying vec4 vSurf;
        varying vec3 vPropW;
        varying vec3 vPropL;
        varying vec2 vPropG;
        float propShadow = 1.0;
        ${WX_PRESETS}
        #ifdef USE_WORLD_DECAL
          uniform sampler2D uDecal;
          varying vec2 vDecalUv;
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 propInstGlow = max(diffuseColor.rgb - 1.0, 0.0);
        diffuseColor.rgb = min(diffuseColor.rgb, vec3(1.0));
        vec3 propEm = vec3(0.0);
        if (vSurf.z > 0.0) {
          float chv = uChan[int(clamp(vSurf.w, 0.0, ${CH_COUNT - 1}.0) + 0.5)];
          propEm = diffuseColor.rgb * vSurf.z * chv;
          diffuseColor.rgb *= 0.14; // lenses and windows read as dark glass when unlit
        }
        #ifdef USE_WORLD_DECAL
          if (vSurf.w < -0.5) {
            vec4 dc = texture2D(uDecal, vDecalUv);
            diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);
          }
        #endif
        diffuseColor.rgb *= 1.0 - 0.05 * uWet; // + the weathering block's wet darkening
        // natural rock (aSurf.z = −1): wet dark band at the waterline with a ragged, splash-driven top,
        // a slick sheen on it, and large-scale tone variation so a pile of rocks never reads uniform
        float propWetBand = 0.0;
        if (vSurf.z < -0.5) {
          float rn = texture2D(uAtlas, vPropW.xz * 0.045 + vec2(0.31, 0.17)).r;
          float rn2 = texture2D(uAtlas, vPropW.xz * 0.19 + vPropW.y * 0.07).r;
          float wetTop = 0.9 + 1.7 * rn + 0.5 * rn2 + 1.2 * uWet;
          propWetBand = 1.0 - smoothstep(wetTop - 0.9, wetTop, vPropW.y);
          diffuseColor.rgb *= mix(1.0, 0.42, propWetBand);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.92, 0.84), propWetBand * (1.0 - smoothstep(0.0, 0.6, vPropW.y)));
          float tone = texture2D(uAtlas, vPropW.xz * 0.012 + vec2(0.7, 0.2)).r;
          diffuseColor.rgb *= mix(vec3(0.86, 0.88, 0.9), vec3(1.1, 1.06, 1.0), tone);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vSurf.x - 0.1 * uWet, 0.04, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.32, propWetBand);
        ${WX_DECODE}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = vSurf.y;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += propEm + propInstGlow;
        float propRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += uRim * propRim * 0.35;
        vec3 propSpill = vec3(0.0);
        for (int i = 0; i < ${GLOWS}; i++) {
          vec3 gd = vPropL - uGlowPos[i].xyz;
          propSpill += uGlowCol[i] * exp(-dot(gd, gd) / (uGlowPos[i].w * uGlowPos[i].w));
        }
        totalEmissiveRadiance += propSpill * diffuseColor.rgb;`,
      )
      .replace('#include <lights_fragment_begin>', PROP_LIGHTS_BEGIN || '#include <lights_fragment_begin>')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float propCloud = mix(1.0, 0.72, lookCloud(vPropW.xz) * uCloudK);
        reflectedLight.directDiffuse *= propCloud;
        reflectedLight.directSpecular *= propCloud;
        float propOcc = mix(1.0, 0.45, 1.0 - propShadow);
        reflectedLight.indirectDiffuse *= propOcc;
        reflectedLight.indirectSpecular *= propOcc;`,
      );
  };
  mat.customProgramCacheKey = () => `mayday-world-prop-v5wx${decal ? '-decal' : ''}`;
  return mat;
}

// Set a local light-spill slot (object space position, radius, colour × intensity).
export function setGlow(mat, i, x, y, z, radius, color, intensity) {
  const u = mat.userData.uniforms;
  if (!u || i >= GLOWS) return;
  u.uGlowPos.value[i].set(x, y, z, Math.max(0.1, radius));
  u.uGlowCol.value[i].copy(color).multiplyScalar(intensity);
}

// ------------------------------------------------------------------------------------------------
// Lamps: every bulb + halo of the world in ONE additive draw call. Instanced quads with
// iPos (world), iCol (rgb, gain), iSz (bulb m, halo m, channel, fog penetration).
// Minimum screen size so distant lamps never alias away; halos swell in fog/rain (scatter).
export function createLampMaterial(look, shared) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uChan: shared.uChan,
      uResolution: look.uniforms.uResolution,
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uScatter: shared.uScatter,
      uLampK: shared.uLampK,
    },
    vertexShader: /* glsl */ `
      ${FOG_FADE}
      uniform float uChan[${CH_COUNT}];
      uniform vec2 uResolution;
      uniform float uScatter;
      uniform vec3 uLampK;
      attribute vec3 iPos;
      attribute vec4 iCol;
      attribute vec4 iSz;
      varying vec3 vCol;
      varying vec2 vC;
      varying float vBulb;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float depth = max(-mv.z, 1.0);
        float pxPerM = projectionMatrix[1][1] * 0.5 * uResolution.y / depth;
        float halo = iSz.y * (1.0 + 0.7 * uScatter);
        float R = max(halo, uLampK.z * 3.0 / pxPerM);
        float bulb = max(iSz.x, uLampK.z * 1.1 / pxPerM);
        vBulb = min(0.95, bulb / R);
        vC = position.xy;
        mv.xy += position.xy * R;
        mv.z += min(R + 0.5, 8.0); // pull toward the camera: decks and hulls never clip the halo
        gl_Position = projectionMatrix * mv;
        float ch = uChan[int(iSz.z + 0.5)];
        float f = worldFogF(iPos);
        vCol = iCol.rgb * iCol.a * ch * (1.0 - f * (1.0 - iSz.w));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLampK;
      varying vec3 vCol;
      varying vec2 vC;
      varying float vBulb;
      void main() {
        float r = length(vC);
        if (r > 1.0) discard;
        float core = 1.0 - smoothstep(vBulb * 0.45, vBulb, r);
        float halo = exp(-r * r * 5.0) * (1.0 - r * r) * (1.0 - r * r); // smooth to zero: no ring at the rim
        vec3 c = vCol * (core * uLampK.x + halo * uLampK.y);
        gl_FragColor = vec4(c, 1.0);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------------------------------------
// Volumetric beam (lighthouse double beam, deck flood cones): additive open cone, attribute aV
// 0 at the lamp → 1 at the far end. alpha = density·gauss(1−|N·V|)·falloff·noise (capped at .5),
// faded by the fog bubble except for uPen (a beam in fog is lit fog itself, but still translucent).
export function createBeamMaterial(look, shared, { color = '#FFF4DC' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...look.uniforms,
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uColor: { value: new THREE.Color(color) },
      uDensity: { value: 0.03 },
      uIntensity: { value: 0 },
      uPen: { value: 0.5 },
      uFall: { value: 1.4 },
    },
    vertexShader: /* glsl */ `
      attribute float aV;
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vW;
      void main() {
        vV = aV;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${LOOK_GLSL_UNIFORMS}
      ${FOG_FADE}
      uniform vec3 uColor;
      uniform float uDensity, uIntensity, uPen, uFall;
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vW;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vView)));
        // soft Gaussian edge (no hard cone silhouette), drifting density lumps along and across
        // the beam (wind-carried haze + slow vertical banding), intensity dying with distance
        float edge = exp(-pow((1.0 - ndv) * 3.2, 2.0));
        float n1 = texture2D(uAtlas, vW.xz * 0.011 - uWindOffset * 0.011 + vec2(uTime * 0.004, 0.0)).r;
        float n2 = texture2D(uAtlas, vW.xz * 0.045 + vec2(0.0, uTime * 0.02) - uWindOffset * 0.045).g;
        float n3 = texture2D(uAtlas, vec2((vW.x + vW.z) * 0.021, vW.y * 0.09) + vec2(uTime * 0.01, 0.0)).r;
        float noise = (0.35 + 1.2 * n1 * (0.55 + 0.7 * n2)) * (0.6 + 0.8 * n3);
        float along = pow(1.0 - vV, uFall) * smoothstep(0.0, 0.012, vV);
        float a = uDensity * edge * along * noise;
        a *= 1.0 - worldFogF(vW) * (1.0 - uPen);
        a *= smoothstep(-0.5, 2.0, vW.y); // dies where it meets the sea
        gl_FragColor = vec4(uColor * min(a * uIntensity, 0.5), 1.0); // lit haze, never a solid wedge
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// Beam geometry: open cone along +X from (0,0,0), length L, radius r0 → r1. Optional mirrored
// twin (lighthouse double beam).
export function beamGeometry(L, r0, r1, { twin = false, radial = 14, segs = 6, tilt = 0 } = {}) {
  const make = (flip) => {
    const g = new THREE.CylinderGeometry(r1, r0, L, radial, segs, true);
    // CylinderGeometry: +Y top (r1) … −Y bottom (r0). Move base to origin, axis → +X.
    g.translate(0, L / 2, 0);
    g.rotateZ(-Math.PI / 2);
    const pos = g.attributes.position;
    const v = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) v[i] = Math.min(1, Math.max(0, pos.getX(i) / L));
    g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    if (tilt) g.rotateZ(tilt); // negative = dips below the horizon
    if (flip) g.rotateY(Math.PI);
    return g.toNonIndexed();
  };
  const a = make(false);
  if (!twin) return a;
  const b = make(true);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aV']) {
    const A = a.attributes[name], B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  a.dispose();
  b.dispose();
  return out;
}

// ------------------------------------------------------------------------------------------------
// Rig flare: tapered open tube along +Y (0..1) bent by the wind in the vertex shader, flickering,
// additive, white-yellow core → #FF8A2A → smoky red tip. uBend = world offset at the tip per metre
// of flame length (object space == world orientation; the flame group is never rotated).
export function createFlameMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: look.uniforms.uTime,
      uAtlas: look.uniforms.uAtlas,
      uBend: { value: new THREE.Vector3() },
      uLen: { value: 14 },
      uRad: { value: 2.6 },
      uI: { value: 1 },
      uSeed: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uLen, uRad, uSeed;
      uniform vec3 uBend;
      varying float vH;
      varying float vA;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float h = position.y;
        float t = uTime + uSeed;
        vec3 p = position;
        float flick = 1.0 + 0.16 * sin(t * 13.0 + h * 6.0) + 0.1 * sin(t * 23.0 + h * 11.0 + position.x * 3.0);
        p.xz *= uRad * flick;
        float len = uLen * (0.88 + 0.1 * sin(t * 7.3) + 0.06 * sin(t * 17.1));
        p.y = h * len;
        // licking tongues near the tip
        p.x += sin(t * 9.0 + h * 5.0) * 0.5 * h * h;
        p.z += cos(t * 8.0 + h * 4.0) * 0.5 * h * h;
        p += uBend * (h * h) * len;
        vH = h;
        vA = atan(position.z, position.x);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uI, uSeed;
      uniform sampler2D uAtlas;
      varying float vH;
      varying float vA;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vView)));
        float n = texture2D(uAtlas, vec2(vA * 0.32 + uSeed, vH * 0.9 - uTime * 1.7)).r;
        float n2 = texture2D(uAtlas, vec2(vA * 0.7, vH * 2.1 - uTime * 3.1)).g;
        float body = 1.0 - smoothstep(0.3, 1.0, vH + (n - 0.5) * 0.8 + (n2 - 0.5) * 0.3);
        float core = pow(ndv, 2.5) * (1.0 - vH) * (1.0 - vH);
        vec3 col = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.72, 0.32), core);
        col = mix(col, vec3(0.6, 0.12, 0.02), smoothstep(0.45, 1.0, vH));
        float tongues = smoothstep(0.25, 0.7, n * 0.7 + n2 * 0.6);
        float a = body * (0.18 + 0.82 * pow(ndv, 0.9)) * mix(0.55, 1.0, tongues) * smoothstep(0.0, 0.06, vH);
        gl_FragColor = vec4(col * a * uI, 1.0);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export function flameGeometry() {
  const g = new THREE.CylinderGeometry(0.08, 1, 1, 12, 10, true);
  g.translate(0, 0.5, 0);
  return g;
}

// ------------------------------------------------------------------------------------------------
// Water contact (DESIGN §2.7.2 "floating objects"): soft foam collar 0.8R…1.6R (atlas blotches x
// bubble speckle, exponential falloff from the hull, alpha ≤ .55, lace only as a faint modulation)
// + dark contact disc 25 %. iData.y < 0 marks a trailing wake instance (Collars.pushWake). Instanced unit disc (radius 1 == 1.6R), per instance
// iData = (foam, contact darkness, searchlight, phase). Normal blending + fog.
export function createCollarMaterial(look, shared) {
  const fogU = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(fogU, {
      uLace: look.uniforms.uLace,
      uAtlas: look.uniforms.uAtlas,
      uTime: look.uniforms.uTime,
      uFoamCol: shared.uFoamCol,
      uNight: look.uniforms.uNight,
    }),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 iData;
      varying vec2 vP;
      varying vec3 vW;
      varying vec4 vData;
      void main() {
        vP = position.xz;
        vData = iData;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uLace;
      uniform sampler2D uAtlas;
      uniform float uTime;
      uniform vec3 uFoamCol;
      uniform float uNight;
      varying vec2 vP;
      varying vec3 vW;
      varying vec4 vData;
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        vec2 w = vW.xz;
        // soft foam: low-frequency blotches x fine bubble speckle (atlas fbm + worley cells),
        // falling off exponentially from the hull; the lace is only a faint modulation
        float blot = texture2D(uAtlas, w * 0.05 + vec2(vData.w * 0.37, uTime * 0.006)).r;
        float blot2 = texture2D(uAtlas, w * 0.13 - vec2(uTime * 0.012, vData.w)).r;
        float c1 = texture2D(uAtlas, w * 0.32 + vec2(vData.w, uTime * 0.02)).g;
        float c2 = texture2D(uAtlas, w * 0.85 - vec2(uTime * 0.03, vData.w * 0.5)).g;
        float speck = (1.0 - smoothstep(0.06, 0.3, c1)) * 0.6 + (1.0 - smoothstep(0.08, 0.28, c2)) * 0.5;
        float lace = texture2D(uLace, w * 0.09 + vec2(vData.w, uTime * 0.05)).r;
        float foam, contact;
        if (vData.y < 0.0) {
          // trailing wake (elongated instance, local +z downstream): streaky froth, no dark disc
          float st = texture2D(uAtlas, vec2(vP.x * 1.6, vP.y * 0.22) + vec2(vData.w, -uTime * 0.03)).r;
          float body = exp(-r * r * 3.0) * (1.0 - smoothstep(0.7, 1.0, r));
          foam = body * (0.3 + 0.9 * smoothstep(0.35, 0.75, st)) * (0.6 + 0.4 * speck) * (0.85 + 0.15 * lace) * vData.x * 0.45;
          contact = 0.0;
        } else {
          contact = (1.0 - smoothstep(0.3, 0.58, r)) * vData.y;
          float d = max(0.0, r - 0.56 + (blot2 - 0.5) * 0.12) / 0.44;
          float fall = exp(-d * 3.5) * (1.0 - smoothstep(0.82, 1.0, r + (blot - 0.5) * 0.2));
          float froth = smoothstep(0.5, 0.58, r) * (1.0 - smoothstep(0.6, 0.7 + 0.12 * blot, r)); // waterline froth
          float body = fall * (0.3 + 0.9 * smoothstep(0.3, 0.72, blot)) * (0.5 + 0.5 * speck) * (0.85 + 0.15 * lace);
          foam = clamp(max(body, froth * (0.55 + 0.45 * speck)), 0.0, 1.0) * smoothstep(0.46, 0.56, r) * vData.x * 0.55;
        }
        vec3 fc = uFoamCol * (1.0 + 3.5 * vData.z);
        float a = clamp(foam + contact, 0.0, 1.0);
        vec3 col = mix(vec3(0.004, 0.012, 0.016), fc, foam / max(a, 1e-4));
        gl_FragColor = vec4(col, a);
        ${FINISH}
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}
