// Ocean material: MeshStandardMaterial + onBeforeCompile (DESIGN §2.6.1, §2.6.5).
// Standard lighting stays intact so the water receives the sun shadow, the heli SpotLight and the
// pooled PointLights; our layers are injected around it (see shaders.js for the order).
import * as THREE from 'three';
import {
  OCEAN_VERTEX_PARS,
  OCEAN_VERTEX_BEGINNORMAL,
  OCEAN_VERTEX_BEGIN,
  OCEAN_FRAGMENT_PARS,
  OCEAN_FRAGMENT_SURFACE,
  OCEAN_FRAGMENT_ROUGHNESS,
  OCEAN_FRAGMENT_NORMAL,
  OCEAN_FRAGMENT_EMISSIVE,
  OCEAN_FRAGMENT_FINAL,
} from './shaders.js';
import { MAX_FEATURES } from './features.js';

const v4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
const col = () => new THREE.Color();

// Ocean-side samplers over the SAME texel arrays as look.* (so lookGust()/lookCloud() and the CPU
// mirrors stay identical) but without 4× anisotropy: the camera never looks more than ~46° from
// nadir, and ~10 lookups per water pixel make anisotropic filtering the dominant cost.
function samplerCopy(src, anisotropy) {
  const img = src.image;
  const t = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// All ocean-owned uniforms. Arrays are flat Float32Arrays (uploaded without copies).
export function createOceanUniforms(look, bank, features) {
  return {
    ...look.uniforms, // shared by reference: uTime, uWind, uWindOffset, uRain, gust fronts …
    uAtlas: { value: samplerCopy(look.atlas, 1) },
    uDetail: { value: samplerCopy(look.detail, 2) },
    uLace: { value: samplerCopy(look.lace, 1) },
    // waves & grid
    uWaveA: { value: bank.uWaveA },
    uWaveB: { value: bank.uWaveB },
    uOffset: { value: new THREE.Vector2() },
    uGridStep: { value: 2 / 300 },
    uHsEff: { value: 1 },
    uShoalCount: { value: 0 },
    uShoals: { value: new Float32Array(32) },
    // features + downwash
    uFeatCount: { value: 0 },
    uFeatA: { value: features.uA },
    uFeatB: { value: features.uB },
    uFeatC: { value: features.uC },
    uDownwash: { value: v4(0, 0, 10, 0) },
    // palette
    uDeep: { value: col() },
    uBody: { value: col() },
    uCrest: { value: col() },
    uShallow: { value: col() },
    uFoamCol: { value: col() },
    uSkyCol: { value: col() },
    uFogCol: { value: col() },
    uSunCol: { value: col() },
    uSpecCol: { value: col() },
    uAmbCol: { value: col() },
    uShadowTint: { value: col() },
    uFlashCol: { value: col() },
    uSunDirV: { value: new THREE.Vector3(0, 1, 0) },
    uSeaA: { value: v4() },
    uSeaB: { value: v4() },
    uSeaC: { value: v4() },
    uSeaD: { value: v4(600) },
    uSeaE: { value: v4(3) },
    uJStats: { value: v4(0.1, 0.5) },
    uDetOff: { value: v4() },
    uDetRot: { value: v4(1, 0, 1, 0) },
    uStreakRot: { value: v4(1, 0, 1, 0) },
    uStreakMix: { value: 0 },
    uHeliP: { value: v4(0, 0, 100, 0) },
    // searchlight / glints / splashes
    uSearchPos: { value: new THREE.Vector3() },
    uSearchDir: { value: v4(0, -1, 0, 0.95) },
    uSearchI: { value: 0 },
    uGlintCount: { value: 0 },
    uGlints: { value: new Float32Array(32) },
    uGlintCol: { value: new Float32Array(32) },
    uSplashCount: { value: 0 },
    uSplash: { value: new Float32Array(96) },
    uSplashS: { value: new Float32Array(24) },
    // water memory
    uMem: { value: null },
    uMemWin: { value: v4(0, 0, 320, 0) },
    uSunDirS: { value: new THREE.Vector3(0, 1, 0) },
    uSpotWater: { value: 0.3 }, // share of the physical SpotLights on the water (layer 11 is look-driven)
    uFront: { value: v4(0, 0, 1, 0) },
    uFrontB: { value: v4(0, 120, 0, 0) },
    uPrevDeep: { value: col() },
    uPrevBody: { value: col() },
    uPrevCrest: { value: col() },
    uPrevFoam: { value: col() },
    uNextDeep: { value: col() },
    uNextBody: { value: col() },
    uNextCrest: { value: col() },
    uNextFoam: { value: col() },
    uPrevSea: { value: v4() },
    uNextSea: { value: v4() },
    uLookK: { value: v4(0.5, 1, 0.9, 0) },
  };
}

// Patch the light loop: capture the sun's shadow term (coloured shadows, layer 15) and apply the
// cloud-shadow multiplier to directional light only (layer 6). Falls back to getShadowMask().
function patchLightsBegin() {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const shadowRe =
    /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \],([^;]*);/;
  let out = src.replace(
    shadowRe,
    (m, rest) => `oShadow = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ],${rest};\n\t\tdirectLight.color *= oShadow;`,
  );
  const captured = out !== src;
  out = out.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= oCloudMul;',
  );
  // Spot lights (heli searchlight, lighthouse): on the water only a share of the physical light —
  // the pool's brightness is the look-driven layer 11 (DESIGN §2.1 pool 0.75–0.9). At full
  // strength the GGX glare of the lamp and lit downwash foam blew out under the night bloom.
  out = out.replace(
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tdirectLight.color *= uSpotWater;',
  );
  // The sun only contributes its specular: the water's diffuse response to sun and sky is the
  // look-driven term in OCEAN_FRAGMENT_FINAL. Local lights (searchlight, flares) stay physical.
  const dirAt = out.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
  const call = 'RE_Direct( directLight, geometryPosition';
  const callAt = dirAt >= 0 ? out.indexOf(call, dirAt) : -1;
  if (callAt >= 0) out = out.slice(0, callAt) + 'oSunSpecular( directLight, geometryPosition' + out.slice(callAt + call.length);
  return { code: out, captured };
}

