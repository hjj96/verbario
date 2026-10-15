// Geometry helpers for the world (DESIGN §2.11): baking many parts into ONE vertex-coloured
// geometry (core/look.js merge + per-part surface attributes), procedural rocks (displaced
// icosahedra), ship hulls, lattice members and small part factories.
//
// Every baked geometry carries:
//   position, normal, color (look.merge), uv (decal atlas coordinates; (ground y, 1) for a part
//   with `ground`; 0 when unused),
//   aSurf vec4 = (roughness, metalness, emissive gain | wear code, channel) — channel < 0 marks a
//   decal surface; emissive gain −1 = natural rock; −0.05…−0.45 = per-part wear (worn()).
// The prop material (materials.js) reads aSurf, so one draw call can mix paint, steel, rubber,
// glass, lamps and painted deck markings.
import * as THREE from 'three';

// --------------------------------------------------------------------------------------------
// Surface presets: [roughness, metalness, emissive gain, channel]. Channel indices live in
// materials.js (CH); a negative channel = decal surface (samples the place's canvas decal).
export const SURF = {
  paint: [0.55, 0, 0, 0],
  gloss: [0.32, 0, 0, 0],
  steel: [0.42, 0.55, 0, 0],
  rust: [0.82, 0.15, 0, 0],
  rubber: [0.8, 0, 0, 0],
  rock: [0.93, 0, -1, 0], // emissive gain −1 = natural rock flag (wet waterline band in the prop shader)
  concrete: [0.88, 0, 0, 0],
  wood: [0.85, 0, 0, 0],
  glass: [0.07, 0, 0, 0],
  fabric: [0.9, 0, 0, 0],
  decal: [0.62, 0, 0, -1],
};
// Emissive surface: lamp lens / lit window on channel ch (dark glass while the channel is off).
export const emit = (ch, gain = 1, rough = 0.12) => [rough, 0, gain, ch];

// Per-part weathering level (see materials.js header). aSurf.z == 0 → the material's default wear;
// aSurf.z in −0.05…−0.45 → this part's own level: 0 clean · 1/3 light · 2/3 medium · 1 heavy.
// worn(SURF.steel, 'heavy') or worn(SURF.paint, 0.5); a part may also carry `wear: 'heavy'`.
export const WEAR_LEVEL = { clean: 0, light: 1 / 3, medium: 2 / 3, heavy: 1 };
export const wearZ = (level) => -(0.05 + 0.4 * Math.min(1, Math.max(0, typeof level === 'string' ? WEAR_LEVEL[level] ?? 1 / 3 : level)));
export const worn = (surf, level, rough = null) => [rough ?? surf[0], surf[1], surf[2] === 0 ? wearZ(level) : surf[2], surf[3]];
SURF.paintWorn = worn(SURF.paint, 'medium', 0.62);
SURF.paintFaded = worn(SURF.paint, 'light', 0.7);
SURF.steelRusty = worn([0.6, 0.45, 0, 0], 'heavy');
SURF.steelWorn = worn(SURF.steel, 'medium');
SURF.concreteStained = worn(SURF.concrete, 'medium');
SURF.concreteWet = worn(SURF.concrete, 'heavy', 0.8);

// Bake a vertex-colour field into a geometry (used with part.vcol): fn(x, y, z, out: Color) gets
// the geometry's own (pre-transform) vertex position and writes the colour (multiplied by
// part.color at bake time). Grime gradients, rust bleeds, band fades — no textures.
const _sc = new THREE.Color();
export function shadeVerts(geometry, fn) {
  const pos = geometry.attributes.position;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _sc.setRGB(1, 1, 1);
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _sc);
    c[i * 3] = _sc.r;
    c[i * 3 + 1] = _sc.g;
    c[i * 3 + 2] = _sc.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geometry;
}

// Shared unit primitives. look.merge clones them, so they are never mutated.
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl20: new THREE.CylinderGeometry(1, 1, 1, 20),
  cyl32: new THREE.CylinderGeometry(1, 1, 1, 32),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  cone16: new THREE.ConeGeometry(1, 1, 16),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  hemi: new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.24, 6, 16),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), // horizontal, faces +Y
  oct: new THREE.CylinderGeometry(1, 1, 1, 8).rotateY(Math.PI / 8), // flat side toward ±X/±Z
  prism: prismGeometry(), // gable roof: ridge along X, base y = 0 (z −0.5…0.5), apex y = 1
};

