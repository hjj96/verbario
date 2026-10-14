// Seakeeping for anything with a hull (DESIGN §2.11, §3.9): pitch / roll from three
// ocean.heightAt samples (bow, port quarter, starboard quarter), heave from their mean, all
// through second-order springs (a ship rolls with inertia and a little overshoot, it never snaps
// to the wave slope). Deck tilt is clamped to ±2…9° by Hs (DESIGN §3.9 table). Bow slams are
// detected from the bow plunging into a rising crest.
//
// Heading convention (CONTRACT): 0 = north (−Z), clockwise positive. Local frame: bow = −Z,
// starboard = +X. local (lx, lz) → world (x + lx·cos h − lz·sin h, z + lx·sin h + lz·cos h).
import * as THREE from 'three';
import { p, member, beam as boxBeam, UNIT, SURF, rng } from './geo.js';
import { clamp, smoothstep } from '../../core/math.js';

const DEG = Math.PI / 180;

export class VesselMotion {
  constructor({ length = 70, beam = 15, rollGain = 1.5, pitchW = 1.05, rollW = 0.66, heaveW = 1.4, zeta = 0.32, heaveK = 0.78 } = {}) {
    this.L = length;
    this.B = beam;
    this.rollGain = rollGain;
    this.pitchW = pitchW;
    this.rollW = rollW;
    this.heaveW = heaveW;
    this.zeta = zeta;
    this.heaveK = heaveK;
    this.pitch = 0; // rad, bow up +
    this.roll = 0; // rad, starboard up +
    this.heave = 0; // m
    this.pv = 0;
    this.rv = 0;
    this.hv = 0;
    this.tilt = 0; // rad from horizontal
    this.bowRel = 0; // bow height above the local water (m)
    this.bowRate = 0; // d(bowRel)/dt
    this.slam = 0; // strength of a slam this frame (0 = none)
    this.slamCooldown = 0;
    this.hb = 0;
    this.hp = 0;
    this.hs = 0;
  }

  reset() {
    this.pitch = this.roll = this.heave = 0;
    this.pv = this.rv = this.hv = 0;
    this.bowRel = 0;
    this.bowRate = 0;
    this.slam = 0;
    this.slamCooldown = 1;
  }

  // Sample world position of a local point.
  static local(x, z, heading, lx, lz, out) {
    const c = Math.cos(heading), s = Math.sin(heading);
    out.x = x + lx * c - lz * s;
    out.y = z + lx * s + lz * c;
    return out;
  }

  step(dt, x, z, heading, ocean, Hs, settle = false) {
    const L = this.L, B = this.B;
    const c = Math.cos(heading), s = Math.sin(heading);
    const hb = (this.hb = sampleH(ocean, x, z, c, s, 0, -0.42 * L));
    const hp = (this.hp = sampleH(ocean, x, z, c, s, -0.45 * B, 0.38 * L));
    const hs = (this.hs = sampleH(ocean, x, z, c, s, 0.45 * B, 0.38 * L));
    const sternMid = 0.5 * (hp + hs);
    const maxTilt = (2 + 7 * smoothstep(0.4, 7.5, Hs || 0)) * DEG;
    const pitchT = clamp(Math.atan2(hb - sternMid, 0.8 * L), -maxTilt, maxTilt);
    const rollT = clamp(this.rollGain * Math.atan2(hs - hp, 0.9 * B), -maxTilt, maxTilt);
    const heaveT = this.heaveK * (hb + hp + hs) / 3;
    if (settle || !(dt > 0)) {
      if (settle) {
        this.pitch = pitchT;
        this.roll = rollT;
        this.heave = heaveT;
        this.pv = this.rv = this.hv = 0;
      }
    } else {
      const h = Math.min(dt, 0.05);
      const z2 = 2 * this.zeta;
      this.pv += (this.pitchW * this.pitchW * (pitchT - this.pitch) - z2 * this.pitchW * this.pv) * h;
      this.rv += (this.rollW * this.rollW * (rollT - this.roll) - z2 * this.rollW * this.rv) * h;
      this.hv += (this.heaveW * this.heaveW * (heaveT - this.heave) - z2 * this.heaveW * this.hv) * h;
      this.pitch = clamp(this.pitch + this.pv * h, -maxTilt * 1.15, maxTilt * 1.15);
      this.roll = clamp(this.roll + this.rv * h, -maxTilt * 1.15, maxTilt * 1.15);
      this.heave += this.hv * h;
    }
    this.tilt = Math.acos(clamp(Math.cos(this.pitch) * Math.cos(this.roll), -1, 1));

    // Bow slam: the bow (≈ waterline at the stem) plunging into a rising crest.
    const bowY = this.heave + Math.sin(this.pitch) * 0.42 * L;
    const rel = bowY - hb;
    this.slam = 0;
    if (dt > 0) {
      const rate = (rel - this.bowRel) / dt;
      this.bowRate += (rate - this.bowRate) * Math.min(1, dt * 8);
      this.slamCooldown -= dt;
      const sea = smoothstep(1.2, 4.5, Hs || 0);
      if (sea > 0 && this.slamCooldown <= 0 && rel < 0.4 && this.bowRate < -1.6) {
        this.slam = clamp((-this.bowRate - 1.6) / 3, 0.25, 1) * sea;
        this.slamCooldown = 2.2 + 1.5 * (1 - sea);
      }
    }
    this.bowRel = rel;
    return this;
  }

