// Procedural navigation chart (DESIGN §7.2 briefing chart, §7.2 operations backdrop, §7.7 flight track,
// §7.3.13 in-flight map). One bathymetry model per operation, built once from the shared noise atlas
// (look.sampleAtlas — the same atlas the sea uses), contoured with marching squares into Path2D objects
// in WORLD metres; every view then just sets a transform and strokes/fills them.
//
// Styles: 'paper' — a real nautical chart (buff land, blue shallow tints, ink isobaths with depth
// labels, soundings, border graduations in minutes, compass rose, scale bar, cartouche, wind barb,
// magenta light flare, fronts as meteo symbols, red pencil circles drawing themselves);
// 'dark' — the plotter variant (debrief track, Tab map): navy water, faint cyan isobaths.
import { PAPER } from './palette.js';

const LEVELS = [5, 10, 20, 30, 50, 75, 100, 150, 200];
const DEG = Math.PI / 180;
const NM = 1852; // metres per minute of latitude

// ------------------------------------------------------------------------------------------------
// Bathymetry model
export function buildChartModel(look, def = {}, opts = {}) {
  const R = opts.radius || def.area?.radius || 1500;
  const half = R * (opts.margin || 1.18);
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const N = opts.grid || 112;
  const x0 = cx - half;
  const z0 = cz - half;
  const cell = (2 * half) / N;

  // islands: lighthouse island + rocks from the def (world props), always the lighthouse at 0,0 when present
  const islands = [];
  const props = def.world?.props || {};
  const hasLighthouse = props.lighthouse || (def.world?.pads || []).some((p) => p.type === 'lighthouse');
  if (hasLighthouse) {
    const lp = (def.world?.pads || []).find((p) => p.type === 'lighthouse') || { x: 0, z: 0 };
    islands.push({ x: lp.x, z: lp.z, r: 78, h: 90 });
  }
  for (const r of props.rocks || []) islands.push({ x: r.x, z: r.z, r: Math.max(8, (r.radius || 12) * 0.9), h: 26 + (r.height || 10) });
  // a distant headland so larger charts have a coast (south-west corner)
  if (opts.coast !== false) islands.push({ x: cx - half * 1.32, z: cz + half * 1.3, r: half * 0.34, h: 220 });

  const seedU = 0.137 + ((def.seed || 7) % 97) * 0.0103;
  const seedV = 0.611 + ((def.seed || 7) % 89) * 0.0071;
  const depthAt = (x, z) => {
    const a = look ? look.sampleAtlas(x / 2900 + seedU, z / 2900 + seedV, 0) : 0.5;
    const b = look ? look.sampleAtlas(x / 820 + seedV, z / 820 + seedU, 0) : 0.5;
    let d = 62 + 0.028 * -z + 0.012 * x + 95 * (a - 0.5) + 26 * (b - 0.5);
    for (const is of islands) {
      const dx = x - is.x;
      const dz = z - is.z;
      const q = (dx * dx + dz * dz) / (is.r * is.r * 4.2);
      d -= (is.h + d * 0.6) * Math.exp(-q);
    }
    return d;
  };

  const V = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) V[j * (N + 1) + i] = depthAt(x0 + i * cell, z0 + j * cell);

  const model = {
    R, half, cx, cz, x0, z0, x1: x0 + 2 * half, z1: z0 + 2 * half, N, cell, V, depthAt,
    land: fillBelow(V, N, x0, z0, cell, 0),
    shallow10: fillBelow(V, N, x0, z0, cell, 10),
    shallow20: fillBelow(V, N, x0, z0, cell, 20),
    levels: [],
    coast: contour(V, N, x0, z0, cell, 0).path,
    soundings: [],
    lat0: 69.2,
    lon0: 33.5,
    def,
  };
  for (const L of LEVELS) {
    const c = contour(V, N, x0, z0, cell, L);
    model.levels.push({ d: L, path: c.path, labels: c.labels });
  }
  // coordinates of the world origin from «69°12′ с.ш. 33°27′ в.д.»
  const m = /(\d+)°(\d+)′[^\d]*?(\d+)°(\d+)′/.exec(def.coords || '');
  if (m) {
    model.lat0 = Number(m[1]) + Number(m[2]) / 60;
    model.lon0 = Number(m[3]) + Number(m[4]) / 60;
  }
  // soundings: deterministic scatter of depth figures on open water
  let s = ((def.seed || 7) * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 90 && model.soundings.length < 46; k++) {
    const x = x0 + (0.06 + 0.88 * rnd()) * 2 * half;
    const z = z0 + (0.06 + 0.88 * rnd()) * 2 * half;
    const d = depthAt(x, z);
    if (d < 3) continue;
    model.soundings.push({ x, z, d: Math.round(d) });
  }
  return model;
}

