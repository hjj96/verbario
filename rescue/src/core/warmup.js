// Shader warm-up (DESIGN §8.1: every effect material is pre-compiled at load).
// three.js builds a program the first time an object is drawn, so pooled or hidden effects (searchlight
// cone, flares, rafts, hazard funnels, rain/scud layers…) used to compile on the dramatic moment they first
// appeared — a 20–200 ms stall per program on ANGLE/D3D. main.js runs two passes after the first frame
// (scene.environment is baked by then) and again after each mission setup / quality change:
//   compileScene()  renderer.compileAsync over the whole graph, hidden objects included, with an off-screen
//                   target bound so the programs get the scene pass's key (the composer draws the scene into a
//                   linear target: linear output, no tone mapping). Parallel via KHR_parallel_shader_compile.
//   renderHidden()  one real frame with every hidden renderable shown and culling off: builds what compile()
//                   cannot reach (shadow depth programs, other passes) and finds the compiled programs ready.
//                   Lights keep their current visibility (a changed light count would key other programs).
//                   Everything is restored afterwards; nothing is added to or removed from the scene.
// Systems should therefore build effect materials up front (pooled, hidden) rather than inside spawn().
import * as THREE from 'three';

const isRenderable = (o) => o.isMesh || o.isPoints || o.isLine || o.isSprite;

// Resolves when the programs are linked (or after `timeout` ms, so a driver that never reports completion
// cannot stall the warm-up).
export function compileScene(renderer, scene, camera, { offscreen = true, timeout = 15000 } = {}) {
  const prev = renderer.getRenderTarget();
  const rt = offscreen ? new THREE.WebGLRenderTarget(1, 1) : null;
  let pending;
  try {
    renderer.setRenderTarget(rt);
    // without the extension compileAsync only adds a console warning: compile synchronously (same blocking cost)
    if (renderer.extensions.has('KHR_parallel_shader_compile')) pending = renderer.compileAsync(scene, camera);
    else pending = Promise.resolve(renderer.compile(scene, camera));
  } finally {
    renderer.setRenderTarget(prev);
  }
  let timer = 0;
  const cap = new Promise((resolve) => (timer = setTimeout(resolve, timeout)));
  return Promise.race([pending, cap]).finally(() => {
    clearTimeout(timer);
    rt?.dispose();
  });
}

// Calls render() once with every hidden object/material of the scene shown and frustum culling off.
export function renderHidden(scene, render) {
  const lit = new Set();
  scene.traverseVisible((o) => o.isLight && lit.add(o));
  const shown = [];
  const hidLights = [];
  const unculled = [];
  const mats = [];
  scene.traverse((o) => {
    if (o.isLight) {
      if (o.visible && !lit.has(o)) (o.visible = false), hidLights.push(o); // under a hidden parent: stays off
      return;
    }
    if (!o.visible) (o.visible = true), shown.push(o);
    if (!isRenderable(o)) return;
    if (o.frustumCulled) (o.frustumCulled = false), unculled.push(o);
    const m = o.material;
    for (const x of Array.isArray(m) ? m : [m]) if (x && !x.visible) (x.visible = true), mats.push(x);
  });
  try {
    render();
  } finally {
    for (const o of shown) o.visible = false;
    for (const o of hidLights) o.visible = true;
    for (const o of unculled) o.frustumCulled = true;
    for (const x of mats) x.visible = false;
  }
}
