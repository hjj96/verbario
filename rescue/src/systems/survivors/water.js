// Where people meet the sea and the night (DESIGN §2.7.2 «Плавучие объекты», §2.10 signals, §2.8 low):
//
//  Collars — foam collar ring (0.8R…1.6R, lace-noise alpha) + dark contact disc (25 %) under everything
//            that floats, oriented to the lagged wave normal, brighter in the searchlight. Without it
//            floating things look pasted onto the water. One instanced draw call.
//  Glows   — additive camera-facing sprites: strobe and raft-lamp flashes, mirror stars, chemlights,
//            tape sparkle on low quality (no bloom there, DESIGN §2.8). One instanced draw call.
//  Lines   — sea-anchor (drogue) lines from the rafts, 1 px rope. One draw call.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Horizontal "visibility bubble" fog factor — same maths as the look.js fog patch.
const FOG_GLSL = /* glsl */ `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
float svFog(vec3 wp) {
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 focus = fwd.xz * (cameraPosition.y / max(-fwd.y, 0.25));
  vec3 off = wp - cameraPosition;
  float hd = length(off.xz - focus);
  return smoothstep(fogNear, fogFar, hd) * (1.0 - 0.6 * smoothstep(30.0, 140.0, wp.y));
}
`;

// ------------------------------------------------------------------------------------------------
export class Collars {
  constructor(look, max = 160) {
    const g = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iData', this.data);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsLib.fog,
        ...look.uniforms,
        uFoam: { value: new THREE.Color('#E8EEEC') }, // palette foam × light (CPU)
        uBeam: { value: new THREE.Color('#F2FAFF') },
      },
      vertexShader: /* glsl */ `
        ${LOOK_GLSL_UNIFORMS}
        attribute vec4 iData; // foam 0..1, dark 0..1, lit 0..1, phase
        varying vec2 vL;
        varying vec4 vD;
        varying vec3 vW;
        void main() {
          vL = position.xz;
          vD = iData;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${LOOK_GLSL_UNIFORMS}
        ${FOG_GLSL}
        uniform vec3 uFoam;
        uniform vec3 uBeam;
        varying vec2 vL;
        varying vec4 vD;
        varying vec3 vW;
        void main() {
          float r = length(vL);                // 0..1 = 0..1.6R
          if (r > 1.0) discard;
          // world-anchored noise, slowly crawling, phase-shifted per object so collars never match
          vec2 uv = vW.xz + vec2(vD.w * 3.7, vD.w * 1.9 + uTime * 0.12);
          float fine = texture2D(uLace, uv * 0.42).b;
          float lace = texture2D(uLace, uv * 0.19 + 0.5).r;
          float blot = texture2D(uLace, uv * 0.06 + 0.31).g;
          float ang = atan(vL.y, vL.x);
          // waterline band where the hull meets the sea (r = 0.5 → 0.8R), lapping with the swell
          float lap = 0.5 + 0.5 * sin(ang * 5.0 + uTime * 1.7 + vD.w * 6.0);
          float band = exp(-pow((r - 0.51 - 0.02 * lap) / 0.075, 2.0)) * (0.55 + 0.45 * fine);
          // lacy skirt that thins out towards 1.6R
          float skirt = smoothstep(0.46, 0.58, r) * (1.0 - smoothstep(0.58, 1.0, r));
          float laceMask = smoothstep(0.45, 0.85, 0.55 * lace + 0.45 * fine + 0.35 * blot - 0.25 * r);
          float foam = vD.x * min(0.9, band * 0.95 + skirt * laceMask * 0.6);
          float dark = vD.y * 0.25 * (1.0 - smoothstep(0.35, 0.55, r));
          vec3 foamCol = mix(uFoam, uBeam, vD.z);
          float a = max(foam, dark);
          vec3 col = foamCol * foam / max(a, 1e-3);
          float f = svFog(vW);
          gl_FragColor = vec4(col, a * (1.0 - 0.9 * f));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true, // keeps fogColor/fogNear/fogFar in sync with scene.fog (we apply it ourselves)
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(g, this.material, max);
    this.mesh.name = 'survivors.collars';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11; // right after the ocean
    this.mesh.count = 0;
    this.max = max;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  // (x, y, z) waterline centre, normal n, R object radius, foam/dark/lit 0..1, phase, yaw/elongation
  push(x, y, z, nx, ny, nz, R, foam, dark, lit, phase, yaw = 0, elong = 1) {
    if (this.n >= this.max) return;
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(UP, _n);
    if (yaw) _q.multiply(_qy.setFromAxisAngle(UP, yaw));
    const r = 1.6 * R;
    _s.set(r, 1, r * elong);
    _p.set(x, y + 0.05, z);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.n, _m);
    const a = this.data.array;
    const j = this.n * 4;
    a[j] = foam;
    a[j + 1] = dark;
    a[j + 2] = lit;
    a[j + 3] = phase;
    this.n++;
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    if (!n) return;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    this.data.clearUpdateRanges();
    this.data.addUpdateRange(0, n * 4);
    this.data.needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------------
export class Glows {
  constructor(look, max = 128) {
    const g = new THREE.PlaneGeometry(2, 2);
    const mk = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.P = mk('iP', 4); // xyz, core size (m)
    this.Cc = mk('iC', 4); // rgb, intensity
    this.H = mk('iH', 4); // halo size (m), halo intensity, kind (0 round, 1 star), rotation
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uResolution: look.uniforms.uResolution },
      vertexShader: /* glsl */ `
        ${FOG_GLSL}
        uniform vec2 uResolution;
        attribute vec4 iP;
        attribute vec4 iC;
        attribute vec4 iH;
        varying vec2 vUv;
        varying vec3 vCore;
        varying vec3 vHalo;
        varying float vCoreF;
        varying float vKind;
        void main() {
          vec4 mv = viewMatrix * vec4(iP.xyz, 1.0);
          float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5);
          float halo = max(iH.x * 0.5, 5.0 / pxPerM);
          float core = max(iP.w * 0.5, 1.4 / pxPerM);
          float cs = cos(iH.w), sn = sin(iH.w);
          vec2 c = position.xy;
          mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * halo;
          mv.xyz += normalize(-mv.xyz) * min(halo, 2.5); // never sink into a wave
          gl_Position = projectionMatrix * mv;
          vUv = c;
          float k = 1.0 - 0.85 * svFog(iP.xyz);
          vCore = iC.rgb * iC.a * k;
          vHalo = iC.rgb * iH.y * k;
          vCoreF = core / halo;
          vKind = iH.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vCore;
        varying vec3 vHalo;
        varying float vCoreF;
        varying float vKind;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float rc = r / max(vCoreF, 1e-3);
          float core = exp(-rc * rc * 2.5);
          float halo = exp(-r * r * 6.0) * (1.0 - r);
          vec3 col = vCore * core + vHalo * halo;
          if (vKind > 0.5) {
            float ray = exp(-abs(vUv.y) / (vCoreF * 0.3)) * exp(-abs(vUv.x) * 2.6)
                      + exp(-abs(vUv.x) / (vCoreF * 0.3)) * exp(-abs(vUv.y) * 2.6);
            col += vCore * ray * 0.45;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.geometry = g;
    this.mesh = new THREE.InstancedMesh(g, this.material, max);
    this.mesh.name = 'survivors.glows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 27;
    this.mesh.count = 0;
    this.max = max;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  // color: THREE.Color (linear). intensity: core HDR multiplier, haloI: halo multiplier.
  add(x, y, z, coreSize, color, intensity, haloSize, haloI, kind = 0, rot = 0) {
    if (this.n >= this.max || !(intensity > 0.001 || haloI > 0.001)) return;
    const i = this.n++;
    const j = i * 4;
    let a = this.P.array;
    a[j] = x; a[j + 1] = y; a[j + 2] = z; a[j + 3] = coreSize;
    a = this.Cc.array;
    a[j] = color.r; a[j + 1] = color.g; a[j + 2] = color.b; a[j + 3] = intensity;
    a = this.H.array;
    a[j] = haloSize; a[j + 1] = haloI; a[j + 2] = kind; a[j + 3] = rot;
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const a of [this.P, this.Cc, this.H]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------------------------------------
export class Lines {
  constructor(maxSegments = 160) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxSegments * 2 * 3);
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({ color: '#C9B27A', transparent: true, opacity: 0.85, fog: true });
    this.mesh = new THREE.LineSegments(g, this.material);
    this.mesh.name = 'survivors.lines';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.max = maxSegments;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  seg(x0, y0, z0, x1, y1, z1) {
    if (this.n >= this.max) return;
    const j = this.n * 6;
    const p = this.pos;
    p[j] = x0; p[j + 1] = y0; p[j + 2] = z0;
    p[j + 3] = x1; p[j + 4] = y1; p[j + 5] = z1;
    this.n++;
  }

  end() {
    this.mesh.geometry.setDrawRange(0, this.n * 2);
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.attr.clearUpdateRanges();
    this.attr.addUpdateRange(0, this.n * 6);
    this.attr.needsUpdate = true;
  }
}