// Unit gable prism (roof): triangle (z −0.5 → apex y 1 at z 0 → z 0.5) extruded along X −0.5…0.5.
function prismGeometry() {
  const a = [-0.5, 0, -0.5], b = [-0.5, 0, 0.5], c = [-0.5, 1, 0];
  const d = [0.5, 0, -0.5], e = [0.5, 0, 0.5], f = [0.5, 1, 0];
  const tris = [
    a, c, b, d, e, f, // gable ends
    a, d, f, a, f, c, // north slope
    b, c, f, b, f, e, // south slope
    a, b, e, a, e, d, // underside
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

// Part factory: p(geometry, colour, [x,y,z], [sx,sy,sz] | s, [rx,ry,rz], surf)
export function p(geometry, color, position, scale = 1, rotation = null, surf = SURF.paint) {
  return { geometry, color, position, scale, rotation: rotation || undefined, surf };
}

// A thin member (cylinder) between two points a → b.
const _ma = new THREE.Vector3();
const _mb = new THREE.Vector3();
const _md = new THREE.Vector3();
const _mq = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
export function member(a, b, radius, color, surf = SURF.steel, geometry = UNIT.cyl6) {
  _ma.fromArray(a);
  _mb.fromArray(b);
  _md.subVectors(_mb, _ma);
  const len = _md.length();
  _mq.setFromUnitVectors(_UP, _md.normalize());
  const m = new THREE.Matrix4().compose(
    _ma.clone().add(_mb).multiplyScalar(0.5),
    _mq,
    new THREE.Vector3(radius, len, radius),
  );
  return { geometry, color, matrix: m, surf };
}

// Box member between two points (rectangular section w × h, h along the "up-ish" axis).
export function beam(a, b, w, h, color, surf = SURF.steel) {
  _ma.fromArray(a);
  _mb.fromArray(b);
  _md.subVectors(_mb, _ma);
  const len = _md.length();
  _mq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _md.normalize());
  const m = new THREE.Matrix4().compose(_ma.clone().add(_mb).multiplyScalar(0.5), _mq, new THREE.Vector3(w, h, len));
  return { geometry: UNIT.box, color, matrix: m, surf };
}

// --------------------------------------------------------------------------------------------
// bake(): look.merge + aSurf + per-vertex colours for parts that bring their own (part.vcol) +
// decal uv remap (part.uvRect = [u0, v0, u1, v1]).
// Shadow LOD: part.shadow === false keeps a part out of the shadow pass (dense detail whose cast
// shadow a coarse stand-in already gives), part.shadow === 'only' draws it in the shadow pass only
// (that stand-in). The parts are then ordered [main only | both | shadow only]; drawRange covers the
// main pass and geometry.userData.shadowRange the shadow pass (terrain.js shadowLod swaps them).
const _tint = new THREE.Color();
const _ts = new THREE.Vector3(), _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _tb = new THREE.Vector3();
// Sticks thinner than d across (braces, seams, mullions, glazing bars) leave the shadow pass: below
// one shadow-map texel (250 m / 2048 ≈ 0.12 m on high) they only alias into broken dashes.
export function thinNoShadow(parts, d = 0.09) {
  for (const q of parts) {
    if (q.shadow !== undefined) continue;
    const g = q.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox.getSize(_tb);
    if (q.matrix) q.matrix.decompose(_tp, _tq, _ts);
    else if (q.scale === undefined) _ts.set(1, 1, 1);
    else if (typeof q.scale === 'number') _ts.setScalar(q.scale);
    else _ts.set(...q.scale);
    const e = [_tb.x * Math.abs(_ts.x), _tb.y * Math.abs(_ts.y), _tb.z * Math.abs(_ts.z)].sort((a, b) => a - b);
    if (e[1] < d) q.shadow = false;
  }
  return parts;
}
export function bake(look, parts) {
  const main = parts.filter((q) => q.shadow === false), only = parts.filter((q) => q.shadow === 'only');
  if (main.length || only.length) parts = [...main, ...parts.filter((q) => q.shadow !== false && q.shadow !== 'only'), ...only];
  for (const part of parts) ensureUv(part.geometry);
  const geo = look.merge(parts);
  const n = geo.attributes.position.count;
  const surf = new Float32Array(n * 4);
  const col = geo.attributes.color.array;
  const uv = geo.attributes.uv ? geo.attributes.uv.array : null;
  let off = 0;
  for (const part of parts) {
    const g = part.geometry;
    const idx = g.index;
    const cnt = idx ? idx.count : g.attributes.position.count;
    let s = part.surf || SURF.paint;
    if (part.wear !== undefined && s[2] === 0) s = worn(s, part.wear);
    for (let i = 0; i < cnt; i++) {
      const j = (off + i) * 4;
      surf[j] = s[0];
      surf[j + 1] = s[1];
      surf[j + 2] = s[2];
      surf[j + 3] = s[3];
    }
    if (part.vcol && g.attributes.color) {
      const src = g.attributes.color;
      _tint.set(part.color !== undefined ? part.color : 0xffffff);
      for (let i = 0; i < cnt; i++) {
        const k = idx ? idx.getX(i) : i;
        const j = (off + i) * 3;
        col[j] = src.getX(k) * _tint.r;
        col[j + 1] = src.getY(k) * _tint.g;
        col[j + 2] = src.getZ(k) * _tint.b;
      }
    }
    if (uv) {
      const r = part.uvRect;
      for (let i = 0; i < cnt; i++) {
        const j = (off + i) * 2;
        if (r) {
          uv[j] = r[0] + uv[j] * (r[2] - r[0]);
          uv[j + 1] = r[1] + uv[j + 1] * (r[3] - r[1]);
        } else if (part.ground !== undefined) {
          // non-decal part standing on land: uv = (ground y, 1) → base grime / salt / algae
          // gather above that height instead of above the sea (materials.js)
          uv[j] = part.ground;
          uv[j + 1] = 1;
        } else {
          uv[j] = 0;
          uv[j + 1] = 0;
        }
      }
    }
    off += cnt;
  }
  geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
  if (main.length || only.length) {
    const verts = (list) => list.reduce((s, q) => s + (q.geometry.index ? q.geometry.index.count : q.geometry.attributes.position.count), 0);
    const n0 = verts(main), n2 = verts(only);
    geo.setDrawRange(0, n - n2);
    geo.userData.shadowRange = [n0, n - n0];
  }
  return geo;
}

function ensureUv(g) {
  if (g.attributes.uv) return;
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
}

// --------------------------------------------------------------------------------------------
// Deterministic 3D value noise (for rock displacement: a pure function of position keeps the
// non-indexed icosahedron watertight).
function h3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    r += w * h3(xi + dx, yi + dy, zi + dz, s);
  }
  return r;
}
export function fbm3(x, y, z, s, oct = 3) {
  let a = 0.5, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise3(x, y, z, s + o * 13);
    n += a;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    a *= 0.5;
  }
  return sum / n;
}

