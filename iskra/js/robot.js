'use strict';
/* ===== Робот: облик, палитра, поза и отрисовка 3D-модели (сама модель — в robot3d.js) ===== */

const ROBOT_BASE_SCALE = 1.12;
const OD_COLOR = '#ff4f9a';

function robotPalette(base, form, od) {
  const a = od > 0.5 ? mixHex(base.a, OD_COLOR, 0.65) : base.a;
  const tint = base.m;
  const line = form >= 4 ? '#fff4d6' : mixHex('#eaf6ff', tint, form >= 2 ? 0.08 : 0.16);
  const C = hexToRgb;
  return {
    // тона стекла: [в тени, на свету, непрозрачность] — грань смешивает их по освещённости
    T: {
      m: [C(mixHex('#050d1c', tint, 0.08)), C(mixHex('#20467c', tint, 0.22)), 0.95],
      l: [C(mixHex('#081730', tint, 0.1)), C(mixHex('#2d5d9c', tint, 0.26)), 0.96],
      d: [C('#030914'), C(mixHex('#12284a', tint, 0.12)), 0.97],
      r: [C('#02060e'), C('#0d1b32'), 0.98],
      a: [C(shade(a, -0.72)), C(shade(a, -0.25)), 0.92],
    },
    FS: null,
    ln: line, ls: mixHex(line, a, 0.6),
    a, ag: shade(a, 0.45), ad: shade(a, -0.35), e: od > 0.5 ? '#ffffff' : base.e,
    t: '#ffd36b', o: line,
  };
}
const _palCache = {};
function robotPaletteCached(base, form, od) {
  const key = base.a + base.m + base.e + '|' + form + '|' + (od > 0.5 ? 1 : 0);
  let p = _palCache[key];
  if (!p) { p = robotPalette(base, form, od); p.FS = fillSteps(p.T); _palCache[key] = p; }
  return p;
}

// готовые строки заливок: 16 ступеней освещённости на тон (без сборки строк на каждую грань)
function fillSteps(T) {
  const out = {};
  for (const k in T) {
    const [a0, a1, al] = T[k], arr = [];
    for (let i = 0; i < 16; i++) { const q = 0.15 + 0.85 * i / 15; arr.push('rgba(' + ((a0[0] + (a1[0] - a0[0]) * q) | 0) + ',' + ((a0[1] + (a1[1] - a0[1]) * q) | 0) + ',' + ((a0[2] + (a1[2] - a0[2]) * q) | 0) + ',' + al + ')'); }
    out[k] = arr;
  }
  return out;
}
function makeLook(robot, parts, form, od) {
  const f = form || 0;
  return {
    robot: robot.id, base: robot.pal, build: robot.build || 1,
    parts: {
      core: { rank: parts.core.rank, branch: parts.core.branch },
      legs: { rank: parts.legs.rank, branch: parts.legs.branch },
      arms: { rank: parts.arms.rank, branch: parts.arms.branch },
      head: { rank: parts.head.rank, branch: parts.head.branch },
      back: { rank: parts.back.rank, branch: parts.back.branch },
    },
    form: f, od: od || 0,
    pal: robotPaletteCached(robot.pal, f, od || 0),
    scale: FORMS[f].scale * (robot.build || 1) * ROBOT_BASE_SCALE,
  };
}
function cloneLook(L) { return makeLook({ id: L.robot, pal: L.base, build: L.build }, L.parts, L.form, L.od); }
function refreshLook(L) { L.pal = robotPaletteCached(L.base, L.form, L.od); L.scale = FORMS[L.form].scale * L.build * ROBOT_BASE_SCALE; }

/* --- 2D-примитивы (нужны врагам и спрайтам) --- */
function pathRR(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function pathPoly(c, p) {
  c.beginPath(); c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.closePath();
}
// состояние отрисовки: reveal — доля «вычерчивания» пером (анимации трансформации)
const RS = { reveal: 1 };

const _glowCache = {};
function glowSprite(col) {
  let g = _glowCache[col];
  if (g) return g;
  g = makeCanvas(64, 64);
  const x = g.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.25, rgba(col, 0.55)); gr.addColorStop(0.6, rgba(col, 0.15)); gr.addColorStop(1, rgba(col, 0));
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  _glowCache[col] = g;
  return g;
}
function glow(c, x, y, r, col, a) {
  if (r <= 0 || a <= 0) return;
  const pa = c.globalAlpha, pc = c.globalCompositeOperation;
  c.globalAlpha = pa * clamp(a, 0, 1);
  c.globalCompositeOperation = 'lighter';
  c.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  c.globalAlpha = pa; c.globalCompositeOperation = pc;
}

