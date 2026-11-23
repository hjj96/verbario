'use strict';
/* ===== Процедурный робот: каждый модуль на каждом ранге и ветке рисуется по-своему ===== */

const ROBOT_BASE_SCALE = 1.12;
const OD_COLOR = '#ff4f9a';

function robotPalette(base, form, od) {
  const a = od > 0.5 ? mixHex(base.a, OD_COLOR, 0.65) : base.a;
  const tint = base.m;
  const line = form >= 4 ? '#fff4d6' : mixHex('#eaf6ff', tint, form >= 2 ? 0.08 : 0.16);
  return {
    // стекло корпуса (заливки) и контуры (линии чертежа)
    g: rgba(mixHex('#0b1b36', tint, 0.12), 0.95), gl: rgba(mixHex('#15305a', tint, 0.16), 0.96), gd: rgba(mixHex('#061226', tint, 0.08), 0.97), gdd: 'rgba(3,8,18,0.98)',
    ln: line, ls: mixHex(line, a, 0.6),
    m: mixHex('#16305a', tint, 0.2), ml: line, md: mixHex('#2a4c7a', tint, 0.2), mdd: '#071022',
    a, ag: shade(a, 0.45), ad: shade(a, -0.35), e: od > 0.5 ? '#ffffff' : base.e,
    t: '#ffd36b', o: line, rub: '#0a1222',
  };
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
    pal: robotPalette(robot.pal, f, od || 0),
    scale: FORMS[f].scale * (robot.build || 1) * ROBOT_BASE_SCALE,
  };
}
function cloneLook(L) {
  const n = makeLook({ id: L.robot, pal: L.base, build: L.build }, L.parts, L.form, L.od);
  return n;
}
function refreshLook(L) { L.pal = robotPalette(L.base, L.form, L.od); L.scale = FORMS[L.form].scale * L.build * ROBOT_BASE_SCALE; }

/* --- примитивы --- */
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
// состояние отрисовки: k — множитель толщины линий (≈1.4 css px на экране), reveal — «вычерчивание» пером
const RS = { k: 1, lw: 1.05, reveal: 1, dashL: 140 };
function strokeLine(c, col, w) {
  c.lineWidth = (w || 1.05) * RS.k; c.strokeStyle = col; c.lineJoin = 'round';
  if (RS.reveal < 1) { c.setLineDash([RS.reveal * RS.dashL, RS.dashL]); c.stroke(); c.setLineDash([]); }
  else c.stroke();
}
function fillMetal(c, pal, x0, y0, x1, y1, tone, noStroke) {
  const fa = RS.reveal >= 1 ? 1 : clamp((RS.reveal - 0.65) / 0.35, 0, 1);
  if (fa > 0) {
    if (fa < 1) c.globalAlpha *= fa;
    c.fillStyle = tone === 'l' ? pal.gl : tone === 'd' ? pal.gd : tone === 'r' ? pal.gdd : tone === 'a' ? pal.ad : pal.g;
    c.fill();
    if (fa < 1) c.globalAlpha /= fa;
  }
  if (!noStroke) strokeLine(c, tone === 'a' ? pal.ag : (tone === 'd' || tone === 'r') ? pal.ls : pal.ln, tone === 'd' || tone === 'r' ? 0.9 : 1.05);
}
function fillFlat(c, col, stroke) {
  if (RS.reveal >= 1) { c.fillStyle = col; c.fill(); }
  if (stroke) strokeLine(c, stroke, 0.9);
}

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
function limb(c, pal, x1, y1, x2, y2, w, tone) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  c.save(); c.translate(x1, y1); c.rotate(Math.atan2(dy, dx) - Math.PI / 2);
  pathRR(c, -w / 2, -w * 0.3, w, len + w * 0.6, w * 0.45);
  fillMetal(c, pal, -w / 2, 0, w / 2, 0, tone || 'm');
  c.restore();
}
function rivet(c, x, y, pal) { c.beginPath(); c.arc(x, y, 0.55, 0, TAU); c.fillStyle = pal.a; c.fill(); }
function lightLine(c, x1, y1, x2, y2, col, w, a) {
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= (a === undefined ? 1 : a);
  c.strokeStyle = col; c.lineWidth = w * RS.k; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.restore();
}

/* --- компоновка --- */
function robotLayout(L) {
  const P = L.parts, b = L.build || 1;
  const cr = P.core.rank, cb = P.core.branch;
  let tw;
  if (cr >= 3) tw = cb === 'A' ? 13.2 + (cr - 3) * 1.3 : 11.8 + (cr - 3) * 0.5;
  else tw = [9.5, 10.4, 11.3][cr];
  tw *= Math.sqrt(b);
  const tTop = cr >= 3 && cb === 'A' ? -12.5 : -11.5, tBot = 7.5;
  const lr = P.legs.rank, lb = P.legs.branch;
  return { tw, tTop, tBot, hipY: tBot + 1, shY: tTop + 4.5, headY: tTop - 6, hover: lr >= 3 && lb === 'B', tread: lr >= 3 && lb === 'A' };
}

/* ===== Главная функция ===== */
// o: only, skip, od, moving, wp (фаза шага), face, fire, siege, static, dist, hurt
function drawRobot(c, L, t, o) {
  o = o || {};
  if (o.view === 'top') return drawRobotTop(c, L, t, o);
  const ly = robotLayout(L);
  setLineScale(c, L.scale);
  const mv = o.moving || 0;
  let bob = 0;
  if (!o.static) bob = ly.hover ? -4 + Math.sin(t * 3.2) * 1.6 : -Math.abs(Math.sin(o.wp || 0)) * 1.3 * mv;
  c.save();
  c.scale(L.scale, L.scale);
  if (!o.static && mv > 0) c.rotate((o.face || 1) * 0.045 * mv);
  c.translate(0, bob);
  const part = (name, fn, layer) => { if (o.onlyMounts) return; if (o.only && o.only !== name) return; if (o.skip === name || (o.skip2 && o.skip2 === name)) return; fn(c, L, ly, t, o, layer); };
  if (!o.only && !o.onlyMounts) drawAura(c, L, ly, t, o);
  part('back', drawBack, 0);
  part('legs', drawLegs, 0);
  part('core', drawCore, 0);
  part('arms', drawArms, 0);
  part('core', drawCore, 1);
  part('head', drawHead, 0);
  if (!o.only && !o.onlyMounts) drawFormTrim(c, L, ly, t, o);
  if (o.mounts) drawMountsFront(c, L, ly, t, o);
  c.restore();
}
// толщина линий постоянна на экране: k = (желаемые css px) / (css px на единицу робота)
function setLineScale(c, sc) {
  const T = c.getTransform();
  const px = Math.hypot(T.a, T.b) * sc / (typeof VIEW !== 'undefined' && VIEW.dpr ? VIEW.dpr : 1);
  RS.k = clamp(1.45 / Math.max(0.2, px), 0.18, 1.5);
}