// Seeded tiny RNG (mulberry32) for build-time variation.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------------------------
// Rock: displaced icosahedron, base #2E3437 with lichen on sunny tops, guano on the crown, darker
// crevices and colour variation per vertex. Normals are mostly smooth with a little of the facet
// kept (stylised, but reads as weathered granite, not a crude low-poly blob); the wet band at the
// waterline is drawn by the prop shader in world metres (aSurf.z = −1). Unit size: x,z ≈ [−1, 1],
// y ∈ [−0.3, 1]. opts.detail = icosahedron subdivision (r185: (n+1)²·20 triangles).
const ROCK_BASE = new THREE.Color('#2E3437');
const ROCK_WARM = new THREE.Color('#3A3833');
const ROCK_DARK = new THREE.Color('#22282B');
const ROCK_LICHEN = new THREE.Color('#77775C');
const ROCK_ORANGE = new THREE.Color('#8A6A3A'); // xanthoria lichen specks on sea cliffs
const ROCK_MOSS = new THREE.Color('#5A6644');
const ROCK_GUANO = new THREE.Color('#A8AAA2');
const ROCK_ALGAE = new THREE.Color('#1F2A22');
const FACET = 0.28; // share of the flat facet normal kept in the shading normal
// opts: detail, spire (0..1 pinnacle), rough (displacement), terrace (0..1 ledge strength),
// moss (0..1 tundra on flat tops — island crowns).
export function rockGeometry(seed, { detail = 4, spire = 0, rough = 0.5, terrace = 0.65, moss = 0 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  const shear = h3(seed, 1, 2, 3) - 0.5;
  const disp = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = fbm3(v.x * 1.25 + 3.1, v.y * 1.25, v.z * 1.25, seed, 3);
    const n2 = vnoise3(v.x * 3.4, v.y * 3.4 + 7.7, v.z * 3.4, seed + 5);
    const n3 = vnoise3(v.x * 7.5 + 2.2, v.y * 7.5, v.z * 7.5 - 1.4, seed + 13);
    const ridge = 1 - Math.abs(2 * vnoise3(v.x * 2.1 + 1.3, v.y * 2.1, v.z * 2.1, seed + 9) - 1);
    const r = 1 + rough * 2 * (n1 - 0.5) + 0.16 * (n2 - 0.5) + 0.12 * (ridge - 0.5) + 0.05 * (n3 - 0.5);
    disp[i] = r;
    v.multiplyScalar(r);
    // squash the underside (rocks sit on the sea floor), lift the crown for spires
    if (v.y < 0) v.y *= 0.4;
    if (spire > 0 && v.y > 0) {
      const k = v.y;
      v.y *= 1 + spire * 1.2;
      v.x *= 1 - 0.55 * spire * k;
      v.z *= 1 - 0.55 * spire * k;
    }
    // shear so the outline is never symmetric
    v.x += 0.18 * v.y * shear;
    pos.setXYZ(i, v.x, v.y, v.z);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  // normalise y ∈ [−0.3, 1] and cut granite ledges (terraces): flat tops, steep risers
  const span = maxY - minY || 1;
  const steps = 5 + Math.floor(h3(seed, 7, 7, 7) * 3);
  for (let i = 0; i < pos.count; i++) {
    let y = (pos.getY(i) - minY) / span;
    if (terrace > 0) {
      const t = y * steps;
      const f = t - Math.floor(t);
      const ter = (Math.floor(t) + smooth01((f - 0.25) / 0.5)) / steps;
      y = y + (ter - y) * terrace;
    }
    pos.setY(i, -0.3 + y * 1.3);
  }
  g.computeVertexNormals(); // non-indexed → flat facet normals
  // Smooth normals: vertices sharing a position (the geometry is non-indexed) average their facets.
  const nrm = g.attributes.normal;
  const acc = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = (keys[i] = key(i));
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += nrm.getX(i);
    a[1] += nrm.getY(i);
    a[2] += nrm.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(keys[i]);
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    v.set(nrm.getX(i) * FACET + (a[0] / l) * (1 - FACET), nrm.getY(i) * FACET + (a[1] / l) * (1 - FACET), nrm.getZ(i) * FACET + (a[2] / l) * (1 - FACET)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  // Per-vertex colour (shared positions get the same colour → no faceted patchwork).
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const cx = pos.getX(i), cy = pos.getY(i), cz = pos.getZ(i);
    const a = acc.get(keys[i]);
    const ny = a[1] / (Math.hypot(a[0], a[1], a[2]) || 1);
    const tone = fbm3(cx * 1.6 + 5.0, cy * 1.6, cz * 1.6, seed + 41, 2);
    c.copy(ROCK_BASE).lerp(ROCK_WARM, smooth01((tone - 0.35) / 0.4));
    if (ny < 0.3) c.lerp(ROCK_DARK, 0.55 * smooth01((0.3 - ny) / 0.5));
    // faint strata along the terraces, broken up by noise
    const strata = Math.sin((cy * steps + 0.8 * (tone - 0.5)) * Math.PI * 2);
    c.multiplyScalar(0.94 + 0.06 * strata + 0.16 * (fbm3(cx * 6, cy * 6, cz * 6, seed + 11, 2) - 0.5));
    // crevices: displaced inward → darker (cheap cavity occlusion)
    c.multiplyScalar(0.72 + 0.28 * smooth01((disp[i] - 0.78) / 0.32));
    const patch = fbm3(cx * 3.5, cy * 3.5, cz * 3.5, seed + 21, 2);
    if (ny > 0.5) {
      c.lerp(ROCK_LICHEN, Math.min(0.55, (ny - 0.5) * 1.5) * smooth01((patch - 0.38) / 0.25));
      if (moss > 0 && cy > 0.25) c.lerp(ROCK_MOSS, moss * smooth01((patch - 0.42) / 0.2) * smooth01((ny - 0.7) / 0.2));
    }
    if (cy > 0.2 && cy < 0.8 && ny > 0.2) c.lerp(ROCK_ORANGE, 0.45 * smooth01((fbm3(cx * 9, cy * 9, cz * 9, seed + 51, 2) - 0.62) / 0.1));
    if (cy > 0.78 && ny > 0.3) c.lerp(ROCK_GUANO, 0.2 + 0.35 * fbm3(cx * 6, cy * 6, cz * 6, seed + 31, 2));
    if (cy < 0.08) c.lerp(ROCK_ALGAE, 0.35 * smooth01((0.08 - cy) / 0.12));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function smooth01(x) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

// --------------------------------------------------------------------------------------------
// Ship hull: stations from stern (+z) to bow (−z). Each station: half-beam at deck, deck height
// (sheer), keel depth. Cross-section: deck edge → flared side → bilge → keel. Vertex colours:
// grey topsides, white boot-top at the waterline, dark red antifouling below, optional diagonal
// rescue stripe near the bow (human orange — DESIGN §1.1). Returns a non-indexed geometry with
// its own colour attribute (bake with vcol: true).
export function hullGeometry({
  length = 72,
  beam = 15,
  deckAft = 5.5,
  deckFwd = 7.4,
  keel = 3.6,
  transom = 0.82, // stern width fraction
  bowStart = 0.62, // 0..1 from stern where the bow taper starts
  rake = 6, // stem rake (deck-level stem sits this much ahead of the forefoot)
  stations = 22,
  topside = '#5C6670',
  antifoul = '#5B2622',
  boot = '#E6E6E0',
  stripe = '#FF5A1F',
  stripeAt = 0.78, // stripe position along the hull (0 stern .. 1 bow)
} = {}) {
  const ring = [
    // [lateral fraction of half-beam, height fraction: 1 = deck, 0 = waterline, −1 = keel]
    [1.0, 1.0],
    [1.02, 0.55],
    [1.0, 0.12],
    [0.98, 0.0],
    [0.94, -0.35],
    [0.78, -0.75],
    [0.42, -0.97],
    [0.0, -1.0],
  ];
  const cols = { top: new THREE.Color(topside), af: new THREE.Color(antifoul), boot: new THREE.Color(boot), st: new THREE.Color(stripe) };
  const rows = [];
  for (let i = 0; i <= stations; i++) {
    const s = i / stations; // 0 stern → 1 bow
    const z = length / 2 - s * length;
    // plan shape: transom → full → bow taper (sine)
    let b = 1;
    if (s < 0.12) b = transom + (1 - transom) * Math.sin((s / 0.12) * Math.PI * 0.5);
    if (s > bowStart) b = Math.cos(((s - bowStart) / (1 - bowStart)) * Math.PI * 0.5);
    b = Math.max(0, b);
    const deck = deckAft + (deckFwd - deckAft) * Math.pow(s, 2.2);
    const tip = s > bowStart ? (s - bowStart) / (1 - bowStart) : 0;
    rows.push({ s, z, b, deck, tip });
  }
  const P = [];
  const C = [];
  const pt = (row, k, side) => {
    const [lf, hf] = ring[k];
    const y = hf >= 0 ? hf * row.deck : hf * keel * (1 - 0.55 * row.tip * row.tip);
    // flare: the bow sections are narrower below the waterline
    const lat = side * lf * (beam / 2) * row.b * (hf < 0 ? 1 - 0.35 * row.tip : 1 + 0.08 * row.tip * hf);
    const z = row.z - (row.tip > 0 ? rake * row.tip * row.tip * (hf + 1) * 0.5 : 0);
    return [lat, y, z];
  };
  const colorAt = (row, y) => {
    if (y < -0.25) return cols.af;
    if (y < 0.55) return cols.boot;
    // diagonal rescue stripe on the bow topsides (two bands)
    const sd = row.s - stripeAt + (y / row.deck) * 0.05;
    if (stripe && ((sd > 0 && sd < 0.035) || (sd > 0.05 && sd < 0.062))) return cols.st;
    return cols.top;
  };
  const push = (a, ca) => {
    P.push(a[0], a[1], a[2]);
    C.push(ca.r, ca.g, ca.b);
  };
  for (let i = 0; i < stations; i++) {
    const r0 = rows[i], r1 = rows[i + 1];
    for (const side of [-1, 1]) {
      for (let k = 0; k < ring.length - 1; k++) {
        const a = pt(r0, k, side), b = pt(r0, k + 1, side), c = pt(r1, k, side), d = pt(r1, k + 1, side);
        const ym = (a[1] + b[1] + c[1] + d[1]) / 4;
        const col = colorAt(r0, ym);
        // winding: outward normals
        if (side > 0) {
          push(a, col); push(b, col); push(c, col);
          push(b, col); push(d, col); push(c, col);
        } else {
          push(a, col); push(c, col); push(b, col);
          push(b, col); push(c, col); push(d, col);
        }
      }
    }
  }
  // transom (flat stern plate)
  const r0 = rows[0];
  for (let k = 0; k < ring.length - 1; k++) {
    const a = pt(r0, k, -1), b = pt(r0, k + 1, -1), c = pt(r0, k, 1), d = pt(r0, k + 1, 1);
    const col = colorAt(r0, (a[1] + b[1]) / 2);
    push(a, col); push(c, col); push(b, col);
    push(b, col); push(c, col); push(d, col);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  smoothHullNormals(g);
  return { geometry: g, rows, deckAt: (z) => deckHeightAt(rows, z), halfBeamAt: (z) => halfBeamAt(rows, z, beam) };
}

// Average normals of coincident vertices so the hull reads rounded, not faceted.
function smoothHullNormals(g) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const map = new Map();
  const key = (i) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let e = map.get(k);
    if (!e) map.set(k, (e = [0, 0, 0, []]));
    e[0] += nrm.getX(i);
    e[1] += nrm.getY(i);
    e[2] += nrm.getZ(i);
    e[3].push(i);
  }
  for (const e of map.values()) {
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    for (const i of e[3]) nrm.setXYZ(i, e[0] / l, e[1] / l, e[2] / l);
  }
}

function deckHeightAt(rows, z) {
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (z <= a.z && z >= b.z) {
      const t = (a.z - z) / (a.z - b.z || 1);
      return a.deck + (b.deck - a.deck) * t;
    }
  }
  return rows[rows.length - 1].deck;
}
function halfBeamAt(rows, z, beam) {
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (z <= a.z && z >= b.z) {
      const t = (a.z - z) / (a.z - b.z || 1);
      return ((a.b + (b.b - a.b) * t) * beam) / 2;
    }
  }
  return 0;
}

