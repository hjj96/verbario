// Precipitation curtains (one instanced draw call): the downburst's dark rain column (§3.12 telegraph),
// the hail cell's pale green shaft #CFE3D6 and the tornado's rain arc (§2.12 «дуга дождя»).
// Open cylinders (or arcs of them) with falling fbm streaks, denser at the silhouette, cut around the heli.
import * as THREE from 'three';
import { HZ_GLSL, FINISH, cylinderGridGeometry, addInstanceAttrs } from './common.js';

export const MAX_CURTAINS = 6;

const VERT = /* glsl */ `
${HZ_GLSL}
attribute vec4 kA; // x, z, radius, height
attribute vec4 kB; // arc start, arc length (rad), alpha, kind (0 rain, 1 hail)
attribute vec4 kC; // albedo rgb, fall speed (m/s)
attribute vec4 kD; // seed, top radius ratio, lean x, lean z
varying vec3 vW;
varying vec3 vN;
varying vec4 vClip;
varying vec4 vK; // s, arc u (0..1), alpha, kind
varying vec4 vC;
varying float vSeed;
void main() {
  float u = position.x / 6.2831853;
  float s = position.y;
  float th = kB.x + u * kB.y;
  float r = kA.z * mix(1.0, kD.y, s);
  vec2 c = kA.xy + kD.zw * s;
  vec3 wp = vec3(c.x + cos(th) * r, s * kA.w, c.y + sin(th) * r);
  vW = wp;
  vN = vec3(cos(th), 0.0, sin(th));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vClip = gl_Position;
  vK = vec4(s, u, kB.z, kB.w);
  vC = kC;
  vSeed = kD.x;
}
`;

const FRAG = /* glsl */ `
${HZ_GLSL}
varying vec3 vW;
varying vec3 vN;
varying vec4 vClip;
varying vec4 vK;
varying vec4 vC;
varying float vSeed;
void main() {
  float s = vK.x;
  float u = vK.y;
  float h = max(vW.y, 0.0);
  // falling streaks: stretched noise scrolling down, a second slower layer for depth
  float fall = uHzTime * vC.w;
  float n1 = texture2D(uAtlas, vec2(u * 9.0 + vSeed, (h + fall) * 0.004)).r;
  float n2 = texture2D(uAtlas, vec2(u * 23.0 + vSeed * 3.1, (h + fall * 0.7) * 0.011)).r;
  float streak = smoothstep(0.35, 0.85, 0.5 * n1 + 0.5 * n2);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(N, V)), 1.2);
  float ends = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u));
  float vert = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.75, 1.0, s));
  float a = vK.z * (0.3 + 0.7 * rim) * (0.45 + 0.8 * streak) * ends * vert;
  if (a <= 0.003) discard;
  vec3 col = vC.rgb * hzAirLight(vW, 0.55) * (1.0 + 2.0 * uFlash) + vC.rgb * uAirFlash * 0.8;
  // hail glitters faintly in the beam / flash
  col *= 1.0 + vK.w * 0.6 * streak * (uFlash + hzBeam(vW));
  a *= hzHeliHole(vClip, vW, 0.25);
  a *= smoothstep(10.0, 40.0, distance(cameraPosition, vW));
  col = mix(col, hzFogColor(col), hzFog(vW));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  ${FINISH}
}
`;

function makeSlot(i) {
  return {
    index: i, used: false,
    x: 0, z: 0, radius: 60, height: 110, arcStart: 0, arcLen: Math.PI * 2, alpha: 0, kind: 0,
    color: new THREE.Color('#2A3236'), fall: 14, seed: (i * 0.271) % 1, taper: 1.15, leanX: 0, leanZ: 0,
  };
}

export class Curtains {
  constructor(uniforms) {
    const g = cylinderGridGeometry(48, 10, 1);
    this.attr = addInstanceAttrs(g, ['kA', 'kB', 'kC', 'kD'], MAX_CURTAINS);
    this._list = Object.values(this.attr);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'hazards.curtains';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 17.5;
    this.mesh.visible = false;
    this.slots = [];
    for (let i = 0; i < MAX_CURTAINS; i++) this.slots.push(makeSlot(i));
  }

  alloc() {
    for (const s of this.slots) {
      if (!s.used) {
        const c = s.color;
        Object.assign(s, makeSlot(s.index));
        s.color = c;
        s.used = true;
        return s;
      }
    }
    return null;
  }

  free(s) {
    if (s) s.used = false;
  }

  clear() {
    for (const s of this.slots) s.used = false;
    this.pack();
  }

  pack() {
    const A = this.attr;
    let n = 0;
    for (const s of this.slots) {
      if (!s.used || s.alpha <= 0.002) continue;
      A.kA.setXYZW(n, s.x, s.z, s.radius, s.height);
      A.kB.setXYZW(n, s.arcStart, s.arcLen, s.alpha, s.kind);
      A.kC.setXYZW(n, s.color.r, s.color.g, s.color.b, s.fall);
      A.kD.setXYZW(n, s.seed, s.taper, s.leanX, s.leanZ);
      n++;
    }
    for (const a of this._list) a.needsUpdate = n > 0;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  warmup(on) {
    this.mesh.visible = on;
    this.mesh.geometry.instanceCount = on ? 1 : 0;
  }
}