/* --- компоновка --- */
function robotLayout(L) {
  const P = L.parts, b = L.build || 1;
  const cr = P.core.rank, cb = P.core.branch;
  let tw;
  if (cr >= 3) tw = cb === 'A' ? 13.2 + (cr - 3) * 1.3 : 11.8 + (cr - 3) * 0.5;
  else tw = [9.5, 10.4, 11.3][cr];
  tw *= Math.sqrt(b);
  const lr = P.legs.rank, lb = P.legs.branch;
  const falcon = P.back.rank >= 3 && P.back.branch === 'C';
  return { tw, hover: (lr >= 3 && lb === 'B') || falcon, falcon, tread: lr >= 3 && lb === 'A', spider: lr >= 3 && lb === 'C' };
}
function viewOf(o) { return o && o.view === 'top' ? 'top' : 'front'; }
// экранный масштаб робота: единицы модели → единицы мира
function robotK(L, view) { return L.scale * VIEW_K[view === 'top' ? 'top' : 'front']; }

// ракурсы, в которых лучше всего виден модуль (экранный угол; π/2 — лицом к камере)
const SHOW_YAW = { head: Math.PI / 2 - 0.35, core: Math.PI / 2 + 0.3, arms: Math.PI / 2 - 0.75, legs: Math.PI / 2 + 0.6, back: Math.PI * 1.5 - 0.55 };
const SLOT_YAW = { armR: Math.PI / 2 - 0.6, armL: Math.PI / 2 + 0.6, shR: Math.PI / 2 - 0.45, shL: Math.PI / 2 + 0.45, back: Math.PI * 1.5 - 0.6, chest: Math.PI / 2 - 0.15 };

/* ===== Поза ===== */
// o: aim (курс корпуса), hd (курс ног), back (шагает задом), moving, wp (фаза шага), dist, static, mounts, siege, squash
function robotPose(L, t, o) {
  const st = !!o.static, yawU = o.aim !== undefined ? o.aim : Math.PI / 2;
  const bk = o.back ? -1 : 1;
  return {
    t: t || 0, static: st, mv: st ? 0 : (o.moving || 0), wp: (o.wp || 0) * bk, dist: (o.dist || 0) * bk,
    yawU, yawL: o.hd !== undefined ? o.hd : yawU,
    mounts: o.mounts || null, armed: o.armed !== false, siege: !!o.siege, squash: o.squash || 0,
    mvDir: o.mvDir, kick: st ? 0 : o.kick || 0, hurt: st ? 0 : o.hurt || 0, hitA: o.hitA, headYaw: o.headYaw || 0,
    breath: st ? 0 : (1 - (o.moving || 0)) * Math.sin((t || 0) * 2.3) * 0.35,
    mg: o.mg || null, mgF: o.mgF || null,
  };
}

/* ===== Главная функция ===== */
// o: view, aim, hd, only, armSide, skip, skipArmSide, onlyMounts, highlight, flat, mesh + параметры позы
function drawRobot(c, L, t, o) {
  o = o || {};
  const view = viewOf(o);
  let m = o.mesh;
  if (!m) { m = buildRobot(L, robotPose(L, t, o)); if (o.anim) o.anim(m); }
  const k = robotK(L, view);
  c.save();
  c.scale(k, k);
  if (!o.only && !o.onlyMounts && !o.flat) drawAura(c, L, t, o);
  renderMesh(c, m, L.pal, view, o);
  c.restore();
  return m;
}

