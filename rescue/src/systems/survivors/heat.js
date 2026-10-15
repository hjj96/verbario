// Thermal / FLIR heat sources (CONTRACT «Depth pass additions»): post renders render layer 2 for the
// thermal view, so a heat source opts in with obj.layers.enable(2). `userData.heat` (0..1) says how hot
// it reads for a pass that grades sources (a plain layer-2 mask simply treats every source as hot):
//   people (opaque bodies)            1.0  — faces and hands above the water
//   people under the surface (ghost)  0.25 — water swallows most of the IR: a faint body under the head
//   occupied rafts                    0.7  — the canopy holds the body heat of the people inside
//   occupied hulls / the Ан-2         0.3  — residual warmth (engine block, people on the keel)
// Craft share one InstancedMesh per kind, so «only the occupied ones» is a heat-only proxy: the same
// geometry instanced again on layer 2 ONLY (the normal view and the shadow map never draw it), with a
// grey unlit material whose luminance is the heat for a pass that renders materials as they are.
import * as THREE from 'three';

export const HEAT_LAYER = 2;

export function markHeat(obj, heat = 1) {
  obj.layers.enable(HEAT_LAYER);
  obj.userData.heat = heat;
  return obj;
}

export class HeatProxy {
  constructor(name, geometry, heat, max) {
    this.max = max;
    this.n = 0;
    this.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(heat, heat, heat), fog: false, toneMapped: false });
    const mesh = (this.mesh = new THREE.InstancedMesh(geometry, this.material, max));
    mesh.name = `survivors.heat.${name}`;
    mesh.layers.set(HEAT_LAYER); // layer 2 only: invisible to the main and shadow cameras
    mesh.userData.heat = heat;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.visible = false;
  }

  begin() {
    this.n = 0;
  }

  push(m) {
    if (this.n < this.max) this.mesh.setMatrixAt(this.n++, m);
  }

  end() {
    const mesh = this.mesh;
    mesh.count = this.n;
    mesh.visible = this.n > 0;
    if (!this.n) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// Thermal gameplay (DESIGN: FLIR is a search tool): while the thermal view is on at night or in fog,
// the crew's detection radius grows ×1.6 and fog no longer blinds it (bodies read hot through the
// murk). By day the sea is as warm-looking as a swimmer's hood: no bonus.
export const THERMAL_DETECT = 1.6;
export function thermalBoost(ctx, env) {
  if (!ctx.post?.thermal?.active) return 1;
  return env.night > 0.45 || env.fog > 0.4 || env.preset === 'fog' ? THERMAL_DETECT : 1;
}
