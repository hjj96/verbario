// Gust fronts (DESIGN §3.12 «Порыв», §3.13 frequencies).
// A front is a 140 m sin² band × 500 m gaussian taper of extra wind that travels at W + G along a
// direction within ±20° of the wind. It is spawned upwind so that it reaches the heli in `eta` s
// (6 s by default, +1 s on cadet) and is announced with `weather:gust` — the same data feeds look.setFronts (the
// "cat's paws" drawn by the ocean) and weather.windAt (what pushes the heli).
import * as THREE from 'three';

const MAX = 4;
const WIDTH = 140;
const LENGTH = 500;
const FADE_IN = 1.2; // s — fronts spawned inside the view do not pop
const FADE_OUT_DIST = 260; // m past the heli → fade and recycle

export class Gusts {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.rng = rng;
    // Pooled front records; `active` is the live list (also exposed as weather.state.gustFronts).
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        x: 0, z: 0, dirX: 1, dirZ: 0, strength: 0, baseStrength: 0, width: WIDTH, length: LENGTH,
        eta: 0, speed: 0, harmless: false, age: 0, fade: 0, alive: false,
      });
    }
    this.active = [];
    this.timer = 8;
    this._dir = new THREE.Vector2();
  }

  reset() {
    for (const f of this.pool) f.alive = false;
    this.active.length = 0;
    this.timer = 8 + this.rng.next() * 6;
  }

  // Spawn a front so it reaches (hx, hz) after `eta` seconds.
  // windDir: Vector2 unit (towards), windSpeed: m/s mean. Returns the front or null (pool full).
  spawn(hx, hz, windDir, windSpeed, { strength = 8, dir, eta = 6, harmless = false } = {}) {
    // cadet difficulty: every telegraph gets +1 s (DESIGN §3.17) — the front starts further upwind
    if (this.ctx.settings?.get?.('difficulty') === 'cadet') eta += 1;
    let f = null;
    for (const p of this.pool) if (!p.alive) { f = p; break; }
    if (!f) {
      // Recycle the oldest front (it is far past the heli by now).
      f = this.active.reduce((a, b) => (a.age > b.age ? a : b));
      this.active.splice(this.active.indexOf(f), 1);
    }
    if (dir && dir.lengthSq() > 1e-6) this._dir.copy(dir).normalize();
    else {
      const a = (this.rng.next() * 2 - 1) * THREE.MathUtils.degToRad(20);
      const c = Math.cos(a), s = Math.sin(a);
      this._dir.set(windDir.x * c - windDir.y * s, windDir.x * s + windDir.y * c);
    }
    const speed = Math.max(4, windSpeed + strength);
    const dist = speed * eta;
    const lat = (this.rng.next() * 2 - 1) * 60; // not always dead centre — still well inside the 500 m taper
    f.dirX = this._dir.x;
    f.dirZ = this._dir.y;
    f.x = hx - f.dirX * dist - f.dirZ * lat;
    f.z = hz - f.dirZ * dist + f.dirX * lat;
    f.baseStrength = strength;
    f.strength = 0;
    f.speed = speed;
    f.eta = eta;
    f.harmless = !!harmless;
    f.age = 0;
    f.fade = 0;
    f.alive = true;
    this.active.push(f);
    return f;
  }

  // Advance fronts; schedule random ones from the preset gust rate. Returns a newly spawned front
  // (so weather can emit the event) or null.
  update(dt, hx, hz, windDir, windSpeed, gustStrength, gustRate, allowRandom) {
    let spawned = null;
    if (allowRandom && gustRate > 1e-4 && gustStrength > 0.5) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = (1 / gustRate) * (0.7 + 0.6 * this.rng.next());
        spawned = this.spawn(hx, hz, windDir, windSpeed, { strength: gustStrength * (0.8 + 0.4 * this.rng.next()) });
      }
    } else this.timer = Math.max(this.timer, 6);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.age += dt;
      f.x += f.dirX * f.speed * dt;
      f.z += f.dirZ * f.speed * dt;
      const along = (hx - f.x) * f.dirX + (hz - f.z) * f.dirZ; // > 0 while the front is still upwind
      f.eta = Math.max(0, along / f.speed);
      const fadeIn = Math.min(1, f.age / FADE_IN);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(-along, FADE_OUT_DIST * 0.6, FADE_OUT_DIST);
      f.fade = fadeIn * fadeOut;
      f.strength = f.baseStrength * f.fade;
      if (-along > FADE_OUT_DIST || f.age > 60) {
        f.alive = false;
        this.active.splice(i, 1);
      }
    }
    return spawned;
  }

  // Adds the gust-front wind vector at (x, z) to `out` (same profile as look.frontsAt / lookFront()).
  addWindAt(x, z, out) {
    for (let i = 0; i < this.active.length; i++) {
      const f = this.active[i];
      if (f.strength <= 0) continue;
      const rx = x - f.x;
      const rz = z - f.z;
      const along = rx * f.dirX + rz * f.dirZ;
      if (Math.abs(along) >= 0.5 * f.width) continue;
      const lat = -rx * f.dirZ + rz * f.dirX;
      const band = Math.sin(Math.PI * (along / f.width + 0.5)) ** 2;
      const taper = Math.exp(-2 * (lat / (0.5 * f.length)) ** 2);
      const s = band * taper * f.strength;
      out.x += f.dirX * s;
      out.y += f.dirZ * s;
    }
    return out;
  }
}
