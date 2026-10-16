// export-data: web game tables -> rescue-apple/Resources/Data/*.json (+ manifest.json).
//
// Every module under rescue/src is imported in Node 22 (shims/loader.mjs) and its top-level bindings are
// read through the injected __scope() — exported or not. Each output file collects whole modules:
//   data["<module key>"]["<NAME>"] = serialised live value      (module key = path under src/, no systems/, no .js)
// plus a few evaluated tables under data["derived"]. Functions are described ({fn, src}), never run;
// GLSL strings (the `/* glsl */` source tag, or the text heuristic for untagged ones), `let` (mutable
// runtime state) and scratch (_name) bindings are listed in "omitted".
// Every module must be claimed by exactly one output file (or by NO_DATA) — a new web module makes the
// exporter fail until it is assigned.
//
// Also writes Resources/Textures/{atlas,detail,lace}.rgba (Look(7) noise atlas, needed by look/fields vectors).
//
// Usage: node rescue-apple/tools/export/export-data.mjs [--out <dir>] [--textures <dir>]
import { gameImport } from './shims/loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APPLE, SRC_DIR, serialize, isGlslString, writeWrapped, relSrc, sha256, writeManifest } from './lib/common.mjs';
import { listSources, scanEvents, glslTaggedBindings } from './lib/ast.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(args.out || path.join(APPLE, 'Resources/Data'));
const PRODUCER = 'tools/export/export-data.mjs';
const TEX_OUT = path.resolve(args.textures || path.join(APPLE, 'Resources/Textures'));

// Quiet the game's own boot logs (main.js tries to create a WebGL renderer and reports it).
const realError = console.error;
console.error = () => {};
console.warn = () => {};

// --------------------------------------------------------------------------------- module -> file map
// A string claims the whole module; {m, include|exclude} claims part of it (the rest must be claimed
// elsewhere through include).
const FILES = {
  game: ['main.js'],
  settings: ['core/settings.js', 'ui/screens/settings.js'],
  input: ['core/input.js', 'core/haptics.js', 'ui/common/keys.js', 'ui/common/nav.js', 'ui/flight/touch.js', 'ui/screens/controls.js', 'ui/flight/panels.js'],
  look: ['core/look.js', 'core/weathering.js', 'core/math.js'],
  ocean: ['systems/ocean.js', 'systems/ocean/waves.js', 'systems/ocean/features.js', 'systems/ocean/memory.js', 'systems/ocean/coast.js', 'systems/ocean/grid.js', 'systems/ocean/material.js', 'systems/ocean/shaders.js', 'systems/ocean/selftest.js'],
  weather: ['systems/weather.js', 'systems/weather/presets.js', 'systems/weather/gusts.js', 'systems/weather/lightning.js', 'systems/weather/lights.js', 'systems/weather/env.js', 'systems/weather/endless.js'],
  palette: ['systems/weather/palette.js'],
  post: ['systems/post.js', 'systems/post/drops.js', 'systems/post/thermal.js', 'systems/post/photo.js', 'systems/post/finalShader.js'],
  world: ['systems/world.js', ...['boats', 'contact', 'decals', 'floaters', 'geo', 'lamps', 'landforms', 'lighthouse', 'materials', 'rig', 'rigging', 'ship', 'terrain', 'terrainMaterial', 'vegetation', 'vessel'].map((n) => `systems/world/${n}.js`)],
  hazards: ['systems/hazards.js', ...['cells', 'charges', 'common', 'curtains', 'debris', 'rogue', 'spout', 'vortexfx', 'waterrings', 'whirlpool'].map((n) => `systems/hazards/${n}.js`), 'systems/mission/checkpoint.js'],
  fx: ['systems/fx.js', ...['common', 'gusts', 'life', 'lightning', 'lightpool', 'particles', 'rain', 'signals', 'sky'].map((n) => `systems/fx/${n}.js`)],
  heli: ['systems/heli.js', ...['crewman', 'decals', 'flight', 'lights', 'materials', 'model', 'ops', 'searchlight', 'shapes', 'winch'].map((n) => `systems/heli/${n}.js`)],
  camera: ['systems/camera.js', 'systems/camera/freecam.js', 'systems/camera/shake.js'],
  survivors: ['systems/survivors.js', ...['carriers', 'craft', 'crowd', 'geo', 'heat', 'poses', 'signals', 'tables', 'water'].map((n) => `systems/survivors/${n}.js`), { m: 'systems/survivors/bottle.js', exclude: ['NOTES'] }],
  names_ru: ['systems/mission/manifest.js', 'systems/survivors/people.js', { m: 'systems/survivors/bottle.js', include: ['NOTES'] }],
  campaign: ['systems/mission/campaign.js'],
  mission: ['systems/mission.js', ...['endless', 'ledger', 'objectives', 'onboarding', 'prepare', 'progress', 'report', 'scoring'].map((n) => `systems/mission/${n}.js`)],
  text_ru: ['systems/mission/text.js', 'systems/radio/words.js', 'ui/common/fmt.js'],
  radio: ['systems/radio.js', 'systems/radio/catalogue.js', 'systems/radio/triggers.js', 'ui/flight/subtitles.js'],
  audio: ['systems/audio.js', ...['alarms', 'dsp', 'environment', 'extras', 'graph', 'music', 'rotor', 'sfx', 'voice', 'winch'].map((n) => `systems/audio/${n}.js`)],
  hud: ['systems/hud.js', ...['flight', 'hints', 'map', 'model', 'overlay', 'radar', 'toasts', 'warnings', 'winch'].map((n) => `ui/flight/${n}.js`),
    ...['palette', 'chart', 'fonts', 'transition', 'typewriter', 'dom'].map((n) => `ui/common/${n}.js`),
    ...['boot', 'briefing', 'confirm', 'debrief', 'note', 'operations', 'pause', 'screen', 'title'].map((n) => `ui/screens/${n}.js`)],
  icons: ['ui/common/icons.js'],
};
// Modules with no tables at all (pure code); still listed so the coverage check stays exhaustive.
const NO_DATA = ['core/events.js', 'core/stubs.js', 'core/warmup.js'];

