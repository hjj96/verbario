// PMREM environment for props (DESIGN §2.7.3 [SHOULD]).
// Source: a tiny gradient sphere (sky → fogColor → deep·0.5), the sun disc and three soft clouds,
// baked to a 128 cubeUV map. Re-baked at the start and end of a transition, in between at most once
// every 4 s, and never in a flash frame; flashes go through scene.environmentIntensity instead.
// The ocean keeps envMapIntensity = 0 (its sky reflection is analytic), so this only lights props.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uFog;
uniform vec3 uDeep;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunI;
uniform float uCloud;
varying vec3 vDir;
float blob(vec3 d, vec3 c, float r) { return smoothstep(r, r * 0.35, acos(clamp(dot(d, normalize(c)), -1.0, 1.0))); }
void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (d.y >= 0.0) col = mix(uFog, uSky, smoothstep(0.0, 0.6, d.y));
  else col = mix(uFog, uDeep * 0.5, smoothstep(0.0, 0.3, -d.y));
  // three soft clouds, lit from the sun side
  float cl = max(blob(d, vec3(0.6, 0.45, -0.5), 0.55), max(blob(d, vec3(-0.7, 0.35, -0.2), 0.45), blob(d, vec3(0.1, 0.7, 0.6), 0.5)));
  vec3 cloudCol = mix(uFog, vec3(dot(uSky, vec3(0.3333))) * 1.15, 0.5) + uSunColor * uSunI * 0.04;
  col = mix(col, cloudCol, cl * uCloud);
  // sun disc + glow (HDR)
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * uSunI * (pow(s, 900.0) * 24.0 + pow(s, 14.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
}`;

export class WeatherEnv {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.uniforms = {
      uSky: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunI: { value: 1 },
      uCloud: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    this.pmrem = null;
    this.rt = null;
    this.lastBake = -99;
    this.dirty = true;
  }

  init() {
    try {
      this.pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
    } catch (err) {
      console.warn('[weather] PMREM unavailable', err);
      this.pmrem = null;
    }
    // A lost context takes the baked cubeUV render target with it (three restores uploaded textures,
    // never what was rendered into a target): props would go dark without their sky. Rebuild the
    // generator (its blur targets are gone too) and re-bake on the next eligible frame.
    const canvas = this.ctx.renderer?.domElement;
    if (canvas && !this._onRestore) {
      this._onRestore = () => {
        if (!this.pmrem) return;
        // no dispose(): the old GL objects died with the old context (deleting them only raises
        // INVALID_OPERATION); the JS side is a few small objects, once per context loss
        this.pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
        this.rt = null;
        this.dirty = true;
      };
      canvas.addEventListener('webglcontextrestored', this._onRestore);
    }
  }

  // Force a bake on the next eligible frame (transition start/end).
  markDirty() {
    this.dirty = true;
  }

  update(clock, st, transitioning) {
    const scene = this.ctx.scene;
    scene.environmentIntensity = st.palette.envIntensity * (1 + 3 * st.flash);
    if (!this.pmrem) return;
    if (st.flash > 0.01) return; // never bake in a flash frame
    const due = this.dirty || (transitioning && clock - this.lastBake >= 4);
    if (!due) return;
    this.bake(st);
    this.lastBake = clock;
    this.dirty = false;
  }

  bake(st) {
    const p = st.palette;
    const u = this.uniforms;
    u.uSky.value.copy(p.sky);
    u.uFog.value.copy(p.fogColor);
    u.uDeep.value.copy(p.deep);
    u.uSunDir.value.copy(st.sunDirVisual);
    u.uSunColor.value.copy(p.sun);
    u.uSunI.value = p.sunIntensity;
    u.uCloud.value = THREE.MathUtils.clamp(0.25 + 0.6 * p.fog + 0.4 * p.scud, 0, 1);
    const rt = this.pmrem.fromScene(this.scene, 0, 0.1, 50, { size: 128 });
    const old = this.rt;
    this.rt = rt;
    this.ctx.scene.environment = rt.texture;
    if (old) old.dispose();
  }
}
