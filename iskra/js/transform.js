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

function robotSnapshot(L, t, vo) {
  const ext = 54 * robotK(L, viewOf(vo)), px = Math.ceil(ext * 2 * 2);
  const cv = makeCanvas(px, px), c = cv.getContext('2d');
  c.translate(px / 2, px / 2); c.scale(2, 2);
  drawRobot(c, L, t, Object.assign({}, vo || {}, { static: true }));
  return { cv, ext, res: 2, oy: 0 };
}
// параметры отрисовки субъекта трансформации (проекция, прицел, модули)
function svo(subj, extra) {
  const o = { static: true, view: subj.view || 'front', aim: subj.aim !== undefined ? subj.aim : Math.PI / 2, hd: subj.hd !== undefined ? subj.hd : Math.PI / 2, mounts: subj.weapons || null };
  if (extra) for (const k in extra) o[k] = extra[k];
  return o;
}
function drawSnap(c, snap, img, alpha, comp) {
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  c.globalAlpha *= alpha;
  c.drawImage(img || snap.cv, -snap.ext, -snap.ext - snap.oy, snap.ext * 2, snap.ext * 2);
  c.restore();
}

// разворот субъекта к ракурсу показа и обратно: q — доля поворота (0…1)
function turnTo(subj, target, q) {
  const a0 = subj.aim !== undefined ? subj.aim : Math.PI / 2, h0 = subj.hd !== undefined ? subj.hd : a0;
  return { aim: a0 + angDiff(a0, target) * q, hd: h0 + angDiff(h0, target) * q };
}
function callout(c, ax, ay, text, q, col) {
  if (q <= 0) return;
  const T = c.getTransform(), s = (VIEW.dpr || 1) / Math.max(0.05, Math.hypot(T.a, T.b)) * 1.6;
  const bx = ax + 34 * s, by = ay - 34 * s, ex = bx + 74 * s;
  c.save();
  c.globalAlpha *= clamp(q, 0, 1);
  c.strokeStyle = col || '#7fd8ff'; c.lineWidth = 0.7 * s;
  c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(lerp(bx, ex, ease.outCubic(q)), by); c.stroke();
  c.beginPath(); c.arc(ax, ay, 1.6 * s, 0, TAU); c.fillStyle = col || '#7fd8ff'; c.fill();
  c.font = '700 ' + (6.5 * s).toFixed(2) + 'px "JetBrains Mono", monospace'; c.fillStyle = '#eaf6ff'; c.textBaseline = 'bottom';
  c.fillText(text.slice(0, Math.ceil(text.length * clamp(q * 1.4, 0, 1))), bx + 2 * s, by - 1.5 * s);
  c.restore();
}

