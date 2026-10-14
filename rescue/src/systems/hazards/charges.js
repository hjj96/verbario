// Lightning on the water (DESIGN §2.12 «Молния», §3.12, §3.8, §3.15 «Мимо молнии»).
// Weather schedules strikes and owns the flash; hazards own the GROUND side:
//   * `weather:charge {x, z, radius: 30, eta, target, heli}` → a pale pulsing #7FB8FF ring R 30 m on the water
//     for the eta (urgency rises: brighter, faster pulse, electric crackle; reduceFlashes → slow smooth glow)
//   * `weather:lightning` at a charge → the ring flashes and dies; damage / EMP / near-miss for the heli:
//       hit  : within the strike radius — the whole 30 m zone when the bolt seeks the heli (target 'heli'),
//              the inner 15 m for a sea strike that happens to be close
//              → 20 % hull + EMP 4 s (heli.damage(…, 'lightning') + heli.emp), `hazard:hit {type: 'lightning'}`
//       miss : 15–40 m without damage → `hazard:near-miss {type: 'lightning'}` (style bonus «Мимо молнии»)
import * as THREE from 'three';
import { COLORS, clamp01, metres, NBSP } from './common.js';

const RING_COL = new THREE.Color(COLORS.charge).multiplyScalar(1.6);
const FLASH_COL = new THREE.Color(COLORS.chargeCore);
const HIT_DAMAGE = 0.2;
const EMP_TIME = 4;
const NEAR_MIN = 15;
const NEAR_MAX = 40;

export class Charges {
  constructor(hz) {
    this.hz = hz;
    this.ctx = hz.ctx;
    this.list = [];
    this.pool = [];
  }

  clear() {
    for (const c of this.list) this.hz.glowRings.free(c.ring);
    this.list.length = 0;
  }

  // weather:charge
  onCharge(e) {
    if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.z)) return;
    const c = this.pool.pop() || {};
    c.x = e.x;
    c.z = e.z;
    c.radius = Number(e.radius) || 30;
    c.total = Math.max(0.2, Number(e.eta) || 2);
    c.eta = c.total;
    c.target = e.target || 'sea';
    c.struck = false;
    c.t = 0;
    c.ring = this.hz.glowRings.alloc();
    if (c.ring) {
      c.ring.x = c.x;
      c.ring.z = c.z;
      c.ring.radius = c.radius;
      c.ring.color.copy(RING_COL);
    }
    this.list.push(c);
    const hp = this.hz.heliPos;
    const d = Math.hypot(hp.x - c.x, hp.z - c.z);
    if (this.hz.playing && (e.heli || d < c.radius * 1.5)) {
      this.hz.warn({
        type: 'lightning', position: new THREE.Vector3(c.x, 0, c.z), eta: c.eta, stage: 'charge', level: 'danger',
        text: 'ГРОЗА РЯДОМ', detail: `ЗАРЯД · ${metres(Math.max(10, d))}`, distance: d, radius: c.radius,
      });
    }
  }

  // weather:lightning (sea strikes only)
  onStrike(e) {
    if (!e || e.cloudOnly || !Number.isFinite(e.x)) return;
    let best = null;
    let bd = 6;
    for (const c of this.list) {
      if (c.struck) continue;
      const d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) {
      best.struck = true;
      best.t = 0;
    }
    const hz = this.hz;
    if (!hz.playing || !hz.heliAlive || hz.heliLanded) return;
    const hp = hz.heliPos;
    const d = Math.hypot(hp.x - e.x, hp.z - e.z);
    const radius = best ? best.radius : 30;
    const hitR = best && best.target === 'heli' ? radius : 0.5 * radius;
    if (d <= hitR) {
      hz.hitHeli(HIT_DAMAGE, 'lightning', { type: 'lightning', x: e.x, z: e.z, distance: d });
      const h = this.ctx.heli;
      if (h) h.emp = Math.max(Number(h.emp) || 0, EMP_TIME);
    } else if (d >= NEAR_MIN && d <= NEAR_MAX) {
      hz.emit('hazard:near-miss', { type: 'lightning', distance: d, x: e.x, z: e.z, text: `МИМО МОЛНИИ · ${Math.round(d)}${NBSP}М` });
    }
  }

  update(dt) {
    const reduce = !!this.ctx.settings.get('reduceFlashes');
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const r = c.ring;
      if (!c.struck) {
        c.eta -= dt;
        const prog = clamp01(1 - c.eta / c.total);
        if (r) {
          // pale pulse that quickens and brightens towards the strike (reduceFlashes: a slow breath)
          const f = reduce ? 0.8 : 2 + 4 * prog;
          c.phase = (c.phase || 0) + f * dt;
          const pulse = reduce ? 0.5 + 0.5 * Math.sin(c.phase * Math.PI * 2) : Math.pow(0.5 + 0.5 * Math.sin(c.phase * Math.PI * 2), 1.5);
          r.a = clamp01(c.t / 0.25) * (0.55 + 1.1 * prog) * (reduce ? 0.7 : 1);
          r.b = pulse;
          r.c = reduce ? 0 : 0.35 + 0.65 * prog;
          r.color.copy(RING_COL);
          r.x = c.x;
          r.z = c.z;
        }
        c.t += dt;
        // the bolt never came (weather reset / mission change) → let the ring go
        if (c.eta < -1.5) c.struck = true;
      } else {
        c.t += dt;
        if (r) {
          // impact: flash white-blue, then the ring collapses
          const k = Math.max(0, 1 - c.t / 0.55);
          r.a = (reduce ? 1.2 : 3.2) * k * k;
          r.b = 1;
          r.c = 0;
          r.color.copy(FLASH_COL);
          r.radius = c.radius * (1 + 0.25 * (1 - k));
        }
        if (c.t > 0.6) {
          this.hz.glowRings.free(r);
          c.ring = null;
          this.list.splice(i, 1);
          this.pool.push(c);
        }
      }
    }
  }

  // 0..1 danger near pending charges (HUD warnings)
  danger(x, z) {
    let d = 0;
    for (const c of this.list) {
      if (c.struck) continue;
      const r = Math.hypot(x - c.x, z - c.z);
      if (r < c.radius * 1.5) d = Math.max(d, clamp01(1 - c.eta / c.total) * 0.6 + 0.4);
    }
    return d;
  }

  // The most urgent charge around the heli (for hazards.imminent)
  nearest(x, z) {
    let best = null;
    for (const c of this.list) {
      if (c.struck) continue;
      if (Math.hypot(x - c.x, z - c.z) > c.radius * 1.5) continue;
      if (!best || c.eta < best.eta) best = c;
    }
    return best;
  }
}
