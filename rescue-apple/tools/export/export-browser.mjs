// export-browser: vectors that need the live game in headless Chromium.
//   ocean/coast_<missionId>.json (+ .u8 sidecar): the coast distance map the ocean bakes from the rendered
//   terrain after mission:setup, plus 500 coastDistance samples evaluated in Node (pure arithmetic, so the
//   reference is engine-independent). The map itself is an INPUT for the Swift test: the bake depends on
//   terrain vertex positions computed with Chromium's libm, so bake parity belongs to the terrain vectors.
//
// Usage: node rescue-apple/tools/export/export-browser.mjs [--missions 0,2] [--out <dir>]
import { gameImport } from './shims/loader.mjs';
import path from 'node:path';
import { APPLE, num, writeWrapped, writeSidecar, relSrc } from './lib/common.mjs';
import { withBrowser } from './lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Tests/Vectors'));
const MISSIONS = String(args.missions || '0,2').split(',').map(Number);
const PRODUCER = 'tools/export/export-browser.mjs';

const { coastDistance, COAST_MAX } = await gameImport('systems/ocean/coast.js');
const { CAMPAIGN } = await gameImport('systems/mission/campaign.js');

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const results = [];
const errs = await withBrowser(async ({ page, open, errors }) => {
  for (const index of MISSIONS) {
    const id = CAMPAIGN[index].id;
    const t0 = Date.now();
    await open(`mission=${index}&autostart&quality=low&nohud&stub=audio`);
    await page.waitForFunction(() => window.__game.ocean?.bank?.coast?.data?.length > 0, null, { timeout: 120000, polling: 500 });
    const c = await page.evaluate(() => {
      const c = window.__game.ocean.bank.coast;
      let bin = '';
      const d = c.data;
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return { w: c.w, h: c.h, x0: c.x0, z0: c.z0, cell: c.cell, b64: btoa(bin), seed: window.__game.mission.def?.seed, mission: window.__game.mission.def?.id };
    });
    const data = new Uint8Array(Buffer.from(c.b64, 'base64'));
    if (data.length !== c.w * c.h) throw new Error(`coast ${id}: ${data.length} bytes for ${c.w}x${c.h}`);
    const map = { w: c.w, h: c.h, x0: c.x0, z0: c.z0, cell: c.cell, data };
    // 500 samples: 300 uniform over the map window (+ 10 % outside), 200 concentrated near the coastline
    const R = mulberry(4242 + index);
    const W = c.w * c.cell, H = c.h * c.cell;
    const samples = [];
    while (samples.length < 300) {
      const x = c.x0 - 0.1 * W + R() * 1.2 * W, z = c.z0 - 0.1 * H + R() * 1.2 * H;
      samples.push([num(x), num(z), num(coastDistance(map, x, z))]);
    }
    let guard = 0;
    while (samples.length < 500 && guard++ < 200000) {
      const x = c.x0 + R() * W, z = c.z0 + R() * H;
      const d = coastDistance(map, x, z);
      if (d > 0 && d < 20) samples.push([num(x), num(z), num(d)]);
    }
    const side = writeSidecar(path.join(OUT, 'ocean', `coast_${id}.u8`), data, [c.h, c.w]);
    results.push(writeWrapped(path.join(OUT, 'ocean', `coast_${id}.json`), {
      schema: `mayday.vectors.ocean.coast_${id}`, version: 1, producer: PRODUCER,
      files: [relSrc('systems/ocean/coast.js'), relSrc('systems/ocean.js'), relSrc('systems/world/terrain.js')],
      extra: { tolerance: { class: 'bitwise', note: 'coastDistance(map, x, z) bit-exact given the map (input); the map bytes are the Chromium bake, sha256 in data.map' } },
      data: {
        mission: { index, id, seed: c.seed, url: `?mission=${index}&autostart&quality=low&nohud&stub=audio` },
        COAST_MAX,
        map: { w: c.w, h: c.h, x0: num(c.x0), z0: num(c.z0), cell: num(c.cell), layout: 'u8 row-major, row j = z0 + (j + .5)·cell, value/255·COAST_MAX m', ...side },
        samples: { fields: ['x', 'z', 'coastDistance'], values: samples },
      },
    }));
    console.log(`coast ${id}: ${c.w}x${c.h} cell ${c.cell.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return errors;
});

for (const r of results) console.log(`${r.path}\t${r.bytes}`);
if (errs.length) { console.log('browser errors:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('browser errors: 0');