/* --- Трансформация модуля: робот разворачивается к камере, старый модуль рассыпается, новый вычерчивается пером --- */
function seqPart(subj, part, rank, branch, opts) {
  opts = opts || {};
  const turn = !opts.fast && !opts.ambient;
  const S = {
    dur: opts.fast ? 1.3 : 2.0, blocking: !opts.ambient, subj, kind: 'part',
    voAt(t) {
      if (!turn) return svo(subj);
      const q = ease.inOutCubic(seg(t, 0, this.t0)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.55, this.dur)));
      return svo(subj, turnTo(subj, SHOW_YAW[part], q));
    },
    init() {
      this.old = cloneLook(subj.look);
      this.nl = cloneLook(subj.look);
      this.nl.parts[part] = { rank, branch: branch || this.nl.parts[part].branch };
      const T = subj.time ? subj.time() : 0;
      this.t0 = opts.fast ? 0.12 : 0.42;
      this.vo = this.voAt(this.t0);
      this.oSnap = partSnapshot(this.old, part, T, this.vo);
      this.oTiles = snapTiles(this.oSnap, 7);
      const sc = this.old.scale;
      for (const tl of this.oTiles) {
        const a = Math.atan2(tl.hy + 2, tl.hx) + rand(-0.6, 0.6), s = rand(70, 170) * sc;
        tl.vx = Math.cos(a) * s; tl.vy = Math.sin(a) * s - 30; tl.vr = rand(-9, 9);
      }
      const br = this.nl.parts[part].branch;
      this.code = PARTS[part].code + ' · МК-' + ROMAN[rank] + (rank >= 3 && br ? ' · ' + PARTS[part].branches[br].name.toUpperCase() : '');
      this.anchor = partAnchor(this.nl, part, this.vo);
      this.committed = false; this.clanks = 0;
      if (!opts.silent) AUDIO.sfx('tfStart');
      if (opts.onStart) opts.onStart();
    },
    update(dt) {
      const t = this.t, t0 = this.t0;
      if (t > t0) {
        for (const tl of this.oTiles) { tl.x += tl.vx * dt; tl.y += tl.vy * dt; tl.vx *= Math.exp(-2.2 * dt); tl.vy *= Math.exp(-2.2 * dt); tl.rot += tl.vr * dt; }
        if (!this.sparked) {
          this.sparked = true;
          FX.sparks(subj.x + this.anchor.x, subj.y + this.anchor.y, 16, '#ffd36b', 260, undefined, 0, 0.5);
          FX.shards(subj.x + this.anchor.x, subj.y + this.anchor.y, 10, '#eaf6ff', 160);
          if (!opts.silent) AUDIO.sfx('swing');
        }
      }
      const dq = seg(t, t0 + 0.12, t0 + 0.8);
      if (!opts.silent && dq > 0 && dq < 1 && this.clanks < Math.floor(dq * 4)) { this.clanks++; AUDIO.sfx('clank'); }
      const tc = t0 + 0.9;
      if (!this.committed && t >= tc) {
        this.committed = true;
        subj.look.parts[part] = { rank: this.nl.parts[part].rank, branch: this.nl.parts[part].branch };
        refreshLook(subj.look);
        const ax = subj.x + this.anchor.x, ay = subj.y + this.anchor.y;
        FX.ring(ax, ay, 6, 90, 0.45, '#46e3ff', 3);
        FX.ring(subj.x, subj.y, 10, 130, 0.55, '#eaf6ff', 2);
        FX.burst(ax, ay, 16, PARTS[part].color, 200, 0.6, 7);
        FX.light(subj.x, subj.y, 160, '#46e3ff', 0.5);
        if (!opts.ambient) FX.impact = 2;
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
    speed() { return opts.ambient ? 0 : seg(this.t, 0.05, 0.3) * (1 - seg(this.t, this.t0 + 0.6, this.t0 + 1.1)); },
    drawSubject(c, T) {
      const t = this.t, t0 = this.t0, vo = this.voAt(t);
      if (t < t0) {
        drawRobot(c, this.old, T, vo);
        scanLine(c, this.old, t / t0, vo);
        return;
      }
      const lab = seg(t, t0 + 0.1, t0 + 0.5) * (1 - seg(t, this.dur - 0.35, this.dur));
      const an = partAnchor(this.committed ? subj.look : this.nl, part, vo);
      if (this.committed) {
        drawRobot(c, subj.look, T, vo);
        const q = seg(t, this.tc, this.tc + 0.35);
        if (q < 1) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = (1 - q) * 0.9; drawRobot(c, subj.look, T, Object.assign({}, vo, { only: part })); c.restore(); }
        callout(c, an.x, an.y, this.code, lab);
        return;
      }
      const dq = seg(t, t0 + 0.12, t0 + 0.8);
      const fa = 1 - seg(t, t0 + 0.05, t0 + 0.5);
      // модуль позади корпуса (по глубине) рисуется до корпуса
      const behind = an.d < partAnchor(this.old, 'core', vo).d;
      const fresh = () => {
        if (fa > 0) for (const tl of this.oTiles) drawTile(c, this.oSnap, tl, fa);
        if (dq > 0) {
          RS.reveal = Math.max(0.002, dq);
          c.save(); c.globalCompositeOperation = 'lighter';
          drawRobot(c, this.nl, T, Object.assign({}, vo, { only: part }));
          c.restore();
          RS.reveal = 1;
        }
      };
      if (behind) fresh();
      drawRobot(c, this.old, T, Object.assign({}, vo, { skip: part }));
      if (!behind) fresh();
      callout(c, an.x, an.y, this.code, lab);
    },
  };
  return S;
}

