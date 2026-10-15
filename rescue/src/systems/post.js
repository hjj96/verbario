// PostFX — EffectComposer stack and the display-space FinalPass (DESIGN §2.8, §8.2; CONTRACT «post»).
//
//   RenderPass  → HalfFloat target, MSAA 4 / 2 / 0 by quality (canvas antialias is off)
//   UnrealBloom → high: from half resolution, medium: from a quarter, low: off (emissive halos instead)
//   OutputPass  → ACES Filmic + sRGB; exposure = palette.exposure × flash (×(1 + 2.4f)) × afterimage
//   FinalPass   → drops, CA, pulses, grading, vignette, grain, letterbox, dither (post/finalShader.js)
//
// Everything per preset comes from weather.state.palette.post (already blended by weather).
// Dynamic resolution (§8.2): 1 s mean frame > 18 ms → render scale −0.05, < 13 ms → +0.05, within
// 0.67–1 / 0.75–1 / 0.8–1 (low / medium / high); internal pixels capped at 1080p; high drops MSAA
// 4 → 2 when still over budget at the minimum scale. `?dynres=0` disables it (screenshots, tests).
//
// Depth pass (CONTRACT «Depth pass additions»):
//   * thermal / FLIR — `post.thermal` (post/thermal.js): action `thermal` (T, R3) toggles
//     `post.thermal.active` in play; one low-res layer-2 heat pass before the composer, FinalPass
//     turns the frame white-hot. Off on every mode change away from play/pause and on mission:setup.
//   * photo mode — `ctx.photo` (post/photo.js): action `photo` (V, L3) in play enters/leaves it,
//     Backspace / pad B leaves it (Esc pauses → leaves it too). While active: ctx.timeScale = 0,
//     gameplay input off, the rig flies a free camera (camera.js), FinalPass gets tilt-shift DOF,
//     exposure, grade presets and its own letterbox; Enter / pad A saves a PNG of the clean frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, damp, createRng } from '../core/math.js';
import { createFinalMaterial } from './post/finalShader.js';

const smoothstep01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
import { LensDrops, GRID_X, GRID_Y } from './post/drops.js';
import { ThermalView } from './post/thermal.js';
import { PhotoMode } from './post/photo.js';

const SAMPLES = { low: 0, medium: 2, high: 4 };
const MIN_SCALE = { low: 0.67, medium: 0.75, high: 0.8 };
const BLOOM_SCALE = { low: 0.5, medium: 0.5, high: 1 }; // × full size; UnrealBloom halves again
const MAX_PIXELS = 1920 * 1080;
const DAMAGE_RED = new THREE.Color('#B3121A');
const AMBER = new THREE.Color('#FFB547');
const BLACK = new THREE.Color(0, 0, 0);

// UnrealBloomPass whose internal chain starts from a fraction of the composer size.
class ScaledBloomPass extends UnrealBloomPass {
  constructor(...args) {
    super(...args);
    this.scale = 1;
    this._w = 2;
    this._h = 2;
    this.highPassUniforms.smoothWidth.value = 0.3; // soft knee instead of a hard 0.01 cut
  }

  setSize(w, h) {
    this._w = w;
    this._h = h;
    super.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale)));
  }

  setScale(s) {
    if (s === this.scale) return;
    this.scale = s;
    this.setSize(this._w, this._h);
  }
}

