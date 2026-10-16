// verify: sanity + drift checks for everything the exporters wrote, optionally against the live game.
//
//   1. every Resources/Data/*.json and Tests/Vectors/**/*.json parses, carries the wrapper
//      (schema, version, source), stays within the size budget (vectors < 1 MB per file);
//   2. manifest.json lists every Resources/Data/*.json and Resources/Textures/* file and its sizes and
//      hashes match; sidecar hashes match their JSON references;
//   3. --browser: loads the game in headless Chromium (?mission=0&autostart&quality=low) and
//        a) re-serialises every EXPORTED table of every module from the page's own module instances and
//           compares with Resources/Data (exact / libm-ulp / mismatch);
//        b) re-runs vector inputs through the page's modules (rng, noise, look fields, WaveBank, medals)
//           and reports bitwise matches and the max ulp distance (Chromium's sin/cos/pow are glibc's, the
//           reference engine is Node 22 — small ulp differences there are expected and reported, not failed);
//        c) checks live state (__game.settings, mission def, ocean quality) against the exported data;
//        d) fails on any console error / page error / failed request.
//
// Usage: node rescue-apple/tools/export/verify.mjs [--browser]
import fs from 'node:fs';
import path from 'node:path';
import { APPLE, sha256, makeSerializer } from './lib/common.mjs';

const args = new Set(process.argv.slice(2));
const problems = [];
const note = [];

