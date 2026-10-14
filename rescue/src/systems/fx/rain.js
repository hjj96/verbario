// Rain (DESIGN §2.13 [MUST]) + dust motes in the searchlight beam (§2.13 [NICE]) + hail pellets (§2.12 [NICE]).
//
// 9000 / 5000 / 2000 instanced streaks wrapped in the vertex shader into a box of half-size 0.75·H around
// the point under the screen centre, from the sea up to camera − 8 m. Every streak is a 1.2 m segment
// along the rain velocity, expanded in SCREEN space (width ≥ 1.2 px), so perspective does the art
// direction for us: seen from above the streaks converge to the nadir like speed lines and the wind
// shifts that vanishing point. Colour `#B9C7CD × (ambient + 4·flash + 6·inSearchCone)` — the rain
// sparkles in the beam and in a flash; pooled lights (flares, rockets) tint it red. With an active
// spatial weather front the local amount is blended per drop: a curtain of rain marches across the sea.
import * as THREE from 'three';
import { LOOK_GLSL_UNIFORMS } from '../../core/look.js';
import { AIR_GLSL, FOG_PARS, FINISH, COLORS, fogUniforms, rng32, smooth } from './common.js';

const FALL = 9.0; // m/s, mean terminal velocity of big drops
const LEN = 1.2; // m
const LOCAL_MAX = 1600;

const RAIN_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 aSeed;   // x, y: position in the tile, z: vertical phase, w: density rank
attribute vec4 aSeed2;  // x: fall-speed factor, y: length factor, z: alpha factor, w: sparkle seed
uniform float uR, uFall, uLen, uRainAmt, uHail, uSpan, uRainGain, uNearFrac;
uniform vec4 uLocalA; // local population: centre xyz, w = mode (0 off, 1 searchlight cone, 2 point light)
uniform vec4 uLocalB; // half-size xz, half-height, gain
uniform vec2 uDrift;
uniform vec3 uDir;
uniform vec4 uFrontA;   // origin.xy, dir.xy
uniform vec4 uFrontB;   // travelled (speed·t), width, rain behind (old), rain ahead (new)
uniform float uFrontOn;
uniform vec3 uRainCol;
varying vec3 vC;
varying float vA;
varying vec2 vQ;

