// One command for the whole web -> port export: data, vectors, (optionally) browser vectors, verify.
//
//   node rescue-apple/tools/export/run-all.mjs                 render + data + vectors + verify (Node only, ~5 s)
//   node rescue-apple/tools/export/run-all.mjs --browser       + coast maps from Chromium + live spot checks
//   node rescue-apple/tools/export/run-all.mjs --only data     render | data | vectors | core | sim | heli | browser | verify
// render (three's DFG LUT) runs before data, whose manifest.json then hashes the fresh dfg_lut.rg16f.
//
// Each step is a separate Node process (the loader hooks and DOM shims stay per-process).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const browser = argv.includes('--browser');
const onlyArg = argv.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1]).split(',') : null;

const steps = [
  ['render', ['export-render.mjs']],
  ['data', ['export-data.mjs']],
  ['vectors', ['export-vectors.mjs']],
  ['core', ['export-core.mjs']], // core foundation: jsnumber, three math, events, loop, settings, input
  ['sim', ['export-sim.mjs']], // weather / ocean sim: time-stepped runs, gusts, lightning, sun rig, endless, features
  ['heli', ['export-heli.mjs']], // helicopter + camera rig traces (real Helicopter / CameraRig on stub systems), projection, shake
  ['browser', ['export-browser.mjs'], true],
  ['verify', ['verify.mjs', ...(browser ? ['--browser'] : [])]],
];

for (const [name, cmd, needsBrowser] of steps) {
  if (only && !only.includes(name)) continue;
  if (!only && needsBrowser && !browser) continue;
  const t0 = Date.now();
  console.log(`\n== ${name}`);
  const r = spawnSync(process.execPath, [path.join(here, cmd[0]), ...cmd.slice(1)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`run-all: step "${name}" failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  console.log(`== ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