function drawAura(c, L, ly, t, o) {
  const f = L.form, od = L.od || 0, pal = L.pal;
  if (f >= 3) {
    const p = 0.75 + Math.sin(t * 2.4) * 0.25;
    glow(c, 0, -2, 34 + f * 3, f >= 4 ? '#fff2c2' : pal.t, 0.16 * p + (f >= 4 ? 0.08 : 0));
  }
  if (f >= 4) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = t * 0.6 + i * TAU / 8;
      c.strokeStyle = hsl(((t * 60 + i * 45) % 360) | 0, 100, 70, 0.16);
      c.lineWidth = 3 * RS.k;
      c.beginPath(); c.moveTo(Math.cos(a) * 14, -2 + Math.sin(a) * 14); c.lineTo(Math.cos(a) * 40, -2 + Math.sin(a) * 40); c.stroke();
    }
    c.restore();
  }
  if (od > 0) {
    const fl = 0.8 + Math.sin(t * 23) * 0.12 + Math.sin(t * 37) * 0.08;
    glow(c, 0, -4, 46 * fl * od, OD_COLOR, 0.42 * od);
    glow(c, 0, -10, 26 * fl * od, '#ffd36b', 0.3 * od);
  }
}

/* ----- Генератор (спина) ----- */
function drawBack(c, L, ly, t, o) {
  const p = L.parts.back, r = p.rank, br = p.branch, pal = L.pal, T = ly.tTop, od = L.od || 0;
  const y0 = T + 1;
  // базовый ранец
  pathRR(c, -8, y0 - 5, 16, 11, 2.5); fillMetal(c, pal, -8, y0 - 5, 8, y0 + 6, 'd');
  if (r === 0) {
    c.beginPath(); c.arc(0, y0 - 2, 2.6, 0, TAU); fillFlat(c, pal.mdd, pal.o);
    const s = t * 9;
    c.strokeStyle = pal.ml; c.lineWidth = 0.8 * RS.k;
    c.beginPath(); c.moveTo(Math.cos(s) * 2, y0 - 2 + Math.sin(s) * 2); c.lineTo(-Math.cos(s) * 2, y0 - 2 - Math.sin(s) * 2); c.stroke();
  }
  if (r >= 1 && r < 3) {
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      pathRR(c, s * (3 + i * 2.2) - 0.8, y0 - 9 + i * 1.2, 1.6, 6, 0.6); fillMetal(c, pal, 0, y0 - 9, 0, y0 - 3, 'm');
    }
  }
  if (r >= 2) {
    for (const s of [-1, 1]) {
      const x = s * (ly.tw - 2.5);
      pathRR(c, x - 2.6, y0 - 13, 5.2, 15, 2.4); fillMetal(c, pal, x - 2.6, 0, x + 2.6, 0, 'm');
      for (let k = 0; k < 2; k++) {
        const yy = y0 - 10 + k * 4.5;
        pathRR(c, x - 2.7, yy, 5.4, 1.6, 0.6); fillFlat(c, pal.a);
        glow(c, x, yy + 0.8, 4.5, pal.a, 0.5 + Math.sin(t * 4 + k + s) * 0.2);
      }
      c.beginPath(); c.ellipse(x, y0 - 13, 2.6, 1.1, 0, 0, TAU); fillFlat(c, pal.ml, pal.o);
    }
  }
  if (r >= 3 && br === 'A') drawWings(c, L, ly, t, o, r);
  if (r >= 3 && br === 'B') drawHaloGen(c, L, ly, t, o, r);
}
function drawWings(c, L, ly, t, o, r) {
  const pal = L.pal, T = ly.tTop, od = L.od || 0;
  const rows = r === 5 ? 3 : 1, feathers = r === 3 ? 3 : 5;
  const flap = Math.sin(t * (od > 0.5 ? 7 : 2.3)) * 0.09;
  const col = r === 5 ? mixHex(pal.a, '#ffffff', 0.25) : pal.a;
  for (const s of [-1, 1]) {
    for (let w = 0; w < rows; w++) {
      const ang = 0.38 + w * 0.42 + flap * (1 + w * 0.5) + od * 0.12;
      const len = (31 - w * 6) * (r >= 4 ? 1.1 : 1);
      const rx = s * 5.5, ry = T + 2 + w * 2;
      const dx = s * Math.cos(ang), dy = -Math.sin(ang);
      const tipX = rx + dx * len, tipY = ry + dy * len;
      // энергетическое полотно
      if (r >= 4) {
        c.save(); c.globalCompositeOperation = 'lighter';
        c.beginPath(); c.moveTo(rx, ry);
        for (let k = 1; k <= feathers; k++) {
          const q = k / feathers, px = rx + dx * len * q, py = ry + dy * len * q;
          c.lineTo(px + s * 2.5, py + 10 + q * 7);
        }
        c.lineTo(tipX, tipY); c.closePath();
        c.fillStyle = rgba(col, 0.2 + od * 0.15); c.fill(); c.restore();
      }
      // перья
      for (let k = 1; k <= feathers; k++) {
        const q = k / feathers, px = rx + dx * len * q, py = ry + dy * len * q;
        const fl = 7 + q * 9;
        pathPoly(c, [px - s * 1.2, py, px + s * 1.4, py - 0.6, px + s * 3.2, py + fl, px + s * 0.6, py + fl - 1.5]);
        fillMetal(c, pal, px, py, px, py + fl, w === 0 ? 'm' : 'l');
        lightLine(c, px + s * 1.4, py, px + s * 3, py + fl - 1, col, 0.9, 0.85);
      }
      // каркас
      c.lineCap = 'round';
      c.strokeStyle = pal.o; c.lineWidth = 3.2 * RS.k;
      c.beginPath(); c.moveTo(rx, ry); c.lineTo(tipX, tipY); c.stroke();
      c.strokeStyle = pal.ml; c.lineWidth = 1.8 * RS.k;
      c.beginPath(); c.moveTo(rx, ry); c.lineTo(tipX, tipY); c.stroke();
      glow(c, tipX, tipY, 6, col, 0.8);
    }
  }
}
function drawHaloGen(c, L, ly, t, o, r) {
  const pal = L.pal, T = ly.tTop, od = L.od || 0, cy = T + 2;
  const col = '#9dffcf';
  c.save(); c.globalCompositeOperation = 'lighter';
  const pulse = 0.8 + Math.sin(t * 3) * 0.2;
  c.strokeStyle = rgba(col, 0.85 * pulse); c.lineWidth = 2.2 * RS.k;
  c.beginPath(); c.arc(0, cy, 19 + od * 3, 0, TAU); c.stroke();
  c.strokeStyle = rgba('#ffffff', 0.5 * pulse); c.lineWidth = 0.8 * RS.k; c.stroke();
  if (r >= 4) {
    c.save(); c.translate(0, cy); c.rotate(t * 0.9);
    c.strokeStyle = rgba(col, 0.6); c.lineWidth = 1.6 * RS.k;
    c.beginPath(); c.ellipse(0, 0, 25, 8, 0, 0, TAU); c.stroke();
    c.rotate(-t * 1.8 + 1.2);
    c.beginPath(); c.ellipse(0, 0, 23, 6, 0, 0, TAU); c.stroke();
    c.restore();
  }
  c.restore();
  glow(c, 0, cy, 26, col, 0.22 * pulse);
  // катушки
  for (const s of [-1, 1]) {
    pathRR(c, s * 9 - 2, T - 9, 4, 10, 1.5); fillMetal(c, pal, 0, T - 9, 0, T + 1, 'd');
    for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(s * 9 - 2.2, T - 7 + k * 3); c.lineTo(s * 9 + 2.2, T - 6 + k * 3); c.strokeStyle = col; c.lineWidth = 0.9 * RS.k; c.stroke(); }
  }
  if (r >= 5) {
    for (let i = 0; i < 3; i++) {
      const a = t * 1.7 + i * TAU / 3;
      const x = Math.cos(a) * 27, y = cy + Math.sin(a) * 9;
      glow(c, x, y, 9, col, 0.9);
      c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fillStyle = '#ffffff'; c.fill();
      if (Math.sin(t * 13 + i * 2) > 0.3) {
        const a2 = a + TAU / 3, x2 = Math.cos(a2) * 27, y2 = cy + Math.sin(a2) * 9;
        lightLine(c, x, y, (x + x2) / 2 + rand(-4, 4), (y + y2) / 2 + rand(-4, 4), col, 0.9, 0.9);
      }
    }
  }
}