  // Apply to an Object3D (position y + YXZ rotation: yaw from heading, then pitch, then roll).
  // rotation about X by +a lifts −Z (the bow); about Z by +b lifts +X (starboard).
  apply(obj, x, z, heading, lift = 0) {
    obj.position.set(x, this.heave + lift, z);
    obj.rotation.set(this.pitch, -heading, this.roll, 'YXZ');
  }
}

// Steering for ships on a looped route / constant drift / station keeping (bow into the weather).
export class Navigator {
  constructor() {
    this.route = null;
    this.idx = 0;
    this.speedT = 0; // target speed m/s
    this.speed = 0;
    this.heading = 0;
    this.yawRate = 0;
    this.station = false;
    this.driftHeading = 0;
    this.x = 0;
    this.z = 0;
  }

  // def: {x, z, heading, drift {x,z}, speed, route [[x,z]...]}
  setup(def) {
    this.x = def.x || 0;
    this.z = def.z || 0;
    this.heading = Number.isFinite(def.heading) ? def.heading : 0;
    const dv = def.drift ? Math.hypot(def.drift.x || 0, def.drift.z || 0) : 0;
    const explicitStill = def.drift && dv < 0.05;
    this.station = !!explicitStill || def.station === true;
    this.route = !this.station && Array.isArray(def.route) && def.route.length >= 2 ? def.route : null;
    this.idx = 0;
    if (this.route) {
      // start toward the first route point that is not where we already are
      let best = 0;
      for (let i = 0; i < this.route.length; i++) {
        const [rx, rz] = this.route[i];
        if (Math.hypot(rx - this.x, rz - this.z) > 60) {
          best = i;
          break;
        }
      }
      this.idx = best;
    }
    const base = Number.isFinite(def.speed) && def.speed > 0 ? def.speed : dv || 3;
    this.speedT = this.station ? 0 : clamp(base, 3, 5);
    if (!this.route && !this.station && dv > 0.05) this.heading = Math.atan2(def.drift.x, -def.drift.z);
    this.driftHeading = this.heading;
    this.speed = this.speedT;
    this.yawRate = 0;
  }

