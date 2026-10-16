// Static scans of the web sources (acorn): event emit/on sites with payload keys.
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
