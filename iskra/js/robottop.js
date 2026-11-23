'use strict';
/* ===== Робот, вид сверху: ноги по ходу движения, корпус и руки — к цели ===== */

const TOP_K = 1.3;
function drawRobotTop(c, L, t, o) {
  const ly = robotLayout(L), sc = L.scale * TOP_K;
  setLineScale(c, sc);
  const hd = o.hd || 0, aim = o.aim !== undefined ? o.aim : hd;
  const has = name => !o.onlyMounts && (!o.only || o.only === name) && o.skip !== name;
  c.save();
  c.scale(sc, sc);
  if (o.squash) { const k = 1 + o.squash * 0.14; c.scale(k, k); }
  if (!o.only && !o.onlyMounts) drawAuraTop(c, L, ly, t, o);
  if (has('legs')) { c.save(); c.rotate(hd); drawLegsTop(c, L, ly, t, o); c.restore(); }
  c.save(); c.rotate(aim);
  if (has('back')) drawBackTop(c, L, ly, t, o);
  if (has('arms')) drawArmsTop(c, L, ly, t, o);
  if (has('core')) drawCoreTop(c, L, ly, t, o);
  if (has('head')) drawHeadTop(c, L, ly, t, o);
  if (!o.only && !o.onlyMounts) drawTrimTop(c, L, ly, t, o);
  if (o.mounts) drawMountsTop(c, L, ly, t, o);
  c.restore();
  c.restore();
}

function drawAuraTop(c, L, ly, t, o) {
  const f = L.form, od = L.od || 0, pal = L.pal;
  if (f >= 3) glow(c, 0, 0, 34 + f * 4, f >= 4 ? '#fff2c2' : pal.t, 0.14 + Math.sin(t * 2.4) * 0.04);
  if (f >= 4) {
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = 2.5 * RS.k;
    for (let i = 0; i < 10; i++) {
      const a = t * 0.5 + i * TAU / 10;
      c.strokeStyle = hsl(((t * 60 + i * 36) % 360) | 0, 100, 70, 0.18);
      c.beginPath(); c.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); c.lineTo(Math.cos(a) * 44, Math.sin(a) * 44); c.stroke();
    }
    c.restore();
  }
  if (od > 0) {
    const fl = 0.85 + Math.sin(t * 23) * 0.1;
    glow(c, 0, 0, 48 * fl * od, OD_COLOR, 0.45 * od);
    glow(c, 0, 0, 24 * fl * od, '#ffd36b', 0.3 * od);
  }
}