  step(dt, windDir) {
    if (!(dt > 0)) return;
    let desired = this.heading;
    if (this.station) {
      // heave-to: bow into the weather, slowly
      if (windDir && (windDir.x || windDir.y)) desired = Math.atan2(-windDir.x, windDir.y);
    } else if (this.route) {
      const [tx, tz] = this.route[this.idx];
      if (Math.hypot(tx - this.x, tz - this.z) < 90) this.idx = (this.idx + 1) % this.route.length;
      const [nx, nz] = this.route[this.idx];
      desired = Math.atan2(nx - this.x, -(nz - this.z));
    } else desired = this.driftHeading;
    let d = desired - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxRate = (this.station ? 0.6 : 2.2) * DEG;
    const rateT = clamp(d * 0.12, -maxRate, maxRate);
    this.yawRate += (rateT - this.yawRate) * (1 - Math.exp(-dt * 0.6));
    this.heading += this.yawRate * dt;
    this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    this.speed += clamp(this.speedT - this.speed, -0.15 * dt, 0.15 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += -Math.cos(this.heading) * this.speed * dt;
  }
}

function sampleH(ocean, x, z, c, s, lx, lz) {
  return ocean && ocean.heightAt ? ocean.heightAt(x + lx * c - lz * s, z + lx * s + lz * c) : 0;
}

// =============================================================================================
// Dressing shared by the vessels and the rig (art-direction pass "one realistic style"): hull
// plating / staining in vertex colours, rust runs, corrugated containers, enclosed lifeboats,
// framed windows, ladders, stair towers, helideck net rings and a canvas deck painter (plates,
// worn paths, rust, oil, gratings, hazard hatching). Everything bakes into the owner's ONE
// prop geometry (geo.js bake) — no extra draw calls.
const _hc = new THREE.Color();
const hash2 = (a, b, s = 0) => {
  let h = (a * 374761393 + b * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// Midpoint subdivision of a non-indexed triangle geometry (every attribute interpolated): the
// hulls need vertex density for plate seams, rust runs and the boot-top.
export function subdivide(g) {
  const names = Object.keys(g.attributes);
  const src = names.map((n) => g.attributes[n]);
  const tri = g.attributes.position.count / 3;
  const ORDER = [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5];
  const out = new THREE.BufferGeometry();
  names.forEach((name, k) => {
    const a = src[k].array, sz = src[k].itemSize;
    const o = new Float32Array(tri * 12 * sz);
    const v = new Float32Array(6 * sz);
    let w = 0;
    for (let t = 0; t < tri; t++) {
      for (let j = 0; j < 3 * sz; j++) v[j] = a[t * 3 * sz + j];
      for (let j = 0; j < sz; j++) {
        v[3 * sz + j] = 0.5 * (v[j] + v[sz + j]);
        v[4 * sz + j] = 0.5 * (v[sz + j] + v[2 * sz + j]);
        v[5 * sz + j] = 0.5 * (v[2 * sz + j] + v[j]);
      }
      for (const idx of ORDER) for (let j = 0; j < sz; j++) o[w++] = v[idx * sz + j];
    }
    out.setAttribute(name, new THREE.BufferAttribute(o, sz));
  });
  const n = out.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) || 1;
    n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, n.getZ(i) / l);
  }
  return out;
}

