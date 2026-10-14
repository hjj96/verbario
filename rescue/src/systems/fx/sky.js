// "Sky from above" (DESIGN §2.7.3, §2.7.4, §2.13): the sky is only visible through reflections, cloud
// shadows, light colour and — here — the SCUD layer; plus low fog layers with the rotor's hole and the
// glory around the heli's shadow, and sea smoke (spindrift) in a full gale.
//
//  Scud [SHOULD]   4 / 8 / 14 soft noise quads 80–200 m at 60–85 m drifting with wind ×1.3–1.4,
//                  presence per preset (overcast .3, squall .8, storm 1), alpha ≤ .35, cut out to ≤ .2
//                  around the heli on screen (only where the cloud is between camera and heli), fades
//                  closer than 25 m to the camera, lit from inside by in-cloud lightning (#6A7BA8) and
//                  tinted by pooled lights (a red rocket colours the clouds within 120 m).
//  Fog layers      noise planes at 3 / 10 / 22 m, alpha ≤ .6, downwash hole below 25 m:
//  [SHOULD]        alpha ·= smoothstep(.6R, 1.2R, dist) with a churned rim.
//  Glory [SHOULD]  two-band spectral ring R 6–14 m around the heli's SHADOW on fog / drizzle,
//                  strength = fog × sun visibility.
//  Sea smoke       from Beaufort 9: a plane at ~1.5 m with noise stretched along the wind, α .25.
//  [SHOULD]
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, quadGeometry, rng32, smooth, clamp01 } from './common.js';

const SCUD_TILE = 480; // m — wrap tile around the camera focus (14 quads ≈ 2× coverage, 4 ≈ 0.6×)
const SCUD_MAX = 14;

