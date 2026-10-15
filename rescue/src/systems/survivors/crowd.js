// The crowd: every person in the sea drawn with ONE merged person geometry, instanced (DESIGN §2.10).
//
// Draw calls: opaque bodies (MeshStandardMaterial patch: lit by sun, hemisphere, searchlight, flares),
// the underwater "ghost" pass (bodies below the surface at 18 %, SHOULD) and the keyline pass
// (inverted hull, 1 px, #05090B α .55, SHOULD — medium/high). All three share the geometry and the
// instance buffers, so the CPU writes each person once per frame.
//
// Animation lives in instance attributes (DESIGN §4 #18): the CPU decides the pose (arm elevation and
// azimuth per arm, leg fold, dissolve) and the vertex shader bends the limbs about their pivots.
//   iArms = (θL, ψL, θR, ψR)  arm direction: θ from straight down (0) to straight up (π), ψ from
//                             sideways-out (0) towards the front (π/2)
//   iPose = (legFold 0..1, child scale (unused in GLSL), 0, dissolve 0..1)
//   iLook = (skin, hood, jacket, pants) palette indices
//   iFx   = (tape lit 0..1 (searchlightAt), strobe 0..1, water height under the person, ghost light)
import * as THREE from 'three';
import { mergeParts, limb, InstanceBounds } from './geo.js';
import { PERSON_SCALE, SKIN, HOOD, JACKET, PANTS, C } from './tables.js';

const S = PERSON_SCALE;
export const SHOULDER_X = 0.205 * S;
export const SHOULDER_Y = 0.12 * S;
export const HIP_Y = -0.5 * S;
export const HEAD_Y = 0.32 * S;
export const FEET_Y = -1.33 * S; // standing people: origin = deck height − FEET_Y
export const HAND_LEN = 0.6 * S; // shoulder → hand centre

// part ids (aPart)
const TAPE_DAY = '#A9AEB1'; // retro-reflective tape albedo (silver-grey; the night flash is emissive)
const P_FIXED = 0, P_SKIN = 1, P_HOOD = 2, P_JACKET = 3, P_PANTS = 4, P_TAPE = 5, P_STROBE = 6, P_VEST = 7;
// limb ids (aLimb)
const L_BODY = 0, L_LEFT = -1, L_RIGHT = 1, L_LEGS = 2;