/* ----- ноги ----- */
function drawLegsTop(c, L, ly, t, o) {
  const p = L.parts.legs, r = p.rank, br = p.branch, pal = L.pal, mv = o.moving || 0, wp = o.wp || 0, tw = ly.tw;
  if (r >= 3 && br === 'A') {
    const len = 31 + (r - 3) * 1.5, half = len / 2;
    pathRR(c, -9, -tw + 3, 18, (tw - 3) * 2, 2); fillMetal(c, pal, 0, 0, 0, 0, 'd');
    for (const s of [-1, 1]) {
      const y = s * (tw - 0.5);
      pathRR(c, -half, y - 3.8, len, 7.6, 3.6); fillMetal(c, pal, 0, 0, 0, 0, 'r');
      const off = ((o.dist || 0) * 0.35) % 3.6;
      c.beginPath();
      for (let x = -half + 2 + off; x < half - 1.5; x += 3.6) { c.moveTo(x, y - 3.2); c.lineTo(x, y + 3.2); }
      strokeLine(c, pal.ls, 0.55);
      if (r >= 4) {
        pathRR(c, -half + 2, y + s * 3.2 - 1.6, len - 4, 3.2, 1.2); fillMetal(c, pal, 0, 0, 0, 0, 'l');
        lightLine(c, -half + 4, y + s * 3.2, half - 4, y + s * 3.2, pal.a, 0.7, 0.8);
      }
    }
    if (r >= 5) {
      const x0 = half - 1;
      pathPoly(c, [x0, -tw - 4, x0 + 5, -tw - 1, x0 + 7, 0, x0 + 5, tw + 1, x0, tw + 4]);
      fillMetal(c, pal, 0, 0, 0, 0, 'l');
      c.save(); pathPoly(c, [x0, -tw - 4, x0 + 5, -tw - 1, x0 + 7, 0, x0 + 5, tw + 1, x0, tw + 4]); c.clip();
      c.fillStyle = 'rgba(255,210,63,0.85)';
      for (let y = -tw - 8; y < tw + 8; y += 4) { pathPoly(c, [x0 - 1, y, x0 + 9, y + 3, x0 + 9, y + 5, x0 - 1, y + 2]); c.fill(); }
      c.restore();
      for (const y of [-tw, 0, tw]) { pathPoly(c, [x0 + 6, y - 1.6, x0 + 10, y, x0 + 6, y + 1.6]); fillFlat(c, pal.gl, pal.ln); }
    }
    return;
  }
  if (r >= 3 && br === 'B') {
    const flameCol = r >= 5 ? '#b38bff' : pal.a, od = L.od || 0;
    for (const s of [-1, 1]) {
      const y = s * 6.2;
      if (r >= 5) {
        const fl = Math.sin(t * 3 + s) * 0.6;
        pathRR(c, -4, y - 2.8 + fl, 7, 5.6, 2); fillMetal(c, pal, 0, 0, 0, 0, 'l');
        pathRR(c, -9.5, y - 2.4 + fl, 4.5, 4.8, 1.6); fillMetal(c, pal, 0, 0, 0, 0, 'd');
      } else {
        pathRR(c, -6, y - 3.4, 11, 6.8, 2.4); fillMetal(c, pal, 0, 0, 0, 0, 'm');
        pathPoly(c, [-6, y - 2.6, -10, y - 3.6, -10, y + 3.6, -6, y + 2.6]); fillMetal(c, pal, 0, 0, 0, 0, 'd');
      }
      const len = 7 + mv * 11 + Math.sin(t * 31 + s * 2) * 1.4 + od * 4;
      c.save(); c.globalCompositeOperation = 'lighter';
      const g = c.createLinearGradient(-10, 0, -10 - len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, rgba(flameCol, 0.85)); g.addColorStop(1, rgba(flameCol, 0));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(-10, y - 3); c.quadraticCurveTo(-10 - len * 1.25, y, -10, y + 3); c.fill();
      c.restore();
      glow(c, -11, y, 7, flameCol, 0.55);
      if (r >= 4 && r < 5) {
        const ty = s * 11.5;
        pathRR(c, -3, ty - 1.8, 5, 3.6, 1.2); fillMetal(c, pal, 0, 0, 0, 0, 'd');
        lightLine(c, -3, ty, -3 - (3 + mv * 4), ty + s * 2, flameCol, 1.6, 0.8);
      }
    }
    if (r >= 5) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const ph = (t * 1.4 + k * 0.5) % 1;
        c.strokeStyle = rgba(flameCol, (1 - ph) * 0.6); c.lineWidth = 1.2 * RS.k;
        c.beginPath(); c.arc(0, 0, 12 + ph * 12, 0, TAU); c.stroke();
      }
      c.restore();
    }
    return;
  }
  // шагающие ноги
  for (const s of [-1, 1]) {
    const ph = wp + (s > 0 ? 0 : Math.PI);
    const stride = Math.sin(ph) * 4.2 * mv, lift = Math.max(0, Math.cos(ph)) * mv;
    const fl = 8 + r * 1.2, fw = 4.4 + r * 0.6, y = s * (5.8 + r * 0.4);
    c.save(); c.translate(stride, y); c.scale(1 + lift * 0.1, 1 + lift * 0.1);
    if (r >= 1) { pathRR(c, -fl * 0.35 - stride * 0.5, -fw * 0.45, fl * 0.6, fw * 0.9, 1.4); fillMetal(c, pal, 0, 0, 0, 0, 'd'); }
    pathRR(c, -fl / 2, -fw / 2, fl, fw, 1.6); fillMetal(c, pal, 0, 0, 0, 0, r >= 1 ? 'l' : 'm');
    if (r >= 2) { pathRR(c, fl / 2 - 2.4, -fw / 2 + 0.6, 2, fw - 1.2, 0.6); fillFlat(c, pal.a); }
    c.restore();
    c.beginPath(); c.arc(0, s * 4.6, 2.1, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'd');
    if (r >= 2) { c.beginPath(); c.moveTo(0, s * 4.6); c.lineTo(stride + 1, y); strokeLine(c, pal.ls, 0.7); }
  }
}

