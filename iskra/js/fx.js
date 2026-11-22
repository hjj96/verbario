'use strict';
/* ===== Визуальные эффекты: частицы, молнии, лучи, кольца, цифры урона ===== */

const FX = {
  parts: [], texts: [], arcs: [], beams: [], rings: [], slashes: [], ghosts: [],
  max: 1800, quality: 1, shake: 0, flashA: 0, flashCol: '#ffffff', dmgNumbers: true,
  clear() { this.parts.length = 0; this.texts.length = 0; this.arcs.length = 0; this.beams.length = 0; this.rings.length = 0; this.slashes.length = 0; this.ghosts.length = 0; this.shake = 0; this.flashA = 0; },

  add(p) {
    if (this.parts.length >= this.max * this.quality) return null;
    this.parts.push(p);
    return p;
  },
  dot(x, y, vx, vy, life, size, col, drag) {
    return this.add({ k: 0, x, y, vx, vy, life, max: life, size, col, drag: drag === undefined ? 3 : drag, grow: 0 });
  },
  burst(x, y, n, col, spd, life, size) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = spd * rand(0.3, 1);
      this.dot(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.2), size * rand(0.6, 1.3), col, 3.5);
    }
  },
  sparks(x, y, n, col, spd, ang, spread, life) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = ang === undefined ? Math.random() * TAU : ang + rand(-spread, spread);
      const s = spd * rand(0.4, 1.1);
      this.add({ k: 1, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: (life || 0.35) * rand(0.6, 1.2), max: life || 0.35, size: rand(0.8, 1.6), col, drag: 4 });
    }
  },
  debris(x, y, n, col, spd) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (spd || 120) * rand(0.3, 1);
      this.add({ k: 2, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, size: rand(1.5, 3.5), col, drag: 5, rot: rand(0, TAU), vr: rand(-12, 12) });
    }
  },
  smoke(x, y, n, col, size) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(10, 40);
      this.add({ k: 3, x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life: rand(0.5, 1.1), max: 1.1, size: (size || 8) * rand(0.7, 1.3), col: col || '#1a1d24', drag: 2, grow: 14 });
    }
  },
  explosion(x, y, r, col, big) {
    this.dot(x, y, 0, 0, 0.22, r * 2.2, col, 0);
    this.dot(x, y, 0, 0, 0.12, r * 1.3, '#ffffff', 0);
    this.ring(x, y, r * 0.3, r * 1.15, 0.28, col, 3);
    this.sparks(x, y, big ? 22 : 10, col, r * 7, undefined, 0, 0.4);
    this.burst(x, y, big ? 14 : 6, '#ffd36b', r * 3, 0.35, 5);
    this.smoke(x, y, big ? 6 : 3, '#15171c', r * 0.4);
  },
  ring(x, y, r0, r1, life, col, w) { this.rings.push({ x, y, r0, r1, life, max: life, col, w: w || 2 }); },
  beam(x1, y1, x2, y2, w, life, col) { this.beams.push({ x1, y1, x2, y2, w, life, max: life, col }); },
  slash(x, y, ang, arc, r, life, col, w) { this.slashes.push({ x, y, ang, arc, r, life, max: life, col, w: w || 1 }); },
  lightning(x1, y1, x2, y2, col, w, life, jag) {
    const pts = [x1, y1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), n = Math.max(2, Math.ceil(len / 16));
    const nx = -dy / (len || 1), ny = dx / (len || 1), j = jag || 9;
    for (let i = 1; i < n; i++) {
      const q = i / n, off = rand(-j, j) * Math.sin(q * Math.PI);
      pts.push(x1 + dx * q + nx * off, y1 + dy * q + ny * off);
    }
    pts.push(x2, y2);
    this.arcs.push({ pts, life: life || 0.16, max: life || 0.16, col, w: w || 2 });
  },
  text(x, y, str, col, size, opt) {
    if (this.texts.length > 70) return;
    this.texts.push({ x, y, str, col, size: size || 14, life: (opt && opt.life) || 0.8, max: (opt && opt.life) || 0.8, vy: (opt && opt.vy) || -38, big: opt && opt.big });
  },
  dmg(x, y, v, crit) {
    if (!this.dmgNumbers) return;
    if (!crit && this.texts.length > 60) return;
    this.text(x + rand(-6, 6), y - 10, fmtNum(v), crit ? '#ffd36b' : 'rgba(255,255,255,0.85)', crit ? 16 : 11, { life: crit ? 0.75 : 0.5, vy: crit ? -50 : -36, big: crit });
  },
  addShake(a) { this.shake = Math.min(18, this.shake + a); },
  flash(col, a) { this.flashCol = col; this.flashA = Math.max(this.flashA, a); },

  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { removeAt(P, i); continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    const tick = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) removeAt(arr, i); } };
    tick(this.arcs); tick(this.beams); tick(this.rings); tick(this.slashes); tick(this.ghosts);
    const T = this.texts;
    for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-3 * dt); if (t.life <= 0) removeAt(T, i); }
    this.shake *= Math.exp(-9 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
  },

  // нормальное наложение: обломки и дым
  drawUnder(c) {
    for (const p of this.parts) {
      if (p.k === 2) {
        const a = clamp(p.life / p.max * 1.5, 0, 1);
        c.globalAlpha = a; c.fillStyle = p.col;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); c.restore();
      } else if (p.k === 3) {
        const a = clamp(p.life / p.max, 0, 1) * 0.5;
        c.globalAlpha = a; c.fillStyle = p.col;
        c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1;
  },
  // аддитивное свечение
  drawGlow(c, viewScale) {
    c.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      if (p.k === 0) {
        const a = clamp(p.life / p.max, 0, 1);
        c.globalAlpha = a;
        const s = p.size * (0.6 + a * 0.4);
        c.drawImage(dotSprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    // искры: один путь на цвет и ступень прозрачности
    c.lineCap = 'round';
    const B = this._buckets || (this._buckets = new Map());
    for (const arr of B.values()) arr.length = 0;
    for (const p of this.parts) {
      if (p.k !== 1) continue;
      const q = Math.min(3, (clamp(p.life / p.max, 0, 1) * 4) | 0);
      const key = p.col + q;
      let arr = B.get(key);
      if (!arr) { arr = []; arr.col = p.col; arr.q = q; B.set(key, arr); }
      arr.push(p);
    }
    c.lineWidth = 1.3;
    for (const arr of B.values()) {
      if (!arr.length) continue;
      c.globalAlpha = (arr.q + 1) / 4; c.strokeStyle = arr.col;
      c.beginPath();
      for (const p of arr) { c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); }
      c.stroke();
    }
    for (const r of this.rings) {
      const q = 1 - r.life / r.max, rad = lerp(r.r0, r.r1, ease.outCubic(q));
      c.globalAlpha = (1 - q) * 0.9;
      c.strokeStyle = r.col; c.lineWidth = r.w * (1 - q * 0.6);
      c.beginPath(); c.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU); c.stroke();
    }
    for (const b of this.beams) {
      const q = b.life / b.max;
      c.globalAlpha = q;
      c.strokeStyle = b.col; c.lineWidth = b.w * (0.4 + q * 0.6) * 2.2;
      c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = b.w * q * 0.7;
      c.stroke();
    }
    for (const a of this.arcs) {
      const q = a.life / a.max;
      c.globalAlpha = q;
      c.beginPath(); c.moveTo(a.pts[0], a.pts[1]);
      for (let i = 2; i < a.pts.length; i += 2) c.lineTo(a.pts[i], a.pts[i + 1]);
      c.strokeStyle = a.col; c.lineWidth = a.w * 2.6; c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = a.w * 0.8; c.stroke();
    }
    for (const s of this.slashes) {
      const q = 1 - s.life / s.max;
      const a0 = s.ang - s.arc / 2, sweep = s.arc * ease.outCubic(Math.min(1, q * 1.6));
      c.globalAlpha = (1 - q);
      const g = c.createRadialGradient(s.x, s.y, s.r * 0.35, s.x, s.y, s.r);
      g.addColorStop(0, rgba(s.col, 0)); g.addColorStop(0.7, rgba(s.col, 0.5)); g.addColorStop(0.92, rgba('#ffffff', 0.95)); g.addColorStop(1, rgba(s.col, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(s.x, s.y, s.r, a0, a0 + sweep); c.arc(s.x, s.y, s.r * 0.45, a0 + sweep, a0, true); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  },
  drawTexts(c, toScreen, uiScale) {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const t of this.texts) {
      const p = toScreen(t.x, t.y);
      const q = t.life / t.max;
      const pop = t.big ? 1 + Math.max(0, (q - 0.75)) * 3 : 1;
      c.globalAlpha = clamp(q * 2, 0, 1);
      c.font = '800 ' + Math.round(t.size * uiScale * pop) + 'px "Exo 2", "Segoe UI", sans-serif';
      c.lineWidth = 3 * uiScale; c.strokeStyle = 'rgba(5,6,10,0.85)';
      c.strokeText(t.str, p.x, p.y);
      c.fillStyle = t.col; c.fillText(t.str, p.x, p.y);
    }
    c.globalAlpha = 1;
  },
};
