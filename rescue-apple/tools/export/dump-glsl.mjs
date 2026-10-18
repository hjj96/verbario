// dump-glsl: the fully assembled GLSL of every WebGL program the web game compiles (PLAN §3.1 rule 7, §3.5).
//
// The MSL ports are checked against what Chromium actually compiles — three's prefix (defines, built-in
// uniforms / attributes), every #include resolved, loops unrolled, the onBeforeCompile patches applied —
// not against the scattered sources and regex patches. For each configuration (quality × mission) the game
// boots in headless Chromium at 480 × 270 (lib/browser.mjs: SwiftShader WebGL2; the machine-wide lock is
// taken per configuration) on a frozen clock (every frame advances exactly 1/60 s, Math.random =
// mulberry32(20261016), as in render-goldens.mjs), runs until its shader warm-up is idle (main.js:
// compileAsync of the scene with hidden objects shown) and then SETTLE more frames; every program in
// renderer.info.programs is read back with gl.getShaderSource.
//
// Output (<out>, default rescue-apple/Reference):
//   glsl/<slug>-<id>.vert, glsl/<slug>-<id>.frag   the exact sources given to the GL (two files per program)
//   programs.json                                  one entry per program, deduplicated across configurations:
//     id         first 12 hex digits of sha256(three's program cache key) — stable across runs
//     type, name the material type / name three keys the program by (WebGLProgram.type / .name)
//     users      the objects / materials holding the program at capture time ("object:material", ≤ 12)
//     defines    the material's own `defines` (ShaderMaterial / onBeforeCompile families)
//     prefix     three's generated `#define` lines (variant switches: USE_SHADOWMAP, NUM_DIR_LIGHTS, …)
//     seenIn     the configurations where it was compiled ("<mission>/<quality>")
//     lines      line counts of the two stages
//
// Usage: node rescue-apple/tools/export/dump-glsl.mjs [--qualities low,medium,high] [--missions title,0,1,…]
//                                                     [--settle 120] [--out <dir>]
// Missions default to the title screen plus every campaign operation (?mission=N&autostart); ?nohud and
// ?stub=audio throughout. Deterministic for a given web revision (same programs, same files).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APPLE, writeWrapped, relSrc } from './lib/common.mjs';
import { withBrowser } from './lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Reference'));
const QUALITIES = String(args.qualities || 'low,medium,high').split(',');
const SETTLE = Number(args.settle || 120);
const PRODUCER = 'tools/export/dump-glsl.mjs';

// The frozen clock (page init script, before any game module runs) — the same as render-goldens.mjs.
function CLOCK_INIT() {
  let now = 0;
  const q = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__clock = {
    step(n, dt) { for (let i = 0; i < n; i++) { now += dt * 1000; const cbs = q.splice(0); for (const cb of cbs) cb(now); } return now; },
    pending: () => q.length,
  };
  let a = 20261016;
  Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// In the page: programs not returned before (by object identity), with their sources and current users.
function COLLECT() {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  const seen = (window.__dumpSeen ||= new WeakSet());
  const users = new Map();
  const note = (mat, who) => {
    if (!mat) return;
    const props = r.properties.get(mat);
    if (!props || !props.programs) return;
    for (const prog of props.programs.values()) {
      if (!users.has(prog)) users.set(prog, { labels: new Set(), defines: null });
      const u = users.get(prog);
      u.labels.add(`${who}:${mat.name || mat.type}`);
      if (!u.defines && mat.defines && Object.keys(mat.defines).length) u.defines = { ...mat.defines };
    }
  };
  g.scene.traverse((o) => {
    const who = o.name || o.type;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) note(m, who);
    note(o.customDepthMaterial, who + '/depth');
    note(o.customDistanceMaterial, who + '/distance');
  });
  const out = [];
  for (const p of r.info.programs || []) {
    if (seen.has(p)) continue;
    seen.add(p);
    const u = users.get(p);
    out.push({
      key: p.cacheKey, type: p.type, name: p.name,
      vert: gl.getShaderSource(p.vertexShader), frag: gl.getShaderSource(p.fragmentShader),
      users: u ? [...u.labels].sort() : [], defines: u ? u.defines : null,
    });
  }
  return out;
}

/** three's generated `#define` lines of a stage: the block that opens with `#define HIGH_PRECISION` /
 *  `SHADER_TYPE` after the GLSL3 compatibility header and the precision block, up to the first declaration,
 *  plus the switches the fragment prefix emits after its built-in uniforms (TONE_MAPPING, DITHERING,
 *  OPAQUE, DEPTH_PACKING). RawShaderMaterial programs without a prefix give []. */
