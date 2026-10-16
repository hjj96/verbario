// Node ESM loader hooks for running the web game's modules (rescue/src) under Node 22.
//
// resolve: 'three' and 'three/addons/*' -> rescue/vendor/three (the same files the page importmap uses).
// load:    every module under rescue/src gets one extra export appended:
//            export function __scope() { return { NAME: <live value>, ... } }
//          listing all of its top-level bindings (const/let/var/function/class), exported or not.
//          The exporters read module-private tables (PRESETS, K, LINES, ...) through it, so nothing in
//          rescue/ has to be edited to be exported. Values are read lazily (TDZ-safe, try/catch per name).
//
// The top-level names are found with acorn when it can be resolved, otherwise with a column-0 scanner
// (the web code is consistently formatted: top-level declarations start at column 0).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../../../../', import.meta.url); // repo root (verbario/)
const RESCUE = new URL('rescue/', ROOT);
const SRC = new URL('rescue/src/', ROOT).href;
const VENDOR = new URL('rescue/vendor/three/', ROOT);

let acorn = null;
{
  const req = createRequire(import.meta.url);
  const candidates = ['acorn', '/opt/node-tools/node_modules/acorn', '/opt/node22/lib/node_modules/acorn'];
  for (const c of candidates) {
    try { acorn = req(c); break; } catch {}
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function namesFromPattern(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': for (const q of p.properties) namesFromPattern(q.type === 'RestElement' ? q.argument : q.value, out); break;
    case 'ArrayPattern': for (const q of p.elements) namesFromPattern(q, out); break;
    case 'AssignmentPattern': namesFromPattern(p.left, out); break;
    case 'RestElement': namesFromPattern(p.argument, out); break;
  }
}

function topLevelNamesAcorn(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  for (let n of ast.body) {
    if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration) n = n.declaration;
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) namesFromPattern(d.id, out);
    else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) out.push(n.id.name);
  }
  return out;
}

function topLevelNamesScan(src) {
  const out = [];
  const re = /^(?:export\s+)?(?:default\s+)?(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)|(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1] || m[2] || m[3]);
  return out;
}

export function topLevelNames(src) {
  const names = acorn ? topLevelNamesAcorn(src) : topLevelNamesScan(src);
  return [...new Set(names)].filter((n) => IDENT.test(n) && n !== '__scope');
}

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('three.module.min.js', VENDOR).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('addons/' + specifier.slice('three/addons/'.length), VENDOR).href, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith(SRC) && url.endsWith('.js')) {
    const src = readFileSync(fileURLToPath(url), 'utf8');
    const names = topLevelNames(src);
    const body = names.map((n) => `  get ${n}() { try { return ${n}; } catch { return undefined; } },`).join('\n');
    const source = `${src}\n;export function __scope() { return {\n${body}\n}; }\n`;
    return { format: 'module', source, shortCircuit: true };
  }
  if (url.startsWith(VENDOR.href) && url.endsWith('.js')) {
    return { format: 'module', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}

export { RESCUE, ROOT };
