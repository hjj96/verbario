'use strict';
/* ===== Анимации трансформации: разборка/сборка модулей, смена формы, овердрайв, эволюция ===== */

class Transformer {
  constructor() { this.cur = null; this.queue = []; }
  push(seq) { if (this.cur) this.queue.push(seq); else this.begin(seq); }
  begin(seq) { this.cur = seq; seq.t = 0; if (seq.init) seq.init(); }
  update(dt) {
    const s = this.cur;
    if (!s) return;
    s.t += dt;
    if (s.update) s.update(dt);
    if (s.t >= s.dur) {
      if (s.finish) s.finish();
      this.cur = null;
      if (this.queue.length) this.begin(this.queue.shift());
    }
  }
  clear() { this.cur = null; this.queue.length = 0; }
  get busy() { return !!this.cur || this.queue.length > 0; }
  get blocking() { return !!(this.cur && this.cur.blocking); }
  zoom() { return this.cur && this.cur.zoom ? this.cur.zoom() : 1; }
  dim() { return this.cur && this.cur.dim ? this.cur.dim() : 0; }
  lift() { return this.cur && this.cur.lift ? this.cur.lift() : 0; }
}

function robotSnapshot(L, t) {
  const ext = 50 * L.scale, px = Math.ceil(ext * 2 * 2);
  const cv = makeCanvas(px, px), c = cv.getContext('2d');
  c.translate(px / 2, px / 2 + 4 * 2 * L.scale); c.scale(2, 2);
  drawRobot(c, L, t, { static: true });
  return { cv, ext, res: 2, oy: 4 * L.scale };
}
function drawSnap(c, snap, img, alpha, comp) {
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  c.globalAlpha *= alpha;
  c.drawImage(img || snap.cv, -snap.ext, -snap.ext - snap.oy, snap.ext * 2, snap.ext * 2);
  c.restore();
}

