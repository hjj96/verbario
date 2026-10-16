// Entry shim for every Node exporter: installs browser stubs, seeds Math.random and registers the
// ESM hooks (three importmap + per-module __scope()). Import it FIRST, then import game modules
// dynamically through gameImport('systems/weather/presets.js').
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installDom, seedRandom } from './dom.mjs';

installDom();
seedRandom(Number(process.env.MAYDAY_RANDOM_SEED || 20261016));
register(new URL('./hooks.mjs', import.meta.url).href, pathToFileURL('./'));

export const ROOT = new URL('../../../../', import.meta.url);
export const SRC = new URL('rescue/src/', ROOT);

/** Import a module of the web game by its path under rescue/src (e.g. 'core/math.js'). */
export function gameImport(rel) {
  return import(new URL(rel, SRC).href);
}

/** All top-level bindings of a game module (exported or not), as a plain object of live values. */
export async function scopeOf(rel) {
  const m = await gameImport(rel);
  return { module: m, scope: m.__scope() };
}
