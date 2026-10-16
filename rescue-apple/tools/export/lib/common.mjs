// Shared helpers for the web -> port exporters: live-value serialisation, deterministic pretty JSON,
// the file wrapper, git revision, sha256, sidecars.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url)); // verbario/
export const APPLE = path.join(REPO, 'rescue-apple');
export const SRC_DIR = path.join(REPO, 'rescue/src');

// ---------------------------------------------------------------------------------------------- git
let _git = null;
export function gitInfo() {
  if (_git) return _git;
  const sh = (c) => execSync(c, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let rev = 'unknown', dirty = false;
  try { rev = sh('git rev-parse HEAD'); } catch {}
  try { dirty = sh('git status --porcelain -- rescue').length > 0; } catch {}
  _git = { rev, dirty };
  return _git;
}

// ------------------------------------------------------------------------------------- serialisation
// Self-contained (no imports, no closures over module state) so the same code can be shipped into the
// browser page with Function.prototype.toString for live spot checks (verify.mjs).
export function makeSerializer() {
  function num(n) {
    if (Number.isNaN(n)) return 'NaN';
    if (n === Infinity) return 'Infinity';
    if (n === -Infinity) return '-Infinity';
    if (Object.is(n, -0)) return '-0';
    return n;
  }
  // Text heuristic for GLSL inside serialised values (nested strings, the live-page re-serialisation in
  // verify --browser). Top-level module bindings are classified by their `/* glsl */` source tag first
  // (lib/ast.mjs glslTaggedBindings), which also catches snippets too short for this test.
  // Matches: main / any void function, uniform / varying, vecN constructors and declarations,
  // `const in` / `inout` parameters, gl_* outputs, #include <chunk>, float-returning functions.
  const GLSL_HINT = /\b(void\s+\w+\s*\(|uniform\s|varying\s|vec[234]\s*\(|vec[234]\s+\w+\s*[=;]|const\s+in\s|inout\s|gl_FragColor|gl_Position|float\s+\w+\s*\()|#include\s*</;
  const isGlslString = (s) => typeof s === 'string' && s.length > 40 && s.includes('\n') && GLSL_HINT.test(s);
  const fnName = (f) => f.name || 'anonymous';
  // Functions are described, never executed: name, plus the source when it is a short rule (<= 400 chars).
  function describeFn(f) {
    const src = Function.prototype.toString.call(f);
    if (/^class\b/.test(src)) return { class: fnName(f) };
    const d = { fn: fnName(f) };
    if (src.length <= 400) d.src = src.replace(/\s+/g, ' ');
    else d.srcLength = src.length;
    return d;
  }
  /**
   * Serialise a live JS value to a JSON-able tree.
   *   THREE.Color -> {hex:'#rrggbb', lin:[r,g,b]} (lin = the exact working-space floats three keeps)
   *   Vector2/3/4, Quaternion -> [..]; Euler -> [x,y,z,order]; Matrix3/4 -> {m3|m4:[elements]} (column-major)
   *   Set -> array; Map -> object (or [[k,v]] when keys are not strings); RegExp -> {regexp, flags}
   *   typed arrays -> plain arrays; Intl.NumberFormat -> {intl:'NumberFormat', options}
   *   functions -> {fn:name} (described, never executed); GLSL strings -> {glsl:<length>} (see Reference/glsl)
   *   other class instances -> {instance:<constructor>, ...own enumerable data}
   */
  function serialize(v, opts = {}, stack = []) {
    const { describeFunctions = true } = opts;
    if (v === null || v === undefined) return null;
    switch (typeof v) {
      case 'number': return num(v);
      case 'string': return isGlslString(v) ? { glsl: v.length } : v.normalize('NFC');
      case 'boolean': return v;
      case 'bigint': return String(v);
      case 'symbol': return String(v);
      case 'function': return describeFunctions ? describeFn(v) : undefined;
    }
    if (stack.includes(v)) return { ref: 'cycle' };
    stack.push(v);
    try {
      if (v.isColor) return { hex: '#' + v.getHexString(), lin: [num(v.r), num(v.g), num(v.b)] };
      // GPU-side three objects are not data: geometry is rebuilt by MeshKit / baked to .mmesh.
      if (v.isBufferGeometry) return { three: 'BufferGeometry', type: v.type, vertices: v.attributes?.position?.count ?? 0, indices: v.index?.count ?? 0 };
      if (v.isMaterial) return { three: 'Material', type: v.type };
      if (v.isTexture) return { three: 'Texture', type: v.constructor?.name };
      if (v.isObject3D) return { three: 'Object3D', type: v.type };
      if (v.isVector2) return [num(v.x), num(v.y)];
      if (v.isVector3) return [num(v.x), num(v.y), num(v.z)];
      if (v.isVector4 || v.isQuaternion) return [num(v.x), num(v.y), num(v.z), num(v.w)];
      if (v.isEuler) return [num(v.x), num(v.y), num(v.z), v.order];
      if (v.isMatrix4) return { m4: Array.from(v.elements, num) };
      if (v.isMatrix3) return { m3: Array.from(v.elements, num) };
      if (Array.isArray(v)) return v.map((x) => { const s = serialize(x, opts, stack); return s === undefined ? null : s; });
      if (ArrayBuffer.isView(v)) return Array.from(v, num);
      if (v instanceof Set) return [...v].map((x) => serialize(x, opts, stack));
      if (v instanceof Map) {
        if ([...v.keys()].every((k) => typeof k === 'string')) {
          const o = {};
          for (const [k, x] of v) { const s = serialize(x, opts, stack); if (s !== undefined) o[k] = s; }
          return o;
        }
        return [...v].map(([k, x]) => [serialize(k, opts, stack), serialize(x, opts, stack)]);
      }
      if (v instanceof RegExp) return { regexp: v.source, flags: v.flags };
      if (typeof Intl !== 'undefined' && v instanceof Intl.NumberFormat) {
        const o = v.resolvedOptions();
        const keep = ['locale', 'style', 'minimumIntegerDigits', 'minimumFractionDigits', 'maximumFractionDigits', 'useGrouping', 'signDisplay', 'roundingMode'];
        const options = {};
        for (const k of keep) if (o[k] !== undefined) options[k] = o[k];
        return { intl: 'NumberFormat', options };
      }
      const proto = Object.getPrototypeOf(v);
      const plain = proto === Object.prototype || proto === null;
      const o = plain ? {} : { instance: (v.constructor && v.constructor.name) || 'object' };
      for (const k of Object.keys(v)) {
        const s = serialize(v[k], opts, stack);
        if (s !== undefined) o[k] = s;
      }
      return o;
    } finally {
      stack.pop();
    }
  }
  return { serialize, num, isGlslString };
}

const _S = makeSerializer();
/** JSON-safe number: finite numbers as-is (JS shortest round-trip), specials as strings. */
export const num = _S.num;
export const isGlslString = _S.isGlslString;
export const serialize = _S.serialize;

// --------------------------------------------------------------------------------------- pretty JSON
const SPACE_ESC = /[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g;
function str(s) {
  return JSON.stringify(s).replace(SPACE_ESC, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function scalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) throw new Error('non-JSON number leaked: ' + v);
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}
const isScalar = (v) => v === null || typeof v !== 'object';

/** Deterministic pretty JSON: 2-space indent, arrays of scalars packed onto lines of <= width chars. */
export function pretty(v, indent = '', width = 120) {
  if (isScalar(v)) return scalar(v);
  const ind = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isScalar)) {
      const items = v.map(scalar);
      const one = '[' + items.join(', ') + ']';
      if (one.length + indent.length <= width) return one;
      const lines = [];
      let line = '';
      for (const it of items) {
        if (line && ind.length + line.length + it.length + 2 > width) { lines.push(line); line = ''; }
        line += (line ? ' ' : '') + it + ',';
      }
      if (line) lines.push(line);
      lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
      return '[\n' + lines.map((l) => ind + l).join('\n') + '\n' + indent + ']';
    }
    // small arrays of small scalar-only arrays/objects stay on one line when short
    const parts = v.map((x) => pretty(x, ind, width));
    const one = '[' + parts.join(', ') + ']';
    if (!one.includes('\n') && one.length + indent.length <= width) return one;
    return '[\n' + parts.map((p) => ind + p).join(',\n') + '\n' + indent + ']';
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return '{}';
  const parts = keys.map((k) => str(k) + ': ' + pretty(v[k], ind, width));
  const one = '{' + parts.join(', ') + '}';
  if (!one.includes('\n') && one.length + indent.length <= Math.min(width, 100) && keys.length <= 8) return one;
  return '{\n' + parts.map((p) => ind + p).join(',\n') + '\n' + indent + '}';
}

// --------------------------------------------------------------------------------------- file output
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Write one exported JSON file with the common wrapper:
 *   {schema, version, source (web git HEAD), sourceDirty, sourceFiles, producer, ...extra, data}
 * Returns {path, bytes, sha256}.
 */
export function writeWrapped(absPath, { schema, version = 1, files = [], producer, extra = {}, data }) {
  const g = gitInfo();
  const doc = {
    schema,
    version,
    source: g.rev,
    sourceDirty: g.dirty,
    sourceFiles: files,
    producer,
    ...extra,
    data,
  };
  const text = pretty(doc) + '\n';
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, text);
  return { path: path.relative(APPLE, absPath), bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

/** Little-endian binary sidecar; returns the {file, dtype, shape, sha256} reference to embed in JSON. */
export function writeSidecar(absPath, typed, shape) {
  const dtype = typed instanceof Float64Array ? 'f64' : typed instanceof Float32Array ? 'f32' : typed instanceof Uint8Array ? 'u8' : typed instanceof Int32Array ? 'i32' : typed instanceof Uint32Array ? 'u32' : null;
  if (!dtype) throw new Error('unsupported sidecar type');
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian host');
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, buf);
  return { file: path.basename(absPath), dtype, shape: shape || [typed.length], sha256: sha256(buf) };
}

export function relSrc(rel) {
  return 'rescue/src/' + rel;
}

// ------------------------------------------------------------------------------------------ manifest
// Raw texture files and the exporter that owns each kind. Every file in Resources/Textures must have a
// known extension: an unlisted binary would ship without a size / sha256 check (DataCatalog.verifyAll).
export const TEXTURE_KINDS = {
  '.rgba': { schema: 'raw.rgba8', producer: 'tools/export/export-data.mjs' },
  '.rg16f': { schema: 'raw.rg16f', producer: 'tools/export/export-render.mjs' },
};

/**
 * Resources/Data/manifest.json: every Resources/Data/*.json (except the manifest itself) and every
 * Resources/Textures/* file with schema, version, producer, bytes and sha256. Rebuilt from the
 * directories, so any exporter that writes into them (export-data, export-render) calls it last.
 */
export function writeManifest({ dataDir = path.join(APPLE, 'Resources/Data'), texDir = path.join(APPLE, 'Resources/Textures') } = {}) {
  const g = gitInfo();
  const entries = [];
  for (const f of fs.readdirSync(dataDir).sort()) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const text = fs.readFileSync(path.join(dataDir, f));
    let schema = null, version = null, producer = null;
    try { const j = JSON.parse(text); schema = j.schema; version = j.version; producer = j.producer; } catch {}
    entries.push({ path: `Resources/Data/${f}`, schema, version, producer, bytes: text.length, sha256: sha256(text) });
  }
  for (const f of fs.existsSync(texDir) ? fs.readdirSync(texDir).sort() : []) {
    if (f.startsWith('.') || !fs.statSync(path.join(texDir, f)).isFile()) continue; // top-level files only
    const kind = TEXTURE_KINDS[path.extname(f)];
    if (!kind) throw new Error(`manifest: Resources/Textures/${f} has no known kind (TEXTURE_KINDS in lib/common.mjs)`);
    const buf = fs.readFileSync(path.join(texDir, f));
    entries.push({ path: `Resources/Textures/${f}`, schema: kind.schema, version: 1, producer: kind.producer, bytes: buf.length, sha256: sha256(buf) });
  }
  const manifest = { schema: 'mayday.manifest', version: 1, formatVersion: 1, webRevision: g.rev, webDirty: g.dirty, files: entries };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), pretty(manifest) + '\n');
  return { entries, git: g };
}
