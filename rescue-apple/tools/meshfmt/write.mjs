// .mmesh v1 encoder (tools/meshfmt/SPEC.md). Pure Node, no dependencies on the game.
//
//   import { encodeMMesh, writeMMesh } from '../meshfmt/write.mjs';
//   const { buffer } = encodeMMesh({
//     attributes: [{ name: 'position', array: Float32Array, components: 3 }, …],   // three BufferAttributes
//     index: Uint32Array | null,      // three geometry.index (kept as is) or null (→ exact-dedup indexing)
//     ranges: [{ name: 'main', start, count }, …] | null,   // null → main = everything
//     bounds: { sphere: [x, y, z, r], box: [minX, minY, minZ, maxX, maxY, maxZ] } | null,  // null → three's rule
//     meta: {…},                      // JSON block (SPEC «Meta JSON»)
//     quantize: { normal: 'snorm16', color: 'unorm8', … },   // optional, components 2…4 only
//   });
//
// Deterministic: the same input gives the same bytes (no timestamps; JSON in insertion order).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MAGIC = 'MMSH';
export const VERSION = 1;
export const HEADER_BYTES = 80;
export const ATTR_BYTES = 32;
export const RANGE_BYTES = 24;
export const NAME_BYTES = 16;
export const FORMAT = { f32: 1, f16: 2, snorm16: 3, unorm8: 4 };
export const FORMAT_SIZE = { 1: 4, 2: 2, 3: 2, 4: 1 };

const align16 = (n) => (n + 15) & ~15;

// IEEE 754 binary16 from a float32 value, round to nearest even (what Metal / GPUs do for half).
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
export function toHalf(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow → Inf
  if (e <= 0) {
    if (e < -10) return sign; // underflow → ±0
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (h & 1))) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++; // may carry into the exponent: still correct
  return sign | h;
}

function quantizeStream(arr, fmt) {
  const n = arr.length;
  if (fmt === FORMAT.f32) return new Float32Array(arr);
  if (fmt === FORMAT.f16) {
    const o = new Uint16Array(n);
    for (let i = 0; i < n; i++) o[i] = toHalf(arr[i]);
    return o;
  }
  if (fmt === FORMAT.snorm16) {
    const o = new Int16Array(n);
    for (let i = 0; i < n; i++) o[i] = Math.max(-32767, Math.min(32767, Math.round(arr[i] * 32767)));
    return o;
  }
  if (fmt === FORMAT.unorm8) {
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = Math.max(0, Math.min(255, Math.round(arr[i] * 255)));
    return o;
  }
  throw new Error(`mmesh: unknown format ${fmt}`);
}