// Deck plate following the hull plan at height y(z) — triangles fan between port/starboard edges.
export function deckGeometry(hull, zFrom, zTo, inset = 0.25, steps = 16) {
  const P = [];
  for (let i = 0; i < steps; i++) {
    const za = zFrom + ((zTo - zFrom) * i) / steps;
    const zb = zFrom + ((zTo - zFrom) * (i + 1)) / steps;
    const ya = hull.deckAt(za), yb = hull.deckAt(zb);
    const ba = Math.max(0, hull.halfBeamAt(za) - inset), bb = Math.max(0, hull.halfBeamAt(zb) - inset);
    // two triangles, facing +Y
    P.push(-ba, ya, za, ba, ya, za, -bb, yb, zb);
    P.push(ba, ya, za, bb, yb, zb, -bb, yb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  // ensure upward normals (winding depends on z direction)
  const n = g.attributes.normal;
  if (n.getY(0) < 0) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
    }
  }
  return g;
}

// Rail / safety net ring: thin posts + top rail along a polyline (closed when loop).
export function railParts(points, y0, h, color, { loop = false, post = 2.2, r = 0.05 } = {}) {
  const parts = [];
  const n = points.length;
  const segs = loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % n];
    parts.push(member([a[0], y0 + h, a[1]], [b[0], y0 + h, b[1]], r, color));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cnt = Math.max(1, Math.round(len / post));
    for (let k = 0; k < cnt; k++) {
      const t = k / cnt;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      parts.push(member([x, y0, z], [x, y0 + h, z], r * 0.9, color));
    }
  }
  return parts;
}

