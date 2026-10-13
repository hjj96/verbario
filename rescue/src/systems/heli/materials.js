// Materials for «Чайка-07» (DESIGN §2.7.3, §2.9). All custom shaders end with the tonemapping /
// colorspace chunks, so they look right both through the post composer (linear HalfFloat target) and
// when rendering straight to the canvas.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';

const FINISH = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export const HULL_GLOWS = 8;

// ------------------------------------------------------------------------------------------------
// Hull: ONE MeshPhysicalMaterial for the whole merged airframe. Per-vertex `aSurf`
// (x roughness, y metalness, z clearcoat weight, w flags: 0 paint/metal, 1 decal, 2 glass+instruments).
// Shared wetness (look.uniforms.uWet): albedo ×(1 − .15·wet), roughness −.25·wet. Day rim light,
// cloud-shadow sun scale, exhaust soot when damaged.
export function createHullMaterial(look, decalTex) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  });
  const u = {
    uWet: look.uniforms.uWet,
    uDecal: { value: decalTex },
    uInstr: { value: new THREE.Color('#3AE0C8').multiplyScalar(0.4) },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uSunScale: { value: 1 },
    uSoot: { value: 0 },
    uFill: { value: new THREE.Color(0, 0, 0) }, // night "moonlight on white paint" fill (readability)
    // Local light spill on the airframe (nav, beacon, strobes, door): xyz local pos, w radius.
    uGlowPos: { value: Array.from({ length: HULL_GLOWS }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uGlowCol: { value: Array.from({ length: HULL_GLOWS }, () => new THREE.Color(0, 0, 0)) },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSurf;
        varying vec4 vSurf;
        varying vec2 vDecalUv;
        varying vec3 vLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurf = aSurf;
        vDecalUv = uv;
        vLocal = position;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWet;
        uniform sampler2D uDecal;
        uniform vec3 uInstr;
        uniform vec3 uRim;
        uniform float uSunScale;
        uniform float uSoot;
        uniform vec3 uFill;
        uniform vec4 uGlowPos[${HULL_GLOWS}];
        uniform vec3 uGlowCol[${HULL_GLOWS}];
        varying vec4 vSurf;
        varying vec2 vDecalUv;
        varying vec3 vLocal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vSurf.w - 1.0) < 0.5) {
          vec4 dc = texture2D(uDecal, vDecalUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);
        }
        // exhaust soot streaks over the rear roof when the airframe is hurt
        float soot = uSoot * smoothstep(0.55, 1.3, vLocal.y) * smoothstep(1.6, 3.2, vLocal.z)
                   * (1.0 - smoothstep(4.0, 7.5, vLocal.z)) * (0.6 + 0.4 * sin(vLocal.x * 9.0 + vLocal.z * 2.0));
        diffuseColor.rgb *= 1.0 - 0.75 * clamp(soot, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - 0.15 * uWet;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vSurf.x - 0.25 * uWet, 0.04, 1.0);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = vSurf.y;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float hullRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += uRim * hullRim * 0.35 * (1.0 - step(1.5, vSurf.w));
        if (abs(vSurf.w - 2.0) < 0.5)
          totalEmissiveRadiance += uInstr * (0.15 + 0.85 * smoothstep(-3.7, -4.4, vLocal.z) * smoothstep(0.2, 0.75, vLocal.y));
        // light spill from the airframe's own lamps — at night the strobes and beacon paint the hull
        vec3 hullGlow = vec3(0.0);
        for (int i = 0; i < ${HULL_GLOWS}; i++) {
          vec3 gd = vLocal - uGlowPos[i].xyz;
          hullGlow += uGlowCol[i] * exp(-dot(gd, gd) / (uGlowPos[i].w * uGlowPos[i].w));
        }
        totalEmissiveRadiance += hullGlow * diffuseColor.rgb;
        // night fill: top surfaces catch a little moonlight so the silhouette reads on black water
        totalEmissiveRadiance += uFill * diffuseColor.rgb * (0.55 + 0.45 * saturate(dot(normal, normalize(vViewPosition)))) * (1.0 - step(1.5, vSurf.w));`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= vSurf.z;
        #endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= uSunScale;
        reflectedLight.directSpecular *= uSunScale;`,
      );
  };
  mat.customProgramCacheKey = () => 'mayday-heli-hull-v3';
  return mat;
}

