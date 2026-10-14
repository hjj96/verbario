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
// one per craft model in use (+ craft keylines on high).
//
// Public API beyond the CONTRACT (all optional for other systems):
//   types                         supported group types (mission/prepare.js reads it)
//   fireSignal(s, kind)           scripted signals: 'rocket' | 'smoke' | 'flare' | 'whistle' | 'dye' | 'mirror'
//   spot(s, by)                   force "spotted" (tests, scripts)
//   byTag(tag) → [groups]         every group carrying a def tag (splits keep the tag)
//   carriers, lostMarkers, elapsed, rescuedTotal, lostTotal
//   group extras: tag, def, label, name, velocity (Vector3), warmth (= health), critical, signal
//     {kind, x, z, error, arc, t, until} (last «СИГНАЛ»), strobe (flashing now), panic, carrier,
//     inBasket (person record on the cable), deckY, flower (ring of 2+), dwWarn (0..1 downwash danger)
// Extra events: survivor:capsize {s, cause}, survivor:sinking {s, phase: 'warn'|'sunk'},
//   survivor:jump {s, from}, survivor:creak {s, x, z}, survivor:downwash {s, level: 'push'|'capsize'},
//   survivor:raft-boarded {s}, survivor:tip {s}.
import * as THREE from 'three';
import { createRng } from '../core/math.js';
import {
  TYPES, SUPPORTED_TYPES, DIFFICULTY_WARMTH, CRITICAL, LOST_FADE, DETECT, BEAM_SPOT_TIME, BEAM_RANGE,
  FLARE_SPOT_R, FLARE_SPOT_LIFE, STROBE_MULT, SIG, NEAR_WAVE, SEEN_RANGE, SWIM_TO_BASKET, SWIM_SPEED,
  SWIM_TO_RAFT, RAFT_SEATS, DW_PUSH_ALT, DW_CAPSIZE_ALT, DW_CAPSIZE_R, DW_CAPSIZE_T, ROGUE_SWEEP, ROGUE_SWEEP_T,
  CONTAINER_COLORS, SKIN, HOOD, JACKET, PANTS, PERSON_SCALE, clamp, clamp01, smooth, lerp, wrapAngle, approach,
} from './survivors/tables.js';
import { Crowd, FEET_Y } from './survivors/crowd.js';
import {
  raftGeometry, capsizedHullGeometry, containerGeometry, bargeGeometry, ferryGeometry, stretcherGeometry,
  lostBuoyGeometry, debrisGeometry, DEBRIS_KINDS, createCraftMaterial, CraftBatch, nameDecal, RAFT,
} from './survivors/craft.js';
import { Collars, Glows, Lines } from './survivors/water.js';
import { Carrier, scatterDebris } from './survivors/carriers.js';
import { SignalDesk, initSignals, strobeOn } from './survivors/signals.js';
import { POSE, poseTargets, applyPose } from './survivors/poses.js';
import { makeFallbackPeople, conditionFor, quoteFor, guessGender } from './survivors/people.js';

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
    this.types = SUPPORTED_TYPES.filter((t) => t !== 'plane');
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
      base: 260, altBonus: 1, reduceFlashes: false,
      heliAlive: false, hx: 0, hy: 40, hz: 0, alt: 40, dwR: 9, dwS: 0,
      wState: 'stowed', bx: 0, by: 0, bz: 0, bH: 99, bWet: false, wLoad: null,
      ghostLight: new THREE.Color(0.4, 0.45, 0.5), foam: new THREE.Color('#E8EEEC'),
    };

    this._buildRender();

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

    this.crowd = new Crowd(look, 192);
    root.add(this.crowd.mesh, this.crowd.ghost, this.crowd.keyline);

    const keyline = look.keyline({ color: '#05090B', opacity: 0.55, px: 1 });
    this.craftKeyline = keyline;
    const raftMat = createCraftMaterial(look, { side: THREE.DoubleSide, roughness: 0.72 });
    const hullMat = createCraftMaterial(look, { roughness: 0.6 });
    const steelMat = createCraftMaterial(look, { roughness: 0.55 });
    const debrisMat = createCraftMaterial(look, { roughness: 0.6, debris: true });
    this.batches = {
      raft: new CraftBatch('rafts', raftGeometry(), raftMat, 16, { castShadow: true, keyline }),
      boat: new CraftBatch('hulls', capsizedHullGeometry('boat'), hullMat, 6, { castShadow: true, keyline }),
      yacht: new CraftBatch('yachts', capsizedHullGeometry('yacht'), hullMat, 6, { castShadow: true, keyline }),
      container: new CraftBatch('containers', containerGeometry(), steelMat, 8, { castShadow: true, keyline, instanceColor: true }),
      stretcher: new CraftBatch('stretcher', stretcherGeometry(), hullMat, 2, { castShadow: true }),
      buoy: new CraftBatch('lostBuoys', lostBuoyGeometry(), hullMat, 48, { castShadow: false }),
      debris: new CraftBatch('debris', debrisGeometry(), debrisMat, 96, { castShadow: false }),
    };
    this._steelMat = steelMat;
    this._bigGeos = new Map(); // deck height → barge / ferry geometry
    this.bigBatches = []; // per (kind, deck height) batches created on demand
    for (const b of Object.values(this.batches)) {
      root.add(b.mesh);
      if (b.keyline) root.add(b.keyline);
    }
    this.collars = new Collars(look, 192);
    this.glows = new Glows(look, 160);
    this.lines = new Lines(192);
    root.add(this.collars.mesh, this.glows.mesh, this.lines.mesh);
  }

  _bigBatch(kind, deckY) {
    const key = `${kind}:${Math.round(deckY * 10)}`;
    let b = this.bigBatches.find((x) => x.key === key);
    if (b) return b;
    const geo = kind === 'wreck' ? ferryGeometry(deckY) : bargeGeometry(deckY);
    b = new CraftBatch(kind === 'wreck' ? 'ferry' : 'barge', geo, this._steelMat, 2, { castShadow: true, keyline: this.craftKeyline });
    b.key = key;
    b.geo = geo;
    this.root.add(b.mesh);
    if (b.keyline) {
      b.keyline.visible = this.ctx.settings.get('quality') === 'high';
      this.root.add(b.keyline);
    }
    this.bigBatches.push(b);
    return b;
  }

  _applyQuality() {
    const q = this.ctx.settings.get('quality');
    this.quality = q;
    this.crowd.setQuality(q);
    const high = q === 'high';
    for (const b of [...Object.values(this.batches), ...this.bigBatches]) if (b.keyline) b.keyline.visible = high;
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
    };
    s.object3d.name = `survivor-${s.id}`;
    // people (the mission's manifest when it has one, so cabin and logbook agree)
    const recs = Array.isArray(entry.people) && entry.people.length >= count ? entry.people : makeFallbackPeople((this.def?.seed ?? 1) * 97 + s.id, type, count);
    for (let i = 0; i < count; i++) s.people.push(this._makePerson(recs[i] || recs[0], s, i));
    initSignals(s, entry, this.rng);
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
  nearestFor(x, z, maxDist = 4.5) {
    let best = null;
    let bk = Infinity;
    for (const s of this.list) {
      if (!this._pickable(s)) continue;
      const d = Math.hypot(s.position.x - x, s.position.z - z);
      if (d > maxDist) continue;
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
      if (s.excite > 0) s.excite -= dt;
      if (s.calm > 0) s.calm -= dt;
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
    if (h && h.position) {
      env.hx = h.position.x;
      env.hy = h.position.y;
      env.hz = h.position.z;
      env.alt = Number.isFinite(h.altitude) ? h.altitude : h.position.y;
    }
    env.fogBlind = (env.preset === 'fog' || env.fog > 0.55) && env.alt > 35;
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
      hood: Math.floor(rng.next() * HOOD.length),
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
    if (w < 0.4) return d < SEEN_RANGE || excited ? POSE.limp : onCarrier ? (kind === 'hull' ? POSE.keel : POSE.deck) : POSE.idle;
    if (d < NEAR_WAVE || excited) return POSE.wave2;
    if (d < SEEN_RANGE) return s.flower ? POSE.wave1 : POSE.wave1;
    if (s.flower) return POSE.hold;
    if (kind === 'raft') return POSE.sit;
    if (kind === 'hull') return POSE.keel;
    if (kind === 'container' || kind === 'barge' || kind === 'wreck' || kind === 'rig') return POSE.deck;
    return POSE.idle;
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
    } else if (t === 'container') {
      const col = e.color || CONTAINER_COLORS[Math.floor(rng.next() * CONTAINER_COLORS.length)];
      c = new Carrier('container', x, z, { color: col, phase: rng.next() * 100 });
      c.yaw = rng.next() * Math.PI * 2;
      c.roll = (rng.next() - 0.5) * 0.12;
      c.pitch = (rng.next() - 0.5) * 0.06;
    } else if (t === 'deck' || t === 'wreck') {
      const deckY = Number.isFinite(e.height) ? e.height : t === 'deck' ? 6 : 6;
      const yaw = -(e.heading ?? 0);
      const rig = t === 'deck' ? this._worldDeckNear(x, z, deckY) : null;
      if (rig) {
        c = new Carrier('rig', x, z, { fixed: true, deckY, stand: [0, deckY, 0] });
        c.baseY = 0;
      } else {
        const kind = t === 'wreck' ? 'wreck' : 'barge';
        const batch = this._bigBatch(kind, deckY);
        const stand = batch.geo.userData.stand;
        // place the hull so that its gathering point is where the def says the people are
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const cx = x - (stand[0] * cs + stand[2] * sn);
        const cz = z - (-stand[0] * sn + stand[2] * cs);
        c = new Carrier(kind, cx, cz, { fixed: kind === 'barge', deckY, stand, yaw, floodTime: e.sinkTime ?? TYPES.wreck.flood, leeway: kind === 'wreck' ? TYPES.wreck.leeway : 0 });
        c.batch = batch;
        if (kind === 'barge') c.roll = 0.05;
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
    const d = nameDecal(look, name, { width: 11, height: 1.9 });
    const g = new THREE.BufferGeometry();
    // two quads on the bow flanks (port and starboard), baked in the ferry frame
    const L = 52;
    const quads = [];
    for (const side of [-1, 1]) {
      const pl = new THREE.PlaneGeometry(11, 1.9);
      pl.rotateY(side * Math.PI / 2);
      if (side < 0) pl.scale(1, 1, 1);
      pl.translate(side * 4.98, (c.deckY || 6) - 2.25, -L / 2 + 10);
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

  _disposeCarrier(c) {
    if (c.decal) {
      this.root.remove(c.decal.mesh);
      c.decal.geo.dispose();
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
    }
    c.pose(env, ocean, dt);
    c.tapeLit = ocean.searchlightAt ? ocean.searchlightAt(c.x, c.z, c.y + 1.2) : 0;
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
    // oil sheen and the slow spread of things around her
    if (env.play && dt > 0) {
      c.oilT -= dt;
      if (c.oilT <= 0 && c.sinking < 1) {
        c.oilT = 2.5;
        ctx.ocean?.stamp?.('oil', c.x + (this.rng.next() - 0.5) * 6, c.z + (this.rng.next() - 0.5) * 6, { radius: 7 + 4 * this.rng.next(), strength: 0.25 });
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

  // Sinking ferry: heel grows, bow goes down, lights flicker and die; jumpers from 70 %, then she goes.
  _wreckLife(c, env, dt) {
    const ctx = this.ctx;
    c.flood = clamp01(c.age / Math.max(30, c.floodTime));
    const f = c.flood;
    c.roll = -(0.07 + 0.42 * Math.pow(f, 1.4)) - 0.3 * c.sinking;
    c.pitch = -(0.04 + 0.12 * f) - 0.5 * c.sinking * c.sinking;
    c.sink = 0.6 + 2.2 * f + 22 * c.sinking * c.sinking;
    // lights: flicker more as she floods, gone by 88 %
    const flick = f > 0.35 ? (Math.sin(env.t * 31 + c.phase) * Math.sin(env.t * 7.3) > 0.55 - 0.9 * (f - 0.35) ? 0.15 : 1) : 1;
    c.lights = (1 - smooth(0.78, 0.88, f)) * flick * (0.4 + 0.6 * env.night) + 0.05;
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
    crowd.begin();
    for (const b of Object.values(B)) b.begin();
    for (const b of this.bigBatches) b.begin();
    this.collars.begin();
    this.glows.begin();
    this.lines.begin();
    const night = env.night;
    const rf = env.reduceFlashes;

    // --- carriers ----------------------------------------------------------------------------------
    for (const c of this.carriers) {
      const occupants = this._occupants(c);
      const lit = c.tapeLit;
      if (c.kind === 'raft') {
        // canopy lamp 60/min; dead when the raft is capsized or its people are lost
        const lampOn = !c.lampDead && !c.capsized && (env.t + c.lampPhase) % SIG.lampPeriod < 0.13;
        const lamp = lampOn ? (rf ? 0.4 : 1) : 0;
        const chem = !c.capsized && night > 0.45 && !c.dropped ? 1 : 0;
        B.raft.push(c.matrix, lit, lamp, c.flutter, 0, c.dissolve, chem, c.phase);
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
        const b = c.style === 'yacht' ? B.yacht : B.boat;
        b.push(c.matrix, lit, 0, 0, 0, c.dissolve, 0, c.phase);
        const yaw = c.yaw;
        this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, c.style === 'yacht' ? 1.95 : 1.75, 0.8 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, yaw, c.elong);
        for (const d of c.debris) {
          d.y = ocean.heightAt(d.x, d.z);
          _q.setFromAxisAngle(UP, d.yaw);
          _m.compose(_v.set(d.x, d.y + 0.02, d.z), _q, _s.set(1, 1, 1));
          B.debris.push(_m, 0, 0, 0, 0, c.dissolve * 0.7, 0, 0, DEBRIS_KINDS.indexOf(d.kind) + 1);
        }
      } else if (c.kind === 'container') {
        B.container.push(c.matrix, lit, 0, 0, 0, c.dissolve, 0, c.phase, 0, c.color);
        this.collars.push(c.x, c.y, c.z, c.nrm.x, c.nrm.y, c.nrm.z, 1.4, 0.9 * (1 - c.dissolve), 1 - c.dissolve, lit, c.phase, c.yaw, 2.4);
      } else if (c.kind === 'barge' || c.kind === 'wreck') {
        c.batch.push(c.matrix, lit, 0, 0, c.kind === 'wreck' ? c.lights : 0.25 + 0.75 * night, c.dissolve, 0, c.phase);
        this.collars.push(c.x, c.y + (c.kind === 'wreck' ? 0.3 : 0), c.z, 0, 1, 0, c.kind === 'wreck' ? 6.5 : 5.6, c.kind === 'wreck' ? 1 : 0.7, 1, lit, c.phase, c.yaw, c.kind === 'wreck' ? 4.3 : 3.2);
        if (c.decal) {
          c.decal.mesh.matrix.copy(c.matrix);
          c.decal.mesh.matrixWorld.copy(c.matrix);
          c.decal.mesh.visible = c.dissolve < 0.5;
          c.decal.mat.opacity = 0.92 * (1 - c.dissolve * 2);
        }
      }
      // people aboard (owner + riders), as many as the craft shows
      if (occupants) this._drawAboard(c, env, dt);
    }

    // --- groups without a carrier (swimmers, the injured, flower rings) ---------------------------
    for (const s of this.list) {
      if (s.attached) this._drawAttached(s, env, dt);
      if (s.carrier) continue;
      if (s.state === 'rescued') continue;
      if (s.state === 'lost' && s.lostT > LOST_FADE + 0.2) continue;
      this._drawSwimmers(s, env, dt);
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

    crowd.end();
    for (const b of Object.values(B)) b.end();
    for (const b of this.bigBatches) b.end();
    this.collars.end();
    this.glows.end();
    this.lines.end();
    this.ghostUniforms();
  }

  ghostUniforms() {
    const u = this.crowd.ghostMaterial.uniforms;
    u.uLight.value.copy(this.env.ghostLight);
    const pal = this.ctx.weather?.state?.palette;
    if (pal?.body?.isColor) u.uWater.value.copy(pal.body);
    this.collars.material.uniforms.uFoam.value.copy(this.env.foam);
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
      const y = (ocean.heightAt ? ocean.heightAt(x, z) : 0) + 0.04 + (1 - k) * 0.3 * (1 - k);
      this.lines.seg(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
    // the drogue itself: a small orange cone just under the surface
    _q.setFromAxisAngle(UP, Math.atan2(_v.x - ax, _v.z - az));
    _m.compose(_v2.set(ax, py - 0.05, az), _q, _s.set(1, 1, 1));
    this.batches.debris.push(_m, 0, 0, 0, 0, 0, 0, 0, DEBRIS_KINDS.indexOf('drogue') + 1);
  }

  // People aboard a carrier (raft doorway, keel, container roof, decks).
  _drawAboard(c, env, dt) {
    const raise = c.kind === 'raft' && env.bWet && Math.hypot(env.bx - c.x, env.bz - c.z) < 15;
    const seats = c.visibleSeats(raise);
    let i = 0;
    const groups = c.owner ? [c.owner, ...c.riders] : c.riders;
    let total = 0;
    for (const g of groups) total += g.people.length;
    for (const s of groups) {
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
        // face the heli when it is around, else look along the craft
        const target = s.dHeli < 400 ? Math.atan2(env.hx - p.x, env.hz - p.z) : c.yaw + (c.kind === 'hull' ? (i % 2 ? Math.PI / 2 : -Math.PI / 2) : 0);
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
      const busy = s.swimTo || pose === POSE.panic || pose === POSE.wave2 ? 1 : 0.6;
      this.collars.push(p.x, wy, p.z, s.nrm.x, s.nrm.y, s.nrm.z, supine ? 0.62 * S : 0.42 * S, busy * (1 - fade), 1 - fade, tape, p.phase, supine ? p.yaw : 0, supine ? 1.8 : 1);
      if (s.swimTo && dt > 0 && ocean?.addWake) ocean.addWake(p.x, p.z, 0.4, s.velocity.x, s.velocity.z);
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
    this.glows.add(p.x, p.y + 0.4 * S, p.z, 0.25, C_STROBE, 9 * k, 4.5, 1.4 * k, 1, env.t * 0.37);
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
}
