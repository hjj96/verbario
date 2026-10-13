// Canvas decals for helideck tops and roofs (DESIGN §2.11, §3.9): dark deck #2B3034, yellow
// touchdown circle #F2C200, white H, white perimeter line, deck name, obstacle-free chevron,
// anti-slip mottling. Painted once (and repainted when the web fonts arrive).
import * as THREE from 'three';

const FONT = "'Oswald', 'Arial Narrow', Impact, sans-serif";

// Deterministic mottling so decks never look like flat vector art.
function mottle(g, x, y, w, h, seed, alpha = 0.06, n = 900) {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    const rr = 2 + r() * 14;
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * 0.6 * r()})`;
    g.beginPath();
    g.arc(px, py, rr, 0, Math.PI * 2);
    g.fill();
  }
}

function octagonPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

// Helideck painted into the square (ox, oy, S) of the canvas. The octagon deck of radius R metres
// is mapped onto the full square (uv of CircleGeometry). Top of the square = forward (−Z local).
// opts: name, deck colour, circle radius m, H size m, perimeter colour, chevron, tdpm text.
export function paintHelideck(g, ox, oy, S, R, opts = {}) {
  const { name = '', deck = '#2B3034', circle = 6, ring = 0.9, hW = 3.2, hH = 4.6, hStroke = 0.8, seed = 1, chevron = true, numbers = null } = opts;
  const k = S / (2 * R); // px per metre
  const cx = ox + S / 2, cy = oy + S / 2;
  g.save();
  g.fillStyle = deck;
  g.fillRect(ox, oy, S, S);
  mottle(g, ox, oy, S, S, seed, 0.07, Math.round(S * 1.2));
  // anti-slip grid
  g.strokeStyle = 'rgba(255,255,255,0.025)';
  g.lineWidth = 1;
  for (let i = 0; i < S; i += Math.max(4, k * 0.5)) {
    g.beginPath();
    g.moveTo(ox + i, oy);
    g.lineTo(ox + i, oy + S);
    g.stroke();
  }
  // perimeter line (white, 0.3 m, inset 0.4 m)
  g.strokeStyle = '#ECEBE6';
  g.lineWidth = 0.32 * k;
  octagonPath(g, cx, cy, (R - 0.55) * k);
  g.stroke();
  // touchdown / positioning circle (yellow)
  g.strokeStyle = '#F2C200';
  g.lineWidth = ring * k;
  g.beginPath();
  g.arc(cx, cy, (circle - ring / 2) * k, 0, Math.PI * 2);
  g.stroke();
  // H (white), bars along the deck length
  g.fillStyle = '#F4F1EA';
  const hw = hW * k, hh = hH * k, st = hStroke * k;
  g.fillRect(cx - hw / 2, cy - hh / 2, st, hh);
  g.fillRect(cx + hw / 2 - st, cy - hh / 2, st, hh);
  g.fillRect(cx - hw / 2, cy - st / 2, hw, st);
  // obstacle-free sector chevron at the forward edge (black/white)
  if (chevron) {
    const y0 = cy - (R - 1.1) * k;
    g.lineWidth = 0.35 * k;
    g.strokeStyle = '#111416';
    g.beginPath();
    g.moveTo(cx - 1.6 * k, y0 + 0.9 * k);
    g.lineTo(cx, y0);
    g.lineTo(cx + 1.6 * k, y0 + 0.9 * k);
    g.stroke();
    g.strokeStyle = '#ECEBE6';
    g.lineWidth = 0.14 * k;
    g.stroke();
  }
  // deck name along the aft edge, readable from the approach
  if (name) {
    g.fillStyle = '#ECEBE6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round(1.35 * k)}px ${FONT}`;
    g.fillText(name, cx, cy + (R - 2.15) * k);
  }
  // max weight / D-value boxes (tiny, but they make the deck read as a real helideck)
  if (numbers) {
    g.font = `600 ${Math.round(0.85 * k)}px ${FONT}`;
    g.fillStyle = '#ECEBE6';
    g.textAlign = 'center';
    g.fillText(numbers[0], cx - (circle + 1.4) * k, cy);
    g.fillText(numbers[1], cx + (circle + 1.4) * k, cy);
  }
  // tyre marks & oil stains on the touchdown zone
  g.globalAlpha = 0.08;
  g.strokeStyle = '#000';
  g.lineWidth = 0.25 * k;
  for (let i = 0; i < 6; i++) {
    const a = (seed * 0.7 + i * 1.1) % (Math.PI * 2);
    g.beginPath();
    g.arc(cx + Math.cos(a) * 1.2 * k, cy + Math.sin(a) * 1.0 * k, (2 + (i % 3)) * k, a, a + 0.8);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();
}

// Roof banner: big painted letters on a flat roof (rig name, or «С ДНЁМ СПАСАТЕЛЯ» on 27 Dec).
export function paintRoof(g, ox, oy, W, H, { base = '#8E9496', text = '', sub = '', festive = false, seed = 3 } = {}) {
  g.save();
  g.fillStyle = base;
  g.fillRect(ox, oy, W, H);
  mottle(g, ox, oy, W, H, seed, 0.08, Math.round(W));
  // roof seams
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 2;
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(ox + (W * i) / 6, oy);
    g.lineTo(ox + (W * i) / 6, oy + H);
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (festive) {
    g.fillStyle = '#B3261E';
    g.fillRect(ox + W * 0.04, oy + H * 0.18, W * 0.92, H * 0.64);
    g.fillStyle = '#F4F1EA';
    g.font = `700 ${Math.round(H * 0.17)}px ${FONT}`;
    g.fillText('С ДНЁМ', ox + W / 2, oy + H * 0.36, W * 0.86);
    g.fillText('СПАСАТЕЛЯ', ox + W / 2, oy + H * 0.62, W * 0.86);
    g.fillStyle = '#F2C200';
    g.font = `600 ${Math.round(H * 0.07)}px ${FONT}`;
    g.fillText('27 · XII', ox + W / 2, oy + H * 0.78);
  } else if (text) {
    g.fillStyle = 'rgba(244,241,234,0.88)';
    g.font = `700 ${Math.round(H * 0.15)}px ${FONT}`;
    g.fillText(text, ox + W / 2, oy + H * 0.44, W * 0.9);
    if (sub) {
      g.font = `600 ${Math.round(H * 0.09)}px ${FONT}`;
      g.fillText(sub, ox + W / 2, oy + H * 0.7, W * 0.9);
    }
  }
  g.restore();
}

// Canvas texture that repaints itself once the web fonts are ready.
export function decalTexture(look, w, h, paint) {
  const tex = look.canvasTexture(w, h, paint);
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  try {
    document.fonts?.ready?.then(() => {
      const c = tex.image;
      if (!c || !c.getContext) return;
      paint(c.getContext('2d'), w, h);
      tex.needsUpdate = true;
    });
  } catch {
    /* fonts API unavailable — fallback fonts are fine */
  }
  return tex;
}
