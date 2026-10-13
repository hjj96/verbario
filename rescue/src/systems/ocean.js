// Ocean — the canvas of the game (DESIGN §1.1 "Море — холст", §2.6, §2.7.2).
//
// * Warped camera-following grid (ocean/grid.js), fixed Gerstner bank whose amplitudes follow
//   weather.state.palette.sea (ocean/waves.js), big features (ocean/features.js).
// * MeshStandardMaterial + onBeforeCompile (ocean/material.js, ocean/shaders.js): the water keeps
//   three.js lighting (sun shadow, heli SpotLight, pooled PointLights) and adds 17 look layers.
// * Water memory render target (ocean/memory.js) for foam trails, dye, bioluminescent wakes.
// * CPU mirror: heightAt / normalAt / velocityAt match the GPU surface (ocean/selftest.js).
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { WaveBank, QUALITY, smoothstep } from './ocean/waves.js';
import { FeatureSet } from './ocean/features.js';
import { buildOceanGrid, snapQuantum } from './ocean/grid.js';
import { createOceanUniforms, createOceanMaterial, oceanDefines } from './ocean/material.js';
import { WaterMemory } from './ocean/memory.js';
import { oceanSelfTest } from './ocean/selftest.js';

const MEMORY_EXTENT = 320; // m
const MAX_SPLASHES = 24;
const MAX_GLINTS = 8;
const FLASH_DAY = new THREE.Color('#DCE6FF');
const FLASH_NIGHT = new THREE.Color('#C7D6FF');
const DEG = Math.PI / 180;

function setC(uni, c, fallback) {
  if (c && c.isColor) uni.value.copy(c);
  else if (fallback !== undefined) uni.value.set(fallback);
}
const lum = (c) => (c && c.isColor ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0.5);
const angDiff = (x, y) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));

// Used when weather.state.palette.sea is missing (stub weather): derived from waveHeight.
const FALLBACK_SEA = { Hs: 0.6, swellAdd: 0.4, Q: 0.3, detail: 0.3, whitecaps: 0, streaks: 0, foamLines: 0, roughness: 0.06 };