/* ----- генератор (спина) ----- */
function drawBackTop(c, L, ly, t, o) {
  const p = L.parts.back, r = p.rank, br = p.branch, pal = L.pal, tw = ly.tw, od = L.od || 0;
  if (r >= 3 && br === 'A') drawWingsTop(c, L, ly, t, r);
  if (r >= 3 && br === 'B') drawHaloTop(c, L, ly, t, r);
  pathRR(c, -14.5, -6.5, 8.5, 13, 2.2); fillMetal(c, pal, 0, 0, 0, 0, 'd');
  if (r === 0) {
    c.beginPath(); c.arc(-10.2, 0, 2.6, 0, TAU); fillFlat(c, pal.gdd, pal.ls);
    const a = t * 9; c.beginPath(); c.moveTo(-10.2 + Math.cos(a) * 2.2, Math.sin(a) * 2.2); c.lineTo(-10.2 - Math.cos(a) * 2.2, -Math.sin(a) * 2.2); strokeLine(c, pal.ln, 0.6);
  }
  if (r >= 1 && r < 3) { c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(-13.5, -4.5 + i * 3); c.lineTo(-7, -4.5 + i * 3); } strokeLine(c, pal.ls, 0.6); }
  if (r >= 2) for (const s of [-1, 1]) {
    c.beginPath(); c.arc(-11, s * 8.2, 2.7, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'm');
    c.beginPath(); c.arc(-11, s * 8.2, 1.4, 0, TAU); fillFlat(c, pal.a);
    glow(c, -11, s * 8.2, 5, pal.a, 0.45 + Math.sin(t * 4 + s) * 0.2);
  }
}
function drawWingsTop(c, L, ly, t, r) {
  const pal = L.pal, tw = ly.tw, od = L.od || 0;
  const rows = r === 5 ? 3 : 1, feathers = r === 3 ? 3 : 5;
  const flap = Math.sin(t * (od > 0.5 ? 7 : 2.3)) * 0.1;
  const col = r === 5 ? mixHex(pal.a, '#ffffff', 0.25) : pal.a;
  for (const s of [-1, 1]) for (let w = 0; w < rows; w++) {
    const ang = s * (Math.PI / 2 + 0.25 + w * 0.32 - flap - od * 0.15);
    const len = (29 - w * 5.5) * (r >= 4 ? 1.08 : 1);
    const rx = -6 - w * 1.5, ry = s * (tw - 3);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const tx = rx + dx * len, ty = ry + dy * len;
    if (r >= 4) {
      c.save(); c.globalCompositeOperation = 'lighter';
      c.beginPath(); c.moveTo(rx, ry);
      for (let k = 1; k <= feathers; k++) { const q = k / feathers; c.lineTo(rx + dx * len * q - 9 - q * 5, ry + dy * len * q); }
      c.lineTo(tx, ty); c.closePath(); c.fillStyle = rgba(col, 0.16 + od * 0.12); c.fill(); c.restore();
    }
    for (let k = 1; k <= feathers; k++) {
      const q = k / feathers, px = rx + dx * len * q, py = ry + dy * len * q, fl = 6 + q * 8;
      pathPoly(c, [px + 1, py - s * 0.8, px - 1, py + s * 0.8, px - fl, py + s * 1.6, px - fl + 1.5, py - s * 0.4]);
      fillMetal(c, pal, 0, 0, 0, 0, w === 0 ? 'm' : 'l');
      lightLine(c, px, py, px - fl + 1, py + s * 0.6, col, 0.8, 0.85);
    }
    c.beginPath(); c.moveTo(rx, ry); c.lineTo(tx, ty); strokeLine(c, pal.ln, 1.6);
    glow(c, tx, ty, 6, col, 0.8);
  }
}
function drawHaloTop(c, L, ly, t, r) {
  const pal = L.pal, od = L.od || 0, col = '#9dffcf', pulse = 0.8 + Math.sin(t * 3) * 0.2;
  c.save(); c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba(col, 0.8 * pulse); c.lineWidth = 2 * RS.k;
  c.beginPath(); c.arc(0, 0, 21 + od * 3, 0, TAU); c.stroke();
  if (r >= 4) {
    c.save(); c.rotate(t * 0.9); c.strokeStyle = rgba(col, 0.55); c.lineWidth = 1.4 * RS.k;
    c.beginPath(); c.ellipse(0, 0, 26, 9 + Math.sin(t * 1.3) * 4, 0, 0, TAU); c.stroke(); c.restore();
  }
  c.restore();
  glow(c, 0, 0, 28, col, 0.18 * pulse);
  for (const s of [-1, 1]) { pathRR(c, -12, s * 9 - 1.8, 5, 3.6, 1); fillMetal(c, pal, 0, 0, 0, 0, 'd'); lightLine(c, -11.5, s * 9, -7.5, s * 9, col, 0.8, 0.8); }
  if (r >= 5) for (let i = 0; i < 3; i++) {
    const a = t * 1.7 + i * TAU / 3, x = Math.cos(a) * 27, y = Math.sin(a) * 27;
    glow(c, x, y, 8, col, 0.9);
    c.beginPath(); c.arc(x, y, 2.3, 0, TAU); c.fillStyle = '#ffffff'; c.fill();
  }
}

