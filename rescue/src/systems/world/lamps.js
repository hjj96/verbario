// Lamps: every navigation light, floodlight, perimeter light, lantern and buoy flash of the world
// as ONE additive instanced draw call (bulb core + soft halo, DESIGN §2.4 colours). Lamps may be
// parented to a moving Object3D (the ship): their world position is refreshed every frame from the
// parent's matrixWorld. Intensity comes from per-channel values (materials.js CH) the world animates.
import * as THREE from 'three';
import { createLampMaterial } from './materials.js';

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class Lamps {
  constructor(look, shared, max = 768) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSz = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iCol', this.iCol);
    g.setAttribute('iSz', this.iSz);
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, createLampMaterial(look, shared));
    this.mesh.name = 'world-lamps';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.count = 0;
    this.local = new Float32Array(max * 3);
    this.parents = []; // Object3D | null per lamp
    this.dynamic = []; // indices of parented lamps
  }

  clear() {
    this.count = 0;
    this.parents.length = 0;
    this.dynamic.length = 0;
    this.geometry.instanceCount = 0;
  }

  // Add a lamp. Position is local to `parent` (or world when parent is null).
  // opts: gain (HDR multiplier), bulb (m), halo (m), ch (channel), pen (fog penetration 0..1).
  add(x, y, z, color, { gain = 4, bulb = 0.22, halo = 2.2, ch = 0, pen = 0.15, parent = null } = {}) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.local[i * 3] = x;
    this.local[i * 3 + 1] = y;
    this.local[i * 3 + 2] = z;
    this.parents[i] = parent;
    if (parent) this.dynamic.push(i);
    this.iPos.array.set([x, y, z], i * 3);
    _c.set(color);
    this.iCol.array.set([_c.r, _c.g, _c.b, gain], i * 4);
    this.iSz.array.set([bulb, halo, ch, pen], i * 4);
    this.iCol.needsUpdate = true;
    this.iSz.needsUpdate = true;
    this.iPos.needsUpdate = true;
    this.geometry.instanceCount = this.count;
    return i;
  }

  // Move a lamp (local to its parent).
  setLocal(i, x, y, z) {
    if (i < 0) return;
    this.local[i * 3] = x;
    this.local[i * 3 + 1] = y;
    this.local[i * 3 + 2] = z;
    if (!this.parents[i]) {
      this.iPos.array[i * 3] = x;
      this.iPos.array[i * 3 + 1] = y;
      this.iPos.array[i * 3 + 2] = z;
      this.iPos.needsUpdate = true;
    }
  }

  setGain(i, gain) {
    if (i < 0) return;
    this.iCol.array[i * 4 + 3] = gain;
    this.iCol.needsUpdate = true;
  }

  // Refresh world positions of parented lamps (call after the parents' matrixWorld is current).
  update() {
    const d = this.dynamic;
    if (!d.length) return;
    const P = this.iPos.array;
    const L = this.local;
    for (let k = 0; k < d.length; k++) {
      const i = d[k];
      _v.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(this.parents[i].matrixWorld);
      P[i * 3] = _v.x;
      P[i * 3 + 1] = _v.y;
      P[i * 3 + 2] = _v.z;
    }
    this.iPos.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