// Lattice tower (derrick, flare boom, crane boom): 4 chords + zig-zag bracing between two
// square frames. a/b = base/top centres, wa/wb = half-widths.
export function latticeParts(a, b, wa, wb, color, { bays = 8, r = 0.12, brace = 0.07 } = {}) {
  const parts = [];
  const A = new THREE.Vector3().fromArray(a);
  const B = new THREE.Vector3().fromArray(b);
  const axis = new THREE.Vector3().subVectors(B, A).normalize();
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const corner = (t, i) => {
    const w = wa + (wb - wa) * t;
    const su = i === 0 || i === 3 ? -1 : 1;
    const sv = i < 2 ? -1 : 1;
    return new THREE.Vector3().lerpVectors(A, B, t).addScaledVector(u, su * w).addScaledVector(v, sv * w).toArray();
  };
  for (let i = 0; i < 4; i++) parts.push(member(corner(0, i), corner(1, i), r, color));
  for (let k = 0; k < bays; k++) {
    const t0 = k / bays, t1 = (k + 1) / bays;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      parts.push(member(corner(t0, i), corner(t0, j), brace, color));
      parts.push(member(corner(t0, k % 2 ? i : j), corner(t1, k % 2 ? j : i), brace, color));
    }
  }
  for (let i = 0; i < 4; i++) parts.push(member(corner(1, i), corner(1, (i + 1) % 4), brace, color));
  return parts;
}