/* --- Трансформация модуля --- */
function seqPart(subj, part, rank, branch, opts) {
  opts = opts || {};
  const S = {
    dur: opts.fast ? 1.25 : 1.75, blocking: !opts.ambient, subj,
    init() {
      this.old = cloneLook(subj.look);
      this.nl = cloneLook(subj.look);
      this.nl.parts[part] = { rank, branch: branch || this.nl.parts[part].branch };
      const T = subj.time ? subj.time() : 0;
      this.oSnap = partSnapshot(this.old, part, T);
      this.nSnap = partSnapshot(this.nl, part, T);
      this.oTiles = snapTiles(this.oSnap, 7);
      this.nTiles = snapTiles(this.nSnap, 7);
      this.holo = hologram(this.nSnap.cv);
      const sc = this.old.scale;
      for (const tl of this.oTiles) {
        const a = Math.atan2(tl.hy + 2, tl.hx) + rand(-0.6, 0.6), s = rand(70, 170) * sc;
        tl.vx = Math.cos(a) * s; tl.vy = Math.sin(a) * s - 30; tl.vr = rand(-9, 9);
      }
      for (const tl of this.nTiles) {
        const a = rand(0, TAU), d = rand(45, 95) * sc;
        tl.sx0 = tl.hx + Math.cos(a) * d; tl.sy0 = tl.hy + Math.sin(a) * d;
        tl.rot0 = rand(-3, 3); tl.d = rand(0, 0.28); tl.done = false;
        tl.x = tl.sx0; tl.y = tl.sy0;
      }
      this.committed = false;
      this.t0 = opts.fast ? 0.12 : 0.25;
      if (!opts.silent) AUDIO.sfx('tfStart');
      if (opts.onStart) opts.onStart();
    },
    update(dt) {
      const t = this.t, t0 = this.t0;
      if (t > t0) {
        for (const tl of this.oTiles) { tl.x += tl.vx * dt; tl.y += tl.vy * dt; tl.vx *= Math.exp(-2.2 * dt); tl.vy *= Math.exp(-2.2 * dt); tl.rot += tl.vr * dt; }
        if (!this.sparked) {
          this.sparked = true;
          FX.sparks(subj.x, subj.y - 6, 18, '#ffd36b', 260, undefined, 0, 0.5);
          FX.burst(subj.x, subj.y - 6, 8, '#46e3ff', 120, 0.5, 6);
        }
      }
      const a0 = t0 + 0.45;
      for (const tl of this.nTiles) {
        const q = seg(t, a0 + tl.d, a0 + tl.d + 0.38);
        const e = ease.outBack(q);
        tl.x = lerp(tl.sx0, tl.hx, e); tl.y = lerp(tl.sy0, tl.hy, e); tl.rot = lerp(tl.rot0, 0, ease.outCubic(q));
        if (q >= 1 && !tl.done) {
          tl.done = true;
          if (Math.random() < 0.35) FX.sparks(subj.x + tl.hx, subj.y + tl.hy, 3, '#bff6ff', 140, undefined, 0, 0.25);
          if (!opts.silent) AUDIO.sfx('clank');
        }
      }
      const tc = a0 + 0.7;
      if (!this.committed && t >= tc) {
        this.committed = true;
        subj.look.parts[part] = { rank: this.nl.parts[part].rank, branch: this.nl.parts[part].branch };
        refreshLook(subj.look);
        FX.ring(subj.x, subj.y, 10, 120, 0.5, '#46e3ff', 4);
        FX.ring(subj.x, subj.y, 5, 70, 0.35, '#ffffff', 2);
        FX.burst(subj.x, subj.y - 6, 16, PARTS[part].color, 200, 0.6, 7);
        if (!opts.silent) AUDIO.sfx('tfBoom');
        if (opts.onCommit) opts.onCommit();
      }
      this.tc = tc;
    },
    finish() { if (!this.committed) { subj.look.parts[part] = this.nl.parts[part]; refreshLook(subj.look); if (opts.onCommit) opts.onCommit(); } if (opts.onEnd) opts.onEnd(); },
    zoom() {
      if (opts.ambient) return 1;
      const t = this.t;
      return 1 + 1.05 * ease.outCubic(seg(t, 0, this.t0 + 0.05)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.45, this.dur)));
    },
    dim() { return opts.ambient ? 0 : 0.55 * seg(this.t, 0, 0.2) * (1 - seg(this.t, this.dur - 0.4, this.dur)); },
    drawSubject(c, T) {
      const t = this.t, t0 = this.t0;
      if (t < t0) {
        drawRobot(c, this.old, T, { static: true });
        scanLine(c, this.old, t / t0);
        return;
      }
      if (this.committed) {
        drawRobot(c, subj.look, T, { static: true });
        const q = seg(t, this.tc, this.tc + 0.35);
        if (q < 1) { const w = silhouette(this.nSnap.cv, '#ffffff'); drawSnap(c, this.nSnap, w, (1 - q) * 0.9, 'lighter'); }
        return;
      }
      const behind = part === 'back' || part === 'legs';
      const tilesDraw = () => {
        const fa = 1 - seg(t, t0 + 0.1, t0 + 0.55);
        if (fa > 0) for (const tl of this.oTiles) drawTile(c, this.oSnap, tl, fa);
        const hf = seg(t, t0 + 0.12, t0 + 0.3) * (0.75 + Math.sin(t * 40) * 0.2);
        if (hf > 0) drawSnap(c, this.nSnap, this.holo, hf, 'lighter');
        for (const tl of this.nTiles) { const q = seg(t, t0 + 0.45 + tl.d, t0 + 0.45 + tl.d + 0.12); if (q > 0) drawTile(c, this.nSnap, tl, q); }
      };
      if (behind) tilesDraw();
      drawRobot(c, this.old, T, { static: true, skip: part });
      if (!behind) tilesDraw();
    },
  };
  return S;
}
function hologram(cv) {
  const h = silhouette(cv, '#46e3ff'), c = h.getContext('2d');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = 'rgba(0,0,0,0.75)';
  for (let y = 0; y < h.height; y += 4) c.fillRect(0, y, h.width, 2);
  const e = silhouette(cv, '#e8fbff'), out = makeCanvas(cv.width, cv.height), o = out.getContext('2d');
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) o.drawImage(e, dx, dy);
  o.globalCompositeOperation = 'destination-out'; o.drawImage(cv, 0, 0);
  o.globalCompositeOperation = 'source-over'; o.drawImage(h, 0, 0);
  return out;
}
function drawTile(c, snap, tl, a) {
  c.save();
  c.globalAlpha *= a;
  c.translate(tl.x, tl.y); c.rotate(tl.rot);
  const s = tl.size;
  c.drawImage(snap.cv, tl.sx, tl.sy, tl.sw, tl.sh, -s / 2, -s / 2, s + 0.05, s + 0.05);
  c.restore();
}
function scanLine(c, L, q) {
  const top = -40 * L.scale, bot = 30 * L.scale, y = lerp(top, bot, q);
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createLinearGradient(0, y - 6, 0, y + 6);
  g.addColorStop(0, 'rgba(70,227,255,0)'); g.addColorStop(0.5, 'rgba(160,245,255,0.8)'); g.addColorStop(1, 'rgba(70,227,255,0)');
  c.fillStyle = g; c.fillRect(-34 * L.scale, y - 6, 68 * L.scale, 12);
  c.restore();
}