// Weather a hullGeometry() result in place (vertex colours + normals): plate panels every `seam` m
// with a horizontal strake seam, per-plate tone drift, grime under the deck edge, rust runs from
// scuppers (every ~`scupper` m) and from extra sources, a dirty boot-top with a green-black
// waterline, scraped bow, and topside normals lifted toward the sky so a vertical hull side reads
// as painted steel from the top-down camera instead of a black wall.
//   runs: [[z, side(±1|0 both), yTop, length, width, amount]]
export function weatherHull(hull, { seam = 2.5, seamDark = 0.09, plateVar = 0.05, rust = '#6B3A22', rustK = 0.6, scupper = 6, runs = [], boot = 0.5, bow = 0.5, lift = 0.22, seed = 1, L = 72 } = {}) {
  const g = subdivide(hull.geometry);
  hull.geometry.dispose();
  hull.geometry = g;
  const pos = g.attributes.position, col = g.attributes.color, nrm = g.attributes.normal;
  const rc = new THREE.Color(rust);
  const algae = new THREE.Color('#2F3A2C');
  const grime = new THREE.Color('#2A2622');
  const r = rng(seed * 7 + 3);
  // scupper / overboard-discharge runs along both sides
  const src = runs.slice();
  if (scupper > 0) {
    for (let z = L / 2 - 3; z > -L / 2 + 6; z -= scupper * (0.7 + 0.6 * r())) {
      for (const s of [-1, 1]) if (r() < 0.75) src.push([z + (r() - 0.5), s, null, 1.2 + 2.6 * r(), 0.35 + 0.3 * r(), (0.35 + 0.5 * r()) * rustK]);
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = hull.deckAt(z);
    _hc.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const s01 = clamp((L / 2 - z) / L, 0, 1);
    if (y > 0.5) {
      const u = z / seam;
      const dz = Math.abs(u - Math.round(u)) * seam;
      const vSeam = 1 - smoothstep(0.05, 0.45, dz);
      const hSeam = 1 - smoothstep(0.05, 0.35, Math.abs(y - 0.55 * d));
      const tone = hash2(Math.round(u * 2 - 0.5), y > 0.55 * d ? 1 : 0, seed) - 0.5;
      let m = (1 - seamDark * Math.max(vSeam, 0.8 * hSeam)) * (1 + 2 * plateVar * tone);
      m *= 1 - 0.1 * smoothstep(d - 1.2, d, y); // grime band under the deck edge
      _hc.multiplyScalar(m);
      // rust runs
      let k = 0;
      for (const [zs, side, yTop0, len, w, amt] of src) {
        if (side && Math.sign(x) !== side) continue;
        const yTop = yTop0 === null ? d - 0.15 : yTop0;
        const fall = (yTop - y) / len;
        if (fall < -0.08 || fall > 1) continue;
        const ww = w * (1 + 0.7 * Math.max(0, fall));
        const lat = (z - zs) / ww;
        k = Math.max(k, amt * Math.exp(-lat * lat) * (1 - Math.max(0, fall)) * (fall < 0 ? 1 + fall * 12 : 1));
      }
      if (k > 0) _hc.lerp(rc, clamp(k, 0, 0.85));
    } else if (y > -0.3) {
      // boot-top: white paint gone grimy, rust bleeding through, green-black at the waterline
      const n1 = hash2(Math.round(z * 1.6), Math.round(y * 3), seed + 5);
      _hc.lerp(grime, boot * (0.18 + 0.2 * n1));
      if (n1 > 0.62) _hc.lerp(rc, boot * 0.55 * (n1 - 0.62) / 0.38 + 0.1);
      _hc.lerp(algae, boot * 0.75 * (1 - smoothstep(-0.25, 0.2, y)));
    }
    // scraped, rust-bloomed bow (anchors, ice, fenders)
    if (bow > 0 && s01 > 0.84 && y > -0.2) {
      const n2 = hash2(Math.round(z * 1.3), Math.round(y * 1.1), seed + 9);
      const k = bow * smoothstep(0.84, 0.97, s01) * (1 - smoothstep(0.2 * d, 0.85 * d, y)) * (0.4 + 0.6 * n2);
      _hc.lerp(rc, clamp(k, 0, 0.7));
    }
    col.setXYZ(i, _hc.r, _hc.g, _hc.b);
    if (y > 0.3 && lift > 0) {
      const nx = nrm.getX(i), ny = nrm.getY(i) + lift, nz = nrm.getZ(i);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(i, nx / l, ny / l, nz / l);
    }
  }
  return hull;
}

// Nearest hull-surface vertex to (z, y) on one side → { x, n: Vector3 } (anchors, hawse pipes).
export function hullSurface(hull, z, y, side) {
  const pos = hull.geometry.attributes.position, nrm = hull.geometry.attributes.normal;
  let best = -1, bd = 1e9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (Math.sign(x) !== side) continue;
    const d = (pos.getZ(i) - z) ** 2 + (pos.getY(i) - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const n = new THREE.Vector3(nrm.getX(best), 0, nrm.getZ(best)).normalize();
  return { x: pos.getX(best), y: pos.getY(best), z: pos.getZ(best), n };
}

// Tapered rust / grime run on a (near-vertical) surface: from `o` (top) straight down `len` m,
// facing horizontal normal n, colour `c0` at the source fading to `c1` (the paint around it).
export function streakPart(o, n, len, w, c0, c1 = null, surf = SURF.paint) {
  const right = new THREE.Vector3(-n.z, 0, n.x).normalize();
  const base = new THREE.Vector3(o[0], o[1], o[2]).addScaledVector(n, 0.03);
  const rows = [[0, 1], [0.35, 0.8], [0.7, 0.5], [1, 0.18]];
  const P = [], C = [];
  const a = new THREE.Color(c0), b = new THREE.Color(c1 || c0);
  const pt = (t, sx) => base.clone().addScaledVector(right, sx).setY(base.y - t * len).toArray();
  for (let k = 0; k < rows.length - 1; k++) {
    const [t0, w0] = rows[k], [t1, w1] = rows[k + 1];
    const A = pt(t0, -w * w0 * 0.5), B = pt(t0, w * w0 * 0.5), Cc = pt(t1, -w * w1 * 0.5), D = pt(t1, w * w1 * 0.5);
    const ca = a.clone().lerp(b, t0 * t0), cb = a.clone().lerp(b, t1 * t1);
    for (const [v, c] of [[A, ca], [Cc, cb], [B, ca], [B, ca], [Cc, cb], [D, cb]]) {
      P.push(...v);
      C.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  // face the normal side (winding may flip with the right vector)
  const nn = g.attributes.normal;
  if (nn.getX(0) * n.x + nn.getZ(0) * n.z < 0) {
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
    const pa = g.attributes.position.array, ca = g.attributes.color.array;
    for (let i = 0; i < pa.length; i += 9) for (let j = 0; j < 3; j++) {
      let t = pa[i + 3 + j]; pa[i + 3 + j] = pa[i + 6 + j]; pa[i + 6 + j] = t;
      t = ca[i + 3 + j]; ca[i + 3 + j] = ca[i + 6 + j]; ca[i + 6 + j] = t;
    }
  }
  return { geometry: g, vcol: true, color: '#FFFFFF', surf };
}

// Merge simple geometries (each gets a flat colour unless it already has one) → one non-indexed geometry with colours.
function mergeColored(list) {
  const geos = list.map(([geo, color, m]) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    if (!g.attributes.color) {
      const c = new THREE.Color(color || '#FFFFFF');
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) (a[i] = c.r), (a[i + 1] = c.g), (a[i + 2] = c.b);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    let total = 0;
    for (const g of geos) total += g.attributes[name].array.length;
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  for (const g of geos) g.dispose();
  return out;
}
const _m4 = new THREE.Matrix4();
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  _m4.clone().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// 20' ISO container (world bake; origin bottom centre, long axis Z, doors at +Z): corrugated long
// sides (real folds → the sun picks out the ribs), darker underside, door end with seam, four
// lock bars and corner posts. Vertex colours are a white multiplier → part.color is the paint.
export const BOX20 = { L: 6.06, W: 2.44, H: 2.59 };
let _box20 = null;
export function containerGeo() {
  if (_box20) return _box20;
  const { L, W, H } = BOX20;
  const body = new THREE.BoxGeometry(W, H, L, 1, 1, 26).toNonIndexed();
  const pos = body.attributes.position;
  const step = L / 26;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(Math.abs(x) - W / 2) < 1e-4) {
      const k = Math.round((z + L / 2) / step);
      if (k > 0 && k < 26 && k % 2) pos.setX(i, x - Math.sign(x) * 0.05);
    }
  }
  body.computeVertexNormals();
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i);
    let v = y < -H / 2 + 1e-3 ? 0.45 : y > H / 2 - 1e-3 ? 0.93 : 1;
    if (z > L / 2 - 1e-3) v *= 0.9;
    if (z < -L / 2 + 1e-3) v *= 0.95;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  body.setAttribute('color', new THREE.BufferAttribute(c, 3));
  body.translate(0, H / 2, 0);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const list = [[body]];
  const dz = L / 2 + 0.03;
  list.push([box, '#3A3633', M(0, H / 2, dz, 0.04, H * 0.94, 0.04)]);
  for (let i = 0; i < 4; i++) list.push([box, '#77726B', M(-W / 2 + 0.36 + i * 0.57, H / 2, dz + 0.03, 0.05, H * 0.92, 0.05)]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push([box, '#CFCFCF', M(sx * (W / 2 - 0.08), H / 2, sz * (L / 2 - 0.08), 0.18, H + 0.02, 0.18)]);
  _box20 = mergeColored(list);
  box.dispose();
  return _box20;
}

// Enclosed lifeboat (SOLAS totally-enclosed type; free-fall variant longer with a raked stern):
// orange GRP canopy, white top band with the boarding hatch, dark rubbing strake, a row of small
// windows each side and the coxswain's cupola aft. Origin at the centre, bow −Z, ~5.6 × 2.4 × 2.2 m.
const _lb = {};
export function lifeboatGeo(freefall = false) {
  const key = freefall ? 'ff' : 'dv';
  if (_lb[key]) return _lb[key];
  const len = freefall ? 4.4 : 3.6;
  const body = new THREE.CapsuleGeometry(1, len, 5, 16).rotateX(Math.PI / 2).toNonIndexed();
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 1.2, y = pos.getY(i) * 1.02, z = pos.getZ(i);
    if (freefall) {
      if (z < -len / 2) { const t = (-len / 2 - z) / 1; x *= 1 - 0.35 * t; y = y * (1 - 0.3 * t) - 0.25 * t; } // pointed bow
      if (z > len / 2 + 0.3) z = len / 2 + 0.3 + (z - len / 2 - 0.3) * 0.25; // cut stern
    }
    if (y < -0.2) y = -0.2 + (y + 0.2) * 0.9;
    pos.setXYZ(i, x, y, z);
  }
  body.computeVertexNormals();
  const c = new Float32Array(pos.count * 3);
  const orange = new THREE.Color('#E2601E'), hullC = new THREE.Color('#EDEAE2'), strake = new THREE.Color('#2A2C2E');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const col = y < -0.42 ? hullC : y < -0.18 ? strake : orange;
    c[i * 3] = col.r, c[i * 3 + 1] = col.g, c[i * 3 + 2] = col.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const list = [[body]];
  list.push([box, '#EDEAE2', M(0, 1.02, -0.2, 0.95, 0.14, len + 0.6)]); // white top band
  list.push([box, '#C85418', M(0, 1.12, -len / 2 + 0.6, 0.72, 0.12, 0.9)]); // fwd hatch
  list.push([box, '#C85418', M(0, 1.12, 0.6, 0.72, 0.12, 0.9)]); // boarding hatch
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = -len / 2 + 0.4 + (k * (len - 0.4)) / 4;
      list.push([box, '#1A2630', M(s * 1.07, 0.48, z, 0.06, 0.26, 0.42, 0, 0, s * 0.5)]);
    }
  }
  list.push([cyl, '#E2601E', M(0, 1.2, len / 2 - 0.1, 0.42, 0.5, 0.42)]); // coxswain cupola
  list.push([cyl, '#1A2630', M(0, 1.33, len / 2 - 0.1, 0.44, 0.16, 0.44)]); // its window ring
  list.push([box, '#2A2C2E', M(0, -0.85, len / 2 + 0.9, 0.12, 0.8, 0.5)]); // rudder / skeg
  _lb[key] = mergeColored(list);
  box.dispose();
  cyl.dispose();
  return _lb[key];
}

