// Headless Chromium for the exporters that need the live game (Playwright + SwiftShader WebGL2).
//   - serves the repo root itself (built-in static server on a free port; no http-server needed)
//   - serialises runs machine-wide with a lock directory (SwiftShader is CPU-bound; parallel runs thrash);
//     waits up to MAYDAY_CHROMIUM_LOCK_WAIT_MS (12 min) and then fails instead of running unlocked
//   - collects console errors / page errors / failed requests (Google Fonts are allowed to fail offline)
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), MAYDAY_CHROMIUM_LOCK (lock directory),
//      MAYDAY_CHROMIUM_LOCK_WAIT_MS (how long to wait for the lock).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REPO } from './common.mjs';

async function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of cands) {
    try {
      const m = c.startsWith('/') ? await import(pathToFileURL(c).href) : await import(pathToFileURL(createRequire(import.meta.url).resolve(c)).href);
      const pw = m.chromium ? m : m.default;
      if (pw && pw.chromium) return pw;
    } catch {}
  }
  throw new Error('playwright not found: npm i -D playwright (or set PLAYWRIGHT_MODULE)');
}

const LOCK = process.env.MAYDAY_CHROMIUM_LOCK || path.join(os.tmpdir(), 'mayday-chromium.lock');
const LOCK_WAIT_MS = Number(process.env.MAYDAY_CHROMIUM_LOCK_WAIT_MS) || 12 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;           // the owner refreshes owner.hb while it holds the lock
const HEARTBEAT_STALE_MS = 2 * 60 * 1000; // an owner whose heartbeat is this old is gone (PID reused)
let heartbeat = null;

// owner = {pid, since (acquired), t = hb (last heartbeat)}; written to a temp file and renamed so a reader
// never sees a half-written owner. `t` is refreshed too, so lock users that still judge staleness by
// the age of `t` (scratchpad/tools/shot.mjs: > 6 min) never take a lock from a live exporter. Owners
// without `hb` (shot.mjs) are judged by PID only.
function writeOwner(o) {
  const tmp = path.join(LOCK, `owner.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(o));
  fs.renameSync(tmp, path.join(LOCK, 'owner'));
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } // EPERM: alive, other user
}

// Stale only when the owner is provably gone: its PID is dead, or its heartbeat stopped (PID reuse).
// A long-running live owner is never stolen from, whatever the lock's age. A lock directory without
// an owner file (crash between mkdir and the first write) is stale after 30 s.
function lockIsStale() {
  let o;
  try { o = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner'), 'utf8')); } catch {
    try { return Date.now() - fs.statSync(LOCK).mtimeMs > 30000; } catch { return false; }
  }
  if (!Number.isInteger(o.pid) || !pidAlive(o.pid)) return true;
  return typeof o.hb === 'number' && Date.now() - o.hb > HEARTBEAT_STALE_MS;
}

async function acquireLock() {
  const t0 = Date.now();
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
    } catch {
      if (lockIsStale()) { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() - t0 > LOCK_WAIT_MS) {
        throw new Error(`chromium lock busy: ${LOCK} (waited ${Math.round(LOCK_WAIT_MS / 1000)} s; owner: ${(() => { try { return fs.readFileSync(path.join(LOCK, 'owner'), 'utf8'); } catch { return '?'; } })()})`);
      }
      if (!announced) { console.log(`waiting for the chromium lock ${LOCK} …`); announced = true; }
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    const since = Date.now();
    writeOwner({ pid: process.pid, since, t: since, hb: since });
    heartbeat = setInterval(() => {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner'), 'utf8'));
        const now = Date.now();
        if (o.pid === process.pid) writeOwner({ ...o, t: now, hb: now });
      } catch {}
    }, HEARTBEAT_MS);
    heartbeat.unref();
    return;
  }
}
function releaseLock() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  try {
    const o = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner'), 'utf8'));
    if (o.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
  } catch {}
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };

function startServer() {
  const root = path.resolve(REPO);
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!p.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/**
 * withGame(async ({ page, open, errors }) => ...)
 *   open(query) loads /rescue/index.html?<query> and waits until the game renders frames.
 */
export async function withBrowser(fn, { width = 960, height = 540 } = {}) {
  const { chromium } = await loadPlaywright();
  await acquireLock(); // throws when the lock stays busy: never run Chromium beside another holder
  process.on('exit', releaseLock);
  let srv = null;
  let browser = null;
  const errors = [];
  try {
    srv = await startServer();
    const base = `http://127.0.0.1:${srv.address().port}`;
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width, height } });
    const ignorable = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u);
    page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.location()?.url || '') && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message || String(e))));
    page.on('requestfailed', (r) => { if (!ignorable(r.url())) errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
    page.on('response', (r) => { if (r.status() >= 400 && !ignorable(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
    const open = async (query, { frames = 3, timeout = 90000 } = {}) => {
      await page.goto(`${base}/rescue/index.html${query ? '?' + query : ''}`, { waitUntil: 'load' });
      await page.waitForFunction((n) => window.__game && window.__game.time && window.__game.time.frame > n, frames, { timeout, polling: 250 });
    };
    return await fn({ page, open, errors, base });
  } finally {
    if (browser) await browser.close();
    if (srv) srv.close();
    releaseLock();
  }
}