// опорные точки модели на экране (относительно центра робота, в единицах мира)
function robotPoints(L, t, o, mesh) {
  o = o || {};
  const view = viewOf(o), m = mesh || buildRobot(L, robotPose(L, t, o));
  const k = robotK(L, view), f = meshPitch(view, o), sp = Math.sin(f), cp = Math.cos(f);
  const pr = p => ({ x: p[0] * k, y: (-p[1] * sp - (p[2] - ZC) * cp) * k, d: -p[1] * cp + p[2] * sp });
  const out = { pa: {}, an: {}, k, m, view };
  for (const n in m.pa) out.pa[n] = pr(m.pa[n]);
  for (const n in m.anchors) { const a = m.anchors[n], q = pr(a.p); q.dir = a.d; out.an[n] = q; }
  return out;
}
function partAnchor(L, part, o) {
  const R = robotPoints(L, 0, Object.assign({}, o || {}, { static: true }));
  return R.pa[part] || { x: 0, y: 0, d: 0 };
}
// высота точки касания земли на экране (для тени и полосы здоровья)
function feetY(L, view) { return ZC * Math.cos(VIEW_PITCH[view === 'top' ? 'top' : 'front']) * robotK(L, view); }

function drawAura(c, L, t, o) {
  const f = L.form, od = L.od || 0, pal = L.pal;
  const T = c.getTransform(), px = (typeof VIEW !== 'undefined' && VIEW.dpr ? VIEW.dpr : 1) / Math.max(0.02, Math.hypot(T.a, T.b));
  if (f >= 3) {
    const p = 0.75 + Math.sin(t * 2.4) * 0.25;
    glow(c, 0, -4, 32 + f * 3, f >= 4 ? '#fff2c2' : pal.t, 0.1 * p + (f >= 4 ? 0.05 : 0));
  }
  if (f >= 4) {
    // форма Ω: тонкое кольцо-нимб на полу вокруг робота
    const fy = feetY(L, viewOf(o)) / robotK(L, viewOf(o)), fl = Math.sin(VIEW_PITCH[viewOf(o)]);
    c.save(); c.globalCompositeOperation = 'lighter';
    c.strokeStyle = hsl(((t * 40) % 360) | 0, 100, 75, 0.35); c.lineWidth = 1.4 * px;
    c.beginPath(); c.ellipse(0, fy, 27, 27 * fl, 0, 0, TAU); c.stroke();
    c.restore();
  }
  if (od > 0) {
    const fl = 0.8 + Math.sin(t * 23) * 0.12 + Math.sin(t * 37) * 0.08;
    glow(c, 0, -4, 46 * fl * od, OD_COLOR, 0.42 * od);
    glow(c, 0, -12, 26 * fl * od, '#ffd36b', 0.3 * od);
  }
}

function silhouette(cv, col) {
  const s = makeCanvas(cv.width, cv.height);
  const c = s.getContext('2d');
  c.drawImage(cv, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = col; c.fillRect(0, 0, s.width, s.height);
  return s;
}

/* ===== Превью для интерфейса: робот на поворотном столе ===== */
function drawRobotPreview(cv, L, t, opt) {
  opt = opt || {};
  const c = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  // робот занимает ~85% высоты кадра при любом масштабе формы; центр — середина фигуры, а не пояс
  const k0 = robotK(L, 'front'), s = (opt.zoom || 1) * Math.min(w, h) / (58 * k0);
  c.translate(w / 2, h / 2);
  c.scale(s, s);
  c.translate(0, (3.5 + (opt.dy || 0)) * k0);
  let yaw = opt.yaw;
  if (yaw === undefined) {
    const base = opt.highlight ? SHOW_YAW[opt.highlight] : Math.PI / 2 - 0.5;
    yaw = !opt.anim ? base : opt.highlight ? base + Math.sin(t * 0.9) * 0.4 : base + t * 0.6;
  }
  const k = robotK(L, 'front'), fy = feetY(L, 'front');
  const g = c.createRadialGradient(0, fy, 0, 0, fy, 16 * k);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.beginPath(); c.ellipse(0, fy, 16 * k, 6.5 * k, 0, 0, TAU); c.fill();
  drawRobot(c, L, t, { static: !opt.anim, aim: yaw, hd: yaw, moving: opt.moving || 0, wp: t * 9, highlight: opt.highlight });
}
