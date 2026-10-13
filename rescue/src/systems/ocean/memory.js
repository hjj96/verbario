// "Water memory" (DESIGN §2.6.6): two ping-pong HalfFloat targets covering a 320 m window around
// the camera focus, re-centred by whole texels. Channels: R foam (half-life 3 s), G dye (240 s,
// light diffusion), B disturbance for bioluminescence/roughness (0.8 s), A oil (600 s).
// Pass 1 advects (wind drift + swirl of ocean features), pass 2 adds instanced stamps.
import * as THREE from 'three';
import { FEATURES_GLSL } from './features.js';

const MAX_STAMPS = 128;
const HALF_LIFE = [3, 240, 0.8, 600];

// Stamp kinds understood by the stamp shader (aC.x).
const SHAPE = { disc: 0, ring: 1, wake: 2 };

const ADVECT_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const ADVECT_FS = /* glsl */ `
${FEATURES_GLSL}
uniform sampler2D uPrev;
uniform vec2 uShift;     // (new centre − old centre) / extent  (whole texels)
uniform vec2 uCenter;    // new centre, world
uniform float uExtent;
uniform float uDt;
uniform vec2 uWindV;     // m/s
uniform vec4 uDecay;     // per-channel multiplier for this frame
uniform vec2 uTexel;
uniform float uDiffuse;  // dye diffusion amount for this frame
varying vec2 vUv;
void main() {
  vec2 world = uCenter + (vUv - 0.5) * uExtent;
  vec2 vel = 0.03 * uWindV + oceanFeatureFlow(world);
  vec2 src = vUv + uShift - vel * (uDt / uExtent);
  vec4 c = texture2D(uPrev, src);
  float n = texture2D(uPrev, src + vec2(uTexel.x, 0.0)).g + texture2D(uPrev, src - vec2(uTexel.x, 0.0)).g
          + texture2D(uPrev, src + vec2(0.0, uTexel.y)).g + texture2D(uPrev, src - vec2(0.0, uTexel.y)).g;
  c.g = mix(c.g, n * 0.25, uDiffuse);
  vec2 inside = step(vec2(0.0), src) * step(src, vec2(1.0));
  gl_FragColor = max(c * uDecay * (inside.x * inside.y), vec4(0.0));
}
`;

const STAMP_VS = /* glsl */ `
attribute vec4 aA;   // x, z, radius, strength
attribute vec4 aB;   // channel weights (foam, dye, disturbance, oil)
attribute vec4 aC;   // shape, ring inner radius (0..1), dirX, dirZ
uniform vec2 uCenter;
uniform float uExtent;
varying vec2 vQ;
varying vec4 vB;
varying vec4 vC;
varying float vS;
varying vec2 vSeed;
void main() {
  vQ = position.xy;
  vSeed = fract(aA.xy * 0.0137) * 97.0;
  vB = aB;
  vC = aC;
  vS = aA.w;
  vec2 world = aA.xy + position.xy * aA.z;
  gl_Position = vec4((world - uCenter) / (0.5 * uExtent), 0.0, 1.0);
}
`;

const STAMP_FS = /* glsl */ `
varying vec2 vQ;
varying vec4 vB;
varying vec4 vC;
varying float vS;
varying vec2 vSeed;
float sHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // irregular outlines: the radius wobbles with value noise seeded by the stamp position
  float r = length(vQ) + (sNoise(vQ * 3.0 + vSeed) - 0.5) * 0.35 + (sNoise(vQ * 7.0 + vSeed.yx) - 0.5) * 0.12;
  float shape;
  if (vC.x < 0.5) {
    shape = 1.0 - smoothstep(0.35, 1.0, r);
  } else if (vC.x < 1.5) {
    shape = exp(-pow((r - vC.y) / 0.13, 2.0)) * (1.0 - smoothstep(0.92, 1.0, r));
  } else {
    // Kelvin wake: V arms at 19.47° behind the mover plus a turbulent centre line
    vec2 dir = vC.zw;
    float along = -dot(vQ, dir);
    float lat = dot(vQ, vec2(-dir.y, dir.x));
    float arm = exp(-pow((abs(lat) - along * 0.3535) / 0.08, 2.0));
    float core = exp(-pow(lat / 0.06, 2.0)) * 0.45;
    shape = max(arm, core) * step(0.0, along) * (1.0 - smoothstep(0.55, 1.0, along));
  }
  gl_FragColor = vB * (vS * shape);
}
`;