const SUN_SPECULAR = /* glsl */ `
void oSunSpecular( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
  // × visibility of the sun disk (no sharp sun highlights under an overcast sky)
  reflectedLight.directSpecular += dotNL * directLight.color * uLookK.w * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
}
`;

function inject(src, include, code, where = 'after') {
  const tag = `#include <${include}>`;
  if (!src.includes(tag)) {
    console.error(`[ocean] shader chunk ${include} not found`);
    return src;
  }
  return src.replace(tag, where === 'after' ? `${tag}\n${code}` : where === 'before' ? `${code}\n${tag}` : code);
}

export function oceanDefines(qualityCfg, memoryOn) {
  const d = {
    OCEAN_WAVES: qualityCfg.waves,
    OCEAN_Q: qualityCfg.q,
    OCEAN_RAIN_LAYERS: qualityCfg.q === 2 ? 2 : qualityCfg.q === 1 ? 1 : 0,
    OCEAN_GLINTS: qualityCfg.glints,
    OCEAN_MAX_FEATURES: MAX_FEATURES,
  };
  if (memoryOn) d.OCEAN_MEMORY = 1;
  return d;
}

export function createOceanMaterial(uniforms, defines) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0,
    envMapIntensity: 0, // reflections are analytic (layer 5)
  });
  mat.name = 'ocean';
  mat.defines = { ...defines };
  const lights = patchLightsBegin();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    vs = inject(vs, 'common', OCEAN_VERTEX_PARS);
    vs = inject(vs, 'beginnormal_vertex', OCEAN_VERTEX_BEGINNORMAL, 'replace');
    vs = inject(vs, 'begin_vertex', OCEAN_VERTEX_BEGIN, 'replace');
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = inject(fs, 'common', OCEAN_FRAGMENT_PARS);
    if (!lights.captured) fs = inject(fs, 'shadowmap_pars_fragment', '#include <shadowmask_pars_fragment>');
    fs = inject(fs, 'color_fragment', OCEAN_FRAGMENT_SURFACE);
    fs = inject(fs, 'roughnessmap_fragment', OCEAN_FRAGMENT_ROUGHNESS);
    fs = inject(fs, 'normal_fragment_maps', OCEAN_FRAGMENT_NORMAL);
    fs = inject(fs, 'emissivemap_fragment', OCEAN_FRAGMENT_EMISSIVE);
    fs = inject(fs, 'lights_physical_pars_fragment', SUN_SPECULAR);
    fs = inject(fs, 'lights_fragment_begin', lights.code, 'replace');
    // No IBL (analytic sky instead) and no hemisphere/ambient diffuse (part of the look term).
    fs = inject(fs, 'lights_fragment_maps', 'irradiance = vec3( 0.0 );', 'replace');
    const final = lights.captured ? OCEAN_FRAGMENT_FINAL : `oShadow = getShadowMask();\n${OCEAN_FRAGMENT_FINAL}`;
    fs = inject(fs, 'opaque_fragment', final, 'before');
    shader.fragmentShader = fs;
  };
  // Program cache: defines are part of the key already; bump the tag when the injection changes.
  mat.customProgramCacheKey = () => 'mayday-ocean-2';
  return mat;
}
