// Survivors — the people we save (CONTRACT: survivors; DESIGN §2.10, §3.5, §3.10, §3.11, §4 #17–27).
//
// Gameplay: groups (swimmer, raft, hull, container, injured, deck, wreck) drift with current + leeway·wind
// + hazard flows + rotor downwash + rogue sweeps, lose warmth (with water temperature, night and
// difficulty multipliers), climb the detection ladder hidden → signal → spotted (crew eyes by weather,
// searchlight 0.4 s, strobes ×3, smoke, flares, dye, mirror, player flares, loudspeaker answers), fire
// their own signals, swim to the basket and to dropped rafts, capsize, sink, jump, and are lifted one by
// one through the pickup protocol (nearestFor → attachToBasket → boardOne).
//
// Look: one instanced person mesh for everybody (survivors/crowd.js) — vests #FF5A00 with two
// retro-reflective bands that flash in the searchlight, strobes, waving arms by distance and warmth,
// the «цветок» ring, faces turned to the heli, forearm against the downwash, slow spin on the cable;
// rafts / hulls / containers / barge / ferry (survivors/craft.js) with foam collars and contact discs
// (survivors/water.js). Draw calls: people 1 + underwater 1 + keylines 1, collars 1, glows 1, lines 1,
// one per craft model in use (craft carry no keylines: weathering, rim and contact foam separate them).
//
// Public API beyond the CONTRACT (all optional for other systems):
//   types                         supported group types (mission/prepare.js reads it)
//   fireSignal(s, kind)           scripted signals: 'rocket' | 'smoke' | 'flare' | 'whistle' | 'dye' | 'mirror'
//   spot(s, by)                   force "spotted" (tests, scripts)
//   byTag(tag) → [groups]         every group carrying a def tag (splits keep the tag)
//   deckAt(x, z) → y | −Infinity  deck height of the structures people stand on (barge, ferry, rig lower
//                                 deck) — the winch can use it as the surface under the basket
//   carriers, lostMarkers, elapsed, rescuedTotal, lostTotal
//   group extras: tag, def, label, name, velocity (Vector3), warmth (= health), critical, signal
//     {kind, x, z, error, arc, t, until} (last «СИГНАЛ»), strobe (flashing now), panic, carrier,
//     inBasket (person record on the cable), deckY, flower (ring of 2+), dwWarn (0..1 downwash danger),
//     pet {kind: 'cat'|'dog', refused} (NICE: def.pet; it leaves with the last person, record.pet)
// Extra events: survivor:capsize {s, cause}, survivor:sinking {s, phase: 'warn'|'sunk'},
//   survivor:jump {s, from}, survivor:creak {s, x, z}, survivor:downwash {s, level: 'push'|'capsize'},
//   survivor:raft-boarded {s}, survivor:tip {s}, survivor:pet {s, pet: 'cat'|'dog', action: 'refuse'|'bark'}.
import * as THREE from 'three';
import { WEAR } from '../core/weathering.js';
import { createRng } from '../core/math.js';
import {
  TYPES, SUPPORTED_TYPES, DIFFICULTY_WARMTH, CRITICAL, LOST_FADE, DETECT, BEAM_SPOT_TIME, BEAM_RANGE,
  FLARE_SPOT_R, FLARE_SPOT_LIFE, STROBE_MULT, SIG, NEAR_WAVE, SEEN_RANGE, SWIM_TO_BASKET, SWIM_SPEED,
  SWIM_TO_RAFT, RAFT_SEATS, DW_PUSH_ALT, DW_CAPSIZE_ALT, DW_CAPSIZE_R, DW_CAPSIZE_T, ROGUE_SWEEP, ROGUE_SWEEP_T,
  CONTAINER_COLORS, SKIN, HOOD, HOOD_COUNT, JACKET, PANTS, PERSON_SCALE, clamp, clamp01, smooth, lerp, wrapAngle, approach,
} from './survivors/tables.js';
import { Crowd, FEET_Y } from './survivors/crowd.js';
import {
  raftGeometry, capsizedHullGeometry, containerGeometry, bargeGeometry, ferryGeometry, trawlerWreckGeometry, stretcherGeometry,
  lostBuoyGeometry, debrisGeometry, DEBRIS_KINDS, createCraftMaterial, CraftBatch, nameDecal, hullNameGeometry, RAFT, CONT, containerPaint, planeGeometry, PLANE,
} from './survivors/craft.js';
import { Collars, Glows, Lines } from './survivors/water.js';
import { InstanceBounds } from './survivors/geo.js';
import { Carrier, scatterDebris } from './survivors/carriers.js';
import { SignalDesk, initSignals, strobeOn } from './survivors/signals.js';
import { POSE, poseTargets, applyPose, variant } from './survivors/poses.js';
import { makeFallbackPeople, conditionFor, quoteFor, guessGender } from './survivors/people.js';
import { markHeat, HeatProxy, thermalBoost } from './survivors/heat.js';
import { Bottle } from './survivors/bottle.js';

const UP = new THREE.Vector3(0, 1, 0);
const S = PERSON_SCALE;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector2();
const _f = new THREE.Vector2();
const _e = new THREE.Euler();
const _slot = [0, 0, 0, 0, 0];
const _pose = [0, 0, 0, 0];
const _col = new THREE.Color();
const C_WHITE = new THREE.Color(1, 1, 1);
const C_STROBE = new THREE.Color('#FFFFFF');
const C_LAMP = new THREE.Color('#F4F8FF');
const C_CHEM = new THREE.Color('#6CFF4A');
const C_MIRROR = new THREE.Color('#FFF6E0');
const C_TAPE = new THREE.Color('#E9F2FF');
const C_FLARE = new THREE.Color('#FF2A12');
const SUPINE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.38);