/* ----- руки ----- */
function drawArmsTop(c, L, ly, t, o) {
  const p = L.parts.arms, r = p.rank, br = p.branch, pal = L.pal, tw = ly.tw;
  for (const s of [-1, 1]) {
    if (o.armSide && o.armSide !== s) continue;
    if (o.skipArmSide === s) continue;
    const kick = (o.kick && o.kick[s > 0 ? 1 : 0]) || 0;
    c.save(); c.translate(1 - kick * 2, s * (tw + 0.5)); c.rotate(-s * 0.06);
    if (r >= 3 && br === 'A') {
      pathRR(c, -2.5, -3.6, 9, 7.2, 2.2); fillMetal(c, pal, 0, 0, 0, 0, 'm');
      const barrel = (y, w, len) => {
        pathRR(c, 5, y - w / 2, len, w, w * 0.35); fillMetal(c, pal, 0, 0, 0, 0, 'l');
        c.beginPath(); c.ellipse(5 + len, y, w * 0.18, w * 0.48, 0, 0, TAU); fillFlat(c, pal.gdd, pal.ag);
        glow(c, 5 + len, y, w, pal.a, 0.55 + (o.fire || 0) * 0.6 + (o.siege ? 0.4 : 0));
      };
      if (r === 3) barrel(0, 8.5, 15);
      else if (r === 4) { barrel(-2.4, 5.4, 16); barrel(2.6, 5.4, 17); }
      else { barrel(0, 11, 19); for (let k = 0; k < 3; k++) { pathRR(c, 9 + k * 4, -5.8, 1.6, 11.6, 0.6); fillFlat(c, pal.a); } }
    } else if (r >= 3 && br === 'B') {
      pathRR(c, -2.5, -3.2, 9, 6.4, 2); fillMetal(c, pal, 0, 0, 0, 0, 'm');
      const gun = (y, nb, len, hot) => {
        c.beginPath(); c.arc(10, y, 3.8, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'd');
        const spin = t * ((o.fire || 0) > 0.1 ? 40 : 5);
        for (let i = 0; i < nb; i++) {
          const oy = Math.sin(spin + i * TAU / nb) * 2.2;
          pathRR(c, 12, y + oy - 0.7, len, 1.4, 0.6); fillFlat(c, Math.cos(spin + i * TAU / nb) > 0 ? pal.ml : pal.md);
          if (hot) { pathRR(c, 12 + len - 2.5, y + oy - 0.7, 2.5, 1.4, 0.6); c.fillStyle = rgba('#ff7a35', 0.9); c.fill(); }
        }
      };
      if (r === 3) gun(0, 3, 10, false);
      else if (r === 4) { gun(-2.6, 3, 10, false); gun(2.8, 3, 11, false); }
      else gun(0, 4, 13, true);
    } else {
      const w1 = [3.8, 4.6, 5][r], w2 = [3.4, 4.6, 5][r];
      pathRR(c, -2, -w1 / 2, 9.5, w1, 1.4); fillMetal(c, pal, 0, 0, 0, 0, 'm');
      if (r >= 1) { c.beginPath(); c.arc(8, 0, 2.3, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'd'); }
      pathRR(c, 8, -w2 / 2, 8.5, w2, 1.4); fillMetal(c, pal, 0, 0, 0, 0, r >= 1 ? 'l' : 'm');
      if (r >= 2) { pathPoly(c, [10, s * w2 / 2, 14, s * (w2 / 2 + 2.6), 15, s * w2 / 2]); fillFlat(c, pal.a, pal.ln); }
      if (r === 0) { c.beginPath(); c.moveTo(16.5, -1.4); c.lineTo(19, -2); c.moveTo(16.5, 1.4); c.lineTo(19, 2); strokeLine(c, pal.ln, 0.9); }
    }
    c.restore();
    const jx = 1 - kick * 2, jy = s * (tw + 0.5), jr = r >= 3 ? 3.4 : 2.7;
    c.beginPath(); c.arc(jx, jy, jr, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'd');
    c.beginPath(); c.arc(jx, jy, 1, 0, TAU); c.fillStyle = pal.a; c.fill();
  }
}

