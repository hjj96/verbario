// Carriers — the floating things survivors sit on, cling to or stand on (DESIGN §2.10, §3.11):
// a ПСН-6 raft, a capsized hull, a 20' container, a barge aground, the sinking ferry, or a virtual
// carrier for a world structure (the rig's lower deck). A carrier owns its pose on the waves (bob on
// heightAt, tilt from normalAt with a 0.3 s lag, yaw), its own drama (sea anchor yaw, canopy flutter,
// sinking telegraph, heel and flooding, tipping in a big sea) and how it is drawn.
//
// People ride a carrier through `slots`: local positions in the carrier frame (see slotFor()).
import * as THREE from 'three';
import { RAFT, CONT } from './craft.js';
import { FEET_Y } from './crowd.js';
import { PERSON_SCALE, TYPES, C, clamp, clamp01, smooth, approach, wrapAngle } from './tables.js';

const S = PERSON_SCALE;
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

let NEXT_ID = 1;

export class Carrier {
  constructor(kind, x, z, opts = {}) {
    this.id = NEXT_ID++;
    this.kind = kind; // 'raft' | 'hull' | 'container' | 'barge' | 'wreck' | 'rig'
    this.style = opts.style || 'boat';
    this.x = x;
    this.z = z;
    this.y = 0;
    this.baseY = 0; // structures: fixed deck reference
    this.yaw = opts.yaw ?? 0;
    this.yawRate = 0;
    this.nrm = new THREE.Vector3(0, 1, 0); // lagged wave normal (0.3 s)
    this.roll = 0; // extra roll (heel, tipping, capsize flip)
    this.pitch = 0; // extra pitch (trim)
    this.sink = 0; // extra draft (m, positive = lower)
    this.flip = 0; // 0 upright … 1 capsized (rafts)
    this.capsized = false;
    this.flutter = 0;
    this.tapeLit = 0;
    this.lamp = 0;
    this.lights = 0;
    this.chem = 0;
    this.dissolve = 0;
    this.phase = opts.phase ?? Math.random() * 100;
    this.lampPhase = Math.random();
    this.owner = null; // the group it belongs to (null: dropped raft, emptied craft)
    this.riders = []; // swimmer groups that climbed aboard a dropped raft
    this.dropped = !!opts.dropped;
    this.inflate = opts.dropped ? 0 : 1;
    this.alive = true;
    this.emptyT = 0; // seconds since nobody is aboard (fade-out of leftovers)
    this.color = opts.color ? new THREE.Color(opts.color) : null;
    this.deckY = opts.deckY ?? 0;
    this.stand = opts.stand || null; // local gathering point [x, y, z]
    this.sinkAt = opts.sinkAt ?? Infinity; // hulls: seconds of age before she goes
    this.flood = 0; // wreck 0..1
    this.floodTime = opts.floodTime ?? 300;
    this.age = 0;
    this.sinking = 0; // 0 … 1 final plunge
    this.tipT = 0;
    this.tip = 0; // container tip animation 0..1..0
    this.tipDir = 1;
    this.leeway = opts.leeway ?? TYPES[kind]?.leeway ?? 0.03;
    this.fixed = !!opts.fixed; // barge aground, rig deck
    this.anchor = new THREE.Vector3(x, 0, z); // raft sea anchor (drogue)
    this.debris = []; // hull: floating bits around it [{kind, x, z, y, yaw, spin, r}]
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.decal = null; // wreck: name decal mesh
    this.bubbleT = 0;
    this.creakT = 0;
    this.oilT = 0;
    this.warned = false;
  }

  get radius() {
    switch (this.kind) {
      case 'raft': return RAFT.R + RAFT.tube;
      case 'hull': return this.style === 'yacht' ? 5.4 : 4.8;
      case 'container': return 3.3;
      case 'barge': return 17;
      case 'wreck': return 26;
      default: return 2;
    }
  }

