// Materials for «Чайка-07» (DESIGN §2.7.3, §2.9). All custom shaders end with the tonemapping /
// colorspace chunks, so they look right both through the post composer (linear HalfFloat target) and
// when rendering straight to the canvas.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { patchWeathering } from '../../core/weathering.js';

const FINISH = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export const HULL_GLOWS = 8;

// ------------------------------------------------------------------------------------------------
// Hull: ONE MeshPhysicalMaterial for the whole merged airframe. Per-vertex `aSurf`
// (x roughness, y metalness, z clearcoat weight, w flags: 0 paint/metal, 1 decal, 2 glass+instruments).
// Realism pass: satin paint (roughness .35–.5 + breakup, light clearcoat) and an airframe that has
// flown: panel lines (frames every 1.05 m, stringers, door and cowling seams, AA-faded when sub-pixel),
// exhaust soot from both outlets back over the boom roof (always ~30 %, uSoot rises with damage), oil /
// hydraulic streaks on the belly under the transmission deck, salt haze on the lower 30 % (+8 % value,
// −10 % saturation), plus the shared core/weathering.js breakup in the airframe's LOCAL frame (world
// space would make the grime slide over a moving aircraft). Glass is exempt. Day rim light, cloud-shadow
// sun scale, night fill and lamp spill as before.
export function createHullMaterial(look, decalTex) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.45,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.22,
  });
  const u = {
    uWet: look.uniforms.uWet,
    uDecal: { value: decalTex },
    uInstr: { value: new THREE.Color('#3AE0C8').multiplyScalar(0.4) },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uSunScale: { value: 1 },
    uSoot: { value: 0.3 },
    uHAtlas: look.uniforms.uAtlas,
    uFill: { value: new THREE.Color(0, 0, 0) }, // night "moonlight on white paint" fill (readability)
    // Local light spill on the airframe (nav, beacon, strobes, door): xyz local pos, w radius.
    uGlowPos: { value: Array.from({ length: HULL_GLOWS }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uGlowCol: { value: Array.from({ length: HULL_GLOWS }, () => new THREE.Color(0, 0, 0)) },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    // Shared weathering FIRST, so the hull's own roughness/colour code lands before its chunk (both
    // hook '#include <roughnessmap_fragment>'), then pulled into the airframe's local frame.
    mat.userData.weathering = patchWeathering(sh, look, {
      breakup: 0.07, streaks: 0.14, grime: 0, waterline: 0, roughBreakup: 0.12, deckWear: 0.18,
      scale: 2.2, seaLevel: -50, streakColor: '#5C544C',
    });
    sh.vertexShader = sh.vertexShader.replace('wxp = modelMatrix * wxp;', '').replace('mat3( modelMatrix ) * wxn', 'wxn');
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSurf;
        varying vec4 vSurf;
        varying vec2 vDecalUv;
        varying vec3 vLocal;
        varying vec3 vLN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurf = aSurf;
        vDecalUv = uv;
        vLocal = position;
        vLN = normal;`,
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
        uniform sampler2D uHAtlas;
        varying vec4 vSurf;
        varying vec2 vDecalUv;
        varying vec3 vLocal;
        varying vec3 vLN;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vSurf.w - 1.0) < 0.5) {
          vec4 dc = texture2D(uDecal, vDecalUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);
        }
        float hNotGlass = 1.0 - step(1.5, vSurf.w);
        float hPaint = step(0.9, vSurf.z) * (1.0 - step(0.5, vSurf.w)); // clearcoated paint, no decal/glass
        vec3 hp = vLocal;
        vec3 hn = normalize(vLN);
        // panel lines: frames along the lathe, stringers, door edges, engine-cowling seams
        float dl = abs(fract(hp.z / 1.05 + 0.37) - 0.5) * 1.05;
        if (abs(hp.x) > 0.55 && hp.z < 3.6) dl = min(dl, min(abs(hp.y - 0.62), abs(hp.y + 0.48)));
        if (abs(hp.x) > 0.5 && hp.z > -2.1 && hp.z < -0.5) dl = min(dl, min(abs(hp.y + 0.67), abs(hp.y - 0.87)));
        if (hp.y > 1.08 && hp.z > -1.3 && hp.z < 2.7) dl = min(dl, abs(abs(hp.x) - 0.45));
        float dfw = max(fwidth(dl), 1e-4);
        float pline = clamp((0.011 - dl) / dfw + 0.5, 0.0, 1.0) * min(1.0, 0.022 / dfw);
        diffuseColor.rgb *= 1.0 - 0.34 * pline * hPaint;
        // salt haze on the lower 30 % of the airframe: +8 % value, −10 % saturation, patchy
        float saltM = (1.0 - smoothstep(-0.6, -0.15, hp.y)) * (0.55 + 0.45 * texture2D(uHAtlas, hp.xz * 0.35 + hp.y * 0.2).g) * hNotGlass;
        float hLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(hLum), 0.10 * saltM) * (1.0 + 0.08 * saltM);
        // oil / hydraulic streaks on the belly under the transmission deck, run back by the airflow
        float oilN = texture2D(uHAtlas, vec2(hp.x * 1.7 + 0.3, hp.z * 0.11 + 0.5)).r;
        float oil = smoothstep(-0.15, -0.7, hn.y) * smoothstep(-1.9, -0.9, hp.z) * (1.0 - smoothstep(2.4, 4.4, hp.z)) * smoothstep(0.42, 0.72, oilN);
        float runN = texture2D(uHAtlas, vec2(hp.z * 2.6, hp.y * 0.18 + 0.2)).r;
        oil += (1.0 - abs(hn.y)) * smoothstep(1.2, 1.8, hp.z) * (1.0 - smoothstep(2.6, 3.6, hp.z)) * smoothstep(1.0, 0.3, hp.y) * smoothstep(0.5, 0.75, runN) * 0.7;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.032), clamp(oil, 0.0, 1.0) * 0.5 * hNotGlass);
        // exhaust soot: two plumes from the outlets (x ±.86, z 2.7) back over the boom roof and upper sides
        float dzx = max(hp.z - 2.6, 0.0);
        float plume = exp(-pow((abs(hp.x) - max(0.86 - 0.16 * dzx, 0.1)) / (0.22 + 0.09 * dzx), 2.0))
                    * smoothstep(2.2, 2.75, hp.z) * exp(-dzx / 3.4) * smoothstep(-0.15, 0.55, hn.y);
        float sootN = texture2D(uHAtlas, vec2(hp.x * 2.3, hp.z * 0.2)).r;
        float soot = uSoot * plume * (0.4 + 1.0 * sootN);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.026), clamp(soot * 0.9, 0.0, 0.92) * hNotGlass);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vSurf.x - 0.1 * uWet + 0.12 * pline - 0.12 * oil + 0.2 * soot, 0.04, 1.0);
        vec3 hKeepC = diffuseColor.rgb;
        float hKeepR = roughnessFactor;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = vSurf.y;
        if (vSurf.w > 1.5) { diffuseColor.rgb = hKeepC; roughnessFactor = hKeepR; } // glass stays clean`,
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
  mat.customProgramCacheKey = () => 'mayday-heli-hull-v4|wx';
  return mat;
}

// ------------------------------------------------------------------------------------------------
// Rotor disc (DESIGN §2.9, realism pass): a LIT translucent veil, not a flat tint. The time-averaged
// blades are a dark semi-gloss surface lit like the hull (sun·N·L + ambient, /π as in three's BRDF)
// plus a sky sheen, so by day the disc shows as a soft grey veil and at night it only appears when
// the strobes / beacon / lightning catch it. Structure: concentric motion-blur streaks (noise
// smeared along θ), 5 faint ghost blades drifting with the stagecoach alias, and the per-frame
// "shutter" sweep of each blade (uArc rad trailing uBlade) — the tip paint shows only inside those
// 5 smears (α ≤ .12, soft band), so it shimmers instead of drawing a constant HUD-like circle, and
// it fades out with camera distance (uTipFade). Crisp frozen blades with yellow tips only when the
// lightning flash > .5 (or the rotor is slow). St. Elmo's blue crackle on the tips. Geometry r = 1.
// hull: (half-width of the cabin, half-width of the boom, nose, boom start) in disc units — the
// blur fades to 40 % over the fuselage so the disc never greys the hull (DESIGN §2.1 pillar 8).
// light: shared uniform objects { uSunDir, uSunCol, uAmbCol, uSkyCol, uGlow, uGlowB, uGlowS } (heli.js
// feeds them): uGlow = broad bounce (searchlight pool, lightning) over the whole veil; uGlowB / uGlowS =
// beacon / strobes, which light only the part of the veil near the lamp (glowB / glowS: disc-local
// x, y and falloff radius, disc units) — a strobe flash catches the rear of the disc, never the whole
// disc as one evenly lit plate.
export function createRotorMaterial(look, { blades = 5, bladeHalfWidth = 0.033, hull = null, light = null, inner = 0.12, glowB = [0, 0, 0], glowS = [0, 0, 8] } = {}) {
  const L = light || {
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmbCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uSkyCol: { value: new THREE.Color(0.3, 0.35, 0.4) },
    uGlow: { value: new THREE.Color(0, 0, 0) },
    uGlowB: { value: new THREE.Color(0, 0, 0) },
    uGlowS: { value: new THREE.Color(0, 0, 0) },
  };
  return new THREE.ShaderMaterial({
    uniforms: {
      ...L,
      uHull: { value: hull ? new THREE.Vector4(...hull) : new THREE.Vector4(0, 0, 0, 0) },
      uTime: look.uniforms.uTime,
      uAtlas: look.uniforms.uAtlas,
      uGhost: { value: 0 },
      uBlade: { value: 0 },
      uSharp: { value: 0 },
      uExp: { value: 6 },
      uElmo: { value: 0 },
      uBlades: { value: blades },
      uBladeW: { value: bladeHalfWidth },
      uOpacity: { value: 1 },
      uLit: { value: 1 },
      uArc: { value: 0.45 },
      uTipFade: { value: 1 },
      uInner: { value: inner },
      uGlowBAt: { value: new THREE.Vector3(...glowB) },
      uGlowSAt: { value: new THREE.Vector3(...glowS) },
      uDiscColor: { value: new THREE.Color('#585E64') }, // worn blade tops seen in motion blur
      uTipColor: { value: new THREE.Color('#D2AE2A') },
      uElmoColor: { value: new THREE.Color('#7FB8FF') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vP = position.xy;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGhost, uBlade, uSharp, uExp, uElmo, uBlades, uBladeW, uOpacity, uLit, uArc, uTipFade, uInner;
      uniform vec3 uDiscColor, uTipColor, uElmoColor, uSunDir, uSunCol, uAmbCol, uSkyCol, uGlow, uGlowB, uGlowS, uGlowBAt, uGlowSAt;
      uniform vec4 uHull;
      uniform sampler2D uAtlas;
      varying vec2 vP;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        float th = atan(vP.y, vP.x);
        vec2 cs = vP / max(r, 1e-4);
        float seg = 6.2831853 / uBlades;
        // --- light: same convention as the hull (irradiance / π), camera-facing side -----------------
        vec3 V = normalize(vView);
        vec3 N = normalize(vN);
        N = dot(N, V) < 0.0 ? -N : N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float ndl = max(dot(N, normalize(uSunDir)), 0.0);
        vec2 gdB = vP - uGlowBAt.xy;
        vec2 gdS = vec2(abs(vP.x) - uGlowSAt.x, vP.y - uGlowSAt.y);
        vec3 irr = (uSunCol * ndl + uAmbCol) * 0.3183 * uLit + uGlow
                 + uGlowB / (1.0 + dot(gdB, gdB) / max(uGlowBAt.z * uGlowBAt.z, 1e-4))
                 + uGlowS / (1.0 + dot(gdS, gdS) / max(uGlowSAt.z * uGlowSAt.z, 1e-4));
        vec3 H = normalize(normalize(uSunDir) + V);
        float sheen = pow(max(dot(N, H), 0.0), 6.0);
        float F = 0.1 + 0.9 * pow(1.0 - ndv, 5.0); // semi-gloss, twisted blades: never a perfect mirror angle
        // --- motion blur: noise smeared along θ → fine concentric streaks ------------------------------
        float s1 = texture2D(uAtlas, vec2(r * 2.3, 0.17) + 0.03 * cs).r;
        float s2 = texture2D(uAtlas, vec2(r * 5.5, 0.61) + 0.05 * cs).r;
        float streak = clamp(0.5 + (s1 - 0.5) * 1.3 + (s2 - 0.5) * 0.6, 0.0, 1.0);
        float ghost = pow(0.5 + 0.5 * cos(uBlades * (th - uGhost)), uExp);
        // per-frame shutter sweep of each blade (trails the blade, which moves toward +θ)
        float rel = mod(uBlade - th, seg);
        float sweep = (1.0 - smoothstep(0.0, uArc, rel)) * (1.0 - 0.45 * rel / max(uArc, 1e-3));
        float aG = mix(0.17, 0.25, smoothstep(0.2, 0.95, r)) * (0.86 + 0.28 * streak) + 0.05 * ghost + 0.03 * sweep;
        if (uHull.x > 0.0) {
          // disc-local +y = nose. Cabin (wide) → tail boom (narrow) → beyond the nose: open disc.
          float hw = mix(uHull.y, uHull.x, smoothstep(uHull.w - 0.12, uHull.w + 0.08, vP.y));
          float hullM = (1.0 - smoothstep(hw, hw + 0.06, abs(vP.x))) * (1.0 - smoothstep(uHull.z - 0.06, uHull.z + 0.04, vP.y));
          aG *= 1.0 - 0.6 * hullM;
        }
        // crisp frozen blades (lightning frame / slow rotor)
        float d = abs(mod(th - uBlade + 0.5 * seg, seg) - 0.5 * seg) * r;
        float blade = (1.0 - smoothstep(uBladeW * 0.75, uBladeW * 1.25, d)) * smoothstep(0.07, 0.13, r);
        float a = mix(aG, 0.92 * blade, uSharp);
        a *= smoothstep(uInner, uInner + 0.06, r) * (1.0 - smoothstep(0.93, 1.0, r) * (1.0 - 0.9 * uSharp));
        vec3 alb = uDiscColor;
        vec3 col = alb * irr + uSkyCol * F * (0.8 + 0.3 * streak) + uSunCol * sheen * 0.012 * (1.0 - uSharp);
        // tip paint: soft band, visible only inside the 5 shutter smears; crisp on frozen blades
        float band = smoothstep(0.915, 0.97, r) * (1.0 - smoothstep(0.982, 1.0, r));
        float tipA = band * (0.012 + 0.078 * sweep) * uTipFade;
        float tipCrisp = blade * smoothstep(0.925, 0.94, r);
        tipA = mix(tipA, 0.95 * tipCrisp, uSharp);
        vec3 tipCol = uTipColor * irr + uSkyCol * F * 0.5;
        float aT = tipA + a * (1.0 - tipA);
        col = (tipCol * tipA + col * a * (1.0 - tipA)) / max(aT, 1e-4);
        a = aT;
        // St. Elmo's fire: blue corona crackling at 30 Hz on the tip path
        float seg30 = floor(uTime * 30.0);
        float crack = fract(sin(seg30 * 12.9898 + floor(th * 23.0) * 78.233) * 43758.5453);
        float arc = smoothstep(0.55, 1.0, fract(sin(seg30 * 3.17 + floor(th * 7.0) * 19.1) * 9631.7));
        float eband = smoothstep(0.93, 0.97, r) * (1.0 - smoothstep(0.985, 1.0, r));
        float elmo = uElmo * eband * (0.25 + 0.75 * step(0.5, crack)) * (0.4 + 0.6 * arc);
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
// Searchlight beam (DESIGN §2.9, realism pass): single-scattering light shaft. The cone mesh is only
// a proxy (FRONT faces, so nothing stacks when it is seen down its axis); each fragment intersects
// the view ray with the analytic cone (apex uApex, axis uAxis, cos² uCos2), clips it at the water
// end and integrates the in-scatter along the chord with 6 jittered samples, sampled uniformly in
// asinh space (integrand ∝ 1/d from the lamp: the shaft stays a shaft along its length instead of a
// lamp-only glow), × the beam's angular profile (soft penumbra, no hard wall), × drifting mist noise
// (the shaft reads volumetric), × a Henyey-Greenstein phase (rain/fog scatter forward, so looking
// straight down the beam — back-scatter — it fades instead of forming a bright disc), × a fade over
// the last 3.5 m so no end cap ever forms over the pool. Rain streak sparkle in the beam is fx/rain.
export function createConeMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...look.uniforms,
      uColor: { value: new THREE.Color('#FFF1DA') },
      uDensity: { value: 0.02 },
      uIntensity: { value: 0 },
      uLen: { value: 40 },
      uApex: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uCos2: { value: 0.9 },
      uTanA: { value: 0.27 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${LOOK_GLSL_UNIFORMS}
      uniform vec3 uColor, uApex, uAxis;
      uniform float uDensity, uIntensity, uLen, uCos2, uTanA;
      varying vec3 vW;
      float asinh_(float x) { return log(x + sqrt(x * x + 1.0)); }
      float sinh_(float x) { float e = exp(x); return 0.5 * (e - 1.0 / e); }
      void main() {
        vec3 R = normalize(vW - cameraPosition);
        vec3 CO = cameraPosition - uApex;
        float rd = dot(R, uAxis);
        float cd = dot(CO, uAxis);
        float tA = length(vW - cameraPosition);
        // exit: solve the cone quadric from the entry fragment itself (P0 on the wall, s = 0 is the
        // entry root), not from the camera — small numbers, no float32 cancellation; the far root on
        // the lower nappe is the side exit, else the beam leaves through the water end.
        vec3 P0 = vW - uApex;
        float c0 = dot(P0, uAxis);
        float qa = rd * rd - uCos2;
        float qb = 2.0 * (rd * c0 - uCos2 * dot(R, P0));
        float qc = c0 * c0 - uCos2 * dot(P0, P0);
        float disc = qb * qb - 4.0 * qa * qc;
        float sB = 1e6;
        if (disc > 0.0 && abs(qa) > 1e-6) {
          float sq = sqrt(disc);
          float sF = max((-qb - sq) / (2.0 * qa), (-qb + sq) / (2.0 * qa));
          if (sF > 0.05 && c0 + sF * rd > 0.0) sB = sF;
        }
        if (rd > 1e-4) {
          float sp = (uLen - c0) / rd;
          if (sp > 0.0) sB = min(sB, sp);
        }
        if (sB > 1e5) discard;
        float tB = tA + sB;
        // equi-asinh sampling of ∫ f(t)/d(t) dt (d = distance to the lamp)
        float t0 = -dot(CO, R);
        // the lamp is a 0.5 m reflector seen through its own glare, not a point: soften 1/d by ~1.6 m so
        // the first metres of the shaft never go white-hot (that blooms over half the frame from the side)
        float h = sqrt(max(dot(CO, CO) - t0 * t0, 0.0) + 2.5);
        float ua = asinh_((tA - t0) / h);
        float ub = asinh_((tB - t0) / h);
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float sum = 0.0;
        for (int i = 0; i < 6; i++) {
          float u = mix(ua, ub, (float(i) + jit) / 6.0);
          float t = t0 + h * sinh_(u);
          vec3 P = CO + t * R;                 // relative to the lamp
          float along = max(dot(P, uAxis), 1e-3);
          float rad = length(P - along * uAxis);
          float ratio = rad / (along * uTanA);
          float prof = 1.0 - smoothstep(0.35, 1.0, ratio);
          prof *= prof;
          vec3 Pw = uApex + P;
          float n = texture2D(uAtlas, Pw.xz * 0.05 + Pw.y * vec2(0.021, 0.034) - uWindOffset * 0.05 + vec2(0.0, uTime * 0.012)).r;
          float fade = smoothstep(0.0, 3.5, uLen - along) * smoothstep(0.4, 3.0, along);
          sum += prof * fade * (0.3 + 1.4 * n * n);
        }
        sum *= (ub - ua) / 6.0;
        // Henyey-Greenstein (g = .45), normalised to 1 at 90°: forward scatter bright, back dim
        float cosS = -rd;
        float g = 0.45;
        float hg = pow((1.0 + g * g) / (1.0 + g * g - 2.0 * g * cosS), 1.5);
        float n2 = texture2D(uAtlas, vW.xz * 0.11 + vec2(0.0, uTime * 0.06) - uWindOffset * 0.11).r;
        // seen straight down the beam the whole column stacks into one pixel: keep only a faint core
        float axisFade = 1.0 - 0.7 * smoothstep(0.75, 0.97, abs(rd));
        float a = uDensity * sum * hg * axisFade * (0.8 + 0.4 * n2) * 6.0;
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        ${FINISH}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
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