/* ----- Шасси ----- */
function drawLegs(c, L, ly, t, o) {
  const p = L.parts.legs, r = p.rank, br = p.branch;
  if (r >= 3 && br === 'A') return drawTreads(c, L, ly, t, o, r);
  if (r >= 3 && br === 'B') return drawJets(c, L, ly, t, o, r);
  const pal = L.pal, mv = o.moving || 0, wp = o.wp || 0, H = ly.hipY;
  for (const s of [-1, 1]) {
    const ph = wp + (s > 0 ? 0 : Math.PI);
    const lift = Math.max(0, Math.sin(ph)) * 3 * mv, sw = Math.cos(ph) * 1.3 * mv;
    const hx = s * 5.2, kx = s * 5.8 + sw * 0.5, ky = H + 7.5 - lift * 0.5, fx = s * 6.2 + sw, fy = H + 14.5 - lift;
    const w1 = [4.4, 5.4, 5.8][r], w2 = [3.8, 4.8, 5.2][r];
    if (r >= 2) { c.strokeStyle = pal.ml; c.lineWidth = 1 * RS.k; c.beginPath(); c.moveTo(hx + s * 3, H + 1); c.lineTo(fx + s * 2.8, fy - 3); c.stroke(); }
    limb(c, pal, hx, H, kx, ky, w1, 'm');
    limb(c, pal, kx, ky, fx, fy - 1, w2, 'd');
    if (r >= 2) { pathPoly(c, [hx - 3.3, H - 0.5, hx + 3.3, H - 0.5, kx + 2.4, ky - 2.5, kx - 2.4, ky - 2.5]); fillMetal(c, pal, hx, H, kx, ky, 'l'); }
    if (r >= 1) {
      c.beginPath(); c.arc(kx, ky, 2.5, 0, TAU); fillMetal(c, pal, kx - 2, ky - 2, kx + 2, ky + 2, 'd');
      c.beginPath(); c.arc(kx, ky, 0.9, 0, TAU); c.fillStyle = pal.a; c.fill();
    }
    const fw = [7.5, 9.5, 11][r], fh = [3.2, 3.8, 4.2][r];
    pathRR(c, fx - fw / 2 + s * 0.8, fy - 1.5, fw, fh, 1.3); fillMetal(c, pal, 0, fy - 1.5, 0, fy + fh, 'd');
    if (r >= 2) { pathRR(c, fx + s * 0.8 + (s > 0 ? fw / 2 - 3 : -fw / 2), fy - 1.2, 3, 2.2, 0.8); fillFlat(c, pal.a); }
  }
}
function drawTreads(c, L, ly, t, o, r) {
  const pal = L.pal, H = ly.hipY, w = 17 + (r - 3) * 1.2;
  pathPoly(c, [-8, H - 4, 8, H - 4, 10, H + 1, -10, H + 1]); fillMetal(c, pal, 0, H - 4, 0, H + 1, 'd');
  pathRR(c, -w, H, w * 2, 15, 7); fillMetal(c, pal, 0, H, 0, H + 15, 'r');
  // траки
  const off = ((o.dist || 0) * 0.35) % 4;
  c.strokeStyle = '#3a4150'; c.lineWidth = 1.2 * RS.k;
  c.beginPath();
  for (let x = -w + 5 + off; x < w - 4; x += 4) { c.moveTo(x, H + 0.8); c.lineTo(x, H + 2.6); c.moveTo(x, H + 12.4); c.lineTo(x, H + 14.2); }
  c.stroke();
  for (const x of [-w + 6.5, 0, w - 6.5]) {
    c.beginPath(); c.arc(x, H + 7.5, 4.4, 0, TAU); fillMetal(c, pal, x - 4, H + 3, x + 4, H + 12, 'm');
    c.beginPath(); c.arc(x, H + 7.5, 1.6, 0, TAU); c.fillStyle = pal.a; c.fill();
    const a = (o.dist || 0) * 0.08;
    c.strokeStyle = pal.md; c.lineWidth = 0.8 * RS.k;
    c.beginPath(); c.moveTo(x + Math.cos(a) * 3.5, H + 7.5 + Math.sin(a) * 3.5); c.lineTo(x - Math.cos(a) * 3.5, H + 7.5 - Math.sin(a) * 3.5); c.stroke();
  }
  if (r >= 4) {
    pathPoly(c, [-w - 1.5, H - 1, w + 1.5, H - 1, w + 0.5, H + 7, -w - 0.5, H + 7]); fillMetal(c, pal, 0, H - 1, 0, H + 7, 'm');
    pathRR(c, -w + 2, H + 2, w * 2 - 4, 1.4, 0.5); fillFlat(c, pal.a);
    for (let x = -w + 3; x <= w - 3; x += (w * 2 - 6) / 4) rivet(c, x, H + 5, pal);
  }
  if (r >= 5) {
    pathPoly(c, [-w - 3, H + 9, w + 3, H + 9, w - 1, H + 17.5, -w + 1, H + 17.5]);
    fillMetal(c, pal, 0, H + 9, 0, H + 17, 'l');
    c.save(); pathPoly(c, [-w - 3, H + 9, w + 3, H + 9, w - 1, H + 17.5, -w + 1, H + 17.5]); c.clip();
    c.fillStyle = '#ffd23f';
    for (let x = -w - 6; x < w + 6; x += 5) { pathPoly(c, [x, H + 18, x + 2.5, H + 18, x + 7.5, H + 8, x + 5, H + 8]); c.fill(); }
    c.restore();
    pathPoly(c, [-w - 3, H + 9, w + 3, H + 9, w - 1, H + 17.5, -w + 1, H + 17.5]); c.strokeStyle = pal.o; c.lineWidth = 1.1 * RS.k; c.stroke();
    for (const x of [-w + 2, 0, w - 2]) { pathPoly(c, [x - 2, H + 17, x + 2, H + 17, x, H + 21]); fillFlat(c, pal.ml, pal.o); }
  }
}
function drawJets(c, L, ly, t, o, r) {
  const pal = L.pal, H = ly.hipY, mv = o.moving || 0, od = L.od || 0;
  const flameCol = r >= 5 ? '#b38bff' : pal.a;
  for (const s of [-1, 1]) {
    const hx = s * 5.4, kx = s * 6.8, ky = H + 6.5;
    if (r >= 5) {
      // фазовые сегменты, парящие с зазорами
      const fl = Math.sin(t * 3 + s) * 0.8;
      pathRR(c, hx - 2.8, H - 0.5, 5.6, 6, 2); fillMetal(c, pal, hx - 3, 0, hx + 3, 0, 'm');
      pathRR(c, kx - 2.7, ky + 1 + fl, 5.4, 6.5, 2); fillMetal(c, pal, kx - 3, 0, kx + 3, 0, 'l');
      pathPoly(c, [kx - 3, ky + 9 + fl, kx + 3, ky + 9 + fl, kx + 4, ky + 12.5 + fl, kx - 4, ky + 12.5 + fl]); fillMetal(c, pal, 0, ky + 9, 0, ky + 13, 'd');
      for (let k = 0; k < 2; k++) {
        const pr = (t * 1.6 + k * 0.5) % 1;
        c.save(); c.globalCompositeOperation = 'lighter';
        c.strokeStyle = rgba(flameCol, (1 - pr) * 0.9); c.lineWidth = 1.2 * RS.k;
        c.beginPath(); c.ellipse(kx, ky + 14 + pr * 6 + fl, 4 + pr * 3, 1.3 + pr, 0, 0, TAU); c.stroke(); c.restore();
      }
      glow(c, kx, ky + 15 + fl, 8, flameCol, 0.8);
      continue;
    }
    limb(c, pal, hx, H, kx, ky, 5.6, 'm');
    pathPoly(c, [kx - 2.8, ky - 1, kx + 2.8, ky - 1, kx + 2.2, ky + 7, kx - 2.2, ky + 7]); fillMetal(c, pal, kx - 3, 0, kx + 3, 0, 'l');
    pathPoly(c, [kx - 2.4, ky + 7, kx + 2.4, ky + 7, kx + 3.6, ky + 10.5, kx - 3.6, ky + 10.5]); fillMetal(c, pal, 0, ky + 7, 0, ky + 10.5, 'd');
    // пламя
    const len = 6 + mv * 5 + Math.sin(t * 31 + s * 3) * 1.2 + od * 4;
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(0, ky + 10, 0, ky + 10 + len);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, rgba(flameCol, 0.85)); g.addColorStop(1, rgba(flameCol, 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(kx - 3, ky + 10.5); c.quadraticCurveTo(kx, ky + 10.5 + len * 1.3, kx + 3, ky + 10.5); c.fill();
    c.restore();
    glow(c, kx, ky + 12, 7, flameCol, 0.6);
    if (r >= 4) {
      const tx = s * 10.5, ty = H + 3.5;
      pathPoly(c, [tx - 1.6, ty - 2, tx + 1.6, ty - 2, tx + s * 2.6 + 1.2, ty + 3, tx + s * 2.6 - 1.2, ty + 3]); fillMetal(c, pal, tx - 2, ty, tx + 2, ty, 'd');
      const l2 = 3 + mv * 3 + Math.sin(t * 27 + s) * 0.8;
      lightLine(c, tx + s * 2.6, ty + 3.5, tx + s * (2.6 + l2 * 0.6), ty + 3.5 + l2, flameCol, 2, 0.8);
    }
  }
  if (r >= 5) {
    c.save(); c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba(flameCol, 0.35 + Math.sin(t * 4) * 0.15); c.lineWidth = 1.4 * RS.k;
    c.beginPath(); c.ellipse(0, H + 22, 15, 3.5, 0, 0, TAU); c.stroke(); c.restore();
  }
}

/* ----- Ядро (торс) ----- */
function drawCore(c, L, ly, t, o, layer) {
  const p = L.parts.core, r = p.rank, br = p.branch, pal = L.pal, tw = ly.tw, T = ly.tTop, B = ly.tBot, od = L.od || 0;
  if (layer === 1) {
    if (r >= 3 && br === 'A') {
      for (const s of [-1, 1]) {
        const x = s * (tw + 0.5), y = T + 4;
        c.beginPath(); c.ellipse(x, y, 7 + (r - 3), 5.5 + (r - 3) * 0.6, s * 0.25, Math.PI, TAU); c.closePath();
        fillMetal(c, pal, x, y - 6, x, y + 1, 'l');
        c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.strokeStyle = r >= 5 ? pal.t : pal.a; c.lineWidth = 1.1 * RS.k; c.stroke();
        if (r >= 4) for (let k = -1; k <= 1; k++) {
          const sx = x + k * 3.2 + s * 1, sy = y - 4.5 - (1 - Math.abs(k)) * 1.2;
          pathPoly(c, [sx - 1.3, sy + 1, sx + 1.3, sy + 1, sx + s * 0.6, sy - 3.8]); fillFlat(c, pal.ml, pal.o);
        }
      }
    }
    return;
  }
  // таз
  pathRR(c, -tw * 0.55, B - 3, tw * 1.1, 6, 2); fillMetal(c, pal, 0, B - 3, 0, B + 3, 'd');
  let rx = 0, ry = T + 7.2, rr = [2.5, 3, 3.6][Math.min(r, 2)], rc = pal.a;
  if (r >= 3 && br === 'A') {
    pathPoly(c, [-tw, T + 1, tw, T + 1, tw + 1.2, T + 8, tw * 0.74, B, -tw * 0.74, B, -tw - 1.2, T + 8]);
    fillMetal(c, pal, -tw, T, tw, B, 'm');
    const off = od * 1.6;
    if (od > 0) { pathRR(c, -2.5, T + 2, 5, B - T - 4, 1); fillFlat(c, OD_COLOR); glow(c, 0, (T + B) / 2, 12, OD_COLOR, od * 0.9); }
    for (const s of [-1, 1]) {
      const o2 = s * off;
      pathPoly(c, [s * (tw - 1.8) + o2, T + 2.5, s * 1.3 + o2, T + 2.5, s * 1.3 + o2, B - 3.5, s * tw * 0.58 + o2, B - 3.5, s * (tw - 0.8) + o2, T + 9]);
      fillMetal(c, pal, 0, T + 2, s * tw, B, 'l');
      rivet(c, s * (tw - 3.5) + o2, T + 4.2, pal); rivet(c, s * 3 + o2, B - 5, pal);
    }
    rr = 3.2; ry = T + 7.5;
    if (r >= 5) {
      const hy = (T + B) / 2 + 0.5;
      pathPoly(c, [0, hy - 5.5, 4.8, hy - 2.7, 4.8, hy + 2.7, 0, hy + 5.5, -4.8, hy + 2.7, -4.8, hy - 2.7]);
      fillMetal(c, pal, 0, hy - 5, 0, hy + 5, 'd');
      c.strokeStyle = pal.t; c.lineWidth = 1.1 * RS.k; c.stroke();
      rx = 0; ry = hy; rr = 2.6; rc = pal.t;
    }
  } else if (r >= 3 && br === 'B') {
    pathPoly(c, [-tw - 1, T, tw + 1, T, tw * 0.62, B, -tw * 0.62, B]);
    fillMetal(c, pal, -tw, T, tw, B, 'm');
    c.strokeStyle = pal.md; c.lineWidth = 1 * RS.k;
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(s * 5, T + 10 + k * 2.6); c.lineTo(s * (tw * 0.72 - k * 1.2), T + 8.5 + k * 2.8); c.stroke();
    }
    rr = 5 + (r - 3) * 1.1; ry = T + 7.8; rc = '#ff7a35';
    if (r >= 4) {
      for (const s of [-1, 1]) {
        lightLine(c, s * rr, ry, s * (tw - 1), T + 2, '#ffb36b', 1.2, 0.9);
        lightLine(c, s * rr * 0.6, ry + rr * 0.8, s * tw * 0.55, B - 1, '#ffb36b', 1, 0.7);
      }
    }
  } else {
    if (r === 0) pathRR(c, -tw, T, tw * 2, B - T, 3);
    else pathPoly(c, [-tw, T, tw, T, tw * 0.8, B, -tw * 0.8, B]);
    fillMetal(c, pal, -tw, T, tw, B, 'm');
    if (r >= 1) {
      pathRR(c, -tw * 0.62, T + 2.2, tw * 1.24, 9.6, 2.2); fillMetal(c, pal, 0, T + 2, 0, T + 12, 'l');
      rivet(c, -tw * 0.5, T + 3.4, pal); rivet(c, tw * 0.5, T + 3.4, pal);
    }
    if (r >= 2) {
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
        c.beginPath(); c.moveTo(s * (tw * 0.66), B - 6 + k * 1.6); c.lineTo(s * (tw * 0.86), B - 6.3 + k * 1.6);
        c.strokeStyle = pal.o; c.lineWidth = 0.8 * RS.k; c.stroke();
      }
    }
  }
  // реактор
  const pulse = 0.75 + Math.sin(t * 4.2) * 0.25 + od * 0.4;
  c.beginPath(); c.arc(rx, ry, rr + 1.4, 0, TAU); fillFlat(c, pal.mdd, pal.o);
  const g = c.createRadialGradient(rx - rr * 0.3, ry - rr * 0.3, 0, rx, ry, rr);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, shade(rc, 0.4)); g.addColorStop(1, rc);
  c.beginPath(); c.arc(rx, ry, rr, 0, TAU); c.fillStyle = g; c.fill();
  glow(c, rx, ry, rr * 3.4 + od * 6, rc, 0.55 * pulse);
  if (r >= 5 && br === 'B') {
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * TAU / 3;
      const x = rx + Math.cos(a) * (rr + 3.5), y = ry + Math.sin(a) * (rr + 3.5) * 0.55;
      glow(c, x, y, 3.5, '#ffd36b', 1);
    }
    const fl = Math.sin(t * 9) * 0.8;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.fillStyle = rgba('#ffb36b', 0.55);
    c.beginPath(); c.moveTo(rx - 3.5, ry - rr - 0.5); c.quadraticCurveTo(rx - 1, ry - rr - 7 + fl, rx, ry - rr - 10 + fl); c.quadraticCurveTo(rx + 1, ry - rr - 7 - fl, rx + 3.5, ry - rr - 0.5); c.fill();
    c.restore();
  }
}

