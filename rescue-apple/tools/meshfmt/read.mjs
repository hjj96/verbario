// .mmesh v1 decoder with full structural validation (tools/meshfmt/SPEC.md). Throws on the first problem
// with a message naming the file part; used by verify.mjs and the tests of write.mjs.
//
//   const m = decodeMMesh(buffer);
//   m.attributes[i] = { name, format, components, offset, stride, byteLength, raw (typed array), floats (Float32Array) }
//   m.index (Uint32Array), m.ranges [{ name, start, count }], m.bounds { sphere, box }, m.meta (parsed JSON)
//   expandTriangles(m, name) → Float32Array of that attribute per triangle corner (three's non-indexed view)
import { MAGIC, VERSION, HEADER_BYTES, ATTR_BYTES, RANGE_BYTES, NAME_BYTES, FORMAT, FORMAT_SIZE } from './write.mjs';

const FORMAT_NAME = Object.fromEntries(Object.entries(FORMAT).map(([k, v]) => [v, k]));

export function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function readName(buf, off, what) {
  const raw = buf.subarray(off, off + NAME_BYTES);
  const end = raw.indexOf(0);
  const name = raw.subarray(0, end < 0 ? NAME_BYTES : end).toString('ascii');
  if (end < 0 || !/^[\x21-\x7e]{1,15}$/.test(name)) throw new Error(`${what}: bad name`);
  for (let i = end; i < NAME_BYTES; i++) if (raw[i] !== 0) throw new Error(`${what}: name not NUL-padded`);
  return name;
}

