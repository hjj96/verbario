// Thermal / FLIR view (DESIGN §8.1 «тепловой слой», §8.5 #7; CONTRACT «Depth pass additions»).
//
// One extra low-res pass: everything on render layer 2 (survivors, rafts, heli engines, flares, ship
// funnels — the owners opt in with obj.layers.enable(2); objects that only carry userData.heat are
// promoted to layer 2 by a slow scene sweep) is drawn with an override material into a small
// mipmapped target (R = heat). FinalPass turns the normal frame into a white-hot monochrome image:
// a cold, dark, low-contrast sea built from the frame's local contrast (digital detail enhancement,
// so day/night/fog/lightning all land on the same AGC'd grey), the heat target on top (crisp core +
// a soft bloom read from its mip chain + a faint microbolometer halo), reticle, scanline and fixed
// pattern noise. A short boot flicker (NUC shutter, torn rows) plays on every toggle.
//
// API: thermal.active (bool, CONTRACT), toggle(on?), mix (0..1 shown), visible, prewarm().
import * as THREE from 'three';

// Heat target size × composer size, by quality.
const SCALE = { low: 0.3, medium: 0.4, high: 0.5 };
const BOOT_ON = 0.55; // s
const BOOT_OFF = 0.2; // s
const SWEEP_EVERY = 1.5; // s — userData.heat → layer 2 fallback

const VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform float uKill;
uniform float uPointSize;
varying float vFacing;
varying float vDist;
void main() {
  #include <batching_vertex>
  #include <skinbase_vertex>
  #include <morphinstance_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vFacing = dot(transformedNormal, transformedNormal) > 1e-8 ? abs(normalize(transformedNormal).z) : 1.0;
  vDist = -mvPosition.z;
  gl_PointSize = uPointSize;
  if (uKill > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uHeat;
varying float vFacing;
varying float vDist;
void main() {
  // rounded bodies read hotter in the middle (limb darkening); long LWIR paths lose a little
  float h = uHeat * (0.7 + 0.3 * vFacing) * mix(1.0, 0.6, smoothstep(250.0, 1000.0, vDist));
  gl_FragColor = vec4(h, h, h, 1.0);
}`;

export class ThermalView {
  constructor(ctx, quality = 'high') {
    this.ctx = ctx;
    this.active = false; // CONTRACT: ctx.post.thermal.active
    this.mix = 0; // 0..1 how much of the FLIR image is shown
    this.boot = 0; // 0..1 boot/teardown glitch envelope
    this.flick = 1; // per-frame brightness flicker during boot
    this.scale = SCALE[quality] ?? 0.5;
    this._t = 0;
    this._bootDur = BOOT_ON;
    this._sweep = 0;
    this._prewarm = true;
    this._cc = new THREE.Color();
    this._rng = 1234567;

    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.texture.name = 'post.heat';

    this.material = new THREE.ShaderMaterial({
      name: 'MaydayHeat',
      uniforms: { uHeat: { value: 1 }, uKill: { value: 0 }, uPointSize: { value: 3 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      fog: false,
      lights: false,
    });
    // per-object heat (userData.heat, default 1); sprites can't be drawn with a mesh shader
    const u = this.material.uniforms;
    this.material.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      const heat = object?.userData?.heat;
      u.uHeat.value = Number.isFinite(heat) ? heat : 1;
      u.uKill.value = object?.isSprite ? 1 : 0;
      this.material.uniformsNeedUpdate = true;
    };
  }

  get visible() {
    return this.mix > 0.001 || this.boot > 0.001;
  }

  setQuality(q) {
    this.scale = SCALE[q] ?? 0.5;
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale)));
  }

  toggle(on = !this.active) {
    if (on === this.active) return;
    this.active = on;
    this._t = 0;
    this._bootDur = on ? BOOT_ON : BOOT_OFF;
    this.boot = 1;
    if (on) {
      this.mix = 1;
      this._sweep = 0; // promote userData.heat objects right away
    }
    this.ctx.events?.emit?.('post:thermal', { active: on });
  }

  prewarm() {
    this._prewarm = true;
  }

  _rand() {
    this._rng = (this._rng * 1664525 + 1013904223) >>> 0;
    return this._rng / 4294967296;
  }

  // realDt
  update(dt) {
    if (this.boot > 0) {
      this._t += dt;
      const k = Math.min(1, this._t / this._bootDur);
      this.boot = 1 - k;
      if (this.active) {
        // NUC shutter: grey, then the picture fights in through a few hard flickers
        this.flick = k < 0.25 ? 0.35 : this._rand() < 0.35 * (1 - k) ? 0.4 + 0.5 * this._rand() : 1;
      } else {
        this.flick = this._rand() < 0.5 ? 1.4 : 0.6;
        if (k >= 1) this.mix = 0;
      }
    } else {
      this.flick = 1;
      this.mix = this.active ? 1 : 0;
    }
    if (this.active) {
      this._sweep -= dt;
      if (this._sweep <= 0) {
        this._sweep = SWEEP_EVERY;
        this._promoteHeat();
      }
    }
  }

  // Fallback for heat sources that set userData.heat but not layer 2.
  _promoteHeat() {
    const scene = this.ctx.scene;
    if (!scene) return;
    scene.traverse((o) => {
      const h = o.userData?.heat;
      if (h > 0 && !o.layers.isEnabled(2)) {
        o.layers.enable(2);
        // children of a hot group (a merged person, an engine housing) are hot too
        if (o.isMesh !== true) o.traverse((c) => c.layers.enable(2));
      }
    });
  }

  // Draw the layer-2 objects into the heat target (only while the view is shown, plus one
  // warm-up draw after each shader warm-up so the first toggle does not stall on compiles).
  render(renderer, scene, camera) {
    const due = this.visible || (this._prewarm && this.ctx.warmup === 'idle');
    if (!due || !scene || !camera) return;
    this._prewarm = false;
    const prevTarget = renderer.getRenderTarget();
    const prevMask = camera.layers.mask;
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._cc);
    camera.layers.set(2);
    scene.overrideMaterial = this.material;
    scene.background = null;
    try {
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
    } finally {
      camera.layers.mask = prevMask;
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      renderer.setClearColor(this._cc, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    }
  }

  dispose() {
    this.rt.dispose();
    this.material.dispose();
  }
}
