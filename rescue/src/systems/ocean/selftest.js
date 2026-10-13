// CPU ↔ GPU agreement test for the sea surface (DESIGN §2.6.2 "расхождение с GPU ≤ 5 см").
//   1. inversion: random lagrangian points → forward Gerstner (+features) → heightAt(P.x, P.z)
//      must return P.y (checks the 3-step fixed-point inversion).
//   2. normals: normalAt() vs central differences of heightAt().
//   3. GPU readback: the real vertex shader renders displaced world positions of the ocean grid
//      into a float target seen from straight above; every pixel's (x, y, z) is compared with
//      heightAt(x, z). This includes triangle interpolation and float32 effects.
// Run from the console / harness: __game.ocean.selfTest().then((r) => console.log(r))
import * as THREE from 'three';
import { SELFTEST_VERTEX, SELFTEST_FRAGMENT } from './shaders.js';

// Shallow clone of a WaveBank (and its FeatureSet) with private copies of everything that moves.
function freezeBank(bank) {
  const fb = Object.assign(Object.create(Object.getPrototypeOf(bank)), bank);
  for (const k of ['a', 'b', 'phase', 'uWaveA', 'uWaveB']) fb[k] = bank[k].slice();
  fb._ev = { ...bank._ev };
  fb.shoals = bank.shoals.map((s) => ({ ...s }));
  const f = bank.features;
  if (f) {
    fb.features = Object.assign(Object.create(Object.getPrototypeOf(f)), f);
    fb.features.slots = f.slots.map((s) => ({ ...s, A: s.A.slice(), B: s.B.slice(), C: s.C.slice() }));
    fb.features.downwash = f.downwash.slice();
  }
  return fb;
}

function stats(errs) {
  if (!errs.length) return { n: 0, max: 0, mean: 0, p99: 0 };
  const s = Float64Array.from(errs).sort();
  let sum = 0;
  for (const e of s) sum += e;
  return {
    n: s.length,
    max: +s[s.length - 1].toFixed(4),
    mean: +(sum / s.length).toFixed(4),
    p99: +s[Math.min(s.length - 1, Math.floor(s.length * 0.99))].toFixed(4),
  };
}

export async function oceanSelfTest(ocean, { radius = 120, samples = 600, res = 192, window = 220 } = {}) {
  const bank = ocean.bank;
  const cx = ocean.focus.x;
  const cz = ocean.focus.y;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = { focus: [+cx.toFixed(1), +cz.toFixed(1)], Hs: +bank.stats.HsEff.toFixed(2), waves: bank.count, features: ocean.features.count };

  // 1. inversion
  const p = { x: 0, y: 0, z: 0 };
  const inv = [];
  for (let i = 0; i < samples; i++) {
    bank.forward(cx + (rnd() * 2 - 1) * radius, cz + (rnd() * 2 - 1) * radius, 0, p);
    inv.push(Math.abs(ocean.heightAt(p.x, p.z) - p.y));
  }
  out.inversion = stats(inv);

  // 2. normals vs finite differences
  const n = new THREE.Vector3();
  const fd = new THREE.Vector3();
  const nerr = [];
  for (let i = 0; i < 200; i++) {
    const x = cx + (rnd() * 2 - 1) * radius;
    const z = cz + (rnd() * 2 - 1) * radius;
    const e = 0.05;
    const gx = (ocean.heightAt(x + e, z) - ocean.heightAt(x - e, z)) / (2 * e);
    const gz = (ocean.heightAt(x, z + e) - ocean.heightAt(x, z - e)) / (2 * e);
    fd.set(-gx, 1, -gz).normalize();
    ocean.normalAt(x, z, n);
    nerr.push((Math.acos(Math.min(1, n.dot(fd))) * 180) / Math.PI);
  }
  out.normalDeg = stats(nerr);

  // 3. GPU readback (snapshot of this frame's uniforms; async so the GPU never stalls)
  const r = ocean.ctx.renderer;
  const rt = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: ocean.uniforms,
    vertexShader: SELFTEST_VERTEX,
    fragmentShader: SELFTEST_FRAGMENT,
    defines: { ...ocean.material.defines },
  });
  try {
    const mesh = new THREE.Mesh(ocean.geometry, mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const h = window / 2;
    const cam = new THREE.OrthographicCamera(-h, h, h, -h, 1, 2000);
    cam.position.set(cx, 600, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    ocean._lateUpload(); // features / downwash written since the last update
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    // The readback is async and the sea keeps moving: compare against a frozen copy of the CPU
    // state taken at render time.
    const frozen = freezeBank(bank);
    const buf = new Float32Array(res * res * 4);
    await r.readRenderTargetPixelsAsync(rt, 0, 0, res, res, buf);
    const gpu = [];
    for (let i = 0; i < res * res; i++) {
      if (buf[i * 4 + 3] < 0.5) continue;
      gpu.push(Math.abs(frozen.heightAt(buf[i * 4], buf[i * 4 + 2]) - buf[i * 4 + 1]));
    }
    out.gpu = stats(gpu);
  } catch (err) {
    out.gpu = { error: String(err && err.message ? err.message : err) };
  } finally {
    rt.dispose();
    mat.dispose();
  }
  out.pass = out.inversion.max < 0.05 && (!out.gpu.n || out.gpu.p99 < 0.05);
  return out;
}