/* ----- Манипуляторы ----- */
function drawArms(c, L, ly, t, o) {
  const p = L.parts.arms, r = p.rank, br = p.branch, pal = L.pal, mv = o.moving || 0, wp = o.wp || 0;
  for (const s of [-1, 1]) {
    if (o.armSide && o.armSide !== s) continue;
    if (o.skipArmSide === s) continue;
    const sx = s * (ly.tw + 0.6), sy = ly.shY;
    const swing = Math.sin(wp + (s > 0 ? Math.PI : 0)) * 0.22 * mv;
    const recoil = (o.fire || 0) * 1.6;
    c.save(); c.translate(sx, sy); c.scale(s, 1); c.rotate(-0.13 + swing * s); c.translate(0, -recoil * 0.4);
    if (r >= 3 && br === 'A') armHeavy(c, L, t, o, r);
    else if (r >= 3 && br === 'B') armGatling(c, L, t, o, r);
    else armBasic(c, L, t, o, r);
    c.restore();
    // плечевой шарнир
    const jr = r >= 3 ? 3.6 : 2.8;
    c.beginPath(); c.arc(sx, sy, jr, 0, TAU); fillMetal(c, pal, sx - jr, sy - jr, sx + jr, sy + jr, 'd');
    c.beginPath(); c.arc(sx, sy, 1.1, 0, TAU); c.fillStyle = pal.a; c.fill();
  }
}
function armBasic(c, L, t, o, r) {
  const pal = L.pal;
  const w1 = [4, 5, 5.2][r], w2 = [3.8, 5.2, 5.6][r];
  pathRR(c, -w1 / 2, 0, w1, 9.5, 1.6); fillMetal(c, pal, -w1 / 2, 0, w1 / 2, 0, 'm');
  if (r >= 1) { c.beginPath(); c.arc(0, 9.5, 2.4, 0, TAU); fillMetal(c, pal, -2, 7.5, 2, 11.5, 'd'); }
  pathRR(c, -w2 / 2, 9.5, w2, 8.5, 1.6); fillMetal(c, pal, -w2 / 2, 0, w2 / 2, 0, r >= 1 ? 'l' : 'm');
  if (r >= 2) {
    pathRR(c, w2 / 2 - 0.4, 10, 2.8, 9.5, 1); fillMetal(c, pal, 0, 10, 0, 19, 'd');
    glow(c, w2 / 2 + 1, 19.4, 3.2, pal.a, 0.8 + (o.fire || 0));
    pathPoly(c, [-w2 / 2, 11, -w2 / 2 - 2.6, 13, -w2 / 2, 15.5]); fillFlat(c, pal.a, pal.o);
  }
  if (r === 0) {
    pathPoly(c, [-2.2, 18, -0.4, 18, -1.4, 21.5]); fillFlat(c, pal.md, pal.o);
    pathPoly(c, [0.4, 18, 2.2, 18, 1.4, 21.5]); fillFlat(c, pal.md, pal.o);
  } else {
    pathRR(c, -3, 17.6, 6, 3.6, 1.2); fillMetal(c, pal, 0, 17.6, 0, 21, 'd');
  }
}
function armHeavy(c, L, t, o, r) {
  const pal = L.pal;
  pathRR(c, -3.5, -1, 7, 8.5, 2.4); fillMetal(c, pal, -3.5, 0, 3.5, 0, 'm');
  const glowA = 0.65 + (o.fire || 0) * 0.8 + (o.siege ? 0.5 + Math.sin(t * 12) * 0.3 : 0);
  const barrel = (x, w, len) => {
    pathRR(c, x - w / 2, 6, w, len, w * 0.35); fillMetal(c, pal, x - w / 2, 0, x + w / 2, 0, 'm');
    c.beginPath(); c.ellipse(x, 6 + len, w / 2, w * 0.2, 0, 0, TAU); fillFlat(c, pal.mdd, pal.o);
    c.beginPath(); c.ellipse(x, 6 + len, w * 0.3, w * 0.12, 0, 0, TAU); c.fillStyle = pal.ag; c.fill();
    glow(c, x, 6 + len, w * 1.1, pal.a, glowA);
    for (let k = 0; k < 2; k++) { c.beginPath(); c.moveTo(x - w / 2 + 1, 9 + k * 2.2); c.lineTo(x + w / 2 - 1, 9 + k * 2.2); c.strokeStyle = pal.md; c.lineWidth = 0.8 * RS.k; c.stroke(); }
  };
  if (r === 3) barrel(0, 9.5, 16);
  else if (r === 4) { barrel(-2.8, 6.2, 17); barrel(3.4, 6.2, 18.5); pathRR(c, -6.2, 13, 12.8, 2.6, 1); fillMetal(c, pal, 0, 13, 0, 15.6, 'd'); }
  else {
    barrel(0, 12.5, 21);
    for (let k = 0; k < 3; k++) {
      const yy = 13 + k * 4;
      pathRR(c, -6.7, yy, 13.4, 1.8, 0.8); fillFlat(c, pal.a);
      glow(c, 0, yy + 0.9, 7, pal.a, 0.35 * glowA);
    }
    c.strokeStyle = pal.md; c.lineWidth = 1.6 * RS.k; c.beginPath(); c.moveTo(-3, 0); c.lineTo(-6.5, 12); c.stroke();
  }
}
function armGatling(c, L, t, o, r) {
  const pal = L.pal;
  pathRR(c, -3, -1, 6, 8.5, 2.2); fillMetal(c, pal, -3, 0, 3, 0, 'm');
  const spin = t * (o.fire ? 40 : 5);
  const gun = (x, nb, len, br) => {
    c.beginPath(); c.arc(x, 10, 4.2, 0, TAU); fillMetal(c, pal, x - 4, 6, x + 4, 14, 'd');
    const items = [];
    for (let i = 0; i < nb; i++) { const a = spin + i * TAU / nb; items.push({ x: Math.sin(a) * 2.3, z: Math.cos(a) }); }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      pathRR(c, x + it.x - 0.9, 12, 1.8, len, 0.8);
      c.fillStyle = it.z > 0 ? pal.ml : pal.md; c.fill(); c.strokeStyle = pal.o; c.lineWidth = 0.6 * RS.k; c.stroke();
      if (r >= 5) { pathRR(c, x + it.x - 0.9, 12 + len - 3, 1.8, 3, 0.8); c.fillStyle = rgba('#ff7a35', 0.85); c.fill(); }
    }
    pathRR(c, x - 3.2, 12 + len - 1, 6.4, 1.6, 0.6); fillMetal(c, pal, 0, 0, 0, 1, 'd');
    glow(c, x, 12 + len + 1, 4, br, 0.5 + (o.fire || 0));
  };
  if (r === 3) gun(0, 3, 12, pal.a);
  else if (r === 4) {
    gun(-2.6, 3, 12, pal.a); gun(3.2, 3, 13, pal.a);
    c.strokeStyle = '#d9b24a'; c.lineWidth = 1.4 * RS.k; c.setLineDash([1, 1]);
    c.beginPath(); c.moveTo(-3, 2); c.quadraticCurveTo(-9, 8, -3, 12); c.stroke(); c.setLineDash([]);
  } else gun(0.5, 4, 15, '#ff7a35');
}