void main() {
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float fy = max(-fwd.y, 0.25);
  // a small share of the drops lives in a slab just under the camera: they make the long
  // «speed lines» converging to the nadir (uniform density would leave almost none on screen)
  float nearSel = step(fract(aSeed.w * 7.77 + aSeed.z * 3.1), uNearFrac);
  vec2 focus = mix(cameraPosition.xz + fwd.xz * (cameraPosition.y / fy), cameraPosition.xz + fwd.xz * (20.0 / fy), nearSel);
  float top = cameraPosition.y - 8.0;
  float bottom = mix(uSeaLevel - 1.5 - 0.6 * uHs, top - 26.0, nearSel);
  float Rb = mix(uR, 22.0, nearSel);
  bool local = uLocalA.w > 0.5;
  if (local) {
    // dense local population around a light (searchlight cone / flare / rocket): only the lit drops show
    focus = uLocalA.xz;
    top = uLocalA.y + uLocalB.y;
    bottom = uLocalA.y - uLocalB.y;
    Rb = uLocalB.x;
    nearSel = 0.0;
  }
  float span = max(top - bottom, 4.0);
  // hail pellets: a share of the drops, plus every drop beyond the rain amount when only hail falls
  float hail = max(step(aSeed2.w, uHail * 0.7), step(uRainAmt, aSeed.w) * step(0.001, uHail));
  float s = aSeed.z * span + uFall * aSeed2.x * (1.0 + 0.7 * hail);
  float cyc = floor(s / span);
  float y = top - (s - cyc * span);
  vec2 h = fract(aSeed.xy + cyc * vec2(0.6180339, 0.4142136));
  float L = 2.0 * Rb;
  vec2 rel = mod(h * L + uDrift - focus + Rb, L) - Rb;
  vec3 head = vec3(focus.x + rel.x, y, focus.y + rel.y);
  float rr = max(abs(rel.x), abs(rel.y)) / Rb;

  float rain = uRainAmt;
  if (uFrontOn > 0.5) {
    float along = dot(head.xz - uFrontA.xy, uFrontA.zw) - uFrontB.x;
    float n = texture2D(uAtlas, head.xz * 0.004).r;
    float f = smoothstep(-uFrontB.y, uFrontB.y, along + (n - 0.5) * 0.6 * uFrontB.y);
    rain = mix(uFrontB.w, uFrontB.z, f);
  }
  if (aSeed.w > max(rain, uHail * 0.8) || rr > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float len = uLen * aSeed2.y * mix(1.0, 0.25, hail);
  vec3 tail = head - uDir * len;
  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  vec2 half_res = uResolution * 0.5;
  vec2 dpx = (ch.xy / ch.w - ct.xy / ct.w) * half_res;
  float lpx = length(dpx);
  vec2 dir = lpx > 1e-3 ? dpx / lpx : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float pxPerM = projectionMatrix[1][1] * half_res.y / max(ch.w, 0.1);
  float wpx = max(mix(1.2, 2.4, hail), mix(0.006, 0.02, hail) * pxPerM);
  vec4 c = position.y > 0.0 ? ch : ct;
  vec2 offPx = perp * position.x * wpx * 0.5 + dir * position.y * wpx * 0.5;
  c.xy += offPx / half_res * c.w;
  gl_Position = c;
  vQ = position.xy;

  // light: ambient + 4·flash + 6·in-cone (with a per-drop sparkle) + pooled lights
  float cone = fxBeam(head);
  float sp = 0.5 + 0.5 * sin(uFxTime * (17.0 + 23.0 * aSeed2.w) + aSeed2.w * 61.0);
  sp = sp * sp * (1.0 + 2.5 * step(0.88, fract(aSeed2.w * 13.7)));
  vec3 light = (uAirAmb + uAirSun * 0.25) * uRainGain + uAirFlash * 4.0
             + vec3(1.0, 0.945, 0.855) * cone * 6.0 * (0.35 + 0.65 * sp)
             + fxPointLights(head) * 0.6;
  vC = uRainCol * light * mix(1.0, 1.8, hail);
  float fog = fxFog(head);
  float edge = (1.0 - smoothstep(0.82, 1.0, rr)) * smoothstep(0.0, 5.0, top - y) * smoothstep(bottom, bottom + 2.5, y);
  vA = (0.18 + 0.17 * aSeed2.z) * edge * (1.0 - 0.9 * fog) * mix(1.0, 1.6, hail) * mix(1.0, 0.75, nearSel);
  if (local) {
    float vis;
    if (uLocalA.w < 1.5) vis = smoothstep(0.02, 0.35, cone);
    else vis = 1.0 - smoothstep(0.25, 1.0, length(head - uLocalA.xyz) / uLocalB.x);
    // individual tracers, not a white ball: sparse bright glints + dimmer streaks
    vA = (0.12 + 0.16 * aSeed2.z) * vis * uLocalB.w * (1.0 - 0.9 * fog);
    vC = uRainCol * (vec3(1.0, 0.945, 0.855) * cone * 6.0 * (0.25 + 0.75 * sp) + fxPointLights(head) * 0.6 + uAirFlash * 4.0);
  }
}
`;

const RAIN_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
varying vec2 vQ;
void main() {
  float across = 1.0 - vQ.x * vQ.x;
  float along = mix(0.45, 1.0, vQ.y * 0.5 + 0.5);
  gl_FragColor = vec4(vC, vA * across * along);
  ${FINISH}
}
`;

// Motes: tiny specks drifting in the beam, visible only inside the cone (dry nights: «пылинки в луче»).
const MOTE_VERT = /* glsl */ `
${FOG_PARS}
${LOOK_GLSL_UNIFORMS}
${AIR_GLSL}
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform float uBox, uMoteAmt;
uniform vec2 uDrift;
varying vec3 vC;
varying vec2 vQ;
void main() {
  vec3 q = fract(aSeed.xyz + vec3(uDrift.x, uFxTime * 0.011 * (aSeed.w - 0.5), uDrift.y) / uBox) - 0.5;
  vec3 p = uCenter + q * uBox;
  p += 0.7 * vec3(sin(uFxTime * 0.37 + aSeed.w * 40.0), sin(uFxTime * 0.23 + aSeed.w * 17.0), cos(uFxTime * 0.31 + aSeed.w * 29.0));
  float cone = fxBeam(p);
  if (cone < 0.01 || aSeed.w > uMoteAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float px = mix(1.3, 2.6, fract(aSeed.w * 7.0));
  c.xy += position.xy * px / (uResolution * 0.5) * c.w;
  gl_Position = c;
  vQ = position.xy;
  float tw = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uFxTime * (3.0 + 6.0 * aSeed.w) + aSeed.w * 50.0), 3.0);
  vC = vec3(1.0, 0.945, 0.855) * cone * 2.2 * tw * (1.0 - fxFog(p));
}
`;
const MOTE_FRAG = /* glsl */ `
varying vec3 vC;
varying vec2 vQ;
void main() {
  float a = max(0.0, 1.0 - dot(vQ, vQ));
  gl_FragColor = vec4(vC * a, 1.0);
  ${FINISH}
}
`;

function streakGeometry(count, seed) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const r = rng32(seed);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    a[i * 4] = r();
    a[i * 4 + 1] = r();
    a[i * 4 + 2] = r();
    a[i * 4 + 3] = r();
    b[i * 4] = 0.8 + 0.45 * r();
    b[i * 4 + 1] = 0.75 + 0.6 * r();
    b[i * 4 + 2] = r();
    b[i * 4 + 3] = r();
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

export class Rain {
  constructor(look, air, maxCount, maxMotes) {
    this.max = maxCount;
    this.R = 110;
    this.fall = 0;
    this.drift = new THREE.Vector2();
    this.moteDrift = new THREE.Vector2();
    this._dir = new THREE.Vector3(0, -1, 0);

    this.geometry = streakGeometry(maxCount, 9127);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        ...look.uniforms,
        ...air,
        uR: { value: this.R },
        uFall: { value: 0 },
        uLen: { value: LEN },
        uRainAmt: { value: 0 },
        uHail: { value: 0 },
        uSpan: { value: 100 },
        uRainGain: { value: 1.5 },
        uNearFrac: { value: 0.06 },
        uLocalA: { value: new THREE.Vector4(0, 0, 0, 0) },
        uLocalB: { value: new THREE.Vector4(10, 10, 10, 1) },
        uDrift: { value: this.drift },
        uDir: { value: this._dir },
        uFrontA: { value: new THREE.Vector4(0, 0, 1, 0) },
        uFrontB: { value: new THREE.Vector4(0, 120, 0, 0) },
        uFrontOn: { value: 0 },
        uRainCol: { value: new THREE.Color(COLORS.rain) },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'fx.rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 24;
    this.mesh.visible = false;

    // Local dense populations: rain sparkling in the searchlight cone, and red around the most
    // important flare / rocket. Same shader, own seeds; only the lit drops are visible.
    const mkLocal = (seed, name) => {
      const g = streakGeometry(LOCAL_MAX, seed);
      const m = this.material.clone();
      // share every uniform object except the local box (clone() copied the values)
      for (const k of Object.keys(this.material.uniforms)) {
        if (k !== 'uLocalA' && k !== 'uLocalB') m.uniforms[k] = this.material.uniforms[k];
      }
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = 24.5;
      mesh.visible = false;
      return mesh;
    };
    this.local = mkLocal(4471, 'fx.rainBeam');
    this.localLight = mkLocal(8123, 'fx.rainLight');

    // motes
    this.maxMotes = maxMotes;
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    mg.setIndex([0, 1, 2, 0, 2, 3]);
    const r = rng32(311);
    const ms = new Float32Array(Math.max(1, maxMotes) * 4);
    for (let i = 0; i < ms.length; i++) ms[i] = r();
    mg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ms, 4));
    mg.instanceCount = maxMotes;
    mg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.moteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        ...look.uniforms,
        ...air,
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: 24 },
        uMoteAmt: { value: 0 },
        uDrift: { value: this.moteDrift },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.motes = new THREE.Mesh(mg, this.moteMaterial);
    this.motes.name = 'fx.motes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 25;
    this.motes.visible = false;
  }

  setCounts(rain, motes) {
    this.geometry.instanceCount = Math.min(this.max, rain);
    this.local.geometry.instanceCount = Math.min(LOCAL_MAX, Math.round(rain * 0.13));
    this.localLight.geometry.instanceCount = Math.min(LOCAL_MAX, Math.round(rain * 0.12));
    this.motes.geometry.instanceCount = Math.min(this.maxMotes, motes);
    this.motes.userData.allowed = motes > 0;
  }

  // st: weather.state; camY: camera height above the sea; beam: heli.beam (or null).
  // light: {x, y, z} of the most important pooled light (or null) for the local population.
  update(dt, st, camY, beam, wind, light = null) {
    const u = this.material.uniforms;
    const rain = Math.max(0, Math.min(1, st.rain ?? 0));
    const hail = Math.max(0, Math.min(1, st.hail ?? 0));
    const front = st.front;
    const prev = st.palettePrev;
    const next = st.paletteNext;
    const frontOn = !!(front && front.active && prev && next && Number.isFinite(prev.rain) && Number.isFinite(next.rain));
    const anyRain = Math.max(rain, hail, frontOn ? Math.max(prev.rain, next.rain) : 0);

    // Box size follows the camera height slowly (drops would slide if it changed fast).
    const targetR = 0.75 * Math.max(60, camY);
    this.R += (targetR - this.R) * (1 - Math.exp(-dt * 0.6));
    u.uR.value = this.R;

    // Integrated fall and wind drift (continuous when the wind changes).
    this.fall += FALL * dt;
    if (this.fall > 1e5) this.fall -= 1e5; // keep float precision; one-off jump nobody sees in 3 h
    this.drift.x += wind.x * 0.9 * dt;
    this.drift.y += wind.y * 0.9 * dt;
    u.uFall.value = this.fall;

    // Streak direction: fall + a capped share of the wind (the vanishing point shifts but stays near
    // the frame so streaks still read as converging speed lines).
    const wl = Math.hypot(wind.x, wind.y);
    const hk = wl > 1e-3 ? Math.min(0.35 * wl, 0.5 * FALL) / wl : 0;
    this._dir.set(wind.x * hk, -FALL, wind.y * hk).normalize();
    u.uLen.value = LEN * (1 + 0.25 * smooth(8, 24, wl));

    u.uRainAmt.value = rain;
    u.uHail.value = hail;
    u.uFrontOn.value = frontOn ? 1 : 0;
    if (frontOn) {
      u.uFrontA.value.set(front.origin.x, front.origin.y, front.dir.x, front.dir.y);
      u.uFrontB.value.set((front.speed ?? 20) * (front.t ?? 0), front.width ?? 120, prev.rain, next.rain);
    }
    this.mesh.visible = anyRain > 0.003;

    // local populations: the searchlight cone, and the brightest pooled light (flare / rocket)
    const la = this.local.material.uniforms.uLocalA.value;
    const lb = this.local.material.uniforms.uLocalB.value;
    const beamOk = anyRain > 0.05 && beam && beam.on && beam.intensity > 0.05 && beam.origin && beam.hit;
    if (beamOk) {
      const o = beam.origin;
      const h = beam.hit;
      const rEnd = (beam.length || 30) * Math.tan((beam.angle || 0.26) * 1.05);
      la.set((o.x + h.x) * 0.5, (o.y + h.y) * 0.5, (o.z + h.z) * 0.5, 1);
      lb.set(Math.max(6, Math.hypot(h.x - o.x, h.z - o.z) * 0.5 + rEnd * 1.1), Math.max(3, (o.y - h.y) * 0.5 + 1), 0, 1);
    }
    this.local.visible = !!beamOk && this.mesh.visible;
    const lla = this.localLight.material.uniforms.uLocalA.value;
    const llb = this.localLight.material.uniforms.uLocalB.value;
    const lightOk = anyRain > 0.05 && !!light;
    if (lightOk) {
      lla.set(light.x, light.y + 4, light.z, 2);
      llb.set(22, 12, 0, 1);
    }
    this.localLight.visible = lightOk && this.mesh.visible;

    // Motes in the beam on dry nights.
    const mu = this.moteMaterial.uniforms;
    const beamOn = !!(beam && beam.on && beam.intensity > 0.02);
    const moteAmt = beamOn ? (1 - smooth(0.05, 0.4, rain)) * (0.25 + 0.75 * (st.night ?? 0)) : 0;
    this.motes.visible = moteAmt > 0.01 && this.motes.userData.allowed !== false;
    if (this.motes.visible) {
      const o = beam.origin;
      const hp = beam.hit;
      mu.uCenter.value.set(o.x + (hp.x - o.x) * 0.62, o.y + (hp.y - o.y) * 0.62, o.z + (hp.z - o.z) * 0.62);
      mu.uBox.value = Math.max(14, (beam.length || 30) * 0.8);
      mu.uMoteAmt.value = moteAmt;
      this.moteDrift.x += wind.x * 0.25 * dt;
      this.moteDrift.y += wind.y * 0.25 * dt;
    }
  }
}