/* ----- ядро (торс) ----- */
function drawCoreTop(c, L, ly, t, o) {
  const p = L.parts.core, r = p.rank, br = p.branch, pal = L.pal, tw = ly.tw, od = L.od || 0;
  let rx = -2, rr = [2.6, 3, 3.6][Math.min(r, 2)], rc = pal.a;
  if (r >= 3 && br === 'A') {
    pathPoly(c, [9, -tw + 2, 9, tw - 2, 4, tw + 1, -9, tw, -11, 0, -9, -tw, 4, -tw - 1]);
    fillMetal(c, pal, 0, 0, 0, 0, 'm');
    const off = od * 1.6;
    for (const s of [-1, 1]) {
      pathPoly(c, [7, s * 1.2 + s * off, 7, s * (tw - 2.5) + s * off, -7, s * (tw - 2) + s * off, -8, s * 1.2 + s * off]);
      fillMetal(c, pal, 0, 0, 0, 0, 'l');
      c.beginPath(); c.ellipse(1, s * (tw + 1.5), 7 + (r - 3), 4.6 + (r - 3) * 0.5, 0, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'l');
      c.beginPath(); c.moveTo(-5, s * (tw + 1.5)); c.lineTo(7, s * (tw + 1.5)); strokeLine(c, r >= 5 ? pal.t : pal.a, 1);
      if (r >= 4) for (let k = -1; k <= 1; k++) { const x = 1 + k * 3.4; pathPoly(c, [x - 1.3, s * (tw + 5.5), x + 1.3, s * (tw + 5.5), x, s * (tw + 9.5)]); fillFlat(c, pal.gl, pal.ln); }
    }
    if (od > 0) { pathRR(c, -7, -1.2, 14, 2.4, 1); fillFlat(c, OD_COLOR); glow(c, 0, 0, 14, OD_COLOR, od * 0.9); }
    rr = 3.1;
    if (r >= 5) {
      pathPoly(c, [-2, -5.5, 2.8, -2.8, 2.8, 2.8, -2, 5.5, -6.8, 2.8, -6.8, -2.8]);
      fillMetal(c, pal, 0, 0, 0, 0, 'd'); strokeLine(c, pal.t, 1);
      rr = 2.4; rc = pal.t;
    }
  } else if (r >= 3 && br === 'B') {
    pathPoly(c, [11, 0, 3, -tw - 1, -9, -tw * 0.62, -6.5, 0, -9, tw * 0.62, 3, tw + 1]);
    fillMetal(c, pal, 0, 0, 0, 0, 'm');
    c.beginPath(); for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { c.moveTo(-1 - k * 2.4, s * 4.5); c.lineTo(-3 - k * 2.4, s * (tw * 0.6 - k)); } strokeLine(c, pal.ls, 0.6);
    rr = 4.8 + (r - 3) * 1.1; rc = '#ff7a35'; rx = -1;
    if (r >= 4) for (const s of [-1, 1]) { lightLine(c, rx + rr * 0.5, s * rr * 0.6, 2, s * (tw - 1), '#ffb36b', 1.1, 0.9); }
  } else {
    if (r === 0) pathRR(c, -8, -tw, 16, tw * 2, 3);
    else pathPoly(c, [8, -tw + 3, 8, tw - 3, 5, tw, -7, tw, -9, tw - 3, -9, -tw + 3, -7, -tw, 5, -tw]);
    fillMetal(c, pal, 0, 0, 0, 0, 'm');
    if (r >= 1) { pathRR(c, -6, -tw * 0.62, 11, tw * 1.24, 2); fillMetal(c, pal, 0, 0, 0, 0, 'l'); rivet(c, 4, -tw * 0.5, pal); rivet(c, 4, tw * 0.5, pal); }
    if (r >= 2) { c.beginPath(); for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { c.moveTo(-6 + k * 2.2, s * (tw - 0.6)); c.lineTo(-6 + k * 2.2, s * (tw - 2.6)); } strokeLine(c, pal.ls, 0.6); }
  }
  const pulse = 0.75 + Math.sin(t * 4.2) * 0.25 + od * 0.4;
  c.beginPath(); c.arc(rx, 0, rr + 1.3, 0, TAU); fillFlat(c, pal.gdd, pal.ls);
  const g = c.createRadialGradient(rx - rr * 0.3, -rr * 0.3, 0, rx, 0, rr);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, shade(rc, 0.4)); g.addColorStop(1, rc);
  c.beginPath(); c.arc(rx, 0, rr, 0, TAU); c.fillStyle = g; c.fill();
  glow(c, rx, 0, rr * 3.4 + od * 6, rc, 0.5 * pulse);
  if (r >= 5 && br === 'B') {
    for (let i = 0; i < 3; i++) { const a = t * 3 + i * TAU / 3; glow(c, rx + Math.cos(a) * (rr + 3.6), Math.sin(a) * (rr + 3.6), 3.4, '#ffd36b', 1); }
    const fl = Math.sin(t * 9) * 0.8;
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = rgba('#ffb36b', 0.5);
    c.beginPath(); c.moveTo(rx - rr, -3); c.quadraticCurveTo(rx - rr - 7, fl, rx - rr - 12, fl * 0.5); c.quadraticCurveTo(rx - rr - 7, -fl, rx - rr, 3); c.fill(); c.restore();
  }
}