// ------------------------------------------------------------------------------------------------
// Rotor disc (DESIGN §2.9): alpha .10 + .12·pow(.5+.5cos(N(θ−ghost)), exp) ghost blades with the
// stagecoach drift, yellow tip ring r .96–1 at α .3, crisp frozen blades when the lightning flash
// > .5 (or the rotor is slow), St. Elmo's blue crackle on the tip ring. Geometry radius = 1.
export function createRotorMaterial(look, { blades = 5, bladeHalfWidth = 0.033 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: look.uniforms.uTime,
      uGhost: { value: 0 },
      uBlade: { value: 0 },
      uSharp: { value: 0 },
      uExp: { value: 6 },
      uElmo: { value: 0 },
      uBlades: { value: blades },
      uBladeW: { value: bladeHalfWidth },
      uOpacity: { value: 1 },
      uLit: { value: 1 },
      uDiscColor: { value: new THREE.Color('#1A1D20') },
      uTipColor: { value: new THREE.Color('#F2C200') },
      uElmoColor: { value: new THREE.Color('#7FB8FF') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGhost, uBlade, uSharp, uExp, uElmo, uBlades, uBladeW, uOpacity, uLit;
      uniform vec3 uDiscColor, uTipColor, uElmoColor;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        float th = atan(vP.y, vP.x);
        float ghost = pow(0.5 + 0.5 * cos(uBlades * (th - uGhost)), uExp);
        float aG = 0.10 + 0.12 * ghost;
        float seg = 6.2831853 / uBlades;
        float d = abs(mod(th - uBlade + 0.5 * seg, seg) - 0.5 * seg) * r;
        float blade = (1.0 - smoothstep(uBladeW * 0.75, uBladeW * 1.25, d)) * smoothstep(0.07, 0.13, r);
        float a = mix(aG, 0.92 * blade, uSharp);
        a *= smoothstep(0.03, 0.11, r);
        float ring = smoothstep(0.955, 0.966, r) * (1.0 - smoothstep(0.99, 1.0, r));
        vec3 col = uDiscColor * uLit;
        float ringA = mix(0.3, blade * 0.95, uSharp);
        col = mix(col, uTipColor * uLit, ring);
        a = mix(a, max(a, ringA), ring);
        // St. Elmo's fire: blue corona crackling at 30 Hz on the tip ring
        float seg30 = floor(uTime * 30.0);
        float crack = fract(sin(seg30 * 12.9898 + floor(th * 23.0) * 78.233) * 43758.5453);
        float arc = smoothstep(0.55, 1.0, fract(sin(seg30 * 3.17 + floor(th * 7.0) * 19.1) * 9631.7));
        float band = smoothstep(0.945, 0.975, r) * (1.0 - smoothstep(0.985, 1.0, r));
        float elmo = uElmo * band * (0.25 + 0.75 * step(0.5, crack)) * (0.4 + 0.6 * arc);
        col = mix(col, uElmoColor * 1.8, min(1.0, elmo * 1.4));
        a = max(a, min(0.9, elmo * 1.2));
        gl_FragColor = vec4(col, a * uOpacity);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------------------------------------
// Lights: every emissive bulb + its view-facing halo in ONE additive draw call. Per-vertex channel
// index into uChan[] (intensity per light group, driven on the CPU: nav, beacon, strobes, door…).
export const LIGHT_CHANNELS = 10;
export function createLightsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uChan: { value: new Float32Array(LIGHT_CHANNELS) },
      uHalo: { value: 0.35 },
      uBulb: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute float aChan;
      attribute float aSize;
      attribute vec3 aColor;
      uniform float uChan[${LIGHT_CHANNELS}];
      varying vec3 vCol;
      varying vec2 vC;
      varying float vHalo;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vHalo = step(0.5, abs(aCorner.x) + abs(aCorner.y));
        if (vHalo > 0.5) {
          mv.xy += aCorner * aSize;
          mv.z += 1.5; // pull halos toward the camera so the hull never clips them
        }
        gl_Position = projectionMatrix * mv;
        vCol = aColor * uChan[int(aChan + 0.5)];
        vC = aCorner;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHalo;
      uniform float uBulb;
      varying vec3 vCol;
      varying vec2 vC;
      varying float vHalo;
      void main() {
        float r2 = dot(vC, vC);
        float a = vHalo > 0.5 ? exp(-r2 * 4.5) * (1.0 - smoothstep(0.45, 1.0, r2)) * uHalo : uBulb;
        gl_FragColor = vec4(vCol * a, 1.0);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------------------------------------
// Searchlight beam (DESIGN §2.9): open additive cone from the lamp to the water hit point.
// alpha = density·pow(|N·V|,1.5)·(1−v)^.6·noise, last 2 m fade. Geometry: apex at y = 0, end at y = −1.
export function createConeMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...look.uniforms,
      uColor: { value: new THREE.Color('#FFF1DA') },
      uDensity: { value: 0.02 },
      uIntensity: { value: 0 },
      uLen: { value: 40 },
    },
    vertexShader: /* glsl */ `
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vW;
      void main() {
        vV = clamp(-position.y, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${LOOK_GLSL_UNIFORMS}
      uniform vec3 uColor;
      uniform float uDensity, uIntensity, uLen;
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vW;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vView)));
        float n1 = texture2D(uAtlas, vW.xz * 0.045 + vec2(vW.y * 0.03, 0.0) - uWindOffset * 0.045).r;
        float n2 = texture2D(uAtlas, vW.xz * 0.12 + vec2(0.0, vW.y * 0.08 + uTime * 0.07) - uWindOffset * 0.12).r;
        float noise = 0.35 + 0.95 * n1 * (0.55 + 0.9 * n2);
        float fadeEnd = smoothstep(0.0, 2.0, (1.0 - vV) * uLen);
        float a = uDensity * pow(ndv, 1.5) * pow(1.0 - vV, 0.6) * noise * fadeEnd;
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------------------------------------
// Winch cable: camera-facing ribbon of constant screen width (≥ 1.5 px), steel with a glint that
// runs along the cable, ×3 highlights inside the searchlight cone.
export function createCableMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uResolution: look.uniforms.uResolution,
      uTime: look.uniforms.uTime,
      uPx: { value: 1.6 },
      uBase: { value: new THREE.Color('#5A636B') },
      uLit: { value: 1 },
      uBeamPos: { value: new THREE.Vector3() },
      uBeamDir: { value: new THREE.Vector3(0, -1, 0) },
      uBeamCos: { value: 0.97 },
      uBeamI: { value: 0 },
      uBeamColor: { value: new THREE.Color('#FFF1DA') },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOther;
      attribute float aSide;
      attribute float aDir;
      attribute float aV;
      uniform vec2 uResolution;
      uniform float uPx;
      varying float vV;
      varying vec3 vW;
      void main() {
        vV = aV;
        vW = position;
        vec4 c0 = projectionMatrix * viewMatrix * vec4(position, 1.0);
        vec4 c1 = projectionMatrix * viewMatrix * vec4(aOther, 1.0);
        vec2 s0 = c0.xy / c0.w * uResolution;
        vec2 s1 = c1.xy / c1.w * uResolution;
        vec2 d = s1 - s0;
        float l = length(d);
        d = l > 1e-4 ? d / l * aDir : vec2(0.0, 1.0);
        vec2 n = vec2(-d.y, d.x);
        c0.xy += n * aSide * uPx * c0.w / uResolution;
        gl_Position = c0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLit, uBeamCos, uBeamI;
      uniform vec3 uBase, uBeamPos, uBeamDir, uBeamColor;
      varying float vV;
      varying vec3 vW;
      void main() {
        vec3 col = uBase * uLit;
        float glint = pow(0.5 + 0.5 * sin(vV * 140.0 - uTime * 2.3), 18.0);
        col += vec3(0.9, 0.95, 1.0) * glint * 0.35 * uLit;
        vec3 toP = vW - uBeamPos;
        float inBeam = smoothstep(uBeamCos, mix(uBeamCos, 1.0, 0.35), dot(normalize(toP), uBeamDir)) * uBeamI;
        col += uBeamColor * inBeam * (0.45 + 1.35 * glint) * 3.0 * 0.4;
        gl_FragColor = vec4(col, 1.0);
        ${FINISH}
      }`,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------------------------------------
// Reach ring on the water: dashed circle (capture radius), pale when empty, rescue orange when a
// person is inside the capture zone. Vertices carry the angle (0..1) and inner/outer edge.
export function createRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#E8E4D8') },
      uOpacity: { value: 0 },
      uPhase: { value: 0 },
      uDashes: { value: 22 },
    },
    vertexShader: /* glsl */ `
      attribute float aAng;
      attribute float aEdge;
      varying float vAng;
      varying float vEdge;
      void main() {
        vAng = aAng;
        vEdge = aEdge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uPhase, uDashes;
      varying float vAng;
      varying float vEdge;
      void main() {
        float f = fract(vAng * uDashes - uPhase);
        float dash = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.52, 0.58, f));
        float edge = 1.0 - pow(abs(vEdge * 2.0 - 1.0), 6.0);
        gl_FragColor = vec4(uColor, uOpacity * dash * edge);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
  });
}
