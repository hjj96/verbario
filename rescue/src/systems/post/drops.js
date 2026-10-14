// Lens drops simulation (DESIGN §2.8 FinalPass step 1 [SHOULD]).
//
// The lens is a 28 × 16 grid of cells; each cell holds at most one drop (head offset inside the
// cell, radius, tail length). The CPU runs the tiny simulation and uploads a 28×16 float texture
// every frame; FinalPass draws each pixel from its 4 nearest cells.
//   * beads appear at a rate driven by palette.post.drops (rain), merge when they meet;
//   * after sticking 2–6 s they roll as rivulets along the flow (−heli screen velocity, 30 % wind);
//   * above 25 m/s airspeed they stretch and are blown off the lens;
//   * spray() fills 40 % of the cells at once (rotor wash, rogue wave, crest strike);
//   * with no rain the beads slowly evaporate («сохнут» in clearing); after any other preset change
//     they clear faster (dryK), and calm / fog lenses hold at most `cap` beads.
import * as THREE from 'three';

export const GRID_X = 28;
export const GRID_Y = 16;
const N = GRID_X * GRID_Y;
const MAX_R = 0.4; // cell heights
const MAX_TAIL = 0.55;

export class LensDrops {
  constructor(rng) {
    this.rng = rng || Math.random;
    this.data = new Float32Array(N * 4);
    this.texture = new THREE.DataTexture(this.data, GRID_X, GRID_Y, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;

    // per-cell state
    this.ox = new Float32Array(N);
    this.oy = new Float32Array(N);
    this.r = new Float32Array(N);
    this.tail = new Float32Array(N);
    this.stick = new Float32Array(N);
    this.age = new Float32Array(N);
    this.life = new Float32Array(N);
    this.stamp = new Uint32Array(N);
    this.frame = 1;
    this.spawnAcc = 0;
    this.count = 0;
    this.kx = 1; // cell height / cell width (for isotropic motion)
    this.dirty = true;
  }

  rand() {
    return this.rng();
  }

  clear() {
    this.r.fill(0);
    this.count = 0;
    this.dirty = true;
  }

  setAspect(w, h) {
    this.kx = (h / GRID_Y) / (w / GRID_X);
  }

  _place(i, r, stick, life) {
    if (this.r[i] > 0) {
      // merge: volume adds, big drops start rolling
      const nr = Math.min(MAX_R, Math.sqrt(this.r[i] * this.r[i] + r * r));
      this.r[i] = nr;
      if (nr > 0.28) this.stick[i] = Math.min(this.stick[i], 0.2);
      this.age[i] = Math.min(this.age[i], 1);
      return;
    }
    this.r[i] = r;
    this.ox[i] = (this.rand() - 0.5) * 0.5;
    this.oy[i] = (this.rand() - 0.5) * 0.5;
    this.tail[i] = 0;
    this.stick[i] = stick;
    this.age[i] = 0;
    this.life[i] = life;
    this.count++;
  }

  // Fill a share of the lens at once (default 40 % of cells at strength 1).
  spray(strength = 1) {
    const n = Math.round(N * 0.4 * THREE.MathUtils.clamp(strength, 0, 1.5));
    for (let k = 0; k < n; k++) {
      const i = Math.floor(this.rand() * N);
      const u = this.rand();
      this._place(i, 0.08 + 0.2 * u * u, 1 + this.rand() * 3, 6 + this.rand() * 8);
    }
    this.dirty = true;
  }

  // dt: seconds (0 while paused). opts: rate (drops/s), speed (airspeed m/s), flowX/flowY (unit,
  // screen space, y up), rivulets (bool: rolling/merging; false = static beads only), cap (max beads,
  // 0 = no cap), dryK (evaporation speed-up without rain: 1 = the slow «сохнут» of clearing).
  update(dt, rate, speed, flowX, flowY, rivulets, cap = 0, dryK = 1) {
    if (dt <= 0) return;
    this.frame++;
    // spawn
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (cap > 0 && this.count >= cap) continue;
      const i = Math.floor(this.rand() * N);
      const u = this.rand();
      this._place(i, 0.06 + 0.2 * u * u * u, 2 + this.rand() * 4, 8 + this.rand() * 12);
      this.dirty = true;
    }
    if (this.count === 0) return;

    const fast = THREE.MathUtils.clamp((speed - 8) / 25, 0, 1.6); // 0 hover … 1 ≈ 33 m/s
    const blown = speed > 25;
    const dry = rate < 0.05 ? 1 : 0.35; // without rain, beads evaporate faster
    // over the cap (calm / fog after rain) or dry outside clearing: every bead shrinks, not only old ones
    const over = cap > 0 && this.count > cap ? 4 : 1;
    const evap = rate < 0.05 ? 0.12 * dryK * over : 0.06 * (1 + dry) * over;
    const evapAll = over > 1 || (rate < 0.05 && dryK > 1);
    const fx = flowX * this.kx;
    const fy = flowY;
    for (let i = 0; i < N; i++) {
      let r = this.r[i];
      if (r <= 0 || this.stamp[i] === this.frame) continue;
      this.age[i] += dt;
      if (this.age[i] > this.life[i] || evapAll) r -= dt * evap;
      if (!rivulets) {
        if (r < 0.035) this._kill(i);
        else this.r[i] = r;
        continue;
      }
      // sticking → rolling
      this.stick[i] -= dt * (1 + fast * 5 + (blown ? 8 : 0));
      if (this.stick[i] <= 0) {
        const v = (0.18 + 1.4 * (r / MAX_R)) * (0.35 + fast * 2.4) * (blown ? 2.6 : 1);
        this.ox[i] += fx * v * dt;
        this.oy[i] += fy * v * dt;
        this.tail[i] = Math.min(MAX_TAIL * (blown ? 1 : 0.7), this.tail[i] + v * dt * 0.8);
        r -= dt * 0.012 * (1 + fast); // a rivulet leaves water behind
      } else this.tail[i] = Math.max(0, this.tail[i] - dt * 0.5);
      if (r < 0.035) {
        this._kill(i);
        continue;
      }
      this.r[i] = r;
      // crossing into a neighbour cell
      const ox = this.ox[i];
      const oy = this.oy[i];
      if (ox > 0.5 || ox < -0.5 || oy > 0.5 || oy < -0.5) {
        const cx = i % GRID_X;
        const cy = (i - cx) / GRID_X;
        const sx = ox > 0.5 ? 1 : ox < -0.5 ? -1 : 0;
        const sy = oy > 0.5 ? 1 : oy < -0.5 ? -1 : 0;
        const nx = cx + sx;
        const ny = cy + sy;
        if (nx < 0 || ny < 0 || nx >= GRID_X || ny >= GRID_Y) {
          this._kill(i); // rolled off the lens
          continue;
        }
        const j = ny * GRID_X + nx;
        if (this.r[j] > 0) {
          // merge into the neighbour; it starts rolling too
          this.r[j] = Math.min(MAX_R, Math.sqrt(this.r[j] * this.r[j] + r * r));
          this.stick[j] = 0;
          this.tail[j] = Math.max(this.tail[j], this.tail[i]);
          this.stamp[j] = this.frame;
          this._kill(i);
        } else {
          this.r[j] = r;
          this.ox[j] = ox - sx;
          this.oy[j] = oy - sy;
          this.tail[j] = this.tail[i];
          this.stick[j] = this.stick[i];
          this.age[j] = this.age[i];
          this.life[j] = this.life[i];
          this.stamp[j] = this.frame;
          this.r[i] = 0;
        }
      }
    }
    this.dirty = true;
  }

  _kill(i) {
    this.r[i] = 0;
    this.count = Math.max(0, this.count - 1);
  }

  // Pack into the texture (R, G = head offset in cells; B = radius; A = tail length).
  upload() {
    if (!this.dirty) return;
    const d = this.data;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      const r = this.r[i];
      d[o] = this.ox[i];
      d[o + 1] = this.oy[i];
      d[o + 2] = r > 0 ? r : 0;
      d[o + 3] = r > 0 ? this.tail[i] : 0;
    }
    this.texture.needsUpdate = true;
    this.dirty = false;
  }
}
