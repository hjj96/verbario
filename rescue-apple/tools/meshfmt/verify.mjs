// Verifier for the baked meshes (tools/meshfmt/SPEC.md).
//
//   node rescue-apple/tools/meshfmt/verify.mjs                 structure of every Resources/Meshes/*.mmesh,
//                                                              manifest listing (bytes, sha256, schema, version)
//   node rescue-apple/tools/meshfmt/verify.mjs --web           + rebuild the meshes from the live web code
//                                                              (tools/export/bake-meshes.mjs heliMeshes) and
//                                                              compare: every attribute per triangle corner
//                                                              bit-identical to three's geometry, same index
//                                                              (indexed sources), same meta, same bytes
//   node rescue-apple/tools/meshfmt/verify.mjs --selftest      encoder ⇄ decoder round trips (dedup, quantised
//                                                              formats, alignment, rejection of broken files)
//   node rescue-apple/tools/meshfmt/verify.mjs --summary <f>   writes the per-file summary that
//                                                              tools/meshfmt/check-loader.sh compares with the
//                                                              Swift parser (MMeshFile.swift)
//   [--dir <meshes dir>]                                       default rescue-apple/Resources/Meshes
// Exit status 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeMMesh, expandTriangles, fromHalf } from './read.mjs';
import { encodeMMesh, toHalf, FORMAT } from './write.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APPLE = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const DIR = path.resolve(opt('--dir') || path.join(APPLE, 'Resources/Meshes'));
const problems = [];
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// FNV-1a 32 over bytes (the Swift check computes the same).
export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const bytesOf = (t) => new Uint8Array(t.buffer, t.byteOffset, t.byteLength);

// ------------------------------------------------------------------------------------------- self test
function selftest() {
  const fail = (m) => problems.push(`selftest: ${m}`);
  // two triangles sharing an edge, non-indexed → 4 vertices after dedup, triangle order kept
  const P = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const N = new Float32Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
  const C = new Float32Array([0.25, 0.5, 0.75, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0.1, 0.2, 0.3, 0, 1, 0]);
  const e = encodeMMesh({ attributes: [{ name: 'position', array: P, components: 3 }, { name: 'normal', array: N, components: 3 }, { name: 'color', array: C, components: 3 }], meta: { t: 1 } });
  const m = decodeMMesh(e.buffer);
  if (m.vertexCount !== 4 || m.indexCount !== 6) fail(`dedup gave ${m.vertexCount} vertices / ${m.indexCount} indices`);
  if (Buffer.compare(Buffer.from(bytesOf(expandTriangles(m, 'position'))), Buffer.from(bytesOf(P)))) fail('dedup changed the triangle soup');
  if (Buffer.compare(Buffer.from(bytesOf(expandTriangles(m, 'color'))), Buffer.from(bytesOf(C)))) fail('dedup changed colours');
  if (e.buffer.length % 16 || m.dataOffset % 16 || m.indexOffset % 16) fail('alignment');
  if (m.meta.t !== 1) fail('meta');
  // a vertex differing only in one attribute must not merge
  const C2 = C.slice();
  C2[9] = 0.5;
  if (decodeMMesh(encodeMMesh({ attributes: [{ name: 'position', array: P, components: 3 }, { name: 'color', array: C2, components: 3 }] }).buffer).vertexCount !== 5) fail('dedup merged distinct vertices');
  // quantised formats decode within their step
  const Q = new Float32Array([-1, -0.5, 0, 0.5, 1, 0.333, -0.777, 0.123, 1, 0, 0.25, 0.75, 0.2, 0.4, 0.6, 0.8, 0.9, 0.1]);
  for (const [fmt, tol] of [['f16', 1e-3], ['snorm16', 1 / 32767], ['unorm8', 1 / 255]]) {
    const src = fmt === 'unorm8' ? Q.map((v) => Math.abs(v)) : Q;
    const enc = encodeMMesh({ attributes: [{ name: 'position', array: P, components: 3 }, { name: 'q', array: src, components: 3 }], index: [0, 1, 2, 3, 4, 5], quantize: { q: fmt } });
    const d = decodeMMesh(enc.buffer).attributes.find((a) => a.name === 'q');
    if (d.format !== FORMAT[fmt]) fail(`${fmt}: format byte`);
    for (let i = 0; i < src.length; i++) if (Math.abs(d.floats[i] - src[i]) > tol) fail(`${fmt}: ${src[i]} → ${d.floats[i]}`);
  }
  for (const v of [0, 1, -2, 65504, 1e-5, 6.1e-5, 0.1, 3.14159]) if (Math.abs(fromHalf(toHalf(v)) - v) > Math.abs(v) * 1e-3 + 1e-7) fail(`half ${v}`);
  // an indexed source keeps its vertex numbering
  const ix = encodeMMesh({ attributes: [{ name: 'position', array: P, components: 3 }], index: [5, 4, 3, 2, 1, 0] });
  const dm = decodeMMesh(ix.buffer);
  if (dm.vertexCount !== 6 || dm.index.join() !== '5,4,3,2,1,0') fail('indexed source re-numbered');
  // broken files are rejected
  const bad = (what, mutate) => {
    const b = Buffer.from(e.buffer);
    mutate(b);
    try { decodeMMesh(b); fail(`accepted ${what}`); } catch {}
  };
  bad('a bad magic', (b) => b.write('XXXX', 0));
  bad('version 2', (b) => b.writeUInt16LE(2, 4));
  bad('a truncated file', (b) => b.writeUInt32LE(b.length + 16, 28));
  bad('an index out of range', (b) => b.writeUInt32LE(99, m.indexOffset));
  bad('a misaligned stream', (b) => b.writeUInt32LE(m.attributes[1].offset + 4, 80 + 32 + 20));
  bad('a bad range', (b) => b.writeUInt32LE(9, 80 + 32 * 3 + 20));
  console.log(`selftest: ${problems.length ? 'FAIL' : 'ok'}`);
}

