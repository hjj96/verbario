// Thermal / FLIR view (DESIGN §8.1 «тепловой слой», §8.5 #7; CONTRACT «Depth pass additions»).
//
// One extra low-res pass with an override material into a small target:
//   R = heat — everything on render layer 2 (survivors, rafts, heli engines, flares, ship funnels; the
//       owners opt in with obj.layers.enable(2); objects that only carry userData.heat are promoted to
//       layer 2 by a slow scene sweep);
//   G = thermal mass — the solid, opaque world (islands, rocks, buildings, hulls, the rig, the heli's
//       airframe), put on layer 3 by the same sweep: land and steel hold the day's heat, so in LWIR they
//       read as a smooth mid-grey mass against the cold sea (userData.thermMass overrides the 0.5 default).
// The sea itself is never drawn (cold = black). FinalPass turns this into a white-hot monochrome image:
// a cold, nearly uniform sea with a faint detail-enhanced texture of the frame, the warm mass shaded by
// its facing, the heat on top (crisp core + a soft two-ring bloom + a faint microbolometer halo),
// reticle, scanline and fixed pattern noise. A short boot flicker (NUC shutter, torn rows) plays on
// every toggle.
//
// API: thermal.active (bool, CONTRACT), toggle(on?), mix (0..1 shown), visible, prewarm().
import * as THREE from 'three';

// Heat target size × composer size, by quality.
const SCALE = { low: 0.3, medium: 0.4, high: 0.5 };
const BOOT_ON = 0.55; // s
const BOOT_OFF = 0.2; // s
const SWEEP_EVERY = 1.5; // s — userData.heat → layer 2 fallback, solid world → layer 3 (mass)
const HEAT = 2;
const MASS = 3;
const MASS_DEFAULT = 0.5;
// solid, opaque surfaces only: beams, glows, keylines, decals and particles stay out of the mass pass
const isSolid = (m) => !!m && !m.transparent && m.depthWrite !== false && m.blending === THREE.NormalBlending && m.visible !== false;

const VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform float uKill;
uniform float uPointSize;
varying float vFacing;
varying float vDist;
varying float vWorldY;
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
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    wp = batchingMatrix * wp;
  #endif
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  vWorldY = (modelMatrix * wp).y;
  vFacing = dot(transformedNormal, transformedNormal) > 1e-8 ? abs(normalize(transformedNormal).z) : 1.0;
  vDist = -mvPosition.z;
  gl_PointSize = uPointSize;
  if (uKill > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uHeat;
uniform float uMass;
varying float vFacing;
varying float vDist;
varying float vWorldY;
void main() {
  // the sea is opaque to LWIR: seabed, the submerged hull and the rocks' feet are never seen
  if (uMass > 0.0 && vWorldY < 0.05) discard;
  // rounded bodies read hotter in the middle (limb darkening); long LWIR paths lose a little
  float path = mix(1.0, 0.6, smoothstep(250.0, 1000.0, vDist));
  float h = uHeat * (0.7 + 0.3 * vFacing) * path;
  // mass: surfaces facing the sky soaked up more of the day (cliffs and hull sides read cooler)
  float m = uMass * (0.55 + 0.45 * vFacing) * path;
  gl_FragColor = vec4(h, m, 0.0, 1.0);
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
      generateMipmaps: false, // a mip chain proved unreliable as a sampler here (incomplete → black)
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.texture.name = 'post.heat';

    this.material = new THREE.ShaderMaterial({
      name: 'MaydayHeat',
      uniforms: { uHeat: { value: 1 }, uMass: { value: 0 }, uKill: { value: 0 }, uPointSize: { value: 3 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      fog: false,
      lights: false,
    });
    // per-object heat (layer 2: userData.heat, default 1) or mass (layer 3 only: userData.thermMass);
    // sprites can't be drawn with a mesh shader
    const u = this.material.uniforms;
    this.material.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      const ud = object?.userData;
      if (object?.layers.isEnabled(HEAT)) {
        u.uHeat.value = Number.isFinite(ud?.heat) ? ud.heat : 1;
        u.uMass.value = 0;
      } else {
        u.uHeat.value = 0;
        u.uMass.value = Number.isFinite(ud?.thermMass) ? ud.thermMass : MASS_DEFAULT;
      }
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

  // Fallback for heat sources that set userData.heat but not layer 2, and the mass layer: the solid
  // meshes of the world (rebuilt per mission) and the heli's airframe. Cheap enough at 1.5 s.
  _promoteHeat() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    if (!scene) return;
    scene.traverse((o) => {
      const h = o.userData?.heat;
      if (h > 0 && !o.layers.isEnabled(HEAT)) {
        o.layers.enable(HEAT);
        // children of a hot group (a merged person, an engine housing) are hot too
        if (o.isMesh !== true) o.traverse((c) => c.layers.enable(HEAT));
      }
    });
    for (const root of [ctx.world?.root, ctx.heli?.group]) {
      root?.traverse((o) => {
        if (!o.isMesh || o.layers.isEnabled(HEAT) || o.layers.isEnabled(MASS)) return;
        const m = o.material;
        if (Array.isArray(m) ? m.every(isSolid) : isSolid(m)) o.layers.enable(MASS);
      });
    }
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
    camera.layers.set(HEAT);
    camera.layers.enable(MASS);
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