// three BufferGeometry.computeBoundingBox / computeBoundingSphere (box centre, max distance), from the
// float32 positions in double precision like three (Vector3 maths on JS numbers), stored as float32.
export function threeBounds(pos) {
  const n = pos.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = pos[i * 3 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  const cx = (min[0] + max[0]) * 0.5, cy = (min[1] + max[1]) * 0.5, cz = (min[2] + max[2]) * 0.5;
  let maxSq = 0;
  for (let i = 0; i < n; i++) {
    const dx = cx - pos[i * 3], dy = cy - pos[i * 3 + 1], dz = cz - pos[i * 3 + 2];
    maxSq = Math.max(maxSq, dx * dx + dy * dy + dz * dz);
  }
  return { sphere: [cx, cy, cz, Math.sqrt(maxSq)], box: [...min, ...max] };
}

// Exact dedup of a non-indexed triangle soup: a vertex merges with an earlier one only when every
// attribute's float32 bits are identical. Returns { attributes (compacted), index }.
export function dedupVertices(attributes) {
  const n = attributes[0].array.length / attributes[0].components;
  const bytesPer = attributes.reduce((s, a) => s + a.components * 4, 0);
  const key = Buffer.alloc(bytesPer);
  const views = attributes.map((a) => new Uint8Array(new Float32Array(a.array).buffer));
  const map = new Map();
  const index = new Uint32Array(n);
  const keep = [];
  for (let v = 0; v < n; v++) {
    let o = 0;
    for (let k = 0; k < attributes.length; k++) {
      const w = attributes[k].components * 4;
      key.set(views[k].subarray(v * w, v * w + w), o);
      o += w;
    }
    const s = key.toString('latin1');
    let id = map.get(s);
    if (id === undefined) {
      id = keep.length;
      map.set(s, id);
      keep.push(v);
    }
    index[v] = id;
  }
  const out = attributes.map((a) => {
    const c = a.components;
    const arr = new Float32Array(keep.length * c);
    for (let i = 0; i < keep.length; i++) for (let j = 0; j < c; j++) arr[i * c + j] = a.array[keep[i] * c + j];
    return { ...a, array: arr };
  });
  return { attributes: out, index };
}

function writeName(buf, off, name) {
  if (!/^[\x21-\x7e]{1,15}$/.test(name)) throw new Error(`mmesh: bad name "${name}" (ASCII, 1…15 chars)`);
  buf.fill(0, off, off + NAME_BYTES);
  buf.write(name, off, 'ascii');
}

export function encodeMMesh({ attributes, index = null, ranges = null, bounds = null, meta = {}, quantize = {} }) {
  if (!attributes?.length) throw new Error('mmesh: no attributes');
  if (attributes.length > 16) throw new Error('mmesh: > 16 attributes');
  const pos = attributes.find((a) => a.name === 'position');
  if (!pos || pos.components !== 3) throw new Error('mmesh: position (3 components) is mandatory');
  if (new Set(attributes.map((a) => a.name)).size !== attributes.length) throw new Error('mmesh: duplicate attribute names');
  const webCount = pos.array.length / 3;
  for (const a of attributes) {
    if (!(a.components >= 1 && a.components <= 4)) throw new Error(`mmesh: ${a.name}: components ${a.components}`);
    if (a.array.length !== webCount * a.components) throw new Error(`mmesh: ${a.name}: ${a.array.length} values for ${webCount} vertices`);
  }
  if (!webCount) throw new Error('mmesh: empty geometry');

  let attrs = attributes.map((a) => ({ ...a, array: Float32Array.from(a.array) }));
  let idx;
  if (index) {
    idx = Uint32Array.from(index);
    for (const i of idx) if (i >= webCount) throw new Error(`mmesh: index ${i} ≥ ${webCount}`);
  } else {
    if (webCount % 3) throw new Error('mmesh: non-indexed geometry is not a triangle list');
    ({ attributes: attrs, index: idx } = dedupVertices(attrs));
  }
  if (idx.length % 3) throw new Error('mmesh: index count is not a multiple of 3');
  const vertexCount = attrs[0].array.length / attrs[0].components;
  const indexCount = idx.length;
  const rng = ranges || [{ name: 'main', start: 0, count: indexCount }];
  if (rng[0].name !== 'main') throw new Error('mmesh: the first range must be "main"');
  for (const r of rng) {
    if (r.start < 0 || r.count < 0 || r.start + r.count > indexCount || r.count % 3 || r.start % 3) throw new Error(`mmesh: range ${r.name} ${r.start}+${r.count} outside 0..${indexCount}`);
  }
  const b = bounds || threeBounds(pos.array);

  // streams (quantised as asked)
  const streams = attrs.map((a) => {
    const fname = quantize[a.name] || 'f32';
    const fmt = FORMAT[fname];
    if (!fmt) throw new Error(`mmesh: ${a.name}: unknown format ${fname}`);
    if (fmt !== FORMAT.f32 && (a.components < 2 || a.name === 'position')) throw new Error(`mmesh: ${a.name}: ${fname} needs 2…4 components and not position`);
    const typed = quantizeStream(a.array, fmt);
    return { name: a.name, fmt, components: a.components, typed, stride: a.components * FORMAT_SIZE[fmt] };
  });

  const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
  const tables = HEADER_BYTES + ATTR_BYTES * streams.length + RANGE_BYTES * rng.length;
  const dataOffset = align16(tables + metaBytes.length);
  let off = dataOffset;
  for (const s of streams) {
    s.offset = off;
    s.byteLength = vertexCount * s.stride;
    off = align16(off + s.byteLength);
  }
  const indexOffset = off;
  const fileLength = align16(indexOffset + indexCount * 4);

  const buf = Buffer.alloc(fileLength);
  buf.write(MAGIC, 0, 'ascii');
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(1, 6); // indexed
  buf.writeUInt32LE(vertexCount, 8);
  buf.writeUInt32LE(indexCount, 12);
  buf.writeUInt16LE(streams.length, 16);
  buf.writeUInt16LE(rng.length, 18);
  buf.writeUInt32LE(metaBytes.length, 20);
  buf.writeUInt32LE(dataOffset, 24);
  buf.writeUInt32LE(fileLength, 28);
  const bf = [...b.sphere, ...b.box];
  if (bf.length !== 10 || !bf.every(Number.isFinite)) throw new Error('mmesh: bounds must be 10 finite numbers');
  for (let i = 0; i < 10; i++) buf.writeFloatLE(bf[i], 32 + i * 4);
  buf.writeUInt32LE(indexOffset, 72);
  buf.writeUInt32LE(0, 76);

  let t = HEADER_BYTES;
  for (const s of streams) {
    writeName(buf, t, s.name);
    buf.writeUInt8(s.fmt, t + 16);
    buf.writeUInt8(s.components, t + 17);
    buf.writeUInt16LE(0, t + 18);
    buf.writeUInt32LE(s.offset, t + 20);
    buf.writeUInt32LE(s.stride, t + 24);
    buf.writeUInt32LE(s.byteLength, t + 28);
    t += ATTR_BYTES;
  }
  for (const r of rng) {
    writeName(buf, t, r.name);
    buf.writeUInt32LE(r.start, t + 16);
    buf.writeUInt32LE(r.count, t + 20);
    t += RANGE_BYTES;
  }
  metaBytes.copy(buf, t);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('mmesh: big-endian host');
  for (const s of streams) Buffer.from(s.typed.buffer, s.typed.byteOffset, s.typed.byteLength).copy(buf, s.offset);
  Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength).copy(buf, indexOffset);
  return { buffer: buf, vertexCount, indexCount, webVertexCount: webCount };
}

/** Encode and write; returns { path (absolute), bytes, sha256, vertexCount, indexCount }. */
export function writeMMesh(file, mesh) {
  const r = encodeMMesh(mesh);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, r.buffer);
  return { path: file, bytes: r.buffer.length, sha256: createHash('sha256').update(r.buffer).digest('hex'), vertexCount: r.vertexCount, indexCount: r.indexCount };
}
