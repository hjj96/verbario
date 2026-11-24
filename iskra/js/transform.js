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

// экранная точка модели относительно центра робота (единицы мира)
function projPt(L, view, pitch, p) {
  const k = robotK(L, view), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { x: p[0] * k, y: (-p[1] * sp - (p[2] - ZC) * cp) * k };
}

/* ===== Механика деталей: сборка, разборка, взрыв-схема ===== */
function primCounts(m, sel) { const n = {}; for (const pr of m.prims) if (sel(pr)) n[pr.key] = (n[pr.key] || 0) + 1; return n; }
// вертикальная ось корпуса (между грудью и спиной) — от неё разлетаются детали
function bodyAxis(m) { const a = m.pa.core, b = m.pa.back; return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : [0, 0]; }
// откуда деталь прилетает и куда улетает: руки — от плечевого шарнира, голова — вверх, шасси — вниз, генератор — назад
function primOrigin(m, pr) {
  const A = bodyAxis(m);
  if (pr.g === 'arms') return m.pa[pr.side > 0 ? 'jR' : 'jL'] || [A[0], A[1], 28];
  if (pr.slot) return [A[0], A[1], pr.c[2] - 2];
  if (pr.g === 'head') return [A[0], A[1], 29];
  if (pr.g === 'legs') return [A[0], A[1], 19];
  if (pr.g === 'back') return m.pa.core || [A[0], A[1], pr.c[2]];
  return [A[0], A[1], pr.c[2]];
}
function primDir(m, pr, h1, h2) {
  const og = primOrigin(m, pr);
  let dx = pr.c[0] - og[0], dy = pr.c[1] - og[1], dz = pr.c[2] - og[2];
  if (Math.hypot(dx, dy, dz) < 1.2) { dx = h1 - 0.5; dy = h2 - 0.5; dz = 0.5; }
  const l = Math.hypot(dx, dy, dz);
  return [dx / l, dy / l, dz / l];
}
// сборка: детали по очереди прилетают, кувыркаясь, проскакивают место и защёлкиваются (outBack)
function asmPrim(m, pr, N, t, o) {
  const p = (t - (N > 1 ? pr.k / (N - 1) * o.span : 0)) / o.fly;
  if (p <= 0) return PRIM_HIDE;
  if (p >= 1) return null;
  const sd = o.seed || 1, h1 = hsh(pr.k + 1, sd), h2 = hsh(pr.k + 7, sd + 3), h3 = hsh(pr.k + 13, sd + 5);
  const u = primDir(m, pr, h1, h2), D = o.dist * (0.7 + h3 * 0.6), r = 1 - ease.outBack(p);
  const spin = (1 - ease.outCubic(p)) * (2.2 + h1 * 2.6) * (h2 < 0.5 ? -1 : 1);
  return { m: animMat(pr.c, u[0] * D * r, u[1] * D * r, (u[2] * D + 6) * r, h2 - 0.5, h3 - 0.5, h1 + 0.2, spin, 0.7 + 0.3 * Math.min(1, ease.outCubic(p))), al: Math.min(1, p * 2.5), nodec: true };
}
// разборка: внешние детали отлетают первыми, кувыркаются, падают и гаснут
function disPrim(m, pr, N, t, o) {
  const p = (t - (N > 1 ? (1 - pr.k / (N - 1)) * o.span : 0)) / o.fly;
  if (p <= 0) return null;
  if (p >= 1) return PRIM_HIDE;
  const sd = (o.seed || 1) + 11, h1 = hsh(pr.k + 1, sd), h2 = hsh(pr.k + 7, sd + 3), h3 = hsh(pr.k + 13, sd + 5);
  const u = primDir(m, pr, h1, h2), D = o.dist * (0.8 + h3 * 0.8), e = ease.outCubic(p);
  const spin = p * (3 + h1 * 4) * (h2 < 0.5 ? -1 : 1);
  return { m: animMat(pr.c, u[0] * D * e, u[1] * D * e, u[2] * D * e + 9 * e - 30 * p * p, h2 - 0.5, h1 - 0.5, h3 + 0.1, spin, 1 - 0.3 * p), al: 1 - ease.inQuad(p), nodec: true };
}
function asmAnim(sel, t, o) {
  return m => { const cnt = primCounts(m, sel); m.animate(pr => (sel(pr) ? asmPrim(m, pr, cnt[pr.key], t, o) : null), d => (sel(d) && t < o.span + o.fly ? PRIM_HIDE : null)); };
}
function disAnim(sel, t, o) {
  return m => { const cnt = primCounts(m, sel); m.animate(pr => (sel(pr) ? disPrim(m, pr, cnt[pr.key], t, o) : null), d => (sel(d) && t > 0 ? PRIM_HIDE : null)); };
}
// расписание защёлкиваний (для искр и щелчков): момент первого касания места — p≈0,4 у outBack
function lockPlan(m, sel, t0, o) {
  const cnt = primCounts(m, sel), out = [];
  for (const pr of m.prims) if (sel(pr)) { const N = cnt[pr.key]; out.push({ t: t0 + (N > 1 ? pr.k / (N - 1) * o.span : 0) + o.fly * 0.4, p: pr.c }); }
  return out.sort((a, b) => a.t - b.t);
}
function fireLocks(S, subj, L, view, pitch, t0, t1, col) {
  if (!S.locks) return;
  let n = 0;
  for (const lk of S.locks) {
    if (lk.t <= t0 || lk.t > t1) continue;
    const q = projPt(L, view, pitch, lk.p);
    FX.sparks(subj.x + q.x, subj.y + q.y, 3, col || '#bff6ff', 140, undefined, 0, 0.25);
    if (n++ < 1 && !S.silent) AUDIO.sfx('clank');
  }
}
// взрыв-схема: все детали расходятся от оси корпуса (дальние — дальше), out собирает линии сборки
function explodeAnim(E, out) {
  return m => {
    if (E <= 0.002) return;
    const A = bodyAxis(m), cz = ZC + (m.lift || 0);
    const off = c => { const dx = c[0] - A[0], dy = c[1] - A[1], dz = (c[2] - cz) * 0.9, l = Math.hypot(dx, dy, dz) || 1, D = E * (4 + l * 0.6); return [dx / l * D, dy / l * D, dz / l * D]; };
    m.animate(pr => {
      const v = off(pr.c), h = hsh(pr.k + 3, pr.v0 % 89);
      if (out) out.push([pr.c, [pr.c[0] + v[0], pr.c[1] + v[1], pr.c[2] + v[2]], pr.g]);
      return { m: animMat(pr.c, v[0], v[1], v[2], h - 0.5, 0.5 - h, 1, E * 0.3 * (h - 0.5), 1) };
    }, d => { const ref = d.c || d.p || d.a; if (!ref) return null; const v = off(ref); return m3t(v[0], v[1], v[2]); });
  };
}
// линии сборки и номера позиций спецификации поверх взрыв-схемы
function drawExplode(c, L, view, pitch, lines, a) {
  if (!lines || !lines.length || a <= 0.01) return;
  const T = c.getTransform(), px = (VIEW.dpr || 1) / Math.max(0.02, Math.hypot(T.a, T.b));
  c.save(); c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba('#46e3ff', 0.42 * a); c.lineWidth = px; c.setLineDash([3 * px, 3 * px]);
  c.beginPath();
  const grp = {};
  for (const [p0, p1, g] of lines) {
    const q0 = projPt(L, view, pitch, p0), q1 = projPt(L, view, pitch, p1);
    if (Math.hypot(q1.x - q0.x, q1.y - q0.y) > 3) { c.moveTo(q0.x, q0.y); c.lineTo(q1.x, q1.y); }
    const G = grp[g] || (grp[g] = { x: 0, y: 0, n: 0 }); G.x += q1.x; G.y += q1.y; G.n++;
  }
  c.stroke(); c.setLineDash([]);
  c.font = '700 ' + (8 * px).toFixed(2) + 'px "JetBrains Mono", monospace'; c.textBaseline = 'middle';
  PART_ORDER.forEach((k, i) => {
    const G = grp[k]; if (!G) return;
    const x = G.x / G.n, y = G.y / G.n, r = 6.5 * px, lx = x + (x >= 0 ? 16 : -16) * px, ly = y - 12 * px;
    c.strokeStyle = rgba('#7fd8ff', 0.8 * a); c.lineWidth = 0.9 * px;
    c.beginPath(); c.moveTo(x, y); c.lineTo(lx, ly); c.stroke();
    c.beginPath(); c.arc(lx, ly, r, 0, TAU); c.stroke();
    c.fillStyle = rgba('#eaf6ff', a); c.textAlign = 'center'; c.fillText(String(i + 1), lx, ly + 0.5 * px);
    c.textAlign = x >= 0 ? 'left' : 'right'; c.fillStyle = rgba('#9fdcff', 0.85 * a);
    c.fillText(PARTS[k].code, lx + (x >= 0 ? 1 : -1) * (r + 3 * px), ly + 0.5 * px);
  });
  c.restore();
}