const LATE_SWITCH = /^#define (TONE_MAPPING|DITHERING|OPAQUE|DEPTH_PACKING \d+)$/;
function prefixDefines(src) {
  const lines = src.split('\n').map((l) => l.trim());
  let s = lines.findIndex((t) => t.startsWith('#define SHADER_TYPE'));
  if (s < 0) return [];
  while (s > 0 && lines[s - 1].startsWith('#define ')) s--;
  const out = [];
  let i = s;
  for (; i < lines.length; i++) {
    const t = lines[i];
    if (t === '') continue;
    if (!t.startsWith('#')) break;
    if (t.startsWith('#define ')) out.push(t.slice(8));
  }
  for (; i < lines.length; i++) if (LATE_SWITCH.test(lines[i])) out.push(lines[i].slice(8));
  return out;
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'program';

async function dumpConfig(page, base, mission, quality) {
  const q = ['nohud', 'stub=audio', `quality=${quality}`, ...(mission === 'title' ? [] : [`mission=${mission}`, 'autostart'])].join('&');
  await page.goto(`${base}/rescue/index.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.__clock.pending() > 0, null, { timeout: 180000, polling: 200 });
  const found = [];
  // the warm-up compiles on real timers (compileAsync polling): step frames until it is idle
  let idle = false;
  for (let k = 0; k < 600 && !idle; k++) {
    idle = (await page.evaluate(() => { window.__clock.step(1, 1 / 60); return window.__game.warmup; })) === 'idle';
    found.push(...(await page.evaluate(COLLECT)));
    if (!idle) await page.waitForTimeout(150);
  }
  if (!idle) throw new Error(`${mission}/${quality}: shader warm-up never went idle`);
  for (let k = 0; k < SETTLE; k += 30) {
    await page.evaluate(() => window.__clock.step(30, 1 / 60));
    found.push(...(await page.evaluate(COLLECT)));
  }
  const list = await page.evaluate(() => window.__game.mission?.list?.length ?? 0);
  return { found, missions: list };
}

// One browser (and one hold of the machine-wide Chromium lock) per configuration: a title boot compiles
// ~150 programs on SwiftShader in ~7 min, and other exporters waiting for the lock give up after 12 min.
process.setMaxListeners(64);   // withBrowser adds one 'exit' listener (lock release) per call
async function inBrowser(mission, quality) {
  let r = null;
  const errs = await withBrowser(async ({ page, base, errors }) => {
    await page.addInitScript(CLOCK_INIT);
    r = await dumpConfig(page, base, mission, quality);
    return errors;
  }, { width: 480, height: 270 });
  if (errs.length) throw new Error(`${mission}/${quality}: browser errors:\n  ` + errs.join('\n  '));
  return r;
}

const programs = new Map();   // id → entry
const configs = [];
let missions = args.missions ? String(args.missions).split(',') : null;
for (const quality of QUALITIES) {
  for (let i = 0; i < (missions ? missions.length : 1); i++) {
    const mission = missions ? missions[i] : 'title';
    const t0 = Date.now();
    const r = await inBrowser(mission, quality);
    // default mission list: the title screen, then every campaign operation the game knows
    if (!missions) missions = ['title', ...Array.from({ length: r.missions }, (_, k) => String(k))];
    const where = `${mission}/${quality}`;
    let fresh = 0;
    for (const p of r.found) {
      const id = createHash('sha256').update(p.key).digest('hex').slice(0, 12);
      let e = programs.get(id);
      if (!e) {
        fresh++;
        const label = slug(p.name || (p.users[0] ? p.users[0].split(':').reverse().join('_') : '') || p.type);
        e = {
          id, type: p.type, name: p.name, users: [], defines: p.defines,
          prefix: { vert: prefixDefines(p.vert), frag: prefixDefines(p.frag) },
          files: { vert: `glsl/${label}-${id}.vert`, frag: `glsl/${label}-${id}.frag` },
          lines: { vert: p.vert.split('\n').length, frag: p.frag.split('\n').length },
          seenIn: [], src: { vert: p.vert, frag: p.frag },
        };
        programs.set(id, e);
      }
      for (const u of p.users) if (!e.users.includes(u) && e.users.length < 12) e.users.push(u);
      if (!e.defines && p.defines) e.defines = p.defines;
      if (!e.seenIn.includes(where)) e.seenIn.push(where);
    }
    configs.push({ mission, quality, programs: r.found.length });
    console.log(`${where}: ${r.found.length} programs (${fresh} new), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

// write: sources first (exact text), then the index, sorted by id for a stable diff
fs.rmSync(path.join(OUT, 'glsl'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'glsl'), { recursive: true });
const entries = [...programs.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (const e of entries) {
  fs.writeFileSync(path.join(OUT, e.files.vert), e.src.vert);
  fs.writeFileSync(path.join(OUT, e.files.frag), e.src.frag);
  e.users.sort();
  delete e.src;
}
const r = writeWrapped(path.join(OUT, 'programs.json'), {
  schema: 'mayday.reference.programs', version: 1, producer: PRODUCER,
  files: [relSrc('main.js'), relSrc('core/warmup.js'), 'rescue/vendor/three (WebGLProgram r185)'],
  data: {
    note: 'every program in renderer.info.programs after the shader warm-up (+ settle frames) of each configuration; id = sha256(cacheKey)[0..12]',
    configs, programs: entries,
  },
});
console.log(`${entries.length} programs → ${path.relative(APPLE, OUT) || OUT}/glsl, ${r.path} (${r.bytes} bytes)`);