// Windows with a frame: each window part gets a slightly larger, thinner frame behind it.
export function framed(parts, color = '#8C9092', pad = 0.14) {
  const out = [];
  for (const w of parts) {
    const [sx, sy, sz] = w.scale;
    const fs = sx < sz ? [sx * 0.6, sy + pad, sz + pad] : [sx + pad, sy + pad, sz * 0.6];
    out.push(p(UNIT.box, color, w.position, fs, null, SURF.paint), w);
  }
  return out;
}

// Raked bridge glass band: panes between x0..x1 on a z-face (front at zf, facing −Z when dir −1),
// raked outward at the top; dark glass with sky reflections (low roughness), mullions = the wall.
export function bridgeGlass(P, x0, x1, y0, y1, zf, { dir = -1, n = 7, rake = 0.24, color = '#1A2630' } = {}) {
  const w = (x1 - x0) / n;
  const h = y1 - y0;
  for (let i = 0; i < n; i++) {
    const x = x0 + w * (i + 0.5);
    P.push(p(UNIT.box, color, [x, (y0 + y1) / 2, zf + dir * (0.05 + Math.sin(rake) * h * 0.5)], [w - 0.12, h / Math.cos(rake), 0.06], [dir * rake, 0, 0], SURF.glass));
  }
}

