// Shared look layer (DESIGN.md §2.6.4, §2.7.4, §8.1):
//  * procedural noise atlas textures + CPU samplers (what you SEE on the water is what PUSHES the heli)
//  * shared uniforms object (time, wind, rain, flash, …) — reference these objects from any material
//  * gust-field / gust-front / cloud-shadow functions with matching CPU and GLSL versions
//  * top-down fog patch (horizontal distance from the screen-centre focus point, height falloff)
//  * keyline (inverted hull, constant screen thickness) material factory
//  * geometry merge helper with baked vertex colours (BufferGeometryUtils is not vendored)
import * as THREE from 'three';

const ATLAS = 256;
const LACE = 512;
const DETAIL = 256;

// Scales shared by CPU + GLSL (world metres -> atlas uv).
export const GUST_SCALE = 0.006; // 1 atlas tile ≈ 167 m
export const GUST_DRIFT = 0.9; // gust pattern moves at 0.9 × wind
export const CLOUD_SCALE = 0.0025; // 1 tile = 400 m
export const CLOUD_DRIFT = 1.5; // cloud shadows move faster than surface wind

// ---------------------------------------------------------------------------------------------
// Deterministic hash helpers
function hash2i(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Periodic value noise on a lattice with `period` cells over [0,1).
function periodicValueNoise(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const m = (a) => ((a % period) + period) % period;
  const a = hash2i(m(xi), m(yi), seed);
  const b = hash2i(m(xi + 1), m(yi), seed);
  const c = hash2i(m(xi), m(yi + 1), seed);
  const d = hash2i(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function periodicFbm(u, v, basePeriod, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0, p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u, v, p, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

// Tileable Worley: returns [F1, F2] in cell units (0..~1.5).
function worley(u, v, cells, seed, out) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + hash2i(wx, wy, seed);
      const py = cy + hash2i(wx, wy, seed + 101);
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  out[0] = f1;
  out[1] = f2;
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Texture generation (≈100–200 ms total, done once at boot)
function makeAtlas(seed) {
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  const w = [0, 0];
  for (let y = 0; y < ATLAS; y++) {
    for (let x = 0; x < ATLAS; x++) {
      const u = x / ATLAS;
      const v = y / ATLAS;
      const r = periodicFbm(u, v, 4, 4, seed);
      worley(u, v, 8, seed + 7, w);
      const i = (y * ATLAS + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, (r - 0.15) / 0.7)) * 255);
      data[i + 1] = Math.round(Math.min(1, w[0] / 1.0) * 255);
      data[i + 2] = Math.round(Math.min(1, (w[1] - w[0]) / 0.8) * 255);
      data[i + 3] = Math.round(hash2i(x, y, seed + 99) * 255);
    }
  }
  return data;
}

// Slopes of a tileable sum of sines with integer wave vectors. R,G = dh/du, dh/dv (normalised to
// [-1,1] by maxSlope, stored 0..1), B = height 0..1, A = 1.
function makeDetail(seed) {
  const waves = [];
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (waves.length < 30) {
    const ang = (rnd() - 0.5) * 2 * (Math.PI / 2) * (1 / 4) * 2; // anisotropy ~4: ±45° spread, mostly ±22°
    const mag = 2 + Math.floor(rnd() * 22);
    const kx = Math.round(Math.cos(ang) * mag);
    const ky = Math.round(Math.sin(ang) * mag);
    if (kx === 0 && ky === 0) continue;
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: Math.pow(k, -1.5), ph: rnd() * Math.PI * 2 });
  }
  const n = DETAIL * DETAIL;
  const su = new Float32Array(n);
  const sv = new Float32Array(n);
  const hh = new Float32Array(n);
  let maxS = 1e-6, minH = Infinity, maxH = -Infinity;
  for (let y = 0; y < DETAIL; y++) {
    for (let x = 0; x < DETAIL; x++) {
      const u = x / DETAIL;
      const v = y / DETAIL;
      let h = 0, du = 0, dv = 0;
      for (const wv of waves) {
        const ph = 2 * Math.PI * (wv.kx * u + wv.ky * v) + wv.ph;
        h += wv.a * Math.sin(ph);
        const c = wv.a * 2 * Math.PI * Math.cos(ph);
        du += c * wv.kx;
        dv += c * wv.ky;
      }
      const i = y * DETAIL + x;
      su[i] = du;
      sv[i] = dv;
      hh[i] = h;
      maxS = Math.max(maxS, Math.abs(du), Math.abs(dv));
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = Math.round((su[i] / maxS * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((sv[i] / maxS * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(((hh[i] - minH) / (maxH - minH)) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, maxSlope: maxS };
}

// Foam lace: R = 3-octave Worley lace with fbm holes, G = large blotches, B = fine lace only, A = 255.
function makeLace(seed) {
  const data = new Uint8Array(LACE * LACE * 4);
  const w = [0, 0];
  for (let y = 0; y < LACE; y++) {
    for (let x = 0; x < LACE; x++) {
      const u = x / LACE;
      const v = y / LACE;
      let lace = 0, amp = 1, norm = 0;
      for (let o = 0; o < 3; o++) {
        worley(u, v, 6 << o, seed + o * 31, w);
        const edge = 1 - smooth(0.0, 0.12 + 0.04 * o, w[1] - w[0]);
        lace += edge * amp;
        norm += amp;
        amp *= 0.6;
      }
      lace /= norm;
      const holes = smooth(0.35, 0.65, periodicFbm(u, v, 4, 3, seed + 5));
      const blot = periodicFbm(u, v, 3, 3, seed + 9);
      const i = (y * LACE + x) * 4;
      data[i] = Math.round(Math.min(1, lace * (0.35 + 0.65 * holes) * 1.4) * 255);
      data[i + 1] = Math.round(blot * 255);
      worley(u, v, 24, seed + 77, w);
      data[i + 2] = Math.round((1 - smooth(0, 0.1, w[1] - w[0])) * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

function dataTex(data, size) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 2; // the ocean samples these many times per pixel; keep filtering cheap
  t.needsUpdate = true;
  return t;
}

// Bilinear wrap sampling of a Uint8 RGBA buffer; returns 0..1.
function sampleBuf(data, size, u, v, ch) {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const m = size - 1;
  const x0 = xi & m, x1 = (xi + 1) & m, y0 = yi & m, y1 = (yi + 1) & m;
  const a = data[(y0 * size + x0) * 4 + ch];
  const b = data[(y0 * size + x1) * 4 + ch];
  const c = data[(y1 * size + x0) * 4 + ch];
  const d = data[(y1 * size + x1) * 4 + ch];
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) / 255;
}

// ---------------------------------------------------------------------------------------------
// GLSL. Declare LOOK_GLSL_UNIFORMS once in your shader (it declares the uniforms below), add
// `look.uniforms` entries to your material's uniforms (same objects → updated globally), then
// LOOK_GLSL_FUNCS for the helper functions.
export const LOOK_GLSL_UNIFORMS = /* glsl */ `
uniform float uTime;        // game time, s
uniform vec2 uWind;         // wind velocity m/s (x = world X, y = world Z)
uniform vec2 uWindOffset;   // integrated wind travel, m (use for anything that drifts with wind)
uniform float uRain;        // 0..1
uniform float uWet;         // 0..1 surfaces wetness (rain + 30 s dry-off)
uniform float uFlash;       // 0..1 lightning flash
uniform float uNight;       // 0..1
uniform vec2 uResolution;   // drawing buffer px
uniform sampler2D uAtlas;   // R fbm, G worley F1, B worley F2-F1, A hash  (256², tiling)
uniform sampler2D uDetail;  // RG slopes (0.5 = flat), B height  (256², tiling)
uniform sampler2D uLace;    // R foam lace, G blotches, B fine lace (512², tiling)
uniform vec4 uGustFronts[4];   // xy = centre (world x,z), zw = unit direction of travel
uniform vec4 uGustFrontsB[4];  // x = strength m/s (0 = inactive), y = width (band, m), z = length (m), w unused
`;

export const LOOK_GLSL_FUNCS = /* glsl */ `
// Gust intensity field 0..1 ("cat's paws"). Same formula as look.gustField() on the CPU.
float lookGust(vec2 xz) {
  float r = texture2D(uAtlas, (xz - uWindOffset * ${GUST_DRIFT.toFixed(3)}) * ${GUST_SCALE.toFixed(5)}).r;
  return smoothstep(0.45, 0.8, r);
}
// Profile of one moving gust front at world xz: 0..1 (sin² band across, gaussian taper along).
float lookFront(vec2 xz, vec4 a, vec4 b) {
  if (b.x <= 0.0) return 0.0;
  vec2 rel = xz - a.xy;
  float along = dot(rel, a.zw);
  float lat = dot(rel, vec2(-a.w, a.z));
  float band = abs(along) < 0.5 * b.y ? pow(sin(3.14159265 * (along / b.y + 0.5)), 2.0) : 0.0;
  float taper = exp(-2.0 * pow(lat / (0.5 * b.z), 2.0));
  return band * taper;
}
// Sum of all gust fronts, in m/s of extra wind speed.
float lookFronts(vec2 xz) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) s += lookFront(xz, uGustFronts[i], uGustFrontsB[i]) * uGustFrontsB[i].x;
  return s;
}
// Cloud cover 0..1 for cloud shadows (multiply light by mix(1.0, 0.72, cover * presetCloudiness)).
float lookCloud(vec2 xz) {
  float r = texture2D(uAtlas, (xz - uWindOffset * ${CLOUD_DRIFT.toFixed(3)}) * ${CLOUD_SCALE.toFixed(5)} + vec2(0.37, 0.61)).r;
  return smoothstep(0.45, 0.7, r);
}
`;

// ---------------------------------------------------------------------------------------------
// Fog patch: fog distance = horizontal distance from the point under the screen centre, so fog
// becomes a "visibility bubble" when looking down. Applied once, before any shader compiles.
let fogPatched = false;
function patchFog() {
  if (fogPatched) return;
  fogPatched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogOff;
#endif
`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogOff = mvPosition.xyz * mat3( viewMatrix ); // world-space offset from the camera
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogOff;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 lookFwd = -vec3( viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2] );
  vec2 lookFocus = lookFwd.xz * ( cameraPosition.y / max( -lookFwd.y, 0.25 ) );
  float lookHD = length( vFogOff.xz - lookFocus );
  float lookWY = cameraPosition.y + vFogOff.y;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * lookHD * lookHD );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, lookHD );
  #endif
  fogFactor *= ( 1.0 - 0.6 * smoothstep( 30.0, 140.0, lookWY ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

// ---------------------------------------------------------------------------------------------
export class Look {
  constructor(seed = 7) {
    patchFog();
    this.seed = seed;
    this.atlasData = makeAtlas(seed);
    const det = makeDetail(seed + 3);
    this.detailData = det.data;
    this.detailMaxSlope = det.maxSlope; // decode: slope_uv = (tex*2-1) * detailMaxSlope (per uv unit)
    this.laceData = makeLace(seed + 11);
    this.atlas = dataTex(this.atlasData, ATLAS);
    this.detail = dataTex(this.detailData, DETAIL);
    this.lace = dataTex(this.laceData, LACE);

    const v4 = () => [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 0));
    // Shared uniform objects: put them straight into material.uniforms (by reference).
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uWindOffset: { value: new THREE.Vector2() },
      uRain: { value: 0 },
      uWet: { value: 0 },
      uFlash: { value: 0 },
      uNight: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uAtlas: { value: this.atlas },
      uDetail: { value: this.detail },
      uLace: { value: this.lace },
      uGustFronts: { value: v4() },
      uGustFrontsB: { value: v4().map((v) => v.set(0, 140, 500, 0)) },
    };
    this._fronts = []; // CPU mirror: [{x, z, dx, dz, strength, width, length}]
  }

  // --- updates (weather calls setWind/setFronts every frame; main.js calls setTime) -------------
  setTime(t) {
    this.uniforms.uTime.value = t;
  }

  setWind(windVec2, dt) {
    this.uniforms.uWind.value.copy(windVec2);
    this.uniforms.uWindOffset.value.addScaledVector(windVec2, dt);
  }

  // fronts: array (≤4) of {x, z, dirX, dirZ, strength, width = 140, length = 500}
  setFronts(fronts) {
    const A = this.uniforms.uGustFronts.value;
    const B = this.uniforms.uGustFrontsB.value;
    this._fronts.length = 0;
    for (let i = 0; i < 4; i++) {
      const f = fronts[i];
      if (f && f.strength > 0) {
        A[i].set(f.x, f.z, f.dirX, f.dirZ);
        B[i].set(f.strength, f.width || 140, f.length || 500, 0);
        this._fronts.push({ x: f.x, z: f.z, dx: f.dirX, dz: f.dirZ, s: f.strength, w: f.width || 140, l: f.length || 500 });
      } else {
        B[i].x = 0;
      }
    }
  }

  setResolution(w, h) {
    this.uniforms.uResolution.value.set(w, h);
  }

  // --- CPU mirrors of the GLSL functions ----------------------------------------------------------
  // channel: 0 R, 1 G, 2 B, 3 A. u, v in tile units (wraps).
  sampleAtlas(u, v, ch = 0) {
    return sampleBuf(this.atlasData, ATLAS, u, v, ch);
  }
  sampleLace(u, v, ch = 0) {
    return sampleBuf(this.laceData, LACE, u, v, ch);
  }
  sampleDetail(u, v, ch = 2) {
    return sampleBuf(this.detailData, DETAIL, u, v, ch);
  }

  gustField(x, z) {
    const o = this.uniforms.uWindOffset.value;
    const r = this.sampleAtlas((x - o.x * GUST_DRIFT) * GUST_SCALE, (z - o.y * GUST_DRIFT) * GUST_SCALE, 0);
    return smooth(0.45, 0.8, r);
  }

  frontsAt(x, z) {
    let s = 0;
    for (const f of this._fronts) {
      const rx = x - f.x;
      const rz = z - f.z;
      const along = rx * f.dx + rz * f.dz;
      const lat = -rx * f.dz + rz * f.dx;
      if (Math.abs(along) >= 0.5 * f.w) continue;
      const band = Math.sin(Math.PI * (along / f.w + 0.5)) ** 2;
      const taper = Math.exp(-2 * (lat / (0.5 * f.l)) ** 2);
      s += band * taper * f.s;
    }
    return s;
  }

  cloudAt(x, z) {
    const o = this.uniforms.uWindOffset.value;
    const r = this.sampleAtlas((x - o.x * CLOUD_DRIFT) * CLOUD_SCALE + 0.37, (z - o.y * CLOUD_DRIFT) * CLOUD_SCALE + 0.61, 0);
    return smooth(0.45, 0.7, r);
  }

  // --- material helpers -----------------------------------------------------------------------------
  // Inverted-hull keyline with constant screen thickness. Add as a second mesh sharing the geometry
  // (mesh.add(new Mesh(geo, look.keyline()))). Works with skinned/instanced? — plain & instanced meshes.
  keyline({ color = '#05090B', opacity = 0.55, px = 1.0 } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uPx: { value: px },
        uResolution: this.uniforms.uResolution,
      },
      vertexShader: /* glsl */ `
        uniform float uPx;
        uniform vec2 uResolution;
        void main() {
          vec3 pos = position;
          vec3 nrm = normal;
          #ifdef USE_INSTANCING
            pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
            nrm = mat3(instanceMatrix) * nrm;
          #endif
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          vec4 clip = projectionMatrix * mv;
          vec3 nv = normalize(normalMatrix * nrm);
          vec2 nc = (projectionMatrix * vec4(nv, 0.0)).xy;
          float l = length(nc);
          if (l > 1e-5) clip.xy += (nc / l) * uPx * 2.0 * clip.w / uResolution;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
      side: THREE.BackSide,
      transparent: opacity < 1,
      depthWrite: false,
    });
  }

  // Merge parts into one BufferGeometry with baked vertex colours.
  // parts: [{ geometry, color?: Color|hex|string, matrix?: Matrix4, position?, rotation? (Euler|[x,y,z]), scale? (number|[x,y,z]) }]
  // Result attributes: position, normal, color (+ uv when every part has uv). Use vertexColors: true.
  merge(parts) {
    const geos = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let allUv = true;
    for (const p of parts) {
      let g = p.geometry.clone();
      if (p.matrix) m.copy(p.matrix);
      else {
        const pos = p.position ? (Array.isArray(p.position) ? new THREE.Vector3(...p.position) : p.position) : new THREE.Vector3();
        if (p.rotation) e.copy(Array.isArray(p.rotation) ? new THREE.Euler(...p.rotation) : p.rotation);
        else e.set(0, 0, 0);
        q.setFromEuler(e);
        if (p.scale === undefined) s.set(1, 1, 1);
        else if (typeof p.scale === 'number') s.setScalar(p.scale);
        else s.set(...p.scale);
        m.compose(pos, q, s);
      }
      g.applyMatrix4(m);
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) allUv = false;
      col.set(p.color !== undefined ? p.color : 0xffffff);
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = col.r;
        c[i * 3 + 1] = col.g;
        c[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      geos.push(g);
    }
    const out = new THREE.BufferGeometry();
    const names = ['position', 'normal', 'color'].concat(allUv ? ['uv'] : []);
    for (const name of names) {
      const size = geos[0].attributes[name].itemSize;
      let total = 0;
      for (const g of geos) total += g.attributes[name].count;
      const arr = new Float32Array(total * size);
      let off = 0;
      for (const g of geos) {
        arr.set(g.attributes[name].array, off);
        off += g.attributes[name].count * size;
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    out.computeBoundingSphere();
    out.computeBoundingBox();
    for (const g of geos) g.dispose();
    return out;
  }

  // Canvas-backed texture (decals, labels). draw(ctx2d, w, h) paints it.
  canvasTexture(w, h, draw, { srgb = true } = {}) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
}