// --------------------------------------------------------------------------------------------- files
function files() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.mmesh')).sort();
}

function checkFiles() {
  const decoded = new Map();
  for (const f of files()) {
    const buf = fs.readFileSync(path.join(DIR, f));
    try {
      const m = decodeMMesh(buf);
      if (m.meta?.name !== path.basename(f, '.mmesh')) problems.push(`${f}: meta.name is ${m.meta?.name}`);
      if (!Array.isArray(m.meta?.chains) || !m.meta.chains.length) problems.push(`${f}: meta.chains missing`);
      decoded.set(f, { m, buf });
    } catch (e) {
      problems.push(`${f}: ${e.message}`);
    }
  }
  // manifest: every file listed with its bytes / sha256 (lib/common.mjs writeManifest)
  if (DIR === path.join(APPLE, 'Resources/Meshes')) {
    const mf = path.join(APPLE, 'Resources/Data/manifest.json');
    const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { files: [] };
    const byPath = new Map(manifest.files.map((e) => [e.path, e]));
    for (const [f, { buf }] of decoded) {
      const e = byPath.get(`Resources/Meshes/${f}`);
      if (!e) { problems.push(`manifest: Resources/Meshes/${f} not listed (re-run bake-meshes.mjs)`); continue; }
      if (e.bytes !== buf.length || e.sha256 !== sha256(buf)) problems.push(`manifest: Resources/Meshes/${f} bytes / sha256 differ (re-run bake-meshes.mjs)`);
      if (e.schema !== 'mayday.mmesh' || e.version !== 1) problems.push(`manifest: Resources/Meshes/${f} schema ${e.schema} version ${e.version}`);
    }
    for (const e of manifest.files) if (e.path.startsWith('Resources/Meshes/') && !decoded.has(path.basename(e.path))) problems.push(`manifest: ${e.path} listed but missing`);
  }
  console.log(`files: ${decoded.size} .mmesh in ${path.relative(process.cwd(), DIR) || DIR}`);
  return decoded;
}