/* --- Смена формы --- */
function seqForm(subj, newForm, opts) {
  opts = opts || {};
  return {
    dur: 3.1, blocking: true, subj,
    init() {
      this.old = cloneLook(subj.look);
      this.nl = cloneLook(subj.look); this.nl.form = newForm; refreshLook(this.nl);
      const T = subj.time ? subj.time() : 0;
      this.oSnap = robotSnapshot(this.old, T);
      this.oWhite = silhouette(this.oSnap.cv, '#ffffff');
      this.nSnap = robotSnapshot(this.nl, T);
      this.nWhite = silhouette(this.nSnap.cv, '#ffffff');
      this.done = false;
      if (!opts.silent) AUDIO.sfx('formUp');
      if (opts.onStart) opts.onStart();
    },
    update(dt) {
      const t = this.t;
      if (t > 0.3 && t < 1.6) {
        const n = Math.random() < 0.8 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const a = rand(0, TAU), d = rand(110, 190);
          const x = subj.x + Math.cos(a) * d, y = subj.y - 8 + Math.sin(a) * d;
          FX.dot(x, y, -Math.cos(a) * d * 1.6, -Math.sin(a) * d * 1.6, 0.55, rand(3, 6), pick(['#46e3ff', '#ffd36b', '#ff4f9a', '#ffffff']), 0.2);
        }
        if (Math.random() < 0.25) FX.lightning(subj.x + rand(-60, 60), subj.y - 90, subj.x + rand(-10, 10), subj.y - 10 - this.lift(), '#bff6ff', 1.6, 0.12, 12);
        FX.addShake(0.35);
      }
      if (!this.done && t >= 1.6) {
        this.done = true;
        subj.look.form = newForm; refreshLook(subj.look);
        FX.flash('#ffffff', 1);
        FX.addShake(14);
        FX.ring(subj.x, subj.y, 20, 420, 0.9, '#ffffff', 8);
        FX.ring(subj.x, subj.y, 10, 300, 0.7, '#ffd36b', 5);
        FX.ring(subj.x, subj.y, 5, 200, 0.5, '#46e3ff', 3);
        FX.burst(subj.x, subj.y - 8, 40, '#ffd36b', 380, 0.9, 8);
        FX.sparks(subj.x, subj.y - 8, 40, '#ffffff', 520, undefined, 0, 0.7);
        if (!opts.silent) AUDIO.sfx('formBoom');
        if (opts.onCommit) opts.onCommit();
      }
    },
    finish() { if (!this.done) { subj.look.form = newForm; refreshLook(subj.look); if (opts.onCommit) opts.onCommit(); } if (opts.onEnd) opts.onEnd(); },
    zoom() { const t = this.t; return 1 + 1.15 * ease.outCubic(seg(t, 0, 0.5)) * (1 - ease.inOutCubic(seg(t, 2.45, 3.1))); },
    dim() { return 0.8 * seg(this.t, 0, 0.4) * (1 - seg(this.t, 2.4, 3.0)); },
    lift() { const t = this.t; return 12 * ease.outCubic(seg(t, 0.1, 0.9)) * (1 - ease.inOutCubic(seg(t, 1.9, 2.8))); },
    drawSubject(c, T) {
      const t = this.t;
      c.save(); c.translate(0, -this.lift());
      if (t >= 0.3 && t < 1.6) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          c.save(); c.rotate(t * (1.5 + i) * (i % 2 ? -1 : 1));
          c.strokeStyle = rgba(['#46e3ff', '#ffd36b', '#ff4f9a'][i], 0.55 * seg(t, 0.3, 0.6));
          c.lineWidth = 2;
          c.beginPath(); c.ellipse(0, -6, 34 + i * 8, 12 + i * 3, 0, 0, TAU); c.stroke();
          c.restore();
        }
        c.restore();
      }
      if (!this.done) {
        const jit = t > 0.9 ? rand(-1, 1) * seg(t, 0.9, 1.6) * 1.6 : 0;
        c.translate(jit, 0);
        drawRobot(c, this.old, T, { static: true });
        drawSnap(c, this.oSnap, this.oWhite, ease.inCubic(seg(t, 0.5, 1.6)), 'lighter');
      } else {
        drawRobot(c, subj.look, T, { static: true });
        drawSnap(c, this.nSnap, this.nWhite, 1 - ease.outCubic(seg(t, 1.6, 2.3)), 'lighter');
      }
      c.restore();
    },
  };
}

