// Water contact for everything that floats (DESIGN §2.7.2 [MUST]): a foam collar ring
// (0.8R…1.6R, noisy lace alpha) and a dark contact disc (25 %) — without them objects look pasted
// onto the sea. One instanced draw call for the whole world; each instance is oriented to the local
// wave normal at the CPU-mirrored wave height and brightens inside the heli searchlight.
import * as THREE from 'three';
import { createCollarMaterial } from './materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

export class Collars {
  constructor(look, shared, max = 320) {
    const g = new THREE.CircleGeometry(1, 30).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, createCollarMaterial(look, shared), max);
    this.mesh.name = 'world-collars';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iData', this.data);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.max = max;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  // (x, y, z): waterline centre; n: wave normal; R: object radius; yaw/elong for elongated hulls;
  // foam 0..1, dark 0..1 (contact darkness), lit 0..1 (searchlight), phase (noise offset).
  push(x, y, z, nx, ny, nz, R, foam, dark, lit, phase, yaw = 0, elong = 1) {
    if (this.n >= this.max) return;
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_UP, _n);
    if (yaw) _q.multiply(_qy.setFromAxisAngle(_UP, yaw));
    const r = 1.6 * R;
    _s.set(r, 1, r * elong);
    _p.set(x, y + 0.06, z);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.n, _m);
    const a = this.data.array;
    const j = this.n * 4;
    a[j] = foam;
    a[j + 1] = dark;
    a[j + 2] = lit;
    a[j + 3] = phase;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.data.needsUpdate = true;
  }
}