/* --- Трансформация модуля: робот разворачивается к камере, старый модуль разлетается на детали, новый собирается по одной --- */
function seqPart(subj, part, rank, branch, opts) {
  opts = opts || {};
  const turn = !opts.fast && !opts.ambient;
  const sel = pr => pr.g === part;
  const S = {
    dur: opts.fast ? 1.35 : 2.1, blocking: !opts.ambient, subj, kind: 'part', silent: !!opts.silent,
    voAt(t) {
      if (!turn) return svo(subj);
      const q = ease.inOutCubic(seg(t, 0, this.t0)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.55, this.dur)));
      const o = svo(subj, turnTo(subj, SHOW_YAW[part], q));
      if (o.view !== 'top') o.pitch = VIEW_PITCH.front - 0.1 * q;
      return o;
    },
    init() {
      this.old = cloneLook(subj.look);
      this.nl = cloneLook(subj.look);
      this.nl.parts[part] = { rank, branch: branch || this.nl.parts[part].branch };
      const T = subj.time ? subj.time() : 0, fast = !!opts.fast;
      this.t0 = fast ? 0.1 : 0.42;
      this.dis = { t0: this.t0, span: fast ? 0.12 : 0.22, fly: fast ? 0.4 : 0.55, dist: 22, seed: rank * 7 + 1 };
      this.asm = { t0: this.t0 + (fast ? 0.12 : 0.18), span: fast ? 0.45 : 0.55, fly: fast ? 0.3 : 0.34, dist: 20, seed: rank * 5 + 3 };
      this.tc = this.asm.t0 + this.asm.span + this.asm.fly + 0.03;
      this.vo = this.voAt(this.t0);
      const view = viewOf(this.vo), pitch = meshPitch(view, this.vo);
      const mn = buildRobot(this.nl, robotPose(this.nl, T, this.vo));
      this.locks = lockPlan(mn, sel, this.asm.t0, this.asm);
      const R = robotPoints(this.nl, T, this.vo, mn);
      this.anchor = R.pa[part] || { x: 0, y: 0, d: 0 };
      this.behind = this.anchor.d < (R.pa.core ? R.pa.core.d : 0);
      this.view = view; this.pitch = pitch;
      const br = this.nl.parts[part].branch;
      this.code = PARTS[part].code + ' · МК-' + ROMAN[rank] + (rank >= 3 && br ? ' · ' + PARTS[part].branches[br].name.toUpperCase() : '');
      this.committed = false; this.prevT = 0;
      if (!opts.silent) AUDIO.sfx('tfStart');
      if (opts.onStart) opts.onStart();
    },
    update(dt) {
      const t = this.t, t0 = this.t0;
      if (t > t0 && !this.sparked) {
        this.sparked = true;
        FX.sparks(subj.x + this.anchor.x, subj.y + upY(this.anchor.y), 14, '#ffd36b', 260, undefined, 0, 0.5);
        FX.shards(subj.x + this.anchor.x, subj.y + upY(this.anchor.y), 8, '#eaf6ff', 160);
        if (!opts.silent) AUDIO.sfx('swing');
      }
      fireLocks(this, subj, this.nl, this.view, this.pitch, this.prevT, t);
      this.prevT = t;
      if (!this.committed && t >= this.tc) {
        this.committed = true;
        subj.look.parts[part] = { rank: this.nl.parts[part].rank, branch: this.nl.parts[part].branch };
        refreshLook(subj.look);
        const ax = subj.x + this.anchor.x, ay = subj.y + upY(this.anchor.y);
        FX.ring(ax, ay, 6, 90, 0.45, '#46e3ff', 3);
        FX.ring(subj.x, subj.y, 10, 130, 0.55, '#eaf6ff', 2);
        FX.burst(ax, ay, 16, PARTS[part].color, 200, 0.6, 7);
        FX.light(subj.x, subj.y, 160, '#46e3ff', 0.5);
        if (!opts.ambient) FX.impact = 2;
        if (!opts.silent) AUDIO.sfx('tfBoom');
        if (opts.onCommit) opts.onCommit();
      }
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
      const an = opts.fast ? partAnchor(this.committed ? subj.look : this.nl, part, vo) : this.anchor;
      if (this.committed) {
        drawRobot(c, subj.look, T, vo);
        const q = seg(t, this.tc, this.tc + 0.35);
        if (q < 1) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = (1 - q) * 0.9; drawRobot(c, subj.look, T, Object.assign({}, vo, { only: part })); c.restore(); }
        callout(c, an.x, an.y, this.code, lab);
        return;
      }
      // старый модуль разлетается (позади корпуса — до него), новый собирается прямо на роботе
      const td = t - this.dis.t0, dis = () => { if (td < this.dis.span + this.dis.fly) drawRobot(c, this.old, T, Object.assign({}, vo, { only: part, anim: disAnim(sel, td, this.dis) })); };
      if (this.behind) dis();
      drawRobot(c, this.nl, T, Object.assign({}, vo, { anim: asmAnim(sel, t - this.asm.t0, this.asm) }));
      if (!this.behind) dis();
      callout(c, an.x, an.y, this.code, lab);
    },
  };
  return S;
}