// ------------------------------------------------------------------------------------------- files
function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out.sort();
}
const dataDir = path.join(APPLE, 'Resources/Data');
const vecDir = path.join(APPLE, 'Tests/Vectors');
const jsons = [...walk(dataDir), ...walk(vecDir)].filter((f) => f.endsWith('.json'));
let totalBytes = 0;
const loaded = new Map();
for (const f of jsons) {
  const rel = path.relative(APPLE, f);
  const buf = fs.readFileSync(f);
  totalBytes += buf.length;
  let j;
  try { j = JSON.parse(buf); } catch (e) { problems.push(`${rel}: invalid JSON (${e.message})`); continue; }
  loaded.set(rel, j);
  if (!j.schema || !(j.version >= 1)) problems.push(`${rel}: missing schema/version`);
  if (!rel.endsWith('manifest.json') && !/^[0-9a-f]{40}$/.test(j.source || '')) problems.push(`${rel}: source is not a git sha`);
  if (rel.startsWith('Tests/') && buf.length >= 1024 * 1024) problems.push(`${rel}: ${buf.length} bytes >= 1 MB`);
  if (rel.startsWith('Tests/') && !j.tolerance) problems.push(`${rel}: no tolerance`);
  // sidecars referenced as {file, dtype, shape, sha256}
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.file === 'string' && typeof v.sha256 === 'string' && v.dtype) {
      const p = v.file.includes('/') ? path.join(APPLE, v.file) : path.join(path.dirname(f), v.file);
      if (!fs.existsSync(p)) problems.push(`${rel}: sidecar ${v.file} missing`);
      else {
        const b = fs.readFileSync(p);
        totalBytes += b.length;
        if (sha256(b) !== v.sha256) problems.push(`${rel}: sidecar ${v.file} sha mismatch`);
        const size = { f64: 8, f32: 4, u8: 1, i32: 4, u32: 4 }[v.dtype];
        if (v.shape && b.length !== v.shape.reduce((a, c) => a * c, 1) * size) problems.push(`${rel}: sidecar ${v.file} size != shape`);
      }
    }
    for (const x of Object.values(v)) visit(x);
  };
  visit(j.data);
}
const manifest = loaded.get('Resources/Data/manifest.json');
if (manifest) {
  const listed = new Set();
  for (const e of manifest.files) {
    listed.add(e.path);
    const p = path.join(APPLE, e.path);
    if (!fs.existsSync(p)) { problems.push(`manifest: ${e.path} missing`); continue; }
    const buf = fs.readFileSync(p);
    if (typeof e.bytes === 'number' && e.bytes !== buf.length) problems.push(`manifest: ${e.path} is ${buf.length} bytes, manifest says ${e.bytes} (re-run run-all.mjs)`);
    if (sha256(buf) !== e.sha256) problems.push(`manifest: ${e.path} sha mismatch (re-run run-all.mjs)`);
  }
  // coverage: every shipped data / texture file is listed (DataCatalog.verifyAll only checks listed files)
  const shipped = [
    ...walk(dataDir).filter((f) => f.endsWith('.json') && path.basename(f) !== 'manifest.json'),
    ...(fs.existsSync(path.join(APPLE, 'Resources/Textures')) ? fs.readdirSync(path.join(APPLE, 'Resources/Textures')) : [])
      .map((f) => path.join(APPLE, 'Resources/Textures', f))
      .filter((f) => !path.basename(f).startsWith('.') && fs.statSync(f).isFile()),
  ].map((f) => path.relative(APPLE, f).split(path.sep).join('/'));
  for (const rel of shipped) if (!listed.has(rel)) problems.push(`manifest: ${rel} is not listed (re-run run-all.mjs)`);
  const lut = manifest.files.find((e) => e.path === 'Resources/Textures/dfg_lut.rg16f');
  if (!lut || lut.schema !== 'raw.rg16f' || lut.bytes !== 1024) problems.push('manifest: Resources/Textures/dfg_lut.rg16f must be listed as raw.rg16f, 1024 bytes');
} else problems.push('Resources/Data/manifest.json missing');
console.log(`files: ${jsons.length} JSON (+ sidecars), ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);

// ------------------------------------------------------------------------------------------ browser
function ulpDist(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return a === b ? 0 : Infinity;
  if (Object.is(a, b)) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  const f = new Float64Array([a, b]);
  const i = new BigInt64Array(f.buffer);
  const k = (x) => (x < 0n ? -(x & 0x7fffffffffffffffn) : x);
  const d = k(i[0]) - k(i[1]);
  return Number(d < 0n ? -d : d);
}
const decode = (v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v === '-0' ? -0 : v);
function cmpArrays(name, ref, got) {
  let eq = 0, maxU = 0, worst = -1;
  const n = Math.min(ref.length, got.length);
  for (let i = 0; i < n; i++) {
    const u = ulpDist(decode(ref[i]), decode(got[i]));
    if (u === 0) eq++; else if (u > maxU) { maxU = u; worst = i; }
  }
  if (ref.length !== got.length) problems.push(`${name}: length ${got.length} != ${ref.length}`);
  return { name, n, bitwise: eq, maxUlp: maxU, worst: worst >= 0 ? { i: worst, ref: ref[worst], got: got[worst] } : null };
}
function cmpTree(a, b, p = '', acc = { exact: 0, ulp: 0, maxUlp: 0, diff: [] }) {
  if (typeof a === 'number' && typeof b === 'number') {
    const u = ulpDist(a, b);
    if (u === 0) acc.exact++; else if (u <= 64) { acc.ulp++; acc.maxUlp = Math.max(acc.maxUlp, u); } else acc.diff.push(p);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of new Set([...ka, ...kb])) {
      if (!(k in a) || !(k in b)) { acc.diff.push(p + '.' + k); continue; }
      cmpTree(a[k], b[k], p + '.' + k, acc);
    }
  } else if (a === b) acc.exact++;
  else acc.diff.push(p);
  return acc;
}

if (args.has('--browser')) {
  const { withBrowser } = await import('./lib/browser.mjs');
  const vec = (n) => loaded.get(`Tests/Vectors/${n}.json`).data;
  const dataFiles = [...loaded.entries()].filter(([k]) => k.startsWith('Resources/Data/') && !k.endsWith('manifest.json') && !k.endsWith('events.json'));
  const modulesByKey = new Map();
  for (const [, j] of dataFiles) for (const [key, tbl] of Object.entries(j.data)) if (key !== 'derived') modulesByKey.set(key, tbl);

  const report = await withBrowser(async ({ page, open, errors }) => {
    await open('mission=0&autostart&quality=low&nohud&stub=audio');
    await page.waitForFunction(() => window.__game.mode === 'play' && window.__game.mission?.def, null, { timeout: 60000 });
    await page.evaluate(`window.__mkSer = ${makeSerializer.toString()};`);
    // a) exported tables
    const keys = [...modulesByKey.keys()].filter((k) => k !== 'main');
    const liveTables = await page.evaluate(async (keys) => {
      const { serialize } = window.__mkSer();
      const out = {};
      for (const key of keys) {
        const rel = (key.startsWith('core/') || key.startsWith('ui/') ? '' : 'systems/') + key + '.js';
        try {
          const m = await import('/rescue/src/' + rel);
          const o = {};
          for (const [k, v] of Object.entries(m)) if (typeof v !== 'function' && !k.startsWith('_')) o[k] = serialize(v);
          out[key] = o;
        } catch (e) { out[key] = { __error: String(e) }; }
      }
      return out;
    }, keys);
    const tables = { compared: 0, exact: 0, ulpOnly: 0, ulpNames: [], maxUlp: 0, mismatched: [], skippedUniforms: [] };
    for (const key of keys) {
      const ref = modulesByKey.get(key);
      for (const [name, v] of Object.entries(liveTables[key] || {})) {
        if (!(name in ref)) continue; // GLSL / mutable / runtime bindings are not exported data
        const r = ref[name];
        if (r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).length && Object.values(r).every((u) => u && typeof u === 'object' && !Array.isArray(u) && Object.keys(u).join() === 'value')) {
          tables.skippedUniforms.push(`${key}.${name}`); // shader uniform objects: exported values are the defaults, the live ones are animated
          continue;
        }
        tables.compared++;
        const c = cmpTree(ref[name], v);
        if (c.diff.length) tables.mismatched.push(`${key}.${name}: ${c.diff.slice(0, 3).join(', ')}`);
        else if (c.ulp) { tables.ulpOnly++; tables.ulpNames.push(`${key}.${name} (${c.ulp} values)`); tables.maxUlp = Math.max(tables.maxUlp, c.maxUlp); } else tables.exact++;
      }
    }

    // b) vector inputs re-run in the page
    const rng = vec('math/rng'), noise = vec('math/noise'), fields = vec('look/fields'), scoring = vec('mission/scoring');
    const wb = Object.fromEntries(['calm', 'storm', 'fog'].map((p) => [p, vec(`ocean/wavebank_${p}`)]));
    const got = await page.evaluate(async ({ rng, noise, fields, wb, medalCases }) => {
      const M = await import('/rescue/src/core/math.js');
      const { Look } = await import('/rescue/src/core/look.js');
      const W = await import('/rescue/src/systems/ocean/waves.js');
      const S = await import('/rescue/src/systems/mission/scoring.js');
      const r = {};
      r.rng = rng.sequences.map(({ seed }) => { const g = M.createRng(seed); return Array.from({ length: 256 }, () => g.next()); });
      const axis = noise.grid.axis;
      r.noise = noise.simplex.map(({ seed }) => { const n = M.createNoise2D(seed); const v = []; for (const y of axis) for (const x of axis) v.push(n(x, y)); return v; });
      const L = new Look(7);
      const fa = fields.grid.axis;
      r.wind = fields.wind.map(({ windOffset }) => { L.uniforms.uWindOffset.value.set(windOffset[0], windOffset[1]); const g = [], c = []; for (const z of fa) for (const x of fa) { g.push(L.gustField(x, z)); c.push(L.cloudAt(x, z)); } return { g, c }; });
      r.fronts = fields.fronts.map(({ fronts }) => { L.setFronts(fronts); const v = []; for (const z of fa) for (const x of fa) v.push(L.frontsAt(x, z)); return v; });
      r.wave = {};
      for (const [p, d] of Object.entries(wb)) {
        const s = d.setup;
        const b = new W.WaveBank();
        b.setQuality(s.quality.waves, s.quality.gridN);
        b.setSeed(s.seed, s.baseAngle);
        r.wave[p] = d.cases.map((cs) => {
          b.update(0, cs.t, s.sea, s.windAngle, s.shortScale, cs.focus[0], cs.focus[1]);
          const h = [];
          for (const dz of d.grids.near) for (const dx of d.grids.near) h.push(b.heightAt(cs.focus[0] + dx, cs.focus[1] + dz, 0));
          return h;
        });
      }
      r.medals = medalCases.map(([success, ratio, time, par, styles, damage]) => { const m = S.medalsFor({ success, ratio, time, par, styles, damage }); return [m.bronze, m.silver, m.gold, m.cross, m.rings]; });
      return r;
    }, { rng, noise, fields, wb, medalCases: scoring.medalsFor.cases.map((c) => c.slice(0, 6)) });
    const vectors = [];
    vectors.push(cmpArrays('math/rng sequences', rng.sequences.flatMap((s) => s.next), got.rng.flat()));
    vectors.push(cmpArrays('math/noise simplex', noise.simplex.flatMap((s) => s.values), got.noise.flat()));
    vectors.push(cmpArrays('look/fields gustField', fields.wind.flatMap((w) => w.gustField), got.wind.flatMap((w) => w.g)));
    vectors.push(cmpArrays('look/fields cloudAt', fields.wind.flatMap((w) => w.cloudAt), got.wind.flatMap((w) => w.c)));
    vectors.push(cmpArrays('look/fields frontsAt', fields.fronts.flatMap((f) => f.frontsAt), got.fronts.flat()));
    for (const p of Object.keys(wb)) vectors.push(cmpArrays(`ocean/wavebank_${p} heightAt(near)`, wb[p].cases.flatMap((c) => c.near.height), got.wave[p].flat()));
    const medalRef = scoring.medalsFor.cases.map((c) => c.slice(6));
    const medalBad = medalRef.filter((m, i) => JSON.stringify(m) !== JSON.stringify(got.medals[i])).length;
    vectors.push({ name: 'mission/scoring medalsFor', n: medalRef.length, bitwise: medalRef.length - medalBad, maxUlp: medalBad ? Infinity : 0 });

    // c) live state of the running game
    const st = await page.evaluate(() => {
      const g = window.__game;
      const d = g.mission.def;
      return {
        settings: { ...g.settings.values },
        def: { id: d.id, seed: d.seed, number: d.number, par: d.par, waterTemp: d.waterTemp, timeOfDay: d.timeOfDay, survivors: JSON.stringify(d.survivors) },
        oceanWaves: g.ocean.bank.count,
        weatherPreset: g.weather.state?.preset ?? g.weather.preset ?? null,
        camera: { fov: g.camera.fov, near: g.camera.near, far: g.camera.far },
      };
    });
    const live = [];
    const settingsRef = loaded.get('Resources/Data/settings.json').data['core/settings'].DEFAULTS;
    for (const [k, v] of Object.entries(settingsRef)) {
      const expect = k === 'quality' ? 'low' : k === 'assist' ? 'standard' : v; // URL ?quality=low; autoAssist for pilot on desktop
      if (JSON.stringify(st.settings[k]) !== JSON.stringify(expect)) live.push(`settings.${k}: live ${JSON.stringify(st.settings[k])} vs exported ${JSON.stringify(expect)}`);
    }
    const prep = vec('mission/prepare').defs[0].def;
    for (const k of ['id', 'seed', 'number', 'par', 'waterTemp', 'timeOfDay']) if (JSON.stringify(prep[k]) !== JSON.stringify(st.def[k])) live.push(`mission.def.${k}: live ${JSON.stringify(st.def[k])} vs prepare.json ${JSON.stringify(prep[k])}`);
    if (JSON.stringify(JSON.parse(st.def.survivors)) !== JSON.stringify(prep.survivors)) {
      const c = cmpTree(prep.survivors, JSON.parse(st.def.survivors));
      if (c.diff.length) live.push(`mission.def.survivors differ at ${c.diff.slice(0, 3).join(', ')}`);
    }
    const q = loaded.get('Resources/Data/ocean.json').data['ocean/waves'].QUALITY.low.waves;
    if (st.oceanWaves !== q) live.push(`ocean.bank.count ${st.oceanWaves} vs QUALITY.low.waves ${q}`);
    const game = loaded.get('Resources/Data/game.json').data.derived.camera;
    if (st.camera.fov !== game.fovDeg || st.camera.near !== game.near || st.camera.far !== game.far) live.push(`camera ${JSON.stringify(st.camera)} vs game.json`);
    return { tables, vectors, live, liveState: st, errors: [...errors] };
  });

  const t = report.tables;
  console.log(`live tables: ${t.compared} exported bindings compared — ${t.exact} exact, ${t.ulpOnly} differ only by libm ulps (max ${t.maxUlp} ulp), ${t.mismatched.length} mismatched`);
  if (t.ulpNames.length) console.log(`  libm-ulp only (Chromium pow/sin vs Node): ${t.ulpNames.join(', ')}`);
  if (t.skippedUniforms.length) console.log(`  skipped live-animated uniform objects: ${t.skippedUniforms.join(', ')}`);
  for (const m of t.mismatched) problems.push('table ' + m);
  for (const v of report.vectors) {
    console.log(`live vector ${v.name}: ${v.bitwise}/${v.n} bitwise${v.maxUlp ? `, max ${v.maxUlp === Infinity ? 'MISMATCH' : v.maxUlp + ' ulp'}` : ''}`);
    if (v.maxUlp === Infinity || (/rng|noise|gust|cloud|medals/.test(v.name) && v.maxUlp)) problems.push(`vector ${v.name}: not bitwise in Chromium`);
  }
  console.log(`live state: weather ${report.liveState.weatherPreset}, ocean waves ${report.liveState.oceanWaves}, mission ${report.liveState.def.id} seed ${report.liveState.def.seed}`);
  for (const l of report.live) problems.push('live ' + l);
  console.log(`console/page errors: ${report.errors.length}`);
  for (const e of report.errors) problems.push(e);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log('verify: OK');