// ------------------------------------------------------------------------------------------------
// Geometry: built in real metres around the floating reference point (≈ 12 cm below the shoulder
// line, where the water sits on a person in an inflated vest), then scaled ×1.5 (perceptual).
export function buildPersonGeometry() {
  const parts = [];
  const add = (geometry, part, limbId, color = '#FFFFFF', extra = {}) =>
    parts.push({ geometry, color, attrs: { aPart: part, aLimb: limbId }, ...extra });

  // head + open-faced hood (opening towards +Z, the face)
  add(new THREE.IcosahedronGeometry(0.114, 1), P_SKIN, L_BODY, '#FFFFFF', { position: [0, 0.33, 0.01] });
  const open = 1.25; // face opening (rad)
  add(new THREE.SphereGeometry(0.124, 10, 7, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.72), P_HOOD, L_BODY, '#FFFFFF', {
    position: [0, 0.35, -0.01],
    scale: [1.08, 1.07, 1.12],
  });
  // inflated collar — a horseshoe behind the neck, open at the chin — + chest lobes: from above the
  // orange reads as a «U» around the head (a full ring would read as a lifebuoy)
  // a wide opening (≈100°): from above the collar must read as a «U» behind the head, never as a
  // lifebuoy «O» with the head in its hole
  const gap = 1.75; // opening at the front (rad)
  add(new THREE.TorusGeometry(0.2, 0.08, 6, 14, Math.PI * 2 - gap), P_VEST, L_BODY, C.vest, {
    position: [0, 0.165, 0.0],
    rotation: [Math.PI / 2 + 0.22, 0, Math.PI / 2 + gap / 2],
  });
  // the horseshoe's ends tuck into the chest lobes
  for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.085, 8, 6), P_VEST, L_BODY, C.vest, { position: [side * 0.115, 0.13, 0.15] });
  add(new THREE.SphereGeometry(0.115, 8, 6), P_VEST, L_BODY, C.vest, { position: [-0.105, 0.03, 0.12], scale: [1, 1.45, 0.82] });
  add(new THREE.SphereGeometry(0.115, 8, 6), P_VEST, L_BODY, C.vest, { position: [0.105, 0.03, 0.12], scale: [1, 1.45, 0.82] });
  add(new THREE.BoxGeometry(0.4, 0.3, 0.16), P_VEST, L_BODY, C.vest, { position: [0, -0.02, -0.07] }); // back panel
  // two retro-reflective bands across the collar over the shoulders (DESIGN §2.10)
  for (const side of [-1, 1]) {
    const band = new THREE.TorusGeometry(0.2, 0.0835, 6, 4, 0.36);
    // the arc starts at +X and runs towards +Y; centre it, then move it along the ring to ±62° from the
    // front (after the collar's lay-flat rotation the ring angle is measured from +X towards +Z)
    band.rotateZ(-0.18);
    // by day SOLAS tape is a dull silver-grey (it only flashes white in the searchlight: uTape below)
    add(band, P_TAPE, L_BODY, TAPE_DAY, { position: [0, 0.165, 0], rotation: [Math.PI / 2 + 0.22, 0, Math.PI / 2 - side * 1.32] });
  }
  // personal strobe on the left shoulder of the collar
  add(new THREE.CylinderGeometry(0.026, 0.03, 0.06, 8), P_FIXED, L_BODY, '#2A2E30', { position: [-0.16, 0.235, -0.07] });
  add(new THREE.SphereGeometry(0.028, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), P_STROBE, L_BODY, '#DDE6EE', { position: [-0.16, 0.265, -0.07] });
  // torso, hips (jacket), legs (trousers)
  add(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8), P_JACKET, L_BODY, '#FFFFFF', { position: [0, -0.2, 0], scale: [1.22, 1, 0.82] });
  add(new THREE.SphereGeometry(0.15, 8, 6), P_PANTS, L_BODY, '#FFFFFF', { position: [0, -0.47, 0], scale: [1.15, 0.8, 0.85] });
  for (const x of [-0.085, 0.085]) {
    add(limb([x, -0.52, 0], [x * 1.1, -1.27, 0.02], 0.072, 6), P_PANTS, L_LEGS);
    add(new THREE.SphereGeometry(0.06, 6, 4), P_FIXED, L_LEGS, '#15181A', { position: [x * 1.1, -1.3, 0.06], scale: [1, 0.7, 1.6] }); // boots
  }
  // arms hanging from the shoulder pivots (rest pose = straight down)
  for (const side of [-1, 1]) {
    const lim = side < 0 ? L_LEFT : L_RIGHT;
    const x = side * 0.205;
    add(limb([x, 0.12, 0], [x, -0.42, 0], 0.06, 6), P_JACKET, lim);
    add(new THREE.SphereGeometry(0.055, 6, 5), P_SKIN, lim, '#FFFFFF', { position: [x, -0.48, 0] });
  }
  for (const p of parts) p.scale = typeof p.scale === 'number' ? p.scale * S : p.scale ? p.scale.map((v) => v * S) : S;
  for (const p of parts) if (p.position) p.position = p.position.map((v) => v * S);
  const g = mergeParts(parts, { aPart: 1, aLimb: 1 });
  return g;
}

// ------------------------------------------------------------------------------------------------
// GLSL shared by the three passes: pose the limbs in object space.
const POSE_GLSL = /* glsl */ `
attribute float aPart;
attribute float aLimb;
attribute vec4 iArms;
attribute vec4 iPose;
attribute vec4 iLook;
attribute vec4 iFx;
// Rotation that takes (0, −1, 0) — the rest direction of an arm — to the unit vector d (Rodrigues).
vec3 svRot(vec3 v, vec3 d) {
  float c = -d.y;
  vec3 k = vec3(-d.z, 0.0, d.x);
  float s = length(k);
  if (s < 1e-4) return c > 0.0 ? v : vec3(-v.x, -v.y, v.z);
  k /= s;
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
vec3 svArmDir(float th, float ps, float side) {
  float st = sin(th);
  return vec3(side * st * cos(ps), -cos(th), st * sin(ps));
}
vec3 svPose(vec3 p, inout vec3 n) {
  if (aLimb < -0.5 || (aLimb > 0.5 && aLimb < 1.5)) {
    float side = aLimb < 0.0 ? -1.0 : 1.0;
    vec3 piv = vec3(side * ${SHOULDER_X.toFixed(4)}, ${SHOULDER_Y.toFixed(4)}, 0.0);
    vec3 d = side < 0.0 ? svArmDir(iArms.x, iArms.y, -1.0) : svArmDir(iArms.z, iArms.w, 1.0);
    p = piv + svRot(p - piv, d);
    n = svRot(n, d);
  } else if (aLimb > 1.5) {
    // legs fold forward at the hip and shorten (sitting on a keel, crouching in the basket)
    float f = iPose.x;
    vec3 piv = vec3(0.0, ${HIP_Y.toFixed(4)}, 0.0);
    vec3 q = p - piv;
    q.y *= mix(1.0, 0.6, f);
    float a = f * 1.45;
    float c = cos(a), s = sin(a);
    q = vec3(q.x, c * q.y + s * q.z, -s * q.y + c * q.z);
    n = vec3(n.x, c * n.y + s * n.z, -s * n.y + c * n.z);
    p = piv + q;
  }
  return p;
}
float svHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
`;