/* ----- сенсоры (голова) ----- */
function drawHeadTop(c, L, ly, t, o) {
  const p = L.parts.head, r = p.rank, br = p.branch, pal = L.pal, od = L.od || 0, hx = 3.5;
  if (r >= 3 && br === 'A') {
    const col = od > 0.5 ? '#ffffff' : '#ff4d5e';
    pathPoly(c, [hx + 7.5, 0, hx + 3.5, -5.8, hx - 4.5, -5, hx - 4.5, 5, hx + 3.5, 5.8]); fillMetal(c, pal, 0, 0, 0, 0, 'd');
    for (let k = -1; k <= 1; k++) { const ex = hx + 5.4 - Math.abs(k) * 1.8, ey = k * 2.7; glow(c, ex, ey, 3.6, col, 0.9); c.beginPath(); c.arc(ex, ey, 0.9, 0, TAU); c.fillStyle = '#ffffff'; c.fill(); }
    if (r >= 4) {
      c.beginPath(); for (const s of [-1, 1]) { c.moveTo(hx - 1, s * 4.6); c.lineTo(hx - 8.5, s * 9.5); } strokeLine(c, pal.ln, 1.3);
      c.save(); c.translate(hx + 17, 0); c.rotate(t * 2); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(col, 0.7); c.lineWidth = 0.8 * RS.k;
      c.beginPath(); c.arc(0, 0, 3.2, 0, TAU); c.stroke();
      for (let k = 0; k < 4; k++) { c.rotate(TAU / 4); c.beginPath(); c.moveTo(4.2, 0); c.lineTo(5.8, 0); c.stroke(); }
      c.restore();
    }
    if (r >= 5) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(col, 0.55); c.lineWidth = 0.9 * RS.k;
      c.beginPath(); c.arc(hx, 0, 11, -2.2, 2.2); c.stroke();
      for (let k = 0; k < 8; k++) { const a = -2.2 + ((k / 8 + t * 0.12) % 1) * 4.4; c.beginPath(); c.moveTo(hx + Math.cos(a) * 11, Math.sin(a) * 11); c.lineTo(hx + Math.cos(a) * 13.5, Math.sin(a) * 13.5); c.stroke(); }
      c.restore();
    }
    return;
  }
  if (r >= 3 && br === 'B') {
    const col = '#5dff9b';
    c.beginPath(); c.arc(hx, 0, 6.4, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'm');
    if (r >= 5) {
      c.beginPath(); c.arc(hx + 1.5, 0, 4.2, 0, TAU); fillFlat(c, '#071410', pal.ls);
      c.beginPath(); c.arc(hx + 2.6, 0, 2.6, 0, TAU); c.fillStyle = col; c.fill();
      c.beginPath(); c.arc(hx + 3.4, 0, 1, 0, TAU); c.fillStyle = '#04110b'; c.fill();
      glow(c, hx + 2.6, 0, 8, col, 0.8);
      c.save(); c.globalCompositeOperation = 'lighter';
      const sw = Math.sin(t * 1.5) * 0.4, g = c.createLinearGradient(hx, 0, hx + 46, 0);
      g.addColorStop(0, rgba(col, 0.3)); g.addColorStop(1, rgba(col, 0)); c.fillStyle = g;
      c.beginPath(); c.moveTo(hx + 4, 0); c.lineTo(hx + 46, -14 + sw * 20); c.lineTo(hx + 46, 14 + sw * 20); c.fill(); c.restore();
    } else {
      const a = t * 2.2;
      c.beginPath(); c.arc(hx, 0, 5.2, a - 0.8, a + 0.8); strokeLine(c, pal.ln, 1.3);
      c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx + Math.cos(a) * 5.2, Math.sin(a) * 5.2); strokeLine(c, col, 0.7);
      c.beginPath(); c.arc(hx + 4.6, 0, 1.4, 0, TAU); c.fillStyle = col; c.fill(); glow(c, hx + 4.6, 0, 4.5, col, 0.8);
      if (r >= 4) { const b = -t * 3; c.beginPath(); c.arc(hx - 5, 4.5, 2.6, b - 0.9, b + 0.9); strokeLine(c, pal.ln, 1); if (Math.sin(t * 6) > 0) glow(c, hx - 7, -4.5, 3.5, col, 1); }
    }
    return;
  }
  if (r === 0) { pathRR(c, hx - 4.5, -5, 9.5, 10, 2); fillMetal(c, pal, 0, 0, 0, 0, 'm'); }
  else { c.beginPath(); c.arc(hx, 0, 6, 0, TAU); fillMetal(c, pal, 0, 0, 0, 0, 'm'); }
  c.beginPath(); if (r === 0) { c.moveTo(hx + 5, -3.4); c.lineTo(hx + 5, 3.4); } else c.arc(hx, 0, 6, -0.85, 0.85);
  strokeLine(c, pal.e, 2.2); glow(c, hx + 5.5, 0, 6, pal.e, 0.7);
  if (r >= 2) {
    c.beginPath(); c.moveTo(hx - 2, 3); c.lineTo(hx - 9, 5.5); strokeLine(c, pal.ln, 0.8);
    glow(c, hx - 9, 5.5, 3.2, pal.a, Math.sin(t * 5) > 0 ? 1 : 0.35);
    for (const s of [-1, 1]) { pathRR(c, hx - 2, s * 6.6 - 1.2, 4, 2.4, 0.8); fillMetal(c, pal, 0, 0, 0, 0, 'd'); }
  }
}

function drawTrimTop(c, L, ly, t, o) {
  const f = L.form, pal = L.pal, tw = ly.tw;
  if (f >= 1) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.55; c.beginPath(); c.moveTo(7, -tw + 2); c.lineTo(-7, -tw + 2); c.moveTo(7, tw - 2); c.lineTo(-7, tw - 2); strokeLine(c, pal.a, 0.8); c.restore(); }
  if (f >= 3) { c.save(); c.globalAlpha *= 0.8; c.beginPath(); c.arc(0, 0, tw + 8, 0, TAU); c.setLineDash([2, 3]); strokeLine(c, pal.t, 0.7); c.setLineDash([]); c.restore(); }
  if (f >= 4) for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + t * 0.6; glow(c, Math.cos(a) * (tw + 11), Math.sin(a) * (tw + 11), 3.5, '#fff6d0', 0.9); }
}
