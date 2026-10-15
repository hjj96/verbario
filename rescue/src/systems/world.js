// World — places and props (DESIGN §2.11, §3.9, §2.7.2–2.7.3, catalogue #15, #31, #43–47).
//
// Rebuilt from def.world on 'mission:setup':
//   pads    lighthouse «Скалистый» (12 m, fuel 10 %/s, repair 4 %/s, resupply), rescue ship «Арктур»
//           (moving 3–5 m/s, 9 m, fuel 6 %/s, resupply, deck tilt), rig «Северная-7» (32 m, fuel
//           10 %/s, lee turbulence wedge, lower deck at 22 m for 'deck' survivors)
//   props   rocks (displaced icosahedra + surf via ocean.setShoals), debris fields, containers,
//           buoys with real light rhythms, scenery boats, rubber ducks (1 in 20, NICE), 27 Dec banner.
//
// Draw calls (typical mission): lighthouse 1 + beams 1, ship 1 + flood cones 1, rig 1 + flame 1,
// rocks 1, boats 1 each, floaters 1 per shape in use (+ keylines on high), rigging 1, collars 1,
// lamps 1 → ~12–20, plus shadow passes for the solid ones.
// Lights (CONTRACT budget 2, created once, intensity only): lighthouse SpotLight, deck PointLight.
//
// Public API beyond the contract: pads[].{pitch, roll, up, place, leeLength, leeNoise, flare,
// lowerDeck}, obstacles[].{kind, name}, world.places, world.ship / lighthouse / rig (first of each),
// world.channels (lamp channel values), world.env, deckAt(x, z) (rig open lower deck → y or −Infinity),
// events 'world:slam' {x, z, strength}.
import * as THREE from 'three';
import { CH, createShared, createPropMaterial, createBeamMaterial, createFlameMaterial } from './world/materials.js';
import { Lamps } from './world/lamps.js';
import { Rigging } from './world/rigging.js';
import { Collars } from './world/contact.js';
import { Floaters, buoyRhythm, BUOY_KINDS } from './world/floaters.js';
import { Lighthouse } from './world/lighthouse.js';
import { Ship } from './world/ship.js';
import { Rig } from './world/rig.js';
import { Boat } from './world/boats.js';
import { bake, rockGeometry, rng, SURF } from './world/geo.js';
import { createRockField, updateLandforms, landformsQuality } from './world/landforms.js';
import { clamp, smoothstep } from '../core/math.js';