// Inclined ladder (two stringers + treads) from a to b, width w.
export function ladderParts(P, a, b, w, color, { treads = 6, r = 0.04 } = {}) {
  const d = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]);
  const side = d.lengthSq() > 1e-6 ? new THREE.Vector3(-d.z, 0, d.x).normalize() : new THREE.Vector3(1, 0, 0);
  for (const s of [-0.5, 0.5]) {
    P.push(member([a[0] + side.x * w * s, a[1], a[2] + side.z * w * s], [b[0] + side.x * w * s, b[1], b[2] + side.z * w * s], r, color));
    P.push(member([a[0] + side.x * w * s, a[1] + 1, a[2] + side.z * w * s], [b[0] + side.x * w * s, b[1] + 1, b[2] + side.z * w * s], r * 0.8, color));
  }
  for (let k = 1; k < treads; k++) {
    const t = k / treads;
    const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    P.push(member([c[0] - side.x * w * 0.5, c[1], c[2] - side.z * w * 0.5], [c[0] + side.x * w * 0.5, c[1], c[2] + side.z * w * 0.5], r * 0.9, color));
  }
}

// Zig-zag stair tower between y0 and y1 on a w (x) × d (z) footprint centred at (x, z): corner
// posts, landings at alternating ends, flights as plates with a handrail, a cage of guard rails.
export function stairTower(P, x, z, y0, y1, { w = 2.6, d = 4.4, flight = 3.4, color = '#B89A3A', frame = '#7E868C' } = {}) {
  const n = Math.max(1, Math.ceil((y1 - y0) / flight));
  const h = (y1 - y0) / n;
  const za = z - d / 2 + 0.5, zb = z + d / 2 - 0.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(member([x + sx * w / 2, y0, z + sz * d / 2], [x + sx * w / 2, y1 + 1.1, z + sz * d / 2], 0.09, frame));
  for (let k = 0; k <= n; k++) {
    const y = y0 + k * h;
    const end = k % 2 ? zb : za;
    P.push(p(UNIT.box, frame, [x, y - 0.06, end + (k % 2 ? 0.25 : -0.25)], [w, 0.12, 1.5], null, SURF.steelWorn));
    if (k < n) {
      const xs = x + (k % 2 ? 0.6 : -0.6) * (w / 2);
      const from = [xs, y, k % 2 ? zb - 0.5 : za + 0.5], to = [xs, y + h, k % 2 ? za + 0.5 : zb - 0.5];
      P.push(boxBeam(from, to, w / 2 - 0.1, 0.1, color, SURF.steelWorn));
      const ox = (k % 2 ? 1 : -1) * (w / 2 - 0.05);
      P.push(member([x + ox, from[1] + 1, from[2]], [x + ox, to[1] + 1, to[2]], 0.035, color));
    }
    for (const sx of [-1, 1]) P.push(member([x + sx * w / 2, y + 1.05, z - d / 2], [x + sx * w / 2, y + 1.05, z + d / 2], 0.035, color));
  }
}

