// Hoist operator in the open starboard door (DESIGN §4 #9 [NICE]): a small kneeling figure — dark
// drysuit, helmet #FF5A1F — who leans out over the sill while the winch is working, guides the cable
// with the forward hand and points the aft arm at winch.target (or the basket), the arm limited to
// 70° from its rest pose (out and down). Built from capsules / tubes like the rescue swimmer, one
// merged body mesh + two small pivots (arm, head). Child of the airframe body, so it pitches and
// banks with the helicopter. Warm body → thermal layer 2 (CONTRACT «Depth pass additions»).
import * as THREE from 'three';
import { tube } from './shapes.js';

const SUIT = '#1D2226'; // dark drysuit
const SUIT_HI = '#2A3036';
const HELMET = '#FF5A1F';
const VISOR = '#0B1B26';
const GLOVE = '#141618';
const TAPE = '#C9CED2'; // reflective shoulder tape
const WEB = '#3B4148'; // gunner's belt webbing
const LIMIT = (70 * Math.PI) / 180;
const REST = new THREE.Vector3(0.8, -0.6, 0).normalize(); // arm rest direction (out and down)
const X = new THREE.Vector3(1, 0, 0);

// Crew-local frame: origin on the cabin floor at the door sill, +x outward (starboard), +y up, +z aft.
const ORIGIN = new THREE.Vector3(1.12, -0.9, -0.9); // in the airframe body frame
const SCALE = 1.4; // figures are drawn ~1.4× like the rescue swimmer so they read from the drone
const SHOULDER_AIM = new THREE.Vector3(0.2, 0.92, 0.19); // pointing (aft) shoulder
const NECK = new THREE.Vector3(0.27, 1.0, 0);