export class PostFX {
  constructor(ctx) {
    this.ctx = ctx;
    const renderer = ctx.renderer;
    this.quality = ctx.settings.get('quality') || 'high';
    this.dynamicResolution = ctx.params?.get('dynres') !== '0';
    this.scale = 1;
    this.samples = SAMPLES[this.quality] ?? 4;
    this.rng = createRng(911);

    // Render targets: scene (MSAA, depth) and a plain one for the display-space passes.
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.rtScene.texture.name = 'post.scene';
    this.rtPost = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtPost.texture.name = 'post.display';

    this.composer = new EffectComposer(renderer, this.rtScene);
    this.composer.renderTarget2.dispose(); // clone of the MSAA target — replaced by the plain one
    this.composer.renderTarget2 = this.rtPost;

    this.renderPass = new RenderPass(ctx.scene, ctx.camera);
    this.bloom = new ScaledBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.1);
    this.bloom.scale = BLOOM_SCALE[this.quality] ?? 1;
    this.output = new OutputPass();
    this.drops = new LensDrops(() => this.rng.next());
    this.finalMaterial = createFinalMaterial(this.drops.texture);
    this.finalMaterial.uniforms.uGrid.value.set(GRID_X, GRID_Y);
    this.final = new ShaderPass(this.finalMaterial);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.final);
    this.bloom.enabled = this.quality !== 'low';

    // Depth pass: FLIR view + photo mode
    this.thermal = new ThermalView(ctx, this.quality);
    this.finalMaterial.uniforms.tHeat.value = this.thermal.rt.texture;
    this.photo = new PhotoMode(ctx);

    // Pulses (DESIGN §2.8 FinalPass step 3).
    this.pulses = { damage: 0, caKick: 0, caHold: 0, vortex: 0, flash: 0, after: 0, pause: 0, salt: 0, sprayCd: 0 };
    this.realT = 0;
    this.seedT = 0;
    this.seed = 0;

    // Frame timing for dynamic resolution and the quality hint.
    this.stats = { frameMs: 16, scale: 1, samples: this.samples, atMinScale: false, pixelRatio: 1 };
    this._acc = 0;
    this._n = 0;
    this._slowSeconds = 0;
    this._hinted = false;

    this._size = new THREE.Vector2();
    this._col = new THREE.Color();
    this._v3 = new THREE.Vector3();
    this._vScreen = new THREE.Vector2();
    this._wScreen = new THREE.Vector2();
    this._edge = { r: 0, g: 0, b: 0, a: 0 };
    this._flow = new THREE.Vector2(0, -1);

    const ev = ctx.events;
    ev.on('heli:damage', (e = {}) => {
      const src = e.source || '';
      const amt = Number(e.amount) || 0.1;
      this.pulse('damage', clamp(0.45 + amt * 3, 0.45, 1));
      if (/water|wave|rogue|crest|splash/.test(src)) this.pulse('spray', 0.8);
    });
    ev.on('weather:lightning', (e = {}) => {
      this.pulse(e.distance !== undefined && e.distance < 40 && !e.cloudOnly ? 'strike' : 'lightning', 1);
    });
    ev.on('hazard:hit', (e = {}) => {
      if (e.type === 'lightning') this.pulse('strike', 1);
      if (e.type === 'rogue') this.pulse('spray', 1.2);
    });
    ev.on('game:mode', (e = {}) => {
      if (e.to !== 'play') this.photo.exit();
      if (e.to !== 'play' && e.to !== 'paused') this.thermal.toggle(false);
    });
    ev.on('mission:setup', () => {
      this.photo.exit();
      this.thermal.active = false;
      this.thermal.mix = 0;
      this.thermal.boot = 0;
      this.thermal.prewarm();
    });
    ctx.settings.onChange?.((k) => {
      if (k === 'quality') this._applyQuality(ctx.settings.get('quality'));
      if (k === 'reduceMotion' && ctx.settings.get('reduceMotion')) this.drops.clear();
    });
  }

  init() {
    this.resize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------------------------------
  // Public API

  // name: 'damage' | 'lightning' | 'strike' | 'vortex' | 'spray' | 'salt' | 'flash'
  pulse(name, strength = 1) {
    const p = this.pulses;
    const s = Number.isFinite(strength) ? strength : 1;
    const reduce = this.ctx.settings.get('reduceFlashes');
    switch (name) {
      case 'damage':
      case 'hit':
        p.damage = Math.max(p.damage, clamp(s, 0, 1));
        break;
      case 'lightning':
        if (!reduce) { p.caKick = Math.max(p.caKick, 2 * s); p.caHold = 0.12; }
        break;
      case 'strike':
        if (!reduce) { p.caKick = Math.max(p.caKick, 4 * s); p.caHold = 0.12; }
        break;
      case 'vortex':
        p.vortex = Math.max(p.vortex, clamp(s, 0, 1));
        break;
      case 'spray':
        if (this._dropsAllowed()) this.drops.spray(s);
        break;
      case 'salt':
        p.salt = clamp(p.salt + 0.25 * s, 0, 1);
        break;
      case 'flash':
        p.flash = Math.max(p.flash, clamp(s, 0, reduce ? 0.3 : 1));
        break;
      default:
        break;
    }
  }

  resize(w = window.innerWidth, h = window.innerHeight) {
    const renderer = this.ctx.renderer;
    const prBase = renderer.getPixelRatio();
    const cap = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
    const pr = Math.max(0.25, Math.min(prBase, Math.max(cap, 0.5)) * this.scale);
    this.composer._pixelRatio = pr; // EffectComposer.setPixelRatio would resize twice
    this.composer.setSize(w, h);
    renderer.getDrawingBufferSize(this._size);
    const u = this.finalMaterial.uniforms;
    u.uRes.value.copy(this._size);
    u.uPxScale.value = Math.max(1, prBase);
    this.drops.setAspect(this._size.x, this._size.y);
    this.thermal.setSize(w * pr, h * pr);
    this.stats.pixelRatio = pr;
    this.stats.scale = this.scale;
  }

  // ------------------------------------------------------------------------------------------

  _applyQuality(q) {
    this.quality = q;
    this.bloom.enabled = q !== 'low';
    this.bloom.setScale(BLOOM_SCALE[q] ?? 1);
    this.thermal.setQuality(q);
    this.scale = 1;
    this._setSamples(SAMPLES[q] ?? 4);
    if (q === 'low') this.drops.clear();
    this.resize();
  }

  _setSamples(n) {
    if (n === this.samples) return;
    this.samples = n;
    this.rtScene.samples = n;
    this.rtScene.dispose(); // re-created with the new sample count on next use
    this.stats.samples = n;
  }

  _dropsAllowed() {
    const s = this.ctx.settings;
    return this.quality !== 'low' && !s.get('reduceMotion');
  }

  _dynamicResolution(dt) {
    this._acc += dt;
    this._n++;
    if (this._acc < 1) return;
    const ms = (this._acc / this._n) * 1000;
    this._acc = 0;
    this._n = 0;
    this.stats.frameMs = ms;
    if (!this.dynamicResolution || this.ctx.mode === 'paused' || this.photo.active) return;
    const min = MIN_SCALE[this.quality] ?? 0.8;
    let next = this.scale;
    if (ms > 18) next = Math.max(min, this.scale - 0.05);
    else if (ms < 13) next = Math.min(1, this.scale + 0.05);
    const atMin = next <= min + 1e-3;
    this.stats.atMinScale = atMin;
    if (this.quality === 'high') {
      if (atMin && ms > 18) this._setSamples(2);
      else if (ms < 11 && this.scale >= 1) this._setSamples(4);
    }
    if (Math.abs(next - this.scale) > 1e-3) {
      this.scale = next;
      this.resize();
    }
    // Quality hint (§7.6): > 22 ms for 10 s at the minimum scale → suggest a lower preset once.
    this._slowSeconds = atMin && ms > 22 ? this._slowSeconds + 1 : 0;
    if (!this._hinted && this._slowSeconds >= 10 && this.quality !== 'low') {
      this._hinted = true;
      this.ctx.events.emit('post:quality-hint', { quality: this.quality, suggest: this.quality === 'high' ? 'medium' : 'low', frameMs: ms });
    }
  }

  _addEdge(c, a) {
    if (a <= 0) return;
    const E = this._edge;
    E.r += c.r * a;
    E.g += c.g * a;
    E.b += c.b * a;
    E.a += a;
  }

  // Heli velocity & wind in screen space (x right, y up) using the camera basis.
  _screenVec(vx, vz, out) {
    const e = this.ctx.camera.matrixWorld.elements;
    // camera right (e0, e1, e2) and up (e4, e5, e6), projected on the horizontal plane
    let rx = e[0], rz = e[2];
    let ux = e[4], uz = e[6];
    const rl = Math.hypot(rx, rz) || 1;
    const ul = Math.hypot(ux, uz) || 1;
    rx /= rl; rz /= rl; ux /= ul; uz /= ul;
    return out.set(vx * rx + vz * rz, vx * ux + vz * uz);
  }

  update(dt) {
    const ctx = this.ctx;
    this.realT += dt;
    this._dynamicResolution(dt);
    const st = ctx.weather?.state;
    const pal = st?.palette;
    const P = pal?.post;
    const heli = ctx.heli;
    const reduce = ctx.settings.get('reduceFlashes');
    const p = this.pulses;
    const u = this.finalMaterial.uniforms;
    const paused = ctx.mode === 'paused';

    // --- depth pass: thermal / photo toggles (post runs after mission, so Esc→pause already landed) ---
    const input = ctx.input;
    if (ctx.mode === 'play' && input?.rawPressed) {
      if (input.rawPressed('thermal')) this.thermal.toggle();
      const flying = (ctx.mission?.state ?? 'play') === 'play';
      if (input.rawPressed('photo') && (flying || this.photo.active)) this.photo.toggle();
      else if (this.photo.active && input.rawPressed('back')) this.photo.exit();
    }
    const photo = this.photo.active;
    if (photo) this.photo.update(dt);
    this.thermal.update(dt);
    const gdt = paused || photo ? 0 : dt;

    // --- pulses ---------------------------------------------------------------------------------
    p.damage = Math.max(0, p.damage - dt * (reduce ? 1.1 : 1.7));
    if (p.caHold > 0) p.caHold -= dt;
    else p.caKick = Math.max(0, p.caKick - dt * 30);
    p.vortex = Math.max(0, p.vortex - dt * 3);
    p.flash = Math.max(0, p.flash - dt * 4);
    p.pause = damp(p.pause, paused ? 1 : 0, 9, dt);
    p.salt = Math.max(0, p.salt - gdt / 40);

    const flash = clamp((st?.flash || 0) + p.flash, 0, 1);
    // afterimage: −0.25 stop for 0.6 s once the flash has passed
    if (flash > 0.35) p.after = 1;
    else p.after = Math.max(0, p.after - dt / 0.6);
    const afterMul = Math.pow(2, -0.25 * p.after * (1 - flash));
    // At night the strike already lights the scene (hemisphere ×4, the swung sun ×5, the sea's own
    // flash layer); the full ×(1+2.4f) on top pushed the sea to ≈0.77 in the strike frame, so the
    // white-hot bolt (which peaks in that same frame) had nothing to stand out against. Half the
    // boost at night keeps the silver sea and lets the spear read.
    const night = st?.night || 0;
    const exposure = (pal?.exposure ?? 1) * (1 + 2.4 * flash * (1 - 0.5 * night)) * afterMul * this.photo.exposureMul();
    ctx.renderer.toneMappingExposure = exposure;

    // --- bloom ----------------------------------------------------------------------------------
    if (P) {
      // A flash lights the whole scene: lift the threshold so the waves keep their contrast
      // (only the bolt and real emitters bloom), instead of a full-frame haze.
      this.bloom.strength = P.bloomStrength * (1 - 0.45 * flash);
      this.bloom.radius = P.bloomRadius;
      this.bloom.threshold = P.bloomThreshold * (1 + 5 * flash);
    }

    // --- grading uniforms (palette colours are linear → FinalPass works in sRGB) -----------------
    if (P) {
      u.uSlope.value.copy(P.slope);
      u.uOffset.value.copy(P.offset);
      u.uPower.value = P.power;
      u.uContrast.value = P.contrast;
      const green = st.greenTint || 0;
      u.uSat.value = P.saturation * (1 - 0.45 * green);
      u.uGreen.value = green;
      setSRGB(u.uSplitShadow.value, P.splitShadow, this._col);
      setSRGB(u.uSplitHighlight.value, P.splitHighlight, this._col);
      u.uSplitStrength.value = P.splitStrength;
      u.uVignette.value = P.vignette;
      setSRGB(u.uVignetteColor.value, P.vignetteColor, this._col);
      u.uGrain.value = P.grain;
      u.uCA.value = (P.ca + p.caKick) * (this._size.y / 1080);
    }
    u.uNight.value = st?.night || 0;
    u.uFloor.value = 0.006 + 0.006 * (st?.night || 0);
    // daylight toe for the dark storm grades (none at night: night water stays 0.015–0.06)
    u.uDayToe.value = 0.05 * (1 - smoothstep01(0.4, 0.75, st?.night || 0));
    u.uFlash.value = flash;
    if (st?.flashColor) setSRGB(u.uFlashTint.value, st.flashColor, this._col);
    u.uSatMul.value = (1 - 0.65 * flash) * (1 - 0.3 * p.damage) * (1 - 0.6 * p.pause);
    u.uBright.value = 1 - 0.35 * p.pause;
    u.uVortex.value = p.vortex;
    u.uLetterbox.value = photo ? this.photo.letterboxMix : clamp(ctx.cameraRig?.letterbox || 0, 0, 1);

    // photo options (DOF, grade preset) and the FLIR view
    const extraGrain = this.photo.apply(u, this.quality, this._size.y);
    const th = this.thermal;
    u.uThermal.value = th.mix;
    u.uThermBoot.value = th.boot;
    u.uThermFlick.value = th.flick;
    u.uThermT.value = this.realT;
    u.uGrain.value = (P?.grain ?? 0.03) * (1 - th.mix) + 0.032 * th.mix + extraGrain;

    // grain reseeded at 24 Hz
    this.seedT += dt;
    if (this.seedT >= 1 / 24) {
      this.seedT %= 1 / 24;
      this.seed = (this.seed + 1) % 997;
      u.uSeed.value = this.seed + this.rng.next();
    }

    // --- edge pulses: damage, hull < 25 % breathing, low-fuel amber ------------------------------
    const E = this._edge;
    E.r = E.g = E.b = E.a = 0;
    this._addEdge(reduce ? BLACK : DAMAGE_RED, (reduce ? 0.4 : 0.5) * p.damage);
    const hull = heli?.hull ?? 1;
    if (hull < 0.25 && heli?.alive !== false) {
      const breath = 0.5 - 0.5 * Math.cos(this.realT * Math.PI); // 0.5 Hz
      this._addEdge(DAMAGE_RED, 0.28 * breath * (1 - (hull / 0.25) * 0.5));
    }
    const fuel = heli?.fuel ?? 1;
    if (fuel < 0.25 && fuel > 0 && heli?.alive !== false) {
      const hz = fuel < 0.1 ? 1.2 : 0.6;
      const ph = (this.realT * hz) % 1;
      const pulse = Math.exp(-ph * 5) * (1 - Math.exp(-ph * 60));
      this._addEdge(AMBER, (fuel < 0.1 ? 0.3 : 0.2) * pulse);
    }
    if (E.a > 0) {
      // averaged in linear space, uploaded as sRGB like every other FinalPass colour
      this._col.setRGB(E.r / E.a, E.g / E.a, E.b / E.a);
      setSRGB(this._v3, this._col, this._col);
      u.uEdge.value.set(this._v3.x, this._v3.y, this._v3.z, Math.min(0.75, E.a));
    } else u.uEdge.value.w = 0;

    // --- lens drops, condensation, salt --------------------------------------------------------
    const allowDrops = this._dropsAllowed();
    const rivulets = allowDrops && this.quality === 'high';
    if (allowDrops) {
      const vx = heli?.velocity?.x || 0;
      const vz = heli?.velocity?.z || 0;
      const speed = Math.hypot(vx, vz);
      const vs = this._screenVec(-vx, -vz, this._vScreen); // drops run against the heli's motion
      const wd = st?.windDir;
      const ws = st?.windSpeed || 0;
      let fx = vs.x * 0.7;
      let fy = vs.y * 0.7;
      if (wd) {
        const wsv = this._screenVec(wd.x * ws, wd.y * ws, this._wScreen);
        fx += wsv.x * 0.3;
        fy += wsv.y * 0.3;
      }
      fy -= 0.6; // a little gravity toward the bottom of the frame
      const fl = Math.hypot(fx, fy) || 1;
      this._flow.set(fx / fl, fy / fl);
      const rate = (P?.drops || 0) * 12 * clamp(0.25 + 1.2 * (st?.rain ?? 1), 0, 1);
      // low over breaking seas: spray + salt («Висение ниже 8 м над бурунами»)
      const alt = heli?.altitude ?? 99;
      const rough = (pal?.sea?.whitecaps || 0) > 0.08 || (st?.waveHeight || 0) > 1.6;
      if (!paused && alt < 8 && rough && !heli?.landed && heli?.alive !== false) {
        p.sprayCd -= dt;
        if (p.sprayCd <= 0) {
          p.sprayCd = 1.2 + this.rng.next() * 1.5;
          this.drops.spray(0.25 + 0.25 * (1 - alt / 8));
        }
        if (speed < 8) p.salt = clamp(p.salt + gdt * 0.06, 0, 1);
      }
      // light-rain / dry presets keep only a few beads; rain left over from a previous preset clears
      // quickly, except the slow drying that is part of the clearing look
      const cap = (P?.drops || 0) < 0.2 ? 6 : 0;
      const dryK = st?.preset === 'clearing' ? 1 : 3.5;
      this.drops.update(gdt, rate, speed, this._flow.x, this._flow.y, rivulets, cap, dryK);
      this.drops.upload();
      u.uDrops.value = this.drops.count > 0 ? 1 : 0;
      u.uFlow.value.copy(this._flow);
    } else {
      u.uDrops.value = 0;
    }
    const fogginess = st?.fog || 0;
    u.uCondense.value = rivulets ? clamp((fogginess - 0.5) / 0.5, 0, 1) * 0.9 : 0;
    u.uSalt.value = rivulets ? p.salt : 0;
  }

  render(dt) {
    const c = this.composer;
    this.thermal.render(this.ctx.renderer, this.ctx.scene, this.ctx.camera);
    // keep the scene pass on the MSAA target, display passes on the plain one
    c.readBuffer = this.rtScene;
    c.writeBuffer = this.rtPost;
    c.renderTarget1 = this.rtScene;
    c.renderTarget2 = this.rtPost;
    c.render(dt);
    if (this.photo.saveRequested) this.photo.capture(this.ctx.renderer.domElement);
  }
}

// THREE.Color (linear) → Vector3 of sRGB-encoded components.
function setSRGB(outVec3, color, tmp) {
  tmp.copy(color).convertLinearToSRGB();
  outVec3.set(tmp.r, tmp.g, tmp.b);
  return outVec3;
}