// Row of windows along a box face: returns small emissive quads (thin boxes) slightly proud of
// the face. face: 'x+', 'x-', 'z+', 'z-'. centre/size describe the building box.
export function windowParts(centre, size, face, { rows = 1, cols = 4, w = 1.0, h = 0.7, ch = 1, color = '#FFC98A', y0 = null, gap = null, gain = 1 } = {}) {
  const parts = [];
  const [cx, cy, cz] = centre;
  const [sx, sy, sz] = size;
  const horizontalLen = face[0] === 'x' ? sz : sx;
  const step = gap || horizontalLen / cols;
  const rowStep = sy / (rows + 1);
  for (let r = 0; r < rows; r++) {
    const y = y0 !== null ? y0 + r * (h * 1.9) : cy - sy / 2 + rowStep * (r + 1);
    for (let c = 0; c < cols; c++) {
      const t = -horizontalLen / 2 + step * (c + 0.5) + (horizontalLen - step * cols) / 2;
      let pos, scale;
      if (face === 'x+' || face === 'x-') {
        const x = cx + (face === 'x+' ? sx / 2 + 0.03 : -sx / 2 - 0.03);
        pos = [x, y, cz + t];
        scale = [0.08, h, w];
      } else {
        const z = cz + (face === 'z+' ? sz / 2 + 0.03 : -sz / 2 - 0.03);
        pos = [cx + t, y, z];
        scale = [w, h, 0.08];
      }
      parts.push(p(UNIT.box, color, pos, scale, null, emit(ch, gain)));
    }
  }
  return parts;
}

// Flat disc / annulus part on the XZ plane (deck markings, pads).
export function ringGeometry(inner, outer, seg = 48) {
  return new THREE.RingGeometry(inner, outer, seg, 1).rotateX(-Math.PI / 2);
}