// Helideck safety net: a 1.5 m band sloping up 10° outward around the octagon, dark netting
// with a light outer frame tube and radial support arms.
export function netRing(P, cx, y, cz, R, { w = 1.5, color = '#23282B', frame = '#9AA1A6', rot = Math.PI / 8 } = {}) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = rot + (i / 8) * Math.PI * 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  const V = [];
  const rise = Math.tan(0.17) * w;
  for (let i = 0; i < 8; i++) {
    const [c0, s0] = pts[i], [c1, s1] = pts[i + 1];
    const a = [c0 * R, 0, s0 * R], b = [c1 * R, 0, s1 * R], c = [c0 * (R + w), rise, s0 * (R + w)], d = [c1 * (R + w), rise, s1 * (R + w)];
    V.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i += 9) for (let j = 0; j < 3; j++) { const t = pa[i + 3 + j]; pa[i + 3 + j] = pa[i + 6 + j]; pa[i + 6 + j] = t; }
    g.computeVertexNormals();
  }
  P.push({ geometry: g, color, position: [cx, y, cz], surf: SURF.fabric });
  for (let i = 0; i < 8; i++) {
    const [c0, s0] = pts[i], [c1, s1] = pts[i + 1];
    P.push(member([cx + c0 * (R + w), y + rise, cz + s0 * (R + w)], [cx + c1 * (R + w), y + rise, cz + s1 * (R + w)], 0.06, frame));
    for (const t of [0, 0.5]) {
      const cc = c0 + (c1 - c0) * t, ss = s0 + (s1 - s0) * t;
      P.push(member([cx + cc * R, y - 0.05, cz + ss * R], [cx + cc * (R + w), y + rise, cz + ss * (R + w)], 0.04, frame));
    }
  }
}