/* ----- Сенсоры (голова) ----- */
function drawHead(c, L, ly, t, o) {
  const p = L.parts.head, r = p.rank, br = p.branch, pal = L.pal, f = o.face || 1, hy = ly.headY, od = L.od || 0;
  pathRR(c, -2.6, ly.tTop - 2.5, 5.2, 3.5, 1); fillMetal(c, pal, 0, 0, 0, 1, 'd');
  const eye = pal.e;
  if (r >= 3 && br === 'A') {
    const col = od > 0.5 ? '#ffffff' : '#ff4d5e';
    pathPoly(c, [-7, hy + 4.2, -7.8, hy - 1.5, -4.5, hy - 6.8, 4.5, hy - 6.8, 7.8, hy - 1.5, 7, hy + 4.2, 0, hy + 6.2]);
    fillMetal(c, pal, -6, hy - 7, 6, hy + 6, 'd');
    pathPoly(c, [-6, hy - 3.2, 6, hy - 3.2, 5.2, hy + 1.2, -5.2, hy + 1.2]); fillFlat(c, '#0a0d16');
    for (let k = -1; k <= 1; k++) {
      const ex = k * 3.1 + f * 0.7, ey = hy - 1;
      glow(c, ex, ey, 4, col, 0.9);
      c.beginPath(); c.arc(ex, ey, 1.25, 0, TAU); c.fillStyle = '#ffffff'; c.fill();
    }
    c.strokeStyle = pal.md; c.lineWidth = 0.8 * RS.k;
    for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(k * 1.6, hy + 3); c.lineTo(k * 1.6, hy + 5); c.stroke(); }
    if (r >= 4) {
      for (const s of [-1, 1]) { pathPoly(c, [s * 3, hy - 6.5, s * 5.2, hy - 6.5, s * 9.5, hy - 14]); fillMetal(c, pal, 0, hy - 14, 0, hy - 6, 'l'); }
      c.save(); c.translate(f * 13, hy - 3); c.rotate(t * 2);
      c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(col, 0.7); c.lineWidth = 0.8 * RS.k;
      c.beginPath(); c.arc(0, 0, 3.4, 0, TAU); c.stroke();
      for (let k = 0; k < 4; k++) { c.rotate(TAU / 4); c.beginPath(); c.moveTo(4.4, 0); c.lineTo(6, 0); c.stroke(); }
      c.restore();
    }
    if (r >= 5) {
      c.save(); c.globalCompositeOperation = 'lighter';
      c.strokeStyle = rgba(col, 0.6); c.lineWidth = 1 * RS.k;
      c.beginPath(); c.arc(0, hy - 1, 11.5, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * 1.12 + ((k / 7 + t * 0.15) % 1) * Math.PI * 0.76;
        c.beginPath(); c.moveTo(Math.cos(a) * 11.5, hy - 1 + Math.sin(a) * 11.5); c.lineTo(Math.cos(a) * 14, hy - 1 + Math.sin(a) * 14); c.stroke();
      }
      for (let k = -1; k <= 1; k++) {
        const ph = (t * 1.8 + k * 0.37) % 1;
        c.fillStyle = rgba(col, (1 - ph) * 0.8);
        c.fillRect(k * 3.1 + f * 0.7 - 0.35, hy + 0.5 + ph * 7, 0.7, 1.8);
      }
      c.restore();
    }
    return;
  }
  if (r >= 3 && br === 'B') {
    const col = '#5dff9b';
    c.beginPath(); c.arc(0, hy, 7, Math.PI, TAU); c.lineTo(7, hy + 4.5); c.lineTo(-7, hy + 4.5); c.closePath();
    fillMetal(c, pal, -7, hy - 7, 7, hy + 4, 'm');
    if (r >= 5) {
      c.beginPath(); c.arc(0, hy, 5, 0, TAU); fillFlat(c, '#071410', pal.o);
      c.beginPath(); c.arc(f * 1.4, hy, 3.2, 0, TAU); c.fillStyle = col; c.fill();
      c.beginPath(); c.arc(f * 1.8, hy, 1.3, 0, TAU); c.fillStyle = '#04110b'; c.fill();
      glow(c, f * 1.4, hy, 9, col, 0.8);
      c.save(); c.globalCompositeOperation = 'lighter';
      const sw = Math.sin(t * 1.5) * 0.5;
      const g2 = c.createLinearGradient(0, hy, f * 40, hy);
      g2.addColorStop(0, rgba(col, 0.35)); g2.addColorStop(1, rgba(col, 0));
      c.fillStyle = g2;
      c.beginPath(); c.moveTo(f * 3, hy); c.lineTo(f * 40, hy - 10 + sw * 12); c.lineTo(f * 40, hy + 8 + sw * 12); c.fill();
      c.restore();
    } else {
      c.beginPath(); c.arc(f * 1.4, hy - 0.5, 3.1, 0, TAU); fillFlat(c, '#06120c', pal.o);
      c.beginPath(); c.arc(f * 1.6, hy - 0.5, 2, 0, TAU); c.fillStyle = col; c.fill();
      glow(c, f * 1.6, hy - 0.5, 6, col, 0.8);
    }
    // тарелка радара
    const dish = (x, y, sz, sp) => {
      c.strokeStyle = pal.md; c.lineWidth = 1.2 * RS.k; c.beginPath(); c.moveTo(x, y + 4); c.lineTo(x, y); c.stroke();
      const w = sz * (0.25 + Math.abs(Math.cos(t * sp)) * 0.75);
      c.beginPath(); c.ellipse(x, y, w, sz * 0.38, 0, 0, TAU); fillMetal(c, pal, x - w, y, x + w, y, Math.cos(t * sp) > 0 ? 'l' : 'd');
      c.beginPath(); c.arc(x, y, 0.9, 0, TAU); c.fillStyle = col; c.fill();
    };
    dish(0, hy - 10, 6, 2);
    if (r >= 4) {
      dish(-7.5, hy - 7, 3.6, 2.8);
      c.strokeStyle = pal.ml; c.lineWidth = 0.8 * RS.k; c.beginPath(); c.moveTo(6, hy - 4); c.lineTo(7.5, hy - 14); c.stroke();
      if (Math.sin(t * 6) > 0) glow(c, 7.5, hy - 14, 3.5, col, 1);
    }
    return;
  }
  // базовые головы
  if (r === 0) { pathRR(c, -6, hy - 5, 12, 10, 2); fillMetal(c, pal, -6, hy - 5, 6, hy + 5, 'm'); }
  else { pathRR(c, -6.6, hy - 5.6, 13.2, 11, 4.4); fillMetal(c, pal, -6.6, hy - 5.6, 6.6, hy + 5.4, 'm'); }
  const vw = r === 0 ? 8 : 9.4, vh = r === 0 ? 2.4 : 3.4;
  pathRR(c, -vw / 2 + f * 0.9, hy - vh / 2 - 0.5, vw, vh, vh / 2); fillFlat(c, '#0a0d16');
  pathRR(c, -vw / 2 + f * 0.9 + 0.8, hy - vh / 2, vw - 1.6, vh - 1, (vh - 1) / 2); c.fillStyle = eye; c.fill();
  glow(c, f * 0.9, hy - 0.5, 7, eye, 0.7);
  if (r >= 1) for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 6.6, hy, 1.4, 0, TAU); fillFlat(c, pal.md, pal.o); }
  if (r >= 2) {
    c.strokeStyle = pal.ml; c.lineWidth = 0.9 * RS.k; c.beginPath(); c.moveTo(4, hy - 5); c.lineTo(6, hy - 12); c.stroke();
    glow(c, 6, hy - 12, 3.5, pal.a, Math.sin(t * 5) > 0 ? 1 : 0.35);
    c.beginPath(); c.arc(6, hy - 12, 0.9, 0, TAU); c.fillStyle = '#fff'; c.fill();
    for (const s of [-1, 1]) { pathRR(c, s * 7.6 - 1.2, hy - 3, 2.4, 5, 0.8); fillMetal(c, pal, 0, hy - 3, 0, hy + 2, 'd'); }
  }
}