// ------------------------------------------------------------------------------------------------
// Opaque bodies: MeshStandardMaterial so the scene's lights (sun shadow, hemisphere, the heli
// searchlight SpotLight, pooled flare PointLights) light people like everything else.
export function createPersonMaterial(look) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const u = {
    uSkin: { value: SKIN.map((c) => new THREE.Color(c)) },
    uHood: { value: HOOD.map((c) => new THREE.Color(c)) },
    uJacket: { value: JACKET.map((c) => new THREE.Color(c)) },
    uPants: { value: PANTS.map((c) => new THREE.Color(c)) },
    uTape: { value: new THREE.Color(C.tape) },
    uWet: look.uniforms.uWet,
    uStrobeGain: { value: 30 },
    uRim: { value: new THREE.Color(0, 0, 0) }, // day rim light (DESIGN §2.7.3 «ободок»), CPU: sky × .35
    uVestGlow: { value: 0.035 }, // the vest's own read: more in dim daylight (squall, overcast)
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${POSE_GLSL}
        uniform vec3 uSkin[${SKIN.length}];
        uniform vec3 uHood[${HOOD.length}];
        uniform vec3 uJacket[${JACKET.length}];
        uniform vec3 uPants[${PANTS.length}];
        varying float vSvPart;
        varying vec4 vSvFx;
        varying float vSvDis;
        varying vec3 vSvW;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        {
          int svp = int(aPart + 0.5);
          if (svp == 1) vColor.rgb *= uSkin[int(iLook.x + 0.5)];
          else if (svp == 2) vColor.rgb *= uHood[int(iLook.y + 0.5)];
          else if (svp == 3) vColor.rgb *= uJacket[int(iLook.z + 0.5)];
          else if (svp == 4) vColor.rgb *= uPants[int(iLook.w + 0.5)];
        }
        vSvPart = aPart;
        vSvFx = iFx;
        vSvDis = iPose.w;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vec3 svP = svPose(position, objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = svP;
        vSvW = (modelMatrix * instanceMatrix * vec4(svP, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uTape;
        uniform float uWet;
        uniform float uStrobeGain;
        uniform vec3 uRim;
        uniform float uVestGlow;
        varying float vSvPart;
        varying vec4 vSvFx;
        varying float vSvDis;
        varying vec3 vSvW;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vSvDis > 0.001) {
          // dissolve into the wave: stable world-space dither, lower parts first
          float h = fract(sin(dot(floor(vSvW * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (h < vSvDis * 1.25 - 0.1 - 0.08 * (vSvW.y - vSvFx.z)) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - 0.15 * uWet;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (abs(vSvPart - 5.0) < 0.5) roughnessFactor = 0.35;
        else if (abs(vSvPart - 7.0) < 0.5) roughnessFactor = 0.55;
        roughnessFactor = clamp(roughnessFactor - 0.25 * uWet, 0.08, 1.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // retro-reflective tape: #E9F2FF × 6 × searchlightAt (flashes the instant the beam touches)
        if (abs(vSvPart - 5.0) < 0.5) totalEmissiveRadiance += uTape * 4.0 * vSvFx.x;
        // personal strobe: 60 ms flash
        if (abs(vSvPart - 6.0) < 0.5) totalEmissiveRadiance += vec3(uStrobeGain) * vSvFx.y + vec3(0.04);
        // skin: a breath of warmth (DESIGN §2.7.3: кожа — emissive ×0.08)
        if (abs(vSvPart - 1.0) < 0.5) totalEmissiveRadiance += diffuseColor.rgb * 0.08;
        // the vest's fluorescent orange holds a little light of its own (readability at dusk, in squalls)
        if (abs(vSvPart - 7.0) < 0.5) totalEmissiveRadiance += diffuseColor.rgb * uVestGlow;
        // day rim: the sky catching the silhouette, so people separate from the water
        totalEmissiveRadiance += uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// hue protection (#FF5A00 stays orange): ACES' toe and output matrix crush the vest's small green
        // channel below ~1.0 scene-linear and the orange slides to blood-red in storm / dusk light. The
        // G/R that lands on ≈ 21° after ACES is ≈ 0.095 − 0.076·ln R (fitted for R 0.01…2)
        if (abs(vSvPart - 7.0) < 0.5) outgoingLight.g = max(outgoingLight.g, outgoingLight.r * clamp(0.115 - 0.076 * log(max(outgoingLight.r, 1e-4)), 0.0, 0.5));
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'survivors-person-v2';
  return mat;
}

// Underwater bodies (SHOULD): what is below the surface shows through at 18 %, tinted by the water.
// The vertices are pulled towards the camera along their view ray by their depth under the water, so
// the opaque sea in front no longer hides them — the projection (screen position) does not change.
export function createGhostMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uSkin: { value: SKIN.map((c) => new THREE.Color(c)) },
      uHood: { value: HOOD.map((c) => new THREE.Color(c)) },
      uJacket: { value: JACKET.map((c) => new THREE.Color(c)) },
      uPants: { value: PANTS.map((c) => new THREE.Color(c)) },
      uLight: { value: new THREE.Color(0.5, 0.55, 0.6) }, // ambient light under the surface (CPU)
      uWater: { value: new THREE.Color('#17586A') }, // water body colour (palette.body)
      uAlpha: { value: 0.18 },
    },
    vertexShader: /* glsl */ `
      ${POSE_GLSL}
      #include <fog_pars_vertex>
      uniform vec3 uSkin[${SKIN.length}];
      uniform vec3 uHood[${HOOD.length}];
      uniform vec3 uJacket[${JACKET.length}];
      uniform vec3 uPants[${PANTS.length}];
      attribute vec3 color;
      varying vec3 vCol;
      varying vec3 vW;
      varying vec4 vFx;
      varying float vDis;
      varying float vUp;
      void main() {
        vec3 n = normal;
        vec3 p = svPose(position, n);
        vec3 col = color;
        int svp = int(aPart + 0.5);
        if (svp == 1) col *= uSkin[int(iLook.x + 0.5)];
        else if (svp == 2) col *= uHood[int(iLook.y + 0.5)];
        else if (svp == 3) col *= uJacket[int(iLook.z + 0.5)];
        else if (svp == 4) col *= uPants[int(iLook.w + 0.5)];
        vCol = col;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        vFx = iFx;
        vDis = iPose.w;
        vUp = normalize(mat3(instanceMatrix) * n).y;
        vec4 mvPosition = viewMatrix * wp;
        float below = clamp(iFx.z - wp.y, 0.0, 4.0);
        mvPosition.xyz += normalize(-mvPosition.xyz) * (below + 0.45);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uLight;
      uniform vec3 uWater;
      uniform float uAlpha;
      varying vec3 vCol;
      varying vec3 vW;
      varying vec4 vFx;
      varying float vDis;
      varying float vUp;
      void main() {
        float below = vFx.z - vW.y;
        if (below < 0.04) discard;
        if (vDis > 0.001) {
          float h = fract(sin(dot(floor(vW * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (h < vDis * 1.25) discard;
        }
        float fade = exp(-below / 1.6);
        vec3 lit = vCol * (uLight * (0.55 + 0.45 * max(vUp, 0.0)) + vec3(vFx.w));
        vec3 col = mix(lit, uWater * (uLight + vec3(vFx.w * 0.5)), 0.45 + 0.35 * (1.0 - fade));
        gl_FragColor = vec4(col, uAlpha * (0.35 + 0.65 * fade) * (1.0 - vDis));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

// Keyline (SHOULD): inverted hull of constant screen thickness, posed like the body.
export function createKeylineMaterial(look, { color = '#05090B', opacity = 0.55, px = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uPx: { value: px },
      uResolution: look.uniforms.uResolution,
    },
    vertexShader: /* glsl */ `
      ${POSE_GLSL}
      uniform float uPx;
      uniform vec2 uResolution;
      varying vec3 vW;
      varying float vDis;
      varying float vWater;
      void main() {
        vec3 n = normal;
        vec3 p = svPose(position, n);
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        vDis = iPose.w;
        vWater = iFx.z;
        vec4 clip = projectionMatrix * viewMatrix * wp;
        vec3 nv = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * n);
        vec2 nc = (projectionMatrix * vec4(nv, 0.0)).xy;
        float l = length(nc);
        if (l > 1e-5) clip.xy += (nc / l) * uPx * 2.0 * clip.w / uResolution;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vW;
      varying float vDis;
      varying float vWater;
      void main() {
        if (vW.y < vWater - 0.05) discard;
        if (vDis > 0.001) {
          float h = fract(sin(dot(floor(vW * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (h < vDis * 1.25) discard;
        }
        gl_FragColor = vec4(uColor, uOpacity * (1.0 - vDis));
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

// ------------------------------------------------------------------------------------------------
// Instanced crowd: begin() → push() per visible person → end().
const _m = new THREE.Matrix4();
export class Crowd {
  constructor(look, max = 192) {
    this.max = max;
    const g = buildPersonGeometry();
    this.geometry = g;
    const mk = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aArms = mk('iArms', 4);
    this.aPose = mk('iPose', 4);
    this.aLook = mk('iLook', 4);
    this.aFx = mk('iFx', 4);
    this.attrs = [this.aArms, this.aPose, this.aLook, this.aFx];

    this.material = createPersonMaterial(look);
    this.mesh = new THREE.InstancedMesh(g, this.material, max);
    this.mesh.name = 'survivors.people';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;

    this.ghostMaterial = createGhostMaterial(look);
    this.ghost = new THREE.InstancedMesh(g, this.ghostMaterial, max);
    this.ghost.name = 'survivors.underwater';
    this.ghost.instanceMatrix = this.mesh.instanceMatrix;
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 12; // after the ocean (10)
    this.ghost.count = 0;

    // keylines only on PEOPLE, only at night, faint (≤ 0.3): they help find a body in storm foam; by
    // day the rim light and contact foam do it (one realistic style, no ink outlines)
    this.keylineMaterial = createKeylineMaterial(look, { opacity: 0.28 });
    this.keylineOn = false; // survivors sets it from the night factor
    this.keyline = new THREE.InstancedMesh(g, this.keylineMaterial, max);
    this.keyline.name = 'survivors.keyline';
    this.keyline.instanceMatrix = this.mesh.instanceMatrix;
    this.keyline.frustumCulled = false;
    this.keyline.renderOrder = 13;
    this.keyline.count = 0;

    this.n = 0;
    this.extras = true;
    this.bounds = new InstanceBounds(g, 2.5); // arms / legs are posed on the GPU
  }

  setQuality(q) {
    this.extras = q !== 'low'; // underwater bodies + keylines from medium up (DESIGN §8.2)
  }

  begin() {
    this.n = 0;
    this.bounds.reset();
  }

  // m: Matrix4 world transform; arms [θL, ψL, θR, ψR]; look/fx arrays of 4.
  push(m, aL, pL, aR, pR, legFold, dissolve, skin, hood, jacket, pants, tape, strobe, waterY, ghostLight) {
    if (this.n >= this.max || this.bounds.culled(m)) return -1; // people cast no shadows: cull per instance
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    this.bounds.add(m);
    const j = i * 4;
    let a = this.aArms.array;
    a[j] = aL; a[j + 1] = pL; a[j + 2] = aR; a[j + 3] = pR;
    a = this.aPose.array;
    a[j] = legFold; a[j + 1] = 1; a[j + 2] = 0; a[j + 3] = dissolve;
    a = this.aLook.array;
    a[j] = skin; a[j + 1] = hood; a[j + 2] = jacket; a[j + 3] = pants;
    a = this.aFx.array;
    a[j] = tape; a[j + 1] = strobe; a[j + 2] = waterY; a[j + 3] = ghostLight;
    return i;
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    this.ghost.count = n;
    this.keyline.count = n;
    this.mesh.visible = n > 0;
    this.ghost.visible = n > 0 && this.extras;
    this.keyline.visible = this.ghost.visible && this.keylineOn;
    if (!n) return;
    this.bounds.apply(this.mesh, this.ghost, this.keyline);
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.ghostMaterial.dispose();
    this.keylineMaterial.dispose();
  }
}

export { _m as _crowdScratch };