export class Ocean {
  constructor(ctx) {
    this.ctx = ctx;
    this.bank = new WaveBank();
    this.features = new FeatureSet();
    this.bank.features = this.features;
    this.uniforms = createOceanUniforms(ctx.look, this.bank, this.features);

    this.focus = new THREE.Vector2(); // world point under the screen centre
    this.bioluminescence = 1; // 0..1 multiplier (× night); missions may lower it
    // Art-direction multipliers (debug / live tuning from the console; 1 = DESIGN values).
    this.tune = { detail: 1, whitecaps: 1, cloudShadow: 1, sss: 1, look: 1, glitter: 1 };
    this.memory = null;

    // splash pool (analytic rings)
    this._spl = { x: new Float32Array(MAX_SPLASHES), z: new Float32Array(MAX_SPLASHES), t0: new Float32Array(MAX_SPLASHES).fill(-1e9),
      r: new Float32Array(MAX_SPLASHES), s: new Float32Array(MAX_SPLASHES), next: 0 };
    // glints collected during the frame, uploaded right before the ocean renders
    this._gl = { x: new Float32Array(MAX_GLINTS), z: new Float32Array(MAX_GLINTS), r: new Float32Array(MAX_GLINTS),
      i: new Float32Array(MAX_GLINTS), c: new Float32Array(MAX_GLINTS * 3), n: 0 };
    this._tmpColor = new THREE.Color();
    // searchlight state (CPU mirror for searchlightAt)
    this._search = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), cosOuter: 0.95, i: 0, lastFrame: -1e9 };
    this._dwCalled = false;
    this._streak = { a: 0, b: 0, mix: 0 };
    this._detOff = new THREE.Vector4();
    this._windOffSeen = new THREE.Vector2(NaN, NaN);
    this._windTmp = new THREE.Vector2();
    this._fwd = new THREE.Vector3();
    this._camPos = new THREE.Vector3();

    this._buildMesh(ctx.settings.get('quality'));

    ctx.events.on('mission:setup', ({ def } = {}) => this._reset(def));
    ctx.events.on('weather:preset', (p) => {
      if (p && p.over === 0) this.bank.snap = true;
    });
    ctx.events.on('weather:lightning', (e) => {
      if (!e || e.cloudOnly || !Number.isFinite(e.x)) return;
      this.splash(e.x, e.z, 5, 1);
      this.stamp('scar', e.x, e.z, { radius: 9, strength: 1 });
    });
    ctx.settings.onChange((key) => {
      if (key === 'quality') this._buildMesh(ctx.settings.get('quality'));
    });
  }

  async init() {
    this._ensureMemory();
    this._reset(this.ctx.mission?.def);
    this.update(0);
  }

  // ---------------------------------------------------------------------------------------------
  // construction / quality
  _buildMesh(quality) {
    const q = QUALITY[quality] ? quality : 'high';
    if (this.mesh && q === this.quality) return;
    this.quality = q;
    this.cfg = QUALITY[q];
    this.bank.setQuality(this.cfg.waves, this.cfg.grid);
    this.uniforms.uGridStep.value = 2 / this.cfg.grid;
    this._snapQ = snapQuantum(this.cfg.grid);
    const oldGeo = this.geometry;
    this.geometry = buildOceanGrid(this.cfg.grid);
    if (!this.material) {
      this.material = createOceanMaterial(this.uniforms, oceanDefines(this.cfg, false));
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.name = 'ocean';
      this.mesh.frustumCulled = false;
      this.mesh.receiveShadow = true;
      this.mesh.castShadow = false;
      this.mesh.renderOrder = 10; // after props: the heli/ships occlude water fragments early
      this.mesh.onBeforeRender = () => this._lateUpload();
      this.ctx.scene.add(this.mesh);
    } else {
      this.mesh.geometry = this.geometry;
      oldGeo?.dispose();
      this._ensureMemory();
    }
  }

  _ensureMemory() {
    const want = this.cfg.memory;
    const r = this.ctx.renderer;
    const ok = want > 0 && r && (r.extensions?.has?.('EXT_color_buffer_float') || r.extensions?.has?.('EXT_color_buffer_half_float'));
    if (this.memory && (!ok || this.memory.size !== want)) {
      this.memory.dispose();
      this.memory = null;
    }
    if (ok && !this.memory) {
      const u = this.uniforms;
      this.memory = new WaterMemory(r, want, MEMORY_EXTENT, {
        uFeatCount: u.uFeatCount, uFeatA: u.uFeatA, uFeatB: u.uFeatB, uFeatC: u.uFeatC, uDownwash: u.uDownwash,
      });
    }
    this.uniforms.uMem.value = this.memory ? this.memory.texture : null;
    this.uniforms.uMemWin.value.w = this.memory ? 1 : 0;
    this.material.defines = oceanDefines(this.cfg, !!this.memory);
    this.material.needsUpdate = true;
  }

  _reset(def) {
    const st = this.ctx.weather?.state;
    const wd = st?.windDir;
    const windAngle = wd ? Math.atan2(wd.y, wd.x) : 0;
    const seed = (def && Number.isFinite(def.seed) ? def.seed : 1) | 0;
    // base swell within ±20° of the wind at mission start, seeded
    const off = ((((seed * 2654435761) >>> 0) / 4294967296) * 40 - 20) * DEG;
    this.bank.setSeed(seed + 101, windAngle + off);
    this._streak.a = this._streak.b = windAngle;
    this._streak.mix = 0;
    this.features.clear();
    this._spl.t0.fill(-1e9);
    this.memory?.clear();
    this.bank.snap = true;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    const u = this.uniforms;
    const st = ctx.weather?.state || {};
    const pal = st.palette || {};
    const sea = pal.sea || this._fallbackSea(st);
    const t = ctx.time.t;
    const night = clamp(st.night ?? 0, 0, 1);
    const intensity = clamp(st.intensity ?? 0, 0, 1);

    // wind (weather writes look.setWind; integrate ourselves only if nobody else does)
    const wd = st.windDir;
    const windSpeed = st.windSpeed ?? 0;
    const windAngle = wd ? Math.atan2(wd.y, wd.x) : 0;
    const lookWindOff = ctx.look.uniforms.uWindOffset.value;
    if (dt > 0 && wd && windSpeed > 0.1 && lookWindOff.equals(this._windOffSeen)) {
      ctx.look.setWind(this._windTmp.set(wd.x, wd.y).multiplyScalar(windSpeed), dt);
    }
    this._windOffSeen.copy(lookWindOff);

    // focus point under the screen centre (same formula as the fog patch) → snapped grid offset
    const cam = ctx.camera;
    cam.getWorldPosition(this._camPos);
    cam.getWorldDirection(this._fwd);
    const k = this._camPos.y / Math.max(-this._fwd.y, 0.25);
    this.focus.set(this._camPos.x + this._fwd.x * k, this._camPos.z + this._fwd.z * k);
    const q = this._snapQ;
    const ox = Math.round(this.focus.x / q) * q;
    const oz = Math.round(this.focus.y / q) * q;
    u.uOffset.value.set(ox, oz);

    // clearing look: palette.sea.clearing if weather provides it, else the long-swell signature
    const clearing = clamp(sea.clearing ?? smoothstep(0.8, 1.4, sea.swellAdd ?? 0), 0, 1);
    this.clearing = clearing;
    this.bank.update(dt, t, sea, windAngle, 1 - 0.75 * clearing, ox, oz);
    this.features.update(dt);

    // rotor downwash: heli calls setDownwash every frame; otherwise derive it from the heli state
    if (!this._dwCalled) this._downwashFromHeli();
    this._dwCalled = false;
    // searchlight auto-off if the heli stopped calling (frames, not seconds: robust to hitches)
    if (ctx.time.frame - this._search.lastFrame > 2) this._search.i = 0;

    this._packSplashes(t);
    this._updateLook(st, pal, sea, night, intensity, windAngle, windSpeed, clearing, dt);

    // glints collected last frame were uploaded at render time — start a fresh collection
    this._gl.n = 0;

    if (this.memory && dt > 0) {
      this._autoStamps(dt);
      const w = ctx.look.uniforms.uWind.value;
      this.memory.update(dt, this.focus.x, this.focus.y, w.x, w.y);
      u.uMem.value = this.memory.texture;
      u.uMemWin.value.set(this.memory.center.x, this.memory.center.y, MEMORY_EXTENT, 1);
    }
  }

  _fallbackSea(st) {
    const s = FALLBACK_SEA;
    s.Hs = st.waveHeight ?? 0.6;
    s.Q = 0.25 + 0.6 * clamp(st.waveChoppiness ?? 0.3, 0, 1);
    const i = clamp(st.intensity ?? 0, 0, 1);
    s.detail = 0.25 + 0.75 * i;
    s.whitecaps = 0.55 * smoothstep(0.2, 0.9, i);
    s.streaks = smoothstep(0.5, 0.9, i);
    s.roughness = 0.04 + 0.18 * i;
    return s;
  }

  _downwashFromHeli() {
    const h = this.ctx.heli;
    const d = this.features.downwash;
    if (!h || !h.position || h.alive === false) {
      this.features.setDownwash(d[0], d[1], d[2], 0);
      return;
    }
    const alt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
    const s = clamp(1 - (alt - 4) / 28, 0, 1);
    this.features.setDownwash(h.position.x, h.position.z, 9 + 0.35 * Math.max(0, alt), s * s * clamp(h.rotorRPM ?? 1, 0, 1));
  }

  // Continuous stamps owned by the ocean itself (downwash ring, disturbance under the rotor).
  _autoStamps(dt) {
    const d = this.features.downwash;
    if (d[3] > 0.01) {
      const s = d[3];
      this.memory.push('ring', d[0], d[1], d[2] * 1.15, 0.18 * s * dt, 1, 0, 0.6, 0, 0.82);
      this.memory.push('disc', d[0], d[1], d[2] * 0.9, 1.6 * s * dt, 0, 0, 1, 0);
    }
  }

  _packSplashes(t) {
    const sp = this._spl;
    const U = this.uniforms.uSplash.value;
    const S = this.uniforms.uSplashS.value;
    let n = 0;
    for (let i = 0; i < MAX_SPLASHES; i++) {
      const age = t - sp.t0[i];
      const life = 1.4 + 0.3 * sp.r[i];
      if (age < 0 || age >= life) continue;
      U[n * 4] = sp.x[i];
      U[n * 4 + 1] = sp.z[i];
      U[n * 4 + 2] = age;
      U[n * 4 + 3] = sp.r[i];
      S[n] = sp.s[i];
      n++;
    }
    this.uniforms.uSplashCount.value = n;
  }

  _updateLook(st, pal, sea, night, intensity, windAngle, windSpeed, clearing, dt) {
    const u = this.uniforms;
    setC(u.uDeep, pal.deep, '#0B3B4E');
    setC(u.uBody, pal.body, '#17586A');
    setC(u.uCrest, pal.crest, '#4FB3AC');
    setC(u.uShallow, pal.shallow, '#3FA79E');
    setC(u.uFoamCol, pal.foam, '#F1F4EE');
    setC(u.uSkyCol, pal.sky, '#8FB3C9');
    setC(u.uFogCol, pal.fogColor, '#D9CDBB');
    setC(u.uSunCol, pal.sun, '#FFD9A8');
    setC(u.uSpecCol, pal.spec, '#FFE9C6');
    setC(u.uAmbCol, pal.ambient, '#A9C3D3');
    setC(u.uShadowTint, pal.shadowTint, '#12313D');
    if (st.flashColor && st.flashColor.isColor) u.uFlashCol.value.copy(st.flashColor);
    else u.uFlashCol.value.copy(FLASH_DAY).lerp(FLASH_NIGHT, night);
    const sv = st.sunDirVisual || st.sunDir;
    if (sv) u.uSunDirV.value.copy(sv).normalize();
    // stable (cheated) shadow sun for N·L shading; weather.state.sunDir also swings to lightning
    const sd = st.sunDirShadow || st.sunDir || sv;
    if (sd) u.uSunDirS.value.copy(sd).normalize();

    // Weather supplies most look parameters in the palette (extras beyond the contract); every one
    // has a fallback derived from the contract fields so the sea also works with a stub weather.
    const sunI = pal.sunIntensity ?? 1;
    const shadowI = clamp(pal.shadowIntensity ?? 0.5, 0, 1);
    const rain = clamp(st.rain ?? 0, 0, 1);
    const flash = Math.max(clamp(st.flash ?? 0, 0, 1), this.ctx.look.uniforms.uFlash.value || 0);
    const sunGlit = pal.glitter ?? smoothstep(1.2, 2.2, sunI) * (1 - night);
    // a moon path on clear nights («Лунная дорожка»): the moon is the "sun" of night presets
    const moonGlit = night * smoothstep(0.2, 0.35, sunI) * (1 - intensity) * 0.35;
    const glitter = this.cfg.q > 0 ? Math.max(sunGlit, moonGlit) * (1 - rain) : 0;
    const cloudRefl = sea.cloudReflect ?? sunGlit * (1 - rain) * (0.35 * (1 - clearing) + 0.1 * clearing);
    const cloudShadow = (pal.cloudShadow !== undefined ? Math.abs(pal.cloudShadow) : shadowI) * (1 - night);
    const sss = pal.sss ?? 0.5 + 0.3 * intensity;
    // layer 8 «матовое олово»: +0.3·rain, unless the palette already folded rain into roughness
    const rough = (sea.roughness ?? 0.06) + Math.max(0, 0.3 - (sea.roughnessRain ?? 0)) * rain;

    const tn = this.tune;
    u.uSeaA.value.set((sea.detail ?? 0.3) * tn.detail, (sea.whitecaps ?? 0) * tn.whitecaps, sea.streaks ?? 0, sea.foamLines ?? 0);
    u.uSeaB.value.set(rough, sss * tn.sss, clearing, sunI);
    u.uSeaC.value.set(cloudRefl, cloudShadow * tn.cloudShadow, shadowI, glitter * tn.glitter);
    const resid = Math.max(this.features.residual, 0.5 * clearing);
    const bio = this.cfg.q > 0 ? clamp(this.bioluminescence, 0, 1) * smoothstep(0.5, 0.9, night) : 0;
    const glitExp = pal.glitterExp ?? 600 + (120 - 600) * clearing;
    // the sun's glitter is lifted (+1.2) into the top-down frame (DESIGN layer 13); the moon path
    // keeps close to its real geometry (+0.35) with a tight lobe, so it stays a path, not a starfield
    const moonK = moonGlit > sunGlit ? 1 : 0;
    u.uSeaD.value.set(glitExp + (2400 - glitExp) * moonK, 1.2 - 0.85 * moonK, resid, bio);
    // look-driven radiance: share of the sun in the total light, exposure compensation (base
    // exposure only, so the weather's lightning exposure boost still brightens the water)
    const sunPart = sunI * Math.max(u.uSunDirS.value.y, 0.05) * lum(pal.sun);
    const ambPart = (pal.ambientIntensity ?? 0.6) * lum(pal.ambient);
    const exposure = Math.max(pal.exposure ?? this.ctx.renderer.toneMappingExposure ?? 1, 0.05);
    // sun-disk specular: full in calm/clearing, faint under overcast; lightning always glints
    const sunDisk = Math.max(smoothstep(0.6, 2.0, sunI) * (1 - 0.7 * rain), flash);
    u.uLookK.value.set(sunPart / Math.max(sunPart + ambPart, 1e-4), tn.look / exposure, 0.9, sunDisk);
    u.uSeaE.value.set(Math.max(windSpeed, 0.5), flash, night, pal.ambientIntensity ?? 0.6);

    this._updateFront(st, tn);

    const bs = this.bank.stats;
    u.uHsEff.value = bs.HsEff;
    u.uJStats.value.set(bs.K, bs.sigma, bs.crestNorm ?? 1, 0);
    u.uFeatCount.value = this.features.count;

    // detail normal frames: fixed to the mission's base swell, sliding along the wind
    const ba = this.bank.baseAngle;
    const b2 = ba + 37 * DEG;
    u.uDetRot.value.set(Math.cos(ba), Math.sin(ba), Math.cos(b2), Math.sin(b2));
    if (dt > 0 && windSpeed > 0.05) {
      const wx = Math.cos(windAngle), wz = Math.sin(windAngle);
      const o = this._detOff;
      // uv offset = −(frame-space wind direction) · speed · dt / tile
      o.x = (o.x - ((Math.cos(ba) * wx + Math.sin(ba) * wz) * 0.6 * dt) / 14) % 1;
      o.y = (o.y - ((-Math.sin(ba) * wx + Math.cos(ba) * wz) * 0.6 * dt) / 14) % 1;
      o.z = (o.z - ((Math.cos(b2) * wx + Math.sin(b2) * wz) * 1.1 * dt) / 5.5) % 1;
      o.w = (o.w - ((-Math.sin(b2) * wx + Math.cos(b2) * wz) * 1.1 * dt) / 5.5) % 1;
      u.uDetOff.value.copy(o);
    }

    // streak frame follows the wind with hysteresis + 6 s cross-fade (patterns never slide)
    const sk = this._streak;
    if (sk.mix === 0 && angDiff(windAngle, sk.a) > 20 * DEG) {
      sk.b = windAngle;
      sk.mix = 1e-4;
    }
    if (sk.mix > 0) {
      sk.mix = Math.min(1, sk.mix + dt / 6);
      if (sk.mix >= 1) {
        sk.a = sk.b;
        sk.mix = 0;
      }
    }
    u.uStreakRot.value.set(Math.cos(sk.a), Math.sin(sk.a), Math.cos(sk.b), Math.sin(sk.b));
    u.uStreakMix.value = sk.mix;
  }

  // Spatial weather front (DESIGN §2.5 SHOULD): weather.state.front + palettePrev/paletteNext.
  _updateFront(st, tn) {
    const u = this.uniforms;
    const fr = st.front;
    const A = st.palettePrev;
    const B = st.paletteNext;
    if (!fr || !fr.active || !A || !B || !fr.origin || !fr.dir) {
      u.uFrontB.value.z = 0;
      return;
    }
    u.uFront.value.set(fr.origin.x, fr.origin.y, fr.dir.x, fr.dir.y);
    u.uFrontB.value.set((fr.speed ?? 20) * (fr.t ?? 0), Math.max(10, fr.width ?? 120), 1, 0);
    setC(u.uPrevDeep, A.deep, '#0B3B4E');
    setC(u.uPrevBody, A.body, '#17586A');
    setC(u.uPrevCrest, A.crest, '#4FB3AC');
    setC(u.uPrevFoam, A.foam, '#F1F4EE');
    setC(u.uNextDeep, B.deep, '#0B3B4E');
    setC(u.uNextBody, B.body, '#17586A');
    setC(u.uNextCrest, B.crest, '#4FB3AC');
    setC(u.uNextFoam, B.foam, '#F1F4EE');
    const sa = A.sea || {}, sb = B.sea || {};
    u.uPrevSea.value.set((sa.detail ?? 0.3) * tn.detail, (sa.whitecaps ?? 0) * tn.whitecaps, sa.streaks ?? 0, sa.foamLines ?? 0);
    u.uNextSea.value.set((sb.detail ?? 0.3) * tn.detail, (sb.whitecaps ?? 0) * tn.whitecaps, sb.streaks ?? 0, sb.foamLines ?? 0);
  }

  // Values other systems write after ocean.update() (heli, survivors, hazards) — uploaded just
  // before the ocean draws so the water never lags a frame behind the heli or the strobes.
  _lateUpload() {
    const u = this.uniforms;
    const d = this.features.downwash;
    u.uDownwash.value.set(d[0], d[1], d[2], d[3]);
    u.uFeatCount.value = this.features.count;
    const h = this.ctx.heli;
    if (h && h.position && h.alive !== false) {
      const alt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
      u.uHeliP.value.set(h.position.x, h.position.z, alt, 1);
    } else u.uHeliP.value.w = 0;
    const s = this._search;
    u.uSearchPos.value.copy(s.pos);
    u.uSearchDir.value.set(s.dir.x, s.dir.y, s.dir.z, s.cosOuter);
    u.uSearchI.value = s.i;
    // glints: already sorted by intensity, cap per quality
    const g = this._gl;
    const n = Math.min(g.n, this.cfg.glints);
    const G = u.uGlints.value, C = u.uGlintCol.value;
    for (let i = 0; i < n; i++) {
      G[i * 4] = g.x[i];
      G[i * 4 + 1] = g.z[i];
      G[i * 4 + 2] = g.r[i];
      G[i * 4 + 3] = g.i[i];
      C[i * 4] = g.c[i * 3];
      C[i * 4 + 1] = g.c[i * 3 + 1];
      C[i * 4 + 2] = g.c[i * 3 + 2];
    }
    u.uGlintCount.value = n;
  }

  // ---------------------------------------------------------------------------------------------
  // CPU mirror (contract)
  heightAt(x, z, tOffset = 0) {
    return this.bank.heightAt(x, z, tOffset);
  }

  normalAt(x, z, out = new THREE.Vector3(), tOffset = 0) {
    return this.bank.normalAt(x, z, out, tOffset);
  }

  // Orbital surface velocity (Vector2 x/z, or Vector3 incl. vertical). Hazard flows are separate
  // (hazards.surfaceFlowAt); featureFlowAt() gives the swirl the ocean draws.
  velocityAt(x, z, out = new THREE.Vector2(), tOffset = 0) {
    return this.bank.velocityAt(x, z, out, tOffset);
  }

  // Feature part of the sea height (rogue crest, vortex/whirlpool dip). Hazards may use it for
  // waveLiftAt(); heightAt() already includes it.
  featureHeightAt(x, z, tOffset = 0) {
    this.bank.invert(x, z, tOffset);
    return this.features.heightAt(this.bank._px, this.bank._pz, tOffset);
  }

  featureFlowAt(x, z, out = new THREE.Vector2()) {
    return this.features.flowAt(x, z, out);
  }

  // ---------------------------------------------------------------------------------------------
  // writers
  splash(x, z, radius = 2, strength = 1) {
    const sp = this._spl;
    const i = sp.next;
    sp.next = (i + 1) % MAX_SPLASHES;
    sp.x[i] = x;
    sp.z[i] = z;
    sp.r[i] = clamp(radius, 0.3, 20);
    sp.s[i] = clamp(strength, 0, 1.5);
    sp.t0[i] = this.ctx.time.t;
    this.memory?.push('ring', x, z, radius * 2.2, 0.6 * strength, 0.7, 0, 1, 0, 0.6);
    this.memory?.push('disc', x, z, radius * 1.1, 0.8 * strength, 0.8, 0, 0.8, 0);
  }

  setDownwash(x, z, radius, strength) {
    this._dwCalled = true;
    this.features.setDownwash(x, z, radius, strength);
  }

  setSearchlight(pos, dir, cosOuter, intensity = 1) {
    const s = this._search;
    if (pos) s.pos.copy(pos);
    if (dir) s.dir.copy(dir).normalize();
    if (Number.isFinite(cosOuter)) s.cosOuter = clamp(cosOuter, -0.99, 0.99999);
    s.i = clamp(intensity ?? 1, 0, 2);
    s.lastFrame = this.ctx.time.frame;
  }

  // How lit a point at the surface is by the heli searchlight, 0..1 (reflective tape, detection).
  searchlightAt(x, z, y = 0) {
    const s = this._search;
    if (s.i <= 0) return 0;
    const dx = x - s.pos.x, dy = y - s.pos.y, dz = z - s.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1e-3;
    const cs = (dx * s.dir.x + dy * s.dir.y + dz * s.dir.z) / d;
    const rho = Math.acos(clamp(cs, -1, 1)) / Math.max(Math.acos(s.cosOuter), 1e-3);
    return clamp(s.i * (1 - smoothstep(220, 320, d)) * (1 - smoothstep(0.72, 1, rho)), 0, 1);
  }

  // Call every frame per light reflection; the ocean keeps the most intense ones.
  addGlint(x, z, radius, intensity, color) {
    if (!(intensity > 0)) return;
    const g = this._gl;
    let slot;
    if (g.n < MAX_GLINTS) slot = g.n++;
    else {
      if (intensity <= g.i[MAX_GLINTS - 1]) return;
      slot = MAX_GLINTS - 1;
    }
    // insertion sort, descending intensity
    while (slot > 0 && g.i[slot - 1] < intensity) {
      g.x[slot] = g.x[slot - 1];
      g.z[slot] = g.z[slot - 1];
      g.r[slot] = g.r[slot - 1];
      g.i[slot] = g.i[slot - 1];
      g.c[slot * 3] = g.c[slot * 3 - 3];
      g.c[slot * 3 + 1] = g.c[slot * 3 - 2];
      g.c[slot * 3 + 2] = g.c[slot * 3 - 1];
      slot--;
    }
    const c = this._tmpColor;
    if (color && color.isColor) c.copy(color);
    else if (color !== undefined && color !== null) c.set(color);
    else c.setRGB(1, 1, 1);
    g.x[slot] = x;
    g.z[slot] = z;
    g.r[slot] = Math.max(0.2, radius || 1);
    g.i[slot] = intensity;
    g.c[slot * 3] = c.r;
    g.c[slot * 3 + 1] = c.g;
    g.c[slot * 3 + 2] = c.b;
  }

  // Water-memory stamps: 'foam' | 'dye' | 'disturb' | 'oil' | 'scar' | 'ring' | 'wake' | 'splash'.
  // opts: { radius, strength (0..1), dirX, dirZ (wake: direction of motion) }.
  // Without the render target (low quality) foam-like stamps fall back to analytic rings.
  stamp(kind, x, z, opts = {}) {
    const r = opts.radius ?? 3;
    const s = opts.strength ?? 1;
    const m = this.memory;
    if (!m) {
      if (kind === 'scar' || kind === 'splash' || kind === 'ring') this.splash(x, z, r * 0.5, s);
      return;
    }
    switch (kind) {
      case 'foam': m.push('disc', x, z, r, s, 1, 0, 0.3, 0); break;
      case 'dye': m.push('disc', x, z, r, s, 0, 1, 0, 0); break;
      case 'disturb': m.push('disc', x, z, r, s, 0, 0, 1, 0); break;
      case 'oil': m.push('disc', x, z, r, s, 0, 0, 0, 1); break;
      case 'ring': m.push('ring', x, z, r, s, 1, 0, 0.7, 0, opts.inner ?? 0.75); break;
      case 'scar':
        m.push('ring', x, z, r, 1.2 * s, 1, 0, 1, 0, 0.7);
        m.push('disc', x, z, r * 0.6, s, 1, 0, 1, 0);
        break;
      case 'splash':
        m.push('ring', x, z, r, s, 0.8, 0, 1, 0, 0.6);
        m.push('disc', x, z, r * 0.5, s, 0.9, 0, 1, 0);
        break;
      case 'wake': {
        const l = Math.hypot(opts.dirX ?? 0, opts.dirZ ?? 0);
        if (l > 1e-4) m.push('wake', x, z, r, s, 1, 0, 0.8, 0, 0, opts.dirX / l, opts.dirZ / l);
        else m.push('disc', x, z, r * 0.4, s, 1, 0, 0.8, 0);
        break;
      }
      default: break;
    }
  }

  // Foam trail point for something moving through the water (boats, swimmers). Call per frame.
  addWake(x, z, strength = 1, dirX, dirZ) {
    const m = this.memory;
    const dt = this.ctx.time.dt;
    if (!m || !(dt > 0)) return;
    const s = clamp(strength, 0, 3);
    if (Number.isFinite(dirX) && Number.isFinite(dirZ) && (dirX || dirZ)) {
      const l = Math.hypot(dirX, dirZ);
      // a faint V per frame: as the boat moves the stamps add up to a Kelvin wake (19.47°)
      m.push('wake', x, z, 8 + 6 * s, 0.35 * s * dt, 1, 0, 1, 0, 0, dirX / l, dirZ / l);
    } else {
      m.push('disc', x, z, 0.8 + 1.2 * s, 1.2 * s * dt, 1, 0, 1, 0);
    }
  }

  setFeature(id, f) {
    return this.features.set(id, f || {});
  }

  removeFeature(id) {
    this.features.remove(id);
  }

  // ≤ 8 [{x, z, radius}] rocks / shallows (world calls).
  setShoals(list) {
    const arr = this.uniforms.uShoals.value;
    arr.fill(0);
    const shoals = [];
    for (const s of list || []) {
      if (shoals.length >= 8) break;
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const r = Math.max(0.5, s.radius ?? s.r ?? 5);
      const j = shoals.length * 4;
      arr[j] = s.x;
      arr[j + 1] = s.z;
      arr[j + 2] = r;
      arr[j + 3] = 1;
      shoals.push({ x: s.x, z: s.z, r });
    }
    this.bank.shoals = shoals;
    this.uniforms.uShoalCount.value = shoals.length;
  }

  // Jump wave amplitudes to the current targets (tests, instant preset switches).
  snapWaves() {
    this.bank.snap = true;
  }

  get waveStats() {
    return this.bank.stats;
  }

  // CPU ↔ GPU agreement report (async: GPU readback). e.g. __game.ocean.selfTest().then(console.log)
  selfTest(opts) {
    return oceanSelfTest(this, opts);
  }
}