// --------------------------------------------------------------------------------------------
// Canvas deck painter (decal atlas region in px): steel plates with weld seams and per-plate tone,
// walkway wear (scuffed paint, bare steel), rust blooms, oil stains, gratings, hazard hatching,
// faded markings. ppm = px per metre. All lists in px of this region (origin ox, oy).
export function paintDeck(g, ox, oy, W, H, ppm, o = {}) {
  const { base = '#4B524E', plate = [6, 2], seed = 1, paths = [], rust = [], oil = 8, gratings = [], hatch = [], lines = [], marks = [], fade = 0.15 } = o;
  const r = rng(seed);
  g.save();
  g.beginPath();
  g.rect(ox, oy, W, H);
  g.clip();
  g.fillStyle = base;
  g.fillRect(ox, oy, W, H);
  // plates: tone drift per plate + seams
  const pw = plate[0] * ppm, ph = plate[1] * ppm;
  for (let y = 0; y < H; y += ph) {
    const shift = (Math.floor(y / ph) % 2) * pw * 0.5;
    for (let x = -shift; x < W; x += pw) {
      const v = r() - 0.5;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.07})` : `rgba(0,0,0,${-v * 0.1})`;
      g.fillRect(ox + x, oy + y, pw, ph);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(ox + x, oy + y, pw, Math.max(1, ppm * 0.05));
      g.fillRect(ox + x, oy + y, Math.max(1, ppm * 0.05), ph);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(ox + x, oy + y + Math.max(1, ppm * 0.05), pw, 1);
    }
  }
  // fine mottle
  for (let i = 0; i < (W * H) / 90; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(220,225,215,${0.03 + 0.04 * r()})` : `rgba(10,12,10,${0.04 + 0.06 * r()})`;
    const s = 1 + r() * ppm * 0.6;
    g.fillRect(ox + r() * W, oy + r() * H, s, s * (0.5 + r()));
  }
  // gratings: dark recess + crossing bars
  for (const [x, y, w, h] of gratings) {
    g.fillStyle = 'rgba(18,20,20,0.85)';
    g.fillRect(ox + x, oy + y, w, h);
    g.strokeStyle = 'rgba(120,124,118,0.55)';
    g.lineWidth = 1;
    const st = Math.max(2, ppm * 0.12);
    g.beginPath();
    for (let k = 0; k < w; k += st) { g.moveTo(ox + x + k, oy + y); g.lineTo(ox + x + k, oy + y + h); }
    for (let k = 0; k < h; k += st * 2.5) { g.moveTo(ox + x, oy + y + k); g.lineTo(ox + x + w, oy + y + k); }
    g.stroke();
    g.strokeStyle = 'rgba(150,150,140,0.5)';
    g.strokeRect(ox + x + 0.5, oy + y + 0.5, w - 1, h - 1);
  }
  // hazard hatching (yellow/black, faded)
  for (const [x, y, w, h] of hatch) {
    g.save();
    g.beginPath();
    g.rect(ox + x, oy + y, w, h);
    g.clip();
    g.fillStyle = 'rgba(28,28,26,0.8)';
    g.fillRect(ox + x, oy + y, w, h);
    g.strokeStyle = 'rgba(201,162,39,0.75)';
    g.lineWidth = ppm * 0.25;
    g.beginPath();
    for (let k = -h; k < w + h; k += ppm * 0.6) { g.moveTo(ox + x + k, oy + y + h); g.lineTo(ox + x + k + h, oy + y); }
    g.stroke();
    g.restore();
  }
  // painted lines and marks (walkway edges, muster point, no-step letters)
  for (const [x, y, w, h, c] of lines) {
    g.fillStyle = c || 'rgba(201,162,39,0.85)';
    g.fillRect(ox + x, oy + y, w, h);
  }
  for (const [text, x, y, size, c, rot] of marks) {
    g.save();
    g.translate(ox + x, oy + y);
    if (rot) g.rotate(rot);
    g.fillStyle = c || 'rgba(230,228,220,0.8)';
    g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }
  // chalky fade: noise-erase the paint toward the base colour
  if (fade > 0) {
    g.fillStyle = base;
    for (let i = 0; i < (W * H) / 60; i++) {
      g.globalAlpha = fade * (0.4 + r());
      const s = 1 + r() * ppm * 0.35;
      g.fillRect(ox + r() * W, oy + r() * H, s, s);
    }
    g.globalAlpha = 1;
  }
  // walkway wear: scuffed lighter paint with bare dark steel flecks along the paths
  for (const [x0, y0, x1, y1, w] of paths) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let i = 0; i < len * w * 0.06; i++) {
      const t = r(), off = (r() + r() + r() - 1.5) * w * 0.45;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      const x = x0 + (x1 - x0) * t + nx * off, y = y0 + (y1 - y0) * t + ny * off;
      g.fillStyle = r() < 0.7 ? `rgba(150,156,150,${0.05 + 0.07 * r()})` : `rgba(30,28,26,${0.08 + 0.1 * r()})`;
      const s = 1 + r() * ppm * 0.25;
      g.fillRect(ox + x, oy + y, s * (1 + 2 * r()), s);
    }
  }
  // rust blooms (fittings, chain runs, corners) and oil stains
  for (const [x, y, rad, k = 1] of rust) {
    for (let i = 0; i < 6; i++) {
      const cx = ox + x + (r() - 0.5) * rad, cy = oy + y + (r() - 0.5) * rad, rr = rad * (0.3 + 0.6 * r());
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, `rgba(110,58,30,${0.5 * k})`);
      gr.addColorStop(0.6, `rgba(95,55,35,${0.22 * k})`);
      gr.addColorStop(1, 'rgba(90,55,35,0)');
      g.fillStyle = gr;
      g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
  }
  for (let i = 0; i < oil; i++) {
    const cx = ox + r() * W, cy = oy + r() * H, rr = ppm * (0.4 + 1.6 * r());
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    gr.addColorStop(0, `rgba(8,8,8,${0.25 + 0.2 * r()})`);
    gr.addColorStop(1, 'rgba(8,8,8,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(cx, cy, rr, rr * (0.5 + 0.5 * r()), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
