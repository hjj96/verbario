'use strict';
/* ===== Визуальные эффекты: частицы, молнии, лучи, кольца, цифры урона ===== */

const FX = {
  parts: [], texts: [], arcs: [], beams: [], rings: [], slashes: [], ghosts: [], lights: [], flashes: [], timers: [], cracks: [],
  max: 1800, quality: 1, shake: 0, flashA: 0, flashCol: '#ffffff', dmgNumbers: true, impact: 0, speedT: 0, speedDir: 0,
  clear() { this.parts.length = 0; this.texts.length = 0; this.arcs.length = 0; this.beams.length = 0; this.rings.length = 0; this.slashes.length = 0; this.ghosts.length = 0; this.lights.length = 0; this.flashes.length = 0; this.timers.length = 0; this.cracks.length = 0; this.shake = 0; this.flashA = 0; this.impact = 0; this.speedT = 0; },

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
  debris(x, y, n, col, spd) { this.shards(x, y, n, col, spd); },
  // осколки контура: светящиеся отрезки с вращением
  shards(x, y, n, col, spd) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (spd || 140) * rand(0.35, 1);
      this.add({ k: 4, x: x + rand(-3, 3), y: y + rand(-3, 3), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.75), max: 0.75, size: rand(2, 5.5), col, drag: 3.2, rot: rand(0, TAU), vr: rand(-14, 14) });
    }
  },
  light(x, y, r, col, a, life) {
    if (this.lights.length > 48) return;
    this.lights.push({ x, y, r, col, a, life: life || 0.3, max: life || 0.3 });
  },
  smoke(x, y, n, col, size) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(10, 40);
      this.add({ k: 3, x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life: rand(0.5, 1.1), max: 1.1, size: (size || 8) * rand(0.7, 1.3), col: col || '#1a1d24', drag: 2, grow: 14 });
    }
  },
  explosion(x, y, r, col, big) {
    // короткое белое ядро вспышки — маленькое: объём дают огненные клубы, а не светящееся пятно
    this.dot(x, y, 0, 0, 0.06, Math.min(r * 0.35, 16), '#ffffff', 0);
    this.dot(x, y, 0, 0, 0.1, Math.min(r * 0.6, 26), col, 0);
    // огненный шар: несколько объёмных клубов, поднимаются и темнеют в дым
    const n = Math.max(2, Math.round((big ? 5 : r < 30 ? 2 : 3) * this.quality * (this.parts.length > 900 ? 0.6 : 1)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = rand(0, r * 0.35), up = rand(0.5, 1.4);
      this.add({ k: 6, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, z: rand(0, r * 0.25), vx: Math.cos(a) * r * rand(0.8, 1.8), vy: Math.sin(a) * r * rand(0.5, 1.2), vz: r * up * 2.2,
        life: rand(0.42, 0.65) * (big ? 1.25 : 1), max: 0.65 * (big ? 1.25 : 1), size: r * rand(0.26, 0.42), grow: r * 0.75, col, drag: 3.4 });
    }
    // ударная волна по земле: эллипс в перспективе камеры
    this.ering(x, y, r * 0.25, r * 1.6, 0.34, col, 1.6, true);
    if (big) this.ering(x, y, r * 0.2, r * 1.8, 0.45, '#ffffff', 1, true);
    // раскалённые обломки: летят по дуге, падают и подпрыгивают
    const m = Math.round((big ? 6 : 3) * this.quality * (this.parts.length > 900 ? 0.5 : 1));
    for (let i = 0; i < m; i++) {
      const a = Math.random() * TAU, sp = r * rand(1.6, 4);
      this.add({ k: 5, x, y, z: r * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, vz: r * rand(3, 6.5), life: rand(0.6, 1.05), max: 1.05, size: rand(0.55, 1.05) * Math.min(1.6, r / 30), rot: rand(0, 8), vr: rand(-14, 14), col, drag: 1.1 });
    }
    this.sparks(x, y, big ? 14 : 6, '#ffffff', r * 7, undefined, 0, 0.32);
    this.light(x, y, r * 2.2, col, big ? 0.45 : 0.3, big ? 0.4 : 0.28);
  },
  // вспышка у дула: чёткая четырёхлучевая звезда — длинный луч по выстрелу, короткий поперёк
  mflash(x, y, ang, size, col) { if (this.flashes.length < 40) this.flashes.push({ x, y, ang, size, col, life: 0.09, max: 0.09 }); },
  // шестиугольник попадания: чёткая расходящаяся грань
  hexRing(x, y, r0, r1, life, col, w) { if (this.rings.length < 160) this.rings.push({ x, y, r0, r1, life, max: life, col, w: w || 1.4, hex: true, rot: Math.random() * TAU }); },
  // кольцо по земле в перспективе (взрывы, удары)
  ering(x, y, r0, r1, life, col, w, thin) { this.rings.push({ x, y, r0, r1, life, max: life, col, w: w || 2, ell: true, thin }); },
  // рельсовый луч со спиралью и кольцами давления вдоль ствола
  rail(x1, y1, x2, y2, w, life, col) { this.beams.push({ x1, y1, x2, y2, w, life, max: life, col, helix: true, ph: Math.random() * TAU }); },
  puff(x, y, size, col, life, vx, vy) { return this.add({ k: 3, x, y, vx: vx || 0, vy: vy || -12, life, max: life, size, col, drag: 1.5, grow: size * 1.6, soft: true }); },
  ring(x, y, r0, r1, life, col, w) { this.rings.push({ x, y, r0, r1, life, max: life, col, w: w || 2 }); },
  beam(x1, y1, x2, y2, w, life, col) { this.beams.push({ x1, y1, x2, y2, w, life, max: life, col, cs: sheathCol(col) }); },
  slash(x, y, ang, arc, r, life, col, w) { this.slashes.push({ x, y, ang, arc, r, life, max: life, col, cs: sheathCol(col), w: w || 1 }); },
  // молния: ломаная с ответвлениями; прорастает от источника за 30 мс и потрескивает (перестраивается каждые 45 мс).
  // o.d — задержка появления (цепь видимо перескакивает), o.fk — число ответвлений
  lightning(x1, y1, x2, y2, col, w, life, jag, o) {
    if (this.arcs.length > 220) return;
    const a = { x1, y1, x2, y2, col, cs: sheathCol(col), w: w || 2, life: life || 0.16, max: life || 0.16, j: jag || 9, d: (o && o.d) || 0, t: 0, rt: o && o.still ? 1e9 : 0.045, gr: (o && o.grow) || 0.03, fk: o && o.fk !== undefined ? o.fk : 1, pts: null, fp: null };
    this.zag(a); this.arcs.push(a);
  },
  zag(a) {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, n = Math.max(2, Math.ceil(len / 15));
    const nx = -dy / len, ny = dx / len, pts = [a.x1, a.y1];
    for (let i = 1; i < n; i++) { const q = i / n, off = rand(-a.j, a.j) * Math.sin(q * Math.PI); pts.push(a.x1 + dx * q + nx * off, a.y1 + dy * q + ny * off); }
    pts.push(a.x2, a.y2);
    a.pts = pts; a.fp = [];
    if (len > 50) for (let k = 0; k < a.fk; k++) {
      const i = 1 + ((Math.random() * (n - 1)) | 0), bx = pts[i * 2], by = pts[i * 2 + 1];
      const an = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * rand(0.45, 0.95), L = Math.min(60, len * rand(0.18, 0.3)), fp = [bx, by];
      for (let s = 1; s <= 3; s++) fp.push(bx + Math.cos(an) * L * s / 3 + rand(-3, 3), by + Math.sin(an) * L * s / 3 + rand(-3, 3));
      a.fp.push(fp);
    }
  },
  // раскалённый разлом в полу: тёмная щель, внутри остывающая лава (белое → оранжевое → тёмно-красное); рисуется под врагами
  crack(x1, y1, x2, y2, col, life, d) {
    if (this.cracks.length > 60) return;
    const a = { x1, y1, x2, y2, j: 7, fk: 2, life, max: life, t: 0, d: d || 0, col };
    this.zag(a); this.cracks.push(a);
  },
  // отложенный вызов (вспышки попаданий по цепи приходят вместе с разрядом)
  later(d, fn) { if (d <= 0) fn(); else if (this.timers.length < 300) this.timers.push({ d, fn }); },
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
      if (p.k === 5) { p.vz -= 900 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; p.vr *= 0.6; } }
      else if (p.k === 6) { p.vz *= Math.exp(-2.2 * dt); p.z += p.vz * dt; }
    }
    const tick = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) removeAt(arr, i); } };
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      if (a.d > 0) { a.d -= dt; continue; }
      a.t += dt; a.life -= dt;
      if (a.life <= 0) { removeAt(this.arcs, i); continue; }
      a.rt -= dt; if (a.rt <= 0) { a.rt = 0.045; this.zag(a); }
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) { const a = this.cracks[i]; if (a.d > 0) { a.d -= dt; continue; } a.t += dt; a.life -= dt; if (a.life <= 0) removeAt(this.cracks, i); }
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.d -= dt; if (t.d <= 0) { removeAt(this.timers, i); t.fn(); } }
    tick(this.beams); tick(this.rings); tick(this.slashes); tick(this.ghosts); tick(this.lights); tick(this.flashes);
    if (this.speedT > 0) this.speedT -= dt;
    const T = this.texts;
    for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-3 * dt); if (t.life <= 0) removeAt(T, i); }
    this.shake *= Math.exp(-9 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
  },

  // свет на полу: вспышки подсвечивают сетку
  drawLights(c) {
    if (!this.lights.length) return;
    c.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const q = l.life / l.max;
      c.globalAlpha = l.a * q;
      c.drawImage(glowSprite(l.col), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  },
  // нормальное наложение: дым
  drawUnder(c) {
    if (this.cracks.length) {
      c.lineJoin = 'round'; c.lineCap = 'round';
      for (const a of this.cracks) {
        if (a.d > 0) continue;
        const q = a.life / a.max, g = Math.min(1, a.t / 0.16), P = a.pts, N = P.length / 2, last = (N - 1) * g, li = Math.floor(last);
        const path = () => {
          c.beginPath(); c.moveTo(P[0], P[1]);
          for (let i = 1; i <= li; i++) c.lineTo(P[i * 2], P[i * 2 + 1]);
          if (li < N - 1) { const f = last - li; c.lineTo(lerp(P[li * 2], P[li * 2 + 2], f), lerp(P[li * 2 + 1], P[li * 2 + 3], f)); }
          if (g >= 1) for (const fp of a.fp) { c.moveTo(fp[0], fp[1]); for (let i = 2; i < fp.length; i += 2) c.lineTo(fp[i], fp[i + 1]); }
        };
        path();
        c.globalAlpha = Math.min(1, q * 2) * 0.85; c.strokeStyle = '#05070c'; c.lineWidth = 3.2; c.stroke();
        c.globalCompositeOperation = 'lighter';
        const hot = clamp((q - 0.55) / 0.45, 0, 1);
        c.globalAlpha = Math.min(1, q * 1.6); c.strokeStyle = mixHex('#8a1d0a', a.col, Math.min(1, q * 1.5)); c.lineWidth = 1.5; c.stroke();
        if (hot > 0) { c.globalAlpha = hot; c.strokeStyle = '#ffe9b0'; c.lineWidth = 0.7; c.stroke(); }
        c.globalCompositeOperation = 'source-over';
      }
      c.globalAlpha = 1; c.lineCap = 'butt';
    }
    for (const p of this.parts) {
      if (p.k === 3) {
        const a = clamp(p.life / p.max, 0, 1) * (p.soft ? 0.32 : 0.5);
        if (p.soft) { c.globalAlpha = a; c.drawImage(smokeSprite(), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2); continue; }
        c.globalAlpha = a; c.fillStyle = p.col;
        c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1;
  },
  // аддитивное свечение
  drawGlow(c, viewScale) {
    const cp = vfxCp();
    // дым догорающих клубов и раскалённые обломки — обычным наложением
    let cs = null;
    for (const p of this.parts) {
      if (p.k === 6) {
        const q = p.life / p.max, s = p.size, y = p.y - p.z * cp;
        if (q < 0.6) { c.globalAlpha = Math.min(1, q / 0.6) * 0.45; const s2 = s * 1.15; c.drawImage(smokeSprite(), p.x - s2, y - s2, s2 * 2, s2 * 2); }
        if (q > 0.3) { c.globalAlpha = Math.min(1, (q - 0.3) / 0.3); c.drawImage(fireSprite(p.col), p.x - s, y - upY(s), s * 2, upY(s * 2)); }
      } else if (p.k === 5) {
        if (!cs) cs = chunkSprites();
        c.globalAlpha = Math.min(1, p.life / p.max * 2.5);
        vfxDraw(c, cs, Math.floor(p.rot), p.x, p.y - p.z * cp, p.size);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      if (p.k === 6) {
        const q = p.life / p.max;
        if (q > 0.65) { c.globalAlpha = (q - 0.65) / 0.35 * 0.55; const s = p.size * 1.3; c.drawImage(dotSprite(mixHex('#ffd36b', p.col, 0.3)), p.x - s, p.y - p.z * cp - s, s * 2, s * 2); }
      }
    }
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
    // осколки контура
    for (const arr of B.values()) arr.length = 0;
    for (const p of this.parts) {
      if (p.k !== 4) continue;
      const q = Math.min(3, (clamp(p.life / p.max, 0, 1) * 4) | 0), key = 's' + p.col + q;
      let arr = B.get(key);
      if (!arr) { arr = []; arr.col = p.col; arr.q = q; B.set(key, arr); }
      arr.push(p);
    }
    c.lineWidth = 1.4;
    for (const [key, arr] of B) {
      if (!arr.length || key[0] !== 's') continue;
      c.globalAlpha = (arr.q + 1) / 4; c.strokeStyle = arr.col;
      c.beginPath();
      for (const p of arr) { const dx = Math.cos(p.rot) * p.size, dy = Math.sin(p.rot) * p.size; c.moveTo(p.x - dx, p.y - dy); c.lineTo(p.x + dx, p.y + dy); }
      c.stroke();
    }
    for (const r of this.rings) {
      const q = 1 - r.life / r.max, rad = lerp(r.r0, r.r1, ease.outCubic(q));
      c.globalAlpha = (1 - q) * 0.9;
      c.strokeStyle = r.col; c.lineWidth = r.w * (1 - q * 0.6);
      c.beginPath();
      if (r.hex) { for (let i = 0; i <= 6; i++) { const a = r.rot + i * TAU / 6 + q * 0.6, px = r.x + Math.cos(a) * rad, py = r.y + Math.sin(a) * rad; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); }
      else if (r.ell) { const sp = floorRy(); c.ellipse(r.x, r.y, Math.max(0.1, rad), Math.max(0.1, rad * sp), 0, 0, TAU); c.stroke(); if (!r.thin) { c.globalAlpha *= 0.35; c.lineWidth *= 3.5; c.stroke(); } }
      else { c.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU); c.stroke(); }
    }
    for (const f of this.flashes) {
      const q = 1 - f.life / f.max, s = f.size * (q < 0.3 ? 0.55 + q / 0.3 * 0.45 : 1 - (q - 0.3) * 0.85);
      c.save(); c.translate(f.x, f.y); c.rotate(f.ang); c.globalAlpha = 1 - q * 0.7;
      c.fillStyle = rgba(f.col, 0.9);
      c.beginPath(); c.moveTo(s * 2.6, 0); c.lineTo(0, s * 0.4); c.lineTo(-s * 0.55, 0); c.lineTo(0, -s * 0.4); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(0, s * 1.05); c.lineTo(s * 0.28, 0); c.lineTo(0, -s * 1.05); c.lineTo(-s * 0.28, 0); c.closePath(); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(s * 1.4, 0); c.lineTo(0, s * 0.18); c.lineTo(-s * 0.3, 0); c.lineTo(0, -s * 0.18); c.closePath(); c.fill();
      c.restore();
    }
    for (const b of this.beams) {
      const q = b.life / b.max;
      c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2);
      if (b.helix) {
        // рельса: тонкое раскалённое ядро, цветная оболочка, мягкий ореол
        c.globalAlpha = q * 0.12; c.strokeStyle = b.col; c.lineWidth = b.w * 1.5; c.stroke();
        c.globalAlpha = q * 0.7; c.lineWidth = b.w * (0.28 + q * 0.3); c.stroke();
        c.globalAlpha = q; c.strokeStyle = '#ffffff'; c.lineWidth = b.w * 0.16 * (0.4 + q * 0.6); c.stroke();
      } else {
        c.globalAlpha = q;
        c.strokeStyle = b.cs || b.col; c.lineWidth = b.w * (0.4 + q * 0.6) * 2.2; c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = b.w * q * 0.7; c.stroke();
      }
      if (b.helix) {
        const dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        const amp = b.w * (0.4 + (1 - q) * 0.35), N = Math.min(140, Math.ceil(L / 6)), ph = b.ph + (1 - q) * 9;
        for (const off of [0, Math.PI]) {
          c.beginPath();
          for (let i = 0; i <= N; i++) { const t = i / N, d = L * t, o = Math.sin(d * 0.09 + ph + off) * amp; const px = b.x1 + ux * d + nx * o, py = b.y1 + uy * d + ny * o; i ? c.lineTo(px, py) : c.moveTo(px, py); }
          c.strokeStyle = off ? '#ffffff' : b.col; c.globalAlpha = q * (off ? 0.55 : 0.8); c.lineWidth = 1.3; c.stroke();
        }
        c.globalAlpha = q * 0.5; c.strokeStyle = b.col; c.lineWidth = 1.2;
        const sp = vfxSp(), rr = b.w * (0.8 + (1 - q) * 1.6);
        for (let k = 1; k <= 3; k++) { const d = L * k / 7, px = b.x1 + ux * d, py = b.y1 + uy * d; c.beginPath(); c.ellipse(px, py, rr * 0.4, rr * 0.85, Math.atan2(uy, ux), 0, TAU); c.stroke(); }
      }
    }
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const a of this.arcs) {
      if (a.d > 0) continue;
      const q = a.life / a.max, al = Math.min(1, q * 2), g = Math.min(1, a.t / a.gr), P = a.pts, N = P.length / 2;
      const last = (N - 1) * g, li = Math.floor(last);
      c.beginPath(); c.moveTo(P[0], P[1]);
      for (let i = 1; i <= li; i++) c.lineTo(P[i * 2], P[i * 2 + 1]);
      if (li < N - 1) { const f = last - li; c.lineTo(lerp(P[li * 2], P[li * 2 + 2], f), lerp(P[li * 2 + 1], P[li * 2 + 3], f)); }
      c.globalAlpha = al; c.strokeStyle = a.cs; c.lineWidth = a.w * 1.6; c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = a.w * 0.6; c.stroke();
      if (g >= 1 && a.fp.length) {
        c.beginPath();
        for (const fp of a.fp) { c.moveTo(fp[0], fp[1]); for (let i = 2; i < fp.length; i += 2) c.lineTo(fp[i], fp[i + 1]); }
        c.globalAlpha = al * 0.85; c.strokeStyle = a.cs; c.lineWidth = a.w * 0.75; c.stroke();
      }
    }
    c.lineCap = 'butt';
    // взмах клинка: чёткий серп — кромка из сегментов (хвост тусклый, голова яркая), три тонкие дуги-«скорости»
    // внутри, едва заметное тело серпа и световая кромка-лезвие на голове взмаха
    c.lineCap = 'round';
    for (const s of this.slashes) {
      const q = 1 - s.life / s.max, fade = 1 - q;
      const a0 = s.ang - s.arc / 2, sweep = s.arc * ease.outCubic(Math.min(1, q * 1.6)), ae = a0 + sweep, w = s.w || 1;
      c.globalAlpha = 0.08 * fade; c.fillStyle = s.cs;
      c.beginPath(); c.arc(s.x, s.y, s.r, a0, ae); c.arc(s.x, s.y, s.r * 0.55, ae, a0, true); c.closePath(); c.fill();
      const N = 8;
      c.strokeStyle = s.cs; c.lineWidth = 2 * w;
      for (let i = 0; i < N; i++) { c.globalAlpha = fade * (i + 1) / N; c.beginPath(); c.arc(s.x, s.y, s.r, a0 + sweep * i / N, a0 + sweep * (i + 1) / N + 0.01); c.stroke(); }
      c.strokeStyle = mixHex(s.col, '#ffffff', 0.4); c.lineWidth = 0.8;
      for (let k = 0; k < 3; k++) { const rr = s.r * (0.64 + k * 0.11), st = a0 + sweep * (0.35 + k * 0.12); if (ae > st) { c.globalAlpha = 0.5 * fade; c.beginPath(); c.arc(s.x, s.y, rr, st, ae); c.stroke(); } }
      if (q < 0.75) {
        const ex = Math.cos(ae), ey = Math.sin(ae);
        c.beginPath(); c.moveTo(s.x + ex * s.r * 0.5, s.y + ey * s.r * 0.5); c.lineTo(s.x + ex * s.r * 1.03, s.y + ey * s.r * 1.03);
        c.globalAlpha = fade; c.strokeStyle = s.cs; c.lineWidth = 3 * w; c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = 1.2 * w; c.stroke();
      }
    }
    c.lineCap = 'butt';
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