const SCHEMA_VERSION = 1;

const moduleKey = (rel) => rel.replace(/^systems\//, '').replace(/\.js$/, '');

// ------------------------------------------------------------------------------- top-level kinds (AST)
const req = createRequire(import.meta.url);
let acorn = null;
for (const c of ['acorn', '/opt/node-tools/node_modules/acorn', '/opt/node22/lib/node_modules/acorn']) { try { acorn = req(c); break; } catch {} }
function declKinds(rel) {
  const src = fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
  const kinds = new Map();
  if (!acorn) return kinds;
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = (p, out) => {
    if (!p) return;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => names(q.type === 'RestElement' ? q.argument : q.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => names(q, out));
    else if (p.type === 'AssignmentPattern') names(p.left, out);
  };
  for (let n of ast.body) {
    const exported = n.type === 'ExportNamedDeclaration' && !!n.declaration;
    if (exported) n = n.declaration;
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) { const o = []; names(d.id, o); for (const x of o) kinds.set(x, { kind: n.kind, exported }); }
  }
  return kinds;
}

// ------------------------------------------------------------------------------------ scope -> data
async function moduleData(rel, { include, exclude } = {}) {
  const mod = await gameImport(rel);
  const scope = mod.__scope();
  const kinds = declKinds(rel);
  const glslTagged = glslTaggedBindings(rel); // `/* glsl */` template literals: shader code, never data
  const data = {};
  const omitted = { glsl: [], mutable: [], scratch: [], three: [], runtime: [] };
  for (const name of Object.keys(scope)) {
    if (include && !include.includes(name)) continue;
    if (exclude && exclude.includes(name)) continue;
    const v = scope[name];
    if (typeof v === 'function') continue; // code, not data
    if (name.startsWith('_')) { omitted.scratch.push(name); continue; }
    const k = kinds.get(name);
    if (k && k.kind !== 'const') { omitted.mutable.push(name); continue; }
    if ((typeof v === 'string' && glslTagged.has(name)) || isGlslString(v)) { omitted.glsl.push(name); continue; }
    if (v && typeof v === 'object' && (v.isObject3D || v.isMaterial || v.isTexture || v.isBufferGeometry)) { omitted.three.push(name); continue; }
    if (v instanceof Map && /cache/i.test(name)) { omitted.runtime.push(name); continue; }
    if (v === null || v === undefined) { omitted.runtime.push(name); continue; }
    data[name] = serialize(v);
  }
  for (const k of Object.keys(omitted)) if (!omitted[k].length) delete omitted[k];
  return { data, omitted };
}

// ------------------------------------------------------------------------------------ derived tables
function must(re, src, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`export-data: could not find ${what} in main.js — update the exporter`);
  return m;
}

function seedSites() {
  // Every seeded RNG / noise construction in the web code, with its seed expression (porting checklist).
  if (!acorn) return [];
  const out = [];
  for (const rel of listSources()) {
    const src = fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const visit = (n) => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression') {
        const c = n.callee;
        const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
        if (['createRng', 'rng32', 'createNoise2D', 'setSeed', 'mulberry32', 'makeRng'].includes(name) && n.arguments.length) {
          out.push({ file: relSrc(rel), line: n.loc.start.line, call: name, seed: src.slice(n.arguments[0].start, n.arguments[0].end).replace(/\s+/g, ' ') });
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v.type === 'string') visit(v);
      }
    };
    visit(ast);
  }
  return out;
}