/* ----- Отделка форм ----- */
function drawFormTrim(c, L, ly, t, o) {
  const f = L.form, pal = L.pal, tw = ly.tw, T = ly.tTop, B = ly.tBot;
  if (f >= 1) {
    for (const s of [-1, 1]) lightLine(c, s * (tw - 1.5), T + 1.5, s * (tw * 0.55), B - 1.5, pal.a, 0.8, 0.55);
  }
  if (f >= 2) {
    const pulse = 0.5 + Math.sin(t * 3) * 0.3;
    lightLine(c, -tw + 1, T + 0.6, tw - 1, T + 0.6, pal.ag, 0.7, pulse);
  }
  if (f >= 3) {
    c.save(); c.strokeStyle = pal.t; c.lineWidth = 0.9 * RS.k; c.globalAlpha *= 0.9;
    c.beginPath(); c.moveTo(-tw * 0.8, B - 0.3); c.lineTo(tw * 0.8, B - 0.3); c.stroke(); c.restore();
    glow(c, 0, B, 6, pal.t, 0.25);
  }
  if (f >= 4) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.42;
      const x = Math.cos(a) * 17, y = ly.headY - 4 + Math.sin(a) * 10 + Math.sin(t * 3 + i) * 0.8;
      glow(c, x, y, 4, '#fff6d0', 0.9);
    }
  }
}