export class Crewman {
  constructor(ctx, model) {
    this.ctx = ctx;
    const look = ctx.look;
    const parts = [];
    const cap = (a, b, r0, r1 = r0, color = SUIT) => {
      parts.push({ geometry: tube(a, b, r0, r1, 7), color });
      parts.push({ geometry: new THREE.SphereGeometry(r1, 7, 5), position: b, color });
    };
    // torso leaning out over the sill (hips → shoulders), chest pack and gunner's belt
    cap([-0.24, 0.5, 0], [0.18, 0.9, 0], 0.17, 0.19, SUIT);
    parts.push({ geometry: new THREE.SphereGeometry(0.17, 8, 6), position: [-0.24, 0.5, 0], color: SUIT });
    parts.push({ geometry: new THREE.BoxGeometry(0.2, 0.26, 0.3), position: [0.04, 0.66, 0], rotation: [0, 0, -0.78], color: SUIT_HI });
    parts.push({ geometry: new THREE.BoxGeometry(0.42, 0.06, 0.4), position: [-0.12, 0.62, 0], rotation: [0, 0, -0.78], color: WEB });
    parts.push({ geometry: tube([-0.3, 0.62, 0], [-0.75, 1.3, 0.05], 0.018, 0.018, 4), color: WEB }); // tether to the cabin roof
    // reflective tape across the shoulders
    parts.push({ geometry: new THREE.BoxGeometry(0.08, 0.05, 0.44), position: [0.17, 0.97, 0], rotation: [0, 0, -0.7], color: TAPE });
    // legs: kneeling on the floor, shins back into the cabin
    for (const s of [-1, 1]) {
      cap([-0.24, 0.46, 0.11 * s], [0.06, 0.1, 0.14 * s], 0.09, 0.085, SUIT);
      cap([0.06, 0.1, 0.14 * s], [-0.38, 0.07, 0.15 * s], 0.08, 0.07, SUIT);
      parts.push({ geometry: new THREE.BoxGeometry(0.22, 0.09, 0.11), position: [-0.44, 0.05, 0.15 * s], color: GLOVE });
    }
    // forward arm guides the cable towards the hoist (static)
    cap([0.2, 0.92, -0.19], [0.46, 0.84, -0.3], 0.065, 0.06, SUIT);
    cap([0.46, 0.84, -0.3], [0.68, 1.02, -0.36], 0.058, 0.055, SUIT);
    parts.push({ geometry: new THREE.SphereGeometry(0.06, 7, 5), position: [0.72, 1.05, -0.37], color: GLOVE });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    this.mat = mat;

    this.group = new THREE.Group();
    this.group.name = 'heli.crewman';
    this.group.position.copy(ORIGIN);
    this.group.scale.setScalar(SCALE);
    this.body = new THREE.Mesh(look.merge(parts), mat);
    this.body.castShadow = true;
    this.group.add(this.body);

    // pointing arm (aft shoulder pivot, points along +x)
    const ap = [];
    ap.push({ geometry: tube([0, 0, 0], [0.34, 0, 0], 0.068, 0.062, 7), color: SUIT });
    ap.push({ geometry: new THREE.SphereGeometry(0.068, 7, 5), color: SUIT });
    ap.push({ geometry: tube([0.34, 0, 0], [0.64, 0, 0], 0.06, 0.052, 7), color: SUIT });
    ap.push({ geometry: new THREE.BoxGeometry(0.06, 0.07, 0.065), position: [0.36, 0.03, 0], color: TAPE }); // elbow tape
    ap.push({ geometry: tube([0.52, 0, 0], [0.58, 0, 0], 0.058, 0.056, 7), color: TAPE }); // cuff tape
    ap.push({ geometry: new THREE.SphereGeometry(0.062, 7, 5), position: [0.68, 0, 0], color: GLOVE });
    ap.push({ geometry: tube([0.68, 0, 0], [0.8, 0, 0], 0.022, 0.018, 4), color: GLOVE }); // index finger
    this.arm = new THREE.Mesh(look.merge(ap), mat);
    this.arm.castShadow = true;
    this.arm.position.copy(SHOULDER_AIM);
    this.arm.quaternion.setFromUnitVectors(X, REST);
    this.group.add(this.arm);

    // head: helmet + visor + boom mic, looks where the arm points (softer)
    const hp = [];
    hp.push({ geometry: new THREE.SphereGeometry(0.15, 10, 8), position: [0.05, 0.1, 0], color: HELMET });
    hp.push({ geometry: new THREE.BoxGeometry(0.06, 0.1, 0.2), position: [0.17, 0.07, 0], color: VISOR });
    hp.push({ geometry: new THREE.BoxGeometry(0.2, 0.025, 0.24), position: [0.04, 0.24, 0], color: '#E04E1A' }); // helmet ridge
    hp.push({ geometry: tube([0.08, 0.01, -0.12], [0.2, -0.03, -0.04], 0.012, 0.012, 4), color: GLOVE });
    this.head = new THREE.Mesh(look.merge(hp), mat);
    this.head.castShadow = true;
    this.head.position.copy(NECK);
    this.group.add(this.head);

    // warm body: visible to the thermal camera (layer 2), still drawn normally (layer 0)
    for (const m of [this.body, this.arm, this.head]) m.layers.enable(2);

    this.group.visible = false;
    model.body.add(this.group);

    this.lean = 0; // 0 = inside the cabin, 1 = leaning out over the sill
    this._t = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qh = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  reset() {
    this.lean = 0;
    this.group.visible = false;
    this.arm.quaternion.setFromUnitVectors(X, REST);
    this.head.quaternion.identity();
  }

  // Per rendered frame, after the airframe transforms are up to date.
  update(dt, heli) {
    const w = heli.winch;
    const working = heli.alive && !heli.ditched && (w.state !== 'stowed' || w.length > 0.05 || !!w.target);
    const k = 1 - Math.exp(-dt * (working ? 3.5 : 2.5));
    this.lean += ((working ? 1 : 0) - this.lean) * k;
    if (!working && this.lean < 0.02) this.lean = 0;
    const g = this.group;
    g.visible = this.lean > 0.02;
    if (!g.visible) return;
    // slide out of the dark cabin onto the sill
    g.position.set(ORIGIN.x - 0.55 * (1 - this.lean), ORIGIN.y, ORIGIN.z);
    g.updateMatrixWorld(true);

    // aim: the target person (or deck), else the basket / load
    const tp = w.target?.position;
    const t = this._t;
    if (tp && Number.isFinite(tp.x + tp.z)) t.set(tp.x, Number.isFinite(tp.y) ? tp.y : w.basket.y, tp.z);
    else t.copy(w.basket);
    g.worldToLocal(t); // crew-local (scaled frame)
    const d = this._d.copy(t).sub(SHOULDER_AIM);
    if (d.lengthSq() < 1e-6 || !Number.isFinite(d.x + d.y + d.z)) d.copy(REST);
    d.normalize();
    // clamp to 70° from the rest pose
    const ang = Math.acos(Math.min(1, Math.max(-1, d.dot(REST))));
    if (ang > LIMIT) {
      const axis = this._t.crossVectors(REST, d);
      if (axis.lengthSq() < 1e-8) d.copy(REST);
      else d.copy(REST).applyAxisAngle(axis.normalize(), LIMIT);
    }
    // while leaning out the arm comes up gradually from the rest pose
    if (this.lean < 0.999) d.lerp(REST, 1 - this.lean).normalize();
    this._q.setFromUnitVectors(X, d);
    const ka = 1 - Math.exp(-dt * 7);
    this.arm.quaternion.slerp(this._q, ka);
    // head follows at ~60 % (yaw about y, pitch about z), small limits
    const yaw = Math.atan2(-d.z, d.x) * 0.6;
    const pitch = Math.max(-0.7, Math.min(0.25, Math.asin(Math.max(-1, Math.min(1, d.y))) * 0.6 + 0.15));
    this._qh.setFromEuler(this._e.set(0, yaw, pitch, 'YZX'));
    this.head.quaternion.slerp(this._qh, ka);
  }
}