const SERVICES = {
  lighthouse: { fuel: 10, repair: 4, resupply: true },
  ship: { fuel: 6, repair: 0, resupply: true },
  rig: { fuel: 10, repair: 0, resupply: false },
  coast: { fuel: 10, repair: 4, resupply: true },
};
const HEIGHT = { lighthouse: 12, ship: 9, rig: 32 };

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.look = ctx.look;
    this.pads = [];
    this.obstacles = [];
    this.places = [];
    this.boats = [];
    this.ship = null;
    this.lighthouse = null;
    this.rig = null;

    this.root = new THREE.Group();
    this.root.name = 'world';
    ctx.scene.add(this.root);

    const look = this.look;
    this.shared = createShared();
    this.channels = this.shared.uChan.value;
    this.mats = {
      plain: createPropMaterial(look, this.shared, { name: 'plain' }),
      floater: createPropMaterial(look, this.shared, { name: 'floater', wear: 'medium' }),
      beam: createBeamMaterial(look, this.shared, { color: '#FFF4DC' }),
      flood: createBeamMaterial(look, this.shared, { color: '#FFE6B0' }),
      flame: createFlameMaterial(look),
      keyline: look.keyline({ color: '#05090B', opacity: 0.55, px: 1 }),
    };
    this.mats.flood.uniforms.uFall.value = 0.9;
    this.mats.flood.uniforms.uPen.value = 0.7;

    this.lamps = new Lamps(look, this.shared);
    this.rigging = new Rigging(look, this.mats.plain);
    this.collars = new Collars(look, this.shared);
    this.root.add(this.lamps.mesh, this.rigging.mesh, this.collars.mesh);
    this.floaters = new Floaters(this);
    this.rocks = null;

    // Lights from the world's budget — created once; only intensity changes afterwards.
    const spot = new THREE.SpotLight('#FFF4DC', 0, 950, 0.085, 0.65, 1.35);
    spot.castShadow = false;
    const spotTarget = new THREE.Object3D();
    spot.target = spotTarget;
    const point = new THREE.PointLight('#FFE6B0', 0, 60, 2);
    point.castShadow = false;
    point.position.set(0, -50, 0);
    this.root.add(spot, spotTarget, point);
    this.lights = { spot, spotTarget, point };
    this.spotOwner = null;
    this.pointOwner = null;

    // Per-frame environment shared with the places (reused objects, no per-frame allocations).
    const wtmp = new THREE.Vector2();
    this.env = {
      t: 0,
      dt: 0,
      night: 0,
      fogK: 0,
      haze: 0,
      rain: 0,
      intensity: 0,
      visibility: 20000,
      Hs: 0.5,
      flash: 0,
      lightsOn: 0,
      reduceFlashes: false,
      wind: new THREE.Vector2(),
      windDir: new THREE.Vector2(1, 0),
      current: new THREE.Vector2(),
      focus: new THREE.Vector2(),
      camPos: new THREE.Vector3(),
      heliPos: new THREE.Vector3(),
      windAt: (x, z) => {
        const w = this.ctx.weather;
        if (w?.windAt) return w.windAt(x, z, wtmp);
        return wtmp.copy(this.env.wind);
      },
    };
    this._col = new THREE.Color();
    this._fwd = new THREE.Vector3();
    this._shoals = [];
    this._shoalSel = [];
    this._shoalT = 0;
    this._shoalCmp = (a, b) => a._d - b._d;
    this._unload = { pad: null, t: 0 };

    ctx.events.on('mission:setup', ({ def } = {}) => this._setup(def));
    ctx.events.on('heli:land', ({ pad } = {}) => {
      this._unload.pad = pad || null;
    });
    ctx.events.on('heli:takeoff', () => {
      this._unload.pad = null;
      this._unload.t = 0;
    });
    ctx.events.on('heli:unload-person', ({ pad } = {}) => {
      this._unload.pad = pad || this._unload.pad;
      this._unload.t = 1.6;
    });
    ctx.events.on('heli:unload', ({ pad } = {}) => {
      this._unload.pad = pad || this._unload.pad;
      this._unload.t = Math.max(this._unload.t, 1.2);
    });
    ctx.settings.onChange((key) => {
      if (key === 'quality') this._applyQuality();
    });
  }

  async init() {
    this._refreshEnv(0);
    // A def may already exist (mission set up before us) — otherwise wait for 'mission:setup'.
    if (!this.places.length && this.ctx.mission?.def) this._setup(this.ctx.mission.def);
  }

  // ---------------------------------------------------------------------------------------------
  // CONTRACT API
  padAt(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.pads) {
      const d = Math.hypot(p.position.x - x, p.position.z - z);
      if (d < p.radius && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // Height of a walkable structure deck under (x, z) that is not a pad (the rig's open lower deck at
  // 22 m), or −Infinity. The winch counts its height window from it and the basket stops on it.
  deckAt(x, z) {
    let y = -Infinity;
    for (const pl of this.places) {
      const d = pl.lowerDeck;
      if (d && d.x0 !== undefined && x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1 && d.y > y) y = d.y;
    }
    return y;
  }

  nearestPad(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.pads) {
      const d = Math.hypot(p.position.x - x, p.position.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------
  _clear() {
    for (const pl of this.places) pl.dispose();
    for (const b of this.boats) b.dispose();
    this.places.length = 0;
    this.boats.length = 0;
    this.pads = [];
    this.obstacles = [];
    this.ship = this.lighthouse = this.rig = null;
    this.lamps.clear();
    this.floaters.clear();
    if (this.rockField) {
      this.rockField.dispose();
      this.rockField = null;
      this.rocks = null;
    }
    this._shoals.length = 0;
    this._unload.pad = null;
    this._unload.t = 0;
  }

  _setup(def) {
    if (!def) return;
    this._clear();
    this._refreshEnv(0);
    const world = def.world || {};
    const props = world.props || {};
    const padDefs = Array.isArray(world.pads) ? world.pads : [];

    padDefs.forEach((pd, i) => {
      if (!pd) return;
      const type = pd.type || 'ship';
      let place = null;
      if (type === 'lighthouse') place = new Lighthouse(this, pd);
      else if (type === 'rig') place = new Rig(this, pd);
      else if (type === 'ship') place = new Ship(this, pd, i);
      if (!place) place = new Lighthouse(this, pd); // 'coast' and unknown types: a fixed pad with services
      this.places.push(place);
      if (place instanceof Ship) this.ship = this.ship || place;
      if (place instanceof Lighthouse) this.lighthouse = this.lighthouse || place;
      if (place instanceof Rig) this.rig = this.rig || place;
      place.setUnloadChannel(CH.UNLOAD0 + Math.min(i, 2));
      const ship = place instanceof Ship;
      const pad = {
        id: i,
        name: pd.name || place.name || 'Площадка',
        type,
        position: place.padPosition,
        radius: place.padRadius,
        height: HEIGHT[type] ?? place.padPosition.y,
        tilt: 0,
        pitch: 0,
        roll: 0,
        up: ship ? place.up : new THREE.Vector3(0, 1, 0),
        velocity: ship ? place.padVelocity : new THREE.Vector3(),
        heading: ship ? place.nav.heading : pd.heading || 0,
        refuel: true,
        services: { ...(SERVICES[type] || SERVICES.coast) },
        lee: type === 'rig',
        object3d: place.group,
        place,
      };
      if (type === 'rig') {
        pad.leeLength = 150; // DESIGN §3.9: lee wedge 150 m downwind, +4 m/s noise
        pad.leeNoise = 4;
        pad.flare = place.flameCenter; // updraft +4 m/s in the plume (hazards)
        pad.lowerDeck = place.lowerDeck;
      }
      this.pads.push(pad);
      for (const o of place.obstacles) this.obstacles.push(o);
      if (place.shoals) this._shoals.push(...place.shoals);
    });

    // Scenery places requested by props without a matching pad.
    if (props.lighthouse && !this.lighthouse) {
      const lh = new Lighthouse(this, { x: props.lighthouse.x || 0, z: props.lighthouse.z || 0, name: 'Скалистый' });
      this.places.push(lh);
      this.lighthouse = lh;
      for (const o of lh.obstacles) this.obstacles.push(o);
      this._shoals.push(...lh.shoals);
    }
    if (props.rig && !this.rig && typeof props.rig === 'object') {
      const rig = new Rig(this, { x: props.rig.x || 0, z: props.rig.z || 0 });
      this.places.push(rig);
      this.rig = rig;
      for (const o of rig.obstacles) this.obstacles.push(o);
    }

    // Rocks (fog pinnacles, reefs): a mesh per rock, obstacles, surf. A boat aground gets a low
    // drying ledge under its bow (heading convention: forward = (sin h, −cos h)).
    const ledges = (props.boats || []).filter((b) => b.aground).map((b) => {
      const h = b.heading || 0;
      return { x: b.x + Math.sin(h) * 12, z: b.z - Math.cos(h) * 12, radius: 12, height: 2.2, name: b.name ? 'камни' : 'риф' };
    });
    this._buildRocks([...(props.rocks || []), ...ledges], def.seed || 1);

    // Scenery boats.
    (props.boats || []).forEach((b, i) => {
      const boat = new Boat(this, b, i);
      this.boats.push(boat);
      for (const o of boat.obstacles) this.obstacles.push(o);
    });

    // Floating props.
    this.floaters.setup(props, def.seed || 1, this.ctx.settings.detail?.() ?? 1);
    this.current = def.current || null;
    this._applyQuality();
    this._shoalT = 0;
    this._updateShoals(true);
  }

  // Rocks (fog pinnacles, reefs, «Кошки»): one granite heightfield + boulders per rock, culled per
  // rock (world/landforms.js); obstacles keep the defined radius/height, surf rings hug the coastline.
  _buildRocks(list, seed) {
    if (!list.length) return;
    this.rockField = createRockField(this, list, seed, this.ctx.settings.get('quality'));
    this.rocks = this.rockField.group;
    this.root.add(this.rockField.group);
    for (const o of this.rockField.obstacles) this.obstacles.push(o);
    this._shoals.push(...this.rockField.shoals);
  }

  _applyQuality() {
    const q = this.ctx.settings.get('quality');
    // no toon keylines on floaters (one realistic style): separation comes from the contact disc,
    // foam collar, rim light and shadows instead (people keep theirs at night — survivors.js)
    this.floaters.setKeylines(false);
    // no bloom on low: lamps carry their own halos (scaled by daylight in _channels)
    this._haloBase = q === 'low' ? 0.5 : 0.28;
    this.shared.uLampK.value.set(1, this._haloBase, 1);
    this.quality = q;
    landformsQuality(this, q);
  }

  // Keep the 8 shoals nearest to the camera focus in the ocean's surf uniforms.
  _updateShoals(force = false) {
    const ocean = this.ctx.ocean;
    if (!ocean?.setShoals) return;
    const all = this._shoals;
    const sel = this._shoalSel;
    sel.length = 0;
    const f = this.env.focus;
    for (const s of all) {
      s._d = Math.hypot(s.x - f.x, s.z - f.y) - s.radius;
      sel.push(s);
    }
    sel.sort(this._shoalCmp);
    if (sel.length > 8) sel.length = 8;
    let key = sel.length;
    for (let i = 0; i < sel.length; i++) key += (sel[i].x * 31.7 + sel[i].z * 17.3) * (i + 1);
    if (force || key !== this._shoalKey) {
      this._shoalKey = key;
      ocean.setShoals(sel);
    }
  }

  // ---------------------------------------------------------------------------------------------
  _refreshEnv(dt) {
    const ctx = this.ctx;
    const env = this.env;
    const st = ctx.weather?.state || {};
    const pal = st.palette || {};
    env.dt = dt;
    env.t = ctx.time.t;
    env.night = clamp(st.night ?? 0, 0, 1);
    env.rain = clamp(st.rain ?? 0, 0, 1);
    env.intensity = clamp(st.intensity ?? 0, 0, 1);
    env.visibility = st.visibility ?? 20000;
    // real fog only (the storm presets carry a 0.45–0.55 haze in state.fog — that is not «туман»)
    env.haze = clamp(st.fog ?? 0, 0, 1);
    env.fogK = clamp(Math.max(smoothstep(0.6, 0.95, env.haze), smoothstep(650, 250, env.visibility)), 0, 1);
    env.Hs = pal.sea?.Hs ?? st.waveHeight ?? 0.5;
    env.flash = st.flash ?? 0;
    env.reduceFlashes = !!ctx.settings.get('reduceFlashes');
    const wd = st.windDir;
    if (wd) env.windDir.copy(wd);
    env.wind.copy(env.windDir).multiplyScalar(st.windSpeed ?? 0);
    if (this.current) env.current.set(this.current.x || 0, this.current.z || 0);
    else env.current.set(0, 0);
    env.lightsOn = smoothstep(0.2, 0.65, Math.max(env.night, env.fogK * 0.85, env.rain * 0.55, env.intensity * 0.5));
    // camera + focus point under the screen centre (same formula as the fog patch)
    const cam = ctx.camera;
    cam.getWorldPosition(env.camPos);
    cam.getWorldDirection(this._fwd);
    const k = env.camPos.y / Math.max(-this._fwd.y, 0.25);
    env.focus.set(env.camPos.x + this._fwd.x * k, env.camPos.z + this._fwd.z * k);
    const hp = ctx.heli?.position;
    if (hp) env.heliPos.copy(hp);
    else env.heliPos.set(env.focus.x, 40, env.focus.y);

    // shared material uniforms
    const S = this.shared;
    // day rim (DESIGN §2.7.3); at night a faint moonlit rim keeps silhouettes off pure black
    if (pal.ambient?.isColor) S.uRim.value.copy(pal.ambient).multiplyScalar(1 - env.night);
    if (pal.sun?.isColor) S.uRim.value.add(this._col.copy(pal.sun).multiplyScalar(0.55 * env.night));
    S.uCloudK.value = clamp(pal.shadowIntensity ?? 0.5, 0, 1) * (1 - env.night);
    if (pal.foam?.isColor) S.uFoamCol.value.copy(pal.foam);
    S.uScatter.value = clamp(env.fogK + 0.5 * env.rain + 0.25 * env.haze, 0, 1);
    S.uNightK.value = env.night;
    const fog = ctx.scene.fog;
    if (fog && fog.isFog) {
      S.uFogNear.value = fog.near;
      S.uFogFar.value = fog.far;
    }
  }

  // Trailing wake streaks (contact.js pushWake) from motion RELATIVE to the water only: the current
  // running past a moored buoy. A free floater drifts with the current and its 3 % leeway makes no
  // visible wake, so it gets none (a flat streak sheet beside a container read as a pane of glass).
  _wakes(env) {
    const items = this.floaters.items;
    if (!items || !items.length) return;
    const cur = env.current, f = env.focus;
    if (cur.x * cur.x + cur.y * cur.y < 0.0225) return;
    const foam = 0.8 * smoothstep(3, 1.2, env.Hs || 0); // a flat streak would cut into big swells
    if (foam <= 0) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.moored || !(it.R > 0) || !Number.isFinite(it.h)) continue;
      if (Math.abs(it.x - f.x) + Math.abs(it.z - f.y) > 360) continue;
      this.collars.pushWake(it.x, it.h, it.z, it.R, cur.x, cur.y, foam, it.phase || 0);
    }
  }

  // Lamp / emissive channels: rhythms and day/night levels (DESIGN §2.4, §2.8 photosensitivity).
  _channels(dt) {
    const c = this.channels;
    const env = this.env;
    const t = env.t;
    const on = env.lightsOn;
    const red = env.reduceFlashes;
    c[CH.ALWAYS] = 1;
    c[CH.WINDOWS] = 0.04 + 0.96 * smoothstep(0.15, 0.7, Math.max(env.night, env.fogK * 0.6, env.intensity * 0.55));
    // daylight: deck LEDs barely register in the sun and no lamp shows a halo — halos are light
    // scattered by dark air, fog and rain; they return as the lights come on
    c[CH.PERIM] = 0.15 + 0.85 * on;
    this.shared.uLampK.value.y = (this._haloBase ?? 0.28) * smoothstep(0.05, 0.5, on);
    c[CH.FLOOD] = on;
    c[CH.NAV] = 0.45 + 0.55 * on;
    c[CH.PADLIGHT] = on;
    c[CH.DIM] = 0.25 + 0.75 * on;
    c[CH.WANDS] = 0.7 + 0.3 * on;
    c[CH.BOAT] = 0.3 + 0.7 * on;
    // red obstruction flashers: 1 Hz, soft edges; reduceFlashes → 40 %, smooth
    c[CH.ANTI] = red ? 0.4 * (0.6 + 0.4 * Math.sin(t * Math.PI)) : (0.5 + 0.5 * on) * smoothstep(-0.2, 0.2, Math.sin(t * Math.PI * 2));
    // ship masthead beacon: 0.12 s flash every 2 s
    c[CH.BEACON] = red ? 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI)) : (t % 2 < 0.12 ? 1 : 0) * (0.5 + 0.5 * on);
    // patrol blue flasher: double flash every 1.5 s
    const pb = t % 1.5;
    c[CH.BLUE] = red ? 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI)) : pb < 0.08 || (pb > 0.2 && pb < 0.28) ? 1 : 0;
    for (let k = 0; k < BUOY_KINDS.length; k++) c[CH.BUOY0 + k] = buoyRhythm(BUOY_KINDS[k], t + k * 1.7, red) * (0.45 + 0.55 * on);
    // blue offload lights: blink on the pad while people are carried off
    const u = this._unload;
    if (dt > 0) u.t = Math.max(0, u.t - dt);
    for (let i = 0; i < 3; i++) c[CH.UNLOAD0 + i] = 0;
    if (u.pad && u.t > 0) {
      const ch = CH.UNLOAD0 + Math.min(u.pad.id ?? 0, 2);
      c[ch] = red ? 0.7 : Math.sin(t * Math.PI * 4) > -0.2 ? 1 : 0.12;
    }
    // set by the places this frame
    c[CH.LANTERN] = 0;
    c[CH.FLAME] = 0;
    c[CH.CLOUD] = 0;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    this._refreshEnv(dt);
    this._channels(dt);
    const env = this.env;
    this.spotOwner = null;
    this.pointOwner = null;
    this.rigging.begin();
    this.collars.begin();

    for (const pl of this.places) pl.update(dt, env);
    for (const b of this.boats) b.update(dt, env);
    this.floaters.update(dt, env);
    this._wakes(env);
    updateLandforms(env);

    // ship pads: live tilt / heading
    for (const pad of this.pads) {
      const pl = pad.place;
      if (pl instanceof Ship) {
        pad.tilt = pl.motion.tilt;
        pad.pitch = pl.motion.pitch;
        pad.roll = pl.motion.roll;
        pad.heading = pl.nav.heading;
      }
    }

    // Spare deck light: with no ship, the PointLight floods the lighthouse (or rig) pad at night.
    if (!this.pointOwner) {
      const pl = this.lighthouse || this.rig;
      if (pl) {
        this.lights.point.position.set(pl.padPosition.x, pl.padPosition.y + 7, pl.padPosition.z);
        this.lights.point.intensity = 70 * this.channels[CH.PADLIGHT];
      } else this.lights.point.intensity = 0;
    }
    if (!this.spotOwner) this.lights.spot.intensity = 0;

    this.lamps.update();
    this.rigging.end();
    this.collars.end();
    // flood cones are a luxury: off on low
    if (this.quality === 'low') this.mats.flood.uniforms.uIntensity.value = 0;

    this._shoalT -= dt;
    if (this._shoalT <= 0) {
      this._shoalT = 0.5;
      this._updateShoals();
    }
  }
}