export class Survivors {
  constructor(ctx) {
    this.ctx = ctx;
    // ---- CONTRACT --------------------------------------------------------------------------------
    this.list = [];
    this.datums = [];
    // ---- extras ----------------------------------------------------------------------------------
    this.types = SUPPORTED_TYPES.slice(); // the Ан-2 is drawn now (planeGeometry), no raft fallback
    this.carriers = [];
    this.lostMarkers = [];
    this.pending = [];
    this.playerFlares = [];
    this.rescuedTotal = 0;
    this.lostTotal = 0;
    this.elapsed = 0;
    this.def = null;
    this.theme = null;
    this.waterTemp = 8;
    this.current = new THREE.Vector2();
    this.rng = createRng(4242);
    this.desk = new SignalDesk(this);
    this._id = 0;
    this._quoteUsed = new Set();
    this.env = {
      t: 0, dt: 0, play: false, night: 0, preset: 'calm', intensity: 0, fogBlind: false, fog: 0,
      windX: 0, windZ: 0, windSpeed: 0, windDirX: 1, windDirZ: 0, windAngle: 0, Hs: 0.5, sunny: false,
      base: 260, altBonus: 1, reduceFlashes: false, thermal: 1,
      heliAlive: false, rotorHeard: false, hx: 0, hy: 40, hz: 0, alt: 40, dwR: 9, dwS: 0,
      wState: 'stowed', bx: 0, by: 0, bz: 0, bH: 99, bWet: false, wLoad: null,
      ghostLight: new THREE.Color(0.4, 0.45, 0.5), foam: new THREE.Color('#E8EEEC'),
    };

    this._buildRender();
    this._warm = 4; // frames of program warm-up (see _warmup)

    const ev = ctx.events;
    ev.on('mission:setup', ({ def } = {}) => this._setup(def));
    ev.on('heli:flare', (p) => {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) this.playerFlares.push({ x: p.x, z: p.z, until: this.ctx.time.t + FLARE_SPOT_LIFE });
    });
    ev.on('heli:loudspeaker', (p) => this._onHorn(p));
    ev.on('heli:raft-drop', (p) => this._onRaftDrop(p));
    ctx.settings.onChange?.((k) => {
      if (k === 'quality') this._applyQuality();
    });
    this._applyQuality();
  }

  async init() {
    // A mission may already be set up (systems are constructed before mission.init runs, so this is
    // normally empty) — nothing else to do: everything is built in the constructor.
  }

  // ==============================================================================================
  // Rendering objects (created once; per-frame work only rewrites instance buffers)
  _buildRender() {
    const ctx = this.ctx;
    const look = ctx.look;
    const root = (this.root = new THREE.Group());
    root.name = 'survivors';
    ctx.scene.add(root);

    const rim = (this.rim = { value: new THREE.Color(0, 0, 0) }); // shared day rim light (people + craft)
    this.crowd = new Crowd(look, 192);
    this.crowd.material.userData.uniforms.uRim = rim; // before the first compile picks the uniforms up
    root.add(this.crowd.mesh, this.crowd.ghost, this.crowd.keyline);

    // Craft wear the shared weathering (core/weathering.js) in their own frame; no ink keylines on craft
    // (art direction: one realistic style — rim light, contact foam and shadows separate them instead).
    const nightAmb = (this.nightAmb = { value: new THREE.Color(0, 0, 0) }); // moonlit hemi floor (ghostUniforms)
    const skyFill = (this.skyFill = { value: new THREE.Color(0, 0, 0) }); // overcast sky-dome fill (albedo ×)
    const base = { rim, nightAmb, skyFill };
    // dark rusty steel structures (barge, trawler wreck) get the full dome under dark skies (ghostUniforms)
    const steelFill = (this.steelFill = { value: new THREE.Color(0, 0, 0) });
    const raftMat = createCraftMaterial(look, { ...base, glow: this.crowd.material.userData.uniforms.uVestGlow, side: THREE.DoubleSide, roughness: 0.72, lampLift: 0.62, wear: { breakup: 0.07, streaks: 0, grime: 0.12, waterline: 0.55, roughBreakup: 0.1, deckWear: 0.1, scale: 1.6 } }); // lamp-lit canopy stays orange
    const hullMat = createCraftMaterial(look, { ...base, roughness: 0.62, wear: { ...WEAR.heavy, streaks: 0.25, scale: 1.3 }, foul: true });
    const contMat = createCraftMaterial(look, { ...base, roughness: 0.7, wear: { ...WEAR.heavy, streaks: 0.6, waterline: 0.55, scale: 1.25 } });
    const gearMat = createCraftMaterial(look, { ...base, roughness: 0.6, wear: WEAR.clean });
    const debrisMat = createCraftMaterial(look, { ...base, roughness: 0.6, debris: true, wear: WEAR.light });
    this._bigMats = {
      ferry: createCraftMaterial(look, { ...base, roughness: 0.6, wear: { ...WEAR.medium, scale: 0.8 } }),
      trawler: createCraftMaterial(look, { ...base, skyFill: steelFill, roughness: 0.66, wear: { ...WEAR.heavy, scale: 0.85 } }),
      barge: createCraftMaterial(look, { ...base, skyFill: steelFill, roughness: 0.7, wear: { ...WEAR.heavy, streaks: 0.7, scale: 0.8 } }),
    };
    this.batches = {
      raft: new CraftBatch('rafts', raftGeometry(), raftMat, 16, { castShadow: true }),
      boat: new CraftBatch('hulls', capsizedHullGeometry('boat'), hullMat, 6, { castShadow: true }),
      yacht: new CraftBatch('yachts', capsizedHullGeometry('yacht'), hullMat, 6, { castShadow: true }),
      container: new CraftBatch('containers', containerGeometry(), contMat, 8, { castShadow: true, instanceColor: true }),
      plane: new CraftBatch('planes', planeGeometry(), createCraftMaterial(look, { ...base, roughness: 0.66, wear: { ...WEAR.medium, streaks: 0.25, scale: 1.2 } }), 2, { castShadow: true }),
      stretcher: new CraftBatch('stretcher', stretcherGeometry(), gearMat, 2, { castShadow: true }),
      buoy: new CraftBatch('lostBuoys', lostBuoyGeometry(), gearMat, 48, { castShadow: false }),
      debris: new CraftBatch('debris', debrisGeometry(), debrisMat, 128, { castShadow: false }),
    };
    this._bigGeos = new Map(); // deck height → barge / ferry geometry
    this.bigBatches = []; // per (kind, deck height) batches created on demand
    this.batchList = Object.values(this.batches); // fixed list (no per-frame Object.values)
    for (const b of this.batchList) root.add(b.mesh);
    this.collars = new Collars(look, 192);
    this.glows = new Glows(look, 160);
    this.lines = new Lines(192);
    root.add(this.collars.mesh, this.glows.mesh, this.lines.mesh);
    // thermal / FLIR (render layer 2, heat.js): people hot, submerged bodies faint, occupied craft via proxies
    markHeat(this.crowd.mesh, 1);
    markHeat(this.crowd.ghost, 0.25);
    const B = this.batches;
    this.heat = {
      raft: new HeatProxy('rafts', B.raft.mesh.geometry, 0.7, B.raft.max),
      boat: new HeatProxy('hulls', B.boat.mesh.geometry, 0.3, B.boat.max),
      yacht: new HeatProxy('yachts', B.yacht.mesh.geometry, 0.3, B.yacht.max),
      plane: new HeatProxy('planes', B.plane.mesh.geometry, 0.3, B.plane.max),
    };
    this.heatList = Object.values(this.heat);
    for (const h of this.heatList) root.add(h.mesh);
    this.bottle = new Bottle(this); // DESIGN §4 #46
  }

  // model: 'ferry' | 'trawler' (wrecks), 'barge'
  _bigBatch(model, deckY) {
    const key = `${model}:${Math.round(deckY * 10)}`;
    let b = this.bigBatches.find((x) => x.key === key);
    if (b) return b;
    const geo = model === 'ferry' ? ferryGeometry(deckY) : model === 'trawler' ? trawlerWreckGeometry(deckY) : bargeGeometry(deckY);
    b = new CraftBatch(model, geo, this._bigMats[model] || this._bigMats.barge, 2, { castShadow: true });
    b.key = key;
    b.geo = geo;
    this.root.add(b.mesh);
    this.bigBatches.push(b);
    return b;
  }

  _applyQuality() {
    const q = this.ctx.settings.get('quality');
    this.quality = q;
    this.crowd.setQuality(q);
  }

  // ==============================================================================================
  // CONTRACT API
  clear() {
    for (const s of this.list) {
      const fo = s.sig?.flareObj;
      if (fo) fo.t = fo.life; // let fx retire a handheld flare we were holding
    }
    this.list.length = 0;
    this.datums.length = 0;
    this.pending.length = 0;
    this.playerFlares.length = 0;
    for (const c of this.carriers) this._disposeCarrier(c);
    this.carriers.length = 0;
    this.lostMarkers.length = 0;
    this.rescuedTotal = 0;
    this.lostTotal = 0;
    this.elapsed = 0;
    this._quoteUsed.clear();
    this.bottle?.clear();
  }

  // Spawn one group from a def entry ({type, x, z, count, hidden, signals, people, height, name, …}).
  spawn(entry = {}) {
    const ctx = this.ctx;
    let type = TYPES[entry.type] ? entry.type : 'swimmer';
    if (!this.types.includes(type)) type = TYPES[entry.fallbackType] && this.types.includes(entry.fallbackType) ? entry.fallbackType : 'raft';
    const count = Math.max(1, Math.round(entry.count ?? (type === 'raft' ? 3 : type === 'deck' ? 4 : type === 'hull' ? 2 : 1)));
    // structures in distress are known from the start (the dispatcher sends you there); people in the
    // water are hidden unless the def says otherwise
    const structure = type === 'deck' || type === 'wreck';
    const hidden = structure ? entry.hidden === true : entry.hidden !== false;
    const x = Number.isFinite(entry.x) ? entry.x : 0;
    const z = Number.isFinite(entry.z) ? entry.z : 0;
    const s = {
      id: ++this._id,
      type,
      tag: entry.tag ?? null,
      def: entry,
      label: entry.label ?? null,
      name: entry.name ?? null,
      position: new THREE.Vector3(x, 0, z),
      velocity: new THREE.Vector3(),
      count,
      remaining: count,
      health: 1,
      state: hidden ? 'hidden' : 'spotted',
      spotted: !hidden,
      priority: type === 'injured',
      object3d: new THREE.Object3D(),
      height: 0,
      signals: entry.signals || {},
      // extras
      deckY: undefined,
      warmth: 1,
      critical: false,
      people: [],
      attached: null,
      inBasket: null,
      carrier: null,
      since: entry.since ?? 0,
      age: 0,
      hiddenAtStart: hidden,
      signal: null,
      strobe: false,
      panic: false,
      calm: 0,
      excite: 0,
      beamT: 0,
      coreT: 0,
      lostT: -1,
      rogueCd: 0,
      sweep: null,
      dwT: 0,
      dwWarn: 0,
      dwWarnT: 0,
      shoutNear: false,
      flower: count >= 2 && type === 'swimmer',
      ringSpin: Math.random() * Math.PI * 2,
      nrm: new THREE.Vector3(0, 1, 0),
      dHeli: 1e9,
      swimTo: null,
      jumpT: 0,
      // NICE: a pet aboard (def.pet 'cat' | 'dog'): the cat refuses the first basket, the dog barks
      pet: entry.pet ? { kind: entry.pet === 'cat' ? 'cat' : 'dog', far: false, refused: false, hopT: 0, barkT: 0, yaw: 0 } : null,
    };
    s.object3d.name = `survivor-${s.id}`;
    // people (the mission's manifest when it has one, so cabin and logbook agree)
    const recs = Array.isArray(entry.people) && entry.people.length >= count ? entry.people : makeFallbackPeople((this.def?.seed ?? 1) * 97 + s.id, type, count);
    for (let i = 0; i < count; i++) s.people.push(this._makePerson(recs[i] || recs[0], s, i));
    initSignals(s, entry, this.rng, this.def?.script);
    this._makeCarrier(s, entry);
    s.position.y = s.deckY ?? ctx.ocean?.heightAt?.(s.position.x, s.position.z) ?? 0;
    s.height = s.deckY ?? 0;
    // the dispatcher's search area (datum): drifts with the water and grows 0.5 m/s
    if (hidden) {
      const R = entry.datumRadius ?? 200;
      let dx = entry.datum?.x;
      let dz = entry.datum?.z;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
        const a = this.rng.next() * Math.PI * 2;
        const r = this.rng.next() * 0.35 * R;
        dx = x + Math.cos(a) * r;
        dz = z + Math.sin(a) * r;
      }
      s.datum = { x: dx, z: dz, radius: R, ids: [s.id], tag: s.tag, label: s.label || '', s };
      this.datums.push(s.datum);
    }
    this.list.push(s);
    this._syncObject(s);
    this._emit('survivor:spawn', { s });
    return s;
  }

  // Closest pick-up-able group to (x, z) within maxDist, ranked by distance / capture radius of its type.
  // People standing on a structure are only reachable from deck level: a basket hanging in the water
  // below the rig's lower deck (or beside the ferry) does not get them.
  nearestFor(x, z, maxDist = 4.5) {
    let best = null;
    let bk = Infinity;
    const by = this.ctx.heli?.winch?.basket?.y;
    for (const s of this.list) {
      if (!this._pickable(s)) continue;
      const d = Math.hypot(s.position.x - x, s.position.z - z);
      if (d > maxDist) continue;
      if (s.deckY !== undefined && s.deckY > 1.5 && Number.isFinite(by) && by < s.deckY - 2.5) continue;
      const r = TYPES[s.type]?.capture ?? 3;
      const k = d / r;
      if (k < bk) {
        bk = k;
        best = s;
      }
    }
    return best;
  }

  attachToBasket(s) {
    if (!s || !s.people || s.attached) return;
    const w = this.ctx.heli?.winch;
    // the person closest to the basket goes in (rafts: whoever is in the doorway)
    let bi = 0;
    if (w?.basket && s.people.length > 1 && !s.carrier) {
      let bd = Infinity;
      s.people.forEach((p, i) => {
        const d = Math.hypot(p.x - w.basket.x, p.z - w.basket.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
    }
    const p = s.people.splice(bi, 1)[0];
    if (!p) return;
    p.liftWarmth = s.health;
    p.attachT = this.ctx.time.t;
    p.spin = Math.random() * Math.PI * 2;
    s.attached = p;
    s.inBasket = p.rec;
    if (s.pet && s.pet.kind === 'cat' && !s.pet.refused) {
      // «кот отказывается от первой корзины»: it bolts to the far end of whatever they are on
      s.pet.refused = true;
      s.pet.far = true;
      s.pet.hopT = 0.8;
      this._emit('survivor:pet', { s, pet: 'cat', action: 'refuse' });
    }
    s.stateBefore = s.state === 'winching' ? 'spotted' : s.state;
    s.state = 'winching';
    if (!s.spotted) this.spot(s, 'basket');
  }

  // opts: { slip, heatLoss (s of warmth), reason } — heli calls it on «Сорвался!», tension, crash, reset.
  detachFromBasket(s, opts = {}) {
    if (!s || !s.attached) return;
    const p = s.attached;
    s.attached = null;
    s.inBasket = null;
    const env = this.env;
    if (s.state === 'winching') s.state = s.remaining > 0 ? 'spotted' : s.state;
    if (opts.slip) {
      // fell back into the water: −10 s of warmth, back where the basket was
      const loss = Number.isFinite(opts.heatLoss) ? opts.heatLoss : 10;
      s.health = Math.max(0.01, s.health - loss / this._duration(s, env));
      const b = this.ctx.heli?.winch?.basket;
      const bx = b ? b.x : s.position.x;
      const bz = b ? b.z : s.position.z;
      const onStructure = (s.type === 'deck' || s.type === 'wreck') && b && b.y > (s.deckY ?? 0) - 1 && Math.hypot(bx - s.position.x, bz - s.position.z) < 10;
      if (s.carrier && !onStructure && s.carrier.kind !== 'raft') {
        this._splitPerson(s, p, bx, bz, 'slip');
        return;
      }
      if (!s.carrier && (s.type === 'swimmer' || s.type === 'injured')) {
        s.position.x = bx;
        s.position.z = bz;
        this.ctx.ocean?.splash?.(bx, bz, 1.2, 0.5);
      }
    }
    s.people.unshift(p);
    if (s.lostPending) this._lose(s);
  }

  boardOne(s) {
    if (!s) return { name: 'Пострадавший', age: 30, condition: 'стабильное' };
    let p = s.attached;
    if (!p) p = s.people.shift();
    s.attached = null;
    s.inBasket = null;
    const env = this.env;
    const warmth = p?.liftWarmth ?? s.health;
    const rec = p?.rec || { name: 'Неизвестный', first: 'Неизвестный', surname: '', gender: 'm', age: null, occupation: '' };
    const gender = rec.gender || guessGender(rec.name);
    const injured = s.type === 'injured';
    const minutes = Math.round((s.since || 0) + (s.age || 0) / 60);
    const tags = [];
    if (rec.child) tags.push('child');
    if (injured) tags.push('injured');
    if (s.flower) tags.push('flower');
    if (s.def?.pet) tags.push('pet');
    tags.push(s.carrier?.kind === 'raft' || s.type === 'raft' ? 'raft' : s.type);
    if (env.night > 0.5) tags.push('night');
    if (env.intensity > 0.6) tags.push('storm');
    if (env.preset === 'fog') tags.push('fog');
    if (minutes > 45 || warmth < 0.35) tags.push('long', 'cold');
    tags.push('any');
    const person = {
      name: rec.name,
      first: rec.first || String(rec.name).split(/\s+/)[0],
      surname: rec.surname ?? String(rec.name).split(/\s+/).slice(1).join(' '),
      gender,
      age: rec.age ?? null,
      child: !!rec.child,
      occupation: rec.occupation || '',
      condition: conditionFor(warmth, injured),
      warmth,
      warmthAtLift: warmth,
      minutesInWater: Math.max(1, minutes),
      tags,
      quote: quoteFor(this.rng, gender, tags, this._quoteUsed),
      injured,
      type: s.type,
      tag: s.tag,
      label: s.label,
      pet: s.def?.pet && s.remaining <= 1 ? s.def.pet : null,
    };
    if (s.remaining > 0) s.remaining--;
    this.rescuedTotal++;
    if (s.state === 'winching') s.state = 'spotted';
    this._emit('survivor:boarded', { s, person });
    if (s.remaining <= 0) {
      if (s.state !== 'lost') {
        s.state = 'rescued';
        this._releaseCarrier(s);
        this._dropDatum(s);
        this._emit('survivor:rescued', { s });
      }
    } else if (s.lostPending) this._lose(s); // the others did not make it while this one was lifted
    return person;
  }

  remainingCount() {
    let n = 0;
    for (const s of this.list) if (s.state !== 'rescued' && s.state !== 'lost') n += s.remaining;
    return n;
  }

  rescuedCount() {
    return this.rescuedTotal;
  }

  lostCount() {
    return this.lostTotal;
  }

  // ---- extras ------------------------------------------------------------------------------------
  fireSignal(s, kind = 'rocket') {
    if (!s || !s.sig) return false;
    return this.desk.fire(s, kind, this.env, true);
  }

  spot(s, by = 'crew') {
    if (!s || s.spotted || s.state === 'lost' || s.state === 'rescued') return;
    s.spotted = true;
    if (s.state === 'hidden' || s.state === 'drifting') s.state = 'spotted';
    s.excite = 6; // «Нашли»: both arms for a few seconds
    s.beamT = 0;
    this._dropDatum(s);
    this._emit('survivor:spotted', { s, by });
  }

  byTag(tag) {
    return this.list.filter((s) => s.tag === tag);
  }

  // Deck height under (x, z) of the structures people stand on (barge, sinking ferry, the rig's lower
  // deck), or −Infinity. The winch can treat it as the surface: the basket stops on the deck and the
  // height window counts from it (DESIGN §3.5 «на конструкции»).
  deckAt(x, z) {
    let best = -Infinity;
    for (const c of this.carriers) {
      if ((c.kind !== 'barge' && c.kind !== 'wreck' && c.kind !== 'rig') || !c.alive || c.dissolve > 0.3) continue;
      const y = c.deckHeightAt(x, z);
      if (y > best) best = y;
    }
    return best;
  }

  // ==============================================================================================
  // Mission setup / events
  _setup(def) {
    this.clear();
    this.def = def || null;
    this.rng = createRng((((def?.seed ?? 1) >>> 0) * 31 + 7) >>> 0);
    this.waterTemp = Number.isFinite(def?.waterTemp) ? def.waterTemp : 8;
    this.current.set(def?.current?.x ?? 0, def?.current?.z ?? 0);
    this.theme = def?.theme || null;
    this._refreshEnv(0);
    for (const e of def?.survivors || []) {
      if (!e) continue;
      if ((e.at || 0) > 0) this.pending.push(e);
      else this.spawn(e);
    }
    this.pending.sort((a, b) => a.at - b.at);
    this.bottle?.setup(def);
  }

  _onHorn(p) {
    if (!p) return;
    for (const s of this.list) {
      if (s.state === 'lost' || s.state === 'rescued') continue;
      const d = Math.hypot(s.position.x - p.x, s.position.z - p.z);
      if (!s.spotted && d < SIG.hornHear && s.health > 0.08) s.sig.hornT = 1 + this.rng.next();
      if (s.spotted && d < SIG.hornCalm) s.calm = 40; // «Мы вас видим!» — they stop panicking
    }
  }

  _onRaftDrop(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    const c = new Carrier('raft', p.x, p.z, { dropped: true, phase: this.rng.next() * 100 });
    c.yaw = this.rng.next() * Math.PI * 2;
    this.carriers.push(c);
    this.ctx.ocean?.splash?.(p.x, p.z, 3, 0.9);
  }

  // ==============================================================================================
  // Per-frame
  update(dt) {
    const ctx = this.ctx;
    const env = this._refreshEnv(dt);
    if (env.play) {
      this.elapsed += dt;
      while (this.pending.length && this.pending[0].at <= this.elapsed) this.spawn(this.pending.shift());
    }
    for (let i = this.playerFlares.length - 1; i >= 0; i--) if (this.playerFlares[i].until < env.t) this.playerFlares.splice(i, 1);

    // --- simulation ------------------------------------------------------------------------------
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.state === 'rescued' && !s.attached) continue;
      s.age += env.play ? dt : 0;
      s.dHeli = env.heliAlive ? Math.hypot(s.position.x - env.hx, s.position.z - env.hz) : 1e9;
      if (s.state === 'lost') {
        this._lostDrift(s, env, dt);
        continue;
      }
      s.strobe = strobeOn(s, env.night);
      this._motion(s, env, dt);
      if (env.play) {
        this._warmth(s, env, dt);
        this._hazards(s, env, dt);
        if (s.state !== 'lost' && s.state !== 'rescued') {
          this.desk.update(s, env, dt, s.dHeli);
          this._detect(s, env, dt);
          this._near(s, env, dt);
        }
      }
      if (s.pet) this._petLife(s, env, dt);
      if (s.excite > 0) s.excite -= dt;
      if (s.calm > 0) s.calm -= dt;
      // «СИГНАЛ» is a moment, not a marker: 20 s after the last ping the group is «нет данных» again
      if (s.state === 'drifting' && !s.spotted && (!s.signal || env.t > s.signal.until)) s.state = 'hidden';
    }
    for (const c of this.carriers) this._carrier(c, env, dt);
    for (let i = this.carriers.length - 1; i >= 0; i--) {
      if (!this.carriers[i].alive) {
        this._disposeCarrier(this.carriers[i]);
        this.carriers.splice(i, 1);
      }
    }
    // structures place their people after the carrier pose
    for (const s of list) if (s.carrier && (s.type === 'deck' || s.type === 'wreck') && s.state !== 'rescued') this._structureAnchor(s);
    this._datums(env, dt);
    for (const s of list) this._syncObject(s);

    // --- drawing ---------------------------------------------------------------------------------
    this._draw(env, dt);
  }

  // Frame snapshot of everything we read from other systems (stubs give sensible defaults).
  _refreshEnv(dt) {
    const ctx = this.ctx;
    const env = this.env;
    const st = ctx.weather?.state || {};
    env.t = ctx.time.t;
    env.dt = dt;
    env.play = ctx.mode === 'play';
    env.night = clamp01(st.night ?? 0);
    env.preset = st.preset || 'calm';
    env.intensity = clamp01(st.intensity ?? 0);
    env.fog = clamp01(st.fog ?? 0);
    env.Hs = st.waveHeight ?? 0.5;
    const wd = st.windDir;
    env.windSpeed = st.windSpeed ?? 0;
    env.windDirX = wd ? wd.x : 1;
    env.windDirZ = wd ? wd.y : 0;
    env.windAngle = Math.atan2(env.windDirZ, env.windDirX);
    const pal = st.palette || {};
    env.sunny = (env.preset === 'calm' || env.preset === 'clearing' || (pal.sunIntensity ?? 0) > 1.8) && env.night < 0.3;
    env.reduceFlashes = !!ctx.settings.get('reduceFlashes');
    let det = null;
    try {
      det = ctx.weather?.detectBase?.();
    } catch {
      det = null;
    }
    const fb = DETECT[env.preset] || DETECT.calm;
    env.base = det && Number.isFinite(det.base) ? det.base : fb[0];
    env.altBonus = det && Number.isFinite(det.altBonus) ? det.altBonus : fb[1];
    // heli
    const h = ctx.heli;
    env.heliAlive = !!(h && h.position && h.alive !== false);
    // survivors only take a flying heli for a search: an aircraft sitting on its pad (or a dead rotor)
    // does not trigger rockets or dye, otherwise every group within 700 m of the base fires at 0:03
    env.rotorHeard = env.heliAlive && !h.landed && (h.rotorRPM ?? 1) > 0.8;
    if (h && h.position) {
      env.hx = h.position.x;
      env.hy = h.position.y;
      env.hz = h.position.z;
      env.alt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
    }
    env.fogBlind = (env.preset === 'fog' || env.fog > 0.55) && env.alt > 35;
    env.thermal = thermalBoost(ctx, env); // FLIR detection multiplier (1 = off / by day)
    // rotor downwash (DESIGN §2.6.5 layer 9): R = 9 + .35·alt, s = sat(1 − (alt − 4)/28)²
    const dw = h?.downwash;
    env.dwR = dw && Number.isFinite(dw.radius) ? dw.radius : 9 + 0.35 * Math.max(0, env.alt);
    if (dw && Number.isFinite(dw.strength)) env.dwS = dw.strength;
    else {
      const k = clamp01(1 - (env.alt - 4) / 28);
      env.dwS = env.heliAlive ? k * k * clamp01(h?.rotorRPM ?? 1) : 0;
    }
    if (h?.landed) env.dwS *= 0.3;
    const w = h?.winch;
    env.wState = w?.state || 'stowed';
    env.wLoad = w?.load || null;
    if (w?.basket) {
      env.bx = w.basket.x;
      env.by = w.basket.y;
      env.bz = w.basket.z;
    }
    env.bH = Number.isFinite(w?.height) ? w.height : 99;
    env.bWet = (env.wState === 'lowering' || env.wState === 'down') && env.bH < 1.6 && !env.wLoad;
    // light under the surface / on foam (for unlit custom shaders)
    const amb = pal.ambient;
    const ai = pal.ambientIntensity ?? 0.6;
    const sun = pal.sun;
    const si = pal.sunIntensity ?? 1;
    const gl = env.ghostLight;
    if (amb && amb.isColor) gl.copy(amb).multiplyScalar(0.45 * ai);
    else gl.setRGB(0.3, 0.33, 0.36);
    if (sun && sun.isColor) gl.add(_col.copy(sun).multiplyScalar(0.12 * si * (1 - env.night)));
    gl.add(_col.copy(C_WHITE).multiplyScalar(0.6 * (st.flash || 0)));
    const foam = pal.foam;
    if (foam && foam.isColor) env.foam.copy(foam).multiplyScalar(0.62 + 0.25 * (1 - env.night));
    else env.foam.setRGB(0.8, 0.84, 0.83);
    return env;
  }

  // ----------------------------------------------------------------------------------------------
  // Drift: current + leeway·wind + hazard surface flow + downwash + swim + rogue sweep.
  _motion(s, env, dt) {
    const ctx = this.ctx;
    const c = s.carrier;
    if (c && (c.kind === 'barge' || c.kind === 'wreck' || c.kind === 'rig')) return; // structures move themselves
    if (c && c.dropped) {
      // aboard a dropped raft: ride it
      s.position.x = c.x;
      s.position.z = c.z;
      s.position.y = c.y;
      s.velocity.copy(c.vel || _v.set(0, 0, 0));
      return;
    }
    const p = s.position;
    let vx = this.current.x;
    let vz = this.current.y;
    const lee = c ? c.leeway : TYPES[s.type]?.leeway ?? 0.02;
    if (ctx.weather?.windAt) {
      ctx.weather.windAt(p.x, p.z, _w);
      vx += lee * _w.x;
      vz += lee * _w.y;
    } else {
      vx += lee * env.windSpeed * env.windDirX;
      vz += lee * env.windSpeed * env.windDirZ;
    }
    if (ctx.hazards?.surfaceFlowAt) {
      ctx.hazards.surfaceFlowAt(p.x, p.z, _f.set(0, 0));
      if (Number.isFinite(_f.x + _f.y)) {
        vx += _f.x;
        vz += _f.y;
      }
    }
    const swimmer = !c && (s.type === 'swimmer' || s.type === 'injured');
    // rotor downwash pushes swimmers out of the ring below 12 m: (12 − alt)·0.4 m/s
    s.dwWarn = 0;
    if (swimmer && env.heliAlive && env.alt < DW_PUSH_ALT && env.dwS > 0.02) {
      const dx = p.x - env.hx;
      const dz = p.z - env.hz;
      const d = Math.hypot(dx, dz);
      if (d < env.dwR) {
        const push = (DW_PUSH_ALT - env.alt) * 0.4 * (1 - smooth(0.85, 1, d / env.dwR));
        const inv = d > 0.2 ? 1 / d : 0;
        vx += (d > 0.2 ? dx * inv : env.windDirX) * push;
        vz += (d > 0.2 ? dz * inv : env.windDirZ) * push;
        s.dwWarn = clamp01(push / 2);
        if (push > 0.6 && env.play && env.t > s.dwWarnT) {
          s.dwWarnT = env.t + 6;
          this._emit('survivor:downwash', { s, level: 'push' });
        }
      }
    }
    // swim: to the basket within 10 m, else to a dropped raft within 60 m (0.5 m/s)
    s.swimTo = null;
    if (swimmer && s.type === 'swimmer' && s.health > 0.15 && !s.attached && !(s.panic && s.calm <= 0)) {
      if (env.bWet && Math.hypot(env.bx - p.x, env.bz - p.z) < SWIM_TO_BASKET) {
        const dx = env.bx - p.x;
        const dz = env.bz - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.8) {
          vx += (dx / d) * SWIM_SPEED;
          vz += (dz / d) * SWIM_SPEED;
          s.swimTo = 'basket';
        }
      } else {
        const raft = this._nearestDroppedRaft(p.x, p.z, SWIM_TO_RAFT, s.remaining);
        if (raft) {
          const dx = raft.x - p.x;
          const dz = raft.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < RAFT.R + 0.8 && raft.inflate > 0.95) this._boardRaft(s, raft);
          else if (d > 0.5) {
            vx += (dx / d) * SWIM_SPEED;
            vz += (dz / d) * SWIM_SPEED;
            s.swimTo = 'raft';
          }
        }
      }
    }
    // a passing rogue crest carries floating things ~40 m (eased)
    if (s.sweep) {
      const sw = s.sweep;
      sw.t += dt;
      const k = sw.t / sw.dur;
      if (k >= 1) s.sweep = null;
      else {
        const sp = (sw.dist / sw.dur) * 1.5 * Math.sin(Math.PI * k) * 1.05;
        vx += sw.dx * sp;
        vz += sw.dz * sp;
      }
    }
    if (dt > 0) {
      p.x += vx * dt;
      p.z += vz * dt;
    }
    s.velocity.set(vx, 0, vz);
    if (c) {
      c.x = p.x;
      c.z = p.z;
      p.y = c.y;
    } else {
      p.y = ctx.ocean?.heightAt ? ctx.ocean.heightAt(p.x, p.z) : 0;
    }
  }

  _lostDrift(s, env, dt) {
    if (s.lostT >= 0) s.lostT += dt;
    // the marker buoy stays; nothing else to simulate
  }

  _nearestDroppedRaft(x, z, maxD, need) {
    let best = null;
    let bd = maxD;
    for (const c of this.carriers) {
      if (!c.dropped || !c.alive || c.capsized || c.dissolve > 0) continue;
      let used = 0;
      for (const r of c.riders) used += r.remaining;
      if (used + need > RAFT_SEATS) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  _boardRaft(s, raft) {
    s.carrier = raft;
    raft.riders.push(s);
    raft.emptyT = 0;
    s.position.set(raft.x, raft.y, raft.z);
    this.ctx.ocean?.splash?.(raft.x, raft.z, 1.5, 0.4);
    this._emit('survivor:raft-boarded', { s });
  }

  // Warmth (DESIGN §3.11): health 1 → 0 over base × mT × night × difficulty seconds.
  _duration(s, env) {
    const raftRider = s.carrier && s.carrier.kind === 'raft' && s.type === 'swimmer';
    const base = raftRider ? TYPES.raft.warmth : TYPES[s.type]?.warmth ?? 180;
    const T = this.waterTemp;
    const mT = clamp(0.35 + T / 20, 0.4, 1.6);
    const night = lerp(1, 0.9, env.night);
    const diff = DIFFICULTY_WARMTH[this.ctx.settings.get('difficulty')] ?? 1;
    return Math.max(10, base * mT * night * diff);
  }

  _warmth(s, env, dt) {
    if (s.state === 'lost' || s.state === 'rescued' || !(dt > 0)) return;
    s.health = Math.max(0, s.health - dt / this._duration(s, env));
    s.warmth = s.health;
    if (!s.critical && s.health <= CRITICAL) {
      s.critical = true;
      this._emit('survivor:critical', { s });
    }
    if (s.health <= 0) {
      if (s.attached) s.lostPending = true; // the one on the cable still makes it
      else this._lose(s);
    }
  }

  _lose(s) {
    if (s.state === 'lost') return;
    if (s.people.length === 0 && s.remaining <= 0) {
      s.state = 'rescued';
      return;
    }
    s.state = 'lost';
    s.lostPending = false;
    s.lostT = 0;
    s.health = 0;
    s.warmth = 0;
    this.lostTotal += s.remaining;
    const fo = s.sig.flareObj;
    if (fo) fo.t = Math.max(fo.t, fo.life - 2.5);
    s.sig.flareBurn = Math.min(s.sig.flareBurn, 2.5);
    s.sig.smokeBurn = Math.min(s.sig.smokeBurn, 4);
    this._dropDatum(s);
    this.lostMarkers.push({ x: s.position.x, z: s.position.z, y: s.position.y, t: this.ctx.time.t, s, phase: this.rng.next() * 10, nrm: new THREE.Vector3(0, 1, 0) });
    if (s.carrier && s.carrier.kind === 'raft') {
      // the raft drifts on, closed and dark; nobody in the doorway
      const c = s.carrier;
      c.lampDead = true;
    }
    this._emit('survivor:lost', { s });
  }

  // Hazards per group: whirlpools (panic, core = lost after 5 s), rogue crests (sweep, capsize).
  _hazards(s, env, dt) {
    const ctx = this.ctx;
    const p = s.position;
    // --- whirlpools ----------------------------------------------------------------------------------
    s.panic = false;
    const wp = this._whirlpoolAt(p.x, p.z);
    if (wp && s.type !== 'deck' && s.type !== 'wreck') {
      s.panic = s.calm <= 0;
      if (wp.d < 8) {
        s.coreT += dt;
        if (s.coreT >= 5 && !s.attached) {
          s.health = 0;
          this._lose(s);
          return;
        }
      } else s.coreT = Math.max(0, s.coreT - dt);
    } else s.coreT = 0;
    // --- rogue wave crest passing (DESIGN §3.12: people carried ~40 m, rafts capsize by chance) -------
    if (s.rogueCd > 0) s.rogueCd -= dt;
    const floating = s.type !== 'deck' && s.type !== 'wreck';
    if (floating && s.rogueCd <= 0 && ctx.hazards?.waveLiftAt) {
      const lift = ctx.hazards.waveLiftAt(p.x, p.z) || 0;
      if (lift > 3.5) {
        s.rogueCd = 10;
        const dir = this._rogueDir(p.x, p.z);
        s.sweep = { dx: dir.x, dz: dir.y, t: 0, dur: ROGUE_SWEEP_T, dist: ROGUE_SWEEP };
        if (s.carrier && s.carrier.kind === 'raft' && !s.carrier.capsized && s.carrier.owner === s) {
          const chance = s.remaining > 4 ? 0.6 : 0.4;
          if (this.rng.next() < chance) this._capsize(s, 'rogue');
        }
      }
    }
    // --- raft under a low rotor: capsizes after 2 s below 8 m within 6 m -------------------------------
    const c = s.carrier;
    if (c && c.kind === 'raft' && c.owner === s && !c.capsized && env.heliAlive) {
      const d = Math.hypot(c.x - env.hx, c.z - env.hz);
      if (env.alt < DW_CAPSIZE_ALT && d < DW_CAPSIZE_R && env.dwS > 0.3) {
        s.dwT += dt;
        s.dwWarn = clamp01(s.dwT / DW_CAPSIZE_T);
        if (s.dwT > 0.5 && env.t > s.dwWarnT) {
          s.dwWarnT = env.t + 5;
          this._emit('survivor:downwash', { s, level: 'capsize' });
        }
        if (s.dwT >= DW_CAPSIZE_T) this._capsize(s, 'downwash');
      } else {
        s.dwT = Math.max(0, s.dwT - dt * 0.5);
        s.dwWarn = clamp01(s.dwT / DW_CAPSIZE_T);
      }
    }
  }

  _whirlpoolAt(x, z) {
    const ctx = this.ctx;
    const out = this._wp || (this._wp = { d: 0, r: 0 });
    const hl = ctx.hazards?.list;
    if (Array.isArray(hl)) {
      for (const h of hl) {
        if (!h || h.type !== 'whirlpool' || !h.position) continue;
        const r = h.radius || 45;
        const d = Math.hypot(h.position.x - x, h.position.z - z);
        if (d < r) {
          out.d = d;
          out.r = r;
          return out;
        }
      }
    }
    const slots = ctx.ocean?.features?.slots;
    if (Array.isArray(slots)) {
      for (const f of slots) {
        if (!f || f.type !== 3 || f.removed) continue;
        const r = f.B?.[0] || 45;
        const d = Math.hypot(f.A[1] - x, f.A[2] - z);
        if (d < r) {
          out.d = d;
          out.r = r;
          return out;
        }
      }
    }
    return null;
  }

  _rogueDir(x, z) {
    const ctx = this.ctx;
    const out = this._rd || (this._rd = new THREE.Vector2());
    const hl = ctx.hazards?.list;
    if (Array.isArray(hl)) {
      for (const h of hl) {
        if (!h || h.type !== 'rogue') continue;
        const d = h.dir || h.direction;
        if (d) {
          const dz = d.isVector3 ? d.z : d.y ?? d.z;
          const l = Math.hypot(d.x, dz) || 1;
          return out.set(d.x / l, dz / l);
        }
      }
    }
    const slots = ctx.ocean?.features?.slots;
    if (Array.isArray(slots)) for (const f of slots) if (f && f.type === 1 && !f.removed) return out.set(f.B[0], f.B[1]);
    return out.set(this.env.windDirX, this.env.windDirZ);
  }

  // A raft flips: the canopy goes under, the people become a ring of swimmers around it.
  _capsize(s, cause) {
    const c = s.carrier;
    if (!c || c.capsized) return;
    c.capsized = true;
    c.owner = null;
    c.flipT = 0;
    c.lampDead = true;
    s.carrier = null;
    s.type = 'swimmer';
    s.flower = s.people.length >= 2;
    s.dwT = 0;
    // they come up a few metres away (within 6 m)
    const a = this.rng.next() * Math.PI * 2;
    s.position.x = c.x + Math.cos(a) * 3.5;
    s.position.z = c.z + Math.sin(a) * 3.5;
    this.ctx.ocean?.splash?.(c.x, c.z, 4, 1);
    this.ctx.fx?.splash?.(c.x, c.y, c.z, 2.5);
    if (!s.spotted && s.dHeli < 120) this.spot(s, 'capsize');
    this._emit('survivor:capsize', { s, cause });
  }

  // Everyone left on a sinking hull / ferry goes into the water as one ring of swimmers.
  _abandon(s, cause) {
    const c = s.carrier;
    if (!c) return;
    c.owner = null;
    s.carrier = null;
    s.type = 'swimmer';
    s.flower = s.people.length >= 2;
    s.deckY = undefined;
    s.height = 0;
    s.position.y = 0;
    const a = this.rng.next() * Math.PI * 2;
    const off = c.kind === 'wreck' ? 14 : 4;
    s.position.x = c.x + Math.cos(a) * off;
    s.position.z = c.z + Math.sin(a) * off;
    this.ctx.ocean?.splash?.(s.position.x, s.position.z, 3, 0.8);
    this._emit('survivor:sinking', { s, phase: 'sunk', cause });
  }

  // One person leaves a group as a separate swimmer (wreck jumpers, container tip, slip from height).
  // If they were the last one, the group itself becomes that swimmer.
  _splitPerson(s, person, x, z, cause) {
    if (s.people.length === 0 && !s.attached && s.remaining <= 1) {
      // the last one: convert in place
      if (s.carrier) s.carrier.owner = null;
      s.carrier = null;
      s.type = 'swimmer';
      s.flower = false;
      s.deckY = undefined;
      s.height = 0;
      s.people.push(person);
      s.position.set(x, 0, z);
      s.sig.whistle = true;
      this._emit('survivor:jump', { s, from: cause });
      return s;
    }
    s.remaining = Math.max(0, s.remaining - 1);
    const g = this.spawn({
      ...s.def,
      type: 'swimmer',
      x,
      z,
      count: 1,
      at: 0,
      hidden: false,
      people: [person.rec],
      signals: { whistle: true, strobe: s.def?.signals?.strobe },
      datum: null,
    });
    g.tag = s.tag;
    g.def = s.def;
    g.health = s.health;
    g.spotted = s.spotted || s.dHeli < 150;
    g.state = g.spotted ? 'spotted' : 'hidden';
    g.spawnT = this.elapsed;
    g.people[0] = person;
    g.parent = s;
    g.label = s.label;
    if (!g.spotted) {
      g.datum = s.datum ? { ...s.datum, ids: [g.id], s: g } : null;
      if (g.datum) this.datums.push(g.datum);
    }
    this.ctx.ocean?.splash?.(x, z, 1.4, 0.6);
    this.ctx.fx?.splash?.(x, 0, z, 1.2);
    this._emit('survivor:jump', { s: g, from: cause, parent: s });
    if (s.remaining <= 0 && s.people.length === 0 && !s.attached) {
      s.state = 'rescued'; // nobody left on it (they are all in other groups now)
      s.empty = true;
      this._releaseCarrier(s);
    }
    return g;
  }

  // Detection ladder (DESIGN §3.10).
  _detect(s, env, dt) {
    if (s.spotted || !env.heliAlive) return;
    const ctx = this.ctx;
    const p = s.position;
    const d = s.dHeli;
    // crew eyes: detectR = base·(0.85 + 0.003·alt·altBonus), × type size; strobes ×3 at night
    const size = TYPES[s.type]?.size ?? 1;
    const R = env.base * (0.85 + 0.003 * Math.max(0, env.alt) * env.altBonus) * size;
    if (!env.fogBlind && d < R) return this.spot(s, 'crew');
    // FLIR at night / in fog: ×1.6 and sees through the murk (heat.js thermalBoost)
    if (env.thermal > 1 && d < R * env.thermal) return this.spot(s, 'thermal');
    const lit = s.strobe || (s.carrier?.kind === 'raft' && !s.carrier.lampDead);
    if (lit && env.night > 0.45 && d < R * (s.strobe ? STROBE_MULT : 2)) return this.spot(s, s.strobe ? 'strobe' : 'lamp');
    // burning / flashing signals
    const by = this.desk.seen(s, env, d);
    if (by) return this.spot(s, by);
    // searchlight: 0.4 s in the pool, slant range ≤ 250 m
    const o = ctx.ocean;
    if (o?.searchlightAt) {
      const y = s.deckY ?? p.y;
      const slant = Math.hypot(d, env.hy - y);
      const k = slant < BEAM_RANGE ? o.searchlightAt(p.x, p.z, y) : 0;
      if (k > 0.3) {
        s.beamT += dt;
        if (s.beamT >= BEAM_SPOT_TIME) return this.spot(s, 'searchlight');
      } else s.beamT = Math.max(0, s.beamT - dt * 0.5);
    }
    // player flares light 45 m around them for 40 s
    for (const f of this.playerFlares) if (Math.hypot(f.x - p.x, f.z - p.z) < FLARE_SPOT_R) return this.spot(s, 'flare');
  }

  // Close-range reactions: «Сюда! Мы здесь!» once within 60 m.
  _near(s, env) {
    if (!s.shoutNear && s.dHeli < NEAR_WAVE && s.health > 0.2) {
      s.shoutNear = true;
      this._emit('survivor:shout', { s, reason: 'near' });
    }
  }

  // Datums drift with the water and grow 0.5 m/s (DESIGN §3.10 SHOULD).
  _datums(env, dt) {
    if (!(dt > 0) || !env.play) return;
    for (const d of this.datums) {
      const s = d.s;
      const lee = TYPES[s?.type]?.leeway ?? 0.02;
      d.x += (this.current.x + lee * env.windSpeed * env.windDirX) * dt;
      d.z += (this.current.y + lee * env.windSpeed * env.windDirZ) * dt;
      d.radius += 0.5 * dt;
    }
  }

  _dropDatum(s) {
    if (!s.datum) return;
    const i = this.datums.indexOf(s.datum);
    if (i >= 0) this.datums.splice(i, 1);
    s.datum = null;
  }

  // «СИГНАЛ»: the ladder's middle rung + the event HUD and audio sync on.
  _emitSignal(s, kind, x, z, error, arc, ping, as) {
    const t = this.ctx.time.t;
    if (ping) {
      s.signal = s.signal || { kind, x, z, error, arc, t, until: 0 };
      const g = s.signal;
      g.kind = kind;
      g.x = x;
      g.z = z;
      g.error = error;
      g.arc = arc;
      g.t = t;
      g.until = t + SIG.rocketSignalLife;
      if (s.state === 'hidden') s.state = 'drifting';
    }
    this._emit('survivor:signal', { s, kind: as || kind, x, z, error, arc });
  }

  _emit(name, payload) {
    this.ctx.events.emit(name, payload);
  }

  _syncObject(s) {
    const o = s.object3d;
    o.position.copy(s.position);
    o.updateMatrixWorld();
  }

  // ==============================================================================================
  // People
  _makePerson(rec, s, i) {
    const rng = this.rng;
    const child = !!rec?.child;
    const p = {
      rec: rec || null,
      skin: Math.floor(rng.next() * SKIN.length),
      hood: rng.next() < 0.6 ? Math.floor(rng.next() * HOOD_COUNT) : HOOD_COUNT + Math.floor(rng.next() * (HOOD.length - HOOD_COUNT)),
      jacket: Math.floor(rng.next() * JACKET.length),
      pants: Math.floor(rng.next() * PANTS.length),
      scale: child ? 0.74 : 0.95 + rng.next() * 0.1,
      phase: rng.next() * Math.PI * 2,
      waveArm: rng.next() < 0.7 ? 1 : -1,
      strobePhase: rng.next() * SIG.strobePeriod,
      yaw: rng.next() * Math.PI * 2,
      aL: 0.8, pL: 0.5, aR: 0.8, pR: 0.5,
      x: s.position.x, y: 0, z: s.position.z,
      waterY: 0,
      legFold: 0,
      liftWarmth: 1,
      spin: 0,
      lastPose: 0,
    };
    return p;
  }

  // Which gesture now (DESIGN §2.10 «Движение»).
  _poseFor(s, p, env, onCarrier) {
    if (s.state === 'lost') return POSE.frozen;
    const w = s.health;
    const d = s.dHeli;
    if (s.type === 'injured') return w < 0.15 ? POSE.still : d < SEEN_RANGE ? POSE.limp : POSE.still;
    if (w < 0.15) return POSE.still;
    if (s.panic && s.calm <= 0) return POSE.panic;
    if (s.sig.flareBurn > 0 && p === this._flareHolder(s)) return POSE.flare;
    if (s.sig.mirror && env.sunny && d < SIG.mirrorRange && d > NEAR_WAVE && p === this._flareHolder(s)) return POSE.mirror;
    const kind = s.carrier?.kind;
    if (kind === 'raft' && env.bWet && Math.hypot(env.bx - s.position.x, env.bz - s.position.z) < 15) return POSE.raise;
    // in a raft only the one in the doorway waves; the others sit up and watch
    if (kind === 'raft' && p !== s.people[0]) return POSE.sit;
    // forearm over the face in strong downwash
    if (env.dwS > 0.35 && Math.hypot(p.x - env.hx, p.z - env.hz) < env.dwR * 0.85 && env.alt < 20 && w >= 0.4) return POSE.shield;
    const excited = s.excite > 0;
    const keel = kind === 'hull' && s.carrier?.style !== 'plane';
    if (w < 0.4) return d < SEEN_RANGE || excited ? POSE.limp : onCarrier ? (keel ? POSE.keel : POSE.deck) : POSE.idle;
    // a group on a deck reacts unevenly: most wave, the one holding up a neighbour or sitting
    // exhausted keeps still, a few wave with both arms early
    const crew = onCarrier && !keel && kind !== 'raft' ? variant(p, 5) : 0;
    if (d < NEAR_WAVE || excited) return crew === 3 ? POSE.wave1 : POSE.wave2;
    if (d < SEEN_RANGE) return crew === 3 || (crew === 2 && p.legFold > 0.5) ? POSE.deck : crew === 4 ? POSE.wave2 : POSE.wave1;
    if (s.flower) return POSE.hold;
    if (kind === 'raft') return POSE.sit;
    if (keel) return POSE.keel;
    if (kind === 'hull' || kind === 'container' || kind === 'barge' || kind === 'wreck' || kind === 'rig') return POSE.deck;
    return POSE.idle;
  }

  // Pets (NICE, DESIGN §4 #27): the dog barks in time with the basket's approach (faster as it nears).
  _petLife(s, env, dt) {
    const pet = s.pet;
    if (pet.hopT > 0) pet.hopT = Math.max(0, pet.hopT - dt);
    if (pet.kind !== 'dog' || !env.play || s.remaining <= 0 || s.state === 'lost') return;
    const lowering = env.wState === 'lowering' || env.wState === 'down';
    const d = Math.hypot(env.bx - s.position.x, env.bz - s.position.z);
    if (!lowering || d > 25) {
      pet.barkT = 0;
      return;
    }
    pet.barkT -= dt;
    if (pet.barkT <= 0) {
      pet.barkT = 0.45 + 0.08 * d;
      pet.hopT = Math.max(pet.hopT, 0.18);
      this._emit('survivor:pet', { s, pet: 'dog', action: 'bark', distance: d });
    }
  }

  // Draw the pet on the craft (or paddling next to its owner in the water). It leaves with the last person.
  _drawPet(s, c, env, fade) {
    const pet = s.pet;
    if (!pet || s.remaining <= 0 || s.state === 'rescued' || (s.attached && s.remaining <= 1)) return;
    const kind = DEBRIS_KINDS.indexOf(pet.kind) + 1;
    const hop = pet.hopT > 0 ? Math.sin(Math.PI * Math.min(1, pet.hopT / (pet.kind === 'cat' ? 0.8 : 0.18))) * (pet.kind === 'cat' ? 0.45 : 0.1) : 0;
    if (c) {
      c.petSlot(pet.far, _slot);
      c.toWorld(_slot[0], _slot[1], _slot[2], _v);
      // look at the heli when it is near, else along the craft; a lazy idle sway
      const target = s.dHeli < 200 ? Math.atan2(env.hx - _v.x, env.hz - _v.z) - c.yaw : _slot[3];
      pet.yaw += wrapAngle(target - pet.yaw) * (1 - Math.exp(-(env.dt || 0) * 2));
      _q.copy(c.quat).multiply(_q2.setFromAxisAngle(UP, pet.yaw + 0.15 * Math.sin(env.t * 0.9 + s.id)));
      _v.y += hop - fade * 0.4;
    } else {
      // swimming dog: only the head and back above the water, beside the first person
      const p = s.people[0];
      if (!p) return;
      const a = p.yaw + Math.PI / 2;
      _v.set(p.x + Math.sin(a) * 0.9, p.waterY - 0.24 * S - fade * 0.4, p.z + Math.cos(a) * 0.9);
      _q.setFromUnitVectors(UP, s.nrm).multiply(_q2.setFromAxisAngle(UP, p.yaw + 0.3 * Math.sin(env.t * 1.3)));
    }
    _m.compose(_v, _q, _s.set(1, 1, 1));
    this.batches.debris.push(_m, 0, 0, 0, 0, fade, 0, 0, kind);
  }

  _flareHolder(s) {
    return s.people[0] || null;
  }

  // ==============================================================================================
  // Carriers
  _makeCarrier(s, e) {
    const ctx = this.ctx;
    const t = s.type;
    const x = s.position.x;
    const z = s.position.z;
    const rng = this.rng;
    let c = null;
    if (t === 'raft') {
      c = new Carrier('raft', x, z, { phase: rng.next() * 100 });
      c.yaw = rng.next() * Math.PI * 2;
    } else if (t === 'hull') {
      const style = e.style || (this.theme === 'regatta' || /яхт/i.test(e.label || '') ? 'yacht' : 'boat');
      c = new Carrier('hull', x, z, { style, sinkAt: e.sinkTime ?? TYPES.hull.sink, phase: rng.next() * 100 });
      c.yaw = Math.atan2(this.env.windDirX, this.env.windDirZ) + Math.PI / 2 + (rng.next() - 0.5) * 0.6;
      scatterDebris(c, rng);
      if (e.name) this._hullDecal(c, e.name);
    } else if (t === 'plane') {
      // the Ан-2 floats like a capsized hull (sinks on the same clock), nose down, lower wing awash
      c = new Carrier('hull', x, z, { style: 'plane', sinkAt: e.sinkTime ?? TYPES.plane.sink, phase: rng.next() * 100, leeway: TYPES.plane.leeway });
      c.yaw = Math.atan2(this.env.windDirX, this.env.windDirZ) + (rng.next() - 0.5) * 0.8;
      c.pitch = -0.1;
      c.roll = (rng.next() - 0.5) * 0.08;
      scatterDebris(c, rng);
      this._planeDecal(c, e.reg || 'RA-40217');
    } else if (t === 'container') {
      const col = containerPaint(e.color || CONTAINER_COLORS[Math.floor(rng.next() * CONTAINER_COLORS.length)]);
      c = new Carrier('container', x, z, { color: col, phase: rng.next() * 100 });
      c.yaw = rng.next() * Math.PI * 2;
      // awash and listing 5–10° on her flooded end/side
      c.roll = (rng.next() < 0.5 ? -1 : 1) * (0.09 + rng.next() * 0.08);
      c.pitch = (rng.next() - 0.5) * 0.1;
    } else if (t === 'deck' || t === 'wreck') {
      const deckY = Number.isFinite(e.height) ? e.height : t === 'deck' ? 6 : 6;
      const yaw = -(e.heading ?? 0);
      const rig = t === 'deck' ? this._worldDeckNear(x, z, deckY) : null;
      if (rig) {
        c = new Carrier('rig', x, z, { fixed: true, deckY, stand: [0, deckY, 0] });
        c.baseY = 0;
      } else {
        const kind = t === 'wreck' ? 'wreck' : 'barge';
        // «Вайгач» is a trawler, «Северянка» a ferry: pick the wreck model from the def
        const trawler = this.theme === 'trawler' || /траул|trawl|вайгач/i.test(`${e.name || ''} ${e.label || ''} ${e.model || ''}`);
        const batch = this._bigBatch(kind === 'barge' ? 'barge' : trawler ? 'trawler' : 'ferry', deckY);
        const stand = batch.geo.userData.stand;
        // place the hull so that its gathering point is where the def says the people are
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const cx = x - (stand[0] * cs + stand[2] * sn);
        const cz = z - (-stand[0] * sn + stand[2] * cs);
        c = new Carrier(kind, cx, cz, { fixed: kind === 'barge', deckY, stand, yaw, floodTime: e.sinkTime ?? TYPES.wreck.flood, leeway: kind === 'wreck' ? TYPES.wreck.leeway : 0 });
        c.batch = batch;
        if (kind === 'barge') c.roll = 0.13; // aground: a fixed ~7.5° heel
        if (kind === 'wreck') this._wreckDecal(c, e.name || 'Северянка');
      }
      s.deckY = deckY;
    }
    if (c) {
      c.owner = s;
      s.carrier = c;
      this.carriers.push(c);
      // settle the pose right away (no pop on the first frame)
      if (ctx.ocean?.heightAt) {
        c.nrm.set(0, 1, 0);
        c.pose(this.env, ctx.ocean, 0);
      }
      if (t === 'deck' || t === 'wreck') this._structureAnchor(s);
    }
  }

  // The rig's lower deck (world) when the def puts deck survivors on it.
  _worldDeckNear(x, z, y) {
    for (const pad of this.ctx.world?.pads || []) {
      const ld = pad?.lowerDeck;
      if (ld && Math.hypot(ld.x - x, ld.z - z) < 40 && Math.abs((ld.y ?? y) - y) < 4) return ld;
    }
    return null;
  }

  // Deck / wreck: the people stand at the carrier's gathering point (moves as the ferry heels).
  _structureAnchor(s) {
    const c = s.carrier;
    if (!c) return;
    const st = c.stand || [0, c.deckY, 0];
    c.toWorld(st[0], st[1], st[2], _v);
    s.position.set(_v.x, _v.y, _v.z);
    s.deckY = _v.y;
    s.height = _v.y;
    s.velocity.set(c.vel ? c.vel.x : 0, 0, c.vel ? c.vel.z : 0);
  }

  _wreckDecal(c, name) {
    const look = this.ctx.look;
    const dp = c.batch?.geo?.userData?.decal || { x: 4.98, y: (c.deckY || 6) - 2.25, z: -16, w: 11, h: 1.9 };
    const d = nameDecal(look, name, { width: dp.w, height: dp.h });
    const g = new THREE.BufferGeometry();
    // two quads on the bow flanks (port and starboard), baked in the vessel frame
    const quads = [];
    for (const side of [-1, 1]) {
      const pl = new THREE.PlaneGeometry(dp.w, dp.h);
      pl.rotateY(side * Math.PI / 2);
      pl.translate(side * dp.x, dp.y, dp.z);
      quads.push(pl);
    }
    const pos = [];
    const uv = [];
    const nrm = [];
    for (const q of quads) {
      const nq = q.toNonIndexed();
      pos.push(...nq.attributes.position.array);
      uv.push(...nq.attributes.uv.array);
      nrm.push(...nq.attributes.normal.array);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const mesh = new THREE.Mesh(g, d.mat);
    mesh.name = 'survivors.ferryName';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    c.decal = { mesh, tex: d.tex, mat: d.mat, geo: g };
  }

  // Registration across the Ан-2's left upper wing (read from above), dark on the silver dope.
  _planeDecal(c, text) {
    const d = nameDecal(this.ctx.look, text, { color: '#24282A', width: 6.4, height: 1.5 });
    d.geo.rotateX(-Math.PI / 2);
    d.geo.translate(-4.6, PLANE.wingTop + 0.02, PLANE.wingZ);
    d.mat.opacity = 0.85;
    const mesh = new THREE.Mesh(d.geo, d.mat);
    mesh.name = 'survivors.planeReg';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    c.decal = { mesh, tex: d.tex, mat: d.mat, geo: d.geo };
  }

  // «МАРИЯ» on the capsized hull's bottom flanks (one small mesh per named hull, ≤ 4 per mission).
  _hullDecal(c, name) {
    const d = nameDecal(this.ctx.look, name, { color: '#ECEBE6' });
    d.geo.dispose();
    const key = c.style === 'yacht' ? 'yacht' : 'boat';
    this._hullNameGeos = this._hullNameGeos || {};
    const g = this._hullNameGeos[key] || (this._hullNameGeos[key] = hullNameGeometry(key));
    d.mat.opacity = 0.9;
    const mesh = new THREE.Mesh(g, d.mat);
    mesh.name = 'survivors.hullName';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    this.root.add(mesh);
    c.decal = { mesh, tex: d.tex, mat: d.mat, geo: null };
  }

  _disposeCarrier(c) {
    if (c.decal) {
      this.root.remove(c.decal.mesh);
      c.decal.geo?.dispose();
      c.decal.mat.dispose();
      c.decal.tex.dispose();
      c.decal = null;
    }
  }

  // The group is gone from this carrier (rescued / converted): it drifts on and fades away later.
  _releaseCarrier(s) {
    const c = s.carrier;
    if (!c) return;
    if (c.owner === s) c.owner = null;
    const i = c.riders.indexOf(s);
    if (i >= 0) c.riders.splice(i, 1);
    if (c.kind === 'raft' && !c.dropped) c.lampDead = false;
    s.carrier = null;
  }

  // Per-frame carrier life: drift (orphans), pose on the waves, drama (sinking, flooding, tipping).
  _carrier(c, env, dt) {
    const ctx = this.ctx;
    const ocean = ctx.ocean;
    if (!ocean?.heightAt) return;
    if (env.play) c.age += dt;
    c.vel = c.vel || new THREE.Vector3();
    // drift for carriers nobody steers (dropped rafts, emptied craft) and slow structures
    const free = !c.owner || c.kind === 'wreck';
    if (free && !c.fixed && dt > 0) {
      let vx = this.current.x;
      let vz = this.current.y;
      if (ctx.weather?.windAt) {
        ctx.weather.windAt(c.x, c.z, _w);
        vx += c.leeway * _w.x;
        vz += c.leeway * _w.y;
      }
      if (ctx.hazards?.surfaceFlowAt && c.kind !== 'wreck') {
        ctx.hazards.surfaceFlowAt(c.x, c.z, _f.set(0, 0));
        if (Number.isFinite(_f.x + _f.y)) {
          vx += _f.x;
          vz += _f.y;
        }
      }
      c.x += vx * dt;
      c.z += vz * dt;
      c.vel.set(vx, 0, vz);
    } else if (c.owner) c.vel.copy(c.owner.velocity);

    // --- per kind ----------------------------------------------------------------------------------
    if (c.kind === 'raft') {
      if (c.dropped && c.inflate < 1) c.inflate = Math.min(1, c.inflate + dt / 1.8);
      if (c.capsized) {
        c.flipT = (c.flipT || 0) + dt;
        c.flip = smooth(0, 1.2, c.flipT);
      }
      c.raftYaw(env, dt);
      // canopy flutter: downwash (strong near the rotor axis) + a little wind
      let fl = 0.04 * smooth(6, 20, env.windSpeed);
      if (env.heliAlive && env.dwS > 0.01) {
        const d = Math.hypot(c.x - env.hx, c.z - env.hz);
        if (d < env.dwR * 1.2) fl += env.dwS * (1 - smooth(0.2, 1.2, d / env.dwR)) * 1.6;
      }
      c.flutter = approach(c.flutter, Math.min(1.8, fl), 6, dt);
    } else if (c.kind === 'hull') {
      this._hullLife(c, env, dt);
    } else if (c.kind === 'container') {
      this._containerLife(c, env, dt);
      c.yaw += dt * 0.015 * Math.sin(c.phase);
    } else if (c.kind === 'wreck') {
      this._wreckLife(c, env, dt);
    } else if (c.kind === 'barge') {
      this._bargeLife(c, env, dt);
    }
    c.pose(env, ocean, dt);
    c.tapeLit = ocean.searchlightAt ? ocean.searchlightAt(c.x, c.z, c.y + 1.2) : 0;
    // retro tape FLASHES the instant the beam touches (DESIGN §2.10), then glints again every 1.4–3.4 s
    // while the swell rocks the craft in the beam (craft.js: tape only; the canopy lift stays ≤ 1)
    c.tapeFlash *= Math.exp(-dt / 0.3);
    c.tapeGlintT -= dt;
    if (c.tapeLit < 0.15) c.tapeGlintT = 0;
    else if (c.tapeLit > 0.5 && c.tapeGlintT <= 0) {
      c.tapeFlash = 1;
      c.tapeGlintT = 1.4 + 2 * Math.abs(Math.sin(c.phase * 7.3 + env.t * 1.7)); // no rng draw: spawns stay seeded
    }
    // leftovers (empty rafts, capsized rafts, abandoned containers) fade out after a while
    const occupied = c.owner || c.riders.length;
    if (!occupied && c.kind !== 'wreck' && c.kind !== 'barge' && c.kind !== 'rig') {
      c.emptyT += dt;
      if (c.emptyT > (c.dropped ? 240 : 60)) c.dissolve = Math.min(1, c.dissolve + dt / 4);
      if (c.dissolve >= 1) c.alive = false;
    } else c.emptyT = 0;
  }

  // Capsized hull: sinks after 200 s (telegraph from 30 s before: draft rises, bubbles, creaks).
  _hullLife(c, env, dt) {
    const ctx = this.ctx;
    const left = c.sinkAt - c.age;
    // a thin oil sheen leaking from her (water memory A, 600 s half-life — stamps add up, so keep them
    // faint and few: the slick trails behind her as she drifts)
    if (env.play && dt > 0 && c.oilN < 40) {
      c.oilT -= dt;
      if (c.oilT <= 0 && c.sinking < 1) {
        c.oilT = 5 + 2 * this.rng.next();
        c.oilN++;
        const r = this.rng.next() * 5;
        ctx.ocean?.stamp?.('oil', c.x - env.windDirX * r + (this.rng.next() - 0.5) * 4, c.z - env.windDirZ * r + (this.rng.next() - 0.5) * 4, { radius: 3.5 + 3 * this.rng.next(), strength: 0.07 });
      }
    }
    if (left < 30 && c.sinking < 1) {
      const k = clamp01(1 - left / 30);
      c.sink = 0.55 * k * k;
      if (!c.warned && c.owner) {
        c.warned = true;
        this._emit('survivor:sinking', { s: c.owner, phase: 'warn' });
      }
      if (env.play && dt > 0) {
        c.bubbleT -= dt;
        if (c.bubbleT <= 0) {
          c.bubbleT = 0.25 + 0.4 * (1 - k);
          const a = this.rng.next() * Math.PI * 2;
          const bx = c.x + Math.cos(a) * 2.5;
          const bz = c.z + Math.sin(a) * 2.5;
          ctx.ocean?.stamp?.('foam', bx, bz, { radius: 1.2 + 1.5 * k, strength: 0.6 });
          if (this.rng.next() < 0.35) ctx.fx?.splash?.(bx, 0, bz, 0.4 + 0.5 * k);
        }
        c.creakT -= dt;
        if (c.creakT <= 0 && c.owner) {
          c.creakT = 3 + this.rng.next() * 3;
          this._emit('survivor:creak', { s: c.owner, x: c.x, z: c.z });
        }
      }
    }
    if (left <= 0) {
      if (c.owner) this._abandon(c.owner, 'sunk');
      c.sinking = Math.min(1, c.sinking + dt / 8);
      c.sink = 0.55 + 3.2 * c.sinking * c.sinking;
      c.roll = 0.25 * c.sinking;
      if (c.sinking > 0.4) c.dissolve = Math.min(1, (c.sinking - 0.4) / 0.6);
      if (c.sinking >= 1) c.alive = false;
    }
    // debris drifts with the hull and spreads slowly
    for (const d of c.debris) {
      if (dt > 0) {
        d.dx *= 1 + 0.004 * dt;
        d.dz *= 1 + 0.004 * dt;
        d.yaw += d.spin * dt;
      }
      d.x = c.x + d.dx;
      d.z = c.z + d.dz;
    }
  }

  // Container: in a big sea (Hs ≥ 4 m) it heels every ~40 s and somebody goes into the water.
  _containerLife(c, env, dt) {
    if (c.tip > 0 || c.tipPhase > 0) {
      c.tipPhase += dt;
      const t = c.tipPhase;
      c.tip = t < 1.2 ? smooth(0, 1.2, t) : 1 - smooth(1.2, 4.2, t);
      if (t > 1.0 && !c.tipDone) {
        c.tipDone = true;
        const s = c.owner;
        if (s && s.people.length > 0) {
          const p = s.people[s.people.length - 1];
          s.people.length -= 1;
          const side = c.tipDir;
          const cs = Math.cos(c.yaw);
          const sn = Math.sin(c.yaw);
          this._emit('survivor:tip', { s });
          // +roll lifts the +X side: people slide off the other side
          this._splitPerson(s, p, c.x - cs * side * 3.4, c.z + sn * side * 3.4, 'tip');
        }
      }
      if (t > 4.2) {
        c.tipPhase = 0;
        c.tip = 0;
      }
      c.roll = c.baseRoll + c.tipDir * 0.42 * c.tip;
      return;
    }
    if (c.baseRoll === undefined) c.baseRoll = c.roll;
    if (env.play && env.Hs >= 4 && c.owner && c.owner.people.length > 0) {
      c.tipT += dt;
      if (c.tipT >= TYPES.container.tipEvery) {
        c.tipT = 0;
        c.tipPhase = 1e-4;
        c.tipDone = false;
        c.tipDir = this.rng.next() < 0.5 ? -1 : 1;
      }
    }
  }

  // Barge aground: surf breaks along her low (−X) side and around the raked ends.
  _bargeLife(c, env, dt) {
    if (!env.play || !(dt > 0)) return;
    c.washT = (c.washT || 0) - dt;
    if (c.washT > 0) return;
    const ud = c.batch?.geo?.userData || {};
    const L = ud.L || 34;
    const B = ud.B || 10;
    c.washT = (0.9 + 0.9 * this.rng.next()) / (0.6 + 0.25 * Math.min(4, env.Hs));
    const end = this.rng.next() < 0.25;
    const lz = end ? (this.rng.next() < 0.5 ? -1 : 1) * L * 0.5 : (this.rng.next() - 0.5) * L * 0.9;
    const lx = end ? (this.rng.next() - 0.5) * B : -B * 0.5 - 0.3;
    c.toWorld(lx, 0, lz, _v);
    this.ctx.ocean?.stamp?.('foam', _v.x, _v.z, { radius: 1.2 + 1.4 * this.rng.next(), strength: 0.18 + 0.06 * Math.min(4, env.Hs) });
    if (this.rng.next() < 0.18 + 0.1 * Math.min(4, env.Hs)) this.ctx.fx?.splash?.(_v.x, 0, _v.z, 0.5 + 0.25 * Math.min(4, env.Hs));
  }

  // Sinking ferry: heel grows, bow goes down, lights flicker and die; jumpers from 70 %, then she goes.
  _wreckLife(c, env, dt) {
    const ctx = this.ctx;
    c.flood = clamp01(c.age / Math.max(30, c.floodTime));
    const f = c.flood;
    // a visible list from the first look (≥ 8°), growing to ~30° before she goes
    c.roll = -(0.15 + 0.36 * Math.pow(f, 1.3)) - 0.3 * c.sinking;
    c.pitch = -(0.04 + 0.12 * f) - 0.5 * c.sinking * c.sinking;
    c.sink = 0.6 + 2.2 * f + 22 * c.sinking * c.sinking;
    // lights: cabins glow at night / under heavy overcast only (dark glass mirroring the sky by day);
    // they flicker more as she floods and are gone by 88 %
    const flick = f > 0.35 ? (Math.sin(env.t * 31 + c.phase) * Math.sin(env.t * 7.3) > 0.55 - 0.9 * (f - 0.35) ? 0.15 : 1) : 1;
    const dim = Math.max(env.night, env.sunny ? 0 : 0.3);
    c.lights = (1 - smooth(0.78, 0.88, f)) * flick * dim;
    // the low (starboard, +X) side: sea washing over the deck edge, foam along the waterline, and her
    // oil sheen trailing downwind (stamps fade over minutes; keep them few)
    if (env.play && dt > 0 && c.sinking < 1) {
      c.washT = (c.washT || 0) - dt;
      if (c.washT <= 0) {
        const L = c.batch?.geo?.userData?.L || 50;
        c.washT = 1.1 + 0.9 * this.rng.next();
        const lz = (this.rng.next() - 0.5) * L * 0.8;
        c.toWorld(c.batch?.geo?.userData?.B * 0.5 || 5, 0, lz, _v);
        ctx.ocean?.stamp?.('foam', _v.x, _v.z, { radius: 1.4 + 1.6 * this.rng.next(), strength: 0.2 + 0.25 * f });
        // once the deck edge is near the water, green water pours across it
        c.toWorld(5.5, c.deckY, lz, _v);
        if (_v.y < 1.6 && this.rng.next() < 0.5) ctx.fx?.splash?.(_v.x, Math.max(0, _v.y), _v.z, 0.5 + 0.6 * f);
      }
      c.oilT -= dt;
      if (c.oilT <= 0 && c.oilN < 36) {
        c.oilT = 6 + 3 * this.rng.next();
        c.oilN++;
        const r = 8 + this.rng.next() * 22;
        ctx.ocean?.stamp?.('oil', c.x + env.windDirX * r + (this.rng.next() - 0.5) * 8, c.z + env.windDirZ * r + (this.rng.next() - 0.5) * 8, { radius: 6 + 6 * this.rng.next(), strength: 0.06 });
      }
    }
    const s = c.owner;
    if (s && env.play && f >= 0.7 && s.people.length > 0 && !c.sinking) {
      s.jumpT -= dt;
      if (s.jumpT <= 0) {
        s.jumpT = 5;
        const p = s.people.pop();
        // jumps off the low side, a little aft of the gathering point
        const st = c.stand || [0, c.deckY, 0];
        c.toWorld(st[0] + 8, 0, st[2] + 2, _v);
        this._splitPerson(s, p, _v.x + (this.rng.next() - 0.5) * 3, _v.z + (this.rng.next() - 0.5) * 3, 'jump');
      }
    }
    if (f >= 1) {
      if (s && s.carrier === c) this._abandon(s, 'sunk');
      c.sinking = Math.min(1, c.sinking + dt / 14);
      if (env.play && dt > 0 && this.rng.next() < dt * 6) {
        const a = this.rng.next() * Math.PI * 2;
        ctx.ocean?.stamp?.('foam', c.x + Math.cos(a) * 12, c.z + Math.sin(a) * 12, { radius: 4, strength: 0.8 });
      }
      if (c.sinking > 0.55) c.dissolve = Math.min(1, (c.sinking - 0.55) / 0.45);
      if (c.sinking >= 1) c.alive = false;
    }
  }

  // ==============================================================================================
  // Drawing
  _draw(env, dt) {
    const ctx = this.ctx;
    const ocean = ctx.ocean;
    const crowd = this.crowd;
    const B = this.batches;
    InstanceBounds.setView(ctx.camera);
    crowd.begin();
    for (const b of this.batchList) b.begin();
    for (const b of this.bigBatches) b.begin();
    for (const h of this.heatList) h.begin();
    this.collars.begin();
    this.glows.begin();
    this.lines.begin();
    const night = env.night;
    const rf = env.reduceFlashes;

    // --- carriers ----------------------------------------------------------------------------------
    for (const c of this.carriers) {
      const occupants = this._occupants(c);
      const lit = c.tapeLit;
      const tape = lit + 3 * c.tapeFlash;
      if (c.kind === 'raft') {
        // canopy lamp 60/min; dead when the raft is capsized or its people are lost
        const lampOn = !c.lampDead && !c.capsized && (env.t + c.lampPhase) % SIG.lampPeriod < 0.13;
        const lamp = lampOn ? (rf ? 0.4 : 1) : 0;
        const chem = !c.capsized && night > 0.45 && !c.dropped ? 1 : 0;
        B.raft.push(c.matrix, tape, lamp, c.flutter, 0, c.dissolve, chem, c.phase);
        if (occupants && !c.capsized) this.heat.raft.push(c.matrix);
        if (lamp > 0) {
          c.toWorld(0, RAFT.canopyTop + 0.25, 0, _v);
          this.glows.add(_v.x, _v.y, _v.z, 0.35, C_LAMP, (2 + 6 * night) * lamp, 3.5, (0.3 + 1.6 * night) * lamp, 1, env.t * 0.2);
          if (night > 0.2) ocean?.addGlint?.(c.x, c.z, 2.5, 0.9 * lamp * night, C_LAMP);
        }
        if (chem) {
          c.toWorld(RAFT.R * 0.5, RAFT.canopyTop - 0.2, RAFT.R * 0.35, _v);
          this.glows.add(_v.x, _v.y, _v.z, 0.18, C_CHEM, 1.6, 1.4, 0.45, 0);
        }
        if (lit > 0.25 && this.quality === 'low') {
          c.toWorld(0, RAFT.canopyTop, 0, _v);
          this.glows.add(_v.x, _v.y, _v.z, 0.3, C_TAPE, 2.5 * lit, 2.2, 0.6 * lit, 1, 0.6);
        }
        this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, RAFT.R + RAFT.tube * 0.8, 0.85 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase);
        // sea anchor line streaming upwind to the drogue
        if (!c.capsized && c.inflate > 0.9 && !c.dropped) this._anchorLine(c, ocean);
      } else if (c.kind === 'hull') {
        const plane = c.style === 'plane';
        const b = plane ? B.plane : c.style === 'yacht' ? B.yacht : B.boat;
        b.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase);
        if (occupants && c.dissolve < 0.5) this.heat[plane ? 'plane' : c.style === 'yacht' ? 'yacht' : 'boat'].push(c.matrix);
        if (c.decal) {
          // matrix AND matrixWorld: the parent's world update would otherwise overwrite our copy
          c.decal.mesh.matrix.copy(c.matrix);
          c.decal.mesh.matrixWorld.copy(c.matrix);
          c.decal.mesh.visible = c.dissolve < 0.4;
          c.decal.mat.opacity = 0.9 * (1 - c.dissolve * 2.5);
        }
        const yaw = c.yaw;
        if (plane) {
          // fuselage + the awash lower wing
          this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.05, 0.8 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, yaw, 3.6);
          c.toWorld(0, 0, PLANE.wingZ, _v);
          this.collars.push(_v.x, c.y, _v.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.0, 0.7 * (1 - c.dissolve), 0.6 * (1 - c.dissolve), lit, c.phase + 2, yaw + Math.PI / 2, 4.6);
        } else this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, c.style === 'yacht' ? 1.95 : 1.75, 0.8 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, yaw, c.elong);
        for (const d of c.debris) {
          d.y = ocean.heightAt(d.x, d.z);
          _q.setFromAxisAngle(UP, d.yaw);
          _m.compose(_v.set(d.x, d.y + 0.02, d.z), _q, _s.set(1, 1, 1));
          B.debris.push(_m, 0, 0, 0, 0, c.dissolve * 0.7, 0, 0, DEBRIS_KINDS.indexOf(d.kind) + 1);
        }
      } else if (c.kind === 'container') {
        B.container.push(c.matrix, tape, 0, 0, 0, c.dissolve, 0, c.phase, 0, c.color);
        // swell washing over the roof: foam where the sea stands above the roof at either end
        if (env.play && dt > 0 && ocean?.stamp) {
          c.washT = (c.washT || 0) - dt;
          if (c.washT <= 0) {
            c.washT = 0.45;
            for (let e = -1; e <= 1; e += 2) {
              c.toWorld(0, CONT.freeboard, e * CONT.L * 0.42, _v);
              if (ocean.heightAt(_v.x, _v.z) > _v.y - 0.12) {
                ocean.stamp('foam', _v.x, _v.z, { radius: 1.5, strength: 0.55 });
                c.washT = 1.1;
              }
            }
          }
        }
        this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.4, 0.9 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, c.yaw, 2.4);
      } else if (c.kind === 'barge' || c.kind === 'wreck') {
        c.batch.push(c.matrix, tape, 0, 0, c.kind === 'wreck' ? c.lights : Math.max(night, env.sunny ? 0 : 0.25), c.dissolve, 0, c.phase);
        const gu = c.batch.geo.userData;
        this.collars.push(c.x, c.y + (c.kind === 'wreck' ? 0.3 : 0), c.z, 0, 1, 0, gu.collarR || 5.6, c.kind === 'wreck' ? 1 : 0.7, 1, lit, c.phase, c.yaw, gu.elong || 3.2);
        if (c.decal) {
          c.decal.mesh.matrix.copy(c.matrix);
          c.decal.mesh.matrixWorld.copy(c.matrix);
          c.decal.mesh.visible = c.dissolve < 0.5;
          c.decal.mat.opacity = 0.92 * (1 - c.dissolve * 2);
        }
      }
      // people aboard (owner + riders), as many as the craft shows
      if (occupants) this._drawAboard(c, env, dt);
      if (c.owner?.pet) this._drawPet(c.owner, c, env, c.owner.state === 'lost' ? clamp01(c.owner.lostT / LOST_FADE) : 0);
    }

    // --- groups without a carrier (swimmers, the injured, flower rings) ---------------------------
    for (const s of this.list) {
      if (s.attached) this._drawAttached(s, env, dt);
      if (s.carrier) continue;
      if (s.state === 'rescued') continue;
      if (s.state === 'lost' && s.lostT > LOST_FADE + 0.2) continue;
      this._drawSwimmers(s, env, dt);
      if (s.pet && s.pet.kind === 'dog') this._drawPet(s, null, env, s.state === 'lost' ? clamp01(s.lostT / LOST_FADE) : 0);
    }

    // --- lost-person markers: grey buoy («ПОТЕРЯН» is the HUD's label) ------------------------------
    for (const m of this.lostMarkers) {
      m.y = ocean?.heightAt ? ocean.heightAt(m.x, m.z) : 0;
      if (ocean?.normalAt) {
        ocean.normalAt(m.x, m.z, _n);
        m.nrm.lerp(_n, dt > 0 ? 1 - Math.exp(-dt / 0.3) : 0).normalize();
      }
      _q.setFromUnitVectors(UP, m.nrm);
      const rise = smooth(0, 2.5, env.t - m.t);
      _m.compose(_v.set(m.x, m.y - 1.6 * (1 - rise), m.z), _q, _s.set(1, 1, 1));
      B.buoy.push(_m, 0, 0, 0, 0.5, 0, 0, m.phase);
      this.collars.push(m.x, m.y, m.z, m.nrm.x, m.nrm.y, m.nrm.z, 0.32, 0.7 * rise, 0.8, 0, m.phase);
    }

    this.bottle.frame(env, dt);
    crowd.end();
    for (const b of this.batchList) b.end();
    for (const b of this.bigBatches) b.end();
    for (const h of this.heatList) h.end();
    this.collars.end();
    this.glows.end();
    this.lines.end();
    this.ghostUniforms();
    if (this._warm > 0) this._warmup();
  }

  // Empty batches are hidden (no draw, no shadow pass). For the first frames keep everything visible
  // so every program compiles up front with the final light set, not on the first raft of the night.
  _warmup() {
    this._warm--;
    for (const o of this.root.children) if (o.isMesh && !(o.isInstancedMesh && o.count > 0 && o.visible)) o.visible = true;
  }

  ghostUniforms() {
    const env = this.env;
    const u = this.crowd.ghostMaterial.uniforms;
    u.uLight.value.copy(env.ghostLight);
    const pal = this.ctx.weather?.state?.palette;
    if (pal?.body?.isColor) u.uWater.value.copy(pal.body);
    this.collars.material.uniforms.uFoam.value.copy(env.foam);
    // day rim (DESIGN §2.7.3: hemiSky·pow(1 − N·V, 3)·.35) and the vest's own read in dim daylight
    const day = 1 - env.night;
    if (pal?.sky?.isColor) this.rim.value.copy(pal.sky).multiplyScalar(0.35 * day);
    else this.rim.value.setRGB(0.1, 0.12, 0.14).multiplyScalar(day);
    // night: craft keep a faint moonlit-hemisphere floor so they never fall below the sea's luminance
    this.nightAmb.value.setRGB(0.009, 0.012, 0.016).multiplyScalar(env.night);
    this.crowd.keylineOn = env.night > 0.45;
    const lightLevel = (pal?.sunIntensity ?? 2) * 0.4 + (pal?.ambientIntensity ?? 0.6) * 0.5;
    // under a heavy overcast the whole sky dome lights the decks; the hemisphere alone leaves a rusty
    // barge or a wet steel deck darker than the sea around it (a black brick) — add the missing dome
    // (the ocean mirrors the sky at full radiance; a Lambert hemisphere gives props only ambient/π)
    // (storms only: in fog the ferry must melt into the white, not glow out of it). A storm's own gloom
    // (night ≈ .35) and rain haze (fog ≈ .45) are still daylight under a dome: only real night and real
    // fog switch the fill off, otherwise the storm got less dome than overcast and the barge sank below the sea
    const dome = smooth(0.9, 0.4, env.night) * smooth(1.25, 0.5, lightLevel) * clamp01(env.intensity * 1.5) * (1 - 0.8 * smooth(0.5, 0.9, env.fog)) * (pal?.ambientIntensity ?? 0.6) * 2.0;
    if (pal?.ambient?.isColor) this.skyFill.value.copy(pal.ambient).multiplyScalar(dome);
    else this.skyFill.value.setRGB(0.12, 0.14, 0.15).multiplyScalar(dome);
    // big dark-steel hulls have no fluorescent fabric or foam collar of their own read: under a storm sky
    // (no sun term left) only the dome lights them, so they take ~2.6× the small-craft fill there —
    // the barge deck stays ≈1.4× the storm sea's luminance, as in overcast (gain ≈ 1 by overcast)
    this.steelFill.value.copy(this.skyFill.value).multiplyScalar(1 + 1.6 * smooth(0.95, 0.55, lightLevel));
    // ≥ 0.05: the vest keeps its #FF5A00 hue under the warm sunset / storm hemisphere instead of going red
    this.crowd.material.userData.uniforms.uVestGlow.value = 0.05 + day * (0.16 * clamp01(1 - lightLevel) + 0.32 * clamp01(env.intensity || 0)); // fluorescent pigment pops under storm cloud (DESIGN §2.1: vest L ≈ 0.55)
  }

  _occupants(c) {
    if (c.owner && c.owner.state !== 'rescued') return true;
    for (const r of c.riders) if (r.people.length || r.state === 'lost') return true;
    return false;
  }

  _anchorLine(c, ocean) {
    c.toWorld(0, RAFT.tube, -RAFT.R - RAFT.tube, _v);
    const ax = c.anchor.x;
    const az = c.anchor.z;
    const n = 6;
    let px = _v.x;
    let py = _v.y;
    let pz = _v.z;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = _v.x + (ax - _v.x) * k;
      const z = _v.z + (az - _v.z) * k;
      // a wet line sagging into the sea between the raft's patch and the drogue (catenary below the
      // surface in the middle, only its ends at the top)
      const y = (ocean.heightAt ? ocean.heightAt(x, z) : 0) + 0.3 * (1 - k) * (1 - k) - 0.22 * Math.sin(Math.PI * k) - 0.12 * k * k;
      this.lines.seg(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
    // the drogue itself: a small dark-orange fabric cone, mostly submerged (rim awash)
    _q.setFromAxisAngle(UP, Math.atan2(_v.x - ax, _v.z - az));
    _m.compose(_v2.set(ax, py - 0.02, az), _q, _s.set(1, 1, 1));
    this.batches.debris.push(_m, 0, 0, 0, 0, 0, 0, 0, DEBRIS_KINDS.indexOf('drogue') + 1);
  }

  // People aboard a carrier (raft doorway, keel, container roof, decks).
  _drawAboard(c, env, dt) {
    const raise = c.kind === 'raft' && env.bWet && Math.hypot(env.bx - c.x, env.bz - c.z) < 15;
    const seats = c.visibleSeats(raise);
    let i = 0;
    // the owner first, then riders (no per-frame array: k = −1 is the owner)
    const owner = c.owner;
    let total = owner ? owner.people.length : 0;
    for (const g of c.riders) total += g.people.length;
    for (let k = owner ? -1 : 0; k < c.riders.length; k++) {
      const s = k < 0 ? owner : c.riders[k];
      if (s.state === 'rescued' && !s.people.length) continue;
      const fade = s.state === 'lost' ? clamp01(s.lostT / LOST_FADE) : 0;
      if (s.state === 'lost' && s.lostT > LOST_FADE + 0.2) continue;
      for (const p of s.people) {
        if (i >= seats) break;
        c.slotFor(i, Math.min(total, seats), _slot);
        c.toWorld(_slot[0], _slot[1], _slot[2], _v);
        p.x = _v.x;
        p.y = _v.y;
        p.z = _v.z;
        p.waterY = -50; // people aboard have nothing under the surface (no ghost, no keyline clip)
        p.legFold = _slot[3]; // seated (poses: arms round the knees)
        // face the heli when it is around, else look along the craft
        const jit = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5; // per-seat facing noise (no pawn grid)
        const target = (s.dHeli < 400 ? Math.atan2(env.hx - p.x, env.hz - p.z) + jit * 0.7 : c.yaw + (c.kind === 'hull' ? (i % 2 ? Math.PI / 2 : -Math.PI / 2) : jit * 2.2));
        p.yaw += wrapAngle(target - p.yaw) * (1 - Math.exp(-dt * 1.4));
        const pose = this._poseFor(s, p, env, true);
        if (pose !== POSE.frozen) applyPose(p, poseTargets(pose, p, env.t, _pose, 4), dt);
        // tilt with the craft (structures: people stand upright, a little lean with the heel)
        const tilt = c.kind === 'wreck' || c.kind === 'barge' || c.kind === 'rig' ? 0.25 : 0.8;
        _n.copy(c.nrm).lerp(UP, 1 - tilt).normalize();
        _q.setFromUnitVectors(UP, _n);
        if (c.kind === 'wreck' && tilt) {
          _e.set(c.pitch * 0.3, 0, c.roll * 0.3);
          _q.multiply(_q2.setFromEuler(_e));
        }
        _q.multiply(_q2.setFromAxisAngle(UP, p.yaw));
        _m.compose(_v.set(p.x, p.y - fade * 0.6, p.z), _q, _s.setScalar(p.scale));
        const tape = this.ctx.ocean?.searchlightAt ? this.ctx.ocean.searchlightAt(p.x, p.z, p.y) : 0;
        this.crowd.push(_m, p.aL, p.pL, p.aR, p.pR, _slot[3], fade, p.skin, p.hood, p.jacket, p.pants, tape, this._strobe(s, p, env), p.waterY, tape * 0.6);
        this._signalVisuals(s, p, env, tape);
        i++;
      }
    }
  }

  // Swimmers: a single person, or the «цветок» ring of 2+ holding hands (shrinks as they cool).
  _drawSwimmers(s, env, dt) {
    const ctx = this.ctx;
    const ocean = ctx.ocean;
    const n = s.people.length;
    if (!n) return;
    const fade = s.state === 'lost' ? clamp01(s.lostT / LOST_FADE) : 0;
    // group tilt with a 0.3 s lag
    if (ocean?.normalAt) {
      ocean.normalAt(s.position.x, s.position.z, _n);
      s.nrm.lerp(_n, dt > 0 ? 1 - Math.exp(-dt / 0.3) : 0).normalize();
    }
    const supine = s.type === 'injured';
    let r = 0;
    if (n > 1) {
      r = (0.8 + 0.4 * s.health) * S * (0.55 + 0.11 * n);
      if (dt > 0 && s.state !== 'lost') s.ringSpin += dt * 0.025;
    }
    for (let i = 0; i < n; i++) {
      const p = s.people[i];
      const a = s.ringSpin + (i / n) * Math.PI * 2;
      const px = s.position.x + Math.cos(a) * r;
      const pz = s.position.z + Math.sin(a) * r;
      const wy = ocean?.heightAt ? ocean.heightAt(px, pz) : 0;
      p.x = px;
      p.z = pz;
      p.waterY = wy;
      // bob: the vest rides the surface, a little lag up and down
      const bob = 0.05 * Math.sin(env.t * 1.3 + p.phase);
      p.y = wy + bob + (supine ? 0.1 : 0) - fade * 0.7;
      const pose = this._poseFor(s, p, env, false);
      // face the heli (turn slowly); ring people face the centre while holding hands
      let target;
      if (pose === POSE.hold) target = Math.atan2(s.position.x - px, s.position.z - pz);
      else if (s.dHeli < 450) target = Math.atan2(env.hx - px, env.hz - pz);
      else target = p.yaw;
      if (pose !== POSE.frozen) {
        p.yaw += wrapAngle(target - p.yaw) * (1 - Math.exp(-dt * (pose === POSE.panic ? 2.5 : 1.2)));
        applyPose(p, poseTargets(pose, p, env.t, _pose, n), dt);
      }
      _q.setFromUnitVectors(UP, s.nrm);
      _q.multiply(_q2.setFromAxisAngle(UP, p.yaw + (pose === POSE.panic ? 0.25 * Math.sin(env.t * 5 + p.phase) : 0)));
      if (supine) _q.multiply(SUPINE);
      else {
        // floating in a vest: leaned back a little, more as they tire
        _q.multiply(_q3.setFromAxisAngle(_v2.set(1, 0, 0), -0.18 - 0.25 * (1 - s.health)));
      }
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s.setScalar(p.scale));
      const tape = ocean?.searchlightAt ? ocean.searchlightAt(p.x, p.z, p.y + 0.3) : 0;
      this.crowd.push(_m, p.aL, p.pL, p.aR, p.pR, 0, fade, p.skin, p.hood, p.jacket, p.pants, tape, this._strobe(s, p, env), wy, tape * 0.6);
      // collar & contact disc per person; splashier when swimming or flailing
      const busy = s.swimTo || pose === POSE.panic || pose === POSE.wave2 ? 0.85 : 0.5;
      this.collars.push(p.x, wy, p.z, s.nrm.x, s.nrm.y, s.nrm.z, supine ? 0.62 * S : 0.42 * S, busy * (1 - fade), 1 - fade, tape, p.phase, supine ? p.yaw : 0, supine ? 1.8 : 1);
      if (s.swimTo && dt > 0 && ocean?.addWake) ocean.addWake(p.x, p.z, 0.4, s.velocity.x, s.velocity.z);
      // strokes / flailing break the surface: a small splash at the hand and a ripple ring per stroke
      if (env.play && dt > 0 && !supine && fade < 0.5 && (s.swimTo || pose === POSE.panic || pose === POSE.wave2)) {
        p.strokeT = (p.strokeT ?? p.phase % 0.8) - dt;
        if (p.strokeT <= 0) {
          p.strokeT = 0.65 + 0.35 * this.rng.next();
          p.strokeSide = -(p.strokeSide || 1);
          const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
          const hx = p.x + (cy * p.strokeSide * 0.32 + sy * 0.3) * S;
          const hz = p.z + (-sy * p.strokeSide * 0.32 + cy * 0.3) * S;
          ctx.fx?.splash?.(hx, wy, hz, 0.3);
          if (s.dHeli < 160) ocean?.stamp?.('ring', hx, hz, { radius: 0.9, strength: 0.3 });
        }
      }
      this._signalVisuals(s, p, env, tape);
    }
  }

  // The person on the cable: in the basket (crouched, hands on the strop) or on the stretcher.
  _drawAttached(s, env, dt) {
    const ctx = this.ctx;
    const h = ctx.heli;
    const p = s.attached;
    const bm = h?.winchCtl?.basketMesh;
    if (bm && bm.visible) {
      _v.copy(bm.position);
      _q.copy(bm.quaternion);
    } else if (h?.winch?.basket) {
      _v.copy(h.winch.basket);
      p.spin += dt * 0.35;
      _q.setFromAxisAngle(UP, p.spin);
    } else return;
    const up = _n.set(0, 1, 0).applyQuaternion(_q);
    if (s.type === 'injured') {
      // Stokes litter hanging under the hook, casualty strapped in face up
      _m.compose(_v2.copy(_v).addScaledVector(up, -0.25), _q, _s.set(1, 1, 1));
      this.batches.stretcher.push(_m, 0, 0, 0, 0, 0, 0, 0);
      _q2.copy(_q).multiply(_q3.setFromAxisAngle(_v2.set(1, 0, 0), -Math.PI / 2));
      // the body runs head (−z) to feet (+z) from its origin: centre it on the litter
      const along = _s.set(0, 0, 1).applyQuaternion(_q);
      _v2.copy(_v).addScaledVector(up, 0.02).addScaledVector(along, -0.67 * p.scale);
      _m.compose(_v2, _q2, _s.setScalar(p.scale));
      applyPose(p, poseTargets(POSE.stretcher, p, env.t, _pose), dt);
      this.crowd.push(_m, p.aL, p.pL, p.aR, p.pR, 0, 0, p.skin, p.hood, p.jacket, p.pants, 0, 0, -50, 0);
      return;
    }
    // slow spin on the cable (the basket's own spin), crouched in the basket, hands on the strop
    _m.compose(_v2.copy(_v).addScaledVector(up, 0.92), _q, _s.setScalar(p.scale));
    applyPose(p, poseTargets(POSE.cable, p, env.t, _pose), dt);
    const tape = ctx.ocean?.searchlightAt ? ctx.ocean.searchlightAt(_v.x, _v.z, _v.y) : 0;
    const wy = ctx.ocean?.heightAt ? ctx.ocean.heightAt(_v.x, _v.z) : 0;
    this.crowd.push(_m, p.aL, p.pL, p.aR, p.pR, 1, 0, p.skin, p.hood, p.jacket, p.pants, tape, 0, wy, 0);
  }

  // Personal strobe: 60 ms every 1.5 s in a random phase (reduce flashes: 40 %, still ≤ 1 Hz).
  _strobe(s, p, env) {
    if (s.state === 'lost' || !strobeOn(s, env.night)) return 0;
    const ph = (env.t + p.strobePhase) % SIG.strobePeriod;
    // never miss a flash at a low frame rate: the frame that crosses the start shows it
    const on = ph < SIG.strobeOn || (env.dt > SIG.strobeOn && ph < env.dt + 0.001);
    if (!on) return 0;
    const k = env.reduceFlashes ? 0.4 : 1;
    // light on the water and a star you can find the person by
    this.ctx.ocean?.addGlint?.(p.x, p.z, 3.2, 1.6 * k, C_STROBE);
    const haze = clamp01(Math.max(env.fog, env.intensity));
    this.glows.add(p.x, p.y + 0.4 * S, p.z, 0.25, C_STROBE, 9 * k, 0.8 + 3.7 * haze, (0.6 + 0.8 * haze) * k, 1, env.t * 0.37);
    return k;
  }

  // Signal visuals attached to a person: the handheld flare follows the hand, mirror star.
  _signalVisuals(s, p, env, tape) {
    const sig = s.sig;
    if (p !== s.people[0]) {
      if (tape > 0.35 && this.quality === 'low') this.glows.add(p.x, p.y + 0.25 * S, p.z, 0.2, C_TAPE, 2.5 * tape, 1.6, 0.5 * tape, 1, 0.3);
      return;
    }
    // hand position for the raised arm (approximate: above the shoulder on the waving side)
    const side = p.waveArm;
    const cy = Math.cos(p.yaw);
    const sy = Math.sin(p.yaw);
    const hx = p.x + cy * side * 0.35;
    const hz = p.z - sy * side * 0.35;
    const hy = p.y + 1.2 * S;
    if (sig.flareBurn > 0 && sig.flareObj) {
      const f = sig.flareObj;
      if (f.alive !== false) {
        f.x = hx;
        f.z = hz;
      }
    }
    if (sig.mirrorFlash > 0) {
      const k = Math.sin(Math.PI * clamp01(sig.mirrorFlash / SIG.mirrorFlash));
      this.glows.add(hx, hy, hz, 0.3, C_MIRROR, 10 * k * (env.reduceFlashes ? 0.4 : 1), 6, 1.6 * k, 1, 0.785);
    }
    if (tape > 0.35 && this.quality === 'low') this.glows.add(p.x, p.y + 0.25 * S, p.z, 0.2, C_TAPE, 2.5 * tape, 1.6, 0.5 * tape, 1, 0.3);
  }

  _pickable(s) {
    return s && s.state !== 'rescued' && s.state !== 'lost' && s.state !== 'winching' && !s.attached && s.people.length > 0;
  }

  // ---- checkpoint restore (mission.js, DESIGN §3.9 «каждая посадка — чекпоинт») ---------------------
  // Called right after mission:setup + mission:start: the groups spawned from the def make way for the
  // snapshot's. cp = { elapsed, rescued, lost, lostMarkers: [{x, z}], groups: [{entry (a def.survivors
  // object), type, x, z, people: [records], health, spotted, age, pet, datum {x, z, radius} | null,
  // carrier {x, z, yaw, age, flood, capsized, flip, anchor {x, z}} | null}], bottleTaken }. Entries due
  // later stay pending. The op 9★ bottle (re-placed by mission:setup) stays afloat unless it had already
  // been fished out before the checkpoint.
  restoreCheckpoint(cp) {
    if (!cp) return;
    const t = Number(cp.elapsed) || 0;
    const later = (this.def?.survivors || []).filter((e) => e && (e.at || 0) > t);
    const b = this.bottle;
    const keep = b && b.active && !b.taken && !cp.bottleTaken ? { x: b.x, z: b.z, y: b.y, yaw: b.yaw, phase: b.phase } : null;
    this.clear();
    if (keep) {
      Object.assign(b, keep);
      b.active = true;
      b.group.visible = true;
    }
    this.elapsed = t;
    for (const e of later) this.pending.push(e);
    this.pending.sort((a, b) => a.at - b.at);
    for (const g of cp.groups || []) {
      const e = g.entry || {};
      const people = (g.people || []).filter(Boolean);
      if (!people.length) continue;
      const s = this.spawn({
        ...e, type: g.type || e.type, x: g.x, z: g.z, count: people.length, people, at: 0, hidden: !g.spotted,
        pet: g.pet ? e.pet : null, datum: g.datum ? { x: g.datum.x, z: g.datum.z } : null, datumRadius: g.datum?.radius ?? e.datumRadius,
      });
      s.tag = e.tag ?? s.tag;
      s.def = e;
      s.health = s.warmth = clamp01(g.health ?? 1);
      s.critical = s.health <= CRITICAL;
      s.age = g.age || 0;
      if (g.spotted && !s.spotted) {
        s.spotted = true;
        s.state = 'spotted';
      }
      const c = s.carrier;
      const k = g.carrier;
      if (c && k) {
        for (const key of ['x', 'z', 'yaw', 'age', 'flood', 'capsized', 'flip']) if (k[key] !== undefined) c[key] = k[key];
        if (k.anchor && c.anchor) c.anchor.set(k.anchor.x, 0, k.anchor.z);
      }
      this._syncObject(s);
    }
    this.rescuedTotal = cp.rescued || 0;
    this.lostTotal = cp.lost || 0;
    for (const m of cp.lostMarkers || []) this.lostMarkers.push({ x: m.x, z: m.z, y: 0, t: this.ctx.time.t - 10, s: null, phase: this.rng.next() * 10, nrm: new THREE.Vector3(0, 1, 0) });
  }
}