export class WaterMemory {
  constructor(renderer, size, extent, featureUniforms) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    this.texel = extent / size;
    this.center = new THREE.Vector2();
    this._centerInit = false;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.read = new THREE.WebGLRenderTarget(size, size, opts);
    this.write = new THREE.WebGLRenderTarget(size, size, opts);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.advect = new THREE.ShaderMaterial({
      uniforms: {
        ...featureUniforms,
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uCenter: { value: new THREE.Vector2() },
        uExtent: { value: extent },
        uDt: { value: 0 },
        uWindV: { value: new THREE.Vector2() },
        uDecay: { value: new THREE.Vector4(1, 1, 1, 1) },
        uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
        uDiffuse: { value: 0 },
      },
      vertexShader: ADVECT_VS,
      fragmentShader: ADVECT_FS,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advect);
    quad.frustumCulled = false;
    this.advectScene = new THREE.Scene();
    this.advectScene.add(quad);

    // Instanced stamps
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    for (const a of [this.aA, this.aB, this.aC]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aA', this.aA);
    geo.setAttribute('aB', this.aB);
    geo.setAttribute('aC', this.aC);
    geo.instanceCount = 0;
    this.stampGeo = geo;
    this.stampMat = new THREE.ShaderMaterial({
      uniforms: { uCenter: this.advect.uniforms.uCenter, uExtent: this.advect.uniforms.uExtent },
      vertexShader: STAMP_VS,
      fragmentShader: STAMP_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const stamps = new THREE.Mesh(geo, this.stampMat);
    stamps.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(stamps);
    this.count = 0;
    this._clearColor = new THREE.Color();
    this.needsClear = true;
  }

  get texture() {
    return this.read.texture;
  }

  // shape: 'disc' | 'ring' | 'wake'; ch = [foam, dye, disturbance, oil]
  push(shape, x, z, radius, strength, f, d, b, o, inner = 0.7, dirX = 0, dirZ = 1) {
    if (this.count >= MAX_STAMPS || !(radius > 0) || !(strength > 0)) return;
    const j = this.count * 4;
    const A = this.aA.array, B = this.aB.array, C = this.aC.array;
    A[j] = x; A[j + 1] = z; A[j + 2] = radius; A[j + 3] = strength;
    B[j] = f; B[j + 1] = d; B[j + 2] = b; B[j + 3] = o;
    C[j] = SHAPE[shape] ?? 0; C[j + 1] = inner; C[j + 2] = dirX; C[j + 3] = dirZ;
    this.count++;
  }

  clear() {
    this.needsClear = true;
    this.count = 0;
  }

  _clearTargets() {
    const r = this.renderer;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clearColor);
    r.setClearColor(0x000000, 0);
    for (const t of [this.read, this.write]) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setClearColor(this._clearColor, prevAlpha);
    this.needsClear = false;
  }

  // focusX/Z: world point the window follows. windX/Z: m/s.
  update(dt, focusX, focusZ, windX, windZ) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    if (this.needsClear) this._clearTargets();

    const nx = Math.round(focusX / this.texel) * this.texel;
    const nz = Math.round(focusZ / this.texel) * this.texel;
    if (!this._centerInit) {
      this.center.set(nx, nz);
      this._centerInit = true;
    }
    const u = this.advect.uniforms;
    u.uPrev.value = this.read.texture;
    u.uShift.value.set((nx - this.center.x) / this.extent, (nz - this.center.y) / this.extent);
    u.uCenter.value.set(nx, nz);
    u.uDt.value = dt;
    u.uWindV.value.set(windX, windZ);
    u.uDecay.value.set(
      Math.pow(0.5, dt / HALF_LIFE[0]),
      Math.pow(0.5, dt / HALF_LIFE[1]),
      Math.pow(0.5, dt / HALF_LIFE[2]),
      Math.pow(0.5, dt / HALF_LIFE[3]),
    );
    u.uDiffuse.value = Math.min(1, dt * 0.6);
    this.center.set(nx, nz);

    r.setRenderTarget(this.write);
    r.render(this.advectScene, this.camera);
    if (this.count > 0) {
      this.stampGeo.instanceCount = this.count;
      this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
      this.aA.clearUpdateRanges();
      this.aB.clearUpdateRanges();
      this.aC.clearUpdateRanges();
      this.aA.addUpdateRange(0, this.count * 4);
      this.aB.addUpdateRange(0, this.count * 4);
      this.aC.addUpdateRange(0, this.count * 4);
      r.render(this.stampScene, this.camera);
      this.count = 0;
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
    this.advect.dispose();
    this.stampMat.dispose();
    this.stampGeo.dispose();
  }
}
