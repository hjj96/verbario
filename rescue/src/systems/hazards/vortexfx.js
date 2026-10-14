// Vortex visuals (DESIGN §2.12 «Смерч», «Торнадо»): every waterspout, tornado and satellite rope shares
// four instanced draw calls:
//   funnels  two nested open cylinders per vortex (inner 0.7× radius, spinning 1.6× faster), only from the
//            sea up to the cloud collar (the camera is never pierced); neck profile, lean & sway with the
//            wind, fbm bands, alpha .55·(.4 + .6·(1 − |N·V|)^1.5), ×3 on the flash, pale in clear weather
//   collars  rotating log-spiral fbm discs at ~110 m with a screen-space hole around the heli
//   shadows  rotating cloud-shadow discs on the sea (multiply, diffuse ×0.6) — stage 1 «тёмное пятно»
//   spray    the stage-3 spray ring: 300 instanced sprites per vortex orbiting at 25 m/s, rising 4 m/s,
//            #DCE6E6 α .3 (GPU-animated from uniforms, zero CPU per particle)
// Logic (spout.js) owns a slot and writes plain numbers into it every frame; pack() uploads them.
import * as THREE from 'three';
import {
  COLORS, HZ_GLSL, FINISH, quadGeometry, polarDiscGeometry, cylinderGridGeometry, addInstanceAttrs,
} from './common.js';

export const MAX_VORTEX = 8;
const SPRAY_PER = 300; // DESIGN: 300 instanced sprites per spray ring (thinned on medium / low)

const FUNNEL_VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 iA; // x, z, scale, reach (visible fraction from the top)
attribute vec4 iB; // leanX, leanZ (top offset, m), sway (m), phase
attribute vec4 iC; // spin angle (rad, accumulated), alpha, thin (rope 0..1), bottom cut (0..1)
attribute vec4 iD; // top y, tone (0 spout, 1 tornado), spin dir (±1), seed
varying vec3 vW;
varying vec3 vN;
varying vec4 vClip;
varying vec4 vF; // s, u (rotating frame, turns), layer, tone
varying vec4 vG; // alpha, visible lower bound, seed, thin
const float PI = 3.14159265;

// Radius profile with a neck: wide where it hangs from the collar, thin waist, slight foot flare.
float fProfile(float s, float thin, float reach, float tone) {
  // waterspout: thin neck flaring into the collar; tornado (tone 1): a wedge — wide all the way down
  float spout = 5.5 + 18.5 * pow(smoothstep(0.32, 1.0, s), 1.7) + 4.0 * pow(1.0 - smoothstep(0.0, 0.2, s), 2.0);
  float wedge = 7.0 + 8.0 * pow(smoothstep(0.35, 1.0, s), 1.4) + 2.5 * pow(1.0 - smoothstep(0.0, 0.16, s), 2.0);
  float r = mix(spout, wedge, tone);
  r *= mix(1.0, 0.3, thin);
  float tip = 1.0 - reach;
  float taper = mix(0.12, 1.0, smoothstep(tip, tip + 0.25, s));
  return r * mix(1.0, taper, smoothstep(0.97, 0.8, reach));
}