// Polygons of the region where value < level (per-cell boundary walk) as one Path2D in world metres.
function fillBelow(V, N, x0, z0, cell, level) {
  const path = new Path2D();
  const W = N + 1;
  const px = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = V[j * W + i];
      const b = V[j * W + i + 1];
      const c = V[(j + 1) * W + i + 1];
      const d = V[(j + 1) * W + i];
      const ia = a < level, ib = b < level, ic = c < level, id = d < level;
      if (!ia && !ib && !ic && !id) continue;
      const X = x0 + i * cell;
      const Z = z0 + j * cell;
      if (ia && ib && ic && id) {
        path.rect(X, Z, cell * 1.0005, cell * 1.0005);
        continue;
      }
      // corners TL(a) TR(b) BR(c) BL(d)
      let n = 0;
      const cx = [X, X + cell, X + cell, X];
      const cz = [Z, Z, Z + cell, Z + cell];
      const v = [a, b, c, d];
      const ins = [ia, ib, ic, id];
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        if (ins[k]) {
          px[n++] = cx[k];
          px[n++] = cz[k];
        }
        if (ins[k] !== ins[k2]) {
          const t = (level - v[k]) / (v[k2] - v[k]);
          px[n++] = cx[k] + (cx[k2] - cx[k]) * t;
          px[n++] = cz[k] + (cz[k2] - cz[k]) * t;
        }
      }
      if (n < 6) continue;
      path.moveTo(px[0], px[1]);
      for (let k = 2; k < n; k += 2) path.lineTo(px[k], px[k + 1]);
      path.closePath();
    }
  }
  return path;
}

// Iso-line segments at `level` as a Path2D + a few label anchors (segment midpoints, spaced out).
function contour(V, N, x0, z0, cell, level) {
  const path = new Path2D();
  const W = N + 1;
  const labels = [];
  const pts = [0, 0, 0, 0, 0, 0, 0, 0];
  let count = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = V[j * W + i];
      const b = V[j * W + i + 1];
      const c = V[(j + 1) * W + i + 1];
      const d = V[(j + 1) * W + i];
      const X = x0 + i * cell;
      const Z = z0 + j * cell;
      let n = 0;
      const edge = (v1, v2, xa, za, xb, zb) => {
        if ((v1 < level) === (v2 < level)) return;
        const t = (level - v1) / (v2 - v1);
        pts[n++] = xa + (xb - xa) * t;
        pts[n++] = za + (zb - za) * t;
      };
      edge(a, b, X, Z, X + cell, Z);
      edge(b, c, X + cell, Z, X + cell, Z + cell);
      edge(c, d, X + cell, Z + cell, X, Z + cell);
      edge(d, a, X, Z + cell, X, Z);
      if (n >= 4) {
        path.moveTo(pts[0], pts[1]);
        path.lineTo(pts[2], pts[3]);
        if (n >= 8) {
          path.moveTo(pts[4], pts[5]);
          path.lineTo(pts[6], pts[7]);
        }
        count++;
        if (count % 37 === 11 && labels.length < 5) {
          labels.push({ x: (pts[0] + pts[2]) / 2, z: (pts[1] + pts[3]) / 2, a: Math.atan2(pts[3] - pts[1], pts[2] - pts[0]) });
        }
      }
    }
  }
  return { path, labels };
}

