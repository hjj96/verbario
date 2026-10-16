// Render-side tables that three.js keeps internally (they belong to no game module, so
// export-data.mjs does not see them). Read verbatim from the vendored three r185 bundle:
//
//   Resources/Textures/dfg_lut.rg16f   DFG LUT used by BRDF_GGX_Multiscatter / computeMultiscattering
//                                      (WebGLPrograms: DataTexture(ba, 16, 16, RGFormat, HalfFloatType),
//                                      LinearFilter, ClampToEdge, no mips, flipY false → row 0 = v 0).
//                                      16 × 16 × 2 IEEE half floats, little endian, 1024 bytes.
//
//   node rescue-apple/tools/export/export-render.mjs          (re-run when the vendored three changes)
//
// MaydayRender (LookResources.swift) uploads the file as an .rg16Float texture; Shaders/Common/ThreePBR.h
// samples it exactly like three (texture2D(dfgLUT, vec2(roughness, dotNV)).rg).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bundlePath = path.join(repo, 'rescue/vendor/three/three.module.min.js');
const outPath = path.join(repo, 'rescue-apple/Resources/Textures/dfg_lut.rg16f');

const src = fs.readFileSync(bundlePath, 'utf8');

// import { RGFormat as Se, HalfFloatType as E, … } — resolve minified aliases to three names.
const importList = src.slice(0, src.indexOf('}from'));
const alias = (name) => {
  const m = importList.match(new RegExp(`(\\w+) as ${name.replace('$', '\\$')}[,}]`));
  return m ? m[1] : null;
};

const site = src.match(/new (\w+)\((\w+),(\d+),(\d+),(\w+),(\w+)\),\w+\.name="DFG_LUT",\w+\.minFilter=(\w+),\w+\.magFilter=(\w+),\w+\.wrapS=(\w+),\w+\.wrapT=(\w+)/);
if (!site) throw new Error('export-render: DFG_LUT construction site not found in the three bundle');
const [, ctor, arrName, w, h, fmt, type, minF, magF, wrapS, wrapT] = site;
const expect = [
  [ctor, 'DataTexture'],
  [fmt, 'RGFormat'],
  [type, 'HalfFloatType'],
  [minF, 'LinearFilter'],
  [magF, 'LinearFilter'],
  [wrapS, 'ClampToEdgeWrapping'],
  [wrapT, 'ClampToEdgeWrapping'],
];
for (const [a, name] of expect) {
  if (alias(a) !== name) throw new Error(`export-render: expected ${a} to be ${name}, got ${alias(a)}`);
}
if (w !== '16' || h !== '16') throw new Error(`export-render: unexpected DFG LUT size ${w}x${h}`);

const arr = src.match(new RegExp(`[,;\\s]${arrName.replace('$', '\\$')}=new Uint16Array\\(\\[([0-9,]+)\\]\\)`));
if (!arr) throw new Error(`export-render: array ${arrName} not found`);
const values = arr[1].split(',').map(Number);
if (values.length !== 16 * 16 * 2) throw new Error(`export-render: DFG LUT has ${values.length} values, expected 512`);

const buf = Buffer.alloc(values.length * 2);
values.forEach((v, i) => buf.writeUInt16LE(v, i * 2));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
console.log(`export-render: ${path.relative(repo, outPath)} ${buf.length} bytes sha256 ${sha}`);
