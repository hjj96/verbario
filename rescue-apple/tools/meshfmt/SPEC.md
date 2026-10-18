# `.mmesh` — baked mesh format, version 1

Hand-built procedural geometry of the web game (three.js r185 primitives merged by `look.merge`,
`heli/shapes.js` lofts, `mergeSurfaces` …) is **baked** from the live web code instead of being re-implemented
in Swift (PLAN D6, §6). One `.mmesh` file holds one three.js `BufferGeometry` exactly as the web builds it,
plus a JSON block with what the renderer needs to place and shade it (the object's local transform chain,
render flags, material parameters, thermal flags).

| Tool | Role |
|---|---|
| `tools/meshfmt/write.mjs` | encoder (`encodeMMesh`, `writeMMesh`): exact-dedup indexing, optional quantisation |
| `tools/meshfmt/read.mjs` | decoder with full structural validation (`decodeMMesh`, `expandTriangles`) |
| `tools/meshfmt/verify.mjs` | checks every `Resources/Meshes/*.mmesh`: structure, manifest sha256, and (`--web`) bit equality with the live web geometry; `--summary` feeds the Swift check |
| `tools/meshfmt/check-loader.sh` | Linux check of the Swift parser (`Sources/MaydayRender/Mesh/MMeshFile.swift`) against the JS decoder |
| `tools/export/bake-meshes.mjs` | builds the real web objects in Node and writes `Resources/Meshes/*.mmesh` + the manifest entries |
| `Sources/MaydayRender/Mesh/MMeshLoader.swift` | runtime: file → interleaved `MTLBuffer` + `MTLVertexDescriptor` |

## Byte layout

Everything is **little-endian**. Offsets are from the start of the file. Every stream starts on a 16-byte
boundary; gaps are zero bytes.

### Header — 80 bytes

| off | type | field |
|---:|---|---|
| 0 | `u8[4]` | magic `"MMSH"` |
| 4 | `u16` | `version` = 1 |
| 6 | `u16` | `flags`: bit 0 = indexed (an index stream is present); bits 1–15 = 0 |
| 8 | `u32` | `vertexCount` (> 0) |
| 12 | `u32` | `indexCount` (0 when not indexed; a multiple of 3 when indexed) |
| 16 | `u16` | `attrCount` (1 … 16) |
| 18 | `u16` | `rangeCount` (≥ 1) |
| 20 | `u32` | `metaLength`: bytes of the UTF-8 JSON block |
| 24 | `u32` | `dataOffset`: first attribute stream (multiple of 16) |
| 28 | `u32` | `fileLength`: total file size |
| 32 | `f32[4]` | bounding sphere: centre x, y, z, radius — three `geometry.boundingSphere` as the web leaves it (e.g. the lights add +3 m for the halos) |
| 48 | `f32[6]` | bounding box: min x, y, z, max x, y, z (`geometry.boundingBox`) |
| 72 | `u32` | `indexOffset` (multiple of 16; 0 when not indexed) |
| 76 | `u32` | reserved = 0 |

### Attribute table — `attrCount` × 32 bytes, at offset 80

| off | type | field |
|---:|---|---|
| 0 | `char[16]` | name: the three attribute name (`position`, `normal`, `color`, `uv`, `aSurf`, `aCorner` …), ASCII, NUL-padded, ≤ 15 characters, unique |
| 16 | `u8` | `format`: 1 `f32`, 2 `f16` (IEEE 754 binary16), 3 `snorm16`, 4 `unorm8` |
| 17 | `u8` | `components` 1 … 4 (three `itemSize`) |
| 18 | `u16` | reserved = 0 |
| 20 | `u32` | `offset` of the stream (multiple of 16, ≥ `dataOffset`) |
| 24 | `u32` | `stride` = components × element size (4 / 2 / 2 / 1); streams are tightly packed, not interleaved |
| 28 | `u32` | `byteLength` = `vertexCount` × `stride` |