// ------------------------------------------------------------------------------------------------
// Views
export function makeView(model, w, h, opts = {}) {
  const pad = opts.pad ?? 0;
  const span = opts.span || model.R * 2.05;
  const scale = Math.min(w - pad * 2, h - pad * 2) / span;
  const cx = opts.cx ?? model.cx;
  const cz = opts.cz ?? model.cz;
  return { w, h, scale, cx, cz, ox: w / 2 - cx * scale, oy: h / 2 - cz * scale };
}
export const wx = (v, x) => v.ox + x * v.scale;
export const wy = (v, z) => v.oy + z * v.scale;

function worldTransform(g, v, dpr) {
  g.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.ox * dpr, v.oy * dpr);
}

// Paper-texture fill (fibres, foxing, lamp falloff). Deterministic.
export function paperFill(g, w, h, seed = 3, tone = PAPER.paper) {
  g.fillStyle = tone;
  g.fillRect(0, 0, w, h);
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 420; i++) {
    g.fillStyle = rnd() < 0.5 ? '#8a7350' : '#ffffff';
    const x = rnd() * w;
    const y = rnd() * h;
    g.fillRect(x, y, 1 + rnd() * 40, 0.6);
  }
  g.globalAlpha = 0.06;
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 30 + rnd() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, '#9c7b45');
    gr.addColorStop(1, 'rgba(156,123,69,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}

/**
 * Draw the chart.
 * @param g     2D context (already sized; dpr = backing scale)
 * @param model buildChartModel()
 * @param v     makeView()
 * @param o     { style: 'paper'|'dark', dpr, border: bool, labels: bool, rose: bool, cartouche: {title, sub},
 *               windFrom, windSpeed, fronts: 'cold'|'warm'|'occluded'|null, pressure: 'low'|'high'|null }
 */
export function drawChart(g, model, v, o = {}) {
  const dpr = o.dpr || 1;
  const dark = o.style === 'dark';
  const C = dark
    ? { water: '#0D1A22', sh20: '#10222B', sh10: '#132A33', land: '#1F2B2C', coast: 'rgba(190,220,225,.55)', iso: 'rgba(143,211,224,.16)', isoStrong: 'rgba(143,211,224,.3)', label: 'rgba(143,211,224,.45)', grid: 'rgba(143,211,224,.08)', ink: '#BFD8DE' }
    : { water: null, sh20: 'rgba(160,200,214,.32)', sh10: 'rgba(120,175,196,.38)', land: '#E3CB95', coast: '#12212B', iso: 'rgba(48,96,128,.42)', isoStrong: 'rgba(48,96,128,.62)', label: 'rgba(32,70,96,.85)', grid: 'rgba(18,33,43,.13)', ink: PAPER.ink };
  const W = v.w;
  const H = v.h;
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (dark) {
    g.fillStyle = C.water;
    g.fillRect(0, 0, W, H);
  } else if (!o.noPaper) paperFill(g, W, H, (model.def.seed || 3) + 11);

  // tints, land, contours (world transform)
  worldTransform(g, v, dpr);
  g.fillStyle = C.sh20;
  g.fill(model.shallow20);
  g.fillStyle = C.sh10;
  g.fill(model.shallow10);
  const px = 1 / v.scale;
  g.lineJoin = 'round';
  for (const L of model.levels) {
    g.strokeStyle = L.d % 50 === 0 ? C.isoStrong : C.iso;
    g.lineWidth = (L.d % 50 === 0 ? 1.05 : 0.7) * px;
    if (!dark && L.d <= 10) g.setLineDash([3 * px, 2.2 * px]);
    else g.setLineDash([]);
    g.stroke(L.path);
  }
  g.setLineDash([]);
  g.fillStyle = C.land;
  g.fill(model.land);
  g.strokeStyle = C.coast;
  g.lineWidth = 1.3 * px;
  g.stroke(model.coast);
  // land hachure (paper)
  if (!dark) {
    g.save();
    g.clip(model.land);
    g.strokeStyle = 'rgba(120,90,40,.25)';
    g.lineWidth = 0.7 * px;
    g.beginPath();
    const step = 7 * px;
    for (let x = model.x0 - model.half; x < model.x1 + model.half; x += step) {
      g.moveTo(x, model.z0);
      g.lineTo(x + (model.z1 - model.z0), model.z1);
    }
    g.stroke();
    g.restore();
  }

  // back to screen pixels
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fs = o.fontScale || 1;

  // graticule (every minute of latitude / longitude)
  const latDeg = (z) => model.lat0 - z / NM / 60;
  const lonDeg = (x) => model.lon0 + x / (NM * 60 * Math.cos(model.lat0 * DEG));
  const zOfLat = (lat) => (model.lat0 - lat) * 60 * NM;
  const xOfLon = (lon) => (lon - model.lon0) * 60 * NM * Math.cos(model.lat0 * DEG);
  const zTop = (0 - v.oy) / v.scale;
  const zBot = (H - v.oy) / v.scale;
  const xL = (0 - v.ox) / v.scale;
  const xR = (W - v.ox) / v.scale;
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let lat = Math.floor(latDeg(zBot) * 60) / 60; lat <= latDeg(zTop) + 1e-9; lat += 1 / 60) {
    const y = wy(v, zOfLat(lat));
    g.moveTo(0, y);
    g.lineTo(W, y);
  }
  for (let lon = Math.floor(lonDeg(xL) * 60) / 60; lon <= lonDeg(xR) + 1e-9; lon += 1 / 60) {
    const x = wx(v, xOfLon(lon));
    g.moveTo(x, 0);
    g.lineTo(x, H);
  }
  g.stroke();

  // depth labels on contours + soundings
  if (o.labels !== false) {
    g.font = `italic ${Math.round(9.5 * fs)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = C.label;
    for (const sd of model.soundings) {
      const x = wx(v, sd.x);
      const y = wy(v, sd.z);
      if (x < 30 || y < 30 || x > W - 30 || y > H - 30) continue;
      g.fillText(String(sd.d), x, y);
    }
    g.font = `${Math.round(9 * fs)}px Inter, system-ui, sans-serif`;
    for (const L of model.levels) {
      if (L.d < 10) continue;
      for (const lb of L.labels) {
        const x = wx(v, lb.x);
        const y = wy(v, lb.z);
        if (x < 40 || y < 40 || x > W - 40 || y > H - 40) continue;
        g.save();
        g.translate(x, y);
        let a = lb.a;
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        g.rotate(a);
        const t = String(L.d);
        const tw = g.measureText(t).width + 4;
        if (!dark) {
          g.fillStyle = PAPER.paper;
          g.fillRect(-tw / 2, -6, tw, 12);
        } else {
          g.fillStyle = C.water;
          g.fillRect(-tw / 2, -6, tw, 12);
        }
        g.fillStyle = C.label;
        g.fillText(t, 0, 0.5);
        g.restore();
      }
    }
  }

  // border graduations (latitude / longitude scale, alternate bars every 0.5′)
  if (o.border !== false) {
    const b = o.borderWidth || 14;
    g.fillStyle = dark ? 'rgba(13,26,34,.9)' : PAPER.paper;
    g.fillRect(0, 0, W, b);
    g.fillRect(0, H - b, W, b);
    g.fillRect(0, 0, b, H);
    g.fillRect(W - b, 0, b, H);
    g.strokeStyle = C.ink;
    g.lineWidth = 1;
    g.strokeRect(b + 0.5, b + 0.5, W - 2 * b - 1, H - 2 * b - 1);
    g.strokeRect(b - 5.5, b - 5.5, W - 2 * b + 11, H - 2 * b + 11);
    g.fillStyle = C.ink;
    const bar = (a0, a1, side) => {
      if (side === 'h') {
        g.fillRect(a0, b - 5, a1 - a0, 5);
        g.fillRect(a0, H - b, a1 - a0, 5);
      } else {
        g.fillRect(b - 5, a0, 5, a1 - a0);
        g.fillRect(W - b, a0, 5, a1 - a0);
      }
    };
    let k = 0;
    for (let lat = Math.floor(latDeg(zBot) * 120) / 120; lat <= latDeg(zTop) + 1 / 120; lat += 1 / 120, k++) {
      const y0 = wy(v, zOfLat(lat));
      const y1 = wy(v, zOfLat(lat + 1 / 120));
      if (Math.round(lat * 120) % 2 === 0) bar(Math.max(b, Math.min(y0, y1)), Math.min(H - b, Math.max(y0, y1)), 'v');
    }
    for (let lon = Math.floor(lonDeg(xL) * 120) / 120; lon <= lonDeg(xR) + 1 / 120; lon += 1 / 120) {
      const x0 = wx(v, xOfLon(lon));
      const x1 = wx(v, xOfLon(lon + 1 / 120));
      if (Math.round(lon * 120) % 2 === 0) bar(Math.max(b, x0), Math.min(W - b, x1), 'h');
    }
    // minute labels
    g.font = `${Math.round(9 * fs)}px "JetBrains Mono", ui-monospace, monospace`;
    g.textBaseline = 'middle';
    for (let lat = Math.ceil(latDeg(zBot) * 60) / 60; lat <= latDeg(zTop); lat += 1 / 60) {
      const y = wy(v, zOfLat(lat));
      if (y < b + 10 || y > H - b - 10) continue;
      const d = Math.floor(lat + 1e-9);
      const mnt = Math.round((lat - d) * 60);
      g.textAlign = 'left';
      g.fillText(`${d}°${String(mnt).padStart(2, '0')}′`, b + 4, y - 7);
    }
    for (let lon = Math.ceil(lonDeg(xL) * 60) / 60; lon <= lonDeg(xR); lon += 1 / 60) {
      const x = wx(v, xOfLon(lon));
      if (x < b + 30 || x > W - b - 30) continue;
      const d = Math.floor(lon + 1e-9);
      const mnt = Math.round((lon - d) * 60);
      g.textAlign = 'center';
      g.fillText(`${d}°${String(mnt).padStart(2, '0')}′`, x, H - b - 9);
    }
  }
  g.restore();
}

// ------------------------------------------------------------------------------------------------
// Symbols (screen pixels; caller sets the dpr transform)

// ○H helipad with name.
export function drawPad(g, x, y, name, color, fs = 1, opts = {}) {
  const r = (opts.r || 8) * fs;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.font = `700 ${Math.round(9.5 * fs)}px Oswald, Impact, "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', x, y + 0.5);
  if (name) {
    g.font = `${opts.italic === false ? '' : 'italic '}${Math.round(10.5 * fs)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'left';
    g.fillText(name, x + r + 4, y + 0.5);
  }
}

// Lighthouse: magenta light flare + characteristic «Бл(2) 8с».
export function drawLight(g, x, y, fs = 1) {
  g.save();
  g.fillStyle = 'rgba(196,40,150,.75)';
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + 10 * fs, y - 6 * fs, x + 22 * fs, y - 20 * fs);
  g.quadraticCurveTo(x + 6 * fs, y - 14 * fs, x, y);
  g.fill();
  g.fillStyle = '#12212B';
  g.beginPath();
  g.arc(x, y, 2.4 * fs, 0, Math.PI * 2);
  g.fill();
  g.font = `italic ${Math.round(9.5 * fs)}px Inter, system-ui, sans-serif`;
  g.fillStyle = 'rgba(160,30,120,.95)';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('Бл(2) 8с 24м 14М', x + 25 * fs, y - 18 * fs);
  g.restore();
}

// Search area (dispatcher's datum): dashed circle + label.
export function drawDatum(g, x, y, rpx, label, color, fs = 1) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.3;
  g.setLineDash([5, 4]);
  g.beginPath();
  g.arc(x, y, rpx, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 0.08;
  g.fillStyle = color;
  g.fill();
  g.globalAlpha = 1;
  if (label) {
    g.font = `600 ${Math.round(9 * fs)}px "JetBrains Mono", ui-monospace, monospace`;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(label, x, y - rpx - 4);
  }
  g.restore();
}

// Wobbly pencil circle with a self-drawing animation (progress 0..1). Precomputed jitter by seed.
export function pencilCircle(g, x, y, r, progress, seed = 1, color = '#C8102E') {
  if (progress <= 0) return;
  const turns = 1.12;
  const n = 64;
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ph = rnd() * Math.PI * 2;
  const wob = 0.05 + rnd() * 0.04;
  const squash = 0.9 + rnd() * 0.15;
  const tilt = rnd() * Math.PI;
  const end = Math.max(2, Math.floor(n * turns * Math.min(1, progress)));
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = color;
    g.globalAlpha = pass ? 0.45 : 0.82;
    g.lineWidth = pass ? 1.1 : 2.6;
    g.beginPath();
    for (let k = 0; k <= end; k++) {
      const a = ph + (k / n) * Math.PI * 2;
      const rr = r * (1 + wob * Math.sin(a * 2.3 + seed) + 0.035 * Math.sin(a * 7.1) + (k / (n * turns)) * 0.06);
      const px = Math.cos(a) * rr + (pass ? 0.7 : 0);
      const py = Math.sin(a) * rr * squash + (pass ? -0.6 : 0);
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

// Pencil cross «✕» (visible wreck / start point).
export function pencilCross(g, x, y, s, color = '#C8102E') {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(x - s, y - s);
  g.lineTo(x + s, y + s * 0.9);
  g.moveTo(x + s, y - s * 0.95);
  g.lineTo(x - s * 0.9, y + s);
  g.stroke();
  g.restore();
}

// Meteorological front: polyline (screen px) with symbols facing `dir` (unit vector of motion).
// kind: 'cold' (blue triangles), 'warm' (red semicircles), 'occluded' (purple alternating).
export function drawFront(g, pts, kind, dirX, dirY, fs = 1) {
  if (pts.length < 4) return;
  const col = kind === 'cold' ? PAPER.cold : kind === 'warm' ? PAPER.warm : PAPER.occl;
  g.save();
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 2.4;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
  // symbols every ~34 px of arc length along the line
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  const step = 34 * fs;
  let idx = 0;
  let seg = 2;
  let segStart = 0;
  for (let sPos = step * 0.5; sPos < total; sPos += step, idx++) {
    let L = Math.hypot(pts[seg] - pts[seg - 2], pts[seg + 1] - pts[seg - 1]);
    while (segStart + L < sPos && seg + 2 < pts.length) {
      segStart += L;
      seg += 2;
      L = Math.hypot(pts[seg] - pts[seg - 2], pts[seg + 1] - pts[seg - 1]);
    }
    const t = L > 0 ? (sPos - segStart) / L : 0;
    const x0 = pts[seg - 2];
    const y0 = pts[seg - 1];
    const tx = L > 0 ? (pts[seg] - x0) / L : 1;
    const ty = L > 0 ? (pts[seg + 1] - y0) / L : 0;
    const x = x0 + tx * L * t;
    const y = y0 + ty * L * t;
    // normal pointing along the motion direction
    let nx = -ty;
    let ny = tx;
    if (nx * dirX + ny * dirY < 0) {
      nx = -nx;
      ny = -ny;
    }
    const sym = kind === 'occluded' ? (idx % 2 ? 'warm' : 'cold') : kind;
    const sz = 7 * fs;
    g.beginPath();
    if (sym === 'cold') {
      g.moveTo(x - tx * sz, y - ty * sz);
      g.lineTo(x + nx * sz * 1.25, y + ny * sz * 1.25);
      g.lineTo(x + tx * sz, y + ty * sz);
    } else {
      // semicircle bulging along the normal
      const a = Math.atan2(ty, tx);
      const ccw = nx * -ty + ny * tx > 0; // anticlockwise from a+π to a passes through a+π/2 = (−ty, tx)
      g.moveTo(x - tx * sz, y - ty * sz);
      g.arc(x, y, sz, a + Math.PI, a, ccw);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
}

// Meteorological wind barb (shaft toward where the wind comes FROM). Speed in m/s → knots.
export function drawWindBarb(g, x, y, fromDeg, ms, len = 34, color = PAPER.ink) {
  const kt = ms * 1.944;
  const a = fromDeg * DEG;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, 3, 0, Math.PI * 2);
  g.stroke();
  const ex = x + dx * len;
  const ey = y + dy * len;
  g.beginPath();
  g.moveTo(x + dx * 3, y + dy * 3);
  g.lineTo(ex, ey);
  g.stroke();
  // feathers on the clockwise side
  const nx = -dy;
  const ny = dx;
  let k = Math.round(kt / 5) * 5;
  let pos = 0;
  const fl = 11;
  while (k >= 50) {
    const bx = ex - dx * pos;
    const by = ey - dy * pos;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + nx * fl, by + ny * fl);
    g.lineTo(bx - dx * 6, by - dy * 6);
    g.fill();
    pos += 8;
    k -= 50;
  }
  while (k >= 10) {
    const bx = ex - dx * pos;
    const by = ey - dy * pos;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + nx * fl + dx * 3, by + ny * fl + dy * 3);
    g.stroke();
    pos += 5;
    k -= 10;
  }
  if (k >= 5) {
    if (pos === 0) pos = 5;
    const bx = ex - dx * pos;
    const by = ey - dy * pos;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + nx * fl * 0.55 + dx * 1.5, by + ny * fl * 0.55 + dy * 1.5);
    g.stroke();
  }
  g.restore();
}

// Compass rose (simplified): ring with degree ticks, north star «С».
export function drawRose(g, x, y, r, color = PAPER.ink, fs = 1) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 0.9;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(x, y, r * 0.78, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  for (let d = 0; d < 360; d += 10) {
    const a = d * DEG;
    const l = d % 30 === 0 ? 0.2 : 0.1;
    g.moveTo(x + Math.sin(a) * r, y - Math.cos(a) * r);
    g.lineTo(x + Math.sin(a) * r * (1 - l), y - Math.cos(a) * r * (1 - l));
  }
  g.stroke();
  // star
  const st = (a, l, w) => {
    const ca = Math.sin(a);
    const sa = -Math.cos(a);
    const px = -sa;
    const py = ca;
    g.beginPath();
    g.moveTo(x + ca * l, y + sa * l);
    g.lineTo(x + px * w, y + py * w);
    g.lineTo(x - px * w, y - py * w);
    g.closePath();
  };
  for (let k = 0; k < 4; k++) {
    st(k * 90 * DEG, r * 0.72, r * 0.09);
    if (k === 0) g.fill();
    else g.stroke();
  }
  g.font = `700 ${Math.round(11 * fs)}px Oswald, Impact, "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText('С', x, y - r - 2);
  g.restore();
}

// Scale bar «0 — 500 м — 1 км».
export function drawScaleBar(g, x, y, scale, color = PAPER.ink, fs = 1) {
  const metres = scale * 1000 > 260 ? 500 : 1000;
  const seg = metres / 2;
  const w = seg * scale;
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const x0 = x + (i * w) / 2;
    g.strokeRect(x0 + 0.5, y + 0.5, w / 2, 5);
    if (i % 2 === 0) g.fillRect(x0 + 0.5, y + 0.5, w / 2, 5);
  }
  g.font = `${Math.round(9 * fs)}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText('0', x, y + 8);
  g.fillText(`${metres}`, x + w, y + 8);
  g.fillText(`${metres * 2 >= 1000 ? `${(metres * 2) / 1000} км` : `${metres * 2} м`}`, x + 2 * w, y + 8);
  g.restore();
}

// Altitude → track colour (DESIGN §7.7: #1E7FA0 low → #F4FBF8 high).
export function altColor(alt) {
  const t = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, alt) / 120)));
  const a = [0x1e, 0x7f, 0xa0];
  const b = [0xf4, 0xfb, 0xf8];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