/* --- Овердрайв --- */
function seqOverdrive(subj, opts) {
  opts = opts || {};
  return {
    dur: 0.85, blocking: true, subj,
    init() { AUDIO.sfx('od'); this.done = false; },
    update(dt) {
      const t = this.t;
      subj.look.od = ease.inOutCubic(seg(t, 0.1, 0.55)); refreshLook(subj.look);
      if (t < 0.5 && Math.random() < 0.7) {
        const a = rand(0, TAU), d = rand(60, 110);
        FX.dot(subj.x + Math.cos(a) * d, subj.y + Math.sin(a) * d, -Math.cos(a) * d * 2.4, -Math.sin(a) * d * 2.4, 0.4, 5, OD_COLOR, 0.2);
      }
      if (!this.done && t >= 0.55) {
        this.done = true;
        FX.flash(OD_COLOR, 0.45);
        FX.addShake(9);
        FX.ring(subj.x, subj.y, 10, 260, 0.6, OD_COLOR, 6);
        FX.ring(subj.x, subj.y, 10, 180, 0.45, '#ffd36b', 3);
        FX.sparks(subj.x, subj.y, 30, '#ffd36b', 420, undefined, 0, 0.5);
        if (opts.onCommit) opts.onCommit();
      }
    },
    finish() { subj.look.od = 1; refreshLook(subj.look); if (!this.done && opts.onCommit) opts.onCommit(); if (opts.onEnd) opts.onEnd(); },
    zoom() { const t = this.t; return 1 + 0.4 * ease.outCubic(seg(t, 0, 0.3)) * (1 - seg(t, 0.6, 0.85)); },
    dim() { return 0.35 * (1 - seg(this.t, 0.55, 0.85)); },
    drawSubject(c, T) {
      const sh = this.t < 0.55 ? rand(-1, 1) * 1.2 : 0;
      c.save(); c.translate(sh, 0);
      drawRobot(c, subj.look, T, { static: true });
      c.restore();
    },
  };
}

/* --- Эволюция орудия --- */
function seqEvolve(subj, evoId, opts) {
  opts = opts || {};
  const col = EVOS[evoId].color;
  return {
    dur: 1.5, blocking: true, subj,
    init() { AUDIO.sfx('evolve'); this.done = false; if (opts.onStart) opts.onStart(); },
    update(dt) {
      const t = this.t;
      if (t < 0.9 && Math.random() < 0.8) FX.dot(subj.x + rand(-40, 40), subj.y + rand(10, 40), 0, rand(-200, -120), 0.6, rand(3, 6), pick([col, '#ffd36b']), 0.5);
      if (!this.done && t >= 0.9) {
        this.done = true;
        FX.flash('#ffd36b', 0.5);
        FX.ring(subj.x, subj.y, 10, 300, 0.7, '#ffd36b', 6);
        FX.ring(subj.x, subj.y, 10, 200, 0.5, col, 4);
        FX.burst(subj.x, subj.y - 10, 30, col, 300, 0.8, 7);
        FX.addShake(8);
        if (opts.onCommit) opts.onCommit();
      }
    },
    finish() { if (!this.done && opts.onCommit) opts.onCommit(); if (opts.onEnd) opts.onEnd(); },
    zoom() { const t = this.t; return 1 + 0.55 * ease.outCubic(seg(t, 0, 0.3)) * (1 - ease.inOutCubic(seg(t, 1.1, 1.5))); },
    dim() { return 0.6 * seg(this.t, 0, 0.2) * (1 - seg(this.t, 1.1, 1.5)); },
    drawSubject(c, T) {
      const t = this.t;
      c.save(); c.globalCompositeOperation = 'lighter';
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + t * 0.8, len = 60 + 40 * Math.sin(t * 6 + i);
        c.strokeStyle = rgba(i % 2 ? col : '#ffd36b', 0.25 * seg(t, 0, 0.3) * (1 - seg(t, 1.1, 1.5)));
        c.lineWidth = 5;
        c.beginPath(); c.moveTo(Math.cos(a) * 16, -8 + Math.sin(a) * 16); c.lineTo(Math.cos(a) * len, -8 + Math.sin(a) * len); c.stroke();
      }
      c.restore();
      drawRobot(c, subj.look, T, { static: true, fire: 1 });
    },
  };
}
