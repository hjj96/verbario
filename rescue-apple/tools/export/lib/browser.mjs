// Headless Chromium for the exporters that need the live game (Playwright + SwiftShader WebGL2).
//   - serves the repo root itself (built-in static server on a free port; no http-server needed)
//   - serialises runs machine-wide with a lock directory (SwiftShader is CPU-bound; parallel runs thrash)
//   - collects console errors / page errors / failed requests (Google Fonts are allowed to fail offline)
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), MAYDAY_CHROMIUM_LOCK (lock directory).
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

async function acquireLock() {
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'owner'), JSON.stringify({ pid: process.pid, t: Date.now() }));
      return;
    } catch {
      let stale = false;
      try {
        const o = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner'), 'utf8'));
        try { process.kill(o.pid, 0); } catch { stale = true; }
        if (Date.now() - o.t > 6 * 60 * 1000) stale = true;
      } catch {
        try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) stale = true; } catch {}
      }
      if (stale) { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() - t0 > 12 * 60 * 1000) return;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}
function releaseLock() {
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
  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  await acquireLock();
  process.on('exit', releaseLock);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
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
    await browser.close();
    srv.close();
    releaseLock();
  }
}