/* --- Монтаж орудия: робот поворачивается слотом к камере, рука отделяется, вычерчивается пушкой и встаёт на место --- */
function seqMount(subj, w, opts) {
  opts = opts || {};
  const evoTo = opts.evo || null;
  return {
    dur: evoTo ? 1.75 : 1.5, blocking: true, subj, kind: 'mount',
    voAt(t) {
      const q = ease.inOutCubic(seg(t, 0, 0.3)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.4, this.dur)));
      return svo(subj, turnTo(subj, SLOT_YAW[w.slot] || Math.PI / 2, q));
    },
    init() {
      this.host = slotHost(w.slot);
      this.arm = !!this.host.armSide;
      this.vo = this.voAt(0.3);
      const T = subj.time ? subj.time() : 0;
      w.hidden = false;
      const R = robotPoints(subj.look, T, this.vo);
      const an = R.an[w.slot] || R.pa.core || { x: 0, y: 0 };
      this.slotW = { x: an.x, y: an.y };
      this.pivot = this.arm ? (R.pa[this.host.armSide > 0 ? 'jR' : 'jL'] || this.slotW) : this.slotW;
      const l = Math.hypot(this.slotW.x, this.slotW.y) || 1;
      this.dir = { x: this.slotW.x / l, y: this.slotW.y / l };
      this.code = (w.evo || evoTo ? 'ЭВО · ' : wcode(baseOf(w)) + ' · ') + ((evoTo ? EVOS[evoTo] : weaponDef(w)).name).toUpperCase();
      this.proxyOld = Object.assign({}, w, { hidden: false });
      this.proxyNew = evoTo ? Object.assign({}, w, { id: evoTo, evo: true, hidden: false, st: {} }) : this.proxyOld;
      w.hidden = true; this.done = false;
      AUDIO.sfx(evoTo ? 'evolve' : 'tfStart');
      if (opts.onStart) opts.onStart();
    },
    pose() {
      const t = this.t, out = ease.outCubic(seg(t, 0.14, 0.42)), back = ease.outBack(seg(t, this.dur - 0.55, this.dur - 0.32));
      const k = out * (1 - back), d = 24 * subj.look.scale;
      return { ox: this.dir.x * d * k, oy: this.dir.y * d * k - 12 * subj.look.scale * k, spin: k * TAU * (this.host.armSide || 1) * 0.75 };
    },
    update(dt) {
      const t = this.t;
      if (!this.done && t >= this.dur - 0.32) {
        this.done = true;
        w.hidden = false;
        const x = subj.x + this.slotW.x, y = subj.y + this.slotW.y;
        FX.ring(x, y, 4, 60, 0.35, evoTo ? '#ffd36b' : '#46e3ff', 3);
        FX.sparks(x, y, 14, '#eaf6ff', 260, undefined, 0, 0.4);
        FX.light(x, y, 120, evoTo ? '#ffd36b' : '#46e3ff', 0.6);
        FX.addShake(evoTo ? 8 : 4);
        if (evoTo) { FX.flash('#ffd36b', 0.45); FX.impact = 2; FX.ring(subj.x, subj.y, 10, 260, 0.7, '#ffd36b', 5); }
        AUDIO.sfx('clank'); AUDIO.sfx(evoTo ? 'tfBoom' : 'pick');
        if (opts.onCommit) opts.onCommit();
      }
    },
    finish() { w.hidden = false; if (!this.done && opts.onCommit) opts.onCommit(); if (opts.onEnd) opts.onEnd(); },
    zoom() { const t = this.t; return 1 + 0.85 * ease.outCubic(seg(t, 0, 0.2)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.25, this.dur))); },
    dim() { return 0.5 * seg(this.t, 0, 0.15) * (1 - seg(this.t, this.dur - 0.25, this.dur)); },
    speed() { return evoTo ? seg(this.t, 0.05, 0.3) * (1 - seg(this.t, 0.9, 1.3)) : 0; },
    drawSubject(c, T) {
      const t = this.t, vo = this.voAt(t), L = subj.look;
      if (evoTo) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + t * 0.8, len = 60 + 40 * Math.sin(t * 6 + i); c.strokeStyle = rgba(i % 2 ? EVOS[evoTo].color : '#ffd36b', 0.22 * seg(t, 0, 0.3) * (1 - seg(t, this.dur - 0.4, this.dur))); c.lineWidth = 4; c.beginPath(); c.moveTo(Math.cos(a) * 16, Math.sin(a) * 16); c.lineTo(Math.cos(a) * len, Math.sin(a) * len); c.stroke(); }
        c.restore();
      }
      const base = Object.assign({}, vo);
      if (!this.done && this.arm) base.skipArmSide = this.host.armSide;
      drawRobot(c, L, T, base);
      if (this.done) { callout(c, this.slotW.x, this.slotW.y, this.code, 1 - seg(t, this.dur - 0.2, this.dur)); return; }
      const p = this.pose();
      const half = evoTo ? 0.66 : 0.32;
      let proxy, rv;
      if (evoTo && t < half) { proxy = this.proxyOld; rv = 1 - seg(t, 0.32, half); }
      else { proxy = this.proxyNew; rv = seg(t, half, this.dur - 0.55); }
      proxy.reveal = Math.max(0.002, rv);
      c.save();
      c.translate(this.pivot.x + p.ox, this.pivot.y + p.oy); c.rotate(p.spin); c.translate(-this.pivot.x, -this.pivot.y);
      if (this.arm) drawRobot(c, L, T, Object.assign({}, vo, { only: 'arms', armSide: this.host.armSide, mounts: [proxy] }));
      else drawRobot(c, L, T, Object.assign({}, vo, { only: this.host.only, mounts: [proxy], onlyMounts: true }));
      c.restore();
      callout(c, this.pivot.x + p.ox, this.pivot.y + p.oy, this.code, seg(t, 0.25, 0.55));
    },
  };
}