  // Collar elongation (length / beam) for elongated hulls.
  get elong() {
    switch (this.kind) {
      case 'hull': return this.style === 'yacht' ? 3.0 : 2.9;
      case 'container': return 2.4;
      case 'barge': return 3.2;
      case 'wreck': return 4.2;
      default: return 1;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // Pose on the waves. env: per-frame snapshot from Survivors; ocean: ctx.ocean.
  pose(env, ocean, dt) {
    if (this.kind === 'rig') {
      this.y = this.baseY;
      this.quat.identity();
      this.matrix.makeTranslation(this.x, this.y, this.z);
      return;
    }
    const sea = ocean.heightAt(this.x, this.z);
    // big things are not tossed like corks: smaller tilt response
    const tiltK = this.kind === 'raft' ? 1 : this.kind === 'hull' || this.kind === 'container' ? 0.75 : 0.25;
    ocean.normalAt(this.x, this.z, _n);
    _n.set(_n.x * tiltK, 1, _n.z * tiltK).normalize();
    // 0.3 s lag on the tilt (DESIGN §2.10)
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.3) : 0;
    this.nrm.lerp(_n, k).normalize();
    if (this.fixed) {
      this.y = this.baseY;
      this.nrm.set(0, 1, 0);
    } else if (this.kind === 'barge' || this.kind === 'wreck') {
      this.y = sea * 0.35 - this.sink; // heavy: barely bobs
    } else {
      this.y = sea - this.sink;
    }
    // quaternion: wave tilt × yaw × extra roll/pitch (heel, tip, capsize flip)
    _q.setFromUnitVectors(UP, this.nrm);
    _q2.setFromAxisAngle(UP, this.yaw);
    _q.multiply(_q2);
    const flipRoll = this.flip * Math.PI;
    if (this.roll || this.pitch || flipRoll) {
      _e.set(this.pitch, 0, this.roll + flipRoll, 'XYZ');
      _q2.setFromEuler(_e);
      _q.multiply(_q2);
    }
    this.quat.copy(_q);
    const inf = this.inflate;
    _s.set(inf, 0.25 + 0.75 * inf, inf);
    // a capsized raft floats on its tubes: lift it so the upside-down tubes sit in the water
    _v.set(this.x, this.y + this.flip * RAFT.tube * 3.2, this.z);
    this.matrix.compose(_v, this.quat, _s);
  }

  // World position of a local point (carrier frame) → out.
  toWorld(lx, ly, lz, out) {
    return out.set(lx, ly, lz).applyMatrix4(this.matrix);
  }

  // ----------------------------------------------------------------------------------------------
  // Local slot (person origin) for the i-th person of n aboard. Returns [x, y, z, legFold, sitYaw].
  // People origins are "floating reference points" (see crowd.js): standing → feet = origin + FEET_Y.
  slotFor(i, n, out) {
    switch (this.kind) {
      case 'raft': {
        // two in the doorway (+Z), a third behind them when the basket arrives
        const R = RAFT.R;
        const sitY = RAFT.floorY + 0.55 * S + 0.5 * S;
        if (i === 0) return set5(out, -0.24 * R, sitY, 0.72 * R, 0.85, 0);
        if (i === 1) return set5(out, 0.26 * R, sitY + 0.04, 0.7 * R, 0.85, 0);
        return set5(out, 0.02 * R, sitY + 0.1, 0.38 * R, 0.6, 0);
      }
      case 'hull': {
        const keelY = this.style === 'yacht' ? 0.55 : 0.68;
        const zs = this.style === 'yacht' ? [1.6, -0.6, 2.9, -1.9] : [-1.2, 0.6, 2.2, -2.7];
        const z = zs[i % zs.length];
        const x = this.style === 'yacht' ? (i % 2 ? 0.55 : -0.55) : 0;
        return set5(out, x, keelY + 0.5 * S + 0.05, z, 1, 0);
      }
      case 'container': {
        const top = CONT.freeboard;
        const zs = [0.6, -1.3, 2.0];
        const xs = [-0.3, 0.45, 0.1];
        return set5(out, xs[i % 3], top + 1.37, zs[i % 3], 0.6, 0);
      }
      case 'barge':
      case 'wreck':
      case 'rig': {
        // a loose crowd at the gathering point, two ranks
        const st = this.stand || [0, this.deckY, 0];
        const cols = 4;
        const r = Math.floor(i / cols);
        const c = i % cols;
        const jx = (((i * 37) % 11) / 11 - 0.5) * 0.5;
        const jz = (((i * 53) % 7) / 7 - 0.5) * 0.5;
        return set5(out, st[0] + (c - (Math.min(n, cols) - 1) / 2) * 1.5 + jx, st[1] - FEET_Y, st[2] + r * 1.6 + jz, 0, 0);
      }
      default:
        return set5(out, 0, 0, 0, 0, 0);
    }
  }

  // Seats the craft can show in its slots (rafts show the doorway only).
  visibleSeats(raise) {
    switch (this.kind) {
      case 'raft': return raise ? 3 : 2;
      case 'hull': return 4;
      case 'container': return 3;
      default: return 12;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // Raft: sea anchor upwind, yawing (DESIGN §2.10, §4 #23).
  raftYaw(env, dt) {
    // local +Z (the door) maps to (sin yaw, cos yaw): door downwind, the drogue line streams upwind,
    // and the raft yaws slowly around it
    const down = Math.atan2(env.windDirX, env.windDirZ);
    const target = down + 0.32 * Math.sin(env.t * 0.27 + this.phase) + 0.12 * Math.sin(env.t * 0.71 + this.phase * 2);
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * 0.6));
    // drogue ~9 m upwind, swinging a little
    const d = 8 + 1.5 * Math.sin(env.t * 0.19 + this.phase);
    const lat = 1.6 * Math.sin(env.t * 0.23 + this.phase * 3);
    this.anchor.x = this.x - env.windDirX * d - env.windDirZ * lat;
    this.anchor.z = this.z - env.windDirZ * d + env.windDirX * lat;
  }
}

function set5(out, a, b, c, d, e) {
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = e;
  return out;
}

// Debris ring around a capsized hull: rings, floats, cans, planks, a cooler (DESIGN §2.10).
export function scatterDebris(carrier, rng) {
  const kinds = ['ring', 'float', 'can', 'plank', 'cooler', 'float', 'can', 'plank', 'ring'];
  const n = 7 + Math.floor(rng.next() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 6 + rng.next() * 9;
    carrier.debris.push({
      kind: kinds[i % kinds.length],
      dx: Math.cos(a) * r,
      dz: Math.sin(a) * r,
      x: carrier.x + Math.cos(a) * r,
      z: carrier.z + Math.sin(a) * r,
      y: 0,
      yaw: rng.next() * Math.PI * 2,
      spin: (rng.next() - 0.5) * 0.3,
      drift: 0.85 + rng.next() * 0.3,
    });
  }
}

export { clamp, clamp01, smooth, approach, C };