/* --- Монтаж орудия: робот поворачивается слотом к камере, рука отлетает, кувыркаясь, модуль собирается по деталям, рука встаёт на место --- */
function seqMount(subj, w, opts) {
  opts = opts || {};
  const evoTo = opts.evo || null, slot = w.slot;
  const selM = pr => pr.slot === slot;
  return {
    dur: evoTo ? 1.8 : 1.55, blocking: true, subj, kind: 'mount',
    voAt(t) {
      const q = ease.inOutCubic(seg(t, 0, 0.3)) * (1 - ease.inOutCubic(seg(t, this.dur - 0.4, this.dur)));
      const o = svo(subj, turnTo(subj, SLOT_YAW[slot] || Math.PI / 2, q));
      if (o.view !== 'top') o.pitch = VIEW_PITCH.front - 0.08 * q;
      return o;
    },
    init() {
      this.host = slotHost(slot);
      this.arm = !!this.host.armSide;
      this.vo = this.voAt(0.3);
      const T = subj.time ? subj.time() : 0;
      w.hidden = false;
      const m = buildRobot(subj.look, robotPose(subj.look, T, this.vo));
      const R = robotPoints(subj.look, T, this.vo, m);
      const an = R.an[slot] || R.pa.core || { x: 0, y: 0 };
      this.slotW = { x: an.x, y: an.y };
      this.slot3 = m.anchors[slot] ? m.anchors[slot].p : [0, 0, ZC];
      this.view = R.view; this.pitch = meshPitch(R.view, this.vo);
      if (this.arm) {
        // рука отлетает наружу и вверх, кувыркаясь вокруг горизонтальной оси
        const j = m.pa[this.host.armSide > 0 ? 'jR' : 'jL'] || [0, 0, 30], A = bodyAxis(m);
        let ox = j[0] - A[0], oy = j[1] - A[1]; const l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l;
        this.joint = j; this.out = [ox * 15, oy * 15, 9]; this.tumble = [oy, -ox, 0.25];
      }
      this.asm = { t0: evoTo ? 0.66 : 0.3, span: 0.45, fly: 0.3, dist: 16, seed: 9 };
      this.dis = { t0: 0.28, span: 0.15, fly: 0.4, dist: 18, seed: 4 };
      this.locks = lockPlan(m, selM, this.asm.t0, this.asm);
      this.code = (w.evo || evoTo ? 'ЭВО · ' : wcode(baseOf(w)) + ' · ') + ((evoTo ? EVOS[evoTo] : weaponDef(w)).name).toUpperCase();
      this.proxyOld = Object.assign({}, w, { hidden: false });
      this.proxyNew = evoTo ? Object.assign({}, w, { id: evoTo, evo: true, hidden: false, st: {} }) : this.proxyOld;
      w.hidden = true; this.done = false; this.prevT = 0;
      AUDIO.sfx(evoTo ? 'evolve' : 'tfStart');
      if (opts.onStart) opts.onStart();
    },
    // доля «рука отделена»: 0 — на месте, 1 — в полёте
    armK() { const t = this.t; return ease.outCubic(seg(t, 0.14, 0.42)) * (1 - ease.outBack(seg(t, this.dur - 0.55, this.dur - 0.32))); },
    armMat(k) { const o = this.out; return animMat(this.joint, o[0] * k, o[1] * k, o[2] * k, this.tumble[0], this.tumble[1], this.tumble[2], k * TAU * 0.8 * (this.host.armSide || 1), 1); },
    update(dt) {
      const t = this.t;
      if (this.arm) fireLocks(this, subj, subj.look, this.view, this.pitch, this.prevT, t, '#eaf6ff');
      else fireLocks(this, subj, subj.look, this.view, this.pitch, this.prevT, t);
      if (this.arm && this.locks) for (const lk of this.locks) if (lk.t > this.prevT && lk.t <= t) { /* искры выше — в точках без учёта полёта руки */ }
      this.prevT = t;
      if (!this.done && t >= this.dur - 0.32) {
        this.done = true;
        w.hidden = false;
        const x = subj.x + this.slotW.x, y = subj.y + upY(this.slotW.y);
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
      if (this.done) { drawRobot(c, L, T, vo); callout(c, this.slotW.x, this.slotW.y, this.code, 1 - seg(t, this.dur - 0.2, this.dur)); return; }
      const oldPhase = evoTo && t < this.asm.t0;
      const proxy = oldPhase ? this.proxyOld : this.proxyNew;
      const mounts = (subj.weapons || []).map(x => (x === w ? proxy : x));
      const k = this.arm ? this.armK() : 0, AM = this.arm && k > 0.001 ? this.armMat(k) : null, side = this.host.armSide;
      const ta = t - this.asm.t0, td = t - this.dis.t0;
      const anim = m => {
        const cnt = primCounts(m, selM);
        m.animate(pr => {
          let A = null;
          if (pr.slot === slot) {
            A = oldPhase ? (td > 0 ? disPrim(m, pr, cnt[pr.key], td, this.dis) : null) : asmPrim(m, pr, cnt[pr.key], ta, this.asm);
            if (A === PRIM_HIDE) return A;
          }
          if (AM && pr.g === 'arms' && pr.side === side) return A ? Object.assign({}, A, { m: A.m ? m3mul(AM, A.m) : AM }) : { m: AM };
          return A;
        }, d => {
          if (d.slot === slot && (oldPhase ? td > 0 : ta < this.asm.span + this.asm.fly)) return PRIM_HIDE;
          if (AM && d.g === 'arms' && d.side === side) return AM;
          return null;
        });
      };
      drawRobot(c, L, T, Object.assign({}, vo, { mounts, anim }));
      // выноска следует за модулем
      const p3 = AM ? m3ap(AM, this.slot3) : this.slot3, q = projPt(L, this.view, meshPitch(this.view, vo), p3);
      callout(c, q.x, q.y, this.code, seg(t, 0.25, 0.55));
    },
  };
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
    // полный оборот вокруг оси (разгон к вспышке, торможение после) и камера снизу — «геройский» ракурс
    voAt(t) {
      const q = ease.inOutCubic(seg(t, 0.2, 2.7)) * TAU;
      const a0 = subj.aim !== undefined ? subj.aim : Math.PI / 2, h0 = subj.hd !== undefined ? subj.hd : a0;
      const o = svo(subj, { aim: a0 + q, hd: h0 + q });
      const hero = ease.outCubic(seg(t, 0.1, 0.8)) * (1 - ease.inOutCubic(seg(t, 2.3, 3.0)));
      o.pitch = lerp(VIEW_PITCH[o.view === 'top' ? 'top' : 'front'], o.view === 'top' ? 0.8 : 0.24, hero);
      return o;
    },
    // раскрытие взрыв-схемы: старая форма расходится и схлопывается во вспышку, новая — защёлкивается с отскоком
    explodeAt(t) {
      if (t < 1.6) return 1.05 * ease.outCubic(seg(t, 0.25, 1.15)) * (1 - ease.inCubic(seg(t, 1.3, 1.6)));
      return 0.55 * (1 - ease.outBack(seg(t, 1.62, 2.45)));
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
    zoom() { const t = this.t; return 1 + 0.75 * ease.outCubic(seg(t, 0, 0.5)) * (1 - ease.inOutCubic(seg(t, 2.45, 3.1))); },
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
      const vo = this.voAt(t), L = this.done ? subj.look : this.old, view = viewOf(vo);
      const wa = this.done ? 1 - ease.outCubic(seg(t, 1.6, 2.3)) : ease.inCubic(seg(t, 0.7, 1.6));
      if (!this.done) c.translate(t > 1.1 ? rand(-1, 1) * seg(t, 1.1, 1.6) * 1.6 : 0, 0);
      const E = this.explodeAt(t), lines = E > 0.05 ? [] : null;
      const m = drawRobot(c, L, T, Object.assign({}, vo, { anim: explodeAnim(E, lines) }));
      if (lines) drawExplode(c, L, view, vo.pitch, lines, clamp(E * 1.4, 0, 1) * (1 - wa * 0.7));
      if (wa > 0.01) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= wa; drawRobot(c, L, T, Object.assign({}, vo, { flat: '#ffffff', mesh: m })); c.restore(); }
      c.restore();
    },
  };
}

/* --- Овердрайв --- */
// насколько разошлись бронеплиты в овердрайве (пульсирует)
function odOpen(t) { return 0.11 + 0.025 * Math.sin(t * 9); }
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
    // бронеплиты расходятся, открывая раскалённое нутро; в овердрайве робот так и остаётся «раскрытым»
    drawSubject(c, T) {
      const t = this.t, sh = t < 0.55 ? rand(-1, 1) * 1.2 : 0;
      const E = t < 0.55 ? 0.05 * seg(t, 0.1, 0.55) : odOpen(T) + 0.22 * (1 - ease.outBack(seg(t, 0.55, 0.85)));
      c.save(); c.translate(sh, 0);
      drawRobot(c, subj.look, T, Object.assign(svo(subj), { anim: explodeAnim(E) }));
      c.restore();
    },
  };
}