function drawTile(c, snap, tl, a) {
  c.save();
  c.globalAlpha *= a;
  c.translate(tl.x, tl.y); c.rotate(tl.rot);
  const s = tl.size;
  c.drawImage(snap.cv, tl.sx, tl.sy, tl.sw, tl.sh, -s / 2, -s / 2, s + 0.05, s + 0.05);
  c.restore();
}
function scanLine(c, L, q, vo) {
  const k = robotK(L, viewOf(vo)), top = -30 * k, bot = feetY(L, viewOf(vo)) + 2 * k, y = lerp(top, bot, q);
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createLinearGradient(0, y - 6, 0, y + 6);
  g.addColorStop(0, 'rgba(70,227,255,0)'); g.addColorStop(0.5, 'rgba(160,245,255,0.8)'); g.addColorStop(1, 'rgba(70,227,255,0)');
  c.fillStyle = g; c.fillRect(-32 * k, y - 6, 64 * k, 12);
  c.restore();
}

/* --- Смена формы --- */
function seqForm(subj, newForm, opts) {
  opts = opts || {};
  return {
    dur: 3.1, blocking: true, subj, kind: 'form',
    // полный оборот вокруг оси: разгон к вспышке и торможение после
    voAt(t) {
      const q = ease.inOutCubic(seg(t, 0.2, 2.7)) * TAU;
      const a0 = subj.aim !== undefined ? subj.aim : Math.PI / 2, h0 = subj.hd !== undefined ? subj.hd : a0;
      return svo(subj, { aim: a0 + q, hd: h0 + q });
    },
    init() {
      this.old = cloneLook(subj.look);
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
        FX.impact = 3;
        FX.light(subj.x, subj.y, 420, '#ffd36b', 0.9);
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
    speed() { const t = this.t; return seg(t, 0.2, 0.6) * (1 - seg(t, 1.7, 2.4)) + (t > 1.55 && t < 1.75 ? 1 : 0); },
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
      const vo = this.voAt(t), L = this.done ? subj.look : this.old;
      const wa = this.done ? 1 - ease.outCubic(seg(t, 1.6, 2.3)) : ease.inCubic(seg(t, 0.5, 1.6));
      if (!this.done) c.translate(t > 0.9 ? rand(-1, 1) * seg(t, 0.9, 1.6) * 1.6 : 0, 0);
      const m = drawRobot(c, L, T, vo);
      if (wa > 0.01) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= wa; drawRobot(c, L, T, Object.assign({}, vo, { flat: '#ffffff', mesh: m })); c.restore(); }
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
      drawRobot(c, subj.look, T, svo(subj));
      c.restore();
    },
  };
}
