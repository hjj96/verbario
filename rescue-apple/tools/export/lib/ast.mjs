// Static scans of the web sources (acorn): event emit/on sites with payload keys; top-level bindings
// whose initializer holds a `/* glsl */`-tagged template literal (shader code, never data).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SRC_DIR } from './common.mjs';

const req = createRequire(import.meta.url);
let acorn = null;
for (const c of ['acorn', '/opt/node-tools/node_modules/acorn', '/opt/node22/lib/node_modules/acorn']) {
  try { acorn = req(c); break; } catch {}
}
export const hasAcorn = !!acorn;

export function listSources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(path.relative(SRC_DIR, p).split(path.sep).join('/'));
    }
  };
  walk(SRC_DIR);
  return out;
}

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') visit(x, fn); }
    else if (v && typeof v.type === 'string') visit(v, fn);
  }
}

const EVENT_RE = /^(game|ui|mission|score|weather|hazard|heli|survivor|radio|camera|world|fx|post|audio|hud|input|settings|photo|thermal|ocean|crew|winch|signal|checkpoint|shift|endless):[a-z0-9-]+$/;

function keyName(p) {
  if (p.type === 'SpreadElement') return '...' + (p.argument.name || p.argument.type);
  if (p.computed) return '[computed]';
  return p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
}

/**
 * Every `<x>.emit('name', payload)` and `<x>.on/once/off('name', ...)` in rescue/src.
 * Returns Map name -> {emitters:Set(file), listeners:Set(file), payloadKeys:Set, payloadRefs:Set}.
 */
export function scanEvents() {
  if (!acorn) throw new Error('acorn not found (npm i acorn, or set NODE_PATH)');
  const events = new Map();
  const get = (n) => {
    if (!events.has(n)) events.set(n, { emitters: new Set(), listeners: new Set(), indirect: new Set(), payloadKeys: new Set(), payloadRefs: new Set(), bare: false });
    return events.get(n);
  };
  for (const rel of listSources()) {
    const src = fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    visit(ast, (n) => {
      if (n.type !== 'CallExpression') return;
      const c = n.callee;
      const m = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
      if (!m) return;
      const role = /emit/i.test(m) ? 'emit' : /^_?(on|once)$/.test(m) ? 'on' : /^_?off$/.test(m) ? 'off' : 'other';
      const a0 = n.arguments[0];
      if (!a0) return;
      const lits = a0.type === 'Literal' ? [a0] : a0.type === 'ConditionalExpression' ? [a0.consequent, a0.alternate] : [];
      for (const lit of lits) {
        if (lit.type !== 'Literal' || typeof lit.value !== 'string' || !EVENT_RE.test(lit.value)) continue;
        const e = get(lit.value);
        if (role === 'emit') {
          e.emitters.add(rel);
          const a1 = n.arguments[1];
          if (!a1) e.bare = true;
          else if (a1.type === 'ObjectExpression') for (const p of a1.properties) e.payloadKeys.add(keyName(p));
          else e.payloadRefs.add(a1.type === 'Identifier' ? a1.name : a1.type);
        } else if (role === 'on') e.listeners.add(rel);
        else if (role === 'other') e.indirect.add(rel + ':' + m);
      }
    });
  }
  return events;
}

/**
 * Top-level bindings (`const|let|var`, exported or not) of rescue/src/<rel> whose initializer contains
 * a template literal tagged with the `/* glsl *\/` comment that every web shader string carries, e.g.
 *   export const OCEAN_VERTEX_BEGIN = /* glsl *\/ `\nvec3 transformed = oPos;\n`;
 * Returns Set(name). This is the authoritative GLSL test for module tables (the text heuristic in
 * common.mjs misses short snippets); callers still check that the live value is a string.
 */
export function glslTaggedBindings(rel) {
  if (!acorn) throw new Error('acorn not found (npm i acorn, or set NODE_PATH)');
  const src = fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
  const comments = [];
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
  // start offsets of template literals that directly follow a /* glsl */ comment (whitespace between)
  const tagged = [];
  for (const c of comments) {
    if (c.type !== 'Block' || !/^\s*glsl\s*$/i.test(c.value)) continue;
    let i = c.end;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '`') tagged.push(i);
  }
  const out = new Set();
  if (!tagged.length) return out;
  const names = (p, acc) => {
    if (!p) return;
    if (p.type === 'Identifier') acc.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => names(q.type === 'RestElement' ? q.argument : q.value, acc));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => names(q, acc));
    else if (p.type === 'AssignmentPattern') names(p.left, acc);
  };
  for (let n of ast.body) {
    if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration) n = n.declaration;
    if (n.type !== 'VariableDeclaration') continue;
    for (const d of n.declarations) {
      if (!d.init || !tagged.some((t) => t >= d.init.start && t < d.init.end)) continue;
      const acc = [];
      names(d.id, acc);
      for (const x of acc) out.add(x);
    }
  }
  return out;
}