async function derivedGame() {
  const src = fs.readFileSync(path.join(SRC_DIR, 'main.js'), 'utf8');
  const { __scope } = await gameImport('main.js');
  const s = __scope();
  const cam = must(/new THREE\.PerspectiveCamera\(([\d.]+),[^,]+,\s*([\d.]+),\s*([\d.]+)\)/, src, 'camera');
  const pos = must(/camera\.position\.set\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/, src, 'camera position');
  const look = must(/camera\.lookAt\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/, src, 'camera lookAt');
  const cap = must(/Math\.min\(\(now - last\) \/ 1000,\s*([\d.]+)\)/, src, 'dt cap');
  const rng = must(/rng:\s*createRng\((\d+)\)/, src, 'ctx.rng seed');
  const noise = must(/noise:\s*createNoise2D\((\d+)\)/, src, 'ctx.noise seed');
  const modes = must(/mode:\s*'(\w+)',\s*\/\/\s*([^\n]+)/, src, 'modes');
  const px = must(/Math\.max\(1,\s*Math\.sqrt\(\((\d+)\s*\*\s*(\d+)\)/, src, 'pixel budget');
  return {
    systems: s.SYSTEMS.map(([key, module, exportName]) => ({ key, module: module.replace('./', 'rescue/src/'), export: exportName })),
    runWhenPaused: [...s.RUN_WHEN_PAUSED],
    loop: {
      dtCap: Number(cap[1]),
      rule: 'realDt = min(frameDelta, dtCap); dt = paused ? 0 : realDt * timeScale; systems in RUN_WHEN_PAUSED get realDt, others dt; time.t is advanced by mission/systems, time.realT += realDt, frame++',
    },
    ctx: { rngSeed: Number(rng[1]), noiseSeed: Number(noise[1]), initialMode: modes[1], modes: modes[2].split('|').map((x) => x.trim().replace(/'/g, '')), timeScale: 1 },
    camera: { fovDeg: Number(cam[1]), near: Number(cam[2]), far: Number(cam[3]), position: pos.slice(1).map(Number), lookAt: look.slice(1).map(Number) },
    pixelRatio: { rule: 'min(devicePixelRatio, settings.pixelRatioCap(), max(1, sqrt(budgetW*budgetH / (innerWidth*innerHeight))))', budgetW: Number(px[1]), budgetH: Number(px[2]) },
    seedSites: seedSites(),
  };
}

async function derivedSettings() {
  const { Settings } = await gameImport('core/settings.js');
  const DIFFS = Object.keys((await gameImport('systems/mission/scoring.js')).DIFFICULTY);
  const st = new Settings();
  const tiers = {};
  for (const q of ['low', 'medium', 'high']) { st.values.quality = q; tiers[q] = { pixelRatioCap: st.pixelRatioCap(), detail: st.detail() }; }
  const assist = {};
  for (const d of DIFFS) { st.values.difficulty = d; assist[d] = st.autoAssist(); }
  return {
    qualityTiers: tiers,
    autoAssist: { rule: "difficulty === 'cadet' || coarse pointer (touch) ? 'full' : 'standard' — only while assistExplicit is false", nonTouch: assist },
    migrations: [{ key: 'assistExplicit', rule: "saved settings without assistExplicit: true when saved.assist exists and !== 'standard'" }],
    firstRun: [
      { when: 'no saved settings && prefers-reduced-motion: reduce', set: 'reduceMotion-related defaults (see core/settings.js constructor)' },
      { when: 'no saved settings && pointer: coarse', set: { quality: 'low' } },
      { when: 'URL ?quality=low|medium|high', set: 'quality' },
    ],
  };
}

async function derivedLook() {
  const { Look } = await gameImport('core/look.js');
  const look = new Look(7);
  const uniforms = {};
  for (const [k, u] of Object.entries(look.uniforms)) {
    const v = u.value;
    if (v && v.isTexture) continue;
    if (k === 'uResolution') continue; // window-dependent
    uniforms[k] = serialize(v);
  }
  const textures = {};
  for (const name of ['atlas', 'detail', 'lace']) {
    const t = look[name];
    if (!t || !t.image) continue;
    const d = t.image.data;
    const buf = Buffer.from(d.buffer, d.byteOffset, d.byteLength);
    // raw RGBA8 row-major, row 0 = v 0 (the DataTexture array as uploaded with flipY = false and read by sampleBuf)
    fs.mkdirSync(TEX_OUT, { recursive: true });
    fs.writeFileSync(path.join(TEX_OUT, `${name}.rgba`), buf);
    textures[name] = {
      file: `Resources/Textures/${name}.rgba`, width: t.image.width, height: t.image.height, channels: d.length / (t.image.width * t.image.height),
      dtype: d.constructor.name, wrap: [t.wrapS, t.wrapT], sha256: sha256(buf),
    };
  }
  return { lookSeed: 7, uniformDefaults: uniforms, textures };
}

async function derivedEvents() {
  const ev = scanEvents();
  const contract = fs.readFileSync(path.join(SRC_DIR, 'CONTRACT.md'), 'utf8');
  const listed = new Set([...contract.matchAll(/`([a-z]+:[a-z0-9-]+)`/g)].map((m) => m[1]));
  const names = [...new Set([...ev.keys(), ...listed])].sort();
  return names.map((name) => {
    const e = ev.get(name) || { emitters: new Set(), listeners: new Set(), indirect: new Set(), payloadKeys: new Set(), payloadRefs: new Set(), bare: false };
    return {
      name,
      inContract: listed.has(name),
      emitters: [...e.emitters].sort().map(relSrc),
      listeners: [...e.listeners].sort().map(relSrc),
      indirect: [...e.indirect].sort().map(relSrc),
      payloadKeys: [...e.payloadKeys].sort(),
      payloadRefs: [...e.payloadRefs].sort(),
      bareEmit: e.bare,
    };
  });
}

// ------------------------------------------------------------------------------------------- main
async function main() {
  const all = listSources();
  // coverage: each module claimed exactly once (partial claims must partition the module)
  const claims = new Map();
  for (const [file, mods] of Object.entries(FILES)) for (const m of mods) {
    const rel = typeof m === 'string' ? m : m.m;
    if (!all.includes(rel)) throw new Error(`export-data: ${file} claims missing module ${rel}`);
    if (!claims.has(rel)) claims.set(rel, []);
    claims.get(rel).push({ file, part: typeof m === 'string' ? null : m });
  }
  for (const rel of NO_DATA) claims.set(rel, [{ file: null }]);
  const unclaimed = all.filter((r) => !claims.has(r));
  if (unclaimed.length) throw new Error('export-data: modules not assigned to any data file: ' + unclaimed.join(', '));
  for (const [rel, c] of claims) if (c.length > 1 && c.some((x) => !x.part)) throw new Error(`export-data: ${rel} claimed whole by more than one file`);

  const results = [];
  for (const [file, mods] of Object.entries(FILES)) {
    const data = {};
    const omitted = {};
    const files = [];
    for (const m of mods) {
      const rel = typeof m === 'string' ? m : m.m;
      const r = await moduleData(rel, typeof m === 'string' ? {} : m);
      const key = moduleKey(rel);
      data[key] = r.data;
      if (Object.keys(r.omitted).length) omitted[key] = r.omitted;
      files.push(relSrc(rel));
    }
    let derived = null;
    if (file === 'game') { derived = await derivedGame(); files.push(relSrc('CONTRACT.md')); }
    if (file === 'settings') derived = await derivedSettings();
    if (file === 'look') derived = await derivedLook();
    if (file === 'mission') {
      const S = await gameImport('systems/mission/scoring.js');
      const src = (f) => Function.prototype.toString.call(f);
      derived = {
        rules: {
          medalsFor: src(S.medalsFor),
          styleChain: 'chainable style within CHAIN_WINDOW s of the previous one: chain++, else chain = 0; points = round(base · min(2, 1.2^chain)); once-styles count once; chain:false styles never chain',
          final: 'max(0, round(raw · DIFFICULTY[d].mult))',
        },
      };
    }
    if (derived) data.derived = derived;
    results.push(writeWrapped(path.join(OUT, `${file}.json`), {
      schema: `mayday.${file}`, version: SCHEMA_VERSION, files, producer: PRODUCER,
      extra: Object.keys(omitted).length ? { omitted } : {}, data,
    }));
  }

  // events.json: static scan of emit/on sites + CONTRACT.md list
  const events = await derivedEvents();
  results.push(writeWrapped(path.join(OUT, 'events.json'), {
    schema: 'mayday.events', version: SCHEMA_VERSION, files: ['rescue/src/**/*.js (emit/on call sites)', 'rescue/src/CONTRACT.md'], producer: PRODUCER,
    extra: { note: 'payloadKeys = keys of object literals passed to emit() (static scan); payloadRefs = non-literal payload expressions; indirect = event name passed to a non-emit helper (file:function); inContract = named in CONTRACT.md' },
    data: { events },
  }));

  // manifest.json: every Resources/Data/*.json and Resources/Textures/* (incl. export-render's
  // dfg_lut.rg16f) with size + sha256
  const { entries, git: g } = writeManifest({ dataDir: OUT, texDir: TEX_OUT });

  for (const r of results) console.log(`${r.path}\t${r.bytes}`);
  console.log(`manifest: ${entries.length} files, web ${g.rev.slice(0, 12)}${g.dirty ? ' (dirty)' : ''}`);
}

main().catch((e) => { realError(e); process.exit(1); });