// ------------------------------------------------------------------------------------- live web check
async function checkWeb(decoded) {
  const { heliMeshes } = await import('../export/bake-meshes.mjs');
  const live = heliMeshes();
  const seen = new Set();
  for (const { name, objects, mesh } of live) {
    const f = `${name}.mmesh`;
    seen.add(f);
    const d = decoded.get(f);
    if (!d) { problems.push(`web: ${f} missing (re-run bake-meshes.mjs)`); continue; }
    const { m, buf } = d;
    const g = objects[0].geometry;
    // every attribute per triangle corner, bit-identical to three's view of the geometry
    for (const [aname, a] of Object.entries(g.attributes)) {
      const c = a.itemSize;
      const corners = g.index ? g.index.count : a.count;
      const web = new Float32Array(corners * c);
      for (let k = 0; k < corners; k++) {
        const v = g.index ? g.index.array[k] : k;
        for (let j = 0; j < c; j++) web[k * c + j] = a.array[v * c + j];
      }
      let file;
      try { file = expandTriangles(m, aname); } catch (e) { problems.push(`web: ${f}: ${e.message}`); continue; }
      if (!Buffer.from(bytesOf(file)).equals(Buffer.from(bytesOf(web)))) problems.push(`web: ${f}: ${aname} differs from the live geometry`);
    }
    if (m.attributes.length !== Object.keys(g.attributes).length) problems.push(`web: ${f}: attribute set differs`);
    if (g.index && m.index.join() !== Array.from(g.index.array).join()) problems.push(`web: ${f}: index differs (indexed sources keep three's numbering)`);
    if (g.index && m.vertexCount !== g.attributes.position.count) problems.push(`web: ${f}: vertex array of an indexed source changed`);
    const s = g.boundingSphere;
    const bs = [s.center.x, s.center.y, s.center.z, s.radius].map(Math.fround);
    if (bs.some((v, i) => v !== m.bounds.sphere[i])) problems.push(`web: ${f}: bounding sphere differs`);
    // meta: identical except the web revision stamp
    const strip = (x) => JSON.stringify({ ...x, source: { ...x.source, web: null, dirty: null } });
    if (strip(mesh.meta) !== strip(m.meta)) problems.push(`web: ${f}: meta differs from a fresh bake`);
    // byte determinism (holds when the web revision is the baked one)
    const fresh = encodeMMesh(mesh).buffer;
    if (mesh.meta.source.web === m.meta.source.web && !fresh.equals(buf)) problems.push(`web: ${f}: a fresh bake is not byte-identical`);
  }
  for (const f of decoded.keys()) if (f.startsWith('heli_') && !seen.has(f)) problems.push(`web: ${f} is not produced by the bake (stale)`);
  console.log(`web: ${live.length} meshes rebuilt from rescue/src and compared`);
}

// ---------------------------------------------------------------------------------------- summary
function summary(decoded, out) {
  const files = {};
  for (const [f, { m, buf }] of decoded) {
    files[f] = {
      vertexCount: m.vertexCount, indexCount: m.indexCount, indexed: m.indexed, metaLength: m.metaLength,
      metaFnv: fnv1a(buf.subarray(80 + 32 * m.attributes.length + 24 * m.ranges.length, 80 + 32 * m.attributes.length + 24 * m.ranges.length + m.metaLength)),
      bounds: [...m.bounds.sphere, ...m.bounds.box],
      ranges: m.ranges,
      attributes: m.attributes.map((a) => ({
        name: a.name, format: a.format, components: a.components, offset: a.offset, fnv: fnv1a(bytesOf(a.raw)),
        first: Array.from(a.floats.subarray(0, a.components)), last: Array.from(a.floats.subarray(a.floats.length - a.components)),
      })),
      indexFnv: m.index ? fnv1a(bytesOf(m.index)) : 0,
      name: m.meta.name,
      chains: m.meta.chains.length,
    };
  }
  fs.writeFileSync(out, JSON.stringify({ schema: 'mayday.meshfmt.summary', version: 1, files }, null, 1) + '\n');
  console.log(`summary: ${Object.keys(files).length} files → ${out}`);
}

// ------------------------------------------------------------------------------------------- main
if (argv.includes('--selftest')) selftest();
const decoded = checkFiles();
if (argv.includes('--web')) await checkWeb(decoded);
if (opt('--summary')) summary(decoded, path.resolve(opt('--summary')));
if (problems.length) {
  for (const p of problems.slice(0, 60)) console.error('  ' + p);
  console.error(`meshfmt verify: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('meshfmt verify: ok');