/* ===== Снимки модулей для анимации трансформации ===== */
const SNAP_RES = 3;
function partSnapshot(L, part, t, vo) {
  const ext = 50 * L.scale * (vo && vo.view === 'top' ? 1.3 : 1);
  const px = Math.ceil(ext * 2 * SNAP_RES);
  const cv = makeCanvas(px, px);
  const c = cv.getContext('2d');
  const oy = vo && vo.view === 'top' ? 0 : 4 * L.scale;
  c.translate(px / 2, px / 2 + oy * SNAP_RES);
  c.scale(SNAP_RES, SNAP_RES);
  const o = Object.assign({}, vo || {}, { only: part, static: true });
  drawRobot(c, L, t, o);
  return { cv, ext, res: SNAP_RES, oy };
}
function snapTiles(snap, n) {
  const w = snap.cv.width, ts = w / n;
  const data = snap.cv.getContext('2d').getImageData(0, 0, w, w).data;
  const tiles = [];
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    let filled = 0;
    const x0 = Math.floor(gx * ts), y0 = Math.floor(gy * ts), x1 = Math.floor((gx + 1) * ts), y1 = Math.floor((gy + 1) * ts);
    for (let y = y0; y < y1 && filled < 3; y += 2) for (let x = x0; x < x1; x += 2) { if (data[(y * w + x) * 4 + 3] > 40) { filled++; if (filled >= 3) break; } }
    if (filled < 3) continue;
    const hx = (gx + 0.5) * ts / snap.res - snap.ext, hy = (gy + 0.5) * ts / snap.res - snap.ext - snap.oy;
    tiles.push({ sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0, hx, hy, size: ts / snap.res, x: hx, y: hy, rot: 0, vx: 0, vy: 0, vr: 0, d: 0 });
  }
  return tiles;
}
function silhouette(cv, col) {
  const s = makeCanvas(cv.width, cv.height);
  const c = s.getContext('2d');
  c.drawImage(cv, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = col; c.fillRect(0, 0, s.width, s.height);
  return s;
}

/* ===== Превью для интерфейса ===== */
function drawRobotPreview(cv, L, t, opt) {
  opt = opt || {};
  const c = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  const s = (opt.zoom || 1) * Math.min(w, h) / (66 * L.scale);
  c.translate(w / 2, h / 2 + (opt.dy || 0) * s);
  c.scale(s, s);
  if (opt.highlight) {
    c.globalAlpha = 0.28;
    drawRobot(c, L, t, { static: !opt.anim, skip: opt.highlight, face: 1 });
    c.globalAlpha = 1;
    drawRobot(c, L, t, { static: !opt.anim, only: opt.highlight, face: 1 });
  } else {
    drawRobot(c, L, t, { static: !opt.anim, face: opt.face || 1, moving: opt.moving || 0, wp: t * 9 });
  }
}