const SCUD_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 aS;  // tile x, tile z (0..1), size (m), height (m)
attribute vec4 aS2; // rotation, noise seed u, v, rank
uniform vec2 uScudOff;
uniform float uTile;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vW;
varying vec4 vSeed;
void main() {
  vec2 focus = fxFocus();
  vec2 c = mod(aS.xy * uTile + uScudOff - focus + 0.5 * uTile, uTile) - 0.5 * uTile + focus;
  float cs = cos(aS2.x), sn = sin(aS2.x);
  vec2 q = position.xy * 0.5 * aS.z;
  // clouds are a little longer along x (they get stretched by the wind in the noise anyway)
  q.x *= 1.25;
  vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  vec3 wp = vec3(c.x + r.x, aS.w, c.y + r.y);
  vW = wp;
  vUv = position.xy;
  vLocal = r; // world-oriented offset from the cloud centre (noise travels with the cloud)
  vSeed = vec4(aS2.yz, aS.z, aS2.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SCUD_FRAG = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
uniform float uPresence;
uniform vec4 uFrontA, uFrontB; // origin.xy, dir.xy | travelled, width, scud behind, scud ahead
uniform float uFrontOn;
uniform vec3 uLit, uShade, uCloudLitCol;
uniform vec4 uCloudFlash[3];
uniform vec3 uHeliNdc; // ndc xy, cutout radius (ndc units)
uniform vec2 uWindDirN;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vW;
varying vec4 vSeed;
void main() {
  float pres = uPresence;
  if (uFrontOn > 0.5) {
    float along = dot(vW.xz - uFrontA.xy, uFrontA.zw) - uFrontB.x;
    float f = smoothstep(-uFrontB.y, uFrontB.y, along);
    pres = mix(uFrontB.w, uFrontB.z, f);
  }
  if (pres < 0.005) discard;
  float r = length(vUv);
  if (r > 1.0) discard;
  // scud is torn by the wind: noise stretched along it, evolving slowly
  vec2 wd = uWindDirN;
  vec2 q = vec2(dot(vLocal, wd) * 0.55, dot(vLocal, vec2(-wd.y, wd.x))) + vSeed.xy * 900.0;
  float evo = uTime * 0.004;
  float n1 = texture2D(uAtlas, q * 0.0062 + vec2(evo, -evo)).r;
  float n2 = texture2D(uAtlas, q * 0.019 - vec2(evo * 2.0, 0.0)).g;
  float n3 = texture2D(uAtlas, q * 0.052 + vec2(0.0, evo * 3.0)).r;
  float cl = n1 * 0.62 + n3 * 0.3 + (1.0 - n2) * 0.2;
  float edge = 1.0 - smoothstep(0.4, 1.0, r);
  float thr = mix(0.74, 0.53, pres);
  float dens = smoothstep(thr, thr + 0.24, cl * (0.6 + 0.4 * edge)) * edge;
  if (dens < 0.004) discard;
  float alpha = dens * 0.35 * smoothstep(0.0, 0.3, pres);

  // keep the heli readable: cut to ≤ .2 around it when the cloud is between camera and heli
  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  ndc.x *= uResolution.x / uResolution.y;
  float dh = length(ndc - uHeliNdc.xy);
  float above = smoothstep(uHeliP.y - 1.0, uHeliP.y + 4.0, vW.y) * uHeliP.w;
  alpha = mix(alpha, min(alpha, 0.2 * smoothstep(0.0, 0.6, dh / uHeliNdc.z)), above * (1.0 - smoothstep(uHeliNdc.z * 0.8, uHeliNdc.z * 1.6, dh)));
  // fade closer than 25 m to the camera
  alpha *= smoothstep(22.0, 42.0, distance(vW, cameraPosition));

  // tops lit by the sun / sky; denser = brighter (more light scattered back up)
  vec3 col = mix(uShade, uLit, smoothstep(0.1, 0.9, dens * 0.8 + n3 * 0.3));
  col += uAirFlash * 0.9 * (0.4 + 0.6 * dens);
  // in-cloud lightning: spots of #6A7BA8 glowing from inside
  for (int i = 0; i < 3; i++) {
    vec4 cf = uCloudFlash[i];
    if (cf.w <= 0.0) continue;
    vec2 dd = vW.xz - cf.xy;
    float f = cf.w * exp(-dot(dd, dd) / (cf.z * cf.z));
    col += uCloudLitCol * f * (2.5 + 5.0 * dens * n1);
    alpha = min(0.6, alpha + f * 0.18 * dens);
  }
  col += fxPointLights(vW + vec3(0.0, -3.0, 0.0)) * 0.3 * (0.5 + dens);
  float fog = fxFog(vW);
#ifdef USE_FOG
  col = mix(col, fogColor, fog * 0.85);
#endif
  gl_FragColor = vec4(col, alpha);
  ${FINISH}
}
`;

export class Scud {
  constructor(look, air) {
    const g = quadGeometry();
    const r = rng32(7713);
    const a = new Float32Array(SCUD_MAX * 4);
    const b = new Float32Array(SCUD_MAX * 4);
    // stratified tile positions so even 4 quads cover the view evenly
    for (let i = 0; i < SCUD_MAX; i++) {
      const gx = (i * 0.618034) % 1;
      const gz = (i * 0.754877 + 0.31) % 1;
      a[i * 4] = (gx + (r() - 0.5) * 0.18 + 1) % 1;
      a[i * 4 + 1] = (gz + (r() - 0.5) * 0.18 + 1) % 1;
      a[i * 4 + 2] = 90 + 110 * r();
      a[i * 4 + 3] = 60 + 25 * r();
      b[i * 4] = r() * Math.PI * 2;
      b[i * 4 + 1] = r();
      b[i * 4 + 2] = r();
      b[i * 4 + 3] = r();
    }
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aS2', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = SCUD_MAX;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.offset = new THREE.Vector2();
    this.cloudFlash = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        ...look.uniforms,
        ...air,
        uScudOff: { value: this.offset },
        uTile: { value: SCUD_TILE },
        uPresence: { value: 0 },
        uFrontA: { value: new THREE.Vector4(0, 0, 1, 0) },
        uFrontB: { value: new THREE.Vector4(0, 120, 0, 0) },
        uFrontOn: { value: 0 },
        uLit: { value: new THREE.Color(0.3, 0.32, 0.34) },
        uShade: { value: new THREE.Color(0.1, 0.11, 0.12) },
        uCloudLitCol: { value: new THREE.Color(COLORS.cloudLit) },
        uCloudFlash: { value: this.cloudFlash },
        uHeliNdc: { value: new THREE.Vector3(0, 0, 0.25) },
        uWindDirN: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: SCUD_VERT,
      fragmentShader: SCUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx.scud';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 23.5; // before rain, bolts and glows: bright things above the layer shine through
    this.mesh.visible = false;
    this._c = new THREE.Color();
  }

  setCount(n) {
    this.mesh.geometry.instanceCount = Math.max(0, Math.min(SCUD_MAX, n));
  }

  // st: weather.state; wind: Vector2 m/s; heliNdc {x, y} (aspect-corrected ndc) & visible flag.
  update(dt, st, wind, heliNdc, heliVisible, cloudFlash) {
    const u = this.material.uniforms;
    const p = st.palette || {};
    const pres = clamp01(p.scud ?? smooth(0.25, 0.85, st.intensity ?? 0));
    const front = st.front;
    const prev = st.palettePrev;
    const next = st.paletteNext;
    const frontOn = !!(front && front.active && prev && next && Number.isFinite(prev.scud) && Number.isFinite(next.scud));
    const any = Math.max(pres, frontOn ? Math.max(prev.scud, next.scud) : 0);
    this.mesh.visible = any > 0.01 && this.mesh.geometry.instanceCount > 0;
    if (!this.mesh.visible) return;
    // drift with the wind ×1.35
    this.offset.x += wind.x * 1.35 * dt;
    this.offset.y += wind.y * 1.35 * dt;
    const wl = Math.hypot(wind.x, wind.y);
    if (wl > 0.2) u.uWindDirN.value.set(wind.x / wl, wind.y / wl);
    u.uPresence.value = pres;
    u.uFrontOn.value = frontOn ? 1 : 0;
    if (frontOn) {
      u.uFrontA.value.set(front.origin.x, front.origin.y, front.dir.x, front.dir.y);
      u.uFrontB.value.set((front.speed ?? 20) * (front.t ?? 0), front.width ?? 120, prev.scud, next.scud);
    }
    // lighting of the tops: sky + sun, at night dark slate
    const night = st.night ?? 0;
    const sunY = Math.max(0.05, st.sunDirVisual?.y ?? 0.6);
    // cloud tops seen from above: sky light ×2.2 (multiple scattering) + sun, a touch of fog colour
    const lit = this._c;
    lit.setRGB(0.3, 0.32, 0.34);
    if (p.ambient) lit.copy(p.ambient).multiplyScalar((p.ambientIntensity ?? 0.6) * 1.7);
    if (p.sun) {
      const k = (p.sunIntensity ?? 1) * 0.6 * Math.sqrt(sunY);
      lit.r += p.sun.r * k;
      lit.g += p.sun.g * k;
      lit.b += p.sun.b * k;
    }
    if (p.fogColor) lit.lerp(p.fogColor, 0.2);
    lit.multiplyScalar(0.85 + 0.15 * (1 - night));
    u.uLit.value.copy(lit);
    u.uShade.value.copy(lit).multiplyScalar(0.5);
    if (p.deep) u.uShade.value.lerp(p.deep, 0.15);
    for (let i = 0; i < 3; i++) this.cloudFlash[i].copy(cloudFlash[i]);
    u.uHeliNdc.value.set(heliNdc.x, heliNdc.y, 0.32);
    if (!heliVisible) u.uHeliNdc.value.set(99, 99, 0.32);
  }
}

// ---------------------------------------------------------------------------------------------------
// Fog layers + sea smoke: one big horizontal quad per layer, recentred on the focus every frame.

const LAYER_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
uniform vec2 uCenter;
uniform float uY, uSize;
varying vec3 vW;
void main() {
  vec3 wp = vec3(uCenter.x + position.x * uSize * 0.5, uY, uCenter.y + position.y * uSize * 0.5);
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const LAYER_FRAG = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
uniform float uAlpha, uSeed, uMode, uScale;
uniform vec3 uCol;
uniform vec2 uOff;
uniform vec2 uWindDir;
uniform vec4 uHole; // x, z, radius, strength
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  float a;
  if (uMode < 0.5) {
    // fog bank: churned by the rotor near the hole
    vec2 d = p - uHole.xy;
    float dl = length(d);
    float R = max(uHole.z, 4.0);
    float sw = uHole.w * exp(-dl * dl / (R * R * 2.2));
    float ang = sw * (1.4 + 0.6 * sin(uTime * 0.7));
    float cs = cos(ang), sn = sin(ang);
    vec2 pr = uHole.xy + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) * (1.0 + 0.25 * sw);
    vec2 q = (pr - uOff) * uScale;
    float n1 = texture2D(uAtlas, q + vec2(uSeed, uSeed * 0.7)).r;
    float n2 = texture2D(uAtlas, q * 3.1 + vec2(uSeed * 1.3, -uSeed)).r;
    float n3 = texture2D(uAtlas, q * 9.0 - vec2(uTime * 0.01, uSeed)).g;
    a = smoothstep(0.22, 0.72, n1 * 0.8 + n2 * 0.35 - n3 * 0.12);
    // the hole + a thicker churned rim
    float hole = smoothstep(0.6 * R, 1.2 * R, dl);
    float rim = exp(-pow((dl - 1.25 * R) / (0.35 * R), 2.0)) * 0.35;
    a = mix(a, a * hole + rim * a, uHole.w);
  } else {
    // sea smoke: streaks along the wind
    vec2 w = uWindDir;
    vec2 uv = vec2(dot(p - uOff, w), dot(p, vec2(-w.y, w.x)));
    float n1 = texture2D(uAtlas, vec2(uv.x * 0.004, uv.y * 0.045) + uSeed).r;
    float n2 = texture2D(uAtlas, vec2(uv.x * 0.011, uv.y * 0.11) - uSeed).r;
    float big = texture2D(uAtlas, p * 0.0021 + vec2(uSeed * 0.3, 0.1)).r; // gusty patches
    a = smoothstep(0.66, 0.95, n1 * 0.7 + n2 * 0.45) * smoothstep(0.3, 0.7, big);
  }
  a *= uAlpha;
  float fog = fxFog(vW);
  a *= 1.0 - 0.5 * fog;
  if (a < 0.003) discard;
  vec3 col = uCol + uAirFlash * 1.2 + fxPointLights(vW + vec3(0.0, 2.0, 0.0)) * 0.2
           + vec3(1.0, 0.945, 0.855) * fxBeam(vW) * 1.6;
#ifdef USE_FOG
  col = mix(col, fogColor, fog * 0.7);
#endif
  gl_FragColor = vec4(col, a);
  ${FINISH}
}
`;

const GLORY_FRAG = /* glsl */ `
${LOOK_GLSL_UNIFORMS}
uniform vec4 uGlory; // x, z, strength, fog noise scale
uniform vec2 uOff;
varying vec3 vW;
vec3 spectral(float t) {
  // t 0 → violet/blue (inside) … 1 → red (outside)
  float h = (1.0 - t) * 0.72;
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return k;
}
void main() {
  float r = distance(vW.xz, uGlory.xy);
  float b1 = smoothstep(5.5, 6.5, r) * (1.0 - smoothstep(8.5, 9.5, r));
  float b2 = smoothstep(9.8, 10.8, r) * (1.0 - smoothstep(13.2, 14.4, r));
  vec3 c = spectral(clamp((r - 6.0) / 3.0, 0.0, 1.0)) * b1 + spectral(clamp((r - 10.4) / 3.4, 0.0, 1.0)) * b2 * 0.55;
  c = mix(vec3(dot(c, vec3(0.333))), c, 0.7); // a glory is pastel, not a neon rainbow
  // a soft bright core around the shadow (the «halo» of the glory)
  c += vec3(1.0, 0.97, 0.9) * exp(-r * r / 14.0) * 0.25;
  float n = texture2D(uAtlas, (vW.xz - uOff) * uGlory.w).r;
  float k = uGlory.z * (0.55 + 0.45 * smoothstep(0.3, 0.7, n));
  gl_FragColor = vec4(c * k, 1.0);
  ${FINISH}
}
`;

const LAYER_HEIGHTS = [3, 10, 22];
const LAYER_ALPHA = [0.6, 0.48, 0.36];
const LAYER_SCALE = [0.0042, 0.0034, 0.0027];

export class AirLayers {
  constructor(look, air) {
    this.layers = [];
    this.offset = new THREE.Vector2();
    this.smokeOff = new THREE.Vector2();
    const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
    for (let i = 0; i < 4; i++) {
      const smoke = i === 3;
      const m = new THREE.ShaderMaterial({
        uniforms: {
          ...fogUniforms(),
          ...look.uniforms,
          ...air,
          uCenter: { value: new THREE.Vector2() },
          uY: { value: smoke ? 1.5 : LAYER_HEIGHTS[i] },
          uSize: { value: 1500 },
          uAlpha: { value: 0 },
          uSeed: { value: 0.17 + i * 0.29 },
          uMode: { value: smoke ? 1 : 0 },
          uScale: { value: smoke ? 1 : LAYER_SCALE[i] },
          uCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
          uOff: { value: smoke ? this.smokeOff : this.offset },
          uWindDir: { value: new THREE.Vector2(1, 0) },
          uHole: { value: new THREE.Vector4(0, 0, 10, 0) },
        },
        vertexShader: LAYER_VERT,
        fragmentShader: LAYER_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      const mesh = new THREE.Mesh(plane, m);
      mesh.name = smoke ? 'fx.seaSmoke' : `fx.fogLayer${i}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = smoke ? 19 : 20 + i * 0.1;
      mesh.visible = false;
      this.layers.push(mesh);
    }
    this.glory = new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({
        uniforms: {
          ...look.uniforms,
          uCenter: { value: new THREE.Vector2() },
          uY: { value: 3.3 },
          uSize: { value: 34 },
          uGlory: { value: new THREE.Vector4(0, 0, 0, LAYER_SCALE[0]) },
          uOff: { value: this.offset },
        },
        vertexShader: /* glsl */ `
          uniform vec2 uCenter; uniform float uY, uSize; varying vec3 vW;
          void main() {
            vec3 wp = vec3(uCenter.x + position.x * uSize * 0.5, uY, uCenter.y + position.y * uSize * 0.5);
            vW = wp;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: GLORY_FRAG,
        transparent: true,
        depthWrite: false,
      side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glory.name = 'fx.glory';
    this.glory.frustumCulled = false;
    this.glory.renderOrder = 22;
    this.glory.visible = false;
    this.count = 3;
    this.seaSmokeAllowed = true;
    this._c = new THREE.Color();
  }

  setQuality(count, seaSmoke) {
    this.count = count;
    this.seaSmokeAllowed = seaSmoke;
  }

  // focus {x, z}; heli: {x, y, z, alt, alive}; dw: {x, z, radius, strength}; st weather.state
  update(dt, st, wind, focus, heli) {
    const p = st.palette || {};
    const fogAmt = clamp01(p.fog ?? st.fog ?? 0);
    const presence = smooth(0.55, 1.0, fogAmt);
    this.offset.x += wind.x * dt;
    this.offset.y += wind.y * dt;
    this.smokeOff.x += wind.x * 1.15 * dt;
    this.smokeOff.y += wind.y * 1.15 * dt;
    const cx = Math.round(focus.x / 10) * 10;
    const cz = Math.round(focus.z / 10) * 10;

    // fog colour lit a touch by the sun
    const col = this._c;
    if (p.fogColor) col.copy(p.fogColor);
    else col.setRGB(0.5, 0.52, 0.52);
    if (p.sun) col.lerp(p.sun, 0.06 * (1 - (st.night ?? 0)));

    // downwash hole below 25 m
    const alt = heli.alt;
    const holeK = heli.alive ? (1 - smooth(18, 26, alt)) * clamp01(heli.rpm ?? 1) : 0;
    const R = 9 + 0.35 * Math.max(0, alt);

    for (let i = 0; i < 3; i++) {
      const m = this.layers[i];
      const on = i < this.count && presence > 0.01;
      m.visible = on;
      if (!on) continue;
      const u = m.material.uniforms;
      u.uCenter.value.set(cx, cz);
      u.uAlpha.value = LAYER_ALPHA[i] * presence;
      u.uCol.value.copy(col).multiplyScalar(1 + 0.05 * i);
      // the hole reaches through the layers below the rotor (upper layers only when the heli is above them)
      const reach = heli.y > LAYER_HEIGHTS[i] + 2 ? 1 : 0.25;
      u.uHole.value.set(heli.x, heli.z, R, holeK * reach);
    }

    // sea smoke from Beaufort 9 (≈ 20.8 m/s): streaks along the wind, α .25
    const ws = Math.hypot(wind.x, wind.y);
    const smokeAmt = this.seaSmokeAllowed ? smooth(17, 23, ws) : 0;
    const sm = this.layers[3];
    sm.visible = smokeAmt > 0.01;
    if (sm.visible) {
      const u = sm.material.uniforms;
      u.uCenter.value.set(cx, cz);
      u.uY.value = 1.4 + 0.35 * (st.waveHeight ?? 1);
      u.uAlpha.value = 0.25 * smokeAmt;
      if (ws > 0.1) u.uWindDir.value.set(wind.x / ws, wind.y / ws);
      const c = u.uCol.value;
      if (p.foam) c.copy(p.foam);
      else c.setRGB(0.8, 0.84, 0.85);
      const amb = p.ambient ? p.ambient : null;
      const k = (p.ambientIntensity ?? 0.6) * 0.9 + (p.sunIntensity ?? 0.6) * 0.25 * (1 - (st.night ?? 0));
      c.multiplyScalar(Math.min(1.1, k));
      if (amb) c.lerp(amb, 0.15);
    }

    // glory around the heli's shadow on fog / drizzle (sun side visible)
    // needs a fog bank (or real mist) under the heli and a sun bright enough to cast a shadow
    const sunVis = clamp01((p.sunIntensity ?? 0) / 1.2) * (1 - (st.night ?? 0)) * (1 - 0.7 * clamp01(st.rain ?? 0));
    const mist = smooth(0.35, 0.8, fogAmt);
    const drizzle = smooth(0.02, 0.12, st.rain ?? 0) * (1 - smooth(0.25, 0.5, st.rain ?? 0)) * mist;
    const gloryK = Math.max(presence, drizzle * 0.5) * sunVis * (heli.alive ? 1 : 0) * (1 - smooth(60, 110, heli.y));
    this.glory.visible = gloryK > 0.02;
    if (this.glory.visible) {
      const sd = st.sunDir || st.sunDirVisual;
      const sy = Math.max(0.15, sd ? sd.y : 0.7);
      const h = heli.y - 3.3;
      const sx = heli.x - (sd ? sd.x : 0) * (h / sy);
      const sz = heli.z - (sd ? sd.z : 0) * (h / sy);
      const u = this.glory.material.uniforms;
      u.uCenter.value.set(sx, sz);
      u.uGlory.value.set(sx, sz, gloryK * 0.3, LAYER_SCALE[0]);
    }
  }
}