export function decodeMMesh(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const fail = (m) => { throw new Error(`mmesh: ${m}`); };
  if (buf.length < HEADER_BYTES) fail(`file is ${buf.length} bytes (< header)`);
  if (buf.toString('ascii', 0, 4) !== MAGIC) fail('bad magic');
  const version = buf.readUInt16LE(4);
  if (version !== VERSION) fail(`version ${version} (this reader knows ${VERSION})`);
  const flags = buf.readUInt16LE(6);
  if (flags & ~1) fail(`unknown flags 0x${flags.toString(16)}`);
  const indexed = (flags & 1) === 1;
  const vertexCount = buf.readUInt32LE(8);
  const indexCount = buf.readUInt32LE(12);
  const attrCount = buf.readUInt16LE(16);
  const rangeCount = buf.readUInt16LE(18);
  const metaLength = buf.readUInt32LE(20);
  const dataOffset = buf.readUInt32LE(24);
  const fileLength = buf.readUInt32LE(28);
  const bf = [];
  for (let i = 0; i < 10; i++) bf.push(buf.readFloatLE(32 + i * 4));
  const indexOffset = buf.readUInt32LE(72);
  if (buf.readUInt32LE(76) !== 0) fail('reserved header word is not 0');
  if (fileLength !== buf.length) fail(`fileLength ${fileLength} != ${buf.length} bytes`);
  if (fileLength % 16) fail('fileLength is not a multiple of 16');
  if (!vertexCount) fail('vertexCount is 0');
  if (attrCount < 1 || attrCount > 16) fail(`attrCount ${attrCount}`);
  if (rangeCount < 1) fail('no ranges');
  if (!indexed && (indexCount || indexOffset)) fail('index fields set on a non-indexed mesh');
  if (indexed && indexCount % 3) fail(`indexCount ${indexCount} is not a multiple of 3`);
  if (!bf.every(Number.isFinite)) fail('bounds are not finite');
  if (dataOffset % 16) fail('dataOffset is not 16-aligned');
  const tables = HEADER_BYTES + ATTR_BYTES * attrCount + RANGE_BYTES * rangeCount;
  if (tables + metaLength > dataOffset) fail('tables + meta overlap the data');
  for (let i = tables + metaLength; i < dataOffset; i++) if (buf[i]) fail('non-zero padding before the data');

  const attributes = [];
  const names = new Set();
  let t = HEADER_BYTES;
  let end = dataOffset;
  for (let a = 0; a < attrCount; a++, t += ATTR_BYTES) {
    const name = readName(buf, t, `attribute ${a}`);
    if (names.has(name)) fail(`duplicate attribute ${name}`);
    names.add(name);
    const format = buf.readUInt8(t + 16);
    const components = buf.readUInt8(t + 17);
    const offset = buf.readUInt32LE(t + 20);
    const stride = buf.readUInt32LE(t + 24);
    const byteLength = buf.readUInt32LE(t + 28);
    if (!FORMAT_SIZE[format]) fail(`${name}: unknown format ${format}`);
    if (components < 1 || components > 4) fail(`${name}: components ${components}`);
    if (format !== FORMAT.f32 && components < 2) fail(`${name}: ${FORMAT_NAME[format]} with 1 component`);
    if (buf.readUInt16LE(t + 18) !== 0) fail(`${name}: reserved field is not 0`);
    if (stride !== components * FORMAT_SIZE[format]) fail(`${name}: stride ${stride}`);
    if (byteLength !== vertexCount * stride) fail(`${name}: byteLength ${byteLength}`);
    if (offset % 16) fail(`${name}: offset not 16-aligned`);
    if (offset < end) fail(`${name}: stream overlaps the previous part`);
    if (offset + byteLength > buf.length) fail(`${name}: stream runs past the end`);
    for (let i = end; i < offset; i++) if (buf[i]) fail(`${name}: non-zero padding`);
    end = offset + byteLength;
    const slice = buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + byteLength);
    const n = vertexCount * components;
    let raw, floats;
    if (format === FORMAT.f32) { raw = new Float32Array(slice); floats = raw; }
    else if (format === FORMAT.f16) { raw = new Uint16Array(slice); floats = Float32Array.from(raw, fromHalf); }
    else if (format === FORMAT.snorm16) { raw = new Int16Array(slice); floats = Float32Array.from(raw, (v) => Math.max(v / 32767, -1)); }
    else { raw = new Uint8Array(slice); floats = Float32Array.from(raw, (v) => v / 255); }
    if (floats.length !== n) fail(`${name}: decoded ${floats.length} values`);
    for (const v of floats) if (!Number.isFinite(v)) fail(`${name}: non-finite value`);
    attributes.push({ name, format, formatName: FORMAT_NAME[format], components, offset, stride, byteLength, raw, floats });
  }
  const pos = attributes.find((a) => a.name === 'position');
  if (!pos || pos.format !== FORMAT.f32 || pos.components !== 3) fail('position must be f32 × 3');

  const ranges = [];
  for (let r = 0; r < rangeCount; r++, t += RANGE_BYTES) {
    const name = readName(buf, t, `range ${r}`);
    const start = buf.readUInt32LE(t + 16);
    const count = buf.readUInt32LE(t + 20);
    const total = indexed ? indexCount : vertexCount;
    if (start + count > total || count % 3 || start % 3) fail(`range ${name} ${start}+${count} outside 0..${total}`);
    ranges.push({ name, start, count });
  }
  if (ranges[0].name !== 'main') fail('first range is not "main"');
  if (new Set(ranges.map((r) => r.name)).size !== ranges.length) fail('duplicate range names');

  let meta;
  try { meta = JSON.parse(buf.toString('utf8', tables, tables + metaLength)); } catch (e) { fail(`meta JSON: ${e.message}`); }

  let index = null;
  if (indexed) {
    if (indexOffset % 16) fail('indexOffset not 16-aligned');
    if (indexOffset < end) fail('index stream overlaps an attribute stream');
    for (let i = end; i < indexOffset; i++) if (buf[i]) fail('non-zero padding before the index');
    if (indexOffset + indexCount * 4 > buf.length) fail('index stream runs past the end');
    index = new Uint32Array(buf.buffer.slice(buf.byteOffset + indexOffset, buf.byteOffset + indexOffset + indexCount * 4));
    for (const i of index) if (i >= vertexCount) fail(`index ${i} ≥ vertexCount ${vertexCount}`);
    end = indexOffset + indexCount * 4;
  }
  for (let i = end; i < buf.length; i++) if (buf[i]) fail('non-zero trailing padding');
  if (buf.length !== ((end + 15) & ~15)) fail('trailing bytes after the last stream');

  return {
    version, flags, indexed, vertexCount, indexCount, dataOffset, indexOffset, fileLength,
    bounds: { sphere: bf.slice(0, 4), box: bf.slice(4, 10) },
    attributes, ranges, meta, metaLength, index,
  };
}

/** One attribute per triangle corner (three's toNonIndexed view of `main`), as float32. */
export function expandTriangles(m, name, rangeName = 'main') {
  const a = m.attributes.find((x) => x.name === name);
  if (!a) throw new Error(`mmesh: no attribute ${name}`);
  const r = m.ranges.find((x) => x.name === rangeName);
  const c = a.components;
  const out = new Float32Array(r.count * c);
  for (let k = 0; k < r.count; k++) {
    const v = m.indexed ? m.index[r.start + k] : r.start + k;
    for (let j = 0; j < c; j++) out[k * c + j] = a.floats[v * c + j];
  }
  return out;
}