`position` (f32 × 3) is mandatory. Quantised formats are only allowed for 2 … 4 components (they map to
Metal's `half2…4`, `short2…4Normalized`, `uchar2…4Normalized`). Decoding: `snorm16` → `max(v / 32767, −1)`,
`unorm8` → `v / 255` (Metal's rules). Version 1 bakes write `f32` only (PLAN §6: quantisation is M9).

### Range table — `rangeCount` × 24 bytes, right after the attribute table

| off | type | field |
|---:|---|---|
| 0 | `char[16]` | name: `main` (what colour passes draw; always present, always first), `shadow` (what the depth pass draws, optional) |
| 16 | `u32` | `start` — first index (indexed) or first vertex |
| 20 | `u32` | `count` — indices (indexed) or vertices; a multiple of 3 |

`main` is three's `geometry.drawRange` clamped to the geometry (the default `0, Infinity` → everything).

### Meta block — `metaLength` bytes, right after the range table

UTF-8 JSON (no BOM, no NUL), padded with zeros to `dataOffset`. Written with sorted-by-insertion keys, no
timestamps, so a re-bake of the same web revision is byte-identical. See **Meta JSON** below.

### Streams

One stream per attribute, in table order, then the index stream (`u32` × `indexCount` at `indexOffset`).
Every index is < `vertexCount`. `fileLength` = end of the last stream, padded to 16.

## Indexing and triangle order

three draws a non-indexed geometry as consecutive vertex triples, an indexed one through its index. The
writer keeps **three's triangle order** in both cases, so rasterisation (and therefore blending of
coincident overlay patches like the hull's stripes and decals) is identical:

- **non-indexed** geometry (everything `look.merge` / `mergeSurfaces` returns, three polyhedra) is indexed by
  **exact deduplication**: two vertices merge only when every attribute is bit-identical (f32 bits);
  vertices are numbered in order of first occurrence, and triangle *k* of the file is triangle *k* of the web;
- **indexed** geometry (three's Circle / Cylinder / Cone / Sphere / Capsule, the cable and ring ribbons) keeps
  its vertex array and index **unchanged**: shaders that address vertices by `vertex_id` (cable, reach ring)
  rely on the web's vertex numbering.

`geometry.groups` are not stored: the baked meshes have one material each, and three ignores groups for a
single (non-array) material.

## Meta JSON

Written by `bake-meshes.mjs`; the loader treats it as opaque JSON (`MMeshFile.meta`). Keys:

| key | content |
|---|---|
| `name` | file stem (`heli_hull`) |
| `source` | `{ "web": <git sha of the web>, "dirty": bool, "module": "systems/heli/model.js", "object": "heli.hull" }` |
| `chains` | one chain per web object drawn with this geometry (two flotation bags, four flare embers …): the local transforms from the model root down to the mesh, `[{ "role", "name", "position": [x,y,z], "quaternion": [x,y,z,w], "scale": [x,y,z] }]`, as the web constructs them. Roles name the nodes the renderer animates from MaydayCore state (`root`, `body`, `rotorPivot`, `hub`, `blades`, `crewman`, `crewArm`, `crewHead`, `float` scale …); every other entry is static. World-space objects (basket, cable, cone, flares …) have a one-entry chain |
| `object` | `{ renderOrder, layers (three Layers.mask at construction), castShadow, receiveShadow, frustumCulled, visible }` |
| `material` | three material parameters: `type`, `color` / `emissive` as linear RGB, `roughness`, `metalness`, `clearcoat`, `clearcoatRoughness`, `vertexColors`, `transparent`, `opacity`, `depthWrite`, `depthTest`, `side` (`front` / `back` / `double`), `blending` (`normal` / `additive` …) — whatever the material has |
| `thermal` | thermal-view flags (systems/post/thermal.js): `{ "heat": h }` for layer-2 heat sources, `{ "mass": m }` for the solid airframe that the sweep moves to layer 3, or `null` |
| `web` | `{ "vertexCount", "indexed", "triangles" }` of the web geometry before dedup |

## Versioning

`version` changes when the byte layout changes; readers reject any version they do not know. Adding meta
keys does not change the version. The manifest (`Resources/Data/manifest.json`) lists every `.mmesh` with
`schema: "mayday.mmesh"`, `version`, `bytes` and `sha256` (`lib/common.mjs writeManifest`); the app checks
them through `DataCatalog`.
