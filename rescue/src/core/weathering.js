// Shared weathering for man-made surfaces (art-direction pass: "one realistic style").
// Rust/grime run-streaks under edges, albedo & roughness breakup, a ragged waterline band (algae below,
// salt crust above), worn/stained decks and rain wetness — all procedural from world position + the
// shared look atlas, so every prop, vessel, raft and the helicopter weathers the same way.
//
// Usage inside a material's onBeforeCompile (after your own chunk replacements; keep the
// '#include <roughnessmap_fragment>' and '#include <project_vertex>' tokens in the shader):
//   import { patchWeathering, WEAR } from '../../core/weathering.js';
//   mat.onBeforeCompile = (sh) => { ...your patches...; patchWeathering(sh, ctx.look, WEAR.medium); };
//   mat.customProgramCacheKey = () => 'myMat|wx';   // include something unique per variant
// Live tweaks: patchWeathering returns the uniforms object; keep it to change values later.
import * as THREE from 'three';

// Presets. All amounts 0..1. Colours are sRGB hex.
//  breakup      albedo value/hue mottling            streaks   vertical run-streaks on walls
//  grime        dark grime toward the sea / base      waterline algae+salt band around seaLevel
//  roughBreakup roughness variation                   deckWear  stains + centre wear on horizontal faces
//  scale        noise scale multiplier (bigger objects → <1)  seaLevel  world y of the local waterline
export const WEAR = {
  clean: { breakup: 0.05, streaks: 0.08, grime: 0.05, waterline: 0, roughBreakup: 0.08, deckWear: 0.1 },
  light: { breakup: 0.08, streaks: 0.22, grime: 0.15, waterline: 0.6, roughBreakup: 0.12, deckWear: 0.25 },
  medium: { breakup: 0.11, streaks: 0.38, grime: 0.3, waterline: 1, roughBreakup: 0.15, deckWear: 0.4 },
  heavy: { breakup: 0.15, streaks: 0.6, grime: 0.5, waterline: 1, roughBreakup: 0.2, deckWear: 0.6 },
};

const DEFAULTS = {
  breakup: 0.1,
  streaks: 0.35,
  grime: 0.3,
  waterline: 1,
  roughBreakup: 0.15,
  deckWear: 0.35,
  scale: 1,
  seaLevel: 0,
  streakColor: '#6B3A22', // rust bleed
  grimeColor: '#2A2622',
  algaeColor: '#2F3A2C',
  saltColor: '#D8D6CC',
};