void main() {
  float th = position.x;
  float s = position.y;
  float layer = position.z;
  float scale = iA.z;
  float thin = iC.z;
  float spinA = iC.x * mix(1.0, 1.6, layer);
  float r = fProfile(s, thin, iA.w, iD.y) * scale * mix(1.0, 0.7, layer);
  // slow bulges travelling up and around the wall
  r *= 1.0 + 0.09 * sin(3.0 * th - iD.z * spinA * 1.05 + s * 9.0 - uHzTime * 1.7 + iD.w * 7.0) * (0.35 + 0.65 * s);
  // centre line: lean downwind towards the top, rope sway largest mid-height, small fast wobble
  float sw = sin(PI * s);
  vec2 swayV = vec2(sin(uHzTime * 0.37 + iB.w), cos(uHzTime * 0.29 + iB.w * 1.7)) * iB.z;
  vec2 wob = vec2(sin(uHzTime * 1.9 + s * 6.0 + iB.w), cos(uHzTime * 1.6 + s * 5.0 + iB.w * 2.3)) * (0.5 + 1.6 * thin) * sqrt(scale);
  vec2 c = iA.xy + iB.xy * pow(s, 1.35) + (swayV + wob) * sw;
  vec3 wp = vec3(c.x + cos(th) * r, s * iD.x, c.y + sin(th) * r);
  vW = wp;
  float h = max(iD.x, 1.0);
  float dr = (fProfile(min(s + 0.02, 1.0), thin, iA.w, iD.y) - fProfile(max(s - 0.02, 0.0), thin, iA.w, iD.y)) * scale / (0.04 * h);
  vN = normalize(vec3(cos(th), -dr, sin(th)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vClip = gl_Position;
  vF = vec4(s, (th - iD.z * spinA) / (2.0 * PI), layer, iD.y);
  vG = vec4(iC.y, max(iC.w, 1.0 - iA.w), iD.w, thin);
}
`;

const FUNNEL_FRAG = /* glsl */ `
${HZ_GLSL}
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uPale;
uniform vec3 uTorDark;
uniform vec3 uTorLight;
varying vec3 vW;
varying vec3 vN;
varying vec4 vClip;
varying vec4 vF;
varying vec4 vG;
void main() {
  float s = vF.x;
  float lo = vG.y;
  float vis = smoothstep(lo, lo + 0.05, s) * (1.0 - smoothstep(0.8, 0.985, s));
  if (vis <= 0.002) discard;
  // fbm bands: streaks winding with the flow + condensation rings climbing the wall
  float u = vF.y;
  float n1 = texture2D(uAtlas, vec2(u * 2.0 + vG.z, s * 0.8 - uHzTime * 0.05)).r;
  float n2 = texture2D(uAtlas, vec2(u * 6.0 + n1 * 0.35, s * 3.0 - uHzTime * 0.22 + vG.z)).r;
  float bands = smoothstep(0.2, 0.85, 0.55 * n1 + 0.45 * n2);
  float rings = 0.5 + 0.5 * sin(s * 52.0 + n1 * 8.0 - uHzTime * 2.4);
  float tone = clamp(mix(bands, rings, 0.22) * 0.8 + 0.25, 0.0, 1.0);
  vec3 alb = mix(mix(uDark, uTorDark, vF.w), mix(uLight, uTorLight, vF.w), tone);
  alb = mix(alb, uPale * mix(0.62, 1.0, tone), 0.8 * uClear * (1.0 - vF.w));
  alb *= mix(1.0, 0.72, vF.z); // the inner wall is the denser core
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float nv = abs(dot(N, V));
  // DESIGN alpha: .55·(.4 + .6·(1 − |N·V|)^1.5) — the silhouette reads, the face we look into is veiled
  float a = 0.55 * (0.4 + 0.6 * pow(1.0 - nv, 1.5));
  a *= vis * vG.x * (0.85 + 0.3 * n2) * mix(1.0, 0.85, vF.z) * mix(1.0, 1.3, vG.w);
  // condensation scatters like spray: a little brighter than a lambert wall under the same sky
  float sunK = 0.4 + 0.6 * max(dot(N, uAirSunDir), 0.0);
  vec3 col = alb * hzAirLight(vW, sunK) * 1.3 * (1.0 + 2.0 * uFlash) + alb * uAirFlash * 0.9;
  a *= hzHeliHole(vClip, vW, 0.35);
  a *= smoothstep(10.0, 38.0, distance(cameraPosition, vW));
  col = mix(col, hzFogColor(col), hzFog(vW));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  ${FINISH}
}
`;

const COLLAR_VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 cA; // x, z, radius, alpha
attribute vec4 cB; // rotation (rad), tone, forming (0..1), seed
attribute vec4 cC; // y, spin dir, sag (m), 0
varying vec3 vW;
varying vec4 vClip;
varying vec4 vP; // r01, theta, rotation, spin
varying vec4 vI; // alpha, tone, forming, seed
void main() {
  float r01 = position.x;
  float th = position.y;
  float R = cA.z;
  // the wall cloud sags a little under the centre while the vortex is mature
  float y = cC.x - cC.z * (1.0 - r01 * r01) * cB.z;
  vec3 wp = vec3(cA.x + cos(th) * r01 * R, y, cA.y + sin(th) * r01 * R);
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vClip = gl_Position;
  vP = vec4(r01, th, cB.x, cC.y);
  vI = vec4(cA.w, cB.y, cB.z, cB.w);
}
`;

const COLLAR_FRAG = /* glsl */ `
${HZ_GLSL}
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uPale;
varying vec3 vW;
varying vec4 vClip;
varying vec4 vP;
varying vec4 vI;
void main() {
  float r01 = vP.x;
  float th = vP.y;
  float spin = vP.w;
  float form = vI.z;
  // Twirl: the inner cloud has turned further than the rim, so isotropic fbm is wound into spiral bands
  // (sampled in the rotating frame — the whole mass turns rigidly with the vortex).
  float ang = th - spin * (2.4 * pow(1.0 - r01, 1.5) + vP.z);
  vec2 q = vec2(cos(ang), sin(ang)) * r01;
  float n1 = texture2D(uAtlas, q * 0.42 + vec2(vI.w, 0.37)).r;
  float n2 = texture2D(uAtlas, q * 1.15 + vec2(0.13, vI.w * 2.0) + n1 * 0.35 - uHzTime * 0.002).r;
  float n3 = texture2D(uAtlas, q * 2.9 + vec2(vI.w * 1.7, 0.71) + n2 * 0.25).r;
  float puff = 1.0 - smoothstep(0.08, 0.85, texture2D(uAtlas, q * 0.75 + vec2(vI.w * 3.0, 0.21) + n1 * 0.12).g);
  // two soft log-spiral arms winding in towards the funnel (DESIGN «лог-спиральный fbm-диск»)
  float lr = log(max(r01, 0.05));
  float arm = 0.5 + 0.5 * cos(2.0 * (th - spin * (1.25 * lr + vP.z)) + 2.5 * (n1 - 0.5));
  float dens = (0.44 * n1 + 0.26 * n2 + 0.12 * n3 + 0.26 * puff) * (0.72 + 0.5 * arm);
  dens += 0.38 * exp(-pow(r01 / 0.3, 2.0)); // the wall cloud around the throat
  // ragged rim; grows outward from the centre while forming
  // (the tornado's wall cloud is huge: dense round the funnel, thinning early so the sea still reads)
  float rim = 1.0 - smoothstep(mix(0.45, 0.25, vI.y), 1.0, r01 + (n1 - 0.5) * 0.5);
  float grow = 1.0 - smoothstep(form * 1.15 - 0.35, form * 1.15, r01);
  // never a lid over the play: people and rafts under the cloud must still read (pillar 8), so the
  // wall cloud is dense only round the throat and thins outward
  float a = smoothstep(0.24, 0.85, dens) * rim * grow * vI.x * mix(0.62, 0.46, vI.y) * (0.65 + 0.35 * exp(-pow(r01 / 0.45, 2.0)));
  // the throat: the funnel leaves the cloud through a ragged opening — seen from above we look down it
  // (the tornado's wedge is ~60 m across at the cloud base, so its throat is proportionally wider)
  float thr = mix(1.0, 2.3, vI.y);
  a *= mix(1.0, smoothstep(0.045 * thr, 0.12 * thr, r01 + (n2 - 0.5) * 0.05), smoothstep(0.6, 1.0, form));
  if (a <= 0.003) discard;
  // cloud tops seen from above: thick billows catch the sky, thin edges show the dark underside,
  // the throat where the funnel leaves the cloud is the darkest spot
  float lit = 0.3 + 0.7 * smoothstep(0.25, 0.8, dens) * (0.7 + 0.3 * puff);
  float throat = exp(-pow(r01 / (0.09 * mix(1.0, 2.3, vI.y)), 2.0));
  vec3 alb = mix(uDark, uLight, lit);
  alb = mix(alb, uPale * mix(0.6, 1.0, lit), uClear * (1.0 - vI.y));
  alb *= mix(1.0, 0.4, vI.y) * (1.0 - 0.6 * throat);
  // in-cloud lightning lights the collar from inside, unevenly
  float inner = 1.0 + 2.0 * uFlash + 2.5 * uFlash * n1;
  vec3 col = alb * hzAirLight(vW, 0.6 + 0.4 * lit) * 1.35 * inner + alb * uAirFlash * (0.8 + 1.4 * puff);
  a *= hzHeliHole(vClip, vW, 0.0);
  a *= smoothstep(8.0, 40.0, distance(cameraPosition, vW));
  col = mix(col, hzFogColor(col), hzFog(vW));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  ${FINISH}
}
`;

const SHADOW_VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 sA; // x, z, radius, strength
attribute vec4 sB; // rotation, spin dir, seed, 0
varying vec3 vW;
varying vec4 vP; // r01, theta, rotation, spin
varying vec2 vI; // strength, seed
void main() {
  float r01 = position.x;
  float th = position.y;
  vec3 wp = vec3(sA.x + cos(th) * r01 * sA.z, uShadowY, sA.y + sin(th) * r01 * sA.z);
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vP = vec4(r01, th, sB.x, sB.y);
  vI = vec2(sA.w, sB.z);
}
`;

const SHADOW_FRAG = /* glsl */ `
${HZ_GLSL}
varying vec3 vW;
varying vec4 vP;
varying vec2 vI;
void main() {
  float r01 = vP.x;
  float lr = log(max(r01, 0.03));
  float sp = vP.y - vP.w * (1.8 * lr + vP.z);
  float n = texture2D(uAtlas, vec2(sp / 6.2831853 * 3.0 + vI.y, lr * 0.4 - uHzTime * 0.01)).r;
  float n2 = texture2D(uAtlas, vec2(sp / 6.2831853 * 5.0, lr * 0.8 + vI.y)).r;
  float disc = 1.0 - smoothstep(0.3, 1.0, r01 + (n - 0.5) * 0.35);
  // two shadow arms winding in, so the rotation reads on the water long before the funnel exists
  float arm = 0.5 + 0.5 * cos(2.0 * sp + 2.0 * (n - 0.5));
  float k = clamp(disc * vI.x * (0.72 + 0.28 * arm) * (0.9 + 0.25 * n2), 0.0, 1.0);
  // the cloud's shade on the sea (DESIGN: diffuse ×0.6 — taken deeper, the storm sea is already dark);
  // fogged sea is left alone
  float m = mix(1.0, 0.22, k * (1.0 - hzFog(vW)));
  gl_FragColor = vec4(vec3(m), 1.0);
}
`;

const SPRAY_VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 sp; // seed0, seed1, seed2, slot
uniform vec4 uVor[${MAX_VORTEX}];  // x, z, radius, strength
uniform vec4 uVor2[${MAX_VORTEX}]; // spin dir, scale, rise (m/s), 0
uniform vec3 uSprayCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
varying float vFog;
void main() {
  int slot = int(sp.w + 0.5);
  vec4 V = uVor[slot];
  vec4 V2 = uVor2[slot];
  if (V.w <= 0.002 || sp.y > uQuality) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float scale = V2.y;
  float life = mix(2.0, 3.4, sp.z);
  float tt = uHzTime + sp.x * life * 7.0;
  float age = mod(tt, life);
  float cyc = floor(tt / life);
  float a01 = age / life;
  float base = fract(sp.x * 7.13 + cyc * 0.6180339) * 6.2831853;
  float rr = V.z * mix(0.55, 1.1, fract(sp.z * 3.7 + cyc * 0.37)) * (1.0 + 0.45 * a01);
  float om = 25.0 * sqrt(scale) / max(rr, 1.0); // 25 m/s orbit
  float ang = base + V2.x * om * age;
  vec3 p = vec3(V.x + cos(ang) * rr, 0.3 * uShadowY + V2.z * age * (0.7 + 0.6 * sp.y), V.y + sin(ang) * rr);
  p.xz += uWind * 0.3 * age;
  float size = mix(1.1, 4.6, pow(a01, 0.7)) * mix(0.7, 1.3, sp.y) * sqrt(scale);
  float alpha = 0.18 * V.w * smoothstep(0.0, 0.14, a01) * (1.0 - smoothstep(0.55, 1.0, a01));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xyz += normalize(-mv.xyz) * size * 0.6; // soft-particle push: do not slice the waves
  float rot = sp.x * 40.0 + age * 0.8;
  float cs = cos(rot), sn = sin(rot);
  vec2 c = position.xy;
  mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
  gl_Position = projectionMatrix * mv;
  vUv = c;
  vec3 light = hzAirLight(p, 0.7) + uAirFlash * 1.8;
  vCol = vec4(uSprayCol * light, alpha);
  vSeed = fract(sp.x * 13.7 + cyc * 0.31);
  vFog = hzFog(p);
}
`;

const SPRAY_FRAG = /* glsl */ `
${HZ_GLSL}
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
varying float vFog;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec2 o = vec2(vSeed * 7.0, vSeed * 3.3);
  float n = texture2D(uAtlas, vUv * 0.3 + o).r;
  float dots = smoothstep(0.8, 0.97, texture2D(uAtlas, vUv * 0.9 + o * 1.7).a);
  // wispy, not a solid puff: hundreds of these overlap when the column is seen from above
  float body = pow(1.0 - r2, 2.2) * smoothstep(0.2, 0.85, n) * 1.2;
  float a = vCol.a * (body + dots * (1.0 - r2) * 0.8);
  vec3 col = mix(vCol.rgb, hzFogColor(vCol.rgb), vFog);
  gl_FragColor = vec4(col, clamp(a * (1.0 - 0.7 * vFog), 0.0, 1.0));
  ${FINISH}
}
`;

// One vortex visual slot: plain numbers written by the logic every frame.
function makeSlot(i) {
  return {
    index: i,
    used: false,
    // funnel
    x: 0, z: 0, scale: 1, reach: 0, bottomCut: 0, thin: 0, alpha: 0,
    leanX: 0, leanZ: 0, sway: 0, phase: i * 1.7, seed: (i * 0.137) % 1,
    spinAngle: 0, spinDir: -1, topY: 110, tone: 0,
    // collar
    collarAlpha: 0, collarRadius: 75, collarForm: 0, collarRot: 0, collarSag: 6,
    // cloud shadow on the sea
    shadowRadius: 70, shadowStrength: 0, shadowRot: 0,
    // spray ring
    sprayRadius: 14, sprayStrength: 0, sprayRise: 4,
  };
}

export class VortexFx {
  constructor(uniforms) {
    this.group = new THREE.Group();
    this.group.name = 'hazards.vortex';
    this.slots = [];
    for (let i = 0; i < MAX_VORTEX; i++) this.slots.push(makeSlot(i));

    const col = (h) => new THREE.Color(h);
    // --- funnels ---------------------------------------------------------------------------------
    const fg = cylinderGridGeometry(36, 28, 2);
    this.fAttr = addInstanceAttrs(fg, ['iA', 'iB', 'iC', 'iD'], MAX_VORTEX);
    this.funnelMat = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uDark: { value: col(COLORS.funnelDark) },
        uLight: { value: col(COLORS.funnelLight) },
        uPale: { value: col(COLORS.funnelPale) },
        uTorDark: { value: col(COLORS.tornadoDark) },
        uTorLight: { value: col(COLORS.tornadoLight) },
      },
      vertexShader: FUNNEL_VERT,
      fragmentShader: FUNNEL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.funnels = this._mesh(fg, this.funnelMat, 'hazards.funnels', 17);

    // --- collars --------------------------------------------------------------------------------------
    const cg = polarDiscGeometry(26, 72);
    this.cAttr = addInstanceAttrs(cg, ['cA', 'cB', 'cC'], MAX_VORTEX);
    this.collarMat = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uDark: { value: col(COLORS.collarDark) },
        uLight: { value: col(COLORS.collarLight) },
        uPale: { value: col(COLORS.collarPale) },
      },
      vertexShader: COLLAR_VERT,
      fragmentShader: COLLAR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.collars = this._mesh(cg, this.collarMat, 'hazards.collars', 23.5);

    // --- cloud shadows (multiply) ---------------------------------------------------------------------
    const sg = polarDiscGeometry(14, 56);
    this.sAttr = addInstanceAttrs(sg, ['sA', 'sB'], MAX_VORTEX);
    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms },
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true, // r185: multiply = dst · src.rgb only with premultiplied alpha
      toneMapped: false,
      fog: true,
    });
    this.shadows = this._mesh(sg, this.shadowMat, 'hazards.shadows', 1);

    // --- spray rings (sprites) -----------------------------------------------------------------------
    const qg = quadGeometry();
    const n = SPRAY_PER * MAX_VORTEX;
    const seeds = new Float32Array(n * 4);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = Math.floor(i / SPRAY_PER);
    }
    qg.setAttribute('sp', new THREE.InstancedBufferAttribute(seeds, 4));
    qg.instanceCount = 0;
    this.vorU = Array.from({ length: MAX_VORTEX }, () => new THREE.Vector4());
    this.vorU2 = Array.from({ length: MAX_VORTEX }, () => new THREE.Vector4(-1, 1, 4, 0));
    this.sprayMat = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uVor: { value: this.vorU },
        uVor2: { value: this.vorU2 },
        uSprayCol: { value: col(COLORS.spray) },
      },
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.spray = this._mesh(qg, this.sprayMat, 'hazards.spoutSpray', 21.5);
    this._fList = Object.values(this.fAttr);
    this._cList = Object.values(this.cAttr);
    this._sList = Object.values(this.sAttr);
  }

  _mesh(geo, mat, name, order) {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.frustumCulled = false;
    m.renderOrder = order;
    m.visible = false;
    this.group.add(m);
    return m;
  }

  alloc() {
    for (const s of this.slots) {
      if (!s.used) {
        Object.assign(s, makeSlot(s.index));
        s.used = true;
        return s;
      }
    }
    return null;
  }

  free(slot) {
    if (slot) slot.used = false;
  }

  clear() {
    for (const s of this.slots) s.used = false;
    this.pack();
  }

  // Upload every used slot into the instance attributes (a handful of vec4s per frame).
  pack() {
    const fa = this.fAttr, ca = this.cAttr, sa = this.sAttr;
    let nf = 0, nc = 0, ns = 0, maxSpray = -1;
    for (const s of this.slots) {
      const V = this.vorU[s.index];
      if (!s.used) {
        V.w = 0;
        continue;
      }
      if (s.alpha > 0.002 && s.reach > 0.002) {
        fa.iA.setXYZW(nf, s.x, s.z, s.scale, s.reach);
        fa.iB.setXYZW(nf, s.leanX, s.leanZ, s.sway, s.phase);
        fa.iC.setXYZW(nf, s.spinAngle, s.alpha, s.thin, s.bottomCut);
        fa.iD.setXYZW(nf, s.topY, s.tone, s.spinDir, s.seed);
        nf++;
      }
      if (s.collarAlpha > 0.002) {
        ca.cA.setXYZW(nc, s.x + s.leanX, s.z + s.leanZ, s.collarRadius, s.collarAlpha);
        ca.cB.setXYZW(nc, s.collarRot, s.tone, s.collarForm, s.seed);
        ca.cC.setXYZW(nc, s.topY, s.spinDir, s.collarSag, 0);
        nc++;
      }
      if (s.shadowStrength > 0.002) {
        sa.sA.setXYZW(ns, s.x + s.leanX * 0.5, s.z + s.leanZ * 0.5, s.shadowRadius, s.shadowStrength);
        sa.sB.setXYZW(ns, s.shadowRot, s.spinDir, s.seed, 0);
        ns++;
      }
      V.set(s.x, s.z, s.sprayRadius, s.sprayStrength);
      this.vorU2[s.index].set(s.spinDir, s.scale, s.sprayRise, 0);
      if (s.sprayStrength > 0.002) maxSpray = Math.max(maxSpray, s.index);
    }
    for (const a of this._fList) a.needsUpdate = nf > 0;
    for (const a of this._cList) a.needsUpdate = nc > 0;
    for (const a of this._sList) a.needsUpdate = ns > 0;
    this.funnels.geometry.instanceCount = nf;
    this.collars.geometry.instanceCount = nc;
    this.shadows.geometry.instanceCount = ns;
    this.spray.geometry.instanceCount = (maxSpray + 1) * SPRAY_PER;
    this.funnels.visible = nf > 0;
    this.collars.visible = nc > 0;
    this.shadows.visible = ns > 0;
    this.spray.visible = maxSpray >= 0;
  }

  // Everything visible with one dummy instance so the programs compile at boot (DESIGN §8.1).
  warmup(on) {
    for (const m of [this.funnels, this.collars, this.shadows, this.spray]) {
      m.visible = on;
      m.geometry.instanceCount = on ? 1 : 0;
    }
  }
}
