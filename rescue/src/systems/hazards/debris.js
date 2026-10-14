// Flotsam and airborne debris (DESIGN §2.12 «Торнадо»: boards, barrels and — at the climax — a boat circling
// the funnel; §2.6.7 «Водоворот»: a piece of wreckage and a lifebuoy circling forever).
// One InstancedMesh per shape (≤ 4 draw calls + shadow passes), items are plain objects the owning hazard
// moves every frame; update() writes their matrices. Colours are weathered and cold — no orange (§1.1).
import * as THREE from 'three';
import { COLORS, TAU } from './common.js';

const CAPS = { board: 48, barrel: 16, buoy: 6, boat: 2 };

function buildGeometries(look) {
  const C = (h) => new THREE.Color(h);
  const geos = {};
  // plank: a long board with a darker edge strip (the instance colour tints the wood tone)
  geos.board = look.merge([
    { geometry: new THREE.BoxGeometry(3.4, 0.2, 0.5), color: C('#FFFFFF') },
    { geometry: new THREE.BoxGeometry(3.42, 0.08, 0.12), color: C('#8C8C8C'), position: [0, 0.1, 0.2] },
  ]);
  // barrel: body + two ribs
  const body = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 12, 1);
  const rib = new THREE.CylinderGeometry(0.445, 0.445, 0.08, 12, 1);
  geos.barrel = look.merge([
    { geometry: body, color: C('#FFFFFF') },
    { geometry: rib, color: C('#7A7A7A'), position: [0, 0.32, 0] },
    { geometry: rib, color: C('#7A7A7A'), position: [0, -0.32, 0] },
  ]);
  // lifebuoy: four alternating red / white quarter arcs, lying flat
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.TorusGeometry(0.62, 0.17, 8, 10, Math.PI / 2),
      color: C(i % 2 ? COLORS.buoyRed : COLORS.buoyWhite),
      rotation: [Math.PI / 2, 0, (i * Math.PI) / 2],
    });
  }
  geos.buoy = look.merge(parts);
  // small open boat (~5 m): flat bottom, flared sides, bow wedge, thwart; white hull, dark sheer stripe
  const hull = C(COLORS.hullWhite);
  const dark = C(COLORS.hullDark);
  const wood = C(COLORS.woodLight);
  geos.boat = look.merge([
    { geometry: new THREE.BoxGeometry(3.6, 0.35, 1.5), color: hull, position: [-0.3, 0, 0] },
    { geometry: new THREE.BoxGeometry(3.6, 0.7, 0.1), color: hull, position: [-0.3, 0.45, 0.78], rotation: [-0.25, 0, 0] },
    { geometry: new THREE.BoxGeometry(3.6, 0.7, 0.1), color: hull, position: [-0.3, 0.45, -0.78], rotation: [0.25, 0, 0] },
    { geometry: new THREE.BoxGeometry(3.62, 0.1, 0.12), color: dark, position: [-0.3, 0.78, 0.86] },
    { geometry: new THREE.BoxGeometry(3.62, 0.1, 0.12), color: dark, position: [-0.3, 0.78, -0.86] },
    { geometry: new THREE.ConeGeometry(0.95, 1.6, 4, 1), color: hull, position: [2.25, 0.3, 0], rotation: [0, Math.PI / 4, -Math.PI / 2], scale: [1, 1, 0.85] },
    { geometry: new THREE.BoxGeometry(0.1, 0.62, 1.4), color: hull, position: [-2.1, 0.4, 0] },
    { geometry: new THREE.BoxGeometry(0.3, 0.08, 1.5), color: wood, position: [0.2, 0.5, 0] },
    { geometry: new THREE.BoxGeometry(2.8, 0.06, 1.2), color: wood, position: [-0.3, 0.2, 0] },
  ]);
  return geos;
}

export class Debris {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'hazards.debris';
    const geos = buildGeometries(ctx.look);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.6 });
    this.meshes = {};
    this.items = {};
    for (const kind of Object.keys(CAPS)) {
      const m = new THREE.InstancedMesh(geos[kind], this.material, CAPS[kind]);
      m.name = `hazards.debris.${kind}`;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      // per-instance tint (wood tones, blue / rust barrels); white = keep the baked vertex colours
      for (let i = 0; i < CAPS[kind]; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));
      this.group.add(m);
      this.meshes[kind] = m;
      this.items[kind] = [];
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.kinds = Object.keys(CAPS);
  }

  // Take an item of a shape. Returns a plain object the owner moves ({x, y, z, rx, ry, rz, scale}).
  acquire(kind, owner, tint) {
    const list = this.items[kind];
    if (!list || list.length >= CAPS[kind]) return null;
    const it = { kind, owner, x: 0, y: -50, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, tint: tint || null };
    list.push(it);
    return it;
  }

  releaseOwner(owner) {
    for (const kind of this.kinds) {
      const list = this.items[kind];
      for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) list.splice(i, 1);
    }
  }

  clear() {
    for (const kind of this.kinds) this.items[kind].length = 0;
    this.update();
  }

  update() {
    for (const kind of this.kinds) {
      const list = this.items[kind];
      const mesh = this.meshes[kind];
      let tintDirty = false;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        this._e.set(it.rx, it.ry, it.rz);
        this._q.setFromEuler(this._e);
        this._m.compose(this._p.set(it.x, it.y, it.z), this._q, this._s.setScalar(it.scale));
        mesh.setMatrixAt(i, this._m);
        if (it._tintSlot !== i) {
          this._c.set(it.tint || '#FFFFFF');
          mesh.setColorAt(i, this._c);
          it._tintSlot = i;
          tintDirty = true;
        }
      }
      mesh.count = list.length;
      mesh.visible = list.length > 0;
      if (list.length) mesh.instanceMatrix.needsUpdate = true;
      if (tintDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  warmup(on) {
    for (const kind of this.kinds) {
      const m = this.meshes[kind];
      m.visible = on;
      m.count = on ? 1 : 0;
      if (on) {
        m.setMatrixAt(0, this._m.makeTranslation(0, -200, 0));
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

// Random weathered tints for the tornado's airborne junk.
export function debrisTint(kind, rnd) {
  if (kind === 'board') return rnd() < 0.5 ? COLORS.wood : COLORS.woodLight;
  if (kind === 'barrel') return rnd() < 0.6 ? COLORS.barrelBlue : COLORS.barrelRust;
  return null;
}

export const DEBRIS_TAU = TAU;