const VERT_PARS = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxNrm;
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 wxp = vec4( transformed, 1.0 );
  vec3 wxn = objectNormal;
  #ifdef USE_INSTANCING
    wxp = instanceMatrix * wxp;
    wxn = mat3( instanceMatrix ) * wxn;
  #endif
  wxp = modelMatrix * wxp;
  vWxPos = wxp.xyz;
  vWxNrm = normalize( mat3( modelMatrix ) * wxn );
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxNrm;
uniform sampler2D uWxAtlas;
uniform float uWxWet;
uniform vec4 uWxA;        // breakup, streaks, grime, waterline
uniform vec4 uWxB;        // roughBreakup, deckWear, scale, seaLevel
uniform vec3 uWxStreak;
uniform vec3 uWxGrime;
uniform vec3 uWxAlgae;
uniform vec3 uWxSalt;
vec4 wxTri( vec3 p, vec3 n, float s ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-4 );
  return texture2D( uWxAtlas, p.zy * s ) * w.x + texture2D( uWxAtlas, p.xz * s ) * w.y + texture2D( uWxAtlas, p.xy * s ) * w.z;
}
`;

// Runs right after <roughnessmap_fragment>: diffuseColor and roughnessFactor are both live here.
const FRAG_MAIN = /* glsl */ `
{
  float sc = uWxB.z;
  vec3 n = normalize( vWxNrm );
  vec4 n1 = wxTri( vWxPos, n, 0.08 * sc );
  vec4 n2 = wxTri( vWxPos + 17.3, n, 0.6 * sc );
  // 1. albedo mottling (value ±, slight warm/cool hue drift)
  float br = ( n1.r - 0.5 ) * 0.7 + ( n2.r - 0.5 ) * 0.3;
  diffuseColor.rgb *= 1.0 + br * uWxA.x * 2.0;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.04, 1.0, 0.95 ), clamp( ( n1.g - 0.5 ) * 2.0, 0.0, 1.0 ) * uWxA.x );
  // 2. vertical run-streaks on walls (stretched 1:12 along Y)
  float vert = 1.0 - smoothstep( 0.35, 0.65, abs( n.y ) );
  vec2 hz = normalize( vec2( -n.z, n.x ) + vec2( 1e-4 ) );
  vec2 suv = vec2( dot( vWxPos.xz, hz ) * 0.9, vWxPos.y * 0.075 ) * sc;
  float st = smoothstep( 0.55, 0.85, texture2D( uWxAtlas, suv ).r ) * smoothstep( 0.3, 0.7, texture2D( uWxAtlas, suv * 0.37 + 0.21 ).r );
  diffuseColor.rgb = mix( diffuseColor.rgb, uWxStreak * ( 0.75 + 0.5 * n2.g ), st * vert * uWxA.y );
  // 3. grime gathering low, toward the sea / base
  float h = vWxPos.y - uWxB.w;
  float low = 1.0 - smoothstep( 0.0, 3.5, h );
  diffuseColor.rgb = mix( diffuseColor.rgb, uWxGrime, low * uWxA.z * ( 0.45 + 0.55 * n1.b ) );
  // 4. ragged waterline: algae below ~0.3 m, salt crust above to ~1.3 m
  float rag = ( n2.b - 0.5 ) * 0.5;
  float algae = ( 1.0 - smoothstep( 0.15, 0.45, h + rag ) ) * step( -3.0, h );
  float salt = smoothstep( 0.3, 0.5, h + rag ) * ( 1.0 - smoothstep( 0.8, 1.6, h + rag ) ) * smoothstep( 0.35, 0.7, n1.r );
  diffuseColor.rgb = mix( diffuseColor.rgb, uWxAlgae, algae * uWxA.w * 0.85 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uWxSalt, salt * uWxA.w * 0.4 );
  // 5. decks: low-frequency stains + worn centre paths
  float horiz = smoothstep( 0.75, 0.95, n.y );
  diffuseColor.rgb *= 1.0 - horiz * uWxB.y * smoothstep( 0.35, 0.8, n1.b ) * 0.35;
  // 6. rain wetness darkens, roughness drops (water-polished decks most)
  diffuseColor.rgb *= 1.0 - 0.12 * uWxWet;
  roughnessFactor = clamp( roughnessFactor + ( n2.r - 0.5 ) * 2.0 * uWxB.x - uWxWet * ( 0.12 + 0.2 * horiz ) + algae * uWxA.w * 0.1, 0.04, 1.0 );
}
`;

// Patch a MeshStandard/MeshPhysical shader (inside onBeforeCompile). Returns the uniforms it added.
export function patchWeathering(shader, look, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const u = {
    uWxAtlas: look.uniforms.uAtlas,
    uWxWet: look.uniforms.uWet,
    uWxA: { value: new THREE.Vector4(o.breakup, o.streaks, o.grime, o.waterline) },
    uWxB: { value: new THREE.Vector4(o.roughBreakup, o.deckWear, o.scale, o.seaLevel) },
    uWxStreak: { value: new THREE.Color(o.streakColor) },
    uWxGrime: { value: new THREE.Color(o.grimeColor) },
    uWxAlgae: { value: new THREE.Color(o.algaeColor) },
    uWxSalt: { value: new THREE.Color(o.saltColor) },
  };
  Object.assign(shader.uniforms, u);
  if (!shader.vertexShader.includes('vWxPos')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <project_vertex>', VERT_MAIN + '\n#include <project_vertex>');
  }
  if (!shader.fragmentShader.includes('uWxAtlas')) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_MAIN);
  }
  return u;
}

// Convenience for materials without their own onBeforeCompile: chains any existing hook.
export function addWeathering(material, look, opts = {}, key = 'wx') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    material.userData.weathering = patchWeathering(sh, look, opts);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|' + key;
  material.needsUpdate = true;
  return material;
}
